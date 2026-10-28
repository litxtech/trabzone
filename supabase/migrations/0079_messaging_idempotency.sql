-- ---------------------------------------------------------------------------
-- 0078 — Messaging idempotency
--
-- A client-generated UUID makes retries safe: a flaky network can resend the
-- same message without creating a duplicate. The unique index is scoped to the
-- sender so two users can never collide, and NULL keeps legacy rows untouched.
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists client_id uuid;

create unique index if not exists messages_sender_client_uidx
  on public.messages (sender_id, client_id)
  where client_id is not null;

-- Keep the previous 7-argument signature working for older builds.
drop function if exists public.chat_send_message(uuid, text, text, text, jsonb, uuid);

create or replace function public.chat_send_message(
  p_conversation_id uuid,
  p_kind            text default 'text',
  p_body            text default null,
  p_media_path      text default null,
  p_media_meta      jsonb default '{}'::jsonb,
  p_reply_to        uuid default null,
  p_media           jsonb default '[]'::jsonb,
  p_client_id       uuid default null
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
  v_existing uuid;
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

  -- Idempotent retry: return the message that was already stored.
  if p_client_id is not null then
    select m.id into v_existing
    from public.messages m
    where m.sender_id = v_uid
      and m.client_id = p_client_id
      and m.conversation_id = p_conversation_id
    limit 1;

    if v_existing is not null then
      return public.tz_message_json(v_existing, v_uid);
    end if;
  end if;

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
    conversation_id, sender_id, kind, body, media_path, media_meta, reply_to_id, client_id
  )
  values (
    p_conversation_id, v_uid, v_kind, v_body,
    case when v_kind = 'text' then null else v_first end,
    case when v_kind = 'text' then '{}'::jsonb else v_meta end,
    p_reply_to, p_client_id
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
    when 'image' then 'Fotoğraf'
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

revoke all on function public.chat_send_message(uuid, text, text, text, jsonb, uuid, jsonb, uuid)
  from public, anon;
grant execute on function public.chat_send_message(uuid, text, text, text, jsonb, uuid, jsonb, uuid)
  to authenticated;

-- Add client_id to the serialised message so the client can reconcile
-- optimistic rows with realtime inserts.
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
    'client_id', m.client_id,
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
