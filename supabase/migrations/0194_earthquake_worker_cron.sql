-- ---------------------------------------------------------------------------
-- 0194 — Deprem worker durumu ve zamanlayıcı
--
-- pg_cron her 30 sn'de earthquake_tick() çağırır. Tick, senkron aralığı
-- (varsayılan 60 sn) dolmadıysa ve kuyrukta iş yoksa hiçbir istek atmaz;
-- bu yüzden AFAD en fazla dakikada bir sorgulanır.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

create or replace function public.earthquake_worker_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object(
                   'overlap_minutes', s.overlap_minutes,
                   'revision_sweep_hours', s.revision_sweep_hours,
                   'sync_enabled', s.sync_enabled,
                   'sync_interval_seconds', s.sync_interval_seconds)
                   from public.earthquake_settings s where s.id = 1),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', x.key, 'is_enabled', x.is_enabled, 'is_primary', x.is_primary, 'health', x.health,
                 'next_retry_at', x.next_retry_at, 'last_attempt_at', x.last_attempt_at,
                 'last_success_at', x.last_success_at, 'consecutive_failures', x.consecutive_failures))
                 from public.earthquake_sources x), '[]'::jsonb)
  )
$$;

revoke all on function public.earthquake_worker_state() from public, anon, authenticated;
grant execute on function public.earthquake_worker_state() to service_role;

select cron.unschedule('earthquake-sync')
where exists (select 1 from cron.job where jobname = 'earthquake-sync');

select cron.schedule(
  'earthquake-sync',
  '30 seconds',
  $$select public.earthquake_tick();$$
);
