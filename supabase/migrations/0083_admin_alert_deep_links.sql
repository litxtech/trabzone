-- -----------------------------------------------------------------------------
-- 0083 — Baloncuk uyarıları: hedef ekran derin bağlantıları + rezervasyonlar
--
-- Baloncuğa tıklandığında yalnızca doğru modüle değil, o modülün ilgili
-- sekmesine de gidilmesi için trigger rotaları güncellenir:
--   * sipariş        → /admin/marketplace?tab=orders
--   * doğrulama      → /admin/ride?tab=verifications
--   * güvenlik olayı → /admin/ride?tab=incidents
--   * uyuşmazlık     → /admin/ride?tab=disputes
--   * rezervasyon    → /admin/ride?tab=reservations
--   * içerik bildiri → /admin/explore?tab=reports
--
-- Ayrıca yeni yolculuk rezervasyonları da aynı baloncuk diliyle bildirilir.
-- -----------------------------------------------------------------------------

alter table public.admin_alert_events
  drop constraint if exists admin_alert_events_category_check;

alter table public.admin_alert_events
  add constraint admin_alert_events_category_check check (
    category in (
      'report', 'child_safety', 'ticket', 'approval', 'error', 'privacy',
      'deletion', 'order', 'ride_verification', 'ride_safety', 'ride_dispute',
      'ride_booking', 'content_report', 'custom'
    )
  );

drop trigger if exists tz_alert_marketplace_orders on public.marketplace_orders;
create trigger tz_alert_marketplace_orders
  after insert on public.marketplace_orders
  for each row execute function public.tz_admin_alert_trigger(
    'order', 'market.orders.view', '/admin/marketplace?tab=orders', 'Yeni sipariş', 'order_no', 'info', 'false'
  );

drop trigger if exists tz_alert_ride_verifications on public.ride_verifications;
create trigger tz_alert_ride_verifications
  after insert on public.ride_verifications
  for each row execute function public.tz_admin_alert_trigger(
    'ride_verification', 'ride.verify', '/admin/ride?tab=verifications', 'Yeni doğrulama başvurusu', 'kind', 'info', 'false', 'status', 'pending'
  );

drop trigger if exists tz_alert_ride_safety on public.ride_safety_incidents;
create trigger tz_alert_ride_safety
  after insert on public.ride_safety_incidents
  for each row execute function public.tz_admin_alert_trigger(
    'ride_safety', 'ride.safety', '/admin/ride?tab=incidents', 'Yolculuk güvenlik olayı', 'kind', 'danger', 'false'
  );

drop trigger if exists tz_alert_ride_disputes on public.ride_disputes;
create trigger tz_alert_ride_disputes
  after insert on public.ride_disputes
  for each row execute function public.tz_admin_alert_trigger(
    'ride_dispute', 'ride.moderate', '/admin/ride?tab=disputes', 'Yeni yolculuk uyuşmazlığı', 'category', 'warning', 'false'
  );

drop trigger if exists tz_alert_content_reports on public.content_reports;
create trigger tz_alert_content_reports
  after insert on public.content_reports
  for each row execute function public.tz_admin_alert_trigger(
    'content_report', 'map.moderate', '/admin/explore?tab=reports', 'Yeni içerik bildirimi', 'reason', 'warning', 'false'
  );

drop trigger if exists tz_alert_ride_bookings on public.ride_reservations;
create trigger tz_alert_ride_bookings
  after insert on public.ride_reservations
  for each row execute function public.tz_admin_alert_trigger(
    'ride_booking', 'ride.view', '/admin/ride?tab=reservations', 'Yeni yolculuk rezervasyonu', 'payment_method', 'success', 'false'
  );
