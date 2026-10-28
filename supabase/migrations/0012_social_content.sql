-- 0011: Social content (posts, media, comments, likes, saves, stories)
--
-- Writes go through security-definer RPCs (0012) so counters, rate limiting and
-- notifications stay consistent. Direct table access is read-only for clients.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('posts', 'posts', true, 26214400,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']),
  ('stories', 'stories', true, 26214400,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']),
  ('listing-images', 'listing-images', true, 15728640,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('message-media', 'message-media', false, 26214400,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime',
         'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id                uuid primary key default gen_random_uuid(),
  author_id         uuid not null references public.profiles (id) on delete cascade,
  body              text,
  visibility        text not null default 'public',
  city              text,
  moderation_status text not null default 'visible',
  like_count        integer not null default 0,
  comment_count     integer not null default 0,
  save_count        integer not null default 0,
  share_count       integer not null default 0,
  is_edited         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint posts_visibility_check check (visibility in ('public', 'followers')),
  constraint posts_moderation_check check (moderation_status in ('visible', 'hidden', 'removed')),
  constraint posts_body_length check (body is null or char_length(body) between 1 and 2000),
  constraint posts_counts_non_negative check (
    like_count >= 0 and comment_count >= 0 and save_count >= 0 and share_count >= 0
  )
);

create index if not exists posts_feed_idx
  on public.posts (created_at desc)
  where moderation_status = 'visible';
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);

create table if not exists public.post_media (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts (id) on delete cascade,
  storage_path text not null,
  media_type   text not null,
  width        integer,
  height       integer,
  duration_ms  integer,
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now(),
  constraint post_media_type_check check (media_type in ('image', 'video')),
  constraint post_media_path_check check (char_length(storage_path) between 3 and 400),
  constraint post_media_sort_check check (sort_order between 0 and 9)
);

create index if not exists post_media_post_idx on public.post_media (post_id, sort_order);

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_user_idx on public.post_likes (user_id);

create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  parent_id  uuid references public.post_comments (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_comments_body_length check (char_length(body) between 1 and 1000)
);

create index if not exists post_comments_post_idx
  on public.post_comments (post_id, created_at desc);
create index if not exists post_comments_parent_idx on public.post_comments (parent_id);

-- `post_saves` predates this migration; reuse it instead of adding a duplicate.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'post_saves_post_fk' and conrelid = 'public.post_saves'::regclass
  ) then
    -- NOT VALID: historical rows may reference posts that never existed, new
    -- writes are enforced from now on.
    alter table public.post_saves
      add constraint post_saves_post_fk
      foreign key (post_id) references public.posts (id) on delete cascade not valid;
  end if;
end $$;

create index if not exists post_saves_post_idx on public.post_saves (post_id);

alter table public.post_saves enable row level security;

-- ---------------------------------------------------------------------------
-- Stories
-- ---------------------------------------------------------------------------
create table if not exists public.stories (
  id                uuid primary key default gen_random_uuid(),
  author_id         uuid not null references public.profiles (id) on delete cascade,
  media_path        text not null,
  media_type        text not null,
  caption           text,
  moderation_status text not null default 'visible',
  expires_at        timestamptz not null default (now() + interval '24 hours'),
  created_at        timestamptz not null default now(),
  constraint stories_media_type_check check (media_type in ('image', 'video')),
  constraint stories_path_check check (char_length(media_path) between 3 and 400),
  constraint stories_caption_length check (caption is null or char_length(caption) <= 200),
  constraint stories_moderation_check check (moderation_status in ('visible', 'hidden', 'removed')),
  constraint stories_expiry_check check (expires_at > created_at)
);

create index if not exists stories_author_idx on public.stories (author_id, created_at desc);
create index if not exists stories_expiry_idx on public.stories (expires_at);

create table if not exists public.story_views (
  story_id  uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create index if not exists story_views_viewer_idx on public.story_views (viewer_id);

-- ---------------------------------------------------------------------------
-- Counters
-- ---------------------------------------------------------------------------
create or replace function public.posts_sync_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles
       set posts_count = posts_count + 1
     where id = new.author_id;
    return new;
  end if;

  update public.profiles
     set posts_count = greatest(posts_count - 1, 0)
   where id = old.author_id;
  return old;
end;
$$;

drop trigger if exists posts_sync_counters on public.posts;
create trigger posts_sync_counters
  after insert or delete on public.posts
  for each row execute function public.posts_sync_counters();

create or replace function public.post_comments_sync_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    return new;
  end if;
  update public.posts
     set comment_count = greatest(comment_count - 1, 0)
   where id = old.post_id;
  return old;
end;
$$;

drop trigger if exists post_comments_sync_counter on public.post_comments;
create trigger post_comments_sync_counter
  after insert or delete on public.post_comments
  for each row execute function public.post_comments_sync_counter();

revoke all on function public.posts_sync_counters() from public, anon, authenticated;
revoke all on function public.post_comments_sync_counter() from public, anon, authenticated;

create or replace function public.posts_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.posts_set_updated_at();

drop trigger if exists post_comments_set_updated_at on public.post_comments;
create trigger post_comments_set_updated_at
  before update on public.post_comments
  for each row execute function public.posts_set_updated_at();

revoke all on function public.posts_set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------
create or replace function public.can_view_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.posts p
      join public.profiles pr on pr.id = p.author_id
    where p.id = p_post_id
      and p.moderation_status = 'visible'
      and pr.account_status = 'active'
      and not public.is_blocked(auth.uid(), p.author_id)
      and (
        p.visibility = 'public'
        or p.author_id = auth.uid()
        or public.is_following(p.author_id)
      )
  );
$$;

revoke all on function public.can_view_post(uuid) from public, anon;
grant execute on function public.can_view_post(uuid) to authenticated, service_role;

create or replace function public.can_view_profile_content(p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_author = auth.uid() then true
    when not exists (
      select 1 from public.profiles p
      where p.id = p_author and p.account_status = 'active'
    ) then false
    when public.is_blocked(auth.uid(), p_author) then false
    else coalesce(
      (
        select case s.profile_visibility
          when 'public' then true
          when 'followers' then public.is_following(p_author)
          else public.are_friends(auth.uid(), p_author)
        end
        from public.profile_settings s
        where s.user_id = p_author
      ),
      true
    )
  end;
$$;

revoke all on function public.can_view_profile_content(uuid) from public, anon;
grant execute on function public.can_view_profile_content(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_saves enable row level security;
alter table public.stories enable row level security;
alter table public.story_views enable row level security;

drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
  for select to authenticated
  using (
    not public.is_blocked(auth.uid(), author_id)
    and (
      moderation_status = 'visible'
      or author_id = auth.uid()
      or public.is_admin()
    )
    and (
      visibility = 'public'
      or author_id = auth.uid()
      or public.is_following(author_id)
    )
  );

drop policy if exists post_media_select on public.post_media;
create policy post_media_select on public.post_media
  for select to authenticated
  using (public.can_view_post(post_id));

drop policy if exists post_likes_select on public.post_likes;
create policy post_likes_select on public.post_likes
  for select to authenticated
  using (user_id = auth.uid() or public.can_view_post(post_id));

drop policy if exists post_comments_select on public.post_comments;
create policy post_comments_select on public.post_comments
  for select to authenticated
  using (public.can_view_post(post_id));

drop policy if exists post_saves_select on public.post_saves;
create policy post_saves_select on public.post_saves
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists stories_select on public.stories;
create policy stories_select on public.stories
  for select to authenticated
  using (
    moderation_status = 'visible'
    and expires_at > now()
    and public.can_view_profile_content(author_id)
  );

drop policy if exists story_views_select on public.story_views;
create policy story_views_select on public.story_views
  for select to authenticated
  using (viewer_id = auth.uid());

revoke all on public.posts from anon, authenticated;
grant select on public.posts to authenticated;

revoke all on public.post_media from anon, authenticated;
grant select on public.post_media to authenticated;

revoke all on public.post_likes from anon, authenticated;
grant select on public.post_likes to authenticated;

revoke all on public.post_comments from anon, authenticated;
grant select on public.post_comments to authenticated;

revoke all on public.post_saves from anon, authenticated;
grant select on public.post_saves to authenticated;

revoke all on public.stories from anon, authenticated;
grant select on public.stories to authenticated;

revoke all on public.story_views from anon, authenticated;
grant select on public.story_views to authenticated;

-- ---------------------------------------------------------------------------
-- Storage policies: posts / stories / listing images
-- ---------------------------------------------------------------------------
drop policy if exists social_media_insert on storage.objects;
create policy social_media_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('posts', 'stories', 'listing-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists social_media_update on storage.objects;
create policy social_media_update
  on storage.objects for update to authenticated
  using (
    bucket_id in ('posts', 'stories', 'listing-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('posts', 'stories', 'listing-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists social_media_delete on storage.objects;
create policy social_media_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('posts', 'stories', 'listing-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  kind        text not null,
  title       text not null,
  body        text,
  entity_type text,
  entity_id   text,
  route       text,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint notifications_kind_check check (kind in (
    'follow', 'like', 'comment', 'message', 'group_invite', 'order',
    'market_message', 'support', 'security', 'system', 'mention'
  )),
  constraint notifications_title_length check (char_length(title) between 1 and 160)
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id)
  where read_at is null;

create table if not exists public.notification_preferences (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  likes      boolean not null default true,
  comments   boolean not null default true,
  follows    boolean not null default true,
  messages   boolean not null default true,
  orders     boolean not null default true,
  support    boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

revoke all on public.notification_preferences from anon, authenticated;
grant select on public.notification_preferences to authenticated;
grant update (likes, comments, follows, messages, orders, support)
  on public.notification_preferences to authenticated;

create or replace function public.notification_preferences_ensure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists notification_preferences_ensure on public.profiles;
create trigger notification_preferences_ensure
  after insert on public.profiles
  for each row execute function public.notification_preferences_ensure();

insert into public.notification_preferences (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

revoke all on function public.notification_preferences_ensure() from public, anon, authenticated;
