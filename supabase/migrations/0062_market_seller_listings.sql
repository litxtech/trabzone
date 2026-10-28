-- 0056 — Satıcı profilindeki "diğer ilanlar" için güvenli, sayfalı RPC.
create or replace function public.market_seller_listings_v2(
  p_seller_id uuid,
  p_limit integer default 12,
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
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total bigint;
begin
  if p_seller_id is null then
    return jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'has_more', false);
  end if;

  select
    coalesce(jsonb_agg(public.tz_listing_json_v2(x.id, v_uid) order by x.fresh_at desc), '[]'::jsonb),
    coalesce(max(x.total), 0)
  into v_items, v_total
  from (
    select
      l.id,
      coalesce(l.published_at, l.created_at) as fresh_at,
      count(*) over() as total
    from public.marketplace_listings l
    join public.profiles sp on sp.id = l.seller_id
    where l.seller_id = p_seller_id
      and l.status = 'active'
      and l.moderation_status = 'visible'
      and sp.account_status = 'active'
      and (l.expires_at is null or l.expires_at > now())
      and (v_uid = p_seller_id or not public.is_blocked(v_uid, l.seller_id))
    order by coalesce(l.published_at, l.created_at) desc
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', (v_offset + jsonb_array_length(v_items)) < v_total
  );
end;
$$;

revoke all on function public.market_seller_listings_v2(uuid, integer, integer) from public, anon;
grant execute on function public.market_seller_listings_v2(uuid, integer, integer) to authenticated, service_role;

comment on function public.market_seller_listings_v2(uuid, integer, integer) is
  'Bir satıcının yayındaki ilanları; engelleme ve hesap durumu kurallarına uyar.';
