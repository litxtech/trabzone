-- 0087: Grup sohbetlerinde de engel sınırı.
--
-- Grup sohbeti ortak bir alan olsa da engellenen kişi engelleyenin mesajlarını
-- okuyamaz, üye listesinde görünemez ve gruba yazamaz. Böylece engel, grup
-- üzerinden delinemez.

set search_path = public;

-- Grup mesajlarında engelli gönderenler gizlenir.
do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'chat_messages';

  if position('is_blocked' in d) > 0 then
    raise notice 'chat_messages already patched';
  else
    d := replace(
      d,
      'where m.conversation_id = p_conversation_id
            and (p_before is null or m.created_at < p_before)',
      'where m.conversation_id = p_conversation_id
            and (p_before is null or m.created_at < p_before)
            and not public.is_blocked(v_uid, m.sender_id)'
    );
    if position('is_blocked' in d) = 0 then
      raise exception 'chat_messages patch failed';
    end if;
    execute d;
  end if;
end;
$$;

-- Üye listesinde engelli kişiler görünmez.
do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'chat_members';

  if position('is_blocked' in d) > 0 then
    raise notice 'chat_members already patched';
  else
    d := replace(
      d,
      'where m.conversation_id = p_conversation_id
          and m.left_at is null',
      'where m.conversation_id = p_conversation_id
          and m.left_at is null
          and not public.is_blocked(v_uid, m.user_id)'
    );
    if position('is_blocked' in d) = 0 then
      raise exception 'chat_members patch failed';
    end if;
    execute d;
  end if;
end;
$$;

-- Ortak grupta engelli kişiye yazma izni verilmez.
create or replace function public.chat_send_message(
  p_conversation_id uuid,
  p_kind text default 'text',
  p_body text default null,
  p_media_path text default null,
  p_media_meta jsonb default '{}'::jsonb,
  p_reply_to uuid default null,
  p_media jsonb default '[]'::jsonb,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    if v_peer is null or public.is_blocked(v_uid, v_peer) or not public.safety_can_message(v_uid, v_peer) then
      raise exception 'messaging_not_allowed' using errcode = '42501';
    end if;
  else
    -- Grup: engelli bir üyeyle aynı odada yazışma engellenir.
    if exists (
      select 1
      from public.conversation_members m
      where m.conversation_id = p_conversation_id
        and m.left_at is null
        and m.user_id <> v_uid
        and public.is_blocked(v_uid, m.user_id)
    ) then
      raise exception 'blocked' using errcode = '42501';
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
        message_id, media_type, storage_path, thumbnail_path, width, height, duration_ms, sort_order
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
      v_member.user_id, v_uid, 'message',
      coalesce(v_sender, 'Yeni mesaj'), v_preview,
      'conversation', p_conversation_id::text, '/chat/' || p_conversation_id::text
    );
  end loop;

  return public.tz_message_json(v_id, v_uid);
end;
$function$;
