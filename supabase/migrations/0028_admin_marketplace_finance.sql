-- 0027: Marketplace operations, effective-dated commission and finance
--
-- Financial integrity rules:
--   * An order can never be marked "paid" from the admin panel.
--   * Refunds are only possible for orders whose payment provider reported
--     payment_status = 'paid'.
--   * Commission changes are effective-dated. Historical order snapshots are
--     never recalculated.

set search_path = public, extensions;

alter table public.marketplace_orders
  alter column commission_bps drop not null,
  alter column commission_bps set default null,
  alter column commission_cents drop not null,
  alter column commission_cents set default 0;

insert into public.marketplace_commission_settings (category_id, rate_bps, effective_from, note)
select null, 0, now() - interval '1 day', 'Başlangıç: komisyon uygulanmıyor'
where not exists (select 1 from public.marketplace_commission_settings where category_id is null);

create or replace function public.tz_apply_order_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate integer;
begin
  if new.commission_bps is null then
    select c.rate_bps into v_rate
    from public.marketplace_commission_settings c
    where c.category_id is null
      and c.effective_from <= now()
    order by c.effective_from desc
    limit 1;

    new.commission_bps := coalesce(v_rate, 0);
  end if;

  new.commission_bps := least(greatest(coalesce(new.commission_bps, 0), 0), 5000);
  new.commission_cents := round(coalesce(new.subtotal_cents, 0) * new.commission_bps / 10000.0)::bigint;

  return new;
end;
$$;

drop trigger if exists zz_marketplace_order_commission on public.marketplace_orders;
create trigger zz_marketplace_order_commission
before insert on public.marketplace_orders
for each row execute function public.tz_apply_order_commission();

-- ---------------------------------------------------------------------------
-- 1. Marketplace overview
-- ---------------------------------------------------------------------------

create or replace function public.admin_marketplace_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('market.manage');

  return jsonb_build_object(
    'listings', jsonb_build_object(
      'total', (select count(*) from public.marketplace_listings),
      'active', (select count(*) from public.marketplace_listings where status = 'active'),
      'sold', (select count(*) from public.marketplace_listings where status = 'sold'),
      'archived', (select count(*) from public.marketplace_listings where status = 'archived'),
      'removed', (select count(*) from public.marketplace_listings where status = 'removed'),
      'hidden', (select count(*) from public.marketplace_listings where moderation_status <> 'visible'),
      'reported', (select count(distinct target_id) from public.user_reports
                   where target_type in ('listing', 'other') and status_code in ('received', 'under_review'))
    ),
    'orders', jsonb_build_object(
      'total', (select count(*) from public.marketplace_orders),
      'requested', (select count(*) from public.marketplace_orders where status = 'requested'),
      'confirmed', (select count(*) from public.marketplace_orders where status = 'confirmed'),
      'shipped', (select count(*) from public.marketplace_orders where status = 'shipped'),
      'delivered', (select count(*) from public.marketplace_orders where status = 'delivered'),
      'completed', (select count(*) from public.marketplace_orders where status = 'completed'),
      'cancelled', (select count(*) from public.marketplace_orders where status in ('cancelled', 'rejected')),
      'disputes', (select count(*) from public.marketplace_orders where dispute_status = 'open'),
      'pending_payment', (select count(*) from public.marketplace_orders where payment_status = 'pending')
    ),
    'financials', jsonb_build_object(
      'gmv_cents', (select coalesce(sum(total_cents), 0) from public.marketplace_orders where payment_status = 'paid'),
      'commission_cents', (select coalesce(sum(commission_cents), 0) from public.marketplace_orders where payment_status = 'paid'),
      'refunded_cents', (select coalesce(sum(amount_cents), 0) from public.marketplace_refunds where status in ('approved', 'processed')),
      'paid_orders', (select count(*) from public.marketplace_orders where payment_status = 'paid'),
      'unpaid_orders', (select count(*) from public.marketplace_orders where payment_status = 'not_collected')
    ),
    'reports', jsonb_build_object(
      'open_listing_reports', (
        select count(*) from public.user_reports
        where target_type in ('listing', 'other') and status_code in ('received', 'under_review')
      )
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug::text,
        'listing_count', (select count(*) from public.marketplace_listings l where l.category_id = c.id),
        'is_active', c.is_active
      ) order by (select count(*) from public.marketplace_listings l where l.category_id = c.id) desc)
      from public.marketplace_categories c
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Order detail
-- ---------------------------------------------------------------------------

create or replace function public.admin_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  perform public.tz_admin_require('market.orders.view');

  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id,
      'order_no', o.order_no,
      'status', o.status,
      'subtotal_cents', o.subtotal_cents,
      'total_cents', o.total_cents,
      'currency', o.currency,
      'payment_method', o.payment_method,
      'payment_status', o.payment_status,
      'commission_bps', o.commission_bps,
      'commission_cents', o.commission_cents,
      'refunded_cents', o.refunded_cents,
      'dispute_status', o.dispute_status,
      'contact_name', o.contact_name,
      'contact_phone', o.contact_phone,
      'shipping_city', o.shipping_city,
      'shipping_address', o.shipping_address,
      'note', o.note,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'buyer', jsonb_build_object(
        'id', b.id, 'username', b.username, 'display_name', b.display_name, 'avatar_path', b.avatar_path,
        'email', bu.email
      ),
      'seller', jsonb_build_object(
        'id', s.id, 'username', s.username, 'display_name', s.display_name, 'avatar_path', s.avatar_path,
        'email', su.email
      )
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'listing_id', i.listing_id,
        'title', i.title_snapshot,
        'image_path', i.image_path,
        'unit_price_cents', i.unit_price_cents,
        'quantity', i.quantity,
        'line_total_cents', i.unit_price_cents * i.quantity
      ) order by i.id)
      from public.marketplace_order_items i where i.order_id = o.id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'amount_cents', r.amount_cents, 'status', r.status, 'reason', r.reason,
        'created_at', r.created_at, 'decided_at', r.decided_at,
        'decided_by_name', dp.display_name
      ) order by r.created_at desc)
      from public.marketplace_refunds r
      left join public.profiles dp on dp.id = r.decided_by
      where r.order_id = o.id
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'action_code', l.action_code,
        'action_label', l.action_label_tr,
        'actor_name', ap.display_name,
        'created_at', l.created_at,
        'metadata', l.metadata_safe
      ) order by l.created_at desc)
      from public.admin_audit_logs l
      left join public.profiles ap on ap.id = l.actor_admin_id
      where l.target_type = 'marketplace_order' and l.target_id = o.id::text
      limit 20
    ), '[]'::jsonb)
  )
  into v_payload
  from public.marketplace_orders o
  join public.profiles b on b.id = o.buyer_id
  join public.profiles s on s.id = o.seller_id
  join auth.users bu on bu.id = o.buyer_id
  join auth.users su on su.id = o.seller_id
  where o.id = p_order_id;

  if v_payload is null then
    raise exception 'order_not_found' using errcode = '22023';
  end if;

  return v_payload;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Order actions (no fake payment success)
-- ---------------------------------------------------------------------------

create or replace function public.admin_order_action(
  p_order_id uuid,
  p_action text,
  p_reason text default null,
  p_amount_cents bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('market.orders.action', true);
  v_action text := lower(trim(coalesce(p_action, '')));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_order public.marketplace_orders%rowtype;
  v_new_status text;
  v_refund_id uuid;
  v_amount bigint;
begin
  if v_action not in (
    'confirm', 'ship', 'deliver', 'complete', 'cancel', 'reject',
    'refund', 'dispute_open', 'dispute_resolve', 'dispute_reject'
  ) then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  if v_action in ('cancel', 'reject', 'refund', 'dispute_open', 'dispute_resolve', 'dispute_reject')
     and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  if v_action = 'refund' and not public.has_permission('finance.action') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select * into v_order from public.marketplace_orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = '22023';
  end if;

  if v_action = 'refund' then
    if v_order.payment_status <> 'paid' then
      raise exception 'payment_not_collected' using errcode = '22023';
    end if;

    v_amount := coalesce(p_amount_cents, v_order.total_cents - v_order.refunded_cents);
    if v_amount <= 0 or v_amount > (v_order.total_cents - v_order.refunded_cents) then
      raise exception 'invalid_refund_amount' using errcode = '22023';
    end if;

    insert into public.marketplace_refunds (order_id, amount_cents, status, reason, requested_by, decided_by, decided_at)
    values (p_order_id, v_amount, 'approved', v_reason, v_uid, v_uid, now())
    returning id into v_refund_id;

    update public.marketplace_orders
       set refunded_cents = refunded_cents + v_amount,
           payment_status = case when refunded_cents + v_amount >= total_cents then 'refunded' else payment_status end,
           updated_at = now()
     where id = p_order_id;

    perform public.tz_notify(
      v_order.buyer_id, v_uid, 'order', 'İade talebin onaylandı',
      'Sipariş ' || v_order.order_no || ' için iade işlemi kaydedildi.', 'order', p_order_id::text,
      '/marketplace/orders'
    );

    perform public.tz_admin_audit(
      'marketplace.order_refunded', 'Sipariş iadesi kaydedildi', 'marketplace_order', p_order_id::text,
      jsonb_build_object('amount_cents', v_amount, 'reason', left(v_reason, 400), 'refund_id', v_refund_id)
    );

    return jsonb_build_object('order_id', p_order_id, 'action', 'refund', 'refund_id', v_refund_id, 'amount_cents', v_amount);
  end if;

  if v_action in ('dispute_open', 'dispute_resolve', 'dispute_reject') then
    update public.marketplace_orders
       set dispute_status = case v_action
             when 'dispute_open' then 'open'
             when 'dispute_resolve' then 'resolved'
             else 'rejected'
           end,
           updated_at = now()
     where id = p_order_id;

    perform public.tz_admin_audit(
      'marketplace.dispute_' || v_action,
      'Sipariş uyuşmazlığı güncellendi',
      'marketplace_order',
      p_order_id::text,
      jsonb_build_object('reason', left(v_reason, 400), 'dispute_status', v_action)
    );

    return jsonb_build_object('order_id', p_order_id, 'action', v_action);
  end if;

  v_new_status := case v_action
    when 'confirm' then 'confirmed'
    when 'ship' then 'shipped'
    when 'deliver' then 'delivered'
    when 'complete' then 'completed'
    when 'cancel' then 'cancelled'
    when 'reject' then 'rejected'
  end;

  if not (
    (v_order.status = 'requested' and v_new_status in ('confirmed', 'rejected', 'cancelled'))
    or (v_order.status = 'confirmed' and v_new_status in ('shipped', 'cancelled'))
    or (v_order.status = 'shipped' and v_new_status in ('delivered', 'cancelled'))
    or (v_order.status = 'delivered' and v_new_status = 'completed')
  ) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  update public.marketplace_orders
     set status = v_new_status, updated_at = now()
   where id = p_order_id;

  perform public.tz_notify(
    v_order.buyer_id, v_uid, 'order',
    'Sipariş durumu güncellendi',
    'Sipariş ' || v_order.order_no || ' yeni durum: ' || v_new_status,
    'order', p_order_id::text, '/marketplace/orders'
  );

  perform public.tz_admin_audit(
    'marketplace.order_' || v_new_status,
    'Sipariş durumu güncellendi',
    'marketplace_order',
    p_order_id::text,
    jsonb_build_object('old', v_order.status, 'new', v_new_status, 'reason', left(coalesce(v_reason, ''), 400))
  );

  return jsonb_build_object('order_id', p_order_id, 'status', v_new_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Commission settings
-- ---------------------------------------------------------------------------

create or replace function public.admin_commission_settings_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('market.finance.view');

  return jsonb_build_object(
    'current_global_bps', coalesce((
      select rate_bps from public.marketplace_commission_settings
      where category_id is null and effective_from <= now()
      order by effective_from desc limit 1
    ), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'category_id', c.category_id,
        'category_name', cat.name,
        'rate_bps', c.rate_bps,
        'effective_from', c.effective_from,
        'note', c.note,
        'created_at', c.created_at,
        'created_by_name', p.display_name
      ) order by c.effective_from desc)
      from public.marketplace_commission_settings c
      left join public.marketplace_categories cat on cat.id = c.category_id
      left join public.profiles p on p.id = c.created_by
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_commission_set(
  p_rate_bps integer,
  p_category_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('finance.action', true);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_rate_bps is null or p_rate_bps < 0 or p_rate_bps > 5000 then
    raise exception 'invalid_commission' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.marketplace_categories where id = p_category_id
  ) then
    raise exception 'category_not_found' using errcode = '22023';
  end if;

  insert into public.marketplace_commission_settings (category_id, rate_bps, effective_from, note, created_by)
  values (p_category_id, p_rate_bps, now(), v_reason, v_uid)
  returning id into v_id;

  perform public.tz_admin_audit(
    'marketplace.commission_set',
    'Marketplace komisyon oranı güncellendi',
    'marketplace_commission',
    v_id::text,
    jsonb_build_object(
      'rate_bps', p_rate_bps,
      'category_id', p_category_id,
      'reason', left(v_reason, 400),
      'effective_from', now()
    )
  );

  return jsonb_build_object('id', v_id, 'rate_bps', p_rate_bps, 'effective_from', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Finance overview
-- ---------------------------------------------------------------------------

create or replace function public.admin_finance_overview(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_premium bigint;
  v_market bigint;
  v_commission bigint;
  v_refunds bigint;
  v_failed bigint;
  v_pending bigint;
begin
  perform public.tz_admin_require('finance.view');

  select coalesce(sum(amount_cents), 0) into v_premium
  from public.premium_payments
  where status = 'paid' and paid_at >= v_from and paid_at < v_to;

  select coalesce(sum(total_cents), 0) into v_market
  from public.marketplace_orders
  where payment_status = 'paid' and created_at >= v_from and created_at < v_to;

  select coalesce(sum(commission_cents), 0) into v_commission
  from public.marketplace_orders
  where payment_status = 'paid' and created_at >= v_from and created_at < v_to;

  select coalesce(sum(amount_cents), 0) into v_refunds
  from public.marketplace_refunds
  where status in ('approved', 'processed') and created_at >= v_from and created_at < v_to;

  select count(*) into v_failed
  from public.premium_payments
  where status <> 'paid' and created_at >= v_from and created_at < v_to;

  select count(*) into v_pending
  from public.marketplace_orders
  where payment_status = 'pending' and created_at >= v_from and created_at < v_to;

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'stats', jsonb_build_object(
      'gross_cents', v_premium + v_market,
      'premium_cents', v_premium,
      'marketplace_cents', v_market,
      'commission_cents', v_commission,
      'refunded_cents', v_refunds,
      'net_cents', (v_premium + v_market - v_refunds),
      'failed_payments', v_failed,
      'pending_payments', v_pending,
      'paid_transactions', (
        (select count(*) from public.premium_payments where status = 'paid' and paid_at >= v_from and paid_at < v_to)
        + (select count(*) from public.marketplace_orders where payment_status = 'paid' and created_at >= v_from and created_at < v_to)
      ),
      'active_subscriptions', (select count(*) from public.premium_subscriptions where status = 'active'),
      'canceled_subscriptions', (select count(*) from public.premium_subscriptions where status = 'canceled'),
      'arpu_cents', case when (select count(*) from public.profiles where account_status <> 'deleted') = 0 then 0
                         else round((v_premium + v_market)::numeric /
                                    (select count(*) from public.profiles where account_status <> 'deleted'), 0)::bigint end
    ),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'premium_cents', coalesce(p.c, 0),
        'marketplace_cents', coalesce(m.c, 0),
        'commission_cents', coalesce(c.c, 0),
        'refund_cents', coalesce(r.c, 0)
      ) order by d.day)
      from (select generate_series(v_from::date, v_to::date, interval '1 day')::date as day) d
      left join (
        select paid_at::date as day, sum(amount_cents) as c
        from public.premium_payments
        where status = 'paid' and paid_at >= v_from and paid_at < v_to
        group by 1
      ) p on p.day = d.day
      left join (
        select created_at::date as day, sum(total_cents) as c
        from public.marketplace_orders
        where payment_status = 'paid' and created_at >= v_from and created_at < v_to
        group by 1
      ) m on m.day = d.day
      left join (
        select created_at::date as day, sum(commission_cents) as c
        from public.marketplace_orders
        where payment_status = 'paid' and created_at >= v_from and created_at < v_to
        group by 1
      ) c on c.day = d.day
      left join (
        select created_at::date as day, sum(amount_cents) as c
        from public.marketplace_refunds
        where status in ('approved', 'processed') and created_at >= v_from and created_at < v_to
        group by 1
      ) r on r.day = d.day
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x order by created_at desc)
      from (
        select
          jsonb_build_object(
            'id', pp.id,
            'kind', 'premium',
            'reference', 'PRM-' || left(pp.id::text, 8),
            'user_name', pr.display_name,
            'amount_cents', pp.amount_cents,
            'currency', pp.currency,
            'status', pp.status,
            'provider', pp.provider,
            'created_at', pp.created_at
          ) as x,
          pp.created_at
        from public.premium_payments pp
        left join public.profiles pr on pr.id = pp.user_id
        union all
        select
          jsonb_build_object(
            'id', o.id,
            'kind', 'marketplace',
            'reference', o.order_no,
            'user_name', bp.display_name,
            'amount_cents', o.total_cents,
            'currency', o.currency,
            'status', o.payment_status,
            'provider', o.payment_method,
            'created_at', o.created_at
          ) as x,
          o.created_at
        from public.marketplace_orders o
        left join public.profiles bp on bp.id = o.buyer_id
        order by created_at desc
        limit 12
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Finance transactions
-- ---------------------------------------------------------------------------

create or replace function public.admin_finance_transactions(
  p_kind text default 'all',
  p_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'all');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_from timestamptz := coalesce(p_from, now() - interval '90 days');
  v_to timestamptz := coalesce(p_to, now());
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  perform public.tz_admin_require('finance.view');

  with tx as (
    select pp.id, 'premium'::text as kind, 'PRM-' || left(pp.id::text, 8) as reference,
           pr.display_name as user_name, pp.amount_cents, pp.currency, pp.status,
           pp.provider, pp.created_at
    from public.premium_payments pp
    left join public.profiles pr on pr.id = pp.user_id
    where pp.created_at >= v_from and pp.created_at < v_to
      and (v_kind = 'all' or v_kind = 'premium')
      and (v_status is null or pp.status = v_status)
    union all
    select o.id, 'marketplace'::text as kind, o.order_no as reference,
           bp.display_name as user_name, o.total_cents, o.currency, o.payment_status as status,
           o.payment_method as provider, o.created_at
    from public.marketplace_orders o
    left join public.profiles bp on bp.id = o.buyer_id
    where o.created_at >= v_from and o.created_at < v_to
      and (v_kind = 'all' or v_kind = 'marketplace')
      and (v_status is null or o.payment_status = v_status)
  )
  select count(*) into v_total from tx;

  with tx as (
    select pp.id, 'premium'::text as kind, 'PRM-' || left(pp.id::text, 8) as reference,
           pr.display_name as user_name, pp.amount_cents, pp.currency, pp.status,
           pp.provider, pp.created_at
    from public.premium_payments pp
    left join public.profiles pr on pr.id = pp.user_id
    where pp.created_at >= v_from and pp.created_at < v_to
      and (v_kind = 'all' or v_kind = 'premium')
      and (v_status is null or pp.status = v_status)
    union all
    select o.id, 'marketplace'::text as kind, o.order_no as reference,
           bp.display_name as user_name, o.total_cents, o.currency, o.payment_status as status,
           o.payment_method as provider, o.created_at
    from public.marketplace_orders o
    left join public.profiles bp on bp.id = o.buyer_id
    where o.created_at >= v_from and o.created_at < v_to
      and (v_kind = 'all' or v_kind = 'marketplace')
      and (v_status is null or o.payment_status = v_status)
  )
  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', tx.id,
      'kind', tx.kind,
      'reference', tx.reference,
      'user_name', tx.user_name,
      'amount_cents', tx.amount_cents,
      'currency', tx.currency,
      'status', tx.status,
      'provider', tx.provider,
      'created_at', tx.created_at
    ) as item, tx.created_at
    from tx
    order by tx.created_at desc
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

revoke all on function public.admin_marketplace_overview() from public, anon;
grant execute on function public.admin_marketplace_overview() to authenticated;

revoke all on function public.admin_order_detail(uuid) from public, anon;
grant execute on function public.admin_order_detail(uuid) to authenticated;

revoke all on function public.admin_order_action(uuid, text, text, bigint) from public, anon;
grant execute on function public.admin_order_action(uuid, text, text, bigint) to authenticated;

revoke all on function public.admin_commission_settings_list() from public, anon;
grant execute on function public.admin_commission_settings_list() to authenticated;

revoke all on function public.admin_commission_set(integer, uuid, text) from public, anon;
grant execute on function public.admin_commission_set(integer, uuid, text) to authenticated;

revoke all on function public.admin_finance_overview(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_finance_overview(timestamptz, timestamptz) to authenticated;

revoke all on function public.admin_finance_transactions(text, text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.admin_finance_transactions(text, text, timestamptz, timestamptz, integer, integer) to authenticated;

revoke all on function public.tz_apply_order_commission() from public, anon, authenticated;
