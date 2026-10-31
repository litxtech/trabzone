-- =====================================================================
-- 0222 — Otel şikayet ve destek yönetimi
--
-- * Misafir şikayetleri / destek talepleri (acc_complaints)
-- * Talep içi yazışma (acc_complaint_messages) ve iç notlar
-- * Durum, atama, SLA, eskalasyon ve memnuniyet akışı
-- * Misafir tarafı: konaklama üzerinden sorun bildirme ve yanıt takibi
-- * Otel paneli: şikayet kuyruğu, geciken SLA, atama ve çözüm kaydı
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Bildirim türü
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'follow', 'like', 'comment', 'message', 'group_invite', 'order',
  'market_message', 'support', 'security', 'system', 'mention',
  'ride', 'news', 'live_news', 'live_news_verified', 'live_news_moderation',
  'pharmacy', 'earthquake', 'sports',
  'accommodation_reservation', 'accommodation_message', 'accommodation_review',
  'accommodation_property', 'accommodation_staff', 'accommodation_complaint'
));

-- ---------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------
create sequence if not exists public.acc_complaint_ref_seq start with 1001;

create table if not exists public.acc_complaints (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique
    default ('SK-' || lpad(nextval('public.acc_complaint_ref_seq')::text, 5, '0')),
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  reservation_id uuid references public.acc_reservations(id) on delete set null,
  guest_id uuid references public.acc_guests(id) on delete set null,
  guest_user_id uuid references public.profiles(id) on delete set null,

  guest_name text not null default 'Misafir' check (length(btrim(guest_name)) between 1 and 120),
  guest_phone text,
  guest_email text,
  room_number text,

  category text not null default 'other' check (category in (
    'cleanliness', 'noise', 'staff', 'maintenance', 'billing',
    'food', 'safety', 'check_in', 'amenity', 'other'
  )),
  channel text not null default 'front_desk' check (channel in (
    'front_desk', 'phone', 'email', 'whatsapp', 'guest_app', 'review', 'other'
  )),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in (
    'open', 'in_progress', 'waiting_guest', 'escalated', 'resolved', 'closed'
  )),

  subject text not null check (length(btrim(subject)) between 3 and 160),
  description text not null check (length(btrim(description)) between 1 and 4000),
  resolution text,
  internal_note text,

  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,

  compensation_cents bigint not null default 0 check (compensation_cents >= 0),
  currency text not null default 'TRY',

  satisfaction int check (satisfaction is null or satisfaction between 1 and 5),
  satisfaction_comment text,

  first_response_at timestamptz,
  due_at timestamptz not null default (now() + interval '24 hours'),
  follow_up_at timestamptz,
  escalated_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acc_complaints_property_idx
  on public.acc_complaints (property_id, status, last_activity_at desc);
create index if not exists acc_complaints_sla_idx
  on public.acc_complaints (property_id, due_at)
  where status in ('open', 'in_progress', 'waiting_guest', 'escalated');
create index if not exists acc_complaints_guest_idx
  on public.acc_complaints (guest_user_id, created_at desc);
create index if not exists acc_complaints_reservation_idx
  on public.acc_complaints (reservation_id);
create index if not exists acc_complaints_assignee_idx
  on public.acc_complaints (assigned_to, status);

drop trigger if exists acc_complaints_updated_at on public.acc_complaints;
create trigger acc_complaints_updated_at
  before update on public.acc_complaints
  for each row execute function public.set_updated_at();

create table if not exists public.acc_complaint_messages (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.acc_complaints(id) on delete cascade,
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_role text not null check (author_role in ('guest', 'staff', 'system')),
  body text not null check (length(btrim(body)) between 1 and 4000),
  internal boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists acc_complaint_messages_idx
  on public.acc_complaint_messages (complaint_id, created_at);

create table if not exists public.acc_complaint_events (
  id bigserial primary key,
  complaint_id uuid not null references public.acc_complaints(id) on delete cascade,
  property_id uuid not null references public.acc_properties(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists acc_complaint_events_idx
  on public.acc_complaint_events (complaint_id, created_at desc);

-- ---------------------------------------------------------------------
-- RLS — yazma yalnızca RPC üzerinden
-- ---------------------------------------------------------------------
alter table public.acc_complaints enable row level security;
drop policy if exists acc_complaints_read on public.acc_complaints;
create policy acc_complaints_read on public.acc_complaints
  for select to authenticated
  using (
    public.acc_can(property_id, 'complaints')
    or guest_user_id = auth.uid()
  );

alter table public.acc_complaint_messages enable row level security;
drop policy if exists acc_complaint_messages_read on public.acc_complaint_messages;
create policy acc_complaint_messages_read on public.acc_complaint_messages
  for select to authenticated
  using (exists (
    select 1 from public.acc_complaints c
    where c.id = complaint_id
      and (
        public.acc_can(c.property_id, 'complaints')
        or (c.guest_user_id = auth.uid() and not internal)
      )
  ));

alter table public.acc_complaint_events enable row level security;
drop policy if exists acc_complaint_events_read on public.acc_complaint_events;
create policy acc_complaint_events_read on public.acc_complaint_events
  for select to authenticated
  using (public.acc_can(property_id, 'complaints'));

grant select on
  public.acc_complaints,
  public.acc_complaint_messages,
  public.acc_complaint_events
to authenticated;

-- ---------------------------------------------------------------------
-- Yetki: personel varsayılanlarına "complaints" eklenir
-- ---------------------------------------------------------------------
create or replace function public.acc_can(p_property_id uuid, p_permission text default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.acc_staff_role(p_property_id);
  v_permissions text[];
begin
  if v_role is null then
    return false;
  end if;
  if v_role in ('owner', 'admin') then
    return true;
  end if;
  if p_permission is null or p_permission = 'read' then
    return true;
  end if;

  select s.permissions into v_permissions
  from public.acc_property_staff s
  where s.property_id = p_property_id
    and s.user_id = auth.uid()
    and s.status = 'active'
  limit 1;

  if coalesce(array_length(v_permissions, 1), 0) > 0 then
    return '*' = any(v_permissions) or p_permission = any(v_permissions);
  end if;

  return case v_role
    when 'manager' then p_permission not in ('property.delete', 'staff.owner')
    when 'front_desk' then p_permission in (
      'reservations', 'frontdesk', 'guests', 'housekeeping', 'messages', 'complaints',
      'cash.collect', 'calendar.view', 'reports.view'
    )
    when 'housekeeping' then p_permission in ('housekeeping', 'rooms.view')
    when 'accountant' then p_permission in (
      'finance', 'cash', 'documents', 'reports', 'commission', 'reports.view'
    )
    when 'viewer' then false
    else false
  end;
end;
$$;

grant execute on function public.acc_can(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------
create or replace function public.acc_complaint_sla_hours(p_priority text)
returns int
language sql
immutable
as $$
  select case p_priority
    when 'urgent' then 2
    when 'high' then 6
    when 'normal' then 24
    else 72
  end;
$$;

grant execute on function public.acc_complaint_sla_hours(text) to authenticated, service_role;

create or replace function public.acc_complaint_notify_staff(
  p_property_id uuid,
  p_actor_id uuid,
  p_title text,
  p_body text,
  p_entity_id text,
  p_route text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
  select distinct target.user_id, p_actor_id, 'accommodation_complaint',
         left(p_title, 160), left(p_body, 400), 'accommodation_complaint', p_entity_id, p_route
  from (
    select p.owner_id as user_id
    from public.acc_properties p
    where p.id = p_property_id and p.owner_id is not null
    union
    select s.user_id
    from public.acc_property_staff s
    where s.property_id = p_property_id
      and s.status = 'active'
      and (
        '*' = any(s.permissions)
        or 'complaints' = any(s.permissions)
        or (
          coalesce(array_length(s.permissions, 1), 0) = 0
          and s.role in ('owner', 'manager', 'front_desk')
        )
      )
  ) target
  where target.user_id is not null
    and target.user_id is distinct from p_actor_id;
end;
$$;

grant execute on function public.acc_complaint_notify_staff(uuid, uuid, text, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Otel paneli: atanabilir personel
-- ---------------------------------------------------------------------
create or replace function public.acc_complaint_assignees(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'complaints');
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', s.user_id,
    'name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username, 'Personel'),
    'username', pr.username,
    'role', s.role
  ) order by
    case s.role when 'owner' then 0 when 'manager' then 1 when 'front_desk' then 2 else 3 end,
    pr.username), '[]'::jsonb)
  into v_items
  from public.acc_property_staff s
  join public.profiles pr on pr.id = s.user_id
  where s.property_id = p_property_id and s.status = 'active';

  return jsonb_build_object('items', v_items);
end;
$$;

grant execute on function public.acc_complaint_assignees(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Otel paneli: şikayet listesi + özet metrikler
-- ---------------------------------------------------------------------
create or replace function public.acc_complaints_list(
  p_property_id uuid,
  p_status text default null,
  p_priority text default null,
  p_category text default null,
  p_query text default null,
  p_assigned_to uuid default null,
  p_limit int default 60,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'complaints');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit int := greatest(1, least(coalesce(p_limit, 60), 200));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_total bigint := 0;
  v_items jsonb;
  v_stats jsonb;
begin
  select count(*) into v_total
  from public.acc_complaints c
  where c.property_id = p_property_id
    and (
      p_status is null or p_status = 'all'
      or (p_status = 'active' and c.status in ('open', 'in_progress', 'waiting_guest', 'escalated'))
      or c.status = p_status
    )
    and (p_priority is null or p_priority = 'all' or c.priority = p_priority)
    and (p_category is null or p_category = 'all' or c.category = p_category)
    and (p_assigned_to is null or c.assigned_to = p_assigned_to)
    and (
      v_query is null
      or c.reference ilike '%' || v_query || '%'
      or c.subject ilike '%' || v_query || '%'
      or c.guest_name ilike '%' || v_query || '%'
      or coalesce(c.room_number, '') ilike '%' || v_query || '%'
      or coalesce(c.guest_phone, '') ilike '%' || v_query || '%'
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'reference', q.reference,
    'property_id', q.property_id,
    'reservation_id', q.reservation_id,
    'reservation_code', q.reservation_code,
    'guest_name', q.guest_name,
    'guest_phone', q.guest_phone,
    'guest_email', q.guest_email,
    'guest_user_id', q.guest_user_id,
    'room_number', q.room_number,
    'category', q.category,
    'channel', q.channel,
    'priority', q.priority,
    'status', q.status,
    'subject', q.subject,
    'description', q.description,
    'resolution', q.resolution,
    'assigned_to', q.assigned_to,
    'assigned_name', q.assigned_name,
    'created_by', q.created_by,
    'created_by_name', q.created_by_name,
    'compensation_cents', q.compensation_cents,
    'currency', q.currency,
    'satisfaction', q.satisfaction,
    'satisfaction_comment', q.satisfaction_comment,
    'first_response_at', q.first_response_at,
    'due_at', q.due_at,
    'follow_up_at', q.follow_up_at,
    'escalated_at', q.escalated_at,
    'resolved_at', q.resolved_at,
    'closed_at', q.closed_at,
    'last_activity_at', q.last_activity_at,
    'created_at', q.created_at,
    'message_count', q.message_count,
    'unread_count', q.unread_count,
    'last_message', q.last_message,
    'overdue', q.overdue
  ) order by q.sort_status, q.sort_priority, q.last_activity_at desc), '[]'::jsonb)
  into v_items
  from (
    select c.*,
      (select r.code from public.acc_reservations r where r.id = c.reservation_id) as reservation_code,
      coalesce(nullif(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''), ap.username) as assigned_name,
      coalesce(nullif(trim(concat_ws(' ', cp.first_name, cp.last_name)), ''), cp.username) as created_by_name,
      (select count(*) from public.acc_complaint_messages m
        where m.complaint_id = c.id and not m.internal) as message_count,
      (select count(*) from public.acc_complaint_messages m
        where m.complaint_id = c.id and m.author_role = 'guest' and m.read_at is null) as unread_count,
      (select m.body from public.acc_complaint_messages m
        where m.complaint_id = c.id and not m.internal
        order by m.created_at desc limit 1) as last_message,
      (c.due_at < now() and c.status in ('open', 'in_progress', 'waiting_guest', 'escalated')) as overdue,
      case c.status
        when 'escalated' then 0
        when 'open' then 1
        when 'in_progress' then 2
        when 'waiting_guest' then 3
        when 'resolved' then 4
        else 5
      end as sort_status,
      case c.priority
        when 'urgent' then 0
        when 'high' then 1
        when 'normal' then 2
        else 3
      end as sort_priority
    from public.acc_complaints c
    left join public.profiles ap on ap.id = c.assigned_to
    left join public.profiles cp on cp.id = c.created_by
    where c.property_id = p_property_id
      and (
        p_status is null or p_status = 'all'
        or (p_status = 'active' and c.status in ('open', 'in_progress', 'waiting_guest', 'escalated'))
        or c.status = p_status
      )
      and (p_priority is null or p_priority = 'all' or c.priority = p_priority)
      and (p_category is null or p_category = 'all' or c.category = p_category)
      and (p_assigned_to is null or c.assigned_to = p_assigned_to)
      and (
        v_query is null
        or c.reference ilike '%' || v_query || '%'
        or c.subject ilike '%' || v_query || '%'
        or c.guest_name ilike '%' || v_query || '%'
        or coalesce(c.room_number, '') ilike '%' || v_query || '%'
        or coalesce(c.guest_phone, '') ilike '%' || v_query || '%'
      )
    order by sort_status, sort_priority, c.last_activity_at desc
    limit v_limit offset v_offset
  ) q;

  select jsonb_build_object(
    'active', count(*) filter (where c.status in ('open', 'in_progress', 'waiting_guest', 'escalated')),
    'open', count(*) filter (where c.status = 'open'),
    'in_progress', count(*) filter (where c.status = 'in_progress'),
    'waiting_guest', count(*) filter (where c.status = 'waiting_guest'),
    'escalated', count(*) filter (where c.status = 'escalated'),
    'resolved', count(*) filter (where c.status = 'resolved'),
    'closed', count(*) filter (where c.status = 'closed'),
    'urgent', count(*) filter (where c.priority = 'urgent' and c.status not in ('resolved', 'closed')),
    'unassigned', count(*) filter (where c.assigned_to is null and c.status not in ('resolved', 'closed')),
    'overdue', count(*) filter (
      where c.due_at < now() and c.status in ('open', 'in_progress', 'waiting_guest', 'escalated')
    ),
    'created_today', count(*) filter (where c.created_at::date = current_date),
    'resolved_today', count(*) filter (where c.resolved_at::date = current_date),
    'avg_first_response_minutes', coalesce(round(avg(
      extract(epoch from (c.first_response_at - c.created_at)) / 60
    ) filter (where c.first_response_at is not null and c.created_at > now() - interval '90 days')), 0),
    'avg_resolution_minutes', coalesce(round(avg(
      extract(epoch from (c.resolved_at - c.created_at)) / 60
    ) filter (where c.resolved_at is not null and c.created_at > now() - interval '90 days')), 0),
    'satisfaction', coalesce(round(avg(c.satisfaction) filter (where c.satisfaction is not null), 2), 0),
    'satisfaction_count', count(*) filter (where c.satisfaction is not null)
  ) into v_stats
  from public.acc_complaints c
  where c.property_id = p_property_id;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'stats', v_stats,
    'can_manage', true
  );
end;
$$;

grant execute on function public.acc_complaints_list(uuid, text, text, text, text, uuid, int, int)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Detay: yazışma + zaman çizelgesi (personel ve misafir)
-- ---------------------------------------------------------------------
create or replace function public.acc_complaint_get(p_complaint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  c public.acc_complaints%rowtype;
  v_is_staff boolean;
  v_is_guest boolean;
  v_messages jsonb;
  v_events jsonb;
  v_property_name text;
  v_reservation_code text;
  v_unread int := 0;
begin
  select * into c from public.acc_complaints where id = p_complaint_id;
  if not found then
    raise exception 'complaint_not_found' using errcode = 'P0002';
  end if;

  v_is_staff := public.acc_can(c.property_id, 'complaints');
  v_is_guest := c.guest_user_id is not null and c.guest_user_id = v_uid;
  if not v_is_staff and not v_is_guest then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_is_staff then
    update public.acc_complaint_messages
       set read_at = now()
     where complaint_id = c.id and author_role = 'guest' and read_at is null;
  else
    update public.acc_complaint_messages
       set read_at = now()
     where complaint_id = c.id and author_role = 'staff' and not internal and read_at is null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'author_role', q.author_role,
    'author_name', q.author_name,
    'body', q.body,
    'internal', q.internal,
    'read_at', q.read_at,
    'created_at', q.created_at
  ) order by q.created_at), '[]'::jsonb)
  into v_messages
  from (
    select m.id, m.author_role, m.body, m.internal, m.read_at, m.created_at,
      case
        when m.author_role = 'system' then 'Sistem'
        when m.author_role = 'guest' then coalesce(c.guest_name, 'Misafir')
        else coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username, 'Personel')
      end as author_name
    from public.acc_complaint_messages m
    left join public.profiles pr on pr.id = m.author_id
    where m.complaint_id = c.id
      and (v_is_staff or not m.internal)
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'action', e.action,
    'from_status', e.from_status,
    'to_status', e.to_status,
    'actor_name', coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.username),
    'detail', e.detail,
    'created_at', e.created_at
  ) order by e.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select * from public.acc_complaint_events
    where complaint_id = c.id
    order by created_at desc
    limit 50
  ) e
  left join public.profiles pr on pr.id = e.actor_id;

  select name into v_property_name from public.acc_properties where id = c.property_id;
  select code into v_reservation_code from public.acc_reservations where id = c.reservation_id;

  if v_is_staff then
    select count(*) into v_unread
    from public.acc_complaint_messages m
    where m.complaint_id = c.id and m.author_role = 'guest' and m.read_at is null;
  else
    select count(*) into v_unread
    from public.acc_complaint_messages m
    where m.complaint_id = c.id and m.author_role = 'staff' and not m.internal and m.read_at is null;
  end if;

  return to_jsonb(c) || jsonb_build_object(
    'property_name', v_property_name,
    'reservation_code', v_reservation_code,
    'messages', v_messages,
    'events', v_events,
    'unread_count', v_unread,
    'can_manage', v_is_staff,
    'can_reply', v_is_staff or (v_is_guest and c.status <> 'closed'),
    'is_guest', v_is_guest,
    'overdue', (c.due_at < now() and c.status in ('open', 'in_progress', 'waiting_guest', 'escalated'))
  );
end;
$$;

grant execute on function public.acc_complaint_get(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Otel paneli: şikayet oluşturma
-- ---------------------------------------------------------------------
create or replace function public.acc_complaint_create(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'complaints');
  v_subject text := btrim(coalesce(p_payload->>'subject', ''));
  v_description text := btrim(coalesce(p_payload->>'description', ''));
  v_category text := coalesce(nullif(p_payload->>'category', ''), 'other');
  v_channel text := coalesce(nullif(p_payload->>'channel', ''), 'front_desk');
  v_priority text := coalesce(nullif(p_payload->>'priority', ''), 'normal');
  v_reservation_id uuid := nullif(p_payload->>'reservation_id', '')::uuid;
  v_assigned_to uuid := nullif(p_payload->>'assigned_to', '')::uuid;
  v_comp bigint := greatest(0, coalesce((p_payload->>'compensation_cents')::bigint, 0));
  v_guest_name text;
  v_guest_phone text;
  v_guest_email text;
  v_guest_id uuid;
  v_guest_user_id uuid;
  v_room_number text;
  v_follow_up timestamptz := nullif(p_payload->>'follow_up_at', '')::timestamptz;
  v_id uuid;
  v_reference text;
begin
  if length(v_subject) < 3 then
    raise exception 'invalid_subject' using errcode = '22023';
  end if;
  if length(v_description) < 1 then
    raise exception 'invalid_description' using errcode = '22023';
  end if;
  if v_category not in ('cleanliness', 'noise', 'staff', 'maintenance', 'billing',
                        'food', 'safety', 'check_in', 'amenity', 'other') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if v_channel not in ('front_desk', 'phone', 'email', 'whatsapp', 'guest_app', 'review', 'other') then
    raise exception 'invalid_channel' using errcode = '22023';
  end if;
  if v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;

  v_guest_name := nullif(btrim(coalesce(p_payload->>'guest_name', '')), '');
  v_guest_phone := nullif(btrim(coalesce(p_payload->>'guest_phone', '')), '');
  v_guest_email := nullif(btrim(coalesce(p_payload->>'guest_email', '')), '');
  v_room_number := nullif(btrim(coalesce(p_payload->>'room_number', '')), '');

  if v_reservation_id is not null then
    select r.guest_name, r.guest_phone, r.guest_email, r.guest_id, r.guest_user_id,
           coalesce(v_room_number, (select rm.number from public.acc_rooms rm where rm.id = r.room_id))
      into v_guest_name, v_guest_phone, v_guest_email, v_guest_id, v_guest_user_id, v_room_number
    from public.acc_reservations r
    where r.id = v_reservation_id and r.property_id = p_property_id;

    if not found then
      raise exception 'reservation_not_found' using errcode = 'P0002';
    end if;

    v_guest_name := coalesce(nullif(btrim(coalesce(p_payload->>'guest_name', '')), ''), v_guest_name);
    v_guest_phone := coalesce(nullif(btrim(coalesce(p_payload->>'guest_phone', '')), ''), v_guest_phone);
    v_guest_email := coalesce(nullif(btrim(coalesce(p_payload->>'guest_email', '')), ''), v_guest_email);
  end if;

  if v_assigned_to is not null and not exists (
    select 1 from public.acc_property_staff s
    where s.property_id = p_property_id and s.user_id = v_assigned_to and s.status = 'active'
  ) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;

  insert into public.acc_complaints (
    property_id, reservation_id, guest_id, guest_user_id,
    guest_name, guest_phone, guest_email, room_number,
    category, channel, priority, status, subject, description,
    assigned_to, created_by, compensation_cents, follow_up_at, due_at
  ) values (
    p_property_id, v_reservation_id, v_guest_id, v_guest_user_id,
    coalesce(v_guest_name, 'Misafir'), v_guest_phone, v_guest_email, v_room_number,
    v_category, v_channel, v_priority, 'open', v_subject, v_description,
    v_assigned_to, v_uid, v_comp, v_follow_up,
    now() + make_interval(hours => public.acc_complaint_sla_hours(v_priority))
  )
  returning id, reference into v_id, v_reference;

  insert into public.acc_complaint_events (complaint_id, property_id, actor_id, action, to_status, detail)
  values (v_id, p_property_id, v_uid, 'complaint.created', 'open',
          jsonb_build_object('category', v_category, 'priority', v_priority));

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (p_property_id, v_uid, 'complaint.created', 'complaint', v_id::text,
          jsonb_build_object('reference', v_reference, 'category', v_category, 'priority', v_priority));

  if v_guest_user_id is not null and v_channel = 'guest_app' then
    insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
    values (
      v_guest_user_id, v_uid, 'accommodation_complaint',
      'Destek talebiniz alındı',
      left(v_reference || ' numaralı talebiniz otele iletildi. Gelişmeleri buradan takip edebilirsin.',
           400),
      'accommodation_complaint', v_id::text, '/konaklama/destek'
    );
  end if;

  if v_assigned_to is not null then
    insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
    values (
      v_assigned_to, v_uid, 'accommodation_complaint',
      'Size şikayet atandı',
      left(v_reference || ' · ' || v_subject, 400),
      'accommodation_complaint', v_id::text, '/konaklama/yonetim/sikayetler'
    );
  end if;

  return public.acc_complaint_get(v_id);
end;
$$;

grant execute on function public.acc_complaint_create(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Misafir: konaklama üzerinden sorun bildir
-- ---------------------------------------------------------------------
create or replace function public.acc_complaint_guest_create(
  p_reservation_id uuid,
  p_category text,
  p_subject text,
  p_description text,
  p_priority text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  r public.acc_reservations%rowtype;
  v_category text := coalesce(nullif(btrim(p_category), ''), 'other');
  v_priority text := coalesce(nullif(btrim(p_priority), ''), 'normal');
  v_subject text := btrim(coalesce(p_subject, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_room_number text;
  v_id uuid;
  v_reference text;
  v_property_name text;
begin
  if length(v_subject) < 3 then
    raise exception 'invalid_subject' using errcode = '22023';
  end if;
  if length(v_description) < 1 then
    raise exception 'invalid_description' using errcode = '22023';
  end if;
  if v_category not in ('cleanliness', 'noise', 'staff', 'maintenance', 'billing',
                        'food', 'safety', 'check_in', 'amenity', 'other') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if v_priority not in ('low', 'normal', 'high') then
    v_priority := 'normal';
  end if;

  select * into r from public.acc_reservations
   where id = p_reservation_id and guest_user_id = v_uid;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;

  select number into v_room_number from public.acc_rooms where id = r.room_id;
  select name into v_property_name from public.acc_properties where id = r.property_id;

  insert into public.acc_complaints (
    property_id, reservation_id, guest_id, guest_user_id,
    guest_name, guest_phone, guest_email, room_number,
    category, channel, priority, status, subject, description,
    created_by, due_at
  ) values (
    r.property_id, r.id, r.guest_id, v_uid,
    r.guest_name, r.guest_phone, r.guest_email, v_room_number,
    v_category, 'guest_app', v_priority, 'open', v_subject, v_description,
    v_uid, now() + make_interval(hours => public.acc_complaint_sla_hours(v_priority))
  )
  returning id, reference into v_id, v_reference;

  insert into public.acc_complaint_events (complaint_id, property_id, actor_id, action, to_status, detail)
  values (v_id, r.property_id, v_uid, 'complaint.created', 'open',
          jsonb_build_object('category', v_category, 'priority', v_priority, 'channel', 'guest_app'));

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (r.property_id, v_uid, 'complaint.created', 'complaint', v_id::text,
          jsonb_build_object('reference', v_reference, 'category', v_category,
                             'priority', v_priority, 'channel', 'guest_app'));

  perform public.acc_complaint_notify_staff(
    r.property_id,
    v_uid,
    'Yeni misafir şikayeti',
    v_reference || ' · ' || v_subject || ' · ' || coalesce(r.guest_name, 'Misafir'),
    v_id::text,
    '/konaklama/yonetim/sikayetler'
  );

  return public.acc_complaint_get(v_id);
end;
$$;

grant execute on function public.acc_complaint_guest_create(uuid, text, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Yazışma / yanıt
-- ---------------------------------------------------------------------
create or replace function public.acc_complaint_message(
  p_complaint_id uuid,
  p_body text,
  p_internal boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  c public.acc_complaints%rowtype;
  v_is_staff boolean;
  v_is_guest boolean;
  v_internal boolean := coalesce(p_internal, false);
  v_body text := btrim(coalesce(p_body, ''));
  v_new_status text;
  v_property_name text;
begin
  if length(v_body) < 1 then
    raise exception 'empty_message' using errcode = '22023';
  end if;

  select * into c from public.acc_complaints where id = p_complaint_id;
  if not found then
    raise exception 'complaint_not_found' using errcode = 'P0002';
  end if;

  v_is_staff := public.acc_can(c.property_id, 'complaints');
  v_is_guest := c.guest_user_id is not null and c.guest_user_id = v_uid;
  if not v_is_staff and not v_is_guest then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_is_guest and v_internal then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_is_guest and c.status = 'closed' then
    raise exception 'complaint_closed' using errcode = '22023';
  end if;

  insert into public.acc_complaint_messages
    (complaint_id, property_id, author_id, author_role, body, internal)
  values (
    c.id, c.property_id, v_uid,
    case when v_is_staff then 'staff' else 'guest' end,
    v_body, v_internal
  );

  v_new_status := c.status;
  if v_is_guest and c.status in ('resolved', 'closed') then
    v_new_status := 'open';
  elsif v_is_staff and not v_internal and c.status = 'open' then
    v_new_status := 'in_progress';
  end if;

  update public.acc_complaints
     set last_activity_at = now(),
         status = v_new_status,
         first_response_at = case
           when v_is_staff and not v_internal then coalesce(first_response_at, now())
           else first_response_at
         end,
         resolved_at = case when v_new_status in ('resolved', 'closed') then resolved_at else null end,
         closed_at = case when v_new_status = 'closed' then closed_at else null end
   where id = c.id;

  insert into public.acc_complaint_events
    (complaint_id, property_id, actor_id, action, from_status, to_status, detail)
  values (
    c.id, c.property_id, v_uid, 'complaint.message',
    c.status, v_new_status,
    jsonb_build_object('role', case when v_is_staff then 'staff' else 'guest' end,
                       'internal', v_internal)
  );

  if v_is_staff then
    insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
    values (c.property_id, v_uid, 'complaint.replied', 'complaint', c.id::text,
            jsonb_build_object('reference', c.reference, 'internal', v_internal));

    if not v_internal and c.guest_user_id is not null then
      select name into v_property_name from public.acc_properties where id = c.property_id;
      insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
      values (
        c.guest_user_id, v_uid, 'accommodation_complaint',
        coalesce(v_property_name, 'Otel') || ' destek talebinize yanıt verdi',
        left(v_body, 400),
        'accommodation_complaint', c.id::text, '/konaklama/destek'
      );
    end if;
  else
    perform public.acc_complaint_notify_staff(
      c.property_id,
      v_uid,
      'Misafir destek talebine yazdı',
      c.reference || ' · ' || c.subject,
      c.id::text,
      '/konaklama/yonetim/sikayetler'
    );
  end if;

  return public.acc_complaint_get(c.id);
end;
$$;

grant execute on function public.acc_complaint_message(uuid, text, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Otel paneli: durum, öncelik, atama, çözüm ve tazminat güncelle
-- ---------------------------------------------------------------------
create or replace function public.acc_complaint_update(
  p_complaint_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  c public.acc_complaints%rowtype;
  v_status text;
  v_priority text;
  v_category text;
  v_assigned_to uuid;
  v_resolution text;
  v_internal_note text;
  v_comp bigint;
  v_follow_up timestamptz;
  v_changed jsonb := '{}'::jsonb;
  v_property_name text;
begin
  select * into c from public.acc_complaints where id = p_complaint_id;
  if not found then
    raise exception 'complaint_not_found' using errcode = 'P0002';
  end if;

  v_uid := public.acc_require(c.property_id, 'complaints');

  v_status := coalesce(nullif(p_payload->>'status', ''), c.status);
  v_priority := coalesce(nullif(p_payload->>'priority', ''), c.priority);
  v_category := coalesce(nullif(p_payload->>'category', ''), c.category);
  v_resolution := case
    when p_payload ? 'resolution' then nullif(btrim(coalesce(p_payload->>'resolution', '')), '')
    else c.resolution
  end;
  v_internal_note := case
    when p_payload ? 'internal_note' then nullif(btrim(coalesce(p_payload->>'internal_note', '')), '')
    else c.internal_note
  end;
  v_comp := case
    when p_payload ? 'compensation_cents' then greatest(0, coalesce((p_payload->>'compensation_cents')::bigint, 0))
    else c.compensation_cents
  end;
  v_follow_up := case
    when p_payload ? 'follow_up_at' then nullif(p_payload->>'follow_up_at', '')::timestamptz
    else c.follow_up_at
  end;
  v_assigned_to := case
    when p_payload ? 'assigned_to' then nullif(p_payload->>'assigned_to', '')::uuid
    else c.assigned_to
  end;

  if v_status not in ('open', 'in_progress', 'waiting_guest', 'escalated', 'resolved', 'closed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;
  if v_category not in ('cleanliness', 'noise', 'staff', 'maintenance', 'billing',
                        'food', 'safety', 'check_in', 'amenity', 'other') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if v_assigned_to is not null and not exists (
    select 1 from public.acc_property_staff s
    where s.property_id = c.property_id and s.user_id = v_assigned_to and s.status = 'active'
  ) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  if v_status in ('resolved', 'closed') and v_resolution is null then
    raise exception 'resolution_required' using errcode = '22023';
  end if;

  if v_status is distinct from c.status then
    v_changed := v_changed || jsonb_build_object('status', jsonb_build_object('from', c.status, 'to', v_status));
  end if;
  if v_priority is distinct from c.priority then
    v_changed := v_changed || jsonb_build_object('priority', jsonb_build_object('from', c.priority, 'to', v_priority));
  end if;
  if v_assigned_to is distinct from c.assigned_to then
    v_changed := v_changed || jsonb_build_object('assigned_to', v_assigned_to);
  end if;
  if v_resolution is distinct from c.resolution then
    v_changed := v_changed || jsonb_build_object('resolution', true);
  end if;
  if v_comp is distinct from c.compensation_cents then
    v_changed := v_changed || jsonb_build_object('compensation_cents', v_comp);
  end if;

  update public.acc_complaints
     set status = v_status,
         priority = v_priority,
         category = v_category,
         assigned_to = v_assigned_to,
         resolution = v_resolution,
         internal_note = v_internal_note,
         compensation_cents = v_comp,
         follow_up_at = v_follow_up,
         last_activity_at = now(),
         due_at = case
           when v_priority is distinct from c.priority
                and v_status not in ('resolved', 'closed')
             then c.created_at + make_interval(hours => public.acc_complaint_sla_hours(v_priority))
           else c.due_at
         end,
         escalated_at = case
           when v_status = 'escalated' then coalesce(c.escalated_at, now())
           else c.escalated_at
         end,
         resolved_at = case
           when v_status in ('resolved', 'closed') then coalesce(c.resolved_at, now())
           else null
         end,
         closed_at = case
           when v_status = 'closed' then coalesce(c.closed_at, now())
           else null
         end
   where id = c.id;

  insert into public.acc_complaint_events
    (complaint_id, property_id, actor_id, action, from_status, to_status, detail)
  values (c.id, c.property_id, v_uid, 'complaint.updated', c.status, v_status, v_changed);

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (c.property_id, v_uid, 'complaint.updated', 'complaint', c.id::text,
          jsonb_build_object('reference', c.reference) || v_changed);

  if v_assigned_to is not null and v_assigned_to is distinct from c.assigned_to
     and v_assigned_to is distinct from v_uid then
    insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
    values (
      v_assigned_to, v_uid, 'accommodation_complaint',
      'Size şikayet atandı',
      left(c.reference || ' · ' || c.subject, 400),
      'accommodation_complaint', c.id::text, '/konaklama/yonetim/sikayetler'
    );
  end if;

  if c.guest_user_id is not null and v_status is distinct from c.status then
    select name into v_property_name from public.acc_properties where id = c.property_id;
    if v_status = 'waiting_guest' then
      insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
      values (
        c.guest_user_id, v_uid, 'accommodation_complaint',
        'Destek talebiniz için bilgi bekleniyor',
        left(c.reference || ' · ' || c.subject, 400),
        'accommodation_complaint', c.id::text, '/konaklama/destek'
      );
    elsif v_status in ('resolved', 'closed') then
      insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
      values (
        c.guest_user_id, v_uid, 'accommodation_complaint',
        coalesce(v_property_name, 'Otel') || ' destek talebini çözdü',
        left(coalesce(v_resolution, c.subject), 400),
        'accommodation_complaint', c.id::text, '/konaklama/destek'
      );
    end if;
  end if;

  return public.acc_complaint_get(c.id);
end;
$$;

grant execute on function public.acc_complaint_update(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Eskalasyon (Trabzone desteğine yükseltme)
-- ---------------------------------------------------------------------
create or replace function public.acc_complaint_escalate(
  p_complaint_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  c public.acc_complaints%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into c from public.acc_complaints where id = p_complaint_id;
  if not found then
    raise exception 'complaint_not_found' using errcode = 'P0002';
  end if;

  v_uid := public.acc_require(c.property_id, 'complaints');
  if c.status in ('resolved', 'closed') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  update public.acc_complaints
     set status = 'escalated',
         priority = 'urgent',
         escalated_at = coalesce(escalated_at, now()),
         due_at = least(coalesce(due_at, now() + interval '2 hours'), now() + interval '2 hours'),
         last_activity_at = now()
   where id = c.id;

  insert into public.acc_complaint_messages
    (complaint_id, property_id, author_id, author_role, body, internal)
  values (
    c.id, c.property_id, v_uid, 'system',
    coalesce('Eskalasyon: ' || v_note, 'Talep Trabzone desteğine yükseltildi.'),
    true
  );

  insert into public.acc_complaint_events
    (complaint_id, property_id, actor_id, action, from_status, to_status, detail)
  values (c.id, c.property_id, v_uid, 'complaint.escalated', c.status, 'escalated',
          jsonb_build_object('note', v_note));

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (c.property_id, v_uid, 'complaint.escalated', 'complaint', c.id::text,
          jsonb_build_object('reference', c.reference, 'note', v_note));

  -- Tesis sahibi ve Trabzone yöneticileri bilgilendirilir.
  insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
  select distinct target.user_id, v_uid, 'accommodation_complaint',
         'Şikayet eskalasyonu', left(c.reference || ' · ' || c.subject, 400),
         'accommodation_complaint', c.id::text, '/konaklama/yonetim/sikayetler'
  from (
    select p.owner_id as user_id from public.acc_properties p where p.id = c.property_id
    union
    select a.user_id from public.user_role_assignments a
    where a.role_key in ('admin', 'super_admin')
      and (a.expires_at is null or a.expires_at > now())
  ) target
  where target.user_id is not null and target.user_id is distinct from v_uid;

  return public.acc_complaint_get(c.id);
end;
$$;

grant execute on function public.acc_complaint_escalate(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Misafir memnuniyet puanı
-- ---------------------------------------------------------------------
create or replace function public.acc_complaint_rate(
  p_complaint_id uuid,
  p_score int,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  c public.acc_complaints%rowtype;
begin
  if p_score not between 1 and 5 then
    raise exception 'invalid_rating' using errcode = '22023';
  end if;

  select * into c from public.acc_complaints where id = p_complaint_id;
  if not found then
    raise exception 'complaint_not_found' using errcode = 'P0002';
  end if;
  if c.guest_user_id is distinct from v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if c.status not in ('resolved', 'closed') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  update public.acc_complaints
     set satisfaction = p_score,
         satisfaction_comment = nullif(btrim(coalesce(p_comment, '')), ''),
         last_activity_at = now()
   where id = c.id;

  insert into public.acc_complaint_events
    (complaint_id, property_id, actor_id, action, detail)
  values (c.id, c.property_id, v_uid, 'complaint.rated',
          jsonb_build_object('score', p_score));

  return public.acc_complaint_get(c.id);
end;
$$;

grant execute on function public.acc_complaint_rate(uuid, int, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Misafir: kendi destek talepleri
-- ---------------------------------------------------------------------
create or replace function public.acc_my_complaints(p_reservation_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'reference', q.reference,
    'property_id', q.property_id,
    'property_name', q.property_name,
    'reservation_id', q.reservation_id,
    'reservation_code', q.reservation_code,
    'guest_name', q.guest_name,
    'room_number', q.room_number,
    'category', q.category,
    'priority', q.priority,
    'status', q.status,
    'subject', q.subject,
    'description', q.description,
    'resolution', q.resolution,
    'satisfaction', q.satisfaction,
    'due_at', q.due_at,
    'resolved_at', q.resolved_at,
    'last_activity_at', q.last_activity_at,
    'created_at', q.created_at,
    'unread_count', q.unread_count,
    'last_message', q.last_message,
    'message_count', q.message_count
  ) order by q.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select c.*,
      (select p.name from public.acc_properties p where p.id = c.property_id) as property_name,
      (select r.code from public.acc_reservations r where r.id = c.reservation_id) as reservation_code,
      (select count(*) from public.acc_complaint_messages m
        where m.complaint_id = c.id and m.author_role = 'staff' and not m.internal
          and m.read_at is null) as unread_count,
      (select count(*) from public.acc_complaint_messages m
        where m.complaint_id = c.id and not m.internal) as message_count,
      (select m.body from public.acc_complaint_messages m
        where m.complaint_id = c.id and not m.internal
        order by m.created_at desc limit 1) as last_message
    from public.acc_complaints c
    where c.guest_user_id = v_uid
      and (p_reservation_id is null or c.reservation_id = p_reservation_id)
  ) q;

  return jsonb_build_object('items', v_items);
end;
$$;

grant execute on function public.acc_my_complaints(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tesis bağlamına açık şikayet sayacı
-- ---------------------------------------------------------------------
create or replace function public.acc_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'slug', p.slug,
    'property_type', p.property_type,
    'status', p.status,
    'verification_status', p.verification_status,
    'verification_note', p.verification_note,
    'district', p.district,
    'neighborhood', p.neighborhood,
    'cover_path', coalesce(
      p.cover_path,
      (select m.storage_path from public.acc_property_media m
        where m.property_id = p.id and m.kind = 'image' and m.status = 'approved'
        order by m.cover desc, m.sort_order limit 1)
    ),
    'role', public.acc_staff_role(p.id),
    'permissions', coalesce((
      select s.permissions from public.acc_property_staff s
      where s.property_id = p.id and s.user_id = v_uid and s.status = 'active'
      limit 1
    ), '{}'::text[]),
    'pending_reservations', (
      select count(*) from public.acc_reservations r
      where r.property_id = p.id and r.status = 'pending'
    ),
    'unread_messages', (
      select count(*) from public.acc_messages m
      where m.property_id = p.id and m.read_at is null and m.sender_role = 'guest'
    ),
    'pending_tasks', (
      select count(*) from public.acc_housekeeping_tasks t
      where t.property_id = p.id and t.status in ('pending', 'in_progress')
    ),
    'pending_complaints', case
      when public.acc_can(p.id, 'complaints') then (
        select count(*) from public.acc_complaints c
        where c.property_id = p.id
          and c.status in ('open', 'in_progress', 'waiting_guest', 'escalated')
      )
      else 0
    end
  ) order by p.name), '[]'::jsonb)
  into v_items
  from public.acc_properties p
  where exists (
      select 1 from public.acc_property_staff s
      where s.property_id = p.id and s.user_id = v_uid and s.status = 'active'
    )
    or (public.is_admin() and p.status = 'published');

  return jsonb_build_object('items', v_items, 'is_admin', public.is_admin());
end;
$$;

grant execute on function public.acc_my_context() to authenticated, service_role;
