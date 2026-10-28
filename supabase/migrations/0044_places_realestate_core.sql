-- =====================================================================
-- 0044 — Trabzone Keşif: coğrafya, işletmeler ve emlak çekirdeği
--
-- Tasarım ilkeleri:
--   * Tablolara istemciden doğrudan erişim YOKTUR. Bütün okuma/yazma
--     security-definer RPC'lerden geçer.
--   * İşletme verisi yalnızca gerçek kaynaklardan gelir: Trabzone admin,
--     doğrulanmış işletme sahibi, kullanıcı önerisi (moderasyonlu) veya
--     lisanslı harita sağlayıcısı referansı. Sahte kayıt üretilmez.
--   * Emlak ilanları EİDS doğrulaması olmadan yayınlanamaz. Yayın kapısı
--     sunucudadır; istemciye bırakılmaz.
--   * Konut ilanlarının kesin koordinatı herkese açık sonuçlarda
--     yaklaşıklaştırılır.
--   * Coğrafi sorgular PostGIS + GiST indeksleriyle çalışır.
-- =====================================================================

set search_path = public, extensions;

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Coğrafya
-- ---------------------------------------------------------------------
create table if not exists public.cities (
  id           uuid primary key default gen_random_uuid(),
  plate_code   integer not null unique,
  name         text not null,
  slug         text not null unique,
  country_code text not null default 'TR',
  timezone     text not null default 'Europe/Istanbul',
  center_lat   double precision,
  center_lng   double precision,
  is_active    boolean not null default false,
  data_source  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint cities_plate_check check (plate_code between 1 and 81),
  constraint cities_name_check check (char_length(name) between 2 and 80),
  constraint cities_center_check check (
    center_lat is null or (center_lat between -90 and 90)
  )
);

comment on table public.cities is
  'Hizmet verilen iller. Yeni şehir admin panelinden etkinleştirilir; ilk aşama Trabzon.';

create table if not exists public.districts (
  id            bigint primary key,
  city_id       uuid not null references public.cities (id) on delete cascade,
  name          text not null,
  slug          text not null,
  population    integer,
  area_km2      numeric(10, 2),
  center_lat    double precision,
  center_lng    double precision,
  geocode_label text,
  data_source   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint districts_name_check check (char_length(name) between 2 and 80),
  unique (city_id, slug)
);

create index if not exists districts_city_idx on public.districts (city_id, name);

create table if not exists public.neighborhoods (
  id          bigint primary key,
  district_id bigint not null references public.districts (id) on delete cascade,
  name        text not null,
  slug        text not null,
  population  integer,
  center_lat  double precision,
  center_lng  double precision,
  data_source text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint neighborhoods_name_check check (char_length(name) between 1 and 100),
  unique (district_id, slug)
);

comment on table public.neighborhoods is
  'Mahalleler. Koordinat bilinmiyorsa center_lat/lng null kalır; uydurulmaz.';

create index if not exists neighborhoods_district_idx
  on public.neighborhoods (district_id, name);

create table if not exists public.service_regions (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null unique references public.cities (id) on delete cascade,
  name         text not null,
  is_active    boolean not null default false,
  launch_phase text not null default 'phase_1',
  min_lat      double precision,
  max_lat      double precision,
  min_lng      double precision,
  max_lng      double precision,
  boundary     geography(MultiPolygon, 4326),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.service_regions is
  'Hizmet bölgesi sınırı. Gerçek mülki sınır verisi yoksa boundary null bırakılır; kaba hizmet kutusu kullanılır.';

-- Bütün hizmet noktası kontrolleri bu kutuya göre yapılır. Trabzon il
-- sınırlarının dışına taşan kayıtlar sunucuda reddedilir.
create or replace function public.tz_in_trabzon_bbox(
  p_lat double precision,
  p_lng double precision
)
returns boolean
language sql
immutable
as $$
  select p_lat is not null and p_lng is not null
     and p_lat between 40.55 and 41.25
     and p_lng between 38.90 and 40.70;
$$;

comment on function public.tz_in_trabzon_bbox(double precision, double precision) is
  'Trabzon hizmet kutusu. İl sınırı değil, sunucu tarafı güvenlik filtresidir.';

-- ---------------------------------------------------------------------
-- 2. İşletme kategorileri (admin panelinden yönetilir)
-- ---------------------------------------------------------------------
create table if not exists public.place_categories (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references public.place_categories (id) on delete restrict,
  slug       text not null unique,
  name       text not null,
  icon       text not null default 'storefront-outline',
  tone       text not null default 'primary',
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_categories_slug_check check (slug ~ '^[a-z0-9-]{2,48}$'),
  constraint place_categories_name_check check (char_length(name) between 2 and 60),
  constraint place_categories_tone_check check (
    tone in ('primary', 'accent', 'success', 'warning', 'danger', 'info')
  )
);

create index if not exists place_categories_parent_idx
  on public.place_categories (parent_id, sort_order);

-- ---------------------------------------------------------------------
-- 3. İşletmeler
-- ---------------------------------------------------------------------
create table if not exists public.places (
  id                    uuid primary key default gen_random_uuid(),
  created_by            uuid references public.profiles (id) on delete set null,
  owner_id              uuid references public.profiles (id) on delete set null,
  name                  text not null,
  slug                  text,
  description           text,
  category_id           uuid references public.place_categories (id) on delete set null,
  city_id               uuid not null references public.cities (id) on delete restrict,
  district_id           bigint not null references public.districts (id) on delete restrict,
  neighborhood_id       bigint references public.neighborhoods (id) on delete set null,
  address               text,
  address_public        boolean not null default true,
  lat                   double precision not null,
  lng                   double precision not null,
  geog                  geography(Point, 4326),
  phone                 text,
  website               text,
  cover_path            text,
  opening_hours         jsonb not null default '{}'::jsonb,
  price_level           smallint,
  status                text not null default 'pending',
  verification_status   text not null default 'unverified',
  is_verified           boolean not null default false,
  verified_at           timestamptz,
  verified_by           uuid references public.profiles (id) on delete set null,
  data_source           text not null default 'trabzone_user',
  external_provider     text,
  external_id           text,
  rating_avg            numeric(3, 2),
  rating_count          integer not null default 0,
  review_count          integer not null default 0,
  photo_count           integer not null default 0,
  video_count           integer not null default 0,
  favorite_count        integer not null default 0,
  view_count            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint places_name_check check (char_length(name) between 2 and 140),
  constraint places_desc_check check (description is null or char_length(description) <= 4000),
  constraint places_address_check check (address is null or char_length(address) <= 400),
  constraint places_phone_check check (phone is null or char_length(phone) between 7 and 30),
  constraint places_website_check check (website is null or website ~ '^https?://[^\s]+$'),
  constraint places_lat_check check (lat between 40.55 and 41.25),
  constraint places_lng_check check (lng between 38.90 and 40.70),
  constraint places_status_check check (
    status in ('draft', 'pending', 'published', 'rejected', 'archived', 'duplicate')
  ),
  constraint places_verification_check check (
    verification_status in ('unverified', 'pending', 'verified', 'rejected')
  ),
  constraint places_source_check check (
    data_source in ('trabzone_admin', 'business_owner', 'trabzone_user', 'external_reference')
  ),
  constraint places_price_level_check check (price_level is null or price_level between 1 and 4),
  constraint places_counts_check check (
    rating_count >= 0 and review_count >= 0 and photo_count >= 0
    and video_count >= 0 and favorite_count >= 0 and view_count >= 0
  ),
  constraint places_verified_consistency check (
    is_verified = (verification_status = 'verified')
  )
);

create index if not exists places_geog_idx on public.places using gist (geog);
create index if not exists places_district_idx on public.places (district_id, status);
create index if not exists places_category_idx on public.places (category_id, status);
create index if not exists places_status_idx on public.places (status, created_at desc);
create index if not exists places_name_lower_idx on public.places (lower(name));
create unique index if not exists places_external_key
  on public.places (external_provider, external_id)
  where external_provider is not null and external_id is not null;

create table if not exists public.place_category_relations (
  place_id    uuid not null references public.places (id) on delete cascade,
  category_id uuid not null references public.place_categories (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (place_id, category_id)
);

create table if not exists public.place_external_references (
  id                uuid primary key default gen_random_uuid(),
  place_id          uuid not null references public.places (id) on delete cascade,
  provider          text not null,
  external_id       text not null,
  attribution_text  text,
  license_note      text,
  metadata          jsonb not null default '{}'::jsonb,
  raw_content_saved boolean not null default false,
  fetched_at        timestamptz not null default now(),
  unique (place_id, provider, external_id)
);

comment on table public.place_external_references is
  'Harita sağlayıcısı referansları. Sağlayıcı içeriği izinsiz kopyalanmaz; yalnızca kimlik/atıf saklanır.';

create table if not exists public.place_media (
  id              uuid primary key default gen_random_uuid(),
  place_id        uuid not null references public.places (id) on delete cascade,
  uploader_id     uuid not null references public.profiles (id) on delete cascade,
  kind            text not null,
  storage_path    text,
  thumb_path      text,
  reel_id         uuid references public.reels (id) on delete set null,
  caption         text,
  width           integer,
  height          integer,
  duration_ms     integer,
  sort_order      smallint not null default 0,
  status          text not null default 'pending',
  moderation_note text,
  moderated_by    uuid references public.profiles (id) on delete set null,
  moderated_at    timestamptz,
  created_at      timestamptz not null default now(),
  constraint place_media_kind_check check (kind in ('image', 'video')),
  constraint place_media_source_check check (storage_path is not null or reel_id is not null),
  constraint place_media_path_check check (storage_path is null or char_length(storage_path) between 3 and 400),
  constraint place_media_caption_check check (caption is null or char_length(caption) <= 300),
  constraint place_media_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint place_media_sort_check check (sort_order between 0 and 99)
);

create index if not exists place_media_place_idx
  on public.place_media (place_id, status, sort_order);
create index if not exists place_media_uploader_idx
  on public.place_media (uploader_id, created_at desc);

create table if not exists public.place_reviews (
  id            uuid primary key default gen_random_uuid(),
  place_id      uuid not null references public.places (id) on delete cascade,
  author_id     uuid not null references public.profiles (id) on delete cascade,
  rating        smallint not null,
  body          text,
  status        text not null default 'visible',
  helpful_count integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint place_reviews_rating_check check (rating between 1 and 5),
  constraint place_reviews_body_check check (body is null or char_length(body) <= 3000),
  constraint place_reviews_status_check check (status in ('visible', 'hidden', 'removed')),
  constraint place_reviews_helpful_check check (helpful_count >= 0),
  -- Kullanıcı başına işletme başına tek aktif ana puanlama kaydı.
  unique (place_id, author_id)
);

create index if not exists place_reviews_place_idx
  on public.place_reviews (place_id, status, created_at desc);
create index if not exists place_reviews_author_idx
  on public.place_reviews (author_id, created_at desc);

create table if not exists public.place_review_media (
  id           uuid primary key default gen_random_uuid(),
  review_id    uuid not null references public.place_reviews (id) on delete cascade,
  uploader_id  uuid not null references public.profiles (id) on delete cascade,
  kind         text not null,
  storage_path text not null,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  constraint place_review_media_kind_check check (kind in ('image', 'video')),
  constraint place_review_media_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint place_review_media_path_check check (char_length(storage_path) between 3 and 400)
);

create index if not exists place_review_media_review_idx
  on public.place_review_media (review_id, status);

create table if not exists public.place_review_votes (
  review_id  uuid not null references public.place_reviews (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table if not exists public.place_owner_claims (
  id             uuid primary key default gen_random_uuid(),
  place_id       uuid not null references public.places (id) on delete cascade,
  applicant_id   uuid not null references public.profiles (id) on delete cascade,
  status         text not null default 'pending',
  evidence_type  text not null default 'document',
  evidence_text  text,
  document_path  text,
  contact_phone  text,
  contact_email  text,
  reviewed_by    uuid references public.profiles (id) on delete set null,
  review_note    text,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint place_claims_status_check check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  constraint place_claims_evidence_check check (evidence_type in ('document', 'tax_record', 'utility', 'other')),
  constraint place_claims_text_check check (evidence_text is null or char_length(evidence_text) <= 2000)
);

create unique index if not exists place_claims_one_pending
  on public.place_owner_claims (place_id, applicant_id)
  where status = 'pending';

create index if not exists place_claims_place_idx
  on public.place_owner_claims (place_id, status, created_at desc);

create table if not exists public.place_business_managers (
  place_id   uuid not null references public.places (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'owner',
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (place_id, user_id),
  constraint place_managers_role_check check (role in ('owner', 'manager'))
);

create index if not exists place_managers_user_idx
  on public.place_business_managers (user_id, role);

create table if not exists public.place_suggestions (
  id               uuid primary key default gen_random_uuid(),
  submitter_id     uuid not null references public.profiles (id) on delete cascade,
  payload          jsonb not null,
  status           text not null default 'pending',
  review_note      text,
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  created_place_id uuid references public.places (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint place_suggestions_status_check check (status in ('pending', 'approved', 'rejected', 'duplicate')),
  constraint place_suggestions_payload_check check (jsonb_typeof(payload) = 'object')
);

create index if not exists place_suggestions_status_idx
  on public.place_suggestions (status, created_at);

create table if not exists public.place_favorites (
  place_id   uuid not null references public.places (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (place_id, user_id)
);

create index if not exists place_favorites_user_idx
  on public.place_favorites (user_id, created_at desc);

-- Gönderi/Reels ↔ işletme bağı. Video ikinci kez yüklenmez; aynı depolama
-- yolu referans edilir. İçerik silinince bağ cascade ile kalkar.
create table if not exists public.place_content_links (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  reel_id    uuid references public.reels (id) on delete cascade,
  post_id    uuid references public.posts (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint place_content_single_target check (num_nonnulls(reel_id, post_id) = 1)
);

create unique index if not exists place_content_reel_key
  on public.place_content_links (place_id, reel_id)
  where reel_id is not null;
create unique index if not exists place_content_post_key
  on public.place_content_links (place_id, post_id)
  where post_id is not null;
create index if not exists place_content_place_idx
  on public.place_content_links (place_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4. Ortak şikâyet ve kaydedilen alanlar
-- ---------------------------------------------------------------------
create table if not exists public.content_reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references public.profiles (id) on delete cascade,
  target_type    text not null,
  target_id      uuid not null,
  reason         text not null,
  details        text,
  status         text not null default 'pending',
  moderated_by   uuid references public.profiles (id) on delete set null,
  moderation_note text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint content_reports_target_check check (
    target_type in ('place', 'place_media', 'place_review', 'real_estate_listing', 'real_estate_media')
  ),
  constraint content_reports_reason_check check (
    reason in ('spam', 'fake', 'inappropriate', 'wrong_location', 'fraud', 'other')
  ),
  constraint content_reports_status_check check (
    status in ('pending', 'reviewing', 'resolved', 'dismissed')
  ),
  constraint content_reports_details_check check (details is null or char_length(details) <= 2000)
);

create unique index if not exists content_reports_one_pending
  on public.content_reports (reporter_id, target_type, target_id)
  where status = 'pending';

create index if not exists content_reports_queue_idx
  on public.content_reports (status, created_at desc);

create table if not exists public.saved_search_areas (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  label          text not null,
  area_kind      text not null default 'map',
  boundary       geography(Polygon, 4326) not null,
  filters        jsonb not null default '{}'::jsonb,
  notify_enabled boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint saved_areas_kind_check check (area_kind in ('map', 'real_estate')),
  constraint saved_areas_label_check check (char_length(label) between 1 and 120),
  constraint saved_areas_filters_check check (jsonb_typeof(filters) = 'object')
);

create index if not exists saved_areas_user_idx
  on public.saved_search_areas (user_id, created_at desc);
create index if not exists saved_areas_boundary_idx
  on public.saved_search_areas using gist (boundary);

-- ---------------------------------------------------------------------
-- 5. Emlak kategorileri ve ilanları
-- ---------------------------------------------------------------------
create table if not exists public.real_estate_categories (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references public.real_estate_categories (id) on delete restrict,
  listing_kind text not null,
  slug         text not null unique,
  name         text not null,
  icon         text not null default 'home-outline',
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint re_categories_kind_check check (listing_kind in ('rent', 'sale', 'transfer')),
  constraint re_categories_slug_check check (slug ~ '^[a-z0-9-]{2,48}$'),
  constraint re_categories_name_check check (char_length(name) between 2 and 60)
);

create table if not exists public.real_estate_listings (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles (id) on delete cascade,
  category_id           uuid not null references public.real_estate_categories (id) on delete restrict,
  listing_kind          text not null,
  title                 text not null,
  description           text,
  price_cents           bigint not null,
  currency              text not null default 'TRY',
  price_period          text not null default 'total',
  owner_type            text not null default 'owner',
  status                text not null default 'draft',
  verification_status   text not null default 'unverified',
  city_id               uuid not null references public.cities (id) on delete restrict,
  district_id           bigint not null references public.districts (id) on delete restrict,
  neighborhood_id       bigint references public.neighborhoods (id) on delete set null,
  address_text          text,
  address_private       text,
  hide_exact_location   boolean not null default true,
  lat                   double precision not null,
  lng                   double precision not null,
  geog                  geography(Point, 4326),
  public_lat            double precision,
  public_lng            double precision,
  public_geog           geography(Point, 4326),
  gross_m2              integer,
  net_m2                integer,
  room_count            smallint,
  living_room_count     smallint,
  building_age          smallint,
  floor_no              smallint,
  total_floors          smallint,
  heating               text,
  furnished             boolean,
  balcony               boolean,
  parking               boolean,
  elevator              boolean,
  deposit_cents         bigint,
  dues_cents            bigint,
  attributes            jsonb not null default '{}'::jsonb,
  eids_status           text not null default 'not_started',
  eids_reference        text,
  eids_verified_at      timestamptz,
  eids_expires_at       timestamptz,
  published_at          timestamptz,
  expires_at            timestamptz,
  rejection_reason      text,
  view_count            integer not null default 0,
  favorite_count        integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint re_listings_kind_check check (listing_kind in ('rent', 'sale', 'transfer')),
  constraint re_listings_title_check check (char_length(title) between 5 and 160),
  constraint re_listings_desc_check check (description is null or char_length(description) <= 8000),
  constraint re_listings_price_check check (price_cents >= 0),
  constraint re_listings_currency_check check (currency in ('TRY', 'USD', 'EUR', 'GBP')),
  constraint re_listings_period_check check (price_period in ('month', 'total')),
  constraint re_listings_owner_type_check check (owner_type in ('owner', 'agent', 'business')),
  constraint re_listings_status_check check (
    status in ('draft', 'pending_verification', 'pending_moderation', 'published',
               'rejected', 'expired', 'archived', 'removed')
  ),
  constraint re_listings_verification_check check (
    verification_status in ('unverified', 'pending', 'verified', 'rejected', 'expired')
  ),
  constraint re_listings_eids_check check (
    eids_status in ('not_started', 'pending', 'verified', 'rejected', 'expired')
  ),
  constraint re_listings_lat_check check (lat between 40.55 and 41.25),
  constraint re_listings_lng_check check (lng between 38.90 and 40.70),
  constraint re_listings_m2_check check (
    (gross_m2 is null or gross_m2 between 1 and 100000)
    and (net_m2 is null or net_m2 between 1 and 100000)
    and (net_m2 is null or gross_m2 is null or net_m2 <= gross_m2)
  ),
  constraint re_listings_rooms_check check (
    (room_count is null or room_count between 0 and 20)
    and (living_room_count is null or living_room_count between 0 and 10)
  ),
  constraint re_listings_counts_check check (view_count >= 0 and favorite_count >= 0),
  constraint re_listings_publish_gate check (
    status <> 'published'
    or (verification_status = 'verified' and eids_status = 'verified' and published_at is not null)
  )
);

create index if not exists re_listings_geog_idx on public.real_estate_listings using gist (geog);
create index if not exists re_listings_public_geog_idx on public.real_estate_listings using gist (public_geog);
create index if not exists re_listings_status_idx
  on public.real_estate_listings (status, published_at desc);
create index if not exists re_listings_district_idx
  on public.real_estate_listings (district_id, listing_kind, status);
create index if not exists re_listings_category_idx
  on public.real_estate_listings (category_id, status);
create index if not exists re_listings_owner_idx
  on public.real_estate_listings (owner_id, created_at desc);

comment on table public.real_estate_listings is
  'Emlak ilanları. published durumu yalnızca EİDS doğrulaması tamamlandığında atanabilir; bu kural check constraint ile de korunur.';

create table if not exists public.real_estate_media (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.real_estate_listings (id) on delete cascade,
  uploader_id  uuid not null references public.profiles (id) on delete cascade,
  kind         text not null,
  storage_path text not null,
  cover        boolean not null default false,
  caption      text,
  sort_order   smallint not null default 0,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  constraint re_media_kind_check check (kind in ('image', 'video')),
  constraint re_media_status_check check (status in ('pending', 'approved', 'rejected', 'removed')),
  constraint re_media_path_check check (char_length(storage_path) between 3 and 400),
  constraint re_media_sort_check check (sort_order between 0 and 99)
);

create index if not exists re_media_listing_idx
  on public.real_estate_media (listing_id, status, sort_order);

create table if not exists public.real_estate_favorites (
  listing_id uuid not null references public.real_estate_listings (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);

create index if not exists re_favorites_user_idx
  on public.real_estate_favorites (user_id, created_at desc);

create table if not exists public.real_estate_saved_searches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  label          text not null,
  filters        jsonb not null default '{}'::jsonb,
  boundary       geography(Polygon, 4326),
  notify_enabled boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint re_saved_label_check check (char_length(label) between 1 and 120),
  constraint re_saved_filters_check check (jsonb_typeof(filters) = 'object')
);

create index if not exists re_saved_user_idx
  on public.real_estate_saved_searches (user_id, created_at desc);

create table if not exists public.real_estate_alerts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  saved_search_id   uuid not null unique references public.real_estate_saved_searches (id) on delete cascade,
  channel           text not null default 'in_app',
  last_notified_at  timestamptz,
  created_at        timestamptz not null default now(),
  constraint re_alerts_channel_check check (channel in ('in_app'))
);

create table if not exists public.real_estate_verifications (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.real_estate_listings (id) on delete cascade,
  kind          text not null,
  status        text not null default 'pending',
  reference_no  text,
  document_path text,
  note          text,
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint re_verifications_kind_check check (
    kind in ('eids_identity', 'eids_authority', 'agent_license', 'ownership_document')
  ),
  constraint re_verifications_status_check check (
    status in ('pending', 'approved', 'rejected', 'expired')
  )
);

create index if not exists re_verifications_listing_idx
  on public.real_estate_verifications (listing_id, status, created_at desc);

create table if not exists public.real_estate_moderation (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.real_estate_listings (id) on delete cascade,
  admin_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  reason     text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint re_moderation_action_check check (
    action in ('submitted', 'approved', 'rejected', 'published', 'unpublished', 'expired', 'removed', 'media_removed')
  )
);

create index if not exists re_moderation_listing_idx
  on public.real_estate_moderation (listing_id, created_at desc);

-- ---------------------------------------------------------------------
-- 6. Trigger'lar
-- ---------------------------------------------------------------------
drop trigger if exists cities_updated_at on public.cities;
create trigger cities_updated_at before update on public.cities
  for each row execute function public.set_updated_at();

drop trigger if exists districts_updated_at on public.districts;
create trigger districts_updated_at before update on public.districts
  for each row execute function public.set_updated_at();

drop trigger if exists neighborhoods_updated_at on public.neighborhoods;
create trigger neighborhoods_updated_at before update on public.neighborhoods
  for each row execute function public.set_updated_at();

drop trigger if exists service_regions_updated_at on public.service_regions;
create trigger service_regions_updated_at before update on public.service_regions
  for each row execute function public.set_updated_at();

drop trigger if exists place_categories_updated_at on public.place_categories;
create trigger place_categories_updated_at before update on public.place_categories
  for each row execute function public.set_updated_at();

drop trigger if exists places_updated_at on public.places;
create trigger places_updated_at before update on public.places
  for each row execute function public.set_updated_at();

drop trigger if exists place_reviews_updated_at on public.place_reviews;
create trigger place_reviews_updated_at before update on public.place_reviews
  for each row execute function public.set_updated_at();

drop trigger if exists place_suggestions_updated_at on public.place_suggestions;
create trigger place_suggestions_updated_at before update on public.place_suggestions
  for each row execute function public.set_updated_at();

drop trigger if exists saved_areas_updated_at on public.saved_search_areas;
create trigger saved_areas_updated_at before update on public.saved_search_areas
  for each row execute function public.set_updated_at();

drop trigger if exists re_categories_updated_at on public.real_estate_categories;
create trigger re_categories_updated_at before update on public.real_estate_categories
  for each row execute function public.set_updated_at();

drop trigger if exists re_listings_updated_at on public.real_estate_listings;
create trigger re_listings_updated_at before update on public.real_estate_listings
  for each row execute function public.set_updated_at();

drop trigger if exists re_saved_searches_updated_at on public.real_estate_saved_searches;
create trigger re_saved_searches_updated_at before update on public.real_estate_saved_searches
  for each row execute function public.set_updated_at();

-- Coğrafi doğrulama + koordinat türetme
create or replace function public.places_geo_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_city_plate integer;
  v_district_city uuid;
  v_hood_district bigint;
begin
  if not public.tz_in_trabzon_bbox(new.lat, new.lng) then
    raise exception 'outside_service_area' using errcode = '22023';
  end if;

  select plate_code into v_city_plate from public.cities where id = new.city_id;
  if v_city_plate is null then
    raise exception 'invalid_city' using errcode = '22023';
  end if;

  select city_id into v_district_city from public.districts where id = new.district_id;
  if v_district_city is null or v_district_city <> new.city_id then
    raise exception 'invalid_district' using errcode = '22023';
  end if;

  if new.neighborhood_id is not null then
    select district_id into v_hood_district
    from public.neighborhoods where id = new.neighborhood_id;
    if v_hood_district is null or v_hood_district <> new.district_id then
      raise exception 'invalid_neighborhood' using errcode = '22023';
    end if;
  end if;

  new.verification_status := coalesce(new.verification_status, 'unverified');
  new.is_verified := new.verification_status = 'verified';
  new.geog := st_setsrid(st_makepoint(new.lng, new.lat), 4326)::geography;
  return new;
end;
$$;

drop trigger if exists places_geo_guard on public.places;
create trigger places_geo_guard
  before insert or update of lat, lng, city_id, district_id, neighborhood_id, verification_status
  on public.places
  for each row execute function public.places_geo_guard();

create or replace function public.re_listings_geo_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_district_city uuid;
  v_hood_district bigint;
  v_category_kind text;
begin
  if not public.tz_in_trabzon_bbox(new.lat, new.lng) then
    raise exception 'outside_service_area' using errcode = '22023';
  end if;

  select city_id into v_district_city from public.districts where id = new.district_id;
  if v_district_city is null or v_district_city <> new.city_id then
    raise exception 'invalid_district' using errcode = '22023';
  end if;

  if new.neighborhood_id is not null then
    select district_id into v_hood_district
    from public.neighborhoods where id = new.neighborhood_id;
    if v_hood_district is null or v_hood_district <> new.district_id then
      raise exception 'invalid_neighborhood' using errcode = '22023';
    end if;
  end if;

  select listing_kind into v_category_kind
  from public.real_estate_categories where id = new.category_id;
  if v_category_kind is null or v_category_kind <> new.listing_kind then
    raise exception 'invalid_listing_category' using errcode = '22023';
  end if;

  new.geog := st_setsrid(st_makepoint(new.lng, new.lat), 4326)::geography;

  if new.hide_exact_location then
    -- ~110 m hassasiyet: konut kapı numarası ve kesin konum sızmaz.
    new.public_lat := round(new.lat::numeric, 3)::double precision;
    new.public_lng := round(new.lng::numeric, 3)::double precision;
  else
    new.public_lat := new.lat;
    new.public_lng := new.lng;
  end if;
  new.public_geog := st_setsrid(st_makepoint(new.public_lng, new.public_lat), 4326)::geography;

  if new.status = 'published' and (
    new.verification_status <> 'verified'
    or new.eids_status <> 'verified'
    or new.published_at is null
  ) then
    raise exception 'publish_requires_eids_verification' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists re_listings_geo_guard on public.real_estate_listings;
create trigger re_listings_geo_guard
  before insert or update of lat, lng, city_id, district_id, neighborhood_id,
    category_id, listing_kind, hide_exact_location, status, verification_status,
    eids_status, published_at
  on public.real_estate_listings
  for each row execute function public.re_listings_geo_guard();

-- İşletme puanı/yorum sayısı
create or replace function public.place_reviews_sync_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place uuid;
begin
  v_place := coalesce(new.place_id, old.place_id);

  update public.places p
     set review_count = coalesce((
           select count(*) from public.place_reviews r
           where r.place_id = v_place and r.status = 'visible'
         ), 0),
         rating_count = coalesce((
           select count(*) from public.place_reviews r
           where r.place_id = v_place and r.status = 'visible'
         ), 0),
         rating_avg = (
           select round(avg(r.rating)::numeric, 2)
           from public.place_reviews r
           where r.place_id = v_place and r.status = 'visible'
         )
   where p.id = v_place;

  if tg_op = 'UPDATE' and old.place_id <> new.place_id then
    update public.places p
       set review_count = coalesce((
             select count(*) from public.place_reviews r
             where r.place_id = old.place_id and r.status = 'visible'
           ), 0),
           rating_count = coalesce((
             select count(*) from public.place_reviews r
             where r.place_id = old.place_id and r.status = 'visible'
           ), 0),
           rating_avg = (
             select round(avg(r.rating)::numeric, 2)
             from public.place_reviews r
             where r.place_id = old.place_id and r.status = 'visible'
           )
     where p.id = old.place_id;
  end if;

  return null;
end;
$$;

drop trigger if exists place_reviews_sync_counters on public.place_reviews;
create trigger place_reviews_sync_counters
  after insert or update of status, place_id, rating or delete
  on public.place_reviews
  for each row execute function public.place_reviews_sync_counters();

-- İşletme medya sayaçları
create or replace function public.place_media_sync_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place uuid := coalesce(new.place_id, old.place_id);
begin
  update public.places p
     set photo_count = coalesce((
           select count(*) from public.place_media m
           where m.place_id = v_place and m.status = 'approved' and m.kind = 'image'
         ), 0),
         video_count = coalesce((
           select count(*) from public.place_media m
           where m.place_id = v_place and m.status = 'approved' and m.kind = 'video'
         ), 0)
   where p.id = v_place;
  return null;
end;
$$;

drop trigger if exists place_media_sync_counters on public.place_media;
create trigger place_media_sync_counters
  after insert or update of status, kind, place_id or delete
  on public.place_media
  for each row execute function public.place_media_sync_counters();

-- Favori sayaçları
create or replace function public.place_favorites_sync_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place uuid := coalesce(new.place_id, old.place_id);
begin
  update public.places p
     set favorite_count = coalesce((
           select count(*) from public.place_favorites f where f.place_id = v_place
         ), 0)
   where p.id = v_place;
  return null;
end;
$$;

drop trigger if exists place_favorites_sync_counters on public.place_favorites;
create trigger place_favorites_sync_counters
  after insert or delete on public.place_favorites
  for each row execute function public.place_favorites_sync_counters();

create or replace function public.re_favorites_sync_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing uuid := coalesce(new.listing_id, old.listing_id);
begin
  update public.real_estate_listings l
     set favorite_count = coalesce((
           select count(*) from public.real_estate_favorites f where f.listing_id = v_listing
         ), 0)
   where l.id = v_listing;
  return null;
end;
$$;

drop trigger if exists re_favorites_sync_counters on public.real_estate_favorites;
create trigger re_favorites_sync_counters
  after insert or delete on public.real_estate_favorites
  for each row execute function public.re_favorites_sync_counters();

-- ---------------------------------------------------------------------
-- 7. Depolama
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('place-media', 'place-media', true, 52428800,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']),
  ('real-estate-media', 'real-estate-media', true, 62914560,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists explore_media_insert on storage.objects;
create policy explore_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('place-media', 'real-estate-media')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists explore_media_update on storage.objects;
create policy explore_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('place-media', 'real-estate-media')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('place-media', 'real-estate-media')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists explore_media_delete on storage.objects;
create policy explore_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('place-media', 'real-estate-media')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists explore_media_select on storage.objects;
create policy explore_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('place-media', 'real-estate-media')
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_permission('places.view')
      or public.has_permission('realestate.view')
    )
  );

-- ---------------------------------------------------------------------
-- 8. RLS: tablolar yalnızca RPC üzerinden kullanılır
-- ---------------------------------------------------------------------
alter table public.cities enable row level security;
alter table public.districts enable row level security;
alter table public.neighborhoods enable row level security;
alter table public.service_regions enable row level security;
alter table public.place_categories enable row level security;
alter table public.places enable row level security;
alter table public.place_category_relations enable row level security;
alter table public.place_external_references enable row level security;
alter table public.place_media enable row level security;
alter table public.place_reviews enable row level security;
alter table public.place_review_media enable row level security;
alter table public.place_review_votes enable row level security;
alter table public.place_owner_claims enable row level security;
alter table public.place_business_managers enable row level security;
alter table public.place_suggestions enable row level security;
alter table public.place_favorites enable row level security;
alter table public.place_content_links enable row level security;
alter table public.content_reports enable row level security;
alter table public.saved_search_areas enable row level security;
alter table public.real_estate_categories enable row level security;
alter table public.real_estate_listings enable row level security;
alter table public.real_estate_media enable row level security;
alter table public.real_estate_favorites enable row level security;
alter table public.real_estate_saved_searches enable row level security;
alter table public.real_estate_alerts enable row level security;
alter table public.real_estate_verifications enable row level security;
alter table public.real_estate_moderation enable row level security;

revoke all on public.cities from public, anon, authenticated;
revoke all on public.districts from public, anon, authenticated;
revoke all on public.neighborhoods from public, anon, authenticated;
revoke all on public.service_regions from public, anon, authenticated;
revoke all on public.place_categories from public, anon, authenticated;
revoke all on public.places from public, anon, authenticated;
revoke all on public.place_category_relations from public, anon, authenticated;
revoke all on public.place_external_references from public, anon, authenticated;
revoke all on public.place_media from public, anon, authenticated;
revoke all on public.place_reviews from public, anon, authenticated;
revoke all on public.place_review_media from public, anon, authenticated;
revoke all on public.place_review_votes from public, anon, authenticated;
revoke all on public.place_owner_claims from public, anon, authenticated;
revoke all on public.place_business_managers from public, anon, authenticated;
revoke all on public.place_suggestions from public, anon, authenticated;
revoke all on public.place_favorites from public, anon, authenticated;
revoke all on public.place_content_links from public, anon, authenticated;
revoke all on public.content_reports from public, anon, authenticated;
revoke all on public.saved_search_areas from public, anon, authenticated;
revoke all on public.real_estate_categories from public, anon, authenticated;
revoke all on public.real_estate_listings from public, anon, authenticated;
revoke all on public.real_estate_media from public, anon, authenticated;
revoke all on public.real_estate_favorites from public, anon, authenticated;
revoke all on public.real_estate_saved_searches from public, anon, authenticated;
revoke all on public.real_estate_alerts from public, anon, authenticated;
revoke all on public.real_estate_verifications from public, anon, authenticated;
revoke all on public.real_estate_moderation from public, anon, authenticated;

revoke all on function public.places_geo_guard() from public, anon, authenticated;
revoke all on function public.re_listings_geo_guard() from public, anon, authenticated;
revoke all on function public.place_reviews_sync_counters() from public, anon, authenticated;
revoke all on function public.place_media_sync_counters() from public, anon, authenticated;
revoke all on function public.place_favorites_sync_counters() from public, anon, authenticated;
revoke all on function public.re_favorites_sync_counters() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. Kategori tohumları (sabit kod değil; admin düzenleyebilir)
-- ---------------------------------------------------------------------
insert into public.place_categories (slug, name, icon, tone, sort_order, is_active) values
  ('yeme-icme', 'Yeme ve İçme', 'restaurant-outline', 'warning', 10, true),
  ('konaklama', 'Konaklama', 'bed-outline', 'info', 20, true),
  ('alisveris', 'Alışveriş', 'bag-handle-outline', 'accent', 30, true),
  ('hizmetler', 'Hizmet İşletmeleri', 'construct-outline', 'primary', 40, true),
  ('diger-yerler', 'Diğer Yerler', 'location-outline', 'success', 50, true)
on conflict (slug) do update
  set name = excluded.name, icon = excluded.icon, tone = excluded.tone,
      sort_order = excluded.sort_order, is_active = true;

insert into public.place_categories (parent_id, slug, name, icon, tone, sort_order, is_active)
select p.id, v.slug, v.name, v.icon, v.tone, v.sort_order, true
from (values
  ('yeme-icme', 'restoran', 'Restoranlar', 'restaurant-outline', 'warning', 11),
  ('yeme-icme', 'kafe', 'Kafeler', 'cafe-outline', 'warning', 12),
  ('yeme-icme', 'pastane', 'Pastaneler', 'ice-cream-outline', 'warning', 13),
  ('yeme-icme', 'firin', 'Fırınlar', 'pizza-outline', 'warning', 14),
  ('yeme-icme', 'lokanta', 'Lokantalar', 'fast-food-outline', 'warning', 15),
  ('yeme-icme', 'kahvalti', 'Kahvaltı Salonları', 'sunny-outline', 'warning', 16),
  ('konaklama', 'otel', 'Oteller', 'business-outline', 'info', 21),
  ('konaklama', 'pansiyon', 'Pansiyonlar', 'home-outline', 'info', 22),
  ('konaklama', 'apart-otel', 'Apart Oteller', 'apartment-outline', 'info', 23),
  ('konaklama', 'bungalov', 'Bungalov İşletmeleri', 'leaf-outline', 'info', 24),
  ('konaklama', 'konaklama-tesisi', 'Konaklama Tesisleri', 'bed-outline', 'info', 25),
  ('alisveris', 'market', 'Marketler', 'basket-outline', 'accent', 31),
  ('alisveris', 'giyim', 'Giyim Mağazaları', 'shirt-outline', 'accent', 32),
  ('alisveris', 'elektronik', 'Elektronik Mağazaları', 'hardware-chip-outline', 'accent', 33),
  ('alisveris', 'mobilya', 'Mobilyacılar', 'bed-outline', 'accent', 34),
  ('alisveris', 'kuyumcu', 'Kuyumcular', 'diamond-outline', 'accent', 35),
  ('alisveris', 'avm', 'Alışveriş Merkezleri', 'storefront-outline', 'accent', 36),
  ('hizmetler', 'berber', 'Berberler', 'cut-outline', 'primary', 41),
  ('hizmetler', 'kuafor', 'Kuaförler', 'color-wand-outline', 'primary', 42),
  ('hizmetler', 'guzellik-salonu', 'Güzellik Salonları', 'sparkles-outline', 'primary', 43),
  ('hizmetler', 'oto-servis', 'Oto Servisleri', 'car-outline', 'primary', 44),
  ('hizmetler', 'arac-kiralama', 'Araç Kiralama Ofisleri', 'key-outline', 'primary', 45),
  ('hizmetler', 'emlak-ofisi', 'Emlak Ofisleri', 'home-outline', 'primary', 46),
  ('hizmetler', 'teknik-servis', 'Teknik Servisler', 'build-outline', 'primary', 47),
  ('hizmetler', 'spor-salonu', 'Spor Salonları', 'barbell-outline', 'primary', 48),
  ('diger-yerler', 'eczane', 'Eczaneler', 'medkit-outline', 'success', 51),
  ('diger-yerler', 'saglik', 'Sağlık Kuruluşları', 'hospital-outline', 'success', 52),
  ('diger-yerler', 'banka', 'Bankalar', 'card-outline', 'success', 53),
  ('diger-yerler', 'kamu', 'Kamuya Açık Kurumlar', 'business-outline', 'success', 54),
  ('diger-yerler', 'otopark', 'Otoparklar', 'car-outline', 'success', 55),
  ('diger-yerler', 'turistik-yer', 'Turistik Yerler', 'camera-outline', 'success', 56),
  ('diger-yerler', 'gezilecek-nokta', 'Gezilecek Noktalar', 'compass-outline', 'success', 57),
  ('diger-yerler', 'park', 'Parklar', 'leaf-outline', 'success', 58),
  ('diger-yerler', 'tarihi-kulturel', 'Tarihî ve Kültürel Mekânlar', 'library-outline', 'success', 59)
) as v(parent_slug, slug, name, icon, tone, sort_order)
join public.place_categories p on p.slug = v.parent_slug
on conflict (slug) do update
  set parent_id = excluded.parent_id, name = excluded.name, icon = excluded.icon,
      tone = excluded.tone, sort_order = excluded.sort_order, is_active = true;

insert into public.real_estate_categories (listing_kind, slug, name, icon, sort_order, is_active) values
  ('rent', 'kiralik', 'Kiralık', 'key-outline', 10, true),
  ('sale', 'satilik', 'Satılık', 'pricetag-outline', 20, true),
  ('transfer', 'devren', 'Devren', 'swap-horizontal-outline', 30, true)
on conflict (slug) do update
  set name = excluded.name, icon = excluded.icon, sort_order = excluded.sort_order, is_active = true;

insert into public.real_estate_categories (parent_id, listing_kind, slug, name, icon, sort_order, is_active)
select p.id, v.listing_kind, v.slug, v.name, v.icon, v.sort_order, true
from (values
  ('kiralik', 'rent', 'kiralik-daire', 'Kiralık Daire', 'home-outline', 11),
  ('kiralik', 'rent', 'kiralik-mustakil-ev', 'Kiralık Müstakil Ev', 'home-outline', 12),
  ('kiralik', 'rent', 'kiralik-villa', 'Kiralık Villa', 'business-outline', 13),
  ('kiralik', 'rent', 'kiralik-dukkan', 'Kiralık Dükkân', 'storefront-outline', 14),
  ('kiralik', 'rent', 'kiralik-magaza', 'Kiralık Mağaza', 'bag-handle-outline', 15),
  ('kiralik', 'rent', 'kiralik-ofis', 'Kiralık Ofis', 'briefcase-outline', 16),
  ('kiralik', 'rent', 'kiralik-depo', 'Kiralık Depo', 'cube-outline', 17),
  ('kiralik', 'rent', 'kiralik-otel', 'Kiralık Otel', 'business-outline', 18),
  ('kiralik', 'rent', 'kiralik-pansiyon', 'Kiralık Pansiyon', 'bed-outline', 19),
  ('satilik', 'sale', 'satilik-daire', 'Satılık Daire', 'home-outline', 21),
  ('satilik', 'sale', 'satilik-mustakil-ev', 'Satılık Müstakil Ev', 'home-outline', 22),
  ('satilik', 'sale', 'satilik-villa', 'Satılık Villa', 'business-outline', 23),
  ('satilik', 'sale', 'satilik-dukkan', 'Satılık Dükkân', 'storefront-outline', 24),
  ('satilik', 'sale', 'satilik-isyeri', 'Satılık İşyeri', 'briefcase-outline', 25),
  ('satilik', 'sale', 'satilik-ofis', 'Satılık Ofis', 'briefcase-outline', 26),
  ('satilik', 'sale', 'satilik-arsa', 'Satılık Arsa', 'map-outline', 27),
  ('satilik', 'sale', 'satilik-tarla', 'Satılık Tarla', 'leaf-outline', 28),
  ('satilik', 'sale', 'satilik-otel', 'Satılık Otel', 'business-outline', 29),
  ('satilik', 'sale', 'satilik-pansiyon', 'Satılık Pansiyon', 'bed-outline', 30),
  ('devren', 'transfer', 'devren-restoran', 'Devren Restoran', 'restaurant-outline', 31),
  ('devren', 'transfer', 'devren-kafe', 'Devren Kafe', 'cafe-outline', 32),
  ('devren', 'transfer', 'devren-market', 'Devren Market', 'basket-outline', 33),
  ('devren', 'transfer', 'devren-otel', 'Devren Otel', 'business-outline', 34),
  ('devren', 'transfer', 'devren-pansiyon', 'Devren Pansiyon', 'bed-outline', 35),
  ('devren', 'transfer', 'devren-diger', 'Devren Diğer İşletmeler', 'swap-horizontal-outline', 36)
) as v(parent_slug, listing_kind, slug, name, icon, sort_order)
join public.real_estate_categories p on p.slug = v.parent_slug
on conflict (slug) do update
  set parent_id = excluded.parent_id, listing_kind = excluded.listing_kind,
      name = excluded.name, icon = excluded.icon, sort_order = excluded.sort_order,
      is_active = true;

-- EİDS anahtarı: varsayılan olarak KAPALI. Resmî entegrasyon olmadan
-- hiçbir ilan doğrulanmış veya yayınlanmış sayılmaz.
insert into public.app_settings (key, value, description_tr, is_public)
values (
  'real_estate.eids_enabled',
  'false'::jsonb,
  'EİDS kimlik ve ilan verme yetkisi doğrulaması. Resmî entegrasyon tamamlanana kadar kapalıdır.',
  false
)
on conflict (key) do nothing;

insert into public.app_settings (key, value, description_tr, is_public)
values (
  'explore.launch_city',
  '"trabzon"'::jsonb,
  'İlk hizmet bölgesi. Yeni şehirler admin panelinden etkinleştirilir.',
  true
)
on conflict (key) do nothing;

-- Trabzon ilçe sınır kutusu (hizmet bölgesi güvenlik filtresi).
insert into public.service_regions (city_id, name, is_active, launch_phase, min_lat, max_lat, min_lng, max_lng, notes)
select c.id, 'Trabzon', true, 'phase_1', 40.55, 41.25, 38.90, 40.70,
       'İl sınırı değil; hizmet bölgesi dışına taşan kayıtları reddeden sunucu tarafı kutudur.'
from public.cities c
where c.plate_code = 61
on conflict (city_id) do update
  set name = excluded.name, is_active = true, min_lat = excluded.min_lat,
      max_lat = excluded.max_lat, min_lng = excluded.min_lng, max_lng = excluded.max_lng;

-- Şehir/ilçe/mahalle verisi 0045_geo_seed.sql tarafından yüklenir.
