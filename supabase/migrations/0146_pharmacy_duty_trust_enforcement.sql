-- ---------------------------------------------------------------------------
-- Eczane nöbet iddiaları — doğrulanmış kayıt zorunluluğu (uygulanmamış 0144'ün
-- yerine geçer ve onu sıkılaştırır)
--
-- Neden ayrı migration: `0144_pharmacy_honesty_hardening.sql` yazıldı ama
-- veritabanına hiç uygulanmadı (schema_migrations'da 0144 = live_news). Bu
-- dosya aynı politikayı uygular ve iki noktada daha sıkıdır:
--
-- 1) `pharmacy_state` "nöbet" durumunu yalnızca güvenilir kayıtla üretir.
--    `require_verified_duty` açıkken kayıt `confirmed` + `verified_at` dolu
--    olmalıdır; aksi halde durum `unknown` döner ve hiçbir yüzey "nöbetçi"
--    iddiasında bulunmaz.
-- 2) `pharmacy_duty_notice` doğrulanmamış kayıtları listeye hiç almaz;
--    `count` ve `on_duty_now` doğrulanmış + taze kayda dayanır.
-- 3) `confirmed` kayıt `verified_at` olmadan yazılamaz (CHECK kısıtı), böylece
--    "doğrulandı" bilgisi sonradan kaybolamaz.
--
-- Nöbet kaydı yoksa hiçbir alan uydurulmaz; mevcut davranış korunur.
-- ---------------------------------------------------------------------------

-- 1) Bütünlük: doğrulanmış sayılan bir kayıt doğrulama zamanı taşımak zorunda.
alter table public.pharmacy_duty_schedules
  drop constraint if exists pharmacy_duty_confirmed_needs_verified;

alter table public.pharmacy_duty_schedules
  add constraint pharmacy_duty_confirmed_needs_verified
  check (status <> 'confirmed' or verified_at is not null);

-- ---------------------------------------------------------------------------
-- 2) Durum hesabı
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_state(
  p_place_id uuid,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tz          text := 'Europe/Istanbul';
  v_settings    public.pharmacy_settings%rowtype;
  v_local       timestamp;
  v_today       date;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
  v_active      public.pharmacy_duty_schedules%rowtype;
  v_next        public.pharmacy_duty_schedules%rowtype;
  v_today_row   public.pharmacy_duty_schedules%rowtype;
  v_state       text := 'unknown';
  v_hours       jsonb := '{}'::jsonb;
  v_tracking    boolean := false;
  v_stale_hours integer := 18;
  v_require_verified boolean := true;
  v_dow         integer;
  v_slots       jsonb;
  v_slot        jsonb;
  v_from        timestamp;
  v_to          timestamp;
  v_open        boolean := null;
  v_source      text;
  v_stale       boolean := false;
  v_trusted     boolean := false;
  v_shift       jsonb := null;
  v_district_id bigint;
  v_list_published boolean := false;
  v_duty_status text;
begin
  select * into v_settings from public.pharmacy_settings where id = 1;
  if v_settings.id is not null then
    v_stale_hours := coalesce(v_settings.stale_after_hours, 18);
    v_require_verified := coalesce(v_settings.require_verified_duty, true);
  end if;

  select pp.working_hours, pp.duty_tracking
    into v_hours, v_tracking
  from public.pharmacy_profiles pp
  where pp.place_id = p_place_id;

  v_hours := coalesce(v_hours, '{}'::jsonb);
  v_tracking := coalesce(v_tracking, false);
  v_local := p_at at time zone v_tz;
  v_today := v_local::date;
  v_day_start := (v_today::timestamp at time zone v_tz);
  v_day_end := ((v_today + 1)::timestamp at time zone v_tz);

  -- Doğrulanmış kayıt politikası: açıkken yalnızca `confirmed` + `verified_at`.
  v_duty_status := case when v_require_verified then 'confirmed' else 'unverified' end;

  -- 1) Şu an devam eden nöbet
  select * into v_active
  from public.pharmacy_duty_schedules s
  where s.place_id = p_place_id
    and (
      s.status = 'confirmed'
      or (v_duty_status = 'unverified' and s.status = 'unverified')
    )
    and (not v_require_verified or s.verified_at is not null)
    and s.starts_at <= p_at
    and s.ends_at > p_at
  order by (s.status = 'confirmed') desc, s.fetched_at desc
  limit 1;

  if v_active.id is not null then
    v_today_row := v_active;
    v_state := 'on_duty';
  else
    -- 2) Bugün başlayacak nöbet
    select * into v_next
    from public.pharmacy_duty_schedules s
    where s.place_id = p_place_id
      and (
        s.status = 'confirmed'
        or (v_duty_status = 'unverified' and s.status = 'unverified')
      )
      and (not v_require_verified or s.verified_at is not null)
      and s.starts_at > p_at
      and s.starts_at < v_day_end
    order by s.starts_at
    limit 1;

    if v_next.id is not null then
      v_today_row := v_next;
      v_state := 'duty_today_later';
    else
      -- 3) Bugün içinde kalmış (bitmiş) nöbet
      select * into v_today_row
      from public.pharmacy_duty_schedules s
      where s.place_id = p_place_id
        and (
          s.status = 'confirmed'
          or (v_duty_status = 'unverified' and s.status = 'unverified')
        )
        and (not v_require_verified or s.verified_at is not null)
        and s.starts_at < v_day_end
        and s.ends_at > v_day_start
      order by s.starts_at
      limit 1;

      if v_today_row.id is not null then
        v_state := 'duty_today_ended';
      elsif v_tracking then
        -- Eczanenin ilçesinde bugün için doğrulanmış bir liste yayımlandıysa
        -- "nöbetçi değil" demek dürüsttür. Liste hiç yoksa durum bilinmiyor.
        select p.district_id into v_district_id from public.places p where p.id = p_place_id;
        v_list_published := exists (
          select 1
          from public.pharmacy_duty_schedules s2
          join public.places p2 on p2.id = s2.place_id
          where p2.district_id = v_district_id
            and s2.duty_date = v_today
            and s2.status = 'confirmed'
            and s2.verified_at is not null
        );
        v_state := case when v_list_published then 'none' else 'unknown' end;
      else
        v_state := 'unknown';
      end if;
    end if;
  end if;

  -- 4) Tazelik ve güvenilirlik
  if v_today_row.id is not null then
    v_trusted := v_today_row.status = 'confirmed'
      and (
        v_today_row.verified_at is not null
        or not v_require_verified
      );
    v_stale := v_today_row.fetched_at < now() - make_interval(hours => v_stale_hours);
    if v_today_row.source_id is not null then
      select name into v_source from public.pharmacy_sources where id = v_today_row.source_id;
    end if;
    v_shift := jsonb_build_object(
      'duty_date', v_today_row.duty_date,
      'starts_at', v_today_row.starts_at,
      'ends_at', v_today_row.ends_at,
      'status', v_today_row.status,
      'verified', v_today_row.status = 'confirmed' and v_today_row.verified_at is not null,
      'fetched_at', v_today_row.fetched_at,
      'source_name', v_source
    );
  end if;

  -- Güvenilir olmayan kayıt nöbet iddiası üretmez.
  if v_today_row.id is not null and not v_trusted then
    v_state := 'unknown';
  end if;

  -- 5) Çalışma saati (yalnızca doğrulanmış/aktarılmış saat verisi varsa)
  if jsonb_typeof(v_hours) = 'object' and v_hours <> '{}'::jsonb then
    v_dow := extract(isodow from v_local)::integer;
    v_slots := coalesce(
      v_hours -> v_dow::text,
      v_hours -> (array['mon','tue','wed','thu','fri','sat','sun'])[v_dow]
    );
    if jsonb_typeof(v_slots) = 'array' then
      v_open := false;
      for v_slot in select * from jsonb_array_elements(v_slots)
      loop
        begin
          v_from := (v_today::text || ' ' || (v_slot ->> 0))::timestamp;
          if (v_slot ->> 1) = '24:00' then
            v_to := (v_today + 1)::timestamp;
          else
            v_to := (v_today::text || ' ' || (v_slot ->> 1))::timestamp;
          end if;
          if v_local >= v_from and v_local < v_to then
            v_open := true;
            exit;
          end if;
        exception when others then
          -- Bozuk saat biçimi "kapalı" sonucu üretmez; bilinmiyor kalır.
          v_open := null;
        end;
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'state', v_state,
    -- "Şu An Nöbette" yalnızca doğrulanmış ve taze kayıtla iddia edilir.
    'on_duty_now', v_state = 'on_duty' and v_trusted and not v_stale,
    'duty_today', v_state in ('on_duty', 'duty_today_later', 'duty_today_ended') and v_trusted,
    'work_state', case when v_open is true then 'open' when v_open is false then 'closed' else 'unknown' end,
    'hours_known', v_open is not null,
    'stale', v_stale,
    'duty_tracking', v_tracking,
    'shift', v_shift,
    'checked_at', p_at
  );
end;
$$;

revoke all on function public.pharmacy_state(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Günün nöbet duyurusu
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_duty_notice(
  p_district text default null,
  p_neighborhood text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_day_start timestamptz := (public.pharmacy_istanbul_today()::timestamp at time zone 'Europe/Istanbul');
  v_day_end timestamptz := ((public.pharmacy_istanbul_today() + 1)::timestamp at time zone 'Europe/Istanbul');
  v_rows jsonb;
  v_count integer;
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
  v_neighborhood text := nullif(btrim(coalesce(p_neighborhood, '')), '');
  v_latest timestamptz;
  v_stale boolean;
  v_require_verified boolean;
  v_on_duty integer := 0;
  v_settings public.pharmacy_settings%rowtype;
begin
  select * into v_settings from public.pharmacy_settings where id = 1;
  v_require_verified := coalesce(v_settings.require_verified_duty, true);

  with duty as (
    select p.id, p.name, pp.slug, d.name as district, pp.neighborhood,
           s.starts_at, s.ends_at, s.status, s.fetched_at, s.verified_at,
           s.duty_date
    from public.pharmacy_duty_schedules s
    join public.places p on p.id = s.place_id
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    join public.pharmacy_profiles pp on pp.place_id = p.id
    where c.slug = 'eczane'
      and p.status = 'published'
      and (
        s.status = 'confirmed'
        or (not v_require_verified and s.status = 'unverified')
      )
      and (not v_require_verified or s.verified_at is not null)
      and s.starts_at < v_day_end
      and s.ends_at > v_day_start
      and (v_district is null or lower(d.name) = lower(v_district))
      and (v_neighborhood is null or lower(coalesce(pp.neighborhood, '')) = lower(v_neighborhood))
  ),
  agg as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'slug', d.slug,
        'district', d.district,
        'neighborhood', d.neighborhood,
        'starts_at', d.starts_at,
        'ends_at', d.ends_at,
        'status', d.status,
        'duty_date', d.duty_date,
        'verified', d.status = 'confirmed' and d.verified_at is not null,
        'on_duty_now', d.starts_at <= v_now and d.ends_at > v_now
      ) order by d.starts_at), '[]'::jsonb) as items,
      count(*) as cnt,
      count(*) filter (where d.starts_at <= v_now and d.ends_at > v_now) as live_cnt,
      max(d.fetched_at) as latest
    from duty d
  )
  select items, cnt, live_cnt, latest into v_rows, v_count, v_on_duty, v_latest from agg;

  v_stale := v_latest is null
    or v_latest < v_now - make_interval(hours => coalesce(v_settings.stale_after_hours, 18));

  return jsonb_build_object(
    'date', public.pharmacy_istanbul_today(),
    'district', v_district,
    'neighborhood', v_neighborhood,
    'count', v_count,
    -- Liste eskiyse "şu an nöbette" sayısı iddia edilmez.
    'on_duty_now', case when v_stale then 0 else v_on_duty end,
    'items', v_rows,
    'stale', v_stale,
    'last_fetched_at', v_latest,
    'stale_after_hours', coalesce(v_settings.stale_after_hours, 18),
    'verified_sources_only', v_require_verified,
    'generated_at', v_now
  );
end;
$$;

revoke all on function public.pharmacy_duty_notice(text, text) from public;
grant execute on function public.pharmacy_duty_notice(text, text) to anon, authenticated, service_role;
