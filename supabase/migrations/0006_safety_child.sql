-- =============================================================================
-- 0006: Yas guvencesi, veli onayi ve cocuk korumali hesap
-- =============================================================================
-- Ilkeler:
--   * 13 yas alti hesap acilamaz (sunucu reddeder).
--   * 13-17 yas: cocuk korumali hesap. Kisitlamalar sunucuda ZORUNLU tutulur;
--     istemci arayuzunden kapatilamaz, dogrudan tablo guncellemesiyle delineMez.
--   * Dogum tarihi yalnizca RPC ile yazilir; istemciye kolon yetkisi verilmez.
--   * Cocuk korumali rozet yalnizca hesap sahibine, veliye ve yetkiliye doner.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- Ulke bazli yas politikasi
-- -----------------------------------------------------------------------------
create table if not exists public.age_policy_config (
  country_code             text primary key,
  min_age                  smallint not null default 13,
  adult_age                smallint not null default 18,
  guardian_consent_required boolean not null default true,
  guardian_consent_max_age smallint not null default 15,
  updated_at               timestamptz not null default now(),
  constraint age_policy_country_format check (country_code ~ '^[A-Z]{2}$'),
  constraint age_policy_min_age_range check (min_age between 10 and 18),
  constraint age_policy_adult_age_range check (adult_age between 16 and 21)
);

insert into public.age_policy_config
  (country_code, min_age, adult_age, guardian_consent_required, guardian_consent_max_age) values
  ('TR', 13, 18, true, 15),
  ('DE', 16, 18, false, 0),
  ('NL', 16, 18, false, 0),
  ('US', 13, 18, true, 15),
  ('GB', 13, 18, true, 15),
  ('XX', 13, 18, false, 0)
on conflict (country_code) do nothing;

alter table public.age_policy_config enable row level security;

drop policy if exists age_policy_select on public.age_policy_config;
create policy age_policy_select on public.age_policy_config
  for select to authenticated using (true);

revoke all on public.age_policy_config from anon, authenticated;
grant select on public.age_policy_config to authenticated;

-- -----------------------------------------------------------------------------
-- Yas guvencesi kaydi
-- -----------------------------------------------------------------------------
create table if not exists public.user_age_assurance (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  birth_date         date not null,
  age_group          text not null check (age_group in ('child', 'teen', 'adult')),
  is_child_protected boolean not null default false,
  verification_state text not null default 'declared'
    check (verification_state in ('declared', 'pending_guardian', 'verified', 'rejected')),
  verification_method text,
  country_code       text not null default 'TR',
  guardian_required  boolean not null default false,
  change_count       integer not null default 1,
  locked_at          timestamptz,
  evaluated_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint user_age_birth_date_reasonable check (
    birth_date > date '1900-01-01' and birth_date <= current_date
  )
);

create index if not exists user_age_group_idx on public.user_age_assurance (age_group);
create index if not exists user_age_guardian_pending_idx
  on public.user_age_assurance (guardian_required)
  where verification_state in ('declared', 'pending_guardian');

-- -----------------------------------------------------------------------------
-- Cocuk koruma ayarlari (sunucu tarafindan zorunlu)
-- -----------------------------------------------------------------------------
create table if not exists public.child_protection_settings (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  is_enabled         boolean not null default true,
  profile_visibility text not null default 'private'
    check (profile_visibility in ('private', 'followers')),
  dm_policy          text not null default 'friends'
    check (dm_policy in ('friends', 'nobody')),
  call_policy        text not null default 'friends'
    check (call_policy in ('friends', 'nobody')),
  comment_policy     text not null default 'friends'
    check (comment_policy in ('friends', 'nobody')),
  location_sharing   boolean not null default false,
  discoverable       boolean not null default false,
  content_filter     text not null default 'strict'
    check (content_filter in ('strict')),
  enforced_by_system boolean not null default true,
  guardian_consent_required boolean not null default false,
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Veli onayi
-- -----------------------------------------------------------------------------
create table if not exists public.guardian_consents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  guardian_email  text not null,
  guardian_name   text,
  relation        text,
  status          text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected', 'revoked', 'expired')),
  method          text not null default 'email_link'
    check (method in ('email_link', 'support_review')),
  scope           jsonb not null default '{}'::jsonb,
  policy_version  integer not null default 1,
  token_hash      text,
  token_expires_at timestamptz,
  attempts        integer not null default 0,
  requested_at    timestamptz not null default now(),
  verified_at     timestamptz,
  verified_by     uuid references public.profiles (id) on delete set null,
  revoked_at      timestamptz,
  note_internal   text,
  constraint guardian_scope_object check (jsonb_typeof(scope) = 'object'),
  constraint guardian_email_format check (
    guardian_email = lower(guardian_email)
    and guardian_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  )
);

create index if not exists guardian_consents_user_idx
  on public.guardian_consents (user_id, requested_at desc);
create index if not exists guardian_consents_status_idx
  on public.guardian_consents (status, requested_at desc);
create unique index if not exists guardian_consents_one_pending
  on public.guardian_consents (user_id)
  where status = 'pending';

-- -----------------------------------------------------------------------------
-- Yas hesaplama yardimcisi
-- -----------------------------------------------------------------------------
create or replace function public.safety_age_on(p_birth_date date, p_on date default current_date)
returns integer
language sql
immutable
as $$
  select date_part('year', age(p_on, p_birth_date))::integer;
$$;

create or replace function public.safety_policy_for(p_country text)
returns public.age_policy_config
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.age_policy_config
  where country_code = coalesce(
    (select c.country_code from public.age_policy_config c
      where c.country_code = coalesce(p_country, 'TR')),
    'XX'
  );
$$;

-- -----------------------------------------------------------------------------
-- Cocuk korumali hesap icin profil ayarlarini zorla
-- -----------------------------------------------------------------------------
create or replace function public.safety_is_child_protected(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select a.is_child_protected from public.user_age_assurance a where a.user_id = p_user_id),
    false
  );
$$;

create or replace function public.tz_enforce_child_profile_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.safety_is_child_protected(new.user_id) then
    new.profile_visibility := 'private';
    new.discoverable := false;
    new.show_city := false;
    new.show_district := false;
    new.show_last_seen := false;
    new.show_online_status := false;
    new.map_visibility := 'off';
    new.ghost_mode := true;

    if new.allow_messages_from = 'everyone' then
      new.allow_messages_from := 'friends';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists tz_enforce_child_profile_settings on public.profile_settings;
create trigger tz_enforce_child_profile_settings
  before insert or update on public.profile_settings
  for each row execute function public.tz_enforce_child_profile_settings();

-- -----------------------------------------------------------------------------
-- Dogum tarihi yalnizca RPC ile degisebilir
-- -----------------------------------------------------------------------------
create or replace function public.tz_guard_birth_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.birth_date is distinct from old.birth_date
     and coalesce(current_setting('safety.rpc', true), 'off') <> 'on' then
    raise exception 'birth_date_locked' using errcode = '42501';
  end if;

  return new;
end
$$;

drop trigger if exists tz_guard_birth_date on public.profile_private;
create trigger tz_guard_birth_date
  before update on public.profile_private
  for each row execute function public.tz_guard_birth_date();

revoke update (birth_date) on public.profile_private from authenticated;

-- -----------------------------------------------------------------------------
-- Dogum tarihi kaydetme / yas grubu belirleme
-- -----------------------------------------------------------------------------
create or replace function public.safety_set_birth_date(p_birth_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_policy public.age_policy_config%rowtype;
  v_country text;
  v_age integer;
  v_group text;
  v_child boolean := false;
  v_guardian_required boolean := false;
  v_existing public.user_age_assurance%rowtype;
  v_found boolean := false;
begin
  if p_birth_date is null then
    raise exception 'invalid_birth_date' using errcode = '22023';
  end if;

  if p_birth_date > current_date or p_birth_date < date '1900-01-01' then
    raise exception 'invalid_birth_date' using errcode = '22023';
  end if;

  perform public.safety_check_rate('age_set', 6, interval '1 day');

  select coalesce(p.country_code, 'TR') into v_country
  from public.profiles p where p.id = v_uid;

  v_policy := public.safety_policy_for(coalesce(v_country, 'TR'));
  v_age := public.safety_age_on(p_birth_date);

  select * into v_existing from public.user_age_assurance where user_id = v_uid;
  v_found := found;

  -- Dogum tarihi bir kez belirlendikten sonra 24 saat disinda degistirilemez.
  if v_found and v_existing.birth_date <> p_birth_date
     and coalesce(v_existing.locked_at, v_existing.created_at) < now() - interval '24 hours' then
    raise exception 'birth_date_locked' using errcode = '42501';
  end if;

  if v_age < v_policy.min_age then
    insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
    values (
      v_uid, 'age.declined_under_minimum', 'user', v_uid::text,
      jsonb_build_object('min_age', v_policy.min_age, 'country', v_policy.country_code)
    );

    raise exception 'age_below_minimum' using errcode = '22023';
  end if;

  v_group := case
    when v_age < v_policy.adult_age then 'child'
    else 'adult'
  end;

  v_child := v_group = 'child';
  v_guardian_required := v_child
    and v_policy.guardian_consent_required
    and v_age <= v_policy.guardian_consent_max_age;

  perform set_config('safety.rpc', 'on', true);

  insert into public.user_age_assurance (
    user_id, birth_date, age_group, is_child_protected, verification_state,
    country_code, guardian_required, change_count, locked_at, evaluated_at
  )
  values (
    v_uid, p_birth_date, v_group, v_child,
    case when v_guardian_required then 'pending_guardian' else 'declared' end,
    coalesce(v_country, 'TR'), v_guardian_required,
    1, now(), now()
  )
  on conflict (user_id) do update set
    birth_date = excluded.birth_date,
    age_group = excluded.age_group,
    is_child_protected = excluded.is_child_protected,
    country_code = excluded.country_code,
    guardian_required = excluded.guardian_required,
    verification_state = case
      when excluded.guardian_required and public.user_age_assurance.verification_state = 'verified'
        then 'verified'
      when excluded.guardian_required then 'pending_guardian'
      else 'declared'
    end,
    change_count = public.user_age_assurance.change_count + 1,
    locked_at = now(),
    evaluated_at = now(),
    updated_at = now();

  update public.profile_private
     set birth_date = p_birth_date
   where user_id = v_uid;

  if v_child then
    insert into public.child_protection_settings (
      user_id, is_enabled, guardian_consent_required
    )
    values (v_uid, true, v_guardian_required)
    on conflict (user_id) do update set
      is_enabled = true,
      guardian_consent_required = excluded.guardian_consent_required,
      enforced_by_system = true,
      updated_at = now();

    -- Profil ayarlarini zorunlu koruma degerlerine cek.
    update public.profile_settings
       set profile_visibility = 'private',
           discoverable = false,
           show_city = false,
           show_district = false,
           show_last_seen = false,
           show_online_status = false,
           map_visibility = 'off',
           ghost_mode = true,
           allow_messages_from = case when allow_messages_from = 'everyone' then 'friends' else allow_messages_from end
     where user_id = v_uid;

    insert into public.safety_notifications (user_id, kind, title, body)
    values (
      v_uid, 'child_protection_enabled', 'Çocuk Korumalı Hesap etkin',
      'Hesabın 18 yaş altı olarak kaydedildi. Gizlilik, mesajlaşma, arama ve konum korumaları otomatik olarak uygulandı.'
    )
    on conflict do nothing;
  end if;

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
  values (
    v_uid, 'age.declared', 'user', v_uid::text,
    jsonb_build_object(
      'age_group', v_group,
      'country', coalesce(v_country, 'TR'),
      'guardian_required', v_guardian_required,
      'changed', v_found
    )
  );

  return public.safety_my_state();
end
$$;

-- -----------------------------------------------------------------------------
-- Kullanicinin kendi guvenlik durumu
-- -----------------------------------------------------------------------------
create or replace function public.safety_my_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_age public.user_age_assurance%rowtype;
  v_protection public.child_protection_settings%rowtype;
  v_settings public.profile_settings%rowtype;
  v_consent public.guardian_consents%rowtype;
  v_policy public.age_policy_config%rowtype;
  v_country text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_age from public.user_age_assurance where user_id = v_uid;
  select * into v_protection from public.child_protection_settings where user_id = v_uid;
  select * into v_settings from public.profile_settings where user_id = v_uid;

  select * into v_consent
  from public.guardian_consents
  where user_id = v_uid and status in ('pending', 'verified', 'revoked')
  order by requested_at desc
  limit 1;

  select coalesce(p.country_code, 'TR') into v_country
  from public.profiles p where p.id = v_uid;

  v_policy := public.safety_policy_for(coalesce(v_country, 'TR'));

  return jsonb_build_object(
    'user_id', v_uid,
    'country_code', coalesce(v_country, 'TR'),
    'min_age', v_policy.min_age,
    'adult_age', v_policy.adult_age,
    'birth_date_set', v_age.user_id is not null,
    'birth_date', v_age.birth_date,
    'age_group', coalesce(v_age.age_group, 'unknown'),
    'is_child_protected', coalesce(v_age.is_child_protected, false),
    'verification_state', coalesce(v_age.verification_state, 'none'),
    'guardian_required', coalesce(v_age.guardian_required, false),
    'evaluated_at', v_age.evaluated_at,
    'protection', jsonb_build_object(
      'is_enabled', coalesce(v_protection.is_enabled, false),
      'profile_visibility', coalesce(v_protection.profile_visibility, v_settings.profile_visibility, 'public'),
      'dm_policy', coalesce(v_protection.dm_policy, v_settings.allow_messages_from, 'everyone'),
      'call_policy', coalesce(v_protection.call_policy, 'friends'),
      'comment_policy', coalesce(v_protection.comment_policy, 'friends'),
      'location_sharing', coalesce(v_protection.location_sharing, false),
      'discoverable', coalesce(v_protection.discoverable, v_settings.discoverable, true),
      'content_filter', coalesce(v_protection.content_filter, 'strict'),
      'enforced_by_system', coalesce(v_protection.enforced_by_system, false),
      'guardian_consent_required', coalesce(v_protection.guardian_consent_required, false)
    ),
    'guardian', jsonb_build_object(
      'required', coalesce(v_age.guardian_required, false),
      'status', coalesce(v_consent.status, 'none'),
      'requested_at', v_consent.requested_at,
      'verified_at', v_consent.verified_at,
      'guardian_email_masked', case
        when v_consent.guardian_email is null then null
        else left(v_consent.guardian_email::text, 2) || '***@' || split_part(v_consent.guardian_email::text, '@', 2)
      end
    ),
    'notifications_unread', (
      select count(*) from public.safety_notifications n
      where n.user_id = v_uid and n.read_at is null
    )
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Cocuk koruma ayarlarini guncelle (yumusatma yok)
-- -----------------------------------------------------------------------------
create or replace function public.safety_update_child_settings(
  p_dm_policy text default null,
  p_call_policy text default null,
  p_comment_policy text default null,
  p_location_sharing boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_settings public.child_protection_settings%rowtype;
begin
  if not public.safety_is_child_protected(v_uid) then
    raise exception 'not_child_protected' using errcode = '42501';
  end if;

  select * into v_settings from public.child_protection_settings where user_id = v_uid;

  if p_dm_policy is not null and p_dm_policy not in ('friends', 'nobody') then
    raise exception 'invalid_dm_policy' using errcode = '22023';
  end if;

  if p_call_policy is not null and p_call_policy not in ('friends', 'nobody') then
    raise exception 'invalid_call_policy' using errcode = '22023';
  end if;

  if p_comment_policy is not null and p_comment_policy not in ('friends', 'nobody') then
    raise exception 'invalid_comment_policy' using errcode = '22023';
  end if;

  insert into public.child_protection_settings (
    user_id, dm_policy, call_policy, comment_policy, location_sharing
  )
  values (
    v_uid,
    coalesce(p_dm_policy, 'friends'),
    coalesce(p_call_policy, 'friends'),
    coalesce(p_comment_policy, 'friends'),
    coalesce(p_location_sharing, false)
  )
  on conflict (user_id) do update set
    dm_policy = coalesce(p_dm_policy, public.child_protection_settings.dm_policy),
    call_policy = coalesce(p_call_policy, public.child_protection_settings.call_policy),
    comment_policy = coalesce(p_comment_policy, public.child_protection_settings.comment_policy),
    location_sharing = coalesce(p_location_sharing, public.child_protection_settings.location_sharing),
    updated_at = now();

  -- Mesaj iznini de ayni degerde tut (tek kaynak: cocuk koruma ayari).
  if p_dm_policy is not null then
    update public.profile_settings
       set allow_messages_from = p_dm_policy
     where user_id = v_uid;
  end if;

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
  values (
    v_uid, 'child_settings.updated', 'user', v_uid::text,
    jsonb_build_object(
      'dm_policy', p_dm_policy,
      'call_policy', p_call_policy,
      'location_sharing', p_location_sharing
    )
  );

  return public.safety_my_state();
end
$$;

-- -----------------------------------------------------------------------------
-- Cocuk korumali rozet gorunurlugu
-- -----------------------------------------------------------------------------
create or replace function public.safety_profile_flags(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_visible boolean;
begin
  if v_uid is null then
    return '{}'::jsonb;
  end if;

  v_visible := v_uid = p_user_id or public.is_admin();

  if not v_visible then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'is_child_protected', public.safety_is_child_protected(p_user_id),
    'badge_visible', v_visible
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Mesajlasma / arama izin kontrolu (sunucu tarafi zorunlu kontrol)
-- -----------------------------------------------------------------------------
create or replace function public.safety_can_message(p_sender uuid, p_recipient uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy text;
  v_mutual boolean;
begin
  if p_sender is null or p_recipient is null or p_sender = p_recipient then
    return false;
  end if;

  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_recipient and b.blocked_id = p_sender)
       or (b.blocker_id = p_sender and b.blocked_id = p_recipient)
  ) then
    return false;
  end if;

  if not public.safety_is_child_protected(p_recipient) then
    select s.allow_messages_from into v_policy
    from public.profile_settings s where s.user_id = p_recipient;
    v_policy := coalesce(v_policy, 'everyone');

    if v_policy = 'nobody' then
      return false;
    end if;

    if v_policy = 'friends' then
      return exists (
        select 1 from public.user_follows f
        where f.follower_id = p_sender and f.following_id = p_recipient
      ) and exists (
        select 1 from public.user_follows f
        where f.follower_id = p_recipient and f.following_id = p_sender
      );
    end if;

    return true;
  end if;

  -- Cocuk korumali hesap: yalnizca karsilikli takip (arkadas) izin verir.
  select s.dm_policy into v_policy
  from public.child_protection_settings s where s.user_id = p_recipient;

  if coalesce(v_policy, 'friends') = 'nobody' then
    return false;
  end if;

  v_mutual := exists (
    select 1 from public.user_follows f
    where f.follower_id = p_sender and f.following_id = p_recipient
  ) and exists (
    select 1 from public.user_follows f
    where f.follower_id = p_recipient and f.following_id = p_sender
  );

  return v_mutual;
end
$$;

create or replace function public.safety_can_call(p_caller uuid, p_callee uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy text;
begin
  if p_caller is null or p_callee is null or p_caller = p_callee then
    return false;
  end if;

  if public.safety_is_child_protected(p_caller) and public.safety_is_child_protected(p_callee) then
    return true;
  end if;

  if public.safety_is_child_protected(p_callee) then
    select s.call_policy into v_policy
    from public.child_protection_settings s where s.user_id = p_callee;

    if coalesce(v_policy, 'friends') = 'nobody' then
      return false;
    end if;

    return exists (
      select 1 from public.user_follows f
      where f.follower_id = p_caller and f.following_id = p_callee
    ) and exists (
      select 1 from public.user_follows f
      where f.follower_id = p_callee and f.following_id = p_caller
    );
  end if;

  return true;
end
$$;

-- -----------------------------------------------------------------------------
-- Veli onayi akisi
-- -----------------------------------------------------------------------------
create or replace function public.safety_request_guardian_consent(
  p_guardian_email text,
  p_guardian_name text default null,
  p_relation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

-- Veli, e-postadaki baglanti ile bu RPC'yi cagirir (oturum gerekmez).
create or replace function public.safety_verify_guardian_token(
  p_token text,
  p_guardian_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

create or replace function public.safety_revoke_guardian_consent()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
begin
  update public.guardian_consents
     set status = 'revoked',
         revoked_at = now()
   where user_id = v_uid and status in ('pending', 'verified');

  update public.user_age_assurance
     set verification_state = case when guardian_required then 'pending_guardian' else 'declared' end,
         updated_at = now()
   where user_id = v_uid;

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id)
  values (v_uid, 'guardian.consent_revoked', 'user', v_uid::text);

  return public.safety_my_state();
end
$$;

-- -----------------------------------------------------------------------------
-- Yetkili: veli onayi ve yas kayitlari
-- -----------------------------------------------------------------------------
create or replace function public.safety_admin_list_consents(
  p_status text default 'pending'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  perform public.require_permission('safety.age.view');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'user_id', c.user_id,
    'user_name', (select p.display_name from public.profiles p where p.id = c.user_id),
    'guardian_email', c.guardian_email::text,
    'guardian_name', c.guardian_name,
    'relation', c.relation,
    'status', c.status,
    'method', c.method,
    'requested_at', c.requested_at,
    'verified_at', c.verified_at,
    'expires_at', c.token_expires_at,
    'age_group', (select a.age_group from public.user_age_assurance a where a.user_id = c.user_id),
    'age_verification', (select a.verification_state from public.user_age_assurance a where a.user_id = c.user_id)
  ) order by c.requested_at desc), '[]'::jsonb)
  into v_items
  from public.guardian_consents c
  where p_status is null or p_status = 'all' or c.status = p_status;

  return jsonb_build_object('items', v_items);
end
$$;

create or replace function public.safety_admin_decide_consent(
  p_consent_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_consent public.guardian_consents%rowtype;
begin
  perform public.require_permission('safety.age.view');

  if p_status not in ('verified', 'rejected', 'revoked', 'expired') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_consent from public.guardian_consents where id = p_consent_id;
  if not found then
    raise exception 'consent_not_found' using errcode = '22023';
  end if;

  update public.guardian_consents
     set status = p_status,
         verified_at = case when p_status = 'verified' then now() else verified_at end,
         verified_by = case when p_status = 'verified' then v_uid else verified_by end,
         revoked_at = case when p_status = 'revoked' then now() else revoked_at end,
         note_internal = left(coalesce(p_note, note_internal), 500)
   where id = p_consent_id;

  if p_status = 'verified' then
    update public.user_age_assurance
       set verification_state = 'verified',
           verification_method = 'support_review',
           updated_at = now()
     where user_id = v_consent.user_id;

    insert into public.safety_notifications (user_id, kind, title, body)
    values (
      v_consent.user_id, 'guardian_verified', 'Veli onayı tamamlandı',
      'Veli onayı destek ekibimiz tarafından doğrulandı.'
    );
  elsif p_status = 'rejected' then
    update public.user_age_assurance
       set verification_state = 'pending_guardian', updated_at = now()
     where user_id = v_consent.user_id;
  end if;

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
  values (
    v_uid, 'guardian.admin_' || p_status, 'guardian_consent', p_consent_id::text,
    jsonb_build_object('user_id', v_consent.user_id)
  );

  return jsonb_build_object('id', p_consent_id, 'status', p_status);
end
$$;

create or replace function public.safety_admin_age_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
begin
  perform public.require_permission('safety.age.view');

  return jsonb_build_object(
    'total_assured', (select count(*) from public.user_age_assurance),
    'children', (select count(*) from public.user_age_assurance where age_group = 'child'),
    'adults', (select count(*) from public.user_age_assurance where age_group = 'adult'),
    'pending_guardian', (
      select count(*) from public.guardian_consents where status = 'pending'
    ),
    'verified_guardian', (
      select count(*) from public.guardian_consents where status = 'verified'
    ),
    'awaiting_guardian_verification', (
      select count(*) from public.user_age_assurance
      where guardian_required and verification_state = 'pending_guardian'
    ),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', a.user_id,
        'user_name', (select p.display_name from public.profiles p where p.id = a.user_id),
        'age_group', a.age_group,
        'verification_state', a.verification_state,
        'created_at', a.created_at
      ) order by a.created_at desc), '[]'::jsonb)
      from (
        select * from public.user_age_assurance
        order by created_at desc
        limit 20
      ) a
    ),
    'viewer', v_uid
  );
end
$$;

create or replace function public.safety_admin_override_age(
  p_user_id uuid,
  p_birth_date date,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_age integer;
  v_group text;
begin
  perform public.require_permission('safety.child.action');

  if p_birth_date is null or p_birth_date > current_date or p_birth_date < date '1900-01-01' then
    raise exception 'invalid_birth_date' using errcode = '22023';
  end if;

  v_age := public.safety_age_on(p_birth_date);
  v_group := case when v_age < 18 then 'child' else 'adult' end;

  perform set_config('safety.rpc', 'on', true);

  insert into public.user_age_assurance (
    user_id, birth_date, age_group, is_child_protected, verification_state,
    verification_method, change_count, locked_at, evaluated_at
  )
  values (p_user_id, p_birth_date, v_group, v_group = 'child', 'verified', 'admin_review', 1, now(), now())
  on conflict (user_id) do update set
    birth_date = excluded.birth_date,
    age_group = excluded.age_group,
    is_child_protected = excluded.is_child_protected,
    verification_state = 'verified',
    verification_method = 'admin_review',
    updated_at = now();

  update public.profile_private set birth_date = p_birth_date where user_id = p_user_id;

  if v_group = 'child' then
    insert into public.child_protection_settings (user_id)
    values (p_user_id)
    on conflict (user_id) do update set is_enabled = true, updated_at = now();
  end if;

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
  values (
    v_uid, 'age.admin_override', 'user', p_user_id::text,
    jsonb_build_object('age_group', v_group, 'note_recorded', p_note is not null)
  );

  return jsonb_build_object('user_id', p_user_id, 'age_group', v_group);
end
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.user_age_assurance enable row level security;
alter table public.child_protection_settings enable row level security;
alter table public.guardian_consents enable row level security;

drop policy if exists user_age_assurance_select_own on public.user_age_assurance;
create policy user_age_assurance_select_own on public.user_age_assurance
  for select to authenticated using (
    user_id = auth.uid() or public.has_permission('safety.age.view')
  );

drop policy if exists child_protection_select_own on public.child_protection_settings;
create policy child_protection_select_own on public.child_protection_settings
  for select to authenticated using (
    user_id = auth.uid() or public.has_permission('safety.child.view')
  );

drop policy if exists guardian_consents_select_scoped on public.guardian_consents;
create policy guardian_consents_select_scoped on public.guardian_consents
  for select to authenticated using (
    user_id = auth.uid() or public.has_permission('safety.age.view')
  );

-- Istemciye yazma yetkisi verilmez: tum yazma islemleri RPC uzerinden.
revoke all on public.user_age_assurance from anon, authenticated;
grant select on public.user_age_assurance to authenticated;

revoke all on public.child_protection_settings from anon, authenticated;
grant select on public.child_protection_settings to authenticated;

revoke all on public.guardian_consents from anon, authenticated;
grant select on public.guardian_consents to authenticated;

-- Fonksiyon yetkileri
revoke all on function public.safety_age_on(date, date) from public, anon, authenticated;
revoke all on function public.safety_policy_for(text) from public, anon, authenticated;
revoke all on function public.safety_is_child_protected(uuid) from public, anon;
revoke all on function public.tz_enforce_child_profile_settings() from public, anon, authenticated;
revoke all on function public.tz_guard_birth_date() from public, anon, authenticated;
revoke all on function public.safety_set_birth_date(date) from public, anon;
revoke all on function public.safety_my_state() from public, anon;
revoke all on function public.safety_update_child_settings(text, text, text, boolean) from public, anon;
revoke all on function public.safety_profile_flags(uuid) from public, anon;
revoke all on function public.safety_can_message(uuid, uuid) from public, anon;
revoke all on function public.safety_can_call(uuid, uuid) from public, anon;
revoke all on function public.safety_request_guardian_consent(text, text, text) from public, anon;
revoke all on function public.safety_revoke_guardian_consent() from public, anon;
revoke all on function public.safety_admin_list_consents(text) from public, anon;
revoke all on function public.safety_admin_decide_consent(uuid, text, text) from public, anon;
revoke all on function public.safety_admin_age_overview() from public, anon;
revoke all on function public.safety_admin_override_age(uuid, date, text) from public, anon;

grant execute on function public.safety_is_child_protected(uuid) to authenticated;
grant execute on function public.safety_set_birth_date(date) to authenticated;
grant execute on function public.safety_my_state() to authenticated;
grant execute on function public.safety_update_child_settings(text, text, text, boolean) to authenticated;
grant execute on function public.safety_profile_flags(uuid) to authenticated;
grant execute on function public.safety_can_message(uuid, uuid) to authenticated;
grant execute on function public.safety_can_call(uuid, uuid) to authenticated;
grant execute on function public.safety_request_guardian_consent(text, text, text) to authenticated;
grant execute on function public.safety_revoke_guardian_consent() to authenticated;
grant execute on function public.safety_admin_list_consents(text) to authenticated;
grant execute on function public.safety_admin_decide_consent(uuid, text, text) to authenticated;
grant execute on function public.safety_admin_age_overview() to authenticated;
grant execute on function public.safety_admin_override_age(uuid, date, text) to authenticated;

-- Veli, oturum acmadan e-postadaki token ile onay verir.
revoke all on function public.safety_verify_guardian_token(text, text) from public, authenticated;
grant execute on function public.safety_verify_guardian_token(text, text) to anon, authenticated;

grant execute on function public.safety_policy_for(text) to service_role;
grant execute on function public.safety_is_child_protected(uuid) to service_role;

notify pgrst, 'reload schema';
