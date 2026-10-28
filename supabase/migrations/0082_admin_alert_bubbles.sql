-- -----------------------------------------------------------------------------
-- 0082 — Admin Control Center: gerçek zamanlı baloncuk uyarıları
--
-- Amaç: yönetim paneline yeni bir işlem düştüğünde (şikâyet, destek talebi,
-- onay, sistem hatası, veri/silme talebi, sipariş, yolculuk doğrulaması,
-- güvenlik olayı, içerik bildirimi) panelin her ekranında aynı görünen bir
-- baloncuk belirir. Baloncuğa dokunulduğunda ilgili kayda gidilir.
--
-- Tasarım notları:
--  * `admin_alert_events` yalnızca sunucu tarafındaki trigger'lar tarafından
--    yazılır; istemci insert/update/delete yetkisine sahip değildir.
--  * Her satır bir `permission_code` taşır. SELECT politikası bu kodu
--    `public.has_permission(...)` ile denetler; böylece Realtime kanalı da
--    yalnızca yetkili personele satır teslim eder.
--  * Okundu bilgisi kullanıcı bazlıdır (`admin_alert_reads`), yani bir
--    yöneticinin baloncuğu kapatması diğerlerini etkilemez.
--  * Kayıtlar 7 gün sonra akıştan düşer; tablo gereksiz büyümez.
-- -----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Tablolar
-- ---------------------------------------------------------------------------
create table if not exists public.admin_alert_events (
  id              uuid primary key default gen_random_uuid(),
  category        text not null,
  title           text not null,
  body            text,
  route           text not null,
  entity_type     text,
  entity_id       text,
  permission_code text,
  tone            text not null default 'info',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '7 days'),
  constraint admin_alert_events_title_check check (char_length(title) between 1 and 140),
  constraint admin_alert_events_route_check check (route like '/%'),
  constraint admin_alert_events_tone_check check (tone in ('info', 'success', 'warning', 'danger')),
  constraint admin_alert_events_category_check check (
    category in (
      'report', 'child_safety', 'ticket', 'approval', 'error', 'privacy',
      'deletion', 'order', 'ride_verification', 'ride_safety', 'ride_dispute',
      'content_report', 'custom'
    )
  ),
  -- Aynı kayıt için ikinci kez baloncuk üretilmez (trigger retry / toplu işlem).
  constraint admin_alert_events_entity_unique unique (category, entity_id)
);

create index if not exists admin_alert_events_created_idx
  on public.admin_alert_events (created_at desc);
create index if not exists admin_alert_events_permission_idx
  on public.admin_alert_events (permission_code, created_at desc);

create table if not exists public.admin_alert_reads (
  alert_id uuid not null references public.admin_alert_events (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  read_at  timestamptz not null default now(),
  primary key (alert_id, user_id)
);

create index if not exists admin_alert_reads_user_idx
  on public.admin_alert_reads (user_id, read_at desc);

-- ---------------------------------------------------------------------------
-- 2. Yazma yardımcısı (yalnızca trigger'lar ve SECURITY DEFINER RPC'ler)
-- ---------------------------------------------------------------------------
create or replace function public.tz_admin_push_alert(
  p_category        text,
  p_title           text,
  p_body            text,
  p_route           text,
  p_entity_type     text default null,
  p_entity_id       text default null,
  p_permission_code text default null,
  p_tone            text default 'info'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_category is null or p_route is null or p_route not like '/%' then
    return;
  end if;

  insert into public.admin_alert_events (
    category, title, body, route, entity_type, entity_id, permission_code, tone
  )
  values (
    p_category,
    left(coalesce(p_title, 'Yeni kayıt'), 140),
    left(nullif(trim(coalesce(p_body, '')), ''), 200),
    p_route,
    p_entity_type,
    p_entity_id,
    nullif(p_permission_code, ''),
    case when p_tone in ('info', 'success', 'warning', 'danger') then p_tone else 'info' end
  )
  on conflict on constraint admin_alert_events_entity_unique do nothing;
end;
$$;

revoke all on function public.tz_admin_push_alert(text, text, text, text, text, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Genel trigger: TG_ARGV ile yapılandırılır
--
--    [0] category          [1] permission_code
--    [2] route (sabit ya da "/admin/report/" gibi önek)
--    [3] başlık metni      [4] gövde için kolon adı
--    [5] tone              [6] "true" ise route'un sonuna kayıt id'si eklenir
--    [7] (ops.) filtre kolonu  [8] (ops.) beklenen değer
-- ---------------------------------------------------------------------------
create or replace function public.tz_admin_alert_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row        jsonb := to_jsonb(new);
  v_id         text := nullif(v_row->>'id', '');
  v_category   text := tg_argv[0];
  v_permission text := nullif(tg_argv[1], '');
  v_route      text := tg_argv[2];
  v_title      text := tg_argv[3];
  v_body_col   text := nullif(tg_argv[4], '');
  v_tone       text := coalesce(nullif(tg_argv[5], ''), 'info');
  v_with_id    boolean := coalesce(tg_argv[6], 'true') = 'true';
  v_when_col   text := nullif(tg_argv[7], '');
  v_when_value text := nullif(tg_argv[8], '');
  v_body       text;
begin
  if v_id is null or v_route is null then
    return new;
  end if;

  if v_when_col is not null and v_when_value is not null
     and coalesce(v_row->>v_when_col, '') <> v_when_value then
    return new;
  end if;

  if v_body_col is not null then
    v_body := nullif(trim(coalesce(v_row->>v_body_col, '')), '');
  end if;

  perform public.tz_admin_push_alert(
    v_category,
    v_title,
    v_body,
    case when v_with_id then v_route || v_id else v_route end,
    tg_table_name,
    v_id,
    v_permission,
    v_tone
  );

  return new;
end;
$$;

revoke all on function public.tz_admin_alert_trigger() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Şikâyetler: çocuk güvenliği ayrı ve öncelikli kuyruğa düşer
-- ---------------------------------------------------------------------------
create or replace function public.tz_admin_alert_user_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child boolean := coalesce(new.is_child_safety, false);
  v_ref   text := coalesce(nullif(new.report_no, ''), left(new.id::text, 8));
  v_reason text := coalesce(nullif(new.reason_category, ''), nullif(new.target_type, ''), 'diğer');
begin
  perform public.tz_admin_push_alert(
    case when v_child then 'child_safety' else 'report' end,
    case when v_child then 'Çocuk güvenliği bildirimi' else 'Yeni şikâyet' end,
    v_ref || ' · ' || v_reason,
    '/admin/report/' || new.id::text,
    'user_report',
    new.id::text,
    case when v_child then 'safety.child.view' else 'safety.report.view' end,
    case when v_child then 'danger' else 'warning' end
  );
  return new;
end;
$$;

revoke all on function public.tz_admin_alert_user_report() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Trigger'lar
-- ---------------------------------------------------------------------------
drop trigger if exists tz_alert_user_reports on public.user_reports;
create trigger tz_alert_user_reports
  after insert on public.user_reports
  for each row execute function public.tz_admin_alert_user_report();

drop trigger if exists tz_alert_support_tickets on public.support_tickets;
create trigger tz_alert_support_tickets
  after insert on public.support_tickets
  for each row execute function public.tz_admin_alert_trigger(
    'ticket', 'support.view', '/admin/ticket/', 'Yeni destek talebi', 'subject', 'info', 'true'
  );

drop trigger if exists tz_alert_admin_approvals on public.admin_approval_requests;
create trigger tz_alert_admin_approvals
  after insert on public.admin_approval_requests
  for each row execute function public.tz_admin_alert_trigger(
    'approval', 'feature.view', '/admin/features', 'Yeni onay talebi', 'action_code', 'warning', 'false'
  );

drop trigger if exists tz_alert_system_errors on public.system_errors;
create trigger tz_alert_system_errors
  after insert on public.system_errors
  for each row execute function public.tz_admin_alert_trigger(
    'error', 'system.view', '/admin/system', 'Yeni sistem hatası', 'error_code', 'danger', 'false'
  );

drop trigger if exists tz_alert_privacy_requests on public.privacy_data_requests;
create trigger tz_alert_privacy_requests
  after insert on public.privacy_data_requests
  for each row execute function public.tz_admin_alert_trigger(
    'privacy', 'privacy.request.manage', '/admin/data-requests', 'Yeni veri talebi', 'request_no', 'info', 'false'
  );

drop trigger if exists tz_alert_deletion_requests on public.account_deletion_requests;
create trigger tz_alert_deletion_requests
  after insert on public.account_deletion_requests
  for each row execute function public.tz_admin_alert_trigger(
    'deletion', 'privacy.request.manage', '/admin/deletion-requests', 'Yeni hesap silme talebi', 'reference_code', 'warning', 'false'
  );

drop trigger if exists tz_alert_marketplace_orders on public.marketplace_orders;
create trigger tz_alert_marketplace_orders
  after insert on public.marketplace_orders
  for each row execute function public.tz_admin_alert_trigger(
    'order', 'market.orders.view', '/admin/marketplace', 'Yeni sipariş', 'order_no', 'info', 'false'
  );

drop trigger if exists tz_alert_ride_verifications on public.ride_verifications;
create trigger tz_alert_ride_verifications
  after insert on public.ride_verifications
  for each row execute function public.tz_admin_alert_trigger(
    'ride_verification', 'ride.verify', '/admin/ride', 'Yeni doğrulama başvurusu', 'kind', 'info', 'false', 'status', 'pending'
  );

drop trigger if exists tz_alert_ride_safety on public.ride_safety_incidents;
create trigger tz_alert_ride_safety
  after insert on public.ride_safety_incidents
  for each row execute function public.tz_admin_alert_trigger(
    'ride_safety', 'ride.safety', '/admin/ride', 'Yolculuk güvenlik olayı', 'kind', 'danger', 'false'
  );

drop trigger if exists tz_alert_ride_disputes on public.ride_disputes;
create trigger tz_alert_ride_disputes
  after insert on public.ride_disputes
  for each row execute function public.tz_admin_alert_trigger(
    'ride_dispute', 'ride.moderate', '/admin/ride', 'Yeni yolculuk uyuşmazlığı', 'category', 'warning', 'false'
  );

drop trigger if exists tz_alert_content_reports on public.content_reports;
create trigger tz_alert_content_reports
  after insert on public.content_reports
  for each row execute function public.tz_admin_alert_trigger(
    'content_report', 'map.moderate', '/admin/explore', 'Yeni içerik bildirimi', 'reason', 'warning', 'false'
  );

-- ---------------------------------------------------------------------------
-- 6. RLS ve yetkiler
-- ---------------------------------------------------------------------------
alter table public.admin_alert_events enable row level security;
alter table public.admin_alert_reads enable row level security;

drop policy if exists admin_alert_events_admin_select on public.admin_alert_events;
create policy admin_alert_events_admin_select
  on public.admin_alert_events
  for select
  to authenticated
  using (
    expires_at > now()
    and (permission_code is null or public.has_permission(permission_code))
  );

drop policy if exists admin_alert_reads_self_select on public.admin_alert_reads;
create policy admin_alert_reads_self_select
  on public.admin_alert_reads
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.admin_alert_events from anon, authenticated;
revoke all on public.admin_alert_reads from anon, authenticated;

-- Realtime aboneliği SELECT politikasına tabidir; tablo yalnızca okunur.
grant select on public.admin_alert_events to authenticated;
grant select on public.admin_alert_reads to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Realtime yayını
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'admin_alert_events'
  ) then
    alter publication supabase_realtime add table public.admin_alert_events;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. İstemci RPC'leri
-- ---------------------------------------------------------------------------

/** Yetkili yöneticinin okunmamış baloncuklarını döndürür. */
create or replace function public.admin_alert_feed(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_limit  integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_items  jsonb := '[]'::jsonb;
  v_unread integer := 0;
begin
  select count(*)
    into v_unread
  from public.admin_alert_events e
  where e.expires_at > now()
    and (e.permission_code is null or public.has_permission(e.permission_code))
    and not exists (
      select 1 from public.admin_alert_reads r
      where r.alert_id = e.id and r.user_id = v_uid
    );

  select coalesce(jsonb_agg(s.item order by s.created_at desc), '[]'::jsonb)
    into v_items
  from (
    select
      e.created_at,
      jsonb_build_object(
        'id', e.id,
        'category', e.category,
        'title', e.title,
        'body', e.body,
        'route', e.route,
        'entity_type', e.entity_type,
        'entity_id', e.entity_id,
        'tone', e.tone,
        'created_at', e.created_at
      ) as item
    from public.admin_alert_events e
    where e.expires_at > now()
      and (e.permission_code is null or public.has_permission(e.permission_code))
      and not exists (
        select 1 from public.admin_alert_reads r
        where r.alert_id = e.id and r.user_id = v_uid
      )
    order by e.created_at desc
    limit v_limit
  ) s;

  return jsonb_build_object('items', v_items, 'unread', v_unread);
end;
$$;

revoke all on function public.admin_alert_feed(integer) from public, anon;
grant execute on function public.admin_alert_feed(integer) to authenticated;

/** Baloncuklar kapatıldığında / tıklandığında yalnızca bu yönetici için okundu işaretler. */
create or replace function public.admin_alert_read(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_count integer := 0;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  insert into public.admin_alert_reads (alert_id, user_id)
  select e.id, v_uid
  from public.admin_alert_events e
  where e.id = any(p_ids)
    and (e.permission_code is null or public.has_permission(e.permission_code))
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_alert_read(uuid[]) from public, anon;
grant execute on function public.admin_alert_read(uuid[]) to authenticated;

/** Görünen tüm baloncukları temizler. */
create or replace function public.admin_alert_read_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_count integer := 0;
begin
  insert into public.admin_alert_reads (alert_id, user_id)
  select e.id, v_uid
  from public.admin_alert_events e
  where e.expires_at > now()
    and (e.permission_code is null or public.has_permission(e.permission_code))
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_alert_read_all() from public, anon;
grant execute on function public.admin_alert_read_all() to authenticated;
