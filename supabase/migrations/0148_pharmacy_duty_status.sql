-- ---------------------------------------------------------------------------
-- Eczane nöbet senkronizasyonu — yönetim tarafı yardımcıları
--
-- 1) `pharmacy_admin_check` — edge function'ın "bu JWT eczane yönetimi
--    yapabilir mi?" sorusuna yanıt verir (cron anahtarı olmadan elle
--    senkronizasyon tetiklenebilsin diye).
-- 2) `pharmacy_duty_status` — uygulama ve panel için tek okuma noktası:
--    "bugün nöbetçi kaç eczane var, kayıt ne zaman güncellendi, kaynak
--    sağlıklı mı". Liste/eski kayıt karışıklığı burada çözülür.
-- ---------------------------------------------------------------------------

create or replace function public.pharmacy_admin_check()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('pharmacy.manage');
$$;

revoke all on function public.pharmacy_admin_check() from public, anon;
grant execute on function public.pharmacy_admin_check() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Nöbet durumu özeti (uygulama üst kartı + panel sağlık göstergesi)
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_duty_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_today date := public.pharmacy_istanbul_today();
  v_day_start timestamptz := (public.pharmacy_istanbul_today()::timestamp at time zone 'Europe/Istanbul');
  v_day_end timestamptz := ((public.pharmacy_istanbul_today() + 1)::timestamp at time zone 'Europe/Istanbul');
  v_settings public.pharmacy_settings%rowtype;
  v_source public.pharmacy_sources%rowtype;
  v_count integer := 0;
  v_live integer := 0;
  v_latest timestamptz;
  v_districts integer := 0;
  v_next timestamptz;
begin
  select * into v_settings from public.pharmacy_settings where id = 1;
  select * into v_source from public.pharmacy_sources where key = 'teob';

  with duty as (
    select s.place_id, s.starts_at, s.ends_at, s.fetched_at, d.id as district_id
    from public.pharmacy_duty_schedules s
    join public.places p on p.id = s.place_id
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    where c.slug = 'eczane'
      and p.status = 'published'
      and s.status = 'confirmed'
      and s.verified_at is not null
      and s.starts_at < v_day_end
      and s.ends_at > v_day_start
  )
  select count(distinct place_id),
         count(distinct place_id) filter (where starts_at <= v_now and ends_at > v_now),
         count(distinct district_id),
         max(fetched_at)
  into v_count, v_live, v_districts, v_latest
  from duty;

  select min(s.starts_at) into v_next
  from public.pharmacy_duty_schedules s
  where s.status = 'confirmed'
    and s.starts_at > v_now;

  return jsonb_build_object(
    'date', v_today,
    'timezone', 'Europe/Istanbul',
    'count', v_count,
    'on_duty_now', case
      when v_latest is null then 0
      when v_latest < v_now - make_interval(hours => coalesce(v_settings.stale_after_hours, 18)) then 0
      else v_live
    end,
    'districts', v_districts,
    'stale', v_latest is null
      or v_latest < v_now - make_interval(hours => coalesce(v_settings.stale_after_hours, 18)),
    'last_fetched_at', v_latest,
    'next_window_starts_at', v_next,
    'stale_after_hours', coalesce(v_settings.stale_after_hours, 18),
    'source', jsonb_build_object(
      'key', v_source.key,
      'name', v_source.name,
      'attribution', v_source.attribution_text,
      'enabled', coalesce(v_source.is_enabled, false),
      'last_success_at', v_source.last_success_at,
      'last_error', v_source.last_error
    ),
    'generated_at', v_now
  );
end;
$$;

revoke all on function public.pharmacy_duty_status() from public;
grant execute on function public.pharmacy_duty_status() to anon, authenticated, service_role;
