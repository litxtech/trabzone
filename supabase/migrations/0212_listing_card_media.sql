-- =====================================================================
-- 0212 — İlan kartlarında kimlik ve görsel verisi
--
-- Yolculuk ve emlak liste kartları artık ilanı paylaşan kişiyi ve ilan
-- görsellerini kart üzerinde gösteriyor. Liste RPC'leri bu kartların
-- ihtiyaç duyduğu alanları döndürür:
--
--   * ride_search : aracın onaylı fotoğraf yolları (photo_paths)
--   * re_list     : ilan sahibi özeti + onaylı fotoğraf yolları ve sayısı
--
-- Yeni alanlar salt ek bilgi; mevcut istemciler etkilenmez.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Yolculuk araması — araç fotoğrafları
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
        'id', v.id,
        'make', v.make, 'model', v.model, 'year', v.year,
        'color', v.color, 'has_ac', v.has_ac,
        'accessibility', v.accessibility,
        -- Kartta araç görseli gösterilir; yalnızca zaten herkese açık
        -- fotoğraf yolları döner.
        'photo_paths', v.photo_paths
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
-- Emlak listesi — ilan sahibi ve fotoğraflar
-- ---------------------------------------------------------------------
create or replace function public.re_list(
  p_listing_kind text default null,
  p_category text default null,
  p_district_id bigint default null,
  p_neighborhood_id bigint default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_m2 integer default null,
  p_max_m2 integer default null,
  p_rooms smallint default null,
  p_max_building_age integer default null,
  p_owner_type text default null,
  p_sort text default 'new',
  p_query text default null,
  p_favorites boolean default false,
  p_mine boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'new'));
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total bigint;
begin
  select count(*)
  into v_total
  from public.real_estate_listings l
  join public.real_estate_categories c on c.id = l.category_id
  where (
      case
        when p_mine then l.owner_id = v_uid
        when p_favorites then exists (
          select 1 from public.real_estate_favorites f
          where f.listing_id = l.id and f.user_id = v_uid
        )
        else l.status = 'published'
      end
    )
    and (p_listing_kind is null or l.listing_kind = p_listing_kind)
    and (p_category is null or c.slug = p_category)
    and (p_district_id is null or l.district_id = p_district_id)
    and (p_neighborhood_id is null or l.neighborhood_id = p_neighborhood_id)
    and (p_min_price is null or l.price_cents >= (p_min_price * 100)::bigint)
    and (p_max_price is null or l.price_cents <= (p_max_price * 100)::bigint)
    and (p_min_m2 is null or coalesce(l.net_m2, l.gross_m2, 0) >= p_min_m2)
    and (p_max_m2 is null or coalesce(l.net_m2, l.gross_m2, 0) <= p_max_m2)
    and (p_rooms is null or l.room_count = p_rooms)
    and (p_max_building_age is null or l.building_age is null or l.building_age <= p_max_building_age)
    and (p_owner_type is null or l.owner_type = p_owner_type)
    and (
      v_query is null
      or l.title ilike '%' || v_query || '%'
      or coalesce(l.description, '') ilike '%' || v_query || '%'
      or l.id::text ilike v_query || '%'
    );

  select coalesce(jsonb_agg(item order by
      case when v_sort = 'price_asc' then price_sort end asc nulls last,
      case when v_sort = 'price_desc' then price_sort end desc nulls last,
      case when v_sort = 'popular' then view_sort end desc nulls last,
      case when v_sort = 'new' then new_sort end desc nulls last
    ), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', l.id,
      'title', l.title,
      'price_cents', l.price_cents,
      'currency', l.currency,
      'price_period', l.price_period,
      'listing_kind', l.listing_kind,
      'owner_type', l.owner_type,
      'status', l.status,
      'verification_status', l.verification_status,
      'category_slug', c.slug,
      'category_name', c.name,
      'lat', l.public_lat,
      'lng', l.public_lng,
      'gross_m2', l.gross_m2,
      'net_m2', l.net_m2,
      'room_count', l.room_count,
      'building_age', l.building_age,
      'floor_no', l.floor_no,
      'district', d.name,
      'neighborhood', n.name,
      'district_id', l.district_id,
      'neighborhood_id', l.neighborhood_id,
      'cover_path', (
        select m.storage_path from public.real_estate_media m
        where m.listing_id = l.id and m.status = 'approved'
        order by m.cover desc, m.sort_order limit 1
      ),
      -- Kartta küçük bir fotoğraf şeridi ve "N fotoğraf" etiketi için
      -- onaylı görsellerin ilk dördü yeterli.
      'photos', coalesce((
        select jsonb_agg(x.storage_path order by x.cover desc, x.sort_order, x.created_at)
        from (
          select m.storage_path, m.cover, m.sort_order, m.created_at
          from public.real_estate_media m
          where m.listing_id = l.id and m.kind = 'image' and m.status = 'approved'
          order by m.cover desc, m.sort_order, m.created_at
          limit 4
        ) x
      ), '[]'::jsonb),
      'photo_count', (
        select count(*) from public.real_estate_media m
        where m.listing_id = l.id and m.kind = 'image' and m.status = 'approved'
      ),
      'owner', case when p.id is null then null else jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
        'avatar_path', p.avatar_path,
        'is_verified', p.is_verified
      ) end,
      'is_favorite', exists (
        select 1 from public.real_estate_favorites f
        where f.listing_id = l.id and f.user_id = v_uid
      ),
      'is_mine', l.owner_id = v_uid,
      'published_at', l.published_at,
      'created_at', l.created_at
    ) as item,
    l.price_cents as price_sort,
    l.view_count as view_sort,
    extract(epoch from coalesce(l.published_at, l.created_at)) as new_sort
    from public.real_estate_listings l
    join public.real_estate_categories c on c.id = l.category_id
    left join public.districts d on d.id = l.district_id
    left join public.neighborhoods n on n.id = l.neighborhood_id
    left join public.profiles p on p.id = l.owner_id
    where (
        case
          when p_mine then l.owner_id = v_uid
          when p_favorites then exists (
            select 1 from public.real_estate_favorites f
            where f.listing_id = l.id and f.user_id = v_uid
          )
          else l.status = 'published'
        end
      )
      and (p_listing_kind is null or l.listing_kind = p_listing_kind)
      and (p_category is null or c.slug = p_category)
      and (p_district_id is null or l.district_id = p_district_id)
      and (p_neighborhood_id is null or l.neighborhood_id = p_neighborhood_id)
      and (p_min_price is null or l.price_cents >= (p_min_price * 100)::bigint)
      and (p_max_price is null or l.price_cents <= (p_max_price * 100)::bigint)
      and (p_min_m2 is null or coalesce(l.net_m2, l.gross_m2, 0) >= p_min_m2)
      and (p_max_m2 is null or coalesce(l.net_m2, l.gross_m2, 0) <= p_max_m2)
      and (p_rooms is null or l.room_count = p_rooms)
      and (p_max_building_age is null or l.building_age is null or l.building_age <= p_max_building_age)
      and (p_owner_type is null or l.owner_type = p_owner_type)
      and (
        v_query is null
        or l.title ilike '%' || v_query || '%'
        or coalesce(l.description, '') ilike '%' || v_query || '%'
        or l.id::text ilike v_query || '%'
      )
    order by coalesce(l.published_at, l.created_at) desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.re_list(text, text, bigint, bigint, numeric, numeric, integer, integer, smallint, integer, text, text, text, boolean, boolean, integer, integer) from public, anon;
grant execute on function public.re_list(text, text, bigint, bigint, numeric, numeric, integer, integer, smallint, integer, text, text, text, boolean, boolean, integer, integer) to authenticated, service_role;
