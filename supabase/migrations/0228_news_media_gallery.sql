-- ---------------------------------------------------------------------------
-- 0228 — Haber medyası: tam galeri + video aktarımı ve gevşetilmiş kapılar
--
-- Neden?
--   * Kaynak akışından gelen haberlerde yalnızca ilk görsel indiriliyordu.
--     Haberin sayfasında yayımlanan diğer fotoğraflar ve varsa video hiç
--     alınmıyordu.
--   * Yayın kapıları (AI reddi, risk C, sayfa arayüzü tespiti, lisans/bayrak
--     koşulları) haberleri `blocked` durumunda bırakıyor; görsel ve video
--     hiç yayımlanmıyordu.
--
-- Bu migration:
--   1) Kaynak haber kaydına çoklu görsel, video ve indirilen medya listesini
--      ekler.
--   2) Worker'ın medyayı tek çağrıda kaydetmesini sağlar.
--   3) Yayında tüm galeriyi `post_media`ya bağlar; video bağlantılarını gövdeye
--      ekler.
--   4) "Engelleme" kapılarını varsayılan olarak gevşetir; yönetici isterse
--      `news_api_settings` üzerinden sıkı moda dönebilir.
--   5) Otomatik duraklatma eşiğini 5 yerine yapılandırılabilir yapar ve
--      duraklatırken otomatik yayını kapatmaz.
-- ---------------------------------------------------------------------------

-- 1) Ayarlar ---------------------------------------------------------------
alter table public.news_api_settings
  add column if not exists media_gallery_enabled boolean not null default true,
  add column if not exists video_capture_enabled boolean not null default true,
  add column if not exists max_gallery_images integer not null default 10
    check (max_gallery_images between 1 and 10),
  add column if not exists max_video_mb integer not null default 40
    check (max_video_mb between 1 and 200),
  add column if not exists strict_ai_gate boolean not null default false,
  add column if not exists strict_risk_gate boolean not null default false,
  add column if not exists strict_page_chrome_gate boolean not null default false,
  add column if not exists auto_pause_failures integer not null default 10
    check (auto_pause_failures between 1 and 100),
  add column if not exists media_publish_requires_permission boolean not null default false,
  add column if not exists video_publish_requires_permission boolean not null default false,
  add column if not exists auto_publish_requires_permission boolean not null default false,
  add column if not exists auto_publish_requires_license boolean not null default false,
  add column if not exists allow_discovery_publish boolean not null default true;

-- 2) Kaynak haber medyası -------------------------------------------------
alter table public.news_source_items
  add column if not exists image_urls text[] not null default '{}'::text[],
  add column if not exists video_urls text[] not null default '{}'::text[],
  add column if not exists media jsonb not null default '[]'::jsonb,
  add column if not exists media_checked_at timestamptz;

create index if not exists news_source_items_media_idx
  on public.news_source_items ((jsonb_array_length(media)));

-- 3) Ayarları kaydet -------------------------------------------------------
create or replace function public.admin_news_settings_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_url text := nullif(btrim(coalesce(p_payload->>'worker_url', '')), '');
begin
  if v_url is not null then
    perform public.news_assert_public_url(v_url);
  end if;

  update public.news_api_settings
     set enabled = coalesce((p_payload->>'enabled')::boolean, enabled),
         worker_url = coalesce(v_url, worker_url),
         dispatch_interval_minutes = coalesce((p_payload->>'dispatch_interval_minutes')::int, dispatch_interval_minutes),
         ai_enabled = coalesce((p_payload->>'ai_enabled')::boolean, ai_enabled),
         ai_daily_budget = coalesce((p_payload->>'ai_daily_budget')::int, ai_daily_budget),
         media_download_enabled = coalesce((p_payload->>'media_download_enabled')::boolean, media_download_enabled),
         media_gallery_enabled = coalesce((p_payload->>'media_gallery_enabled')::boolean, media_gallery_enabled),
         video_capture_enabled = coalesce((p_payload->>'video_capture_enabled')::boolean, video_capture_enabled),
         max_gallery_images = coalesce((p_payload->>'max_gallery_images')::int, max_gallery_images),
         max_video_mb = coalesce((p_payload->>'max_video_mb')::int, max_video_mb),
         strict_ai_gate = coalesce((p_payload->>'strict_ai_gate')::boolean, strict_ai_gate),
         strict_risk_gate = coalesce((p_payload->>'strict_risk_gate')::boolean, strict_risk_gate),
         strict_page_chrome_gate = coalesce((p_payload->>'strict_page_chrome_gate')::boolean, strict_page_chrome_gate),
         auto_pause_failures = coalesce((p_payload->>'auto_pause_failures')::int, auto_pause_failures),
         media_publish_requires_permission = coalesce((p_payload->>'media_publish_requires_permission')::boolean, media_publish_requires_permission),
         video_publish_requires_permission = coalesce((p_payload->>'video_publish_requires_permission')::boolean, video_publish_requires_permission),
         auto_publish_requires_permission = coalesce((p_payload->>'auto_publish_requires_permission')::boolean, auto_publish_requires_permission),
         auto_publish_requires_license = coalesce((p_payload->>'auto_publish_requires_license')::boolean, auto_publish_requires_license),
         allow_discovery_publish = coalesce((p_payload->>'allow_discovery_publish')::boolean, allow_discovery_publish),
         updated_by = v_admin,
         updated_at = now()
   where id;

  perform public.tz_admin_audit(
    'news.settings.save', 'Haber API merkezi ayarları güncellendi', 'news_api_settings', 'singleton', p_payload
  );

  return public.admin_news_settings_get();
end;
$$;

-- 4) Worker medya kaydı ----------------------------------------------------
create or replace function public.news_worker_item_media_save(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.news_source_items%rowtype;
  v_images text[] := array[]::text[];
  v_videos text[] := array[]::text[];
  v_media jsonb := '[]'::jsonb;
  v_first_path text;
begin
  select * into v_item from public.news_source_items where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  if jsonb_typeof(p_payload->'image_urls') = 'array' then
    select coalesce(array_agg(btrim(value)), array[]::text[]) into v_images
    from jsonb_array_elements_text(p_payload->'image_urls')
    where btrim(value) <> '';
  end if;

  if jsonb_typeof(p_payload->'video_urls') = 'array' then
    select coalesce(array_agg(btrim(value)), array[]::text[]) into v_videos
    from jsonb_array_elements_text(p_payload->'video_urls')
    where btrim(value) <> '';
  end if;

  if jsonb_typeof(p_payload->'media') = 'array' then
    v_media := p_payload->'media';
  end if;

  select nullif(btrim(coalesce(value->>'storage_path', '')), '')
    into v_first_path
  from jsonb_array_elements(v_media) as value
  where coalesce(value->>'media_type', value->>'type', 'image') <> 'video'
  limit 1;

  update public.news_source_items
     set image_urls = v_images,
         video_urls = v_videos,
         media = v_media,
         media_checked_at = now(),
         image_url = coalesce(nullif(v_images[1], ''), image_url),
         video_url = coalesce(nullif(v_videos[1], ''), video_url),
         image_storage_path = coalesce(v_first_path, image_storage_path)
   where id = p_id
     and status not in ('removed', 'rejected');

  return jsonb_build_object(
    'ok', found,
    'media_count', jsonb_array_length(v_media),
    'image_count', coalesce(array_length(v_images, 1), 0),
    'video_count', coalesce(array_length(v_videos, 1), 0)
  );
end;
$$;

revoke all on function public.news_worker_item_media_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.news_worker_item_media_save(uuid, jsonb) to service_role;

-- 5) Yayın: tüm galeri + video --------------------------------------------
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
  v_settings public.news_api_settings%rowtype;
  v_mode text;
  v_link_mode text;
  v_include_body boolean := false;
  v_editorial boolean := false;
  v_body text;
  v_post_id uuid;
  v_attribution text;
  v_media_paths text[] := array[]::text[];
  v_images_allowed boolean := true;
  v_videos_allowed boolean := true;
  v_entry jsonb;
  v_path text;
  v_type text;
  v_slot smallint := 0;
  v_video_links text[];
  v_video_section text;
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
  if v_c.status not in ('active', 'paused') then
    raise exception 'connection_inactive' using errcode = '22023';
  end if;

  select * into v_settings from public.news_api_settings where id;

  select * into v_perm from public.news_source_permissions where connection_id = v_c.id;
  select * into v_source_profile from public.news_source_profiles where connection_id = v_c.id;

  if v_c.license_status = 'prohibited' then
    raise exception 'license_prohibited' using errcode = '22023';
  end if;

  v_mode := v_c.publish_mode;
  if v_mode = 'discovery' then
    if not coalesce(v_settings.allow_discovery_publish, true) then
      raise exception 'publish_mode_discovery' using errcode = '22023';
    end if;
    v_mode := 'trabzone_digest';
  end if;

  -- Gevşetilmiş varsayılan: yönetici izin kapısını yeniden açmadıkça yayın
  -- modu izin bayrakları yüzünden engellenmez; yalnızca "prohibited" lisans
  -- yukarıda durdurur.
  if coalesce(v_settings.auto_publish_requires_permission, false)
     and not public.news_publish_mode_permitted(
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

  -- Trabzone editoryasının kendi yazdığı metin telif kapsamı dışındadır:
  -- kaynak izni ne olursa olsun tam gövde olarak yayımlanır.
  v_editorial := coalesce(v_item.body_source, 'source') in ('ai', 'editor')
    and char_length(btrim(coalesce(v_item.body, ''))) >= 600;

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

  if v_editorial then
    v_body := left(
      concat_ws(
        E'\n\n',
        nullif(btrim(coalesce(v_item.lead, '')), ''),
        nullif(btrim(coalesce(v_item.body, '')), ''),
        E'📍 ' || coalesce(nullif(btrim(coalesce(v_item.district, '')), ''), 'Trabzon') || ', Trabzon'
          || E'\n🗂 ' || coalesce(nullif(btrim(coalesce(v_category.name_tr, '')), ''), 'Trabzon Gündem')
          || E'\n🔗 Kaynak: ' || coalesce(nullif(btrim(coalesce(v_item.source_name, '')), ''), 'Haber kaynağı')
          || ' — ' || coalesce(v_item.canonical_url, '')
          || case when nullif(btrim(coalesce(v_attribution, '')), '') is not null
                  then E'\n' || btrim(v_attribution) else '' end
      ),
      14000
    );
  else
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
  end if;

  if v_body is null or char_length(v_body) < 10 then
    raise exception 'empty_body' using errcode = '22023';
  end if;

  -- Medya izinleri: varsayılanda izin bayrağı aranmaz (gevşetilmiş mod).
  v_images_allowed := not coalesce(v_settings.media_publish_requires_permission, false)
    or coalesce(v_perm.can_use_images, false);
  v_videos_allowed := not coalesce(v_settings.video_publish_requires_permission, false)
    or coalesce(v_perm.can_use_video, false);

  -- İndirilen videolar dışında kalan (YouTube/Vimeo gibi) video bağlantıları
  -- gövdeye tıklanabilir bağlantı olarak eklenir.
  if v_videos_allowed and coalesce(array_length(v_item.video_urls, 1), 0) > 0 then
    select array_agg(u) into v_video_links
    from unnest(v_item.video_urls) as u
    where u ~* '^https?://'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(v_item.media, '[]'::jsonb)) as e
        where e->>'source_url' = u
      );

    if coalesce(array_length(v_video_links, 1), 0) > 0 then
      v_video_section := E'\n\n## Video\n' || array_to_string(
        array(select '🎬 [Videoyu izle](' || u || ')' from unnest(v_video_links) as u),
        E'\n'
      );
    end if;
  end if;

  -- `posts.body` üst sınırı 2000 karakterdir. Video bağlantıları kesilmesin
  -- diye önce onlara yer ayrılır, ana metin kalan alana sığdırılır.
  v_body := left(v_body, greatest(0, 2000 - char_length(coalesce(v_video_section, ''))))
    || coalesce(v_video_section, '');

  insert into public.posts (author_id, body, visibility, city)
  values (v_publisher.id, v_body, 'public', 'Trabzon')
  returning id into v_post_id;

  -- Tüm indirilen görseller (en fazla 10) ve videolar sırayla bağlanır.
  -- Görseller önce gelir; kapak görseli ilk fotoğraf olur.
  if jsonb_typeof(v_item.media) = 'array' then
    for v_entry in
      select value
      from jsonb_array_elements(v_item.media) as t(value)
      order by (case when coalesce(value->>'media_type', value->>'type', 'image') = 'video' then 1 else 0 end),
               coalesce(nullif(value->>'sort_order', '')::int, 0)
    loop
      exit when v_slot >= 10;
      v_path := nullif(btrim(coalesce(v_entry->>'storage_path', '')), '');
      if v_path is null then
        continue;
      end if;
      v_type := case
        when coalesce(v_entry->>'media_type', v_entry->>'type', 'image') = 'video' then 'video'
        else 'image'
      end;
      if v_type = 'image' and not v_images_allowed then
        continue;
      end if;
      if v_type = 'video' and not v_videos_allowed then
        continue;
      end if;

      insert into public.post_media (post_id, storage_path, media_type, width, height, duration_ms, sort_order)
      values (
        v_post_id,
        v_path,
        v_type,
        nullif(v_entry->>'width', '')::integer,
        nullif(v_entry->>'height', '')::integer,
        nullif(v_entry->>'duration_ms', '')::integer,
        v_slot
      )
      on conflict do nothing;

      v_media_paths := v_media_paths || v_path;
      v_slot := v_slot + 1;
    end loop;
  end if;

  -- Eski kayıtlarda yalnızca tek görsel yolu vardır.
  if v_slot = 0 and v_images_allowed
     and nullif(btrim(coalesce(v_item.image_storage_path, '')), '') is not null then
    insert into public.post_media (post_id, storage_path, media_type, sort_order)
    values (v_post_id, v_item.image_storage_path, 'image', 0);
    v_media_paths := array[v_item.image_storage_path];
  end if;

  if coalesce(v_settings.media_publish_requires_permission, false)
     and not coalesce(v_perm.can_use_images, false) then
    v_media_paths := array[]::text[];
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
           'can_use_video', v_perm.can_use_video,
           'attribution_required', v_perm.attribution_required,
           'attribution_text', v_attribution,
           'editorial_body', v_editorial,
           'media_gallery', v_slot,
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
    'editorial_body', v_editorial,
    'media_paths', v_media_paths,
    'video_links', coalesce(v_video_links, array[]::text[])
  );
end;
$$;

-- 6) Yayın kuyruğu: gevşetilmiş kapılar -----------------------------------
create or replace function public.news_worker_publish_queue(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.news_api_settings%rowtype;
begin
  select * into v_settings from public.news_api_settings where id;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', q.id,
      'connection_id', q.connection_id,
      'mode', q.publish_mode,
      'title', q.title
    ) order by q.first_seen_at)
    from (
      select i.id, i.connection_id, i.title, i.first_seen_at, c.publish_mode
      from public.news_source_items i
      join public.news_api_connections c on c.id = i.connection_id
      left join public.news_source_permissions p on p.connection_id = c.id
      where i.status = 'pending_review'
        and i.post_id is null
        and c.status = 'active'
        and c.auto_publish_enabled
        and c.license_status <> 'prohibited'
        and (
          c.publish_mode in ('source_profile', 'trabzone_digest', 'editor_approval')
          or (c.publish_mode = 'discovery' and coalesce(v_settings.allow_discovery_publish, true))
        )
        and (
          not coalesce(v_settings.auto_publish_requires_permission, false)
          or public.news_publish_mode_permitted(
            c.publish_mode,
            c.license_status,
            coalesce(p.can_republish_text, false),
            coalesce(p.can_republish_summary, false)
          )
        )
        and not exists (
          select 1 from public.news_source_items d
          where d.connection_id = i.connection_id
            and d.status = 'published'
            and d.published_at is not null
            and c.min_publish_interval_seconds > 0
            and d.published_at > now() - make_interval(secs => c.min_publish_interval_seconds)
        )
      order by i.first_seen_at
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) q
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.news_worker_publish_queue(integer) from public, anon, authenticated;
grant execute on function public.news_worker_publish_queue(integer) to service_role;

-- 7) Otomatik duraklatma eşiği --------------------------------------------
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
  v_pause_after integer := coalesce(
    (select auto_pause_failures from public.news_api_settings where id),
    10
  );
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

    -- Gevşetilmiş davranış: yalnızca yapılandırılmış eşiğe ulaşınca duraklat
    -- ve otomatik yayın anahtarını kapatma.
    if v_failures >= v_pause_after and exists (
      select 1 from public.news_api_connections where id = v_conn and status = 'active'
    ) then
      update public.news_api_connections
         set status = 'paused',
             auto_disabled_reason = 'Ardışık ' || v_pause_after || ' başarısız çekimden sonra otomatik duraklatıldı.'
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

revoke all on function public.news_worker_job_finish(jsonb) from public, anon, authenticated;
grant execute on function public.news_worker_job_finish(jsonb) to service_role;

-- 8) Kaldırılan haberin tüm medyasını temizlik kuyruğuna al -----------------
create or replace function public.news_item_media_cleanup_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paths text[] := array[]::text[];
  v_entry jsonb;
begin
  if new.status = 'removed' and old.status <> 'removed' then
    if nullif(btrim(coalesce(new.image_storage_path, '')), '') is not null then
      v_paths := v_paths || new.image_storage_path;
    end if;
    if jsonb_typeof(new.media) = 'array' then
      for v_entry in select value from jsonb_array_elements(new.media) loop
        if nullif(btrim(coalesce(v_entry->>'storage_path', '')), '') is not null then
          v_paths := v_paths || (v_entry->>'storage_path');
        end if;
      end loop;
    end if;
    if coalesce(array_length(v_paths, 1), 0) > 0 then
      perform public.news_media_cleanup_enqueue(
        new.connection_id, new.id, new.post_id, v_paths
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.news_item_media_cleanup_tg() from public, anon, authenticated;

drop trigger if exists news_item_media_cleanup on public.news_source_items;
create trigger news_item_media_cleanup
  after update of status on public.news_source_items
  for each row execute function public.news_item_media_cleanup_tg();
