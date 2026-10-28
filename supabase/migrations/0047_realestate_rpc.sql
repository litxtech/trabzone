-- =====================================================================
-- 0047 — Premium emlak RPC'leri
--
-- Yayın kapısı: bir ilan ancak EİDS kimlik + ilan verme yetkisi
-- doğrulaması tamamlandığında `published` olabilir. Doğrulama entegrasyonu
-- yapılandırılmadıysa ilan taslak/doğrulama bekliyor durumunda kalır.
-- Bu davranış istemciden değiştirilemez.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------
create or replace function public.tz_re_kind_allowed(p_kind text)
returns boolean
language sql
immutable
as $$
  select p_kind in ('rent', 'sale', 'transfer');
$$;

create or replace function public.tz_re_owner_can_edit(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('draft', 'rejected');
$$;

-- ---------------------------------------------------------------------
-- Liste
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

-- ---------------------------------------------------------------------
-- Harita: görünür alandaki yayınlanmış ilanlar
-- ---------------------------------------------------------------------
create or replace function public.re_map(
  p_west double precision,
  p_east double precision,
  p_south double precision,
  p_north double precision,
  p_listing_kind text default null,
  p_categories text[] default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_m2 integer default null,
  p_max_m2 integer default null,
  p_rooms smallint default null,
  p_limit integer default 250
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_west double precision := greatest(least(coalesce(p_west, 38.90), 40.70), 38.90);
  v_east double precision := greatest(least(coalesce(p_east, 40.70), 40.70), 38.90);
  v_south double precision := greatest(least(coalesce(p_south, 40.55), 41.25), 40.55);
  v_north double precision := greatest(least(coalesce(p_north, 41.25), 41.25), 40.55);
  v_limit integer := least(greatest(coalesce(p_limit, 250), 1), 400);
  v_categories text[] := coalesce(p_categories, '{}'::text[]);
  v_items jsonb;
  v_total bigint;
begin
  if v_west >= v_east or v_south >= v_north then
    return jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'truncated', false);
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'title'), '[]'::jsonb), count(*)
  into v_items, v_total
  from (
    select jsonb_build_object(
      'kind', 'real_estate',
      'id', l.id,
      'title', l.title,
      'price_cents', l.price_cents,
      'currency', l.currency,
      'price_period', l.price_period,
      'listing_kind', l.listing_kind,
      'category_slug', c.slug,
      'category_name', c.name,
      'lat', l.public_lat,
      'lng', l.public_lng,
      'gross_m2', l.gross_m2,
      'net_m2', l.net_m2,
      'room_count', l.room_count,
      'district', d.name,
      'neighborhood', n.name,
      'cover_path', (
        select m.storage_path from public.real_estate_media m
        where m.listing_id = l.id and m.status = 'approved'
        order by m.cover desc, m.sort_order limit 1
      ),
      'is_favorite', exists (
        select 1 from public.real_estate_favorites f
        where f.listing_id = l.id and f.user_id = v_uid
      ),
      'published_at', l.published_at
    ) as item
    from public.real_estate_listings l
    join public.real_estate_categories c on c.id = l.category_id
    left join public.districts d on d.id = l.district_id
    left join public.neighborhoods n on n.id = l.neighborhood_id
    where l.status = 'published'
      and l.public_geog is not null
      and l.public_geog && st_setsrid(st_makeenvelope(v_west, v_south, v_east, v_north, 4326), 4326)::geography
      and st_intersects(
        l.public_geog,
        st_setsrid(st_makeenvelope(v_west, v_south, v_east, v_north, 4326), 4326)::geography
      )
      and (p_listing_kind is null or l.listing_kind = p_listing_kind)
      and (p_min_price is null or l.price_cents >= (p_min_price * 100)::bigint)
      and (p_max_price is null or l.price_cents <= (p_max_price * 100)::bigint)
      and (p_min_m2 is null or coalesce(l.net_m2, l.gross_m2, 0) >= p_min_m2)
      and (p_max_m2 is null or coalesce(l.net_m2, l.gross_m2, 0) <= p_max_m2)
      and (p_rooms is null or l.room_count = p_rooms)
      and (
        cardinality(v_categories) = 0
        or c.slug = any(v_categories)
        or c.parent_id in (select id from public.real_estate_categories where slug = any(v_categories))
      )
    order by l.published_at desc nulls last
    limit v_limit
  ) t;

  return jsonb_build_object('items', v_items, 'total', v_total, 'truncated', v_total >= v_limit);
end;
$$;

revoke all on function public.re_map(double precision, double precision, double precision, double precision, text, text[], numeric, numeric, integer, integer, smallint, integer) from public, anon;
grant execute on function public.re_map(double precision, double precision, double precision, double precision, text, text[], numeric, numeric, integer, integer, smallint, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- İlan detayı
-- ---------------------------------------------------------------------
create or replace function public.re_get(p_listing_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_listing public.real_estate_listings%rowtype;
  v_category public.real_estate_categories%rowtype;
  v_owner public.profiles%rowtype;
  v_is_owner boolean;
  v_is_admin boolean := public.has_permission('realestate.view');
  v_can_view_exact boolean;
  v_media jsonb;
  v_verifications jsonb;
begin
  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;

  v_is_owner := v_listing.owner_id = v_uid;
  v_can_view_exact := v_is_owner or v_is_admin;

  if v_listing.status <> 'published' and not v_can_view_exact then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;

  select * into v_category from public.real_estate_categories where id = v_listing.category_id;
  select * into v_owner from public.profiles where id = v_listing.owner_id;

  if v_listing.status = 'published' then
    update public.real_estate_listings set view_count = view_count + 1 where id = v_listing.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'kind', m.kind,
           'storage_path', m.storage_path,
           'cover', m.cover,
           'caption', m.caption,
           'sort_order', m.sort_order,
           'status', m.status
         ) order by m.cover desc, m.sort_order, m.created_at),
         '[]'::jsonb)
  into v_media
  from public.real_estate_media m
  where m.listing_id = v_listing.id
    and (m.status = 'approved' or v_can_view_exact);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id,
           'kind', v.kind,
           'status', v.status,
           'reference_no', case when v_can_view_exact then v.reference_no else null end,
           'expires_at', v.expires_at,
           'created_at', v.created_at
         ) order by v.created_at desc),
         '[]'::jsonb)
  into v_verifications
  from public.real_estate_verifications v
  where v.listing_id = v_listing.id
    and (v_can_view_exact or v.status = 'approved');

  return jsonb_build_object(
    'id', v_listing.id,
    'title', v_listing.title,
    'description', v_listing.description,
    'price_cents', v_listing.price_cents,
    'currency', v_listing.currency,
    'price_period', v_listing.price_period,
    'listing_kind', v_listing.listing_kind,
    'owner_type', v_listing.owner_type,
    'status', v_listing.status,
    'verification_status', v_listing.verification_status,
    'eids_status', v_listing.eids_status,
    'eids_verified_at', v_listing.eids_verified_at,
    'category', case when v_category.id is null then null else jsonb_build_object(
      'id', v_category.id, 'slug', v_category.slug, 'name', v_category.name,
      'icon', v_category.icon, 'listing_kind', v_category.listing_kind
    ) end,
    'city_id', v_listing.city_id,
    'district_id', v_listing.district_id,
    'neighborhood_id', v_listing.neighborhood_id,
    'district', (select name from public.districts where id = v_listing.district_id),
    'neighborhood', (select name from public.neighborhoods where id = v_listing.neighborhood_id),
    'address_text', v_listing.address_text,
    'address_private', case when v_can_view_exact then v_listing.address_private else null end,
    'hide_exact_location', v_listing.hide_exact_location,
    'lat', case when v_can_view_exact then v_listing.lat else v_listing.public_lat end,
    'lng', case when v_can_view_exact then v_listing.lng else v_listing.public_lng end,
    'public_lat', v_listing.public_lat,
    'public_lng', v_listing.public_lng,
    'gross_m2', v_listing.gross_m2,
    'net_m2', v_listing.net_m2,
    'room_count', v_listing.room_count,
    'living_room_count', v_listing.living_room_count,
    'building_age', v_listing.building_age,
    'floor_no', v_listing.floor_no,
    'total_floors', v_listing.total_floors,
    'heating', v_listing.heating,
    'furnished', v_listing.furnished,
    'balcony', v_listing.balcony,
    'parking', v_listing.parking,
    'elevator', v_listing.elevator,
    'deposit_cents', v_listing.deposit_cents,
    'dues_cents', v_listing.dues_cents,
    'attributes', v_listing.attributes,
    'published_at', v_listing.published_at,
    'expires_at', v_listing.expires_at,
    'view_count', v_listing.view_count + case when v_listing.status = 'published' then 1 else 0 end,
    'favorite_count', v_listing.favorite_count,
    'rejection_reason', case when v_can_view_exact then v_listing.rejection_reason else null end,
    'is_favorite', exists (
      select 1 from public.real_estate_favorites f
      where f.listing_id = v_listing.id and f.user_id = v_uid
    ),
    'is_mine', v_is_owner,
    'media', v_media,
    'verifications', v_verifications,
    'eids_enabled', public.tz_app_flag('real_estate.eids_enabled'),
    'owner', jsonb_build_object(
      'id', v_owner.id,
      'username', v_owner.username,
      'display_name', nullif(trim(concat_ws(' ', v_owner.first_name, v_owner.last_name)), ''),
      'avatar_path', v_owner.avatar_path,
      'is_verified', v_owner.is_verified
    ),
    'created_at', v_listing.created_at,
    'updated_at', v_listing.updated_at
  );
end;
$$;

revoke all on function public.re_get(uuid) from public, anon;
grant execute on function public.re_get(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Taslak oluşturma / güncelleme
-- ---------------------------------------------------------------------
create or replace function public.re_create_draft(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_city public.cities%rowtype;
  v_district public.districts%rowtype;
  v_category public.real_estate_categories%rowtype;
  v_slug text := nullif(btrim(coalesce(p_payload ->> 'category_slug', '')), '');
  v_title text := nullif(btrim(coalesce(p_payload ->> 'title', '')), '');
  v_description text := nullif(btrim(coalesce(p_payload ->> 'description', '')), '');
  v_price bigint := nullif(p_payload ->> 'price_cents', '')::bigint;
  v_currency text := upper(coalesce(nullif(p_payload ->> 'currency', ''), 'TRY'));
  v_owner_type text := coalesce(nullif(p_payload ->> 'owner_type', ''), 'owner');
  v_district_id bigint := nullif(p_payload ->> 'district_id', '')::bigint;
  v_hood_id bigint := nullif(p_payload ->> 'neighborhood_id', '')::bigint;
  v_lat double precision := nullif(p_payload ->> 'lat', '')::double precision;
  v_lng double precision := nullif(p_payload ->> 'lng', '')::double precision;
  v_listing public.real_estate_listings%rowtype;
  v_recent integer;
begin
  if v_title is null or char_length(v_title) < 5 or char_length(v_title) > 160 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 8000 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;
  if v_price is null or v_price < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if v_currency not in ('TRY', 'USD', 'EUR', 'GBP') then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;
  if v_owner_type not in ('owner', 'agent', 'business') then
    raise exception 'invalid_owner_type' using errcode = '22023';
  end if;
  if not public.tz_in_trabzon_bbox(v_lat, v_lng) then
    raise exception 'outside_service_area' using errcode = '22023';
  end if;

  select * into v_city from public.cities where is_active order by plate_code limit 1;
  if not found then
    raise exception 'service_area_unavailable' using errcode = 'P0002';
  end if;

  select * into v_category from public.real_estate_categories
  where slug = v_slug and is_active;
  if not found then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  select * into v_district from public.districts
  where id = v_district_id and city_id = v_city.id;
  if not found then
    raise exception 'invalid_district' using errcode = '22023';
  end if;

  if v_hood_id is not null and not exists (
    select 1 from public.neighborhoods where id = v_hood_id and district_id = v_district_id
  ) then
    raise exception 'invalid_neighborhood' using errcode = '22023';
  end if;

  select count(*) into v_recent
  from public.real_estate_listings
  where owner_id = v_uid and created_at > now() - interval '24 hours';
  if v_recent >= 20 then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  insert into public.real_estate_listings (
    owner_id, category_id, listing_kind, title, description,
    price_cents, currency, price_period, owner_type,
    city_id, district_id, neighborhood_id,
    address_text, address_private, hide_exact_location,
    lat, lng, gross_m2, net_m2, room_count, living_room_count,
    building_age, floor_no, total_floors, heating, furnished, balcony,
    parking, elevator, deposit_cents, dues_cents, attributes
  )
  values (
    v_uid, v_category.id, v_category.listing_kind, v_title, v_description,
    v_price, v_currency,
    case when v_category.listing_kind = 'rent' then coalesce(nullif(p_payload ->> 'price_period', ''), 'month')
         else coalesce(nullif(p_payload ->> 'price_period', ''), 'total') end,
    v_owner_type,
    v_city.id, v_district.id, v_hood_id,
    nullif(btrim(coalesce(p_payload ->> 'address_text', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'address_private', '')), ''),
    coalesce((p_payload ->> 'hide_exact_location')::boolean, true),
    v_lat, v_lng,
    nullif(p_payload ->> 'gross_m2', '')::integer,
    nullif(p_payload ->> 'net_m2', '')::integer,
    nullif(p_payload ->> 'room_count', '')::smallint,
    nullif(p_payload ->> 'living_room_count', '')::smallint,
    nullif(p_payload ->> 'building_age', '')::smallint,
    nullif(p_payload ->> 'floor_no', '')::smallint,
    nullif(p_payload ->> 'total_floors', '')::smallint,
    nullif(btrim(coalesce(p_payload ->> 'heating', '')), ''),
    nullif(p_payload ->> 'furnished', '')::boolean,
    nullif(p_payload ->> 'balcony', '')::boolean,
    nullif(p_payload ->> 'parking', '')::boolean,
    nullif(p_payload ->> 'elevator', '')::boolean,
    nullif(p_payload ->> 'deposit_cents', '')::bigint,
    nullif(p_payload ->> 'dues_cents', '')::bigint,
    coalesce(p_payload -> 'attributes', '{}'::jsonb)
  )
  returning * into v_listing;

  return jsonb_build_object(
    'id', v_listing.id,
    'status', v_listing.status,
    'verification_status', v_listing.verification_status,
    'message', 'İlan taslak olarak oluşturuldu. Yayın için EİDS doğrulaması gerekir.'
  );
end;
$$;

revoke all on function public.re_create_draft(jsonb) from public, anon;
grant execute on function public.re_create_draft(jsonb) to authenticated, service_role;

create or replace function public.re_update(p_listing_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_listing public.real_estate_listings%rowtype;
  v_category public.real_estate_categories%rowtype;
  v_district public.districts%rowtype;
  v_category_id uuid;
  v_kind text;
  v_title text;
  v_price bigint;
  v_owner_type text;
  v_currency text;
begin
  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_listing.owner_id <> v_uid and not public.has_permission('realestate.manage') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_listing.owner_id = v_uid and not public.tz_re_owner_can_edit(v_listing.status) then
    raise exception 'listing_not_editable' using errcode = '22023';
  end if;

  if p_payload ? 'category_slug' then
    select * into v_category from public.real_estate_categories
    where slug = nullif(btrim(coalesce(p_payload ->> 'category_slug', '')), '') and is_active;
    if not found then
      raise exception 'invalid_category' using errcode = '22023';
    end if;
    v_category_id := v_category.id;
    v_kind := v_category.listing_kind;
  end if;

  if p_payload ? 'title' then
    v_title := nullif(btrim(coalesce(p_payload ->> 'title', '')), '');
    if v_title is null or char_length(v_title) < 5 or char_length(v_title) > 160 then
      raise exception 'invalid_title' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'price_cents' then
    v_price := nullif(p_payload ->> 'price_cents', '')::bigint;
    if v_price is null or v_price < 0 then
      raise exception 'invalid_price' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'owner_type' then
    v_owner_type := p_payload ->> 'owner_type';
    if v_owner_type not in ('owner', 'agent', 'business') then
      raise exception 'invalid_owner_type' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'currency' then
    v_currency := upper(p_payload ->> 'currency');
    if v_currency not in ('TRY', 'USD', 'EUR', 'GBP') then
      raise exception 'invalid_currency' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'district_id' then
    select * into v_district from public.districts
    where id = nullif(p_payload ->> 'district_id', '')::bigint;
    if not found then
      raise exception 'invalid_district' using errcode = '22023';
    end if;
  end if;

  update public.real_estate_listings
     set category_id = coalesce(v_category_id, category_id),
         listing_kind = coalesce(v_kind, listing_kind),
         title = coalesce(v_title, title),
         description = case when p_payload ? 'description'
                            then nullif(btrim(coalesce(p_payload ->> 'description', '')), '')
                            else description end,
         price_cents = coalesce(v_price, price_cents),
         currency = coalesce(v_currency, currency),
         price_period = case when p_payload ? 'price_period'
                             then p_payload ->> 'price_period' else price_period end,
         owner_type = coalesce(v_owner_type, owner_type),
         city_id = case when p_payload ? 'district_id' then v_district.city_id else city_id end,
         district_id = coalesce(nullif(p_payload ->> 'district_id', '')::bigint, district_id),
         neighborhood_id = case when p_payload ? 'neighborhood_id'
                                then nullif(p_payload ->> 'neighborhood_id', '')::bigint
                                else neighborhood_id end,
         address_text = case when p_payload ? 'address_text'
                             then nullif(btrim(coalesce(p_payload ->> 'address_text', '')), '')
                             else address_text end,
         address_private = case when p_payload ? 'address_private'
                                then nullif(btrim(coalesce(p_payload ->> 'address_private', '')), '')
                                else address_private end,
         hide_exact_location = case when p_payload ? 'hide_exact_location'
                                    then (p_payload ->> 'hide_exact_location')::boolean
                                    else hide_exact_location end,
         lat = coalesce(nullif(p_payload ->> 'lat', '')::double precision, lat),
         lng = coalesce(nullif(p_payload ->> 'lng', '')::double precision, lng),
         gross_m2 = case when p_payload ? 'gross_m2' then nullif(p_payload ->> 'gross_m2', '')::integer else gross_m2 end,
         net_m2 = case when p_payload ? 'net_m2' then nullif(p_payload ->> 'net_m2', '')::integer else net_m2 end,
         room_count = case when p_payload ? 'room_count' then nullif(p_payload ->> 'room_count', '')::smallint else room_count end,
         living_room_count = case when p_payload ? 'living_room_count' then nullif(p_payload ->> 'living_room_count', '')::smallint else living_room_count end,
         building_age = case when p_payload ? 'building_age' then nullif(p_payload ->> 'building_age', '')::smallint else building_age end,
         floor_no = case when p_payload ? 'floor_no' then nullif(p_payload ->> 'floor_no', '')::smallint else floor_no end,
         total_floors = case when p_payload ? 'total_floors' then nullif(p_payload ->> 'total_floors', '')::smallint else total_floors end,
         heating = case when p_payload ? 'heating' then nullif(btrim(coalesce(p_payload ->> 'heating', '')), '') else heating end,
         furnished = case when p_payload ? 'furnished' then (p_payload ->> 'furnished')::boolean else furnished end,
         balcony = case when p_payload ? 'balcony' then (p_payload ->> 'balcony')::boolean else balcony end,
         parking = case when p_payload ? 'parking' then (p_payload ->> 'parking')::boolean else parking end,
         elevator = case when p_payload ? 'elevator' then (p_payload ->> 'elevator')::boolean else elevator end,
         deposit_cents = case when p_payload ? 'deposit_cents' then nullif(p_payload ->> 'deposit_cents', '')::bigint else deposit_cents end,
         dues_cents = case when p_payload ? 'dues_cents' then nullif(p_payload ->> 'dues_cents', '')::bigint else dues_cents end,
         attributes = case when p_payload ? 'attributes' and jsonb_typeof(p_payload -> 'attributes') = 'object'
                           then p_payload -> 'attributes' else attributes end
   where id = p_listing_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.re_update(uuid, jsonb) from public, anon;
grant execute on function public.re_update(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Medya
-- ---------------------------------------------------------------------
create or replace function public.re_media_add(
  p_listing_id uuid,
  p_kind text,
  p_storage_path text,
  p_cover boolean default false,
  p_caption text default null,
  p_sort_order integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_listing public.real_estate_listings%rowtype;
  v_count integer;
  v_id uuid;
begin
  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_listing.owner_id <> v_uid and not public.has_permission('realestate.manage') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_kind not in ('image', 'video') then
    raise exception 'invalid_media_type' using errcode = '22023';
  end if;
  if p_storage_path is null
     or split_part(p_storage_path, '/', 1) <> v_uid::text
     or char_length(p_storage_path) > 400 then
    raise exception 'invalid_media_path' using errcode = '22023';
  end if;

  select count(*) into v_count
  from public.real_estate_media where listing_id = p_listing_id;
  if v_count >= 20 then
    raise exception 'too_many_media' using errcode = '22023';
  end if;

  if coalesce(p_cover, false) then
    update public.real_estate_media set cover = false where listing_id = p_listing_id;
  end if;

  insert into public.real_estate_media (
    listing_id, uploader_id, kind, storage_path, cover, caption, sort_order, status
  )
  values (
    p_listing_id, v_uid, p_kind, p_storage_path, coalesce(p_cover, false),
    nullif(btrim(coalesce(p_caption, '')), ''), least(greatest(coalesce(p_sort_order, 0), 0), 99),
    case when public.has_permission('realestate.manage') then 'approved' else 'pending' end
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.re_media_add(uuid, text, text, boolean, text, integer) from public, anon;
grant execute on function public.re_media_add(uuid, text, text, boolean, text, integer) to authenticated, service_role;

create or replace function public.re_media_delete(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_media public.real_estate_media%rowtype;
  v_owner uuid;
begin
  select * into v_media from public.real_estate_media where id = p_media_id;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  select owner_id into v_owner from public.real_estate_listings where id = v_media.listing_id;
  if v_owner <> v_uid and not public.has_permission('realestate.manage') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.real_estate_media where id = p_media_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.re_media_delete(uuid) from public, anon;
grant execute on function public.re_media_delete(uuid) to authenticated, service_role;

create or replace function public.re_media_set_cover(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_media public.real_estate_media%rowtype;
  v_owner uuid;
begin
  select * into v_media from public.real_estate_media where id = p_media_id;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  select owner_id into v_owner from public.real_estate_listings where id = v_media.listing_id;
  if v_owner <> v_uid and not public.has_permission('realestate.manage') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.real_estate_media set cover = false where listing_id = v_media.listing_id;
  update public.real_estate_media set cover = true where id = p_media_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.re_media_set_cover(uuid) from public, anon;
grant execute on function public.re_media_set_cover(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Yayına gönderme (taslak -> doğrulama bekliyor)
-- ---------------------------------------------------------------------
create or replace function public.re_submit(
  p_listing_id uuid,
  p_verification jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_listing public.real_estate_listings%rowtype;
  v_category public.real_estate_categories%rowtype;
  v_media integer;
  v_eids boolean := public.tz_app_flag('real_estate.eids_enabled');
  v_reference text := nullif(btrim(coalesce(p_verification ->> 'reference_no', '')), '');
  v_document text := nullif(btrim(coalesce(p_verification ->> 'document_path', '')), '');
begin
  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_listing.owner_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_listing.status not in ('draft', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_category from public.real_estate_categories where id = v_listing.category_id;

  select count(*) into v_media
  from public.real_estate_media
  where listing_id = p_listing_id and status in ('pending', 'approved') and kind = 'image';
  if v_media = 0 then
    raise exception 'media_required' using errcode = '22023';
  end if;

  if v_listing.owner_type in ('agent', 'business') and v_reference is null and v_document is null then
    raise exception 'authority_document_required' using errcode = '22023';
  end if;

  if v_document is not null and split_part(v_document, '/', 1) <> v_uid::text then
    raise exception 'invalid_document_path' using errcode = '22023';
  end if;

  insert into public.real_estate_verifications (listing_id, kind, status, reference_no, document_path)
  values (
    p_listing_id,
    case when v_listing.owner_type in ('agent', 'business') then 'eids_authority' else 'eids_identity' end,
    'pending',
    v_reference,
    v_document
  );

  update public.real_estate_listings
     set status = 'pending_verification',
         verification_status = 'pending',
         eids_status = 'pending',
         rejection_reason = null
   where id = p_listing_id;

  insert into public.real_estate_moderation (listing_id, action, reason, metadata)
  values (
    p_listing_id,
    'submitted',
    'İlan doğrulama kuyruğuna gönderildi.',
    jsonb_build_object('owner_type', v_listing.owner_type, 'category', v_category.slug)
  );

  return jsonb_build_object(
    'status', 'pending_verification',
    'eids_enabled', v_eids,
    'message', case
      when v_eids then 'İlan doğrulama kuyruğuna alındı.'
      else 'EİDS entegrasyonu henüz yapılandırılmadı. İlan taslakta kalır; yayınlanmaz.'
    end
  );
end;
$$;

revoke all on function public.re_submit(uuid, jsonb) from public, anon;
grant execute on function public.re_submit(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Kullanıcı ilanları
-- ---------------------------------------------------------------------
create or replace function public.re_my_listings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'title', l.title,
        'price_cents', l.price_cents,
        'currency', l.currency,
        'price_period', l.price_period,
        'listing_kind', l.listing_kind,
        'status', l.status,
        'verification_status', l.verification_status,
        'eids_status', l.eids_status,
        'rejection_reason', l.rejection_reason,
        'category_slug', c.slug,
        'category_name', c.name,
        'district', d.name,
        'neighborhood', n.name,
        'cover_path', (
          select m.storage_path from public.real_estate_media m
          where m.listing_id = l.id and m.status = 'approved'
          order by m.cover desc, m.sort_order limit 1
        ),
        'view_count', l.view_count,
        'favorite_count', l.favorite_count,
        'created_at', l.created_at,
        'updated_at', l.updated_at,
        'published_at', l.published_at
      ) order by l.created_at desc)
      from public.real_estate_listings l
      join public.real_estate_categories c on c.id = l.category_id
      left join public.districts d on d.id = l.district_id
      left join public.neighborhoods n on n.id = l.neighborhood_id
      where l.owner_id = v_uid
    ), '[]'::jsonb),
    'eids_enabled', public.tz_app_flag('real_estate.eids_enabled')
  );
end;
$$;

revoke all on function public.re_my_listings() from public, anon;
grant execute on function public.re_my_listings() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Favoriler
-- ---------------------------------------------------------------------
create or replace function public.re_favorite_toggle(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_exists boolean;
  v_count integer;
begin
  if not exists (
    select 1 from public.real_estate_listings
    where id = p_listing_id and status = 'published'
  ) then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.real_estate_favorites
    where listing_id = p_listing_id and user_id = v_uid
  ) into v_exists;

  if v_exists then
    delete from public.real_estate_favorites where listing_id = p_listing_id and user_id = v_uid;
  else
    insert into public.real_estate_favorites (listing_id, user_id) values (p_listing_id, v_uid);
  end if;

  select favorite_count into v_count from public.real_estate_listings where id = p_listing_id;
  return jsonb_build_object('favorite', not v_exists, 'favorite_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.re_favorite_toggle(uuid) from public, anon;
grant execute on function public.re_favorite_toggle(uuid) to authenticated, service_role;

create or replace function public.re_favorites_list(
  p_limit integer default 30,
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
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return public.re_list(
    null, null, null, null, null, null, null, null, null, null, null,
    'new', null, true, false, v_limit, v_offset
  );
end;
$$;

revoke all on function public.re_favorites_list(integer, integer) from public, anon;
grant execute on function public.re_favorites_list(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Kaydedilen aramalar + alarm
-- ---------------------------------------------------------------------
create or replace function public.re_saved_search_save(
  p_label text,
  p_filters jsonb default '{}'::jsonb,
  p_polygon jsonb default null,
  p_notify boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_area geography;
  v_id uuid;
begin
  if v_label is null or char_length(v_label) > 120 then
    raise exception 'label_required' using errcode = '22023';
  end if;
  if p_filters is not null and jsonb_typeof(p_filters) <> 'object' then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if p_polygon is not null then
    v_area := public.tz_geo_polygon(p_polygon, true);
  end if;

  insert into public.real_estate_saved_searches (user_id, label, filters, boundary, notify_enabled)
  values (v_uid, v_label, coalesce(p_filters, '{}'::jsonb), v_area, coalesce(p_notify, false))
  returning id into v_id;

  if coalesce(p_notify, false) then
    insert into public.real_estate_alerts (user_id, saved_search_id)
    values (v_uid, v_id)
    on conflict (saved_search_id) do nothing;
  end if;

  return jsonb_build_object('id', v_id, 'notify_enabled', coalesce(p_notify, false));
end;
$$;

revoke all on function public.re_saved_search_save(text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.re_saved_search_save(text, jsonb, jsonb, boolean) to authenticated, service_role;

create or replace function public.re_saved_searches_list()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'label', s.label,
    'filters', s.filters,
    'notify_enabled', s.notify_enabled,
    'created_at', s.created_at,
    'geometry', case when s.boundary is null then null
                     else st_asgeojson(s.boundary::geometry)::jsonb end,
    'last_notified_at', a.last_notified_at
  ) order by s.created_at desc), '[]'::jsonb)
  from public.real_estate_saved_searches s
  left join public.real_estate_alerts a on a.saved_search_id = s.id
  where s.user_id = public.tz_require_uid();
$$;

revoke all on function public.re_saved_searches_list() from public, anon;
grant execute on function public.re_saved_searches_list() to authenticated, service_role;

create or replace function public.re_saved_search_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_deleted integer := 0;
begin
  delete from public.real_estate_saved_searches where id = p_id and user_id = v_uid;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', v_deleted > 0);
end;
$$;

revoke all on function public.re_saved_search_delete(uuid) from public, anon;
grant execute on function public.re_saved_search_delete(uuid) to authenticated, service_role;

create or replace function public.re_saved_search_notify(p_id uuid, p_notify boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  update public.real_estate_saved_searches
     set notify_enabled = coalesce(p_notify, false)
   where id = p_id and user_id = v_uid;

  if not found then
    raise exception 'saved_search_not_found' using errcode = 'P0002';
  end if;

  if coalesce(p_notify, false) then
    insert into public.real_estate_alerts (user_id, saved_search_id)
    values (v_uid, p_id)
    on conflict (saved_search_id) do nothing;
  else
    delete from public.real_estate_alerts where saved_search_id = p_id and user_id = v_uid;
  end if;

  return jsonb_build_object('ok', true, 'notify_enabled', coalesce(p_notify, false));
end;
$$;

revoke all on function public.re_saved_search_notify(uuid, boolean) from public, anon;
grant execute on function public.re_saved_search_notify(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Alarm dağıtımı (admin publish tarafından çağrılır)
-- ---------------------------------------------------------------------
create or replace function public.tz_re_dispatch_alerts(p_listing_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_listing public.real_estate_listings%rowtype;
  v_category public.real_estate_categories%rowtype;
  v_saved record;
  v_count integer := 0;
  v_match boolean;
begin
  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found or v_listing.status <> 'published' then
    return 0;
  end if;

  select * into v_category from public.real_estate_categories where id = v_listing.category_id;

  for v_saved in
    select s.id, s.user_id, s.filters, s.boundary
    from public.real_estate_saved_searches s
    join public.real_estate_alerts a on a.saved_search_id = s.id
    where s.notify_enabled
  loop
    v_match := true;

    if v_saved.boundary is not null and not st_covers(v_saved.boundary, v_listing.public_geog) then
      v_match := false;
    end if;

    if v_match and v_saved.filters ? 'listing_kind'
       and (v_saved.filters ->> 'listing_kind') <> v_listing.listing_kind then
      v_match := false;
    end if;

    if v_match and v_saved.filters ? 'category_slug'
       and (v_saved.filters ->> 'category_slug') <> v_category.slug then
      v_match := false;
    end if;

    if v_match and v_saved.filters ? 'district_id'
       and (v_saved.filters ->> 'district_id')::bigint <> v_listing.district_id then
      v_match := false;
    end if;

    if v_match and v_saved.filters ? 'min_price'
       and v_listing.price_cents < ((v_saved.filters ->> 'min_price')::numeric * 100)::bigint then
      v_match := false;
    end if;

    if v_match and v_saved.filters ? 'max_price'
       and v_listing.price_cents > ((v_saved.filters ->> 'max_price')::numeric * 100)::bigint then
      v_match := false;
    end if;

    if v_match and v_saved.filters ? 'min_m2'
       and coalesce(v_listing.net_m2, v_listing.gross_m2, 0) < (v_saved.filters ->> 'min_m2')::integer then
      v_match := false;
    end if;

    if v_match and v_saved.filters ? 'max_m2'
       and coalesce(v_listing.net_m2, v_listing.gross_m2, 0) > (v_saved.filters ->> 'max_m2')::integer then
      v_match := false;
    end if;

    if v_match and v_saved.filters ? 'rooms'
       and v_listing.room_count is not null
       and v_listing.room_count <> (v_saved.filters ->> 'rooms')::smallint then
      v_match := false;
    end if;

    if v_match then
      -- Aynı ilan için tekrar bildirim gönderilmez.
      if not exists (
        select 1 from public.notifications n
        where n.user_id = v_saved.user_id
          and n.entity_type = 'real_estate_listing'
          and n.entity_id = p_listing_id::text
      ) then
        perform public.tz_notify(
          v_saved.user_id,
          null,
          'system',
          'Yeni emlak ilanı',
          left(v_listing.title || ' · ' || v_category.name, 400),
          'real_estate_listing',
          p_listing_id::text,
          '/marketplace/real-estate/' || p_listing_id::text
        );
        update public.real_estate_alerts
           set last_notified_at = now()
         where saved_search_id = v_saved.id;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.tz_re_dispatch_alerts(uuid) from public, anon, authenticated;
