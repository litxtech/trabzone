-- ---------------------------------------------------------------------------
-- 0236 — Push teslimat güvenilirliği, yüksek öncelik ve rozet tutarlılığı
--
-- 0233 hattının üzerine kalan dört eksiği kapatır:
--
--   1. ÖNCELİK: beğeni/yorum/takip bildirimleri `priority = 6` (FCM/APNs
--      "default") ile gidiyordu; Android Doze ve iOS düşük güç modunda bu
--      bildirimler saatlerce bekletilebiliyordu. Kullanıcıya görünen tüm
--      push'lar artık yüksek öncelikli (<= 4).
--   2. ROZET TUTARLILIĞI: push yükündeki `badge` tüm okunmamışları sayarken
--      uygulama içi sayaç (`notifications_unread_count`) sohbet türlerini
--      hariç tutuyordu. Uygulama öne gelince rozet zıplıyordu. İki taraf da
--      aynı koşulu kullanır.
--   3. GÜNLÜK SINIR: sınır, hiç gönderilmeden "expired" olan (kullanıcı
--      uygulamada okuduğu) satırları da sayıyordu; bu yüzden aktif kullanıcı
--      hakkını boşa tüketiyordu. Sohbet bildirimleri sınırdan muaftır.
--   4. CİHAZ SAĞLIĞI: başarılı gönderim `user_devices.last_error` alanını
--      temizler; aynı cihaz yeni token ile kaydolduğunda eski token emekliye
--      ayrılır. Böylece "InvalidCredentials" gibi geçmiş hatalar doctor
--      raporunda sonsuza kadar asılı kalmaz.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Günlük sınırı yükselt (mesajlar zaten sınırdan muaf)
-- ---------------------------------------------------------------------------
alter table public.push_settings
  alter column daily_cap set default 120;

update public.push_settings
   set daily_cap = 120,
       updated_at = now()
 where id = 1
   and daily_cap = 60;

-- ---------------------------------------------------------------------------
-- 2. Kuyruğa alma: yüksek öncelik, sohbet istisnaları, doğru sınır sayımı
-- ---------------------------------------------------------------------------
create or replace function public.push_enqueue_from_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefs     public.notification_preferences%rowtype;
  v_has_prefs boolean;
  v_settings  public.push_settings%rowtype;
  v_suppress  text;
  v_priority  smallint;
  v_hour      integer;
  v_recent    integer;
  v_cap       integer;
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

  -- Tür tercihleri: kullanıcı kapattıysa push hiç kuyruğa girmez (uygulama içi
  -- bildirim yine yazılmıştır).
  if v_has_prefs then
    if (new.kind = 'like' and not coalesce(v_prefs.likes, true))
       or (new.kind in ('comment', 'mention') and not coalesce(v_prefs.comments, true))
       or (new.kind in ('follow', 'group_invite') and not coalesce(v_prefs.follows, true))
       or (new.kind in ('message', 'market_message', 'accommodation_message')
           and not coalesce(v_prefs.messages, true))
       or (new.kind in ('order', 'accommodation_reservation', 'accommodation_property')
           and not coalesce(v_prefs.orders, true))
       or (new.kind = 'support' and not coalesce(v_prefs.support, true)) then
      return new;
    end if;
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

  -- Günlük üst sınır: yalnızca gerçekten kuyruğa alınmış/gönderilmiş
  -- bildirimler sayılır. Kullanıcı uygulamada okuduğu için gönderilmeden
  -- düşen "expired" satırlar hakkı tüketmez. Sohbet ve güvenlik muaftır.
  if v_suppress is null
     and new.kind not in ('security', 'message', 'market_message', 'accommodation_message') then
    select * into v_settings from public.push_settings where id = 1;
    v_cap := coalesce(v_settings.daily_cap, 120);
    if v_cap > 0 then
      select count(distinct d.notification_id) into v_recent
        from public.push_deliveries d
       where d.user_id = new.user_id
         and d.created_at > now() - interval '24 hours'
         and d.status not in ('suppressed', 'expired');
      if v_recent >= v_cap then
        v_suppress := 'daily_cap';
      end if;
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

  -- priority <= 4 → push-dispatch "high" gönderir (FCM yüksek öncelik /
  -- APNs priority 10). Kullanıcıya görünen her bildirim yüksektir; aksi halde
  -- uygulama kapalıyken/cihaz uykudayken teslimat saatlerce gecikebiliyordu.
  v_priority := case
    when new.kind = 'security' then 1::smallint
    when new.kind in ('order', 'support', 'system', 'pharmacy', 'ride',
                      'accommodation_property', 'accommodation_reservation') then 3::smallint
    when new.kind in ('message', 'market_message', 'accommodation_message',
                      'mention', 'group_invite') then 4::smallint
    else 4::smallint
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
     -- social_enabled yalnızca sosyal türleri kapatır; sohbet/sipariş/eczane
     -- gibi işlem bildirimlerini engellememelidir.
     and (d.social_enabled
          or new.kind not in ('like', 'comment', 'follow', 'mention', 'group_invite'))
  on conflict (notification_id, device_id) do nothing;

  return new;
end;
$$;

revoke all on function public.push_enqueue_from_notification() from public, anon, authenticated;
grant execute on function public.push_enqueue_from_notification() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Claim: rozet, uygulama içi sayaçla aynı koşulu kullanır
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
  v_dead integer;
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

  -- Kuyruğa girdikten sonra token'ı geçersizleşen ya da bildirimleri kapatılan
  -- cihazlar boşuna sağlayıcıya gönderilmez.
  update public.push_deliveries d
     set status = 'expired',
         provider_result = jsonb_build_object('reason', 'device_no_longer_eligible')
    from public.user_devices ud
   where ud.id = d.device_id
     and d.status = 'pending'
     and (ud.push_token is null
          or ud.invalidated_at is not null
          or not ud.notifications_enabled);
  get diagnostics v_dead = row_count;
  v_expired := v_expired + v_dead;

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
  ), badges as (
    -- Uygulama içi sayaçla birebir aynı tanım: sohbet türleri hariç.
    select n.user_id, least(count(*), 999)::integer as unread
      from public.notifications n
     where n.read_at is null
       and n.deleted_at is null
       and n.kind not in ('message', 'market_message', 'accommodation_message')
       and n.user_id in (select user_id from u)
     group by n.user_id
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
           'badge', coalesce(b.unread, 0),
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
    left join public.notification_preferences p on p.user_id = u.user_id
    left join badges b on b.user_id = u.user_id;

  return jsonb_build_object('paused', false, 'expired', v_expired, 'items', v_items);
end;
$$;

revoke all on function public.push_claim(integer) from public, anon, authenticated;
grant execute on function public.push_claim(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Raporlama: başarılı gönderim cihazdaki eski hatayı temizler
-- ---------------------------------------------------------------------------
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
      -- Sağlayıcı bu cihaza başarıyla teslim etti: geçmiş hata damgası kalmasın.
      update public.user_devices
         set last_error = null, updated_at = now()
       where id = v_device and last_error is not null;
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

revoke all on function public.push_report(jsonb) from public, anon, authenticated;
grant execute on function public.push_report(jsonb) to service_role;

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
      update public.user_devices
         set last_error = null, updated_at = now()
       where id = v_device and last_error is not null;
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
      -- Makbuz hatası (ör. InvalidCredentials) cihazda görünür kalsın.
      update public.user_devices
         set last_error = left(coalesce(nullif(v_row->>'error', ''), 'receipt_failed'), 120),
             updated_at = now()
       where id = v_device;
      v_bad := v_bad + 1;
    end if;
  end loop;

  return jsonb_build_object('delivered', v_ok, 'failed', v_bad, 'invalid', v_invalid);
end;
$$;

revoke all on function public.push_receipts_report(jsonb) from public, anon, authenticated;
grant execute on function public.push_receipts_report(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Cihaz kaydı: eski token'ı emekliye ayır, hata damgasını temizle
-- ---------------------------------------------------------------------------
create or replace function public.push_device_register(
  p_token text,
  p_platform text,
  p_device_id text default null,
  p_app_version text default null,
  p_os_version text default null
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
  v_device text := left(nullif(trim(coalesce(p_device_id, '')), ''), 120);
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

  -- Aynı kurulum yeni token aldıysa eski token artık ölüdür: sağlayıcıya
  -- boşuna gönderilmesin. (FCM/APNs token yenilemesi bu yolla temizlenir.)
  if v_device is not null then
    update public.user_devices
       set push_token = null,
           invalidated_at = now(),
           invalid_reason = 'replaced',
           updated_at = now()
     where user_id = v_uid
       and device_id = v_device
       and push_token is not null
       and push_token <> v_token;
  end if;

  insert into public.user_devices
    (user_id, platform, push_token, provider, device_id, app_version, os_version, notifications_enabled,
     invalidated_at, invalid_reason, last_error, last_seen_at, updated_at)
  values
    (v_uid, v_platform, v_token, 'expo', v_device, left(p_app_version, 40), left(p_os_version, 40), true,
     null, null, null, now(), now())
  on conflict (user_id, push_token) do update
    set platform = excluded.platform,
        device_id = coalesce(excluded.device_id, public.user_devices.device_id),
        app_version = coalesce(excluded.app_version, public.user_devices.app_version),
        os_version = coalesce(excluded.os_version, public.user_devices.os_version),
        notifications_enabled = true,
        invalidated_at = null,
        invalid_reason = null,
        last_error = null,
        last_seen_at = now(),
        updated_at = now()
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'registered', true);
end;
$$;

revoke all on function public.push_device_register(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.push_device_register(text, text, text, text, text) to authenticated, service_role;
