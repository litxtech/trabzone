-- =============================================================================
-- 0017 — Marketplace yönetimi (kategori, ilan, sipariş)
--
-- Amaç: yönetici panelinden marketplace kategorilerini yönetebilmek, ilanları
-- denetleyebilmek ve siparişleri izleyebilmek. Tüm yazma işlemleri sunucuda
-- `market.manage` / `market.orders.view` yetkisiyle doğrulanır; istemcide
-- yalnızca buton gizleme ile yetinilmez.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Yetkiler
-- ----------------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr)
values
  ('market.manage', 'Marketplace kategori ve ilan yönetimi'),
  ('market.orders.view', 'Marketplace siparişlerini görüntüleme')
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_key, permission_code)
select r.key, p.code
from public.roles r
cross join public.admin_permissions p
where r.key in ('admin', 'super_admin')
  and p.code in ('market.manage', 'market.orders.view')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Yardımcılar
-- ----------------------------------------------------------------------------
create or replace function public.market_admin_audit(
  p_action_code text,
  p_label_tr text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.admin_audit_logs (
    actor_admin_id, action_code, action_label_tr, target_type, target_id, outcome, metadata_safe
  )
  values (
    auth.uid(),
    left(coalesce(p_action_code, 'market.action'), 80),
    left(coalesce(p_label_tr, 'Marketplace işlemi'), 160),
    left(coalesce(p_target_type, 'marketplace'), 64),
    left(coalesce(p_target_id, ''), 200),
    'success',
    coalesce(p_metadata, '{}'::jsonb)
  );
exception
  when others then null;
end
$$;

revoke all on function public.market_admin_audit(text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.market_admin_category_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id,
    'parent_id', c.parent_id,
    'slug', c.slug::text,
    'name', c.name,
    'icon', c.icon,
    'sort_order', c.sort_order,
    'is_active', c.is_active,
    'created_at', c.created_at,
    'listing_count', (
      select count(*) from public.marketplace_listings l where l.category_id = c.id
    ),
    'child_count', (
      select count(*) from public.marketplace_categories ch where ch.parent_id = c.id
    )
  )
  from public.marketplace_categories c
  where c.id = p_id
$$;

revoke all on function public.market_admin_category_json(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Kategoriler
-- ----------------------------------------------------------------------------
create or replace function public.market_admin_categories()
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
    'items',
    coalesce(
      (
        select jsonb_agg(public.market_admin_category_json(c.id) order by c.sort_order, c.name)
        from public.marketplace_categories c
      ),
      '[]'::jsonb
    )
  );
end
$$;

create or replace function public.market_admin_upsert_category(
  p_id uuid default null,
  p_name text default null,
  p_slug text default null,
  p_parent_id uuid default null,
  p_icon text default null,
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name   text := trim(coalesce(p_name, ''));
  v_slug   text;
  v_icon   text := nullif(trim(coalesce(p_icon, '')), '');
  v_id     uuid := p_id;
  v_parent public.marketplace_categories%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  v_slug := lower(coalesce(nullif(trim(coalesce(p_slug, '')), ''), v_name));
  v_slug := translate(v_slug, 'çğıöşüÇĞİÖŞÜ ', 'cgiosuCGIOSU-');
  v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '-', 'g');
  v_slug := regexp_replace(v_slug, '-{2,}', '-', 'g');
  v_slug := trim(both '-' from v_slug);

  if v_slug !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  if p_id is not null then
    if not exists (select 1 from public.marketplace_categories where id = p_id) then
      raise exception 'category_not_found' using errcode = '22023';
    end if;
  end if;

  if p_parent_id is not null then
    if p_id is not null and p_parent_id = p_id then
      raise exception 'invalid_parent' using errcode = '22023';
    end if;

    select * into v_parent from public.marketplace_categories where id = p_parent_id;
    if not found then
      raise exception 'category_not_found' using errcode = '22023';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'invalid_parent' using errcode = '22023';
    end if;
    if p_id is not null
       and exists (select 1 from public.marketplace_categories ch where ch.parent_id = p_id) then
      raise exception 'invalid_parent' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from public.marketplace_categories c
    where c.slug = v_slug
      and (p_id is null or c.id <> p_id)
  ) then
    raise exception 'duplicate_slug' using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.marketplace_categories (parent_id, slug, name, icon, sort_order, is_active)
    values (p_parent_id, v_slug, v_name, v_icon, coalesce(p_sort_order, 0), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.marketplace_categories c
       set parent_id = p_parent_id,
           slug = v_slug,
           name = v_name,
           icon = v_icon,
           sort_order = coalesce(p_sort_order, c.sort_order),
           is_active = coalesce(p_is_active, c.is_active)
     where c.id = p_id;
  end if;

  perform public.market_admin_audit(
    'market.category_upsert',
    'Marketplace kategorisi kaydedildi',
    'market_category',
    v_id::text,
    jsonb_build_object('slug', v_slug, 'parent_id', p_parent_id, 'is_active', p_is_active)
  );

  return public.market_admin_category_json(v_id);
end
$$;

create or replace function public.market_admin_delete_category(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      public.marketplace_categories%rowtype;
  v_children integer;
  v_listings integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select * into v_row from public.marketplace_categories where id = p_id;
  if not found then
    raise exception 'category_not_found' using errcode = '22023';
  end if;

  select count(*) into v_children from public.marketplace_categories where parent_id = p_id;
  if v_children > 0 then
    raise exception 'category_has_children' using errcode = '22023';
  end if;

  select count(*) into v_listings from public.marketplace_listings where category_id = p_id;
  if v_listings > 0 then
    raise exception 'category_in_use' using errcode = '22023';
  end if;

  delete from public.marketplace_categories where id = p_id;

  perform public.market_admin_audit(
    'market.category_delete',
    'Marketplace kategorisi silindi',
    'market_category',
    p_id::text,
    jsonb_build_object('slug', v_row.slug::text, 'name', v_row.name)
  );

  return jsonb_build_object('deleted', true);
end
$$;

-- ----------------------------------------------------------------------------
-- İlanlar
-- ----------------------------------------------------------------------------
create or replace function public.market_admin_listings(
  p_query text default null,
  p_status text default null,
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
  v_q      text := nullif(trim(coalesce(p_query, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_status is not null
     and v_status not in ('active', 'reserved', 'sold', 'archived', 'removed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'total', (
      select count(*)
      from public.marketplace_listings l
      join public.profiles p on p.id = l.seller_id
      where (v_status is null or l.status = v_status)
        and (
          v_q is null
          or l.title ilike '%' || v_q || '%'
          or p.username::text ilike '%' || v_q || '%'
        )
    ),
    'items', coalesce(
      (
        select jsonb_agg(item order by created_at desc)
        from (
          select
            jsonb_build_object(
              'id', l.id,
              'title', l.title,
              'status', l.status,
              'moderation_status', l.moderation_status,
              'price_cents', l.price_cents,
              'currency', l.currency,
              'city', l.city,
              'created_at', l.created_at,
              'seller_id', l.seller_id,
              'seller_username', p.username,
              'seller_verified', coalesce(p.is_verified, false),
              'image_path', (
                select i.storage_path
                from public.marketplace_listing_images i
                where i.listing_id = l.id
                order by i.sort_order, i.created_at
                limit 1
              ),
              'report_count', (
                select count(*)
                from public.user_reports r
                where r.target_type = 'listing'
                  and r.target_id = l.id::text
              )
            ) as item,
            l.created_at
          from public.marketplace_listings l
          join public.profiles p on p.id = l.seller_id
          where (v_status is null or l.status = v_status)
            and (
              v_q is null
              or l.title ilike '%' || v_q || '%'
              or p.username::text ilike '%' || v_q || '%'
            )
          order by l.created_at desc
          limit v_limit offset v_offset
        ) s
      ),
      '[]'::jsonb
    )
  );
end
$$;

create or replace function public.market_admin_set_listing_status(
  p_listing_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text := trim(coalesce(p_status, ''));
  v_row    public.marketplace_listings%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_status not in ('active', 'archived', 'removed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_row from public.marketplace_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  update public.marketplace_listings l
     set status = v_status,
         moderation_status = case
           when v_status = 'removed' then 'removed'
           when v_status = 'active' then 'visible'
           else l.moderation_status
         end,
         updated_at = now()
   where l.id = p_listing_id;

  if v_status = 'removed' then
    insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
    values (
      v_row.seller_id,
      v_uid,
      'system',
      'İlanın yayından kaldırıldı',
      case
        when nullif(trim(coalesce(p_reason, '')), '') is null
          then 'İlanın moderasyon kuralları gereği yayından kaldırıldı.'
        else 'İlanın yayından kaldırıldı: ' || left(trim(p_reason), 240)
      end,
      'marketplace_listing',
      p_listing_id::text,
      '/marketplace/' || p_listing_id::text
    );
  end if;

  perform public.market_admin_audit(
    'market.listing_' || v_status,
    case v_status
      when 'removed' then 'Marketplace ilanı yayından kaldırıldı'
      when 'archived' then 'Marketplace ilanı arşivlendi'
      else 'Marketplace ilanı yayına alındı'
    end,
    'marketplace_listing',
    p_listing_id::text,
    jsonb_build_object('status', v_status, 'reason', nullif(trim(coalesce(p_reason, '')), ''))
  );

  return jsonb_build_object('id', p_listing_id, 'status', v_status);
end
$$;

-- ----------------------------------------------------------------------------
-- Siparişler (salt okunur takip)
-- ----------------------------------------------------------------------------
create or replace function public.market_admin_orders(
  p_status text default null,
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
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not (public.has_permission('market.orders.view') or public.has_permission('market.manage')) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_status is not null
     and v_status not in ('requested', 'confirmed', 'shipped', 'delivered', 'completed', 'cancelled', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'total', (
      select count(*) from public.marketplace_orders o
      where v_status is null or o.status = v_status
    ),
    'items', coalesce(
      (
        select jsonb_agg(item order by created_at desc)
        from (
          select
            jsonb_build_object(
              'id', o.id,
              'order_no', o.order_no,
              'status', o.status,
              'total_cents', o.total_cents,
              'currency', o.currency,
              'payment_method', o.payment_method,
              'payment_status', o.payment_status,
              'created_at', o.created_at,
              'buyer_id', o.buyer_id,
              'seller_id', o.seller_id,
              'buyer_username', b.username,
              'seller_username', s.username,
              'item_count', (
                select coalesce(sum(i.quantity), 0)
                from public.marketplace_order_items i
                where i.order_id = o.id
              )
            ) as item,
            o.created_at
          from public.marketplace_orders o
          join public.profiles b on b.id = o.buyer_id
          join public.profiles s on s.id = o.seller_id
          where v_status is null or o.status = v_status
          order by o.created_at desc
          limit v_limit offset v_offset
        ) s
      ),
      '[]'::jsonb
    )
  );
end
$$;

-- ----------------------------------------------------------------------------
-- Personel izin listesi: marketplace yetkileri de istemciye bildirilir
-- ----------------------------------------------------------------------------
create or replace function public.safety_staff_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_permissions text[];
begin
  if v_uid is null then
    return jsonb_build_object('user_id', null, 'is_staff', false, 'permissions', '[]'::jsonb);
  end if;

  select coalesce(array_agg(s.code order by s.code), array[]::text[])
  into v_permissions
  from (
    select p.code
    from public.admin_permissions p
    where (
      p.code like 'support.%'
      or p.code like 'safety.%'
      or p.code like 'market.%'
      or p.code in ('report.moderation', 'audit.view')
    )
    and public.has_permission(p.code)
  ) s;

  return jsonb_build_object(
    'user_id', v_uid,
    'is_staff', coalesce(array_length(v_permissions, 1), 0) > 0,
    'permissions', to_jsonb(coalesce(v_permissions, array[]::text[]))
  );
end
$$;

revoke all on function public.safety_staff_me() from public, anon;
grant execute on function public.safety_staff_me() to authenticated;

-- ----------------------------------------------------------------------------
-- Yetkilendirme
-- ----------------------------------------------------------------------------
revoke all on function public.market_admin_categories() from public, anon;
revoke all on function public.market_admin_upsert_category(uuid, text, text, uuid, text, integer, boolean) from public, anon;
revoke all on function public.market_admin_delete_category(uuid) from public, anon;
revoke all on function public.market_admin_listings(text, text, integer, integer) from public, anon;
revoke all on function public.market_admin_set_listing_status(uuid, text, text) from public, anon;
revoke all on function public.market_admin_orders(text, integer, integer) from public, anon;

grant execute on function public.market_admin_categories() to authenticated;
grant execute on function public.market_admin_upsert_category(uuid, text, text, uuid, text, integer, boolean) to authenticated;
grant execute on function public.market_admin_delete_category(uuid) to authenticated;
grant execute on function public.market_admin_listings(text, text, integer, integer) to authenticated;
grant execute on function public.market_admin_set_listing_status(uuid, text, text) to authenticated;
grant execute on function public.market_admin_orders(text, integer, integer) to authenticated;

comment on function public.market_admin_categories() is
  'Yönetici: tüm marketplace kategorileri (pasifler dahil) ve kullanım sayıları.';
comment on function public.market_admin_upsert_category(uuid, text, text, uuid, text, integer, boolean) is
  'Yönetici: kategori oluşturur/günceller. En fazla iki seviye desteklenir.';
comment on function public.market_admin_set_listing_status(uuid, text, text) is
  'Yönetici: ilanı yayına alır, arşivler veya yayından kaldırır (satıcıya bildirim gider).';
