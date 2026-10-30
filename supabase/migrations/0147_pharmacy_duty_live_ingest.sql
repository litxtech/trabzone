-- ---------------------------------------------------------------------------
-- Eczane nöbet listesi — canlı içe aktarma (Trabzon Eczacı Odası)
--
-- Amaç: kullanıcı "bugün hangi eczane nöbetçi" sorusunun cevabını resmî
-- kaynaktan, gecikmesiz ve uydurma olmadan görsün.
--
-- 1) `pharmacy_duty_ingest` — yetkili kaynağın (service_role) gönderdiği
--    kayıtları eczane envanteriyle eşler, nöbet penceresini yazar, doğrulanma
--    zamanını kaydeder. Eşleşmeyen kayıt UYDURULMAZ; yeni eczane ise resmî
--    kaynaktan oluşturulur (ad/adres/telefon/koordinat kaynaktan gelir).
-- 2) Aynı kaynaktan artık yayımlanmayan "gelecek/aktif" nöbet iddiaları
--    temizlenir; böylece iptal edilen nöbet listede kalmaz.
-- 3) `pharmacy_duty_tick` + pg_cron: 10 dakikada bir edge function tetiklenir.
-- 4) `pharmacy_detail` fotoğraf galerisini döndürür (place_media, onaylı).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) Ayar alanları: zamanlayıcı durumu
-- ---------------------------------------------------------------------------
alter table public.pharmacy_settings
  add column if not exists worker_url text,
  add column if not exists sync_interval_minutes integer not null default 10,
  add column if not exists last_tick_at timestamptz,
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_sync_error text,
  add column if not exists last_sync_error_at timestamptz;

update public.pharmacy_settings
   set worker_url = coalesce(worker_url, 'https://nzvoufcywppavaioirac.supabase.co'),
       sync_interval_minutes = 10
 where id = 1;

-- ---------------------------------------------------------------------------
-- 2) Resmî kaynak: Trabzon Eczacı Odası
-- ---------------------------------------------------------------------------
insert into public.pharmacy_sources (
  key, name, kind, homepage_url, license_note, attribution_text,
  is_primary, is_enabled, priority, sync_interval_minutes, verified_license
)
values (
  'teob',
  'Trabzon Eczacı Odası nöbet listesi',
  'official_portal',
  'https://www.trabzoneczaciodasi.org.tr/nobetci-eczaneler/61',
  'Odanın resmî nöbet listesi. Kayıtlar olduğu gibi aktarılır; eksik alan uydurulmaz.',
  'Trabzon Eczacı Odası (trabzoneczaciodasi.org.tr)',
  true, true, 1, 10, true
)
on conflict (key) do update
  set name = excluded.name,
      kind = excluded.kind,
      homepage_url = excluded.homepage_url,
      license_note = excluded.license_note,
      attribution_text = excluded.attribution_text,
      is_primary = true,
      is_enabled = true,
      priority = 1,
      sync_interval_minutes = 10,
      verified_license = true;

-- ---------------------------------------------------------------------------
-- 3) Worker çağrı anahtarı (mevcut iç worker sırrıyla aynı)
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_duty_worker_token_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
  from vault.decrypted_secrets
  where name = 'ai_news_cron_secret';

  if v_expected is null or coalesce(p_token, '') = '' then
    return false;
  end if;

  return encode(digest(p_token, 'sha256'), 'hex') = encode(digest(v_expected, 'sha256'), 'hex');
end;
$$;

revoke all on function public.pharmacy_duty_worker_token_ok(text) from public, anon, authenticated;
grant execute on function public.pharmacy_duty_worker_token_ok(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4) İçe aktarma
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_duty_ingest(
  p_source_key text,
  p_records jsonb,
  p_fetched_at timestamptz default now(),
  p_mark_verified boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_source        public.pharmacy_sources%rowtype;
  v_settings      public.pharmacy_settings%rowtype;
  v_started       timestamptz := clock_timestamp();
  v_log_id        uuid;
  v_rec           jsonb;
  v_name          text;
  v_district      text;
  v_district_id   bigint;
  v_district_slug text;
  v_address       text;
  v_phone         text;
  v_phone_digits  text;
  v_lat           double precision;
  v_lng           double precision;
  v_starts_at     timestamptz;
  v_ends_at       timestamptz;
  v_duty_date     date;
  v_core          text;
  v_source_ref    text;
  v_place_id      uuid;
  v_existing_name text;
  v_existing_src  text;
  v_existing_prov text;
  v_profile_slug  text;
  v_status        text;
  v_duty_id       uuid;
  v_ids           uuid[] := '{}';
  v_received      integer := 0;
  v_matched       integer := 0;
  v_created       integer := 0;
  v_unmatched     integer := 0;
  v_rejected      integer := 0;
  v_written       integer := 0;
  v_conflicts     integer := 0;
  v_removed       integer := 0;
  v_category_id   uuid;
  v_city_id       uuid;
  v_existing      integer;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'records_must_be_array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_records) > 2000 then
    raise exception 'too_many_records' using errcode = '22023';
  end if;

  select * into v_source from public.pharmacy_sources where key = lower(btrim(coalesce(p_source_key, '')));
  if v_source.id is null then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;

  select * into v_settings from public.pharmacy_settings where id = 1;

  select c.id into v_category_id from public.place_categories c where c.slug = 'eczane';
  if v_category_id is null then
    raise exception 'category_missing' using errcode = 'P0002';
  end if;

  select ci.id into v_city_id from public.cities ci where ci.slug = 'trabzon';
  if v_city_id is null then
    raise exception 'city_missing' using errcode = 'P0002';
  end if;

  insert into public.pharmacy_sync_logs (source_id, source_key, run_kind, status, started_at)
  values (v_source.id, v_source.key, 'scheduled', 'partial', v_started)
  returning id into v_log_id;

  for v_rec in select * from jsonb_array_elements(p_records)
  loop
    v_received := v_received + 1;
    v_place_id := null;

    v_name := nullif(btrim(coalesce(v_rec ->> 'name', '')), '');
    if v_name is null or char_length(v_name) < 3 then
      v_rejected := v_rejected + 1;
      continue;
    end if;
    v_name := left(v_name, 140);

    v_district := nullif(btrim(coalesce(v_rec ->> 'district', '')), '');
    v_address := nullif(btrim(coalesce(v_rec ->> 'address', '')), '');
    v_phone := nullif(btrim(coalesce(v_rec ->> 'phone', '')), '');
    v_phone_digits := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');
    if v_phone_digits is not null and char_length(v_phone_digits) < 10 then
      v_phone_digits := null;
    end if;
    v_source_ref := nullif(btrim(coalesce(v_rec ->> 'source_ref', '')), '');

    begin
      v_lat := nullif(v_rec ->> 'lat', '')::double precision;
      v_lng := nullif(v_rec ->> 'lng', '')::double precision;
    exception when others then
      v_lat := null;
      v_lng := null;
    end;
    -- Envanter sınırları dışındaki koordinat kullanılmaz.
    if v_lat is not null and (v_lat < 40.55 or v_lat > 41.25) then
      v_lat := null;
    end if;
    if v_lng is not null and (v_lng < 38.90 or v_lng > 40.70) then
      v_lng := null;
    end if;
    if v_lat is null or v_lng is null then
      v_lat := null;
      v_lng := null;
    end if;

    begin
      v_starts_at := nullif(v_rec ->> 'starts_at', '')::timestamptz;
      v_ends_at := nullif(v_rec ->> 'ends_at', '')::timestamptz;
    exception when others then
      v_starts_at := null;
      v_ends_at := null;
    end;
    if v_starts_at is null or v_ends_at is null or v_ends_at <= v_starts_at then
      v_rejected := v_rejected + 1;
      continue;
    end if;
    if v_ends_at > v_starts_at + interval '30 hours' then
      v_rejected := v_rejected + 1;
      continue;
    end if;
    v_duty_date := (v_starts_at at time zone 'Europe/Istanbul')::date;

    if v_district is not null then
      select d.id, d.slug into v_district_id, v_district_slug
      from public.districts d
      where d.city_id = v_city_id
        and public.pharmacy_slugify(d.name) = public.pharmacy_slugify(v_district)
      limit 1;
    end if;

    v_core := public.pharmacy_core_name(v_name);

    -- Eşleştirme 1: resmî telefon (en güvenilir; numara değişmiş olabilir)
    if v_phone_digits is not null then
      select p.id into v_place_id
      from public.places p
      where p.category_id = v_category_id
        and p.status = 'published'
        and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_phone_digits
      order by p.review_count desc
      limit 1;
    end if;

    -- Eşleştirme 2: aynı ilçede aynı çekirdek ad
    if v_place_id is null then
      select p.id into v_place_id
      from public.places p
      where p.category_id = v_category_id
        and p.status = 'published'
        and public.pharmacy_core_name(p.name) = v_core
        and (
          v_district_id is null
          or p.district_id = v_district_id
        )
      order by p.review_count desc
      limit 1;
    end if;

    -- Eşleştirme 3: ad Türkiye'de tek anlamlıysa (Sağlık Eczanesi gibi
    -- çoklu eşleşmelerde bu yol KULLANILMAZ; yanlış eczaneye nöbet yazılmaz).
    if v_place_id is null then
      select count(*) into v_existing
      from public.places p
      where p.category_id = v_category_id
        and p.status = 'published'
        and public.pharmacy_core_name(p.name) = v_core;

      if v_existing = 1 then
        select p.id into v_place_id
        from public.places p
        where p.category_id = v_category_id
          and p.status = 'published'
          and public.pharmacy_core_name(p.name) = v_core;
      end if;
    end if;

    -- Eşleştirme 4: aynı ilçede koordinat yakınlığı + ad benzerliği
    if v_place_id is null and v_lat is not null then
      select p.id into v_place_id
      from public.places p
      where p.category_id = v_category_id
        and p.status = 'published'
        and (v_district_id is null or p.district_id = v_district_id)
        and ST_DWithin(p.geog, ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography, 400)
        and (
          public.pharmacy_core_name(p.name) = v_core
          or public.pharmacy_core_name(p.name) like '%' || v_core || '%'
          or v_core like '%' || public.pharmacy_core_name(p.name) || '%'
        )
      order by ST_Distance(p.geog, ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography)
      limit 1;
    end if;

    -- Eşleşme yok: resmî kayıt kendi kaydını oluşturur (alanlar kaynaktan).
    if v_place_id is null then
      if v_district_id is null or v_lat is null or v_lng is null then
        v_unmatched := v_unmatched + 1;
        insert into public.pharmacy_unmatched_duty (
          source_id, sync_log_id, raw_name, raw_district, raw_neighborhood,
          raw_address, raw_phone, duty_date, starts_at, ends_at, note
        ) values (
          v_source.id, v_log_id, v_name, v_district, null,
          v_address, v_phone, v_duty_date, v_starts_at, v_ends_at,
          case when v_district_id is null then 'district_not_found'
               else 'coordinates_missing' end
        )
        on conflict (source_id, lower(raw_name), duty_date) do update
          set raw_district = excluded.raw_district,
              raw_address = excluded.raw_address,
              raw_phone = excluded.raw_phone,
              starts_at = excluded.starts_at,
              ends_at = excluded.ends_at,
              note = excluded.note;
        continue;
      end if;

      v_profile_slug := left(
        'eczane-' || public.pharmacy_slugify(v_name) || '-' || coalesce(v_district_slug, 'trabzon'),
        110
      );
      select count(*) into v_existing
      from public.pharmacy_profiles pp
      where pp.slug like v_profile_slug || '%';
      if v_existing > 0 then
        v_profile_slug := v_profile_slug || '-' || (v_existing + 1)::text;
      end if;

      insert into public.places (
        name, category_id, city_id, district_id, address, lat, lng, geog, phone,
        status, verification_status, is_verified, verified_at,
        data_source, external_provider, external_id
      ) values (
        v_name, v_category_id, v_city_id, v_district_id, left(coalesce(v_address, ''), 400),
        v_lat, v_lng, ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography,
        left(v_phone, 30),
        'published', 'verified', true, p_fetched_at,
        'external_reference', v_source.key, v_source_ref
      )
      returning id into v_place_id;

      insert into public.pharmacy_profiles (
        place_id, slug, neighborhood, neighborhood_source, address_text, phone_text,
        inventory_source, duty_tracking, duty_verified_at, data_verified_at, notes
      ) values (
        v_place_id, v_profile_slug, null, null, v_address, v_phone,
        'official_list', true,
        case when p_mark_verified then p_fetched_at else null end,
        p_fetched_at,
        'Trabzon Eczacı Odası resmî nöbet listesinden oluşturuldu'
      )
      on conflict (place_id) do nothing;

      v_created := v_created + 1;
      v_matched := v_matched + 1;
    else
      -- Anlamsız ad ("Eczane", "Eczanesi") ve bu kaynağın kendi oluşturduğu
      -- kayıtların yazımı resmî adla hizalanır; gerçek isimler korunur.
      select p.name, p.data_source, p.external_provider
        into v_existing_name, v_existing_src, v_existing_prov
      from public.places p where p.id = v_place_id;

      if public.pharmacy_core_name(v_existing_name) in ('', 'eczane', 'eczanesi')
         or (
           v_existing_src = 'external_reference'
           and v_existing_prov = v_source.key
           and v_existing_name is distinct from v_name
         ) then
        update public.places
           set name = v_name,
               updated_at = now()
         where id = v_place_id;
      end if;

      -- Bilinen eczane: yalnızca boş alanlar resmî kayıttan tamamlanır.
      update public.pharmacy_profiles
         set address_text = coalesce(address_text, v_address),
             phone_text = coalesce(phone_text, v_phone),
             duty_tracking = true,
             duty_verified_at = case when p_mark_verified then p_fetched_at else duty_verified_at end
       where place_id = v_place_id;

      update public.places
         set phone = coalesce(phone, left(v_phone, 30))
       where id = v_place_id and phone is null;

      v_matched := v_matched + 1;
    end if;

    -- Çakışan başka kaynak iddiaları "conflict" olarak işaretlenir.
    if exists (
      select 1 from public.pharmacy_duty_schedules s
      where s.place_id = v_place_id
        and s.source_id is distinct from v_source.id
        and s.status in ('confirmed', 'unverified')
        and s.starts_at < v_ends_at
        and s.ends_at > v_starts_at
    ) then
      v_conflicts := v_conflicts + 1;
      update public.pharmacy_duty_schedules
         set status = 'conflict'
       where place_id = v_place_id
         and source_id is distinct from v_source.id
         and status in ('confirmed', 'unverified')
         and starts_at < v_ends_at
         and ends_at > v_starts_at;
    end if;

    v_status := case when p_mark_verified then 'confirmed' else 'unverified' end;

    insert into public.pharmacy_duty_schedules (
      place_id, duty_date, starts_at, ends_at, source_id, source_ref,
      status, fetched_at, verified_at
    ) values (
      v_place_id, v_duty_date, v_starts_at, v_ends_at, v_source.id, v_source_ref,
      v_status, p_fetched_at,
      case when p_mark_verified then p_fetched_at else null end
    )
    on conflict (place_id, starts_at) do update
      set ends_at = excluded.ends_at,
          source_id = excluded.source_id,
          source_ref = coalesce(excluded.source_ref, public.pharmacy_duty_schedules.source_ref),
          status = excluded.status,
          fetched_at = excluded.fetched_at,
          verified_at = case
            when excluded.verified_at is not null then excluded.verified_at
            else public.pharmacy_duty_schedules.verified_at
          end
    returning id into v_duty_id;

    v_ids := v_ids || v_duty_id;
    v_written := v_written + 1;
  end loop;

  -- Kaynaktan artık yayımlanmayan gelecek/aktif iddiaları kaldır: iptal edilen
  -- nöbet kullanıcıya "nöbetçi" diye gösterilmemeli.
  with removed as (
    delete from public.pharmacy_duty_schedules s
    where s.source_id = v_source.id
      and s.ends_at > now()
      and not (s.id = any(v_ids))
    returning s.id
  )
  select count(*) into v_removed from removed;

  -- Geçmiş kayıtların temizliği (detay sayfası geçmişi 5 gün tutar).
  delete from public.pharmacy_duty_schedules s
  where s.source_id = v_source.id
    and s.ends_at < now() - interval '5 days';

  update public.pharmacy_sync_logs
     set status = case when v_rejected > 0 and v_written = 0 then 'failed' else 'success' end,
         records_received = v_received,
         records_matched = v_matched,
         records_unmatched = v_unmatched,
         records_rejected = v_rejected,
         duty_written = v_written,
         conflicts = v_conflicts,
         finished_at = now(),
         duration_ms = extract(milliseconds from clock_timestamp() - v_started)::integer
   where id = v_log_id;

  update public.pharmacy_sources
     set last_run_at = now(),
         last_success_at = case when v_written > 0 then now() else last_success_at end,
         last_error = case when v_written = 0 then 'no_records_written' else null end,
         last_error_at = case when v_written = 0 then now() else null end
   where id = v_source.id;

  update public.pharmacy_settings
     set last_sync_at = case when v_written > 0 then now() else last_sync_at end,
         last_sync_error = case when v_written = 0 then 'no_records_written' else null end,
         last_sync_error_at = case when v_written = 0 then now() else null end
   where id = 1;

  return jsonb_build_object(
    'received', v_received,
    'matched', v_matched,
    'created', v_created,
    'unmatched', v_unmatched,
    'rejected', v_rejected,
    'written', v_written,
    'conflicts', v_conflicts,
    'removed', v_removed,
    'source_key', v_source.key,
    'fetched_at', p_fetched_at
  );
end;
$$;

revoke all on function public.pharmacy_duty_ingest(text, jsonb, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.pharmacy_duty_ingest(text, jsonb, timestamptz, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5) Zamanlayıcı: pg_cron → pg_net → edge function
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_duty_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings public.pharmacy_settings%rowtype;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from public.pharmacy_settings where id = 1;

  if v_settings.worker_url is null then
    return jsonb_build_object('queued', false, 'reason', 'worker_url_missing');
  end if;

  -- Aynı dakikada iki çağrı olmasın.
  if v_settings.last_tick_at is not null
     and v_settings.last_tick_at > now() - make_interval(mins => greatest(coalesce(v_settings.sync_interval_minutes, 10) - 1, 1)) then
    return jsonb_build_object('queued', false, 'reason', 'not_due', 'last_tick_at', v_settings.last_tick_at);
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'ai_news_cron_secret';

  if v_token is null then
    return jsonb_build_object('queued', false, 'reason', 'secret_missing');
  end if;

  update public.pharmacy_settings set last_tick_at = now() where id = 1;

  select net.http_post(
    url := rtrim(v_settings.worker_url, '/') || '/functions/v1/pharmacy-duty-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pharmacy-token', v_token
    ),
    body := jsonb_build_object('action', 'sync', 'trigger', 'cron'),
    timeout_milliseconds := 60000
  ) into v_request;

  return jsonb_build_object('queued', true, 'request_id', v_request);
end;
$$;

revoke all on function public.pharmacy_duty_tick() from public, anon, authenticated;
grant execute on function public.pharmacy_duty_tick() to service_role;

-- Cron: her 10 dakikada bir. Yardımcı fonksiyonun kendisi "not_due" koruması
-- taşır, bu yüzden çift tetikleme güvenlidir.
select cron.unschedule('pharmacy-duty-sync')
where exists (select 1 from cron.job where jobname = 'pharmacy-duty-sync');

select cron.schedule(
  'pharmacy-duty-sync',
  '*/10 * * * *',
  $$select public.pharmacy_duty_tick();$$
);

-- ---------------------------------------------------------------------------
-- 6) Detay: fotoğraf galerisi
-- ---------------------------------------------------------------------------
create or replace function public.pharmacy_detail(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_place public.places%rowtype;
  v_profile public.pharmacy_profiles%rowtype;
  v_district text;
  v_district_slug text;
  v_state jsonb;
  v_duty jsonb;
  v_sources jsonb;
  v_breakdown jsonb;
  v_photos jsonb;
  v_photo_count integer;
  v_attribution text;
  v_license text;
begin
  select p.* into v_place
  from public.places p
  join public.pharmacy_profiles pp on pp.place_id = p.id
  join public.place_categories c on c.id = p.category_id
  where pp.slug = lower(btrim(coalesce(p_slug, '')))
    and c.slug = 'eczane'
    and p.status = 'published';

  if v_place.id is null then
    raise exception 'pharmacy_not_found' using errcode = 'P0002';
  end if;

  select * into v_profile from public.pharmacy_profiles where place_id = v_place.id;

  select d.name, d.slug into v_district, v_district_slug
  from public.districts d where d.id = v_place.district_id;

  v_state := public.pharmacy_state(v_place.id, v_now);

  -- Yalnızca yayımlanmış nöbet kayıtları; doğrulanmamış kayıt nöbet iddiası
  -- olarak sunulmaz (bkz. pharmacy_duty_trust_enforcement).
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'duty_date', s.duty_date,
    'starts_at', s.starts_at,
    'ends_at', s.ends_at,
    'status', s.status,
    'verified', s.status = 'confirmed' and s.verified_at is not null,
    'verified_at', s.verified_at,
    'fetched_at', s.fetched_at,
    'source_name', src.name,
    'source_attribution', src.attribution_text
  ) order by s.starts_at), '[]'::jsonb)
  into v_duty
  from public.pharmacy_duty_schedules s
  left join public.pharmacy_sources src on src.id = s.source_id
  where s.place_id = v_place.id
    and s.status in ('confirmed', 'conflict')
    and s.ends_at >= v_now - interval '5 days'
    and s.starts_at <= v_now + interval '14 days';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', src.id,
    'name', src.name,
    'kind', src.kind,
    'attribution_text', src.attribution_text,
    'license_note', src.license_note
  )), '[]'::jsonb)
  into v_sources
  from public.pharmacy_sources src
  where src.id in (
    select s.source_id from public.pharmacy_duty_schedules s
    where s.place_id = v_place.id and s.source_id is not null
  );

  -- Galeri: yalnızca moderasyondan geçmiş görseller.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'kind', m.kind,
    'storage_path', m.storage_path,
    'thumb_path', m.thumb_path,
    'caption', m.caption,
    'width', m.width,
    'height', m.height
  ) order by m.sort_order, m.created_at), '[]'::jsonb),
  count(*)
  into v_photos, v_photo_count
  from public.place_media m
  where m.place_id = v_place.id
    and m.status = 'approved'
    and m.kind = 'image';

  select coalesce(jsonb_object_agg(rating::text, cnt), '{}'::jsonb)
  into v_breakdown
  from (
    select rating, count(*) as cnt
    from public.place_reviews
    where place_id = v_place.id and status = 'visible'
    group by rating
  ) t;

  select r.attribution_text, r.license_note
  into v_attribution, v_license
  from public.place_external_references r
  where r.place_id = v_place.id
  order by r.fetched_at desc
  limit 1;

  return jsonb_build_object(
    'id', v_place.id,
    'slug', v_profile.slug,
    'name', v_place.name,
    'district', v_district,
    'district_slug', v_district_slug,
    'neighborhood', v_profile.neighborhood,
    'neighborhood_verified', v_profile.neighborhood_source is not null,
    'address', coalesce(v_profile.address_text, v_place.address),
    'phone', coalesce(v_profile.phone_text, v_place.phone),
    'lat', v_place.lat,
    'lng', v_place.lng,
    'working_hours', v_profile.working_hours,
    'working_hours_verified', v_profile.working_hours_source is not null,
    'data_verified', v_profile.data_verified_at is not null,
    'data_verified_at', v_profile.data_verified_at,
    'duty_verified_at', v_profile.duty_verified_at,
    'inventory_source', v_profile.inventory_source,
    'rating', v_place.rating_avg,
    'review_count', v_place.review_count,
    'rating_breakdown', v_breakdown,
    'cover_path', v_place.cover_path,
    'photos', v_photos,
    'photo_count', v_photo_count,
    'attribution_text', v_attribution,
    'license_note', v_license,
    'state', v_state,
    'duty', v_duty,
    'sources', v_sources,
    'generated_at', v_now
  );
end;
$$;

revoke all on function public.pharmacy_detail(text) from public;
grant execute on function public.pharmacy_detail(text) to anon, authenticated, service_role;
