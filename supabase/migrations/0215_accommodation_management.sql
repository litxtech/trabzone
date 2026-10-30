-- =====================================================================
-- 0215 — Otel yönetim paneli (1/3)
--
-- * Tesis bağlamı ve doğrulama/eksik bilgi kontrolü
-- * Genel bakış metrikleri (tamamı gerçek veriden)
-- * OtelRunner mantığında oda takvimi verisi
-- * Fiyat/müsaitlik takvimi ve toplu güncelleme
-- * Rezervasyon oluşturma, düzenleme, durum geçişleri, oda blokeleri
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Tesis bağlamı
-- ---------------------------------------------------------------------
create or replace function public.acc_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'slug', p.slug,
    'property_type', p.property_type,
    'status', p.status,
    'verification_status', p.verification_status,
    'verification_note', p.verification_note,
    'district', p.district,
    'neighborhood', p.neighborhood,
    'cover_path', coalesce(
      p.cover_path,
      (select m.storage_path from public.acc_property_media m
        where m.property_id = p.id and m.kind = 'image' and m.status = 'approved'
        order by m.cover desc, m.sort_order limit 1)
    ),
    'role', public.acc_staff_role(p.id),
    'permissions', coalesce((
      select s.permissions from public.acc_property_staff s
      where s.property_id = p.id and s.user_id = v_uid and s.status = 'active'
      limit 1
    ), '{}'::text[]),
    'pending_reservations', (
      select count(*) from public.acc_reservations r
      where r.property_id = p.id and r.status = 'pending'
    ),
    'unread_messages', (
      select count(*) from public.acc_messages m
      where m.property_id = p.id and m.read_at is null and m.sender_role = 'guest'
    ),
    'pending_tasks', (
      select count(*) from public.acc_housekeeping_tasks t
      where t.property_id = p.id and t.status in ('pending', 'in_progress')
    )
  ) order by p.name), '[]'::jsonb)
  into v_items
  from public.acc_properties p
  where exists (
      select 1 from public.acc_property_staff s
      where s.property_id = p.id and s.user_id = v_uid and s.status = 'active'
    )
    or (public.is_admin() and p.status = 'published');

  return jsonb_build_object('items', v_items, 'is_admin', public.is_admin());
end;
$$;

grant execute on function public.acc_my_context() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Eksik bilgi kontrolü
-- ---------------------------------------------------------------------
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

grant execute on function public.acc_property_missing(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tesis kaydet / doğrulamaya gönder
-- ---------------------------------------------------------------------
create or replace function public.acc_property_save(
  p_property_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_submit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_prop public.acc_properties%rowtype;
  v_name text;
  v_slug text;
  v_missing jsonb;
  v_languages text[];
  v_amenities text[];
  v_policies jsonb;
begin
  if p_property_id is not null then
    if not public.acc_can(p_property_id, 'property') then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    select * into v_prop from public.acc_properties where id = p_property_id;
    if not found then
      raise exception 'property_not_found' using errcode = 'P0002';
    end if;
  end if;

  v_name := coalesce(
    nullif(btrim(p_payload->>'name'), ''),
    v_prop.name,
    'Yeni Tesis'
  );

  if p_property_id is null then
    v_slug := public.acc_slugify(v_name);
    if v_slug = '' then
      v_slug := 'tesis';
    end if;
    if exists (select 1 from public.acc_properties where slug = v_slug) then
      v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    end if;

    insert into public.acc_properties (
      owner_id, name, slug, property_type, description, city,
      district_id, neighborhood_id, district, neighborhood, address, lat, lng,
      phone, email, website, tax_office, tax_number, invoice_title,
      contact_name, contact_phone, contact_email, room_capacity,
      checkin_time, checkout_time, languages, policies, amenities, settings
    ) values (
      v_uid, v_name, v_slug,
      coalesce(p_payload->>'property_type', 'hotel'),
      nullif(btrim(coalesce(p_payload->>'description', '')), ''),
      coalesce(nullif(btrim(p_payload->>'city'), ''), 'Trabzon'),
      nullif(p_payload->>'district_id', '')::bigint,
      nullif(p_payload->>'neighborhood_id', '')::bigint,
      nullif(btrim(coalesce(p_payload->>'district', '')), ''),
      nullif(btrim(coalesce(p_payload->>'neighborhood', '')), ''),
      nullif(btrim(coalesce(p_payload->>'address', '')), ''),
      nullif(p_payload->>'lat', '')::double precision,
      nullif(p_payload->>'lng', '')::double precision,
      nullif(btrim(coalesce(p_payload->>'phone', '')), ''),
      nullif(lower(btrim(coalesce(p_payload->>'email', ''))), ''),
      nullif(btrim(coalesce(p_payload->>'website', '')), ''),
      nullif(btrim(coalesce(p_payload->>'tax_office', '')), ''),
      nullif(btrim(coalesce(p_payload->>'tax_number', '')), ''),
      nullif(btrim(coalesce(p_payload->>'invoice_title', '')), ''),
      nullif(btrim(coalesce(p_payload->>'contact_name', '')), ''),
      nullif(btrim(coalesce(p_payload->>'contact_phone', '')), ''),
      nullif(lower(btrim(coalesce(p_payload->>'contact_email', ''))), ''),
      nullif(p_payload->>'room_capacity', '')::int,
      coalesce(nullif(p_payload->>'checkin_time', '')::time, '14:00'),
      coalesce(nullif(p_payload->>'checkout_time', '')::time, '12:00'),
      coalesce((
        select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload->'languages', '["tr"]'::jsonb)) value
      ), array['tr']::text[]),
      coalesce(p_payload->'policies', '{}'::jsonb),
      coalesce((
        select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload->'amenities', '[]'::jsonb)) value
      ), '{}'::text[]),
      coalesce(p_payload->'settings', '{}'::jsonb)
    )
    returning * into v_prop;
  else
    if p_payload ? 'languages' then
      select coalesce(array_agg(value), '{}'::text[]) into v_languages
      from jsonb_array_elements_text(p_payload->'languages') value;
    else
      v_languages := v_prop.languages;
    end if;
    if p_payload ? 'amenities' then
      select coalesce(array_agg(value), '{}'::text[]) into v_amenities
      from jsonb_array_elements_text(p_payload->'amenities') value;
    else
      v_amenities := v_prop.amenities;
    end if;
    if p_payload ? 'policies' then
      v_policies := p_payload->'policies';
    else
      v_policies := v_prop.policies;
    end if;

    update public.acc_properties p
       set name = coalesce(nullif(btrim(p_payload->>'name'), ''), p.name),
           property_type = coalesce(nullif(p_payload->>'property_type', ''), p.property_type),
           description = case when p_payload ? 'description'
             then nullif(btrim(coalesce(p_payload->>'description', '')), '') else p.description end,
           city = coalesce(nullif(btrim(p_payload->>'city'), ''), p.city),
           district_id = case when p_payload ? 'district_id'
             then nullif(p_payload->>'district_id', '')::bigint else p.district_id end,
           neighborhood_id = case when p_payload ? 'neighborhood_id'
             then nullif(p_payload->>'neighborhood_id', '')::bigint else p.neighborhood_id end,
           district = case when p_payload ? 'district'
             then nullif(btrim(coalesce(p_payload->>'district', '')), '') else p.district end,
           neighborhood = case when p_payload ? 'neighborhood'
             then nullif(btrim(coalesce(p_payload->>'neighborhood', '')), '') else p.neighborhood end,
           address = case when p_payload ? 'address'
             then nullif(btrim(coalesce(p_payload->>'address', '')), '') else p.address end,
           lat = case when p_payload ? 'lat'
             then nullif(p_payload->>'lat', '')::double precision else p.lat end,
           lng = case when p_payload ? 'lng'
             then nullif(p_payload->>'lng', '')::double precision else p.lng end,
           phone = case when p_payload ? 'phone'
             then nullif(btrim(coalesce(p_payload->>'phone', '')), '') else p.phone end,
           email = case when p_payload ? 'email'
             then nullif(lower(btrim(coalesce(p_payload->>'email', ''))), '') else p.email end,
           website = case when p_payload ? 'website'
             then nullif(btrim(coalesce(p_payload->>'website', '')), '') else p.website end,
           tax_office = case when p_payload ? 'tax_office'
             then nullif(btrim(coalesce(p_payload->>'tax_office', '')), '') else p.tax_office end,
           tax_number = case when p_payload ? 'tax_number'
             then nullif(btrim(coalesce(p_payload->>'tax_number', '')), '') else p.tax_number end,
           invoice_title = case when p_payload ? 'invoice_title'
             then nullif(btrim(coalesce(p_payload->>'invoice_title', '')), '') else p.invoice_title end,
           contact_name = case when p_payload ? 'contact_name'
             then nullif(btrim(coalesce(p_payload->>'contact_name', '')), '') else p.contact_name end,
           contact_phone = case when p_payload ? 'contact_phone'
             then nullif(btrim(coalesce(p_payload->>'contact_phone', '')), '') else p.contact_phone end,
           contact_email = case when p_payload ? 'contact_email'
             then nullif(lower(btrim(coalesce(p_payload->>'contact_email', ''))), '') else p.contact_email end,
           room_capacity = case when p_payload ? 'room_capacity'
             then nullif(p_payload->>'room_capacity', '')::int else p.room_capacity end,
           checkin_time = coalesce(nullif(p_payload->>'checkin_time', '')::time, p.checkin_time),
           checkout_time = coalesce(nullif(p_payload->>'checkout_time', '')::time, p.checkout_time),
           languages = v_languages,
           policies = v_policies,
           amenities = v_amenities,
           updated_at = now()
     where p.id = p_property_id
     returning * into v_prop;
  end if;

  if p_submit then
    v_missing := public.acc_property_missing(v_prop.id);
    if jsonb_array_length(v_missing) > 0 then
      return jsonb_build_object(
        'id', v_prop.id, 'status', v_prop.status, 'submitted', false, 'missing', v_missing
      );
    end if;
    update public.acc_properties
       set status = 'pending_verification',
           verification_status = 'pending',
           verification_note = null
     where id = v_prop.id
     returning * into v_prop;

    insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
    values (v_prop.id, v_uid, 'property.submitted', 'property', v_prop.id::text);
  end if;

  v_missing := public.acc_property_missing(v_prop.id);

  return jsonb_build_object(
    'id', v_prop.id,
    'slug', v_prop.slug,
    'name', v_prop.name,
    'status', v_prop.status,
    'verification_status', v_prop.verification_status,
    'submitted', p_submit and v_prop.status = 'pending_verification',
    'missing', v_missing
  );
end;
$$;

grant execute on function public.acc_property_save(uuid, jsonb, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Genel bakış
-- ---------------------------------------------------------------------
create or replace function public.acc_dashboard(
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
  v_prop public.acc_properties%rowtype;
  v_today bigint := 0;
  v_yesterday bigint := 0;
  v_week bigint := 0;
  v_month bigint := 0;
  v_prev_month bigint := 0;
  v_year bigint := 0;
  v_cash_total bigint := 0;
  v_cash bigint := 0;
  v_pos bigint := 0;
  v_bank bigint := 0;
  v_open_balance bigint := 0;
  v_commission_estimate bigint := 0;
  v_commission_final bigint := 0;
  v_commission_paid bigint := 0;
  v_commission_due bigint := 0;
  v_arrivals int := 0;
  v_departures int := 0;
  v_in_house int := 0;
  v_pending int := 0;
  v_created_today int := 0;
  v_available_rooms int := 0;
  v_occupied_rooms int := 0;
  v_out_of_service int := 0;
  v_occupancy numeric := 0;
  v_unread int := 0;
  v_upcoming int := 0;
  v_active_campaigns int := 0;
  v_dirty int := 0;
  v_cleaning int := 0;
  v_maintenance int := 0;
  v_collected_today bigint := 0;
  v_cash_today bigint := 0;
  v_pos_today bigint := 0;
  v_bank_today bigint := 0;
  v_refunds_today bigint := 0;
begin
  select * into v_prop from public.acc_properties where id = p_property_id;

  -- Gecelik gelir paylaştırması: peşin ödenen 3 gecelik konaklama tek günde
  -- tahsil edilse de konaklama geliri gecelere dağıtılır.
  select coalesce(sum(round(r.total_cents::numeric / greatest(r.nights, 1))), 0)
    into v_today
  from public.acc_reservations r
  where r.property_id = p_property_id
    and p_date >= r.check_in and p_date < r.check_out
    and r.status in ('checked_in', 'staying', 'checked_out', 'completed');

  select coalesce(sum(round(r.total_cents::numeric / greatest(r.nights, 1))), 0)
    into v_yesterday
  from public.acc_reservations r
  where r.property_id = p_property_id
    and (p_date - 1) >= r.check_in and (p_date - 1) < r.check_out
    and r.status in ('checked_in', 'staying', 'checked_out', 'completed');

  select coalesce(sum(round(r.total_cents::numeric / greatest(r.nights, 1))), 0)
    into v_week
  from public.acc_reservations r
  where r.property_id = p_property_id
    and daterange(r.check_in, r.check_out, '[)') &&
        daterange(p_date - 6, p_date + 1, '[)')
    and r.status in ('checked_in', 'staying', 'checked_out', 'completed');

  select coalesce(sum(round(r.total_cents::numeric / greatest(r.nights, 1))), 0)
    into v_month
  from public.acc_reservations r
  where r.property_id = p_property_id
    and daterange(r.check_in, r.check_out, '[)') &&
        daterange(date_trunc('month', p_date)::date, p_date + 1, '[)')
    and r.status in ('checked_in', 'staying', 'checked_out', 'completed');

  select coalesce(sum(round(r.total_cents::numeric / greatest(r.nights, 1))), 0)
    into v_prev_month
  from public.acc_reservations r
  where r.property_id = p_property_id
    and daterange(r.check_in, r.check_out, '[)') &&
        daterange(
          (date_trunc('month', p_date) - interval '1 month')::date,
          date_trunc('month', p_date)::date,
          '[)'
        )
    and r.status in ('checked_in', 'staying', 'checked_out', 'completed');

  select coalesce(sum(round(r.total_cents::numeric / greatest(r.nights, 1))), 0)
    into v_year
  from public.acc_reservations r
  where r.property_id = p_property_id
    and daterange(r.check_in, r.check_out, '[)') &&
        daterange(date_trunc('year', p_date)::date, p_date + 1, '[)')
    and r.status in ('checked_in', 'staying', 'checked_out', 'completed');

  select
    coalesce(sum(bal), 0),
    coalesce(sum(case when kind = 'cash' then bal else 0 end), 0),
    coalesce(sum(case when kind = 'pos' then bal else 0 end), 0),
    coalesce(sum(case when kind = 'bank' then bal else 0 end), 0)
    into v_cash_total, v_cash, v_pos, v_bank
  from (
    select a.kind,
      a.opening_balance_cents + coalesce((
        select sum(case
          when t.kind in ('collection', 'transfer_in', 'opening', 'adjustment') then t.amount_cents
          when t.kind in ('expense', 'refund', 'transfer_out') then -t.amount_cents
          else 0 end)
        from public.acc_cash_transactions t
        where t.account_id = a.id and t.occurred_on <= p_date
      ), 0) as bal
    from public.acc_cash_accounts a
    where a.property_id = p_property_id and a.active
  ) q;

  select coalesce(sum(case
      when f.kind = 'charge' then f.amount_cents
      when f.kind = 'payment' then -f.amount_cents
      when f.kind in ('refund', 'adjustment') then f.amount_cents
      else 0 end), 0)
    into v_open_balance
  from public.acc_folio_items f
  join public.acc_reservations r on r.id = f.reservation_id
  where f.property_id = p_property_id
    and r.status not in ('draft', 'declined', 'expired', 'cancelled', 'no_show');

  select coalesce(sum(r.commission_cents), 0)
    into v_commission_estimate
  from public.acc_reservations r
  where r.property_id = p_property_id
    and r.source = 'trabzone'
    and r.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying');

  select coalesce(sum(case when l.kind = 'accrued' then l.amount_cents when l.kind = 'reversed' then -l.amount_cents else 0 end), 0)
    into v_commission_final
  from public.acc_commission_ledger l
  where l.property_id = p_property_id;

  select coalesce(sum(l.amount_cents), 0)
    into v_commission_paid
  from public.acc_commission_ledger l
  where l.property_id = p_property_id and l.kind = 'paid';

  v_commission_due := greatest(0, v_commission_final - v_commission_paid);

  select count(*) into v_arrivals
  from public.acc_reservations r
  where r.property_id = p_property_id and r.check_in = p_date
    and r.status in ('confirmed', 'awaiting_checkin');

  select count(*) into v_departures
  from public.acc_reservations r
  where r.property_id = p_property_id and r.check_out = p_date
    and r.status in ('checked_in', 'staying');

  select count(*) into v_in_house
  from public.acc_reservations r
  where r.property_id = p_property_id
    and p_date >= r.check_in and p_date < r.check_out
    and r.status in ('checked_in', 'staying');

  select count(*) into v_pending
  from public.acc_reservations r
  where r.property_id = p_property_id and r.status = 'pending'
    and (r.hold_expires_at is null or r.hold_expires_at > now());

  select count(*) into v_created_today
  from public.acc_reservations r
  where r.property_id = p_property_id and r.created_at::date = p_date;

  select count(*) into v_out_of_service
  from public.acc_rooms r
  where r.property_id = p_property_id and r.active and r.status = 'out_of_service';

  select count(*) into v_occupied_rooms
  from public.acc_reservations r
  where r.property_id = p_property_id
    and r.room_id is not null
    and r.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'change_pending', 'disputed')
    and (r.status <> 'pending' or r.hold_expires_at is null or r.hold_expires_at > now())
    and p_date >= r.check_in and p_date < r.check_out;

  select greatest(0, count(*) - v_occupied_rooms - v_out_of_service)
    into v_available_rooms
  from public.acc_rooms r
  where r.property_id = p_property_id and r.active and r.status <> 'out_of_service';

  select case when count(*) = 0 then 0
    else round((v_occupied_rooms::numeric / count(*)) * 100, 1) end
    into v_occupancy
  from public.acc_rooms r
  where r.property_id = p_property_id and r.active and r.status <> 'out_of_service';

  select count(*) into v_unread
  from public.acc_messages m
  where m.property_id = p_property_id and m.read_at is null and m.sender_role = 'guest';

  select count(*) into v_upcoming
  from public.acc_reservations r
  where r.property_id = p_property_id
    and r.check_in between p_date and p_date + 7
    and r.status in ('confirmed', 'awaiting_checkin');

  select count(*) into v_active_campaigns
  from public.acc_campaigns c
  where c.property_id = p_property_id
    and c.status = 'active'
    and p_date between c.start_date and c.end_date;

  select count(*) filter (where r.status = 'dirty'),
         count(*) filter (where r.status = 'cleaning'),
         count(*) filter (where r.status = 'maintenance')
    into v_dirty, v_cleaning, v_maintenance
  from public.acc_rooms r
  where r.property_id = p_property_id and r.active;

  select
    coalesce(sum(case when f.kind = 'payment' then f.amount_cents when f.kind = 'refund' then -f.amount_cents else 0 end), 0),
    coalesce(sum(case when f.kind = 'payment' and f.category = 'cash' then f.amount_cents
                      when f.kind = 'refund' and f.category = 'cash' then -f.amount_cents else 0 end), 0),
    coalesce(sum(case when f.kind = 'payment' and f.category = 'pos' then f.amount_cents
                      when f.kind = 'refund' and f.category = 'pos' then -f.amount_cents else 0 end), 0),
    coalesce(sum(case when f.kind = 'payment' and f.category = 'bank' then f.amount_cents
                      when f.kind = 'refund' and f.category = 'bank' then -f.amount_cents else 0 end), 0),
    coalesce(sum(case when f.kind = 'refund' then f.amount_cents else 0 end), 0)
    into v_collected_today, v_cash_today, v_pos_today, v_bank_today, v_refunds_today
  from public.acc_folio_items f
  where f.property_id = p_property_id and f.occurred_on = p_date;

  return jsonb_build_object(
    'property', jsonb_build_object(
      'id', v_prop.id, 'name', v_prop.name, 'status', v_prop.status,
      'verification_status', v_prop.verification_status,
      'property_type', v_prop.property_type,
      'cover_path', v_prop.cover_path, 'district', v_prop.district,
      'commission_rate', v_prop.commission_rate
    ),
    'date', p_date,
    'finance', jsonb_build_object(
      'today_revenue_cents', v_today,
      'yesterday_revenue_cents', v_yesterday,
      'week_revenue_cents', v_week,
      'month_revenue_cents', v_month,
      'prev_month_revenue_cents', v_prev_month,
      'year_revenue_cents', v_year,
      'cash_total_cents', v_cash_total,
      'cash_cents', v_cash,
      'pos_cents', v_pos,
      'bank_cents', v_bank,
      'open_balance_cents', v_open_balance,
      'commission_estimated_cents', v_commission_estimate,
      'commission_finalized_cents', v_commission_final,
      'commission_paid_cents', v_commission_paid,
      'commission_due_cents', v_commission_due,
      'collected_today_cents', v_collected_today,
      'cash_today_cents', v_cash_today,
      'pos_today_cents', v_pos_today,
      'bank_today_cents', v_bank_today,
      'refunds_today_cents', v_refunds_today
    ),
    'operations', jsonb_build_object(
      'arrivals_today', v_arrivals,
      'departures_today', v_departures,
      'in_house', v_in_house,
      'pending_reservations', v_pending,
      'created_today', v_created_today,
      'available_rooms', v_available_rooms,
      'occupied_rooms', v_occupied_rooms,
      'out_of_service_rooms', v_out_of_service,
      'occupancy_rate', v_occupancy,
      'unread_messages', v_unread,
      'upcoming_reservations', v_upcoming,
      'active_campaigns', v_active_campaigns,
      'dirty_rooms', v_dirty,
      'cleaning_rooms', v_cleaning,
      'maintenance_rooms', v_maintenance
    )
  );
end;
$$;

grant execute on function public.acc_dashboard(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Oda takvimi
-- ---------------------------------------------------------------------
create or replace function public.acc_calendar(
  p_property_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'read');
  v_room_types jsonb;
  v_reservations jsonb;
  v_blocks jsonb;
begin
  if p_to <= p_from or (p_to - p_from) > 120 then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rt.id,
    'name', rt.name,
    'base_price_cents', rt.base_price_cents,
    'currency', rt.currency,
    'capacity_adults', rt.capacity_adults,
    'capacity_children', rt.capacity_children,
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.number, 'floor', r.floor,
        'status', r.status, 'active', r.active
      ) order by r.sort_order, r.number)
      from public.acc_rooms r
      where r.room_type_id = rt.id and r.active
    ), '[]'::jsonb)
  ) order by rt.sort_order, rt.created_at), '[]'::jsonb)
  into v_room_types
  from public.acc_room_types rt
  where rt.property_id = p_property_id and rt.active;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'guest_name', r.guest_name,
    'guest_phone', r.guest_phone,
    'room_id', r.room_id,
    'room_number', rm.number,
    'room_type_id', r.room_type_id,
    'rate_plan_id', r.rate_plan_id,
    'check_in', r.check_in,
    'check_out', r.check_out,
    'nights', r.nights,
    'adults', r.adults,
    'children', r.children,
    'status', r.status,
    'source', r.source,
    'booking_mode', r.booking_mode,
    'payment_status', r.payment_status,
    'paid_cents', r.paid_cents,
    'total_cents', r.total_cents,
    'commission_cents', r.commission_cents,
    'currency', r.currency,
    'hold_expires_at', r.hold_expires_at,
    'created_at', r.created_at
  ) order by r.check_in), '[]'::jsonb)
  into v_reservations
  from public.acc_reservations r
  left join public.acc_rooms rm on rm.id = r.room_id
  where r.property_id = p_property_id
    and r.status not in ('draft', 'declined', 'expired')
    and daterange(r.check_in, r.check_out, '[)') && daterange(p_from, p_to, '[)');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'room_id', b.room_id,
    'room_number', rm.number,
    'room_type_id', rm.room_type_id,
    'start_date', b.start_date,
    'end_date', b.end_date,
    'reason', b.reason
  )), '[]'::jsonb)
  into v_blocks
  from public.acc_room_blocks b
  join public.acc_rooms rm on rm.id = b.room_id
  where b.property_id = p_property_id and b.status = 'active'
    and daterange(b.start_date, b.end_date, '[)') && daterange(p_from, p_to, '[)');

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'room_types', v_room_types,
    'reservations', v_reservations,
    'blocks', v_blocks
  );
end;
$$;

grant execute on function public.acc_calendar(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Fiyat ve müsaitlik takvimi
-- ---------------------------------------------------------------------
create or replace function public.acc_rate_calendar(
  p_property_id uuid,
  p_from date,
  p_to date,
  p_room_type_id uuid default null,
  p_rate_plan_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'read');
  v_room_types jsonb;
  v_plans jsonb;
  v_rows jsonb;
begin
  if p_to <= p_from or (p_to - p_from) > 120 then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rt.id, 'name', rt.name, 'base_price_cents', rt.base_price_cents,
    'currency', rt.currency
  ) order by rt.sort_order), '[]'::jsonb)
  into v_room_types
  from public.acc_room_types rt
  where rt.property_id = p_property_id and rt.active
    and (p_room_type_id is null or rt.id = p_room_type_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rp.id, 'name', rp.name, 'room_type_id', rp.room_type_id,
    'booking_mode', rp.booking_mode, 'min_stay', rp.min_stay, 'max_stay', rp.max_stay
  ) order by rp.sort_order), '[]'::jsonb)
  into v_plans
  from public.acc_rate_plans rp
  where rp.property_id = p_property_id and rp.active
    and (p_rate_plan_id is null or rp.id = p_rate_plan_id)
    and (p_room_type_id is null or rp.room_type_id is null or rp.room_type_id = p_room_type_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'room_type_id', q.room_type_id,
    'room_type_name', q.room_type_name,
    'rate_plan_id', q.rate_plan_id,
    'rate_plan_name', q.rate_plan_name,
    'stay_date', q.stay_date,
    'base_price_cents', coalesce(q.rc_price, q.base_price_cents),
    'extra_adult_cents', coalesce(q.extra_adult_cents, 0),
    'extra_child_cents', coalesce(q.extra_child_cents, 0),
    'available_rooms', q.available_rooms,
    'min_stay', coalesce(q.rc_min_stay, q.plan_min_stay),
    'max_stay', coalesce(q.rc_max_stay, q.plan_max_stay),
    'closed', coalesce(q.closed, false),
    'closed_to_arrival', coalesce(q.closed_to_arrival, false),
    'closed_to_departure', coalesce(q.closed_to_departure, false),
    'is_set', q.rc_id is not null
  ) order by q.stay_date, q.room_type_name, q.rate_plan_name), '[]'::jsonb)
  into v_rows
  from (
    select rt.id as room_type_id, rt.name as room_type_name,
           rp.id as rate_plan_id, rp.name as rate_plan_name,
           d::date as stay_date,
           rt.base_price_cents, rp.min_stay as plan_min_stay, rp.max_stay as plan_max_stay,
           rc.id as rc_id, rc.base_price_cents as rc_price,
           rc.extra_adult_cents, rc.extra_child_cents, rc.available_rooms,
           rc.min_stay as rc_min_stay, rc.max_stay as rc_max_stay,
           rc.closed, rc.closed_to_arrival, rc.closed_to_departure
    from generate_series(p_from, p_to - 1, interval '1 day') d
    cross join public.acc_room_types rt
    cross join public.acc_rate_plans rp
    left join public.acc_rate_calendar rc
      on rc.room_type_id = rt.id
     and rc.rate_plan_id = rp.id
     and rc.stay_date = d::date
    where rt.property_id = p_property_id and rt.active
      and rp.property_id = rt.property_id and rp.active
      and (rp.room_type_id is null or rp.room_type_id = rt.id)
      and (p_room_type_id is null or rt.id = p_room_type_id)
      and (p_rate_plan_id is null or rp.id = p_rate_plan_id)
  ) q;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'room_types', v_room_types,
    'rate_plans', v_plans,
    'rows', v_rows
  );
end;
$$;

grant execute on function public.acc_rate_calendar(uuid, date, date, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Toplu fiyat/müsaitlik güncellemesi
-- ---------------------------------------------------------------------
create or replace function public.acc_rate_bulk_update(
  p_property_id uuid,
  p_room_type_ids uuid[],
  p_rate_plan_ids uuid[],
  p_from date,
  p_to date,
  p_action text,
  p_value numeric default null,
  p_dry_run boolean default true,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'rates');
  v_rt record;
  v_rp record;
  v_date date;
  v_rc public.acc_rate_calendar%rowtype;
  v_base bigint;
  v_avail int;
  v_min int;
  v_max int;
  v_closed boolean;
  v_cta boolean;
  v_ctd boolean;
  v_weekday bigint;
  v_weekend bigint;
  v_affected int := 0;
  v_sample jsonb := '[]'::jsonb;
  v_row jsonb;
begin
  if p_to <= p_from or (p_to - p_from) > 120 then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;
  if coalesce(array_length(p_room_type_ids, 1), 0) = 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_action not in (
    'set_price', 'increase_percent', 'decrease_percent', 'set_availability',
    'close', 'open', 'set_min_stay', 'set_max_stay', 'close_arrival', 'open_arrival',
    'close_departure', 'open_departure', 'weekday_weekend'
  ) then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if p_action in (
    'set_price', 'increase_percent', 'decrease_percent', 'set_availability',
    'set_min_stay', 'set_max_stay'
  ) and p_value is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_action in ('set_price', 'weekday_weekend') and coalesce(p_value, 0) <= 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if p_action = 'set_availability' and coalesce(p_value, 0) < 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_action = 'weekday_weekend'
     and (nullif(p_extra->>'weekday_price', '') is null or nullif(p_extra->>'weekend_price', '') is null) then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  v_weekday := nullif(p_extra->>'weekday_price', '')::bigint * 100;
  v_weekend := nullif(p_extra->>'weekend_price', '')::bigint * 100;

  for v_rt in
    select * from public.acc_room_types
    where property_id = p_property_id and active
      and id = any(p_room_type_ids)
    order by sort_order
  loop
    for v_rp in
      select * from public.acc_rate_plans
      where property_id = p_property_id and active
        and (room_type_id is null or room_type_id = v_rt.id)
        and (coalesce(array_length(p_rate_plan_ids, 1), 0) = 0 or id = any(p_rate_plan_ids))
      order by sort_order
    loop
      for v_date in
        select generate_series(p_from, p_to - 1, interval '1 day')::date
      loop
        v_rc := null;
        select * into v_rc from public.acc_rate_calendar
        where room_type_id = v_rt.id and rate_plan_id = v_rp.id and stay_date = v_date;

        v_base := coalesce(v_rc.base_price_cents, v_rt.base_price_cents);
        v_avail := v_rc.available_rooms;
        v_min := coalesce(v_rc.min_stay, v_rp.min_stay);
        v_max := coalesce(v_rc.max_stay, v_rp.max_stay);
        v_closed := coalesce(v_rc.closed, false);
        v_cta := coalesce(v_rc.closed_to_arrival, false);
        v_ctd := coalesce(v_rc.closed_to_departure, false);

        case p_action
          when 'set_price' then v_base := round(p_value * 100);
          when 'increase_percent' then v_base := round(v_base * (1 + p_value / 100.0));
          when 'decrease_percent' then v_base := greatest(0, round(v_base * (1 - p_value / 100.0)));
          when 'set_availability' then v_avail := round(p_value);
          when 'close' then v_closed := true;
          when 'open' then v_closed := false;
          when 'set_min_stay' then v_min := greatest(1, round(p_value));
          when 'set_max_stay' then v_max := greatest(1, round(p_value));
          when 'close_arrival' then v_cta := true;
          when 'open_arrival' then v_cta := false;
          when 'close_departure' then v_ctd := true;
          when 'open_departure' then v_ctd := false;
          when 'weekday_weekend' then
            v_base := case when extract(isodow from v_date) >= 6 then v_weekend else v_weekday end;
          else null;
        end case;

        if v_max is not null and v_max < v_min then
          v_max := v_min;
        end if;

        v_affected := v_affected + 1;

        if jsonb_array_length(v_sample) < 20 then
          v_row := jsonb_build_object(
            'date', v_date,
            'room_type_name', v_rt.name,
            'rate_plan_name', v_rp.name,
            'base_price_cents', v_base,
            'available_rooms', v_avail,
            'min_stay', v_min,
            'max_stay', v_max,
            'closed', v_closed
          );
          v_sample := v_sample || jsonb_build_array(v_row);
        end if;

        if not p_dry_run then
          insert into public.acc_rate_calendar (
            property_id, room_type_id, rate_plan_id, stay_date,
            base_price_cents, available_rooms, min_stay, max_stay,
            closed, closed_to_arrival, closed_to_departure, updated_by
          ) values (
            p_property_id, v_rt.id, v_rp.id, v_date,
            v_base, v_avail, v_min, v_max,
            v_closed, v_cta, v_ctd, v_uid
          )
          on conflict (room_type_id, rate_plan_id, stay_date) do update
            set base_price_cents = excluded.base_price_cents,
                available_rooms = excluded.available_rooms,
                min_stay = excluded.min_stay,
                max_stay = excluded.max_stay,
                closed = excluded.closed,
                closed_to_arrival = excluded.closed_to_arrival,
                closed_to_departure = excluded.closed_to_departure,
                updated_by = excluded.updated_by,
                updated_at = now();
        end if;
      end loop;
    end loop;
  end loop;

  if not p_dry_run then
    insert into public.acc_activity (property_id, actor_id, action, entity_type, detail)
    values (
      p_property_id, v_uid, 'rates.bulk_updated', 'rate_calendar',
      jsonb_build_object('action', p_action, 'from', p_from, 'to', p_to, 'affected', v_affected)
    );
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'action', p_action,
    'from', p_from,
    'to', p_to,
    'affected', v_affected,
    'sample', v_sample
  );
end;
$$;

grant execute on function public.acc_rate_bulk_update(uuid, uuid[], uuid[], date, date, text, numeric, boolean, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Rezervasyon listesi ve detayı
-- ---------------------------------------------------------------------
create or replace function public.acc_reservations_list(
  p_property_id uuid,
  p_status text default null,
  p_from date default null,
  p_to date default null,
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
  from public.acc_reservations r
  where r.property_id = p_property_id
    and (p_status is null or p_status = 'all' or r.status = p_status)
    and (p_from is null or r.check_out > p_from)
    and (p_to is null or r.check_in < p_to)
    and (v_query is null
         or r.guest_name ilike '%' || v_query || '%'
         or r.code ilike '%' || v_query || '%'
         or coalesce(r.guest_phone, '') ilike '%' || v_query || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'guest_name', r.guest_name,
    'guest_phone', r.guest_phone,
    'guest_email', r.guest_email,
    'room_type_id', r.room_type_id,
    'room_type_name', rt.name,
    'room_id', r.room_id,
    'room_number', rm.number,
    'rate_plan_id', r.rate_plan_id,
    'rate_plan_name', rp.name,
    'check_in', r.check_in,
    'check_out', r.check_out,
    'nights', r.nights,
    'adults', r.adults,
    'children', r.children,
    'status', r.status,
    'source', r.source,
    'booking_mode', r.booking_mode,
    'payment_status', r.payment_status,
    'paid_cents', r.paid_cents,
    'total_cents', r.total_cents,
    'commission_cents', r.commission_cents,
    'currency', r.currency,
    'notes', r.notes,
    'hold_expires_at', r.hold_expires_at,
    'created_at', r.created_at
  ) order by r.check_in desc, r.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select * from public.acc_reservations
    where property_id = p_property_id
      and (p_status is null or p_status = 'all' or status = p_status)
      and (p_from is null or check_out > p_from)
      and (p_to is null or check_in < p_to)
      and (v_query is null
           or guest_name ilike '%' || v_query || '%'
           or code ilike '%' || v_query || '%'
           or coalesce(guest_phone, '') ilike '%' || v_query || '%')
    order by check_in desc, created_at desc
    limit v_limit offset v_offset
  ) r
  join public.acc_room_types rt on rt.id = r.room_type_id
  join public.acc_rate_plans rp on rp.id = r.rate_plan_id
  left join public.acc_rooms rm on rm.id = r.room_id;

  return jsonb_build_object(
    'items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset
  );
end;
$$;

grant execute on function public.acc_reservations_list(uuid, text, date, date, text, int, int)
  to authenticated, service_role;

create or replace function public.acc_reservation_detail(p_reservation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.acc_reservations%rowtype;
  v_uid uuid;
  v_actions text[];
begin
  select * into r from public.acc_reservations where id = p_reservation_id;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(r.property_id, 'read');

  v_actions := case
    when r.status = 'pending' then array['confirm', 'decline', 'cancel']
    when r.status = 'confirmed' then array['mark_arrival', 'check_in', 'cancel', 'no_show', 'change_pending', 'dispute']
    when r.status = 'awaiting_checkin' then array['check_in', 'cancel', 'no_show', 'dispute']
    when r.status = 'checked_in' then array['mark_staying', 'check_out', 'dispute']
    when r.status = 'staying' then array['check_out', 'dispute']
    when r.status = 'checked_out' then array['complete', 'dispute']
    when r.status = 'change_pending' then array['confirm', 'cancel']
    when r.status = 'disputed' then array['resolve_dispute']
    else array[]::text[]
  end;

  return jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'property_id', r.property_id,
    'guest_id', r.guest_id,
    'guest_user_id', r.guest_user_id,
    'guest_name', r.guest_name,
    'guest_phone', r.guest_phone,
    'guest_email', r.guest_email,
    'adults', r.adults,
    'children', r.children,
    'room_type_id', r.room_type_id,
    'room_type_name', (select name from public.acc_room_types where id = r.room_type_id),
    'room_id', r.room_id,
    'room_number', (select number from public.acc_rooms where id = r.room_id),
    'rate_plan_id', r.rate_plan_id,
    'rate_plan_name', (select name from public.acc_rate_plans where id = r.rate_plan_id),
    'check_in', r.check_in,
    'check_out', r.check_out,
    'nights', r.nights,
    'status', r.status,
    'source', r.source,
    'booking_mode', r.booking_mode,
    'nightly_price_cents', r.nightly_price_cents,
    'total_cents', r.total_cents,
    'discount_cents', r.discount_cents,
    'commission_rate', r.commission_rate,
    'commission_cents', r.commission_cents,
    'currency', r.currency,
    'payment_status', r.payment_status,
    'paid_cents', r.paid_cents,
    'notes', r.notes,
    'internal_notes', r.internal_notes,
    'hold_expires_at', r.hold_expires_at,
    'created_at', r.created_at,
    'confirmed_at', r.confirmed_at,
    'checked_in_at', r.checked_in_at,
    'checked_out_at', r.checked_out_at,
    'cancelled_at', r.cancelled_at,
    'allowed_actions', to_jsonb(v_actions),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'from_status', h.from_status,
        'to_status', h.to_status,
        'note', h.note,
        'created_at', h.created_at,
        'actor_name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username)
      ) order by h.created_at)
      from public.acc_reservation_status_history h
      left join public.profiles pr on pr.id = h.actor_id
      where h.reservation_id = r.id
    ), '[]'::jsonb),
    'folio', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'kind', f.kind,
        'category', f.category,
        'description', f.description,
        'amount_cents', f.amount_cents,
        'currency', f.currency,
        'occurred_on', f.occurred_on,
        'method', f.method,
        'created_at', f.created_at
      ) order by f.occurred_on, f.created_at)
      from public.acc_folio_items f
      where f.reservation_id = r.id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.acc_reservation_detail(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Rezervasyon oluşturma (otelci / telefon / resepsiyon)
-- ---------------------------------------------------------------------
create or replace function public.acc_reservation_create_manual(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'reservations');
  v_prop public.acc_properties%rowtype;
  v_room_type public.acc_room_types%rowtype;
  v_plan public.acc_rate_plans%rowtype;
  v_room_id uuid;
  v_check_in date := (p_payload->>'check_in')::date;
  v_check_out date := (p_payload->>'check_out')::date;
  v_nights int;
  v_source text := coalesce(p_payload->>'source', '');
  v_nightly bigint;
  v_total bigint;
  v_discount bigint := coalesce((p_payload->>'discount_cents')::bigint, 0);
  v_commission_rate numeric := 0;
  v_guest_id uuid;
  v_guest_user uuid;
  v_status text;
  v_quote jsonb;
  v_res public.acc_reservations%rowtype;
  v_paid bigint := coalesce((p_payload->>'paid_cents')::bigint, 0);
  v_method text := p_payload->>'payment_method';
  v_account uuid := nullif(p_payload->>'cash_account_id', '')::uuid;
begin
  perform public.acc_expire_holds(p_property_id);

  if v_source not in ('trabzone', 'phone', 'front_desk', 'direct_web', 'external_agency', 'other') then
    raise exception 'source_required' using errcode = '22023';
  end if;
  if v_check_in is null or v_check_out is null or v_check_out <= v_check_in then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;
  if coalesce(p_payload->>'guest_name', '') = '' then
    raise exception 'guest_name_required' using errcode = '22023';
  end if;

  select * into v_prop from public.acc_properties where id = p_property_id;
  select * into v_room_type from public.acc_room_types
   where id = (p_payload->>'room_type_id')::uuid and property_id = p_property_id and active;
  if not found then
    raise exception 'room_type_not_found' using errcode = 'P0002';
  end if;
  select * into v_plan from public.acc_rate_plans
   where id = (p_payload->>'rate_plan_id')::uuid and property_id = p_property_id and active;
  if not found then
    raise exception 'rate_plan_not_found' using errcode = 'P0002';
  end if;

  v_nights := v_check_out - v_check_in;
  v_status := case when coalesce(p_payload->>'status', 'confirmed') = 'pending' then 'pending' else 'confirmed' end;

  v_quote := public.acc_quote(
    p_property_id, v_room_type.id, v_plan.id, v_check_in, v_check_out,
    coalesce((p_payload->>'adults')::int, 2),
    coalesce((p_payload->>'children')::int, 0),
    v_source
  );

  v_room_id := nullif(p_payload->>'room_id', '')::uuid;
  if v_room_id is not null then
    if not exists (
      select 1 from public.acc_rooms
      where id = v_room_id and property_id = p_property_id and room_type_id = v_room_type.id and active
    ) then
      raise exception 'room_not_found' using errcode = 'P0002';
    end if;
    if exists (
      select 1 from public.acc_reservations x
      where x.room_id = v_room_id
        and x.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'change_pending', 'disputed')
        and (x.status <> 'pending' or x.hold_expires_at is null or x.hold_expires_at > now())
        and daterange(x.check_in, x.check_out, '[)') && daterange(v_check_in, v_check_out, '[)')
    ) then
      raise exception 'room_unavailable' using errcode = '23505';
    end if;
  else
    select r.id into v_room_id
    from public.acc_rooms r
    where r.property_id = p_property_id and r.room_type_id = v_room_type.id
      and r.active and r.status <> 'out_of_service'
      and not exists (
        select 1 from public.acc_reservations x
        where x.room_id = r.id
          and x.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'change_pending', 'disputed')
          and (x.status <> 'pending' or x.hold_expires_at is null or x.hold_expires_at > now())
          and daterange(x.check_in, x.check_out, '[)') && daterange(v_check_in, v_check_out, '[)')
      )
      and not exists (
        select 1 from public.acc_room_blocks b
        where b.room_id = r.id and b.status = 'active'
          and daterange(b.start_date, b.end_date, '[)') && daterange(v_check_in, v_check_out, '[)')
      )
    order by r.sort_order, r.number limit 1;
  end if;

  if v_room_id is null then
    raise exception 'sold_out' using errcode = '22023';
  end if;

  v_nightly := coalesce(
    (p_payload->>'nightly_price_cents')::bigint,
    round((v_quote->>'total_cents')::numeric / greatest(v_nights, 1))
  );
  v_total := greatest(0, v_nightly * v_nights - v_discount);
  v_commission_rate := case when v_source = 'trabzone' then v_prop.commission_rate else 0 end;

  if nullif(p_payload->>'guest_id', '') is not null then
    select id into v_guest_id from public.acc_guests
     where id = (p_payload->>'guest_id')::uuid and property_id = p_property_id;
  end if;

  if v_guest_id is null then
    select g.id into v_guest_id from public.acc_guests g
     where g.property_id = p_property_id
       and ((nullif(p_payload->>'guest_phone', '') is not null and g.phone = p_payload->>'guest_phone')
         or (nullif(p_payload->>'guest_email', '') is not null and g.email = lower(p_payload->>'guest_email')))
     limit 1;
  end if;

  if v_guest_id is null then
    insert into public.acc_guests
      (property_id, full_name, phone, email, notes, created_by)
    values (
      p_property_id, btrim(p_payload->>'guest_name'),
      nullif(btrim(coalesce(p_payload->>'guest_phone', '')), ''),
      nullif(lower(btrim(coalesce(p_payload->>'guest_email', ''))), ''),
      nullif(btrim(coalesce(p_payload->>'guest_note', '')), ''),
      v_uid
    ) returning id into v_guest_id;
  else
    update public.acc_guests
       set full_name = btrim(p_payload->>'guest_name'),
           phone = coalesce(nullif(btrim(coalesce(p_payload->>'guest_phone', '')), ''), phone),
           email = coalesce(nullif(lower(btrim(coalesce(p_payload->>'guest_email', ''))), ''), email)
     where id = v_guest_id;
  end if;

  if nullif(p_payload->>'guest_email', '') is not null then
    select u.id into v_guest_user
    from auth.users u
    where lower(u.email) = lower(btrim(p_payload->>'guest_email'))
    limit 1;
  end if;

  insert into public.acc_reservations (
    property_id, room_type_id, room_id, rate_plan_id, guest_id, guest_user_id,
    guest_name, guest_phone, guest_email, adults, children, check_in, check_out,
    status, source, booking_mode, nightly_price_cents, total_cents, discount_cents,
    commission_rate, commission_cents, currency, payment_status, paid_cents,
    notes, internal_notes, created_by, confirmed_at
  ) values (
    p_property_id, v_room_type.id, v_room_id, v_plan.id, v_guest_id, v_guest_user,
    btrim(p_payload->>'guest_name'),
    nullif(btrim(coalesce(p_payload->>'guest_phone', '')), ''),
    nullif(lower(btrim(coalesce(p_payload->>'guest_email', ''))), ''),
    coalesce((p_payload->>'adults')::int, 2),
    coalesce((p_payload->>'children')::int, 0),
    v_check_in, v_check_out, v_status, v_source, v_plan.booking_mode,
    v_nightly, v_total, least(v_discount, v_nightly * v_nights),
    v_commission_rate,
    round(v_total * v_commission_rate / 100),
    v_room_type.currency,
    case when v_paid <= 0 then 'unpaid' when v_paid >= v_total then 'paid' else 'partial' end,
    least(v_paid, v_total),
    nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
    nullif(btrim(coalesce(p_payload->>'internal_notes', '')), ''),
    v_uid,
    case when v_status = 'confirmed' then now() else null end
  )
  returning * into v_res;

  insert into public.acc_reservation_status_history
    (reservation_id, from_status, to_status, actor_id, note)
  values (v_res.id, null, v_status, v_uid,
    'Rezervasyon ' || case v_source
      when 'phone' then 'telefonla'
      when 'front_desk' then 'resepsiyondan'
      when 'direct_web' then 'doğrudan web'
      when 'external_agency' then 'harici acente'
      when 'trabzone' then 'Trabzone'
      else 'diğer kanaldan' end || ' oluşturuldu.');

  if v_paid > 0 then
    insert into public.acc_folio_items (
      property_id, reservation_id, kind, category, description,
      amount_cents, currency, occurred_on, method, cash_account_id, created_by
    ) values (
      p_property_id, v_res.id, 'payment',
      case v_method when 'cash' then 'cash' when 'pos' then 'pos' else 'bank' end,
      'Rezervasyon tahsilatı', least(v_paid, v_total), v_res.currency,
      current_date, v_method, v_account, v_uid
    );

    if v_account is not null then
      insert into public.acc_cash_transactions (
        property_id, account_id, kind, amount_cents, currency, occurred_on,
        reservation_id, description, created_by
      ) values (
        p_property_id, v_account, 'collection', least(v_paid, v_total), v_res.currency,
        current_date, v_res.id, 'Rezervasyon tahsilatı', v_uid
      );
    end if;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (
    p_property_id, v_uid, 'reservation.created', 'reservation', v_res.id::text,
    jsonb_build_object('source', v_source, 'status', v_status, 'total_cents', v_total)
  );

  if v_guest_user is not null and coalesce((p_payload->>'send_notification')::boolean, false) then
    insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
    values (
      v_guest_user, v_uid, 'accommodation_reservation',
      case when v_status = 'confirmed' then 'Rezervasyonun onaylandı' else 'Rezervasyon talebin alındı' end,
      v_prop.name || ' · ' || to_char(v_check_in, 'DD.MM.YYYY') || '–' || to_char(v_check_out, 'DD.MM.YYYY'),
      'accommodation_reservation', v_res.id::text, '/konaklama/rezervasyonlarim'
    );
  end if;

  return public.acc_reservation_detail(v_res.id);
end;
$$;

grant execute on function public.acc_reservation_create_manual(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Rezervasyon güncelleme
-- ---------------------------------------------------------------------
create or replace function public.acc_reservation_update(
  p_reservation_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  r public.acc_reservations%rowtype;
  v_prop public.acc_properties%rowtype;
  v_room_type_id uuid;
  v_room_id uuid;
  v_plan_id uuid;
  v_check_in date;
  v_check_out date;
  v_adults int;
  v_children int;
  v_nights int;
  v_nightly bigint;
  v_discount bigint;
  v_total bigint;
  v_quote jsonb;
  v_commission_rate numeric;
  v_old_status text;
begin
  select * into r from public.acc_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(r.property_id, 'reservations');
  if r.status not in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'change_pending') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  select * into v_prop from public.acc_properties where id = r.property_id;
  v_old_status := r.status;

  v_room_type_id := coalesce(nullif(p_payload->>'room_type_id', '')::uuid, r.room_type_id);
  v_plan_id := coalesce(nullif(p_payload->>'rate_plan_id', '')::uuid, r.rate_plan_id);
  v_check_in := coalesce(nullif(p_payload->>'check_in', '')::date, r.check_in);
  v_check_out := coalesce(nullif(p_payload->>'check_out', '')::date, r.check_out);
  v_adults := coalesce(nullif(p_payload->>'adults', '')::int, r.adults);
  v_children := coalesce(nullif(p_payload->>'children', '')::int, r.children);

  if v_check_out <= v_check_in then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;
  if r.status in ('checked_in', 'staying') and v_check_in <> r.check_in then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.acc_room_types
    where id = v_room_type_id and property_id = r.property_id and active
  ) then
    raise exception 'room_type_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.acc_rate_plans
    where id = v_plan_id and property_id = r.property_id and active
      and (room_type_id is null or room_type_id = v_room_type_id)
  ) then
    raise exception 'rate_plan_not_found' using errcode = 'P0002';
  end if;

  v_nights := v_check_out - v_check_in;
  v_quote := public.acc_quote(
    r.property_id, v_room_type_id, v_plan_id, v_check_in, v_check_out,
    v_adults, v_children, r.source
  );

  v_room_id := coalesce(nullif(p_payload->>'room_id', '')::uuid, r.room_id);
  if v_room_id is not null then
    if not exists (
      select 1 from public.acc_rooms
      where id = v_room_id and property_id = r.property_id and room_type_id = v_room_type_id and active
    ) then
      v_room_id := null;
    elsif exists (
      select 1 from public.acc_reservations x
      where x.room_id = v_room_id and x.id <> r.id
        and x.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'change_pending', 'disputed')
        and (x.status <> 'pending' or x.hold_expires_at is null or x.hold_expires_at > now())
        and daterange(x.check_in, x.check_out, '[)') && daterange(v_check_in, v_check_out, '[)')
    ) then
      raise exception 'room_unavailable' using errcode = '23505';
    end if;
  end if;

  if v_room_id is null then
    select rm.id into v_room_id
    from public.acc_rooms rm
    where rm.property_id = r.property_id and rm.room_type_id = v_room_type_id
      and rm.active and rm.status <> 'out_of_service'
      and not exists (
        select 1 from public.acc_reservations x
        where x.room_id = rm.id and x.id <> r.id
          and x.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'change_pending', 'disputed')
          and (x.status <> 'pending' or x.hold_expires_at is null or x.hold_expires_at > now())
          and daterange(x.check_in, x.check_out, '[)') && daterange(v_check_in, v_check_out, '[)')
      )
    order by rm.sort_order, rm.number limit 1;
  end if;

  if v_room_id is null then
    raise exception 'sold_out' using errcode = '22023';
  end if;

  v_nightly := coalesce(
    nullif(p_payload->>'nightly_price_cents', '')::bigint,
    round((v_quote->>'total_cents')::numeric / greatest(v_nights, 1))
  );
  v_discount := coalesce(nullif(p_payload->>'discount_cents', '')::bigint, r.discount_cents);
  v_total := greatest(0, v_nightly * v_nights - v_discount);
  v_commission_rate := case when r.source = 'trabzone' then v_prop.commission_rate else 0 end;

  update public.acc_reservations
     set guest_name = coalesce(nullif(btrim(p_payload->>'guest_name'), ''), guest_name),
         guest_phone = case when p_payload ? 'guest_phone'
           then nullif(btrim(coalesce(p_payload->>'guest_phone', '')), '') else guest_phone end,
         guest_email = case when p_payload ? 'guest_email'
           then nullif(lower(btrim(coalesce(p_payload->>'guest_email', ''))), '') else guest_email end,
         adults = v_adults,
         children = v_children,
         room_type_id = v_room_type_id,
         room_id = v_room_id,
         rate_plan_id = v_plan_id,
         check_in = v_check_in,
         check_out = v_check_out,
         nightly_price_cents = v_nightly,
         total_cents = v_total,
         discount_cents = least(v_discount, v_nightly * v_nights),
         commission_rate = v_commission_rate,
         commission_cents = round(v_total * v_commission_rate / 100),
         notes = case when p_payload ? 'notes'
           then nullif(btrim(coalesce(p_payload->>'notes', '')), '') else notes end,
         internal_notes = case when p_payload ? 'internal_notes'
           then nullif(btrim(coalesce(p_payload->>'internal_notes', '')), '') else internal_notes end
   where id = r.id
  returning * into r;

  insert into public.acc_reservation_status_history
    (reservation_id, from_status, to_status, actor_id, note)
  values (
    r.id, v_old_status,
    case when r.status = 'change_pending' then 'change_pending' else r.status end,
    v_uid, 'Rezervasyon bilgileri güncellendi.'
  );

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (
    r.property_id, v_uid, 'reservation.updated', 'reservation', r.id::text,
    jsonb_build_object('check_in', v_check_in, 'check_out', v_check_out, 'room_id', v_room_id)
  );

  if r.guest_user_id is not null then
    insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
    values (
      r.guest_user_id, v_uid, 'accommodation_reservation', 'Rezervasyonun güncellendi',
      r.code || ' · ' || to_char(v_check_in, 'DD.MM.YYYY') || '–' || to_char(v_check_out, 'DD.MM.YYYY'),
      'accommodation_reservation', r.id::text, '/konaklama/rezervasyonlarim'
    );
  end if;

  return public.acc_reservation_detail(r.id);
end;
$$;

grant execute on function public.acc_reservation_update(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Merkezi durum geçişleri
-- ---------------------------------------------------------------------
create or replace function public.acc_reservation_transition(
  p_reservation_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  r public.acc_reservations%rowtype;
  v_old_status text;
  v_new_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_room_id uuid;
  v_prop public.acc_properties%rowtype;
  v_ledger_exists boolean;
begin
  select * into r from public.acc_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(r.property_id, 'reservations');
  select * into v_prop from public.acc_properties where id = r.property_id;
  v_old_status := r.status;

  case p_action
    when 'confirm' then
      if r.status not in ('pending', 'change_pending') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
      v_new_status := 'confirmed';
      if r.room_id is null then
        select rm.id into v_room_id
        from public.acc_rooms rm
        where rm.property_id = r.property_id and rm.room_type_id = r.room_type_id
          and rm.active and rm.status <> 'out_of_service'
          and not exists (
            select 1 from public.acc_reservations x
            where x.room_id = rm.id and x.id <> r.id
              and x.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'change_pending', 'disputed')
              and daterange(x.check_in, x.check_out, '[)') && daterange(r.check_in, r.check_out, '[)')
          )
        order by rm.sort_order, rm.number limit 1;
        if v_room_id is null then
          raise exception 'sold_out' using errcode = '22023';
        end if;
      end if;
    when 'decline' then
      if r.status <> 'pending' then raise exception 'invalid_transition' using errcode = '22023'; end if;
      v_new_status := 'declined';
    when 'cancel' then
      if r.status not in ('pending', 'confirmed', 'awaiting_checkin', 'change_pending') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
      v_new_status := 'cancelled';
    when 'no_show' then
      if r.status not in ('confirmed', 'awaiting_checkin') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
      v_new_status := 'no_show';
    when 'mark_arrival' then
      if r.status <> 'confirmed' then raise exception 'invalid_transition' using errcode = '22023'; end if;
      v_new_status := 'awaiting_checkin';
    when 'check_in' then
      if r.status not in ('confirmed', 'awaiting_checkin') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
      v_new_status := 'checked_in';
    when 'mark_staying' then
      if r.status <> 'checked_in' then raise exception 'invalid_transition' using errcode = '22023'; end if;
      v_new_status := 'staying';
    when 'check_out' then
      if r.status not in ('checked_in', 'staying') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
      v_new_status := 'checked_out';
    when 'complete' then
      if r.status <> 'checked_out' then raise exception 'invalid_transition' using errcode = '22023'; end if;
      v_new_status := 'completed';
    when 'dispute' then
      if r.status not in ('confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'checked_out', 'completed') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
      v_new_status := 'disputed';
    when 'change_pending' then
      if r.status not in ('confirmed', 'awaiting_checkin') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
      v_new_status := 'change_pending';
    when 'resolve_dispute' then
      if r.status <> 'disputed' then raise exception 'invalid_transition' using errcode = '22023'; end if;
      v_new_status := case
        when r.checked_out_at is not null then 'checked_out'
        when r.checked_in_at is not null then 'staying'
        else 'confirmed'
      end;
    else
      raise exception 'invalid_action' using errcode = '22023';
  end case;

  update public.acc_reservations
     set status = v_new_status,
         room_id = coalesce(v_room_id, room_id),
         hold_expires_at = case when v_new_status in ('confirmed', 'declined', 'cancelled', 'expired', 'no_show') then null else hold_expires_at end,
         confirmed_at = case when p_action = 'confirm' then now() else confirmed_at end,
         checked_in_at = case when p_action = 'check_in' then now() else checked_in_at end,
         checked_out_at = case when p_action = 'check_out' then now() else checked_out_at end,
         cancelled_at = case when p_action in ('cancel', 'decline') then now() else cancelled_at end,
         no_show_at = case when p_action = 'no_show' then now() else no_show_at end,
         cancellation_reason = case when p_action in ('cancel', 'decline', 'no_show') then v_note else cancellation_reason end
   where id = r.id
  returning * into r;

  insert into public.acc_reservation_status_history
    (reservation_id, from_status, to_status, actor_id, note)
  values (r.id, v_old_status, v_new_status, v_uid, v_note);

  if p_action = 'check_out' and r.room_id is not null then
    update public.acc_rooms set status = 'dirty' where id = r.room_id;
    insert into public.acc_housekeeping_tasks
      (property_id, room_id, kind, status, due_date, created_by, note)
    values (r.property_id, r.room_id, 'cleaning', 'pending', current_date, v_uid,
            'Çıkış sonrası temizlik bekliyor.');
  end if;

  if p_action = 'complete' and r.source = 'trabzone' and r.commission_cents > 0 then
    select exists (
      select 1 from public.acc_commission_ledger
      where reservation_id = r.id and kind = 'accrued'
    ) into v_ledger_exists;
    if not v_ledger_exists then
      insert into public.acc_commission_ledger
        (property_id, reservation_id, kind, amount_cents, currency, occurred_on, note, created_by)
      values (r.property_id, r.id, 'accrued', r.commission_cents, r.currency, current_date,
              'Tamamlanan konaklama komisyonu', v_uid);
    end if;
  end if;

  if p_action in ('no_show', 'cancel', 'decline') and r.paid_cents > 0 and v_prop.commission_rate > 0 and r.source = 'trabzone' then
    -- İptal/no-show komisyonu sözleşmeye göre finans ekranından yönetilir;
    -- burada otomatik kesinti yapılmaz, yalnızca hareket kaydı bırakılır.
    insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
    values (r.property_id, v_uid, 'reservation.' || p_action, 'reservation', r.id::text,
            jsonb_build_object('paid_cents', r.paid_cents, 'commission_rate', v_prop.commission_rate));
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (r.property_id, v_uid, 'reservation.' || p_action, 'reservation', r.id::text,
          jsonb_build_object('status', v_new_status, 'note', v_note));

  if r.guest_user_id is not null then
    insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
    values (
      r.guest_user_id, v_uid, 'accommodation_reservation',
      case v_new_status
        when 'confirmed' then 'Rezervasyonun onaylandı'
        when 'declined' then 'Rezervasyon talebin reddedildi'
        when 'cancelled' then 'Rezervasyon iptal edildi'
        when 'no_show' then 'Rezervasyon no-show olarak işaretlendi'
        when 'checked_in' then 'Giriş işlemin tamamlandı'
        when 'checked_out' then 'Çıkış işlemin tamamlandı'
        when 'completed' then 'Konaklaman tamamlandı'
        else 'Rezervasyon durumun güncellendi' end,
      v_prop.name || ' · ' || r.code,
      'accommodation_reservation', r.id::text,
      '/konaklama/rezervasyonlarim'
    );
  end if;

  return public.acc_reservation_detail(r.id);
end;
$$;

grant execute on function public.acc_reservation_transition(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Oda uygunluk listesi (oda değiştirme)
-- ---------------------------------------------------------------------
create or replace function public.acc_reservation_available_rooms(
  p_property_id uuid,
  p_room_type_id uuid,
  p_from date,
  p_to date,
  p_exclude_reservation_id uuid default null
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
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rm.id,
    'number', rm.number,
    'floor', rm.floor,
    'status', rm.status,
    'busy', exists (
      select 1 from public.acc_reservations x
      where x.room_id = rm.id
        and (p_exclude_reservation_id is null or x.id <> p_exclude_reservation_id)
        and x.status in ('pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'staying', 'change_pending', 'disputed')
        and (x.status <> 'pending' or x.hold_expires_at is null or x.hold_expires_at > now())
        and daterange(x.check_in, x.check_out, '[)') && daterange(p_from, p_to, '[)')
    ),
    'blocked', exists (
      select 1 from public.acc_room_blocks b
      where b.room_id = rm.id and b.status = 'active'
        and daterange(b.start_date, b.end_date, '[)') && daterange(p_from, p_to, '[)')
    )
  ) order by rm.sort_order, rm.number), '[]'::jsonb)
  into v_items
  from public.acc_rooms rm
  where rm.property_id = p_property_id and rm.room_type_id = p_room_type_id and rm.active;

  return jsonb_build_object('items', v_items);
end;
$$;

grant execute on function public.acc_reservation_available_rooms(uuid, uuid, date, date, uuid)
  to authenticated, service_role;
