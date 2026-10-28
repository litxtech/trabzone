-- =====================================================================
-- 0052 — Marketplace admin v2: kategori yönetimi, ilan moderasyonu,
-- analitik ve medya denetimi.
--
-- Kritik güvenlik notu: Emlak ve taşıt ilanları EİDS doğrulaması olmadan
-- yayına alınamaz. Yönetici de doğrulama durumunu elle "verified" yapamaz;
-- doğrulama yalnızca yetkili entegrasyon tarafından yazılır. Bu migration
-- yöneticiye yalnızca reddetme/kaldırma/inceleme yetkisi verir.
-- =====================================================================

set search_path = public, extensions;

-- Reddedilen ilan durumu (moderasyon sonucu).
alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_status_check;
alter table public.marketplace_listings
  add constraint marketplace_listings_status_check check (
    status in ('draft', 'pending', 'active', 'reserved', 'sold', 'expired', 'rejected', 'archived', 'removed')
  );

-- ---------------------------------------------------------------------
-- 1. Admin kategori listesi (v2)
-- ---------------------------------------------------------------------
create or replace function public.market_admin_category_json_v2(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id,
    'parent_id', c.parent_id,
    'slug', c.slug,
    'name', c.name,
    'icon', c.icon,
    'kind', c.kind,
    'tone', c.tone,
    'description', c.description,
    'aliases', c.aliases,
    'form_schema', c.form_schema,
    'is_featured', c.is_featured,
    'sort_order', c.sort_order,
    'is_active', c.is_active,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'depth', (
      with recursive up as (
        select c2.id, c2.parent_id, 1 as depth
        from public.marketplace_categories c2 where c2.id = c.id
        union all
        select p.id, p.parent_id, up.depth + 1
        from public.marketplace_categories p
        join up on p.id = up.parent_id
      )
      select max(depth) from up
    ),
    'path_names', (
      with recursive up as (
        select c2.id, c2.parent_id, c2.name, 1 as depth
        from public.marketplace_categories c2 where c2.id = c.id
        union all
        select p.id, p.parent_id, p.name, up.depth + 1
        from public.marketplace_categories p
        join up on p.id = up.parent_id
      )
      select string_agg(name, ' > ' order by depth desc) from up
    ),
    'listing_count', (
      select count(*) from public.marketplace_listings l where l.category_id = c.id
    ),
    'child_count', (
      select count(*) from public.marketplace_categories ch where ch.parent_id = c.id
    )
  )
  from public.marketplace_categories c
  where c.id = p_id;
$$;

revoke all on function public.market_admin_category_json_v2(uuid) from public, anon, authenticated;

create or replace function public.market_admin_categories_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(public.market_admin_category_json_v2(c.id)
             order by coalesce((
               with recursive up as (
                 select c2.id, c2.parent_id, c2.sort_order, 1 as depth
                 from public.marketplace_categories c2 where c2.id = c.id
                 union all
                 select p.id, p.parent_id, p.sort_order, up.depth + 1
                 from public.marketplace_categories p
                 join up on p.id = up.parent_id
               )
               select sum(sort_order * power(10, greatest(4 - depth, 0))) from up
             ), 0), c.name)
      from public.marketplace_categories c
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.market_admin_categories_v2() from public, anon;
grant execute on function public.market_admin_categories_v2() to authenticated, service_role;

create or replace function public.market_admin_category_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_parent uuid := nullif(p_payload ->> 'parent_id', '')::uuid;
  v_name text := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
  v_slug text;
  v_icon text := coalesce(nullif(trim(p_payload ->> 'icon'), ''), 'grid-outline');
  v_kind text := coalesce(nullif(trim(p_payload ->> 'kind'), ''), 'product');
  v_tone text := coalesce(nullif(trim(p_payload ->> 'tone'), ''), 'primary');
  v_desc text := nullif(trim(coalesce(p_payload ->> 'description', '')), '');
  v_aliases text[] := '{}'::text[];
  v_form jsonb := coalesce(p_payload -> 'form_schema', '{}'::jsonb);
  v_featured boolean := coalesce((p_payload ->> 'is_featured')::boolean, false);
  v_sort integer := coalesce((p_payload ->> 'sort_order')::integer, 0);
  v_active boolean := coalesce((p_payload ->> 'is_active')::boolean, true);
  v_parent_depth integer := 0;
  v_existing public.marketplace_categories%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  if v_kind not in ('product', 'real_estate', 'vehicle', 'place', 'service', 'job', 'education', 'event') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  if v_tone not in ('primary', 'accent', 'success', 'warning', 'danger', 'info') then
    raise exception 'invalid_tone' using errcode = '22023';
  end if;

  if jsonb_typeof(v_form) <> 'object' or char_length(v_form::text) > 12000 then
    raise exception 'invalid_form_schema' using errcode = '22023';
  end if;

  if p_payload ? 'aliases' then
    if jsonb_typeof(p_payload -> 'aliases') = 'array' then
      select coalesce(array_agg(left(value, 40)), '{}'::text[])
      into v_aliases
      from jsonb_array_elements_text(p_payload -> 'aliases') value;
    elsif jsonb_typeof(p_payload -> 'aliases') = 'string' then
      select coalesce(array_agg(left(trim(value), 40)), '{}'::text[])
      into v_aliases
      from regexp_split_to_table(p_payload ->> 'aliases', ',') value
      where trim(value) <> '';
    end if;
  elsif v_id is not null then
    select aliases into v_aliases from public.marketplace_categories where id = v_id;
  end if;

  v_slug := lower(coalesce(nullif(trim(p_payload ->> 'slug'), ''), public.tz_market_slug(v_name)));
  v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '-', 'g');
  v_slug := regexp_replace(v_slug, '-{2,}', '-', 'g');
  v_slug := trim(both '-' from v_slug);

  if v_slug !~ '^[a-z0-9-]{2,80}$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  if v_parent is not null then
    if v_parent = v_id then
      raise exception 'invalid_parent' using errcode = '22023';
    end if;

    if not exists (select 1 from public.marketplace_categories where id = v_parent) then
      raise exception 'category_not_found' using errcode = '22023';
    end if;

    with recursive up as (
      select c.id, c.parent_id, 1 as depth
      from public.marketplace_categories c where c.id = v_parent
      union all
      select p.id, p.parent_id, up.depth + 1
      from public.marketplace_categories p
      join up on p.id = up.parent_id
    )
    select max(depth) into v_parent_depth from up;

    if coalesce(v_parent_depth, 0) >= 3 then
      raise exception 'max_depth_exceeded' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from public.marketplace_categories c
    where c.slug = v_slug and (v_id is null or c.id <> v_id)
  ) then
    raise exception 'duplicate_slug' using errcode = '23505';
  end if;

  if v_id is null then
    insert into public.marketplace_categories (
      parent_id, slug, name, icon, kind, tone, description, aliases, form_schema,
      is_featured, sort_order, is_active
    )
    values (
      v_parent, v_slug, v_name, v_icon, v_kind, v_tone, v_desc, coalesce(v_aliases, '{}'),
      v_featured, v_sort, v_active
    )
    returning id into v_id;
  else
    select * into v_existing from public.marketplace_categories where id = v_id;
    if not found then
      raise exception 'category_not_found' using errcode = '22023';
    end if;

    update public.marketplace_categories c
       set parent_id = v_parent,
           slug = v_slug,
           name = v_name,
           icon = v_icon,
           kind = v_kind,
           tone = v_tone,
           description = v_desc,
           aliases = coalesce(v_aliases, c.aliases),
           form_schema = v_form,
           is_featured = v_featured,
           sort_order = v_sort,
           is_active = v_active,
           updated_at = now()
     where c.id = v_id;
  end if;

  perform public.market_admin_audit(
    'market.category_save',
    'Marketplace kategorisi kaydedildi',
    'market_category',
    v_id::text,
    jsonb_build_object('slug', v_slug, 'parent_id', v_parent)
  );

  return public.market_admin_category_json_v2(v_id);
end;
$$;

revoke all on function public.market_admin_category_save(jsonb) from public, anon;
grant execute on function public.market_admin_category_save(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Admin genel bakış ve analitik
-- ---------------------------------------------------------------------
create or replace function public.market_admin_overview_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_counts jsonb;
  v_pending jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where status = 'active' and moderation_status = 'visible'),
    'pending', count(*) filter (where status = 'pending'),
    'draft', count(*) filter (where status = 'draft'),
    'rejected', count(*) filter (where status = 'rejected'),
    'removed', count(*) filter (where status = 'removed'),
    'today', count(*) filter (where created_at >= date_trunc('day', now())),
    'week', count(*) filter (where created_at >= now() - interval '7 days'),
    'month', count(*) filter (where created_at >= now() - interval '30 days'),
    'products', count(*) filter (where category_id in (
      select id from public.marketplace_categories where kind = 'product'
    )),
    'vehicles', count(*) filter (where category_id in (
      select id from public.marketplace_categories where kind = 'vehicle'
    )),
    'real_estate_market', count(*) filter (where category_id in (
      select id from public.marketplace_categories where kind in ('real_estate')
    )),
    'services', count(*) filter (where category_id in (
      select id from public.marketplace_categories where kind = 'service'
    )),
    'views', coalesce(sum(view_count), 0),
    'favorites', coalesce(sum(favorite_count), 0),
    'places', (select count(*) from public.places),
    'published_places', (select count(*) from public.places where status = 'published'),
    'real_estate_listings', (select count(*) from public.real_estate_listings),
    'published_real_estate', (select count(*) from public.real_estate_listings where status = 'published'),
    'reports', (
      select count(*) from public.user_reports
      where target_type in ('listing', 'place') and status = 'open'
    )
  )
  into v_counts
  from public.marketplace_listings;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'title', x.title,
    'status', x.status,
    'kind', x.kind,
    'price_cents', x.price_cents,
    'currency', x.currency,
    'created_at', x.created_at,
    'seller_username', x.seller_username,
    'cover_path', x.cover_path
  ) order by x.created_at desc), '[]'::jsonb)
  into v_pending
  from (
    select l.id, l.title, l.status, c.kind, l.price_cents, l.currency, l.created_at,
           p.username as seller_username,
           (select i.storage_path from public.marketplace_listing_images i
            where i.listing_id = l.id
            order by i.is_cover desc, i.sort_order limit 1) as cover_path
    from public.marketplace_listings l
    join public.profiles p on p.id = l.seller_id
    left join public.marketplace_categories c on c.id = l.category_id
    where l.status in ('pending', 'draft')
    order by l.created_at asc
    limit 10
  ) x;

  return jsonb_build_object('counts', v_counts, 'pending_items', v_pending);
end;
$$;

revoke all on function public.market_admin_overview_v2() from public, anon;
grant execute on function public.market_admin_overview_v2() to authenticated, service_role;

create or replace function public.market_admin_analytics(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 14), 7), 90);
  v_daily jsonb;
  v_kinds jsonb;
  v_districts jsonb;
  v_top_viewed jsonb;
  v_top_favorited jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'day', to_char(d.day, 'YYYY-MM-DD'),
    'created', coalesce(c.total, 0),
    'published', coalesce(p.total, 0),
    'favorites', coalesce(f.total, 0)
  ) order by d.day), '[]'::jsonb)
  into v_daily
  from generate_series(
    date_trunc('day', now()) - ((v_days - 1) * interval '1 day'),
    date_trunc('day', now()),
    interval '1 day'
  ) d(day)
  left join (
    select date_trunc('day', created_at) as day, count(*) total
    from public.marketplace_listings
    group by 1
  ) c on c.day = d.day
  left join (
    select date_trunc('day', coalesce(published_at, created_at)) as day, count(*) total
    from public.marketplace_listings
    where status = 'active'
    group by 1
  ) p on p.day = d.day
  left join (
    select date_trunc('day', f.created_at) as day, count(*) total
    from public.marketplace_favorites f
    group by 1
  ) f on f.day = d.day;

  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', kind,
    'label', case kind
      when 'product' then 'Ürün'
      when 'vehicle' then 'Araç'
      when 'real_estate' then 'Emlak'
      when 'place' then 'İşletme'
      when 'service' then 'Hizmet'
      when 'job' then 'İş ilanı'
      when 'education' then 'Eğitim'
      when 'event' then 'Etkinlik'
      else 'Diğer' end,
    'total', total
  ) order by total desc), '[]'::jsonb)
  into v_kinds
  from (
    select c.kind, count(*) total
    from public.marketplace_listings l
    join public.marketplace_categories c on c.id = l.category_id
    group by c.kind
  ) k;

  select coalesce(jsonb_agg(jsonb_build_object(
    'district', district,
    'total', total
  ) order by total desc), '[]'::jsonb)
  into v_districts
  from (
    select coalesce(d.name, l.district, 'Belirtilmemiş') as district, count(*) total
    from public.marketplace_listings l
    left join public.districts d on d.id = l.district_id
    group by 1
    order by total desc
    limit 10
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'title', l.title, 'views', l.view_count, 'favorites', l.favorite_count
  ) order by l.view_count desc), '[]'::jsonb)
  into v_top_viewed
  from public.marketplace_listings l
  where l.status = 'active'
  limit 8;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'title', l.title, 'views', l.view_count, 'favorites', l.favorite_count
  ) order by l.favorite_count desc), '[]'::jsonb)
  into v_top_favorited
  from public.marketplace_listings l
  where l.status = 'active'
  limit 8;

  return jsonb_build_object(
    'daily', v_daily,
    'kinds', v_kinds,
    'districts', v_districts,
    'top_viewed', v_top_viewed,
    'top_favorited', v_top_favorited
  );
end;
$$;

revoke all on function public.market_admin_analytics(integer) from public, anon;
grant execute on function public.market_admin_analytics(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Admin ilan listesi / detayı / moderasyon
-- ---------------------------------------------------------------------
create or replace function public.market_admin_listings_v2(
  p_query text default null,
  p_status text default null,
  p_kind text default null,
  p_category text default null,
  p_district_id bigint default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_kind text := nullif(trim(coalesce(p_kind, '')), '');
  v_category text := nullif(trim(coalesce(p_category, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total bigint;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select count(*)
  into v_total
  from public.marketplace_listings l
  join public.profiles p on p.id = l.seller_id
  left join public.marketplace_categories c on c.id = l.category_id
  where (v_status is null or l.status = v_status)
    and (v_kind is null or c.kind = v_kind)
    and (v_category is null or c.slug = v_category)
    and (p_district_id is null or l.district_id = p_district_id)
    and (
      v_q is null
      or l.title ilike '%' || v_q || '%'
      or p.username::text ilike '%' || v_q || '%'
      or l.id::text ilike v_q || '%'
    );

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', l.id,
      'title', l.title,
      'status', l.status,
      'moderation_status', l.moderation_status,
      'verification_status', l.verification_status,
      'kind', c.kind,
      'category_name', c.name,
      'category_slug', c.slug,
      'price_cents', l.price_cents,
      'currency', l.currency,
      'price_period', l.price_period,
      'city', l.city,
      'district', d.name,
      'district_id', l.district_id,
      'created_at', l.created_at,
      'published_at', l.published_at,
      'view_count', l.view_count,
      'favorite_count', l.favorite_count,
      'seller_id', l.seller_id,
      'seller_username', p.username,
      'seller_verified', coalesce(p.is_verified, false),
      'cover_path', (
        select i.storage_path from public.marketplace_listing_images i
        where i.listing_id = l.id
        order by i.is_cover desc, i.sort_order limit 1
      ),
      'media_count', (
        select count(*) from public.marketplace_listing_images i where i.listing_id = l.id
      ),
      'report_count', (
        select count(*) from public.user_reports r
        where r.target_type = 'listing' and r.target_id = l.id::text
      )
    ) as item,
    l.created_at
    from public.marketplace_listings l
    join public.profiles p on p.id = l.seller_id
    left join public.marketplace_categories c on c.id = l.category_id
    left join public.districts d on d.id = l.district_id
    where (v_status is null or l.status = v_status)
      and (v_kind is null or c.kind = v_kind)
      and (v_category is null or c.slug = v_category)
      and (p_district_id is null or l.district_id = p_district_id)
      and (
        v_q is null
        or l.title ilike '%' || v_q || '%'
        or p.username::text ilike '%' || v_q || '%'
        or l.id::text ilike v_q || '%'
      )
    order by l.created_at desc
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.market_admin_listings_v2(text, text, text, text, bigint, integer, integer)
  from public, anon;
grant execute on function public.market_admin_listings_v2(text, text, text, text, bigint, integer, integer)
  to authenticated, service_role;

create or replace function public.market_admin_listing_detail_v2(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  v_item := public.tz_listing_json_v2(p_listing_id, v_uid);
  if v_item is null then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  return v_item || jsonb_build_object(
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'from_status', h.from_status,
        'to_status', h.to_status,
        'reason', h.reason,
        'created_at', h.created_at,
        'actor_username', p.username
      ) order by h.created_at desc)
      from public.marketplace_listing_status_history h
      left join public.profiles p on p.id = h.actor_id
      where h.listing_id = p_listing_id
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'reason', r.reason_category,
        'details', r.description,
        'status', r.status,
        'created_at', r.created_at,
        'reporter_username', rp.username
      ) order by r.created_at desc)
      from public.user_reports r
      left join public.profiles rp on rp.id = r.reporter_id
      where r.target_type = 'listing' and r.target_id = p_listing_id::text
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.market_admin_listing_detail_v2(uuid) from public, anon;
grant execute on function public.market_admin_listing_detail_v2(uuid) to authenticated, service_role;

create or replace function public.market_admin_moderate_listing(
  p_listing_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_action text := lower(coalesce(nullif(trim(p_action), ''), ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_row public.marketplace_listings%rowtype;
  v_kind text;
  v_new_status text;
  v_title text;
  v_body text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_action not in ('approve', 'reject', 'remove', 'restore', 'expire') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  select * into v_row from public.marketplace_listings where id = p_listing_id for update;
  if not found then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  select kind into v_kind from public.marketplace_categories where id = v_row.category_id;

  if v_action = 'approve' then
    if v_kind in ('real_estate', 'vehicle') and v_row.verification_status <> 'verified' then
      raise exception 'verification_required' using errcode = '22023';
    end if;
    v_new_status := 'active';
    v_title := 'İlanın yayına alındı';
    v_body := 'İlanın moderasyon kontrolünden geçti ve yayına alındı.';
  elsif v_action = 'reject' then
    v_new_status := 'rejected';
    v_title := 'İlanın yayına alınmadı';
    v_body := coalesce('İlanın incelendi ve yayına alınmadı: ' || left(v_reason, 300),
                       'İlanın incelendi ve moderasyon kuralları gereği yayına alınmadı.');
  elsif v_action = 'remove' then
    v_new_status := 'removed';
    v_title := 'İlanın yayından kaldırıldı';
    v_body := coalesce('İlanın yayından kaldırıldı: ' || left(v_reason, 300),
                       'İlanın moderasyon kuralları gereği yayından kaldırıldı.');
  elsif v_action = 'expire' then
    v_new_status := 'expired';
    v_title := 'İlanın süresi doldu';
    v_body := 'İlanın yayın süresi doldu. Dilediğin zaman yeniden yayınlayabilirsin.';
  else
    v_new_status := case
      when v_kind in ('real_estate', 'vehicle') and v_row.verification_status <> 'verified' then 'pending'
      else 'active' end;
    v_title := 'İlanın yeniden yayına alındı';
    v_body := 'İlanın yeniden yayına alındı.';
  end if;

  update public.marketplace_listings l
     set status = v_new_status,
         moderation_status = case
           when v_new_status in ('rejected', 'removed') then 'hidden'
           when v_new_status = 'active' then 'visible'
           else l.moderation_status end,
         rejection_reason = case
           when v_new_status in ('rejected', 'removed') then v_reason
           else null end,
         published_at = case
           when v_new_status = 'active' then coalesce(l.published_at, now())
           else l.published_at end,
         expires_at = case
           when v_new_status = 'active' then now() + interval '30 days'
           else l.expires_at end,
         updated_status_at = now()
   where l.id = p_listing_id;

  insert into public.marketplace_listing_status_history (
    listing_id, actor_id, from_status, to_status, reason
  )
  values (p_listing_id, v_uid, v_row.status, v_new_status, v_reason);

  perform public.tz_notify(
    v_row.seller_id, v_uid, 'system', v_title, v_body,
    'listing', p_listing_id::text, '/marketplace/' || p_listing_id::text
  );

  perform public.market_admin_audit(
    'market.admin_' || v_action,
    'Marketplace ilanı moderasyonu: ' || v_action,
    'marketplace_listing',
    p_listing_id::text,
    jsonb_build_object('status', v_new_status, 'reason', v_reason)
  );

  return jsonb_build_object('id', p_listing_id, 'status', v_new_status);
end;
$$;

revoke all on function public.market_admin_moderate_listing(uuid, text, text) from public, anon;
grant execute on function public.market_admin_moderate_listing(uuid, text, text) to authenticated, service_role;

create or replace function public.market_admin_remove_media(
  p_media_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_media public.marketplace_listing_images%rowtype;
  v_listing public.marketplace_listings%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select * into v_media from public.marketplace_listing_images where id = p_media_id;
  if not found then
    raise exception 'media_not_found' using errcode = '22023';
  end if;

  select * into v_listing from public.marketplace_listings where id = v_media.listing_id;

  delete from public.marketplace_listing_images where id = p_media_id;

  insert into public.marketplace_listing_status_history (listing_id, actor_id, from_status, to_status, reason)
  values (v_media.listing_id, v_uid, v_listing.status, v_listing.status,
          'Medya kaldırıldı: ' || coalesce(left(trim(p_reason), 300), 'moderasyon'));

  perform public.tz_notify(
    v_listing.seller_id, v_uid, 'system',
    'İlan medyası kaldırıldı',
    coalesce('Bir fotoğraf/video moderasyon gereği kaldırıldı: ' || left(p_reason, 240),
             'Bir fotoğraf/video moderasyon gereği kaldırıldı.'),
    'listing', v_listing.id::text, '/marketplace/' || v_listing.id::text
  );

  perform public.market_admin_audit(
    'market.admin_media_remove',
    'İlan medyası kaldırıldı',
    'marketplace_media',
    p_media_id::text,
    jsonb_build_object('listing_id', v_listing.id, 'reason', p_reason)
  );

  return jsonb_build_object('removed', true, 'listing_id', v_listing.id);
end;
$$;

revoke all on function public.market_admin_remove_media(uuid, text) from public, anon;
grant execute on function public.market_admin_remove_media(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Kullanıcı ilan yönetimi: reddedilenleri de "İncelemede" say
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
    'pending', count(*) filter (where status in ('pending', 'rejected')),
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
        when 'pending' then l.status in ('pending', 'rejected')
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
          when 'pending' then l.status in ('pending', 'rejected')
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
