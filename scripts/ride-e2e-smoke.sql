-- End-to-end ride smoke test in a rolled-back transaction.
-- Driver: 0131ad11... (moderator) · Passenger/admin: 9716b5e8...
begin;

create temp table _smoke (
  kind text primary key,
  id uuid,
  extra jsonb not null default '{}'::jsonb
) on commit drop;

-- 1) Driver submits identity, licence, insurance and applies.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '0131ad11-bfb5-4657-b2ec-cd300e404918', 'role', 'authenticated')::text,
  true
);

insert into _smoke (kind, id)
values ('ver_identity', (public.ride_verification_submit(
  'identity', '0131ad11-bfb5-4657-b2ec-cd300e404918/identity.pdf',
  (current_date + 365)::date, '{}'::jsonb) ->> 'id')::uuid);

insert into _smoke (kind, id)
values ('ver_license', (public.ride_verification_submit(
  'driver_license', '0131ad11-bfb5-4657-b2ec-cd300e404918/licence.pdf',
  (current_date + 365)::date, '{}'::jsonb) ->> 'id')::uuid);

insert into _smoke (kind, id)
values ('ver_insurance', (public.ride_verification_submit(
  'insurance', '0131ad11-bfb5-4657-b2ec-cd300e404918/insurance.pdf',
  (current_date + 365)::date, '{}'::jsonb) ->> 'id')::uuid);

-- 2) Admin approves the three identity documents.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '9716b5e8-f794-4a79-a2f4-0d32f62a60c0', 'role', 'authenticated')::text,
  true
);

select public.ride_admin_verification_decide((select id from _smoke where kind = 'ver_identity'), true, null, (current_date + 365)::date);
select public.ride_admin_verification_decide((select id from _smoke where kind = 'ver_license'), true, null, (current_date + 365)::date);
select public.ride_admin_verification_decide((select id from _smoke where kind = 'ver_insurance'), true, null, (current_date + 365)::date);

-- 3) Driver applies, registers a vehicle and uploads its documents.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '0131ad11-bfb5-4657-b2ec-cd300e404918', 'role', 'authenticated')::text,
  true
);

select public.ride_driver_apply('Smoke test sürücüsü');

insert into _smoke (kind, id)
select 'vehicle', (public.ride_vehicle_save(jsonb_build_object(
  'make', 'Trabzone',
  'model', 'Test',
  'year', 2022,
  'color', 'Lacivert',
  'plate', '61TZ610',
  'seat_capacity', 4,
  'luggage_capacity', 'medium',
  'has_ac', true,
  'fuel_type', 'diesel',
  'accessibility', '{}'::jsonb,
  'photo_paths', '[]'::jsonb
)) ->> 'id')::uuid;

insert into _smoke (kind, id)
select 'doc_registration', (public.ride_vehicle_document_submit(
  (select id from _smoke where kind = 'vehicle'), 'registration',
  '0131ad11-bfb5-4657-b2ec-cd300e404918/registration.pdf',
  (current_date + 365)::date) ->> 'id')::uuid;

insert into _smoke (kind, id)
select 'doc_insurance', (public.ride_vehicle_document_submit(
  (select id from _smoke where kind = 'vehicle'), 'insurance',
  '0131ad11-bfb5-4657-b2ec-cd300e404918/vehicle-insurance.pdf',
  (current_date + 365)::date) ->> 'id')::uuid;

-- 4) Admin approves driver profile, documents and vehicle.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '9716b5e8-f794-4a79-a2f4-0d32f62a60c0', 'role', 'authenticated')::text,
  true
);

select public.ride_admin_driver_decide('0131ad11-bfb5-4657-b2ec-cd300e404918', true, null);
select public.ride_admin_vehicle_document_decide((select id from _smoke where kind = 'doc_registration'), true, null, (current_date + 365)::date);
select public.ride_admin_vehicle_document_decide((select id from _smoke where kind = 'doc_insurance'), true, null, (current_date + 365)::date);
select public.ride_admin_vehicle_decide((select id from _smoke where kind = 'vehicle'), true, null);

-- 5) Driver publishes an instant intracity ride.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '0131ad11-bfb5-4657-b2ec-cd300e404918', 'role', 'authenticated')::text,
  true
);

insert into _smoke (kind, id)
select 'offer', (public.ride_publish_offer(jsonb_build_object(
  'scope', 'intracity',
  'mode', 'instant',
  'origin_label', 'Meydan',
  'origin_city', 'Trabzon',
  'origin_lat', 41.0027,
  'origin_lng', 39.7168,
  'dest_label', 'KTÜ Kampüs',
  'dest_city', 'Trabzon',
  'dest_lat', 40.9955,
  'dest_lng', 39.7770,
  'depart_at', (now() + interval '10 minutes'),
  'depart_flex_minutes', 15,
  'price_per_seat_cents', 5000,
  'seats_total', 2,
  'luggage', 'medium',
  'preferences', jsonb_build_object('ac', true, 'smoking', false),
  'route_mode', 'fixed',
  'booking_mode', 'manual',
  'visibility', 'public',
  'vehicle_id', (select id from _smoke where kind = 'vehicle')
)) ->> 'id')::uuid;

-- 6) Passenger verifies identity, then finds and reserves the ride.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '9716b5e8-f794-4a79-a2f4-0d32f62a60c0', 'role', 'authenticated')::text,
  true
);

insert into _smoke (kind, id)
values ('ver_passenger', (public.ride_verification_submit(
  'identity', '9716b5e8-f794-4a79-a2f4-0d32f62a60c0/identity.pdf',
  (current_date + 365)::date, '{}'::jsonb) ->> 'id')::uuid);

select public.ride_admin_verification_decide((select id from _smoke where kind = 'ver_passenger'), true, null, (current_date + 365)::date);

insert into _smoke (kind, id, extra)
select 'reservation',
       (public.ride_reserve(
         (select id from _smoke where kind = 'offer'),
         1, 0, 1, 'cash', '[]'::jsonb, null, 'smoke-idem-1', 'Smoke test rezervasyonu'
       ) -> 'reservation' ->> 'id')::uuid,
       public.ride_search('intracity', 'all', 41.0027, 39.7168, 40.9955, 39.7770,
         'Trabzon', 'Trabzon', now(), now() + interval '2 hours', 1, null, '{}'::jsonb, 5, 0);

-- 5) Driver approves, starts, boards and alights the passenger.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '0131ad11-bfb5-4657-b2ec-cd300e404918', 'role', 'authenticated')::text,
  true
);

select public.ride_reservation_respond(
  (select id from _smoke where kind = 'reservation'), true, null);
select public.ride_offer_start((select id from _smoke where kind = 'offer'));

update _smoke
set extra = (select jsonb_build_object('boarding_code', r.boarding_code, 'alighting_code', r.alighting_code)
             from public.ride_reservations r
             where r.id = (select id from _smoke where kind = 'reservation'))
where kind = 'reservation';

select public.ride_reservation_board(
  (select id from _smoke where kind = 'reservation'),
  (select extra ->> 'boarding_code' from _smoke where kind = 'reservation')
);

select public.ride_reservation_alight(
  (select id from _smoke where kind = 'reservation'),
  (select extra ->> 'alighting_code' from _smoke where kind = 'reservation')
);

select public.ride_offer_complete((select id from _smoke where kind = 'offer'));

-- 6) Both sides review; admin analytics reflect the completed trip.
select public.ride_review_submit(
  (select id from _smoke where kind = 'reservation'), 5, 'Sorunsuz smoke test yolculuğu.', '{"comfort": 5}'::jsonb);

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '9716b5e8-f794-4a79-a2f4-0d32f62a60c0', 'role', 'authenticated')::text,
  true
);

select public.ride_review_submit(
  (select id from _smoke where kind = 'reservation'), 4, 'Temiz araç, zamanında kalkış.', '{}'::jsonb);

select public.ride_admin_analytics(7) -> 'verification_funnel' as funnel;

-- 8) Group booking, waitlist promotion and acceptance on a second ride.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '0131ad11-bfb5-4657-b2ec-cd300e404918', 'role', 'authenticated')::text,
  true
);

insert into _smoke (kind, id)
select 'offer_group', (public.ride_publish_offer(jsonb_build_object(
  'scope', 'intracity', 'mode', 'scheduled',
  'origin_label', 'Meydan', 'origin_city', 'Trabzon', 'origin_lat', 41.0027, 'origin_lng', 39.7168,
  'dest_label', 'KTÜ Kampüs', 'dest_city', 'Trabzon', 'dest_lat', 40.9955, 'dest_lng', 39.7770,
  'depart_at', (now() + interval '20 minutes'), 'depart_flex_minutes', 10,
  'price_per_seat_cents', 4000, 'seats_total', 3, 'luggage', 'medium',
  'preferences', '{}'::jsonb, 'route_mode', 'fixed', 'booking_mode', 'manual', 'visibility', 'public',
  'vehicle_id', (select id from _smoke where kind = 'vehicle')
)) ->> 'id')::uuid;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '9716b5e8-f794-4a79-a2f4-0d32f62a60c0', 'role', 'authenticated')::text,
  true
);

insert into _smoke (kind, id)
select 'reservation_group', (public.ride_reserve(
  (select id from _smoke where kind = 'offer_group'), 3, 0, 1, 'cash',
  '[{"full_name":"Smoke Yolcu A"},{"full_name":"Smoke Yolcu B"},{"full_name":"Smoke Yolcu C"}]'::jsonb,
  array[1,2,3], 'smoke-group-1', 'Grup smoke testi'
) -> 'reservation' ->> 'id')::uuid;

-- Third user verifies, then joins the waitlist because the ride is full.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', 'f7551258-be57-489b-9551-4ad1e4bf7e9c', 'role', 'authenticated')::text,
  true
);

insert into _smoke (kind, id)
values ('ver_waiter', (public.ride_verification_submit(
  'identity', 'f7551258-be57-489b-9551-4ad1e4bf7e9c/identity.pdf',
  (current_date + 365)::date, '{}'::jsonb) ->> 'id')::uuid);

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '9716b5e8-f794-4a79-a2f4-0d32f62a60c0', 'role', 'authenticated')::text,
  true
);
select public.ride_admin_verification_decide((select id from _smoke where kind = 'ver_waiter'), true, null, (current_date + 365)::date);

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', 'f7551258-be57-489b-9551-4ad1e4bf7e9c', 'role', 'authenticated')::text,
  true
);

select public.ride_waitlist_join((select id from _smoke where kind = 'offer_group'), 1, 0, 1);

-- Passenger releases one seat; the waiting user receives a timed offer and accepts it.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '9716b5e8-f794-4a79-a2f4-0d32f62a60c0', 'role', 'authenticated')::text,
  true
);
select public.ride_reservation_cancel((select id from _smoke where kind = 'reservation_group'), 'Smoke test grup iptali');

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', 'f7551258-be57-489b-9551-4ad1e4bf7e9c', 'role', 'authenticated')::text,
  true
);

select public.ride_waitlist_accept((
  select o.id from public.ride_waitlist_offers o
  join public.ride_waitlists w on w.id = o.waitlist_id
  where w.offer_id = (select id from _smoke where kind = 'offer_group')
    and w.user_id = 'f7551258-be57-489b-9551-4ad1e4bf7e9c'
  order by o.created_at desc limit 1
));

-- 9) Assertions: final statuses and seat release.
select
  r.status as reservation_status,
  r.payment_status,
  r.boarded_at is not null as boarded,
  r.alighted_at is not null as alighted,
  o.status as offer_status,
  o.completed_at is not null as offer_completed,
  (select count(*) from public.ride_seat_allocations a
    where a.reservation_id = r.id and a.status = 'released') as released_allocations,
  (select count(*) from public.ride_reviews v where v.reservation_id = r.id) as review_count,
  (select count(*) from public.ride_audit_logs l
    where l.entity_id in (r.id::text, o.id::text) or l.actor_id in (
      '0131ad11-bfb5-4657-b2ec-cd300e404918'::uuid,
      '9716b5e8-f794-4a79-a2f4-0d32f62a60c0'::uuid
    )) as audit_rows,
  (select count(*) from public.ride_reservation_passengers rp
    where rp.reservation_id = (select id from _smoke where kind = 'reservation_group')) as group_passengers,
  (select r2.status from public.ride_reservations r2
    where r2.id = (select id from _smoke where kind = 'reservation_group')) as group_status,
  (select count(*) from public.ride_seat_allocations a
    where a.reservation_id = (select id from _smoke where kind = 'reservation_group') and a.status = 'released') as group_released_seats,
  (select w.status from public.ride_waitlists w
    where w.offer_id = (select id from _smoke where kind = 'offer_group')
      and w.user_id = 'f7551258-be57-489b-9551-4ad1e4bf7e9c') as waitlist_status,
  (select o.status from public.ride_waitlist_offers o
    join public.ride_waitlists w on w.id = o.waitlist_id
    where w.offer_id = (select id from _smoke where kind = 'offer_group')) as waitlist_offer_status,
  (select count(*) from public.ride_reservations wr
    where wr.offer_id = (select id from _smoke where kind = 'offer_group')
      and wr.passenger_id = 'f7551258-be57-489b-9551-4ad1e4bf7e9c') as waitlist_reservations,
  (select count(*) from _smoke) as steps
from public.ride_reservations r
join public.ride_offers o on o.id = r.offer_id
where r.id = (select id from _smoke where kind = 'reservation');

rollback;
