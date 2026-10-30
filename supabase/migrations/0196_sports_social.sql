-- ---------------------------------------------------------------------------
-- 0196 — Maç Arenası: sosyal katman
--
--  * Canlı sohbet: maç başına tek oda. Gönderim yalnızca sunucu RPC'si ile;
--    oturum, hesap durumu, yaptırım, uzunluk, bağlantı, yasaklı ifade, hız,
--    yavaş mod ve tekrar kontrolleri burada yapılır. Mesajlar özel Realtime
--    kanalı `sports-chat:<fixture_id>` üzerinden yayınlanır; istemcilerin bu
--    konuya yazma yetkisi yoktur (yalnızca okuma politikası).
--  * Kalıcı yorumlar mevcut premium yorum RPC'lerine `match` içerik türü
--    olarak eklenir (aynı UI, aynı bildirim/şikâyet akışı).
--  * Anketler: kullanıcı başına tek oy veritabanı birincil anahtarıyla
--    zorunlu; oy değişikliği anket bazında açıkça tanımlanır. Ödül/bahis yok.
--  * Taraftar medyası mevcut gönderi altyapısını kullanır; burada yalnızca
--    gönderi ↔ maç bağlantısı tutulur.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Sohbet tabloları
-- ---------------------------------------------------------------------------
create table if not exists public.sports_chat_messages (
  id              bigint generated always as identity primary key,
  fixture_id      bigint not null references public.sports_fixtures (id) on delete cascade,
  user_id         uuid references public.profiles (id) on delete set null,
  kind            text not null default 'user' check (kind in ('user', 'moderator', 'system')),
  body            text not null,
  body_hash       text,
  reply_to        bigint references public.sports_chat_messages (id) on delete set null,
  client_id       uuid,
  status          text not null default 'visible' check (status in ('visible', 'deleted', 'removed')),
  removed_by      uuid references public.profiles (id) on delete set null,
  removed_reason  text,
  like_count      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists sports_chat_messages_fixture_idx on public.sports_chat_messages (fixture_id, id desc);
create index if not exists sports_chat_messages_user_idx on public.sports_chat_messages (user_id, fixture_id, created_at desc);
create unique index if not exists sports_chat_messages_client_idx
  on public.sports_chat_messages (user_id, client_id) where client_id is not null;

create table if not exists public.sports_chat_likes (
  message_id  bigint not null references public.sports_chat_messages (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists public.sports_chat_sanctions (
  id          uuid primary key default gen_random_uuid(),
  fixture_id  bigint references public.sports_fixtures (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('mute', 'kick', 'ban')),
  expires_at  timestamptz,
  reason      text not null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles (id) on delete set null
);
create index if not exists sports_chat_sanctions_user_idx on public.sports_chat_sanctions (user_id) where revoked_at is null;

create table if not exists public.sports_chat_moderators (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  added_by    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.sports_chat_reports (
  id           uuid primary key default gen_random_uuid(),
  message_id   bigint not null references public.sports_chat_messages (id) on delete cascade,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  reason       text not null check (reason in ('spam', 'hate', 'harassment', 'violence', 'sexual', 'personal_info', 'other')),
  note         text,
  status       text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by  uuid references public.profiles (id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (message_id, reporter_id)
);
create index if not exists sports_chat_reports_open_idx on public.sports_chat_reports (status, created_at desc);

create table if not exists public.sports_chat_presence (
  fixture_id    bigint not null references public.sports_fixtures (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  last_seen_at  timestamptz not null default now(),
  primary key (fixture_id, user_id)
);
create index if not exists sports_chat_presence_seen_idx on public.sports_chat_presence (fixture_id, last_seen_at desc);

-- ---------------------------------------------------------------------------
-- 2. Maç yorumları (mevcut yorum sistemine `match` türü)
-- ---------------------------------------------------------------------------
create table if not exists public.sports_fixture_comments (
  id                 uuid primary key default gen_random_uuid(),
  fixture_uid        uuid not null references public.sports_fixtures (uid) on delete cascade,
  author_id          uuid not null references public.profiles (id) on delete cascade,
  parent_id          uuid references public.sports_fixture_comments (id) on delete cascade,
  body               text not null default '',
  moderation_status  text not null default 'visible' check (moderation_status in ('visible', 'hidden', 'removed')),
  moderation_reason  text,
  like_count         integer not null default 0,
  edited_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists sports_fixture_comments_root_idx
  on public.sports_fixture_comments (fixture_uid, created_at desc) where parent_id is null;
create index if not exists sports_fixture_comments_parent_idx on public.sports_fixture_comments (parent_id, created_at);

alter table public.comment_media drop constraint if exists comment_media_content_check;
alter table public.comment_media add constraint comment_media_content_check
  check (content_type = any (array['post', 'reel', 'match']));
alter table public.comment_likes drop constraint if exists comment_likes_content_check;
alter table public.comment_likes add constraint comment_likes_content_check
  check (content_type = any (array['post', 'reel', 'match']));

-- ---------------------------------------------------------------------------
-- 3. Anketler
-- ---------------------------------------------------------------------------
create table if not exists public.sports_polls (
  id                  uuid primary key default gen_random_uuid(),
  fixture_id          bigint not null references public.sports_fixtures (id) on delete cascade,
  question            text not null check (char_length(question) between 5 and 160),
  kind                text not null default 'custom'
                      check (kind in ('custom', 'winner', 'first_half', 'player_of_match')),
  auto_key            text,
  status              text not null default 'active' check (status in ('draft', 'active', 'closed', 'disabled')),
  opens_at            timestamptz not null default now(),
  closes_at           timestamptz,
  allow_change        boolean not null default false,
  results_visibility  text not null default 'after_vote' check (results_visibility in ('after_vote', 'always', 'after_close')),
  total_votes         integer not null default 0,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (fixture_id, auto_key)
);
create index if not exists sports_polls_fixture_idx on public.sports_polls (fixture_id, created_at);

create table if not exists public.sports_poll_options (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references public.sports_polls (id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 80),
  player_id   bigint,
  sort_order  integer not null default 0,
  votes       integer not null default 0
);
create index if not exists sports_poll_options_poll_idx on public.sports_poll_options (poll_id, sort_order);

create table if not exists public.sports_poll_votes (
  poll_id       uuid not null references public.sports_polls (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  option_id     uuid not null references public.sports_poll_options (id) on delete cascade,
  change_count  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (poll_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 4. Taraftar medyası ve haber bağlantıları
-- ---------------------------------------------------------------------------
create table if not exists public.sports_fixture_media (
  id             uuid primary key default gen_random_uuid(),
  fixture_id     bigint not null references public.sports_fixtures (id) on delete cascade,
  post_id        uuid not null unique references public.posts (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  category       text not null check (category in ('prematch', 'stadium', 'video', 'watch_party', 'celebration', 'opinion')),
  status         text not null default 'visible' check (status in ('visible', 'hidden')),
  hidden_reason  text,
  hidden_by      uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists sports_fixture_media_fixture_idx on public.sports_fixture_media (fixture_id, status, created_at desc);

create table if not exists public.sports_fixture_news (
  fixture_id  bigint not null references public.sports_fixtures (id) on delete cascade,
  post_id     uuid not null references public.posts (id) on delete cascade,
  added_by    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (fixture_id, post_id)
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'sports_chat_messages', 'sports_chat_likes', 'sports_chat_sanctions', 'sports_chat_moderators',
    'sports_chat_reports', 'sports_chat_presence', 'sports_fixture_comments', 'sports_polls',
    'sports_poll_options', 'sports_poll_votes', 'sports_fixture_media', 'sports_fixture_news'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Özel sohbet kanalı: oturum açmış kullanıcılar dinleyebilir, kimse istemciden yayın yapamaz.
drop policy if exists "sports chat listen" on realtime.messages;
create policy "sports chat listen" on realtime.messages
  for select to authenticated
  using (realtime.topic() like 'sports-chat:%' and extension = 'broadcast');

-- ---------------------------------------------------------------------------
-- 5. Ortak yardımcılar
-- ---------------------------------------------------------------------------
create or replace function public.sports_author_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
                            'first_name', p.first_name, 'last_name', p.last_name,
                            'avatar_path', p.avatar_path, 'is_verified', p.is_verified)
    from public.profiles p where p.id = p_user
$$;

create or replace function public.sports_is_chat_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.has_permission('sports.moderate')
    or exists (select 1 from public.sports_chat_moderators m where m.user_id = auth.uid())
  )
$$;

create or replace function public.sports_chat_room_state(p_fixture bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not s.chat_enabled then 'disabled'
    when f.id is null then 'closed'
    when f.chat_state = 'closed' then 'closed'
    when f.chat_state = 'paused' then 'paused'
    when f.chat_state = 'open' then 'open'
    when f.phase = 'cancelled' then 'closed'
    when now() < f.kickoff_at - make_interval(mins => s.chat_open_before_minutes) then 'not_open'
    when public.sports_phase_is_finished(f.phase) or f.phase in ('postponed', 'abandoned')
      then case when now() > coalesce(f.finished_seen_at, f.kickoff_at + interval '2 hours')
                             + make_interval(mins => s.chat_close_after_minutes)
                then 'closed' else 'open' end
    when now() > f.kickoff_at + interval '6 hours' + make_interval(mins => s.chat_close_after_minutes) then 'closed'
    else 'open'
  end
  from public.sports_settings s
  left join public.sports_fixtures f on f.id = p_fixture
  where s.id = 1
$$;

create or replace function public.sports_active_sanction(p_user uuid, p_fixture bigint)
returns public.sports_chat_sanctions
language sql
stable
security definer
set search_path = public
as $$
  select x.* from public.sports_chat_sanctions x
   where x.user_id = p_user and x.revoked_at is null
     and (x.expires_at is null or x.expires_at > now())
     and (x.fixture_id is null or x.fixture_id = p_fixture)
   order by case x.kind when 'ban' then 0 when 'kick' then 1 else 2 end, x.expires_at desc nulls first
   limit 1
$$;

create or replace function public.sports_chat_message_json(p_id bigint, p_me uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id,
    'fixture_id', m.fixture_id,
    'kind', m.kind,
    'status', m.status,
    'body', case when m.status = 'visible' then m.body end,
    'created_at', m.created_at,
    'like_count', m.like_count,
    'liked', case when p_me is null then false
                  else exists (select 1 from public.sports_chat_likes l where l.message_id = m.id and l.user_id = p_me) end,
    'is_mine', p_me is not null and m.user_id = p_me,
    'author', case when m.user_id is not null then public.sports_author_json(m.user_id) end,
    'reply_to', (select jsonb_build_object(
                          'id', r.id,
                          'author_username', pr.username,
                          'author_name', coalesce(nullif(pr.display_name, ''), nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username),
                          'body', case when r.status = 'visible' then left(r.body, 120) end)
                   from public.sports_chat_messages r
                   left join public.profiles pr on pr.id = r.user_id
                  where r.id = m.reply_to)
  )
  from public.sports_chat_messages m
  where m.id = p_id
$$;

create or replace function public.sports_chat_publish(p_fixture bigint, p_event text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(p_payload, p_event, 'sports-chat:' || p_fixture::text, true);
exception when others then
  null;
end;
$$;

create or replace function public.sports_chat_summary(p_fixture bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'state', public.sports_chat_room_state(p_fixture),
    'active_users', (select count(*) from public.sports_chat_presence p
                      where p.fixture_id = p_fixture and p.last_seen_at > now() - interval '2 minutes'),
    'messages', (select count(*) from public.sports_chat_messages m
                  where m.fixture_id = p_fixture and m.status = 'visible' and m.kind <> 'system')
  )
$$;

create or replace function public.sports_chat_system_message(p_fixture bigint, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.sports_chat_messages (fixture_id, user_id, kind, body)
  values (p_fixture, null, 'system', left(p_body, 280))
  returning id into v_id;
  perform public.sports_chat_publish(p_fixture, 'message', public.sports_chat_message_json(v_id, null));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Sohbet RPC'leri
-- ---------------------------------------------------------------------------
create or replace function public.sports_chat_state(p_fixture bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.sports_settings;
  f public.sports_fixtures;
  v_sanction public.sports_chat_sanctions;
  v_status text;
  v_child boolean := false;
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into s from public.sports_settings where id = 1;
  select * into f from public.sports_fixtures where id = p_fixture;
  if v_uid is not null then
    v_sanction := public.sports_active_sanction(v_uid, p_fixture);
    select account_status into v_status from public.profiles where id = v_uid;
    v_child := coalesce(public.safety_is_child_protected(v_uid), false);
  end if;
  return jsonb_build_object(
    'state', public.sports_chat_room_state(p_fixture),
    'slow_mode_seconds', f.chat_slow_mode_seconds,
    'max_length', s.chat_max_length,
    'links_allowed', s.chat_links_allowed,
    'pinned', f.chat_pinned,
    'active_users', (select count(*) from public.sports_chat_presence p
                      where p.fixture_id = p_fixture and p.last_seen_at > now() - interval '2 minutes'),
    'me', case when v_uid is null then null else jsonb_build_object(
      'is_moderator', public.sports_is_chat_moderator(),
      'account_active', v_status = 'active',
      'child_protected', v_child,
      'sanction', case when v_sanction.id is null then null else jsonb_build_object(
                    'kind', v_sanction.kind, 'expires_at', v_sanction.expires_at, 'reason', v_sanction.reason) end
    ) end
  );
end;
$$;

create or replace function public.sports_chat_list(
  p_fixture bigint, p_before bigint default null, p_after bigint default null, p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_items jsonb;
  v_count integer;
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  with picked as (
    select m.id
      from public.sports_chat_messages m
     where m.fixture_id = p_fixture
       and (p_before is null or m.id < p_before)
       and (p_after is null or m.id > p_after)
       and (m.user_id is null or not public.is_blocked(v_uid, m.user_id))
     order by case when p_after is not null then m.id end asc,
              case when p_after is null then m.id end desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(public.sports_chat_message_json(p.id, v_uid) order by p.id), '[]'::jsonb), count(*)
    into v_items, v_count
    from picked p;

  if v_count > v_limit then
    -- Fazladan çekilen bir kayıt yalnızca "daha fazla var" bilgisini taşır.
    if p_after is not null then
      v_items := v_items - (jsonb_array_length(v_items) - 1);
    else
      v_items := v_items - 0;
    end if;
  end if;

  return jsonb_build_object('items', v_items, 'has_more', v_count > v_limit);
end;
$$;

create or replace function public.sports_chat_send(
  p_fixture bigint, p_body text, p_reply_to bigint default null, p_client_id uuid default null,
  p_as_moderator boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  s public.sports_settings;
  f public.sports_fixtures;
  v_body text;
  v_hash text;
  v_state text;
  v_status text;
  v_mod boolean;
  v_sanction public.sports_chat_sanctions;
  v_existing bigint;
  v_last timestamptz;
  v_term text;
  v_id bigint;
  v_json jsonb;
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into s from public.sports_settings where id = 1;
  select * into f from public.sports_fixtures where id = p_fixture;

  if p_client_id is not null then
    select id into v_existing from public.sports_chat_messages where user_id = v_uid and client_id = p_client_id;
    if v_existing is not null then
      return public.sports_chat_message_json(v_existing, v_uid);
    end if;
  end if;

  select account_status into v_status from public.profiles where id = v_uid;
  if v_status is distinct from 'active' then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  v_mod := public.sports_is_chat_moderator();

  v_state := public.sports_chat_room_state(p_fixture);
  if v_state <> 'open' and not (v_mod and v_state = 'paused') then
    raise exception 'sports_chat_closed' using errcode = '42501';
  end if;

  v_sanction := public.sports_active_sanction(v_uid, p_fixture);
  if v_sanction.id is not null and not v_mod then
    raise exception 'sports_chat_sanctioned' using errcode = '42501';
  end if;

  if not v_mod and coalesce(public.safety_is_child_protected(v_uid), false) then
    raise exception 'sports_chat_child_protected' using errcode = '42501';
  end if;

  v_body := regexp_replace(trim(coalesce(p_body, '')), '[[:cntrl:]]', '', 'g');
  v_body := regexp_replace(v_body, '\s{3,}', '  ', 'g');
  if char_length(v_body) = 0 or char_length(v_body) > s.chat_max_length then
    raise exception 'sports_chat_invalid_length' using errcode = '22023';
  end if;
  if not v_mod and not s.chat_links_allowed
     and v_body ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|io|co|me|tv|xyz|ru|link|ly|gg)(/|\s|$))' then
    raise exception 'sports_chat_link_blocked' using errcode = '22023';
  end if;
  if v_body ~ '(.)\1{14,}' then
    raise exception 'sports_chat_spam' using errcode = '22023';
  end if;
  foreach v_term in array s.chat_blocked_terms loop
    if char_length(trim(v_term)) > 0 and position(lower(trim(v_term)) in lower(v_body)) > 0 then
      raise exception 'sports_chat_blocked_term' using errcode = '22023';
    end if;
  end loop;

  if not v_mod then
    perform public.safety_check_rate('sports_chat_minute', s.chat_rate_per_minute, interval '1 minute');
    perform public.safety_check_rate('sports_chat_hour', greatest(s.chat_rate_per_minute * 20, 60), interval '1 hour');

    if f.chat_slow_mode_seconds > 0 then
      select max(created_at) into v_last from public.sports_chat_messages
       where fixture_id = p_fixture and user_id = v_uid and status <> 'removed';
      if v_last is not null and v_last > now() - make_interval(secs => f.chat_slow_mode_seconds) then
        raise exception 'sports_chat_slow_mode' using errcode = '42900';
      end if;
    end if;
  end if;

  v_hash := md5(lower(regexp_replace(v_body, '\s+', ' ', 'g')));
  if s.chat_duplicate_window_seconds > 0 and exists (
    select 1 from public.sports_chat_messages
     where fixture_id = p_fixture and user_id = v_uid and body_hash = v_hash
       and created_at > now() - make_interval(secs => s.chat_duplicate_window_seconds)
  ) then
    raise exception 'sports_chat_duplicate' using errcode = '22023';
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.sports_chat_messages r
     where r.id = p_reply_to and r.fixture_id = p_fixture and r.status = 'visible'
  ) then
    raise exception 'sports_chat_invalid_reply' using errcode = '22023';
  end if;

  insert into public.sports_chat_messages (fixture_id, user_id, kind, body, body_hash, reply_to, client_id)
  values (p_fixture, v_uid, case when v_mod and p_as_moderator then 'moderator' else 'user' end,
          v_body, v_hash, p_reply_to, p_client_id)
  returning id into v_id;

  insert into public.sports_chat_presence (fixture_id, user_id, last_seen_at)
  values (p_fixture, v_uid, now())
  on conflict (fixture_id, user_id) do update set last_seen_at = now();

  v_json := public.sports_chat_message_json(v_id, null);
  perform public.sports_chat_publish(p_fixture, 'message', v_json);
  return v_json || jsonb_build_object('is_mine', true);
end;
$$;

create or replace function public.sports_chat_delete(p_message bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  m public.sports_chat_messages;
begin
  select * into m from public.sports_chat_messages where id = p_message;
  if m.id is null or m.user_id is distinct from v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.sports_chat_messages set status = 'deleted', updated_at = now() where id = p_message and status = 'visible';
  perform public.sports_chat_publish(m.fixture_id, 'remove', jsonb_build_object('id', p_message, 'status', 'deleted'));
  return jsonb_build_object('id', p_message, 'status', 'deleted');
end;
$$;

create or replace function public.sports_chat_toggle_like(p_message bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  m public.sports_chat_messages;
  v_liked boolean;
  v_count integer;
begin
  select * into m from public.sports_chat_messages where id = p_message;
  if m.id is null or m.status <> 'visible' or not public.sports_fixture_visible(m.fixture_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.safety_check_rate('sports_chat_like', 120, interval '1 minute');
  insert into public.sports_chat_likes (message_id, user_id) values (p_message, v_uid) on conflict do nothing;
  if found then
    v_liked := true;
  else
    delete from public.sports_chat_likes where message_id = p_message and user_id = v_uid;
    v_liked := false;
  end if;
  select count(*) into v_count from public.sports_chat_likes where message_id = p_message;
  update public.sports_chat_messages set like_count = v_count where id = p_message;
  perform public.sports_chat_publish(m.fixture_id, 'like', jsonb_build_object('id', p_message, 'like_count', v_count));
  return jsonb_build_object('liked', v_liked, 'like_count', v_count);
end;
$$;

create or replace function public.sports_chat_report(p_message bigint, p_reason text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  m public.sports_chat_messages;
begin
  select * into m from public.sports_chat_messages where id = p_message;
  if m.id is null or m.kind = 'system' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if m.user_id = v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform public.safety_check_rate('sports_chat_report', 30, interval '1 hour');
  insert into public.sports_chat_reports (message_id, reporter_id, reason, note)
  values (p_message, v_uid,
          case when p_reason in ('spam', 'hate', 'harassment', 'violence', 'sexual', 'personal_info') then p_reason else 'other' end,
          left(nullif(trim(p_note), ''), 500))
  on conflict (message_id, reporter_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sports_chat_heartbeat(p_fixture bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.sports_chat_presence (fixture_id, user_id, last_seen_at)
  values (p_fixture, v_uid, now())
  on conflict (fixture_id, user_id) do update set last_seen_at = now()
  where public.sports_chat_presence.last_seen_at < now() - interval '20 seconds';
  return public.sports_chat_summary(p_fixture);
end;
$$;

-- Uygulama içi moderatör işlemleri (Admin panel de aynı fonksiyonları kullanır).
create or replace function public.sports_chat_mod_remove(p_message bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_reason text := public.sports_require_reason(p_reason);
  m public.sports_chat_messages;
begin
  if not public.sports_is_chat_moderator() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into m from public.sports_chat_messages where id = p_message;
  if m.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.sports_chat_messages
     set status = 'removed', removed_by = v_uid, removed_reason = v_reason, updated_at = now()
   where id = p_message;
  update public.sports_chat_reports set status = 'resolved', resolved_by = v_uid, resolved_at = now()
   where message_id = p_message and status = 'open';
  perform public.sports_audit(v_uid, 'chat_message_removed', 'chat_message', p_message::text, v_reason,
                              jsonb_build_object('body', m.body, 'user_id', m.user_id), null);
  perform public.sports_chat_publish(m.fixture_id, 'remove', jsonb_build_object('id', p_message, 'status', 'removed'));
  return jsonb_build_object('id', p_message, 'status', 'removed');
end;
$$;

create or replace function public.sports_chat_mod_sanction(
  p_user uuid, p_kind text, p_minutes integer, p_reason text, p_fixture bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_reason text := public.sports_require_reason(p_reason);
  v_id uuid;
begin
  if not public.sports_is_chat_moderator() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_kind not in ('mute', 'kick', 'ban') or p_user is null or p_user = v_uid then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  -- Kalıcı ve genel yasaklar yalnızca yetkili admin tarafından verilir.
  if (p_kind = 'ban' or p_fixture is null) and not public.has_permission('sports.moderate') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  insert into public.sports_chat_sanctions (fixture_id, user_id, kind, expires_at, reason, created_by)
  values (p_fixture, p_user, p_kind,
          case when p_minutes is null or p_minutes <= 0 then
                 case when p_kind = 'kick' then now() + interval '30 minutes' else null end
               else now() + make_interval(mins => least(p_minutes, 525600)) end,
          v_reason, v_uid)
  returning id into v_id;
  perform public.sports_audit(v_uid, 'chat_sanction_' || p_kind, 'user', p_user::text, v_reason, null,
                              jsonb_build_object('fixture_id', p_fixture, 'minutes', p_minutes, 'sanction_id', v_id));
  if p_fixture is not null then
    perform public.sports_chat_publish(p_fixture, 'sanction', jsonb_build_object('user_id', p_user, 'kind', p_kind));
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Maç yorumları (`match` içerik türü)
-- ---------------------------------------------------------------------------
create or replace function public.sports_comment_fixture(p_uid uuid)
returns public.sports_fixtures
language sql
stable
security definer
set search_path = public
as $$
  select f.* from public.sports_fixtures f
   where f.uid = p_uid and not f.hidden and (not f.is_test or public.sports_can_see_test())
$$;

create or replace function public.sports_comment_json(p_comment_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'content_type', 'match',
    'content_id', c.fixture_uid,
    'parent_id', c.parent_id,
    'body', c.body,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'edited_at', c.edited_at,
    'like_count', c.like_count,
    'liked', exists (select 1 from public.comment_likes l
                      where l.comment_id = c.id and l.content_type = 'match' and l.user_id = p_me),
    'reply_count', (select count(*) from public.sports_fixture_comments r
                     where r.parent_id = c.id and r.moderation_status = 'visible'),
    'is_mine', c.author_id = p_me,
    'can_edit', c.author_id = p_me,
    'can_delete', c.author_id = p_me or public.is_admin() or public.has_permission('sports.moderate'),
    'moderation_status', c.moderation_status,
    'author_id', pr.id,
    'author_username', pr.username,
    'author_first_name', pr.first_name,
    'author_last_name', pr.last_name,
    'author_avatar_path', pr.avatar_path,
    'author_is_verified', pr.is_verified,
    'media', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'media_type', m.media_type, 'storage_path', m.storage_path,
               'thumbnail_path', m.thumbnail_path, 'width', m.width, 'height', m.height,
               'duration_ms', m.duration_ms, 'sort_order', m.sort_order) order by m.sort_order)
        from public.comment_media m
       where m.content_type = 'match' and m.comment_id = c.id), '[]'::jsonb)
  )
  from public.sports_fixture_comments c
  join public.profiles pr on pr.id = c.author_id
  where c.id = p_comment_id
$$;

create or replace function public.sports_comment_with_replies(p_comment_id uuid, p_me uuid, p_reply_limit integer default 3)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.sports_comment_json(p_comment_id, p_me), '{}'::jsonb)
    || jsonb_build_object('replies', coalesce((
         select jsonb_agg(public.sports_comment_json(r.id, p_me) order by r.created_at)
           from (select c.id, c.created_at from public.sports_fixture_comments c
                  where c.parent_id = p_comment_id and c.moderation_status = 'visible'
                    and not public.is_blocked(p_me, c.author_id)
                  order by c.created_at
                  limit least(greatest(coalesce(p_reply_limit, 3), 0), 20)) r), '[]'::jsonb))
$$;

create or replace function public.sports_comment_list(p_content_id uuid, p_me uuid, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.sports_fixtures;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_count integer;
begin
  f := public.sports_comment_fixture(p_content_id);
  if f.id is null then
    raise exception 'content_not_found' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(public.sports_comment_with_replies(x.id, p_me, 3) order by x.created_at desc), '[]'::jsonb),
         count(*)
    into v_items, v_count
    from (select c.id, c.created_at from public.sports_fixture_comments c
           where c.fixture_uid = p_content_id and c.parent_id is null and c.moderation_status = 'visible'
             and not public.is_blocked(p_me, c.author_id)
           order by c.created_at desc
           limit v_limit + 1 offset v_offset) x;
  if v_count > v_limit then
    v_items := v_items - (jsonb_array_length(v_items) - 1);
  end if;
  return jsonb_build_object('items', v_items, 'has_more', v_count > v_limit);
end;
$$;

create or replace function public.sports_comment_add(
  p_content_id uuid, p_body text, p_parent uuid, p_media jsonb, p_me uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  f public.sports_fixtures;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_media jsonb := coalesce(p_media, '[]'::jsonb);
  v_parent uuid := p_parent;
  v_parent_author uuid;
  v_parent_root uuid;
  v_id uuid;
  v_actor text;
  v_route text;
  v_item jsonb;
  v_i integer := 0;
  v_mention record;
begin
  select * into s from public.sports_settings where id = 1;
  f := public.sports_comment_fixture(p_content_id);
  if f.id is null then
    raise exception 'content_not_found' using errcode = '22023';
  end if;
  if not s.comments_enabled or f.comments_locked then
    raise exception 'comments_locked' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_me and account_status = 'active') then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  if jsonb_typeof(v_media) <> 'array' or jsonb_array_length(v_media) > 4 then
    raise exception 'invalid_media' using errcode = '22023';
  end if;
  if (v_body is null) and jsonb_array_length(v_media) = 0 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;
  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;

  if v_parent is not null then
    select c.author_id, c.parent_id into v_parent_author, v_parent_root
      from public.sports_fixture_comments c
     where c.id = p_parent and c.fixture_uid = p_content_id and c.moderation_status = 'visible';
    if v_parent_author is null then
      raise exception 'invalid_parent' using errcode = '22023';
    end if;
    v_parent := coalesce(v_parent_root, p_parent);
  end if;

  perform public.safety_check_rate('comment_create', 120, interval '1 day');
  perform public.safety_check_rate('sports_comment', 20, interval '10 minutes');

  insert into public.sports_fixture_comments (fixture_uid, author_id, parent_id, body)
  values (p_content_id, p_me, v_parent, coalesce(v_body, ''))
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_media) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_media' using errcode = '22023';
    end if;
    perform public.tz_validate_media_path(v_item ->> 'storage_path', p_me);
    if nullif(v_item ->> 'thumbnail_path', '') is not null then
      perform public.tz_validate_media_path(v_item ->> 'thumbnail_path', p_me);
    end if;
    insert into public.comment_media (comment_id, content_type, media_type, storage_path, thumbnail_path,
                                      width, height, duration_ms, sort_order)
    values (v_id, 'match', case when v_item ->> 'media_type' = 'video' then 'video' else 'image' end,
            v_item ->> 'storage_path', nullif(v_item ->> 'thumbnail_path', ''),
            nullif(v_item ->> 'width', '')::integer, nullif(v_item ->> 'height', '')::integer,
            nullif(v_item ->> 'duration_ms', '')::integer, v_i);
    v_i := v_i + 1;
  end loop;

  select pr.username into v_actor from public.profiles pr where pr.id = p_me;
  v_route := '/trabzonspor/mac/' || f.id::text || '?tab=comments&comment=' || v_id::text;

  if v_parent_author is not null and v_parent_author <> p_me then
    perform public.tz_notify(v_parent_author, p_me, 'comment',
                             coalesce(v_actor, 'Bir kullanıcı') || ' maç yorumuna yanıt verdi',
                             left(coalesce(v_body, 'Medya'), 120), 'match', f.id::text, v_route);
  end if;

  if v_body is not null then
    for v_mention in
      select distinct p.id
        from regexp_matches(v_body, '@([A-Za-z0-9_.]{3,30})', 'g') as m(u)
        join public.profiles p on lower(p.username) = lower(m.u[1])
       where p.id <> p_me and p.id is distinct from v_parent_author
       limit 5
    loop
      perform public.tz_notify(v_mention.id, p_me, 'mention',
                               coalesce(v_actor, 'Bir kullanıcı') || ' seni maç yorumunda andı',
                               left(v_body, 120), 'match', f.id::text, v_route);
    end loop;
  end if;

  perform public.sports_broadcast(f.id, 'comments');
  return public.sports_comment_with_replies(v_id, p_me, 3);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Mevcut yorum RPC'lerine `match` dalı (+ comment_reply bildirim türü düzeltmesi)
-- ---------------------------------------------------------------------------
create or replace function public.tz_comment_json(p_content_type text, p_comment_id uuid, p_me uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v jsonb;
begin
  if p_content_type = 'match' then
    return public.sports_comment_json(p_comment_id, p_me);
  end if;

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
$function$;

create or replace function public.tz_comment_with_replies(p_content_type text, p_comment_id uuid, p_me uuid, p_reply_limit integer default 3)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_reply_limit, 3), 0), 20);
  v_replies jsonb;
begin
  if p_content_type = 'match' then
    return public.sports_comment_with_replies(p_comment_id, p_me, p_reply_limit);
  end if;

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
$function$;

create or replace function public.comment_list(p_content_type text, p_content_id uuid, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_uid    uuid := public.tz_require_uid();
  v_type   text := coalesce(nullif(trim(p_content_type), ''), 'post');
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items  jsonb;
  v_more   boolean := false;
begin
  if v_type = 'match' then
    return public.sports_comment_list(p_content_id, v_uid, p_limit, p_offset);
  end if;

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
$function$;

create or replace function public.comment_replies(p_content_type text, p_parent_id uuid, p_limit integer default 30, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
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
  elsif v_type = 'match' then
    select coalesce(jsonb_agg(public.sports_comment_json(x.id, v_uid) order by x.created_at asc), '[]'::jsonb)
      into v_items
    from (
      select c.id, c.created_at
      from public.sports_fixture_comments c
      where c.parent_id = p_parent_id
        and c.moderation_status = 'visible'
        and not public.is_blocked(v_uid, c.author_id)
        and (public.sports_comment_fixture(c.fixture_uid)).id is not null
      order by c.created_at asc
      limit v_limit offset v_offset
    ) x;
  else
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end;
$function$;

create or replace function public.comment_add(p_content_type text, p_content_id uuid, p_body text, p_parent uuid default null, p_media jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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
  if v_type = 'match' then
    return public.sports_comment_add(p_content_id, p_body, p_parent, p_media, v_uid);
  end if;

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

  -- Yanıt bildirimi `comment` türüyle gönderilir: `comment_reply` notifications_kind_check
  -- listesinde olmadığından önceki sürümde yanıt eklemek hata veriyordu.
  if v_parent_author is not null and v_parent_author <> v_uid and v_parent_author <> v_owner then
    perform public.tz_notify(
      v_parent_author,
      v_uid,
      'comment',
      coalesce(v_actor, 'Bir kullanıcı') || ' yorumuna yanıt verdi',
      left(coalesce(v_body, 'Medya'), 120),
      v_type,
      p_content_id::text,
      v_route || '?comment=' || v_id::text
    );
  end if;

  v_item := public.tz_comment_with_replies(v_type, v_id, v_uid, 3);
  return v_item;
end;
$function$;

create or replace function public.comment_update(p_content_type text, p_comment_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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
  elsif v_type = 'match' then
    update public.sports_fixture_comments
       set body = v_body, edited_at = now(), updated_at = now()
     where id = p_comment_id and author_id = v_uid and moderation_status = 'visible';
  else
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return public.tz_comment_with_replies(v_type, p_comment_id, v_uid, 3);
end;
$function$;

create or replace function public.comment_delete(p_content_type text, p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid   uuid := public.tz_require_uid();
  v_type  text := coalesce(nullif(trim(p_content_type), ''), 'post');
  v_paths jsonb;
  v_uid_fixture uuid;
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
  elsif v_type = 'match' then
    select c.fixture_uid into v_uid_fixture
      from public.sports_fixture_comments c
     where c.id = p_comment_id
       and (c.author_id = v_uid or public.is_admin() or public.has_permission('sports.moderate'));
    if v_uid_fixture is null then
      raise exception 'not_allowed' using errcode = '42501';
    end if;

    select coalesce(jsonb_agg(m.storage_path), '[]'::jsonb)
      into v_paths
    from public.comment_media m
    where m.content_type = 'match'
      and (
        m.comment_id = p_comment_id
        or m.comment_id in (
          select c.id from public.sports_fixture_comments c where c.parent_id = p_comment_id
        )
      );

    delete from public.comment_media
     where content_type = 'match'
       and (comment_id = p_comment_id
            or comment_id in (select c.id from public.sports_fixture_comments c where c.parent_id = p_comment_id));
    delete from public.sports_fixture_comments where id = p_comment_id;
    perform public.sports_broadcast((select id from public.sports_fixtures where uid = v_uid_fixture), 'comments');
  else
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  return jsonb_build_object('media_paths', coalesce(v_paths, '[]'::jsonb));
end;
$function$;

create or replace function public.comment_toggle_like(p_content_type text, p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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
  elsif v_type = 'match' then
    if not exists (
      select 1 from public.sports_fixture_comments c
      where c.id = p_comment_id and c.moderation_status = 'visible'
        and (public.sports_comment_fixture(c.fixture_uid)).id is not null
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
  elsif v_type = 'reel' then
    update public.reel_comments set like_count = v_count where id = p_comment_id;
  else
    update public.sports_fixture_comments set like_count = v_count where id = p_comment_id;
  end if;

  return jsonb_build_object('liked', v_liked, 'like_count', v_count);
end;
$function$;

-- Konuşma paylaşım stüdyosu: yalnızca herkese açık içerikte, görünür yorumlar,
-- gerçek sıra ve metinle. Gizli/silinmiş yorumlar ve çocuk koruması altındaki
-- hesapların yorumları dışa aktarılmaz.
create or replace function public.comment_thread_share(p_content_type text, p_comment_id uuid, p_reply_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type text := coalesce(nullif(trim(p_content_type), ''), 'post');
  v_root uuid;
  v_content uuid;
  v_context jsonb;
  v_limit integer := least(greatest(coalesce(p_reply_limit, 5), 0), 8);
  v_items jsonb;
  f public.sports_fixtures;
begin
  if v_type = 'post' then
    select coalesce(c.parent_id, c.id), c.post_id into v_root, v_content
      from public.post_comments c where c.id = p_comment_id and c.moderation_status = 'visible';
    if v_root is null or not exists (
      select 1 from public.posts p join public.profiles a on a.id = p.author_id
       where p.id = v_content and p.visibility = 'public' and p.moderation_status = 'visible'
         and a.account_status = 'active'
    ) then
      raise exception 'content_not_found' using errcode = '22023';
    end if;
    select jsonb_build_object('kind', 'post', 'title', coalesce(nullif(a.display_name, ''), a.username) || ' gönderisi',
                              'route', '/post/' || p.id::text)
      into v_context
      from public.posts p join public.profiles a on a.id = p.author_id where p.id = v_content;
    select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_items from (
      select 0 as ord, c.created_at, jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at,
             'like_count', c.like_count, 'is_root', true, 'author', public.sports_author_json(c.author_id)) j
        from public.post_comments c where c.id = v_root and c.moderation_status = 'visible'
         and not coalesce(public.safety_is_child_protected(c.author_id), false)
      union all
      select 1 + row_number() over (order by c.created_at), c.created_at,
             jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at,
             'like_count', c.like_count, 'is_root', false, 'author', public.sports_author_json(c.author_id))
        from public.post_comments c
       where c.parent_id = v_root and c.moderation_status = 'visible'
         and not coalesce(public.safety_is_child_protected(c.author_id), false)
         and exists (select 1 from public.profiles a where a.id = c.author_id and a.account_status = 'active')
    ) x where x.ord <= v_limit + 1;
  elsif v_type = 'reel' then
    select coalesce(c.parent_id, c.id), c.reel_id into v_root, v_content
      from public.reel_comments c where c.id = p_comment_id and c.moderation_status = 'visible';
    if v_root is null or not public.can_view_reel(v_content) then
      raise exception 'content_not_found' using errcode = '22023';
    end if;
    v_context := jsonb_build_object('kind', 'reel', 'title', 'Reels yorumları', 'route', '/reel/' || v_content::text);
    select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_items from (
      select 0 as ord, jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at,
             'like_count', c.like_count, 'is_root', true, 'author', public.sports_author_json(c.author_id)) j
        from public.reel_comments c where c.id = v_root and c.moderation_status = 'visible'
         and not coalesce(public.safety_is_child_protected(c.author_id), false)
      union all
      select 1 + row_number() over (order by c.created_at),
             jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at,
             'like_count', c.like_count, 'is_root', false, 'author', public.sports_author_json(c.author_id))
        from public.reel_comments c
       where c.parent_id = v_root and c.moderation_status = 'visible'
         and not coalesce(public.safety_is_child_protected(c.author_id), false)
         and exists (select 1 from public.profiles a where a.id = c.author_id and a.account_status = 'active')
    ) x where x.ord <= v_limit + 1;
  elsif v_type = 'match' then
    select coalesce(c.parent_id, c.id), c.fixture_uid into v_root, v_content
      from public.sports_fixture_comments c where c.id = p_comment_id and c.moderation_status = 'visible';
    select * into f from public.sports_fixtures where uid = v_content and not hidden and not is_test;
    if v_root is null or f.id is null then
      raise exception 'content_not_found' using errcode = '22023';
    end if;
    v_context := jsonb_build_object('kind', 'match', 'title', public.sports_score_line(f),
                                    'subtitle', coalesce(f.league_name, '') , 'route', '/trabzonspor/mac/' || f.id::text);
    select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_items from (
      select 0 as ord, jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at,
             'like_count', c.like_count, 'is_root', true, 'author', public.sports_author_json(c.author_id)) j
        from public.sports_fixture_comments c where c.id = v_root and c.moderation_status = 'visible'
         and not coalesce(public.safety_is_child_protected(c.author_id), false)
      union all
      select 1 + row_number() over (order by c.created_at),
             jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at,
             'like_count', c.like_count, 'is_root', false, 'author', public.sports_author_json(c.author_id))
        from public.sports_fixture_comments c
       where c.parent_id = v_root and c.moderation_status = 'visible'
         and not coalesce(public.safety_is_child_protected(c.author_id), false)
         and exists (select 1 from public.profiles a where a.id = c.author_id and a.account_status = 'active')
    ) x where x.ord <= v_limit + 1;
  else
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  if v_items is null or jsonb_array_length(v_items) = 0 or not coalesce((v_items -> 0 ->> 'is_root')::boolean, false) then
    raise exception 'content_not_found' using errcode = '22023';
  end if;

  return jsonb_build_object('context', v_context, 'root_id', v_root, 'items', v_items);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Anketler
-- ---------------------------------------------------------------------------
create or replace function public.sports_poll_json(p_poll uuid, p_me uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.sports_polls;
  v_state text;
  v_my uuid;
  v_visible boolean;
begin
  select * into p from public.sports_polls where id = p_poll;
  if p.id is null then
    return null;
  end if;
  v_state := case
    when p.status in ('draft', 'disabled') then p.status
    when p.status = 'closed' or (p.closes_at is not null and p.closes_at <= now()) then 'closed'
    when p.opens_at > now() then 'scheduled'
    else 'active' end;
  if p_me is not null then
    select option_id into v_my from public.sports_poll_votes where poll_id = p_poll and user_id = p_me;
  end if;
  v_visible := case p.results_visibility
    when 'always' then true
    when 'after_close' then v_state = 'closed'
    else v_state = 'closed' or v_my is not null end;
  return jsonb_build_object(
    'id', p.id, 'fixture_id', p.fixture_id, 'question', p.question, 'kind', p.kind, 'state', v_state,
    'opens_at', p.opens_at, 'closes_at', p.closes_at, 'allow_change', p.allow_change,
    'results_visibility', p.results_visibility, 'results_visible', v_visible,
    'total_votes', case when v_visible then p.total_votes end,
    'my_vote', v_my,
    'options', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', o.id, 'label', o.label, 'player_id', o.player_id,
                 'votes', case when v_visible then o.votes end,
                 'pct', case when v_visible and p.total_votes > 0 then round(o.votes * 100.0 / p.total_votes, 1) end)
                 order by o.sort_order)
               from public.sports_poll_options o where o.poll_id = p.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.sports_polls_list(p_fixture bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(public.sports_poll_json(p.id, v_uid) order by p.created_at desc)
      from public.sports_polls p
     where p.fixture_id = p_fixture and p.status not in ('draft', 'disabled')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.sports_poll_recount(p_poll uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sports_poll_options o
     set votes = (select count(*) from public.sports_poll_votes v where v.option_id = o.id)
   where o.poll_id = p_poll;
  update public.sports_polls p
     set total_votes = (select count(*) from public.sports_poll_votes v where v.poll_id = p.id), updated_at = now()
   where p.id = p_poll;
$$;

create or replace function public.sports_poll_vote(p_poll uuid, p_option uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  p public.sports_polls;
  v_existing public.sports_poll_votes;
begin
  select * into p from public.sports_polls where id = p_poll for update;
  if p.id is null or not public.sports_fixture_visible(p.fixture_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p.status <> 'active' or p.opens_at > now() or (p.closes_at is not null and p.closes_at <= now()) then
    raise exception 'sports_poll_closed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sports_poll_options where id = p_option and poll_id = p_poll) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and account_status = 'active') then
    raise exception 'account_inactive' using errcode = '42501';
  end if;
  perform public.safety_check_rate('sports_poll_vote', 60, interval '1 hour');

  select * into v_existing from public.sports_poll_votes where poll_id = p_poll and user_id = v_uid;
  if v_existing.poll_id is not null then
    if v_existing.option_id = p_option then
      return public.sports_poll_json(p_poll, v_uid);
    end if;
    if not p.allow_change or v_existing.change_count >= 3 then
      raise exception 'sports_poll_already_voted' using errcode = '42501';
    end if;
    update public.sports_poll_votes
       set option_id = p_option, change_count = change_count + 1, updated_at = now()
     where poll_id = p_poll and user_id = v_uid;
  else
    insert into public.sports_poll_votes (poll_id, user_id, option_id) values (p_poll, v_uid, p_option);
  end if;
  perform public.sports_poll_recount(p_poll);
  perform public.sports_broadcast(p.fixture_id, 'polls');
  return public.sports_poll_json(p_poll, v_uid);
end;
$$;

create or replace function public.sports_poll_create_internal(
  p_fixture bigint, p_question text, p_kind text, p_options text[], p_auto_key text,
  p_closes_at timestamptz, p_allow_change boolean, p_visibility text, p_actor uuid,
  p_player_ids bigint[] default null, p_opens_at timestamptz default null, p_status text default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  i integer;
begin
  if array_length(p_options, 1) is null or array_length(p_options, 1) < 2 or array_length(p_options, 1) > 12 then
    raise exception 'sports_poll_invalid_options' using errcode = '22023';
  end if;
  insert into public.sports_polls (fixture_id, question, kind, auto_key, status, opens_at, closes_at, allow_change,
                                   results_visibility, created_by)
  values (p_fixture, left(trim(p_question), 160), p_kind, p_auto_key, coalesce(p_status, 'active'),
          coalesce(p_opens_at, now()), p_closes_at, coalesce(p_allow_change, false),
          coalesce(p_visibility, 'after_vote'), p_actor)
  on conflict (fixture_id, auto_key) do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  for i in 1..array_length(p_options, 1) loop
    insert into public.sports_poll_options (poll_id, label, player_id, sort_order)
    values (v_id, left(trim(p_options[i]), 80), case when p_player_ids is not null then p_player_ids[i] end, i);
  end loop;
  return v_id;
end;
$$;

-- Maç yaşam döngüsü: otomatik anketler ve sohbet sistem mesajları.
create or replace function public.sports_lifecycle_hook(p_fixture bigint, p_old_phase text, p_new_phase text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  f public.sports_fixtures;
  v_primary text;
  v_names text[];
  v_ids bigint[];
  v_team bigint;
begin
  select * into s from public.sports_settings where id = 1;
  select * into f from public.sports_fixtures where id = p_fixture;
  if f.id is null then
    return;
  end if;
  v_primary := case when f.primary_side = 'away' then f.away_name else f.home_name end;
  v_team := case when f.primary_side = 'away' then f.away_team_id else f.home_team_id end;

  if s.auto_polls_enabled and not f.hidden then
    if p_new_phase = 'scheduled' and f.kickoff_at > now() then
      perform public.sports_poll_create_internal(
        p_fixture, 'Maçı kim kazanır?', 'winner', array[f.home_name, 'Beraberlik', f.away_name], 'winner',
        f.kickoff_at, false, 'after_vote', null);
    elsif p_new_phase = 'half_time' then
      perform public.sports_poll_create_internal(
        p_fixture, v_primary || ' ilk yarıda nasıldı?', 'first_half',
        array['Çok iyi', 'İyi', 'Orta', 'Kötü'], 'first_half', now() + interval '25 minutes', false, 'after_vote', null);
    elsif public.sports_phase_is_finished(p_new_phase) then
      -- Maçın oyuncusu: yalnızca kaynağın kadro/oyuncu verisi varsa, sahaya çıkan oyunculardan.
      select array_agg(name order by coalesce(minutes, 0) desc, name), array_agg(player_id order by coalesce(minutes, 0) desc, name)
        into v_names, v_ids
        from (select p.name, p.player_id, p.minutes from public.sports_fixture_players p
               where p.fixture_id = p_fixture and p.team_id = v_team and coalesce(p.minutes, 0) > 0
               order by coalesce(p.minutes, 0) desc limit 12) x;
      if v_names is null then
        select array_agg(e ->> 'name'), array_agg((e ->> 'id')::bigint)
          into v_names, v_ids
          from public.sports_fixture_lineups l, jsonb_array_elements(l.start_xi) e
         where l.fixture_id = p_fixture and l.team_id = v_team and not l.is_predicted
           and coalesce(e ->> 'name', '') <> '';
      end if;
      if v_names is not null and array_length(v_names, 1) >= 2 then
        perform public.sports_poll_create_internal(
          p_fixture, 'Maçın oyuncusu kim?', 'player_of_match', v_names[1:12], 'player_of_match',
          now() + interval '24 hours', false, 'after_vote', null, v_ids[1:12]);
      end if;
    end if;
  end if;

  if p_old_phase is not null and p_old_phase is distinct from p_new_phase then
    if p_old_phase = 'scheduled' and public.sports_phase_is_live(p_new_phase) then
      perform public.sports_chat_system_message(p_fixture, 'Maç başladı. İyi seyirler!');
    elsif p_new_phase = 'half_time' then
      perform public.sports_chat_system_message(p_fixture, 'Devre arası · ' || public.sports_score_line(f));
    elsif p_new_phase = 'second_half' then
      perform public.sports_chat_system_message(p_fixture, 'İkinci yarı başladı.');
    elsif public.sports_phase_is_finished(p_new_phase) and not public.sports_phase_is_finished(p_old_phase) then
      perform public.sports_chat_system_message(p_fixture, 'Maç sona erdi · ' || public.sports_score_line(f));
    elsif p_new_phase in ('postponed', 'cancelled', 'abandoned', 'suspended', 'interrupted') then
      perform public.sports_chat_system_message(p_fixture, 'Maç durumu güncellendi: ' || coalesce(f.status_long, f.status_short));
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Taraftar medyası, haberler, nabız
-- ---------------------------------------------------------------------------
create or replace function public.sports_media_attach(p_fixture bigint, p_post uuid, p_category text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  f public.sports_fixtures;
  v_post public.posts;
  v_id uuid;
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_category not in ('prematch', 'stadium', 'video', 'watch_party', 'celebration', 'opinion') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into f from public.sports_fixtures where id = p_fixture;
  select * into v_post from public.posts where id = p_post;
  if v_post.id is null or v_post.author_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_post.visibility <> 'public' or v_post.moderation_status <> 'visible' then
    raise exception 'sports_media_not_public' using errcode = '22023';
  end if;
  if not exists (select 1 from public.post_media m where m.post_id = p_post) and p_category <> 'opinion' then
    raise exception 'sports_media_required' using errcode = '22023';
  end if;
  if now() < f.kickoff_at - interval '3 days' or now() > f.kickoff_at + interval '3 days' then
    raise exception 'sports_media_window' using errcode = '22023';
  end if;
  perform public.safety_check_rate('sports_media_attach', 20, interval '1 day');
  insert into public.sports_fixture_media (fixture_id, post_id, user_id, category)
  values (p_fixture, p_post, v_uid, p_category)
  on conflict (post_id) do update set category = excluded.category
  returning id into v_id;
  perform public.sports_broadcast(p_fixture, 'media');
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.sports_media_list(
  p_fixture bigint, p_category text default null, p_limit integer default 12, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
  v_items jsonb;
  v_count integer;
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'category', x.category, 'created_at', x.created_at,
                                               'post', public.tz_post_json(x.post_id, v_uid)) order by x.created_at desc), '[]'::jsonb),
         count(*)
    into v_items, v_count
    from (select m.id, m.category, m.created_at, m.post_id
            from public.sports_fixture_media m
            join public.posts p on p.id = m.post_id
           where m.fixture_id = p_fixture and m.status = 'visible'
             and (p_category is null or m.category = p_category)
             and p.moderation_status = 'visible' and p.visibility = 'public'
             and not public.is_blocked(v_uid, m.user_id)
             and public.can_view_post(m.post_id)
           order by m.created_at desc
           limit v_limit + 1 offset greatest(coalesce(p_offset, 0), 0)) x;
  if v_count > v_limit then
    v_items := v_items - (jsonb_array_length(v_items) - 1);
  end if;
  return jsonb_build_object('items', v_items, 'has_more', v_count > v_limit);
end;
$$;

create or replace function public.sports_news_list(p_fixture bigint, p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  f public.sports_fixtures;
  v_opponent text;
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into f from public.sports_fixtures where id = p_fixture;
  v_opponent := case when f.primary_side = 'away' then f.home_name else f.away_name end;
  return coalesce((
    select jsonb_agg(public.tz_post_json(y.post_id, v_uid) order by y.pinned desc, y.published_at desc)
      from (
        select x.post_id, x.published_at, x.pinned
          from (
            select distinct on (post_id) post_id, published_at, pinned
              from (
                select n.post_id, n.created_at as published_at, true as pinned
                  from public.sports_fixture_news n where n.fixture_id = p_fixture
                union all
                select i.post_id, i.published_at, false
                  from public.news_source_items i
                 where i.post_id is not null and i.removed_at is null
                   and i.published_at between f.kickoff_at - interval '3 days' and f.kickoff_at + interval '3 days'
                   and (i.category_slug = 'trabzonspor'
                        or (i.category_slug in ('spor', 'son-dakika')
                            and (i.title ilike '%trabzonspor%' or (v_opponent is not null and i.title ilike '%' || v_opponent || '%'))))
              ) u
             order by post_id, pinned desc
          ) x
          join public.posts p on p.id = x.post_id
         where p.moderation_status = 'visible' and public.can_view_post(x.post_id)
         order by x.pinned desc, x.published_at desc
         limit least(greatest(coalesce(p_limit, 12), 1), 30)
      ) y
  ), '[]'::jsonb);
end;
$$;

-- Maçın Nabzı: resmi veri (olaylar, istatistik snapshot'ları) ile Trabzone topluluk
-- verisi (sohbet/yorum yoğunluğu) ayrı alanlarda döner. Kova saatleri gerçek
-- duvar saatidir; ölçülmemiş zaman aralığı üretilmez.
create or replace function public.sports_fixture_pulse(p_fixture bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.sports_fixtures;
  v_from timestamptz;
  v_to timestamptz;
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into f from public.sports_fixtures where id = p_fixture;
  v_from := f.kickoff_at - interval '30 minutes';
  v_to := least(now(), coalesce(f.finished_seen_at + interval '30 minutes', f.kickoff_at + interval '3 hours'));
  if v_to <= v_from then
    return jsonb_build_object('official', null, 'community', null, 'window', null);
  end if;
  return jsonb_build_object(
    'window', jsonb_build_object('from', v_from, 'to', v_to, 'bucket_minutes', 5),
    'official', jsonb_build_object(
      'source', 'API-Football',
      'events', coalesce((select jsonb_agg(jsonb_build_object('minute', e.minute, 'extra', e.extra, 'kind', e.kind,
                                                              'team_id', e.team_id, 'player_name', e.player_name)
                                           order by coalesce(e.minute, 0), coalesce(e.extra, 0))
                            from public.sports_fixture_events e
                           where e.fixture_id = p_fixture and e.status = 'active'
                             and e.kind in ('goal', 'own_goal', 'penalty_goal', 'missed_penalty', 'red', 'second_yellow', 'var')), '[]'::jsonb),
      'snapshots', coalesce((select jsonb_agg(jsonb_build_object('at', x.captured_at, 'elapsed', x.elapsed,
                                                                 'status', x.status_short, 'home', x.home, 'away', x.away)
                                              order by x.captured_at)
                               from public.sports_fixture_stat_snapshots x where x.fixture_id = p_fixture), '[]'::jsonb)),
    'community', jsonb_build_object(
      'source', 'Trabzone',
      'buckets', coalesce((
        select jsonb_agg(jsonb_build_object('at', b.at, 'chat', b.chat, 'comments', b.comments) order by b.at)
          from (
            select g.at,
                   (select count(*) from public.sports_chat_messages m
                     where m.fixture_id = p_fixture and m.kind = 'user' and m.status = 'visible'
                       and m.created_at >= g.at and m.created_at < g.at + interval '5 minutes') as chat,
                   (select count(*) from public.sports_fixture_comments c
                     where c.fixture_uid = f.uid and c.moderation_status = 'visible'
                       and c.created_at >= g.at and c.created_at < g.at + interval '5 minutes') as comments
              from generate_series(date_trunc('minute', v_from), v_to - interval '1 minute', interval '5 minutes') as g(at)
          ) b), '[]'::jsonb))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Fonksiyon yetkileri
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'sports\_%' or p.proname = 'comment_thread_share')
       and p.proname not in ('sports_feed_card', 'sports_fixture_detail', 'sports_fixture_stats', 'sports_fixture_timeline',
                             'sports_fixture_lineups', 'sports_standings', 'sports_fixtures_list', 'sports_center')
       and p.proname not like 'sports\_ingest\_%'
       and p.proname <> 'sports_fixture_sync_failed'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if fn.proname in ('sports_chat_state', 'sports_chat_list', 'sports_chat_send', 'sports_chat_delete',
                      'sports_chat_toggle_like', 'sports_chat_report', 'sports_chat_heartbeat',
                      'sports_chat_mod_remove', 'sports_chat_mod_sanction', 'sports_polls_list', 'sports_poll_vote',
                      'sports_media_attach', 'sports_media_list', 'sports_news_list', 'sports_fixture_pulse',
                      'comment_thread_share') then
      execute format('grant execute on function %s to authenticated', fn.sig);
    end if;
  end loop;
end $$;

grant execute on function public.comment_list(text, uuid, integer, integer) to authenticated;
grant execute on function public.comment_replies(text, uuid, integer, integer) to authenticated;
grant execute on function public.comment_add(text, uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.comment_update(text, uuid, text) to authenticated;
grant execute on function public.comment_delete(text, uuid) to authenticated;
grant execute on function public.comment_toggle_like(text, uuid) to authenticated;
