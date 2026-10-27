-- =============================================================================
-- 0005: Destek merkezi, anlik bildirme, moderasyon ve denetim
-- =============================================================================
-- Mevcut sema korunur: 202610270001_core + 202610270002_reporting tarafindan
-- olusturulan support_tickets / user_reports / child_safety_incidents /
-- moderation_actions / admin_audit_logs tablolari SILINMEZ, yalnizca genisletilir.
--
-- Guven modeli:
--   * Kullanici yazma islemleri yalnizca SECURITY DEFINER RPC'ler ile yapilir.
--   * Tablolara dogrudan insert/update yetkisi verilmez (spam + sahte kayit onlenir).
--   * Yetkili personel kontrolleri istemci iddiasina degil, sunucudaki
--     user_role_assignments + admin_role_permissions tablolarina dayanir.
--   * Bildiren kisinin kimligi bildirilen kullaniciya gosterilmez; bunu saglayan
--     RPC'ler yalnizca sahibine doner.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- Sira numaralari (bassvuru numaralari icin)
-- -----------------------------------------------------------------------------
create sequence if not exists public.support_ticket_no_seq start 1000;
create sequence if not exists public.report_no_seq start 1000;
create sequence if not exists public.child_report_no_seq start 100
;

-- -----------------------------------------------------------------------------
-- Destek talebi: kanonik durum ve kategori
-- -----------------------------------------------------------------------------
alter table public.support_tickets
  add column if not exists ticket_no text,
  add column if not exists category_code text,
  add column if not exists status_code text,
  add column if not exists assigned_to uuid references public.profiles (id) on delete set null,
  add column if not exists sla_due_at timestamptz,
  add column if not exists last_message_at timestamptz,
  add column if not exists last_user_message_at timestamptz,
  add column if not exists last_staff_message_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists reopen_count integer not null default 0,
  add column if not exists reference_type text,
  add column if not exists reference_id text,
  add column if not exists first_response_at timestamptz,
  add column if not exists metadata_safe jsonb not null default '{}'::jsonb;

update public.support_tickets
   set status_code = case status
     when 'open' then 'received'
     when 'pending' then 'under_review'
     when 'resolved' then 'resolved'
     when 'closed' then 'closed'
     else 'received'
   end
 where status_code is null;

update public.support_tickets
   set category_code = case
     when category in ('account', 'login', 'auth') then 'account_access'
     when category in ('security', 'privacy') then 'security_privacy'
     when category in ('technical', 'bug') then 'technical'
     when category in ('post', 'reels', 'content') then 'content'
     when category in ('messaging', 'call', 'calls') then 'messaging_calls'
     when category in ('payment', 'order', 'purchase') then 'payments'
     when category in ('notification', 'complaint') then 'notifications'
     when category in ('child_safety', 'child') then 'child_safety'
     else 'other'
   end
 where category_code is null;

update public.support_tickets
   set ticket_no = 'D-' || to_char(created_at, 'YYMM') || '-'
       || lpad(nextval('public.support_ticket_no_seq')::text, 6, '0')
 where ticket_no is null;

alter table public.support_tickets
  alter column status_code set default 'received',
  alter column category_code set default 'other';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_tickets_status_code_check') then
    alter table public.support_tickets
      add constraint support_tickets_status_code_check
      check (status_code in (
        'received', 'under_review', 'awaiting_user', 'info_required',
        'priority_review', 'resolved', 'closed'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'support_tickets_category_code_check') then
    alter table public.support_tickets
      add constraint support_tickets_category_code_check
      check (category_code in (
        'account_access', 'security_privacy', 'technical', 'content',
        'messaging_calls', 'payments', 'notifications', 'child_safety', 'other'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'support_tickets_metadata_object') then
    alter table public.support_tickets
      add constraint support_tickets_metadata_object
      check (jsonb_typeof(metadata_safe) = 'object');
  end if;
end
$$;

create unique index if not exists support_tickets_ticket_no_key
  on public.support_tickets (ticket_no);
create index if not exists support_tickets_user_created_idx
  on public.support_tickets (user_id, created_at desc);
create index if not exists support_tickets_status_code_idx
  on public.support_tickets (status_code, created_at desc);
create index if not exists support_tickets_sla_idx
  on public.support_tickets (sla_due_at)
  where status_code not in ('resolved', 'closed');

-- Eski `status` kolonu rapor view'lari icin kanonik durumla senkron tutulur.
create or replace function public.tz_support_ticket_status_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.status := case new.status_code
    when 'received' then 'open'
    when 'under_review' then 'pending'
    when 'awaiting_user' then 'pending'
    when 'info_required' then 'pending'
    when 'priority_review' then 'pending'
    when 'resolved' then 'resolved'
    else 'closed'
  end;

  if new.status_code in ('resolved', 'closed') and new.closed_at is null then
    new.closed_at := now();
  end if;

  if new.status_code not in ('resolved', 'closed') then
    new.closed_at := null;
  end if;

  return new;
end
$$;

drop trigger if exists tz_support_ticket_status_sync on public.support_tickets;
create trigger tz_support_ticket_status_sync
  before insert or update of status_code on public.support_tickets
  for each row execute function public.tz_support_ticket_status_sync();

-- -----------------------------------------------------------------------------
-- Destek mesajlari: ek dosya, dahili not, okundu bilgisi
-- -----------------------------------------------------------------------------
alter table public.support_ticket_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists is_internal boolean not null default false,
  add column if not exists read_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_messages_attachments_array') then
    alter table public.support_ticket_messages
      add constraint support_messages_attachments_array
      check (jsonb_typeof(attachments) = 'array');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'support_messages_body_length') then
    alter table public.support_ticket_messages
      add constraint support_messages_body_length
      check (char_length(body) between 1 and 4000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'support_messages_role_check') then
    alter table public.support_ticket_messages
      add constraint support_messages_role_check
      check (author_role in ('user', 'agent', 'system'));
  end if;
end
$$;

create index if not exists support_messages_ticket_created_idx
  on public.support_ticket_messages (ticket_id, created_at);

-- -----------------------------------------------------------------------------
-- Bildirim nedeni katalogu (sunucu tarafinda dogrulanir)
-- -----------------------------------------------------------------------------
create table if not exists public.report_reason_catalog (
  code           text primary key,
  parent_code    text references public.report_reason_catalog (code) on delete cascade,
  label_tr       text not null,
  description_tr text,
  is_child_safe  boolean not null default false,
  default_priority text not null default 'normal'
    check (default_priority in ('normal', 'high', 'critical')),
  requires_target_user boolean not null default false,
  sort_order     integer not null default 100,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

insert into public.report_reason_catalog
  (code, parent_code, label_tr, is_child_safe, default_priority, sort_order) values
  ('child_safety', null, 'Çocuk güvenliği ve istismarı', true, 'high', 10),
  ('sexual_content', null, 'Cinsel içerik veya çıplaklık', false, 'high', 20),
  ('harassment', null, 'Taciz veya zorbalık', false, 'high', 30),
  ('hate_speech', null, 'Nefret söylemi ve ayrımcılık', false, 'high', 40),
  ('violence_threat', null, 'Şiddet veya tehdit', false, 'high', 50),
  ('fraud_fake_account', null, 'Dolandırıcılık veya sahte hesap', false, 'normal', 60),
  ('personal_info', null, 'Kişisel bilgilerin izinsiz paylaşılması', false, 'high', 70),
  ('spam_misleading', null, 'Spam veya yanıltıcı içerik', false, 'normal', 80),
  ('self_harm', null, 'İntihar veya kendine zarar verme', false, 'critical', 90),
  ('other', null, 'Diğer', false, 'normal', 100),

  ('child_sexual_exploitation', 'child_safety', 'Çocukların cinsel istismarı veya sömürüsü', true, 'critical', 11),
  ('child_grooming', 'child_safety', 'Çocuğa uygunsuz yaklaşım veya kandırma', true, 'critical', 12),
  ('child_immediate_danger', 'child_safety', 'Çocuğun acil tehlikede olması', true, 'critical', 13),
  ('child_sextortion', 'child_safety', 'Çocuğa yönelik cinsel şantaj veya tehdit', true, 'critical', 14),
  ('child_trafficking', 'child_safety', 'Çocuk ticareti veya istismar amacıyla yönlendirme', true, 'critical', 15),
  ('child_bullying', 'child_safety', 'Çocuğa yönelik zorbalık veya taciz', true, 'high', 16),
  ('child_privacy', 'child_safety', 'Çocuğun özel bilgilerinin tehlikeli biçimde paylaşılması', true, 'high', 17),
  ('child_self_harm', 'child_safety', 'Çocuğu kendine zarar vermeye teşvik', true, 'critical', 18),
  ('child_other', 'child_safety', 'Diğer çocuk güvenliği sorunları', true, 'high', 19)
on conflict (code) do update set
  parent_code = excluded.parent_code,
  label_tr = excluded.label_tr,
  is_child_safe = excluded.is_child_safe,
  default_priority = excluded.default_priority,
  sort_order = excluded.sort_order,
  is_active = true;

-- -----------------------------------------------------------------------------
-- Sikayet/bildirim tablosunu genislet
-- -----------------------------------------------------------------------------
alter table public.user_reports
  add column if not exists report_no text,
  add column if not exists child_reason_code text references public.report_reason_catalog (code),
  add column if not exists is_child_safety boolean not null default false,
  add column if not exists priority text not null default 'normal',
  add column if not exists status_code text,
  add column if not exists sla_due_at timestamptz,
  add column if not exists assigned_to uuid references public.profiles (id) on delete set null,
  add column if not exists target_owner_id uuid references public.profiles (id) on delete set null,
  add column if not exists target_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists resolution_code text,
  add column if not exists resolution_note_public text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists metadata_safe jsonb not null default '{}'::jsonb;

update public.user_reports
   set status_code = case status
     when 'open' then 'received'
     when 'reviewing' then 'under_review'
     when 'resolved' then 'resolved'
     when 'dismissed' then 'dismissed'
     else 'received'
   end
 where status_code is null;

update public.user_reports
   set is_child_safety = true
 where reason_category in ('child_safety') or reason_category like 'child_%';

update public.user_reports
   set priority = case when is_child_safety then 'high' else 'normal' end
 where priority is null or priority = 'normal';

update public.user_reports
   set report_no = case when is_child_safety then 'CG-' else 'B-' end
       || to_char(created_at, 'YYMM') || '-'
       || lpad(nextval('public.report_no_seq')::text, 6, '0')
 where report_no is null;

alter table public.user_reports
  alter column priority set default 'normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_reports_priority_check') then
    alter table public.user_reports
      add constraint user_reports_priority_check
      check (priority in ('normal', 'high', 'critical'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_reports_status_code_check') then
    alter table public.user_reports
      add constraint user_reports_status_code_check
      check (status_code in (
        'received', 'under_review', 'action_taken', 'resolved', 'dismissed', 'closed'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_reports_metadata_object') then
    alter table public.user_reports
      add constraint user_reports_metadata_object
      check (jsonb_typeof(metadata_safe) = 'object');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_reports_target_snapshot_object') then
    alter table public.user_reports
      add constraint user_reports_target_snapshot_object
      check (jsonb_typeof(target_snapshot) = 'object');
  end if;
end
$$;

alter table public.user_reports drop constraint if exists user_reports_target_type_check;
alter table public.user_reports
  add constraint user_reports_target_type_check
  check (target_type in (
    'user', 'profile', 'post', 'reel', 'comment', 'message',
    'map_share', 'live', 'call', 'room', 'story', 'other'
  ));

create unique index if not exists user_reports_report_no_key
  on public.user_reports (report_no);
create index if not exists user_reports_reporter_created_idx
  on public.user_reports (reporter_id, created_at desc);
create index if not exists user_reports_status_code_idx
  on public.user_reports (status_code, priority, created_at desc);
create index if not exists user_reports_child_idx
  on public.user_reports (created_at desc)
  where is_child_safety;
create index if not exists user_reports_sla_idx
  on public.user_reports (sla_due_at)
  where status_code in ('received', 'under_review');

-- Eski `status` kolonu rapor view'lari icin senkron tutulur.
create or replace function public.tz_user_report_status_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.status := case new.status_code
    when 'received' then 'open'
    when 'under_review' then 'reviewing'
    when 'action_taken' then 'resolved'
    when 'resolved' then 'resolved'
    else 'dismissed'
  end;

  if new.status_code in ('resolved', 'dismissed', 'closed') and new.closed_at is null then
    new.closed_at := now();
  end if;

  return new;
end
$$;

drop trigger if exists tz_user_report_status_sync on public.user_reports;
create trigger tz_user_report_status_sync
  before insert or update of status_code on public.user_reports
  for each row execute function public.tz_user_report_status_sync();

-- -----------------------------------------------------------------------------
-- Bildirim islem gecmisi (her sikayet icin ayri)
-- -----------------------------------------------------------------------------
create table if not exists public.report_actions (
  id            bigserial primary key,
  report_id     uuid not null references public.user_reports (id) on delete cascade,
  actor_id      uuid references public.profiles (id) on delete set null,
  actor_role    text not null default 'system'
    check (actor_role in ('user', 'moderator', 'admin', 'system')),
  action_code   text not null,
  note_internal text,
  note_public   text,
  created_at    timestamptz not null default now()
);

create index if not exists report_actions_report_idx
  on public.report_actions (report_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Moderation denetim kaydi (degistirilemez)
-- -----------------------------------------------------------------------------
create table if not exists public.moderation_audit_logs (
  id          bigserial primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action_code text not null,
  entity_type text not null,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint moderation_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists moderation_audit_created_idx
  on public.moderation_audit_logs (created_at desc);
create index if not exists moderation_audit_entity_idx
  on public.moderation_audit_logs (entity_type, entity_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Uygulama ici guvenlik bildirimleri
-- -----------------------------------------------------------------------------
create table if not exists public.safety_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  entity_type text,
  entity_id   text,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint safety_notifications_title_length check (char_length(title) between 1 and 160),
  constraint safety_notifications_body_length check (body is null or char_length(body) <= 500)
);

create index if not exists safety_notifications_user_idx
  on public.safety_notifications (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Oran sinirlama (sunucu tarafinda)
-- -----------------------------------------------------------------------------
create table if not exists public.safety_rate_limits (
  actor_id     uuid not null,
  action_code  text not null,
  window_start timestamptz not null,
  counter      integer not null default 0,
  primary key (actor_id, action_code, window_start)
);

-- -----------------------------------------------------------------------------
-- SSS ve politika surumleri
-- -----------------------------------------------------------------------------
create table if not exists public.safety_faqs (
  id          uuid primary key default gen_random_uuid(),
  category    text not null default 'general',
  question    text not null,
  answer      text not null,
  sort_order  integer not null default 100,
  is_published boolean not null default true,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint safety_faqs_question_length check (char_length(question) between 5 and 200),
  constraint safety_faqs_answer_length check (char_length(answer) between 10 and 4000)
);

create index if not exists safety_faqs_order_idx
  on public.safety_faqs (is_published, sort_order);

create table if not exists public.safety_policy_versions (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null,
  version      integer not null default 1,
  title        text not null,
  summary      text,
  body_md      text not null,
  is_published boolean not null default false,
  effective_at timestamptz,
  published_at timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (slug, version),
  constraint safety_policy_slug_format check (slug ~ '^[a-z0-9-]{3,64}$')
);

create index if not exists safety_policy_published_idx
  on public.safety_policy_versions (slug, is_published, version desc);

-- -----------------------------------------------------------------------------
-- Yetki katalogu: destek ve moderasyon
-- -----------------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr) values
  ('support.view',        'Destek taleplerini görüntüleme'),
  ('support.reply',       'Destek taleplerine yanıt yazma'),
  ('support.manage',      'Destek talebi durumu, önceliği ve ataması'),
  ('safety.report.view',  'Kullanıcı bildirimlerini görüntüleme'),
  ('safety.report.action','Bildirim hakkında moderasyon kararı verme'),
  ('safety.child.view',   'Çocuk güvenliği bildirimlerini görüntüleme'),
  ('safety.child.action', 'Çocuk güvenliği bildirimlerinde işlem yapma'),
  ('safety.age.view',     'Yaş güvencesi ve veli onayı kayıtlarını görüntüleme'),
  ('safety.faq.manage',   'Destek SSS içeriğini yönetme'),
  ('safety.policy.manage','Güvenlik politikası sürümlerini yönetme')
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_key, permission_code)
select r.key, p.code
from public.roles r
cross join public.admin_permissions p
where p.code in ('support.view', 'support.reply', 'support.manage', 'safety.report.view', 'safety.report.action')
  and r.key in ('admin', 'super_admin', 'moderator')
on conflict do nothing;

insert into public.admin_role_permissions (role_key, permission_code)
select r.key, p.code
from public.roles r
cross join public.admin_permissions p
where p.code in ('safety.child.view', 'safety.child.action', 'safety.age.view')
  and r.key in ('admin', 'super_admin')
on conflict do nothing;

insert into public.admin_role_permissions (role_key, permission_code)
select 'super_admin', code
from public.admin_permissions
where code in ('safety.faq.manage', 'safety.policy.manage')
on conflict do nothing;

insert into public.admin_role_permissions (role_key, permission_code)
select 'admin', code
from public.admin_permissions
where code in ('safety.faq.manage', 'safety.policy.manage')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Yardimci fonksiyonlar
-- -----------------------------------------------------------------------------
create or replace function public.safety_require_auth()
returns uuid
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
  return v_uid;
end
$$;

create or replace function public.safety_check_rate(
  p_action text,
  p_limit integer,
  p_window interval
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_window_start timestamptz;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Sabit pencerelere yuvarlama: ayni pencere icindeki istekler ayni satiri kullanir.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / extract(epoch from p_window))
      * extract(epoch from p_window)
  );

  insert into public.safety_rate_limits (actor_id, action_code, window_start, counter)
  values (v_uid, p_action, v_window_start, 1)
  on conflict (actor_id, action_code, window_start)
  do update set counter = public.safety_rate_limits.counter + 1
  returning counter into v_count;

  if v_count > p_limit then
    raise exception 'rate_limited' using errcode = '42900';
  end if;
end
$$;

create or replace function public.safety_notify(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_entity_type text default null,
  p_entity_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  insert into public.safety_notifications (user_id, kind, title, body, entity_type, entity_id)
  values (p_user_id, left(p_kind, 48), left(p_title, 160), left(p_body, 500),
          left(p_entity_type, 32), left(p_entity_id, 120))
  returning id into v_id;

  return v_id;
end
$$;

create or replace function public.safety_log_activity(
  p_uid uuid,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb,
  p_source text default 'system'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_uid is null then
    return;
  end if;

  if not exists (select 1 from public.activity_event_types where code = p_event_type) then
    return;
  end if;

  insert into public.activity_events (
    actor_user_id, event_type, category, source, outcome, safe_metadata, visibility_scope
  )
  select p_uid, p_event_type, t.category, p_source, 'success',
         coalesce(p_metadata, '{}'::jsonb), t.default_visibility
  from public.activity_event_types t
  where t.code = p_event_type;
exception
  when others then
    -- Islem gecmisi yazimi ana is akisini bozmamali.
    null;
end
$$;

create or replace function public.safety_audit(
  p_action_code text,
  p_label_tr text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
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
    left(coalesce(p_action_code, 'safety.action'), 80),
    left(coalesce(p_label_tr, 'İşlem'), 160),
    left(p_target_type, 64),
    left(p_target_id, 200),
    'success',
    coalesce(p_metadata, '{}'::jsonb)
  );
exception
  when others then
    null;
end
$$;

create or replace function public.safety_staff_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_permissions text[];
begin
  if v_uid is null then
    return jsonb_build_object('user_id', null, 'is_staff', false, 'permissions', '[]'::jsonb);
  end if;

  select coalesce(array_agg(s.code order by s.code), array[]::text[])
  into v_permissions
  from (
    select p.code
    from public.admin_permissions p
    where (
      p.code like 'support.%'
      or p.code like 'safety.%'
      or p.code in ('report.moderation', 'audit.view')
    )
    and public.has_permission(p.code)
  ) s;

  return jsonb_build_object(
    'user_id', v_uid,
    'is_staff', coalesce(array_length(v_permissions, 1), 0) > 0,
    'permissions', to_jsonb(coalesce(v_permissions, array[]::text[]))
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Destek talebi islemleri (kullanici)
-- -----------------------------------------------------------------------------
create or replace function public.safety_create_support_ticket(
  p_category text,
  p_subject text,
  p_body text,
  p_attachments jsonb default '[]'::jsonb,
  p_reference_type text default null,
  p_reference_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_category text := coalesce(nullif(trim(p_category), ''), 'other');
  v_subject text := trim(coalesce(p_subject, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_ticket_id uuid;
  v_ticket_no text;
  v_sla timestamptz;
  v_priority text := 'normal';
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
begin
  if v_category not in ('account_access', 'security_privacy', 'technical', 'content',
                        'messaging_calls', 'payments', 'notifications', 'child_safety', 'other') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  if char_length(v_subject) < 3 then
    raise exception 'invalid_subject' using errcode = '22023';
  end if;

  if char_length(v_body) < 10 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;

  if jsonb_typeof(v_attachments) <> 'array' or jsonb_array_length(v_attachments) > 3 then
    raise exception 'invalid_attachments' using errcode = '22023';
  end if;

  perform public.safety_check_rate('support_ticket_create', 5, interval '1 hour');

  if v_category = 'child_safety' then
    v_priority := 'urgent';
    v_sla := now() + interval '30 minutes';
  else
    v_sla := now() + interval '24 hours';
  end if;

  insert into public.support_tickets (
    user_id, subject, category, category_code, status, status_code, priority, sla_due_at,
    last_message_at, last_user_message_at, reference_type, reference_id, metadata_safe
  )
  values (
    v_uid, left(v_subject, 160), 'general', v_category, 'open', 'received', v_priority, v_sla,
    now(), now(), nullif(p_reference_type, ''), nullif(p_reference_id, ''),
    jsonb_build_object('source', 'app')
  )
  returning id into v_ticket_id;

  update public.support_tickets
     set ticket_no = 'D-' || to_char(now(), 'YYMM') || '-'
       || lpad(nextval('public.support_ticket_no_seq')::text, 6, '0')
   where id = v_ticket_id
  returning ticket_no into v_ticket_no;

  insert into public.support_ticket_messages (ticket_id, author_id, author_role, body, attachments)
  values (v_ticket_id, v_uid, 'user', left(v_body, 4000), v_attachments);

  perform public.safety_notify(
    v_uid, 'support_received', 'Destek talebiniz alındı',
    'Talebiniz destek ekibimize iletildi. Gelişmeleri Başvurularım bölümünden takip edebilirsiniz.',
    'support_ticket', v_ticket_id::text
  );

  perform public.safety_log_activity(v_uid, 'support.ticket_created',
    jsonb_build_object('category', left(v_category, 32)), 'app');

  return jsonb_build_object(
    'id', v_ticket_id,
    'ticket_no', v_ticket_no,
    'status_code', 'received',
    'priority', v_priority,
    'category_code', v_category,
    'sla_due_at', v_sla,
    'created_at', now()
  );
end
$$;

create or replace function public.safety_list_my_tickets()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_items jsonb;
begin
  select coalesce(jsonb_agg(item order by item ->> 'created_at' desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', t.id,
      'ticket_no', t.ticket_no,
      'subject', t.subject,
      'category_code', t.category_code,
      'status_code', t.status_code,
      'priority', t.priority,
      'created_at', t.created_at,
      'last_message_at', t.last_message_at,
      'sla_due_at', t.sla_due_at,
      'unread', (
        select count(*) from public.support_ticket_messages m
        where m.ticket_id = t.id and m.author_role = 'agent' and m.read_at is null
      )
    ) as item
    from public.support_tickets t
    where t.user_id = v_uid
  ) s;

  return jsonb_build_object('items', v_items);
end
$$;

create or replace function public.safety_get_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_ticket public.support_tickets%rowtype;
  v_messages jsonb;
  v_is_staff boolean;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;

  if not found then
    raise exception 'ticket_not_found' using errcode = '22023';
  end if;

  v_is_staff := public.has_permission('support.view');

  if v_ticket.user_id <> v_uid and not v_is_staff then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'author_role', m.author_role,
    'body', m.body,
    'attachments', m.attachments,
    'created_at', m.created_at,
    'read_at', m.read_at
  ) order by m.created_at), '[]'::jsonb)
  into v_messages
  from public.support_ticket_messages m
  where m.ticket_id = p_ticket_id
    and (not m.is_internal
         or public.has_permission('support.reply'));

  -- Kullanici, destek mesajlarini gordugunde okundu olarak isaretlenir.
  if v_ticket.user_id = v_uid then
    update public.support_ticket_messages
       set read_at = now()
     where ticket_id = p_ticket_id and author_role = 'agent' and read_at is null;
  end if;

  return jsonb_build_object(
    'id', v_ticket.id,
    'ticket_no', v_ticket.ticket_no,
    'subject', v_ticket.subject,
    'category_code', v_ticket.category_code,
    'status_code', v_ticket.status_code,
    'priority', v_ticket.priority,
    'created_at', v_ticket.created_at,
    'last_message_at', v_ticket.last_message_at,
    'sla_due_at', v_ticket.sla_due_at,
    'closed_at', v_ticket.closed_at,
    'assigned_to', case when v_is_staff then v_ticket.assigned_to else null end,
    'messages', v_messages,
    'is_staff_view', v_is_staff,
    'can_reply', v_ticket.status_code not in ('closed') and v_ticket.user_id = v_uid
  );
end
$$;

create or replace function public.safety_send_support_message(
  p_ticket_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_ticket public.support_tickets%rowtype;
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_message_id uuid;
begin
  if char_length(trim(coalesce(p_body, ''))) < 1 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;

  if jsonb_typeof(v_attachments) <> 'array' or jsonb_array_length(v_attachments) > 3 then
    raise exception 'invalid_attachments' using errcode = '22023';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if not found then
    raise exception 'ticket_not_found' using errcode = '22023';
  end if;

  if v_ticket.user_id <> v_uid then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_ticket.status_code = 'closed' then
    raise exception 'ticket_closed' using errcode = '22023';
  end if;

  perform public.safety_check_rate('support_message_create', 30, interval '1 hour');

  insert into public.support_ticket_messages (ticket_id, author_id, author_role, body, attachments)
  values (p_ticket_id, v_uid, 'user', left(trim(p_body), 4000), v_attachments)
  returning id into v_message_id;

  update public.support_tickets
     set last_message_at = now(),
         last_user_message_at = now(),
         status_code = case
           when status_code = 'awaiting_user' then 'under_review'
           when status_code = 'info_required' then 'under_review'
           else status_code
         end
   where id = p_ticket_id;

  perform public.safety_notify(
    v_uid, 'support_message_sent', 'Mesajınız iletildi',
    'Destek ekibimize mesajınız ulaştı.', 'support_ticket', p_ticket_id::text
  );

  return jsonb_build_object('id', v_message_id, 'created_at', now());
end
$$;

create or replace function public.safety_set_ticket_status(
  p_ticket_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_ticket public.support_tickets%rowtype;
  v_next text;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if not found then
    raise exception 'ticket_not_found' using errcode = '22023';
  end if;

  if v_ticket.user_id <> v_uid then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_action = 'close' then
    if v_ticket.status_code in ('resolved', 'closed') then
      raise exception 'invalid_state' using errcode = '22023';
    end if;
    v_next := 'closed';
  elsif p_action = 'reopen' then
    if v_ticket.status_code not in ('resolved', 'closed') then
      raise exception 'invalid_state' using errcode = '22023';
    end if;
    perform public.safety_check_rate('support_reopen', 3, interval '1 day');
    v_next := 'under_review';
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  update public.support_tickets
     set status_code = v_next,
         reopen_count = reopen_count + case when p_action = 'reopen' then 1 else 0 end,
         sla_due_at = case when p_action = 'reopen' then now() + interval '24 hours' else sla_due_at end
   where id = p_ticket_id;

  insert into public.support_ticket_messages (ticket_id, author_id, author_role, body)
  values (
    p_ticket_id,
    v_uid,
    'system',
    case when p_action = 'reopen'
      then 'Kullanıcı başvuruyu yeniden açtı.'
      else 'Kullanıcı başvuruyu kapattı.'
    end
  );

  insert into public.admin_audit_logs (
    actor_admin_id, action_code, action_label_tr, target_type, target_id, outcome, metadata_safe
  )
  values (
    v_uid, 'support.user_' || p_action,
    case when p_action = 'reopen' then 'Kullanıcı destek talebini yeniden açtı'
         else 'Kullanıcı destek talebini kapattı' end,
    'support_ticket', p_ticket_id::text, 'success',
    jsonb_build_object('status', v_next)
  );

  return jsonb_build_object('id', p_ticket_id, 'status_code', v_next);
end
$$;

-- -----------------------------------------------------------------------------
-- Bildirim olusturma (kullanici)
-- -----------------------------------------------------------------------------
create or replace function public.safety_create_report(
  p_target_type text,
  p_target_id text,
  p_reason_code text,
  p_child_reason_code text default null,
  p_description text default null,
  p_target_user_id uuid default null,
  p_attachments jsonb default '[]'::jsonb,
  p_target_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_target_type text := coalesce(nullif(trim(p_target_type), ''), 'other');
  v_target_id text := left(trim(coalesce(p_target_id, '')), 200);
  v_reason text := coalesce(nullif(trim(p_reason_code), ''), 'other');
  v_child_reason text := nullif(trim(coalesce(p_child_reason_code, '')), '');
  v_reason_row public.report_reason_catalog%rowtype;
  v_child_row public.report_reason_catalog%rowtype;
  v_is_child boolean := false;
  v_priority text := 'normal';
  v_sla timestamptz;
  v_report_id uuid;
  v_report_no text;
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_snapshot jsonb := coalesce(p_target_snapshot, '{}'::jsonb);
  v_severity text;
  v_case_id uuid;
begin
  if v_target_type not in ('user', 'profile', 'post', 'reel', 'comment', 'message',
                           'map_share', 'live', 'call', 'room', 'story', 'other') then
    raise exception 'invalid_target_type' using errcode = '22023';
  end if;

  if v_target_id = '' then
    raise exception 'missing_target' using errcode = '22023';
  end if;

  if jsonb_typeof(v_attachments) <> 'array' or jsonb_array_length(v_attachments) > 3 then
    raise exception 'invalid_attachments' using errcode = '22023';
  end if;

  if jsonb_typeof(v_snapshot) <> 'object' or pg_column_size(v_snapshot) > 8192 then
    raise exception 'invalid_snapshot' using errcode = '22023';
  end if;

  select * into v_reason_row from public.report_reason_catalog
  where code = v_reason and is_active and parent_code is null;
  if not found then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  if v_reason = 'child_safety' then
    v_is_child := true;

    if v_child_reason is null then
      raise exception 'missing_child_reason' using errcode = '22023';
    end if;

    select * into v_child_row from public.report_reason_catalog
    where code = v_child_reason and parent_code = 'child_safety' and is_active;
    if not found then
      raise exception 'invalid_child_reason' using errcode = '22023';
    end if;

    v_priority := v_child_row.default_priority;
  else
    v_priority := v_reason_row.default_priority;
  end if;

  -- Oran siniri: kritik cocuk guvenligi bildirimleri sikistirilmaz, yalnizca
  -- ozdes bildirimlerin tekrari engellenir.
  if v_is_child then
    perform public.safety_check_rate('report_child', 30, interval '1 hour');
  else
    perform public.safety_check_rate('report_create', 20, interval '1 day');
  end if;

  if exists (
    select 1 from public.user_reports r
    where r.reporter_id = v_uid
      and r.target_type = v_target_type
      and r.target_id = v_target_id
      and r.reason_category = v_reason
      and r.created_at > now() - interval '24 hours'
      and r.status_code in ('received', 'under_review')
  ) then
    raise exception 'duplicate_report' using errcode = '22023';
  end if;

  v_sla := case
    when v_is_child and v_priority = 'critical' then now() + interval '30 minutes'
    when v_is_child then now() + interval '4 hours'
    else now() + interval '24 hours'
  end;

  insert into public.user_reports (
    reporter_id, target_type, target_id, reason_category, status, status_code,
    child_reason_code, is_child_safety, priority, sla_due_at,
    target_owner_id, target_snapshot, metadata_safe, description
  )
  values (
    v_uid, v_target_type, v_target_id, v_reason, 'open', 'received',
    v_child_reason, v_is_child, v_priority, v_sla,
    p_target_user_id, v_snapshot, jsonb_build_object('attachments', v_attachments),
    left(nullif(trim(coalesce(p_description, '')), ''), 2000)
  )
  returning id into v_report_id;

  update public.user_reports
     set report_no = case when v_is_child then 'CG-' else 'B-' end
       || to_char(now(), 'YYMM') || '-'
       || lpad(nextval('public.report_no_seq')::text, 6, '0')
   where id = v_report_id
  returning report_no into v_report_no;

  insert into public.report_actions (report_id, actor_id, actor_role, action_code)
  values (v_report_id, v_uid, 'user', 'report.created');

  -- Cocuk guvenligi: ayri kritik kuyruk kaydi
  if v_is_child then
    v_severity := case when v_priority = 'critical' then 'critical' else 'high' end;

    insert into public.child_safety_incidents (
      case_ref, severity, category, status, subject_ref, metadata_safe
    )
    values (
      v_report_no, v_severity, v_child_reason, 'open', v_target_id,
      jsonb_build_object('report_id', v_report_id, 'report_no', v_report_no)
    )
    returning id into v_case_id;
  end if;

  perform public.safety_notify(
    v_uid,
    case when v_is_child then 'child_report_received' else 'report_received' end,
    case when v_is_child then 'Bildiriminiz Alındı' else 'Bildiriminiz kaydedildi' end,
    case when v_is_child
      then 'Çocuk güvenliği bildiriminiz öncelikli inceleme sürecine yönlendirildi.'
      else 'Bildiriminiz kayıt altına alındı. İnceleme durumunu Başvurularım bölümünden takip edebilirsiniz.'
    end,
    'report', v_report_id::text
  );

  perform public.safety_log_activity(v_uid, 'report.submitted',
    jsonb_build_object('reason', left(v_reason, 64)), 'app');

  return jsonb_build_object(
    'id', v_report_id,
    'report_no', v_report_no,
    'target_type', v_target_type,
    'target_id', v_target_id,
    'reason_code', v_reason,
    'child_reason_code', v_child_reason,
    'is_child_safety', v_is_child,
    'priority', v_priority,
    'status_code', 'received',
    'sla_due_at', v_sla,
    'created_at', now(),
    'case_id', v_case_id
  );
end
$$;

create or replace function public.safety_list_my_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_items jsonb;
begin
  select coalesce(jsonb_agg(item order by item ->> 'created_at' desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', r.id,
      'report_no', r.report_no,
      'target_type', r.target_type,
      'target_id', r.target_id,
      'reason_code', r.reason_category,
      'child_reason_code', r.child_reason_code,
      'is_child_safety', r.is_child_safety,
      'priority', r.priority,
      'status_code', r.status_code,
      'created_at', r.created_at,
      'reviewed_at', r.reviewed_at,
      'closed_at', r.closed_at,
      'sla_due_at', r.sla_due_at,
      -- Yalnizca kullaniciya gosterilmesine izin verilen sonuc metni doner.
      'resolution_note', r.resolution_note_public
    ) as item
    from public.user_reports r
    where r.reporter_id = v_uid
  ) s;

  return jsonb_build_object('items', v_items);
end
$$;

create or replace function public.safety_get_my_report(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_report public.user_reports%rowtype;
begin
  select * into v_report from public.user_reports
  where id = p_report_id and reporter_id = v_uid;

  if not found then
    raise exception 'report_not_found' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', v_report.id,
    'report_no', v_report.report_no,
    'target_type', v_report.target_type,
    'target_id', v_report.target_id,
    'reason_code', v_report.reason_category,
    'child_reason_code', v_report.child_reason_code,
    'is_child_safety', v_report.is_child_safety,
    'priority', v_report.priority,
    'status_code', v_report.status_code,
    'description', v_report.description,
    'created_at', v_report.created_at,
    'reviewed_at', v_report.reviewed_at,
    'closed_at', v_report.closed_at,
    'sla_due_at', v_report.sla_due_at,
    'resolution_note', v_report.resolution_note_public
  );
end
$$;

create or replace function public.safety_list_my_notifications()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'kind', n.kind,
    'title', n.title,
    'body', n.body,
    'entity_type', n.entity_type,
    'entity_id', n.entity_id,
    'read_at', n.read_at,
    'created_at', n.created_at
  ) order by n.created_at desc), '[]'::jsonb)
  into v_items
  from public.safety_notifications n
  where n.user_id = v_uid;

  return jsonb_build_object('items', v_items);
end
$$;

create or replace function public.safety_mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
begin
  update public.safety_notifications
     set read_at = now()
   where user_id = v_uid and read_at is null;
end
$$;

-- -----------------------------------------------------------------------------
-- SSS ve politika okuma
-- -----------------------------------------------------------------------------
create or replace function public.safety_list_faqs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'category', f.category,
    'question', f.question,
    'answer', f.answer,
    'sort_order', f.sort_order
  ) order by f.sort_order, f.question), '[]'::jsonb)
  from public.safety_faqs f
  where f.is_published;
$$;

create or replace function public.safety_get_policy(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy public.safety_policy_versions%rowtype;
begin
  select * into v_policy
  from public.safety_policy_versions
  where slug = p_slug and is_published
  order by version desc
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'slug', v_policy.slug,
    'version', v_policy.version,
    'title', v_policy.title,
    'summary', v_policy.summary,
    'body_md', v_policy.body_md,
    'effective_at', v_policy.effective_at,
    'published_at', v_policy.published_at
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Yetkili islemleri: destek
-- -----------------------------------------------------------------------------
create or replace function public.safety_admin_list_tickets(
  p_status text default null,
  p_category text default null,
  p_search text default null,
  p_assigned text default 'all',
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
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_total bigint;
  v_items jsonb;
begin
  perform public.require_permission('support.view');

  select count(*) into v_total
  from public.support_tickets t
  where (p_status is null or t.status_code = p_status)
    and (p_category is null or t.category_code = p_category)
    and (
      p_search is null or trim(p_search) = ''
      or t.ticket_no ilike '%' || trim(p_search) || '%'
      or t.subject ilike '%' || trim(p_search) || '%'
      or exists (
        select 1 from public.profiles p
        where p.id = t.user_id
          and (p.username ilike '%' || trim(p_search) || '%'
               or p.display_name ilike '%' || trim(p_search) || '%')
      )
    )
    and (
      p_assigned is null or p_assigned = 'all'
      or (p_assigned = 'me' and t.assigned_to = auth.uid())
      or (p_assigned = 'unassigned' and t.assigned_to is null)
    );

  select coalesce(jsonb_agg(item order by item ->> 'created_at' desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', t.id,
      'ticket_no', t.ticket_no,
      'subject', t.subject,
      'category_code', t.category_code,
      'status_code', t.status_code,
      'priority', t.priority,
      'created_at', t.created_at,
      'last_message_at', t.last_message_at,
      'sla_due_at', t.sla_due_at,
      'overdue', (t.sla_due_at is not null and t.sla_due_at < now()
                  and t.status_code not in ('resolved', 'closed')),
      'assigned_to', t.assigned_to,
      'assignee_name', (select p.display_name from public.profiles p where p.id = t.assigned_to),
      'user_name', (select p.display_name from public.profiles p where p.id = t.user_id),
      'user_id', t.user_id
    ) as item
    from public.support_tickets t
    where (p_status is null or t.status_code = p_status)
      and (p_category is null or t.category_code = p_category)
      and (
        p_search is null or trim(p_search) = ''
        or t.ticket_no ilike '%' || trim(p_search) || '%'
        or t.subject ilike '%' || trim(p_search) || '%'
        or exists (
          select 1 from public.profiles p
          where p.id = t.user_id
            and (p.username ilike '%' || trim(p_search) || '%'
                 or p.display_name ilike '%' || trim(p_search) || '%')
        )
      )
      and (
        p_assigned is null or p_assigned = 'all'
        or (p_assigned = 'me' and t.assigned_to = auth.uid())
        or (p_assigned = 'unassigned' and t.assigned_to is null)
      )
    order by
      case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
      t.created_at desc
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end
$$;

create or replace function public.safety_admin_reply_ticket(
  p_ticket_id uuid,
  p_body text,
  p_is_internal boolean default false,
  p_attachments jsonb default '[]'::jsonb,
  p_next_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_ticket public.support_tickets%rowtype;
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_status text;
  v_message_id uuid;
begin
  perform public.require_permission('support.reply');

  if char_length(trim(coalesce(p_body, ''))) < 1 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;

  if jsonb_typeof(v_attachments) <> 'array' or jsonb_array_length(v_attachments) > 3 then
    raise exception 'invalid_attachments' using errcode = '22023';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if not found then
    raise exception 'ticket_not_found' using errcode = '22023';
  end if;

  v_status := coalesce(
    p_next_status,
    case when p_is_internal then v_ticket.status_code
         else 'awaiting_user' end
  );

  if v_status not in ('received', 'under_review', 'awaiting_user', 'info_required',
                      'priority_review', 'resolved', 'closed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  insert into public.support_ticket_messages (
    ticket_id, author_id, author_role, body, attachments, is_internal
  )
  values (
    p_ticket_id, v_uid, 'agent', left(trim(p_body), 4000), v_attachments, coalesce(p_is_internal, false)
  )
  returning id into v_message_id;

  update public.support_tickets
     set status_code = v_status,
         last_message_at = now(),
         last_staff_message_at = case when p_is_internal then last_staff_message_at else now() end,
         first_response_at = coalesce(first_response_at, case when p_is_internal then null else now() end),
         assigned_to = coalesce(assigned_to, v_uid)
   where id = p_ticket_id;

  insert into public.support_ticket_messages (ticket_id, author_id, author_role, body)
  select p_ticket_id, v_uid, 'system',
         'Durum güncellendi: ' || v_status
  where not p_is_internal and v_status <> v_ticket.status_code;

  perform public.safety_audit(
    'support.reply', 'Destek talebine yanıt gönderildi', 'support_ticket', p_ticket_id::text,
    jsonb_build_object('internal', coalesce(p_is_internal, false), 'status', v_status)
  );

  if not p_is_internal and v_ticket.user_id is not null then
    perform public.safety_notify(
      v_ticket.user_id, 'support_reply', 'Destek ekibi yanıt verdi',
      'Destek talebinize yeni bir yanıt geldi.', 'support_ticket', p_ticket_id::text
    );
    perform public.safety_log_activity(v_ticket.user_id, 'support.ticket_replied', '{}'::jsonb, 'admin');
  end if;

  return jsonb_build_object('message_id', v_message_id, 'status_code', v_status);
end
$$;

create or replace function public.safety_admin_update_ticket(
  p_ticket_id uuid,
  p_status text default null,
  p_priority text default null,
  p_assign_to uuid default null,
  p_assign_self boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_ticket public.support_tickets%rowtype;
begin
  perform public.require_permission('support.manage');

  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if not found then
    raise exception 'ticket_not_found' using errcode = '22023';
  end if;

  if p_status is not null and p_status not in ('received', 'under_review', 'awaiting_user',
      'info_required', 'priority_review', 'resolved', 'closed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  if p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;

  update public.support_tickets
     set status_code = coalesce(p_status, status_code),
         priority = coalesce(p_priority, priority),
         assigned_to = case
           when p_assign_self then v_uid
           when p_assign_to is not null then p_assign_to
           else assigned_to
         end,
         sla_due_at = case
           when p_status in ('resolved', 'closed') then sla_due_at
           when p_priority = 'urgent' or priority = 'urgent' then least(coalesce(sla_due_at, now()), now() + interval '1 hour')
           else sla_due_at
         end
   where id = p_ticket_id;

  perform public.safety_audit(
    'support.status_changed', 'Destek talebi güncellendi', 'support_ticket', p_ticket_id::text,
    jsonb_build_object(
      'status', coalesce(p_status, v_ticket.status_code),
      'priority', coalesce(p_priority, v_ticket.priority)
    )
  );

  if p_status is not null and p_status <> v_ticket.status_code and v_ticket.user_id is not null then
    perform public.safety_notify(
      v_ticket.user_id,
      'support_status',
      case p_status
        when 'info_required' then 'Ek bilgi gerekli'
        when 'resolved' then 'Destek talebiniz çözüldü'
        when 'closed' then 'Destek talebiniz kapatıldı'
        else 'Destek talebiniz güncellendi'
      end,
      'Başvurunuzun durumu: ' || p_status,
      'support_ticket', p_ticket_id::text
    );
  end if;

  return jsonb_build_object('id', p_ticket_id);
end
$$;

-- -----------------------------------------------------------------------------
-- Yetkili islemleri: bildirim moderasyonu
-- -----------------------------------------------------------------------------
create or replace function public.safety_admin_list_reports(
  p_queue text default 'all',
  p_target_type text default null,
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
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_items jsonb;
  v_total bigint;
  v_where text := 'true';
begin
  perform public.require_permission('safety.report.view');

  if p_queue = 'child' then
    if not public.has_permission('safety.child.view') then
      raise exception 'insufficient_privilege' using errcode = '42501';
    end if;
    v_where := 'r.is_child_safety';
  elsif p_queue = 'critical' then
    v_where := 'r.priority = ''critical'' and r.status_code in (''received'', ''under_review'')';
  elsif p_queue = 'unassigned' then
    v_where := 'r.assigned_to is null and r.status_code in (''received'', ''under_review'')';
  elsif p_queue = 'resolved' then
    v_where := 'r.status_code in (''resolved'', ''action_taken'', ''dismissed'', ''closed'')';
  elsif p_queue = 'new' then
    v_where := 'r.status_code = ''received''';
  end if;

  execute format('
    select count(*) from public.user_reports r where %s
      and (%L is null or r.target_type = %L)', v_where, p_target_type, p_target_type)
  into v_total;

  execute format('
    select coalesce(jsonb_agg(item order by item ->> ''created_at'' desc), ''[]''::jsonb)
    from (
      select jsonb_build_object(
        ''id'', r.id,
        ''report_no'', r.report_no,
        ''target_type'', r.target_type,
        ''target_id'', r.target_id,
        ''reason_code'', r.reason_category,
        ''child_reason_code'', r.child_reason_code,
        ''is_child_safety'', r.is_child_safety,
        ''priority'', r.priority,
        ''status_code'', r.status_code,
        ''created_at'', r.created_at,
        ''sla_due_at'', r.sla_due_at,
        ''overdue'', (r.sla_due_at is not null and r.sla_due_at < now()
                      and r.status_code in (''received'', ''under_review'')),
        ''assigned_to'', r.assigned_to,
        ''assignee_name'', (select p.display_name from public.profiles p where p.id = r.assigned_to),
        ''reporter_ref'', left(r.reporter_id::text, 8)
      ) as item
      from public.user_reports r
      where %s and (%L is null or r.target_type = %L)
      order by
        case r.priority when ''critical'' then 0 when ''high'' then 1 else 2 end,
        r.created_at desc
      limit %s offset %s
    ) s', v_where, p_target_type, p_target_type, v_limit, v_offset)
  into v_items;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end
$$;

create or replace function public.safety_admin_get_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.user_reports%rowtype;
  v_actions jsonb;
  v_can_child boolean := public.has_permission('safety.child.view');
begin
  perform public.require_permission('safety.report.view');

  select * into v_report from public.user_reports where id = p_report_id;
  if not found then
    raise exception 'report_not_found' using errcode = '22023';
  end if;

  if v_report.is_child_safety and not v_can_child then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'action_code', a.action_code,
    'note_internal', a.note_internal,
    'note_public', a.note_public,
    'created_at', a.created_at,
    'actor_role', a.actor_role
  ) order by a.created_at desc), '[]'::jsonb)
  into v_actions
  from public.report_actions a
  where a.report_id = p_report_id;

  return jsonb_build_object(
    'id', v_report.id,
    'report_no', v_report.report_no,
    'target_type', v_report.target_type,
    'target_id', v_report.target_id,
    'target_owner_id', v_report.target_owner_id,
    'reason_code', v_report.reason_category,
    'child_reason_code', v_report.child_reason_code,
    'is_child_safety', v_report.is_child_safety,
    'priority', v_report.priority,
    'status_code', v_report.status_code,
    'description', v_report.description,
    'target_snapshot', v_report.target_snapshot,
    'metadata_safe', v_report.metadata_safe,
    'created_at', v_report.created_at,
    'reviewed_at', v_report.reviewed_at,
    'closed_at', v_report.closed_at,
    'sla_due_at', v_report.sla_due_at,
    'assigned_to', v_report.assigned_to,
    'resolution_code', v_report.resolution_code,
    'resolution_note_public', v_report.resolution_note_public,
    -- Bildiren kisinin kimligi yalnizca yetkili personele doner.
    'reporter_id', case when public.has_permission('safety.report.action') then v_report.reporter_id else null end,
    'actions', v_actions
  );
end
$$;

create or replace function public.safety_admin_report_action(
  p_report_id uuid,
  p_action text,
  p_note_internal text default null,
  p_note_public text default null,
  p_content_action text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_report public.user_reports%rowtype;
  v_status text;
  v_resolution text;
  v_audit_action text;
begin
  perform public.require_permission('safety.report.action');

  select * into v_report from public.user_reports where id = p_report_id;
  if not found then
    raise exception 'report_not_found' using errcode = '22023';
  end if;

  if v_report.is_child_safety and not public.has_permission('safety.child.action') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  case p_action
    when 'start_review' then
      v_status := 'under_review';
      v_resolution := null;
      v_audit_action := 'report.review_started';
    when 'apply_action' then
      v_status := 'action_taken';
      v_resolution := coalesce(p_content_action, 'content_action');
      v_audit_action := 'report.action_taken';
    when 'resolve' then
      v_status := 'resolved';
      v_resolution := coalesce(p_content_action, 'resolved');
      v_audit_action := 'report.resolved';
    when 'dismiss' then
      v_status := 'dismissed';
      v_resolution := coalesce(p_content_action, 'no_violation');
      v_audit_action := 'report.dismissed';
    when 'close' then
      v_status := 'closed';
      v_resolution := coalesce(p_content_action, v_report.resolution_code);
      v_audit_action := 'report.closed';
    else
      raise exception 'invalid_action' using errcode = '22023';
  end case;

  update public.user_reports
     set status_code = v_status,
         resolution_code = v_resolution,
         resolution_note_public = left(coalesce(nullif(trim(p_note_public), ''), resolution_note_public), 500),
         reviewed_at = coalesce(reviewed_at, now()),
         assigned_to = coalesce(assigned_to, v_uid),
         updated_by = v_uid
   where id = p_report_id;

  insert into public.report_actions (
    report_id, actor_id, actor_role, action_code, note_internal, note_public
  )
  values (
    p_report_id, v_uid, 'moderator', v_audit_action,
    left(nullif(trim(p_note_internal), ''), 2000),
    left(nullif(trim(p_note_public), ''), 500)
  );

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
  values (
    v_uid, v_audit_action, 'user_report', p_report_id::text,
    jsonb_build_object('status', v_status, 'resolution', v_resolution,
                       'child_safety', v_report.is_child_safety)
  );

  perform public.safety_audit(
    v_audit_action,
    'Bildirim incelendi: ' || v_status,
    'user_report', p_report_id::text,
    jsonb_build_object('status', v_status, 'resolution', v_resolution)
  );

  if p_content_action is not null then
    insert into public.moderation_actions (admin_id, target_type, target_id, action, reason_code)
    values (v_uid, v_report.target_type, v_report.target_id, left(p_content_action, 64), v_report.reason_category);
  end if;

  if v_report.reporter_id is not null and v_status in ('action_taken', 'resolved', 'dismissed') then
    perform public.safety_notify(
      v_report.reporter_id, 'report_status', 'Bildirim durumu güncellendi',
      case v_status
        when 'action_taken' then 'Bildiriminiz incelendi ve gerekli işlem uygulandı.'
        when 'resolved' then 'Bildiriminiz sonuçlandırıldı.'
        else 'Bildiriminiz incelendi; ihlal tespit edilmedi.'
      end,
      'report', p_report_id::text
    );
    perform public.safety_log_activity(v_report.reporter_id, 'report.status_changed', '{}'::jsonb, 'admin');
  end if;

  return jsonb_build_object('id', p_report_id, 'status_code', v_status);
end
$$;

create or replace function public.safety_admin_assign_report(
  p_report_id uuid,
  p_assign_self boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
begin
  perform public.require_permission('safety.report.action');

  update public.user_reports
     set assigned_to = case when p_assign_self then v_uid else assigned_to end
   where id = p_report_id;

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id)
  values (v_uid, 'report.assigned', 'user_report', p_report_id::text);

  return jsonb_build_object('id', p_report_id);
end
$$;

-- -----------------------------------------------------------------------------
-- Yetkili islemleri: cocuk guvenligi kuyrugu
-- -----------------------------------------------------------------------------
create or replace function public.safety_admin_child_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_incidents jsonb;
  v_reports jsonb;
begin
  perform public.require_permission('safety.child.view');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'case_ref', i.case_ref,
    'severity', i.severity,
    'category', i.category,
    'status', i.status,
    'assigned_admin_id', i.assigned_admin_id,
    'created_at', i.created_at,
    'report_id', i.metadata_safe ->> 'report_id'
  ) order by
    case i.severity when 'critical' then 0 else 1 end,
    i.created_at desc), '[]'::jsonb)
  into v_incidents
  from public.child_safety_incidents i
  where i.status in ('open', 'investigating');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'report_no', r.report_no,
    'child_reason_code', r.child_reason_code,
    'priority', r.priority,
    'status_code', r.status_code,
    'created_at', r.created_at,
    'sla_due_at', r.sla_due_at,
    'assigned_to', r.assigned_to
  ) order by
    case r.priority when 'critical' then 0 else 1 end,
    r.created_at desc), '[]'::jsonb)
  into v_reports
  from public.user_reports r
  where r.is_child_safety
    and r.status_code in ('received', 'under_review');

  return jsonb_build_object(
    'incidents', v_incidents,
    'reports', v_reports,
    'critical_count', (
      select count(*) from public.user_reports
      where is_child_safety and priority = 'critical'
        and status_code in ('received', 'under_review')
    )
  );
end
$$;

create or replace function public.safety_admin_assign_child_case(
  p_case_id uuid,
  p_assign_self boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
begin
  perform public.require_permission('safety.child.action');

  update public.child_safety_incidents
     set assigned_admin_id = case when p_assign_self then v_uid else assigned_admin_id end,
         status = case when status = 'open' then 'investigating' else status end
   where id = p_case_id;

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id)
  values (v_uid, 'child_case.assigned', 'child_safety_incident', p_case_id::text);

  return jsonb_build_object('id', p_case_id);
end
$$;

create or replace function public.safety_admin_resolve_child_case(
  p_case_id uuid,
  p_status text,
  p_note_internal text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_case public.child_safety_incidents%rowtype;
begin
  perform public.require_permission('safety.child.action');

  if p_status not in ('investigating', 'resolved', 'closed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_case from public.child_safety_incidents where id = p_case_id;
  if not found then
    raise exception 'case_not_found' using errcode = '22023';
  end if;

  update public.child_safety_incidents
     set status = p_status,
         resolved_at = case when p_status in ('resolved', 'closed') then now() else resolved_at end,
         assigned_admin_id = coalesce(assigned_admin_id, v_uid),
         metadata_safe = metadata_safe || jsonb_build_object(
           'last_note', left(coalesce(p_note_internal, ''), 500),
           'last_actor', v_uid::text
         )
   where id = p_case_id;

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
  values (
    v_uid, 'child_case.' || p_status, 'child_safety_incident', p_case_id::text,
    jsonb_build_object('note_recorded', p_note_internal is not null)
  );

  perform public.safety_audit(
    'child_case.' || p_status, 'Çocuk güvenliği olayı güncellendi',
    'child_safety_incident', p_case_id::text,
    jsonb_build_object('status', p_status)
  );

  return jsonb_build_object('id', p_case_id, 'status', p_status);
end
$$;

create or replace function public.safety_admin_audit_logs(
  p_entity_type text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_items jsonb;
begin
  perform public.require_permission('audit.view');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'action_code', l.action_code,
    'entity_type', l.entity_type,
    'entity_id', l.entity_id,
    'created_at', l.created_at,
    'actor_name', (select p.display_name from public.profiles p where p.id = l.actor_id)
  ) order by l.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select * from public.moderation_audit_logs
    where (p_entity_type is null or entity_type = p_entity_type)
    order by created_at desc
    limit v_limit
  ) l;

  return jsonb_build_object('items', v_items);
end
$$;

-- -----------------------------------------------------------------------------
-- SSS yonetimi
-- -----------------------------------------------------------------------------
create or replace function public.safety_admin_upsert_faq(
  p_id uuid,
  p_category text,
  p_question text,
  p_answer text,
  p_sort_order integer default 100,
  p_is_published boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_id uuid := p_id;
begin
  perform public.require_permission('safety.faq.manage');

  if char_length(trim(coalesce(p_question, ''))) < 5 then
    raise exception 'invalid_question' using errcode = '22023';
  end if;

  if char_length(trim(coalesce(p_answer, ''))) < 10 then
    raise exception 'invalid_answer' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.safety_faqs (category, question, answer, sort_order, is_published, updated_by)
    values (left(trim(p_category), 32), left(trim(p_question), 200), left(trim(p_answer), 4000),
            coalesce(p_sort_order, 100), coalesce(p_is_published, true), v_uid)
    returning id into v_id;
  else
    update public.safety_faqs
       set category = left(trim(p_category), 32),
           question = left(trim(p_question), 200),
           answer = left(trim(p_answer), 4000),
           sort_order = coalesce(p_sort_order, sort_order),
           is_published = coalesce(p_is_published, is_published),
           updated_by = v_uid,
           updated_at = now()
     where id = v_id;
  end if;

  perform public.safety_audit(
    'safety.faq_saved', 'Destek SSS içeriği kaydedildi', 'safety_faq', v_id::text
  );

  return jsonb_build_object('id', v_id);
end
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.report_reason_catalog enable row level security;
alter table public.report_actions enable row level security;
alter table public.moderation_audit_logs enable row level security;
alter table public.safety_notifications enable row level security;
alter table public.safety_rate_limits enable row level security;
alter table public.safety_faqs enable row level security;
alter table public.safety_policy_versions enable row level security;

drop policy if exists safety_notifications_select_own on public.safety_notifications;
create policy safety_notifications_select_own on public.safety_notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists safety_faqs_select_published on public.safety_faqs;
create policy safety_faqs_select_published on public.safety_faqs
  for select to authenticated using (is_published);

drop policy if exists safety_policies_select_published on public.safety_policy_versions;
create policy safety_policies_select_published on public.safety_policy_versions
  for select to authenticated using (is_published);

drop policy if exists report_actions_select_own on public.report_actions;
create policy report_actions_select_own on public.report_actions
  for select to authenticated using (
    exists (
      select 1 from public.user_reports r
      where r.id = report_id and r.reporter_id = auth.uid()
    )
    and note_internal is null
  );

-- Destek: sahibi ve yetkili personel gorebilir.
drop policy if exists support_tickets_select_own on public.support_tickets;
drop policy if exists support_tickets_select_scoped on public.support_tickets;
create policy support_tickets_select_scoped on public.support_tickets
  for select to authenticated using (
    user_id = auth.uid() or public.has_permission('support.view')
  );

drop policy if exists support_ticket_messages_select_own on public.support_ticket_messages;
drop policy if exists support_ticket_messages_select_scoped on public.support_ticket_messages;
create policy support_ticket_messages_select_scoped on public.support_ticket_messages
  for select to authenticated using (
    (
      exists (
        select 1 from public.support_tickets t
        where t.id = ticket_id and t.user_id = auth.uid()
      )
      and not is_internal
    )
    or public.has_permission('support.view')
  );

drop policy if exists user_reports_select_own on public.user_reports;
drop policy if exists user_reports_select_scoped on public.user_reports;
create policy user_reports_select_scoped on public.user_reports
  for select to authenticated using (
    reporter_id = auth.uid()
    or (
      public.has_permission('safety.report.view')
      and (not is_child_safety or public.has_permission('safety.child.view'))
    )
  );

drop policy if exists child_safety_incidents_select_scoped on public.child_safety_incidents;
create policy child_safety_incidents_select_scoped on public.child_safety_incidents
  for select to authenticated using (public.has_permission('safety.child.view'));

-- -----------------------------------------------------------------------------
-- Yetkiler: yazma yalnizca RPC uzerinden
-- -----------------------------------------------------------------------------
revoke all on public.report_reason_catalog from anon, authenticated;
grant select on public.report_reason_catalog to authenticated;

revoke all on public.report_actions from anon, authenticated;
grant select on public.report_actions to authenticated;

revoke all on public.moderation_audit_logs from anon, authenticated;
revoke all on public.safety_rate_limits from anon, authenticated;

revoke all on public.safety_notifications from anon, authenticated;
grant select on public.safety_notifications to authenticated;

revoke all on public.safety_faqs from anon, authenticated;
grant select on public.safety_faqs to authenticated;

revoke all on public.safety_policy_versions from anon, authenticated;
grant select on public.safety_policy_versions to authenticated;

revoke all on public.support_tickets from anon, authenticated;
grant select on public.support_tickets to authenticated;

revoke all on public.support_ticket_messages from anon, authenticated;
grant select on public.support_ticket_messages to authenticated;

revoke all on public.user_reports from anon, authenticated;
grant select on public.user_reports to authenticated;

revoke all on public.child_safety_incidents from anon, authenticated;
grant select on public.child_safety_incidents to authenticated;

-- Fonksiyon yetkileri
revoke all on function public.safety_require_auth() from public, anon, authenticated;
revoke all on function public.safety_check_rate(text, integer, interval) from public, anon, authenticated;
revoke all on function public.safety_notify(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.safety_log_activity(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.safety_audit(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.tz_support_ticket_status_sync() from public, anon, authenticated;
revoke all on function public.tz_user_report_status_sync() from public, anon, authenticated;

revoke all on function public.safety_create_support_ticket(text, text, text, jsonb, text, text) from public, anon;
revoke all on function public.safety_list_my_tickets() from public, anon;
revoke all on function public.safety_get_ticket(uuid) from public, anon;
revoke all on function public.safety_send_support_message(uuid, text, jsonb) from public, anon;
revoke all on function public.safety_set_ticket_status(uuid, text) from public, anon;
revoke all on function public.safety_create_report(text, text, text, text, text, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.safety_list_my_reports() from public, anon;
revoke all on function public.safety_get_my_report(uuid) from public, anon;
revoke all on function public.safety_list_my_notifications() from public, anon;
revoke all on function public.safety_mark_notifications_read() from public, anon;
revoke all on function public.safety_list_faqs() from public, anon;
revoke all on function public.safety_get_policy(text) from public, anon;
revoke all on function public.safety_staff_me() from public, anon;

revoke all on function public.safety_admin_list_tickets(text, text, text, text, integer, integer) from public, anon;
revoke all on function public.safety_admin_reply_ticket(uuid, text, boolean, jsonb, text) from public, anon;
revoke all on function public.safety_admin_update_ticket(uuid, text, text, uuid, boolean) from public, anon;
revoke all on function public.safety_admin_list_reports(text, text, integer, integer) from public, anon;
revoke all on function public.safety_admin_get_report(uuid) from public, anon;
revoke all on function public.safety_admin_report_action(uuid, text, text, text, text) from public, anon;
revoke all on function public.safety_admin_assign_report(uuid, boolean) from public, anon;
revoke all on function public.safety_admin_child_queue() from public, anon;
revoke all on function public.safety_admin_assign_child_case(uuid, boolean) from public, anon;
revoke all on function public.safety_admin_resolve_child_case(uuid, text, text) from public, anon;
revoke all on function public.safety_admin_audit_logs(text, integer) from public, anon;
revoke all on function public.safety_admin_upsert_faq(uuid, text, text, text, integer, boolean) from public, anon;

grant execute on function public.safety_create_support_ticket(text, text, text, jsonb, text, text) to authenticated;
grant execute on function public.safety_list_my_tickets() to authenticated;
grant execute on function public.safety_get_ticket(uuid) to authenticated;
grant execute on function public.safety_send_support_message(uuid, text, jsonb) to authenticated;
grant execute on function public.safety_set_ticket_status(uuid, text) to authenticated;
grant execute on function public.safety_create_report(text, text, text, text, text, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.safety_list_my_reports() to authenticated;
grant execute on function public.safety_get_my_report(uuid) to authenticated;
grant execute on function public.safety_list_my_notifications() to authenticated;
grant execute on function public.safety_mark_notifications_read() to authenticated;
grant execute on function public.safety_list_faqs() to authenticated;
grant execute on function public.safety_get_policy(text) to authenticated;
grant execute on function public.safety_staff_me() to authenticated;

grant execute on function public.safety_admin_list_tickets(text, text, text, text, integer, integer) to authenticated;
grant execute on function public.safety_admin_reply_ticket(uuid, text, boolean, jsonb, text) to authenticated;
grant execute on function public.safety_admin_update_ticket(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.safety_admin_list_reports(text, text, integer, integer) to authenticated;
grant execute on function public.safety_admin_get_report(uuid) to authenticated;
grant execute on function public.safety_admin_report_action(uuid, text, text, text, text) to authenticated;
grant execute on function public.safety_admin_assign_report(uuid, boolean) to authenticated;
grant execute on function public.safety_admin_child_queue() to authenticated;
grant execute on function public.safety_admin_assign_child_case(uuid, boolean) to authenticated;
grant execute on function public.safety_admin_resolve_child_case(uuid, text, text) to authenticated;
grant execute on function public.safety_admin_audit_logs(text, integer) to authenticated;
grant execute on function public.safety_admin_upsert_faq(uuid, text, text, text, integer, boolean) to authenticated;

-- service_role: sunucu bilesenleri
grant execute on function public.safety_notify(uuid, text, text, text, text, text) to service_role;
grant execute on function public.safety_require_auth() to service_role;
grant execute on function public.safety_check_rate(text, integer, interval) to service_role;
grant select, insert on public.moderation_audit_logs to service_role;
grant usage, select on sequence public.moderation_audit_logs_id_seq to service_role;
grant select on public.report_reason_catalog to service_role;

-- -----------------------------------------------------------------------------
-- Baslangic SSS icerigi (yonetici panelinden duzenlenebilir)
-- -----------------------------------------------------------------------------
insert into public.safety_faqs (category, question, answer, sort_order) values
  ('account_access', 'Hesabıma giriş yapamıyorum, ne yapmalıyım?',
   'Şifrenizi sıfırlamayı deneyin. Sorun devam ederse Destek Merkezi üzerinden "Hesap ve giriş sorunları" kategorisinde bir talep oluşturun; hesabınıza bağlı e-posta adresini belirtmeniz yeterlidir.', 10),
  ('account_access', 'Şifremi nasıl değiştirebilirim?',
   'Ayarlar bölümündeki güvenlik sayfasından şifrenizi değiştirebilirsiniz. Şifrenizi kimseyle paylaşmayın; Trabzone destek ekibi sizden asla şifre istemez.', 20),
  ('security_privacy', 'Hesabımı nasıl gizli yapabilirim?',
   'Ayarlar > Gizlilik bölümünden profil görünürlüğünü "Gizli" olarak değiştirebilirsiniz. Gizli profillerde paylaşımlarınızı yalnızca onayladığınız takipçiler görür.', 30),
  ('security_privacy', 'Birini nasıl engellerim?',
   'Kullanıcının profilindeki üç nokta menüsünden "Engelle" seçeneğini kullanabilirsiniz. Engellenen kullanıcı size mesaj gönderemez ve sizi takip edemez.', 40),
  ('content', 'Bir gönderiyi veya Reels videosunu nasıl bildiririm?',
   'İçeriğin üç nokta menüsünden "Bildir" seçeneğine dokunun, nedeni seçin ve gönderin. Bildiriminiz kayıt altına alınır; durumunu Başvurularım bölümünden takip edebilirsiniz.', 50),
  ('content', 'Bildirimim ne kadar sürede incelenir?',
   'Normal bildirimler için 24 saat içinde inceleme hedeflenir. Bu bir hizmet hedefidir, kesin sonuç süresi değildir. Çocuk güvenliği bildirimleri öncelikli kuyrukta değerlendirilir.', 60),
  ('messaging_calls', 'Tanımadığım kişilerden mesaj almayı nasıl kapatırım?',
   'Ayarlar > Gizlilik > Mesajlaşma bölümünden kimlerin mesaj gönderebileceğini "Arkadaşlar" veya "Kimse" olarak sınırlandırabilirsiniz.', 70),
  ('payments', 'Satın alma işlemim gerçekleşmedi, ne yapmalıyım?',
   'Ödeme ve sipariş sorunları kategorisinde talep oluşturun. İşlem tarihi, tutar ve varsa sipariş numarasını eklemeniz incelemeyi hızlandırır. Kart bilgilerinizi paylaşmayın.', 80),
  ('child_safety', 'Çocuk güvenliğiyle ilgili bir durumu nasıl bildiririm?',
   'Bildir menüsünde "Çocuk güvenliği ve istismarı" seçeneğini seçin ve uygun alt nedeni işaretleyin. Bu bildirimler öncelikli inceleme kuyruğuna alınır. Acil tehlike varsa önce yerel acil yardım birimlerine başvurun.', 90),
  ('child_safety', 'Çocuk Korumalı Hesap nedir?',
   '18 yaş altındaki hesaplarda gizlilik, mesajlaşma, arama ve içerik erişimi için ek korumalar uygulanır. Bu korumalar sunucu tarafında zorunlu tutulur ve arayüzden kapatılamaz.', 100),
  ('notifications', 'Bildirimlerim gelmiyor, ne yapabilirim?',
   'Cihaz ayarlarınızdan Trabzone bildirimlerine izin verildiğinden emin olun, ardından uygulama içi bildirim tercihlerinizi kontrol edin.', 110)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Cocuk guvenligi politika surumu (uygulama icinde yayinlanmis surum)
-- -----------------------------------------------------------------------------
insert into public.safety_policy_versions (slug, version, title, summary, body_md, is_published, effective_at, published_at)
values (
  'child-safety',
  1,
  'Trabzone Çocuk Güvenliği Politikası',
  'Trabzone, çocukların cinsel istismarı ve sömürüsüne karşı sıfır tolerans uygular.',
  E'# Trabzone Çocuk Güvenliği Politikası\n\n## 1. Sıfır tolerans\nTrabzone, çocukların cinsel istismarı ve sömürüsüne (CSAM), çocuk ticaretine ve çocuklara yönelik her türlü tehdide karşı sıfır tolerans uygular. Bu tür içerik ve davranışlar platformda yasaktır.\n\n## 2. Yasaklanan davranışlar\n- Çocuğa uygunsuz yaklaşım, kandırma veya grooming.\n- Çocuğa yönelik cinsel şantaj veya tehdit.\n- Çocuğun özel bilgilerinin tehlikeli biçimde paylaşılması.\n- Çocuğu kendine zarar vermeye veya tehlikeli davranışlara teşvik.\n- Çocuklara yönelik zorbalık, taciz ve ayrımcılık.\n\n## 3. Bildirme\nHer kullanıcı; gönderi, Reels, yorum, profil ve mesajlardaki uygunsuz içerikleri üç nokta menüsünden **Bildir** seçeneğiyle bildirebilir. Çocuk güvenliği bildirimleri ayrı alt nedenlerle kayıt altına alınır ve öncelikli kuyruğa alınır.\n\nÇocuk istismarı görüntülerini yeniden yüklemeyin, indirmeyin veya paylaşmayın. Böyle bir içerikle karşılaştığınızda yalnızca bildirin.\n\n## 4. İnceleme\nBildirimler yetkili moderasyon ekibi tarafından incelenir. Öncelik seviyeleri kritik ve yüksek olarak belirlenir. Otomatik risk sınıflandırması tek başına kesin ihlal kararı sayılmaz; her karar yetkili personel tarafından kayıt altına alınır.\n\n## 5. Moderasyon önlemleri\nİhlal tespit edildiğinde içerik kaldırılabilir, görünürlüğü kısıtlanabilir, hesap sınırlandırılabilir veya askıya alınabilir. İşlemler denetim kaydına yazılır.\n\n## 6. Yetkili makamlara bildirim\nYasa gereği gerekli durumlarda ilgili yasal bildirim süreçleri işletilir ve yetkili makamlarla iş birliği yapılır.\n\n## 7. Acil tehlike\nBir çocuğun acil tehlikede olduğunu düşünüyorsanız önce yerel acil yardım veya kolluk birimlerine başvurun. Uygulama içi bildirim, acil müdahale yerine geçmez.\n\n## 8. Gizlilik\nBildiren kişinin kimliği bildirilen kullanıcıya açıklanmaz. Çocuklara ait kişisel veriler yalnızca gerekli olduğu ölçüde ve yetkili personel tarafından işlenir.\n\n## 9. İletişim\nÇocuk güvenliği konularında support@litxtech.com adresinden bize ulaşabilirsiniz.',
  true,
  now(),
  now()
)
on conflict (slug, version) do update set
  title = excluded.title,
  summary = excluded.summary,
  body_md = excluded.body_md,
  is_published = excluded.is_published;

-- -----------------------------------------------------------------------------
-- Ek dosya kovalari (ozel, imzali erisim)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('safety-support', 'safety-support', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('safety-reports', 'safety-reports', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
