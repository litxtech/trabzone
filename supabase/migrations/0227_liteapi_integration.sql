-- =====================================================================
-- 0227 — LiteAPI (Nuitee Connect) konaklama entegrasyonu
--
-- * Otel içeriğini sağlayıcıdan alıp Trabzon il/ilçe sınırına göre aktarır.
-- * Manuel tesisleri, PMS'i ve mevcut rezervasyon akışını korur.
-- * LiteAPI tesisleri ayrı `source = 'liteapi'` olarak işaretlenir; manuel
--   tesislerin alanlarına dokunulmaz.
-- * Harici rezervasyonlar `acc_liteapi_bookings` tablosunda tutulur, kendi
--   oda envanterine (`acc_reservations`) yazılmaz.
-- * Canlı `POST /rates/book` varsayılan olarak kapalıdır; iki katmanlı onay
--   (`acc_provider_settings.booking_enabled` + sunucu ortam bayrakları) ister.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. Tesis kaynak alanları
-- ---------------------------------------------------------------------
alter table public.acc_properties
  add column if not exists source text not null default 'manual',
  add column if not exists external_provider text,
  add column if not exists external_id text,
  add column if not exists external_payload jsonb not null default '{}'::jsonb,
  add column if not exists external_synced_at timestamptz,
  add column if not exists external_active boolean not null default true,
  add column if not exists external_stars numeric(2,1),
  add column if not exists external_rating numeric(4,2),
  add column if not exists external_review_count integer,
  add column if not exists external_address text,
  add column if not exists external_city text,
  add column if not exists external_district text,
  add column if not exists external_photos text[] not null default '{}'::text[],
  add column if not exists external_price_from_cents bigint,
  add column if not exists external_currency text not null default 'TRY',
  add column if not exists claim_status text not null default 'unclaimed',
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by uuid references public.profiles(id) on delete set null,
  add column if not exists last_sync_run_id uuid;

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'acc_properties_source_check'
      and conrelid = 'public.acc_properties'::regclass
  ) then
    alter table public.acc_properties
      add constraint acc_properties_source_check
      check (source in ('manual', 'liteapi'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'acc_properties_claim_status_check'
      and conrelid = 'public.acc_properties'::regclass
  ) then
    alter table public.acc_properties
      add constraint acc_properties_claim_status_check
      check (claim_status in ('unclaimed', 'pending', 'verified', 'rejected'));
  end if;
end
$do$;

-- API kaynaklı tesislerin sahibi, işletmeci sahiplenene kadar yoktur.
alter table public.acc_properties alter column owner_id drop not null;

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'acc_properties_source_owner_check'
      and conrelid = 'public.acc_properties'::regclass
  ) then
    alter table public.acc_properties
      add constraint acc_properties_source_owner_check
      check (source = 'liteapi' or owner_id is not null) not valid;
    alter table public.acc_properties validate constraint acc_properties_source_owner_check;
  end if;
end
$do$;

create unique index if not exists acc_properties_external_key_idx
  on public.acc_properties (external_provider, external_id)
  where external_provider is not null and external_id is not null;

create index if not exists acc_properties_source_public_idx
  on public.acc_properties (source, status, external_active);
create index if not exists acc_properties_claim_idx
  on public.acc_properties (claim_status);

-- Sahip yoksa personel kaydı oluşturulmaz (API tesisleri sahiplenilene kadar).
create or replace function public.acc_property_owner_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is null then
    return new;
  end if;
  insert into public.acc_property_staff (property_id, user_id, role, permissions, status)
  values (new.id, new.owner_id, 'owner', array['*']::text[], 'active')
  on conflict (property_id, user_id) do update
    set role = 'owner', permissions = array['*']::text[], status = 'active';
  return new;
end;
$$;

-- API tesisleri sağlayıcı tarafından yönetildiği için manuel belge/oda
-- zorunlulukları aranmaz.
create or replace function public.acc_property_missing(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.acc_properties%rowtype;
  v_missing text[] := '{}'::text[];
  v_room_types int;
  v_rooms int;
  v_plans int;
begin
  select * into p from public.acc_properties where id = p_property_id;
  if not found then
    raise exception 'property_not_found' using errcode = 'P0002';
  end if;

  if p.source = 'liteapi' then
    return '[]'::jsonb;
  end if;

  if length(btrim(coalesce(p.name, ''))) < 3 then
    v_missing := array_append(v_missing, 'Tesis adı en az 3 karakter olmalı');
  end if;
  if length(btrim(coalesce(p.description, ''))) < 40 then
    v_missing := array_append(v_missing, 'Tesis açıklaması en az 40 karakter olmalı');
  end if;
  if p.district_id is null and nullif(btrim(coalesce(p.district, '')), '') is null then
    v_missing := array_append(v_missing, 'İlçe seçilmeli');
  end if;
  if nullif(btrim(coalesce(p.address, '')), '') is null then
    v_missing := array_append(v_missing, 'Açık adres girilmeli');
  end if;
  if p.lat is null or p.lng is null then
    v_missing := array_append(v_missing, 'Harita konumu seçilmeli');
  end if;
  if nullif(btrim(coalesce(p.phone, '')), '') is null then
    v_missing := array_append(v_missing, 'Tesis telefonu girilmeli');
  end if;
  if nullif(btrim(coalesce(p.email, '')), '') is null then
    v_missing := array_append(v_missing, 'Tesis e-postası girilmeli');
  end if;
  if nullif(btrim(coalesce(p.contact_name, '')), '') is null then
    v_missing := array_append(v_missing, 'Yetkili adı girilmeli');
  end if;
  if p.tax_number is null and p.documents_required then
    v_missing := array_append(v_missing, 'Vergi numarası ve fatura bilgileri girilmeli');
  end if;
  if (p.policies ? 'cancellation') is false then
    v_missing := array_append(v_missing, 'İptal politikası tanımlanmalı');
  end if;

  select count(*) into v_room_types from public.acc_room_types
   where property_id = p_property_id and active;
  select count(*) into v_rooms from public.acc_rooms
   where property_id = p_property_id and active;
  select count(*) into v_plans from public.acc_rate_plans
   where property_id = p_property_id and active;

  if v_room_types = 0 then
    v_missing := array_append(v_missing, 'En az bir oda tipi eklenmeli');
  end if;
  if v_rooms = 0 then
    v_missing := array_append(v_missing, 'En az bir fiziksel oda eklenmeli');
  end if;
  if v_plans = 0 then
    v_missing := array_append(v_missing, 'En az bir fiyat planı eklenmeli');
  end if;
  if p.documents_required and not exists (
    select 1 from public.acc_property_documents d
    where d.property_id = p_property_id and d.status in ('pending', 'approved')
  ) then
    v_missing := array_append(v_missing, 'İşletme belgesi yüklenmeli');
  end if;
  if not exists (
    select 1 from public.acc_property_media m
    where m.property_id = p_property_id and m.kind = 'image' and m.status = 'approved'
  ) then
    v_missing := array_append(v_missing, 'En az bir tesis fotoğrafı eklenmeli');
  end if;

  return to_jsonb(v_missing);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Sağlayıcı ayarları, senkron kaydı ve hata günlüğü
-- ---------------------------------------------------------------------
create table if not exists public.acc_provider_settings (
  provider text primary key,
  active boolean not null default true,
  booking_enabled boolean not null default false,
  property_pay_enabled boolean not null default true,
  commission_rate numeric(5,2) not null default 0
    check (commission_rate >= 0 and commission_rate <= 100),
  markup_percent numeric(5,2) not null default 0
    check (markup_percent >= 0 and markup_percent <= 100),
  currency text not null default 'TRY',
  notes text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.acc_provider_settings
  (provider, active, booking_enabled, property_pay_enabled, commission_rate, currency, notes)
values
  ('liteapi', true, false, true, 0, 'TRY',
   'LiteAPI/Nuitee Connect. Canlı rezervasyon test doğrulaması ve işletme onayı olmadan kapalıdır.')
on conflict (provider) do nothing;

alter table public.acc_provider_settings enable row level security;
drop policy if exists acc_provider_settings_admin_read on public.acc_provider_settings;
create policy acc_provider_settings_admin_read on public.acc_provider_settings
  for select to authenticated using (public.is_admin());

create table if not exists public.acc_liteapi_sync_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'test' check (mode in ('test', 'full')),
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  scanned int not null default 0,
  inserted int not null default 0,
  updated int not null default 0,
  linked int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  pages int not null default 0,
  total_available int,
  details jsonb not null default '{}'::jsonb,
  error text,
  triggered_by uuid references public.profiles(id) on delete set null,
  triggered_by_label text,
  created_at timestamptz not null default now()
);

create index if not exists acc_liteapi_runs_started_idx
  on public.acc_liteapi_sync_runs (started_at desc);

alter table public.acc_liteapi_sync_runs enable row level security;
drop policy if exists acc_liteapi_runs_admin_read on public.acc_liteapi_sync_runs;
create policy acc_liteapi_runs_admin_read on public.acc_liteapi_sync_runs
  for select to authenticated using (public.is_admin());

create table if not exists public.acc_liteapi_sync_errors (
  id bigserial primary key,
  run_id uuid not null references public.acc_liteapi_sync_runs(id) on delete cascade,
  external_id text,
  hotel_name text,
  code text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists acc_liteapi_errors_run_idx
  on public.acc_liteapi_sync_errors (run_id, created_at desc);

alter table public.acc_liteapi_sync_errors enable row level security;
drop policy if exists acc_liteapi_errors_admin_read on public.acc_liteapi_sync_errors;
create policy acc_liteapi_errors_admin_read on public.acc_liteapi_sync_errors
  for select to authenticated using (public.is_admin());

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'acc_properties_last_sync_run_fk'
      and conrelid = 'public.acc_properties'::regclass
  ) then
    alter table public.acc_properties
      add constraint acc_properties_last_sync_run_fk
      foreign key (last_sync_run_id)
      references public.acc_liteapi_sync_runs(id) on delete set null;
  end if;
end
$do$;

create table if not exists public.acc_liteapi_rate_cache (
  cache_key text primary key,
  hotel_external_id text not null,
  check_in date not null,
  check_out date not null,
  adults int not null,
  children int not null default 0,
  currency text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists acc_liteapi_rate_cache_expiry_idx
  on public.acc_liteapi_rate_cache (expires_at);

alter table public.acc_liteapi_rate_cache enable row level security;

-- ---------------------------------------------------------------------
-- 3. İşletmeci sahiplenme talepleri
-- ---------------------------------------------------------------------
create table if not exists public.acc_property_claims (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text,
  evidence jsonb not null default '{}'::jsonb,
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists acc_property_claims_pending_idx
  on public.acc_property_claims (property_id, user_id)
  where status = 'pending';
create index if not exists acc_property_claims_status_idx
  on public.acc_property_claims (status, created_at desc);

alter table public.acc_property_claims enable row level security;
drop policy if exists acc_property_claims_read on public.acc_property_claims;
create policy acc_property_claims_read on public.acc_property_claims
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- 4. Harici rezervasyonlar (kendi envanterinden ayrı)
-- ---------------------------------------------------------------------
create table if not exists public.acc_liteapi_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  property_id uuid not null references public.acc_properties(id) on delete restrict,
  external_hotel_id text not null,
  offer_id text,
  status text not null default 'intent'
    check (status in ('intent', 'pending_provider', 'confirmed', 'failed', 'cancelled')),
  check_in date not null,
  check_out date not null,
  adults int not null default 2,
  children int not null default 0,
  guest jsonb not null default '{}'::jsonb,
  price_cents bigint,
  currency text not null default 'TRY',
  payment_type text,
  payment_at_property boolean not null default false,
  commission_rate numeric(5,2) not null default 0,
  commission_cents bigint not null default 0,
  provider_booking_id text,
  offer_snapshot jsonb not null default '{}'::jsonb,
  provider_payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acc_liteapi_bookings_user_idx
  on public.acc_liteapi_bookings (user_id, created_at desc);
create index if not exists acc_liteapi_bookings_property_idx
  on public.acc_liteapi_bookings (property_id, created_at desc);

drop trigger if exists acc_liteapi_bookings_updated_at on public.acc_liteapi_bookings;
create trigger acc_liteapi_bookings_updated_at
  before update on public.acc_liteapi_bookings
  for each row execute function public.set_updated_at();

alter table public.acc_liteapi_bookings enable row level security;
drop policy if exists acc_liteapi_bookings_read on public.acc_liteapi_bookings;
create policy acc_liteapi_bookings_read on public.acc_liteapi_bookings
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Harici tesisler kendi rezervasyon tablosuna yazılmaz.
create or replace function public.acc_guard_external_property_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.acc_properties
    where id = new.property_id and source = 'liteapi'
  ) then
    raise exception 'provider_booking_required' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists acc_reservations_provider_guard on public.acc_reservations;
create trigger acc_reservations_provider_guard
  before insert on public.acc_reservations
  for each row execute function public.acc_guard_external_property_booking();

-- ---------------------------------------------------------------------
-- 5. Yardımcı fonksiyonlar
-- ---------------------------------------------------------------------
create or replace function public.acc_normalize_text(p_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    regexp_replace(
      translate(lower(coalesce(p_text, '')), 'çğıöşüâîû', 'cgiosuaiu'),
      '[^a-z0-9]+', ' ', 'g'
    ),
    '\mhotel\M', 'otel', 'g'
  ));
$$;

create or replace function public.acc_distance_m(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
      cos(radians(p_lat1)) * cos(radians(p_lat2)) *
      power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    ))
  end;
$$;

create or replace function public.acc_unique_slug(p_base text)
returns text
language plpgsql
volatile
as $$
declare
  v_base text := left(coalesce(nullif(trim(p_base), ''), 'tesis'), 80);
  v_candidate text := v_base;
  v_index int := 1;
begin
  while exists (select 1 from public.acc_properties where slug = v_candidate) loop
    v_index := v_index + 1;
    v_candidate := v_base || '-' || v_index;
  end loop;
  return v_candidate;
end;
$$;

create or replace function public.acc_liteapi_start_run(
  p_mode text default 'test',
  p_triggered_by uuid default null,
  p_triggered_by_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := case when p_mode = 'full' then 'full' else 'test' end;
  v_existing uuid;
  v_id uuid;
begin
  select id into v_existing
  from public.acc_liteapi_sync_runs
  where status = 'running'
    and started_at > now() - interval '30 minutes'
  order by started_at desc
  limit 1;

  if v_existing is not null then
    return jsonb_build_object('run_id', v_existing, 'resumed', true);
  end if;

  insert into public.acc_liteapi_sync_runs (mode, status, triggered_by, triggered_by_label)
  values (v_mode, 'running', p_triggered_by, p_triggered_by_label)
  returning id into v_id;

  return jsonb_build_object('run_id', v_id, 'resumed', false);
end;
$$;

create or replace function public.acc_liteapi_run_progress(
  p_run_id uuid,
  p_counts jsonb default '{}'::jsonb,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.acc_liteapi_sync_runs
  set
    scanned = scanned + coalesce((p_counts->>'scanned')::int, 0),
    inserted = inserted + coalesce((p_counts->>'inserted')::int, 0),
    updated = updated + coalesce((p_counts->>'updated')::int, 0),
    linked = linked + coalesce((p_counts->>'linked')::int, 0),
    skipped = skipped + coalesce((p_counts->>'skipped')::int, 0),
    failed = failed + coalesce((p_counts->>'failed')::int, 0),
    pages = pages + coalesce((p_counts->>'pages')::int, 0),
    total_available = coalesce((p_details->>'total_available')::int, total_available),
    details = details || coalesce(p_details, '{}'::jsonb)
  where id = p_run_id;
end;
$$;

create or replace function public.acc_liteapi_record_error(
  p_run_id uuid,
  p_external_id text,
  p_hotel_name text,
  p_code text,
  p_message text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.acc_liteapi_sync_errors
    (run_id, external_id, hotel_name, code, message, payload)
  values
    (p_run_id, p_external_id, p_hotel_name, coalesce(p_code, 'sync_error'), p_message,
     coalesce(p_payload, '{}'::jsonb));

  -- Aynı hatanın sonsuz birikmesini engelle: run başına 500 kayıt yeterli.
  delete from public.acc_liteapi_sync_errors
  where id in (
    select id from public.acc_liteapi_sync_errors
    where run_id = p_run_id
    order by created_at desc
    offset 500
  );
end;
$$;

create or replace function public.acc_liteapi_finish_run(
  p_run_id uuid,
  p_status text,
  p_error text default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := case
    when p_status in ('success', 'partial', 'failed') then p_status
    else 'failed'
  end;
begin
  update public.acc_liteapi_sync_runs
  set
    status = v_status,
    finished_at = now(),
    error = p_error,
    details = details || coalesce(p_details, '{}'::jsonb)
  where id = p_run_id and status = 'running';
end;
$$;

create or replace function public.acc_liteapi_deactivate_unseen(p_run_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.acc_properties
  set external_active = false
  where source = 'liteapi'
    and external_active
    and (last_sync_run_id is null or last_sync_run_id <> p_run_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Tesis upsert (mükerrer engelleme)
-- ---------------------------------------------------------------------
create or replace function public.acc_liteapi_upsert_property(
  p_external_id text,
  p_payload jsonb,
  p_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_payload->>'name', '')), '');
  v_description text := nullif(btrim(coalesce(p_payload->>'description', '')), '');
  v_address text := nullif(btrim(coalesce(p_payload->>'address', '')), '');
  v_district text := nullif(btrim(coalesce(p_payload->>'district', '')), '');
  v_lat double precision := nullif(p_payload->>'latitude', '')::double precision;
  v_lng double precision := nullif(p_payload->>'longitude', '')::double precision;
  v_stars numeric(2,1) := nullif(p_payload->>'stars', '')::numeric(2,1);
  v_rating numeric(4,2) := nullif(p_payload->>'rating', '')::numeric(4,2);
  v_review_count int := nullif(p_payload->>'reviewCount', '')::int;
  v_capacity int := nullif(p_payload->>'roomCapacity', '')::int;
  v_currency text := upper(left(coalesce(nullif(p_payload->>'currency', ''), 'TRY'), 3));
  v_price bigint := nullif(p_payload->>'priceFromCents', '')::bigint;
  v_photos text[] := '{}'::text[];
  v_amenities text[] := '{}'::text[];
  v_district_id bigint;
  v_property_id uuid;
  v_manual_id uuid;
  v_slug text;
  v_rating_avg numeric(3,2) := 0;
begin
  if p_external_id is null or btrim(p_external_id) = '' then
    raise exception 'external_id_required' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) < 2 then
    raise exception 'name_required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload->'photos') = 'array' then
    select coalesce(array_agg(value), '{}'::text[]) into v_photos
    from (
      select value
      from jsonb_array_elements_text(p_payload->'photos')
      where value ~ '^https?://'
      limit 20
    ) x;
  end if;

  if jsonb_typeof(p_payload->'amenities') = 'array' then
    select coalesce(array_agg(value), '{}'::text[]) into v_amenities
    from (
      select value
      from jsonb_array_elements_text(p_payload->'amenities')
      where length(btrim(value)) between 1 and 80
      limit 60
    ) x;
  end if;

  if v_district is not null then
    select d.id into v_district_id
    from public.districts d
    join public.cities c on c.id = d.city_id
    where lower(d.name) = lower(v_district)
      and lower(c.name) = 'trabzon'
    limit 1;
  end if;

  if v_rating is not null then
    -- Sağlayıcı 0-10 ölçeği; Trabzone 5 üzerinden gösterir.
    v_rating_avg := round(least(5, greatest(0, v_rating / 2.0))::numeric, 2);
  end if;

  -- 1) Aynı sağlayıcı kimliği
  select id into v_property_id
  from public.acc_properties
  where external_provider = 'liteapi' and external_id = p_external_id
  limit 1;

  -- 2) Manuel kayıtta aynı isim + 400 m yakınlık
  if v_property_id is null and v_lat is not null and v_lng is not null then
    select p.id into v_manual_id
    from public.acc_properties p
    where p.source = 'manual'
      and p.lat is not null
      and p.lng is not null
      and public.acc_normalize_text(p.name) = public.acc_normalize_text(v_name)
      and public.acc_distance_m(p.lat, p.lng, v_lat, v_lng) <= 400
    order by public.acc_distance_m(p.lat, p.lng, v_lat, v_lng)
    limit 1;
  end if;

  if v_manual_id is not null then
    update public.acc_properties
    set
      external_provider = 'liteapi',
      external_id = p_external_id,
      external_payload = coalesce(p_payload, '{}'::jsonb),
      external_synced_at = now(),
      external_active = true,
      external_stars = v_stars,
      external_rating = v_rating,
      external_review_count = v_review_count,
      external_address = v_address,
      external_city = 'Trabzon',
      external_district = v_district,
      external_photos = v_photos,
      external_currency = v_currency,
      external_price_from_cents = v_price,
      last_sync_run_id = p_run_id
    where id = v_manual_id;

    return jsonb_build_object('action', 'linked', 'property_id', v_manual_id);
  end if;

  if v_property_id is not null then
    update public.acc_properties
    set
      name = v_name,
      description = coalesce(v_description, description),
      address = coalesce(v_address, address),
      city = 'Trabzon',
      district = coalesce(v_district, district),
      district_id = coalesce(v_district_id, district_id),
      lat = coalesce(v_lat, lat),
      lng = coalesce(v_lng, lng),
      amenities = case when cardinality(v_amenities) > 0 then v_amenities else amenities end,
      cover_path = coalesce(v_photos[1], cover_path),
      room_capacity = coalesce(v_capacity, room_capacity),
      rating_avg = greatest(rating_avg, v_rating_avg),
      rating_count = greatest(rating_count, coalesce(v_review_count, 0)),
      external_payload = coalesce(p_payload, '{}'::jsonb),
      external_synced_at = now(),
      external_active = true,
      external_stars = v_stars,
      external_rating = v_rating,
      external_review_count = v_review_count,
      external_address = v_address,
      external_city = 'Trabzon',
      external_district = v_district,
      external_photos = v_photos,
      external_currency = v_currency,
      external_price_from_cents = v_price,
      last_sync_run_id = p_run_id,
      status = case when status in ('draft', 'pending_verification') then 'published' else status end,
      verification_status = case when verification_status <> 'verified' then 'verified' else verification_status end,
      verification_note = coalesce(verification_note, 'LiteAPI sağlayıcı verisi'),
      published_at = coalesce(published_at, now())
    where id = v_property_id;

    return jsonb_build_object('action', 'updated', 'property_id', v_property_id);
  end if;

  v_slug := public.acc_unique_slug(
    public.acc_slugify(v_name) || '-' || left(regexp_replace(p_external_id, '[^a-zA-Z0-9]', '', 'g'), 6)
  );

  insert into public.acc_properties (
    owner_id, name, slug, property_type, description, status, verification_status,
    verification_note, published_at, city, district_id, district, address, lat, lng,
    documents_required, room_capacity, checkin_time, checkout_time, languages,
    policies, amenities, cover_path, rating_avg, rating_count, commission_rate,
    settings, source, external_provider, external_id, external_payload,
    external_synced_at, external_active, external_stars, external_rating,
    external_review_count, external_address, external_city, external_district,
    external_photos, external_price_from_cents, external_currency,
    claim_status, last_sync_run_id
  )
  values (
    null, v_name, v_slug, 'hotel', v_description, 'published', 'verified',
    'LiteAPI sağlayıcı verisi', now(), 'Trabzon', v_district_id, v_district,
    v_address, v_lat, v_lng, false, v_capacity, '14:00', '12:00',
    array['tr', 'en'],
    jsonb_build_object(
      'cancellation', 'İptal koşulları rezervasyon sırasında sağlayıcıdan gelen güncel teklifle gösterilir.',
      'payment', 'Tesiste ödeme yalnızca sağlayıcı teklifinde PROPERTY_PAY varsa sunulur.'
    ),
    v_amenities, v_photos[1], v_rating_avg, coalesce(v_review_count, 0), 0,
    jsonb_build_object('liteapi', jsonb_build_object('external_id', p_external_id, 'synced_at', now())),
    'liteapi', 'liteapi', p_external_id, coalesce(p_payload, '{}'::jsonb),
    now(), true, v_stars, v_rating, v_review_count, v_address, 'Trabzon',
    v_district, v_photos, v_price, v_currency, 'unclaimed', p_run_id
  )
  returning id into v_property_id;

  return jsonb_build_object('action', 'inserted', 'property_id', v_property_id);
end;
$$;

revoke all on function public.acc_liteapi_upsert_property(text, jsonb, uuid) from public;
revoke all on function public.acc_liteapi_start_run(text, uuid, text) from public;
revoke all on function public.acc_liteapi_run_progress(uuid, jsonb, jsonb) from public;
revoke all on function public.acc_liteapi_record_error(uuid, text, text, text, text, jsonb) from public;
revoke all on function public.acc_liteapi_finish_run(uuid, text, text, jsonb) from public;
revoke all on function public.acc_liteapi_deactivate_unseen(uuid) from public;
grant execute on function public.acc_liteapi_upsert_property(text, jsonb, uuid) to service_role;
grant execute on function public.acc_liteapi_start_run(text, uuid, text) to service_role;
grant execute on function public.acc_liteapi_run_progress(uuid, jsonb, jsonb) to service_role;
grant execute on function public.acc_liteapi_record_error(uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.acc_liteapi_finish_run(uuid, text, text, jsonb) to service_role;
grant execute on function public.acc_liteapi_deactivate_unseen(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 7. Arama / detay / harita görünümleri
-- ---------------------------------------------------------------------
create or replace function public.acc_search_v2(
  p_property_type text default null,
  p_district_id bigint default null,
  p_guests int default null,
  p_check_in date default null,
  p_check_out date default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_query text default null,
  p_sort text default 'recommended',
  p_deals boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'recommended'));
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_items jsonb;
  v_total int;
  v_has_dates boolean := p_check_in is not null and p_check_out is not null
    and p_check_out > p_check_in;
begin
  perform public.acc_expire_holds();

  with candidates as (
    -- Manuel / PMS tesisleri: mevcut davranış korunur.
    select p.*,
      (
        select min(coalesce(rc.base_price_cents, rt.base_price_cents))
        from public.acc_room_types rt
        left join public.acc_rate_calendar rc
          on rc.room_type_id = rt.id
         and (v_has_dates is false or (rc.stay_date >= p_check_in and rc.stay_date < p_check_out))
        where rt.property_id = p.id and rt.active
      ) as price_from_cents,
      (
        select min(rt.capacity_adults + rt.capacity_children)
        from public.acc_room_types rt
        where rt.property_id = p.id and rt.active
      ) as max_guests,
      (
        select count(*)
        from public.acc_room_types rt
        where rt.property_id = p.id
          and rt.active
          and (not v_has_dates or public.acc_room_type_available(p.id, rt.id, p_check_in, p_check_out) > 0)
          and (p_guests is null or (rt.capacity_adults + rt.capacity_children) >= p_guests)
      ) as open_room_types,
      exists (
        select 1 from public.acc_campaigns c
        where c.property_id = p.id
          and c.status = 'active'
          and current_date between c.start_date and c.end_date
      ) as has_deal,
      (
        select array_agg(distinct rp.booking_mode)
        from public.acc_rate_plans rp
        where rp.property_id = p.id and rp.active
      ) as booking_modes,
      true as provider_visible
    from public.acc_properties p
    where p.status = 'published'
      and p.verification_status = 'verified'
      and coalesce(p.source, 'manual') = 'manual'
      and (p_property_type is null or p_property_type = 'all' or p.property_type = p_property_type)
      and (p_district_id is null or p.district_id = p_district_id)
      and (v_query is null
           or p.name ilike '%' || v_query || '%'
           or coalesce(p.district, '') ilike '%' || v_query || '%'
           or coalesce(p.neighborhood, '') ilike '%' || v_query || '%'
           or coalesce(p.description, '') ilike '%' || v_query || '%')
      and (not p_deals or exists (
        select 1 from public.acc_campaigns c
        where c.property_id = p.id
          and c.status = 'active'
          and current_date between c.start_date and c.end_date
      ))

    union all

    -- LiteAPI tesisleri: canlı fiyat/müsaitlik detay ekranında sorgulanır.
    -- Arama kartında sağlayıcıdan gelen son önbellek fiyatı gösterilir.
    select p.*,
      p.external_price_from_cents as price_from_cents,
      p.room_capacity as max_guests,
      case when p.external_active and coalesce(ps.active, true) then 1::bigint else 0::bigint end
        as open_room_types,
      false as has_deal,
      case
        when coalesce(ps.active, false) and coalesce(ps.booking_enabled, false)
          then array['instant']::text[]
        else '{}'::text[]
      end as booking_modes,
      coalesce(ps.active, true) as provider_visible
    from public.acc_properties p
    left join public.acc_provider_settings ps on ps.provider = p.external_provider
    where p.status = 'published'
      and p.source = 'liteapi'
      and p.external_active
      and coalesce(ps.active, true)
      and (p_property_type is null or p_property_type = 'all' or p.property_type = p_property_type)
      and (p_district_id is null or p.district_id = p_district_id)
      and (v_query is null
           or p.name ilike '%' || v_query || '%'
           or coalesce(p.district, p.external_district, '') ilike '%' || v_query || '%'
           or coalesce(p.neighborhood, '') ilike '%' || v_query || '%'
           or coalesce(p.description, '') ilike '%' || v_query || '%')
      and not p_deals
  ), filtered as (
    select c.*
    from candidates c
    where coalesce(c.open_room_types, 0) > 0
      and (p_min_price is null or coalesce(c.price_from_cents, 0) >= (p_min_price * 100)::bigint)
      and (p_max_price is null or coalesce(c.price_from_cents, 0) <= (p_max_price * 100)::bigint)
  ), enriched as (
    select f.*,
      case
        when f.source = 'liteapi' then
          coalesce(to_jsonb(f.external_photos[1:5]), '[]'::jsonb)
        else (
          select coalesce(jsonb_agg(x.storage_path order by x.cover desc, x.sort_order, x.created_at), '[]'::jsonb)
          from (
            select m.storage_path, m.cover, m.sort_order, m.created_at
            from public.acc_property_media m
            where m.property_id = f.id and m.kind = 'image' and m.status = 'approved'
            order by m.cover desc, m.sort_order, m.created_at
            limit 5
          ) x
        )
      end as photos,
      case
        when f.source = 'liteapi' then coalesce(array_length(f.external_photos, 1), 0)
        else (
          select count(*)
          from public.acc_property_media m
          where m.property_id = f.id and m.kind = 'image' and m.status = 'approved'
        )
      end as photo_count,
      (
        select count(*)
        from public.acc_reservations r
        where r.property_id = f.id and r.guest_user_id = auth.uid()
      ) as my_reservation_count
    from filtered f
  )
  select coalesce(jsonb_agg(item order by
      case when v_sort = 'price_asc' then price_sort end asc nulls last,
      case when v_sort = 'price_desc' then price_sort end desc nulls last,
      case when v_sort = 'rating' then rating_sort end desc nulls last,
      case when v_sort = 'new' then new_sort end desc nulls last,
      case when v_sort = 'recommended' then (rating_sort * 20 + coalesce(review_sort, 0)) end desc nulls last
    ), '[]'::jsonb), coalesce(max(total_count), 0)
    into v_items, v_total
  from (
    select jsonb_build_object(
      'id', e.id,
      'name', e.name,
      'slug', e.slug,
      'property_type', e.property_type,
      'description', e.description,
      'district', coalesce(e.district, e.external_district),
      'neighborhood', e.neighborhood,
      'district_id', e.district_id,
      'neighborhood_id', e.neighborhood_id,
      'lat', e.lat,
      'lng', e.lng,
      'cover_path', case
        when e.source = 'liteapi' then coalesce(e.external_photos[1], e.cover_path)
        else coalesce(
          e.cover_path,
          (select m.storage_path from public.acc_property_media m
            where m.property_id = e.id and m.kind = 'image' and m.status = 'approved'
            order by m.cover desc, m.sort_order limit 1)
        )
      end,
      'photos', e.photos,
      'photo_count', e.photo_count,
      'rating_avg', e.rating_avg,
      'rating_count', e.rating_count,
      'amenities', e.amenities,
      'price_from_cents', e.price_from_cents,
      'currency', coalesce(e.external_currency, 'TRY'),
      'max_guests', e.max_guests,
      'booking_modes', coalesce(to_jsonb(e.booking_modes), '[]'::jsonb),
      'has_deal', e.has_deal,
      'my_reservation_count', e.my_reservation_count,
      'is_published', e.status = 'published',
      'source', coalesce(e.source, 'manual'),
      'claim_status', e.claim_status,
      'external_provider', e.external_provider,
      'external_id', e.external_id,
      'stars', e.external_stars,
      'provider_rating', e.external_rating,
      'provider_review_count', e.external_review_count,
      'payment_at_property', coalesce(ps.property_pay_enabled, false),
      'booking_enabled', coalesce(ps.active, false) and coalesce(ps.booking_enabled, false)
    ) as item,
    e.price_from_cents as price_sort,
    e.rating_avg as rating_sort,
    e.rating_count as review_sort,
    extract(epoch from coalesce(e.published_at, e.created_at)) as new_sort,
    (select count(*) from filtered) as total_count
    from enriched e
    left join public.acc_provider_settings ps on ps.provider = e.external_provider
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_dates', v_has_dates
  );
end;
$$;

grant execute on function public.acc_search_v2(text, bigint, int, date, date, numeric, numeric, text, text, boolean, int, int)
  to anon, authenticated, service_role;

create or replace function public.acc_property_public_v2(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  p public.acc_properties%rowtype;
  ps public.acc_provider_settings%rowtype;
  v_external_media jsonb;
begin
  v := public.acc_property_public(p_property_id);
  select * into p from public.acc_properties where id = p_property_id;
  select * into ps from public.acc_provider_settings where provider = 'liteapi';

  if p.source = 'liteapi' and coalesce(array_length(p.external_photos, 1), 0) > 0 then
    select jsonb_agg(
      jsonb_build_object(
        'id', 'ext-' || ord,
        'kind', 'image',
        'category', 'general',
        'storage_path', url,
        'thumbnail_path', null,
        'caption', null,
        'cover', ord = 1,
        'sort_order', ord - 1,
        'room_type_id', null
      ) order by ord
    )
    into v_external_media
    from unnest(p.external_photos) with ordinality as t(url, ord);

    v := jsonb_set(
      v,
      '{media}',
      coalesce(v_external_media, '[]'::jsonb) || coalesce(v->'media', '[]'::jsonb),
      true
    );
  end if;

  return v || jsonb_build_object(
    'source', p.source,
    'claim_status', p.claim_status,
    'external_provider', p.external_provider,
    'external_id', p.external_id,
    'stars', p.external_stars,
    'provider_rating', p.external_rating,
    'provider_review_count', p.external_review_count,
    'external_address', p.external_address,
    'external_district', p.external_district,
    'external_photos', p.external_photos,
    'payment_at_property', coalesce(ps.property_pay_enabled, false),
    'booking_enabled', coalesce(ps.active, false) and coalesce(ps.booking_enabled, false),
    'commission_rate', p.commission_rate
  );
end;
$$;

grant execute on function public.acc_property_public_v2(uuid)
  to anon, authenticated, service_role;

create or replace function public.acc_map_points(p_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_items jsonb;
begin
  with visible as (
    select
      p.id,
      p.name,
      p.slug,
      p.property_type,
      coalesce(p.district, p.external_district) as district,
      p.neighborhood,
      p.lat,
      p.lng,
      p.rating_avg,
      p.rating_count,
      p.cover_path,
      p.verification_status,
      p.source,
      p.external_photos,
      p.external_currency,
      case
        when p.source = 'liteapi' then p.external_price_from_cents
        else (
          select min(rt.base_price_cents)
          from public.acc_room_types rt
          where rt.property_id = p.id and rt.active
        )
      end as price_from_cents,
      case
        when p.source = 'liteapi' then
          case
            when coalesce(ps.active, false) and coalesce(ps.booking_enabled, false)
              then array['instant']::text[]
            else '{}'::text[]
          end
        else (
          select array_agg(distinct rp.booking_mode)
          from public.acc_rate_plans rp
          where rp.property_id = p.id and rp.active
        )
      end as booking_modes,
      exists (
        select 1 from public.acc_campaigns c
        where c.property_id = p.id
          and c.status = 'active'
          and current_date between c.start_date and c.end_date
      ) as has_deal
    from public.acc_properties p
    left join public.acc_provider_settings ps on ps.provider = p.external_provider
    where p.status = 'published'
      and p.verification_status = 'verified'
      and p.lat is not null
      and p.lng is not null
      and p.lat between -90 and 90
      and p.lng between -180 and 180
      and (
        p.source <> 'liteapi'
        or (p.external_active and coalesce(ps.active, true))
      )
  )
  select coalesce(jsonb_agg(item order by rating_sort desc nulls last, name), '[]'::jsonb)
  into v_items
  from (
    select
      jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'slug', v.slug,
        'property_type', v.property_type,
        'district', v.district,
        'neighborhood', v.neighborhood,
        'lat', v.lat,
        'lng', v.lng,
        'rating_avg', v.rating_avg,
        'rating_count', v.rating_count,
        'price_from_cents', v.price_from_cents,
        'currency', coalesce(v.external_currency, 'TRY'),
        'cover_path', case
          when v.source = 'liteapi' then coalesce(v.external_photos[1], v.cover_path)
          else coalesce(
            v.cover_path,
            (select m.storage_path from public.acc_property_media m
              where m.property_id = v.id and m.kind = 'image' and m.status = 'approved'
              order by m.cover desc, m.sort_order limit 1)
          )
        end,
        'booking_modes', coalesce(to_jsonb(v.booking_modes), '[]'::jsonb),
        'has_deal', v.has_deal,
        'verified', v.verification_status = 'verified',
        'source', coalesce(v.source, 'manual')
      ) as item,
      v.rating_avg as rating_sort,
      v.name
    from visible v
    order by v.rating_avg desc nulls last, v.name
    limit v_limit
  ) t;

  return v_items;
end;
$$;

grant execute on function public.acc_map_points(int) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Fiyat önbelleği, rezervasyon bağlamı ve sahiplenme RPC'leri
-- ---------------------------------------------------------------------
create or replace function public.acc_liteapi_property_context(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'property_id', p.id,
    'name', p.name,
    'slug', p.slug,
    'source', p.source,
    'external_provider', p.external_provider,
    'external_id', p.external_id,
    'claim_status', p.claim_status,
    'commission_rate', p.commission_rate,
    'property_pay_enabled', coalesce(ps.property_pay_enabled, false),
    'booking_enabled', coalesce(ps.active, false) and coalesce(ps.booking_enabled, false),
    'provider_active', coalesce(ps.active, false)
  )
  into v
  from public.acc_properties p
  left join public.acc_provider_settings ps on ps.provider = p.external_provider
  where p.id = p_property_id
    and p.source = 'liteapi'
    and p.status = 'published'
    and p.external_active;
  return v;
end;
$$;

revoke all on function public.acc_liteapi_property_context(uuid) from public;
grant execute on function public.acc_liteapi_property_context(uuid) to service_role;

create or replace function public.acc_liteapi_booking_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'provider_active', ps.active,
    'booking_enabled', ps.booking_enabled,
    'property_pay_enabled', ps.property_pay_enabled,
    'commission_rate', ps.commission_rate,
    'currency', ps.currency
  ) into v
  from public.acc_provider_settings ps
  where ps.provider = 'liteapi';
  return coalesce(v, '{}'::jsonb);
end;
$$;

revoke all on function public.acc_liteapi_booking_settings() from public;
grant execute on function public.acc_liteapi_booking_settings() to service_role;

create or replace function public.acc_liteapi_rate_cache_get(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select jsonb_build_object('payload', c.payload, 'fetched_at', c.fetched_at)
  into v
  from public.acc_liteapi_rate_cache c
  where c.cache_key = p_key
    and c.expires_at > now();
  return v;
end;
$$;

create or replace function public.acc_liteapi_rate_cache_put(
  p_key text,
  p_hotel_external_id text,
  p_check_in date,
  p_check_out date,
  p_adults int,
  p_children int,
  p_currency text,
  p_payload jsonb,
  p_ttl_seconds int default 300
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.acc_liteapi_rate_cache (
    cache_key, hotel_external_id, check_in, check_out, adults, children,
    currency, payload, fetched_at, expires_at
  )
  values (
    p_key, p_hotel_external_id, p_check_in, p_check_out, p_adults, p_children,
    p_currency, coalesce(p_payload, '{}'::jsonb), now(),
    now() + make_interval(secs => greatest(30, least(coalesce(p_ttl_seconds, 300), 3600)))
  )
  on conflict (cache_key) do update
    set payload = excluded.payload,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at;

  delete from public.acc_liteapi_rate_cache
  where expires_at < now() - interval '1 day';
end;
$$;

revoke all on function public.acc_liteapi_rate_cache_get(text) from public;
revoke all on function public.acc_liteapi_rate_cache_put(text, text, date, date, int, int, text, jsonb, int) from public;
grant execute on function public.acc_liteapi_rate_cache_get(text) to service_role;
grant execute on function public.acc_liteapi_rate_cache_put(text, text, date, date, int, int, text, jsonb, int) to service_role;

create or replace function public.acc_claim_external_property(
  p_property_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_prop public.acc_properties%rowtype;
  v_claim_id uuid;
begin
  select * into v_prop from public.acc_properties where id = p_property_id;
  if not found then
    raise exception 'property_not_found' using errcode = 'P0002';
  end if;
  if v_prop.source <> 'liteapi' then
    raise exception 'not_external_property' using errcode = '22023';
  end if;
  if v_prop.owner_id is not null or v_prop.claim_status = 'verified' then
    raise exception 'already_claimed' using errcode = '42501';
  end if;

  select id into v_claim_id
  from public.acc_property_claims
  where property_id = p_property_id and user_id = v_uid and status = 'pending'
  limit 1;

  if v_claim_id is null then
    insert into public.acc_property_claims (property_id, user_id, status, note)
    values (p_property_id, v_uid, 'pending', nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_claim_id;

    update public.acc_properties
    set claim_status = 'pending'
    where id = p_property_id;
  end if;

  return jsonb_build_object('claim_id', v_claim_id, 'status', 'pending');
end;
$$;

grant execute on function public.acc_claim_external_property(uuid, text) to authenticated;

create or replace function public.acc_admin_property_claims(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'note', c.note,
    'created_at', c.created_at,
    'reviewed_at', c.reviewed_at,
    'review_note', c.review_note,
    'property', jsonb_build_object(
      'id', p.id, 'name', p.name, 'slug', p.slug,
      'district', coalesce(p.district, p.external_district),
      'source', p.source,
      'claim_status', p.claim_status,
      'address', p.address,
      'external_id', p.external_id
    ),
    'user', jsonb_build_object(
      'id', pr.id,
      'username', pr.username,
      'display_name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username),
      'avatar_path', pr.avatar_path
    )
  ) order by c.created_at desc), '[]'::jsonb)
  into v_items
  from public.acc_property_claims c
  join public.acc_properties p on p.id = c.property_id
  join public.profiles pr on pr.id = c.user_id
  where p_status is null or p_status = 'all' or c.status = p_status;

  return jsonb_build_object('items', v_items);
end;
$$;

grant execute on function public.acc_admin_property_claims(text) to authenticated, service_role;

create or replace function public.acc_admin_review_property_claim(
  p_claim_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_require_uid();
  v_claim public.acc_property_claims%rowtype;
  v_prop public.acc_properties%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_claim from public.acc_property_claims where id = p_claim_id;
  if not found then
    raise exception 'claim_not_found' using errcode = 'P0002';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'claim_already_reviewed' using errcode = '22023';
  end if;

  select * into v_prop from public.acc_properties where id = v_claim.property_id;
  if not found then
    raise exception 'property_not_found' using errcode = 'P0002';
  end if;

  if p_approve then
    if v_prop.owner_id is not null then
      raise exception 'already_claimed' using errcode = '42501';
    end if;

    update public.acc_property_claims
    set status = 'approved', review_note = nullif(btrim(coalesce(p_note, '')), ''),
        reviewed_by = v_admin, reviewed_at = now()
    where id = p_claim_id;

    update public.acc_properties
    set owner_id = v_claim.user_id,
        claim_status = 'verified',
        claimed_at = now(),
        claimed_by = v_claim.user_id,
        verification_status = 'verified',
        status = 'published'
    where id = v_claim.property_id;

    insert into public.acc_property_staff (property_id, user_id, role, permissions, status)
    values (v_claim.property_id, v_claim.user_id, 'owner', array['*']::text[], 'active')
    on conflict (property_id, user_id) do update
      set role = 'owner', permissions = array['*']::text[], status = 'active';

    return jsonb_build_object('ok', true, 'status', 'approved', 'property_id', v_claim.property_id);
  end if;

  update public.acc_property_claims
  set status = 'rejected', review_note = nullif(btrim(coalesce(p_note, '')), ''),
      reviewed_by = v_admin, reviewed_at = now()
  where id = p_claim_id;

  update public.acc_properties
  set claim_status = 'rejected'
  where id = v_claim.property_id and owner_id is null;

  return jsonb_build_object('ok', true, 'status', 'rejected', 'property_id', v_claim.property_id);
end;
$$;

grant execute on function public.acc_admin_review_property_claim(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. Yönetici durum/rapor RPC'leri
-- ---------------------------------------------------------------------
create or replace function public.acc_admin_liteapi_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_last_run jsonb;
  v_recent_runs jsonb;
  v_recent_errors jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select to_jsonb(r) into v_last_run
  from (
    select * from public.acc_liteapi_sync_runs
    order by started_at desc limit 1
  ) r;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc), '[]'::jsonb)
  into v_recent_runs
  from (
    select * from public.acc_liteapi_sync_runs
    order by started_at desc limit 8
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'external_id', e.external_id,
    'hotel_name', e.hotel_name,
    'code', e.code,
    'message', e.message,
    'created_at', e.created_at
  ) order by e.created_at desc), '[]'::jsonb)
  into v_recent_errors
  from (
    select * from public.acc_liteapi_sync_errors
    order by created_at desc limit 25
  ) e;

  return jsonb_build_object(
    'provider', coalesce((
      select to_jsonb(ps) from public.acc_provider_settings ps where ps.provider = 'liteapi'
    ), '{}'::jsonb),
    'stats', jsonb_build_object(
      'external_total', (select count(*) from public.acc_properties where source = 'liteapi'),
      'external_published', (
        select count(*) from public.acc_properties
        where source = 'liteapi' and status = 'published' and external_active
      ),
      'claimed', (select count(*) from public.acc_properties where source = 'liteapi' and claim_status = 'verified'),
      'unclaimed', (select count(*) from public.acc_properties where source = 'liteapi' and claim_status = 'unclaimed'),
      'pending_claims', (select count(*) from public.acc_property_claims where status = 'pending'),
      'manual_total', (select count(*) from public.acc_properties where coalesce(source, 'manual') = 'manual'),
      'bookings_pending', (select count(*) from public.acc_liteapi_bookings where status in ('intent', 'pending_provider')),
      'bookings_confirmed', (select count(*) from public.acc_liteapi_bookings where status = 'confirmed')
    ),
    'last_run', coalesce(v_last_run, '{}'::jsonb),
    'recent_runs', v_recent_runs,
    'recent_errors', v_recent_errors,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.acc_admin_liteapi_status() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. Harici rezervasyon RPC'leri (canlı booking kapalıyken de hazır)
-- ---------------------------------------------------------------------
create or replace function public.acc_liteapi_create_booking_intent(
  p_property_id uuid,
  p_external_hotel_id text,
  p_offer_id text,
  p_check_in date,
  p_check_out date,
  p_adults int,
  p_children int,
  p_guest jsonb,
  p_price_cents bigint,
  p_currency text,
  p_payment_type text,
  p_payment_at_property boolean,
  p_offer_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_prop public.acc_properties%rowtype;
  v_id uuid;
begin
  select * into v_prop from public.acc_properties where id = p_property_id;
  if not found then
    raise exception 'property_not_found' using errcode = 'P0002';
  end if;
  if v_prop.source <> 'liteapi' then
    raise exception 'not_external_property' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.acc_provider_settings
    where provider = 'liteapi' and active and booking_enabled
  ) then
    raise exception 'booking_disabled' using errcode = '42501';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;

  insert into public.acc_liteapi_bookings (
    user_id, property_id, external_hotel_id, offer_id, status,
    check_in, check_out, adults, children, guest, price_cents, currency,
    payment_type, payment_at_property, commission_rate, commission_cents,
    offer_snapshot
  )
  values (
    v_uid, p_property_id, p_external_hotel_id, p_offer_id, 'intent',
    p_check_in, p_check_out, greatest(1, coalesce(p_adults, 2)),
    greatest(0, coalesce(p_children, 0)), coalesce(p_guest, '{}'::jsonb),
    p_price_cents, upper(left(coalesce(p_currency, 'TRY'), 3)),
    p_payment_type, coalesce(p_payment_at_property, false),
    0, 0, coalesce(p_offer_snapshot, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('booking_id', v_id, 'status', 'intent', 'commission_rate', 0);
end;
$$;

revoke all on function public.acc_liteapi_create_booking_intent(uuid, text, text, date, date, int, int, jsonb, bigint, text, text, boolean, jsonb) from public;
grant execute on function public.acc_liteapi_create_booking_intent(uuid, text, text, date, date, int, int, jsonb, bigint, text, text, boolean, jsonb)
  to authenticated, service_role;

create or replace function public.acc_liteapi_confirm_booking(
  p_booking_id uuid,
  p_status text,
  p_provider_booking_id text,
  p_provider_payload jsonb default '{}'::jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := case
    when p_status in ('pending_provider', 'confirmed', 'failed', 'cancelled') then p_status
    else 'failed'
  end;
begin
  -- Yalnızca servis rolü çağırır; sağlayıcı onayı olmadan confirmed yazılamaz.
  update public.acc_liteapi_bookings
  set status = v_status,
      provider_booking_id = p_provider_booking_id,
      provider_payload = coalesce(p_provider_payload, '{}'::jsonb),
      error = p_error,
      commission_rate = 0,
      commission_cents = 0
  where id = p_booking_id;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

revoke all on function public.acc_liteapi_confirm_booking(uuid, text, text, jsonb, text) from public;
grant execute on function public.acc_liteapi_confirm_booking(uuid, text, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------
-- 11. Yönetici tesis listesi: kaynak ve sahiplenme alanları
-- ---------------------------------------------------------------------
create or replace function public.acc_admin_properties(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'slug', p.slug,
    'property_type', p.property_type,
    'status', p.status,
    'verification_status', p.verification_status,
    'verification_note', p.verification_note,
    'district', coalesce(p.district, p.external_district),
    'address', coalesce(p.address, p.external_address),
    'phone', p.phone,
    'email', p.email,
    'tax_number', p.tax_number,
    'created_at', p.created_at,
    'source', coalesce(p.source, 'manual'),
    'claim_status', p.claim_status,
    'external_id', p.external_id,
    'external_provider', p.external_provider,
    'stars', p.external_stars,
    'owner', jsonb_build_object(
      'id', pr.id,
      'username', coalesce(pr.username, 'liteapi'),
      'display_name', coalesce(
        nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
        pr.username,
        'LiteAPI sağlayıcı kaydı'
      ),
      'avatar_path', pr.avatar_path
    ),
    'missing', public.acc_property_missing(p.id),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'title', d.title,
        'storage_path', d.storage_path, 'status', d.status
      ) order by d.created_at)
      from public.acc_property_documents d where d.property_id = p.id
    ), '[]'::jsonb),
    'room_type_count', (select count(*) from public.acc_room_types where property_id = p.id and active),
    'room_count', (select count(*) from public.acc_rooms where property_id = p.id and active)
  ) order by p.created_at desc), '[]'::jsonb)
  into v_items
  from public.acc_properties p
  left join public.profiles pr on pr.id = p.owner_id
  where p_status is null or p_status = 'all' or p.status = p_status;

  return jsonb_build_object(
    'items', v_items,
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.acc_properties where status = 'pending_verification'),
      'published', (select count(*) from public.acc_properties where status = 'published'),
      'rejected', (select count(*) from public.acc_properties where status = 'rejected'),
      'suspended', (select count(*) from public.acc_properties where status = 'suspended'),
      'external', (select count(*) from public.acc_properties where source = 'liteapi'),
      'pending_claims', (select count(*) from public.acc_property_claims where status = 'pending')
    )
  );
end;
$$;

grant execute on function public.acc_admin_properties(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12. Yetkiler
-- ---------------------------------------------------------------------
grant execute on function public.acc_normalize_text(text) to anon, authenticated, service_role;
grant execute on function public.acc_distance_m(double precision, double precision, double precision, double precision) to anon, authenticated, service_role;
grant execute on function public.acc_unique_slug(text) to service_role;
