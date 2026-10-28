-- 0087 · Yolculuk kimlik doğrulaması tutarlılığı
--
-- Sorun: yönetici kimlik belgesini onayladığında `ride_verifications` satırı
-- `approved` oluyor, ancak `ride_member_profiles.identity_status` alanı bazı
-- akışlarda `pending`/`unverified` kalıyordu. Kullanıcı belgesi onaylı olduğu
-- hâlde "doğrulanmadı" görünüyor, tekrar belge yüklemesi isteniyor ve
-- rezervasyon/ilan akışları kimlik hatası veriyordu.
--
-- Çözüm:
--   1. Onaylı ve süresi geçmemiş kimlik belgesini tek kaynak kabul eden
--      `ride_identity_verified` yardımcısı.
--   2. Belge durumu değiştiğinde üyelik profilini otomatik eşitleyen trigger.
--   3. Mevcut tutarsız satırları onaran tek seferlik güncelleme.
--   4. `ride_my_profile` yanıtına hesaplanmış `identity_verified` alanı.
--   5. Rezervasyon JSON'una sürücü/yolcu kimlik bayrakları.

-- ---------------------------------------------------------------------
-- 1. Tek kaynak yardımcıları
-- ---------------------------------------------------------------------
create or replace function public.ride_identity_verified(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.ride_verifications v
    where v.user_id = p_uid
      and v.kind = 'identity'
      and v.status = 'approved'
      and (v.expires_at is null or v.expires_at >= current_date)
  ), false);
$$;

revoke all on function public.ride_identity_verified(uuid) from public, anon, authenticated;

create or replace function public.ride_identity_status_of(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  -- Geçerli onaylı belge her zaman kazanır; aksi halde en yeni başvurunun
  -- durumu geçerlidir. "Herhangi bir pending satır" önceki sürümde eski ve
  -- yarım kalmış başvurular yüzünden onaylı üyeyi sonsuza kadar "pending"
  -- gösterebiliyordu.
  select case
    when exists (
      select 1 from public.ride_verifications v
      where v.user_id = p_uid and v.kind = 'identity' and v.status = 'approved'
        and (v.expires_at is null or v.expires_at >= current_date)
    ) then 'approved'
    else coalesce((
      select case when v.status = 'approved' then 'expired' else v.status end
      from public.ride_verifications v
      where v.user_id = p_uid and v.kind = 'identity'
      order by v.created_at desc
      limit 1
    ), 'unverified')
  end;
$$;

revoke all on function public.ride_identity_status_of(uuid) from public, anon, authenticated;

create or replace function public.ride_sync_identity_status(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := public.ride_identity_status_of(p_uid);
begin
  update public.ride_member_profiles
     set identity_status = v_status,
         updated_at = now()
   where user_id = p_uid
     and identity_status is distinct from v_status;
end;
$$;

revoke all on function public.ride_sync_identity_status(uuid) from public, anon, authenticated;

-- Belge ekleme/onay/ret işlemlerinde profil alanı asla geride kalmaz.
create or replace function public.ride_verifications_identity_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
  else
    v_user := new.user_id;
  end if;
  if (tg_op = 'DELETE' and old.kind = 'identity')
     or (tg_op <> 'DELETE' and new.kind = 'identity') then
    perform public.ride_sync_identity_status(v_user);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.ride_verifications_identity_sync() from public, anon, authenticated;

drop trigger if exists ride_verifications_identity_sync on public.ride_verifications;
create trigger ride_verifications_identity_sync
after insert or update or delete on public.ride_verifications
for each row execute function public.ride_verifications_identity_sync();

-- ---------------------------------------------------------------------
-- 2. Mevcut tutarsız kayıtları onar
-- ---------------------------------------------------------------------
update public.ride_member_profiles m
   set identity_status = public.ride_identity_status_of(m.user_id),
       updated_at = now()
 where m.identity_status is distinct from public.ride_identity_status_of(m.user_id);

-- ---------------------------------------------------------------------
-- 3. Profil yanıtı: hesaplanmış kimlik durumu ve doğrulama zamanı
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
  v_identity_status text;
  v_identity_verified_at timestamptz;
begin
  perform public.ride_member_ensure(v_uid);
  perform public.ride_sync_identity_status(v_uid);

  select * into v_m from public.ride_member_profiles where user_id = v_uid;
  v_identity_status := v_m.identity_status;

  select coalesce(v.reviewed_at, v.created_at) into v_identity_verified_at
  from public.ride_verifications v
  where v.user_id = v_uid
    and v.kind = 'identity'
    and v.status = 'approved'
    and (v.expires_at is null or v.expires_at >= current_date)
  order by v.reviewed_at desc nulls last, v.created_at desc
  limit 1;

  select count(*) into v_vehicle_count
  from public.ride_vehicles where owner_id = v_uid and is_active;

  return jsonb_build_object(
    'user_id', v_uid,
    'identity_status', v_identity_status,
    'identity_verified', v_identity_status = 'approved',
    'identity_verified_at', v_identity_verified_at,
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
        'created_at', v.created_at,
        'reviewed_at', v.reviewed_at,
        'document_path', v.document_path,
        'meta', v.meta
      ) order by v.created_at desc)
      from public.ride_verifications v where v.user_id = v_uid
    ), '[]'::jsonb),
    'policy', public.ride_policy()
  );
end;
$$;

grant execute on function public.ride_my_profile() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Belge gönderimi: onaylı kimlik asla `pending`e düşmez
-- ---------------------------------------------------------------------
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

  if found and v_existing.status = 'approved'
     and (v_existing.expires_at is null or v_existing.expires_at >= current_date) then
    raise exception 'verification_already_approved' using errcode = '22023';
  end if;

  insert into public.ride_verifications (user_id, kind, document_path, expires_at, meta, status)
  values (v_uid, p_kind, p_document_path, p_expires_at, coalesce(p_meta, '{}'::jsonb), 'pending')
  returning id into v_id;

  -- Kimlik durumu trigger tarafından belge kayıtlarından hesaplanır. Süresi
  -- dolmuş onaylı belge varken yeni başvuru `pending` olur; geçerli onaylı
  -- belge varken bu noktaya hiç gelinmez.
  if p_kind = 'identity' then
    perform public.ride_sync_identity_status(v_uid);
  end if;

  perform public.ride_audit(v_uid, 'verification.submit', 'ride_verification', v_id::text,
    jsonb_build_object('kind', p_kind));

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

grant execute on function public.ride_verification_submit(text, text, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Yönetici kararı: profil alanı her zaman belge kayıtlarıyla eşitlenir
-- ---------------------------------------------------------------------
-- 0075 sürümü kimlik reddedildiğinde `identity_status = 'rejected'` yazıyordu.
-- Kullanıcının başka bir geçerli onaylı kimlik belgesi varsa bu yazma,
-- trigger'ın hesapladığı `approved` değerini eziyor ve doğrulanmış üye
-- yeniden "reddedildi" görünüyordu.
create or replace function public.ride_admin_verification_decide(
  p_verification_id uuid,
  p_approve boolean,
  p_reason text default null,
  p_expires_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.verify', false);
  v_v public.ride_verifications%rowtype;
  v_ready boolean;
begin
  select * into v_v from public.ride_verifications where id = p_verification_id for update;
  if not found then
    raise exception 'verification_not_found' using errcode = 'P0002';
  end if;
  if v_v.status <> 'pending' then
    raise exception 'verification_already_decided' using errcode = '22023';
  end if;

  if p_approve then
    update public.ride_verifications
       set status = 'approved', reviewed_by = v_admin, reviewed_at = now(),
           reject_reason = null,
           expires_at = coalesce(p_expires_at, expires_at)
     where id = v_v.id;

    -- Başvuru gönderebilmek için gereken iki belge onaylandığında başvuru
    -- "inceleniyor" durumuna geçer; yönetici kuyruğunda görünür olur.
    if v_v.kind in ('identity','driver_license') then
      select (
        exists (
          select 1 from public.ride_verifications x
          where x.user_id = v_v.user_id and x.kind = 'identity' and x.status = 'approved'
            and (x.expires_at is null or x.expires_at >= current_date)
        )
        and exists (
          select 1 from public.ride_verifications x
          where x.user_id = v_v.user_id and x.kind = 'driver_license' and x.status = 'approved'
            and (x.expires_at is null or x.expires_at >= current_date)
        )
      ) into v_ready;

      update public.ride_member_profiles
         set driver_status = case
           when driver_status in ('none','rejected') and v_ready and driver_bio is not null then 'pending'
           else driver_status end
       where user_id = v_v.user_id;
    end if;
  else
    if char_length(trim(coalesce(p_reason,''))) < 5 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    update public.ride_verifications
       set status = 'rejected', reviewed_by = v_admin, reviewed_at = now(),
           reject_reason = left(p_reason, 400)
     where id = v_v.id;

    if v_v.kind = 'driver_license' then
      update public.ride_member_profiles set driver_status = 'rejected' where user_id = v_v.user_id;
    end if;
  end if;

  -- Kimlikte tek kaynak belge kayıtlarıdır: başka bir geçerli onay varsa
  -- profil `approved` kalır, yoksa en yeni başvurunun durumu yazılır.
  if v_v.kind = 'identity' then
    perform public.ride_sync_identity_status(v_v.user_id);
  end if;

  perform public.tz_notify(v_v.user_id, NULL, 'ride',
    case when p_approve then 'Belgen onaylandı' else 'Belgen reddedildi' end,
    case when p_approve then 'Yolculuk doğrulama belgen incelendi ve onaylandı.'
         else 'Belgen reddedildi: ' || left(coalesce(p_reason,''), 200) end,
    'ride_verification', v_v.id::text, '/ride/verification');

  perform public.tz_admin_audit(
    case when p_approve then 'ride.verification.approve' else 'ride.verification.reject' end,
    'Kimlik/ehliyet doğrulama kararı',
    'ride_verification', v_v.id::text,
    jsonb_build_object('kind', v_v.kind, 'user_id', v_v.user_id, 'reason', p_reason)
  );

  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

revoke all on function public.ride_admin_verification_decide(uuid, boolean, text, date) from public, anon;
grant execute on function public.ride_admin_verification_decide(uuid, boolean, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Sürücü başvurusu: kimlik kontrolü tek kaynaktan
-- ---------------------------------------------------------------------
create or replace function public.ride_driver_apply(p_bio text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_has_license boolean;
begin
  perform public.ride_member_ensure(v_uid);

  if not public.ride_identity_verified(v_uid) then
    raise exception 'identity_required' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.ride_verifications
    where user_id = v_uid and kind = 'driver_license' and status = 'approved'
      and (expires_at is null or expires_at >= current_date)
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
-- 7. Rezervasyon JSON'u: tarafların kimlik doğrulama bayrakları
-- ---------------------------------------------------------------------
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
    'alighting_code', case when o.driver_id = auth.uid() or r.passenger_id = auth.uid() then r.alighting_code else null end,
    'hold_expires_at', r.hold_expires_at,
    'created_at', r.created_at,
    'started_at', r.started_at,
    'boarded_at', r.boarded_at,
    'alighted_at', r.alighted_at,
    'completed_at', r.completed_at,
    'cancelled_at', r.cancelled_at,
    'cancel_reason', r.cancel_reason,
    'note', r.note,
    'policy_version', r.policy_version
  ) || jsonb_build_object(
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
    'driver_identity_verified', public.ride_identity_verified(o.driver_id),
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
    'passenger_identity_verified', public.ride_identity_verified(r.passenger_id),
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
