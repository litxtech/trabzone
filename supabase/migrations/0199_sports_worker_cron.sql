-- ---------------------------------------------------------------------------
-- 0199 — Maç verisi worker planlayıcısı ve zamanlayıcı
--
-- pg_cron her 15 sn'de sports_tick() çağırır. Tick, sports_worker_plan(true)
-- ile vadesi gelen işleri seçer (ve zaman damgalarını ileri alır); iş yoksa
-- hiçbir HTTP isteği atılmaz. Canlı maçlar tek /fixtures?ids= isteğinde
-- (olay + kadro + istatistik + oyuncu gömülü) çekilir.
--
-- Kota: günlük kalan istek (sağlayıcı başlıklarından) ve isteğe bağlı bütçe
-- ile canlı aralık otomatik uzatılır; bütçe bittiğinde canlı polling durur,
-- panel "quota" durumuna geçer. Ardışık hatalarda aralıklar üstel uzar.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

alter table public.sports_settings add column if not exists last_discover_at timestamptz;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'sports_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'sports_worker_secret',
                                'Maç verisi worker çağrı anahtarı (pg_cron → sports-sync)');
  end if;
end $$;

create or replace function public.sports_worker_token_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected from vault.decrypted_secrets where name = 'sports_worker_secret';
  if v_expected is null or coalesce(p_token, '') = '' then
    return false;
  end if;
  return encode(digest(p_token, 'sha256'), 'hex') = encode(digest(v_expected, 'sha256'), 'hex');
end;
$$;

create or replace function public.sports_worker_plan(p_commit boolean default false, p_force text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  v_backoff integer;
  v_used integer;
  v_budget_left integer;
  v_live_ids bigint[];
  v_pre_ids bigint[];
  v_verify_ids bigint[];
  v_resync_ids bigint[];
  v_ids bigint[];
  v_remaining_secs numeric;
  v_interval integer;
  v_live_due boolean := false;
  v_pre_due boolean := false;
  v_matchday boolean;
  v_schedule_due boolean := false;
  v_standings jsonb := '[]'::jsonb;
  v_leagues_due boolean := false;
  v_squad_due boolean := false;
  v_teamstats jsonb := '[]'::jsonb;
  v_discover_due boolean := false;
  v_status_due boolean := false;
  v_dispatch boolean;
  v_quota_blocked boolean := false;
  v_jobs jsonb;
begin
  select * into s from public.sports_settings where id = 1 for update;
  v_backoff := least(power(2, least(s.consecutive_failures, 3))::integer, 8);

  select coalesce(sum(requests), 0) into v_used from public.sports_api_usage where day = (now() at time zone 'UTC')::date;
  v_budget_left := case
    when s.api_remaining_day is not null and s.api_quota_at::date = now()::date and s.daily_request_budget is not null
      then least(s.api_remaining_day, s.daily_request_budget - v_used)
    when s.api_remaining_day is not null and s.api_quota_at::date = now()::date then s.api_remaining_day
    when s.daily_request_budget is not null then s.daily_request_budget - v_used
    else null end;
  if v_budget_left is not null then
    v_budget_left := v_budget_left - s.request_reserve;
    v_quota_blocked := v_budget_left <= 0;
  end if;

  v_dispatch := exists (select 1 from public.sports_notification_events where processing_status in ('pending', 'fanning_out'))
             or exists (select 1 from public.sports_notification_deliveries
                         where channel = 'push' and delivery_status = 'pending' and next_attempt_at <= now())
             or exists (select 1 from public.sports_notification_deliveries
                         where delivery_status = 'sent' and receipt_checked_at is null and provider_ticket_id is not null
                           and sent_at < now() - interval '15 minutes');

  v_status_due := s.last_status_check_at is null or s.last_status_check_at < now() - interval '30 minutes'
                  or 'status' = any (p_force);

  if s.team_id is null then
    v_discover_due := (s.last_discover_at is null or s.last_discover_at < now() - interval '6 hours' or 'discover' = any (p_force))
                      and not v_quota_blocked;
  elsif s.sync_enabled or array_length(p_force, 1) > 0 then
    select coalesce(array_agg(id order by kickoff_at), '{}') into v_live_ids
      from (select id, kickoff_at from public.sports_fixtures f
             where not f.is_test and not f.hidden
               and (public.sports_phase_is_live(f.phase)
                    or (f.phase in ('scheduled', 'unknown') and f.kickoff_at between now() - interval '3 hours' and now() + interval '10 minutes')
                    or (public.sports_phase_is_finished(f.phase) and f.finished_seen_at > now() - interval '30 minutes'))
             order by f.kickoff_at limit 20) x;
    select coalesce(array_agg(id order by kickoff_at), '{}') into v_pre_ids
      from (select id, kickoff_at from public.sports_fixtures f
             where not f.is_test and not f.hidden and f.phase = 'scheduled'
               and f.kickoff_at > now() + interval '10 minutes' and f.kickoff_at <= now() + interval '90 minutes'
             order by f.kickoff_at limit 10) x;
    select coalesce(array_agg(id), '{}') into v_verify_ids
      from (select id from public.sports_fixtures f
             where not f.is_test and public.sports_phase_is_finished(f.phase) and f.final_verified_at is null
               and f.finished_seen_at <= now() - interval '30 minutes'
             order by f.finished_seen_at limit 10) x;
    select coalesce(array_agg(id), '{}') into v_resync_ids
      from (select id from public.sports_fixtures f
             where not f.is_test and f.resync_requested_at is not null order by f.resync_requested_at limit 10) x;

    -- Canlı aralık: kota yetmiyorsa kalan maç süresine yayılacak şekilde uzatılır.
    v_interval := s.live_interval_seconds * v_backoff;
    if cardinality(v_live_ids) > 0 and v_budget_left is not null and v_budget_left > 0 then
      select coalesce(max(greatest(extract(epoch from (f.kickoff_at + interval '150 minutes') - now()), 600)), 600)
        into v_remaining_secs
        from public.sports_fixtures f where f.id = any (v_live_ids);
      v_interval := greatest(v_interval, ceil(v_remaining_secs / greatest(v_budget_left * 0.8, 1))::integer);
    end if;

    v_live_due := cardinality(v_live_ids) > 0 and not v_quota_blocked
                  and (s.last_live_sync_at is null or s.last_live_sync_at <= now() - make_interval(secs => v_interval - 2)
                       or 'fixtures' = any (p_force));
    v_pre_due := cardinality(v_pre_ids) > 0 and not v_quota_blocked
                 and (s.last_prematch_sync_at is null
                      or s.last_prematch_sync_at <= now() - make_interval(secs => s.prematch_interval_seconds * v_backoff - 2)
                      or 'fixtures' = any (p_force));

    v_matchday := exists (select 1 from public.sports_fixtures f
                           where not f.is_test and f.kickoff_at between now() - interval '12 hours' and now() + interval '12 hours');
    v_schedule_due := s.season is not null and not v_quota_blocked
                      and (s.last_schedule_sync_at is null
                           or s.last_schedule_sync_at <= now() - make_interval(mins => (case when v_matchday
                                then s.matchday_schedule_interval_minutes else s.schedule_interval_minutes end) * v_backoff)
                           or 'schedule' = any (p_force));
    v_leagues_due := not v_quota_blocked
                     and (s.last_leagues_sync_at is null or s.last_leagues_sync_at <= now() - make_interval(hours => s.leagues_interval_hours)
                          or 'leagues' = any (p_force));
    v_squad_due := not v_quota_blocked
                   and (s.last_squad_sync_at is null or s.last_squad_sync_at <= now() - make_interval(hours => s.squad_interval_hours)
                        or 'squad' = any (p_force));

    if not v_quota_blocked and (s.last_standings_sync_at is null
        or s.last_standings_sync_at <= now() - make_interval(mins => s.standings_interval_minutes * v_backoff)
        or exists (select 1 from public.sports_fixtures f
                    where not f.is_test and f.finished_seen_at > s.last_standings_sync_at)
        or 'standings' = any (p_force)) then
      select coalesce(jsonb_agg(jsonb_build_object('league', c.league_id, 'season', c.season)), '[]'::jsonb)
        into v_standings
        from public.sports_competitions c
       where c.is_current and c.is_enabled and coalesce((c.coverage ->> 'standings')::boolean, false);
    end if;

    if not v_quota_blocked and (s.last_teamstats_sync_at is null or s.last_teamstats_sync_at <= now() - interval '24 hours'
                                or 'teamstats' = any (p_force)) then
      select coalesce(jsonb_agg(jsonb_build_object('league', c.league_id, 'season', c.season)), '[]'::jsonb)
        into v_teamstats
        from public.sports_competitions c
       where c.is_current and c.is_enabled and c.type = 'League';
    end if;
  end if;

  v_ids := array(select distinct unnest(
             case when v_live_due then v_live_ids else '{}'::bigint[] end
             || case when v_pre_due or v_live_due then v_pre_ids else '{}'::bigint[] end
             || case when not v_quota_blocked then v_verify_ids else '{}'::bigint[] end
             || case when not v_quota_blocked then v_resync_ids else '{}'::bigint[] end));
  v_ids := v_ids[1:20];

  v_jobs := jsonb_build_object(
    'team_id', s.team_id,
    'season', s.season,
    'team_search', s.team_search,
    'api_base_url', s.api_base_url,
    'fixtures', to_jsonb(v_ids),
    'verify_ids', to_jsonb(v_verify_ids),
    'schedule', v_schedule_due,
    'standings', v_standings,
    'leagues', v_leagues_due,
    'squad', v_squad_due,
    'teamstats', v_teamstats,
    'discover', v_discover_due,
    'status', v_status_due,
    'dispatch', v_dispatch,
    'quota_blocked', v_quota_blocked,
    'budget_left', v_budget_left,
    'live_interval', v_interval
  );

  if p_commit then
    update public.sports_settings set
      last_live_sync_at = case when v_live_due then now() else last_live_sync_at end,
      last_prematch_sync_at = case when v_pre_due or v_live_due then now() else last_prematch_sync_at end,
      last_schedule_sync_at = case when v_schedule_due then now() else last_schedule_sync_at end,
      last_standings_sync_at = case when jsonb_array_length(v_standings) > 0 then now() else last_standings_sync_at end,
      last_leagues_sync_at = case when v_leagues_due then now() else last_leagues_sync_at end,
      last_squad_sync_at = case when v_squad_due then now() else last_squad_sync_at end,
      last_teamstats_sync_at = case when jsonb_array_length(v_teamstats) > 0 then now() else last_teamstats_sync_at end,
      last_discover_at = case when v_discover_due then now() else last_discover_at end,
      last_status_check_at = case when v_status_due then now() else last_status_check_at end,
      health = case when v_quota_blocked then 'quota' else health end
    where id = 1;
    if cardinality(v_resync_ids) > 0 and not v_quota_blocked then
      update public.sports_fixtures set resync_requested_at = null where id = any (v_resync_ids);
    end if;
  end if;

  return v_jobs;
end;
$$;

create or replace function public.sports_worker_report(p_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log jsonb;
  v_errors integer := 0;
  v_quota jsonb := p_report -> 'quota';
  v_run uuid := nullif(p_report ->> 'run_id', '')::uuid;
  v_key_missing boolean := coalesce((p_report ->> 'key_missing')::boolean, false);
  v_quota_hit boolean := false;
begin
  for v_log in select * from jsonb_array_elements(coalesce(p_report -> 'logs', '[]'::jsonb)) limit 80 loop
    insert into public.sports_sync_logs (run_id, trigger, job, endpoint, params, status, http_status, results,
                                         duration_ms, remaining, error, api_errors)
    values (v_run, left(p_report ->> 'trigger', 30), left(coalesce(v_log ->> 'job', 'unknown'), 40), left(v_log ->> 'endpoint', 60),
            coalesce(v_log -> 'params', '{}'::jsonb),
            case when v_log ->> 'status' in ('ok', 'error', 'skipped', 'quota') then v_log ->> 'status' else 'error' end,
            public.sports_int(v_log ->> 'http_status'), public.sports_int(v_log ->> 'results'),
            public.sports_int(v_log ->> 'duration_ms'), public.sports_int(v_log ->> 'remaining'),
            left(v_log ->> 'error', 500), v_log -> 'api_errors');
    if coalesce((v_log ->> 'counted')::boolean, false) and v_log ->> 'endpoint' is not null then
      insert into public.sports_api_usage as u (day, endpoint, requests, failures, last_at)
      values ((now() at time zone 'UTC')::date, left(v_log ->> 'endpoint', 60), 1,
              case when v_log ->> 'status' = 'ok' then 0 else 1 end, now())
      on conflict (day, endpoint) do update
        set requests = u.requests + 1, failures = u.failures + excluded.failures, last_at = now();
    end if;
    if v_log ->> 'status' = 'error' then
      v_errors := v_errors + 1;
    elsif v_log ->> 'status' = 'quota' then
      v_quota_hit := true;
    end if;
  end loop;

  update public.sports_settings set
    api_key_present = not v_key_missing,
    api_plan = coalesce(v_quota ->> 'plan', api_plan),
    api_account = coalesce(v_quota -> 'account', api_account),
    api_limit_day = coalesce(public.sports_int(v_quota ->> 'limit_day'), api_limit_day),
    api_remaining_day = coalesce(public.sports_int(v_quota ->> 'remaining_day'), api_remaining_day),
    api_quota_at = case when v_quota ? 'remaining_day' then now() else api_quota_at end,
    consecutive_failures = case when v_errors > 0 then consecutive_failures + 1 else 0 end,
    health = case
      when v_key_missing then 'unconfigured'
      when v_quota_hit then 'quota'
      when v_errors > 0 and consecutive_failures + 1 >= 3 then 'down'
      when v_errors > 0 then 'degraded'
      when jsonb_array_length(coalesce(p_report -> 'logs', '[]'::jsonb)) > 0 then 'ok'
      else health end,
    last_error = case when v_errors > 0 or v_key_missing then left(coalesce(p_report ->> 'error',
                   (select l ->> 'error' from jsonb_array_elements(p_report -> 'logs') l where l ->> 'status' = 'error' limit 1)), 500)
                 else last_error end,
    last_error_at = case when v_errors > 0 or v_key_missing then now() else last_error_at end,
    last_tick_at = now(),
    worker_lock_until = null
  where id = 1;

  if jsonb_typeof(p_report -> 'verified_ids') = 'array' then
    update public.sports_fixtures set final_verified_at = now()
     where id in (select (x #>> '{}')::bigint from jsonb_array_elements(p_report -> 'verified_ids') x)
       and public.sports_phase_is_finished(phase);
  end if;

  delete from public.sports_sync_logs where created_at < now() - interval '30 days';
  delete from public.sports_chat_presence where last_seen_at < now() - interval '1 day';
  return jsonb_build_object('ok', true, 'errors', v_errors);
end;
$$;

create or replace function public.sports_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.sports_settings;
  v_token text;
  v_plan jsonb;
  v_request bigint;
  v_has_work boolean;
begin
  select * into s from public.sports_settings where id = 1 for update;
  if s.worker_url is null then
    return jsonb_build_object('queued', false, 'reason', 'worker_url_missing');
  end if;
  if s.worker_lock_until is not null and s.worker_lock_until > now() then
    return jsonb_build_object('queued', false, 'reason', 'locked');
  end if;

  perform public.sports_queue_due_reminders();
  v_plan := public.sports_worker_plan(true, '{}');

  v_has_work := jsonb_array_length(v_plan -> 'fixtures') > 0
             or (v_plan ->> 'schedule')::boolean or jsonb_array_length(v_plan -> 'standings') > 0
             or (v_plan ->> 'leagues')::boolean or (v_plan ->> 'squad')::boolean
             or jsonb_array_length(v_plan -> 'teamstats') > 0 or (v_plan ->> 'discover')::boolean
             or (v_plan ->> 'status')::boolean or (v_plan ->> 'dispatch')::boolean;
  if not v_has_work then
    return jsonb_build_object('queued', false, 'reason', 'not_due');
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'sports_worker_secret';
  if v_token is null then
    return jsonb_build_object('queued', false, 'reason', 'secret_missing');
  end if;

  update public.sports_settings set worker_lock_until = now() + interval '55 seconds' where id = 1;

  select net.http_post(
    url := rtrim(s.worker_url, '/') || '/functions/v1/sports-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sports-token', v_token),
    body := jsonb_build_object('action', 'tick', 'trigger', 'cron', 'plan', v_plan),
    timeout_milliseconds := 55000
  ) into v_request;

  return jsonb_build_object('queued', true, 'request_id', v_request, 'plan', v_plan);
end;
$$;

-- Admin "şimdi çalıştır" isteği: edge function admin yetkisini doğruladıktan sonra çağırır.
create or replace function public.sports_worker_force_plan(p_jobs text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.sports_worker_plan(true, coalesce(p_jobs, '{}'));
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
       and p.proname in ('sports_worker_token_ok', 'sports_worker_plan', 'sports_worker_report', 'sports_tick',
                         'sports_worker_force_plan')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if fn.proname <> 'sports_tick' then
      execute format('grant execute on function %s to service_role', fn.sig);
    end if;
  end loop;
end $$;

select cron.unschedule('sports-sync')
where exists (select 1 from cron.job where jobname = 'sports-sync');

select cron.schedule(
  'sports-sync',
  '15 seconds',
  $$select public.sports_tick();$$
);
