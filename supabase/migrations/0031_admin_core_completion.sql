-- =====================================================================
-- 0030 — Admin core completion: identity, role assignment and reporting
--
-- These functions were referenced by the admin client/read models but were
-- never created in 0024–0029. This migration is additive: it does not drop or
-- rewrite user, payment or order data.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------
create or replace function public.has_all_permissions(p_codes text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(bool_and(public.has_permission(code)), true)
  from unnest(coalesce(p_codes, array[]::text[])) as code;
$$;

revoke all on function public.has_all_permissions(text[]) from public, anon;
grant execute on function public.has_all_permissions(text[]) to authenticated, service_role;

-- Report permissions are consumed by the overview/report RPCs. The base role
-- catalog predates them, so make sure every operational role can open the
-- reports that match its remit.
insert into public.admin_permissions (code, description_tr) values
  ('report.view',      'Rapor kataloğunu ve önizlemeleri görüntüleme'),
  ('report.users',     'Kullanıcı ve tutundurma raporlarını görüntüleme'),
  ('report.content',   'Sosyal içerik ve Reels raporlarını görüntüleme'),
  ('report.analytics', 'Ticaret, finans ve sistem raporlarını görüntüleme'),
  ('report.download',  'Yetkili raporları CSV/Excel olarak dışa aktarma')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'report.view'), ('admin', 'report.users'), ('admin', 'report.content'),
  ('admin', 'report.analytics'), ('admin', 'report.download'),
  ('moderator', 'report.view'), ('moderator', 'report.content'),
  ('support_agent', 'report.view'),
  ('finance_officer', 'report.view'), ('finance_officer', 'report.analytics'),
  ('finance_officer', 'report.download'),
  ('security_officer', 'report.view'), ('security_officer', 'report.analytics'),
  ('market_manager', 'report.analytics'),
  ('analyst', 'report.view'), ('analyst', 'report.users'), ('analyst', 'report.content'),
  ('analyst', 'report.analytics'), ('analyst', 'report.download')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Current staff identity (the admin shell and every screen gate on this)
-- ---------------------------------------------------------------------
create or replace function public.admin_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_roles text[];
  v_role_names text[];
  v_permissions text[];
begin
  if v_uid is null then
    return jsonb_build_object(
      'is_admin', false,
      'roles', '[]'::jsonb,
      'role_names', '[]'::jsonb,
      'permissions', '[]'::jsonb
    );
  end if;

  select coalesce(array_agg(a.role_key order by a.role_key), array[]::text[])
  into v_roles
  from public.user_role_assignments a
  where a.user_id = v_uid
    and (a.expires_at is null or a.expires_at > now());

  select coalesce(array_agg(r.name order by r.rank desc), array[]::text[])
  into v_role_names
  from public.user_role_assignments a
  join public.roles r on r.key = a.role_key
  where a.user_id = v_uid
    and (a.expires_at is null or a.expires_at > now());

  select coalesce(array_agg(p.code order by p.code), array[]::text[])
  into v_permissions
  from public.admin_permissions p
  where public.has_permission(p.code);

  return jsonb_build_object(
    'is_admin', coalesce(array_length(v_permissions, 1), 0) > 0,
    'user_id', v_uid,
    'display_name', (select coalesce(display_name, username::text) from public.profiles where id = v_uid),
    'username', (select username::text from public.profiles where id = v_uid),
    'roles', to_jsonb(v_roles),
    'role_names', to_jsonb(v_role_names),
    'permissions', to_jsonb(v_permissions)
  );
end;
$$;

revoke all on function public.admin_me() from public, anon;
grant execute on function public.admin_me() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Assign a staff role (the missing counterpart of admin_revoke_role)
-- ---------------------------------------------------------------------
create or replace function public.admin_assign_role(
  p_user_id uuid,
  p_role_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.tz_admin_require('admin.manage', true);
  v_role text := nullif(btrim(coalesce(p_role_key, '')), '');
  v_existing boolean;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = '22023';
  end if;

  if v_role is null or not exists (select 1 from public.roles where key = v_role) then
    raise exception 'unknown_role' using errcode = '22023';
  end if;

  -- Only roles that actually grant administrative authority can be assigned
  -- from the staff screen. Regular user/seller membership is handled elsewhere.
  if v_role <> 'super_admin'
     and not exists (select 1 from public.admin_role_permissions rp where rp.role_key = v_role) then
    raise exception 'not_staff_role' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.account_status <> 'deleted'
  ) then
    raise exception 'user_not_found' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.user_role_assignments a
    where a.user_id = p_user_id and a.role_key = v_role
      and (a.expires_at is null or a.expires_at > now())
  ) into v_existing;

  if v_existing then
    raise exception 'role_already_assigned' using errcode = '22023';
  end if;

  insert into public.user_role_assignments (user_id, role_key, granted_by)
  values (p_user_id, v_role, v_actor)
  on conflict (user_id, role_key) do update
    set granted_by = excluded.granted_by,
        granted_at = now(),
        expires_at = null;

  perform public.tz_admin_audit(
    'admin.role_assigned',
    'Yönetici rolü atandı',
    'profile',
    p_user_id::text,
    jsonb_build_object('role', v_role, 'assigned_by', v_actor),
    'success'
  );

  return jsonb_build_object('user_id', p_user_id, 'role_key', v_role, 'assigned', true);
end;
$$;

revoke all on function public.admin_assign_role(uuid, text) from public, anon;
grant execute on function public.admin_assign_role(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Report catalog storage
-- ---------------------------------------------------------------------
create table if not exists public.report_catalog (
  key                  text primary key,
  title_tr             text not null,
  description_tr       text not null,
  category             text not null,
  columns              jsonb not null default '[]'::jsonb,
  filters              jsonb not null default '{}'::jsonb,
  sensitive            boolean not null default false,
  required_permissions text[] not null default array['report.view']::text[],
  sort_order           integer not null default 100,
  available            boolean not null default true,
  created_at           timestamptz not null default now()
);

alter table public.report_catalog enable row level security;
revoke all on table public.report_catalog from anon, authenticated;

create table if not exists public.report_access_logs (
  id             bigserial primary key,
  job_id         uuid,
  actor_user_id  uuid references auth.users(id) on delete set null,
  action         text not null,
  report_key     text not null,
  metadata_safe  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table public.report_access_logs enable row level security;
revoke all on table public.report_access_logs from anon, authenticated;
create index if not exists report_access_logs_key_created_idx
  on public.report_access_logs (report_key, created_at desc);

insert into public.report_catalog
  (key, title_tr, description_tr, category, columns, filters, sensitive, required_permissions, sort_order)
values
  (
    'user_growth', 'Kullanıcı Büyümesi',
    'Günlük yeni kayıt, doğrulanmış hesap ve toplam kullanıcı eğrisi.',
    'users',
    '[{"key":"day","label":"Tarih","width":110},{"key":"new_users","label":"Yeni kullanıcı","width":140},{"key":"verified_users","label":"Doğrulanmış","width":140},{"key":"total_users","label":"Toplam kullanıcı","width":150}]'::jsonb,
    '{}'::jsonb, false, array['report.view','report.users']::text[], 10
  ),
  (
    'user_retention', 'Kullanıcı Tutundurma',
    'Kayıt ayına göre 30 gün içinde yeniden aktif olan kullanıcı oranı.',
    'users',
    '[{"key":"cohort","label":"Kohort","width":110},{"key":"cohort_users","label":"Kohort kullanıcı","width":150},{"key":"retained_users","label":"Tutundurulan","width":140},{"key":"retention_pct","label":"Tutundurma %","width":120}]'::jsonb,
    '{}'::jsonb, false, array['report.view','report.users']::text[], 20
  ),
  (
    'social_engagement', 'Sosyal Etkileşim',
    'Günlük gönderi, beğeni, yorum ve paylaşım hacmi.',
    'social',
    '[{"key":"day","label":"Tarih","width":110},{"key":"posts","label":"Gönderi","width":100},{"key":"likes","label":"Beğeni","width":100},{"key":"comments","label":"Yorum","width":100},{"key":"shares","label":"Paylaşım","width":100}]'::jsonb,
    '{}'::jsonb, false, array['report.view','report.content']::text[], 30
  ),
  (
    'reels_performance', 'Reels Performansı',
    'Günlük Reels üretimi, izlenme, beğeni ve yorum performansı.',
    'social',
    '[{"key":"day","label":"Tarih","width":110},{"key":"reels","label":"Reels","width":100},{"key":"views","label":"İzlenme","width":100},{"key":"likes","label":"Beğeni","width":100},{"key":"comments","label":"Yorum","width":100}]'::jsonb,
    '{}'::jsonb, false, array['report.view','report.content']::text[], 40
  ),
  (
    'marketplace_sales', 'Marketplace Satışları',
    'Günlük sipariş, GMV, komisyon ve tamamlanan sipariş sayısı.',
    'marketplace',
    '[{"key":"day","label":"Tarih","width":110},{"key":"orders","label":"Sipariş","width":100},{"key":"gmv_cents","label":"GMV (kuruş)","width":130},{"key":"commission_cents","label":"Komisyon (kuruş)","width":150},{"key":"completed","label":"Tamamlanan","width":120}]'::jsonb,
    '{}'::jsonb, true, array['report.view','report.analytics']::text[], 50
  ),
  (
    'moderation_summary', 'Moderasyon Özeti',
    'Şikâyetlerin durum, öncelik ve çocuk güvenliği kırılımı.',
    'operations',
    '[{"key":"status_code","label":"Durum","width":130},{"key":"reports","label":"Şikâyet","width":100},{"key":"critical","label":"Kritik","width":100},{"key":"child_safety","label":"Çocuk güvenliği","width":150},{"key":"avg_hours","label":"Ort. süre (sa)","width":130}]'::jsonb,
    '{}'::jsonb, false, array['report.view']::text[], 60
  ),
  (
    'support_performance', 'Destek Performansı',
    'Personele göre talep, çözüm ve ilk yanıt süresi.',
    'operations',
    '[{"key":"agent","label":"Personel","width":160},{"key":"tickets","label":"Talep","width":100},{"key":"resolved","label":"Çözülen","width":100},{"key":"avg_response_hours","label":"Ort. yanıt (sa)","width":140}]'::jsonb,
    '{}'::jsonb, false, array['report.view']::text[], 70
  ),
  (
    'finance_summary', 'Finans Özeti',
    'Günlük premium ve marketplace geliri, komisyon ve iade.',
    'finance',
    '[{"key":"day","label":"Tarih","width":110},{"key":"premium_cents","label":"Premium (kuruş)","width":150},{"key":"marketplace_cents","label":"Marketplace (kuruş)","width":160},{"key":"commission_cents","label":"Komisyon (kuruş)","width":150},{"key":"refund_cents","label":"İade (kuruş)","width":130}]'::jsonb,
    '{}'::jsonb, true, array['report.view','report.analytics']::text[], 80
  ),
  (
    'system_performance', 'Sistem Performansı',
    'Günlük sistem hatası, kritik hata ve açık hata sayısı.',
    'system',
    '[{"key":"day","label":"Tarih","width":110},{"key":"errors","label":"Hata","width":100},{"key":"critical","label":"Kritik","width":100},{"key":"open","label":"Açık","width":100}]'::jsonb,
    '{}'::jsonb, false, array['report.view','report.analytics']::text[], 90
  )
on conflict (key) do update
  set title_tr = excluded.title_tr,
      description_tr = excluded.description_tr,
      category = excluded.category,
      columns = excluded.columns,
      filters = excluded.filters,
      sensitive = excluded.sensitive,
      required_permissions = excluded.required_permissions,
      sort_order = excluded.sort_order,
      available = true;

-- ---------------------------------------------------------------------
-- Report query dispatcher
-- ---------------------------------------------------------------------
create or replace function public.admin_report_query(
  p_key text,
  p_from timestamptz,
  p_to timestamptz,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('report.view', false);
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_catalog public.report_catalog%rowtype;
  v_rows jsonb := '[]'::jsonb;
begin
  if v_to < v_from then
    raise exception 'invalid_date_range' using errcode = '22023';
  end if;
  if v_to - v_from > interval '400 days' then
    raise exception 'date_range_too_large' using errcode = '22023';
  end if;

  select * into v_catalog
  from public.report_catalog
  where key = p_key and available;

  if not found then
    raise exception 'unknown_report' using errcode = '22023';
  end if;

  if not public.has_all_permissions(v_catalog.required_permissions) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_key = 'user_growth' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) into v_rows
    from (
      select d.day::date as day,
             coalesce(n.new_users, 0) as new_users,
             coalesce(v.verified_users, 0) as verified_users,
             coalesce(c.total_users, 0) as total_users
      from generate_series(v_from::date, v_to::date, interval '1 day') d(day)
      left join (
        select created_at::date as day, count(*) as new_users
        from public.profiles
        where created_at >= v_from and created_at <= v_to
        group by 1
      ) n on n.day = d.day
      left join (
        select created_at::date as day, count(*) as verified_users
        from public.profiles
        where is_verified and created_at >= v_from and created_at <= v_to
        group by 1
      ) v on v.day = d.day
      left join (
        select d2.day::date as day,
               (select count(*) from public.profiles p
                where p.created_at < d2.day + interval '1 day') as total_users
        from generate_series(v_from::date, v_to::date, interval '1 day') d2(day)
      ) c on c.day = d.day
      order by d.day
      limit v_limit offset v_offset
    ) x;

  elsif p_key = 'user_retention' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.cohort desc), '[]'::jsonb) into v_rows
    from (
      select to_char(date_trunc('month', p.created_at), 'YYYY-MM') as cohort,
             count(*) as cohort_users,
             count(*) filter (
               where exists (
                 select 1 from public.activity_events e
                 where e.actor_user_id = p.id
                   and e.occurred_at >= p.created_at
                   and e.occurred_at <= p.created_at + interval '30 days'
               )
             ) as retained_users,
             round(
               (count(*) filter (
                 where exists (
                   select 1 from public.activity_events e
                   where e.actor_user_id = p.id
                     and e.occurred_at >= p.created_at
                     and e.occurred_at <= p.created_at + interval '30 days'
                 )
               ))::numeric * 100 / nullif(count(*), 0),
               1
             ) as retention_pct
      from public.profiles p
      where p.created_at >= v_from and p.created_at <= v_to
        and p.account_status <> 'deleted'
      group by 1
      order by 1 desc
      limit v_limit offset v_offset
    ) x;

  elsif p_key = 'social_engagement' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) into v_rows
    from (
      select d.day::date as day,
             coalesce(p.posts, 0) as posts,
             coalesce(l.likes, 0) as likes,
             coalesce(c.comments, 0) as comments,
             coalesce(s.shares, 0) as shares
      from generate_series(v_from::date, v_to::date, interval '1 day') d(day)
      left join (
        select created_at::date as day, count(*) as posts
        from public.posts where created_at >= v_from and created_at <= v_to
        group by 1
      ) p on p.day = d.day
      left join (
        select created_at::date as day, count(*) as likes
        from public.post_likes where created_at >= v_from and created_at <= v_to
        group by 1
      ) l on l.day = d.day
      left join (
        select created_at::date as day, count(*) as comments
        from public.post_comments where created_at >= v_from and created_at <= v_to
        group by 1
      ) c on c.day = d.day
      left join (
        select created_at::date as day, sum(share_count) as shares
        from public.posts where created_at >= v_from and created_at <= v_to
        group by 1
      ) s on s.day = d.day
      order by d.day
      limit v_limit offset v_offset
    ) x;

  elsif p_key = 'reels_performance' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) into v_rows
    from (
      select d.day::date as day,
             coalesce(r.reels, 0) as reels,
             coalesce(v.views, 0) as views,
             coalesce(l.likes, 0) as likes,
             coalesce(c.comments, 0) as comments
      from generate_series(v_from::date, v_to::date, interval '1 day') d(day)
      left join (
        select created_at::date as day, count(*) as reels
        from public.reels where created_at >= v_from and created_at <= v_to
        group by 1
      ) r on r.day = d.day
      left join (
        select viewed_at::date as day, count(*) as views
        from public.reel_views where viewed_at >= v_from and viewed_at <= v_to
        group by 1
      ) v on v.day = d.day
      left join (
        select created_at::date as day, count(*) as likes
        from public.reel_likes where created_at >= v_from and created_at <= v_to
        group by 1
      ) l on l.day = d.day
      left join (
        select created_at::date as day, count(*) as comments
        from public.reel_comments where created_at >= v_from and created_at <= v_to
        group by 1
      ) c on c.day = d.day
      order by d.day
      limit v_limit offset v_offset
    ) x;

  elsif p_key = 'marketplace_sales' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) into v_rows
    from (
      select d.day::date as day,
             coalesce(o.orders, 0) as orders,
             coalesce(o.gmv_cents, 0) as gmv_cents,
             coalesce(o.commission_cents, 0) as commission_cents,
             coalesce(o.completed, 0) as completed
      from generate_series(v_from::date, v_to::date, interval '1 day') d(day)
      left join (
        select created_at::date as day, count(*) as orders,
               sum(total_cents) as gmv_cents,
               sum(commission_cents) as commission_cents,
               count(*) filter (where status = 'completed') as completed
        from public.marketplace_orders
        where created_at >= v_from and created_at <= v_to
        group by 1
      ) o on o.day = d.day
      order by d.day
      limit v_limit offset v_offset
    ) x;

  elsif p_key = 'moderation_summary' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.reports desc), '[]'::jsonb) into v_rows
    from (
      select coalesce(status_code, 'unknown') as status_code,
             count(*) as reports,
             count(*) filter (where priority = 'critical') as critical,
             count(*) filter (where is_child_safety) as child_safety,
             round(avg(extract(epoch from (coalesce(closed_at, now()) - created_at)))::numeric / 3600, 1) as avg_hours
      from public.user_reports
      where created_at >= v_from and created_at <= v_to
      group by 1
      order by 2 desc
      limit v_limit offset v_offset
    ) x;

  elsif p_key = 'support_performance' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.tickets desc), '[]'::jsonb) into v_rows
    from (
      select coalesce(p.display_name, p.username::text, 'Atanmamış') as agent,
             count(*) as tickets,
             count(*) filter (where t.status_code in ('resolved', 'closed')) as resolved,
             round(avg(
               extract(epoch from (t.first_response_at - t.created_at))
             )::numeric / 3600, 1) as avg_response_hours
      from public.support_tickets t
      left join public.profiles p on p.id = t.assigned_to
      where t.created_at >= v_from and t.created_at <= v_to
      group by 1
      order by 2 desc
      limit v_limit offset v_offset
    ) x;

  elsif p_key = 'finance_summary' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) into v_rows
    from (
      select d.day::date as day,
             coalesce(pp.amount_cents, 0) as premium_cents,
             coalesce(mo.amount_cents, 0) as marketplace_cents,
             coalesce(mo.commission_cents, 0) as commission_cents,
             coalesce(rf.amount_cents, 0) as refund_cents
      from generate_series(v_from::date, v_to::date, interval '1 day') d(day)
      left join (
        select paid_at::date as day, sum(amount_cents) as amount_cents
        from public.premium_payments
        where status = 'paid' and paid_at >= v_from and paid_at <= v_to
        group by 1
      ) pp on pp.day = d.day
      left join (
        select created_at::date as day, sum(total_cents) as amount_cents,
               sum(commission_cents) as commission_cents
        from public.marketplace_orders
        where payment_status = 'paid' and created_at >= v_from and created_at <= v_to
        group by 1
      ) mo on mo.day = d.day
      left join (
        select created_at::date as day, sum(amount_cents) as amount_cents
        from public.marketplace_refunds
        where status in ('approved', 'processed')
          and created_at >= v_from and created_at <= v_to
        group by 1
      ) rf on rf.day = d.day
      order by d.day
      limit v_limit offset v_offset
    ) x;

  elsif p_key = 'system_performance' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) into v_rows
    from (
      select d.day::date as day,
             coalesce(e.errors, 0) as errors,
             coalesce(e.critical, 0) as critical,
             coalesce(e.open, 0) as open
      from generate_series(v_from::date, v_to::date, interval '1 day') d(day)
      left join (
        select occurred_at::date as day, count(*) as errors,
               count(*) filter (where severity in ('critical', 'fatal', 'error')) as critical,
               count(*) filter (where resolved_at is null) as open
        from public.system_errors
        where occurred_at >= v_from and occurred_at <= v_to
        group by 1
      ) e on e.day = d.day
      order by d.day
      limit v_limit offset v_offset
    ) x;
  end if;

  return jsonb_build_object(
    'columns', v_catalog.columns,
    'rows', v_rows,
    'total', jsonb_array_length(v_rows),
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.admin_report_query(text, timestamptz, timestamptz, jsonb, integer, integer)
  from public, anon;
grant execute on function public.admin_report_query(text, timestamptz, timestamptz, jsonb, integer, integer)
  to authenticated, service_role;

commit;
