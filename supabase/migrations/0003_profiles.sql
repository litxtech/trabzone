-- 0003: Profiles, privacy settings and app preferences
-- Public profile data lives in `profiles`; anything private (birth date, last
-- seen) is isolated in `profile_private` so RLS only has to protect one row.

set search_path = public, extensions;

create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  username             citext not null,
  first_name           text not null,
  last_name            text not null,
  bio                  text,
  city                 text,
  district             text,
  website              text,
  avatar_path          text,
  cover_path           text,
  is_verified          boolean not null default false,
  account_status       text not null default 'active',
  onboarding_completed boolean not null default false,
  followers_count      integer not null default 0,
  following_count      integer not null default 0,
  posts_count          integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint profiles_username_format check (username::text = lower(username::text) and username::text ~ '^[a-z0-9_.]{3,24}$'),
  constraint profiles_first_name_length check (char_length(first_name) between 1 and 60),
  constraint profiles_last_name_length check (char_length(last_name) between 1 and 60),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 300),
  constraint profiles_website_format check (website is null or website ~ '^https?://[^\s]+$'),
  constraint profiles_account_status_check check (account_status in ('active', 'restricted', 'suspended', 'deleted')),
  constraint profiles_counts_non_negative check (followers_count >= 0 and following_count >= 0 and posts_count >= 0)
);

create unique index profiles_username_key on public.profiles (username);
create index profiles_account_status_idx on public.profiles (account_status) where account_status <> 'active';

create table public.profile_private (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  birth_date   date,
  last_seen_at timestamptz,
  updated_at   timestamptz not null default now(),
  constraint profile_private_birth_date_check check (
    birth_date is null or (birth_date > date '1900-01-01' and birth_date <= current_date)
  )
);

create table public.profile_settings (
  user_id               uuid primary key references public.profiles (id) on delete cascade,
  profile_visibility    text not null default 'public',
  discoverable          boolean not null default true,
  show_city             boolean not null default true,
  show_district         boolean not null default true,
  show_last_seen        boolean not null default true,
  show_online_status    boolean not null default true,
  read_receipts         boolean not null default true,
  allow_messages_from   text not null default 'everyone',
  allow_friend_requests boolean not null default true,
  updated_at            timestamptz not null default now(),
  constraint profile_settings_visibility_check check (profile_visibility in ('public', 'followers', 'private')),
  constraint profile_settings_messages_check check (allow_messages_from in ('everyone', 'friends', 'nobody'))
);

create table public.user_preferences (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  theme_mode       text not null default 'system',
  app_icon         text not null default 'aurora',
  haptics_enabled  boolean not null default true,
  locale           text not null default 'tr',
  updated_at       timestamptz not null default now(),
  constraint user_preferences_theme_check check (theme_mode in ('system', 'light', 'dark')),
  constraint user_preferences_icon_check check (app_icon in ('aurora', 'orbit', 'nova')),
  constraint user_preferences_locale_check check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger profile_private_set_updated_at before update on public.profile_private
  for each row execute function public.set_updated_at();
create trigger profile_settings_set_updated_at before update on public.profile_settings
  for each row execute function public.set_updated_at();
create trigger user_preferences_set_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- New auth user -> complete set of rows, atomically.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_first    text;
  v_last     text;
begin
  -- A verified, available username is claimed afterwards through
  -- complete_registration(); the placeholder only satisfies NOT NULL/UNIQUE.
  v_username := 'u_' || substr(replace(new.id::text, '-', ''), 1, 10);
  v_first    := coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), 'Trabzone');
  v_last     := coalesce(nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''), 'Üyesi');

  insert into public.profiles (id, username, first_name, last_name)
  values (new.id, v_username, v_first, v_last);

  insert into public.profile_private (user_id) values (new.id);
  insert into public.profile_settings (user_id) values (new.id);
  insert into public.user_preferences (user_id) values (new.id);

  insert into public.user_role_assignments (user_id, role_key)
  values (new.id, 'user')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Username claim / availability
-- ---------------------------------------------------------------------------
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_username is null then false
    when lower(trim(p_username)) !~ '^[a-z0-9_.]{3,24}$' then false
    when lower(trim(p_username)) = any (array['admin','trabzone','support','help','marketplace','official','moderator','root','system']) then false
    else not exists (
      select 1 from public.profiles p where p.username = lower(trim(p_username))
    )
  end;
$$;

create or replace function public.complete_registration(
  p_username   text,
  p_first_name text,
  p_last_name  text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_username text := lower(trim(p_username));
  v_profile  public.profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if v_username !~ '^[a-z0-9_.]{3,24}$' then
    raise exception 'username_invalid' using errcode = 'P0001';
  end if;

  if v_username = any (array['admin','trabzone','support','help','marketplace','official','moderator','root','system']) then
    raise exception 'username_reserved' using errcode = 'P0001';
  end if;

  if char_length(trim(p_first_name)) not between 1 and 60
     or char_length(trim(p_last_name)) not between 1 and 60 then
    raise exception 'name_invalid' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles where id = v_uid and onboarding_completed) then
    raise exception 'already_completed' using errcode = 'P0001';
  end if;

  begin
    update public.profiles
       set username = v_username,
           first_name = trim(p_first_name),
           last_name = trim(p_last_name),
           onboarding_completed = true
     where id = v_uid
    returning * into v_profile;
  exception
    when unique_violation then
      raise exception 'username_taken' using errcode = 'P0001';
  end;

  if v_profile.id is null then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;

  return v_profile;
end;
$$;

revoke all on function public.is_username_available(text) from public, anon;
revoke all on function public.complete_registration(text, text, text) from public, anon;
grant execute on function public.is_username_available(text) to authenticated;
grant execute on function public.complete_registration(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS + column-level grants
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.profile_settings enable row level security;
alter table public.user_preferences enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (account_status <> 'deleted' or id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profile_private_select_own on public.profile_private
  for select to authenticated
  using (user_id = auth.uid());

create policy profile_private_update_own on public.profile_private
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy profile_settings_select_own on public.profile_settings
  for select to authenticated
  using (user_id = auth.uid());

create policy profile_settings_update_own on public.profile_settings
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_preferences_select_own on public.user_preferences
  for select to authenticated
  using (user_id = auth.uid());

create policy user_preferences_update_own on public.user_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- Counters, verification and status are server-managed: not in the grant list.
grant update (first_name, last_name, bio, city, district, website, avatar_path, cover_path)
  on public.profiles to authenticated;

revoke all on public.profile_private from anon, authenticated;
grant select on public.profile_private to authenticated;
grant update (birth_date, last_seen_at) on public.profile_private to authenticated;

revoke all on public.profile_settings from anon, authenticated;
grant select on public.profile_settings to authenticated;
grant update (profile_visibility, discoverable, show_city, show_district, show_last_seen,
              show_online_status, read_receipts, allow_messages_from, allow_friend_requests)
  on public.profile_settings to authenticated;

revoke all on public.user_preferences from anon, authenticated;
grant select on public.user_preferences to authenticated;
grant update (theme_mode, app_icon, haptics_enabled, locale)
  on public.user_preferences to authenticated;
