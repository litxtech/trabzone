-- -----------------------------------------------------------------------------
-- 0089 — Baloncuk uyarıları: çocuk güvenliği hedefi
--
-- `safety_admin_get_report` çağrısı `safety.report.view` iznini zorunlu kılar.
-- Yalnızca `safety.child.view` izni olan personel şikâyet detay ekranını
-- açamayacağı için çocuk güvenliği baloncukları erişilebilir olan kuyruğa
-- (`/admin/child-safety`) yönlendirilir.
-- -----------------------------------------------------------------------------

create or replace function public.tz_admin_alert_user_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child  boolean := coalesce(new.is_child_safety, false);
  v_ref    text := coalesce(nullif(new.report_no, ''), left(new.id::text, 8));
  v_reason text := coalesce(nullif(new.reason_category, ''), nullif(new.target_type, ''), 'diğer');
begin
  perform public.tz_admin_push_alert(
    case when v_child then 'child_safety' else 'report' end,
    case when v_child then 'Çocuk güvenliği bildirimi' else 'Yeni şikâyet' end,
    v_ref || ' · ' || v_reason,
    case
      when v_child then '/admin/child-safety'
      else '/admin/report/' || new.id::text
    end,
    'user_report',
    new.id::text,
    case when v_child then 'safety.child.view' else 'safety.report.view' end,
    case when v_child then 'danger' else 'warning' end
  );
  return new;
end;
$$;

revoke all on function public.tz_admin_alert_user_report() from public, anon, authenticated;

drop trigger if exists tz_alert_user_reports on public.user_reports;
create trigger tz_alert_user_reports
  after insert on public.user_reports
  for each row execute function public.tz_admin_alert_user_report();
