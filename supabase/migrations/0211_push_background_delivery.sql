-- ---------------------------------------------------------------------------
-- 0211 — Arka planda teslimat: eczane/yolculuk önceliği ve eczane test push'u
--
-- Uygulama arka plandayken bildirimi işletim sistemi gösterir (iOS APNs,
-- Android FCM); JS çalışmaz. Bu yüzden teslimatın garantisi sunucu tarafındaki
-- üç şeye bağlıdır:
--   1. Doğru sağlayıcı kimliği (APNs anahtarı / FCM v1 anahtarı) — EAS/Expo
--      panelinde tutulur, veritabanından yönetilmez.
--   2. Yüksek öncelik (`priority: high`) — Android Doze ve iOS zamanlaması
--      bildirimi bekletmesin.
--   3. Kanal (Android 8+) — başlık olarak görünmesi kanalın HIGH öneminde
--      olmasına bağlıdır.
--
-- Bu migration 2 ve 3'ü nöbetçi eczane ile yolculuk bildirimleri için düzeltir
-- ve nöbetçi eczane biçiminde test bildirimi göndermeyi sağlar.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Öncelik: eczane ve yolculuk bildirimleri yüksek öncelikli
--    (FCM high / APNs priority 10). Eşik push-dispatch'te priority <= 4.
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
  v_suppress  text;
  v_priority  smallint;
  v_hour      integer;
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

  -- Günlük üst sınır: 24 saatte 60 push'tan sonrası sessize alınır.
  if v_suppress is null and new.kind <> 'security' then
    if (
      select count(*) from (
        select 1
          from public.push_deliveries d
         where d.user_id = new.user_id
           and d.created_at > now() - interval '24 hours'
         limit 60
      ) recent
    ) >= 60 then
      v_suppress := 'daily_cap';
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
    when new.kind in ('order', 'support', 'system', 'pharmacy', 'ride') then 3::smallint
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
-- 2. Test bildirimi: tür seçilebilir (system | pharmacy)
--    Eczane türü, gerçek duyuruyla aynı tür/rota/kanalı kullanır; metin
--    "test" olarak işaretlenir ki kullanıcı gerçek nöbet bilgisiyle karıştırmasın.
-- ---------------------------------------------------------------------------
drop function if exists public.notification_push_test();

create or replace function public.notification_push_test(p_kind text default 'system')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_kind     text := lower(coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'system'));
  v_devices  integer;
  v_id       uuid;
  v_notice   jsonb;
  v_count    integer;
  v_names    text;
  v_title    text;
  v_body     text;
  v_route    text;
begin
  if v_kind not in ('system', 'pharmacy') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

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

  if v_kind = 'pharmacy' then
    v_notice := public.pharmacy_duty_notice(null, null);
    v_count := coalesce((v_notice ->> 'count')::integer, 0);
    select string_agg(e ->> 'name', ', ' order by e ->> 'starts_at')
      into v_names
      from jsonb_array_elements(coalesce(v_notice -> 'items', '[]'::jsonb)) e;

    v_title := format('💊 Test: bugün %s nöbetçi eczane', v_count);
    v_body := format(
      '%s. Bu bir test bildirimidir; adres, telefon ve yol tarifi için dokunun.',
      coalesce(v_names, 'Nöbet listesi Trabzone''da')
    );
    v_route := '/eczaneler';
  else
    v_title := 'Trabzone bildirimleri açık';
    v_body := 'Bu cihazda anlık bildirimler çalışıyor. Bildirim tercihlerini ayarlardan yönetebilirsin.';
    v_route := '/notifications';
  end if;

  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, route)
  values (v_uid, v_kind, left(v_title, 160), left(v_body, 400), 'push_test', v_uid::text, v_route)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'kind', v_kind, 'notification_id', v_id, 'devices', v_devices);
end;
$$;

revoke all on function public.notification_push_test(text) from public, anon;
grant execute on function public.notification_push_test(text) to authenticated, service_role;
