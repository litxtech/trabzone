-- ---------------------------------------------------------------------------
-- 0192 — Deprem bildirimleri: tercihler, cihaz token'ları, kuyruk ve geçmiş
--
-- Teslimat zinciri: earthquake_ingest bir "new"/"revision" bildirim olayı
-- oluşturur → earthquake_fanout_step uygun kullanıcılar için uygulama içi
-- bildirim (notifications) ve cihaz başına push teslimatı yazar (toplu,
-- imleçli) → earthquake-sync edge function push'ları Expo Push API'ye
-- gönderir, sonuçları earthquake_push_report ile yazar → makbuzlar
-- earthquake_push_receipts_report ile işlenir, geçersiz token'lar temizlenir.
--
-- Bildirimler standart öncelikli push'tur: iOS Critical Alerts veya Android
-- acil uyarı izinleri kullanılmaz. Teslimat garanti edilmez; her bildirim
-- uygulama içi geçmişte de bulunur.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Cihaz token'ları (mevcut user_devices tablosu genişletilir)
-- ---------------------------------------------------------------------------
alter table public.user_devices
  add column if not exists provider           text not null default 'expo',
  add column if not exists device_id          text,
  add column if not exists app_version        text,
  add column if not exists os_version         text,
  add column if not exists earthquake_enabled boolean not null default true,
  add column if not exists invalidated_at     timestamptz,
  add column if not exists invalid_reason     text,
  add column if not exists last_error         text,
  add column if not exists updated_at         timestamptz not null default now();

alter table public.user_devices drop constraint if exists user_devices_provider_check;
alter table public.user_devices add constraint user_devices_provider_check check (provider in ('expo'));

create index if not exists user_devices_push_token_idx on public.user_devices (push_token) where push_token is not null;
create index if not exists user_devices_user_active_idx on public.user_devices (user_id)
  where push_token is not null and invalidated_at is null;

-- ---------------------------------------------------------------------------
-- 2. Kullanıcı tercihleri
-- ---------------------------------------------------------------------------
create table if not exists public.earthquake_user_preferences (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  notifications_enabled  boolean not null default false,
  region_mode            text not null default 'trabzon' check (region_mode in ('trabzon', 'province', 'turkey')),
  radius_km              integer not null default 150 check (radius_km in (50, 100, 150, 250)),
  notify_all_magnitudes  boolean not null default false,
  minimum_magnitude      numeric(3,1) not null default 3.0 check (minimum_magnitude in (1.0, 2.0, 3.0, 4.0, 5.0)),
  sound_enabled          boolean not null default true,
  quiet_hours_enabled    boolean not null default false,
  quiet_start_hour       smallint not null default 23 check (quiet_start_hour between 0 and 23),
  quiet_end_hour         smallint not null default 7 check (quiet_end_hour between 0 and 23),
  created_at             timestamptz not null default now(),
  preference_updated_at  timestamptz not null default now()
);

create index if not exists earthquake_user_preferences_enabled_idx
  on public.earthquake_user_preferences (region_mode, user_id) where notifications_enabled;

-- ---------------------------------------------------------------------------
-- 3. Teslimatlar (uygulama içi + cihaz başına push)
-- ---------------------------------------------------------------------------
create table if not exists public.earthquake_notification_deliveries (
  id                     uuid primary key default gen_random_uuid(),
  notification_event_id  uuid not null references public.earthquake_notification_events (id) on delete cascade,
  user_id                uuid not null references public.profiles (id) on delete cascade,
  device_id              uuid references public.user_devices (id) on delete cascade,
  channel                text not null check (channel in ('in_app', 'push')),
  priority               smallint not null default 0,
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
  constraint earthquake_notification_deliveries_device check ((channel = 'push') = (device_id is not null))
);

create unique index if not exists earthquake_deliveries_inapp_uidx
  on public.earthquake_notification_deliveries (notification_event_id, user_id) where channel = 'in_app';
create unique index if not exists earthquake_deliveries_push_uidx
  on public.earthquake_notification_deliveries (notification_event_id, device_id) where channel = 'push';
create index if not exists earthquake_deliveries_queue_idx
  on public.earthquake_notification_deliveries (priority desc, created_at)
  where channel = 'push' and delivery_status = 'pending';
create index if not exists earthquake_deliveries_sending_idx
  on public.earthquake_notification_deliveries (claimed_at) where delivery_status = 'sending';
create index if not exists earthquake_deliveries_receipt_idx
  on public.earthquake_notification_deliveries (sent_at)
  where delivery_status = 'sent' and receipt_checked_at is null and provider_ticket_id is not null;
create index if not exists earthquake_deliveries_user_idx
  on public.earthquake_notification_deliveries (user_id, created_at desc);
create index if not exists earthquake_deliveries_event_idx
  on public.earthquake_notification_deliveries (notification_event_id, channel, delivery_status);

-- ---------------------------------------------------------------------------
-- 4. Basit hız sınırı (kullanıcı başına işlem sayacı)
-- ---------------------------------------------------------------------------
create table if not exists public.earthquake_rate_limits (
  user_id      uuid not null references auth.users (id) on delete cascade,
  action       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (user_id, action)
);

do $$
declare
  t text;
begin
  foreach t in array array['earthquake_user_preferences', 'earthquake_notification_deliveries', 'earthquake_rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

create or replace function public.earthquake_rate_check(p_action text, p_max integer, p_window_seconds integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hits integer;
begin
  if v_uid is null then
    return;
  end if;
  insert into public.earthquake_rate_limits as r (user_id, action, window_start, hits)
  values (v_uid, p_action, now(), 1)
  on conflict (user_id, action) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  if v_hits > p_max then
    raise exception 'rate_limited' using errcode = '53400';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Cihaz kaydı (kullanıcı oturumu)
-- ---------------------------------------------------------------------------
create or replace function public.push_device_register(
  p_token       text,
  p_platform    text,
  p_device_id   text default null,
  p_app_version text default null,
  p_os_version  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_token text := trim(coalesce(p_token, ''));
  v_platform text := lower(trim(coalesce(p_platform, '')));
  v_id uuid;
begin
  if v_platform not in ('ios', 'android') then
    raise exception 'invalid_platform' using errcode = '22023';
  end if;
  if v_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$' then
    raise exception 'invalid_push_token' using errcode = '22023';
  end if;
  perform public.earthquake_rate_check('push_device_register', 20, 3600);

  -- Aynı token başka bir hesapta kayıtlıysa (cihazda hesap değişimi) devredilir.
  delete from public.user_devices where push_token = v_token and user_id <> v_uid;

  insert into public.user_devices
    (user_id, platform, push_token, provider, device_id, app_version, os_version, notifications_enabled,
     invalidated_at, invalid_reason, last_seen_at, updated_at)
  values
    (v_uid, v_platform, v_token, 'expo', left(p_device_id, 120), left(p_app_version, 40), left(p_os_version, 40), true,
     null, null, now(), now())
  on conflict (user_id, push_token) do update
    set platform = excluded.platform,
        device_id = coalesce(excluded.device_id, public.user_devices.device_id),
        app_version = coalesce(excluded.app_version, public.user_devices.app_version),
        os_version = coalesce(excluded.os_version, public.user_devices.os_version),
        notifications_enabled = true,
        invalidated_at = null,
        invalid_reason = null,
        last_seen_at = now(),
        updated_at = now()
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'registered', true);
end;
$$;

create or replace function public.push_device_unregister(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_count integer;
begin
  delete from public.user_devices where user_id = v_uid and push_token = trim(coalesce(p_token, ''));
  get diagnostics v_count = row_count;
  return jsonb_build_object('removed', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Tercihler
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_prefs_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  p public.earthquake_user_preferences;
  s public.earthquake_settings;
begin
  select * into p from public.earthquake_user_preferences where user_id = v_uid;
  select * into s from public.earthquake_settings where id = 1;
  return jsonb_build_object(
    'saved', p.user_id is not null,
    'notifications_enabled', coalesce(p.notifications_enabled, false),
    'region_mode', coalesce(p.region_mode, 'trabzon'),
    'radius_km', coalesce(p.radius_km, 150),
    'notify_all_magnitudes', coalesce(p.notify_all_magnitudes, false),
    'minimum_magnitude', coalesce(p.minimum_magnitude, 3.0),
    'sound_enabled', coalesce(p.sound_enabled, true),
    'quiet_hours_enabled', coalesce(p.quiet_hours_enabled, false),
    'quiet_start_hour', coalesce(p.quiet_start_hour, 23),
    'quiet_end_hour', coalesce(p.quiet_end_hour, 7),
    'preference_updated_at', p.preference_updated_at,
    'system', jsonb_build_object(
      'notifications_enabled', s.notifications_enabled,
      'paused', s.notifications_paused,
      'trabzon_enabled', s.notify_trabzon_enabled,
      'turkey_enabled', s.notify_turkey_enabled and s.turkey_enabled,
      'small_enabled', s.notify_small_enabled,
      'small_threshold', s.small_magnitude_threshold,
      'quiet_bypass_magnitude', s.quiet_bypass_magnitude
    ),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('platform', d.platform, 'app_version', d.app_version, 'last_seen_at', d.last_seen_at))
        from public.user_devices d
       where d.user_id = v_uid and d.push_token is not null and d.invalidated_at is null and d.notifications_enabled
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.earthquake_prefs_set(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_region text := coalesce(p_payload->>'region_mode', 'trabzon');
  v_radius integer := coalesce((p_payload->>'radius_km')::integer, 150);
  v_min numeric := coalesce((p_payload->>'minimum_magnitude')::numeric, 3.0);
  v_start integer := coalesce((p_payload->>'quiet_start_hour')::integer, 23);
  v_end integer := coalesce((p_payload->>'quiet_end_hour')::integer, 7);
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if v_region not in ('trabzon', 'province', 'turkey') then
    raise exception 'invalid_region' using errcode = '22023';
  end if;
  if v_region = 'turkey' and not coalesce((select turkey_enabled from public.earthquake_settings where id = 1), false) then
    raise exception 'region_disabled' using errcode = '22023';
  end if;
  if v_radius not in (50, 100, 150, 250) then
    raise exception 'invalid_radius' using errcode = '22023';
  end if;
  if v_min not in (1.0, 2.0, 3.0, 4.0, 5.0) then
    raise exception 'invalid_magnitude' using errcode = '22023';
  end if;
  if v_start not between 0 and 23 or v_end not between 0 and 23 then
    raise exception 'invalid_quiet_hours' using errcode = '22023';
  end if;
  perform public.earthquake_rate_check('earthquake_prefs_set', 30, 600);

  insert into public.earthquake_user_preferences as p
    (user_id, notifications_enabled, region_mode, radius_km, notify_all_magnitudes, minimum_magnitude,
     sound_enabled, quiet_hours_enabled, quiet_start_hour, quiet_end_hour, preference_updated_at)
  values
    (v_uid, coalesce((p_payload->>'notifications_enabled')::boolean, false), v_region, v_radius,
     coalesce((p_payload->>'notify_all_magnitudes')::boolean, false), v_min,
     coalesce((p_payload->>'sound_enabled')::boolean, true), coalesce((p_payload->>'quiet_hours_enabled')::boolean, false),
     v_start, v_end, now())
  on conflict (user_id) do update
    set notifications_enabled = excluded.notifications_enabled,
        region_mode = excluded.region_mode,
        radius_km = excluded.radius_km,
        notify_all_magnitudes = excluded.notify_all_magnitudes,
        minimum_magnitude = excluded.minimum_magnitude,
        sound_enabled = excluded.sound_enabled,
        quiet_hours_enabled = excluded.quiet_hours_enabled,
        quiet_start_hour = excluded.quiet_start_hour,
        quiet_end_hour = excluded.quiet_end_hour,
        preference_updated_at = now();

  return public.earthquake_prefs_get();
end;
$$;

-- Kullanıcının deprem bildirim geçmişi (push ulaşmasa da uygulama içi kayıt).
create or replace function public.earthquake_notification_history(p_limit integer default 30, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(q.item order by q.created_at desc)
        from (
          select jsonb_build_object(
                   'id', d.id,
                   'type', ne.notification_type,
                   'title', ne.title,
                   'body', ne.body,
                   'route', ne.route,
                   'event_id', e.canonical_event_id,
                   'magnitude', e.magnitude,
                   'magnitude_type', e.magnitude_type,
                   'occurred_at', e.occurred_at,
                   'created_at', d.created_at,
                   'read_at', n.read_at,
                   'push', (
                     select jsonb_build_object(
                       'devices', count(*),
                       'sent', count(*) filter (where pd.delivery_status in ('sent', 'delivered')),
                       'suppressed', count(*) filter (where pd.delivery_status = 'suppressed'),
                       'failed', count(*) filter (where pd.delivery_status in ('failed', 'invalid_token', 'expired')),
                       'pending', count(*) filter (where pd.delivery_status in ('pending', 'sending')))
                       from public.earthquake_notification_deliveries pd
                      where pd.notification_event_id = d.notification_event_id
                        and pd.user_id = v_uid and pd.channel = 'push')
                 ) as item,
                 d.created_at
            from public.earthquake_notification_deliveries d
            join public.earthquake_notification_events ne on ne.id = d.notification_event_id
            left join public.earthquake_events e on e.id = ne.earthquake_event_id
            left join public.notifications n on n.id = d.notification_id
           where d.user_id = v_uid and d.channel = 'in_app'
           order by d.created_at desc
           limit v_limit offset v_offset
        ) q
    ), '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Bildirim metni
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_compose_notification(p_notification_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n public.earthquake_notification_events;
  e public.earthquake_events;
  s public.earthquake_settings;
  v_mag text;
  v_where text;
  v_line2 text;
  v_source text;
  v_district text;
begin
  select * into n from public.earthquake_notification_events where id = p_notification_id;
  select * into e from public.earthquake_events where id = n.earthquake_event_id;
  select * into s from public.earthquake_settings where id = 1;
  if e.id is null then
    return null;
  end if;

  select r.name into v_district from public.earthquake_regions r where r.key = e.district_key;
  v_mag := coalesce(e.magnitude_type || ' ', '') || public.earthquake_fmt_num(e.magnitude, 1);
  v_source := case when e.preferred_source = 'afad' then 'AFAD' else 'Kaynak: USGS' end;

  if n.notification_type = 'revision' then
    return jsonb_build_object(
      'title', 'Deprem kaydı güncellendi',
      'body', upper(e.preferred_source) || ', ' || to_char(e.occurred_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI')
              || ' tarihli depremin büyüklüğünü ' || coalesce(e.magnitude_type || ' ', '') || public.earthquake_fmt_num(n.old_magnitude, 1)
              || ' yerine ' || v_mag || ' olarak güncelledi.',
      'priority', case when e.magnitude >= s.important_magnitude then 'high' else 'normal' end,
      'route', '/deprem/' || e.canonical_event_id
    );
  end if;

  v_where := case e.region_classification
    when 'trabzon_province' then 'Trabzon’un ' || coalesce(v_district, '') || ' ilçesinde'
    when 'trabzon_offshore' then 'Trabzon açıklarında'
    when 'trabzon_vicinity' then 'Trabzon’un ' || public.earthquake_fmt_num(e.distance_to_trabzon_km, 0) || ' km yakınında'
    else coalesce(e.location_description || ' yakınlarında', 'Türkiye ve çevresinde')
  end;

  v_line2 := case when e.depth_km is null then 'Derinlik bildirilmedi'
                  else 'Derinlik: ' || public.earthquake_fmt_num(e.depth_km, 1) || ' km' end
             || case when e.location_description is not null and e.region_classification <> 'turkey' and e.region_classification <> 'outside'
                     then ' · Merkez üssü: ' || e.location_description else '' end
             || ' · ' || v_source;

  return jsonb_build_object(
    'title', 'Trabzone Deprem Merkezi',
    'body', v_where || ' ' || v_mag || ' büyüklüğünde deprem kaydedildi.' || E'\n' || v_line2,
    'priority', case when e.magnitude >= s.important_magnitude then 'high' else 'normal' end,
    'route', '/deprem/' || e.canonical_event_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Dağıtım (fan-out) — service_role. Her çağrı en fazla p_batch kullanıcı
--    işler; imleç olay satırında tutulur, böylece kesinti tekrar gönderim
--    üretmez.
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_fanout_step(p_batch integer default 2000)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.earthquake_settings;
  n public.earthquake_notification_events;
  e public.earthquake_events;
  v_batch integer := least(greatest(coalesce(p_batch, 2000), 50), 10000);
  v_msg jsonb;
  v_skip text;
  v_hour integer := extract(hour from now() at time zone 'Europe/Istanbul')::integer;
  v_users integer;
  v_last uuid;
  v_inapp integer;
  v_push integer;
  v_supp integer;
  v_cursor uuid;
begin
  select * into s from public.earthquake_settings where id = 1;

  select * into n
    from public.earthquake_notification_events
   where processing_status in ('pending', 'fanning_out') and notification_type <> 'test'
   order by created_at
   limit 1
   for update skip locked;
  if not found then
    return jsonb_build_object('idle', true);
  end if;

  select * into e from public.earthquake_events where id = n.earthquake_event_id;

  v_skip := case
    when not s.notifications_enabled then 'disabled'
    when e.id is null then 'event_missing'
    when e.status not in ('active', 'under_review') then 'event_' || e.status
    when n.notification_type = 'new' and now() - e.occurred_at > make_interval(mins => s.late_event_max_minutes) then 'late'
    when e.region_classification = 'outside' then 'outside_region'
    else null
  end;
  if v_skip is not null then
    update public.earthquake_notification_events
       set processing_status = 'skipped', skip_reason = v_skip, completed_at = now()
     where id = n.id;
    if n.notification_type = 'new' then
      update public.earthquake_events
         set notification_state = 'skipped', notification_skip_reason = v_skip
       where id = n.earthquake_event_id and notification_state = 'queued';
    end if;
    return jsonb_build_object('notification_event_id', n.id, 'skipped', v_skip);
  end if;

  if n.processing_status = 'pending' then
    v_msg := public.earthquake_compose_notification(n.id);
    update public.earthquake_notification_events
       set processing_status = 'fanning_out',
           started_at = now(),
           title = v_msg->>'title',
           body = v_msg->>'body',
           priority = v_msg->>'priority',
           route = v_msg->>'route',
           data = jsonb_build_object('type', 'earthquake', 'route', v_msg->>'route', 'event_id', e.canonical_event_id,
                                     'notification_event_id', n.id, 'kind', n.notification_type)
     where id = n.id
     returning * into n;
  end if;

  v_cursor := coalesce(n.fanout_cursor, '00000000-0000-0000-0000-000000000000'::uuid);

  with r as (
    select p.user_id,
           (p.quiet_hours_enabled
             and e.magnitude < s.quiet_bypass_magnitude
             and case when p.quiet_start_hour < p.quiet_end_hour
                      then v_hour >= p.quiet_start_hour and v_hour < p.quiet_end_hour
                      when p.quiet_start_hour > p.quiet_end_hour
                      then v_hour >= p.quiet_start_hour or v_hour < p.quiet_end_hour
                      else false end) as quiet
      from public.earthquake_user_preferences p
      join public.profiles pr on pr.id = p.user_id and pr.account_status in ('active', 'restricted')
     where p.notifications_enabled
       and p.user_id > v_cursor
       and (
         (p.region_mode = 'trabzon' and s.notify_trabzon_enabled and e.distance_to_trabzon_km <= p.radius_km)
         or (p.region_mode = 'province' and s.notify_trabzon_enabled and e.in_trabzon_province)
         or (p.region_mode = 'turkey' and s.notify_turkey_enabled and s.turkey_enabled and e.in_turkey_region)
       )
       and (p.notify_all_magnitudes or e.magnitude >= p.minimum_magnitude)
       and (s.notify_small_enabled or e.magnitude >= s.small_magnitude_threshold)
       and (
         n.notification_type = 'new'
         or exists (
           select 1
             from public.earthquake_notification_deliveries d0
             join public.earthquake_notification_events n0 on n0.id = d0.notification_event_id
            where n0.earthquake_event_id = e.id and n0.notification_type = 'new'
              and d0.user_id = p.user_id and d0.channel = 'in_app')
       )
     order by p.user_id
     limit v_batch
  ),
  ins as (
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, route)
    select r.user_id, 'earthquake', left(n.title, 160), n.body, 'earthquake', e.canonical_event_id, n.route
      from r
    returning id, user_id
  ),
  d_in as (
    insert into public.earthquake_notification_deliveries
      (notification_event_id, user_id, channel, delivery_status, notification_id, sent_at)
    select n.id, ins.user_id, 'in_app', 'sent', ins.id, now()
      from ins
    on conflict do nothing
    returning 1
  ),
  d_push as (
    insert into public.earthquake_notification_deliveries
      (notification_event_id, user_id, device_id, channel, priority, delivery_status, suppressed_reason)
    select n.id, r.user_id, d.id, 'push', case when n.priority = 'high' then 1 else 0 end,
           case when r.quiet then 'suppressed' else 'pending' end,
           case when r.quiet then 'quiet_hours' end
      from r
      join public.user_devices d
        on d.user_id = r.user_id
       and d.push_token is not null
       and d.invalidated_at is null
       and d.notifications_enabled
       and d.earthquake_enabled
    on conflict do nothing
    returning delivery_status
  )
  select (select count(*) from r),
         (select r.user_id from r order by r.user_id desc limit 1),
         (select count(*) from d_in),
         (select count(*) from d_push where delivery_status = 'pending'),
         (select count(*) from d_push where delivery_status = 'suppressed')
    into v_users, v_last, v_inapp, v_push, v_supp;

  if v_users < v_batch then
    update public.earthquake_notification_events
       set processing_status = 'completed',
           completed_at = now(),
           fanout_cursor = coalesce(v_last, fanout_cursor),
           recipients = recipients + v_users,
           in_app_created = in_app_created + v_inapp,
           push_queued = push_queued + v_push,
           push_suppressed = push_suppressed + v_supp
     where id = n.id;
    if n.notification_type = 'new' then
      update public.earthquake_events
         set notification_state = 'sent', notified_at = now(), notification_skip_reason = null
       where id = e.id;
    end if;
  else
    update public.earthquake_notification_events
       set fanout_cursor = v_last,
           recipients = recipients + v_users,
           in_app_created = in_app_created + v_inapp,
           push_queued = push_queued + v_push,
           push_suppressed = push_suppressed + v_supp
     where id = n.id;
  end if;

  return jsonb_build_object(
    'notification_event_id', n.id, 'users', v_users, 'in_app', v_inapp, 'push_queued', v_push,
    'suppressed', v_supp, 'completed', v_users < v_batch);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Push gönderimi — service_role
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_push_claim(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.earthquake_settings;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_expired integer;
  v_items jsonb;
begin
  select * into s from public.earthquake_settings where id = 1;

  update public.earthquake_notification_deliveries d
     set delivery_status = 'expired', provider_result = jsonb_build_object('reason', 'expired_before_send')
    from public.earthquake_notification_events ne
   where ne.id = d.notification_event_id
     and d.channel = 'push' and d.delivery_status = 'pending'
     and d.created_at < now() - make_interval(mins => s.push_expire_minutes)
     and not ne.is_test;
  get diagnostics v_expired = row_count;

  update public.earthquake_notification_deliveries
     set delivery_status = 'pending', claimed_at = null
   where delivery_status = 'sending' and claimed_at < now() - interval '5 minutes';

  if not s.notifications_enabled or s.notifications_paused then
    with c as (
      select d.id
        from public.earthquake_notification_deliveries d
        join public.earthquake_notification_events ne on ne.id = d.notification_event_id
       where d.channel = 'push' and d.delivery_status = 'pending' and ne.is_test and d.next_attempt_at <= now()
       order by d.created_at
       limit v_limit
       for update of d skip locked
    ), u as (
      update public.earthquake_notification_deliveries d
         set delivery_status = 'sending', claimed_at = now(), attempted_at = now()
        from c where d.id = c.id
      returning d.*
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'delivery_id', u.id, 'token', ud.push_token, 'platform', ud.platform, 'title', ne.title, 'body', ne.body,
             'data', ne.data, 'priority', ne.priority, 'sound', true, 'is_test', ne.is_test)), '[]'::jsonb)
      into v_items
      from u
      join public.earthquake_notification_events ne on ne.id = u.notification_event_id
      join public.user_devices ud on ud.id = u.device_id;
    return jsonb_build_object('paused', true, 'expired', v_expired, 'items', v_items);
  end if;

  with c as (
    select d.id
      from public.earthquake_notification_deliveries d
     where d.channel = 'push' and d.delivery_status = 'pending' and d.next_attempt_at <= now()
     order by d.priority desc, d.created_at
     limit v_limit
     for update skip locked
  ), u as (
    update public.earthquake_notification_deliveries d
       set delivery_status = 'sending', claimed_at = now(), attempted_at = now()
      from c where d.id = c.id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'delivery_id', u.id, 'token', ud.push_token, 'platform', ud.platform, 'title', ne.title, 'body', ne.body,
           'data', ne.data, 'priority', ne.priority, 'sound', coalesce(p.sound_enabled, true), 'is_test', ne.is_test)), '[]'::jsonb)
    into v_items
    from u
    join public.earthquake_notification_events ne on ne.id = u.notification_event_id
    join public.user_devices ud on ud.id = u.device_id
    left join public.earthquake_user_preferences p on p.user_id = u.user_id;

  return jsonb_build_object('paused', false, 'expired', v_expired, 'items', v_items);
end;
$$;

-- p_results: [{ delivery_id, ok, ticket_id, error, message, retryable }]
create or replace function public.earthquake_push_report(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_id uuid;
  v_error text;
  v_sent integer := 0;
  v_failed integer := 0;
  v_invalid integer := 0;
  v_retry integer := 0;
  v_device uuid;
  v_retries integer;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_results) loop
    v_id := (v_row->>'delivery_id')::uuid;
    v_error := nullif(v_row->>'error', '');
    select device_id, retry_count into v_device, v_retries
      from public.earthquake_notification_deliveries
     where id = v_id and delivery_status = 'sending'
     for update;
    if not found then
      continue;
    end if;

    if coalesce((v_row->>'ok')::boolean, false) then
      update public.earthquake_notification_deliveries
         set delivery_status = 'sent', sent_at = now(), provider_ticket_id = left(v_row->>'ticket_id', 120),
             provider_result = null, claimed_at = null
       where id = v_id;
      v_sent := v_sent + 1;
    elsif v_error = 'DeviceNotRegistered' then
      update public.earthquake_notification_deliveries
         set delivery_status = 'invalid_token', provider_result = jsonb_build_object('error', v_error, 'message', left(v_row->>'message', 300)),
             claimed_at = null
       where id = v_id;
      update public.user_devices
         set push_token = null, invalidated_at = now(), invalid_reason = v_error, updated_at = now()
       where id = v_device;
      v_invalid := v_invalid + 1;
    elsif coalesce((v_row->>'retryable')::boolean, false) and v_retries < 5 then
      update public.earthquake_notification_deliveries
         set delivery_status = 'pending', retry_count = retry_count + 1, claimed_at = null,
             next_attempt_at = now() + make_interval(secs => 30 * power(2, v_retries)::integer),
             provider_result = jsonb_build_object('error', v_error, 'message', left(v_row->>'message', 300))
       where id = v_id;
      v_retry := v_retry + 1;
    else
      update public.earthquake_notification_deliveries
         set delivery_status = 'failed', claimed_at = null,
             provider_result = jsonb_build_object('error', v_error, 'message', left(v_row->>'message', 300))
       where id = v_id;
      update public.user_devices set last_error = left(coalesce(v_error, 'failed'), 120), updated_at = now() where id = v_device;
      v_failed := v_failed + 1;
    end if;
  end loop;

  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'invalid', v_invalid, 'retry', v_retry);
end;
$$;

create or replace function public.earthquake_push_receipts_pending(p_limit integer default 300)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  update public.earthquake_notification_deliveries
     set receipt_checked_at = now()
   where delivery_status = 'sent' and receipt_checked_at is null and sent_at < now() - interval '24 hours';

  select coalesce(jsonb_agg(jsonb_build_object('delivery_id', d.id, 'ticket_id', d.provider_ticket_id)), '[]'::jsonb)
    into v_items
    from (
      select id, provider_ticket_id
        from public.earthquake_notification_deliveries
       where delivery_status = 'sent' and receipt_checked_at is null and provider_ticket_id is not null
         and sent_at < now() - interval '15 minutes'
       order by sent_at
       limit least(greatest(coalesce(p_limit, 300), 1), 1000)
    ) d;
  return jsonb_build_object('items', v_items);
end;
$$;

-- p_results: [{ delivery_id, status: 'ok'|'error', error, message }]
create or replace function public.earthquake_push_receipts_report(p_results jsonb)
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
    v_id := (v_row->>'delivery_id')::uuid;
    select device_id into v_device from public.earthquake_notification_deliveries where id = v_id and delivery_status = 'sent';
    if not found then
      continue;
    end if;
    if v_row->>'status' = 'ok' then
      update public.earthquake_notification_deliveries
         set delivery_status = 'delivered', receipt_checked_at = now()
       where id = v_id;
      v_ok := v_ok + 1;
    elsif v_row->>'error' = 'DeviceNotRegistered' then
      update public.earthquake_notification_deliveries
         set delivery_status = 'invalid_token', receipt_checked_at = now(),
             provider_result = jsonb_build_object('error', v_row->>'error', 'message', left(v_row->>'message', 300))
       where id = v_id;
      update public.user_devices
         set push_token = null, invalidated_at = now(), invalid_reason = 'DeviceNotRegistered', updated_at = now()
       where id = v_device;
      v_invalid := v_invalid + 1;
    else
      update public.earthquake_notification_deliveries
         set delivery_status = 'failed', receipt_checked_at = now(),
             provider_result = jsonb_build_object('error', v_row->>'error', 'message', left(v_row->>'message', 300))
       where id = v_id;
      v_bad := v_bad + 1;
    end if;
  end loop;
  return jsonb_build_object('delivered', v_ok, 'failed', v_bad, 'invalid', v_invalid);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Worker yetkisi ve zamanlayıcı
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'earthquake_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'earthquake_worker_secret',
                                'Deprem senkron worker çağrı anahtarı (pg_cron → earthquake-sync)');
  end if;
end $$;

create or replace function public.earthquake_worker_token_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected from vault.decrypted_secrets where name = 'earthquake_worker_secret';
  if v_expected is null or coalesce(p_token, '') = '' then
    return false;
  end if;
  return encode(digest(p_token, 'sha256'), 'hex') = encode(digest(v_expected, 'sha256'), 'hex');
end;
$$;

-- Her 30 sn'de pg_cron tarafından çağrılır; senkron aralığı dolmadıysa veya
-- dağıtılacak bildirim yoksa istek atmaz.
create or replace function public.earthquake_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.earthquake_settings;
  v_token text;
  v_request bigint;
  v_due boolean;
  v_work boolean;
  v_sweep boolean;
begin
  select * into s from public.earthquake_settings where id = 1 for update;
  if s.worker_url is null then
    return jsonb_build_object('queued', false, 'reason', 'worker_url_missing');
  end if;

  v_due := s.sync_enabled
       and (s.last_tick_at is null or s.last_tick_at <= now() - make_interval(secs => greatest(s.sync_interval_seconds - 5, 25)));
  v_work := exists (select 1 from public.earthquake_notification_events where processing_status in ('pending', 'fanning_out'))
         or exists (select 1 from public.earthquake_notification_deliveries
                     where channel = 'push' and delivery_status = 'pending' and next_attempt_at <= now());
  if not v_due and not v_work then
    return jsonb_build_object('queued', false, 'reason', 'not_due');
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'earthquake_worker_secret';
  if v_token is null then
    return jsonb_build_object('queued', false, 'reason', 'secret_missing');
  end if;

  v_sweep := v_due and (s.last_sweep_at is null or s.last_sweep_at < now() - interval '30 minutes');

  update public.earthquake_settings
     set last_tick_at = case when v_due then now() else last_tick_at end,
         last_sweep_at = case when v_sweep then now() else last_sweep_at end
   where id = 1;

  select net.http_post(
    url := rtrim(s.worker_url, '/') || '/functions/v1/earthquake-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-earthquake-token', v_token),
    body := jsonb_build_object('action', 'tick', 'sync', v_due, 'sweep', v_sweep, 'trigger', 'cron'),
    timeout_milliseconds := 55000
  ) into v_request;

  return jsonb_build_object('queued', true, 'request_id', v_request, 'sync', v_due, 'sweep', v_sweep);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Fonksiyon yetkileri
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'earthquake_rate_check', 'push_device_register', 'push_device_unregister', 'earthquake_prefs_get',
         'earthquake_prefs_set', 'earthquake_notification_history', 'earthquake_compose_notification',
         'earthquake_fanout_step', 'earthquake_push_claim', 'earthquake_push_report',
         'earthquake_push_receipts_pending', 'earthquake_push_receipts_report', 'earthquake_worker_token_ok',
         'earthquake_tick')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if fn.proname in ('push_device_register', 'push_device_unregister', 'earthquake_prefs_get',
                      'earthquake_prefs_set', 'earthquake_notification_history') then
      execute format('grant execute on function %s to authenticated', fn.sig);
    elsif fn.proname <> 'earthquake_rate_check' and fn.proname <> 'earthquake_compose_notification' then
      execute format('grant execute on function %s to service_role', fn.sig);
    end if;
  end loop;
end $$;
