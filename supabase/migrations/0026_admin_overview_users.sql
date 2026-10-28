-- 0025: Admin overview dashboard + advanced user management
--
-- All metrics are computed from real tables. Where the product has no data
-- source (for example push tokens or app version metadata), the API returns
-- an empty series instead of inventing numbers.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Live overview
-- ---------------------------------------------------------------------------

create or replace function public.admin_overview(
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
  v_span interval;
  v_prev_from timestamptz;
  v_prev_to timestamptz;
  v_new_users bigint;
  v_prev_new_users bigint;
  v_posts bigint;
  v_prev_posts bigint;
  v_orders bigint;
  v_prev_orders bigint;
  v_revenue bigint;
  v_prev_revenue bigint;
  v_users_total bigint;
  v_mau bigint;
  v_reels_total bigint;
  v_reels_today bigint;
  v_pending_reports bigint;
  v_open_tickets bigint;
  v_completed_orders bigint;
  v_verified_volume bigint;
  v_pending_orders bigint;
  v_refunds bigint;
  v_failed_payments bigint;
begin
  perform public.tz_admin_require('report.view');

  if v_to < v_from then
    raise exception 'invalid_date_range' using errcode = '22023';
  end if;
  if v_to - v_from > interval '366 days' then
    raise exception 'date_range_too_large' using errcode = '22023';
  end if;

  v_span := v_to - v_from;
  v_prev_to := v_from;
  v_prev_from := v_from - v_span;

  select count(*) into v_new_users
  from public.profiles where created_at >= v_from and created_at < v_to;

  select count(*) into v_prev_new_users
  from public.profiles where created_at >= v_prev_from and created_at < v_prev_to;

  select count(*) into v_posts
  from public.posts where created_at >= v_from and created_at < v_to;

  select count(*) into v_prev_posts
  from public.posts where created_at >= v_prev_from and created_at < v_prev_to;

  select count(*) into v_orders
  from public.marketplace_orders where created_at >= v_from and created_at < v_to;

  select count(*) into v_prev_orders
  from public.marketplace_orders where created_at >= v_prev_from and created_at < v_prev_to;

  select
    coalesce((select sum(amount_cents) from public.premium_payments
              where status = 'paid' and paid_at >= v_from and paid_at < v_to), 0)
    + coalesce((select sum(total_cents) from public.marketplace_orders
                where payment_status = 'paid' and created_at >= v_from and created_at < v_to), 0)
  into v_revenue;

  select
    coalesce((select sum(amount_cents) from public.premium_payments
              where status = 'paid' and paid_at >= v_prev_from and paid_at < v_prev_to), 0)
    + coalesce((select sum(total_cents) from public.marketplace_orders
                where payment_status = 'paid' and created_at >= v_prev_from and created_at < v_prev_to), 0)
  into v_prev_revenue;

  select count(*) into v_users_total
  from public.profiles where account_status <> 'deleted';

  select count(distinct actor_user_id) into v_mau
  from public.activity_events
  where actor_user_id is not null and occurred_at > now() - interval '30 days';

  select count(*) into v_reels_total from public.reels;

  select count(*) into v_reels_today
  from public.reel_views where viewed_at >= current_date;

  select count(*) into v_pending_reports
  from public.user_reports where status_code in ('received', 'under_review');

  select count(*) into v_open_tickets
  from public.support_tickets where status_code not in ('resolved', 'closed');

  select count(*) into v_completed_orders
  from public.marketplace_orders where status = 'completed';

  select
    coalesce((select sum(amount_cents) from public.premium_payments
              where status = 'paid' and paid_at >= v_from and paid_at < v_to), 0)
    + coalesce((select sum(total_cents) from public.marketplace_orders
                where payment_status = 'paid' and created_at >= v_from and created_at < v_to), 0)
  into v_verified_volume;

  select count(*) into v_pending_orders
  from public.marketplace_orders
  where status in ('requested', 'confirmed', 'shipped') or payment_status = 'pending';

  select coalesce(sum(amount_cents), 0) into v_refunds
  from public.marketplace_refunds
  where status in ('approved', 'processed') and created_at >= v_from and created_at < v_to;

  select count(*) into v_failed_payments
  from public.premium_payments
  where status <> 'paid' and created_at >= v_from and created_at < v_to;

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'stats', jsonb_build_object(
      'users_total', v_users_total,
      'users_new', v_new_users,
      'dau', (select count(distinct actor_user_id) from public.activity_events
              where actor_user_id is not null and occurred_at > now() - interval '1 day'),
      'wau', (select count(distinct actor_user_id) from public.activity_events
              where actor_user_id is not null and occurred_at > now() - interval '7 days'),
      'mau', v_mau,
      'online_estimate', (select count(distinct actor_user_id) from public.activity_events
                          where actor_user_id is not null and occurred_at > now() - interval '5 minutes'),
      'posts_total', (select count(*) from public.posts),
      'posts_period', v_posts,
      'reels_total', v_reels_total,
      'reels_views_today', v_reels_today,
      'active_listings', (select count(*) from public.marketplace_listings where status = 'active'),
      'orders_period', v_orders,
      'orders_total', (select count(*) from public.marketplace_orders),
      'completed_orders', v_completed_orders,
      'pending_orders', v_pending_orders,
      'pending_reports', v_pending_reports,
      'open_tickets', v_open_tickets,
      'verified_payment_volume_cents', v_verified_volume,
      'revenue_cents', v_revenue,
      'refunded_cents', v_refunds,
      'failed_payments', v_failed_payments
    ),
    'deltas', jsonb_build_object(
      'users_new', case when v_prev_new_users = 0 then null
                        else round(((v_new_users - v_prev_new_users)::numeric / v_prev_new_users) * 100, 1) end,
      'posts', case when v_prev_posts = 0 then null
                    else round(((v_posts - v_prev_posts)::numeric / v_prev_posts) * 100, 1) end,
      'orders', case when v_prev_orders = 0 then null
                     else round(((v_orders - v_prev_orders)::numeric / v_prev_orders) * 100, 1) end,
      'revenue', case when v_prev_revenue = 0 then null
                      else round(((v_revenue - v_prev_revenue)::numeric / v_prev_revenue) * 100, 1) end
    ),
    'growth', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'new_users', coalesce(u.c, 0),
        'active_users', coalesce(a.c, 0),
        'posts', coalesce(p.c, 0),
        'reel_views', coalesce(rv.c, 0),
        'orders', coalesce(o.c, 0),
        'revenue_cents', coalesce(rev.c, 0)
      ) order by d.day)
      from (
        select generate_series(v_from::date, v_to::date, interval '1 day')::date as day
      ) d
      left join (
        select created_at::date as day, count(*) as c
        from public.profiles
        where created_at >= v_from and created_at < v_to
        group by 1
      ) u on u.day = d.day
      left join (
        select occurred_at::date as day, count(distinct actor_user_id) as c
        from public.activity_events
        where actor_user_id is not null and occurred_at >= v_from and occurred_at < v_to
        group by 1
      ) a on a.day = d.day
      left join (
        select created_at::date as day, count(*) as c
        from public.posts
        where created_at >= v_from and created_at < v_to
        group by 1
      ) p on p.day = d.day
      left join (
        select viewed_at::date as day, count(*) as c
        from public.reel_views
        where viewed_at >= v_from and viewed_at < v_to
        group by 1
      ) rv on rv.day = d.day
      left join (
        select created_at::date as day, count(*) as c
        from public.marketplace_orders
        where created_at >= v_from and created_at < v_to
        group by 1
      ) o on o.day = d.day
      left join (
        select day, sum(amount) as c from (
          select paid_at::date as day, sum(amount_cents) as amount
          from public.premium_payments
          where status = 'paid' and paid_at >= v_from and paid_at < v_to
          group by 1
          union all
          select created_at::date as day, sum(total_cents) as amount
          from public.marketplace_orders
          where payment_status = 'paid' and created_at >= v_from and created_at < v_to
          group by 1
        ) x group by day
      ) rev on rev.day = d.day
    ), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(jsonb_build_object('label', x.label, 'value', x.value) order by x.value desc)
      from (
        select coalesce(nullif(country_code, ''), 'Bilinmiyor') as label, count(*) as value
        from public.profiles
        where account_status <> 'deleted'
        group by 1
        order by 2 desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('label', x.label, 'value', x.value) order by x.value desc)
      from (
        select coalesce(nullif(city, ''), 'Bilinmiyor') as label, count(*) as value
        from public.profiles
        where account_status <> 'deleted'
        group by 1
        order by 2 desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object('label', x.label, 'value', x.value) order by x.value desc)
      from (
        select case platform when 'ios' then 'iOS' when 'android' then 'Android' else 'Web' end as label,
               count(*) as value
        from public.user_devices
        where last_seen_at > now() - interval '90 days'
        group by platform
      ) x
    ), '[]'::jsonb),
    'app_versions', coalesce((
      select jsonb_agg(jsonb_build_object('label', x.label, 'value', x.value) order by x.value desc)
      from (
        select coalesce(nullif(safe_metadata ->> 'app_version', ''), 'Bilinmiyor') as label,
               count(*) as value
        from public.activity_events
        where occurred_at > now() - interval '30 days'
        group by 1
        order by 2 desc
        limit 10
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. User list
-- ---------------------------------------------------------------------------

create or replace function public.admin_users_list(
  p_query text default null,
  p_status text default null,
  p_verified boolean default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_only_new boolean default false,
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
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  perform public.tz_admin_require('user.view');

  if v_status is not null and v_status not in ('active', 'restricted', 'suspended', 'deleted', 'banned', 'new') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  with base as (
    select
      p.id,
      p.username::text as username,
      p.display_name,
      p.first_name,
      p.last_name,
      u.email::text as email,
      p.avatar_path,
      p.is_verified,
      p.account_status,
      p.followers_count,
      p.following_count,
      p.posts_count,
      p.created_at,
      coalesce(pp.last_seen_at, p.updated_at) as last_seen_at,
      f.suspended_until,
      f.ban_reason,
      f.warning_count,
      case
        when p.account_status = 'suspended' and f.ban_reason is not null and f.suspended_until is null then 'banned'
        when p.account_status = 'suspended' then 'suspended'
        when p.account_status = 'restricted' then 'restricted'
        when p.account_status = 'deleted' then 'deleted'
        else 'active'
      end as status_label
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.profile_private pp on pp.user_id = p.id
    left join public.admin_user_flags f on f.user_id = p.id
    where (v_q is null
           or p.id::text = v_q
           or p.username::text ilike '%' || v_q || '%'
           or p.display_name ilike '%' || v_q || '%'
           or u.email::text ilike '%' || v_q || '%'
           or trim(concat_ws(' ', p.first_name, p.last_name)) ilike '%' || v_q || '%')
      and (v_status is null
           or v_status = 'new'
           or (v_status = 'banned' and p.account_status = 'suspended' and f.ban_reason is not null and f.suspended_until is null)
           or (v_status = 'suspended' and p.account_status = 'suspended' and not (f.ban_reason is not null and f.suspended_until is null))
           or (v_status = 'active' and p.account_status = 'active')
           or (v_status = 'restricted' and p.account_status = 'restricted')
           or (v_status = 'deleted' and p.account_status = 'deleted'))
      and (p_verified is null or p.is_verified = p_verified)
      and (p_from is null or p.created_at >= p_from)
      and (p_to is null or p.created_at < p_to)
      and (not coalesce(p_only_new, false) or p.created_at > now() - interval '7 days')
      and (v_status is distinct from 'new' or p.created_at > now() - interval '7 days')
  )
  select count(*) into v_total from base;

  with base as (
    select
      p.id,
      p.username::text as username,
      p.display_name,
      u.email::text as email,
      p.avatar_path,
      p.is_verified,
      p.account_status,
      p.followers_count,
      p.posts_count,
      p.created_at,
      coalesce(pp.last_seen_at, p.updated_at) as last_seen_at,
      f.suspended_until,
      f.ban_reason,
      f.warning_count,
      case
        when p.account_status = 'suspended' and f.ban_reason is not null and f.suspended_until is null then 'banned'
        when p.account_status = 'suspended' then 'suspended'
        when p.account_status = 'restricted' then 'restricted'
        when p.account_status = 'deleted' then 'deleted'
        else 'active'
      end as status_label
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.profile_private pp on pp.user_id = p.id
    left join public.admin_user_flags f on f.user_id = p.id
    where (v_q is null
           or p.id::text = v_q
           or p.username::text ilike '%' || v_q || '%'
           or p.display_name ilike '%' || v_q || '%'
           or u.email::text ilike '%' || v_q || '%'
           or trim(concat_ws(' ', p.first_name, p.last_name)) ilike '%' || v_q || '%')
      and (v_status is null
           or v_status = 'new'
           or (v_status = 'banned' and p.account_status = 'suspended' and f.ban_reason is not null and f.suspended_until is null)
           or (v_status = 'suspended' and p.account_status = 'suspended' and not (f.ban_reason is not null and f.suspended_until is null))
           or (v_status = 'active' and p.account_status = 'active')
           or (v_status = 'restricted' and p.account_status = 'restricted')
           or (v_status = 'deleted' and p.account_status = 'deleted'))
      and (p_verified is null or p.is_verified = p_verified)
      and (p_from is null or p.created_at >= p_from)
      and (p_to is null or p.created_at < p_to)
      and (not coalesce(p_only_new, false) or p.created_at > now() - interval '7 days')
      and (v_status is distinct from 'new' or p.created_at > now() - interval '7 days')
  )
  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      b.created_at,
      jsonb_build_object(
        'id', b.id,
        'username', b.username,
        'display_name', b.display_name,
        'email', b.email,
        'avatar_path', b.avatar_path,
        'is_verified', b.is_verified,
        'account_status', b.account_status,
        'status_label', b.status_label,
        'followers_count', b.followers_count,
        'posts_count', b.posts_count,
        'created_at', b.created_at,
        'last_seen_at', b.last_seen_at,
        'suspended_until', b.suspended_until,
        'ban_reason', b.ban_reason,
        'warning_count', b.warning_count,
        'reels_count', (select count(*) from public.reels r where r.author_id = b.id),
        'listings_count', (select count(*) from public.marketplace_listings l where l.seller_id = b.id),
        'report_count', (select count(*) from public.user_reports r
                         where r.target_owner_id = b.id and r.status_code in ('received', 'under_review'))
      ) as item
    from base b
    order by b.created_at desc
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. User detail
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  perform public.tz_admin_require('user.view');

  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'username', p.username::text,
      'display_name', p.display_name,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'email', u.email,
      'bio', p.bio,
      'city', p.city,
      'district', p.district,
      'country_code', p.country_code,
      'website', p.website,
      'avatar_path', p.avatar_path,
      'cover_path', p.cover_path,
      'is_verified', p.is_verified,
      'account_status', p.account_status,
      'created_at', p.created_at,
      'updated_at', p.updated_at,
      'last_seen_at', pp.last_seen_at,
      'deletion_requested_at', p.deletion_requested_at,
      'deletion_scheduled_at', p.deletion_scheduled_at,
      'followers_count', p.followers_count,
      'following_count', p.following_count,
      'posts_count', p.posts_count,
      'suspended_until', f.suspended_until,
      'ban_reason', f.ban_reason,
      'warning_count', coalesce(f.warning_count, 0),
      'last_warning_at', f.last_warning_at
    ),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role_key', a.role_key, 'name', r.name, 'granted_at', a.granted_at, 'expires_at', a.expires_at
      ) order by r.rank desc)
      from public.user_role_assignments a
      join public.roles r on r.key = a.role_key
      where a.user_id = p_user_id
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'posts', (select count(*) from public.posts where author_id = p_user_id),
      'reels', (select count(*) from public.reels where author_id = p_user_id),
      'stories', (select count(*) from public.stories where author_id = p_user_id),
      'listings', (select count(*) from public.marketplace_listings where seller_id = p_user_id),
      'orders_buyer', (select count(*) from public.marketplace_orders where buyer_id = p_user_id),
      'orders_seller', (select count(*) from public.marketplace_orders where seller_id = p_user_id),
      'reports_against', (select count(*) from public.user_reports where target_owner_id = p_user_id),
      'reports_filed', (select count(*) from public.user_reports where reporter_id = p_user_id),
      'tickets', (select count(*) from public.support_tickets where user_id = p_user_id),
      'messages_sent', (select count(*) from public.messages where sender_id = p_user_id and deleted_at is null)
    ),
    'recent_posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'body', left(coalesce(x.body, ''), 200), 'created_at', x.created_at,
        'moderation_status', x.moderation_status, 'like_count', x.like_count, 'comment_count', x.comment_count,
        'media_path', (select m.storage_path from public.post_media m where m.post_id = x.id order by m.sort_order limit 1)
      ) order by x.created_at desc)
      from (select * from public.posts where author_id = p_user_id order by created_at desc limit 5) x
    ), '[]'::jsonb),
    'recent_reels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'caption', left(coalesce(x.caption, ''), 200), 'created_at', x.created_at,
        'moderation_status', x.moderation_status, 'view_count', x.view_count,
        'cover_path', x.cover_path, 'video_path', x.video_path
      ) order by x.created_at desc)
      from (select * from public.reels where author_id = p_user_id order by created_at desc limit 5) x
    ), '[]'::jsonb),
    'recent_listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'price_cents', x.price_cents, 'currency', x.currency,
        'status', x.status, 'moderation_status', x.moderation_status, 'created_at', x.created_at
      ) order by x.created_at desc)
      from (select * from public.marketplace_listings where seller_id = p_user_id order by created_at desc limit 5) x
    ), '[]'::jsonb),
    'recent_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'report_no', x.report_no, 'target_type', x.target_type, 'target_id', x.target_id,
        'reason_category', x.reason_category, 'status_code', x.status_code, 'priority', x.priority,
        'is_child_safety', x.is_child_safety, 'created_at', x.created_at
      ) order by x.created_at desc)
      from (
        select * from public.user_reports
        where target_owner_id = p_user_id
        order by created_at desc limit 10
      ) x
    ), '[]'::jsonb),
    'recent_tickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'ticket_no', x.ticket_no, 'subject', x.subject, 'status_code', x.status_code,
        'priority', x.priority, 'created_at', x.created_at
      ) order by x.created_at desc)
      from (select * from public.support_tickets where user_id = p_user_id order by created_at desc limit 5) x
    ), '[]'::jsonb),
    'recent_actions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'action_code', x.action_code, 'action_label', x.action_label_tr,
        'actor_name', ap.display_name, 'created_at', x.created_at
      ) order by x.created_at desc)
      from (
        select * from public.admin_audit_logs
        where target_id = p_user_id::text
        order by created_at desc limit 10
      ) x
      left join public.profiles ap on ap.id = x.actor_admin_id
    ), '[]'::jsonb)
  )
  into v_payload
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.profile_private pp on pp.user_id = p.id
  left join public.admin_user_flags f on f.user_id = p.id
  where p.id = p_user_id;

  if v_payload is null then
    raise exception 'user_not_found' using errcode = '22023';
  end if;

  return v_payload;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. User actions
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_action(
  p_user_id uuid,
  p_action text,
  p_reason text default null,
  p_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('user.action', true);
  v_action text := lower(trim(coalesce(p_action, '')));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_row public.profiles%rowtype;
  v_is_target_super boolean;
  v_old_status text;
  v_new_status text;
  v_until timestamptz;
  v_title text;
  v_body text;
begin
  if p_user_id = v_uid then
    raise exception 'cannot_action_self' using errcode = '42501';
  end if;

  if v_action not in (
    'warn', 'suspend', 'ban', 'restrict', 'reactivate', 'verify', 'unverify',
    'remove_avatar', 'request_deletion', 'restore_deleted'
  ) then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  if v_action not in ('reactivate', 'verify', 'unverify') and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_row from public.profiles where id = p_user_id;
  if not found then
    raise exception 'user_not_found' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.user_role_assignments a
    where a.user_id = p_user_id and a.role_key = 'super_admin'
      and (a.expires_at is null or a.expires_at > now())
  ) into v_is_target_super;

  if v_is_target_super and not public.is_super_admin() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  v_old_status := v_row.account_status;

  if v_action = 'warn' then
    insert into public.admin_user_flags (user_id, warning_count, last_warning_at, updated_by, updated_at)
    values (p_user_id, 1, now(), v_uid, now())
    on conflict (user_id) do update
      set warning_count = public.admin_user_flags.warning_count + 1,
          last_warning_at = now(),
          updated_by = v_uid,
          updated_at = now();

    perform public.tz_notify(
      p_user_id, null, 'security', 'Hesabına uyarı verildi',
      left(v_reason, 500), 'profile', p_user_id::text, '/notifications'
    );

    perform public.tz_admin_audit(
      'user.warned', 'Kullanıcıya uyarı verildi', 'profile', p_user_id::text,
      jsonb_build_object('reason', left(v_reason, 400))
    );

    return jsonb_build_object('user_id', p_user_id, 'action', 'warn', 'account_status', v_row.account_status);
  end if;

  if v_action = 'suspend' then
    if p_days is null or p_days < 1 or p_days > 3650 then
      raise exception 'invalid_days' using errcode = '22023';
    end if;
    v_new_status := 'suspended';
    v_until := now() + make_interval(days => p_days);
    v_title := 'Hesabın geçici olarak askıya alındı';
    v_body := 'Hesabın ' || p_days || ' gün süreyle askıya alındı. Gerekçe: ' || left(v_reason, 400);
  elsif v_action = 'ban' then
    v_new_status := 'suspended';
    v_until := null;
    v_title := 'Hesabın kalıcı olarak kapatıldı';
    v_body := 'Hesabın kalıcı olarak kapatıldı. Gerekçe: ' || left(v_reason, 400);
  elsif v_action = 'restrict' then
    v_new_status := 'restricted';
    v_title := 'Hesabın kısıtlandı';
    v_body := 'Hesabında bazı özellikler kısıtlandı. Gerekçe: ' || left(v_reason, 400);
  elsif v_action = 'reactivate' then
    v_new_status := 'active';
    v_title := 'Hesabın yeniden etkinleştirildi';
    v_body := 'Hesabın yeniden etkinleştirildi.';
  elsif v_action = 'request_deletion' then
    v_new_status := 'deleted';
    v_title := 'Hesap silme süreci başlatıldı';
    v_body := 'Hesabın için silme süreci başlatıldı. Gerekçe: ' || left(v_reason, 400);
  elsif v_action = 'restore_deleted' then
    v_new_status := 'active';
    v_title := 'Hesabın geri yüklendi';
    v_body := 'Hesabın yeniden etkinleştirildi.';
  else
    v_new_status := v_old_status;
  end if;

  if v_action in ('verify', 'unverify') then
    update public.profiles
       set is_verified = (v_action = 'verify'),
           updated_at = now()
     where id = p_user_id;

    perform public.tz_admin_audit(
      case when v_action = 'verify' then 'user.verified' else 'user.unverified' end,
      case when v_action = 'verify' then 'Kullanıcı doğrulandı' else 'Kullanıcı doğrulaması kaldırıldı' end,
      'profile', p_user_id::text, '{}'::jsonb
    );

    return jsonb_build_object('user_id', p_user_id, 'action', v_action, 'is_verified', v_action = 'verify');
  end if;

  if v_action = 'remove_avatar' then
    update public.profiles set avatar_path = null, updated_at = now() where id = p_user_id;
    perform public.tz_notify(
      p_user_id, null, 'security', 'Profil görselin kaldırıldı',
      'Profil görselin moderasyon kuralları gereği kaldırıldı.', 'profile', p_user_id::text, '/settings/edit-profile'
    );
    perform public.tz_admin_audit(
      'user.avatar_removed', 'Profil görseli kaldırıldı', 'profile', p_user_id::text,
      jsonb_build_object('reason', left(v_reason, 400))
    );
    return jsonb_build_object('user_id', p_user_id, 'action', v_action);
  end if;

  update public.profiles
     set account_status = v_new_status,
         deletion_requested_at = case
           when v_action = 'request_deletion' then now()
           when v_action in ('reactivate', 'restore_deleted') then null
           else deletion_requested_at
         end,
         deletion_scheduled_at = case
           when v_action = 'request_deletion' then now() + interval '30 days'
           when v_action in ('reactivate', 'restore_deleted') then null
           else deletion_scheduled_at
         end,
         updated_at = now()
   where id = p_user_id;

  insert into public.admin_user_flags (user_id, suspended_until, ban_reason, updated_by, updated_at)
  values (
    p_user_id,
    v_until,
    case when v_action in ('ban', 'suspend') then left(v_reason, 500) else null end,
    v_uid,
    now()
  )
  on conflict (user_id) do update
    set suspended_until = excluded.suspended_until,
        ban_reason = excluded.ban_reason,
        updated_by = v_uid,
        updated_at = now();

  if v_action in ('reactivate', 'restore_deleted') then
    update public.admin_user_flags
       set suspended_until = null, ban_reason = null
     where user_id = p_user_id;
  end if;

  perform public.tz_notify(
    p_user_id, null,
    case when v_action in ('restrict', 'suspend', 'ban') then 'security' else 'system' end,
    v_title, v_body, 'profile', p_user_id::text, '/notifications'
  );

  perform public.tz_admin_audit(
    'user.' || v_action,
    case v_action
      when 'suspend' then 'Kullanıcı askıya alındı'
      when 'ban' then 'Kullanıcı kalıcı olarak yasaklandı'
      when 'restrict' then 'Kullanıcı kısıtlandı'
      when 'reactivate' then 'Kullanıcı yeniden etkinleştirildi'
      when 'request_deletion' then 'Hesap silme süreci başlatıldı'
      when 'restore_deleted' then 'Silinen hesap geri yüklendi'
      else 'Kullanıcı işlemi'
    end,
    'profile', p_user_id::text,
    jsonb_build_object(
      'old_status', v_old_status,
      'new_status', v_new_status,
      'suspended_until', v_until,
      'reason', left(coalesce(v_reason, ''), 400)
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'action', v_action,
    'account_status', v_new_status,
    'suspended_until', v_until
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

revoke all on function public.admin_overview(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_overview(timestamptz, timestamptz) to authenticated;

revoke all on function public.admin_users_list(text, text, boolean, timestamptz, timestamptz, boolean, integer, integer) from public, anon;
grant execute on function public.admin_users_list(text, text, boolean, timestamptz, timestamptz, boolean, integer, integer) to authenticated;

revoke all on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;

revoke all on function public.admin_user_action(uuid, text, text, integer) from public, anon;
grant execute on function public.admin_user_action(uuid, text, text, integer) to authenticated;
