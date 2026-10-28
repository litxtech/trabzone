-- 0091_apple_signin_revocation.sql
--
-- Apple App Store 5.1.1(v) ve "Sign in with Apple" kurallari, hesap silindiginde
-- Apple oturum jetonlarinin da geri alinmasini ister. Aksi halde kullanici
-- uygulamayi silse bile Apple tarafinda uygulama yetkisi ("Apps Using Apple ID")
-- acik kalir; magaza incelemesinde hesap silme akisinin eksik sayilmasi icin
-- yeterli bir nedendir.
--
-- Supabase `signInWithIdToken` yalnizca kimlik anahtarini (identity token)
-- dogrular; Apple'in yenileme jetonunu (refresh token) saklamaz. Bu yuzden:
--
--   1. `public.apple_auth_tokens`: kullanici basina Apple refresh token'i.
--      Yalnizca service_role erisebilir (RLS acik, policy yok). auth.users
--      silindiginde kayit cascade ile kalkar.
--   2. `public.account_deletion_target_allowed()`: edge function'in kendi
--      hesabi disinda bir hesap icin jeton islemi yapmasini engeller.
--   3. `public.account_delete_self_v3()`: silme denetim kaydina kimlik
--      saglayici temizliginin (Apple jeton iptali) sonucunu yazar. Eski
--      `account_delete_self_v2` ve `account_delete_self` imzalari korunur.
--   4. `public.admin_deletion_request_execute(p_id, p_identity)`: yonetici
--      akisinda da kimlik temizligi raporu denetim kaydina girer.

-- -----------------------------------------------------------------------------
-- 1. Apple yenileme jetonlari (yalnizca service_role)
-- -----------------------------------------------------------------------------

create table if not exists public.apple_auth_tokens (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  refresh_token  text,
  client_id      text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoke_attempts integer not null default 0,
  last_error     text
);

comment on table public.apple_auth_tokens is
  'Apple ile giris yapan kullanicilarin yenileme jetonlari; hesap silmede iptal edilir.';

alter table public.apple_auth_tokens enable row level security;
revoke all on public.apple_auth_tokens from public, anon, authenticated;
grant all on public.apple_auth_tokens to service_role;

-- -----------------------------------------------------------------------------
-- 2. Edge function yetki kapisi
-- -----------------------------------------------------------------------------

create or replace function public.account_deletion_target_allowed(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;

  if p_user_id is null or p_user_id = v_uid then
    return true;
  end if;

  return public.has_permission('privacy.request.manage');
end;
$$;

revoke all on function public.account_deletion_target_allowed(uuid) from public, anon;
grant execute on function public.account_deletion_target_allowed(uuid) to authenticated;

comment on function public.account_deletion_target_allowed(uuid) is
  'Edge function lar icin hedef kullanici yetkisi: kendi hesabi veya gizlilik talebi yoneticisi.';

-- -----------------------------------------------------------------------------
-- 3. Silme: kimlik saglayici temizligi raporu (v3)
-- -----------------------------------------------------------------------------

create or replace function public.account_delete_self_v3(
  p_confirm  text,
  p_password text default null,
  p_reason   text default null,
  p_media    jsonb default null,
  p_identity jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage, extensions, pg_temp
as $$
declare
  v_uid           uuid := auth.uid();
  v_username      text;
  v_hash          text;
  v_role          text;
  v_other_holders integer;
  v_media_left    integer;
  v_request_id    uuid;
  v_reference     text;
  v_receipt       text;
  v_purge         jsonb;
  v_tombstone     uuid;
  v_failures      jsonb;
  v_media_report  jsonb := coalesce(p_media, '{}'::jsonb);
  v_identity      jsonb := coalesce(p_identity, '{}'::jsonb);
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select p.username, u.encrypted_password
    into v_username, v_hash
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = v_uid;

  if v_username is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if p_confirm is null or lower(trim(p_confirm)) <> lower(v_username) then
    raise exception 'confirm_mismatch' using errcode = '22023';
  end if;

  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  if v_hash is not null then
    if p_password is null or char_length(p_password) = 0 then
      raise exception 'password_required' using errcode = '28000';
    end if;
    if extensions.crypt(p_password, v_hash) <> v_hash then
      raise exception 'invalid_password' using errcode = '28P01';
    end if;
  end if;

  -- Medya once temizlenmeli: aksi halde herkese acik kovalarda sahipsiz
  -- dosyalar kalir ve hesap silme islemi reddedilir.
  select count(*)
    into v_media_left
  from storage.objects o
  where o.owner = v_uid
     or o.owner_id = v_uid::text
     or o.name like v_uid::text || '/%';

  if v_media_left > 0 then
    raise exception 'media_cleanup_required' using errcode = 'P0001';
  end if;

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
      frozen_at, sessions_revoked_at, storage_cleaned_at, next_attempt_at
    )
    values (
      v_uid,
      'processing',
      'app',
      nullif(trim(coalesce(p_reason, '')), ''),
      case when v_hash is null then 'oauth' else 'email' end,
      now(),
      now(),
      now(),
      now()
    )
    returning id, reference_code, receipt_token
    into v_request_id, v_reference, v_receipt;

    insert into public.account_deletion_steps (request_id, step_key, status, detail)
    select v_request_id, s.key,
           case when s.key = 'storage' then 'completed' else 'pending' end,
           case when s.key = 'storage'
                then jsonb_build_object('client_cleaned', true)
                else '{}'::jsonb
           end
    from (values
      ('freeze'), ('visibility'), ('storage'), ('messages'), ('database'),
      ('retention'), ('auth'), ('sessions')
    ) as s(key)
    on conflict (request_id, step_key) do nothing;
  else
    update public.account_deletion_requests
       set status = 'processing',
           started_at = coalesce(started_at, now()),
           attempt_count = attempt_count + 1,
           updated_at = now()
     where id = v_request_id;
  end if;

  perform public.account_deletion_audit(
    v_request_id,
    v_uid,
    'deletion_requested',
    jsonb_build_object(
      'via', 'app',
      'self_service', true,
      'media', v_media_report,
      'identity', v_identity
    )
  );

  perform public.account_deletion_freeze(v_uid);
  perform public.account_deletion_mark_step(v_request_id, 'freeze', 'completed');
  perform public.account_deletion_mark_step(v_request_id, 'visibility', 'completed');
  perform public.account_deletion_mark_step(v_request_id, 'sessions', 'completed');

  -- Medya temizligi istemci tarafinda (r2-purge + Storage API) dogrulanarak
  -- yapildi; rapor denetim izi icin adima yazilir.
  perform public.account_deletion_mark_step(
    v_request_id,
    'storage',
    'completed',
    jsonb_build_object('client_media_cleaned', true, 'purge', v_media_report)
  );

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

  delete from auth.users where id = v_uid;

  -- Profil kaydinin gercekten kalktigini dogrula. Kalmazsa islem geri alinir;
  -- "hesap silindi" denip platformda profil kalmasi soz konusu olamaz.
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile_purge_failed' using errcode = 'P0001';
  end if;

  perform public.account_deletion_mark_step(
    v_request_id,
    'auth',
    'completed',
    jsonb_build_object(
      'apple_token_revoked', coalesce((v_identity ->> 'revoked')::boolean, false),
      'identity', v_identity
    )
  );

  update public.account_deletion_requests
     set user_id = null,
         status = 'completed',
         completed_at = now(),
         processed_at = now(),
         db_purged_at = now(),
         auth_deleted_at = now(),
         storage_cleaned_at = coalesce(storage_cleaned_at, now()),
         sessions_revoked_at = coalesce(sessions_revoked_at, now()),
         updated_at = now(),
         last_error_code = null,
         last_error_detail = null
   where id = v_request_id;

  perform public.account_deletion_audit(
    v_request_id,
    null,
    'deletion_completed',
    jsonb_build_object(
      'reference', v_reference,
      'self_service', true,
      'media', v_media_report,
      'identity', v_identity,
      'purged', v_purge -> 'deleted'
    )
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'reference_code', v_reference,
    'receipt_token', v_receipt,
    'status', 'completed',
    'identity', v_identity,
    'purged', v_purge -> 'deleted',
    'scrubbed', v_purge -> 'scrubbed',
    'failures', v_failures
  );
end;
$$;

revoke all on function public.account_delete_self_v3(text, text, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.account_delete_self_v3(text, text, text, jsonb, jsonb)
  to authenticated;

comment on function public.account_delete_self_v3(text, text, text, jsonb, jsonb) is
  'Hesabi kalici olarak siler; medya ve kimlik saglayici temizlik raporlarini denetim kaydina yazar.';

-- Eski imzalar korunur (magazadaki onceki surumler calismaya devam eder).
create or replace function public.account_delete_self_v2(
  p_confirm  text,
  p_password text default null,
  p_reason   text default null,
  p_media    jsonb default null
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.account_delete_self_v3(p_confirm, p_password, p_reason, p_media, null);
$$;

revoke all on function public.account_delete_self_v2(text, text, text, jsonb) from public, anon;
grant execute on function public.account_delete_self_v2(text, text, text, jsonb) to authenticated;

create or replace function public.account_delete_self(
  p_confirm  text,
  p_password text default null,
  p_reason   text default null
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.account_delete_self_v3(p_confirm, p_password, p_reason, null, null);
$$;

revoke all on function public.account_delete_self(text, text, text) from public, anon;
grant execute on function public.account_delete_self(text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Yonetici akisi: kimlik temizligi raporu
-- -----------------------------------------------------------------------------

drop function if exists public.admin_deletion_request_execute(uuid);

create or replace function public.admin_deletion_request_execute(
  p_id       uuid,
  p_identity jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_request   public.account_deletion_requests;
  v_uid       uuid;
  v_purge     jsonb;
  v_failures  jsonb;
  v_tombstone uuid;
  v_media     jsonb;
  v_identity  jsonb := coalesce(p_identity, '{}'::jsonb);
begin
  if not public.has_permission('privacy.request.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_request
  from public.account_deletion_requests
  where id = p_id;

  if v_request.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_request.status = 'completed' then
    return jsonb_build_object(
      'status', 'completed',
      'already_completed', true,
      'reference_code', v_request.reference_code
    );
  end if;

  if not v_request.identity_verified then
    raise exception 'identity_not_verified' using errcode = 'P0001';
  end if;

  v_uid := v_request.user_id;

  -- Eslesen hesap yoksa (e-posta kayitli degil) yalnizca talep kapatilir.
  if v_uid is null then
    update public.account_deletion_requests
       set status = 'completed',
           completed_at = now(),
           processed_at = now(),
           updated_at = now(),
           assigned_to = coalesce(assigned_to, auth.uid()),
           resolution_note = coalesce(
             resolution_note,
             'E-posta ile eslesen aktif hesap bulunmadi; talep kapatildi.'
           )
     where id = p_id;

    insert into public.deletion_request_status_history (request_id, status, note, actor_id, actor_role)
    values (p_id, 'completed', 'Eslesen hesap yok; talep kapatildi.', auth.uid(), 'admin');

    return jsonb_build_object(
      'status', 'completed',
      'account_found', false,
      'reference_code', v_request.reference_code
    );
  end if;

  -- R2 temizligi istemci/edge function tarafinda yapildi; envanter raporu
  -- denetim kaydina girer. Kalan eski nesneler varsa silme reddedilir.
  v_media := public.account_deletion_media_inventory(v_uid);

  update public.account_deletion_requests
     set status = 'processing',
         started_at = coalesce(started_at, now()),
         attempt_count = attempt_count + 1,
         assigned_to = coalesce(assigned_to, auth.uid()),
         updated_at = now()
   where id = p_id;

  perform public.account_deletion_audit(
    p_id,
    v_uid,
    'deletion_requested',
    jsonb_build_object(
      'via', 'admin',
      'self_service', false,
      'media', v_media -> 'counts',
      'identity', v_identity
    )
  );

  if exists (select 1 from public.profiles where id = v_uid) then
    perform public.account_deletion_freeze(v_uid);
  end if;

  v_purge := public.account_deletion_purge_tables(v_uid);
  v_failures := coalesce(v_purge -> 'failures', '[]'::jsonb);

  perform public.account_deletion_mark_step(
    p_id,
    'database',
    case when jsonb_array_length(v_failures) = 0 then 'completed' else 'failed' end,
    v_purge,
    case when jsonb_array_length(v_failures) = 0 then null else left(v_failures::text, 2000) end
  );

  begin
    v_tombstone := coalesce(
      public.account_deletion_tombstone_id(),
      public.account_deletion_ensure_tombstone()
    );
    perform public.account_deletion_anonymize_messages(v_uid, v_tombstone);
    perform public.account_deletion_mark_step(p_id, 'messages', 'completed');
  exception when others then
    perform public.account_deletion_mark_step(p_id, 'messages', 'failed', '{}'::jsonb, sqlerrm);
  end;

  delete from auth.users where id = v_uid;

  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile_purge_failed' using errcode = 'P0001';
  end if;

  perform public.account_deletion_mark_step(p_id, 'storage', 'completed',
    jsonb_build_object('client_media_cleaned', true, 'inventory', v_media -> 'counts'));
  perform public.account_deletion_mark_step(p_id, 'auth', 'completed',
    jsonb_build_object(
      'apple_token_revoked', coalesce((v_identity ->> 'revoked')::boolean, false),
      'identity', v_identity
    ));
  perform public.account_deletion_mark_step(p_id, 'sessions', 'completed');

  update public.account_deletion_requests
     set user_id = null,
         status = 'completed',
         completed_at = now(),
         processed_at = now(),
         db_purged_at = now(),
         auth_deleted_at = now(),
         storage_cleaned_at = coalesce(storage_cleaned_at, now()),
         sessions_revoked_at = coalesce(sessions_revoked_at, now()),
         updated_at = now(),
         last_error_code = null,
         last_error_detail = null
   where id = p_id;

  insert into public.deletion_request_status_history (request_id, status, note, actor_id, actor_role)
  values (p_id, 'completed', 'Hesap ve iliskili veriler kalici olarak silindi.', auth.uid(), 'admin');

  perform public.tz_admin_audit(
    'privacy.deletion_request.execute',
    'Hesap silme talebi uygulandi',
    'account_deletion_request',
    v_request.reference_code,
    jsonb_build_object(
      'purged', v_purge -> 'deleted',
      'failures', v_failures,
      'identity', v_identity
    ),
    'success'
  );

  perform public.account_deletion_audit(
    p_id,
    null,
    'deletion_completed',
    jsonb_build_object(
      'reference', v_request.reference_code,
      'self_service', false,
      'identity', v_identity
    )
  );

  if v_request.email is not null then
    perform public.tz_enqueue_email(
      'deletion_completed',
      v_request.email,
      jsonb_build_object('reference', v_request.reference_code),
      null,
      'tr',
      'deletion-completed:' || v_request.reference_code
    );
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'account_found', true,
    'reference_code', v_request.reference_code,
    'identity', v_identity,
    'purged', v_purge -> 'deleted',
    'failures', v_failures
  );
end;
$$;

revoke all on function public.admin_deletion_request_execute(uuid, jsonb) from public, anon;
grant execute on function public.admin_deletion_request_execute(uuid, jsonb) to authenticated;

comment on function public.admin_deletion_request_execute(uuid, jsonb) is
  'Kimligi dogrulanmis silme talebini uygular: profil, icerik, medya kayitlari, Apple jetonu ve auth hesabi silinir.';
