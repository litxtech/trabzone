-- =====================================================================
-- 0033 — Trabzone Yolculuk Paylaşımı: çekirdek şema
--
-- Bu modül ticari taşımacılık değil, özel araçla masraf paylaşımı
-- modeline göre tasarlanmıştır. Kartlı ödeme ve komisyon akışları,
-- gerekli ödeme/lisans yetkileri sağlanana kadar sunucuda kapalıdır.
--
-- Tüm tablolar RLS açık ve anon/authenticated için doğrudan erişime
-- kapalıdır. Okuma/yazma yalnızca SECURITY DEFINER RPC'ler üzerinden,
-- sunucu tarafında yeniden doğrulanan kurallarla yapılır.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 0. Mevcut bildirim altyapısına yolculuk türü eklenir (yeniden kullanım)
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (
    kind in ('follow','like','comment','message','group_invite','order','market_message',
             'support','security','system','mention','ride')
  );

-- ---------------------------------------------------------------------
-- 1. Gizli belge kovası
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('ride-documents', 'ride-documents', false, 10485760)
on conflict (id) do nothing;

drop policy if exists ride_documents_insert on storage.objects;
create policy ride_documents_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ride-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists ride_documents_select on storage.objects;
create policy ride_documents_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ride-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_permission('ride.verify')
      or public.has_permission('ride.view')
    )
  );

drop policy if exists ride_documents_delete on storage.objects;
create policy ride_documents_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ride-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------
-- 2. Üyelik profili (kimlik durumu, sürücü durumu, güvenilirlik)
-- ---------------------------------------------------------------------
create table if not exists public.ride_member_profiles (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  identity_status  text not null default 'unverified',
  driver_status    text not null default 'none',
  driver_bio       text,
  level            text not null default 'verified',
  completed_trips  integer not null default 0,
  cancelled_trips  integer not null default 0,
  rating_avg       numeric(3,2),
  review_count     integer not null default 0,
  preferences      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ride_member_identity_check check (
    identity_status in ('unverified','pending','approved','rejected','expired')
  ),
  constraint ride_member_driver_check check (
    driver_status in ('none','pending','approved','rejected','suspended')
  ),
  constraint ride_member_level_check check (
    level in ('verified','silver','gold','platinum')
  ),
  constraint ride_member_counts_check check (
    completed_trips >= 0 and cancelled_trips >= 0 and review_count >= 0
  ),
  constraint ride_member_rating_check check (
    rating_avg is null or (rating_avg >= 0 and rating_avg <= 5)
  ),
  constraint ride_member_bio_length check (driver_bio is null or char_length(driver_bio) <= 400)
);

create trigger ride_member_profiles_updated_at before update on public.ride_member_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. Hesap düzeyi doğrulamalar (kimlik, ehliyet, sigorta, taşıma izni)
-- ---------------------------------------------------------------------
create table if not exists public.ride_verifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  kind           text not null,
  status         text not null default 'pending',
  document_path  text,
  meta           jsonb not null default '{}'::jsonb,
  expires_at     date,
  reject_reason  text,
  reviewed_by    uuid references public.profiles (id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ride_verification_kind_check check (
    kind in ('identity','driver_license','insurance','transport_license')
  ),
  constraint ride_verification_status_check check (
    status in ('pending','approved','rejected','expired')
  ),
  constraint ride_verification_document_check check (
    document_path is null or (document_path like user_id::text || '/%' and char_length(document_path) <= 400)
  )
);

create index if not exists ride_verifications_user_idx
  on public.ride_verifications (user_id, created_at desc);
create index if not exists ride_verifications_queue_idx
  on public.ride_verifications (status, created_at)
  where status = 'pending';

create trigger ride_verifications_updated_at before update on public.ride_verifications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Garaj: araçlar ve araç belgeleri
-- ---------------------------------------------------------------------
create table if not exists public.ride_vehicles (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles (id) on delete cascade,
  make              text not null,
  model             text not null,
  year              integer not null,
  color             text not null,
  plate             text not null,
  seat_capacity     integer not null,
  luggage_capacity  text not null default 'medium',
  has_ac            boolean not null default true,
  fuel_type         text not null default 'gasoline',
  accessibility     jsonb not null default '{}'::jsonb,
  photo_paths       text[] not null default '{}',
  status            text not null default 'pending',
  is_active         boolean not null default true,
  reject_reason     text,
  reviewed_by       uuid references public.profiles (id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ride_vehicle_year_check check (year between 1980 and extract(year from now())::int + 1),
  constraint ride_vehicle_seats_check check (seat_capacity between 1 and 8),
  constraint ride_vehicle_luggage_check check (luggage_capacity in ('none','small','medium','large')),
  constraint ride_vehicle_fuel_check check (fuel_type in ('gasoline','diesel','lpg','hybrid','electric')),
  constraint ride_vehicle_status_check check (status in ('pending','approved','rejected','suspended')),
  constraint ride_vehicle_plate_format check (plate ~ '^[0-9]{2}[A-Z]{1,3}[0-9]{2,5}$')
);

create unique index if not exists ride_vehicles_plate_key
  on public.ride_vehicles (upper(plate));
create index if not exists ride_vehicles_owner_idx
  on public.ride_vehicles (owner_id) where is_active;

create trigger ride_vehicles_updated_at before update on public.ride_vehicles
  for each row execute function public.set_updated_at();

create table if not exists public.ride_vehicle_documents (
  id             uuid primary key default gen_random_uuid(),
  vehicle_id     uuid not null references public.ride_vehicles (id) on delete cascade,
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  kind           text not null,
  document_path  text,
  expires_at     date,
  status         text not null default 'pending',
  reject_reason  text,
  reviewed_by    uuid references public.profiles (id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ride_vehicle_document_kind_check check (
    kind in ('registration','insurance','inspection','authorization')
  ),
  constraint ride_vehicle_document_status_check check (
    status in ('pending','approved','rejected','expired')
  )
);

create index if not exists ride_vehicle_documents_vehicle_idx
  on public.ride_vehicle_documents (vehicle_id, kind);

create trigger ride_vehicle_documents_updated_at before update on public.ride_vehicle_documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 5. Sürücü ilanları ve ara duraklar
-- ---------------------------------------------------------------------
create table if not exists public.ride_offers (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid not null references public.profiles (id) on delete cascade,
  vehicle_id          uuid not null references public.ride_vehicles (id) on delete restrict,
  scope               text not null,
  mode                text not null,
  status              text not null default 'published',
  origin_label        text not null,
  origin_address      text,
  origin_city         text not null,
  origin_district     text,
  origin_lat          double precision,
  origin_lng          double precision,
  dest_label          text not null,
  dest_address        text,
  dest_city           text not null,
  dest_district       text,
  dest_lat            double precision,
  dest_lng            double precision,
  depart_at           timestamptz not null,
  depart_flex_minutes integer not null default 15,
  duration_minutes    integer,
  distance_meters     integer,
  price_per_seat_cents integer not null default 0,
  currency            text not null default 'TRY',
  seats_total         integer not null,
  luggage             text not null default 'medium',
  preferences         jsonb not null default '{}'::jsonb,
  route_mode          text not null default 'fixed',
  max_detour_meters   integer,
  max_detour_minutes  integer,
  booking_mode        text not null default 'manual',
  visibility          text not null default 'public',
  notes               text,
  policy_version      text not null default 'ride-2026-10',
  published_at        timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ride_offer_scope_check check (scope in ('intracity','intercity')),
  constraint ride_offer_mode_check check (mode in ('instant','scheduled')),
  constraint ride_offer_status_check check (
    status in ('draft','published','full','started','completed','cancelled','expired')
  ),
  constraint ride_offer_route_mode_check check (route_mode in ('fixed','flexible')),
  constraint ride_offer_booking_check check (booking_mode in ('manual','auto')),
  constraint ride_offer_visibility_check check (visibility in ('public','friends','private')),
  constraint ride_offer_seats_check check (seats_total between 1 and 8),
  constraint ride_offer_price_check check (price_per_seat_cents >= 0 and price_per_seat_cents <= 1000000),
  constraint ride_offer_flex_check check (
    route_mode = 'fixed' or (coalesce(max_detour_meters, 0) > 0 or coalesce(max_detour_minutes, 0) > 0)
  ),
  constraint ride_offer_coords_check check (
    (origin_lat is null) = (origin_lng is null)
    and (dest_lat is null) = (dest_lng is null)
  ),
  constraint ride_offer_depart_check check (depart_at > created_at - interval '2 hours')
);

create index if not exists ride_offers_search_idx
  on public.ride_offers (scope, status, depart_at)
  where status in ('published','full');
create index if not exists ride_offers_driver_idx
  on public.ride_offers (driver_id, depart_at desc);

create trigger ride_offers_updated_at before update on public.ride_offers
  for each row execute function public.set_updated_at();

create table if not exists public.ride_offer_stops (
  id                    uuid primary key default gen_random_uuid(),
  offer_id              uuid not null references public.ride_offers (id) on delete cascade,
  seq                   integer not null,
  kind                  text not null default 'waypoint',
  label                 text not null,
  city                  text,
  district              text,
  lat                   double precision,
  lng                   double precision,
  arrive_offset_minutes integer,
  is_public             boolean not null default true,
  created_at            timestamptz not null default now(),
  constraint ride_stop_kind_check check (kind in ('origin','waypoint','destination')),
  constraint ride_stop_seq_check check (seq between 0 and 8),
  constraint ride_stop_label_length check (char_length(label) between 1 and 120)
);

create unique index if not exists ride_offer_stops_seq_key
  on public.ride_offer_stops (offer_id, seq);

-- ---------------------------------------------------------------------
-- 6. Yolcu talepleri
-- ---------------------------------------------------------------------
create table if not exists public.ride_requests (
  id                uuid primary key default gen_random_uuid(),
  passenger_id      uuid not null references public.profiles (id) on delete cascade,
  scope             text not null,
  origin_label      text not null,
  origin_city       text not null,
  origin_district   text,
  origin_lat        double precision,
  origin_lng        double precision,
  dest_label        text not null,
  dest_city         text not null,
  dest_district     text,
  dest_lat          double precision,
  dest_lng          double precision,
  earliest_depart   timestamptz not null,
  latest_depart     timestamptz not null,
  party_size        integer not null default 1,
  luggage           text not null default 'medium',
  preferences       jsonb not null default '{}'::jsonb,
  mandatory         jsonb not null default '[]'::jsonb,
  status            text not null default 'open',
  notes             text,
  expires_at        timestamptz not null default now() + interval '14 days',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ride_request_scope_check check (scope in ('intracity','intercity')),
  constraint ride_request_status_check check (status in ('open','matched','closed','expired')),
  constraint ride_request_party_check check (party_size between 1 and 8),
  constraint ride_request_window_check check (latest_depart >= earliest_depart),
  constraint ride_request_luggage_check check (luggage in ('none','small','medium','large'))
);

create index if not exists ride_requests_search_idx
  on public.ride_requests (scope, status, earliest_depart)
  where status = 'open';

create trigger ride_requests_updated_at before update on public.ride_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 7. Rezervasyonlar, yolcular ve koltuk tahsisleri
-- ---------------------------------------------------------------------
create table if not exists public.ride_reservations (
  id                uuid primary key default gen_random_uuid(),
  offer_id          uuid not null references public.ride_offers (id) on delete cascade,
  passenger_id      uuid not null references public.profiles (id) on delete cascade,
  request_id        uuid references public.ride_requests (id) on delete set null,
  status            text not null default 'requested',
  seats             integer not null default 1,
  total_cents       integer not null default 0,
  currency          text not null default 'TRY',
  pickup_stop_id    uuid references public.ride_offer_stops (id) on delete set null,
  dropoff_stop_id   uuid references public.ride_offer_stops (id) on delete set null,
  pickup_seq        integer not null default 0,
  dropoff_seq       integer not null default 1,
  pickup_label      text,
  dropoff_label     text,
  boarding_code     text not null,
  alighting_code    text not null,
  payment_method    text not null default 'cash',
  payment_status    text not null default 'unpaid',
  hold_expires_at   timestamptz,
  policy_version    text not null,
  accepted_at       timestamptz not null default now(),
  driver_responded_at timestamptz,
  started_at        timestamptz,
  boarded_at        timestamptz,
  alighted_at       timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  cancelled_by      uuid references public.profiles (id) on delete set null,
  cancel_reason     text,
  idempotency_key   text,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ride_reservation_status_check check (
    status in ('requested','awaiting_approval','confirmed','rejected','expired',
               'cancelled','started','completed','disputed')
  ),
  constraint ride_reservation_seats_check check (seats between 1 and 8),
  constraint ride_reservation_money_check check (total_cents >= 0),
  constraint ride_reservation_payment_method_check check (payment_method in ('cash','card')),
  constraint ride_reservation_payment_status_check check (
    payment_status in ('unpaid','authorized','paid','refunded','partial_refund','failed')
  ),
  constraint ride_reservation_seq_check check (pickup_seq >= 0 and dropoff_seq > pickup_seq),
  constraint ride_reservation_note_length check (note is null or char_length(note) <= 400)
);

create unique index if not exists ride_reservations_idempotency_key
  on public.ride_reservations (passenger_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists ride_reservations_active_key
  on public.ride_reservations (offer_id, passenger_id)
  where status in ('requested','awaiting_approval','confirmed','started');
create index if not exists ride_reservations_offer_idx
  on public.ride_reservations (offer_id, status);
create index if not exists ride_reservations_passenger_idx
  on public.ride_reservations (passenger_id, created_at desc);

create trigger ride_reservations_updated_at before update on public.ride_reservations
  for each row execute function public.set_updated_at();

create table if not exists public.ride_reservation_passengers (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.ride_reservations (id) on delete cascade,
  user_id        uuid references public.profiles (id) on delete set null,
  full_name      text not null,
  seat_no        integer,
  is_primary     boolean not null default false,
  boarded_at     timestamptz,
  alighted_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint ride_reservation_passenger_name check (char_length(full_name) between 1 and 80)
);

create index if not exists ride_reservation_passengers_idx
  on public.ride_reservation_passengers (reservation_id);

create table if not exists public.ride_seat_allocations (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid not null references public.ride_offers (id) on delete cascade,
  reservation_id uuid not null references public.ride_reservations (id) on delete cascade,
  seat_no        integer not null,
  from_seq       integer not null,
  to_seq         integer not null,
  status         text not null default 'held',
  created_at     timestamptz not null default now(),
  constraint ride_allocation_status_check check (status in ('held','confirmed','released')),
  constraint ride_allocation_range_check check (from_seq >= 0 and to_seq > from_seq),
  constraint ride_allocation_seat_check check (seat_no between 1 and 8)
);

create index if not exists ride_allocations_offer_idx
  on public.ride_seat_allocations (offer_id, seat_no, from_seq, to_seq)
  where status in ('held','confirmed');

-- ---------------------------------------------------------------------
-- 8. Bekleme listesi
-- ---------------------------------------------------------------------
create table if not exists public.ride_waitlists (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid not null references public.ride_offers (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  seats          integer not null default 1,
  pickup_seq     integer not null default 0,
  dropoff_seq    integer not null default 1,
  status         text not null default 'waiting',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ride_waitlist_status_check check (status in ('waiting','offered','converted','expired','left')),
  constraint ride_waitlist_seats_check check (seats between 1 and 8),
  constraint ride_waitlist_seq_check check (dropoff_seq > pickup_seq)
);

create unique index if not exists ride_waitlists_active_key
  on public.ride_waitlists (offer_id, user_id)
  where status in ('waiting','offered');

create table if not exists public.ride_waitlist_offers (
  id            uuid primary key default gen_random_uuid(),
  waitlist_id   uuid not null references public.ride_waitlists (id) on delete cascade,
  offer_id      uuid not null references public.ride_offers (id) on delete cascade,
  token         text not null default encode(gen_random_bytes(16), 'hex'),
  status        text not null default 'offered',
  expires_at    timestamptz not null default now() + interval '20 minutes',
  created_at    timestamptz not null default now(),
  constraint ride_waitlist_offer_status_check check (status in ('offered','accepted','declined','expired'))
);

create unique index if not exists ride_waitlist_offer_token_key on public.ride_waitlist_offers (token);

-- ---------------------------------------------------------------------
-- 9. Ödeme, iade ve uyuşmazlık kayıtları
--    Bu tablolar sağlayıcı olayları olmadan "başarılı" sayılmaz.
-- ---------------------------------------------------------------------
create table if not exists public.ride_payments (
  id                  uuid primary key default gen_random_uuid(),
  reservation_id      uuid not null references public.ride_reservations (id) on delete cascade,
  payer_id            uuid not null references public.profiles (id) on delete cascade,
  provider            text not null default 'stripe',
  provider_intent_id  text,
  amount_cents        integer not null,
  currency            text not null default 'TRY',
  status              text not null default 'created',
  idempotency_key     text,
  failure_code        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ride_payment_status_check check (
    status in ('created','requires_action','authorized','succeeded','failed','refunded','partial_refund')
  ),
  constraint ride_payment_amount_check check (amount_cents > 0)
);

create unique index if not exists ride_payments_reservation_idx
  on public.ride_payments (reservation_id) where status in ('created','requires_action','authorized','succeeded');
create unique index if not exists ride_payments_idempotency_idx
  on public.ride_payments (idempotency_key) where idempotency_key is not null;

create table if not exists public.ride_refunds (
  id                uuid primary key default gen_random_uuid(),
  reservation_id    uuid not null references public.ride_reservations (id) on delete cascade,
  payment_id        uuid references public.ride_payments (id) on delete set null,
  amount_cents      integer not null,
  reason            text not null,
  status            text not null default 'requested',
  provider_refund_id text,
  requested_by      uuid references public.profiles (id) on delete set null,
  decided_by        uuid references public.profiles (id) on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ride_refund_status_check check (
    status in ('requested','approved','processing','succeeded','rejected','failed')
  ),
  constraint ride_refund_amount_check check (amount_cents > 0)
);

create trigger ride_refunds_updated_at before update on public.ride_refunds
  for each row execute function public.set_updated_at();

create table if not exists public.ride_disputes (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.ride_reservations (id) on delete cascade,
  opened_by      uuid not null references public.profiles (id) on delete cascade,
  against_id     uuid references public.profiles (id) on delete set null,
  category       text not null,
  description    text not null,
  status         text not null default 'open',
  resolution     text,
  refund_cents   integer not null default 0,
  decided_by     uuid references public.profiles (id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ride_dispute_category_check check (
    category in ('no_show','late','route_change','safety','payment','vehicle','other')
  ),
  constraint ride_dispute_status_check check (
    status in ('open','reviewing','resolved','rejected')
  ),
  constraint ride_dispute_amount_check check (refund_cents >= 0)
);

create index if not exists ride_disputes_queue_idx
  on public.ride_disputes (status, created_at)
  where status in ('open','reviewing');

create trigger ride_disputes_updated_at before update on public.ride_disputes
  for each row execute function public.set_updated_at();

create table if not exists public.ride_payments_updated_at_guard (
  id boolean primary key default false
);

-- ---------------------------------------------------------------------
-- 10. Değerlendirmeler ve güvenilirlik
-- ---------------------------------------------------------------------
create table if not exists public.ride_reviews (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.ride_reservations (id) on delete cascade,
  author_id      uuid not null references public.profiles (id) on delete cascade,
  subject_id     uuid not null references public.profiles (id) on delete cascade,
  author_role    text not null,
  rating         smallint not null,
  comment        text,
  categories     jsonb not null default '{}'::jsonb,
  status         text not null default 'published',
  created_at     timestamptz not null default now(),
  constraint ride_review_role_check check (author_role in ('driver','passenger')),
  constraint ride_review_rating_check check (rating between 1 and 5),
  constraint ride_review_comment_check check (comment is null or char_length(comment) <= 1000),
  constraint ride_review_status_check check (status in ('published','hidden'))
);

create unique index if not exists ride_reviews_unique_author
  on public.ride_reviews (reservation_id, author_id);

-- ---------------------------------------------------------------------
-- 11. Favori güzergâhlar ve düzenli yolculuklar
-- ---------------------------------------------------------------------
create table if not exists public.ride_favorite_routes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  label        text not null,
  scope        text not null default 'intracity',
  origin_label text not null,
  origin_city  text not null,
  origin_lat   double precision,
  origin_lng   double precision,
  dest_label   text not null,
  dest_city    text not null,
  dest_lat     double precision,
  dest_lng     double precision,
  alert_enabled boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint ride_favorite_scope_check check (scope in ('intracity','intercity')),
  constraint ride_favorite_label_length check (char_length(label) between 1 and 80)
);

create index if not exists ride_favorites_user_idx on public.ride_favorite_routes (user_id, created_at desc);

create table if not exists public.ride_recurring_schedules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            text not null,
  scope           text not null default 'intracity',
  origin_label    text not null,
  origin_city     text not null,
  dest_label      text not null,
  dest_city       text not null,
  weekdays        smallint[] not null,
  depart_time     time not null,
  return_time     time,
  seats           integer not null default 1,
  price_per_seat_cents integer,
  preferences     jsonb not null default '{}'::jsonb,
  is_active       boolean not null default true,
  paused_dates    date[] not null default '{}',
  paused_until    date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ride_recurring_role_check check (role in ('driver','passenger')),
  constraint ride_recurring_scope_check check (scope in ('intracity','intercity')),
  constraint ride_recurring_weekdays_check check (
    array_length(weekdays, 1) between 1 and 7
    and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  constraint ride_recurring_seats_check check (seats between 1 and 8)
);

create trigger ride_recurring_schedules_updated_at before update on public.ride_recurring_schedules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 12. Canlı takip, konum paylaşımı, güvenlik
-- ---------------------------------------------------------------------
create table if not exists public.ride_tracking_sessions (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid not null references public.ride_offers (id) on delete cascade,
  driver_id      uuid not null references public.profiles (id) on delete cascade,
  status         text not null default 'active',
  last_lat       double precision,
  last_lng       double precision,
  last_heading   double precision,
  last_speed_kmh double precision,
  last_update_at timestamptz,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  constraint ride_tracking_status_check check (status in ('active','ended'))
);

create unique index if not exists ride_tracking_active_key
  on public.ride_tracking_sessions (offer_id) where status = 'active';

create table if not exists public.ride_location_shares (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  reservation_id uuid references public.ride_reservations (id) on delete cascade,
  offer_id       uuid references public.ride_offers (id) on delete cascade,
  token          text not null default encode(gen_random_bytes(20), 'hex'),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  constraint ride_share_target_check check (reservation_id is not null or offer_id is not null)
);

create unique index if not exists ride_location_shares_token_key on public.ride_location_shares (token);

create table if not exists public.ride_emergency_contacts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  name        text not null,
  phone       text not null,
  relation    text,
  notify_on_sos boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ride_emergency_name_check check (char_length(name) between 2 and 80),
  constraint ride_emergency_phone_check check (phone ~ '^[0-9+][0-9 ]{6,19}$')
);

create index if not exists ride_emergency_user_idx on public.ride_emergency_contacts (user_id);

create trigger ride_emergency_contacts_updated_at before update on public.ride_emergency_contacts
  for each row execute function public.set_updated_at();

create table if not exists public.ride_safety_incidents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  reservation_id uuid references public.ride_reservations (id) on delete set null,
  offer_id       uuid references public.ride_offers (id) on delete set null,
  kind           text not null,
  severity       text not null default 'medium',
  status         text not null default 'open',
  lat            double precision,
  lng            double precision,
  note           text,
  handled_by     uuid references public.profiles (id) on delete set null,
  handled_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ride_incident_kind_check check (
    kind in ('sos','route_deviation','long_stop','connection_lost','harassment','other')
  ),
  constraint ride_incident_severity_check check (severity in ('low','medium','high','critical')),
  constraint ride_incident_status_check check (status in ('open','acknowledged','resolved'))
);

create index if not exists ride_incidents_queue_idx
  on public.ride_safety_incidents (status, severity, created_at)
  where status <> 'resolved';

create trigger ride_safety_incidents_updated_at before update on public.ride_safety_incidents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 13. Koşul kabulü ve denetim izi
-- ---------------------------------------------------------------------
create table if not exists public.ride_policy_acceptances (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  policy_key     text not null,
  policy_version text not null,
  reservation_id uuid references public.ride_reservations (id) on delete set null,
  accepted_at    timestamptz not null default now(),
  unique (user_id, policy_key, policy_version, reservation_id)
);

create table if not exists public.ride_audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ride_audit_logs_entity_idx
  on public.ride_audit_logs (entity_type, entity_id, created_at desc);

-- ---------------------------------------------------------------------
-- 14. Erişim kilidi: tablolar yalnızca RPC'lerden okunur/yazılır
-- ---------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'ride_member_profiles','ride_verifications','ride_vehicles','ride_vehicle_documents',
    'ride_offers','ride_offer_stops','ride_requests','ride_reservations',
    'ride_reservation_passengers','ride_seat_allocations','ride_waitlists',
    'ride_waitlist_offers','ride_payments','ride_refunds','ride_disputes','ride_reviews',
    'ride_favorite_routes','ride_recurring_schedules','ride_tracking_sessions',
    'ride_location_shares','ride_emergency_contacts','ride_safety_incidents',
    'ride_policy_acceptances','ride_audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from anon, authenticated', v_table);
  end loop;
end $$;

drop table if exists public.ride_payments_updated_at_guard;

-- ---------------------------------------------------------------------
-- 15. Yardımcı fonksiyonlar
-- ---------------------------------------------------------------------
create or replace function public.ride_member_ensure(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ride_member_profiles (user_id)
  values (p_uid)
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.ride_member_ensure(uuid) from public, anon, authenticated;

create or replace function public.ride_haversine_m(
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
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
        * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    ))
  end
$$;

create or replace function public.ride_audit(
  p_actor uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ride_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, left(p_action, 80), left(p_entity_type, 40), p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

revoke all on function public.ride_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Profil oluşturulduğunda yolculuk üyeliği de hazırlanır.
create or replace function public.ride_handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ride_member_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ride_profile_created on public.profiles;
create trigger ride_profile_created after insert on public.profiles
  for each row execute function public.ride_handle_new_profile();

insert into public.ride_member_profiles (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

create or replace function public.ride_is_participant(p_offer_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ride_offers o
    where o.id = p_offer_id
      and (
        o.driver_id = p_uid
        or exists (
          select 1 from public.ride_reservations r
          where r.offer_id = o.id and r.passenger_id = p_uid
            and r.status in ('requested','awaiting_approval','confirmed','started','completed','disputed')
        )
      )
  )
$$;

revoke all on function public.ride_is_participant(uuid, uuid) from public, anon, authenticated;

create or replace function public.ride_reservation_json(p_reservation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'seats', r.seats,
    'total_cents', r.total_cents,
    'currency', r.currency,
    'payment_method', r.payment_method,
    'payment_status', r.payment_status,
    'pickup_label', r.pickup_label,
    'dropoff_label', r.dropoff_label,
    'pickup_seq', r.pickup_seq,
    'dropoff_seq', r.dropoff_seq,
    'boarding_code', case when o.driver_id = auth.uid() or r.passenger_id = auth.uid() then r.boarding_code else null end,
    'hold_expires_at', r.hold_expires_at,
    'created_at', r.created_at,
    'started_at', r.started_at,
    'boarded_at', r.boarded_at,
    'alighted_at', r.alighted_at,
    'completed_at', r.completed_at,
    'cancelled_at', r.cancelled_at,
    'cancel_reason', r.cancel_reason,
    'note', r.note,
    'policy_version', r.policy_version,
    'offer_id', o.id,
    'offer_status', o.status,
    'scope', o.scope,
    'mode', o.mode,
    'origin_label', o.origin_label,
    'dest_label', o.dest_label,
    'origin_city', o.origin_city,
    'dest_city', o.dest_city,
    'depart_at', o.depart_at,
    'price_per_seat_cents', o.price_per_seat_cents,
    'driver_id', o.driver_id,
    'driver_username', dp.username,
    'driver_first_name', dp.first_name,
    'driver_avatar_path', dp.avatar_path,
    'driver_verified', dp.is_verified,
    'driver_level', m.level,
    'driver_rating', m.rating_avg,
    'driver_trips', m.completed_trips,
    'vehicle', jsonb_build_object(
      'make', v.make, 'model', v.model, 'year', v.year,
      'color', v.color, 'plate', v.plate, 'has_ac', v.has_ac,
      'accessibility', v.accessibility
    ),
    'passenger_id', r.passenger_id,
    'passenger_username', pp.username,
    'passenger_first_name', pp.first_name,
    'passenger_avatar_path', pp.avatar_path,
    'passengers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rp.id, 'full_name', rp.full_name, 'seat_no', rp.seat_no,
        'is_primary', rp.is_primary, 'boarded_at', rp.boarded_at, 'alighted_at', rp.alighted_at
      ) order by rp.seat_no)
      from public.ride_reservation_passengers rp where rp.reservation_id = r.id
    ), '[]'::jsonb),
    'seats_detail', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seat_no', a.seat_no, 'from_seq', a.from_seq, 'to_seq', a.to_seq, 'status', a.status
      ) order by a.seat_no)
      from public.ride_seat_allocations a
      where a.reservation_id = r.id and a.status in ('held','confirmed')
    ), '[]'::jsonb),
    'has_reviewed', exists (
      select 1 from public.ride_reviews rv
      where rv.reservation_id = r.id and rv.author_id = auth.uid()
    )
  )
  from public.ride_reservations r
  join public.ride_offers o on o.id = r.offer_id
  join public.ride_vehicles v on v.id = o.vehicle_id
  join public.profiles dp on dp.id = o.driver_id
  join public.ride_member_profiles m on m.user_id = o.driver_id
  join public.profiles pp on pp.id = r.passenger_id
  where r.id = p_reservation_id
$$;

revoke all on function public.ride_reservation_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 16. Kullanım koşulları / tarife metni (sürüm sabittir)
-- ---------------------------------------------------------------------
create or replace function public.ride_policy()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'version', 'ride-2026-10',
    'title', 'Yolculuk Paylaşımı Katılım Koşulları',
    'items', jsonb_build_array(
      'Sürücü, aracını kendi seyahati için kullanır; yolculuk ticari taşımacılık değildir.',
      'Taraflar birbirini tanımadan önce tam adres ve telefon bilgisi paylaşılmaz.',
      'Ödeme uygulama dışında nakit olarak yapılabilir; kartlı ödeme yetkili sağlayıcı etkinleşmeden kullanılamaz.',
      'Her iki taraf da kimlik doğrulamasını tamamlamadan rezervasyon oluşturamaz.',
      'Acil durumlarda 112 aranmalıdır; Trabzone resmi acil yardım hizmeti değildir.',
      'İptal ve iade kuralları rezervasyon öncesinde gösterilir ve kabul zamanı kaydedilir.'
    )
  )
$$;

revoke all on function public.ride_policy() from public, anon;
grant execute on function public.ride_policy() to authenticated;

-- ---------------------------------------------------------------------
-- 17. Üyelik profili ve doğrulama RPC'leri
-- ---------------------------------------------------------------------
create or replace function public.ride_my_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_m public.ride_member_profiles%rowtype;
  v_vehicle_count int;
begin
  perform public.ride_member_ensure(v_uid);
  select * into v_m from public.ride_member_profiles where user_id = v_uid;

  select count(*) into v_vehicle_count
  from public.ride_vehicles where owner_id = v_uid and is_active;

  return jsonb_build_object(
    'user_id', v_uid,
    'identity_status', v_m.identity_status,
    'driver_status', v_m.driver_status,
    'driver_bio', v_m.driver_bio,
    'level', v_m.level,
    'completed_trips', v_m.completed_trips,
    'cancelled_trips', v_m.cancelled_trips,
    'rating_avg', v_m.rating_avg,
    'review_count', v_m.review_count,
    'preferences', v_m.preferences,
    'vehicle_count', v_vehicle_count,
    'verifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'kind', v.kind, 'status', v.status,
        'expires_at', v.expires_at, 'reject_reason', v.reject_reason,
        'created_at', v.created_at
      ) order by v.created_at desc)
      from public.ride_verifications v where v.user_id = v_uid
    ), '[]'::jsonb),
    'policy', public.ride_policy()
  );
end;
$$;

grant execute on function public.ride_my_profile() to authenticated;

create or replace function public.ride_verification_submit(
  p_kind text,
  p_document_path text,
  p_expires_at date default null,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_id uuid;
  v_existing public.ride_verifications%rowtype;
begin
  if p_kind not in ('identity','driver_license','insurance','transport_license') then
    raise exception 'invalid_verification_kind' using errcode = '22023';
  end if;

  if p_document_path is null or p_document_path not like v_uid::text || '/%' then
    raise exception 'invalid_document_path' using errcode = '22023';
  end if;

  perform public.ride_member_ensure(v_uid);

  select * into v_existing
  from public.ride_verifications
  where user_id = v_uid and kind = p_kind
  order by created_at desc limit 1;

  if found and v_existing.status = 'approved' and (v_existing.expires_at is null or v_existing.expires_at > current_date) then
    raise exception 'verification_already_approved' using errcode = '22023';
  end if;

  insert into public.ride_verifications (user_id, kind, document_path, expires_at, meta, status)
  values (v_uid, p_kind, p_document_path, p_expires_at, coalesce(p_meta, '{}'::jsonb), 'pending')
  returning id into v_id;

  if p_kind = 'identity' then
    update public.ride_member_profiles
       set identity_status = 'pending'
     where user_id = v_uid and identity_status in ('unverified','rejected','expired');
  end if;

  perform public.ride_audit(v_uid, 'verification.submit', 'ride_verification', v_id::text,
    jsonb_build_object('kind', p_kind));

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

grant execute on function public.ride_verification_submit(text, text, date, jsonb) to authenticated;

create or replace function public.ride_driver_apply(p_bio text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_identity text;
  v_has_license boolean;
begin
  perform public.ride_member_ensure(v_uid);

  select identity_status into v_identity from public.ride_member_profiles where user_id = v_uid;
  if v_identity <> 'approved' then
    raise exception 'identity_required' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.ride_verifications
    where user_id = v_uid and kind = 'driver_license' and status = 'approved'
      and (expires_at is null or expires_at > current_date)
  ) into v_has_license;

  if not v_has_license then
    raise exception 'license_required' using errcode = '42501';
  end if;

  update public.ride_member_profiles
     set driver_status = 'pending',
         driver_bio = nullif(left(coalesce(p_bio, ''), 400), '')
   where user_id = v_uid;

  perform public.ride_audit(v_uid, 'driver.apply', 'ride_member', v_uid::text, '{}'::jsonb);
  return jsonb_build_object('driver_status', 'pending');
end;
$$;

grant execute on function public.ride_driver_apply(text) to authenticated;

-- ---------------------------------------------------------------------
-- 18. Garaj RPC'leri
-- ---------------------------------------------------------------------
create or replace function public.ride_vehicle_json(p_vehicle_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', v.id,
    'owner_id', v.owner_id,
    'make', v.make,
    'model', v.model,
    'year', v.year,
    'color', v.color,
    'plate', v.plate,
    'seat_capacity', v.seat_capacity,
    'luggage_capacity', v.luggage_capacity,
    'has_ac', v.has_ac,
    'fuel_type', v.fuel_type,
    'accessibility', v.accessibility,
    'photo_paths', v.photo_paths,
    'status', v.status,
    'is_active', v.is_active,
    'reject_reason', v.reject_reason,
    'created_at', v.created_at,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'status', d.status, 'expires_at', d.expires_at,
        'reject_reason', d.reject_reason, 'document_path', d.document_path,
        'created_at', d.created_at
      ) order by d.created_at desc)
      from public.ride_vehicle_documents d where d.vehicle_id = v.id
    ), '[]'::jsonb)
  )
  from public.ride_vehicles v
  where v.id = p_vehicle_id
$$;

revoke all on function public.ride_vehicle_json(uuid) from public, anon, authenticated;

create or replace function public.ride_my_vehicles()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  perform public.ride_member_ensure(v_uid);
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(public.ride_vehicle_json(v.id) order by v.created_at desc)
      from public.ride_vehicles v where v.owner_id = v_uid and v.is_active
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.ride_my_vehicles() to authenticated;

create or replace function public.ride_vehicle_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_existing public.ride_vehicles%rowtype;
  v_make text := trim(coalesce(p_payload->>'make', ''));
  v_model text := trim(coalesce(p_payload->>'model', ''));
  v_year int := coalesce((p_payload->>'year')::int, 0);
  v_color text := trim(coalesce(p_payload->>'color', ''));
  v_plate text := upper(replace(coalesce(p_payload->>'plate', ''), ' ', ''));
  v_seats int := coalesce((p_payload->>'seat_capacity')::int, 0);
  v_luggage text := coalesce(p_payload->>'luggage_capacity', 'medium');
  v_fuel text := coalesce(p_payload->>'fuel_type', 'gasoline');
  v_has_ac boolean := coalesce((p_payload->>'has_ac')::boolean, true);
  v_accessibility jsonb := coalesce(p_payload->'accessibility', '{}'::jsonb);
  v_photos text[] := coalesce(
    (select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload->'photo_paths', '[]'::jsonb)) as value),
    '{}'
  );
  v_status text := 'pending';
  v_active_counts int;
begin
  if char_length(v_make) not between 1 and 40 or char_length(v_model) not between 1 and 40 then
    raise exception 'invalid_vehicle' using errcode = '22023';
  end if;
  if v_year < 1980 or v_year > extract(year from now())::int + 1 then
    raise exception 'invalid_vehicle_year' using errcode = '22023';
  end if;
  if v_plate !~ '^[0-9]{2}[A-Z]{1,3}[0-9]{2,5}$' then
    raise exception 'invalid_plate' using errcode = '22023';
  end if;
  if v_seats < 1 or v_seats > 8 then
    raise exception 'invalid_seat_capacity' using errcode = '22023';
  end if;
  if v_luggage not in ('none','small','medium','large') then
    raise exception 'invalid_luggage' using errcode = '22023';
  end if;
  if v_fuel not in ('gasoline','diesel','lpg','hybrid','electric') then
    raise exception 'invalid_fuel_type' using errcode = '22023';
  end if;

  perform public.ride_member_ensure(v_uid);

  if v_id is null then
    insert into public.ride_vehicles (
      owner_id, make, model, year, color, plate, seat_capacity, luggage_capacity,
      has_ac, fuel_type, accessibility, photo_paths, status
    ) values (
      v_uid, v_make, v_model, v_year, v_color, v_plate, v_seats, v_luggage,
      v_has_ac, v_fuel, v_accessibility, v_photos, 'pending'
    ) returning id into v_id;
  else
    select * into v_existing from public.ride_vehicles where id = v_id for update;
    if not found or v_existing.owner_id <> v_uid then
      raise exception 'vehicle_not_found' using errcode = '42501';
    end if;

    -- Aktif rezervasyon varken kapasite/erişilebilirlik daraltılamaz.
    select count(*) into v_active_counts
    from public.ride_reservations r
    join public.ride_offers o on o.id = r.offer_id
    where o.vehicle_id = v_id
      and r.status in ('requested','awaiting_approval','confirmed','started');

    if v_active_counts > 0 then
      if v_seats < v_existing.seat_capacity then
        raise exception 'vehicle_capacity_conflict' using errcode = '22023';
      end if;
      if coalesce(v_existing.accessibility, '{}'::jsonb) <> '{}'::jsonb
         and coalesce(v_accessibility, '{}'::jsonb) = '{}'::jsonb then
        raise exception 'vehicle_accessibility_conflict' using errcode = '22023';
      end if;
    end if;

    update public.ride_vehicles
       set make = v_make, model = v_model, year = v_year, color = v_color, plate = v_plate,
           seat_capacity = v_seats, luggage_capacity = v_luggage, has_ac = v_has_ac,
           fuel_type = v_fuel, accessibility = v_accessibility, photo_paths = v_photos,
           status = case when v_existing.status = 'approved' then 'approved' else 'pending' end,
           is_active = true
     where id = v_id;

    if v_active_counts > 0 then
      insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, route)
      select distinct r.passenger_id, 'ride', 'Araç bilgisi güncellendi',
             'Yolculuğunda kullanılacak araç bilgileri sürücü tarafından güncellendi.',
             'ride_offer', r.offer_id::text, '/ride/trips/' || r.id::text
      from public.ride_reservations r
      join public.ride_offers o on o.id = r.offer_id
      where o.vehicle_id = v_id
        and r.status in ('confirmed','started');
    end if;
  end if;

  perform public.ride_audit(v_uid, 'vehicle.save', 'ride_vehicle', v_id::text,
    jsonb_build_object('status', 'pending'));

  return public.ride_vehicle_json(v_id);
end;
$$;

grant execute on function public.ride_vehicle_save(jsonb) to authenticated;

create or replace function public.ride_vehicle_remove(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_owner uuid;
  v_active int;
begin
  select owner_id into v_owner from public.ride_vehicles where id = p_vehicle_id for update;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'vehicle_not_found' using errcode = '42501';
  end if;

  select count(*) into v_active
  from public.ride_offers o
  where o.vehicle_id = p_vehicle_id and o.status in ('published','full','started');

  if v_active > 0 then
    raise exception 'vehicle_has_active_offers' using errcode = '22023';
  end if;

  update public.ride_vehicles set is_active = false where id = p_vehicle_id;
  perform public.ride_audit(v_uid, 'vehicle.remove', 'ride_vehicle', p_vehicle_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.ride_vehicle_remove(uuid) to authenticated;

create or replace function public.ride_vehicle_document_submit(
  p_vehicle_id uuid,
  p_kind text,
  p_document_path text,
  p_expires_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_owner uuid;
  v_id uuid;
begin
  if p_kind not in ('registration','insurance','inspection','authorization') then
    raise exception 'invalid_document_kind' using errcode = '22023';
  end if;
  if p_document_path is null or p_document_path not like v_uid::text || '/%' then
    raise exception 'invalid_document_path' using errcode = '22023';
  end if;

  select owner_id into v_owner from public.ride_vehicles where id = p_vehicle_id;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'vehicle_not_found' using errcode = '42501';
  end if;

  insert into public.ride_vehicle_documents (vehicle_id, owner_id, kind, document_path, expires_at, status)
  values (p_vehicle_id, v_uid, p_kind, p_document_path, p_expires_at, 'pending')
  returning id into v_id;

  update public.ride_vehicles set status = 'pending'
   where id = p_vehicle_id and status in ('pending','rejected');

  perform public.ride_audit(v_uid, 'vehicle_document.submit', 'ride_vehicle_document', v_id::text,
    jsonb_build_object('kind', p_kind, 'vehicle_id', p_vehicle_id));

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

grant execute on function public.ride_vehicle_document_submit(uuid, text, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- 19. İlan yayınlama
-- ---------------------------------------------------------------------
create or replace function public.ride_publish_offer(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_identity text;
  v_driver text;
  v_vehicle public.ride_vehicles%rowtype;
  v_scope text := coalesce(p_payload->>'scope', 'intracity');
  v_mode text := coalesce(p_payload->>'mode', 'scheduled');
  v_route_mode text := coalesce(p_payload->>'route_mode', 'fixed');
  v_booking text := coalesce(p_payload->>'booking_mode', 'manual');
  v_visibility text := coalesce(p_payload->>'visibility', 'public');
  v_seats int := coalesce((p_payload->>'seats_total')::int, 0);
  v_price int := coalesce((p_payload->>'price_per_seat_cents')::int, 0);
  v_depart timestamptz := (p_payload->>'depart_at')::timestamptz;
  v_origin_label text := trim(coalesce(p_payload->>'origin_label', ''));
  v_dest_label text := trim(coalesce(p_payload->>'dest_label', ''));
  v_origin_city text := trim(coalesce(p_payload->>'origin_city', ''));
  v_dest_city text := trim(coalesce(p_payload->>'dest_city', ''));
  v_origin_lat double precision := nullif(p_payload->>'origin_lat', '')::double precision;
  v_origin_lng double precision := nullif(p_payload->>'origin_lng', '')::double precision;
  v_dest_lat double precision := nullif(p_payload->>'dest_lat', '')::double precision;
  v_dest_lng double precision := nullif(p_payload->>'dest_lng', '')::double precision;
  v_id uuid;
  v_offer public.ride_offers%rowtype;
  v_distance int;
  v_stop jsonb;
  v_seq int := 0;
  v_max_seq int := 0;
  v_duration int := nullif(p_payload->>'duration_minutes', '')::int;
begin
  if v_scope not in ('intracity','intercity') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;
  if v_mode not in ('instant','scheduled') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if v_route_mode not in ('fixed','flexible') then
    raise exception 'invalid_route_mode' using errcode = '22023';
  end if;
  if v_booking not in ('manual','auto') then
    raise exception 'invalid_booking_mode' using errcode = '22023';
  end if;
  if v_visibility not in ('public','friends','private') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  if char_length(v_origin_label) not between 2 and 120 or char_length(v_dest_label) not between 2 and 120 then
    raise exception 'invalid_route' using errcode = '22023';
  end if;
  if char_length(v_origin_city) not between 2 and 60 or char_length(v_dest_city) not between 2 and 60 then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  if v_depart is null then
    raise exception 'invalid_depart_at' using errcode = '22023';
  end if;
  if v_depart < now() - interval '15 minutes' then
    raise exception 'depart_in_past' using errcode = '22023';
  end if;
  if v_price < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if v_route_mode = 'flexible'
     and coalesce(nullif(p_payload->>'max_detour_meters', '')::int, 0) <= 0
     and coalesce(nullif(p_payload->>'max_detour_minutes', '')::int, 0) <= 0 then
    raise exception 'detour_required' using errcode = '22023';
  end if;

  perform public.ride_member_ensure(v_uid);
  select identity_status, driver_status into v_identity, v_driver
  from public.ride_member_profiles where user_id = v_uid;

  if v_identity <> 'approved' then
    raise exception 'identity_required' using errcode = '42501';
  end if;
  if v_driver <> 'approved' then
    raise exception 'driver_verification_required' using errcode = '42501';
  end if;

  select * into v_vehicle from public.ride_vehicles
  where id = nullif(p_payload->>'vehicle_id', '')::uuid;
  if not found or v_vehicle.owner_id <> v_uid or v_vehicle.status <> 'approved' or not v_vehicle.is_active then
    raise exception 'vehicle_not_approved' using errcode = '42501';
  end if;

  if v_seats < 1 or v_seats > v_vehicle.seat_capacity then
    raise exception 'invalid_seat_count' using errcode = '22023';
  end if;

  -- Zorunlu güvenlik/erişilebilirlik koşulları araçla uyumlu olmalı.
  if (p_payload->'preferences'->>'accessible_required')::boolean is true
     and coalesce((v_vehicle.accessibility->>'wheelchair')::boolean, false) is not true then
    raise exception 'vehicle_accessibility_mismatch' using errcode = '22023';
  end if;

  v_distance := round(public.ride_haversine_m(v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng))::int;

  insert into public.ride_offers (
    driver_id, vehicle_id, scope, mode, status,
    origin_label, origin_address, origin_city, origin_district, origin_lat, origin_lng,
    dest_label, dest_address, dest_city, dest_district, dest_lat, dest_lng,
    depart_at, depart_flex_minutes, duration_minutes, distance_meters,
    price_per_seat_cents, seats_total, luggage, preferences,
    route_mode, max_detour_meters, max_detour_minutes, booking_mode, visibility, notes
  ) values (
    v_uid, v_vehicle.id, v_scope, v_mode, 'published',
    v_origin_label, nullif(p_payload->>'origin_address',''), v_origin_city,
    nullif(p_payload->>'origin_district',''), v_origin_lat, v_origin_lng,
    v_dest_label, nullif(p_payload->>'dest_address',''), v_dest_city,
    nullif(p_payload->>'dest_district',''), v_dest_lat, v_dest_lng,
    v_depart, coalesce(nullif(p_payload->>'depart_flex_minutes','')::int, 15),
    v_duration, v_distance, v_price, v_seats,
    coalesce(p_payload->>'luggage', 'medium'), coalesce(p_payload->'preferences', '{}'::jsonb),
    v_route_mode, nullif(p_payload->>'max_detour_meters','')::int,
    nullif(p_payload->>'max_detour_minutes','')::int, v_booking, v_visibility,
    nullif(left(coalesce(p_payload->>'notes',''), 500), '')
  ) returning * into v_offer;

  insert into public.ride_offer_stops (offer_id, seq, kind, label, city, district, lat, lng, arrive_offset_minutes)
  values (v_offer.id, 0, 'origin', v_origin_label, v_origin_city,
          nullif(p_payload->>'origin_district',''), v_origin_lat, v_origin_lng, 0);

  for v_stop in select * from jsonb_array_elements(coalesce(p_payload->'stops', '[]'::jsonb)) loop
    v_seq := v_seq + 1;
    if v_seq > 7 then
      raise exception 'too_many_stops' using errcode = '22023';
    end if;
    insert into public.ride_offer_stops (offer_id, seq, kind, label, city, district, lat, lng, arrive_offset_minutes, is_public)
    values (
      v_offer.id, v_seq, 'waypoint',
      left(coalesce(nullif(v_stop->>'label',''), 'Ara durak'), 120),
      nullif(v_stop->>'city',''), nullif(v_stop->>'district',''),
      nullif(v_stop->>'lat','')::double precision, nullif(v_stop->>'lng','')::double precision,
      nullif(v_stop->>'arrive_offset_minutes','')::int,
      coalesce((v_stop->>'is_public')::boolean, true)
    );
  end loop;

  v_max_seq := v_seq + 1;
  insert into public.ride_offer_stops (offer_id, seq, kind, label, city, district, lat, lng, arrive_offset_minutes)
  values (v_offer.id, v_max_seq, 'destination', v_dest_label, v_dest_city,
          nullif(p_payload->>'dest_district',''), v_dest_lat, v_dest_lng, v_duration);

  perform public.ride_audit(v_uid, 'offer.publish', 'ride_offer', v_offer.id::text,
    jsonb_build_object('scope', v_scope, 'mode', v_mode, 'seats', v_seats));

  return public.ride_offer_detail(v_offer.id);
end;
$$;

grant execute on function public.ride_publish_offer(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 20. İlan detayı (hassas adres yalnızca taraflara)
-- ---------------------------------------------------------------------
create or replace function public.ride_offer_detail(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_is_driver boolean;
  v_is_participant boolean;
  v_offer public.ride_offers%rowtype;
  v_m public.ride_member_profiles%rowtype;
  v_vehicle public.ride_vehicles%rowtype;
  v_driver public.profiles%rowtype;
  v_reservation_id uuid;
  v_reservation_status text;
begin
  select * into v_offer from public.ride_offers where id = p_offer_id;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;

  v_is_driver := v_offer.driver_id = v_uid;
  v_is_participant := public.ride_is_participant(p_offer_id, v_uid);

  if v_offer.visibility = 'private' and not v_is_participant then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;
  if v_offer.visibility = 'friends' and not v_is_participant and v_offer.driver_id <> v_uid then
    if not exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted'
        and ((f.sender_id = v_uid and f.receiver_id = v_offer.driver_id)
          or (f.receiver_id = v_uid and f.sender_id = v_offer.driver_id))
    ) then
      raise exception 'offer_not_found' using errcode = 'P0002';
    end if;
  end if;

  select * into v_m from public.ride_member_profiles where user_id = v_offer.driver_id;
  select * into v_vehicle from public.ride_vehicles where id = v_offer.vehicle_id;
  select * into v_driver from public.profiles where id = v_offer.driver_id;

  select r.id, r.status into v_reservation_id, v_reservation_status
  from public.ride_reservations r
  where r.offer_id = p_offer_id and r.passenger_id = v_uid
  order by r.created_at desc limit 1;

  return jsonb_build_object(
    'id', v_offer.id,
    'scope', v_offer.scope,
    'mode', v_offer.mode,
    'status', v_offer.status,
    'origin_label', v_offer.origin_label,
    'origin_address', case when v_is_participant then v_offer.origin_address else null end,
    'origin_city', v_offer.origin_city,
    'origin_district', v_offer.origin_district,
    'origin_lat', case when v_is_participant then v_offer.origin_lat else round(v_offer.origin_lat::numeric, 3)::double precision end,
    'origin_lng', case when v_is_participant then v_offer.origin_lng else round(v_offer.origin_lng::numeric, 3)::double precision end,
    'dest_label', v_offer.dest_label,
    'dest_address', case when v_is_participant then v_offer.dest_address else null end,
    'dest_city', v_offer.dest_city,
    'dest_district', v_offer.dest_district,
    'dest_lat', case when v_is_participant then v_offer.dest_lat else round(v_offer.dest_lat::numeric, 3)::double precision end,
    'dest_lng', case when v_is_participant then v_offer.dest_lng else round(v_offer.dest_lng::numeric, 3)::double precision end,
    'depart_at', v_offer.depart_at,
    'depart_flex_minutes', v_offer.depart_flex_minutes,
    'duration_minutes', v_offer.duration_minutes,
    'distance_meters', v_offer.distance_meters,
    'price_per_seat_cents', v_offer.price_per_seat_cents,
    'currency', v_offer.currency,
    'seats_total', v_offer.seats_total,
    'luggage', v_offer.luggage,
    'preferences', v_offer.preferences,
    'route_mode', v_offer.route_mode,
    'max_detour_meters', v_offer.max_detour_meters,
    'max_detour_minutes', v_offer.max_detour_minutes,
    'booking_mode', v_offer.booking_mode,
    'visibility', v_offer.visibility,
    'notes', v_offer.notes,
    'policy_version', v_offer.policy_version,
    'is_driver', v_is_driver,
    'is_participant', v_is_participant,
    'my_reservation_id', v_reservation_id,
    'my_reservation_status', v_reservation_status,
    'driver', jsonb_build_object(
      'id', v_driver.id,
      'username', v_driver.username,
      'first_name', v_driver.first_name,
      'avatar_path', v_driver.avatar_path,
      'is_verified', v_driver.is_verified,
      'bio', v_m.driver_bio,
      'level', v_m.level,
      'rating_avg', v_m.rating_avg,
      'review_count', v_m.review_count,
      'completed_trips', v_m.completed_trips
    ),
    'vehicle', jsonb_build_object(
      'id', v_vehicle.id, 'make', v_vehicle.make, 'model', v_vehicle.model,
      'year', v_vehicle.year, 'color', v_vehicle.color, 'plate', v_vehicle.plate,
      'seat_capacity', v_vehicle.seat_capacity, 'luggage_capacity', v_vehicle.luggage_capacity,
      'has_ac', v_vehicle.has_ac, 'fuel_type', v_vehicle.fuel_type,
      'accessibility', v_vehicle.accessibility, 'photo_paths', v_vehicle.photo_paths
    ),
    'stops', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'seq', s.seq, 'kind', s.kind, 'label', s.label,
        'city', s.city, 'district', s.district,
        'lat', case when v_is_participant then s.lat else null end,
        'lng', case when v_is_participant then s.lng else null end,
        'arrive_offset_minutes', s.arrive_offset_minutes,
        'is_public', s.is_public
      ) order by s.seq)
      from public.ride_offer_stops s where s.offer_id = v_offer.id and (s.is_public or v_is_participant)
    ), '[]'::jsonb),
    'availability', public.ride_offer_availability(v_offer.id),
    'policy', public.ride_policy(),
    'waitlist', (
      select jsonb_build_object('id', w.id, 'status', w.status, 'position', (
        select count(*) + 1 from public.ride_waitlists w2
        where w2.offer_id = w.offer_id and w2.status = 'waiting' and w2.created_at < w.created_at
      ))
      from public.ride_waitlists w
      where w.offer_id = v_offer.id and w.user_id = v_uid and w.status in ('waiting','offered')
      limit 1
    )
  );
end;
$$;

grant execute on function public.ride_offer_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 21. Segment bazlı müsaitlik ve koltuk haritası
-- ---------------------------------------------------------------------
create or replace function public.ride_offer_availability(p_offer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_seats int;
  v_max_seq int;
  v_segments jsonb;
  v_seat_map jsonb;
begin
  select seats_total into v_seats from public.ride_offers where id = p_offer_id;
  select coalesce(max(seq), 1) into v_max_seq from public.ride_offer_stops where offer_id = p_offer_id;

  select coalesce(jsonb_agg(seg order by seg->>'from_seq'), '[]'::jsonb) into v_segments
  from (
    select jsonb_build_object(
      'from_seq', g.seq,
      'to_seq', g.seq + 1,
      'occupied', (
        select count(distinct a.seat_no)
        from public.ride_seat_allocations a
        where a.offer_id = p_offer_id
          and a.status in ('held','confirmed')
          and not (a.from_seq >= g.seq + 1 or a.to_seq <= g.seq)
      ),
      'available', v_seats - (
        select count(distinct a.seat_no)
        from public.ride_seat_allocations a
        where a.offer_id = p_offer_id
          and a.status in ('held','confirmed')
          and not (a.from_seq >= g.seq + 1 or a.to_seq <= g.seq)
      )
    ) as seg
    from generate_series(0, greatest(v_max_seq - 1, 0)) as g(seq)
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
    'seat_no', seat,
    'occupied', coalesce((
      select jsonb_agg(jsonb_build_object('from_seq', a.from_seq, 'to_seq', a.to_seq) order by a.from_seq)
      from public.ride_seat_allocations a
      where a.offer_id = p_offer_id and a.seat_no = seat and a.status in ('held','confirmed')
    ), '[]'::jsonb)
  ) order by seat), '[]'::jsonb) into v_seat_map
  from generate_series(1, greatest(v_seats, 1)) as seat;

  return jsonb_build_object(
    'seats_total', v_seats,
    'max_seq', v_max_seq,
    'segments', v_segments,
    'seats', v_seat_map
  );
end;
$$;

grant execute on function public.ride_offer_availability(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 22. Arama ve şeffaf eşleştirme puanı
-- ---------------------------------------------------------------------
create or replace function public.ride_search(
  p_scope text default null,
  p_mode text default null,
  p_origin_lat double precision default null,
  p_origin_lng double precision default null,
  p_dest_lat double precision default null,
  p_dest_lng double precision default null,
  p_origin_city text default null,
  p_dest_city text default null,
  p_depart_from timestamptz default null,
  p_depart_to timestamptz default null,
  p_seats int default 1,
  p_max_price_cents int default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total int;
begin
  with candidates as (
    select
      o.*,
      public.ride_haversine_m(p_origin_lat, p_origin_lng, o.origin_lat, o.origin_lng) as pickup_m,
      public.ride_haversine_m(p_dest_lat, p_dest_lng, o.dest_lat, o.dest_lng) as dropoff_m,
      abs(extract(epoch from (o.depart_at - coalesce(p_depart_from, o.depart_at))) / 60)::int as time_delta_min,
      (select count(distinct a.seat_no)
         from public.ride_seat_allocations a
        where a.offer_id = o.id and a.status in ('held','confirmed')) as occupied_seats
    from public.ride_offers o
    where o.status in ('published','full')
      and o.depart_at >= now() - interval '5 minutes'
      and (p_scope is null or p_scope = 'all' or o.scope = p_scope)
      and (p_mode is null or p_mode = 'all' or o.mode = p_mode)
      and (p_depart_from is null or o.depart_at >= p_depart_from - make_interval(mins => o.depart_flex_minutes))
      and (p_depart_to is null or o.depart_at <= p_depart_to + make_interval(mins => o.depart_flex_minutes))
      and (p_origin_city is null or o.origin_city ilike '%' || p_origin_city || '%')
      and (p_dest_city is null or o.dest_city ilike '%' || p_dest_city || '%')
      and (p_max_price_cents is null or o.price_per_seat_cents <= p_max_price_cents)
      and (
        o.visibility = 'public'
        or o.driver_id = v_uid
        or (o.visibility = 'friends' and exists (
          select 1 from public.friend_requests f
          where f.status = 'accepted'
            and ((f.sender_id = v_uid and f.receiver_id = o.driver_id)
              or (f.receiver_id = v_uid and f.sender_id = o.driver_id))
        ))
      )
      and ((p_filters->>'has_ac')::boolean is not true or o.preferences->>'ac' = 'true')
      and ((p_filters->>'no_smoking')::boolean is not true or coalesce((o.preferences->>'smoking')::boolean, false) = false)
      and ((p_filters->>'women_only')::boolean is not true or o.preferences->>'women_only' = 'true')
      and ((p_filters->>'accessible')::boolean is not true or coalesce((o.preferences->>'accessible_required')::boolean, false))
      and (
        o.driver_id = v_uid
        or public.ride_has_available_seats(o.id, 0, (select coalesce(max(seq),1) from public.ride_offer_stops s where s.offer_id = o.id), p_seats)
      )
  ), scored as (
    select c.*,
      case
        when c.pickup_m is null and c.dropoff_m is null then null
        else coalesce(c.pickup_m, 0) + coalesce(c.dropoff_m, 0)
      end as detour_m,
      v_m.level,
      v_m.rating_avg,
      v_m.completed_trips,
      case
        when c.pickup_m is null and c.dropoff_m is null then null
        else greatest(0, 100
          - least(coalesce(c.pickup_m, 0) / 1000 * 2, 35)
          - least(coalesce(c.dropoff_m, 0) / 1000 * 2, 35)
          - least(c.time_delta_min / 6.0, 20)
          + case v_m.level when 'platinum' then 8 when 'gold' then 6 when 'silver' then 4 else 2 end
          + coalesce(v_m.rating_avg, 0) * 2)
      end as score
    from candidates c
    left join public.ride_member_profiles v_m on v_m.user_id = c.driver_id
  )
  select coalesce(jsonb_agg(item order by (item->>'score')::numeric desc nulls last, (item->>'depart_at')), '[]'::jsonb),
         count(*)
  into v_items, v_total
  from (
    select jsonb_build_object(
      'id', s.id,
      'scope', s.scope,
      'mode', s.mode,
      'status', s.status,
      'origin_label', s.origin_label,
      'origin_city', s.origin_city,
      'origin_district', s.origin_district,
      'dest_label', s.dest_label,
      'dest_city', s.dest_city,
      'dest_district', s.dest_district,
      'depart_at', s.depart_at,
      'depart_flex_minutes', s.depart_flex_minutes,
      'duration_minutes', s.duration_minutes,
      'distance_meters', s.distance_meters,
      'price_per_seat_cents', s.price_per_seat_cents,
      'currency', s.currency,
      'seats_total', s.seats_total,
      'seats_available', s.seats_total - s.occupied_seats,
      'luggage', s.luggage,
      'preferences', s.preferences,
      'route_mode', s.route_mode,
      'booking_mode', s.booking_mode,
      'visibility', s.visibility,
      'driver', jsonb_build_object(
        'id', d.id,
        'username', d.username,
        'first_name', d.first_name,
        'avatar_path', d.avatar_path,
        'is_verified', d.is_verified,
        'level', s.level,
        'rating_avg', s.rating_avg,
        'completed_trips', s.completed_trips
      ),
      'vehicle', jsonb_build_object(
        'make', v.make, 'model', v.model, 'year', v.year,
        'color', v.color, 'has_ac', v.has_ac, 'accessibility', v.accessibility
      ),
      'match', jsonb_build_object(
        'score', round(s.score),
        'pickup_distance_m', round(s.pickup_m),
        'dropoff_distance_m', round(s.dropoff_m),
        'approx_detour_m', round(s.detour_m),
        'time_delta_min', s.time_delta_min,
        'reasons', jsonb_build_array(
          case when s.time_delta_min <= 30 then 'Kalkış saatine çok yakın' else 'Kalkış saati esnek' end,
          case when coalesce(s.pickup_m, 0) <= 3000 then 'Biniş noktasına yakın' else 'Biniş noktası sürüş mesafesinde' end,
          case when coalesce(s.detour_m, 0) <= 10000 then 'Düşük güzergâh sapması' else 'Sapma mesafesi hesaplandı' end,
          case when s.level in ('gold','platinum') then 'Yüksek güvenilirlik seviyesi' else 'Doğrulanmış üye' end
        )
      )
    ) as item
    from scored s
    join public.profiles d on d.id = s.driver_id
    join public.ride_vehicles v on v.id = s.vehicle_id
    where (p_filters->>'min_rating')::numeric is null
       or coalesce(s.rating_avg, 0) >= (p_filters->>'min_rating')::numeric
    order by (case when s.score is null then 0 else s.score end) desc, s.depart_at
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'map_available', false,
    'map_note', 'Harita görünümü için EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN yapılandırılmalı. Mesafeler koordinat varsa kuş uçuşu hesaplanır.'
  );
end;
$$;

grant execute on function public.ride_search(text, text, double precision, double precision, double precision, double precision, text, text, timestamptz, timestamptz, int, int, jsonb, int, int) to authenticated;

-- Segment bazlı boş koltuk kontrolü (rezervasyon ve arama ortak kullanır).
create or replace function public.ride_has_available_seats(
  p_offer_id uuid,
  p_from_seq int,
  p_to_seq int,
  p_seats int
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with used as (
    select distinct a.seat_no
    from public.ride_seat_allocations a
    where a.offer_id = p_offer_id
      and a.status in ('held','confirmed')
      and not (a.from_seq >= p_to_seq or a.to_seq <= p_from_seq)
  )
  select (
    select count(*)
    from generate_series(1, (select seats_total from public.ride_offers where id = p_offer_id)) as seat
    where seat not in (select seat_no from used)
  ) >= p_seats
$$;

grant execute on function public.ride_has_available_seats(uuid, int, int, int) to authenticated;
