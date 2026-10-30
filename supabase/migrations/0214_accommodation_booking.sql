-- =====================================================================
-- 0214 — Konaklama rezervasyon motoru
--
-- * Herkese açık arama ve tesis detayı
-- * Tarih bazlı fiyat/müsaitlik hesaplama (kampanyalar dahil)
-- * Atomik rezervasyon oluşturma (anında / manuel onay)
-- * Misafirin kendi rezervasyonlarını görme ve iptal etmesi
--
-- Fiyatlar her zaman gecelik olarak hesaplanır. Onaylanmış eski bir
-- rezervasyonun fiyatı, takvim sonradan değişse bile korunur; toplam
-- rezervasyon satırında saklanır.
-- =====================================================================

set search_path = public, extensions;

alter table public.acc_reservations
  add column if not exists campaign_id uuid references public.acc_campaigns(id) on delete set null;

-- ---------------------------------------------------------------------
-- Süresi dolan manuel onay bekleyen rezervasyonları serbest bırakır.
-- ---------------------------------------------------------------------
create or replace function public.acc_expire_holds(p_property_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    update public.acc_reservations
       set status = 'expired', room_id = null
     where status = 'pending'
       and hold_expires_at is not null
       and hold_expires_at < now()
       and (p_property_id is null or property_id = p_property_id)
    returning id, property_id
  loop
    insert into public.acc_reservation_status_history
      (reservation_id, from_status, to_status, note)
    values (r.id, 'pending', 'expired', 'Onay süresi doldu; oda stoğa iade edildi.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Oda tipi müsaitliği
-- ---------------------------------------------------------------------
create or replace function public.acc_room_type_available(
  p_property_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total int;
  v_reserved int;
  v_blocked int;
  v_cap int;
begin
  if p_check_out <= p_check_in then
    return 0;
  end if;

  select count(*) into v_total
  from public.acc_rooms r
  where r.property_id = p_property_id
    and r.room_type_id = p_room_type_id
    and r.active
    and r.status <> 'out_of_service';

  if coalesce(v_total, 0) = 0 then
    return 0;
  end if;

  select count(*) into v_reserved
  from public.acc_reservations x
  where x.property_id = p_property_id
    and x.room_type_id = p_room_type_id
    and x.status in (
      'pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying',
      'checked_out', 'completed', 'change_pending', 'disputed'
    )
    and (x.status <> 'pending' or x.hold_expires_at is null or x.hold_expires_at > now())
    and daterange(x.check_in, x.check_out, '[)') &&
        daterange(p_check_in, p_check_out, '[)');

  select count(*) into v_blocked
  from public.acc_room_blocks b
  join public.acc_rooms r on r.id = b.room_id
  where r.room_type_id = p_room_type_id
    and b.status = 'active'
    and daterange(b.start_date, b.end_date, '[)') &&
        daterange(p_check_in, p_check_out, '[)');

  select coalesce(min(rc.available_rooms), v_total) into v_cap
  from public.acc_rate_calendar rc
  where rc.room_type_id = p_room_type_id
    and rc.stay_date >= p_check_in
    and rc.stay_date < p_check_out
    and rc.available_rooms is not null;

  return greatest(0, least(v_total - v_reserved - v_blocked, coalesce(v_cap, v_total)));
end;
$$;

-- ---------------------------------------------------------------------
-- Fiyat teklifi
-- ---------------------------------------------------------------------
create or replace function public.acc_quote(
  p_property_id uuid,
  p_room_type_id uuid,
  p_rate_plan_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults int default 2,
  p_children int default 0,
  p_source text default 'trabzone'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prop public.acc_properties%rowtype;
  v_room_type public.acc_room_types%rowtype;
  v_plan public.acc_rate_plans%rowtype;
  v_nights int;
  v_date date;
  v_base bigint;
  v_extra_adult bigint;
  v_extra_child bigint;
  v_extra bigint;
  v_subtotal bigint;
  v_discount bigint;
  v_campaign_id uuid;
  v_campaign_title text;
  v_nightly jsonb := '[]'::jsonb;
  v_subtotal_total bigint := 0;
  v_discount_total bigint := 0;
  v_total bigint;
  v_campaign record;
  v_min_stay int := 1;
  v_max_stay int;
  v_closed_night boolean := false;
  v_closed_to_arrival boolean := false;
  v_closed_to_departure boolean := false;
  v_first_closed_to_arrival boolean := false;
  v_last_closed_to_departure boolean := false;
  v_available int;
  v_commission_rate numeric := 0;
  v_best_campaign_id uuid;
  v_best_discount bigint := 0;
begin
  if p_check_in is null or p_check_out is null then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;
  v_nights := p_check_out - p_check_in;
  if v_nights <= 0 or v_nights > 60 then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;
  if p_adults is null or p_adults < 1 or coalesce(p_children, 0) < 0 then
    raise exception 'invalid_occupancy' using errcode = '22023';
  end if;

  select * into v_prop from public.acc_properties where id = p_property_id;
  if not found then
    raise exception 'property_not_found' using errcode = 'P0002';
  end if;
  if v_prop.status <> 'published'
     and not public.acc_can(v_prop.id, 'read') then
    raise exception 'property_not_available' using errcode = 'P0002';
  end if;

  select * into v_room_type
  from public.acc_room_types
  where id = p_room_type_id and property_id = p_property_id and active;
  if not found then
    raise exception 'room_type_not_found' using errcode = 'P0002';
  end if;

  select * into v_plan
  from public.acc_rate_plans
  where id = p_rate_plan_id and property_id = p_property_id and active
    and (room_type_id is null or room_type_id = p_room_type_id);
  if not found then
    raise exception 'rate_plan_not_found' using errcode = 'P0002';
  end if;

  if p_adults > v_room_type.capacity_adults
     or (p_adults + p_children) > (v_room_type.capacity_adults + v_room_type.capacity_children) then
    raise exception 'capacity_exceeded' using errcode = '22023';
  end if;

  v_min_stay := greatest(v_plan.min_stay, 1);
  v_max_stay := v_plan.max_stay;

  for v_date in
    select generate_series(p_check_in, p_check_out - 1, interval '1 day')::date
  loop
    v_base := v_room_type.base_price_cents;
    v_extra := 0;

    select rc.base_price_cents,
           coalesce(rc.extra_adult_cents, 0),
           coalesce(rc.extra_child_cents, 0),
           rc.closed,
           rc.closed_to_arrival,
           rc.closed_to_departure,
           rc.min_stay,
           rc.max_stay
      into v_base, v_extra_adult, v_extra_child, v_closed_night,
           v_closed_to_arrival, v_closed_to_departure, v_min_stay, v_max_stay
    from public.acc_rate_calendar rc
    where rc.room_type_id = p_room_type_id
      and rc.rate_plan_id = p_rate_plan_id
      and rc.stay_date = v_date;

    if not found then
      v_base := v_room_type.base_price_cents;
      v_extra_adult := 0;
      v_extra_child := 0;
      v_closed_night := false;
      v_closed_to_arrival := false;
      v_closed_to_departure := false;
    end if;

    if v_closed_night then
      raise exception 'dates_closed' using errcode = '22023';
    end if;

    if v_date = p_check_in and v_closed_to_arrival then
      v_first_closed_to_arrival := true;
    end if;
    if v_date = p_check_out - 1 and v_closed_to_departure then
      v_last_closed_to_departure := true;
    end if;

    v_base := coalesce(v_base, v_room_type.base_price_cents);
    v_extra := greatest(0, p_adults - 2) * coalesce(v_extra_adult, 0)
             + coalesce(p_children, 0) * greatest(0, coalesce(v_extra_child, 0));
    v_subtotal := v_base + v_extra;
    v_discount := 0;
    v_campaign_id := null;
    v_campaign_title := null;

    select c.id, c.title, c.discount_percent, c.fixed_price_cents
      into v_campaign
    from public.acc_campaigns c
    where c.property_id = p_property_id
      and c.status = 'active'
      and v_date between c.start_date and c.end_date
      and (c.booking_deadline is null or c.booking_deadline >= current_date)
      and (coalesce(array_length(c.room_type_ids, 1), 0) = 0
           or p_room_type_id = any(c.room_type_ids))
      and (coalesce(array_length(c.rate_plan_ids, 1), 0) = 0
           or p_rate_plan_id = any(c.rate_plan_ids))
      and v_nights >= c.min_nights
      and (c.max_nights is null or v_nights <= c.max_nights)
      and (c.quota is null or c.used_count < c.quota)
    order by
      case
        when c.fixed_price_cents is not null
          then greatest(0, v_subtotal - c.fixed_price_cents)
        else round(v_subtotal * c.discount_percent / 100)
      end desc
    limit 1;

    if found then
      if v_campaign.fixed_price_cents is not null then
        v_discount := greatest(0, v_subtotal - v_campaign.fixed_price_cents);
      else
        v_discount := round(v_subtotal * v_campaign.discount_percent / 100);
      end if;
      v_discount := least(v_discount, v_subtotal);
      v_campaign_id := v_campaign.id;
      v_campaign_title := v_campaign.title;
    end if;

    if v_discount > v_best_discount then
      v_best_discount := v_discount;
      v_best_campaign_id := v_campaign_id;
    end if;

    v_nightly := v_nightly || jsonb_build_array(jsonb_build_object(
      'date', v_date,
      'base_cents', v_base,
      'extra_cents', v_extra,
      'subtotal_cents', v_subtotal,
      'discount_cents', v_discount,
      'total_cents', v_subtotal - v_discount,
      'campaign_id', v_campaign_id,
      'campaign_title', v_campaign_title
    ));
    v_subtotal_total := v_subtotal_total + v_subtotal;
    v_discount_total := v_discount_total + v_discount;
  end loop;

  v_total := greatest(0, v_subtotal_total - v_discount_total);
  -- min/max konaklama, aralıktaki en katı kurala göre uygulanır.
  select greatest(coalesce(max(rc.min_stay), v_plan.min_stay), 1),
         min(rc.max_stay)
    into v_min_stay, v_max_stay
  from public.acc_rate_calendar rc
  where rc.room_type_id = p_room_type_id
    and rc.rate_plan_id = p_rate_plan_id
    and rc.stay_date >= p_check_in
    and rc.stay_date < p_check_out;

  v_min_stay := greatest(coalesce(v_min_stay, v_plan.min_stay, 1), 1);
  v_max_stay := coalesce(v_max_stay, v_plan.max_stay);

  v_available := public.acc_room_type_available(
    p_property_id, p_room_type_id, p_check_in, p_check_out
  );

  v_commission_rate := case
    when coalesce(p_source, 'trabzone') = 'trabzone' then v_prop.commission_rate
    else 0
  end;

  return jsonb_build_object(
    'property_id', p_property_id,
    'room_type_id', p_room_type_id,
    'rate_plan_id', p_rate_plan_id,
    'property_name', v_prop.name,
    'room_type_name', v_room_type.name,
    'rate_plan_name', v_plan.name,
    'booking_mode', v_plan.booking_mode,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'nights', v_nights,
    'adults', p_adults,
    'children', coalesce(p_children, 0),
    'currency', v_room_type.currency,
    'nightly', v_nightly,
    'subtotal_cents', v_subtotal_total,
    'discount_cents', v_discount_total,
    'total_cents', v_total,
    'commission_rate', v_commission_rate,
    'commission_cents', round(v_total * v_commission_rate / 100),
    'available_rooms', v_available,
    'sold_out', v_available <= 0,
    'min_stay', v_min_stay,
    'max_stay', v_max_stay,
    'min_stay_ok', v_nights >= v_min_stay,
    'max_stay_ok', v_max_stay is null or v_nights <= v_max_stay,
    'closed_to_arrival', v_first_closed_to_arrival,
    'closed_to_departure', v_last_closed_to_departure,
    'campaign_id', v_best_campaign_id,
    'has_discount', v_discount_total > 0
  );
end;
$$;

grant execute on function public.acc_quote(uuid, uuid, uuid, date, date, int, int, text)
  to anon, authenticated, service_role;

grant execute on function public.acc_room_type_available(uuid, uuid, date, date)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Herkese açık arama
-- ---------------------------------------------------------------------
create or replace function public.acc_search(
  p_property_type text default null,
  p_district_id bigint default null,
  p_guests int default null,
  p_check_in date default null,
  p_check_out date default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_query text default null,
  p_sort text default 'recommended',
  p_deals boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'recommended'));
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_items jsonb;
  v_total int;
  v_has_dates boolean := p_check_in is not null and p_check_out is not null
    and p_check_out > p_check_in;
begin
  perform public.acc_expire_holds();

  with candidates as (
    select p.*,
      (
        select min(coalesce(rc.base_price_cents, rt.base_price_cents))
        from public.acc_room_types rt
        left join public.acc_rate_calendar rc
          on rc.room_type_id = rt.id
         and (v_has_dates is false or (rc.stay_date >= p_check_in and rc.stay_date < p_check_out))
        where rt.property_id = p.id and rt.active
      ) as price_from_cents,
      (
        select min(rt.capacity_adults + rt.capacity_children)
        from public.acc_room_types rt
        where rt.property_id = p.id and rt.active
      ) as max_guests,
      (
        select count(*)
        from public.acc_room_types rt
        where rt.property_id = p.id
          and rt.active
          and (not v_has_dates or public.acc_room_type_available(p.id, rt.id, p_check_in, p_check_out) > 0)
          and (p_guests is null or (rt.capacity_adults + rt.capacity_children) >= p_guests)
      ) as open_room_types,
      exists (
        select 1 from public.acc_campaigns c
        where c.property_id = p.id
          and c.status = 'active'
          and current_date between c.start_date and c.end_date
      ) as has_deal,
      (
        select array_agg(distinct rp.booking_mode)
        from public.acc_rate_plans rp
        where rp.property_id = p.id and rp.active
      ) as booking_modes
    from public.acc_properties p
    where p.status = 'published'
      and p.verification_status = 'verified'
      and (p_property_type is null or p_property_type = 'all' or p.property_type = p_property_type)
      and (p_district_id is null or p.district_id = p_district_id)
      and (v_query is null
           or p.name ilike '%' || v_query || '%'
           or coalesce(p.district, '') ilike '%' || v_query || '%'
           or coalesce(p.neighborhood, '') ilike '%' || v_query || '%'
           or coalesce(p.description, '') ilike '%' || v_query || '%')
      and (not p_deals or exists (
        select 1 from public.acc_campaigns c
        where c.property_id = p.id
          and c.status = 'active'
          and current_date between c.start_date and c.end_date
      ))
  ), filtered as (
    select c.*
    from candidates c
    where coalesce(c.open_room_types, 0) > 0
      and (p_min_price is null or coalesce(c.price_from_cents, 0) >= (p_min_price * 100)::bigint)
      and (p_max_price is null or coalesce(c.price_from_cents, 0) <= (p_max_price * 100)::bigint)
  ), enriched as (
    select f.*,
      (
        select coalesce(jsonb_agg(x.storage_path order by x.cover desc, x.sort_order, x.created_at), '[]'::jsonb)
        from (
          select m.storage_path, m.cover, m.sort_order, m.created_at
          from public.acc_property_media m
          where m.property_id = f.id and m.kind = 'image' and m.status = 'approved'
          order by m.cover desc, m.sort_order, m.created_at
          limit 5
        ) x
      ) as photos,
      (
        select count(*)
        from public.acc_property_media m
        where m.property_id = f.id and m.kind = 'image' and m.status = 'approved'
      ) as photo_count,
      (
        select count(*)
        from public.acc_reservations r
        where r.property_id = f.id and r.guest_user_id = auth.uid()
      ) as my_reservation_count
    from filtered f
  )
  select coalesce(jsonb_agg(item order by
      case when v_sort = 'price_asc' then price_sort end asc nulls last,
      case when v_sort = 'price_desc' then price_sort end desc nulls last,
      case when v_sort = 'rating' then rating_sort end desc nulls last,
      case when v_sort = 'new' then new_sort end desc nulls last,
      case when v_sort = 'recommended' then (rating_sort * 20 + coalesce(review_sort, 0)) end desc nulls last
    ), '[]'::jsonb), coalesce(max(total_count), 0)
    into v_items, v_total
  from (
    select jsonb_build_object(
      'id', e.id,
      'name', e.name,
      'slug', e.slug,
      'property_type', e.property_type,
      'description', e.description,
      'district', e.district,
      'neighborhood', e.neighborhood,
      'district_id', e.district_id,
      'neighborhood_id', e.neighborhood_id,
      'lat', e.lat,
      'lng', e.lng,
      'cover_path', coalesce(
        e.cover_path,
        (select m.storage_path from public.acc_property_media m
          where m.property_id = e.id and m.kind = 'image' and m.status = 'approved'
          order by m.cover desc, m.sort_order limit 1)
      ),
      'photos', e.photos,
      'photo_count', e.photo_count,
      'rating_avg', e.rating_avg,
      'rating_count', e.rating_count,
      'amenities', e.amenities,
      'price_from_cents', e.price_from_cents,
      'currency', 'TRY',
      'max_guests', e.max_guests,
      'booking_modes', coalesce(to_jsonb(e.booking_modes), '[]'::jsonb),
      'has_deal', e.has_deal,
      'my_reservation_count', e.my_reservation_count,
      'is_published', e.status = 'published'
    ) as item,
    e.price_from_cents as price_sort,
    e.rating_avg as rating_sort,
    e.rating_count as review_sort,
    extract(epoch from coalesce(e.published_at, e.created_at)) as new_sort,
    (select count(*) from filtered) as total_count
    from enriched e
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_dates', v_has_dates
  );
end;
$$;

grant execute on function public.acc_search(text, bigint, int, date, date, numeric, numeric, text, text, boolean, int, int)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Herkese açık tesis detayı
-- ---------------------------------------------------------------------
create or replace function public.acc_property_public(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop public.acc_properties%rowtype;
  v_media jsonb;
  v_room_types jsonb;
  v_reviews jsonb;
  v_campaigns jsonb;
  v_breakdown jsonb;
begin
  select * into v_prop from public.acc_properties where id = p_property_id;
  if not found then
    raise exception 'property_not_found' using errcode = 'P0002';
  end if;
  if v_prop.status <> 'published' and not public.acc_can(v_prop.id, 'read') then
    raise exception 'property_not_available' using errcode = 'P0002';
  end if;

  update public.acc_properties
     set view_count = view_count + 1
   where id = v_prop.id and status = 'published';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'kind', m.kind,
    'category', m.category,
    'storage_path', m.storage_path,
    'thumbnail_path', m.thumbnail_path,
    'caption', m.caption,
    'cover', m.cover,
    'sort_order', m.sort_order,
    'room_type_id', m.room_type_id
  ) order by m.cover desc, m.sort_order, m.created_at), '[]'::jsonb)
  into v_media
  from public.acc_property_media m
  where m.property_id = p_property_id and m.status = 'approved';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rt.id,
    'name', rt.name,
    'description', rt.description,
    'capacity_adults', rt.capacity_adults,
    'capacity_children', rt.capacity_children,
    'bed_setup', rt.bed_setup,
    'size_m2', rt.size_m2,
    'view', rt.view,
    'balcony', rt.balcony,
    'air_conditioning', rt.air_conditioning,
    'wifi', rt.wifi,
    'breakfast', rt.breakfast,
    'amenities', rt.amenities,
    'base_price_cents', rt.base_price_cents,
    'currency', rt.currency,
    'cover_path', coalesce(
      rt.cover_path,
      (select m.storage_path from public.acc_property_media m
        where m.room_type_id = rt.id and m.kind = 'image' and m.status = 'approved'
        order by m.cover desc, m.sort_order limit 1)
    ),
    'photos', coalesce((
      select jsonb_agg(x.storage_path order by x.cover desc, x.sort_order)
      from (
        select m.storage_path, m.cover, m.sort_order
        from public.acc_property_media m
        where m.room_type_id = rt.id and m.kind = 'image' and m.status = 'approved'
        order by m.cover desc, m.sort_order limit 5
      ) x
    ), '[]'::jsonb),
    'rate_plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rp.id,
        'name', rp.name,
        'description', rp.description,
        'booking_mode', rp.booking_mode,
        'cancellation_policy', rp.cancellation_policy,
        'cancellation_hours', rp.cancellation_hours,
        'deposit_percent', rp.deposit_percent,
        'includes_breakfast', rp.includes_breakfast,
        'min_stay', rp.min_stay,
        'max_stay', rp.max_stay
      ) order by rp.sort_order, rp.created_at)
      from public.acc_rate_plans rp
      where rp.property_id = p_property_id and rp.active
        and (rp.room_type_id is null or rp.room_type_id = rt.id)
    ), '[]'::jsonb)
  ) order by rt.sort_order, rt.created_at), '[]'::jsonb)
  into v_room_types
  from public.acc_room_types rt
  where rt.property_id = p_property_id and rt.active;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'guest_name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username, 'Misafir'),
    'guest_avatar_path', pr.avatar_path,
    'rating', r.rating,
    'cleanliness', r.cleanliness,
    'staff_score', r.staff_score,
    'location_score', r.location_score,
    'value_score', r.value_score,
    'comment', r.comment,
    'owner_reply', r.owner_reply,
    'created_at', r.created_at
  ) order by r.created_at desc), '[]'::jsonb)
  into v_reviews
  from (
    select * from public.acc_reviews
    where property_id = p_property_id and status = 'published'
    order by created_at desc limit 12
  ) r
  left join public.profiles pr on pr.id = r.guest_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'description', c.description,
    'cover_path', c.cover_path,
    'kind', c.kind,
    'start_date', c.start_date,
    'end_date', c.end_date,
    'discount_percent', c.discount_percent,
    'fixed_price_cents', c.fixed_price_cents,
    'room_type_ids', c.room_type_ids,
    'rate_plan_ids', c.rate_plan_ids,
    'min_nights', c.min_nights,
    'max_nights', c.max_nights
  ) order by c.start_date), '[]'::jsonb)
  into v_campaigns
  from public.acc_campaigns c
  where c.property_id = p_property_id
    and c.status = 'active'
    and current_date between c.start_date and c.end_date;

  select jsonb_build_object(
    'cleanliness', round(avg(cleanliness)::numeric, 2),
    'staff', round(avg(staff_score)::numeric, 2),
    'location', round(avg(location_score)::numeric, 2),
    'value', round(avg(value_score)::numeric, 2)
  ) into v_breakdown
  from public.acc_reviews
  where property_id = p_property_id and status = 'published';

  return jsonb_build_object(
    'id', v_prop.id,
    'name', v_prop.name,
    'slug', v_prop.slug,
    'property_type', v_prop.property_type,
    'description', v_prop.description,
    'district', v_prop.district,
    'neighborhood', v_prop.neighborhood,
    'district_id', v_prop.district_id,
    'neighborhood_id', v_prop.neighborhood_id,
    'address', v_prop.address,
    'lat', v_prop.lat,
    'lng', v_prop.lng,
    'phone', v_prop.phone,
    'email', v_prop.email,
    'website', v_prop.website,
    'checkin_time', v_prop.checkin_time,
    'checkout_time', v_prop.checkout_time,
    'languages', v_prop.languages,
    'policies', v_prop.policies,
    'amenities', v_prop.amenities,
    'room_capacity', v_prop.room_capacity,
    'cover_path', coalesce(
      v_prop.cover_path,
      (select m.storage_path from public.acc_property_media m
        where m.property_id = v_prop.id and m.kind = 'image' and m.status = 'approved'
        order by m.cover desc, m.sort_order limit 1)
    ),
    'rating_avg', v_prop.rating_avg,
    'rating_count', v_prop.rating_count,
    'view_count', v_prop.view_count,
    'verification_status', v_prop.verification_status,
    'media', v_media,
    'room_types', v_room_types,
    'reviews', v_reviews,
    'rating_breakdown', coalesce(v_breakdown, '{}'::jsonb),
    'campaigns', v_campaigns
  );
end;
$$;

grant execute on function public.acc_property_public(uuid)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Filtre seçenekleri
-- ---------------------------------------------------------------------
create or replace function public.acc_public_filters()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
      from public.districts d
      where exists (
        select 1 from public.acc_properties p
        where p.district_id = d.id and p.status = 'published'
      )
    ), '[]'::jsonb),
    'types', jsonb_build_array(
      jsonb_build_object('key', 'hotel', 'label', 'Oteller'),
      jsonb_build_object('key', 'bungalow', 'label', 'Bungalovlar'),
      jsonb_build_object('key', 'apartment', 'label', 'Apartlar'),
      jsonb_build_object('key', 'pension', 'label', 'Pansiyonlar'),
      jsonb_build_object('key', 'villa', 'label', 'Villalar')
    )
  );
$$;

grant execute on function public.acc_public_filters()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Misafir rezervasyonu oluşturma
-- ---------------------------------------------------------------------
create or replace function public.acc_book(
  p_property_id uuid,
  p_room_type_id uuid,
  p_rate_plan_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults int,
  p_children int,
  p_guest_name text,
  p_guest_phone text default null,
  p_guest_email text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_prop public.acc_properties%rowtype;
  v_plan public.acc_rate_plans%rowtype;
  v_quote jsonb;
  v_room_id uuid;
  v_status text;
  v_hold timestamptz;
  v_guest_id uuid;
  v_res public.acc_reservations%rowtype;
  v_commission_rate numeric;
begin
  perform public.acc_expire_holds(p_property_id);

  select * into v_prop from public.acc_properties where id = p_property_id;
  if not found then
    raise exception 'property_not_found' using errcode = 'P0002';
  end if;
  if v_prop.status <> 'published' or v_prop.verification_status <> 'verified' then
    raise exception 'property_not_available' using errcode = 'P0002';
  end if;

  select * into v_plan
  from public.acc_rate_plans
  where id = p_rate_plan_id and property_id = p_property_id and active;
  if not found then
    raise exception 'rate_plan_not_found' using errcode = 'P0002';
  end if;

  v_quote := public.acc_quote(
    p_property_id, p_room_type_id, p_rate_plan_id,
    p_check_in, p_check_out, p_adults, p_children, 'trabzone'
  );

  if (v_quote->>'available_rooms')::int <= 0 then
    raise exception 'sold_out' using errcode = '22023';
  end if;
  if not (v_quote->>'min_stay_ok')::boolean then
    raise exception 'min_stay_not_met' using errcode = '22023';
  end if;
  if not (v_quote->>'max_stay_ok')::boolean then
    raise exception 'max_stay_exceeded' using errcode = '22023';
  end if;

  select r.id into v_room_id
  from public.acc_rooms r
  where r.property_id = p_property_id
    and r.room_type_id = p_room_type_id
    and r.active
    and r.status <> 'out_of_service'
    and not exists (
      select 1 from public.acc_reservations x
      where x.room_id = r.id
        and x.status in (
          'pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying',
          'checked_out', 'completed', 'change_pending', 'disputed'
        )
        and (x.status <> 'pending' or x.hold_expires_at is null or x.hold_expires_at > now())
        and daterange(x.check_in, x.check_out, '[)') && daterange(p_check_in, p_check_out, '[)')
    )
    and not exists (
      select 1 from public.acc_room_blocks b
      where b.room_id = r.id and b.status = 'active'
        and daterange(b.start_date, b.end_date, '[)') && daterange(p_check_in, p_check_out, '[)')
    )
  order by r.sort_order, r.number
  limit 1;

  if v_room_id is null then
    raise exception 'sold_out' using errcode = '22023';
  end if;

  v_status := case when v_plan.booking_mode = 'instant' then 'confirmed' else 'pending' end;
  v_hold := case
    when v_plan.booking_mode = 'manual'
      then now() + make_interval(mins => greatest(
        coalesce((v_prop.settings->>'hold_minutes')::int, 60), 10
      ))
    else null
  end;

  if nullif(btrim(coalesce(p_guest_phone, '')), '') is not null then
    select g.id into v_guest_id
    from public.acc_guests g
    where g.property_id = p_property_id
      and (g.phone = btrim(p_guest_phone)
           or (p_guest_email is not null and g.email = lower(btrim(p_guest_email))))
    limit 1;
  end if;

  if v_guest_id is null then
    insert into public.acc_guests
      (property_id, user_id, full_name, phone, email, created_by)
    values (
      p_property_id, v_uid, btrim(p_guest_name),
      nullif(btrim(coalesce(p_guest_phone, '')), ''),
      nullif(lower(btrim(coalesce(p_guest_email, ''))), ''),
      v_uid
    )
    returning id into v_guest_id;
  else
    update public.acc_guests g
       set user_id = coalesce(g.user_id, v_uid),
           full_name = btrim(p_guest_name),
           email = coalesce(nullif(lower(btrim(coalesce(p_guest_email, ''))), ''), g.email)
     where g.id = v_guest_id;
  end if;

  v_commission_rate := v_prop.commission_rate;

  insert into public.acc_reservations (
    property_id, room_type_id, room_id, rate_plan_id, guest_id, guest_user_id,
    guest_name, guest_phone, guest_email, adults, children, check_in, check_out,
    status, source, booking_mode, nightly_price_cents, total_cents, discount_cents,
    commission_rate, commission_cents, currency, payment_status, notes,
    hold_expires_at, campaign_id, created_by, confirmed_at
  ) values (
    p_property_id, p_room_type_id, v_room_id, p_rate_plan_id, v_guest_id, v_uid,
    btrim(p_guest_name),
    nullif(btrim(coalesce(p_guest_phone, '')), ''),
    nullif(lower(btrim(coalesce(p_guest_email, ''))), ''),
    p_adults, coalesce(p_children, 0), p_check_in, p_check_out,
    v_status, 'trabzone', v_plan.booking_mode,
    round((v_quote->>'total_cents')::numeric / greatest((v_quote->>'nights')::int, 1)),
    (v_quote->>'total_cents')::bigint,
    (v_quote->>'discount_cents')::bigint,
    v_commission_rate,
    round((v_quote->>'total_cents')::numeric * v_commission_rate / 100),
    v_quote->>'currency', 'unpaid', nullif(btrim(coalesce(p_note, '')), ''),
    v_hold,
    (v_quote->>'campaign_id')::uuid,
    v_uid,
    case when v_status = 'confirmed' then now() else null end
  )
  returning * into v_res;

  if v_res.campaign_id is not null then
    update public.acc_campaigns
       set used_count = used_count + 1
     where id = v_res.campaign_id;
  end if;

  insert into public.acc_reservation_status_history
    (reservation_id, from_status, to_status, actor_id, note)
  values (
    v_res.id, null, v_status, v_uid,
    case when v_status = 'pending'
      then 'Misafir talebi oluşturuldu; otel onayı bekleniyor.'
      else 'Anında rezervasyon onaylandı.'
    end
  );

  insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
  select s.user_id, v_uid, 'accommodation_reservation',
         case when v_status = 'pending' then 'Yeni rezervasyon talebi' else 'Yeni rezervasyon' end,
         v_prop.name || ' · ' || btrim(p_guest_name) || ' · ' ||
           to_char(p_check_in, 'DD.MM.YYYY') || '–' || to_char(p_check_out, 'DD.MM.YYYY'),
         'accommodation_reservation', v_res.id::text,
         '/konaklama/yonetim/rezervasyonlar'
  from public.acc_property_staff s
  where s.property_id = p_property_id
    and s.status = 'active'
    and s.user_id <> v_uid;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (
    p_property_id, v_uid, 'reservation.created', 'reservation', v_res.id::text,
    jsonb_build_object('status', v_status, 'source', 'trabzone', 'total_cents', v_res.total_cents)
  );

  return jsonb_build_object(
    'id', v_res.id,
    'code', v_res.code,
    'status', v_res.status,
    'booking_mode', v_res.booking_mode,
    'check_in', v_res.check_in,
    'check_out', v_res.check_out,
    'nights', v_res.nights,
    'total_cents', v_res.total_cents,
    'commission_cents', v_res.commission_cents,
    'currency', v_res.currency,
    'hold_expires_at', v_res.hold_expires_at,
    'property_name', v_prop.name,
    'room_type_name', (select name from public.acc_room_types where id = p_room_type_id)
  );
end;
$$;

grant execute on function public.acc_book(uuid, uuid, uuid, date, date, int, int, text, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Misafirin rezervasyonları
-- ---------------------------------------------------------------------
create or replace function public.acc_my_reservations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_items jsonb;
begin
  perform public.acc_expire_holds();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'status', r.status,
    'source', r.source,
    'booking_mode', r.booking_mode,
    'check_in', r.check_in,
    'check_out', r.check_out,
    'nights', r.nights,
    'adults', r.adults,
    'children', r.children,
    'total_cents', r.total_cents,
    'commission_cents', r.commission_cents,
    'currency', r.currency,
    'payment_status', r.payment_status,
    'hold_expires_at', r.hold_expires_at,
    'created_at', r.created_at,
    'property', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'slug', p.slug,
      'property_type', p.property_type,
      'district', p.district,
      'cover_path', coalesce(
        p.cover_path,
        (select m.storage_path from public.acc_property_media m
          where m.property_id = p.id and m.kind = 'image' and m.status = 'approved'
          order by m.cover desc, m.sort_order limit 1)
      )
    ),
    'room_type_name', rt.name,
    'rate_plan_name', rp.name,
    'can_cancel', r.status in ('pending', 'confirmed', 'awaiting_checkin')
      and r.check_in >= current_date
  ) order by r.check_in desc, r.created_at desc), '[]'::jsonb)
  into v_items
  from public.acc_reservations r
  join public.acc_properties p on p.id = r.property_id
  join public.acc_room_types rt on rt.id = r.room_type_id
  join public.acc_rate_plans rp on rp.id = r.rate_plan_id
  where r.guest_user_id = v_uid
    and r.status <> 'draft';

  return jsonb_build_object('items', v_items);
end;
$$;

grant execute on function public.acc_my_reservations() to authenticated, service_role;

create or replace function public.acc_my_reservation_detail(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_res public.acc_reservations%rowtype;
begin
  select * into v_res
  from public.acc_reservations
  where id = p_reservation_id and guest_user_id = v_uid;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_res.id,
    'code', v_res.code,
    'status', v_res.status,
    'source', v_res.source,
    'check_in', v_res.check_in,
    'check_out', v_res.check_out,
    'nights', v_res.nights,
    'adults', v_res.adults,
    'children', v_res.children,
    'guest_name', v_res.guest_name,
    'guest_phone', v_res.guest_phone,
    'guest_email', v_res.guest_email,
    'total_cents', v_res.total_cents,
    'discount_cents', v_res.discount_cents,
    'commission_cents', v_res.commission_cents,
    'currency', v_res.currency,
    'payment_status', v_res.payment_status,
    'notes', v_res.notes,
    'hold_expires_at', v_res.hold_expires_at,
    'created_at', v_res.created_at,
    'property', (
      select jsonb_build_object(
        'id', p.id, 'name', p.name, 'slug', p.slug, 'property_type', p.property_type,
        'district', p.district, 'neighborhood', p.neighborhood, 'address', p.address,
        'phone', p.phone, 'email', p.email,
        'checkin_time', p.checkin_time, 'checkout_time', p.checkout_time,
        'policies', p.policies,
        'cover_path', coalesce(p.cover_path, (
          select m.storage_path from public.acc_property_media m
          where m.property_id = p.id and m.kind = 'image' and m.status = 'approved'
          order by m.cover desc, m.sort_order limit 1
        ))
      )
      from public.acc_properties p where p.id = v_res.property_id
    ),
    'room_type_name', (select name from public.acc_room_types where id = v_res.room_type_id),
    'rate_plan_name', (select name from public.acc_rate_plans where id = v_res.rate_plan_id),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'from_status', h.from_status,
        'to_status', h.to_status,
        'note', h.note,
        'created_at', h.created_at
      ) order by h.created_at)
      from public.acc_reservation_status_history h
      where h.reservation_id = v_res.id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.acc_my_reservation_detail(uuid) to authenticated, service_role;

create or replace function public.acc_cancel_my_reservation(
  p_reservation_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_res public.acc_reservations%rowtype;
  v_old_status text;
begin
  select * into v_res
  from public.acc_reservations
  where id = p_reservation_id and guest_user_id = v_uid
  for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  if v_res.status not in ('pending', 'confirmed', 'awaiting_checkin') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if v_res.check_in < current_date then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  v_old_status := v_res.status;

  update public.acc_reservations
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         hold_expires_at = null
   where id = v_res.id
  returning * into v_res;

  insert into public.acc_reservation_status_history
    (reservation_id, from_status, to_status, actor_id, note)
  values (v_res.id, v_old_status, 'cancelled', v_uid,
          coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Misafir rezervasyonu iptal etti.'));

  insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
  select s.user_id, v_uid, 'accommodation_reservation',
         'Rezervasyon iptal edildi',
         v_res.code || ' · ' || v_res.guest_name || ' · ' || to_char(v_res.check_in, 'DD.MM.YYYY'),
         'accommodation_reservation', v_res.id::text,
         '/konaklama/yonetim/rezervasyonlar'
  from public.acc_property_staff s
  where s.property_id = v_res.property_id and s.status = 'active' and s.user_id <> v_uid;

  return jsonb_build_object('id', v_res.id, 'status', v_res.status);
end;
$$;

grant execute on function public.acc_cancel_my_reservation(uuid, text) to authenticated, service_role;
