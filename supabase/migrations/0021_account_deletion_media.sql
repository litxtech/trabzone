-- 0020_account_deletion_media.sql
--
-- Medya dosyalari Storage API uzerinden silinmek zorundadir: storage.objects
-- tablosuna dogrudan yazma/silme bir koruma tetikleyicisiyle engellenmistir.
-- Bu yuzden hesap silme akisini iki adima ayiriyoruz:
--
--   1. account_deletion_media_paths(): kullanicinin sahip oldugu dosya listesi
--   2. istemci bu dosyalari kendi JWT'siyle Storage API ile siler
--   3. account_delete_self(): once dosya kalmadigini dogrular, sonra hesabi
--      kalici olarak siler
--
-- Boylece herkese acik kovalarda (posts, avatars, ...) sahipsiz dosya kalmaz.
-- 0019'da tanimlanan fonksiyonun yerine gecen surumdur; imza aynidir.

create or replace function public.account_deletion_media_paths()
returns jsonb
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('bucket', o.bucket_id, 'path', o.name)
      order by o.bucket_id, o.name
    ),
    '[]'::jsonb
  )
  from storage.objects o
  where o.owner = auth.uid()
     or o.name like auth.uid()::text || '/%';
$$;

revoke all on function public.account_deletion_media_paths() from public, anon;
grant execute on function public.account_deletion_media_paths() to authenticated;

comment on function public.account_deletion_media_paths() is
  'Kullanicinin hesap silme oncesi Storage API ile temizlemesi gereken dosyalari listeler.';

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
  v_uid            uuid := auth.uid();
  v_username       text;
  v_hash           text;
  v_role           text;
  v_other_holders  integer;
  v_media_left     integer;
  v_request_id     uuid;
  v_reference      text;
  v_receipt        text;
  v_purge          jsonb;
  v_tombstone      uuid;
  v_failures       jsonb;
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
           attempt_count = attempt_count + 1
     where id = v_request_id;
  end if;

  perform public.account_deletion_audit(
    v_request_id,
    v_uid,
    'deletion_requested',
    jsonb_build_object('via', 'app', 'self_service', true, 'client_media_cleaned', true)
  );

  perform public.account_deletion_freeze(v_uid);
  perform public.account_deletion_mark_step(v_request_id, 'freeze', 'completed');
  perform public.account_deletion_mark_step(v_request_id, 'visibility', 'completed');
  perform public.account_deletion_mark_step(v_request_id, 'sessions', 'completed');

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
  perform public.account_deletion_mark_step(v_request_id, 'auth', 'completed');

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
    'failures', v_failures
  );
end;
$$;

revoke all on function public.account_delete_self(text, text, text) from public, anon;
grant execute on function public.account_delete_self(text, text, text) to authenticated;

comment on function public.account_delete_self(text, text, text) is
  'Kullanicinin kendi hesabini sifre/onay ile kalici olarak silmesini saglar; medya onceden Storage API ile temizlenmis olmalidir.';
