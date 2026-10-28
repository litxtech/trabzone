-- 0086: `re_get` çağrı argümanı sınırı düzeltmesi
--
-- `jsonb_build_object` variadic olduğu için PostgreSQL en fazla 100 argüma
-- izin verir (50 anahtar/değer çifti). `re_get` 47 çift ile sınıra yaklaşmış
-- ve sonradan eklenen alanlarla birlikte çalışma zamanında
-- "cannot pass more than 100 arguments to a function" hatası veriyordu.
-- Bu migration gövdeyi iki `jsonb_build_object` çağrısının birleşimine böler.

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
    'is_mine', v_is_owner
  ) || jsonb_build_object(
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

comment on function public.re_get(uuid) is
  'Emlak ilan detayı. Gövde, jsonb_build_object 50 çift sınırı nedeniyle iki parçaya bölünmüştür.';
