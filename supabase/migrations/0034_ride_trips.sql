-- =====================================================================
-- 0034 — Yolculuk: rezervasyon, koltuk, canlı takip ve sosyal katman
--
-- Tüm kritik işlemler sunucuda yeniden yetkilendirilir. Koltuk tahsisi
-- PostgreSQL satır kilidi ile serileştirilir; aynı koltuğun aynı segmentte
-- iki kişiye verilmesi engellenir. Ödeme sağlayıcısı yapılandırılmadıkça
-- kartlı akış kapalıdır ve hiçbir ödeme "başarılı" sayılmaz.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 0. Platform iş kuralları (mevcut değerler ezilmez)
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, description_tr, is_public)
values
  ('ride.card_payments_enabled', 'false'::jsonb, 'Kartlı ödeme; ödeme kuruluşu yetkileri tamamlanınca açılır.', false),
  ('ride.commercial_enabled', 'false'::jsonb, 'Ticari taşımacılık; yasal izinler doğrulanana kadar kapalıdır.', false),
  ('ride.hold_minutes', '60'::jsonb, 'Manuel onay bekleyen rezervasyonun koltuk tutma süresi (dakika).', true),
  ('ride.cancel.free_hours_intracity', '1'::jsonb, 'Şehir içi ücretsiz iptal süresi (saat).', true),
  ('ride.cancel.free_hours_intercity', '4'::jsonb, 'Şehirler arası ücretsiz iptal süresi (saat).', true),
  ('ride.cost_per_km_cents', 'null'::jsonb, 'Yardımcı maliyet tahmini için km başına kuruş; boşsa tahmin gösterilmez.', true)
on conflict (key) do nothing;

create or replace function public.ride_setting(p_key text, p_default jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.app_settings where key = p_key), p_default)
$$;

revoke all on function public.ride_setting(text, jsonb) from public, anon, authenticated;

create or replace function public.ride_card_payments_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings
                   where key = 'ride.card_payments_enabled'), false)
$$;

revoke all on function public.ride_card_payments_enabled() from public, anon;
grant execute on function public.ride_card_payments_enabled() to authenticated;

-- ---------------------------------------------------------------------
-- 1. Düzenli yolculuk için ilan bağlantı alanları
-- ---------------------------------------------------------------------
alter table public.ride_recurring_schedules
  add column if not exists vehicle_id uuid references public.ride_vehicles (id) on delete set null,
  add column if not exists origin_lat double precision,
  add column if not exists origin_lng double precision,
  add column if not exists dest_lat double precision,
  add column if not exists dest_lng double precision,
  add column if not exists origin_district text,
  add column if not exists dest_district text,
  add column if not exists luggage text not null default 'medium',
  add column if not exists booking_mode text not null default 'manual',
  add column if not exists visibility text not null default 'public';

alter table public.ride_offers
  add column if not exists recurring_id uuid references public.ride_recurring_schedules (id) on delete set null,
  add column if not exists recurrence_date date;

create unique index if not exists ride_offers_recurring_date_key
  on public.ride_offers (recurring_id, recurrence_date)
  where recurring_id is not null;
create index if not exists ride_offers_recurring_idx
  on public.ride_offers (recurring_id) where recurring_id is not null;

-- ---------------------------------------------------------------------
-- 2. Yolcu talebi RPC'leri
-- ---------------------------------------------------------------------
create or replace function public.ride_create_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_scope text := coalesce(p_payload->>'scope', 'intracity');
  v_earliest timestamptz := (p_payload->>'earliest_depart')::timestamptz;
  v_latest timestamptz := (p_payload->>'latest_depart')::timestamptz;
  v_party int := coalesce((p_payload->>'party_size')::int, 1);
  v_id uuid;
  v_identity text;
begin
  perform public.ride_member_ensure(v_uid);
  select identity_status into v_identity from public.ride_member_profiles where user_id = v_uid;
  if v_identity <> 'approved' then
    raise exception 'identity_required' using errcode = '42501';
  end if;

  if v_scope not in ('intracity','intercity') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;
  if v_earliest is null or v_latest is null or v_latest < v_earliest or v_latest < now() then
    raise exception 'invalid_depart_window' using errcode = '22023';
  end if;
  if v_party < 1 or v_party > 8 then
    raise exception 'invalid_party_size' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_payload->>'origin_label',''))) < 2
     or char_length(trim(coalesce(p_payload->>'dest_label',''))) < 2 then
    raise exception 'invalid_route' using errcode = '22023';
  end if;

  insert into public.ride_requests (
    passenger_id, scope, origin_label, origin_city, origin_district, origin_lat, origin_lng,
    dest_label, dest_city, dest_district, dest_lat, dest_lng,
    earliest_depart, latest_depart, party_size, luggage, preferences, mandatory, notes, expires_at
  ) values (
    v_uid, v_scope,
    left(trim(p_payload->>'origin_label'), 120), left(trim(p_payload->>'origin_city'), 60),
    nullif(p_payload->>'origin_district',''),
    nullif(p_payload->>'origin_lat','')::double precision,
    nullif(p_payload->>'origin_lng','')::double precision,
    left(trim(p_payload->>'dest_label'), 120), left(trim(p_payload->>'dest_city'), 60),
    nullif(p_payload->>'dest_district',''),
    nullif(p_payload->>'dest_lat','')::double precision,
    nullif(p_payload->>'dest_lng','')::double precision,
    v_earliest, v_latest, v_party,
    coalesce(p_payload->>'luggage', 'medium'),
    coalesce(p_payload->'preferences', '{}'::jsonb),
    coalesce(p_payload->'mandatory', '[]'::jsonb),
    nullif(left(coalesce(p_payload->>'notes',''), 400), ''),
    least(greatest(v_latest + interval '1 day', now() + interval '1 day'), now() + interval '30 days')
  ) returning id into v_id;

  perform public.ride_audit(v_uid, 'request.create', 'ride_request', v_id::text,
    jsonb_build_object('scope', v_scope, 'party', v_party));

  return jsonb_build_object('id', v_id, 'status', 'open');
end;
$$;

grant execute on function public.ride_create_request(jsonb) to authenticated;

create or replace function public.ride_my_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'scope', r.scope, 'origin_label', r.origin_label, 'origin_city', r.origin_city,
      'dest_label', r.dest_label, 'dest_city', r.dest_city,
      'earliest_depart', r.earliest_depart, 'latest_depart', r.latest_depart,
      'party_size', r.party_size, 'luggage', r.luggage, 'preferences', r.preferences,
      'status', case when r.status = 'open' and r.expires_at < now() then 'expired' else r.status end,
      'notes', r.notes, 'created_at', r.created_at, 'expires_at', r.expires_at
    ) order by r.created_at desc)
    from public.ride_requests r where r.passenger_id = v_uid
  ), '[]'::jsonb));
end;
$$;

grant execute on function public.ride_my_requests() to authenticated;

create or replace function public.ride_close_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  update public.ride_requests set status = 'closed'
   where id = p_request_id and passenger_id = v_uid and status = 'open';
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.ride_close_request(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Rezervasyon oluşturma (segment + koltuk kilidi)
-- ---------------------------------------------------------------------
create or replace function public.ride_reserve(
  p_offer_id uuid,
  p_seats int default 1,
  p_pickup_seq int default null,
  p_dropoff_seq int default null,
  p_payment_method text default 'cash',
  p_passengers jsonb default '[]'::jsonb,
  p_seat_numbers int[] default null,
  p_idempotency_key text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_offer public.ride_offers%rowtype;
  v_identity text;
  v_from int;
  v_to int;
  v_max_seq int;
  v_seats int := coalesce(p_seats, 1);
  v_status text;
  v_reservation_id uuid;
  v_existing_id uuid;
  v_free_seats int[];
  v_selected int[] := '{}';
  v_i int := 0;
  v_total int;
  v_boarding text;
  v_alighting text;
  v_passenger jsonb;
  v_person_count int := 0;
  v_primary_name text;
  v_pickup_label text;
  v_dropoff_label text;
  v_hold_minutes int;
  v_payment_id uuid;
  v_depart_elapsed int;
begin
  select identity_status into v_identity from public.ride_member_profiles where user_id = v_uid;
  if v_identity is distinct from 'approved' then
    perform public.ride_member_ensure(v_uid);
    select identity_status into v_identity from public.ride_member_profiles where user_id = v_uid;
  end if;
  if v_identity is distinct from 'approved' then
    raise exception 'identity_required' using errcode = '42501';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing_id from public.ride_reservations
    where passenger_id = v_uid and idempotency_key = p_idempotency_key;
    if v_existing_id is not null then
      return jsonb_build_object('reservation', public.ride_reservation_json(v_existing_id), 'idempotent', true);
    end if;
  end if;

  if v_seats < 1 or v_seats > 8 then
    raise exception 'invalid_seat_count' using errcode = '22023';
  end if;
  if p_payment_method not in ('cash','card') then
    raise exception 'invalid_payment_method' using errcode = '22023';
  end if;
  if p_payment_method = 'card' and not public.ride_card_payments_enabled() then
    raise exception 'payments_disabled' using errcode = '42501';
  end if;

  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;
  if v_offer.driver_id = v_uid then
    raise exception 'cannot_reserve_own_offer' using errcode = '22023';
  end if;
  if v_offer.visibility = 'friends' and not exists (
    select 1 from public.friend_requests f
    where f.status = 'accepted'
      and ((f.sender_id = v_uid and f.receiver_id = v_offer.driver_id)
        or (f.receiver_id = v_uid and f.sender_id = v_offer.driver_id))
  ) then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;

  if public.is_blocked(v_uid, v_offer.driver_id) or public.is_blocked(v_offer.driver_id, v_uid) then
    raise exception 'blocked' using errcode = '42501';
  end if;

  if v_offer.status not in ('published','full','started') then
    raise exception 'offer_unavailable' using errcode = '22023';
  end if;

  select coalesce(max(seq), 1) into v_max_seq
  from public.ride_offer_stops where offer_id = p_offer_id;

  v_from := coalesce(p_pickup_seq, 0);
  v_to := coalesce(p_dropoff_seq, v_max_seq);

  if v_from < 0 or v_to > v_max_seq or v_to <= v_from then
    raise exception 'invalid_segment' using errcode = '22023';
  end if;

  if v_offer.status = 'started' then
    if v_offer.started_at is null then
      raise exception 'offer_unavailable' using errcode = '22023';
    end if;
    select arrive_offset_minutes into v_depart_elapsed
    from public.ride_offer_stops
    where offer_id = p_offer_id and seq = v_from;
    if coalesce(v_depart_elapsed, 0) <= extract(epoch from (now() - v_offer.started_at)) / 60 + 3 then
      raise exception 'segment_already_passed' using errcode = '22023';
    end if;
  elsif v_offer.depart_at < now() - interval '5 minutes' then
    raise exception 'offer_unavailable' using errcode = '22023';
  end if;

  if not public.ride_has_available_seats(p_offer_id, v_from, v_to, v_seats) then
    raise exception 'no_seats_available' using errcode = '22023';
  end if;

  -- Boş koltukları gerçek tahsis kayıtlarından hesapla.
  select array_agg(seat order by seat) into v_free_seats
  from generate_series(1, v_offer.seats_total) as seat
  where not exists (
    select 1 from public.ride_seat_allocations a
    where a.offer_id = p_offer_id
      and a.seat_no = seat
      and a.status in ('held','confirmed')
      and not (a.from_seq >= v_to or a.to_seq <= v_from)
  );

  if p_seat_numbers is not null and array_length(p_seat_numbers, 1) > 0 then
    if array_length(p_seat_numbers, 1) <> v_seats then
      raise exception 'seat_count_mismatch' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_seat_numbers) s where s <> all(coalesce(v_free_seats, '{}'::int[]))) then
      raise exception 'seat_unavailable' using errcode = '22023';
    end if;
    v_selected := p_seat_numbers;
  else
    if coalesce(array_length(v_free_seats, 1), 0) < v_seats then
      raise exception 'no_seats_available' using errcode = '22023';
    end if;
    for v_i in 1..v_seats loop
      v_selected := array_append(v_selected, v_free_seats[v_i]);
    end loop;
  end if;

  select label into v_pickup_label from public.ride_offer_stops where offer_id = p_offer_id and seq = v_from;
  select label into v_dropoff_label from public.ride_offer_stops where offer_id = p_offer_id and seq = v_to;

  v_status := case when v_offer.booking_mode = 'auto' then 'confirmed' else 'requested' end;
  v_total := v_offer.price_per_seat_cents * v_seats;
  v_boarding := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_alighting := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_hold_minutes := coalesce((public.ride_setting('ride.hold_minutes', '60'::jsonb) #>> '{}')::int, 60);

  insert into public.ride_reservations (
    offer_id, passenger_id, status, seats, total_cents, currency,
    pickup_seq, dropoff_seq, pickup_label, dropoff_label,
    boarding_code, alighting_code, payment_method, payment_status,
    hold_expires_at, policy_version, idempotency_key, note, started_at
  ) values (
    p_offer_id, v_uid, v_status, v_seats, v_total, v_offer.currency,
    v_from, v_to, v_pickup_label, v_dropoff_label,
    v_boarding, v_alighting, p_payment_method, 'unpaid',
    case when v_status = 'requested' then now() + make_interval(mins => v_hold_minutes) else null end,
    v_offer.policy_version, p_idempotency_key, nullif(left(coalesce(p_note,''), 400), ''),
    case when v_offer.status = 'started' then now() else null end
  ) returning id into v_reservation_id;

  insert into public.ride_seat_allocations (offer_id, reservation_id, seat_no, from_seq, to_seq, status)
  select p_offer_id, v_reservation_id, s, v_from, v_to,
         case when v_status = 'confirmed' then 'confirmed' else 'held' end
  from unnest(v_selected) as s;

  -- Yolcu listesi: grup rezervasyonunda her koltuk için bir kayıt.
  select count(*) into v_person_count from jsonb_array_elements(coalesce(p_passengers, '[]'::jsonb));
  if v_person_count = 0 then
    select coalesce(nullif(trim(first_name || ' ' || last_name), ''), username::text)
    into v_primary_name from public.profiles where id = v_uid;

    insert into public.ride_reservation_passengers (reservation_id, user_id, full_name, seat_no, is_primary)
    values (v_reservation_id, v_uid, coalesce(v_primary_name, 'Yolcu'), v_selected[1], true);
  else
    if v_person_count <> v_seats then
      raise exception 'passenger_count_mismatch' using errcode = '22023';
    end if;
    v_i := 0;
    for v_passenger in select * from jsonb_array_elements(p_passengers) loop
      v_i := v_i + 1;
      insert into public.ride_reservation_passengers (reservation_id, user_id, full_name, seat_no, is_primary)
      values (
        v_reservation_id,
        case when v_i = 1 then v_uid else nullif(v_passenger->>'user_id','')::uuid end,
        left(coalesce(nullif(trim(v_passenger->>'full_name'), ''), 'Yolcu'), 80),
        v_selected[v_i],
        v_i = 1
      );
    end loop;
  end if;

  insert into public.ride_policy_acceptances (user_id, policy_key, policy_version, reservation_id)
  values (v_uid, 'ride_participation', v_offer.policy_version, v_reservation_id)
  on conflict do nothing;

  if p_payment_method = 'card' then
    insert into public.ride_payments (
      reservation_id, payer_id, provider, amount_cents, currency, status, idempotency_key
    ) values (
      v_reservation_id, v_uid, 'stripe', v_total, v_offer.currency, 'created',
      coalesce(p_idempotency_key, v_reservation_id::text)
    ) returning id into v_payment_id;
  end if;

  perform public.tz_notify(
    v_offer.driver_id, v_uid, 'ride',
    case when v_status = 'confirmed' then 'Yeni rezervasyon' else 'Yeni rezervasyon talebi' end,
    case when v_status = 'confirmed'
      then v_seats::text || ' koltuk rezerve edildi. Yolculuk: ' || v_offer.origin_label || ' → ' || v_offer.dest_label
      else v_seats::text || ' koltuk için onay bekliyor. Yolculuk: ' || v_offer.origin_label || ' → ' || v_offer.dest_label
    end,
    'ride_offer', v_offer.id::text, '/ride/offers/' || v_offer.id::text
  );

  perform public.tz_notify(
    v_uid, NULL, 'ride',
    case when v_status = 'confirmed' then 'Rezervasyonun onaylandı' else 'Talebin sürücüye iletildi' end,
    v_offer.origin_label || ' → ' || v_offer.dest_label || ' · ' || to_char(v_offer.depart_at, 'DD.MM HH24:MI'),
    'ride_reservation', v_reservation_id::text, '/ride/trips/' || v_reservation_id::text
  );

  perform public.ride_audit(v_uid, 'reservation.create', 'ride_reservation', v_reservation_id::text,
    jsonb_build_object('offer_id', p_offer_id, 'seats', v_seats, 'status', v_status,
                       'from_seq', v_from, 'to_seq', v_to, 'payment_method', p_payment_method));

  return jsonb_build_object(
    'reservation', public.ride_reservation_json(v_reservation_id),
    'payment_required', p_payment_method = 'card',
    'payment_id', v_payment_id
  );
end;
$$;

grant execute on function public.ride_reserve(uuid, int, int, int, text, jsonb, int[], text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Rezervasyon yanıtı, iptal, biniş ve iniş
-- ---------------------------------------------------------------------
create or replace function public.ride_reservation_respond(
  p_reservation_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
begin
  select * into v_r from public.ride_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;

  select * into v_offer from public.ride_offers where id = v_r.offer_id;
  if v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_r.status in ('confirmed','completed','started') then
    return jsonb_build_object('reservation', public.ride_reservation_json(v_r.id), 'idempotent', true);
  end if;
  if v_r.status not in ('requested','awaiting_approval') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  if coalesce(p_approve, false) then
    update public.ride_reservations
       set status = 'confirmed', driver_responded_at = now(), hold_expires_at = null
     where id = v_r.id;
    update public.ride_seat_allocations set status = 'confirmed'
     where reservation_id = v_r.id and status = 'held';

    perform public.tz_notify(
      v_r.passenger_id, v_uid, 'ride', 'Rezervasyonun onaylandı',
      v_offer.origin_label || ' → ' || v_offer.dest_label || ' · ' || to_char(v_offer.depart_at, 'DD.MM HH24:MI'),
      'ride_reservation', v_r.id::text, '/ride/trips/' || v_r.id::text
    );
  else
    update public.ride_reservations
       set status = 'rejected', driver_responded_at = now(), hold_expires_at = null,
           cancel_reason = nullif(left(coalesce(p_reason,''), 300), '')
     where id = v_r.id;
    update public.ride_seat_allocations set status = 'released' where reservation_id = v_r.id;

    perform public.tz_notify(
      v_r.passenger_id, v_uid, 'ride', 'Rezervasyon talebin onaylanmadı',
      coalesce(nullif(p_reason,''), 'Sürücü bu talebi kabul etmedi. Başka bir yolculuk deneyebilirsin.'),
      'ride_reservation', v_r.id::text, '/ride/trips/' || v_r.id::text
    );
    perform public.ride_waitlist_promote(v_r.offer_id);
  end if;

  perform public.ride_audit(v_uid,
    case when coalesce(p_approve,false) then 'reservation.approve' else 'reservation.reject' end,
    'ride_reservation', v_r.id::text, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('reservation', public.ride_reservation_json(v_r.id));
end;
$$;

grant execute on function public.ride_reservation_respond(uuid, boolean, text) to authenticated;

create or replace function public.ride_reservation_cancel(
  p_reservation_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
  v_is_passenger boolean;
  v_is_driver boolean;
  v_hours numeric;
  v_free_hours numeric;
  v_late boolean;
  v_refund int := 0;
  v_refund_status text := null;
  v_payment public.ride_payments%rowtype;
begin
  select * into v_r from public.ride_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;

  select * into v_offer from public.ride_offers where id = v_r.offer_id;
  v_is_passenger := v_r.passenger_id = v_uid;
  v_is_driver := v_offer.driver_id = v_uid;

  if not v_is_passenger and not v_is_driver then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_r.status in ('cancelled','rejected','expired','completed') then
    return jsonb_build_object('reservation', public.ride_reservation_json(v_r.id), 'idempotent', true);
  end if;
  if v_r.status = 'started' or v_offer.status = 'started' then
    raise exception 'trip_already_started' using errcode = '22023';
  end if;

  v_hours := extract(epoch from (v_offer.depart_at - now())) / 3600;
  v_free_hours := coalesce(
    (public.ride_setting(
      case when v_offer.scope = 'intercity' then 'ride.cancel.free_hours_intercity'
           else 'ride.cancel.free_hours_intracity' end,
      '1'::jsonb) #>> '{}')::numeric,
    1
  );
  v_late := v_hours < v_free_hours;

  update public.ride_reservations
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
         cancel_reason = nullif(left(coalesce(p_reason,''), 300), ''), hold_expires_at = null
   where id = v_r.id;

  update public.ride_seat_allocations set status = 'released' where reservation_id = v_r.id;

  if v_r.payment_status = 'paid' then
    v_refund := case
      when v_is_driver then v_r.total_cents
      when v_late then 0
      else v_r.total_cents
    end;
    if v_refund > 0 then
      select * into v_payment from public.ride_payments
      where reservation_id = v_r.id and status in ('succeeded','authorized')
      order by created_at desc limit 1;
      insert into public.ride_refunds (
        reservation_id, payment_id, amount_cents, reason, status, requested_by
      ) values (
        v_r.id, v_payment.id, v_refund,
        case when v_is_driver then 'driver_cancelled' when v_late then 'late_cancellation' else 'passenger_cancelled' end,
        'requested', v_uid
      );
      v_refund_status := 'requested';
    end if;
  end if;

  perform public.tz_notify(
    case when v_is_passenger then v_offer.driver_id else v_r.passenger_id end,
    v_uid, 'ride', 'Rezervasyon iptal edildi',
    v_offer.origin_label || ' → ' || v_offer.dest_label || ' · ' || to_char(v_offer.depart_at, 'DD.MM HH24:MI'),
    'ride_reservation', v_r.id::text, '/ride/trips/' || v_r.id::text
  );

  perform public.ride_waitlist_promote(v_r.offer_id);
  perform public.ride_audit(v_uid, 'reservation.cancel', 'ride_reservation', v_r.id::text,
    jsonb_build_object('late', v_late, 'refund_cents', v_refund, 'by', case when v_is_driver then 'driver' else 'passenger' end));

  return jsonb_build_object(
    'reservation', public.ride_reservation_json(v_r.id),
    'late_cancel', v_late,
    'free_cancel_hours', v_free_hours,
    'refund_cents', v_refund,
    'refund_status', v_refund_status
  );
end;
$$;

grant execute on function public.ride_reservation_cancel(uuid, text) to authenticated;

create or replace function public.ride_offer_start(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_offer public.ride_offers%rowtype;
  v_identity text;
  v_driver text;
  v_vehicle_status text;
  v_vehicle_active boolean;
  v_session_id uuid;
begin
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;
  if v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_offer.status = 'started' then
    return jsonb_build_object('offer_id', v_offer.id, 'status', 'started', 'idempotent', true);
  end if;
  if v_offer.status not in ('published','full') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if now() < v_offer.depart_at - interval '30 minutes' then
    raise exception 'too_early_to_start' using errcode = '22023';
  end if;

  select identity_status, driver_status into v_identity, v_driver
  from public.ride_member_profiles where user_id = v_uid;
  select status, is_active into v_vehicle_status, v_vehicle_active
  from public.ride_vehicles where id = v_offer.vehicle_id;

  if v_identity <> 'approved' or v_driver <> 'approved' or v_vehicle_status <> 'approved' or not v_vehicle_active then
    raise exception 'verification_required' using errcode = '42501';
  end if;

  update public.ride_offers
     set status = 'started', started_at = now()
   where id = p_offer_id;

  update public.ride_reservations
     set status = 'started', started_at = now()
   where offer_id = p_offer_id and status = 'confirmed';

  insert into public.ride_tracking_sessions (offer_id, driver_id, status)
  values (p_offer_id, v_uid, 'active')
  returning id into v_session_id;

  perform public.tz_notify(r.passenger_id, v_uid, 'ride', 'Yolculuk başladı',
    'Sürücü yolculuğu başlattı. Güvenli yolculuklar dileriz.',
    'ride_offer', p_offer_id::text, '/ride/offers/' || p_offer_id::text)
  from public.ride_reservations r
  where r.offer_id = p_offer_id and r.status = 'started';

  perform public.ride_audit(v_uid, 'offer.start', 'ride_offer', p_offer_id::text,
    jsonb_build_object('tracking_session', v_session_id));

  return jsonb_build_object('offer_id', p_offer_id, 'status', 'started', 'tracking_session_id', v_session_id);
end;
$$;

grant execute on function public.ride_offer_start(uuid) to authenticated;

create or replace function public.ride_reservation_board(
  p_reservation_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
begin
  select * into v_r from public.ride_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  select * into v_offer from public.ride_offers where id = v_r.offer_id;
  if v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_r.status not in ('confirmed','started') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if v_r.boarded_at is not null then
    return jsonb_build_object('reservation', public.ride_reservation_json(v_r.id), 'idempotent', true);
  end if;
  if trim(coalesce(p_code,'')) <> v_r.boarding_code then
    raise exception 'invalid_boarding_code' using errcode = '22023';
  end if;

  update public.ride_reservations set boarded_at = now() where id = v_r.id;
  update public.ride_reservation_passengers set boarded_at = now()
   where reservation_id = v_r.id and boarded_at is null and is_primary;

  perform public.tz_notify(v_r.passenger_id, v_uid, 'ride', 'Biniş doğrulandı',
    'Biniş kodun sürücü tarafından doğrulandı.', 'ride_reservation', v_r.id::text,
    '/ride/trips/' || v_r.id::text);

  perform public.ride_audit(v_uid, 'reservation.board', 'ride_reservation', v_r.id::text, '{}'::jsonb);
  return jsonb_build_object('reservation', public.ride_reservation_json(v_r.id));
end;
$$;

grant execute on function public.ride_reservation_board(uuid, text) to authenticated;

create or replace function public.ride_reservation_alight(
  p_reservation_id uuid,
  p_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
begin
  select * into v_r from public.ride_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  select * into v_offer from public.ride_offers where id = v_r.offer_id;
  if v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_r.status <> 'started' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if v_r.alighted_at is not null then
    return jsonb_build_object('reservation', public.ride_reservation_json(v_r.id), 'idempotent', true);
  end if;
  if trim(coalesce(p_code,'')) <> v_r.alighting_code then
    raise exception 'invalid_alighting_code' using errcode = '22023';
  end if;

  update public.ride_reservations set alighted_at = now() where id = v_r.id;
  update public.ride_reservation_passengers set alighted_at = now() where reservation_id = v_r.id;
  -- Koltuk, iniş noktasından sonraki segmentlerde yeniden kullanılabilir.
  update public.ride_seat_allocations set status = 'released' where reservation_id = v_r.id;

  perform public.ride_waitlist_promote(v_r.offer_id);
  perform public.ride_audit(v_uid, 'reservation.alight', 'ride_reservation', v_r.id::text,
    jsonb_build_object('seat_released', true));

  return jsonb_build_object('reservation', public.ride_reservation_json(v_r.id), 'seat_released', true);
end;
$$;

grant execute on function public.ride_reservation_alight(uuid, text) to authenticated;

create or replace function public.ride_offer_complete(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_offer public.ride_offers%rowtype;
  v_passenger record;
begin
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;
  if v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_offer.status = 'completed' then
    return jsonb_build_object('offer_id', p_offer_id, 'status', 'completed', 'idempotent', true);
  end if;
  if v_offer.status <> 'started' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  update public.ride_offers set status = 'completed', completed_at = now() where id = p_offer_id;
  update public.ride_reservations
     set status = 'completed', completed_at = now(),
         alighted_at = coalesce(alighted_at, now())
   where offer_id = p_offer_id and status in ('confirmed','started');
  update public.ride_seat_allocations a set status = 'released'
   from public.ride_reservations r
   where a.reservation_id = r.id and r.offer_id = p_offer_id;

  update public.ride_tracking_sessions
     set status = 'ended', ended_at = now()
   where offer_id = p_offer_id and status = 'active';

  for v_passenger in
    select r.passenger_id from public.ride_reservations r
    where r.offer_id = p_offer_id and r.status = 'completed'
  loop
    perform public.ride_recompute_reputation(v_passenger.passenger_id);
  end loop;
  perform public.ride_recompute_reputation(v_uid);

  perform public.tz_notify(r.passenger_id, v_uid, 'ride', 'Yolculuk tamamlandı',
    'Yolculuğun tamamlandı. Deneyimini değerlendirerek diğer yolculara yardımcı olabilirsin.',
    'ride_reservation', r.id::text, '/ride/trips/' || r.id::text)
  from public.ride_reservations r
  where r.offer_id = p_offer_id and r.status = 'completed';

  perform public.ride_audit(v_uid, 'offer.complete', 'ride_offer', p_offer_id::text, '{}'::jsonb);
  return jsonb_build_object('offer_id', p_offer_id, 'status', 'completed');
end;
$$;

grant execute on function public.ride_offer_complete(uuid) to authenticated;

create or replace function public.ride_offer_cancel(
  p_offer_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_offer public.ride_offers%rowtype;
  v_r record;
  v_refunds int := 0;
  v_affected int := 0;
  v_payment public.ride_payments%rowtype;
begin
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;
  if v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_offer.status = 'cancelled' then
    return jsonb_build_object('offer_id', p_offer_id, 'status', 'cancelled', 'idempotent', true);
  end if;
  if v_offer.status = 'started' then
    raise exception 'trip_already_started' using errcode = '22023';
  end if;
  if v_offer.status = 'completed' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  update public.ride_offers
     set status = 'cancelled', cancelled_at = now(),
         cancel_reason = nullif(left(coalesce(p_reason,''), 300), '')
   where id = p_offer_id;

  for v_r in
    select * from public.ride_reservations
    where offer_id = p_offer_id and status in ('requested','awaiting_approval','confirmed')
    for update
  loop
    update public.ride_reservations
       set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
           cancel_reason = 'driver_cancelled_offer'
     where id = v_r.id;
    update public.ride_seat_allocations set status = 'released' where reservation_id = v_r.id;

    if v_r.payment_status = 'paid' then
      select * into v_payment from public.ride_payments
      where reservation_id = v_r.id and status in ('succeeded','authorized')
      order by created_at desc limit 1;
      insert into public.ride_refunds (reservation_id, payment_id, amount_cents, reason, status, requested_by)
      values (v_r.id, v_payment.id, v_r.total_cents, 'driver_cancelled', 'requested', v_uid);
      v_refunds := v_refunds + 1;
    end if;

    perform public.tz_notify(v_r.passenger_id, v_uid, 'ride', 'Yolculuk iptal edildi',
      v_offer.origin_label || ' → ' || v_offer.dest_label || ' sürücü tarafından iptal edildi.',
      'ride_offer', p_offer_id::text, '/ride/trips/' || v_r.id::text);
    v_affected := v_affected + 1;
  end loop;

  update public.ride_waitlists set status = 'expired', updated_at = now()
   where offer_id = p_offer_id and status in ('waiting','offered');

  perform public.ride_audit(v_uid, 'offer.cancel', 'ride_offer', p_offer_id::text,
    jsonb_build_object('affected', v_affected, 'refunds', v_refunds, 'reason', p_reason));

  return jsonb_build_object('offer_id', p_offer_id, 'status', 'cancelled',
    'affected_reservations', v_affected, 'refund_requests', v_refunds);
end;
$$;

grant execute on function public.ride_offer_cancel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Süresi dolan koltuk tutmaları
-- ---------------------------------------------------------------------
create or replace function public.ride_expire_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_count int := 0;
begin
  for v_r in
    select * from public.ride_reservations
    where status in ('requested','awaiting_approval')
      and hold_expires_at is not null and hold_expires_at < now()
    for update skip locked
  loop
    update public.ride_reservations set status = 'expired', hold_expires_at = null where id = v_r.id;
    update public.ride_seat_allocations set status = 'released' where reservation_id = v_r.id;
    perform public.ride_waitlist_promote(v_r.offer_id);
    perform public.tz_notify(v_r.passenger_id, NULL, 'ride', 'Rezervasyon talebinin süresi doldu',
      'Sürücü zamanında yanıt vermediği için koltuk tutma süresi sona erdi. Yolculuğu yeniden deneyebilirsin.',
      'ride_reservation', v_r.id::text, '/ride/trips/' || v_r.id::text);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ride_expire_holds() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Bekleme listesi
-- ---------------------------------------------------------------------
create or replace function public.ride_waitlist_join(
  p_offer_id uuid,
  p_seats int default 1,
  p_pickup_seq int default 0,
  p_dropoff_seq int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_offer public.ride_offers%rowtype;
  v_max_seq int;
  v_to int;
  v_id uuid;
  v_position int;
begin
  select * into v_offer from public.ride_offers where id = p_offer_id;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;
  if v_offer.driver_id = v_uid then
    raise exception 'cannot_join_own_offer' using errcode = '22023';
  end if;
  select coalesce(max(seq),1) into v_max_seq from public.ride_offer_stops where offer_id = p_offer_id;
  v_to := coalesce(p_dropoff_seq, v_max_seq);
  if p_pickup_seq < 0 or v_to > v_max_seq or v_to <= p_pickup_seq then
    raise exception 'invalid_segment' using errcode = '22023';
  end if;
  if public.ride_has_available_seats(p_offer_id, p_pickup_seq, v_to, coalesce(p_seats,1)) then
    raise exception 'seats_available' using errcode = '22023';
  end if;

  insert into public.ride_waitlists (offer_id, user_id, seats, pickup_seq, dropoff_seq)
  values (p_offer_id, v_uid, coalesce(p_seats,1), p_pickup_seq, v_to)
  on conflict (offer_id, user_id) where status in ('waiting','offered')
  do update set seats = excluded.seats, pickup_seq = excluded.pickup_seq,
                dropoff_seq = excluded.dropoff_seq, updated_at = now()
  returning id into v_id;

  select count(*) into v_position
  from public.ride_waitlists w
  where w.offer_id = p_offer_id and w.status = 'waiting' and w.created_at <= now();

  perform public.ride_audit(v_uid, 'waitlist.join', 'ride_waitlist', v_id::text,
    jsonb_build_object('offer_id', p_offer_id, 'seats', p_seats));
  return jsonb_build_object('id', v_id, 'status', 'waiting', 'position', v_position);
end;
$$;

grant execute on function public.ride_waitlist_join(uuid, int, int, int) to authenticated;

create or replace function public.ride_waitlist_leave(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  update public.ride_waitlists set status = 'left', updated_at = now()
   where offer_id = p_offer_id and user_id = v_uid and status in ('waiting','offered');
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.ride_waitlist_leave(uuid) to authenticated;

create or replace function public.ride_waitlist_promote(p_offer_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w record;
  v_count int := 0;
  v_offer public.ride_offers%rowtype;
begin
  select * into v_offer from public.ride_offers where id = p_offer_id;
  if not found or v_offer.status not in ('published','full','started') then
    return 0;
  end if;

  for v_w in
    select * from public.ride_waitlists
    where offer_id = p_offer_id and status = 'waiting'
    order by created_at
    limit 5
  loop
    if public.ride_has_available_seats(p_offer_id, v_w.pickup_seq, v_w.dropoff_seq, v_w.seats) then
      insert into public.ride_waitlist_offers (waitlist_id, offer_id)
      values (v_w.id, p_offer_id);
      update public.ride_waitlists set status = 'offered', updated_at = now() where id = v_w.id;

      perform public.tz_notify(v_w.user_id, NULL, 'ride', 'Koltuk açıldı',
        v_offer.origin_label || ' → ' || v_offer.dest_label || ' için beklediğin koltuk açıldı. 20 dakika içinde onayla.',
        'ride_offer', p_offer_id::text, '/ride/offers/' || p_offer_id::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ride_waitlist_promote(uuid) from public, anon, authenticated;

create or replace function public.ride_waitlist_accept(p_waitlist_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_o public.ride_waitlist_offers%rowtype;
  v_w public.ride_waitlists%rowtype;
  v_result jsonb;
  v_reservation_id uuid;
begin
  select * into v_o from public.ride_waitlist_offers where id = p_waitlist_offer_id for update;
  if not found then
    raise exception 'waitlist_offer_not_found' using errcode = 'P0002';
  end if;
  select * into v_w from public.ride_waitlists where id = v_o.waitlist_id for update;
  if v_w.user_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_o.status <> 'offered' or v_o.expires_at < now() then
    raise exception 'waitlist_offer_expired' using errcode = '22023';
  end if;

  v_result := public.ride_reserve(
    v_w.offer_id, v_w.seats, v_w.pickup_seq, v_w.dropoff_seq, 'cash',
    '[]'::jsonb, null, 'waitlist:' || v_o.id::text, 'Bekleme listesinden onaylandı'
  );
  v_reservation_id := (v_result->'reservation'->>'id')::uuid;

  update public.ride_waitlist_offers set status = 'accepted' where id = v_o.id;
  update public.ride_waitlists set status = 'converted', updated_at = now() where id = v_w.id;

  perform public.ride_audit(v_uid, 'waitlist.accept', 'ride_reservation', v_reservation_id::text,
    jsonb_build_object('waitlist_offer', v_o.id));

  return jsonb_build_object('reservation', v_result->'reservation', 'reservation_id', v_reservation_id);
end;
$$;

grant execute on function public.ride_waitlist_accept(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Güzergâh/maliyet yardımcıları
-- ---------------------------------------------------------------------
create or replace function public.ride_price_hint(
  p_distance_m integer,
  p_seats integer default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cost_per_km numeric := nullif(public.ride_setting('ride.cost_per_km_cents', 'null'::jsonb) #>> '{}', '')::numeric;
  v_km numeric;
  v_total numeric;
  v_per_seat numeric;
begin
  if p_distance_m is null or p_distance_m <= 0 then
    return jsonb_build_object('available', false, 'reason', 'Mesafe bilgisi yok. Güzergâh koordinatları girilmedi.');
  end if;
  if v_cost_per_km is null then
    return jsonb_build_object(
      'available', false,
      'reason', 'Yönetici maliyet ayarını (km başına kuruş) tanımlamadığı için tahmin üretilmedi.'
    );
  end if;
  v_km := p_distance_m / 1000.0;
  v_total := v_km * v_cost_per_km;
  v_per_seat := ceil(v_total / greatest(coalesce(p_seats, 3), 1));
  return jsonb_build_object(
    'available', true,
    'distance_km', round(v_km, 1),
    'estimated_cost_cents', round(v_total)::int,
    'per_seat_cents', v_per_seat::int,
    'suggested_min_cents', floor(v_per_seat * 0.85)::int,
    'suggested_max_cents', ceil(v_per_seat * 1.15)::int,
    'formula', 'mesafe_km × km_başına_maliyet ÷ koltuk_sayısı',
    'note', 'Bu bir yardımcı maliyet tahminidir; yasal fiyat sınırı değildir.'
  );
end;
$$;

grant execute on function public.ride_price_hint(int, int) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Rezervasyon listeleri
-- ---------------------------------------------------------------------
create or replace function public.ride_my_trips(p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(public.ride_reservation_json(r.id) order by o.depart_at desc)
    from public.ride_reservations r
    join public.ride_offers o on o.id = r.offer_id
    where r.passenger_id = v_uid
      and (p_status is null or p_status = 'all'
        or (p_status = 'upcoming' and r.status in ('requested','awaiting_approval','confirmed') and o.depart_at >= now())
        or (p_status = 'active' and r.status = 'started')
        or (p_status = 'completed' and r.status = 'completed')
        or (p_status = 'cancelled' and r.status in ('cancelled','rejected','expired')))
  ), '[]'::jsonb));
end;
$$;

grant execute on function public.ride_my_trips(text) to authenticated;

create or replace function public.ride_my_offers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(item order by item->>'depart_at' desc)
    from (
      select jsonb_build_object(
        'id', o.id, 'scope', o.scope, 'mode', o.mode, 'status', o.status,
        'origin_label', o.origin_label, 'dest_label', o.dest_label,
        'depart_at', o.depart_at, 'seats_total', o.seats_total,
        'price_per_seat_cents', o.price_per_seat_cents, 'currency', o.currency,
        'booking_mode', o.booking_mode, 'visibility', o.visibility,
        'distance_meters', o.distance_meters,
        'requested_count', (select count(*) from public.ride_reservations r
          where r.offer_id = o.id and r.status = 'requested'),
        'confirmed_count', (select count(*) from public.ride_reservations r
          where r.offer_id = o.id and r.status in ('confirmed','started')),
        'availability', public.ride_offer_availability(o.id)
      ) as item
      from public.ride_offers o
      where o.driver_id = v_uid
    ) q
  ), '[]'::jsonb));
end;
$$;

grant execute on function public.ride_my_offers() to authenticated;

create or replace function public.ride_offer_reservations(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_driver uuid;
begin
  select driver_id into v_driver from public.ride_offers where id = p_offer_id;
  if v_driver is null or v_driver <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(public.ride_reservation_json(r.id) order by r.created_at)
    from public.ride_reservations r where r.offer_id = p_offer_id
  ), '[]'::jsonb));
end;
$$;

grant execute on function public.ride_offer_reservations(uuid) to authenticated;

create or replace function public.ride_trip_detail(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
begin
  select * into v_r from public.ride_reservations where id = p_reservation_id;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  select * into v_offer from public.ride_offers where id = v_r.offer_id;
  if v_r.passenger_id <> v_uid and v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'reservation', public.ride_reservation_json(v_r.id),
    'is_driver', v_offer.driver_id = v_uid,
    'policy', public.ride_policy(),
    'tracking', case when v_offer.status = 'started' then public.ride_tracking_snapshot(v_offer.id) else null end
  );
end;
$$;

grant execute on function public.ride_trip_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Canlı takip
-- ---------------------------------------------------------------------
create or replace function public.ride_distance_to_line_m(
  p_lat double precision, p_lng double precision,
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
)
returns double precision
language plpgsql
immutable
as $$
declare
  v_dx double precision;
  v_dy double precision;
  v_t double precision;
  v_lat double precision;
  v_lng double precision;
begin
  if p_lat is null or p_lat1 is null or p_lat2 is null then
    return null;
  end if;
  v_dx := p_lng2 - p_lng1;
  v_dy := p_lat2 - p_lat1;
  if v_dx = 0 and v_dy = 0 then
    return public.ride_haversine_m(p_lat, p_lng, p_lat1, p_lng1);
  end if;
  v_t := ((p_lng - p_lng1) * v_dx + (p_lat - p_lat1) * v_dy) / (v_dx * v_dx + v_dy * v_dy);
  v_t := greatest(0, least(1, v_t));
  v_lng := p_lng1 + v_t * v_dx;
  v_lat := p_lat1 + v_t * v_dy;
  return public.ride_haversine_m(p_lat, p_lng, v_lat, v_lng);
end;
$$;

revoke all on function public.ride_distance_to_line_m(double precision, double precision, double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.ride_distance_to_line_m(double precision, double precision, double precision, double precision, double precision, double precision) to authenticated;

create or replace function public.ride_tracking_snapshot(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_s public.ride_tracking_sessions%rowtype;
  v_offer public.ride_offers%rowtype;
  v_remaining double precision;
  v_eta numeric;
begin
  if not public.ride_is_participant(p_offer_id, v_uid) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_offer from public.ride_offers where id = p_offer_id;
  select * into v_s from public.ride_tracking_sessions
  where offer_id = p_offer_id and status = 'active' order by started_at desc limit 1;

  if not found or v_s.last_lat is null then
    return jsonb_build_object('active', false, 'note', 'Sürücü henüz konum paylaşmadı.');
  end if;

  v_remaining := public.ride_haversine_m(v_s.last_lat, v_s.last_lng, v_offer.dest_lat, v_offer.dest_lng);
  if v_s.last_speed_kmh is not null and v_s.last_speed_kmh > 3 then
    v_eta := round((v_remaining / 1000.0) / v_s.last_speed_kmh * 60);
  end if;

  return jsonb_build_object(
    'active', true,
    'lat', round(v_s.last_lat::numeric, 5)::double precision,
    'lng', round(v_s.last_lng::numeric, 5)::double precision,
    'heading', v_s.last_heading,
    'speed_kmh', v_s.last_speed_kmh,
    'updated_at', v_s.last_update_at,
    'remaining_meters', round(v_remaining),
    'eta_minutes', v_eta,
    'eta_note', case when v_eta is null then 'Hız bilgisi gelmediği için varış tahmini hesaplanamadı.'
                     else 'Son ölçülen hıza göre kuş uçuşu tahmindir.' end
  );
end;
$$;

grant execute on function public.ride_tracking_snapshot(uuid) to authenticated;

create or replace function public.ride_track_position(
  p_offer_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_heading double precision default null,
  p_speed_kmh double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_offer public.ride_offers%rowtype;
  v_session uuid;
  v_deviation double precision;
  v_threshold double precision;
  v_incident boolean := false;
begin
  select * into v_offer from public.ride_offers where id = p_offer_id;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;
  if v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_offer.status <> 'started' then
    raise exception 'trip_not_started' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid_location' using errcode = '22023';
  end if;

  select id into v_session from public.ride_tracking_sessions
  where offer_id = p_offer_id and status = 'active' limit 1;
  if v_session is null then
    insert into public.ride_tracking_sessions (offer_id, driver_id, status)
    values (p_offer_id, v_uid, 'active') returning id into v_session;
  end if;

  update public.ride_tracking_sessions
     set last_lat = p_lat, last_lng = p_lng, last_heading = p_heading,
         last_speed_kmh = p_speed_kmh, last_update_at = now()
   where id = v_session;

  v_deviation := public.ride_distance_to_line_m(
    p_lat, p_lng, v_offer.origin_lat, v_offer.origin_lng, v_offer.dest_lat, v_offer.dest_lng
  );
  v_threshold := greatest(coalesce(v_offer.max_detour_meters, 0), 10000);

  if v_deviation is not null and v_deviation > v_threshold then
    if not exists (
      select 1 from public.ride_safety_incidents
      where offer_id = p_offer_id and kind = 'route_deviation'
        and created_at > now() - interval '10 minutes'
    ) then
      insert into public.ride_safety_incidents (
        user_id, offer_id, kind, severity, lat, lng, note
      ) values (
        v_uid, p_offer_id, 'route_deviation', 'medium', p_lat, p_lng,
        'Güzergâhtan yaklaşık ' || round(v_deviation / 1000, 1)::text || ' km sapma algılandı.'
      );
      v_incident := true;
      perform public.tz_notify(r.passenger_id, v_uid, 'ride', 'Güzergâh uyarısı',
        'Sürücü beklenen güzergâhtan belirgin şekilde ayrıldı. Konumunu takip edebilirsin.',
        'ride_offer', p_offer_id::text, '/ride/offers/' || p_offer_id::text)
      from public.ride_reservations r
      where r.offer_id = p_offer_id and r.status = 'started';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'deviation_meters', round(v_deviation),
    'threshold_meters', round(v_threshold),
    'incident_created', v_incident
  );
end;
$$;

grant execute on function public.ride_track_position(uuid, double precision, double precision, double precision, double precision) to authenticated;

create or replace function public.ride_safety_scan()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s record;
  v_count int := 0;
begin
  for v_s in
    select ts.*, o.driver_id, o.origin_label, o.dest_label
    from public.ride_tracking_sessions ts
    join public.ride_offers o on o.id = ts.offer_id
    where ts.status = 'active' and o.status = 'started'
      and coalesce(ts.last_update_at, ts.started_at) < now() - interval '12 minutes'
      and not exists (
        select 1 from public.ride_safety_incidents i
        where i.offer_id = ts.offer_id and i.kind = 'connection_lost'
          and i.created_at > now() - interval '45 minutes'
      )
  loop
    insert into public.ride_safety_incidents (user_id, offer_id, kind, severity, note)
    values (
      v_s.driver_id, v_s.offer_id, 'connection_lost', 'medium',
      'Canlı takip 12 dakikadır konum güncellemesi almadı.'
    );
    perform public.tz_notify(r.passenger_id, NULL, 'ride', 'Canlı takip kesildi',
      'Sürücünün konum bağlantısı geçici olarak kesildi. Buluşma noktasını ve sürücü bilgilerini kontrol edebilirsin.',
      'ride_offer', v_s.offer_id::text, '/ride/offers/' || v_s.offer_id::text)
    from public.ride_reservations r
    where r.offer_id = v_s.offer_id and r.status = 'started';
    v_count := v_count + 1;
  end loop;

  update public.ride_location_shares set revoked_at = now()
   where revoked_at is null and expires_at < now();
  return v_count;
end;
$$;

revoke all on function public.ride_safety_scan() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. Güvenilir kişiyle süreli konum paylaşımı
-- ---------------------------------------------------------------------
create or replace function public.ride_location_share_create(
  p_reservation_id uuid,
  p_minutes integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
  v_id uuid;
  v_token text;
  v_expires timestamptz;
begin
  select * into v_r from public.ride_reservations where id = p_reservation_id;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  select * into v_offer from public.ride_offers where id = v_r.offer_id;
  if v_r.passenger_id <> v_uid and v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_offer.status not in ('published','full','started') then
    raise exception 'offer_unavailable' using errcode = '22023';
  end if;

  v_expires := now() + make_interval(mins => least(greatest(coalesce(p_minutes, 60), 5), 1440));

  insert into public.ride_location_shares (user_id, reservation_id, offer_id, expires_at)
  values (v_uid, p_reservation_id, v_r.offer_id, v_expires)
  returning id, token into v_id, v_token;

  perform public.ride_audit(v_uid, 'location.share.create', 'ride_reservation', p_reservation_id::text,
    jsonb_build_object('expires_at', v_expires));

  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires);
end;
$$;

grant execute on function public.ride_location_share_create(uuid, integer) to authenticated;

create or replace function public.ride_location_share_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_share public.ride_location_shares%rowtype;
  v_offer public.ride_offers%rowtype;
  v_s public.ride_tracking_sessions%rowtype;
  v_name text;
begin
  select * into v_share from public.ride_location_shares
  where token = p_token and revoked_at is null and expires_at > now();
  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;

  select * into v_offer from public.ride_offers where id = v_share.offer_id;
  select coalesce(nullif(trim(first_name), ''), username::text) into v_name
  from public.profiles where id = v_share.user_id;
  select * into v_s from public.ride_tracking_sessions
  where offer_id = v_share.offer_id and status = 'active' limit 1;

  return jsonb_build_object(
    'shared_by', v_name,
    'offer_status', v_offer.status,
    'origin_label', v_offer.origin_label,
    'dest_label', v_offer.dest_label,
    'depart_at', v_offer.depart_at,
    'expires_at', v_share.expires_at,
    'lat', v_s.last_lat,
    'lng', v_s.last_lng,
    'speed_kmh', v_s.last_speed_kmh,
    'updated_at', v_s.last_update_at,
    'note', 'Bu bağlantı sürelidir ve yalnızca paylaşan kişinin onayıyla oluşturulmuştur.'
  );
end;
$$;

grant execute on function public.ride_location_share_view(text) to authenticated;

create or replace function public.ride_location_share_revoke(p_share_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  update public.ride_location_shares set revoked_at = now()
   where id = p_share_id and user_id = v_uid and revoked_at is null;
  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.ride_location_share_revoke(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Acil durum kişileri ve SOS
-- ---------------------------------------------------------------------
create or replace function public.ride_emergency_contacts_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'relation', c.relation,
      'notify_on_sos', c.notify_on_sos
    ) order by c.created_at)
    from public.ride_emergency_contacts c where c.user_id = v_uid
  ), '[]'::jsonb));
end;
$$;

grant execute on function public.ride_emergency_contacts_list() to authenticated;

create or replace function public.ride_emergency_contact_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_id uuid := nullif(p_payload->>'id','')::uuid;
  v_count int;
  v_name text := trim(coalesce(p_payload->>'name',''));
  v_phone text := trim(coalesce(p_payload->>'phone',''));
begin
  if char_length(v_name) not between 2 and 80 then
    raise exception 'invalid_contact_name' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9+][0-9 ]{6,19}$' then
    raise exception 'invalid_contact_phone' using errcode = '22023';
  end if;

  if v_id is null then
    select count(*) into v_count from public.ride_emergency_contacts where user_id = v_uid;
    if v_count >= 5 then
      raise exception 'contact_limit' using errcode = '22023';
    end if;
    insert into public.ride_emergency_contacts (user_id, name, phone, relation, notify_on_sos)
    values (v_uid, v_name, v_phone, nullif(p_payload->>'relation',''),
            coalesce((p_payload->>'notify_on_sos')::boolean, true))
    returning id into v_id;
  else
    update public.ride_emergency_contacts
       set name = v_name, phone = v_phone, relation = nullif(p_payload->>'relation',''),
           notify_on_sos = coalesce((p_payload->>'notify_on_sos')::boolean, true)
     where id = v_id and user_id = v_uid;
    if not found then
      raise exception 'contact_not_found' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.ride_emergency_contact_save(jsonb) to authenticated;

create or replace function public.ride_emergency_contact_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  delete from public.ride_emergency_contacts where id = p_id and user_id = v_uid;
  if not found then
    raise exception 'contact_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.ride_emergency_contact_remove(uuid) to authenticated;

create or replace function public.ride_sos(
  p_reservation_id uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
  v_incident uuid;
  v_contacts jsonb;
begin
  select * into v_r from public.ride_reservations where id = p_reservation_id;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  select * into v_offer from public.ride_offers where id = v_r.offer_id;
  if v_r.passenger_id <> v_uid and v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  insert into public.ride_safety_incidents (user_id, reservation_id, offer_id, kind, severity, status, lat, lng, note)
  values (v_uid, p_reservation_id, v_r.offer_id, 'sos', 'critical', 'open', p_lat, p_lng,
          left(coalesce(p_note, 'Kullanıcı SOS gönderdi.'), 500))
  returning id into v_incident;

  perform public.tz_notify(
    case when v_r.passenger_id = v_uid then v_offer.driver_id else v_r.passenger_id end,
    v_uid, 'ride', 'Acil durum bildirimi',
    'Yolculukta acil durum bildirimi oluşturuldu. Güvenliğin için 112''yi arayabilirsin.',
    'ride_safety_incident', v_incident::text, '/ride/safety'
  );

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'phone', phone) order by created_at), '[]'::jsonb)
  into v_contacts
  from public.ride_emergency_contacts
  where user_id = v_uid and notify_on_sos;

  perform public.ride_audit(v_uid, 'safety.sos', 'ride_safety_incident', v_incident::text,
    jsonb_build_object('reservation_id', p_reservation_id));

  return jsonb_build_object(
    'incident_id', v_incident,
    'status', 'open',
    'emergency_number', '112',
    'contacts', v_contacts,
    'disclaimer', 'Trabzone resmi acil yardım hizmeti değildir. Hayati tehlike varsa 112''yi arayın.'
  );
end;
$$;

grant execute on function public.ride_sos(uuid, double precision, double precision, text) to authenticated;

create or replace function public.ride_safety_report(
  p_reservation_id uuid,
  p_kind text,
  p_note text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
  v_id uuid;
begin
  if p_kind not in ('harassment','route_deviation','long_stop','connection_lost','other') then
    raise exception 'invalid_incident_kind' using errcode = '22023';
  end if;
  select * into v_r from public.ride_reservations where id = p_reservation_id;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  select * into v_offer from public.ride_offers where id = v_r.offer_id;
  if v_r.passenger_id <> v_uid and v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_note,''))) < 10 then
    raise exception 'note_too_short' using errcode = '22023';
  end if;

  insert into public.ride_safety_incidents (user_id, reservation_id, offer_id, kind, severity, lat, lng, note)
  values (v_uid, p_reservation_id, v_r.offer_id, p_kind,
          case when p_kind = 'harassment' then 'high' else 'medium' end, p_lat, p_lng,
          left(p_note, 1000))
  returning id into v_id;

  perform public.ride_audit(v_uid, 'safety.report', 'ride_safety_incident', v_id::text,
    jsonb_build_object('kind', p_kind, 'reservation_id', p_reservation_id));
  return jsonb_build_object('incident_id', v_id, 'status', 'open');
end;
$$;

grant execute on function public.ride_safety_report(uuid, text, text, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------
-- 12. Uyuşmazlık açma
-- ---------------------------------------------------------------------
create or replace function public.ride_dispute_open(
  p_reservation_id uuid,
  p_category text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
  v_against uuid;
  v_id uuid;
begin
  if p_category not in ('no_show','late','route_change','safety','payment','vehicle','other') then
    raise exception 'invalid_dispute_category' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_description,''))) < 15 then
    raise exception 'description_too_short' using errcode = '22023';
  end if;

  select * into v_r from public.ride_reservations where id = p_reservation_id;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  select * into v_offer from public.ride_offers where id = v_r.offer_id;
  if v_r.passenger_id <> v_uid and v_offer.driver_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_r.status not in ('started','completed','disputed') then
    raise exception 'dispute_not_allowed' using errcode = '22023';
  end if;
  if exists (select 1 from public.ride_disputes where reservation_id = p_reservation_id and status in ('open','reviewing')) then
    raise exception 'dispute_already_open' using errcode = '22023';
  end if;

  v_against := case when v_r.passenger_id = v_uid then v_offer.driver_id else v_r.passenger_id end;

  insert into public.ride_disputes (reservation_id, opened_by, against_id, category, description)
  values (p_reservation_id, v_uid, v_against, p_category, left(p_description, 2000))
  returning id into v_id;

  update public.ride_reservations set status = 'disputed' where id = p_reservation_id and status = 'completed';

  perform public.tz_notify(v_against, v_uid, 'ride', 'Yeni uyuşmazlık bildirimi',
    'Bir yolculuk için uyuşmazlık bildirimi açıldı. Trabzone ekibi inceleyecek.',
    'ride_dispute', v_id::text, '/ride/trips/' || p_reservation_id::text);

  perform public.ride_audit(v_uid, 'dispute.open', 'ride_dispute', v_id::text,
    jsonb_build_object('reservation_id', p_reservation_id, 'category', p_category));
  return jsonb_build_object('id', v_id, 'status', 'open');
end;
$$;

grant execute on function public.ride_dispute_open(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 13. Karşılıklı değerlendirme ve güvenilirlik seviyesi
-- ---------------------------------------------------------------------
create or replace function public.ride_recompute_reputation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trips int;
  v_cancelled int;
  v_reviews int;
  v_rating numeric;
  v_level text := 'verified';
begin
  select
    (select count(*) from public.ride_reservations r
       where r.passenger_id = p_user_id and r.status = 'completed')
    + (select count(*) from public.ride_reservations r
       join public.ride_offers o on o.id = r.offer_id
       where o.driver_id = p_user_id and r.status = 'completed')
  into v_trips;

  select count(*) into v_cancelled
  from public.ride_reservations r
  join public.ride_offers o on o.id = r.offer_id
  where (r.passenger_id = p_user_id or o.driver_id = p_user_id)
    and r.status = 'cancelled' and r.cancelled_by = p_user_id;

  select count(*), round(avg(rating)::numeric, 2) into v_reviews, v_rating
  from public.ride_reviews
  where subject_id = p_user_id and status = 'published';

  if v_trips >= 50 and coalesce(v_rating,0) >= 4.7
     and (v_cancelled::numeric / greatest(v_trips + v_cancelled, 1)) <= 0.10 then
    v_level := 'platinum';
  elsif v_trips >= 20 and coalesce(v_rating,0) >= 4.5 then
    v_level := 'gold';
  elsif v_trips >= 5 and coalesce(v_rating,0) >= 4.3 then
    v_level := 'silver';
  end if;

  update public.ride_member_profiles
     set completed_trips = coalesce(v_trips,0),
         cancelled_trips = coalesce(v_cancelled,0),
         review_count = coalesce(v_reviews,0),
         rating_avg = v_rating,
         level = v_level
   where user_id = p_user_id;
end;
$$;

revoke all on function public.ride_recompute_reputation(uuid) from public, anon, authenticated;

create or replace function public.ride_review_submit(
  p_reservation_id uuid,
  p_rating integer,
  p_comment text default null,
  p_categories jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_r public.ride_reservations%rowtype;
  v_offer public.ride_offers%rowtype;
  v_subject uuid;
  v_role text;
  v_id uuid;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating' using errcode = '22023';
  end if;
  select * into v_r from public.ride_reservations where id = p_reservation_id;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  if v_r.status not in ('completed','disputed') then
    raise exception 'review_not_allowed' using errcode = '22023';
  end if;

  select * into v_offer from public.ride_offers where id = v_r.offer_id;
  if v_r.passenger_id = v_uid then
    v_subject := v_offer.driver_id;
    v_role := 'passenger';
  elsif v_offer.driver_id = v_uid then
    v_subject := v_r.passenger_id;
    v_role := 'driver';
  else
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if exists (select 1 from public.ride_reviews where reservation_id = p_reservation_id and author_id = v_uid) then
    raise exception 'review_already_submitted' using errcode = '22023';
  end if;

  insert into public.ride_reviews (
    reservation_id, author_id, subject_id, author_role, rating, comment, categories
  ) values (
    p_reservation_id, v_uid, v_subject, v_role, p_rating,
    nullif(left(coalesce(p_comment,''), 1000), ''), coalesce(p_categories, '{}'::jsonb)
  ) returning id into v_id;

  perform public.ride_recompute_reputation(v_subject);
  perform public.tz_notify(v_subject, v_uid, 'ride', 'Yeni değerlendirme',
    p_rating || '/5 puan aldın. Değerlendirmen güvenilirlik seviyeni etkiler.',
    'ride_review', v_id::text, '/ride/trips/' || p_reservation_id::text);

  perform public.ride_audit(v_uid, 'review.submit', 'ride_review', v_id::text,
    jsonb_build_object('rating', p_rating, 'role', v_role));

  return jsonb_build_object('id', v_id, 'rating', p_rating);
end;
$$;

grant execute on function public.ride_review_submit(uuid, integer, text, jsonb) to authenticated;

create or replace function public.ride_reviews_for(p_user_id uuid, p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'rating', rv.rating, 'comment', rv.comment, 'categories', rv.categories,
        'created_at', rv.created_at, 'author_role', rv.author_role,
        'author_username', p.username, 'author_first_name', p.first_name,
        'author_avatar_path', p.avatar_path
      ) order by rv.created_at desc)
      from (
        select * from public.ride_reviews
        where subject_id = p_user_id and status = 'published'
        order by created_at desc
        limit least(greatest(coalesce(p_limit, 10), 1), 50)
      ) rv
      join public.profiles p on p.id = rv.author_id
    ), '[]'::jsonb),
    'summary', (
      select jsonb_build_object(
        'rating_avg', round(avg(rating)::numeric, 2),
        'review_count', count(*),
        'level', (select level from public.ride_member_profiles where user_id = p_user_id),
        'completed_trips', (select completed_trips from public.ride_member_profiles where user_id = p_user_id)
      )
      from public.ride_reviews where subject_id = p_user_id and status = 'published'
    )
  );
end;
$$;

grant execute on function public.ride_reviews_for(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 14. Favori güzergâhlar
-- ---------------------------------------------------------------------
create or replace function public.ride_favorites()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'label', f.label, 'scope', f.scope,
      'origin_label', f.origin_label, 'origin_city', f.origin_city,
      'dest_label', f.dest_label, 'dest_city', f.dest_city,
      'origin_lat', f.origin_lat, 'origin_lng', f.origin_lng,
      'dest_lat', f.dest_lat, 'dest_lng', f.dest_lng,
      'alert_enabled', f.alert_enabled, 'created_at', f.created_at
    ) order by f.created_at desc)
    from public.ride_favorite_routes f where f.user_id = v_uid
  ), '[]'::jsonb));
end;
$$;

grant execute on function public.ride_favorites() to authenticated;

create or replace function public.ride_favorite_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_id uuid := nullif(p_payload->>'id','')::uuid;
  v_label text := trim(coalesce(p_payload->>'label',''));
  v_scope text := coalesce(p_payload->>'scope','intracity');
  v_origin text := trim(coalesce(p_payload->>'origin_label',''));
  v_dest text := trim(coalesce(p_payload->>'dest_label',''));
begin
  if char_length(v_label) not between 1 and 80 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if v_scope not in ('intracity','intercity') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;
  if char_length(v_origin) < 2 or char_length(v_dest) < 2 then
    raise exception 'invalid_route' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.ride_favorite_routes (
      user_id, label, scope, origin_label, origin_city, origin_lat, origin_lng,
      dest_label, dest_city, dest_lat, dest_lng, alert_enabled
    ) values (
      v_uid, v_label, v_scope, v_origin, coalesce(nullif(p_payload->>'origin_city',''), 'Trabzon'),
      nullif(p_payload->>'origin_lat','')::double precision,
      nullif(p_payload->>'origin_lng','')::double precision,
      v_dest, coalesce(nullif(p_payload->>'dest_city',''), 'Trabzon'),
      nullif(p_payload->>'dest_lat','')::double precision,
      nullif(p_payload->>'dest_lng','')::double precision,
      coalesce((p_payload->>'alert_enabled')::boolean, true)
    ) returning id into v_id;
  else
    update public.ride_favorite_routes
       set label = v_label, scope = v_scope, origin_label = v_origin,
           origin_city = coalesce(nullif(p_payload->>'origin_city',''), origin_city),
           origin_lat = nullif(p_payload->>'origin_lat','')::double precision,
           origin_lng = nullif(p_payload->>'origin_lng','')::double precision,
           dest_label = v_dest,
           dest_city = coalesce(nullif(p_payload->>'dest_city',''), dest_city),
           dest_lat = nullif(p_payload->>'dest_lat','')::double precision,
           dest_lng = nullif(p_payload->>'dest_lng','')::double precision,
           alert_enabled = coalesce((p_payload->>'alert_enabled')::boolean, true)
     where id = v_id and user_id = v_uid;
    if not found then
      raise exception 'favorite_not_found' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.ride_favorite_save(jsonb) to authenticated;

create or replace function public.ride_favorite_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  delete from public.ride_favorite_routes where id = p_id and user_id = v_uid;
  if not found then
    raise exception 'favorite_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.ride_favorite_remove(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 15. Düzenli yolculuklar
-- ---------------------------------------------------------------------
create or replace function public.ride_recurring_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'role', s.role, 'scope', s.scope,
      'origin_label', s.origin_label, 'origin_city', s.origin_city,
      'dest_label', s.dest_label, 'dest_city', s.dest_city,
      'weekdays', s.weekdays, 'depart_time', s.depart_time, 'return_time', s.return_time,
      'seats', s.seats, 'price_per_seat_cents', s.price_per_seat_cents,
      'preferences', s.preferences, 'is_active', s.is_active,
      'paused_dates', s.paused_dates, 'paused_until', s.paused_until,
      'vehicle_id', s.vehicle_id, 'luggage', s.luggage,
      'booking_mode', s.booking_mode, 'visibility', s.visibility,
      'created_at', s.created_at
    ) order by s.created_at desc)
    from public.ride_recurring_schedules s where s.user_id = v_uid
  ), '[]'::jsonb));
end;
$$;

grant execute on function public.ride_recurring_list() to authenticated;

create or replace function public.ride_recurring_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_id uuid := nullif(p_payload->>'id','')::uuid;
  v_role text := coalesce(p_payload->>'role','passenger');
  v_scope text := coalesce(p_payload->>'scope','intracity');
  v_weekdays smallint[];
  v_vehicle uuid := nullif(p_payload->>'vehicle_id','')::uuid;
  v_identity text;
  v_driver text;
  v_vehicle_status text;
begin
  if v_role not in ('driver','passenger') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if v_scope not in ('intracity','intercity') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;

  select array_agg(value::smallint) into v_weekdays
  from jsonb_array_elements_text(coalesce(p_payload->'weekdays','[]'::jsonb)) as value;

  if v_weekdays is null or array_length(v_weekdays,1) is null or array_length(v_weekdays,1) < 1
     or not (v_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]) then
    raise exception 'invalid_weekdays' using errcode = '22023';
  end if;
  if (p_payload->>'depart_time') is null then
    raise exception 'invalid_depart_time' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_payload->>'origin_label',''))) < 2
     or char_length(trim(coalesce(p_payload->>'dest_label',''))) < 2 then
    raise exception 'invalid_route' using errcode = '22023';
  end if;

  perform public.ride_member_ensure(v_uid);

  if v_role = 'driver' then
    select identity_status, driver_status into v_identity, v_driver
    from public.ride_member_profiles where user_id = v_uid;
    if v_identity <> 'approved' or v_driver <> 'approved' then
      raise exception 'driver_verification_required' using errcode = '42501';
    end if;
    if v_vehicle is null then
      raise exception 'vehicle_required' using errcode = '22023';
    end if;
    select status into v_vehicle_status from public.ride_vehicles
    where id = v_vehicle and owner_id = v_uid and is_active;
    if v_vehicle_status is distinct from 'approved' then
      raise exception 'vehicle_not_approved' using errcode = '42501';
    end if;
  end if;

  if v_id is null then
    insert into public.ride_recurring_schedules (
      user_id, role, scope, origin_label, origin_city, origin_lat, origin_lng,
      dest_label, dest_city, dest_lat, dest_lng, weekdays, depart_time, return_time,
      seats, price_per_seat_cents, preferences, vehicle_id, luggage, booking_mode, visibility
    ) values (
      v_uid, v_role, v_scope,
      left(trim(p_payload->>'origin_label'), 120), left(trim(coalesce(p_payload->>'origin_city','Trabzon')), 60),
      nullif(p_payload->>'origin_lat','')::double precision,
      nullif(p_payload->>'origin_lng','')::double precision,
      left(trim(p_payload->>'dest_label'), 120), left(trim(coalesce(p_payload->>'dest_city','Trabzon')), 60),
      nullif(p_payload->>'dest_lat','')::double precision,
      nullif(p_payload->>'dest_lng','')::double precision,
      v_weekdays, (p_payload->>'depart_time')::time, nullif(p_payload->>'return_time','')::time,
      coalesce((p_payload->>'seats')::int, 1), nullif(p_payload->>'price_per_seat_cents','')::int,
      coalesce(p_payload->'preferences','{}'::jsonb), v_vehicle,
      coalesce(p_payload->>'luggage','medium'),
      coalesce(p_payload->>'booking_mode','manual'),
      coalesce(p_payload->>'visibility','public')
    ) returning id into v_id;
  else
    update public.ride_recurring_schedules
       set role = v_role, scope = v_scope,
           origin_label = left(trim(p_payload->>'origin_label'),120),
           origin_city = left(trim(coalesce(p_payload->>'origin_city','Trabzon')),60),
           origin_lat = nullif(p_payload->>'origin_lat','')::double precision,
           origin_lng = nullif(p_payload->>'origin_lng','')::double precision,
           dest_label = left(trim(p_payload->>'dest_label'),120),
           dest_city = left(trim(coalesce(p_payload->>'dest_city','Trabzon')),60),
           dest_lat = nullif(p_payload->>'dest_lat','')::double precision,
           dest_lng = nullif(p_payload->>'dest_lng','')::double precision,
           weekdays = v_weekdays, depart_time = (p_payload->>'depart_time')::time,
           return_time = nullif(p_payload->>'return_time','')::time,
           seats = coalesce((p_payload->>'seats')::int, 1),
           price_per_seat_cents = nullif(p_payload->>'price_per_seat_cents','')::int,
           preferences = coalesce(p_payload->'preferences','{}'::jsonb),
           vehicle_id = v_vehicle,
           luggage = coalesce(p_payload->>'luggage','medium'),
           booking_mode = coalesce(p_payload->>'booking_mode','manual'),
           visibility = coalesce(p_payload->>'visibility','public'),
           is_active = coalesce((p_payload->>'is_active')::boolean, is_active)
     where id = v_id and user_id = v_uid;
    if not found then
      raise exception 'schedule_not_found' using errcode = 'P0002';
    end if;
  end if;

  perform public.ride_audit(v_uid, 'recurring.save', 'ride_recurring_schedule', v_id::text,
    jsonb_build_object('role', v_role, 'weekdays', v_weekdays));
  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.ride_recurring_save(jsonb) to authenticated;

create or replace function public.ride_recurring_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  update public.ride_recurring_schedules set is_active = false where id = p_id and user_id = v_uid;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'P0002';
  end if;
  update public.ride_offers
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'recurring_paused'
   where recurring_id = p_id and status in ('published','full');
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.ride_recurring_remove(uuid) to authenticated;

create or replace function public.ride_recurring_pause_day(p_id uuid, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_has_reservations int;
begin
  if p_date < current_date then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  update public.ride_recurring_schedules
     set paused_dates = array_append(paused_dates, p_date)
   where id = p_id and user_id = v_uid;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'P0002';
  end if;

  -- Yalnızca o günün ilanı etkilenir; diğer tarihlere dokunulmaz.
  select count(*) into v_has_reservations
  from public.ride_reservations r
  join public.ride_offers o on o.id = r.offer_id
  where o.recurring_id = p_id and o.recurrence_date = p_date
    and r.status in ('confirmed','started');

  if v_has_reservations > 0 then
    raise exception 'recurring_day_has_reservations' using errcode = '22023';
  end if;

  update public.ride_offers
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'recurring_paused_day'
   where recurring_id = p_id and recurrence_date = p_date and status in ('published','full');

  return jsonb_build_object('ok', true, 'paused_date', p_date);
end;
$$;

grant execute on function public.ride_recurring_pause_day(uuid, date) to authenticated;

-- Düzenli sürücü programlarından önümüzdeki 7 gün için ilan üretir.
create or replace function public.ride_recurring_run()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s record;
  v_day date;
  v_depart timestamptz;
  v_offer_id uuid;
  v_count int := 0;
  v_distance int;
begin
  for v_s in
    select s.*, v.seat_capacity
    from public.ride_recurring_schedules s
    join public.ride_vehicles v on v.id = s.vehicle_id
    where s.role = 'driver' and s.is_active
      and v.status = 'approved' and v.is_active
      and (s.paused_until is null or s.paused_until < current_date)
  loop
    for v_day in
      select d::date from generate_series(current_date, current_date + 6, interval '1 day') d
      where extract(isodow from d)::smallint = any (v_s.weekdays)
        and not (d::date = any (v_s.paused_dates))
    loop
      v_depart := (v_day + v_s.depart_time) at time zone 'Europe/Istanbul';
      if v_depart <= now() then
        continue;
      end if;
      if exists (select 1 from public.ride_offers o where o.recurring_id = v_s.id and o.recurrence_date = v_day) then
        continue;
      end if;

      v_distance := round(public.ride_haversine_m(v_s.origin_lat, v_s.origin_lng, v_s.dest_lat, v_s.dest_lng))::int;

      insert into public.ride_offers (
        driver_id, vehicle_id, scope, mode, status,
        origin_label, origin_city, origin_district, origin_lat, origin_lng,
        dest_label, dest_city, dest_district, dest_lat, dest_lng,
        depart_at, depart_flex_minutes, distance_meters, price_per_seat_cents,
        seats_total, luggage, preferences, route_mode, booking_mode, visibility,
        recurring_id, recurrence_date
      ) values (
        v_s.user_id, v_s.vehicle_id, v_s.scope, 'scheduled', 'published',
        v_s.origin_label, v_s.origin_city, v_s.origin_district, v_s.origin_lat, v_s.origin_lng,
        v_s.dest_label, v_s.dest_city, v_s.dest_district, v_s.dest_lat, v_s.dest_lng,
        v_depart, 15, v_distance, coalesce(v_s.price_per_seat_cents, 0),
        least(v_s.seats, v_s.seat_capacity), v_s.luggage, v_s.preferences,
        'fixed', v_s.booking_mode, v_s.visibility, v_s.id, v_day
      ) returning id into v_offer_id;

      insert into public.ride_offer_stops (offer_id, seq, kind, label, city, district, lat, lng)
      values (v_offer_id, 0, 'origin', v_s.origin_label, v_s.origin_city, v_s.origin_district, v_s.origin_lat, v_s.origin_lng);
      insert into public.ride_offer_stops (offer_id, seq, kind, label, city, district, lat, lng)
      values (v_offer_id, 1, 'destination', v_s.dest_label, v_s.dest_city, v_s.dest_district, v_s.dest_lat, v_s.dest_lng);

      perform public.tz_notify(v_s.user_id, NULL, 'ride', 'Düzenli yolculuk ilanı oluşturuldu',
        v_s.origin_label || ' → ' || v_s.dest_label || ' · ' || to_char(v_depart, 'DD.MM HH24:MI'),
        'ride_offer', v_offer_id::text, '/ride/offers/' || v_offer_id::text);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ride_recurring_run() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 16. Zamanlanmış bakım (pg_cron varsa)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule(jobname) from cron.job
      where jobname in ('ride-expire-holds', 'ride-recurring-run', 'ride-safety-scan');
    exception when others then null;
    end;
    perform cron.schedule('ride-expire-holds', '*/5 * * * *', 'select public.ride_expire_holds()');
    perform cron.schedule('ride-recurring-run', '15 3 * * *', 'select public.ride_recurring_run()');
    perform cron.schedule('ride-safety-scan', '*/5 * * * *', 'select public.ride_safety_scan()');
  end if;
end $$;
