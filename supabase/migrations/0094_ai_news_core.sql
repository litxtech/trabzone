-- 0094: Trabzone AI Haber Merkezi (üçüncü haber sistemi)
--
-- Bu modül mevcut sosyal akışı, Trabzone Haber profilini, bildirimleri,
-- admin denetim kayıtlarını ve SEO/sitemap altyapısını yeniden kullanır.
-- Yeni bir haber tablosu (posts) veya yeni bir yayın profili oluşturmaz;
-- yayınlanan her haber normal bir `posts` kaydıdır ve `post_media` kullanır.
--
-- Tasarım kuralları:
--   * Tüm tablolar RLS açık ve politika tanımsızdır: istemci doğrudan
--     okuyamaz/yazamaz. Erişim yalnızca SECURITY DEFINER RPC'lerden.
--   * Otomasyon yazımları yalnızca service_role'e açıktır.
--   * Yönetici işlemleri `tz_admin_require` ile yeniden doğrulanır.
--   * Günlük kota atomik sayaçla tutulur (Europe/Istanbul günü).
--   * Aynı olay ikinci kez yayımlanamaz: event + publication tekilliği.
--   * Kaynağı/lisansı doğrulanmamış görsel yayına giremez.

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 0. Yeni yetkiler
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr) values
  ('news.view',   'AI Haber Merkezi panelini, kuyruğu ve maliyetleri görüntüleme'),
  ('news.manage', 'AI Haber Merkezi ayarları, kaynakları, inceleme ve yayın işlemleri')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'news.view'), ('admin', 'news.manage'),
  ('moderator', 'news.view')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. Bildirim türü ve tercihi
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (
    kind in ('follow','like','comment','message','group_invite','order','market_message',
             'support','security','system','mention','ride','news')
  );

alter table public.notification_preferences
  add column if not exists news boolean not null default true;

-- Tercih güncellemesi için satır sahipliği politikası (mevcut tabloda yoktu).
drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant update (likes, comments, follows, messages, orders, support, news)
  on public.notification_preferences to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Kategoriler ve medya lisans kataloğu
-- ---------------------------------------------------------------------------
create table if not exists public.ai_news_categories (
  slug        text primary key,
  name_tr     text not null,
  priority    smallint not null default 50,
  auto_notify boolean not null default true,
  sort_order  smallint not null default 100,
  created_at  timestamptz not null default now()
);

insert into public.ai_news_categories (slug, name_tr, priority, auto_notify, sort_order) values
  ('son-dakika',            'Son Dakika',                    100, true,  10),
  ('trabzon-gundem',        'Trabzon Gündem',                 90, true,  20),
  ('ilce-haberleri',        'İlçe Haberleri',                 85, true,  30),
  ('trabzonspor',           'Trabzonspor',                    95, true,  40),
  ('spor',                  'Spor',                           60, false, 50),
  ('belediye',              'Belediye',                       80, true,  60),
  ('valilik-kamu',          'Valilik ve Kamu Duyuruları',     80, true,  70),
  ('ekonomi',               'Ekonomi',                        65, false, 80),
  ('is-dunyasi',            'İş Dünyası',                     50, false, 90),
  ('emlak-sehircilik',      'Emlak ve Şehircilik',            45, false, 100),
  ('ulasim',                'Ulaşım',                         60, false, 110),
  ('trafik',                'Trafik',                         55, false, 120),
  ('egitim',                'Eğitim',                         50, false, 130),
  ('saglik',                'Sağlık',                         50, false, 140),
  ('turizm',                'Turizm',                         55, false, 150),
  ('kultur-sanat',          'Kültür ve Sanat',                45, false, 160),
  ('etkinlikler',           'Etkinlikler',                    45, false, 170),
  ('cevre-doga',            'Çevre ve Doğa',                  45, false, 180),
  ('tarim',                 'Tarım',                          40, false, 190),
  ('findik-cay',            'Fındık ve Çay',                  40, false, 200),
  ('altyapi',               'Altyapı',                        45, false, 210),
  ('elektrik-su-kesintisi', 'Elektrik ve Su Kesintileri',     50, true,  220),
  ('hava-doga-olaylari',    'Hava ve Doğa Olayları',          60, true,  230),
  ('yerel-yasam',           'Yerel Yaşam',                    40, false, 240),
  ('diger',                 'Diğer',                          20, false, 250)
on conflict (slug) do update
  set name_tr = excluded.name_tr,
      priority = excluded.priority,
      auto_notify = excluded.auto_notify,
      sort_order = excluded.sort_order;

create table if not exists public.ai_news_media_licenses (
  code                  text primary key,
  name_tr               text not null,
  commercial_use        boolean not null default false,
  derivatives_allowed   boolean not null default false,
  attribution_required  boolean not null default true,
  requires_documentation boolean not null default true,
  is_usable             boolean not null default false,
  license_url           text,
  notes_tr              text,
  created_at            timestamptz not null default now()
);

insert into public.ai_news_media_licenses (
  code, name_tr, commercial_use, derivatives_allowed, attribution_required,
  requires_documentation, is_usable, license_url, notes_tr
) values
  ('category_artwork', 'Trabzone kategori tasarımı', true, true, false, false, true, null,
   'Olay fotoğrafı iddiası taşımayan, Trabzone tarafından üretilmiş tasarım görseli.'),
  ('own_work', 'Trabzone''a ait özgün fotoğraf', true, true, false, false, true, null,
   'Trabzone ekibinin kendi çektiği, olayla doğrudan ilişkili fotoğraf.'),
  ('official_press_permission', 'Resmî kurum yazılı kullanım izni', true, true, true, true, true, null,
   'Yalnızca yazılı izin/referans numarası girildiğinde kullanılabilir.'),
  ('cc0', 'CC0 / Kamu malı', true, true, false, false, true,
   'https://creativecommons.org/publicdomain/zero/1.0/', 'Atıf gerekmez; yine de kaynak gösterilir.'),
  ('cc_by_4', 'CC BY 4.0', true, true, true, false, true,
   'https://creativecommons.org/licenses/by/4.0/', 'Ticari kullanım serbest, atıf zorunlu.'),
  ('cc_by_sa_4', 'CC BY-SA 4.0', true, true, true, false, true,
   'https://creativecommons.org/licenses/by-sa/4.0/', 'Türev eserler aynı lisansla paylaşılmalı.'),
  ('unknown', 'Lisansı doğrulanamadı', false, false, true, true, false, null,
   'Bu lisansla işaretli görseller hiçbir koşulda yayımlanmaz.')
on conflict (code) do update
  set name_tr = excluded.name_tr,
      commercial_use = excluded.commercial_use,
      derivatives_allowed = excluded.derivatives_allowed,
      attribution_required = excluded.attribution_required,
      requires_documentation = excluded.requires_documentation,
      is_usable = excluded.is_usable,
      license_url = excluded.license_url,
      notes_tr = excluded.notes_tr;

-- ---------------------------------------------------------------------------
-- 3. Ayar, kaynak ve arama konusu tabloları
-- ---------------------------------------------------------------------------
create table if not exists public.ai_news_settings (
  id                    boolean primary key default true check (id),
  enabled               boolean not null default true,
  scan_interval_minutes integer not null default 15
                          check (scan_interval_minutes between 5 and 1440),
  daily_auto_limit      integer not null default 12 check (daily_auto_limit between 0 and 100),
  auto_publish_enabled  boolean not null default true,
  dry_run               boolean not null default false,
  max_events_per_run    integer not null default 2 check (max_events_per_run between 1 and 5),
  max_searches_per_run  integer not null default 3 check (max_searches_per_run between 1 and 10),
  max_article_age_hours integer not null default 72
                          check (max_article_age_hours between 6 and 720),
  min_quality_score     numeric(4,3) not null default 0.720 check (min_quality_score between 0 and 1),
  duplicate_title_threshold numeric(4,3) not null default 0.450
                          check (duplicate_title_threshold between 0.2 and 0.95),
  min_media_match       numeric(4,3) not null default 0.600 check (min_media_match between 0 and 1),
  publisher_user_id     uuid references public.profiles (id) on delete set null,
  publisher_username    extensions.citext not null default 'trabzonehaber',
  fast_model            text not null default 'deepseek-flash',
  reasoning_model       text not null default 'deepseek-v4-pro',
  daily_budget_usd      numeric(10,4) not null default 3.0000 check (daily_budget_usd >= 0),
  monthly_budget_usd    numeric(10,4) not null default 60.0000 check (monthly_budget_usd >= 0),
  price_input_per_m     numeric(10,4) not null default 0.3000,
  price_output_per_m    numeric(10,4) not null default 1.2000,
  price_search_per_call numeric(10,6) not null default 0.000750,
  price_fetch_per_call  numeric(10,6) not null default 0.000750,
  notify_enabled        boolean not null default true,
  notify_daily_cap      integer not null default 3 check (notify_daily_cap between 0 and 20),
  notify_quiet_start    integer not null default 23 check (notify_quiet_start between 0 and 23),
  notify_quiet_end      integer not null default 8 check (notify_quiet_end between 0 and 23),
  notify_categories     text[] not null default array[
    'son-dakika','trabzon-gundem','ilce-haberleri','trabzonspor','belediye',
    'valilik-kamu','hava-doga-olaylari','elektrik-su-kesintisi'
  ],
  worker_url            text not null default 'https://nzvoufcywppavaioirac.supabase.co',
  last_diagnostics      jsonb,
  last_tick_at          timestamptz,
  next_run_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

insert into public.ai_news_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.ai_news_sources (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  domain              extensions.citext not null unique,
  kind                text not null default 'unknown'
                        check (kind in ('official', 'trusted_media', 'unknown', 'low_trust')),
  feed_url            text,
  feed_kind           text not null default 'none' check (feed_kind in ('rss', 'atom', 'none')),
  media_license_code  text references public.ai_news_media_licenses (code) on delete set null,
  license_reference   text,
  attribution_text    text,
  reliability         numeric(4,3) not null default 0.500 check (reliability between 0 and 1),
  active              boolean not null default true,
  notes_tr            text,
  last_checked_at     timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists ai_news_sources_kind_idx on public.ai_news_sources (kind, active);

insert into public.ai_news_sources (name, domain, kind, reliability, notes_tr) values
  ('Trabzon Valiliği', 'trabzon.gov.tr', 'official', 0.950,
   '.gov.tr uzantılı resmî kamu kaynağı.'),
  ('Trabzon Büyükşehir Belediyesi', 'trabzon.bel.tr', 'official', 0.950,
   'Resmî belediye duyuruları.'),
  ('Trabzonspor', 'trabzonspor.org.tr', 'official', 0.950,
   'Kulübün resmî açıklamaları.'),
  ('Meteoroloji Genel Müdürlüğü', 'mgm.gov.tr', 'official', 0.950,
   'Resmî hava durumu uyarıları.'),
  ('AFAD', 'afad.gov.tr', 'official', 0.950,
   'Resmî afet ve acil durum duyuruları.')
on conflict (domain) do update
  set name = excluded.name,
      kind = excluded.kind,
      reliability = excluded.reliability,
      notes_tr = excluded.notes_tr;

create table if not exists public.ai_news_search_topics (
  id           uuid primary key default gen_random_uuid(),
  query        text not null unique,
  kind         text not null default 'general'
                 check (kind in ('general', 'district', 'category', 'sport', 'official')),
  priority     smallint not null default 50 check (priority between 0 and 100),
  active       boolean not null default true,
  uses         integer not null default 0,
  hits         integer not null default 0,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists ai_news_topics_pick_idx
  on public.ai_news_search_topics (active, priority desc, last_used_at nulls first);

insert into public.ai_news_search_topics (query, kind, priority) values
  ('Trabzon son dakika haber', 'general', 100),
  ('Trabzon güncel haber', 'general', 95),
  ('Trabzon belediye duyuru', 'official', 92),
  ('Trabzon Valiliği açıklama', 'official', 92),
  ('Trabzonspor son gelişmeler', 'sport', 96),
  ('Trabzon ekonomi haber', 'category', 70),
  ('Trabzon turizm haber', 'category', 68),
  ('Trabzon eğitim haber', 'category', 60),
  ('Trabzon sağlık haber', 'category', 60),
  ('Trabzon ulaşım trafik', 'category', 62),
  ('Trabzon elektrik su kesintisi', 'category', 66),
  ('Trabzon hava durumu uyarı', 'category', 64),
  ('Trabzon etkinlik kültür sanat', 'category', 55),
  ('Uzungöl turizm haber', 'category', 58),
  ('Ortahisar gündem', 'district', 80),
  ('Akçaabat gelişmeler', 'district', 76),
  ('Yomra haber', 'district', 74),
  ('Arsin haber', 'district', 70),
  ('Araklı haber', 'district', 70),
  ('Sürmene haber', 'district', 70),
  ('Of haber', 'district', 70),
  ('Çaykara haber', 'district', 68),
  ('Dernekpazarı haber', 'district', 64),
  ('Hayrat haber', 'district', 64),
  ('Maçka haber', 'district', 68),
  ('Düzköy haber', 'district', 64),
  ('Vakfıkebir haber', 'district', 68),
  ('Beşikdüzü haber', 'district', 68),
  ('Çarşıbaşı haber', 'district', 64),
  ('Şalpazarı haber', 'district', 64),
  ('Tonya haber', 'district', 68),
  ('Köprübaşı haber', 'district', 64)
on conflict (query) do update
  set kind = excluded.kind,
      priority = excluded.priority;

-- ---------------------------------------------------------------------------
-- 4. Çalışma, sonuç, olay, kanıt
-- ---------------------------------------------------------------------------
create table if not exists public.ai_news_runs (
  id           uuid primary key default gen_random_uuid(),
  trigger      text not null default 'cron' check (trigger in ('cron', 'manual', 'admin')),
  status       text not null default 'running'
                 check (status in ('running', 'completed', 'failed', 'skipped')),
  started_at   timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at  timestamptz,
  stats        jsonb not null default '{}'::jsonb,
  error        text,
  created_at   timestamptz not null default now()
);

-- Aynı anda yalnızca bir çalışma satırı "running" olabilir.
create unique index if not exists ai_news_runs_single_running
  on public.ai_news_runs ((true))
  where status = 'running';

create index if not exists ai_news_runs_started_idx
  on public.ai_news_runs (started_at desc);

create table if not exists public.ai_news_search_results (
  id             bigserial primary key,
  run_id         uuid references public.ai_news_runs (id) on delete set null,
  event_id       uuid,
  query          text,
  title          text not null,
  url            text not null,
  normalized_url text not null unique,
  source_domain  extensions.citext not null,
  source_kind    text not null default 'unknown'
                   check (source_kind in ('official', 'trusted_media', 'unknown', 'low_trust')),
  site_name      text,
  snippet        text,
  summary        text,
  content        text,
  content_hash   text,
  published_at   timestamptz,
  rerank_score   numeric(4,2),
  status         text not null default 'new'
                   check (status in ('new', 'classified', 'ignored', 'duplicate', 'rejected')),
  ignore_reason  text,
  fetched_via    text not null default 'search' check (fetched_via in ('search', 'fetch', 'rss')),
  created_at     timestamptz not null default now()
);

create index if not exists ai_news_results_status_idx
  on public.ai_news_search_results (status, created_at desc);
create index if not exists ai_news_results_event_idx
  on public.ai_news_search_results (event_id);

create table if not exists public.ai_news_events (
  id                  uuid primary key default gen_random_uuid(),
  event_key           text not null unique,
  title               text not null,
  normalized_title    text not null,
  category_slug       text references public.ai_news_categories (slug) on delete set null,
  district            text,
  event_date          date,
  summary             text,
  risk_level          text not null default 'B' check (risk_level in ('A', 'B', 'C')),
  status              text not null default 'discovered' check (status in (
    'discovered', 'fetched', 'classified', 'verifying', 'verified', 'draft',
    'media_checking', 'ready', 'awaiting_review', 'published', 'rejected',
    'retracted', 'failed'
  )),
  confidence          numeric(4,3) not null default 0,
  primary_source      boolean not null default false,
  independent_sources integer not null default 0,
  conflict            boolean not null default false,
  auto_block_reasons  text[] not null default '{}'::text[],
  published_post_id   uuid references public.posts (id) on delete set null,
  retracted_at        timestamptz,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists ai_news_events_status_idx
  on public.ai_news_events (status, created_at desc);
create index if not exists ai_news_events_district_idx
  on public.ai_news_events (district, event_date desc);
create index if not exists ai_news_events_title_trgm_idx
  on public.ai_news_events using gin (normalized_title gin_trgm_ops);

create table if not exists public.ai_news_evidence (
  id            bigserial primary key,
  event_id      uuid not null references public.ai_news_events (id) on delete cascade,
  source_domain extensions.citext not null,
  source_kind   text not null default 'unknown'
                  check (source_kind in ('official', 'trusted_media', 'unknown', 'low_trust')),
  url           text not null,
  title         text,
  excerpt       text,
  facts         jsonb not null default '{}'::jsonb,
  content_hash  text not null,
  is_primary    boolean not null default false,
  independent   boolean not null default false,
  fetched_via   text not null default 'search' check (fetched_via in ('search', 'fetch', 'rss')),
  retrieved_at  timestamptz not null default now(),
  unique (event_id, content_hash)
);

create index if not exists ai_news_evidence_event_idx
  on public.ai_news_evidence (event_id);

-- ---------------------------------------------------------------------------
-- 5. Taslak, doğrulama, medya
-- ---------------------------------------------------------------------------
create table if not exists public.ai_news_drafts (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.ai_news_events (id) on delete cascade,
  version            integer not null default 1,
  is_current         boolean not null default true,
  title              text not null,
  spot               text not null default '',
  body               text not null,
  social_copy        text,
  category_slug      text references public.ai_news_categories (slug) on delete set null,
  district           text,
  event_date         date,
  seo_title          text,
  seo_description    text,
  quality_score      numeric(4,3) not null default 0,
  plagiarism_score   numeric(4,3) not null default 0,
  risk_level         text not null default 'B' check (risk_level in ('A', 'B', 'C')),
  status             text not null default 'draft' check (status in (
    'draft', 'ready', 'awaiting_review', 'approved', 'published', 'rejected', 'failed'
  )),
  ai_model           text,
  ai_generated       boolean not null default true,
  word_count         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (event_id, version)
);

create unique index if not exists ai_news_drafts_current
  on public.ai_news_drafts (event_id) where is_current;

create table if not exists public.ai_news_verification_results (
  id          bigserial primary key,
  event_id    uuid not null references public.ai_news_events (id) on delete cascade,
  draft_id    uuid references public.ai_news_drafts (id) on delete set null,
  checks      jsonb not null default '{}'::jsonb,
  conflicts   jsonb not null default '[]'::jsonb,
  passed      boolean not null default false,
  risk_level  text not null default 'B' check (risk_level in ('A', 'B', 'C')),
  model       text,
  created_at  timestamptz not null default now()
);

create index if not exists ai_news_verification_event_idx
  on public.ai_news_verification_results (event_id, created_at desc);

create table if not exists public.ai_news_media_assets (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.ai_news_events (id) on delete cascade,
  draft_id          uuid references public.ai_news_drafts (id) on delete set null,
  source_url        text,
  source_domain     extensions.citext,
  creator           text,
  credit            text,
  license_code      text not null references public.ai_news_media_licenses (code),
  license_reference text,
  attribution       text,
  is_placeholder    boolean not null default false,
  event_match_score numeric(4,3) not null default 0,
  storage_path      text,
  thumbnail_path    text,
  width             integer,
  height            integer,
  mime_type         text,
  alt_text          text,
  status            text not null default 'candidate'
                      check (status in ('candidate', 'approved', 'rejected', 'published')),
  removed_at        timestamptz,
  removal_reason    text,
  verified_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists ai_news_media_event_idx
  on public.ai_news_media_assets (event_id, status);

-- ---------------------------------------------------------------------------
-- 6. Yayın, inceleme kuyruğu, kota, maliyet, hata, denetim
-- ---------------------------------------------------------------------------
create table if not exists public.ai_news_publications (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null unique references public.ai_news_events (id) on delete cascade,
  draft_id       uuid not null references public.ai_news_drafts (id) on delete restrict,
  post_id        uuid not null unique references public.posts (id) on delete cascade,
  mode           text not null default 'auto' check (mode in ('auto', 'manual')),
  status         text not null default 'published'
                   check (status in ('published', 'retracted')),
  published_at   timestamptz not null default now(),
  retracted_at   timestamptz,
  retract_reason text,
  created_at     timestamptz not null default now()
);

create index if not exists ai_news_publications_published_idx
  on public.ai_news_publications (status, published_at desc);

create table if not exists public.ai_news_publication_history (
  id             bigserial primary key,
  publication_id uuid not null references public.ai_news_publications (id) on delete cascade,
  action         text not null,
  actor_id       uuid references public.profiles (id) on delete set null,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create table if not exists public.ai_news_review_queue (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null unique references public.ai_news_events (id) on delete cascade,
  draft_id    uuid references public.ai_news_drafts (id) on delete set null,
  reasons     text[] not null default '{}'::text[],
  priority    smallint not null default 50,
  state       text not null default 'pending' check (state in (
    'pending', 'approved', 'rejected', 'deferred', 'archived'
  )),
  notes       text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);

create index if not exists ai_news_review_state_idx
  on public.ai_news_review_queue (state, created_at desc);

create table if not exists public.ai_news_quota_days (
  day             date primary key,
  auto_published  integer not null default 0 check (auto_published >= 0),
  manual_published integer not null default 0 check (manual_published >= 0),
  updated_at      timestamptz not null default now()
);

create table if not exists public.ai_news_cost_logs (
  id         bigserial primary key,
  run_id     uuid references public.ai_news_runs (id) on delete set null,
  kind       text not null check (kind in ('search', 'fetch', 'model')),
  model      text,
  calls      integer not null default 1,
  tokens_in  integer,
  tokens_out integer,
  cost_usd   numeric(12,6) not null default 0,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists ai_news_cost_created_idx
  on public.ai_news_cost_logs (created_at desc);

create table if not exists public.ai_news_errors (
  id         bigserial primary key,
  run_id     uuid references public.ai_news_runs (id) on delete set null,
  stage      text not null,
  code       text not null,
  message    text,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_news_errors_created_idx
  on public.ai_news_errors (created_at desc);

create table if not exists public.ai_news_audit_logs (
  id          bigserial primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ai_news_audit_created_idx
  on public.ai_news_audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- 7. RLS: doğrudan erişim kapalı, yalnızca definer RPC'ler
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'ai_news_categories', 'ai_news_media_licenses', 'ai_news_settings',
    'ai_news_sources', 'ai_news_search_topics', 'ai_news_runs',
    'ai_news_search_results', 'ai_news_events', 'ai_news_evidence',
    'ai_news_drafts', 'ai_news_verification_results', 'ai_news_media_assets',
    'ai_news_publications', 'ai_news_publication_history',
    'ai_news_review_queue', 'ai_news_quota_days', 'ai_news_cost_logs',
    'ai_news_errors', 'ai_news_audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

grant usage, select on sequence public.ai_news_search_results_id_seq to service_role;
grant usage, select on sequence public.ai_news_evidence_id_seq to service_role;
grant usage, select on sequence public.ai_news_verification_results_id_seq to service_role;
grant usage, select on sequence public.ai_news_publication_history_id_seq to service_role;
grant usage, select on sequence public.ai_news_cost_logs_id_seq to service_role;
grant usage, select on sequence public.ai_news_errors_id_seq to service_role;
grant usage, select on sequence public.ai_news_audit_logs_id_seq to service_role;

drop trigger if exists ai_news_settings_set_updated_at on public.ai_news_settings;
create trigger ai_news_settings_set_updated_at
  before update on public.ai_news_settings
  for each row execute function public.set_updated_at();

drop trigger if exists ai_news_sources_set_updated_at on public.ai_news_sources;
create trigger ai_news_sources_set_updated_at
  before update on public.ai_news_sources
  for each row execute function public.set_updated_at();

drop trigger if exists ai_news_events_set_updated_at on public.ai_news_events;
create trigger ai_news_events_set_updated_at
  before update on public.ai_news_events
  for each row execute function public.set_updated_at();

drop trigger if exists ai_news_drafts_set_updated_at on public.ai_news_drafts;
create trigger ai_news_drafts_set_updated_at
  before update on public.ai_news_drafts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Normalizasyon yardımcıları
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_istanbul_day(p_at timestamptz default now())
returns date
language sql
stable
set search_path = public
as $$
  select (coalesce(p_at, now()) at time zone 'Europe/Istanbul')::date;
$$;

create or replace function public.ai_news_normalize_url(p_url text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := lower(btrim(coalesce(p_url, '')));
begin
  if v !~ '^https?://' then
    raise exception 'invalid_url' using errcode = '22023';
  end if;
  v := regexp_replace(v, '#.*$', '');
  v := regexp_replace(v, '[?&](utm_[^&]*|fbclid=[^&]*|gclid=[^&]*|mc_cid=[^&]*)', '', 'g');
  v := regexp_replace(v, '\?&', '?');
  v := regexp_replace(v, '[?&]$', '');
  v := regexp_replace(v, '^(https?://[^/]+)/$', '\1');
  return v;
end;
$$;

create or replace function public.ai_news_domain(p_url text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  v := split_part(btrim(coalesce(p_url, '')), '://', 2);
  v := split_part(v, '/', 1);
  v := split_part(v, ':', 1);
  v := lower(v);
  if left(v, 4) = 'www.' then
    v := substr(v, 5);
  end if;
  return v;
end;
$$;

create or replace function public.ai_news_domain_kind(p_domain text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_domain extensions.citext := lower(btrim(coalesce(p_domain, '')));
  v_kind text;
begin
  if v_domain = '' then
    return 'unknown';
  end if;

  select s.kind into v_kind
  from public.ai_news_sources s
  where s.domain = v_domain and s.active;

  if v_kind is not null then
    return v_kind;
  end if;

  -- Türkiye'de resmî kamu kurumları .gov.tr, belediyeler .bel.tr kullanır.
  if v_domain like '%.gov.tr' or v_domain like '%.bel.tr' then
    return 'official';
  end if;

  return 'unknown';
end;
$$;

create or replace function public.ai_news_title_fingerprint(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(
    translate(
      lower(coalesce(p_text, '')),
      'çğıöşüÇĞİÖŞÜâîûÂÎÛ',
      'cgiosuCGIOSUaiuAIU'
    ),
    '[^a-z0-9 ]+', ' ', 'g'
  ));
$$;

create or replace function public.ai_news_is_trabzon_text(p_text text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_text, '') ~* (
    'trabzon|trabzonspor|uzungöl|sümela|ortahisar|akçaabat|akcaabat|yomra|arsin|araklı|arakli|' ||
    'sürmene|surmene|\bof\b|çaykara|caykara|dernekpazarı|dernekpazari|hayrat|maçka|macka|' ||
    'düzköy|duzkoy|vakfıkebir|vakfikebir|beşikdüzü|besikduzu|çarşıbaşı|carsibasi|' ||
    'şalpazarı|salpazari|tonya|köprübaşı|koprubasi|61\s*plaka|karadeniz sahil|doğu karadeniz'
  );
$$;

-- Olay durum geçişleri yalnızca bu fonksiyon üzerinden yapılır.
create or replace function public.ai_news_event_set_status(p_event_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_allowed text[];
begin
  select e.status into v_current
  from public.ai_news_events e
  where e.id = p_event_id
  for update;

  if v_current is null then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  if v_current = p_status then
    return;
  end if;

  v_allowed := case v_current
    when 'discovered'     then array['fetched','classified','rejected','failed']
    when 'fetched'        then array['classified','rejected','failed']
    when 'classified'     then array['verifying','awaiting_review','rejected','failed']
    when 'verifying'      then array['verified','awaiting_review','rejected','failed']
    when 'verified'       then array['draft','awaiting_review','rejected','failed']
    when 'draft'          then array['media_checking','ready','awaiting_review','rejected','failed']
    when 'media_checking' then array['ready','awaiting_review','rejected','failed']
    when 'ready'          then array['published','awaiting_review','rejected','failed']
    when 'awaiting_review' then array['published','ready','rejected','archived','failed']
    when 'published'      then array['retracted','published']
    when 'rejected'       then array['classified']
    when 'retracted'      then array[]::text[]
    when 'failed'         then array['classified','rejected']
    else array[]::text[]
  end;

  if not (p_status = any (v_allowed)) then
    raise exception 'invalid_state_transition' using errcode = '22023';
  end if;

  update public.ai_news_events
     set status = p_status,
         last_seen_at = now()
   where id = p_event_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Kota (atomik) ve maliyet
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_quota_reserve(p_day date, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_limit is null or p_limit <= 0 then
    return null;
  end if;

  insert into public.ai_news_quota_days (day, auto_published)
  values (p_day, 1)
  on conflict (day) do update
    set auto_published = public.ai_news_quota_days.auto_published + 1,
        updated_at = now()
    where public.ai_news_quota_days.auto_published < p_limit
  returning auto_published into v_count;

  return v_count;
end;
$$;

create or replace function public.ai_news_quota_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_day date := public.ai_news_istanbul_day(now());
  v_used integer;
begin
  select * into v_settings from public.ai_news_settings where id;

  select coalesce(q.auto_published, 0) into v_used
  from public.ai_news_quota_days q
  where q.day = v_day;

  return jsonb_build_object(
    'day', v_day,
    'used', coalesce(v_used, 0),
    'limit', v_settings.daily_auto_limit,
    'remaining', greatest(v_settings.daily_auto_limit - coalesce(v_used, 0), 0),
    'manual_used', coalesce((
      select q.manual_published from public.ai_news_quota_days q where q.day = v_day
    ), 0)
  );
end;
$$;

create or replace function public.ai_news_budget_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_day_start timestamptz;
  v_month_start timestamptz;
  v_today numeric;
  v_month numeric;
begin
  select * into v_settings from public.ai_news_settings where id;

  v_day_start := (public.ai_news_istanbul_day(now())::timestamp at time zone 'Europe/Istanbul');
  v_month_start := (date_trunc('month', public.ai_news_istanbul_day(now()))::timestamp
                    at time zone 'Europe/Istanbul');

  select coalesce(sum(cost_usd), 0) into v_today
  from public.ai_news_cost_logs
  where created_at >= v_day_start;

  select coalesce(sum(cost_usd), 0) into v_month
  from public.ai_news_cost_logs
  where created_at >= v_month_start;

  return jsonb_build_object(
    'today_usd', round(v_today, 6),
    'month_usd', round(v_month, 6),
    'daily_limit_usd', v_settings.daily_budget_usd,
    'monthly_limit_usd', v_settings.monthly_budget_usd,
    'daily_remaining_usd', round(greatest(v_settings.daily_budget_usd - v_today, 0), 6),
    'monthly_remaining_usd', round(greatest(v_settings.monthly_budget_usd - v_month, 0), 6),
    'exhausted', (v_today >= v_settings.daily_budget_usd
                  or v_month >= v_settings.monthly_budget_usd)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Çalışma yaşam döngüsü
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_run_begin(p_trigger text default 'cron')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_run public.ai_news_runs%rowtype;
  v_busy public.ai_news_runs%rowtype;
  v_topics jsonb;
  v_quota jsonb;
  v_budget jsonb;
  v_publisher jsonb;
begin
  select * into v_settings from public.ai_news_settings where id for update;

  if v_settings.enabled is not true then
    return jsonb_build_object('skipped', 'disabled');
  end if;

  -- Yarım kalmış çalışmaları temizle (12 dakikadan eski heartbeat).
  update public.ai_news_runs r
     set status = 'failed',
         finished_at = now(),
         error = coalesce(r.error, 'stale_run_timeout')
   where r.status = 'running'
     and r.heartbeat_at < now() - interval '12 minutes';

  select * into v_busy
  from public.ai_news_runs r
  where r.status = 'running'
  limit 1;

  if found then
    return jsonb_build_object('skipped', 'busy', 'run_id', v_busy.id);
  end if;

  v_budget := public.ai_news_budget_status();
  if (v_budget ->> 'exhausted')::boolean then
    update public.ai_news_settings
       set next_run_at = now() + make_interval(mins => v_settings.scan_interval_minutes)
     where id;
    return jsonb_build_object('skipped', 'budget_exhausted', 'budget', v_budget);
  end if;

  begin
    insert into public.ai_news_runs (trigger, status)
    values (coalesce(nullif(p_trigger, ''), 'cron'), 'running')
    returning * into v_run;
  exception
    when unique_violation then
      return jsonb_build_object('skipped', 'busy');
  end;

  update public.ai_news_settings
     set last_tick_at = now(),
         next_run_at = now() + make_interval(mins => v_settings.scan_interval_minutes)
   where id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'query', t.query, 'kind', t.kind, 'priority', t.priority
  ) order by t.priority desc, t.last_used_at nulls first), '[]'::jsonb)
  into v_topics
  from (
    select * from public.ai_news_search_topics
    where active
    order by priority desc, last_used_at nulls first
    limit v_settings.max_searches_per_run
  ) t;

  v_quota := public.ai_news_quota_status();

  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'is_verified', p.is_verified, 'avatar_path', p.avatar_path
  ) end
  into v_publisher
  from public.profiles p
  where p.id = coalesce(
    v_settings.publisher_user_id,
    (select pr.id from public.profiles pr where pr.username = v_settings.publisher_username)
  );

  return jsonb_build_object(
    'run_id', v_run.id,
    'settings', jsonb_build_object(
      'max_events_per_run', v_settings.max_events_per_run,
      'max_article_age_hours', v_settings.max_article_age_hours,
      'min_quality_score', v_settings.min_quality_score,
      'duplicate_title_threshold', v_settings.duplicate_title_threshold,
      'min_media_match', v_settings.min_media_match,
      'fast_model', v_settings.fast_model,
      'reasoning_model', v_settings.reasoning_model,
      'auto_publish_enabled', v_settings.auto_publish_enabled,
      'dry_run', v_settings.dry_run,
      'price_input_per_m', v_settings.price_input_per_m,
      'price_output_per_m', v_settings.price_output_per_m,
      'price_search_per_call', v_settings.price_search_per_call,
      'price_fetch_per_call', v_settings.price_fetch_per_call,
      'notify_enabled', v_settings.notify_enabled
    ),
    'topics', v_topics,
    'quota', v_quota,
    'budget', v_budget,
    'publisher', v_publisher
  );
end;
$$;

create or replace function public.ai_news_run_heartbeat(p_run_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_news_runs set heartbeat_at = now()
  where id = p_run_id and status = 'running';
$$;

create or replace function public.ai_news_run_finish(
  p_run_id uuid,
  p_stats jsonb default '{}'::jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_news_runs
     set status = case when p_error is null then 'completed' else 'failed' end,
         finished_at = now(),
         heartbeat_at = now(),
         stats = coalesce(p_stats, '{}'::jsonb),
         error = left(nullif(p_error, ''), 500)
   where id = p_run_id and status = 'running';
end;
$$;

create or replace function public.ai_news_topic_mark(p_topics jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if jsonb_typeof(coalesce(p_topics, 'null'::jsonb)) <> 'array' then
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_topics)
  loop
    update public.ai_news_search_topics
       set last_used_at = now(),
           uses = uses + 1,
           hits = hits + greatest(coalesce((v_item ->> 'hits')::integer, 0), 0)
     where id = (v_item ->> 'id')::uuid;
  end loop;
end;
$$;

create or replace function public.ai_news_cost_log(
  p_run_id uuid,
  p_kind text,
  p_model text,
  p_calls integer,
  p_tokens_in integer,
  p_tokens_out integer,
  p_cost_usd numeric,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('search', 'fetch', 'model') then
    raise exception 'invalid_cost_kind' using errcode = '22023';
  end if;

  insert into public.ai_news_cost_logs (
    run_id, kind, model, calls, tokens_in, tokens_out, cost_usd, note
  ) values (
    p_run_id, p_kind, left(nullif(p_model, ''), 80),
    greatest(coalesce(p_calls, 1), 1),
    nullif(p_tokens_in, 0), nullif(p_tokens_out, 0),
    greatest(coalesce(p_cost_usd, 0), 0),
    left(nullif(p_note, ''), 300)
  );
end;
$$;

create or replace function public.ai_news_log_error(
  p_run_id uuid,
  p_stage text,
  p_code text,
  p_message text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_news_errors (run_id, stage, code, message, detail)
  values (
    p_run_id,
    left(coalesce(p_stage, 'unknown'), 40),
    left(coalesce(p_code, 'unknown'), 80),
    left(coalesce(p_message, ''), 600),
    coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Arama sonuçlarını kaydetme ve aday seçimi
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_record_results(
  p_run_id uuid,
  p_query text,
  p_results jsonb,
  p_source text default 'search'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_settings public.ai_news_settings%rowtype;
  v_url text;
  v_norm text;
  v_domain text;
  v_kind text;
  v_published timestamptz;
  v_content text;
  v_hash text;
  v_relevant boolean;
  v_fresh boolean;
  v_status text;
  v_final_status text;
  v_reason text;
  v_id bigint;
  v_ignored integer := 0;
  v_new integer := 0;
  v_total integer := 0;
begin
  select * into v_settings from public.ai_news_settings where id;

  if jsonb_typeof(coalesce(p_results, 'null'::jsonb)) <> 'array' then
    raise exception 'invalid_results' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    v_total := v_total + 1;
    begin
      v_url := btrim(coalesce(v_item ->> 'url', ''));
      v_norm := public.ai_news_normalize_url(v_url);
    exception
      when others then
        continue;
    end;

    v_domain := public.ai_news_domain(v_url);
    if v_domain = '' or v_domain !~ '\.' then
      continue;
    end if;

    v_kind := public.ai_news_domain_kind(v_domain);
    v_content := left(coalesce(v_item ->> 'content', ''), 60000);
    v_hash := md5(coalesce(v_item ->> 'title', '') || '|' || v_content);
    begin
      v_published := nullif(v_item ->> 'date', '')::timestamptz;
    exception
      when others then
        v_published := null;
    end;
    v_relevant := public.ai_news_is_trabzon_text(
      coalesce(v_item ->> 'title', '') || ' ' || coalesce(v_item ->> 'summary', '') || ' ' || v_content
    );
    v_fresh := v_published is null
      or v_published > now() - make_interval(hours => v_settings.max_article_age_hours);

    if v_kind = 'low_trust' then
      v_status := 'ignored';
      v_reason := 'low_trust_source';
    elsif not v_relevant then
      v_status := 'ignored';
      v_reason := 'not_trabzon';
    elsif not v_fresh then
      v_status := 'ignored';
      v_reason := 'too_old';
    else
      v_status := 'new';
      v_reason := null;
    end if;

    insert into public.ai_news_search_results (
      run_id, query, title, url, normalized_url, source_domain, source_kind,
      site_name, snippet, summary, content, content_hash, published_at,
      rerank_score, status, ignore_reason, fetched_via
    ) values (
      p_run_id, left(p_query, 200),
      left(coalesce(nullif(v_item ->> 'title', ''), v_norm), 400),
      v_url, v_norm, v_domain, v_kind,
      left(nullif(v_item ->> 'site_name', ''), 160),
      left(v_item ->> 'snippet', 1200),
      left(v_item ->> 'summary', 5000),
      nullif(v_content, ''),
      case when v_content = '' then null else v_hash end,
      v_published,
      case
        when coalesce(v_item ->> 'rerank_score', '') ~ '^-?[0-9.]+$'
          then least(greatest((v_item ->> 'rerank_score')::numeric, 0), 99)
        else null
      end,
      v_status, v_reason, coalesce(nullif(p_source, ''), 'search')
    )
    on conflict (normalized_url) do update
      set run_id = excluded.run_id,
          content = coalesce(nullif(excluded.content, ''), public.ai_news_search_results.content),
          content_hash = coalesce(excluded.content_hash, public.ai_news_search_results.content_hash),
          summary = coalesce(excluded.summary, public.ai_news_search_results.summary),
          published_at = coalesce(excluded.published_at, public.ai_news_search_results.published_at),
          source_kind = excluded.source_kind,
          rerank_score = coalesce(excluded.rerank_score, public.ai_news_search_results.rerank_score),
          status = case
            when public.ai_news_search_results.status in ('classified', 'duplicate', 'rejected')
              then public.ai_news_search_results.status
            else excluded.status
          end,
          ignore_reason = case
            when public.ai_news_search_results.status in ('classified', 'duplicate', 'rejected')
              then public.ai_news_search_results.ignore_reason
            else excluded.ignore_reason
          end
    returning id, status into v_id, v_final_status;

    if coalesce(v_final_status, v_status) = 'ignored' then
      v_ignored := v_ignored + 1;
    else
      v_new := v_new + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'total', v_total,
    'new', v_new,
    'ignored', v_ignored
  );
end;
$$;

create or replace function public.ai_news_candidates(
  p_run_id uuid,
  p_limit integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 3), 1), 5);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'title', x.title,
        'url', x.url,
        'source_domain', x.source_domain,
        'source_kind', x.source_kind,
        'snippet', x.snippet,
        'summary', x.summary,
        'content', left(coalesce(x.content, ''), 20000),
        'published_at', x.published_at,
        'query', x.query
      ) order by x.rerank_score desc nulls last, x.id)
      from (
        select * from public.ai_news_search_results r
        where r.status = 'new'
          and r.run_id = p_run_id
          and coalesce(r.content, '') <> ''
        order by r.rerank_score desc nulls last, r.id
        limit v_limit
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.ai_news_result_mark(
  p_result_id bigint,
  p_status text,
  p_event_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('classified', 'ignored', 'duplicate', 'rejected') then
    raise exception 'invalid_result_status' using errcode = '22023';
  end if;

  update public.ai_news_search_results
     set status = p_status,
         event_id = coalesce(p_event_id, event_id),
         ignore_reason = left(nullif(p_reason, ''), 160)
   where id = p_result_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Olay oluşturma / birleştirme ve kanıt
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_evidence_add(
  p_event_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_domain text;
  v_kind text;
  v_content text;
  v_hash text;
  v_id bigint;
begin
  v_url := btrim(coalesce(p_payload ->> 'url', ''));
  if v_url = '' then
    raise exception 'evidence_url_required' using errcode = '22023';
  end if;

  v_domain := public.ai_news_domain(v_url);
  v_kind := coalesce(
    nullif(p_payload ->> 'source_kind', ''),
    public.ai_news_domain_kind(v_domain)
  );
  v_content := left(coalesce(p_payload ->> 'content', ''), 60000);
  v_hash := md5(coalesce(p_payload ->> 'title', '') || '|' || v_content || '|' || v_url);

  insert into public.ai_news_evidence (
    event_id, source_domain, source_kind, url, title, excerpt, facts,
    content_hash, is_primary, independent, fetched_via
  ) values (
    p_event_id, v_domain, v_kind, v_url,
    left(coalesce(p_payload ->> 'title', ''), 400),
    left(coalesce(p_payload ->> 'excerpt', p_payload ->> 'summary', ''), 1200),
    coalesce(p_payload -> 'facts', '{}'::jsonb),
    v_hash,
    coalesce((p_payload ->> 'is_primary')::boolean, v_kind = 'official'),
    coalesce((p_payload ->> 'independent')::boolean, v_kind in ('official', 'trusted_media')),
    coalesce(nullif(p_payload ->> 'fetched_via', ''), 'search')
  )
  on conflict (event_id, content_hash) do update
    set title = excluded.title,
        excerpt = excluded.excerpt,
        facts = excluded.facts,
        retrieved_at = now()
  returning id into v_id;

  -- Bağımsız kaynak sayısı: farklı içerik özeti (syndication kopyası sayılmaz)
  -- ve güvenilir kaynak türü.
  update public.ai_news_events e
     set primary_source = exists (
           select 1 from public.ai_news_evidence v
           where v.event_id = e.id and v.source_kind = 'official'
         ),
         -- Aynı ajans metnini yayımlayan iki site tek doğrulama sayılmaz:
         -- her domain için tek temsilci içerik alınır, sonra farklı içerik
         -- özetleri sayılır.
         independent_sources = (
           select count(distinct x.content_hash)
           from (
             select distinct on (v.source_domain) v.source_domain, v.content_hash
             from public.ai_news_evidence v
             where v.event_id = e.id
               and v.source_kind in ('official', 'trusted_media')
               and v.independent
             order by v.source_domain, v.retrieved_at
           ) x
         ),
         last_seen_at = now()
   where e.id = p_event_id;

  return p_event_id;
end;
$$;

create or replace function public.ai_news_event_upsert(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_result_id bigint;
  v_title text := btrim(coalesce(p_payload ->> 'title', ''));
  v_norm text;
  v_category text;
  v_district text;
  v_event_date date;
  v_summary text;
  v_risk text;
  v_result public.ai_news_search_results%rowtype;
  v_event public.ai_news_events%rowtype;
  v_existing_id uuid;
  v_new_id uuid;
  v_key text;
begin
  if v_title = '' then
    raise exception 'title_required' using errcode = '22023';
  end if;

  select * into v_settings from public.ai_news_settings where id;

  v_result_id := nullif(p_payload ->> 'result_id', '')::bigint;
  if v_result_id is not null then
    select * into v_result from public.ai_news_search_results where id = v_result_id;
  end if;

  v_category := nullif(btrim(coalesce(p_payload ->> 'category_slug', '')), '');
  if v_category is not null and not exists (
    select 1 from public.ai_news_categories c where c.slug = v_category
  ) then
    v_category := 'diger';
  end if;

  v_district := nullif(btrim(coalesce(p_payload ->> 'district', '')), '');
  v_event_date := nullif(p_payload ->> 'event_date', '')::date;
  v_summary := left(nullif(btrim(coalesce(p_payload ->> 'summary', '')), ''), 1200);
  v_risk := upper(coalesce(nullif(p_payload ->> 'risk_level', ''), 'B'));
  if v_risk not in ('A', 'B', 'C') then
    v_risk := 'B';
  end if;

  v_norm := public.ai_news_title_fingerprint(v_title);
  v_key := md5(v_norm || '|' || coalesce(v_district, '') || '|' || coalesce(v_event_date::text, ''));

  -- Aynı olayı yakala: başlık benzerliği + aynı ilçe + 7 gün penceresi.
  select e.id into v_existing_id
  from public.ai_news_events e
  where e.first_seen_at > now() - interval '7 days'
    and coalesce(e.district, '') = coalesce(v_district, '')
    and (
      e.event_key = v_key
      or similarity(e.normalized_title, v_norm) >= v_settings.duplicate_title_threshold
    )
  order by similarity(e.normalized_title, v_norm) desc
  limit 1;

  if v_existing_id is not null then
    update public.ai_news_events
       set last_seen_at = now(),
           summary = coalesce(summary, v_summary),
           risk_level = case
             when risk_level = 'C' or v_risk = 'C' then 'C'
             when risk_level = 'B' or v_risk = 'B' then 'B'
             else 'A'
           end
     where id = v_existing_id
    returning * into v_event;

    if v_result.id is not null then
      perform public.ai_news_result_mark(v_result.id, 'duplicate', v_existing_id, 'same_event');
      perform public.ai_news_evidence_add(v_existing_id, jsonb_build_object(
        'url', v_result.url,
        'title', v_result.title,
        'excerpt', coalesce(v_result.summary, v_result.snippet),
        'content', coalesce(v_result.content, ''),
        'source_kind', v_result.source_kind,
        'fetched_via', v_result.fetched_via,
        'facts', coalesce(p_payload -> 'facts', '{}'::jsonb)
      ));
    end if;

    return jsonb_build_object(
      'event_id', v_event.id,
      'created', false,
      'status', v_event.status,
      'primary_source', v_event.primary_source,
      'independent_sources', v_event.independent_sources
    );
  end if;

  insert into public.ai_news_events (
    event_key, title, normalized_title, category_slug, district, event_date,
    summary, risk_level, status, confidence
  ) values (
    v_key, left(v_title, 400), v_norm, v_category, v_district, v_event_date,
    v_summary, v_risk, 'discovered', coalesce((p_payload ->> 'confidence')::numeric, 0)
  )
  returning * into v_event;

  v_new_id := v_event.id;

  if v_result.id is not null then
    perform public.ai_news_result_mark(v_result.id, 'classified', v_new_id, null);
    perform public.ai_news_evidence_add(v_new_id, jsonb_build_object(
      'url', v_result.url,
      'title', v_result.title,
      'excerpt', coalesce(v_result.summary, v_result.snippet),
      'content', coalesce(v_result.content, ''),
      'source_kind', v_result.source_kind,
      'fetched_via', v_result.fetched_via,
      'facts', coalesce(p_payload -> 'facts', '{}'::jsonb)
    ));
  end if;

  perform public.ai_news_event_set_status(v_new_id, 'classified');

  select * into v_event from public.ai_news_events where id = v_new_id;

  return jsonb_build_object(
    'event_id', v_event.id,
    'created', true,
    'status', v_event.status,
    'primary_source', v_event.primary_source,
    'independent_sources', v_event.independent_sources
  );
end;
$$;

create or replace function public.ai_news_verification_save(
  p_event_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.ai_news_events%rowtype;
  v_draft_id uuid := nullif(p_payload ->> 'draft_id', '')::uuid;
  v_checks jsonb := coalesce(p_payload -> 'checks', '{}'::jsonb);
  v_conflicts jsonb := coalesce(p_payload -> 'conflicts', '[]'::jsonb);
  v_passed boolean := coalesce((p_payload ->> 'passed')::boolean, false);
  v_risk text := upper(coalesce(nullif(p_payload ->> 'risk_level', ''), 'B'));
  v_reasons text[] := '{}'::text[];
  v_auto boolean;
begin
  if v_risk not in ('A', 'B', 'C') then
    v_risk := 'B';
  end if;

  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  insert into public.ai_news_verification_results (
    event_id, draft_id, checks, conflicts, passed, risk_level, model
  ) values (
    p_event_id, v_draft_id, v_checks, v_conflicts, v_passed, v_risk,
    left(nullif(p_payload ->> 'model', ''), 80)
  );

  -- Yüksek risk asla otomatik yayına düşmez; risk yalnızca yükseltilebilir.
  if v_event.risk_level = 'C' or v_risk = 'C' then
    v_risk := 'C';
  elsif v_event.risk_level = 'B' or v_risk = 'B' then
    v_risk := 'B';
  else
    v_risk := 'A';
  end if;

  if not v_passed then
    v_reasons := array_append(v_reasons, 'verification_failed');
  end if;
  if jsonb_array_length(v_conflicts) > 0 then
    v_reasons := array_append(v_reasons, 'source_conflict');
  end if;
  if v_risk = 'C' then
    v_reasons := array_append(v_reasons, 'high_risk');
  elsif v_risk = 'B' then
    v_reasons := array_append(v_reasons, 'medium_risk');
  end if;
  if not coalesce(v_event.primary_source, false) and coalesce(v_event.independent_sources, 0) < 2 then
    v_reasons := array_append(v_reasons, 'insufficient_independent_sources');
  end if;
  if not public.ai_news_is_trabzon_text(v_event.title || ' ' || coalesce(v_event.summary, '')) then
    v_reasons := array_append(v_reasons, 'trabzon_link_unverified');
  end if;
  if v_event.event_date is null then
    v_reasons := array_append(v_reasons, 'event_date_missing');
  end if;

  update public.ai_news_events
     set risk_level = v_risk,
         conflict = jsonb_array_length(v_conflicts) > 0,
         auto_block_reasons = v_reasons,
         confidence = case when v_passed then greatest(confidence, 0.65) else confidence end,
         last_seen_at = now()
   where id = p_event_id;

  if v_risk = 'A' and v_passed and cardinality(v_reasons) = 0 then
    perform public.ai_news_event_set_status(p_event_id, 'verified');
  else
    perform public.ai_news_event_set_status(p_event_id, 'awaiting_review');
  end if;

  select * into v_event from public.ai_news_events where id = p_event_id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'status', v_event.status,
    'risk_level', v_event.risk_level,
    'auto_block_reasons', to_jsonb(v_event.auto_block_reasons),
    'auto_eligible', v_risk = 'A' and v_passed and cardinality(v_reasons) = 0
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Taslak
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_draft_save(
  p_event_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.ai_news_events%rowtype;
  v_title text := btrim(coalesce(p_payload ->> 'title', ''));
  v_spot text := btrim(coalesce(p_payload ->> 'spot', ''));
  v_body text := btrim(coalesce(p_payload ->> 'body', ''));
  v_category text := nullif(p_payload ->> 'category_slug', '');
  v_quality numeric := least(greatest(coalesce((p_payload ->> 'quality_score')::numeric, 0), 0), 1);
  v_plagiarism numeric := least(greatest(coalesce((p_payload ->> 'plagiarism_score')::numeric, 0), 0), 1);
  v_risk text := upper(coalesce(nullif(p_payload ->> 'risk_level', ''), 'B'));
  v_version integer;
  v_id uuid;
  v_words integer;
begin
  if char_length(v_title) < 15 or char_length(v_title) > 180 then
    raise exception 'title_length_invalid' using errcode = '22023';
  end if;
  if char_length(v_spot) < 40 or char_length(v_spot) > 400 then
    raise exception 'spot_length_invalid' using errcode = '22023';
  end if;
  if char_length(v_body) < 350 or char_length(v_body) > 12000 then
    raise exception 'body_length_invalid' using errcode = '22023';
  end if;
  if v_plagiarism > 0.35 then
    raise exception 'plagiarism_risk' using errcode = '22023';
  end if;
  if v_risk not in ('A', 'B', 'C') then
    v_risk := 'B';
  end if;

  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  if v_event.risk_level = 'C' or v_risk = 'C' then
    v_risk := 'C';
  elsif v_event.risk_level = 'B' or v_risk = 'B' then
    v_risk := 'B';
  else
    v_risk := 'A';
  end if;

  select coalesce(max(d.version), 0) + 1 into v_version
  from public.ai_news_drafts d where d.event_id = p_event_id;

  update public.ai_news_drafts set is_current = false where event_id = p_event_id;

  v_words := coalesce(array_length(
    regexp_split_to_array(btrim(v_body), '\s+'), 1
  ), 0);

  insert into public.ai_news_drafts (
    event_id, version, is_current, title, spot, body, social_copy,
    category_slug, district, event_date, seo_title, seo_description,
    quality_score, plagiarism_score, risk_level, status, ai_model, ai_generated, word_count
  ) values (
    p_event_id, v_version, true, left(v_title, 180), left(v_spot, 400), v_body,
    left(nullif(p_payload ->> 'social_copy', ''), 500),
    coalesce(v_category, v_event.category_slug, 'diger'),
    coalesce(nullif(p_payload ->> 'district', ''), v_event.district),
    coalesce(nullif(p_payload ->> 'event_date', '')::date, v_event.event_date),
    left(nullif(p_payload ->> 'seo_title', ''), 70),
    left(nullif(p_payload ->> 'seo_description', ''), 180),
    v_quality, v_plagiarism, v_risk, 'draft',
    left(nullif(p_payload ->> 'ai_model', ''), 80), true, v_words
  )
  returning id into v_id;

  update public.ai_news_events
     set category_slug = coalesce(category_slug, v_category),
         risk_level = v_risk,
         last_seen_at = now()
   where id = p_event_id;

  if v_event.status in ('verified', 'classified') then
    perform public.ai_news_event_set_status(p_event_id, 'draft');
  end if;

  return jsonb_build_object(
    'draft_id', v_id,
    'version', v_version,
    'word_count', v_words,
    'risk_level', v_risk
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Medya (lisans + olay eşleşmesi)
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_media_save(
  p_event_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_license public.ai_news_media_licenses%rowtype;
  v_code text := coalesce(nullif(p_payload ->> 'license_code', ''), 'unknown');
  v_placeholder boolean := coalesce((p_payload ->> 'is_placeholder')::boolean, false);
  v_match numeric := least(greatest(coalesce((p_payload ->> 'event_match_score')::numeric, 0), 0), 1);
  v_storage text := nullif(btrim(coalesce(p_payload ->> 'storage_path', '')), '');
  v_reference text := nullif(btrim(coalesce(p_payload ->> 'license_reference', '')), '');
  v_attribution text := nullif(btrim(coalesce(p_payload ->> 'attribution', '')), '');
  v_status text := 'candidate';
  v_reason text;
  v_id uuid;
begin
  select * into v_settings from public.ai_news_settings where id;
  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  select * into v_draft from public.ai_news_drafts
  where event_id = p_event_id and is_current
  order by version desc limit 1;

  select * into v_license from public.ai_news_media_licenses where code = v_code;
  if not found then
    raise exception 'license_not_found' using errcode = '22023';
  end if;

  if v_storage is null then
    raise exception 'media_storage_required' using errcode = '22023';
  end if;

  if v_placeholder then
    if not v_license.is_usable or not v_license.commercial_use then
      raise exception 'license_not_usable' using errcode = '22023';
    end if;
    v_status := 'approved';
  elsif not v_license.is_usable or not v_license.commercial_use then
    v_status := 'rejected';
    v_reason := 'license_not_usable';
  elsif v_license.requires_documentation and v_reference is null then
    v_status := 'rejected';
    v_reason := 'license_reference_missing';
  elsif v_license.attribution_required and v_attribution is null then
    v_status := 'rejected';
    v_reason := 'attribution_missing';
  elsif v_match < v_settings.min_media_match then
    v_status := 'rejected';
    v_reason := 'event_mismatch';
  else
    v_status := 'approved';
  end if;

  insert into public.ai_news_media_assets (
    event_id, draft_id, source_url, source_domain, creator, credit,
    license_code, license_reference, attribution, is_placeholder,
    event_match_score, storage_path, thumbnail_path, width, height, mime_type,
    alt_text, status, verified_at, removal_reason
  ) values (
    p_event_id, v_draft.id,
    nullif(p_payload ->> 'source_url', ''),
    nullif(public.ai_news_domain(nullif(p_payload ->> 'source_url', '')), ''),
    left(nullif(p_payload ->> 'creator', ''), 200),
    left(nullif(p_payload ->> 'credit', ''), 200),
    v_code, v_reference, v_attribution, v_placeholder, v_match,
    v_storage,
    nullif(p_payload ->> 'thumbnail_path', ''),
    nullif(p_payload ->> 'width', '')::integer,
    nullif(p_payload ->> 'height', '')::integer,
    left(nullif(p_payload ->> 'mime_type', ''), 80),
    left(coalesce(nullif(p_payload ->> 'alt_text', ''),
      case when v_placeholder then 'Haber kategorisi için Trabzone tasarım görseli'
           else 'Haberle ilişkili fotoğraf' end), 300),
    v_status,
    case when v_status = 'approved' then now() else null end,
    v_reason
  )
  returning id into v_id;

  -- Medya aşaması taslaktan sonra gelir; durum geçişleri tek tek doğrulanır.
  if v_event.status = 'draft' then
    perform public.ai_news_event_set_status(p_event_id, 'media_checking');
    perform public.ai_news_event_set_status(
      p_event_id,
      case when v_status = 'approved' then 'ready' else 'awaiting_review' end
    );
  elsif v_event.status in ('verified', 'classified') then
    perform public.ai_news_event_set_status(p_event_id, 'awaiting_review');
    if v_status = 'approved' then
      perform public.ai_news_event_set_status(p_event_id, 'ready');
    end if;
  elsif v_event.status = 'media_checking' then
    perform public.ai_news_event_set_status(
      p_event_id,
      case when v_status = 'approved' then 'ready' else 'awaiting_review' end
    );
  elsif v_event.status = 'awaiting_review' and v_status = 'approved' then
    perform public.ai_news_event_set_status(p_event_id, 'ready');
  end if;

  return jsonb_build_object(
    'media_id', v_id,
    'status', v_status,
    'reject_reason', v_reason,
    'license', v_code,
    'is_placeholder', v_placeholder
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. Yayın (atomik) + bildirim
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_notify_followers(
  p_post_id uuid,
  p_event_id uuid,
  p_mode text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_publisher uuid;
  v_hour integer;
  v_quiet boolean;
  v_count integer := 0;
begin
  select * into v_settings from public.ai_news_settings where id;
  select * into v_event from public.ai_news_events where id = p_event_id;
  select * into v_draft from public.ai_news_drafts
  where event_id = p_event_id and is_current order by version desc limit 1;

  v_publisher := coalesce(
    v_settings.publisher_user_id,
    (select p.id from public.profiles p where p.username = v_settings.publisher_username)
  );

  if v_settings.notify_enabled is not true or v_publisher is null or v_draft.id is null then
    return 0;
  end if;

  if p_mode = 'auto' and v_event.category_slug is not null
     and not (v_event.category_slug = any (v_settings.notify_categories)) then
    return 0;
  end if;

  v_hour := extract(hour from (now() at time zone 'Europe/Istanbul'))::integer;
  v_quiet := case
    when v_settings.notify_quiet_start = v_settings.notify_quiet_end then false
    when v_settings.notify_quiet_start < v_settings.notify_quiet_end then
      v_hour >= v_settings.notify_quiet_start and v_hour < v_settings.notify_quiet_end
    else
      v_hour >= v_settings.notify_quiet_start or v_hour < v_settings.notify_quiet_end
  end;

  if v_quiet then
    return 0;
  end if;

  -- Aynı gönderi için ikinci kez bildirim üretme.
  if exists (
    select 1 from public.notifications n
    where n.entity_type = 'post' and n.entity_id = p_post_id::text and n.kind = 'news'
  ) then
    return 0;
  end if;

  insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
  select
    f.follower_id,
    v_publisher,
    'news',
    left('Trabzone Haber: ' || v_draft.title, 160),
    left(v_draft.spot, 400),
    'post',
    p_post_id::text,
    '/post/' || p_post_id::text
  from public.user_follows f
    join public.profiles p on p.id = f.follower_id
    left join public.notification_preferences np on np.user_id = f.follower_id
  where f.following_id = v_publisher
    and p.account_status = 'active'
    and coalesce(np.news, true)
    and not public.is_blocked(f.follower_id, v_publisher)
    and (
      select count(*) from public.notifications n
      where n.user_id = f.follower_id
        and n.kind = 'news'
        and n.created_at >= ((public.ai_news_istanbul_day(now())::timestamp)
                             at time zone 'Europe/Istanbul')
    ) < v_settings.notify_daily_cap;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.ai_news_compose_body(
  p_title text,
  p_spot text,
  p_body text,
  p_district text,
  p_category_name text,
  p_sources text,
  p_placeholder boolean
)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    p_title || E'\n\n' || p_spot || E'\n\n' || p_body
    || E'\n\nğŸ“ ' || coalesce(nullif(p_district, ''), 'Trabzon') || ', Trabzon'
    || E'\nğŸ—‚ ' || coalesce(nullif(p_category_name, ''), 'Trabzon Gündem')
    || E'\nğŸ¤– AI destekli haber derlemesi (Trabzone AI Haber Merkezi)'
    || case when coalesce(p_placeholder, false)
         then E'\nğŸ–¼ Kategori tasarım görseli — olay fotoğrafı değildir'
         else '' end
    || case when coalesce(p_sources, '') <> ''
         then E'\nğŸ”— Kaynaklar: ' || p_sources else '' end,
    2000
  );
$$;

create or replace function public.ai_news_publish_event(
  p_event_id uuid,
  p_mode text default 'auto',
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_media public.ai_news_media_assets%rowtype;
  v_license public.ai_news_media_licenses%rowtype;
  v_category public.ai_news_categories%rowtype;
  v_publisher uuid;
  v_existing public.ai_news_publications%rowtype;
  v_post_id uuid;
  v_publication_id uuid;
  v_body text;
  v_sources text;
  v_slot integer;
  v_day date := public.ai_news_istanbul_day(now());
  v_mode text := case when p_mode = 'manual' then 'manual' else 'auto' end;
  v_placeholder boolean := false;
  v_notified integer := 0;
begin
  select * into v_settings from public.ai_news_settings where id;

  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.ai_news_publications where event_id = p_event_id;
  if found then
    return jsonb_build_object(
      'published', true,
      'already_published', true,
      'post_id', v_existing.post_id,
      'publication_id', v_existing.id,
      'status', v_existing.status
    );
  end if;

  if v_event.status not in ('ready', 'awaiting_review', 'verified') then
    raise exception 'event_not_publishable' using errcode = '22023';
  end if;

  select * into v_draft from public.ai_news_drafts
  where event_id = p_event_id and is_current
  order by version desc limit 1;

  if v_draft.id is null then
    raise exception 'draft_missing' using errcode = '22023';
  end if;

  select * into v_publisher from public.profiles
  where id = coalesce(
    v_settings.publisher_user_id,
    (select p.id from public.profiles p where p.username = v_settings.publisher_username)
  );

  if v_publisher.id is null then
    raise exception 'publisher_missing' using errcode = '22023';
  end if;
  if v_publisher.account_status <> 'active' then
    raise exception 'publisher_inactive' using errcode = '22023';
  end if;

  if v_mode = 'auto' then
    if v_settings.auto_publish_enabled is not true then
      raise exception 'auto_publish_disabled' using errcode = '22023';
    end if;
    if v_settings.dry_run then
      raise exception 'dry_run_active' using errcode = '22023';
    end if;
    if v_event.risk_level <> 'A' then
      raise exception 'risk_blocked' using errcode = '22023';
    end if;
    if coalesce(v_event.conflict, false) then
      raise exception 'source_conflict' using errcode = '22023';
    end if;
    if cardinality(v_event.auto_block_reasons) > 0 then
      raise exception 'auto_block_reasons' using errcode = '22023';
    end if;
    if not coalesce(v_event.primary_source, false)
       and coalesce(v_event.independent_sources, 0) < 2 then
      raise exception 'insufficient_independent_sources' using errcode = '22023';
    end if;
    if v_draft.quality_score < v_settings.min_quality_score then
      raise exception 'quality_too_low' using errcode = '22023';
    end if;
  end if;

  select * into v_media
  from public.ai_news_media_assets m
  where m.event_id = p_event_id and m.status = 'approved'
  order by m.is_placeholder asc, m.event_match_score desc, m.created_at asc
  limit 1;

  if v_media.id is not null then
    select * into v_license from public.ai_news_media_licenses where code = v_media.license_code;

    if not v_media.is_placeholder then
      if v_license.id is null or not v_license.is_usable or not v_license.commercial_use then
        raise exception 'media_license_invalid' using errcode = '22023';
      end if;
      if v_license.requires_documentation and v_media.license_reference is null then
        raise exception 'media_license_documentation_missing' using errcode = '22023';
      end if;
      if v_license.attribution_required and v_media.attribution is null then
        raise exception 'media_attribution_missing' using errcode = '22023';
      end if;
      if v_media.event_match_score < v_settings.min_media_match then
        raise exception 'media_event_mismatch' using errcode = '22023';
      end if;
    end if;

    v_placeholder := v_media.is_placeholder;
  end if;

  select * into v_category from public.ai_news_categories
  where slug = coalesce(v_draft.category_slug, v_event.category_slug);

  select coalesce(string_agg(distinct v.source_domain::text, ', '), '')
  into v_sources
  from public.ai_news_evidence v
  where v.event_id = p_event_id;

  v_body := public.ai_news_compose_body(
    v_draft.title, v_draft.spot, v_draft.body,
    coalesce(v_draft.district, v_event.district),
    v_category.name_tr, v_sources, v_placeholder
  );

  -- Kota, tüm doğrulamalar geçtikten hemen sonra atomik olarak tüketilir.
  if v_mode = 'auto' then
    v_slot := public.ai_news_quota_reserve(v_day, v_settings.daily_auto_limit);
    if v_slot is null then
      raise exception 'quota_exhausted' using errcode = '22023';
    end if;
  else
    insert into public.ai_news_quota_days (day, manual_published)
    values (v_day, 1)
    on conflict (day) do update
      set manual_published = public.ai_news_quota_days.manual_published + 1,
          updated_at = now();
  end if;

  insert into public.posts (author_id, body, visibility, city)
  values (v_publisher.id, v_body, 'public', 'Trabzon')
  returning id into v_post_id;

  if v_media.id is not null then
    insert into public.post_media (
      post_id, storage_path, thumbnail_path, media_type, width, height, sort_order
    ) values (
      v_post_id, v_media.storage_path, v_media.thumbnail_path, 'image',
      v_media.width, v_media.height, 0
    );

    update public.ai_news_media_assets
       set status = 'published'
     where id = v_media.id
       and status = 'approved';
  end if;

  insert into public.ai_news_publications (
    event_id, draft_id, post_id, mode, status, published_at
  ) values (
    p_event_id, v_draft.id, v_post_id, v_mode, 'published', now()
  )
  returning id into v_publication_id;

  update public.ai_news_events
     set published_post_id = v_post_id,
         last_seen_at = now()
   where id = p_event_id;

  perform public.ai_news_event_set_status(p_event_id, 'published');

  update public.ai_news_drafts
     set status = 'published'
   where id = v_draft.id;

  update public.ai_news_review_queue
     set state = 'approved',
         resolved_at = now(),
         resolved_by = coalesce(p_actor, v_publisher.id)
   where event_id = p_event_id and state = 'pending';

  insert into public.ai_news_publication_history (publication_id, action, actor_id, details)
  values (
    v_publication_id,
    case when v_mode = 'auto' then 'auto_published' else 'manual_published' end,
    p_actor,
    jsonb_build_object(
      'post_id', v_post_id,
      'risk_level', v_event.risk_level,
      'quality_score', v_draft.quality_score,
      'quota_slot', v_slot,
      'media_placeholder', v_placeholder,
      'media_license', v_media.license_code
    )
  );

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor,
    case when v_mode = 'auto' then 'news.auto_publish' else 'news.manual_publish' end,
    'ai_news_event',
    p_event_id::text,
    jsonb_build_object(
      'post_id', v_post_id,
      'publisher', v_publisher.username,
      'risk_level', v_event.risk_level,
      'sources', v_event.independent_sources,
      'primary_source', v_event.primary_source
    )
  );

  v_notified := public.ai_news_notify_followers(v_post_id, p_event_id, v_mode);

  return jsonb_build_object(
    'published', true,
    'already_published', false,
    'post_id', v_post_id,
    'publication_id', v_publication_id,
    'publisher', v_publisher.username,
    'quota_slot', v_slot,
    'notified', v_notified,
    'media_placeholder', v_placeholder
  );
end;
$$;

-- Otomatik yayın kapısı: tüm koşullar sağlanmıyorsa inceleme kuyruğuna alır.
create or replace function public.ai_news_finalize(
  p_event_id uuid,
  p_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_media public.ai_news_media_assets%rowtype;
  v_reasons text[] := '{}'::text[];
  v_publish jsonb;
  v_error text;
  v_priority smallint := 50;
begin
  select * into v_settings from public.ai_news_settings where id;
  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  select * into v_draft from public.ai_news_drafts
  where event_id = p_event_id and is_current
  order by version desc limit 1;

  select * into v_media
  from public.ai_news_media_assets m
  where m.event_id = p_event_id and m.status = 'approved'
  order by m.is_placeholder asc, m.created_at asc
  limit 1;

  if v_draft.id is null then
    v_reasons := array_append(v_reasons, 'draft_missing');
  else
    if v_draft.quality_score < v_settings.min_quality_score then
      v_reasons := array_append(v_reasons, 'quality_too_low');
    end if;
    if v_draft.plagiarism_score > 0.35 then
      v_reasons := array_append(v_reasons, 'plagiarism_risk');
    end if;
  end if;

  if v_media.id is null then
    v_reasons := array_append(v_reasons, 'media_missing');
  end if;

  v_reasons := v_reasons || v_event.auto_block_reasons;

  if v_event.risk_level <> 'A' then
    v_reasons := array_append(v_reasons, 'risk_not_low');
  end if;
  if v_settings.auto_publish_enabled is not true then
    v_reasons := array_append(v_reasons, 'auto_publish_disabled');
  end if;
  if v_settings.dry_run then
    v_reasons := array_append(v_reasons, 'dry_run_active');
  end if;

  v_reasons := array(
    select distinct unnest(v_reasons)
  );

  if cardinality(v_reasons) = 0 then
    begin
      v_publish := public.ai_news_publish_event(p_event_id, 'auto', null);
      return jsonb_build_object(
        'action', 'published',
        'reasons', '[]'::jsonb,
        'publication', v_publish
      );
    exception
      when others then
        v_error := sqlerrm;
        v_reasons := array_append(v_reasons, v_error);
    end;
  end if;

  if v_event.status not in ('awaiting_review', 'ready', 'media_checking', 'draft', 'verified') then
    perform public.ai_news_event_set_status(p_event_id, 'awaiting_review');
  end if;

  if v_event.risk_level = 'C' then
    v_priority := 90;
  elsif v_event.risk_level = 'B' then
    v_priority := 70;
  end if;
  if v_event.conflict then
    v_priority := 95;
  end if;

  insert into public.ai_news_review_queue (event_id, draft_id, reasons, priority, state)
  values (p_event_id, v_draft.id, v_reasons, v_priority, 'pending')
  on conflict (event_id) do update
    set draft_id = excluded.draft_id,
        reasons = excluded.reasons,
        priority = greatest(public.ai_news_review_queue.priority, excluded.priority),
        state = case when public.ai_news_review_queue.state = 'pending'
                     then 'pending' else public.ai_news_review_queue.state end;

  update public.ai_news_drafts
     set status = 'awaiting_review'
   where event_id = p_event_id and is_current;

  if p_run_id is not null and v_error is not null then
    perform public.ai_news_log_error(p_run_id, 'publish', v_error, 'Otomatik yayın kapısı', jsonb_build_object(
      'event_id', p_event_id, 'reasons', v_reasons
    ));
  end if;

  return jsonb_build_object(
    'action', 'review',
    'reasons', to_jsonb(v_reasons),
    'priority', v_priority
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Kamuya açık haber meta verisi
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_public_post(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_publication public.ai_news_publications%rowtype;
  v_category public.ai_news_categories%rowtype;
  v_sources jsonb;
  v_media public.ai_news_media_assets%rowtype;
  v_post public.posts%rowtype;
begin
  select * into v_post from public.posts where id = p_post_id;
  if not found or v_post.moderation_status <> 'visible' then
    return null;
  end if;

  select * into v_publication
  from public.ai_news_publications
  where post_id = p_post_id and status = 'published';
  if not found then
    return null;
  end if;

  select * into v_event from public.ai_news_events where id = v_publication.event_id;
  select * into v_draft from public.ai_news_drafts where id = v_publication.draft_id;
  select * into v_category from public.ai_news_categories
  where slug = coalesce(v_draft.category_slug, v_event.category_slug);
  select * into v_media from public.ai_news_media_assets
  where event_id = v_event.id and status = 'published'
  order by created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'domain', v.source_domain::text,
    'kind', v.source_kind,
    'url', v.url,
    'title', v.title,
    'retrieved_at', v.retrieved_at
  ) order by v.source_kind = 'official' desc, v.retrieved_at), '[]'::jsonb)
  into v_sources
  from public.ai_news_evidence v
  where v.event_id = v_event.id;

  return jsonb_build_object(
    'event_id', v_event.id,
    'post_id', p_post_id,
    'title', v_draft.title,
    'spot', v_draft.spot,
    'body', v_draft.body,
    'category_slug', coalesce(v_draft.category_slug, v_event.category_slug),
    'category_name', coalesce(v_category.name_tr, 'Trabzon Gündem'),
    'district', coalesce(v_draft.district, v_event.district),
    'event_date', coalesce(v_draft.event_date, v_event.event_date),
    'risk_level', v_event.risk_level,
    'ai_generated', true,
    'ai_model', v_draft.ai_model,
    'disclosure', 'Bu haber, Trabzone AI Haber Merkezi tarafından kamuya açık kaynaklardan derlenmiştir. Metin yapay zekâ desteğiyle hazırlanır; yayın kararı kaynak doğrulaması ve risk kurallarıyla verilir.',
    'sources', v_sources,
    'source_count', jsonb_array_length(v_sources),
    'independent_sources', v_event.independent_sources,
    'primary_source', v_event.primary_source,
    'published_at', v_publication.published_at,
    'updated_at', v_draft.updated_at,
    'last_checked_at', v_publication.published_at,
    'correction_path', '/support',
    'published_by', 'Trabzone Haber',
    'media', case when v_media.id is null then null else jsonb_build_object(
      'storage_path', v_media.storage_path,
      'is_placeholder', v_media.is_placeholder,
      'alt_text', v_media.alt_text,
      'credit', v_media.credit,
      'license_code', v_media.license_code,
      'attribution', v_media.attribution
    ) end
  );
end;
$$;

create or replace function public.ai_news_post_meta(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  v_data := public.ai_news_public_post(p_post_id);
  if v_data is null then
    return null;
  end if;

  -- Akış kartı için gövde ve kaynak URL listesi gerekmez.
  return v_data - 'body' - 'disclosure' - 'correction_path';
end;
$$;

create or replace function public.ai_news_sitemap_urls(
  p_limit integer default 1000,
  p_offset integer default 0
)
returns table (
  post_id uuid,
  title text,
  category_name text,
  published_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, d.title, c.name_tr, pub.published_at, d.updated_at
  from public.ai_news_publications pub
    join public.posts p on p.id = pub.post_id
    join public.ai_news_drafts d on d.id = pub.draft_id
    join public.ai_news_events e on e.id = pub.event_id
    left join public.ai_news_categories c
      on c.slug = coalesce(d.category_slug, e.category_slug)
  where pub.status = 'published'
    and p.moderation_status = 'visible'
  order by pub.published_at desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 20000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------------------
-- 17. Mevcut akış fonksiyonlarına haber bilgisi ekleme
-- ---------------------------------------------------------------------------
create or replace function public.tz_post_json(p_post_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'author_id', p.author_id,
    'author_username', pr.username,
    'author_first_name', pr.first_name,
    'author_last_name', pr.last_name,
    'author_avatar_path', pr.avatar_path,
    'author_is_verified', pr.is_verified,
    'body', p.body,
    'visibility', p.visibility,
    'city', p.city,
    'moderation_status', p.moderation_status,
    'like_count', p.like_count,
    'comment_count', p.comment_count,
    'save_count', p.save_count,
    'share_count', p.share_count,
    'is_edited', p.is_edited,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'liked', exists (
      select 1 from public.post_likes l where l.post_id = p.id and l.user_id = p_me
    ),
    'saved', exists (
      select 1 from public.post_saves s where s.post_id = p.id and s.user_id = p_me
    ),
    'is_mine', p.author_id = p_me,
    'news', public.ai_news_post_meta(p.id),
    'media', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'storage_path', m.storage_path,
            'thumbnail_path', m.thumbnail_path,
            'media_type', m.media_type,
            'width', m.width,
            'height', m.height,
            'duration_ms', m.duration_ms
          )
          order by m.sort_order, m.created_at
        )
        from public.post_media m
        where m.post_id = p.id
      ),
      '[]'::jsonb
    )
  )
  from public.posts p
    join public.profiles pr on pr.id = p.author_id
  where p.id = p_post_id;
$$;

revoke all on function public.tz_post_json(uuid, uuid) from public, anon, authenticated;

-- Profil sekmelerinde "Haberler" desteği.
create or replace function public.feed_profile_posts(
  p_username text,
  p_kind     text default 'posts',
  p_limit    integer default 18,
  p_offset   integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_author uuid;
  v_limit  integer := least(greatest(coalesce(p_limit, 18), 1), 40);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_kind   text := coalesce(nullif(trim(p_kind), ''), 'posts');
begin
  select p.id into v_author
  from public.profiles p
  where p.username = lower(trim(p_username));

  if v_author is null or public.is_blocked(v_uid, v_author) then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

  if not public.can_view_profile_content(v_author) then
    raise exception 'profile_restricted' using errcode = '42501';
  end if;

  if v_kind not in ('posts', 'media', 'news') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_post_json(x.id, v_uid) order by x.created_at desc)
        from (
          select p.id, p.created_at
          from public.posts p
          where p.author_id = v_author
            and p.moderation_status = 'visible'
            and (p.visibility = 'public' or v_author = v_uid or public.is_following(v_author))
            and (
              v_kind = 'posts'
              or (v_kind = 'media' and exists (
                select 1 from public.post_media m where m.post_id = p.id
              ))
              or (v_kind = 'news' and exists (
                select 1 from public.ai_news_publications pub
                where pub.post_id = p.id and pub.status = 'published'
              ))
            )
          order by p.created_at desc
          limit v_limit offset v_offset
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.feed_profile_posts(text, text, integer, integer) from public, anon;
grant execute on function public.feed_profile_posts(text, text, integer, integer) to authenticated;

-- Akışta "Haberler" filtresi.
create or replace function public.feed_list(
  p_filter text default 'all',
  p_city   text default null,
  p_cursor timestamptz default null,
  p_limit  integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me    uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
  v_filter text := coalesce(nullif(trim(p_filter), ''), 'all');
begin
  if v_filter not in ('all', 'following', 'nearby', 'popular', 'news') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;

  return (
    with base as (
      select
        p.id,
        p.created_at,
        (p.like_count + p.comment_count * 2 + p.save_count * 2) as score
      from public.posts p
        join public.profiles pr on pr.id = p.author_id
      where p.moderation_status = 'visible'
        and pr.account_status = 'active'
        and not public.is_blocked(v_me, p.author_id)
        and (
          p.visibility = 'public'
          or p.author_id = v_me
          or public.is_following(p.author_id)
        )
        and (p_cursor is null or p.created_at < p_cursor)
        and (
          v_filter <> 'following'
          or p.author_id = v_me
          or public.is_following(p.author_id)
        )
        and (
          v_filter <> 'nearby'
          or p_city is null
          or (p.city is not null and lower(trim(p.city)) = lower(trim(p_city)))
        )
        and (v_filter <> 'popular' or p.created_at > now() - interval '30 days')
        and (
          v_filter <> 'news'
          or exists (
            select 1 from public.ai_news_publications pub
            where pub.post_id = p.id and pub.status = 'published'
          )
        )
      order by
        case when v_filter = 'popular' then
          (p.like_count + p.comment_count * 2 + p.save_count * 2)
        end desc nulls last,
        p.created_at desc
      limit v_limit + 1
    ),
    numbered as (
      select
        b.id,
        b.created_at,
        row_number() over (
          order by
            case when v_filter = 'popular' then b.score end desc nulls last,
            b.created_at desc
        ) as rn
      from base b
    )
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(public.tz_post_json(n.id, v_me) order by n.rn)
          from numbered n
          where n.rn <= v_limit
        ),
        '[]'::jsonb
      ),
      'next_cursor', (select n.created_at from numbered n where n.rn = v_limit),
      'has_more', (select count(*) from numbered) > v_limit
    )
  );
end;
$$;

revoke all on function public.feed_list(text, text, timestamptz, integer) from public, anon;
grant execute on function public.feed_list(text, text, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 18. Yönetici okuma modelleri
-- ---------------------------------------------------------------------------
create or replace function public.admin_ai_news_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_settings public.ai_news_settings%rowtype;
  v_day_start timestamptz;
  v_month_start timestamptz;
  v_today date := public.ai_news_istanbul_day(now());
  v_last_run jsonb;
  v_next_run timestamptz;
  v_budget jsonb;
  v_quota jsonb;
  v_publisher jsonb;
begin
  select * into v_settings from public.ai_news_settings where id;

  v_day_start := (v_today::timestamp at time zone 'Europe/Istanbul');
  v_month_start := (date_trunc('month', v_today)::timestamp at time zone 'Europe/Istanbul');

  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'trigger', r.trigger,
    'started_at', r.started_at, 'finished_at', r.finished_at,
    'stats', r.stats, 'error', r.error
  ) into v_last_run
  from public.ai_news_runs r
  order by r.started_at desc
  limit 1;

  select min(r.started_at) into v_next_run
  from public.ai_news_runs r
  where r.status = 'running';

  v_next_run := case
    when exists (select 1 from public.ai_news_runs r where r.status = 'running')
      then null
    else v_settings.next_run_at
  end;

  v_budget := public.ai_news_budget_status();
  v_quota := public.ai_news_quota_status();

  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'avatar_path', p.avatar_path, 'is_verified', p.is_verified
  ) end
  into v_publisher
  from public.profiles p
  where p.id = coalesce(
    v_settings.publisher_user_id,
    (select pr.id from public.profiles pr where pr.username = v_settings.publisher_username)
  );

  return jsonb_build_object(
    'enabled', v_settings.enabled,
    'auto_publish_enabled', v_settings.auto_publish_enabled,
    'dry_run', v_settings.dry_run,
    'scan_interval_minutes', v_settings.scan_interval_minutes,
    'daily_limit', v_settings.daily_auto_limit,
    'last_tick_at', v_settings.last_tick_at,
    'next_run_at', v_next_run,
    'last_run', v_last_run,
    'publisher', v_publisher,
    'quota', v_quota,
    'budget', v_budget,
    'counts', jsonb_build_object(
      'found_today', (select count(*) from public.ai_news_search_results r where r.created_at >= v_day_start),
      'events_today', (select count(*) from public.ai_news_events e where e.created_at >= v_day_start),
      'verified_today', (select count(*) from public.ai_news_events e
                          where e.status in ('verified','draft','media_checking','ready','published','awaiting_review')
                            and e.updated_at >= v_day_start),
      'published_today', (select count(*) from public.ai_news_publications p
                           where p.published_at >= v_day_start and p.mode = 'auto'),
      'published_today_all', (select count(*) from public.ai_news_publications p
                               where p.published_at >= v_day_start),
      'pending_review', (select count(*) from public.ai_news_review_queue q where q.state = 'pending'),
      'rejected_today', (select count(*) from public.ai_news_events e
                          where e.status = 'rejected' and e.updated_at >= v_day_start),
      'duplicates_today', (select count(*) from public.ai_news_search_results r
                            where r.status = 'duplicate' and r.created_at >= v_day_start),
      'media_missing', (select count(*) from public.ai_news_events e
                         where e.status = 'awaiting_review'
                           and not exists (
                             select 1 from public.ai_news_media_assets m
                             where m.event_id = e.id and m.status = 'approved'
                           )),
      'errors_24h', (select count(*) from public.ai_news_errors e
                      where e.created_at > now() - interval '24 hours')
    ),
    'costs', jsonb_build_object(
      'today_usd', round(coalesce((select sum(cost_usd) from public.ai_news_cost_logs where created_at >= v_day_start), 0), 6),
      'month_usd', round(coalesce((select sum(cost_usd) from public.ai_news_cost_logs where created_at >= v_month_start), 0), 6),
      'today_searches', (select coalesce(sum(calls), 0) from public.ai_news_cost_logs
                          where kind = 'search' and created_at >= v_day_start),
      'today_fetches', (select coalesce(sum(calls), 0) from public.ai_news_cost_logs
                         where kind = 'fetch' and created_at >= v_day_start),
      'today_tokens_in', (select coalesce(sum(tokens_in), 0) from public.ai_news_cost_logs
                           where kind = 'model' and created_at >= v_day_start),
      'today_tokens_out', (select coalesce(sum(tokens_out), 0) from public.ai_news_cost_logs
                            where kind = 'model' and created_at >= v_day_start)
    ),
    'diagnostics', v_settings.last_diagnostics
  );
end;
$$;

create or replace function public.admin_ai_news_runs_list(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'status', x.status, 'trigger', x.trigger,
        'started_at', x.started_at, 'finished_at', x.finished_at,
        'stats', x.stats, 'error', x.error,
        'cost_usd', x.cost_usd
      ) order by x.started_at desc)
      from (
        select r.*, coalesce((
          select sum(c.cost_usd) from public.ai_news_cost_logs c where c.run_id = r.id
        ), 0) as cost_usd
        from public.ai_news_runs r
        order by r.started_at desc
        limit v_limit
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_ai_news_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
begin
  return (
    select to_jsonb(s) - 'id' - 'created_at' - 'updated_at' - 'last_diagnostics'
    from public.ai_news_settings s where s.id
  );
end;
$$;

create or replace function public.admin_ai_news_settings_save(
  p_payload jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_settings public.ai_news_settings%rowtype;
  v_old jsonb;
  v_publisher uuid;
  v_username extensions.citext := lower(btrim(coalesce(p_payload ->> 'publisher_username', 'trabzonehaber')));
begin
  select * into v_settings from public.ai_news_settings where id for update;
  v_old := to_jsonb(v_settings);

  if p_payload ? 'publisher_username' then
    select p.id into v_publisher from public.profiles p where p.username = v_username;
  else
    v_publisher := v_settings.publisher_user_id;
    v_username := v_settings.publisher_username;
  end if;

  update public.ai_news_settings
     set enabled = coalesce((p_payload ->> 'enabled')::boolean, enabled),
         auto_publish_enabled = coalesce((p_payload ->> 'auto_publish_enabled')::boolean, auto_publish_enabled),
         dry_run = coalesce((p_payload ->> 'dry_run')::boolean, dry_run),
         scan_interval_minutes = coalesce((p_payload ->> 'scan_interval_minutes')::integer, scan_interval_minutes),
         daily_auto_limit = coalesce((p_payload ->> 'daily_auto_limit')::integer, daily_auto_limit),
         max_events_per_run = coalesce((p_payload ->> 'max_events_per_run')::integer, max_events_per_run),
         max_searches_per_run = coalesce((p_payload ->> 'max_searches_per_run')::integer, max_searches_per_run),
         max_article_age_hours = coalesce((p_payload ->> 'max_article_age_hours')::integer, max_article_age_hours),
         min_quality_score = coalesce((p_payload ->> 'min_quality_score')::numeric, min_quality_score),
         duplicate_title_threshold = coalesce((p_payload ->> 'duplicate_title_threshold')::numeric, duplicate_title_threshold),
         min_media_match = coalesce((p_payload ->> 'min_media_match')::numeric, min_media_match),
         publisher_user_id = v_publisher,
         publisher_username = v_username,
         fast_model = coalesce(nullif(p_payload ->> 'fast_model', ''), fast_model),
         reasoning_model = coalesce(nullif(p_payload ->> 'reasoning_model', ''), reasoning_model),
         daily_budget_usd = coalesce((p_payload ->> 'daily_budget_usd')::numeric, daily_budget_usd),
         monthly_budget_usd = coalesce((p_payload ->> 'monthly_budget_usd')::numeric, monthly_budget_usd),
         notify_enabled = coalesce((p_payload ->> 'notify_enabled')::boolean, notify_enabled),
         notify_daily_cap = coalesce((p_payload ->> 'notify_daily_cap')::integer, notify_daily_cap),
         notify_quiet_start = coalesce((p_payload ->> 'notify_quiet_start')::integer, notify_quiet_start),
         notify_quiet_end = coalesce((p_payload ->> 'notify_quiet_end')::integer, notify_quiet_end),
         notify_categories = case
           when p_payload ? 'notify_categories'
             then coalesce(array(select jsonb_array_elements_text(p_payload -> 'notify_categories')), '{}'::text[])
           else notify_categories
         end,
         worker_url = coalesce(nullif(p_payload ->> 'worker_url', ''), worker_url),
         next_run_at = case
           when p_payload ? 'scan_interval_minutes'
             then least(next_run_at, now() + make_interval(mins => coalesce((p_payload ->> 'scan_interval_minutes')::integer, scan_interval_minutes)))
           else next_run_at
         end,
         updated_at = now()
   where id;

  select * into v_settings from public.ai_news_settings where id;

  perform public.tz_admin_audit(
    'news.settings.save', 'AI Haber Merkezi ayarları güncellendi', 'ai_news', 'settings',
    jsonb_build_object(
      'old', jsonb_build_object(
        'enabled', v_old -> 'enabled',
        'auto_publish_enabled', v_old -> 'auto_publish_enabled',
        'daily_auto_limit', v_old -> 'daily_auto_limit',
        'scan_interval_minutes', v_old -> 'scan_interval_minutes',
        'dry_run', v_old -> 'dry_run'
      ),
      'new', jsonb_build_object(
        'enabled', v_settings.enabled,
        'auto_publish_enabled', v_settings.auto_publish_enabled,
        'daily_auto_limit', v_settings.daily_auto_limit,
        'scan_interval_minutes', v_settings.scan_interval_minutes,
        'dry_run', v_settings.dry_run
      )
    ) || case when nullif(btrim(coalesce(p_reason, '')), '') is not null
              then jsonb_build_object('reason', left(btrim(p_reason), 400)) else '{}'::jsonb end,
    'success'
  );

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_admin, 'news.settings.save', 'ai_news', 'settings',
          jsonb_build_object('reason', left(coalesce(p_reason, ''), 400)));

  return public.admin_ai_news_settings_get();
end;
$$;

create or replace function public.admin_ai_news_review_list(
  p_state text default 'pending',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_state text := coalesce(nullif(p_state, ''), 'pending');
begin
  if v_state not in ('pending', 'approved', 'rejected', 'deferred', 'archived', 'all') then
    raise exception 'invalid_state' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'queue_id', q.id,
        'event_id', e.id,
        'title', coalesce(d.title, e.title),
        'spot', d.spot,
        'category_name', c.name_tr,
        'district', coalesce(d.district, e.district),
        'risk_level', e.risk_level,
        'reasons', to_jsonb(q.reasons),
        'priority', q.priority,
        'state', q.state,
        'created_at', q.created_at,
        'resolved_at', q.resolved_at,
        'quality_score', d.quality_score,
        'independent_sources', e.independent_sources,
        'primary_source', e.primary_source,
        'media_placeholder', m.is_placeholder,
        'published_post_id', e.published_post_id
      ) order by q.priority desc, q.created_at desc)
      from (
        select * from public.ai_news_review_queue q
        where (v_state = 'all' or q.state = v_state)
        order by q.priority desc, q.created_at desc
        limit v_limit offset v_offset
      ) q
        join public.ai_news_events e on e.id = q.event_id
        left join public.ai_news_drafts d on d.id = q.draft_id
        left join public.ai_news_categories c
          on c.slug = coalesce(d.category_slug, e.category_slug)
        left join public.ai_news_media_assets m
          on m.event_id = e.id and m.status in ('approved', 'published')
    ), '[]'::jsonb),
    'total', (
      select count(*) from public.ai_news_review_queue q
      where (v_state = 'all' or q.state = v_state)
    )
  );
end;
$$;

create or replace function public.admin_ai_news_review_get(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_queue public.ai_news_review_queue%rowtype;
  v_publication public.ai_news_publications%rowtype;
begin
  select * into v_event from public.ai_news_events where id = p_event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  select * into v_draft from public.ai_news_drafts
  where event_id = p_event_id and is_current
  order by version desc limit 1;

  select * into v_queue from public.ai_news_review_queue where event_id = p_event_id;
  select * into v_publication from public.ai_news_publications where event_id = p_event_id;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'title', v_event.title,
      'status', v_event.status,
      'risk_level', v_event.risk_level,
      'category_slug', coalesce(v_draft.category_slug, v_event.category_slug),
      'district', coalesce(v_draft.district, v_event.district),
      'event_date', coalesce(v_draft.event_date, v_event.event_date),
      'summary', v_event.summary,
      'primary_source', v_event.primary_source,
      'independent_sources', v_event.independent_sources,
      'conflict', v_event.conflict,
      'auto_block_reasons', to_jsonb(v_event.auto_block_reasons),
      'created_at', v_event.created_at
    ),
    'draft', case when v_draft.id is null then null else jsonb_build_object(
      'id', v_draft.id,
      'version', v_draft.version,
      'title', v_draft.title,
      'spot', v_draft.spot,
      'body', v_draft.body,
      'social_copy', v_draft.social_copy,
      'quality_score', v_draft.quality_score,
      'plagiarism_score', v_draft.plagiarism_score,
      'word_count', v_draft.word_count,
      'ai_model', v_draft.ai_model,
      'status', v_draft.status,
      'updated_at', v_draft.updated_at
    ) end,
    'queue', case when v_queue.id is null then null else jsonb_build_object(
      'id', v_queue.id,
      'reasons', to_jsonb(v_queue.reasons),
      'priority', v_queue.priority,
      'state', v_queue.state,
      'notes', v_queue.notes,
      'created_at', v_queue.created_at
    ) end,
    'publication', case when v_publication.id is null then null else jsonb_build_object(
      'id', v_publication.id,
      'post_id', v_publication.post_id,
      'mode', v_publication.mode,
      'status', v_publication.status,
      'published_at', v_publication.published_at,
      'retracted_at', v_publication.retracted_at,
      'retract_reason', v_publication.retract_reason
    ) end,
    'verification', coalesce((
      select jsonb_agg(jsonb_build_object(
        'checks', v.checks,
        'conflicts', v.conflicts,
        'passed', v.passed,
        'risk_level', v.risk_level,
        'model', v.model,
        'created_at', v.created_at
      ) order by v.created_at desc)
      from (
        select * from public.ai_news_verification_results
        where event_id = p_event_id order by created_at desc limit 3
      ) v
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'domain', v.source_domain::text,
        'kind', v.source_kind,
        'url', v.url,
        'title', v.title,
        'excerpt', v.excerpt,
        'facts', v.facts,
        'is_primary', v.is_primary,
        'independent', v.independent,
        'retrieved_at', v.retrieved_at
      ) order by v.is_primary desc, v.retrieved_at desc)
      from public.ai_news_evidence v
      where v.event_id = p_event_id
    ), '[]'::jsonb),
    'media', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'storage_path', m.storage_path,
        'license_code', m.license_code,
        'license_name', l.name_tr,
        'license_reference', m.license_reference,
        'attribution', m.attribution,
        'is_placeholder', m.is_placeholder,
        'event_match_score', m.event_match_score,
        'status', m.status,
        'alt_text', m.alt_text,
        'source_url', m.source_url,
        'reject_reason', m.removal_reason
      ) order by m.created_at desc)
      from public.ai_news_media_assets m
        left join public.ai_news_media_licenses l on l.code = m.license_code
      where m.event_id = p_event_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_ai_news_review_action(
  p_event_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text := lower(coalesce(nullif(btrim(p_action), ''), ''));
  v_result jsonb;
  v_draft_id uuid;
  v_version integer;
begin
  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  if v_action in ('reject', 'archive', 'retract') and (v_reason is null or length(v_reason) < 3) then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_draft from public.ai_news_drafts
  where event_id = p_event_id and is_current
  order by version desc limit 1;

  if v_action = 'approve' then
    if v_event.risk_level = 'C' then
      raise exception 'high_risk_manual_review_required' using errcode = '22023';
    end if;
    v_result := public.ai_news_publish_event(p_event_id, 'manual', v_admin);

  elsif v_action = 'edit_approve' then
    if v_event.risk_level = 'C' then
      raise exception 'high_risk_manual_review_required' using errcode = '22023';
    end if;

    if v_draft.id is null then
      raise exception 'draft_missing' using errcode = '22023';
    end if;

    v_version := v_draft.version + 1;
    update public.ai_news_drafts set is_current = false where event_id = p_event_id;

    insert into public.ai_news_drafts (
      event_id, version, is_current, title, spot, body, social_copy,
      category_slug, district, event_date, seo_title, seo_description,
      quality_score, plagiarism_score, risk_level, status, ai_model, ai_generated, word_count
    ) values (
      p_event_id, v_version, true,
      left(coalesce(nullif(p_payload ->> 'title', ''), v_draft.title), 180),
      left(coalesce(nullif(p_payload ->> 'spot', ''), v_draft.spot), 400),
      coalesce(nullif(p_payload ->> 'body', ''), v_draft.body),
      left(coalesce(nullif(p_payload ->> 'social_copy', ''), v_draft.social_copy), 500),
      coalesce(nullif(p_payload ->> 'category_slug', ''), v_draft.category_slug, v_event.category_slug, 'diger'),
      coalesce(nullif(p_payload ->> 'district', ''), v_draft.district, v_event.district),
      coalesce(nullif(p_payload ->> 'event_date', '')::date, v_draft.event_date, v_event.event_date),
      left(coalesce(nullif(p_payload ->> 'seo_title', ''), v_draft.seo_title), 70),
      left(coalesce(nullif(p_payload ->> 'seo_description', ''), v_draft.seo_description), 180),
      v_draft.quality_score, v_draft.plagiarism_score, v_draft.risk_level, 'approved',
      v_draft.ai_model, true,
      coalesce(array_length(regexp_split_to_array(
        coalesce(nullif(p_payload ->> 'body', ''), v_draft.body), '\s+'), 1), v_draft.word_count)
    )
    returning id into v_draft_id;

    update public.ai_news_events
       set category_slug = coalesce(nullif(p_payload ->> 'category_slug', ''), category_slug)
     where id = p_event_id;

    v_result := public.ai_news_publish_event(p_event_id, 'manual', v_admin);

  elsif v_action = 'reject' then
    perform public.ai_news_event_set_status(p_event_id, 'rejected');
    update public.ai_news_review_queue
       set state = 'rejected', notes = v_reason, resolved_at = now(), resolved_by = v_admin
     where event_id = p_event_id;
    update public.ai_news_drafts
       set status = 'rejected'
     where event_id = p_event_id and is_current;
    update public.ai_news_media_assets
       set status = 'rejected', removal_reason = v_reason
     where event_id = p_event_id and status = 'approved';
    v_result := jsonb_build_object('rejected', true);

  elsif v_action = 'defer' then
    update public.ai_news_review_queue
       set state = 'deferred', notes = coalesce(v_reason, notes), resolved_at = now(), resolved_by = v_admin
     where event_id = p_event_id;
    v_result := jsonb_build_object('deferred', true);

  elsif v_action = 'archive' then
    update public.ai_news_review_queue
       set state = 'archived', notes = v_reason, resolved_at = now(), resolved_by = v_admin
     where event_id = p_event_id;
    if v_event.status not in ('published', 'retracted') then
      perform public.ai_news_event_set_status(p_event_id, 'awaiting_review');
    end if;
    v_result := jsonb_build_object('archived', true);

  elsif v_action = 'retract' then
    v_result := public.admin_ai_news_retract(p_event_id, v_reason);

  elsif v_action = 'remove_media' then
    update public.ai_news_media_assets
       set status = 'rejected',
           removed_at = now(),
           removal_reason = coalesce(v_reason, 'admin_removed')
     where event_id = p_event_id and status in ('approved', 'published');
    if v_event.status not in ('published', 'retracted') then
      perform public.ai_news_event_set_status(p_event_id, 'awaiting_review');
    end if;
    v_result := jsonb_build_object('media_removed', true);

  elsif v_action = 'move_category' then
    if nullif(p_payload ->> 'category_slug', '') is null then
      raise exception 'category_required' using errcode = '22023';
    end if;
    update public.ai_news_events
       set category_slug = p_payload ->> 'category_slug'
     where id = p_event_id;
    update public.ai_news_drafts
       set category_slug = p_payload ->> 'category_slug'
     where event_id = p_event_id and is_current;
    v_result := jsonb_build_object('category_slug', p_payload ->> 'category_slug');

  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    v_admin, 'news.review.' || v_action, 'ai_news_event', p_event_id::text,
    jsonb_build_object(
      'reason', v_reason,
      'payload', coalesce(p_payload, '{}'::jsonb),
      'result', v_result
    )
  );

  perform public.tz_admin_audit(
    'news.review.' || v_action,
    'AI haber inceleme işlemi: ' || v_action,
    'ai_news_event', p_event_id::text,
    jsonb_build_object('reason', v_reason, 'result', v_result),
    'success'
  );

  return jsonb_build_object('ok', true, 'action', v_action, 'result', v_result);
end;
$$;

create or replace function public.admin_ai_news_retract(
  p_event_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_publication public.ai_news_publications%rowtype;
begin
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_publication from public.ai_news_publications
  where event_id = p_event_id
  for update;

  if not found then
    raise exception 'publication_not_found' using errcode = 'P0002';
  end if;

  update public.ai_news_publications
     set status = 'retracted', retracted_at = now(), retract_reason = v_reason
   where id = v_publication.id;

  update public.posts
     set moderation_status = 'removed'
   where id = v_publication.post_id;

  update public.ai_news_events
     set status = 'retracted', retracted_at = now()
   where id = p_event_id;

  insert into public.ai_news_publication_history (publication_id, action, actor_id, details)
  values (v_publication.id, 'retracted', v_admin, jsonb_build_object('reason', v_reason));

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_admin, 'news.retract', 'ai_news_event', p_event_id::text,
          jsonb_build_object('reason', v_reason, 'post_id', v_publication.post_id));

  perform public.tz_admin_audit(
    'news.retract', 'AI haber yayından kaldırıldı', 'ai_news_event', p_event_id::text,
    jsonb_build_object('reason', v_reason, 'post_id', v_publication.post_id), 'success'
  );

  return jsonb_build_object('retracted', true, 'post_id', v_publication.post_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 19. Yönetici: kaynak, konu, lisans, maliyet, hata
-- ---------------------------------------------------------------------------
create or replace function public.admin_ai_news_sources_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'domain', s.domain::text, 'kind', s.kind,
        'feed_url', s.feed_url, 'feed_kind', s.feed_kind,
        'media_license_code', s.media_license_code,
        'license_reference', s.license_reference,
        'attribution_text', s.attribution_text,
        'reliability', s.reliability, 'active', s.active,
        'notes_tr', s.notes_tr, 'last_checked_at', s.last_checked_at,
        'last_error', s.last_error
      ) order by s.kind, s.name)
      from public.ai_news_sources s
    ), '[]'::jsonb),
    'licenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', l.code, 'name_tr', l.name_tr,
        'commercial_use', l.commercial_use,
        'derivatives_allowed', l.derivatives_allowed,
        'attribution_required', l.attribution_required,
        'requires_documentation', l.requires_documentation,
        'is_usable', l.is_usable, 'license_url', l.license_url,
        'notes_tr', l.notes_tr
      ) order by l.code)
      from public.ai_news_media_licenses l
    ), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'query', t.query, 'kind', t.kind, 'priority', t.priority,
        'active', t.active, 'uses', t.uses, 'hits', t.hits,
        'last_used_at', t.last_used_at
      ) order by t.priority desc, t.query)
      from public.ai_news_search_topics t
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_ai_news_source_save(
  p_id uuid,
  p_payload jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_domain extensions.citext := lower(btrim(coalesce(p_payload ->> 'domain', '')));
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_kind text := coalesce(nullif(p_payload ->> 'kind', ''), 'unknown');
  v_license text := nullif(p_payload ->> 'media_license_code', '');
  v_id uuid;
begin
  if v_name = '' or v_name is null then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if v_domain = '' or v_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'invalid_domain' using errcode = '22023';
  end if;
  if v_kind not in ('official', 'trusted_media', 'unknown', 'low_trust') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if v_license is not null and not exists (
    select 1 from public.ai_news_media_licenses where code = v_license
  ) then
    raise exception 'license_not_found' using errcode = '22023';
  end if;

  insert into public.ai_news_sources (
    name, domain, kind, feed_url, feed_kind, media_license_code, license_reference,
    attribution_text, reliability, active, notes_tr
  ) values (
    left(v_name, 160), v_domain, v_kind,
    nullif(p_payload ->> 'feed_url', ''),
    coalesce(nullif(p_payload ->> 'feed_kind', ''), 'none'),
    v_license,
    nullif(p_payload ->> 'license_reference', ''),
    nullif(p_payload ->> 'attribution_text', ''),
    least(greatest(coalesce((p_payload ->> 'reliability')::numeric, 0.5), 0), 1),
    coalesce((p_payload ->> 'active')::boolean, true),
    left(nullif(p_payload ->> 'notes_tr', ''), 600)
  )
  on conflict (domain) do update
    set name = excluded.name,
        kind = excluded.kind,
        feed_url = excluded.feed_url,
        feed_kind = excluded.feed_kind,
        media_license_code = excluded.media_license_code,
        license_reference = excluded.license_reference,
        attribution_text = excluded.attribution_text,
        reliability = excluded.reliability,
        active = excluded.active,
        notes_tr = excluded.notes_tr,
        updated_at = now()
  returning id into v_id;

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_admin, 'news.source.save', 'ai_news_source', v_id::text,
          jsonb_build_object('domain', v_domain, 'kind', v_kind,
                             'reason', left(coalesce(p_reason, ''), 300)));

  return jsonb_build_object('id', v_id, 'domain', v_domain);
end;
$$;

create or replace function public.admin_ai_news_source_toggle(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_domain text;
begin
  update public.ai_news_sources
     set active = coalesce(p_active, not active), updated_at = now()
   where id = p_id
  returning domain::text into v_domain;

  if v_domain is null then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_admin, 'news.source.toggle', 'ai_news_source', p_id::text,
          jsonb_build_object('domain', v_domain, 'active', p_active));

  return jsonb_build_object('ok', true, 'domain', v_domain);
end;
$$;

create or replace function public.admin_ai_news_license_save(
  p_code text,
  p_payload jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_code text := lower(btrim(coalesce(p_code, '')));
begin
  if v_code = '' or v_code !~ '^[a-z0-9_]{3,40}$' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;

  insert into public.ai_news_media_licenses (
    code, name_tr, commercial_use, derivatives_allowed, attribution_required,
    requires_documentation, is_usable, license_url, notes_tr
  ) values (
    v_code,
    left(coalesce(nullif(p_payload ->> 'name_tr', ''), v_code), 120),
    coalesce((p_payload ->> 'commercial_use')::boolean, false),
    coalesce((p_payload ->> 'derivatives_allowed')::boolean, false),
    coalesce((p_payload ->> 'attribution_required')::boolean, true),
    coalesce((p_payload ->> 'requires_documentation')::boolean, true),
    coalesce((p_payload ->> 'is_usable')::boolean, false),
    nullif(p_payload ->> 'license_url', ''),
    left(nullif(p_payload ->> 'notes_tr', ''), 600)
  )
  on conflict (code) do update
    set name_tr = excluded.name_tr,
        commercial_use = excluded.commercial_use,
        derivatives_allowed = excluded.derivatives_allowed,
        attribution_required = excluded.attribution_required,
        requires_documentation = excluded.requires_documentation,
        is_usable = excluded.is_usable,
        license_url = excluded.license_url,
        notes_tr = excluded.notes_tr;

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_admin, 'news.license.save', 'ai_news_license', v_code,
          jsonb_build_object('reason', left(coalesce(p_reason, ''), 300)));

  return jsonb_build_object('code', v_code);
end;
$$;

create or replace function public.admin_ai_news_topic_save(
  p_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_query text := btrim(coalesce(p_payload ->> 'query', ''));
  v_kind text := coalesce(nullif(p_payload ->> 'kind', ''), 'general');
  v_id uuid;
begin
  if char_length(v_query) < 4 or char_length(v_query) > 128 then
    raise exception 'invalid_query' using errcode = '22023';
  end if;
  if v_kind not in ('general', 'district', 'category', 'sport', 'official') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  if p_id is not null then
    update public.ai_news_search_topics
       set query = v_query,
           kind = v_kind,
           priority = least(greatest(coalesce((p_payload ->> 'priority')::integer, 50), 0), 100),
           active = coalesce((p_payload ->> 'active')::boolean, active)
     where id = p_id
    returning id into v_id;
  else
    insert into public.ai_news_search_topics (query, kind, priority, active)
    values (v_query, v_kind, least(greatest(coalesce((p_payload ->> 'priority')::integer, 50), 0), 100),
            coalesce((p_payload ->> 'active')::boolean, true))
    on conflict (query) do update
      set kind = excluded.kind, priority = excluded.priority, active = excluded.active
    returning id into v_id;
  end if;

  if v_id is null then
    raise exception 'topic_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_ai_news_topic_toggle(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
begin
  update public.ai_news_search_topics
     set active = coalesce(p_active, not active)
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_ai_news_errors_list(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'run_id', e.run_id, 'stage', e.stage, 'code', e.code,
        'message', e.message, 'detail', e.detail, 'created_at', e.created_at
      ) order by e.created_at desc)
      from (
        select * from public.ai_news_errors order by created_at desc limit v_limit
      ) e
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_ai_news_cost_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_day_start timestamptz := (public.ai_news_istanbul_day(now())::timestamp at time zone 'Europe/Istanbul');
  v_month_start timestamptz := (date_trunc('month', public.ai_news_istanbul_day(now()))::timestamp
                                at time zone 'Europe/Istanbul');
  v_published_month integer;
begin
  select count(*) into v_published_month
  from public.ai_news_publications
  where published_at >= v_month_start;

  return jsonb_build_object(
    'today', jsonb_build_object(
      'cost_usd', round(coalesce((select sum(cost_usd) from public.ai_news_cost_logs where created_at >= v_day_start), 0), 6),
      'search_calls', (select coalesce(sum(calls), 0) from public.ai_news_cost_logs where kind = 'search' and created_at >= v_day_start),
      'fetch_calls', (select coalesce(sum(calls), 0) from public.ai_news_cost_logs where kind = 'fetch' and created_at >= v_day_start),
      'model_calls', (select coalesce(sum(calls), 0) from public.ai_news_cost_logs where kind = 'model' and created_at >= v_day_start),
      'tokens_in', (select coalesce(sum(tokens_in), 0) from public.ai_news_cost_logs where kind = 'model' and created_at >= v_day_start),
      'tokens_out', (select coalesce(sum(tokens_out), 0) from public.ai_news_cost_logs where kind = 'model' and created_at >= v_day_start)
    ),
    'month', jsonb_build_object(
      'cost_usd', round(coalesce((select sum(cost_usd) from public.ai_news_cost_logs where created_at >= v_month_start), 0), 6),
      'search_calls', (select coalesce(sum(calls), 0) from public.ai_news_cost_logs where kind = 'search' and created_at >= v_month_start),
      'fetch_calls', (select coalesce(sum(calls), 0) from public.ai_news_cost_logs where kind = 'fetch' and created_at >= v_month_start),
      'model_calls', (select coalesce(sum(calls), 0) from public.ai_news_cost_logs where kind = 'model' and created_at >= v_month_start),
      'tokens_in', (select coalesce(sum(tokens_in), 0) from public.ai_news_cost_logs where kind = 'model' and created_at >= v_month_start),
      'tokens_out', (select coalesce(sum(tokens_out), 0) from public.ai_news_cost_logs where kind = 'model' and created_at >= v_month_start)
    ),
    'published_month', v_published_month,
    'cost_per_post_usd', case when v_published_month > 0 then round(
      coalesce((select sum(cost_usd) from public.ai_news_cost_logs where created_at >= v_month_start), 0)
      / v_published_month, 6) else null end,
    'budget', public.ai_news_budget_status(),
    'note', 'Maliyetler gerçek token/kullanım yanıtları ve ayarlardaki birim fiyatlarla hesaplanan tahminlerdir; fatura tutarı değildir.'
  );
end;
$$;

create or replace function public.admin_ai_news_diagnostics_save(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
begin
  update public.ai_news_settings
     set last_diagnostics = jsonb_build_object(
           'checked_at', now(),
           'models', coalesce(p_payload -> 'models', '[]'::jsonb),
           'chat_ok', coalesce((p_payload ->> 'chat_ok')::boolean, false),
           'search_ok', coalesce((p_payload ->> 'search_ok')::boolean, false),
           'fetch_ok', coalesce((p_payload ->> 'fetch_ok')::boolean, false),
           'balance', p_payload -> 'balance',
           'search_error', left(coalesce(p_payload ->> 'search_error', ''), 300),
           'fetch_error', left(coalesce(p_payload ->> 'fetch_error', ''), 300),
           'chat_error', left(coalesce(p_payload ->> 'chat_error', ''), 300)
         ),
         updated_at = now()
   where id;
end;
$$;

create or replace function public.admin_ai_news_ai_check()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('news.manage', false);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 20. Yayıncı hesabı bağlama
-- ---------------------------------------------------------------------------
create or replace function public.admin_ai_news_publisher_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'username', p.username::text,
        'display_name', p.display_name,
        'is_verified', p.is_verified,
        'avatar_path', p.avatar_path,
        'followers_count', p.followers_count
      ) order by p.is_verified desc, p.followers_count desc)
      from (
        select * from public.profiles
        where account_status = 'active'
          and (is_verified or username::text in ('trabzone', 'trabzonehaber'))
        order by is_verified desc, followers_count desc
        limit 50
      ) p
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_ai_news_bind_publisher(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_username extensions.citext := lower(btrim(coalesce(p_username, '')));
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where username = v_username;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if v_profile.account_status <> 'active' then
    raise exception 'publisher_inactive' using errcode = '22023';
  end if;

  update public.ai_news_settings
     set publisher_user_id = v_profile.id,
         publisher_username = v_profile.username,
         updated_at = now()
   where id;

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_admin, 'news.publisher.bind', 'profile', v_profile.id::text,
          jsonb_build_object('username', v_profile.username::text));

  return jsonb_build_object(
    'id', v_profile.id,
    'username', v_profile.username::text,
    'display_name', v_profile.display_name,
    'is_verified', v_profile.is_verified
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 21. Zamanlayıcı (pg_cron + pg_net)
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_worker_token_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
  from vault.decrypted_secrets
  where name = 'ai_news_cron_secret';

  if v_expected is null or coalesce(p_token, '') = '' then
    return false;
  end if;

  return encode(digest(p_token, 'sha256'), 'hex') = encode(digest(v_expected, 'sha256'), 'hex');
end;
$$;

create or replace function public.ai_news_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_token text;
  v_response bigint;
begin
  select * into v_settings from public.ai_news_settings where id;

  if v_settings.enabled is not true then
    return jsonb_build_object('queued', false, 'reason', 'disabled');
  end if;

  if v_settings.next_run_at > now() then
    return jsonb_build_object('queued', false, 'reason', 'not_due',
                              'next_run_at', v_settings.next_run_at);
  end if;

  if exists (
    select 1 from public.ai_news_runs r
    where r.status = 'running' and r.heartbeat_at > now() - interval '12 minutes'
  ) then
    return jsonb_build_object('queued', false, 'reason', 'busy');
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'ai_news_cron_secret';

  if v_token is null then
    return jsonb_build_object('queued', false, 'reason', 'secret_missing');
  end if;

  -- Aynı anda iki çağrı olmasın diye plan bir sonraki run'a ötelenir.
  update public.ai_news_settings
     set next_run_at = now() + make_interval(mins => v_settings.scan_interval_minutes),
         last_tick_at = now()
   where id;

  select net.http_post(
    url := rtrim(v_settings.worker_url, '/') || '/functions/v1/ai-news-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ai-news-token', v_token
    ),
    body := jsonb_build_object('action', 'run', 'trigger', 'cron'),
    timeout_milliseconds := 150000
  ) into v_response;

  return jsonb_build_object('queued', true, 'request_id', v_response);
end;
$$;

create or replace function public.admin_ai_news_run_now()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_result jsonb;
begin
  update public.ai_news_settings set next_run_at = now() where id;
  v_result := public.ai_news_tick();

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_admin, 'news.run.now', 'ai_news', 'run', v_result);

  return v_result;
end;
$$;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ai_news_cron_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'ai_news_cron_secret',
      'AI Haber Merkezi cron çağrı anahtarı'
    );
  end if;
end $$;

-- Dakikada bir due-check; gerçek periyot ayarlardan gelir (varsayılan 15 dk).
select cron.unschedule(jobid) from cron.job where jobname = 'ai-news-tick';
select cron.schedule(
  'ai-news-tick',
  '* * * * *',
  $cron$select public.ai_news_tick();$cron$
);

-- ---------------------------------------------------------------------------
-- 22. Yetkiler
-- ---------------------------------------------------------------------------
revoke all on function public.ai_news_istanbul_day(timestamptz) from public, anon, authenticated;
revoke all on function public.ai_news_normalize_url(text) from public, anon, authenticated;
revoke all on function public.ai_news_domain(text) from public, anon, authenticated;
revoke all on function public.ai_news_domain_kind(text) from public, anon, authenticated;
revoke all on function public.ai_news_title_fingerprint(text) from public, anon, authenticated;
revoke all on function public.ai_news_is_trabzon_text(text) from public, anon, authenticated;
revoke all on function public.ai_news_event_set_status(uuid, text) from public, anon, authenticated;
revoke all on function public.ai_news_quota_reserve(date, integer) from public, anon, authenticated;
revoke all on function public.ai_news_compose_body(text, text, text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.ai_news_notify_followers(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ai_news_public_post(uuid) from public;
revoke all on function public.ai_news_post_meta(uuid) from public, anon, authenticated;

grant execute on function public.ai_news_public_post(uuid) to anon, authenticated;
grant execute on function public.ai_news_post_meta(uuid) to service_role;
grant execute on function public.ai_news_sitemap_urls(integer, integer) to anon, authenticated;
grant execute on function public.ai_news_worker_token_ok(text) to anon, service_role;

-- Otomasyon (worker) fonksiyonları yalnızca service_role.
revoke all on function public.ai_news_run_begin(text) from public, anon, authenticated;
revoke all on function public.ai_news_run_heartbeat(uuid) from public, anon, authenticated;
revoke all on function public.ai_news_run_finish(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.ai_news_topic_mark(jsonb) from public, anon, authenticated;
revoke all on function public.ai_news_cost_log(uuid, text, text, integer, integer, integer, numeric, text)
  from public, anon, authenticated;
revoke all on function public.ai_news_log_error(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.ai_news_record_results(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.ai_news_candidates(uuid, integer) from public, anon, authenticated;
revoke all on function public.ai_news_result_mark(bigint, text, uuid, text) from public, anon, authenticated;
revoke all on function public.ai_news_event_upsert(jsonb) from public, anon, authenticated;
revoke all on function public.ai_news_evidence_add(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ai_news_verification_save(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ai_news_draft_save(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ai_news_media_save(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ai_news_publish_event(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.ai_news_finalize(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ai_news_quota_status() from public, anon, authenticated;
revoke all on function public.ai_news_budget_status() from public, anon, authenticated;
revoke all on function public.ai_news_tick() from public, anon, authenticated;

grant execute on function public.ai_news_run_begin(text) to service_role;
grant execute on function public.ai_news_run_heartbeat(uuid) to service_role;
grant execute on function public.ai_news_run_finish(uuid, jsonb, text) to service_role;
grant execute on function public.ai_news_topic_mark(jsonb) to service_role;
grant execute on function public.ai_news_cost_log(uuid, text, text, integer, integer, integer, numeric, text) to service_role;
grant execute on function public.ai_news_log_error(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.ai_news_record_results(uuid, text, jsonb, text) to service_role;
grant execute on function public.ai_news_candidates(uuid, integer) to service_role;
grant execute on function public.ai_news_result_mark(bigint, text, uuid, text) to service_role;
grant execute on function public.ai_news_event_upsert(jsonb) to service_role;
grant execute on function public.ai_news_evidence_add(uuid, jsonb) to service_role;
grant execute on function public.ai_news_verification_save(uuid, jsonb) to service_role;
grant execute on function public.ai_news_draft_save(uuid, jsonb) to service_role;
grant execute on function public.ai_news_media_save(uuid, jsonb) to service_role;
grant execute on function public.ai_news_publish_event(uuid, text, uuid) to service_role;
grant execute on function public.ai_news_finalize(uuid, uuid) to service_role;
grant execute on function public.ai_news_quota_status() to service_role;
grant execute on function public.ai_news_budget_status() to service_role;
grant execute on function public.ai_news_tick() to service_role;

-- Yönetici fonksiyonları authenticated (içeride tz_admin_require var).
grant execute on function public.admin_ai_news_overview() to authenticated;
grant execute on function public.admin_ai_news_runs_list(integer) to authenticated;
grant execute on function public.admin_ai_news_settings_get() to authenticated;
grant execute on function public.admin_ai_news_settings_save(jsonb, text) to authenticated;
grant execute on function public.admin_ai_news_review_list(text, integer, integer) to authenticated;
grant execute on function public.admin_ai_news_review_get(uuid) to authenticated;
grant execute on function public.admin_ai_news_review_action(uuid, text, jsonb, text) to authenticated;
grant execute on function public.admin_ai_news_retract(uuid, text) to authenticated;
grant execute on function public.admin_ai_news_sources_list() to authenticated;
grant execute on function public.admin_ai_news_source_save(uuid, jsonb, text) to authenticated;
grant execute on function public.admin_ai_news_source_toggle(uuid, boolean) to authenticated;
grant execute on function public.admin_ai_news_license_save(text, jsonb, text) to authenticated;
grant execute on function public.admin_ai_news_topic_save(uuid, jsonb) to authenticated;
grant execute on function public.admin_ai_news_topic_toggle(uuid, boolean) to authenticated;
grant execute on function public.admin_ai_news_errors_list(integer) to authenticated;
grant execute on function public.admin_ai_news_cost_summary() to authenticated;
grant execute on function public.admin_ai_news_diagnostics_save(jsonb) to authenticated;
grant execute on function public.admin_ai_news_ai_check() to authenticated;
grant execute on function public.admin_ai_news_publisher_candidates() to authenticated;
grant execute on function public.admin_ai_news_bind_publisher(text) to authenticated;
grant execute on function public.admin_ai_news_run_now() to authenticated;

commit;

