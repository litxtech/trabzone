-- ---------------------------------------------------------------------------
-- 0080 — Sohbet sabitleme
--
-- Sabitleme kullanıcıya özeldir; `conversations` satırı değişmez. Böylece bir
-- katılımcının sabitlemesi diğer üyelerin listesini etkilemez.
-- ---------------------------------------------------------------------------

alter table public.conversation_members
  add column if not exists pinned_at timestamptz;

create index if not exists conversation_members_pinned_idx
  on public.conversation_members (user_id, pinned_at desc)
  where pinned_at is not null and left_at is null;

create or replace function public.chat_set_pin(
  p_conversation_id uuid,
  p_pinned boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  update public.conversation_members
     set pinned_at = case when p_pinned then now() else null end
   where conversation_id = p_conversation_id
     and user_id = v_uid
     and left_at is null;

  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return coalesce(p_pinned, false);
end;
$$;

revoke all on function public.chat_set_pin(uuid, boolean) from public, anon;
grant execute on function public.chat_set_pin(uuid, boolean) to authenticated;

create or replace function public.chat_list()
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(item order by pinned_at desc nulls last, sort_at desc nulls last)
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
                  'Trabzone Üyesi'
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
              'is_pinned', mine.pinned_at is not null,
              'unread_count', (
                select count(*)
                from public.messages msg
                where msg.conversation_id = c.id
                  and msg.sender_id <> v_uid
                  and msg.deleted_at is null
                  and msg.created_at > coalesce(mine.last_read_at, mine.joined_at)
              )
            ) as item,
            mine.pinned_at,
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
