-- ---------------------------------------------------------------------------
-- Harici işletme sağlayıcı adlarını tek biçime indirger.
--
-- 2026-10-27'de OpenStreetMap işletmeleri `openstreetmap` etiketiyle
-- aktarıldı (1.695 kayıt). Uygulama harita sonucunu seçtiğinde ise sağlayıcı
-- adı `osm` olarak geliyordu; aynı işletme ikinci kez eklenmesin diye
-- karşılaştırma sırasında iki ad birlikte kabul edilir ve yazarken her zaman
-- `openstreetmap` kullanılır.
-- ---------------------------------------------------------------------------

update public.places
set external_provider = 'openstreetmap'
where external_provider = 'osm';

-- ---------------------------------------------------------------------------
-- place_import_external: sağlayıcı eşleştirmesi ve normalizasyonu
-- ---------------------------------------------------------------------------

create or replace function public.place_import_external(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_name text := nullif(btrim(coalesce(p_payload ->> 'name', '')), '');
  v_provider text := nullif(btrim(coalesce(p_payload ->> 'provider', '')), '');
  v_external_id text := nullif(btrim(coalesce(p_payload ->> 'external_id', '')), '');
  v_address text := nullif(btrim(coalesce(p_payload ->> 'address', '')), '');
  v_phone text := nullif(btrim(coalesce(p_payload ->> 'phone', '')), '');
  v_website text := nullif(btrim(coalesce(p_payload ->> 'website', '')), '');
  v_category_slug text := nullif(btrim(coalesce(p_payload ->> 'category_slug', '')), '');
  v_rating numeric := nullif(p_payload ->> 'rating', '')::numeric;
  v_rating_count integer := coalesce(nullif(p_payload ->> 'rating_count', '')::integer, 0);
  v_lat double precision := nullif(p_payload ->> 'lat', '')::double precision;
  v_lng double precision := nullif(p_payload ->> 'lng', '')::double precision;
  v_point geography;
  v_city public.cities%rowtype;
  v_category public.place_categories%rowtype;
  v_district public.districts%rowtype;
  v_hood_id bigint;
  v_place public.places%rowtype;
  v_created integer;
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 140 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_lat is null or v_lng is null then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  if not public.tz_in_trabzon_bbox(v_lat, v_lng) then
    raise exception 'outside_service_area' using errcode = '22023';
  end if;

  -- Sağlayıcı adları: arayüz `osm` gönderir, veritabanı `openstreetmap` tutar.
  if v_provider = 'osm' then
    v_provider := 'openstreetmap';
  end if;
  if v_provider is not null and v_provider not in ('google', 'apple', 'openstreetmap', 'mapbox') then
    raise exception 'invalid_provider' using errcode = '22023';
  end if;

  if v_address is not null then
    v_address := left(v_address, 400);
  end if;
  if v_phone is not null and (char_length(v_phone) < 7 or char_length(v_phone) > 30) then
    v_phone := null;
  end if;
  if v_website is not null and v_website !~ '^https?://[^\s]+$' then
    v_website := null;
  end if;
  if v_rating is not null then
    v_rating := least(greatest(v_rating, 0), 5);
  end if;
  v_rating_count := greatest(coalesce(v_rating_count, 0), 0);

  v_point := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;

  -- 1) Dış kimlikle daha önce aktarılmış mı?
  if v_provider is not null and v_external_id is not null then
    select * into v_place
    from public.places
    where external_provider = v_provider
      and external_id = v_external_id
    limit 1;
    if found then
      return jsonb_build_object(
        'place_id', v_place.id,
        'created', false,
        'name', v_place.name,
        'category', null,
        'address', v_place.address,
        'lat', v_place.lat,
        'lng', v_place.lng
      );
    end if;
  end if;

  -- 2) Aynı işletme 150 m içinde farklı bir kaynakla kayıtlı mı?
  select * into v_place
  from public.places p
  where p.status in ('published', 'pending', 'duplicate')
    and p.geog is not null
    and st_dwithin(p.geog, v_point, 150)
    and (
      public.pharmacy_fold(p.name) = public.pharmacy_fold(v_name)
      or similarity(public.pharmacy_fold(p.name), public.pharmacy_fold(v_name)) > 0.6
    )
  order by st_distance(p.geog, v_point)
  limit 1;

  if found then
    -- Haritada ikinci bir işaretçi oluşmasın diye dış kimlik boşsa tamamlanır.
    update public.places
    set external_provider = coalesce(external_provider, v_provider),
        external_id = coalesce(external_id, v_external_id)
    where id = v_place.id;

    return jsonb_build_object(
      'place_id', v_place.id,
      'created', false,
      'name', v_place.name,
      'category', null,
      'address', v_place.address,
      'lat', v_place.lat,
      'lng', v_place.lng
    );
  end if;

  -- 3) Kötüye kullanım sınırı: kullanıcı günde en fazla 60 harita kaydı ekler.
  select count(*) into v_created
  from public.places
  where created_by = v_uid
    and external_provider is not null
    and created_at > now() - interval '24 hours';

  if v_created >= 60 then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  select * into v_city from public.cities where is_active order by plate_code limit 1;
  if not found then
    raise exception 'service_area_unavailable' using errcode = 'P0002';
  end if;

  -- İlçe en yakın merkezden çözülür; mahalle 6 km içindeyse bağlanır.
  select * into v_district
  from public.districts d
  where d.city_id = v_city.id
  order by st_distance(
    st_setsrid(st_makepoint(d.center_lng, d.center_lat), 4326)::geography,
    v_point
  )
  limit 1;

  if not found then
    raise exception 'invalid_district' using errcode = '22023';
  end if;

  select n.id into v_hood_id
  from public.neighborhoods n
  where n.district_id = v_district.id
    and n.center_lat is not null
    and n.center_lng is not null
    and st_dwithin(
      st_setsrid(st_makepoint(n.center_lng, n.center_lat), 4326)::geography,
      v_point,
      6000
    )
  order by st_distance(
    st_setsrid(st_makepoint(n.center_lng, n.center_lat), 4326)::geography,
    v_point
  )
  limit 1;

  if v_category_slug is not null then
    select * into v_category
    from public.place_categories
    where slug = v_category_slug and is_active;
    if not found then
      v_category := null;
    end if;
  end if;

  insert into public.places (
    created_by,
    name,
    category_id,
    city_id,
    district_id,
    neighborhood_id,
    address,
    address_public,
    lat,
    lng,
    phone,
    website,
    status,
    verification_status,
    is_verified,
    data_source,
    external_provider,
    external_id,
    rating_avg,
    rating_count
  )
  values (
    v_uid,
    v_name,
    v_category.id,
    v_city.id,
    v_district.id,
    v_hood_id,
    v_address,
    true,
    v_lat,
    v_lng,
    v_phone,
    v_website,
    'published',
    'unverified',
    false,
    'external_reference',
    v_provider,
    v_external_id,
    v_rating,
    v_rating_count
  )
  returning * into v_place;

  return jsonb_build_object(
    'place_id', v_place.id,
    'created', true,
    'name', v_place.name,
    'category', v_category.name,
    'address', v_place.address,
    'lat', v_place.lat,
    'lng', v_place.lng
  );
end;
$$;

revoke all on function public.place_import_external(jsonb) from public, anon;
grant execute on function public.place_import_external(jsonb) to authenticated, service_role;

comment on function public.place_import_external(jsonb) is
  'Harita sağlayıcısından seçilen işletmeyi tekilleştirerek gerçek places kaydına dönüştürür.';
