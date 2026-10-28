-- 0088 · İlan ve arama yanıtlarına kimlik doğrulama bayrağı
--
-- Sürücü kartlarındaki mavi tik `profiles.is_verified` (genel sosyal rozet)
-- alanından geliyordu. Yolculuk kimliğini doğrulayan kullanıcı, sosyal rozeti
-- olmadığı için "doğrulanmamış" görünüyordu. Artık yolculuk kimliği ayrı bir
-- alan olarak dönüyor: `identity_verified`.
--
-- `ride_reservation_json` 0087'de güncellendi; yolculuk detayı oradan beslenir.

create or replace function public.ride_offer_detail(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_is_driver boolean;
  v_is_participant boolean;
  v_offer public.ride_offers%rowtype;
  v_m public.ride_member_profiles%rowtype;
  v_vehicle public.ride_vehicles%rowtype;
  v_driver public.profiles%rowtype;
  v_reservation_id uuid;
  v_reservation_status text;
begin
  select * into v_offer from public.ride_offers where id = p_offer_id;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;

  v_is_driver := v_offer.driver_id = v_uid;
  v_is_participant := public.ride_is_participant(p_offer_id, v_uid);

  if v_offer.visibility = 'private' and not v_is_participant then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;
  if v_offer.visibility = 'friends' and not v_is_participant and v_offer.driver_id <> v_uid then
    if not exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted'
        and ((f.sender_id = v_uid and f.receiver_id = v_offer.driver_id)
          or (f.receiver_id = v_uid and f.sender_id = v_offer.driver_id))
    ) then
      raise exception 'offer_not_found' using errcode = 'P0002';
    end if;
  end if;

  select * into v_m from public.ride_member_profiles where user_id = v_offer.driver_id;
  select * into v_vehicle from public.ride_vehicles where id = v_offer.vehicle_id;
  select * into v_driver from public.profiles where id = v_offer.driver_id;

  select r.id, r.status into v_reservation_id, v_reservation_status
  from public.ride_reservations r
  where r.offer_id = p_offer_id and r.passenger_id = v_uid
  order by r.created_at desc limit 1;

  return jsonb_build_object(
    'id', v_offer.id,
    'scope', v_offer.scope,
    'mode', v_offer.mode,
    'status', v_offer.status,
    'origin_label', v_offer.origin_label,
    'origin_address', case when v_is_participant then v_offer.origin_address else null end,
    'origin_city', v_offer.origin_city,
    'origin_district', v_offer.origin_district,
    'origin_lat', case when v_is_participant then v_offer.origin_lat else round(v_offer.origin_lat::numeric, 3)::double precision end,
    'origin_lng', case when v_is_participant then v_offer.origin_lng else round(v_offer.origin_lng::numeric, 3)::double precision end,
    'dest_label', v_offer.dest_label,
    'dest_address', case when v_is_participant then v_offer.dest_address else null end,
    'dest_city', v_offer.dest_city,
    'dest_district', v_offer.dest_district,
    'dest_lat', case when v_is_participant then v_offer.dest_lat else round(v_offer.dest_lat::numeric, 3)::double precision end,
    'dest_lng', case when v_is_participant then v_offer.dest_lng else round(v_offer.dest_lng::numeric, 3)::double precision end,
    'depart_at', v_offer.depart_at,
    'depart_flex_minutes', v_offer.depart_flex_minutes,
    'duration_minutes', v_offer.duration_minutes,
    'distance_meters', v_offer.distance_meters,
    'price_per_seat_cents', v_offer.price_per_seat_cents,
    'currency', v_offer.currency,
    'seats_total', v_offer.seats_total,
    'luggage', v_offer.luggage,
    'preferences', v_offer.preferences,
    'route_mode', v_offer.route_mode,
    'max_detour_meters', v_offer.max_detour_meters,
    'max_detour_minutes', v_offer.max_detour_minutes,
    'booking_mode', v_offer.booking_mode,
    'visibility', v_offer.visibility,
    'notes', v_offer.notes,
    'policy_version', v_offer.policy_version,
    'is_driver', v_is_driver,
    'is_participant', v_is_participant,
    'my_reservation_id', v_reservation_id,
    'my_reservation_status', v_reservation_status,
    'driver', jsonb_build_object(
      'id', v_driver.id,
      'username', v_driver.username,
      'first_name', v_driver.first_name,
      'avatar_path', v_driver.avatar_path,
      'is_verified', v_driver.is_verified,
      'identity_verified', public.ride_identity_verified(v_offer.driver_id),
      'bio', v_m.driver_bio,
      'level', v_m.level,
      'rating_avg', v_m.rating_avg,
      'review_count', v_m.review_count,
      'completed_trips', v_m.completed_trips
    ),
    'vehicle', jsonb_build_object(
      'id', v_vehicle.id, 'make', v_vehicle.make, 'model', v_vehicle.model,
      'year', v_vehicle.year, 'color', v_vehicle.color, 'plate', v_vehicle.plate,
      'seat_capacity', v_vehicle.seat_capacity, 'luggage_capacity', v_vehicle.luggage_capacity,
      'has_ac', v_vehicle.has_ac, 'fuel_type', v_vehicle.fuel_type,
      'accessibility', v_vehicle.accessibility, 'photo_paths', v_vehicle.photo_paths
    ),
    'stops', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'seq', s.seq, 'kind', s.kind, 'label', s.label,
        'city', s.city, 'district', s.district,
        'lat', case when v_is_participant then s.lat else null end,
        'lng', case when v_is_participant then s.lng else null end,
        'arrive_offset_minutes', s.arrive_offset_minutes,
        'is_public', s.is_public
      ) order by s.seq)
      from public.ride_offer_stops s where s.offer_id = v_offer.id and (s.is_public or v_is_participant)
    ), '[]'::jsonb),
    'availability', public.ride_offer_availability(v_offer.id),
    'policy', public.ride_policy(),
    'waitlist', (
      select jsonb_build_object('id', w.id, 'status', w.status, 'position', (
        select count(*) + 1 from public.ride_waitlists w2
        where w2.offer_id = w.offer_id and w2.status = 'waiting' and w2.created_at < w.created_at
      ))
      from public.ride_waitlists w
      where w.offer_id = v_offer.id and w.user_id = v_uid and w.status in ('waiting','offered')
      limit 1
    )
  );
end;
$$;

grant execute on function public.ride_offer_detail(uuid) to authenticated;

create or replace function public.ride_search(
  p_scope text default null,
  p_mode text default null,
  p_origin_lat double precision default null,
  p_origin_lng double precision default null,
  p_dest_lat double precision default null,
  p_dest_lng double precision default null,
  p_origin_city text default null,
  p_dest_city text default null,
  p_depart_from timestamptz default null,
  p_depart_to timestamptz default null,
  p_seats int default 1,
  p_max_price_cents int default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total int;
begin
  with candidates as (
    select
      o.*,
      public.ride_haversine_m(p_origin_lat, p_origin_lng, o.origin_lat, o.origin_lng) as pickup_m,
      public.ride_haversine_m(p_dest_lat, p_dest_lng, o.dest_lat, o.dest_lng) as dropoff_m,
      abs(extract(epoch from (o.depart_at - coalesce(p_depart_from, o.depart_at))) / 60)::int as time_delta_min,
      (select count(distinct a.seat_no)
         from public.ride_seat_allocations a
        where a.offer_id = o.id and a.status in ('held','confirmed')) as occupied_seats
    from public.ride_offers o
    where o.status in ('published','full')
      and o.depart_at >= now() - interval '5 minutes'
      and (p_scope is null or p_scope = 'all' or o.scope = p_scope)
      and (p_mode is null or p_mode = 'all' or o.mode = p_mode)
      and (p_depart_from is null or o.depart_at >= p_depart_from - make_interval(mins => o.depart_flex_minutes))
      and (p_depart_to is null or o.depart_at <= p_depart_to + make_interval(mins => o.depart_flex_minutes))
      and (p_origin_city is null or o.origin_city ilike '%' || p_origin_city || '%')
      and (p_dest_city is null or o.dest_city ilike '%' || p_dest_city || '%')
      and (p_max_price_cents is null or o.price_per_seat_cents <= p_max_price_cents)
      and (
        o.visibility = 'public'
        or o.driver_id = v_uid
        or (o.visibility = 'friends' and exists (
          select 1 from public.friend_requests f
          where f.status = 'accepted'
            and ((f.sender_id = v_uid and f.receiver_id = o.driver_id)
              or (f.receiver_id = v_uid and f.sender_id = o.driver_id))
        ))
      )
      and ((p_filters->>'has_ac')::boolean is not true or o.preferences->>'ac' = 'true')
      and ((p_filters->>'no_smoking')::boolean is not true or coalesce((o.preferences->>'smoking')::boolean, false) = false)
      and ((p_filters->>'women_only')::boolean is not true or o.preferences->>'women_only' = 'true')
      and ((p_filters->>'accessible')::boolean is not true or coalesce((o.preferences->>'accessible_required')::boolean, false))
      and (
        o.driver_id = v_uid
        or public.ride_has_available_seats(o.id, 0, (select coalesce(max(seq),1) from public.ride_offer_stops s where s.offer_id = o.id), p_seats)
      )
  ), scored as (
    select c.*,
      case
        when c.pickup_m is null and c.dropoff_m is null then null
        else coalesce(c.pickup_m, 0) + coalesce(c.dropoff_m, 0)
      end as detour_m,
      v_m.level,
      v_m.rating_avg,
      v_m.completed_trips,
      public.ride_identity_verified(c.driver_id) as identity_verified,
      case
        when c.pickup_m is null and c.dropoff_m is null then null
        else greatest(0, 100
          - least(coalesce(c.pickup_m, 0) / 1000 * 2, 35)
          - least(coalesce(c.dropoff_m, 0) / 1000 * 2, 35)
          - least(c.time_delta_min / 6.0, 20)
          + case v_m.level when 'platinum' then 8 when 'gold' then 6 when 'silver' then 4 else 2 end
          + coalesce(v_m.rating_avg, 0) * 2)
      end as score
    from candidates c
    left join public.ride_member_profiles v_m on v_m.user_id = c.driver_id
  )
  select coalesce(jsonb_agg(item order by (item->>'score')::numeric desc nulls last, (item->>'depart_at')), '[]'::jsonb),
         count(*)
  into v_items, v_total
  from (
    select jsonb_build_object(
      'id', s.id,
      'scope', s.scope,
      'mode', s.mode,
      'status', s.status,
      'origin_label', s.origin_label,
      'origin_city', s.origin_city,
      'origin_district', s.origin_district,
      'dest_label', s.dest_label,
      'dest_city', s.dest_city,
      'dest_district', s.dest_district,
      'depart_at', s.depart_at,
      'depart_flex_minutes', s.depart_flex_minutes,
      'duration_minutes', s.duration_minutes,
      'distance_meters', s.distance_meters,
      'price_per_seat_cents', s.price_per_seat_cents,
      'currency', s.currency,
      'seats_total', s.seats_total,
      'seats_available', s.seats_total - s.occupied_seats,
      'luggage', s.luggage,
      'preferences', s.preferences,
      'route_mode', s.route_mode,
      'booking_mode', s.booking_mode,
      'visibility', s.visibility,
      'driver', jsonb_build_object(
        'id', d.id,
        'username', d.username,
        'first_name', d.first_name,
        'avatar_path', d.avatar_path,
        'is_verified', d.is_verified,
        'identity_verified', s.identity_verified,
        'level', s.level,
        'rating_avg', s.rating_avg,
        'completed_trips', s.completed_trips
      ),
      'vehicle', jsonb_build_object(
        'make', v.make, 'model', v.model, 'year', v.year,
        'color', v.color, 'has_ac', v.has_ac, 'accessibility', v.accessibility
      ),
      'match', jsonb_build_object(
        'score', round(s.score),
        'pickup_distance_m', round(s.pickup_m),
        'dropoff_distance_m', round(s.dropoff_m),
        'approx_detour_m', round(s.detour_m),
        'time_delta_min', s.time_delta_min,
        'reasons', jsonb_build_array(
          case when s.time_delta_min <= 30 then 'Kalkış saatine çok yakın' else 'Kalkış saati esnek' end,
          case when coalesce(s.pickup_m, 0) <= 3000 then 'Biniş noktasına yakın' else 'Biniş noktası sürüş mesafesinde' end,
          case when coalesce(s.detour_m, 0) <= 10000 then 'Düşük güzergâh sapması' else 'Sapma mesafesi hesaplandı' end,
          case when s.level in ('gold','platinum') then 'Yüksek güvenilirlik seviyesi' else 'Doğrulanmış üye' end
        )
      )
    ) as item
    from scored s
    join public.profiles d on d.id = s.driver_id
    join public.ride_vehicles v on v.id = s.vehicle_id
    where (p_filters->>'min_rating')::numeric is null
       or coalesce(s.rating_avg, 0) >= (p_filters->>'min_rating')::numeric
    order by (case when s.score is null then 0 else s.score end) desc, s.depart_at
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'map_available', false,
    'map_note', 'Harita görünümü için EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN yapılandırılmalı. Mesafeler koordinat varsa kuş uçuşu hesaplanır.'
  );
end;
$$;

grant execute on function public.ride_search(text, text, double precision, double precision, double precision, double precision, text, text, timestamptz, timestamptz, int, int, jsonb, int, int) to authenticated;
