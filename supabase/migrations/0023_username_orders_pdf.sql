-- ---------------------------------------------------------------------------
-- 0023 · Kullanıcı adı kotası, sipariş fişi ve satış özeti
--
-- * Kullanıcı adı haftada yalnızca bir kez değiştirilebilir. Kayıt sırasında
--   yazım hatası olabileceği için herkese bir ek (kota dışı) hak tanınır.
-- * Sipariş fişi/faturası için tek çağrıda tüm detayı dönen RPC.
-- * Satıcı ve yönetici için satış özeti (adet, ciro, tarih aralığı).
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists username_changed_at timestamptz,
  add column if not exists username_change_credits integer not null default 1;

alter table public.profiles
  drop constraint if exists profiles_username_change_credits_check;

alter table public.profiles
  add constraint profiles_username_change_credits_check
  check (username_change_credits between 0 and 5);

comment on column public.profiles.username_changed_at is
  'Son kullanıcı adı değişiminin zamanı. 7 günlük bekleme süresi buradan hesaplanır.';
comment on column public.profiles.username_change_credits is
  'Bekleme süresini atlayan ek kullanıcı adı hakkı (kayıt yazım hatası için 1).';

-- ---------------------------------------------------------------------------
-- Durum sorgusu
-- ---------------------------------------------------------------------------
create or replace function public.profile_username_change_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles;
  v_next    timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;

  if v_profile.username_changed_at is not null then
    v_next := v_profile.username_changed_at + interval '7 days';
  end if;

  return jsonb_build_object(
    'username', v_profile.username,
    'credits', v_profile.username_change_credits,
    'last_changed_at', v_profile.username_changed_at,
    'next_change_at', v_next,
    'can_change',
      v_profile.username_change_credits > 0
      or v_next is null
      or v_next <= now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Değişim
-- ---------------------------------------------------------------------------
create or replace function public.profile_change_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_username    text := lower(trim(p_username));
  v_profile     public.profiles;
  v_next        timestamptz;
  v_use_credit  boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if v_username is null or v_username !~ '^[a-z0-9_.]{3,24}$' then
    raise exception 'username_invalid' using errcode = 'P0001';
  end if;

  if v_username = any (array['admin','trabzone','support','help','marketplace','official','moderator','root','system']) then
    raise exception 'username_reserved' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if v_profile.id is null then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;

  if v_profile.username = v_username then
    return jsonb_build_object(
      'username', v_profile.username,
      'changed', false,
      'credits', v_profile.username_change_credits,
      'next_change_at', v_profile.username_changed_at + interval '7 days'
    );
  end if;

  if exists (select 1 from public.profiles where username = v_username and id <> v_uid) then
    raise exception 'username_taken' using errcode = 'P0001';
  end if;

  if v_profile.username_changed_at is not null then
    v_next := v_profile.username_changed_at + interval '7 days';
    if v_next > now() then
      if v_profile.username_change_credits <= 0 then
        raise exception 'username_cooldown' using errcode = 'P0001';
      end if;
      v_use_credit := true;
    end if;
  end if;

  begin
    update public.profiles
       set username = v_username,
           username_changed_at = now(),
           username_change_credits = case
             when v_use_credit then greatest(v_profile.username_change_credits - 1, 0)
             else v_profile.username_change_credits
           end
     where id = v_uid
    returning * into v_profile;
  exception
    when unique_violation then
      raise exception 'username_taken' using errcode = 'P0001';
  end;

  return jsonb_build_object(
    'username', v_profile.username,
    'changed', true,
    'credits', v_profile.username_change_credits,
    'next_change_at', v_profile.username_changed_at + interval '7 days'
  );
end;
$$;

revoke all on function public.profile_username_change_status() from public, anon;
revoke all on function public.profile_change_username(text) from public, anon;
grant execute on function public.profile_username_change_status() to authenticated;
grant execute on function public.profile_change_username(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Sipariş fişi: alıcı, satıcı, teslimat ve kalemler tek yanıtta
-- ---------------------------------------------------------------------------
create or replace function public.market_order_receipt(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.marketplace_orders%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
begin
  select * into v_row from public.marketplace_orders where id = p_order_id;
  if v_row.id is null then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  if v_uid not in (v_row.buyer_id, v_row.seller_id)
     and not (public.has_permission('market.orders.view') or public.has_permission('market.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_buyer from public.profiles where id = v_row.buyer_id;
  select * into v_seller from public.profiles where id = v_row.seller_id;

  return jsonb_build_object(
    'id', v_row.id,
    'order_no', v_row.order_no,
    'status', v_row.status,
    'total_cents', v_row.total_cents,
    'subtotal_cents', v_row.subtotal_cents,
    'currency', v_row.currency,
    'payment_status', v_row.payment_status,
    'payment_method', v_row.payment_method,
    'created_at', v_row.created_at,
    'contact_name', v_row.contact_name,
    'contact_phone', v_row.contact_phone,
    'shipping_city', v_row.shipping_city,
    'shipping_address', v_row.shipping_address,
    'note', v_row.note,
    'buyer', jsonb_build_object(
      'id', v_buyer.id,
      'username', v_buyer.username,
      'first_name', v_buyer.first_name,
      'last_name', v_buyer.last_name
    ),
    'seller', jsonb_build_object(
      'id', v_seller.id,
      'username', v_seller.username,
      'first_name', v_seller.first_name,
      'last_name', v_seller.last_name
    ),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'listing_id', i.listing_id,
            'title', i.title_snapshot,
            'unit_price_cents', i.unit_price_cents,
            'quantity', i.quantity
          )
          order by i.id
        )
        from public.marketplace_order_items i
        where i.order_id = v_row.id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.market_order_receipt(uuid) from public, anon;
grant execute on function public.market_order_receipt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Satış özeti (satıcı için; yönetici tüm pazarı görebilir)
-- ---------------------------------------------------------------------------
create or replace function public.market_sales_summary(p_scope text default 'mine')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_scope text := coalesce(nullif(trim(p_scope), ''), 'mine');
  v_all   boolean := false;
begin
  if v_scope not in ('mine', 'all') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;

  if v_scope = 'all' then
    if not (public.has_permission('market.orders.view') or public.has_permission('market.manage')) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_all := true;
  end if;

  return (
    with scoped as (
      select *
      from public.marketplace_orders o
      where v_all or o.seller_id = v_uid
    )
    select jsonb_build_object(
      'order_count', count(*),
      'completed_count', count(*) filter (where status = 'completed'),
      'open_count', count(*) filter (where status in ('requested', 'confirmed', 'shipped', 'delivered')),
      'gross_cents', coalesce(sum(total_cents) filter (where status <> 'cancelled' and status <> 'rejected'), 0),
      'completed_cents', coalesce(sum(total_cents) filter (where status = 'completed'), 0),
      'month_cents', coalesce(
        sum(total_cents) filter (
          where status <> 'cancelled' and status <> 'rejected' and created_at >= date_trunc('month', now())
        ),
        0
      )
    )
    from scoped
  );
end;
$$;

revoke all on function public.market_sales_summary(text) from public, anon;
grant execute on function public.market_sales_summary(text) to authenticated;
