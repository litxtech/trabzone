-- ---------------------------------------------------------------------
-- Tesis formu için ilçe / mahalle referans verisi
-- ---------------------------------------------------------------------
-- Sorun: tesis ekleme formu ilçe listesini `acc_public_filters` üzerinden
-- okuyordu. O fonksiyon yalnızca **yayında tesis bulunan** ilçeleri döndürdüğü
-- için pazaryerinde hiç yayınlanmış tesis yokken liste boş geliyor, işletmeci
-- ilçe seçemediği için onboarding ilerlemiyordu.
--
-- Bu fonksiyon şehrin tüm aktif ilçelerini (mahalleleriyle) döner; yayın
-- durumundan bağımsızdır. Kamuya açık keşfet filtresi (`acc_public_filters`)
-- davranışı bilinçli olarak değiştirilmedi: müşteri tarafında yalnızca gerçekten
-- sonuç dönen ilçeler listelenmeye devam eder.
create or replace function public.acc_property_location_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_city public.cities%rowtype;
begin
  perform public.tz_require_uid();

  select * into v_city
  from public.cities
  where is_active
  order by plate_code
  limit 1;

  if not found then
    raise exception 'service_area_unavailable' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'city', jsonb_build_object(
      'id', v_city.id,
      'name', v_city.name,
      'slug', v_city.slug,
      'center_lat', v_city.center_lat,
      'center_lng', v_city.center_lng
    ),
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'lat', d.center_lat,
        'lng', d.center_lng,
        'neighborhoods', coalesce((
          select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name) order by n.name)
          from public.neighborhoods n
          where n.district_id = d.id
        ), '[]'::jsonb)
      ) order by d.name)
      from public.districts d
      where d.city_id = v_city.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.acc_property_location_options() from public;
revoke all on function public.acc_property_location_options() from anon;
grant execute on function public.acc_property_location_options() to authenticated, service_role;
