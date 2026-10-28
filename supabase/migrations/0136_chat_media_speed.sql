-- ---------------------------------------------------------------------------
-- 0136 — Sohbet medyası gönderim hızı
--
-- 1) `chat_mark_delivered` ve `chat_mark_read` her çağrıda son 30 günün BÜTÜN
--    makbuz satırlarını yeniden yazıyordu. Her UPDATE yeni bir WAL kaydı ve
--    realtime olayı ürettiği için, sohbet ekranı her yeni mesajda onlarca
--    makbuz olayı alıp her biri için ayrı mesaj okuması yapıyordu (N mesaj →
--    N RPC). Bu, özellikle medya gönderiminden sonra mesajın görünmesini
--    saniyelerce geciktiriyordu. Artık yalnızca eksik damgalar yazılır;
--    değişmeyen satıra dokunulmaz.
--
-- 2) Sohbet eki sınırı istemcide 10, sunucuda 8'di: 9-10 fotoğraf seçen
--    kullanıcı bütün dosyaları yükledikten sonra `invalid_media` alıyordu.
--    Sınır 10'a çıkarıldı.
-- ---------------------------------------------------------------------------

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Eşzamanlı ek sınırı 10'a çıkar: mevcut kısıt 0..7 aralığını kabul ediyordu.
-- ---------------------------------------------------------------------------
alter table public.message_media drop constraint if exists message_media_sort_check;
alter table public.message_media
  add constraint message_media_sort_check check (sort_order >= 0 and sort_order <= 9);

-- ---------------------------------------------------------------------------
-- Teslim damgası: yalnızca henüz damgalanmamış satırlar güncellenir.
-- ---------------------------------------------------------------------------
create or replace function public.chat_mark_delivered(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    set delivered_at = coalesce(public.message_receipts.delivered_at, now())
  where public.message_receipts.delivered_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.chat_mark_delivered(uuid) from public, anon;
grant execute on function public.chat_mark_delivered(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Okundu damgası: eksik alanı olmayan satır hiç yazılmaz.
-- ---------------------------------------------------------------------------
create or replace function public.chat_mark_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
                delivered_at = coalesce(public.message_receipts.delivered_at, now())
  where public.message_receipts.read_at is null
     or public.message_receipts.delivered_at is null;

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
$function$;

revoke all on function public.chat_mark_read(uuid) from public, anon;
grant execute on function public.chat_mark_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Mesaj gönderimi: eşzamanlı istemci sınırıyla (10) hizalanır.
-- ---------------------------------------------------------------------------
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

  if jsonb_typeof(v_media) <> 'array' or jsonb_array_length(v_media) > 10 then
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

revoke all on function public.chat_send_message(uuid, text, text, text, jsonb, uuid, jsonb, uuid)
  from public, anon;
grant execute on function public.chat_send_message(uuid, text, text, text, jsonb, uuid, jsonb, uuid)
  to authenticated;
