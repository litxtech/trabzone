-- =====================================================================
-- 0051 — Marketplace katalog, ana sayfa, arama, favoriler, ilan yönetimi
-- ve kaydedilmiş aramalar.
--
-- Notlar:
--   * Emlak ve taşıt ilanları doğrulama tamamlanmadan yayınlanmaz.
--     Bu migration EİDS entegrasyonu olmadığı için onları `pending`
--     durumunda tutar; istemci tarafında yayın kapısı aşılamaz.
--   * Tüm yazma işlemleri security-definer RPC'lerden geçer.
--   * Medya yolları storage klasörü sahibiyle doğrulanır.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. İlan şeması genişletmeleri
-- ---------------------------------------------------------------------
alter table public.marketplace_listings
  add column if not exists attributes jsonb not null default '{}'::jsonb,
  add column if not exists city_id uuid references public.cities (id) on delete restrict,
  add column if not exists district_id bigint references public.districts (id) on delete restrict,
  add column if not exists neighborhood_id bigint references public.neighborhoods (id) on delete set null,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geog geography(Point, 4326),
  add column if not exists hide_exact_location boolean not null default true,
  add column if not exists price_period text not null default 'total',
  add column if not exists verification_status text not null default 'not_required',
  add column if not exists published_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists contact_prefs jsonb not null default '{}'::jsonb,
  add column if not exists updated_status_at timestamptz not null default now();

alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_status_check;
alter table public.marketplace_listings
  add constraint marketplace_listings_status_check check (
    status in ('draft', 'pending', 'active', 'reserved', 'sold', 'expired', 'archived', 'removed')
  );

alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_price_period_check;
alter table public.marketplace_listings
  add constraint marketplace_listings_price_period_check
  check (price_period in ('total', 'month', 'hour', 'service'));

alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_verification_check;
alter table public.marketplace_listings
  add constraint marketplace_listings_verification_check
  check (verification_status in ('not_required', 'pending', 'verified', 'rejected'));

alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_coords_check;
alter table public.marketplace_listings
  add constraint marketplace_listings_coords_check check (
    (lat is null and lng is null)
    or (lat between 40.55 and 41.25 and lng between 38.90 and 40.70)
  );

alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_attrs_check;
alter table public.marketplace_listings
  add constraint marketplace_listings_attrs_check
  check (jsonb_typeof(attributes) = 'object' and char_length(attributes::text) <= 8000);

update public.marketplace_listings
   set published_at = coalesce(published_at, created_at)
 where status in ('active', 'reserved', 'sold') and published_at is null;

update public.marketplace_listings l
   set city_id = coalesce(l.city_id, null),
       district_id = coalesce(l.district_id, (
         select d.id from public.districts d
         join public.cities c on c.id = d.city_id
         where c.is_active and lower(d.name) = lower(coalesce(l.district, ''))
         limit 1
       ))
 where l.district_id is null and l.district is not null;

create index if not exists marketplace_listings_category_status_idx
  on public.marketplace_listings (category_id, status, published_at desc);
create index if not exists marketplace_listings_district_idx
  on public.marketplace_listings (district_id, status, published_at desc);
create index if not exists marketplace_listings_price_idx
  on public.marketplace_listings (price_cents);
create index if not exists marketplace_listings_published_idx
  on public.marketplace_listings (published_at desc)
  where status = 'active';
create index if not exists marketplace_listings_geog_idx
  on public.marketplace_listings using gist (geog);

-- ---------------------------------------------------------------------
-- 2. Medya şeması: fotoğraf + video + küçük önizleme
-- ---------------------------------------------------------------------
alter table public.marketplace_listing_images
  add column if not exists kind text not null default 'image',
  add column if not exists thumb_path text,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists duration_ms integer,
  add column if not exists processing_status text not null default 'ready',
  add column if not exists is_cover boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.marketplace_listing_images
  drop constraint if exists marketplace_images_kind_check;
alter table public.marketplace_listing_images
  add constraint marketplace_images_kind_check check (kind in ('image', 'video'));

alter table public.marketplace_listing_images
  drop constraint if exists marketplace_images_processing_check;
alter table public.marketplace_listing_images
  add constraint marketplace_images_processing_check
  check (processing_status in ('pending', 'ready', 'failed'));

alter table public.marketplace_listing_images
  drop constraint if exists marketplace_images_dimensions_check;
alter table public.marketplace_listing_images
  add constraint marketplace_images_dimensions_check check (
    (width is null or width > 0) and (height is null or height > 0)
    and (duration_ms is null or duration_ms >= 0)
  );

create index if not exists marketplace_images_listing_idx
  on public.marketplace_listing_images (listing_id, is_cover desc, sort_order);

create unique index if not exists marketplace_images_one_cover
  on public.marketplace_listing_images (listing_id)
  where is_cover;

-- Video yüklemeye izin ver. Bucket sınırı ile istemci sınırı eşitlenir.
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
 where id = 'listing-images';

-- ---------------------------------------------------------------------
-- 3. Durum geçmişi
-- ---------------------------------------------------------------------
create table if not exists public.marketplace_listing_status_history (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.marketplace_listings (id) on delete cascade,
  actor_id        uuid references public.profiles (id) on delete set null,
  from_status     text,
  to_status       text not null,
  reason          text,
  created_at      timestamptz not null default now(),
  constraint marketplace_status_history_reason_check
    check (reason is null or char_length(reason) <= 500)
);

create index if not exists marketplace_status_history_listing_idx
  on public.marketplace_listing_status_history (listing_id, created_at desc);

alter table public.marketplace_listing_status_history enable row level security;
revoke all on public.marketplace_listing_status_history from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Kaydedilmiş aramalar ve alarmlar
-- ---------------------------------------------------------------------
create table if not exists public.marketplace_saved_searches (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  label               text not null,
  filters             jsonb not null default '{}'::jsonb,
  notify_enabled      boolean not null default true,
  last_notified_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint marketplace_saved_searches_label_check
    check (char_length(label) between 2 and 80),
  constraint marketplace_saved_searches_filters_check
    check (jsonb_typeof(filters) = 'object' and char_length(filters::text) <= 4000)
);

create index if not exists marketplace_saved_searches_user_idx
  on public.marketplace_saved_searches (user_id, updated_at desc);

alter table public.marketplace_saved_searches enable row level security;
revoke all on public.marketplace_saved_searches from anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. İlan JSON'u (v2)
-- ---------------------------------------------------------------------
create or replace function public.tz_listing_json_v2(p_listing_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', l.id,
    'seller_id', l.seller_id,
    'title', l.title,
    'description', l.description,
    'price_cents', l.price_cents,
    'currency', l.currency,
    'price_period', l.price_period,
    'condition', l.condition,
    'city', l.city,
    'district', coalesce(d.name, l.district),
    'neighborhood', n.name,
    'district_id', l.district_id,
    'neighborhood_id', l.neighborhood_id,
    'city_id', l.city_id,
    'lat', case when l.hide_exact_location then null else l.lat end,
    'lng', case when l.hide_exact_location then null else l.lng end,
    'attributes', l.attributes,
    'stock', l.stock,
    'status', l.status,
    'verification_status', l.verification_status,
    'moderation_status', l.moderation_status,
    'rejection_reason', l.rejection_reason,
    'view_count', l.view_count,
    'favorite_count', l.favorite_count,
    'created_at', l.created_at,
    'updated_at', l.updated_at,
    'published_at', l.published_at,
    'expires_at', l.expires_at,
    'category_id', l.category_id,
    'category_slug', c.slug,
    'category_name', c.name,
    'category_kind', c.kind,
    'category_icon', c.icon,
    'seller_username', sp.username,
    'seller_first_name', sp.first_name,
    'seller_last_name', sp.last_name,
    'seller_avatar_path', sp.avatar_path,
    'seller_verified', sp.is_verified,
    'seller_created_at', sp.created_at,
    'is_mine', l.seller_id = p_me,
    'is_favorite', exists (
      select 1 from public.marketplace_favorites f
      where f.listing_id = l.id and f.user_id = p_me
    ),
    'has_video', exists (
      select 1 from public.marketplace_listing_images i
      where i.listing_id = l.id and i.kind = 'video'
    ),
    'cover_path', (
      select i.storage_path from public.marketplace_listing_images i
      where i.listing_id = l.id
      order by i.is_cover desc, i.sort_order, i.created_at
      limit 1
    ),
    'cover_kind', (
      select i.kind from public.marketplace_listing_images i
      where i.listing_id = l.id
      order by i.is_cover desc, i.sort_order, i.created_at
      limit 1
    ),
    'images', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'kind', i.kind,
          'storage_path', i.storage_path,
          'thumb_path', i.thumb_path,
          'width', i.width,
          'height', i.height,
          'duration_ms', i.duration_ms,
          'sort_order', i.sort_order,
          'processing_status', i.processing_status,
          'is_cover', i.is_cover
        ) order by i.is_cover desc, i.sort_order, i.created_at)
        from public.marketplace_listing_images i
        where i.listing_id = l.id
      ),
      '[]'::jsonb
    )
  )
  from public.marketplace_listings l
  join public.profiles sp on sp.id = l.seller_id
  left join public.marketplace_categories c on c.id = l.category_id
  left join public.districts d on d.id = l.district_id
  left join public.neighborhoods n on n.id = l.neighborhood_id
  where l.id = p_listing_id;
$$;

revoke all on function public.tz_listing_json_v2(uuid, uuid) from public, anon, authenticated;

-- Eski çağrılar da zenginleştirilmiş şemayı döndürsün.
create or replace function public.tz_listing_json(p_listing_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.tz_listing_json_v2(p_listing_id, p_me);
$$;

revoke all on function public.tz_listing_json(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Katalog sorgusu
-- ---------------------------------------------------------------------
create or replace function public.market_catalog(
  p_query text default null,
  p_category text default null,
  p_kind text default null,
  p_district_id bigint default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_condition text default null,
  p_sort text default 'new',
  p_favorites boolean default false,
  p_mine boolean default false,
  p_attributes jsonb default '{}'::jsonb,
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
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'new'));
  v_attrs jsonb := case when jsonb_typeof(coalesce(p_attributes, '{}'::jsonb)) = 'object'
                        then coalesce(p_attributes, '{}'::jsonb) else '{}'::jsonb end;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total bigint;
begin
  if v_sort not in ('new', 'price_asc', 'price_desc', 'popular') then
    v_sort := 'new';
  end if;

  with recursive cat as (
    select c.id from public.marketplace_categories c
    where c.slug = v_category and c.is_active
    union all
    select ch.id from public.marketplace_categories ch
    join cat on ch.parent_id = cat.id
    where ch.is_active
  ),
  filtered as (
    select
      l.id,
      l.price_cents,
      (l.favorite_count * 3 + l.view_count) as popularity,
      coalesce(l.published_at, l.created_at) as fresh_at
    from public.marketplace_listings l
    join public.profiles sp on sp.id = l.seller_id
    join public.marketplace_categories c on c.id = l.category_id
    where (
        (coalesce(p_mine, false) and l.seller_id = v_uid)
        or (
          not coalesce(p_mine, false)
          and l.moderation_status = 'visible'
          and l.status = 'active'
          and sp.account_status = 'active'
          and not public.is_blocked(v_uid, l.seller_id)
          and (l.expires_at is null or l.expires_at > now())
        )
      )
      and (
        not coalesce(p_favorites, false)
        or exists (
          select 1 from public.marketplace_favorites f
          where f.listing_id = l.id and f.user_id = v_uid
        )
      )
      and (v_category is null or l.category_id in (select id from cat))
      and (v_kind is null or c.kind = v_kind)
      and (p_district_id is null or l.district_id = p_district_id)
      and (p_min_price is null or l.price_cents >= (p_min_price * 100)::bigint)
      and (p_max_price is null or l.price_cents <= (p_max_price * 100)::bigint)
      and (nullif(p_condition, '') is null or l.condition = p_condition)
      and (v_attrs = '{}'::jsonb or l.attributes @> v_attrs)
      and (
        v_query is null
        or l.title ilike '%' || v_query || '%'
        or coalesce(l.description, '') ilike '%' || v_query || '%'
        or c.name ilike '%' || v_query || '%'
        or l.attributes::text ilike '%' || v_query || '%'
      )
  ),
  counted as (
    select f.*, count(*) over() as total
    from filtered f
    order by
      case when v_sort = 'price_asc' then f.price_cents end asc nulls last,
      case when v_sort = 'price_desc' then f.price_cents end desc nulls last,
      case when v_sort = 'popular' then f.popularity end desc nulls last,
      case when v_sort = 'new' then f.fresh_at end desc nulls last
    limit v_limit offset v_offset
  )
  select
    coalesce(jsonb_agg(public.tz_listing_json_v2(c.id, v_uid)
             order by
               case when v_sort = 'price_asc' then c.price_cents end asc nulls last,
               case when v_sort = 'price_desc' then c.price_cents end desc nulls last,
               case when v_sort = 'popular' then c.popularity end desc nulls last,
               case when v_sort = 'new' then c.fresh_at end desc nulls last,
               c.id
             ), '[]'::jsonb),
    coalesce(max(c.total), 0)
  into v_items, v_total
  from counted c;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.market_catalog(text, text, text, bigint, numeric, numeric, text, text, boolean, boolean, jsonb, integer, integer)
  from public, anon;
grant execute on function public.market_catalog(text, text, text, bigint, numeric, numeric, text, text, boolean, boolean, jsonb, integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Ana sayfa
-- ---------------------------------------------------------------------
create or replace function public.market_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_new jsonb;
  v_popular jsonb;
  v_vehicles jsonb;
  v_personal jsonb;
  v_real_estate jsonb;
  v_places jsonb;
  v_categories jsonb;
  v_counts jsonb;
begin
  select coalesce(jsonb_agg(public.tz_listing_json_v2(x.id, v_uid) order by x.fresh_at desc), '[]'::jsonb)
  into v_new
  from (
    select l.id, coalesce(l.published_at, l.created_at) as fresh_at
    from public.marketplace_listings l
    join public.profiles sp on sp.id = l.seller_id
    where l.status = 'active' and l.moderation_status = 'visible'
      and sp.account_status = 'active'
      and (l.expires_at is null or l.expires_at > now())
      and not public.is_blocked(v_uid, l.seller_id)
    order by coalesce(l.published_at, l.created_at) desc
    limit 12
  ) x;

  select coalesce(jsonb_agg(public.tz_listing_json_v2(x.id, v_uid) order by x.popularity desc), '[]'::jsonb)
  into v_popular
  from (
    select l.id, (l.favorite_count * 3 + l.view_count) as popularity
    from public.marketplace_listings l
    join public.profiles sp on sp.id = l.seller_id
    where l.status = 'active' and l.moderation_status = 'visible'
      and sp.account_status = 'active'
      and not public.is_blocked(v_uid, l.seller_id)
    order by (l.favorite_count * 3 + l.view_count) desc, l.created_at desc
    limit 10
  ) x;

  select coalesce(jsonb_agg(public.tz_listing_json_v2(x.id, v_uid) order by x.fresh_at desc), '[]'::jsonb)
  into v_vehicles
  from (
    select l.id, coalesce(l.published_at, l.created_at) as fresh_at
    from public.marketplace_listings l
    join public.marketplace_categories c on c.id = l.category_id
    join public.profiles sp on sp.id = l.seller_id
    where c.kind = 'vehicle' and l.status = 'active' and l.moderation_status = 'visible'
      and sp.account_status = 'active'
      and not public.is_blocked(v_uid, l.seller_id)
    order by coalesce(l.published_at, l.created_at) desc
    limit 8
  ) x;

  select coalesce(jsonb_agg(public.tz_listing_json_v2(x.id, v_uid) order by x.popularity desc), '[]'::jsonb)
  into v_personal
  from (
    select l.id, (l.favorite_count * 3 + l.view_count) as popularity
    from public.marketplace_listings l
    join public.profiles sp on sp.id = l.seller_id
    where l.status = 'active' and l.moderation_status = 'visible'
      and sp.account_status = 'active'
      and not public.is_blocked(v_uid, l.seller_id)
      and l.category_id in (
        select fl.category_id
        from public.marketplace_favorites fav
        join public.marketplace_listings fl on fl.id = fav.listing_id
        where fav.user_id = v_uid and fl.category_id is not null
      )
      and not exists (
        select 1 from public.marketplace_favorites f2
        where f2.listing_id = l.id and f2.user_id = v_uid
      )
    order by (l.favorite_count * 3 + l.view_count) desc, l.created_at desc
    limit 8
  ) x;

  if v_personal is null or jsonb_array_length(v_personal) = 0 then
    v_personal := v_new;
  end if;

  begin
    v_real_estate := coalesce(
      public.re_list(null, null, null, null, null, null, null, null, null, null, null, 'new', null, false, false, 8, 0) -> 'items',
      '[]'::jsonb
    );
  exception when others then
    v_real_estate := '[]'::jsonb;
  end;

  select coalesce(jsonb_agg(public.tz_place_marker_json(p, c, d.name, n.name)
           order by p.rating_avg desc nulls last, p.review_count desc), '[]'::jsonb)
  into v_places
  from public.places p
  left join public.place_categories c on c.id = p.category_id
  left join public.districts d on d.id = p.district_id
  left join public.neighborhoods n on n.id = p.neighborhood_id
  where p.status = 'published'
    and p.id in (
      select p2.id from public.places p2
      where p2.status = 'published'
      order by p2.rating_avg desc nulls last, p2.review_count desc, p2.created_at desc
      limit 8
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', c.slug,
    'name', c.name,
    'icon', c.icon,
    'tone', c.tone,
    'kind', c.kind,
    'description', c.description
  ) order by c.sort_order), '[]'::jsonb)
  into v_categories
  from public.marketplace_categories c
  where c.parent_id is null and c.is_active and c.is_featured;

  select jsonb_build_object(
    'listings', count(*),
    'active', count(*) filter (where status = 'active' and moderation_status = 'visible'),
    'pending', count(*) filter (where status in ('pending', 'draft')),
    'places', (select count(*) from public.places where status = 'published'),
    'vehicles', count(*) filter (where category_id in (
      select id from public.marketplace_categories where kind = 'vehicle'
    ) and status = 'active'),
    'real_estate', (select count(*) from public.real_estate_listings where status = 'published')
  )
  into v_counts
  from public.marketplace_listings;

  return jsonb_build_object(
    'new_listings', v_new,
    'popular', v_popular,
    'vehicles', v_vehicles,
    'personalized', v_personal,
    'real_estate', v_real_estate,
    'places', v_places,
    'featured_categories', v_categories,
    'counts', v_counts
  );
end;
$$;

revoke all on function public.market_home() from public, anon;
grant execute on function public.market_home() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Arama önerileri
-- ---------------------------------------------------------------------
create or replace function public.market_search_suggest(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_categories jsonb := '[]'::jsonb;
  v_districts jsonb := '[]'::jsonb;
  v_listings jsonb := '[]'::jsonb;
  v_places jsonb := '[]'::jsonb;
  v_real_estate jsonb := '[]'::jsonb;
begin
  if v_query is null or char_length(v_query) < 2 then
    return jsonb_build_object(
      'query', v_query,
      'categories', v_categories,
      'districts', v_districts,
      'listings', v_listings,
      'places', v_places,
      'real_estate', v_real_estate
    );
  end if;

  v_categories := coalesce(public.market_category_search(v_query, 6) -> 'items', '[]'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'name', d.name, 'slug', d.slug,
    'neighborhoods', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'slug', n.slug) order by n.name)
      from public.neighborhoods n
      where n.district_id = d.id and n.name ilike '%' || v_query || '%'
    ), '[]'::jsonb)
  ) order by d.name), '[]'::jsonb)
  into v_districts
  from public.districts d
  join public.cities c on c.id = d.city_id
  where c.is_active and d.name ilike '%' || v_query || '%'
  limit 4;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'title', x.title,
    'price_cents', x.price_cents,
    'currency', x.currency,
    'price_period', x.price_period,
    'cover_path', x.cover_path,
    'cover_kind', x.cover_kind,
    'category_name', x.category_name,
    'category_kind', x.category_kind,
    'district', x.district_name
  ) order by x.fresh_at desc), '[]'::jsonb)
  into v_listings
  from (
    select l.id, l.title, l.price_cents, l.currency, l.price_period,
           coalesce(l.published_at, l.created_at) as fresh_at,
           c.name as category_name, c.kind as category_kind,
           d.name as district_name,
           (select i.storage_path from public.marketplace_listing_images i
            where i.listing_id = l.id
            order by i.is_cover desc, i.sort_order limit 1) as cover_path,
           (select i.kind from public.marketplace_listing_images i
            where i.listing_id = l.id
            order by i.is_cover desc, i.sort_order limit 1) as cover_kind
    from public.marketplace_listings l
    join public.profiles sp on sp.id = l.seller_id
    left join public.marketplace_categories c on c.id = l.category_id
    left join public.districts d on d.id = l.district_id
    where l.status = 'active' and l.moderation_status = 'visible'
      and sp.account_status = 'active'
      and not public.is_blocked(v_uid, l.seller_id)
      and (
        l.title ilike '%' || v_query || '%'
        or coalesce(l.description, '') ilike '%' || v_query || '%'
      )
    order by coalesce(l.published_at, l.created_at) desc
    limit 5
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'category_name', c.name,
    'cover_path', p.cover_path,
    'rating_avg', p.rating_avg,
    'review_count', p.review_count,
    'district', d.name
  ) order by p.rating_avg desc nulls last), '[]'::jsonb)
  into v_places
  from public.places p
  left join public.place_categories c on c.id = p.category_id
  left join public.districts d on d.id = p.district_id
  where p.status = 'published'
    and (p.name ilike '%' || v_query || '%' or coalesce(p.description, '') ilike '%' || v_query || '%')
  limit 4;

  begin
    v_real_estate := coalesce(
      public.re_list(null, null, null, null, null, null, null, null, null, null, null, 'new', v_query, false, false, 3, 0) -> 'items',
      '[]'::jsonb
    );
  exception when others then
    v_real_estate := '[]'::jsonb;
  end;

  return jsonb_build_object(
    'query', v_query,
    'categories', v_categories,
    'districts', v_districts,
    'listings', v_listings,
    'places', v_places,
    'real_estate', v_real_estate
  );
end;
$$;

revoke all on function public.market_search_suggest(text) from public, anon;
grant execute on function public.market_search_suggest(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. Satıcı ilan yönetimi
-- ---------------------------------------------------------------------
create or replace function public.market_my_listings(
  p_scope text default 'published',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_scope text := coalesce(nullif(trim(p_scope), ''), 'published');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total bigint;
  v_counts jsonb;
begin
  if v_scope not in ('published', 'pending', 'draft', 'expired', 'sold', 'archived') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'published', count(*) filter (where status in ('active', 'reserved')),
    'pending', count(*) filter (where status = 'pending'),
    'draft', count(*) filter (where status = 'draft'),
    'expired', count(*) filter (where status = 'expired'),
    'sold', count(*) filter (where status = 'sold'),
    'archived', count(*) filter (where status in ('archived', 'removed'))
  )
  into v_counts
  from public.marketplace_listings
  where seller_id = v_uid;

  select count(*)
  into v_total
  from public.marketplace_listings l
  where l.seller_id = v_uid
    and (
      case v_scope
        when 'published' then l.status in ('active', 'reserved')
        when 'pending' then l.status = 'pending'
        when 'draft' then l.status = 'draft'
        when 'expired' then l.status = 'expired'
        when 'sold' then l.status = 'sold'
        when 'archived' then l.status in ('archived', 'removed')
      end
    );

  select coalesce(jsonb_agg(public.tz_listing_json_v2(x.id, v_uid) order by x.fresh_at desc), '[]'::jsonb)
  into v_items
  from (
    select l.id, coalesce(l.published_at, l.created_at) as fresh_at
    from public.marketplace_listings l
    where l.seller_id = v_uid
      and (
        case v_scope
          when 'published' then l.status in ('active', 'reserved')
          when 'pending' then l.status = 'pending'
          when 'draft' then l.status = 'draft'
          when 'expired' then l.status = 'expired'
          when 'sold' then l.status = 'sold'
          when 'archived' then l.status in ('archived', 'removed')
        end
      )
    order by coalesce(l.published_at, l.created_at) desc
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'counts', v_counts,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.market_my_listings(text, integer, integer) from public, anon;
grant execute on function public.market_my_listings(text, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. İlan oluşturma / güncelleme (medya, konum, özellikler)
-- ---------------------------------------------------------------------
create or replace function public.tz_market_save_media(
  p_listing_id uuid,
  p_uid uuid,
  p_media jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_path text;
  v_thumb text;
  v_kind text;
  v_index integer := 0;
  v_cover_done boolean := false;
begin
  if p_media is null or jsonb_typeof(p_media) <> 'array' then
    return;
  end if;

  if jsonb_array_length(p_media) > 20 then
    raise exception 'invalid_media_count' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_media)
  loop
    v_path := nullif(trim(coalesce(v_item ->> 'storage_path', '')), '');
    perform public.tz_validate_media_path(v_path, p_uid);

    v_thumb := nullif(trim(coalesce(v_item ->> 'thumb_path', '')), '');
    if v_thumb is not null then
      perform public.tz_validate_media_path(v_thumb, p_uid);
    end if;

    v_kind := case when v_item ->> 'kind' = 'video' then 'video' else 'image' end;

    insert into public.marketplace_listing_images (
      listing_id, storage_path, thumb_path, kind, sort_order,
      width, height, duration_ms, processing_status, is_cover
    )
    values (
      p_listing_id,
      v_path,
      v_thumb,
      v_kind,
      v_index,
      nullif(v_item ->> 'width', '')::integer,
      nullif(v_item ->> 'height', '')::integer,
      case when v_kind = 'video' then nullif(v_item ->> 'duration_ms', '')::integer else null end,
      case when coalesce(v_item ->> 'processing_status', 'ready') in ('pending', 'ready', 'failed')
           then coalesce(v_item ->> 'processing_status', 'ready') else 'ready' end,
      case
        when not v_cover_done and (
          coalesce((v_item ->> 'is_cover')::boolean, false)
          or v_index = 0
        ) then true
        else false
      end
    );

    if not v_cover_done and (
      coalesce((v_item ->> 'is_cover')::boolean, false) or v_index = 0
    ) then
      v_cover_done := true;
    end if;

    v_index := v_index + 1;
  end loop;
end;
$$;

revoke all on function public.tz_market_save_media(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.tz_market_apply_location(
  p_payload jsonb,
  p_uid uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_district_id bigint := nullif(p_payload ->> 'district_id', '')::bigint;
  v_neighborhood_id bigint := nullif(p_payload ->> 'neighborhood_id', '')::bigint;
  v_city_id uuid := nullif(p_payload ->> 'city_id', '')::uuid;
  v_lat double precision := nullif(p_payload ->> 'lat', '')::double precision;
  v_lng double precision := nullif(p_payload ->> 'lng', '')::double precision;
  v_district record;
begin
  if v_district_id is not null then
    select d.id, d.name, d.city_id into v_district
    from public.districts d where d.id = v_district_id;

    if not found then
      raise exception 'invalid_district' using errcode = '22023';
    end if;

    v_city_id := coalesce(v_city_id, v_district.city_id);
  end if;

  if v_neighborhood_id is not null and not exists (
    select 1 from public.neighborhoods n
    where n.id = v_neighborhood_id
      and (v_district_id is null or n.district_id = v_district_id)
  ) then
    raise exception 'invalid_neighborhood' using errcode = '22023';
  end if;

  if v_lat is not null and v_lng is not null
     and not public.tz_in_trabzon_bbox(v_lat, v_lng) then
    raise exception 'outside_service_area' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'city_id', v_city_id,
    'district_id', v_district_id,
    'neighborhood_id', v_neighborhood_id,
    'district', v_district.name,
    'lat', case when v_lat is not null and v_lng is not null then v_lat else null end,
    'lng', case when v_lat is not null and v_lng is not null then v_lng else null end
  );
end;
$$;

revoke all on function public.tz_market_apply_location(jsonb, uuid) from public, anon, authenticated;

create or replace function public.market_create_listing_v2(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_title text := nullif(trim(coalesce(p_payload ->> 'title', '')), '');
  v_desc text := nullif(trim(coalesce(p_payload ->> 'description', '')), '');
  v_price bigint := coalesce((p_payload ->> 'price_cents')::bigint, 0);
  v_cond text := coalesce(nullif(trim(p_payload ->> 'condition'), ''), 'good');
  v_stock integer := coalesce((p_payload ->> 'stock')::integer, 1);
  v_cat public.marketplace_categories%rowtype;
  v_cat_id uuid := nullif(p_payload ->> 'category_id', '')::uuid;
  v_media jsonb := coalesce(p_payload -> 'media', p_payload -> 'images', '[]'::jsonb);
  v_attrs jsonb := case when jsonb_typeof(coalesce(p_payload -> 'attributes', '{}'::jsonb)) = 'object'
                        then coalesce(p_payload -> 'attributes', '{}'::jsonb) else '{}'::jsonb end;
  v_loc jsonb;
  v_status text;
  v_verification text;
  v_id uuid;
begin
  if v_title is null or char_length(v_title) < 5 or char_length(v_title) > 140 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  if v_desc is not null and char_length(v_desc) > 8000 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;

  if v_price < 0 or v_price > 100000000000 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  if v_cond not in ('new', 'like_new', 'good', 'fair') then
    raise exception 'invalid_condition' using errcode = '22023';
  end if;

  if v_stock < 0 or v_stock > 999 then
    raise exception 'invalid_stock' using errcode = '22023';
  end if;

  if v_cat_id is null then
    raise exception 'category_required' using errcode = '22023';
  end if;

  select * into v_cat from public.marketplace_categories c
  where c.id = v_cat_id and c.is_active;

  if not found then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  if char_length(v_attrs::text) > 8000 then
    raise exception 'attributes_too_large' using errcode = '22023';
  end if;

  v_loc := public.tz_market_apply_location(
    coalesce(p_payload -> 'location', '{}'::jsonb), v_uid
  );

  if v_cat.kind in ('real_estate', 'vehicle') then
    -- EİDS / yetki doğrulaması tamamlanmadan yayın yok.
    v_status := 'pending';
    v_verification := 'pending';
  else
    v_status := 'active';
    v_verification := 'not_required';
  end if;

  perform public.safety_check_rate('listing_create', 30, interval '1 day');

  insert into public.marketplace_listings (
    seller_id, category_id, title, description, price_cents, currency, price_period,
    condition, city, city_id, district_id, neighborhood_id, lat, lng, geog,
    hide_exact_location, stock, status, verification_status, attributes,
    contact_prefs, published_at, expires_at
  )
  values (
    v_uid, v_cat_id, v_title, v_desc, v_price,
    coalesce(nullif(p_payload ->> 'currency', ''), 'TRY'),
    case when coalesce(p_payload ->> 'price_period', '') in ('total', 'month', 'hour', 'service')
         then p_payload ->> 'price_period' else 'total' end,
    v_cond,
    v_loc ->> 'district',
    nullif(v_loc ->> 'city_id', '')::uuid,
    nullif(v_loc ->> 'district_id', '')::bigint,
    nullif(v_loc ->> 'neighborhood_id', '')::bigint,
    nullif(v_loc ->> 'lat', '')::double precision,
    nullif(v_loc ->> 'lng', '')::double precision,
    case when nullif(v_loc ->> 'lat', '') is not null and nullif(v_loc ->> 'lng', '') is not null
         then st_setsrid(st_makepoint(
           (v_loc ->> 'lng')::double precision,
           (v_loc ->> 'lat')::double precision
         ), 4326)::geography
         else null end,
    coalesce((p_payload ->> 'hide_exact_location')::boolean, true),
    v_stock,
    v_status,
    v_verification,
    v_attrs,
    case when jsonb_typeof(coalesce(p_payload -> 'contact_prefs', '{}'::jsonb)) = 'object'
         then coalesce(p_payload -> 'contact_prefs', '{}'::jsonb) else '{}'::jsonb end,
    case when v_status = 'active' then now() else null end,
    case when v_status = 'active' then now() + interval '30 days' else null end
  )
  returning id into v_id;

  perform public.tz_market_save_media(v_id, v_uid, v_media);

  insert into public.marketplace_listing_status_history (listing_id, actor_id, from_status, to_status, reason)
  values (v_id, v_uid, null, v_status,
          case when v_status = 'pending' then 'Doğrulama bekliyor' else 'İlan oluşturuldu' end);

  if v_status = 'active' then
    perform public.tz_market_dispatch_alerts(v_id);
  end if;

  return jsonb_build_object(
    'id', v_id,
    'status', v_status,
    'verification_status', v_verification
  );
end;
$$;

revoke all on function public.market_create_listing_v2(jsonb) from public, anon;
grant execute on function public.market_create_listing_v2(jsonb) to authenticated, service_role;

create or replace function public.market_update_listing_v2(p_listing_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.marketplace_listings%rowtype;
  v_cat public.marketplace_categories%rowtype;
  v_cat_id uuid;
  v_loc jsonb;
  v_media jsonb := p_payload -> 'media';
  v_price bigint;
begin
  select * into v_row from public.marketplace_listings where id = p_listing_id for update;
  if not found or (v_row.seller_id <> v_uid and not public.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_cat_id := coalesce(nullif(p_payload ->> 'category_id', '')::uuid, v_row.category_id);
  select * into v_cat from public.marketplace_categories where id = v_cat_id and is_active;
  if not found then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  if p_payload ? 'title' and char_length(trim(coalesce(p_payload ->> 'title', ''))) < 5 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  v_price := coalesce((p_payload ->> 'price_cents')::bigint, v_row.price_cents);
  if v_price < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  v_loc := public.tz_market_apply_location(
    coalesce(p_payload -> 'location', '{}'::jsonb), v_uid
  );

  update public.marketplace_listings l
     set title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else l.title end,
         description = case when p_payload ? 'description'
           then nullif(trim(coalesce(p_payload ->> 'description', '')), '') else l.description end,
         price_cents = v_price,
         price_period = case when p_payload ? 'price_period'
           and (p_payload ->> 'price_period') in ('total', 'month', 'hour', 'service')
           then p_payload ->> 'price_period' else l.price_period end,
         condition = case when p_payload ? 'condition'
           and (p_payload ->> 'condition') in ('new', 'like_new', 'good', 'fair')
           then p_payload ->> 'condition' else l.condition end,
         stock = coalesce((p_payload ->> 'stock')::integer, l.stock),
         category_id = v_cat_id,
         city = case when v_loc ->> 'district' is not null then v_loc ->> 'district' else l.city end,
         city_id = coalesce(nullif(v_loc ->> 'city_id', '')::uuid, l.city_id),
         district_id = coalesce(nullif(v_loc ->> 'district_id', '')::bigint, l.district_id),
         neighborhood_id = coalesce(nullif(v_loc ->> 'neighborhood_id', '')::bigint, l.neighborhood_id),
         lat = coalesce(nullif(v_loc ->> 'lat', '')::double precision, l.lat),
         lng = coalesce(nullif(v_loc ->> 'lng', '')::double precision, l.lng),
         geog = case
           when nullif(v_loc ->> 'lat', '') is not null and nullif(v_loc ->> 'lng', '') is not null
           then st_setsrid(st_makepoint(
             (v_loc ->> 'lng')::double precision,
             (v_loc ->> 'lat')::double precision
           ), 4326)::geography
           else l.geog end,
         attributes = case when p_payload ? 'attributes'
           and jsonb_typeof(p_payload -> 'attributes') = 'object'
           then p_payload -> 'attributes' else l.attributes end,
         contact_prefs = case when p_payload ? 'contact_prefs'
           and jsonb_typeof(p_payload -> 'contact_prefs') = 'object'
           then p_payload -> 'contact_prefs' else l.contact_prefs end,
         verification_status = case
           when v_cat.kind in ('real_estate', 'vehicle') and l.status = 'active' then 'pending'
           else l.verification_status end,
         status = case
           when v_cat.kind in ('real_estate', 'vehicle') and l.status = 'active' then 'pending'
           else l.status end
   where l.id = p_listing_id;

  if v_media is not null and jsonb_typeof(v_media) = 'array' then
    delete from public.marketplace_listing_images where listing_id = p_listing_id;
    perform public.tz_market_save_media(p_listing_id, v_uid, v_media);
  end if;

  return public.tz_listing_json_v2(p_listing_id, v_uid);
end;
$$;

revoke all on function public.market_update_listing_v2(uuid, jsonb) from public, anon;
grant execute on function public.market_update_listing_v2(uuid, jsonb) to authenticated, service_role;

create or replace function public.market_set_status_v2(
  p_listing_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_status text := nullif(trim(p_status), '');
  v_row public.marketplace_listings%rowtype;
  v_is_admin boolean := public.is_admin();
begin
  if v_status not in ('active', 'reserved', 'sold', 'expired', 'archived', 'removed', 'draft') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_row from public.marketplace_listings where id = p_listing_id for update;
  if not found then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  if v_row.seller_id <> v_uid and not v_is_admin then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_status = 'removed' and not v_is_admin then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_status = 'active' and not v_is_admin then
    if v_row.verification_status <> 'not_required' then
      raise exception 'verification_required' using errcode = '22023';
    end if;
  end if;

  update public.marketplace_listings l
     set status = v_status,
         moderation_status = case
           when v_status = 'removed' then 'removed'
           when v_status = 'active' then 'visible'
           else l.moderation_status end,
         published_at = case
           when v_status = 'active' then coalesce(l.published_at, now())
           else l.published_at end,
         expires_at = case
           when v_status = 'active' then now() + interval '30 days'
           else l.expires_at end,
         rejection_reason = case
           when v_status = 'removed' then nullif(trim(coalesce(p_reason, '')), '')
           else l.rejection_reason end,
         updated_status_at = now()
   where l.id = p_listing_id;

  insert into public.marketplace_listing_status_history (
    listing_id, actor_id, from_status, to_status, reason
  )
  values (p_listing_id, v_uid, v_row.status, v_status, nullif(trim(coalesce(p_reason, '')), ''));

  return jsonb_build_object('id', p_listing_id, 'status', v_status);
end;
$$;

revoke all on function public.market_set_status_v2(uuid, text, text) from public, anon;
grant execute on function public.market_set_status_v2(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 11. Kaydedilmiş arama alarmları
-- ---------------------------------------------------------------------
create or replace function public.tz_market_matches_filters(
  p_listing public.marketplace_listings,
  p_category public.marketplace_categories,
  p_filters jsonb
)
returns boolean
language sql
immutable
as $$
  select
    (
      nullif(trim(coalesce(p_filters ->> 'query', '')), '') is null
      or p_listing.title ilike '%' || (p_filters ->> 'query') || '%'
      or coalesce(p_listing.description, '') ilike '%' || (p_filters ->> 'query') || '%'
    )
    and (nullif(p_filters ->> 'kind', '') is null or p_category.kind = p_filters ->> 'kind')
    and (nullif(p_filters ->> 'category', '') is null or p_category.slug = p_filters ->> 'category')
    and (nullif(p_filters ->> 'district_id', '') is null or p_listing.district_id = (p_filters ->> 'district_id')::bigint)
    and (nullif(p_filters ->> 'min_price', '') is null or p_listing.price_cents >= ((p_filters ->> 'min_price')::numeric * 100)::bigint)
    and (nullif(p_filters ->> 'max_price', '') is null or p_listing.price_cents <= ((p_filters ->> 'max_price')::numeric * 100)::bigint)
    and (nullif(p_filters ->> 'condition', '') is null or p_listing.condition = p_filters ->> 'condition');
$$;

revoke all on function public.tz_market_matches_filters(public.marketplace_listings, public.marketplace_categories, jsonb)
  from public, anon, authenticated;

create or replace function public.tz_market_dispatch_alerts(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.marketplace_listings%rowtype;
  v_category public.marketplace_categories%rowtype;
  v_search record;
  v_sent integer := 0;
begin
  select * into v_listing from public.marketplace_listings where id = p_listing_id;
  if not found or v_listing.status <> 'active' then
    return;
  end if;

  select * into v_category from public.marketplace_categories where id = v_listing.category_id;

  for v_search in
    select * from public.marketplace_saved_searches
    where notify_enabled
      and user_id <> v_listing.seller_id
      and updated_at > now() - interval '120 days'
    order by updated_at desc
    limit 300
  loop
    if public.tz_market_matches_filters(v_listing, v_category, v_search.filters) then
      perform public.tz_notify(
        v_search.user_id,
        v_listing.seller_id,
        'market_alert',
        'Arama alarmın için yeni ilan',
        v_listing.title,
        'listing',
        v_listing.id::text,
        '/marketplace/' || v_listing.id::text
      );

      update public.marketplace_saved_searches
         set last_notified_at = now()
       where id = v_search.id;

      v_sent := v_sent + 1;
      if v_sent >= 50 then
        exit;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.tz_market_dispatch_alerts(uuid) from public, anon, authenticated;

create or replace function public.market_saved_search_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_label text := nullif(trim(coalesce(p_payload ->> 'label', '')), '');
  v_filters jsonb := coalesce(p_payload -> 'filters', '{}'::jsonb);
  v_notify boolean := coalesce((p_payload ->> 'notify_enabled')::boolean, true);
  v_row_id uuid;
begin
  if v_label is null then
    v_label := 'Kaydedilmiş arama';
  end if;

  if char_length(v_label) < 2 or char_length(v_label) > 80 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;

  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'invalid_filters' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.marketplace_saved_searches (user_id, label, filters, notify_enabled)
    values (v_uid, v_label, v_filters, v_notify)
    returning id into v_row_id;
  else
    update public.marketplace_saved_searches
       set label = v_label,
           filters = v_filters,
           notify_enabled = v_notify,
           updated_at = now()
     where id = v_id and user_id = v_uid
     returning id into v_row_id;

    if v_row_id is null then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
  end if;

  return jsonb_build_object('id', v_row_id);
end;
$$;

revoke all on function public.market_saved_search_save(jsonb) from public, anon;
grant execute on function public.market_saved_search_save(jsonb) to authenticated, service_role;

create or replace function public.market_saved_searches()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'label', s.label,
        'filters', s.filters,
        'notify_enabled', s.notify_enabled,
        'last_notified_at', s.last_notified_at,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      ) order by s.updated_at desc)
      from public.marketplace_saved_searches s
      where s.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.market_saved_searches() from public, anon;
grant execute on function public.market_saved_searches() to authenticated, service_role;

create or replace function public.market_saved_search_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  delete from public.marketplace_saved_searches
  where id = p_id and user_id = v_uid;

  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.market_saved_search_delete(uuid) from public, anon;
grant execute on function public.market_saved_search_delete(uuid) to authenticated, service_role;

create or replace function public.market_saved_search_toggle(p_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_enabled boolean := coalesce(p_enabled, true);
begin
  update public.marketplace_saved_searches
     set notify_enabled = v_enabled, updated_at = now()
   where id = p_id and user_id = v_uid;

  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return jsonb_build_object('id', p_id, 'notify_enabled', v_enabled);
end;
$$;

revoke all on function public.market_saved_search_toggle(uuid, boolean) from public, anon;
grant execute on function public.market_saved_search_toggle(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12. İşletme listesi (keşif ekranı için sayfalı)
-- ---------------------------------------------------------------------
create or replace function public.market_places_list(
  p_query text default null,
  p_category text default null,
  p_district_id bigint default null,
  p_sort text default 'rating',
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
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'rating'));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total bigint;
begin
  select count(*)
  into v_total
  from public.places p
  left join public.place_categories c on c.id = p.category_id
  where p.status = 'published'
    and (v_category is null or c.slug = v_category or c.parent_id in (
      select id from public.place_categories where slug = v_category
    ))
    and (p_district_id is null or p.district_id = p_district_id)
    and (
      v_query is null
      or p.name ilike '%' || v_query || '%'
      or coalesce(p.description, '') ilike '%' || v_query || '%'
      or coalesce(p.address, '') ilike '%' || v_query || '%'
    );

  select coalesce(jsonb_agg(public.tz_place_marker_json(x, c, d.name, n.name) order by ord), '[]'::jsonb)
  into v_items
  from (
    select p.*,
           row_number() over (order by
             case when v_sort = 'rating' then p.rating_avg end desc nulls last,
             case when v_sort = 'reviews' then p.review_count end desc nulls last,
             case when v_sort = 'new' then p.created_at end desc nulls last,
             p.created_at desc
           ) as ord
    from public.places p
    left join public.place_categories c on c.id = p.category_id
    where p.status = 'published'
      and (v_category is null or c.slug = v_category or c.parent_id in (
        select id from public.place_categories where slug = v_category
      ))
      and (p_district_id is null or p.district_id = p_district_id)
      and (
        v_query is null
        or p.name ilike '%' || v_query || '%'
        or coalesce(p.description, '') ilike '%' || v_query || '%'
        or coalesce(p.address, '') ilike '%' || v_query || '%'
      )
    order by
      case when v_sort = 'rating' then p.rating_avg end desc nulls last,
      case when v_sort = 'reviews' then p.review_count end desc nulls last,
      case when v_sort = 'new' then p.created_at end desc nulls last,
      p.created_at desc
    limit v_limit offset v_offset
  ) x
  left join public.place_categories c on c.id = x.category_id
  left join public.districts d on d.id = x.district_id
  left join public.neighborhoods n on n.id = x.neighborhood_id
  where x.ord > v_offset;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.market_places_list(text, text, bigint, text, integer, integer) from public, anon;
grant execute on function public.market_places_list(text, text, bigint, text, integer, integer) to authenticated, service_role;

comment on function public.market_catalog(text, text, text, bigint, numeric, numeric, text, text, boolean, boolean, jsonb, integer, integer) is
  'Marketplace kategori/konum/fiyat/özel alan filtreli sayfalı katalog.';
comment on function public.market_home() is
  'Premium hibrit Marketplace ana sayfa bölümleri (gerçek verilerden).';
comment on function public.market_create_listing_v2(jsonb) is
  'İlan oluşturma; medya, konum, kategoriye özel alanlar. Emlak/taşıt doğrulama bekler.';
