-- ---------------------------------------------------------------------
-- 0037 — Yolculuk: bekleme listesi teklifleri ve genel yapılandırma
-- ---------------------------------------------------------------------

-- Kullanıcının süresi dolmamış bekleme listesi tekliflerini listeler.
create or replace function public.ride_my_waitlist_offers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', wo.id,
    'offer_id', wo.offer_id,
    'waitlist_id', wo.waitlist_id,
    'expires_at', wo.expires_at,
    'seats', w.seats,
    'pickup_seq', w.pickup_seq,
    'dropoff_seq', w.dropoff_seq,
    'offer', jsonb_build_object(
      'id', o.id,
      'origin_label', o.origin_label,
      'origin_city', o.origin_city,
      'dest_label', o.dest_label,
      'dest_city', o.dest_city,
      'depart_at', o.depart_at,
      'duration_minutes', o.duration_minutes,
      'distance_meters', o.distance_meters,
      'price_per_seat_cents', o.price_per_seat_cents,
      'currency', o.currency,
      'seats_total', o.seats_total,
      'scope', o.scope,
      'status', o.status
    )
  ) order by wo.expires_at), '[]'::jsonb)
  into v_items
  from public.ride_waitlist_offers wo
  join public.ride_waitlists w on w.id = wo.waitlist_id
  join public.ride_offers o on o.id = wo.offer_id
  where w.user_id = v_uid
    and wo.status = 'offered'
    and wo.expires_at > now();

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.ride_my_waitlist_offers() from public, anon;
grant execute on function public.ride_my_waitlist_offers() to authenticated;

-- Kartlı ödemenin kullanılabilir olup olmadığını istemciye sade bir uçla bildir.
create or replace function public.ride_public_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'card_payments_enabled', public.ride_card_payments_enabled(),
    'commercial_mode_enabled', coalesce(
      (select (value #>> '{}')::boolean from public.app_settings where key = 'ride.commercial_enabled'),
      false
    ),
    'currency', 'TRY'
  );
$$;

revoke all on function public.ride_public_config() from public, anon;
grant execute on function public.ride_public_config() to authenticated;
