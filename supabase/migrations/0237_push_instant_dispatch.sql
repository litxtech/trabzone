-- ---------------------------------------------------------------------------
-- 0237 — Anlık dispatch: bildirim kuyruğa girdiği anda gönderilir
--
-- Ölçüm (0236 sonrası, son 24 saat): sunucu tarafı gecikme p50 ≈ 8 sn,
-- p90 ≈ 17 sn. Nedeni mimariydi: kuyruk yalnızca pg_cron'un 15 saniyelik
-- turunda işleniyordu, yani bir mesaj en kötü durumda ~18 saniye bekliyordu.
--
-- Bu migration üç şey yapar:
--
--   1. `push_kick()`: kuyruğu hemen işletmek için worker'a tek bir HTTP
--      isteği atar (pg_net). `push_settings.last_kick_at` ile 1 saniye
--      debounce edilir; art arda gelen mesajlar tek istek üretir, ikinci
--      worker `for update skip locked` sayesinde boş döner.
--   2. `push_enqueue_from_notification`: gerçekten `pending` satır
--      oluştuysa (bastırılmadıysa) aynı transaction içinde kick çağırır.
--      İstek commit ile birlikte kuyruğa girer, geri alma isteği de iptal eder.
--   3. Cron turu 15 sn → 5 sn: kick kaçarsa (worker soğuk, ağ hatası) yedek
--      yol da hızlıdır.
--
-- Beklenen sonuç: mesaj gönderildiği anda sunucu tarafı gecikme ≈ 1 sn.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Kick damgası
-- ---------------------------------------------------------------------------
alter table public.push_settings
  add column if not exists last_kick_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. push_kick: tek HTTP isteği, 1 sn debounce
-- ---------------------------------------------------------------------------
create or replace function public.push_kick(p_reason text default 'enqueue')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s        public.push_settings;
  v_token  text;
  v_go     boolean := false;
  v_req    bigint;
begin
  select * into s from public.push_settings where id = 1;
  if not found or not s.enabled or s.worker_url is null then
    return jsonb_build_object('queued', false, 'reason', 'disabled');
  end if;

  -- Debounce: son 1 saniye içinde kick atıldıysa tekrar atma. Eşzamanlı
  -- transaction'lar satır kilidinde bekler ve WHERE yeniden değerlendirilir.
  update public.push_settings
     set last_kick_at = now()
   where id = 1
     and (last_kick_at is null or last_kick_at < now() - interval '1 second')
  returning true into v_go;

  if not coalesce(v_go, false) then
    return jsonb_build_object('queued', false, 'reason', 'debounced');
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'push_worker_secret';
  if v_token is null then
    return jsonb_build_object('queued', false, 'reason', 'secret_missing');
  end if;

  select net.http_post(
    url := rtrim(s.worker_url, '/') || '/functions/v1/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', v_token),
    body := jsonb_build_object('action', 'tick', 'trigger', coalesce(p_reason, 'enqueue')),
    timeout_milliseconds := 45000
  ) into v_req;

  return jsonb_build_object('queued', true, 'request_id', v_req);
end;
$$;

revoke all on function public.push_kick(text) from public, anon, authenticated;
grant execute on function public.push_kick(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Kuyruğa alma: satır oluştuysa anında kick
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
  v_inserted  integer;
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
     and (d.social_enabled
          or new.kind not in ('like', 'comment', 'follow', 'mention', 'group_invite'))
  on conflict (notification_id, device_id) do nothing;
  get diagnostics v_inserted = row_count;

  -- Gönderilecek satır oluştuysa 15 saniyelik cron turunu bekleme.
  -- (Bastırılmış satırlar da sayılabilir; push_kick zaten debounce'ludur.)
  if v_inserted > 0 and v_suppress is null then
    perform public.push_kick('notification');
  end if;

  return new;
end;
$$;

revoke all on function public.push_enqueue_from_notification() from public, anon, authenticated;
grant execute on function public.push_enqueue_from_notification() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Yedek yol: cron turu 5 saniyeye iner
-- ---------------------------------------------------------------------------
do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'push-dispatch';
  if v_job is not null then
    perform cron.alter_job(job_id => v_job, schedule => '5 seconds');
  else
    perform cron.schedule('push-dispatch', '5 seconds', 'select public.push_tick();');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Gecikme ölçümü: push:doctor bu görünümü okur
--    (Son 5 dakika: düzeltme sonrası davranışı ölçer, eski kayıtlarla
--     karışmaz. Boş dönerse hat gerçekten boş demektir.)
-- ---------------------------------------------------------------------------
create or replace view public.push_latency_15m as
select
  n.kind,
  count(*) as deliveries,
  percentile_cont(0.5) within group (order by extract(epoch from (d.sent_at - d.created_at))) as p50_s,
  percentile_cont(0.9) within group (order by extract(epoch from (d.sent_at - d.created_at))) as p90_s,
  max(extract(epoch from (d.sent_at - d.created_at))) as max_s
from public.push_deliveries d
join public.notifications n on n.id = d.notification_id
where d.sent_at is not null
  and d.created_at > now() - interval '5 minutes'
group by 1;

revoke all on public.push_latency_15m from public, anon, authenticated;
grant select on public.push_latency_15m to service_role;

drop view if exists public.push_latency_1h;
