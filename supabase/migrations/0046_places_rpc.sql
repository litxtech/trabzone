-- =====================================================================
-- 0046 — Keşif haritası, işletme, yorum ve alan çizme RPC'leri
--
-- Bütün fonksiyonlar security definer'dır; tablolara doğrudan erişim yoktur.
-- Yazma işlemleri sahiplik, durum, koordinat ve medya yolu doğrulamasından
-- geçer. Sahte işletme/yorum üretilmez; kullanıcı önerileri moderasyona düşer.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------
-- Uygulama ayar bayrağı. Satır yoksa güvenli varsayılan false döner.
create or replace function public.tz_app_flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce((
    select case
      when jsonb_typeof(s.value) = 'boolean' then (s.value)::boolean
      when jsonb_typeof(s.value) = 'string' then (s.value #>> '{}')::boolean
      else false
    end
    from public.app_settings s
    where s.key = p_key
  ), false);
$$;

revoke all on function public.tz_app_flag(text) from public, anon;
grant execute on function public.tz_app_flag(text) to authenticated, service_role;

create or replace function public.tz_geo_polygon(
  p_polygon jsonb,
  p_clip boolean default true
)
returns geography
language plpgsql
immutable
as $$
declare
  v_geometry geometry;
  v_clipped geometry;
begin
  if p_polygon is null or jsonb_typeof(p_polygon) <> 'object' then
    raise exception 'invalid_polygon' using errcode = '22023';
  end if;

  if coalesce(p_polygon ->> 'type', '') <> 'Polygon' then
    raise exception 'invalid_polygon' using errcode = '22023';
  end if;

  begin
    v_geometry := st_setsrid(st_geomfromgeojson(p_polygon::text), 4326);
  exception when others then
    raise exception 'invalid_polygon' using errcode = '22023';
  end;

  if v_geometry is null or st_isempty(v_geometry) then
    raise exception 'invalid_polygon' using errcode = '22023';
  end if;

  if not st_isvalid(v_geometry) then
    v_geometry := st_makevalid(v_geometry);
    if st_geometrytype(v_geometry) <> 'ST_Polygon' then
      raise exception 'invalid_polygon' using errcode = '22023';
    end if;
  end if;

  if st_npoints(v_geometry) < 4 then
    raise exception 'invalid_polygon' using errcode = '22023';
  end if;

  if st_area(v_geometry) <= 0 then
    raise exception 'invalid_polygon' using errcode = '22023';
  end if;

  if p_clip then
    v_clipped := st_intersection(
      v_geometry,
      st_makeenvelope(38.90, 40.55, 40.70, 41.25, 4326)
    );
    if v_clipped is null or st_isempty(v_clipped) then
      raise exception 'polygon_outside_service_area' using errcode = '22023';
    end if;
    if st_geometrytype(v_clipped) not in ('ST_Polygon', 'ST_MultiPolygon') then
      raise exception 'invalid_polygon' using errcode = '22023';
    end if;
    v_geometry := v_clipped;
  end if;

  return st_setsrid(v_geometry, 4326)::geography;
end;
$$;

revoke all on function public.tz_geo_polygon(jsonb, boolean) from public, anon, authenticated;

create or replace function public.tz_place_categories_json(p_place_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'slug', c.slug,
           'name', c.name,
           'icon', c.icon,
           'tone', c.tone,
           'parent_slug', pc.slug,
           'parent_name', pc.name
         ) order by c.sort_order), '[]'::jsonb)
  from public.place_category_relations r
  join public.place_categories c on c.id = r.category_id
  left join public.place_categories pc on pc.id = c.parent_id
  where r.place_id = p_place_id and c.is_active;
$$;

create or replace function public.tz_place_manager(p_place_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_user_id is not null and (
    exists (select 1 from public.places p where p.id = p_place_id and p.owner_id = p_user_id)
    or exists (
      select 1 from public.place_business_managers m
      where m.place_id = p_place_id and m.user_id = p_user_id
    )
    or public.has_permission('places.manage')
  );
$$;

revoke all on function public.tz_place_manager(uuid, uuid) from public, anon, authenticated;

create or replace function public.tz_place_marker_json(
  p_place public.places,
  p_category public.place_categories,
  p_district text,
  p_hood text
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'kind', 'place',
    'id', p_place.id,
    'name', p_place.name,
    'category_slug', p_category.slug,
    'category_name', p_category.name,
    'parent_slug', null,
    'icon', p_category.icon,
    'tone', p_category.tone,
    'lat', p_place.lat,
    'lng', p_place.lng,
    'rating', p_place.rating_avg,
    'review_count', p_place.review_count,
    'photo_count', p_place.photo_count,
    'video_count', p_place.video_count,
    'cover_path', p_place.cover_path,
    'is_verified', p_place.is_verified,
    'price_level', p_place.price_level,
    'district', p_district,
    'neighborhood', p_hood,
    'district_id', p_place.district_id,
    'neighborhood_id', p_place.neighborhood_id
  );
$$;

revoke all on function public.tz_place_marker_json(public.places, public.place_categories, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Açılış verisi: şehir, ilçe, mahalle, kategoriler
-- ---------------------------------------------------------------------
create or replace function public.explore_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_city public.cities%rowtype;
  v_region public.service_regions%rowtype;
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

  select * into v_region from public.service_regions where city_id = v_city.id;

  return jsonb_build_object(
    'city', jsonb_build_object(
      'id', v_city.id,
      'plate_code', v_city.plate_code,
      'name', v_city.name,
      'slug', v_city.slug,
      'center_lat', v_city.center_lat,
      'center_lng', v_city.center_lng
    ),
    'service_region', case when v_region.id is null then null else jsonb_build_object(
      'name', v_region.name,
      'is_active', v_region.is_active,
      'min_lat', v_region.min_lat,
      'max_lat', v_region.max_lat,
      'min_lng', v_region.min_lng,
      'max_lng', v_region.max_lng,
      'boundary_available', v_region.boundary is not null
    ) end,
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'slug', d.slug,
        'lat', d.center_lat,
        'lng', d.center_lng,
        'neighborhoods', coalesce((
          select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'slug', n.slug)
                           order by n.name)
          from public.neighborhoods n where n.district_id = d.id
        ), '[]'::jsonb)
      ) order by d.name)
      from public.districts d where d.city_id = v_city.id
    ), '[]'::jsonb),
    'place_categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'slug', c.slug,
        'name', c.name,
        'icon', c.icon,
        'tone', c.tone,
        'sort_order', c.sort_order,
        'children', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ch.id, 'slug', ch.slug, 'name', ch.name,
            'icon', ch.icon, 'tone', ch.tone, 'sort_order', ch.sort_order
          ) order by ch.sort_order)
          from public.place_categories ch where ch.parent_id = c.id and ch.is_active
        ), '[]'::jsonb)
      ) order by c.sort_order)
      from public.place_categories c
      where c.parent_id is null and c.is_active
    ), '[]'::jsonb),
    'real_estate_categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'slug', c.slug,
        'name', c.name,
        'icon', c.icon,
        'listing_kind', c.listing_kind,
        'sort_order', c.sort_order,
        'children', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ch.id, 'slug', ch.slug, 'name', ch.name,
            'icon', ch.icon, 'listing_kind', ch.listing_kind, 'sort_order', ch.sort_order
          ) order by ch.sort_order)
          from public.real_estate_categories ch
          where ch.parent_id = c.id and ch.is_active
        ), '[]'::jsonb)
      ) order by c.sort_order)
      from public.real_estate_categories c
      where c.parent_id is null and c.is_active
    ), '[]'::jsonb),
    'eids_enabled', public.tz_app_flag('real_estate.eids_enabled')
  );
end;
$$;

revoke all on function public.explore_bootstrap() from public, anon;
grant execute on function public.explore_bootstrap() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Harita: görünür alan (viewport) işletmeleri
-- ---------------------------------------------------------------------
create or replace function public.places_map(
  p_west  double precision,
  p_east  double precision,
  p_south double precision,
  p_north double precision,
  p_categories text[] default null,
  p_query text default null,
  p_limit integer default 250
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_west double precision := greatest(least(coalesce(p_west, 38.90), 40.70), 38.90);
  v_east double precision := greatest(least(coalesce(p_east, 40.70), 40.70), 38.90);
  v_south double precision := greatest(least(coalesce(p_south, 40.55), 41.25), 40.55);
  v_north double precision := greatest(least(coalesce(p_north, 41.25), 41.25), 40.55);
  v_limit integer := least(greatest(coalesce(p_limit, 250), 1), 400);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_categories text[] := coalesce(p_categories, '{}'::text[]);
  v_items jsonb;
  v_total bigint;
begin
  if v_west >= v_east or v_south >= v_north then
    return jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'truncated', false);
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'name'), '[]'::jsonb), count(*)
  into v_items, v_total
  from (
    select public.tz_place_marker_json(p, c, d.name, n.name) as item
    from public.places p
    left join public.place_categories c on c.id = p.category_id
    left join public.districts d on d.id = p.district_id
    left join public.neighborhoods n on n.id = p.neighborhood_id
    where p.status = 'published'
      and p.geog && st_setsrid(st_makeenvelope(v_west, v_south, v_east, v_north, 4326), 4326)::geography
      and st_intersects(
        p.geog,
        st_setsrid(st_makeenvelope(v_west, v_south, v_east, v_north, 4326), 4326)::geography
      )
      and (
        cardinality(v_categories) = 0
        or c.slug = any(v_categories)
        or c.parent_id in (select id from public.place_categories where slug = any(v_categories))
      )
      and (
        v_query is null
        or p.name ilike '%' || v_query || '%'
        or coalesce(p.description, '') ilike '%' || v_query || '%'
        or coalesce(p.address, '') ilike '%' || v_query || '%'
      )
    order by p.rating_avg desc nulls last, p.review_count desc
    limit v_limit
  ) t;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'truncated', v_total >= v_limit,
    'bbox', jsonb_build_object('west', v_west, 'east', v_east, 'south', v_south, 'north', v_north)
  );
end;
$$;

revoke all on function public.places_map(double precision, double precision, double precision, double precision, text[], text, integer) from public, anon;
grant execute on function public.places_map(double precision, double precision, double precision, double precision, text[], text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- İşletme detayı
-- ---------------------------------------------------------------------
create or replace function public.place_get(p_place_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_place public.places%rowtype;
  v_category public.place_categories%rowtype;
  v_is_manager boolean;
  v_can_claim boolean;
  v_rating_counts jsonb;
  v_media jsonb;
  v_reels jsonb;
  v_posts jsonb;
begin
  select * into v_place from public.places where id = p_place_id;
  if not found then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  v_is_manager := public.tz_place_manager(v_place.id, v_uid);

  if v_place.status <> 'published'
     and not v_is_manager
     and not public.has_permission('places.view') then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  select * into v_category from public.place_categories where id = v_place.category_id;

  if v_place.status = 'published' then
    update public.places set view_count = view_count + 1 where id = v_place.id;
  end if;

  select coalesce(jsonb_object_agg(bucket, total), '{}'::jsonb)
  into v_rating_counts
  from (
    select rating::text as bucket, count(*) as total
    from public.place_reviews
    where place_id = v_place.id and status = 'visible'
    group by rating
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'kind', m.kind,
           'storage_path', m.storage_path,
           'thumb_path', m.thumb_path,
           'reel_id', m.reel_id,
           'caption', m.caption,
           'width', m.width,
           'height', m.height,
           'duration_ms', m.duration_ms,
           'status', m.status,
           'created_at', m.created_at,
           'uploader', jsonb_build_object(
             'id', pr.id,
             'username', pr.username,
             'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), '')
           )
         ) order by m.sort_order, m.created_at),
         '[]'::jsonb)
  into v_media
  from public.place_media m
  join public.profiles pr on pr.id = m.uploader_id
  where m.place_id = v_place.id
    and (m.status = 'approved' or m.uploader_id = v_uid or v_is_manager);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'video_path', r.video_path,
           'cover_path', r.cover_path,
           'caption', r.caption,
           'duration_ms', r.duration_ms,
           'like_count', r.like_count,
           'comment_count', r.comment_count,
           'view_count', r.view_count,
           'created_at', r.created_at,
           'author', jsonb_build_object(
             'username', pr.username,
             'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
             'avatar_path', pr.avatar_path
           )
         ) order by r.created_at desc),
         '[]'::jsonb)
  into v_reels
  from public.place_content_links l
  join public.reels r on r.id = l.reel_id
  join public.profiles pr on pr.id = r.author_id
  where l.place_id = v_place.id
    and r.moderation_status = 'visible'
    and r.status = 'ready'
    and pr.account_status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', po.id,
           'body', po.body,
           'created_at', po.created_at,
           'author', jsonb_build_object(
             'username', pr.username,
             'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
             'avatar_path', pr.avatar_path
           )
         ) order by po.created_at desc),
         '[]'::jsonb)
  into v_posts
  from public.place_content_links l
  join public.posts po on po.id = l.post_id
  join public.profiles pr on pr.id = po.author_id
  where l.place_id = v_place.id
    and po.visibility = 'public'
    and po.moderation_status = 'visible'
    and pr.account_status = 'active';

  v_can_claim := v_place.status = 'published'
    and not v_is_manager
    and v_place.owner_id is null
    and not exists (
      select 1 from public.place_owner_claims c
      where c.place_id = v_place.id and c.applicant_id = v_uid and c.status = 'pending'
    );

  return jsonb_build_object(
    'id', v_place.id,
    'name', v_place.name,
    'slug', v_place.slug,
    'description', v_place.description,
    'category', case when v_category.id is null then null else jsonb_build_object(
      'id', v_category.id, 'slug', v_category.slug, 'name', v_category.name,
      'icon', v_category.icon, 'tone', v_category.tone
    ) end,
    'categories', public.tz_place_categories_json(v_place.id),
    'city_id', v_place.city_id,
    'district_id', v_place.district_id,
    'neighborhood_id', v_place.neighborhood_id,
    'district', (select name from public.districts where id = v_place.district_id),
    'neighborhood', (select name from public.neighborhoods where id = v_place.neighborhood_id),
    'address', case when v_place.address_public or v_is_manager then v_place.address else null end,
    'lat', v_place.lat,
    'lng', v_place.lng,
    'phone', v_place.phone,
    'website', v_place.website,
    'cover_path', v_place.cover_path,
    'opening_hours', v_place.opening_hours,
    'price_level', v_place.price_level,
    'status', v_place.status,
    'verification_status', v_place.verification_status,
    'is_verified', v_place.is_verified,
    'data_source', v_place.data_source,
    'rating_avg', v_place.rating_avg,
    'rating_count', v_place.rating_count,
    'review_count', v_place.review_count,
    'photo_count', v_place.photo_count,
    'video_count', v_place.video_count,
    'favorite_count', v_place.favorite_count,
    'view_count', v_place.view_count + case when v_place.status = 'published' then 1 else 0 end,
    'rating_breakdown', v_rating_counts,
    'is_favorite', exists (
      select 1 from public.place_favorites f
      where f.place_id = v_place.id and f.user_id = v_uid
    ),
    'is_manager', v_is_manager,
    'can_claim', v_can_claim,
    'owner', case when v_place.owner_id is null then null else (
      select jsonb_build_object('username', pr.username, 'display_name',
        nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), 'avatar_path', pr.avatar_path)
      from public.profiles pr where pr.id = v_place.owner_id
    ) end,
    'media', v_media,
    'reels', v_reels,
    'posts', v_posts,
    'created_at', v_place.created_at,
    'updated_at', v_place.updated_at
  );
end;
$$;

revoke all on function public.place_get(uuid) from public, anon;
grant execute on function public.place_get(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Yorumlar
-- ---------------------------------------------------------------------
create or replace function public.place_reviews_list(
  p_place_id uuid,
  p_sort text default 'new',
  p_limit integer default 20,
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
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'new'));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total bigint;
begin
  if not exists (select 1 from public.places where id = p_place_id and status = 'published') then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  select count(*) into v_total
  from public.place_reviews r
  where r.place_id = p_place_id and r.status = 'visible';

  select coalesce(jsonb_agg(item order by ord nulls last, created_at desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', r.id,
      'rating', r.rating,
      'body', r.body,
      'status', r.status,
      'helpful_count', r.helpful_count,
      'helpful_by_me', exists (
        select 1 from public.place_review_votes v
        where v.review_id = r.id and v.user_id = v_uid
      ),
      'is_mine', r.author_id = v_uid,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'author', jsonb_build_object(
        'id', pr.id,
        'username', pr.username,
        'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
        'avatar_path', pr.avatar_path,
        'is_verified', pr.is_verified
      ),
      'media', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path, 'status', m.status
        ) order by m.created_at)
        from public.place_review_media m
        where m.review_id = r.id
          and (m.status = 'approved' or m.uploader_id = v_uid)
      ), '[]'::jsonb)
    ) as item,
    case
      when v_sort = 'highest' then (-r.rating)::numeric
      when v_sort = 'lowest' then r.rating::numeric
      when v_sort = 'helpful' then (-r.helpful_count)::numeric
      else null
    end as ord,
    r.created_at
    from public.place_reviews r
    join public.profiles pr on pr.id = r.author_id
    where r.place_id = p_place_id and r.status = 'visible'
    order by
      case when v_sort = 'highest' then -r.rating end asc nulls last,
      case when v_sort = 'lowest' then r.rating end asc nulls last,
      case when v_sort = 'helpful' then -r.helpful_count end asc nulls last,
      case when v_sort = 'new' then extract(epoch from r.created_at) end desc nulls last,
      r.created_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.place_reviews_list(uuid, text, integer, integer) from public, anon;
grant execute on function public.place_reviews_list(uuid, text, integer, integer) to authenticated, service_role;

create or replace function public.place_review_upsert(
  p_place_id uuid,
  p_rating integer,
  p_body text default null,
  p_media jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_place public.places%rowtype;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_review_id uuid;
  v_item jsonb;
  v_media jsonb := coalesce(p_media, '[]'::jsonb);
  v_entry jsonb;
  v_count integer := 0;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating' using errcode = '22023';
  end if;
  if v_body is not null and char_length(v_body) > 3000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;
  if jsonb_typeof(v_media) <> 'array' or jsonb_array_length(v_media) > 5 then
    raise exception 'too_many_media' using errcode = '22023';
  end if;

  select * into v_place from public.places where id = p_place_id;
  if not found or v_place.status <> 'published' then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.place_reviews
    where place_id = p_place_id and author_id = v_uid
      and updated_at > now() - interval '10 seconds'
  ) then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  insert into public.place_reviews (place_id, author_id, rating, body, status)
  values (p_place_id, v_uid, p_rating, v_body, 'visible')
  on conflict (place_id, author_id) do update
    set rating = excluded.rating,
        body = excluded.body,
        status = 'visible'
  returning id into v_review_id;

  delete from public.place_review_media where review_id = v_review_id and uploader_id = v_uid;

  for v_entry in select * from jsonb_array_elements(v_media)
  loop
    if coalesce(v_entry ->> 'kind', '') not in ('image', 'video') then
      raise exception 'invalid_media_type' using errcode = '22023';
    end if;
    if v_entry ->> 'storage_path' is null
       or split_part(v_entry ->> 'storage_path', '/', 1) <> v_uid::text then
      raise exception 'invalid_media_path' using errcode = '22023';
    end if;
    insert into public.place_review_media (review_id, uploader_id, kind, storage_path, status)
    values (v_review_id, v_uid, v_entry ->> 'kind', v_entry ->> 'storage_path', 'pending');
    v_count := v_count + 1;
  end loop;

  select jsonb_build_object(
    'id', r.id,
    'rating', r.rating,
    'body', r.body,
    'helpful_count', r.helpful_count,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'media_pending', v_count
  ) into v_item
  from public.place_reviews r where r.id = v_review_id;

  return v_item;
end;
$$;

revoke all on function public.place_review_upsert(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.place_review_upsert(uuid, integer, text, jsonb) to authenticated, service_role;

create or replace function public.place_review_delete(p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_review public.place_reviews%rowtype;
begin
  select * into v_review from public.place_reviews where id = p_review_id;
  if not found then
    raise exception 'review_not_found' using errcode = 'P0002';
  end if;
  if v_review.author_id <> v_uid and not public.has_permission('places.moderate') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  delete from public.place_reviews where id = p_review_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.place_review_delete(uuid) from public, anon;
grant execute on function public.place_review_delete(uuid) to authenticated, service_role;

create or replace function public.place_review_helpful(p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_author uuid;
  v_added boolean := false;
  v_count integer;
begin
  select r.author_id into v_author from public.place_reviews r where r.id = p_review_id;
  if v_author is null then
    raise exception 'review_not_found' using errcode = 'P0002';
  end if;
  if v_author = v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  delete from public.place_review_votes
  where review_id = p_review_id and user_id = v_uid;
  if not found then
    insert into public.place_review_votes (review_id, user_id)
    values (p_review_id, v_uid);
    v_added := true;
  end if;

  select count(*) into v_count
  from public.place_review_votes where review_id = p_review_id;

  update public.place_reviews set helpful_count = v_count where id = p_review_id;

  return jsonb_build_object('helpful', v_added, 'helpful_count', v_count);
end;
$$;

revoke all on function public.place_review_helpful(uuid) from public, anon;
grant execute on function public.place_review_helpful(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- İşletme medyası
-- ---------------------------------------------------------------------
create or replace function public.place_media_add(
  p_place_id uuid,
  p_kind text,
  p_storage_path text,
  p_thumb_path text default null,
  p_caption text default null,
  p_width integer default null,
  p_height integer default null,
  p_duration_ms integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_place public.places%rowtype;
  v_manager boolean;
  v_status text;
  v_id uuid;
  v_recent integer;
  v_row public.place_media%rowtype;
begin
  select * into v_place from public.places where id = p_place_id;
  if not found or v_place.status <> 'published' then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;
  if p_kind not in ('image', 'video') then
    raise exception 'invalid_media_type' using errcode = '22023';
  end if;
  if p_storage_path is null
     or split_part(p_storage_path, '/', 1) <> v_uid::text
     or char_length(p_storage_path) > 400 then
    raise exception 'invalid_media_path' using errcode = '22023';
  end if;
  if p_caption is not null and char_length(p_caption) > 300 then
    raise exception 'caption_too_long' using errcode = '22023';
  end if;

  select count(*) into v_recent
  from public.place_media m
  where m.uploader_id = v_uid and m.created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  v_manager := public.tz_place_manager(p_place_id, v_uid);
  v_status := case when v_manager then 'approved' else 'pending' end;

  insert into public.place_media (
    place_id, uploader_id, kind, storage_path, thumb_path, caption,
    width, height, duration_ms, status,
    moderated_by, moderated_at
  )
  values (
    p_place_id, v_uid, p_kind, p_storage_path, p_thumb_path,
    nullif(btrim(coalesce(p_caption, '')), ''), p_width, p_height, p_duration_ms,
    v_status,
    case when v_manager then v_uid else null end,
    case when v_manager then now() else null end
  )
  returning * into v_row;

  v_id := v_row.id;

  return jsonb_build_object(
    'id', v_id, 'kind', v_row.kind, 'storage_path', v_row.storage_path,
    'status', v_row.status, 'created_at', v_row.created_at
  );
end;
$$;

revoke all on function public.place_media_add(uuid, text, text, text, text, integer, integer, integer) from public, anon;
grant execute on function public.place_media_add(uuid, text, text, text, text, integer, integer, integer) to authenticated, service_role;

create or replace function public.place_media_delete(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_media public.place_media%rowtype;
begin
  select * into v_media from public.place_media where id = p_media_id;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  if v_media.uploader_id <> v_uid
     and not public.tz_place_manager(v_media.place_id, v_uid)
     and not public.has_permission('places.moderate') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.place_media where id = p_media_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.place_media_delete(uuid) from public, anon;
grant execute on function public.place_media_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Favoriler
-- ---------------------------------------------------------------------
create or replace function public.place_favorite_toggle(p_place_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_exists boolean;
  v_count integer;
begin
  if not exists (select 1 from public.places where id = p_place_id and status = 'published') then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.place_favorites where place_id = p_place_id and user_id = v_uid
  ) into v_exists;

  if v_exists then
    delete from public.place_favorites where place_id = p_place_id and user_id = v_uid;
  else
    insert into public.place_favorites (place_id, user_id) values (p_place_id, v_uid);
  end if;

  select favorite_count into v_count from public.places where id = p_place_id;
  return jsonb_build_object('favorite', not v_exists, 'favorite_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.place_favorite_toggle(uuid) from public, anon;
grant execute on function public.place_favorite_toggle(uuid) to authenticated, service_role;

create or replace function public.place_favorites_list(
  p_limit integer default 30,
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
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(public.tz_place_marker_json(p, c, d.name, n.name) order by f.created_at desc)
      from public.place_favorites f
      join public.places p on p.id = f.place_id and p.status = 'published'
      left join public.place_categories c on c.id = p.category_id
      left join public.districts d on d.id = p.district_id
      left join public.neighborhoods n on n.id = p.neighborhood_id
      where f.user_id = v_uid
      limit v_limit offset v_offset
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.place_favorites_list(integer, integer) from public, anon;
grant execute on function public.place_favorites_list(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Kullanıcı önerisi: haritaya yeni işletme
-- ---------------------------------------------------------------------
create or replace function public.place_suggest_submit(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_name text := nullif(btrim(coalesce(p_payload ->> 'name', '')), '');
  v_category_slug text := nullif(btrim(coalesce(p_payload ->> 'category_slug', '')), '');
  v_district_id bigint := nullif(p_payload ->> 'district_id', '')::bigint;
  v_hood_id bigint := nullif(p_payload ->> 'neighborhood_id', '')::bigint;
  v_address text := nullif(btrim(coalesce(p_payload ->> 'address', '')), '');
  v_description text := nullif(btrim(coalesce(p_payload ->> 'description', '')), '');
  v_phone text := nullif(btrim(coalesce(p_payload ->> 'phone', '')), '');
  v_lat double precision := nullif(p_payload ->> 'lat', '')::double precision;
  v_lng double precision := nullif(p_payload ->> 'lng', '')::double precision;
  v_city public.cities%rowtype;
  v_category public.place_categories%rowtype;
  v_district public.districts%rowtype;
  v_near public.places%rowtype;
  v_recent integer;
  v_id uuid;
  v_status text := 'pending';
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 140 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 4000 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;
  if not public.tz_in_trabzon_bbox(v_lat, v_lng) then
    raise exception 'outside_service_area' using errcode = '22023';
  end if;

  select * into v_city from public.cities where is_active order by plate_code limit 1;
  if not found then
    raise exception 'service_area_unavailable' using errcode = 'P0002';
  end if;

  select * into v_category from public.place_categories
  where slug = v_category_slug and is_active;
  if not found then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  select * into v_district from public.districts
  where id = v_district_id and city_id = v_city.id;
  if not found then
    raise exception 'invalid_district' using errcode = '22023';
  end if;

  if v_hood_id is not null and not exists (
    select 1 from public.neighborhoods where id = v_hood_id and district_id = v_district_id
  ) then
    raise exception 'invalid_neighborhood' using errcode = '22023';
  end if;

  select count(*) into v_recent
  from public.place_suggestions
  where submitter_id = v_uid and created_at > now() - interval '24 hours';
  if v_recent >= 10 then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  select * into v_near
  from public.places
  where status in ('published', 'pending')
    and st_dwithin(
      coalesce(geog, st_setsrid(st_makepoint(lng, lat), 4326)::geography),
      st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography,
      150
    )
    and (
      lower(name) = lower(v_name)
      or similarity(lower(name), lower(v_name)) > 0.72
    )
  order by st_distance(
    coalesce(geog, st_setsrid(st_makepoint(lng, lat), 4326)::geography),
    st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography
  )
  limit 1;

  if found then
    v_status := 'duplicate';
  end if;

  insert into public.place_suggestions (submitter_id, payload, status, review_note)
  values (
    v_uid,
    jsonb_build_object(
      'name', v_name,
      'category_slug', v_category.slug,
      'city_id', v_city.id,
      'district_id', v_district.id,
      'neighborhood_id', v_hood_id,
      'address', v_address,
      'description', v_description,
      'phone', v_phone,
      'lat', v_lat,
      'lng', v_lng,
      'photos', coalesce(p_payload -> 'photos', '[]'::jsonb),
      'duplicate_of', case when v_status = 'duplicate' then v_near.id else null end
    ),
    v_status,
    case when v_status = 'duplicate' then 'Yakında benzer isimli bir işletme bulundu; yönetici inceleyecek.' else null end
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'status', v_status,
    'duplicate_of', case when v_status = 'duplicate' then v_near.id else null end,
    'duplicate_name', case when v_status = 'duplicate' then v_near.name else null end
  );
end;
$$;

revoke all on function public.place_suggest_submit(jsonb) from public, anon;
grant execute on function public.place_suggest_submit(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- İşletme sahiplenme
-- ---------------------------------------------------------------------
create or replace function public.place_claim_submit(
  p_place_id uuid,
  p_evidence_type text,
  p_evidence_text text,
  p_document_path text default null,
  p_contact_phone text default null,
  p_contact_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_place public.places%rowtype;
  v_evidence text := nullif(btrim(coalesce(p_evidence_text, '')), '');
  v_id uuid;
begin
  select * into v_place from public.places where id = p_place_id;
  if not found or v_place.status <> 'published' then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  if public.tz_place_manager(p_place_id, v_uid) then
    raise exception 'already_manager' using errcode = '22023';
  end if;

  if p_evidence_type not in ('document', 'tax_record', 'utility', 'other') then
    raise exception 'invalid_evidence' using errcode = '22023';
  end if;

  -- Yalnızca telefon numarasını bilmek doğrulama için yeterli değildir.
  if v_evidence is null and p_document_path is null then
    raise exception 'evidence_required' using errcode = '22023';
  end if;

  if p_document_path is not null
     and split_part(p_document_path, '/', 1) <> v_uid::text then
    raise exception 'invalid_document_path' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.place_owner_claims
    where place_id = p_place_id and applicant_id = v_uid and status = 'pending'
  ) then
    raise exception 'claim_already_pending' using errcode = '23505';
  end if;

  insert into public.place_owner_claims (
    place_id, applicant_id, evidence_type, evidence_text, document_path,
    contact_phone, contact_email
  )
  values (
    p_place_id, v_uid, p_evidence_type, v_evidence, p_document_path,
    nullif(btrim(coalesce(p_contact_phone, '')), ''),
    nullif(btrim(coalesce(p_contact_email, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

revoke all on function public.place_claim_submit(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.place_claim_submit(uuid, text, text, text, text, text) to authenticated, service_role;

create or replace function public.place_claim_status(p_place_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return coalesce((
    select jsonb_build_object(
      'id', c.id,
      'status', c.status,
      'evidence_type', c.evidence_type,
      'review_note', c.review_note,
      'created_at', c.created_at,
      'reviewed_at', c.reviewed_at
    )
    from public.place_owner_claims c
    where c.place_id = p_place_id and c.applicant_id = v_uid
    order by c.created_at desc
    limit 1
  ), 'null'::jsonb);
end;
$$;

revoke all on function public.place_claim_status(uuid) from public, anon;
grant execute on function public.place_claim_status(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- İşletme sahibi düzenlemesi
-- ---------------------------------------------------------------------
create or replace function public.place_business_update(p_place_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_place public.places%rowtype;
  v_desc text;
  v_phone text;
  v_website text;
  v_hours jsonb;
  v_cover text;
begin
  if not public.tz_place_manager(p_place_id, v_uid) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_place from public.places where id = p_place_id;
  if not found then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  if p_payload ? 'description' then
    v_desc := nullif(btrim(coalesce(p_payload ->> 'description', '')), '');
    if v_desc is not null and char_length(v_desc) > 4000 then
      raise exception 'description_too_long' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'phone' then
    v_phone := nullif(btrim(coalesce(p_payload ->> 'phone', '')), '');
    if v_phone is not null and char_length(v_phone) < 7 then
      raise exception 'invalid_contact_phone' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'website' then
    v_website := nullif(btrim(coalesce(p_payload ->> 'website', '')), '');
    if v_website is not null and v_website !~ '^https?://[^\s]+$' then
      raise exception 'invalid_website' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'opening_hours' and jsonb_typeof(p_payload -> 'opening_hours') = 'object' then
    v_hours := p_payload -> 'opening_hours';
  end if;

  if p_payload ? 'cover_path' then
    v_cover := nullif(btrim(coalesce(p_payload ->> 'cover_path', '')), '');
    if v_cover is not null and split_part(v_cover, '/', 1) <> v_uid::text then
      raise exception 'invalid_media_path' using errcode = '22023';
    end if;
  end if;

  update public.places
     set description = coalesce(v_desc, description),
         phone = coalesce(v_phone, phone),
         website = coalesce(v_website, website),
         opening_hours = coalesce(v_hours, opening_hours),
         cover_path = coalesce(v_cover, cover_path),
         data_source = 'business_owner'
   where id = p_place_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.place_business_update(uuid, jsonb) from public, anon;
grant execute on function public.place_business_update(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Sosyal içerik bağlama (gönderi / Reels)
-- ---------------------------------------------------------------------
create or replace function public.place_link_content(
  p_place_id uuid,
  p_reel_id uuid default null,
  p_post_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_author uuid;
  v_count integer;
begin
  if num_nonnulls(p_reel_id, p_post_id) <> 1 then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not exists (select 1 from public.places where id = p_place_id and status = 'published') then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  if p_reel_id is not null then
    select author_id into v_author from public.reels where id = p_reel_id;
  else
    select author_id into v_author from public.posts where id = p_post_id;
  end if;

  if v_author is null then
    raise exception 'content_not_found' using errcode = 'P0002';
  end if;
  if v_author <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select count(*) into v_count
  from public.place_content_links
  where place_id = p_place_id
    and (reel_id = p_reel_id or post_id = p_post_id);

  if v_count = 0 then
    insert into public.place_content_links (place_id, reel_id, post_id, created_by)
    values (p_place_id, p_reel_id, p_post_id, v_uid);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.place_link_content(uuid, uuid, uuid) from public, anon;
grant execute on function public.place_link_content(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.place_content_list(
  p_place_id uuid,
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
begin
  if not exists (select 1 from public.places where id = p_place_id and status = 'published') then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'reels', coalesce((
      select jsonb_agg(item order by created_at desc)
      from (
        select jsonb_build_object(
          'id', r.id,
          'video_path', r.video_path,
          'cover_path', r.cover_path,
          'caption', r.caption,
          'duration_ms', r.duration_ms,
          'like_count', r.like_count,
          'comment_count', r.comment_count,
          'view_count', r.view_count,
          'created_at', r.created_at,
          'author', jsonb_build_object(
            'username', pr.username,
            'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
            'avatar_path', pr.avatar_path
          )
        ) as item,
        r.created_at
        from public.place_content_links l
        join public.reels r on r.id = l.reel_id
        join public.profiles pr on pr.id = r.author_id
        where l.place_id = p_place_id
          and r.moderation_status = 'visible'
          and r.status = 'ready'
          and pr.account_status = 'active'
        limit v_limit
      ) t
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(item order by created_at desc)
      from (
        select jsonb_build_object(
          'id', po.id,
          'body', po.body,
          'created_at', po.created_at,
          'author', jsonb_build_object(
            'username', pr.username,
            'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
            'avatar_path', pr.avatar_path
          )
        ) as item,
        po.created_at
        from public.place_content_links l
        join public.posts po on po.id = l.post_id
        join public.profiles pr on pr.id = po.author_id
        where l.place_id = p_place_id
          and po.moderation_status = 'visible'
          and po.visibility = 'public'
          and pr.account_status = 'active'
        limit v_limit
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.place_content_list(uuid, integer) from public, anon;
grant execute on function public.place_content_list(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Şikâyet
-- ---------------------------------------------------------------------
create or replace function public.content_report_create(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_reason text := lower(trim(coalesce(p_reason, '')));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_id uuid;
begin
  if p_target_type not in ('place', 'place_media', 'place_review', 'real_estate_listing', 'real_estate_media') then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if v_reason not in ('spam', 'fake', 'inappropriate', 'wrong_location', 'fraud', 'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 2000 then
    raise exception 'details_too_long' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.content_reports
    where reporter_id = v_uid and target_type = p_target_type
      and target_id = p_target_id and status = 'pending'
  ) then
    raise exception 'duplicate_report' using errcode = '23505';
  end if;

  insert into public.content_reports (reporter_id, target_type, target_id, reason, details)
  values (v_uid, p_target_type, p_target_id, v_reason, v_details)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

revoke all on function public.content_report_create(text, uuid, text, text) from public, anon;
grant execute on function public.content_report_create(text, uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Birleşik arama
-- ---------------------------------------------------------------------
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
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 40);
begin
  if v_query is null or char_length(v_query) < 2 then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(item order by rank, title)
      from (
        select jsonb_build_object(
          'kind', 'place',
          'id', p.id,
          'title', p.name,
          'subtitle', concat_ws(' · ', c.name, d.name, n.name),
          'lat', p.lat,
          'lng', p.lng,
          'image_path', p.cover_path,
          'rating', p.rating_avg,
          'category', c.name,
          'verified', p.is_verified
        ) as item,
        1 as rank,
        p.name as title
        from public.places p
        left join public.place_categories c on c.id = p.category_id
        left join public.districts d on d.id = p.district_id
        left join public.neighborhoods n on n.id = p.neighborhood_id
        where p.status = 'published'
          and (p.name ilike '%' || v_query || '%'
               or coalesce(p.description, '') ilike '%' || v_query || '%'
               or coalesce(p.address, '') ilike '%' || v_query || '%')

        union all

        select jsonb_build_object(
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
          'verified', true
        ) as item,
        2 as rank,
        l.title as title
        from public.real_estate_listings l
        join public.real_estate_categories c on c.id = l.category_id
        left join public.districts d on d.id = l.district_id
        left join public.neighborhoods n on n.id = l.neighborhood_id
        where l.status = 'published'
          and (l.title ilike '%' || v_query || '%'
               or coalesce(l.description, '') ilike '%' || v_query || '%'
               or l.id::text ilike v_query || '%')

        union all

        select jsonb_build_object(
          'kind', 'district',
          'id', d.id,
          'title', d.name,
          'subtitle', 'İlçe · Trabzon',
          'lat', d.center_lat,
          'lng', d.center_lng,
          'image_path', null,
          'rating', null,
          'category', 'İlçe',
          'verified', true
        ) as item,
        3 as rank,
        d.name as title
        from public.districts d
        join public.cities ci on ci.id = d.city_id and ci.is_active
        where d.name ilike '%' || v_query || '%'

        union all

        select jsonb_build_object(
          'kind', 'neighborhood',
          'id', n.id,
          'title', n.name,
          'subtitle', concat_ws(' · ', d.name, 'Mahalle'),
          'lat', coalesce(n.center_lat, d.center_lat),
          'lng', coalesce(n.center_lng, d.center_lng),
          'image_path', null,
          'rating', null,
          'category', 'Mahalle',
          'verified', true
        ) as item,
        4 as rank,
        n.name as title
        from public.neighborhoods n
        join public.districts d on d.id = n.district_id
        join public.cities ci on ci.id = d.city_id and ci.is_active
        where n.name ilike '%' || v_query || '%'
        limit 60
      ) t
      limit v_limit
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.explore_search(text, integer) from public, anon;
grant execute on function public.explore_search(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Alan çizme: polygon içinde birleşik arama
-- ---------------------------------------------------------------------
create or replace function public.map_area_search(
  p_polygon jsonb,
  p_categories text[] default null,
  p_kinds text[] default array['place', 'real_estate'],
  p_query text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_m2 integer default null,
  p_max_m2 integer default null,
  p_rooms smallint default null,
  p_listing_kind text default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_area geography := public.tz_geo_polygon(p_polygon, true);
  v_categories text[] := coalesce(p_categories, '{}'::text[]);
  v_kinds text[] := coalesce(p_kinds, array['place', 'real_estate']);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 300);
  v_places jsonb := '[]'::jsonb;
  v_listings jsonb := '[]'::jsonb;
  v_place_total bigint := 0;
  v_listing_total bigint := 0;
begin
  if 'place' = any(v_kinds) then
    select count(*), coalesce(jsonb_agg(item order by item ->> 'name'), '[]'::jsonb)
    into v_place_total, v_places
    from (
      select public.tz_place_marker_json(p, c, d.name, n.name) as item
      from public.places p
      left join public.place_categories c on c.id = p.category_id
      left join public.districts d on d.id = p.district_id
      left join public.neighborhoods n on n.id = p.neighborhood_id
      where p.status = 'published'
        and st_intersects(p.geog, v_area)
        and (
          cardinality(v_categories) = 0
          or c.slug = any(v_categories)
          or c.parent_id in (select id from public.place_categories where slug = any(v_categories))
        )
        and (
          v_query is null
          or p.name ilike '%' || v_query || '%'
          or coalesce(p.description, '') ilike '%' || v_query || '%'
        )
      limit v_limit
    ) t;
  end if;

  if 'real_estate' = any(v_kinds) then
    select count(*), coalesce(jsonb_agg(item order by item ->> 'title'), '[]'::jsonb)
    into v_listing_total, v_listings
    from (
      select jsonb_build_object(
        'kind', 'real_estate',
        'id', l.id,
        'title', l.title,
        'price_cents', l.price_cents,
        'currency', l.currency,
        'price_period', l.price_period,
        'listing_kind', l.listing_kind,
        'category_slug', c.slug,
        'category_name', c.name,
        'lat', l.public_lat,
        'lng', l.public_lng,
        'gross_m2', l.gross_m2,
        'net_m2', l.net_m2,
        'room_count', l.room_count,
        'district', d.name,
        'neighborhood', n.name,
        'cover_path', (
          select m.storage_path from public.real_estate_media m
          where m.listing_id = l.id and m.status = 'approved'
          order by m.cover desc, m.sort_order limit 1
        ),
        'is_favorite', exists (
          select 1 from public.real_estate_favorites f
          where f.listing_id = l.id and f.user_id = v_uid
        ),
        'published_at', l.published_at
      ) as item
      from public.real_estate_listings l
      join public.real_estate_categories c on c.id = l.category_id
      left join public.districts d on d.id = l.district_id
      left join public.neighborhoods n on n.id = l.neighborhood_id
      where l.status = 'published'
        and l.public_geog is not null
        and st_intersects(l.public_geog, v_area)
        and (p_listing_kind is null or l.listing_kind = p_listing_kind)
        and (p_min_price is null or l.price_cents >= (p_min_price * 100)::bigint)
        and (p_max_price is null or l.price_cents <= (p_max_price * 100)::bigint)
        and (p_min_m2 is null or coalesce(l.net_m2, l.gross_m2, 0) >= p_min_m2)
        and (p_max_m2 is null or coalesce(l.net_m2, l.gross_m2, 0) <= p_max_m2)
        and (p_rooms is null or l.room_count = p_rooms)
        and (
          cardinality(v_categories) = 0
          or c.slug = any(v_categories)
          or c.parent_id in (select id from public.real_estate_categories where slug = any(v_categories))
        )
        and (v_query is null or l.title ilike '%' || v_query || '%')
      limit v_limit
    ) t;
  end if;

  return jsonb_build_object(
    'places', v_places,
    'listings', v_listings,
    'counts', jsonb_build_object('places', v_place_total, 'listings', v_listing_total),
    'area_m2', round(st_area(v_area)::numeric, 0)
  );
end;
$$;

revoke all on function public.map_area_search(jsonb, text[], text[], text, numeric, numeric, integer, integer, smallint, text, integer) from public, anon;
grant execute on function public.map_area_search(jsonb, text[], text[], text, numeric, numeric, integer, integer, smallint, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Kaydedilen alanlar
-- ---------------------------------------------------------------------
create or replace function public.saved_area_save(
  p_label text,
  p_polygon jsonb,
  p_filters jsonb default '{}'::jsonb,
  p_notify boolean default false,
  p_area_kind text default 'map'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_area geography := public.tz_geo_polygon(p_polygon, true);
  v_id uuid;
begin
  if v_label is null or char_length(v_label) > 120 then
    raise exception 'label_required' using errcode = '22023';
  end if;
  if p_area_kind not in ('map', 'real_estate') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_filters is not null and jsonb_typeof(p_filters) <> 'object' then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;

  insert into public.saved_search_areas (user_id, label, area_kind, boundary, filters, notify_enabled)
  values (v_uid, v_label, p_area_kind, v_area, coalesce(p_filters, '{}'::jsonb), coalesce(p_notify, false))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'label', v_label, 'notify_enabled', coalesce(p_notify, false));
end;
$$;

revoke all on function public.saved_area_save(text, jsonb, jsonb, boolean, text) from public, anon;
grant execute on function public.saved_area_save(text, jsonb, jsonb, boolean, text) to authenticated, service_role;

create or replace function public.saved_areas_list()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', a.id,
      'label', a.label,
      'area_kind', a.area_kind,
      'filters', a.filters,
      'notify_enabled', a.notify_enabled,
      'created_at', a.created_at,
      'geometry', st_asgeojson(a.boundary::geometry)::jsonb
    ) order by a.created_at desc),
    '[]'::jsonb
  )
  from public.saved_search_areas a
  where a.user_id = public.tz_require_uid();
$$;

revoke all on function public.saved_areas_list() from public, anon;
grant execute on function public.saved_areas_list() to authenticated, service_role;

create or replace function public.saved_area_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_deleted integer := 0;
begin
  delete from public.saved_search_areas where id = p_id and user_id = v_uid;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', v_deleted > 0);
end;
$$;

revoke all on function public.saved_area_delete(uuid) from public, anon;
grant execute on function public.saved_area_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Birleşik favori kütüphanesi
-- ---------------------------------------------------------------------
create or replace function public.explore_library()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object(
    'places', coalesce((
      select jsonb_agg(public.tz_place_marker_json(p, c, d.name, n.name) order by f.created_at desc)
      from public.place_favorites f
      join public.places p on p.id = f.place_id and p.status = 'published'
      left join public.place_categories c on c.id = p.category_id
      left join public.districts d on d.id = p.district_id
      left join public.neighborhoods n on n.id = p.neighborhood_id
      where f.user_id = v_uid
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'title', l.title,
        'price_cents', l.price_cents,
        'currency', l.currency,
        'price_period', l.price_period,
        'listing_kind', l.listing_kind,
        'category_slug', c.slug,
        'category_name', c.name,
        'lat', l.public_lat,
        'lng', l.public_lng,
        'gross_m2', l.gross_m2,
        'net_m2', l.net_m2,
        'room_count', l.room_count,
        'district', d.name,
        'neighborhood', n.name,
        'cover_path', (
          select m.storage_path from public.real_estate_media m
          where m.listing_id = l.id and m.status = 'approved'
          order by m.cover desc, m.sort_order limit 1
        ),
        'is_favorite', true,
        'published_at', l.published_at
      ) order by f.created_at desc)
      from public.real_estate_favorites f
      join public.real_estate_listings l on l.id = f.listing_id and l.status = 'published'
      join public.real_estate_categories c on c.id = l.category_id
      left join public.districts d on d.id = l.district_id
      left join public.neighborhoods n on n.id = l.neighborhood_id
      where f.user_id = v_uid
    ), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'label', a.label, 'area_kind', a.area_kind,
        'filters', a.filters, 'notify_enabled', a.notify_enabled, 'created_at', a.created_at
      ) order by a.created_at desc)
      from public.saved_search_areas a where a.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.explore_library() from public, anon;
grant execute on function public.explore_library() to authenticated, service_role;
