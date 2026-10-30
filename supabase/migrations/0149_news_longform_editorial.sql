-- ---------------------------------------------------------------------------
-- 0146 — Haberlerde daha geniş ve doyurucu metin
--
-- Neden gerekli?
--   * Kaynak akışlarının (RSS/JSON) büyük bölümü yalnızca 1-2 cümlelik özet
--     taşıyor. Bu durumda `news_publish_item` gövdeyi özet + konum/footer ile
--     kuruyor ve okuyucu "devamını oku" ekranında birkaç satır görüyordu.
--   * Editoryal uzunluk hedefleri (120-200 / 250-450 / 500-800 kelime) kısa
--     haberi neredeyse tek seçenek haline getiriyordu.
--
-- Bu migration:
--   1) Uzunluk hedeflerini gerçek haber ölçeğine çeker (varsayılanda kalmış
--      kurulumları bozmadan).
--   2) AI ile yazılmış özgün gövdenin kaynak haber kaydına yazılmasını sağlar
--      (`news_item_save_editorial`).
--   3) Yayın sırasında bu özgün gövdeyi kullanır; böylece okuyucu özet değil
--      tam haber görür.
--   4) Eski/özet kalmış haberler için toplu iyileştirme kuyruğu sunar.
-- ---------------------------------------------------------------------------

-- 1) Editoryal uzunluk hedefleri ------------------------------------------
-- Yalnızca hâlâ eski varsayılanlarda olan kurulumlar yükseltilir; yönetici
-- kendi değerlerini girdiyse dokunulmaz.
update public.ai_news_settings
   set short_min_words = 150,
       short_max_words = 280,
       standard_min_words = 380,
       standard_max_words = 700,
       extended_min_words = 700,
       extended_max_words = 1200
 where id = true
   and short_max_words <= 200
   and standard_max_words <= 450
   and extended_max_words <= 800;

-- 2) AI/editoryal gövdeyi kaynak haber kaydına yaz -------------------------
create or replace function public.news_item_save_editorial(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := nullif(btrim(coalesce(p_payload ->> 'title', '')), '');
  v_subtitle text := nullif(btrim(coalesce(p_payload ->> 'subtitle', '')), '');
  v_spot text := nullif(btrim(coalesce(p_payload ->> 'spot', '')), '');
  v_lead text := nullif(btrim(coalesce(p_payload ->> 'lead', '')), '');
  v_body text := nullif(btrim(coalesce(p_payload ->> 'body', '')), '');
  v_source text := nullif(btrim(coalesce(p_payload ->> 'body_source', '')), '');
  v_words integer;
  v_format text;
  v_quality numeric;
  v_written integer;
begin
  if not exists (select 1 from public.news_source_items where id = p_id) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;

  if v_body is null or char_length(v_body) < 400 then
    raise exception 'editorial_body_too_short' using errcode = '22023';
  end if;

  v_words := public.news_word_count(v_body);
  v_format := public.news_effective_format(v_words, null);
  v_quality := case
    when (p_payload ->> 'quality_score') ~ '^[0-9]+(\.[0-9]+)?$'
      then least(greatest((p_payload ->> 'quality_score')::numeric, 0), 1)
    else null
  end;

  update public.news_source_items
     set title = coalesce(v_title, title),
         subtitle = coalesce(v_subtitle, subtitle),
         summary = coalesce(v_spot, summary),
         lead = coalesce(v_lead, lead),
         body = left(v_body, 20000),
         body_format = v_format,
         body_source = case when v_source in ('ai', 'editor') then v_source else 'ai' end,
         quality_score = coalesce(v_quality, quality_score),
         editorial_checks = coalesce(p_payload -> 'editorial_checks', editorial_checks),
         body_updated_at = now()
   where id = p_id;

  get diagnostics v_written = row_count;
  return jsonb_build_object(
    'ok', v_written > 0,
    'item_id', p_id,
    'word_count', v_words,
    'body_format', v_format
  );
end;
$$;

revoke all on function public.news_item_save_editorial(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.news_item_save_editorial(uuid, jsonb) to service_role;

-- 3) Yayın: özgün AI/editoryal gövde varsa onu kullan ----------------------
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
  v_editorial boolean := false;
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
           'editorial_body', v_editorial,
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
    'media_paths', v_media_paths
  );
end;
$$;

-- 4) Eski/özet kalmış haberler için iyileştirme kuyruğu --------------------
create or replace function public.news_editorial_backlog(p_limit integer default 10)
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
      'post_id', i.post_id,
      'title', i.title,
      'summary', i.summary,
      'body', left(coalesce(i.body, ''), 4000),
      'url', i.canonical_url,
      'source_name', i.source_name,
      'source_category', i.source_category,
      'district', i.district,
      'category_slug', i.category_slug,
      'status', i.status
    ) order by coalesce(i.published_at, i.first_seen_at) desc)
    from (
      select i.*
      from public.news_source_items i
      join public.news_api_connections c on c.id = i.connection_id
      where coalesce(i.body_source, 'source') not in ('ai', 'editor')
        and i.status in ('new', 'published')
        and char_length(btrim(coalesce(i.body, ''))) < 1200
      order by coalesce(i.published_at, i.first_seen_at) desc
      limit least(greatest(coalesce(p_limit, 10), 1), 25)
    ) i
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.news_editorial_backlog(integer) from public, anon, authenticated;
grant execute on function public.news_editorial_backlog(integer) to service_role;

-- 5) Günlük AI yazım sayacı ------------------------------------------------
create or replace function public.news_editorial_writes_today()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.news_source_items
  where body_source = 'ai'
    and body_updated_at >= (date_trunc('day', now() at time zone 'Europe/Istanbul')
      at time zone 'Europe/Istanbul');
$$;

revoke all on function public.news_editorial_writes_today() from public, anon, authenticated;
grant execute on function public.news_editorial_writes_today() to service_role;
