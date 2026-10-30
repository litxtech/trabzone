-- ---------------------------------------------------------------------------
-- 0206 — Push kuyruğuna günlük üst sınır
--
-- Viral bir gönderi veya toplu kampanya tek kullanıcıya yüzlerce push
-- üretebilir. 24 saatte 60 push'u geçen kullanıcı için yeni satırlar
-- 'suppressed' olarak yazılır: uygulama içi bildirim her zaman oluşmaya devam
-- eder, cihaz rahatsız edilmez. Güvenlik bildirimleri sınırdan muaftır.
--
-- Sorgu `push_deliveries_user_recent_idx` üzerinde en fazla 60 satır gezer.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

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

revoke all on function public.push_enqueue_from_notification() from public, anon, authenticated;
grant execute on function public.push_enqueue_from_notification() to service_role;
