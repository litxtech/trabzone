-- 0013: Real-time messaging (direct + group), receipts, calls signalling
--
-- Message writes are RPC-only; the client reads through RLS-protected tables so
-- Supabase Realtime can stream inserts with the same authorization rules.

set search_path = public, extensions;

create table if not exists public.conversations (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null default 'direct',
  title                  text,
  avatar_path            text,
  created_by             uuid references public.profiles (id) on delete set null,
  direct_key             text,
  last_message_at        timestamptz,
  last_message_preview   text,
  last_message_sender_id uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint conversations_kind_check check (kind in ('direct', 'group')),
  constraint conversations_title_length check (title is null or char_length(title) between 1 and 80),
  constraint conversations_direct_key_check check (kind <> 'direct' or direct_key is not null)
);

create unique index if not exists conversations_direct_key_idx
  on public.conversations (direct_key)
  where kind = 'direct';

create index if not exists conversations_last_message_idx
  on public.conversations (last_message_at desc nulls last);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            text not null default 'member',
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  is_muted        boolean not null default false,
  left_at         timestamptz,
  primary key (conversation_id, user_id),
  constraint conversation_members_role_check check (role in ('owner', 'admin', 'member'))
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  kind            text not null default 'text',
  body            text,
  media_path      text,
  media_meta      jsonb not null default '{}'::jsonb,
  reply_to_id     uuid references public.messages (id) on delete set null,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint messages_kind_check check (
    kind in ('text', 'image', 'video', 'audio', 'file', 'system')
  ),
  constraint messages_body_length check (body is null or char_length(body) between 1 and 4000),
  constraint messages_content_check check (
    kind = 'system' or body is not null or media_path is not null or deleted_at is not null
  )
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc);

create table if not exists public.message_receipts (
  message_id   uuid not null references public.messages (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  delivered_at timestamptz,
  read_at      timestamptz,
  primary key (message_id, user_id)
);

create index if not exists message_receipts_user_idx on public.message_receipts (user_id);

create table if not exists public.call_sessions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  caller_id       uuid not null references public.profiles (id) on delete cascade,
  callee_id       uuid not null references public.profiles (id) on delete cascade,
  kind            text not null default 'audio',
  status          text not null default 'ringing',
  room_name       text not null,
  started_at      timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  constraint call_sessions_kind_check check (kind in ('audio', 'video')),
  constraint call_sessions_status_check check (
    status in ('ringing', 'accepted', 'declined', 'missed', 'ended', 'failed')
  ),
  constraint call_sessions_no_self check (caller_id <> callee_id)
);

create index if not exists call_sessions_callee_idx
  on public.call_sessions (callee_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------
create or replace function public.tz_is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = auth.uid()
      and m.left_at is null
  );
$$;

revoke all on function public.tz_is_conversation_member(uuid) from public, anon;
grant execute on function public.tz_is_conversation_member(uuid) to authenticated, service_role;

create or replace function public.tz_safe_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_value::uuid;
exception
  when others then return null;
end;
$$;

revoke all on function public.tz_safe_uuid(text) from public, anon;
grant execute on function public.tz_safe_uuid(text) to authenticated, service_role;

create or replace function public.tz_direct_peer(p_conversation_id uuid, p_me uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
  from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id <> p_me
    and m.left_at is null
  limit 1;
$$;

revoke all on function public.tz_direct_peer(uuid, uuid) from public, anon, authenticated;

create or replace function public.tz_conversation_guard(p_conversation_id uuid, p_uid uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id and m.user_id = p_uid and m.left_at is null
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.tz_conversation_guard(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_receipts enable row level security;
alter table public.call_sessions enable row level security;

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using (public.tz_is_conversation_member(id));

drop policy if exists conversation_members_select on public.conversation_members;
create policy conversation_members_select on public.conversation_members
  for select to authenticated
  using (public.tz_is_conversation_member(conversation_id));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (public.tz_is_conversation_member(conversation_id));

drop policy if exists message_receipts_select on public.message_receipts;
create policy message_receipts_select on public.message_receipts
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists call_sessions_select on public.call_sessions;
create policy call_sessions_select on public.call_sessions
  for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());

revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;

revoke all on public.conversation_members from anon, authenticated;
grant select on public.conversation_members to authenticated;

revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;

revoke all on public.message_receipts from anon, authenticated;
grant select on public.message_receipts to authenticated;

revoke all on public.call_sessions from anon, authenticated;
grant select on public.call_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: chat media is private and scoped to conversation members.
-- Path convention: {conversation_id}/{user_id}-{random}.{ext}
-- ---------------------------------------------------------------------------
drop policy if exists message_media_insert on storage.objects;
create policy message_media_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-media'
    and public.tz_is_conversation_member(
      public.tz_safe_uuid((storage.foldername(name))[1])
    )
    and split_part((storage.foldername(name))[2], '-', 1) = auth.uid()::text
  );

drop policy if exists message_media_select on storage.objects;
create policy message_media_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-media'
    and public.tz_is_conversation_member(
      public.tz_safe_uuid((storage.foldername(name))[1])
    )
  );

drop policy if exists message_media_delete on storage.objects;
create policy message_media_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'message-media'
    and split_part((storage.foldername(name))[2], '-', 1) = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Serialisation
-- ---------------------------------------------------------------------------
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
    'body', m.body,
    'media_path', m.media_path,
    'media_meta', m.media_meta,
    'reply_to_id', m.reply_to_id,
    'reply_preview', case when r.id is null then null else jsonb_build_object(
      'body', r.body,
      'kind', r.kind,
      'sender_username', rp.username
    ) end,
    'edited_at', m.edited_at,
    'deleted_at', m.deleted_at,
    'created_at', m.created_at,
    'is_mine', m.sender_id = p_me
  )
  from public.messages m
    join public.profiles p on p.id = m.sender_id
    left join public.messages r on r.id = m.reply_to_id
    left join public.profiles rp on rp.id = r.sender_id
  where m.id = p_message_id;
$$;

revoke all on function public.tz_message_json(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create or replace function public.chat_start_direct(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_key    text;
  v_id     uuid;
  v_exists boolean := true;
begin
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.account_status = 'active'
  ) then
    raise exception 'user_not_found' using errcode = '22023';
  end if;

  if public.is_blocked(v_uid, p_user_id) then
    raise exception 'blocked' using errcode = '42501';
  end if;

  if not public.safety_can_message(v_uid, p_user_id) then
    raise exception 'messaging_not_allowed' using errcode = '42501';
  end if;

  v_key := least(v_uid::text, p_user_id::text) || ':' || greatest(v_uid::text, p_user_id::text);

  select c.id into v_id from public.conversations c where c.direct_key = v_key;

  if v_id is null then
    insert into public.conversations (kind, created_by, direct_key)
    values ('direct', v_uid, v_key)
    returning id into v_id;

    insert into public.conversation_members (conversation_id, user_id, role)
    values (v_id, v_uid, 'member'), (v_id, p_user_id, 'member')
    on conflict do nothing;

    v_exists := false;
  end if;

  return jsonb_build_object('id', v_id, 'existing', v_exists);
end;
$$;

revoke all on function public.chat_start_direct(uuid) from public, anon;
grant execute on function public.chat_start_direct(uuid) to authenticated;

create or replace function public.chat_list()
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
        select jsonb_agg(item order by sort_at desc nulls last)
        from (
          select
            jsonb_build_object(
              'id', c.id,
              'kind', c.kind,
              'title', case
                when c.kind = 'group' then c.title
                else coalesce(
                  nullif(trim(concat_ws(' ', peer.first_name, peer.last_name)), ''),
                  peer.username,
                  'Trabzone üyesi'
                )
              end,
              'avatar_path', case
                when c.kind = 'group' then c.avatar_path
                else peer.avatar_path
              end,
              'peer_id', peer.id,
              'peer_username', peer.username,
              'peer_verified', coalesce(peer.is_verified, false),
              'last_message_at', c.last_message_at,
              'last_message_preview', c.last_message_preview,
              'last_message_sender_id', c.last_message_sender_id,
              'is_muted', coalesce(mine.is_muted, false),
              'unread_count', (
                select count(*)
                from public.messages msg
                where msg.conversation_id = c.id
                  and msg.sender_id <> v_uid
                  and msg.deleted_at is null
                  and msg.created_at > coalesce(mine.last_read_at, mine.joined_at)
              )
            ) as item,
            coalesce(c.last_message_at, c.created_at) as sort_at
          from public.conversations c
            join public.conversation_members mine
              on mine.conversation_id = c.id
             and mine.user_id = v_uid
             and mine.left_at is null
            left join lateral (
              select p.id, p.username, p.first_name, p.last_name, p.avatar_path, p.is_verified
              from public.conversation_members om
                join public.profiles p on p.id = om.user_id
              where om.conversation_id = c.id
                and om.user_id <> v_uid
                and om.left_at is null
              limit 1
            ) peer on true
          where c.kind = 'group'
             or (
               peer.id is not null
               and not public.is_blocked(v_uid, peer.id)
             )
        ) rows
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.chat_list() from public, anon;
grant execute on function public.chat_list() to authenticated;

create or replace function public.chat_members(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  perform public.tz_conversation_guard(p_conversation_id, v_uid);

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
            'is_verified', p.is_verified,
            'role', m.role,
            'joined_at', m.joined_at
          )
          order by m.role desc, m.joined_at asc
        )
        from public.conversation_members m
          join public.profiles p on p.id = m.user_id
        where m.conversation_id = p_conversation_id
          and m.left_at is null
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.chat_members(uuid) from public, anon;
grant execute on function public.chat_members(uuid) to authenticated;

create or replace function public.chat_messages(
  p_conversation_id uuid,
  p_before          timestamptz default null,
  p_limit           integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 60);
begin
  perform public.tz_conversation_guard(p_conversation_id, v_uid);

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_message_json(x.id, v_uid) order by x.created_at asc)
        from (
          select m.id, m.created_at
          from public.messages m
          where m.conversation_id = p_conversation_id
            and (p_before is null or m.created_at < p_before)
          order by m.created_at desc
          limit v_limit
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.chat_messages(uuid, timestamptz, integer) from public, anon;
grant execute on function public.chat_messages(uuid, timestamptz, integer) to authenticated;

create or replace function public.chat_send_message(
  p_conversation_id uuid,
  p_kind            text default 'text',
  p_body            text default null,
  p_media_path      text default null,
  p_media_meta      jsonb default '{}'::jsonb,
  p_reply_to        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_kind     text := coalesce(nullif(trim(p_kind), ''), 'text');
  v_body     text := nullif(trim(coalesce(p_body, '')), '');
  v_meta     jsonb := coalesce(p_media_meta, '{}'::jsonb);
  v_id       uuid;
  v_conv     public.conversations%rowtype;
  v_peer     uuid;
  v_preview  text;
  v_member   record;
  v_sender   text;
begin
  perform public.tz_conversation_guard(p_conversation_id, v_uid);

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
    if p_media_path is null
       or split_part(p_media_path, '/', 1) <> p_conversation_id::text then
      raise exception 'invalid_media_path' using errcode = '22023';
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
  values (p_conversation_id, v_uid, v_kind, v_body, p_media_path, v_meta, p_reply_to)
  returning id into v_id;

  v_preview := case v_kind
    when 'text' then left(coalesce(v_body, ''), 140)
    when 'image' then '📷 Fotoğraf'
    when 'video' then '🎬 Video'
    when 'audio' then '🎙️ Sesli mesaj'
    else '📎 Dosya'
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

revoke all on function public.chat_send_message(uuid, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.chat_send_message(uuid, text, text, text, jsonb, uuid) to authenticated;

create or replace function public.chat_mark_read(p_conversation_id uuid)
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

  update public.conversation_members m
     set last_read_at = now()
   where m.conversation_id = p_conversation_id and m.user_id = v_uid;

  insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
  select msg.id, v_uid, now(), now()
  from public.messages msg
  where msg.conversation_id = p_conversation_id
    and msg.sender_id <> v_uid
    and msg.created_at > now() - interval '30 days'
  on conflict (message_id, user_id)
  do update set read_at = coalesce(public.message_receipts.read_at, now()),
                delivered_at = coalesce(public.message_receipts.delivered_at, now());

  get diagnostics v_count = row_count;

  update public.notifications n
     set read_at = now()
   where n.user_id = v_uid
     and n.kind = 'message'
     and n.entity_type = 'conversation'
     and n.entity_id = p_conversation_id::text
     and n.read_at is null;

  return v_count;
end;
$$;

revoke all on function public.chat_mark_read(uuid) from public, anon;
grant execute on function public.chat_mark_read(uuid) to authenticated;

create or replace function public.chat_edit_message(p_message_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.tz_require_uid();
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_kind text;
begin
  if v_body is null or char_length(v_body) > 4000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;

  select m.kind into v_kind
  from public.messages m
  where m.id = p_message_id and m.sender_id = v_uid and m.deleted_at is null;

  if v_kind is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_kind <> 'text' then
    raise exception 'unsupported_kind' using errcode = '22023';
  end if;

  update public.messages
     set body = v_body, edited_at = now()
   where id = p_message_id;
end;
$$;

revoke all on function public.chat_edit_message(uuid, text) from public, anon;
grant execute on function public.chat_edit_message(uuid, text) to authenticated;

create or replace function public.chat_delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  update public.messages m
     set body = null,
         media_path = null,
         media_meta = '{}'::jsonb,
         deleted_at = now()
   where m.id = p_message_id
     and m.sender_id = v_uid
     and m.deleted_at is null
     and m.created_at > now() - interval '48 hours';

  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.chat_delete_message(uuid) from public, anon;
grant execute on function public.chat_delete_message(uuid) to authenticated;

create or replace function public.chat_set_mute(p_conversation_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  perform public.tz_conversation_guard(p_conversation_id, v_uid);

  update public.conversation_members m
     set is_muted = coalesce(p_muted, false)
   where m.conversation_id = p_conversation_id and m.user_id = v_uid;
end;
$$;

revoke all on function public.chat_set_mute(uuid, boolean) from public, anon;
grant execute on function public.chat_set_mute(uuid, boolean) to authenticated;

create or replace function public.chat_leave(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_conv public.conversations%rowtype;
begin
  perform public.tz_conversation_guard(p_conversation_id, v_uid);

  select * into v_conv from public.conversations where id = p_conversation_id;

  if v_conv.kind = 'group' then
    update public.conversation_members m
       set left_at = now()
     where m.conversation_id = p_conversation_id and m.user_id = v_uid;
  else
    update public.conversation_members m
       set left_at = now()
     where m.conversation_id = p_conversation_id and m.user_id = v_uid;
  end if;
end;
$$;

revoke all on function public.chat_leave(uuid) from public, anon;
grant execute on function public.chat_leave(uuid) to authenticated;

create or replace function public.chat_create_group(
  p_title      text,
  p_member_ids uuid[],
  p_avatar_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_title  text := nullif(trim(coalesce(p_title, '')), '');
  v_members uuid[];
  v_target uuid;
  v_id     uuid;
  v_name   text;
begin
  if v_title is null or char_length(v_title) > 80 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  if p_avatar_path is not null and split_part(p_avatar_path, '/', 1) <> v_uid::text then
    raise exception 'invalid_media_path' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct uid), '{}')
    into v_members
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as uid
  where uid is not null and uid <> v_uid;

  if array_length(v_members, 1) is null or array_length(v_members, 1) > 50 then
    raise exception 'invalid_members' using errcode = '22023';
  end if;

  foreach v_target in array v_members
  loop
    if not exists (
      select 1 from public.profiles p
      where p.id = v_target and p.account_status = 'active'
    ) then
      raise exception 'member_not_found' using errcode = '22023';
    end if;

    if public.is_blocked(v_uid, v_target) then
      raise exception 'blocked' using errcode = '42501';
    end if;

    if not public.safety_can_message(v_uid, v_target) then
      raise exception 'member_not_allowed' using errcode = '42501';
    end if;
  end loop;

  insert into public.conversations (kind, title, avatar_path, created_by)
  values ('group', v_title, p_avatar_path, v_uid)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_id, v_uid, 'owner')
  on conflict do nothing;

  insert into public.conversation_members (conversation_id, user_id, role)
  select v_id, uid, 'member' from unnest(v_members) as uid
  on conflict do nothing;

  select trim(concat_ws(' ', p.first_name, p.last_name)) into v_name
  from public.profiles p where p.id = v_uid;

  foreach v_target in array v_members
  loop
    perform public.tz_notify(
      v_target, v_uid, 'group_invite',
      coalesce(v_name, 'Bir kullanıcı') || ' seni bir gruba ekledi',
      v_title, 'conversation', v_id::text, '/chat/' || v_id::text
    );
  end loop;

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.chat_create_group(text, uuid[], text) from public, anon;
grant execute on function public.chat_create_group(text, uuid[], text) to authenticated;

create or replace function public.chat_add_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.tz_require_uid();
  v_role text;
  v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found or v_conv.kind <> 'group' then
    raise exception 'not_a_group' using errcode = '22023';
  end if;

  select m.role into v_role
  from public.conversation_members m
  where m.conversation_id = p_conversation_id and m.user_id = v_uid and m.left_at is null;

  if v_role not in ('owner', 'admin') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if public.is_blocked(v_uid, p_user_id) or public.is_blocked(p_user_id, v_uid) then
    raise exception 'blocked' using errcode = '42501';
  end if;

  if not public.safety_can_message(p_user_id, v_uid) then
    raise exception 'member_not_allowed' using errcode = '42501';
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (p_conversation_id, p_user_id, 'member')
  on conflict (conversation_id, user_id)
  do update set left_at = null, joined_at = now();

  perform public.tz_notify(
    p_user_id, v_uid, 'group_invite', 'Gruba eklendin', v_conv.title,
    'conversation', p_conversation_id::text, '/chat/' || p_conversation_id::text
  );
end;
$$;

revoke all on function public.chat_add_member(uuid, uuid) from public, anon;
grant execute on function public.chat_add_member(uuid, uuid) to authenticated;

create or replace function public.chat_remove_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.tz_require_uid();
  v_role text;
  v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found or v_conv.kind <> 'group' then
    raise exception 'not_a_group' using errcode = '22023';
  end if;

  select m.role into v_role
  from public.conversation_members m
  where m.conversation_id = p_conversation_id and m.user_id = v_uid and m.left_at is null;

  if p_user_id = v_uid then
    update public.conversation_members m
       set left_at = now()
     where m.conversation_id = p_conversation_id and m.user_id = v_uid;
    return;
  end if;

  if v_role <> 'owner' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.conversation_members m
     set left_at = now()
   where m.conversation_id = p_conversation_id and m.user_id = p_user_id;
end;
$$;

revoke all on function public.chat_remove_member(uuid, uuid) from public, anon;
grant execute on function public.chat_remove_member(uuid, uuid) to authenticated;

create or replace function public.chat_update_group(
  p_conversation_id uuid,
  p_title           text default null,
  p_avatar_path     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.tz_require_uid();
  v_role text;
begin
  select m.role into v_role
  from public.conversation_members m
  where m.conversation_id = p_conversation_id and m.user_id = v_uid and m.left_at is null;

  if v_role not in ('owner', 'admin') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.conversations c
     set title = coalesce(nullif(trim(coalesce(p_title, '')), ''), c.title),
         avatar_path = coalesce(p_avatar_path, c.avatar_path),
         updated_at = now()
   where c.id = p_conversation_id and c.kind = 'group';
end;
$$;

revoke all on function public.chat_update_group(uuid, text, text) from public, anon;
grant execute on function public.chat_update_group(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Call signalling (media transport is handled by the LiveKit client)
-- ---------------------------------------------------------------------------
create or replace function public.call_start(p_conversation_id uuid, p_kind text default 'audio')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_kind   text := coalesce(nullif(trim(p_kind), ''), 'audio');
  v_conv   public.conversations%rowtype;
  v_peer   uuid;
  v_room   text;
  v_id     uuid;
  v_name   text;
begin
  if v_kind not in ('audio', 'video') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  perform public.tz_conversation_guard(p_conversation_id, v_uid);

  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.kind <> 'direct' then
    raise exception 'group_calls_unsupported' using errcode = '22023';
  end if;

  v_peer := public.tz_direct_peer(p_conversation_id, v_uid);
  if v_peer is null then
    raise exception 'callee_missing' using errcode = '22023';
  end if;

  if public.is_blocked(v_uid, v_peer) or not public.safety_can_call(v_uid, v_peer) then
    raise exception 'calling_not_allowed' using errcode = '42501';
  end if;

  perform public.safety_check_rate('call_start', 20, interval '1 hour');

  -- Ayni arama tekrar tetiklenirse eski halkayi kapat.
  update public.call_sessions c
     set status = 'missed', ended_at = now()
   where c.caller_id = v_uid and c.callee_id = v_peer and c.status = 'ringing';

  v_room := 'tz_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.call_sessions (conversation_id, caller_id, callee_id, kind, room_name)
  values (p_conversation_id, v_uid, v_peer, v_kind, v_room)
  returning id into v_id;

  select trim(concat_ws(' ', p.first_name, p.last_name)) into v_name
  from public.profiles p where p.id = v_uid;

  perform public.tz_notify(
    v_peer, v_uid, 'message',
    coalesce(v_name, 'Bir kullanıcı') || ' seni arıyor',
    case when v_kind = 'video' then 'Görüntülü arama' else 'Sesli arama' end,
    'call', v_id::text, '/call/' || v_id::text
  );

  return jsonb_build_object('id', v_id, 'room_name', v_room, 'status', 'ringing');
end;
$$;

revoke all on function public.call_start(uuid, text) from public, anon;
grant execute on function public.call_start(uuid, text) to authenticated;

create or replace function public.call_get(p_call_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.call_sessions%rowtype;
  v_peer public.profiles%rowtype;
begin
  select * into v_row from public.call_sessions where id = p_call_id;
  if not found or (v_row.caller_id <> v_uid and v_row.callee_id <> v_uid) then
    raise exception 'call_not_found' using errcode = '22023';
  end if;

  select * into v_peer from public.profiles
  where id = case when v_row.caller_id = v_uid then v_row.callee_id else v_row.caller_id end;

  return jsonb_build_object(
    'id', v_row.id,
    'conversation_id', v_row.conversation_id,
    'caller_id', v_row.caller_id,
    'callee_id', v_row.callee_id,
    'kind', v_row.kind,
    'status', v_row.status,
    'room_name', v_row.room_name,
    'started_at', v_row.started_at,
    'ended_at', v_row.ended_at,
    'created_at', v_row.created_at,
    'is_caller', v_row.caller_id = v_uid,
    'peer_id', v_peer.id,
    'peer_username', v_peer.username,
    'peer_first_name', v_peer.first_name,
    'peer_last_name', v_peer.last_name,
    'peer_avatar_path', v_peer.avatar_path
  );
end;
$$;

revoke all on function public.call_get(uuid) from public, anon;
grant execute on function public.call_get(uuid) to authenticated;

create or replace function public.call_respond(p_call_id uuid, p_accept boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.call_sessions%rowtype;
begin
  select * into v_row from public.call_sessions where id = p_call_id;

  if not found or v_row.callee_id <> v_uid then
    raise exception 'call_not_found' using errcode = '22023';
  end if;

  if v_row.status <> 'ringing' then
    raise exception 'call_already_answered' using errcode = '22023';
  end if;

  update public.call_sessions
     set status = case when coalesce(p_accept, true) then 'accepted' else 'declined' end,
         started_at = case when coalesce(p_accept, true) then now() else null end,
         ended_at = case when coalesce(p_accept, true) then null else now() end
   where id = p_call_id
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;

revoke all on function public.call_respond(uuid, boolean) from public, anon;
grant execute on function public.call_respond(uuid, boolean) to authenticated;

create or replace function public.call_end(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  update public.call_sessions c
     set status = 'ended', ended_at = now()
   where c.id = p_call_id
     and (c.caller_id = v_uid or c.callee_id = v_uid)
     and c.status in ('ringing', 'accepted');
end;
$$;

revoke all on function public.call_end(uuid) from public, anon;
grant execute on function public.call_end(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach v_table in array array['messages', 'conversations', 'notifications', 'call_sessions']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;
