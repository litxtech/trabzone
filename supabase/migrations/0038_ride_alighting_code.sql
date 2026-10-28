-- ---------------------------------------------------------------------
-- 0038 — Yolculuk: iniş doğrulama kodunun taraflara gösterilmesi
-- Yolcu iniş kodunu sürücüye söyler; sürücü kodu girerek inişi doğrular.
-- Kod yalnızca rezervasyonun iki tarafına döner.
-- ---------------------------------------------------------------------
create or replace function public.ride_reservation_json(p_reservation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
    'pickup_seq', r.pickup_seq,
    'dropoff_seq', r.dropoff_seq,
    'boarding_code', case when o.driver_id = auth.uid() or r.passenger_id = auth.uid() then r.boarding_code else null end,
    'alighting_code', case when o.driver_id = auth.uid() or r.passenger_id = auth.uid() then r.alighting_code else null end,
    'hold_expires_at', r.hold_expires_at,
    'created_at', r.created_at,
    'started_at', r.started_at,
    'boarded_at', r.boarded_at,
    'alighted_at', r.alighted_at,
    'completed_at', r.completed_at,
    'cancelled_at', r.cancelled_at,
    'cancel_reason', r.cancel_reason,
    'note', r.note,
    'policy_version', r.policy_version,
    'offer_id', o.id,
    'offer_status', o.status,
    'scope', o.scope,
    'mode', o.mode,
    'origin_label', o.origin_label,
    'dest_label', o.dest_label,
    'origin_city', o.origin_city,
    'dest_city', o.dest_city,
    'depart_at', o.depart_at,
    'price_per_seat_cents', o.price_per_seat_cents,
    'driver_id', o.driver_id,
    'driver_username', dp.username,
    'driver_first_name', dp.first_name,
    'driver_avatar_path', dp.avatar_path,
    'driver_verified', dp.is_verified,
    'driver_level', m.level,
    'driver_rating', m.rating_avg,
    'driver_trips', m.completed_trips,
    'vehicle', jsonb_build_object(
      'make', v.make, 'model', v.model, 'year', v.year,
      'color', v.color, 'plate', v.plate, 'has_ac', v.has_ac,
      'accessibility', v.accessibility
    ),
    'passenger_id', r.passenger_id,
    'passenger_username', pp.username,
    'passenger_first_name', pp.first_name,
    'passenger_avatar_path', pp.avatar_path,
    'passengers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rp.id, 'full_name', rp.full_name, 'seat_no', rp.seat_no,
        'is_primary', rp.is_primary, 'boarded_at', rp.boarded_at, 'alighted_at', rp.alighted_at
      ) order by rp.seat_no)
      from public.ride_reservation_passengers rp where rp.reservation_id = r.id
    ), '[]'::jsonb),
    'seats_detail', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seat_no', a.seat_no, 'from_seq', a.from_seq, 'to_seq', a.to_seq, 'status', a.status
      ) order by a.seat_no)
      from public.ride_seat_allocations a
      where a.reservation_id = r.id and a.status in ('held','confirmed')
    ), '[]'::jsonb),
    'has_reviewed', exists (
      select 1 from public.ride_reviews rv
      where rv.reservation_id = r.id and rv.author_id = auth.uid()
    )
  )
  from public.ride_reservations r
  join public.ride_offers o on o.id = r.offer_id
  join public.ride_vehicles v on v.id = o.vehicle_id
  join public.profiles dp on dp.id = o.driver_id
  join public.ride_member_profiles m on m.user_id = o.driver_id
  join public.profiles pp on pp.id = r.passenger_id
  where r.id = p_reservation_id
$$;

revoke all on function public.ride_reservation_json(uuid) from public, anon, authenticated;
