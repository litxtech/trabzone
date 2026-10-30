-- ---------------------------------------------------------------------------
-- 0190 — Trabzone Deprem Merkezi: çekirdek veri modeli
--
-- Veri akışı: AFAD (birincil) / USGS (ikincil) → earthquake-sync edge function
-- (şema doğrulama + normalizasyon) → earthquake_ingest (doğrulama, eşleştirme,
-- revizyon, bildirim kuyruğu) → istemciler yalnızca RPC ile okur.
--
-- Canlı doğrulanan kaynak davranışları (2026-10):
--  * AFAD apiv2/event/filter JSON alanlarının tamamı metin döner; `date`
--    saat dilimi içermez ve UTC'dir (USGS ile aynı olay karşılaştırıldı).
--  * AFAD `maxrad` belgede derece yazsa da metre gibi davranıyor; bu yüzden
--    sorgu bbox ile yapılır, mesafe burada PostGIS (geography, km) ile hesaplanır.
--  * AFAD tek sorguda en fazla 1000 kayıt döndürür; servis yalnızca yakın
--    geçmişi tutar. Arşiv bu tablolarda birikir, kayıtlar kendiliğinden silinmez.
--
-- Tüm zamanlar UTC (timestamptz) saklanır; gösterim Europe/Istanbul.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Yetkiler
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr) values
  ('earthquake.view',   'Deprem merkezi panelini, kaynak durumunu ve senkronizasyon kayıtlarını görüntüleme'),
  ('earthquake.manage', 'Deprem veri kaynağı, bölge ve senkronizasyon ayarlarını yönetme'),
  ('earthquake.review', 'Deprem kayıtlarını inceleme, eşleştirme kararı verme ve not ekleme'),
  ('earthquake.notify', 'Deprem bildirim ayarlarını, kuyruğunu ve test bildirimlerini yönetme')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'earthquake.view'), ('admin', 'earthquake.manage'), ('admin', 'earthquake.review'), ('admin', 'earthquake.notify'),
  ('map_manager', 'earthquake.view'), ('map_manager', 'earthquake.manage'), ('map_manager', 'earthquake.review'),
  ('moderator', 'earthquake.view'),
  ('support_agent', 'earthquake.view'),
  ('analyst', 'earthquake.view'),
  ('security_officer', 'earthquake.view')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Bildirim türü
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'follow', 'like', 'comment', 'message', 'group_invite', 'order', 'market_message',
  'support', 'security', 'system', 'mention', 'ride', 'news', 'live_news',
  'live_news_verified', 'live_news_moderation', 'pharmacy', 'earthquake'
));

-- ---------------------------------------------------------------------------
-- 3. Ayarlar (tek satır)
-- ---------------------------------------------------------------------------
create table if not exists public.earthquake_settings (
  id                         smallint primary key default 1 check (id = 1),
  center_lat                 double precision not null default 41.0027,
  center_lng                 double precision not null default 39.7168,
  center_label               text not null default 'Trabzon merkez (Ortahisar)',
  default_region             text not null default 'r150'
                               check (default_region in ('province', 'r50', 'r100', 'r150', 'r250', 'turkey')),
  radius_options             integer[] not null default '{50,100,150,250}',
  turkey_enabled             boolean not null default true,
  district_filter_enabled    boolean not null default true,
  default_range_days         integer not null default 7 check (default_range_days between 1 and 365),
  map_default_zoom           numeric(4,1) not null default 7.0 check (map_default_zoom between 3 and 14),
  map_layers                 jsonb not null default '{"boundary": true, "radius": true, "clusters": true}'::jsonb,
  chart_max_points           integer not null default 1500 check (chart_max_points between 100 and 10000),
  sync_enabled               boolean not null default true,
  sync_interval_seconds      integer not null default 60 check (sync_interval_seconds between 30 and 900),
  overlap_minutes            integer not null default 120 check (overlap_minutes between 10 and 1440),
  revision_sweep_hours       integer not null default 48 check (revision_sweep_hours between 6 and 168),
  stale_after_seconds        integer not null default 300 check (stale_after_seconds between 60 and 3600),
  worker_url                 text,
  notifications_enabled      boolean not null default true,
  notifications_paused       boolean not null default false,
  notify_trabzon_enabled     boolean not null default true,
  notify_turkey_enabled      boolean not null default true,
  notify_small_enabled       boolean not null default true,
  small_magnitude_threshold  numeric(3,1) not null default 2.0,
  late_event_max_minutes     integer not null default 120 check (late_event_max_minutes between 5 and 1440),
  revision_notify_min_delta  numeric(3,1) not null default 0.5 check (revision_notify_min_delta between 0.1 and 3),
  important_magnitude        numeric(3,1) not null default 4.0,
  quiet_bypass_magnitude     numeric(3,1) not null default 4.0,
  push_expire_minutes        integer not null default 120 check (push_expire_minutes between 10 and 1440),
  last_tick_at               timestamptz,
  last_sweep_at              timestamptz,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references auth.users (id) on delete set null
);

insert into public.earthquake_settings (id, worker_url)
values (1, 'https://nzvoufcywppavaioirac.supabase.co')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Veri kaynakları
--    Erişim anahtarı gerekmez; gerekirse yalnızca sunucu ortam değişkeni adı
--    tutulur. Kaynağı kapatmak geçmiş kayıtları silmez.
-- ---------------------------------------------------------------------------
create table if not exists public.earthquake_sources (
  key                   text primary key check (key in ('afad', 'usgs')),
  name                  text not null,
  homepage_url          text not null,
  api_url               text not null,
  docs_url              text,
  attribution           text not null,
  terms_status          text not null default 'pending_review'
                          check (terms_status in ('pending_review', 'verified', 'restricted')),
  terms_note            text,
  is_enabled            boolean not null default true,
  is_primary            boolean not null default false,
  health                text not null default 'unknown'
                          check (health in ('unknown', 'healthy', 'degraded', 'down', 'disabled')),
  consecutive_failures  integer not null default 0,
  next_retry_at         timestamptz,
  last_attempt_at       timestamptz,
  last_success_at       timestamptz,
  last_error_code       text,
  last_error_message    text,
  last_error_at         timestamptz,
  last_latency_ms       integer,
  last_http_status      integer,
  last_response_sample  jsonb,
  last_response_meta    jsonb,
  updated_at            timestamptz not null default now()
);

create unique index if not exists earthquake_sources_one_primary
  on public.earthquake_sources (is_primary) where is_primary;

insert into public.earthquake_sources
  (key, name, homepage_url, api_url, docs_url, attribution, terms_status, terms_note, is_enabled, is_primary)
values
  ('afad', 'AFAD Deprem Dairesi', 'https://deprem.afad.gov.tr',
   'https://deprem.afad.gov.tr/apiv2/event/filter', 'https://deprem.afad.gov.tr/event-service',
   'Kaynak: AFAD', 'pending_review',
   'Otomatik sorgulama ve yeniden kullanım koşulları AFAD ile yazılı olarak doğrulanmalı. Doğrulanana kadar sorgu aralığı 60 sn altına indirilmez.',
   true, true),
  ('usgs', 'USGS Earthquake Hazards Program', 'https://earthquake.usgs.gov',
   'https://earthquake.usgs.gov/fdsnws/event/1/query', 'https://earthquake.usgs.gov/fdsnws/event/1/',
   'Kaynak: USGS', 'pending_review',
   'USGS verileri kamu malıdır; atıf yapılır. Bölge kapsaması küçük büyüklükler için sınırlıdır.',
   true, false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Bölgeler (il + ilçe sınırları; veri 0191'de)
-- ---------------------------------------------------------------------------
create table if not exists public.earthquake_regions (
  key              text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  kind             text not null check (kind in ('province', 'district')),
  name             text not null,
  parent_key       text references public.earthquake_regions (key) on delete restrict,
  osm_relation_id  bigint,
  geom             extensions.geometry(MultiPolygon, 4326),
  display_ring     jsonb,
  area_km2         numeric(10,1),
  source           text not null default 'OpenStreetMap (ODbL)',
  fetched_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists earthquake_regions_geom_idx on public.earthquake_regions using gist (geom);

-- ---------------------------------------------------------------------------
-- 6. Kanonik deprem olayları
-- ---------------------------------------------------------------------------
create table if not exists public.earthquake_events (
  id                      uuid primary key default gen_random_uuid(),
  canonical_event_id      text not null unique check (canonical_event_id ~ '^(afad|usgs)-[a-z0-9]{1,60}$'),
  preferred_source        text not null references public.earthquake_sources (key),
  sources                 text[] not null default '{}',
  occurred_at             timestamptz not null,
  latitude                double precision not null check (latitude between -90 and 90),
  longitude               double precision not null check (longitude between -180 and 180),
  geog                    extensions.geography(Point, 4326) not null,
  depth_km                numeric(7,2),
  magnitude               numeric(4,2) not null check (magnitude between -3 and 10),
  magnitude_type          text,
  location_description    text,
  source_province         text,
  source_district         text,
  distance_to_trabzon_km  numeric(8,1) not null,
  in_trabzon_province     boolean not null default false,
  district_key            text references public.earthquake_regions (key) on delete set null,
  in_turkey_region        boolean not null default false,
  region_classification   text not null
                            check (region_classification in ('trabzon_province', 'trabzon_offshore', 'trabzon_vicinity', 'turkey', 'outside')),
  first_seen_at           timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  source_updated_at       timestamptz,
  revision                integer not null default 1,
  ingest_kind             text not null default 'live' check (ingest_kind in ('live', 'backfill')),
  status                  text not null default 'active'
                            check (status in ('active', 'under_review', 'pending_match', 'merged', 'removed')),
  merged_into             uuid references public.earthquake_events (id) on delete set null,
  notification_state      text not null default 'none'
                            check (notification_state in ('none', 'queued', 'sent', 'skipped')),
  notification_skip_reason text,
  notified_at             timestamptz,
  review_flagged_at       timestamptz,
  admin_note              text check (admin_note is null or char_length(admin_note) <= 2000),
  is_test                 boolean not null default false
);

create index if not exists earthquake_events_time_idx
  on public.earthquake_events (occurred_at desc) where status in ('active', 'under_review');
create index if not exists earthquake_events_distance_idx
  on public.earthquake_events (distance_to_trabzon_km, occurred_at desc) where status in ('active', 'under_review');
create index if not exists earthquake_events_province_idx
  on public.earthquake_events (district_key, occurred_at desc) where in_trabzon_province;
create index if not exists earthquake_events_turkey_idx
  on public.earthquake_events (occurred_at desc) where in_turkey_region;
create index if not exists earthquake_events_magnitude_idx
  on public.earthquake_events (magnitude desc, occurred_at desc);
create index if not exists earthquake_events_geog_idx on public.earthquake_events using gist (geog);
create index if not exists earthquake_events_match_idx on public.earthquake_events (occurred_at, magnitude);
create index if not exists earthquake_events_review_idx
  on public.earthquake_events (status, updated_at desc) where status in ('under_review', 'pending_match');

-- ---------------------------------------------------------------------------
-- 7. Kaynak kayıtları (her sağlayıcının kendi değerleri korunur)
-- ---------------------------------------------------------------------------
create table if not exists public.earthquake_source_records (
  id                    uuid primary key default gen_random_uuid(),
  earthquake_event_id   uuid not null references public.earthquake_events (id) on delete cascade,
  source_name           text not null references public.earthquake_sources (key),
  source_event_id       text not null check (char_length(source_event_id) between 1 and 64),
  source_magnitude      numeric(4,2) not null,
  source_magnitude_type text,
  source_depth_km       numeric(7,2),
  source_latitude       double precision not null,
  source_longitude      double precision not null,
  source_timestamp      timestamptz not null,
  source_location       text,
  source_province       text,
  source_district       text,
  source_neighborhood   text,
  source_country        text,
  source_rms            numeric(8,3),
  source_status         text,
  source_updated_at     timestamptz,
  source_url            text,
  raw_record_reference  text,
  raw_payload           jsonb,
  revision              integer not null default 1,
  match_method          text not null default 'origin' check (match_method in ('origin', 'auto', 'admin')),
  match_confidence      text check (match_confidence in ('high', 'manual')),
  match_dt_seconds      numeric(8,2),
  match_distance_km     numeric(8,1),
  match_magnitude_delta numeric(4,2),
  first_fetched_at      timestamptz not null default now(),
  last_fetched_at       timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (source_name, source_event_id)
);

create index if not exists earthquake_source_records_event_idx
  on public.earthquake_source_records (earthquake_event_id);
create index if not exists earthquake_source_records_fetched_idx
  on public.earthquake_source_records (source_name, last_fetched_at desc);

-- ---------------------------------------------------------------------------
-- 8. Revizyon geçmişi, eşleştirme incelemeleri, senkronizasyon, audit
-- ---------------------------------------------------------------------------
create table if not exists public.earthquake_event_revisions (
  id                   bigint generated always as identity primary key,
  earthquake_event_id  uuid not null references public.earthquake_events (id) on delete cascade,
  source_record_id     uuid references public.earthquake_source_records (id) on delete set null,
  source_name          text,
  revision             integer not null,
  change_kind          text not null check (change_kind in ('source_update', 'preferred_source', 'admin')),
  changes              jsonb not null,
  significant          boolean not null default false,
  created_at           timestamptz not null default now()
);

create index if not exists earthquake_event_revisions_event_idx
  on public.earthquake_event_revisions (earthquake_event_id, created_at desc);

create table if not exists public.earthquake_match_reviews (
  id                  uuid primary key default gen_random_uuid(),
  source_record_id    uuid not null references public.earthquake_source_records (id) on delete cascade,
  own_event_id        uuid not null references public.earthquake_events (id) on delete cascade,
  candidate_event_id  uuid not null references public.earthquake_events (id) on delete cascade,
  dt_seconds          numeric(8,2) not null,
  distance_km         numeric(8,1) not null,
  magnitude_delta     numeric(4,2) not null,
  candidate_count     integer not null,
  status              text not null default 'pending' check (status in ('pending', 'linked', 'rejected')),
  resolved_by         uuid references auth.users (id) on delete set null,
  resolved_at         timestamptz,
  resolution_note     text,
  created_at          timestamptz not null default now(),
  unique (source_record_id, candidate_event_id)
);

create index if not exists earthquake_match_reviews_pending_idx
  on public.earthquake_match_reviews (created_at desc) where status = 'pending';

create table if not exists public.earthquake_sync_logs (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,
  run_kind           text not null check (run_kind in ('scheduled', 'manual', 'sweep', 'backfill', 'test')),
  status             text not null check (status in ('running', 'success', 'partial', 'failed', 'skipped')),
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  window_start       timestamptz,
  window_end         timestamptz,
  http_status        integer,
  latency_ms         integer,
  attempts           integer not null default 1,
  records_received   integer not null default 0,
  records_valid      integer not null default 0,
  records_rejected   integer not null default 0,
  new_events         integer not null default 0,
  updated_records    integer not null default 0,
  unchanged_records  integer not null default 0,
  matched_records    integer not null default 0,
  review_records     integer not null default 0,
  notifications_queued integer not null default 0,
  error_code         text,
  error_message      text,
  errors             jsonb not null default '[]'::jsonb
);

create index if not exists earthquake_sync_logs_recent_idx on public.earthquake_sync_logs (started_at desc);
create index if not exists earthquake_sync_logs_provider_idx on public.earthquake_sync_logs (provider, started_at desc);

create table if not exists public.earthquake_admin_audit_logs (
  id          bigint generated always as identity primary key,
  admin_id    uuid references auth.users (id) on delete set null,
  operation   text not null,
  target_type text not null,
  target_id   text,
  reason      text,
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists earthquake_admin_audit_logs_recent_idx
  on public.earthquake_admin_audit_logs (created_at desc);

create table if not exists public.earthquake_event_views (
  earthquake_event_id uuid not null references public.earthquake_events (id) on delete cascade,
  view_date           date not null,
  views               integer not null default 0,
  primary key (earthquake_event_id, view_date)
);

-- Bildirim olayları: deprem başına tek "new", önemli büyüklük revizyonu başına
-- tek "revision". "test" kayıtları depreme bağlanmaz ve yalnızca admin
-- cihazlarına gider (0192).
create table if not exists public.earthquake_notification_events (
  id                   uuid primary key default gen_random_uuid(),
  earthquake_event_id  uuid references public.earthquake_events (id) on delete cascade,
  notification_type    text not null check (notification_type in ('new', 'revision', 'test')),
  revision_no          integer,
  old_magnitude        numeric(4,2),
  new_magnitude        numeric(4,2),
  priority             text not null default 'normal' check (priority in ('normal', 'high')),
  title                text,
  body                 text,
  route                text,
  data                 jsonb,
  processing_status    text not null default 'pending'
                         check (processing_status in ('pending', 'fanning_out', 'completed', 'skipped', 'failed', 'cancelled')),
  skip_reason          text,
  fanout_cursor        uuid,
  recipients           integer not null default 0,
  in_app_created       integer not null default 0,
  push_queued          integer not null default 0,
  push_suppressed      integer not null default 0,
  is_test              boolean not null default false,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  started_at           timestamptz,
  completed_at         timestamptz,
  constraint earthquake_notification_events_link check (
    (notification_type = 'test' and earthquake_event_id is null and is_test)
    or (notification_type <> 'test' and earthquake_event_id is not null and not is_test)
  )
);

create unique index if not exists earthquake_notification_events_new_uidx
  on public.earthquake_notification_events (earthquake_event_id) where notification_type = 'new';
create unique index if not exists earthquake_notification_events_revision_uidx
  on public.earthquake_notification_events (earthquake_event_id, revision_no) where notification_type = 'revision';
create index if not exists earthquake_notification_events_pending_idx
  on public.earthquake_notification_events (created_at) where processing_status in ('pending', 'fanning_out');
create index if not exists earthquake_notification_events_recent_idx
  on public.earthquake_notification_events (created_at desc);

-- ---------------------------------------------------------------------------
-- 9. RLS: istemciler tablolara doğrudan erişemez, yalnızca RPC kullanır.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'earthquake_settings', 'earthquake_sources', 'earthquake_regions', 'earthquake_events',
    'earthquake_source_records', 'earthquake_event_revisions', 'earthquake_match_reviews',
    'earthquake_sync_logs', 'earthquake_admin_audit_logs', 'earthquake_event_views',
    'earthquake_notification_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Yardımcılar
-- ---------------------------------------------------------------------------

-- Büyüklük türü yazımını sismolojik gösterime çevirir (MW → Mw, MB → mb).
create or replace function public.earthquake_magtype(p_raw text)
returns text
language sql
immutable
as $$
  select case upper(trim(coalesce(p_raw, '')))
    when '' then null
    when 'ML' then 'ML'
    when 'MW' then 'Mw'
    when 'MWW' then 'Mww'
    when 'MWR' then 'Mwr'
    when 'MWC' then 'Mwc'
    when 'MWB' then 'Mwb'
    when 'MB' then 'mb'
    when 'MB_LG' then 'mb_Lg'
    when 'MD' then 'Md'
    when 'MS' then 'Ms'
    when 'MS_20' then 'Ms_20'
    when 'MI' then 'Mi'
    when 'MWP' then 'Mwp'
    else left(trim(p_raw), 10)
  end
$$;

-- Türkçe ondalık gösterim: 2.4 → "2,4"
create or replace function public.earthquake_fmt_num(p_value numeric, p_digits integer default 1)
returns text
language sql
immutable
as $$
  select case when p_value is null then null
    else replace(to_char(round(p_value, p_digits), 'FM9990' || case when p_digits > 0 then '.' || repeat('0', p_digits) else '' end), '.', ',')
  end
$$;

-- Konumu sınıflandırır: Trabzon merkezine geodezik mesafe (km), il poligonu
-- içinde mi, hangi ilçe poligonunda (yoksa null — deniz açığı ilçeye atanmaz),
-- Türkiye ve çevresi kutusunda mı. OSM il sınırı karasularını da kapsar; il
-- poligonunda olup hiçbir ilçe poligonunda olmayan nokta "Trabzon açıkları"dır.
create or replace function public.earthquake_geo_classify(
  p_lat double precision,
  p_lng double precision,
  out distance_km numeric,
  out in_province boolean,
  out district_key text,
  out in_turkey boolean,
  out classification text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_pt geometry := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  v_center geography;
begin
  select ST_SetSRID(ST_MakePoint(s.center_lng, s.center_lat), 4326)::geography
    into v_center
    from public.earthquake_settings s
   where s.id = 1;

  distance_km := round((ST_Distance(v_pt::geography, v_center) / 1000.0)::numeric, 1);

  in_province := exists (
    select 1 from public.earthquake_regions r
     where r.kind = 'province' and r.key = 'trabzon' and r.geom is not null and ST_Covers(r.geom, v_pt)
  );

  district_key := null;
  if in_province then
    select r.key into district_key
      from public.earthquake_regions r
     where r.kind = 'district' and r.geom is not null and ST_Covers(r.geom, v_pt)
     order by r.area_km2 nulls last
     limit 1;
  end if;

  in_turkey := p_lat between 35.0 and 43.0 and p_lng between 25.0 and 45.5;

  classification := case
    when in_province and district_key is not null then 'trabzon_province'
    when in_province then 'trabzon_offshore'
    when distance_km <= 250 then 'trabzon_vicinity'
    when in_turkey then 'turkey'
    else 'outside'
  end;
end;
$$;

-- Merkez veya sınırlar değiştiğinde coğrafi alanları yeniden hesaplar.
create or replace function public.earthquake_reclassify_all()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  with g as (
    select e.id, c.*
      from public.earthquake_events e
      cross join lateral public.earthquake_geo_classify(e.latitude, e.longitude) c
  )
  update public.earthquake_events e
     set distance_to_trabzon_km = g.distance_km,
         in_trabzon_province = g.in_province,
         district_key = g.district_key,
         in_turkey_region = g.in_turkey,
         region_classification = g.classification
    from g
   where g.id = e.id
     and (e.distance_to_trabzon_km, e.in_trabzon_province, e.district_key, e.in_turkey_region, e.region_classification)
         is distinct from (g.distance_km, g.in_province, g.district_key, g.in_turkey, g.classification);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.earthquake_primary_source()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select key from public.earthquake_sources where is_primary limit 1), 'afad')
$$;

-- Açık oturumlara satır içeriği taşımadan "akış değişti" sinyali yollar.
create or replace function public.earthquake_broadcast(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(p_payload, 'earthquake_changed', 'earthquake-feed', false);
exception when others then
  null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Ingest (yalnızca service_role / edge function)
--
-- p_records: edge function'ın normalize ettiği kayıtlar:
--   { source_event_id, occurred_at (ISO, UTC), latitude, longitude, depth_km,
--     magnitude, magnitude_type, location, province, district, neighborhood,
--     country, rms, source_status, source_updated_at, url, raw }
-- Veritabanı her kaydı yeniden doğrular; geçersiz kayıt reddedilir, uydurma
-- değer üretilmez.
--
-- Eşleştirme (AFAD ↔ USGS): aday = |Δt| ≤ 30 sn, mesafe ≤ 100 km, |ΔM| ≤ 1,0.
-- Otomatik bağlama yalnızca tek aday ve |Δt| ≤ 10 sn, mesafe ≤ 50 km,
-- |ΔM| ≤ 0,7 iken yapılır. Diğer durumlar admin incelemesine düşer; bu sırada
-- ikincil kaynak kaydı listede gösterilmez (aynı deprem iki kez görünmez),
-- birincil kaynak kaydı hiçbir zaman gizlenmez.
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_ingest(
  p_provider      text,
  p_records       jsonb,
  p_run_kind      text default 'scheduled',
  p_window_start  timestamptz default null,
  p_window_end    timestamptz default null,
  p_http_status   integer default null,
  p_latency_ms    integer default null,
  p_received      integer default null,
  p_pre_rejected  integer default 0,
  p_errors        jsonb default '[]'::jsonb,
  p_sample        jsonb default null,
  p_attempts      integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.earthquake_settings;
  v_primary text := public.earthquake_primary_source();
  v_log uuid;
  v_live boolean := p_run_kind in ('scheduled', 'manual', 'sweep');
  v_rec jsonb;
  v_sid text;
  v_at timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_depth numeric;
  v_mag numeric;
  v_type text;
  v_loc text;
  v_upd timestamptz;
  v_url text;
  v_pt geography;
  v_src public.earthquake_source_records;
  v_evt public.earthquake_events;
  v_geo record;
  v_changes jsonb;
  v_sig boolean;
  v_cand record;
  v_best_id uuid;
  v_best_pref text;
  v_best_dt numeric;
  v_best_dist numeric;
  v_best_dmag numeric;
  v_cand_count integer;
  v_cands jsonb;
  v_event_id uuid;
  v_rec_id uuid;
  v_status text;
  v_canon text;
  v_state text;
  v_skip text;
  v_received integer := coalesce(p_received, jsonb_array_length(coalesce(p_records, '[]'::jsonb)));
  v_valid integer := 0;
  v_rejected integer := coalesce(p_pre_rejected, 0);
  v_new integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_matched integer := 0;
  v_review integer := 0;
  v_queued integer := 0;
  v_errors jsonb := coalesce(p_errors, '[]'::jsonb);
begin
  if p_provider is null or p_provider not in ('afad', 'usgs') then
    raise exception 'invalid_provider' using errcode = '22023';
  end if;
  if p_run_kind not in ('scheduled', 'manual', 'sweep', 'backfill', 'test') then
    raise exception 'invalid_run_kind' using errcode = '22023';
  end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_records) > 5000 then
    raise exception 'payload_too_large' using errcode = '22023';
  end if;

  select * into s from public.earthquake_settings where id = 1;

  insert into public.earthquake_sync_logs (provider, run_kind, status, window_start, window_end, http_status, latency_ms, attempts, records_received)
  values (p_provider, p_run_kind, 'running', p_window_start, p_window_end, p_http_status, p_latency_ms, greatest(coalesce(p_attempts, 1), 1), v_received)
  returning id into v_log;

  for v_rec in select value from jsonb_array_elements(p_records) loop
    begin
      v_sid := nullif(trim(v_rec->>'source_event_id'), '');
      if v_sid is null or char_length(v_sid) > 64 or v_sid !~ '^[A-Za-z0-9_.:-]+$' then
        raise exception 'invalid_event_id';
      end if;
      v_at := (v_rec->>'occurred_at')::timestamptz;
      if v_at is null or v_at > now() + interval '10 minutes' or v_at < timestamptz '1900-01-01 00:00:00+00' then
        raise exception 'invalid_time';
      end if;
      v_lat := (v_rec->>'latitude')::double precision;
      v_lng := (v_rec->>'longitude')::double precision;
      if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180
         or (v_lat = 0 and v_lng = 0) then
        raise exception 'invalid_coordinates';
      end if;
      v_mag := round((v_rec->>'magnitude')::numeric, 2);
      if v_mag is null or v_mag not between -3 and 10 then
        raise exception 'invalid_magnitude';
      end if;
      v_depth := case when nullif(v_rec->>'depth_km', '') is null then null else round((v_rec->>'depth_km')::numeric, 2) end;
      if v_depth is not null and v_depth not between -10 and 800 then
        raise exception 'invalid_depth';
      end if;
      v_type := nullif(left(trim(coalesce(v_rec->>'magnitude_type', '')), 10), '');
      v_loc := nullif(left(trim(coalesce(v_rec->>'location', '')), 240), '');
      v_upd := nullif(v_rec->>'source_updated_at', '')::timestamptz;
      v_url := nullif(v_rec->>'url', '');
      if v_url is not null and v_url !~ '^https://' then
        v_url := null;
      end if;
      v_pt := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;
      v_valid := v_valid + 1;

      select * into v_src
        from public.earthquake_source_records
       where source_name = p_provider and source_event_id = v_sid
       for update;

      if found then
        v_changes := '{}'::jsonb;
        if v_src.source_magnitude is distinct from v_mag then
          v_changes := v_changes || jsonb_build_object('magnitude', jsonb_build_object('old', v_src.source_magnitude, 'new', v_mag));
        end if;
        if v_src.source_magnitude_type is distinct from v_type then
          v_changes := v_changes || jsonb_build_object('magnitude_type', jsonb_build_object('old', v_src.source_magnitude_type, 'new', v_type));
        end if;
        if v_src.source_depth_km is distinct from v_depth then
          v_changes := v_changes || jsonb_build_object('depth_km', jsonb_build_object('old', v_src.source_depth_km, 'new', v_depth));
        end if;
        if v_src.source_latitude is distinct from v_lat or v_src.source_longitude is distinct from v_lng then
          v_changes := v_changes || jsonb_build_object('location',
            jsonb_build_object('old', jsonb_build_array(v_src.source_latitude, v_src.source_longitude),
                               'new', jsonb_build_array(v_lat, v_lng)));
        end if;
        if v_src.source_timestamp is distinct from v_at then
          v_changes := v_changes || jsonb_build_object('occurred_at', jsonb_build_object('old', v_src.source_timestamp, 'new', v_at));
        end if;
        if v_src.source_location is distinct from v_loc then
          v_changes := v_changes || jsonb_build_object('location_description', jsonb_build_object('old', v_src.source_location, 'new', v_loc));
        end if;

        if v_changes = '{}'::jsonb then
          update public.earthquake_source_records
             set last_fetched_at = now(),
                 source_updated_at = coalesce(v_upd, source_updated_at),
                 source_status = coalesce(nullif(v_rec->>'source_status', ''), source_status)
           where id = v_src.id;
          v_unchanged := v_unchanged + 1;
        else
          update public.earthquake_source_records
             set source_magnitude = v_mag,
                 source_magnitude_type = v_type,
                 source_depth_km = v_depth,
                 source_latitude = v_lat,
                 source_longitude = v_lng,
                 source_timestamp = v_at,
                 source_location = v_loc,
                 source_province = nullif(v_rec->>'province', ''),
                 source_district = nullif(v_rec->>'district', ''),
                 source_neighborhood = nullif(v_rec->>'neighborhood', ''),
                 source_country = nullif(v_rec->>'country', ''),
                 source_rms = nullif(v_rec->>'rms', '')::numeric,
                 source_status = nullif(v_rec->>'source_status', ''),
                 source_updated_at = v_upd,
                 source_url = coalesce(v_url, source_url),
                 raw_payload = v_rec->'raw',
                 revision = revision + 1,
                 last_fetched_at = now(),
                 updated_at = now()
           where id = v_src.id;

          select * into v_evt from public.earthquake_events where id = v_src.earthquake_event_id for update;

          v_sig := (v_changes ? 'magnitude' and abs(v_mag - v_src.source_magnitude) >= 0.1)
                or (v_changes ? 'magnitude_type')
                or (v_changes ? 'depth_km' and coalesce(abs(v_depth - v_src.source_depth_km), 99) >= 1)
                or (v_changes ? 'location' and ST_Distance(v_pt, ST_SetSRID(ST_MakePoint(v_src.source_longitude, v_src.source_latitude), 4326)::geography) >= 1000)
                or (v_changes ? 'occurred_at' and abs(extract(epoch from (v_at - v_src.source_timestamp))) >= 2);

          insert into public.earthquake_event_revisions
            (earthquake_event_id, source_record_id, source_name, revision, change_kind, changes, significant)
          values (v_evt.id, v_src.id, p_provider, v_src.revision + 1, 'source_update', v_changes, v_sig);

          if v_evt.preferred_source = p_provider then
            select * into v_geo from public.earthquake_geo_classify(v_lat, v_lng);
            update public.earthquake_events
               set occurred_at = v_at,
                   latitude = v_lat,
                   longitude = v_lng,
                   geog = v_pt,
                   depth_km = v_depth,
                   magnitude = v_mag,
                   magnitude_type = public.earthquake_magtype(v_type),
                   location_description = v_loc,
                   source_province = nullif(v_rec->>'province', ''),
                   source_district = nullif(v_rec->>'district', ''),
                   distance_to_trabzon_km = v_geo.distance_km,
                   in_trabzon_province = v_geo.in_province,
                   district_key = v_geo.district_key,
                   in_turkey_region = v_geo.in_turkey,
                   region_classification = v_geo.classification,
                   source_updated_at = v_upd,
                   revision = revision + 1,
                   updated_at = now()
             where id = v_evt.id;

            if v_live and s.notifications_enabled and v_evt.notification_state = 'sent'
               and v_changes ? 'magnitude'
               and abs(v_mag - v_evt.magnitude) >= s.revision_notify_min_delta then
              insert into public.earthquake_notification_events
                (earthquake_event_id, notification_type, revision_no, old_magnitude, new_magnitude)
              values (v_evt.id, 'revision', v_evt.revision + 1, v_evt.magnitude, v_mag)
              on conflict do nothing;
              if found then
                v_queued := v_queued + 1;
              end if;
            end if;
          end if;
          v_updated := v_updated + 1;
        end if;
      else
        v_cand_count := 0;
        v_cands := '[]'::jsonb;
        v_best_id := null;
        v_best_pref := null;
        v_best_dt := null;
        v_best_dist := null;
        v_best_dmag := null;
        for v_cand in
          select e.id,
                 e.preferred_source,
                 e.status,
                 abs(extract(epoch from (e.occurred_at - v_at)))::numeric as dt,
                 (ST_Distance(e.geog, v_pt) / 1000.0)::numeric as dist,
                 abs(e.magnitude - v_mag)::numeric as dmag
            from public.earthquake_events e
           where e.occurred_at between v_at - interval '30 seconds' and v_at + interval '30 seconds'
             and e.status in ('active', 'under_review', 'pending_match')
             and not (p_provider = any (e.sources))
             and e.is_test = false
             and ST_DWithin(e.geog, v_pt, 100000)
             and abs(e.magnitude - v_mag) <= 1.0
           order by abs(extract(epoch from (e.occurred_at - v_at))) + ST_Distance(e.geog, v_pt) / 10000.0
        loop
          v_cand_count := v_cand_count + 1;
          if v_cand_count = 1 then
            v_best_id := v_cand.id;
            v_best_pref := v_cand.preferred_source;
            v_best_dt := v_cand.dt;
            v_best_dist := v_cand.dist;
            v_best_dmag := v_cand.dmag;
          end if;
          v_cands := v_cands || jsonb_build_array(jsonb_build_object(
            'id', v_cand.id, 'dt', round(v_cand.dt, 2), 'dist', round(v_cand.dist, 1), 'dmag', round(v_cand.dmag, 2)));
        end loop;

        if v_cand_count = 1 and v_best_dt <= 10 and v_best_dist <= 50 and v_best_dmag <= 0.7 then
          insert into public.earthquake_source_records
            (earthquake_event_id, source_name, source_event_id, source_magnitude, source_magnitude_type, source_depth_km,
             source_latitude, source_longitude, source_timestamp, source_location, source_province, source_district,
             source_neighborhood, source_country, source_rms, source_status, source_updated_at, source_url,
             raw_record_reference, raw_payload, match_method, match_confidence, match_dt_seconds, match_distance_km,
             match_magnitude_delta)
          values
            (v_best_id, p_provider, v_sid, v_mag, v_type, v_depth, v_lat, v_lng, v_at, v_loc,
             nullif(v_rec->>'province', ''), nullif(v_rec->>'district', ''), nullif(v_rec->>'neighborhood', ''),
             nullif(v_rec->>'country', ''), nullif(v_rec->>'rms', '')::numeric, nullif(v_rec->>'source_status', ''),
             v_upd, v_url, p_provider || ':' || v_sid, v_rec->'raw', 'auto', 'high',
             round(v_best_dt, 2), round(v_best_dist, 1), round(v_best_dmag, 2))
          returning id into v_rec_id;

          update public.earthquake_events
             set sources = array_append(sources, p_provider),
                 status = case when status = 'pending_match' then 'active' else status end,
                 updated_at = now()
           where id = v_best_id;

          if p_provider = v_primary and v_best_pref <> p_provider then
            select * into v_evt from public.earthquake_events where id = v_best_id for update;
            select * into v_geo from public.earthquake_geo_classify(v_lat, v_lng);
            update public.earthquake_events
               set preferred_source = p_provider,
                   occurred_at = v_at,
                   latitude = v_lat,
                   longitude = v_lng,
                   geog = v_pt,
                   depth_km = v_depth,
                   magnitude = v_mag,
                   magnitude_type = public.earthquake_magtype(v_type),
                   location_description = v_loc,
                   source_province = nullif(v_rec->>'province', ''),
                   source_district = nullif(v_rec->>'district', ''),
                   distance_to_trabzon_km = v_geo.distance_km,
                   in_trabzon_province = v_geo.in_province,
                   district_key = v_geo.district_key,
                   in_turkey_region = v_geo.in_turkey,
                   region_classification = v_geo.classification,
                   source_updated_at = v_upd,
                   revision = revision + 1,
                   updated_at = now()
             where id = v_best_id;
            insert into public.earthquake_event_revisions
              (earthquake_event_id, source_record_id, source_name, revision, change_kind, changes, significant)
            values (v_best_id, v_rec_id, p_provider, v_evt.revision + 1, 'preferred_source',
              jsonb_build_object(
                'preferred_source', jsonb_build_object('old', v_evt.preferred_source, 'new', p_provider),
                'magnitude', jsonb_build_object('old', v_evt.magnitude, 'new', v_mag),
                'magnitude_type', jsonb_build_object('old', v_evt.magnitude_type, 'new', public.earthquake_magtype(v_type)),
                'depth_km', jsonb_build_object('old', v_evt.depth_km, 'new', v_depth)),
              false);
          end if;
          v_matched := v_matched + 1;
        else
          select * into v_geo from public.earthquake_geo_classify(v_lat, v_lng);
          v_status := 'active';
          if v_cand_count > 0 then
            if p_provider = v_primary then
              update public.earthquake_events
                 set status = 'pending_match', updated_at = now()
               where id in (select (c->>'id')::uuid from jsonb_array_elements(v_cands) c)
                 and status = 'active'
                 and preferred_source <> v_primary
                 and not (v_primary = any (sources));
            else
              v_status := 'pending_match';
            end if;
          end if;

          v_canon := p_provider || '-' || left(regexp_replace(lower(v_sid), '[^a-z0-9]', '', 'g'), 60);
          if v_canon = p_provider || '-' then
            raise exception 'invalid_event_id';
          end if;
          if exists (select 1 from public.earthquake_events where canonical_event_id = v_canon) then
            v_canon := left(v_canon, 50) || substr(md5(v_sid), 1, 8);
          end if;

          v_skip := case
            when not v_live then 'backfill'
            when v_status = 'pending_match' then 'pending_match'
            when v_geo.classification = 'outside' then 'outside_region'
            when now() - v_at > make_interval(mins => s.late_event_max_minutes) then 'late'
            when not s.notifications_enabled then 'disabled'
            else null
          end;
          v_state := case when v_skip is null then 'queued' else 'skipped' end;

          insert into public.earthquake_events
            (canonical_event_id, preferred_source, sources, occurred_at, latitude, longitude, geog, depth_km, magnitude,
             magnitude_type, location_description, source_province, source_district, distance_to_trabzon_km,
             in_trabzon_province, district_key, in_turkey_region, region_classification, source_updated_at,
             ingest_kind, status, notification_state, notification_skip_reason)
          values
            (v_canon, p_provider, array[p_provider], v_at, v_lat, v_lng, v_pt, v_depth, v_mag,
             public.earthquake_magtype(v_type), v_loc, nullif(v_rec->>'province', ''), nullif(v_rec->>'district', ''),
             v_geo.distance_km, v_geo.in_province, v_geo.district_key, v_geo.in_turkey, v_geo.classification, v_upd,
             case when v_live then 'live' else 'backfill' end, v_status, v_state, v_skip)
          returning id into v_event_id;

          insert into public.earthquake_source_records
            (earthquake_event_id, source_name, source_event_id, source_magnitude, source_magnitude_type, source_depth_km,
             source_latitude, source_longitude, source_timestamp, source_location, source_province, source_district,
             source_neighborhood, source_country, source_rms, source_status, source_updated_at, source_url,
             raw_record_reference, raw_payload)
          values
            (v_event_id, p_provider, v_sid, v_mag, v_type, v_depth, v_lat, v_lng, v_at, v_loc,
             nullif(v_rec->>'province', ''), nullif(v_rec->>'district', ''), nullif(v_rec->>'neighborhood', ''),
             nullif(v_rec->>'country', ''), nullif(v_rec->>'rms', '')::numeric, nullif(v_rec->>'source_status', ''),
             v_upd, v_url, p_provider || ':' || v_sid, v_rec->'raw')
          returning id into v_rec_id;

          if v_cand_count > 0 then
            insert into public.earthquake_match_reviews
              (source_record_id, own_event_id, candidate_event_id, dt_seconds, distance_km, magnitude_delta, candidate_count)
            select v_rec_id, v_event_id, (c->>'id')::uuid, (c->>'dt')::numeric, (c->>'dist')::numeric, (c->>'dmag')::numeric, v_cand_count
              from jsonb_array_elements(v_cands) c
            on conflict do nothing;
            v_review := v_review + 1;
          end if;

          if v_state = 'queued' then
            insert into public.earthquake_notification_events (earthquake_event_id, notification_type)
            values (v_event_id, 'new')
            on conflict do nothing;
            v_queued := v_queued + 1;
          end if;
          v_new := v_new + 1;
        end if;
      end if;
    exception when others then
      v_rejected := v_rejected + 1;
      if jsonb_array_length(v_errors) < 25 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'source_event_id', left(coalesce(v_rec->>'source_event_id', ''), 64),
          'reason', left(sqlerrm, 160)));
      end if;
    end;
  end loop;

  update public.earthquake_sources
     set last_attempt_at = now(),
         last_success_at = now(),
         health = case when is_enabled then 'healthy' else 'disabled' end,
         consecutive_failures = 0,
         next_retry_at = null,
         last_latency_ms = p_latency_ms,
         last_http_status = p_http_status,
         last_response_sample = case when p_sample is not null and octet_length(p_sample::text) <= 20000 then p_sample else last_response_sample end,
         last_response_meta = jsonb_build_object(
           'received', v_received, 'valid', v_valid, 'rejected', v_rejected,
           'window_start', p_window_start, 'window_end', p_window_end, 'run_kind', p_run_kind, 'at', now()),
         updated_at = now()
   where key = p_provider;

  update public.earthquake_sync_logs
     set status = case when v_rejected > 0 and v_valid = 0 and v_received > 0 then 'failed'
                       when v_rejected > 0 then 'partial'
                       else 'success' end,
         completed_at = now(),
         records_valid = v_valid,
         records_rejected = v_rejected,
         new_events = v_new,
         updated_records = v_updated,
         unchanged_records = v_unchanged,
         matched_records = v_matched,
         review_records = v_review,
         notifications_queued = v_queued,
         errors = v_errors
   where id = v_log;

  if v_new + v_updated + v_matched > 0 then
    perform public.earthquake_broadcast(jsonb_build_object('new', v_new, 'updated', v_updated + v_matched, 'at', now()));
  end if;

  return jsonb_build_object(
    'log_id', v_log, 'received', v_received, 'valid', v_valid, 'rejected', v_rejected,
    'new', v_new, 'updated', v_updated, 'unchanged', v_unchanged, 'matched', v_matched,
    'review', v_review, 'notifications_queued', v_queued);
end;
$$;

-- Kaynak hatası: veri yazılmaz, sağlık durumu ve geri çekilme süresi güncellenir.
create or replace function public.earthquake_provider_failure(
  p_provider     text,
  p_run_kind     text,
  p_error_code   text,
  p_message      text default null,
  p_http_status  integer default null,
  p_latency_ms   integer default null,
  p_attempts     integer default 1,
  p_window_start timestamptz default null,
  p_window_end   timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_failures integer;
  v_retry timestamptz;
begin
  if p_provider not in ('afad', 'usgs') then
    raise exception 'invalid_provider' using errcode = '22023';
  end if;

  update public.earthquake_sources
     set consecutive_failures = consecutive_failures + 1,
         last_attempt_at = now(),
         last_error_code = left(coalesce(p_error_code, 'unknown'), 60),
         last_error_message = left(coalesce(p_message, ''), 500),
         last_error_at = now(),
         last_http_status = p_http_status,
         last_latency_ms = p_latency_ms,
         health = case when not is_enabled then 'disabled'
                       when consecutive_failures + 1 >= 3 then 'down'
                       else 'degraded' end,
         next_retry_at = now() + least(interval '15 minutes', make_interval(secs => 30 * power(2, least(consecutive_failures, 5))::integer)),
         updated_at = now()
   where key = p_provider
   returning consecutive_failures, next_retry_at into v_failures, v_retry;

  insert into public.earthquake_sync_logs
    (provider, run_kind, status, completed_at, window_start, window_end, http_status, latency_ms, attempts, error_code, error_message)
  values
    (p_provider, coalesce(p_run_kind, 'scheduled'), 'failed', now(), p_window_start, p_window_end, p_http_status,
     p_latency_ms, greatest(coalesce(p_attempts, 1), 1), left(coalesce(p_error_code, 'unknown'), 60), left(coalesce(p_message, ''), 500));

  return jsonb_build_object('consecutive_failures', v_failures, 'next_retry_at', v_retry);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Herkese açık okuma (anon + authenticated)
-- ---------------------------------------------------------------------------

create or replace function public.earthquake_resolve_region(p_region text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_region text := coalesce(nullif(p_region, ''), (select default_region from public.earthquake_settings where id = 1), 'r150');
begin
  if v_region not in ('province', 'r50', 'r100', 'r150', 'r250', 'turkey') then
    raise exception 'invalid_region' using errcode = '22023';
  end if;
  if v_region = 'turkey' and not coalesce((select turkey_enabled from public.earthquake_settings where id = 1), false) then
    raise exception 'region_disabled' using errcode = '22023';
  end if;
  return v_region;
end;
$$;

create or replace function public.earthquake_filtered(
  p_region    text,
  p_district  text,
  p_from      timestamptz,
  p_to        timestamptz,
  p_min_mag   numeric,
  p_max_mag   numeric,
  p_min_depth numeric,
  p_max_depth numeric,
  p_source    text
)
returns setof public.earthquake_events
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.*
    from public.earthquake_events e
   where e.status in ('active', 'under_review')
     and e.is_test = false
     and (p_from is null or e.occurred_at >= p_from)
     and (p_to is null or e.occurred_at < p_to)
     and case p_region
           when 'province' then e.in_trabzon_province
           when 'turkey' then e.in_turkey_region
           when 'r50' then e.distance_to_trabzon_km <= 50
           when 'r100' then e.distance_to_trabzon_km <= 100
           when 'r250' then e.distance_to_trabzon_km <= 250
           else e.distance_to_trabzon_km <= 150
         end
     and (p_district is null or e.district_key = p_district)
     and (p_min_mag is null or e.magnitude >= p_min_mag)
     and (p_max_mag is null or e.magnitude < p_max_mag)
     and (p_min_depth is null or e.depth_km >= p_min_depth)
     and (p_max_depth is null or e.depth_km < p_max_depth)
     and (coalesce(p_source, 'all') = 'all' or p_source = any (e.sources))
$$;

create or replace function public.earthquake_event_json(e public.earthquake_events)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.canonical_event_id,
    'occurred_at', e.occurred_at,
    'latitude', e.latitude,
    'longitude', e.longitude,
    'depth_km', e.depth_km,
    'magnitude', e.magnitude,
    'magnitude_type', e.magnitude_type,
    'location', e.location_description,
    'distance_km', e.distance_to_trabzon_km,
    'in_province', e.in_trabzon_province,
    'district_key', e.district_key,
    'district_name', (select r.name from public.earthquake_regions r where r.key = e.district_key),
    'region_classification', e.region_classification,
    'source', e.preferred_source,
    'sources', to_jsonb(e.sources),
    'revision', e.revision,
    'updated_at', e.updated_at,
    'first_seen_at', e.first_seen_at
  )
$$;

-- Veri durumu: "Canlı" yalnızca birincil kaynak son stale_after_seconds içinde
-- başarıyla okunduysa döner. Hiç başarılı senkron yoksa "unavailable".
create or replace function public.earthquake_status_json()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.earthquake_settings;
  v_primary public.earthquake_sources;
  v_any_fresh boolean;
  v_ever boolean;
  v_last timestamptz;
  v_state text;
begin
  select * into s from public.earthquake_settings where id = 1;
  select * into v_primary from public.earthquake_sources where is_primary limit 1;
  select bool_or(last_success_at > now() - make_interval(secs => s.stale_after_seconds)),
         bool_or(last_success_at is not null),
         max(last_success_at)
    into v_any_fresh, v_ever, v_last
    from public.earthquake_sources
   where is_enabled;

  v_state := case
    when not coalesce(v_ever, false) then 'unavailable'
    when v_primary.is_enabled and v_primary.last_success_at > now() - make_interval(secs => s.stale_after_seconds) then 'live'
    when coalesce(v_any_fresh, false) then 'fallback'
    else 'delayed'
  end;

  return jsonb_build_object(
    'state', v_state,
    'primary_source', v_primary.key,
    'primary_last_success_at', v_primary.last_success_at,
    'last_success_at', v_last,
    'stale_after_seconds', s.stale_after_seconds,
    'sync_interval_seconds', s.sync_interval_seconds,
    'checked_at', now()
  );
end;
$$;

create or replace function public.earthquake_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.earthquake_settings;
begin
  select * into s from public.earthquake_settings where id = 1;
  return jsonb_build_object(
    'settings', jsonb_build_object(
      'center', jsonb_build_object('lat', s.center_lat, 'lng', s.center_lng, 'label', s.center_label),
      'default_region', s.default_region,
      'radius_options', to_jsonb(s.radius_options),
      'turkey_enabled', s.turkey_enabled,
      'district_filter_enabled', s.district_filter_enabled,
      'default_range_days', s.default_range_days,
      'map_default_zoom', s.map_default_zoom,
      'map_layers', s.map_layers,
      'chart_max_points', s.chart_max_points
    ),
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name) order by r.name)
        from public.earthquake_regions r where r.kind = 'district'
    ), '[]'::jsonb),
    'province_ring', (select r.display_ring from public.earthquake_regions r where r.key = 'trabzon'),
    'boundary_attribution', '© OpenStreetMap katkıda bulunanlar (ODbL)',
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', x.key, 'name', x.name, 'homepage_url', x.homepage_url, 'attribution', x.attribution,
        'is_enabled', x.is_enabled, 'is_primary', x.is_primary, 'health', x.health,
        'last_success_at', x.last_success_at, 'last_attempt_at', x.last_attempt_at
      ) order by x.is_primary desc, x.key)
        from public.earthquake_sources x
    ), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'afad_since', (select min(r.source_timestamp) from public.earthquake_source_records r where r.source_name = 'afad'),
      'usgs_since', (select min(r.source_timestamp) from public.earthquake_source_records r where r.source_name = 'usgs'),
      'archive_since', (select min(e.occurred_at) from public.earthquake_events e where e.status in ('active', 'under_review'))
    ),
    'status', public.earthquake_status_json()
  );
end;
$$;

create or replace function public.earthquake_region_shape(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('key', r.key, 'name', r.name, 'kind', r.kind, 'ring', r.display_ring, 'area_km2', r.area_km2)
       from public.earthquake_regions r where r.key = p_key),
    jsonb_build_object('key', p_key, 'ring', null)
  )
$$;

create or replace function public.earthquake_overview(
  p_region   text default null,
  p_district text default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_min_mag  numeric default null,
  p_max_mag  numeric default null,
  p_source   text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_region text := public.earthquake_resolve_region(p_region);
  v_days integer := coalesce((select default_range_days from public.earthquake_settings where id = 1), 7);
  v_from timestamptz := coalesce(p_from, now() - make_interval(days => v_days));
  v_to timestamptz := coalesce(p_to, now() + interval '1 minute');
  v_24h integer;
  v_range integer;
  v_max public.earthquake_events;
  v_latest public.earthquake_events;
begin
  if v_to <= v_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  select count(*) into v_24h
    from public.earthquake_filtered(v_region, p_district, now() - interval '24 hours', null, p_min_mag, p_max_mag, null, null, p_source);
  select count(*) into v_range
    from public.earthquake_filtered(v_region, p_district, v_from, v_to, p_min_mag, p_max_mag, null, null, p_source);
  select * into v_max
    from public.earthquake_filtered(v_region, p_district, v_from, v_to, p_min_mag, p_max_mag, null, null, p_source) f
   order by f.magnitude desc, f.occurred_at desc
   limit 1;
  select * into v_latest
    from public.earthquake_filtered(v_region, p_district, null, null, p_min_mag, p_max_mag, null, null, p_source) f
   order by f.occurred_at desc
   limit 1;

  return jsonb_build_object(
    'region', v_region,
    'district', p_district,
    'from', v_from,
    'to', v_to,
    'count_24h', v_24h,
    'count_range', v_range,
    'max_event', case when v_max.id is null then null else public.earthquake_event_json(v_max) end,
    'latest_event', case when v_latest.id is null then null else public.earthquake_event_json(v_latest) end,
    'status', public.earthquake_status_json()
  );
end;
$$;

create or replace function public.earthquake_feed(
  p_region    text default null,
  p_district  text default null,
  p_from      timestamptz default null,
  p_to        timestamptz default null,
  p_min_mag   numeric default null,
  p_max_mag   numeric default null,
  p_min_depth numeric default null,
  p_max_depth numeric default null,
  p_source    text default 'all',
  p_order     text default 'newest',
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_region text := public.earthquake_resolve_region(p_region);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_total integer;
  v_items jsonb;
begin
  if p_order not in ('newest', 'oldest', 'largest', 'nearest') then
    raise exception 'invalid_order' using errcode = '22023';
  end if;
  if p_source is not null and p_source not in ('all', 'afad', 'usgs') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_to <= p_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.earthquake_filtered(v_region, p_district, p_from, p_to, p_min_mag, p_max_mag, p_min_depth, p_max_depth, p_source);

  select coalesce(jsonb_agg(public.earthquake_event_json(x) order by x.ord), '[]'::jsonb)
    into v_items
    from (
      select f, row_number() over (order by
               case when p_order = 'largest' then f.magnitude end desc nulls last,
               case when p_order = 'nearest' then f.distance_to_trabzon_km end asc nulls last,
               case when p_order = 'oldest' then f.occurred_at end asc,
               f.occurred_at desc) as ord
        from public.earthquake_filtered(v_region, p_district, p_from, p_to, p_min_mag, p_max_mag, p_min_depth, p_max_depth, p_source) f
       order by ord
       limit v_limit offset v_offset
    ) q(x, ord);

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', v_offset + v_limit < v_total,
    'region', v_region
  );
end;
$$;

create or replace function public.earthquake_map(
  p_region   text default null,
  p_district text default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_min_mag  numeric default null,
  p_max_mag  numeric default null,
  p_source   text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_region text := public.earthquake_resolve_region(p_region);
  v_days integer := coalesce((select default_range_days from public.earthquake_settings where id = 1), 7);
  v_from timestamptz := coalesce(p_from, now() - make_interval(days => v_days));
  v_cap integer := 2000;
  v_total integer;
  v_points jsonb;
begin
  select count(*) into v_total
    from public.earthquake_filtered(v_region, p_district, v_from, p_to, p_min_mag, p_max_mag, null, null, p_source);

  select coalesce(jsonb_agg(jsonb_build_array(
           f.canonical_event_id, f.latitude, f.longitude, f.magnitude, f.magnitude_type,
           f.occurred_at, f.depth_km, f.preferred_source, f.location_description, f.distance_to_trabzon_km)
         order by f.occurred_at desc), '[]'::jsonb)
    into v_points
    from (
      select * from public.earthquake_filtered(v_region, p_district, v_from, p_to, p_min_mag, p_max_mag, null, null, p_source) x
       order by x.occurred_at desc
       limit v_cap
    ) f;

  return jsonb_build_object(
    'fields', jsonb_build_array('id', 'lat', 'lng', 'magnitude', 'magnitude_type', 'occurred_at', 'depth_km', 'source', 'location', 'distance_km'),
    'points', v_points,
    'total', v_total,
    'truncated', v_total > v_cap,
    'region', v_region
  );
end;
$$;

create or replace function public.earthquake_analytics(
  p_region   text default null,
  p_district text default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_min_mag  numeric default null,
  p_max_mag  numeric default null,
  p_source   text default 'all',
  p_bucket   text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_region text := public.earthquake_resolve_region(p_region);
  v_to timestamptz := coalesce(p_to, now());
  v_from timestamptz := coalesce(p_from, v_to - interval '7 days');
  v_cap integer := coalesce((select chart_max_points from public.earthquake_settings where id = 1), 1500);
  v_bucket text;
  v_step interval;
  v_cell numeric := case when v_region in ('turkey', 'r250') then 0.25 else 0.1 end;
  v_total integer;
  v_series jsonb;
  v_mag jsonb;
  v_depth jsonb;
  v_points jsonb;
  v_grid jsonb;
  v_unknown_depth integer;
begin
  if v_to <= v_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if v_to - v_from > interval '3660 days' then
    raise exception 'range_too_large' using errcode = '22023';
  end if;

  v_bucket := coalesce(p_bucket, case
    when v_to - v_from <= interval '3 days' then 'hour'
    when v_to - v_from <= interval '400 days' then 'day'
    else 'week' end);
  if v_bucket not in ('hour', 'day', 'week') then
    raise exception 'invalid_bucket' using errcode = '22023';
  end if;
  if v_bucket = 'hour' and v_to - v_from > interval '31 days' then
    v_bucket := 'day';
  end if;
  v_step := case v_bucket when 'hour' then interval '1 hour' when 'day' then interval '1 day' else interval '7 days' end;

  with r as materialized (
    select f.canonical_event_id as id, f.occurred_at, f.magnitude, f.magnitude_type, f.depth_km, f.latitude, f.longitude,
           date_trunc(v_bucket, f.occurred_at at time zone 'Europe/Istanbul') as t
      from public.earthquake_filtered(v_region, p_district, v_from, v_to, p_min_mag, p_max_mag, null, null, p_source) f
  ),
  b as (
    select gs as t
      from generate_series(
        date_trunc(v_bucket, v_from at time zone 'Europe/Istanbul'),
        date_trunc(v_bucket, v_to at time zone 'Europe/Istanbul'),
        v_step) gs
  ),
  c as (
    select r.t, count(*) as n, max(r.magnitude) as m from r group by r.t
  ),
  mag_bins(key, label, lo, hi, ord) as (
    values ('neg', '0 altı', -10::numeric, 0::numeric, 0),
           ('m0', '0–1,9', 0, 2, 1),
           ('m2', '2,0–2,9', 2, 3, 2),
           ('m3', '3,0–3,9', 3, 4, 3),
           ('m4', '4,0–4,9', 4, 5, 4),
           ('m5', '5,0+', 5, 11, 5)
  ),
  depth_bins(key, label, lo, hi, ord) as (
    values ('d0', '0–5 km', 0::numeric, 5::numeric, 1),
           ('d5', '5–10 km', 5, 10, 2),
           ('d10', '10–30 km', 10, 30, 3),
           ('d30', '30–70 km', 30, 70, 4),
           ('d70', '70 km+', 70, 10000, 5)
  ),
  g as (
    select round((floor(r.latitude / v_cell) * v_cell + v_cell / 2)::numeric, 3) as lat,
           round((floor(r.longitude / v_cell) * v_cell + v_cell / 2)::numeric, 3) as lng,
           count(*) as n, max(r.magnitude) as m
      from r
     group by 1, 2
     order by 3 desc
     limit 400
  )
  select
    (select count(*) from r),
    (select coalesce(jsonb_agg(jsonb_build_object(
              't', (b.t at time zone 'Europe/Istanbul'), 'count', coalesce(c.n, 0), 'max_magnitude', c.m) order by b.t), '[]'::jsonb)
       from b left join c on c.t = b.t),
    (select jsonb_agg(jsonb_build_object('key', mb.key, 'label', mb.label,
              'count', (select count(*) from r where r.magnitude >= mb.lo and r.magnitude < mb.hi)) order by mb.ord)
       from mag_bins mb
      where mb.key <> 'neg' or exists (select 1 from r where r.magnitude < 0)),
    (select jsonb_agg(jsonb_build_object('key', db.key, 'label', db.label,
              'count', (select count(*) from r where greatest(r.depth_km, 0) >= db.lo and greatest(r.depth_km, 0) < db.hi)) order by db.ord)
       from depth_bins db),
    (select count(*) from r where r.depth_km is null),
    (select coalesce(jsonb_agg(jsonb_build_array(p.id, p.occurred_at, p.magnitude, p.depth_km, p.magnitude_type) order by p.occurred_at), '[]'::jsonb)
       from (select * from r order by r.occurred_at desc limit v_cap) p),
    (select coalesce(jsonb_agg(jsonb_build_object('lat', g.lat, 'lng', g.lng, 'count', g.n, 'max_magnitude', g.m) order by g.n desc), '[]'::jsonb)
       from g)
  into v_total, v_series, v_mag, v_depth, v_unknown_depth, v_points, v_grid;

  return jsonb_build_object(
    'region', v_region,
    'from', v_from,
    'to', v_to,
    'bucket', v_bucket,
    'total', v_total,
    'series', v_series,
    'magnitude_bins', coalesce(v_mag, '[]'::jsonb),
    'depth_bins', coalesce(v_depth, '[]'::jsonb),
    'unknown_depth', v_unknown_depth,
    'points_fields', jsonb_build_array('id', 'occurred_at', 'magnitude', 'depth_km', 'magnitude_type'),
    'points', v_points,
    'points_truncated', v_total > v_cap,
    'grid_cell_deg', v_cell,
    'grid', v_grid
  );
end;
$$;

-- Ayrıntı: kanonik kimlik veya kaynak takma adı (afad-597442 / usgs-us6000…)
-- ile çalışır. Birleştirilmiş kayıt hedefe yönlenir; kaldırılmış kayıt hata verir.
create or replace function public.earthquake_resolve_key(p_key text)
returns public.earthquake_events
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := lower(trim(coalesce(p_key, '')));
  v_evt public.earthquake_events;
  v_hops integer := 0;
begin
  if v_key !~ '^(afad|usgs)-[a-z0-9]{1,60}$' then
    raise exception 'earthquake_not_found' using errcode = 'P0002';
  end if;

  select * into v_evt from public.earthquake_events where canonical_event_id = v_key and is_test = false;
  if not found then
    select e.* into v_evt
      from public.earthquake_source_records r
      join public.earthquake_events e on e.id = r.earthquake_event_id
     where r.source_name = split_part(v_key, '-', 1)
       and lower(regexp_replace(r.source_event_id, '[^A-Za-z0-9]', '', 'g')) = substr(v_key, position('-' in v_key) + 1)
       and e.is_test = false
     limit 1;
  end if;
  if v_evt.id is null then
    raise exception 'earthquake_not_found' using errcode = 'P0002';
  end if;

  while v_evt.status = 'merged' and v_evt.merged_into is not null and v_hops < 5 loop
    select * into v_evt from public.earthquake_events where id = v_evt.merged_into;
    v_hops := v_hops + 1;
  end loop;

  if v_evt.status = 'removed' then
    raise exception 'earthquake_removed' using errcode = 'P0002';
  end if;
  if v_evt.status = 'merged' then
    raise exception 'earthquake_not_found' using errcode = 'P0002';
  end if;
  return v_evt;
end;
$$;

create or replace function public.earthquake_detail(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_evt public.earthquake_events := public.earthquake_resolve_key(p_key);
begin
  return public.earthquake_event_json(v_evt) || jsonb_build_object(
    'requested_key', lower(trim(p_key)),
    'status', case when v_evt.status = 'pending_match' then 'pending_match' else 'active' end,
    'source_updated_at', v_evt.source_updated_at,
    'source_province', v_evt.source_province,
    'source_district', v_evt.source_district,
    'records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', r.source_name,
        'source_event_id', r.source_event_id,
        'magnitude', r.source_magnitude,
        'magnitude_type', public.earthquake_magtype(r.source_magnitude_type),
        'depth_km', r.source_depth_km,
        'latitude', r.source_latitude,
        'longitude', r.source_longitude,
        'occurred_at', r.source_timestamp,
        'location', r.source_location,
        'status', r.source_status,
        'source_updated_at', r.source_updated_at,
        'url', r.source_url,
        'revision', r.revision,
        'match_method', r.match_method,
        'match_distance_km', r.match_distance_km,
        'match_dt_seconds', r.match_dt_seconds,
        'last_fetched_at', r.last_fetched_at
      ) order by (r.source_name = v_evt.preferred_source) desc, r.source_name)
        from public.earthquake_source_records r
       where r.earthquake_event_id = v_evt.id
    ), '[]'::jsonb),
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', v.source_name, 'revision', v.revision, 'kind', v.change_kind,
        'changes', v.changes, 'significant', v.significant, 'created_at', v.created_at
      ) order by v.created_at desc)
        from (select * from public.earthquake_event_revisions
               where earthquake_event_id = v_evt.id and change_kind <> 'admin'
               order by created_at desc limit 20) v
    ), '[]'::jsonb),
    'attribution', (select string_agg(x.attribution, ' · ' order by x.is_primary desc)
                      from public.earthquake_sources x where x.key = any (v_evt.sources))
  );
end;
$$;

create or replace function public.earthquake_share_card(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_evt public.earthquake_events := public.earthquake_resolve_key(p_key);
  v_where text;
begin
  v_where := case
    when v_evt.in_trabzon_province then 'Trabzon il sınırları içinde'
    when v_evt.distance_to_trabzon_km <= 250 then 'Trabzon''a ' || public.earthquake_fmt_num(v_evt.distance_to_trabzon_km, 0) || ' km uzaklıkta'
    else coalesce(v_evt.location_description, 'Türkiye ve çevresinde')
  end;
  return jsonb_build_object(
    'type', 'earthquake',
    'key', v_evt.canonical_event_id,
    'title', coalesce(v_evt.magnitude_type || ' ', '') || public.earthquake_fmt_num(v_evt.magnitude, 1) || ' büyüklüğünde deprem',
    'description', v_where || ' · ' || to_char(v_evt.occurred_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') || ' (TSİ)'
                   || coalesce(' · Derinlik ' || public.earthquake_fmt_num(v_evt.depth_km, 1) || ' km', '')
                   || ' · Kaynak: ' || upper(v_evt.preferred_source),
    'location', v_evt.location_description,
    'path', '/deprem/' || v_evt.canonical_event_id,
    'occurred_at', v_evt.occurred_at,
    'magnitude', v_evt.magnitude,
    'magnitude_type', v_evt.magnitude_type,
    'depth_km', v_evt.depth_km,
    'latitude', v_evt.latitude,
    'longitude', v_evt.longitude,
    'source', v_evt.preferred_source,
    'updated_at', v_evt.updated_at
  );
end;
$$;

create or replace function public.earthquake_track_view(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evt public.earthquake_events;
begin
  begin
    v_evt := public.earthquake_resolve_key(p_key);
  exception when others then
    return;
  end;
  insert into public.earthquake_event_views (earthquake_event_id, view_date, views)
  values (v_evt.id, (now() at time zone 'Europe/Istanbul')::date, 1)
  on conflict (earthquake_event_id, view_date) do update set views = public.earthquake_event_views.views + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Yetkiler (fonksiyonlar)
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'earthquake\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if fn.proname in ('earthquake_bootstrap', 'earthquake_overview', 'earthquake_feed', 'earthquake_map',
                      'earthquake_analytics', 'earthquake_detail', 'earthquake_share_card',
                      'earthquake_track_view', 'earthquake_region_shape') then
      execute format('grant execute on function %s to anon, authenticated', fn.sig);
    end if;
    if fn.proname in ('earthquake_ingest', 'earthquake_provider_failure') then
      execute format('grant execute on function %s to service_role', fn.sig);
    end if;
  end loop;
end $$;
