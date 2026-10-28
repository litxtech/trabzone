-- 0076: Unified premium comment platform
--
-- Goals
--  * One comment API shared by feed posts and Reels (post_comments /
--    reel_comments stay the source of truth, nothing is migrated or renamed).
--  * Replies on Reels (post_comments already had parent_id).
--  * Comment likes with a uniqueness guarantee per (comment, user).
--  * Comment media records (images/videos) pointing at the public media store.
--  * Editing, hard delete with media cleanup, moderation-aware listing.
--  * Correct counters (only visible comments are counted) and notifications
--    for the content owner *and* the author of the comment being replied to.
--  * Realtime streaming for comments and likes.
--
-- All writes are security-definer RPCs; direct table writes stay forbidden.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.post_comments
  add column if not exists edited_at timestamptz,
  add column if not exists like_count integer not null default 0;

alter table public.reel_comments
  add column if not exists parent_id uuid,
  add column if not exists edited_at timestamptz,
  add column if not exists like_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reel_comments_parent_fk'
      and conrelid = 'public.reel_comments'::regclass
  ) then
    alter table public.reel_comments
      add constraint reel_comments_parent_fk
      foreign key (parent_id) references public.reel_comments (id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'post_comments_like_count_check'
      and conrelid = 'public.post_comments'::regclass
  ) then
    alter table public.post_comments
      add constraint post_comments_like_count_check check (like_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reel_comments_like_count_check'
      and conrelid = 'public.reel_comments'::regclass
  ) then
    alter table public.reel_comments
      add constraint reel_comments_like_count_check check (like_count >= 0);
  end if;
end $$;

-- Media-only comments are allowed: the body may be empty when media exists.
alter table public.post_comments drop constraint if exists post_comments_body_length;
alter table public.post_comments add constraint post_comments_body_length
  check (char_length(body) between 0 and 1000);

alter table public.reel_comments drop constraint if exists reel_comments_body_length;
alter table public.reel_comments add constraint reel_comments_body_length
  check (char_length(body) between 0 and 1000);

create index if not exists reel_comments_parent_idx
  on public.reel_comments (parent_id, created_at);
create index if not exists post_comments_visible_idx
  on public.post_comments (post_id, parent_id, created_at desc)
  where moderation_status = 'visible';
create index if not exists reel_comments_visible_idx
  on public.reel_comments (reel_id, parent_id, created_at desc)
  where moderation_status = 'visible';

-- ---------------------------------------------------------------------------
-- 2. Comment media
-- ---------------------------------------------------------------------------
create table if not exists public.comment_media (
  id             uuid primary key default gen_random_uuid(),
  comment_id     uuid not null,
  content_type   text not null,
  media_type     text not null,
  storage_path   text not null,
  thumbnail_path text,
  width          integer,
  height         integer,
  duration_ms    integer,
  sort_order     smallint not null default 0,
  created_at     timestamptz not null default now(),
  constraint comment_media_content_check check (content_type in ('post', 'reel')),
  constraint comment_media_type_check check (media_type in ('image', 'video')),
  constraint comment_media_path_check check (char_length(storage_path) between 3 and 400),
  constraint comment_media_thumb_check check (
    thumbnail_path is null or char_length(thumbnail_path) between 3 and 400
  ),
  constraint comment_media_sort_check check (sort_order between 0 and 7)
);

create index if not exists comment_media_comment_idx
  on public.comment_media (content_type, comment_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3. Comment likes
-- ---------------------------------------------------------------------------
create table if not exists public.comment_likes (
  comment_id   uuid not null,
  content_type text not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint comment_likes_content_check check (content_type in ('post', 'reel')),
  primary key (comment_id, content_type, user_id)
);

create index if not exists comment_likes_user_idx
  on public.comment_likes (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Cleanup: likes/media never outlive their comment
-- ---------------------------------------------------------------------------
create or replace function public.tz_comment_cleanup_children()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.comment_media where comment_id = old.id;
  delete from public.comment_likes where comment_id = old.id;
  return old;
end;
$$;

revoke all on function public.tz_comment_cleanup_children() from public, anon, authenticated;

drop trigger if exists post_comments_cleanup_children on public.post_comments;
create trigger post_comments_cleanup_children
  after delete on public.post_comments
  for each row execute function public.tz_comment_cleanup_children();

drop trigger if exists reel_comments_cleanup_children on public.reel_comments;
create trigger reel_comments_cleanup_children
  after delete on public.reel_comments
  for each row execute function public.tz_comment_cleanup_children();

-- ---------------------------------------------------------------------------
-- 5. Counters: only visible comments count towards comment_count
-- ---------------------------------------------------------------------------
create or replace function public.post_comments_sync_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.moderation_status = 'visible' then
      update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.moderation_status = 'visible' then
      update public.posts
         set comment_count = greatest(comment_count - 1, 0)
       where id = old.post_id;
    end if;
    return old;
  end if;

  if old.moderation_status is distinct from new.moderation_status then
    if new.moderation_status = 'visible' then
      update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    elsif old.moderation_status = 'visible' then
      update public.posts
         set comment_count = greatest(comment_count - 1, 0)
       where id = new.post_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists post_comments_sync_counter on public.post_comments;
create trigger post_comments_sync_counter
  after insert or delete or update of moderation_status on public.post_comments
  for each row execute function public.post_comments_sync_counter();

create or replace function public.reel_comments_sync_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.moderation_status = 'visible' then
      update public.reels set comment_count = comment_count + 1 where id = new.reel_id;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.moderation_status = 'visible' then
      update public.reels
         set comment_count = greatest(comment_count - 1, 0)
       where id = old.reel_id;
    end if;
    return old;
  end if;

  if old.moderation_status is distinct from new.moderation_status then
    if new.moderation_status = 'visible' then
      update public.reels set comment_count = comment_count + 1 where id = new.reel_id;
    elsif old.moderation_status = 'visible' then
      update public.reels
         set comment_count = greatest(comment_count - 1, 0)
       where id = new.reel_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reel_comments_sync_counter on public.reel_comments;
create trigger reel_comments_sync_counter
  after insert or delete or update of moderation_status on public.reel_comments
  for each row execute function public.reel_comments_sync_counter();

revoke all on function public.post_comments_sync_counter() from public, anon, authenticated;
revoke all on function public.reel_comments_sync_counter() from public, anon, authenticated;

-- Existing counters may include hidden/removed comments; align them once.
update public.posts p
   set comment_count = (
     select count(*) from public.post_comments c
     where c.post_id = p.id and c.moderation_status = 'visible'
   )
 where p.comment_count is distinct from (
   select count(*) from public.post_comments c
   where c.post_id = p.id and c.moderation_status = 'visible'
 );

update public.reels r
   set comment_count = (
     select count(*) from public.reel_comments c
     where c.reel_id = r.id and c.moderation_status = 'visible'
   )
 where r.comment_count is distinct from (
   select count(*) from public.reel_comments c
   where c.reel_id = r.id and c.moderation_status = 'visible'
 );

-- ---------------------------------------------------------------------------
-- 6. Serialisation
-- ---------------------------------------------------------------------------
create or replace function public.tz_comment_json(
  p_content_type text,
  p_comment_id   uuid,
  p_me           uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_content_type = 'post' then
    select jsonb_build_object(
      'id', c.id,
      'content_type', 'post',
      'content_id', c.post_id,
      'parent_id', c.parent_id,
      'body', c.body,
      'created_at', c.created_at,
      'updated_at', c.updated_at,
      'edited_at', c.edited_at,
      'like_count', c.like_count,
      'liked', exists (
        select 1 from public.comment_likes l
        where l.comment_id = c.id and l.content_type = 'post' and l.user_id = p_me
      ),
      'reply_count', (
        select count(*) from public.post_comments r
        where r.parent_id = c.id and r.moderation_status = 'visible'
      ),
      'is_mine', c.author_id = p_me,
      'can_edit', c.author_id = p_me,
      'can_delete', c.author_id = p_me or p.author_id = p_me or public.is_admin(),
      'moderation_status', c.moderation_status,
      'author_id', pr.id,
      'author_username', pr.username,
      'author_first_name', pr.first_name,
      'author_last_name', pr.last_name,
      'author_avatar_path', pr.avatar_path,
      'author_is_verified', pr.is_verified,
      'media', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'media_type', m.media_type,
            'storage_path', m.storage_path,
            'thumbnail_path', m.thumbnail_path,
            'width', m.width,
            'height', m.height,
            'duration_ms', m.duration_ms,
            'sort_order', m.sort_order
          ) order by m.sort_order
        )
        from public.comment_media m
        where m.content_type = 'post' and m.comment_id = c.id
      ), '[]'::jsonb)
    )
    into v
    from public.post_comments c
      join public.profiles pr on pr.id = c.author_id
      join public.posts p on p.id = c.post_id
    where c.id = p_comment_id;

    return v;
  end if;

  if p_content_type = 'reel' then
    select jsonb_build_object(
      'id', c.id,
      'content_type', 'reel',
      'content_id', c.reel_id,
      'parent_id', c.parent_id,
      'body', c.body,
      'created_at', c.created_at,
      'updated_at', c.updated_at,
      'edited_at', c.edited_at,
      'like_count', c.like_count,
      'liked', exists (
        select 1 from public.comment_likes l
        where l.comment_id = c.id and l.content_type = 'reel' and l.user_id = p_me
      ),
      'reply_count', (
        select count(*) from public.reel_comments r
        where r.parent_id = c.id and r.moderation_status = 'visible'
      ),
      'is_mine', c.author_id = p_me,
      'can_edit', c.author_id = p_me,
      'can_delete', c.author_id = p_me or r.author_id = p_me or public.is_admin(),
      'moderation_status', c.moderation_status,
      'author_id', pr.id,
      'author_username', pr.username,
      'author_first_name', pr.first_name,
      'author_last_name', pr.last_name,
      'author_avatar_path', pr.avatar_path,
      'author_is_verified', pr.is_verified,
      'media', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'media_type', m.media_type,
            'storage_path', m.storage_path,
            'thumbnail_path', m.thumbnail_path,
            'width', m.width,
            'height', m.height,
            'duration_ms', m.duration_ms,
            'sort_order', m.sort_order
          ) order by m.sort_order
        )
        from public.comment_media m
        where m.content_type = 'reel' and m.comment_id = c.id
      ), '[]'::jsonb)
    )
    into v
    from public.reel_comments c
      join public.profiles pr on pr.id = c.author_id
      join public.reels r on r.id = c.reel_id
    where c.id = p_comment_id;
  end if;

  return v;
end;
$$;

revoke all on function public.tz_comment_json(text, uuid, uuid) from public, anon, authenticated;

-- Attaches the first page of replies to a serialised comment.
create or replace function public.tz_comment_with_replies(
  p_content_type text,
  p_comment_id   uuid,
  p_me           uuid,
  p_reply_limit  integer default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_reply_limit, 3), 0), 20);
  v_replies jsonb;
begin
  if p_content_type = 'post' then
    select coalesce(jsonb_agg(public.tz_comment_json('post', r.id, p_me) order by r.created_at asc), '[]'::jsonb)
      into v_replies
    from (
      select c.id, c.created_at
      from public.post_comments c
      where c.parent_id = p_comment_id
        and c.moderation_status = 'visible'
        and not public.is_blocked(p_me, c.author_id)
      order by c.created_at asc
      limit v_limit
    ) r;
  else
    select coalesce(jsonb_agg(public.tz_comment_json('reel', r.id, p_me) order by r.created_at asc), '[]'::jsonb)
      into v_replies
    from (
      select c.id, c.created_at
      from public.reel_comments c
      where c.parent_id = p_comment_id
        and c.moderation_status = 'visible'
        and not public.is_blocked(p_me, c.author_id)
      order by c.created_at asc
      limit v_limit
    ) r;
  end if;

  return coalesce(public.tz_comment_json(p_content_type, p_comment_id, p_me), '{}'::jsonb)
    || jsonb_build_object('replies', coalesce(v_replies, '[]'::jsonb));
end;
$$;

revoke all on function public.tz_comment_with_replies(text, uuid, uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Read RPCs
-- ---------------------------------------------------------------------------
create or replace function public.comment_list(
  p_content_type text,
  p_content_id   uuid,
  p_limit        integer default 20,
  p_offset       integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_type   text := coalesce(nullif(trim(p_content_type), ''), 'post');
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items  jsonb;
  v_more   boolean := false;
begin
  if v_type = 'post' then
    if not public.can_view_post(p_content_id) then
      raise exception 'content_not_found' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(
      public.tz_comment_with_replies('post', x.id, v_uid, 3)
      order by x.created_at desc
    ), '[]'::jsonb)
    into v_items
    from (
      select c.id, c.created_at
      from public.post_comments c
      where c.post_id = p_content_id
        and c.parent_id is null
        and c.moderation_status = 'visible'
        and not public.is_blocked(v_uid, c.author_id)
      order by c.created_at desc
      limit v_limit + 1 offset v_offset
    ) x;

    v_more := jsonb_array_length(v_items) > v_limit;
    if v_more then
      select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
        into v_items
      from (
        select value, ord
        from jsonb_array_elements(v_items) with ordinality as t(value, ord)
        order by ord
        limit v_limit
      ) trimmed;
    end if;
  elsif v_type = 'reel' then
    if not public.can_view_reel(p_content_id) then
      raise exception 'content_not_found' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(
      public.tz_comment_with_replies('reel', x.id, v_uid, 3)
      order by x.created_at desc
    ), '[]'::jsonb)
    into v_items
    from (
      select c.id, c.created_at
      from public.reel_comments c
      where c.reel_id = p_content_id
        and c.parent_id is null
        and c.moderation_status = 'visible'
        and not public.is_blocked(v_uid, c.author_id)
      order by c.created_at desc
      limit v_limit + 1 offset v_offset
    ) x;

    v_more := jsonb_array_length(v_items) > v_limit;
    if v_more then
      select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
        into v_items
      from (
        select value, ord
        from jsonb_array_elements(v_items) with ordinality as t(value, ord)
        order by ord
        limit v_limit
      ) trimmed;
    end if;
  else
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'has_more', v_more);
end;
$$;

revoke all on function public.comment_list(text, uuid, integer, integer) from public, anon;
grant execute on function public.comment_list(text, uuid, integer, integer) to authenticated;

create or replace function public.comment_replies(
  p_content_type text,
  p_parent_id    uuid,
  p_limit        integer default 30,
  p_offset       integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_type   text := coalesce(nullif(trim(p_content_type), ''), 'post');
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items  jsonb;
begin
  if v_type = 'post' then
    select coalesce(jsonb_agg(public.tz_comment_json('post', x.id, v_uid) order by x.created_at asc), '[]'::jsonb)
      into v_items
    from (
      select c.id, c.created_at
      from public.post_comments c
      where c.parent_id = p_parent_id
        and c.moderation_status = 'visible'
        and not public.is_blocked(v_uid, c.author_id)
      order by c.created_at asc
      limit v_limit offset v_offset
    ) x;
  elsif v_type = 'reel' then
    select coalesce(jsonb_agg(public.tz_comment_json('reel', x.id, v_uid) order by x.created_at asc), '[]'::jsonb)
      into v_items
    from (
      select c.id, c.created_at
      from public.reel_comments c
      where c.parent_id = p_parent_id
        and c.moderation_status = 'visible'
        and not public.is_blocked(v_uid, c.author_id)
      order by c.created_at asc
      limit v_limit offset v_offset
    ) x;
  else
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

revoke all on function public.comment_replies(text, uuid, integer, integer) from public, anon;
grant execute on function public.comment_replies(text, uuid, integer, integer) to authenticated;

create or replace function public.comment_get(
  p_content_type text,
  p_comment_id   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return public.tz_comment_with_replies(
    coalesce(nullif(trim(p_content_type), ''), 'post'),
    p_comment_id,
    v_uid,
    3
  );
end;
$$;

revoke all on function public.comment_get(text, uuid) from public, anon;
grant execute on function public.comment_get(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Write RPCs
-- ---------------------------------------------------------------------------
create or replace function public.comment_add(
  p_content_type text,
  p_content_id   uuid,
  p_body         text,
  p_parent       uuid default null,
  p_media        jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := public.tz_require_uid();
  v_type       text := coalesce(nullif(trim(p_content_type), ''), 'post');
  v_body       text := nullif(trim(coalesce(p_body, '')), '');
  v_media      jsonb := coalesce(p_media, '[]'::jsonb);
  v_owner      uuid;
  v_locked     boolean := false;
  v_parent     uuid := p_parent;
  v_parent_author uuid;
  v_parent_root uuid;
  v_policy     text;
  v_id         uuid;
  v_actor      text;
  v_count      integer;
  v_route      text;
  v_item       jsonb;
  v_i          integer := 0;
  v_media_item jsonb;
begin
  if v_type not in ('post', 'reel') then
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  if jsonb_typeof(v_media) <> 'array' or jsonb_array_length(v_media) > 4 then
    raise exception 'invalid_media' using errcode = '22023';
  end if;

  if (v_body is null or char_length(v_body) = 0) and jsonb_array_length(v_media) = 0 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;
  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;

  if v_type = 'post' then
    if not public.can_view_post(p_content_id) then
      raise exception 'content_not_found' using errcode = '22023';
    end if;
    select p.author_id, p.comments_locked into v_owner, v_locked
    from public.posts p where p.id = p_content_id;
    v_route := '/post/' || p_content_id::text;
  else
    if not public.can_view_reel(p_content_id) then
      raise exception 'content_not_found' using errcode = '22023';
    end if;
    select r.author_id, r.comments_locked into v_owner, v_locked
    from public.reels r where r.id = p_content_id;
    v_route := '/reel/' || p_content_id::text;
  end if;

  if v_locked and v_owner <> v_uid then
    raise exception 'comments_locked' using errcode = '42501';
  end if;

  -- Child-protection comment policy follows the content owner.
  select c.comment_policy into v_policy
  from public.child_protection_settings c
  where c.user_id = v_owner;

  if found and v_owner <> v_uid then
    if v_policy = 'nobody' then
      raise exception 'comments_disabled' using errcode = '42501';
    end if;
    if v_policy = 'friends' and not public.are_friends(v_uid, v_owner) then
      raise exception 'comments_friends_only' using errcode = '42501';
    end if;
  end if;

  if v_parent is not null then
    if v_type = 'post' then
      select c.author_id, c.parent_id into v_parent_author, v_parent_root
      from public.post_comments c
      where c.id = p_parent and c.post_id = p_content_id and c.moderation_status = 'visible';

      if v_parent_author is null then
        raise exception 'invalid_parent' using errcode = '22023';
      end if;
      -- Keep visual depth to two levels: replies to replies attach to the root.
      v_parent := coalesce(v_parent_root, p_parent);
    else
      select c.author_id, c.parent_id into v_parent_author, v_parent_root
      from public.reel_comments c
      where c.id = p_parent and c.reel_id = p_content_id and c.moderation_status = 'visible';

      if v_parent_author is null then
        raise exception 'invalid_parent' using errcode = '22023';
      end if;
      v_parent := coalesce(v_parent_root, p_parent);
    end if;
  end if;

  perform public.safety_check_rate('comment_create', 120, interval '1 day');

  if v_type = 'post' then
    insert into public.post_comments (post_id, author_id, parent_id, body)
    values (p_content_id, v_uid, v_parent, coalesce(v_body, ''))
    returning id into v_id;
  else
    insert into public.reel_comments (reel_id, author_id, parent_id, body)
    values (p_content_id, v_uid, v_parent, coalesce(v_body, ''))
    returning id into v_id;
  end if;

  for v_media_item in select * from jsonb_array_elements(v_media)
  loop
    if jsonb_typeof(v_media_item) <> 'object' then
      raise exception 'invalid_media' using errcode = '22023';
    end if;

    perform public.tz_validate_media_path(v_media_item->>'storage_path', v_uid);
    if nullif(v_media_item->>'thumbnail_path', '') is not null then
      perform public.tz_validate_media_path(v_media_item->>'thumbnail_path', v_uid);
    end if;

    insert into public.comment_media (
      comment_id, content_type, media_type, storage_path, thumbnail_path,
      width, height, duration_ms, sort_order
    )
    values (
      v_id,
      v_type,
      case when v_media_item->>'media_type' = 'video' then 'video' else 'image' end,
      v_media_item->>'storage_path',
      nullif(v_media_item->>'thumbnail_path', ''),
      nullif(v_media_item->>'width', '')::integer,
      nullif(v_media_item->>'height', '')::integer,
      nullif(v_media_item->>'duration_ms', '')::integer,
      v_i
    );
    v_i := v_i + 1;
  end loop;

  select pr.username into v_actor from public.profiles pr where pr.id = v_uid;

  if v_owner <> v_uid then
    perform public.tz_notify(
      v_owner,
      v_uid,
      'comment',
      coalesce(v_actor, 'Yeni yorum'),
      left(coalesce(v_body, 'Medya'), 120),
      v_type,
      p_content_id::text,
      v_route
    );
  end if;

  if v_parent_author is not null and v_parent_author <> v_uid and v_parent_author <> v_owner then
    perform public.tz_notify(
      v_parent_author,
      v_uid,
      'comment_reply',
      coalesce(v_actor, 'Bir kullanÄ±cÄ±') || ' yorumuna yanÄ±t verdi',
      left(coalesce(v_body, 'Medya'), 120),
      v_type,
      p_content_id::text,
      v_route || '?comment=' || v_id::text
    );
  end if;

  v_item := public.tz_comment_with_replies(v_type, v_id, v_uid, 3);
  return v_item;
end;
$$;

revoke all on function public.comment_add(text, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.comment_add(text, uuid, text, uuid, jsonb) to authenticated;

create or replace function public.comment_update(
  p_content_type text,
  p_comment_id   uuid,
  p_body         text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.tz_require_uid();
  v_type text := coalesce(nullif(trim(p_content_type), ''), 'post');
  v_body text := nullif(trim(coalesce(p_body, '')), '');
begin
  if v_body is null or char_length(v_body) > 1000 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;

  if v_type = 'post' then
    update public.post_comments
       set body = v_body, edited_at = now(), updated_at = now()
     where id = p_comment_id and author_id = v_uid;
  elsif v_type = 'reel' then
    update public.reel_comments
       set body = v_body, edited_at = now(), updated_at = now()
     where id = p_comment_id and author_id = v_uid;
  else
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return public.tz_comment_with_replies(v_type, p_comment_id, v_uid, 3);
end;
$$;

revoke all on function public.comment_update(text, uuid, text) from public, anon;
grant execute on function public.comment_update(text, uuid, text) to authenticated;

create or replace function public.comment_delete(
  p_content_type text,
  p_comment_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_type  text := coalesce(nullif(trim(p_content_type), ''), 'post');
  v_paths jsonb;
begin
  if v_type = 'post' then
    if not exists (
      select 1
      from public.post_comments c
        join public.posts p on p.id = c.post_id
      where c.id = p_comment_id
        and (c.author_id = v_uid or p.author_id = v_uid or public.is_admin())
    ) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;

    select coalesce(jsonb_agg(m.storage_path), '[]'::jsonb)
      into v_paths
    from public.comment_media m
    where m.content_type = 'post'
      and (
        m.comment_id = p_comment_id
        or m.comment_id in (
          select c.id from public.post_comments c where c.parent_id = p_comment_id
        )
      );

    delete from public.post_comments where id = p_comment_id;
  elsif v_type = 'reel' then
    if not exists (
      select 1
      from public.reel_comments c
        join public.reels r on r.id = c.reel_id
      where c.id = p_comment_id
        and (c.author_id = v_uid or r.author_id = v_uid or public.is_admin())
    ) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;

    select coalesce(jsonb_agg(m.storage_path), '[]'::jsonb)
      into v_paths
    from public.comment_media m
    where m.content_type = 'reel'
      and (
        m.comment_id = p_comment_id
        or m.comment_id in (
          select c.id from public.reel_comments c where c.parent_id = p_comment_id
        )
      );

    delete from public.reel_comments where id = p_comment_id;
  else
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  return jsonb_build_object('media_paths', coalesce(v_paths, '[]'::jsonb));
end;
$$;

revoke all on function public.comment_delete(text, uuid) from public, anon;
grant execute on function public.comment_delete(text, uuid) to authenticated;

create or replace function public.comment_toggle_like(
  p_content_type text,
  p_comment_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_type  text := coalesce(nullif(trim(p_content_type), ''), 'post');
  v_liked boolean := false;
  v_count integer := 0;
begin
  if v_type = 'post' then
    if not exists (
      select 1 from public.post_comments c
      where c.id = p_comment_id and c.moderation_status = 'visible'
        and public.can_view_post(c.post_id)
    ) then
      raise exception 'comment_not_found' using errcode = '22023';
    end if;
  elsif v_type = 'reel' then
    if not exists (
      select 1 from public.reel_comments c
      where c.id = p_comment_id and c.moderation_status = 'visible'
        and public.can_view_reel(c.reel_id)
    ) then
      raise exception 'comment_not_found' using errcode = '22023';
    end if;
  else
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  insert into public.comment_likes (comment_id, content_type, user_id)
  values (p_comment_id, v_type, v_uid)
  on conflict do nothing;

  if found then
    v_liked := true;
  else
    delete from public.comment_likes
     where comment_id = p_comment_id and content_type = v_type and user_id = v_uid;
    v_liked := false;
  end if;

  select count(*) into v_count
  from public.comment_likes
  where comment_id = p_comment_id and content_type = v_type;

  if v_type = 'post' then
    update public.post_comments set like_count = v_count where id = p_comment_id;
  else
    update public.reel_comments set like_count = v_count where id = p_comment_id;
  end if;

  return jsonb_build_object('liked', v_liked, 'like_count', v_count);
end;
$$;

revoke all on function public.comment_toggle_like(text, uuid) from public, anon;
grant execute on function public.comment_toggle_like(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Admin helpers: media preview + moderation history
-- ---------------------------------------------------------------------------
create or replace function public.admin_comment_history(p_comment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  perform public.tz_admin_require('content.view');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'action', a.action,
    'reason', a.reason_code,
    'target_type', a.target_type,
    'target_id', a.target_id,
    'metadata', a.metadata_safe,
    'created_at', a.created_at,
    'actor_name', coalesce(pr.display_name, pr.username)
  ) order by a.created_at desc), '[]'::jsonb)
  into v_items
  from public.moderation_actions a
    left join public.profiles pr on pr.id = a.admin_id
  where a.target_type = 'comment' and a.target_id = p_comment_id::text;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$$;

revoke all on function public.admin_comment_history(uuid) from public, anon;
grant execute on function public.admin_comment_history(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. RLS / grants
-- ---------------------------------------------------------------------------
alter table public.comment_media enable row level security;
alter table public.comment_likes enable row level security;

drop policy if exists comment_media_select on public.comment_media;
create policy comment_media_select on public.comment_media
  for select to authenticated
  using (true);

drop policy if exists comment_likes_select on public.comment_likes;
create policy comment_likes_select on public.comment_likes
  for select to authenticated
  using (true);

revoke all on public.comment_media from anon, authenticated;
revoke all on public.comment_likes from anon, authenticated;
grant select on public.comment_media to authenticated;
grant select on public.comment_likes to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Realtime (comments + likes stream to open sheets)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'post_comments'
  ) then
    alter publication supabase_realtime add table public.post_comments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'reel_comments'
  ) then
    alter publication supabase_realtime add table public.reel_comments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'comment_likes'
  ) then
    alter publication supabase_realtime add table public.comment_likes;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Admin: single comment detail (media + moderation history)
-- ---------------------------------------------------------------------------
create or replace function public.admin_comment_detail(p_comment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('content.view');
  v_type text;
  v_comment jsonb;
  v_report_count integer := 0;
begin
  if exists (select 1 from public.post_comments c where c.id = p_comment_id) then
    v_type := 'post';
  elsif exists (select 1 from public.reel_comments c where c.id = p_comment_id) then
    v_type := 'reel';
  else
    raise exception 'comment_not_found' using errcode = '22023';
  end if;

  v_comment := public.tz_comment_json(v_type, p_comment_id, v_uid);

  select count(*) into v_report_count
  from public.user_reports r
  where r.target_type = 'comment' and r.target_id = p_comment_id::text;

  return jsonb_build_object(
    'comment', coalesce(v_comment, '{}'::jsonb),
    'content_type', v_type,
    'report_count', v_report_count,
    'history', public.admin_comment_history(p_comment_id)
  );
end;
$$;

revoke all on function public.admin_comment_detail(uuid) from public, anon;
grant execute on function public.admin_comment_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Messaging: multi-media, delivery receipts, single message read
-- ---------------------------------------------------------------------------
create table if not exists public.message_media (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references public.messages (id) on delete cascade,
  media_type     text not null,
  storage_path   text not null,
  thumbnail_path text,
  width          integer,
  height         integer,
  duration_ms    integer,
  sort_order     smallint not null default 0,
  created_at     timestamptz not null default now(),
  constraint message_media_type_check check (media_type in ('image', 'video', 'audio', 'file')),
  constraint message_media_path_check check (char_length(storage_path) between 3 and 400),
  constraint message_media_thumb_check check (
    thumbnail_path is null or char_length(thumbnail_path) between 3 and 400
  ),
  constraint message_media_sort_check check (sort_order between 0 and 7)
);

create index if not exists message_media_message_idx
  on public.message_media (message_id, sort_order);

alter table public.message_media enable row level security;

drop policy if exists message_media_select on public.message_media;
create policy message_media_select on public.message_media
  for select to authenticated
  using (
    exists (
      select 1
      from public.messages m
        join public.conversation_members cm
          on cm.conversation_id = m.conversation_id
         and cm.user_id = auth.uid()
         and cm.left_at is null
      where m.id = message_media.message_id
    )
  );

revoke all on public.message_media from anon, authenticated;
grant select on public.message_media to authenticated;

-- delete_message now reports the storage objects it detached so the client can
-- remove them from R2 (best effort).
drop function if exists public.chat_delete_message(uuid);

create or replace function public.chat_delete_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_paths jsonb;
  v_conv  uuid;
begin
  select m.conversation_id into v_conv
  from public.messages m
  where m.id = p_message_id
    and m.sender_id = v_uid
    and m.deleted_at is null
    and m.created_at > now() - interval '48 hours'
  for update;

  if v_conv is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(mm.storage_path), '[]'::jsonb)
    into v_paths
  from public.message_media mm
  where mm.message_id = p_message_id;

  delete from public.message_media where message_id = p_message_id;

  update public.messages
     set body = null,
         media_path = null,
         media_meta = '{}'::jsonb,
         deleted_at = now()
   where id = p_message_id;

  update public.conversations
     set last_message_preview = 'Mesaj silindi',
         updated_at = now()
   where id = v_conv
     and last_message_preview is not null;

  return jsonb_build_object('media_paths', v_paths);
end;
$$;

revoke all on function public.chat_delete_message(uuid) from public, anon;
grant execute on function public.chat_delete_message(uuid) to authenticated;

-- Delivery receipts: recorded as soon as the message reaches the recipient.
create or replace function public.chat_mark_delivered(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_count integer := 0;
begin
  perform public.tz_conversation_guard(p_conversation_id, v_uid);

  insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
  select msg.id, v_uid, now(), null
  from public.messages msg
  where msg.conversation_id = p_conversation_id
    and msg.sender_id <> v_uid
    and msg.deleted_at is null
    and msg.created_at > now() - interval '30 days'
  on conflict (message_id, user_id) do update
    set delivered_at = coalesce(public.message_receipts.delivered_at, now());

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.chat_mark_delivered(uuid) from public, anon;
grant execute on function public.chat_mark_delivered(uuid) to authenticated;

-- Per-message fetch for realtime patches (never re-queries a whole conversation).
create or replace function public.chat_message_get(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not exists (
    select 1
    from public.messages m
      join public.conversation_members cm
        on cm.conversation_id = m.conversation_id
       and cm.user_id = v_uid
       and cm.left_at is null
    where m.id = p_message_id
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return public.tz_message_json(p_message_id, v_uid);
end;
$$;

revoke all on function public.chat_message_get(uuid) from public, anon;
grant execute on function public.chat_message_get(uuid) to authenticated;

-- Serialisation now includes delivery state, media arrays and richer reply quotes.
create or replace function public.tz_message_json(p_message_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id,
    'conversation_id', m.conversation_id,
    'sender_id', m.sender_id,
    'sender_username', p.username,
    'sender_first_name', p.first_name,
    'sender_last_name', p.last_name,
    'sender_avatar_path', p.avatar_path,
    'kind', case when m.deleted_at is null then m.kind else 'text' end,
    'body', case when m.deleted_at is null then m.body else null end,
    'media_path', case when m.deleted_at is null then m.media_path else null end,
    'media_meta', case when m.deleted_at is null then m.media_meta else '{}'::jsonb end,
    'media', case when m.deleted_at is null then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mm.id,
        'media_type', mm.media_type,
        'storage_path', mm.storage_path,
        'thumbnail_path', mm.thumbnail_path,
        'width', mm.width,
        'height', mm.height,
        'duration_ms', mm.duration_ms,
        'sort_order', mm.sort_order
      ) order by mm.sort_order)
      from public.message_media mm
      where mm.message_id = m.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'reply_to_id', m.reply_to_id,
    'reply_preview', case when r.id is null then null else jsonb_build_object(
      'id', r.id,
      'body', case when r.deleted_at is null then r.body else null end,
      'kind', r.kind,
      'sender_username', rp.username,
      'sender_first_name', rp.first_name,
      'deleted_at', r.deleted_at,
      'has_media', (
        r.media_path is not null
        or exists (select 1 from public.message_media mm where mm.message_id = r.id)
      )
    ) end,
    'edited_at', m.edited_at,
    'deleted_at', m.deleted_at,
    'created_at', m.created_at,
    'is_mine', m.sender_id = p_me,
    'delivery_status', case
      when m.sender_id <> p_me then 'read'
      when (select count(*)
            from public.conversation_members cm
            where cm.conversation_id = m.conversation_id
              and cm.user_id <> m.sender_id
              and cm.left_at is null) = 0 then 'sent'
      when (select count(*)
            from public.message_receipts mr
            where mr.message_id = m.id
              and mr.user_id <> m.sender_id
              and mr.read_at is not null)
           >= (select count(*)
               from public.conversation_members cm
               where cm.conversation_id = m.conversation_id
                 and cm.user_id <> m.sender_id
                 and cm.left_at is null) then 'read'
      when (select count(*)
            from public.message_receipts mr
            where mr.message_id = m.id
              and mr.user_id <> m.sender_id
              and mr.delivered_at is not null)
           >= (select count(*)
               from public.conversation_members cm
               where cm.conversation_id = m.conversation_id
                 and cm.user_id <> m.sender_id
                 and cm.left_at is null) then 'delivered'
      else 'sent'
    end
  )
  from public.messages m
    join public.profiles p on p.id = m.sender_id
    left join public.messages r on r.id = m.reply_to_id
    left join public.profiles rp on rp.id = r.sender_id
  where m.id = p_message_id;
$$;

revoke all on function public.tz_message_json(uuid, uuid) from public, anon;
grant execute on function public.tz_message_json(uuid, uuid) to authenticated;

-- Multi-photo/video sending. The 7th argument is additive: existing callers that
-- only pass p_media_path keep working, and both paths land in message_media.
drop function if exists public.chat_send_message(uuid, text, text, text, jsonb, uuid);

create or replace function public.chat_send_message(
  p_conversation_id uuid,
  p_kind            text default 'text',
  p_body            text default null,
  p_media_path      text default null,
  p_media_meta      jsonb default '{}'::jsonb,
  p_reply_to        uuid default null,
  p_media           jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_media    jsonb := coalesce(p_media, '[]'::jsonb);
  v_kind     text := coalesce(nullif(trim(p_kind), ''), 'text');
  v_body     text := nullif(trim(coalesce(p_body, '')), '');
  v_meta     jsonb := coalesce(p_media_meta, '{}'::jsonb);
  v_first    text := p_media_path;
  v_id       uuid;
  v_conv     public.conversations%rowtype;
  v_peer     uuid;
  v_preview  text;
  v_member   record;
  v_sender   text;
  v_item     jsonb;
  v_i        integer := 0;
begin
  perform public.tz_conversation_guard(p_conversation_id, v_uid);

  if jsonb_typeof(v_media) <> 'array' or jsonb_array_length(v_media) > 8 then
    raise exception 'invalid_media' using errcode = '22023';
  end if;

  if jsonb_array_length(v_media) > 0 then
    v_item := v_media -> 0;
    if v_kind = 'text' then
      v_kind := case when v_item->>'media_type' in ('image', 'video', 'audio', 'file')
        then v_item->>'media_type' else 'file' end;
    end if;
  end if;

  if v_kind not in ('text', 'image', 'video', 'audio', 'file') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  if v_body is not null and char_length(v_body) > 4000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;

  if v_kind = 'text' and v_body is null then
    raise exception 'empty_message' using errcode = '22023';
  end if;

  if v_kind <> 'text' then
    if jsonb_array_length(v_media) = 0 then
      if v_first is null or split_part(v_first, '/', 1) <> p_conversation_id::text then
        raise exception 'invalid_media_path' using errcode = '22023';
      end if;
    else
      for v_item in select value from jsonb_array_elements(v_media)
      loop
        if jsonb_typeof(v_item) <> 'object'
           or nullif(v_item->>'storage_path', '') is null
           or split_part(v_item->>'storage_path', '/', 1) <> p_conversation_id::text then
          raise exception 'invalid_media_path' using errcode = '22023';
        end if;
        if nullif(v_item->>'thumbnail_path', '') is not null
           and split_part(v_item->>'thumbnail_path', '/', 1) <> p_conversation_id::text then
          raise exception 'invalid_media_path' using errcode = '22023';
        end if;
      end loop;
      v_first := v_media -> 0 ->> 'storage_path';
      v_meta := jsonb_build_object(
        'mime', v_media -> 0 ->> 'mime',
        'name', v_media -> 0 ->> 'name',
        'size', v_media -> 0 -> 'size',
        'width', v_media -> 0 -> 'width',
        'height', v_media -> 0 -> 'height',
        'duration', v_media -> 0 -> 'duration_ms',
        'thumb_path', v_media -> 0 ->> 'thumbnail_path'
      );
    end if;
  end if;

  if jsonb_typeof(v_meta) <> 'object' or pg_column_size(v_meta) > 4096 then
    raise exception 'invalid_media_meta' using errcode = '22023';
  end if;

  select * into v_conv from public.conversations where id = p_conversation_id;

  if v_conv.kind = 'direct' then
    v_peer := public.tz_direct_peer(p_conversation_id, v_uid);
    if v_peer is null or public.is_blocked(v_uid, v_peer)
       or not public.safety_can_message(v_uid, v_peer) then
      raise exception 'messaging_not_allowed' using errcode = '42501';
    end if;
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.messages m
    where m.id = p_reply_to and m.conversation_id = p_conversation_id
  ) then
    raise exception 'invalid_reply' using errcode = '22023';
  end if;

  perform public.safety_check_rate('message_send', 120, interval '1 minute');

  insert into public.messages (
    conversation_id, sender_id, kind, body, media_path, media_meta, reply_to_id
  )
  values (
    p_conversation_id, v_uid, v_kind, v_body,
    case when v_kind = 'text' then null else v_first end,
    case when v_kind = 'text' then '{}'::jsonb else v_meta end,
    p_reply_to
  )
  returning id into v_id;

  if v_kind <> 'text' and jsonb_array_length(v_media) > 0 then
    for v_item in select value from jsonb_array_elements(v_media)
    loop
      insert into public.message_media (
        message_id, media_type, storage_path, thumbnail_path,
        width, height, duration_ms, sort_order
      )
      values (
        v_id,
        case when v_item->>'media_type' in ('image', 'video', 'audio', 'file')
          then v_item->>'media_type' else 'file' end,
        v_item->>'storage_path',
        nullif(v_item->>'thumbnail_path', ''),
        nullif(v_item->>'width', '')::integer,
        nullif(v_item->>'height', '')::integer,
        nullif(v_item->>'duration_ms', '')::integer,
        v_i
      );
      v_i := v_i + 1;
    end loop;
  end if;

  v_preview := case v_kind
    when 'text' then left(coalesce(v_body, ''), 140)
    when 'image' then 'Fotoðraf'
    when 'video' then 'Video'
    when 'audio' then 'Sesli mesaj'
    else 'Dosya'
  end;

  update public.conversations
     set last_message_at = now(),
         last_message_preview = v_preview,
         last_message_sender_id = v_uid,
         updated_at = now()
   where id = p_conversation_id;

  insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
  values (v_id, v_uid, now(), now())
  on conflict do nothing;

  select p.username || ' mesaj gönderdi' into v_sender
  from public.profiles p where p.id = v_uid;

  for v_member in
    select m.user_id
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id <> v_uid
      and m.left_at is null
  loop
    perform public.tz_notify(
      v_member.user_id, v_uid, 'message', coalesce(v_sender, 'Yeni mesaj'),
      v_preview, 'conversation', p_conversation_id::text,
      '/chat/' || p_conversation_id::text
    );
  end loop;

  return public.tz_message_json(v_id, v_uid);
end;
$$;

revoke all on function public.chat_send_message(uuid, text, text, text, jsonb, uuid, jsonb)
  from public, anon;
grant execute on function public.chat_send_message(uuid, text, text, text, jsonb, uuid, jsonb)
  to authenticated;

-- Message receipts drive delivered/read ticks in realtime; media rows let a
-- single message patch include newly attached multi-media.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'message_media'
  ) then
    alter publication supabase_realtime add table public.message_media;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'message_receipts'
  ) then
    alter publication supabase_realtime add table public.message_receipts;
  end if;
end $$;

-- Realtime: media metadata and receipts stream to open chats.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'message_media'
  ) then
    alter publication supabase_realtime add table public.message_media;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'message_receipts'
  ) then
    alter publication supabase_realtime add table public.message_receipts;
  end if;
end $$;
