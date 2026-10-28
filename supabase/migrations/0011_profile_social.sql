-- 0010: Profile media (avatar/cover) + privacy-aware public profile reads
--
-- Profile data is public, but the *visibility* of individual fields is decided
-- by `profile_settings`, which is own-row only. Readers therefore go through
-- security-definer functions that apply the owner's rules before returning a row.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Storage buckets for profile media
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('covers',  'covers',  true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_media_insert on storage.objects;
create policy profile_media_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('avatars', 'covers')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists profile_media_update on storage.objects;
create policy profile_media_update
  on storage.objects for update to authenticated
  using (
    bucket_id in ('avatars', 'covers')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('avatars', 'covers')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists profile_media_delete on storage.objects;
create policy profile_media_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('avatars', 'covers')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Relationship helpers
-- ---------------------------------------------------------------------------
create or replace function public.are_friends(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friend_requests r
    where r.status = 'accepted'
      and (
        (r.sender_id = p_user_a and r.receiver_id = p_user_b)
        or (r.sender_id = p_user_b and r.receiver_id = p_user_a)
      )
  );
$$;

revoke all on function public.are_friends(uuid, uuid) from public, anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated, service_role;

-- `profile_settings` is own-row only, so the friend-request policy cannot read
-- the receiver's row directly. This definer helper exposes just the one flag.
create or replace function public.accepts_friend_requests(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.allow_friend_requests from public.profile_settings s where s.user_id = p_user_id),
    true
  );
$$;

revoke all on function public.accepts_friend_requests(uuid) from public, anon;
grant execute on function public.accepts_friend_requests(uuid) to authenticated, service_role;

drop policy if exists friend_requests_insert on public.friend_requests;
create policy friend_requests_insert on public.friend_requests
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and status = 'pending'
    and not public.is_blocked(sender_id, receiver_id)
    and public.accepts_friend_requests(receiver_id)
  );

-- ---------------------------------------------------------------------------
-- Public profile read (honours profile_settings + blocks)
-- ---------------------------------------------------------------------------
drop function if exists public.get_profile_view(text);

create or replace function public.get_profile_view(p_username text)
returns table (
  id                    uuid,
  username              citext,
  first_name            text,
  last_name             text,
  bio                   text,
  city                  text,
  district              text,
  website               text,
  avatar_path           text,
  cover_path            text,
  is_verified           boolean,
  followers_count       integer,
  following_count       integer,
  posts_count           integer,
  created_at            timestamptz,
  visibility            text,
  restricted            boolean,
  is_me                 boolean,
  i_follow              boolean,
  follows_me            boolean,
  is_friend             boolean,
  friend_request_out    uuid,
  friend_request_in     uuid,
  blocked               boolean,
  blocked_by_me         boolean,
  accepts_friend_requests boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_target    public.profiles%rowtype;
  v_settings  public.profile_settings%rowtype;
  v_restricted boolean := false;
  v_blocked   boolean := false;
  v_i_follow  boolean := false;
  v_follows_me boolean := false;
  v_friends   boolean := false;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select p.* into v_target
  from public.profiles p
  where p.username = lower(trim(p_username))
  limit 1;

  if not found then
    return;
  end if;

  v_blocked := public.is_blocked(v_me, v_target.id);

  -- Ayarlar yoksa (olmamali) guvenli varsayilanlarla devam et.
  select s.* into v_settings
  from public.profile_settings s
  where s.user_id = v_target.id;

  if not found then
    v_settings.profile_visibility := 'public';
    v_settings.show_city := true;
    v_settings.show_district := true;
    v_settings.allow_friend_requests := true;
  end if;

  if v_blocked then
    -- Engel varsa yalnizca "erisilemez" bilgisini don.
    return query
    select
      v_target.id, v_target.username, null::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::text, false,
      0, 0, 0, v_target.created_at,
      v_settings.profile_visibility, true, v_target.id = v_me,
      false, false, false, null::uuid, null::uuid, true,
      exists (
        select 1 from public.user_blocks b
        where b.blocker_id = v_me and b.blocked_id = v_target.id
      ),
      false;
    return;
  end if;

  v_i_follow := exists (
    select 1 from public.user_follows f
    where f.follower_id = v_me and f.following_id = v_target.id
  );

  v_follows_me := exists (
    select 1 from public.user_follows f
    where f.follower_id = v_target.id and f.following_id = v_me
  );

  v_friends := public.are_friends(v_me, v_target.id);

  v_restricted :=
    v_target.id <> v_me
    and (
      (v_settings.profile_visibility = 'private' and not v_friends)
      or (v_settings.profile_visibility = 'followers' and not v_i_follow and not v_friends)
    );

  return query
  select
    v_target.id,
    v_target.username,
    v_target.first_name,
    v_target.last_name,
    case when v_restricted then null else v_target.bio end,
    case when v_restricted or not v_settings.show_city then null else v_target.city end,
    case when v_restricted or not v_settings.show_district then null else v_target.district end,
    case when v_restricted then null else v_target.website end,
    v_target.avatar_path,
    case when v_restricted then null else v_target.cover_path end,
    v_target.is_verified,
    v_target.followers_count,
    v_target.following_count,
    v_target.posts_count,
    v_target.created_at,
    v_settings.profile_visibility,
    v_restricted,
    v_target.id = v_me,
    v_i_follow,
    v_follows_me,
    v_friends,
    (
      select r.id from public.friend_requests r
      where r.sender_id = v_me and r.receiver_id = v_target.id and r.status = 'pending'
      limit 1
    ),
    (
      select r.id from public.friend_requests r
      where r.sender_id = v_target.id and r.receiver_id = v_me and r.status = 'pending'
      limit 1
    ),
    false,
    exists (
      select 1 from public.user_blocks b
      where b.blocker_id = v_me and b.blocked_id = v_target.id
    ),
    v_settings.allow_friend_requests;
end;
$$;

revoke all on function public.get_profile_view(text) from public, anon;
grant execute on function public.get_profile_view(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Followers / following lists (block-aware, privacy-aware)
-- ---------------------------------------------------------------------------
drop function if exists public.list_connections(uuid, text, integer, integer);

create or replace function public.list_connections(
  p_user_id uuid,
  p_kind    text,
  p_limit   integer default 30,
  p_offset  integer default 0
)
returns table (
  id              uuid,
  username        citext,
  first_name      text,
  last_name       text,
  bio             text,
  city            text,
  avatar_path     text,
  is_verified     boolean,
  followers_count integer,
  is_following    boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me       uuid := auth.uid();
  v_friends  boolean;
  v_settings public.profile_settings%rowtype;
  v_limit    integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if p_kind not in ('followers', 'following') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  select s.* into v_settings from public.profile_settings s where s.user_id = p_user_id;

  if not found then
    v_settings.profile_visibility := 'public';
    v_settings.show_city := true;
  end if;

  v_friends := public.are_friends(v_me, p_user_id);

  -- Gizli hesabin baglantilari yalnizca kendisine ve arkadaslarina gorunur.
  if p_user_id <> v_me
     and not v_friends
     and coalesce(v_settings.profile_visibility, 'public') = 'private' then
    return;
  end if;

  return query
  select
    p.id,
    p.username,
    p.first_name,
    p.last_name,
    p.bio,
    case when coalesce(v_settings.show_city, true) then p.city else null end,
    p.avatar_path,
    p.is_verified,
    p.followers_count,
    exists (
      select 1 from public.user_follows f2
      where f2.follower_id = v_me and f2.following_id = p.id
    )
  from public.profiles p
  where p.account_status = 'active'
    and not public.is_blocked(v_me, p.id)
    and (
      (p_kind = 'followers' and exists (
        select 1 from public.user_follows f
        where f.following_id = p_user_id and f.follower_id = p.id
      ))
      or
      (p_kind = 'following' and exists (
        select 1 from public.user_follows f
        where f.follower_id = p_user_id and f.following_id = p.id
      ))
    )
  order by p.followers_count desc, p.username asc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.list_connections(uuid, text, integer, integer) from public, anon;
grant execute on function public.list_connections(uuid, text, integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Friend requests inbox (both directions, pending only)
-- ---------------------------------------------------------------------------
drop function if exists public.list_friend_requests();

create or replace function public.list_friend_requests()
returns table (
  id          uuid,
  direction   text,
  status      text,
  message     text,
  created_at  timestamptz,
  user_id     uuid,
  username    citext,
  first_name  text,
  last_name   text,
  avatar_path text,
  is_verified boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  return query
  select
    r.id,
    case when r.receiver_id = v_me then 'in' else 'out' end,
    r.status,
    r.message,
    r.created_at,
    p.id,
    p.username,
    p.first_name,
    p.last_name,
    p.avatar_path,
    p.is_verified
  from public.friend_requests r
  join public.profiles p
    on p.id = case when r.receiver_id = v_me then r.sender_id else r.receiver_id end
  where r.status = 'pending'
    and (r.sender_id = v_me or r.receiver_id = v_me)
    and not public.is_blocked(v_me, p.id)
  order by r.created_at desc
  limit 100;
end;
$$;

revoke all on function public.list_friend_requests() from public, anon;
grant execute on function public.list_friend_requests() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Block / unblock with relationship cleanup
-- ---------------------------------------------------------------------------
create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_user_id is null or p_user_id = v_me then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  -- Engellemek takibi ve bekleyen arkadaslik isteklerini sona erdirir.
  delete from public.user_follows f
   where (f.follower_id = v_me and f.following_id = p_user_id)
      or (f.follower_id = p_user_id and f.following_id = v_me);

  update public.friend_requests r
     set status = 'cancelled'
   where r.status = 'pending'
     and (
       (r.sender_id = v_me and r.receiver_id = p_user_id)
       or (r.sender_id = p_user_id and r.receiver_id = v_me)
     );

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_me, p_user_id)
  on conflict do nothing;
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  delete from public.user_blocks b
   where b.blocker_id = v_me and b.blocked_id = p_user_id;
end;
$$;

revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Profile media path bookkeeping
-- ---------------------------------------------------------------------------
-- Avatar/cover paths must live under the owner's folder, otherwise a user could
-- point their profile at somebody else's upload.
create or replace function public.profiles_guard_media_paths()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.avatar_path is not null
     and (storage.foldername(new.avatar_path))[1] <> new.id::text then
    raise exception 'invalid_avatar_path' using errcode = '22023';
  end if;

  if new.cover_path is not null
     and (storage.foldername(new.cover_path))[1] <> new.id::text then
    raise exception 'invalid_cover_path' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_media_paths on public.profiles;
create trigger profiles_guard_media_paths
  before update of avatar_path, cover_path on public.profiles
  for each row execute function public.profiles_guard_media_paths();

revoke all on function public.profiles_guard_media_paths() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion safety
-- ---------------------------------------------------------------------------
-- Deleting a user cascades into follows/friend requests, whose AFTER DELETE
-- triggers write activity rows that point at the now-missing profile. Those
-- inserts must be skipped instead of aborting the whole deletion.
create or replace function public.activity_events_skip_missing_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actor_user_id is not null
     and not exists (select 1 from public.profiles p where p.id = new.actor_user_id) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists activity_events_skip_missing_actor on public.activity_events;
create trigger activity_events_skip_missing_actor
  before insert on public.activity_events
  for each row execute function public.activity_events_skip_missing_actor();

revoke all on function public.activity_events_skip_missing_actor() from public, anon, authenticated;
