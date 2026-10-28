-- ---------------------------------------------------------------------------
-- TRABZONE — Haber API Merkezi: şablon kataloğu ve doğrulanmış kaynak tohumları
-- 0097 — 0096 üzerine ek kolonlar, gerçek feed adresleri ve varsayılan eşleşmeler
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Şablon kataloğu kolonları
-- ---------------------------------------------------------------------------
alter table public.news_api_templates
  add column if not exists api_base text,
  add column if not exists docs_url text,
  add column if not exists auth_kind text not null default 'none',
  add column if not exists auth_header_name text,
  add column if not exists default_params jsonb not null default '{}'::jsonb,
  add column if not exists feed_variants jsonb not null default '{}'::jsonb,
  add column if not exists requires_api_key boolean not null default false,
  add column if not exists license_status text not null default 'unverified',
  add column if not exists capabilities jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Bağlantı kolonları: REST/JSON adapter yapılandırması
-- ---------------------------------------------------------------------------
alter table public.news_api_connections
  add column if not exists items_path text,
  add column if not exists pagination_kind text not null default 'auto',
  add column if not exists pagination_param text,
  add column if not exists next_path text,
  add column if not exists since_param text,
  add column if not exists field_hints jsonb not null default '{}'::jsonb,
  add column if not exists auth_username text,
  add column if not exists archived_at timestamptz,
  add column if not exists purge_profile boolean not null default false,
  add column if not exists last_item_at timestamptz;

alter table public.news_api_connections
  drop constraint if exists news_api_connections_pagination_kind_check;
alter table public.news_api_connections
  add constraint news_api_connections_pagination_kind_check
  check (pagination_kind in ('auto','none','page','next_url','cursor'));

-- ---------------------------------------------------------------------------
-- 3. Yönetici okuma modelini yeni kolonlarla genişlet
-- ---------------------------------------------------------------------------
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
    'auth_username', v_c.auth_username,
    'has_credentials', v_cred.vault_secret_id is not null,
    'secret_hint', v_cred.secret_hint,
    'default_params', v_c.default_params,
    'items_path', v_c.items_path,
    'pagination_kind', v_c.pagination_kind,
    'pagination_param', v_c.pagination_param,
    'next_path', v_c.next_path,
    'since_param', v_c.since_param,
    'field_hints', v_c.field_hints,
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
    'archived_at', v_c.archived_at,
    'purge_profile', v_c.purge_profile,
    'last_item_at', v_c.last_item_at,
    'last_checked_at', v_c.last_checked_at,
    'last_success_at', v_c.last_success_at,
    'last_error', v_c.last_error,
    'last_error_at', v_c.last_error_at,
    'last_http_status', v_c.last_http_status,
    'last_response_ms', v_c.last_response_ms,
    'last_test_at', v_c.last_test_at,
    'last_test_ok', v_c.last_test_ok,
    'last_test_detail', v_c.last_test_detail,
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
-- 4. Kayıt fonksiyonu: adapter ayarlarını da kaydet
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
  v_pagination text;
begin
  v_name := nullif(btrim(coalesce(p_payload->>'name', '')), '');
  v_connector := coalesce(nullif(p_payload->>'connector_kind', ''), 'rss');
  if v_connector not in ('rss','atom','xml','json_feed','rest_json','custom_api') then
    raise exception 'invalid_connector' using errcode = '22023';
  end if;

  v_pagination := coalesce(nullif(p_payload->>'pagination_kind', ''), 'auto');
  if v_pagination not in ('auto','none','page','next_url','cursor') then
    v_pagination := 'auto';
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
      auth_kind, auth_header_name, auth_query_param, auth_username, default_params,
      items_path, pagination_kind, pagination_param, next_path, since_param, field_hints,
      timezone, poll_interval_minutes, publish_mode, publisher_profile_id, license_status,
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
      nullif(p_payload->>'auth_username', ''),
      case when jsonb_typeof(p_payload->'default_params') = 'object' then p_payload->'default_params' else '{}'::jsonb end,
      nullif(p_payload->>'items_path', ''),
      v_pagination,
      nullif(p_payload->>'pagination_param', ''),
      nullif(p_payload->>'next_path', ''),
      nullif(p_payload->>'since_param', ''),
      case when jsonb_typeof(p_payload->'field_hints') = 'object' then p_payload->'field_hints' else '{}'::jsonb end,
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
    if v_c.status = 'deleting' then
      raise exception 'connection_is_deleting' using errcode = '22023';
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
      auth_username = case when p_payload ? 'auth_username' then nullif(p_payload->>'auth_username','') else auth_username end,
      default_params = case when jsonb_typeof(p_payload->'default_params') = 'object' then p_payload->'default_params' else default_params end,
      items_path = case when p_payload ? 'items_path' then nullif(p_payload->>'items_path','') else items_path end,
      pagination_kind = v_pagination,
      pagination_param = case when p_payload ? 'pagination_param' then nullif(p_payload->>'pagination_param','') else pagination_param end,
      next_path = case when p_payload ? 'next_path' then nullif(p_payload->>'next_path','') else next_path end,
      since_param = case when p_payload ? 'since_param' then nullif(p_payload->>'since_param','') else since_param end,
      field_hints = case when jsonb_typeof(p_payload->'field_hints') = 'object' then p_payload->'field_hints' else field_hints end,
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
      username = case when p_payload ? 'auth_username' then nullif(p_payload->>'auth_username','') else username end,
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

-- ---------------------------------------------------------------------------
-- 5. Worker çıktısına adapter ayarlarını ekle
-- ---------------------------------------------------------------------------
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
      'homepage_url', d.homepage_url,
      'connector_kind', d.connector_kind, 'http_method', d.http_method,
      'auth_kind', d.auth_kind, 'auth_header_name', d.auth_header_name,
      'auth_query_param', d.auth_query_param, 'auth_username', d.auth_username,
      'default_params', d.default_params,
      'items_path', d.items_path, 'pagination_kind', d.pagination_kind,
      'pagination_param', d.pagination_param, 'next_path', d.next_path,
      'since_param', d.since_param, 'field_hints', d.field_hints,
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
        and c.archived_at is null
        and (c.rate_limited_until is null or c.rate_limited_until <= now())
        and (
          c.last_checked_at is null
          or c.last_checked_at < now() - make_interval(mins => c.poll_interval_minutes)
        )
        and (c.requests_day <> v_today or c.requests_today < c.daily_request_budget)
      order by c.last_checked_at nulls first
      limit least(greatest(coalesce(p_limit, 5), 1), 25)
    ) d
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Doğrulanmış sağlayıcı şablonları (gerçek adreslerle test edildi)
-- ---------------------------------------------------------------------------
insert into public.news_api_templates (
  code, name, homepage_url, feed_url, connector_kind, license_note, rights_url,
  default_categories, is_verified, sort_order, api_base, docs_url, auth_kind,
  auth_header_name, default_params, feed_variants, requires_api_key, license_status, capabilities
) values
(
  'press_ajans_json', 'Press Haber Ajansı (JSON Feed)', 'https://www.press.org.tr',
  'https://www.press.org.tr/ajans/feed.json', 'json_feed',
  'PHA ücretsiz haber akışı. Kaynak atfı zorunlu; ticari yeniden yayın için PHA kullanım koşulları doğrulanmalıdır.',
  'https://www.press.org.tr/ucretsiz-haber-api',
  array['trabzon-gundem','son-dakika','ekonomi','teknoloji','saglik','egitim'], true, 10,
  'https://www.press.org.tr/api/v1', 'https://www.press.org.tr/ucretsiz-haber-api', 'none', null,
  '{}'::jsonb,
  jsonb_build_object(
    'rss', 'https://www.press.org.tr/ajans/rss.xml',
    'json', 'https://www.press.org.tr/ajans/feed.json'
  ), false, 'unverified',
  jsonb_build_object('items', true, 'images', true, 'content_html', true, 'cities', true, 'sectors', true, 'pagination', 'next')
),
(
  'press_ajans_rss', 'Press Haber Ajansı (RSS)', 'https://www.press.org.tr',
  'https://www.press.org.tr/ajans/rss.xml', 'rss',
  'PHA ücretsiz RSS akışı. Kaynak atfı zorunlu.',
  'https://www.press.org.tr/ucretsiz-haber-api',
  array['trabzon-gundem','son-dakika','ekonomi','teknoloji'], true, 11,
  null, 'https://www.press.org.tr/ucretsiz-haber-api', 'none', null, '{}'::jsonb,
  jsonb_build_object('json', 'https://www.press.org.tr/ajans/feed.json'),
  false, 'unverified', jsonb_build_object('items', true, 'images', true, 'content_html', true)
),
(
  'press_ajans_api', 'Press Haber Ajansı (REST API)', 'https://www.press.org.tr',
  'https://www.press.org.tr/api/v1/haberler', 'rest_json',
  'PHA REST API anahtar gerektirir (Authorization: Bearer pha_… veya X-API-Key). İl filtresi: il=trabzon.',
  'https://www.press.org.tr/ucretsiz-haber-api',
  array['trabzon-gundem','son-dakika','spor','ekonomi'], true, 12,
  'https://www.press.org.tr/api/v1', 'https://www.press.org.tr/ucretsiz-haber-api', 'bearer', 'Authorization',
  '{"il":"trabzon","adet":"50"}'::jsonb,
  jsonb_build_object('codes', 'https://www.press.org.tr/api/v1/kodlar'),
  true, 'unverified',
  jsonb_build_object('items', true, 'pagination', 'next', 'city_filter', true, 'sector_filter', true, 'since_filter', true)
),
(
  'trabzonsonhaber_rss', 'Trabzon Son Haber', 'https://www.trabzonsonhaber.com',
  'https://www.trabzonsonhaber.com/rss', 'rss',
  'RSS erişimi açık. Yeniden yayın izni yazılı olarak doğrulanmadan tam metin/görsel yayımlanmamalıdır.',
  'https://www.trabzonsonhaber.com/developers',
  array['trabzon-gundem','son-dakika','spor','ekonomi','kultur-sanat'], true, 20,
  null, 'https://www.trabzonsonhaber.com/developers', 'none', null, '{}'::jsonb,
  jsonb_build_object(
    'gundem', 'https://www.trabzonsonhaber.com/rss/gundem',
    'spor', 'https://www.trabzonsonhaber.com/rss/spor',
    'ekonomi', 'https://www.trabzonsonhaber.com/rss/ekonomi',
    'dunya', 'https://www.trabzonsonhaber.com/rss/dunya',
    'kultur-sanat', 'https://www.trabzonsonhaber.com/rss/kultur-sanat',
    'saglik', 'https://www.trabzonsonhaber.com/rss/saglik',
    'teknoloji', 'https://www.trabzonsonhaber.com/rss/teknoloji',
    'magazin', 'https://www.trabzonsonhaber.com/rss/magazin',
    'politika', 'https://www.trabzonsonhaber.com/rss/politika',
    'seyahat', 'https://www.trabzonsonhaber.com/rss/seyahat'
  ), false, 'unverified',
  jsonb_build_object('items', true, 'images', true, 'custom_image_tag', true, 'author', true)
),
(
  'habertrabzon_rss', 'Haber Trabzon', 'https://www.habertrabzon.tr',
  'https://www.habertrabzon.tr/rss', 'rss',
  'RSS erişimi açık. Yayın hakkı doğrulanmadan tam metin/görsel otomatik yayımlanmamalıdır.',
  'https://www.habertrabzon.tr/rss-baglantilari',
  array['trabzon-gundem','son-dakika','spor','trabzonspor'], true, 30,
  null, 'https://www.habertrabzon.tr/rss-baglantilari', 'none', null, '{}'::jsonb,
  jsonb_build_object(
    'trabzon-haberleri', 'https://www.habertrabzon.tr/rss/trabzon-haberleri',
    'son-dakika', 'https://www.habertrabzon.tr/rss/son-dakika',
    'spor-haberleri', 'https://www.habertrabzon.tr/rss/spor-haberleri',
    'trabzonspor-haberleri', 'https://www.habertrabzon.tr/rss/trabzonspor-haberleri',
    'karadeniz-haber', 'https://www.habertrabzon.tr/rss/karadeniz-haber',
    'tum-mansetler', 'https://www.habertrabzon.tr/rss/tum-mansetler',
    'video', 'https://www.habertrabzon.tr/rss/video'
  ), false, 'unverified',
  jsonb_build_object('items', true, 'images', true, 'content_html', true, 'author', true)
),
(
  '61saat_rss', '61saat', 'https://www.61saat.com',
  'https://www.61saat.com/rss', 'rss',
  'RSS erişimi açık. 61saat içerikleri telif korumalıdır; yeniden yayın izni olmadan tam metin kullanılmamalıdır.',
  'https://www.61saat.com/rss-baglantilari',
  array['trabzon-gundem','son-dakika','trabzonspor','spor'], true, 40,
  null, 'https://www.61saat.com/rss-baglantilari', 'none', null, '{}'::jsonb,
  jsonb_build_object(
    'trabzon', 'https://www.61saat.com/rss/trabzon',
    'son-dakika', 'https://www.61saat.com/rss/son-dakika',
    'gundem', 'https://www.61saat.com/rss/gundem',
    'spor', 'https://www.61saat.com/rss/spor',
    'trabzonspor', 'https://www.61saat.com/rss/trabzonspor',
    'ekonomi', 'https://www.61saat.com/rss/ekonomi',
    'egitim', 'https://www.61saat.com/rss/egitim',
    'bolgesel', 'https://www.61saat.com/rss/bolgesel',
    'genel', 'https://www.61saat.com/rss/genel',
    'ozel-haber', 'https://www.61saat.com/rss/ozel-haber',
    'resmi-ilanlar', 'https://www.61saat.com/rss/resmi-ilanlar',
    'tum-mansetler', 'https://www.61saat.com/rss/tum-mansetler'
  ), false, 'unverified',
  jsonb_build_object('items', true, 'images', true, 'content_html', true, 'author', true)
),
(
  'haberts_rss', 'HaberTS', 'https://www.haberts.com',
  'https://www.haberts.com/rss', 'rss',
  'RSS erişimi açık. Yeniden yayın izni doğrulanmadan tam metin/görsel yayımlanmamalıdır.',
  'https://www.haberts.com/rss-baglantilari',
  array['trabzon-gundem','son-dakika','trabzonspor','spor'], true, 50,
  null, 'https://www.haberts.com/rss-baglantilari', 'none', null, '{}'::jsonb,
  jsonb_build_object(
    'trabzon-gundemi', 'https://www.haberts.com/rss/trabzon-gundemi',
    'son-dakika', 'https://www.haberts.com/rss/son-dakika',
    'gundem', 'https://www.haberts.com/rss/gundem',
    'spor', 'https://www.haberts.com/rss/spor',
    'trabzonspor', 'https://www.haberts.com/rss/trabzonspor',
    'transfer-haberleri', 'https://www.haberts.com/rss/transfer-haberleri',
    'ekonomi', 'https://www.haberts.com/rss/ekonomi',
    'asayis', 'https://www.haberts.com/rss/asayis',
    'egitim', 'https://www.haberts.com/rss/egitim',
    'kultur-sanat', 'https://www.haberts.com/rss/kultur-sanat',
    'saglik', 'https://www.haberts.com/rss/saglik',
    'tum-mansetler', 'https://www.haberts.com/rss/tum-mansetler'
  ), false, 'unverified',
  jsonb_build_object('items', true, 'images', true, 'content_html', true, 'author', true)
)
on conflict (code) do update set
  name = excluded.name,
  homepage_url = excluded.homepage_url,
  feed_url = excluded.feed_url,
  connector_kind = excluded.connector_kind,
  license_note = excluded.license_note,
  rights_url = excluded.rights_url,
  default_categories = excluded.default_categories,
  is_verified = excluded.is_verified,
  sort_order = excluded.sort_order,
  api_base = excluded.api_base,
  docs_url = excluded.docs_url,
  auth_kind = excluded.auth_kind,
  auth_header_name = excluded.auth_header_name,
  default_params = excluded.default_params,
  feed_variants = excluded.feed_variants,
  requires_api_key = excluded.requires_api_key,
  license_status = excluded.license_status,
  capabilities = excluded.capabilities;

-- ---------------------------------------------------------------------------
-- 7. Gerçek kaynak bağlantıları (taslak; lisans doğrulanana kadar yayın kapalı)
-- ---------------------------------------------------------------------------
insert into public.news_api_connections (
  code, name, description, homepage_url, feed_url, connector_kind, http_method,
  auth_kind, default_params, items_path, pagination_kind, next_path, timezone,
  poll_interval_minutes, status, auto_publish_enabled, publish_mode,
  max_items_per_run, page_limit, license_status, license_note, ai_classification,
  regions, notes
)
select
  s.code, s.name, s.description, s.homepage_url, s.feed_url, s.connector_kind, 'GET',
  s.auth_kind, s.default_params, s.items_path, s.pagination_kind, s.next_path, 'Europe/Istanbul',
  s.poll_interval_minutes, 'draft', false, 'discovery',
  20, 1, 'unverified', s.license_note, true,
  array['trabzon'], s.notes
from (values
  (
    'press-haber-ajansi', 'Press Haber Ajansı',
    'PHA ücretsiz JSON Feed akışı (Trabzon ve ilçe filtreleriyle birlikte değerlendirilir).',
    'https://www.press.org.tr', 'https://www.press.org.tr/ajans/feed.json', 'json_feed',
    'none', '{}'::jsonb, null::text, 'next_url', 'next', 15,
    'PHA ücretsiz haber akışı. Kaynak atfı zorunludur. Ticari yeniden yayın için PHA kullanım koşulları doğrulanmalıdır.',
    'Şablon: press_ajans_json. Alternatif RSS: https://www.press.org.tr/ajans/rss.xml. Anahtarlı REST API: /api/v1/haberler (il=trabzon).'
  ),
  (
    'trabzonsonhaber', 'Trabzon Son Haber',
    'Trabzon Son Haber genel RSS akışı; kategori akışları şablonda tanımlıdır.',
    'https://www.trabzonsonhaber.com', 'https://www.trabzonsonhaber.com/rss', 'rss',
    'none', '{}'::jsonb, null::text, 'none', null, 30,
    'RSS erişimi açık. Yeniden yayın izni yazılı olarak doğrulanmadan tam metin ve görsel yayımlanmamalıdır.',
    'Şablon: trabzonsonhaber_rss. Yayın izni doğrulanana kadar yalnızca keşif/özet modu kullanılabilir.'
  ),
  (
    'haber-trabzon', 'Haber Trabzon',
    'Haber Trabzon genel RSS akışı; Trabzon ve Trabzonspor kategorileri mevcut.',
    'https://www.habertrabzon.tr', 'https://www.habertrabzon.tr/rss', 'rss',
    'none', '{}'::jsonb, null::text, 'none', null, 30,
    'RSS erişimi açık. Yayın hakkı doğrulanmadan tam metin/görsel otomatik yayımlanmamalıdır.',
    'Şablon: habertrabzon_rss.'
  ),
  (
    '61saat', '61saat',
    '61saat Trabzon haber RSS akışı; son dakika ve Trabzonspor kategori akışları mevcut.',
    'https://www.61saat.com', 'https://www.61saat.com/rss', 'rss',
    'none', '{}'::jsonb, null::text, 'none', null, 30,
    'RSS erişimi açık. İçerikler telif korumalıdır; yeniden yayın izni olmadan tam metin kullanılmamalıdır.',
    'Şablon: 61saat_rss.'
  ),
  (
    'haberts', 'HaberTS',
    'HaberTS Trabzon haber RSS akışı; Trabzonspor ve transfer kategorileri mevcut.',
    'https://www.haberts.com', 'https://www.haberts.com/rss', 'rss',
    'none', '{}'::jsonb, null::text, 'none', null, 30,
    'RSS erişimi açık. Yeniden yayın izni doğrulanmadan tam metin/görsel yayımlanmamalıdır.',
    'Şablon: haberts_rss.'
  )
) as s(code, name, description, homepage_url, feed_url, connector_kind, auth_kind,
       default_params, items_path, pagination_kind, next_path, poll_interval_minutes,
       license_note, notes)
on conflict (code) do nothing;

-- Yetki kayıtları: hiçbir kaynak için yeniden yayın izni varsayılmaz
insert into public.news_source_permissions (
  connection_id, can_republish_text, can_republish_summary, can_use_images,
  can_use_logo, can_use_video, attribution_required, attribution_text, terms_url
)
select c.id, false, false, false, false, false, true,
       'Haber kaynağı: ' || c.name, c.homepage_url
from public.news_api_connections c
where c.code in ('press-haber-ajansi','trabzonsonhaber','haber-trabzon','61saat','haberts')
  and not exists (select 1 from public.news_source_permissions p where p.connection_id = c.id);

insert into public.news_api_credentials (connection_id, auth_kind)
select c.id, c.auth_kind
from public.news_api_connections c
where c.code in ('press-haber-ajansi','trabzonsonhaber','haber-trabzon','61saat','haberts')
  and not exists (select 1 from public.news_api_credentials cr where cr.connection_id = c.id);

insert into public.news_api_filters (connection_id, categories, news_types, location, content, date_window_hours, max_age_days)
select c.id,
       array['trabzon-gundem','son-dakika','trabzonspor','spor'],
       '{}'::text[],
       '{"mode":"trabzon_all","districts":[]}'::jsonb,
       '{}'::jsonb,
       72, 30
from public.news_api_connections c
where c.code in ('press-haber-ajansi','trabzonsonhaber','haber-trabzon','61saat','haberts')
  and not exists (select 1 from public.news_api_filters f where f.connection_id = c.id);

insert into public.news_source_profiles (connection_id, display_name, username, website, description, verified, status)
select c.id, c.name, c.code, c.homepage_url,
       c.name || ' — Trabzone üzerinde doğrulanmış haber kaynağı bağlantısı.',
       false, 'unpublished'
from public.news_api_connections c
where c.code in ('press-haber-ajansi','trabzonsonhaber','haber-trabzon','61saat','haberts')
  and not exists (select 1 from public.news_source_profiles sp where sp.connection_id = c.id);

-- Alan eşleşmeleri (adapter varsayılanları; yönetici panelden değiştirebilir)
insert into public.news_api_field_mappings (connection_id, field_key, source_path, transform, is_auto)
select c.id, m.field_key, m.source_path, m.transform, true
from public.news_api_connections c
join (values
  ('rss', 'external_id', 'guid', 'none'),
  ('rss', 'title', 'title', 'none'),
  ('rss', 'summary', 'description', 'html_to_text'),
  ('rss', 'body', 'content:encoded', 'none'),
  ('rss', 'url', 'link', 'absolute_url'),
  ('rss', 'published_at', 'pubDate', 'iso_date'),
  ('rss', 'image_url', 'media:content@url', 'absolute_url'),
  ('rss', 'author', 'dc:creator', 'none'),
  ('rss', 'category', 'category', 'none'),
  ('json_feed', 'external_id', 'id', 'none'),
  ('json_feed', 'title', 'title', 'none'),
  ('json_feed', 'summary', 'summary', 'html_to_text'),
  ('json_feed', 'body', 'content_html', 'none'),
  ('json_feed', 'url', 'url', 'absolute_url'),
  ('json_feed', 'published_at', 'date_published', 'iso_date'),
  ('json_feed', 'updated_at', 'date_modified', 'iso_date'),
  ('json_feed', 'image_url', 'image', 'absolute_url'),
  ('json_feed', 'author', 'authors[0].name', 'none'),
  ('json_feed', 'source_name', '_press.organization', 'none'),
  ('json_feed', 'category', '_press.sectors[0].name', 'none'),
  ('json_feed', 'city', '_press.cities[0].name', 'none'),
  ('json_feed', 'tags', 'tags', 'none'),
  ('rest_json', 'external_id', 'items[].id', 'none'),
  ('rest_json', 'title', 'items[].title', 'none'),
  ('rest_json', 'summary', 'items[].summary', 'html_to_text'),
  ('rest_json', 'body', 'items[].content_html', 'none'),
  ('rest_json', 'url', 'items[].url', 'absolute_url'),
  ('rest_json', 'published_at', 'items[].date_published', 'iso_date'),
  ('rest_json', 'image_url', 'items[].image', 'absolute_url'),
  ('rest_json', 'author', 'items[].organization', 'none'),
  ('rest_json', 'category', 'items[].sectors[0].name', 'none'),
  ('rest_json', 'city', 'items[].cities[0].name', 'none')
) as m(kind, field_key, source_path, transform)
  on m.kind = case
    when c.connector_kind in ('rss','atom','xml') then 'rss'
    when c.connector_kind = 'json_feed' then 'json_feed'
    else 'rest_json'
  end
where c.code in ('press-haber-ajansi','trabzonsonhaber','haber-trabzon','61saat','haberts')
  and not exists (select 1 from public.news_api_field_mappings f where f.connection_id = c.id);

-- Kategori eşleşmeleri (kaynak kategori adı → Trabzone kategorisi)
insert into public.news_api_category_mappings (connection_id, source_category, target_slug, is_auto)
select c.id, m.source_category, m.target_slug, true
from public.news_api_connections c
join (values
  ('gündem', 'trabzon-gundem'), ('gundem', 'trabzon-gundem'), ('trabzon', 'trabzon-gundem'),
  ('trabzon gündemi', 'trabzon-gundem'), ('trabzon-gundemi', 'trabzon-gundem'),
  ('son dakika', 'son-dakika'), ('son-dakika', 'son-dakika'),
  ('trabzonspor', 'trabzonspor'), ('trabzonspor haberleri', 'trabzonspor'),
  ('spor', 'spor'), ('futbol', 'spor'), ('basketbol', 'spor'), ('spor haberleri', 'spor'),
  ('ekonomi', 'ekonomi'), ('emlak', 'emlak'), ('belediyeler', 'belediyeler'),
  ('kamu', 'kamu-duyurulari'), ('resmi ilanlar', 'kamu-duyurulari'),
  ('asayiş', 'trabzon-gundem'), ('asayis', 'trabzon-gundem'), ('kaza', 'trabzon-gundem'),
  ('eğitim', 'egitim'), ('egitim', 'egitim'), ('kültür-sanat', 'kultur-sanat'),
  ('kultur sanat', 'kultur-sanat'), ('kültür ve sanat', 'kultur-sanat'),
  ('sağlık', 'saglik'), ('saglik', 'saglik'), ('teknoloji', 'teknoloji'),
  ('bilim teknoloji', 'teknoloji'), ('yaşam', 'yasam'), ('yasam', 'yasam'),
  ('turizm', 'turizm'), ('seyahat', 'turizm'), ('tarım', 'tarim'), ('tarim', 'tarim'),
  ('iş dünyası', 'is-dunyasi'), ('politika', 'trabzon-gundem'), ('siyaset', 'trabzon-gundem'),
  ('dünya', 'trabzon-gundem'), ('dunya', 'trabzon-gundem'), ('magazin', 'yasam'),
  ('genel', 'trabzon-gundem'), ('bolgesel', 'trabzon-gundem'), ('bölgesel', 'trabzon-gundem')
) as m(source_category, target_slug) on true
where c.code in ('press-haber-ajansi','trabzonsonhaber','haber-trabzon','61saat','haberts')
  and not exists (select 1 from public.news_api_category_mappings cm where cm.connection_id = c.id);

notify pgrst, 'reload schema';
