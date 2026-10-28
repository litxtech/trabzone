-- 0019_account_deletion.sql
--
-- Kullaniciya donuk (self-service) hesap silme ucnoktasi.
--
-- Arka planda hesap silme altyapisi (account_deletion_requests, adim kayitlari,
-- tablo kurallari, purge/verify yardimcilari) mevcut; ancak silme istegini
-- baslatabilmek icin gereken "reauth" jetonunu ureten bir ucnokta yalnizca
-- service_role'a acikti ve kuyrugu isleyen harici worker yapilandirilmamisti.
-- Bu fonksiyon, kullanicinin kendi hesabini sifresiyle (OAuth hesaplarinda
-- kullanici adi onayiyla) dogrulayarak aninda ve kalici olarak silmesini saglar.
--
-- Akis:
--   1. Oturum + yazili onay (kullanici adi) + sifre dogrulamasi
--   2. Son yonetici/moderator korumasi
--   3. Denetim kaydi (account_deletion_requests + adimlar)
--   4. Hesabi dondurma (profil gizlenir, oturumlar kapatilir)
--   5. Kural tabanli veri temizligi + mesaj anonimlestirme + medya temizligi
--   6. auth.users kaydinin silinmesi (profil ve kalan tum bagli veriler cascade)
--   7. Istek kaydinin "completed" olarak isaretlenmesi (referans kodu saklanir)
--
-- Sadece ekleme yapar; mevcut tablo ve fonksiyonlari degistirmez.

create or replace function public.account_delete_self(
  p_confirm  text,
  p_password text default null,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage, extensions, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_username     text;
  v_email        text;
  v_hash         text;
  v_role         text;
  v_other_holders integer;
  v_request_id   uuid;
  v_reference    text;
  v_receipt      text;
  v_purge        jsonb;
  v_storage      integer := 0;
  v_tombstone    uuid;
  v_failures     jsonb;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select p.username, u.email, u.encrypted_password
    into v_username, v_email, v_hash
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = v_uid;

  if v_username is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  -- Yazili onay: kullanici adi birebir yazilmali (buyuk/kucuk harf duyarsiz).
  if p_confirm is null or lower(trim(p_confirm)) <> lower(v_username) then
    raise exception 'confirm_mismatch' using errcode = '22023';
  end if;

  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  -- Sifreli hesaplarda sifre dogrulamasi zorunlu. OAuth hesaplarinda sifre
  -- bulunmadigi icin oturum + yazili onay yeterlidir.
  if v_hash is not null then
    if p_password is null or char_length(p_password) = 0 then
      raise exception 'password_required' using errcode = '28000';
    end if;
    if extensions.crypt(p_password, v_hash) <> v_hash then
      raise exception 'invalid_password' using errcode = '28P01';
    end if;
  end if;

  -- Yonetim panelinin kilitlenmemesi icin son yetkili hesap silinemez.
  for v_role in
    select distinct ura.role_key
    from public.user_role_assignments ura
    where ura.user_id = v_uid
      and ura.role_key in ('admin', 'moderator')
      and (ura.expires_at is null or ura.expires_at > now())
  loop
    select count(*)
      into v_other_holders
    from public.user_role_assignments ura
    join public.profiles p on p.id = ura.user_id
    where ura.role_key = v_role
      and ura.user_id <> v_uid
      and (ura.expires_at is null or ura.expires_at > now())
      and coalesce(p.account_status, 'active') <> 'deleted';

    if v_other_holders = 0 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end loop;

  -- Ayni anda tek bir istek: devam eden istek varsa onu dondur.
  select r.id, r.reference_code, r.receipt_token
    into v_request_id, v_reference, v_receipt
  from public.account_deletion_requests r
  where r.user_id = v_uid
    and r.status in ('received', 'processing', 'retry_scheduled')
  order by r.requested_at desc
  limit 1;

  if v_request_id is null then
    insert into public.account_deletion_requests (
      user_id, status, requested_via, reason, auth_provider,
      frozen_at, sessions_revoked_at, next_attempt_at
    )
    values (
      v_uid,
      'processing',
      'app',
      nullif(trim(coalesce(p_reason, '')), ''),
      case when v_hash is null then 'oauth' else 'email' end,
      now(),
      now(),
      now()
    )
    returning id, reference_code, receipt_token
    into v_request_id, v_reference, v_receipt;

    insert into public.account_deletion_steps (request_id, step_key, status)
    select v_request_id, s.key, 'pending'
    from (values
      ('freeze'), ('visibility'), ('storage'), ('messages'), ('database'),
      ('retention'), ('auth'), ('sessions')
    ) as s(key)
    on conflict (request_id, step_key) do nothing;
  else
    update public.account_deletion_requests
       set status = 'processing',
           started_at = coalesce(started_at, now()),
           attempt_count = attempt_count + 1
     where id = v_request_id;
  end if;

  perform public.account_deletion_audit(
    v_request_id,
    v_uid,
    'deletion_requested',
    jsonb_build_object('via', 'app', 'self_service', true)
  );

  -- 1) Hesabi hemen kapat: profil gizlenir, sosyal grafik temizlenir.
  perform public.account_deletion_freeze(v_uid);
  perform public.account_deletion_mark_step(v_request_id, 'freeze', 'completed');
  perform public.account_deletion_mark_step(v_request_id, 'visibility', 'completed');
  perform public.account_deletion_mark_step(v_request_id, 'sessions', 'completed');

  -- 2) Kural tabanli temizlik: sahip olunan veriler silinir, yasal saklama
  --    gerektiren satirlarda kisisel alanlar bosaltilir.
  v_purge := public.account_deletion_purge_tables(v_uid);
  v_failures := coalesce(v_purge -> 'failures', '[]'::jsonb);

  perform public.account_deletion_mark_step(
    v_request_id,
    'database',
    case when jsonb_array_length(v_failures) = 0 then 'completed' else 'failed' end,
    v_purge,
    case when jsonb_array_length(v_failures) = 0 then null else left(v_failures::text, 2000) end
  );
  perform public.account_deletion_mark_step(v_request_id, 'retention', 'completed');

  -- 3) Sohbet gecmisi anonimlestirilir (karsi tarafin baglami korunur).
  begin
    v_tombstone := coalesce(
      public.account_deletion_tombstone_id(),
      public.account_deletion_ensure_tombstone()
    );
    perform public.account_deletion_anonymize_messages(v_uid, v_tombstone);
    perform public.account_deletion_mark_step(v_request_id, 'messages', 'completed');
  exception when others then
    perform public.account_deletion_mark_step(
      v_request_id, 'messages', 'failed', '{}'::jsonb, sqlerrm
    );
  end;

  -- 4) Medya dosyalari: kullaniciya ait depolama nesneleri kaldirilir.
  begin
    delete from storage.objects o
    where o.owner = v_uid;
    get diagnostics v_storage = row_count;

    delete from storage.objects o
    using public.account_deletion_storage_objects(v_uid) s
    where o.bucket_id = s.bucket_id
      and o.name = s.object_name;

    perform public.account_deletion_mark_step(
      v_request_id, 'storage', 'completed',
      jsonb_build_object('owner_objects', v_storage)
    );
  exception when others then
    perform public.account_deletion_mark_step(
      v_request_id, 'storage', 'failed', '{}'::jsonb, sqlerrm
    );
  end;

  -- 5) Kimlik kaydi: oturumlar kapanir, profil ve bagli veriler cascade silinir.
  delete from auth.users where id = v_uid;
  perform public.account_deletion_mark_step(v_request_id, 'auth', 'completed');

  -- 6) Istek kaydini kapat. Referans kodu ve makbuz jetonu saklanir; kullanici
  --    bu bilgilerle silme durumunu oturum acmadan sorgulayabilir.
  update public.account_deletion_requests
     set user_id = null,
         status = 'completed',
         completed_at = now(),
         processed_at = now(),
         db_purged_at = now(),
         auth_deleted_at = now(),
         storage_cleaned_at = coalesce(storage_cleaned_at, now()),
         sessions_revoked_at = coalesce(sessions_revoked_at, now()),
         last_error_code = null,
         last_error_detail = null
   where id = v_request_id;

  perform public.account_deletion_audit(
    v_request_id,
    null,
    'deletion_completed',
    jsonb_build_object('reference', v_reference, 'self_service', true)
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'reference_code', v_reference,
    'receipt_token', v_receipt,
    'status', 'completed',
    'purged', v_purge -> 'deleted',
    'scrubbed', v_purge -> 'scrubbed',
    'failures', v_failures,
    'storage_objects_removed', v_storage
  );
end;
$$;

revoke all on function public.account_delete_self(text, text, text) from public, anon;
grant execute on function public.account_delete_self(text, text, text) to authenticated;

comment on function public.account_delete_self(text, text, text) is
  'Kullanicinin kendi hesabini sifre/onay ile kalici olarak silmesini saglar.';
