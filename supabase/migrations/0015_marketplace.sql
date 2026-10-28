-- 0014: Marketplace (listings, categories, favorites, orders, reviews)
--
-- Payment is intentionally NOT simulated. Orders are purchase requests that are
-- confirmed between buyer and seller; `payment_status` stays 'not_collected'
-- until a real payment provider (Stripe / IAP) is wired server-side.

set search_path = public, extensions;

create table if not exists public.marketplace_categories (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references public.marketplace_categories (id) on delete set null,
  slug       citext not null unique,
  name       text not null,
  icon       text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint marketplace_categories_slug_check check (slug::text ~ '^[a-z0-9-]{2,40}$'),
  constraint marketplace_categories_name_check check (char_length(name) between 2 and 60)
);

create table if not exists public.marketplace_listings (
  id                uuid primary key default gen_random_uuid(),
  seller_id         uuid not null references public.profiles (id) on delete cascade,
  category_id       uuid references public.marketplace_categories (id) on delete set null,
  title             text not null,
  description       text,
  price_cents       bigint not null,
  currency          text not null default 'TRY',
  condition         text not null default 'good',
  city              text,
  district          text,
  stock             integer not null default 1,
  status            text not null default 'active',
  moderation_status text not null default 'visible',
  view_count        integer not null default 0,
  favorite_count    integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint marketplace_listings_title_check check (char_length(title) between 3 and 120),
  constraint marketplace_listings_description_check check (
    description is null or char_length(description) <= 4000
  ),
  constraint marketplace_listings_price_check check (price_cents >= 0 and price_cents <= 1000000000),
  constraint marketplace_listings_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint marketplace_listings_condition_check check (
    condition in ('new', 'like_new', 'good', 'fair')
  ),
  constraint marketplace_listings_stock_check check (stock between 0 and 999),
  constraint marketplace_listings_status_check check (
    status in ('active', 'reserved', 'sold', 'archived', 'removed')
  ),
  constraint marketplace_listings_moderation_check check (
    moderation_status in ('visible', 'hidden', 'removed')
  )
);

create index if not exists marketplace_listings_feed_idx
  on public.marketplace_listings (created_at desc)
  where status = 'active' and moderation_status = 'visible';
create index if not exists marketplace_listings_seller_idx
  on public.marketplace_listings (seller_id, created_at desc);
create index if not exists marketplace_listings_category_idx
  on public.marketplace_listings (category_id);
create index if not exists marketplace_listings_search_idx
  on public.marketplace_listings
  using gin (to_tsvector('simple', title || ' ' || coalesce(description, '')));

create table if not exists public.marketplace_listing_images (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.marketplace_listings (id) on delete cascade,
  storage_path text not null,
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now(),
  constraint marketplace_images_path_check check (char_length(storage_path) between 3 and 400),
  constraint marketplace_images_sort_check check (sort_order between 0 and 9)
);

create index if not exists marketplace_images_listing_idx
  on public.marketplace_listing_images (listing_id, sort_order);

create table if not exists public.marketplace_favorites (
  listing_id uuid not null references public.marketplace_listings (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);

create index if not exists marketplace_favorites_user_idx
  on public.marketplace_favorites (user_id, created_at desc);

create table if not exists public.marketplace_orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         text,
  buyer_id         uuid not null references public.profiles (id) on delete cascade,
  seller_id        uuid not null references public.profiles (id) on delete cascade,
  status           text not null default 'requested',
  subtotal_cents   bigint not null default 0,
  total_cents      bigint not null default 0,
  currency         text not null default 'TRY',
  payment_method   text not null default 'arrange_with_seller',
  payment_status   text not null default 'not_collected',
  contact_name     text,
  contact_phone    text,
  shipping_city    text,
  shipping_address text,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint marketplace_orders_status_check check (
    status in ('requested', 'confirmed', 'shipped', 'delivered', 'completed', 'cancelled', 'rejected')
  ),
  constraint marketplace_orders_payment_status_check check (
    payment_status in ('not_collected', 'pending', 'paid', 'refunded')
  ),
  constraint marketplace_orders_payment_method_check check (
    payment_method in ('arrange_with_seller', 'stripe', 'iap')
  ),
  constraint marketplace_orders_total_check check (total_cents >= 0),
  constraint marketplace_orders_no_self check (buyer_id <> seller_id)
);

create index if not exists marketplace_orders_buyer_idx
  on public.marketplace_orders (buyer_id, created_at desc);
create index if not exists marketplace_orders_seller_idx
  on public.marketplace_orders (seller_id, created_at desc);

create sequence if not exists public.marketplace_order_seq;

create table if not exists public.marketplace_order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.marketplace_orders (id) on delete cascade,
  listing_id       uuid references public.marketplace_listings (id) on delete set null,
  title_snapshot   text not null,
  image_path       text,
  unit_price_cents bigint not null,
  quantity         integer not null default 1,
  constraint marketplace_order_items_quantity_check check (quantity between 1 and 999),
  constraint marketplace_order_items_price_check check (unit_price_cents >= 0)
);

create index if not exists marketplace_order_items_order_idx
  on public.marketplace_order_items (order_id);

create table if not exists public.marketplace_reviews (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references public.marketplace_orders (id) on delete cascade,
  listing_id  uuid references public.marketplace_listings (id) on delete set null,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id   uuid not null references public.profiles (id) on delete cascade,
  rating      smallint not null,
  comment     text,
  created_at  timestamptz not null default now(),
  constraint marketplace_reviews_rating_check check (rating between 1 and 5),
  constraint marketplace_reviews_comment_check check (comment is null or char_length(comment) <= 1000)
);

create index if not exists marketplace_reviews_seller_idx
  on public.marketplace_reviews (seller_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Category seed (idempotent)
-- ---------------------------------------------------------------------------
insert into public.marketplace_categories (slug, name, icon, sort_order)
values
  ('elektronik', 'Elektronik', 'phone-portrait-outline', 10),
  ('moda', 'Moda', 'shirt-outline', 20),
  ('ev-yasam', 'Ev ve Yaşam', 'home-outline', 30),
  ('otomotiv', 'Otomotiv', 'car-sport-outline', 40),
  ('spor', 'Spor', 'barbell-outline', 50),
  ('koleksiyon', 'Koleksiyon', 'albums-outline', 60),
  ('diger', 'Diğer', 'grid-outline', 70)
on conflict (slug) do update
  set name = excluded.name,
      icon = excluded.icon,
      sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.tz_can_view_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.marketplace_orders o
    where o.id = p_order_id
      and (o.buyer_id = auth.uid() or o.seller_id = auth.uid() or public.is_admin())
  );
$$;

revoke all on function public.tz_can_view_order(uuid) from public, anon;
grant execute on function public.tz_can_view_order(uuid) to authenticated, service_role;

create or replace function public.marketplace_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketplace_listings_touch on public.marketplace_listings;
create trigger marketplace_listings_touch
  before update on public.marketplace_listings
  for each row execute function public.marketplace_set_updated_at();

drop trigger if exists marketplace_orders_touch on public.marketplace_orders;
create trigger marketplace_orders_touch
  before update on public.marketplace_orders
  for each row execute function public.marketplace_set_updated_at();

revoke all on function public.marketplace_set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.marketplace_categories enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_listing_images enable row level security;
alter table public.marketplace_favorites enable row level security;
alter table public.marketplace_orders enable row level security;
alter table public.marketplace_order_items enable row level security;
alter table public.marketplace_reviews enable row level security;

drop policy if exists marketplace_categories_select on public.marketplace_categories;
create policy marketplace_categories_select on public.marketplace_categories
  for select to authenticated
  using (is_active or public.is_admin());

drop policy if exists marketplace_listings_select on public.marketplace_listings;
create policy marketplace_listings_select on public.marketplace_listings
  for select to authenticated
  using (
    seller_id = auth.uid()
    or public.is_admin()
    or (
      moderation_status = 'visible'
      and status in ('active', 'reserved', 'sold')
      and not public.is_blocked(auth.uid(), seller_id)
    )
  );

drop policy if exists marketplace_images_select on public.marketplace_listing_images;
create policy marketplace_images_select on public.marketplace_listing_images
  for select to authenticated
  using (
    exists (
      select 1 from public.marketplace_listings l
      where l.id = listing_id
        and (
          l.seller_id = auth.uid()
          or public.is_admin()
          or (
            l.moderation_status = 'visible'
            and l.status in ('active', 'reserved', 'sold')
            and not public.is_blocked(auth.uid(), l.seller_id)
          )
        )
    )
  );

drop policy if exists marketplace_favorites_select on public.marketplace_favorites;
create policy marketplace_favorites_select on public.marketplace_favorites
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists marketplace_orders_select on public.marketplace_orders;
create policy marketplace_orders_select on public.marketplace_orders
  for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.is_admin());

drop policy if exists marketplace_order_items_select on public.marketplace_order_items;
create policy marketplace_order_items_select on public.marketplace_order_items
  for select to authenticated
  using (public.tz_can_view_order(order_id));

drop policy if exists marketplace_reviews_select on public.marketplace_reviews;
create policy marketplace_reviews_select on public.marketplace_reviews
  for select to authenticated
  using (true);

revoke all on public.marketplace_categories from anon, authenticated;
grant select on public.marketplace_categories to authenticated;

revoke all on public.marketplace_listings from anon, authenticated;
grant select on public.marketplace_listings to authenticated;

revoke all on public.marketplace_listing_images from anon, authenticated;
grant select on public.marketplace_listing_images to authenticated;

revoke all on public.marketplace_favorites from anon, authenticated;
grant select on public.marketplace_favorites to authenticated;

revoke all on public.marketplace_orders from anon, authenticated;
grant select on public.marketplace_orders to authenticated;

revoke all on public.marketplace_order_items from anon, authenticated;
grant select on public.marketplace_order_items to authenticated;

revoke all on public.marketplace_reviews from anon, authenticated;
grant select on public.marketplace_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- Serialisation
-- ---------------------------------------------------------------------------
create or replace function public.tz_listing_json(p_listing_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', l.id,
    'seller_id', l.seller_id,
    'title', l.title,
    'description', l.description,
    'price_cents', l.price_cents,
    'currency', l.currency,
    'condition', l.condition,
    'city', l.city,
    'district', l.district,
    'stock', l.stock,
    'status', l.status,
    'view_count', l.view_count,
    'favorite_count', l.favorite_count,
    'created_at', l.created_at,
    'category_id', l.category_id,
    'category_slug', c.slug,
    'category_name', c.name,
    'seller_username', sp.username,
    'seller_first_name', sp.first_name,
    'seller_last_name', sp.last_name,
    'seller_avatar_path', sp.avatar_path,
    'seller_verified', sp.is_verified,
    'is_mine', l.seller_id = p_me,
    'is_favorite', exists (
      select 1 from public.marketplace_favorites f
      where f.listing_id = l.id and f.user_id = p_me
    ),
    'images', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', i.id, 'storage_path', i.storage_path)
          order by i.sort_order, i.created_at
        )
        from public.marketplace_listing_images i
        where i.listing_id = l.id
      ),
      '[]'::jsonb
    )
  )
  from public.marketplace_listings l
    join public.profiles sp on sp.id = l.seller_id
    left join public.marketplace_categories c on c.id = l.category_id
  where l.id = p_listing_id;
$$;

revoke all on function public.tz_listing_json(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create or replace function public.market_categories()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'slug', r.slug,
            'name', r.name,
            'icon', r.icon,
            'children', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object('id', ch.id, 'slug', ch.slug, 'name', ch.name, 'icon', ch.icon)
                  order by ch.sort_order, ch.name
                )
                from public.marketplace_categories ch
                where ch.parent_id = r.id and ch.is_active
              ),
              '[]'::jsonb
            )
          )
          order by r.sort_order, r.name
        )
        from public.marketplace_categories r
        where r.parent_id is null and r.is_active
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.market_categories() from public, anon;
grant execute on function public.market_categories() to authenticated;

-- ---------------------------------------------------------------------------
-- Listings
-- ---------------------------------------------------------------------------
create or replace function public.market_list(
  p_query       text default null,
  p_category    text default null,
  p_city        text default null,
  p_sort        text default 'new',
  p_favorites   boolean default false,
  p_mine        boolean default false,
  p_limit       integer default 20,
  p_offset      integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_query    text := nullif(trim(coalesce(p_query, '')), '');
  v_city     text := nullif(trim(coalesce(p_city, '')), '');
  v_category text := nullif(trim(coalesce(p_category, '')), '');
  v_sort     text := coalesce(nullif(trim(p_sort), ''), 'new');
  v_limit    integer := least(greatest(coalesce(p_limit, 20), 1), 40);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_cat_id   uuid;
begin
  if v_sort not in ('new', 'price_asc', 'price_desc', 'popular') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;

  if v_category is not null then
    select c.id into v_cat_id from public.marketplace_categories c where c.slug = v_category;
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_listing_json(x.id, v_uid) order by ranked.rn)
        from (
          select
            l.id,
            row_number() over (
              order by
                case when v_sort = 'price_asc' then l.price_cents end asc,
                case when v_sort = 'price_desc' then l.price_cents end desc,
                case when v_sort = 'popular' then
                  (l.favorite_count * 2 + l.view_count)
                end desc nulls last,
                l.created_at desc
            ) as rn
          from public.marketplace_listings l
            join public.profiles sp on sp.id = l.seller_id
          where sp.account_status = 'active'
            and (
              (coalesce(p_mine, false) and l.seller_id = v_uid)
              or (
                not coalesce(p_mine, false)
                and l.moderation_status = 'visible'
                and l.status = 'active'
                and not public.is_blocked(v_uid, l.seller_id)
              )
            )
            and (
              not coalesce(p_favorites, false)
              or exists (
                select 1 from public.marketplace_favorites f
                where f.listing_id = l.id and f.user_id = v_uid
              )
            )
            and (
              v_cat_id is null
              or l.category_id = v_cat_id
              or l.category_id in (
                select c2.id from public.marketplace_categories c2 where c2.parent_id = v_cat_id
              )
            )
            and (v_city is null or (l.city is not null and lower(l.city) = lower(v_city)))
            and (
              v_query is null
              or l.title ilike '%' || v_query || '%'
              or coalesce(l.description, '') ilike '%' || v_query || '%'
            )
        ) ranked
        join public.marketplace_listings x on x.id = ranked.id
        where ranked.rn > v_offset and ranked.rn <= v_offset + v_limit
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.market_list(text, text, text, text, boolean, boolean, integer, integer)
  from public, anon;
grant execute on function public.market_list(text, text, text, text, boolean, boolean, integer, integer)
  to authenticated;

create or replace function public.market_get(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.tz_require_uid();
  v_seller uuid;
  v_visible boolean;
  v_result jsonb;
begin
  select l.seller_id into v_seller
  from public.marketplace_listings l where l.id = p_listing_id;

  if v_seller is null then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  select (
    l.seller_id = v_uid
    or public.is_admin()
    or (
      l.moderation_status = 'visible'
      and l.status in ('active', 'reserved', 'sold')
      and not public.is_blocked(v_uid, l.seller_id)
    )
  ) into v_visible
  from public.marketplace_listings l where l.id = p_listing_id;

  if not coalesce(v_visible, false) then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  if v_seller <> v_uid then
    update public.marketplace_listings
       set view_count = view_count + 1
     where id = p_listing_id;
  end if;

  v_result := public.tz_listing_json(p_listing_id, v_uid);

  return v_result || jsonb_build_object(
    'seller_stats', jsonb_build_object(
      'listings', (select count(*) from public.marketplace_listings l where l.seller_id = v_seller and l.status = 'active'),
      'sales', (select count(*) from public.marketplace_orders o where o.seller_id = v_seller and o.status in ('delivered', 'completed')),
      'rating', (
        select round(avg(r.rating)::numeric, 1) from public.marketplace_reviews r where r.seller_id = v_seller
      ),
      'review_count', (select count(*) from public.marketplace_reviews r where r.seller_id = v_seller)
    )
  );
end;
$$;

revoke all on function public.market_get(uuid) from public, anon;
grant execute on function public.market_get(uuid) to authenticated;

create or replace function public.market_create_listing(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_title  text := nullif(trim(coalesce(p_payload ->> 'title', '')), '');
  v_desc   text := nullif(trim(coalesce(p_payload ->> 'description', '')), '');
  v_price  bigint := coalesce((p_payload ->> 'price_cents')::bigint, -1);
  v_cond   text := coalesce(nullif(trim(p_payload ->> 'condition'), ''), 'good');
  v_stock  integer := coalesce((p_payload ->> 'stock')::integer, 1);
  v_cat    uuid := nullif(p_payload ->> 'category_id', '')::uuid;
  v_city   text := nullif(trim(coalesce(p_payload ->> 'city', '')), '');
  v_dist   text := nullif(trim(coalesce(p_payload ->> 'district', '')), '');
  v_images jsonb := coalesce(p_payload -> 'images', '[]'::jsonb);
  v_item   jsonb;
  v_path   text;
  v_index  integer := 0;
  v_id     uuid;
begin
  if v_title is null or char_length(v_title) < 3 or char_length(v_title) > 120 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  if v_desc is not null and char_length(v_desc) > 4000 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;

  if v_price < 0 or v_price > 1000000000 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  if v_cond not in ('new', 'like_new', 'good', 'fair') then
    raise exception 'invalid_condition' using errcode = '22023';
  end if;

  if v_stock < 0 or v_stock > 999 then
    raise exception 'invalid_stock' using errcode = '22023';
  end if;

  if v_cat is not null and not exists (
    select 1 from public.marketplace_categories c where c.id = v_cat and c.is_active
  ) then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  if jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) > 8 then
    raise exception 'invalid_images' using errcode = '22023';
  end if;

  perform public.safety_check_rate('listing_create', 30, interval '1 day');

  insert into public.marketplace_listings (
    seller_id, category_id, title, description, price_cents, condition, city, district, stock
  )
  values (v_uid, v_cat, v_title, v_desc, v_price, v_cond, v_city, v_dist, v_stock)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_images)
  loop
    v_path := v_item ->> 'storage_path';
    perform public.tz_validate_media_path(v_path, v_uid);

    insert into public.marketplace_listing_images (listing_id, storage_path, sort_order)
    values (v_id, v_path, v_index);

    v_index := v_index + 1;
  end loop;

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.market_create_listing(jsonb) from public, anon;
grant execute on function public.market_create_listing(jsonb) to authenticated;

create or replace function public.market_update_listing(p_listing_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_row    public.marketplace_listings%rowtype;
  v_cat    uuid;
  v_images jsonb := p_payload -> 'images';
  v_item   jsonb;
  v_path   text;
  v_index  integer := 0;
begin
  select * into v_row from public.marketplace_listings where id = p_listing_id;
  if not found or (v_row.seller_id <> v_uid and not public.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_payload ? 'category_id' then
    v_cat := nullif(p_payload ->> 'category_id', '')::uuid;
    if v_cat is not null and not exists (
      select 1 from public.marketplace_categories c where c.id = v_cat and c.is_active
    ) then
      raise exception 'invalid_category' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'title' then
    if char_length(trim(coalesce(p_payload ->> 'title', ''))) < 3 then
      raise exception 'invalid_title' using errcode = '22023';
    end if;
  end if;

  update public.marketplace_listings l
     set title = coalesce(nullif(trim(p_payload ->> 'title'), ''), l.title),
         description = case when p_payload ? 'description'
           then nullif(trim(coalesce(p_payload ->> 'description', '')), '')
           else l.description end,
         price_cents = coalesce((p_payload ->> 'price_cents')::bigint, l.price_cents),
         condition = coalesce(nullif(p_payload ->> 'condition', ''), l.condition),
         city = case when p_payload ? 'city'
           then nullif(trim(coalesce(p_payload ->> 'city', '')), '') else l.city end,
         district = case when p_payload ? 'district'
           then nullif(trim(coalesce(p_payload ->> 'district', '')), '') else l.district end,
         stock = coalesce((p_payload ->> 'stock')::integer, l.stock),
         category_id = case when p_payload ? 'category_id' then v_cat else l.category_id end
   where l.id = p_listing_id;

  if v_images is not null and jsonb_typeof(v_images) = 'array' then
    if jsonb_array_length(v_images) > 8 then
      raise exception 'invalid_images' using errcode = '22023';
    end if;

    delete from public.marketplace_listing_images i where i.listing_id = p_listing_id;

    for v_item in select * from jsonb_array_elements(v_images)
    loop
      v_path := v_item ->> 'storage_path';
      perform public.tz_validate_media_path(v_path, v_uid);

      insert into public.marketplace_listing_images (listing_id, storage_path, sort_order)
      values (p_listing_id, v_path, v_index);

      v_index := v_index + 1;
    end loop;
  end if;

  return public.tz_listing_json(p_listing_id, v_uid);
end;
$$;

revoke all on function public.market_update_listing(uuid, jsonb) from public, anon;
grant execute on function public.market_update_listing(uuid, jsonb) to authenticated;

create or replace function public.market_set_status(p_listing_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_status text := coalesce(nullif(trim(p_status), ''), 'active');
  v_row    public.marketplace_listings%rowtype;
begin
  if v_status not in ('active', 'archived', 'sold', 'removed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_row from public.marketplace_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  if v_status = 'removed' then
    if not public.is_admin() then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
  elsif v_row.seller_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.marketplace_listings l
     set status = v_status
   where l.id = p_listing_id;
end;
$$;

revoke all on function public.market_set_status(uuid, text) from public, anon;
grant execute on function public.market_set_status(uuid, text) to authenticated;

create or replace function public.market_delete_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not exists (
    select 1 from public.marketplace_listings l
    where l.id = p_listing_id
      and (l.seller_id = v_uid or public.is_admin())
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.marketplace_order_items i
      join public.marketplace_orders o on o.id = i.order_id
    where i.listing_id = p_listing_id
      and o.status not in ('cancelled', 'rejected')
  ) then
    raise exception 'listing_has_open_orders' using errcode = '22023';
  end if;

  delete from public.marketplace_listings where id = p_listing_id;
end;
$$;

revoke all on function public.market_delete_listing(uuid) from public, anon;
grant execute on function public.market_delete_listing(uuid) to authenticated;

create or replace function public.market_toggle_favorite(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.tz_require_uid();
  v_fav     boolean;
  v_count   integer;
begin
  if not exists (
    select 1 from public.marketplace_listings l
    where l.id = p_listing_id and l.moderation_status = 'visible' and l.status = 'active'
  ) then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.marketplace_favorites f
    where f.listing_id = p_listing_id and f.user_id = v_uid
  ) then
    delete from public.marketplace_favorites f
    where f.listing_id = p_listing_id and f.user_id = v_uid;
    update public.marketplace_listings
       set favorite_count = greatest(favorite_count - 1, 0)
     where id = p_listing_id;
    v_fav := false;
  else
    insert into public.marketplace_favorites (listing_id, user_id)
    values (p_listing_id, v_uid)
    on conflict do nothing;
    update public.marketplace_listings
       set favorite_count = favorite_count + 1
     where id = p_listing_id;
    v_fav := true;
  end if;

  select l.favorite_count into v_count from public.marketplace_listings l where l.id = p_listing_id;

  return jsonb_build_object('favorite', v_fav, 'favorite_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.market_toggle_favorite(uuid) from public, anon;
grant execute on function public.market_toggle_favorite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create or replace function public.market_create_order(
  p_items   jsonb,
  p_contact jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_items    jsonb := coalesce(p_items, '[]'::jsonb);
  v_item     jsonb;
  v_listing  public.marketplace_listings%rowtype;
  v_seller   uuid;
  v_subtotal bigint := 0;
  v_order    uuid;
  v_order_no text;
  v_qty      integer;
  v_title    text;
  v_name     text;
begin
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0
     or jsonb_array_length(v_items) > 20 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_contact, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_contact' using errcode = '22023';
  end if;

  perform public.safety_check_rate('order_create', 20, interval '1 day');

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    select * into v_listing
    from public.marketplace_listings l
    where l.id = nullif(v_item ->> 'listing_id', '')::uuid
    for update;

    if not found then
      raise exception 'listing_not_found' using errcode = '22023';
    end if;

    if v_listing.seller_id = v_uid then
      raise exception 'cannot_buy_own_listing' using errcode = '22023';
    end if;

    if v_listing.status <> 'active' or v_listing.moderation_status <> 'visible' then
      raise exception 'listing_unavailable' using errcode = '22023';
    end if;

    if public.is_blocked(v_uid, v_listing.seller_id) then
      raise exception 'blocked' using errcode = '42501';
    end if;

    if v_seller is null then
      v_seller := v_listing.seller_id;
    elsif v_seller <> v_listing.seller_id then
      raise exception 'single_seller_per_order' using errcode = '22023';
    end if;

    v_qty := greatest(coalesce((v_item ->> 'quantity')::integer, 1), 1);
    if v_qty > v_listing.stock then
      raise exception 'insufficient_stock' using errcode = '22023';
    end if;

    v_subtotal := v_subtotal + (v_listing.price_cents * v_qty);
  end loop;

  insert into public.marketplace_orders (
    buyer_id, seller_id, subtotal_cents, total_cents, currency,
    contact_name, contact_phone, shipping_city, shipping_address, note
  )
  values (
    v_uid, v_seller, v_subtotal, v_subtotal, 'TRY',
    nullif(trim(coalesce(p_contact ->> 'contact_name', '')), ''),
    nullif(trim(coalesce(p_contact ->> 'contact_phone', '')), ''),
    nullif(trim(coalesce(p_contact ->> 'shipping_city', '')), ''),
    nullif(trim(coalesce(p_contact ->> 'shipping_address', '')), ''),
    nullif(trim(coalesce(p_contact ->> 'note', '')), '')
  )
  returning id into v_order;

  update public.marketplace_orders
     set order_no = 'TZ-' || to_char(now(), 'YYMM') || '-' ||
         lpad(nextval('public.marketplace_order_seq')::text, 6, '0')
   where id = v_order
  returning order_no into v_order_no;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    select * into v_listing
    from public.marketplace_listings l
    where l.id = nullif(v_item ->> 'listing_id', '')::uuid;

    v_qty := greatest(coalesce((v_item ->> 'quantity')::integer, 1), 1);

    insert into public.marketplace_order_items (
      order_id, listing_id, title_snapshot, image_path, unit_price_cents, quantity
    )
    values (
      v_order,
      v_listing.id,
      v_listing.title,
      (
        select i.storage_path from public.marketplace_listing_images i
        where i.listing_id = v_listing.id
        order by i.sort_order limit 1
      ),
      v_listing.price_cents,
      v_qty
    );

    update public.marketplace_listings l
       set stock = greatest(l.stock - v_qty, 0),
           status = case when l.stock - v_qty <= 0 then 'reserved' else l.status end
     where l.id = v_listing.id;
  end loop;

  select trim(concat_ws(' ', p.first_name, p.last_name)) into v_name
  from public.profiles p where p.id = v_uid;

  perform public.tz_notify(
    v_seller, v_uid, 'order',
    coalesce(v_name, 'Bir kullanıcı') || ' sipariş talebi gönderdi',
    v_order_no, 'order', v_order::text, '/marketplace/orders'
  );

  return jsonb_build_object('id', v_order, 'order_no', v_order_no, 'total_cents', v_subtotal);
end;
$$;

revoke all on function public.market_create_order(jsonb, jsonb) from public, anon;
grant execute on function public.market_create_order(jsonb, jsonb) to authenticated;

create or replace function public.market_orders(p_role text default 'buyer')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.tz_require_uid();
  v_role text := coalesce(nullif(trim(p_role), ''), 'buyer');
begin
  if v_role not in ('buyer', 'seller') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'order_no', o.order_no,
            'status', o.status,
            'total_cents', o.total_cents,
            'currency', o.currency,
            'payment_status', o.payment_status,
            'created_at', o.created_at,
            'role', v_role,
            'counterpart_id', case when v_role = 'buyer' then o.seller_id else o.buyer_id end,
            'counterpart_username', cp.username,
            'counterpart_first_name', cp.first_name,
            'counterpart_last_name', cp.last_name,
            'counterpart_avatar_path', cp.avatar_path,
            'item_count', (select count(*) from public.marketplace_order_items i where i.order_id = o.id),
            'items', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', i.id,
                    'listing_id', i.listing_id,
                    'title', i.title_snapshot,
                    'image_path', i.image_path,
                    'unit_price_cents', i.unit_price_cents,
                    'quantity', i.quantity
                  )
                  order by i.id
                )
                from public.marketplace_order_items i
                where i.order_id = o.id
              ),
              '[]'::jsonb
            )
          )
          order by o.created_at desc
        )
        from public.marketplace_orders o
          join public.profiles cp
            on cp.id = case when v_role = 'buyer' then o.seller_id else o.buyer_id end
        where (v_role = 'buyer' and o.buyer_id = v_uid)
           or (v_role = 'seller' and o.seller_id = v_uid)
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.market_orders(text) from public, anon;
grant execute on function public.market_orders(text) to authenticated;

create or replace function public.market_update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_status text := coalesce(nullif(trim(p_status), ''), '');
  v_row    public.marketplace_orders%rowtype;
  v_allowed boolean := false;
  v_notify uuid;
  v_title  text;
begin
  select * into v_row from public.marketplace_orders where id = p_order_id;
  if not found then
    raise exception 'order_not_found' using errcode = '22023';
  end if;

  if v_status not in ('confirmed', 'shipped', 'delivered', 'completed', 'cancelled', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  if v_row.seller_id = v_uid then
    v_allowed := (v_row.status = 'requested' and v_status in ('confirmed', 'rejected'))
      or (v_row.status = 'confirmed' and v_status = 'shipped')
      or (v_row.status = 'shipped' and v_status = 'delivered');
    v_notify := v_row.buyer_id;
  elsif v_row.buyer_id = v_uid then
    v_allowed := (v_row.status = 'requested' and v_status = 'cancelled')
      or (v_row.status = 'shipped' and v_status = 'completed')
      or (v_row.status = 'delivered' and v_status = 'completed');
    v_notify := v_row.seller_id;
  end if;

  if not v_allowed then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  update public.marketplace_orders
     set status = v_status
   where id = p_order_id;

  if v_status in ('cancelled', 'rejected') then
    for v_title in
      select i.listing_id::text from public.marketplace_order_items i
      where i.order_id = p_order_id and i.listing_id is not null
    loop
      update public.marketplace_listings l
         set stock = l.stock + (
               select i.quantity from public.marketplace_order_items i
               where i.order_id = p_order_id and i.listing_id::text = v_title
               limit 1
             ),
             status = case when l.status = 'reserved' then 'active' else l.status end
       where l.id = v_title::uuid;
    end loop;
  end if;

  perform public.tz_notify(
    v_notify, v_uid, 'order', 'Sipariş durumu güncellendi',
    v_row.order_no || ' · ' || v_status, 'order', p_order_id::text, '/marketplace/orders'
  );

  return jsonb_build_object('id', p_order_id, 'status', v_status);
end;
$$;

revoke all on function public.market_update_order_status(uuid, text) from public, anon;
grant execute on function public.market_update_order_status(uuid, text) to authenticated;

create or replace function public.market_submit_review(
  p_order_id uuid,
  p_rating   integer,
  p_comment  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_order public.marketplace_orders%rowtype;
  v_item  public.marketplace_order_items%rowtype;
  v_name  text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating' using errcode = '22023';
  end if;

  select * into v_order from public.marketplace_orders where id = p_order_id;

  if not found or v_order.buyer_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_order.status not in ('delivered', 'completed') then
    raise exception 'order_not_delivered' using errcode = '22023';
  end if;

  select * into v_item from public.marketplace_order_items i
  where i.order_id = p_order_id order by i.id limit 1;

  insert into public.marketplace_reviews (
    order_id, listing_id, reviewer_id, seller_id, rating, comment
  )
  values (
    p_order_id, v_item.listing_id, v_uid, v_order.seller_id, p_rating,
    nullif(trim(coalesce(p_comment, '')), '')
  )
  on conflict (order_id) do nothing;

  update public.marketplace_orders set status = 'completed' where id = p_order_id;

  select trim(concat_ws(' ', p.first_name, p.last_name)) into v_name
  from public.profiles p where p.id = v_uid;

  perform public.tz_notify(
    v_order.seller_id, v_uid, 'order', 'Yeni değerlendirme',
    coalesce(v_name, 'Bir alıcı') || ' sana ' || p_rating || ' yıldız verdi',
    'order', p_order_id::text, '/marketplace/orders'
  );
end;
$$;

revoke all on function public.market_submit_review(uuid, integer, text) from public, anon;
grant execute on function public.market_submit_review(uuid, integer, text) to authenticated;

create or replace function public.market_seller(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.account_status = 'active'
  ) then
    raise exception 'seller_not_found' using errcode = '22023';
  end if;

  return (
    select jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'avatar_path', p.avatar_path,
      'bio', p.bio,
      'city', case when coalesce(s.show_city, true) then p.city else null end,
      'is_verified', p.is_verified,
      'created_at', p.created_at,
      'listings', (
        select count(*) from public.marketplace_listings l
        where l.seller_id = p.id and l.status = 'active' and l.moderation_status = 'visible'
      ),
      'sales', (
        select count(*) from public.marketplace_orders o
        where o.seller_id = p.id and o.status in ('delivered', 'completed')
      ),
      'rating', (
        select round(avg(r.rating)::numeric, 1) from public.marketplace_reviews r
        where r.seller_id = p.id
      ),
      'review_count', (
        select count(*) from public.marketplace_reviews r where r.seller_id = p.id
      ),
      'reviews', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', r.id,
              'rating', r.rating,
              'comment', r.comment,
              'created_at', r.created_at,
              'reviewer_username', rp.username
            )
            order by r.created_at desc
          )
          from public.marketplace_reviews r
            join public.profiles rp on rp.id = r.reviewer_id
          where r.seller_id = p.id
          limit 10
        ),
        '[]'::jsonb
      )
    )
    from public.profiles p
      left join public.profile_settings s on s.user_id = p.id
    where p.id = p_user_id
  );
end;
$$;

revoke all on function public.market_seller(uuid) from public, anon;
grant execute on function public.market_seller(uuid) to authenticated;

-- Convenience: reusable listing list for a seller profile page.
create or replace function public.market_seller_listings(
  p_user_id uuid,
  p_limit   integer default 20,
  p_offset  integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 40);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_listing_json(x.id, v_uid) order by x.created_at desc)
        from (
          select l.id, l.created_at
          from public.marketplace_listings l
          where l.seller_id = p_user_id
            and (
              (l.seller_id = v_uid)
              or (l.status = 'active' and l.moderation_status = 'visible')
            )
            and not public.is_blocked(v_uid, l.seller_id)
          order by l.created_at desc
          limit v_limit offset v_offset
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.market_seller_listings(uuid, integer, integer) from public, anon;
grant execute on function public.market_seller_listings(uuid, integer, integer) to authenticated;
