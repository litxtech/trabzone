-- ---------------------------------------------------------------------------
-- 0233 — Push teslimat sağlamlaştırması + rozet (badge) sayacı
--
-- 0205/0206/0211 hatlarının üzerine üç eksiği kapatır:
--
--   1. ROZET: Sunucu, gönderim anında kullanıcının okunmamış bildirim sayısını
--      hesaplayıp Expo mesajına `badge` olarak ekler. Uygulama kapalıyken de
--      simge rozeti doğru sayıyı gösterir (iOS APNs badge, Android destekleyen
--      başlatıcılarda bildirim rozeti).
--   2. TERCİHLER: `notification_preferences` içindeki tür anahtarları
--      (likes/comments/follows/messages/orders/support) artık kuyruğa alma
--      anında uygulanır. Önceden yalnızca `push_enabled` okunuyordu; kullanıcı
--      beğeni bildirimini kapatsa da push geliyordu.
--   3. GÜNLÜK SINIR: Sınır artık "bildirim" sayısını ölçer (cihaz başına satır
--      değil) ve bastırılmış satırları saymaz. Böylece çok cihazlı kullanıcı
--      hakkını cihaz sayısı kadar hızlı tüketmez ve bir kez dolan sınır kendi
--      bastırılmış satırlarıyla kendini beslemez.
--
-- Ek olarak: gönderim anında geçersizleşmiş token / kapatılmış cihaz hemen
-- "expired" işaretlenir ve dispatch hataları `push_settings.last_error` alanına
-- yazılır (`push_worker_note`). Böylece `npm run push:doctor` sağlayıcı
-- hatasını (ör. InvalidCredentials) tek bakışta gösterir.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Ayar ve indeksler
-- ---------------------------------------------------------------------------
alter table public.push_settings
  add column if not exists daily_cap integer not null default 60;

alter table public.push_settings
  drop constraint if exists push_settings_daily_cap_check;
alter table public.push_settings
  add constraint push_settings_daily_cap_check check (daily_cap between 0 and 500);

-- Okunmamış sayımı hem rozet hem uygulama içi sayaç için sıcak yol.
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- 2. Kuyruğa alma: tür tercihleri + düzeltilmiş günlük sınır
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
       or (new.kind in ('message', 'market_message') and not coalesce(v_prefs.messages, true))
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

  -- Günlük üst sınır: son 24 saatte gerçekten kuyruğa alınmış bildirim sayısı
  -- (cihaz başına satırlar tekildir; bastırılmış satırlar sayılmaz).
  if v_suppress is null and new.kind <> 'security' then
    select * into v_settings from public.push_settings where id = 1;
    v_cap := coalesce(v_settings.daily_cap, 60);
    if v_cap > 0 then
      select count(distinct d.notification_id) into v_recent
        from public.push_deliveries d
       where d.user_id = new.user_id
         and d.created_at > now() - interval '24 hours'
         and d.status <> 'suppressed';
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

  -- priority <= 4 → push-dispatch "high" gönderir (Doze/APNs bekletmez).
  v_priority := case
    when new.kind = 'security' then 1::smallint
    when new.kind in ('order', 'support', 'system', 'pharmacy', 'ride',
                      'accommodation_property', 'accommodation_reservation') then 3::smallint
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

revoke all on function public.push_enqueue_from_notification() from public, anon, authenticated;
grant execute on function public.push_enqueue_from_notification() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Gönderim: rozet sayısı + ölü cihaz temizliği
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
    select n.user_id, least(count(*), 999)::integer as unread
      from public.notifications n
     where n.read_at is null
       and n.deleted_at is null
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
-- 4. Dispatch sağlığı: son hata görünür olsun
--    (push-dispatch her turdan sonra çağırır; doctor aynı alanı okur.)
-- ---------------------------------------------------------------------------
create or replace function public.push_worker_note(p_error text default null, p_counts jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_settings
     set last_tick_at = now(),
         last_error = nullif(left(coalesce(p_error, ''), 400), ''),
         updated_at = now()
   where id = 1;
end;
$$;

revoke all on function public.push_worker_note(text, jsonb) from public, anon, authenticated;
grant execute on function public.push_worker_note(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Rozet sıfırlama: kullanıcı tüm bildirimleri okuduğunda istemci zaten
--    setBadgeCountAsync(0) çağırır; yeni cihaz kaydında da rozet temizlenir.
--    (Ek RPC gerekmez; istemci unread sayacını tek doğruluk kaynağı kabul eder.)
-- ---------------------------------------------------------------------------
