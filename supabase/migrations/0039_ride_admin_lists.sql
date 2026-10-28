-- =====================================================================
-- 0039 — Yolculuk admin: yolcu talepleri, bekleme listeleri,
--        değerlendirmeler ve düzenli plan listeleri.
--
-- Okuma fonksiyonları ride.view, moderasyon işlemleri ride.moderate izni
-- ister. Tüm kararlar tz_admin_audit ile denetim kaydı üretir.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. Yolcu talepleri
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_requests(
  p_status text default null,
  p_query text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.ride_requests r
  join public.profiles p on p.id = r.passenger_id
  where (p_status is null or p_status = 'all' or r.status = p_status)
    and (p_query is null or p_query = ''
      or r.origin_label ilike '%' || p_query || '%'
      or r.dest_label ilike '%' || p_query || '%'
      or r.origin_city ilike '%' || p_query || '%'
      or r.dest_city ilike '%' || p_query || '%'
      or p.username::text ilike '%' || p_query || '%');

  select coalesce(jsonb_agg(item order by item->>'created_at' desc), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', r.id,
      'scope', r.scope,
      'origin_label', r.origin_label,
      'origin_city', r.origin_city,
      'dest_label', r.dest_label,
      'dest_city', r.dest_city,
      'earliest_depart', r.earliest_depart,
      'latest_depart', r.latest_depart,
      'party_size', r.party_size,
      'luggage', r.luggage,
      'preferences', r.preferences,
      'mandatory', r.mandatory,
      'status', r.status,
      'notes', r.notes,
      'created_at', r.created_at,
      'expires_at', r.expires_at,
      'passenger', jsonb_build_object(
        'id', p.id, 'username', p.username, 'first_name', p.first_name,
        'last_name', p.last_name, 'avatar_path', p.avatar_path,
        'identity_status', m.identity_status, 'level', m.level,
        'rating_avg', m.rating_avg, 'completed_trips', m.completed_trips
      )
    ) as item
    from public.ride_requests r
    join public.profiles p on p.id = r.passenger_id
    left join public.ride_member_profiles m on m.user_id = r.passenger_id
    where (p_status is null or p_status = 'all' or r.status = p_status)
      and (p_query is null or p_query = ''
        or r.origin_label ilike '%' || p_query || '%'
        or r.dest_label ilike '%' || p_query || '%'
        or r.origin_city ilike '%' || p_query || '%'
        or r.dest_city ilike '%' || p_query || '%'
        or p.username::text ilike '%' || p_query || '%')
    order by r.created_at desc
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

grant execute on function public.ride_admin_requests(text, text, integer, integer) to authenticated;

create or replace function public.ride_admin_request_action(
  p_request_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.moderate', false);
  v_request public.ride_requests;
begin
  select * into v_request from public.ride_requests where id = p_request_id for update;
  if not found then
    raise exception 'Yolcu talebi bulunamadı.' using errcode = 'P0002';
  end if;
  if p_action not in ('close', 'expire') then
    raise exception 'Geçersiz işlem.' using errcode = '22023';
  end if;
  if v_request.status in ('closed', 'expired') then
    return jsonb_build_object('ok', true, 'status', v_request.status);
  end if;

  update public.ride_requests
  set status = case when p_action = 'close' then 'closed' else 'expired' end,
      updated_at = now()
  where id = p_request_id;

  perform public.tz_notify(
    v_request.passenger_id, v_uid, 'ride', 'Yolcu talebi kapatıldı',
    coalesce(nullif(p_reason, ''), 'Talebiniz yönetici tarafından kapatıldı.'),
    'ride_request', p_request_id::text, '/ride'
  );

  perform public.tz_admin_audit(
    'ride.request.' || p_action, 'Yolcu talebi moderasyonu',
    'ride_request', p_request_id::text,
    jsonb_build_object('reason', p_reason, 'status', v_request.status)
  );

  return jsonb_build_object('ok', true, 'status', case when p_action = 'close' then 'closed' else 'expired' end);
end;
$$;

grant execute on function public.ride_admin_request_action(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Bekleme listeleri
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_waitlists(
  p_status text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.ride_waitlists w
  where (p_status is null or p_status = 'all' or w.status = p_status);

  select coalesce(jsonb_agg(item order by item->>'created_at' desc), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', w.id,
      'offer_id', w.offer_id,
      'seats', w.seats,
      'pickup_seq', w.pickup_seq,
      'dropoff_seq', w.dropoff_seq,
      'status', w.status,
      'created_at', w.created_at,
      'position', (
        select count(*) from public.ride_waitlists w2
        where w2.offer_id = w.offer_id and w2.status = 'waiting'
          and w2.created_at <= w.created_at
      ),
      'user', jsonb_build_object(
        'id', p.id, 'username', p.username, 'first_name', p.first_name,
        'last_name', p.last_name, 'is_verified', m.identity_status = 'approved'
      ),
      'offer', jsonb_build_object(
        'id', o.id, 'origin_label', o.origin_label, 'origin_city', o.origin_city,
        'dest_label', o.dest_label, 'dest_city', o.dest_city,
        'depart_at', o.depart_at, 'status', o.status, 'seats_total', o.seats_total
      ),
      'active_offer', (
        select jsonb_build_object('id', wo.id, 'status', wo.status, 'expires_at', wo.expires_at)
        from public.ride_waitlist_offers wo
        where wo.waitlist_id = w.id and wo.status = 'offered' and wo.expires_at > now()
        order by wo.created_at desc limit 1
      )
    ) as item
    from public.ride_waitlists w
    join public.profiles p on p.id = w.user_id
    left join public.ride_member_profiles m on m.user_id = w.user_id
    join public.ride_offers o on o.id = w.offer_id
    where (p_status is null or p_status = 'all' or w.status = p_status)
    order by w.created_at desc
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

grant execute on function public.ride_admin_waitlists(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Değerlendirmeler
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_reviews(
  p_status text default null,
  p_query text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.ride_reviews rv
  join public.profiles a on a.id = rv.author_id
  where (p_status is null or p_status = 'all' or rv.status = p_status)
    and (p_query is null or p_query = ''
      or a.username::text ilike '%' || p_query || '%'
      or rv.comment ilike '%' || p_query || '%');

  select coalesce(jsonb_agg(item order by item->>'created_at' desc), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', rv.id,
      'rating', rv.rating,
      'comment', rv.comment,
      'categories', rv.categories,
      'status', rv.status,
      'author_role', rv.author_role,
      'created_at', rv.created_at,
      'reservation_id', rv.reservation_id,
      'author', jsonb_build_object(
        'id', a.id, 'username', a.username, 'first_name', a.first_name,
        'last_name', a.last_name, 'avatar_path', a.avatar_path
      ),
      'subject', jsonb_build_object(
        'id', s.id, 'username', s.username, 'first_name', s.first_name,
        'last_name', s.last_name, 'avatar_path', s.avatar_path
      ),
      'reservation', jsonb_build_object(
        'origin_label', o.origin_label, 'dest_label', o.dest_label,
        'depart_at', o.depart_at, 'status', r.status
      )
    ) as item
    from public.ride_reviews rv
    join public.profiles a on a.id = rv.author_id
    join public.profiles s on s.id = rv.subject_id
    join public.ride_reservations r on r.id = rv.reservation_id
    join public.ride_offers o on o.id = r.offer_id
    where (p_status is null or p_status = 'all' or rv.status = p_status)
      and (p_query is null or p_query = ''
        or a.username::text ilike '%' || p_query || '%'
        or rv.comment ilike '%' || p_query || '%')
    order by rv.created_at desc
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

grant execute on function public.ride_admin_reviews(text, text, integer, integer) to authenticated;

create or replace function public.ride_admin_review_moderate(
  p_review_id uuid,
  p_hide boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.moderate', false);
  v_review public.ride_reviews;
begin
  select * into v_review from public.ride_reviews where id = p_review_id for update;
  if not found then
    raise exception 'Değerlendirme bulunamadı.' using errcode = 'P0002';
  end if;

  update public.ride_reviews
  set status = case when p_hide then 'hidden' else 'published' end
  where id = p_review_id;

  if p_hide then
    perform public.tz_notify(
      v_review.author_id, v_uid, 'ride', 'Değerlendirme yayından kaldırıldı',
      coalesce(nullif(p_reason, ''), 'Değerlendirmeniz topluluk kuralları kapsamında incelendi.'),
      'ride_review', p_review_id::text, '/ride'
    );
  end if;

  perform public.tz_admin_audit(
    case when p_hide then 'ride.review.hide' else 'ride.review.publish' end,
    'Değerlendirme moderasyonu',
    'ride_review', p_review_id::text,
    jsonb_build_object('reason', p_reason, 'hidden', p_hide)
  );

  return jsonb_build_object('ok', true, 'status', case when p_hide then 'hidden' else 'published' end);
end;
$$;

grant execute on function public.ride_admin_review_moderate(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Düzenli yolculuk planları
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_recurring(
  p_active boolean default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('ride.view', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.ride_recurring_schedules rs
  where (p_active is null or rs.is_active = p_active);

  select coalesce(jsonb_agg(item order by item->>'created_at' desc), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', rs.id,
      'role', rs.role,
      'scope', rs.scope,
      'origin_label', rs.origin_label,
      'origin_city', rs.origin_city,
      'dest_label', rs.dest_label,
      'dest_city', rs.dest_city,
      'weekdays', rs.weekdays,
      'depart_time', rs.depart_time,
      'return_time', rs.return_time,
      'seats', rs.seats,
      'price_per_seat_cents', rs.price_per_seat_cents,
      'is_active', rs.is_active,
      'paused_dates', rs.paused_dates,
      'paused_until', rs.paused_until,
      'created_at', rs.created_at,
      'user', jsonb_build_object(
        'id', p.id, 'username', p.username, 'first_name', p.first_name,
        'last_name', p.last_name, 'identity_status', m.identity_status,
        'driver_status', m.driver_status
      ),
      'generated_offers', (
        select count(*) from public.ride_offers o
        where o.recurring_id = rs.id and o.depart_at > now()
      )
    ) as item
    from public.ride_recurring_schedules rs
    join public.profiles p on p.id = rs.user_id
    left join public.ride_member_profiles m on m.user_id = rs.user_id
    where (p_active is null or rs.is_active = p_active)
    order by rs.created_at desc
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

grant execute on function public.ride_admin_recurring(boolean, integer, integer) to authenticated;
