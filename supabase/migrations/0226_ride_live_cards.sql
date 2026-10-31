-- =====================================================================
-- 0226 — Yolculuk ilanlarında canlı kart verisi
--
-- 1) `ride_search` kartların ihtiyaç duyduğu ek alanları döndürür:
--      * ilanın yayınlanma zamanı (created_at / published_at)
--      * kullanıcının bu ilandaki aktif rezervasyonu
--      * aracın kapasitesi, yakıtı, bagajı ve onay durumu
--      * sürücünün değerlendirme sayısı
--    Yeni alanlar salt ek bilgidir; mevcut istemciler etkilenmez.
--
-- 2) `ride_offers`, `ride_reservations` ve `ride_seat_allocations`
--    değiştiğinde `ride-offers` broadcast kanalına küçük bir patch yayınlanır.
--    Patch yalnızca herkese açık ilanlar için ve kişisel veri içermeden
--    gönderilir: ilan kimliği, durum, koltuk sayıları, kalkış zamanı.
--
--    Kanal süreç başına bir kez dinlenir; kartlar tam yeniden yüklenmeden
--    yalnızca değişen alanları günceller.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. Arama RPC'si — kart alanları
-- ---------------------------------------------------------------------
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
        where a.offer_id = o.id and a.status in ('held','confirmed')) as occupied_seats,
      my_r.id as my_reservation_id,
      my_r.status as my_reservation_status
    from public.ride_offers o
    left join lateral (
      select r.id, r.status
        from public.ride_reservations r
       where r.offer_id = o.id
         and r.passenger_id = v_uid
         and r.status in ('requested','awaiting_approval','confirmed','started')
       order by r.created_at desc
       limit 1
    ) my_r on true
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
      v_m.review_count,
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
      'created_at', s.created_at,
      'published_at', s.published_at,
      'my_reservation_id', s.my_reservation_id,
      'my_reservation_status', s.my_reservation_status,
      'driver', jsonb_build_object(
        'id', d.id,
        'username', d.username,
        'first_name', d.first_name,
        'avatar_path', d.avatar_path,
        'is_verified', d.is_verified,
        'identity_verified', s.identity_verified,
        'level', s.level,
        'rating_avg', s.rating_avg,
        'review_count', s.review_count,
        'completed_trips', s.completed_trips
      ),
      'vehicle', jsonb_build_object(
        'id', v.id,
        'make', v.make, 'model', v.model, 'year', v.year,
        'color', v.color, 'has_ac', v.has_ac,
        'accessibility', v.accessibility,
        -- Kartta araç görseli gösterilir; yalnızca zaten herkese açık
        -- fotoğraf yolları döner.
        'photo_paths', v.photo_paths,
        'seat_capacity', v.seat_capacity,
        'luggage_capacity', v.luggage_capacity,
        'fuel_type', v.fuel_type,
        'verified', v.status = 'approved'
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

-- ---------------------------------------------------------------------
-- 2. Canlı ilan patch'i
-- ---------------------------------------------------------------------
create or replace function public.ride_offer_patch(p_offer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'offer_id', o.id,
    'status', o.status,
    'seats_total', o.seats_total,
    'seats_available', greatest(
      0,
      o.seats_total - coalesce((
        select count(distinct a.seat_no)
          from public.ride_seat_allocations a
         where a.offer_id = o.id and a.status in ('held','confirmed')
      ), 0)
    ),
    'depart_at', o.depart_at,
    'visibility', o.visibility,
    'updated_at', now()
  )
  from public.ride_offers o
  where o.id = p_offer_id
$$;

revoke all on function public.ride_offer_patch(uuid) from public, anon, authenticated;

/**
 * Herkese açık ilanın canlı patch'ini `ride-offers` kanalına yollar.
 * Özel/arkadaş ilanları yayınlanmaz; onlar RPC polling ile tazelenir.
 */
create or replace function public.ride_offer_broadcast(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb;
begin
  v_patch := public.ride_offer_patch(p_offer_id);
  if v_patch is null or v_patch->>'visibility' is distinct from 'public' then
    return;
  end if;
  perform realtime.send(v_patch, 'ride_offer_changed', 'ride-offers', false);
end;
$$;

revoke all on function public.ride_offer_broadcast(uuid) from public, anon, authenticated;

create or replace function public.ride_offers_live_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.visibility = 'public' then
      perform realtime.send(
        jsonb_build_object(
          'offer_id', old.id,
          'status', 'cancelled',
          'seats_total', old.seats_total,
          'seats_available', 0,
          'depart_at', old.depart_at,
          'visibility', old.visibility,
          'updated_at', now()
        ),
        'ride_offer_changed',
        'ride-offers',
        false
      );
    end if;
    return old;
  end if;

  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.seats_total is distinct from old.seats_total
     or new.depart_at is distinct from old.depart_at
     or new.visibility is distinct from old.visibility then
    perform public.ride_offer_broadcast(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.ride_offers_live_tg() from public, anon, authenticated;

drop trigger if exists ride_offers_live on public.ride_offers;
create trigger ride_offers_live
  after insert or update or delete on public.ride_offers
  for each row execute function public.ride_offers_live_tg();

create or replace function public.ride_reservations_live_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.ride_offer_broadcast(old.offer_id);
    return old;
  end if;
  perform public.ride_offer_broadcast(new.offer_id);
  return new;
end;
$$;

revoke all on function public.ride_reservations_live_tg() from public, anon, authenticated;

drop trigger if exists ride_reservations_live on public.ride_reservations;
create trigger ride_reservations_live
  after insert or update or delete on public.ride_reservations
  for each row execute function public.ride_reservations_live_tg();

create or replace function public.ride_allocations_live_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.ride_offer_broadcast(old.offer_id);
    return old;
  end if;
  perform public.ride_offer_broadcast(new.offer_id);
  return new;
end;
$$;

revoke all on function public.ride_allocations_live_tg() from public, anon, authenticated;

drop trigger if exists ride_allocations_live on public.ride_seat_allocations;
create trigger ride_allocations_live
  after insert or update or delete on public.ride_seat_allocations
  for each row execute function public.ride_allocations_live_tg();
