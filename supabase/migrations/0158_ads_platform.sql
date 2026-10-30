-- ---------------------------------------------------------------------------
-- 0158 — Trabzone Premium Reklam Merkezi
--
-- Tasarım ilkeleri
--   1. Reklam görünürlüğü tamamen sunucu kararıdır. Global anahtar, yerleşim
--      anahtarı, kampanya durumu ve yayın takvimi bu migration'daki
--      fonksiyonlarda, sunucu saatiyle denetlenir. İstemci saatine güvenilmez.
--   2. Bütün yerleşimler ve global anahtar varsayılan olarak KAPALIDIR.
--   3. Gösterim/tıklama yalnızca sunucunun ürettiği `ad_serves` kaydı
--      üzerinden sayılır; aynı kayıt bir kez gösterim, bir kez tıklama üretir.
--      Hız limiti ve zaman kontrolleri sahte olayları `ad_invalid_events`
--      tablosuna ayırır.
--   4. Limitler (günlük/toplam gösterim, bütçe) kampanya satırı kilitlenerek
--      atomik uygulanır.
--   5. Denetim kayıtları mevcut `admin_audit_logs` tablosuna (`ads.*`
--      eylem kodları) yazılır; ayrı bir audit tablosu açılmaz.
--   6. Kaynaklar ayrıdır: TRABZONE_DIRECT gerçek sistemdir, GOOGLE_ADMOB
--      yalnızca yapılandırma ve fallback sözleşmesi olarak hazırdır.
-- ---------------------------------------------------------------------------

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. İzin kataloğu
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr) values
  ('ads.view',     'Reklam kampanyaları, yerleşimler ve reklam analitiğini görüntüleme'),
  ('ads.manage',   'Reklamveren, kampanya, medya ve yerleşim yönetimi'),
  ('ads.approve',  'Reklam kampanyalarını inceleme, onaylama ve reddetme'),
  ('ads.settings', 'Global reklam anahtarı, sağlayıcı ve güvenli sınır ayarları')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'ads.view'), ('admin', 'ads.manage'), ('admin', 'ads.approve'), ('admin', 'ads.settings'),
  ('market_manager', 'ads.view'), ('market_manager', 'ads.manage'),
  ('moderator', 'ads.view'),
  ('analyst', 'ads.view'),
  ('finance_officer', 'ads.view')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Yardımcılar
-- ---------------------------------------------------------------------------
create or replace function public.ad_fold(p text)
returns text
language sql
immutable
as $$
  select nullif(btrim(lower(translate(coalesce(p, ''),
    'ÇĞİIÖŞÜçğıöşüÂâÎîÛû', 'CGIIOSUcgiosuaaiiuu'))), '')
$$;

create or replace function public.ad_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Europe/Istanbul')::date $$;

create or replace function public.ad_is_uuid(p text)
returns boolean
language sql
immutable
as $$
  select coalesce(p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
$$;

-- ---------------------------------------------------------------------------
-- 3. Ayarlar (tek satır) ve güvenli sınırlar
-- ---------------------------------------------------------------------------
create table if not exists public.ad_settings (
  id                               smallint primary key default 1 check (id = 1),
  ads_enabled                      boolean not null default false,
  direct_enabled                   boolean not null default true,
  admob_enabled                    boolean not null default false,
  admob_config                     jsonb not null default '{}'::jsonb,
  external_domain_allowlist        text[] not null default '{}',
  hide_duration_days               integer not null default 30,
  click_rate_limit_per_minute      integer not null default 12,
  impression_rate_limit_per_minute integer not null default 90,
  min_view_ms                      integer not null default 1000,
  min_visible_ratio                numeric(3,2) not null default 0.50,
  serve_ttl_minutes                integer not null default 45,
  auto_pause_report_threshold      integer not null default 5,
  policy_text                      text,
  updated_by                       uuid,
  updated_at                       timestamptz not null default now()
);

insert into public.ad_settings (id, policy_text) values (1,
  'Kabul edilmeyen reklamlar: kumar ve bahis, yasa dışı ürün ve hizmetler, yanıltıcı sağlık iddiaları, '
  || 'dolandırıcılık ve sahte kazanç vaatleri, yetişkin içerik, silah, tütün ve alkol, uyuşturucu. '
  || 'Sağlık ve finans kampanyaları ek inceleme notu ile onaylanır. Reklam ile organik içerik ayırt '
  || 'edilemez hale getirilemez; her reklam "Reklam" etiketiyle yayınlanır.')
on conflict (id) do nothing;

create table if not exists public.ad_delivery_rules (
  key            text primary key,
  label_tr       text not null,
  description_tr text,
  min_value      integer not null,
  max_value      integer not null,
  default_value  integer not null,
  hard_min       integer not null,
  hard_max       integer not null,
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  check (hard_min <= min_value and min_value <= default_value and default_value <= max_value and max_value <= hard_max)
);

insert into public.ad_delivery_rules (key, label_tr, description_tr, min_value, max_value, default_value, hard_min, hard_max) values
  ('first_after',           'İlk reklam konumu',              'İlk reklamdan önce gösterilecek en az organik içerik', 5, 50, 5, 3, 100),
  ('interval_min',          'En kısa reklam aralığı',         'İki reklam arasındaki en az organik içerik',          8, 60, 8, 4, 100),
  ('interval_max',          'En uzun reklam aralığı',         'İki reklam arasındaki en fazla organik içerik',        8, 80, 12, 4, 150),
  ('max_per_session',       'Oturum başı en fazla reklam',    'Bir oturumda bu yerleşimde en fazla reklam',           0, 12, 4, 0, 30),
  ('max_daily_per_user',    'Kullanıcı başı günlük gösterim', 'Bir kullanıcıya bu yerleşimde günlük en fazla gösterim', 0, 40, 12, 0, 100),
  ('campaign_repeat_limit', 'Tek kampanya tekrar sınırı',     'Aynı kampanyanın bir oturumda en fazla gösterimi',      1, 5, 2, 1, 10),
  ('per_user_daily_cap',    'Kampanya kullanıcı günlük sınırı','Aynı kampanyanın bir kullanıcıya günlük gösterimi',  1, 10, 3, 1, 20)
on conflict (key) do nothing;

create or replace function public.ad_rule_clamp(p_key text, p_value integer)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select greatest(r.min_value, least(r.max_value, coalesce(p_value, r.default_value)))
     from public.ad_delivery_rules r where r.key = p_key),
    p_value)
$$;

-- ---------------------------------------------------------------------------
-- 4. Yerleşimler
-- ---------------------------------------------------------------------------
create table if not exists public.ad_placements (
  key                   text primary key check (key ~ '^[a-z0-9_]{3,48}$'),
  label_tr              text not null,
  description_tr        text,
  group_key             text not null default 'social',
  surface_status        text not null default 'reserved' check (surface_status in ('live', 'reserved')),
  surface_note          text,
  format                text not null default 'glass_banner'
                        check (format in ('glass_banner', 'reel_fullscreen', 'native_card')),
  supported_formats     text[] not null default '{glass_banner}',
  enabled               boolean not null default false,
  first_after           integer not null default 5,
  interval_min          integer not null default 8,
  interval_max          integer not null default 12,
  max_per_session       integer not null default 4,
  max_daily_per_user    integer not null default 12,
  campaign_repeat_limit integer not null default 2,
  platforms             text[] not null default '{ios,android,web}',
  min_priority          smallint not null default 1 check (min_priority between 1 and 10),
  active_from           timestamptz,
  active_until          timestamptz,
  allow_admob_fallback  boolean not null default false,
  sort_order            integer not null default 100,
  updated_by            uuid,
  updated_at            timestamptz not null default now()
);

insert into public.ad_placements (key, label_tr, description_tr, group_key, surface_status, surface_note, format, supported_formats, sort_order) values
  ('feed_home',            'Ana sosyal akış',               'Tümü sekmesindeki gönderiler arası',             'social',      'live', null, 'glass_banner', '{glass_banner}', 10),
  ('feed_following',       'Takip edilenler akışı',         'Takip sekmesindeki gönderiler arası',            'social',      'live', null, 'glass_banner', '{glass_banner}', 20),
  ('feed_nearby',          'Yakınımdaki gönderiler',        'Yakınımda sekmesindeki gönderiler arası',        'social',      'live', null, 'glass_banner', '{glass_banner}', 30),
  ('feed_popular',         'Popüler gönderiler',            'Popüler sekmesindeki gönderiler arası',          'social',      'live', null, 'glass_banner', '{glass_banner}', 40),
  ('news_feed',            'Haber akışı',                   'Haber gönderileri ana akışta yer alır',          'news',        'reserved', 'Uygulamada ayrı bir haber listesi yok; haberler ana akış yerleşimini kullanır.', 'glass_banner', '{glass_banner}', 50),
  ('news_district',        'İlçe haberleri',                'İlçe bazlı haber listesi',                       'news',        'reserved', 'Uygulamada ayrı bir ilçe haber listesi yok.', 'glass_banner', '{glass_banner}', 60),
  ('marketplace_home',     'Marketplace ana akışı',         'Pazar ana sayfasındaki bölümler arası',          'marketplace', 'live', null, 'glass_banner', '{glass_banner}', 70),
  ('marketplace_category', 'Marketplace kategori listeleri','Kategori ilan listesinde ilanlar arası',         'marketplace', 'live', null, 'glass_banner', '{glass_banner}', 80),
  ('real_estate_list',     'Emlak ilan listesi',            'Emlak arama sonuçları ve emlak kataloğu',        'marketplace', 'live', null, 'glass_banner', '{glass_banner}', 90),
  ('vehicle_list',         'Araç ilan listesi',             'Araç kategorisi ilan listesi',                   'marketplace', 'live', null, 'glass_banner', '{glass_banner}', 100),
  ('job_list',             'İş ilanları listesi',           'İş ilanları kategorisi listesi',                 'marketplace', 'live', null, 'glass_banner', '{glass_banner}', 110),
  ('business_explore',     'İşletme keşfet listesi',        'İşletmeler listesinde işletmeler arası',         'discover',    'live', null, 'glass_banner', '{glass_banner}', 120),
  ('ride_list',            'Yolculuk paylaşımı listesi',    'Yolculuk arama sonuçları arası',                 'discover',    'live', null, 'glass_banner', '{glass_banner}', 130),
  ('live_news_feed',       'Anlık gelişmeler akışı',        'Anlık gelişmeler yatay şeridi',                  'news',        'reserved', 'Anlık gelişmeler yalnızca yatay şerit olarak gösteriliyor; yatay banner bu formata uygun değil.', 'glass_banner', '{glass_banner,native_card}', 140),
  ('reels_feed',           'Reels akışı',                   'Tam ekran dikey video akışı',                    'social',      'reserved', 'Reels için video üzerine banner yerleştirilmez; ayrı tam ekran sponsorlu kart formatı ileride etkinleştirilecek.', 'reel_fullscreen', '{reel_fullscreen}', 150),
  ('profile_posts',        'Kullanıcı profil gönderi akışı','Profil gönderi ızgarasında satırlar arası',     'social',      'live', null, 'glass_banner', '{glass_banner}', 160),
  ('future_default',       'Diğer gelecekteki akışlar',     'Yeni akışlar için varsayılan şablon',            'other',       'reserved', 'Yeni bir akış eklendiğinde bu şablonun ayarları başlangıç değeri olur.', 'glass_banner', '{glass_banner}', 999)
on conflict (key) do update set
  label_tr = excluded.label_tr,
  description_tr = excluded.description_tr,
  group_key = excluded.group_key,
  surface_status = excluded.surface_status,
  surface_note = excluded.surface_note,
  supported_formats = excluded.supported_formats,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 5. Reklamverenler
-- ---------------------------------------------------------------------------
create table if not exists public.ad_advertisers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 2 and 120),
  legal_name     text,
  tax_number     text,
  contact_name   text,
  contact_email  text,
  contact_phone  text,
  website        text,
  place_id       uuid references public.places(id) on delete set null,
  status         text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  notes          text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.ad_advertiser_members (
  advertiser_id uuid not null references public.ad_advertisers(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'viewer' check (role in ('viewer', 'manager')),
  created_at    timestamptz not null default now(),
  primary key (advertiser_id, user_id)
);
create index if not exists ad_advertiser_members_user_idx on public.ad_advertiser_members(user_id);

create or replace function public.ad_is_advertiser_member(p_advertiser_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.ad_advertiser_members m
    where m.advertiser_id = p_advertiser_id and m.user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- 6. Kampanyalar, kreatifler, hedefler, detay sayfaları
-- ---------------------------------------------------------------------------
create table if not exists public.ad_campaigns (
  id                   uuid primary key default gen_random_uuid(),
  advertiser_id        uuid not null references public.ad_advertisers(id) on delete restrict,
  name                 text not null check (length(btrim(name)) between 2 and 120),
  campaign_type        text not null default 'business_promo' check (campaign_type in (
                         'business_promo', 'listing_promo', 'event', 'real_estate', 'vehicle', 'job',
                         'service', 'brand', 'public_service', 'other')),
  policy_category      text not null default 'general',
  source               text not null default 'trabzone_direct' check (source in ('trabzone_direct', 'google_admob')),
  status               text not null default 'draft' check (status in (
                         'draft', 'pending_review', 'scheduled', 'active', 'paused', 'expired', 'rejected', 'archived')),
  priority             smallint not null default 5 check (priority between 1 and 10),
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  daily_impression_cap integer check (daily_impression_cap is null or daily_impression_cap > 0),
  total_impression_cap integer check (total_impression_cap is null or total_impression_cap > 0),
  per_user_daily_cap   integer not null default 3,
  budget_cents         bigint check (budget_cents is null or budget_cents >= 0),
  cpm_cents            integer check (cpm_cents is null or cpm_cents >= 0),
  spent_cents          numeric(16,3) not null default 0,
  currency             text not null default 'TRY',
  target_districts     text[] not null default '{}',
  platforms            text[] not null default '{ios,android,web}',
  impressions_total    bigint not null default 0,
  clicks_total         bigint not null default 0,
  review_note          text,
  rejection_reason     text,
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  submitted_at         timestamptz,
  paused_at            timestamptz,
  status_changed_at    timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists ad_campaigns_status_idx on public.ad_campaigns(status, starts_at, ends_at);
create index if not exists ad_campaigns_advertiser_idx on public.ad_campaigns(advertiser_id);

create table if not exists public.ad_creatives (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null unique references public.ad_campaigns(id) on delete cascade,
  title            text not null default '',
  description      text,
  cta_label        text not null default 'İncele',
  business_name    text,
  image_url        text,
  mobile_image_url text,
  web_image_url    text,
  video_url        text,
  image_focus      text not null default 'center' check (image_focus in ('left', 'center', 'right')),
  updated_at       timestamptz not null default now()
);

create table if not exists public.ad_target_destinations (
  campaign_id    uuid primary key references public.ad_campaigns(id) on delete cascade,
  type           text not null check (type in (
                   'detail_page', 'business', 'market_listing', 'real_estate', 'vehicle', 'job', 'ride',
                   'post', 'category', 'external_url', 'phone', 'map_location')),
  target_id      text,
  url            text,
  phone          text,
  lat            double precision,
  lng            double precision,
  label          text,
  is_valid       boolean not null default true,
  invalid_reason text,
  checked_at     timestamptz
);

create table if not exists public.ad_detail_pages (
  campaign_id  uuid primary key references public.ad_campaigns(id) on delete cascade,
  enabled      boolean not null default true,
  headline     text,
  cover_url    text,
  gallery      text[] not null default '{}',
  video_url    text,
  body         text,
  features     text[] not null default '{}',
  price_text   text,
  offer_text   text,
  address      text,
  lat          double precision,
  lng          double precision,
  phone        text,
  email        text,
  website      text,
  valid_until  timestamptz,
  place_id     uuid references public.places(id) on delete set null,
  listing_type text check (listing_type in ('market_listing', 'real_estate')),
  listing_id   uuid,
  updated_at   timestamptz not null default now()
);

create table if not exists public.ad_campaign_placements (
  campaign_id   uuid not null references public.ad_campaigns(id) on delete cascade,
  placement_key text not null references public.ad_placements(key) on update cascade on delete cascade,
  primary key (campaign_id, placement_key)
);
create index if not exists ad_campaign_placements_key_idx on public.ad_campaign_placements(placement_key);

create table if not exists public.ad_media_assets (
  id           uuid primary key default gen_random_uuid(),
  url          text not null,
  storage_path text,
  media_type   text not null default 'image' check (media_type in ('image', 'video')),
  variant      text not null default 'banner' check (variant in ('banner', 'mobile', 'web', 'cover', 'gallery', 'video')),
  width        integer,
  height       integer,
  size_bytes   bigint,
  label        text,
  uploaded_by  uuid,
  created_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create index if not exists ad_media_assets_created_idx on public.ad_media_assets(created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Teslimat defteri ve olaylar
-- ---------------------------------------------------------------------------
create table if not exists public.ad_serves (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.ad_campaigns(id) on delete cascade,
  placement_key text not null,
  source        text not null default 'trabzone_direct',
  user_id       uuid not null,
  session_id    text not null,
  platform      text not null,
  district      text,
  served_at     timestamptz not null default now(),
  impression_at timestamptz,
  clicked_at    timestamptz
);
create index if not exists ad_serves_user_time_idx on public.ad_serves(user_id, served_at desc);
create index if not exists ad_serves_session_idx on public.ad_serves(session_id, placement_key, campaign_id);
create index if not exists ad_serves_campaign_idx on public.ad_serves(campaign_id, served_at desc);

create table if not exists public.ad_impressions (
  id            bigserial primary key,
  serve_id      uuid not null unique references public.ad_serves(id) on delete cascade,
  campaign_id   uuid not null references public.ad_campaigns(id) on delete cascade,
  placement_key text not null,
  user_id       uuid not null,
  platform      text not null,
  district      text,
  day           date not null default public.ad_today(),
  cost_cents    numeric(12,3) not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists ad_impressions_campaign_day_idx on public.ad_impressions(campaign_id, day);
create index if not exists ad_impressions_user_day_idx on public.ad_impressions(user_id, day, campaign_id);
create index if not exists ad_impressions_user_time_idx on public.ad_impressions(user_id, created_at desc);
create index if not exists ad_impressions_placement_day_idx on public.ad_impressions(placement_key, day);

create table if not exists public.ad_clicks (
  id            bigserial primary key,
  serve_id      uuid not null unique references public.ad_serves(id) on delete cascade,
  campaign_id   uuid not null references public.ad_campaigns(id) on delete cascade,
  placement_key text not null,
  user_id       uuid not null,
  platform      text not null,
  district      text,
  day           date not null default public.ad_today(),
  created_at    timestamptz not null default now()
);
create index if not exists ad_clicks_campaign_day_idx on public.ad_clicks(campaign_id, day);
create index if not exists ad_clicks_user_time_idx on public.ad_clicks(user_id, created_at desc);

create table if not exists public.ad_campaign_daily_stats (
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  day         date not null,
  impressions integer not null default 0,
  clicks      integer not null default 0,
  spend_cents numeric(16,3) not null default 0,
  primary key (campaign_id, day)
);

create table if not exists public.ad_invalid_events (
  id          bigserial primary key,
  kind        text not null check (kind in ('impression', 'click', 'serve')),
  reason      text not null,
  user_id     uuid,
  serve_id    uuid,
  campaign_id uuid,
  created_at  timestamptz not null default now()
);
create index if not exists ad_invalid_events_campaign_idx on public.ad_invalid_events(campaign_id, created_at desc);
create index if not exists ad_invalid_events_user_idx on public.ad_invalid_events(user_id, created_at desc);

create table if not exists public.ad_user_feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  campaign_id  uuid not null references public.ad_campaigns(id) on delete cascade,
  kind         text not null check (kind in ('hide', 'report')),
  reason       text,
  details      text,
  hidden_until timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, campaign_id, kind)
);
create index if not exists ad_user_feedback_campaign_idx on public.ad_user_feedback(campaign_id, kind);

create table if not exists public.ad_advertiser_reports (
  id            uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.ad_advertisers(id) on delete cascade,
  campaign_id   uuid references public.ad_campaigns(id) on delete cascade,
  kind          text not null default 'manual' check (kind in ('manual', 'campaign_end')),
  period_start  timestamptz,
  period_end    timestamptz,
  metrics       jsonb not null default '{}'::jsonb,
  generated_by  uuid,
  generated_at  timestamptz not null default now()
);
create index if not exists ad_advertiser_reports_campaign_idx on public.ad_advertiser_reports(campaign_id, generated_at desc);

-- ---------------------------------------------------------------------------
-- 8. RLS: tablolar doğrudan yalnızca okunabilir (yönetici veya reklamveren
--    üyesi). Bütün yazma işlemleri SECURITY DEFINER RPC'ler üzerindendir.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ad_settings', 'ad_delivery_rules', 'ad_placements', 'ad_advertisers', 'ad_advertiser_members',
    'ad_campaigns', 'ad_creatives', 'ad_target_destinations', 'ad_detail_pages', 'ad_campaign_placements',
    'ad_media_assets', 'ad_serves', 'ad_impressions', 'ad_clicks', 'ad_campaign_daily_stats',
    'ad_invalid_events', 'ad_user_feedback', 'ad_advertiser_reports']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select on public.ad_advertisers, public.ad_campaigns, public.ad_creatives,
  public.ad_campaign_daily_stats, public.ad_advertiser_reports to authenticated;

drop policy if exists ad_advertisers_read on public.ad_advertisers;
create policy ad_advertisers_read on public.ad_advertisers for select to authenticated
  using (public.has_permission('ads.view') or public.ad_is_advertiser_member(id));

drop policy if exists ad_campaigns_read on public.ad_campaigns;
create policy ad_campaigns_read on public.ad_campaigns for select to authenticated
  using (public.has_permission('ads.view') or public.ad_is_advertiser_member(advertiser_id));

drop policy if exists ad_creatives_read on public.ad_creatives;
create policy ad_creatives_read on public.ad_creatives for select to authenticated
  using (exists (select 1 from public.ad_campaigns c where c.id = campaign_id
    and (public.has_permission('ads.view') or public.ad_is_advertiser_member(c.advertiser_id))));

drop policy if exists ad_daily_stats_read on public.ad_campaign_daily_stats;
create policy ad_daily_stats_read on public.ad_campaign_daily_stats for select to authenticated
  using (exists (select 1 from public.ad_campaigns c where c.id = campaign_id
    and (public.has_permission('ads.view') or public.ad_is_advertiser_member(c.advertiser_id))));

drop policy if exists ad_reports_read on public.ad_advertiser_reports;
create policy ad_reports_read on public.ad_advertiser_reports for select to authenticated
  using (public.has_permission('ads.view') or public.ad_is_advertiser_member(advertiser_id));

-- ---------------------------------------------------------------------------
-- 9. Politika ve doğrulama yardımcıları
-- ---------------------------------------------------------------------------
create or replace function public.ad_policy_category_ok(p text)
returns boolean
language sql
immutable
as $$
  select p in ('general', 'food', 'tourism', 'retail', 'real_estate', 'automotive', 'education',
               'health_service', 'finance', 'events', 'public_service', 'technology', 'jobs', 'services')
$$;

create or replace function public.ad_policy_prohibited(p text)
returns boolean
language sql
immutable
as $$
  select p in ('gambling', 'betting', 'illegal', 'misleading_health', 'scam', 'adult',
               'weapons', 'tobacco', 'alcohol', 'drugs')
$$;

create or replace function public.ad_media_url_ok(p text)
returns boolean
language sql
immutable
as $$
  select p is null or (length(p) <= 2048 and p ~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?(/[^\s<>"]*)?$')
$$;

create or replace function public.ad_url_check(p_url text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_host text;
  v_allow text[];
begin
  if p_url is null or length(p_url) > 2048 then
    return 'url_invalid';
  end if;
  if p_url !~* '^https://' then
    return 'url_scheme_invalid';
  end if;
  if p_url ~ '[\s<>"\\]' then
    return 'url_invalid';
  end if;
  if p_url ~* '^https://[^/?#]*@' then
    return 'url_credentials';
  end if;
  v_host := lower(substring(p_url from '^https://([^/?#:]+)'));
  if v_host is null or v_host !~ '^[a-z0-9.-]+\.[a-z]{2,}$' or v_host ~ '^[0-9.]+$'
     or v_host like '%.local' or v_host like '%.internal' or v_host like 'localhost%' then
    return 'url_host_invalid';
  end if;
  select external_domain_allowlist into v_allow from public.ad_settings where id = 1;
  if coalesce(cardinality(v_allow), 0) > 0 and not exists (
    select 1 from unnest(v_allow) a
    where v_host = lower(btrim(a)) or v_host like '%.' || lower(btrim(a))
  ) then
    return 'url_domain_not_allowed';
  end if;
  return null;
end;
$$;

-- Hedefin hâlâ geçerli olup olmadığını döndürür (null = geçerli).
create or replace function public.ad_destination_check(p_campaign_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d public.ad_target_destinations%rowtype;
begin
  select * into d from public.ad_target_destinations where campaign_id = p_campaign_id;
  if not found then
    return 'destination_missing';
  end if;

  if d.type = 'detail_page' then
    if not exists (select 1 from public.ad_detail_pages p where p.campaign_id = p_campaign_id and p.enabled) then
      return 'detail_missing';
    end if;
  elsif d.type = 'business' then
    if not public.ad_is_uuid(d.target_id) then return 'target_invalid'; end if;
    if not exists (select 1 from public.places p where p.id = d.target_id::uuid and p.status = 'published') then
      return 'target_unavailable';
    end if;
  elsif d.type in ('market_listing', 'vehicle', 'job') then
    if not public.ad_is_uuid(d.target_id) then return 'target_invalid'; end if;
    if not exists (
      select 1 from public.marketplace_listings l
      left join public.marketplace_categories c on c.id = l.category_id
      where l.id = d.target_id::uuid
        and l.status = 'active'
        and l.moderation_status = 'visible'
        and (l.expires_at is null or l.expires_at > now())
        and (d.type = 'market_listing' or c.kind = d.type)
    ) then
      return 'target_unavailable';
    end if;
  elsif d.type = 'real_estate' then
    if not public.ad_is_uuid(d.target_id) then return 'target_invalid'; end if;
    if not exists (
      select 1 from public.real_estate_listings r
      where r.id = d.target_id::uuid and r.status = 'published'
        and (r.expires_at is null or r.expires_at > now())
    ) then
      return 'target_unavailable';
    end if;
  elsif d.type = 'ride' then
    if not public.ad_is_uuid(d.target_id) then return 'target_invalid'; end if;
    if not exists (
      select 1 from public.ride_offers o
      where o.id = d.target_id::uuid and o.status = 'published' and o.visibility = 'public'
        and o.depart_at > now()
    ) then
      return 'target_unavailable';
    end if;
  elsif d.type = 'post' then
    if not public.ad_is_uuid(d.target_id) then return 'target_invalid'; end if;
    if not exists (
      select 1 from public.posts p
      where p.id = d.target_id::uuid and p.visibility = 'public' and p.moderation_status = 'visible'
    ) then
      return 'target_unavailable';
    end if;
  elsif d.type = 'category' then
    if d.target_id is null or not exists (
      select 1 from public.marketplace_categories c where c.slug = d.target_id and c.is_active
    ) then
      return 'target_unavailable';
    end if;
  elsif d.type = 'external_url' then
    return public.ad_url_check(d.url);
  elsif d.type = 'phone' then
    if coalesce(d.phone, '') !~ '^\+?[0-9]{10,13}$' then
      return 'phone_invalid';
    end if;
  elsif d.type = 'map_location' then
    if d.lat is null or d.lng is null or d.lat not between 35.5 and 42.5 or d.lng not between 25.5 and 45.0 then
      return 'location_invalid';
    end if;
  end if;
  return null;
end;
$$;

-- İstemcinin güvenle yönlendirebileceği hedef özeti.
create or replace function public.ad_destination_json(p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'type', d.type,
    'target_id', d.target_id,
    'url', case when d.type = 'external_url' then d.url end,
    'phone', case when d.type = 'phone' then d.phone end,
    'lat', case when d.type = 'map_location' then d.lat end,
    'lng', case when d.type = 'map_location' then d.lng end,
    'label', d.label,
    'category', case when d.type = 'category' then (
      select jsonb_build_object(
        'slug', c.slug, 'name', c.name, 'kind', coalesce(c.kind, p.kind),
        'root_slug', coalesce(p.slug, c.slug), 'is_child', c.parent_id is not null)
      from public.marketplace_categories c
      left join public.marketplace_categories p on p.id = c.parent_id
      where c.slug = d.target_id limit 1) end)
  from public.ad_target_destinations d
  where d.campaign_id = p_campaign_id
$$;

create or replace function public.ad_log_invalid(p_kind text, p_reason text, p_user uuid, p_serve uuid, p_campaign uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Saldırgan bu tabloyu şişiremesin: kullanıcı başına dakikada 60 kayıt.
  if p_user is not null and (
    select count(*) from public.ad_invalid_events e
    where e.user_id = p_user and e.created_at > now() - interval '1 minute') >= 60 then
    return;
  end if;
  insert into public.ad_invalid_events (kind, reason, user_id, serve_id, campaign_id)
  values (p_kind, left(p_reason, 60), p_user, p_serve, p_campaign);
end;
$$;

create or replace function public.ad_system_audit(p_code text, p_label text, p_target_id text, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.admin_audit_logs (actor_admin_id, action_code, action_label_tr, target_type, target_id, outcome, metadata_safe)
  values (null, left(p_code, 80), left(p_label, 160), 'ad_campaign', left(coalesce(p_target_id, ''), 200),
          'success', coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('actor', 'system'));
exception when others then
  null;
end;
$$;

create or replace function public.ad_campaign_metrics(p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'impressions', c.impressions_total,
    'clicks', c.clicks_total,
    'ctr', case when c.impressions_total > 0 then round(c.clicks_total::numeric * 100 / c.impressions_total, 2) else 0 end,
    'reach', (select count(distinct i.user_id) from public.ad_impressions i where i.campaign_id = c.id),
    'spend_cents', round(c.spent_cents),
    'invalid_events', (select count(*) from public.ad_invalid_events e where e.campaign_id = c.id),
    'hides', (select count(*) from public.ad_user_feedback f where f.campaign_id = c.id and f.kind = 'hide'),
    'reports', (select count(*) from public.ad_user_feedback f where f.campaign_id = c.id and f.kind = 'report'))
  from public.ad_campaigns c where c.id = p_campaign_id
$$;

create or replace function public.ad_report_generate_internal(p_campaign_id uuid, p_kind text, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.ad_campaigns%rowtype;
  v_id uuid;
begin
  select * into c from public.ad_campaigns where id = p_campaign_id;
  if not found then return null; end if;
  insert into public.ad_advertiser_reports (advertiser_id, campaign_id, kind, period_start, period_end, metrics, generated_by)
  values (c.advertiser_id, c.id, p_kind, c.starts_at, least(c.ends_at, now()),
    public.ad_campaign_metrics(c.id) || jsonb_build_object(
      'by_placement', coalesce((
        select jsonb_agg(jsonb_build_object('placement', x.placement_key, 'impressions', x.n) order by x.n desc)
        from (select placement_key, count(*) n from public.ad_impressions where campaign_id = c.id group by 1) x), '[]'::jsonb),
      'by_district', coalesce((
        select jsonb_agg(jsonb_build_object('district', x.district, 'impressions', x.n) order by x.n desc)
        from (select coalesce(district, 'Belirtilmemiş') district, count(*) n from public.ad_impressions
              where campaign_id = c.id group by 1) x), '[]'::jsonb)),
    p_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Sunum motoru
-- ---------------------------------------------------------------------------
create or replace function public.ad_serve(
  p_placement        text,
  p_platform         text,
  p_session_id       text,
  p_count            integer default 2,
  p_context_district text default null,
  p_exclude          uuid[] default '{}',
  p_last_campaign    uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  s public.ad_settings%rowtype;
  pl public.ad_placements%rowtype;
  v_first int; v_imin int; v_imax int; v_max_session int; v_max_daily int; v_repeat int;
  v_cfg jsonb;
  v_recent int; v_used_session int; v_used_daily int; v_n int;
  v_today date := public.ad_today();
  v_district_raw text;
  v_district text;
  r record;
  v_ids uuid[] := '{}';
  v_left int[] := '{}';
  v_seq uuid[] := '{}';
  v_prev uuid := p_last_campaign;
  v_pick uuid;
  v_pick_left int;
  i int; j int; v_len int;
  v_serve uuid;
  v_out jsonb := '[]'::jsonb;
  v_fallback jsonb := null;
begin
  if v_uid is null then
    return jsonb_build_object('enabled', false, 'reason', 'auth_required', 'ads', '[]'::jsonb);
  end if;
  if p_platform is null or p_platform not in ('ios', 'android', 'web') then
    return jsonb_build_object('enabled', false, 'reason', 'platform_invalid', 'ads', '[]'::jsonb);
  end if;
  if p_session_id is null or p_session_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    return jsonb_build_object('enabled', false, 'reason', 'session_invalid', 'ads', '[]'::jsonb);
  end if;

  select * into s from public.ad_settings where id = 1;
  if not found or not s.ads_enabled then
    return jsonb_build_object('enabled', false, 'reason', 'global_off', 'ads', '[]'::jsonb);
  end if;

  select * into pl from public.ad_placements where key = p_placement;
  if not found then
    return jsonb_build_object('enabled', false, 'reason', 'placement_unknown', 'ads', '[]'::jsonb);
  end if;
  if not pl.enabled or pl.surface_status <> 'live' then
    return jsonb_build_object('enabled', false, 'reason', 'placement_off', 'ads', '[]'::jsonb);
  end if;
  if (pl.active_from is not null and pl.active_from > now())
     or (pl.active_until is not null and pl.active_until <= now()) then
    return jsonb_build_object('enabled', false, 'reason', 'placement_window', 'ads', '[]'::jsonb);
  end if;
  if not (p_platform = any(pl.platforms)) then
    return jsonb_build_object('enabled', false, 'reason', 'platform_off', 'ads', '[]'::jsonb);
  end if;

  v_first := public.ad_rule_clamp('first_after', pl.first_after);
  v_imin := public.ad_rule_clamp('interval_min', pl.interval_min);
  v_imax := greatest(v_imin, public.ad_rule_clamp('interval_max', pl.interval_max));
  v_max_session := public.ad_rule_clamp('max_per_session', pl.max_per_session);
  v_max_daily := public.ad_rule_clamp('max_daily_per_user', pl.max_daily_per_user);
  v_repeat := public.ad_rule_clamp('campaign_repeat_limit', pl.campaign_repeat_limit);
  v_cfg := jsonb_build_object(
    'first_after', v_first, 'interval_min', v_imin, 'interval_max', v_imax,
    'max_per_session', v_max_session, 'format', pl.format,
    'min_view_ms', greatest(1000, s.min_view_ms), 'min_visible_ratio', greatest(0.5, s.min_visible_ratio));

  if s.admob_enabled and pl.allow_admob_fallback
     and coalesce(s.admob_config #>> array['units', p_placement, p_platform], '') <> '' then
    v_fallback := jsonb_build_object(
      'provider', 'google_admob',
      'unit_id', s.admob_config #>> array['units', p_placement, p_platform]);
  end if;

  if not s.direct_enabled then
    return jsonb_build_object('enabled', true, 'config', v_cfg, 'ads', '[]'::jsonb, 'fallback', v_fallback);
  end if;

  select count(*) into v_recent from public.ad_serves
  where user_id = v_uid and served_at > now() - interval '1 minute';
  if v_recent >= 40 then
    perform public.ad_log_invalid('serve', 'rate_limited', v_uid, null, null);
    return jsonb_build_object('enabled', true, 'config', v_cfg, 'ads', '[]'::jsonb, 'reason', 'rate_limited');
  end if;

  select count(*) into v_used_session from public.ad_serves
  where user_id = v_uid and session_id = p_session_id and placement_key = p_placement;
  select count(*) into v_used_daily from public.ad_impressions
  where user_id = v_uid and placement_key = p_placement and day = v_today;

  v_n := least(greatest(coalesce(p_count, 1), 0), 6, v_max_session - v_used_session, v_max_daily - v_used_daily);
  if v_n <= 0 then
    return jsonb_build_object('enabled', true, 'config', v_cfg, 'ads', '[]'::jsonb, 'fallback', v_fallback,
      'reason', 'frequency_cap');
  end if;

  select nullif(btrim(district), '') into v_district_raw from public.profiles where id = v_uid;
  v_district_raw := coalesce(nullif(btrim(left(p_context_district, 60)), ''), v_district_raw);
  v_district := public.ad_fold(v_district_raw);

  for r in
    select c.id,
      v_repeat - (
        select count(*) from public.ad_serves x
        where x.user_id = v_uid and x.session_id = p_session_id
          and x.placement_key = p_placement and x.campaign_id = c.id) as repeat_left,
      -ln(greatest(random(), 1e-9)) / (
        c.priority::numeric * (1 + case
          when c.total_impression_cap is not null then 4 * greatest(0,
            extract(epoch from now() - c.starts_at) / greatest(1, extract(epoch from c.ends_at - c.starts_at))
            - c.impressions_total::numeric / c.total_impression_cap)
          else 0 end)) as k
    from public.ad_campaigns c
    join public.ad_creatives cr on cr.campaign_id = c.id
    join public.ad_campaign_placements cp on cp.campaign_id = c.id and cp.placement_key = p_placement
    join public.ad_advertisers a on a.id = c.advertiser_id and a.status = 'active'
    where c.source = 'trabzone_direct'
      and c.status in ('scheduled', 'active')
      and c.starts_at <= now() and c.ends_at > now()
      and p_platform = any(c.platforms)
      and c.priority >= pl.min_priority
      and cr.image_url is not null
      and not (c.id = any(coalesce(p_exclude, '{}'::uuid[])))
      and (cardinality(c.target_districts) = 0
           or v_district = any(select public.ad_fold(t) from unnest(c.target_districts) t))
      and (c.total_impression_cap is null or c.impressions_total < c.total_impression_cap)
      and (c.budget_cents is null or c.spent_cents < c.budget_cents)
      and (c.daily_impression_cap is null or coalesce((
        select ds.impressions from public.ad_campaign_daily_stats ds
        where ds.campaign_id = c.id and ds.day = v_today), 0) < c.daily_impression_cap)
      and not exists (
        select 1 from public.ad_user_feedback f
        where f.user_id = v_uid and f.campaign_id = c.id and f.hidden_until > now())
      and (select count(*) from public.ad_impressions i
           where i.user_id = v_uid and i.day = v_today and i.campaign_id = c.id)
          < public.ad_rule_clamp('per_user_daily_cap', c.per_user_daily_cap)
      and public.ad_destination_check(c.id) is null
    order by k
    limit 12
  loop
    if r.repeat_left > 0 then
      v_ids := v_ids || r.id;
      v_left := v_left || r.repeat_left::int;
    end if;
  end loop;

  -- Sıra: aynı kampanya art arda gelmez; seçilen kampanya kuyruğun sonuna
  -- taşınarak öncelik sırasına göre dönüşümlü dağıtım yapılır.
  for i in 1..v_n loop
    v_pick := null;
    v_len := coalesce(array_length(v_ids, 1), 0);
    for j in 1..v_len loop
      if v_left[j] > 0 and (v_prev is null or v_ids[j] <> v_prev) then
        v_pick := v_ids[j];
        v_pick_left := v_left[j] - 1;
        v_ids := v_ids[1:j-1] || v_ids[j+1:v_len] || v_pick;
        v_left := v_left[1:j-1] || v_left[j+1:v_len] || v_pick_left;
        exit;
      end if;
    end loop;
    exit when v_pick is null;
    v_seq := v_seq || v_pick;
    v_prev := v_pick;
  end loop;

  foreach v_pick in array v_seq loop
    insert into public.ad_serves (campaign_id, placement_key, user_id, session_id, platform, district)
    values (v_pick, p_placement, v_uid, p_session_id, p_platform, v_district_raw)
    returning id into v_serve;

    v_out := v_out || jsonb_build_array((
      select jsonb_build_object(
        'serve_id', v_serve,
        'campaign_id', c.id,
        'source', c.source,
        'advertiser_name', a.name,
        'title', cr.title,
        'description', cr.description,
        'cta_label', cr.cta_label,
        'business_name', cr.business_name,
        'image_url', cr.image_url,
        'mobile_image_url', cr.mobile_image_url,
        'web_image_url', cr.web_image_url,
        'image_focus', cr.image_focus,
        'destination', public.ad_destination_json(c.id))
      from public.ad_campaigns c
      join public.ad_creatives cr on cr.campaign_id = c.id
      join public.ad_advertisers a on a.id = c.advertiser_id
      where c.id = v_pick));
  end loop;

  return jsonb_build_object('enabled', true, 'config', v_cfg, 'ads', v_out, 'fallback', v_fallback);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Gösterim ve tıklama doğrulaması
-- ---------------------------------------------------------------------------
create or replace function public.ad_impression_internal(p_serve_id uuid, p_uid uuid, p_visible_ms integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.ad_serves%rowtype;
  s public.ad_settings%rowtype;
  c public.ad_campaigns%rowtype;
  v_today date := public.ad_today();
  v_recent int;
  v_user_today int;
  v_stats int;
  v_cost numeric;
begin
  select * into v from public.ad_serves where id = p_serve_id and user_id = p_uid for update;
  if not found then
    perform public.ad_log_invalid('impression', 'serve_not_found', p_uid, p_serve_id, null);
    return jsonb_build_object('counted', false, 'reason', 'serve_not_found');
  end if;
  if v.impression_at is not null then
    return jsonb_build_object('counted', false, 'reason', 'duplicate', 'already', true);
  end if;

  select * into s from public.ad_settings where id = 1;
  if not s.ads_enabled then
    return jsonb_build_object('counted', false, 'reason', 'global_off');
  end if;
  if coalesce(p_visible_ms, 0) < greatest(1000, s.min_view_ms) then
    perform public.ad_log_invalid('impression', 'visibility_insufficient', p_uid, p_serve_id, v.campaign_id);
    return jsonb_build_object('counted', false, 'reason', 'visibility_insufficient');
  end if;
  if now() - v.served_at < make_interval(secs => greatest(1000, s.min_view_ms) / 1000.0) then
    perform public.ad_log_invalid('impression', 'too_fast', p_uid, p_serve_id, v.campaign_id);
    return jsonb_build_object('counted', false, 'reason', 'too_fast');
  end if;
  if now() - v.served_at > make_interval(mins => s.serve_ttl_minutes) then
    perform public.ad_log_invalid('impression', 'serve_expired', p_uid, p_serve_id, v.campaign_id);
    return jsonb_build_object('counted', false, 'reason', 'serve_expired');
  end if;

  select count(*) into v_recent from public.ad_impressions
  where user_id = p_uid and created_at > now() - interval '1 minute';
  if v_recent >= s.impression_rate_limit_per_minute then
    perform public.ad_log_invalid('impression', 'rate_limited', p_uid, p_serve_id, v.campaign_id);
    return jsonb_build_object('counted', false, 'reason', 'rate_limited');
  end if;

  -- Kampanya satırı kilitlenir: eşzamanlı gösterimler limitleri aşamaz.
  select * into c from public.ad_campaigns where id = v.campaign_id for update;
  if c.status not in ('scheduled', 'active') or c.starts_at > now() or c.ends_at <= now() then
    perform public.ad_log_invalid('impression', 'campaign_inactive', p_uid, p_serve_id, c.id);
    return jsonb_build_object('counted', false, 'reason', 'campaign_inactive');
  end if;
  if (c.total_impression_cap is not null and c.impressions_total >= c.total_impression_cap)
     or (c.budget_cents is not null and c.spent_cents >= c.budget_cents) then
    perform public.ad_log_invalid('impression', 'campaign_limit', p_uid, p_serve_id, c.id);
    return jsonb_build_object('counted', false, 'reason', 'campaign_limit');
  end if;

  select count(*) into v_user_today from public.ad_impressions
  where user_id = p_uid and campaign_id = c.id and day = v_today;
  if v_user_today >= public.ad_rule_clamp('per_user_daily_cap', c.per_user_daily_cap) then
    perform public.ad_log_invalid('impression', 'frequency_cap', p_uid, p_serve_id, c.id);
    return jsonb_build_object('counted', false, 'reason', 'frequency_cap');
  end if;

  v_cost := coalesce(c.cpm_cents, 0) / 1000.0;

  insert into public.ad_campaign_daily_stats as ds (campaign_id, day, impressions, spend_cents)
  values (c.id, v_today, 1, v_cost)
  on conflict (campaign_id, day) do update
    set impressions = ds.impressions + 1, spend_cents = ds.spend_cents + v_cost
    where c.daily_impression_cap is null or ds.impressions < c.daily_impression_cap
  returning ds.impressions into v_stats;
  if v_stats is null then
    perform public.ad_log_invalid('impression', 'daily_cap', p_uid, p_serve_id, c.id);
    return jsonb_build_object('counted', false, 'reason', 'daily_cap');
  end if;

  update public.ad_campaigns
  set impressions_total = impressions_total + 1, spent_cents = spent_cents + v_cost
  where id = c.id;

  insert into public.ad_impressions (serve_id, campaign_id, placement_key, user_id, platform, district, day, cost_cents)
  values (v.id, c.id, v.placement_key, p_uid, v.platform, v.district, v_today, v_cost);

  update public.ad_serves set impression_at = now() where id = v.id;

  return jsonb_build_object('counted', true);
end;
$$;

create or replace function public.ad_record_impression(p_serve_id uuid, p_visible_ms integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('counted', false, 'reason', 'auth_required');
  end if;
  return public.ad_impression_internal(p_serve_id, v_uid, p_visible_ms);
end;
$$;

create or replace function public.ad_record_click(p_serve_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v public.ad_serves%rowtype;
  s public.ad_settings%rowtype;
  v_recent int;
  v_imp jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('counted', false, 'reason', 'auth_required');
  end if;
  select * into v from public.ad_serves where id = p_serve_id and user_id = v_uid for update;
  if not found then
    perform public.ad_log_invalid('click', 'serve_not_found', v_uid, p_serve_id, null);
    return jsonb_build_object('counted', false, 'reason', 'serve_not_found');
  end if;
  if v.clicked_at is not null then
    return jsonb_build_object('counted', false, 'reason', 'duplicate', 'already', true);
  end if;

  select * into s from public.ad_settings where id = 1;
  select count(*) into v_recent from public.ad_clicks
  where user_id = v_uid and created_at > now() - interval '1 minute';
  if v_recent >= s.click_rate_limit_per_minute then
    perform public.ad_log_invalid('click', 'rate_limited', v_uid, p_serve_id, v.campaign_id);
    return jsonb_build_object('counted', false, 'reason', 'rate_limited');
  end if;

  -- Tıklama ancak geçerli bir gösterimin üzerine sayılır. Kullanıcı reklamı
  -- görünürlük süresini doldurmadan tıkladıysa gösterim burada denenir;
  -- sunucu eşikleri (en az 1 sn, hız limiti) yine uygulanır.
  if v.impression_at is null then
    v_imp := public.ad_impression_internal(p_serve_id, v_uid, greatest(1000, s.min_view_ms));
    if not coalesce((v_imp ->> 'counted')::boolean, false) then
      perform public.ad_log_invalid('click', 'no_valid_impression', v_uid, p_serve_id, v.campaign_id);
      return jsonb_build_object('counted', false, 'reason', 'no_valid_impression');
    end if;
  end if;

  insert into public.ad_clicks (serve_id, campaign_id, placement_key, user_id, platform, district)
  values (v.id, v.campaign_id, v.placement_key, v_uid, v.platform, v.district);

  insert into public.ad_campaign_daily_stats as ds (campaign_id, day, clicks)
  values (v.campaign_id, public.ad_today(), 1)
  on conflict (campaign_id, day) do update set clicks = ds.clicks + 1;

  update public.ad_campaigns set clicks_total = clicks_total + 1 where id = v.campaign_id;
  update public.ad_serves set clicked_at = now() where id = v.id;

  return jsonb_build_object('counted', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Kullanıcı geri bildirimi (gizle / bildir)
-- ---------------------------------------------------------------------------
create or replace function public.ad_feedback(
  p_campaign_id uuid,
  p_kind text,
  p_reason text default null,
  p_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  s public.ad_settings%rowtype;
  v_until timestamptz;
  v_reports int;
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_kind not in ('hide', 'report') then
    raise exception 'ad_feedback_invalid' using errcode = '22023';
  end if;
  if p_kind = 'report' and coalesce(p_reason, '') not in
     ('irrelevant', 'repetitive', 'misleading', 'inappropriate', 'scam', 'other') then
    raise exception 'ad_feedback_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ad_campaigns where id = p_campaign_id) then
    raise exception 'ad_campaign_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.ad_user_feedback
      where user_id = v_uid and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'rate_limited' using errcode = '22023';
  end if;

  select * into s from public.ad_settings where id = 1;
  v_until := now() + make_interval(days => greatest(1, s.hide_duration_days));

  insert into public.ad_user_feedback (user_id, campaign_id, kind, reason, details, hidden_until)
  values (v_uid, p_campaign_id, p_kind, p_reason, left(nullif(btrim(coalesce(p_details, '')), ''), 500), v_until)
  on conflict (user_id, campaign_id, kind) do update
    set reason = excluded.reason, details = excluded.details,
        hidden_until = excluded.hidden_until, created_at = now();

  -- Bildirim de reklamı bu kullanıcıdan gizler.
  if p_kind = 'report' then
    insert into public.ad_user_feedback (user_id, campaign_id, kind, hidden_until)
    values (v_uid, p_campaign_id, 'hide', v_until)
    on conflict (user_id, campaign_id, kind) do update set hidden_until = excluded.hidden_until;

    select count(distinct user_id) into v_reports from public.ad_user_feedback
    where campaign_id = p_campaign_id and kind = 'report';
    select status into v_status from public.ad_campaigns where id = p_campaign_id;
    if v_reports >= greatest(2, s.auto_pause_report_threshold) and v_status in ('scheduled', 'active') then
      update public.ad_campaigns
      set status = 'paused', paused_at = now(), status_changed_at = now(), updated_at = now()
      where id = p_campaign_id;
      perform public.ad_system_audit('ads.campaign.auto_pause', 'Kampanya kullanıcı bildirimleri nedeniyle duraklatıldı',
        p_campaign_id::text, jsonb_build_object('from', v_status, 'to', 'paused', 'reports', v_reports));
    end if;
  end if;

  return jsonb_build_object('ok', true, 'hidden_until', v_until);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Reklam detay sayfası
-- ---------------------------------------------------------------------------
create or replace function public.ad_detail_get(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  c public.ad_campaigns%rowtype;
  v_admin boolean;
  v_live boolean;
  v_enabled boolean;
  v_dest_reason text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into c from public.ad_campaigns where id = p_campaign_id;
  if not found then
    return jsonb_build_object('available', false, 'reason', 'not_found');
  end if;
  v_admin := public.has_permission('ads.view');
  select ads_enabled into v_enabled from public.ad_settings where id = 1;
  v_live := coalesce(v_enabled, false) and c.status in ('scheduled', 'active')
    and c.starts_at <= now() and c.ends_at > now();
  if not v_live and not v_admin then
    return jsonb_build_object('available', false, 'reason', 'ended');
  end if;
  v_dest_reason := public.ad_destination_check(c.id);

  return jsonb_build_object(
    'available', true,
    'preview', not v_live,
    'campaign', jsonb_build_object(
      'id', c.id, 'name', c.name, 'status', c.status, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
      'campaign_type', c.campaign_type),
    'advertiser', (select jsonb_build_object('name', a.name, 'website', a.website, 'place_id', a.place_id)
                   from public.ad_advertisers a where a.id = c.advertiser_id),
    'creative', (select to_jsonb(cr) - 'id' - 'campaign_id' - 'updated_at'
                 from public.ad_creatives cr where cr.campaign_id = c.id),
    'detail', (select to_jsonb(d) - 'campaign_id' - 'updated_at'
               from public.ad_detail_pages d where d.campaign_id = c.id and d.enabled),
    'destination', public.ad_destination_json(c.id),
    'destination_valid', v_dest_reason is null,
    'place', (select jsonb_build_object('id', p.id, 'name', p.name, 'address', p.address)
              from public.ad_detail_pages d join public.places p on p.id = d.place_id
              where d.campaign_id = c.id and p.status = 'published'),
    'listing', (
      select case d.listing_type
        when 'market_listing' then (
          select jsonb_build_object('type', 'market_listing', 'id', l.id, 'title', l.title)
          from public.marketplace_listings l
          where l.id = d.listing_id and l.status = 'active' and l.moderation_status = 'visible')
        when 'real_estate' then (
          select jsonb_build_object('type', 'real_estate', 'id', r.id, 'title', r.title)
          from public.real_estate_listings r where r.id = d.listing_id and r.status = 'published')
        end
      from public.ad_detail_pages d where d.campaign_id = c.id and d.enabled));
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Durum senkronizasyonu (pg_cron, dakikada bir)
-- ---------------------------------------------------------------------------
create or replace function public.ads_sync_campaign_statuses()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    update public.ad_campaigns
    set status = 'active', status_changed_at = now(), updated_at = now()
    where status = 'scheduled' and starts_at <= now() and ends_at > now()
    returning id
  loop
    v_n := v_n + 1;
    perform public.ad_system_audit('ads.campaign.auto_activate', 'Kampanya yayın takvimiyle aktifleşti',
      r.id::text, jsonb_build_object('from', 'scheduled', 'to', 'active'));
  end loop;

  for r in
    update public.ad_campaigns c
    set status = 'expired', status_changed_at = now(), updated_at = now()
    where c.status in ('scheduled', 'active', 'paused')
      and (c.ends_at <= now()
           or (c.total_impression_cap is not null and c.impressions_total >= c.total_impression_cap)
           or (c.budget_cents is not null and c.spent_cents >= c.budget_cents))
    returning c.id, c.ends_at <= now() as by_time
  loop
    v_n := v_n + 1;
    perform public.ad_system_audit('ads.campaign.auto_expire',
      case when r.by_time then 'Kampanya bitiş tarihine ulaştı' else 'Kampanya gösterim/bütçe limitine ulaştı' end,
      r.id::text, jsonb_build_object('to', 'expired', 'by', case when r.by_time then 'time' else 'limit' end));
    perform public.ad_report_generate_internal(r.id, 'campaign_end', null);
  end loop;

  update public.ad_target_destinations d
  set is_valid = x.reason is null, invalid_reason = x.reason, checked_at = now()
  from (
    select c.id, public.ad_destination_check(c.id) as reason
    from public.ad_campaigns c where c.status in ('pending_review', 'scheduled', 'active', 'paused')
  ) x
  where d.campaign_id = x.id
    and (d.is_valid is distinct from (x.reason is null) or d.checked_at is null
         or d.checked_at < now() - interval '10 minutes');

  return v_n;
end;
$$;

do $$
begin
  begin
    perform cron.unschedule('ads-status-sync');
  exception when others then
    null;
  end;
  begin
    perform cron.schedule('ads-status-sync', '* * * * *', 'select public.ads_sync_campaign_statuses()');
  exception when others then
    raise notice 'cron schedule skipped: %', sqlerrm;
  end;
  begin
    perform cron.unschedule('ads-serve-prune');
  exception when others then
    null;
  end;
  begin
    -- Gösterim almamış eski sunum kayıtları 7 gün sonra silinir; sayılmış
    -- gösterim/tıklama kayıtları korunur.
    perform cron.schedule('ads-serve-prune', '40 3 * * *',
      $q$delete from public.ad_serves where impression_at is null and served_at < now() - interval '7 days';
         delete from public.ad_invalid_events where created_at < now() - interval '90 days'$q$);
  exception when others then
    raise notice 'cron schedule skipped: %', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 15. Yönetici: genel bakış ve ayarlar
-- ---------------------------------------------------------------------------
create or replace function public.admin_ads_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.ad_settings%rowtype;
  v_today date := public.ad_today();
begin
  perform public.tz_admin_require('ads.view');
  select * into s from public.ad_settings where id = 1;
  return jsonb_build_object(
    'ads_enabled', s.ads_enabled,
    'direct_enabled', s.direct_enabled,
    'admob_enabled', s.admob_enabled,
    'active_campaigns', (select count(*) from public.ad_campaigns
                         where status = 'active' and starts_at <= now() and ends_at > now()),
    'active_ads', (select count(distinct c.id) from public.ad_campaigns c join public.ad_creatives cr on cr.campaign_id = c.id
                   join public.ad_campaign_placements cp on cp.campaign_id = c.id
                   join public.ad_placements p on p.key = cp.placement_key and p.enabled and p.surface_status = 'live'
                   where c.status = 'active' and c.starts_at <= now() and c.ends_at > now()),
    'scheduled_campaigns', (select count(*) from public.ad_campaigns where status = 'scheduled'),
    'pending_review', (select count(*) from public.ad_campaigns where status = 'pending_review'),
    'total_campaigns', (select count(*) from public.ad_campaigns where status <> 'archived'),
    'impressions_total', (select coalesce(sum(impressions_total), 0) from public.ad_campaigns),
    'clicks_total', (select coalesce(sum(clicks_total), 0) from public.ad_campaigns),
    'impressions_today', (select coalesce(sum(impressions), 0) from public.ad_campaign_daily_stats where day = v_today),
    'clicks_today', (select coalesce(sum(clicks), 0) from public.ad_campaign_daily_stats where day = v_today),
    'revenue_cents', (select coalesce(round(sum(spent_cents)), 0) from public.ad_campaigns),
    'placements_enabled', (select count(*) from public.ad_placements where enabled),
    'placements_total', (select count(*) from public.ad_placements),
    'invalid_events_24h', (select count(*) from public.ad_invalid_events where created_at > now() - interval '24 hours'),
    'reports_7d', (select count(*) from public.ad_user_feedback where kind = 'report' and created_at > now() - interval '7 days'),
    'upcoming_ends', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'ends_at', c.ends_at, 'status', c.status)
                       order by c.ends_at)
      from (select id, name, ends_at, status from public.ad_campaigns
            where status in ('scheduled', 'active', 'paused') and ends_at > now()
              and ends_at <= now() + interval '7 days'
            order by ends_at limit 8) c), '[]'::jsonb));
end;
$$;

create or replace function public.admin_ads_settings_get()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.tz_admin_require('ads.view');
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from public.ad_settings s where s.id = 1),
    'rules', coalesce((select jsonb_agg(to_jsonb(r) order by r.key) from public.ad_delivery_rules r), '[]'::jsonb));
end;
$$;

create or replace function public.admin_ads_global_set(p_enabled boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before boolean;
begin
  -- Kapatmak acil durum işlemidir: MFA kilidine takılmaz. Açmak kritik işlemdir.
  perform public.tz_admin_require('ads.settings', coalesce(p_enabled, false));
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select ads_enabled into v_before from public.ad_settings where id = 1 for update;
  update public.ad_settings set ads_enabled = coalesce(p_enabled, false), updated_by = auth.uid(), updated_at = now()
  where id = 1;
  perform public.tz_admin_audit(
    case when p_enabled then 'ads.global.enable' else 'ads.global.disable' end,
    case when p_enabled then 'Reklam gösterimi platform genelinde açıldı' else 'Tüm reklamlar kapatıldı' end,
    'ad_settings', '1', jsonb_build_object('from', v_before, 'to', p_enabled, 'reason', btrim(p_reason)), 'success');
  return jsonb_build_object('ads_enabled', coalesce(p_enabled, false));
end;
$$;

create or replace function public.admin_ads_settings_update(p_patch jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.ad_settings%rowtype;
  v_allow text[];
  v_domain text;
begin
  perform public.tz_admin_require('ads.settings', true);
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into s from public.ad_settings where id = 1 for update;

  if p_patch ? 'external_domain_allowlist' then
    select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}')
    into v_allow from jsonb_array_elements_text(p_patch -> 'external_domain_allowlist') x;
    foreach v_domain in array v_allow loop
      if v_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
        raise exception 'ad_domain_invalid' using errcode = '22023';
      end if;
    end loop;
  else
    v_allow := s.external_domain_allowlist;
  end if;

  if coalesce((p_patch ->> 'admob_enabled')::boolean, s.admob_enabled)
     and coalesce(p_patch -> 'admob_config', s.admob_config) ->> 'ios_app_id' is null
     and coalesce(p_patch -> 'admob_config', s.admob_config) ->> 'android_app_id' is null then
    raise exception 'ad_admob_config_required' using errcode = '22023';
  end if;

  update public.ad_settings set
    direct_enabled = coalesce((p_patch ->> 'direct_enabled')::boolean, direct_enabled),
    admob_enabled = coalesce((p_patch ->> 'admob_enabled')::boolean, admob_enabled),
    admob_config = case when jsonb_typeof(p_patch -> 'admob_config') = 'object' then p_patch -> 'admob_config' else admob_config end,
    external_domain_allowlist = v_allow,
    hide_duration_days = greatest(1, least(365, coalesce((p_patch ->> 'hide_duration_days')::int, hide_duration_days))),
    click_rate_limit_per_minute = greatest(1, least(60, coalesce((p_patch ->> 'click_rate_limit_per_minute')::int, click_rate_limit_per_minute))),
    impression_rate_limit_per_minute = greatest(10, least(300, coalesce((p_patch ->> 'impression_rate_limit_per_minute')::int, impression_rate_limit_per_minute))),
    min_view_ms = greatest(1000, least(5000, coalesce((p_patch ->> 'min_view_ms')::int, min_view_ms))),
    min_visible_ratio = greatest(0.5, least(1, coalesce((p_patch ->> 'min_visible_ratio')::numeric, min_visible_ratio))),
    serve_ttl_minutes = greatest(5, least(240, coalesce((p_patch ->> 'serve_ttl_minutes')::int, serve_ttl_minutes))),
    auto_pause_report_threshold = greatest(2, least(500, coalesce((p_patch ->> 'auto_pause_report_threshold')::int, auto_pause_report_threshold))),
    policy_text = case when p_patch ? 'policy_text' then left(nullif(btrim(p_patch ->> 'policy_text'), ''), 4000) else policy_text end,
    updated_by = auth.uid(),
    updated_at = now()
  where id = 1;

  perform public.tz_admin_audit('ads.settings.update', 'Reklam sistem ayarları güncellendi', 'ad_settings', '1',
    jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p_patch) k), 'reason', btrim(p_reason)), 'success');
  return (select to_jsonb(x) from public.ad_settings x where x.id = 1);
end;
$$;

create or replace function public.admin_ads_rule_update(p_key text, p_min integer, p_max integer, p_default integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.ad_delivery_rules%rowtype;
begin
  perform public.tz_admin_require('ads.settings', true);
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into r from public.ad_delivery_rules where key = p_key for update;
  if not found then
    raise exception 'ad_rule_not_found' using errcode = 'P0002';
  end if;
  if p_min < r.hard_min or p_max > r.hard_max or p_min > p_default or p_default > p_max then
    raise exception 'ad_rule_out_of_bounds' using errcode = '22023';
  end if;
  update public.ad_delivery_rules
  set min_value = p_min, max_value = p_max, default_value = p_default, updated_by = auth.uid(), updated_at = now()
  where key = p_key;
  perform public.tz_admin_audit('ads.rule.update', 'Reklam güvenli sınırı güncellendi', 'ad_delivery_rule', p_key,
    jsonb_build_object('from', jsonb_build_object('min', r.min_value, 'max', r.max_value, 'default', r.default_value),
                       'to', jsonb_build_object('min', p_min, 'max', p_max, 'default', p_default),
                       'reason', btrim(p_reason)), 'success');
  return (select to_jsonb(x) from public.ad_delivery_rules x where x.key = p_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Yönetici: yerleşimler
-- ---------------------------------------------------------------------------
create or replace function public.admin_ads_placements_list()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public.ad_today();
begin
  perform public.tz_admin_require('ads.view');
  return coalesce((
    select jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'effective', jsonb_build_object(
        'first_after', public.ad_rule_clamp('first_after', p.first_after),
        'interval_min', public.ad_rule_clamp('interval_min', p.interval_min),
        'interval_max', greatest(public.ad_rule_clamp('interval_min', p.interval_min), public.ad_rule_clamp('interval_max', p.interval_max)),
        'max_per_session', public.ad_rule_clamp('max_per_session', p.max_per_session),
        'max_daily_per_user', public.ad_rule_clamp('max_daily_per_user', p.max_daily_per_user),
        'campaign_repeat_limit', public.ad_rule_clamp('campaign_repeat_limit', p.campaign_repeat_limit)),
      'active_campaigns', (select count(*) from public.ad_campaign_placements cp
                           join public.ad_campaigns c on c.id = cp.campaign_id
                           where cp.placement_key = p.key and c.status in ('scheduled', 'active')
                             and c.ends_at > now()),
      'impressions_7d', (select count(*) from public.ad_impressions i
                         where i.placement_key = p.key and i.day > v_today - 7),
      'clicks_7d', (select count(*) from public.ad_clicks k
                    where k.placement_key = p.key and k.day > v_today - 7))
      order by p.sort_order, p.key)
    from public.ad_placements p), '[]'::jsonb);
end;
$$;

create or replace function public.admin_ads_placement_update(p_key text, p_patch jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.ad_placements%rowtype;
  v_adjust jsonb := '[]'::jsonb;
  v_field text;
  v_req int;
  v_val int;
  v_vals jsonb := '{}'::jsonb;
  v_platforms text[];
  v_format text;
begin
  perform public.tz_admin_require('ads.manage');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into p from public.ad_placements where key = p_key for update;
  if not found then
    raise exception 'ad_placement_not_found' using errcode = 'P0002';
  end if;

  -- Sayısal alanlar güvenli sınırlara oturtulur; düzeltme yapılırsa raporlanır.
  foreach v_field in array array['first_after', 'interval_min', 'interval_max', 'max_per_session',
                                 'max_daily_per_user', 'campaign_repeat_limit'] loop
    if p_patch ? v_field then
      v_req := (p_patch ->> v_field)::int;
      v_val := public.ad_rule_clamp(v_field, v_req);
      if v_val is distinct from v_req then
        v_adjust := v_adjust || jsonb_build_array(jsonb_build_object('field', v_field, 'requested', v_req, 'applied', v_val));
      end if;
      v_vals := v_vals || jsonb_build_object(v_field, v_val);
    end if;
  end loop;

  if p_patch ? 'platforms' then
    select coalesce(array_agg(distinct x), '{}') into v_platforms
    from jsonb_array_elements_text(p_patch -> 'platforms') x where x in ('ios', 'android', 'web');
  else
    v_platforms := p.platforms;
  end if;

  v_format := coalesce(p_patch ->> 'format', p.format);
  if not (v_format = any(p.supported_formats)) then
    raise exception 'ad_format_unsupported' using errcode = '22023';
  end if;

  update public.ad_placements set
    enabled = coalesce((p_patch ->> 'enabled')::boolean, enabled),
    format = v_format,
    first_after = coalesce((v_vals ->> 'first_after')::int, first_after),
    interval_min = coalesce((v_vals ->> 'interval_min')::int, interval_min),
    interval_max = coalesce((v_vals ->> 'interval_max')::int, interval_max),
    max_per_session = coalesce((v_vals ->> 'max_per_session')::int, max_per_session),
    max_daily_per_user = coalesce((v_vals ->> 'max_daily_per_user')::int, max_daily_per_user),
    campaign_repeat_limit = coalesce((v_vals ->> 'campaign_repeat_limit')::int, campaign_repeat_limit),
    platforms = v_platforms,
    min_priority = greatest(1, least(10, coalesce((p_patch ->> 'min_priority')::int, min_priority))),
    active_from = case when p_patch ? 'active_from' then (p_patch ->> 'active_from')::timestamptz else active_from end,
    active_until = case when p_patch ? 'active_until' then (p_patch ->> 'active_until')::timestamptz else active_until end,
    allow_admob_fallback = coalesce((p_patch ->> 'allow_admob_fallback')::boolean, allow_admob_fallback),
    updated_by = auth.uid(),
    updated_at = now()
  where key = p_key;

  select * into p from public.ad_placements where key = p_key;
  if p.interval_max < p.interval_min then
    update public.ad_placements set interval_max = interval_min where key = p_key;
    v_adjust := v_adjust || jsonb_build_array(jsonb_build_object('field', 'interval_max', 'requested', p.interval_max, 'applied', p.interval_min));
  end if;
  if p.active_from is not null and p.active_until is not null and p.active_until <= p.active_from then
    raise exception 'dates_invalid' using errcode = '22023';
  end if;

  perform public.tz_admin_audit(
    case when p_patch ? 'enabled' and (p_patch ->> 'enabled')::boolean then 'ads.placement.enable'
         when p_patch ? 'enabled' then 'ads.placement.disable'
         else 'ads.placement.update' end,
    'Reklam yerleşimi güncellendi: ' || p.label_tr, 'ad_placement', p_key,
    jsonb_build_object('patch', p_patch, 'adjustments', v_adjust, 'reason', btrim(p_reason)), 'success');

  return jsonb_build_object(
    'placement', (select to_jsonb(x) from public.ad_placements x where x.key = p_key),
    'adjustments', v_adjust);
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. Yönetici: reklamverenler
-- ---------------------------------------------------------------------------
create or replace function public.admin_ads_advertisers_list(p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.tz_admin_require('ads.view');
  return jsonb_build_object(
    'total', (select count(*) from public.ad_advertisers a
              where v_q is null or a.name ilike '%' || v_q || '%' or coalesce(a.contact_email, '') ilike '%' || v_q || '%'),
    'limit', p_limit, 'offset', p_offset,
    'items', coalesce((
      select jsonb_agg(x order by x->>'name')
      from (
        select to_jsonb(a) || jsonb_build_object(
          'place_name', (select p.name from public.places p where p.id = a.place_id),
          'campaign_count', (select count(*) from public.ad_campaigns c where c.advertiser_id = a.id),
          'active_campaigns', (select count(*) from public.ad_campaigns c where c.advertiser_id = a.id and c.status = 'active'),
          'impressions', (select coalesce(sum(c.impressions_total), 0) from public.ad_campaigns c where c.advertiser_id = a.id),
          'clicks', (select coalesce(sum(c.clicks_total), 0) from public.ad_campaigns c where c.advertiser_id = a.id),
          'spend_cents', (select coalesce(round(sum(c.spent_cents)), 0) from public.ad_campaigns c where c.advertiser_id = a.id),
          'members', coalesce((
            select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', pr.username, 'role', m.role))
            from public.ad_advertiser_members m left join public.profiles pr on pr.id = m.user_id
            where m.advertiser_id = a.id), '[]'::jsonb)) as x
        from public.ad_advertisers a
        where v_q is null or a.name ilike '%' || v_q || '%' or coalesce(a.contact_email, '') ilike '%' || v_q || '%'
        order by a.name
        limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))
      ) s), '[]'::jsonb));
end;
$$;

create or replace function public.admin_ads_advertiser_save(p_id uuid, p_payload jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_site text := nullif(btrim(coalesce(p_payload ->> 'website', '')), '');
  v_email text := nullif(btrim(coalesce(p_payload ->> 'contact_email', '')), '');
  v_status text := coalesce(p_payload ->> 'status', 'active');
  v_place uuid;
begin
  perform public.tz_admin_require('ads.manage');
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'ad_name_invalid' using errcode = '22023';
  end if;
  if v_site is not null and v_site !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^\s<>"]*)?$' then
    raise exception 'ad_url_invalid' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
    raise exception 'ad_email_invalid' using errcode = '22023';
  end if;
  if v_status not in ('active', 'suspended', 'archived') then
    raise exception 'ad_status_invalid' using errcode = '22023';
  end if;
  if public.ad_is_uuid(p_payload ->> 'place_id') then
    select id into v_place from public.places where id = (p_payload ->> 'place_id')::uuid;
    if v_place is null then
      raise exception 'ad_place_not_found' using errcode = 'P0002';
    end if;
  end if;

  if v_id is null then
    insert into public.ad_advertisers (name, legal_name, tax_number, contact_name, contact_email, contact_phone,
                                       website, place_id, status, notes, created_by)
    values (v_name, nullif(btrim(p_payload ->> 'legal_name'), ''), nullif(btrim(p_payload ->> 'tax_number'), ''),
            nullif(btrim(p_payload ->> 'contact_name'), ''), v_email, nullif(btrim(p_payload ->> 'contact_phone'), ''),
            v_site, v_place, v_status, nullif(btrim(p_payload ->> 'notes'), ''), auth.uid())
    returning id into v_id;
  else
    update public.ad_advertisers set
      name = v_name,
      legal_name = nullif(btrim(p_payload ->> 'legal_name'), ''),
      tax_number = nullif(btrim(p_payload ->> 'tax_number'), ''),
      contact_name = nullif(btrim(p_payload ->> 'contact_name'), ''),
      contact_email = v_email,
      contact_phone = nullif(btrim(p_payload ->> 'contact_phone'), ''),
      website = v_site,
      place_id = v_place,
      status = v_status,
      notes = nullif(btrim(p_payload ->> 'notes'), ''),
      updated_at = now()
    where id = v_id;
    if not found then
      raise exception 'ad_advertiser_not_found' using errcode = 'P0002';
    end if;
  end if;

  perform public.tz_admin_audit('ads.advertiser.save', 'Reklamveren kaydedildi', 'ad_advertiser', v_id::text,
    jsonb_build_object('name', v_name, 'status', v_status, 'reason', nullif(btrim(coalesce(p_reason, '')), '')), 'success');
  return (select to_jsonb(a) from public.ad_advertisers a where a.id = v_id);
end;
$$;

create or replace function public.admin_ads_advertiser_member_set(p_advertiser_id uuid, p_username text, p_add boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  perform public.tz_admin_require('ads.manage');
  select id into v_user from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if v_user is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ad_advertisers where id = p_advertiser_id) then
    raise exception 'ad_advertiser_not_found' using errcode = 'P0002';
  end if;
  if p_add then
    insert into public.ad_advertiser_members (advertiser_id, user_id) values (p_advertiser_id, v_user)
    on conflict do nothing;
  else
    delete from public.ad_advertiser_members where advertiser_id = p_advertiser_id and user_id = v_user;
  end if;
  perform public.tz_admin_audit(case when p_add then 'ads.advertiser.member_add' else 'ads.advertiser.member_remove' end,
    'Reklamveren erişimi güncellendi', 'ad_advertiser', p_advertiser_id::text,
    jsonb_build_object('user_id', v_user, 'reason', nullif(btrim(coalesce(p_reason, '')), '')), 'success');
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. Yönetici: kampanyalar
-- ---------------------------------------------------------------------------
create or replace function public.ad_campaign_issues(p_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c public.ad_campaigns%rowtype;
  cr public.ad_creatives%rowtype;
  v_issues text[] := '{}';
  v_dest text;
begin
  select * into c from public.ad_campaigns where id = p_id;
  if not found then
    return array['campaign_not_found'];
  end if;
  select * into cr from public.ad_creatives where campaign_id = p_id;
  if cr.id is null or length(btrim(coalesce(cr.title, ''))) < 3 then
    v_issues := v_issues || 'title_missing';
  elsif length(cr.title) > 70 then
    v_issues := v_issues || 'title_too_long';
  end if;
  if cr.description is not null and length(cr.description) > 140 then
    v_issues := v_issues || 'description_too_long';
  end if;
  if cr.id is null or cr.image_url is null then
    v_issues := v_issues || 'media_missing';
  elsif not public.ad_media_url_ok(cr.image_url) or not public.ad_media_url_ok(cr.mobile_image_url)
     or not public.ad_media_url_ok(cr.web_image_url) or not public.ad_media_url_ok(cr.video_url) then
    v_issues := v_issues || 'media_url_invalid';
  end if;
  v_dest := public.ad_destination_check(p_id);
  if v_dest is not null then
    v_issues := v_issues || ('destination_' || v_dest);
  end if;
  if c.ends_at <= now() then
    v_issues := v_issues || 'ends_in_past';
  end if;
  if not exists (select 1 from public.ad_campaign_placements where campaign_id = p_id) then
    v_issues := v_issues || 'placements_missing';
  end if;
  if cardinality(c.platforms) = 0 then
    v_issues := v_issues || 'platforms_missing';
  end if;
  if public.ad_policy_prohibited(c.policy_category) or not public.ad_policy_category_ok(c.policy_category) then
    v_issues := v_issues || 'policy_prohibited';
  end if;
  if not exists (select 1 from public.ad_advertisers a where a.id = c.advertiser_id and a.status = 'active') then
    v_issues := v_issues || 'advertiser_inactive';
  end if;
  return v_issues;
end;
$$;

create or replace function public.admin_ads_campaigns_list(
  p_status text default null, p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.tz_admin_require('ads.view');
  perform public.ads_sync_campaign_statuses();
  return jsonb_build_object(
    'total', (select count(*) from public.ad_campaigns c join public.ad_advertisers a on a.id = c.advertiser_id
              where (p_status is null or c.status = p_status)
                and (v_q is null or c.name ilike '%' || v_q || '%' or a.name ilike '%' || v_q || '%')),
    'limit', p_limit, 'offset', p_offset,
    'counts', coalesce((select jsonb_object_agg(status, n) from (
                select status, count(*) n from public.ad_campaigns group by status) x), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(row_data order by sort_key desc)
      from (
        select c.updated_at as sort_key, jsonb_build_object(
          'id', c.id, 'name', c.name, 'status', c.status, 'priority', c.priority,
          'campaign_type', c.campaign_type, 'policy_category', c.policy_category, 'source', c.source,
          'starts_at', c.starts_at, 'ends_at', c.ends_at,
          'advertiser_id', a.id, 'advertiser_name', a.name,
          'title', cr.title, 'image_url', cr.image_url,
          'destination_type', d.type, 'destination_valid', d.is_valid, 'destination_reason', d.invalid_reason,
          'impressions', c.impressions_total, 'clicks', c.clicks_total,
          'ctr', case when c.impressions_total > 0 then round(c.clicks_total::numeric * 100 / c.impressions_total, 2) else 0 end,
          'spent_cents', round(c.spent_cents), 'budget_cents', c.budget_cents,
          'total_impression_cap', c.total_impression_cap,
          'target_districts', c.target_districts,
          'placements', coalesce((select jsonb_agg(cp.placement_key) from public.ad_campaign_placements cp where cp.campaign_id = c.id), '[]'::jsonb),
          'reports', (select count(*) from public.ad_user_feedback f where f.campaign_id = c.id and f.kind = 'report'),
          'updated_at', c.updated_at) as row_data
        from public.ad_campaigns c
        join public.ad_advertisers a on a.id = c.advertiser_id
        left join public.ad_creatives cr on cr.campaign_id = c.id
        left join public.ad_target_destinations d on d.campaign_id = c.id
        where (p_status is null or c.status = p_status)
          and (v_q is null or c.name ilike '%' || v_q || '%' or a.name ilike '%' || v_q || '%')
        order by c.updated_at desc
        limit greatest(1, least(coalesce(p_limit, 25), 200)) offset greatest(0, coalesce(p_offset, 0))
      ) s), '[]'::jsonb));
end;
$$;

create or replace function public.admin_ads_campaign_get(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform public.tz_admin_require('ads.view');
  select to_jsonb(c) || jsonb_build_object(
    'spent_cents', round(c.spent_cents),
    'advertiser', (select to_jsonb(a) from public.ad_advertisers a where a.id = c.advertiser_id),
    'creative', (select to_jsonb(cr) from public.ad_creatives cr where cr.campaign_id = c.id),
    'destination', (select to_jsonb(d) from public.ad_target_destinations d where d.campaign_id = c.id),
    'detail', (select to_jsonb(dp) from public.ad_detail_pages dp where dp.campaign_id = c.id),
    'placements', coalesce((select jsonb_agg(cp.placement_key) from public.ad_campaign_placements cp where cp.campaign_id = c.id), '[]'::jsonb),
    'metrics', public.ad_campaign_metrics(c.id),
    'issues', to_jsonb(public.ad_campaign_issues(c.id)),
    'feedback', coalesce((
      select jsonb_agg(jsonb_build_object('reason', f.reason, 'details', f.details, 'created_at', f.created_at) order by f.created_at desc)
      from (select * from public.ad_user_feedback where campaign_id = c.id and kind = 'report' order by created_at desc limit 30) f), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('action', l.action_code, 'label', l.action_label_tr, 'at', l.created_at,
                                          'actor', pr.username, 'meta', l.metadata_safe) order by l.created_at desc)
      from (select * from public.admin_audit_logs where target_type = 'ad_campaign' and target_id = c.id::text
            order by created_at desc limit 40) l
      left join public.profiles pr on pr.id = l.actor_admin_id), '[]'::jsonb))
  into v
  from public.ad_campaigns c where c.id = p_id;
  if v is null then
    raise exception 'ad_campaign_not_found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

create or replace function public.admin_ads_campaign_save(p_id uuid, p_payload jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('ads.manage');
  v_id uuid := p_id;
  v_existing public.ad_campaigns%rowtype;
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_policy text := coalesce(nullif(p_payload ->> 'policy_category', ''), 'general');
  v_type text := coalesce(nullif(p_payload ->> 'campaign_type', ''), 'business_promo');
  v_start timestamptz := (p_payload ->> 'starts_at')::timestamptz;
  v_end timestamptz := (p_payload ->> 'ends_at')::timestamptz;
  v_adv uuid;
  v_platforms text[];
  v_districts text[];
  v_placements text[];
  v_status text;
  v_cr jsonb := coalesce(p_payload -> 'creative', '{}'::jsonb);
  v_dest jsonb := coalesce(p_payload -> 'destination', '{}'::jsonb);
  v_detail jsonb := p_payload -> 'detail';
  v_dest_type text;
  v_url text;
  v_gallery text[];
  v_features text[];
  v_media text;
begin
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'ad_name_invalid' using errcode = '22023';
  end if;
  if public.ad_policy_prohibited(v_policy) then
    raise exception 'ad_policy_prohibited' using errcode = '22023';
  end if;
  if not public.ad_policy_category_ok(v_policy) then
    raise exception 'ad_policy_category_invalid' using errcode = '22023';
  end if;
  if v_start is null or v_end is null or v_end <= v_start then
    raise exception 'dates_invalid' using errcode = '22023';
  end if;
  if not public.ad_is_uuid(p_payload ->> 'advertiser_id') then
    raise exception 'ad_advertiser_not_found' using errcode = 'P0002';
  end if;
  select id into v_adv from public.ad_advertisers where id = (p_payload ->> 'advertiser_id')::uuid;
  if v_adv is null then
    raise exception 'ad_advertiser_not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_platforms
  from jsonb_array_elements_text(coalesce(p_payload -> 'platforms', '["ios","android","web"]'::jsonb)) x
  where x in ('ios', 'android', 'web');
  select coalesce(array_agg(distinct left(btrim(x), 40)) filter (where btrim(x) <> ''), '{}') into v_districts
  from jsonb_array_elements_text(coalesce(p_payload -> 'target_districts', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x), '{}') into v_placements
  from jsonb_array_elements_text(coalesce(p_payload -> 'placements', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_placements) k where not exists (select 1 from public.ad_placements p where p.key = k)) then
    raise exception 'ad_placement_not_found' using errcode = 'P0002';
  end if;

  foreach v_media in array array[v_cr ->> 'image_url', v_cr ->> 'mobile_image_url', v_cr ->> 'web_image_url', v_cr ->> 'video_url',
                                 v_detail ->> 'cover_url', v_detail ->> 'video_url'] loop
    if nullif(btrim(coalesce(v_media, '')), '') is not null and not public.ad_media_url_ok(btrim(v_media)) then
      raise exception 'ad_media_url_invalid' using errcode = '22023';
    end if;
  end loop;

  v_dest_type := coalesce(nullif(v_dest ->> 'type', ''), 'detail_page');
  if v_dest_type not in ('detail_page', 'business', 'market_listing', 'real_estate', 'vehicle', 'job', 'ride',
                         'post', 'category', 'external_url', 'phone', 'map_location') then
    raise exception 'ad_destination_invalid' using errcode = '22023';
  end if;
  v_url := nullif(btrim(coalesce(v_dest ->> 'url', '')), '');
  if v_dest_type = 'external_url' and public.ad_url_check(v_url) is not null then
    raise exception 'ad_url_invalid' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_existing from public.ad_campaigns where id = p_id for update;
    if not found then
      raise exception 'ad_campaign_not_found' using errcode = 'P0002';
    end if;
    if v_existing.status in ('expired', 'archived') then
      raise exception 'ad_campaign_locked' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    insert into public.ad_campaigns (advertiser_id, name, campaign_type, policy_category, priority, starts_at, ends_at,
      daily_impression_cap, total_impression_cap, per_user_daily_cap, budget_cents, cpm_cents,
      target_districts, platforms, status, created_by, updated_by)
    values (v_adv, v_name, v_type, v_policy,
      greatest(1, least(10, coalesce((p_payload ->> 'priority')::int, 5))), v_start, v_end,
      nullif((p_payload ->> 'daily_impression_cap')::int, 0), nullif((p_payload ->> 'total_impression_cap')::int, 0),
      public.ad_rule_clamp('per_user_daily_cap', (p_payload ->> 'per_user_daily_cap')::int),
      nullif((p_payload ->> 'budget_cents')::bigint, 0), nullif((p_payload ->> 'cpm_cents')::int, 0),
      v_districts, v_platforms, 'draft', v_admin, v_admin)
    returning id into v_id;
    v_status := 'draft';
  else
    -- Onaylı bir kampanyanın içeriği onay yetkisi olmayan biri tarafından
    -- değiştirilirse yeniden incelemeye düşer: onaysız içerik yayına çıkmaz.
    v_status := case
      when v_existing.status in ('scheduled', 'active', 'paused') and not public.has_permission('ads.approve')
        then 'pending_review'
      else v_existing.status end;
    update public.ad_campaigns set
      advertiser_id = v_adv, name = v_name, campaign_type = v_type, policy_category = v_policy,
      priority = greatest(1, least(10, coalesce((p_payload ->> 'priority')::int, priority))),
      starts_at = v_start, ends_at = v_end,
      daily_impression_cap = nullif((p_payload ->> 'daily_impression_cap')::int, 0),
      total_impression_cap = nullif((p_payload ->> 'total_impression_cap')::int, 0),
      per_user_daily_cap = public.ad_rule_clamp('per_user_daily_cap', (p_payload ->> 'per_user_daily_cap')::int),
      budget_cents = nullif((p_payload ->> 'budget_cents')::bigint, 0),
      cpm_cents = nullif((p_payload ->> 'cpm_cents')::int, 0),
      target_districts = v_districts, platforms = v_platforms,
      status = v_status,
      status_changed_at = case when v_status <> v_existing.status then now() else status_changed_at end,
      updated_by = v_admin, updated_at = now()
    where id = v_id;
  end if;

  insert into public.ad_creatives (campaign_id, title, description, cta_label, business_name, image_url,
                                   mobile_image_url, web_image_url, video_url, image_focus, updated_at)
  values (v_id, left(btrim(coalesce(v_cr ->> 'title', '')), 120),
    left(nullif(btrim(coalesce(v_cr ->> 'description', '')), ''), 200),
    left(coalesce(nullif(btrim(coalesce(v_cr ->> 'cta_label', '')), ''), 'İncele'), 24),
    left(nullif(btrim(coalesce(v_cr ->> 'business_name', '')), ''), 60),
    nullif(btrim(coalesce(v_cr ->> 'image_url', '')), ''),
    nullif(btrim(coalesce(v_cr ->> 'mobile_image_url', '')), ''),
    nullif(btrim(coalesce(v_cr ->> 'web_image_url', '')), ''),
    nullif(btrim(coalesce(v_cr ->> 'video_url', '')), ''),
    case when v_cr ->> 'image_focus' in ('left', 'center', 'right') then v_cr ->> 'image_focus' else 'center' end,
    now())
  on conflict (campaign_id) do update set
    title = excluded.title, description = excluded.description, cta_label = excluded.cta_label,
    business_name = excluded.business_name, image_url = excluded.image_url,
    mobile_image_url = excluded.mobile_image_url, web_image_url = excluded.web_image_url,
    video_url = excluded.video_url, image_focus = excluded.image_focus, updated_at = now();

  insert into public.ad_target_destinations (campaign_id, type, target_id, url, phone, lat, lng, label)
  values (v_id, v_dest_type, nullif(btrim(coalesce(v_dest ->> 'target_id', '')), ''), v_url,
    nullif(regexp_replace(coalesce(v_dest ->> 'phone', ''), '[^0-9+]', '', 'g'), ''),
    (v_dest ->> 'lat')::double precision, (v_dest ->> 'lng')::double precision,
    left(nullif(btrim(coalesce(v_dest ->> 'label', '')), ''), 80))
  on conflict (campaign_id) do update set
    type = excluded.type, target_id = excluded.target_id, url = excluded.url, phone = excluded.phone,
    lat = excluded.lat, lng = excluded.lng, label = excluded.label, checked_at = null;

  update public.ad_target_destinations
  set is_valid = public.ad_destination_check(v_id) is null,
      invalid_reason = public.ad_destination_check(v_id), checked_at = now()
  where campaign_id = v_id;

  if v_detail is not null and jsonb_typeof(v_detail) = 'object' then
    select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into v_gallery
    from jsonb_array_elements_text(coalesce(v_detail -> 'gallery', '[]'::jsonb)) x;
    if exists (select 1 from unnest(v_gallery) g where not public.ad_media_url_ok(g)) or cardinality(v_gallery) > 12 then
      raise exception 'ad_media_url_invalid' using errcode = '22023';
    end if;
    select coalesce(array_agg(left(btrim(x), 120)) filter (where btrim(x) <> ''), '{}') into v_features
    from jsonb_array_elements_text(coalesce(v_detail -> 'features', '[]'::jsonb)) x;
    if nullif(btrim(coalesce(v_detail ->> 'website', '')), '') is not null
       and public.ad_url_check(btrim(v_detail ->> 'website')) is not null then
      raise exception 'ad_url_invalid' using errcode = '22023';
    end if;

    insert into public.ad_detail_pages (campaign_id, enabled, headline, cover_url, gallery, video_url, body, features,
      price_text, offer_text, address, lat, lng, phone, email, website, valid_until, place_id, listing_type, listing_id, updated_at)
    values (v_id, coalesce((v_detail ->> 'enabled')::boolean, true),
      left(nullif(btrim(coalesce(v_detail ->> 'headline', '')), ''), 140),
      nullif(btrim(coalesce(v_detail ->> 'cover_url', '')), ''), v_gallery,
      nullif(btrim(coalesce(v_detail ->> 'video_url', '')), ''),
      left(nullif(btrim(coalesce(v_detail ->> 'body', '')), ''), 5000), v_features[1:20],
      left(nullif(btrim(coalesce(v_detail ->> 'price_text', '')), ''), 80),
      left(nullif(btrim(coalesce(v_detail ->> 'offer_text', '')), ''), 200),
      left(nullif(btrim(coalesce(v_detail ->> 'address', '')), ''), 240),
      (v_detail ->> 'lat')::double precision, (v_detail ->> 'lng')::double precision,
      nullif(regexp_replace(coalesce(v_detail ->> 'phone', ''), '[^0-9+]', '', 'g'), ''),
      nullif(btrim(coalesce(v_detail ->> 'email', '')), ''),
      nullif(btrim(coalesce(v_detail ->> 'website', '')), ''),
      (v_detail ->> 'valid_until')::timestamptz,
      case when public.ad_is_uuid(v_detail ->> 'place_id') then (v_detail ->> 'place_id')::uuid end,
      case when v_detail ->> 'listing_type' in ('market_listing', 'real_estate') and public.ad_is_uuid(v_detail ->> 'listing_id')
           then v_detail ->> 'listing_type' end,
      case when v_detail ->> 'listing_type' in ('market_listing', 'real_estate') and public.ad_is_uuid(v_detail ->> 'listing_id')
           then (v_detail ->> 'listing_id')::uuid end,
      now())
    on conflict (campaign_id) do update set
      enabled = excluded.enabled, headline = excluded.headline, cover_url = excluded.cover_url,
      gallery = excluded.gallery, video_url = excluded.video_url, body = excluded.body,
      features = excluded.features, price_text = excluded.price_text, offer_text = excluded.offer_text,
      address = excluded.address, lat = excluded.lat, lng = excluded.lng, phone = excluded.phone,
      email = excluded.email, website = excluded.website, valid_until = excluded.valid_until,
      place_id = excluded.place_id, listing_type = excluded.listing_type, listing_id = excluded.listing_id,
      updated_at = now();
    update public.ad_target_destinations
    set is_valid = public.ad_destination_check(v_id) is null,
        invalid_reason = public.ad_destination_check(v_id), checked_at = now()
    where campaign_id = v_id;
  end if;

  delete from public.ad_campaign_placements where campaign_id = v_id and not (placement_key = any(v_placements));
  insert into public.ad_campaign_placements (campaign_id, placement_key)
  select v_id, k from unnest(v_placements) k
  on conflict do nothing;

  perform public.tz_admin_audit(case when p_id is null then 'ads.campaign.create' else 'ads.campaign.update' end,
    case when p_id is null then 'Reklam kampanyası oluşturuldu' else 'Reklam kampanyası güncellendi' end,
    'ad_campaign', v_id::text,
    jsonb_build_object('name', v_name, 'status', v_status,
                       'from', case when p_id is not null then v_existing.status end,
                       'reason', nullif(btrim(coalesce(p_reason, '')), '')), 'success');

  return public.admin_ads_campaign_get(v_id);
end;
$$;

create or replace function public.admin_ads_campaign_transition(p_id uuid, p_action text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.ad_campaigns%rowtype;
  v_to text;
  v_issues text[];
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_action in ('approve', 'reject') then
    perform public.tz_admin_require('ads.approve');
  else
    perform public.tz_admin_require('ads.manage');
  end if;

  select * into c from public.ad_campaigns where id = p_id for update;
  if not found then
    raise exception 'ad_campaign_not_found' using errcode = 'P0002';
  end if;

  if p_action = 'submit' then
    if c.status not in ('draft', 'rejected') then
      raise exception 'ad_transition_invalid' using errcode = '22023';
    end if;
    v_issues := public.ad_campaign_issues(p_id);
    if cardinality(v_issues) > 0 then
      raise exception 'ad_campaign_incomplete: %', array_to_string(v_issues, ',') using errcode = '22023';
    end if;
    v_to := 'pending_review';
  elsif p_action = 'approve' then
    if c.status <> 'pending_review' then
      raise exception 'ad_transition_invalid' using errcode = '22023';
    end if;
    v_issues := public.ad_campaign_issues(p_id);
    if cardinality(v_issues) > 0 then
      raise exception 'ad_campaign_incomplete: %', array_to_string(v_issues, ',') using errcode = '22023';
    end if;
    if c.policy_category in ('health_service', 'finance') and (v_reason is null or length(v_reason) < 10) then
      raise exception 'ad_review_note_required' using errcode = '22023';
    end if;
    v_to := case when c.starts_at <= now() then 'active' else 'scheduled' end;
  elsif p_action = 'reject' then
    if c.status <> 'pending_review' then
      raise exception 'ad_transition_invalid' using errcode = '22023';
    end if;
    if v_reason is null or length(v_reason) < 3 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    v_to := 'rejected';
  elsif p_action = 'pause' then
    if c.status not in ('scheduled', 'active') then
      raise exception 'ad_transition_invalid' using errcode = '22023';
    end if;
    v_to := 'paused';
  elsif p_action = 'resume' then
    if c.status <> 'paused' then
      raise exception 'ad_transition_invalid' using errcode = '22023';
    end if;
    if c.ends_at <= now() then
      v_to := 'expired';
    else
      v_issues := public.ad_campaign_issues(p_id);
      if cardinality(v_issues) > 0 then
        raise exception 'ad_campaign_incomplete: %', array_to_string(v_issues, ',') using errcode = '22023';
      end if;
      v_to := case when c.starts_at <= now() then 'active' else 'scheduled' end;
    end if;
  elsif p_action = 'archive' then
    if c.status in ('active', 'scheduled', 'archived') then
      raise exception 'ad_transition_invalid' using errcode = '22023';
    end if;
    v_to := 'archived';
  elsif p_action = 'to_draft' then
    if c.status not in ('rejected', 'pending_review') then
      raise exception 'ad_transition_invalid' using errcode = '22023';
    end if;
    v_to := 'draft';
  else
    raise exception 'ad_transition_invalid' using errcode = '22023';
  end if;

  update public.ad_campaigns set
    status = v_to,
    status_changed_at = now(),
    updated_at = now(),
    updated_by = auth.uid(),
    submitted_at = case when p_action = 'submit' then now() else submitted_at end,
    reviewed_by = case when p_action in ('approve', 'reject') then auth.uid() else reviewed_by end,
    reviewed_at = case when p_action in ('approve', 'reject') then now() else reviewed_at end,
    review_note = case when p_action = 'approve' then v_reason else review_note end,
    rejection_reason = case when p_action = 'reject' then v_reason when p_action = 'approve' then null else rejection_reason end,
    paused_at = case when p_action = 'pause' then now() else paused_at end
  where id = p_id;

  perform public.tz_admin_audit('ads.campaign.' || p_action,
    case p_action
      when 'submit' then 'Kampanya incelemeye gönderildi'
      when 'approve' then 'Kampanya onaylandı'
      when 'reject' then 'Kampanya reddedildi'
      when 'pause' then 'Kampanya duraklatıldı'
      when 'resume' then 'Kampanya yeniden başlatıldı'
      when 'archive' then 'Kampanya arşivlendi'
      else 'Kampanya taslağa alındı' end,
    'ad_campaign', p_id::text,
    jsonb_build_object('from', c.status, 'to', v_to, 'reason', v_reason), 'success');

  if v_to = 'expired' then
    perform public.ad_report_generate_internal(p_id, 'campaign_end', auth.uid());
  end if;

  return public.admin_ads_campaign_get(p_id);
end;
$$;

create or replace function public.admin_ads_report_generate(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.tz_admin_require('ads.view');
  v_id := public.ad_report_generate_internal(p_campaign_id, 'manual', auth.uid());
  if v_id is null then
    raise exception 'ad_campaign_not_found' using errcode = 'P0002';
  end if;
  perform public.tz_admin_audit('ads.report.generate', 'Reklamveren raporu oluşturuldu', 'ad_campaign',
    p_campaign_id::text, jsonb_build_object('report_id', v_id), 'success');
  return (select to_jsonb(r) from public.ad_advertiser_reports r where r.id = v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 19. Yönetici: analitik
-- ---------------------------------------------------------------------------
create or replace function public.admin_ads_campaign_analytics(p_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days int := greatest(7, least(coalesce(p_days, 30), 365));
  v_today date := public.ad_today();
begin
  perform public.tz_admin_require('ads.view');
  if not exists (select 1 from public.ad_campaigns where id = p_id) then
    raise exception 'ad_campaign_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'totals', public.ad_campaign_metrics(p_id),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', g.day, 'impressions', coalesce(ds.impressions, 0), 'clicks', coalesce(ds.clicks, 0),
        'reach', (select count(distinct i.user_id) from public.ad_impressions i where i.campaign_id = p_id and i.day = g.day))
        order by g.day)
      from (select (v_today - n) as day from generate_series(0, v_days - 1) n) as g
      left join public.ad_campaign_daily_stats ds on ds.campaign_id = p_id and ds.day = g.day), '[]'::jsonb),
    'weekly', coalesce((
      select jsonb_agg(jsonb_build_object('week', w, 'impressions', imp, 'clicks', clk) order by w)
      from (select date_trunc('week', day)::date w, sum(impressions) imp, sum(clicks) clk
            from public.ad_campaign_daily_stats where campaign_id = p_id group by 1) x), '[]'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'impressions', imp, 'clicks', clk) order by m)
      from (select date_trunc('month', day)::date m, sum(impressions) imp, sum(clicks) clk
            from public.ad_campaign_daily_stats where campaign_id = p_id group by 1) x), '[]'::jsonb),
    'by_placement', coalesce((
      select jsonb_agg(jsonb_build_object('placement', i.placement_key, 'label', p.label_tr, 'impressions', i.n,
        'clicks', (select count(*) from public.ad_clicks k where k.campaign_id = p_id and k.placement_key = i.placement_key)) order by i.n desc)
      from (select placement_key, count(*) n from public.ad_impressions where campaign_id = p_id group by 1) i
      left join public.ad_placements p on p.key = i.placement_key), '[]'::jsonb),
    'by_district', coalesce((
      select jsonb_agg(jsonb_build_object('district', d, 'impressions', n) order by n desc)
      from (select coalesce(district, 'Belirtilmemiş') d, count(*) n from public.ad_impressions
            where campaign_id = p_id group by 1) x), '[]'::jsonb),
    'by_platform', coalesce((
      select jsonb_agg(jsonb_build_object('platform', platform, 'impressions', n) order by n desc)
      from (select platform, count(*) n from public.ad_impressions where campaign_id = p_id group by 1) x), '[]'::jsonb),
    'invalid_by_reason', coalesce((
      select jsonb_agg(jsonb_build_object('kind', kind, 'reason', reason, 'count', n) order by n desc)
      from (select kind, reason, count(*) n from public.ad_invalid_events where campaign_id = p_id group by 1, 2) x), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.generated_at desc)
      from (select * from public.ad_advertiser_reports where campaign_id = p_id order by generated_at desc limit 10) r), '[]'::jsonb));
end;
$$;

create or replace function public.admin_ads_analytics(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days int := greatest(7, least(coalesce(p_days, 30), 365));
  v_today date := public.ad_today();
  v_from date := public.ad_today() - (greatest(7, least(coalesce(p_days, 30), 365)) - 1);
begin
  perform public.tz_admin_require('ads.view');
  return jsonb_build_object(
    'days', v_days,
    'totals', jsonb_build_object(
      'impressions', (select coalesce(sum(impressions), 0) from public.ad_campaign_daily_stats where day >= v_from),
      'clicks', (select coalesce(sum(clicks), 0) from public.ad_campaign_daily_stats where day >= v_from),
      'reach', (select count(distinct user_id) from public.ad_impressions where day >= v_from),
      'spend_cents', (select coalesce(round(sum(spend_cents)), 0) from public.ad_campaign_daily_stats where day >= v_from),
      'invalid_events', (select count(*) from public.ad_invalid_events where created_at >= v_from)),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', g.day,
        'impressions', coalesce((select sum(impressions) from public.ad_campaign_daily_stats where day = g.day), 0),
        'clicks', coalesce((select sum(clicks) from public.ad_campaign_daily_stats where day = g.day), 0))
        order by g.day)
      from (select (v_today - n) as day from generate_series(0, v_days - 1) n) g), '[]'::jsonb),
    'by_placement', coalesce((
      select jsonb_agg(jsonb_build_object('placement', p.key, 'label', p.label_tr, 'enabled', p.enabled,
        'impressions', (select count(*) from public.ad_impressions i where i.placement_key = p.key and i.day >= v_from),
        'clicks', (select count(*) from public.ad_clicks k where k.placement_key = p.key and k.day >= v_from))
        order by p.sort_order)
      from public.ad_placements p), '[]'::jsonb),
    'by_district', coalesce((
      select jsonb_agg(jsonb_build_object('district', d, 'impressions', n) order by n desc)
      from (select coalesce(district, 'Belirtilmemiş') d, count(*) n from public.ad_impressions
            where day >= v_from group by 1) x), '[]'::jsonb),
    'top_campaigns', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status,
        'impressions', x.imp, 'clicks', x.clk,
        'ctr', case when x.imp > 0 then round(x.clk::numeric * 100 / x.imp, 2) else 0 end) order by x.imp desc)
      from (select campaign_id, sum(impressions) imp, sum(clicks) clk from public.ad_campaign_daily_stats
            where day >= v_from group by 1 order by 2 desc limit 10) x
      join public.ad_campaigns c on c.id = x.campaign_id), '[]'::jsonb));
end;
$$;

create or replace function public.admin_ads_targeting_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.tz_admin_require('ads.view');
  return jsonb_build_object(
    'profile_districts', coalesce((
      select jsonb_agg(jsonb_build_object('district', district, 'users', n) order by n desc)
      from (select btrim(district) district, count(*) n from public.profiles
            where nullif(btrim(district), '') is not null group by 1) x), '[]'::jsonb),
    'users_without_district', (select count(*) from public.profiles where nullif(btrim(coalesce(district, '')), '') is null),
    'campaign_targets', coalesce((
      select jsonb_agg(jsonb_build_object('district', d, 'campaigns', n) order by n desc)
      from (select t d, count(*) n from public.ad_campaigns c, unnest(c.target_districts) t
            where c.status in ('pending_review', 'scheduled', 'active', 'paused') group by 1) x), '[]'::jsonb),
    'untargeted_campaigns', (select count(*) from public.ad_campaigns
                             where cardinality(target_districts) = 0 and status in ('scheduled', 'active', 'paused')),
    'impressions_by_district_30d', coalesce((
      select jsonb_agg(jsonb_build_object('district', d, 'impressions', n) order by n desc)
      from (select coalesce(district, 'Belirtilmemiş') d, count(*) n from public.ad_impressions
            where day > public.ad_today() - 30 group by 1) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 20. Yönetici: medya kütüphanesi ve denetim kayıtları
-- ---------------------------------------------------------------------------
create or replace function public.admin_ads_media_list(p_variant text default null, p_limit integer default 60, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.tz_admin_require('ads.view');
  return jsonb_build_object(
    'total', (select count(*) from public.ad_media_assets where archived_at is null and (p_variant is null or variant = p_variant)),
    'items', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at desc)
      from (select * from public.ad_media_assets
            where archived_at is null and (p_variant is null or variant = p_variant)
            order by created_at desc
            limit greatest(1, least(coalesce(p_limit, 60), 200)) offset greatest(0, coalesce(p_offset, 0))) m), '[]'::jsonb));
end;
$$;

create or replace function public.admin_ads_media_register(
  p_url text, p_storage_path text, p_media_type text, p_variant text,
  p_width integer default null, p_height integer default null, p_size bigint default null, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.tz_admin_require('ads.manage');
  if not public.ad_media_url_ok(p_url) or p_url is null then
    raise exception 'ad_media_url_invalid' using errcode = '22023';
  end if;
  insert into public.ad_media_assets (url, storage_path, media_type, variant, width, height, size_bytes, label, uploaded_by)
  values (p_url, nullif(p_storage_path, ''),
    case when p_media_type = 'video' then 'video' else 'image' end,
    case when p_variant in ('banner', 'mobile', 'web', 'cover', 'gallery', 'video') then p_variant else 'banner' end,
    p_width, p_height, p_size, left(nullif(btrim(coalesce(p_label, '')), ''), 120), auth.uid())
  returning id into v_id;
  perform public.tz_admin_audit('ads.media.upload', 'Reklam medyası eklendi', 'ad_media', v_id::text,
    jsonb_build_object('variant', p_variant, 'width', p_width, 'height', p_height), 'success');
  return (select to_jsonb(m) from public.ad_media_assets m where m.id = v_id);
end;
$$;

create or replace function public.admin_ads_media_archive(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.tz_admin_require('ads.manage');
  update public.ad_media_assets set archived_at = now() where id = p_id and archived_at is null;
  if not found then
    raise exception 'ad_media_not_found' using errcode = 'P0002';
  end if;
  perform public.tz_admin_audit('ads.media.archive', 'Reklam medyası arşivlendi', 'ad_media', p_id::text, '{}'::jsonb, 'success');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_ads_audit(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.tz_admin_require('ads.view');
  return jsonb_build_object(
    'total', (select count(*) from public.admin_audit_logs where action_code like 'ads.%'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'action', l.action_code, 'label', l.action_label_tr, 'target_type', l.target_type,
        'target_id', l.target_id, 'outcome', l.outcome, 'meta', l.metadata_safe, 'created_at', l.created_at,
        'actor', coalesce(pr.username, case when l.actor_admin_id is null then 'sistem' end),
        'campaign_name', (select c.name from public.ad_campaigns c
                          where l.target_type = 'ad_campaign' and public.ad_is_uuid(l.target_id) and c.id = l.target_id::uuid))
        order by l.created_at desc)
      from (select * from public.admin_audit_logs where action_code like 'ads.%'
            order by created_at desc
            limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) l
      left join public.profiles pr on pr.id = l.actor_admin_id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 21. Reklamveren paneli (yalnızca kendi kampanyaları)
-- ---------------------------------------------------------------------------
create or replace function public.ad_advertiser_my_campaigns()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'advertiser_id', a.id, 'advertiser_name', a.name,
      'campaigns', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'status', c.status, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
          'metrics', public.ad_campaign_metrics(c.id)) order by c.starts_at desc)
        from public.ad_campaigns c where c.advertiser_id = a.id and c.status <> 'archived'), '[]'::jsonb)))
    from public.ad_advertisers a
    join public.ad_advertiser_members m on m.advertiser_id = a.id and m.user_id = v_uid), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 22. Yetkiler
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  -- İç yardımcılar: yalnızca diğer definer fonksiyonlar çağırır.
  foreach f in array array[
    'public.ad_rule_clamp(text, integer)',
    'public.ad_url_check(text)',
    'public.ad_destination_check(uuid)',
    'public.ad_destination_json(uuid)',
    'public.ad_log_invalid(text, text, uuid, uuid, uuid)',
    'public.ad_system_audit(text, text, text, jsonb)',
    'public.ad_campaign_metrics(uuid)',
    'public.ad_report_generate_internal(uuid, text, uuid)',
    'public.ad_impression_internal(uuid, uuid, integer)',
    'public.ads_sync_campaign_statuses()',
    'public.ad_campaign_issues(uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'public.ad_serve(text, text, text, integer, text, uuid[], uuid)',
    'public.ad_record_impression(uuid, integer)',
    'public.ad_record_click(uuid)',
    'public.ad_feedback(uuid, text, text, text)',
    'public.ad_detail_get(uuid)',
    'public.ad_advertiser_my_campaigns()',
    'public.admin_ads_overview()',
    'public.admin_ads_settings_get()',
    'public.admin_ads_global_set(boolean, text)',
    'public.admin_ads_settings_update(jsonb, text)',
    'public.admin_ads_rule_update(text, integer, integer, integer, text)',
    'public.admin_ads_placements_list()',
    'public.admin_ads_placement_update(text, jsonb, text)',
    'public.admin_ads_advertisers_list(text, integer, integer)',
    'public.admin_ads_advertiser_save(uuid, jsonb, text)',
    'public.admin_ads_advertiser_member_set(uuid, text, boolean, text)',
    'public.admin_ads_campaigns_list(text, text, integer, integer)',
    'public.admin_ads_campaign_get(uuid)',
    'public.admin_ads_campaign_save(uuid, jsonb, text)',
    'public.admin_ads_campaign_transition(uuid, text, text)',
    'public.admin_ads_report_generate(uuid)',
    'public.admin_ads_campaign_analytics(uuid, integer)',
    'public.admin_ads_analytics(integer)',
    'public.admin_ads_targeting_overview()',
    'public.admin_ads_media_list(text, integer, integer)',
    'public.admin_ads_media_register(text, text, text, text, integer, integer, bigint, text)',
    'public.admin_ads_media_archive(uuid)',
    'public.admin_ads_audit(integer, integer)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ad_is_advertiser_member RLS politikalarında kullanılır.
revoke all on function public.ad_is_advertiser_member(uuid) from public, anon;
grant execute on function public.ad_is_advertiser_member(uuid) to authenticated;
