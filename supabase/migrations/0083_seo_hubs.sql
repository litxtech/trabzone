-- 0080_seo_hubs.sql
-- Programatik SEO: ilçe + kategori + alt kategori birleşimlerinden oluşan
-- hub sayfalarının veri kaynağı.
--
-- Amaç: "trabzon iş ilanları", "ortahisar kiralık daire", "yomra ikinci el
-- telefon" gibi aramalar için GERÇEK ilan içeren sayfalar üretmek. Boş
-- kombinasyonlar sayfa olarak dönmez; sitemap'e de girmez. Böylece Google'a
-- ince/boş sonuç sayfası sunulmaz.
--
-- Sayfa adresi biçimi (tek şehir: Trabzon):
--   /trabzon
--   /trabzon/{ilce}
--   /trabzon/{bolum}
--   /trabzon/{bolum}/{kategori}
--   /trabzon/{ilce}/{bolum}
--   /trabzon/{ilce}/{bolum}/{kategori}
--
-- `bolum` bir marketplace kök kategorisidir (is-ilanlari, araclar, telefon-tablet,
-- isletmeler, ustalar-hizmetler ...). `emlak` kökü emlak ilanlarını, `place`
-- türündeki kökler (isletmeler, turizm-konaklama) işletmeleri gösterir.
-- Ayrıca sanal `ikinci-el` bölümü tüm ürün ilanlarını bir araya getirir.
--
-- Fonksiyonlar yalnızca YAYINDAKİ, herkese açık alanları döner; oturum
-- gerektirmez (arama motoru botu giriş yapamaz). İletişim bilgisi, tam adres,
-- doğrulama referansı gibi alanlar hiç seçilmez.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Yardımcılar
-- ---------------------------------------------------------------------------

-- Kök slug'ı kategori slug'ından çıkarır:
--   ('telefon-tablet', 'telefon-tablet-telefonlar-iphone') -> 'telefonlar-iphone'
--   ('emlak', 'kiralik-daire') -> 'kiralik-daire'
create or replace function public.tz_hub_short_slug(p_root text, p_slug text)
returns text
language sql
immutable
as $$
  select case
    when p_slug is null then null
    when p_root is null or p_root = '' then p_slug
    when p_slug = p_root then ''
    when p_slug like p_root || '-%' then substr(p_slug, char_length(p_root) + 2)
    else p_slug
  end;
$$;

revoke all on function public.tz_hub_short_slug(text, text) from public, anon, authenticated;

create or replace function public.tz_market_descendants(p_slug text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select c.id
    from public.marketplace_categories c
    where c.slug = p_slug and c.is_active
    union all
    select ch.id
    from public.marketplace_categories ch
    join tree t on t.id = ch.parent_id
    where ch.is_active
  )
  select coalesce(array_agg(id), '{}'::uuid[]) from tree;
$$;

revoke all on function public.tz_market_descendants(text) from public, anon, authenticated;

create or replace function public.tz_realestate_descendants(p_slug text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select c.id
    from public.real_estate_categories c
    where c.slug = p_slug and c.is_active
    union all
    select ch.id
    from public.real_estate_categories ch
    join tree t on t.id = ch.parent_id
    where ch.is_active
  )
  select coalesce(array_agg(id), '{}'::uuid[]) from tree;
$$;

revoke all on function public.tz_realestate_descendants(text) from public, anon, authenticated;

create or replace function public.tz_place_descendants(p_slug text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select c.id
    from public.place_categories c
    where c.slug = p_slug and c.is_active
    union all
    select ch.id
    from public.place_categories ch
    join tree t on t.id = ch.parent_id
    where ch.is_active
  )
  select coalesce(array_agg(id), '{}'::uuid[]) from tree;
$$;

revoke all on function public.tz_place_descendants(text) from public, anon, authenticated;

-- Bölüm bazında işletme kapsamı. `isletmeler` turizm dışındaki tüm işletmeleri,
-- `turizm-konaklama` yalnızca konaklama ve gezilecek yerleri gösterir. Böylece
-- aynı kayıt iki farklı bölümde birebir kopya sayfa üretmez.
create or replace function public.tz_place_section_ids(p_section_slug text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive turizm as (
    select c.id
    from public.place_categories c
    where c.is_active
      and c.slug in (
        'konaklama', 'otel', 'pansiyon', 'apart-otel', 'bungalov',
        'konaklama-tesisi', 'turistik-yer', 'gezilecek-nokta', 'tarihi-kulturel'
      )
    union all
    select ch.id
    from public.place_categories ch
    join turizm t on t.id = ch.parent_id
    where ch.is_active
  )
  select coalesce(array_agg(c.id), '{}'::uuid[])
  from public.place_categories c
  where c.is_active
    and (
      (p_section_slug = 'turizm-konaklama' and c.id in (select id from turizm))
      or (p_section_slug = 'isletmeler' and c.id not in (select id from turizm))
      or p_section_slug not in ('turizm-konaklama', 'isletmeler')
    );
$$;

revoke all on function public.tz_place_section_ids(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Hub sayfası
-- ---------------------------------------------------------------------------
create or replace function public.seo_hub_page(
  p_path text[] default '{}'::text[],
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_path text[];
  v_len integer;
  v_seg text;

  v_has_district boolean := false;
  v_district_id bigint;
  v_district_slug text;
  v_district_name text;

  v_mode text;
  v_section_id uuid;
  v_section_slug text;
  v_section_name text;
  v_section_kind text;
  v_section_description text;

  v_has_category boolean := false;
  v_cat_id uuid;
  v_cat_slug text;
  v_cat_name text;
  v_cat_parent uuid;
  v_cat_sort integer;

  v_market_ids uuid[];
  v_market_cat_ids uuid[];
  v_re_ids uuid[];
  v_re_cat_ids uuid[];
  v_place_ids uuid[];
  v_place_cat_ids uuid[];

  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  v_total bigint := 0;
  v_updated timestamptz;
  v_items jsonb := '[]'::jsonb;
  v_sections jsonb := '[]'::jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_districts jsonb := '[]'::jsonb;
  v_hub_path text := '/trabzon';
  v_link_parent uuid;
begin
  -- Gelen yol parçalarını normalize et (boşları at, küçük harfe indir).
  select coalesce(array_agg(lower(btrim(seg)) order by ord), '{}'::text[])
  into v_path
  from unnest(coalesce(p_path, '{}'::text[])) with ordinality as t(seg, ord)
  where btrim(seg) <> '';

  v_len := coalesce(array_length(v_path, 1), 0);
  if v_len > 3 then
    return jsonb_build_object('ok', false);
  end if;

  -- 2.1 İlçe (ilk parça ilçe slug'ı ise)
  if v_len >= 1 then
    select d.id, d.slug, d.name
    into v_district_id, v_district_slug, v_district_name
    from public.districts d
    join public.cities c on c.id = d.city_id and c.is_active
    where d.slug = v_path[1]
    limit 1;

    if v_district_id is not null then
      v_has_district := true;
      v_path := v_path[2:];
      v_len := coalesce(array_length(v_path, 1), 0);
    end if;
  end if;

  -- 2.2 Bölüm (marketplace kök kategorisi veya sanal ikinci-el)
  if v_len >= 1 then
    v_seg := v_path[1];

    select c.id, c.slug, c.name, c.kind, c.description
    into v_section_id, v_section_slug, v_section_name, v_section_kind, v_section_description
    from public.marketplace_categories c
    where c.parent_id is null
      and c.slug = v_seg
      and c.is_active
    limit 1;

    if v_section_id is null and v_seg = 'emlak' then
      -- Emlak kökü silinse/taşınsa bile adres çalışsın.
      v_section_slug := 'emlak';
      v_section_name := 'Emlak';
      v_section_kind := 'real_estate';
    end if;

    if v_section_slug is null and v_seg = 'ikinci-el' then
      v_mode := 'market';
      v_section_slug := 'ikinci-el';
      v_section_name := 'İkinci El';
      v_section_kind := 'product';
      select coalesce(array_agg(c.id), '{}'::uuid[])
      into v_market_ids
      from public.marketplace_categories c
      where c.is_active and c.kind = 'product';
    elsif v_section_slug is not null then
      v_mode := case v_section_kind
        when 'real_estate' then 'real_estate'
        when 'place' then 'places'
        else 'market'
      end;
      if v_mode = 'market' then
        v_market_ids := public.tz_market_descendants(v_section_slug);
      elsif v_mode = 'places' then
        v_place_ids := public.tz_place_section_ids(v_section_slug);
      end if;
    else
      return jsonb_build_object('ok', false);
    end if;

    v_path := v_path[2:];
    v_len := coalesce(array_length(v_path, 1), 0);
  end if;

  if v_len > 1 then
    return jsonb_build_object('ok', false);
  end if;

  -- 2.3 Kategori
  if v_len = 1 then
    if v_section_slug is null then
      return jsonb_build_object('ok', false);
    end if;

    v_seg := v_path[1];

    if v_mode = 'market' and v_section_slug <> 'ikinci-el' then
      select c.id, c.slug, c.name, c.parent_id
      into v_cat_id, v_cat_slug, v_cat_name, v_cat_parent
      from public.marketplace_categories c
      where c.is_active
        and c.id <> v_section_id
        and c.id = any (v_market_ids)
        and (c.slug = v_seg or c.slug = v_section_slug || '-' || v_seg)
      order by c.parent_id nulls first, c.sort_order, c.name
      limit 1;

      if v_cat_id is null then
        return jsonb_build_object('ok', false);
      end if;

      v_market_cat_ids := public.tz_market_descendants(v_cat_slug);
      v_has_category := true;
    elsif v_mode = 'real_estate' then
      select c.id, c.slug, c.name, c.parent_id, c.sort_order
      into v_cat_id, v_cat_slug, v_cat_name, v_cat_parent, v_cat_sort
      from public.real_estate_categories c
      where c.is_active and c.slug = v_seg
      limit 1;

      if v_cat_id is null then
        return jsonb_build_object('ok', false);
      end if;

      v_re_cat_ids := public.tz_realestate_descendants(v_cat_slug);
      v_has_category := true;
    elsif v_mode = 'places' then
      select c.id, c.slug, c.name, c.parent_id, c.sort_order
      into v_cat_id, v_cat_slug, v_cat_name, v_cat_parent, v_cat_sort
      from public.place_categories c
      where c.is_active
        and c.id = any (v_place_ids)
        and c.slug = v_seg
      order by c.parent_id nulls first
      limit 1;

      if v_cat_id is null then
        return jsonb_build_object('ok', false);
      end if;

      v_place_cat_ids := public.tz_place_descendants(v_cat_slug);
      v_has_category := true;
    else
      -- Sanal ikinci-el bölümünde alt kategori adresi açılmaz; tek sayfa yeterli.
      return jsonb_build_object('ok', false);
    end if;
  end if;

  -- 2.4 Hub adresi
  if v_has_district then
    v_hub_path := v_hub_path || '/' || v_district_slug;
  end if;
  if v_section_slug is not null then
    v_hub_path := v_hub_path || '/' || v_section_slug;
  end if;
  if v_has_category then
    if v_mode = 'market' then
      v_hub_path := v_hub_path || '/' || public.tz_hub_short_slug(v_section_slug, v_cat_slug);
    else
      v_hub_path := v_hub_path || '/' || v_cat_slug;
    end if;
  end if;

  -- 2.5 İlçe hub'ı / şehir hub'ı: bölümlere göre gerçek içerik sayısı
  if v_section_slug is null then
    v_mode := case when v_has_district then 'district' else 'city' end;

    select coalesce(jsonb_agg(jsonb_build_object(
      'slug', x.slug,
      'name', x.name,
      'kind', x.kind,
      'url', x.url,
      'count', x.n
    ) order by x.sort_order, x.name), '[]'::jsonb)
    into v_sections
    from (
      select
        c.slug,
        c.name,
        c.kind,
        c.sort_order,
        '/trabzon/'
          || case when v_has_district then v_district_slug || '/' else '' end
          || c.slug as url,
        case c.kind
          when 'real_estate' then (
            select count(*)
            from public.real_estate_listings l
            join public.profiles p on p.id = l.owner_id
            where l.status = 'published'
              and p.account_status = 'active'
              and (not v_has_district or l.district_id = v_district_id)
          )
          when 'place' then (
            select count(*)
            from public.places pl
            where pl.status = 'published'
              and pl.category_id = any (public.tz_place_section_ids(c.slug))
              and (not v_has_district or pl.district_id = v_district_id)
          )
          else (
            select count(*)
            from public.marketplace_listings l
            join public.profiles p on p.id = l.seller_id
            where l.status = 'active'
              and l.moderation_status = 'visible'
              and p.account_status = 'active'
              and (l.expires_at is null or l.expires_at > now())
              and l.category_id = any (public.tz_market_descendants(c.slug))
              and (not v_has_district or l.district_id = v_district_id)
          )
        end as n
      from public.marketplace_categories c
      where c.parent_id is null and c.is_active

      -- Sanal "İkinci El" bölümü: tüm ürün ilanlarını tek vitrinde toplar.
      union all
      select
        'ikinci-el'::text,
        'İkinci El'::text,
        'product'::text,
        -1,
        '/trabzon/'
          || case when v_has_district then v_district_slug || '/' else '' end
          || 'ikinci-el',
        (
          select count(*)
          from public.marketplace_listings l
          join public.profiles p on p.id = l.seller_id
          join public.marketplace_categories c2 on c2.id = l.category_id
          where l.status = 'active'
            and l.moderation_status = 'visible'
            and p.account_status = 'active'
            and (l.expires_at is null or l.expires_at > now())
            and c2.kind = 'product'
            and (not v_has_district or l.district_id = v_district_id)
        )
    ) x
    where x.n > 0;

    -- Şehir/ilçe toplamı: bölümler birbirini kapsayabildiği için (isletmeler /
    -- turizm, kategori kökleri / ikinci-el) aynı ilanı iki kez saymayız.
    select
      (
        select count(*)
        from public.marketplace_listings l
        join public.profiles p on p.id = l.seller_id
        where l.status = 'active'
          and l.moderation_status = 'visible'
          and p.account_status = 'active'
          and (l.expires_at is null or l.expires_at > now())
          and (not v_has_district or l.district_id = v_district_id)
      )
      + (
        select count(*)
        from public.real_estate_listings r
        join public.profiles p on p.id = r.owner_id
        where r.status = 'published'
          and p.account_status = 'active'
          and (not v_has_district or r.district_id = v_district_id)
      )
      + (
        select count(*)
        from public.places pl
        where pl.status = 'published'
          and (not v_has_district or pl.district_id = v_district_id)
      )
    into v_total;

    -- Şehir/ilçe sayfasında son eklenen ürün ilanları listelenir.
    select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb)
    into v_items
    from (
      select
        jsonb_build_object(
          'id', l.id,
          'title', l.title,
          'url', '/marketplace/' || l.id,
          'price_cents', l.price_cents,
          'currency', l.currency,
          'price_period', l.price_period,
          'condition', l.condition,
          'district', d.name,
          'category_name', c.name,
          'category_slug', c.slug,
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
          'published_at', coalesce(l.published_at, l.created_at)
        ) as item,
        coalesce(l.published_at, l.created_at) as sort_at
      from public.marketplace_listings l
      join public.profiles p on p.id = l.seller_id
      left join public.marketplace_categories c on c.id = l.category_id
      left join public.districts d on d.id = l.district_id
      where l.status = 'active'
        and l.moderation_status = 'visible'
        and p.account_status = 'active'
        and (l.expires_at is null or l.expires_at > now())
        and (not v_has_district or l.district_id = v_district_id)
      order by coalesce(l.published_at, l.created_at) desc
      limit v_limit
    ) x;

    select max(coalesce(l.updated_at, l.published_at, l.created_at))
    into v_updated
    from public.marketplace_listings l
    join public.profiles p on p.id = l.seller_id
    where l.status = 'active'
      and l.moderation_status = 'visible'
      and p.account_status = 'active'
      and (l.expires_at is null or l.expires_at > now())
      and (not v_has_district or l.district_id = v_district_id);

    if not v_has_district then
      select coalesce(jsonb_agg(jsonb_build_object(
        'slug', d.slug,
        'name', d.name,
        'url', '/trabzon/' || d.slug,
        'count', x.n
      ) order by x.n desc, d.name), '[]'::jsonb)
      into v_districts
      from public.districts d
      join public.cities c on c.id = d.city_id and c.is_active
      join lateral (
        select
          (select count(*) from public.marketplace_listings l
             join public.profiles p on p.id = l.seller_id
            where l.status = 'active' and l.moderation_status = 'visible'
              and p.account_status = 'active'
              and (l.expires_at is null or l.expires_at > now())
              and l.district_id = d.id)
          + (select count(*) from public.real_estate_listings r
             join public.profiles p on p.id = r.owner_id
             where r.status = 'published' and p.account_status = 'active'
               and r.district_id = d.id)
          + (select count(*) from public.places pl
             where pl.status = 'published' and pl.district_id = d.id) as n
      ) x on true
      where x.n > 0;
    end if;

    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'path', v_hub_path,
      'total', v_total,
      'items', v_items,
      'sections', v_sections,
      'categories', v_categories,
      'districts', v_districts,
      'section', null,
      'category', null,
      'district', case when v_has_district then jsonb_build_object(
        'id', v_district_id, 'slug', v_district_slug, 'name', v_district_name
      ) end,
      'updated_at', v_updated
    );
  end if;

  -- 2.6 Bölüm / kategori sayfası
  if v_mode = 'market' then
    select count(*), max(coalesce(l.updated_at, l.published_at, l.created_at))
    into v_total, v_updated
    from public.marketplace_listings l
    join public.profiles p on p.id = l.seller_id
    where l.status = 'active'
      and l.moderation_status = 'visible'
      and p.account_status = 'active'
      and (l.expires_at is null or l.expires_at > now())
      and (v_market_ids is null or l.category_id = any (v_market_ids))
      and (not v_has_category or l.category_id = any (v_market_cat_ids))
      and (not v_has_district or l.district_id = v_district_id);

    select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb)
    into v_items
    from (
      select
        jsonb_build_object(
          'id', l.id,
          'title', l.title,
          'url', '/marketplace/' || l.id,
          'price_cents', l.price_cents,
          'currency', l.currency,
          'price_period', l.price_period,
          'condition', l.condition,
          'district', d.name,
          'category_name', c.name,
          'category_slug', c.slug,
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
          'published_at', coalesce(l.published_at, l.created_at)
        ) as item,
        coalesce(l.published_at, l.created_at) as sort_at
      from public.marketplace_listings l
      join public.profiles p on p.id = l.seller_id
      left join public.marketplace_categories c on c.id = l.category_id
      left join public.districts d on d.id = l.district_id
      where l.status = 'active'
        and l.moderation_status = 'visible'
        and p.account_status = 'active'
        and (l.expires_at is null or l.expires_at > now())
        and (v_market_ids is null or l.category_id = any (v_market_ids))
        and (not v_has_category or l.category_id = any (v_market_cat_ids))
        and (not v_has_district or l.district_id = v_district_id)
      order by coalesce(l.published_at, l.created_at) desc
      limit v_limit
    ) x;

    -- İlgili kategoriler: kök bölümde alt gruplar, kategoride kardeş/alt dallar.
    if v_has_category then
      v_link_parent := coalesce(v_cat_parent, v_section_id);
    else
      v_link_parent := v_section_id;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'slug', x.slug,
      'name', x.name,
      'url', x.url,
      'count', x.n
    ) order by x.sort_order, x.name), '[]'::jsonb)
    into v_categories
    from (
      select
        c.slug,
        c.name,
        c.sort_order,
        '/trabzon/'
          || case when v_has_district then v_district_slug || '/' else '' end
          || case
               when v_section_slug = 'ikinci-el' then c.slug
               else v_section_slug
                 || case
                      when c.slug = v_section_slug then ''
                      else '/' || public.tz_hub_short_slug(v_section_slug, c.slug)
                    end
             end as url,
        (
          select count(*)
          from public.marketplace_listings l
          join public.profiles p on p.id = l.seller_id
          where l.status = 'active'
            and l.moderation_status = 'visible'
            and p.account_status = 'active'
            and (l.expires_at is null or l.expires_at > now())
            and l.category_id = any (public.tz_market_descendants(c.slug))
            and (not v_has_district or l.district_id = v_district_id)
        ) as n
      from public.marketplace_categories c
      where c.is_active
        and (
          (v_section_slug = 'ikinci-el' and c.parent_id is null and c.kind = 'product')
          or (v_section_slug <> 'ikinci-el' and c.parent_id = v_link_parent)
        )
    ) x
    where x.n > 0;

  elsif v_mode = 'real_estate' then
    select count(*), max(coalesce(l.updated_at, l.published_at))
    into v_total, v_updated
    from public.real_estate_listings l
    join public.profiles p on p.id = l.owner_id
    where l.status = 'published'
      and p.account_status = 'active'
      and (not v_has_category or l.category_id = any (v_re_cat_ids))
      and (not v_has_district or l.district_id = v_district_id);

    select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb)
    into v_items
    from (
      select
        jsonb_build_object(
          'id', l.id,
          'title', l.title,
          'url', '/marketplace/real-estate/' || l.id,
          'price_cents', l.price_cents,
          'currency', l.currency,
          'price_period', l.price_period,
          'listing_kind', l.listing_kind,
          'room_count', l.room_count,
          'gross_m2', l.gross_m2,
          'district', d.name,
          'category_name', c.name,
          'category_slug', c.slug,
          'cover_path', (
            select m.storage_path
            from public.real_estate_media m
            where m.listing_id = l.id and m.kind = 'image' and m.status = 'approved'
            order by m.cover desc, m.sort_order, m.created_at
            limit 1
          ),
          'image_count', (
            select count(*)
            from public.real_estate_media m
            where m.listing_id = l.id and m.kind = 'image' and m.status = 'approved'
          ),
          'published_at', l.published_at
        ) as item,
        coalesce(l.published_at, l.updated_at) as sort_at
      from public.real_estate_listings l
      join public.profiles p on p.id = l.owner_id
      left join public.real_estate_categories c on c.id = l.category_id
      left join public.districts d on d.id = l.district_id
      where l.status = 'published'
        and p.account_status = 'active'
        and (not v_has_category or l.category_id = any (v_re_cat_ids))
        and (not v_has_district or l.district_id = v_district_id)
      order by coalesce(l.published_at, l.updated_at) desc
      limit v_limit
    ) x;

    v_link_parent := case
      when v_has_category then coalesce(v_cat_parent, v_cat_id)
      else null
    end;

    select coalesce(jsonb_agg(jsonb_build_object(
      'slug', x.slug,
      'name', x.name,
      'url', x.url,
      'count', x.n
    ) order by x.sort_order, x.name), '[]'::jsonb)
    into v_categories
    from (
      select
        c.slug,
        c.name,
        c.sort_order,
        '/trabzon/'
          || case when v_has_district then v_district_slug || '/' else '' end
          || 'emlak/' || c.slug as url,
        (
          select count(*)
          from public.real_estate_listings l
          join public.profiles p on p.id = l.owner_id
          where l.status = 'published'
            and p.account_status = 'active'
            and l.category_id = any (public.tz_realestate_descendants(c.slug))
            and (not v_has_district or l.district_id = v_district_id)
        ) as n
      from public.real_estate_categories c
      where c.is_active
        and (
          (v_link_parent is not null and c.parent_id = v_link_parent)
          or (v_link_parent is null and c.parent_id is null)
        )
    ) x
    where x.n > 0;

  else
    -- places
    select count(*), max(coalesce(l.updated_at, l.created_at))
    into v_total, v_updated
    from public.places l
    where l.status = 'published'
      and (v_place_ids is null or l.category_id = any (v_place_ids))
      and (not v_has_category or l.category_id = any (v_place_cat_ids))
      and (not v_has_district or l.district_id = v_district_id);

    select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb)
    into v_items
    from (
      select
        jsonb_build_object(
          'id', l.id,
          'title', l.name,
          'url', '/marketplace/place/' || l.id,
          'rating', l.rating_avg,
          'review_count', l.review_count,
          'district', d.name,
          'neighborhood', n.name,
          'category_name', c.name,
          'category_slug', c.slug,
          'cover_path', l.cover_path,
          'is_verified', l.is_verified,
          'published_at', l.created_at
        ) as item,
        coalesce(l.updated_at, l.created_at) as sort_at
      from public.places l
      left join public.place_categories c on c.id = l.category_id
      left join public.districts d on d.id = l.district_id
      left join public.neighborhoods n on n.id = l.neighborhood_id
      where l.status = 'published'
        and (v_place_ids is null or l.category_id = any (v_place_ids))
        and (not v_has_category or l.category_id = any (v_place_cat_ids))
        and (not v_has_district or l.district_id = v_district_id)
      order by coalesce(l.updated_at, l.created_at) desc
      limit v_limit
    ) x;

    v_link_parent := case
      when v_has_category then coalesce(v_cat_parent, v_cat_id)
      else null
    end;
    if v_link_parent is not null
       and v_place_ids is not null
       and not (v_link_parent = any (v_place_ids)) then
      v_link_parent := null;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'slug', x.slug,
      'name', x.name,
      'url', x.url,
      'count', x.n
    ) order by x.sort_order, x.name), '[]'::jsonb)
    into v_categories
    from (
      select
        c.slug,
        c.name,
        c.sort_order,
        '/trabzon/'
          || case when v_has_district then v_district_slug || '/' else '' end
          || v_section_slug || '/' || c.slug as url,
        (
          select count(*)
          from public.places l
          where l.status = 'published'
            and l.category_id = any (public.tz_place_descendants(c.slug))
            and (v_place_ids is null or l.category_id = any (v_place_ids))
            and (not v_has_district or l.district_id = v_district_id)
        ) as n
      from public.place_categories c
      where c.is_active
        and (v_place_ids is null or c.id = any (v_place_ids))
        and (
          (v_link_parent is not null and c.parent_id = v_link_parent)
          or (
            v_link_parent is null
            and (c.parent_id is null or not (c.parent_id = any (v_place_ids)))
          )
        )
    ) x
    where x.n > 0;
  end if;

  -- İlgili ilçeler: mevcut bölüm/kategoriye göre gerçek içerik sayısı.
  if v_mode = 'market' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'slug', d.slug,
      'name', d.name,
      'url', '/trabzon/' || d.slug || '/' || v_section_slug
        || case
             when not v_has_category then ''
             when v_section_slug = 'ikinci-el' then ''
             else '/' || public.tz_hub_short_slug(v_section_slug, v_cat_slug)
           end,
      'count', x.n
    ) order by x.n desc, d.name), '[]'::jsonb)
    into v_districts
    from public.districts d
    join public.cities c on c.id = d.city_id and c.is_active
    join lateral (
      select count(*) as n
      from public.marketplace_listings l
      join public.profiles p on p.id = l.seller_id
      where l.status = 'active'
        and l.moderation_status = 'visible'
        and p.account_status = 'active'
        and (l.expires_at is null or l.expires_at > now())
        and l.district_id = d.id
        and (v_market_ids is null or l.category_id = any (v_market_ids))
        and (not v_has_category or l.category_id = any (v_market_cat_ids))
    ) x on true
    where x.n > 0
      and (not v_has_district or d.id <> v_district_id);
  elsif v_mode = 'real_estate' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'slug', d.slug,
      'name', d.name,
      'url', '/trabzon/' || d.slug || '/emlak'
        || case when v_has_category then '/' || v_cat_slug else '' end,
      'count', x.n
    ) order by x.n desc, d.name), '[]'::jsonb)
    into v_districts
    from public.districts d
    join public.cities c on c.id = d.city_id and c.is_active
    join lateral (
      select count(*) as n
      from public.real_estate_listings l
      join public.profiles p on p.id = l.owner_id
      where l.status = 'published'
        and p.account_status = 'active'
        and l.district_id = d.id
        and (not v_has_category or l.category_id = any (v_re_cat_ids))
    ) x on true
    where x.n > 0
      and (not v_has_district or d.id <> v_district_id);
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'slug', d.slug,
      'name', d.name,
      'url', '/trabzon/' || d.slug || '/' || v_section_slug
        || case when v_has_category then '/' || v_cat_slug else '' end,
      'count', x.n
    ) order by x.n desc, d.name), '[]'::jsonb)
    into v_districts
    from public.districts d
    join public.cities c on c.id = d.city_id and c.is_active
    join lateral (
      select count(*) as n
      from public.places l
      where l.status = 'published'
        and l.district_id = d.id
        and (v_place_ids is null or l.category_id = any (v_place_ids))
        and (not v_has_category or l.category_id = any (v_place_cat_ids))
    ) x on true
    where x.n > 0
      and (not v_has_district or d.id <> v_district_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'path', v_hub_path,
    'total', v_total,
    'items', v_items,
    'sections', v_sections,
    'categories', v_categories,
    'districts', v_districts,
    'section', jsonb_build_object(
      'slug', v_section_slug,
      'name', v_section_name,
      'kind', v_section_kind,
      'description', v_section_description
    ),
    'category', case when v_has_category then jsonb_build_object(
      'slug', v_cat_slug,
      'name', v_cat_name
    ) end,
    'district', case when v_has_district then jsonb_build_object(
      'id', v_district_id, 'slug', v_district_slug, 'name', v_district_name
    ) end,
    'updated_at', v_updated
  );
end;
$$;

revoke all on function public.seo_hub_page(text[], integer) from public, anon, authenticated;
grant execute on function public.seo_hub_page(text[], integer) to anon, authenticated, service_role;

comment on function public.seo_hub_page(text[], integer) is
  'SEO hub sayfası: /trabzon[/ilce][/bolum][/kategori] için yayındaki gerçek içerik, ilgili kategori/ilçe bağlantıları. Boş/geçersiz yol ok=false döner.';

-- ---------------------------------------------------------------------------
-- 3. Sitemap: yalnızca gerçek içerik bulunan hub adresleri
-- ---------------------------------------------------------------------------
create or replace function public.seo_hub_urls(
  p_limit integer default 20000,
  p_offset integer default 0
)
returns table (path text, mode text, item_count bigint, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with recursive
  -- Her kategori için kendisi + tüm üst kategorileri (root dahil)
  market_chain as (
    select c.id as leaf_id, c.id as anc_id, c.slug as anc_slug, c.parent_id as anc_parent_id,
           1 as depth
    from public.marketplace_categories c
    where c.is_active
    union all
    select cc.leaf_id, p.id, p.slug, p.parent_id, cc.depth + 1
    from market_chain cc
    join public.marketplace_categories p on p.id = cc.anc_parent_id
  ),
  market_root as (
    select distinct on (leaf_id) leaf_id, anc_slug as root_slug
    from market_chain
    order by leaf_id, depth desc
  ),
  market_counts as (
    select l.category_id, l.district_id,
           count(*)::bigint as n,
           max(coalesce(l.updated_at, l.published_at, l.created_at)) as up
    from public.marketplace_listings l
    join public.profiles p on p.id = l.seller_id
    where l.status = 'active'
      and l.moderation_status = 'visible'
      and p.account_status = 'active'
      and (l.expires_at is null or l.expires_at > now())
    group by 1, 2
  ),
  market_urls as (
    select
      '/trabzon/' || d.slug || '/'
        || r.root_slug
        || case
             when cc.anc_slug = r.root_slug then ''
             else '/' || public.tz_hub_short_slug(r.root_slug, cc.anc_slug)
           end as path,
      'market'::text as mode,
      sum(m.n)::bigint as item_count,
      max(m.up) as updated_at
    from market_counts m
    join market_chain cc on cc.leaf_id = m.category_id
    join market_root r on r.leaf_id = m.category_id
    join public.districts d on d.id = m.district_id
    group by 1, 2
    union all
    select
      '/trabzon/'
        || r.root_slug
        || case
             when cc.anc_slug = r.root_slug then ''
             else '/' || public.tz_hub_short_slug(r.root_slug, cc.anc_slug)
           end as path,
      'market'::text as mode,
      sum(m.n)::bigint as item_count,
      max(m.up) as updated_at
    from market_counts m
    join market_chain cc on cc.leaf_id = m.category_id
    join market_root r on r.leaf_id = m.category_id
    group by 1, 2
  ),
  -- Sanal ikinci-el bölümü: tüm ürün ilanları
  second_hand as (
    select
      '/trabzon/' || d.slug || '/ikinci-el' as path,
      'market'::text as mode,
      sum(m.n)::bigint as item_count,
      max(m.up) as updated_at
    from market_counts m
    join public.marketplace_categories c on c.id = m.category_id and c.kind = 'product'
    join public.districts d on d.id = m.district_id
    group by 1, 2
    union all
    select
      '/trabzon/ikinci-el' as path,
      'market'::text as mode,
      sum(m.n)::bigint as item_count,
      max(m.up) as updated_at
    from market_counts m
    join public.marketplace_categories c on c.id = m.category_id and c.kind = 'product'
    group by 1, 2
  ),
  realestate_chain as (
    select c.id as leaf_id, c.id as anc_id, c.slug as anc_slug, c.parent_id as anc_parent_id
    from public.real_estate_categories c
    where c.is_active
    union all
    select rc.leaf_id, p.id, p.slug, p.parent_id
    from realestate_chain rc
    join public.real_estate_categories p on p.id = rc.anc_parent_id
  ),
  realestate_counts as (
    select l.category_id, l.district_id,
           count(*)::bigint as n,
           max(coalesce(l.updated_at, l.published_at)) as up
    from public.real_estate_listings l
    join public.profiles p on p.id = l.owner_id
    where l.status = 'published' and p.account_status = 'active'
    group by 1, 2
  ),
  realestate_urls as (
    select
      '/trabzon/' || d.slug || '/emlak/' || rc.anc_slug as path,
      'real_estate'::text as mode,
      sum(r.n)::bigint as item_count,
      max(r.up) as updated_at
    from realestate_counts r
    join realestate_chain rc on rc.leaf_id = r.category_id
    join public.districts d on d.id = r.district_id
    group by 1, 2
    union all
    select
      '/trabzon/emlak/' || rc.anc_slug as path,
      'real_estate'::text as mode,
      sum(r.n)::bigint as item_count,
      max(r.up) as updated_at
    from realestate_counts r
    join realestate_chain rc on rc.leaf_id = r.category_id
    group by 1, 2
  ),
  realestate_section as (
    select
      '/trabzon/' || d.slug || '/emlak' as path,
      'real_estate'::text as mode,
      sum(r.n)::bigint as item_count,
      max(r.up) as updated_at
    from realestate_counts r
    join public.districts d on d.id = r.district_id
    group by 1, 2
    union all
    select
      '/trabzon/emlak' as path,
      'real_estate'::text as mode,
      sum(r.n)::bigint as item_count,
      max(r.up) as updated_at
    from realestate_counts r
    group by 1, 2
  ),
  place_chain as (
    select c.id as leaf_id, c.id as anc_id, c.slug as anc_slug, c.parent_id as anc_parent_id
    from public.place_categories c
    where c.is_active
    union all
    select pc.leaf_id, p.id, p.slug, p.parent_id
    from place_chain pc
    join public.place_categories p on p.id = pc.anc_parent_id
  ),
  place_counts as (
    select l.category_id, l.district_id,
           count(*)::bigint as n,
           max(coalesce(l.updated_at, l.created_at)) as up
    from public.places l
    where l.status = 'published'
    group by 1, 2
  ),
  place_section_map as (
    select 'isletmeler'::text as section_slug
    union all
    select 'turizm-konaklama'::text
  ),
  place_urls as (
    select
      '/trabzon/' || d.slug || '/' || s.section_slug || '/' || pc.anc_slug as path,
      'places'::text as mode,
      sum(p.n)::bigint as item_count,
      max(p.up) as updated_at
    from place_counts p
    join place_chain pc on pc.leaf_id = p.category_id
    cross join place_section_map s
    join public.districts d on d.id = p.district_id
    where pc.anc_id = any (public.tz_place_section_ids(s.section_slug))
      and p.category_id = any (public.tz_place_section_ids(s.section_slug))
    group by 1, 2
    union all
    select
      '/trabzon/' || s.section_slug || '/' || pc.anc_slug as path,
      'places'::text as mode,
      sum(p.n)::bigint as item_count,
      max(p.up) as updated_at
    from place_counts p
    join place_chain pc on pc.leaf_id = p.category_id
    cross join place_section_map s
    where pc.anc_id = any (public.tz_place_section_ids(s.section_slug))
      and p.category_id = any (public.tz_place_section_ids(s.section_slug))
    group by 1, 2
  ),
  turizm_section as (
    select
      '/trabzon/' || d.slug || '/turizm-konaklama' as path,
      'places'::text as mode,
      sum(p.n)::bigint as item_count,
      max(p.up) as updated_at
    from place_counts p
    join public.districts d on d.id = p.district_id
    where p.category_id = any (public.tz_place_section_ids('turizm-konaklama'))
    group by 1, 2
    union all
    select
      '/trabzon/turizm-konaklama' as path,
      'places'::text as mode,
      sum(p.n)::bigint as item_count,
      max(p.up) as updated_at
    from place_counts p
    where p.category_id = any (public.tz_place_section_ids('turizm-konaklama'))
    group by 1, 2
  ),
  isletmeler_section as (
    select
      '/trabzon/' || d.slug || '/isletmeler' as path,
      'places'::text as mode,
      sum(p.n)::bigint as item_count,
      max(p.up) as updated_at
    from place_counts p
    join public.districts d on d.id = p.district_id
    where p.category_id = any (public.tz_place_section_ids('isletmeler'))
    group by 1, 2
    union all
    select
      '/trabzon/isletmeler' as path,
      'places'::text as mode,
      sum(p.n)::bigint as item_count,
      max(p.up) as updated_at
    from place_counts p
    where p.category_id = any (public.tz_place_section_ids('isletmeler'))
    group by 1, 2
  ),
  combined as (
    select * from market_urls
    union all select * from second_hand
    union all select * from realestate_urls
    union all select * from realestate_section
    union all select * from place_urls
    union all select * from turizm_section
    union all select * from isletmeler_section
  ),
  merged as (
    select c.path, min(c.mode) as mode, sum(c.item_count)::bigint as item_count,
           max(c.updated_at) as updated_at
    from combined c
    group by c.path
  )
  select
    '/trabzon'::text as path,
    'city'::text as mode,
    c.n,
    c.up as updated_at
  from (
    select
      (
        select count(*)
        from public.marketplace_listings l
        join public.profiles p on p.id = l.seller_id
        where l.status = 'active'
          and l.moderation_status = 'visible'
          and p.account_status = 'active'
          and (l.expires_at is null or l.expires_at > now())
      )
      + (
        select count(*)
        from public.real_estate_listings r
        join public.profiles p on p.id = r.owner_id
        where r.status = 'published' and p.account_status = 'active'
      )
      + (
        select count(*)
        from public.places pl
        where pl.status = 'published'
      ) as n,
      greatest(
        (
          select max(coalesce(l.updated_at, l.published_at, l.created_at))
          from public.marketplace_listings l
          join public.profiles p on p.id = l.seller_id
          where l.status = 'active'
            and l.moderation_status = 'visible'
            and p.account_status = 'active'
            and (l.expires_at is null or l.expires_at > now())
        ),
        (
          select max(coalesce(r.updated_at, r.published_at))
          from public.real_estate_listings r
          join public.profiles p on p.id = r.owner_id
          where r.status = 'published' and p.account_status = 'active'
        ),
        (
          select max(coalesce(pl.updated_at, pl.created_at))
          from public.places pl
          where pl.status = 'published'
        )
      ) as up
  ) c
  where c.n > 0
  union all
  select m.path, m.mode, m.item_count, m.updated_at
  from merged m
  where m.item_count > 0
  order by 3 desc, 1
  limit least(greatest(coalesce(p_limit, 20000), 1), 40000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.seo_hub_urls(integer, integer) from public, anon, authenticated;
grant execute on function public.seo_hub_urls(integer, integer) to anon, authenticated, service_role;

comment on function public.seo_hub_urls(integer, integer) is
  'Sitemap: yayındaki gerçek ilana sahip SEO hub adresleri (ilçe, bölüm, kategori). Boş kombinasyonlar listelenmez.';
