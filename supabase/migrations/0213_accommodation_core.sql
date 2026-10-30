-- =====================================================================
-- 0213 — Trabzone Konaklama çekirdek şeması
--
-- Otel / bungalov / apart / pansiyon / villa işletmelerinin oda, fiyat,
-- rezervasyon, misafir, kasa ve finans verilerini tek bir çatı altında
-- toplar. Mevcut Trabzone hesabı kullanılır; ayrı bir "business" hesabı
-- açılmaz. Tesis yetkisi `acc_property_staff` üzerinden verilir.
--
-- Tüm yazma işlemleri SECURITY DEFINER RPC'lerden geçer. Tablolarda
-- yalnızca okuma politikası vardır; böylece istemci doğrudan tabloya
-- yazarak stok/fiyat/komisyon kurallarını atlayamaz.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Tesisler
-- ---------------------------------------------------------------------
create table if not exists public.acc_properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null unique,
  property_type text not null default 'hotel'
    check (property_type in ('hotel', 'bungalow', 'apartment', 'pension', 'villa')),
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_verification', 'published', 'suspended', 'rejected')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  verification_note text,
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,

  city text not null default 'Trabzon',
  district_id bigint references public.districts(id) on delete set null,
  neighborhood_id bigint references public.neighborhoods(id) on delete set null,
  district text,
  neighborhood text,
  address text,
  lat double precision,
  lng double precision,

  phone text,
  email text,
  website text,
  tax_office text,
  tax_number text,
  invoice_title text,
  contact_name text,
  contact_phone text,
  contact_email text,

  documents_required boolean not null default true,
  room_capacity int check (room_capacity is null or room_capacity > 0),
  checkin_time time not null default '14:00',
  checkout_time time not null default '12:00',
  languages text[] not null default array['tr']::text[],
  policies jsonb not null default '{}'::jsonb,
  amenities text[] not null default '{}'::text[],
  cover_path text,

  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,
  view_count int not null default 0,
  commission_rate numeric(5,2) not null default 10
    check (commission_rate >= 0 and commission_rate <= 100),
  settings jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acc_properties_public_idx
  on public.acc_properties (status, verification_status, property_type, district_id);
create index if not exists acc_properties_owner_idx on public.acc_properties (owner_id);

drop trigger if exists acc_properties_updated_at on public.acc_properties;
create trigger acc_properties_updated_at
  before update on public.acc_properties
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Personel ve yetkiler
-- ---------------------------------------------------------------------
create table if not exists public.acc_property_staff (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner', 'manager', 'front_desk', 'housekeeping', 'accountant', 'viewer')),
  permissions text[] not null default '{}'::text[],
  status text not null default 'active'
    check (status in ('active', 'invited', 'revoked')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, user_id)
);

create index if not exists acc_staff_user_idx on public.acc_property_staff (user_id, status);

drop trigger if exists acc_staff_updated_at on public.acc_property_staff;
create trigger acc_staff_updated_at
  before update on public.acc_property_staff
  for each row execute function public.set_updated_at();

-- Sahip her zaman personel listesinde "owner" olarak görünür.
create or replace function public.acc_property_owner_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.acc_property_staff (property_id, user_id, role, permissions, status)
  values (new.id, new.owner_id, 'owner', array['*']::text[], 'active')
  on conflict (property_id, user_id) do update
    set role = 'owner', permissions = array['*']::text[], status = 'active';
  return new;
end;
$$;

drop trigger if exists acc_properties_owner_staff on public.acc_properties;
create trigger acc_properties_owner_staff
  after insert on public.acc_properties
  for each row execute function public.acc_property_owner_staff();

-- ---------------------------------------------------------------------
-- Doğrulama belgeleri
-- ---------------------------------------------------------------------
create table if not exists public.acc_property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  kind text not null default 'other'
    check (kind in ('business_license', 'tourism_license', 'tax_certificate', 'identity', 'insurance', 'other')),
  title text not null,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  note text,
  review_note text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists acc_property_documents_idx
  on public.acc_property_documents (property_id, status);

-- ---------------------------------------------------------------------
-- Oda tipleri ve fiziksel odalar
-- ---------------------------------------------------------------------
create table if not exists public.acc_room_types (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  name text not null,
  description text,
  capacity_adults int not null default 2 check (capacity_adults > 0),
  capacity_children int not null default 0 check (capacity_children >= 0),
  bed_setup text,
  size_m2 int check (size_m2 is null or size_m2 > 0),
  view text,
  balcony boolean not null default false,
  air_conditioning boolean not null default true,
  wifi boolean not null default true,
  breakfast boolean not null default false,
  amenities text[] not null default '{}'::text[],
  base_price_cents bigint not null default 0 check (base_price_cents >= 0),
  currency text not null default 'TRY',
  cover_path text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acc_room_types_property_idx
  on public.acc_room_types (property_id, active, sort_order);

drop trigger if exists acc_room_types_updated_at on public.acc_room_types;
create trigger acc_room_types_updated_at
  before update on public.acc_room_types
  for each row execute function public.set_updated_at();

create table if not exists public.acc_rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  room_type_id uuid not null references public.acc_room_types(id) on delete cascade,
  number text not null,
  floor text,
  status text not null default 'clean'
    check (status in ('clean', 'dirty', 'cleaning', 'inspection', 'maintenance', 'out_of_service')),
  housekeeping_note text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, number)
);

create index if not exists acc_rooms_property_idx on public.acc_rooms (property_id, room_type_id);

drop trigger if exists acc_rooms_updated_at on public.acc_rooms;
create trigger acc_rooms_updated_at
  before update on public.acc_rooms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Fiyat planları ve günlük fiyat/müsaitlik takvimi
-- ---------------------------------------------------------------------
create table if not exists public.acc_rate_plans (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  room_type_id uuid references public.acc_room_types(id) on delete cascade,
  name text not null,
  description text,
  booking_mode text not null default 'instant'
    check (booking_mode in ('instant', 'manual')),
  cancellation_policy text,
  cancellation_hours int not null default 24 check (cancellation_hours >= 0),
  deposit_percent int not null default 0 check (deposit_percent between 0 and 100),
  includes_breakfast boolean not null default false,
  min_stay int not null default 1 check (min_stay >= 1),
  max_stay int check (max_stay is null or max_stay >= min_stay),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acc_rate_plans_property_idx
  on public.acc_rate_plans (property_id, active, sort_order);

drop trigger if exists acc_rate_plans_updated_at on public.acc_rate_plans;
create trigger acc_rate_plans_updated_at
  before update on public.acc_rate_plans
  for each row execute function public.set_updated_at();

create table if not exists public.acc_rate_calendar (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  room_type_id uuid not null references public.acc_room_types(id) on delete cascade,
  rate_plan_id uuid not null references public.acc_rate_plans(id) on delete cascade,
  stay_date date not null,
  base_price_cents bigint check (base_price_cents is null or base_price_cents >= 0),
  extra_adult_cents bigint not null default 0 check (extra_adult_cents >= 0),
  extra_child_cents bigint not null default 0 check (extra_child_cents >= 0),
  available_rooms int check (available_rooms is null or available_rooms >= 0),
  min_stay int check (min_stay is null or min_stay >= 1),
  max_stay int check (max_stay is null or max_stay >= 1),
  closed boolean not null default false,
  closed_to_arrival boolean not null default false,
  closed_to_departure boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (room_type_id, rate_plan_id, stay_date)
);

create index if not exists acc_rate_calendar_lookup_idx
  on public.acc_rate_calendar (property_id, stay_date);
create index if not exists acc_rate_calendar_plan_idx
  on public.acc_rate_calendar (room_type_id, rate_plan_id, stay_date);

-- ---------------------------------------------------------------------
-- Misafir kayıtları (tesise özel CRM)
-- ---------------------------------------------------------------------
create table if not exists public.acc_guests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  full_name text not null,
  phone text,
  email text,
  notes text,
  contact_consent boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acc_guests_property_idx on public.acc_guests (property_id);
create index if not exists acc_guests_phone_idx on public.acc_guests (property_id, phone);

drop trigger if exists acc_guests_updated_at on public.acc_guests;
create trigger acc_guests_updated_at
  before update on public.acc_guests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Rezervasyonlar
-- ---------------------------------------------------------------------
create table if not exists public.acc_reservations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    default ('TZ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  property_id uuid not null references public.acc_properties(id) on delete restrict,
  room_type_id uuid not null references public.acc_room_types(id) on delete restrict,
  room_id uuid references public.acc_rooms(id) on delete set null,
  rate_plan_id uuid not null references public.acc_rate_plans(id) on delete restrict,
  guest_id uuid references public.acc_guests(id) on delete set null,
  guest_user_id uuid references public.profiles(id) on delete set null,

  guest_name text not null,
  guest_phone text,
  guest_email text,
  adults int not null default 2 check (adults > 0),
  children int not null default 0 check (children >= 0),

  check_in date not null,
  check_out date not null,
  nights int generated always as (check_out - check_in) stored,

  status text not null default 'pending'
    check (status in (
      'draft', 'pending', 'confirmed', 'declined', 'expired',
      'awaiting_checkin', 'checked_in', 'staying', 'checked_out',
      'completed', 'cancelled', 'no_show', 'change_pending', 'disputed'
    )),
  source text not null default 'trabzone'
    check (source in ('trabzone', 'phone', 'front_desk', 'direct_web', 'external_agency', 'other')),
  booking_mode text not null default 'instant'
    check (booking_mode in ('instant', 'manual')),

  nightly_price_cents bigint not null default 0 check (nightly_price_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  commission_rate numeric(5,2) not null default 0
    check (commission_rate >= 0 and commission_rate <= 100),
  commission_cents bigint not null default 0 check (commission_cents >= 0),
  currency text not null default 'TRY',

  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partial', 'paid', 'refunded')),
  paid_cents bigint not null default 0 check (paid_cents >= 0),

  notes text,
  internal_notes text,
  hold_expires_at timestamptz,
  external_ref text,
  cancellation_reason text,

  created_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  cancelled_at timestamptz,
  no_show_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint acc_reservations_dates check (check_out > check_in)
);

create index if not exists acc_reservations_property_idx
  on public.acc_reservations (property_id, check_in, check_out);
create index if not exists acc_reservations_status_idx
  on public.acc_reservations (property_id, status, check_in);
create index if not exists acc_reservations_room_idx
  on public.acc_reservations (room_id, check_in, check_out);
create index if not exists acc_reservations_guest_user_idx
  on public.acc_reservations (guest_user_id, created_at desc);
create index if not exists acc_reservations_hold_idx
  on public.acc_reservations (status, hold_expires_at)
  where status = 'pending';

drop trigger if exists acc_reservations_updated_at on public.acc_reservations;
create trigger acc_reservations_updated_at
  before update on public.acc_reservations
  for each row execute function public.set_updated_at();

/**
 * Aynı fiziksel odanın iki aktif rezervasyonda çakışmasını engeller.
 * Oda tipi stoğu ayrıca RPC içinde kilit altında sayılır; bu trigger son
 * savunma hattıdır.
 */
create or replace function public.acc_guard_room_conflict()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.room_id is not null and new.status in (
    'pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying',
    'checked_out', 'completed', 'change_pending', 'disputed'
  ) then
    if exists (
      select 1
      from public.acc_reservations r
      where r.room_id = new.room_id
        and r.id <> new.id
        and r.status in (
          'pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying',
          'checked_out', 'completed', 'change_pending', 'disputed'
        )
        and daterange(r.check_in, r.check_out, '[)') &&
            daterange(new.check_in, new.check_out, '[)')
    ) then
      raise exception 'room_unavailable' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists acc_reservations_room_conflict on public.acc_reservations;
create trigger acc_reservations_room_conflict
  before insert or update of room_id, check_in, check_out, status
  on public.acc_reservations
  for each row execute function public.acc_guard_room_conflict();

create table if not exists public.acc_reservation_status_history (
  id bigserial primary key,
  reservation_id uuid not null references public.acc_reservations(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists acc_reservation_history_idx
  on public.acc_reservation_status_history (reservation_id, created_at);

-- ---------------------------------------------------------------------
-- Oda blokeleri (bakım / satışa kapalı tarihler)
-- ---------------------------------------------------------------------
create table if not exists public.acc_room_blocks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  room_id uuid not null references public.acc_rooms(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint acc_room_blocks_dates check (end_date > start_date)
);

create index if not exists acc_room_blocks_lookup_idx
  on public.acc_room_blocks (room_id, start_date, end_date);

-- ---------------------------------------------------------------------
-- Medya
-- ---------------------------------------------------------------------
create table if not exists public.acc_property_media (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  room_type_id uuid references public.acc_room_types(id) on delete cascade,
  kind text not null default 'image' check (kind in ('image', 'video')),
  category text not null default 'general'
    check (category in ('cover', 'general', 'room', 'restaurant', 'pool', 'lobby', 'view', 'common')),
  storage_path text not null,
  thumbnail_path text,
  caption text,
  cover boolean not null default false,
  sort_order int not null default 0,
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists acc_property_media_idx
  on public.acc_property_media (property_id, kind, cover desc, sort_order);

-- ---------------------------------------------------------------------
-- Kasa ve finans
-- ---------------------------------------------------------------------
create table if not exists public.acc_cash_accounts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  name text not null,
  kind text not null default 'cash' check (kind in ('cash', 'pos', 'bank')),
  currency text not null default 'TRY',
  opening_balance_cents bigint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acc_cash_accounts_idx on public.acc_cash_accounts (property_id, active);

drop trigger if exists acc_cash_accounts_updated_at on public.acc_cash_accounts;
create trigger acc_cash_accounts_updated_at
  before update on public.acc_cash_accounts
  for each row execute function public.set_updated_at();

create table if not exists public.acc_folio_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  reservation_id uuid references public.acc_reservations(id) on delete set null,
  kind text not null check (kind in ('charge', 'payment', 'refund', 'adjustment')),
  category text not null default 'other'
    check (category in ('room', 'extra', 'tax', 'city_tax', 'cash', 'pos', 'bank', 'commission', 'other')),
  description text,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'TRY',
  occurred_on date not null default current_date,
  method text,
  cash_account_id uuid references public.acc_cash_accounts(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  note text,
  reverses_id uuid references public.acc_folio_items(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists acc_folio_items_reservation_idx
  on public.acc_folio_items (reservation_id, occurred_on);
create index if not exists acc_folio_items_property_idx
  on public.acc_folio_items (property_id, occurred_on);

create table if not exists public.acc_cash_transactions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  account_id uuid not null references public.acc_cash_accounts(id) on delete cascade,
  kind text not null
    check (kind in ('collection', 'expense', 'refund', 'transfer_in', 'transfer_out', 'opening', 'closing', 'adjustment')),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'TRY',
  occurred_on date not null default current_date,
  reservation_id uuid references public.acc_reservations(id) on delete set null,
  folio_item_id uuid references public.acc_folio_items(id) on delete set null,
  transfer_group uuid,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  reverses_id uuid references public.acc_cash_transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists acc_cash_transactions_lookup_idx
  on public.acc_cash_transactions (property_id, account_id, occurred_on);

create table if not exists public.acc_commission_ledger (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  reservation_id uuid references public.acc_reservations(id) on delete set null,
  kind text not null check (kind in ('accrued', 'paid', 'reversed', 'adjustment')),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'TRY',
  occurred_on date not null default current_date,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists acc_commission_ledger_idx
  on public.acc_commission_ledger (property_id, occurred_on);

-- ---------------------------------------------------------------------
-- Kat hizmetleri
-- ---------------------------------------------------------------------
create table if not exists public.acc_housekeeping_tasks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  room_id uuid not null references public.acc_rooms(id) on delete cascade,
  kind text not null default 'cleaning'
    check (kind in ('cleaning', 'maintenance', 'inspection')),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'done', 'verified')),
  assigned_to uuid references public.profiles(id) on delete set null,
  note text,
  photo_path text,
  due_date date not null default current_date,
  created_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acc_housekeeping_idx
  on public.acc_housekeeping_tasks (property_id, status, due_date);

drop trigger if exists acc_housekeeping_updated_at on public.acc_housekeeping_tasks;
create trigger acc_housekeeping_updated_at
  before update on public.acc_housekeeping_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Kampanyalar
-- ---------------------------------------------------------------------
create table if not exists public.acc_campaigns (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  title text not null,
  description text,
  cover_path text,
  kind text not null default 'trabzone'
    check (kind in (
      'trabzone', 'last_minute', 'early_booking', 'weekday', 'weekend',
      'long_stay', 'seasonal', 'limited', 'fixed_price', 'percentage', 'special'
    )),
  start_date date not null,
  end_date date not null,
  booking_deadline date,
  room_type_ids uuid[] not null default '{}'::uuid[],
  rate_plan_ids uuid[] not null default '{}'::uuid[],
  discount_percent numeric(5,2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  fixed_price_cents bigint check (fixed_price_cents is null or fixed_price_cents >= 0),
  min_nights int not null default 1 check (min_nights >= 1),
  max_nights int check (max_nights is null or max_nights >= min_nights),
  quota int check (quota is null or quota >= 0),
  used_count int not null default 0 check (used_count >= 0),
  stackable boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'ended')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_campaign_dates check (end_date >= start_date)
);

create index if not exists acc_campaigns_idx
  on public.acc_campaigns (property_id, status, start_date, end_date);

drop trigger if exists acc_campaigns_updated_at on public.acc_campaigns;
create trigger acc_campaigns_updated_at
  before update on public.acc_campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Yorumlar, mesajlar, belgeler, hareket kaydı
-- ---------------------------------------------------------------------
create table if not exists public.acc_reviews (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  reservation_id uuid unique references public.acc_reservations(id) on delete set null,
  guest_user_id uuid not null references public.profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  cleanliness int check (cleanliness is null or cleanliness between 1 and 5),
  staff_score int check (staff_score is null or staff_score between 1 and 5),
  location_score int check (location_score is null or location_score between 1 and 5),
  value_score int check (value_score is null or value_score between 1 and 5),
  comment text,
  owner_reply text,
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  replied_at timestamptz
);

create index if not exists acc_reviews_property_idx
  on public.acc_reviews (property_id, status, created_at desc);

create table if not exists public.acc_messages (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  reservation_id uuid references public.acc_reservations(id) on delete cascade,
  guest_user_id uuid references public.profiles(id) on delete set null,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_role text not null check (sender_role in ('guest', 'property')),
  body text not null check (length(btrim(body)) between 1 and 4000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists acc_messages_reservation_idx
  on public.acc_messages (reservation_id, created_at);
create index if not exists acc_messages_property_idx
  on public.acc_messages (property_id, created_at desc);

create table if not exists public.acc_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  reservation_id uuid references public.acc_reservations(id) on delete set null,
  kind text not null default 'reservation'
    check (kind in ('reservation', 'invoice', 'receipt', 'statement')),
  number text not null,
  title text not null,
  total_cents bigint not null default 0,
  currency text not null default 'TRY',
  snapshot jsonb not null default '{}'::jsonb,
  storage_path text,
  issued_by uuid references public.profiles(id) on delete set null,
  issued_at timestamptz not null default now(),
  unique (property_id, number)
);

create index if not exists acc_documents_property_idx
  on public.acc_documents (property_id, issued_at desc);

create table if not exists public.acc_activity (
  id bigserial primary key,
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists acc_activity_idx on public.acc_activity (property_id, created_at desc);

-- ---------------------------------------------------------------------
-- Yardımcılar (tablolar oluştuktan sonra)
-- ---------------------------------------------------------------------
create or replace function public.acc_staff_role(p_property_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin() then 'admin'
    when exists (
      select 1 from public.acc_properties p
      where p.id = p_property_id and p.owner_id = auth.uid()
    ) then 'owner'
    else (
      select s.role
      from public.acc_property_staff s
      where s.property_id = p_property_id
        and s.user_id = auth.uid()
        and s.status = 'active'
      limit 1
    )
  end;
$$;

/**
 * Tesis bazlı yetki kontrolü.
 *
 * `p_permission` null ise yalnızca "tesisi görebilir mi" sorusuna cevap
 * verir. Personelin açıkça tanımlanmış izinleri varsa onlar geçerlidir;
 * boşsa rolün varsayılan izin seti uygulanır.
 */
create or replace function public.acc_can(p_property_id uuid, p_permission text default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.acc_staff_role(p_property_id);
  v_permissions text[];
begin
  if v_role is null then
    return false;
  end if;
  if v_role in ('owner', 'admin') then
    return true;
  end if;
  if p_permission is null or p_permission = 'read' then
    return true;
  end if;

  select s.permissions into v_permissions
  from public.acc_property_staff s
  where s.property_id = p_property_id
    and s.user_id = auth.uid()
    and s.status = 'active'
  limit 1;

  if coalesce(array_length(v_permissions, 1), 0) > 0 then
    return '*' = any(v_permissions) or p_permission = any(v_permissions);
  end if;

  return case v_role
    when 'manager' then p_permission not in ('property.delete', 'staff.owner')
    when 'front_desk' then p_permission in (
      'reservations', 'frontdesk', 'guests', 'housekeeping', 'messages',
      'cash.collect', 'calendar.view', 'reports.view'
    )
    when 'housekeeping' then p_permission in ('housekeeping', 'rooms.view')
    when 'accountant' then p_permission in (
      'finance', 'cash', 'documents', 'reports', 'commission', 'reports.view'
    )
    when 'viewer' then false
    else false
  end;
end;
$$;

create or replace function public.acc_require(p_property_id uuid, p_permission text default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not public.acc_can(p_property_id, p_permission) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function public.acc_slugify(p_text text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(p_text, '')),
      'çğıöşüâîû',
      'cgiosuaiu'),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

-- ---------------------------------------------------------------------
-- RLS — yalnızca okuma; yazmalar RPC üzerinden
-- ---------------------------------------------------------------------
alter table public.acc_properties enable row level security;
drop policy if exists acc_properties_staff_read on public.acc_properties;
create policy acc_properties_staff_read on public.acc_properties
  for select to authenticated
  using (public.acc_can(id, 'read'));

do $$
declare
  t text;
  tables text[] := array[
    'acc_property_staff', 'acc_property_documents', 'acc_room_types', 'acc_rooms',
    'acc_rate_plans', 'acc_rate_calendar', 'acc_guests', 'acc_reservations',
    'acc_room_blocks', 'acc_property_media', 'acc_cash_accounts', 'acc_folio_items',
    'acc_cash_transactions', 'acc_commission_ledger', 'acc_housekeeping_tasks',
    'acc_campaigns', 'acc_reviews', 'acc_messages', 'acc_documents', 'acc_activity'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.acc_can(property_id, ''read''))',
      t || '_staff_read', t
    );
  end loop;
end $$;

-- Rezervasyon geçmişi: rezervasyonun tesisine erişimi olan personel okur.
alter table public.acc_reservation_status_history enable row level security;
drop policy if exists acc_reservation_history_staff_read on public.acc_reservation_status_history;
create policy acc_reservation_history_staff_read on public.acc_reservation_status_history
  for select to authenticated
  using (exists (
    select 1 from public.acc_reservations r
    where r.id = reservation_id and public.acc_can(r.property_id, 'read')
  ));

grant select on
  public.acc_properties, public.acc_property_staff, public.acc_property_documents,
  public.acc_room_types, public.acc_rooms, public.acc_rate_plans, public.acc_rate_calendar,
  public.acc_guests, public.acc_reservations, public.acc_reservation_status_history,
  public.acc_room_blocks, public.acc_property_media, public.acc_cash_accounts,
  public.acc_folio_items, public.acc_cash_transactions, public.acc_commission_ledger,
  public.acc_housekeeping_tasks, public.acc_campaigns, public.acc_reviews,
  public.acc_messages, public.acc_documents, public.acc_activity
to authenticated;

grant execute on function public.acc_staff_role(uuid) to authenticated;
grant execute on function public.acc_can(uuid, text) to authenticated;
grant execute on function public.acc_require(uuid, text) to authenticated;
