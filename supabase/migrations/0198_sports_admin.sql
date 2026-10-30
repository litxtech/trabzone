-- ---------------------------------------------------------------------------
-- 0198 — Maç Arenası: Admin Control Center RPC'leri
--
-- Her yazma işlemi yetki kontrolü (tz_admin_require), gerekçe ve
-- sports_admin_audit_logs kaydı gerektirir. Skor ve gol kayıtları elle
-- değiştirilemez: yalnızca kaynaktan yeniden senkron veya gerekçeli olay
-- gizleme yapılabilir (gizlenen olay iz bırakır, silinmez).
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

alter table public.sports_fixtures add column if not exists resync_requested_at timestamptz;

create or replace function public.sports_admin_check(p_permission text default 'sports.manage')
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_permission not in ('sports.view', 'sports.manage', 'sports.data', 'sports.moderate', 'sports.notify') then
    raise exception 'invalid_permission' using errcode = '22023';
  end if;
  perform public.tz_admin_require(p_permission);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Gösterge paneli
-- ---------------------------------------------------------------------------
create or replace function public.sports_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  v_live bigint;
  v_next bigint;
  v_used integer;
begin
  perform public.tz_admin_require('sports.view');
  select * into s from public.sports_settings where id = 1;
  select id into v_live from public.sports_fixtures
   where public.sports_phase_is_live(phase) and not is_test order by kickoff_at desc limit 1;
  select id into v_next from public.sports_fixtures
   where phase = 'scheduled' and kickoff_at > now() - interval '3 hours' and not is_test order by kickoff_at limit 1;
  select coalesce(sum(requests), 0) into v_used from public.sports_api_usage where day = (now() at time zone 'UTC')::date;

  return jsonb_build_object(
    'configured', jsonb_build_object('api_key', s.api_key_present, 'team_id', s.team_id, 'season', s.season,
                                     'team_verified_at', s.team_verified_at, 'worker_url', s.worker_url is not null,
                                     'sync_enabled', s.sync_enabled),
    'health', s.health,
    'last_error', s.last_error,
    'last_error_at', s.last_error_at,
    'consecutive_failures', s.consecutive_failures,
    'live', case when v_live is not null then public.sports_fixture_json(v_live) end,
    'next', case when v_next is not null then public.sports_fixture_json(v_next) end,
    'last_sync', jsonb_build_object('tick', s.last_tick_at, 'live', s.last_live_sync_at, 'prematch', s.last_prematch_sync_at,
                                    'schedule', s.last_schedule_sync_at, 'standings', s.last_standings_sync_at,
                                    'leagues', s.last_leagues_sync_at, 'squad', s.last_squad_sync_at,
                                    'status', s.last_status_check_at),
    'quota', jsonb_build_object('plan', s.api_plan, 'limit_day', s.api_limit_day, 'remaining_day', s.api_remaining_day,
                                'checked_at', s.api_quota_at, 'used_today', v_used, 'budget', s.daily_request_budget,
                                'reserve', s.request_reserve),
    'chat', jsonb_build_object(
      'messages_10m', (select count(*) from public.sports_chat_messages where created_at > now() - interval '10 minutes' and kind = 'user'),
      'active_users', (select count(distinct user_id) from public.sports_chat_presence where last_seen_at > now() - interval '2 minutes'),
      'open_reports', (select count(*) from public.sports_chat_reports where status = 'open')),
    'notifications', jsonb_build_object(
      'queued', (select count(*) from public.sports_notification_events where processing_status in ('pending', 'fanning_out')),
      'push_pending', (select count(*) from public.sports_notification_deliveries where channel = 'push' and delivery_status in ('pending', 'sending')),
      'push_sent_24h', (select count(*) from public.sports_notification_deliveries where channel = 'push'
                          and delivery_status in ('sent', 'delivered') and sent_at > now() - interval '24 hours'),
      'push_failed_24h', (select count(*) from public.sports_notification_deliveries where channel = 'push'
                            and delivery_status in ('failed', 'invalid_token', 'expired') and created_at > now() - interval '24 hours'),
      'subscribers', (select count(*) from public.sports_notification_preferences where enabled)),
    'recent_errors', coalesce((select jsonb_agg(jsonb_build_object('at', l.created_at, 'job', l.job, 'endpoint', l.endpoint,
                                                                    'error', l.error, 'http_status', l.http_status) order by l.created_at desc)
                                 from (select * from public.sports_sync_logs where status in ('error', 'quota')
                                        order by created_at desc limit 8) l), '[]'::jsonb),
    'counts', jsonb_build_object(
      'fixtures', (select count(*) from public.sports_fixtures where not is_test),
      'competitions', (select count(*) from public.sports_competitions where is_current),
      'pending_media', (select count(*) from public.sports_fixture_media where created_at > now() - interval '24 hours'),
      'test_fixtures', (select count(*) from public.sports_fixtures where is_test))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Ayarlar ve API yönetimi
-- ---------------------------------------------------------------------------
create or replace function public.sports_admin_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
begin
  perform public.tz_admin_require('sports.view');
  select * into s from public.sports_settings where id = 1;
  return (to_jsonb(s) - 'worker_lock_until')
    || jsonb_build_object(
      'competitions', coalesce((select jsonb_agg(jsonb_build_object(
                         'league_id', c.league_id, 'season', c.season, 'name', c.name, 'type', c.type, 'country', c.country,
                         'is_current', c.is_current, 'is_enabled', c.is_enabled, 'priority', c.priority,
                         'coverage', c.coverage, 'start_date', c.start_date, 'end_date', c.end_date,
                         'last_synced_at', c.last_synced_at) order by c.is_current desc, c.priority, c.name)
                         from public.sports_competitions c), '[]'::jsonb),
      'team', (select to_jsonb(t) from public.sports_teams t where t.id = s.team_id),
      'secret_name', 'API_FOOTBALL_KEY'
    );
end;
$$;

create or replace function public.sports_admin_settings_update(p_patch jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.manage', true);
  v_reason text := public.sports_require_reason(p_reason);
  v_before jsonb;
  v_allowed text[] := array[
    'team_search', 'season', 'season_auto', 'sync_enabled', 'live_interval_seconds', 'stats_interval_seconds',
    'prematch_interval_seconds', 'schedule_interval_minutes', 'matchday_schedule_interval_minutes',
    'standings_interval_minutes', 'leagues_interval_hours', 'squad_interval_hours', 'daily_request_budget',
    'request_reserve', 'feed_card_enabled', 'feed_prematch_minutes', 'feed_postmatch_minutes', 'feed_default_view',
    'feed_show_chat_count', 'feed_show_stats', 'feed_allow_hide', 'feed_show_archive', 'logos_enabled',
    'player_photos_enabled', 'rights_note', 'chat_enabled', 'chat_max_length', 'chat_rate_per_minute',
    'chat_duplicate_window_seconds', 'chat_links_allowed', 'chat_blocked_terms', 'chat_open_before_minutes',
    'chat_close_after_minutes', 'chat_retention_days', 'comments_enabled', 'auto_polls_enabled',
    'notifications_enabled', 'reminder_minutes'];
  k text;
  s public.sports_settings;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_allowed)) then
      raise exception 'sports_setting_not_allowed' using errcode = '22023', detail = k;
    end if;
  end loop;

  select to_jsonb(x) into v_before from public.sports_settings x where id = 1;
  select * into s from jsonb_populate_record(
           (select x from public.sports_settings x where id = 1),
           p_patch);

  update public.sports_settings set
    team_search = s.team_search, season = s.season, season_auto = s.season_auto, sync_enabled = s.sync_enabled,
    live_interval_seconds = s.live_interval_seconds, stats_interval_seconds = s.stats_interval_seconds,
    prematch_interval_seconds = s.prematch_interval_seconds, schedule_interval_minutes = s.schedule_interval_minutes,
    matchday_schedule_interval_minutes = s.matchday_schedule_interval_minutes,
    standings_interval_minutes = s.standings_interval_minutes, leagues_interval_hours = s.leagues_interval_hours,
    squad_interval_hours = s.squad_interval_hours, daily_request_budget = s.daily_request_budget,
    request_reserve = s.request_reserve, feed_card_enabled = s.feed_card_enabled,
    feed_prematch_minutes = s.feed_prematch_minutes, feed_postmatch_minutes = s.feed_postmatch_minutes,
    feed_default_view = s.feed_default_view, feed_show_chat_count = s.feed_show_chat_count,
    feed_show_stats = s.feed_show_stats, feed_allow_hide = s.feed_allow_hide, feed_show_archive = s.feed_show_archive,
    logos_enabled = s.logos_enabled, player_photos_enabled = s.player_photos_enabled, rights_note = s.rights_note,
    chat_enabled = s.chat_enabled, chat_max_length = s.chat_max_length, chat_rate_per_minute = s.chat_rate_per_minute,
    chat_duplicate_window_seconds = s.chat_duplicate_window_seconds, chat_links_allowed = s.chat_links_allowed,
    chat_blocked_terms = s.chat_blocked_terms, chat_open_before_minutes = s.chat_open_before_minutes,
    chat_close_after_minutes = s.chat_close_after_minutes, chat_retention_days = s.chat_retention_days,
    comments_enabled = s.comments_enabled, auto_polls_enabled = s.auto_polls_enabled,
    notifications_enabled = s.notifications_enabled, reminder_minutes = s.reminder_minutes,
    updated_at = now(), updated_by = v_uid
  where id = 1;

  perform public.sports_audit(v_uid, 'settings_updated', 'settings', '1', v_reason,
                              (select jsonb_object_agg(key, v_before -> key) from jsonb_object_keys(p_patch) key), p_patch);
  perform public.sports_broadcast(null, 'settings');
  return public.sports_admin_settings_get();
end;
$$;

create or replace function public.sports_admin_team_set(p_team_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.manage', true);
  v_reason text := public.sports_require_reason(p_reason);
  v_before bigint;
begin
  if not exists (select 1 from public.sports_teams where id = p_team_id) then
    raise exception 'sports_team_unknown' using errcode = '22023';
  end if;
  select team_id into v_before from public.sports_settings where id = 1;
  update public.sports_settings
     set team_id = p_team_id, team_verified_at = now(), team_verified_by = v_uid, updated_at = now(), updated_by = v_uid,
         last_schedule_sync_at = null, last_leagues_sync_at = null, last_standings_sync_at = null
   where id = 1;
  perform public.sports_audit(v_uid, 'team_set', 'team', p_team_id::text, v_reason,
                              jsonb_build_object('team_id', v_before), jsonb_build_object('team_id', p_team_id));
  return public.sports_admin_settings_get();
end;
$$;

create or replace function public.sports_admin_competition_update(
  p_league bigint, p_season integer, p_enabled boolean, p_priority integer, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.manage');
  v_reason text := public.sports_require_reason(p_reason);
begin
  update public.sports_competitions
     set is_enabled = coalesce(p_enabled, is_enabled), priority = coalesce(p_priority, priority)
   where league_id = p_league and season = p_season;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.sports_audit(v_uid, 'competition_updated', 'competition', p_league || ':' || p_season, v_reason, null,
                              jsonb_build_object('enabled', p_enabled, 'priority', p_priority));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sports_admin_sync_logs(p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('sports.view');
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc)
                         from (select * from public.sports_sync_logs
                                where p_status is null or status = p_status
                                order by created_at desc
                                limit least(greatest(coalesce(p_limit, 50), 1), 200)
                               offset greatest(coalesce(p_offset, 0), 0)) l), '[]'::jsonb),
    'usage', coalesce((select jsonb_agg(jsonb_build_object('day', u.day, 'endpoint', u.endpoint, 'requests', u.requests,
                                                           'failures', u.failures) order by u.day desc, u.endpoint)
                         from public.sports_api_usage u where u.day > (now() at time zone 'UTC')::date - 14), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Maç veri sağlığı
-- ---------------------------------------------------------------------------
create or replace function public.sports_admin_fixtures(
  p_scope text default 'recent', p_search text default null, p_limit integer default 30, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('sports.view');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(public.sports_fixture_json(f.id) || jsonb_build_object(
             'feature_state', f.feature_state, 'feature_reason', f.feature_reason, 'hidden', f.hidden,
             'hidden_reason', f.hidden_reason, 'sync_failures', f.sync_failures, 'last_sync_error', f.last_sync_error,
             'resync_requested_at', f.resync_requested_at,
             'counts', jsonb_build_object(
               'events', (select count(*) from public.sports_fixture_events e where e.fixture_id = f.id and e.status = 'active'),
               'retracted', (select count(*) from public.sports_fixture_events e where e.fixture_id = f.id and e.status = 'retracted'),
               'hidden_events', (select count(*) from public.sports_fixture_events e where e.fixture_id = f.id and e.status = 'hidden'),
               'stats', (select count(*) from public.sports_fixture_statistics x where x.fixture_id = f.id),
               'lineups', (select count(*) from public.sports_fixture_lineups x where x.fixture_id = f.id),
               'players', (select count(*) from public.sports_fixture_players x where x.fixture_id = f.id),
               'chat', (select count(*) from public.sports_chat_messages x where x.fixture_id = f.id and x.kind = 'user'),
               'comments', (select count(*) from public.sports_fixture_comments x where x.fixture_uid = f.uid)))
           order by case when p_scope = 'upcoming' then extract(epoch from f.kickoff_at) else -extract(epoch from f.kickoff_at) end)
      from (select * from public.sports_fixtures x
             where case p_scope
                     when 'live' then public.sports_phase_is_live(x.phase)
                     when 'upcoming' then x.phase = 'scheduled' and x.kickoff_at > now() - interval '3 hours'
                     when 'test' then x.is_test
                     when 'problems' then x.sync_failures > 0 or x.hidden or x.feature_state <> 'auto'
                     else x.kickoff_at < now() + interval '30 days'
                   end
               and (p_search is null or x.home_name ilike '%' || p_search || '%' or x.away_name ilike '%' || p_search || '%'
                    or x.id::text = p_search)
             order by case when p_scope = 'upcoming' then extract(epoch from x.kickoff_at) else -extract(epoch from x.kickoff_at) end
             limit least(greatest(coalesce(p_limit, 30), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) f
  ), '[]'::jsonb));
end;
$$;

create or replace function public.sports_admin_fixture_get(p_fixture bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.sports_fixtures;
begin
  perform public.tz_admin_require('sports.view');
  select * into f from public.sports_fixtures where id = p_fixture;
  if f.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'fixture', public.sports_fixture_json(p_fixture) || jsonb_build_object(
                 'feature_state', f.feature_state, 'feature_reason', f.feature_reason, 'hidden', f.hidden,
                 'hidden_reason', f.hidden_reason, 'sync_failures', f.sync_failures, 'last_sync_error', f.last_sync_error,
                 'chat_slow_mode_seconds', f.chat_slow_mode_seconds, 'chat_pinned', f.chat_pinned,
                 'resync_requested_at', f.resync_requested_at),
    'events', coalesce((select jsonb_agg(public.sports_event_json(e) || jsonb_build_object(
                          'status', e.status, 'hidden_reason', e.hidden_reason, 'event_key', e.event_key,
                          'missing_count', e.missing_count, 'revisions', e.revisions, 'retracted_at', e.retracted_at,
                          'last_seen_at', e.last_seen_at)
                          order by coalesce(e.minute, 0), coalesce(e.extra, 0), e.sort_index)
                          from public.sports_fixture_events e where e.fixture_id = p_fixture), '[]'::jsonb),
    'phases', coalesce((select jsonb_agg(jsonb_build_object('status', l.status_short, 'elapsed', l.elapsed, 'at', l.observed_at)
                                         order by l.observed_at)
                          from public.sports_fixture_status_log l where l.fixture_id = p_fixture), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'type', n.type, 'key', n.dedupe_key,
                                  'title', n.title, 'body', n.body, 'status', n.processing_status, 'recipients', n.recipients,
                                  'created_at', n.created_at) order by n.created_at)
                                 from public.sports_notification_events n where n.fixture_id = p_fixture), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'reason', a.reason,
                          'actor', public.sports_author_json(a.actor_id)) order by a.created_at desc)
                         from public.sports_admin_audit_logs a
                        where (a.target_type = 'fixture' and a.target_id = p_fixture::text)
                           or (a.target_type = 'event' and a.target_id in (select id::text from public.sports_fixture_events where fixture_id = p_fixture))),
                      '[]'::jsonb)
  );
end;
$$;

create or replace function public.sports_admin_fixture_action(p_fixture bigint, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_reason text := public.sports_require_reason(p_reason);
  f public.sports_fixtures;
  v_perm text;
  v_after jsonb;
begin
  v_perm := case
    when p_action in ('pin', 'unpin', 'suppress', 'unsuppress', 'hide', 'unhide', 'resync') then 'sports.data'
    when p_action in ('chat_open', 'chat_pause', 'chat_close', 'chat_auto', 'slow_mode', 'chat_pin', 'chat_unpin',
                      'chat_clear', 'lock_comments', 'unlock_comments') then 'sports.moderate'
    else null end;
  if v_perm is null then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  v_uid := public.tz_admin_require(v_perm);
  select * into f from public.sports_fixtures where id = p_fixture for update;
  if f.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  case p_action
    when 'pin' then update public.sports_fixtures set feature_state = 'pinned', feature_reason = v_reason where id = p_fixture;
    when 'unpin', 'unsuppress' then update public.sports_fixtures set feature_state = 'auto', feature_reason = null where id = p_fixture;
    when 'suppress' then update public.sports_fixtures set feature_state = 'suppressed', feature_reason = v_reason where id = p_fixture;
    when 'hide' then update public.sports_fixtures set hidden = true, hidden_reason = v_reason where id = p_fixture;
    when 'unhide' then update public.sports_fixtures set hidden = false, hidden_reason = null where id = p_fixture;
    when 'resync' then update public.sports_fixtures set resync_requested_at = now() where id = p_fixture;
    when 'chat_open' then update public.sports_fixtures set chat_state = 'open' where id = p_fixture;
    when 'chat_pause' then update public.sports_fixtures set chat_state = 'paused' where id = p_fixture;
    when 'chat_close' then update public.sports_fixtures set chat_state = 'closed' where id = p_fixture;
    when 'chat_auto' then update public.sports_fixtures set chat_state = 'auto' where id = p_fixture;
    when 'slow_mode' then
      update public.sports_fixtures
         set chat_slow_mode_seconds = least(greatest(coalesce((p_payload ->> 'seconds')::integer, 0), 0), 600)
       where id = p_fixture;
    when 'chat_pin' then
      if char_length(trim(coalesce(p_payload ->> 'body', ''))) < 2 then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      update public.sports_fixtures
         set chat_pinned = jsonb_build_object('body', left(trim(p_payload ->> 'body'), 280), 'at', now(),
                                              'by', public.sports_author_json(v_uid))
       where id = p_fixture;
    when 'chat_unpin' then update public.sports_fixtures set chat_pinned = null where id = p_fixture;
    when 'chat_clear' then
      update public.sports_chat_messages
         set status = 'removed', removed_by = v_uid, removed_reason = v_reason, updated_at = now()
       where fixture_id = p_fixture and status = 'visible' and kind <> 'system';
    when 'lock_comments' then update public.sports_fixtures set comments_locked = true where id = p_fixture;
    when 'unlock_comments' then update public.sports_fixtures set comments_locked = false where id = p_fixture;
  end case;

  select jsonb_build_object('feature_state', x.feature_state, 'hidden', x.hidden, 'chat_state', x.chat_state,
                            'slow_mode', x.chat_slow_mode_seconds, 'comments_locked', x.comments_locked)
    into v_after from public.sports_fixtures x where x.id = p_fixture;
  perform public.sports_audit(v_uid, 'fixture_' || p_action, 'fixture', p_fixture::text, v_reason,
                              jsonb_build_object('feature_state', f.feature_state, 'hidden', f.hidden, 'chat_state', f.chat_state,
                                                 'slow_mode', f.chat_slow_mode_seconds, 'comments_locked', f.comments_locked),
                              v_after || coalesce(p_payload, '{}'::jsonb));
  perform public.sports_broadcast(p_fixture, 'fixture');
  if p_action like 'chat\_%' or p_action = 'slow_mode' then
    perform public.sports_chat_publish(p_fixture, 'room', jsonb_build_object('action', p_action));
  end if;
  return public.sports_admin_fixture_get(p_fixture);
end;
$$;

create or replace function public.sports_admin_event_action(p_event uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.data', true);
  v_reason text := public.sports_require_reason(p_reason);
  e public.sports_fixture_events;
begin
  select * into e from public.sports_fixture_events where id = p_event for update;
  if e.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_action = 'hide' then
    update public.sports_fixture_events set status = 'hidden', hidden_reason = v_reason where id = p_event;
  elsif p_action = 'unhide' then
    update public.sports_fixture_events set status = 'active', hidden_reason = null, missing_count = 0 where id = p_event;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  perform public.sports_audit(v_uid, 'event_' || p_action, 'event', p_event::text, v_reason,
                              public.sports_event_json(e) || jsonb_build_object('status', e.status), null);
  perform public.sports_broadcast(e.fixture_id, 'fixture');
  return public.sports_admin_fixture_get(e.fixture_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Sohbet moderasyonu
-- ---------------------------------------------------------------------------
create or replace function public.sports_admin_chat_messages(
  p_fixture bigint, p_status text default null, p_before bigint default null, p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('sports.moderate');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(public.sports_chat_message_json(m.id, null) || jsonb_build_object(
             'raw_body', m.body, 'removed_reason', m.removed_reason,
             'reports', (select count(*) from public.sports_chat_reports r where r.message_id = m.id)) order by m.id desc)
      from (select * from public.sports_chat_messages
             where fixture_id = p_fixture and (p_status is null or status = p_status)
               and (p_before is null or id < p_before)
             order by id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) m
  ), '[]'::jsonb));
end;
$$;

create or replace function public.sports_admin_chat_reports(p_status text default 'open', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('sports.moderate');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'reason', r.reason, 'note', r.note, 'status', r.status, 'created_at', r.created_at,
             'reporter', public.sports_author_json(r.reporter_id),
             'message', public.sports_chat_message_json(r.message_id, null)
                        || jsonb_build_object('raw_body', m.body, 'user_id', m.user_id),
             'fixture', jsonb_build_object('id', f.id, 'home', f.home_name, 'away', f.away_name),
             'total_reports', (select count(*) from public.sports_chat_reports x where x.message_id = r.message_id))
           order by r.created_at desc)
      from (select * from public.sports_chat_reports
             where p_status is null or status = p_status
             order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)
            offset greatest(coalesce(p_offset, 0), 0)) r
      join public.sports_chat_messages m on m.id = r.message_id
      join public.sports_fixtures f on f.id = m.fixture_id
  ), '[]'::jsonb));
end;
$$;

create or replace function public.sports_admin_chat_report_resolve(p_report uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.moderate');
  v_reason text := public.sports_require_reason(p_reason);
  r public.sports_chat_reports;
begin
  select * into r from public.sports_chat_reports where id = p_report;
  if r.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_action = 'remove' then
    perform public.sports_chat_mod_remove(r.message_id, v_reason);
  elsif p_action = 'dismiss' then
    update public.sports_chat_reports set status = 'dismissed', resolved_by = v_uid, resolved_at = now()
     where message_id = r.message_id and status = 'open';
    perform public.sports_audit(v_uid, 'chat_report_dismissed', 'chat_message', r.message_id::text, v_reason);
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sports_admin_sanctions(p_active boolean default true, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('sports.moderate');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'fixture_id', x.fixture_id, 'expires_at', x.expires_at,
                                        'reason', x.reason, 'created_at', x.created_at, 'revoked_at', x.revoked_at,
                                        'user', public.sports_author_json(x.user_id),
                                        'by', public.sports_author_json(x.created_by)) order by x.created_at desc)
      from (select * from public.sports_chat_sanctions s
             where not p_active or (s.revoked_at is null and (s.expires_at is null or s.expires_at > now()))
             order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300)) x
  ), '[]'::jsonb));
end;
$$;

create or replace function public.sports_admin_sanction_revoke(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.moderate');
  v_reason text := public.sports_require_reason(p_reason);
  v_user uuid;
begin
  update public.sports_chat_sanctions set revoked_at = now(), revoked_by = v_uid
   where id = p_id and revoked_at is null
  returning user_id into v_user;
  if v_user is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.sports_audit(v_uid, 'chat_sanction_revoked', 'user', v_user::text, v_reason, null, jsonb_build_object('sanction_id', p_id));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sports_admin_sanction_by_username(
  p_username text, p_kind text, p_minutes integer, p_reason text, p_fixture bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  perform public.tz_admin_require('sports.moderate');
  select id into v_user from public.profiles where lower(username) = lower(trim(both '@' from coalesce(p_username, '')));
  if v_user is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return public.sports_chat_mod_sanction(v_user, p_kind, p_minutes, p_reason, p_fixture);
end;
$$;

create or replace function public.sports_admin_moderators()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('sports.moderate');
  return coalesce((select jsonb_agg(jsonb_build_object('user', public.sports_author_json(m.user_id),
                                                       'added_by', public.sports_author_json(m.added_by),
                                                       'created_at', m.created_at) order by m.created_at desc)
                     from public.sports_chat_moderators m), '[]'::jsonb);
end;
$$;

create or replace function public.sports_admin_moderator_set(p_username text, p_add boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.moderate', true);
  v_reason text := public.sports_require_reason(p_reason);
  v_user uuid;
begin
  select id into v_user from public.profiles
   where lower(username) = lower(trim(both '@' from coalesce(p_username, ''))) and account_status = 'active';
  if v_user is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_add then
    insert into public.sports_chat_moderators (user_id, added_by) values (v_user, v_uid) on conflict do nothing;
  else
    delete from public.sports_chat_moderators where user_id = v_user;
  end if;
  perform public.sports_audit(v_uid, case when p_add then 'moderator_added' else 'moderator_removed' end,
                              'user', v_user::text, v_reason);
  return public.sports_admin_moderators();
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Yorum ve medya moderasyonu
-- ---------------------------------------------------------------------------
create or replace function public.sports_admin_comments(
  p_fixture bigint default null, p_status text default null, p_limit integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('sports.moderate');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'status', c.moderation_status,
                                        'reason', c.moderation_reason, 'parent_id', c.parent_id, 'like_count', c.like_count,
                                        'created_at', c.created_at, 'author', public.sports_author_json(c.author_id),
                                        'fixture', jsonb_build_object('id', f.id, 'home', f.home_name, 'away', f.away_name),
                                        'reports', (select count(*) from public.user_reports ur
                                                     where ur.target_type = 'comment' and ur.target_id = c.id::text))
                     order by c.created_at desc)
      from (select * from public.sports_fixture_comments x
             where (p_status is null or x.moderation_status = p_status)
               and (p_fixture is null or x.fixture_uid = (select uid from public.sports_fixtures where id = p_fixture))
             order by x.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)
            offset greatest(coalesce(p_offset, 0), 0)) c
      join public.sports_fixtures f on f.uid = c.fixture_uid
  ), '[]'::jsonb));
end;
$$;

create or replace function public.sports_admin_comment_action(p_comment uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.moderate');
  v_reason text := public.sports_require_reason(p_reason);
  c public.sports_fixture_comments;
begin
  select * into c from public.sports_fixture_comments where id = p_comment;
  if c.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_action not in ('hide', 'restore', 'remove') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  update public.sports_fixture_comments
     set moderation_status = case p_action when 'restore' then 'visible' when 'hide' then 'hidden' else 'removed' end,
         moderation_reason = case when p_action = 'restore' then null else v_reason end, updated_at = now()
   where id = p_comment;
  perform public.sports_audit(v_uid, 'comment_' || p_action, 'comment', p_comment::text, v_reason,
                              jsonb_build_object('body', c.body, 'status', c.moderation_status, 'author_id', c.author_id), null);
  perform public.sports_broadcast((select id from public.sports_fixtures where uid = c.fixture_uid), 'comments');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sports_admin_media(p_status text default null, p_fixture bigint default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.moderate');
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'category', m.category, 'status', m.status, 'hidden_reason', m.hidden_reason,
                                        'created_at', m.created_at, 'post', public.tz_post_json(m.post_id, v_uid),
                                        'fixture', jsonb_build_object('id', f.id, 'home', f.home_name, 'away', f.away_name))
                     order by m.created_at desc)
      from (select * from public.sports_fixture_media x
             where (p_status is null or x.status = p_status) and (p_fixture is null or x.fixture_id = p_fixture)
             order by x.created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)
            offset greatest(coalesce(p_offset, 0), 0)) m
      join public.sports_fixtures f on f.id = m.fixture_id
  ), '[]'::jsonb));
end;
$$;

create or replace function public.sports_admin_media_action(p_media uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.moderate');
  v_reason text := public.sports_require_reason(p_reason);
  v_fixture bigint;
begin
  if p_action not in ('hide', 'restore') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  update public.sports_fixture_media
     set status = case when p_action = 'hide' then 'hidden' else 'visible' end,
         hidden_reason = case when p_action = 'hide' then v_reason end,
         hidden_by = case when p_action = 'hide' then v_uid end
   where id = p_media
  returning fixture_id into v_fixture;
  if v_fixture is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.sports_audit(v_uid, 'media_' || p_action, 'media', p_media::text, v_reason);
  perform public.sports_broadcast(v_fixture, 'media');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sports_admin_news_link(p_fixture bigint, p_post uuid, p_add boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.moderate');
  v_reason text := public.sports_require_reason(p_reason);
begin
  if p_add then
    if not exists (select 1 from public.posts where id = p_post and moderation_status = 'visible' and visibility = 'public') then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    insert into public.sports_fixture_news (fixture_id, post_id, added_by) values (p_fixture, p_post, v_uid) on conflict do nothing;
  else
    delete from public.sports_fixture_news where fixture_id = p_fixture and post_id = p_post;
  end if;
  perform public.sports_audit(v_uid, case when p_add then 'news_linked' else 'news_unlinked' end, 'fixture', p_fixture::text,
                              v_reason, null, jsonb_build_object('post_id', p_post));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Anket yönetimi
-- ---------------------------------------------------------------------------
create or replace function public.sports_admin_polls(p_fixture bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('sports.moderate');
  return coalesce((
    select jsonb_agg(public.sports_poll_json(p.id, null) || jsonb_build_object(
             'status', p.status, 'auto_key', p.auto_key, 'created_at', p.created_at,
             'real_total', p.total_votes,
             'real_options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'votes', o.votes) order by o.sort_order)
                                from public.sports_poll_options o where o.poll_id = p.id),
             'new_account_votes', (select count(*) from public.sports_poll_votes v join public.profiles pr on pr.id = v.user_id
                                    where v.poll_id = p.id and pr.created_at > v.created_at - interval '24 hours'),
             'changed_votes', (select count(*) from public.sports_poll_votes v where v.poll_id = p.id and v.change_count > 0))
           order by p.created_at desc)
      from public.sports_polls p where p.fixture_id = p_fixture
  ), '[]'::jsonb);
end;
$$;

create or replace function public.sports_admin_poll_create(
  p_fixture bigint, p_question text, p_options text[], p_closes_at timestamptz, p_allow_change boolean,
  p_visibility text, p_reason text, p_opens_at timestamptz default null, p_draft boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.moderate');
  v_reason text := public.sports_require_reason(p_reason);
  v_id uuid;
begin
  if not exists (select 1 from public.sports_fixtures where id = p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if char_length(trim(coalesce(p_question, ''))) < 5 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_visibility not in ('after_vote', 'always', 'after_close') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_closes_at is not null and p_closes_at <= coalesce(p_opens_at, now()) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_id := public.sports_poll_create_internal(p_fixture, p_question, 'custom',
            array(select trim(x) from unnest(p_options) x where char_length(trim(x)) > 0),
            null, p_closes_at, p_allow_change, p_visibility, v_uid, null, p_opens_at,
            case when p_draft then 'draft' else 'active' end);
  perform public.sports_audit(v_uid, 'poll_created', 'poll', v_id::text, v_reason, null,
                              jsonb_build_object('fixture_id', p_fixture, 'question', p_question, 'options', p_options));
  perform public.sports_broadcast(p_fixture, 'polls');
  return public.sports_admin_polls(p_fixture);
end;
$$;

create or replace function public.sports_admin_poll_action(p_poll uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.moderate');
  v_reason text := public.sports_require_reason(p_reason);
  p public.sports_polls;
begin
  select * into p from public.sports_polls where id = p_poll;
  if p.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_action = 'close' then
    update public.sports_polls set status = 'closed', closes_at = least(coalesce(closes_at, now()), now()), updated_at = now() where id = p_poll;
  elsif p_action = 'disable' then
    update public.sports_polls set status = 'disabled', updated_at = now() where id = p_poll;
  elsif p_action = 'activate' then
    update public.sports_polls set status = 'active', updated_at = now(),
           closes_at = case when closes_at is not null and closes_at <= now() then null else closes_at end
     where id = p_poll;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  perform public.sports_audit(v_uid, 'poll_' || p_action, 'poll', p_poll::text, v_reason,
                              jsonb_build_object('status', p.status, 'closes_at', p.closes_at), null);
  perform public.sports_broadcast(p.fixture_id, 'polls');
  return public.sports_admin_polls(p.fixture_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Bildirim yönetimi
-- ---------------------------------------------------------------------------
create or replace function public.sports_admin_notifications(p_limit integer default 40, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('sports.view');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id, 'fixture_id', n.fixture_id, 'type', n.type, 'key', n.dedupe_key, 'title', n.title, 'body', n.body,
             'status', n.processing_status, 'recipients', n.recipients, 'is_test', n.is_test, 'created_at', n.created_at,
             'processed_at', n.processed_at, 'last_error', n.last_error,
             'push', (select jsonb_build_object(
                        'sent', count(*) filter (where d.delivery_status in ('sent', 'delivered')),
                        'delivered', count(*) filter (where d.delivery_status = 'delivered'),
                        'pending', count(*) filter (where d.delivery_status in ('pending', 'sending')),
                        'suppressed', count(*) filter (where d.delivery_status = 'suppressed'),
                        'failed', count(*) filter (where d.delivery_status in ('failed', 'invalid_token', 'expired')))
                        from public.sports_notification_deliveries d
                       where d.notification_event_id = n.id and d.channel = 'push'))
           order by n.created_at desc)
      from (select * from public.sports_notification_events order by created_at desc
             limit least(greatest(coalesce(p_limit, 40), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) n
  ), '[]'::jsonb));
end;
$$;

create or replace function public.sports_admin_announcement(p_fixture bigint, p_title text, p_body text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.notify', true);
  v_reason text := public.sports_require_reason(p_reason);
  v_id uuid;
begin
  if char_length(trim(coalesce(p_title, ''))) < 3 or char_length(trim(coalesce(p_body, ''))) < 5 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_fixture is not null and not exists (select 1 from public.sports_fixtures where id = p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.safety_check_rate('sports_announcement', 10, interval '1 hour');
  v_id := gen_random_uuid();
  insert into public.sports_notification_events (id, fixture_id, type, dedupe_key, title, body, payload, is_test, created_by)
  values (v_id, p_fixture, 'announcement', 'ann:' || v_id::text, left(trim(p_title), 120), left(trim(p_body), 300),
          jsonb_build_object('route', case when p_fixture is not null then '/trabzonspor/mac/' || p_fixture else '/trabzonspor' end),
          coalesce((select is_test from public.sports_fixtures where id = p_fixture), false), v_uid);
  perform public.sports_audit(v_uid, 'announcement_queued', 'notification', v_id::text, v_reason, null,
                              jsonb_build_object('title', p_title, 'body', p_body, 'fixture_id', p_fixture));
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.sports_admin_test_push(p_title text default null, p_body text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.notify');
  v_id uuid := gen_random_uuid();
begin
  perform public.safety_check_rate('sports_test_push', 10, interval '1 hour');
  insert into public.sports_notification_events (id, fixture_id, type, dedupe_key, title, body, payload, is_test, created_by)
  values (v_id, null, 'test', 'test:' || v_id::text,
          '[TEST] ' || coalesce(nullif(trim(p_title), ''), 'Maç bildirimi testi'),
          coalesce(nullif(trim(p_body), ''), 'Bu bir test bildirimidir. Yalnızca sana gönderildi.'),
          jsonb_build_object('route', '/trabzonspor'), true, v_uid);
  perform public.sports_audit(v_uid, 'test_push', 'notification', v_id::text, 'Test bildirimi');
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.sports_admin_notification_cancel(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.notify');
  v_reason text := public.sports_require_reason(p_reason);
begin
  update public.sports_notification_events set processing_status = 'cancelled', last_error = v_reason, processed_at = now()
   where id = p_id and processing_status in ('pending', 'fanning_out');
  update public.sports_notification_deliveries set delivery_status = 'suppressed', suppressed_reason = 'cancelled'
   where notification_event_id = p_id and delivery_status = 'pending';
  perform public.sports_audit(v_uid, 'notification_cancelled', 'notification', p_id::text, v_reason);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. TEST maçı simülatörü (uçtan uca boru hattı testi)
--
-- TEST maçları negatif id taşır; Feed'de yalnızca "TEST modunu göster" diyen
-- yetkili admine görünür, bildirimleri yalnızca testi başlatan admine gider.
-- Simülasyon gerçek ingest fonksiyonunu API biçimindeki yükle çağırır.
-- ---------------------------------------------------------------------------
create or replace function public.sports_test_payload(p_fixture bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'fixture', jsonb_build_object('id', f.id, 'timestamp', extract(epoch from f.kickoff_at)::bigint, 'timezone', 'UTC',
                                  'referee', f.referee, 'venue', jsonb_build_object('name', f.venue_name, 'city', f.venue_city),
                                  'status', jsonb_build_object('short', f.status_short, 'long', f.status_long,
                                                               'elapsed', f.elapsed, 'extra', f.status_extra)),
    'league', jsonb_build_object('id', f.league_id, 'name', f.league_name, 'country', f.league_country,
                                 'season', f.season, 'round', f.round, 'type', f.league_type),
    'teams', jsonb_build_object('home', jsonb_build_object('id', f.home_team_id, 'name', f.home_name),
                                'away', jsonb_build_object('id', f.away_team_id, 'name', f.away_name)),
    'goals', jsonb_build_object('home', f.goals_home, 'away', f.goals_away),
    'score', jsonb_build_object('halftime', jsonb_build_object('home', f.ht_home, 'away', f.ht_away),
                                'fulltime', jsonb_build_object('home', f.ft_home, 'away', f.ft_away),
                                'extratime', jsonb_build_object('home', f.et_home, 'away', f.et_away),
                                'penalty', jsonb_build_object('home', f.pen_home, 'away', f.pen_away)),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                          'time', jsonb_build_object('elapsed', e.minute, 'extra', e.extra),
                          'team', jsonb_build_object('id', e.team_id, 'name', e.team_name),
                          'player', jsonb_build_object('id', e.player_id, 'name', e.player_name),
                          'assist', jsonb_build_object('id', e.assist_id, 'name', e.assist_name),
                          'type', e.type_raw, 'detail', e.detail_raw, 'comments', e.comments) order by e.sort_index)
                          from public.sports_fixture_events e where e.fixture_id = f.id and e.status = 'active'), '[]'::jsonb)
  )
  from public.sports_fixtures f where f.id = p_fixture
$$;

create or replace function public.sports_admin_test_fixture_create(p_opponent text default 'TEST Rakip', p_kickoff_minutes integer default 45)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.data');
  v_id bigint;
  s public.sports_settings;
begin
  select * into s from public.sports_settings where id = 1;
  select least(coalesce(min(id), 0), 0) - 1 into v_id from public.sports_fixtures where is_test;
  if v_id > -900000 then
    v_id := -900000 - (select count(*) from public.sports_fixtures where is_test) - 1;
  end if;
  perform public.sports_ingest_fixture(jsonb_build_object(
    'fixture', jsonb_build_object('id', v_id, 'timestamp', extract(epoch from now() + make_interval(mins => greatest(coalesce(p_kickoff_minutes, 45), 1)))::bigint,
                                  'timezone', 'UTC', 'referee', 'TEST', 'venue', jsonb_build_object('name', 'TEST Stadyumu', 'city', 'Trabzon'),
                                  'status', jsonb_build_object('short', 'NS', 'long', 'Not Started')),
    'league', jsonb_build_object('id', 0, 'name', 'TEST Ligi', 'country', 'Turkey', 'season', coalesce(s.season, 0), 'round', 'TEST'),
    'teams', jsonb_build_object('home', jsonb_build_object('id', coalesce(s.team_id, 990001), 'name', 'TEST Trabzonspor'),
                                'away', jsonb_build_object('id', 990002, 'name', left(coalesce(nullif(trim(p_opponent), ''), 'TEST Rakip'), 60))),
    'goals', jsonb_build_object('home', null, 'away', null),
    'score', '{}'::jsonb
  ), jsonb_build_object('kind', 'test', 'is_test', true, 'primary_side', 'home', 'actor', v_uid));
  update public.sports_fixtures set test_created_by = v_uid where id = v_id;
  perform public.sports_audit(v_uid, 'test_fixture_created', 'fixture', v_id::text, 'TEST maçı oluşturuldu');
  return public.sports_admin_fixture_get(v_id);
end;
$$;

create or replace function public.sports_admin_test_fixture_step(p_fixture bigint, p_step text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.data');
  f public.sports_fixtures;
  p jsonb;
  v_elapsed integer;
  v_events jsonb;
  v_ev jsonb;
  v_home text;
  v_away text;
begin
  select * into f from public.sports_fixtures where id = p_fixture and is_test;
  if f.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  p := public.sports_test_payload(p_fixture);
  v_events := coalesce(p -> 'events', '[]'::jsonb);
  v_elapsed := coalesce(f.elapsed, 0);
  v_home := 'TEST Oyuncu ' || (1 + floor(random() * 11))::integer;
  v_away := 'TEST Rakip ' || (1 + floor(random() * 11))::integer;

  case p_step
    when 'lineups' then
      p := p || jsonb_build_object('lineups', jsonb_build_array(
        jsonb_build_object('team', jsonb_build_object('id', f.home_team_id, 'name', f.home_name), 'formation', '4-2-3-1',
          'coach', jsonb_build_object('id', null, 'name', 'TEST Teknik Direktör'),
          'startXI', (select jsonb_agg(jsonb_build_object('player', jsonb_build_object('id', 9100 + g, 'name', 'TEST Oyuncu ' || g,
                        'number', g, 'pos', case when g = 1 then 'G' when g <= 5 then 'D' when g <= 9 then 'M' else 'F' end,
                        'grid', case when g = 1 then '1:1' when g <= 5 then '2:' || (g - 1) when g <= 7 then '3:' || (g - 5)
                                     when g <= 10 then '4:' || (g - 7) else '5:1' end))) from generate_series(1, 11) g),
          'substitutes', (select jsonb_agg(jsonb_build_object('player', jsonb_build_object('id', 9200 + g, 'name', 'TEST Yedek ' || g,
                        'number', 11 + g, 'pos', 'M', 'grid', null))) from generate_series(1, 7) g)),
        jsonb_build_object('team', jsonb_build_object('id', f.away_team_id, 'name', f.away_name), 'formation', '4-4-2',
          'coach', jsonb_build_object('id', null, 'name', 'TEST Rakip Hoca'),
          'startXI', (select jsonb_agg(jsonb_build_object('player', jsonb_build_object('id', 9300 + g, 'name', 'TEST Rakip ' || g,
                        'number', g, 'pos', case when g = 1 then 'G' when g <= 5 then 'D' when g <= 9 then 'M' else 'F' end,
                        'grid', case when g = 1 then '1:1' when g <= 5 then '2:' || (g - 1) when g <= 9 then '3:' || (g - 5)
                                     else '4:' || (g - 9) end))) from generate_series(1, 11) g),
          'substitutes', '[]'::jsonb)));
    when 'kickoff' then
      p := jsonb_set(p, '{fixture,status}', '{"short":"1H","long":"First Half","elapsed":1}');
      p := jsonb_set(p, '{goals}', '{"home":0,"away":0}');
    when 'minute' then
      p := jsonb_set(p, '{fixture,status,elapsed}', to_jsonb(least(v_elapsed + 7, 120)));
    when 'goal_for', 'goal_against' then
      v_ev := jsonb_build_object('time', jsonb_build_object('elapsed', greatest(v_elapsed, 1), 'extra', null),
                                 'team', jsonb_build_object('id', case when p_step = 'goal_for' then f.home_team_id else f.away_team_id end,
                                                            'name', case when p_step = 'goal_for' then f.home_name else f.away_name end),
                                 'player', jsonb_build_object('id', null, 'name', case when p_step = 'goal_for' then v_home else v_away end),
                                 'assist', jsonb_build_object('id', null, 'name', null),
                                 'type', 'Goal', 'detail', 'Normal Goal', 'comments', null);
      p := jsonb_set(p, '{events}', v_events || jsonb_build_array(v_ev));
      if p_step = 'goal_for' then
        p := jsonb_set(p, '{goals,home}', to_jsonb(coalesce(f.goals_home, 0) + 1));
      else
        p := jsonb_set(p, '{goals,away}', to_jsonb(coalesce(f.goals_away, 0) + 1));
      end if;
    when 'yellow', 'red' then
      v_ev := jsonb_build_object('time', jsonb_build_object('elapsed', greatest(v_elapsed, 1), 'extra', null),
                                 'team', jsonb_build_object('id', f.away_team_id, 'name', f.away_name),
                                 'player', jsonb_build_object('id', null, 'name', v_away),
                                 'assist', jsonb_build_object('id', null, 'name', null),
                                 'type', 'Card', 'detail', case when p_step = 'red' then 'Red Card' else 'Yellow Card' end,
                                 'comments', 'TEST');
      p := jsonb_set(p, '{events}', v_events || jsonb_build_array(v_ev));
    when 'var_cancel' then
      -- Son golü kaynaktan geri çeker (iki senkron gerektirir; simülatör iki kez çağırır).
      select coalesce(jsonb_agg(x.e order by x.o), '[]'::jsonb) into v_events
        from jsonb_array_elements(v_events) with ordinality x(e, o)
       where x.o <> (select max(o) from jsonb_array_elements(v_events) with ordinality y(e, o) where y.e ->> 'type' = 'Goal');
      p := jsonb_set(p, '{events}', v_events);
      p := jsonb_set(p, '{goals}', jsonb_build_object(
             'home', (select count(*) from jsonb_array_elements(v_events) e where e ->> 'type' = 'Goal' and (e #>> '{team,id}')::bigint = f.home_team_id),
             'away', (select count(*) from jsonb_array_elements(v_events) e where e ->> 'type' = 'Goal' and (e #>> '{team,id}')::bigint = f.away_team_id)));
    when 'half_time' then
      p := jsonb_set(p, '{fixture,status}', jsonb_build_object('short', 'HT', 'long', 'Halftime', 'elapsed', 45));
      p := jsonb_set(p, '{score,halftime}', jsonb_build_object('home', coalesce(f.goals_home, 0), 'away', coalesce(f.goals_away, 0)));
    when 'second_half' then
      p := jsonb_set(p, '{fixture,status}', jsonb_build_object('short', '2H', 'long', 'Second Half', 'elapsed', 46));
    when 'full_time' then
      p := jsonb_set(p, '{fixture,status}', jsonb_build_object('short', 'FT', 'long', 'Match Finished', 'elapsed', 90));
      p := jsonb_set(p, '{score,fulltime}', jsonb_build_object('home', coalesce(f.goals_home, 0), 'away', coalesce(f.goals_away, 0)));
    when 'postpone' then
      p := jsonb_set(p, '{fixture,status}', jsonb_build_object('short', 'PST', 'long', 'Match Postponed', 'elapsed', null));
    when 'stats' then
      p := p || jsonb_build_object('statistics', jsonb_build_array(
        jsonb_build_object('team', jsonb_build_object('id', f.home_team_id), 'statistics', jsonb_build_array(
          jsonb_build_object('type', 'Ball Possession', 'value', (50 + floor(random() * 15))::int || '%'),
          jsonb_build_object('type', 'Total Shots', 'value', 3 + floor(random() * 10)::int),
          jsonb_build_object('type', 'Shots on Goal', 'value', 1 + floor(random() * 5)::int),
          jsonb_build_object('type', 'Corner Kicks', 'value', floor(random() * 8)::int),
          jsonb_build_object('type', 'Fouls', 'value', floor(random() * 12)::int),
          jsonb_build_object('type', 'Total passes', 'value', 200 + floor(random() * 200)::int),
          jsonb_build_object('type', 'Passes %', 'value', (75 + floor(random() * 15))::int || '%'),
          jsonb_build_object('type', 'Yellow Cards', 'value', null))),
        jsonb_build_object('team', jsonb_build_object('id', f.away_team_id), 'statistics', jsonb_build_array(
          jsonb_build_object('type', 'Ball Possession', 'value', (35 + floor(random() * 15))::int || '%'),
          jsonb_build_object('type', 'Total Shots', 'value', floor(random() * 8)::int),
          jsonb_build_object('type', 'Shots on Goal', 'value', floor(random() * 4)::int),
          jsonb_build_object('type', 'Corner Kicks', 'value', floor(random() * 6)::int),
          jsonb_build_object('type', 'Fouls', 'value', floor(random() * 14)::int),
          jsonb_build_object('type', 'Total passes', 'value', 150 + floor(random() * 150)::int),
          jsonb_build_object('type', 'Passes %', 'value', (65 + floor(random() * 15))::int || '%'),
          jsonb_build_object('type', 'Yellow Cards', 'value', 1)))));
    else
      raise exception 'invalid_action' using errcode = '22023';
  end case;

  perform public.sports_ingest_fixture(p, jsonb_build_object('kind', 'test', 'is_test', true,
                                                             'primary_side', f.primary_side, 'actor', v_uid));
  if p_step = 'var_cancel' then
    perform public.sports_ingest_fixture(p, jsonb_build_object('kind', 'test', 'is_test', true,
                                                               'primary_side', f.primary_side, 'actor', v_uid));
  end if;
  perform public.sports_audit(v_uid, 'test_fixture_step', 'fixture', p_fixture::text, 'TEST adımı: ' || p_step);
  return public.sports_admin_fixture_get(p_fixture);
end;
$$;

create or replace function public.sports_admin_test_fixture_delete(p_fixture bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.data');
begin
  delete from public.sports_fixtures where id = p_fixture and is_test;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.sports_audit(v_uid, 'test_fixture_deleted', 'fixture', p_fixture::text, 'TEST maçı silindi');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sports_admin_audit_list(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('sports.view');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.created_at, 'action', a.action, 'target_type', a.target_type,
                                        'target_id', a.target_id, 'reason', a.reason, 'before', a.before_data,
                                        'after', a.after_data, 'actor', public.sports_author_json(a.actor_id))
                     order by a.created_at desc)
      from (select * from public.sports_admin_audit_logs order by created_at desc
             limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) a
  ), '[]'::jsonb));
end;
$$;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'sports\_admin\_%' or p.proname = 'sports_test_payload')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if fn.proname like 'sports\_admin\_%' then
      execute format('grant execute on function %s to authenticated', fn.sig);
    end if;
  end loop;
end $$;
