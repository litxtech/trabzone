-- Kullanıcının kendi bildirimlerini silebilmesi.
--
-- Silme yumuşaktır (deleted_at): emlak alarmı, araç belgesi hatırlatması ve
-- haber bildirimleri "aynı bildirim daha önce gönderildi mi" kontrolünü bu
-- tablodaki satırlara bakarak yapar. Satır gerçekten silinirse aynı bildirim
-- yeniden üretilir. Silinen bildirim aynı anda okunmuş sayılır; böylece
-- okunmamış sayısını hesaplayan diğer fonksiyonlar değişmeden doğru kalır.

alter table public.notifications
  add column if not exists deleted_at timestamptz;

create index if not exists notifications_visible_idx
  on public.notifications (user_id, created_at desc)
  where deleted_at is null;

create or replace function public.notifications_list(p_limit integer default 30, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', n.id,
            'kind', n.kind,
            'title', n.title,
            'body', n.body,
            'entity_type', n.entity_type,
            'entity_id', n.entity_id,
            'route', n.route,
            'read_at', n.read_at,
            'created_at', n.created_at,
            'actor_id', n.actor_id,
            'actor_username', a.username,
            'actor_first_name', a.first_name,
            'actor_last_name', a.last_name,
            'actor_avatar_path', a.avatar_path
          )
          order by n.created_at desc
        )
        from (
          select * from public.notifications
          where user_id = v_uid
            and deleted_at is null
            and (actor_id is null or not public.is_blocked(v_uid, actor_id))
          order by created_at desc
          limit v_limit offset v_offset
        ) n
          left join public.profiles a on a.id = n.actor_id
      ),
      '[]'::jsonb
    ),
    'unread', (
      select count(*) from public.notifications
      where user_id = v_uid
        and read_at is null
        and deleted_at is null
        and (actor_id is null or not public.is_blocked(v_uid, actor_id))
    )
  );
end;
$$;

revoke all on function public.notifications_list(integer, integer) from public, anon;
grant execute on function public.notifications_list(integer, integer) to authenticated;

-- p_ids null ise kullanıcının tüm bildirimleri silinir.
create or replace function public.notifications_delete(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_count integer;
begin
  update public.notifications n
     set deleted_at = now(),
         read_at = coalesce(n.read_at, now())
   where n.user_id = v_uid
     and n.deleted_at is null
     and (p_ids is null or n.id = any (p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notifications_delete(uuid[]) from public, anon;
grant execute on function public.notifications_delete(uuid[]) to authenticated;
