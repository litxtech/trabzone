-- =====================================================================
-- 0216 — Otel yönetim paneli (2/3)
--
-- * Oda tipi / fiziksel oda / fiyat planı yönetimi
-- * Misafir CRM, ön büro, kat hizmetleri
-- * Kasa, tahsilat, gider, iade ve ters kayıt
-- * Günlük/aylık finans, komisyon mutabakatı
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Oda tipleri
-- ---------------------------------------------------------------------
create or replace function public.acc_room_type_upsert(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'rooms');
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_row public.acc_room_types%rowtype;
  v_amenities text[];
begin
  if p_payload ? 'amenities' then
    select coalesce(array_agg(value), '{}'::text[]) into v_amenities
    from jsonb_array_elements_text(p_payload->'amenities') value;
  end if;

  if v_id is null then
    insert into public.acc_room_types (
      property_id, name, description, capacity_adults, capacity_children,
      bed_setup, size_m2, view, balcony, air_conditioning, wifi, breakfast,
      amenities, base_price_cents, currency, cover_path, sort_order, active
    ) values (
      p_property_id,
      coalesce(nullif(btrim(p_payload->>'name'), ''), 'Yeni Oda Tipi'),
      nullif(btrim(coalesce(p_payload->>'description', '')), ''),
      coalesce((p_payload->>'capacity_adults')::int, 2),
      coalesce((p_payload->>'capacity_children')::int, 0),
      nullif(btrim(coalesce(p_payload->>'bed_setup', '')), ''),
      nullif(p_payload->>'size_m2', '')::int,
      nullif(btrim(coalesce(p_payload->>'view', '')), ''),
      coalesce((p_payload->>'balcony')::boolean, false),
      coalesce((p_payload->>'air_conditioning')::boolean, true),
      coalesce((p_payload->>'wifi')::boolean, true),
      coalesce((p_payload->>'breakfast')::boolean, false),
      coalesce(v_amenities, '{}'::text[]),
      coalesce((p_payload->>'base_price_cents')::bigint, 0),
      coalesce(nullif(p_payload->>'currency', ''), 'TRY'),
      nullif(btrim(coalesce(p_payload->>'cover_path', '')), ''),
      coalesce((p_payload->>'sort_order')::int, 0),
      coalesce((p_payload->>'active')::boolean, true)
    ) returning * into v_row;
  else
    update public.acc_room_types
       set name = coalesce(nullif(btrim(p_payload->>'name'), ''), name),
           description = case when p_payload ? 'description'
             then nullif(btrim(coalesce(p_payload->>'description', '')), '') else description end,
           capacity_adults = coalesce(nullif(p_payload->>'capacity_adults', '')::int, capacity_adults),
           capacity_children = coalesce(nullif(p_payload->>'capacity_children', '')::int, capacity_children),
           bed_setup = case when p_payload ? 'bed_setup'
             then nullif(btrim(coalesce(p_payload->>'bed_setup', '')), '') else bed_setup end,
           size_m2 = case when p_payload ? 'size_m2'
             then nullif(p_payload->>'size_m2', '')::int else size_m2 end,
           view = case when p_payload ? 'view'
             then nullif(btrim(coalesce(p_payload->>'view', '')), '') else view end,
           balcony = coalesce(nullif(p_payload->>'balcony', '')::boolean, balcony),
           air_conditioning = coalesce(nullif(p_payload->>'air_conditioning', '')::boolean, air_conditioning),
           wifi = coalesce(nullif(p_payload->>'wifi', '')::boolean, wifi),
           breakfast = coalesce(nullif(p_payload->>'breakfast', '')::boolean, breakfast),
           amenities = case when p_payload ? 'amenities' then coalesce(v_amenities, '{}'::text[]) else amenities end,
           base_price_cents = coalesce(nullif(p_payload->>'base_price_cents', '')::bigint, base_price_cents),
           currency = coalesce(nullif(p_payload->>'currency', ''), currency),
           cover_path = case when p_payload ? 'cover_path'
             then nullif(btrim(coalesce(p_payload->>'cover_path', '')), '') else cover_path end,
           sort_order = coalesce(nullif(p_payload->>'sort_order', '')::int, sort_order),
           active = coalesce(nullif(p_payload->>'active', '')::boolean, active)
     where id = v_id and property_id = p_property_id
     returning * into v_row;
    if not found then
      raise exception 'room_type_not_found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (p_property_id, v_uid, 'room_type.saved', 'room_type', v_row.id::text);

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.acc_room_type_upsert(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_room_type_delete(p_room_type_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rt public.acc_room_types%rowtype;
  v_uid uuid;
begin
  select * into v_rt from public.acc_room_types where id = p_room_type_id;
  if not found then
    raise exception 'room_type_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(v_rt.property_id, 'rooms');

  update public.acc_room_types set active = false where id = p_room_type_id;
  update public.acc_rooms set active = false where room_type_id = p_room_type_id;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (v_rt.property_id, v_uid, 'room_type.archived', 'room_type', p_room_type_id::text);

  return jsonb_build_object('id', p_room_type_id, 'archived', true);
end;
$$;

grant execute on function public.acc_room_type_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Fiziksel odalar
-- ---------------------------------------------------------------------
create or replace function public.acc_room_upsert(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'rooms');
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_number text := btrim(coalesce(p_payload->>'number', ''));
  v_room_type_id uuid := nullif(p_payload->>'room_type_id', '')::uuid;
  v_row public.acc_rooms%rowtype;
begin
  if v_number = '' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.acc_room_types
    where id = v_room_type_id and property_id = p_property_id
  ) then
    raise exception 'room_type_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.acc_rooms
    where property_id = p_property_id and number = v_number
      and (v_id is null or id <> v_id)
  ) then
    raise exception 'duplicate_room_number' using errcode = '23505';
  end if;

  if v_id is null then
    insert into public.acc_rooms (
      property_id, room_type_id, number, floor, status,
      housekeeping_note, sort_order, active
    ) values (
      p_property_id, v_room_type_id, v_number,
      nullif(btrim(coalesce(p_payload->>'floor', '')), ''),
      coalesce(nullif(p_payload->>'status', ''), 'clean'),
      nullif(btrim(coalesce(p_payload->>'housekeeping_note', '')), ''),
      coalesce((p_payload->>'sort_order')::int, 0),
      coalesce((p_payload->>'active')::boolean, true)
    ) returning * into v_row;
  else
    update public.acc_rooms
       set room_type_id = v_room_type_id,
           number = v_number,
           floor = case when p_payload ? 'floor'
             then nullif(btrim(coalesce(p_payload->>'floor', '')), '') else floor end,
           status = coalesce(nullif(p_payload->>'status', ''), status),
           housekeeping_note = case when p_payload ? 'housekeeping_note'
             then nullif(btrim(coalesce(p_payload->>'housekeeping_note', '')), '') else housekeeping_note end,
           sort_order = coalesce(nullif(p_payload->>'sort_order', '')::int, sort_order),
           active = coalesce(nullif(p_payload->>'active', '')::boolean, active)
     where id = v_id and property_id = p_property_id
     returning * into v_row;
    if not found then
      raise exception 'room_not_found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (p_property_id, v_uid, 'room.saved', 'room', v_row.id::text);

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.acc_room_upsert(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_room_delete(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.acc_rooms%rowtype;
  v_uid uuid;
begin
  select * into r from public.acc_rooms where id = p_room_id;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(r.property_id, 'rooms');
  update public.acc_rooms set active = false, status = 'out_of_service' where id = p_room_id;
  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (r.property_id, v_uid, 'room.archived', 'room', p_room_id::text);
  return jsonb_build_object('id', p_room_id, 'archived', true);
end;
$$;

grant execute on function public.acc_room_delete(uuid) to authenticated, service_role;

create or replace function public.acc_room_status_set(
  p_room_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.acc_rooms%rowtype;
  v_uid uuid;
begin
  if p_status not in ('clean', 'dirty', 'cleaning', 'inspection', 'maintenance', 'out_of_service') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select * into r from public.acc_rooms where id = p_room_id;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(r.property_id, 'housekeeping');

  update public.acc_rooms
     set status = p_status,
         housekeeping_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), housekeeping_note)
   where id = p_room_id
  returning * into r;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (r.property_id, v_uid, 'room.status', 'room', r.id::text,
          jsonb_build_object('status', p_status, 'note', p_note));

  return to_jsonb(r);
end;
$$;

grant execute on function public.acc_room_status_set(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Fiyat planları
-- ---------------------------------------------------------------------
create or replace function public.acc_rate_plan_upsert(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'rates');
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_room_type_id uuid := nullif(p_payload->>'room_type_id', '')::uuid;
  v_mode text := coalesce(nullif(p_payload->>'booking_mode', ''), 'instant');
  v_row public.acc_rate_plans%rowtype;
begin
  if v_mode not in ('instant', 'manual') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_room_type_id is not null and not exists (
    select 1 from public.acc_room_types
    where id = v_room_type_id and property_id = p_property_id
  ) then
    raise exception 'room_type_not_found' using errcode = 'P0002';
  end if;

  if v_id is null then
    insert into public.acc_rate_plans (
      property_id, room_type_id, name, description, booking_mode,
      cancellation_policy, cancellation_hours, deposit_percent,
      includes_breakfast, min_stay, max_stay, active, sort_order
    ) values (
      p_property_id, v_room_type_id,
      coalesce(nullif(btrim(p_payload->>'name'), ''), 'Standart Plan'),
      nullif(btrim(coalesce(p_payload->>'description', '')), ''),
      v_mode,
      nullif(btrim(coalesce(p_payload->>'cancellation_policy', '')), ''),
      coalesce((p_payload->>'cancellation_hours')::int, 24),
      coalesce((p_payload->>'deposit_percent')::int, 0),
      coalesce((p_payload->>'includes_breakfast')::boolean, false),
      coalesce((p_payload->>'min_stay')::int, 1),
      nullif(p_payload->>'max_stay', '')::int,
      coalesce((p_payload->>'active')::boolean, true),
      coalesce((p_payload->>'sort_order')::int, 0)
    ) returning * into v_row;
  else
    update public.acc_rate_plans
       set room_type_id = v_room_type_id,
           name = coalesce(nullif(btrim(p_payload->>'name'), ''), name),
           description = case when p_payload ? 'description'
             then nullif(btrim(coalesce(p_payload->>'description', '')), '') else description end,
           booking_mode = v_mode,
           cancellation_policy = case when p_payload ? 'cancellation_policy'
             then nullif(btrim(coalesce(p_payload->>'cancellation_policy', '')), '') else cancellation_policy end,
           cancellation_hours = coalesce(nullif(p_payload->>'cancellation_hours', '')::int, cancellation_hours),
           deposit_percent = coalesce(nullif(p_payload->>'deposit_percent', '')::int, deposit_percent),
           includes_breakfast = coalesce(nullif(p_payload->>'includes_breakfast', '')::boolean, includes_breakfast),
           min_stay = coalesce(nullif(p_payload->>'min_stay', '')::int, min_stay),
           max_stay = case when p_payload ? 'max_stay'
             then nullif(p_payload->>'max_stay', '')::int else max_stay end,
           active = coalesce(nullif(p_payload->>'active', '')::boolean, active),
           sort_order = coalesce(nullif(p_payload->>'sort_order', '')::int, sort_order)
     where id = v_id and property_id = p_property_id
     returning * into v_row;
    if not found then
      raise exception 'rate_plan_not_found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (p_property_id, v_uid, 'rate_plan.saved', 'rate_plan', v_row.id::text);

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.acc_rate_plan_upsert(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_rate_plan_delete(p_rate_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rp public.acc_rate_plans%rowtype;
  v_uid uuid;
begin
  select * into rp from public.acc_rate_plans where id = p_rate_plan_id;
  if not found then
    raise exception 'rate_plan_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(rp.property_id, 'rates');
  update public.acc_rate_plans set active = false where id = p_rate_plan_id;
  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (rp.property_id, v_uid, 'rate_plan.archived', 'rate_plan', p_rate_plan_id::text);
  return jsonb_build_object('id', p_rate_plan_id, 'archived', true);
end;
$$;

grant execute on function public.acc_rate_plan_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Misafirler
-- ---------------------------------------------------------------------
create or replace function public.acc_guests_list(
  p_property_id uuid,
  p_query text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'read');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_items jsonb;
  v_total int;
begin
  select count(*) into v_total
  from public.acc_guests g
  where g.property_id = p_property_id
    and (v_query is null or g.full_name ilike '%' || v_query || '%'
      or coalesce(g.phone, '') ilike '%' || v_query || '%'
      or coalesce(g.email, '') ilike '%' || v_query || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'full_name', g.full_name,
    'phone', g.phone,
    'email', g.email,
    'notes', g.notes,
    'contact_consent', g.contact_consent,
    'reservation_count', (
      select count(*) from public.acc_reservations r where r.guest_id = g.id
    ),
    'last_stay', (
      select max(r.check_out) from public.acc_reservations r
      where r.guest_id = g.id and r.status in ('staying', 'checked_out', 'completed')
    ),
    'total_spent_cents', (
      select coalesce(sum(r.total_cents), 0) from public.acc_reservations r
      where r.guest_id = g.id and r.status in ('checked_out', 'completed')
    ),
    'open_balance_cents', (
      select coalesce(sum(case
        when f.kind = 'charge' then f.amount_cents
        when f.kind = 'payment' then -f.amount_cents
        when f.kind = 'refund' then f.amount_cents
        when f.kind = 'adjustment' then f.amount_cents else 0 end), 0)
      from public.acc_folio_items f
      join public.acc_reservations r on r.id = f.reservation_id
      where r.guest_id = g.id
        and r.status not in ('cancelled', 'declined', 'expired', 'no_show')
    )
  ) order by g.updated_at desc), '[]'::jsonb)
  into v_items
  from (
    select * from public.acc_guests
    where property_id = p_property_id
      and (v_query is null or full_name ilike '%' || v_query || '%'
        or coalesce(phone, '') ilike '%' || v_query || '%'
        or coalesce(email, '') ilike '%' || v_query || '%')
    order by updated_at desc
    limit v_limit offset v_offset
  ) g;

  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

grant execute on function public.acc_guests_list(uuid, text, int, int) to authenticated, service_role;

create or replace function public.acc_guest_upsert(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'guests');
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  g public.acc_guests%rowtype;
begin
  if v_id is null then
    insert into public.acc_guests
      (property_id, full_name, phone, email, notes, contact_consent, created_by)
    values (
      p_property_id,
      btrim(coalesce(p_payload->>'full_name', '')),
      nullif(btrim(coalesce(p_payload->>'phone', '')), ''),
      nullif(lower(btrim(coalesce(p_payload->>'email', ''))), ''),
      nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
      coalesce((p_payload->>'contact_consent')::boolean, true),
      v_uid
    ) returning * into g;
  else
    update public.acc_guests
       set full_name = coalesce(nullif(btrim(p_payload->>'full_name'), ''), full_name),
           phone = case when p_payload ? 'phone' then nullif(btrim(coalesce(p_payload->>'phone', '')), '') else phone end,
           email = case when p_payload ? 'email' then nullif(lower(btrim(coalesce(p_payload->>'email', ''))), '') else email end,
           notes = case when p_payload ? 'notes' then nullif(btrim(coalesce(p_payload->>'notes', '')), '') else notes end,
           contact_consent = coalesce(nullif(p_payload->>'contact_consent', '')::boolean, contact_consent)
     where id = v_id and property_id = p_property_id
     returning * into g;
    if not found then
      raise exception 'guest_not_found' using errcode = 'P0002';
    end if;
  end if;

  if g.full_name = '' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  return to_jsonb(g);
end;
$$;

grant execute on function public.acc_guest_upsert(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_guest_detail(p_guest_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g public.acc_guests%rowtype;
  v_uid uuid;
  v_balance bigint;
begin
  select * into g from public.acc_guests where id = p_guest_id;
  if not found then
    raise exception 'guest_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(g.property_id, 'read');

  select coalesce(sum(case
      when f.kind = 'charge' then f.amount_cents
      when f.kind = 'payment' then -f.amount_cents
      when f.kind = 'refund' then f.amount_cents
      when f.kind = 'adjustment' then f.amount_cents else 0 end), 0)
    into v_balance
  from public.acc_folio_items f
  join public.acc_reservations r on r.id = f.reservation_id
  where r.guest_id = g.id
    and r.status not in ('cancelled', 'declined', 'expired', 'no_show');

  return jsonb_build_object(
    'id', g.id,
    'full_name', g.full_name,
    'phone', g.phone,
    'email', g.email,
    'notes', g.notes,
    'contact_consent', g.contact_consent,
    'created_at', g.created_at,
    'open_balance_cents', v_balance,
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'code', r.code, 'status', r.status,
        'check_in', r.check_in, 'check_out', r.check_out, 'nights', r.nights,
        'room_type_name', rt.name, 'room_number', rm.number,
        'total_cents', r.total_cents, 'paid_cents', r.paid_cents,
        'payment_status', r.payment_status, 'currency', r.currency
      ) order by r.check_in desc)
      from public.acc_reservations r
      join public.acc_room_types rt on rt.id = r.room_type_id
      left join public.acc_rooms rm on rm.id = r.room_id
      where r.guest_id = g.id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.acc_guest_detail(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Ön büro
-- ---------------------------------------------------------------------
create or replace function public.acc_frontdesk(
  p_property_id uuid,
  p_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'read');
  v_arrivals jsonb;
  v_departures jsonb;
  v_in_house jsonb;
  v_late jsonb;
  v_rooms jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'code', r.code, 'guest_name', r.guest_name,
    'guest_phone', r.guest_phone, 'room_number', rm.number,
    'room_type_name', rt.name, 'check_in', r.check_in, 'check_out', r.check_out,
    'status', r.status, 'payment_status', r.payment_status,
    'paid_cents', r.paid_cents, 'total_cents', r.total_cents,
    'notes', r.notes, 'room_id', r.room_id, 'room_status', rm.status,
    'open_balance_cents', (
      select coalesce(sum(case
        when f.kind = 'charge' then f.amount_cents
        when f.kind = 'payment' then -f.amount_cents
        when f.kind = 'refund' then f.amount_cents
        when f.kind = 'adjustment' then f.amount_cents else 0 end), 0)
      from public.acc_folio_items f where f.reservation_id = r.id
    )
  ) order by r.check_in, r.created_at), '[]'::jsonb)
  into v_arrivals
  from public.acc_reservations r
  join public.acc_room_types rt on rt.id = r.room_type_id
  left join public.acc_rooms rm on rm.id = r.room_id
  where r.property_id = p_property_id and r.check_in = p_date
    and r.status in ('confirmed', 'awaiting_checkin');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'code', r.code, 'guest_name', r.guest_name,
    'room_number', rm.number, 'room_type_name', rt.name,
    'check_in', r.check_in, 'check_out', r.check_out, 'status', r.status,
    'payment_status', r.payment_status, 'paid_cents', r.paid_cents,
    'total_cents', r.total_cents, 'room_id', r.room_id, 'room_status', rm.status,
    'open_balance_cents', (
      select coalesce(sum(case
        when f.kind = 'charge' then f.amount_cents
        when f.kind = 'payment' then -f.amount_cents
        when f.kind = 'refund' then f.amount_cents
        when f.kind = 'adjustment' then f.amount_cents else 0 end), 0)
      from public.acc_folio_items f where f.reservation_id = r.id
    )
  ) order by r.check_out), '[]'::jsonb)
  into v_departures
  from public.acc_reservations r
  join public.acc_room_types rt on rt.id = r.room_type_id
  left join public.acc_rooms rm on rm.id = r.room_id
  where r.property_id = p_property_id and r.check_out = p_date
    and r.status in ('checked_in', 'staying');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'code', r.code, 'guest_name', r.guest_name,
    'room_number', rm.number, 'room_type_name', rt.name,
    'check_in', r.check_in, 'check_out', r.check_out, 'status', r.status,
    'payment_status', r.payment_status, 'paid_cents', r.paid_cents,
    'total_cents', r.total_cents, 'room_id', r.room_id,
    'notes', r.notes
  ) order by r.check_out), '[]'::jsonb)
  into v_in_house
  from public.acc_reservations r
  join public.acc_room_types rt on rt.id = r.room_type_id
  left join public.acc_rooms rm on rm.id = r.room_id
  where r.property_id = p_property_id
    and p_date >= r.check_in and p_date < r.check_out
    and r.status in ('checked_in', 'staying');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'code', r.code, 'guest_name', r.guest_name,
    'check_in', r.check_in, 'room_number', rm.number, 'status', r.status
  ) order by r.check_in), '[]'::jsonb)
  into v_late
  from public.acc_reservations r
  left join public.acc_rooms rm on rm.id = r.room_id
  where r.property_id = p_property_id
    and r.check_in < p_date
    and r.status in ('confirmed', 'awaiting_checkin');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rm.id, 'number', rm.number, 'floor', rm.floor,
    'room_type_name', rt.name, 'status', rm.status, 'note', rm.housekeeping_note
  ) order by rm.sort_order, rm.number), '[]'::jsonb)
  into v_rooms
  from public.acc_rooms rm
  join public.acc_room_types rt on rt.id = rm.room_type_id
  where rm.property_id = p_property_id and rm.active;

  return jsonb_build_object(
    'date', p_date,
    'arrivals', v_arrivals,
    'departures', v_departures,
    'in_house', v_in_house,
    'late_arrivals', v_late,
    'rooms', v_rooms
  );
end;
$$;

grant execute on function public.acc_frontdesk(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Kat hizmetleri
-- ---------------------------------------------------------------------
create or replace function public.acc_housekeeping(
  p_property_id uuid,
  p_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'read');
  v_items jsonb;
  v_staff jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'room_id', rm.id,
    'number', rm.number,
    'floor', rm.floor,
    'room_type_name', rt.name,
    'room_status', rm.status,
    'note', rm.housekeeping_note,
    'arrival_today', exists (
      select 1 from public.acc_reservations x
      where x.room_id = rm.id and x.check_in = p_date
        and x.status in ('confirmed', 'awaiting_checkin')
    ),
    'departure_today', exists (
      select 1 from public.acc_reservations x
      where x.room_id = rm.id and x.check_out = p_date
        and x.status in ('checked_in', 'staying')
    ),
    'task_id', t.id,
    'task_kind', t.kind,
    'task_status', t.status,
    'task_note', t.note,
    'task_photo_path', t.photo_path,
    'task_due_date', t.due_date,
    'assigned_to', t.assigned_to,
    'assigned_name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username)
  ) order by rm.sort_order, rm.number), '[]'::jsonb)
  into v_items
  from public.acc_rooms rm
  join public.acc_room_types rt on rt.id = rm.room_type_id
  left join lateral (
    select * from public.acc_housekeeping_tasks t
    where t.room_id = rm.id and t.status <> 'verified'
    order by t.created_at desc limit 1
  ) t on true
  left join public.profiles pr on pr.id = t.assigned_to
  where rm.property_id = p_property_id and rm.active;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', s.user_id,
    'name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username),
    'role', s.role
  ) order by s.created_at), '[]'::jsonb)
  into v_staff
  from public.acc_property_staff s
  join public.profiles pr on pr.id = s.user_id
  where s.property_id = p_property_id and s.status = 'active'
    and s.role in ('owner', 'manager', 'housekeeping');

  return jsonb_build_object('date', p_date, 'items', v_items, 'staff', v_staff);
end;
$$;

grant execute on function public.acc_housekeeping(uuid, date) to authenticated, service_role;

create or replace function public.acc_housekeeping_upsert(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'housekeeping');
  v_room_id uuid := nullif(p_payload->>'room_id', '')::uuid;
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'cleaning');
  v_task public.acc_housekeeping_tasks%rowtype;
  v_room public.acc_rooms%rowtype;
begin
  if v_kind not in ('cleaning', 'maintenance', 'inspection') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_room from public.acc_rooms
   where id = v_room_id and property_id = p_property_id;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;

  insert into public.acc_housekeeping_tasks
    (property_id, room_id, kind, status, assigned_to, note, photo_path, due_date, created_by)
  values (
    p_property_id, v_room_id, v_kind, 'pending',
    nullif(p_payload->>'assigned_to', '')::uuid,
    nullif(btrim(coalesce(p_payload->>'note', '')), ''),
    nullif(btrim(coalesce(p_payload->>'photo_path', '')), ''),
    coalesce((p_payload->>'due_date')::date, current_date),
    v_uid
  ) returning * into v_task;

  if v_kind = 'maintenance' then
    update public.acc_rooms set status = 'maintenance' where id = v_room_id;
  elsif v_kind = 'cleaning' then
    update public.acc_rooms set status = 'dirty' where id = v_room_id;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (p_property_id, v_uid, 'housekeeping.created', 'housekeeping', v_task.id::text,
          jsonb_build_object('room_id', v_room_id, 'kind', v_kind));

  return to_jsonb(v_task);
end;
$$;

grant execute on function public.acc_housekeeping_upsert(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_housekeeping_transition(
  p_task_id uuid,
  p_status text,
  p_note text default null,
  p_photo_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.acc_housekeeping_tasks%rowtype;
  v_uid uuid;
  v_room public.acc_rooms%rowtype;
begin
  if p_status not in ('pending', 'in_progress', 'done', 'verified') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select * into t from public.acc_housekeeping_tasks where id = p_task_id;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(t.property_id, 'housekeeping');

  update public.acc_housekeeping_tasks
     set status = p_status,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
         photo_path = coalesce(nullif(btrim(coalesce(p_photo_path, '')), ''), photo_path),
         started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
         completed_at = case when p_status = 'verified' then now() else completed_at end
   where id = p_task_id
  returning * into t;

  select * into v_room from public.acc_rooms where id = t.room_id;
  if found then
    update public.acc_rooms
       set status = case
             when p_status = 'in_progress' and t.kind = 'cleaning' then 'cleaning'
             when p_status = 'done' and t.kind = 'cleaning' then 'inspection'
             when p_status = 'verified' then 'clean'
             when p_status = 'verified' and t.kind = 'maintenance' then 'clean'
             else status end
     where id = t.room_id;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (t.property_id, v_uid, 'housekeeping.' || p_status, 'housekeeping', t.id::text,
          jsonb_build_object('room_id', t.room_id, 'kind', t.kind, 'note', p_note));

  return to_jsonb(t);
end;
$$;

grant execute on function public.acc_housekeeping_transition(uuid, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Kasa
-- ---------------------------------------------------------------------
create or replace function public.acc_cash_overview(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'read');
  v_accounts jsonb;
  v_transactions jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'kind', a.kind, 'currency', a.currency,
    'opening_balance_cents', a.opening_balance_cents,
    'balance_cents', a.opening_balance_cents + coalesce((
      select sum(case
        when t.kind in ('collection', 'transfer_in', 'opening', 'adjustment') then t.amount_cents
        when t.kind in ('expense', 'refund', 'transfer_out') then -t.amount_cents
        else 0 end)
      from public.acc_cash_transactions t where t.account_id = a.id and t.occurred_on <= current_date
    ), 0),
    'today_collected_cents', coalesce((
      select sum(case when t.kind = 'collection' then t.amount_cents
                      when t.kind = 'refund' then -t.amount_cents else 0 end)
      from public.acc_cash_transactions t
      where t.account_id = a.id and t.occurred_on = current_date
    ), 0)
  ) order by a.kind, a.created_at), '[]'::jsonb)
  into v_accounts
  from public.acc_cash_accounts a
  where a.property_id = p_property_id and a.active;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'account_id', t.account_id, 'account_name', a.name,
    'kind', t.kind, 'amount_cents', t.amount_cents, 'currency', t.currency,
    'occurred_on', t.occurred_on, 'description', t.description,
    'reservation_id', t.reservation_id, 'created_by', t.created_by, 'created_at', t.created_at
  ) order by t.occurred_on desc, t.created_at desc), '[]'::jsonb)
  into v_transactions
  from (
    select * from public.acc_cash_transactions
    where property_id = p_property_id
    order by occurred_on desc, created_at desc limit 60
  ) t
  join public.acc_cash_accounts a on a.id = t.account_id;

  return jsonb_build_object('accounts', v_accounts, 'transactions', v_transactions);
end;
$$;

grant execute on function public.acc_cash_overview(uuid) to authenticated, service_role;

create or replace function public.acc_cash_account_upsert(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'cash');
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'cash');
  a public.acc_cash_accounts%rowtype;
begin
  if v_kind not in ('cash', 'pos', 'bank') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.acc_cash_accounts
      (property_id, name, kind, currency, opening_balance_cents, active)
    values (
      p_property_id,
      coalesce(nullif(btrim(p_payload->>'name'), ''), 'Kasa'),
      v_kind,
      coalesce(nullif(p_payload->>'currency', ''), 'TRY'),
      coalesce((p_payload->>'opening_balance_cents')::bigint, 0),
      coalesce((p_payload->>'active')::boolean, true)
    ) returning * into a;
  else
    update public.acc_cash_accounts
       set name = coalesce(nullif(btrim(p_payload->>'name'), ''), name),
           kind = v_kind,
           currency = coalesce(nullif(p_payload->>'currency', ''), currency),
           opening_balance_cents = coalesce(nullif(p_payload->>'opening_balance_cents', '')::bigint, opening_balance_cents),
           active = coalesce(nullif(p_payload->>'active', '')::boolean, active)
     where id = v_id and property_id = p_property_id
     returning * into a;
    if not found then
      raise exception 'cash_account_not_found' using errcode = 'P0002';
    end if;
  end if;
  return to_jsonb(a);
end;
$$;

grant execute on function public.acc_cash_account_upsert(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_cash_transaction_add(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'cash');
  v_account_id uuid := nullif(p_payload->>'account_id', '')::uuid;
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'collection');
  v_amount bigint := coalesce((p_payload->>'amount_cents')::bigint, 0);
  v_reservation_id uuid := nullif(p_payload->>'reservation_id', '')::uuid;
  v_occurred date := coalesce((p_payload->>'occurred_on')::date, current_date);
  a public.acc_cash_accounts%rowtype;
  r public.acc_reservations%rowtype;
  v_tx public.acc_cash_transactions%rowtype;
  v_new_paid bigint;
begin
  if v_kind not in ('collection', 'expense', 'refund', 'adjustment') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_amount <= 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  select * into a from public.acc_cash_accounts
   where id = v_account_id and property_id = p_property_id and active;
  if not found then
    raise exception 'cash_account_not_found' using errcode = 'P0002';
  end if;

  insert into public.acc_cash_transactions
    (property_id, account_id, kind, amount_cents, currency, occurred_on,
     reservation_id, description, created_by, reverses_id)
  values (
    p_property_id, v_account_id, v_kind, v_amount, a.currency, v_occurred,
    v_reservation_id,
    nullif(btrim(coalesce(p_payload->>'description', '')), ''),
    v_uid,
    nullif(p_payload->>'reverses_id', '')::uuid
  ) returning * into v_tx;

  if v_reservation_id is not null and v_kind in ('collection', 'refund') then
    select * into r from public.acc_reservations
     where id = v_reservation_id and property_id = p_property_id for update;
    if found then
      insert into public.acc_folio_items
        (property_id, reservation_id, kind, category, description,
         amount_cents, currency, occurred_on, method, cash_account_id, created_by)
      values (
        p_property_id, v_reservation_id,
        case when v_kind = 'collection' then 'payment' else 'refund' end,
        case a.kind when 'cash' then 'cash' when 'pos' then 'pos' else 'bank' end,
        coalesce(nullif(btrim(coalesce(p_payload->>'description', '')), ''),
                 case when v_kind = 'collection' then 'Tahsilat' else 'İade' end),
        v_amount, a.currency, v_occurred, a.kind, v_account_id, v_uid
      );

      v_new_paid := case when v_kind = 'collection'
        then r.paid_cents + v_amount
        else greatest(0, r.paid_cents - v_amount) end;

      update public.acc_reservations
         set paid_cents = v_new_paid,
             payment_status = case
               when v_kind = 'refund' and v_new_paid = 0 and r.status in ('cancelled', 'no_show') then 'refunded'
               when v_new_paid <= 0 then 'unpaid'
               when v_new_paid >= r.total_cents then 'paid'
               else 'partial' end
       where id = r.id;
    end if;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (p_property_id, v_uid, 'cash.' || v_kind, 'cash_transaction', v_tx.id::text,
          jsonb_build_object('amount_cents', v_amount, 'account_id', v_account_id));

  return to_jsonb(v_tx);
end;
$$;

grant execute on function public.acc_cash_transaction_add(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_cash_transfer(
  p_property_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount_cents bigint,
  p_occurred_on date default current_date,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'cash');
  v_group uuid := gen_random_uuid();
  a public.acc_cash_accounts%rowtype;
  b public.acc_cash_accounts%rowtype;
begin
  if p_amount_cents <= 0 or p_from_account_id = p_to_account_id then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into a from public.acc_cash_accounts
   where id = p_from_account_id and property_id = p_property_id and active;
  if not found then raise exception 'cash_account_not_found' using errcode = 'P0002'; end if;
  select * into b from public.acc_cash_accounts
   where id = p_to_account_id and property_id = p_property_id and active;
  if not found then raise exception 'cash_account_not_found' using errcode = 'P0002'; end if;

  insert into public.acc_cash_transactions
    (property_id, account_id, kind, amount_cents, currency, occurred_on, transfer_group, description, created_by)
  values
    (p_property_id, p_from_account_id, 'transfer_out', p_amount_cents, a.currency, p_occurred_on,
     v_group, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Kasa transferi'), v_uid),
    (p_property_id, p_to_account_id, 'transfer_in', p_amount_cents, b.currency, p_occurred_on,
     v_group, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Kasa transferi'), v_uid);

  return jsonb_build_object('transfer_group', v_group, 'amount_cents', p_amount_cents);
end;
$$;

grant execute on function public.acc_cash_transfer(uuid, uuid, uuid, bigint, date, text)
  to authenticated, service_role;

create or replace function public.acc_cash_transaction_reverse(
  p_transaction_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.acc_cash_transactions%rowtype;
  v_uid uuid;
  v_kind text;
  v_new public.acc_cash_transactions%rowtype;
  r public.acc_reservations%rowtype;
  v_new_paid bigint;
begin
  select * into t from public.acc_cash_transactions where id = p_transaction_id;
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(t.property_id, 'cash');
  if exists (select 1 from public.acc_cash_transactions where reverses_id = p_transaction_id) then
    raise exception 'already_reversed' using errcode = '22023';
  end if;

  v_kind := case t.kind
    when 'collection' then 'refund'
    when 'refund' then 'collection'
    when 'expense' then 'adjustment'
    when 'transfer_in' then 'transfer_out'
    when 'transfer_out' then 'transfer_in'
    else 'adjustment' end;

  insert into public.acc_cash_transactions
    (property_id, account_id, kind, amount_cents, currency, occurred_on,
     reservation_id, description, created_by, reverses_id)
  values (
    t.property_id, t.account_id, v_kind, t.amount_cents, t.currency, current_date,
    t.reservation_id, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Ters kayıt'), v_uid, t.id
  ) returning * into v_new;

  if t.reservation_id is not null and t.kind in ('collection', 'refund') then
    select * into r from public.acc_reservations
     where id = t.reservation_id for update;
    if found then
      insert into public.acc_folio_items
        (property_id, reservation_id, kind, category, description,
         amount_cents, currency, occurred_on, method, cash_account_id,
         created_by, reverses_id)
      values (
        t.property_id, t.reservation_id,
        case when t.kind = 'collection' then 'refund' else 'payment' end,
        case when t.kind = 'collection' then 'cash' else 'bank' end,
        'Ters kayıt', t.amount_cents, t.currency, current_date, t.kind,
        t.account_id, v_uid, t.folio_item_id
      );

      v_new_paid := case when t.kind = 'collection'
        then greatest(0, r.paid_cents - t.amount_cents)
        else r.paid_cents + t.amount_cents end;

      update public.acc_reservations
         set paid_cents = v_new_paid,
             payment_status = case
               when v_new_paid <= 0 then 'unpaid'
               when v_new_paid >= r.total_cents then 'paid'
               else 'partial' end
       where id = r.id;
    end if;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (t.property_id, v_uid, 'cash.reversed', 'cash_transaction', t.id::text,
          jsonb_build_object('reverse_id', v_new.id));

  return to_jsonb(v_new);
end;
$$;

grant execute on function public.acc_cash_transaction_reverse(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Folio (ek hizmet, tahsilat, iade)
-- ---------------------------------------------------------------------
create or replace function public.acc_folio_add(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'finance');
  v_reservation_id uuid := nullif(p_payload->>'reservation_id', '')::uuid;
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'charge');
  v_category text := coalesce(nullif(p_payload->>'category', ''), 'extra');
  v_amount bigint := coalesce((p_payload->>'amount_cents')::bigint, 0);
  v_account_id uuid := nullif(p_payload->>'cash_account_id', '')::uuid;
  v_occurred date := coalesce((p_payload->>'occurred_on')::date, current_date);
  r public.acc_reservations%rowtype;
  f public.acc_folio_items%rowtype;
  a public.acc_cash_accounts%rowtype;
  v_new_paid bigint;
begin
  if v_kind not in ('charge', 'payment', 'refund') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_amount <= 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  select * into r from public.acc_reservations
   where id = v_reservation_id and property_id = p_property_id for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;

  if v_account_id is not null then
    select * into a from public.acc_cash_accounts
     where id = v_account_id and property_id = p_property_id;
    if not found then
      v_account_id := null;
    end if;
  end if;

  insert into public.acc_folio_items
    (property_id, reservation_id, kind, category, description,
     amount_cents, currency, occurred_on, method, cash_account_id, created_by, note)
  values (
    p_property_id, v_reservation_id, v_kind, v_category,
    nullif(btrim(coalesce(p_payload->>'description', '')), ''),
    v_amount, r.currency, v_occurred,
    nullif(btrim(coalesce(p_payload->>'method', '')), ''),
    v_account_id, v_uid,
    nullif(btrim(coalesce(p_payload->>'note', '')), '')
  ) returning * into f;

  if v_kind in ('payment', 'refund') then
    v_new_paid := case when v_kind = 'payment' then r.paid_cents + v_amount
                       else greatest(0, r.paid_cents - v_amount) end;
    update public.acc_reservations
       set paid_cents = v_new_paid,
           payment_status = case
             when v_kind = 'refund' and v_new_paid = 0 and r.status in ('cancelled', 'no_show') then 'refunded'
             when v_new_paid <= 0 then 'unpaid'
             when v_new_paid >= r.total_cents then 'paid'
             else 'partial' end
     where id = r.id;

    if v_account_id is not null and a.id is not null then
      insert into public.acc_cash_transactions
        (property_id, account_id, kind, amount_cents, currency, occurred_on,
         reservation_id, folio_item_id, description, created_by)
      values (
        p_property_id, v_account_id,
        case when v_kind = 'payment' then 'collection' else 'refund' end,
        v_amount, r.currency, v_occurred, r.id, f.id,
        coalesce(nullif(btrim(coalesce(p_payload->>'description', '')), ''),
                 case when v_kind = 'payment' then 'Tahsilat' else 'İade' end),
        v_uid
      );
    end if;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (p_property_id, v_uid, 'folio.' || v_kind, 'folio_item', f.id::text,
          jsonb_build_object('reservation_id', v_reservation_id, 'amount_cents', v_amount));

  return to_jsonb(f);
end;
$$;

grant execute on function public.acc_folio_add(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Finans özeti
-- ---------------------------------------------------------------------
create or replace function public.acc_finance_summary(
  p_property_id uuid,
  p_month date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'finance');
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_revenue bigint := 0;
  v_other_income bigint := 0;
  v_discount bigint := 0;
  v_collected bigint := 0;
  v_refunded bigint := 0;
  v_expenses bigint := 0;
  v_commission_accrued bigint := 0;
  v_commission_estimated bigint := 0;
  v_commission_paid bigint := 0;
  v_open_balance bigint := 0;
  v_by_source jsonb;
  v_daily jsonb;
  v_payments jsonb;
begin
  select coalesce(sum(round(r.total_cents::numeric / greatest(r.nights, 1))), 0),
         coalesce(sum(round(r.discount_cents::numeric / greatest(r.nights, 1))), 0)
    into v_revenue, v_discount
  from public.acc_reservations r
  where r.property_id = p_property_id
    and r.status in ('checked_in', 'staying', 'checked_out', 'completed')
    and daterange(r.check_in, r.check_out, '[)') && daterange(v_start, v_end + 1, '[)');

  select coalesce(sum(f.amount_cents), 0) into v_other_income
  from public.acc_folio_items f
  where f.property_id = p_property_id
    and f.kind = 'charge'
    and f.category in ('extra', 'other', 'city_tax')
    and f.occurred_on between v_start and v_end;

  select coalesce(sum(case when f.kind = 'payment' then f.amount_cents when f.kind = 'refund' then -f.amount_cents else 0 end), 0),
         coalesce(sum(case when f.kind = 'refund' then f.amount_cents else 0 end), 0)
    into v_collected, v_refunded
  from public.acc_folio_items f
  where f.property_id = p_property_id
    and f.occurred_on between v_start and v_end;

  select coalesce(sum(t.amount_cents), 0) into v_expenses
  from public.acc_cash_transactions t
  where t.property_id = p_property_id and t.kind = 'expense'
    and t.occurred_on between v_start and v_end;

  select coalesce(sum(case when l.kind = 'accrued' then l.amount_cents when l.kind = 'reversed' then -l.amount_cents else 0 end), 0)
    into v_commission_accrued
  from public.acc_commission_ledger l
  where l.property_id = p_property_id and l.occurred_on between v_start and v_end;

  select coalesce(sum(r.commission_cents), 0) into v_commission_estimated
  from public.acc_reservations r
  where r.property_id = p_property_id and r.source = 'trabzone'
    and r.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying')
    and daterange(r.check_in, r.check_out, '[)') && daterange(v_start, v_end + 1, '[)');

  select coalesce(sum(l.amount_cents), 0) into v_commission_paid
  from public.acc_commission_ledger l
  where l.property_id = p_property_id and l.kind = 'paid'
    and l.occurred_on between v_start and v_end;

  select coalesce(sum(case
      when f.kind = 'charge' then f.amount_cents
      when f.kind = 'payment' then -f.amount_cents
      when f.kind = 'refund' then f.amount_cents
      when f.kind = 'adjustment' then f.amount_cents else 0 end), 0)
    into v_open_balance
  from public.acc_folio_items f
  join public.acc_reservations r on r.id = f.reservation_id
  where f.property_id = p_property_id
    and r.status not in ('draft', 'declined', 'expired', 'cancelled', 'no_show');

  select coalesce(jsonb_agg(jsonb_build_object(
    'source', q.source,
    'reservations', q.cnt,
    'total_cents', q.total,
    'commission_cents', q.commission
  ) order by q.total desc), '[]'::jsonb)
  into v_by_source
  from (
    select r.source, count(*) as cnt,
           coalesce(sum(r.total_cents), 0) as total,
           coalesce(sum(r.commission_cents), 0) as commission
    from public.acc_reservations r
    where r.property_id = p_property_id
      and r.status in ('confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'checked_out', 'completed')
      and daterange(r.check_in, r.check_out, '[)') && daterange(v_start, v_end + 1, '[)')
    group by r.source
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', d::date,
    'revenue_cents', (
      select coalesce(sum(round(r.total_cents::numeric / greatest(r.nights, 1))), 0)
      from public.acc_reservations r
      where r.property_id = p_property_id
        and r.status in ('checked_in', 'staying', 'checked_out', 'completed')
        and d::date >= r.check_in and d::date < r.check_out
    ),
    'collected_cents', (
      select coalesce(sum(case when f.kind = 'payment' then f.amount_cents
                               when f.kind = 'refund' then -f.amount_cents else 0 end), 0)
      from public.acc_folio_items f
      where f.property_id = p_property_id and f.occurred_on = d::date
    ),
    'expenses_cents', (
      select coalesce(sum(t.amount_cents), 0)
      from public.acc_cash_transactions t
      where t.property_id = p_property_id and t.kind = 'expense' and t.occurred_on = d::date
    )
  ) order by d), '[]'::jsonb)
  into v_daily
  from generate_series(v_start, v_end, interval '1 day') d;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category', q.category,
    'total_cents', q.total_cents
  ) order by q.total_cents desc), '[]'::jsonb)
  into v_payments
  from (
    select f.category, sum(f.amount_cents) as total_cents
    from public.acc_folio_items f
    where f.property_id = p_property_id and f.kind = 'payment'
      and f.occurred_on between v_start and v_end
    group by f.category
  ) q;

  return jsonb_build_object(
    'month', to_char(v_start, 'YYYY-MM'),
    'from', v_start,
    'to', v_end,
    'revenue_cents', v_revenue,
    'other_income_cents', v_other_income,
    'discount_cents', v_discount,
    'collected_cents', v_collected,
    'refunded_cents', v_refunded,
    'expenses_cents', v_expenses,
    'commission_accrued_cents', v_commission_accrued,
    'commission_estimated_cents', v_commission_estimated,
    'commission_paid_cents', v_commission_paid,
    'open_balance_cents', v_open_balance,
    'by_source', v_by_source,
    'daily', v_daily,
    'payments_by_category', v_payments
  );
end;
$$;

grant execute on function public.acc_finance_summary(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Günlük rapor
-- ---------------------------------------------------------------------
create or replace function public.acc_daily_report(
  p_property_id uuid,
  p_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'finance');
  v_revenue bigint := 0;
  v_extra bigint := 0;
  v_cash bigint := 0;
  v_pos bigint := 0;
  v_bank bigint := 0;
  v_refunds bigint := 0;
  v_net bigint := 0;
  v_expenses bigint := 0;
  v_commission bigint := 0;
  v_open bigint := 0;
  v_arrivals int := 0;
  v_departures int := 0;
begin
  select coalesce(sum(round(r.total_cents::numeric / greatest(r.nights, 1))), 0)
    into v_revenue
  from public.acc_reservations r
  where r.property_id = p_property_id
    and r.status in ('checked_in', 'staying', 'checked_out', 'completed')
    and p_date >= r.check_in and p_date < r.check_out;

  select coalesce(sum(f.amount_cents), 0) into v_extra
  from public.acc_folio_items f
  where f.property_id = p_property_id and f.kind = 'charge'
    and f.category in ('extra', 'other', 'city_tax') and f.occurred_on = p_date;

  select
    coalesce(sum(case when f.category = 'cash' and f.kind = 'payment' then f.amount_cents else 0 end), 0),
    coalesce(sum(case when f.category = 'pos' and f.kind = 'payment' then f.amount_cents else 0 end), 0),
    coalesce(sum(case when f.category = 'bank' and f.kind = 'payment' then f.amount_cents else 0 end), 0),
    coalesce(sum(case when f.kind = 'refund' then f.amount_cents else 0 end), 0)
    into v_cash, v_pos, v_bank, v_refunds
  from public.acc_folio_items f
  where f.property_id = p_property_id and f.occurred_on = p_date;

  v_net := v_cash + v_pos + v_bank - v_refunds;

  select coalesce(sum(t.amount_cents), 0) into v_expenses
  from public.acc_cash_transactions t
  where t.property_id = p_property_id and t.kind = 'expense' and t.occurred_on = p_date;

  select coalesce(sum(l.amount_cents), 0) into v_commission
  from public.acc_commission_ledger l
  where l.property_id = p_property_id and l.kind = 'accrued' and l.occurred_on = p_date;

  select coalesce(sum(case
      when f.kind = 'charge' then f.amount_cents
      when f.kind = 'payment' then -f.amount_cents
      when f.kind = 'refund' then f.amount_cents
      when f.kind = 'adjustment' then f.amount_cents else 0 end), 0)
    into v_open
  from public.acc_folio_items f
  join public.acc_reservations r on r.id = f.reservation_id
  where f.property_id = p_property_id
    and r.status not in ('draft', 'declined', 'expired', 'cancelled', 'no_show');

  select count(*) into v_arrivals
  from public.acc_reservations r
  where r.property_id = p_property_id and r.check_in = p_date
    and r.status in ('confirmed', 'awaiting_checkin');

  select count(*) into v_departures
  from public.acc_reservations r
  where r.property_id = p_property_id and r.check_out = p_date
    and r.status in ('checked_in', 'staying');

  return jsonb_build_object(
    'date', p_date,
    'revenue_cents', v_revenue,
    'extra_income_cents', v_extra,
    'cash_cents', v_cash,
    'pos_cents', v_pos,
    'bank_cents', v_bank,
    'refunds_cents', v_refunds,
    'net_cents', v_net,
    'expenses_cents', v_expenses,
    'commission_accrued_cents', v_commission,
    'open_balance_cents', v_open,
    'arrivals', v_arrivals,
    'departures', v_departures
  );
end;
$$;

grant execute on function public.acc_daily_report(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Komisyon mutabakatı
-- ---------------------------------------------------------------------
create or replace function public.acc_commission_summary(
  p_property_id uuid,
  p_from date default date_trunc('month', current_date)::date,
  p_to date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'finance');
  v_estimated bigint := 0;
  v_finalized bigint := 0;
  v_paid bigint := 0;
  v_due bigint := 0;
  v_rows jsonb;
begin
  select coalesce(sum(r.commission_cents), 0) into v_estimated
  from public.acc_reservations r
  where r.property_id = p_property_id and r.source = 'trabzone'
    and r.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying')
    and daterange(r.check_in, r.check_out, '[)') && daterange(p_from, p_to + 1, '[)');

  select coalesce(sum(case when kind = 'accrued' then amount_cents when kind = 'reversed' then -amount_cents else 0 end), 0)
    into v_finalized
  from public.acc_commission_ledger
  where property_id = p_property_id and occurred_on between p_from and p_to;

  select coalesce(sum(amount_cents), 0) into v_paid
  from public.acc_commission_ledger
  where property_id = p_property_id and kind = 'paid' and occurred_on between p_from and p_to;

  select coalesce(sum(case when kind = 'accrued' then amount_cents when kind = 'reversed' then -amount_cents when kind = 'paid' then -amount_cents else 0 end), 0)
    into v_due
  from public.acc_commission_ledger
  where property_id = p_property_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'reservation_id', r.id,
    'code', r.code,
    'guest_name', r.guest_name,
    'check_in', r.check_in,
    'check_out', r.check_out,
    'status', r.status,
    'source', r.source,
    'total_cents', r.total_cents,
    'commission_rate', r.commission_rate,
    'commission_cents', r.commission_cents
  ) order by r.check_out desc), '[]'::jsonb)
  into v_rows
  from public.acc_reservations r
  where r.property_id = p_property_id and r.source = 'trabzone'
    and daterange(r.check_in, r.check_out, '[)') && daterange(p_from, p_to + 1, '[)');

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'estimated_cents', v_estimated,
    'finalized_cents', v_finalized,
    'paid_cents', v_paid,
    'due_cents', greatest(0, v_due),
    'reservations', v_rows
  );
end;
$$;

grant execute on function public.acc_commission_summary(uuid, date, date) to authenticated, service_role;

create or replace function public.acc_commission_pay(
  p_property_id uuid,
  p_amount_cents bigint,
  p_occurred_on date default current_date,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'finance');
begin
  if p_amount_cents <= 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  insert into public.acc_commission_ledger
    (property_id, kind, amount_cents, occurred_on, note, created_by)
  values (
    p_property_id, 'paid', p_amount_cents, p_occurred_on,
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Trabzone komisyon ödemesi'), v_uid
  );
  return public.acc_commission_summary(p_property_id);
end;
$$;

grant execute on function public.acc_commission_pay(uuid, bigint, date, text)
  to authenticated, service_role;
