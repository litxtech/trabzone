-- 0055 — Birleşik arama merkezine kategori türü filtresi.
drop function if exists public.market_search_hub(text, integer);

create or replace function public.market_search_hub(
  p_query text,
  p_limit integer default 8,
  p_kind text default null
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
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
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
      and (v_kind is null or c.kind = v_kind)
      and (
        l.title ilike '%' || v_query || '%'
        or c.name ilike '%' || v_query || '%'
        or sp.username ilike '%' || v_query || '%'
        or l.attributes::text ilike '%' || v_query || '%'
      )
    order by coalesce(l.published_at, l.created_at) desc
    limit v_limit
  ) l;

  v_categories := public.market_category_search(v_query, v_limit);
  if v_kind is not null then
    select coalesce(jsonb_agg(entry), '[]'::jsonb)
    into v_categories
    from jsonb_array_elements(v_categories) entry
    where entry->>'kind' = v_kind;
  end if;

  if v_kind is null or v_kind = 'place' then
    select coalesce(jsonb_agg(public.tz_place_marker_json(p, c, d.name, n.name) order by p.rating_avg desc nulls last), '[]'::jsonb)
    into v_places
    from (
      select pl.*
      from public.places pl
      left join public.place_categories pc on pc.id = pl.category_id
      where pl.status = 'published'
        and (
          pl.name ilike '%' || v_query || '%'
          or coalesce(pl.description, '') ilike '%' || v_query || '%'
          or coalesce(pl.address, '') ilike '%' || v_query || '%'
          or coalesce(pc.name, '') ilike '%' || v_query || '%'
        )
      limit v_limit
    ) p
    left join public.place_categories c on c.id = p.category_id
    left join public.districts d on d.id = p.district_id
    left join public.neighborhoods n on n.id = p.neighborhood_id;
  else
    v_places := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'listings', v_listings,
    'categories', v_categories,
    'places', v_places
  );
end;
$$;

revoke all on function public.market_search_hub(text, integer, text) from public, anon;
grant execute on function public.market_search_hub(text, integer, text) to authenticated, service_role;

comment on function public.market_search_hub(text, integer, text) is
  'Marketplace birleşik arama: ilanlar + kategori yolları/aliases + işletmeler. Tür filtresi opsiyonel.';
