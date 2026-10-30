-- ---------------------------------------------------------------------------
-- 0193 — Deprem Yönetim Merkezi (admin RPC'leri)
--
-- İlkeler:
--  * Kaynak ölçüm değerleri (büyüklük, derinlik, konum, zaman) admin
--    tarafından elle değiştirilemez. Yapılabilenler: incelemeye alma,
--    kaldırma/geri alma, gösterilecek kaynağı seçme (yalnızca bağlı kaynak
--    kayıtları arasından), eşleştirme kararı ve iç not. Her işlem gerekçe,
--    eski/yeni değer ve audit kaydı ister.
--  * Uydurma deprem oluşturup kullanıcılara bildirim gönderen bir yol yoktur.
--    Test bildirimi yalnızca işlemi yapan adminin kendi cihazlarına gider ve
--    "TEST" olarak etiketlenir.
--  * Kaynağı kapatmak geçmiş kayıtları silmez.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

create or replace function public.earthquake_audit(
  p_operation   text,
  p_target_type text,
  p_target_id   text,
  p_reason      text,
  p_old         jsonb,
  p_new         jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.earthquake_admin_audit_logs (admin_id, operation, target_type, target_id, reason, old_value, new_value)
  values (auth.uid(), p_operation, p_target_type, p_target_id, p_reason, p_old, p_new);
  perform public.tz_admin_audit(
    'earthquake.' || p_operation, 'Deprem merkezi: ' || p_operation, p_target_type, p_target_id,
    jsonb_build_object('reason', p_reason), 'success');
end;
$$;

create or replace function public.earthquake_require_reason(p_reason text)
returns text
language plpgsql
immutable
as $$
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  return left(trim(p_reason), 500);
end;
$$;

-- Edge function'ın kullanıcı JWT'si ile çağırdığı yetki kontrolü.
create or replace function public.earthquake_admin_check(p_permission text default 'earthquake.manage')
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_permission not in ('earthquake.view', 'earthquake.manage', 'earthquake.notify', 'earthquake.review') then
    raise exception 'invalid_permission' using errcode = '22023';
  end if;
  perform public.tz_admin_require(p_permission);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Genel durum
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.earthquake_settings;
begin
  perform public.tz_admin_require('earthquake.view');
  select * into s from public.earthquake_settings where id = 1;

  return jsonb_build_object(
    'status', public.earthquake_status_json(),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', x.key, 'name', x.name, 'is_enabled', x.is_enabled, 'is_primary', x.is_primary, 'health', x.health,
        'terms_status', x.terms_status, 'consecutive_failures', x.consecutive_failures, 'next_retry_at', x.next_retry_at,
        'last_attempt_at', x.last_attempt_at, 'last_success_at', x.last_success_at, 'last_error_code', x.last_error_code,
        'last_error_message', x.last_error_message, 'last_error_at', x.last_error_at, 'last_latency_ms', x.last_latency_ms
      ) order by x.is_primary desc, x.key)
        from public.earthquake_sources x
    ), '[]'::jsonb),
    'events', jsonb_build_object(
      'last_24h_total', (select count(*) from public.earthquake_events e
                          where e.occurred_at > now() - interval '24 hours' and e.status in ('active', 'under_review')),
      'last_24h_r150', (select count(*) from public.earthquake_events e
                         where e.occurred_at > now() - interval '24 hours' and e.status in ('active', 'under_review')
                           and e.distance_to_trabzon_km <= 150),
      'last_24h_province', (select count(*) from public.earthquake_events e
                             where e.occurred_at > now() - interval '24 hours' and e.status in ('active', 'under_review')
                               and e.in_trabzon_province),
      'last_24h_turkey', (select count(*) from public.earthquake_events e
                           where e.occurred_at > now() - interval '24 hours' and e.status in ('active', 'under_review')
                             and e.in_turkey_region),
      'archive_total', (select count(*) from public.earthquake_events e where e.status in ('active', 'under_review')),
      'deduplicated_24h', (select count(*) from public.earthquake_source_records r
                            where r.match_method <> 'origin' and r.first_fetched_at > now() - interval '24 hours'),
      'pending_match', (select count(*) from public.earthquake_match_reviews m where m.status = 'pending'),
      'under_review', (select count(*) from public.earthquake_events e where e.status = 'under_review'),
      'removed', (select count(*) from public.earthquake_events e where e.status = 'removed')
    ),
    'sync_24h', (
      select jsonb_build_object(
        'runs', count(*),
        'success', count(*) filter (where l.status = 'success'),
        'partial', count(*) filter (where l.status = 'partial'),
        'failed', count(*) filter (where l.status = 'failed'),
        'avg_latency_ms', round(avg(l.latency_ms)),
        'rejected_records', coalesce(sum(l.records_rejected), 0),
        'new_events', coalesce(sum(l.new_events), 0))
        from public.earthquake_sync_logs l
       where l.started_at > now() - interval '24 hours'
    ),
    'ingest_latency', (
      select jsonb_build_object(
        'samples', count(*),
        'p50_seconds', percentile_cont(0.5) within group (order by extract(epoch from (e.first_seen_at - e.occurred_at))),
        'p95_seconds', percentile_cont(0.95) within group (order by extract(epoch from (e.first_seen_at - e.occurred_at))))
        from public.earthquake_events e
       where e.ingest_kind = 'live' and e.first_seen_at > now() - interval '24 hours'
    ),
    'notifications_24h', (
      select jsonb_build_object(
        'events', count(distinct ne.id),
        'completed', count(distinct ne.id) filter (where ne.processing_status = 'completed'),
        'skipped', count(distinct ne.id) filter (where ne.processing_status = 'skipped'),
        'pending', count(distinct ne.id) filter (where ne.processing_status in ('pending', 'fanning_out')),
        'in_app', count(d.id) filter (where d.channel = 'in_app'),
        'push_sent', count(d.id) filter (where d.channel = 'push' and d.delivery_status in ('sent', 'delivered')),
        'push_delivered', count(d.id) filter (where d.channel = 'push' and d.delivery_status = 'delivered'),
        'push_failed', count(d.id) filter (where d.channel = 'push' and d.delivery_status in ('failed', 'expired')),
        'push_invalid', count(d.id) filter (where d.channel = 'push' and d.delivery_status = 'invalid_token'),
        'push_suppressed', count(d.id) filter (where d.channel = 'push' and d.delivery_status = 'suppressed'),
        'push_queued', count(d.id) filter (where d.channel = 'push' and d.delivery_status in ('pending', 'sending')))
        from public.earthquake_notification_events ne
        left join public.earthquake_notification_deliveries d on d.notification_event_id = ne.id
       where ne.created_at > now() - interval '24 hours' and not ne.is_test
    ),
    'subscribers', jsonb_build_object(
      'enabled', (select count(*) from public.earthquake_user_preferences p where p.notifications_enabled),
      'trabzon', (select count(*) from public.earthquake_user_preferences p where p.notifications_enabled and p.region_mode = 'trabzon'),
      'province', (select count(*) from public.earthquake_user_preferences p where p.notifications_enabled and p.region_mode = 'province'),
      'turkey', (select count(*) from public.earthquake_user_preferences p where p.notifications_enabled and p.region_mode = 'turkey'),
      'all_magnitudes', (select count(*) from public.earthquake_user_preferences p where p.notifications_enabled and p.notify_all_magnitudes),
      'active_devices', (select count(*) from public.user_devices d where d.push_token is not null and d.invalidated_at is null),
      'invalidated_devices_7d', (select count(*) from public.user_devices d where d.invalidated_at > now() - interval '7 days')
    ),
    'recent_errors', coalesce((
      select jsonb_agg(jsonb_build_object('provider', l.provider, 'at', l.started_at, 'code', l.error_code,
                                          'message', l.error_message, 'run_kind', l.run_kind) order by l.started_at desc)
        from (select * from public.earthquake_sync_logs where status = 'failed' order by started_at desc limit 10) l
    ), '[]'::jsonb),
    'settings', to_jsonb(s) - 'updated_by'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Kaynaklar
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_admin_sources()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('earthquake.view');
  return coalesce((
    select jsonb_agg(to_jsonb(x) || jsonb_build_object(
      'usage_24h', (select jsonb_build_object(
                      'requests', count(*),
                      'failed', count(*) filter (where l.status = 'failed'),
                      'avg_latency_ms', round(avg(l.latency_ms)),
                      'records', coalesce(sum(l.records_received), 0))
                      from public.earthquake_sync_logs l
                     where l.provider = x.key and l.started_at > now() - interval '24 hours'),
      'records_total', (select count(*) from public.earthquake_source_records r where r.source_name = x.key),
      'matched_total', (select count(*) from public.earthquake_source_records r where r.source_name = x.key and r.match_method <> 'origin'),
      'oldest_record', (select min(r.source_timestamp) from public.earthquake_source_records r where r.source_name = x.key)
    ) order by x.is_primary desc, x.key)
      from public.earthquake_sources x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.earthquake_admin_source_update(p_key text, p_patch jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := public.earthquake_require_reason(p_reason);
  v_old public.earthquake_sources;
  v_new public.earthquake_sources;
begin
  perform public.tz_admin_require('earthquake.manage', true);
  select * into v_old from public.earthquake_sources where key = p_key for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('is_enabled', 'is_primary', 'terms_status', 'terms_note')) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if p_patch ? 'terms_status' and p_patch->>'terms_status' not in ('pending_review', 'verified', 'restricted') then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if coalesce((p_patch->>'is_primary')::boolean, false) then
    update public.earthquake_sources set is_primary = false, updated_at = now() where key <> p_key and is_primary;
  elsif p_patch ? 'is_primary' and not (p_patch->>'is_primary')::boolean and v_old.is_primary then
    raise exception 'primary_required' using errcode = '22023';
  end if;

  update public.earthquake_sources
     set is_enabled = coalesce((p_patch->>'is_enabled')::boolean, is_enabled),
         is_primary = coalesce((p_patch->>'is_primary')::boolean, is_primary),
         terms_status = coalesce(p_patch->>'terms_status', terms_status),
         terms_note = case when p_patch ? 'terms_note' then left(p_patch->>'terms_note', 1000) else terms_note end,
         health = case when coalesce((p_patch->>'is_enabled')::boolean, is_enabled) then
                        case when health = 'disabled' then 'unknown' else health end
                       else 'disabled' end,
         updated_at = now()
   where key = p_key
   returning * into v_new;

  perform public.earthquake_audit('source_update', 'earthquake_source', p_key, v_reason,
    jsonb_build_object('is_enabled', v_old.is_enabled, 'is_primary', v_old.is_primary, 'terms_status', v_old.terms_status, 'terms_note', v_old.terms_note),
    jsonb_build_object('is_enabled', v_new.is_enabled, 'is_primary', v_new.is_primary, 'terms_status', v_new.terms_status, 'terms_note', v_new.terms_note));
  return to_jsonb(v_new);
end;
$$;

create or replace function public.earthquake_admin_sync_logs(
  p_provider text default null,
  p_status   text default null,
  p_limit    integer default 50,
  p_offset   integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform public.tz_admin_require('earthquake.view');
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.started_at desc)
        from (
          select * from public.earthquake_sync_logs
           where (p_provider is null or provider = p_provider)
             and (p_status is null or status = p_status)
           order by started_at desc
           limit v_limit offset greatest(coalesce(p_offset, 0), 0)
        ) l
    ), '[]'::jsonb),
    'total', (select count(*) from public.earthquake_sync_logs
               where (p_provider is null or provider = p_provider) and (p_status is null or status = p_status))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Ayarlar (bölge/senkron: earthquake.manage, bildirim: earthquake.notify)
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_admin_settings_update(p_patch jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := public.earthquake_require_reason(p_reason);
  v_region_keys text[] := array['center_lat', 'center_lng', 'center_label', 'default_region', 'radius_options',
    'turkey_enabled', 'district_filter_enabled', 'default_range_days', 'map_default_zoom', 'map_layers',
    'chart_max_points', 'sync_enabled', 'sync_interval_seconds', 'overlap_minutes', 'revision_sweep_hours',
    'stale_after_seconds'];
  v_notify_keys text[] := array['notifications_enabled', 'notifications_paused', 'notify_trabzon_enabled',
    'notify_turkey_enabled', 'notify_small_enabled', 'small_magnitude_threshold', 'late_event_max_minutes',
    'revision_notify_min_delta', 'important_magnitude', 'quiet_bypass_magnitude', 'push_expire_minutes'];
  v_keys text[];
  v_old public.earthquake_settings;
  v_new public.earthquake_settings;
  v_reclassified integer := 0;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  select array_agg(k) into v_keys from jsonb_object_keys(p_patch) k;
  if v_keys is null or not (v_keys <@ (v_region_keys || v_notify_keys)) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if v_keys && v_region_keys then
    perform public.tz_admin_require('earthquake.manage', true);
  end if;
  if v_keys && v_notify_keys then
    perform public.tz_admin_require('earthquake.notify', true);
  end if;

  if p_patch ? 'radius_options' and not (
       jsonb_typeof(p_patch->'radius_options') = 'array'
       and (select bool_and(v::text in ('50', '100', '150', '250')) from jsonb_array_elements(p_patch->'radius_options') v)
       and jsonb_array_length(p_patch->'radius_options') between 1 and 4) then
    raise exception 'invalid_radius' using errcode = '22023';
  end if;
  if p_patch ? 'center_lat' and (p_patch->>'center_lat')::double precision not between 40.4 and 41.5 then
    raise exception 'coordinates_out_of_bounds' using errcode = '22023';
  end if;
  if p_patch ? 'center_lng' and (p_patch->>'center_lng')::double precision not between 38.9 and 40.6 then
    raise exception 'coordinates_out_of_bounds' using errcode = '22023';
  end if;
  if p_patch ? 'map_layers' and jsonb_typeof(p_patch->'map_layers') <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  select * into v_old from public.earthquake_settings where id = 1 for update;

  update public.earthquake_settings
     set center_lat = coalesce((p_patch->>'center_lat')::double precision, center_lat),
         center_lng = coalesce((p_patch->>'center_lng')::double precision, center_lng),
         center_label = coalesce(left(p_patch->>'center_label', 120), center_label),
         default_region = coalesce(p_patch->>'default_region', default_region),
         radius_options = coalesce((select array_agg(v::text::integer order by v::text::integer)
                                      from jsonb_array_elements(case when p_patch ? 'radius_options' then p_patch->'radius_options' end) v),
                                   radius_options),
         turkey_enabled = coalesce((p_patch->>'turkey_enabled')::boolean, turkey_enabled),
         district_filter_enabled = coalesce((p_patch->>'district_filter_enabled')::boolean, district_filter_enabled),
         default_range_days = coalesce((p_patch->>'default_range_days')::integer, default_range_days),
         map_default_zoom = coalesce((p_patch->>'map_default_zoom')::numeric, map_default_zoom),
         map_layers = coalesce(p_patch->'map_layers', map_layers),
         chart_max_points = coalesce((p_patch->>'chart_max_points')::integer, chart_max_points),
         sync_enabled = coalesce((p_patch->>'sync_enabled')::boolean, sync_enabled),
         sync_interval_seconds = coalesce((p_patch->>'sync_interval_seconds')::integer, sync_interval_seconds),
         overlap_minutes = coalesce((p_patch->>'overlap_minutes')::integer, overlap_minutes),
         revision_sweep_hours = coalesce((p_patch->>'revision_sweep_hours')::integer, revision_sweep_hours),
         stale_after_seconds = coalesce((p_patch->>'stale_after_seconds')::integer, stale_after_seconds),
         notifications_enabled = coalesce((p_patch->>'notifications_enabled')::boolean, notifications_enabled),
         notifications_paused = coalesce((p_patch->>'notifications_paused')::boolean, notifications_paused),
         notify_trabzon_enabled = coalesce((p_patch->>'notify_trabzon_enabled')::boolean, notify_trabzon_enabled),
         notify_turkey_enabled = coalesce((p_patch->>'notify_turkey_enabled')::boolean, notify_turkey_enabled),
         notify_small_enabled = coalesce((p_patch->>'notify_small_enabled')::boolean, notify_small_enabled),
         small_magnitude_threshold = coalesce((p_patch->>'small_magnitude_threshold')::numeric, small_magnitude_threshold),
         late_event_max_minutes = coalesce((p_patch->>'late_event_max_minutes')::integer, late_event_max_minutes),
         revision_notify_min_delta = coalesce((p_patch->>'revision_notify_min_delta')::numeric, revision_notify_min_delta),
         important_magnitude = coalesce((p_patch->>'important_magnitude')::numeric, important_magnitude),
         quiet_bypass_magnitude = coalesce((p_patch->>'quiet_bypass_magnitude')::numeric, quiet_bypass_magnitude),
         push_expire_minutes = coalesce((p_patch->>'push_expire_minutes')::integer, push_expire_minutes),
         updated_at = now(),
         updated_by = auth.uid()
   where id = 1
   returning * into v_new;

  if v_new.default_region = 'turkey' and not v_new.turkey_enabled then
    raise exception 'region_disabled' using errcode = '22023';
  end if;
  if (v_new.center_lat, v_new.center_lng) is distinct from (v_old.center_lat, v_old.center_lng) then
    v_reclassified := public.earthquake_reclassify_all();
  end if;

  perform public.earthquake_audit('settings_update', 'earthquake_settings', '1', v_reason,
    (select jsonb_object_agg(k, to_jsonb(v_old) -> k) from unnest(v_keys) k),
    (select jsonb_object_agg(k, to_jsonb(v_new) -> k) from unnest(v_keys) k));

  return (to_jsonb(v_new) - 'updated_by') || jsonb_build_object('reclassified', v_reclassified);
end;
$$;

-- ---------------------------------------------------------------------------
-- Bildirim kuyruğu
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_admin_notifications(
  p_status text default null,
  p_limit  integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  perform public.tz_admin_require('earthquake.view');
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ne.id, 'type', ne.notification_type, 'status', ne.processing_status, 'skip_reason', ne.skip_reason,
        'title', ne.title, 'body', ne.body, 'priority', ne.priority, 'is_test', ne.is_test,
        'created_at', ne.created_at, 'started_at', ne.started_at, 'completed_at', ne.completed_at,
        'recipients', ne.recipients, 'in_app', ne.in_app_created, 'push_queued', ne.push_queued, 'push_suppressed', ne.push_suppressed,
        'event', case when e.id is null then null else jsonb_build_object(
          'id', e.id, 'canonical_id', e.canonical_event_id, 'magnitude', e.magnitude, 'magnitude_type', e.magnitude_type,
          'occurred_at', e.occurred_at, 'location', e.location_description) end,
        'push', (select jsonb_build_object(
                   'sent', count(*) filter (where d.delivery_status = 'sent'),
                   'delivered', count(*) filter (where d.delivery_status = 'delivered'),
                   'failed', count(*) filter (where d.delivery_status = 'failed'),
                   'invalid', count(*) filter (where d.delivery_status = 'invalid_token'),
                   'expired', count(*) filter (where d.delivery_status = 'expired'),
                   'pending', count(*) filter (where d.delivery_status in ('pending', 'sending')))
                   from public.earthquake_notification_deliveries d
                  where d.notification_event_id = ne.id and d.channel = 'push')
      ) order by ne.created_at desc)
        from (
          select * from public.earthquake_notification_events
           where (p_status is null or processing_status = p_status)
           order by created_at desc
           limit v_limit offset greatest(coalesce(p_offset, 0), 0)
        ) ne
        left join public.earthquake_events e on e.id = ne.earthquake_event_id
    ), '[]'::jsonb),
    'total', (select count(*) from public.earthquake_notification_events where (p_status is null or processing_status = p_status))
  );
end;
$$;

create or replace function public.earthquake_admin_push_failures(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('earthquake.notify');
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'notification_event_id', d.notification_event_id, 'status', d.delivery_status,
        'platform', ud.platform, 'retry_count', d.retry_count, 'attempted_at', d.attempted_at,
        'error', d.provider_result->>'error', 'message', d.provider_result->>'message', 'created_at', d.created_at
      ) order by d.created_at desc)
        from (
          select * from public.earthquake_notification_deliveries
           where channel = 'push' and delivery_status in ('failed', 'invalid_token', 'expired')
           order by created_at desc
           limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
        ) d
        left join public.user_devices ud on ud.id = d.device_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.earthquake_admin_retry_failed(p_notification_event_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := public.earthquake_require_reason(p_reason);
  v_expire integer := (select push_expire_minutes from public.earthquake_settings where id = 1);
  v_count integer;
begin
  perform public.tz_admin_require('earthquake.notify', true);
  update public.earthquake_notification_deliveries d
     set delivery_status = 'pending', next_attempt_at = now(), claimed_at = null
    from public.user_devices ud
   where ud.id = d.device_id
     and ud.push_token is not null and ud.invalidated_at is null
     and d.channel = 'push' and d.delivery_status = 'failed'
     and d.created_at > now() - make_interval(mins => v_expire)
     and (p_notification_event_id is null or d.notification_event_id = p_notification_event_id);
  get diagnostics v_count = row_count;
  perform public.earthquake_audit('push_retry', 'earthquake_notification_event', coalesce(p_notification_event_id::text, 'all'),
    v_reason, null, jsonb_build_object('requeued', v_count));
  return jsonb_build_object('requeued', v_count);
end;
$$;

-- TEST bildirimi: depreme bağlanmaz, yalnızca çağıran adminin kendi kayıtlı
-- cihazlarına ve uygulama içi kutusuna gider.
create or replace function public.earthquake_admin_test_push(p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('earthquake.notify');
  v_id uuid;
  v_notif uuid;
  v_devices integer;
  v_body text := 'TEST bildirimi — gerçek bir deprem kaydı değildir. Bildirim altyapısını doğrulamak için gönderildi.'
                 || coalesce(E'\n' || nullif(left(trim(p_note), 120), ''), '');
begin
  perform public.earthquake_rate_check('earthquake_admin_test_push', 5, 600);

  select count(*) into v_devices
    from public.user_devices d
   where d.user_id = v_uid and d.push_token is not null and d.invalidated_at is null and d.notifications_enabled;

  insert into public.earthquake_notification_events
    (notification_type, is_test, created_by, title, body, route, priority, processing_status, started_at, completed_at, data)
  values
    ('test', true, v_uid, 'TEST · Trabzone Deprem Merkezi', v_body, '/deprem/bildirimler', 'normal', 'completed', now(), now(),
     jsonb_build_object('type', 'earthquake_test', 'route', '/deprem/bildirimler', 'test', true))
  returning id into v_id;
  update public.earthquake_notification_events set data = data || jsonb_build_object('notification_event_id', v_id) where id = v_id;

  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, route)
  values (v_uid, 'earthquake', 'TEST · Trabzone Deprem Merkezi', v_body, 'earthquake_test', v_id::text, '/deprem/bildirimler')
  returning id into v_notif;

  insert into public.earthquake_notification_deliveries (notification_event_id, user_id, channel, delivery_status, notification_id, sent_at)
  values (v_id, v_uid, 'in_app', 'sent', v_notif, now());

  insert into public.earthquake_notification_deliveries (notification_event_id, user_id, device_id, channel, priority, delivery_status)
  select v_id, v_uid, d.id, 'push', 1, 'pending'
    from public.user_devices d
   where d.user_id = v_uid and d.push_token is not null and d.invalidated_at is null and d.notifications_enabled;

  update public.earthquake_notification_events
     set recipients = 1, in_app_created = 1, push_queued = v_devices
   where id = v_id;

  perform public.earthquake_audit('test_push', 'earthquake_notification_event', v_id::text, 'TEST bildirimi (yalnızca admin cihazı)',
    null, jsonb_build_object('devices', v_devices));

  return jsonb_build_object('notification_event_id', v_id, 'devices', v_devices, 'in_app', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Olay inceleme
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_admin_events(
  p_status text default null,
  p_source text default null,
  p_region text default null,
  p_search text default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  perform public.tz_admin_require('earthquake.view');
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'canonical_id', e.canonical_event_id, 'status', e.status, 'preferred_source', e.preferred_source,
        'sources', to_jsonb(e.sources), 'occurred_at', e.occurred_at, 'magnitude', e.magnitude, 'magnitude_type', e.magnitude_type,
        'depth_km', e.depth_km, 'location', e.location_description, 'distance_km', e.distance_to_trabzon_km,
        'region_classification', e.region_classification, 'revision', e.revision, 'first_seen_at', e.first_seen_at,
        'updated_at', e.updated_at, 'notification_state', e.notification_state, 'notification_skip_reason', e.notification_skip_reason,
        'pending_reviews', (select count(*) from public.earthquake_match_reviews m
                             where m.status = 'pending' and (m.own_event_id = e.id or m.candidate_event_id = e.id)),
        'has_admin_note', e.admin_note is not null
      ) order by e.occurred_at desc)
        from (
          select * from public.earthquake_events x
           where x.is_test = false
             and (p_status is null or x.status = p_status)
             and (p_source is null or p_source = any (x.sources))
             and (p_region is null
                  or (p_region = 'province' and x.in_trabzon_province)
                  or (p_region = 'r150' and x.distance_to_trabzon_km <= 150)
                  or (p_region = 'turkey' and x.in_turkey_region))
             and (v_search is null or x.canonical_event_id like '%' || v_search || '%'
                  or lower(coalesce(x.location_description, '')) like '%' || v_search || '%'
                  or exists (select 1 from public.earthquake_source_records r
                              where r.earthquake_event_id = x.id and lower(r.source_event_id) = v_search))
           order by x.occurred_at desc
           limit v_limit offset greatest(coalesce(p_offset, 0), 0)
        ) e
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.earthquake_admin_event_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e public.earthquake_events;
begin
  perform public.tz_admin_require('earthquake.view');
  select * into e from public.earthquake_events where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'event', to_jsonb(e) - 'geog',
    'district_name', (select r.name from public.earthquake_regions r where r.key = e.district_key),
    'records', coalesce((select jsonb_agg(to_jsonb(r) order by r.first_fetched_at)
                           from public.earthquake_source_records r where r.earthquake_event_id = e.id), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc)
                             from public.earthquake_event_revisions v where v.earthquake_event_id = e.id), '[]'::jsonb),
    'match_reviews', coalesce((
      select jsonb_agg(to_jsonb(m) || jsonb_build_object(
               'own_canonical_id', (select canonical_event_id from public.earthquake_events where id = m.own_event_id),
               'candidate_canonical_id', (select canonical_event_id from public.earthquake_events where id = m.candidate_event_id),
               'record_source', (select source_name || ':' || source_event_id from public.earthquake_source_records where id = m.source_record_id))
             order by m.created_at desc)
        from public.earthquake_match_reviews m
       where m.own_event_id = e.id or m.candidate_event_id = e.id), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ne.id, 'type', ne.notification_type, 'status', ne.processing_status, 'skip_reason', ne.skip_reason,
               'created_at', ne.created_at, 'completed_at', ne.completed_at, 'recipients', ne.recipients,
               'push_queued', ne.push_queued, 'title', ne.title, 'body', ne.body) order by ne.created_at)
        from public.earthquake_notification_events ne where ne.earthquake_event_id = e.id), '[]'::jsonb),
    'views', coalesce((select sum(views) from public.earthquake_event_views v where v.earthquake_event_id = e.id), 0),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
        from public.earthquake_admin_audit_logs a
       where a.target_type = 'earthquake_event' and a.target_id = e.id::text), '[]'::jsonb)
  );
end;
$$;

-- Bağlı bir kaynak kaydının değerlerini kanonik olaya uygular.
create or replace function public.earthquake_apply_source(p_event_id uuid, p_record_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  e public.earthquake_events;
  r public.earthquake_source_records;
  g record;
begin
  select * into e from public.earthquake_events where id = p_event_id for update;
  select * into r from public.earthquake_source_records where id = p_record_id and earthquake_event_id = p_event_id;
  if r.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into g from public.earthquake_geo_classify(r.source_latitude, r.source_longitude);
  update public.earthquake_events
     set preferred_source = r.source_name,
         occurred_at = r.source_timestamp,
         latitude = r.source_latitude,
         longitude = r.source_longitude,
         geog = ST_SetSRID(ST_MakePoint(r.source_longitude, r.source_latitude), 4326)::geography,
         depth_km = r.source_depth_km,
         magnitude = r.source_magnitude,
         magnitude_type = public.earthquake_magtype(r.source_magnitude_type),
         location_description = r.source_location,
         source_province = r.source_province,
         source_district = r.source_district,
         distance_to_trabzon_km = g.distance_km,
         in_trabzon_province = g.in_province,
         district_key = g.district_key,
         in_turkey_region = g.in_turkey,
         region_classification = g.classification,
         source_updated_at = r.source_updated_at,
         revision = revision + 1,
         updated_at = now()
   where id = p_event_id;
  insert into public.earthquake_event_revisions
    (earthquake_event_id, source_record_id, source_name, revision, change_kind, changes, significant)
  values (p_event_id, r.id, r.source_name, e.revision + 1, p_kind,
    jsonb_build_object(
      'preferred_source', jsonb_build_object('old', e.preferred_source, 'new', r.source_name),
      'magnitude', jsonb_build_object('old', e.magnitude, 'new', r.source_magnitude),
      'depth_km', jsonb_build_object('old', e.depth_km, 'new', r.source_depth_km)),
    false);
end;
$$;

create or replace function public.earthquake_admin_event_action(
  p_id     uuid,
  p_action text,
  p_reason text,
  p_value  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := public.earthquake_require_reason(p_reason);
  v_old public.earthquake_events;
  v_new public.earthquake_events;
  v_record uuid;
begin
  perform public.tz_admin_require('earthquake.review', p_action in ('remove', 'set_preferred'));
  select * into v_old from public.earthquake_events where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  case p_action
    when 'flag' then
      if v_old.status <> 'active' then raise exception 'invalid_status' using errcode = '22023'; end if;
      update public.earthquake_events set status = 'under_review', review_flagged_at = now(), updated_at = now() where id = p_id;
    when 'unflag' then
      if v_old.status <> 'under_review' then raise exception 'invalid_status' using errcode = '22023'; end if;
      update public.earthquake_events set status = 'active', updated_at = now() where id = p_id;
    when 'remove' then
      if v_old.status in ('removed', 'merged') then raise exception 'invalid_status' using errcode = '22023'; end if;
      update public.earthquake_events set status = 'removed', updated_at = now() where id = p_id;
      update public.earthquake_notification_events
         set processing_status = 'cancelled', skip_reason = 'event_removed', completed_at = now()
       where earthquake_event_id = p_id and processing_status in ('pending', 'fanning_out');
    when 'restore' then
      if v_old.status <> 'removed' then raise exception 'invalid_status' using errcode = '22023'; end if;
      update public.earthquake_events set status = 'active', updated_at = now() where id = p_id;
    when 'set_preferred' then
      if p_value is null or not (p_value = any (v_old.sources)) then raise exception 'invalid_source' using errcode = '22023'; end if;
      if p_value = v_old.preferred_source then raise exception 'invalid_source' using errcode = '22023'; end if;
      select id into v_record from public.earthquake_source_records where earthquake_event_id = p_id and source_name = p_value limit 1;
      perform public.earthquake_apply_source(p_id, v_record, 'admin');
    when 'note' then
      update public.earthquake_events set admin_note = nullif(left(trim(coalesce(p_value, '')), 2000), ''), updated_at = now() where id = p_id;
    else
      raise exception 'invalid_action' using errcode = '22023';
  end case;

  select * into v_new from public.earthquake_events where id = p_id;
  perform public.earthquake_audit('event_' || p_action, 'earthquake_event', p_id::text, v_reason,
    jsonb_build_object('status', v_old.status, 'preferred_source', v_old.preferred_source, 'magnitude', v_old.magnitude,
                       'magnitude_type', v_old.magnitude_type, 'depth_km', v_old.depth_km, 'admin_note', v_old.admin_note),
    jsonb_build_object('status', v_new.status, 'preferred_source', v_new.preferred_source, 'magnitude', v_new.magnitude,
                       'magnitude_type', v_new.magnitude_type, 'depth_km', v_new.depth_km, 'admin_note', v_new.admin_note));
  perform public.earthquake_broadcast(jsonb_build_object('updated', 1, 'at', now()));
  return to_jsonb(v_new) - 'geog';
end;
$$;

create or replace function public.earthquake_admin_match_reviews(p_status text default 'pending', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('earthquake.view');
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'status', m.status, 'dt_seconds', m.dt_seconds, 'distance_km', m.distance_km,
        'magnitude_delta', m.magnitude_delta, 'candidate_count', m.candidate_count, 'created_at', m.created_at,
        'resolved_at', m.resolved_at, 'resolution_note', m.resolution_note,
        'record', (select jsonb_build_object('source', r.source_name, 'source_event_id', r.source_event_id,
                     'magnitude', r.source_magnitude, 'magnitude_type', r.source_magnitude_type, 'depth_km', r.source_depth_km,
                     'latitude', r.source_latitude, 'longitude', r.source_longitude, 'occurred_at', r.source_timestamp,
                     'location', r.source_location)
                     from public.earthquake_source_records r where r.id = m.source_record_id),
        'own', (select jsonb_build_object('id', e.id, 'canonical_id', e.canonical_event_id, 'status', e.status)
                  from public.earthquake_events e where e.id = m.own_event_id),
        'candidate', (select jsonb_build_object('id', e.id, 'canonical_id', e.canonical_event_id, 'status', e.status,
                        'source', e.preferred_source, 'magnitude', e.magnitude, 'magnitude_type', e.magnitude_type,
                        'depth_km', e.depth_km, 'latitude', e.latitude, 'longitude', e.longitude,
                        'occurred_at', e.occurred_at, 'location', e.location_description)
                        from public.earthquake_events e where e.id = m.candidate_event_id)
      ) order by m.created_at desc)
        from (
          select * from public.earthquake_match_reviews
           where (p_status is null or status = p_status)
           order by created_at desc
           limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
        ) m
    ), '[]'::jsonb)
  );
end;
$$;

-- Eşleştirme kararı. "link": iki kayıt aynı depremdir; birincil kaynağı
-- taşıyan olay hedef olur, diğeri "merged" olarak hedefe yönlenir.
-- "reject": kayıtlar ayrı depremlerdir; gizlenen kayıt yeniden görünür.
create or replace function public.earthquake_admin_match_resolve(p_review_id uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := public.earthquake_require_reason(p_reason);
  m public.earthquake_match_reviews;
  v_primary text := public.earthquake_primary_source();
  v_own public.earthquake_events;
  v_cand public.earthquake_events;
  v_target public.earthquake_events;
  v_other public.earthquake_events;
  v_primary_record uuid;
begin
  perform public.tz_admin_require('earthquake.review', true);
  select * into m from public.earthquake_match_reviews where id = p_review_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if m.status <> 'pending' then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select * into v_own from public.earthquake_events where id = m.own_event_id for update;
  select * into v_cand from public.earthquake_events where id = m.candidate_event_id for update;

  if p_decision = 'link' then
    if v_own.status in ('merged', 'removed') or v_cand.status in ('merged', 'removed') then
      raise exception 'invalid_status' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_own.sources) s where s = any (v_cand.sources)) then
      raise exception 'duplicate_source' using errcode = '22023';
    end if;
    if v_primary = any (v_cand.sources) or not (v_primary = any (v_own.sources)) then
      v_target := v_cand; v_other := v_own;
    else
      v_target := v_own; v_other := v_cand;
    end if;

    update public.earthquake_source_records
       set earthquake_event_id = v_target.id, match_method = 'admin', match_confidence = 'manual',
           match_dt_seconds = m.dt_seconds, match_distance_km = m.distance_km, match_magnitude_delta = m.magnitude_delta,
           updated_at = now()
     where earthquake_event_id = v_other.id;
    update public.earthquake_events
       set sources = (select array_agg(distinct s) from unnest(v_target.sources || v_other.sources) s),
           status = case when status = 'pending_match' then 'active' else status end,
           updated_at = now()
     where id = v_target.id;
    update public.earthquake_events
       set status = 'merged', merged_into = v_target.id, sources = '{}', updated_at = now()
     where id = v_other.id;
    update public.earthquake_notification_events
       set processing_status = 'cancelled', skip_reason = 'event_merged', completed_at = now()
     where earthquake_event_id = v_other.id and processing_status in ('pending', 'fanning_out');

    if v_target.preferred_source <> v_primary and v_primary = any (v_other.sources) then
      select id into v_primary_record from public.earthquake_source_records
       where earthquake_event_id = v_target.id and source_name = v_primary limit 1;
      perform public.earthquake_apply_source(v_target.id, v_primary_record, 'preferred_source');
    end if;

    update public.earthquake_match_reviews
       set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(),
           resolution_note = 'Başka bir eşleştirme kararıyla kapandı'
     where id <> m.id and status = 'pending'
       and (own_event_id = v_other.id or candidate_event_id = v_other.id);
  elsif p_decision = 'reject' then
    null;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  update public.earthquake_match_reviews
     set status = case when p_decision = 'link' then 'linked' else 'rejected' end,
         resolved_by = auth.uid(), resolved_at = now(), resolution_note = v_reason
   where id = m.id;

  if p_decision = 'reject' then
    update public.earthquake_events e
       set status = 'active', updated_at = now()
     where e.id in (m.own_event_id, m.candidate_event_id)
       and e.status = 'pending_match'
       and not exists (select 1 from public.earthquake_match_reviews x
                        where x.status = 'pending' and (x.own_event_id = e.id or x.candidate_event_id = e.id));
  end if;

  perform public.earthquake_audit('match_' || p_decision, 'earthquake_match_review', m.id::text, v_reason,
    jsonb_build_object('own', v_own.canonical_event_id, 'own_status', v_own.status,
                       'candidate', v_cand.canonical_event_id, 'candidate_status', v_cand.status),
    jsonb_build_object('decision', p_decision, 'target', case when p_decision = 'link' then v_target.canonical_event_id end));
  perform public.earthquake_broadcast(jsonb_build_object('updated', 1, 'at', now()));
  return jsonb_build_object('ok', true, 'decision', p_decision,
                            'target', case when p_decision = 'link' then v_target.canonical_event_id end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Analitik (gerçek kayıtlardan; tahmin değildir)
-- ---------------------------------------------------------------------------
create or replace function public.earthquake_admin_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from timestamptz := date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - make_interval(days => v_days - 1);
begin
  perform public.tz_admin_require('earthquake.view');
  return jsonb_build_object(
    'days', v_days,
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', d.day,
               'total', (select count(*) from public.earthquake_events e where e.status in ('active', 'under_review')
                          and (e.occurred_at at time zone 'Europe/Istanbul')::date = d.day),
               'r150', (select count(*) from public.earthquake_events e where e.status in ('active', 'under_review')
                         and e.distance_to_trabzon_km <= 150 and (e.occurred_at at time zone 'Europe/Istanbul')::date = d.day),
               'province', (select count(*) from public.earthquake_events e where e.status in ('active', 'under_review')
                             and e.in_trabzon_province and (e.occurred_at at time zone 'Europe/Istanbul')::date = d.day),
               'views', (select coalesce(sum(v.views), 0) from public.earthquake_event_views v where v.view_date = d.day),
               'push_sent', (select count(*) from public.earthquake_notification_deliveries x
                              where x.channel = 'push' and x.delivery_status in ('sent', 'delivered')
                                and (x.created_at at time zone 'Europe/Istanbul')::date = d.day),
               'push_failed', (select count(*) from public.earthquake_notification_deliveries x
                                where x.channel = 'push' and x.delivery_status in ('failed', 'invalid_token', 'expired')
                                  and (x.created_at at time zone 'Europe/Istanbul')::date = d.day),
               'avg_ingest_seconds', (select round(avg(extract(epoch from (e.first_seen_at - e.occurred_at)))::numeric, 1)
                                        from public.earthquake_events e
                                       where e.ingest_kind = 'live' and (e.first_seen_at at time zone 'Europe/Istanbul')::date = d.day)
             ) order by d.day)
        from (select generate_series((v_from at time zone 'Europe/Istanbul')::date, (now() at time zone 'Europe/Istanbul')::date, interval '1 day')::date as day) d
    ), '[]'::jsonb),
    'magnitude_bins', (
      select jsonb_build_object(
        'below_0', count(*) filter (where magnitude < 0),
        'm0', count(*) filter (where magnitude >= 0 and magnitude < 2),
        'm2', count(*) filter (where magnitude >= 2 and magnitude < 3),
        'm3', count(*) filter (where magnitude >= 3 and magnitude < 4),
        'm4', count(*) filter (where magnitude >= 4 and magnitude < 5),
        'm5', count(*) filter (where magnitude >= 5))
        from public.earthquake_events where status in ('active', 'under_review') and occurred_at >= v_from
    ),
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name,
               'count', (select count(*) from public.earthquake_events e where e.district_key = r.key
                          and e.status in ('active', 'under_review') and e.occurred_at >= v_from)) order by r.name)
        from public.earthquake_regions r where r.kind = 'district'
    ), '[]'::jsonb),
    'offshore', (select count(*) from public.earthquake_events e where e.region_classification = 'trabzon_offshore'
                  and e.status in ('active', 'under_review') and e.occurred_at >= v_from),
    'source_comparison', (
      select jsonb_build_object(
        'afad_only', count(*) filter (where sources = array['afad']),
        'usgs_only', count(*) filter (where sources = array['usgs']),
        'both', count(*) filter (where 'afad' = any (sources) and 'usgs' = any (sources)),
        'avg_magnitude_delta', (select round(avg(r.match_magnitude_delta), 2) from public.earthquake_source_records r
                                 where r.match_method <> 'origin' and r.first_fetched_at >= v_from),
        'avg_distance_km', (select round(avg(r.match_distance_km), 1) from public.earthquake_source_records r
                             where r.match_method <> 'origin' and r.first_fetched_at >= v_from))
        from public.earthquake_events where status in ('active', 'under_review') and occurred_at >= v_from
    ),
    'top_viewed', coalesce((
      select jsonb_agg(jsonb_build_object('canonical_id', e.canonical_event_id, 'magnitude', e.magnitude,
               'magnitude_type', e.magnitude_type, 'location', e.location_description, 'occurred_at', e.occurred_at, 'views', t.views)
             order by t.views desc)
        from (select earthquake_event_id, sum(views) as views from public.earthquake_event_views
               where view_date >= (v_from at time zone 'Europe/Istanbul')::date
               group by 1 order by 2 desc limit 10) t
        join public.earthquake_events e on e.id = t.earthquake_event_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.earthquake_admin_audit_list(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('earthquake.view');
  return coalesce((
    select jsonb_agg(to_jsonb(a) || jsonb_build_object('admin_username', p.username) order by a.created_at desc)
      from (select * from public.earthquake_admin_audit_logs order by created_at desc
             limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) a
      left join public.profiles p on p.id = a.admin_id
  ), '[]'::jsonb);
end;
$$;

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
         'earthquake_audit', 'earthquake_require_reason', 'earthquake_admin_check', 'earthquake_admin_overview',
         'earthquake_admin_sources', 'earthquake_admin_source_update', 'earthquake_admin_sync_logs',
         'earthquake_admin_settings_update', 'earthquake_admin_notifications', 'earthquake_admin_push_failures',
         'earthquake_admin_retry_failed', 'earthquake_admin_test_push', 'earthquake_admin_events',
         'earthquake_admin_event_get', 'earthquake_apply_source', 'earthquake_admin_event_action',
         'earthquake_admin_match_reviews', 'earthquake_admin_match_resolve', 'earthquake_admin_analytics',
         'earthquake_admin_audit_list')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if fn.proname like 'earthquake\_admin\_%' then
      execute format('grant execute on function %s to authenticated', fn.sig);
    end if;
  end loop;
end $$;
