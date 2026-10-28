-- 0022: Reels (full-screen vertical video)
--
-- Tum yazmalar security-definer RPC'lerden gecer; tablolar istemciye yalnizca
-- okuma icin aciktir. Video ve kapak dosyalari `reels` kovasinda kullanicinin
-- kendi klasoru altinda tutulur.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reels', 'reels', true, 104857600,
  array['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.reels (
  id                uuid primary key default gen_random_uuid(),
  author_id         uuid not null references public.profiles (id) on delete cascade,
  video_path        text not null,
  cover_path        text,
  caption           text,
  audio_title       text,
  duration_ms       integer,
  width             integer,
  height            integer,
  like_count        integer not null default 0,
  comment_count     integer not null default 0,
  save_count        integer not null default 0,
  share_count       integer not null default 0,
  view_count        integer not null default 0,
  status            text not null default 'ready',
  moderation_status text not null default 'visible',
  is_edited         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint reels_video_path_check check (char_length(video_path) between 3 and 400),
  constraint reels_cover_path_check check (cover_path is null or char_length(cover_path) between 3 and 400),
  constraint reels_caption_length check (caption is null or char_length(caption) <= 2200),
  constraint reels_audio_length check (audio_title is null or char_length(audio_title) <= 120),
  constraint reels_duration_check check (duration_ms is null or duration_ms between 0 and 600000),
  constraint reels_status_check check (status in ('processing', 'ready', 'failed')),
  constraint reels_moderation_check check (moderation_status in ('visible', 'hidden', 'removed')),
  constraint reels_counts_non_negative check (
    like_count >= 0 and comment_count >= 0 and save_count >= 0
    and share_count >= 0 and view_count >= 0
  )
);

create index if not exists reels_feed_idx
  on public.reels (created_at desc)
  where moderation_status = 'visible' and status = 'ready';
create index if not exists reels_author_idx on public.reels (author_id, created_at desc);

create table if not exists public.reel_likes (
  reel_id    uuid not null references public.reels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reel_id, user_id)
);

create index if not exists reel_likes_user_idx on public.reel_likes (user_id);

create table if not exists public.reel_comments (
  id         uuid primary key default gen_random_uuid(),
  reel_id    uuid not null references public.reels (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reel_comments_body_length check (char_length(body) between 1 and 1000)
);

create index if not exists reel_comments_reel_idx
  on public.reel_comments (reel_id, created_at desc);

create table if not exists public.reel_saves (
  reel_id    uuid not null references public.reels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reel_id, user_id)
);

create index if not exists reel_saves_user_idx on public.reel_saves (user_id);

create table if not exists public.reel_views (
  reel_id   uuid not null references public.reels (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (reel_id, viewer_id)
);

create index if not exists reel_views_viewer_idx on public.reel_views (viewer_id);

-- ---------------------------------------------------------------------------
-- Counters
-- ---------------------------------------------------------------------------
create or replace function public.reel_likes_sync_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.reels set like_count = like_count + 1 where id = new.reel_id;
    return new;
  end if;
  update public.reels
     set like_count = greatest(like_count - 1, 0)
   where id = old.reel_id;
  return old;
end;
$$;

drop trigger if exists reel_likes_sync_counter on public.reel_likes;
create trigger reel_likes_sync_counter
  after insert or delete on public.reel_likes
  for each row execute function public.reel_likes_sync_counter();

create or replace function public.reel_comments_sync_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.reels set comment_count = comment_count + 1 where id = new.reel_id;
    return new;
  end if;
  update public.reels
     set comment_count = greatest(comment_count - 1, 0)
   where id = old.reel_id;
  return old;
end;
$$;

drop trigger if exists reel_comments_sync_counter on public.reel_comments;
create trigger reel_comments_sync_counter
  after insert or delete on public.reel_comments
  for each row execute function public.reel_comments_sync_counter();

create or replace function public.reel_saves_sync_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.reels set save_count = save_count + 1 where id = new.reel_id;
    return new;
  end if;
  update public.reels
     set save_count = greatest(save_count - 1, 0)
   where id = old.reel_id;
  return old;
end;
$$;

drop trigger if exists reel_saves_sync_counter on public.reel_saves;
create trigger reel_saves_sync_counter
  after insert or delete on public.reel_saves
  for each row execute function public.reel_saves_sync_counter();

drop trigger if exists reels_set_updated_at on public.reels;
create trigger reels_set_updated_at
  before update on public.reels
  for each row execute function public.posts_set_updated_at();

drop trigger if exists reel_comments_set_updated_at on public.reel_comments;
create trigger reel_comments_set_updated_at
  before update on public.reel_comments
  for each row execute function public.posts_set_updated_at();

revoke all on function public.reel_likes_sync_counter() from public, anon, authenticated;
revoke all on function public.reel_comments_sync_counter() from public, anon, authenticated;
revoke all on function public.reel_saves_sync_counter() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Visibility + serialisation
-- ---------------------------------------------------------------------------
create or replace function public.can_view_reel(p_reel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reels r
      join public.profiles pr on pr.id = r.author_id
    where r.id = p_reel_id
      and r.moderation_status = 'visible'
      and r.status = 'ready'
      and pr.account_status = 'active'
      and not public.is_blocked(auth.uid(), r.author_id)
  );
$$;

revoke all on function public.can_view_reel(uuid) from public, anon;
grant execute on function public.can_view_reel(uuid) to authenticated, service_role;

create or replace function public.tz_reel_json(p_reel_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'author_id', r.author_id,
    'author_username', pr.username,
    'author_first_name', pr.first_name,
    'author_last_name', pr.last_name,
    'author_avatar_path', pr.avatar_path,
    'author_is_verified', pr.is_verified,
    'video_path', r.video_path,
    'cover_path', r.cover_path,
    'caption', r.caption,
    'audio_title', r.audio_title,
    'duration_ms', r.duration_ms,
    'width', r.width,
    'height', r.height,
    'like_count', r.like_count,
    'comment_count', r.comment_count,
    'save_count', r.save_count,
    'share_count', r.share_count,
    'view_count', r.view_count,
    'status', r.status,
    'is_edited', r.is_edited,
    'created_at', r.created_at,
    'liked', exists (
      select 1 from public.reel_likes l where l.reel_id = r.id and l.user_id = p_me
    ),
    'saved', exists (
      select 1 from public.reel_saves s where s.reel_id = r.id and s.user_id = p_me
    ),
    'is_mine', r.author_id = p_me,
    'following_author', public.is_following(r.author_id)
  )
  from public.reels r
    join public.profiles pr on pr.id = r.author_id
  where r.id = p_reel_id;
$$;

revoke all on function public.tz_reel_json(uuid, uuid) from public, anon, authenticated;

create or replace function public.tz_reel_comment_json(p_comment_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'reel_id', c.reel_id,
    'author_id', c.author_id,
    'author_username', pr.username,
    'author_first_name', pr.first_name,
    'author_last_name', pr.last_name,
    'author_avatar_path', pr.avatar_path,
    'author_is_verified', pr.is_verified,
    'body', c.body,
    'created_at', c.created_at,
    'is_mine', c.author_id = p_me,
    'can_delete', c.author_id = p_me
      or exists (
        select 1 from public.reels r where r.id = c.reel_id and r.author_id = p_me
      )
      or public.is_admin()
  )
  from public.reel_comments c
    join public.profiles pr on pr.id = c.author_id
  where c.id = p_comment_id;
$$;

revoke all on function public.tz_reel_comment_json(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Feed / read RPCs
-- ---------------------------------------------------------------------------
create or replace function public.reels_list(
  p_cursor timestamptz default null,
  p_limit  integer default 6
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me    uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 20);
begin
  return (
    with base as (
      select r.id, r.created_at
      from public.reels r
        join public.profiles pr on pr.id = r.author_id
      where r.moderation_status = 'visible'
        and r.status = 'ready'
        and pr.account_status = 'active'
        and not public.is_blocked(v_me, r.author_id)
        and (p_cursor is null or r.created_at < p_cursor)
      order by r.created_at desc
      limit v_limit + 1
    ),
    numbered as (
      select b.id, b.created_at, row_number() over (order by b.created_at desc) as rn
      from base b
    )
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(public.tz_reel_json(n.id, v_me) order by n.rn)
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

revoke all on function public.reels_list(timestamptz, integer) from public, anon;
grant execute on function public.reels_list(timestamptz, integer) to authenticated;

create or replace function public.reel_get(p_reel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.tz_require_uid();
begin
  if not public.can_view_reel(p_reel_id) then
    return null;
  end if;
  return public.tz_reel_json(p_reel_id, v_me);
end;
$$;

revoke all on function public.reel_get(uuid) from public, anon;
grant execute on function public.reel_get(uuid) to authenticated;

create or replace function public.reels_for_user(
  p_username text,
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
  v_me     uuid := public.tz_require_uid();
  v_author uuid;
  v_limit  integer := least(greatest(coalesce(p_limit, 18), 1), 30);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  select p.id into v_author
  from public.profiles p
  where lower(p.username) = lower(trim(coalesce(p_username, '')))
  limit 1;

  if v_author is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  if not public.can_view_profile_content(v_author) then
    raise exception 'profile_restricted' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_reel_json(r.id, v_me) order by r.created_at desc)
        from (
          select r.id, r.created_at
          from public.reels r
          where r.author_id = v_author
            and r.moderation_status = 'visible'
            and r.status = 'ready'
            and (r.author_id = v_me or not public.is_blocked(v_me, r.author_id))
          order by r.created_at desc
          limit v_limit offset v_offset
        ) r
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.reels_for_user(text, integer, integer) from public, anon;
grant execute on function public.reels_for_user(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Write RPCs
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

  if p_duration_ms is not null and (p_duration_ms < 0 or p_duration_ms > 600000) then
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

create or replace function public.reel_update(
  p_reel_id    uuid,
  p_caption    text default null,
  p_cover_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.tz_require_uid();
  v_caption text := nullif(trim(coalesce(p_caption, '')), '');
  v_cover   text := nullif(trim(coalesce(p_cover_path, '')), '');
begin
  if not exists (
    select 1 from public.reels r where r.id = p_reel_id and r.author_id = v_uid
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_caption is not null and char_length(v_caption) > 2200 then
    raise exception 'caption_too_long' using errcode = '22023';
  end if;

  if v_cover is not null then
    perform public.tz_validate_media_path(v_cover, v_uid);
  end if;

  update public.reels
     set caption = v_caption,
         cover_path = case when p_cover_path is null then cover_path else v_cover end,
         is_edited = true
   where id = p_reel_id;

  return public.tz_reel_json(p_reel_id, v_uid);
end;
$$;

revoke all on function public.reel_update(uuid, text, text) from public, anon;
grant execute on function public.reel_update(uuid, text, text) to authenticated;

create or replace function public.reel_delete(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_video text;
  v_cover text;
begin
  select r.video_path, r.cover_path
    into v_video, v_cover
  from public.reels r
  where r.id = p_reel_id
    and (r.author_id = v_uid or public.is_admin());

  if v_video is null then
    raise exception 'reel_not_found' using errcode = 'P0002';
  end if;

  delete from public.reels where id = p_reel_id;

  return jsonb_build_object('video_path', v_video, 'cover_path', v_cover);
end;
$$;

revoke all on function public.reel_delete(uuid) from public, anon;
grant execute on function public.reel_delete(uuid) to authenticated;

create or replace function public.reel_toggle_like(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_author   uuid;
  v_liked    boolean;
  v_count    integer;
  v_username text;
begin
  if not public.can_view_reel(p_reel_id) then
    raise exception 'reel_not_found' using errcode = '22023';
  end if;

  select r.author_id into v_author from public.reels r where r.id = p_reel_id;

  if exists (
    select 1 from public.reel_likes l where l.reel_id = p_reel_id and l.user_id = v_uid
  ) then
    delete from public.reel_likes l where l.reel_id = p_reel_id and l.user_id = v_uid;
    v_liked := false;
  else
    perform public.safety_check_rate('reel_like', 600, interval '1 hour');
    insert into public.reel_likes (reel_id, user_id) values (p_reel_id, v_uid)
    on conflict do nothing;
    v_liked := true;

    if v_author <> v_uid then
      select pr.username || ' Reels videonu beğendi' into v_username
      from public.profiles pr where pr.id = v_uid;
      perform public.tz_notify(
        v_author, v_uid, 'like', coalesce(v_username, 'Reels videon beğenildi'), null,
        'reel', p_reel_id::text, '/reels'
      );
    end if;
  end if;

  select r.like_count into v_count from public.reels r where r.id = p_reel_id;

  return jsonb_build_object('liked', v_liked, 'like_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.reel_toggle_like(uuid) from public, anon;
grant execute on function public.reel_toggle_like(uuid) to authenticated;

create or replace function public.reel_toggle_save(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_saved boolean;
  v_count integer;
begin
  if not public.can_view_reel(p_reel_id) then
    raise exception 'reel_not_found' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.reel_saves s where s.reel_id = p_reel_id and s.user_id = v_uid
  ) then
    delete from public.reel_saves s where s.reel_id = p_reel_id and s.user_id = v_uid;
    v_saved := false;
  else
    insert into public.reel_saves (reel_id, user_id) values (p_reel_id, v_uid)
    on conflict do nothing;
    v_saved := true;
  end if;

  select r.save_count into v_count from public.reels r where r.id = p_reel_id;

  return jsonb_build_object('saved', v_saved, 'save_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.reel_toggle_save(uuid) from public, anon;
grant execute on function public.reel_toggle_save(uuid) to authenticated;

create or replace function public.reel_share(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_count integer;
begin
  if not public.can_view_reel(p_reel_id) then
    raise exception 'reel_not_found' using errcode = '22023';
  end if;

  update public.reels
     set share_count = share_count + 1
   where id = p_reel_id
  returning share_count into v_count;

  return jsonb_build_object('share_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.reel_share(uuid) from public, anon;
grant execute on function public.reel_share(uuid) to authenticated;

create or replace function public.reel_register_view(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_count integer;
begin
  if not public.can_view_reel(p_reel_id) then
    return jsonb_build_object('view_count', 0);
  end if;

  insert into public.reel_views (reel_id, viewer_id) values (p_reel_id, v_uid)
  on conflict do nothing;

  if found then
    update public.reels
       set view_count = view_count + 1
     where id = p_reel_id;
  end if;

  select r.view_count into v_count from public.reels r where r.id = p_reel_id;
  return jsonb_build_object('view_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.reel_register_view(uuid) from public, anon;
grant execute on function public.reel_register_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
create or replace function public.reel_list_comments(
  p_reel_id uuid,
  p_limit   integer default 40,
  p_offset  integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me     uuid := public.tz_require_uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_view_reel(p_reel_id) then
    raise exception 'reel_not_found' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_reel_comment_json(c.id, v_me) order by c.created_at asc)
        from (
          select c.id, c.created_at
          from public.reel_comments c
          where c.reel_id = p_reel_id
          order by c.created_at asc
          limit v_limit offset v_offset
        ) c
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.reel_list_comments(uuid, integer, integer) from public, anon;
grant execute on function public.reel_list_comments(uuid, integer, integer) to authenticated;

create or replace function public.reel_add_comment(
  p_reel_id uuid,
  p_body    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_body     text := trim(coalesce(p_body, ''));
  v_author   uuid;
  v_comment  uuid;
  v_username text;
begin
  if not public.can_view_reel(p_reel_id) then
    raise exception 'reel_not_found' using errcode = '22023';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;

  perform public.safety_check_rate('reel_comment', 120, interval '1 hour');

  insert into public.reel_comments (reel_id, author_id, body)
  values (p_reel_id, v_uid, v_body)
  returning id into v_comment;

  select r.author_id into v_author from public.reels r where r.id = p_reel_id;

  if v_author <> v_uid then
    select pr.username || ' Reels videona yorum yaptı' into v_username
    from public.profiles pr where pr.id = v_uid;
    perform public.tz_notify(
      v_author, v_uid, 'comment', coalesce(v_username, 'Reels videona yorum yapıldı'), null,
      'reel', p_reel_id::text, '/reels'
    );
  end if;

  return public.tz_reel_comment_json(v_comment, v_uid);
end;
$$;

revoke all on function public.reel_add_comment(uuid, text) from public, anon;
grant execute on function public.reel_add_comment(uuid, text) to authenticated;

create or replace function public.reel_delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not exists (
    select 1
    from public.reel_comments c
      join public.reels r on r.id = c.reel_id
    where c.id = p_comment_id
      and (c.author_id = v_uid or r.author_id = v_uid or public.is_admin())
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  delete from public.reel_comments where id = p_comment_id;
end;
$$;

revoke all on function public.reel_delete_comment(uuid) from public, anon;
grant execute on function public.reel_delete_comment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.reels enable row level security;
alter table public.reel_likes enable row level security;
alter table public.reel_comments enable row level security;
alter table public.reel_saves enable row level security;
alter table public.reel_views enable row level security;

drop policy if exists reels_select on public.reels;
create policy reels_select on public.reels
  for select to authenticated
  using (
    author_id = auth.uid()
    or public.is_admin()
    or public.can_view_reel(id)
  );

drop policy if exists reel_likes_select on public.reel_likes;
create policy reel_likes_select on public.reel_likes
  for select to authenticated
  using (user_id = auth.uid() or public.can_view_reel(reel_id));

drop policy if exists reel_comments_select on public.reel_comments;
create policy reel_comments_select on public.reel_comments
  for select to authenticated
  using (author_id = auth.uid() or public.can_view_reel(reel_id));

drop policy if exists reel_saves_select on public.reel_saves;
create policy reel_saves_select on public.reel_saves
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists reel_views_select on public.reel_views;
create policy reel_views_select on public.reel_views
  for select to authenticated
  using (viewer_id = auth.uid());

revoke all on public.reels from anon, authenticated;
grant select on public.reels to authenticated;

revoke all on public.reel_likes from anon, authenticated;
grant select on public.reel_likes to authenticated;

revoke all on public.reel_comments from anon, authenticated;
grant select on public.reel_comments to authenticated;

revoke all on public.reel_saves from anon, authenticated;
grant select on public.reel_saves to authenticated;

revoke all on public.reel_views from anon, authenticated;
grant select on public.reel_views to authenticated;

-- ---------------------------------------------------------------------------
-- Storage policies
-- ---------------------------------------------------------------------------
drop policy if exists reels_media_insert on storage.objects;
create policy reels_media_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists reels_media_update on storage.objects;
create policy reels_media_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists reels_media_delete on storage.objects;
create policy reels_media_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
