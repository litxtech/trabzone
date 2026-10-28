-- 0075 · Sürücü başvurusu onayı ve yetki açılış zincirini düzeltir.
--
-- Tespit edilen kırık zincir:
--   1. `ride_driver_apply` yalnızca kimlik + ehliyet onayı isterken
--      `ride_admin_driver_decide` kişi düzeyinde ayrıca `insurance` belgesi
--      arıyordu. Kullanıcı başvurusunu gönderebiliyor, yönetici "Sürücülüğü
--      onayla" dediğinde `required_documents_missing` hatası alıyor ve
--      `driver_status` sonsuza kadar `pending` kalıyordu. Yani başvuru kabul
--      edilemiyor, sürücü yetkileri hiç açılmıyor ve kullanıcı ilan
--      yayınlayamıyordu.
--   2. `driver_status` yalnızca kimlik + ehliyet + sigorta üçü de onaylanınca
--      `pending` oluyordu. Sigortası eksik başvurular yönetici kuyruğunda
--      hiç görünmüyordu.
--   3. Yönetici panelinde sürücü başvurularını listeleyen bir kuyruk yoktu;
--      onay yalnızca belge satırındaki bir düğmeye bağlıydı ve o satır
--      "İnceleniyor" filtresinden çıkınca düğme kayboluyordu.
--
-- Kişi düzeyinde sigorta artık sürücü onayı için zorunlu değil: araç onayı
-- zaten `registration` + `insurance` araç belgelerini zorunlu tutuyor
-- (`ride_admin_vehicle_decide`). Böylece "sürücü onayı" ve "araç onayı"
-- birbirini tekrar etmeden, ilan yayınlama koşulu da eksiksiz kalıyor.

-- ---------------------------------------------------------------------
-- 1. Sürücü başvuru kararı: kimlik + geçerli ehliyet yeterli
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_driver_decide(
  p_user_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('ride.verify', false);
  v_identity text;
  v_license boolean;
  v_status text;
begin
  select identity_status into v_identity
  from public.ride_member_profiles where user_id = p_user_id
  for update;
  if v_identity is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  if p_approve then
    if v_identity <> 'approved' then
      raise exception 'identity_not_approved' using errcode = '22023';
    end if;

    select exists (
      select 1 from public.ride_verifications v
      where v.user_id = p_user_id
        and v.kind = 'driver_license'
        and v.status = 'approved'
        and (v.expires_at is null or v.expires_at > current_date)
    ) into v_license;

    if not v_license then
      raise exception 'license_not_approved' using errcode = '22023';
    end if;

    update public.ride_member_profiles
       set driver_status = 'approved'
     where user_id = p_user_id;
    v_status := 'approved';
  else
    if char_length(trim(coalesce(p_reason,''))) < 5 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    update public.ride_member_profiles
       set driver_status = 'rejected'
     where user_id = p_user_id;
    v_status := 'rejected';
  end if;

  perform public.tz_notify(p_user_id, NULL, 'ride',
    case when p_approve then 'Sürücü başvurun onaylandı' else 'Sürücü başvurun reddedildi' end,
    case when p_approve then 'Artık araç ekleyip yolculuk ilanı yayınlayabilirsin. İlan için onaylı bir araç (ruhsat + sigorta) gerekir.'
         else 'Başvurun reddedildi: ' || left(coalesce(p_reason,''), 200) end,
    'ride_member', p_user_id::text, '/ride/verification');

  perform public.tz_admin_audit(
    case when p_approve then 'ride.driver.approve' else 'ride.driver.reject' end,
    'Sürücü başvuru kararı', 'ride_member', p_user_id::text,
    jsonb_build_object('reason', p_reason, 'driver_status', v_status)
  );

  return jsonb_build_object('ok', true, 'driver_status', v_status);
end;
$$;

revoke all on function public.ride_admin_driver_decide(uuid, boolean, text) from public, anon;
grant execute on function public.ride_admin_driver_decide(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Belge onayı sonrası sürücü durumunu erken aç
--    (kimlik + ehliyet yeterli; sigorta artık engel değil)
-- ---------------------------------------------------------------------
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

    if v_v.kind = 'identity' then
      update public.ride_member_profiles set identity_status = 'approved' where user_id = v_v.user_id;
    end if;

    -- Başvuru gönderebilmek için gereken iki belge onaylandığında başvuru
    -- "inceleniyor" durumuna geçer; yönetici kuyruğunda görünür olur.
    -- Yalnızca gerçekten başvuru göndermiş üyeler (driver_bio dolu) kuyruğa girer.
    if v_v.kind in ('identity','driver_license') then
      select (
        exists (
          select 1 from public.ride_verifications x
          where x.user_id = v_v.user_id and x.kind = 'identity' and x.status = 'approved'
            and (x.expires_at is null or x.expires_at > current_date)
        )
        and exists (
          select 1 from public.ride_verifications x
          where x.user_id = v_v.user_id and x.kind = 'driver_license' and x.status = 'approved'
            and (x.expires_at is null or x.expires_at > current_date)
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

    if v_v.kind = 'identity' then
      update public.ride_member_profiles set identity_status = 'rejected' where user_id = v_v.user_id;
    elsif v_v.kind = 'driver_license' then
      update public.ride_member_profiles set driver_status = 'rejected' where user_id = v_v.user_id;
    end if;
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
-- 3. Yönetici için sürücü başvuru kuyruğu
-- ---------------------------------------------------------------------
create or replace function public.ride_admin_driver_applications(
  p_status text default 'pending',
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
  v_uid uuid := public.tz_admin_require('ride.verify', false);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.ride_member_profiles m
  where p_status is null or p_status = 'all' or m.driver_status = p_status;

  select coalesce(jsonb_agg(item order by item->>'updated_at' desc), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'user_id', m.user_id,
      'identity_status', m.identity_status,
      'driver_status', m.driver_status,
      'driver_bio', m.driver_bio,
      'level', m.level,
      'rating_avg', m.rating_avg,
      'completed_trips', m.completed_trips,
      'created_at', m.created_at,
      'updated_at', m.updated_at,
      'user', jsonb_build_object(
        'id', p.id, 'username', p.username,
        'first_name', p.first_name, 'last_name', p.last_name,
        'avatar_path', p.avatar_path, 'is_verified', p.is_verified
      ),
      'license_ok', exists (
        select 1 from public.ride_verifications v
        where v.user_id = m.user_id and v.kind = 'driver_license' and v.status = 'approved'
          and (v.expires_at is null or v.expires_at > current_date)
      ),
      'vehicles', jsonb_build_object(
        'total', (select count(*) from public.ride_vehicles vh where vh.owner_id = m.user_id and vh.is_active),
        'approved', (select count(*) from public.ride_vehicles vh where vh.owner_id = m.user_id and vh.status = 'approved')
      ),
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', v.id, 'kind', v.kind, 'status', v.status,
          'expires_at', v.expires_at, 'reject_reason', v.reject_reason,
          'created_at', v.created_at
        ) order by v.created_at desc)
        from public.ride_verifications v where v.user_id = m.user_id
      ), '[]'::jsonb)
    ) as item
    from public.ride_member_profiles m
    join public.profiles p on p.id = m.user_id
    where p_status is null or p_status = 'all' or m.driver_status = p_status
    order by m.updated_at desc
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.ride_admin_driver_applications(text, integer, integer) from public, anon;
grant execute on function public.ride_admin_driver_applications(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Onay sonrası yarım kalan durumları onar
--    (kimlik + ehliyet onaylı, başvurusu gönderilmiş ama `none` kalmış üyeler)
-- ---------------------------------------------------------------------
update public.ride_member_profiles m
   set driver_status = 'pending'
 where m.driver_status = 'none'
   and m.identity_status = 'approved'
   and m.driver_bio is not null
   and exists (
     select 1 from public.ride_verifications v
     where v.user_id = m.user_id and v.kind = 'driver_license' and v.status = 'approved'
       and (v.expires_at is null or v.expires_at > current_date)
   );
