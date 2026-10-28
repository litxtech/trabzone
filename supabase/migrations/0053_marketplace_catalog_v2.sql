-- 0053 — Marketplace katalog v2: kategori ağacı, alan çizimi, detay ve benzer ilanlar.
-- Mevcut tabloları yeniden kullanır; yeni tablo oluşturmaz.

-- ---------------------------------------------------------------------
-- 1. Genişletilmiş katalog: alt kategori, mahalle, poligon, bbox, yakınlık
-- ---------------------------------------------------------------------
create or replace function public.market_catalog_v2(
  p_query text default null,
  p_kind text default null,
  p_category text default null,
  p_subcategory text default null,
  p_district_id bigint default null,
  p_neighborhood_id bigint default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_condition text default null,
  p_sort text default 'new',
  p_favorites boolean default false,
  p_mine boolean default false,
  p_attributes jsonb default '{}'::jsonb,
  p_polygon jsonb default null,
  p_bbox jsonb default null,
  p_lat double precision default null,
  p_lng double precision default null,
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
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_subcategory text := nullif(btrim(coalesce(p_subcategory, '')), '');
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'new'));
  v_attrs jsonb := case when jsonb_typeof(coalesce(p_attributes, '{}'::jsonb)) = 'object'
                        then coalesce(p_attributes, '{}'::jsonb) else '{}'::jsonb end;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_poly extensions.geometry;
  v_bbox extensions.geometry;
  v_origin extensions.geography;
  v_items jsonb;
  v_total bigint;
begin
  if v_sort not in ('new', 'price_asc', 'price_desc', 'popular', 'near') then
    v_sort := 'new';
  end if;

  if p_polygon is not null and jsonb_typeof(p_polygon) = 'array' and jsonb_array_length(p_polygon) >= 3 then
    begin
      v_poly := st_setsrid(st_geomfromgeojson(jsonb_build_object(
        'type', 'Polygon',
        'coordinates', jsonb_build_array(
          case when (p_polygon -> 0) = (p_polygon -> (jsonb_array_length(p_polygon) - 1))
               then p_polygon
               else p_polygon || jsonb_build_array(p_polygon -> 0)
          end
        )
      )), 4326);
    exception when others then
      v_poly := null;
    end;
  end if;

  if p_bbox is not null and jsonb_typeof(p_bbox) = 'object' then
    begin
      v_bbox := st_setsrid(st_makeenvelope(
        (p_bbox ->> 'west')::double precision,
        (p_bbox ->> 'south')::double precision,
        (p_bbox ->> 'east')::double precision,
        (p_bbox ->> 'north')::double precision,
        4326
      ), 4326);
    exception when others then
      v_bbox := null;
    end;
  end if;

  if p_lat is not null and p_lng is not null then
    v_origin := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  with recursive
  cat as (
    select c.id
    from public.marketplace_categories c
    where c.slug = v_category and c.is_active
    union all
    select ch.id
    from public.marketplace_categories ch
    join cat on ch.parent_id = cat.id
    where ch.is_active
  ),
  subcat as (
    select c.id
    from public.marketplace_categories c
    where c.slug = v_subcategory and c.is_active
    union all
    select ch.id
    from public.marketplace_categories ch
    join subcat on ch.parent_id = subcat.id
    where ch.is_active
  ),
  filtered as (
    select
      l.id,
      l.price_cents,
      (l.favorite_count * 3 + l.view_count) as popularity,
      coalesce(l.published_at, l.created_at) as fresh_at,
      case when v_origin is not null and l.geog is not null
           then st_distance(l.geog, v_origin) else null end as distance_m
    from public.marketplace_listings l
    join public.profiles sp on sp.id = l.seller_id
    join public.marketplace_categories c on c.id = l.category_id
    where (
        (coalesce(p_mine, false) and l.seller_id = v_uid)
        or (
          not coalesce(p_mine, false)
          and l.moderation_status = 'visible'
          and l.status = 'active'
          and sp.account_status = 'active'
          and not public.is_blocked(v_uid, l.seller_id)
          and (l.expires_at is null or l.expires_at > now())
        )
      )
      and (
        not coalesce(p_favorites, false)
        or exists (
          select 1 from public.marketplace_favorites f
          where f.listing_id = l.id and f.user_id = v_uid
        )
      )
      and (v_category is null or l.category_id in (select id from cat))
      and (v_subcategory is null or l.category_id in (select id from subcat))
      and (v_kind is null or c.kind = v_kind)
      and (p_district_id is null or l.district_id = p_district_id)
      and (p_neighborhood_id is null or l.neighborhood_id = p_neighborhood_id)
      and (p_min_price is null or l.price_cents >= (p_min_price * 100)::bigint)
      and (p_max_price is null or l.price_cents <= (p_max_price * 100)::bigint)
      and (nullif(p_condition, '') is null or l.condition = p_condition)
      and (v_attrs = '{}'::jsonb or l.attributes @> v_attrs)
      and (v_poly is null or (l.geog is not null and st_intersects(l.geog, v_poly::geography)))
      and (v_bbox is null or (l.geog is not null and st_intersects(l.geog, v_bbox::geography)))
      and (
        v_query is null
        or l.title ilike '%' || v_query || '%'
        or coalesce(l.description, '') ilike '%' || v_query || '%'
        or c.name ilike '%' || v_query || '%'
        or l.attributes::text ilike '%' || v_query || '%'
      )
  ),
  counted as (
    select f.*, count(*) over() as total
    from filtered f
    order by
      case when v_sort = 'price_asc' then f.price_cents end asc nulls last,
      case when v_sort = 'price_desc' then f.price_cents end desc nulls last,
      case when v_sort = 'popular' then f.popularity end desc nulls last,
      case when v_sort = 'near' and f.distance_m is not null then f.distance_m end asc nulls last,
      case when v_sort = 'new' then f.fresh_at end desc nulls last,
      f.fresh_at desc,
      f.id
    limit v_limit offset v_offset
  )
  select
    coalesce(jsonb_agg(public.tz_listing_json_v2(c.id, v_uid)
             order by
               case when v_sort = 'price_asc' then c.price_cents end asc nulls last,
               case when v_sort = 'price_desc' then c.price_cents end desc nulls last,
               case when v_sort = 'popular' then c.popularity end desc nulls last,
               case when v_sort = 'near' and c.distance_m is not null then c.distance_m end asc nulls last,
               case when v_sort = 'new' then c.fresh_at end desc nulls last,
               c.fresh_at desc,
               c.id
             ), '[]'::jsonb),
    coalesce(max(c.total), 0)
  into v_items, v_total
  from counted c;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.market_catalog_v2(
  text, text, text, text, bigint, bigint, numeric, numeric, text, text,
  boolean, boolean, jsonb, jsonb, jsonb, double precision, double precision, integer, integer
) from public, anon;
grant execute on function public.market_catalog_v2(
  text, text, text, text, bigint, bigint, numeric, numeric, text, text,
  boolean, boolean, jsonb, jsonb, jsonb, double precision, double precision, integer, integer
) to authenticated, service_role;

comment on function public.market_catalog_v2(
  text, text, text, text, bigint, bigint, numeric, numeric, text, text,
  boolean, boolean, jsonb, jsonb, jsonb, double precision, double precision, integer, integer
) is 'Marketplace katalog v2: kategori ağacı, alt kategori, poligon/bbox alan araması ve yakınlık sıralaması.';

-- ---------------------------------------------------------------------
-- 2. İlan detayı + satıcı özeti + benzer ilanlar + görüntülenme sayacı
-- ---------------------------------------------------------------------
create or replace function public.market_listing_detail(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.marketplace_listings%rowtype;
  v_listing jsonb;
  v_seller jsonb;
  v_similar jsonb;
  v_other_count integer;
begin
  select * into v_row from public.marketplace_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;

  if v_row.seller_id <> v_uid and not public.is_admin() then
    if v_row.moderation_status <> 'visible'
       or v_row.status not in ('active', 'reserved', 'sold') then
      raise exception 'listing_not_available' using errcode = 'P0002';
    end if;
    if exists (
      select 1 from public.profiles p
      where p.id = v_row.seller_id and p.account_status <> 'active'
    ) then
      raise exception 'listing_not_available' using errcode = 'P0002';
    end if;
    update public.marketplace_listings
       set view_count = view_count + 1
     where id = v_row.id;
  end if;

  v_listing := public.tz_listing_json_v2(p_listing_id, v_uid);

  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      p.username
    ),
    'avatar_path', p.avatar_path,
    'is_verified', p.is_verified,
    'account_status', p.account_status,
    'created_at', p.created_at,
    'active_listings', (
      select count(*) from public.marketplace_listings l
      where l.seller_id = p.id and l.status = 'active'
        and l.moderation_status = 'visible'
    ),
    'sold_listings', (
      select count(*) from public.marketplace_listings l
      where l.seller_id = p.id and l.status = 'sold'
    ),
    'rating', (
      select round(avg(r.rating)::numeric, 1)
      from public.marketplace_reviews r
      where r.seller_id = p.id
    ),
    'review_count', (
      select count(*) from public.marketplace_reviews r where r.seller_id = p.id
    )
  )
  into v_seller
  from public.profiles p
  where p.id = v_row.seller_id;

  select coalesce(jsonb_agg(public.tz_listing_json_v2(s.id, v_uid) order by s.fresh_at desc), '[]'::jsonb)
  into v_similar
  from (
    select l.id, coalesce(l.published_at, l.created_at) as fresh_at
    from public.marketplace_listings l
    join public.profiles sp on sp.id = l.seller_id
    where l.id <> v_row.id
      and l.category_id = v_row.category_id
      and l.status = 'active'
      and l.moderation_status = 'visible'
      and sp.account_status = 'active'
      and (l.expires_at is null or l.expires_at > now())
      and not public.is_blocked(v_uid, l.seller_id)
    order by coalesce(l.published_at, l.created_at) desc
    limit 6
  ) s;

  select count(*) into v_other_count
  from public.marketplace_listings l
  where l.seller_id = v_row.seller_id
    and l.id <> v_row.id
    and l.status = 'active'
    and l.moderation_status = 'visible';

  return jsonb_build_object(
    'listing', v_listing,
    'seller', coalesce(v_seller, '{}'::jsonb),
    'similar', v_similar,
    'seller_listing_count', v_other_count
  );
end;
$$;

revoke all on function public.market_listing_detail(uuid) from public, anon;
grant execute on function public.market_listing_detail(uuid) to authenticated, service_role;

comment on function public.market_listing_detail(uuid) is
  'İlan detayı: ilan, satıcı özeti, benzer ilanlar; sahibi dışındaki görüntülemeleri sayar.';

-- ---------------------------------------------------------------------
-- 3. Arama önerileri: ilan + kategori + işletme birleşik
-- ---------------------------------------------------------------------
create or replace function public.market_search_hub(p_query text, p_limit integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 12);
  v_listings jsonb;
  v_categories jsonb;
  v_places jsonb;
begin
  if v_query is null or char_length(v_query) < 2 then
    return jsonb_build_object('listings', '[]'::jsonb, 'categories', '[]'::jsonb, 'places', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(public.tz_listing_json_v2(l.id, v_uid) order by coalesce(l.published_at, l.created_at) desc), '[]'::jsonb)
  into v_listings
  from (
    select l.id, l.published_at, l.created_at
    from public.marketplace_listings l
    join public.profiles sp on sp.id = l.seller_id
    join public.marketplace_categories c on c.id = l.category_id
    where l.status = 'active'
      and l.moderation_status = 'visible'
      and sp.account_status = 'active'
      and not public.is_blocked(v_uid, l.seller_id)
      and (l.expires_at is null or l.expires_at > now())
      and (
        l.title ilike '%' || v_query || '%'
        or c.name ilike '%' || v_query || '%'
        or l.attributes::text ilike '%' || v_query || '%'
      )
    order by coalesce(l.published_at, l.created_at) desc
    limit v_limit
  ) l;

  v_categories := public.market_category_search(v_query, v_limit);

  select coalesce(jsonb_agg(public.tz_place_marker_json(p, c, d.name, n.name) order by p.rating_avg desc nulls last), '[]'::jsonb)
  into v_places
  from (
    select pl.*
    from public.places pl
    where pl.status = 'published'
      and (
        pl.name ilike '%' || v_query || '%'
        or coalesce(pl.description, '') ilike '%' || v_query || '%'
        or coalesce(pl.address, '') ilike '%' || v_query || '%'
      )
    limit v_limit
  ) p
  left join public.place_categories c on c.id = p.category_id
  left join public.districts d on d.id = p.district_id
  left join public.neighborhoods n on n.id = p.neighborhood_id;

  return jsonb_build_object(
    'listings', v_listings,
    'categories', v_categories,
    'places', v_places
  );
end;
$$;

revoke all on function public.market_search_hub(text, integer) from public, anon;
grant execute on function public.market_search_hub(text, integer) to authenticated, service_role;

comment on function public.market_search_hub(text, integer) is
  'Marketplace arama önerileri: gerçek ilan, kategori ve işletme sonuçları.';
