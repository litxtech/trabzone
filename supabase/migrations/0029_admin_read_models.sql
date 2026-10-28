-- =====================================================================
-- 0029 — Admin read models: report catalog, audit center, order table,
--        support reply templates
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Report catalog (permission filtered; no report SQL is exposed)
-- ---------------------------------------------------------------------
create or replace function public.admin_report_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('report.view', false);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', c.key,
        'title', c.title_tr,
        'description', c.description_tr,
        'category', c.category,
        'columns', c.columns,
        'filters', c.filters,
        'sensitive', c.sensitive,
        'required_permissions', c.required_permissions
      ) order by c.category, c.sort_order)
      from public.report_catalog c
      where c.available
        and public.has_all_permissions(c.required_permissions)
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(distinct c.category)
      from public.report_catalog c
      where c.available and public.has_all_permissions(c.required_permissions)
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Audit center (immutable log, with safe before/after metadata)
-- ---------------------------------------------------------------------
create or replace function public.admin_audit_center(
  p_action_code text default null,
  p_target_type text default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('audit.view', false);
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_action text := nullif(btrim(coalesce(p_action_code, '')), '');
  v_target text := nullif(btrim(coalesce(p_target_type, '')), '');
  v_total bigint;
  v_items jsonb;
begin
  if v_to < v_from then
    raise exception 'invalid_date_range' using errcode = '22023';
  end if;

  select count(*) into v_total
  from public.admin_audit_logs l
  where l.created_at >= v_from and l.created_at <= v_to
    and (v_action is null or l.action_code = v_action)
    and (v_target is null or l.target_type = v_target)
    and (v_search is null or l.action_code ilike '%' || v_search || '%'
         or l.action_label_tr ilike '%' || v_search || '%'
         or l.target_id ilike '%' || v_search || '%'
         or l.metadata_safe::text ilike '%' || v_search || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'action_code', x.action_code,
    'action_label', x.action_label_tr,
    'target_type', x.target_type,
    'target_id', x.target_id,
    'outcome', x.outcome,
    'metadata', x.metadata_safe,
    'actor_name', x.actor_name,
    'created_at', x.created_at
  ) order by x.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select l.*, p.display_name as actor_name
    from public.admin_audit_logs l
    left join public.profiles p on p.id = l.actor_admin_id
    where l.created_at >= v_from and l.created_at <= v_to
      and (v_action is null or l.action_code = v_action)
      and (v_target is null or l.target_type = v_target)
      and (v_search is null or l.action_code ilike '%' || v_search || '%'
           or l.action_label_tr ilike '%' || v_search || '%'
           or l.target_id ilike '%' || v_search || '%'
           or l.metadata_safe::text ilike '%' || v_search || '%')
    order by l.created_at desc
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'actions', coalesce((
      select jsonb_agg(distinct a.action_code order by a.action_code)
      from public.admin_audit_logs a
      where a.created_at >= now() - interval '90 days'
    ), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(distinct a.target_type order by a.target_type)
      from public.admin_audit_logs a
      where a.created_at >= now() - interval '90 days' and a.target_type is not null
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Report export (permission-filtered, hard row cap, access audited)
-- ---------------------------------------------------------------------
create or replace function public.admin_report_export_query(
  p_key text,
  p_from timestamptz,
  p_to timestamptz,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 5000,
  p_offset integer default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('report.view', false);
  v_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 5000);
  v_result jsonb;
begin
  if not public.has_permission('report.download') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  v_result := public.admin_report_query(p_key, p_from, p_to, p_filters, v_limit, greatest(coalesce(p_offset, 0), 0));

  insert into public.report_access_logs (job_id, actor_user_id, action, report_key, metadata_safe)
  values (null, v_admin, 'export', p_key, jsonb_build_object('rows', jsonb_array_length(v_result->'rows')));

  perform public.tz_admin_audit(
    'report.exported', 'Rapor dışa aktarıldı', 'report', p_key,
    jsonb_build_object('rows', jsonb_array_length(v_result->'rows')),
    'success'
  );

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- Marketplace orders read model
-- ---------------------------------------------------------------------
create or replace function public.admin_orders_table(
  p_status text default null,
  p_query text default null,
  p_payment text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('market.orders.view', false);
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_payment text := nullif(btrim(coalesce(p_payment, '')), '');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.marketplace_orders o
  join public.profiles b on b.id = o.buyer_id
  join public.profiles s on s.id = o.seller_id
  where (v_status is null or o.status = v_status)
    and (v_payment is null or o.payment_status = v_payment)
    and (v_query is null or o.order_no ilike '%' || v_query || '%'
         or b.username::text ilike '%' || v_query || '%'
         or s.username::text ilike '%' || v_query || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'order_no', x.order_no,
    'status', x.status,
    'total_cents', x.total_cents,
    'currency', x.currency,
    'payment_method', x.payment_method,
    'payment_status', x.payment_status,
    'commission_cents', x.commission_cents,
    'refunded_cents', x.refunded_cents,
    'dispute_status', x.dispute_status,
    'created_at', x.created_at,
    'buyer_username', x.buyer_username,
    'seller_username', x.seller_username,
    'first_item', x.first_item,
    'item_count', x.item_count
  ) order by x.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select o.*, b.username::text as buyer_username, s.username::text as seller_username,
      (select i.title_snapshot from public.marketplace_order_items i where i.order_id = o.id order by i.id limit 1) as first_item,
      (select count(*) from public.marketplace_order_items i where i.order_id = o.id) as item_count
    from public.marketplace_orders o
    join public.profiles b on b.id = o.buyer_id
    join public.profiles s on s.id = o.seller_id
    where (v_status is null or o.status = v_status)
      and (v_payment is null or o.payment_status = v_payment)
      and (v_query is null or o.order_no ilike '%' || v_query || '%'
           or b.username::text ilike '%' || v_query || '%'
           or s.username::text ilike '%' || v_query || '%')
    order by o.created_at desc
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- ---------------------------------------------------------------------
-- Support reply templates
-- ---------------------------------------------------------------------
create table if not exists public.support_reply_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  body text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_reply_templates_title_len check (char_length(title) between 2 and 120),
  constraint support_reply_templates_body_len check (char_length(body) between 2 and 8000)
);

alter table public.support_reply_templates enable row level security;
revoke all on table public.support_reply_templates from anon, authenticated;

create or replace function public.admin_support_templates_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('support.view', false);
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'category', t.category, 'body', t.body,
      'is_active', t.is_active, 'updated_at', t.updated_at,
      'created_by_name', p.display_name
    ) order by t.is_active desc, t.updated_at desc)
    from public.support_reply_templates t
    left join public.profiles p on p.id = t.created_by
  ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_support_template_save(
  p_id uuid,
  p_title text,
  p_category text,
  p_body text,
  p_is_active boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('support.manage', false);
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_result jsonb;
begin
  if char_length(v_title) < 2 or char_length(v_title) > 120 then
    raise exception 'title_length_invalid' using errcode = '22023';
  end if;
  if char_length(v_body) < 2 or char_length(v_body) > 8000 then
    raise exception 'body_length_invalid' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) < 3 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.support_reply_templates (title, category, body, is_active, created_by)
    values (v_title, v_category, v_body, coalesce(p_is_active, true), v_admin)
    returning id into p_id;
  else
    update public.support_reply_templates
    set title = v_title, category = v_category, body = v_body,
        is_active = coalesce(p_is_active, true), updated_at = now()
    where id = p_id;
    if not found then raise exception 'template_not_found' using errcode = 'P0002'; end if;
  end if;

  perform public.tz_admin_audit(
    'support.template_saved', 'Destek yanıt şablonu kaydedildi', 'support_template', p_id::text,
    jsonb_build_object('title', v_title, 'category', v_category, 'is_active', p_is_active)
      || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end,
    'success'
  );

  select to_jsonb(t) into v_result from public.support_reply_templates t where t.id = p_id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on function public.admin_report_catalog() to authenticated;
grant execute on function public.admin_report_export_query(text, timestamptz, timestamptz, jsonb, integer, integer) to authenticated;
grant execute on function public.admin_audit_center(text, text, text, timestamptz, timestamptz, integer, integer) to authenticated;
grant execute on function public.admin_orders_table(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_support_templates_list() to authenticated;
grant execute on function public.admin_support_template_save(uuid, text, text, text, boolean, text) to authenticated;

commit;
