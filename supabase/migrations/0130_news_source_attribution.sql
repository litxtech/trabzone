-- ---------------------------------------------------------------------------
-- TRABZONE — Haber kaynağı atfı (0109)
--  * Akış kartlarında kaynak kurumu logosu + adı + orijinal haber bağlantısı.
--  * Gövde metnindeki ham URL kaldırılır; bağlantı yapısal alandan gelir.
--  * Ai haberleri (`ai_news_publications`) etkilenmez; kaynak modu ayrıdır.
-- ---------------------------------------------------------------------------

-- 1) Kaynak haberin atıf bilgisi ------------------------------------------------
create or replace function public.news_source_post_meta(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'name', coalesce(
      nullif(btrim(coalesce(sp.display_name, '')), ''),
      nullif(btrim(coalesce(pp.display_name, '')), ''),
      nullif(btrim(coalesce(i.source_name, '')), ''),
      nullif(btrim(coalesce(c.name, '')), ''),
      'Haber kaynağı'
    ),
    'username', nullif(btrim(coalesce(sp.username, pp.username, '')), ''),
    'domain', nullif(btrim(split_part(regexp_replace(coalesce(i.canonical_url, ''), '^https?://', ''), '/', 1)), ''),
    'url', i.canonical_url,
    'logo_url', coalesce(
      nullif(btrim(coalesce(sp.avatar_url, '')), ''),
      case
        when nullif(btrim(coalesce(i.canonical_url, '')), '') is null then null
        else 'https://www.google.com/s2/favicons?sz=128&domain=' ||
             split_part(regexp_replace(i.canonical_url, '^https?://', ''), '/', 1)
      end
    ),
    'verified', coalesce(sp.verified, pp.is_verified, false),
    'author', nullif(btrim(coalesce(i.author, '')), ''),
    'mode', l.mode,
    'attribution', nullif(btrim(coalesce(i.license_snapshot ->> 'attribution_text', '')), ''),
    'license_status', c.license_status,
    'same_as_author', pp.id is not null and pp.id = p.author_id,
    'published_at', l.published_at
  )
  from public.news_publication_links l
    join public.news_source_items i on i.id = l.item_id
    join public.posts p on p.id = l.post_id
    left join public.news_api_connections c on c.id = i.connection_id
    left join public.news_source_profiles sp on sp.connection_id = i.connection_id
    left join public.profiles pp on pp.id = sp.profile_id
  where l.post_id = p_post_id
    and l.status = 'published'
  order by l.published_at
  limit 1;
$$;

revoke all on function public.news_source_post_meta(uuid) from public, anon, authenticated;

-- 2) Akış kartı JSON'una kaynak bilgisini ekle -----------------------------------
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
    'source', public.news_source_post_meta(p.id),
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

-- 3) Gövde metninde ham URL yerine yalnızca kaynak adı ---------------------------
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
      case
        when coalesce(nullif(btrim(coalesce(p_district, '')), ''), 'Trabzon') in ('Trabzon', 'trabzon', 'TRABZON')
          then E'📍 Trabzon'
        else E'📍 ' || btrim(p_district) || ', Trabzon'
      end
        || E'\n🗂 ' || coalesce(nullif(btrim(coalesce(p_category_name, '')), ''), 'Trabzon Gündem')
        || E'\n🔗 Kaynak: ' || coalesce(nullif(btrim(coalesce(p_source_name, '')), ''), 'Haber kaynağı')
        || coalesce(
             ' · ' || nullif(
               btrim(split_part(regexp_replace(coalesce(p_url, ''), '^https?://', ''), '/', 1)),
               ''
             ),
             ''
           )
        || case
             when nullif(btrim(coalesce(p_attribution, '')), '') is null then ''
             when lower(
               btrim(
                 coalesce(
                   nullif(btrim(split_part(btrim(p_attribution), ':', 2)), ''),
                   btrim(p_attribution)
                 )
               )
             ) = lower(btrim(coalesce(p_source_name, ''))) then ''
             else E'\n' || btrim(p_attribution)
           end
    ),
    2000
  );
$$;

-- 4) Kaynak logosu / bağlantısı olmayan kanallar için hızlı denetim --------------
create or replace function public.news_source_attribution_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'connection_id', c.id,
        'code', c.code,
        'name', c.name,
        'publish_mode', c.publish_mode,
        'homepage_url', c.homepage_url,
        'logo_url', sp.avatar_url,
        'verified', coalesce(sp.verified, false),
        'profile_linked', sp.profile_id is not null,
        'ready', sp.avatar_url is not null
      )
      order by c.code
    ),
    '[]'::jsonb
  )
  from public.news_api_connections c
    left join public.news_source_profiles sp on sp.connection_id = c.id;
$$;

revoke all on function public.news_source_attribution_status() from public, anon;
grant execute on function public.news_source_attribution_status() to authenticated, service_role;
