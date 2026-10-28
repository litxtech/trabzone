-- 0090: Birebir sohbette karşı tarafın başlık bilgisi korunur.
--
-- 0089'da üye listesi tüm sohbetlerde engelli kişileri gizliyordu. Birebir
-- sohbette bu, engelleyen tarafın karşı tarafın adını/avatarını kaybetmesine
-- yol açıyordu. Filtre artık yalnızca grup sohbetlerinde uygulanır; birebir
-- sohbete engellenen taraf zaten tz_conversation_guard ile hiç giremiyor.

set search_path = public;

do $$
declare
  d text;
  anchor text := 'and not public.is_blocked(v_uid, m.user_id)';
  patched text := 'and (
            (select c.kind from public.conversations c where c.id = p_conversation_id) = ''direct''
            or not public.is_blocked(v_uid, m.user_id)
          )';
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'chat_members';

  if position('c.kind' in d) > 0 then
    raise notice 'chat_members already scoped to groups';
  else
    if position(anchor in d) = 0 then
      raise exception 'chat_members anchor missing';
    end if;
    d := replace(d, anchor, patched);
    execute d;
  end if;
end;
$$;
