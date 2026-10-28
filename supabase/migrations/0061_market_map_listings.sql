-- =====================================================================
-- 0057 — Marketplace harita katmanı
--
-- Aktif ve moderasyonu görünür ilanları bbox veya çizilen polygon ile
-- döndürür. Emlak ve taşıt ilanlarında konum her zaman yaklaşıklaştırılır;
-- ürün/hizmet ilanlarında yalnızca satıcı hassas konumu gizlediyse
-- yaklaşık koordinat verilir. Doğrudan adres veya açık koordinat sızdırmaz.
-- =====================================================================

set search_path = public, extensions;

drop function if exists public.market_map_listings(jsonb, jsonb, text[], integer);

create or replace function public.market_map_listings(
  p_bbox jsonb default null,
  p_polygon jsonb default null,
  p_kinds text[] default null,
  p_limit integer default 300,
  p_min_price bigint default null,
  p_max_price bigint default null,
  p_district_id bigint default null,
  p_condition text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 500);
  v_bbox_west double precision;
  v_bbox_east double precision;
  v_bbox_south double precision;
  v_bbox_north double precision;
  v_polygon geography;
  v_items jsonb;
begin
  if p_bbox is not null and jsonb_typeof(p_bbox) = 'object' then
    v_bbox_west := (p_bbox ->> 'west')::double precision;
    v_bbox_east := (p_bbox ->> 'east')::double precision;
    v_bbox_south := (p_bbox ->> 'south')::double precision;
    v_bbox_north := (p_bbox ->> 'north')::double precision;
  end if;

  if p_polygon is not null and jsonb_typeof(p_polygon) = 'object' then
    begin
      v_polygon := st_setsrid(st_geomfromgeojson(p_polygon::text), 4326)::geography;
    exception when others then
      raise exception 'invalid_polygon' using errcode = '22023';
    end;
    if not st_isvalid(v_polygon::geometry) then
      raise exception 'invalid_polygon' using errcode = '22023';
    end if;
  end if;

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', l.id,
      'title', l.title,
      'price_cents', l.price_cents,
      'currency', l.currency,
      'price_period', l.price_period,
      'listing_kind', l.attributes ->> 'listing_kind',
      'kind', c.kind,
      'category_slug', c.slug,
      'category_name', c.name,
      'category_icon', c.icon,
      'district', d.name,
      'neighborhood', n.name,
      'lat', case
        when l.hide_exact_location or c.kind in ('real_estate', 'vehicle')
          then round(l.lat::numeric, 2)::double precision
        else l.lat
      end,
      'lng', case
        when l.hide_exact_location or c.kind in ('real_estate', 'vehicle')
          then round(l.lng::numeric, 2)::double precision
        else l.lng
      end,
      'approximate', (l.hide_exact_location or c.kind in ('real_estate', 'vehicle')),
      'cover_path', (
        select i.storage_path from public.marketplace_listing_images i
        where i.listing_id = l.id
        order by i.is_cover desc, i.sort_order, i.created_at
        limit 1
      ),
      'created_at', l.created_at,
      'published_at', l.published_at
    ) as item,
    l.created_at
    from public.marketplace_listings l
    join public.marketplace_categories c on c.id = l.category_id
    left join public.districts d on d.id = l.district_id
    left join public.neighborhoods n on n.id = l.neighborhood_id
    where l.status = 'active'
      and l.moderation_status = 'visible'
      and l.lat is not null
      and l.lng is not null
      and (p_kinds is null or c.kind = any(p_kinds))
      and (p_min_price is null or l.price_cents >= p_min_price)
      and (p_max_price is null or l.price_cents <= p_max_price)
      and (p_district_id is null or l.district_id = p_district_id)
      and (p_condition is null or l.condition = p_condition)
      and (
        v_bbox_west is null
        or (l.lng >= v_bbox_west and l.lng <= v_bbox_east and l.lat >= v_bbox_south and l.lat <= v_bbox_north)
      )
      and (
        v_polygon is null
        or st_intersects(
          coalesce(l.geog, st_setsrid(st_makepoint(l.lng, l.lat), 4326)::geography),
          v_polygon
        )
      )
    order by l.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object('items', v_items, 'limit', v_limit);
end;
$$;

revoke all on function public.market_map_listings(jsonb, jsonb, text[], integer, bigint, bigint, bigint, text) from public;
grant execute on function public.market_map_listings(jsonb, jsonb, text[], integer, bigint, bigint, bigint, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
