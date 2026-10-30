-- =====================================================================
-- 0217 — Otel yönetim paneli (3/3)
--
-- * İndirim kampanyaları
-- * Fotoğraf / video medya yönetimi
-- * Personel ve yetkiler
-- * Misafir mesajları, yorumlar
-- * Fatura / belge ve PDF-Excel rapor verisi
-- * Admin tesis doğrulama, hareket kaydı, ayarlar, web takibi
-- =====================================================================

set search_path = public, extensions;

-- Mevcut bildirim türü kısıtı konaklama türlerini kabul etmiyordu.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'follow', 'like', 'comment', 'message', 'group_invite', 'order',
  'market_message', 'support', 'security', 'system', 'mention',
  'ride', 'news', 'live_news', 'live_news_verified', 'live_news_moderation',
  'pharmacy', 'earthquake', 'sports',
  'accommodation_reservation', 'accommodation_message', 'accommodation_review',
  'accommodation_property', 'accommodation_staff'
));

-- ---------------------------------------------------------------------
-- Kampanyalar
-- ---------------------------------------------------------------------
create or replace function public.acc_campaign_list(p_property_id uuid)
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
    'id', c.id,
    'title', c.title,
    'description', c.description,
    'cover_path', c.cover_path,
    'kind', c.kind,
    'start_date', c.start_date,
    'end_date', c.end_date,
    'booking_deadline', c.booking_deadline,
    'room_type_ids', c.room_type_ids,
    'rate_plan_ids', c.rate_plan_ids,
    'discount_percent', c.discount_percent,
    'fixed_price_cents', c.fixed_price_cents,
    'min_nights', c.min_nights,
    'max_nights', c.max_nights,
    'quota', c.quota,
    'used_count', c.used_count,
    'stackable', c.stackable,
    'status', c.status,
    'created_at', c.created_at
  ) order by c.created_at desc), '[]'::jsonb)
  into v_items
  from public.acc_campaigns c
  where c.property_id = p_property_id;

  return jsonb_build_object(
    'items', v_items,
    'room_types', coalesce((
      select jsonb_agg(jsonb_build_object('id', rt.id, 'name', rt.name) order by rt.sort_order)
      from public.acc_room_types rt
      where rt.property_id = p_property_id and rt.active
    ), '[]'::jsonb),
    'rate_plans', coalesce((
      select jsonb_agg(jsonb_build_object('id', rp.id, 'name', rp.name, 'room_type_id', rp.room_type_id) order by rp.sort_order)
      from public.acc_rate_plans rp
      where rp.property_id = p_property_id and rp.active
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.acc_campaign_list(uuid) to authenticated, service_role;

create or replace function public.acc_campaign_upsert(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'campaigns');
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'trabzone');
  v_status text := coalesce(nullif(p_payload->>'status', ''), 'draft');
  v_start date := (p_payload->>'start_date')::date;
  v_end date := (p_payload->>'end_date')::date;
  v_discount numeric := coalesce((p_payload->>'discount_percent')::numeric, 0);
  v_fixed bigint := nullif(p_payload->>'fixed_price_cents', '')::bigint;
  v_room_types uuid[];
  v_rate_plans uuid[];
  c public.acc_campaigns%rowtype;
begin
  if v_kind not in (
    'trabzone', 'last_minute', 'early_booking', 'weekday', 'weekend',
    'long_stay', 'seasonal', 'limited', 'fixed_price', 'percentage', 'special'
  ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_status not in ('draft', 'active', 'paused', 'ended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if v_start is null or v_end is null or v_end < v_start then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;
  if v_discount < 0 or v_discount > 100 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if v_fixed is not null and v_fixed <= 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if v_kind in ('fixed_price') and v_fixed is null then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if v_kind in ('percentage', 'trabzone', 'last_minute', 'early_booking', 'weekday', 'weekend', 'long_stay', 'seasonal', 'limited', 'special')
     and v_fixed is null and v_discount = 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_room_types
  from jsonb_array_elements_text(coalesce(p_payload->'room_type_ids', '[]'::jsonb)) value;
  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_rate_plans
  from jsonb_array_elements_text(coalesce(p_payload->'rate_plan_ids', '[]'::jsonb)) value;

  if v_id is null then
    insert into public.acc_campaigns (
      property_id, title, description, cover_path, kind, start_date, end_date,
      booking_deadline, room_type_ids, rate_plan_ids, discount_percent,
      fixed_price_cents, min_nights, max_nights, quota, stackable, status, created_by
    ) values (
      p_property_id,
      coalesce(nullif(btrim(p_payload->>'title'), ''), 'Yeni Kampanya'),
      nullif(btrim(coalesce(p_payload->>'description', '')), ''),
      nullif(btrim(coalesce(p_payload->>'cover_path', '')), ''),
      v_kind, v_start, v_end,
      nullif(p_payload->>'booking_deadline', '')::date,
      v_room_types, v_rate_plans, v_discount, v_fixed,
      coalesce((p_payload->>'min_nights')::int, 1),
      nullif(p_payload->>'max_nights', '')::int,
      nullif(p_payload->>'quota', '')::int,
      coalesce((p_payload->>'stackable')::boolean, false),
      v_status, v_uid
    ) returning * into c;
  else
    update public.acc_campaigns
       set title = coalesce(nullif(btrim(p_payload->>'title'), ''), title),
           description = case when p_payload ? 'description'
             then nullif(btrim(coalesce(p_payload->>'description', '')), '') else description end,
           cover_path = case when p_payload ? 'cover_path'
             then nullif(btrim(coalesce(p_payload->>'cover_path', '')), '') else cover_path end,
           kind = v_kind,
           start_date = v_start,
           end_date = v_end,
           booking_deadline = case when p_payload ? 'booking_deadline'
             then nullif(p_payload->>'booking_deadline', '')::date else booking_deadline end,
           room_type_ids = v_room_types,
           rate_plan_ids = v_rate_plans,
           discount_percent = v_discount,
           fixed_price_cents = v_fixed,
           min_nights = coalesce(nullif(p_payload->>'min_nights', '')::int, min_nights),
           max_nights = case when p_payload ? 'max_nights'
             then nullif(p_payload->>'max_nights', '')::int else max_nights end,
           quota = case when p_payload ? 'quota'
             then nullif(p_payload->>'quota', '')::int else quota end,
           stackable = coalesce(nullif(p_payload->>'stackable', '')::boolean, stackable),
           status = v_status
     where id = v_id and property_id = p_property_id
     returning * into c;
    if not found then
      raise exception 'campaign_not_found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (p_property_id, v_uid, 'campaign.saved', 'campaign', c.id::text);

  return to_jsonb(c);
end;
$$;

grant execute on function public.acc_campaign_upsert(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_campaign_delete(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.acc_campaigns%rowtype;
  v_uid uuid;
begin
  select * into c from public.acc_campaigns where id = p_campaign_id;
  if not found then
    raise exception 'campaign_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(c.property_id, 'campaigns');
  update public.acc_campaigns set status = 'ended' where id = p_campaign_id;
  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (c.property_id, v_uid, 'campaign.ended', 'campaign', p_campaign_id::text);
  return jsonb_build_object('id', p_campaign_id, 'status', 'ended');
end;
$$;

grant execute on function public.acc_campaign_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Medya
-- ---------------------------------------------------------------------
create or replace function public.acc_media_list(p_property_id uuid)
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
    'id', m.id,
    'room_type_id', m.room_type_id,
    'room_type_name', rt.name,
    'kind', m.kind,
    'category', m.category,
    'storage_path', m.storage_path,
    'thumbnail_path', m.thumbnail_path,
    'caption', m.caption,
    'cover', m.cover,
    'sort_order', m.sort_order,
    'status', m.status,
    'created_at', m.created_at
  ) order by m.cover desc, m.sort_order, m.created_at), '[]'::jsonb)
  into v_items
  from public.acc_property_media m
  left join public.acc_room_types rt on rt.id = m.room_type_id
  where m.property_id = p_property_id;

  return jsonb_build_object(
    'items', v_items,
    'room_types', coalesce((
      select jsonb_agg(jsonb_build_object('id', rt.id, 'name', rt.name) order by rt.sort_order)
      from public.acc_room_types rt
      where rt.property_id = p_property_id and rt.active
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.acc_media_list(uuid) to authenticated, service_role;

create or replace function public.acc_media_add(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'media');
  v_room_type_id uuid := nullif(p_payload->>'room_type_id', '')::uuid;
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'image');
  v_category text := coalesce(nullif(p_payload->>'category', ''), 'general');
  v_cover boolean := coalesce((p_payload->>'cover')::boolean, false);
  v_path text := btrim(coalesce(p_payload->>'storage_path', ''));
  m public.acc_property_media%rowtype;
begin
  if v_path = '' then
    raise exception 'invalid_media_path' using errcode = '22023';
  end if;
  if v_kind not in ('image', 'video') then
    raise exception 'invalid_media_type' using errcode = '22023';
  end if;
  if v_category not in ('cover', 'general', 'room', 'restaurant', 'pool', 'lobby', 'view', 'common') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_room_type_id is not null and not exists (
    select 1 from public.acc_room_types
    where id = v_room_type_id and property_id = p_property_id
  ) then
    raise exception 'room_type_not_found' using errcode = 'P0002';
  end if;

  if v_cover then
    update public.acc_property_media
       set cover = false
     where property_id = p_property_id
       and room_type_id is not distinct from v_room_type_id
       and kind = 'image';
  end if;

  insert into public.acc_property_media (
    property_id, room_type_id, kind, category, storage_path,
    thumbnail_path, caption, cover, sort_order, status, created_by
  ) values (
    p_property_id, v_room_type_id, v_kind, v_category, v_path,
    nullif(btrim(coalesce(p_payload->>'thumbnail_path', '')), ''),
    nullif(btrim(coalesce(p_payload->>'caption', '')), ''),
    v_cover, coalesce((p_payload->>'sort_order')::int, 0), 'approved', v_uid
  ) returning * into m;

  if v_cover and v_kind = 'image' then
    if v_room_type_id is null then
      update public.acc_properties set cover_path = v_path where id = p_property_id;
    else
      update public.acc_room_types set cover_path = v_path where id = v_room_type_id;
    end if;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (p_property_id, v_uid, 'media.added', 'media', m.id::text);

  return to_jsonb(m);
end;
$$;

grant execute on function public.acc_media_add(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_media_update(
  p_media_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.acc_property_media%rowtype;
  v_uid uuid;
  v_cover boolean;
begin
  select * into m from public.acc_property_media where id = p_media_id;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(m.property_id, 'media');
  v_cover := coalesce(nullif(p_payload->>'cover', '')::boolean, m.cover);

  if v_cover and not m.cover then
    update public.acc_property_media
       set cover = false
     where property_id = m.property_id
       and room_type_id is not distinct from m.room_type_id
       and kind = 'image';
  end if;

  update public.acc_property_media
     set category = coalesce(nullif(p_payload->>'category', ''), category),
         caption = case when p_payload ? 'caption'
           then nullif(btrim(coalesce(p_payload->>'caption', '')), '') else caption end,
         cover = v_cover,
         sort_order = coalesce(nullif(p_payload->>'sort_order', '')::int, sort_order)
   where id = p_media_id
  returning * into m;

  if v_cover and m.kind = 'image' then
    if m.room_type_id is null then
      update public.acc_properties set cover_path = m.storage_path where id = m.property_id;
    else
      update public.acc_room_types set cover_path = m.storage_path where id = m.room_type_id;
    end if;
  end if;

  return to_jsonb(m);
end;
$$;

grant execute on function public.acc_media_update(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_media_delete(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.acc_property_media%rowtype;
  v_uid uuid;
begin
  select * into m from public.acc_property_media where id = p_media_id;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(m.property_id, 'media');

  delete from public.acc_property_media where id = p_media_id;

  if m.cover then
    if m.room_type_id is null then
      update public.acc_properties set cover_path = null where id = m.property_id and cover_path = m.storage_path;
    else
      update public.acc_room_types set cover_path = null where id = m.room_type_id and cover_path = m.storage_path;
    end if;
  end if;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (m.property_id, v_uid, 'media.deleted', 'media', p_media_id::text,
          jsonb_build_object('storage_path', m.storage_path, 'kind', m.kind));

  return jsonb_build_object(
    'id', p_media_id, 'storage_path', m.storage_path, 'kind', m.kind, 'deleted', true
  );
end;
$$;

grant execute on function public.acc_media_delete(uuid) to authenticated, service_role;

create or replace function public.acc_media_reorder(
  p_property_id uuid,
  p_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'media');
  i int;
begin
  for i in 1..coalesce(array_length(p_ids, 1), 0) loop
    update public.acc_property_media
       set sort_order = i - 1
     where id = p_ids[i] and property_id = p_property_id;
  end loop;
  insert into public.acc_activity (property_id, actor_id, action, entity_type)
  values (p_property_id, v_uid, 'media.reordered', 'media');
  return jsonb_build_object('reordered', coalesce(array_length(p_ids, 1), 0));
end;
$$;

grant execute on function public.acc_media_reorder(uuid, uuid[]) to authenticated, service_role;

create or replace function public.acc_media_set_cover(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.acc_property_media%rowtype;
begin
  select * into m from public.acc_property_media where id = p_media_id;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  perform public.acc_require(m.property_id, 'media');

  update public.acc_property_media
     set cover = false
   where property_id = m.property_id
     and room_type_id is not distinct from m.room_type_id
     and kind = 'image';

  update public.acc_property_media set cover = true where id = p_media_id returning * into m;

  if m.room_type_id is null then
    update public.acc_properties set cover_path = m.storage_path where id = m.property_id;
  else
    update public.acc_room_types set cover_path = m.storage_path where id = m.room_type_id;
  end if;

  return to_jsonb(m);
end;
$$;

grant execute on function public.acc_media_set_cover(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Personel ve yetkiler
-- ---------------------------------------------------------------------
create or replace function public.acc_staff_list(p_property_id uuid)
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
    'id', s.id,
    'user_id', s.user_id,
    'username', p.username,
    'display_name', coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.username),
    'avatar_path', p.avatar_path,
    'role', s.role,
    'permissions', s.permissions,
    'status', s.status,
    'created_at', s.created_at
  ) order by case s.role when 'owner' then 0 when 'manager' then 1 when 'front_desk' then 2 when 'housekeeping' then 3 when 'accountant' then 4 else 5 end, s.created_at), '[]'::jsonb)
  into v_items
  from public.acc_property_staff s
  join public.profiles p on p.id = s.user_id
  where s.property_id = p_property_id;

  return jsonb_build_object('items', v_items, 'can_manage', public.acc_can(p_property_id, 'staff'));
end;
$$;

grant execute on function public.acc_staff_list(uuid) to authenticated, service_role;

create or replace function public.acc_staff_upsert(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'staff');
  v_user_id uuid := nullif(p_payload->>'user_id', '')::uuid;
  v_username text := lower(btrim(coalesce(p_payload->>'username', '')));
  v_role text := coalesce(nullif(p_payload->>'role', ''), 'viewer');
  v_permissions text[];
  v_existing public.acc_property_staff%rowtype;
  v_profile public.profiles%rowtype;
  v_owner uuid;
begin
  if v_role not in ('manager', 'front_desk', 'housekeeping', 'accountant', 'viewer') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if v_user_id is null then
    if v_username = '' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    select * into v_profile from public.profiles
     where username::text = v_username
        or lower(trim(concat_ws(' ', first_name, last_name))) = v_username
     limit 1;
    if not found then
      raise exception 'user_not_found' using errcode = 'P0002';
    end if;
    v_user_id := v_profile.id;
  else
    select * into v_profile from public.profiles where id = v_user_id;
    if not found then
      raise exception 'user_not_found' using errcode = 'P0002';
    end if;
  end if;

  select owner_id into v_owner from public.acc_properties where id = p_property_id;
  if v_user_id = v_owner then
    raise exception 'cannot_change_owner' using errcode = '22023';
  end if;

  select coalesce(array_agg(value), '{}'::text[]) into v_permissions
  from jsonb_array_elements_text(coalesce(p_payload->'permissions', '[]'::jsonb)) value;

  select * into v_existing from public.acc_property_staff
   where property_id = p_property_id and user_id = v_user_id;

  if found then
    update public.acc_property_staff
       set role = v_role,
           permissions = v_permissions,
           status = 'active'
     where id = v_existing.id
    returning * into v_existing;
  else
    insert into public.acc_property_staff
      (property_id, user_id, role, permissions, status, invited_by)
    values (p_property_id, v_user_id, v_role, v_permissions, 'active', v_uid)
    returning * into v_existing;
  end if;

  insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
  values (
    v_user_id, v_uid, 'accommodation_staff',
    'Tesis yönetimine eklendin',
    (select name from public.acc_properties where id = p_property_id) || ' · ' || v_role,
    'accommodation_property', p_property_id::text, '/konaklama/yonetim'
  );

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (p_property_id, v_uid, 'staff.saved', 'staff', v_existing.id::text,
          jsonb_build_object('user_id', v_user_id, 'role', v_role));

  return to_jsonb(v_existing);
end;
$$;

grant execute on function public.acc_staff_upsert(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_staff_remove(
  p_property_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'staff');
  v_owner uuid;
begin
  select owner_id into v_owner from public.acc_properties where id = p_property_id;
  if p_user_id = v_owner then
    raise exception 'cannot_change_owner' using errcode = '22023';
  end if;
  update public.acc_property_staff
     set status = 'revoked'
   where property_id = p_property_id and user_id = p_user_id;
  if not found then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;
  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (p_property_id, v_uid, 'staff.revoked', 'staff', p_user_id::text);
  return jsonb_build_object('user_id', p_user_id, 'status', 'revoked');
end;
$$;

grant execute on function public.acc_staff_remove(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Mesajlar
-- ---------------------------------------------------------------------
create or replace function public.acc_message_threads(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'messages');
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'reservation_id', q.reservation_id,
    'reservation_code', q.reservation_code,
    'guest_name', q.guest_name,
    'guest_user_id', q.guest_user_id,
    'status', q.status,
    'check_in', q.check_in,
    'check_out', q.check_out,
    'last_message', q.last_message,
    'last_message_at', q.last_message_at,
    'unread_count', q.unread_count
  ) order by q.last_message_at desc nulls last), '[]'::jsonb)
  into v_items
  from (
    select r.id as reservation_id, r.code as reservation_code, r.guest_name,
           r.guest_user_id, r.status, r.check_in, r.check_out,
           (select m.body from public.acc_messages m
             where m.reservation_id = r.id order by m.created_at desc limit 1) as last_message,
           (select max(m.created_at) from public.acc_messages m
             where m.reservation_id = r.id) as last_message_at,
           (select count(*) from public.acc_messages m
             where m.reservation_id = r.id and m.sender_role = 'guest' and m.read_at is null) as unread_count
    from public.acc_reservations r
    where r.property_id = p_property_id
      and exists (select 1 from public.acc_messages m where m.reservation_id = r.id)
      and r.status not in ('draft', 'declined', 'expired')
    order by 7 desc nulls last
  ) q;

  return jsonb_build_object('items', v_items);
end;
$$;

grant execute on function public.acc_message_threads(uuid) to authenticated, service_role;

create or replace function public.acc_messages_list(
  p_property_id uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  r public.acc_reservations%rowtype;
  v_is_staff boolean;
  v_items jsonb;
begin
  select * into r from public.acc_reservations
   where id = p_reservation_id and property_id = p_property_id;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  v_is_staff := public.acc_can(p_property_id, 'messages');
  if not v_is_staff and r.guest_user_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_is_staff then
    update public.acc_messages
       set read_at = now()
     where reservation_id = p_reservation_id and sender_role = 'guest' and read_at is null;
  else
    update public.acc_messages
       set read_at = now()
     where reservation_id = p_reservation_id and sender_role = 'property' and read_at is null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'sender_role', m.sender_role,
    'sender_id', m.sender_id,
    'sender_name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username),
    'body', m.body,
    'read_at', m.read_at,
    'created_at', m.created_at
  ) order by m.created_at), '[]'::jsonb)
  into v_items
  from public.acc_messages m
  left join public.profiles pr on pr.id = m.sender_id
  where m.reservation_id = p_reservation_id;

  return jsonb_build_object(
    'reservation_id', r.id,
    'guest_name', r.guest_name,
    'items', v_items,
    'can_reply', v_is_staff
  );
end;
$$;

grant execute on function public.acc_messages_list(uuid, uuid) to authenticated, service_role;

create or replace function public.acc_message_send(
  p_property_id uuid,
  p_reservation_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  r public.acc_reservations%rowtype;
  v_is_staff boolean;
  v_role text;
  m public.acc_messages%rowtype;
  v_prop_name text;
begin
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'empty_message' using errcode = '22023';
  end if;
  select * into r from public.acc_reservations
   where id = p_reservation_id and property_id = p_property_id;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  v_is_staff := public.acc_can(p_property_id, 'messages');
  if not v_is_staff and r.guest_user_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_role := case when v_is_staff then 'property' else 'guest' end;

  insert into public.acc_messages
    (property_id, reservation_id, guest_user_id, sender_id, sender_role, body)
  values (p_property_id, p_reservation_id, r.guest_user_id, v_uid, v_role, btrim(p_body))
  returning * into m;

  select name into v_prop_name from public.acc_properties where id = p_property_id;

  if v_is_staff then
    if r.guest_user_id is not null then
      insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
      values (
        r.guest_user_id, v_uid, 'accommodation_message',
        v_prop_name || ' mesaj gönderdi', left(btrim(p_body), 120),
        'accommodation_reservation', r.id::text, '/konaklama/rezervasyonlarim'
      );
    end if;
  else
    insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
    select s.user_id, v_uid, 'accommodation_message',
           r.guest_name || ' mesaj gönderdi', left(btrim(p_body), 120),
           'accommodation_reservation', r.id::text, '/konaklama/yonetim/mesajlar'
    from public.acc_property_staff s
    where s.property_id = p_property_id and s.status = 'active'
      and (s.permissions = '{}'::text[] or s.permissions = array['*']::text[] or 'messages' = any(s.permissions));
  end if;

  return to_jsonb(m);
end;
$$;

grant execute on function public.acc_message_send(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Yorumlar
-- ---------------------------------------------------------------------
create or replace function public.acc_reviews_list(
  p_property_id uuid,
  p_status text default null
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
    'id', r.id,
    'reservation_id', r.reservation_id,
    'guest_name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username, 'Misafir'),
    'guest_avatar_path', pr.avatar_path,
    'rating', r.rating,
    'cleanliness', r.cleanliness,
    'staff_score', r.staff_score,
    'location_score', r.location_score,
    'value_score', r.value_score,
    'comment', r.comment,
    'owner_reply', r.owner_reply,
    'status', r.status,
    'created_at', r.created_at,
    'replied_at', r.replied_at
  ) order by r.created_at desc), '[]'::jsonb)
  into v_items
  from public.acc_reviews r
  join public.profiles pr on pr.id = r.guest_user_id
  where r.property_id = p_property_id
    and (p_status is null or p_status = 'all' or r.status = p_status);

  return jsonb_build_object(
    'items', v_items,
    'average', (select coalesce(round(avg(rating)::numeric, 2), 0) from public.acc_reviews where property_id = p_property_id and status = 'published'),
    'count', (select count(*) from public.acc_reviews where property_id = p_property_id and status = 'published')
  );
end;
$$;

grant execute on function public.acc_reviews_list(uuid, text) to authenticated, service_role;

create or replace function public.acc_review_reply(
  p_review_id uuid,
  p_reply text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.acc_reviews%rowtype;
  v_uid uuid;
begin
  select * into r from public.acc_reviews where id = p_review_id;
  if not found then
    raise exception 'review_not_found' using errcode = 'P0002';
  end if;
  v_uid := public.acc_require(r.property_id, 'reviews');
  if length(btrim(coalesce(p_reply, ''))) < 2 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  update public.acc_reviews
     set owner_reply = btrim(p_reply), replied_at = now()
   where id = p_review_id
  returning * into r;

  insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
  values (
    r.guest_user_id, v_uid, 'accommodation_review',
    'Yorumuna otel yanıt verdi', left(btrim(p_reply), 120),
    'accommodation_review', r.id::text, '/konaklama/rezervasyonlarim'
  );

  return to_jsonb(r);
end;
$$;

grant execute on function public.acc_review_reply(uuid, text) to authenticated, service_role;

create or replace function public.acc_review_create(
  p_reservation_id uuid,
  p_rating int,
  p_comment text default null,
  p_cleanliness int default null,
  p_staff_score int default null,
  p_location_score int default null,
  p_value_score int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  r public.acc_reservations%rowtype;
  v_review public.acc_reviews%rowtype;
  v_avg numeric;
  v_count int;
begin
  if p_rating not between 1 and 5 then
    raise exception 'invalid_rating' using errcode = '22023';
  end if;
  select * into r from public.acc_reservations
   where id = p_reservation_id and guest_user_id = v_uid;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  if r.status not in ('checked_out', 'completed') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  insert into public.acc_reviews (
    property_id, reservation_id, guest_user_id, rating,
    cleanliness, staff_score, location_score, value_score, comment
  ) values (
    r.property_id, r.id, v_uid, p_rating,
    p_cleanliness, p_staff_score, p_location_score, p_value_score,
    nullif(btrim(coalesce(p_comment, '')), '')
  ) returning * into v_review;

  select round(avg(rating)::numeric, 2), count(*) into v_avg, v_count
  from public.acc_reviews where property_id = r.property_id and status = 'published';

  update public.acc_properties
     set rating_avg = coalesce(v_avg, 0), rating_count = coalesce(v_count, 0)
   where id = r.property_id;

  return to_jsonb(v_review);
end;
$$;

grant execute on function public.acc_review_create(uuid, int, text, int, int, int, int)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Doğrulama belgeleri
-- ---------------------------------------------------------------------
create or replace function public.acc_property_documents_list(p_property_id uuid)
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
    'id', d.id, 'kind', d.kind, 'title', d.title, 'storage_path', d.storage_path,
    'status', d.status, 'note', d.note, 'review_note', d.review_note,
    'reviewed_at', d.reviewed_at, 'created_at', d.created_at
  ) order by d.created_at), '[]'::jsonb)
  into v_items
  from public.acc_property_documents d
  where d.property_id = p_property_id;
  return jsonb_build_object('items', v_items);
end;
$$;

grant execute on function public.acc_property_documents_list(uuid) to authenticated, service_role;

create or replace function public.acc_property_document_add(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'property');
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'other');
  v_path text := btrim(coalesce(p_payload->>'storage_path', ''));
  d public.acc_property_documents%rowtype;
begin
  if v_kind not in ('business_license', 'tourism_license', 'tax_certificate', 'identity', 'insurance', 'other') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_path = '' then
    raise exception 'invalid_media_path' using errcode = '22023';
  end if;

  insert into public.acc_property_documents
    (property_id, kind, title, storage_path, status, note, uploaded_by)
  values (
    p_property_id, v_kind,
    coalesce(nullif(btrim(p_payload->>'title'), ''), 'Belge'),
    v_path, 'pending',
    nullif(btrim(coalesce(p_payload->>'note', '')), ''),
    v_uid
  ) returning * into d;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (p_property_id, v_uid, 'document.uploaded', 'document', d.id::text);

  return to_jsonb(d);
end;
$$;

grant execute on function public.acc_property_document_add(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Fatura / belge
-- ---------------------------------------------------------------------
create or replace function public.acc_document_create(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'documents');
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'reservation');
  v_reservation_id uuid := nullif(p_payload->>'reservation_id', '')::uuid;
  v_prop public.acc_properties%rowtype;
  r public.acc_reservations%rowtype;
  v_number text;
  v_snapshot jsonb;
  d public.acc_documents%rowtype;
begin
  if v_kind not in ('reservation', 'invoice', 'receipt', 'statement') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_prop from public.acc_properties where id = p_property_id;

  if v_reservation_id is not null then
    select * into r from public.acc_reservations
     where id = v_reservation_id and property_id = p_property_id;
    if not found then
      raise exception 'reservation_not_found' using errcode = 'P0002';
    end if;
  end if;

  v_number := case v_kind
    when 'invoice' then 'FTR-'
    when 'receipt' then 'FIS-'
    when 'statement' then 'EKSTRE-'
    else 'RZ-' end
    || to_char(now(), 'YYYYMMDD') || '-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  v_snapshot := jsonb_build_object(
    'property', jsonb_build_object(
      'name', v_prop.name, 'address', v_prop.address,
      'district', v_prop.district, 'city', v_prop.city,
      'phone', v_prop.phone, 'email', v_prop.email,
      'tax_office', v_prop.tax_office, 'tax_number', v_prop.tax_number,
      'invoice_title', v_prop.invoice_title
    ),
    'reservation', case when v_reservation_id is null then null else jsonb_build_object(
      'id', r.id, 'code', r.code, 'guest_name', r.guest_name,
      'guest_phone', r.guest_phone, 'guest_email', r.guest_email,
      'check_in', r.check_in, 'check_out', r.check_out, 'nights', r.nights,
      'adults', r.adults, 'children', r.children,
      'room_type', (select name from public.acc_room_types where id = r.room_type_id),
      'room_number', (select number from public.acc_rooms where id = r.room_id),
      'rate_plan', (select name from public.acc_rate_plans where id = r.rate_plan_id),
      'nightly_price_cents', r.nightly_price_cents,
      'discount_cents', r.discount_cents,
      'total_cents', r.total_cents,
      'paid_cents', r.paid_cents,
      'payment_status', r.payment_status,
      'commission_rate', r.commission_rate,
      'commission_cents', r.commission_cents,
      'currency', r.currency
    ) end,
    'folio', case when v_reservation_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', f.kind, 'category', f.category, 'description', f.description,
        'amount_cents', f.amount_cents, 'occurred_on', f.occurred_on
      ) order by f.occurred_on, f.created_at)
      from public.acc_folio_items f where f.reservation_id = v_reservation_id
    ), '[]'::jsonb) end,
    'issued_at', now()
  );

  insert into public.acc_documents
    (property_id, reservation_id, kind, number, title, total_cents, currency, snapshot, issued_by)
  values (
    p_property_id, v_reservation_id, v_kind, v_number,
    coalesce(nullif(btrim(p_payload->>'title'), ''), 'Konaklama Belgesi'),
    case when v_reservation_id is null then 0 else r.total_cents end,
    case when v_reservation_id is null then 'TRY' else r.currency end,
    v_snapshot, v_uid
  ) returning * into d;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id)
  values (p_property_id, v_uid, 'document.created', 'document', d.id::text);

  return to_jsonb(d);
end;
$$;

grant execute on function public.acc_document_create(uuid, jsonb) to authenticated, service_role;

create or replace function public.acc_document_attach(
  p_document_id uuid,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.acc_documents%rowtype;
begin
  select * into d from public.acc_documents where id = p_document_id;
  if not found then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  perform public.acc_require(d.property_id, 'documents');
  update public.acc_documents set storage_path = p_storage_path where id = p_document_id
  returning * into d;
  return to_jsonb(d);
end;
$$;

grant execute on function public.acc_document_attach(uuid, text) to authenticated, service_role;

create or replace function public.acc_documents_list(
  p_property_id uuid,
  p_kind text default null
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
    'id', d.id, 'reservation_id', d.reservation_id, 'kind', d.kind,
    'number', d.number, 'title', d.title, 'total_cents', d.total_cents,
    'currency', d.currency, 'storage_path', d.storage_path,
    'issued_at', d.issued_at,
    'guest_name', r.guest_name, 'reservation_code', r.code
  ) order by d.issued_at desc), '[]'::jsonb)
  into v_items
  from public.acc_documents d
  left join public.acc_reservations r on r.id = d.reservation_id
  where d.property_id = p_property_id
    and (p_kind is null or p_kind = 'all' or d.kind = p_kind);
  return jsonb_build_object('items', v_items);
end;
$$;

grant execute on function public.acc_documents_list(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- PDF / Excel rapor verisi
-- ---------------------------------------------------------------------
create or replace function public.acc_report_export(
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
  v_uid uuid := public.acc_require(p_property_id, 'reports');
  v_prop public.acc_properties%rowtype;
  v_daily jsonb;
  v_reservations jsonb;
  v_totals jsonb;
begin
  if p_to < p_from or (p_to - p_from) > 366 then
    raise exception 'invalid_dates' using errcode = '22007';
  end if;
  select * into v_prop from public.acc_properties where id = p_property_id;

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
    ),
    'commission_cents', (
      select coalesce(sum(l.amount_cents), 0)
      from public.acc_commission_ledger l
      where l.property_id = p_property_id and l.kind = 'accrued' and l.occurred_on = d::date
    )
  ) order by d), '[]'::jsonb)
  into v_daily
  from generate_series(p_from, p_to, interval '1 day') d;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', r.code, 'guest_name', r.guest_name, 'source', r.source,
    'status', r.status, 'check_in', r.check_in, 'check_out', r.check_out,
    'nights', r.nights, 'room_type', rt.name, 'room_number', rm.number,
    'adults', r.adults, 'children', r.children,
    'total_cents', r.total_cents, 'paid_cents', r.paid_cents,
    'commission_cents', r.commission_cents, 'currency', r.currency
  ) order by r.check_in), '[]'::jsonb)
  into v_reservations
  from public.acc_reservations r
  join public.acc_room_types rt on rt.id = r.room_type_id
  left join public.acc_rooms rm on rm.id = r.room_id
  where r.property_id = p_property_id
    and daterange(r.check_in, r.check_out, '[)') && daterange(p_from, p_to + 1, '[)');

  select jsonb_build_object(
    'revenue_cents', coalesce((select sum((x->>'revenue_cents')::bigint) from jsonb_array_elements(v_daily) x), 0),
    'collected_cents', coalesce((select sum((x->>'collected_cents')::bigint) from jsonb_array_elements(v_daily) x), 0),
    'expenses_cents', coalesce((select sum((x->>'expenses_cents')::bigint) from jsonb_array_elements(v_daily) x), 0),
    'commission_cents', coalesce((select sum((x->>'commission_cents')::bigint) from jsonb_array_elements(v_daily) x), 0),
    'reservation_count', jsonb_array_length(v_reservations)
  ) into v_totals;

  return jsonb_build_object(
    'property', jsonb_build_object(
      'id', v_prop.id, 'name', v_prop.name, 'district', v_prop.district,
      'address', v_prop.address, 'phone', v_prop.phone, 'email', v_prop.email,
      'tax_office', v_prop.tax_office, 'tax_number', v_prop.tax_number
    ),
    'from', p_from,
    'to', p_to,
    'daily', v_daily,
    'reservations', v_reservations,
    'totals', v_totals,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.acc_report_export(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Admin tesis doğrulama
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
    'district', p.district,
    'address', p.address,
    'phone', p.phone,
    'email', p.email,
    'tax_number', p.tax_number,
    'created_at', p.created_at,
    'owner', jsonb_build_object(
      'id', pr.id, 'username', pr.username,
      'display_name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username),
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
  join public.profiles pr on pr.id = p.owner_id
  where p_status is null or p_status = 'all' or p.status = p_status;

  return jsonb_build_object(
    'items', v_items,
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.acc_properties where status = 'pending_verification'),
      'published', (select count(*) from public.acc_properties where status = 'published'),
      'rejected', (select count(*) from public.acc_properties where status = 'rejected'),
      'suspended', (select count(*) from public.acc_properties where status = 'suspended')
    )
  );
end;
$$;

grant execute on function public.acc_admin_properties(text) to authenticated, service_role;

create or replace function public.acc_admin_review_property(
  p_property_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  p public.acc_properties%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into p from public.acc_properties where id = p_property_id for update;
  if not found then
    raise exception 'property_not_found' using errcode = 'P0002';
  end if;

  if p_approve then
    update public.acc_properties
       set status = 'published',
           verification_status = 'verified',
           verification_note = nullif(btrim(coalesce(p_note, '')), ''),
           verified_at = now(),
           verified_by = v_uid,
           published_at = coalesce(published_at, now())
     where id = p_property_id
     returning * into p;

    update public.acc_property_documents
       set status = 'approved', reviewed_by = v_uid, reviewed_at = now()
     where property_id = p_property_id and status = 'pending';
  else
    update public.acc_properties
       set status = 'rejected',
           verification_status = 'rejected',
           verification_note = nullif(btrim(coalesce(p_note, '')), ''),
           verified_at = now(),
           verified_by = v_uid
     where id = p_property_id
     returning * into p;

    update public.acc_property_documents
       set status = 'rejected', review_note = nullif(btrim(coalesce(p_note, '')), ''),
           reviewed_by = v_uid, reviewed_at = now()
     where property_id = p_property_id and status = 'pending';
  end if;

  insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
  values (
    p.owner_id, v_uid, 'accommodation_property',
    case when p_approve then 'Tesisin doğrulandı ve yayında' else 'Tesis doğrulaması reddedildi' end,
    p.name || coalesce(' · ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
    'accommodation_property', p.id::text,
    case when p_approve then '/konaklama/yonetim' else '/konaklama/otel-ekle' end
  );

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (p_property_id, v_uid,
          case when p_approve then 'admin.approved' else 'admin.rejected' end,
          'property', p_property_id::text,
          jsonb_build_object('note', p_note));

  return jsonb_build_object(
    'id', p.id, 'status', p.status, 'verification_status', p.verification_status
  );
end;
$$;

grant execute on function public.acc_admin_review_property(uuid, boolean, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Hareket kaydı
-- ---------------------------------------------------------------------
create or replace function public.acc_activity_list(
  p_property_id uuid,
  p_limit int default 50
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
    'id', a.id,
    'action', a.action,
    'entity_type', a.entity_type,
    'entity_id', a.entity_id,
    'detail', a.detail,
    'created_at', a.created_at,
    'actor_name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username)
  ) order by a.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select * from public.acc_activity
    where property_id = p_property_id
    order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) a
  left join public.profiles pr on pr.id = a.actor_id;

  return jsonb_build_object('items', v_items);
end;
$$;

grant execute on function public.acc_activity_list(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tesis ayarları ve web takibi
-- ---------------------------------------------------------------------
create or replace function public.acc_property_settings_update(
  p_property_id uuid,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'settings');
  v_current jsonb;
  v_patch jsonb;
  v_hold int;
begin
  select settings into v_current from public.acc_properties where id = p_property_id;
  v_current := coalesce(v_current, '{}'::jsonb);

  v_patch := jsonb_strip_nulls(jsonb_build_object(
    'hold_minutes', p_settings->'hold_minutes',
    'notify_new_reservation', p_settings->'notify_new_reservation',
    'notify_cancellation', p_settings->'notify_cancellation',
    'notify_messages', p_settings->'notify_messages',
    'auto_checkout', p_settings->'auto_checkout',
    'web_tracking', p_settings->'web_tracking'
  ));

  v_hold := nullif(v_patch->>'hold_minutes', '')::int;
  if v_hold is not null and (v_hold < 5 or v_hold > 1440) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  update public.acc_properties
     set settings = v_current || v_patch
   where id = p_property_id
  returning settings into v_current;

  insert into public.acc_activity (property_id, actor_id, action, entity_type)
  values (p_property_id, v_uid, 'settings.updated', 'property');

  return v_current;
end;
$$;

grant execute on function public.acc_property_settings_update(uuid, jsonb)
  to authenticated, service_role;

create or replace function public.acc_web_tracking(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'read');
  p public.acc_properties%rowtype;
  v_reservations int := 0;
  v_direct int := 0;
  v_revenue bigint := 0;
  v_last30 int := 0;
  v_sources jsonb;
begin
  select * into p from public.acc_properties where id = p_property_id;

  select count(*) into v_reservations
  from public.acc_reservations r
  where r.property_id = p_property_id and r.status not in ('draft', 'declined', 'expired');

  select count(*) into v_direct
  from public.acc_reservations r
  where r.property_id = p_property_id and r.source = 'direct_web'
    and r.status not in ('draft', 'declined', 'expired');

  select coalesce(sum(r.total_cents), 0) into v_revenue
  from public.acc_reservations r
  where r.property_id = p_property_id
    and r.status in ('checked_out', 'completed');

  select count(*) into v_last30
  from public.acc_reservations r
  where r.property_id = p_property_id and r.created_at >= now() - interval '30 days';

  select coalesce(jsonb_agg(jsonb_build_object(
    'source', q.source, 'count', q.cnt
  ) order by q.cnt desc), '[]'::jsonb)
  into v_sources
  from (
    select r.source, count(*) as cnt
    from public.acc_reservations r
    where r.property_id = p_property_id and r.status not in ('draft', 'declined', 'expired')
    group by r.source
  ) q;

  return jsonb_build_object(
    'slug', p.slug,
    'status', p.status,
    'verification_status', p.verification_status,
    'published_at', p.published_at,
    'view_count', p.view_count,
    'reservation_count', v_reservations,
    'direct_web_count', v_direct,
    'last_30_days', v_last30,
    'completed_revenue_cents', v_revenue,
    'conversion_rate', case when p.view_count > 0
      then round((v_reservations::numeric / p.view_count) * 100, 2) else 0 end,
    'sources', v_sources
  );
end;
$$;

grant execute on function public.acc_web_tracking(uuid) to authenticated, service_role;
