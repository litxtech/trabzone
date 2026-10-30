-- ---------------------------------------------------------------------------
-- 0200 — Deprem Merkezi düzeltmeleri
--
--  * earthquake_feed: sıralama alt sorgusundaki `x.ord` başvurusu, `x` bir
--    tablo değil sütun takma adı olduğu için "missing FROM-clause entry"
--    hatası veriyordu; liste ve arşiv boş dönüyordu. `q.ord` olarak düzeltildi.
--  * earthquake_resolve_key: bulunamayan kayıt HTTP 500 yerine 404 (PT404),
--    kaldırılmış kayıt 410 (PT410) döner. Hata mesajları (istemcinin eşlediği
--    `earthquake_not_found` / `earthquake_removed`) değişmedi.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

create or replace function public.earthquake_feed(
  p_region    text default null,
  p_district  text default null,
  p_from      timestamptz default null,
  p_to        timestamptz default null,
  p_min_mag   numeric default null,
  p_max_mag   numeric default null,
  p_min_depth numeric default null,
  p_max_depth numeric default null,
  p_source    text default 'all',
  p_order     text default 'newest',
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_region text := public.earthquake_resolve_region(p_region);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_total integer;
  v_items jsonb;
begin
  if p_order not in ('newest', 'oldest', 'largest', 'nearest') then
    raise exception 'invalid_order' using errcode = '22023';
  end if;
  if p_source is not null and p_source not in ('all', 'afad', 'usgs') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_to <= p_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.earthquake_filtered(v_region, p_district, p_from, p_to, p_min_mag, p_max_mag, p_min_depth, p_max_depth, p_source);

  select coalesce(jsonb_agg(public.earthquake_event_json(q.x) order by q.ord), '[]'::jsonb)
    into v_items
    from (
      select f, row_number() over (order by
               case when p_order = 'largest' then f.magnitude end desc nulls last,
               case when p_order = 'nearest' then f.distance_to_trabzon_km end asc nulls last,
               case when p_order = 'oldest' then f.occurred_at end asc,
               f.occurred_at desc) as ord
        from public.earthquake_filtered(v_region, p_district, p_from, p_to, p_min_mag, p_max_mag, p_min_depth, p_max_depth, p_source) f
       order by ord
       limit v_limit offset v_offset
    ) q(x, ord);

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', v_offset + v_limit < v_total,
    'region', v_region
  );
end;
$$;

create or replace function public.earthquake_resolve_key(p_key text)
returns public.earthquake_events
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := lower(trim(coalesce(p_key, '')));
  v_evt public.earthquake_events;
  v_hops integer := 0;
begin
  if v_key !~ '^(afad|usgs)-[a-z0-9]{1,60}$' then
    raise exception 'earthquake_not_found' using errcode = 'PT404';
  end if;

  select * into v_evt from public.earthquake_events where canonical_event_id = v_key and is_test = false;
  if not found then
    select e.* into v_evt
      from public.earthquake_source_records r
      join public.earthquake_events e on e.id = r.earthquake_event_id
     where r.source_name = split_part(v_key, '-', 1)
       and lower(regexp_replace(r.source_event_id, '[^A-Za-z0-9]', '', 'g')) = substr(v_key, position('-' in v_key) + 1)
       and e.is_test = false
     limit 1;
  end if;
  if v_evt.id is null then
    raise exception 'earthquake_not_found' using errcode = 'PT404';
  end if;

  while v_evt.status = 'merged' and v_evt.merged_into is not null and v_hops < 5 loop
    select * into v_evt from public.earthquake_events where id = v_evt.merged_into;
    v_hops := v_hops + 1;
  end loop;

  if v_evt.status = 'removed' then
    raise exception 'earthquake_removed' using errcode = 'PT410';
  end if;
  if v_evt.status = 'merged' then
    raise exception 'earthquake_not_found' using errcode = 'PT404';
  end if;
  return v_evt;
end;
$$;

-- `create or replace` mevcut yetkileri korur; yine de açıkça yeniden kısıtlanır.
revoke all on function public.earthquake_resolve_key(text) from public, anon, authenticated;
revoke all on function public.earthquake_feed(text, text, timestamptz, timestamptz, numeric, numeric, numeric, numeric, text, text, integer, integer)
  from public;
grant execute on function public.earthquake_feed(text, text, timestamptz, timestamptz, numeric, numeric, numeric, numeric, text, text, integer, integer)
  to anon, authenticated;
