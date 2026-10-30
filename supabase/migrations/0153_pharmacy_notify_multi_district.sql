-- ===========================================================================
-- 0153 — Eczane nöbet bildirimi: çoklu ilçe aboneliği
--
-- • Kullanıcı birden çok ilçeye abone olabilir (`districts text[]`).
-- • Eski tek ilçe sütunu (`district`) mahalle eşleşmesi ve geriye uyumluluk
--   için korunur; tek ilçe seçiliyken o ilçeyi taşır.
-- • Gönderimde kullanıcı başına günde tek bildirim kuralı korunur; seçili
--   ilçelerin nöbet bilgisi tek bildirimde birleştirilir.
-- ===========================================================================

alter table public.pharmacy_notification_preferences
  add column if not exists districts text[] not null default '{}'::text[];

alter table public.pharmacy_notification_preferences
  drop constraint if exists pharmacy_prefs_districts_max;
alter table public.pharmacy_notification_preferences
  add constraint pharmacy_prefs_districts_max check (cardinality(districts) <= 25);

update public.pharmacy_notification_preferences
set districts = array[district]
where district is not null and cardinality(districts) = 0;

-- ---------------------------------------------------------------------------
-- İlçe listesini doğrular, kanonik ada çevirir ve tekilleştirir.
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_normalize_districts(p_districts text[])
returns text[]
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_input text;
  v_name text;
  v_out text[] := '{}'::text[];
begin
  foreach v_input in array coalesce(p_districts, '{}'::text[]) loop
    v_input := nullif(btrim(coalesce(v_input, '')), '');
    if v_input is null then
      continue;
    end if;
    v_name := null;
    select d.name into v_name from public.districts d where lower(d.name) = lower(v_input) limit 1;
    if v_name is null then
      raise exception 'invalid_district' using errcode = '22023';
    end if;
    if not (v_name = any (v_out)) then
      v_out := v_out || v_name;
    end if;
  end loop;
  if cardinality(v_out) > 25 then
    raise exception 'too_many_districts' using errcode = '22023';
  end if;
  return v_out;
end;
$$;

revoke all on function public.pharmacy_normalize_districts(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tercih okuma
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_notification_prefs_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.pharmacy_notification_preferences%rowtype;
  v_settings public.pharmacy_settings%rowtype;
begin
  select * into v_row from public.pharmacy_notification_preferences where user_id = v_uid;
  select * into v_settings from public.pharmacy_settings where id = 1;

  return jsonb_build_object(
    'enabled', coalesce(v_row.enabled, false),
    'district', v_row.district,
    'districts', to_jsonb(coalesce(v_row.districts, '{}'::text[])),
    'neighborhood', v_row.neighborhood,
    'notify_hour', coalesce(v_row.notify_hour, coalesce(v_settings.default_notify_hour, 9)),
    'updated_at', v_row.updated_at,
    'global_enabled', coalesce(v_settings.notifications_enabled, false),
    'allowed_channels', jsonb_build_array('in_app')
  );
end;
$$;

revoke all on function public.pharmacy_notification_prefs_get() from public, anon;
grant execute on function public.pharmacy_notification_prefs_get() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Çoklu ilçe kaydı. Mahalle yalnızca tek ilçe seçiliyken anlamlıdır; birden
-- çok ilçe seçildiğinde mahalle sessizce temizlenir.
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_notification_districts_set(
  p_enabled boolean,
  p_districts text[],
  p_neighborhood text default null,
  p_notify_hour integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_districts text[] := public.pharmacy_normalize_districts(p_districts);
  v_primary text;
  v_neighborhood text := nullif(btrim(coalesce(p_neighborhood, '')), '');
  v_current public.pharmacy_notification_preferences%rowtype;
  v_hour smallint;
  v_settings public.pharmacy_settings%rowtype;
begin
  select * into v_current from public.pharmacy_notification_preferences where user_id = v_uid;
  select * into v_settings from public.pharmacy_settings where id = 1;

  v_hour := least(greatest(coalesce(
    p_notify_hour, v_current.notify_hour, v_settings.default_notify_hour, 9
  ), 0), 23);

  if coalesce(p_enabled, false) and cardinality(v_districts) = 0 then
    raise exception 'district_required' using errcode = '22023';
  end if;

  v_primary := case when cardinality(v_districts) = 1 then v_districts[1] else null end;
  if v_primary is null then
    v_neighborhood := null;
  end if;

  if v_neighborhood is not null and char_length(v_neighborhood) < 2 then
    raise exception 'invalid_neighborhood' using errcode = '22023';
  end if;
  if v_neighborhood is not null and not exists (
    select 1
    from public.pharmacy_profiles pp
    join public.places p on p.id = pp.place_id
    join public.place_categories c on c.id = p.category_id
    join public.districts d on d.id = p.district_id
    where c.slug = 'eczane'
      and lower(d.name) = lower(v_primary)
      and lower(coalesce(pp.neighborhood, '')) = lower(v_neighborhood)
  ) then
    raise exception 'unknown_neighborhood' using errcode = '22023';
  end if;

  insert into public.pharmacy_notification_preferences (
    user_id, enabled, district, districts, neighborhood, notify_hour
  )
  values (v_uid, coalesce(p_enabled, false), v_primary, v_districts, v_neighborhood, v_hour)
  on conflict (user_id) do update
    set enabled = excluded.enabled,
        district = excluded.district,
        districts = excluded.districts,
        neighborhood = excluded.neighborhood,
        notify_hour = excluded.notify_hour;

  return public.pharmacy_notification_prefs_get();
end;
$$;

revoke all on function public.pharmacy_notification_districts_set(boolean, text[], text, integer) from public, anon;
grant execute on function public.pharmacy_notification_districts_set(boolean, text[], text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tek dokunuşla ilçe ekle/çıkar (liste ekranındaki ilçe çipleri).
-- Eklemek aboneliği açar; son ilçe çıkarılınca abonelik kapanır.
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_notification_district_toggle(p_district text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_target text[] := public.pharmacy_normalize_districts(array[p_district]);
  v_name text;
  v_current public.pharmacy_notification_preferences%rowtype;
  v_next text[];
  v_neighborhood text;
begin
  if cardinality(v_target) = 0 then
    raise exception 'district_required' using errcode = '22023';
  end if;
  v_name := v_target[1];

  select * into v_current from public.pharmacy_notification_preferences where user_id = v_uid;
  -- Kapalı abonelikte eski ilçe listesi geri açılmaz; seçim sıfırdan başlar.
  v_next := case when coalesce(v_current.enabled, false)
    then coalesce(v_current.districts, '{}'::text[])
    else '{}'::text[]
  end;

  if v_name = any (v_next) then
    v_next := array_remove(v_next, v_name);
  else
    v_next := v_next || v_name;
  end if;

  -- Mahalle yalnızca kalan tek ilçe mahallenin ilçesiyse korunur.
  v_neighborhood := case
    when cardinality(v_next) = 1 and lower(coalesce(v_current.district, '')) = lower(v_next[1])
      then v_current.neighborhood
    else null
  end;

  return public.pharmacy_notification_districts_set(
    cardinality(v_next) > 0, v_next, v_neighborhood, v_current.notify_hour
  );
end;
$$;

revoke all on function public.pharmacy_notification_district_toggle(text) from public, anon;
grant execute on function public.pharmacy_notification_district_toggle(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Eski tek ilçe API'si: eski istemciler için `districts` ile senkron tutulur.
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_notification_prefs_set(
  p_enabled boolean,
  p_district text default null,
  p_neighborhood text default null,
  p_notify_hour integer default 9
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
begin
  if nullif(btrim(coalesce(p_neighborhood, '')), '') is not null and v_district is null then
    raise exception 'district_required_for_neighborhood' using errcode = '22023';
  end if;
  return public.pharmacy_notification_districts_set(
    coalesce(p_enabled, false) and v_district is not null,
    case when v_district is null then '{}'::text[] else array[v_district] end,
    p_neighborhood,
    p_notify_hour
  );
end;
$$;

revoke all on function public.pharmacy_notification_prefs_set(boolean, text, text, integer) from public, anon;
grant execute on function public.pharmacy_notification_prefs_set(boolean, text, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Yönetim önizleme: uygun abone sayısı çoklu ilçeyi dikkate alır.
-- ---------------------------------------------------------------------------
create or replace function public.admin_pharmacy_notifications_preview(
  p_district text default null,
  p_neighborhood text default null,
  p_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.view');
  v_date date := coalesce(p_date, public.pharmacy_istanbul_today());
  v_notice jsonb;
  v_names text;
  v_title text;
  v_body text;
  v_enabled integer;
begin
  select count(*) into v_enabled
  from public.pharmacy_notification_preferences pr
  where pr.enabled
    and (
      p_district is null
      or exists (select 1 from unnest(pr.districts) x where lower(x) = lower(btrim(p_district)))
    );

  v_notice := public.pharmacy_duty_notice(p_district, p_neighborhood);

  select string_agg(e ->> 'name', ', ' order by e ->> 'starts_at')
  into v_names
  from jsonb_array_elements(coalesce(v_notice -> 'items', '[]'::jsonb)) e;

  if coalesce((v_notice ->> 'count')::integer, 0) = 0 then
    v_title := 'Nöbet listesi henüz yayımlanmadı';
    v_body := 'Seçili bölge için doğrulanmış nöbet kaydı bulunmuyor. Eczane adı içeren bildirim gönderilmez.';
  elsif coalesce((v_notice ->> 'stale')::boolean, true) then
    v_title := 'Nöbet verisi güncel değil';
    v_body := 'Kaynak tazelik eşiğini aştı. Eczane adı içeren bildirim gönderilmez; önce senkronizasyon çalıştırılmalı.';
  elsif p_neighborhood is not null and jsonb_array_length(v_notice -> 'items') = 1 then
    v_title := format('💊 Bugün %s Mahallesi''nde %s nöbetçi', p_neighborhood, v_names);
    v_body := 'Nöbet saatleri, adres, telefon ve yol tarifi Trabzone''da. Yola çıkmadan önce eczaneyi telefonla arayın.';
  else
    v_title := format('💊 %s: bugün %s nöbetçi eczane', coalesce(p_district, 'Trabzon'), v_notice ->> 'count');
    v_body := format('%s. Adres, telefon ve yol tarifi için dokunun. Yola çıkmadan önce arayarak teyit edin.', coalesce(v_names, ''));
  end if;

  return jsonb_build_object(
    'date', v_date,
    'district', p_district,
    'neighborhood', p_neighborhood,
    'eligible_subscribers', v_enabled,
    'notice_count', coalesce((v_notice ->> 'count')::integer, 0),
    'stale', coalesce((v_notice ->> 'stale')::boolean, true),
    'sendable', coalesce((v_notice ->> 'count')::integer, 0) > 0 and not coalesce((v_notice ->> 'stale')::boolean, true),
    'title', v_title,
    'body', v_body,
    'already_sent', (
      select count(*) from public.pharmacy_notification_log l
      where l.duty_date = v_date
        and (
          p_district is null
          or l.district is null
          or lower(btrim(p_district)) = any (string_to_array(lower(l.district), ', '))
        )
    )
  );
end;
$$;

revoke all on function public.admin_pharmacy_notifications_preview(text, text, date) from public, anon;
grant execute on function public.admin_pharmacy_notifications_preview(text, text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Gönderim: kullanıcı başına günde tek bildirim; seçili ilçeler birleştirilir.
-- Verisi olmayan veya eski ilçeler bildirime girmez; hiçbiri uygun değilse
-- bildirim gönderilmez.
-- ---------------------------------------------------------------------------
create or replace function public.admin_pharmacy_notifications_dispatch(
  p_date date default null,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('pharmacy.notify');
  v_settings public.pharmacy_settings%rowtype;
  v_date date := coalesce(p_date, public.pharmacy_istanbul_today());
  v_now_local timestamp := now() at time zone 'Europe/Istanbul';
  v_hour integer := extract(hour from v_now_local)::integer;
  v_pref public.pharmacy_notification_preferences%rowtype;
  v_targets text[];
  v_target text;
  v_neighborhood text;
  v_notice jsonb;
  v_count integer;
  v_stale boolean;
  v_names text;
  v_parts_title text[];
  v_parts_body text[];
  v_hit_districts text[];
  v_total integer;
  v_single_names text;
  v_single_count integer;
  v_title text;
  v_body text;
  v_route text;
  v_notification_id uuid;
  v_sent integer := 0;
  v_skipped integer := 0;
  v_eligible integer := 0;
  v_samples jsonb := '[]'::jsonb;
begin
  select * into v_settings from public.pharmacy_settings where id = 1;
  if not coalesce(v_settings.notifications_enabled, false) then
    raise exception 'notifications_disabled' using errcode = '42501';
  end if;

  for v_pref in
    select * from public.pharmacy_notification_preferences
    where enabled
      and notify_hour <= v_hour
    order by created_at
  loop
    v_eligible := v_eligible + 1;

    if exists (
      select 1 from public.pharmacy_notification_log l
      where l.user_id = v_pref.user_id and l.duty_date = v_date and l.channel = 'in_app'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_targets := case
      when cardinality(v_pref.districts) > 0 then v_pref.districts
      when v_pref.district is not null then array[v_pref.district]
      else array[null]::text[]
    end;
    v_neighborhood := case when cardinality(v_targets) = 1 then v_pref.neighborhood else null end;

    v_parts_title := '{}'::text[];
    v_parts_body := '{}'::text[];
    v_hit_districts := '{}'::text[];
    v_total := 0;
    v_single_names := null;
    v_single_count := 0;

    foreach v_target in array v_targets loop
      v_notice := public.pharmacy_duty_notice(v_target, v_neighborhood);
      v_count := coalesce((v_notice ->> 'count')::integer, 0);
      v_stale := coalesce((v_notice ->> 'stale')::boolean, true);

      -- Veri yoksa veya tazelik eşiği aşıldıysa eczane adı içeren bildirim gitmez.
      if v_count = 0 or v_stale then
        continue;
      end if;

      select string_agg(e ->> 'name', ', ' order by e ->> 'starts_at')
      into v_names
      from jsonb_array_elements(v_notice -> 'items') e;

      v_total := v_total + v_count;
      v_single_names := v_names;
      v_single_count := v_count;
      v_hit_districts := v_hit_districts || coalesce(v_target, 'Trabzon');
      v_parts_title := v_parts_title || format('%s %s', coalesce(v_target, 'Trabzon'), v_count);
      v_parts_body := v_parts_body || format('%s: %s', coalesce(v_target, 'Trabzon'), coalesce(v_names, ''));
    end loop;

    if cardinality(v_hit_districts) = 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if cardinality(v_hit_districts) = 1 then
      if v_neighborhood is not null and v_single_count = 1 then
        v_title := format('💊 Bugün %s Mahallesi''nde %s nöbetçi', v_neighborhood, v_single_names);
        v_body := 'Nöbet saatleri, adres ve yol tarifi Trabzone''da. Yola çıkmadan önce eczaneyi arayarak teyit edin.';
      else
        v_title := format('💊 %s: bugün %s nöbetçi eczane', v_hit_districts[1], v_single_count);
        v_body := format('%s. Adres ve yol tarifi için dokunun.', coalesce(v_single_names, ''));
      end if;
    else
      v_title := format('💊 Bugün %s nöbetçi eczane · %s', v_total, array_to_string(v_parts_title, ' · '));
      v_body := array_to_string(v_parts_body, ' • ') || '. Adres ve yol tarifi için dokunun.';
    end if;

    if char_length(v_title) > 160 then
      v_title := left(v_title, 157) || '…';
    end if;
    if char_length(v_body) > 600 then
      v_body := left(v_body, 597) || '…';
    end if;

    v_route := '/eczaneler';

    if p_dry_run then
      if jsonb_array_length(v_samples) < 10 then
        v_samples := v_samples || jsonb_build_array(jsonb_build_object(
          'user_id', v_pref.user_id,
          'district', array_to_string(v_hit_districts, ', '),
          'neighborhood', v_neighborhood,
          'title', v_title,
          'body', v_body,
          'route', v_route
        ));
      end if;
    else
      insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, route)
      values (v_pref.user_id, 'pharmacy', v_title, v_body, 'pharmacy_duty_day', v_date::text, v_route)
      returning id into v_notification_id;

      insert into public.pharmacy_notification_log (
        user_id, duty_date, district, neighborhood, duty_count, title, body, channel, notification_id
      ) values (
        v_pref.user_id, v_date, array_to_string(v_hit_districts, ', '), v_neighborhood, v_total,
        v_title, v_body, 'in_app', v_notification_id
      )
      on conflict (user_id, duty_date, channel) do nothing;

      v_sent := v_sent + 1;
    end if;
  end loop;

  if not p_dry_run then
    perform public.tz_admin_audit(
      'pharmacy.notify.dispatch', 'Eczane nöbet bildirimleri gönderildi', 'pharmacy_notification', v_date::text,
      jsonb_build_object('sent', v_sent, 'skipped', v_skipped, 'eligible', v_eligible), 'success'
    );
  end if;

  return jsonb_build_object(
    'date', v_date,
    'dry_run', p_dry_run,
    'eligible', v_eligible,
    'sent', v_sent,
    'skipped', v_skipped,
    'samples', v_samples,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.admin_pharmacy_notifications_dispatch(date, boolean) from public, anon;
grant execute on function public.admin_pharmacy_notifications_dispatch(date, boolean) to authenticated, service_role;
