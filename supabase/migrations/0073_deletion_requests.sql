-- -----------------------------------------------------------------------------
-- 0073 — Giriş yapamayan kullanıcılar için hesap silme talepleri
--
-- `account_deletion_requests` tablosu self-service silme akışı için zaten
-- mevcut. Bu migration tabloyu yeniden oluşturmaz; yalnızca web üzerinden
-- kimliği doğrulanmamış talep kaydını tutacak kolonları ekler.
--
-- E-posta adresi tek başına silme yetkisi vermez: talep yetkili personel
-- tarafından kimlik doğrulaması yapıldıktan sonra işlenir. Talebin durumu
-- yalnızca referans kodu + e-posta eşleşmesiyle sorgulanabilir.
-- -----------------------------------------------------------------------------

alter table public.account_deletion_requests
  add column if not exists email text,
  add column if not exists identity_verified boolean not null default false,
  add column if not exists assigned_to uuid references public.profiles (id) on delete set null,
  add column if not exists resolution_note text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists account_deletion_requests_email_idx
  on public.account_deletion_requests (lower(email), requested_at desc);
create index if not exists account_deletion_requests_status_idx
  on public.account_deletion_requests (status, requested_at desc);

create table if not exists public.deletion_request_status_history (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.account_deletion_requests (id) on delete cascade,
  status     text not null,
  note       text,
  actor_id   uuid references public.profiles (id) on delete set null,
  actor_role text not null default 'user',
  created_at timestamptz not null default now()
);

create index if not exists deletion_request_history_idx
  on public.deletion_request_status_history (request_id, created_at);

alter table public.deletion_request_status_history enable row level security;

revoke all on public.account_deletion_requests from anon, authenticated;
revoke all on public.deletion_request_status_history from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Talep oluşturma (anonim erişime açık, enumeration'a kapalı)
-- -----------------------------------------------------------------------------

create or replace function public.deletion_request_create(
  p_email text,
  p_reason text default null,
  p_source text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email        text := lower(btrim(coalesce(p_email, '')));
  v_reason       text := nullif(btrim(coalesce(p_reason, '')), '');
  v_user_id      uuid;
  v_request      public.account_deletion_requests;
  v_recent_count integer;
begin
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = v_email
  limit 1;

  -- Aynı e-posta için 24 saatte en fazla 3 talep. Sınır aşılırsa yeni kayıt
  -- açılmaz; kullanıcıya mevcut talebi gösterilir.
  select count(*) into v_recent_count
  from public.account_deletion_requests r
  where lower(r.email) = v_email
    and r.requested_at > now() - interval '24 hours'
    and r.status <> 'failed';

  if v_recent_count >= 3 then
    select * into v_request
    from public.account_deletion_requests r
    where lower(r.email) = v_email
    order by r.requested_at desc
    limit 1;

    return jsonb_build_object(
      'request_no', v_request.reference_code,
      'status', v_request.status,
      'created_at', v_request.requested_at,
      'rate_limited', true
    );
  end if;

  insert into public.account_deletion_requests (
    user_id, email, reason, status, requested_via, auth_provider
  )
  values (
    v_user_id,
    v_email,
    left(v_reason, 500),
    'received',
    case when lower(coalesce(p_source, 'web')) = 'app' then 'app' else 'web' end,
    null
  )
  returning * into v_request;

  insert into public.deletion_request_status_history (request_id, status, note, actor_role)
  values (v_request.id, 'received', 'Talep web üzerinden oluşturuldu.', 'user');

  if v_user_id is not null then
    perform public.tz_enqueue_email(
      'deletion_received',
      v_email,
      jsonb_build_object(
        'name', coalesce(
          (select trim(first_name || ' ' || last_name) from public.profiles where id = v_user_id),
          ''
        ),
        'reference', v_request.reference_code
      ),
      v_user_id,
      'tr',
      'deletion-request:' || v_request.reference_code
    );
  end if;

  return jsonb_build_object(
    'request_no', v_request.reference_code,
    'status', v_request.status,
    'created_at', v_request.requested_at,
    'rate_limited', false
  );
end;
$$;

revoke all on function public.deletion_request_create(text, text, text) from public;
grant execute on function public.deletion_request_create(text, text, text) to anon, authenticated;

-- Talep durumu: yalnızca referans + e-posta birlikte eşleşirse döner.
create or replace function public.deletion_request_status(
  p_request_no text,
  p_email text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'request_no', r.reference_code,
    'status', r.status,
    'created_at', r.requested_at,
    'updated_at', r.updated_at,
    'completed_at', r.completed_at,
    'identity_verified', r.identity_verified
  )
  from public.account_deletion_requests r
  where upper(btrim(r.reference_code)) = upper(btrim(p_request_no))
    and lower(r.email) = lower(btrim(p_email))
  limit 1;
$$;

revoke all on function public.deletion_request_status(text, text) from public;
grant execute on function public.deletion_request_status(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Yönetici işlemleri
-- -----------------------------------------------------------------------------

create or replace function public.admin_deletion_requests(
  p_status text default null,
  p_search text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not public.has_permission('privacy.request.manage') then
    raise exception 'forbidden';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.requested_at desc)
    from (
      select
        r.id,
        r.reference_code as request_no,
        r.email,
        r.status,
        r.identity_verified,
        r.reason,
        r.resolution_note,
        r.requested_at,
        r.updated_at,
        r.completed_at,
        p.username as assigned_name
      from public.account_deletion_requests r
      left join public.profiles p on p.id = r.assigned_to
      where (p_status is null or r.status = p_status)
        and (
          p_search is null or btrim(p_search) = ''
          or r.reference_code ilike '%' || btrim(p_search) || '%'
          or r.email ilike '%' || btrim(p_search) || '%'
        )
      order by r.requested_at desc
      limit v_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_deletion_requests(text, text, integer) from public, anon;
grant execute on function public.admin_deletion_requests(text, text, integer) to authenticated;

create or replace function public.admin_deletion_request_update(
  p_id uuid,
  p_status text,
  p_note text default null,
  p_verify_identity boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.account_deletion_requests;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.has_permission('privacy.request.manage') then
    raise exception 'forbidden';
  end if;
  if p_status not in ('received', 'processing', 'completed', 'failed') then
    raise exception 'invalid_status';
  end if;

  update public.account_deletion_requests r
  set status = p_status,
      resolution_note = coalesce(v_note, r.resolution_note),
      identity_verified = coalesce(p_verify_identity, r.identity_verified),
      assigned_to = coalesce(r.assigned_to, auth.uid()),
      completed_at = case when p_status = 'completed' then now() else r.completed_at end,
      updated_at = now()
  where r.id = p_id
  returning * into v_request;

  if v_request.id is null then
    raise exception 'not_found';
  end if;

  insert into public.deletion_request_status_history (request_id, status, note, actor_id, actor_role)
  values (v_request.id, p_status, v_note, auth.uid(), 'admin');

  perform public.tz_admin_audit(
    'privacy.deletion_request.update',
    'Hesap silme talebi güncellendi',
    'account_deletion_request',
    v_request.reference_code,
    jsonb_build_object('status', p_status, 'identity_verified', v_request.identity_verified),
    'success'
  );

  if p_status = 'completed' and v_request.email is not null then
    perform public.tz_enqueue_email(
      'deletion_completed',
      v_request.email,
      jsonb_build_object('reference', v_request.reference_code),
      v_request.user_id,
      'tr',
      'deletion-completed:' || v_request.reference_code
    );
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'request_no', v_request.reference_code,
    'status', v_request.status,
    'identity_verified', v_request.identity_verified,
    'updated_at', v_request.updated_at
  );
end;
$$;

revoke all on function public.admin_deletion_request_update(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_deletion_request_update(uuid, text, text, boolean) to authenticated;
