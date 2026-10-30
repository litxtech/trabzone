-- ---------------------------------------------------------------------------
-- Eczane rehberi — herkese açık SSR/SEO sayfası için kaynak bilgisi
--
-- `pharmacy_public_page` yalnızca yayındaki eczaneleri döner. SEO sayfasında
-- envanterin hangi kaynaktan geldiğini ve lisans/atıf metnini dürüstçe
-- gösterebilmek için `inventory_source` ile birlikte türetilmiş atıf alanı
-- eklenir. Adres, telefon, nöbet saati gibi alanlar UYDURULMAZ; yoksa `null`
-- döner ve sayfa "bilinmiyor" olarak işler.
-- ---------------------------------------------------------------------------

create or replace function public.pharmacy_public_page(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_place public.places%rowtype;
  v_profile public.pharmacy_profiles%rowtype;
  v_district text;
  v_district_slug text;
  v_state jsonb;
  v_duty jsonb;
  v_attribution text;
begin
  select p.* into v_place
  from public.places p
  join public.pharmacy_profiles pp on pp.place_id = p.id
  join public.place_categories c on c.id = p.category_id
  where pp.slug = lower(btrim(coalesce(p_slug, '')))
    and c.slug = 'eczane'
    and p.status = 'published';

  if v_place.id is null then
    return null;
  end if;

  select * into v_profile from public.pharmacy_profiles where place_id = v_place.id;
  select d.name, d.slug into v_district, v_district_slug
  from public.districts d where d.id = v_place.district_id;

  v_state := public.pharmacy_state(v_place.id, now());

  select coalesce(jsonb_agg(jsonb_build_object(
    'duty_date', s.duty_date,
    'starts_at', s.starts_at,
    'ends_at', s.ends_at,
    'status', s.status
  ) order by s.starts_at), '[]'::jsonb)
  into v_duty
  from public.pharmacy_duty_schedules s
  where s.place_id = v_place.id
    and s.status = 'confirmed'
    and s.ends_at >= now() - interval '1 day'
    and s.starts_at <= now() + interval '14 days';

  v_attribution := case v_profile.inventory_source
    when 'osm' then 'Eczane envanteri: © OpenStreetMap katkıcıları (ODbL)'
    when 'official_list' then 'Eczane envanteri: yetkili kurum listesi'
    when 'pharmacy_bulletin' then 'Eczane envanteri: eczacı odası bülteni'
    when 'manual_verified' then 'Eczane envanteri: elle doğrulanmış kayıt'
    else null
  end;

  return jsonb_build_object(
    'slug', v_profile.slug,
    'name', v_place.name,
    'district', v_district,
    'district_slug', v_district_slug,
    'neighborhood', v_profile.neighborhood,
    'address', coalesce(v_profile.address_text, v_place.address),
    'phone', coalesce(v_profile.phone_text, v_place.phone),
    'lat', v_place.lat,
    'lng', v_place.lng,
    'rating', v_place.rating_avg,
    'review_count', v_place.review_count,
    'data_verified', v_profile.data_verified_at is not null,
    'data_verified_at', v_profile.data_verified_at,
    'inventory_source', v_profile.inventory_source,
    'inventory_attribution', v_attribution,
    'working_hours', v_profile.working_hours,
    'working_hours_source', v_profile.working_hours_source,
    'state', v_state,
    'duty', v_duty,
    'updated_at', greatest(v_place.updated_at, v_profile.updated_at)
  );
end;
$$;

revoke all on function public.pharmacy_public_page(text) from public;
grant execute on function public.pharmacy_public_page(text) to anon, authenticated, service_role;
