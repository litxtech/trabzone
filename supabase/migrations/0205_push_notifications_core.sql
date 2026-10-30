-- ---------------------------------------------------------------------------
-- 0205 — Genel bildirimler için push teslimat hattı
--
-- Deprem ve maç bildirimlerinin kendi kuyrukları vardır (0192, 0197). Bu
-- migration sosyal/işlem bildirimlerini (beğeni, yorum, takip, mesaj, sipariş,
-- destek, güvenlik, kampanya) aynı disiplinle cihazlara ulaştırır:
--
--   notifications INSERT → push_enqueue_from_notification (cihaz başına
--   kuyruk satırı) → push-dispatch edge function (Expo Push API, 100'lü
--   toplu) → push_report / push_receipts_report (makbuz, geçersiz token
--   temizliği) → pg_cron push_tick (15 sn, iş yoksa HTTP isteği atmaz).
--
-- İlkeler:
--   • Uygulama içi bildirim her zaman yazılır; push yalnızca ek kanaldır.
--   • Kullanıcı tercihleri (push_enabled, sessiz saatler, tür anahtarları)
--     kuyruğa girişte uygulanır; gönderim anında değişen tercih geriye dönük
--     uygulanmaz.
--   • Sunucu tek doğruluk kaynağıdır: token'lar user_devices'ta tutulur,
--     DeviceNotRegistered dönen token bir daha kullanılmaz.
--   • Deprem/maç bildirimleri bu hattı kullanmaz (kendi kuyrukları vardır).
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Tercih ve cihaz kolonları
-- ---------------------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists push_enabled      boolean not null default true,
  add column if not exists sound_enabled      boolean not null default true,
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_start_hour   smallint not null default 23,
  add column if not exists quiet_end_hour     smallint not null default 8;

alter table public.notification_preferences
  drop constraint if exists notification_preferences_quiet_check;
alter table public.notification_preferences
  add constraint notification_preferences_quiet_check
  check (quiet_start_hour between 0 and 23 and quiet_end_hour between 0 and 23);

alter table public.user_devices
  add column if not exists social_enabled     boolean not null default true,
  add column if not exists token_refreshed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Kuyruk: bildirim × cihaz
-- ---------------------------------------------------------------------------
create table if not exists public.push_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  notification_id     uuid not null references public.notifications (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  device_id           uuid not null references public.user_devices (id) on delete cascade,
  status              text not null default 'pending'
                      check (status in ('pending', 'sending', 'sent', 'delivered', 'failed',
                                        'invalid_token', 'suppressed', 'expired')),
  suppressed_reason   text,
  priority            smallint not null default 6,
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  claimed_at          timestamptz,
  sent_at             timestamptz,
  receipt_checked_at  timestamptz,
  ticket_id           text,
  provider_result     jsonb,
  created_at          timestamptz not null default now(),
  unique (notification_id, device_id)
);

create index if not exists push_deliveries_queue_idx
  on public.push_deliveries (priority, created_at)
  where status = 'pending';
create index if not exists push_deliveries_sending_idx
  on public.push_deliveries (claimed_at) where status = 'sending';
create index if not exists push_deliveries_receipt_idx
  on public.push_deliveries (sent_at)
  where status = 'sent' and receipt_checked_at is null and ticket_id is not null;
create index if not exists push_deliveries_user_recent_idx
  on public.push_deliveries (user_id, created_at desc);
create index if not exists push_deliveries_cleanup_idx
  on public.push_deliveries (created_at) where status <> 'pending';

alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hat ayarları (cron → edge function)
-- ---------------------------------------------------------------------------
create table if not exists public.push_settings (
  id          smallint primary key default 1 check (id = 1),
  enabled     boolean not null default true,
  worker_url  text,
  last_tick_at timestamptz,
  last_error  text,
  updated_at  timestamptz not null default now()
);

insert into public.push_settings (id) values (1) on conflict (id) do nothing;

-- Aynı projedeki mevcut worker adresiyle başlatılır; panelden değiştirilebilir.
update public.push_settings
   set worker_url = coalesce(worker_url, (select s.worker_url from public.earthquake_settings s where s.id = 1))
 where id = 1 and worker_url is null;

alter table public.push_settings enable row level security;
revoke all on public.push_settings from anon, authenticated;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_worker_secret',
                                'Genel push dispatcher çağrı anahtarı (pg_cron → push-dispatch)');
  end if;
end $$;

create or replace function public.push_worker_token_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected from vault.decrypted_secrets where name = 'push_worker_secret';
  if v_expected is null or coalesce(p_token, '') = '' then
    return false;
  end if;
  return encode(digest(p_token, 'sha256'), 'hex') = encode(digest(v_expected, 'sha256'), 'hex');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Kuyruğa alma: notifications INSERT → cihaz başına push_deliveries
-- ---------------------------------------------------------------------------
create or replace function public.push_enqueue_from_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefs        public.notification_preferences%rowtype;
  v_has_prefs    boolean;
  v_suppress     text;
  v_priority     smallint;
  v_hour         integer;
begin
  -- Deprem ve maç bildirimlerinin kendi teslimat hatları vardır.
  if new.kind is null or new.kind in ('earthquake', 'sports') then
    return new;
  end if;

  select * into v_prefs from public.notification_preferences where user_id = new.user_id;
  v_has_prefs := found;

  if v_has_prefs and not v_prefs.push_enabled then
    return new;
  end if;

  -- Aynı gönderi için kısa sürede tekrar beğeni üretilirse tek push yeter.
  if new.kind in ('like', 'follow') and new.entity_id is not null then
    if exists (
      select 1
        from public.push_deliveries d
        join public.notifications n on n.id = d.notification_id
       where d.user_id = new.user_id
         and n.kind = new.kind
         and n.entity_id = new.entity_id
         and d.created_at > now() - interval '45 seconds'
    ) then
      v_suppress := 'coalesced';
    end if;
  end if;

  if v_suppress is null and v_has_prefs and v_prefs.quiet_hours_enabled and new.kind <> 'security' then
    v_hour := extract(hour from now() at time zone 'Europe/Istanbul')::integer;
    if (v_prefs.quiet_start_hour < v_prefs.quiet_end_hour
          and v_hour >= v_prefs.quiet_start_hour and v_hour < v_prefs.quiet_end_hour)
       or (v_prefs.quiet_start_hour > v_prefs.quiet_end_hour
          and (v_hour >= v_prefs.quiet_start_hour or v_hour < v_prefs.quiet_end_hour)) then
      v_suppress := 'quiet_hours';
    end if;
  end if;

  v_priority := case
    when new.kind = 'security' then 1::smallint
    when new.kind in ('order', 'support', 'system') then 3::smallint
    when new.kind in ('message', 'market_message', 'mention', 'group_invite') then 4::smallint
    else 6::smallint
  end;

  insert into public.push_deliveries (notification_id, user_id, device_id, status, priority, suppressed_reason)
  select new.id, new.user_id, d.id,
         case when v_suppress is null then 'pending' else 'suppressed' end,
         v_priority, v_suppress
    from public.user_devices d
   where d.user_id = new.user_id
     and d.push_token is not null
     and d.invalidated_at is null
     and d.notifications_enabled
     and d.social_enabled
  on conflict (notification_id, device_id) do nothing;

  return new;
end;
$$;

drop trigger if exists notifications_push_enqueue on public.notifications;
create trigger notifications_push_enqueue
after insert on public.notifications
for each row execute function public.push_enqueue_from_notification();

-- ---------------------------------------------------------------------------
-- 5. Gönderim: claim → report
-- ---------------------------------------------------------------------------
create or replace function public.push_claim(p_limit integer default 300)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.push_settings;
  v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 1000);
  v_expired integer;
  v_items jsonb;
begin
  select * into s from public.push_settings where id = 1;

  -- 24 saati geçen, silinen veya kullanıcı tarafından okunmuş bildirimler
  -- artık gönderilmez.
  update public.push_deliveries d
     set status = 'expired', provider_result = jsonb_build_object('reason', 'expired_before_send')
    from public.notifications n
   where n.id = d.notification_id
     and d.status = 'pending'
     and (d.created_at < now() - interval '24 hours'
          or n.deleted_at is not null
          or n.read_at is not null);
  get diagnostics v_expired = row_count;

  -- Çökmüş dispatch'lerin kilitleri düşer (5 dk).
  update public.push_deliveries
     set status = 'pending', claimed_at = null
   where status = 'sending' and claimed_at < now() - interval '5 minutes';

  if not s.enabled then
    return jsonb_build_object('paused', true, 'expired', v_expired, 'items', '[]'::jsonb);
  end if;

  with c as (
    select id
      from public.push_deliveries
     where status = 'pending' and next_attempt_at <= now()
     order by priority, created_at
     limit v_limit
     for update skip locked
  ), u as (
    update public.push_deliveries d
       set status = 'sending', claimed_at = now(), attempts = attempts + 1
      from c
     where d.id = c.id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'delivery_id', u.id,
           'token', ud.push_token,
           'platform', ud.platform,
           'title', n.title,
           'body', n.body,
           'route', n.route,
           'kind', n.kind,
           'priority', u.priority,
           'sound', coalesce(p.sound_enabled, true),
           'data', jsonb_build_object(
             'type', 'notification',
             'kind', n.kind,
             'notification_id', n.id,
             'entity_type', n.entity_type,
             'entity_id', n.entity_id,
             'campaign_id', n.campaign_id,
             'route', n.route)
         )), '[]'::jsonb)
    into v_items
    from u
    join public.notifications n on n.id = u.notification_id
    join public.user_devices ud on ud.id = u.device_id
    left join public.notification_preferences p on p.user_id = u.user_id;

  return jsonb_build_object('paused', false, 'expired', v_expired, 'items', v_items);
end;
$$;

-- p_results: [{ delivery_id, ok, ticket_id, error, message, retryable }]
create or replace function public.push_report(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      jsonb;
  v_id       uuid;
  v_error    text;
  v_sent     integer := 0;
  v_failed   integer := 0;
  v_invalid  integer := 0;
  v_retry    integer := 0;
  v_device   uuid;
  v_attempts integer;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_results) loop
    v_id := (v_row->>'delivery_id')::uuid;
    v_error := nullif(v_row->>'error', '');

    select device_id, attempts into v_device, v_attempts
      from public.push_deliveries
     where id = v_id and status = 'sending'
     for update;
    if not found then
      continue;
    end if;

    if coalesce((v_row->>'ok')::boolean, false) then
      update public.push_deliveries
         set status = 'sent', sent_at = now(), ticket_id = left(v_row->>'ticket_id', 120),
             provider_result = null, claimed_at = null
       where id = v_id;
      v_sent := v_sent + 1;
    elsif v_error = 'DeviceNotRegistered' then
      update public.push_deliveries
         set status = 'invalid_token', claimed_at = null,
             provider_result = jsonb_build_object('error', v_error, 'message', left(v_row->>'message', 300))
       where id = v_id;
      update public.user_devices
         set push_token = null, invalidated_at = now(), invalid_reason = v_error, updated_at = now()
       where id = v_device;
      v_invalid := v_invalid + 1;
    elsif coalesce((v_row->>'retryable')::boolean, false) and v_attempts < 5 then
      update public.push_deliveries
         set status = 'pending', claimed_at = null,
             next_attempt_at = now() + make_interval(secs => least(30 * power(2, v_attempts)::integer, 900)),
             provider_result = jsonb_build_object('error', v_error, 'message', left(v_row->>'message', 300))
       where id = v_id;
      v_retry := v_retry + 1;
    else
      update public.push_deliveries
         set status = 'failed', claimed_at = null,
             provider_result = jsonb_build_object('error', v_error, 'message', left(v_row->>'message', 300))
       where id = v_id;
      update public.user_devices
         set last_error = left(coalesce(v_error, 'failed'), 120), updated_at = now()
       where id = v_device;
      v_failed := v_failed + 1;
    end if;
  end loop;

  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'invalid', v_invalid, 'retry', v_retry);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Makbuzlar (Expo: 15 dk sonra sorulur, 24 saat sonra bırakılır)
-- ---------------------------------------------------------------------------
create or replace function public.push_receipts_pending(p_limit integer default 300)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  update public.push_deliveries
     set receipt_checked_at = now()
   where status = 'sent' and receipt_checked_at is null and sent_at < now() - interval '24 hours';

  select coalesce(jsonb_agg(jsonb_build_object('delivery_id', d.id, 'ticket_id', d.ticket_id)), '[]'::jsonb)
    into v_items
    from (
      select id, ticket_id
        from public.push_deliveries
       where status = 'sent' and receipt_checked_at is null and ticket_id is not null
         and sent_at < now() - interval '15 minutes'
       order by sent_at
       limit least(greatest(coalesce(p_limit, 300), 1), 1000)
    ) d;

  return jsonb_build_object('items', v_items);
end;
$$;

-- p_results: [{ delivery_id, status: 'ok'|'error', error, message }]
create or replace function public.push_receipts_report(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     jsonb;
  v_id      uuid;
  v_device  uuid;
  v_ok      integer := 0;
  v_bad     integer := 0;
  v_invalid integer := 0;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_results) loop
    v_id := (v_row->>'delivery_id')::uuid;
    select device_id into v_device from public.push_deliveries where id = v_id and status = 'sent';
    if not found then
      continue;
    end if;

    if v_row->>'status' = 'ok' then
      update public.push_deliveries
         set status = 'delivered', receipt_checked_at = now()
       where id = v_id;
      v_ok := v_ok + 1;
    elsif v_row->>'error' = 'DeviceNotRegistered' then
      update public.push_deliveries
         set status = 'invalid_token', receipt_checked_at = now(),
             provider_result = jsonb_build_object('error', v_row->>'error', 'message', left(v_row->>'message', 300))
       where id = v_id;
      update public.user_devices
         set push_token = null, invalidated_at = now(), invalid_reason = 'DeviceNotRegistered', updated_at = now()
       where id = v_device;
      v_invalid := v_invalid + 1;
    else
      update public.push_deliveries
         set status = 'failed', receipt_checked_at = now(),
             provider_result = jsonb_build_object('error', v_row->>'error', 'message', left(v_row->>'message', 300))
       where id = v_id;
      v_bad := v_bad + 1;
    end if;
  end loop;

  return jsonb_build_object('delivered', v_ok, 'failed', v_bad, 'invalid', v_invalid);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Temizlik ve zamanlayıcı
-- ---------------------------------------------------------------------------
create or replace function public.push_prune(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 30);
  v_count integer;
begin
  delete from public.push_deliveries
   where status <> 'pending' and created_at < now() - make_interval(days => v_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Her 15 sn'de çağrılır; yalnızca gönderilecek iş varsa HTTP isteği atılır.
create or replace function public.push_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.push_settings;
  v_token text;
  v_request bigint;
  v_work boolean;
begin
  select * into s from public.push_settings where id = 1;

  if s.worker_url is null then
    return jsonb_build_object('queued', false, 'reason', 'worker_url_missing');
  end if;
  if not s.enabled then
    return jsonb_build_object('queued', false, 'reason', 'paused');
  end if;

  v_work := exists (
              select 1 from public.push_deliveries
               where status = 'pending' and next_attempt_at <= now())
            or exists (
              select 1 from public.push_deliveries
               where status = 'sent' and receipt_checked_at is null and ticket_id is not null
                 and sent_at < now() - interval '15 minutes');
  if not v_work then
    return jsonb_build_object('queued', false, 'reason', 'not_due');
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'push_worker_secret';
  if v_token is null then
    return jsonb_build_object('queued', false, 'reason', 'secret_missing');
  end if;

  update public.push_settings set last_tick_at = now() where id = 1;

  select net.http_post(
    url := rtrim(s.worker_url, '/') || '/functions/v1/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', v_token),
    body := jsonb_build_object('action', 'tick', 'trigger', 'cron'),
    timeout_milliseconds := 45000
  ) into v_request;

  return jsonb_build_object('queued', true, 'request_id', v_request);
end;
$$;

select cron.unschedule('push-dispatch')
where exists (select 1 from cron.job where jobname = 'push-dispatch');

select cron.schedule(
  'push-dispatch',
  '15 seconds',
  $$select public.push_tick();$$
);

select cron.unschedule('push-prune')
where exists (select 1 from cron.job where jobname = 'push-prune');

select cron.schedule(
  'push-prune',
  '25 4 * * *',
  $$select public.push_prune(7);$$
);

-- ---------------------------------------------------------------------------
-- 8. Kullanıcı tercihleri (uygulama içi + push tek ekranda)
-- ---------------------------------------------------------------------------
create or replace function public.notification_prefs_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  p public.notification_preferences;
begin
  select * into p from public.notification_preferences where user_id = v_uid;
  return jsonb_build_object(
    'saved', p.user_id is not null,
    'push_enabled', coalesce(p.push_enabled, true),
    'sound_enabled', coalesce(p.sound_enabled, true),
    'quiet_hours_enabled', coalesce(p.quiet_hours_enabled, false),
    'quiet_start_hour', coalesce(p.quiet_start_hour, 23),
    'quiet_end_hour', coalesce(p.quiet_end_hour, 8),
    'likes', coalesce(p.likes, true),
    'comments', coalesce(p.comments, true),
    'follows', coalesce(p.follows, true),
    'messages', coalesce(p.messages, true),
    'orders', coalesce(p.orders, true),
    'support', coalesce(p.support, true),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'platform', d.platform,
               'app_version', d.app_version,
               'os_version', d.os_version,
               'last_seen_at', d.last_seen_at))
        from public.user_devices d
       where d.user_id = v_uid
         and d.push_token is not null
         and d.invalidated_at is null
         and d.notifications_enabled
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.notification_prefs_set(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_start integer := coalesce((p_payload->>'quiet_start_hour')::integer, 23);
  v_end   integer := coalesce((p_payload->>'quiet_end_hour')::integer, 8);
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if v_start not between 0 and 23 or v_end not between 0 and 23 then
    raise exception 'invalid_quiet_hours' using errcode = '22023';
  end if;

  perform public.earthquake_rate_check('notification_prefs_set', 30, 600);

  insert into public.notification_preferences as np
    (user_id, push_enabled, sound_enabled, quiet_hours_enabled, quiet_start_hour, quiet_end_hour,
     likes, comments, follows, messages, orders, support, updated_at)
  values
    (v_uid,
     coalesce((p_payload->>'push_enabled')::boolean, true),
     coalesce((p_payload->>'sound_enabled')::boolean, true),
     coalesce((p_payload->>'quiet_hours_enabled')::boolean, false),
     v_start, v_end,
     coalesce((p_payload->>'likes')::boolean, true),
     coalesce((p_payload->>'comments')::boolean, true),
     coalesce((p_payload->>'follows')::boolean, true),
     coalesce((p_payload->>'messages')::boolean, true),
     coalesce((p_payload->>'orders')::boolean, true),
     coalesce((p_payload->>'support')::boolean, true),
     now())
  on conflict (user_id) do update
    set push_enabled = excluded.push_enabled,
        sound_enabled = excluded.sound_enabled,
        quiet_hours_enabled = excluded.quiet_hours_enabled,
        quiet_start_hour = excluded.quiet_start_hour,
        quiet_end_hour = excluded.quiet_end_hour,
        likes = excluded.likes,
        comments = excluded.comments,
        follows = excluded.follows,
        messages = excluded.messages,
        orders = excluded.orders,
        support = excluded.support,
        updated_at = now();

  return public.notification_prefs_get();
end;
$$;

-- Test bildirimi: kuyruğa girer, push-dispatch bir sonraki turda gönderir.
create or replace function public.notification_push_test()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := public.tz_require_uid();
  v_devices integer;
  v_id      uuid;
begin
  perform public.earthquake_rate_check('notification_push_test', 5, 3600);

  select count(*) into v_devices
    from public.user_devices d
   where d.user_id = v_uid
     and d.push_token is not null
     and d.invalidated_at is null
     and d.notifications_enabled;

  if v_devices = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_device');
  end if;

  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, route)
  values (v_uid, 'system', 'Trabzone bildirimleri açık',
          'Bu cihazda anlık bildirimler çalışıyor. Bildirim tercihlerini ayarlardan yönetebilirsin.',
          'push_test', v_uid::text, '/notifications')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'notification_id', v_id, 'devices', v_devices);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Yetkiler
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
         'push_enqueue_from_notification', 'push_claim', 'push_report',
         'push_receipts_pending', 'push_receipts_report', 'push_prune', 'push_tick',
         'push_worker_token_ok', 'notification_prefs_get', 'notification_prefs_set',
         'notification_push_test')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if fn.proname in ('notification_prefs_get', 'notification_prefs_set', 'notification_push_test') then
      execute format('grant execute on function %s to authenticated', fn.sig);
    else
      execute format('grant execute on function %s to service_role', fn.sig);
    end if;
  end loop;
end $$;
