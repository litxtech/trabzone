-- 0054: Video önizleme kapakları ve süre sınırının kaldırılması
--
-- 1) Gönderi videoları için kapak (poster) yolu eklenir. Feed, videoyu
--    indirmeden önizleme gösterebilir.
-- 2) Depolama kova sınırları plan üst sınırına (50 MB) çekilir. İstemci
--    videoları yüklemeden önce 1080p'ye ve 45 MB altına sıkıştırır.
-- 3) Reels süre doğrulaması 10 dakikadan 24 saate çıkarılır; süre sınırı
--    ürün tarafında kaldırılmıştır.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Post media poster
-- ---------------------------------------------------------------------------
alter table public.post_media
  add column if not exists thumbnail_path text;

do $$
begin
  alter table public.post_media drop constraint if exists post_media_thumbnail_path_check;
  alter table public.post_media add constraint post_media_thumbnail_path_check
    check (thumbnail_path is null or char_length(thumbnail_path) between 3 and 400);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Storage limits (Free plan tek dosya sınırı: 50 MB)
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 52428800
 where id in ('posts', 'stories', 'reels', 'message-media');

-- ---------------------------------------------------------------------------
-- 3. Reels duration
-- ---------------------------------------------------------------------------
alter table public.reels drop constraint if exists reels_duration_check;
alter table public.reels add constraint reels_duration_check
  check (duration_ms is null or duration_ms between 0 and 86400000);

-- ---------------------------------------------------------------------------
-- 4. Serialisation: thumbnail_path
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

-- ---------------------------------------------------------------------------
-- 5. Post create: thumbnail kabul et
-- ---------------------------------------------------------------------------
create or replace function public.feed_create_post(
  p_body       text default null,
  p_media      jsonb default '[]'::jsonb,
  p_visibility text default 'public',
  p_city       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_body     text := nullif(trim(coalesce(p_body, '')), '');
  v_media    jsonb := coalesce(p_media, '[]'::jsonb);
  v_vis      text := coalesce(nullif(trim(p_visibility), ''), 'public');
  v_item     jsonb;
  v_count    integer := 0;
  v_post_id  uuid;
  v_type     text;
  v_thumb    text;
  v_index    integer := 0;
begin
  if v_vis not in ('public', 'followers') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  if v_body is not null and char_length(v_body) > 2000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;

  if jsonb_typeof(v_media) <> 'array' then
    raise exception 'invalid_media' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(v_media);
  if v_count > 10 then
    raise exception 'too_many_media' using errcode = '22023';
  end if;

  if v_body is null and v_count = 0 then
    raise exception 'empty_post' using errcode = '22023';
  end if;

  perform public.safety_check_rate('post_create', 20, interval '1 day');

  insert into public.posts (author_id, body, visibility, city)
  values (v_uid, v_body, v_vis, nullif(trim(coalesce(p_city, '')), ''))
  returning id into v_post_id;

  for v_item in select * from jsonb_array_elements(v_media)
  loop
    v_type := v_item ->> 'media_type';
    if v_type not in ('image', 'video') then
      raise exception 'invalid_media_type' using errcode = '22023';
    end if;

    perform public.tz_validate_media_path(v_item ->> 'storage_path', v_uid);

    v_thumb := nullif(trim(coalesce(v_item ->> 'thumbnail_path', '')), '');
    if v_thumb is not null then
      perform public.tz_validate_media_path(v_thumb, v_uid);
    end if;

    insert into public.post_media (
      post_id, storage_path, thumbnail_path, media_type, width, height, duration_ms, sort_order
    )
    values (
      v_post_id,
      v_item ->> 'storage_path',
      v_thumb,
      v_type,
      nullif(v_item ->> 'width', '')::integer,
      nullif(v_item ->> 'height', '')::integer,
      nullif(v_item ->> 'duration_ms', '')::integer,
      v_index
    );

    v_index := v_index + 1;
  end loop;

  return jsonb_build_object('id', v_post_id);
end;
$$;

revoke all on function public.feed_create_post(text, jsonb, text, text) from public, anon;
grant execute on function public.feed_create_post(text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Reel create: 24 saatlik doğrulama
-- ---------------------------------------------------------------------------
create or replace function public.reel_create(
  p_video_path  text,
  p_cover_path  text default null,
  p_caption     text default null,
  p_audio_title text default null,
  p_duration_ms integer default null,
  p_width       integer default null,
  p_height      integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.tz_require_uid();
  v_caption text := nullif(trim(coalesce(p_caption, '')), '');
  v_audio   text := nullif(trim(coalesce(p_audio_title, '')), '');
  v_cover   text := nullif(trim(coalesce(p_cover_path, '')), '');
  v_reel_id uuid;
begin
  perform public.tz_validate_media_path(p_video_path, v_uid);
  if v_cover is not null then
    perform public.tz_validate_media_path(v_cover, v_uid);
  end if;

  if v_caption is not null and char_length(v_caption) > 2200 then
    raise exception 'caption_too_long' using errcode = '22023';
  end if;

  if v_audio is not null and char_length(v_audio) > 120 then
    raise exception 'invalid_audio' using errcode = '22023';
  end if;

  if p_duration_ms is not null and (p_duration_ms < 0 or p_duration_ms > 86400000) then
    raise exception 'invalid_media_meta' using errcode = '22023';
  end if;

  perform public.safety_check_rate('reel_create', 20, interval '1 day');

  insert into public.reels (
    author_id, video_path, cover_path, caption, audio_title,
    duration_ms, width, height, status
  )
  values (
    v_uid, p_video_path, v_cover, v_caption, v_audio,
    p_duration_ms, p_width, p_height, 'ready'
  )
  returning id into v_reel_id;

  return public.tz_reel_json(v_reel_id, v_uid);
end;
$$;

revoke all on function public.reel_create(text, text, text, text, integer, integer, integer) from public, anon;
grant execute on function public.reel_create(text, text, text, text, integer, integer, integer) to authenticated;
