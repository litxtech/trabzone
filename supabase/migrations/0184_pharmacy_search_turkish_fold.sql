-- ---------------------------------------------------------------------------
-- Eczane araması — Türkçe büyük/küçük harf ve aksan katlama
--
-- Sorun: resmî kaynaklardan gelen adresler BÜYÜK harfle yazılıyor
-- ("KALKINMA MAH."). Kullanıcı "Kalkınma" yazdığında Postgres `ilike`
-- noktasız `ı` ile ASCII `I`yı eşleştirmediği için sonuç boş dönüyordu.
--
-- Çözüm: `pharmacy_fold()` metni Türkçe kurallarına göre katlar
-- (İ/ı/ş/ğ/ü/ö/ç → i/i/s/g/u/o/c) ve `pharmacies_list` aramasını bu katlanmış
-- biçim üzerinden yapar. Görüntülenen metin değişmez; yalnızca karşılaştırma
-- normalleşir. Kayıt yoksa yine boş döner, hiçbir alan uydurulmaz.
-- ---------------------------------------------------------------------------

create or replace function public.pharmacy_fold(p_text text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  -- Önce Türkçe harfleri eşle (lower('İ') iki kod noktası ürettiği için),
  -- sonra kalan ASCII büyük harfleri küçült. NULL girdi NULL döner; böylece
  -- "filtre yok" ile "boş arama" birbirine karışmaz.
  select case
    when p_text is null then null
    else lower(
      translate(
        p_text,
        'İIıŞşĞğÜüÖöÇçÂâÎîÛû',
        'iiissgguuooccaaiiuu'
      )
    )
  end;
$$;

comment on function public.pharmacy_fold(text) is
  'Türkçe arama için harf katlama; görüntüleme metnini değiştirmez.';

revoke all on function public.pharmacy_fold(text) from public;
grant execute on function public.pharmacy_fold(text) to anon, authenticated, service_role;

-- Arama için ifade indeksleri (küçük envanterde hızlı, büyümede ölçeklenir).
create index if not exists places_pharmacy_fold_name_idx
  on public.places (public.pharmacy_fold(name));

create index if not exists pharmacy_profiles_fold_neighborhood_idx
  on public.pharmacy_profiles (public.pharmacy_fold(neighborhood));

create index if not exists pharmacy_profiles_fold_address_idx
  on public.pharmacy_profiles (public.pharmacy_fold(address_text));

create or replace function public.pharmacies_list(
  p_district text default null,
  p_neighborhood text default null,
  p_query text default null,
  p_mode text default 'all',
  p_lat double precision default null,
  p_lng double precision default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_today date := public.pharmacy_istanbul_today();
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_mode text := coalesce(nullif(btrim(p_mode), ''), 'all');
  v_query text := public.pharmacy_fold(nullif(btrim(coalesce(p_query, '')), ''));
  v_district text := public.pharmacy_fold(nullif(btrim(coalesce(p_district, '')), ''));
  v_neighborhood text := public.pharmacy_fold(nullif(btrim(coalesce(p_neighborhood, '')), ''));
  v_point geography;
  v_items jsonb;
  v_total integer;
begin
  if v_mode not in ('all', 'duty_today', 'on_duty_now', 'nearby') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if p_lat is not null and p_lng is not null then
    v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  end if;

  with base as (
    select p.id, p.name, p.lat, p.lng, p.geog,
           d.name as district, d.slug as district_slug,
           pp.slug, pp.neighborhood, pp.address_text, pp.phone_text,
           coalesce(pp.address_text, p.address) as address,
           coalesce(pp.phone_text, p.phone) as phone,
           p.rating_avg, p.review_count, p.cover_path, pp.data_verified_at,
           public.pharmacy_state(p.id, v_now) as state
    from public.places p
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    join public.pharmacy_profiles pp on pp.place_id = p.id
    where c.slug = 'eczane'
      and p.status = 'published'
      and (v_district is null or public.pharmacy_fold(d.name) = v_district)
      and (v_neighborhood is null or public.pharmacy_fold(pp.neighborhood) = v_neighborhood)
      and (
        v_query is null
        or not exists (
          select 1
          from unnest(regexp_split_to_array(v_query, '\s+')) as tok
          where tok <> ''
            and (
              public.pharmacy_fold(p.name) || ' ' ||
              public.pharmacy_fold(d.name) || ' ' ||
              public.pharmacy_fold(coalesce(pp.neighborhood, '')) || ' ' ||
              public.pharmacy_fold(coalesce(pp.address_text, p.address, ''))
            ) not like '%' || tok || '%'
        )
      )
  ),
  filtered as (
    select b.*,
           case when v_point is null then null
                else round((ST_Distance(b.geog, v_point) / 1000.0)::numeric, 2)
           end as distance_km
    from base b
    where (
        v_mode <> 'duty_today'
        or (b.state ->> 'duty_today')::boolean
      )
      and (
        v_mode <> 'on_duty_now'
        or (b.state ->> 'on_duty_now')::boolean
      )
  )
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'slug', f.slug,
          'name', f.name,
          'district', f.district,
          'district_slug', f.district_slug,
          'neighborhood', f.neighborhood,
          'address', f.address,
          'phone', f.phone,
          'lat', f.lat,
          'lng', f.lng,
          'rating', f.rating_avg,
          'review_count', f.review_count,
          'cover_path', f.cover_path,
          'data_verified', f.data_verified_at is not null,
          'distance_km', f.distance_km,
          'state', f.state
        )
        order by
          (f.state ->> 'on_duty_now')::boolean desc,
          (f.state ->> 'duty_today')::boolean desc,
          f.distance_km asc nulls last,
          f.name
      )
      from (
        select * from filtered
        order by
          (state ->> 'on_duty_now')::boolean desc,
          (state ->> 'duty_today')::boolean desc,
          case when v_mode = 'nearby' then distance_km end asc nulls last,
          name
        limit v_limit offset v_offset
      ) f
    ), '[]'::jsonb),
    (select count(*) from filtered)
  into v_items, v_total;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'mode', v_mode,
    'today', v_today,
    'generated_at', v_now
  );
end;
$$;

revoke all on function public.pharmacies_list(text, text, text, text, double precision, double precision, integer, integer) from public;
grant execute on function public.pharmacies_list(text, text, text, text, double precision, double precision, integer, integer) to anon, authenticated, service_role;
