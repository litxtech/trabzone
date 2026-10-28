-- 0077_seo_listing_prerender.sql
-- İlan detaylarının Google'a sunucu tarafında işlenmiş HTML olarak
-- verilebilmesi için herkese açık, dar kapsamlı okuma fonksiyonları.
--
-- Mevcut RPC'ler (market_listing_detail, re_get) oturum açmış kullanıcı
-- ister: `tz_require_uid()` çağırır ve anon rolüne hiç verilmemiştir.
-- Arama motoru botu oturum açamadığı için bu fonksiyonlar yalnızca
-- YAYINDA olan ilanların herkese açık alanlarını döner; iletişim bilgisi,
-- tam adres, doğrulama referansı gibi alanlar hiç seçilmez.

-- ---------------------------------------------------------------------------
-- 1. Marketplace ilanı (ürün / araç / hizmet / iş)
-- ---------------------------------------------------------------------------
create or replace function public.seo_market_listing(p_listing_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'kind', 'market',
    'id', l.id,
    'title', l.title,
    'description', nullif(left(btrim(coalesce(l.description, '')), 600), ''),
    'price_cents', l.price_cents,
    'currency', l.currency,
    'price_period', l.price_period,
    'condition', l.condition,
    'status', l.status,
    'city', l.city,
    'district', coalesce(d.name, l.district),
    'category_name', c.name,
    'category_kind', c.kind,
    'cover_path', (
      select i.storage_path
      from public.marketplace_listing_images i
      where i.listing_id = l.id and i.kind = 'image'
      order by i.is_cover desc, i.sort_order, i.created_at
      limit 1
    ),
    'image_count', (
      select count(*)
      from public.marketplace_listing_images i
      where i.listing_id = l.id and i.kind = 'image'
    ),
    'published_at', coalesce(l.published_at, l.created_at),
    'updated_at', coalesce(l.updated_at, l.published_at, l.created_at)
  )
  from public.marketplace_listings l
  join public.profiles p on p.id = l.seller_id
  left join public.marketplace_categories c on c.id = l.category_id
  left join public.districts d on d.id = l.district_id
  where l.id = p_listing_id
    and l.moderation_status = 'visible'
    and l.status in ('active', 'reserved', 'sold')
    and p.account_status = 'active'
  limit 1;
$$;

revoke all on function public.seo_market_listing(uuid) from public, anon, authenticated;
grant execute on function public.seo_market_listing(uuid) to anon, authenticated, service_role;

comment on function public.seo_market_listing(uuid) is
  'SEO/önizleme: yayındaki marketplace ilanının herkese açık alanları. Bulunamazsa null.';

-- ---------------------------------------------------------------------------
-- 2. Emlak ilanı
-- ---------------------------------------------------------------------------
create or replace function public.seo_real_estate_listing(p_listing_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'kind', 'real_estate',
    'id', r.id,
    'title', r.title,
    'description', nullif(left(btrim(coalesce(r.description, '')), 600), ''),
    'price_cents', r.price_cents,
    'currency', r.currency,
    'price_period', r.price_period,
    'listing_kind', r.listing_kind,
    'status', r.status,
    'district', d.name,
    'category_name', c.name,
    'gross_m2', r.gross_m2,
    'net_m2', r.net_m2,
    'room_count', r.room_count,
    'building_age', r.building_age,
    'cover_path', (
      select m.storage_path
      from public.real_estate_media m
      where m.listing_id = r.id and m.kind = 'image' and m.status = 'approved'
      order by m.cover desc, m.sort_order, m.created_at
      limit 1
    ),
    'image_count', (
      select count(*)
      from public.real_estate_media m
      where m.listing_id = r.id and m.kind = 'image' and m.status = 'approved'
    ),
    'published_at', r.published_at,
    'updated_at', coalesce(r.updated_at, r.published_at)
  )
  from public.real_estate_listings r
  join public.profiles p on p.id = r.owner_id
  left join public.real_estate_categories c on c.id = r.category_id
  left join public.districts d on d.id = r.district_id
  where r.id = p_listing_id
    and r.status = 'published'
    and p.account_status = 'active'
  limit 1;
$$;

revoke all on function public.seo_real_estate_listing(uuid) from public, anon, authenticated;
grant execute on function public.seo_real_estate_listing(uuid) to anon, authenticated, service_role;

comment on function public.seo_real_estate_listing(uuid) is
  'SEO/önizleme: yayındaki emlak ilanının herkese açık alanları. Bulunamazsa null.';

-- ---------------------------------------------------------------------------
-- 3. Sitemap için yayındaki ilan adresleri
-- ---------------------------------------------------------------------------
create or replace function public.seo_listing_urls(
  p_limit integer default 5000,
  p_offset integer default 0
)
returns table (kind text, listing_id uuid, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with rows as (
    select
      'market'::text as kind,
      l.id as listing_id,
      coalesce(l.updated_at, l.published_at, l.created_at) as updated_at,
      coalesce(l.published_at, l.created_at) as sort_at
    from public.marketplace_listings l
    join public.profiles p on p.id = l.seller_id
    where l.moderation_status = 'visible'
      and l.status in ('active', 'reserved', 'sold')
      and p.account_status = 'active'
    union all
    select
      'real_estate'::text as kind,
      r.id as listing_id,
      coalesce(r.updated_at, r.published_at) as updated_at,
      coalesce(r.published_at, r.updated_at) as sort_at
    from public.real_estate_listings r
    join public.profiles p on p.id = r.owner_id
    where r.status = 'published'
      and p.account_status = 'active'
  )
  select kind, listing_id, updated_at
  from rows
  order by sort_at desc nulls last, listing_id
  limit least(greatest(coalesce(p_limit, 5000), 1), 20000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.seo_listing_urls(integer, integer) from public, anon, authenticated;
grant execute on function public.seo_listing_urls(integer, integer) to anon, authenticated, service_role;

comment on function public.seo_listing_urls(integer, integer) is
  'Sitemap: yayındaki marketplace ve emlak ilanlarının (kind, id, updated_at) listesi.';
