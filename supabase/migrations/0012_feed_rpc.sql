-- 0012: Feed, stories, discovery and notification RPCs
--
-- Every write validates ownership, rate limits and visibility server-side.
-- Read helpers are security-definer but NOT granted to clients; only the
-- top-level RPCs are callable.

set search_path = public, extensions;

create or replace function public.tz_require_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles p where p.id = v_uid and p.account_status = 'deleted') then
    raise exception 'account_inactive' using errcode = '28000';
  end if;

  return v_uid;
end;
$$;

revoke all on function public.tz_require_uid() from public, anon;
grant execute on function public.tz_require_uid() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Notification delivery
-- ---------------------------------------------------------------------------
create or replace function public.tz_notify(
  p_user_id     uuid,
  p_actor_id    uuid,
  p_kind        text,
  p_title       text,
  p_body        text,
  p_entity_type text,
  p_entity_id   text,
  p_route       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefs public.notification_preferences%rowtype;
begin
  if p_user_id is null or p_user_id = p_actor_id then
    return;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.account_status in ('active', 'restricted')
  ) then
    return;
  end if;

  if p_actor_id is not null and public.is_blocked(p_user_id, p_actor_id) then
    return;
  end if;

  select * into v_prefs from public.notification_preferences where user_id = p_user_id;
  if found then
    if p_kind = 'like' and not v_prefs.likes then return; end if;
    if p_kind = 'comment' and not v_prefs.comments then return; end if;
    if p_kind = 'follow' and not v_prefs.follows then return; end if;
    if p_kind in ('message', 'group_invite') and not v_prefs.messages then return; end if;
    if p_kind in ('order', 'market_message') and not v_prefs.orders then return; end if;
    if p_kind = 'support' and not v_prefs.support then return; end if;
  end if;

  insert into public.notifications (
    user_id, actor_id, kind, title, body, entity_type, entity_id, route
  )
  values (
    p_user_id, p_actor_id, p_kind, left(p_title, 160), left(p_body, 400),
    p_entity_type, p_entity_id, p_route
  );
end;
$$;

revoke all on function public.tz_notify(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Serialisation helpers (internal)
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

create or replace function public.tz_validate_media_path(p_path text, p_uid uuid)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_path is null or char_length(p_path) < 3 or char_length(p_path) > 400 then
    raise exception 'invalid_media_path' using errcode = '22023';
  end if;

  if split_part(p_path, '/', 1) <> p_uid::text then
    raise exception 'invalid_media_path' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.tz_validate_media_path(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Feed
-- ---------------------------------------------------------------------------
create or replace function public.feed_list(
  p_filter text default 'all',
  p_city   text default null,
  p_cursor timestamptz default null,
  p_limit  integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me    uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
  v_filter text := coalesce(nullif(trim(p_filter), ''), 'all');
begin
  if v_filter not in ('all', 'following', 'nearby', 'popular') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;

  return (
    with base as (
      select
        p.id,
        p.created_at,
        (p.like_count + p.comment_count * 2 + p.save_count * 2) as score
      from public.posts p
        join public.profiles pr on pr.id = p.author_id
      where p.moderation_status = 'visible'
        and pr.account_status = 'active'
        and not public.is_blocked(v_me, p.author_id)
        and (
          p.visibility = 'public'
          or p.author_id = v_me
          or public.is_following(p.author_id)
        )
        and (p_cursor is null or p.created_at < p_cursor)
        and (
          v_filter <> 'following'
          or p.author_id = v_me
          or public.is_following(p.author_id)
        )
        and (
          v_filter <> 'nearby'
          or p_city is null
          or (p.city is not null and lower(trim(p.city)) = lower(trim(p_city)))
        )
        and (v_filter <> 'popular' or p.created_at > now() - interval '30 days')
      order by
        case when v_filter = 'popular' then
          (p.like_count + p.comment_count * 2 + p.save_count * 2)
        end desc nulls last,
        p.created_at desc
      limit v_limit + 1
    ),
    numbered as (
      select
        b.id,
        b.created_at,
        row_number() over (
          order by
            case when v_filter = 'popular' then b.score end desc nulls last,
            b.created_at desc
        ) as rn
      from base b
    )
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(public.tz_post_json(n.id, v_me) order by n.rn)
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

revoke all on function public.feed_list(text, text, timestamptz, integer) from public, anon;
grant execute on function public.feed_list(text, text, timestamptz, integer) to authenticated;

create or replace function public.feed_get_post(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.tz_require_uid();
begin
  if not public.can_view_post(p_post_id) then
    return null;
  end if;
  return public.tz_post_json(p_post_id, v_me);
end;
$$;

revoke all on function public.feed_get_post(uuid) from public, anon;
grant execute on function public.feed_get_post(uuid) to authenticated;

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

    insert into public.post_media (
      post_id, storage_path, media_type, width, height, duration_ms, sort_order
    )
    values (
      v_post_id,
      v_item ->> 'storage_path',
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

create or replace function public.feed_update_post(
  p_post_id    uuid,
  p_body       text default null,
  p_visibility text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.tz_require_uid();
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_vis  text := nullif(trim(coalesce(p_visibility, '')), '');
begin
  if not exists (select 1 from public.posts p where p.id = p_post_id and p.author_id = v_uid) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_body is null and not exists (
    select 1 from public.post_media m where m.post_id = p_post_id
  ) then
    raise exception 'empty_post' using errcode = '22023';
  end if;

  if v_body is not null and char_length(v_body) > 2000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;

  if v_vis is not null and v_vis not in ('public', 'followers') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  update public.posts
     set body = v_body,
         visibility = coalesce(v_vis, visibility),
         is_edited = true
   where id = p_post_id;

  return public.tz_post_json(p_post_id, v_uid);
end;
$$;

revoke all on function public.feed_update_post(uuid, text, text) from public, anon;
grant execute on function public.feed_update_post(uuid, text, text) to authenticated;

create or replace function public.feed_delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and (p.author_id = v_uid or public.is_admin())
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  delete from public.posts where id = p_post_id;
end;
$$;

revoke all on function public.feed_delete_post(uuid) from public, anon;
grant execute on function public.feed_delete_post(uuid) to authenticated;

create or replace function public.feed_toggle_like(p_post_id uuid)
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
  v_title    text;
begin
  if not public.can_view_post(p_post_id) then
    raise exception 'post_not_found' using errcode = '22023';
  end if;

  select p.author_id into v_author from public.posts p where p.id = p_post_id;
  if v_author is null then
    raise exception 'post_not_found' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.post_likes l where l.post_id = p_post_id and l.user_id = v_uid
  ) then
    delete from public.post_likes l where l.post_id = p_post_id and l.user_id = v_uid;
    update public.posts set like_count = greatest(like_count - 1, 0) where id = p_post_id;
    v_liked := false;
  else
    perform public.safety_check_rate('post_like', 400, interval '1 hour');

    insert into public.post_likes (post_id, user_id) values (p_post_id, v_uid)
    on conflict do nothing;
    update public.posts set like_count = like_count + 1 where id = p_post_id;
    v_liked := true;

    select pr.username || ' gönderini beğendi' into v_title
    from public.profiles pr where pr.id = v_uid;

    perform public.tz_notify(
      v_author, v_uid, 'like', coalesce(v_title, 'Gönderin beğenildi'), null,
      'post', p_post_id::text, '/post/' || p_post_id::text
    );
  end if;

  select p.like_count into v_count from public.posts p where p.id = p_post_id;

  return jsonb_build_object('liked', v_liked, 'like_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.feed_toggle_like(uuid) from public, anon;
grant execute on function public.feed_toggle_like(uuid) to authenticated;

create or replace function public.feed_toggle_save(p_post_id uuid)
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
  if not public.can_view_post(p_post_id) then
    raise exception 'post_not_found' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.post_saves s where s.post_id = p_post_id and s.user_id = v_uid
  ) then
    delete from public.post_saves s where s.post_id = p_post_id and s.user_id = v_uid;
    update public.posts set save_count = greatest(save_count - 1, 0) where id = p_post_id;
    v_saved := false;
  else
    insert into public.post_saves (post_id, user_id) values (p_post_id, v_uid)
    on conflict do nothing;
    update public.posts set save_count = save_count + 1 where id = p_post_id;
    v_saved := true;
  end if;

  select p.save_count into v_count from public.posts p where p.id = p_post_id;

  return jsonb_build_object('saved', v_saved, 'save_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.feed_toggle_save(uuid) from public, anon;
grant execute on function public.feed_toggle_save(uuid) to authenticated;

create or replace function public.feed_share_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not public.can_view_post(p_post_id) then
    raise exception 'post_not_found' using errcode = '22023';
  end if;

  update public.posts set share_count = share_count + 1 where id = p_post_id;
end;
$$;

revoke all on function public.feed_share_post(uuid) from public, anon;
grant execute on function public.feed_share_post(uuid) to authenticated;

create or replace function public.feed_list_saved(
  p_limit  integer default 18,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 18), 1), 40);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_post_json(s.post_id, v_uid) order by s.created_at desc)
        from (
          select ps.post_id, ps.created_at
          from public.post_saves ps
            join public.posts p on p.id = ps.post_id
          where ps.user_id = v_uid
            and p.moderation_status = 'visible'
            and public.can_view_post(ps.post_id)
          order by ps.created_at desc
          limit v_limit offset v_offset
        ) s
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.feed_list_saved(integer, integer) from public, anon;
grant execute on function public.feed_list_saved(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
create or replace function public.feed_list_comments(
  p_post_id uuid,
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
  v_uid    uuid := public.tz_require_uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_owner  uuid;
begin
  if not public.can_view_post(p_post_id) then
    raise exception 'post_not_found' using errcode = '22023';
  end if;

  select p.author_id into v_owner from public.posts p where p.id = p_post_id;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'post_id', c.post_id,
            'parent_id', c.parent_id,
            'body', c.body,
            'created_at', c.created_at,
            'is_mine', c.author_id = v_uid,
            'can_delete', c.author_id = v_uid or v_owner = v_uid or public.is_admin(),
            'author_id', pr.id,
            'author_username', pr.username,
            'author_first_name', pr.first_name,
            'author_last_name', pr.last_name,
            'author_avatar_path', pr.avatar_path,
            'author_is_verified', pr.is_verified
          )
          order by c.created_at asc
        )
        from (
          select * from public.post_comments
          where post_id = p_post_id
            and not public.is_blocked(v_uid, author_id)
          order by created_at asc
          limit v_limit offset v_offset
        ) c
          join public.profiles pr on pr.id = c.author_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.feed_list_comments(uuid, integer, integer) from public, anon;
grant execute on function public.feed_list_comments(uuid, integer, integer) to authenticated;

create or replace function public.feed_add_comment(
  p_post_id uuid,
  p_body    text,
  p_parent  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_body   text := nullif(trim(coalesce(p_body, '')), '');
  v_owner  uuid;
  v_policy text;
  v_id     uuid;
  v_username text;
begin
  if not public.can_view_post(p_post_id) then
    raise exception 'post_not_found' using errcode = '22023';
  end if;

  if v_body is null or char_length(v_body) > 1000 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;

  select p.author_id into v_owner from public.posts p where p.id = p_post_id;

  -- Cocuk korumali hesaplarda yorum politikasi uygulanir.
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

  if p_parent is not null and not exists (
    select 1 from public.post_comments c
    where c.id = p_parent and c.post_id = p_post_id
  ) then
    raise exception 'invalid_parent' using errcode = '22023';
  end if;

  perform public.safety_check_rate('comment_create', 120, interval '1 day');

  insert into public.post_comments (post_id, author_id, parent_id, body)
  values (p_post_id, v_uid, p_parent, v_body)
  returning id into v_id;

  select pr.username || ' yorum yaptı' into v_username
  from public.profiles pr where pr.id = v_uid;

  perform public.tz_notify(
    v_owner, v_uid, 'comment', coalesce(v_username, 'Yeni yorum'),
    left(v_body, 120), 'post', p_post_id::text, '/post/' || p_post_id::text
  );

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.feed_add_comment(uuid, text, uuid) from public, anon;
grant execute on function public.feed_add_comment(uuid, text, uuid) to authenticated;

create or replace function public.feed_delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_owner uuid;
begin
  select p.author_id into v_owner
  from public.post_comments c
    join public.posts p on p.id = c.post_id
  where c.id = p_comment_id;

  if v_owner is null then
    raise exception 'comment_not_found' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.post_comments c
    where c.id = p_comment_id
      and (c.author_id = v_uid or v_owner = v_uid or public.is_admin())
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  delete from public.post_comments where id = p_comment_id;
end;
$$;

revoke all on function public.feed_delete_comment(uuid) from public, anon;
grant execute on function public.feed_delete_comment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Profile content tabs
-- ---------------------------------------------------------------------------
create or replace function public.feed_profile_posts(
  p_username text,
  p_kind     text default 'posts',
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
  v_uid    uuid := public.tz_require_uid();
  v_author uuid;
  v_limit  integer := least(greatest(coalesce(p_limit, 18), 1), 40);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_kind   text := coalesce(nullif(trim(p_kind), ''), 'posts');
begin
  select p.id into v_author
  from public.profiles p
  where p.username = lower(trim(p_username));

  if v_author is null then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

  if not public.can_view_profile_content(v_author) then
    raise exception 'profile_restricted' using errcode = '42501';
  end if;

  if v_kind not in ('posts', 'media') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_post_json(x.id, v_uid) order by x.created_at desc)
        from (
          select p.id, p.created_at
          from public.posts p
          where p.author_id = v_author
            and p.moderation_status = 'visible'
            and (p.visibility = 'public' or v_author = v_uid or public.is_following(v_author))
            and (
              v_kind = 'posts'
              or exists (select 1 from public.post_media m where m.post_id = p.id)
            )
          order by p.created_at desc
          limit v_limit offset v_offset
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.feed_profile_posts(text, text, integer, integer) from public, anon;
grant execute on function public.feed_profile_posts(text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Stories
-- ---------------------------------------------------------------------------
create or replace function public.story_create(
  p_media_path text,
  p_media_type text,
  p_caption    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_type  text := coalesce(nullif(trim(p_media_type), ''), 'image');
  v_cap   text := nullif(trim(coalesce(p_caption, '')), '');
  v_id    uuid;
  v_count integer;
begin
  if v_type not in ('image', 'video') then
    raise exception 'invalid_media_type' using errcode = '22023';
  end if;

  if v_cap is not null and char_length(v_cap) > 200 then
    raise exception 'caption_too_long' using errcode = '22023';
  end if;

  perform public.tz_validate_media_path(p_media_path, v_uid);
  perform public.safety_check_rate('story_create', 30, interval '1 day');

  select count(*) into v_count
  from public.stories s
  where s.author_id = v_uid and s.expires_at > now() and s.moderation_status = 'visible';

  if v_count >= 20 then
    raise exception 'story_limit' using errcode = '22023';
  end if;

  insert into public.stories (author_id, media_path, media_type, caption)
  values (v_uid, p_media_path, v_type, v_cap)
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.story_create(text, text, text) from public, anon;
grant execute on function public.story_create(text, text, text) to authenticated;

create or replace function public.story_mark_viewed(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not exists (
    select 1 from public.stories s
    where s.id = p_story_id
      and s.expires_at > now()
      and s.moderation_status = 'visible'
      and public.can_view_profile_content(s.author_id)
  ) then
    raise exception 'story_not_found' using errcode = '22023';
  end if;

  insert into public.story_views (story_id, viewer_id)
  values (p_story_id, v_uid)
  on conflict do nothing;
end;
$$;

revoke all on function public.story_mark_viewed(uuid) from public, anon;
grant execute on function public.story_mark_viewed(uuid) to authenticated;

create or replace function public.tz_story_items(p_author uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'media_path', s.media_path,
        'media_type', s.media_type,
        'caption', s.caption,
        'created_at', s.created_at,
        'expires_at', s.expires_at,
        'viewed', exists (
          select 1 from public.story_views v
          where v.story_id = s.id and v.viewer_id = p_me
        ),
        'view_count', case when p_author = p_me then (
          select count(*) from public.story_views v where v.story_id = s.id
        ) else null end
      )
      order by s.created_at asc
    ),
    '[]'::jsonb
  )
  from public.stories s
  where s.author_id = p_author
    and s.expires_at > now()
    and s.moderation_status = 'visible';
$$;

revoke all on function public.tz_story_items(uuid, uuid) from public, anon, authenticated;

create or replace function public.story_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'author_id', g.author_id,
            'username', g.username,
            'first_name', g.first_name,
            'last_name', g.last_name,
            'avatar_path', g.avatar_path,
            'is_verified', g.is_verified,
            'is_me', g.author_id = v_uid,
            'has_unseen', g.has_unseen,
            'latest_at', g.latest_at,
            'items', public.tz_story_items(g.author_id, v_uid)
          )
          order by (g.author_id = v_uid) desc, g.has_unseen desc, g.latest_at desc
        )
        from (
          select
            s.author_id,
            p.username,
            p.first_name,
            p.last_name,
            p.avatar_path,
            p.is_verified,
            max(s.created_at) as latest_at,
            bool_or(
              not exists (
                select 1 from public.story_views v
                where v.story_id = s.id and v.viewer_id = v_uid
              )
            ) as has_unseen
          from public.stories s
            join public.profiles p on p.id = s.author_id
          where s.expires_at > now()
            and s.moderation_status = 'visible'
            and p.account_status = 'active'
            and not public.is_blocked(v_uid, s.author_id)
            and public.can_view_profile_content(s.author_id)
          group by s.author_id, p.username, p.first_name, p.last_name, p.avatar_path, p.is_verified
          order by max(s.created_at) desc
          limit 40
        ) g
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.story_list() from public, anon;
grant execute on function public.story_list() to authenticated;

create or replace function public.story_list_for_user(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.profiles%rowtype;
begin
  select * into v_row from public.profiles where id = p_user_id;

  if not found or not public.can_view_profile_content(p_user_id) then
    raise exception 'story_not_found' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'author_id', v_row.id,
    'username', v_row.username,
    'first_name', v_row.first_name,
    'last_name', v_row.last_name,
    'avatar_path', v_row.avatar_path,
    'is_verified', v_row.is_verified,
    'is_me', v_row.id = v_uid,
    'items', public.tz_story_items(v_row.id, v_uid)
  );
end;
$$;

revoke all on function public.story_list_for_user(uuid) from public, anon;
grant execute on function public.story_list_for_user(uuid) to authenticated;

create or replace function public.story_delete(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not exists (
    select 1 from public.stories s
    where s.id = p_story_id and (s.author_id = v_uid or public.is_admin())
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  delete from public.stories where id = p_story_id;
end;
$$;

revoke all on function public.story_delete(uuid) from public, anon;
grant execute on function public.story_delete(uuid) to authenticated;

create or replace function public.story_viewers(p_story_id uuid)
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
    select 1 from public.stories s where s.id = p_story_id and s.author_id = v_uid
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id', p.id,
            'username', p.username,
            'first_name', p.first_name,
            'last_name', p.last_name,
            'avatar_path', p.avatar_path,
            'viewed_at', v.viewed_at
          )
          order by v.viewed_at desc
        )
        from public.story_views v
          join public.profiles p on p.id = v.viewer_id
        where v.story_id = p_story_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.story_viewers(uuid) from public, anon;
grant execute on function public.story_viewers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------------
create or replace function public.people_discover(
  p_query  text default null,
  p_city   text default null,
  p_sort   text default 'popular',
  p_limit  integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_query  text := nullif(trim(coalesce(p_query, '')), '');
  v_city   text := nullif(trim(coalesce(p_city, '')), '');
  v_sort   text := coalesce(nullif(trim(p_sort), ''), 'popular');
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_sort not in ('popular', 'new', 'city') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', x.id,
            'username', x.username,
            'first_name', x.first_name,
            'last_name', x.last_name,
            'bio', x.bio,
            'city', x.city_visible,
            'avatar_path', x.avatar_path,
            'is_verified', x.is_verified,
            'followers_count', x.followers_count,
            'created_at', x.created_at,
            'is_following', x.is_following,
            'profile_visibility', x.visibility
          )
          order by x.rn
        )
        from (
          select ranked.*
          from (
            select
              p.id,
              p.username,
              p.first_name,
              p.last_name,
              p.bio,
              p.avatar_path,
              p.is_verified,
              p.followers_count,
              p.created_at,
              case when coalesce(s.show_city, true) then p.city else null end as city_visible,
              coalesce(s.profile_visibility, 'public') as visibility,
              exists (
                select 1 from public.user_follows f
                where f.follower_id = v_uid and f.following_id = p.id
              ) as is_following,
              row_number() over (
                order by
                  case when v_sort = 'new' then p.created_at end desc,
                  case when v_sort = 'city' then
                    case when p.city is not null and v_city is not null
                              and lower(p.city) = lower(v_city) then 0 else 1 end
                  end asc,
                  p.followers_count desc,
                  p.username asc
              ) as rn
            from public.profiles p
              left join public.profile_settings s on s.user_id = p.id
            where p.id <> v_uid
              and p.account_status = 'active'
              and p.onboarding_completed
              and coalesce(s.discoverable, true)
              and not public.is_blocked(v_uid, p.id)
              and (v_query is null
                   or p.username ilike '%' || v_query || '%'
                   or p.first_name ilike '%' || v_query || '%'
                   or p.last_name ilike '%' || v_query || '%')
              and (v_city is null or (p.city is not null and lower(p.city) = lower(v_city)))
          ) ranked
          where ranked.rn > v_offset and ranked.rn <= v_offset + v_limit
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.people_discover(text, text, text, integer, integer) from public, anon;
grant execute on function public.people_discover(text, text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create or replace function public.notifications_list(
  p_limit  integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', n.id,
            'kind', n.kind,
            'title', n.title,
            'body', n.body,
            'entity_type', n.entity_type,
            'entity_id', n.entity_id,
            'route', n.route,
            'read_at', n.read_at,
            'created_at', n.created_at,
            'actor_id', n.actor_id,
            'actor_username', a.username,
            'actor_first_name', a.first_name,
            'actor_last_name', a.last_name,
            'actor_avatar_path', a.avatar_path
          )
          order by n.created_at desc
        )
        from (
          select * from public.notifications
          where user_id = v_uid
          order by created_at desc
          limit v_limit offset v_offset
        ) n
          left join public.profiles a on a.id = n.actor_id
      ),
      '[]'::jsonb
    ),
    'unread', (
      select count(*) from public.notifications
      where user_id = v_uid and read_at is null
    )
  );
end;
$$;

revoke all on function public.notifications_list(integer, integer) from public, anon;
grant execute on function public.notifications_list(integer, integer) to authenticated;

create or replace function public.notifications_unread_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.notifications n
  where n.user_id = auth.uid() and n.read_at is null;
$$;

revoke all on function public.notifications_unread_count() from public, anon;
grant execute on function public.notifications_unread_count() to authenticated;

create or replace function public.notifications_mark_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_count integer;
begin
  update public.notifications n
     set read_at = now()
   where n.user_id = v_uid
     and n.read_at is null
     and (p_ids is null or n.id = any (p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notifications_mark_read(uuid[]) from public, anon;
grant execute on function public.notifications_mark_read(uuid[]) to authenticated;
