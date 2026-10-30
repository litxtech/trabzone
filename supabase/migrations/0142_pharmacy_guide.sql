-- ---------------------------------------------------------------------------
-- 0139 — Premium Eczane Rehberi ve Canlı Nöbetçi Eczane Sistemi
--
-- Tasarım ilkeleri
--   1. Eczane envanteri mevcut `places` kayıtlarıdır (kategori: eczane).
--      Aynı işletme için ikinci bir kimlik tablosu oluşturulmaz; eczaneye özel
--      alanlar 1:1 `pharmacy_profiles` tablosunda tutulur.
--   2. Yorum altyapısı `place_reviews` / `place_review_votes` /
--      `content_reports` üzerinden yeniden kullanılır. Sahte yorum koruması
--      (kullanıcı başına tek yorum, 10 sn hız limiti) zaten oradadır.
--   3. Nöbet verisi yalnızca yetkili kaynaklardan gelir. Tablo boşken arayüz
--      "nöbet verisi yok" der; hiçbir eczane adı, saat veya koordinat
--      uydurulmaz.
--   4. Bütün nöbet hesapları Europe/Istanbul saat diliminde yapılır ve gece
--      yarısını aşan nöbetler (18:00 → 08:00) doğru taşınır.
--   5. Kaynak güncellenmezse eski liste "bugünün kesin listesi" olarak
--      gösterilmez; tazelik eşiği aşıldığında `stale` işaretlenir.
-- ---------------------------------------------------------------------------

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. İzin kataloğu
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr) values
  ('pharmacy.view',     'Eczane envanteri, nöbet listeleri ve veri kaynaklarını görüntüleme'),
  ('pharmacy.manage',   'Eczane kaydı, nöbet verisi, veri kaynağı ve senkronizasyon yönetimi'),
  ('pharmacy.moderate', 'Eczane yorumları, şikâyetleri ve sahiplenme talepleri moderasyonu'),
  ('pharmacy.notify',   'Eczane nöbet duyurusu ve bildirim gönderimi')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'pharmacy.view'), ('admin', 'pharmacy.manage'), ('admin', 'pharmacy.moderate'), ('admin', 'pharmacy.notify'),
  ('map_manager', 'pharmacy.view'), ('map_manager', 'pharmacy.manage'), ('map_manager', 'pharmacy.notify'),
  ('moderator', 'pharmacy.view'), ('moderator', 'pharmacy.moderate'),
  ('support_agent', 'pharmacy.view'),
  ('analyst', 'pharmacy.view'),
  ('security_officer', 'pharmacy.view')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Ayarlar (tek satır)
-- ---------------------------------------------------------------------------
create table if not exists public.pharmacy_settings (
  id                     smallint primary key default 1,
  timezone               text not null default 'Europe/Istanbul',
  -- Kaynak yalnızca tarih verip saat vermiyorsa kullanılan varsayılanlar.
  -- Bu değerlerle üretilen nöbet kayıtları 'confirmed' olamaz.
  default_duty_start     time not null default '18:00',
  default_duty_end       time not null default '08:00',
  stale_after_hours      integer not null default 18,
  default_notify_hour    smallint not null default 9,
  notifications_enabled  boolean not null default false,
  require_verified_duty  boolean not null default true,
  guide_intro            text,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles (id) on delete set null,
  constraint pharmacy_settings_singleton check (id = 1),
  constraint pharmacy_settings_tz check (timezone = 'Europe/Istanbul'),
  constraint pharmacy_settings_stale check (stale_after_hours between 1 and 168),
  constraint pharmacy_settings_hour check (default_notify_hour between 0 and 23)
);

insert into public.pharmacy_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Veri kaynakları
--
-- API anahtarı bu tabloda TUTULMAZ. `api_secret_ref` yalnızca sunucu
-- ortamındaki ortam değişkeninin adıdır (örn. COLLECTAPI_KEY).
-- `verified_license` false ise zamanlanmış senkronizasyon çalışmaz.
-- ---------------------------------------------------------------------------
create table if not exists public.pharmacy_sources (
  id                    uuid primary key default gen_random_uuid(),
  key                   text not null unique,
  name                  text not null,
  kind                  text not null default 'manual',
  homepage_url          text,
  terms_url             text,
  license_note          text,
  attribution_text      text,
  api_secret_ref        text,
  field_map             jsonb not null default '{}'::jsonb,
  is_primary            boolean not null default false,
  is_enabled            boolean not null default false,
  priority              smallint not null default 100,
  sync_interval_minutes integer not null default 60,
  verified_license      boolean not null default false,
  last_run_at           timestamptz,
  last_success_at       timestamptz,
  last_error            text,
  last_error_at         timestamptz,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint pharmacy_sources_kind check (
    kind in ('official_portal', 'official_api', 'commercial_api', 'manual', 'partner')
  ),
  constraint pharmacy_sources_priority check (priority between 1 and 999),
  constraint pharmacy_sources_interval check (sync_interval_minutes between 5 and 1440),
  constraint pharmacy_sources_secret_ref check (
    api_secret_ref is null or api_secret_ref ~ '^[A-Z][A-Z0-9_]{2,63}$'
  )
);

create unique index if not exists pharmacy_sources_one_primary_idx
  on public.pharmacy_sources ((is_primary)) where is_primary;

insert into public.pharmacy_sources (key, name, kind, homepage_url, terms_url, license_note, attribution_text, is_enabled, priority, verified_license) values
  ('teob', 'Trabzon Eczacı Odası nöbet listesi', 'official_portal',
   'https://www.trabzoneczaciodasi.org.tr/nobetci-eczaneler', null,
   'Kamuya açık liste. Otomatik çekme ve yeniden yayımlama izni doğrulanmadı; yazılı izin veya resmî paylaşım protokolü gerekir.',
   'Kaynak: Trabzon Eczacı Odası', false, 10, false),
  ('trabzon_belediye', 'Trabzon Büyükşehir Belediyesi nöbetçi eczane servisi', 'official_portal',
   'https://www.trabzon.bel.tr/Web/_NobetciEczanelerGetir', null,
   'Belediye web servisi. Servis koşulları ve yeniden kullanım izni doğrulanmadı.',
   'Kaynak: Trabzon Büyükşehir Belediyesi', false, 20, false),
  ('collectapi', 'CollectAPI Nöbetçi Eczane', 'commercial_api',
   'https://collectapi.com/tr/api/health/nobetci-eczane-api', null,
   'Ticari API. Kullanım ve yeniden yayımlama kapsamı abonelik sözleşmesine göre doğrulanmalıdır.',
   'Kaynak: CollectAPI', false, 30, false),
  ('eczaneadresi', 'Eczane Adresi API', 'commercial_api',
   'https://eczaneadresi.com/api-docs', null,
   'Ticari API. Trabzon kapsamı ve koordinat kalitesi sözleşme öncesi test edilmelidir.',
   'Kaynak: Eczane Adresi', false, 40, false),
  ('apimarket', 'API Market Eczane API', 'commercial_api',
   'https://www.apimarket.com.tr/api/eczane', null,
   'Ticari API. Yeniden kullanım izni ve rate limit sözleşmede doğrulanmalıdır.',
   'Kaynak: API Market', false, 50, false),
  ('manual', 'Yetkili kurum bülteni (elle içe aktarma)', 'manual',
   null, null,
   'Yönetici tarafından yetkili kurum bülteninden elle girilen/aktarılan kayıtlar.',
   'Kaynak: yetkili kurum bülteni', true, 5, true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Eczane profili (places ile 1:1)
-- ---------------------------------------------------------------------------
create table if not exists public.pharmacy_profiles (
  place_id             uuid primary key references public.places (id) on delete cascade,
  slug                 text not null unique,
  neighborhood         text,
  neighborhood_source  text,
  address_text         text,
  phone_text           text,
  working_hours        jsonb not null default '{}'::jsonb,
  working_hours_source text,
  inventory_source     text not null default 'osm',
  duty_tracking        boolean not null default true,
  -- Eczane hakkındaki verinin en son doğrulandığı an. `null` ise arayüz
  -- "veri doğrulanmadı" der ve structured data içine doğrulanmış damgası
  -- koymaz.
  data_verified_at     timestamptz,
  duty_verified_at     timestamptz,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint pharmacy_profiles_slug check (slug ~ '^[a-z0-9-]{3,140}$'),
  constraint pharmacy_profiles_neighborhood check (neighborhood is null or char_length(neighborhood) between 2 and 120),
  constraint pharmacy_profiles_neighborhood_source check (
    neighborhood_source is null or neighborhood_source in ('official_list', 'municipality', 'pharmacy_bulletin', 'manual_verified')
  ),
  constraint pharmacy_profiles_hours_source check (
    working_hours_source is null or working_hours_source in ('official_list', 'municipality', 'pharmacy_bulletin', 'manual_verified')
  ),
  constraint pharmacy_profiles_inventory_source check (
    inventory_source in ('osm', 'official_list', 'pharmacy_bulletin', 'manual')
  ),
  constraint pharmacy_profiles_hours check (jsonb_typeof(working_hours) = 'object'),
  constraint pharmacy_profiles_notes check (notes is null or char_length(notes) <= 2000)
);

-- ---------------------------------------------------------------------------
-- 5. Nöbet çizelgesi
-- ---------------------------------------------------------------------------
create table if not exists public.pharmacy_duty_schedules (
  id             uuid primary key default gen_random_uuid(),
  place_id       uuid not null references public.places (id) on delete cascade,
  duty_date      date not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  source_id      uuid references public.pharmacy_sources (id) on delete set null,
  source_ref     text,
  source_version text,
  status         text not null default 'unverified',
  fetched_at     timestamptz not null default now(),
  verified_at    timestamptz,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint pharmacy_duty_status check (status in ('confirmed', 'unverified', 'conflict', 'cancelled')),
  constraint pharmacy_duty_range check (ends_at > starts_at),
  constraint pharmacy_duty_window check (ends_at <= starts_at + interval '30 hours'),
  constraint pharmacy_duty_date_alignment check (
    duty_date = (starts_at at time zone 'Europe/Istanbul')::date
  ),
  unique (place_id, starts_at)
);

create index if not exists pharmacy_duty_date_idx
  on public.pharmacy_duty_schedules (duty_date, status);
create index if not exists pharmacy_duty_window_idx
  on public.pharmacy_duty_schedules (starts_at, ends_at);
create index if not exists pharmacy_duty_place_idx
  on public.pharmacy_duty_schedules (place_id, starts_at desc);
create index if not exists pharmacy_duty_source_idx
  on public.pharmacy_duty_schedules (source_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- 6. Senkronizasyon kayıtları
-- ---------------------------------------------------------------------------
create table if not exists public.pharmacy_sync_logs (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid references public.pharmacy_sources (id) on delete set null,
  source_key       text,
  run_kind         text not null default 'manual',
  status           text not null default 'success',
  records_received integer not null default 0,
  records_matched  integer not null default 0,
  records_unmatched integer not null default 0,
  records_rejected integer not null default 0,
  duty_written     integer not null default 0,
  conflicts        integer not null default 0,
  error_code       text,
  error_message    text,
  duration_ms      integer,
  actor_id         uuid references public.profiles (id) on delete set null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint pharmacy_sync_kind check (run_kind in ('scheduled', 'manual', 'import')),
  constraint pharmacy_sync_status check (status in ('success', 'partial', 'failed')),
  constraint pharmacy_sync_counts check (
    records_received >= 0 and records_matched >= 0 and records_unmatched >= 0
    and records_rejected >= 0 and duty_written >= 0 and conflicts >= 0
  )
);

create index if not exists pharmacy_sync_started_idx
  on public.pharmacy_sync_logs (started_at desc);

-- ---------------------------------------------------------------------------
-- 7. Eşleşmeyen nöbet kayıtları (yönetici kuyruğu)
-- ---------------------------------------------------------------------------
create table if not exists public.pharmacy_unmatched_duty (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid references public.pharmacy_sources (id) on delete set null,
  sync_log_id     uuid references public.pharmacy_sync_logs (id) on delete set null,
  raw_name        text not null,
  raw_district    text,
  raw_neighborhood text,
  raw_address     text,
  raw_phone       text,
  duty_date       date not null,
  starts_at       timestamptz,
  ends_at         timestamptz,
  status          text not null default 'pending',
  linked_place_id uuid references public.places (id) on delete set null,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  note            text,
  created_at      timestamptz not null default now(),
  constraint pharmacy_unmatched_status check (status in ('pending', 'linked', 'rejected'))
);

create unique index if not exists pharmacy_unmatched_unique_idx
  on public.pharmacy_unmatched_duty (source_id, lower(raw_name), duty_date);
create index if not exists pharmacy_unmatched_status_idx
  on public.pharmacy_unmatched_duty (status, duty_date desc);

-- ---------------------------------------------------------------------------
-- 8. Bildirim tercihleri ve gönderim kaydı
-- ---------------------------------------------------------------------------
create table if not exists public.pharmacy_notification_preferences (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  enabled      boolean not null default false,
  district     text,
  neighborhood text,
  notify_hour  smallint not null default 9,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint pharmacy_prefs_hour check (notify_hour between 0 and 23),
  constraint pharmacy_prefs_neighborhood check (neighborhood is null or char_length(neighborhood) between 2 and 120)
);

create table if not exists public.pharmacy_notification_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  duty_date   date not null,
  district    text,
  neighborhood text,
  duty_count  integer not null default 0,
  title       text not null,
  body        text,
  channel     text not null default 'in_app',
  notification_id uuid references public.notifications (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, duty_date, channel),
  constraint pharmacy_notification_channel check (channel in ('in_app'))
);

create index if not exists pharmacy_notification_log_date_idx
  on public.pharmacy_notification_log (duty_date desc);

-- ---------------------------------------------------------------------------
-- 9. updated_at tetikleyicileri
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pharmacy_settings_touch on public.pharmacy_settings;
create trigger pharmacy_settings_touch before update on public.pharmacy_settings
  for each row execute function public.pharmacy_touch_updated_at();

drop trigger if exists pharmacy_sources_touch on public.pharmacy_sources;
create trigger pharmacy_sources_touch before update on public.pharmacy_sources
  for each row execute function public.pharmacy_touch_updated_at();

drop trigger if exists pharmacy_profiles_touch on public.pharmacy_profiles;
create trigger pharmacy_profiles_touch before update on public.pharmacy_profiles
  for each row execute function public.pharmacy_touch_updated_at();

drop trigger if exists pharmacy_duty_touch on public.pharmacy_duty_schedules;
create trigger pharmacy_duty_touch before update on public.pharmacy_duty_schedules
  for each row execute function public.pharmacy_touch_updated_at();

drop trigger if exists pharmacy_prefs_touch on public.pharmacy_notification_preferences;
create trigger pharmacy_prefs_touch before update on public.pharmacy_notification_preferences
  for each row execute function public.pharmacy_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 10. Yardımcılar
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_slugify(p_text text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(p_text, ''),
      'ÇĞİÖŞÜçğıöşüÂâÎîÛû',
      'CGIOSUcgiosuAaIiUu')),
    '[^a-z0-9]+', '-', 'g'));
$$;

/** "İnanır Eczanesi" → "inanir". Eşleştirmede yalnızca çekirdek ad kullanılır. */
create or replace function public.pharmacy_core_name(p_text text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(
      public.pharmacy_slugify(p_text),
      '(^|-)eczanesi$|(^|-)eczane$|(^|-)eczhane$', '', 'g'),
    '-+', '-', 'g'));
$$;

create or replace function public.pharmacy_istanbul_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Europe/Istanbul')::date;
$$;

/**
 * Bir eczanenin o anki nöbet ve çalışma saati durumu.
 *
 * Dönen `state`:
 *   on_duty           → nöbet aralığı şu an devam ediyor
 *   duty_today_later  → bugün nöbeti var, henüz başlamadı
 *   duty_today_ended  → bugünkü nöbet sona erdi
 *   none              → bugün nöbet kaydı yok
 *   unknown           → nöbet takibi kapalı / veri yok
 *
 * `stale` true ise kaynak tazelik eşiğini aşmıştır; arayüz kesin konuşmaz.
 */
create or replace function public.pharmacy_state(
  p_place_id uuid,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tz         text := 'Europe/Istanbul';
  v_settings   public.pharmacy_settings%rowtype;
  v_local      timestamp;
  v_today      date;
  v_day_start  timestamptz;
  v_day_end    timestamptz;
  v_active     public.pharmacy_duty_schedules%rowtype;
  v_next       public.pharmacy_duty_schedules%rowtype;
  v_today_row  public.pharmacy_duty_schedules%rowtype;
  v_state      text := 'unknown';
  v_hours      jsonb := '{}'::jsonb;
  v_tracking   boolean := false;
  v_stale_hours integer := 18;
  v_dow        integer;
  v_slots      jsonb;
  v_slot       jsonb;
  v_from       timestamp;
  v_to         timestamp;
  v_open       boolean := null;
  v_source     text;
  v_stale      boolean := false;
  v_shift      jsonb := null;
  v_district_id bigint;
  v_list_published boolean := false;
begin
  select * into v_settings from public.pharmacy_settings where id = 1;
  if v_settings.id is not null then
    v_stale_hours := coalesce(v_settings.stale_after_hours, 18);
  end if;

  select pp.working_hours, pp.duty_tracking
    into v_hours, v_tracking
  from public.pharmacy_profiles pp
  where pp.place_id = p_place_id;

  v_hours := coalesce(v_hours, '{}'::jsonb);
  v_tracking := coalesce(v_tracking, false);
  v_local := p_at at time zone v_tz;
  v_today := v_local::date;
  v_day_start := (v_today::timestamp at time zone v_tz);
  v_day_end := ((v_today + 1)::timestamp at time zone v_tz);

  -- 1) Şu an devam eden nöbet
  select * into v_active
  from public.pharmacy_duty_schedules s
  where s.place_id = p_place_id
    and s.status in ('confirmed', 'unverified')
    and s.starts_at <= p_at
    and s.ends_at > p_at
  order by (s.status = 'confirmed') desc, s.fetched_at desc
  limit 1;

  if v_active.id is not null then
    v_today_row := v_active;
    v_state := 'on_duty';
  else
    -- 2) Bugün başlayacak nöbet
    select * into v_next
    from public.pharmacy_duty_schedules s
    where s.place_id = p_place_id
      and s.status in ('confirmed', 'unverified')
      and s.starts_at > p_at
      and s.starts_at < v_day_end
    order by s.starts_at
    limit 1;

    if v_next.id is not null then
      v_today_row := v_next;
      v_state := 'duty_today_later';
    else
      -- 3) Bugün içinde kalmış (bitmiş) nöbet
      select * into v_today_row
      from public.pharmacy_duty_schedules s
      where s.place_id = p_place_id
        and s.status in ('confirmed', 'unverified')
        and s.starts_at < v_day_end
        and s.ends_at > v_day_start
      order by s.starts_at
      limit 1;

      if v_today_row.id is not null then
        v_state := 'duty_today_ended';
      elsif v_tracking then
        -- Eczanenin ilçesinde bugün için doğrulanmış bir liste yayımlandıysa
        -- "nöbetçi değil" demek dürüsttür. Liste hiç yoksa durum bilinmiyor.
        select p.district_id into v_district_id from public.places p where p.id = p_place_id;
        v_list_published := exists (
          select 1
          from public.pharmacy_duty_schedules s2
          join public.places p2 on p2.id = s2.place_id
          where p2.district_id = v_district_id
            and s2.duty_date = v_today
            and s2.status = 'confirmed'
        );
        v_state := case when v_list_published then 'none' else 'unknown' end;
      else
        v_state := 'unknown';
      end if;
    end if;
  end if;

  -- 4) Tazelik
  if v_today_row.id is not null then
    v_stale := v_today_row.fetched_at < now() - make_interval(hours => v_stale_hours);
    if v_today_row.source_id is not null then
      select name into v_source from public.pharmacy_sources where id = v_today_row.source_id;
    end if;
    v_shift := jsonb_build_object(
      'duty_date', v_today_row.duty_date,
      'starts_at', v_today_row.starts_at,
      'ends_at', v_today_row.ends_at,
      'status', v_today_row.status,
      'verified', v_today_row.status = 'confirmed' and v_today_row.verified_at is not null,
      'fetched_at', v_today_row.fetched_at,
      'source_name', v_source
    );
  end if;

  -- 5) Çalışma saati (yalnızca doğrulanmış/aktarılmış saat verisi varsa)
  if jsonb_typeof(v_hours) = 'object' and v_hours <> '{}'::jsonb then
    v_dow := extract(isodow from v_local)::integer;
    v_slots := coalesce(
      v_hours -> v_dow::text,
      v_hours -> (array['mon','tue','wed','thu','fri','sat','sun'])[v_dow]
    );
    if jsonb_typeof(v_slots) = 'array' then
      v_open := false;
      for v_slot in select * from jsonb_array_elements(v_slots)
      loop
        begin
          v_from := (v_today::text || ' ' || (v_slot ->> 0))::timestamp;
          if (v_slot ->> 1) = '24:00' then
            v_to := (v_today + 1)::timestamp;
          else
            v_to := (v_today::text || ' ' || (v_slot ->> 1))::timestamp;
          end if;
          if v_local >= v_from and v_local < v_to then
            v_open := true;
            exit;
          end if;
        exception when others then
          -- Bozuk saat biçimi "kapalı" sonucu üretmez; bilinmiyor kalır.
          v_open := null;
        end;
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'state', v_state,
    'on_duty_now', v_state = 'on_duty',
    'duty_today', v_state in ('on_duty', 'duty_today_later', 'duty_today_ended'),
    'work_state', case when v_open is true then 'open' when v_open is false then 'closed' else 'unknown' end,
    'hours_known', v_open is not null,
    'stale', v_stale,
    'duty_tracking', v_tracking,
    'shift', v_shift,
    'checked_at', p_at
  );
end;
$$;

revoke all on function public.pharmacy_state(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Mevcut eczane kayıtları için profil + slug üretimi
--
-- Envanter OpenStreetMap (ODbL) kaynaklıdır. Adres/mahalle/çalışma saati
-- alanları UYDURULMAZ; boş bırakılır ve arayüz bunu açıkça söyler.
-- ---------------------------------------------------------------------------
with base as (
  select p.id,
         p.name,
         d.slug as district_slug
  from public.places p
  join public.place_categories c on c.id = p.category_id
  join public.districts d on d.id = p.district_id
  where c.slug = 'eczane'
),
ranked as (
  select b.id,
         b.name,
         b.district_slug,
         row_number() over (
           partition by public.pharmacy_slugify(b.name) || '-' || b.district_slug
           order by b.id
         ) as rn
  from base b
)
insert into public.pharmacy_profiles (place_id, slug, inventory_source, working_hours)
select
  r.id,
  left('eczane-' || public.pharmacy_slugify(r.name) || '-' || r.district_slug, 120)
    || case when r.rn > 1 then '-' || r.rn::text else '' end,
  'osm',
  '{}'::jsonb
from ranked r
on conflict (place_id) do nothing;

-- ---------------------------------------------------------------------------
-- 12. Ortak okuma satırı
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_row(p_place_id uuid, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', p.id,
    'slug', pp.slug,
    'name', p.name,
    'district', d.name,
    'district_slug', d.slug,
    'neighborhood', pp.neighborhood,
    'address', coalesce(pp.address_text, p.address),
    'phone', coalesce(pp.phone_text, p.phone),
    'lat', p.lat,
    'lng', p.lng,
    'rating', p.rating_avg,
    'review_count', p.review_count,
    'cover_path', p.cover_path,
    'data_verified', pp.data_verified_at is not null,
    'state', public.pharmacy_state(p.id, p_at)
  )
  from public.places p
  join public.place_categories c on c.id = p.category_id
  join public.districts d on d.id = p.district_id
  join public.pharmacy_profiles pp on pp.place_id = p.id
  where p.id = p_place_id
    and c.slug = 'eczane'
    and p.status = 'published';
$$;

-- ---------------------------------------------------------------------------
-- 13. Genel (uygulama) RPC'leri
-- ---------------------------------------------------------------------------
create or replace function public.pharmacies_bootstrap()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with today as (select public.pharmacy_istanbul_today() as d),
  base as (
    select p.id, p.district_id, d.name as district_name, d.slug as district_slug
    from public.places p
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    join public.pharmacy_profiles pp on pp.place_id = p.id
    where c.slug = 'eczane' and p.status = 'published'
  )
  select jsonb_build_object(
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', b.district_name,
        'slug', b.district_slug,
        'pharmacy_count', b.cnt,
        'duty_today', b.duty_today
      ) order by b.district_name)
      from (
        select bb.district_id, bb.district_name, bb.district_slug,
               count(*) as cnt,
               count(distinct s.place_id) filter (
                 where s.status = 'confirmed'
                   and (s.duty_date = (select d from today) or (s.starts_at < ((select d from today) + 1)::timestamp at time zone 'Europe/Istanbul'
                        and s.ends_at > (select d from today)::timestamp at time zone 'Europe/Istanbul'))
               ) as duty_today
        from base bb
        left join public.pharmacy_duty_schedules s on s.place_id = bb.id
        group by bb.district_id, bb.district_name, bb.district_slug
      ) b
    ), '[]'::jsonb),
    'total_pharmacies', (select count(*) from base),
    'duty_today_total', (
      select count(distinct s.place_id)
      from public.pharmacy_duty_schedules s
      join base b on b.id = s.place_id
      where s.status = 'confirmed'
        and (s.duty_date = (select d from today)
             or (s.starts_at < ((select d from today) + 1)::timestamp at time zone 'Europe/Istanbul'
                 and s.ends_at > (select d from today)::timestamp at time zone 'Europe/Istanbul'))
    ),
    'today', (select d from today),
    'timezone', 'Europe/Istanbul',
    'settings', (
      select jsonb_build_object(
        'stale_after_hours', s.stale_after_hours,
        'default_notify_hour', s.default_notify_hour,
        'notifications_enabled', s.notifications_enabled,
        'require_verified_duty', s.require_verified_duty,
        'guide_intro', s.guide_intro
      ) from public.pharmacy_settings s where s.id = 1
    ),
    'data_sources', jsonb_build_object(
      'enabled', (select count(*) from public.pharmacy_sources where is_enabled),
      'live_feeds', (select count(*) from public.pharmacy_sources where is_enabled and verified_license and kind <> 'manual'),
      'manual_import', (select count(*) from public.pharmacy_sources where is_enabled and kind = 'manual'),
      'last_success_at', (select max(last_success_at) from public.pharmacy_sources where is_enabled)
    ),
    'generated_at', now()
  );
$$;

revoke all on function public.pharmacies_bootstrap() from public;
grant execute on function public.pharmacies_bootstrap() to anon, authenticated, service_role;

create or replace function public.pharmacies_list(
  p_district text default null,
  p_neighborhood text default null,
  p_query text default null,
  p_mode text default 'all',
  p_lat double precision default null,
  p_lng double precision default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_today date := public.pharmacy_istanbul_today();
  v_day_start timestamptz := (public.pharmacy_istanbul_today()::timestamp at time zone 'Europe/Istanbul');
  v_day_end timestamptz := ((public.pharmacy_istanbul_today() + 1)::timestamp at time zone 'Europe/Istanbul');
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_mode text := coalesce(nullif(btrim(p_mode), ''), 'all');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_point geography;
  v_items jsonb;
  v_total integer;
begin
  if v_mode not in ('all', 'duty_today', 'on_duty_now', 'nearby') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if p_lat is not null and p_lng is not null then
    v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  end if;

  with base as (
    select p.id, p.name, p.lat, p.lng, p.geog,
           d.name as district, d.slug as district_slug,
           pp.slug, pp.neighborhood, pp.address_text, pp.phone_text,
           coalesce(pp.address_text, p.address) as address,
           coalesce(pp.phone_text, p.phone) as phone,
           p.rating_avg, p.review_count, p.cover_path, pp.data_verified_at,
           public.pharmacy_state(p.id, v_now) as state
    from public.places p
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    join public.pharmacy_profiles pp on pp.place_id = p.id
    where c.slug = 'eczane'
      and p.status = 'published'
      and (p_district is null or lower(d.name) = lower(btrim(p_district)))
      and (p_neighborhood is null or lower(coalesce(pp.neighborhood, '')) = lower(btrim(p_neighborhood)))
      and (
        v_query is null
        or p.name ilike '%' || v_query || '%'
        or d.name ilike '%' || v_query || '%'
        or coalesce(pp.neighborhood, '') ilike '%' || v_query || '%'
        or coalesce(pp.address_text, p.address, '') ilike '%' || v_query || '%'
      )
  ),
  filtered as (
    select b.*,
           case when v_point is null then null
                else round((ST_Distance(b.geog, v_point) / 1000.0)::numeric, 2)
           end as distance_km
    from base b
    where (
        v_mode <> 'duty_today'
        or (b.state ->> 'duty_today')::boolean
      )
      and (
        v_mode <> 'on_duty_now'
        or (b.state ->> 'on_duty_now')::boolean
      )
  )
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'slug', f.slug,
          'name', f.name,
          'district', f.district,
          'district_slug', f.district_slug,
          'neighborhood', f.neighborhood,
          'address', f.address,
          'phone', f.phone,
          'lat', f.lat,
          'lng', f.lng,
          'rating', f.rating_avg,
          'review_count', f.review_count,
          'cover_path', f.cover_path,
          'data_verified', f.data_verified_at is not null,
          'distance_km', f.distance_km,
          'state', f.state
        )
        order by
          (f.state ->> 'on_duty_now')::boolean desc,
          (f.state ->> 'duty_today')::boolean desc,
          f.distance_km asc nulls last,
          f.name
      )
      from (
        select * from filtered
        order by
          (state ->> 'on_duty_now')::boolean desc,
          (state ->> 'duty_today')::boolean desc,
          case when v_mode = 'nearby' then distance_km end asc nulls last,
          name
        limit v_limit offset v_offset
      ) f
    ), '[]'::jsonb),
    (select count(*) from filtered)
  into v_items, v_total;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'mode', v_mode,
    'today', v_today,
    'generated_at', v_now
  );
end;
$$;

revoke all on function public.pharmacies_list(text, text, text, text, double precision, double precision, integer, integer) from public;
grant execute on function public.pharmacies_list(text, text, text, text, double precision, double precision, integer, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14. Günün nöbet duyurusu (feed kartı + mahalle bilgilendirmesi)
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_duty_notice(
  p_district text default null,
  p_neighborhood text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_today date := public.pharmacy_istanbul_today();
  v_day_start timestamptz := (public.pharmacy_istanbul_today()::timestamp at time zone 'Europe/Istanbul');
  v_day_end timestamptz := ((public.pharmacy_istanbul_today() + 1)::timestamp at time zone 'Europe/Istanbul');
  v_rows jsonb;
  v_count integer;
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
  v_neighborhood text := nullif(btrim(coalesce(p_neighborhood, '')), '');
  v_latest timestamptz;
  v_stale boolean;
  v_settings public.pharmacy_settings%rowtype;
begin
  select * into v_settings from public.pharmacy_settings where id = 1;

  with duty as (
    select p.id, p.name, pp.slug, d.name as district, pp.neighborhood,
           s.starts_at, s.ends_at, s.status, s.fetched_at,
           s.duty_date
    from public.pharmacy_duty_schedules s
    join public.places p on p.id = s.place_id
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    join public.pharmacy_profiles pp on pp.place_id = p.id
    where c.slug = 'eczane'
      and p.status = 'published'
      and s.status in ('confirmed', 'unverified')
      and s.starts_at < v_day_end
      and s.ends_at > v_day_start
      and (v_district is null or lower(d.name) = lower(v_district))
      and (v_neighborhood is null or lower(coalesce(pp.neighborhood, '')) = lower(v_neighborhood))
  ),
  agg as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'slug', d.slug,
        'district', d.district,
        'neighborhood', d.neighborhood,
        'starts_at', d.starts_at,
        'ends_at', d.ends_at,
        'status', d.status,
        'duty_date', d.duty_date,
        'on_duty_now', d.starts_at <= v_now and d.ends_at > v_now
      ) order by d.starts_at), '[]'::jsonb) as items,
      count(*) as cnt,
      max(d.fetched_at) as latest
    from duty d
  )
  select items, cnt, latest into v_rows, v_count, v_latest from agg;

  v_stale := v_latest is null
    or v_latest < v_now - make_interval(hours => coalesce(v_settings.stale_after_hours, 18));

  return jsonb_build_object(
    'date', public.pharmacy_istanbul_today(),
    'district', v_district,
    'neighborhood', v_neighborhood,
    'count', v_count,
    'on_duty_now', (
      select count(*) from jsonb_array_elements(v_rows) e
      where (e ->> 'on_duty_now')::boolean
    ),
    'items', v_rows,
    'stale', v_stale,
    'last_fetched_at', v_latest,
    'stale_after_hours', coalesce(v_settings.stale_after_hours, 18),
    'verified_sources_only', coalesce(v_settings.require_verified_duty, true),
    'generated_at', v_now
  );
end;
$$;

revoke all on function public.pharmacy_duty_notice(text, text) from public;
grant execute on function public.pharmacy_duty_notice(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 15. Eczane detayı
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_detail(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_place public.places%rowtype;
  v_profile public.pharmacy_profiles%rowtype;
  v_district text;
  v_district_slug text;
  v_state jsonb;
  v_duty jsonb;
  v_sources jsonb;
  v_breakdown jsonb;
  v_attribution text;
  v_license text;
begin
  select p.* into v_place
  from public.places p
  join public.pharmacy_profiles pp on pp.place_id = p.id
  join public.place_categories c on c.id = p.category_id
  where pp.slug = lower(btrim(coalesce(p_slug, '')))
    and c.slug = 'eczane'
    and p.status = 'published';

  if v_place.id is null then
    raise exception 'pharmacy_not_found' using errcode = 'P0002';
  end if;

  select * into v_profile from public.pharmacy_profiles where place_id = v_place.id;

  select d.name, d.slug into v_district, v_district_slug
  from public.districts d where d.id = v_place.district_id;

  v_state := public.pharmacy_state(v_place.id, v_now);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'duty_date', s.duty_date,
    'starts_at', s.starts_at,
    'ends_at', s.ends_at,
    'status', s.status,
    'verified_at', s.verified_at,
    'fetched_at', s.fetched_at,
    'source_name', src.name,
    'source_attribution', src.attribution_text
  ) order by s.starts_at), '[]'::jsonb)
  into v_duty
  from public.pharmacy_duty_schedules s
  left join public.pharmacy_sources src on src.id = s.source_id
  where s.place_id = v_place.id
    and s.status in ('confirmed', 'unverified', 'conflict')
    and s.ends_at >= v_now - interval '1 day'
    and s.starts_at <= v_now + interval '14 days';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', src.id,
    'name', src.name,
    'kind', src.kind,
    'attribution_text', src.attribution_text,
    'license_note', src.license_note
  )), '[]'::jsonb)
  into v_sources
  from public.pharmacy_sources src
  where src.id in (
    select s.source_id from public.pharmacy_duty_schedules s
    where s.place_id = v_place.id and s.source_id is not null
  );

  select coalesce(jsonb_object_agg(rating::text, cnt), '{}'::jsonb)
  into v_breakdown
  from (
    select rating, count(*) as cnt
    from public.place_reviews
    where place_id = v_place.id and status = 'visible'
    group by rating
  ) t;

  select r.attribution_text, r.license_note
  into v_attribution, v_license
  from public.place_external_references r
  where r.place_id = v_place.id
  order by r.fetched_at desc
  limit 1;

  return jsonb_build_object(
    'id', v_place.id,
    'slug', v_profile.slug,
    'name', v_place.name,
    'district', v_district,
    'district_slug', v_district_slug,
    'neighborhood', v_profile.neighborhood,
    'neighborhood_verified', v_profile.neighborhood_source is not null,
    'address', coalesce(v_profile.address_text, v_place.address),
    'phone', coalesce(v_profile.phone_text, v_place.phone),
    'lat', v_place.lat,
    'lng', v_place.lng,
    'working_hours', v_profile.working_hours,
    'working_hours_verified', v_profile.working_hours_source is not null,
    'data_verified', v_profile.data_verified_at is not null,
    'data_verified_at', v_profile.data_verified_at,
    'duty_verified_at', v_profile.duty_verified_at,
    'inventory_source', v_profile.inventory_source,
    'rating', v_place.rating_avg,
    'review_count', v_place.review_count,
    'rating_breakdown', v_breakdown,
    'cover_path', v_place.cover_path,
    'attribution_text', v_attribution,
    'license_note', v_license,
    'state', v_state,
    'duty', v_duty,
    'sources', v_sources,
    'generated_at', v_now
  );
end;
$$;

revoke all on function public.pharmacy_detail(text) from public;
grant execute on function public.pharmacy_detail(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 16. Harita işaretleri
-- ---------------------------------------------------------------------------
create or replace function public.pharmacies_map(
  p_west double precision,
  p_east double precision,
  p_south double precision,
  p_north double precision,
  p_district text default null,
  p_only_duty boolean default false,
  p_limit integer default 400
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 400), 1), 600);
  v_items jsonb;
begin
  if p_west is null or p_east is null or p_south is null or p_north is null then
    raise exception 'invalid_bbox' using errcode = '22023';
  end if;

  with base as (
    select p.id, p.lat, p.lng,
           pp.slug, p.name, d.name as district, pp.neighborhood, pp.address_text,
           coalesce(pp.phone_text, p.phone) as phone,
           public.pharmacy_state(p.id, v_now) as state
    from public.places p
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    join public.pharmacy_profiles pp on pp.place_id = p.id
    where c.slug = 'eczane'
      and p.status = 'published'
      and p.lng between p_west and p_east
      and p.lat between p_south and p_north
      and (p_district is null or lower(d.name) = lower(btrim(p_district)))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'slug', b.slug,
    'name', b.name,
    'district', b.district,
    'neighborhood', b.neighborhood,
    'address', b.address_text,
    'phone', b.phone,
    'lat', b.lat,
    'lng', b.lng,
    'state', b.state
  ) order by (b.state ->> 'on_duty_now')::boolean desc, b.name), '[]'::jsonb)
  into v_items
  from (
    select * from base b
    where (not p_only_duty) or (b.state ->> 'duty_today')::boolean
    order by (b.state ->> 'on_duty_now')::boolean desc, b.name
    limit v_limit
  ) b;

  return jsonb_build_object('items', v_items, 'generated_at', v_now);
end;
$$;

revoke all on function public.pharmacies_map(double precision, double precision, double precision, double precision, text, boolean, integer) from public;
grant execute on function public.pharmacies_map(double precision, double precision, double precision, double precision, text, boolean, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 17. Eczane yorumları
--
-- `place_review_upsert` yeniden kullanılır. Ek korumalar:
--   • Reçete/TC kimlik numarası gibi hassas veri içeren yorum reddedilir.
--   • Medya (reçete fotoğrafı) kabul edilmez.
--   • 10 saniye hız limiti ve kullanıcı başına tek yorum kuralı korunur.
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_review_upsert(
  p_place_id uuid,
  p_rating integer,
  p_body text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_is_pharmacy boolean;
  v_result jsonb;
begin
  select exists (
    select 1
    from public.places p
    join public.place_categories c on c.id = p.category_id
    where p.id = p_place_id and c.slug = 'eczane'
  ) into v_is_pharmacy;

  if not v_is_pharmacy then
    raise exception 'pharmacy_not_found' using errcode = 'P0002';
  end if;

  if v_body is not null then
    if char_length(v_body) > 1200 then
      raise exception 'body_too_long' using errcode = '22023';
    end if;
    -- 11 haneli TC kimlik numarası benzeri diziler ve reçete talepleri.
    if v_body ~ '\m[1-9][0-9]{10}\M' then
      raise exception 'sensitive_personal_data' using errcode = '22023';
    end if;
    if v_body ~* '(re[cç]ete\s*(foto|g[oö]rsel|numaras|no))|(t\.?c\.?\s*kimlik)' then
      raise exception 'sensitive_personal_data' using errcode = '22023';
    end if;
  end if;

  v_result := public.place_review_upsert(p_place_id, p_rating, v_body, '[]'::jsonb);

  -- Yorum yazıldığında doğrulanmış mahalle bilgisi varsa rozet için kullanılır;
  -- burada ek işlem gerekmez. Sonuç istemciye aynen döner.
  return v_result;
end;
$$;

revoke all on function public.pharmacy_review_upsert(uuid, integer, text) from public, anon;
grant execute on function public.pharmacy_review_upsert(uuid, integer, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 18. Bildirim tercihleri
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_notification_prefs_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.pharmacy_notification_preferences%rowtype;
  v_settings public.pharmacy_settings%rowtype;
begin
  select * into v_row from public.pharmacy_notification_preferences where user_id = v_uid;
  select * into v_settings from public.pharmacy_settings where id = 1;

  return jsonb_build_object(
    'enabled', coalesce(v_row.enabled, false),
    'district', v_row.district,
    'neighborhood', v_row.neighborhood,
    'notify_hour', coalesce(v_row.notify_hour, coalesce(v_settings.default_notify_hour, 9)),
    'updated_at', v_row.updated_at,
    'global_enabled', coalesce(v_settings.notifications_enabled, false),
    'allowed_channels', jsonb_build_array('in_app')
  );
end;
$$;

revoke all on function public.pharmacy_notification_prefs_get() from public, anon;
grant execute on function public.pharmacy_notification_prefs_get() to authenticated, service_role;

create or replace function public.pharmacy_notification_prefs_set(
  p_enabled boolean,
  p_district text default null,
  p_neighborhood text default null,
  p_notify_hour integer default 9
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
  v_neighborhood text := nullif(btrim(coalesce(p_neighborhood, '')), '');
  v_hour smallint := least(greatest(coalesce(p_notify_hour, 9), 0), 23);
begin
  if v_district is not null and not exists (
    select 1 from public.districts where lower(name) = lower(v_district)
  ) then
    raise exception 'invalid_district' using errcode = '22023';
  end if;
  if v_neighborhood is not null and char_length(v_neighborhood) < 2 then
    raise exception 'invalid_neighborhood' using errcode = '22023';
  end if;
  if v_neighborhood is not null and v_district is null then
    raise exception 'district_required_for_neighborhood' using errcode = '22023';
  end if;
  if v_neighborhood is not null and not exists (
    select 1
    from public.pharmacy_profiles pp
    join public.places p on p.id = pp.place_id
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    where c.slug = 'eczane'
      and lower(d.name) = lower(v_district)
      and lower(coalesce(pp.neighborhood, '')) = lower(v_neighborhood)
  ) then
    raise exception 'unknown_neighborhood' using errcode = '22023';
  end if;

  insert into public.pharmacy_notification_preferences (user_id, enabled, district, neighborhood, notify_hour)
  values (v_uid, coalesce(p_enabled, false), v_district, v_neighborhood, v_hour)
  on conflict (user_id) do update
    set enabled = excluded.enabled,
        district = excluded.district,
        neighborhood = excluded.neighborhood,
        notify_hour = excluded.notify_hour;

  return public.pharmacy_notification_prefs_get();
end;
$$;

revoke all on function public.pharmacy_notification_prefs_set(boolean, text, text, integer) from public, anon;
grant execute on function public.pharmacy_notification_prefs_set(boolean, text, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 19. Genel (anon) web okuma yüzeyi — SEO sayfaları için
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_public_page(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_place public.places%rowtype;
  v_profile public.pharmacy_profiles%rowtype;
  v_district text;
  v_district_slug text;
  v_state jsonb;
  v_duty jsonb;
begin
  select p.* into v_place
  from public.places p
  join public.pharmacy_profiles pp on pp.place_id = p.id
  join public.place_categories c on c.id = p.category_id
  where pp.slug = lower(btrim(coalesce(p_slug, '')))
    and c.slug = 'eczane'
    and p.status = 'published';

  if v_place.id is null then
    return null;
  end if;

  select * into v_profile from public.pharmacy_profiles where place_id = v_place.id;
  select d.name, d.slug into v_district, v_district_slug
  from public.districts d where d.id = v_place.district_id;

  v_state := public.pharmacy_state(v_place.id, now());

  select coalesce(jsonb_agg(jsonb_build_object(
    'duty_date', s.duty_date,
    'starts_at', s.starts_at,
    'ends_at', s.ends_at,
    'status', s.status
  ) order by s.starts_at), '[]'::jsonb)
  into v_duty
  from public.pharmacy_duty_schedules s
  where s.place_id = v_place.id
    and s.status = 'confirmed'
    and s.ends_at >= now() - interval '1 day'
    and s.starts_at <= now() + interval '14 days';

  return jsonb_build_object(
    'slug', v_profile.slug,
    'name', v_place.name,
    'district', v_district,
    'district_slug', v_district_slug,
    'neighborhood', v_profile.neighborhood,
    'address', coalesce(v_profile.address_text, v_place.address),
    'phone', coalesce(v_profile.phone_text, v_place.phone),
    'lat', v_place.lat,
    'lng', v_place.lng,
    'rating', v_place.rating_avg,
    'review_count', v_place.review_count,
    'data_verified', v_profile.data_verified_at is not null,
    'data_verified_at', v_profile.data_verified_at,
    'working_hours', v_profile.working_hours,
    'state', v_state,
    'duty', v_duty,
    'updated_at', greatest(v_place.updated_at, v_profile.updated_at)
  );
end;
$$;

revoke all on function public.pharmacy_public_page(text) from public;
grant execute on function public.pharmacy_public_page(text) to anon, authenticated, service_role;

create or replace function public.pharmacies_public_list(
  p_district text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total integer;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', t.slug,
    'name', t.name,
    'district', t.district,
    'neighborhood', t.neighborhood,
    'address', t.address,
    'phone', t.phone,
    'lat', t.lat,
    'lng', t.lng,
    'state', t.state
  ) order by (t.state ->> 'on_duty_now')::boolean desc, t.name), '[]'::jsonb),
  count(*)
  into v_items, v_total
  from (
    select pp.slug, p.name, d.name as district, pp.neighborhood,
           coalesce(pp.address_text, p.address) as address,
           coalesce(pp.phone_text, p.phone) as phone,
           p.lat, p.lng,
           public.pharmacy_state(p.id, now()) as state
    from public.places p
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    join public.pharmacy_profiles pp on pp.place_id = p.id
    where c.slug = 'eczane'
      and p.status = 'published'
      and (p_district is null or lower(d.name) = lower(btrim(p_district)))
    order by p.name
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.pharmacies_public_list(text, integer, integer) from public;
grant execute on function public.pharmacies_public_list(text, integer, integer) to anon, authenticated, service_role;

create or replace function public.pharmacy_sitemap_urls(
  p_limit integer default 5000,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', t.slug,
    'updated_at', t.updated_at
  ) order by t.slug), '[]'::jsonb)
  from (
    select pp.slug,
           greatest(p.updated_at, pp.updated_at) as updated_at
    from public.places p
    join public.place_categories c on c.id = p.category_id
    join public.pharmacy_profiles pp on pp.place_id = p.id
    where c.slug = 'eczane' and p.status = 'published'
    order by pp.slug
    limit least(greatest(coalesce(p_limit, 5000), 1), 20000)
    offset greatest(coalesce(p_offset, 0), 0)
  ) t;
$$;

revoke all on function public.pharmacy_sitemap_urls(integer, integer) from public;
grant execute on function public.pharmacy_sitemap_urls(integer, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 20. Yönetim: genel bakış ve envanter
-- ---------------------------------------------------------------------------
create or replace function public.admin_pharmacy_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
  v_today date := public.pharmacy_istanbul_today();
  v_settings public.pharmacy_settings%rowtype;
begin
  select * into v_settings from public.pharmacy_settings where id = 1;

  return jsonb_build_object(
    'permissions', jsonb_build_object(
      'view', public.has_permission('pharmacy.view'),
      'manage', public.has_permission('pharmacy.manage'),
      'moderate', public.has_permission('pharmacy.moderate'),
      'notify', public.has_permission('pharmacy.notify')
    ),
    'inventory', jsonb_build_object(
      'total', (select count(*) from public.pharmacy_profiles),
      'with_coordinates', (select count(*) from public.pharmacy_profiles pp join public.places p on p.id = pp.place_id where p.lat is not null and p.lng is not null),
      'missing_address', (select count(*) from public.pharmacy_profiles pp join public.places p on p.id = pp.place_id where coalesce(pp.address_text, p.address) is null),
      'missing_phone', (select count(*) from public.pharmacy_profiles pp join public.places p on p.id = pp.place_id where coalesce(pp.phone_text, p.phone) is null),
      'missing_neighborhood', (select count(*) from public.pharmacy_profiles where neighborhood is null),
      'missing_hours', (select count(*) from public.pharmacy_profiles where working_hours = '{}'::jsonb),
      'verified', (select count(*) from public.pharmacy_profiles where data_verified_at is not null),
      'tracked', (select count(*) from public.pharmacy_profiles where duty_tracking)
    ),
    'duty', jsonb_build_object(
      'today', v_today,
      'today_pharmacies', (select count(distinct place_id) from public.pharmacy_duty_schedules where duty_date = v_today and status in ('confirmed','unverified')),
      'confirmed_today', (select count(distinct place_id) from public.pharmacy_duty_schedules where duty_date = v_today and status = 'confirmed'),
      'unverified_today', (select count(distinct place_id) from public.pharmacy_duty_schedules where duty_date = v_today and status = 'unverified'),
      'conflicts', (select count(*) from public.pharmacy_duty_schedules where status = 'conflict' and duty_date >= v_today),
      'no_data', not exists (select 1 from public.pharmacy_duty_schedules where duty_date = v_today),
      'last_fetch', (select max(fetched_at) from public.pharmacy_duty_schedules)
    ),
    'queue', jsonb_build_object(
      'unmatched', (select count(*) from public.pharmacy_unmatched_duty where status = 'pending'),
      'reviews_flagged', (select count(*) from public.content_reports cr where cr.status = 'pending' and cr.target_type = 'place_review' and exists (
        select 1 from public.place_reviews r join public.places p on p.id = r.place_id join public.place_categories c on c.id = p.category_id
        where r.id = cr.target_id and c.slug = 'eczane'
      )),
      'claims', (select count(*) from public.place_owner_claims c join public.places p on p.id = c.place_id join public.place_categories cat on cat.id = p.category_id where cat.slug = 'eczane' and c.status = 'pending')
    ),
    'sources', jsonb_build_object(
      'total', (select count(*) from public.pharmacy_sources),
      'enabled', (select count(*) from public.pharmacy_sources where is_enabled),
      'verified', (select count(*) from public.pharmacy_sources where verified_license),
      'last_run', (select max(started_at) from public.pharmacy_sync_logs),
      'last_failed', (select count(*) from public.pharmacy_sync_logs where status = 'failed' and started_at > now() - interval '7 days')
    ),
    'notifications', jsonb_build_object(
      'global_enabled', coalesce(v_settings.notifications_enabled, false),
      'subscribers', (select count(*) from public.pharmacy_notification_preferences where enabled),
      'sent_today', (select count(*) from public.pharmacy_notification_log where duty_date = v_today)
    ),
    'settings', jsonb_build_object(
      'stale_after_hours', v_settings.stale_after_hours,
      'default_notify_hour', v_settings.default_notify_hour,
      'require_verified_duty', v_settings.require_verified_duty,
      'timezone', v_settings.timezone
    )
  );
end;
$$;

revoke all on function public.admin_pharmacy_overview() from public, anon;
grant execute on function public.admin_pharmacy_overview() to authenticated, service_role;

create or replace function public.admin_pharmacies_list(
  p_district text default null,
  p_query text default null,
  p_missing text default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_items jsonb;
  v_total integer;
begin
  with base as (
    select p.id, pp.slug, p.name, d.name as district, pp.neighborhood,
           coalesce(pp.address_text, p.address) as address,
           coalesce(pp.phone_text, p.phone) as phone,
           p.lat, p.lng, pp.duty_tracking, pp.data_verified_at,
           (select count(*) from public.pharmacy_duty_schedules s where s.place_id = p.id) as duty_rows
    from public.places p
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    join public.pharmacy_profiles pp on pp.place_id = p.id
    where c.slug = 'eczane' and p.status = 'published'
      and (p_district is null or lower(d.name) = lower(btrim(p_district)))
      and (
        v_query is null
        or p.name ilike '%' || v_query || '%'
        or coalesce(pp.neighborhood, '') ilike '%' || v_query || '%'
        or coalesce(pp.address_text, p.address, '') ilike '%' || v_query || '%'
      )
      and (
        p_missing is null
        or (p_missing = 'address' and coalesce(pp.address_text, p.address) is null)
        or (p_missing = 'phone' and coalesce(pp.phone_text, p.phone) is null)
        or (p_missing = 'neighborhood' and pp.neighborhood is null)
        or (p_missing = 'hours' and pp.working_hours = '{}'::jsonb)
        or (p_missing = 'coordinates' and (p.lat is null or p.lng is null))
        or (p_missing = 'verified' and pp.data_verified_at is null)
      )
  )
  select coalesce(jsonb_agg(to_jsonb(b) order by b.name), '[]'::jsonb), count(*)
  into v_items, v_total
  from (select * from base order by name limit v_limit offset v_offset) b;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.admin_pharmacies_list(text, text, text, integer, integer) from public, anon;
grant execute on function public.admin_pharmacies_list(text, text, text, integer, integer) to authenticated, service_role;

create or replace function public.admin_pharmacy_get(p_place_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
  v_place public.places%rowtype;
  v_profile public.pharmacy_profiles%rowtype;
  v_district text;
begin
  select p.* into v_place from public.places p where p.id = p_place_id;
  if v_place.id is null then
    raise exception 'pharmacy_not_found' using errcode = 'P0002';
  end if;
  select * into v_profile from public.pharmacy_profiles where place_id = p_place_id;
  if v_profile.place_id is null then
    raise exception 'pharmacy_profile_missing' using errcode = 'P0002';
  end if;
  select d.name into v_district from public.districts d where d.id = v_place.district_id;

  return jsonb_build_object(
    'id', v_place.id,
    'name', v_place.name,
    'slug', v_profile.slug,
    'district', v_district,
    'neighborhood', v_profile.neighborhood,
    'neighborhood_source', v_profile.neighborhood_source,
    'address', coalesce(v_profile.address_text, v_place.address),
    'phone', coalesce(v_profile.phone_text, v_place.phone),
    'lat', v_place.lat,
    'lng', v_place.lng,
    'working_hours', v_profile.working_hours,
    'working_hours_source', v_profile.working_hours_source,
    'inventory_source', v_profile.inventory_source,
    'duty_tracking', v_profile.duty_tracking,
    'data_verified_at', v_profile.data_verified_at,
    'duty_verified_at', v_profile.duty_verified_at,
    'notes', v_profile.notes,
    'rating', v_place.rating_avg,
    'review_count', v_place.review_count,
    'updated_at', v_place.updated_at,
    'duty', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'duty_date', s.duty_date,
        'starts_at', s.starts_at,
        'ends_at', s.ends_at,
        'status', s.status,
        'verified_at', s.verified_at,
        'fetched_at', s.fetched_at,
        'source_id', s.source_id,
        'source_name', src.name,
        'note', s.note
      ) order by s.starts_at)
      from public.pharmacy_duty_schedules s
      left join public.pharmacy_sources src on src.id = s.source_id
      where s.place_id = p_place_id
        and s.ends_at >= now() - interval '7 days'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_pharmacy_get(uuid) from public, anon;
grant execute on function public.admin_pharmacy_get(uuid) to authenticated, service_role;

create or replace function public.admin_pharmacy_update(p_place_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.manage');
  v_profile public.pharmacy_profiles%rowtype;
  v_neighborhood text;
  v_address text;
  v_phone text;
  v_hours jsonb;
  v_lat double precision;
  v_lng double precision;
  v_verified boolean;
  v_tracking boolean;
  v_notes text;
  v_source text;
begin
  select * into v_profile from public.pharmacy_profiles where place_id = p_place_id;
  if v_profile.place_id is null then
    raise exception 'pharmacy_profile_missing' using errcode = 'P0002';
  end if;

  v_neighborhood := nullif(btrim(coalesce(p_payload ->> 'neighborhood', v_profile.neighborhood, '')), '');
  v_address := nullif(btrim(coalesce(p_payload ->> 'address', v_profile.address_text, '')), '');
  v_phone := nullif(btrim(coalesce(p_payload ->> 'phone', v_profile.phone_text, '')), '');
  v_hours := coalesce(p_payload -> 'working_hours', v_profile.working_hours);
  v_verified := coalesce((p_payload ->> 'verified')::boolean, v_profile.data_verified_at is not null);
  v_tracking := coalesce((p_payload ->> 'duty_tracking')::boolean, v_profile.duty_tracking);
  v_notes := nullif(btrim(coalesce(p_payload ->> 'notes', v_profile.notes, '')), '');
  v_source := coalesce(nullif(p_payload ->> 'source', ''), 'manual_verified');

  v_lat := nullif(p_payload ->> 'lat', '')::double precision;
  v_lng := nullif(p_payload ->> 'lng', '')::double precision;

  if v_lat is not null or v_lng is not null then
    if v_lat is null or v_lng is null then
      raise exception 'invalid_coordinates' using errcode = '22023';
    end if;
    if v_lat < 40.55 or v_lat > 41.25 or v_lng < 38.90 or v_lng > 40.70 then
      raise exception 'coordinates_out_of_bounds' using errcode = '22023';
    end if;
    update public.places
       set lat = v_lat,
           lng = v_lng,
           geog = ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography
     where id = p_place_id;
  end if;

  update public.pharmacy_profiles
     set neighborhood = v_neighborhood,
         neighborhood_source = case
           when v_neighborhood is null then null
           when v_neighborhood is distinct from pharmacy_profiles.neighborhood then v_source
           else pharmacy_profiles.neighborhood_source
         end,
         address_text = v_address,
         phone_text = v_phone,
         working_hours = coalesce(v_hours, '{}'::jsonb),
         working_hours_source = case
           when coalesce(v_hours, '{}'::jsonb) = '{}'::jsonb then null
           when v_hours is distinct from pharmacy_profiles.working_hours then v_source
           else pharmacy_profiles.working_hours_source
         end,
         duty_tracking = v_tracking,
         data_verified_at = case when v_verified then coalesce(pharmacy_profiles.data_verified_at, now()) else null end,
         notes = v_notes
   where place_id = p_place_id;

  perform public.tz_admin_audit(
    'pharmacy.update',
    'Eczane kaydı güncellendi',
    'pharmacy',
    p_place_id::text,
    jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p_payload) k)),
    'success'
  );

  return public.admin_pharmacy_get(p_place_id);
end;
$$;

revoke all on function public.admin_pharmacy_update(uuid, jsonb) from public, anon;
grant execute on function public.admin_pharmacy_update(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 21. Yönetim: nöbet yönetimi
-- ---------------------------------------------------------------------------
create or replace function public.admin_pharmacy_duty_list(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
  v_date date := coalesce(p_date, public.pharmacy_istanbul_today());
  v_after date := coalesce(p_date, public.pharmacy_istanbul_today()) + 1;
begin
  return jsonb_build_object(
    'date', v_date,
    'today', public.pharmacy_istanbul_today(),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'place_id', s.place_id,
        'name', p.name,
        'slug', pp.slug,
        'district', d.name,
        'neighborhood', pp.neighborhood,
        'duty_date', s.duty_date,
        'starts_at', s.starts_at,
        'ends_at', s.ends_at,
        'status', s.status,
        'source_name', src.name,
        'source_id', s.source_id,
        'verified_at', s.verified_at,
        'fetched_at', s.fetched_at,
        'note', s.note
      ) order by s.starts_at, p.name)
      from public.pharmacy_duty_schedules s
      join public.places p on p.id = s.place_id
      join public.districts d on d.id = p.district_id
      join public.pharmacy_profiles pp on pp.place_id = p.id
      left join public.pharmacy_sources src on src.id = s.source_id
      where s.duty_date in (v_date, v_after)
    ), '[]'::jsonb),
    'unmatched', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'raw_name', u.raw_name,
        'raw_district', u.raw_district,
        'raw_neighborhood', u.raw_neighborhood,
        'duty_date', u.duty_date,
        'status', u.status
      ) order by u.created_at desc)
      from public.pharmacy_unmatched_duty u
      where u.status = 'pending'
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', src.id,
        'key', src.key,
        'name', src.name,
        'is_enabled', src.is_enabled,
        'verified_license', src.verified_license,
        'last_success_at', src.last_success_at,
        'last_error', src.last_error
      ) order by src.priority)
      from public.pharmacy_sources src
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_pharmacy_duty_list(date) from public, anon;
grant execute on function public.admin_pharmacy_duty_list(date) to authenticated, service_role;

create or replace function public.admin_pharmacy_duty_upsert(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.manage');
  v_place_id uuid := nullif(p_payload ->> 'place_id', '')::uuid;
  v_date date := nullif(p_payload ->> 'duty_date', '')::date;
  v_start time := coalesce(nullif(p_payload ->> 'start_time', '')::time, '18:00'::time);
  v_end time := coalesce(nullif(p_payload ->> 'end_time', '')::time, '08:00'::time);
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_status text := coalesce(nullif(p_payload ->> 'status', ''), 'confirmed');
  v_source_id uuid := nullif(p_payload ->> 'source_id', '')::uuid;
  v_id uuid;
begin
  if v_place_id is null or v_date is null then
    raise exception 'missing_fields' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pharmacy_profiles where place_id = v_place_id) then
    raise exception 'pharmacy_not_found' using errcode = 'P0002';
  end if;
  if v_status not in ('confirmed', 'unverified', 'conflict', 'cancelled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  v_start_at := (v_date::timestamp + v_start) at time zone 'Europe/Istanbul';
  v_end_at := (v_date::timestamp + v_end) at time zone 'Europe/Istanbul';
  if v_end_at <= v_start_at then
    v_end_at := v_end_at + interval '1 day';
  end if;
  if v_end_at > v_start_at + interval '30 hours' then
    raise exception 'invalid_window' using errcode = '22023';
  end if;

  insert into public.pharmacy_duty_schedules (
    place_id, duty_date, starts_at, ends_at, source_id, status, verified_at, note
  ) values (
    v_place_id, v_date, v_start_at, v_end_at, v_source_id, v_status,
    case when v_status = 'confirmed' then now() else null end,
    nullif(btrim(coalesce(p_payload ->> 'note', '')), '')
  )
  on conflict (place_id, starts_at) do update
    set ends_at = excluded.ends_at,
        source_id = coalesce(excluded.source_id, public.pharmacy_duty_schedules.source_id),
        status = excluded.status,
        verified_at = excluded.verified_at,
        note = excluded.note,
        fetched_at = now()
  returning id into v_id;

  update public.pharmacy_profiles
     set duty_verified_at = now()
   where place_id = v_place_id;

  perform public.tz_admin_audit(
    'pharmacy.duty.upsert',
    'Nöbet kaydı kaydedildi',
    'pharmacy_duty',
    v_id::text,
    jsonb_build_object('place_id', v_place_id, 'duty_date', v_date, 'status', v_status),
    'success'
  );

  return jsonb_build_object('id', v_id, 'starts_at', v_start_at, 'ends_at', v_end_at, 'status', v_status);
end;
$$;

revoke all on function public.admin_pharmacy_duty_upsert(jsonb) from public, anon;
grant execute on function public.admin_pharmacy_duty_upsert(jsonb) to authenticated, service_role;

create or replace function public.admin_pharmacy_duty_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.manage');
  v_row public.pharmacy_duty_schedules%rowtype;
begin
  select * into v_row from public.pharmacy_duty_schedules where id = p_id;
  if v_row.id is null then
    raise exception 'duty_not_found' using errcode = 'P0002';
  end if;
  delete from public.pharmacy_duty_schedules where id = p_id;
  perform public.tz_admin_audit(
    'pharmacy.duty.delete', 'Nöbet kaydı silindi', 'pharmacy_duty', p_id::text,
    jsonb_build_object('place_id', v_row.place_id, 'duty_date', v_row.duty_date), 'success'
  );
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_pharmacy_duty_delete(uuid) from public, anon;
grant execute on function public.admin_pharmacy_duty_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 22. Yönetim: kaynak yönetimi
-- ---------------------------------------------------------------------------
create or replace function public.admin_pharmacy_sources()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'key', s.key,
        'name', s.name,
        'kind', s.kind,
        'homepage_url', s.homepage_url,
        'terms_url', s.terms_url,
        'license_note', s.license_note,
        'attribution_text', s.attribution_text,
        'api_secret_ref', s.api_secret_ref,
        'has_field_map', s.field_map <> '{}'::jsonb,
        'is_primary', s.is_primary,
        'is_enabled', s.is_enabled,
        'priority', s.priority,
        'sync_interval_minutes', s.sync_interval_minutes,
        'verified_license', s.verified_license,
        'last_run_at', s.last_run_at,
        'last_success_at', s.last_success_at,
        'last_error', s.last_error,
        'last_error_at', s.last_error_at
      ) order by s.priority)
      from public.pharmacy_sources s
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'source_key', l.source_key,
        'run_kind', l.run_kind,
        'status', l.status,
        'records_received', l.records_received,
        'records_matched', l.records_matched,
        'records_unmatched', l.records_unmatched,
        'records_rejected', l.records_rejected,
        'duty_written', l.duty_written,
        'conflicts', l.conflicts,
        'error_code', l.error_code,
        'error_message', left(coalesce(l.error_message, ''), 400),
        'duration_ms', l.duration_ms,
        'started_at', l.started_at
      ) order by l.started_at desc)
      from (select * from public.pharmacy_sync_logs order by started_at desc limit 40) l
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_pharmacy_sources() from public, anon;
grant execute on function public.admin_pharmacy_sources() to authenticated, service_role;

create or replace function public.admin_pharmacy_source_upsert(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.manage');
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_key text := lower(nullif(btrim(coalesce(p_payload ->> 'key', '')), ''));
  v_enabled boolean := coalesce((p_payload ->> 'enabled')::boolean, false);
  v_verified boolean := coalesce((p_payload ->> 'verified_license')::boolean, false);
  v_primary boolean := coalesce((p_payload ->> 'is_primary')::boolean, false);
  v_secret text := nullif(btrim(coalesce(p_payload ->> 'api_secret_ref', '')), '');
begin
  if v_secret is not null and v_secret ~* '(key|token|secret)=' then
    raise exception 'secret_must_be_env_name' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.pharmacy_sources (
      key, name, kind, homepage_url, terms_url, license_note, attribution_text,
      api_secret_ref, field_map, is_primary, is_enabled, priority,
      sync_interval_minutes, verified_license, created_by
    ) values (
      v_key,
      coalesce(nullif(btrim(p_payload ->> 'name'), ''), v_key),
      coalesce(nullif(p_payload ->> 'kind', ''), 'manual'),
      nullif(btrim(p_payload ->> 'homepage_url'), ''),
      nullif(btrim(p_payload ->> 'terms_url'), ''),
      nullif(btrim(p_payload ->> 'license_note'), ''),
      nullif(btrim(p_payload ->> 'attribution_text'), ''),
      v_secret,
      coalesce(p_payload -> 'field_map', '{}'::jsonb),
      v_primary, v_enabled,
      coalesce((p_payload ->> 'priority')::smallint, 100),
      coalesce((p_payload ->> 'sync_interval_minutes')::integer, 60),
      v_verified, v_uid
    )
    returning id into v_id;
  else
    update public.pharmacy_sources
       set name = coalesce(nullif(btrim(p_payload ->> 'name'), ''), name),
           kind = coalesce(nullif(p_payload ->> 'kind', ''), kind),
           homepage_url = nullif(btrim(coalesce(p_payload ->> 'homepage_url', homepage_url)), ''),
           terms_url = nullif(btrim(coalesce(p_payload ->> 'terms_url', terms_url)), ''),
           license_note = nullif(btrim(coalesce(p_payload ->> 'license_note', license_note)), ''),
           attribution_text = nullif(btrim(coalesce(p_payload ->> 'attribution_text', attribution_text)), ''),
           api_secret_ref = coalesce(v_secret, api_secret_ref),
           field_map = coalesce(p_payload -> 'field_map', field_map),
           is_primary = v_primary,
           is_enabled = v_enabled,
           priority = coalesce((p_payload ->> 'priority')::smallint, priority),
           sync_interval_minutes = coalesce((p_payload ->> 'sync_interval_minutes')::integer, sync_interval_minutes),
           verified_license = v_verified
     where id = v_id;
  end if;

  if v_primary then
    update public.pharmacy_sources set is_primary = false where id <> v_id and is_primary;
  end if;

  perform public.tz_admin_audit(
    'pharmacy.source.upsert', 'Eczane veri kaynağı kaydedildi', 'pharmacy_source', v_id::text,
    jsonb_build_object('enabled', v_enabled, 'verified_license', v_verified, 'primary', v_primary), 'success'
  );

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.admin_pharmacy_source_upsert(jsonb) from public, anon;
grant execute on function public.admin_pharmacy_source_upsert(jsonb) to authenticated, service_role;

create or replace function public.admin_pharmacy_source_test(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
  v_source public.pharmacy_sources%rowtype;
begin
  select * into v_source from public.pharmacy_sources where id = p_id;
  if v_source.id is null then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;

  -- Bağlantı testi sunucu tarafında (edge function) yapılır. Burada yalnızca
  -- yapılandırmanın çalışmaya hazır olup olmadığı raporlanır; sahte "bağlı"
  -- sonucu üretilmez.
  return jsonb_build_object(
    'id', v_source.id,
    'key', v_source.key,
    'ready', v_source.is_enabled and v_source.verified_license
      and (v_source.kind <> 'commercial_api' or v_source.api_secret_ref is not null),
    'checks', jsonb_build_array(
      jsonb_build_object('key', 'enabled', 'ok', v_source.is_enabled, 'label', 'Kaynak etkin'),
      jsonb_build_object('key', 'license', 'ok', v_source.verified_license, 'label', 'Kullanım izni doğrulandı'),
      jsonb_build_object('key', 'secret', 'ok', v_source.kind <> 'commercial_api' or v_source.api_secret_ref is not null,
        'label', 'Sunucu tarafı API anahtarı tanımlı'),
      jsonb_build_object('key', 'field_map', 'ok', v_source.kind = 'manual' or v_source.field_map <> '{}'::jsonb,
        'label', 'Veri alanı eşleştirmesi tanımlı')
    ),
    'last_success_at', v_source.last_success_at,
    'last_error', v_source.last_error
  );
end;
$$;

revoke all on function public.admin_pharmacy_source_test(uuid) from public, anon;
grant execute on function public.admin_pharmacy_source_test(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 23. Yönetim: nöbet listesi içe aktarma (senkronizasyon çekirdeği)
-- ---------------------------------------------------------------------------
create or replace function public.admin_pharmacy_duty_apply(
  p_source_key text,
  p_records jsonb,
  p_run_kind text default 'manual',
  p_mark_verified boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.manage');
  v_source public.pharmacy_sources%rowtype;
  v_settings public.pharmacy_settings%rowtype;
  v_log_id uuid;
  v_started timestamptz := clock_timestamp();
  v_rec jsonb;
  v_received integer := 0;
  v_matched integer := 0;
  v_unmatched integer := 0;
  v_rejected integer := 0;
  v_written integer := 0;
  v_conflicts integer := 0;
  v_name text;
  v_district text;
  v_neighborhood text;
  v_address text;
  v_phone text;
  v_phone_digits text;
  v_lat double precision;
  v_lng double precision;
  v_date date;
  v_start_time time;
  v_end_time time;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_core text;
  v_place_id uuid;
  v_duty_id uuid;
  v_used_default boolean;
  v_status text;
  v_source_ref text;
  v_conflict boolean;
  v_run text := coalesce(nullif(p_run_kind, ''), 'manual');
begin
  if v_run not in ('scheduled', 'manual', 'import') then
    raise exception 'invalid_run_kind' using errcode = '22023';
  end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'records_must_be_array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_records) > 5000 then
    raise exception 'too_many_records' using errcode = '22023';
  end if;

  select * into v_source from public.pharmacy_sources where key = lower(btrim(p_source_key));
  if v_source.id is null then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;
  select * into v_settings from public.pharmacy_settings where id = 1;

  if v_run = 'scheduled' then
    if not v_source.is_enabled then
      raise exception 'source_disabled' using errcode = '42501';
    end if;
    if not v_source.verified_license then
      raise exception 'license_not_verified' using errcode = '42501';
    end if;
  end if;

  insert into public.pharmacy_sync_logs (source_id, source_key, run_kind, status, started_at, actor_id)
  values (v_source.id, v_source.key, v_run, 'success', v_started, v_uid)
  returning id into v_log_id;

  for v_rec in select * from jsonb_array_elements(p_records)
  loop
    v_received := v_received + 1;
    v_place_id := null;
    begin
      v_name := nullif(btrim(coalesce(v_rec ->> 'name', '')), '');
      v_district := nullif(btrim(coalesce(v_rec ->> 'district', '')), '');
      if v_name is null then
        v_rejected := v_rejected + 1;
        continue;
      end if;

      v_neighborhood := nullif(btrim(coalesce(v_rec ->> 'neighborhood', '')), '');
      v_address := nullif(btrim(coalesce(v_rec ->> 'address', '')), '');
      v_phone := nullif(btrim(coalesce(v_rec ->> 'phone', '')), '');
      v_phone_digits := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');
      v_lat := nullif(v_rec ->> 'lat', '')::double precision;
      v_lng := nullif(v_rec ->> 'lng', '')::double precision;
      v_source_ref := nullif(btrim(coalesce(v_rec ->> 'source_ref', '')), '');

      v_date := coalesce(nullif(v_rec ->> 'duty_date', '')::date, public.pharmacy_istanbul_today());
      v_start_time := nullif(v_rec ->> 'start_time', '')::time;
      v_end_time := nullif(v_rec ->> 'end_time', '')::time;
      v_used_default := false;
      if v_start_time is null then
        v_start_time := v_settings.default_duty_start;
        v_used_default := true;
      end if;
      if v_end_time is null then
        v_end_time := v_settings.default_duty_end;
        v_used_default := true;
      end if;

      v_start_at := (v_date::timestamp + v_start_time) at time zone 'Europe/Istanbul';
      v_end_at := (v_date::timestamp + v_end_time) at time zone 'Europe/Istanbul';
      if v_end_at <= v_start_at then
        v_end_at := v_end_at + interval '1 day';
      end if;
      if v_end_at > v_start_at + interval '30 hours' then
        v_rejected := v_rejected + 1;
        continue;
      end if;

      -- Eşleştirme 1: aynı ilçede aynı çekirdek ad
      v_core := public.pharmacy_core_name(v_name);
      select p.id into v_place_id
      from public.places p
      join public.place_categories c on c.id = p.category_id
      join public.districts d on d.id = p.district_id
      where c.slug = 'eczane'
        and p.status = 'published'
        and public.pharmacy_core_name(p.name) = v_core
        and (v_district is null or lower(d.name) = lower(v_district))
      order by p.review_count desc, p.name
      limit 1;

      -- Eşleştirme 2: telefon
      if v_place_id is null and v_phone_digits is not null and char_length(v_phone_digits) >= 10 then
        select p.id into v_place_id
        from public.places p
        join public.place_categories c on c.id = p.category_id
        where c.slug = 'eczane'
          and p.status = 'published'
          and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_phone_digits
        limit 1;
      end if;

      -- Eşleştirme 3: 300 m içinde ad benzerliği
      if v_place_id is null and v_lat is not null and v_lng is not null then
        select p.id into v_place_id
        from public.places p
        join public.place_categories c on c.id = p.category_id
        where c.slug = 'eczane'
          and p.status = 'published'
          and ST_DWithin(p.geog, ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography, 300)
          and (
            public.pharmacy_core_name(p.name) = v_core
            or public.pharmacy_core_name(p.name) like '%' || v_core || '%'
            or v_core like '%' || public.pharmacy_core_name(p.name) || '%'
          )
        order by ST_Distance(p.geog, ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography)
        limit 1;
      end if;

      if v_place_id is null then
        v_unmatched := v_unmatched + 1;
        insert into public.pharmacy_unmatched_duty (
          source_id, sync_log_id, raw_name, raw_district, raw_neighborhood,
          raw_address, raw_phone, duty_date, starts_at, ends_at
        ) values (
          v_source.id, v_log_id, v_name, v_district, v_neighborhood,
          v_address, v_phone, v_date, v_start_at, v_end_at
        )
        on conflict (source_id, lower(raw_name), duty_date) do update
          set raw_district = excluded.raw_district,
              raw_neighborhood = excluded.raw_neighborhood,
              raw_address = excluded.raw_address,
              raw_phone = excluded.raw_phone,
              starts_at = excluded.starts_at,
              ends_at = excluded.ends_at;
        continue;
      end if;

      v_matched := v_matched + 1;

      v_conflict := exists (
        select 1 from public.pharmacy_duty_schedules s
        where s.place_id = v_place_id
          and s.starts_at < v_end_at
          and s.ends_at > v_start_at
          and s.source_id is distinct from v_source.id
          and s.status in ('confirmed', 'unverified')
      );
      if v_conflict then
        v_conflicts := v_conflicts + 1;
        update public.pharmacy_duty_schedules
           set status = 'conflict'
         where place_id = v_place_id
           and starts_at < v_end_at
           and ends_at > v_start_at
           and source_id is distinct from v_source.id
           and status in ('confirmed', 'unverified');
      end if;

      v_status := case
        when v_conflict then 'conflict'
        when p_mark_verified and not v_used_default then 'confirmed'
        else 'unverified'
      end;

      insert into public.pharmacy_duty_schedules (
        place_id, duty_date, starts_at, ends_at, source_id, source_ref,
        status, fetched_at, verified_at
      ) values (
        v_place_id, v_date, v_start_at, v_end_at, v_source.id, v_source_ref,
        v_status, now(), case when v_status = 'confirmed' then now() else null end
      )
      on conflict (place_id, starts_at) do update
        set ends_at = excluded.ends_at,
            source_id = excluded.source_id,
            source_ref = coalesce(excluded.source_ref, public.pharmacy_duty_schedules.source_ref),
            status = case
              when public.pharmacy_duty_schedules.status = 'confirmed' and excluded.status = 'unverified'
                then 'confirmed'
              else excluded.status
            end,
            fetched_at = now(),
            verified_at = case
              when excluded.status = 'confirmed' then now()
              else public.pharmacy_duty_schedules.verified_at
            end
      returning id into v_duty_id;

      v_written := v_written + 1;

      -- Profil zenginleştirme: yalnızca doğrulanan kayıtta ve yalnızca boş alanlar.
      if p_mark_verified then
        update public.pharmacy_profiles
           set neighborhood = coalesce(neighborhood, v_neighborhood),
               neighborhood_source = case
                 when neighborhood is null and v_neighborhood is not null then 'official_list'
                 else neighborhood_source
               end,
               address_text = coalesce(address_text, v_address),
               phone_text = coalesce(phone_text, v_phone),
               data_verified_at = coalesce(data_verified_at, now()),
               duty_verified_at = now()
         where place_id = v_place_id;
      end if;
    exception when others then
      v_rejected := v_rejected + 1;
    end;
  end loop;

  update public.pharmacy_sources
     set last_run_at = now(),
         last_success_at = case when v_rejected = 0 then now() else last_success_at end,
         last_error = null
   where id = v_source.id;

  update public.pharmacy_sync_logs
     set status = case
           when v_rejected > 0 and v_written = 0 then 'failed'
           when v_rejected > 0 or v_unmatched > 0 then 'partial'
           else 'success'
         end,
         records_received = v_received,
         records_matched = v_matched,
         records_unmatched = v_unmatched,
         records_rejected = v_rejected,
         duty_written = v_written,
         conflicts = v_conflicts,
         finished_at = clock_timestamp(),
         duration_ms = (extract(epoch from clock_timestamp() - v_started) * 1000)::integer
   where id = v_log_id;

  perform public.tz_admin_audit(
    'pharmacy.duty.apply',
    'Nöbet listesi içe aktarıldı',
    'pharmacy_sync',
    v_log_id::text,
    jsonb_build_object(
      'source', v_source.key,
      'received', v_received,
      'written', v_written,
      'unmatched', v_unmatched,
      'rejected', v_rejected
    ),
    case when v_rejected > 0 and v_written = 0 then 'failure' else 'success' end
  );

  return jsonb_build_object(
    'log_id', v_log_id,
    'source', v_source.key,
    'received', v_received,
    'matched', v_matched,
    'unmatched', v_unmatched,
    'rejected', v_rejected,
    'written', v_written,
    'conflicts', v_conflicts,
    'duration_ms', (extract(epoch from clock_timestamp() - v_started) * 1000)::integer
  );
end;
$$;

revoke all on function public.admin_pharmacy_duty_apply(text, jsonb, text, boolean) from public, anon;
grant execute on function public.admin_pharmacy_duty_apply(text, jsonb, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 24. Yönetim: eşleşmeyen kayıt kuyruğu
-- ---------------------------------------------------------------------------
create or replace function public.admin_pharmacy_unmatched_resolve(
  p_id uuid,
  p_place_id uuid default null,
  p_decision text default 'reject'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.manage');
  v_row public.pharmacy_unmatched_duty%rowtype;
begin
  select * into v_row from public.pharmacy_unmatched_duty where id = p_id;
  if v_row.id is null then
    raise exception 'record_not_found' using errcode = 'P0002';
  end if;
  if p_decision not in ('link', 'reject') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  if p_decision = 'link' then
    if p_place_id is null or not exists (select 1 from public.pharmacy_profiles where place_id = p_place_id) then
      raise exception 'pharmacy_not_found' using errcode = 'P0002';
    end if;
    insert into public.pharmacy_duty_schedules (
      place_id, duty_date, starts_at, ends_at, source_id, source_ref, status, fetched_at
    ) values (
      p_place_id, v_row.duty_date,
      coalesce(v_row.starts_at, (v_row.duty_date::timestamp + '18:00'::time) at time zone 'Europe/Istanbul'),
      coalesce(v_row.ends_at, ((v_row.duty_date + 1)::timestamp + '08:00'::time) at time zone 'Europe/Istanbul'),
      v_row.source_id, v_row.raw_name, 'unverified', now()
    )
    on conflict (place_id, starts_at) do update
      set fetched_at = now(),
          source_id = coalesce(excluded.source_id, public.pharmacy_duty_schedules.source_id);

    update public.pharmacy_unmatched_duty
       set status = 'linked', linked_place_id = p_place_id, reviewed_by = v_uid, reviewed_at = now()
     where id = p_id;
  else
    update public.pharmacy_unmatched_duty
       set status = 'rejected', reviewed_by = v_uid, reviewed_at = now()
     where id = p_id;
  end if;

  perform public.tz_admin_audit(
    'pharmacy.unmatched.resolve', 'Eşleşmeyen nöbet kaydı incelendi', 'pharmacy_unmatched', p_id::text,
    jsonb_build_object('decision', p_decision, 'place_id', p_place_id), 'success'
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_pharmacy_unmatched_resolve(uuid, uuid, text) from public, anon;
grant execute on function public.admin_pharmacy_unmatched_resolve(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 25. Yönetim: yorumlar, şikâyetler, sahiplenme
-- ---------------------------------------------------------------------------
create or replace function public.admin_pharmacy_reviews_list(
  p_status text default null,
  p_query text default null,
  p_limit integer default 60,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'place_id', r.place_id,
        'pharmacy_name', p.name,
        'pharmacy_slug', pp.slug,
        'district', d.name,
        'rating', r.rating,
        'body', r.body,
        'status', r.status,
        'helpful_count', r.helpful_count,
        'created_at', r.created_at,
        'author_username', pr.username,
        'author_display_name', pr.display_name,
        'report_count', (select count(*) from public.content_reports cr where cr.target_type = 'place_review' and cr.target_id = r.id and cr.status = 'pending')
      ) order by r.created_at desc)
      from (
        select * from public.place_reviews
        where (p_status is null or status = p_status)
        order by created_at desc
        limit v_limit offset v_offset
      ) r
      join public.places p on p.id = r.place_id
      join public.place_categories c on c.id = p.category_id and c.slug = 'eczane'
      join public.districts d on d.id = p.district_id
      join public.pharmacy_profiles pp on pp.place_id = p.id
      join public.profiles pr on pr.id = r.author_id
      where v_query is null or p.name ilike '%' || v_query || '%'
    ), '[]'::jsonb),
    'total', (
      select count(*)
      from public.place_reviews r
      join public.places p on p.id = r.place_id
      join public.place_categories c on c.id = p.category_id and c.slug = 'eczane'
      where (p_status is null or r.status = p_status)
        and (v_query is null or p.name ilike '%' || v_query || '%')
    )
  );
end;
$$;

revoke all on function public.admin_pharmacy_reviews_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_pharmacy_reviews_list(text, text, integer, integer) to authenticated, service_role;

create or replace function public.admin_pharmacy_reports_list(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cr.id,
        'reason', cr.reason,
        'details', cr.details,
        'status', cr.status,
        'created_at', cr.created_at,
        'review_id', cr.target_id,
        'review_body', r.body,
        'review_rating', r.rating,
        'pharmacy_name', p.name,
        'pharmacy_slug', pp.slug
      ) order by cr.created_at desc)
      from public.content_reports cr
      join public.place_reviews r on r.id = cr.target_id
      join public.places p on p.id = r.place_id
      join public.place_categories c on c.id = p.category_id and c.slug = 'eczane'
      join public.pharmacy_profiles pp on pp.place_id = p.id
      where cr.target_type = 'place_review'
        and (p_status is null or cr.status = p_status)
      limit 100
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_pharmacy_reports_list(text) from public, anon;
grant execute on function public.admin_pharmacy_reports_list(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 26. Yönetim: bildirim önizleme ve gönderim
-- ---------------------------------------------------------------------------
create or replace function public.admin_pharmacy_notifications_preview(
  p_district text default null,
  p_neighborhood text default null,
  p_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
  v_date date := coalesce(p_date, public.pharmacy_istanbul_today());
  v_notice jsonb;
  v_names text;
  v_title text;
  v_body text;
  v_enabled integer;
begin
  select count(*) into v_enabled
  from public.pharmacy_notification_preferences
  where enabled
    and (p_district is null or lower(coalesce(district, '')) = lower(btrim(p_district)) or district is null);

  v_notice := public.pharmacy_duty_notice(p_district, p_neighborhood);

  select string_agg(e ->> 'name', ', ' order by e ->> 'starts_at')
  into v_names
  from jsonb_array_elements(coalesce(v_notice -> 'items', '[]'::jsonb)) e;

  if coalesce((v_notice ->> 'count')::integer, 0) = 0 then
    v_title := 'Nöbet listesi henüz yayımlanmadı';
    v_body := 'Seçili bölge için doğrulanmış nöbet kaydı bulunmuyor. Eczane adı içeren bildirim gönderilmez.';
  elsif coalesce((v_notice ->> 'stale')::boolean, true) then
    v_title := 'Nöbet verisi güncel değil';
    v_body := 'Kaynak tazelik eşiğini aştı. Eczane adı içeren bildirim gönderilmez; önce senkronizasyon çalıştırılmalı.';
  elsif p_neighborhood is not null and jsonb_array_length(v_notice -> 'items') = 1 then
    v_title := format('💊 Bugün %s Mahallesi''nde %s nöbetçi', p_neighborhood, v_names);
    v_body := 'Nöbet saatleri, adres, telefon ve yol tarifi Trabzone''da. Yola çıkmadan önce eczaneyi telefonla arayın.';
  else
    v_title := format('💊 %s: bugün %s nöbetçi eczane', coalesce(p_district, 'Trabzon'), v_notice ->> 'count');
    v_body := format('%s. Adres, telefon ve yol tarifi için dokunun. Yola çıkmadan önce arayarak teyit edin.', coalesce(v_names, ''));
  end if;

  return jsonb_build_object(
    'date', v_date,
    'district', p_district,
    'neighborhood', p_neighborhood,
    'eligible_subscribers', v_enabled,
    'notice_count', coalesce((v_notice ->> 'count')::integer, 0),
    'stale', coalesce((v_notice ->> 'stale')::boolean, true),
    'sendable', coalesce((v_notice ->> 'count')::integer, 0) > 0 and not coalesce((v_notice ->> 'stale')::boolean, true),
    'title', v_title,
    'body', v_body,
    'already_sent', (
      select count(*) from public.pharmacy_notification_log l
      where l.duty_date = v_date
        and (p_district is null or l.district is null or lower(l.district) = lower(btrim(p_district)))
    )
  );
end;
$$;

revoke all on function public.admin_pharmacy_notifications_preview(text, text, date) from public, anon;
grant execute on function public.admin_pharmacy_notifications_preview(text, text, date) to authenticated, service_role;

create or replace function public.admin_pharmacy_notifications_dispatch(
  p_date date default null,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.notify');
  v_settings public.pharmacy_settings%rowtype;
  v_date date := coalesce(p_date, public.pharmacy_istanbul_today());
  v_now_local timestamp := now() at time zone 'Europe/Istanbul';
  v_hour integer := extract(hour from v_now_local)::integer;
  v_pref public.pharmacy_notification_preferences%rowtype;
  v_notice jsonb;
  v_count integer;
  v_stale boolean;
  v_names text;
  v_title text;
  v_body text;
  v_route text;
  v_notification_id uuid;
  v_sent integer := 0;
  v_skipped integer := 0;
  v_eligible integer := 0;
  v_samples jsonb := '[]'::jsonb;
begin
  select * into v_settings from public.pharmacy_settings where id = 1;
  if not coalesce(v_settings.notifications_enabled, false) then
    raise exception 'notifications_disabled' using errcode = '42501';
  end if;

  for v_pref in
    select * from public.pharmacy_notification_preferences
    where enabled
      and notify_hour <= v_hour
    order by created_at
  loop
    v_eligible := v_eligible + 1;

    if exists (
      select 1 from public.pharmacy_notification_log l
      where l.user_id = v_pref.user_id and l.duty_date = v_date and l.channel = 'in_app'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_notice := public.pharmacy_duty_notice(v_pref.district, v_pref.neighborhood);
    v_count := coalesce((v_notice ->> 'count')::integer, 0);
    v_stale := coalesce((v_notice ->> 'stale')::boolean, true);

    -- Veri yoksa veya tazelik eşiği aşıldıysa eczane adı içeren bildirim gitmez.
    if v_count = 0 or v_stale then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select string_agg(e ->> 'name', ', ' order by e ->> 'starts_at')
    into v_names
    from jsonb_array_elements(v_notice -> 'items') e;

    if v_pref.neighborhood is not null and v_count = 1 then
      v_title := format('💊 Bugün %s Mahallesi''nde %s nöbetçi', v_pref.neighborhood, v_names);
      v_body := 'Nöbet saatleri, adres ve yol tarifi Trabzone''da. Yola çıkmadan önce eczaneyi arayarak teyit edin.';
    else
      v_title := format('💊 %s: bugün %s nöbetçi eczane', coalesce(v_pref.district, 'Trabzon'), v_count);
      v_body := format('%s. Adres ve yol tarifi için dokunun.', coalesce(v_names, ''));
    end if;

    if char_length(v_title) > 160 then
      v_title := left(v_title, 157) || '…';
    end if;

    v_route := '/eczaneler' || case when v_pref.district is not null
      then '?district=' || replace(v_pref.district, ' ', '%20') else '' end;

    if p_dry_run then
      if jsonb_array_length(v_samples) < 10 then
        v_samples := v_samples || jsonb_build_array(jsonb_build_object(
          'user_id', v_pref.user_id,
          'district', v_pref.district,
          'neighborhood', v_pref.neighborhood,
          'title', v_title,
          'body', v_body,
          'route', v_route
        ));
      end if;
    else
      insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, route)
      values (v_pref.user_id, 'pharmacy', v_title, v_body, 'pharmacy_duty_day', v_date::text, v_route)
      returning id into v_notification_id;

      insert into public.pharmacy_notification_log (
        user_id, duty_date, district, neighborhood, duty_count, title, body, channel, notification_id
      ) values (
        v_pref.user_id, v_date, v_pref.district, v_pref.neighborhood, v_count, v_title, v_body, 'in_app', v_notification_id
      )
      on conflict (user_id, duty_date, channel) do nothing;

      v_sent := v_sent + 1;
    end if;
  end loop;

  if not p_dry_run then
    perform public.tz_admin_audit(
      'pharmacy.notify.dispatch', 'Eczane nöbet bildirimleri gönderildi', 'pharmacy_notification', v_date::text,
      jsonb_build_object('sent', v_sent, 'skipped', v_skipped, 'eligible', v_eligible), 'success'
    );
  end if;

  return jsonb_build_object(
    'date', v_date,
    'dry_run', p_dry_run,
    'eligible', v_eligible,
    'sent', v_sent,
    'skipped', v_skipped,
    'samples', v_samples,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.admin_pharmacy_notifications_dispatch(date, boolean) from public, anon;
grant execute on function public.admin_pharmacy_notifications_dispatch(date, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 27. Yönetim: ayarlar ve veri kalitesi
-- ---------------------------------------------------------------------------
create or replace function public.admin_pharmacy_settings_update(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.manage');
begin
  update public.pharmacy_settings
     set stale_after_hours = coalesce((p_payload ->> 'stale_after_hours')::integer, stale_after_hours),
         default_notify_hour = coalesce((p_payload ->> 'default_notify_hour')::smallint, default_notify_hour),
         notifications_enabled = coalesce((p_payload ->> 'notifications_enabled')::boolean, notifications_enabled),
         require_verified_duty = coalesce((p_payload ->> 'require_verified_duty')::boolean, require_verified_duty),
         default_duty_start = coalesce((p_payload ->> 'default_duty_start')::time, default_duty_start),
         default_duty_end = coalesce((p_payload ->> 'default_duty_end')::time, default_duty_end),
         guide_intro = coalesce(nullif(btrim(p_payload ->> 'guide_intro'), ''), guide_intro),
         updated_by = v_uid
   where id = 1;

  perform public.tz_admin_audit(
    'pharmacy.settings.update', 'Eczane ayarları güncellendi', 'pharmacy_settings', '1',
    jsonb_build_object('keys', (select jsonb_agg(k) from jsonb_object_keys(p_payload) k)), 'success'
  );

  return (select to_jsonb(s) from public.pharmacy_settings s where s.id = 1);
end;
$$;

revoke all on function public.admin_pharmacy_settings_update(jsonb) from public, anon;
grant execute on function public.admin_pharmacy_settings_update(jsonb) to authenticated, service_role;

create or replace function public.admin_pharmacy_quality()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
begin
  return jsonb_build_object(
    'missing', jsonb_build_object(
      'address', (select count(*) from public.pharmacy_profiles pp join public.places p on p.id = pp.place_id where coalesce(pp.address_text, p.address) is null),
      'phone', (select count(*) from public.pharmacy_profiles pp join public.places p on p.id = pp.place_id where coalesce(pp.phone_text, p.phone) is null),
      'neighborhood', (select count(*) from public.pharmacy_profiles where neighborhood is null),
      'hours', (select count(*) from public.pharmacy_profiles where working_hours = '{}'::jsonb)
    ),
    'duplicates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'district', t.district,
        'core_name', t.core_name,
        'count', t.cnt,
        'items', t.items
      ) order by t.cnt desc)
      from (
        select d.name as district,
               public.pharmacy_core_name(p.name) as core_name,
               count(*) as cnt,
               jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'slug', pp.slug, 'phone', coalesce(pp.phone_text, p.phone)) order by p.name) as items
        from public.places p
        join public.place_categories c on c.id = p.category_id
        join public.districts d on d.id = p.district_id
        join public.pharmacy_profiles pp on pp.place_id = p.id
        where c.slug = 'eczane' and p.status = 'published'
        group by d.name, public.pharmacy_core_name(p.name)
        having count(*) > 1
        order by count(*) desc
        limit 50
      ) t
    ), '[]'::jsonb),
    'unmatched_pending', (select count(*) from public.pharmacy_unmatched_duty where status = 'pending'),
    'stale_duty_days', coalesce((
      select jsonb_agg(jsonb_build_object('duty_date', t.d, 'records', t.cnt) order by t.d desc)
      from (
        select duty_date as d, count(*) as cnt
        from public.pharmacy_duty_schedules
        where fetched_at < now() - interval '18 hours'
        group by duty_date
        order by duty_date desc
        limit 14
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_pharmacy_quality() from public, anon;
grant execute on function public.admin_pharmacy_quality() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 28. RLS ve tablo yetkileri
-- ---------------------------------------------------------------------------
alter table public.pharmacy_settings enable row level security;
alter table public.pharmacy_sources enable row level security;
alter table public.pharmacy_profiles enable row level security;
alter table public.pharmacy_duty_schedules enable row level security;
alter table public.pharmacy_sync_logs enable row level security;
alter table public.pharmacy_unmatched_duty enable row level security;
alter table public.pharmacy_notification_preferences enable row level security;
alter table public.pharmacy_notification_log enable row level security;

-- Tablolar doğrudan istemciye açılmaz; bütün erişim RPC katmanından geçer.
revoke all on public.pharmacy_settings from anon, authenticated;
revoke all on public.pharmacy_sources from anon, authenticated;
revoke all on public.pharmacy_profiles from anon, authenticated;
revoke all on public.pharmacy_duty_schedules from anon, authenticated;
revoke all on public.pharmacy_sync_logs from anon, authenticated;
revoke all on public.pharmacy_unmatched_duty from anon, authenticated;

revoke all on public.pharmacy_notification_preferences from anon, authenticated;
grant select on public.pharmacy_notification_preferences to authenticated;

drop policy if exists pharmacy_prefs_select_own on public.pharmacy_notification_preferences;
create policy pharmacy_prefs_select_own on public.pharmacy_notification_preferences
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.pharmacy_notification_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 29. Bildirim türü: pharmacy
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'follow', 'like', 'comment', 'message', 'group_invite', 'order',
  'market_message', 'support', 'security', 'system', 'mention',
  'ride', 'news', 'live_news', 'live_news_verified', 'live_news_moderation',
  'pharmacy'
));

-- ---------------------------------------------------------------------------
-- 30. Doğrulama
-- ---------------------------------------------------------------------------
comment on table public.pharmacy_profiles is
  'Eczaneye özel alanlar. Envanter places (kategori: eczane) üzerindedir; adres/mahalle/çalışma saati yalnızca yetkili kaynaktan gelir.';
comment on table public.pharmacy_duty_schedules is
  'Nöbet çizelgesi. Tüm zamanlar timestamptz; gün hesabı Europe/Istanbul. Gece yarısını aşan nöbetler tek satırdır.';
comment on table public.pharmacy_sources is
  'Veri kaynakları. API anahtarı saklanmaz; api_secret_ref yalnızca sunucu ortam değişkeni adıdır.';
