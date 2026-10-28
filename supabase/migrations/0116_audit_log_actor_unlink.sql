-- ---------------------------------------------------------------------------
-- 0101 — Yönetici hesabı silinirken audit log engelinin düzeltilmesi
--
-- admin_audit_logs tablosunda hem `actor_admin_id` hem de eski `admin_id`
-- kolonu auth.users(id) referansı taşır (ON DELETE SET NULL). Immutability
-- trigger'ı yalnızca `actor_admin_id` için NULL'a çekmeye izin verdiğinden
-- herhangi bir yönetici hesabı silinemiyordu ("Database error deleting user").
-- Kural korunur: satır silinemez, yalnızca aktör referansları boşaltılabilir.
-- ---------------------------------------------------------------------------

create or replace function public.tz_block_audit_mutation()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
begin
  -- Silme tamamen yasaktır.
  if tg_op = 'DELETE' then
    raise exception 'audit_logs_are_immutable' using errcode = '42501';
  end if;

  -- Tek istisna: yönetici hesabı silindiğinde aktör referanslarının NULL'a
  -- çekilmesi. Diğer tüm alanlar aynı kalmak zorundadır.
  if (to_jsonb(new) - 'actor_admin_id' - 'admin_id')
       = (to_jsonb(old) - 'actor_admin_id' - 'admin_id')
     and (new.actor_admin_id is not distinct from old.actor_admin_id or new.actor_admin_id is null)
     and (new.admin_id is not distinct from old.admin_id or new.admin_id is null)
  then
    return new;
  end if;

  raise exception 'audit_logs_are_immutable' using errcode = '42501';
end;
$$;

revoke all on function public.tz_block_audit_mutation() from public;
