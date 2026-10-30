-- =====================================================================
-- 0219 — Konaklama yönetimi tamamlayıcı RPC'leri
--
-- * Tesis yönetim detayı (düzenleme ekranı)
-- * Oda tipi / fiziksel oda / fiyat planı envanteri
-- * Oda bloke etme ve blokeyi kaldırma
-- * Kasa hareketlerinde rezervasyon kodu ve ters kayıt bilgisi
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Tesis yönetim detayı
-- ---------------------------------------------------------------------
create or replace function public.acc_property_detail(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'read');
  p public.acc_properties%rowtype;
begin
  select * into p from public.acc_properties where id = p_property_id;

  return jsonb_build_object(
    'id', p.id,
    'owner_id', p.owner_id,
    'name', p.name,
    'slug', p.slug,
    'property_type', p.property_type,
    'description', p.description,
    'status', p.status,
    'verification_status', p.verification_status,
    'verification_note', p.verification_note,
    'verified_at', p.verified_at,
    'published_at', p.published_at,
    'city', p.city,
    'district_id', p.district_id,
    'neighborhood_id', p.neighborhood_id,
    'district', p.district,
    'neighborhood', p.neighborhood,
    'address', p.address,
    'lat', p.lat,
    'lng', p.lng,
    'phone', p.phone,
    'email', p.email,
    'website', p.website,
    'tax_office', p.tax_office,
    'tax_number', p.tax_number,
    'invoice_title', p.invoice_title,
    'contact_name', p.contact_name,
    'contact_phone', p.contact_phone,
    'contact_email', p.contact_email,
    'documents_required', p.documents_required,
    'room_capacity', p.room_capacity,
    'checkin_time', p.checkin_time,
    'checkout_time', p.checkout_time,
    'languages', p.languages,
    'policies', p.policies,
    'amenities', p.amenities,
    'cover_path', p.cover_path,
    'rating_avg', p.rating_avg,
    'rating_count', p.rating_count,
    'view_count', p.view_count,
    'commission_rate', p.commission_rate,
    'settings', p.settings,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'role', public.acc_staff_role(p_property_id),
    'can_manage', public.acc_can(p_property_id, 'property'),
    'missing', public.acc_property_missing(p_property_id),
    'counts', jsonb_build_object(
      'room_types', (select count(*) from public.acc_room_types where property_id = p_property_id and active),
      'rooms', (select count(*) from public.acc_rooms where property_id = p_property_id and active),
      'rate_plans', (select count(*) from public.acc_rate_plans where property_id = p_property_id and active),
      'documents', (select count(*) from public.acc_property_documents where property_id = p_property_id),
      'media', (select count(*) from public.acc_property_media where property_id = p_property_id)
    )
  );
end;
$$;

grant execute on function public.acc_property_detail(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Oda ve fiyat planı envanteri
-- ---------------------------------------------------------------------
create or replace function public.acc_property_inventory(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'read');
  v_room_types jsonb;
  v_rooms jsonb;
  v_rate_plans jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rt.id,
    'name', rt.name,
    'description', rt.description,
    'capacity_adults', rt.capacity_adults,
    'capacity_children', rt.capacity_children,
    'bed_setup', rt.bed_setup,
    'size_m2', rt.size_m2,
    'view', rt.view,
    'balcony', rt.balcony,
    'air_conditioning', rt.air_conditioning,
    'wifi', rt.wifi,
    'breakfast', rt.breakfast,
    'amenities', rt.amenities,
    'base_price_cents', rt.base_price_cents,
    'currency', rt.currency,
    'cover_path', rt.cover_path,
    'sort_order', rt.sort_order,
    'active', rt.active,
    'room_count', (select count(*) from public.acc_rooms r where r.room_type_id = rt.id and r.active)
  ) order by rt.sort_order, rt.created_at), '[]'::jsonb)
  into v_room_types
  from public.acc_room_types rt
  where rt.property_id = p_property_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'room_type_id', r.room_type_id,
    'room_type_name', rt.name,
    'number', r.number,
    'floor', r.floor,
    'status', r.status,
    'housekeeping_note', r.housekeeping_note,
    'sort_order', r.sort_order,
    'active', r.active
  ) order by rt.sort_order, r.sort_order, r.number), '[]'::jsonb)
  into v_rooms
  from public.acc_rooms r
  join public.acc_room_types rt on rt.id = r.room_type_id
  where r.property_id = p_property_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rp.id,
    'room_type_id', rp.room_type_id,
    'room_type_name', (select name from public.acc_room_types where id = rp.room_type_id),
    'name', rp.name,
    'description', rp.description,
    'booking_mode', rp.booking_mode,
    'cancellation_policy', rp.cancellation_policy,
    'cancellation_hours', rp.cancellation_hours,
    'deposit_percent', rp.deposit_percent,
    'includes_breakfast', rp.includes_breakfast,
    'min_stay', rp.min_stay,
    'max_stay', rp.max_stay,
    'sort_order', rp.sort_order,
    'active', rp.active
  ) order by rp.sort_order, rp.created_at), '[]'::jsonb)
  into v_rate_plans
  from public.acc_rate_plans rp
  where rp.property_id = p_property_id;

  return jsonb_build_object(
    'room_types', v_room_types,
    'rooms', v_rooms,
    'rate_plans', v_rate_plans
  );
end;
$$;

grant execute on function public.acc_property_inventory(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Oda bloke etme / blokeyi kaldırma
-- ---------------------------------------------------------------------
create or replace function public.acc_room_block_create(
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
  v_room_id uuid := nullif(p_payload->>'room_id', '')::uuid;
  v_start date := nullif(p_payload->>'start_date', '')::date;
  v_end date := nullif(p_payload->>'end_date', '')::date;
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  b public.acc_room_blocks%rowtype;
begin
  if v_room_id is null or v_start is null or v_end is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_end <= v_start then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;
  if not exists (
    select 1 from public.acc_rooms
    where id = v_room_id and property_id = p_property_id and active
  ) then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;

  -- Dolu bir odayı bloke etmek stok/müsaitlik hesabını bozar: önce
  -- rezervasyonun taşınması veya iptal edilmesi gerekir.
  if exists (
    select 1 from public.acc_reservations r
    where r.room_id = v_room_id
      and r.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'change_pending', 'disputed')
      and (r.status <> 'pending' or r.hold_expires_at is null or r.hold_expires_at > now())
      and daterange(r.check_in, r.check_out, '[)') && daterange(v_start, v_end, '[)')
  ) then
    raise exception 'room_unavailable' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.acc_room_blocks x
    where x.room_id = v_room_id and x.status = 'active'
      and daterange(x.start_date, x.end_date, '[)') && daterange(v_start, v_end, '[)')
  ) then
    raise exception 'room_already_blocked' using errcode = '23505';
  end if;

  insert into public.acc_room_blocks
    (property_id, room_id, start_date, end_date, reason, status, created_by)
  values (p_property_id, v_room_id, v_start, v_end, v_reason, 'active', v_uid)
  returning * into b;

  -- Bakım kaydı varsa oda bakım durumuna alınır; bloke yalnızca satış
  -- kapanışı değil, operasyonel hazırlık da gerektirebilir.
  if coalesce((p_payload->>'block_room')::boolean, false) then
    update public.acc_rooms set status = 'maintenance' where id = v_room_id;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (p_property_id, v_uid, 'room.blocked', 'room_block', b.id::text,
          jsonb_build_object('room_id', v_room_id, 'start_date', v_start, 'end_date', v_end));

  return to_jsonb(b);
end;
$$;

grant execute on function public.acc_room_block_create(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_room_block_delete(
  p_room_block_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.acc_room_blocks%rowtype;
  v_uid uuid;
begin
  select * into b from public.acc_room_blocks where id = p_room_block_id for update;
  if not found then
    raise exception 'block_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(b.property_id, 'rooms');

  if b.status <> 'active' then
    return to_jsonb(b);
  end if;

  update public.acc_room_blocks set status = 'cancelled' where id = p_room_block_id
  returning * into b;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (b.property_id, v_uid, 'room.block_removed', 'room_block', b.id::text,
          jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')));

  return to_jsonb(b);
end;
$$;

grant execute on function public.acc_room_block_delete(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Kasa hareketleri: rezervasyon kodu, işlemi yapan ve ters kayıt bilgisi
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
    'reservation_id', t.reservation_id,
    'reservation_code', (select code from public.acc_reservations where id = t.reservation_id),
    'created_by', t.created_by,
    'actor_name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username),
    'reverses_id', t.reverses_id,
    'created_at', t.created_at
  ) order by t.occurred_on desc, t.created_at desc), '[]'::jsonb)
  into v_transactions
  from (
    select * from public.acc_cash_transactions
    where property_id = p_property_id
    order by occurred_on desc, created_at desc limit 60
  ) t
  join public.acc_cash_accounts a on a.id = t.account_id
  left join public.profiles pr on pr.id = t.created_by;

  return jsonb_build_object('accounts', v_accounts, 'transactions', v_transactions);
end;
$$;

grant execute on function public.acc_cash_overview(uuid) to authenticated, service_role;
