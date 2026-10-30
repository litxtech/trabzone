-- ---------------------------------------------------------------------------
-- 0197 — Maç bildirimleri: tercihler, teslimat kuyruğu, push ve geçmiş
--
-- Zincir: sports_ingest_fixture / tick / admin duyurusu → sports_notification_events
-- (fixture + dedupe_key tekil) → sports_fanout_step (uygulama içi + cihaz başına
-- push, imleçli) → sports-sync edge function → Expo Push API →
-- sports_push_report / receipts.
--
-- Rıza: tercih satırı olmayan veya `enabled = false` olan kullanıcıya hiçbir
-- maç bildirimi gönderilmez. TEST bildirimleri yalnızca testi başlatan admine
-- gider. Düzeltme bildirimi yalnızca asıl bildirimi almış kullanıcılara gider.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

alter table public.user_devices
  add column if not exists sports_enabled boolean not null default true;

create table if not exists public.sports_notification_preferences (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  enabled                boolean not null default false,
  reminder               boolean not null default true,
  lineups                boolean not null default true,
  kickoff                boolean not null default true,
  goal_for               boolean not null default true,
  goal_against           boolean not null default true,
  red_card               boolean not null default true,
  half_time              boolean not null default false,
  full_time              boolean not null default true,
  postponed              boolean not null default true,
  announcement           boolean not null default true,
  sound_enabled          boolean not null default true,
  quiet_hours_enabled    boolean not null default false,
  quiet_start_hour       smallint not null default 23 check (quiet_start_hour between 0 and 23),
  quiet_end_hour         smallint not null default 8 check (quiet_end_hour between 0 and 23),
  created_at             timestamptz not null default now(),
  preference_updated_at  timestamptz not null default now()
);
create index if not exists sports_notification_preferences_enabled_idx
  on public.sports_notification_preferences (user_id) where enabled;

create table if not exists public.sports_notification_mutes (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  fixture_id  bigint not null references public.sports_fixtures (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, fixture_id)
);

create table if not exists public.sports_notification_deliveries (
  id                     uuid primary key default gen_random_uuid(),
  notification_event_id  uuid not null references public.sports_notification_events (id) on delete cascade,
  user_id                uuid not null references public.profiles (id) on delete cascade,
  device_id              uuid references public.user_devices (id) on delete cascade,
  channel                text not null check (channel in ('in_app', 'push')),
  delivery_status        text not null default 'pending'
                         check (delivery_status in ('pending', 'sending', 'sent', 'delivered', 'failed',
                                                    'invalid_token', 'suppressed', 'expired')),
  suppressed_reason      text,
  notification_id        uuid references public.notifications (id) on delete set null,
  attempted_at           timestamptz,
  claimed_at             timestamptz,
  sent_at                timestamptz,
  receipt_checked_at     timestamptz,
  provider_ticket_id     text,
  provider_result        jsonb,
  retry_count            integer not null default 0,
  next_attempt_at        timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  constraint sports_notification_deliveries_device check ((channel = 'push') = (device_id is not null))
);
create unique index if not exists sports_deliveries_inapp_uidx
  on public.sports_notification_deliveries (notification_event_id, user_id) where channel = 'in_app';
create unique index if not exists sports_deliveries_push_uidx
  on public.sports_notification_deliveries (notification_event_id, device_id) where channel = 'push';
create index if not exists sports_deliveries_queue_idx
  on public.sports_notification_deliveries (created_at) where channel = 'push' and delivery_status = 'pending';
create index if not exists sports_deliveries_sending_idx
  on public.sports_notification_deliveries (claimed_at) where delivery_status = 'sending';
create index if not exists sports_deliveries_receipt_idx
  on public.sports_notification_deliveries (sent_at)
  where delivery_status = 'sent' and receipt_checked_at is null and provider_ticket_id is not null;
create index if not exists sports_deliveries_user_idx
  on public.sports_notification_deliveries (user_id, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['sports_notification_preferences', 'sports_notification_mutes', 'sports_notification_deliveries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Tercihler
-- ---------------------------------------------------------------------------
create or replace function public.sports_prefs_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  p public.sports_notification_preferences;
begin
  select * into p from public.sports_notification_preferences where user_id = v_uid;
  return jsonb_build_object(
    'saved', p.user_id is not null,
    'enabled', coalesce(p.enabled, false),
    'reminder', coalesce(p.reminder, true),
    'lineups', coalesce(p.lineups, true),
    'kickoff', coalesce(p.kickoff, true),
    'goal_for', coalesce(p.goal_for, true),
    'goal_against', coalesce(p.goal_against, true),
    'red_card', coalesce(p.red_card, true),
    'half_time', coalesce(p.half_time, false),
    'full_time', coalesce(p.full_time, true),
    'postponed', coalesce(p.postponed, true),
    'announcement', coalesce(p.announcement, true),
    'sound_enabled', coalesce(p.sound_enabled, true),
    'quiet_hours_enabled', coalesce(p.quiet_hours_enabled, false),
    'quiet_start_hour', coalesce(p.quiet_start_hour, 23),
    'quiet_end_hour', coalesce(p.quiet_end_hour, 8),
    'system_enabled', (select notifications_enabled from public.sports_settings where id = 1),
    'devices', (select count(*) from public.user_devices d
                 where d.user_id = v_uid and d.push_token is not null and d.invalidated_at is null
                   and d.notifications_enabled and d.sports_enabled)
  );
end;
$$;

create or replace function public.sports_prefs_set(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_start integer := coalesce((p_payload ->> 'quiet_start_hour')::integer, 23);
  v_end integer := coalesce((p_payload ->> 'quiet_end_hour')::integer, 8);
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if v_start not between 0 and 23 or v_end not between 0 and 23 then
    raise exception 'invalid_quiet_hours' using errcode = '22023';
  end if;
  perform public.safety_check_rate('sports_prefs_set', 40, interval '10 minutes');

  insert into public.sports_notification_preferences as p (
    user_id, enabled, reminder, lineups, kickoff, goal_for, goal_against, red_card, half_time, full_time,
    postponed, announcement, sound_enabled, quiet_hours_enabled, quiet_start_hour, quiet_end_hour, preference_updated_at
  ) values (
    v_uid,
    coalesce((p_payload ->> 'enabled')::boolean, false),
    coalesce((p_payload ->> 'reminder')::boolean, true),
    coalesce((p_payload ->> 'lineups')::boolean, true),
    coalesce((p_payload ->> 'kickoff')::boolean, true),
    coalesce((p_payload ->> 'goal_for')::boolean, true),
    coalesce((p_payload ->> 'goal_against')::boolean, true),
    coalesce((p_payload ->> 'red_card')::boolean, true),
    coalesce((p_payload ->> 'half_time')::boolean, false),
    coalesce((p_payload ->> 'full_time')::boolean, true),
    coalesce((p_payload ->> 'postponed')::boolean, true),
    coalesce((p_payload ->> 'announcement')::boolean, true),
    coalesce((p_payload ->> 'sound_enabled')::boolean, true),
    coalesce((p_payload ->> 'quiet_hours_enabled')::boolean, false),
    v_start, v_end, now()
  )
  on conflict (user_id) do update set
    enabled = excluded.enabled, reminder = excluded.reminder, lineups = excluded.lineups, kickoff = excluded.kickoff,
    goal_for = excluded.goal_for, goal_against = excluded.goal_against, red_card = excluded.red_card,
    half_time = excluded.half_time, full_time = excluded.full_time, postponed = excluded.postponed,
    announcement = excluded.announcement, sound_enabled = excluded.sound_enabled,
    quiet_hours_enabled = excluded.quiet_hours_enabled, quiet_start_hour = excluded.quiet_start_hour,
    quiet_end_hour = excluded.quiet_end_hour, preference_updated_at = now();

  return public.sports_prefs_get();
end;
$$;

create or replace function public.sports_fixture_mute(p_fixture bigint, p_muted boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_muted then
    insert into public.sports_notification_mutes (user_id, fixture_id) values (v_uid, p_fixture) on conflict do nothing;
  else
    delete from public.sports_notification_mutes where user_id = v_uid and fixture_id = p_fixture;
  end if;
  return jsonb_build_object('muted', p_muted);
end;
$$;

create or replace function public.sports_fixture_mute_get(p_fixture bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('muted', exists (
    select 1 from public.sports_notification_mutes where user_id = auth.uid() and fixture_id = p_fixture))
$$;

create or replace function public.sports_notification_history(p_limit integer default 30, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(q.item order by q.created_at desc)
      from (
        select jsonb_build_object(
                 'id', d.id, 'type', ne.type, 'title', ne.title, 'body', ne.body,
                 'route', ne.payload ->> 'route', 'fixture_id', ne.fixture_id, 'is_test', ne.is_test,
                 'created_at', d.created_at, 'read_at', n.read_at,
                 'push', (select jsonb_build_object(
                            'sent', count(*) filter (where pd.delivery_status in ('sent', 'delivered')),
                            'suppressed', count(*) filter (where pd.delivery_status = 'suppressed'),
                            'failed', count(*) filter (where pd.delivery_status in ('failed', 'invalid_token', 'expired')),
                            'pending', count(*) filter (where pd.delivery_status in ('pending', 'sending')))
                            from public.sports_notification_deliveries pd
                           where pd.notification_event_id = d.notification_event_id
                             and pd.user_id = v_uid and pd.channel = 'push')
               ) as item, d.created_at
          from public.sports_notification_deliveries d
          join public.sports_notification_events ne on ne.id = d.notification_event_id
          left join public.notifications n on n.id = d.notification_id
         where d.user_id = v_uid and d.channel = 'in_app'
         order by d.created_at desc
         limit v_limit offset greatest(coalesce(p_offset, 0), 0)
      ) q), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Dağıtım (service_role)
-- ---------------------------------------------------------------------------
create or replace function public.sports_fanout_step(p_batch integer default 2000)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.sports_settings;
  n public.sports_notification_events;
  f public.sports_fixtures;
  v_batch integer := least(greatest(coalesce(p_batch, 2000), 50), 10000);
  v_hour integer := extract(hour from now() at time zone 'Europe/Istanbul')::integer;
  v_cursor uuid;
  v_users integer;
  v_last uuid;
  v_inapp integer;
  v_push integer;
  v_supp integer;
  v_late boolean;
  v_orig uuid;
  v_route text;
  v_data jsonb;
begin
  select * into s from public.sports_settings where id = 1;

  select * into n
    from public.sports_notification_events
   where processing_status in ('pending', 'fanning_out')
   order by created_at
   limit 1
   for update skip locked;
  if not found then
    return jsonb_build_object('idle', true);
  end if;

  if n.fixture_id is not null then
    select * into f from public.sports_fixtures where id = n.fixture_id;
  end if;

  if not n.is_test and (not s.notifications_enabled or (f.id is not null and f.hidden)) then
    update public.sports_notification_events
       set processing_status = 'cancelled', last_error = 'disabled_or_hidden', processed_at = now()
     where id = n.id;
    return jsonb_build_object('notification_event_id', n.id, 'skipped', 'disabled');
  end if;

  v_route := coalesce(n.payload ->> 'route', case when n.fixture_id is not null then '/trabzonspor/mac/' || n.fixture_id end, '/trabzonspor');
  v_data := jsonb_build_object('type', 'sports', 'route', v_route, 'fixture_id', n.fixture_id,
                               'notification_event_id', n.id, 'kind', n.type);
  -- Gecikmiş canlı olaylar uygulama içinde kalır, push gönderilmez.
  v_late := n.type in ('goal_for', 'goal_against', 'red_card', 'kickoff', 'half_time', 'lineups', 'reminder')
            and n.created_at < now() - interval '15 minutes';
  if n.type = 'correction' then
    select id into v_orig from public.sports_notification_events
     where fixture_id = n.fixture_id and dedupe_key = substring(n.dedupe_key from 6);
  end if;
  v_cursor := coalesce(n.fanout_cursor, '00000000-0000-0000-0000-000000000000'::uuid);

  if n.processing_status = 'pending' then
    update public.sports_notification_events set processing_status = 'fanning_out' where id = n.id;
  end if;

  with r as (
    select pr.id as user_id, false as quiet
      from public.profiles pr
     where n.is_test and pr.id = n.created_by and pr.id > v_cursor
       and pr.account_status in ('active', 'restricted')
    union all
    select p.user_id,
           (p.quiet_hours_enabled
             and case when p.quiet_start_hour < p.quiet_end_hour
                      then v_hour >= p.quiet_start_hour and v_hour < p.quiet_end_hour
                      when p.quiet_start_hour > p.quiet_end_hour
                      then v_hour >= p.quiet_start_hour or v_hour < p.quiet_end_hour
                      else false end) as quiet
      from public.sports_notification_preferences p
      join public.profiles pr on pr.id = p.user_id and pr.account_status in ('active', 'restricted')
     where not n.is_test
       and p.user_id > v_cursor
       and (
         (p.enabled and case n.type
               when 'reminder' then p.reminder
               when 'lineups' then p.lineups
               when 'kickoff' then p.kickoff
               when 'goal_for' then p.goal_for
               when 'goal_against' then p.goal_against
               when 'red_card' then p.red_card
               when 'half_time' then p.half_time
               when 'full_time' then p.full_time
               when 'postponed' then p.postponed
               when 'announcement' then p.announcement
               when 'correction' then v_orig is not null and exists (
                 select 1 from public.sports_notification_deliveries d0
                  where d0.notification_event_id = v_orig and d0.user_id = p.user_id and d0.channel = 'in_app')
               else false end)
       )
       and (n.fixture_id is null or not exists (
             select 1 from public.sports_notification_mutes m where m.user_id = p.user_id and m.fixture_id = n.fixture_id))
     order by user_id
     limit v_batch
  ),
  ins as (
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, route)
    select r.user_id, 'sports', left(n.title, 160), left(n.body, 400), 'sports_fixture', n.fixture_id::text, v_route
      from r
    returning id, user_id
  ),
  d_in as (
    insert into public.sports_notification_deliveries
      (notification_event_id, user_id, channel, delivery_status, notification_id, sent_at)
    select n.id, ins.user_id, 'in_app', 'sent', ins.id, now() from ins
    on conflict do nothing
    returning 1
  ),
  d_push as (
    insert into public.sports_notification_deliveries
      (notification_event_id, user_id, device_id, channel, delivery_status, suppressed_reason)
    select n.id, r.user_id, d.id, 'push',
           case when r.quiet or v_late then 'suppressed' else 'pending' end,
           case when v_late then 'late' when r.quiet then 'quiet_hours' end
      from r
      join public.user_devices d
        on d.user_id = r.user_id and d.push_token is not null and d.invalidated_at is null
       and d.notifications_enabled and d.sports_enabled
    on conflict do nothing
    returning delivery_status
  )
  select (select count(*) from r),
         (select r.user_id from r order by r.user_id desc limit 1),
         (select count(*) from d_in),
         (select count(*) from d_push where delivery_status = 'pending'),
         (select count(*) from d_push where delivery_status = 'suppressed')
    into v_users, v_last, v_inapp, v_push, v_supp;

  update public.sports_notification_events
     set processing_status = case when v_users < v_batch then 'done' else 'fanning_out' end,
         processed_at = case when v_users < v_batch then now() end,
         fanout_cursor = coalesce(v_last, fanout_cursor),
         recipients = recipients + v_users,
         payload = payload || jsonb_build_object('data', v_data)
   where id = n.id;

  return jsonb_build_object('notification_event_id', n.id, 'users', v_users, 'in_app', v_inapp,
                            'push_queued', v_push, 'suppressed', v_supp, 'completed', v_users < v_batch);
end;
$$;

create or replace function public.sports_push_claim(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_expired integer;
  v_items jsonb;
begin
  update public.sports_notification_deliveries
     set delivery_status = 'expired', provider_result = jsonb_build_object('reason', 'expired_before_send')
   where channel = 'push' and delivery_status = 'pending' and created_at < now() - interval '30 minutes';
  get diagnostics v_expired = row_count;

  update public.sports_notification_deliveries
     set delivery_status = 'pending', claimed_at = null
   where delivery_status = 'sending' and claimed_at < now() - interval '5 minutes';

  with c as (
    select d.id from public.sports_notification_deliveries d
     where d.channel = 'push' and d.delivery_status = 'pending' and d.next_attempt_at <= now()
     order by d.created_at
     limit v_limit
     for update skip locked
  ), u as (
    update public.sports_notification_deliveries d
       set delivery_status = 'sending', claimed_at = now(), attempted_at = now()
      from c where d.id = c.id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'delivery_id', u.id, 'token', ud.push_token, 'platform', ud.platform, 'title', ne.title, 'body', ne.body,
           'data', coalesce(ne.payload -> 'data', jsonb_build_object('type', 'sports', 'route', ne.payload ->> 'route')),
           'kind', ne.type, 'sound', coalesce(p.sound_enabled, true), 'is_test', ne.is_test)), '[]'::jsonb)
    into v_items
    from u
    join public.sports_notification_events ne on ne.id = u.notification_event_id
    join public.user_devices ud on ud.id = u.device_id
    left join public.sports_notification_preferences p on p.user_id = u.user_id;

  return jsonb_build_object('expired', v_expired, 'items', v_items);
end;
$$;

create or replace function public.sports_push_report(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_id uuid;
  v_error text;
  v_device uuid;
  v_retries integer;
  v_sent integer := 0;
  v_failed integer := 0;
  v_invalid integer := 0;
  v_retry integer := 0;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_results) loop
    v_id := (v_row ->> 'delivery_id')::uuid;
    v_error := nullif(v_row ->> 'error', '');
    select device_id, retry_count into v_device, v_retries
      from public.sports_notification_deliveries where id = v_id and delivery_status = 'sending' for update;
    if not found then
      continue;
    end if;
    if coalesce((v_row ->> 'ok')::boolean, false) then
      update public.sports_notification_deliveries
         set delivery_status = 'sent', sent_at = now(), provider_ticket_id = left(v_row ->> 'ticket_id', 120),
             provider_result = null, claimed_at = null
       where id = v_id;
      v_sent := v_sent + 1;
    elsif v_error = 'DeviceNotRegistered' then
      update public.sports_notification_deliveries
         set delivery_status = 'invalid_token', claimed_at = null,
             provider_result = jsonb_build_object('error', v_error, 'message', left(v_row ->> 'message', 300))
       where id = v_id;
      update public.user_devices
         set push_token = null, invalidated_at = now(), invalid_reason = v_error, updated_at = now()
       where id = v_device;
      v_invalid := v_invalid + 1;
    elsif coalesce((v_row ->> 'retryable')::boolean, false) and v_retries < 4 then
      update public.sports_notification_deliveries
         set delivery_status = 'pending', retry_count = retry_count + 1, claimed_at = null,
             next_attempt_at = now() + make_interval(secs => 20 * power(2, v_retries)::integer),
             provider_result = jsonb_build_object('error', v_error, 'message', left(v_row ->> 'message', 300))
       where id = v_id;
      v_retry := v_retry + 1;
    else
      update public.sports_notification_deliveries
         set delivery_status = 'failed', claimed_at = null,
             provider_result = jsonb_build_object('error', v_error, 'message', left(v_row ->> 'message', 300))
       where id = v_id;
      update public.user_devices set last_error = left(coalesce(v_error, 'failed'), 120), updated_at = now() where id = v_device;
      v_failed := v_failed + 1;
    end if;
  end loop;
  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'invalid', v_invalid, 'retry', v_retry);
end;
$$;

create or replace function public.sports_push_receipts_pending(p_limit integer default 300)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  update public.sports_notification_deliveries
     set receipt_checked_at = now()
   where delivery_status = 'sent' and receipt_checked_at is null and sent_at < now() - interval '24 hours';
  select coalesce(jsonb_agg(jsonb_build_object('delivery_id', d.id, 'ticket_id', d.provider_ticket_id)), '[]'::jsonb)
    into v_items
    from (select id, provider_ticket_id from public.sports_notification_deliveries
           where delivery_status = 'sent' and receipt_checked_at is null and provider_ticket_id is not null
             and sent_at < now() - interval '15 minutes'
           order by sent_at
           limit least(greatest(coalesce(p_limit, 300), 1), 1000)) d;
  return jsonb_build_object('items', v_items);
end;
$$;

create or replace function public.sports_push_receipts_report(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_id uuid;
  v_device uuid;
  v_ok integer := 0;
  v_bad integer := 0;
  v_invalid integer := 0;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_results) loop
    v_id := (v_row ->> 'delivery_id')::uuid;
    select device_id into v_device from public.sports_notification_deliveries where id = v_id and delivery_status = 'sent';
    if not found then
      continue;
    end if;
    if v_row ->> 'status' = 'ok' then
      update public.sports_notification_deliveries set delivery_status = 'delivered', receipt_checked_at = now() where id = v_id;
      v_ok := v_ok + 1;
    elsif v_row ->> 'error' = 'DeviceNotRegistered' then
      update public.sports_notification_deliveries
         set delivery_status = 'invalid_token', receipt_checked_at = now(),
             provider_result = jsonb_build_object('error', v_row ->> 'error', 'message', left(v_row ->> 'message', 300))
       where id = v_id;
      update public.user_devices
         set push_token = null, invalidated_at = now(), invalid_reason = 'DeviceNotRegistered', updated_at = now()
       where id = v_device;
      v_invalid := v_invalid + 1;
    else
      update public.sports_notification_deliveries
         set delivery_status = 'failed', receipt_checked_at = now(),
             provider_result = jsonb_build_object('error', v_row ->> 'error', 'message', left(v_row ->> 'message', 300))
       where id = v_id;
      v_bad := v_bad + 1;
    end if;
  end loop;
  return jsonb_build_object('delivered', v_ok, 'failed', v_bad, 'invalid', v_invalid);
end;
$$;

-- Zaman tabanlı hatırlatma: başlama saatine `reminder_minutes` kala bir kez.
create or replace function public.sports_queue_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  r record;
  v_count integer := 0;
begin
  select * into s from public.sports_settings where id = 1;
  if not s.notifications_enabled then
    return 0;
  end if;
  for r in
    select * from public.sports_fixtures f
     where f.phase = 'scheduled' and not f.is_test and not f.hidden
       and f.kickoff_at between now() + interval '5 minutes' and now() + make_interval(mins => s.reminder_minutes)
  loop
    if public.sports_queue_notification(
         r.id, 'reminder', 'reminder', 'Maç yaklaşıyor',
         r.home_name || ' - ' || r.away_name || ' · '
           || to_char(r.kickoff_at at time zone 'Europe/Istanbul', 'HH24:MI')
           || coalesce(' · ' || r.venue_name, ''),
         jsonb_build_object('route', '/trabzonspor/mac/' || r.id)) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('sports_prefs_get', 'sports_prefs_set', 'sports_fixture_mute', 'sports_fixture_mute_get',
                         'sports_notification_history', 'sports_fanout_step', 'sports_push_claim', 'sports_push_report',
                         'sports_push_receipts_pending', 'sports_push_receipts_report', 'sports_queue_due_reminders')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if fn.proname in ('sports_prefs_get', 'sports_prefs_set', 'sports_fixture_mute', 'sports_fixture_mute_get',
                      'sports_notification_history') then
      execute format('grant execute on function %s to authenticated', fn.sig);
    else
      execute format('grant execute on function %s to service_role', fn.sig);
    end if;
  end loop;
end $$;
