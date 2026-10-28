-- 0024: Trabzone Admin Control Center - core security, roles and settings
--
-- This migration adds the missing administrative layer on top of the existing
-- safety/support/reporting schema. It never drops or rewrites user data.
-- Every admin RPC is SECURITY DEFINER and re-checks the caller's permission
-- server-side; hiding a UI element is never treated as authorization.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Permission catalog additions
-- ---------------------------------------------------------------------------

insert into public.admin_permissions (code, description_tr) values
  ('user.view',          'Kullanıcı listesi, profil ve e-posta bilgilerini görüntüleme'),
  ('user.action',        'Kullanıcı hesabı üzerinde askıya alma, uyarı ve doğrulama işlemleri'),
  ('content.view',       'Gönderi, yorum, Reels ve hikâye listelerini görüntüleme'),
  ('content.action',     'Gönderi, yorum, Reels ve hikâye moderasyonu'),
  ('market.finance.view','Marketplace komisyon, iade ve ödeme kayıtlarını görüntüleme'),
  ('market.orders.action','Sipariş durumu, iade ve uyuşmazlık işlemleri'),
  ('messaging.view',     'Mesajlaşma sistem istatistiklerini görüntüleme'),
  ('messaging.moderate', 'Yalnızca rapor kapsamındaki mesajları inceleme'),
  ('notify.view',        'Bildirim kampanyalarını ve teslimat raporlarını görüntüleme'),
  ('notify.send',        'Bildirim kampanyası oluşturma ve gönderme'),
  ('finance.view',       'Gelir, ödeme, iade ve komisyon raporlarını görüntüleme'),
  ('finance.action',     'İade ve finansal düzeltme işlemleri'),
  ('cms.view',           'Uygulama içi sayfa ve metinleri görüntüleme'),
  ('cms.manage',         'Uygulama içi sayfa ve metinleri düzenleme/yayınlama'),
  ('settings.view',      'Uygulama ayarlarını görüntüleme'),
  ('settings.manage',    'Uygulama ayarlarını değiştirme'),
  ('feature.view',       'Özellik anahtarlarını görüntüleme'),
  ('feature.manage',     'Özellik anahtarlarını değiştirme'),
  ('system.view',        'Sistem sağlığı ve entegrasyon durumlarını görüntüleme'),
  ('security.view',      'Güvenlik merkezi ve oturum kayıtlarını görüntüleme'),
  ('security.manage',    'Oturum sonlandırma ve güvenlik ayarları')
on conflict (code) do update set description_tr = excluded.description_tr;

-- ---------------------------------------------------------------------------
-- 2. Role catalog additions
-- ---------------------------------------------------------------------------

insert into public.roles (key, name, description, rank) values
  ('market_manager', 'Marketplace Yöneticisi', 'İlan, sipariş, komisyon ve uyuşmazlık yönetimi', 24),
  ('analyst',        'Analist',                'Yalnızca yetkilendirilmiş raporları görüntüler', 11)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      rank = excluded.rank;

-- Marketplace manager and analyst did not exist in the original grants.
insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('market_manager', 'market.manage'),
  ('market_manager', 'market.orders.view'),
  ('market_manager', 'market.orders.action'),
  ('market_manager', 'market.finance.view'),
  ('market_manager', 'user.view'),
  ('market_manager', 'content.view'),
  ('market_manager', 'notify.view'),
  ('market_manager', 'report.view'),
  ('analyst',        'report.view'),
  ('analyst',        'report.analytics'),
  ('analyst',        'report.content'),
  ('analyst',        'report.users'),
  ('analyst',        'report.download')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- Fill operational gaps for existing roles. These are additive only.
insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'user.view'), ('admin', 'user.action'),
  ('admin', 'content.view'), ('admin', 'content.action'),
  ('admin', 'market.finance.view'), ('admin', 'market.orders.action'),
  ('admin', 'messaging.view'), ('admin', 'messaging.moderate'),
  ('admin', 'notify.view'), ('admin', 'notify.send'),
  ('admin', 'finance.view'), ('admin', 'finance.action'),
  ('admin', 'cms.view'), ('admin', 'cms.manage'),
  ('admin', 'settings.view'), ('admin', 'settings.manage'),
  ('admin', 'feature.view'), ('admin', 'feature.manage'),
  ('admin', 'system.view'), ('admin', 'security.view'),

  ('moderator', 'user.view'),
  ('moderator', 'content.view'), ('moderator', 'content.action'),
  ('moderator', 'messaging.view'), ('moderator', 'messaging.moderate'),
  ('moderator', 'notify.view'),
  ('moderator', 'system.view'),

  ('support_agent', 'support.view'), ('support_agent', 'support.reply'), ('support_agent', 'support.manage'),
  ('support_agent', 'user.view'), ('support_agent', 'content.view'),
  ('support_agent', 'messaging.view'), ('support_agent', 'notify.view'),

  ('finance_officer', 'finance.view'), ('finance_officer', 'finance.action'),
  ('finance_officer', 'market.orders.view'), ('finance_officer', 'market.finance.view'),
  ('finance_officer', 'user.view'),

  ('security_officer', 'security.view'), ('security_officer', 'security.manage'),
  ('security_officer', 'user.view'), ('security_officer', 'user.action'),
  ('security_officer', 'content.view'), ('security_officer', 'messaging.view'),
  ('security_officer', 'system.view')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.admin_sessions (
  session_id    text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id) on delete set null
);

create table if not exists public.admin_user_flags (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  suspended_until  timestamptz,
  ban_reason       text,
  warning_count    integer not null default 0,
  last_warning_at  timestamptz,
  updated_by       uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now()
);

create table if not exists public.app_settings (
  key            text primary key,
  value          jsonb not null default '{}'::jsonb,
  description_tr text,
  is_public      boolean not null default false,
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now()
);

create table if not exists public.feature_flags (
  key           text primary key,
  label_tr      text not null,
  description_tr text not null,
  category      text not null default 'general',
  enabled       boolean not null default true,
  is_public     boolean not null default true,
  critical      boolean not null default false,
  rollout_note  text,
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

create table if not exists public.admin_approval_requests (
  id           uuid primary key default gen_random_uuid(),
  action_code  text not null,
  target_type  text not null,
  target_id    text not null,
  payload      jsonb not null default '{}'::jsonb,
  reason       text not null,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_by   uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.notification_campaigns (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null,
  image_url     text,
  route         text,
  audience      jsonb not null default '{"type":"all"}'::jsonb,
  status        text not null default 'draft'
                check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  target_count  integer not null default 0,
  sent_count    integer not null default 0,
  failed_count  integer not null default 0,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.content_pages (
  slug         text primary key,
  title        text not null,
  body         text not null,
  locale       text not null default 'tr',
  status       text not null default 'draft'
               check (status in ('draft', 'published', 'archived')),
  version      integer not null default 1,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

create table if not exists public.content_page_versions (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null references public.content_pages(slug) on delete cascade,
  version    integer not null,
  title      text not null,
  body       text not null,
  status     text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (slug, version)
);

create table if not exists public.marketplace_commission_settings (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid references public.marketplace_categories(id) on delete cascade,
  rate_bps       integer not null check (rate_bps between 0 and 5000),
  effective_from timestamptz not null default now(),
  note           text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table if not exists public.marketplace_refunds (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.marketplace_orders(id) on delete cascade,
  amount_cents  bigint not null check (amount_cents >= 0),
  status        text not null default 'requested'
                check (status in ('requested', 'approved', 'rejected', 'processed')),
  reason        text,
  requested_by  uuid references auth.users(id) on delete set null,
  decided_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);

create table if not exists public.message_moderation_access_logs (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid references public.user_reports(id) on delete set null,
  admin_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  reason     text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_devices (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  platform              text not null check (platform in ('ios', 'android', 'web')),
  push_token            text,
  notifications_enabled boolean not null default true,
  last_seen_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (user_id, push_token)
);

create table if not exists public.system_announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  level      text not null default 'info' check (level in ('info', 'warning', 'critical')),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  is_active  boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_status (
  key             text primary key,
  label_tr        text not null,
  status          text not null default 'not_configured'
                  check (status in ('connected', 'degraded', 'down', 'not_configured')),
  detail_safe     text,
  last_checked_at timestamptz not null default now()
);

-- Order financial snapshot columns. Existing orders keep their original
-- amounts; commission starts at 0 so no historical revenue is rewritten.
alter table public.marketplace_orders
  add column if not exists commission_bps integer not null default 0,
  add column if not exists commission_cents bigint not null default 0,
  add column if not exists refunded_cents bigint not null default 0,
  add column if not exists dispute_status text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'marketplace_orders_dispute_status_check'
  ) then
    alter table public.marketplace_orders
      add constraint marketplace_orders_dispute_status_check
      check (dispute_status in ('none', 'open', 'resolved', 'rejected'));
  end if;
end $$;

alter table public.notifications
  add column if not exists campaign_id uuid references public.notification_campaigns(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Settings and feature-flag seeds
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value, description_tr, is_public) values
  ('app.maintenance_mode',        'false'::jsonb, 'Uygulama bakım modunda mı?', true),
  ('app.maintenance_message',     '"Trabzone kısa bir bakımda. Kısa süre içinde geri döneceğiz."'::jsonb, 'Bakım ekranı mesajı', true),
  ('app.signup_enabled',          'true'::jsonb,  'Yeni kullanıcı kaydı açık mı?', true),
  ('app.posting_enabled',         'true'::jsonb,  'Gönderi oluşturma açık mı?', true),
  ('app.story_upload_enabled',    'true'::jsonb,  'Hikâye yükleme açık mı?', true),
  ('app.reels_upload_enabled',    'true'::jsonb,  'Reels yükleme açık mı?', true),
  ('app.marketplace_listing_enabled', 'true'::jsonb, 'Yeni marketplace ilanı açık mı?', true),
  ('app.notifications_enabled',   'true'::jsonb,  'Uygulama bildirimleri açık mı?', true),
  ('app.min_age',                 '13'::jsonb,    'Minimum kayıt yaşı', true),
  ('support.email',               '"destek@litxtech.com"'::jsonb, 'Destek e-posta adresi', true),
  ('legal.terms_version',         '"1.0"'::jsonb, 'Yürürlükteki kullanım koşulları sürümü', true),
  ('marketplace.default_commission_bps', '0'::jsonb, 'Varsayılan marketplace komisyonu (baz puan, 10000 = %100)', false),
  ('security.require_admin_mfa',  'false'::jsonb, 'Kritik yönetici işlemleri için AAL2 (MFA) zorunlu mu?', false),
  ('security.session_hours',      '12'::jsonb,    'Önerilen yönetici oturum süresi (saat)', false),
  ('security.max_login_attempts', '5'::jsonb,     'Önerilen başarısız giriş denemesi sınırı', false)
on conflict (key) do nothing;

insert into public.feature_flags (key, label_tr, description_tr, category, enabled, is_public, critical) values
  ('social.post_create', 'Gönderi oluşturma', 'Kullanıcıların yeni gönderi paylaşmasını açar/kapatır. App Store ve Google Play incelemesinde görünen, belgelenmiş bir özelliktir.', 'social', true, true, false),
  ('social.comments', 'Yorum yazma', 'Gönderi ve Reels yorumlarını açar/kapatır. Yalnızca sunucu tarafı doğrulamasıyla çalışır.', 'social', true, true, false),
  ('social.story_upload', 'Hikâye yükleme', 'Yeni hikâye yükleme özelliği.', 'social', true, true, false),
  ('reels.upload', 'Reels yükleme', 'Yeni Reels videosu yükleme özelliği.', 'reels', true, true, false),
  ('marketplace.listing_create', 'Yeni ilan oluşturma', 'Marketplace üzerinde yeni ilan açma özelliği.', 'marketplace', true, true, false),
  ('auth.registration', 'Yeni kullanıcı kaydı', 'Yeni hesap oluşturmayı açar/kapatır.', 'auth', true, true, true),
  ('notifications.campaigns', 'Bildirim kampanyaları', 'Yönetici kampanyalarının kullanıcılara iletilmesini açar/kapatır.', 'notifications', true, true, false),
  ('app.maintenance_banner', 'Bakım duyurusu', 'Uygulama içi bakım/duyuru bandını gösterir.', 'system', false, true, false)
on conflict (key) do update
  set label_tr = excluded.label_tr,
      description_tr = excluded.description_tr,
      category = excluded.category,
      is_public = excluded.is_public,
      critical = excluded.critical;

insert into public.integration_status (key, label_tr, status, detail_safe) values
  ('supabase', 'Supabase (Auth / Veritabanı)', 'connected', 'Yönetim API’si üzerinden canlı bağlantı doğrulandı.'),
  ('storage', 'Dosya depolama', 'connected', 'Storage kovası sorgulanabiliyor.'),
  ('stripe', 'Stripe webhook', 'not_configured', 'Ödeme altyapısı bu ortamda etkin değil.'),
  ('push', 'Push bildirim servisi', 'not_configured', 'Cihaz token tablosu hazır; gönderim sağlayıcısı yapılandırılmadı.'),
  ('video', 'Video işleme', 'not_configured', 'Harici video işleme sağlayıcısı yapılandırılmadı.'),
  ('messaging', 'Mesajlaşma servisi', 'connected', 'Mesaj tabloları ve teslimat kayıtları sorgulanabiliyor.')
on conflict (key) do update
  set label_tr = excluded.label_tr,
      detail_safe = excluded.detail_safe;

-- ---------------------------------------------------------------------------
-- 5. Audit helper and permission guard
-- ---------------------------------------------------------------------------

create or replace function public.tz_admin_audit(
  p_action_code text,
  p_action_label text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb,
  p_outcome text default 'success'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit_logs (
    actor_admin_id, action_code, action_label_tr, target_type, target_id, outcome, metadata_safe
  )
  values (
    auth.uid(),
    left(coalesce(p_action_code, 'admin.action'), 80),
    left(coalesce(p_action_label, 'Yönetici işlemi'), 160),
    left(coalesce(p_target_type, 'system'), 64),
    left(coalesce(p_target_id, ''), 200),
    coalesce(nullif(p_outcome, ''), 'success')::public.event_outcome,
    coalesce(p_metadata, '{}'::jsonb)
  );
exception
  when others then
    -- Audit must never make the primary operation fail, but the operation
    -- itself always logs in the happy path.
    null;
end;
$$;

revoke all on function public.tz_admin_audit(text, text, text, text, jsonb, text)
  from public, anon, authenticated;

-- Revoked sessions immediately lose all staff permissions. This keeps the
-- existing has_permission() contract (any role, any code) while adding the
-- session kill-switch used by the Security Center.
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when exists (
      select 1
      from public.admin_sessions s
      where s.session_id = nullif(auth.jwt() ->> 'session_id', '')
        and s.revoked_at is not null
    ) then false
    when exists (
      select 1 from public.user_role_assignments a
      where a.user_id = auth.uid()
        and a.role_key = 'super_admin'
        and (a.expires_at is null or a.expires_at > now())
    ) then true
    else exists (
      select 1
      from public.user_role_assignments a
      join public.admin_role_permissions rp on rp.role_key = a.role_key
      where a.user_id = auth.uid()
        and (a.expires_at is null or a.expires_at > now())
        and rp.permission_code = p_permission
    )
  end
$$;

create or replace function public.tz_admin_require(
  p_permission text,
  p_critical boolean default false
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sid text := nullif(auth.jwt() ->> 'session_id', '');
  v_aal text := coalesce(auth.jwt() ->> 'aal', 'aal1');
  v_mfa_required boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if v_sid is not null and exists (
    select 1 from public.admin_sessions s
    where s.session_id = v_sid and s.revoked_at is not null
  ) then
    raise exception 'session_revoked' using errcode = '42501';
  end if;

  if not public.has_permission(p_permission) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_critical then
    select coalesce((value #>> '{}')::boolean, false)
    into v_mfa_required
    from public.app_settings
    where key = 'security.require_admin_mfa';

    if coalesce(v_mfa_required, false) and v_aal <> 'aal2' then
      raise exception 'mfa_required' using errcode = '42501';
    end if;
  end if;

  return v_uid;
end;
$$;

revoke all on function public.tz_admin_require(text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Staff session tracking and revocation
-- ---------------------------------------------------------------------------

create or replace function public.admin_touch_session(p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sid text := nullif(auth.jwt() ->> 'session_id', '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.admin_permissions p where public.has_permission(p.code)
  ) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_sid is null then
    return jsonb_build_object('tracked', false, 'reason', 'no_session_claim');
  end if;

  insert into public.admin_sessions (session_id, user_id, user_agent)
  values (v_sid, v_uid, left(coalesce(p_user_agent, ''), 240))
  on conflict (session_id) do update
    set last_seen_at = now(),
        user_agent = coalesce(nullif(left(excluded.user_agent, 240), ''), public.admin_sessions.user_agent);

  return jsonb_build_object('tracked', true, 'session_id', v_sid);
end;
$$;

create or replace function public.admin_sessions_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sid text := nullif(auth.jwt() ->> 'session_id', '');
begin
  perform public.tz_admin_require('security.view');

  return jsonb_build_object(
    'current_session_id', v_sid,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_id', s.session_id,
        'user_id', s.user_id,
        'display_name', coalesce(p.display_name, p.username::text, 'Yönetici'),
        'user_agent', s.user_agent,
        'created_at', s.created_at,
        'last_seen_at', s.last_seen_at,
        'revoked_at', s.revoked_at,
        'is_current', s.session_id = v_sid
      ) order by s.revoked_at nulls first, s.last_seen_at desc)
      from public.admin_sessions s
      left join public.profiles p on p.id = s.user_id
      where s.last_seen_at > now() - interval '30 days'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_revoke_session(
  p_session_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('security.manage', true);
  v_row public.admin_sessions%rowtype;
begin
  select * into v_row from public.admin_sessions where session_id = p_session_id;
  if not found then
    raise exception 'session_not_found' using errcode = '22023';
  end if;

  update public.admin_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_by = v_uid
   where session_id = p_session_id;

  perform public.tz_admin_audit(
    'security.session_revoked',
    'Yönetici oturumu sonlandırıldı',
    'admin_session',
    p_session_id,
    jsonb_build_object(
      'target_user_id', v_row.user_id,
      'reason', left(coalesce(nullif(trim(p_reason), ''), 'Belirtilmedi'), 300)
    )
  );

  return jsonb_build_object('session_id', p_session_id, 'revoked', true);
end;
$$;

create or replace function public.admin_revoke_other_sessions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('security.manage', true);
  v_sid text := nullif(auth.jwt() ->> 'session_id', '');
  v_count integer;
begin
  update public.admin_sessions
     set revoked_at = now(), revoked_by = v_uid
   where user_id = v_uid
     and revoked_at is null
     and (v_sid is null or session_id <> v_sid);

  get diagnostics v_count = row_count;

  perform public.tz_admin_audit(
    'security.sessions_revoked',
    'Diğer yönetici oturumları sonlandırıldı',
    'admin_session',
    v_uid::text,
    jsonb_build_object('count', v_count)
  );

  return jsonb_build_object('revoked_count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Settings
-- ---------------------------------------------------------------------------

create or replace function public.admin_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('settings.view');

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', s.key,
        'value', s.value,
        'description', s.description_tr,
        'is_public', s.is_public,
        'updated_at', s.updated_at,
        'updated_by_name', p.display_name
      ) order by s.key)
      from public.app_settings s
      left join public.profiles p on p.id = s.updated_by
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_settings_set(
  p_key text,
  p_value jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('settings.manage', true);
  v_old jsonb;
  v_old_row public.app_settings%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_old_row from public.app_settings where key = p_key;
  if not found then
    raise exception 'setting_not_found' using errcode = '22023';
  end if;

  if p_key = 'security.require_admin_mfa'
     and (p_value #>> '{}')::boolean is true
     and not public.is_super_admin() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  v_old := v_old_row.value;

  update public.app_settings
     set value = coalesce(p_value, '{}'::jsonb),
         updated_by = v_uid,
         updated_at = now()
   where key = p_key;

  perform public.tz_admin_audit(
    'settings.updated',
    'Uygulama ayarı güncellendi',
    'app_setting',
    p_key,
    jsonb_build_object('old', v_old, 'new', p_value, 'reason', left(v_reason, 400))
  );

  return jsonb_build_object('key', p_key, 'value', p_value);
end;
$$;

create or replace function public.app_public_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.app_settings
  where is_public;
$$;

-- ---------------------------------------------------------------------------
-- 8. Feature flags + second-admin approval for critical changes
-- ---------------------------------------------------------------------------

create or replace function public.admin_feature_flags_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('feature.view');

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', f.key,
        'label', f.label_tr,
        'description', f.description_tr,
        'category', f.category,
        'enabled', f.enabled,
        'is_public', f.is_public,
        'critical', f.critical,
        'rollout_note', f.rollout_note,
        'updated_at', f.updated_at,
        'updated_by_name', p.display_name
      ) order by f.category, f.label_tr)
      from public.feature_flags f
      left join public.profiles p on p.id = f.updated_by
    ), '[]'::jsonb),
    'pending_approvals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'action_code', a.action_code,
        'target_id', a.target_id,
        'payload', a.payload,
        'reason', a.reason,
        'requested_by_name', rp.display_name,
        'created_at', a.created_at
      ) order by a.created_at desc)
      from public.admin_approval_requests a
      left join public.profiles rp on rp.id = a.requested_by
      where a.status = 'pending'
        and (public.is_super_admin() or a.requested_by = auth.uid())
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_feature_flag_set(
  p_key text,
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('feature.manage', true);
  v_flag public.feature_flags%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_approval_id uuid;
begin
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_flag from public.feature_flags where key = p_key;
  if not found then
    raise exception 'feature_not_found' using errcode = '22023';
  end if;

  if v_flag.critical and not public.is_super_admin() then
    insert into public.admin_approval_requests (
      action_code, target_type, target_id, payload, reason, requested_by
    )
    values (
      'feature_flag.set', 'feature_flag', p_key,
      jsonb_build_object('key', p_key, 'enabled', p_enabled, 'old', v_flag.enabled),
      v_reason, v_uid
    )
    returning id into v_approval_id;

    perform public.tz_admin_audit(
      'feature.approval_requested',
      'Kritik özellik değişikliği onaya gönderildi',
      'feature_flag',
      p_key,
      jsonb_build_object('approval_id', v_approval_id, 'enabled', p_enabled, 'reason', left(v_reason, 400))
    );

    return jsonb_build_object(
      'status', 'pending_approval',
      'approval_id', v_approval_id,
      'key', p_key
    );
  end if;

  update public.feature_flags
     set enabled = p_enabled,
         updated_by = v_uid,
         updated_at = now()
   where key = p_key;

  perform public.tz_admin_audit(
    'feature_flag.updated',
    case when p_enabled then 'Özellik açıldı' else 'Özellik kapatıldı' end,
    'feature_flag',
    p_key,
    jsonb_build_object('old', v_flag.enabled, 'new', p_enabled, 'reason', left(v_reason, 400))
  );

  return jsonb_build_object('status', 'applied', 'key', p_key, 'enabled', p_enabled);
end;
$$;

create or replace function public.admin_approval_decide(
  p_approval_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('admin.manage', true);
  v_row public.admin_approval_requests%rowtype;
  v_key text;
  v_enabled boolean;
begin
  if not public.is_super_admin() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select * into v_row from public.admin_approval_requests where id = p_approval_id;
  if not found then
    raise exception 'approval_not_found' using errcode = '22023';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'approval_not_pending' using errcode = '22023';
  end if;
  if v_row.requested_by = v_uid then
    raise exception 'second_admin_required' using errcode = '42501';
  end if;

  update public.admin_approval_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_uid,
         decided_at = now()
   where id = p_approval_id;

  if p_approve and v_row.action_code = 'feature_flag.set' then
    v_key := v_row.payload ->> 'key';
    v_enabled := coalesce((v_row.payload ->> 'enabled')::boolean, false);

    update public.feature_flags
       set enabled = v_enabled, updated_by = v_uid, updated_at = now()
     where key = v_key;
  end if;

  perform public.tz_admin_audit(
    'admin.approval_decided',
    case when p_approve then 'Yönetici onayı verildi' else 'Yönetici onayı reddedildi' end,
    v_row.target_type,
    v_row.target_id,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'approved', p_approve,
      'reason', left(coalesce(nullif(trim(p_reason), ''), ''), 400)
    )
  );

  return jsonb_build_object('id', p_approval_id, 'status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

create or replace function public.app_feature_flags()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, enabled), '{}'::jsonb)
  from public.feature_flags
  where is_public;
$$;

-- ---------------------------------------------------------------------------
-- 9. Role and staff management
-- ---------------------------------------------------------------------------

create or replace function public.admin_roles_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('admin.manage');

  return jsonb_build_object(
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object('code', p.code, 'description', p.description_tr) order by p.code)
      from public.admin_permissions p
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', r.key,
        'name', r.name,
        'description', r.description,
        'rank', r.rank,
        'permissions', coalesce((
          select jsonb_agg(rp.permission_code order by rp.permission_code)
          from public.admin_role_permissions rp where rp.role_key = r.key
        ), '[]'::jsonb),
        'user_count', (
          select count(distinct a.user_id) from public.user_role_assignments a
          where a.role_key = r.key and (a.expires_at is null or a.expires_at > now())
        )
      ) order by r.rank desc)
      from public.roles r
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', s.user_id,
        'display_name', s.display_name,
        'username', s.username,
        'roles', s.roles,
        'is_super_admin', 'super_admin' = any(s.roles),
        'last_seen_at', s.last_seen_at
      ) order by s.display_name)
      from (
        select a.user_id, p.display_name, p.username::text as username,
               array_agg(a.role_key order by a.role_key) as roles,
               (select max(ss.last_seen_at) from public.admin_sessions ss where ss.user_id = a.user_id) as last_seen_at
        from public.user_role_assignments a
        join public.profiles p on p.id = a.user_id
        where (a.expires_at is null or a.expires_at > now())
        group by a.user_id, p.display_name, p.username
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_role_permissions_set(
  p_role_key text,
  p_permissions text[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('admin.manage', true);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_old text[];
  v_new text[] := coalesce(p_permissions, array[]::text[]);
  v_invalid text;
begin
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_role_key = 'super_admin' then
    raise exception 'super_admin_immutable' using errcode = '22023';
  end if;
  if not exists (select 1 from public.roles where key = p_role_key) then
    raise exception 'unknown_role' using errcode = '22023';
  end if;

  select string_agg(x, ', ') into v_invalid
  from unnest(v_new) x
  where not exists (select 1 from public.admin_permissions p where p.code = x);

  if v_invalid is not null then
    raise exception 'unknown_permission:%', v_invalid using errcode = '22023';
  end if;

  select coalesce(array_agg(permission_code order by permission_code), array[]::text[])
  into v_old
  from public.admin_role_permissions where role_key = p_role_key;

  delete from public.admin_role_permissions where role_key = p_role_key;

  insert into public.admin_role_permissions (role_key, permission_code)
  select p_role_key, unnest(v_new)
  on conflict do nothing;

  perform public.tz_admin_audit(
    'admin.role_permissions_changed',
    'Rol yetkileri güncellendi',
    'admin_role',
    p_role_key,
    jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_new), 'reason', left(v_reason, 400))
  );

  return jsonb_build_object('role_key', p_role_key, 'permissions', to_jsonb(v_new));
end;
$$;

create or replace function public.admin_revoke_role(
  p_user_id uuid,
  p_role_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('admin.manage', true);
  v_super_count integer;
begin
  if p_user_id = v_uid and p_role_key = 'super_admin' then
    raise exception 'cannot_revoke_own_super_admin' using errcode = '42501';
  end if;

  if p_role_key = 'super_admin' then
    select count(distinct a.user_id) into v_super_count
    from public.user_role_assignments a
    where a.role_key = 'super_admin' and (a.expires_at is null or a.expires_at > now());

    if v_super_count <= 1 then
      raise exception 'last_super_admin' using errcode = '22023';
    end if;
  end if;

  delete from public.user_role_assignments
  where user_id = p_user_id and role_key = p_role_key;

  if not found then
    raise exception 'assignment_not_found' using errcode = '22023';
  end if;

  perform public.tz_admin_audit(
    'admin.role_revoked',
    'Yönetici rolü kaldırıldı',
    'profile',
    p_user_id::text,
    jsonb_build_object('role', p_role_key, 'reason', left(coalesce(nullif(trim(p_reason), ''), ''), 400))
  );

  return jsonb_build_object('user_id', p_user_id, 'role_key', p_role_key, 'revoked', true);
end;
$$;

create or replace function public.admin_list_user_roles(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('admin.manage');

  return jsonb_build_object(
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role_key', a.role_key,
        'name', r.name,
        'granted_at', a.granted_at,
        'expires_at', a.expires_at,
        'granted_by_name', gp.display_name
      ) order by r.rank desc)
      from public.user_role_assignments a
      join public.roles r on r.key = a.role_key
      left join public.profiles gp on gp.id = a.granted_by
      where a.user_id = p_user_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_staff_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('admin.manage');

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', s.user_id,
        'display_name', s.display_name,
        'username', s.username,
        'email', s.email,
        'roles', s.roles,
        'last_seen_at', s.last_seen_at,
        'active_sessions', s.active_sessions
      ) order by s.display_name)
      from (
        select a.user_id, p.display_name, p.username::text as username, u.email::text as email,
               array_agg(a.role_key order by a.role_key) as roles,
               (select max(ss.last_seen_at) from public.admin_sessions ss where ss.user_id = a.user_id) as last_seen_at,
               (select count(*) from public.admin_sessions ss where ss.user_id = a.user_id and ss.revoked_at is null) as active_sessions
        from public.user_role_assignments a
        join public.profiles p on p.id = a.user_id
        join auth.users u on u.id = a.user_id
        where (a.expires_at is null or a.expires_at > now())
        group by a.user_id, p.display_name, p.username, u.email
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_find_user(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
begin
  perform public.tz_admin_require('admin.manage');

  if v_q is null or char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', p.id,
      'display_name', p.display_name,
      'username', p.username,
      'email', u.email,
      'account_status', p.account_status
    ) order by p.display_name)
    from (
      select * from public.profiles
      where p.username::text ilike '%' || v_q || '%'
         or p.display_name ilike '%' || v_q || '%'
         or p.id::text = v_q
      order by created_at desc
      limit 20
    ) p
    join auth.users u on u.id = p.id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Security center
-- ---------------------------------------------------------------------------

create or replace function public.admin_security_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sid text := nullif(auth.jwt() ->> 'session_id', '');
  v_failed_logins bigint := 0;
begin
  perform public.tz_admin_require('security.view');

  select count(*) into v_failed_logins
  from auth.audit_log_entries e
  where e.created_at > now() - interval '24 hours'
    and (
      coalesce(e.payload ->> 'action', '') ilike '%fail%'
      or coalesce(e.payload ->> 'action', '') ilike '%error%'
    );

  return jsonb_build_object(
    'mfa_required', coalesce((
      select (value #>> '{}')::boolean from public.app_settings where key = 'security.require_admin_mfa'
    ), false),
    'session_hours', coalesce((
      select (value #>> '{}')::int from public.app_settings where key = 'security.session_hours'
    ), 12),
    'current_session_id', v_sid,
    'stats', jsonb_build_object(
      'active_sessions', (select count(*) from public.admin_sessions where revoked_at is null),
      'revoked_sessions_7d', (select count(*) from public.admin_sessions where revoked_at > now() - interval '7 days'),
      'failed_logins_24h', v_failed_logins,
      'rate_limit_hits_24h', (
        select count(*) from public.safety_rate_limits
        where window_start > now() - interval '24 hours' and counter > 0
      ),
      'open_critical_reports', (
        select count(*) from public.user_reports
        where priority = 'critical' and status_code in ('received', 'under_review')
      ),
      'suspended_accounts', (
        select count(*) from public.profiles where account_status in ('suspended', 'restricted')
      ),
      'unverified_staff_sessions', (
        select count(*) from public.admin_sessions s
        where s.revoked_at is null
          and s.last_seen_at > now() - interval '24 hours'
          and s.session_id <> coalesce(v_sid, '')
      )
    ),
    'signals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', x.user_id,
        'display_name', x.display_name,
        'username', x.username,
        'message_count', x.message_count,
        'report_count', x.report_count,
        'signal', x.signal
      ) order by x.report_count desc, x.message_count desc)
      from (
        select p.id as user_id, p.display_name, p.username::text as username,
               (select count(*) from public.messages m
                 where m.sender_id = p.id and m.created_at > now() - interval '24 hours') as message_count,
               (select count(*) from public.user_reports r
                 where r.target_owner_id = p.id
                   and r.status_code in ('received', 'under_review')) as report_count,
               'Şüpheli hacim / bildirim' as signal
        from public.profiles p
        where (select count(*) from public.messages m
                where m.sender_id = p.id and m.created_at > now() - interval '24 hours') >= 50
           or (select count(*) from public.user_reports r
                where r.target_owner_id = p.id
                  and r.status_code in ('received', 'under_review')) >= 3
        limit 10
      ) x
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'action_code', l.action_code,
        'action_label', l.action_label_tr,
        'actor_name', p.display_name,
        'target_type', l.target_type,
        'created_at', l.created_at
      ) order by l.created_at desc)
      from (
        select * from public.admin_audit_logs
        where action_code like 'security.%'
           or action_code like 'admin.role%'
           or action_code like 'settings.%'
        order by created_at desc
        limit 25
      ) l
      left join public.profiles p on p.id = l.actor_admin_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. System health
-- ---------------------------------------------------------------------------

create or replace function public.admin_system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_storage_bytes bigint := 0;
begin
  perform public.tz_admin_require('system.view');

  select coalesce(sum(coalesce(nullif(o.metadata ->> 'size', '')::bigint, 0)), 0)
  into v_storage_bytes
  from storage.objects o;

  return jsonb_build_object(
    'database', jsonb_build_object(
      'size_bytes', pg_database_size(current_database()),
      'tables', (select count(*) from information_schema.tables where table_schema = 'public'),
      'server_time', now()
    ),
    'storage', jsonb_build_object(
      'size_bytes', v_storage_bytes,
      'objects', (select count(*) from storage.objects),
      'buckets', coalesce((
        select jsonb_agg(jsonb_build_object(
          'bucket_id', b.id,
          'objects', (select count(*) from storage.objects o where o.bucket_id = b.id),
          'size_bytes', (select coalesce(sum(coalesce(nullif(o2.metadata ->> 'size', '')::bigint, 0)), 0)
                          from storage.objects o2 where o2.bucket_id = b.id)
        ) order by b.id)
        from storage.buckets b
      ), '[]'::jsonb)
    ),
    'errors', jsonb_build_object(
      'open', (select count(*) from public.system_errors where resolved_at is null),
      'last_24h', (select count(*) from public.system_errors where occurred_at > now() - interval '24 hours'),
      'recent', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'severity', e.severity,
          'source', e.source,
          'error_code', e.error_code,
          'message', e.message_safe,
          'occurred_at', e.occurred_at,
          'resolved_at', e.resolved_at
        ) order by e.occurred_at desc)
        from (select * from public.system_errors order by occurred_at desc limit 20) e
      ), '[]'::jsonb)
    ),
    'reels', jsonb_build_object(
      'processing', (select count(*) from public.reels where status not in ('ready')),
      'failed_24h', (select count(*) from public.reels where status not in ('ready') and created_at > now() - interval '24 hours'),
      'ready', (select count(*) from public.reels where status = 'ready')
    ),
    'integrations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', i.key,
        'label', i.label_tr,
        'status', i.status,
        'detail', i.detail_safe,
        'last_checked_at', i.last_checked_at
      ) order by i.label_tr)
      from public.integration_status i
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'profiles', (select count(*) from public.profiles),
      'posts', (select count(*) from public.posts),
      'reels', (select count(*) from public.reels),
      'stories', (select count(*) from public.stories),
      'messages', (select count(*) from public.messages where deleted_at is null),
      'listings', (select count(*) from public.marketplace_listings),
      'orders', (select count(*) from public.marketplace_orders),
      'notifications', (select count(*) from public.notifications),
      'audit_logs', (select count(*) from public.admin_audit_logs)
    ),
    'app_versions', coalesce((
      select jsonb_agg(jsonb_build_object('label', v.label, 'value', v.value) order by v.value desc)
      from (
        select coalesce(nullif(safe_metadata ->> 'app_version', ''), 'Bilinmiyor') as label,
               count(*) as value
        from public.activity_events
        where occurred_at > now() - interval '30 days'
        group by 1
        order by 2 desc
        limit 12
      ) v
    ), '[]'::jsonb),
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object('label', v.label, 'value', v.value) order by v.value desc)
      from (
        select coalesce(nullif(safe_metadata ->> 'platform', ''), 'Bilinmiyor') as label,
               count(*) as value
        from public.activity_events
        where occurred_at > now() - interval '30 days'
        group by 1
        order by 2 desc
        limit 8
      ) v
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Row level security: admin tables are only reachable through RPCs
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_sessions', 'admin_user_flags', 'app_settings', 'feature_flags',
    'admin_approval_requests', 'notification_campaigns', 'content_pages',
    'content_page_versions', 'marketplace_commission_settings',
    'marketplace_refunds', 'message_moderation_access_logs', 'user_devices',
    'system_announcements', 'integration_status'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Sessions can register their own device token through a narrow RPC.
create or replace function public.app_register_device(
  p_platform text,
  p_push_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_platform text := lower(trim(coalesce(p_platform, '')));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if v_platform not in ('ios', 'android', 'web') then
    raise exception 'invalid_platform' using errcode = '22023';
  end if;

  if p_push_token is null then
    insert into public.user_devices (user_id, platform, last_seen_at)
    values (v_uid, v_platform, now())
    returning id into v_id;
  else
    insert into public.user_devices (user_id, platform, push_token, last_seen_at)
    values (v_uid, v_platform, left(p_push_token, 400), now())
    on conflict (user_id, push_token) do update
      set platform = excluded.platform,
          last_seen_at = now(),
          notifications_enabled = true
    returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_touch_session', 'admin_sessions_list', 'admin_revoke_session',
        'admin_revoke_other_sessions', 'admin_settings_get', 'admin_settings_set',
        'admin_feature_flags_list', 'admin_feature_flag_set', 'admin_approval_decide',
        'admin_roles_overview', 'admin_role_permissions_set', 'admin_revoke_role',
        'admin_list_user_roles', 'admin_staff_list', 'admin_find_user',
        'admin_security_overview', 'admin_system_health', 'app_register_device'
      )
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated', fn.sig);
  end loop;

  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('app_public_settings', 'app_feature_flags')
  loop
    execute format('revoke all on function %s from public', fn.sig);
    execute format('grant execute on function %s to anon, authenticated', fn.sig);
  end loop;
end $$;

create index if not exists admin_audit_action_created_idx on public.admin_audit_logs (action_code, created_at desc);
create index if not exists admin_audit_actor_created_idx on public.admin_audit_logs (actor_admin_id, created_at desc);
create index if not exists admin_sessions_user_seen_idx on public.admin_sessions (user_id, last_seen_at desc);
create index if not exists admin_sessions_active_idx on public.admin_sessions (revoked_at) where revoked_at is null;
create index if not exists notification_campaigns_status_sched_idx on public.notification_campaigns (status, scheduled_at);
create index if not exists notifications_campaign_idx on public.notifications (campaign_id) where campaign_id is not null;
create index if not exists user_reports_status_created_idx on public.user_reports (status_code, created_at desc);
create index if not exists user_reports_target_owner_idx on public.user_reports (target_owner_id, created_at desc);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_author_created_idx on public.posts (author_id, created_at desc);
create index if not exists reels_created_idx on public.reels (created_at desc);
create index if not exists reels_author_created_idx on public.reels (author_id, created_at desc);
create index if not exists activity_events_actor_time_idx on public.activity_events (actor_user_id, occurred_at desc);
create index if not exists activity_events_time_idx on public.activity_events (occurred_at desc);
create index if not exists messages_sender_time_idx on public.messages (sender_id, created_at desc);
