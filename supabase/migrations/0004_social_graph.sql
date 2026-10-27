-- 0004: Social graph (follows, friendships, block/mute)
-- Small, well-indexed tables with the privacy rules baked into RLS.

set search_path = public, extensions;

create table public.user_follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint user_follows_no_self check (follower_id <> following_id)
);

create index user_follows_following_idx on public.user_follows (following_id);

create table public.friend_requests (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  receiver_id  uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending',
  message      text,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_no_self check (sender_id <> receiver_id),
  constraint friend_requests_status_check check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  constraint friend_requests_message_length check (message is null or char_length(message) <= 200)
);

create unique index friend_requests_pending_pair_idx
  on public.friend_requests (least(sender_id, receiver_id), greatest(sender_id, receiver_id))
  where status = 'pending';
create index friend_requests_receiver_idx on public.friend_requests (receiver_id, status);
create index friend_requests_sender_idx on public.friend_requests (sender_id, status);

create table public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

create table public.user_mutes (
  muter_id   uuid not null references public.profiles (id) on delete cascade,
  muted_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint user_mutes_no_self check (muter_id <> muted_id)
);

create index user_mutes_muted_idx on public.user_mutes (muted_id);

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies can use them without RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_blocked(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
       or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
  );
$$;

create or replace function public.is_following(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_follows f
    where f.follower_id = auth.uid() and f.following_id = p_target
  );
$$;

revoke all on function public.is_blocked(uuid, uuid) from public, anon;
revoke all on function public.is_following(uuid) from public, anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_following(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Counters + friendship state machine
-- ---------------------------------------------------------------------------
create or replace function public.handle_follow_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set followers_count = followers_count + 1 where id = new.following_id;
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
    return new;
  end if;

  update public.profiles set followers_count = greatest(followers_count - 1, 0) where id = old.following_id;
  update public.profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
  return old;
end;
$$;

create trigger user_follows_counters
  after insert or delete on public.user_follows
  for each row execute function public.handle_follow_counters();

create or replace function public.friend_requests_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sender_id <> old.sender_id or new.receiver_id <> old.receiver_id then
    raise exception 'immutable_participants' using errcode = 'P0001';
  end if;

  if old.status <> 'pending' then
    raise exception 'request_already_resolved' using errcode = 'P0001';
  end if;

  if new.status = 'cancelled' and old.sender_id <> auth.uid() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  if new.status in ('accepted', 'rejected') and old.receiver_id <> auth.uid() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  if new.status <> 'pending' then
    new.responded_at = now();
  end if;

  return new;
end;
$$;

create trigger friend_requests_guard
  before update on public.friend_requests
  for each row execute function public.friend_requests_guard();

revoke all on function public.handle_follow_counters() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.user_follows enable row level security;
alter table public.friend_requests enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_mutes enable row level security;

create policy user_follows_select on public.user_follows
  for select to authenticated
  using (true);

create policy user_follows_insert on public.user_follows
  for insert to authenticated
  with check (
    follower_id = auth.uid()
    and not public.is_blocked(follower_id, following_id)
  );

create policy user_follows_delete on public.user_follows
  for delete to authenticated
  using (follower_id = auth.uid());

create policy friend_requests_select on public.friend_requests
  for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

create policy friend_requests_insert on public.friend_requests
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and status = 'pending'
    and not public.is_blocked(sender_id, receiver_id)
    and exists (
      select 1 from public.profile_settings s
      where s.user_id = receiver_id and s.allow_friend_requests
    )
  );

create policy friend_requests_update on public.friend_requests
  for update to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid())
  with check (sender_id = auth.uid() or receiver_id = auth.uid());

create policy user_blocks_select on public.user_blocks
  for select to authenticated
  using (blocker_id = auth.uid());

create policy user_blocks_insert on public.user_blocks
  for insert to authenticated
  with check (blocker_id = auth.uid());

create policy user_blocks_delete on public.user_blocks
  for delete to authenticated
  using (blocker_id = auth.uid());

create policy user_mutes_select on public.user_mutes
  for select to authenticated
  using (muter_id = auth.uid());

create policy user_mutes_insert on public.user_mutes
  for insert to authenticated
  with check (muter_id = auth.uid());

create policy user_mutes_delete on public.user_mutes
  for delete to authenticated
  using (muter_id = auth.uid());

-- Friendships are derived from accepted requests; no direct writes.
revoke all on public.user_follows from anon, authenticated;
grant select on public.user_follows to authenticated;
grant insert (follower_id, following_id) on public.user_follows to authenticated;
grant delete on public.user_follows to authenticated;

revoke all on public.friend_requests from anon, authenticated;
grant select on public.friend_requests to authenticated;
grant insert (sender_id, receiver_id, message) on public.friend_requests to authenticated;
grant update (status) on public.friend_requests to authenticated;

revoke all on public.user_blocks from anon, authenticated;
grant select on public.user_blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.user_blocks to authenticated;
grant delete on public.user_blocks to authenticated;

revoke all on public.user_mutes from anon, authenticated;
grant select on public.user_mutes to authenticated;
grant insert (muter_id, muted_id) on public.user_mutes to authenticated;
grant delete on public.user_mutes to authenticated;
