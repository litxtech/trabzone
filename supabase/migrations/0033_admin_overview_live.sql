-- =====================================================================
-- 0032 — Live overview counters
--
-- admin_overview() historically exposed period counters plus DAU/WAU/MAU.
-- The dashboard also needs "today" values for registrations, posts and
-- orders without inventing or client-computing them. This wrapper keeps the
-- original read model intact and merges the additional live counters.
-- =====================================================================
begin;

create or replace function public.admin_overview_live(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_today_start timestamptz := date_trunc('day', now());
  v_tomorrow_start timestamptz := date_trunc('day', now()) + interval '1 day';
begin
  perform public.tz_admin_require('report.view', false);

  v_payload := public.admin_overview(p_from, p_to);

  return jsonb_set(
    v_payload,
    '{stats}',
    (v_payload -> 'stats') || jsonb_build_object(
      'users_today', (
        select count(*) from public.profiles
        where created_at >= v_today_start and created_at < v_tomorrow_start
      ),
      'posts_today', (
        select count(*) from public.posts
        where created_at >= v_today_start and created_at < v_tomorrow_start
      ),
      'orders_today', (
        select count(*) from public.marketplace_orders
        where created_at >= v_today_start and created_at < v_tomorrow_start
      ),
      'reels_created_today', (
        select count(*) from public.reels
        where created_at >= v_today_start and created_at < v_tomorrow_start
      )
    ),
    true
  );
end;
$$;

revoke all on function public.admin_overview_live(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_overview_live(timestamptz, timestamptz) to authenticated, service_role;

commit;
