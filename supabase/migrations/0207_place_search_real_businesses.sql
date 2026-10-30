-- ---------------------------------------------------------------------------
-- İşletme araması — "haritadaki her işletme aranabilir olsun"
--
-- Sorun: `explore_search` yalnızca `name`, `description` ve `address` alanlarını
-- `ilike` ile karşılaştırıyordu. Bu yüzden
--   * kategori adıyla arama ("kafe", "eczane") yalnızca adında o kelime geçen
--     kayıtları buluyordu (187 kafe yerine 13),
--   * mahalle/ilçe adıyla arama neredeyse boş dönüyordu ("ortahisar" → 6),
--   * Türkçe karakter yazılmayınca hiç sonuç gelmiyordu ("Akcaabat" → 0).
--
-- Çözüm:
--   1. Arama metni `pharmacy_fold()` ile katlanır (İ/ı/ş/ğ/ü/ö/ç → i/i/s/g/u/o/c).
--      Aynı katlama ad, adres, açıklama, kategori, ilçe ve mahalle için uygulanır.
--   2. Çok kelimeli aramada tüm kelimelerin kayıt içinde geçmesi yeterli.
--   3. Yazım hatası toleransı için `pg_trgm` benzerliği kullanılır.
--   4. Sonuçlar eşleşme kalitesine, doğrulanmışlığa ve popülerliğe göre sıralanır.
--
-- Ayrıca harita/harici sağlayıcıdan gelen bir işletme seçildiğinde onu gerçek
-- bir `places` kaydına dönüştüren `place_import_external` eklenir; böylece
-- gönderi etiketi, harita işaretçisi ve işletme sayfası aynı kaydı kullanır.
-- ---------------------------------------------------------------------------

-- Katlanmış metin üzerinde trigram aramaları için ifade indeksleri.
create index if not exists places_fold_name_trgm_idx
  on public.places using gin (public.pharmacy_fold(name) gin_trgm_ops);

create index if not exists places_fold_address_trgm_idx
  on public.places using gin (public.pharmacy_fold(coalesce(address, '')) gin_trgm_ops);

create or replace function public.explore_search(
  p_query text,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_query text := public.pharmacy_fold(nullif(btrim(coalesce(p_query, '')), ''));
  v_tokens text[];
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 60);
begin
  if v_query is null or char_length(v_query) < 2 then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

  v_tokens := array(
    select tok
    from unnest(regexp_split_to_array(v_query, '\s+')) as tok
    where tok <> ''
  );

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(item order by rank, sort_score desc, title)
      from (
        select * from (
        -- İşletmeler
        select
          jsonb_build_object(
            'kind', 'place',
            'id', h.id,
            'title', h.name,
            'subtitle', concat_ws(' · ', h.category, h.district, h.hood),
            'lat', h.lat,
            'lng', h.lng,
            'image_path', h.cover_path,
            'rating', h.rating_avg,
            'category', h.category,
            'verified', h.is_verified,
            'address', h.address,
            'phone', h.phone
          ) as item,
          h.rank,
          h.sort_score,
          h.name as title
        from (
          select
            p.id,
            p.name,
            p.address,
            p.phone,
            p.lat,
            p.lng,
            p.cover_path,
            p.rating_avg,
            p.is_verified,
            c.name as category,
            d.name as district,
            n.name as hood,
            (coalesce(p.favorite_count, 0) * 3
              + coalesce(p.review_count, 0) * 2
              + coalesce(p.rating_avg, 0)) as sort_score,
            case
              when public.pharmacy_fold(p.name) = v_query then 0
              when public.pharmacy_fold(p.name) like v_query || '%' then 1
              when public.pharmacy_fold(p.name) like '%' || v_query || '%' then 2
              when public.pharmacy_fold(coalesce(c.name, '')) like '%' || v_query || '%' then 3
              when public.pharmacy_fold(coalesce(p.address, '')) like '%' || v_query || '%' then 4
              when public.pharmacy_fold(coalesce(d.name, '')) like '%' || v_query || '%'
                or public.pharmacy_fold(coalesce(n.name, '')) like '%' || v_query || '%' then 5
              when public.pharmacy_fold(coalesce(p.description, '')) like '%' || v_query || '%' then 6
              when not exists (
                select 1
                from unnest(v_tokens) as tok
                where public.pharmacy_fold(
                  p.name || ' ' || coalesce(c.name, '') || ' ' || coalesce(p.address, '') || ' '
                  || coalesce(d.name, '') || ' ' || coalesce(n.name, '')
                ) not like '%' || tok || '%'
              ) then 7
              when similarity(public.pharmacy_fold(p.name), v_query) >= 0.4 then 8
              else null
            end as rank
          from public.places p
          left join public.place_categories c on c.id = p.category_id
          left join public.districts d on d.id = p.district_id
          left join public.neighborhoods n on n.id = p.neighborhood_id
          where p.status = 'published'
        ) h
        where h.rank is not null

        union all

        -- Emlak ilanları
        select
          jsonb_build_object(
            'kind', 'real_estate',
            'id', l.id,
            'title', l.title,
            'subtitle', concat_ws(' · ', d.name, n.name),
            'lat', l.public_lat,
            'lng', l.public_lng,
            'image_path', (
              select m.storage_path from public.real_estate_media m
              where m.listing_id = l.id and m.status = 'approved'
              order by m.cover desc, m.sort_order limit 1
            ),
            'rating', null,
            'category', c.name,
            'verified', true,
            'address', null,
            'phone', null
          ) as item,
          20 as rank,
          0::numeric as sort_score,
          l.title as title
        from public.real_estate_listings l
        join public.real_estate_categories c on c.id = l.category_id
        left join public.districts d on d.id = l.district_id
        left join public.neighborhoods n on n.id = l.neighborhood_id
        where l.status = 'published'
          and (
            public.pharmacy_fold(l.title) like '%' || v_query || '%'
            or public.pharmacy_fold(coalesce(l.description, '')) like '%' || v_query || '%'
            or l.id::text like v_query || '%'
          )

        union all

        -- İlçeler
        select
          jsonb_build_object(
            'kind', 'district',
            'id', d.id,
            'title', d.name,
            'subtitle', 'İlçe · Trabzon',
            'lat', d.center_lat,
            'lng', d.center_lng,
            'image_path', null,
            'rating', null,
            'category', 'İlçe',
            'verified', true,
            'address', null,
            'phone', null
          ) as item,
          40 as rank,
          0::numeric as sort_score,
          d.name as title
        from public.districts d
        join public.cities ci on ci.id = d.city_id and ci.is_active
        where public.pharmacy_fold(d.name) like '%' || v_query || '%'

        union all

        -- Mahalleler
        select
          jsonb_build_object(
            'kind', 'neighborhood',
            'id', n.id,
            'title', n.name,
            'subtitle', concat_ws(' · ', d.name, 'Mahalle'),
            'lat', coalesce(n.center_lat, d.center_lat),
            'lng', coalesce(n.center_lng, d.center_lng),
            'image_path', null,
            'rating', null,
            'category', 'Mahalle',
            'verified', true,
            'address', null,
            'phone', null
          ) as item,
          41 as rank,
          0::numeric as sort_score,
          n.name as title
        from public.neighborhoods n
        join public.districts d on d.id = n.district_id
        join public.cities ci on ci.id = d.city_id and ci.is_active
        where public.pharmacy_fold(n.name) like '%' || v_query || '%'
        ) all_hits
        order by rank, sort_score desc, title
        limit v_limit
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.explore_search(text, integer) from public, anon;
grant execute on function public.explore_search(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Harita sağlayıcısından gelen işletmeyi gerçek kayda dönüştürme
--
-- Gönderi etiketi ve harita işaretçisi bir `places.id` bekliyor. Kullanıcı
-- Google/Apple/OpenStreetMap sonucundan bir işletme seçtiğinde:
--   * kayıt zaten varsa (dış kimlik ya da 150 m içinde benzer ad) o kullanılır,
--   * yoksa doğrulanmamış, yayınlanmış bir kayıt oluşturulur.
-- Böylece işletme haritada görünür ve aramalarda bulunur.
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
  if v_provider is not null and v_provider not in ('google', 'apple', 'osm', 'mapbox') then
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
    where external_provider = v_provider and external_id = v_external_id
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
