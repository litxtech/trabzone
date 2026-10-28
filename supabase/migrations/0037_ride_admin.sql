-- =====================================================================
-- 0035 — Yolculuk Yönetim Merkezi (admin)
--
-- Her fonksiyon izni sunucuda yeniden kontrol eder. Finans, kimlik belgesi
-- ve güvenlik verileri farklı izinlere ayrılmıştır; moderatör tek başına
-- ödeme veya belge onayı yapamaz. Tüm kritik işlemler audit log üretir.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. İzin kataloğu ve rol atamaları
-- ---------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr) values
  ('ride.view',      'Yolculuk listeleri, rezervasyonlar ve dashboard görüntüleme'),
  ('ride.moderate',  'Yolculuk ilanı iptali, rezervasyon ve uyuşmazlık moderasyonu'),
  ('ride.verify',    'Kimlik, sürücü belgesi, araç ve araç belgesi onaylama'),
  ('ride.finance',   'Ödeme, iade ve finansal raporları görüntüleme/işleme'),
  ('ride.safety',    'Güvenlik olayları ve SOS kayıtlarını yönetme'),
  ('ride.manage',    'Yolculuk iş kuralları ve platform ayarlarını yönetme'),
  ('ride.analytics', 'Yolculuk analitik raporlarını görüntüleme ve dışa aktarma')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.roles (key, name, description, rank) values
  ('ride_manager', 'Yolculuk Yöneticisi', 'Yolculuk ilanları, doğrulama ve güvenlik operasyonları', 25)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, rank = excluded.rank;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'ride.view'), ('admin', 'ride.moderate'), ('admin', 'ride.verify'),
  ('admin', 'ride.finance'), ('admin', 'ride.safety'), ('admin', 'ride.manage'),
  ('admin', 'ride.analytics'),

  ('ride_manager', 'ride.view'), ('ride_manager', 'ride.moderate'),
  ('ride_manager', 'ride.verify'), ('ride_manager', 'ride.safety'),
  ('ride_manager', 'ride.analytics'),

  ('moderator', 'ride.view'), ('moderator', 'ride.moderate'),
  ('support_agent', 'ride.view'),
  ('finance_officer', 'ride.view'), ('finance_officer', 'ride.finance'),
  ('security_officer', 'ride.view'), ('security_officer', 'ride.safety'),
  ('analyst', 'ride.view'), ('analyst', 'ride.analytics')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Dashboard
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
  v_today timestamptz := date_trunc('day', now());
begin
  return jsonb_build_object(
    'offers', jsonb_build_object(
      'active', (select count(*) from public.ride_offers where status in ('published','full')),
      'started', (select count(*) from public.ride_offers where status = 'started'),
      'scheduled', (select count(*) from public.ride_offers where status = 'published' and mode = 'scheduled'),
      'today', (select count(*) from public.ride_offers where created_at >= v_today),
      'completed_30d', (select count(*) from public.ride_offers
        where status = 'completed' and completed_at > now() - interval '30 days')
    ),
    'reservations', jsonb_build_object(
      'requested', (select count(*) from public.ride_reservations where status = 'requested'),
      'confirmed', (select count(*) from public.ride_reservations where status = 'confirmed'),
      'active', (select count(*) from public.ride_reservations where status = 'started'),
      'today', (select count(*) from public.ride_reservations where created_at >= v_today),
      'completed_30d', (select count(*) from public.ride_reservations
        where status = 'completed' and completed_at > now() - interval '30 days'),
      'cancelled_30d', (select count(*) from public.ride_reservations
        where status in ('cancelled','rejected','expired') and updated_at > now() - interval '30 days')
    ),
    'queues', jsonb_build_object(
      'verifications', (select count(*) from public.ride_verifications where status = 'pending'),
      'vehicles', (select count(*) from public.ride_vehicles where status = 'pending'),
      'vehicle_documents', (select count(*) from public.ride_vehicle_documents where status = 'pending'),
      'disputes', (select count(*) from public.ride_disputes where status in ('open','reviewing')),
      'incidents', (select count(*) from public.ride_safety_incidents where status in ('open','acknowledged')),
      'critical_incidents', (select count(*) from public.ride_safety_incidents
        where severity = 'critical' and status <> 'resolved'),
      'waitlists', (select count(*) from public.ride_waitlists where status = 'waiting'),
      'expiring_documents', (select count(*) from public.ride_verifications
        where status = 'approved' and expires_at is not null and expires_at <= current_date + 30)
    ),
    'finance', jsonb_build_object(
      'cash_reservations_30d', (select count(*) from public.ride_reservations
        where payment_method = 'cash' and status in ('confirmed','started','completed')
          and created_at > now() - interval '30 days'),
      'cash_reported_cents_30d', (select coalesce(sum(total_cents),0) from public.ride_reservations
        where payment_method = 'cash' and status in ('confirmed','started','completed')
          and created_at > now() - interval '30 days'),
      'card_payments', (select count(*) from public.ride_payments),
      'verified_paid_cents', (select coalesce(sum(amount_cents),0) from public.ride_payments where status = 'succeeded'),
      'refund_requests', (select count(*) from public.ride_refunds where status = 'requested'),
      'refunds_total_cents', (select coalesce(sum(amount_cents),0) from public.ride_refunds
        where status in ('approved','processing','succeeded')),
      'note', 'Nakit bedeller uygulama içinde tahsil edilmez; yalnızca bildirilen rezervasyon tutarıdır.'
    ),
    'community', jsonb_build_object(
      'reviews', (select count(*) from public.ride_reviews where status = 'published'),
      'rating_avg', (select round(avg(rating)::numeric, 2) from public.ride_reviews where status = 'published'),
      'verified_members', (select count(*) from public.ride_member_profiles where identity_status = 'approved'),
      'approved_drivers', (select count(*) from public.ride_member_profiles where driver_status = 'approved'),
      'vehicles_approved', (select count(*) from public.ride_vehicles where status = 'approved' and is_active),
      'recurring_active', (select count(*) from public.ride_recurring_schedules where is_active)
    ),
    'config', jsonb_build_object(
      'card_payments_enabled', public.ride_card_payments_enabled(),
      'commercial_enabled', coalesce((public.ride_setting('ride.commercial_enabled','false'::jsonb) #>> '{}')::boolean, false),
      'hold_minutes', public.ride_setting('ride.hold_minutes','60'::jsonb),
      'free_hours_intracity', public.ride_setting('ride.cancel.free_hours_intracity','1'::jsonb),
      'free_hours_intercity', public.ride_setting('ride.cancel.free_hours_intercity','4'::jsonb),
      'cost_per_km_cents', public.ride_setting('ride.cost_per_km_cents','null'::jsonb)
    )
  );
end;
$$;

grant execute on function public.ride_admin_overview() to authenticated;

-- ---------------------------------------------------------------------
-- 3. İlanlar
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_offers(
  p_status text default null,
  p_query text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.ride_offers o
  join public.profiles d on d.id = o.driver_id
  where (p_status is null or p_status = 'all' or o.status = p_status)
    and (p_query is null or p_query = ''
      or o.origin_label ilike '%' || p_query || '%'
      or o.dest_label ilike '%' || p_query || '%'
      or d.username::text ilike '%' || p_query || '%');

  select coalesce(jsonb_agg(item order by item->>'depart_at' desc), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', o.id,
      'scope', o.scope,
      'mode', o.mode,
      'status', o.status,
      'origin_label', o.origin_label,
      'origin_city', o.origin_city,
      'dest_label', o.dest_label,
      'dest_city', o.dest_city,
      'depart_at', o.depart_at,
      'seats_total', o.seats_total,
      'price_per_seat_cents', o.price_per_seat_cents,
      'currency', o.currency,
      'distance_meters', o.distance_meters,
      'booking_mode', o.booking_mode,
      'visibility', o.visibility,
      'route_mode', o.route_mode,
      'recurring_id', o.recurring_id,
      'created_at', o.created_at,
      'driver', jsonb_build_object(
        'id', d.id, 'username', d.username, 'first_name', d.first_name,
        'last_name', d.last_name, 'avatar_path', d.avatar_path,
        'identity_status', m.identity_status, 'driver_status', m.driver_status,
        'level', m.level, 'rating_avg', m.rating_avg, 'completed_trips', m.completed_trips
      ),
      'vehicle', jsonb_build_object(
        'id', v.id, 'make', v.make, 'model', v.model, 'year', v.year,
        'plate', v.plate, 'status', v.status
      ),
      'reservations', jsonb_build_object(
        'requested', (select count(*) from public.ride_reservations r
          where r.offer_id = o.id and r.status = 'requested'),
        'confirmed', (select count(*) from public.ride_reservations r
          where r.offer_id = o.id and r.status = 'confirmed'),
        'started', (select count(*) from public.ride_reservations r
          where r.offer_id = o.id and r.status = 'started'),
        'completed', (select count(*) from public.ride_reservations r
          where r.offer_id = o.id and r.status = 'completed')
      ),
      'availability', public.ride_offer_availability(o.id)
    ) as item
    from public.ride_offers o
    join public.profiles d on d.id = o.driver_id
    join public.ride_member_profiles m on m.user_id = o.driver_id
    join public.ride_vehicles v on v.id = o.vehicle_id
    where (p_status is null or p_status = 'all' or o.status = p_status)
      and (p_query is null or p_query = ''
        or o.origin_label ilike '%' || p_query || '%'
        or o.dest_label ilike '%' || p_query || '%'
        or d.username::text ilike '%' || p_query || '%')
    order by o.depart_at desc
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

grant execute on function public.ride_admin_offers(text, text, integer, integer) to authenticated;

create or replace function public.ride_admin_offer_action(
  p_offer_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.moderate', false);
  v_offer public.ride_offers%rowtype;
  v_r record;
  v_affected int := 0;
begin
  if p_action not in ('cancel','suspend_driver') then
    raise exception 'invalid_admin_action' using errcode = '22023';
  end if;
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;

  if p_action = 'cancel' then
    if v_offer.status in ('completed','cancelled') then
      raise exception 'invalid_transition' using errcode = '22023';
    end if;
    update public.ride_offers
       set status = 'cancelled', cancelled_at = now(),
           cancel_reason = left(coalesce(p_reason, 'admin_cancelled'), 300)
     where id = p_offer_id;
    update public.ride_seat_allocations set status = 'released'
     where offer_id = p_offer_id;
    for v_r in select * from public.ride_reservations
      where offer_id = p_offer_id and status in ('requested','awaiting_approval','confirmed','started')
      for update
    loop
      update public.ride_reservations
         set status = 'cancelled', cancelled_at = now(), cancel_reason = 'admin_cancelled'
       where id = v_r.id;
      perform public.tz_notify(v_r.passenger_id, NULL, 'ride', 'Yolculuk yönetim tarafından iptal edildi',
        'Rezervasyonun Trabzone güvenlik incelemesi kapsamında iptal edildi.',
        'ride_reservation', v_r.id::text, '/ride/trips/' || v_r.id::text);
      v_affected := v_affected + 1;
    end loop;
    update public.ride_waitlists set status = 'expired' where offer_id = p_offer_id and status = 'waiting';
  else
    update public.ride_member_profiles
       set driver_status = 'suspended'
     where user_id = v_offer.driver_id;
    update public.ride_offers
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'driver_suspended'
     where driver_id = v_offer.driver_id and status in ('published','full');
    update public.ride_reservations r
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'driver_suspended'
      from public.ride_offers o
     where o.id = r.offer_id and o.driver_id = v_offer.driver_id
       and r.status in ('requested','awaiting_approval','confirmed');
    perform public.tz_notify(v_offer.driver_id, NULL, 'ride', 'Sürücü hesabı askıya alındı',
      'Yolculuk paylaşımı sürücü yetkin güvenlik incelemesi nedeniyle askıya alındı.',
      'ride_member', v_offer.driver_id::text, '/ride/verification');
    v_affected := 1;
  end if;

  perform public.tz_admin_audit(
    'ride.offer.' || p_action, 'Yolculuk ilanı yönetim işlemi',
    'ride_offer', p_offer_id::text,
    jsonb_build_object('action', p_action, 'reason', p_reason, 'affected', v_affected)
  );

  return jsonb_build_object('ok', true, 'affected', v_affected);
end;
$$;

grant execute on function public.ride_admin_offer_action(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Rezervasyonlar
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_reservations(
  p_status text default null,
  p_query text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.ride_reservations r
  join public.ride_offers o on o.id = r.offer_id
  join public.profiles p on p.id = r.passenger_id
  join public.profiles d on d.id = o.driver_id
  where (p_status is null or p_status = 'all' or r.status = p_status)
    and (p_query is null or p_query = ''
      or p.username::text ilike '%' || p_query || '%'
      or d.username::text ilike '%' || p_query || '%'
      or o.origin_label ilike '%' || p_query || '%'
      or o.dest_label ilike '%' || p_query || '%');

  select coalesce(jsonb_agg(item order by item->>'created_at' desc), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'seats', r.seats,
      'total_cents', r.total_cents,
      'currency', r.currency,
      'payment_method', r.payment_method,
      'payment_status', r.payment_status,
      'pickup_label', r.pickup_label,
      'dropoff_label', r.dropoff_label,
      'hold_expires_at', r.hold_expires_at,
      'created_at', r.created_at,
      'depart_at', o.depart_at,
      'offer_id', o.id,
      'offer_status', o.status,
      'origin_label', o.origin_label,
      'dest_label', o.dest_label,
      'driver', jsonb_build_object('id', d.id, 'username', d.username, 'first_name', d.first_name, 'last_name', d.last_name),
      'passenger', jsonb_build_object('id', p.id, 'username', p.username, 'first_name', p.first_name, 'last_name', p.last_name, 'is_verified', p.is_verified),
      'has_open_dispute', exists (select 1 from public.ride_disputes x where x.reservation_id = r.id and x.status in ('open','reviewing'))
    ) as item
    from public.ride_reservations r
    join public.ride_offers o on o.id = r.offer_id
    join public.profiles p on p.id = r.passenger_id
    join public.profiles d on d.id = o.driver_id
    where (p_status is null or p_status = 'all' or r.status = p_status)
      and (p_query is null or p_query = ''
        or p.username::text ilike '%' || p_query || '%'
        or d.username::text ilike '%' || p_query || '%'
        or o.origin_label ilike '%' || p_query || '%'
        or o.dest_label ilike '%' || p_query || '%')
    order by r.created_at desc
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

grant execute on function public.ride_admin_reservations(text, text, integer, integer) to authenticated;

create or replace function public.ride_admin_reservation_action(
  p_reservation_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.moderate', false);
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
  v_payment public.ride_payments%rowtype;
  v_refund int := 0;
begin
  if p_action <> 'cancel' then
    raise exception 'invalid_admin_action' using errcode = '22023';
  end if;
  select * into v_r from public.ride_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  if v_r.status in ('cancelled','rejected','expired','completed') then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  select * into v_offer from public.ride_offers where id = v_r.offer_id;

  update public.ride_reservations
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(coalesce(p_reason, 'admin_cancelled'), 300)
   where id = v_r.id;
  update public.ride_seat_allocations set status = 'released' where reservation_id = v_r.id;

  if v_r.payment_status = 'paid' then
    select * into v_payment from public.ride_payments
    where reservation_id = v_r.id and status in ('succeeded','authorized')
    order by created_at desc limit 1;
    insert into public.ride_refunds (reservation_id, payment_id, amount_cents, reason, status, requested_by)
    values (v_r.id, v_payment.id, v_r.total_cents, 'admin_cancelled', 'requested', v_admin);
    v_refund := v_r.total_cents;
  end if;

  perform public.tz_notify(v_r.passenger_id, NULL, 'ride', 'Rezervasyonun iptal edildi',
    'Rezervasyon Trabzone ekibi tarafından iptal edildi. Nedenin açıklaması kayıt altına alındı.',
    'ride_reservation', v_r.id::text, '/ride/trips/' || v_r.id::text);
  perform public.tz_notify(v_offer.driver_id, NULL, 'ride', 'Rezervasyon iptal edildi',
    'Bir yolcunun rezervasyonu yönetim tarafından iptal edildi.',
    'ride_reservation', v_r.id::text, '/ride/trips/' || v_r.id::text);

  perform public.tz_admin_audit(
    'ride.reservation.cancel', 'Rezervasyon yönetim iptali',
    'ride_reservation', v_r.id::text,
    jsonb_build_object('reason', p_reason, 'refund_cents', v_refund)
  );
  return jsonb_build_object('ok', true, 'refund_requested_cents', v_refund);
end;
$$;

grant execute on function public.ride_admin_reservation_action(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Kimlik ve belge doğrulamaları
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_verifications(
  p_status text default 'pending',
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.verify', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.ride_verifications v
  where p_status is null or p_status = 'all' or v.status = p_status;

  select coalesce(jsonb_agg(item order by item->>'created_at'), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', v.id, 'kind', v.kind, 'status', v.status,
      'document_path', v.document_path, 'expires_at', v.expires_at,
      'reject_reason', v.reject_reason, 'created_at', v.created_at,
      'meta', v.meta,
      'user', jsonb_build_object(
        'id', p.id, 'username', p.username, 'first_name', p.first_name, 'last_name', p.last_name,
        'avatar_path', p.avatar_path, 'is_verified', p.is_verified,
        'identity_status', m.identity_status, 'driver_status', m.driver_status,
        'level', m.level, 'rating_avg', m.rating_avg, 'completed_trips', m.completed_trips
      )
    ) as item
    from public.ride_verifications v
    join public.profiles p on p.id = v.user_id
    join public.ride_member_profiles m on m.user_id = v.user_id
    where p_status is null or p_status = 'all' or v.status = p_status
    order by v.created_at
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

grant execute on function public.ride_admin_verifications(text, integer, integer) to authenticated;

create or replace function public.ride_admin_verification_decide(
  p_verification_id uuid,
  p_approve boolean,
  p_reason text default null,
  p_expires_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.verify', false);
  v_v public.ride_verifications%rowtype;
  v_all_approved boolean;
begin
  select * into v_v from public.ride_verifications where id = p_verification_id for update;
  if not found then
    raise exception 'verification_not_found' using errcode = 'P0002';
  end if;
  if v_v.status <> 'pending' then
    raise exception 'verification_already_decided' using errcode = '22023';
  end if;

  if p_approve then
    update public.ride_verifications
       set status = 'approved', reviewed_by = v_admin, reviewed_at = now(),
           reject_reason = null,
           expires_at = coalesce(p_expires_at, expires_at)
     where id = v_v.id;

    if v_v.kind = 'identity' then
      update public.ride_member_profiles set identity_status = 'approved' where user_id = v_v.user_id;
    end if;

    if v_v.kind in ('identity','driver_license','insurance') then
      select (
        select count(*) from public.ride_verifications x
        where x.user_id = v_v.user_id and x.status = 'approved'
          and x.kind in ('identity','driver_license','insurance')
          and (x.expires_at is null or x.expires_at > current_date)
      ) >= 3 into v_all_approved;

      update public.ride_member_profiles
         set driver_status = case
           when driver_status in ('none','rejected') and v_all_approved then 'pending'
           else driver_status end
       where user_id = v_v.user_id;
    end if;
  else
    if char_length(trim(coalesce(p_reason,''))) < 5 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    update public.ride_verifications
       set status = 'rejected', reviewed_by = v_admin, reviewed_at = now(),
           reject_reason = left(p_reason, 400)
     where id = v_v.id;

    if v_v.kind = 'identity' then
      update public.ride_member_profiles set identity_status = 'rejected' where user_id = v_v.user_id;
    elsif v_v.kind in ('driver_license','insurance') then
      update public.ride_member_profiles set driver_status = 'rejected' where user_id = v_v.user_id;
    end if;
  end if;

  perform public.tz_notify(v_v.user_id, NULL, 'ride',
    case when p_approve then 'Belgen onaylandı' else 'Belgen reddedildi' end,
    case when p_approve then 'Yolculuk doğrulama belgen incelendi ve onaylandı.'
         else 'Belgen reddedildi: ' || left(coalesce(p_reason,''), 200) end,
    'ride_verification', v_v.id::text, '/ride/verification');

  perform public.tz_admin_audit(
    case when p_approve then 'ride.verification.approve' else 'ride.verification.reject' end,
    'Kimlik/ehliyet doğrulama kararı',
    'ride_verification', v_v.id::text,
    jsonb_build_object('kind', v_v.kind, 'user_id', v_v.user_id, 'reason', p_reason)
  );

  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

grant execute on function public.ride_admin_verification_decide(uuid, boolean, text, date) to authenticated;

create or replace function public.ride_admin_driver_decide(
  p_user_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.verify', false);
  v_identity text;
  v_docs int;
  v_all boolean;
begin
  select identity_status into v_identity from public.ride_member_profiles where user_id = p_user_id;
  if v_identity is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  if p_approve then
    if v_identity <> 'approved' then
      raise exception 'identity_not_approved' using errcode = '22023';
    end if;
    select count(*) into v_docs
    from public.ride_verifications v
    where v.user_id = p_user_id and v.status = 'approved'
      and v.kind in ('driver_license','insurance')
      and (v.expires_at is null or v.expires_at > current_date);
    if v_docs < 2 then
      raise exception 'required_documents_missing' using errcode = '22023';
    end if;
    update public.ride_member_profiles set driver_status = 'approved' where user_id = p_user_id;
  else
    if char_length(trim(coalesce(p_reason,''))) < 5 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    update public.ride_member_profiles set driver_status = 'rejected' where user_id = p_user_id;
  end if;

  perform public.tz_notify(p_user_id, NULL, 'ride',
    case when p_approve then 'Sürücü başvurun onaylandı' else 'Sürücü başvurun reddedildi' end,
    case when p_approve then 'Artık araç ekleyip yolculuk ilanı yayınlayabilirsin.'
         else 'Başvurun reddedildi: ' || left(coalesce(p_reason,''), 200) end,
    'ride_member', p_user_id::text, '/ride/verification');

  perform public.tz_admin_audit(
    case when p_approve then 'ride.driver.approve' else 'ride.driver.reject' end,
    'Sürücü başvuru kararı', 'ride_member', p_user_id::text,
    jsonb_build_object('reason', p_reason)
  );
  return jsonb_build_object('ok', true, 'driver_status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

grant execute on function public.ride_admin_driver_decide(uuid, boolean, text) to authenticated;

create or replace function public.ride_admin_vehicles(
  p_status text default 'pending',
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.verify', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total from public.ride_vehicles v
  where p_status is null or p_status = 'all' or v.status = p_status;

  select coalesce(jsonb_agg(item order by item->>'created_at'), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', v.id, 'make', v.make, 'model', v.model, 'year', v.year, 'color', v.color,
      'plate', v.plate, 'seat_capacity', v.seat_capacity, 'luggage_capacity', v.luggage_capacity,
      'has_ac', v.has_ac, 'fuel_type', v.fuel_type, 'accessibility', v.accessibility,
      'photo_paths', v.photo_paths, 'status', v.status, 'is_active', v.is_active,
      'reject_reason', v.reject_reason, 'created_at', v.created_at,
      'owner', jsonb_build_object(
        'id', p.id, 'username', p.username, 'first_name', p.first_name, 'last_name', p.last_name,
        'identity_status', m.identity_status, 'driver_status', m.driver_status
      ),
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id, 'kind', d.kind, 'status', d.status, 'document_path', d.document_path,
          'expires_at', d.expires_at, 'reject_reason', d.reject_reason, 'created_at', d.created_at
        ) order by d.created_at desc)
        from public.ride_vehicle_documents d where d.vehicle_id = v.id
      ), '[]'::jsonb)
    ) as item
    from public.ride_vehicles v
    join public.profiles p on p.id = v.owner_id
    join public.ride_member_profiles m on m.user_id = v.owner_id
    where p_status is null or p_status = 'all' or v.status = p_status
    order by v.created_at
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

grant execute on function public.ride_admin_vehicles(text, integer, integer) to authenticated;

create or replace function public.ride_admin_vehicle_document_decide(
  p_document_id uuid,
  p_approve boolean,
  p_reason text default null,
  p_expires_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.verify', false);
  v_d public.ride_vehicle_documents%rowtype;
begin
  select * into v_d from public.ride_vehicle_documents where id = p_document_id for update;
  if not found then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if v_d.status <> 'pending' then
    raise exception 'document_already_decided' using errcode = '22023';
  end if;

  if p_approve then
    update public.ride_vehicle_documents
       set status = 'approved', reviewed_by = v_admin, reviewed_at = now(), reject_reason = null,
           expires_at = coalesce(p_expires_at, expires_at)
     where id = v_d.id;
  else
    if char_length(trim(coalesce(p_reason,''))) < 5 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    update public.ride_vehicle_documents
       set status = 'rejected', reviewed_by = v_admin, reviewed_at = now(),
           reject_reason = left(p_reason, 400)
     where id = v_d.id;
  end if;

  perform public.tz_notify(v_d.owner_id, NULL, 'ride',
    case when p_approve then 'Araç belgen onaylandı' else 'Araç belgen reddedildi' end,
    case when p_approve then 'Araç belgen incelendi ve onaylandı.'
         else 'Araç belgen reddedildi: ' || left(coalesce(p_reason,''), 200) end,
    'ride_vehicle_document', v_d.id::text, '/ride/garage');

  perform public.tz_admin_audit(
    case when p_approve then 'ride.vehicle_document.approve' else 'ride.vehicle_document.reject' end,
    'Araç belgesi kararı', 'ride_vehicle_document', v_d.id::text,
    jsonb_build_object('vehicle_id', v_d.vehicle_id, 'kind', v_d.kind, 'reason', p_reason)
  );
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.ride_admin_vehicle_document_decide(uuid, boolean, text, date) to authenticated;

create or replace function public.ride_admin_vehicle_decide(
  p_vehicle_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.verify', false);
  v_v public.ride_vehicles%rowtype;
  v_required int;
  v_owner_identity text;
  v_owner_driver text;
begin
  select * into v_v from public.ride_vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'vehicle_not_found' using errcode = 'P0002';
  end if;

  select identity_status, driver_status into v_owner_identity, v_owner_driver
  from public.ride_member_profiles where user_id = v_v.owner_id;

  if p_approve then
    if v_owner_identity <> 'approved' or v_owner_driver <> 'approved' then
      raise exception 'driver_not_approved' using errcode = '22023';
    end if;
    select count(*) into v_required
    from public.ride_vehicle_documents d
    where d.vehicle_id = p_vehicle_id and d.status = 'approved'
      and d.kind in ('registration','insurance')
      and (d.expires_at is null or d.expires_at > current_date);
    if v_required < 2 then
      raise exception 'required_documents_missing' using errcode = '22023';
    end if;

    update public.ride_vehicles
       set status = 'approved', reviewed_by = v_admin, reviewed_at = now(), reject_reason = null
     where id = p_vehicle_id;
  else
    if char_length(trim(coalesce(p_reason,''))) < 5 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    update public.ride_vehicles
       set status = 'rejected', reviewed_by = v_admin, reviewed_at = now(),
           reject_reason = left(p_reason, 400)
     where id = p_vehicle_id;
  end if;

  perform public.tz_notify(v_v.owner_id, NULL, 'ride',
    case when p_approve then 'Aracın onaylandı' else 'Araç başvurun reddedildi' end,
    case when p_approve then v_v.make || ' ' || v_v.model || ' (' || v_v.plate || ') artık ilanlarda kullanılabilir.'
         else 'Araç reddedildi: ' || left(coalesce(p_reason,''), 200) end,
    'ride_vehicle', v_v.id::text, '/ride/garage');

  perform public.tz_admin_audit(
    case when p_approve then 'ride.vehicle.approve' else 'ride.vehicle.reject' end,
    'Araç doğrulama kararı', 'ride_vehicle', v_v.id::text,
    jsonb_build_object('plate', v_v.plate, 'reason', p_reason)
  );
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

grant execute on function public.ride_admin_vehicle_decide(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Uyuşmazlıklar
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_disputes(
  p_status text default 'open',
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total from public.ride_disputes d
  where p_status is null or p_status = 'all' or d.status = p_status;

  select coalesce(jsonb_agg(item order by item->>'created_at'), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', d.id, 'category', d.category, 'description', d.description,
      'status', d.status, 'resolution', d.resolution, 'refund_cents', d.refund_cents,
      'created_at', d.created_at, 'reservation_id', d.reservation_id,
      'opened_by', jsonb_build_object('id', op.id, 'username', op.username, 'first_name', op.first_name, 'last_name', op.last_name),
      'against', jsonb_build_object('id', ag.id, 'username', ag.username, 'first_name', ag.first_name, 'last_name', ag.last_name),
      'reservation', jsonb_build_object(
        'status', r.status, 'seats', r.seats, 'total_cents', r.total_cents,
        'payment_method', r.payment_method, 'payment_status', r.payment_status,
        'origin_label', o.origin_label, 'dest_label', o.dest_label, 'depart_at', o.depart_at
      )
    ) as item
    from public.ride_disputes d
    join public.profiles op on op.id = d.opened_by
    left join public.profiles ag on ag.id = d.against_id
    join public.ride_reservations r on r.id = d.reservation_id
    join public.ride_offers o on o.id = r.offer_id
    where p_status is null or p_status = 'all' or d.status = p_status
    order by d.created_at
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

grant execute on function public.ride_admin_disputes(text, integer, integer) to authenticated;

create or replace function public.ride_admin_dispute_decide(
  p_dispute_id uuid,
  p_status text,
  p_resolution text,
  p_refund_cents integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.moderate', false);
  v_d public.ride_disputes%rowtype;
  v_r public.ride_reservations%rowtype;
  v_payment public.ride_payments%rowtype;
  v_paid boolean;
begin
  if p_status not in ('reviewing','resolved','rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status in ('resolved','rejected') and char_length(trim(coalesce(p_resolution,''))) < 5 then
    raise exception 'resolution_required' using errcode = '22023';
  end if;
  if coalesce(p_refund_cents, 0) < 0 then
    raise exception 'invalid_refund_amount' using errcode = '22023';
  end if;

  select * into v_d from public.ride_disputes where id = p_dispute_id for update;
  if not found then
    raise exception 'dispute_not_found' using errcode = 'P0002';
  end if;
  if v_d.status in ('resolved','rejected') then
    raise exception 'dispute_already_closed' using errcode = '22023';
  end if;

  select * into v_r from public.ride_reservations where id = v_d.reservation_id;

  if coalesce(p_refund_cents,0) > 0 then
    select exists (
      select 1 from public.ride_payments p
      where p.reservation_id = v_r.id and p.status in ('succeeded','authorized')
    ) into v_paid;
    if not v_paid then
      raise exception 'no_verified_payment' using errcode = '22023';
    end if;
    select * into v_payment from public.ride_payments
    where reservation_id = v_r.id and status in ('succeeded','authorized')
    order by created_at desc limit 1;
    insert into public.ride_refunds (
      reservation_id, payment_id, amount_cents, reason, status, requested_by
    ) values (
      v_r.id, v_payment.id, least(p_refund_cents, v_r.total_cents),
      'dispute_resolution', 'requested', v_admin
    );
  end if;

  update public.ride_disputes
     set status = p_status,
         resolution = left(coalesce(p_resolution, resolution), 2000),
         refund_cents = coalesce(p_refund_cents, 0),
         decided_by = v_admin, decided_at = now()
   where id = p_dispute_id;

  if p_status in ('resolved','rejected') then
    update public.ride_reservations set status = 'completed'
     where id = v_r.id and status = 'disputed';
  end if;

  perform public.tz_notify(v_d.opened_by, NULL, 'ride',
    case when p_status = 'rejected' then 'Uyuşmazlık başvurun kapatıldı' else 'Uyuşmazlık kararı verildi' end,
    left(coalesce(p_resolution, 'İnceleme durumu güncellendi.'), 300),
    'ride_dispute', p_dispute_id::text, '/ride/trips/' || v_d.reservation_id::text);

  if v_d.against_id is not null then
    perform public.tz_notify(v_d.against_id, NULL, 'ride', 'Uyuşmazlık incelemesi güncellendi',
      left(coalesce(p_resolution, 'İnceleme durumu güncellendi.'), 300),
      'ride_dispute', p_dispute_id::text, '/ride/trips/' || v_d.reservation_id::text);
  end if;

  perform public.tz_admin_audit(
    'ride.dispute.decide', 'Uyuşmazlık kararı', 'ride_dispute', p_dispute_id::text,
    jsonb_build_object('status', p_status, 'refund_cents', p_refund_cents, 'resolution', p_resolution)
  );

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

grant execute on function public.ride_admin_dispute_decide(uuid, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Güvenlik olayları
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_incidents(
  p_status text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.safety', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total from public.ride_safety_incidents i
  where (p_status is null or p_status = 'all' or i.status = p_status);

  select coalesce(jsonb_agg(item order by item->>'created_at' desc), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', i.id, 'kind', i.kind, 'severity', i.severity, 'status', i.status,
      'lat', i.lat, 'lng', i.lng, 'note', i.note, 'created_at', i.created_at,
      'handled_at', i.handled_at,
      'reservation_id', i.reservation_id, 'offer_id', i.offer_id,
      'user', jsonb_build_object('id', p.id, 'username', p.username, 'first_name', p.first_name, 'last_name', p.last_name),
      'offer', case when o.id is null then null else jsonb_build_object(
        'origin_label', o.origin_label, 'dest_label', o.dest_label, 'depart_at', o.depart_at, 'status', o.status
      ) end
    ) as item
    from public.ride_safety_incidents i
    join public.profiles p on p.id = i.user_id
    left join public.ride_offers o on o.id = i.offer_id
    where (p_status is null or p_status = 'all' or i.status = p_status)
    order by case when i.severity = 'critical' then 0 else 1 end, i.created_at desc
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

grant execute on function public.ride_admin_incidents(text, integer, integer) to authenticated;

create or replace function public.ride_admin_incident_action(
  p_incident_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.safety', false);
  v_i public.ride_safety_incidents%rowtype;
begin
  if p_status not in ('acknowledged','resolved') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select * into v_i from public.ride_safety_incidents where id = p_incident_id for update;
  if not found then
    raise exception 'incident_not_found' using errcode = 'P0002';
  end if;

  update public.ride_safety_incidents
     set status = p_status, handled_by = v_admin, handled_at = now(),
         note = case when p_note is null or p_note = '' then note
                     else left(note || E'\n[Yönetim] ' || p_note, 2000) end
   where id = p_incident_id;

  perform public.tz_notify(v_i.user_id, NULL, 'ride',
    case when p_status = 'resolved' then 'Güvenlik bildirimin kapatıldı' else 'Güvenlik bildirimin inceleniyor' end,
    case when p_status = 'resolved' then 'Güvenlik ekibi bildirimi sonuçlandırdı.'
         else 'Güvenlik ekibi bildirimini aldı ve inceliyor.' end,
    'ride_safety_incident', p_incident_id::text, '/ride/safety');

  perform public.tz_admin_audit(
    'ride.incident.' || p_status, 'Güvenlik olayı müdahalesi',
    'ride_safety_incident', p_incident_id::text,
    jsonb_build_object('note', p_note)
  );
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

grant execute on function public.ride_admin_incident_action(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Finans (yalnızca doğrulanmış sağlayıcı kayıtları)
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_finance(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.finance', false);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  return jsonb_build_object(
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'reservation_id', p.reservation_id, 'provider', p.provider,
        'provider_intent_id', p.provider_intent_id, 'amount_cents', p.amount_cents,
        'currency', p.currency, 'status', p.status, 'failure_code', p.failure_code,
        'created_at', p.created_at,
        'payer', jsonb_build_object('id', pr.id, 'username', pr.username,
          'first_name', pr.first_name, 'last_name', pr.last_name)
      ) order by p.created_at desc)
      from public.ride_payments p
      join public.profiles pr on pr.id = p.payer_id
      limit v_limit
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'reservation_id', r.reservation_id, 'amount_cents', r.amount_cents,
        'reason', r.reason, 'status', r.status, 'provider_refund_id', r.provider_refund_id,
        'created_at', r.created_at, 'decided_at', r.decided_at
      ) order by r.created_at desc)
      from public.ride_refunds r
      limit v_limit
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'verified_paid_cents', (select coalesce(sum(amount_cents),0) from public.ride_payments where status = 'succeeded'),
      'authorized_cents', (select coalesce(sum(amount_cents),0) from public.ride_payments where status = 'authorized'),
      'refund_requested_cents', (select coalesce(sum(amount_cents),0) from public.ride_refunds where status = 'requested'),
      'refund_completed_cents', (select coalesce(sum(amount_cents),0) from public.ride_refunds where status = 'succeeded'),
      'cash_reported_cents', (select coalesce(sum(total_cents),0) from public.ride_reservations
        where payment_method = 'cash' and status in ('confirmed','started','completed'))
    ),
    'provider_ready', public.ride_card_payments_enabled(),
    'note', 'Kartlı ödeme sağlayıcısı etkin değilken hiçbir işlem başarılı sayılmaz; nakit tutarlar uygulama içinde tahsil edilmez.'
  );
end;
$$;

grant execute on function public.ride_admin_finance(integer) to authenticated;

create or replace function public.ride_admin_refund_decide(
  p_refund_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.finance', false);
  v_r public.ride_refunds%rowtype;
  v_payment public.ride_payments%rowtype;
begin
  select * into v_r from public.ride_refunds where id = p_refund_id for update;
  if not found then
    raise exception 'refund_not_found' using errcode = 'P0002';
  end if;
  if v_r.status <> 'requested' then
    raise exception 'refund_already_decided' using errcode = '22023';
  end if;

  if p_approve then
    select * into v_payment from public.ride_payments where id = v_r.payment_id;
    if v_payment.id is null or v_payment.status not in ('succeeded','authorized') then
      raise exception 'no_verified_payment' using errcode = '22023';
    end if;
    -- Sağlayıcı webhook'u gelmeden "succeeded" yazılmaz.
    update public.ride_refunds
       set status = 'approved', decided_by = v_admin, decided_at = now()
     where id = p_refund_id;
  else
    update public.ride_refunds
       set status = 'rejected', decided_by = v_admin, decided_at = now()
     where id = p_refund_id;
  end if;

  perform public.tz_admin_audit(
    case when p_approve then 'ride.refund.approve' else 'ride.refund.reject' end,
    'İade kararı', 'ride_refund', p_refund_id::text,
    jsonb_build_object('amount_cents', v_r.amount_cents, 'reason', p_reason)
  );

  return jsonb_build_object(
    'ok', true,
    'status', case when p_approve then 'approved' else 'rejected' end,
    'note', case when p_approve then 'İade onaylandı; sağlayıcı işlemi tamamlanana kadar başarılı sayılmaz.' else 'İade reddedildi.' end
  );
end;
$$;

grant execute on function public.ride_admin_refund_decide(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Kurallar ve ayarlar
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', s.key, 'value', s.value, 'description', s.description_tr,
        'is_public', s.is_public, 'updated_at', s.updated_at
      ) order by s.key)
      from public.app_settings s
      where s.key like 'ride.%'
    ), '[]'::jsonb),
    'editable_keys', jsonb_build_array(
      'ride.hold_minutes', 'ride.cancel.free_hours_intracity',
      'ride.cancel.free_hours_intercity', 'ride.cost_per_km_cents'
    ),
    'locked_keys', jsonb_build_object(
      'ride.card_payments_enabled', 'Ödeme kuruluşu yetkisi ve hukuki onay tamamlanmadan değiştirilemez.',
      'ride.commercial_enabled', 'Ticari taşımacılık izinleri doğrulanmadan değiştirilemez.'
    )
  );
end;
$$;

grant execute on function public.ride_admin_settings_get() to authenticated;

create or replace function public.ride_admin_setting_set(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.manage', true);
  v_num numeric;
begin
  if p_key in ('ride.card_payments_enabled','ride.commercial_enabled') then
    raise exception 'legal_approval_required' using errcode = '42501';
  end if;
  if p_key not in ('ride.hold_minutes','ride.cancel.free_hours_intracity',
                   'ride.cancel.free_hours_intercity','ride.cost_per_km_cents') then
    raise exception 'invalid_setting_key' using errcode = '22023';
  end if;

  if p_key = 'ride.hold_minutes' then
    v_num := (p_value #>> '{}')::numeric;
    if v_num < 5 or v_num > 1440 then
      raise exception 'invalid_setting_value' using errcode = '22023';
    end if;
  elsif p_key like 'ride.cancel.%' then
    v_num := (p_value #>> '{}')::numeric;
    if v_num < 0 or v_num > 168 then
      raise exception 'invalid_setting_value' using errcode = '22023';
    end if;
  elsif p_key = 'ride.cost_per_km_cents' then
    if p_value <> 'null'::jsonb then
      v_num := (p_value #>> '{}')::numeric;
      if v_num < 0 or v_num > 100000 then
        raise exception 'invalid_setting_value' using errcode = '22023';
      end if;
    end if;
  end if;

  update public.app_settings
     set value = p_value, updated_by = v_admin, updated_at = now()
   where key = p_key;
  if not found then
    raise exception 'setting_not_found' using errcode = 'P0002';
  end if;

  perform public.tz_admin_audit('ride.setting.set', 'Yolculuk kuralı güncellendi',
    'app_setting', p_key, jsonb_build_object('value', p_value));

  return jsonb_build_object('ok', true, 'key', p_key, 'value', p_value);
end;
$$;

grant execute on function public.ride_admin_setting_set(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Analitik
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.analytics', false);
  v_days int := least(greatest(coalesce(p_days, 30), 1), 180);
begin
  return jsonb_build_object(
    'days', v_days,
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d::date,
        'offers', (select count(*) from public.ride_offers o where o.created_at::date = d::date),
        'reservations', (select count(*) from public.ride_reservations r where r.created_at::date = d::date),
        'completed', (select count(*) from public.ride_reservations r
          where r.completed_at::date = d::date and r.status = 'completed'),
        'cancelled', (select count(*) from public.ride_reservations r
          where r.cancelled_at::date = d::date),
        'new_members', (select count(*) from public.ride_member_profiles m where m.created_at::date = d::date)
      ) order by d)
      from generate_series(current_date - (v_days - 1), current_date, interval '1 day') d
    ), '[]'::jsonb),
    'top_routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'origin', origin_city, 'dest', dest_city, 'trips', trips
      ) order by trips desc)
      from (
        select origin_city, dest_city, count(*) as trips
        from public.ride_offers
        where created_at > now() - make_interval(days => v_days)
        group by origin_city, dest_city
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'top_drivers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', d.id, 'username', d.username, 'first_name', d.first_name,
        'completed_trips', m.completed_trips, 'rating_avg', m.rating_avg, 'level', m.level
      ) order by m.completed_trips desc)
      from (
        select o.driver_id, count(*) as trips
        from public.ride_reservations r
        join public.ride_offers o on o.id = r.offer_id
        where r.status = 'completed' and r.completed_at > now() - make_interval(days => v_days)
        group by o.driver_id
        order by count(*) desc
        limit 10
      ) t
      join public.profiles d on d.id = t.driver_id
      join public.ride_member_profiles m on m.user_id = t.driver_id
    ), '[]'::jsonb),
    'verification_funnel', jsonb_build_object(
      'members', (select count(*) from public.ride_member_profiles),
      'identity_approved', (select count(*) from public.ride_member_profiles where identity_status = 'approved'),
      'drivers_approved', (select count(*) from public.ride_member_profiles where driver_status = 'approved'),
      'vehicles_approved', (select count(*) from public.ride_vehicles where status = 'approved' and is_active)
    ),
    'dispute_rate', (
      select case when count(*) = 0 then 0
        else round((count(*) filter (where exists (
          select 1 from public.ride_disputes d where d.reservation_id = r.id
        )))::numeric / count(*) * 100, 2) end
      from public.ride_reservations r
      where r.created_at > now() - make_interval(days => v_days)
    )
  );
end;
$$;

grant execute on function public.ride_admin_analytics(integer) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Denetim kaydı ve koltuk haritası
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_audit_list(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action, 'entity_type', a.entity_type,
        'entity_id', a.entity_id, 'metadata', a.metadata, 'created_at', a.created_at,
        'actor', case when p.id is null then null else jsonb_build_object(
          'id', p.id, 'username', p.username, 'first_name', p.first_name, 'last_name', p.last_name
        ) end
      ) order by a.created_at desc)
      from public.ride_audit_logs a
      left join public.profiles p on p.id = a.actor_id
      limit v_limit offset v_offset
    ), '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

grant execute on function public.ride_admin_audit_list(integer, integer) to authenticated;

create or replace function public.ride_admin_seat_map(p_offer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
begin
  return jsonb_build_object(
    'offer_id', p_offer_id,
    'availability', public.ride_offer_availability(p_offer_id),
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reservation_id', r.id, 'passenger_id', r.passenger_id,
        'username', p.username, 'status', r.status,
        'seats', r.seats, 'pickup_seq', r.pickup_seq, 'dropoff_seq', r.dropoff_seq,
        'allocations', coalesce((
          select jsonb_agg(jsonb_build_object('seat_no', a.seat_no, 'from_seq', a.from_seq,
            'to_seq', a.to_seq, 'status', a.status) order by a.seat_no)
          from public.ride_seat_allocations a where a.reservation_id = r.id
        ), '[]'::jsonb)
      ) order by r.created_at)
      from public.ride_reservations r
      join public.profiles p on p.id = r.passenger_id
      where r.offer_id = p_offer_id
        and r.status in ('requested','awaiting_approval','confirmed','started')
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.ride_admin_seat_map(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 12. Belge süresi taraması (günlük)
-- ---------------------------------------------------------------------
create or replace function public.ride_document_expiry_scan()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    select v.id, v.user_id, v.kind, v.expires_at
    from public.ride_verifications v
    where v.status = 'approved' and v.expires_at is not null
      and v.expires_at <= current_date + 30
      and not exists (
        select 1 from public.notifications n
        where n.user_id = v.user_id and n.entity_type = 'ride_verification'
          and n.entity_id = v.id::text and n.kind = 'ride'
          and n.created_at > now() - interval '7 days'
      )
  loop
    perform public.tz_notify(v_row.user_id, NULL, 'ride', 'Belgenin süresi doluyor',
      case when v_row.expires_at <= current_date
        then 'Belgenin süresi doldu. Yeni belge yükleyene kadar yeni rezervasyon oluşturamazsın.'
        else 'Belgen ' || to_char(v_row.expires_at, 'DD.MM.YYYY') || ' tarihinde doluyor. Yenilemeyi unutma.'
      end,
      'ride_verification', v_row.id::text, '/ride/verification');
    v_count := v_count + 1;
  end loop;

  update public.ride_verifications
     set status = 'expired'
   where status = 'approved' and expires_at is not null and expires_at < current_date
     and kind in ('driver_license','insurance','transport_license');

  update public.ride_member_profiles m
     set driver_status = 'rejected'
   where driver_status = 'approved'
     and not exists (
       select 1 from public.ride_verifications v
       where v.user_id = m.user_id and v.kind in ('identity','driver_license','insurance')
         and v.status = 'approved' and (v.expires_at is null or v.expires_at > current_date)
       group by v.user_id
       having count(*) >= 3
     );
  return v_count;
end;
$$;

revoke all on function public.ride_document_expiry_scan() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule(jobname) from cron.job where jobname = 'ride-document-expiry';
    exception when others then null;
    end;
    perform cron.schedule('ride-document-expiry', '30 3 * * *', 'select public.ride_document_expiry_scan()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 13. Shell sayaçları: yolculuk kuyrukları
-- ---------------------------------------------------------------------
create or replace function public.admin_shell_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.admin_permissions p where public.has_permission(p.code)) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'pending_reports', case when public.has_permission('safety.report.view') then
      (select count(*) from public.user_reports
        where status_code in ('received', 'under_review')) else 0 end,
    'critical_reports', case when public.has_permission('safety.child.view') then
      (select count(*) from public.user_reports
        where is_child_safety and status_code in ('received', 'under_review')) else 0 end,
    'open_tickets', case when public.has_permission('support.view') then
      (select count(*) from public.support_tickets
        where status_code not in ('resolved', 'closed')) else 0 end,
    'pending_approvals', case when public.has_permission('feature.view') then
      (select count(*) from public.admin_approval_requests
        where status = 'pending' and (public.is_super_admin() or requested_by = v_uid)) else 0 end,
    'open_errors', case when public.has_permission('system.view') then
      (select count(*) from public.system_errors where resolved_at is null) else 0 end,
    'pending_ride_verifications', case when public.has_permission('ride.verify') then
      (select count(*) from public.ride_verifications where status = 'pending')
      + (select count(*) from public.ride_vehicles where status = 'pending') else 0 end,
    'open_ride_incidents', case when public.has_permission('ride.safety') then
      (select count(*) from public.ride_safety_incidents where status = 'open') else 0 end,
    'open_ride_disputes', case when public.has_permission('ride.moderate') then
      (select count(*) from public.ride_disputes where status in ('open','reviewing')) else 0 end,
    'unread_notifications', (
      select count(*) from public.notifications where user_id = v_uid and read_at is null
    )
  );
end;
$$;

grant execute on function public.admin_shell_counts() to authenticated;
