-- -----------------------------------------------------------------------------
-- 0007 — Rapor aciklamasi ve pgcrypto semasi duzeltmeleri
--
-- 1) `user_reports` tablosu uygulamanin ilk surumunde `description` kolonu
--    olmadan olusturuldu; 0005 icindeki RPC'ler bu kolonu kullaniyor.
-- 2) pgcrypto `extensions` semasinda kurulu oldugu icin veli onayi
--    fonksiyonlari `gen_random_bytes` / `digest` cagrilarinda semayi
--    cozemiyordu. Fonksiyonlar `public, extensions` arama yolu ile yeniden
--    tanimlanir.
-- -----------------------------------------------------------------------------

alter table public.user_reports
  add column if not exists description text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_reports_description_length'
  ) then
    alter table public.user_reports
      add constraint user_reports_description_length
      check (description is null or char_length(description) <= 2000);
  end if;
end
$$;

comment on column public.user_reports.description is
  'Bildiren kisinin serbest metin aciklamasi (en fazla 2000 karakter).';

-- -----------------------------------------------------------------------------
-- Veli onayi: token uretimi (extensions.gen_random_bytes)
-- -----------------------------------------------------------------------------
create or replace function public.safety_request_guardian_consent(
  p_guardian_email text,
  p_guardian_name text default null,
  p_relation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_email text := lower(trim(coalesce(p_guardian_email, '')));
  v_age public.user_age_assurance%rowtype;
  v_id uuid;
  v_token text;
  v_expires timestamptz := now() + interval '7 days';
begin
  if not public.safety_is_child_protected(v_uid) then
    raise exception 'not_child_protected' using errcode = '42501';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_guardian_email' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.guardian_consents c
    where c.user_id = v_uid and c.status = 'verified'
  ) then
    raise exception 'consent_already_verified' using errcode = '22023';
  end if;

  perform public.safety_check_rate('guardian_request', 3, interval '1 day');

  select * into v_age from public.user_age_assurance where user_id = v_uid;

  if not coalesce(v_age.guardian_required, false) then
    raise exception 'guardian_not_required' using errcode = '22023';
  end if;

  -- Bekleyen talep varsa iptal edilir; tek aktif talep kurali korunur.
  update public.guardian_consents
     set status = 'expired'
   where user_id = v_uid and status = 'pending';

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into public.guardian_consents (
    user_id, guardian_email, guardian_name, relation, status, method,
    scope, policy_version, token_hash, token_expires_at
  )
  values (
    v_uid, v_email, left(nullif(trim(p_guardian_name), ''), 80), left(nullif(trim(p_relation), ''), 40),
    'pending', 'email_link',
    jsonb_build_object(
      'privacy', true,
      'messaging', true,
      'calls', true,
      'location', true,
      'content_filter', true
    ),
    (select coalesce(max(version), 1) from public.safety_policy_versions where slug = 'child-safety'),
    encode(digest(v_token, 'sha256'), 'hex'),
    v_expires
  )
  returning id into v_id;

  insert into public.safety_notifications (user_id, kind, title, body)
  values (
    v_uid, 'guardian_requested', 'Veli onayı talebi oluşturuldu',
    'Belirttiğin veliye onay bağlantısı gönderilmesi için talep kaydedildi. Onay tamamlanana kadar hesabın korumalı kalır.'
  );

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
  values (
    v_uid, 'guardian.consent_requested', 'guardian_consent', v_id::text,
    jsonb_build_object('email_domain', split_part(v_email, '@', 2))
  );

  -- E-posta gonderimi sunucu tarafindaki edge function tarafindan yapilir.
  -- Istemciye token verilmez; yalnizca talep kimligi ve son kullanma doner.
  return jsonb_build_object(
    'consent_id', v_id,
    'status', 'pending',
    'email_masked', left(v_email, 2) || '***@' || split_part(v_email, '@', 2),
    'expires_at', v_expires,
    'delivery', 'email_pending'
  );
end
$$;

create or replace function public.safety_verify_guardian_token(
  p_token text,
  p_guardian_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_consent public.guardian_consents%rowtype;
begin
  if p_token is null or char_length(p_token) < 16 then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select * into v_consent
  from public.guardian_consents
  where token_hash = v_hash
  for update;

  if not found then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  if v_consent.status <> 'pending' then
    raise exception 'consent_not_pending' using errcode = '22023';
  end if;

  if v_consent.token_expires_at is not null and v_consent.token_expires_at < now() then
    update public.guardian_consents set status = 'expired' where id = v_consent.id;
    raise exception 'token_expired' using errcode = '22023';
  end if;

  update public.guardian_consents
     set status = 'verified',
         verified_at = now(),
         guardian_name = coalesce(nullif(trim(p_guardian_name), ''), guardian_name),
         attempts = attempts + 1
   where id = v_consent.id;

  update public.user_age_assurance
     set verification_state = 'verified',
         verification_method = 'guardian_email',
         updated_at = now()
   where user_id = v_consent.user_id;

  insert into public.safety_notifications (user_id, kind, title, body)
  values (
    v_consent.user_id, 'guardian_verified', 'Veli onayı tamamlandı',
    'Velin hesabın için gerekli onayı verdi. Koruma ayarların yürürlükte kalmaya devam ediyor.'
  );

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
  values (
    null, 'guardian.consent_verified', 'guardian_consent', v_consent.id::text,
    jsonb_build_object('user_id', v_consent.user_id)
  );

  return jsonb_build_object('status', 'verified', 'user_ref', left(v_consent.user_id::text, 8));
end
$$;

revoke all on function public.safety_request_guardian_consent(text, text, text) from public, anon;
revoke all on function public.safety_verify_guardian_token(text, text) from public;
grant execute on function public.safety_request_guardian_consent(text, text, text) to authenticated;
grant execute on function public.safety_verify_guardian_token(text, text) to anon, authenticated;
