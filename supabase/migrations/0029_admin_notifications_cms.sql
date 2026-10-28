-- =====================================================================
-- 0028 — Notification campaigns, content/CMS pages, announcements
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Audience resolution
-- Only used by SECURITY DEFINER campaign functions; never callable by clients.
-- ---------------------------------------------------------------------
create or replace function public.tz_campaign_audience(p_audience jsonb)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text := lower(coalesce(p_audience->>'type', 'all'));
  v_value text := nullif(btrim(coalesce(p_audience->>'value', '')), '');
begin
  if p_audience is null or jsonb_typeof(p_audience) <> 'object' then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;

  if v_type = 'all' then
    return query
      select p.id from public.profiles p
      where p.account_status = 'active'
      limit 25000;
  elsif v_type in ('ios', 'android') then
    return query
      select distinct d.user_id
      from public.user_devices d
      join public.profiles p on p.id = d.user_id
      where d.platform = v_type
        and d.notifications_enabled = true
        and p.account_status = 'active'
      limit 25000;
  elsif v_type = 'country' then
    if v_value is null then raise exception 'audience_value_required' using errcode='22023'; end if;
    return query
      select p.id from public.profiles p
      where p.account_status = 'active'
        and upper(coalesce(p.country_code, '')) = upper(v_value)
      limit 25000;
  elsif v_type = 'city' then
    if v_value is null then raise exception 'audience_value_required' using errcode='22023'; end if;
    return query
      select p.id from public.profiles p
      where p.account_status = 'active'
        and p.city ilike v_value
      limit 25000;
  elsif v_type = 'language' then
    if v_value is null then raise exception 'audience_value_required' using errcode='22023'; end if;
    return query
      select p.id
      from public.profiles p
      join public.user_preferences up on up.user_id = p.id
      where p.account_status = 'active'
        and lower(coalesce(up.locale, 'tr')) = lower(v_value)
      limit 25000;
  elsif v_type = 'role' then
    if v_value is null then raise exception 'audience_value_required' using errcode='22023'; end if;
    return query
      select distinct a.user_id
      from public.user_role_assignments a
      join public.profiles p on p.id = a.user_id
      where a.role_key = v_value
        and p.account_status = 'active'
      limit 25000;
  elsif v_type = 'verified' then
    return query
      select p.id from public.profiles p
      where p.account_status = 'active' and p.is_verified = true
      limit 25000;
  elsif v_type = 'new' then
    return query
      select p.id from public.profiles p
      where p.account_status = 'active' and p.created_at >= now() - interval '7 days'
      limit 25000;
  elsif v_type = 'premium' then
    return query
      select distinct s.user_id
      from public.premium_subscriptions s
      join public.profiles p on p.id = s.user_id
      where s.status = 'active' and p.account_status = 'active'
      limit 25000;
  elsif v_type = 'creators' then
    return query
      select distinct p.id
      from public.profiles p
      where p.account_status = 'active'
        and (
          exists (select 1 from public.posts x where x.user_id = p.id)
          or exists (select 1 from public.reels r where r.user_id = p.id)
        )
      limit 25000;
  elsif v_type = 'sellers' then
    return query
      select distinct p.id
      from public.profiles p
      where p.account_status = 'active'
        and exists (select 1 from public.marketplace_listings l where l.seller_id = p.id)
      limit 25000;
  elsif v_type = 'user' then
    if v_value is null then raise exception 'audience_value_required' using errcode='22023'; end if;
    return query
      select p.id from public.profiles p
      where p.id::text = lower(v_value) and p.account_status = 'active';
  else
    raise exception 'unsupported_audience_type' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.tz_campaign_audience(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Internal delivery. Returns counts; callers decide status/audit.
-- ---------------------------------------------------------------------
create or replace function public.tz_send_campaign(p_campaign_id uuid)
returns table (sent_count integer, target_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.notification_campaigns%rowtype;
  v_sent integer := 0;
  v_target integer := 0;
begin
  select * into v_campaign
  from public.notification_campaigns
  where id = p_campaign_id
  for update;

  if not found then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
  if v_campaign.status = 'sent' then
    raise exception 'campaign_already_sent' using errcode = '22023';
  end if;

  select count(*) into v_target from public.tz_campaign_audience(v_campaign.audience);

  if v_target = 0 then
    raise exception 'campaign_has_no_recipients' using errcode = '22023';
  end if;

  insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route, campaign_id)
  select a, null, 'system', v_campaign.title, v_campaign.body, 'campaign', v_campaign.id::text, v_campaign.route, v_campaign.id
  from public.tz_campaign_audience(v_campaign.audience) a;

  get diagnostics v_sent = row_count;

  update public.notification_campaigns
  set status = 'sent',
      sent_at = now(),
      target_count = v_target,
      sent_count = v_sent,
      failed_count = greatest(v_target - v_sent, 0),
      updated_at = now()
  where id = p_campaign_id;

  return query select v_sent, v_target;
end;
$$;

revoke all on function public.tz_send_campaign(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Campaign administration
-- ---------------------------------------------------------------------
create or replace function public.admin_campaigns_list(
  p_status text default null,
  p_search text default null,
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
  v_admin uuid := public.tz_admin_require('notify.view', false);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.notification_campaigns c
  where (p_status is null or c.status = p_status)
    and (p_search is null or c.title ilike '%' || p_search || '%' or c.body ilike '%' || p_search || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'title', x.title,
    'body', x.body,
    'image_url', x.image_url,
    'route', x.route,
    'audience', x.audience,
    'status', x.status,
    'scheduled_at', x.scheduled_at,
    'sent_at', x.sent_at,
    'target_count', x.target_count,
    'sent_count', x.sent_count,
    'failed_count', x.failed_count,
    'created_by', x.created_by,
    'created_by_name', x.created_by_name,
    'created_at', x.created_at
  ) order by x.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select c.*, p.display_name as created_by_name
    from public.notification_campaigns c
    left join public.profiles p on p.id = c.created_by
    where (p_status is null or c.status = p_status)
      and (p_search is null or c.title ilike '%' || p_search || '%' or c.body ilike '%' || p_search || '%')
    order by c.created_at desc
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'stats', jsonb_build_object(
      'draft', (select count(*) from public.notification_campaigns where status = 'draft'),
      'scheduled', (select count(*) from public.notification_campaigns where status = 'scheduled'),
      'sent', (select count(*) from public.notification_campaigns where status = 'sent'),
      'sent_30d', (select count(*) from public.notification_campaigns where status = 'sent' and sent_at >= now() - interval '30 days'),
      'delivered_30d', (select coalesce(sum(sent_count), 0) from public.notification_campaigns where status = 'sent' and sent_at >= now() - interval '30 days'),
      'failed_30d', (select coalesce(sum(failed_count), 0) from public.notification_campaigns where status = 'sent' and sent_at >= now() - interval '30 days')
    )
  );
end;
$$;

create or replace function public.admin_campaign_audience_preview(p_audience jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('notify.view', false);
  v_count integer;
begin
  select count(*) into v_count from public.tz_campaign_audience(p_audience);
  return jsonb_build_object('count', v_count, 'capped', v_count >= 25000);
end;
$$;

create or replace function public.admin_campaign_save(
  p_id uuid,
  p_title text,
  p_body text,
  p_image_url text,
  p_route text,
  p_audience jsonb,
  p_scheduled_at timestamptz,
  p_send_now boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('notify.send', false);
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_route text := nullif(btrim(coalesce(p_route, '')), '');
  v_image text := nullif(btrim(coalesce(p_image_url, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_existing public.notification_campaigns%rowtype;
  v_status text;
  v_count integer := 0;
  v_target integer := 0;
  v_result jsonb;
begin
  if length(v_title) < 2 or length(v_title) > 160 then
    raise exception 'title_length_invalid' using errcode = '22023';
  end if;
  if length(v_body) < 1 or length(v_body) > 1200 then
    raise exception 'body_length_invalid' using errcode = '22023';
  end if;
  if v_route is not null and (length(v_route) > 300 or left(v_route, 1) <> '/') then
    raise exception 'route_invalid' using errcode = '22023';
  end if;
  if v_image is not null and v_image !~* '^https?://' then
    raise exception 'image_url_invalid' using errcode = '22023';
  end if;
  if p_audience is null or not (p_audience ? 'type') then
    raise exception 'audience_required' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) < 3 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_existing from public.notification_campaigns where id = p_id for update;
    if not found then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
    if v_existing.status in ('sent', 'sending') then
      raise exception 'campaign_immutable_after_send' using errcode = '22023';
    end if;
  end if;

  select count(*) into v_count from public.tz_campaign_audience(p_audience);

  if coalesce(p_send_now, false) then
    if v_count = 0 then raise exception 'campaign_has_no_recipients' using errcode = '22023'; end if;
    v_status := 'sending';
  elsif p_scheduled_at is not null and p_scheduled_at > now() then
    v_status := 'scheduled';
  else
    v_status := 'draft';
  end if;

  if p_id is null then
    insert into public.notification_campaigns
      (title, body, image_url, route, audience, status, scheduled_at, target_count, created_by)
    values
      (v_title, v_body, v_image, v_route, p_audience, v_status,
       case when v_status = 'scheduled' then p_scheduled_at else null end, v_count, v_admin)
    returning id into p_id;
  else
    update public.notification_campaigns
    set title = v_title,
        body = v_body,
        image_url = v_image,
        route = v_route,
        audience = p_audience,
        status = v_status,
        scheduled_at = case when v_status = 'scheduled' then p_scheduled_at else null end,
        target_count = v_count,
        updated_at = now()
    where id = p_id;
  end if;

  perform public.tz_admin_audit(
    'notification.campaign.save', 'Bildirim kampanyası kaydedildi', 'notification_campaign', p_id::text,
    jsonb_build_object('title', v_title, 'audience', p_audience, 'status', v_status,
                       'scheduled_at', p_scheduled_at, 'recipients', v_count)
      || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end,
    'success'
  );

  if coalesce(p_send_now, false) then
    select tz.sent_count, tz.target_count into v_count, v_target
    from public.tz_send_campaign(p_id) tz;

    perform public.tz_admin_audit(
      'notification.campaign.send', 'Bildirim kampanyası gönderildi', 'notification_campaign', p_id::text,
      jsonb_build_object('sent', v_count, 'target', v_target)
        || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end,
      'success'
    );
  end if;

  select to_jsonb(c) into v_result
  from public.notification_campaigns c where c.id = p_id;

  return v_result;
end;
$$;

create or replace function public.admin_campaign_cancel(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('notify.send', false);
  v_campaign public.notification_campaigns%rowtype;
begin
  select * into v_campaign from public.notification_campaigns where id = p_id for update;
  if not found then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
  if v_campaign.status not in ('draft', 'scheduled') then
    raise exception 'campaign_cannot_be_cancelled' using errcode = '22023';
  end if;

  update public.notification_campaigns
  set status = 'cancelled', updated_at = now()
  where id = p_id;

  perform public.tz_admin_audit(
    'notification.campaign.cancel', 'Bildirim kampanyası iptal edildi', 'notification_campaign', p_id::text,
    jsonb_build_object('title', v_campaign.title, 'previous_status', v_campaign.status)
      || case when nullif(btrim(coalesce(p_reason, '')), '') is not null
              then jsonb_build_object('reason', btrim(p_reason)) else '{}'::jsonb end,
    'success'
  );

  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end;
$$;

-- Scheduler entrypoint (pg_cron / service role only).
create or replace function public.admin_run_due_campaigns()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.notification_campaigns
    where status = 'scheduled' and scheduled_at is not null and scheduled_at <= now()
    order by scheduled_at
    limit 20
  loop
    begin
      perform public.tz_send_campaign(v_id);
      v_count := v_count + 1;
    exception when others then
      update public.notification_campaigns
      set status = 'failed', updated_at = now()
      where id = v_id;
    end;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.admin_run_due_campaigns() from public, anon, authenticated;
grant execute on function public.admin_run_due_campaigns() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule(
        'tz-notification-campaigns',
        '*/5 * * * *',
        $cron$select public.admin_run_due_campaigns();$cron$
      );
    exception when others then
      raise notice 'cron schedule skipped: %', sqlerrm;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- CMS pages
-- ---------------------------------------------------------------------
create or replace function public.admin_cms_pages_list(
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.view', false);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.content_pages p
  where (p_status is null or p.status = p_status)
    and (p_search is null or p.slug ilike '%' || p_search || '%' or p.title ilike '%' || p_search || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', x.slug, 'title', x.title, 'locale', x.locale, 'status', x.status,
    'version', x.version, 'published_at', x.published_at,
    'updated_at', x.updated_at, 'updated_by_name', x.updated_by_name,
    'excerpt', left(regexp_replace(x.body, '\s+', ' ', 'g'), 180)
  ) order by x.updated_at desc), '[]'::jsonb)
  into v_items
  from (
    select p.*, pr.display_name as updated_by_name
    from public.content_pages p
    left join public.profiles pr on pr.id = p.updated_by
    where (p_status is null or p.status = p_status)
      and (p_search is null or p.slug ilike '%' || p_search || '%' or p.title ilike '%' || p_search || '%')
    order by p.updated_at desc
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

create or replace function public.admin_cms_page_get(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.view', false);
  v_page public.content_pages%rowtype;
  v_versions jsonb;
begin
  select * into v_page from public.content_pages where slug = p_slug;
  if not found then raise exception 'page_not_found' using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'version', v.version, 'title', v.title, 'status', v.status,
    'created_at', v.created_at, 'created_by_name', pr.display_name
  ) order by v.version desc), '[]'::jsonb)
  into v_versions
  from public.content_page_versions v
  left join public.profiles pr on pr.id = v.created_by
  where v.slug = p_slug;

  return jsonb_build_object(
    'slug', v_page.slug,
    'title', v_page.title,
    'body', v_page.body,
    'locale', v_page.locale,
    'status', v_page.status,
    'version', v_page.version,
    'published_at', v_page.published_at,
    'created_at', v_page.created_at,
    'updated_at', v_page.updated_at,
    'versions', v_versions
  );
end;
$$;

create or replace function public.admin_cms_page_save(
  p_slug text,
  p_title text,
  p_body text,
  p_locale text,
  p_publish boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.manage', false);
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := coalesce(p_body, '');
  v_locale text := lower(btrim(coalesce(nullif(p_locale, ''), 'tr')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_existing public.content_pages%rowtype;
  v_version integer;
  v_status text;
  v_published_at timestamptz;
  v_old jsonb := '{}'::jsonb;
begin
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,79}$' then
    raise exception 'slug_invalid' using errcode = '22023';
  end if;
  if length(v_title) < 3 or length(v_title) > 160 then
    raise exception 'title_length_invalid' using errcode = '22023';
  end if;
  if length(v_body) > 60000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;
  if v_locale !~ '^[a-z]{2}(-[a-z]{2})?$' then
    raise exception 'locale_invalid' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) < 3 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;

  select * into v_existing from public.content_pages where slug = v_slug for update;

  if found then
    v_version := v_existing.version + 1;
    v_status := case when coalesce(p_publish, false) then 'published' else 'draft' end;
    v_published_at := case when coalesce(p_publish, false) then coalesce(v_existing.published_at, now()) else v_existing.published_at end;
    v_old := jsonb_build_object('title', v_existing.title, 'status', v_existing.status, 'version', v_existing.version);
  else
    v_version := 1;
    v_status := case when coalesce(p_publish, false) then 'published' else 'draft' end;
    v_published_at := case when coalesce(p_publish, false) then now() else null end;
  end if;

  insert into public.content_pages (slug, title, body, locale, status, version, published_at, updated_at, updated_by)
  values (v_slug, v_title, v_body, v_locale, v_status, v_version, v_published_at, now(), v_admin)
  on conflict (slug) do update
  set title = excluded.title,
      body = excluded.body,
      locale = excluded.locale,
      status = excluded.status,
      version = excluded.version,
      published_at = excluded.published_at,
      updated_at = now(),
      updated_by = v_admin;

  insert into public.content_page_versions (slug, version, title, body, status, created_by)
  values (v_slug, v_version, v_title, v_body, v_status, v_admin);

  perform public.tz_admin_audit(
    'cms.page.save', 'İçerik sayfası kaydedildi', 'content_page', v_slug,
    jsonb_build_object(
      'old', v_old,
      'new', jsonb_build_object('title', v_title, 'status', v_status, 'version', v_version, 'locale', v_locale)
    ) || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end,
    'success'
  );

  return public.admin_cms_page_get(v_slug);
end;
$$;

create or replace function public.admin_cms_page_archive(p_slug text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.manage', false);
  v_page public.content_pages%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_page from public.content_pages where slug = p_slug for update;
  if not found then raise exception 'page_not_found' using errcode = 'P0002'; end if;

  update public.content_pages
  set status = 'archived', updated_at = now(), updated_by = v_admin
  where slug = p_slug;

  insert into public.content_page_versions (slug, version, title, body, status, created_by)
  values (v_page.slug, v_page.version + 1, v_page.title, v_page.body, 'archived', v_admin);

  perform public.tz_admin_audit(
    'cms.page.archive', 'İçerik sayfası arşivlendi', 'content_page', p_slug,
    jsonb_build_object('title', v_page.title, 'status', 'archived', 'reason', v_reason), 'success'
  );

  return jsonb_build_object('slug', p_slug, 'status', 'archived');
end;
$$;

-- ---------------------------------------------------------------------
-- System announcements (banner inside the app)
-- ---------------------------------------------------------------------
create or replace function public.admin_announcements_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.view', false);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'title', a.title, 'body', a.body, 'level', a.level,
        'starts_at', a.starts_at, 'ends_at', a.ends_at, 'is_active', a.is_active,
        'created_at', a.created_at, 'created_by_name', p.display_name,
        'live', (a.is_active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now()))
      ) order by a.created_at desc)
      from public.system_announcements a
      left join public.profiles p on p.id = a.created_by
    ), '[]'::jsonb),
    'stats', jsonb_build_object(
      'active', (select count(*) from public.system_announcements where is_active),
      'live', (select count(*) from public.system_announcements where is_active and starts_at <= now() and (ends_at is null or ends_at > now())),
      'scheduled', (select count(*) from public.system_announcements where is_active and starts_at > now())
    )
  );
end;
$$;

create or replace function public.admin_announcement_save(
  p_id uuid,
  p_title text,
  p_body text,
  p_level text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_is_active boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.manage', false);
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_level text := lower(coalesce(nullif(p_level, ''), 'info'));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_result jsonb;
begin
  if length(v_title) < 3 or length(v_title) > 160 then
    raise exception 'title_length_invalid' using errcode = '22023';
  end if;
  if length(v_body) < 3 or length(v_body) > 2000 then
    raise exception 'body_length_invalid' using errcode = '22023';
  end if;
  if v_level not in ('info', 'warning', 'critical') then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_ends_at <= coalesce(p_starts_at, now()) then
    raise exception 'end_before_start' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) < 3 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.system_announcements (title, body, level, starts_at, ends_at, is_active, created_by)
    values (v_title, v_body, v_level, coalesce(p_starts_at, now()), p_ends_at, coalesce(p_is_active, true), v_admin)
    returning id into p_id;
  else
    update public.system_announcements
    set title = v_title,
        body = v_body,
        level = v_level,
        starts_at = coalesce(p_starts_at, starts_at),
        ends_at = p_ends_at,
        is_active = coalesce(p_is_active, is_active)
    where id = p_id;
    if not found then raise exception 'announcement_not_found' using errcode = 'P0002'; end if;
  end if;

  perform public.tz_admin_audit(
    'announcement.save', 'Sistem duyurusu kaydedildi', 'system_announcement', p_id::text,
    jsonb_build_object('title', v_title, 'level', v_level, 'is_active', p_is_active,
                       'starts_at', p_starts_at, 'ends_at', p_ends_at)
      || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end,
    'success'
  );

  select to_jsonb(a) into v_result from public.system_announcements a where a.id = p_id;
  return v_result;
end;
$$;

create or replace function public.admin_announcement_toggle(p_id uuid, p_active boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.manage', false);
  v_old boolean;
begin
  select is_active into v_old from public.system_announcements where id = p_id for update;
  if not found then raise exception 'announcement_not_found' using errcode = 'P0002'; end if;

  update public.system_announcements set is_active = p_active where id = p_id;

  perform public.tz_admin_audit(
    'announcement.toggle', 'Sistem duyurusu durumu değiştirildi', 'system_announcement', p_id::text,
    jsonb_build_object('old', v_old, 'new', p_active)
      || case when nullif(btrim(coalesce(p_reason, '')), '') is not null
              then jsonb_build_object('reason', btrim(p_reason)) else '{}'::jsonb end,
    'success'
  );

  return jsonb_build_object('id', p_id, 'is_active', p_active);
end;
$$;

-- ---------------------------------------------------------------------
-- Public reads (app clients)
-- ---------------------------------------------------------------------
create or replace function public.content_page_get(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_page public.content_pages%rowtype;
begin
  select * into v_page
  from public.content_pages
  where slug = lower(btrim(p_slug)) and status = 'published';

  if not found then return null; end if;

  return jsonb_build_object(
    'slug', v_page.slug, 'title', v_page.title, 'body', v_page.body,
    'locale', v_page.locale, 'version', v_page.version,
    'published_at', v_page.published_at, 'updated_at', v_page.updated_at
  );
end;
$$;

create or replace function public.app_active_announcements()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'title', a.title, 'body', a.body, 'level', a.level,
    'starts_at', a.starts_at, 'ends_at', a.ends_at
  ) order by a.starts_at desc), '[]'::jsonb)
  from public.system_announcements a
  where a.is_active
    and a.starts_at <= now()
    and (a.ends_at is null or a.ends_at > now());
$$;

-- ---------------------------------------------------------------------
-- Shell badges (used by the persistent admin navigation)
-- ---------------------------------------------------------------------
create or replace function public.admin_shell_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.admin_permissions p where public.has_permission(p.code)) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'pending_reports', case when public.has_permission('safety.report.view') then
      (select count(*) from public.user_reports
        where status_code in ('received', 'under_review')) else 0 end,
    'critical_reports', case when public.has_permission('safety.child.view') then
      (select count(*) from public.user_reports
        where is_child_safety and status_code in ('received', 'under_review')) else 0 end,
    'open_tickets', case when public.has_permission('support.view') then
      (select count(*) from public.support_tickets
        where status_code not in ('resolved', 'closed')) else 0 end,
    'pending_approvals', case when public.has_permission('feature.view') then
      (select count(*) from public.admin_approval_requests
        where status = 'pending' and (public.is_super_admin() or requested_by = v_uid)) else 0 end,
    'open_errors', case when public.has_permission('system.view') then
      (select count(*) from public.system_errors where resolved_at is null) else 0 end,
    'unread_notifications', (
      select count(*) from public.notifications where user_id = v_uid and read_at is null
    )
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on function public.admin_campaigns_list(text, text, integer, integer) to authenticated;
grant execute on function public.admin_campaign_audience_preview(jsonb) to authenticated;
grant execute on function public.admin_campaign_save(uuid, text, text, text, text, jsonb, timestamptz, boolean, text) to authenticated;
grant execute on function public.admin_campaign_cancel(uuid, text) to authenticated;
grant execute on function public.admin_cms_pages_list(text, text, integer, integer) to authenticated;
grant execute on function public.admin_cms_page_get(text) to authenticated;
grant execute on function public.admin_cms_page_save(text, text, text, text, boolean, text) to authenticated;
grant execute on function public.admin_cms_page_archive(text, text) to authenticated;
grant execute on function public.admin_announcements_list() to authenticated;
grant execute on function public.admin_announcement_save(uuid, text, text, text, timestamptz, timestamptz, boolean, text) to authenticated;
grant execute on function public.admin_announcement_toggle(uuid, boolean, text) to authenticated;
grant execute on function public.admin_shell_counts() to authenticated;
grant execute on function public.content_page_get(text) to anon, authenticated;
grant execute on function public.app_active_announcements() to anon, authenticated;

commit;
