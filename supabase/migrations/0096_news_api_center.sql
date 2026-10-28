-- 0095: Haber API Kontrol Merkezi (MOD A — kaynak haber yayını)
--
-- Üçüncü haber sistemini yeniden yazmaz. Yayımlanan her haber normal bir
-- `posts` kaydıdır; kaynak ilişkisi, lisans anlık görüntüsü ve silme
-- izlenebilirliği `news_publication_links` üzerinden tutulur. Böylece mevcut
-- akış, profil, yorum, bildirim, Deep Link ve sitemap altyapısı aynen kullanılır.
--
-- Tasarım kuralları:
--   * Tüm tablolarda RLS açıktır ve istemci politikası tanımlanmaz; erişim
--     yalnızca SECURITY DEFINER RPC'lerden yapılır.
--   * API anahtarları düz metin olarak saklanmaz; Supabase Vault kullanılır.
--   * Otomasyon (worker) fonksiyonları yalnızca service_role'e açıktır.
--   * Kaynak silme işlemleri ayrı, yeniden denenebilir ve parçalı işlerdir.

-- ---------------------------------------------------------------------------
-- 0. Kategori ve şablon kataloğu
-- ---------------------------------------------------------------------------
create table if not exists public.news_categories (
  slug text primary key,
  name_tr text not null,
  sort_order integer not null default 0,
  trabzon_default boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.news_categories (slug, name_tr, sort_order, trabzon_default) values
  ('trabzon-gundem',    'Trabzon Gündem',      10,  true),
  ('son-dakika',        'Son Dakika',          20,  true),
  ('trabzonspor',       'Trabzonspor',         30,  true),
  ('spor',              'Spor',                40,  true),
  ('ekonomi',           'Ekonomi',             50,  false),
  ('emlak',             'Emlak',               60,  false),
  ('belediyeler',       'Belediyeler',         70,  true),
  ('kamu-duyurulari',   'Kamu Duyuruları',     80,  false),
  ('trafik',            'Trafik',              90,  false),
  ('ulasim',            'Ulaşım',             100,  false),
  ('turizm',            'Turizm',             110,  false),
  ('kultur-sanat',      'Kültür ve Sanat',    120,  false),
  ('etkinlikler',       'Etkinlikler',        130,  false),
  ('egitim',            'Eğitim',             140,  false),
  ('yasam',             'Yaşam',              150,  false),
  ('tarim',             'Tarım',              160,  false),
  ('findik',            'Fındık',             170,  true),
  ('cay',               'Çay',                180,  true),
  ('teknoloji',         'Teknoloji',          190,  false),
  ('saglik',            'Sağlık',             200,  false),
  ('is-dunyasi',        'İş Dünyası',         210,  false)
on conflict (slug) do update
  set name_tr = excluded.name_tr,
      sort_order = excluded.sort_order,
      trabzon_default = excluded.trabzon_default;

create table if not exists public.news_api_templates (
  code text primary key,
  name text not null,
  homepage_url text,
  feed_url text not null,
  connector_kind text not null,
  license_note text,
  rights_url text,
  default_categories text[] not null default '{}',
  is_verified boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.news_categories enable row level security;
alter table public.news_api_templates enable row level security;

drop policy if exists news_categories_read on public.news_categories;
create policy news_categories_read on public.news_categories
  for select to authenticated, anon using (true);

drop policy if exists news_templates_read on public.news_api_templates;
create policy news_templates_read on public.news_api_templates
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 1. Kaynak bağlantısı
-- ---------------------------------------------------------------------------
create table if not exists public.news_api_connections (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  homepage_url text,
  feed_url text not null,
  connector_kind text not null default 'rss'
    check (connector_kind in ('rss','atom','xml','json_feed','rest_json','custom_api')),
  http_method text not null default 'GET' check (http_method in ('GET','POST')),
  auth_kind text not null default 'none'
    check (auth_kind in ('none','header_key','query_key','bearer','basic')),
  auth_header_name text,
  auth_query_param text,
  auth_username text,
  default_params jsonb not null default '{}'::jsonb,
  timezone text not null default 'Europe/Istanbul',
  poll_interval_minutes integer not null default 30
    check (poll_interval_minutes between 5 and 1440),
  status text not null default 'draft'
    check (status in ('draft','active','paused','disabled','deleting')),
  health_status text not null default 'unknown'
    check (health_status in ('unknown','ok','warning','error')),
  auto_publish_enabled boolean not null default false,
  publish_mode text not null default 'discovery'
    check (publish_mode in ('discovery','source_profile','trabzone_digest','editor_approval')),
  publisher_profile_id uuid references public.profiles(id) on delete set null,
  max_items_per_run integer not null default 20 check (max_items_per_run between 1 and 100),
  page_limit integer not null default 1 check (page_limit between 1 and 10),
  request_timeout_ms integer not null default 12000 check (request_timeout_ms between 2000 and 30000),
  max_response_bytes integer not null default 2097152
    check (max_response_bytes between 65536 and 10485760),
  retry_count integer not null default 1 check (retry_count between 0 and 3),
  backoff_seconds integer not null default 300 check (backoff_seconds between 30 and 86400),
  daily_request_budget integer not null default 480
    check (daily_request_budget between 10 and 20000),
  requests_today integer not null default 0,
  requests_day date not null default ((now() at time zone 'Europe/Istanbul')::date),
  rate_limited_until timestamptz,
  min_publish_interval_seconds integer not null default 0
    check (min_publish_interval_seconds between 0 and 86400),
  license_status text not null default 'unverified'
    check (license_status in ('unverified','permitted','restricted','prohibited')),
  license_note text,
  ai_classification boolean not null default true,
  regions text[] not null default array['trabzon']::text[],
  notes text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  last_http_status integer,
  last_response_ms integer,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_detail jsonb,
  auto_disabled_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists news_api_connections_status_idx
  on public.news_api_connections (status, health_status);
create index if not exists news_api_connections_due_idx
  on public.news_api_connections (last_checked_at) where status = 'active';

-- ---------------------------------------------------------------------------
-- 2. Kimlik bilgileri (Vault referansı; düz metin anahtar yok)
-- ---------------------------------------------------------------------------
create table if not exists public.news_api_credentials (
  connection_id uuid primary key references public.news_api_connections(id) on delete cascade,
  vault_secret_id uuid,
  secret_hint text,
  auth_kind text not null default 'none',
  header_name text,
  query_param text,
  username text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Alan ve kategori eşleştirme
-- ---------------------------------------------------------------------------
create table if not exists public.news_api_field_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.news_api_connections(id) on delete cascade,
  field_key text not null,
  source_path text not null,
  transform text not null default 'none'
    check (transform in ('none','trim','html_to_text','iso_date','unix_seconds','unix_ms','absolute_url')),
  is_auto boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, field_key)
);

create table if not exists public.news_api_category_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.news_api_connections(id) on delete cascade,
  source_category text not null,
  target_slug text not null references public.news_categories(slug) on update cascade,
  is_auto boolean not null default false,
  created_at timestamptz not null default now(),
  unique (connection_id, source_category)
);

-- ---------------------------------------------------------------------------
-- 4. Filtreler
-- ---------------------------------------------------------------------------
create table if not exists public.news_api_filters (
  connection_id uuid primary key references public.news_api_connections(id) on delete cascade,
  categories text[] not null default '{}'::text[],
  news_types text[] not null default '{}'::text[],
  location jsonb not null default '{"mode":"trabzon_all","districts":[]}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  date_window_hours integer not null default 72,
  max_age_days integer not null default 30,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Kaynak profili ve yayın izinleri
-- ---------------------------------------------------------------------------
create table if not exists public.news_source_profiles (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.news_api_connections(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  username text,
  avatar_url text,
  cover_url text,
  description text,
  website text,
  verified boolean not null default false,
  verification_note text,
  status text not null default 'unpublished'
    check (status in ('active','unpublished','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.news_source_permissions (
  connection_id uuid primary key references public.news_api_connections(id) on delete cascade,
  can_republish_text boolean not null default false,
  can_republish_summary boolean not null default true,
  can_use_images boolean not null default false,
  can_use_logo boolean not null default false,
  can_use_video boolean not null default false,
  attribution_required boolean not null default true,
  attribution_text text,
  terms_url text,
  evidence_url text,
  verified_by uuid,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. Çekim işleri, haber kayıtları, yayın bağlantıları
-- ---------------------------------------------------------------------------
create table if not exists public.news_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.news_api_connections(id) on delete cascade,
  trigger_kind text not null default 'cron'
    check (trigger_kind in ('cron','manual','admin_test')),
  status text not null default 'running'
    check (status in ('running','success','failed','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  http_status integer,
  response_ms integer,
  payload_format text,
  items_seen integer not null default 0,
  items_new integer not null default 0,
  items_duplicate integer not null default 0,
  items_blocked integer not null default 0,
  items_published integer not null default 0,
  items_drafted integer not null default 0,
  error text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists news_ingestion_jobs_conn_idx
  on public.news_ingestion_jobs (connection_id, started_at desc);

create table if not exists public.news_source_items (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.news_api_connections(id) on delete cascade,
  external_id text,
  canonical_url text not null,
  url_hash text not null,
  title text not null,
  summary text,
  body text,
  image_url text,
  image_storage_path text,
  video_url text,
  author text,
  source_name text,
  source_category text,
  category_slug text references public.news_categories(slug) on update cascade on delete set null,
  district text,
  language text not null default 'tr',
  published_at timestamptz,
  source_updated_at timestamptz,
  fingerprint text,
  status text not null default 'new'
    check (status in ('new','blocked','duplicate','pending_review','drafted','published','removed','rejected')),
  block_reason text,
  post_id uuid references public.posts(id) on delete set null,
  license_snapshot jsonb not null default '{}'::jsonb,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_reason text,
  unique (connection_id, url_hash)
);

create unique index if not exists news_source_items_external_idx
  on public.news_source_items (connection_id, external_id)
  where external_id is not null;
create index if not exists news_source_items_status_idx
  on public.news_source_items (connection_id, status, published_at desc);
create index if not exists news_source_items_fingerprint_idx
  on public.news_source_items (fingerprint);
create index if not exists news_source_items_post_idx
  on public.news_source_items (post_id);

create table if not exists public.news_publication_links (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.news_source_items(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  connection_id uuid references public.news_api_connections(id) on delete set null,
  kind text not null default 'external_source'
    check (kind in ('external_source','editor_publication','ai_generated_news')),
  mode text not null default 'source_profile'
    check (mode in ('source_profile','trabzone_digest','editor_approval','ai_auto','ai_manual')),
  status text not null default 'published'
    check (status in ('draft','published','removed')),
  published_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_reason text,
  created_by uuid,
  unique (item_id, post_id)
);

create index if not exists news_publication_links_post_idx
  on public.news_publication_links (post_id, status);
create index if not exists news_publication_links_conn_idx
  on public.news_publication_links (connection_id, status);

-- ---------------------------------------------------------------------------
-- 7. Silme işleri ve sonuçları
-- ---------------------------------------------------------------------------
create table if not exists public.news_source_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.news_api_connections(id) on delete set null,
  connection_name text not null,
  scope text not null check (scope in ('disable_only','remove_content','purge')),
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed')),
  reason text,
  confirm_name text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  media_paths text[] not null default '{}'::text[],
  error text,
  idempotency_key text unique
);

create index if not exists news_deletion_jobs_conn_idx
  on public.news_source_deletion_jobs (connection_id, requested_at desc);

create table if not exists public.news_source_deletion_results (
  id bigserial primary key,
  job_id uuid not null references public.news_source_deletion_jobs(id) on delete cascade,
  item_id uuid,
  post_id uuid,
  outcome text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists news_deletion_results_job_idx
  on public.news_source_deletion_results (job_id, id);

-- ---------------------------------------------------------------------------
-- 8. Sağlık kayıtları
-- ---------------------------------------------------------------------------
create table if not exists public.news_api_health_logs (
  id bigserial primary key,
  connection_id uuid not null references public.news_api_connections(id) on delete cascade,
  checked_at timestamptz not null default now(),
  kind text not null default 'fetch' check (kind in ('test','fetch','publish')),
  ok boolean not null default false,
  http_status integer,
  response_ms integer,
  payload_format text,
  item_count integer,
  error text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists news_api_health_conn_idx
  on public.news_api_health_logs (connection_id, checked_at desc);

-- ---------------------------------------------------------------------------
-- 9. RLS: doğrudan erişim kapalı
-- ---------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'news_api_connections','news_api_credentials','news_api_field_mappings',
    'news_api_category_mappings','news_api_filters','news_source_profiles',
    'news_source_permissions','news_ingestion_jobs','news_source_items',
    'news_publication_links','news_source_deletion_jobs',
    'news_source_deletion_results','news_api_health_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Yardımcılar
-- ---------------------------------------------------------------------------
create or replace function public.news_slug(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(
        lower(translate(
          coalesce(p_text, ''),
          'çğıöşüÇĞİÖŞÜâîûÂÎÛ',
          'cgiosuCGIOSUaiuAIU'
        )),
        '[^a-z0-9]+', '-', 'g'
      )),
      ''
    ),
    'kaynak'
  );
$$;

create or replace function public.news_url_hash(p_url text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(lower(btrim(coalesce(p_url, ''))), 'sha256'), 'hex');
$$;

create or replace function public.news_fingerprint(p_text text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(
    digest(lower(regexp_replace(coalesce(p_text, ''), '[^[:alnum:]]+', ' ', 'g')), 'sha256'),
    'hex'
  );
$$;

/**
 * Kaynak adreslerinde SSRF koruması: yalnızca HTTPS, özel ağ ve metadata
 * hedefleri reddedilir. Alan adı çözümlemesi worker tarafında ayrıca yapılır.
 */
create or replace function public.news_assert_public_url(p_url text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_host text;
begin
  if v_url = '' then
    raise exception 'invalid_url' using errcode = '22023';
  end if;
  if v_url !~* '^https://[^\s]+$' then
    raise exception 'url_must_be_https' using errcode = '22023';
  end if;

  v_host := lower(split_part(split_part(v_url, '://', 2), '/', 1));
  v_host := split_part(v_host, ':', 1);
  v_host := split_part(v_host, '@', 2);

  if v_host = '' or v_host !~ '^[a-z0-9._-]+$' or position('.' in v_host) = 0 then
    raise exception 'invalid_host' using errcode = '22023';
  end if;

  if v_host in (
    'localhost','localhost.localdomain','metadata.google.internal',
    'metadata.goog','instance-data','169.254.169.254'
  ) then
    raise exception 'host_not_allowed' using errcode = '22023';
  end if;

  if v_host like '%.local' or v_host like '%.internal' or v_host like '%.localhost' then
    raise exception 'host_not_allowed' using errcode = '22023';
  end if;

  if v_host ~ '^\d{1,3}(\.\d{1,3}){3}$' then
    raise exception 'ip_literal_not_allowed' using errcode = '22023';
  end if;

  if v_host like '[%' or v_host like '%:%' then
    raise exception 'ip_literal_not_allowed' using errcode = '22023';
  end if;

  return v_url;
end;
$$;

create or replace function public.news_connection_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists news_api_connections_touch on public.news_api_connections;
create trigger news_api_connections_touch
  before update on public.news_api_connections
  for each row execute function public.news_connection_touch();

drop trigger if exists news_source_profiles_touch on public.news_source_profiles;
create trigger news_source_profiles_touch
  before update on public.news_source_profiles
  for each row execute function public.news_connection_touch();

create or replace function public.news_fold(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(translate(
    coalesce(p_text, ''),
    'çğıöşüÇĞİÖŞÜâîûÂÎÛ',
    'cgiosuCGIOSUaiuAIU'
  ));
$$;

/**
 * Trabzon ilçe tespiti: metinde geçen gerçek ilçe adlarına bakar, tahmin
 * üretmez. Birden fazla ilçe geçiyorsa en erken geçen ad kullanılır.
 */
create or replace function public.news_detect_district(p_text text)
returns text
language sql
stable
set search_path = public
as $$
  select d.name
  from public.districts d
  join public.cities c on c.id = d.city_id
  where c.name ilike 'Trabzon'
    and public.news_fold(coalesce(p_text, '')) like '%' || public.news_fold(d.name) || '%'
  order by position(public.news_fold(d.name) in public.news_fold(coalesce(p_text, '')))
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 11. Ortak JSON üreticileri
-- ---------------------------------------------------------------------------
create or replace function public.news_connection_stats(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'items_total', (select count(*) from public.news_source_items i where i.connection_id = p_id),
    'items_published', (select count(*) from public.news_source_items i where i.connection_id = p_id and i.status = 'published'),
    'items_pending', (select count(*) from public.news_source_items i where i.connection_id = p_id and i.status in ('pending_review','drafted','new')),
    'items_blocked', (select count(*) from public.news_source_items i where i.connection_id = p_id and i.status in ('blocked','rejected')),
    'items_duplicate', (select count(*) from public.news_source_items i where i.connection_id = p_id and i.status = 'duplicate'),
    'items_removed', (select count(*) from public.news_source_items i where i.connection_id = p_id and i.status = 'removed'),
    'items_24h', (select count(*) from public.news_source_items i where i.connection_id = p_id and i.first_seen_at > now() - interval '24 hours'),
    'published_24h', (select count(*) from public.news_source_items i where i.connection_id = p_id and i.status = 'published' and i.first_seen_at > now() - interval '24 hours'),
    'drafts_total', (select count(*) from public.news_publication_links l where l.connection_id = p_id and l.status = 'draft'),
    'sitemap_urls', (select count(*) from public.news_publication_links l
                     join public.posts p on p.id = l.post_id
                     where l.connection_id = p_id and l.status = 'published' and p.moderation_status = 'visible'),
    'last_run', (
      select jsonb_build_object(
        'id', j.id, 'status', j.status, 'started_at', j.started_at, 'finished_at', j.finished_at,
        'items_seen', j.items_seen, 'items_new', j.items_new, 'items_published', j.items_published,
        'http_status', j.http_status, 'response_ms', j.response_ms, 'error', j.error
      )
      from public.news_ingestion_jobs j
      where j.connection_id = p_id
      order by j.started_at desc limit 1
    )
  );
$$;

create or replace function public.news_connection_row_json(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.news_api_connections%rowtype;
  v_cred public.news_api_credentials%rowtype;
  v_profile public.news_source_profiles%rowtype;
begin
  select * into v_c from public.news_api_connections where id = p_id;
  if not found then
    return null;
  end if;
  select * into v_cred from public.news_api_credentials where connection_id = p_id;
  select * into v_profile from public.news_source_profiles where connection_id = p_id;

  return jsonb_build_object(
    'id', v_c.id,
    'code', v_c.code,
    'name', v_c.name,
    'description', v_c.description,
    'homepage_url', v_c.homepage_url,
    'feed_url', v_c.feed_url,
    'connector_kind', v_c.connector_kind,
    'http_method', v_c.http_method,
    'auth_kind', v_c.auth_kind,
    'auth_header_name', v_c.auth_header_name,
    'auth_query_param', v_c.auth_query_param,
    'has_credentials', v_cred.vault_secret_id is not null,
    'secret_hint', v_cred.secret_hint,
    'timezone', v_c.timezone,
    'poll_interval_minutes', v_c.poll_interval_minutes,
    'status', v_c.status,
    'health_status', v_c.health_status,
    'auto_publish_enabled', v_c.auto_publish_enabled,
    'publish_mode', v_c.publish_mode,
    'publisher_profile_id', v_c.publisher_profile_id,
    'license_status', v_c.license_status,
    'license_note', v_c.license_note,
    'max_items_per_run', v_c.max_items_per_run,
    'page_limit', v_c.page_limit,
    'request_timeout_ms', v_c.request_timeout_ms,
    'max_response_bytes', v_c.max_response_bytes,
    'retry_count', v_c.retry_count,
    'backoff_seconds', v_c.backoff_seconds,
    'daily_request_budget', v_c.daily_request_budget,
    'requests_today', v_c.requests_today,
    'rate_limited_until', v_c.rate_limited_until,
    'min_publish_interval_seconds', v_c.min_publish_interval_seconds,
    'ai_classification', v_c.ai_classification,
    'regions', v_c.regions,
    'notes', v_c.notes,
    'last_checked_at', v_c.last_checked_at,
    'last_success_at', v_c.last_success_at,
    'last_error', v_c.last_error,
    'last_error_at', v_c.last_error_at,
    'last_http_status', v_c.last_http_status,
    'last_response_ms', v_c.last_response_ms,
    'last_test_at', v_c.last_test_at,
    'last_test_ok', v_c.last_test_ok,
    'auto_disabled_reason', v_c.auto_disabled_reason,
    'created_at', v_c.created_at,
    'updated_at', v_c.updated_at,
    'profile', case when v_profile.id is null then null else jsonb_build_object(
      'id', v_profile.id,
      'profile_id', v_profile.profile_id,
      'display_name', v_profile.display_name,
      'username', v_profile.username,
      'avatar_url', v_profile.avatar_url,
      'cover_url', v_profile.cover_url,
      'description', v_profile.description,
      'website', v_profile.website,
      'verified', v_profile.verified,
      'verification_note', v_profile.verification_note,
      'status', v_profile.status
    ) end,
    'stats', public.news_connection_stats(p_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Yönetici okuma modelleri
-- ---------------------------------------------------------------------------
create or replace function public.admin_news_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_result jsonb;
begin
  select jsonb_build_object(
    'connections_total', (select count(*) from public.news_api_connections),
    'connections_active', (select count(*) from public.news_api_connections where status = 'active'),
    'connections_paused', (select count(*) from public.news_api_connections where status = 'paused'),
    'connections_disabled', (select count(*) from public.news_api_connections where status in ('disabled','draft')),
    'connections_error', (select count(*) from public.news_api_connections where health_status = 'error'),
    'items_total', (select count(*) from public.news_source_items),
    'items_published', (select count(*) from public.news_source_items where status = 'published'),
    'items_pending', (select count(*) from public.news_source_items where status in ('pending_review','drafted')),
    'items_blocked', (select count(*) from public.news_source_items where status in ('blocked','rejected')),
    'items_duplicate', (select count(*) from public.news_source_items where status = 'duplicate'),
    'items_24h', (select count(*) from public.news_source_items where first_seen_at > now() - interval '24 hours'),
    'published_24h', (select count(*) from public.news_source_items where status = 'published' and first_seen_at > now() - interval '24 hours'),
    'published_total', (select count(*) from public.news_publication_links where status = 'published'),
    'deletions_running', (select count(*) from public.news_source_deletion_jobs where status in ('queued','running')),
    'unlicensed_sources', (select count(*) from public.news_api_connections where license_status in ('unverified','prohibited')),
    'last_success_at', (select max(last_success_at) from public.news_api_connections),
    'avg_response_ms', (select round(avg(response_ms))::int from public.news_api_health_logs where checked_at > now() - interval '24 hours' and response_ms is not null),
    'requests_today', (select coalesce(sum(requests_today), 0)::int from public.news_api_connections)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_news_connections_list(
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
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
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_items jsonb;
begin
  select count(*)::int into v_total
  from public.news_api_connections c
  where (p_status is null or c.status = p_status)
    and (v_search is null or c.name ilike '%' || v_search || '%' or c.code ilike '%' || v_search || '%');

  select coalesce(jsonb_agg(row_json order by sort_name), '[]'::jsonb) into v_items
  from (
    select
      public.news_connection_row_json(c.id) as row_json,
      c.name as sort_name
    from public.news_api_connections c
    where (p_status is null or c.status = p_status)
      and (v_search is null or c.name ilike '%' || v_search || '%' or c.code ilike '%' || v_search || '%')
    order by c.name
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

create or replace function public.admin_news_connection_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_row jsonb;
  v_fields jsonb;
  v_categories jsonb;
  v_filters jsonb;
  v_permissions jsonb;
  v_health jsonb;
  v_runs jsonb;
  v_jobs jsonb;
begin
  v_row := public.news_connection_row_json(p_id);
  if v_row is null then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'field_key', f.field_key,
    'source_path', f.source_path,
    'transform', f.transform,
    'is_auto', f.is_auto
  ) order by f.field_key), '[]'::jsonb)
  into v_fields
  from public.news_api_field_mappings f where f.connection_id = p_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_category', m.source_category,
    'target_slug', m.target_slug,
    'is_auto', m.is_auto
  ) order by m.source_category), '[]'::jsonb)
  into v_categories
  from public.news_api_category_mappings m where m.connection_id = p_id;

  select to_jsonb(x) into v_filters
  from public.news_api_filters x where x.connection_id = p_id;

  select to_jsonb(x) into v_permissions
  from public.news_source_permissions x where x.connection_id = p_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id, 'checked_at', h.checked_at, 'kind', h.kind, 'ok', h.ok,
    'http_status', h.http_status, 'response_ms', h.response_ms,
    'payload_format', h.payload_format, 'item_count', h.item_count,
    'error', h.error
  ) order by h.checked_at desc), '[]'::jsonb)
  into v_health
  from (
    select * from public.news_api_health_logs
    where connection_id = p_id order by checked_at desc limit 20
  ) h;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id, 'trigger_kind', j.trigger_kind, 'status', j.status,
    'started_at', j.started_at, 'finished_at', j.finished_at,
    'http_status', j.http_status, 'response_ms', j.response_ms,
    'items_seen', j.items_seen, 'items_new', j.items_new,
    'items_duplicate', j.items_duplicate, 'items_blocked', j.items_blocked,
    'items_published', j.items_published, 'error', j.error
  ) order by j.started_at desc), '[]'::jsonb)
  into v_runs
  from (
    select * from public.news_ingestion_jobs
    where connection_id = p_id order by started_at desc limit 25
  ) j;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'scope', d.scope, 'status', d.status,
    'requested_at', d.requested_at, 'finished_at', d.finished_at,
    'counts', d.counts
  ) order by d.requested_at desc), '[]'::jsonb)
  into v_jobs
  from (
    select * from public.news_source_deletion_jobs
    where connection_id = p_id order by requested_at desc limit 10
  ) d;

  return jsonb_build_object(
    'connection', v_row,
    'field_mappings', v_fields,
    'category_mappings', v_categories,
    'filters', v_filters,
    'permissions', v_permissions,
    'health', v_health,
    'runs', v_runs,
    'deletion_jobs', v_jobs
  );
end;
$$;

create or replace function public.admin_news_catalog()
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
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'name', c.name_tr, 'trabzon_default', c.trabzon_default
      ) order by c.sort_order), '[]'::jsonb)
      from public.news_categories c
    ),
    'districts', (
      select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'slug', d.slug) order by d.name), '[]'::jsonb)
      from public.districts d join public.cities ci on ci.id = d.city_id
      where ci.name ilike 'Trabzon'
    ),
    'templates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', t.code, 'name', t.name, 'homepage_url', t.homepage_url,
        'feed_url', t.feed_url, 'connector_kind', t.connector_kind,
        'license_note', t.license_note, 'rights_url', t.rights_url,
        'default_categories', t.default_categories, 'is_verified', t.is_verified
      ) order by t.sort_order, t.name), '[]'::jsonb)
      from public.news_api_templates t
    ),
    'publish_modes', jsonb_build_array(
      jsonb_build_object('value','discovery','label','Yalnızca keşif (yayın yok)','requires_text', false),
      jsonb_build_object('value','source_profile','label','Kaynak profilinde tam metin','requires_text', true),
      jsonb_build_object('value','trabzone_digest','label','Trabzone Haber derlemesi','requires_text', false),
      jsonb_build_object('value','editor_approval','label','Editör onaylı yayın','requires_text', false)
    ),
    'connector_kinds', jsonb_build_array(
      jsonb_build_object('value','rss','label','RSS 2.0','group','feed'),
      jsonb_build_object('value','atom','label','Atom','group','feed'),
      jsonb_build_object('value','xml','label','XML Feed','group','feed'),
      jsonb_build_object('value','json_feed','label','JSON Feed','group','feed'),
      jsonb_build_object('value','rest_json','label','REST JSON API','group','api'),
      jsonb_build_object('value','custom_api','label','Belgeli özel API','group','api')
    ),
    'license_statuses', jsonb_build_array(
      jsonb_build_object('value','unverified','label','Doğrulanmadı'),
      jsonb_build_object('value','permitted','label','Yayın izni var'),
      jsonb_build_object('value','restricted','label','Kısıtlı kullanım'),
      jsonb_build_object('value','prohibited','label','Yayın izni yok')
    )
  );
end;
$$;

create or replace function public.admin_news_publisher_candidates(p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  return jsonb_build_object('items', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'username', s.username,
      'display_name', s.display_name,
      'is_verified', s.is_verified,
      'avatar_path', s.avatar_path,
      'followers_count', s.followers_count,
      'account_status', s.account_status
    ) order by s.followers_count desc), '[]'::jsonb)
    from (
      select p.id, p.username::text as username, p.display_name, p.is_verified,
             p.avatar_path, p.followers_count, p.account_status
      from public.profiles p
      where p.account_status = 'active'
        and (
          v_search is null
          or p.username::text ilike '%' || v_search || '%'
          or coalesce(p.display_name, '') ilike '%' || v_search || '%'
        )
      order by p.followers_count desc
      limit 30
    ) s
  ));
end;
$$;


-- ---------------------------------------------------------------------------
-- 13. Yayın hakkı kapısı
-- ---------------------------------------------------------------------------
create or replace function public.news_publish_mode_permitted(
  p_mode text,
  p_license text,
  p_can_text boolean,
  p_can_summary boolean
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_mode, 'discovery') = 'discovery' then true
    when coalesce(p_license, 'unverified') = 'prohibited' then false
    when p_mode = 'source_profile' then coalesce(p_can_text, false)
    when p_mode = 'trabzone_digest' then coalesce(p_can_summary, false)
    when p_mode = 'editor_approval' then coalesce(p_can_summary, false) or coalesce(p_can_text, false)
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Kaynak bağlantısı yazma
-- ---------------------------------------------------------------------------
create or replace function public.admin_news_connection_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_c public.news_api_connections%rowtype;
  v_perm public.news_source_permissions%rowtype;
  v_name text;
  v_feed text;
  v_connector text;
  v_mode text;
  v_license text;
  v_code text;
  v_suffix integer := 1;
  v_regions text[];
begin
  v_name := nullif(btrim(coalesce(p_payload->>'name', '')), '');
  v_connector := coalesce(nullif(p_payload->>'connector_kind', ''), 'rss');
  if v_connector not in ('rss','atom','xml','json_feed','rest_json','custom_api') then
    raise exception 'invalid_connector' using errcode = '22023';
  end if;

  if v_id is null then
    if v_name is null or char_length(v_name) < 2 then
      raise exception 'invalid_name' using errcode = '22023';
    end if;

    v_feed := coalesce(
      nullif(p_payload->>'feed_url', ''),
      (select feed_url from public.news_api_templates where code = p_payload->>'template_code')
    );
    v_feed := public.news_assert_public_url(v_feed);

    if coalesce(p_payload->>'homepage_url', '') <> '' then
      perform public.news_assert_public_url(p_payload->>'homepage_url');
    end if;

    v_code := public.news_slug(v_name);
    while exists (select 1 from public.news_api_connections where code = v_code) loop
      v_suffix := v_suffix + 1;
      v_code := public.news_slug(v_name) || '-' || v_suffix::text;
    end loop;

    v_regions := case
      when p_payload ? 'regions' then
        coalesce((select array_agg(value) from jsonb_array_elements_text(p_payload->'regions') as value), array['trabzon'])
      else array['trabzon']
    end;

    insert into public.news_api_connections (
      code, name, description, homepage_url, feed_url, connector_kind, http_method,
      auth_kind, auth_header_name, auth_query_param, default_params, timezone,
      poll_interval_minutes, publish_mode, publisher_profile_id, license_status,
      license_note, max_items_per_run, page_limit, request_timeout_ms,
      max_response_bytes, retry_count, backoff_seconds, daily_request_budget,
      min_publish_interval_seconds, ai_classification, regions, notes, created_by
    ) values (
      v_code,
      v_name,
      nullif(p_payload->>'description', ''),
      nullif(p_payload->>'homepage_url', ''),
      v_feed,
      v_connector,
      coalesce(nullif(p_payload->>'http_method', ''), 'GET'),
      coalesce(nullif(p_payload->>'auth_kind', ''), 'none'),
      nullif(p_payload->>'auth_header_name', ''),
      nullif(p_payload->>'auth_query_param', ''),
      coalesce(p_payload->'default_params', '{}'::jsonb),
      coalesce(nullif(p_payload->>'timezone', ''), 'Europe/Istanbul'),
      coalesce((p_payload->>'poll_interval_minutes')::int, 30),
      'discovery',
      nullif(p_payload->>'publisher_profile_id', '')::uuid,
      coalesce(nullif(p_payload->>'license_status', ''), 'unverified'),
      nullif(p_payload->>'license_note', ''),
      coalesce((p_payload->>'max_items_per_run')::int, 20),
      coalesce((p_payload->>'page_limit')::int, 1),
      coalesce((p_payload->>'request_timeout_ms')::int, 12000),
      coalesce((p_payload->>'max_response_bytes')::int, 2097152),
      coalesce((p_payload->>'retry_count')::int, 1),
      coalesce((p_payload->>'backoff_seconds')::int, 300),
      coalesce((p_payload->>'daily_request_budget')::int, 480),
      coalesce((p_payload->>'min_publish_interval_seconds')::int, 0),
      coalesce((p_payload->>'ai_classification')::boolean, true),
      v_regions,
      nullif(p_payload->>'notes', ''),
      v_admin
    ) returning * into v_c;

    insert into public.news_api_credentials (connection_id, auth_kind, header_name, query_param, username, updated_by)
    values (v_c.id, v_c.auth_kind, v_c.auth_header_name, v_c.auth_query_param, v_c.auth_username, v_admin)
    on conflict (connection_id) do nothing;

    insert into public.news_source_permissions (connection_id)
    values (v_c.id)
    on conflict (connection_id) do nothing;

    insert into public.news_api_filters (connection_id)
    values (v_c.id)
    on conflict (connection_id) do nothing;

    v_id := v_c.id;
  else
    select * into v_c from public.news_api_connections where id = v_id for update;
    if not found then
      raise exception 'connection_not_found' using errcode = 'P0002';
    end if;

    v_feed := coalesce(nullif(p_payload->>'feed_url', ''), v_c.feed_url);
    v_feed := public.news_assert_public_url(v_feed);
    if coalesce(p_payload->>'homepage_url', '') <> '' then
      perform public.news_assert_public_url(p_payload->>'homepage_url');
    end if;

    v_regions := case
      when p_payload ? 'regions' then
        coalesce((select array_agg(value) from jsonb_array_elements_text(p_payload->'regions') as value), v_c.regions)
      else v_c.regions
    end;

    update public.news_api_connections set
      name = coalesce(nullif(btrim(coalesce(p_payload->>'name','')), ''), name),
      description = case when p_payload ? 'description' then nullif(p_payload->>'description','') else description end,
      homepage_url = case when p_payload ? 'homepage_url' then nullif(p_payload->>'homepage_url','') else homepage_url end,
      feed_url = v_feed,
      connector_kind = coalesce(nullif(p_payload->>'connector_kind',''), connector_kind),
      http_method = coalesce(nullif(p_payload->>'http_method',''), http_method),
      auth_kind = coalesce(nullif(p_payload->>'auth_kind',''), auth_kind),
      auth_header_name = case when p_payload ? 'auth_header_name' then nullif(p_payload->>'auth_header_name','') else auth_header_name end,
      auth_query_param = case when p_payload ? 'auth_query_param' then nullif(p_payload->>'auth_query_param','') else auth_query_param end,
      default_params = coalesce(p_payload->'default_params', default_params),
      timezone = coalesce(nullif(p_payload->>'timezone',''), timezone),
      poll_interval_minutes = coalesce((p_payload->>'poll_interval_minutes')::int, poll_interval_minutes),
      publisher_profile_id = case when p_payload ? 'publisher_profile_id'
        then nullif(p_payload->>'publisher_profile_id','')::uuid else publisher_profile_id end,
      license_status = coalesce(nullif(p_payload->>'license_status',''), license_status),
      license_note = case when p_payload ? 'license_note' then nullif(p_payload->>'license_note','') else license_note end,
      max_items_per_run = coalesce((p_payload->>'max_items_per_run')::int, max_items_per_run),
      page_limit = coalesce((p_payload->>'page_limit')::int, page_limit),
      request_timeout_ms = coalesce((p_payload->>'request_timeout_ms')::int, request_timeout_ms),
      max_response_bytes = coalesce((p_payload->>'max_response_bytes')::int, max_response_bytes),
      retry_count = coalesce((p_payload->>'retry_count')::int, retry_count),
      backoff_seconds = coalesce((p_payload->>'backoff_seconds')::int, backoff_seconds),
      daily_request_budget = coalesce((p_payload->>'daily_request_budget')::int, daily_request_budget),
      min_publish_interval_seconds = coalesce((p_payload->>'min_publish_interval_seconds')::int, min_publish_interval_seconds),
      ai_classification = coalesce((p_payload->>'ai_classification')::boolean, ai_classification),
      regions = v_regions,
      notes = case when p_payload ? 'notes' then nullif(p_payload->>'notes','') else notes end
    where id = v_id;

    update public.news_api_credentials set
      auth_kind = coalesce(nullif(p_payload->>'auth_kind',''), auth_kind),
      header_name = case when p_payload ? 'auth_header_name' then nullif(p_payload->>'auth_header_name','') else header_name end,
      query_param = case when p_payload ? 'auth_query_param' then nullif(p_payload->>'auth_query_param','') else query_param end,
      updated_at = now()
    where connection_id = v_id;
  end if;

  select * into v_c from public.news_api_connections where id = v_id;
  select * into v_perm from public.news_source_permissions where connection_id = v_id;

  if p_payload ? 'publish_mode' then
    v_mode := nullif(p_payload->>'publish_mode', '');
    v_license := coalesce(v_c.license_status, 'unverified');
    if v_mode is not null then
      if not public.news_publish_mode_permitted(v_mode, v_license, v_perm.can_republish_text, v_perm.can_republish_summary) then
        raise exception 'publish_mode_not_permitted' using errcode = '22023';
      end if;
      update public.news_api_connections set publish_mode = v_mode where id = v_id;
    end if;
  end if;

  perform public.tz_admin_audit(
    'news.connection.save', 'Haber kaynağı kaydedildi', 'news_api_connection', v_id::text,
    jsonb_build_object('name', v_name, 'feed_url', v_feed, 'connector_kind', v_connector)
  );

  return public.news_connection_row_json(v_id);
end;
$$;

create or replace function public.admin_news_credentials_save(
  p_id uuid,
  p_secret text,
  p_auth_kind text default null,
  p_header_name text default null,
  p_query_param text default null,
  p_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_c public.news_api_connections%rowtype;
  v_cred public.news_api_credentials%rowtype;
  v_secret text := btrim(coalesce(p_secret, ''));
  v_hint text;
  v_secret_id uuid;
begin
  select * into v_c from public.news_api_connections where id = p_id;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;

  select * into v_cred from public.news_api_credentials where connection_id = p_id;
  if not found then
    insert into public.news_api_credentials (connection_id) values (p_id) returning * into v_cred;
  end if;
  v_secret_id := v_cred.vault_secret_id;

  if v_secret <> '' then
    if char_length(v_secret) < 4 then
      raise exception 'invalid_secret' using errcode = '22023';
    end if;
    v_hint := '••••' || right(v_secret, 4);

    if v_secret_id is null then
      v_secret_id := vault.create_secret(
        v_secret,
        'news_api_secret_' || p_id::text,
        'Haber API anahtarı: ' || v_c.name
      );
    else
      perform vault.update_secret(v_secret_id, v_secret);
    end if;
  end if;

  update public.news_api_credentials set
    vault_secret_id = v_secret_id,
    secret_hint = coalesce(v_hint, secret_hint),
    auth_kind = coalesce(nullif(p_auth_kind, ''), auth_kind),
    header_name = case when p_header_name is not null then nullif(p_header_name, '') else header_name end,
    query_param = case when p_query_param is not null then nullif(p_query_param, '') else query_param end,
    username = case when p_username is not null then nullif(p_username, '') else username end,
    updated_by = v_admin,
    updated_at = now()
  where connection_id = p_id;

  update public.news_api_connections set
    auth_kind = coalesce(nullif(p_auth_kind, ''), auth_kind),
    auth_header_name = case when p_header_name is not null then nullif(p_header_name, '') else auth_header_name end,
    auth_query_param = case when p_query_param is not null then nullif(p_query_param, '') else auth_query_param end,
    updated_at = now()
  where id = p_id;

  perform public.tz_admin_audit(
    'news.credentials.save', 'Haber kaynağı kimlik bilgisi güncellendi', 'news_api_connection', p_id::text,
    jsonb_build_object('secret_changed', v_secret <> '', 'auth_kind', coalesce(p_auth_kind, v_cred.auth_kind))
  );

  return jsonb_build_object(
    'has_credentials', v_secret_id is not null,
    'secret_hint', coalesce(v_hint, v_cred.secret_hint)
  );
end;
$$;

create or replace function public.admin_news_credentials_clear(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id from public.news_api_credentials where connection_id = p_id;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
  update public.news_api_credentials
     set vault_secret_id = null, secret_hint = null, updated_by = v_admin, updated_at = now()
   where connection_id = p_id;

  perform public.tz_admin_audit(
    'news.credentials.clear', 'Haber kaynağı kimlik bilgisi silindi', 'news_api_connection', p_id::text, '{}'::jsonb
  );
  return jsonb_build_object('has_credentials', false, 'secret_hint', null);
end;
$$;

create or replace function public.admin_news_connection_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_c public.news_api_connections%rowtype;
  v_fields integer;
  v_target text := nullif(btrim(coalesce(p_status, '')), '');
begin
  if v_target not in ('draft','active','paused','disabled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_c from public.news_api_connections where id = p_id for update;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;

  if v_target = 'active' then
    if v_c.last_test_ok is not true then
      raise exception 'connection_untested' using errcode = '22023';
    end if;
    select count(*) into v_fields from public.news_api_field_mappings
     where connection_id = p_id and field_key in ('title','url');
    if v_fields < 2 then
      raise exception 'mapping_incomplete' using errcode = '22023';
    end if;
  end if;

  update public.news_api_connections
     set status = v_target,
         auto_publish_enabled = case when v_target in ('paused','disabled','draft') then false else auto_publish_enabled end
   where id = p_id;

  perform public.tz_admin_audit(
    'news.connection.status', 'Haber kaynağı durumu değişti', 'news_api_connection', p_id::text,
    jsonb_build_object('from', v_c.status, 'to', v_target)
  );

  return public.news_connection_row_json(p_id);
end;
$$;

create or replace function public.admin_news_connection_set_auto_publish(p_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_c public.news_api_connections%rowtype;
  v_perm public.news_source_permissions%rowtype;
  v_profile public.news_source_profiles%rowtype;
  v_publisher uuid;
begin
  select * into v_c from public.news_api_connections where id = p_id for update;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;
  select * into v_perm from public.news_source_permissions where connection_id = p_id;
  select * into v_profile from public.news_source_profiles where connection_id = p_id;
  v_publisher := coalesce(v_profile.profile_id, v_c.publisher_profile_id);

  if coalesce(p_enabled, false) then
    if v_c.status <> 'active' then
      raise exception 'connection_inactive' using errcode = '22023';
    end if;
    if v_c.publish_mode = 'discovery' then
      raise exception 'publish_mode_discovery' using errcode = '22023';
    end if;
    if not public.news_publish_mode_permitted(
      v_c.publish_mode, v_c.license_status, v_perm.can_republish_text, v_perm.can_republish_summary
    ) then
      raise exception 'publish_mode_not_permitted' using errcode = '22023';
    end if;
    if v_publisher is null then
      raise exception 'publisher_missing' using errcode = '22023';
    end if;
  end if;

  update public.news_api_connections
     set auto_publish_enabled = coalesce(p_enabled, false)
   where id = p_id;

  perform public.tz_admin_audit(
    'news.connection.auto_publish', 'Haber kaynağı otomatik yayını değişti', 'news_api_connection', p_id::text,
    jsonb_build_object('enabled', coalesce(p_enabled, false))
  );

  return public.news_connection_row_json(p_id);
end;
$$;

create or replace function public.admin_news_field_mappings_save(p_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_row jsonb;
  v_field text;
  v_path text;
  v_transform text;
  v_count integer := 0;
begin
  if not exists (select 1 from public.news_api_connections where id = p_id) then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;

  delete from public.news_api_field_mappings where connection_id = p_id;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_field := nullif(btrim(coalesce(v_row->>'field_key', '')), '');
    v_path := nullif(btrim(coalesce(v_row->>'source_path', '')), '');
    v_transform := coalesce(nullif(v_row->>'transform', ''), 'none');
    if v_field is null or v_path is null then
      continue;
    end if;
    if v_field not in (
      'external_id','title','summary','body','url','published_at','updated_at',
      'image_url','video_url','author','source_name','category','district',
      'tags','language','neighborhood'
    ) then
      raise exception 'invalid_field_key' using errcode = '22023';
    end if;
    if v_path !~ '^[A-Za-z0-9_.\[\]$-]{1,200}$' then
      raise exception 'invalid_source_path' using errcode = '22023';
    end if;
    if v_transform not in ('none','trim','html_to_text','iso_date','unix_seconds','unix_ms','absolute_url') then
      raise exception 'invalid_transform' using errcode = '22023';
    end if;

    insert into public.news_api_field_mappings (connection_id, field_key, source_path, transform, is_auto)
    values (p_id, v_field, v_path, v_transform, coalesce((v_row->>'is_auto')::boolean, false))
    on conflict (connection_id, field_key) do update
      set source_path = excluded.source_path,
          transform = excluded.transform,
          is_auto = excluded.is_auto,
          updated_at = now();
    v_count := v_count + 1;
  end loop;

  perform public.tz_admin_audit(
    'news.mapping.save', 'Haber alan eşleştirmesi güncellendi', 'news_api_connection', p_id::text,
    jsonb_build_object('count', v_count)
  );

  return jsonb_build_object('saved', v_count);
end;
$$;

create or replace function public.admin_news_category_mappings_save(p_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_row jsonb;
  v_source text;
  v_target text;
  v_count integer := 0;
begin
  if not exists (select 1 from public.news_api_connections where id = p_id) then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;

  delete from public.news_api_category_mappings where connection_id = p_id;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_source := nullif(btrim(coalesce(v_row->>'source_category', '')), '');
    v_target := nullif(btrim(coalesce(v_row->>'target_slug', '')), '');
    if v_source is null or v_target is null then
      continue;
    end if;
    if not exists (select 1 from public.news_categories where slug = v_target) then
      raise exception 'invalid_category' using errcode = '22023';
    end if;
    insert into public.news_api_category_mappings (connection_id, source_category, target_slug, is_auto)
    values (p_id, left(v_source, 120), v_target, coalesce((v_row->>'is_auto')::boolean, false))
    on conflict (connection_id, source_category) do update
      set target_slug = excluded.target_slug,
          is_auto = excluded.is_auto;
    v_count := v_count + 1;
  end loop;

  perform public.tz_admin_audit(
    'news.categories.save', 'Haber kategori eşleştirmesi güncellendi', 'news_api_connection', p_id::text,
    jsonb_build_object('count', v_count)
  );

  return jsonb_build_object('saved', v_count);
end;
$$;

create or replace function public.admin_news_filters_save(
  p_id uuid,
  p_categories text[] default null,
  p_location jsonb default null,
  p_content jsonb default null,
  p_date_window_hours integer default null,
  p_news_types text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_cat text;
  v_mode text;
  v_slug text;
begin
  if not exists (select 1 from public.news_api_connections where id = p_id) then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;

  foreach v_cat in array coalesce(p_categories, array[]::text[]) loop
    if not exists (select 1 from public.news_categories where slug = v_cat) then
      raise exception 'invalid_category' using errcode = '22023';
    end if;
  end loop;

  if p_location is not null then
    v_mode := coalesce(p_location->>'mode', 'trabzon_all');
    if v_mode not in ('trabzon_all','selected_districts','trabzonspor','national_trabzon') then
      raise exception 'invalid_location_mode' using errcode = '22023';
    end if;
    for v_slug in select jsonb_array_elements_text(coalesce(p_location->'districts', '[]'::jsonb)) loop
      if not exists (
        select 1 from public.districts d join public.cities c on c.id = d.city_id
        where c.name ilike 'Trabzon' and (d.slug = v_slug or d.name = v_slug)
      ) then
        raise exception 'invalid_district' using errcode = '22023';
      end if;
    end loop;
  end if;

  insert into public.news_api_filters (connection_id, categories, news_types, location, content, date_window_hours)
  values (
    p_id,
    coalesce(p_categories, array[]::text[]),
    coalesce(p_news_types, array[]::text[]),
    coalesce(p_location, '{"mode":"trabzon_all","districts":[]}'::jsonb),
    coalesce(p_content, '{}'::jsonb),
    least(greatest(coalesce(p_date_window_hours, 72), 1), 720)
  )
  on conflict (connection_id) do update
    set categories = case when p_categories is null then public.news_api_filters.categories else excluded.categories end,
        news_types = case when p_news_types is null then public.news_api_filters.news_types else excluded.news_types end,
        location = case when p_location is null then public.news_api_filters.location else excluded.location end,
        content = case when p_content is null then public.news_api_filters.content else excluded.content end,
        date_window_hours = case when p_date_window_hours is null then public.news_api_filters.date_window_hours else excluded.date_window_hours end,
        updated_at = now();

  perform public.tz_admin_audit(
    'news.filters.save', 'Haber kaynağı filtreleri güncellendi', 'news_api_connection', p_id::text,
    jsonb_build_object('categories', p_categories, 'location', p_location)
  );

  return (select to_jsonb(f) from public.news_api_filters f where f.connection_id = p_id);
end;
$$;

create or replace function public.admin_news_permissions_save(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', true);
  v_c public.news_api_connections%rowtype;
  v_perm public.news_source_permissions%rowtype;
  v_license text;
begin
  select * into v_c from public.news_api_connections where id = p_id for update;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;

  update public.news_source_permissions set
    can_republish_text = coalesce((p_payload->>'can_republish_text')::boolean, can_republish_text),
    can_republish_summary = coalesce((p_payload->>'can_republish_summary')::boolean, can_republish_summary),
    can_use_images = coalesce((p_payload->>'can_use_images')::boolean, can_use_images),
    can_use_logo = coalesce((p_payload->>'can_use_logo')::boolean, can_use_logo),
    can_use_video = coalesce((p_payload->>'can_use_video')::boolean, can_use_video),
    attribution_required = coalesce((p_payload->>'attribution_required')::boolean, attribution_required),
    attribution_text = case when p_payload ? 'attribution_text' then nullif(p_payload->>'attribution_text','') else attribution_text end,
    terms_url = case when p_payload ? 'terms_url' then nullif(p_payload->>'terms_url','') else terms_url end,
    evidence_url = case when p_payload ? 'evidence_url' then nullif(p_payload->>'evidence_url','') else evidence_url end,
    verified_by = case when coalesce((p_payload->>'can_republish_text')::boolean, false)
                        or coalesce((p_payload->>'can_use_images')::boolean, false)
                       then v_admin else verified_by end,
    verified_at = case when coalesce((p_payload->>'can_republish_text')::boolean, false)
                        or coalesce((p_payload->>'can_use_images')::boolean, false)
                       then now() else verified_at end,
    updated_at = now()
  where connection_id = p_id;

  v_license := coalesce(nullif(p_payload->>'license_status',''), v_c.license_status);
  if v_license not in ('unverified','permitted','restricted','prohibited') then
    raise exception 'invalid_license_status' using errcode = '22023';
  end if;

  update public.news_api_connections
     set license_status = v_license,
         license_note = case when p_payload ? 'license_note' then nullif(p_payload->>'license_note','') else license_note end
   where id = p_id;

  select * into v_perm from public.news_source_permissions where connection_id = p_id;
  select * into v_c from public.news_api_connections where id = p_id;

  if not public.news_publish_mode_permitted(
    v_c.publish_mode, v_license, v_perm.can_republish_text, v_perm.can_republish_summary
  ) then
    update public.news_api_connections
       set publish_mode = 'discovery',
           auto_publish_enabled = false,
           auto_disabled_reason = 'Yayın izni kaldırıldığı için yayın modu keşfete alındı.'
     where id = p_id;
  end if;

  perform public.tz_admin_audit(
    'news.permissions.save', 'Haber kaynağı yayın izinleri güncellendi', 'news_api_connection', p_id::text,
    jsonb_build_object(
      'license_status', v_license,
      'can_republish_text', v_perm.can_republish_text,
      'can_use_images', v_perm.can_use_images
    )
  );

  return jsonb_build_object(
    'permissions', (select to_jsonb(x) from public.news_source_permissions x where x.connection_id = p_id),
    'connection', public.news_connection_row_json(p_id)
  );
end;
$$;

create or replace function public.admin_news_profile_save(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_c public.news_api_connections%rowtype;
  v_display text;
  v_username text;
  v_profile_id uuid;
  v_profile public.profiles%rowtype;
  v_verified boolean := coalesce((p_payload->>'verified')::boolean, false);
  v_status text := coalesce(nullif(p_payload->>'status',''), 'unpublished');
begin
  select * into v_c from public.news_api_connections where id = p_id for update;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;

  v_display := nullif(btrim(coalesce(p_payload->>'display_name','')), '');
  if v_display is null or char_length(v_display) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  v_username := nullif(btrim(coalesce(p_payload->>'username','')), '');
  v_profile_id := nullif(p_payload->>'profile_id','')::uuid;

  if v_profile_id is not null then
    select * into v_profile from public.profiles where id = v_profile_id;
    if not found then
      raise exception 'user_not_found' using errcode = 'P0002';
    end if;
    if v_profile.account_status <> 'active' then
      raise exception 'publisher_inactive' using errcode = '22023';
    end if;
    v_username := coalesce(v_username, v_profile.username::text);
  end if;

  if v_status not in ('active','unpublished','removed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  if v_verified and v_profile_id is null then
    raise exception 'source_profile_unbound' using errcode = '22023';
  end if;
  if v_verified and nullif(btrim(coalesce(p_payload->>'verification_note','')), '') is null then
    raise exception 'verification_note_required' using errcode = '22023';
  end if;

  insert into public.news_source_profiles (
    connection_id, profile_id, display_name, username, avatar_url, cover_url,
    description, website, verified, verification_note, status
  ) values (
    p_id, v_profile_id, v_display, v_username,
    nullif(p_payload->>'avatar_url',''), nullif(p_payload->>'cover_url',''),
    nullif(p_payload->>'description',''), nullif(p_payload->>'website',''),
    v_verified, nullif(p_payload->>'verification_note',''), v_status
  )
  on conflict (connection_id) do update
    set profile_id = excluded.profile_id,
        display_name = excluded.display_name,
        username = excluded.username,
        avatar_url = excluded.avatar_url,
        cover_url = excluded.cover_url,
        description = excluded.description,
        website = excluded.website,
        verified = excluded.verified,
        verification_note = excluded.verification_note,
        status = excluded.status,
        updated_at = now();

  if v_profile_id is not null then
    update public.news_api_connections set publisher_profile_id = v_profile_id where id = p_id;
  end if;

  perform public.tz_admin_audit(
    'news.profile.save', 'Haber kaynak profili güncellendi', 'news_api_connection', p_id::text,
    jsonb_build_object('display_name', v_display, 'profile_id', v_profile_id, 'verified', v_verified)
  );

  return public.news_connection_row_json(p_id);
end;
$$;

create or replace function public.admin_news_connection_set_publish_mode(p_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_c public.news_api_connections%rowtype;
  v_perm public.news_source_permissions%rowtype;
  v_mode text := nullif(btrim(coalesce(p_mode, '')), '');
begin
  if v_mode not in ('discovery','source_profile','trabzone_digest','editor_approval') then
    raise exception 'invalid_publish_mode' using errcode = '22023';
  end if;

  select * into v_c from public.news_api_connections where id = p_id for update;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;
  select * into v_perm from public.news_source_permissions where connection_id = p_id;

  if not public.news_publish_mode_permitted(
    v_mode, v_c.license_status, v_perm.can_republish_text, v_perm.can_republish_summary
  ) then
    raise exception 'publish_mode_not_permitted' using errcode = '22023';
  end if;

  update public.news_api_connections
     set publish_mode = v_mode,
         auto_publish_enabled = case when v_mode = 'discovery' then false else auto_publish_enabled end
   where id = p_id;

  perform public.tz_admin_audit(
    'news.publish_mode', 'Haber kaynağı yayın modu değişti', 'news_api_connection', p_id::text,
    jsonb_build_object('from', v_c.publish_mode, 'to', v_mode)
  );

  return public.news_connection_row_json(p_id);
end;
$$;


-- ---------------------------------------------------------------------------
-- 15. Haber yayınlama (ortak yol)
-- ---------------------------------------------------------------------------
create or replace function public.news_notify_followers(
  p_post_id uuid,
  p_title text,
  p_spot text,
  p_publisher uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_hour integer;
begin
  if p_publisher is null then
    return 0;
  end if;

  v_hour := extract(hour from (now() at time zone 'Europe/Istanbul'))::integer;
  if v_hour >= 0 and v_hour < 7 then
    return 0;
  end if;

  if exists (
    select 1 from public.notifications n
    where n.entity_type = 'post' and n.entity_id = p_post_id::text and n.kind = 'news'
  ) then
    return 0;
  end if;

  insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
  select
    f.follower_id,
    p_publisher,
    'news',
    left('Trabzone Haber: ' || coalesce(p_title, 'Yeni haber'), 160),
    left(coalesce(p_spot, ''), 400),
    'post',
    p_post_id::text,
    '/post/' || p_post_id::text
  from public.user_follows f
    join public.profiles p on p.id = f.follower_id
    left join public.notification_preferences np on np.user_id = f.follower_id
  where f.following_id = p_publisher
    and p.account_status = 'active'
    and coalesce(np.news, true)
    and not public.is_blocked(f.follower_id, p_publisher)
    and (
      select count(*) from public.notifications n
      where n.user_id = f.follower_id and n.kind = 'news'
        and n.created_at >= ((now() at time zone 'Europe/Istanbul')::date::timestamp at time zone 'Europe/Istanbul')
    ) < 6;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.news_compose_body(
  p_title text,
  p_summary text,
  p_body text,
  p_include_body boolean,
  p_district text,
  p_category_name text,
  p_source_name text,
  p_url text,
  p_attribution text
)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    concat_ws(
      E'\n\n',
      nullif(btrim(coalesce(p_title, '')), ''),
      nullif(btrim(coalesce(p_summary, '')), ''),
      case when coalesce(p_include_body, false) then nullif(btrim(coalesce(p_body, '')), '') end,
      E'📍 ' || coalesce(nullif(btrim(coalesce(p_district, '')), ''), 'Trabzon') || ', Trabzon'
        || E'\n🗂 ' || coalesce(nullif(btrim(coalesce(p_category_name, '')), ''), 'Trabzon Gündem')
        || E'\n🔗 Kaynak: ' || coalesce(nullif(btrim(coalesce(p_source_name, '')), ''), 'Haber kaynağı')
        || ' — ' || coalesce(p_url, '')
        || case when nullif(btrim(coalesce(p_attribution, '')), '') is not null
                then E'\n' || btrim(p_attribution) else '' end
    ),
    2000
  );
$$;

/**
 * Bir kaynak haberini yayımlar. Lisans, yayın modu ve profil kapıları burada
 * tek noktadan uygulanır; yönetici onayı da aynı yolu kullanır.
 */
create or replace function public.news_publish_item(p_item_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.news_source_items%rowtype;
  v_c public.news_api_connections%rowtype;
  v_perm public.news_source_permissions%rowtype;
  v_source_profile public.news_source_profiles%rowtype;
  v_publisher public.profiles%rowtype;
  v_category public.news_categories%rowtype;
  v_mode text;
  v_link_mode text;
  v_include_body boolean := false;
  v_body text;
  v_post_id uuid;
  v_attribution text;
  v_media_paths text[] := array[]::text[];
begin
  select * into v_item from public.news_source_items where id = p_item_id for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_item.post_id is not null then
    return jsonb_build_object('published', true, 'already_published', true, 'post_id', v_item.post_id);
  end if;

  select * into v_c from public.news_api_connections where id = v_item.connection_id;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;
  if v_c.status not in ('active','paused') then
    raise exception 'connection_inactive' using errcode = '22023';
  end if;

  select * into v_perm from public.news_source_permissions where connection_id = v_c.id;
  select * into v_source_profile from public.news_source_profiles where connection_id = v_c.id;

  v_mode := v_c.publish_mode;
  if v_mode = 'discovery' then
    raise exception 'publish_mode_discovery' using errcode = '22023';
  end if;
  if not public.news_publish_mode_permitted(
    v_mode, v_c.license_status, v_perm.can_republish_text, v_perm.can_republish_summary
  ) then
    raise exception 'publish_mode_not_permitted' using errcode = '22023';
  end if;

  if v_mode = 'source_profile' then
    v_include_body := true;
    v_link_mode := 'source_profile';
  elsif v_mode = 'editor_approval' then
    v_include_body := coalesce(v_perm.can_republish_text, false);
    v_link_mode := 'editor_approval';
  else
    v_include_body := false;
    v_link_mode := 'trabzone_digest';
  end if;

  v_post_id := v_item.post_id;

  select * into v_publisher from public.profiles
  where id = coalesce(v_source_profile.profile_id, v_c.publisher_profile_id);
  if v_publisher.id is null then
    raise exception 'publisher_missing' using errcode = '22023';
  end if;
  if v_publisher.account_status <> 'active' then
    raise exception 'publisher_inactive' using errcode = '22023';
  end if;

  select * into v_category from public.news_categories
  where slug = coalesce(v_item.category_slug, 'trabzon-gundem');

  v_attribution := case
    when coalesce(v_perm.attribution_required, true) then
      coalesce(
        nullif(btrim(coalesce(v_perm.attribution_text, '')), ''),
        'Haberi yayına hazırlayan kaynak: ' || coalesce(v_item.source_name, v_c.name)
      )
    else null
  end;

  v_body := public.news_compose_body(
    v_item.title,
    v_item.summary,
    v_item.body,
    v_include_body,
    coalesce(v_item.district, 'Trabzon'),
    coalesce(v_category.name_tr, 'Trabzon Gündem'),
    coalesce(v_item.source_name, v_c.name),
    v_item.canonical_url,
    v_attribution
  );

  if v_body is null or char_length(v_body) < 10 then
    raise exception 'empty_body' using errcode = '22023';
  end if;

  insert into public.posts (author_id, body, visibility, city)
  values (v_publisher.id, v_body, 'public', 'Trabzon')
  returning id into v_post_id;

  if coalesce(v_perm.can_use_images, false)
     and nullif(btrim(coalesce(v_item.image_storage_path, '')), '') is not null then
    insert into public.post_media (post_id, storage_path, media_type, sort_order)
    values (v_post_id, v_item.image_storage_path, 'image', 0);
    v_media_paths := array[v_item.image_storage_path];
  end if;

  insert into public.news_publication_links (
    item_id, post_id, connection_id, kind, mode, status, published_at, created_by
  ) values (
    v_item.id, v_post_id, v_c.id, 'external_source', v_link_mode, 'published', now(), p_actor
  )
  on conflict (item_id, post_id) do update
    set status = 'published', published_at = now(), removed_at = null, removed_reason = null;

  update public.news_source_items
     set status = 'published',
         post_id = v_post_id,
         license_snapshot = jsonb_build_object(
           'license_status', v_c.license_status,
           'publish_mode', v_mode,
           'can_republish_text', v_perm.can_republish_text,
           'can_republish_summary', v_perm.can_republish_summary,
           'can_use_images', v_perm.can_use_images,
           'attribution_required', v_perm.attribution_required,
           'attribution_text', v_attribution,
           'captured_at', now()
         )
   where id = v_item.id;

  update public.news_api_connections
     set last_success_at = now()
   where id = v_c.id;

  perform public.news_notify_followers(
    v_post_id, v_item.title, v_item.summary, v_publisher.id
  );

  return jsonb_build_object(
    'published', true,
    'post_id', v_post_id,
    'publisher', v_publisher.username::text,
    'mode', v_link_mode,
    'media_paths', v_media_paths
  );
end;
$$;

create or replace function public.news_post_is_exclusive(p_post_id uuid, p_connection_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_post_id is null then
    return false;
  end if;

  if exists (
    select 1 from public.news_publication_links l
    where l.post_id = p_post_id and l.status = 'published'
      and coalesce(l.connection_id, '00000000-0000-0000-0000-000000000000'::uuid)
          <> coalesce(p_connection_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    return false;
  end if;

  if to_regclass('public.ai_news_publications') is not null then
    if exists (
      select 1 from public.ai_news_publications p
      where p.post_id = p_post_id and p.status = 'published'
    ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Haber kayıtları yönetimi
-- ---------------------------------------------------------------------------
create or replace function public.admin_news_items_list(
  p_connection_id uuid,
  p_status text default null,
  p_search text default null,
  p_limit integer default 40,
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
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_items jsonb;
begin
  select count(*)::int into v_total
  from public.news_source_items i
  where i.connection_id = p_connection_id
    and (p_status is null or i.status = p_status)
    and (v_search is null or i.title ilike '%' || v_search || '%' or i.canonical_url ilike '%' || v_search || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'summary', s.summary,
    'canonical_url', s.canonical_url,
    'image_url', s.image_url,
    'image_storage_path', s.image_storage_path,
    'source_category', s.source_category,
    'category_slug', s.category_slug,
    'district', s.district,
    'published_at', s.published_at,
    'first_seen_at', s.first_seen_at,
    'status', s.status,
    'block_reason', s.block_reason,
    'post_id', s.post_id,
    'post_status', s.post_status,
    'mode', s.mode,
    'license_snapshot', s.license_snapshot
  ) order by coalesce(s.published_at, s.first_seen_at) desc), '[]'::jsonb)
  into v_items
  from (
    select i.*, p.moderation_status as post_status,
           (select l.mode from public.news_publication_links l
            where l.item_id = i.id order by l.published_at desc limit 1) as mode
    from public.news_source_items i
    left join public.posts p on p.id = i.post_id
    where i.connection_id = p_connection_id
      and (p_status is null or i.status = p_status)
      and (v_search is null or i.title ilike '%' || v_search || '%' or i.canonical_url ilike '%' || v_search || '%')
    order by coalesce(i.published_at, i.first_seen_at) desc
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

create or replace function public.admin_news_item_detail(p_item_id uuid)
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
    select jsonb_build_object(
      'id', i.id,
      'connection_id', i.connection_id,
      'external_id', i.external_id,
      'title', i.title,
      'summary', i.summary,
      'body', i.body,
      'canonical_url', i.canonical_url,
      'image_url', i.image_url,
      'image_storage_path', i.image_storage_path,
      'video_url', i.video_url,
      'author', i.author,
      'source_name', i.source_name,
      'source_category', i.source_category,
      'category_slug', i.category_slug,
      'district', i.district,
      'published_at', i.published_at,
      'status', i.status,
      'block_reason', i.block_reason,
      'post_id', i.post_id,
      'license_snapshot', i.license_snapshot,
      'removed_at', i.removed_at,
      'removed_reason', i.removed_reason,
      'first_seen_at', i.first_seen_at,
      'post', case when p.id is null then null else jsonb_build_object(
        'id', p.id, 'body', p.body, 'moderation_status', p.moderation_status,
        'like_count', p.like_count, 'comment_count', p.comment_count,
        'created_at', p.created_at
      ) end
    )
    from public.news_source_items i
    left join public.posts p on p.id = i.post_id
    where i.id = p_item_id
  );
end;
$$;

create or replace function public.admin_news_item_remove(p_item_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_item public.news_source_items%rowtype;
  v_exclusive boolean;
  v_paths text[] := array[]::text[];
  v_post_removed boolean := false;
begin
  select * into v_item from public.news_source_items where id = p_item_id for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;

  v_exclusive := public.news_post_is_exclusive(v_item.post_id, v_item.connection_id);

  if v_item.post_id is not null and v_exclusive then
    update public.posts
       set moderation_status = 'removed'
     where id = v_item.post_id and moderation_status <> 'removed';

    select coalesce(array_agg(storage_path), array[]::text[])
      into v_paths
      from public.post_media where post_id = v_item.post_id;

    delete from public.post_media where post_id = v_item.post_id;
    v_post_removed := true;
  end if;

  update public.news_publication_links
     set status = 'removed',
         removed_at = now(),
         removed_reason = left(coalesce(p_reason, 'manual_removal'), 200)
   where item_id = v_item.id and status <> 'removed';

  update public.news_source_items
     set status = 'removed',
         removed_at = now(),
         removed_reason = left(coalesce(p_reason, 'manual_removal'), 200)
   where id = v_item.id;

  perform public.tz_admin_audit(
    'news.item.remove', 'Haber yayından kaldırıldı', 'news_source_item', v_item.id::text,
    jsonb_build_object(
      'connection_id', v_item.connection_id,
      'post_id', v_item.post_id,
      'post_removed', v_post_removed,
      'shared_post_kept', v_item.post_id is not null and not v_exclusive,
      'media_paths', v_paths,
      'reason', p_reason
    )
  );

  return jsonb_build_object(
    'removed', true,
    'post_removed', v_post_removed,
    'post_kept_shared', v_item.post_id is not null and not v_exclusive,
    'media_paths', v_paths
  );
end;
$$;

create or replace function public.admin_news_item_approve(p_item_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_result jsonb;
begin
  v_result := public.news_publish_item(p_item_id, v_admin);

  perform public.tz_admin_audit(
    'news.item.approve', 'Haber yönetici onayıyla yayımlandı', 'news_source_item', p_item_id::text,
    jsonb_build_object('post_id', v_result->>'post_id', 'note', p_note)
  );

  return v_result;
end;
$$;

create or replace function public.admin_news_item_reject(p_item_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
begin
  update public.news_source_items
     set status = 'rejected',
         removed_reason = left(coalesce(p_reason, 'rejected'), 200)
   where id = p_item_id and status in ('new','pending_review','drafted','blocked');

  if not found then
    raise exception 'item_not_rejectable' using errcode = '22023';
  end if;

  perform public.tz_admin_audit(
    'news.item.reject', 'Haber kaynağı kaydı reddedildi', 'news_source_item', p_item_id::text,
    jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object('rejected', true);
end;
$$;

create or replace function public.admin_news_run_request(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_c public.news_api_connections%rowtype;
begin
  select * into v_c from public.news_api_connections where id = p_id for update;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;
  if v_c.status not in ('active','paused') then
    raise exception 'connection_inactive' using errcode = '22023';
  end if;
  if v_c.rate_limited_until is not null and v_c.rate_limited_until > now() then
    raise exception 'rate_limited' using errcode = '22023';
  end if;

  update public.news_api_connections
     set last_checked_at = null
   where id = p_id;

  perform public.tz_admin_audit(
    'news.run.request', 'Haber kaynağı için manuel çekim istendi', 'news_api_connection', p_id::text, '{}'::jsonb
  );

  return jsonb_build_object('requested', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. Silme ön izleme ve başlatma
-- ---------------------------------------------------------------------------
create or replace function public.admin_news_deletion_preview(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_c public.news_api_connections%rowtype;
  v_profile public.news_source_profiles%rowtype;
  v_counts jsonb;
begin
  select * into v_c from public.news_api_connections where id = p_id;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;
  select * into v_profile from public.news_source_profiles where connection_id = p_id;

  select jsonb_build_object(
    'connection_name', v_c.name,
    'items_total', (select count(*) from public.news_source_items where connection_id = p_id),
    'items_published', (select count(*) from public.news_source_items where connection_id = p_id and status = 'published'),
    'items_pending', (select count(*) from public.news_source_items where connection_id = p_id and status in ('pending_review','drafted','new')),
    'items_blocked', (select count(*) from public.news_source_items where connection_id = p_id and status in ('blocked','duplicate','rejected')),
    'posts_total', (
      select count(distinct l.post_id) from public.news_publication_links l
      where l.connection_id = p_id and l.status = 'published'
    ),
    'posts_exclusive', (
      select count(*) from (
        select distinct l.post_id from public.news_publication_links l
        where l.connection_id = p_id and l.status = 'published'
      ) s
      where public.news_post_is_exclusive(s.post_id, p_id)
    ),
    'posts_shared', (
      select count(*) from (
        select distinct l.post_id from public.news_publication_links l
        where l.connection_id = p_id and l.status = 'published'
      ) s
      where not public.news_post_is_exclusive(s.post_id, p_id)
    ),
    'sitemap_urls', (
      select count(*) from public.news_publication_links l
      join public.posts p on p.id = l.post_id
      where l.connection_id = p_id and l.status = 'published' and p.moderation_status = 'visible'
    ),
    'media_count', (
      select count(*) from public.post_media m
      where m.post_id in (
        select distinct l.post_id from public.news_publication_links l
        where l.connection_id = p_id and l.status = 'published'
      )
    ),
    'profile_bound', v_profile.profile_id is not null,
    'profile_display_name', v_profile.display_name,
    'profile_verified', v_profile.verified,
    'profile_followers', case when v_profile.profile_id is null then 0
      else (select followers_count from public.profiles where id = v_profile.profile_id) end,
    'profile_shared', case when v_profile.profile_id is null then false
      else exists (
        select 1 from public.news_source_profiles sp
        where sp.profile_id = v_profile.profile_id and sp.connection_id <> p_id
      ) end
  ) into v_counts;

  return v_counts;
end;
$$;

create or replace function public.admin_news_deletion_start(
  p_id uuid,
  p_scope text,
  p_confirm_name text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', true);
  v_c public.news_api_connections%rowtype;
  v_scope text := nullif(btrim(coalesce(p_scope, '')), '');
  v_job_id uuid;
  v_key text;
begin
  if v_scope not in ('disable_only','remove_content','purge') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;

  select * into v_c from public.news_api_connections where id = p_id for update;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;

  if btrim(coalesce(p_confirm_name, '')) <> v_c.name then
    raise exception 'confirmation_mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.news_source_deletion_jobs j
    where j.connection_id = p_id and j.status in ('queued','running')
  ) then
    raise exception 'deletion_in_progress' using errcode = '22023';
  end if;

  v_key := p_id::text || ':' || v_scope || ':' || to_char(now(), 'YYYYMMDDHH24MISS');

  insert into public.news_source_deletion_jobs (
    connection_id, connection_name, scope, status, reason, confirm_name, requested_by, idempotency_key
  ) values (
    p_id, v_c.name, v_scope, 'queued', nullif(p_reason, ''), btrim(p_confirm_name), v_admin, v_key
  ) returning id into v_job_id;

  perform public.tz_admin_audit(
    'news.deletion.start', 'Haber kaynağı kaldırma işi başlatıldı', 'news_api_connection', p_id::text,
    jsonb_build_object('job_id', v_job_id, 'scope', v_scope, 'reason', p_reason)
  );

  perform public.news_process_deletion_job(v_job_id, 30);

  return (select to_jsonb(j) from public.news_source_deletion_jobs j where j.id = v_job_id);
end;
$$;

create or replace function public.admin_news_deletion_jobs_list(
  p_connection_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
begin
  return jsonb_build_object('items', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id,
      'connection_id', j.connection_id,
      'connection_name', j.connection_name,
      'scope', j.scope,
      'status', j.status,
      'reason', j.reason,
      'requested_at', j.requested_at,
      'started_at', j.started_at,
      'finished_at', j.finished_at,
      'counts', j.counts,
      'progress', j.progress,
      'error', j.error
    ) order by j.requested_at desc), '[]'::jsonb)
    from (
      select * from public.news_source_deletion_jobs
      where p_connection_id is null or connection_id = p_connection_id
      order by requested_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) j
  ));
end;
$$;

create or replace function public.admin_news_deletion_job_get(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_job public.news_source_deletion_jobs%rowtype;
begin
  select * into v_job from public.news_source_deletion_jobs where id = p_job_id;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'job', to_jsonb(v_job),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'item_id', r.item_id, 'post_id', r.post_id,
        'outcome', r.outcome, 'detail', r.detail, 'created_at', r.created_at
      ) order by r.id)
      from (
        select * from public.news_source_deletion_results
        where job_id = p_job_id order by id desc limit 300
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_news_health_list(p_id uuid, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
begin
  return jsonb_build_object('items', (
    select coalesce(jsonb_agg(to_jsonb(h) order by h.checked_at desc), '[]'::jsonb)
    from (
      select * from public.news_api_health_logs
      where connection_id = p_id
      order by checked_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 200)
    ) h
  ));
end;
$$;


-- ---------------------------------------------------------------------------
-- 18. Ek kolonlar (idempotent)
-- ---------------------------------------------------------------------------
alter table public.news_api_connections
  add column if not exists archived_at timestamptz,
  add column if not exists purge_profile boolean not null default false,
  add column if not exists last_item_at timestamptz;

create table if not exists public.news_api_worker_state (
  name text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.news_api_worker_state enable row level security;

-- ---------------------------------------------------------------------------
-- 19. Worker (servis rolü) fonksiyonları
-- ---------------------------------------------------------------------------
create or replace function public.news_worker_credential_meta(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'auth_kind', c.auth_kind,
    'header_name', c.header_name,
    'query_param', c.query_param,
    'username', c.username,
    'has_secret', c.vault_secret_id is not null,
    'secret_hint', c.secret_hint
  )
  from public.news_api_credentials c
  where c.connection_id = p_id;
$$;

create or replace function public.news_worker_connections_due(p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'code', d.code, 'name', d.name, 'feed_url', d.feed_url,
      'connector_kind', d.connector_kind, 'http_method', d.http_method,
      'auth_kind', d.auth_kind, 'auth_header_name', d.auth_header_name,
      'auth_query_param', d.auth_query_param, 'default_params', d.default_params,
      'timezone', d.timezone, 'page_limit', d.page_limit,
      'max_items_per_run', d.max_items_per_run,
      'request_timeout_ms', d.request_timeout_ms,
      'max_response_bytes', d.max_response_bytes,
      'retry_count', d.retry_count, 'backoff_seconds', d.backoff_seconds,
      'daily_request_budget', d.daily_request_budget,
      'requests_today', d.requests_today,
      'publish_mode', d.publish_mode, 'auto_publish_enabled', d.auto_publish_enabled,
      'license_status', d.license_status, 'ai_classification', d.ai_classification,
      'credential', public.news_worker_credential_meta(d.id)
    ) order by d.last_checked_at nulls first)
    from (
      select c.*
      from public.news_api_connections c
      where c.status = 'active'
        and (c.rate_limited_until is null or c.rate_limited_until <= now())
        and (
          c.last_checked_at is null
          or c.last_checked_at < now() - make_interval(mins => c.poll_interval_minutes)
        )
        and (
          c.requests_day <> v_today
          or c.requests_today < c.daily_request_budget
        )
      order by c.last_checked_at nulls first
      limit least(greatest(coalesce(p_limit, 5), 1), 25)
    ) d
  ), '[]'::jsonb);
end;
$$;

/**
 * Zamanlanmış çekimi tek bir worker için talep eder. ATOMiktir: aynı kaynağı
 * aynı anda iki worker çekmeye çalışırsa yalnızca biri satırı alır.
 */
create or replace function public.news_worker_connection_claim(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_row jsonb;
begin
  update public.news_api_connections c
     set last_checked_at = now(),
         requests_today = case when c.requests_day = v_today then c.requests_today + 1 else 1 end,
         requests_day = v_today
   where c.id = p_id
     and c.status = 'active'
     and (c.rate_limited_until is null or c.rate_limited_until <= now())
     and (
       c.last_checked_at is null
       or c.last_checked_at < now() - make_interval(mins => c.poll_interval_minutes)
     )
     and (c.requests_day <> v_today or c.requests_today < c.daily_request_budget)
  returning to_jsonb(c) into v_row;

  if v_row is null then
    return null;
  end if;

  return v_row || jsonb_build_object(
    'credential', public.news_worker_credential_meta(p_id)
  );
end;
$$;

/**
 * Çekilen tek bir haberi kaydeder. Tekrarlar URL hash'i ve içerik parmak izi
 * üzerinden engellenir; başka bir kaynakta yayımlanmış aynı olay işaretlenir.
 */
create or replace function public.news_worker_item_upsert(p_item jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn_id uuid := (p_item->>'connection_id')::uuid;
  v_url text := nullif(btrim(coalesce(p_item->>'url', '')), '');
  v_title text := nullif(btrim(coalesce(p_item->>'title', '')), '');
  v_summary text := nullif(btrim(coalesce(p_item->>'summary', '')), '');
  v_hash text;
  v_fp text;
  v_id uuid;
  v_status text := 'new';
  v_block text;
  v_post_id uuid;
  v_dup_post uuid;
  v_dup_conn uuid;
begin
  if v_conn_id is null or v_url is null or v_title is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_item');
  end if;

  v_hash := public.news_url_hash(v_url);
  v_fp := coalesce(
    nullif(btrim(coalesce(p_item->>'fingerprint', '')), ''),
    public.news_fingerprint(v_title || ' ' || coalesce(v_summary, ''))
  );

  if length(v_title) > 400 then
    v_title := left(v_title, 400);
  end if;

  -- Aynı olay başka bir kaynakta yayımlandı mı? (çok kaynaklı doğrulama)
  select i.post_id, i.connection_id into v_dup_post, v_dup_conn
  from public.news_source_items i
  where i.connection_id <> v_conn_id
    and i.fingerprint = v_fp
    and i.status = 'published'
    and i.first_seen_at > now() - interval '14 days'
  order by i.first_seen_at desc
  limit 1;

  if v_dup_post is not null then
    v_status := 'duplicate';
    v_block := 'cross_source_duplicate';
  end if;

  insert into public.news_source_items (
    connection_id, external_id, canonical_url, url_hash, title, summary, body,
    image_url, video_url, author, source_name, source_category, district, language,
    published_at, source_updated_at, fingerprint, status, block_reason, raw
  ) values (
    v_conn_id,
    nullif(btrim(coalesce(p_item->>'external_id', '')), ''),
    v_url, v_hash, v_title, v_summary,
    nullif(btrim(coalesce(p_item->>'body', '')), ''),
    nullif(btrim(coalesce(p_item->>'image_url', '')), ''),
    nullif(btrim(coalesce(p_item->>'video_url', '')), ''),
    nullif(btrim(coalesce(p_item->>'author', '')), ''),
    nullif(btrim(coalesce(p_item->>'source_name', '')), ''),
    nullif(btrim(coalesce(p_item->>'category_name', '')), ''),
    nullif(btrim(coalesce(p_item->>'district', '')), ''),
    coalesce(nullif(p_item->>'language', ''), 'tr'),
    nullif(p_item->>'published_at', '')::timestamptz,
    nullif(p_item->>'updated_at', '')::timestamptz,
    v_fp, v_status, v_block,
    case when jsonb_typeof(p_item->'raw') = 'object' then p_item->'raw' else null end
  )
  on conflict (connection_id, url_hash) do update
    set last_seen_at = now(),
        title = excluded.title,
        summary = coalesce(excluded.summary, public.news_source_items.summary),
        body = coalesce(excluded.body, public.news_source_items.body),
        image_url = coalesce(excluded.image_url, public.news_source_items.image_url),
        video_url = coalesce(excluded.video_url, public.news_source_items.video_url),
        source_category = coalesce(excluded.source_category, public.news_source_items.source_category),
        district = coalesce(public.news_source_items.district, excluded.district),
        source_updated_at = excluded.source_updated_at,
        fingerprint = excluded.fingerprint
  returning id into v_id;

  update public.news_api_connections
     set last_item_at = now()
   where id = v_conn_id;

  return jsonb_build_object(
    'ok', true,
    'item_id', v_id,
    'status', v_status,
    'fingerprint', v_fp,
    'duplicate_of_post', v_dup_post
  );
exception
  when unique_violation then
    select i.id into v_id from public.news_source_items i
    where i.connection_id = v_conn_id and i.url_hash = v_hash;
    return jsonb_build_object('ok', true, 'item_id', v_id, 'status', 'duplicate');
end;
$$;

create or replace function public.news_worker_item_classify(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.news_source_items%rowtype;
  v_cat text := nullif(btrim(coalesce(p_payload->>'category_slug', '')), '');
  v_district text := nullif(btrim(coalesce(p_payload->>'district', '')), '');
  v_keep boolean := coalesce((p_payload->>'keep')::boolean, true);
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_status text;
begin
  select * into v_item from public.news_source_items where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  if v_cat is not null and not exists (select 1 from public.news_categories where slug = v_cat) then
    v_cat := null;
  end if;

  if v_item.status in ('published','removed','rejected') then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  if not v_keep then
    v_status := 'blocked';
  elsif v_item.status = 'new' then
    v_status := 'pending_review';
  else
    v_status := v_item.status;
  end if;

  update public.news_source_items
     set category_slug = coalesce(v_cat, category_slug),
         district = coalesce(public.news_detect_district(
           coalesce(v_district, '') || ' ' || v_item.title || ' ' || coalesce(v_item.summary, '')
         ), district),
         status = v_status,
         block_reason = case when v_status = 'blocked' then coalesce(v_reason, 'ai_rejected') else block_reason end
   where id = p_id;

  return jsonb_build_object('ok', true, 'status', v_status, 'category_slug', v_cat);
end;
$$;

create or replace function public.news_worker_item_attach_media(
  p_id uuid,
  p_storage_path text,
  p_image_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(p_storage_path, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'empty_path');
  end if;

  update public.news_source_items
     set image_storage_path = p_storage_path,
         image_url = coalesce(nullif(btrim(coalesce(p_image_url, '')), ''), image_url)
   where id = p_id
     and status not in ('removed','rejected');

  return jsonb_build_object('ok', found);
end;
$$;

create or replace function public.news_worker_item_list_publishable(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', i.id,
      'connection_id', i.connection_id,
      'title', i.title,
      'category_slug', i.category_slug,
      'district', i.district,
      'status', i.status
    ) order by i.first_seen_at)
    from (
      select * from public.news_source_items
      where status = 'pending_review'
      order by first_seen_at
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) i
  ), '[]'::jsonb);
end;
$$;

create or replace function public.news_worker_item_needs_ai(p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', i.id,
      'connection_id', i.connection_id,
      'title', i.title,
      'summary', i.summary,
      'body', left(coalesce(i.body, ''), 4000),
      'source_category', i.source_category,
      'source_name', i.source_name
    ) order by i.first_seen_at)
    from (
      select i.* from public.news_source_items i
      join public.news_api_connections c on c.id = i.connection_id
      where i.status = 'new'
        and c.ai_classification
        and c.status in ('active','paused')
      order by i.first_seen_at
      limit least(greatest(coalesce(p_limit, 10), 1), 50)
    ) i
  ), '[]'::jsonb);
end;
$$;

create or replace function public.news_worker_job_finish(p_job jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn uuid := (p_job->>'connection_id')::uuid;
  v_ok boolean := coalesce((p_job->>'ok')::boolean, false);
  v_status integer := nullif(p_job->>'http_status', '')::integer;
  v_error text := nullif(btrim(coalesce(p_job->>'error', '')), '');
  v_backoff integer := coalesce((p_job->>'backoff_seconds')::integer, 300);
  v_failures integer;
  v_job_id uuid;
begin
  insert into public.news_ingestion_jobs (
    connection_id, trigger_kind, status, finished_at, http_status, response_ms,
    payload_format, items_seen, items_new, items_duplicate, items_blocked,
    items_published, items_drafted, error, meta
  ) values (
    v_conn,
    coalesce(nullif(p_job->>'trigger_kind', ''), 'cron'),
    case when v_ok then 'success' else 'failed' end,
    now(),
    v_status,
    nullif(p_job->>'response_ms', '')::integer,
    nullif(p_job->>'payload_format', ''),
    coalesce((p_job->>'items_seen')::integer, 0),
    coalesce((p_job->>'items_new')::integer, 0),
    coalesce((p_job->>'items_duplicate')::integer, 0),
    coalesce((p_job->>'items_blocked')::integer, 0),
    coalesce((p_job->>'items_published')::integer, 0),
    coalesce((p_job->>'items_drafted')::integer, 0),
    v_error,
    case when jsonb_typeof(p_job->'meta') = 'object' then p_job->'meta' else '{}'::jsonb end
  ) returning id into v_job_id;

  if v_ok then
    update public.news_api_connections
       set health_status = 'ok',
           last_success_at = now(),
           last_http_status = v_status,
           last_response_ms = nullif(p_job->>'response_ms', '')::integer,
           last_error = null,
           last_error_at = null,
           auto_disabled_reason = null,
           rate_limited_until = null
     where id = v_conn;
  else
    update public.news_api_connections
       set health_status = 'error',
           last_http_status = v_status,
           last_response_ms = nullif(p_job->>'response_ms', '')::integer,
           last_error = left(coalesce(v_error, 'unknown_error'), 500),
           last_error_at = now(),
           rate_limited_until = case when v_status = 429 then now() + make_interval(secs => v_backoff) else rate_limited_until end
     where id = v_conn;

    select count(*) into v_failures
    from public.news_ingestion_jobs
    where connection_id = v_conn and status = 'failed'
      and started_at > now() - interval '24 hours';

    if v_failures >= 5 and exists (
      select 1 from public.news_api_connections where id = v_conn and status = 'active'
    ) then
      update public.news_api_connections
         set status = 'paused',
             auto_publish_enabled = false,
             auto_disabled_reason = 'Ardışık 5 başarısız çekimden sonra otomatik duraklatıldı.'
       where id = v_conn;
    end if;
  end if;

  insert into public.news_api_health_logs (connection_id, kind, ok, http_status, response_ms, payload_format, item_count, error, meta)
  values (
    v_conn, 'fetch', v_ok, v_status, nullif(p_job->>'response_ms', '')::integer,
    nullif(p_job->>'payload_format', ''), coalesce((p_job->>'items_seen')::integer, 0), v_error,
    jsonb_build_object('job_id', v_job_id)
  );

  return jsonb_build_object('job_id', v_job_id, 'ok', v_ok);
end;
$$;

create or replace function public.news_worker_test_result(p_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean := coalesce((p_result->>'ok')::boolean, false);
begin
  update public.news_api_connections
     set last_test_at = now(),
         last_test_ok = v_ok,
         last_test_detail = p_result,
         health_status = case when v_ok then 'ok' else 'error' end,
         last_http_status = nullif(p_result->>'http_status', '')::integer,
         last_response_ms = nullif(p_result->>'response_ms', '')::integer,
         last_error = case when v_ok then last_error else left(coalesce(p_result->>'error', 'test_failed'), 500) end,
         last_error_at = case when v_ok then last_error_at else now() end
   where id = p_id;

  insert into public.news_api_health_logs (connection_id, kind, ok, http_status, response_ms, payload_format, item_count, error, meta)
  values (
    p_id, 'test', v_ok,
    nullif(p_result->>'http_status', '')::integer,
    nullif(p_result->>'response_ms', '')::integer,
    nullif(p_result->>'format', ''),
    coalesce((p_result->>'item_count')::integer, 0),
    nullif(p_result->>'error', ''),
    jsonb_build_object('auth_ok', p_result->'auth_ok', 'pagination', p_result->'pagination')
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.news_worker_state_get(p_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select value from public.news_api_worker_state where name = p_name;
$$;

create or replace function public.news_worker_state_set(p_name text, p_value text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.news_api_worker_state (name, value, updated_at)
  values (p_name, p_value, now())
  on conflict (name) do update set value = excluded.value, updated_at = now();
$$;

-- ---------------------------------------------------------------------------
-- 20. Sitemap
-- ---------------------------------------------------------------------------
create or replace function public.news_api_sitemap_urls(p_limit integer default 5000, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'loc', '/post/' || s.post_id::text,
      'lastmod', to_char(coalesce(s.published_at, s.created_at), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      'title', left(s.body, 120),
      'source', s.connection_name
    ) order by coalesce(s.published_at, s.created_at) desc)
    from (
      select l.post_id, l.published_at, p.created_at, p.body, c.name as connection_name
      from public.news_publication_links l
      join public.posts p on p.id = l.post_id
      join public.news_api_connections c on c.id = l.connection_id
      where l.status = 'published'
        and p.moderation_status = 'visible'
        and p.visibility = 'public'
        and c.status <> 'disabled'
        and c.archived_at is null
      order by coalesce(l.published_at, p.created_at) desc
      limit least(greatest(coalesce(p_limit, 5000), 1), 5000)
      offset greatest(coalesce(p_offset, 0), 0)
    ) s
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 21. Silme işinin güvenli yürütülmesi
-- ---------------------------------------------------------------------------
create or replace function public.news_deletion_snapshot(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile public.news_source_profiles%rowtype;
begin
  select * into v_profile from public.news_source_profiles where connection_id = p_id;

  return jsonb_build_object(
    'items_total', (select count(*) from public.news_source_items where connection_id = p_id),
    'items_published', (select count(*) from public.news_source_items where connection_id = p_id and status = 'published'),
    'items_pending', (select count(*) from public.news_source_items where connection_id = p_id and status in ('pending_review','drafted','new')),
    'posts_total', (
      select count(distinct l.post_id) from public.news_publication_links l
      where l.connection_id = p_id and l.status = 'published'
    ),
    'posts_exclusive', (
      select count(*) from (
        select distinct l.post_id from public.news_publication_links l
        where l.connection_id = p_id and l.status = 'published'
      ) s where public.news_post_is_exclusive(s.post_id, p_id)
    ),
    'posts_shared', (
      select count(*) from (
        select distinct l.post_id from public.news_publication_links l
        where l.connection_id = p_id and l.status = 'published'
      ) s where not public.news_post_is_exclusive(s.post_id, p_id)
    ),
    'media_count', (
      select count(*) from public.post_media m
      where m.post_id in (
        select distinct l.post_id from public.news_publication_links l
        where l.connection_id = p_id and l.status = 'published'
      )
    ),
    'profile_bound', v_profile.profile_id is not null,
    'profile_verified', v_profile.verified,
    'profile_followers', case when v_profile.profile_id is null then 0
      else (select followers_count from public.profiles where id = v_profile.profile_id) end,
    'profile_shared', case when v_profile.profile_id is null then false
      else exists (select 1 from public.news_source_profiles sp
                   where sp.profile_id = v_profile.profile_id and sp.connection_id <> p_id) end
  );
end;
$$;

create or replace function public.news_process_deletion_job(p_job_id uuid, p_max_items integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.news_source_deletion_jobs%rowtype;
  v_conn public.news_api_connections%rowtype;
  v_profile public.news_source_profiles%rowtype;
  v_item record;
  v_exclusive boolean;
  v_paths text[];
  v_all_media text[] := array[]::text[];
  v_remaining integer;
  v_processed integer := 0;
  v_new_progress jsonb;
begin
  select * into v_job from public.news_source_deletion_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'job_not_found');
  end if;
  if v_job.status in ('completed','failed') then
    return jsonb_build_object('ok', true, 'status', v_job.status);
  end if;

  select * into v_conn from public.news_api_connections where id = v_job.connection_id;

  if v_conn.id is null then
    update public.news_source_deletion_jobs
       set status = 'completed', finished_at = now(), progress = '{"note":"connection_missing"}'::jsonb
     where id = p_job_id;
    return jsonb_build_object('ok', true, 'status', 'completed');
  end if;

  if v_job.status = 'queued' then
    if v_job.scope = 'disable_only' then
      update public.news_api_connections
         set status = 'disabled',
             auto_publish_enabled = false,
             last_error = null,
             auto_disabled_reason = 'Yönetici kaynağı kapattı.'
       where id = v_conn.id;

      update public.news_ingestion_jobs
         set status = 'skipped', error = coalesce(error, 'source_disabled')
       where connection_id = v_conn.id and status = 'running';

      insert into public.news_source_deletion_results (job_id, outcome, detail)
      values (p_job_id, 'connection_disabled', 'Yeni çekim ve otomatik yayın durduruldu; yayımlanan haberler korundu.');

      update public.news_source_deletion_jobs
         set status = 'completed',
             started_at = now(),
             finished_at = now(),
             counts = public.news_deletion_snapshot(v_conn.id),
             progress = jsonb_build_object('processed', 0, 'kept_posts', true)
       where id = p_job_id;

      return jsonb_build_object('ok', true, 'status', 'completed');
    end if;

    update public.news_source_deletion_jobs
       set status = 'running',
           started_at = now(),
           counts = public.news_deletion_snapshot(v_conn.id)
     where id = p_job_id;

    update public.news_api_connections
       set status = 'deleting',
           auto_publish_enabled = false
     where id = v_conn.id;

    update public.news_ingestion_jobs
       set status = 'skipped', error = coalesce(error, 'source_disabled')
     where connection_id = v_conn.id and status = 'running';

    select * into v_job from public.news_source_deletion_jobs where id = p_job_id;
  end if;

  for v_item in
    select i.id, i.post_id
    from public.news_source_items i
    where i.connection_id = v_conn.id
      and i.status <> 'removed'
    order by i.first_seen_at
    limit least(greatest(coalesce(p_max_items, 25), 1), 100)
  loop
    v_exclusive := public.news_post_is_exclusive(v_item.post_id, v_conn.id);

    if v_item.post_id is not null then
      if v_exclusive then
        update public.posts
           set moderation_status = 'removed'
         where id = v_item.post_id and moderation_status <> 'removed';

        select coalesce(array_agg(storage_path), array[]::text[])
          into v_paths
          from public.post_media where post_id = v_item.post_id;

        if v_paths is not null and array_length(v_paths, 1) > 0 then
          v_all_media := v_all_media || v_paths;
          delete from public.post_media where post_id = v_item.post_id;
        end if;

        insert into public.news_source_deletion_results (job_id, item_id, post_id, outcome, detail)
        values (p_job_id, v_item.id, v_item.post_id, 'post_removed', 'Kaynağa münhasır yayın kaldırıldı.');
      else
        insert into public.news_source_deletion_results (job_id, item_id, post_id, outcome, detail)
        values (p_job_id, v_item.id, v_item.post_id, 'shared_post_kept', 'Diğer kaynaklarla doğrulanan yayın korundu.');
      end if;
    else
      insert into public.news_source_deletion_results (job_id, item_id, post_id, outcome, detail)
      values (p_job_id, v_item.id, null, 'item_removed', 'Yayımlanmamış kaynak kaydı kaldırıldı.');
    end if;

    update public.news_publication_links
       set status = 'removed',
           removed_at = now(),
           removed_reason = 'source_removed'
     where item_id = v_item.id and status <> 'removed';

    update public.news_source_items
       set status = 'removed',
           removed_at = now(),
           removed_reason = 'source_removed'
     where id = v_item.id;

    v_processed := v_processed + 1;
  end loop;

  select count(*) into v_remaining
  from public.news_source_items
  where connection_id = v_conn.id and status <> 'removed';

  v_new_progress := jsonb_build_object(
    'processed', coalesce((v_job.progress->>'processed')::int, 0) + v_processed,
    'remaining', v_remaining,
    'media_collected', coalesce(array_length(v_all_media, 1), 0)
  );

  if v_remaining > 0 then
    update public.news_source_deletion_jobs
       set progress = v_new_progress,
           media_paths = (
             select coalesce(array_agg(distinct x), '{}'::text[])
             from unnest(v_job.media_paths || v_all_media) x
           )
     where id = p_job_id;

    return jsonb_build_object('ok', true, 'status', 'running', 'remaining', v_remaining);
  end if;

  if v_job.scope = 'purge' then
    if v_conn.purge_profile then
      select * into v_profile from public.news_source_profiles where connection_id = v_conn.id;
      if v_profile.profile_id is not null
         and not exists (
           select 1 from public.news_source_profiles sp
           where sp.profile_id = v_profile.profile_id and sp.connection_id <> v_conn.id
         )
      then
        update public.profiles
           set account_status = 'deleted'
         where id = v_profile.profile_id
           and account_status <> 'deleted';

        delete from public.news_source_profiles where connection_id = v_conn.id;

        insert into public.news_source_deletion_results (job_id, outcome, detail)
        values (p_job_id, 'profile_deactivated', 'Kaynağa ait sosyal profil devre dışı bırakıldı.');
      else
        insert into public.news_source_deletion_results (job_id, outcome, detail)
        values (p_job_id, 'profile_kept', 'Profil başka bir kaynakla paylaşıldığı için korundu.');
      end if;
    else
      insert into public.news_source_deletion_results (job_id, outcome, detail)
      values (p_job_id, 'profile_kept', 'Profil koruma seçeneği etkin.');
    end if;

    delete from public.news_api_credentials where connection_id = v_conn.id;

    delete from public.news_api_health_logs where connection_id = v_conn.id;

    delete from public.news_api_filters where connection_id = v_conn.id;
    delete from public.news_api_field_mappings where connection_id = v_conn.id;
    delete from public.news_api_category_mappings where connection_id = v_conn.id;

    update public.news_api_connections
       set status = 'disabled',
           archived_at = now(),
           auto_publish_enabled = false,
           default_params = '{}'::jsonb,
           auth_header_name = null,
           auth_query_param = null,
           auth_username = null,
           last_error = null,
           notes = null
     where id = v_conn.id;

    insert into public.news_source_deletion_results (job_id, outcome, detail)
    values (p_job_id, 'connection_archived', 'Kaynak bağlantısı ve konfigürasyonu arşivlendi.');
  else
    update public.news_api_connections
       set status = 'disabled',
           auto_publish_enabled = false,
           last_error = null
     where id = v_conn.id;
  end if;

  update public.news_source_deletion_jobs
     set status = 'completed',
         finished_at = now(),
         progress = v_new_progress || jsonb_build_object('finished', true),
         media_paths = (
           select coalesce(array_agg(distinct x), '{}'::text[])
           from unnest(v_job.media_paths || v_all_media) x
         ),
         counts = coalesce(nullif(counts, '{}'::jsonb), public.news_deletion_snapshot(v_conn.id))
   where id = p_job_id;

  perform public.tz_admin_audit(
    'news.deletion.complete', 'Haber kaynağı kaldırma işi tamamlandı', 'news_api_connection', v_conn.id::text,
    jsonb_build_object('job_id', p_job_id, 'scope', v_job.scope, 'media_paths', v_all_media)
  );

  return jsonb_build_object('ok', true, 'status', 'completed');
exception
  when others then
    update public.news_source_deletion_jobs
       set status = 'failed',
           finished_at = now(),
           error = left(sqlerrm, 500)
     where id = p_job_id;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

create or replace function public.news_worker_deletion_tick(p_max_jobs integer default 2, p_batch integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_results jsonb := '[]'::jsonb;
begin
  for v_job in
    select id from public.news_source_deletion_jobs
    where status in ('queued','running')
    order by requested_at
    limit least(greatest(coalesce(p_max_jobs, 2), 1), 5)
    for update skip locked
  loop
    v_results := v_results || jsonb_build_array(public.news_process_deletion_job(v_job.id, p_batch));
  end loop;

  return jsonb_build_object('processed', v_results);
end;
$$;

-- Cron: silme kuyruğu (pg_cron mevcutsa)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('news-deletion-tick');
    perform cron.schedule('news-deletion-tick', '*/2 * * * *', 'select public.news_worker_deletion_tick(2, 25);');
  end if;
exception
  when others then
    raise notice 'pg_cron planlanamadı: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 22. Yetkiler
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_news%'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;

  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'news\_worker\_%'
        or p.proname in (
          'news_process_deletion_job','news_deletion_snapshot','news_publish_item',
          'news_notify_followers','news_api_sitemap_urls','news_worker_credential_meta'
        )
      )
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;

revoke all on table public.news_api_worker_state from anon, authenticated;
grant all on table public.news_api_worker_state to service_role;

notify pgrst, 'reload schema';

