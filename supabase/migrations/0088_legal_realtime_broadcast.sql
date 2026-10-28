-- 0083_legal_realtime_broadcast.sql
-- Hukuki belge değişikliklerini açık oturumlara anında duyurur.
--
-- `postgres_changes` ile yapılan abonelikte RLS, yeni satırı artık görmeyen
-- (yayından kaldırılan / silinen) değişiklikleri aboneye iletmez. Bu yüzden
-- "yayından kaldır" işlemi açık sayfalara ulaşmıyordu. Tetikleyici, satır
-- içeriğini paylaşmadan yalnızca "bu belge değişti" sinyali yayınlar.

create or replace function public.legal_notify_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := coalesce(new.slug, old.slug);
begin
  perform realtime.send(
    jsonb_build_object(
      'slug', v_slug,
      'op', tg_op
    ),
    'legal_changed',
    'legal-policies',
    false
  );
  return null;
end
$$;

drop trigger if exists legal_notify_change on public.safety_policy_versions;
create trigger legal_notify_change
  after insert or update or delete on public.safety_policy_versions
  for each row
  execute function public.legal_notify_change();
