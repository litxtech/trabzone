-- =============================================================================
-- 0069: Web platformu çekirdeği
-- =============================================================================
-- Bu migration yalnızca EKLEME yapar. Mevcut tablolar, politikalar ve kullanıcı
-- verileri korunur.
--
-- Kapsam:
--   * Hukuki belge sürümleme + değiştirilemez kabul/bilgilendirme kayıtları
--   * İsteğe bağlı açık rızalar ve rıza geçmişi
--   * KVKK / kişisel veri talep merkezi
--   * Gerçek zamanlı canlı destek (thread + mesaj + temsilci durumu)
--   * İletişim kanalları ve iletişim formu
--   * İşlemsel e-posta kuyruğu, şablonlar ve teslimat günlüğü
--   * Web sitesi içerik/ayar yönetimi
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. Hukuki belge sürümleri
-- -----------------------------------------------------------------------------

alter table public.safety_policy_versions
  add column if not exists locale text not null default 'tr',
  add column if not exists doc_type text not null default 'policy',
  add column if not exists content_hash text,
  add column if not exists change_summary text,
  add column if not exists requires_acceptance boolean not null default true,
  add column if not exists requires_reacceptance boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles (id) on delete set null;

update public.safety_policy_versions
   set content_hash = md5(body_md)
 where content_hash is null;

update public.safety_policy_versions
   set doc_type = case
     when slug in ('terms') then 'contract'
     when slug in ('privacy', 'data-protection') then 'policy'
     when slug = 'kvkk' then 'notice'
     when slug = 'child-safety' then 'policy'
     when slug = 'community-guidelines' then 'rules'
     when slug = 'cookies' then 'policy'
     else 'policy'
   end
 where doc_type = 'policy';

-- Eski (slug, version) tekilliği çok dilli sürümlemeyi engelliyordu.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'safety_policy_versions_slug_version_key'
      and conrelid = 'public.safety_policy_versions'::regclass
  ) then
    alter table public.safety_policy_versions
      drop constraint safety_policy_versions_slug_version_key;
  end if;
end
$$;

create unique index if not exists safety_policy_versions_slug_locale_version_key
  on public.safety_policy_versions (slug, locale, version);

create index if not exists safety_policy_versions_slug_locale_idx
  on public.safety_policy_versions (slug, locale, is_published, version desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'safety_policy_locale_format'
  ) then
    alter table public.safety_policy_versions
      add constraint safety_policy_locale_format check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'safety_policy_doc_type_check'
  ) then
    alter table public.safety_policy_versions
      add constraint safety_policy_doc_type_check
      check (doc_type in ('contract', 'policy', 'notice', 'rules', 'disclosure'));
  end if;
end
$$;

-- İçerik hash'i her sürümde sunucuda hesaplanır; istemciye bırakılmaz.
create or replace function public.tz_legal_policy_hash()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.content_hash := md5(coalesce(new.body_md, ''));
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists tz_legal_policy_hash on public.safety_policy_versions;
create trigger tz_legal_policy_hash
  before insert or update of body_md
  on public.safety_policy_versions
  for each row execute function public.tz_legal_policy_hash();

/**
 * Yayınlanmış bir sürümün metni sonradan değiştirilemez. Bu, kullanıcıların
 * kabul ettiği metin ile veritabanındaki metnin ayrışmasını engeller.
 * Düzeltme gerekiyorsa yeni sürüm oluşturulur.
 */
create or replace function public.tz_legal_policy_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_published and (
    new.slug is distinct from old.slug
    or new.version is distinct from old.version
    or new.locale is distinct from old.locale
    or new.title is distinct from old.title
    or new.summary is distinct from old.summary
    or new.body_md is distinct from old.body_md
    or new.doc_type is distinct from old.doc_type
    or new.requires_acceptance is distinct from old.requires_acceptance
  ) then
    raise exception 'published_policy_immutable' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists tz_legal_policy_immutable on public.safety_policy_versions;
create trigger tz_legal_policy_immutable
  before update on public.safety_policy_versions
  for each row execute function public.tz_legal_policy_immutable();

revoke all on function public.tz_legal_policy_hash() from public, anon, authenticated;
revoke all on function public.tz_legal_policy_immutable() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Kabul ve bilgilendirme kayıtları (append-only)
-- -----------------------------------------------------------------------------

create table if not exists public.legal_acceptances (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  document_slug    text not null,
  document_version integer not null,
  document_locale  text not null default 'tr',
  content_hash     text not null,
  action           text not null,
  source           text not null default 'web',
  user_agent       text,
  ip_hash          text,
  created_at       timestamptz not null default now(),
  constraint legal_acceptances_action_check
    check (action in ('accepted', 'acknowledged', 'presented', 'withdrawn')),
  constraint legal_acceptances_source_check
    check (source in (
      'web_register', 'web_consent_gate', 'web_settings', 'web_support',
      'mobile_register', 'mobile_settings', 'oauth_register', 'admin'
    )),
  constraint legal_acceptances_hash_format check (content_hash ~ '^[0-9a-f]{32}$'),
  unique (user_id, document_slug, document_version, document_locale, action)
);

create index if not exists legal_acceptances_user_idx
  on public.legal_acceptances (user_id, created_at desc);
create index if not exists legal_acceptances_document_idx
  on public.legal_acceptances (document_slug, document_version, created_at desc);

alter table public.legal_acceptances enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'legal_acceptances'
      and policyname = 'legal_acceptances_select_own'
  ) then
    create policy legal_acceptances_select_own
      on public.legal_acceptances for select to authenticated
      using (user_id = auth.uid() or public.has_permission('safety.policy.manage'));
  end if;
end
$$;

revoke all on public.legal_acceptances from anon, authenticated;

-- Kayıtlar değiştirilemez/silinemez.
create or replace function public.tz_legal_acceptance_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'legal_acceptance_immutable' using errcode = '42501';
end
$$;

drop trigger if exists tz_legal_acceptance_guard on public.legal_acceptances;
create trigger tz_legal_acceptance_guard
  before update or delete on public.legal_acceptances
  for each row execute function public.tz_legal_acceptance_guard();

revoke all on function public.tz_legal_acceptance_guard() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. İsteğe bağlı açık rızalar
-- -----------------------------------------------------------------------------

create table if not exists public.user_consents (
  user_id      uuid not null references auth.users (id) on delete cascade,
  purpose      text not null,
  granted      boolean not null default false,
  source       text not null default 'web_settings',
  granted_at   timestamptz,
  revoked_at   timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, purpose),
  constraint user_consents_purpose_check
    check (purpose in ('marketing_email', 'product_analytics', 'personalization'))
);

create table if not exists public.consent_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  purpose    text not null,
  granted    boolean not null,
  source     text not null,
  created_at timestamptz not null default now()
);

create index if not exists consent_history_user_idx
  on public.consent_history (user_id, created_at desc);

alter table public.user_consents enable row level security;
alter table public.consent_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'user_consents' and policyname = 'user_consents_select_own'
  ) then
    create policy user_consents_select_own
      on public.user_consents for select to authenticated
      using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'consent_history' and policyname = 'consent_history_select_own'
  ) then
    create policy consent_history_select_own
      on public.consent_history for select to authenticated
      using (user_id = auth.uid());
  end if;
end
$$;

revoke all on public.user_consents from anon, authenticated;
revoke all on public.consent_history from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Kişisel veri talepleri (KVKK başvuruları)
-- -----------------------------------------------------------------------------

create sequence if not exists public.privacy_request_no_seq start 1000;

create table if not exists public.privacy_data_requests (
  id                uuid primary key default gen_random_uuid(),
  request_no        text,
  user_id           uuid not null references auth.users (id) on delete cascade,
  request_type      text not null,
  subject           text not null,
  details           text not null,
  status            text not null default 'received',
  identity_verified boolean not null default false,
  assigned_to       uuid references public.profiles (id) on delete set null,
  due_at            timestamptz,
  resolved_at       timestamptz,
  response_summary  text,
  source            text not null default 'web',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint privacy_requests_type_check check (request_type in (
    'access', 'copy', 'rectify', 'erase', 'object', 'restrict', 'consent_withdraw', 'other'
  )),
  constraint privacy_requests_status_check check (status in (
    'received', 'verification_pending', 'in_review', 'awaiting_user',
    'completed', 'rejected', 'cancelled'
  )),
  constraint privacy_requests_subject_len check (char_length(subject) between 3 and 160),
  constraint privacy_requests_details_len check (char_length(details) between 10 and 5000)
);

create unique index if not exists privacy_data_requests_no_key
  on public.privacy_data_requests (request_no);
create index if not exists privacy_data_requests_user_idx
  on public.privacy_data_requests (user_id, created_at desc);
create index if not exists privacy_data_requests_due_idx
  on public.privacy_data_requests (due_at)
  where status not in ('completed', 'rejected', 'cancelled');

create table if not exists public.data_request_status_history (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.privacy_data_requests (id) on delete cascade,
  status     text not null,
  note       text,
  actor_id   uuid references public.profiles (id) on delete set null,
  actor_role text not null default 'user',
  created_at timestamptz not null default now()
);

create index if not exists data_request_status_history_idx
  on public.data_request_status_history (request_id, created_at);

alter table public.privacy_data_requests enable row level security;
alter table public.data_request_status_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'privacy_data_requests' and policyname = 'privacy_requests_select_scoped'
  ) then
    create policy privacy_requests_select_scoped
      on public.privacy_data_requests for select to authenticated
      using (user_id = auth.uid() or public.has_permission('privacy.request.manage'));
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'data_request_status_history' and policyname = 'data_request_history_select'
  ) then
    create policy data_request_history_select
      on public.data_request_status_history for select to authenticated
      using (
        exists (
          select 1 from public.privacy_data_requests r
          where r.id = data_request_status_history.request_id
            and (r.user_id = auth.uid() or public.has_permission('privacy.request.manage'))
        )
      );
  end if;
end
$$;

revoke all on public.privacy_data_requests from anon, authenticated;
revoke all on public.data_request_status_history from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Canlı destek
-- -----------------------------------------------------------------------------

create sequence if not exists public.support_live_thread_no_seq start 1000;

create table if not exists public.support_live_threads (
  id                  uuid primary key default gen_random_uuid(),
  thread_no           text,
  user_id             uuid not null references auth.users (id) on delete cascade,
  status              text not null default 'waiting',
  category            text not null default 'other',
  subject             text,
  priority            text not null default 'normal',
  assigned_to         uuid references public.profiles (id) on delete set null,
  last_message_at     timestamptz not null default now(),
  last_user_message_at timestamptz,
  last_staff_message_at timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint support_live_status_check check (status in ('waiting', 'active', 'closed')),
  constraint support_live_priority_check check (priority in ('normal', 'high', 'urgent')),
  constraint support_live_category_len check (char_length(category) between 2 and 40)
);

create unique index if not exists support_live_threads_no_key
  on public.support_live_threads (thread_no);
create index if not exists support_live_threads_user_idx
  on public.support_live_threads (user_id, created_at desc);
create index if not exists support_live_threads_queue_idx
  on public.support_live_threads (status, last_message_at desc);

-- Bir kullanıcının aynı anda tek açık canlı destek görüşmesi olabilir.
create unique index if not exists support_live_threads_one_open
  on public.support_live_threads (user_id)
  where status in ('waiting', 'active');

create table if not exists public.support_live_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.support_live_threads (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  author_role text not null,
  body        text not null,
  attachments jsonb not null default '[]'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint support_live_message_role check (author_role in ('user', 'agent', 'system')),
  constraint support_live_message_body check (char_length(body) between 1 and 4000),
  constraint support_live_message_attachments check (jsonb_typeof(attachments) = 'array')
);

create index if not exists support_live_messages_thread_idx
  on public.support_live_messages (thread_id, created_at);

create table if not exists public.support_agent_presence (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  status       text not null default 'online',
  last_seen_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint support_agent_presence_status check (status in ('online', 'away', 'offline'))
);

alter table public.support_live_threads enable row level security;
alter table public.support_live_messages enable row level security;
alter table public.support_agent_presence enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'support_live_threads' and policyname = 'support_live_threads_select_scoped'
  ) then
    create policy support_live_threads_select_scoped
      on public.support_live_threads for select to authenticated
      using (user_id = auth.uid() or public.has_permission('support.view'));
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'support_live_messages' and policyname = 'support_live_messages_select_scoped'
  ) then
    create policy support_live_messages_select_scoped
      on public.support_live_messages for select to authenticated
      using (
        exists (
          select 1 from public.support_live_threads t
          where t.id = support_live_messages.thread_id
            and (t.user_id = auth.uid() or public.has_permission('support.view'))
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'support_agent_presence' and policyname = 'support_agent_presence_select_staff'
  ) then
    create policy support_agent_presence_select_staff
      on public.support_agent_presence for select to authenticated
      using (public.has_permission('support.view'));
  end if;
end
$$;

revoke all on public.support_live_threads from anon, authenticated;
revoke all on public.support_live_messages from anon, authenticated;
revoke all on public.support_agent_presence from anon, authenticated;

-- Realtime yayınına ekle (zaten ekliyse atla).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'support_live_messages'
    ) then
      alter publication supabase_realtime add table public.support_live_messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'support_live_threads'
    ) then
      alter publication supabase_realtime add table public.support_live_threads;
    end if;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 6. İletişim kanalları ve formu
-- -----------------------------------------------------------------------------

create table if not exists public.contact_channels (
  key          text primary key,
  label        text not null,
  email        text,
  description  text,
  is_active    boolean not null default false,
  verified_at  timestamptz,
  sort_order   integer not null default 100,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null,
  constraint contact_channels_email_format
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

insert into public.contact_channels (key, label, email, description, is_active, verified_at, sort_order)
values
  ('support', 'Genel Destek', 'support@litxtech.com',
   'Hesap, uygulama ve genel sorular için destek ekibi.', true, now(), 10),
  ('privacy', 'Gizlilik ve Kişisel Veriler', 'support@litxtech.com',
   'KVKK başvuruları ve veri koruma talepleri. Aynı destek kutusu üzerinden yönlendirilir.', true, now(), 20),
  ('child_safety', 'Çocuk Güvenliği', 'support@litxtech.com',
   'Çocuk güvenliği bildirimleri öncelikli kuyrukta incelenir.', true, now(), 30),
  ('legal', 'Hukuki Bildirimler', 'support@litxtech.com',
   'Telif hakkı ve hukuki bildirimler. Aynı destek kutusu üzerinden yönlendirilir.', true, now(), 40),
  ('business', 'İşletme ve Marketplace', 'support@litxtech.com',
   'İşletme sahiplenme ve Marketplace destek talepleri.', true, now(), 50)
on conflict (key) do nothing;

create table if not exists public.contact_submissions (
  id             uuid primary key default gen_random_uuid(),
  reference_code text not null unique,
  user_id        uuid references auth.users (id) on delete set null,
  name           text not null,
  email          text not null,
  topic          text not null,
  message        text not null,
  status         text not null default 'received',
  source         text not null default 'web_contact',
  ip_hash        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint contact_submissions_topic_check check (topic in (
    'support', 'privacy', 'child_safety', 'legal', 'business', 'other'
  )),
  constraint contact_submissions_status_check check (status in (
    'received', 'in_review', 'answered', 'closed', 'spam'
  )),
  constraint contact_submissions_message_len check (char_length(message) between 10 and 4000)
);

create index if not exists contact_submissions_created_idx
  on public.contact_submissions (created_at desc);

alter table public.contact_submissions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'contact_submissions' and policyname = 'contact_submissions_select_scoped'
  ) then
    create policy contact_submissions_select_scoped
      on public.contact_submissions for select to authenticated
      using (
        user_id = auth.uid()
        or public.has_permission('settings.manage')
        or public.has_permission('support.view')
      );
  end if;
end
$$;

revoke all on public.contact_submissions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. E-posta kuyruğu ve şablonları
-- -----------------------------------------------------------------------------

create table if not exists public.email_templates (
  key        text not null,
  locale     text not null default 'tr',
  subject    text not null,
  body_html  text not null,
  body_text  text,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (key, locale)
);

create table if not exists public.email_outbox (
  id                 uuid primary key default gen_random_uuid(),
  template_key       text not null,
  locale             text not null default 'tr',
  to_email           text not null,
  user_id            uuid references auth.users (id) on delete set null,
  payload            jsonb not null default '{}'::jsonb,
  status             text not null default 'pending',
  attempts           integer not null default 0,
  next_attempt_at    timestamptz not null default now(),
  last_error         text,
  provider           text,
  provider_message_id text,
  dedupe_key         text unique,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz,
  constraint email_outbox_status_check check (status in (
    'pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled'
  )),
  constraint email_outbox_email_format check (to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create index if not exists email_outbox_pending_idx
  on public.email_outbox (status, next_attempt_at)
  where status in ('pending', 'failed');

create table if not exists public.email_delivery_logs (
  id                  uuid primary key default gen_random_uuid(),
  outbox_id           uuid references public.email_outbox (id) on delete set null,
  template_key        text not null,
  to_email            text not null,
  status              text not null,
  provider            text,
  provider_message_id text,
  error               text,
  created_at          timestamptz not null default now()
);

create index if not exists email_delivery_logs_created_idx
  on public.email_delivery_logs (created_at desc);

alter table public.email_templates enable row level security;
alter table public.email_outbox enable row level security;
alter table public.email_delivery_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'email_templates' and policyname = 'email_templates_admin_select'
  ) then
    create policy email_templates_admin_select
      on public.email_templates for select to authenticated
      using (public.has_permission('settings.manage'));
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'email_outbox' and policyname = 'email_outbox_admin_select'
  ) then
    create policy email_outbox_admin_select
      on public.email_outbox for select to authenticated
      using (public.has_permission('settings.manage'));
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'email_delivery_logs' and policyname = 'email_logs_admin_select'
  ) then
    create policy email_logs_admin_select
      on public.email_delivery_logs for select to authenticated
      using (public.has_permission('settings.manage'));
  end if;
end
$$;

revoke all on public.email_templates from anon, authenticated;
revoke all on public.email_outbox from anon, authenticated;
revoke all on public.email_delivery_logs from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Web sitesi içerik yönetimi
-- -----------------------------------------------------------------------------

create table if not exists public.website_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint website_settings_object check (jsonb_typeof(value) = 'object')
);

create table if not exists public.website_sections (
  key          text primary key,
  title        text not null,
  subtitle     text,
  body         text,
  payload      jsonb not null default '{}'::jsonb,
  sort_order   integer not null default 100,
  is_published boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null,
  constraint website_sections_payload_object check (jsonb_typeof(payload) = 'object')
);

alter table public.website_settings enable row level security;
alter table public.website_sections enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'website_settings' and policyname = 'website_settings_admin_all'
  ) then
    create policy website_settings_admin_all
      on public.website_settings for all to authenticated
      using (public.has_permission('cms.manage'))
      with check (public.has_permission('cms.manage'));
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'website_sections' and policyname = 'website_sections_admin_all'
  ) then
    create policy website_sections_admin_all
      on public.website_sections for all to authenticated
      using (public.has_permission('cms.manage'))
      with check (public.has_permission('cms.manage'));
  end if;
end
$$;

revoke all on public.website_settings from anon, authenticated;
revoke all on public.website_sections from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. Yetkiler
-- -----------------------------------------------------------------------------

insert into public.admin_permissions (code, description_tr) values
  ('privacy.request.manage', 'KVKK ve kişisel veri taleplerini yönetme'),
  ('website.manage',         'Web sitesi içerik ve iletişim kanallarını yönetme')
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_key, permission_code)
select r.key, p.code
from public.roles r
cross join public.admin_permissions p
where p.code in ('privacy.request.manage', 'website.manage')
  and r.key in ('admin', 'super_admin')
on conflict do nothing;

insert into public.admin_role_permissions (role_key, permission_code)
select 'admin', 'safety.policy.manage'
where not exists (
  select 1 from public.admin_role_permissions
  where role_key = 'admin' and permission_code = 'safety.policy.manage'
);

-- -----------------------------------------------------------------------------
-- 10. Yardımcı fonksiyonlar
-- -----------------------------------------------------------------------------

create or replace function public.tz_user_email(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from auth.users where id = p_user_id;
$$;

revoke all on function public.tz_user_email(uuid) from public, anon, authenticated;

create or replace function public.tz_enqueue_email(
  p_template_key text,
  p_to_email text,
  p_payload jsonb default '{}'::jsonb,
  p_user_id uuid default null,
  p_locale text default 'tr',
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_to_email is null or p_to_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return null;
  end if;

  insert into public.email_outbox (
    template_key, locale, to_email, user_id, payload, dedupe_key
  )
  values (
    p_template_key, coalesce(p_locale, 'tr'), lower(p_to_email), p_user_id,
    coalesce(p_payload, '{}'::jsonb), p_dedupe_key
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function public.tz_enqueue_email(text, text, jsonb, uuid, text, text)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. Hukuki belge RPC'leri
-- -----------------------------------------------------------------------------

create or replace function public.legal_document(p_slug text, p_locale text default 'tr')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.safety_policy_versions%rowtype;
begin
  select * into v_row
  from public.safety_policy_versions
  where slug = p_slug
    and locale = coalesce(nullif(p_locale, ''), 'tr')
    and is_published
    and archived_at is null
  order by version desc
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'slug', v_row.slug,
    'version', v_row.version,
    'locale', v_row.locale,
    'doc_type', v_row.doc_type,
    'title', v_row.title,
    'summary', v_row.summary,
    'body_md', v_row.body_md,
    'content_hash', v_row.content_hash,
    'requires_acceptance', v_row.requires_acceptance,
    'requires_reacceptance', v_row.requires_reacceptance,
    'effective_at', v_row.effective_at,
    'published_at', v_row.published_at,
    'change_summary', v_row.change_summary
  );
end
$$;

create or replace function public.legal_documents(p_locale text default 'tr')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row order by row ->> 'sort_order', row ->> 'slug')
    from (
      select distinct on (v.slug)
        jsonb_build_object(
          'slug', v.slug,
          'version', v.version,
          'locale', v.locale,
          'doc_type', v.doc_type,
          'title', v.title,
          'summary', v.summary,
          'requires_acceptance', v.requires_acceptance,
          'effective_at', v.effective_at,
          'published_at', v.published_at
        ) as row
      from public.safety_policy_versions v
      where v.locale = coalesce(nullif(p_locale, ''), 'tr')
        and v.is_published
        and v.archived_at is null
      order by v.slug, v.version desc
    ) s
  ), '[]'::jsonb);
end
$$;

create or replace function public.legal_record_acceptance(
  p_slug text,
  p_action text,
  p_source text,
  p_version integer default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.safety_policy_versions%rowtype;
  v_action text := coalesce(p_action, 'accepted');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if v_action not in ('accepted', 'acknowledged', 'presented') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  if p_source not in (
    'web_register', 'web_consent_gate', 'web_settings', 'web_support',
    'mobile_register', 'mobile_settings', 'oauth_register'
  ) then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  select * into v_doc
  from public.safety_policy_versions
  where slug = p_slug
    and locale = 'tr'
    and is_published
    and archived_at is null
  order by version desc
  limit 1;

  if not found then
    raise exception 'document_not_found' using errcode = '22023';
  end if;

  if p_version is not null and p_version <> v_doc.version then
    raise exception 'stale_document_version' using errcode = '22023';
  end if;

  insert into public.legal_acceptances (
    user_id, document_slug, document_version, document_locale,
    content_hash, action, source, user_agent
  )
  values (
    v_uid, v_doc.slug, v_doc.version, v_doc.locale,
    v_doc.content_hash, v_action, p_source, left(p_user_agent, 400)
  )
  on conflict (user_id, document_slug, document_version, document_locale, action) do nothing;

  return jsonb_build_object(
    'slug', v_doc.slug,
    'version', v_doc.version,
    'action', v_action,
    'content_hash', v_doc.content_hash
  );
end
$$;

create or replace function public.legal_my_acceptances()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'slug', a.document_slug,
      'version', a.document_version,
      'action', a.action,
      'source', a.source,
      'created_at', a.created_at,
      'content_hash', a.content_hash
    ) order by a.created_at desc)
    from public.legal_acceptances a
    where a.user_id = v_uid
  ), '[]'::jsonb);
end
$$;

/**
 * Zorunlu (requires_acceptance) belgelerin en güncel yayın sürümü için
 * 'accepted' kaydı yoksa döndürür. Kayıt akışı bu listeyi kullanır.
 */
create or replace function public.legal_my_pending()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'slug', d.slug,
      'version', d.version,
      'title', d.title,
      'doc_type', d.doc_type,
      'effective_at', d.effective_at
    ) order by d.slug)
    from (
      select distinct on (v.slug) v.*
      from public.safety_policy_versions v
      where v.locale = 'tr'
        and v.is_published
        and v.archived_at is null
        and v.requires_acceptance
      order by v.slug, v.version desc
    ) d
    where (
      -- Yeni sürüm hukuken yeniden kabul gerektiriyorsa tam sürüm eşleşmesi aranır.
      (d.requires_reacceptance and not exists (
        select 1 from public.legal_acceptances a
        where a.user_id = v_uid
          and a.document_slug = d.slug
          and a.document_version = d.version
          and a.document_locale = d.locale
          and a.action = 'accepted'
      ))
      -- Aksi halde kullanıcının belgeye ait herhangi bir kabulü yeterlidir.
      or (not d.requires_reacceptance and not exists (
        select 1 from public.legal_acceptances a
        where a.user_id = v_uid
          and a.document_slug = d.slug
          and a.action = 'accepted'
      ))
    )
  ), '[]'::jsonb);
end
$$;

-- Yönetici: tüm sürümler (taslak + yayın) ve kabul istatistikleri
create or replace function public.legal_admin_versions(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_permission('safety.policy.manage');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id,
      'slug', v.slug,
      'locale', v.locale,
      'version', v.version,
      'doc_type', v.doc_type,
      'title', v.title,
      'summary', v.summary,
      'body_md', v.body_md,
      'content_hash', v.content_hash,
      'is_published', v.is_published,
      'requires_acceptance', v.requires_acceptance,
      'change_summary', v.change_summary,
      'effective_at', v.effective_at,
      'published_at', v.published_at,
      'archived_at', v.archived_at,
      'created_at', v.created_at,
      'updated_at', v.updated_at,
      'acceptance_count', (
        select count(*) from public.legal_acceptances a
        where a.document_slug = v.slug
          and a.document_version = v.version
          and a.action = 'accepted'
      )
    ) order by v.slug, v.locale, v.version desc)
    from public.safety_policy_versions v
    where p_slug is null or v.slug = p_slug
  ), '[]'::jsonb);
end
$$;

create or replace function public.legal_admin_save(
  p_slug text,
  p_title text,
  p_summary text,
  p_body_md text,
  p_locale text default 'tr',
  p_doc_type text default 'policy',
  p_requires_acceptance boolean default true,
  p_effective_at timestamptz default null,
  p_change_summary text default null,
  p_publish boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_locale text := coalesce(nullif(p_locale, ''), 'tr');
  v_version integer;
  v_id uuid;
  v_existing public.safety_policy_versions%rowtype;
begin
  perform public.require_permission('safety.policy.manage');

  if p_slug !~ '^[a-z0-9-]{3,64}$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if p_title is null or char_length(trim(p_title)) < 3 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if p_body_md is null or char_length(trim(p_body_md)) < 80 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if p_doc_type not in ('contract', 'policy', 'notice', 'rules', 'disclosure') then
    raise exception 'invalid_doc_type' using errcode = '22023';
  end if;

  -- Aynı slug + dil için yayınlanmış son sürümü bul.
  select * into v_existing
  from public.safety_policy_versions
  where slug = p_slug and locale = v_locale
  order by version desc
  limit 1;

  if found and not v_existing.is_published then
    -- Taslak varsa onu güncelle (yayınlanmış sürümler değiştirilemez).
    update public.safety_policy_versions
       set title = trim(p_title),
           summary = nullif(trim(coalesce(p_summary, '')), ''),
           body_md = p_body_md,
           doc_type = p_doc_type,
           requires_acceptance = p_requires_acceptance,
           change_summary = nullif(trim(coalesce(p_change_summary, '')), ''),
           updated_by = v_uid
     where id = v_existing.id
     returning id into v_id;

    if p_publish then
      update public.safety_policy_versions
         set is_published = true,
             published_at = now(),
             effective_at = coalesce(p_effective_at, now()),
             updated_by = v_uid
       where id = v_id;
    end if;
  else
    select coalesce(max(version), 0) + 1 into v_version
    from public.safety_policy_versions
    where slug = p_slug and locale = v_locale;

    insert into public.safety_policy_versions (
      slug, version, locale, doc_type, title, summary, body_md,
      is_published, requires_acceptance, change_summary,
      published_at, effective_at, created_by, updated_by
    )
    values (
      p_slug, v_version, v_locale, p_doc_type, trim(p_title),
      nullif(trim(coalesce(p_summary, '')), ''), p_body_md,
      p_publish, p_requires_acceptance,
      nullif(trim(coalesce(p_change_summary, '')), ''),
      case when p_publish then now() else null end,
      case when p_publish then coalesce(p_effective_at, now()) else null end,
      v_uid, v_uid
    )
    returning id into v_id;
  end if;

  perform public.safety_audit(
    case when p_publish then 'legal.publish' else 'legal.draft.save' end,
    case when p_publish then 'Hukuki belge yayınlandı' else 'Hukuki belge taslağı kaydedildi' end,
    'legal_document', p_slug,
    jsonb_build_object('version', v_version, 'locale', v_locale, 'publish', p_publish)
  );

  return (select to_jsonb(v) from public.safety_policy_versions v where v.id = v_id);
end
$$;

create or replace function public.legal_admin_publish(
  p_id uuid,
  p_effective_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.safety_policy_versions%rowtype;
begin
  perform public.require_permission('safety.policy.manage');

  select * into v_row from public.safety_policy_versions where id = p_id for update;
  if not found then
    raise exception 'document_not_found' using errcode = '22023';
  end if;
  if v_row.is_published then
    raise exception 'already_published' using errcode = '22023';
  end if;

  update public.safety_policy_versions
     set is_published = true,
         published_at = now(),
         effective_at = coalesce(p_effective_at, now()),
         updated_by = v_uid
   where id = p_id
   returning * into v_row;

  perform public.safety_audit(
    'legal.publish', 'Hukuki belge yayınlandı', 'legal_document',
    v_row.slug || ' v' || v_row.version,
    jsonb_build_object('version', v_row.version, 'locale', v_row.locale)
  );

  return to_jsonb(v_row);
end
$$;

create or replace function public.legal_admin_archive(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.safety_policy_versions%rowtype;
  v_newer boolean;
begin
  perform public.require_permission('safety.policy.manage');

  select * into v_row from public.safety_policy_versions where id = p_id for update;
  if not found then
    raise exception 'document_not_found' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.safety_policy_versions
    where slug = v_row.slug and locale = v_row.locale
      and version > v_row.version and is_published
  ) into v_newer;

  if not v_newer then
    raise exception 'cannot_archive_current_version' using errcode = '22023';
  end if;

  update public.safety_policy_versions
     set archived_at = now(), is_published = false
   where id = p_id
   returning * into v_row;

  perform public.safety_audit(
    'legal.archive', 'Hukuki belge arşivlendi', 'legal_document',
    v_row.slug || ' v' || v_row.version,
    jsonb_build_object('reason', left(coalesce(p_reason, ''), 500))
  );

  return to_jsonb(v_row);
end
$$;

-- -----------------------------------------------------------------------------
-- 12. Rıza RPC'leri
-- -----------------------------------------------------------------------------

create or replace function public.consents_my()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'purpose', c.purpose,
      'granted', c.granted,
      'source', c.source,
      'granted_at', c.granted_at,
      'revoked_at', c.revoked_at,
      'updated_at', c.updated_at
    ) order by c.purpose)
    from public.user_consents c
    where c.user_id = v_uid
  ), '[]'::jsonb);
end
$$;

create or replace function public.consent_set(
  p_purpose text,
  p_granted boolean,
  p_source text default 'web_settings'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_purpose not in ('marketing_email', 'product_analytics', 'personalization') then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;
  if p_source not in ('web_register', 'web_settings', 'oauth_register', 'mobile_settings') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  insert into public.user_consents (user_id, purpose, granted, source, granted_at, revoked_at, updated_at)
  values (
    v_uid, p_purpose, coalesce(p_granted, false), p_source,
    case when p_granted then now() else null end,
    case when p_granted then null else now() end,
    now()
  )
  on conflict (user_id, purpose) do update
    set granted = excluded.granted,
        source = excluded.source,
        granted_at = case when excluded.granted then now() else public.user_consents.granted_at end,
        revoked_at = case when excluded.granted then null else now() end,
        updated_at = now();

  insert into public.consent_history (user_id, purpose, granted, source)
  values (v_uid, p_purpose, coalesce(p_granted, false), p_source);

  return jsonb_build_object('purpose', p_purpose, 'granted', coalesce(p_granted, false));
end
$$;

-- -----------------------------------------------------------------------------
-- 13. Veri talebi RPC'leri
-- -----------------------------------------------------------------------------

create or replace function public.privacy_request_create(
  p_request_type text,
  p_subject text,
  p_details text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_no text;
  v_row public.privacy_data_requests%rowtype;
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_request_type not in ('access', 'copy', 'rectify', 'erase', 'object', 'restrict', 'consent_withdraw', 'other') then
    raise exception 'invalid_type' using errcode = '22023';
  end if;
  if p_subject is null or char_length(trim(p_subject)) < 3 then
    raise exception 'invalid_subject' using errcode = '22023';
  end if;
  if p_details is null or char_length(trim(p_details)) < 10 then
    raise exception 'invalid_details' using errcode = '22023';
  end if;

  perform public.safety_check_rate('privacy_request', 5, interval '24 hours');

  select count(*) into v_recent
  from public.privacy_data_requests
  where user_id = v_uid
    and created_at > now() - interval '24 hours'
    and status not in ('completed', 'rejected', 'cancelled');

  if v_recent >= 5 then
    raise exception 'rate_limited' using errcode = '42900';
  end if;

  v_no := 'DR-' || to_char(now(), 'YYMM') || '-'
          || lpad(nextval('public.privacy_request_no_seq')::text, 6, '0');

  insert into public.privacy_data_requests (
    request_no, user_id, request_type, subject, details, due_at, identity_verified
  )
  values (
    v_no, v_uid, p_request_type, left(trim(p_subject), 160),
    left(trim(p_details), 5000), now() + interval '30 days', true
  )
  returning * into v_row;

  insert into public.data_request_status_history (request_id, status, note, actor_id, actor_role)
  values (v_row.id, 'received', 'Başvuru alındı.', v_uid, 'user');

  select public.tz_user_email(v_uid) into v_email;
  perform public.tz_enqueue_email(
    'privacy_request_received', v_email,
    jsonb_build_object('request_no', v_no, 'subject', v_row.subject, 'due_at', v_row.due_at),
    v_uid, 'tr', 'privacy-request-' || v_row.id::text
  );

  return jsonb_build_object(
    'id', v_row.id,
    'request_no', v_row.request_no,
    'status', v_row.status,
    'due_at', v_row.due_at,
    'created_at', v_row.created_at
  );
end
$$;

create or replace function public.privacy_request_list_my()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'request_no', r.request_no,
      'request_type', r.request_type,
      'subject', r.subject,
      'status', r.status,
      'due_at', r.due_at,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'resolved_at', r.resolved_at,
      'response_summary', r.response_summary
    ) order by r.created_at desc)
    from public.privacy_data_requests r
    where r.user_id = v_uid
  ), '[]'::jsonb);
end
$$;

create or replace function public.privacy_request_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.privacy_data_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.privacy_data_requests where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  if v_row.user_id <> v_uid and not public.has_permission('privacy.request.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'request_no', v_row.request_no,
    'request_type', v_row.request_type,
    'subject', v_row.subject,
    'details', v_row.details,
    'status', v_row.status,
    'due_at', v_row.due_at,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'resolved_at', v_row.resolved_at,
    'response_summary', v_row.response_summary,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', h.status,
        'note', h.note,
        'actor_role', h.actor_role,
        'created_at', h.created_at
      ) order by h.created_at)
      from public.data_request_status_history h
      where h.request_id = v_row.id
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.privacy_request_cancel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.privacy_data_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.privacy_data_requests where id = p_id for update;
  if not found or v_row.user_id <> v_uid then
    raise exception 'not_found' using errcode = '22023';
  end if;
  if v_row.status in ('completed', 'rejected', 'cancelled') then
    raise exception 'request_closed' using errcode = '22023';
  end if;

  update public.privacy_data_requests
     set status = 'cancelled', updated_at = now()
   where id = p_id
   returning * into v_row;

  insert into public.data_request_status_history (request_id, status, note, actor_id, actor_role)
  values (p_id, 'cancelled', 'Kullanıcı başvuruyu iptal etti.', v_uid, 'user');

  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end
$$;

create or replace function public.admin_privacy_requests(
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_total bigint;
begin
  perform public.require_permission('privacy.request.manage');

  select count(*) into v_total
  from public.privacy_data_requests r
  where p_status is null or r.status = p_status;

  return jsonb_build_object(
    'total', v_total,
    'items', coalesce((
      select jsonb_agg(item order by item ->> 'created_at' desc)
      from (
        select jsonb_build_object(
          'id', r.id,
          'request_no', r.request_no,
          'user_id', r.user_id,
          'username', p.username,
          'display_name', p.display_name,
          'email', public.tz_user_email(r.user_id),
          'request_type', r.request_type,
          'subject', r.subject,
          'details', r.details,
          'status', r.status,
          'assigned_to', r.assigned_to,
          'due_at', r.due_at,
          'created_at', r.created_at,
          'updated_at', r.updated_at,
          'resolved_at', r.resolved_at,
          'response_summary', r.response_summary
        ) as item
        from public.privacy_data_requests r
        left join public.profiles p on p.id = r.user_id
        where p_status is null or r.status = p_status
        order by r.created_at desc
        limit v_limit offset v_offset
      ) s
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.admin_privacy_request_update(
  p_id uuid,
  p_status text,
  p_note text default null,
  p_response text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.privacy_data_requests%rowtype;
  v_uid uuid := auth.uid();
  v_email text;
begin
  perform public.require_permission('privacy.request.manage');

  if p_status not in ('received', 'verification_pending', 'in_review', 'awaiting_user', 'completed', 'rejected', 'cancelled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_row from public.privacy_data_requests where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;

  update public.privacy_data_requests
     set status = p_status,
         assigned_to = coalesce(assigned_to, v_uid),
         response_summary = coalesce(nullif(trim(coalesce(p_response, '')), ''), response_summary),
         resolved_at = case when p_status in ('completed', 'rejected') then now() else null end,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  insert into public.data_request_status_history (request_id, status, note, actor_id, actor_role)
  values (p_id, p_status, nullif(trim(coalesce(p_note, '')), ''), v_uid, 'staff');

  if p_status in ('completed', 'rejected') then
    select public.tz_user_email(v_row.user_id) into v_email;
    perform public.tz_enqueue_email(
      'privacy_request_result', v_email,
      jsonb_build_object(
        'request_no', v_row.request_no,
        'status', p_status,
        'response', coalesce(p_response, '')
      ),
      v_row.user_id, 'tr', 'privacy-result-' || p_id::text || '-' || p_status
    );
  end if;

  perform public.safety_audit(
    'privacy.request.update', 'Veri talebi güncellendi', 'privacy_request',
    p_id::text, jsonb_build_object('status', p_status)
  );

  return jsonb_build_object('id', p_id, 'status', p_status);
end
$$;

-- -----------------------------------------------------------------------------
-- 14. Canlı destek RPC'leri
-- -----------------------------------------------------------------------------

create or replace function public.support_presence_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'online', exists (
      select 1 from public.support_agent_presence
      where status = 'online' and last_seen_at > now() - interval '2 minutes'
    ),
    'agents_online', (
      select count(*) from public.support_agent_presence
      where status = 'online' and last_seen_at > now() - interval '2 minutes'
    ),
    'checked_at', now()
  );
$$;

create or replace function public.support_live_start(
  p_category text default 'other',
  p_subject text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.support_live_threads%rowtype;
  v_no text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  perform public.safety_check_rate('support_live_start', 5, interval '1 hour');

  select * into v_row
  from public.support_live_threads
  where user_id = v_uid and status in ('waiting', 'active')
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'id', v_row.id, 'thread_no', v_row.thread_no, 'status', v_row.status,
      'created', false
    );
  end if;

  v_no := 'CD-' || to_char(now(), 'YYMM') || '-'
          || lpad(nextval('public.support_live_thread_no_seq')::text, 6, '0');

  insert into public.support_live_threads (thread_no, user_id, category, subject)
  values (v_no, v_uid, left(coalesce(nullif(trim(p_category), ''), 'other'), 40),
          nullif(left(trim(coalesce(p_subject, '')), 160), ''))
  returning * into v_row;

  insert into public.support_live_messages (thread_id, author_id, author_role, body)
  values (
    v_row.id, null, 'system',
    'Talebin alındı. Bir temsilcimiz sohbete katıldığında buradan yanıt vereceğiz. '
    || 'Çocuk güvenliğiyle ilgili acil bir durum varsa lütfen destek talebi oluştur ve 112''yi ara.'
  );

  return jsonb_build_object(
    'id', v_row.id, 'thread_no', v_row.thread_no, 'status', v_row.status,
    'created', true
  );
end
$$;

create or replace function public.support_live_list_my()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'thread_no', t.thread_no,
      'status', t.status,
      'category', t.category,
      'subject', t.subject,
      'last_message_at', t.last_message_at,
      'created_at', t.created_at,
      'unread', (
        select count(*) from public.support_live_messages m
        where m.thread_id = t.id and m.author_role = 'agent' and m.read_at is null
      )
    ) order by t.last_message_at desc)
    from public.support_live_threads t
    where t.user_id = v_uid
  ), '[]'::jsonb);
end
$$;

create or replace function public.support_live_get(p_thread_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_thread public.support_live_threads%rowtype;
  v_is_staff boolean := public.has_permission('support.view');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_thread from public.support_live_threads where id = p_thread_id;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  if v_thread.user_id <> v_uid and not v_is_staff then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_thread.id,
    'thread_no', v_thread.thread_no,
    'status', v_thread.status,
    'category', v_thread.category,
    'subject', v_thread.subject,
    'priority', v_thread.priority,
    'assigned_to', v_thread.assigned_to,
    'created_at', v_thread.created_at,
    'last_message_at', v_thread.last_message_at,
    'can_reply', v_thread.status <> 'closed',
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'author_id', m.author_id,
        'author_role', m.author_role,
        'body', m.body,
        'attachments', m.attachments,
        'read_at', m.read_at,
        'created_at', m.created_at
      ) order by m.created_at)
      from public.support_live_messages m
      where m.thread_id = v_thread.id
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.support_live_send(
  p_thread_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_thread public.support_live_threads%rowtype;
  v_is_staff boolean := public.has_permission('support.view');
  v_role text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_body is null or char_length(trim(p_body)) < 1 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if char_length(p_body) > 4000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 3 then
    raise exception 'invalid_attachments' using errcode = '22023';
  end if;

  select * into v_thread from public.support_live_threads where id = p_thread_id for update;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  if v_thread.user_id <> v_uid and not v_is_staff then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_thread.status = 'closed' then
    raise exception 'thread_closed' using errcode = '22023';
  end if;

  v_role := case when v_thread.user_id = v_uid then 'user' else 'agent' end;

  insert into public.support_live_messages (thread_id, author_id, author_role, body, attachments)
  values (p_thread_id, v_uid, v_role, left(trim(p_body), 4000), coalesce(p_attachments, '[]'::jsonb))
  returning id into v_id;

  update public.support_live_threads
     set last_message_at = now(),
         last_user_message_at = case when v_role = 'user' then now() else last_user_message_at end,
         last_staff_message_at = case when v_role = 'agent' then now() else last_staff_message_at end,
         status = case when v_role = 'agent' and status = 'waiting' then 'active' else status end,
         assigned_to = case when v_role = 'agent' then coalesce(assigned_to, v_uid) else assigned_to end,
         updated_at = now()
   where id = p_thread_id;

  return jsonb_build_object('id', v_id, 'author_role', v_role, 'created_at', now());
end
$$;

create or replace function public.support_live_mark_read(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_thread public.support_live_threads%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_thread from public.support_live_threads where id = p_thread_id;
  if not found or (v_thread.user_id <> v_uid and not public.has_permission('support.view')) then
    raise exception 'not_found' using errcode = '22023';
  end if;

  update public.support_live_messages
     set read_at = now()
   where thread_id = p_thread_id
     and read_at is null
     and author_role <> case when v_thread.user_id = v_uid then 'user' else 'agent' end;

  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.support_live_close(p_thread_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_thread public.support_live_threads%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_thread from public.support_live_threads where id = p_thread_id for update;
  if not found or (v_thread.user_id <> v_uid and not public.has_permission('support.manage')) then
    raise exception 'not_found' using errcode = '22023';
  end if;

  update public.support_live_threads
     set status = 'closed', closed_at = now(), updated_at = now()
   where id = p_thread_id;

  insert into public.support_live_messages (thread_id, author_id, author_role, body)
  values (p_thread_id, v_uid, 'system',
          case when v_thread.user_id = v_uid
            then 'Görüşme kullanıcı tarafından kapatıldı.'
            else 'Görüşme destek ekibi tarafından kapatıldı.'
          end);

  return jsonb_build_object('id', p_thread_id, 'status', 'closed');
end
$$;

create or replace function public.support_live_reopen(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_thread public.support_live_threads%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_thread from public.support_live_threads where id = p_thread_id for update;
  if not found or v_thread.user_id <> v_uid then
    raise exception 'not_found' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.support_live_threads
    where user_id = v_uid and status in ('waiting', 'active') and id <> p_thread_id
  ) then
    raise exception 'another_thread_open' using errcode = '22023';
  end if;

  update public.support_live_threads
     set status = 'waiting', closed_at = null, updated_at = now()
   where id = p_thread_id;

  insert into public.support_live_messages (thread_id, author_id, author_role, body)
  values (p_thread_id, v_uid, 'system', 'Görüşme yeniden açıldı.');

  return jsonb_build_object('id', p_thread_id, 'status', 'waiting');
end
$$;

create or replace function public.support_agent_heartbeat(p_status text default 'online')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public.require_permission('support.view');

  if p_status not in ('online', 'away', 'offline') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  insert into public.support_agent_presence (user_id, status, last_seen_at, updated_at)
  values (v_uid, p_status, now(), now())
  on conflict (user_id) do update
    set status = excluded.status,
        last_seen_at = now(),
        updated_at = now();

  return jsonb_build_object('status', p_status, 'last_seen_at', now());
end
$$;

create or replace function public.support_agent_threads(
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_total bigint;
begin
  perform public.require_permission('support.view');

  select count(*) into v_total
  from public.support_live_threads t
  where p_status is null or t.status = p_status;

  return jsonb_build_object(
    'total', v_total,
    'agents_online', (
      select count(*) from public.support_agent_presence
      where status = 'online' and last_seen_at > now() - interval '2 minutes'
    ),
    'items', coalesce((
      select jsonb_agg(item order by item ->> 'last_message_at' desc)
      from (
        select jsonb_build_object(
          'id', t.id,
          'thread_no', t.thread_no,
          'user_id', t.user_id,
          'username', p.username,
          'display_name', p.display_name,
          'status', t.status,
          'category', t.category,
          'subject', t.subject,
          'priority', t.priority,
          'assigned_to', t.assigned_to,
          'last_message_at', t.last_message_at,
          'created_at', t.created_at,
          'last_message', (
            select left(m.body, 140) from public.support_live_messages m
            where m.thread_id = t.id order by m.created_at desc limit 1
          ),
          'unread', (
            select count(*) from public.support_live_messages m
            where m.thread_id = t.id and m.author_role = 'user' and m.read_at is null
          )
        ) as item
        from public.support_live_threads t
        left join public.profiles p on p.id = t.user_id
        where p_status is null or t.status = p_status
        order by t.last_message_at desc
        limit v_limit offset v_offset
      ) s
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.support_agent_claim(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public.require_permission('support.reply');

  update public.support_live_threads
     set assigned_to = v_uid,
         status = case when status = 'waiting' then 'active' else status end,
         updated_at = now()
   where id = p_thread_id
     and status <> 'closed';

  if not found then
    raise exception 'not_found_or_closed' using errcode = '22023';
  end if;

  return jsonb_build_object('id', p_thread_id, 'assigned_to', v_uid);
end
$$;

-- -----------------------------------------------------------------------------
-- 15. İletişim RPC'leri
-- -----------------------------------------------------------------------------

create or replace function public.contact_channels_public()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', c.key,
      'label', c.label,
      'email', c.email,
      'description', c.description,
      'sort_order', c.sort_order
    ) order by c.sort_order)
    from public.contact_channels c
    where c.is_active and c.email is not null and c.verified_at is not null
  ), '[]'::jsonb);
$$;

create or replace function public.contact_submit(
  p_name text,
  p_email text,
  p_topic text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_row public.contact_submissions%rowtype;
  v_recent integer;
begin
  if p_topic not in ('support', 'privacy', 'child_safety', 'legal', 'business', 'other') then
    raise exception 'invalid_topic' using errcode = '22023';
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_message is null or char_length(trim(p_message)) < 10 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;

  select count(*) into v_recent
  from public.contact_submissions c
  where lower(c.email) = lower(trim(p_email))
    and c.created_at > now() - interval '1 hour';

  if v_recent >= 3 then
    raise exception 'rate_limited' using errcode = '42900';
  end if;

  v_code := 'CT-' || to_char(now(), 'YYMM') || '-'
            || lpad((floor(random() * 1000000))::text, 6, '0');

  insert into public.contact_submissions (
    reference_code, user_id, name, email, topic, message
  )
  values (
    v_code, v_uid, left(trim(p_name), 120), lower(trim(p_email)),
    p_topic, left(trim(p_message), 4000)
  )
  returning * into v_row;

  perform public.tz_enqueue_email(
    'contact_received', v_row.email,
    jsonb_build_object('reference_code', v_code, 'topic', p_topic),
    v_uid, 'tr', 'contact-' || v_row.id::text
  );

  if p_topic = 'child_safety' then
    perform public.tz_enqueue_email(
      'child_safety_received', 'support@litxtech.com',
      jsonb_build_object('reference_code', v_code, 'topic', p_topic),
      null, 'tr', 'contact-child-' || v_row.id::text
    );
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'reference_code', v_row.reference_code,
    'created_at', v_row.created_at
  );
end
$$;

create or replace function public.admin_contact_channels()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_permission('website.manage');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', c.key,
      'label', c.label,
      'email', c.email,
      'description', c.description,
      'is_active', c.is_active,
      'verified_at', c.verified_at,
      'sort_order', c.sort_order,
      'updated_at', c.updated_at
    ) order by c.sort_order)
    from public.contact_channels c
  ), '[]'::jsonb);
end
$$;

create or replace function public.admin_contact_channel_save(
  p_key text,
  p_label text,
  p_email text,
  p_description text default null,
  p_is_active boolean default false,
  p_verified boolean default false,
  p_sort_order integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.contact_channels%rowtype;
begin
  perform public.require_permission('website.manage');

  if p_key !~ '^[a-z_]{3,32}$' then
    raise exception 'invalid_key' using errcode = '22023';
  end if;
  if p_email is not null and p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  -- Doğrulanmamış bir adres üretimde otomatik yayınlanmaz.
  if p_is_active and not p_verified then
    raise exception 'email_not_verified' using errcode = '22023';
  end if;

  insert into public.contact_channels (
    key, label, email, description, is_active, verified_at, sort_order, updated_at, updated_by
  )
  values (
    p_key, trim(p_label), lower(nullif(trim(coalesce(p_email, '')), '')),
    nullif(trim(coalesce(p_description, '')), ''), coalesce(p_is_active, false),
    case when p_verified then now() else null end, coalesce(p_sort_order, 100), now(), v_uid
  )
  on conflict (key) do update
    set label = excluded.label,
        email = excluded.email,
        description = excluded.description,
        is_active = excluded.is_active,
        verified_at = case
          when excluded.email is distinct from public.contact_channels.email then excluded.verified_at
          else coalesce(public.contact_channels.verified_at, excluded.verified_at)
        end,
        sort_order = excluded.sort_order,
        updated_at = now(),
        updated_by = v_uid
  returning * into v_row;

  perform public.safety_audit(
    'website.contact.save', 'İletişim kanalı güncellendi', 'contact_channel',
    p_key, jsonb_build_object('active', v_row.is_active, 'email_changed', p_email is not null)
  );

  return jsonb_build_object(
    'key', v_row.key, 'label', v_row.label, 'email', v_row.email,
    'is_active', v_row.is_active, 'verified_at', v_row.verified_at
  );
end
$$;

create or replace function public.admin_contact_submissions(
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  perform public.require_permission('website.manage');

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(item order by item ->> 'created_at' desc)
      from (
        select jsonb_build_object(
          'id', c.id, 'reference_code', c.reference_code,
          'name', c.name, 'email', c.email, 'topic', c.topic,
          'message', c.message, 'status', c.status, 'created_at', c.created_at
        ) as item
        from public.contact_submissions c
        where p_status is null or c.status = p_status
        order by c.created_at desc
        limit v_limit offset v_offset
      ) s
    ), '[]'::jsonb)
  );
end
$$;

-- -----------------------------------------------------------------------------
-- 16. Web sitesi içerik RPC'leri
-- -----------------------------------------------------------------------------

create or replace function public.website_public_content()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'settings', coalesce((
      select jsonb_object_agg(s.key, s.value)
      from public.website_settings s
    ), '{}'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', s.key, 'title', s.title, 'subtitle', s.subtitle,
        'body', s.body, 'payload', s.payload, 'sort_order', s.sort_order
      ) order by s.sort_order)
      from public.website_sections s
      where s.is_published
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.admin_website_content()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_permission('website.manage');

  return jsonb_build_object(
    'settings', coalesce((
      select jsonb_object_agg(s.key, s.value) from public.website_settings s
    ), '{}'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', s.key, 'title', s.title, 'subtitle', s.subtitle,
        'body', s.body, 'payload', s.payload, 'sort_order', s.sort_order,
        'is_published', s.is_published, 'updated_at', s.updated_at
      ) order by s.sort_order)
      from public.website_sections s
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.admin_website_setting_save(
  p_key text,
  p_value jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public.require_permission('website.manage');

  if p_key !~ '^[a-z0-9_.]{3,64}$' then
    raise exception 'invalid_key' using errcode = '22023';
  end if;
  if jsonb_typeof(p_value) <> 'object' then
    raise exception 'invalid_value' using errcode = '22023';
  end if;

  insert into public.website_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = v_uid;

  perform public.safety_audit(
    'website.setting.save', 'Web sitesi ayarı güncellendi', 'website_setting', p_key, p_value
  );

  return jsonb_build_object('key', p_key, 'value', p_value);
end
$$;

create or replace function public.admin_website_section_save(
  p_key text,
  p_title text,
  p_subtitle text default null,
  p_body text default null,
  p_payload jsonb default '{}'::jsonb,
  p_sort_order integer default 100,
  p_is_published boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.website_sections%rowtype;
begin
  perform public.require_permission('website.manage');

  if p_key !~ '^[a-z0-9-]{3,64}$' then
    raise exception 'invalid_key' using errcode = '22023';
  end if;
  if p_title is null or char_length(trim(p_title)) < 2 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  insert into public.website_sections (
    key, title, subtitle, body, payload, sort_order, is_published, updated_at, updated_by
  )
  values (
    p_key, trim(p_title), nullif(trim(coalesce(p_subtitle, '')), ''),
    nullif(trim(coalesce(p_body, '')), ''), coalesce(p_payload, '{}'::jsonb),
    coalesce(p_sort_order, 100), coalesce(p_is_published, true), now(), v_uid
  )
  on conflict (key) do update
    set title = excluded.title,
        subtitle = excluded.subtitle,
        body = excluded.body,
        payload = excluded.payload,
        sort_order = excluded.sort_order,
        is_published = excluded.is_published,
        updated_at = now(),
        updated_by = v_uid
  returning * into v_row;

  perform public.safety_audit(
    'website.section.save', 'Web sitesi bölümü güncellendi', 'website_section', p_key,
    jsonb_build_object('published', v_row.is_published)
  );

  return to_jsonb(v_row);
end
$$;

-- -----------------------------------------------------------------------------
-- 17. E-posta RPC'leri
-- -----------------------------------------------------------------------------

create or replace function public.admin_email_logs(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  perform public.require_permission('website.manage');

  return jsonb_build_object(
    'outbox', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'template_key', o.template_key, 'to_email', o.to_email,
        'status', o.status, 'attempts', o.attempts, 'last_error', o.last_error,
        'created_at', o.created_at, 'sent_at', o.sent_at
      ) order by o.created_at desc)
      from (
        select * from public.email_outbox order by created_at desc limit v_limit
      ) o
    ), '[]'::jsonb),
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', t.key, 'locale', t.locale, 'subject', t.subject,
        'is_active', t.is_active, 'updated_at', t.updated_at
      ) order by t.key)
      from public.email_templates t
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.email_worker_claim(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
begin
  -- Yalnızca service_role çağırabilir (aşağıdaki grant'lara bakın).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return coalesce((
    with picked as (
      select id from public.email_outbox
      where status in ('pending', 'failed')
        and next_attempt_at <= now()
        and attempts < 5
      order by created_at
      limit v_limit
      for update skip locked
    ), updated as (
      update public.email_outbox o
         set status = 'sending', attempts = o.attempts + 1
        from picked
       where o.id = picked.id
       returning o.*
    )
    select jsonb_agg(jsonb_build_object(
      'id', u.id,
      'template_key', u.template_key,
      'locale', u.locale,
      'to_email', u.to_email,
      'payload', u.payload,
      'attempts', u.attempts,
      'subject', t.subject,
      'body_html', t.body_html,
      'body_text', t.body_text
    ))
    from updated u
    left join public.email_templates t
      on t.key = u.template_key and t.locale = u.locale
  ), '[]'::jsonb);
end
$$;

create or replace function public.email_worker_mark(
  p_id uuid,
  p_status text,
  p_error text default null,
  p_provider text default null,
  p_provider_message_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.email_outbox%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  update public.email_outbox
     set status = p_status,
         last_error = left(p_error, 500),
         provider = p_provider,
         provider_message_id = p_provider_message_id,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         next_attempt_at = case
           when p_status = 'failed' then now() + (interval '5 minutes' * attempts)
           else next_attempt_at
         end
   where id = p_id
   returning * into v_row;

  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;

  insert into public.email_delivery_logs (
    outbox_id, template_key, to_email, status, provider, provider_message_id, error
  )
  values (
    v_row.id, v_row.template_key, v_row.to_email, p_status,
    p_provider, p_provider_message_id, left(p_error, 500)
  );

  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end
$$;

-- -----------------------------------------------------------------------------
-- 18. Destek talebi oluşturulunca e-posta kuyruğu
-- -----------------------------------------------------------------------------

create or replace function public.tz_support_ticket_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = new.user_id;
  perform public.tz_enqueue_email(
    'support_ticket_received', v_email,
    jsonb_build_object('ticket_no', new.ticket_no, 'subject', new.subject),
    new.user_id, 'tr', 'ticket-' || new.id::text
  );
  return new;
end
$$;

drop trigger if exists tz_support_ticket_email on public.support_tickets;
create trigger tz_support_ticket_email
  after insert on public.support_tickets
  for each row execute function public.tz_support_ticket_email();

revoke all on function public.tz_support_ticket_email() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 19. Grant'ler
-- -----------------------------------------------------------------------------

revoke all on function public.legal_document(text, text) from public;
revoke all on function public.legal_documents(text) from public;
grant execute on function public.legal_document(text, text) to anon, authenticated;
grant execute on function public.legal_documents(text) to anon, authenticated;

revoke all on function public.legal_record_acceptance(text, text, text, integer, text) from public, anon;
grant execute on function public.legal_record_acceptance(text, text, text, integer, text) to authenticated;

revoke all on function public.legal_my_acceptances() from public, anon;
grant execute on function public.legal_my_acceptances() to authenticated;

revoke all on function public.legal_my_pending() from public, anon;
grant execute on function public.legal_my_pending() to authenticated;

revoke all on function public.legal_admin_versions(text) from public, anon;
grant execute on function public.legal_admin_versions(text) to authenticated;

revoke all on function public.legal_admin_save(text, text, text, text, text, text, boolean, timestamptz, text, boolean) from public, anon;
grant execute on function public.legal_admin_save(text, text, text, text, text, text, boolean, timestamptz, text, boolean) to authenticated;

revoke all on function public.legal_admin_publish(uuid, timestamptz) from public, anon;
grant execute on function public.legal_admin_publish(uuid, timestamptz) to authenticated;

revoke all on function public.legal_admin_archive(uuid, text) from public, anon;
grant execute on function public.legal_admin_archive(uuid, text) to authenticated;

revoke all on function public.consents_my() from public, anon;
grant execute on function public.consents_my() to authenticated;

revoke all on function public.consent_set(text, boolean, text) from public, anon;
grant execute on function public.consent_set(text, boolean, text) to authenticated;

revoke all on function public.privacy_request_create(text, text, text) from public, anon;
grant execute on function public.privacy_request_create(text, text, text) to authenticated;

revoke all on function public.privacy_request_list_my() from public, anon;
grant execute on function public.privacy_request_list_my() to authenticated;

revoke all on function public.privacy_request_get(uuid) from public, anon;
grant execute on function public.privacy_request_get(uuid) to authenticated;

revoke all on function public.privacy_request_cancel(uuid) from public, anon;
grant execute on function public.privacy_request_cancel(uuid) to authenticated;

revoke all on function public.admin_privacy_requests(text, integer, integer) from public, anon;
grant execute on function public.admin_privacy_requests(text, integer, integer) to authenticated;

revoke all on function public.admin_privacy_request_update(uuid, text, text, text) from public, anon;
grant execute on function public.admin_privacy_request_update(uuid, text, text, text) to authenticated;

revoke all on function public.support_presence_status() from public;
grant execute on function public.support_presence_status() to anon, authenticated;

revoke all on function public.support_live_start(text, text) from public, anon;
grant execute on function public.support_live_start(text, text) to authenticated;

revoke all on function public.support_live_list_my() from public, anon;
grant execute on function public.support_live_list_my() to authenticated;

revoke all on function public.support_live_get(uuid) from public, anon;
grant execute on function public.support_live_get(uuid) to authenticated;

revoke all on function public.support_live_send(uuid, text, jsonb) from public, anon;
grant execute on function public.support_live_send(uuid, text, jsonb) to authenticated;

revoke all on function public.support_live_mark_read(uuid) from public, anon;
grant execute on function public.support_live_mark_read(uuid) to authenticated;

revoke all on function public.support_live_close(uuid, text) from public, anon;
grant execute on function public.support_live_close(uuid, text) to authenticated;

revoke all on function public.support_live_reopen(uuid) from public, anon;
grant execute on function public.support_live_reopen(uuid) to authenticated;

revoke all on function public.support_agent_heartbeat(text) from public, anon;
grant execute on function public.support_agent_heartbeat(text) to authenticated;

revoke all on function public.support_agent_threads(text, integer, integer) from public, anon;
grant execute on function public.support_agent_threads(text, integer, integer) to authenticated;

revoke all on function public.support_agent_claim(uuid) from public, anon;
grant execute on function public.support_agent_claim(uuid) to authenticated;

revoke all on function public.contact_channels_public() from public;
grant execute on function public.contact_channels_public() to anon, authenticated;

revoke all on function public.contact_submit(text, text, text, text) from public;
grant execute on function public.contact_submit(text, text, text, text) to anon, authenticated;

revoke all on function public.admin_contact_channels() from public, anon;
grant execute on function public.admin_contact_channels() to authenticated;

revoke all on function public.admin_contact_channel_save(text, text, text, text, boolean, boolean, integer) from public, anon;
grant execute on function public.admin_contact_channel_save(text, text, text, text, boolean, boolean, integer) to authenticated;

revoke all on function public.admin_contact_submissions(text, integer, integer) from public, anon;
grant execute on function public.admin_contact_submissions(text, integer, integer) to authenticated;

revoke all on function public.website_public_content() from public;
grant execute on function public.website_public_content() to anon, authenticated;

revoke all on function public.admin_website_content() from public, anon;
grant execute on function public.admin_website_content() to authenticated;

revoke all on function public.admin_website_setting_save(text, jsonb) from public, anon;
grant execute on function public.admin_website_setting_save(text, jsonb) to authenticated;

revoke all on function public.admin_website_section_save(text, text, text, text, jsonb, integer, boolean) from public, anon;
grant execute on function public.admin_website_section_save(text, text, text, text, jsonb, integer, boolean) to authenticated;

revoke all on function public.admin_email_logs(integer) from public, anon;
grant execute on function public.admin_email_logs(integer) to authenticated;

revoke all on function public.email_worker_claim(integer) from public, anon, authenticated;
grant execute on function public.email_worker_claim(integer) to service_role;

revoke all on function public.email_worker_mark(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.email_worker_mark(uuid, text, text, text, text) to service_role;
