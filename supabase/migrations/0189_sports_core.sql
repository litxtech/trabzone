-- ---------------------------------------------------------------------------
-- 0195 — Trabzonspor Canlı Maç Arenası: çekirdek veri modeli
--
-- Veri akışı: API-Football v3 → sports-sync edge function (yalnızca HTTP +
-- zarf/kota kontrolü) → sports_ingest_* (normalizasyon, doğrulama, tekilleştirme,
-- revizyon, bildirim kuyruğu) → Postgres → Realtime yayın sinyali → istemciler
-- yalnızca RPC ile okur.
--
-- Kurallar:
--  * Tek kanonik kayıt: sports_fixtures.id = sağlayıcının fixture id değeri.
--    TEST maçları negatif id + is_test=true taşır; Feed'e ve gerçek kullanıcı
--    bildirimlerine asla çıkmaz.
--  * Kaynakta olmayan veri uydurulmaz: null değerler null saklanır, istemci
--    "Veri mevcut değil" gösterir. Ölçülmemiş dakikalar için snapshot üretilmez.
--  * Sağlayıcı olaylarına id vermez; olay anahtarı
--    tür:takım:oyuncu:dakika:uzatma#sıra bileşimidir. Kaynak düzeltmeleri
--    revizyon olarak, kaybolan olaylar iki ardışık senkron sonrası geri çekilmiş
--    olarak işlenir.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Yetkiler
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr) values
  ('sports.view',     'Trabzonspor maç merkezi panelini, API durumunu ve senkron kayıtlarını görüntüleme'),
  ('sports.manage',   'Trabzonspor veri kaynağı, senkron ve Feed kartı ayarlarını yönetme'),
  ('sports.data',     'Maç veri sağlığı: yeniden senkron, olay gizleme ve TEST maçı yönetimi'),
  ('sports.moderate', 'Maç sohbeti, yorumları, anketleri ve taraftar medyasını yönetme'),
  ('sports.notify',   'Maç bildirimlerini, duyuruları ve test bildirimlerini yönetme')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'sports.view'), ('admin', 'sports.manage'), ('admin', 'sports.data'),
  ('admin', 'sports.moderate'), ('admin', 'sports.notify'),
  ('moderator', 'sports.view'), ('moderator', 'sports.moderate'),
  ('support_agent', 'sports.view'),
  ('analyst', 'sports.view'),
  ('security_officer', 'sports.view')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Bildirim türü
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'follow', 'like', 'comment', 'message', 'group_invite', 'order', 'market_message',
  'support', 'security', 'system', 'mention', 'ride', 'news', 'live_news',
  'live_news_verified', 'live_news_moderation', 'pharmacy', 'earthquake', 'sports'
));

-- ---------------------------------------------------------------------------
-- 3. Ayarlar (tek satır)
-- ---------------------------------------------------------------------------
create table if not exists public.sports_settings (
  id                                  smallint primary key default 1 check (id = 1),
  provider                            text not null default 'api-football',
  api_base_url                        text not null default 'https://v3.football.api-sports.io',
  team_search                         text not null default 'Trabzonspor',
  team_id                             bigint,
  team_verified_at                    timestamptz,
  team_verified_by                    uuid references public.profiles (id) on delete set null,
  team_candidates                     jsonb not null default '[]'::jsonb,
  season                              integer,
  season_auto                         boolean not null default true,
  sync_enabled                        boolean not null default true,
  live_interval_seconds               integer not null default 30 check (live_interval_seconds between 15 and 300),
  stats_interval_seconds              integer not null default 60 check (stats_interval_seconds between 30 and 600),
  prematch_interval_seconds           integer not null default 300 check (prematch_interval_seconds between 60 and 3600),
  schedule_interval_minutes           integer not null default 360 check (schedule_interval_minutes between 30 and 1440),
  matchday_schedule_interval_minutes  integer not null default 30 check (matchday_schedule_interval_minutes between 10 and 240),
  standings_interval_minutes          integer not null default 360 check (standings_interval_minutes between 30 and 1440),
  leagues_interval_hours              integer not null default 24 check (leagues_interval_hours between 6 and 168),
  squad_interval_hours                integer not null default 24 check (squad_interval_hours between 6 and 168),
  daily_request_budget                integer check (daily_request_budget is null or daily_request_budget > 0),
  request_reserve                     integer not null default 20 check (request_reserve >= 0),
  api_plan                            text,
  api_account                         jsonb not null default '{}'::jsonb,
  api_limit_day                       integer,
  api_remaining_day                   integer,
  api_quota_at                        timestamptz,
  api_key_present                     boolean not null default false,
  health                              text not null default 'unconfigured'
                                      check (health in ('unconfigured', 'ok', 'degraded', 'down', 'quota')),
  last_error                          text,
  last_error_at                       timestamptz,
  consecutive_failures                integer not null default 0,
  worker_url                          text,
  worker_lock_until                   timestamptz,
  last_tick_at                        timestamptz,
  last_live_sync_at                   timestamptz,
  last_prematch_sync_at               timestamptz,
  last_schedule_sync_at               timestamptz,
  last_standings_sync_at              timestamptz,
  last_leagues_sync_at                timestamptz,
  last_squad_sync_at                  timestamptz,
  last_teamstats_sync_at              timestamptz,
  last_status_check_at                timestamptz,
  last_verify_sync_at                 timestamptz,
  -- Feed kartı
  feed_card_enabled                   boolean not null default true,
  feed_prematch_minutes               integer not null default 60 check (feed_prematch_minutes between 10 and 1440),
  feed_postmatch_minutes              integer not null default 180 check (feed_postmatch_minutes between 15 and 2880),
  feed_default_view                   text not null default 'compact' check (feed_default_view in ('compact', 'expanded')),
  feed_show_chat_count                boolean not null default true,
  feed_show_stats                     boolean not null default true,
  feed_allow_hide                     boolean not null default true,
  feed_show_archive                   boolean not null default true,
  -- Görsel hakları: varsayılan kapalı; operatör kullanım hakkını doğruladıktan sonra açar.
  logos_enabled                       boolean not null default false,
  player_photos_enabled               boolean not null default false,
  rights_note                         text,
  -- Sohbet
  chat_enabled                        boolean not null default true,
  chat_max_length                     integer not null default 280 check (chat_max_length between 40 and 1000),
  chat_rate_per_minute                integer not null default 8 check (chat_rate_per_minute between 1 and 60),
  chat_duplicate_window_seconds       integer not null default 90 check (chat_duplicate_window_seconds between 0 and 3600),
  chat_links_allowed                  boolean not null default false,
  chat_blocked_terms                  text[] not null default '{}',
  chat_open_before_minutes            integer not null default 120 check (chat_open_before_minutes between 0 and 2880),
  chat_close_after_minutes            integer not null default 240 check (chat_close_after_minutes between 0 and 10080),
  chat_retention_days                 integer not null default 120 check (chat_retention_days between 7 and 3650),
  comments_enabled                    boolean not null default true,
  auto_polls_enabled                  boolean not null default true,
  notifications_enabled               boolean not null default true,
  reminder_minutes                    integer not null default 60 check (reminder_minutes between 5 and 1440),
  updated_at                          timestamptz not null default now(),
  updated_by                          uuid references public.profiles (id) on delete set null
);

insert into public.sports_settings (id, worker_url)
select 1, (select worker_url from public.earthquake_settings where id = 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Takımlar, turnuvalar, kadro
-- ---------------------------------------------------------------------------
create table if not exists public.sports_teams (
  id          bigint primary key,
  name        text not null,
  code        text,
  country     text,
  logo_url    text,
  founded     integer,
  national    boolean not null default false,
  venue       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists public.sports_competitions (
  league_id       bigint not null,
  season          integer not null,
  name            text not null,
  type            text,
  country         text,
  logo_url        text,
  is_current      boolean not null default false,
  start_date      date,
  end_date        date,
  coverage        jsonb not null default '{}'::jsonb,
  is_enabled      boolean not null default true,
  priority        integer not null default 100,
  last_synced_at  timestamptz not null default now(),
  primary key (league_id, season)
);

create table if not exists public.sports_squads (
  team_id     bigint not null,
  player_id   bigint not null,
  name        text not null,
  age         integer,
  number      integer,
  position    text,
  photo_url   text,
  updated_at  timestamptz not null default now(),
  primary key (team_id, player_id)
);

create table if not exists public.sports_standings (
  league_id     bigint not null,
  season        integer not null,
  group_name    text not null default '',
  team_id       bigint not null,
  rank          integer,
  team_name     text not null,
  team_logo     text,
  points        integer,
  goals_diff    integer,
  form          text,
  status        text,
  description   text,
  all_stats     jsonb not null default '{}'::jsonb,
  home_stats    jsonb not null default '{}'::jsonb,
  away_stats    jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  synced_at     timestamptz not null default now(),
  primary key (league_id, season, group_name, team_id)
);

create table if not exists public.sports_team_statistics (
  league_id  bigint not null,
  season     integer not null,
  team_id    bigint not null,
  data       jsonb not null,
  synced_at  timestamptz not null default now(),
  primary key (league_id, season, team_id)
);

-- ---------------------------------------------------------------------------
-- 5. Maçlar (kanonik kayıt)
-- ---------------------------------------------------------------------------
create table if not exists public.sports_fixtures (
  id                    bigint primary key,
  uid                   uuid not null unique default gen_random_uuid(),
  is_test               boolean not null default false,
  league_id             bigint,
  season                integer,
  league_name           text,
  league_type           text,
  league_country        text,
  league_logo           text,
  round                 text,
  kickoff_at            timestamptz not null,
  source_timezone       text,
  venue_name            text,
  venue_city            text,
  referee               text,
  status_short          text not null default 'NS',
  status_long           text,
  elapsed               integer,
  status_extra          integer,
  phase                 text not null default 'scheduled',
  primary_side          text check (primary_side in ('home', 'away')),
  home_team_id          bigint,
  home_name             text not null,
  home_logo             text,
  away_team_id          bigint,
  away_name             text not null,
  away_logo             text,
  goals_home            integer,
  goals_away            integer,
  ht_home               integer,
  ht_away               integer,
  ft_home               integer,
  ft_away               integer,
  et_home               integer,
  et_away               integer,
  pen_home              integer,
  pen_away              integer,
  live_started_at       timestamptz,
  finished_seen_at      timestamptz,
  final_verified_at     timestamptz,
  lineups_available_at  timestamptz,
  fixture_synced_at     timestamptz,
  events_synced_at      timestamptz,
  stats_synced_at       timestamptz,
  lineups_synced_at     timestamptz,
  players_synced_at     timestamptz,
  sync_signature        text,
  sync_failures         integer not null default 0,
  last_sync_error       text,
  feature_state         text not null default 'auto' check (feature_state in ('auto', 'pinned', 'suppressed')),
  feature_reason        text,
  hidden                boolean not null default false,
  hidden_reason         text,
  chat_state            text not null default 'auto' check (chat_state in ('auto', 'open', 'paused', 'closed')),
  chat_slow_mode_seconds integer not null default 0 check (chat_slow_mode_seconds between 0 and 600),
  chat_pinned           jsonb,
  comments_locked       boolean not null default false,
  test_created_by       uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint sports_fixtures_test_id check ((is_test and id < 0) or (not is_test and id > 0))
);

create index if not exists sports_fixtures_kickoff_idx on public.sports_fixtures (kickoff_at desc);
create index if not exists sports_fixtures_phase_idx on public.sports_fixtures (phase, kickoff_at);
create index if not exists sports_fixtures_league_idx on public.sports_fixtures (league_id, season, kickoff_at);

create table if not exists public.sports_fixture_status_log (
  id           bigint generated always as identity primary key,
  fixture_id   bigint not null references public.sports_fixtures (id) on delete cascade,
  status_short text not null,
  elapsed      integer,
  observed_at  timestamptz not null default now(),
  unique (fixture_id, status_short)
);

create table if not exists public.sports_fixture_events (
  id             uuid primary key default gen_random_uuid(),
  fixture_id     bigint not null references public.sports_fixtures (id) on delete cascade,
  event_key      text not null,
  kind           text not null,
  type_raw       text,
  detail_raw     text,
  comments       text,
  minute         integer,
  extra          integer,
  team_id        bigint,
  team_name      text,
  player_id      bigint,
  player_name    text,
  assist_id      bigint,
  assist_name    text,
  sort_index     integer not null default 0,
  status         text not null default 'active' check (status in ('active', 'retracted', 'hidden')),
  hidden_reason  text,
  missing_count  integer not null default 0,
  revision       integer not null default 1,
  revisions      jsonb not null default '[]'::jsonb,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  retracted_at   timestamptz,
  unique (fixture_id, event_key)
);
create index if not exists sports_fixture_events_fixture_idx on public.sports_fixture_events (fixture_id, status, minute);

create table if not exists public.sports_fixture_statistics (
  fixture_id  bigint not null references public.sports_fixtures (id) on delete cascade,
  team_id     bigint not null,
  stats       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (fixture_id, team_id)
);

create table if not exists public.sports_fixture_stat_snapshots (
  id            bigint generated always as identity primary key,
  fixture_id    bigint not null references public.sports_fixtures (id) on delete cascade,
  captured_at   timestamptz not null default now(),
  elapsed       integer,
  status_short  text,
  home          jsonb not null default '{}'::jsonb,
  away          jsonb not null default '{}'::jsonb
);
create index if not exists sports_fixture_stat_snapshots_idx on public.sports_fixture_stat_snapshots (fixture_id, captured_at);

create table if not exists public.sports_fixture_lineups (
  fixture_id    bigint not null references public.sports_fixtures (id) on delete cascade,
  team_id       bigint not null,
  team_name     text,
  formation     text,
  coach         jsonb not null default '{}'::jsonb,
  start_xi      jsonb not null default '[]'::jsonb,
  substitutes   jsonb not null default '[]'::jsonb,
  colors        jsonb,
  is_predicted  boolean not null default false,
  source        text not null default 'API-Football',
  updated_at    timestamptz not null default now(),
  primary key (fixture_id, team_id)
);

create table if not exists public.sports_fixture_players (
  fixture_id  bigint not null references public.sports_fixtures (id) on delete cascade,
  player_id   bigint not null,
  team_id     bigint not null,
  name        text not null,
  photo_url   text,
  number      integer,
  position    text,
  minutes     integer,
  rating      numeric(4,2),
  captain     boolean not null default false,
  substitute  boolean not null default false,
  stats       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (fixture_id, player_id)
);

-- ---------------------------------------------------------------------------
-- 6. Operasyon: API kullanımı, senkron kayıtları, denetim
-- ---------------------------------------------------------------------------
create table if not exists public.sports_api_usage (
  day        date not null,
  endpoint   text not null,
  requests   integer not null default 0,
  failures   integer not null default 0,
  last_at    timestamptz not null default now(),
  primary key (day, endpoint)
);

create table if not exists public.sports_sync_logs (
  id           bigint generated always as identity primary key,
  run_id       uuid,
  trigger      text,
  job          text not null,
  endpoint     text,
  params       jsonb not null default '{}'::jsonb,
  status       text not null check (status in ('ok', 'error', 'skipped', 'quota')),
  http_status  integer,
  results      integer,
  duration_ms  integer,
  remaining    integer,
  error        text,
  api_errors   jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists sports_sync_logs_created_idx on public.sports_sync_logs (created_at desc);

create table if not exists public.sports_admin_audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  target_type  text,
  target_id    text,
  reason       text,
  before_data  jsonb,
  after_data   jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists sports_admin_audit_logs_created_idx on public.sports_admin_audit_logs (created_at desc);

-- Bildirim olayları ingest tarafından kuyruklanır; dağıtım 0197'de.
create table if not exists public.sports_notification_events (
  id                 uuid primary key default gen_random_uuid(),
  fixture_id         bigint references public.sports_fixtures (id) on delete cascade,
  type               text not null check (type in (
                       'reminder', 'lineups', 'kickoff', 'goal_for', 'goal_against', 'red_card',
                       'half_time', 'full_time', 'postponed', 'announcement', 'correction', 'test')),
  dedupe_key         text not null,
  title              text not null,
  body               text not null,
  payload            jsonb not null default '{}'::jsonb,
  is_test            boolean not null default false,
  created_by         uuid references public.profiles (id) on delete set null,
  processing_status  text not null default 'pending'
                     check (processing_status in ('pending', 'fanning_out', 'done', 'cancelled', 'failed')),
  fanout_cursor      uuid,
  recipients         integer not null default 0,
  last_error         text,
  created_at         timestamptz not null default now(),
  processed_at       timestamptz
);
create unique index if not exists sports_notification_events_dedupe_idx
  on public.sports_notification_events (coalesce(fixture_id, 0), dedupe_key);
create index if not exists sports_notification_events_pending_idx
  on public.sports_notification_events (processing_status, created_at)
  where processing_status in ('pending', 'fanning_out');

do $$
declare
  t text;
begin
  foreach t in array array[
    'sports_settings', 'sports_teams', 'sports_competitions', 'sports_squads', 'sports_standings',
    'sports_team_statistics', 'sports_fixtures', 'sports_fixture_status_log', 'sports_fixture_events',
    'sports_fixture_statistics', 'sports_fixture_stat_snapshots', 'sports_fixture_lineups',
    'sports_fixture_players', 'sports_api_usage', 'sports_sync_logs', 'sports_admin_audit_logs',
    'sports_notification_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Normalizasyon yardımcıları
-- ---------------------------------------------------------------------------
create or replace function public.sports_int(p text)
returns integer
language sql
immutable
as $$
  select case when p ~ '^\s*-?\d{1,9}\s*$' then trim(p)::integer end
$$;

create or replace function public.sports_bigint(p text)
returns bigint
language sql
immutable
as $$
  select case when p ~ '^\s*-?\d{1,18}\s*$' then trim(p)::bigint end
$$;

-- "55%", "1.23", 7 → sayı; null / boş / tanımsız → null (0'a çevrilmez).
create or replace function public.sports_num(p jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when p is null or jsonb_typeof(p) = 'null' then null
    when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
    when jsonb_typeof(p) = 'string' and replace(trim(p #>> '{}'), '%', '') ~ '^-?\d+(\.\d+)?$'
      then replace(trim(p #>> '{}'), '%', '')::numeric
    else null
  end
$$;

create or replace function public.sports_phase(p_short text)
returns text
language sql
immutable
as $$
  select case upper(coalesce(p_short, ''))
    when 'TBD' then 'scheduled'
    when 'NS' then 'scheduled'
    when '1H' then 'first_half'
    when 'HT' then 'half_time'
    when '2H' then 'second_half'
    when 'ET' then 'extra_time'
    when 'BT' then 'break_time'
    when 'P' then 'penalties'
    when 'SUSP' then 'suspended'
    when 'INT' then 'interrupted'
    when 'LIVE' then 'live'
    when 'FT' then 'finished'
    when 'AET' then 'finished_aet'
    when 'PEN' then 'finished_pen'
    when 'PST' then 'postponed'
    when 'CANC' then 'cancelled'
    when 'ABD' then 'abandoned'
    when 'AWD' then 'awarded'
    when 'WO' then 'walkover'
    else 'unknown'
  end
$$;

create or replace function public.sports_phase_is_live(p_phase text)
returns boolean
language sql
immutable
as $$
  select p_phase in ('first_half', 'half_time', 'second_half', 'extra_time', 'break_time',
                     'penalties', 'suspended', 'interrupted', 'live')
$$;

create or replace function public.sports_phase_is_finished(p_phase text)
returns boolean
language sql
immutable
as $$
  select p_phase in ('finished', 'finished_aet', 'finished_pen', 'awarded', 'walkover')
$$;

create or replace function public.sports_event_kind(p_type text, p_detail text, p_comments text)
returns text
language sql
immutable
as $$
  select case
    when lower(p_type) = 'goal' and coalesce(p_comments, '') ilike '%shootout%'
      then case when lower(coalesce(p_detail, '')) like '%missed%' then 'shootout_miss' else 'shootout_goal' end
    when lower(p_type) = 'goal' and lower(p_detail) = 'own goal' then 'own_goal'
    when lower(p_type) = 'goal' and lower(p_detail) = 'penalty' then 'penalty_goal'
    when lower(p_type) = 'goal' and lower(p_detail) like 'missed penalty%' then 'missed_penalty'
    when lower(p_type) = 'goal' then 'goal'
    when lower(p_type) = 'card' and lower(p_detail) like 'second yellow%' then 'second_yellow'
    when lower(p_type) = 'card' and lower(p_detail) like 'red%' then 'red'
    when lower(p_type) = 'card' and lower(p_detail) like 'yellow%' then 'yellow'
    when lower(p_type) in ('subst', 'substitution') then 'substitution'
    when lower(p_type) = 'var' then 'var'
    else 'other'
  end
$$;

create or replace function public.sports_event_family(p_kind text)
returns text
language sql
immutable
as $$
  select case
    when p_kind in ('goal', 'own_goal', 'penalty_goal') then 'goal'
    when p_kind in ('yellow', 'red', 'second_yellow') then 'card'
    else p_kind
  end
$$;

create or replace function public.sports_stat_key(p_type text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_type, '')))
    when 'shots on goal' then 'shots_on_goal'
    when 'shots off goal' then 'shots_off_goal'
    when 'total shots' then 'total_shots'
    when 'blocked shots' then 'blocked_shots'
    when 'shots insidebox' then 'shots_insidebox'
    when 'shots outsidebox' then 'shots_outsidebox'
    when 'fouls' then 'fouls'
    when 'corner kicks' then 'corner_kicks'
    when 'offsides' then 'offsides'
    when 'ball possession' then 'ball_possession'
    when 'yellow cards' then 'yellow_cards'
    when 'red cards' then 'red_cards'
    when 'goalkeeper saves' then 'goalkeeper_saves'
    when 'total passes' then 'total_passes'
    when 'passes accurate' then 'passes_accurate'
    when 'passes %' then 'passes_pct'
    when 'expected_goals' then 'expected_goals'
    when 'goals_prevented' then 'goals_prevented'
    else null
  end
$$;

-- API olay dizisini kararlı anahtarlı satırlara çevirir.
create or replace function public.sports_events_normalize(p_events jsonb)
returns table (
  ord integer, event_key text, kind text, family text, type_raw text, detail_raw text, comments text,
  minute integer, extra integer, team_id bigint, team_name text, player_id bigint, player_name text,
  assist_id bigint, assist_name text
)
language sql
immutable
as $$
  with src as (
    select t.ord::integer as ord,
           public.sports_event_kind(t.e ->> 'type', t.e ->> 'detail', t.e ->> 'comments') as kind,
           left(t.e ->> 'type', 40) as type_raw,
           left(t.e ->> 'detail', 80) as detail_raw,
           left(t.e ->> 'comments', 160) as comments,
           public.sports_int(t.e #>> '{time,elapsed}') as minute,
           public.sports_int(t.e #>> '{time,extra}') as extra,
           public.sports_bigint(t.e #>> '{team,id}') as team_id,
           left(t.e #>> '{team,name}', 120) as team_name,
           public.sports_bigint(t.e #>> '{player,id}') as player_id,
           left(t.e #>> '{player,name}', 120) as player_name,
           public.sports_bigint(t.e #>> '{assist,id}') as assist_id,
           left(t.e #>> '{assist,name}', 120) as assist_name
      from jsonb_array_elements(case when jsonb_typeof(p_events) = 'array' then p_events else '[]'::jsonb end)
           with ordinality as t(e, ord)
  ), keyed as (
    select src.*,
           src.kind || ':' || coalesce(src.team_id::text, '0') || ':' ||
             coalesce(src.player_id::text,
                      nullif(lower(regexp_replace(coalesce(src.player_name, ''), '[^[:alnum:]]', '', 'g')), ''),
                      '-') || ':' ||
             coalesce(src.minute::text, 'x') || ':' || coalesce(src.extra, 0)::text as base
      from src
  )
  select k.ord,
         k.base || '#' || row_number() over (partition by k.base order by k.ord),
         k.kind, public.sports_event_family(k.kind), k.type_raw, k.detail_raw, k.comments,
         k.minute, k.extra, k.team_id, k.team_name, k.player_id, k.player_name, k.assist_id, k.assist_name
    from keyed k
$$;

create or replace function public.sports_stats_normalize(p_statistics jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(k.key, public.sports_num(k.value)), '{}'::jsonb)
    from (
      select public.sports_stat_key(s ->> 'type') as key, s -> 'value' as value
        from jsonb_array_elements(case when jsonb_typeof(p_statistics) = 'array' then p_statistics else '[]'::jsonb end) s
    ) k
   where k.key is not null
$$;

create or replace function public.sports_audit(
  p_actor uuid, p_action text, p_target_type text, p_target_id text,
  p_reason text default null, p_before jsonb default null, p_after jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sports_admin_audit_logs (actor_id, action, target_type, target_id, reason, before_data, after_data)
  values (p_actor, p_action, p_target_type, p_target_id, left(p_reason, 500), p_before, p_after);
  if p_actor is not null then
    begin
      perform public.tz_admin_audit('sports.' || p_action, 'Maç merkezi: ' || p_action, p_target_type,
                                    p_target_id, jsonb_build_object('reason', p_reason));
    exception when others then
      null;
    end;
  end if;
end;
$$;

create or replace function public.sports_require_reason(p_reason text)
returns text
language plpgsql
immutable
as $$
begin
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'sports_reason_required' using errcode = '22023';
  end if;
  return left(trim(p_reason), 500);
end;
$$;

-- Yalnızca sinyal yayınlanır; istemci ilgili sorguyu yeniden çeker.
create or replace function public.sports_broadcast(p_fixture bigint, p_kind text, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object('fixture_id', p_fixture, 'kind', p_kind, 'at', now()) || coalesce(p_extra, '{}'::jsonb),
    'update', 'sports-live', false
  );
exception when others then
  null;
end;
$$;

create or replace function public.sports_can_see_test()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.has_permission('sports.view')
$$;

create or replace function public.sports_score_line(f public.sports_fixtures)
returns text
language sql
immutable
as $$
  select f.home_name || ' ' || coalesce(f.goals_home::text, '-') || '-' || coalesce(f.goals_away::text, '-') || ' ' || f.away_name
$$;

create or replace function public.sports_queue_notification(
  p_fixture bigint, p_type text, p_key text, p_title text, p_body text,
  p_payload jsonb default '{}'::jsonb, p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_test boolean := false;
begin
  if p_fixture is not null then
    select is_test into v_test from public.sports_fixtures where id = p_fixture;
  end if;
  insert into public.sports_notification_events (fixture_id, type, dedupe_key, title, body, payload, is_test, created_by)
  values (p_fixture, p_type, p_key,
          left(case when coalesce(v_test, false) then '[TEST] ' else '' end || p_title, 120),
          left(p_body, 300), coalesce(p_payload, '{}'::jsonb), coalesce(v_test, false), p_created_by)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- 0196'da anket/oda yaşam döngüsü ile yeniden tanımlanır.
create or replace function public.sports_lifecycle_hook(p_fixture bigint, p_old_phase text, p_new_phase text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  return;
end;
$$;

-- 0196'da sohbet tabloları ile yeniden tanımlanır.
create or replace function public.sports_chat_summary(p_fixture bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('state', 'closed', 'active_users', 0, 'messages', 0)
$$;

-- ---------------------------------------------------------------------------
-- 8. JSON görünümleri
-- ---------------------------------------------------------------------------
create or replace function public.sports_fixture_json(p_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', f.id,
    'uid', f.uid,
    'is_test', f.is_test,
    'league', jsonb_build_object('id', f.league_id, 'name', f.league_name, 'type', f.league_type,
                                 'country', f.league_country, 'season', f.season, 'round', f.round,
                                 'logo', case when s.logos_enabled then f.league_logo end),
    'kickoff_at', f.kickoff_at,
    'venue', jsonb_build_object('name', f.venue_name, 'city', f.venue_city),
    'referee', f.referee,
    'status', jsonb_build_object('short', f.status_short, 'long', f.status_long, 'elapsed', f.elapsed,
                                 'extra', f.status_extra, 'phase', f.phase,
                                 'is_live', public.sports_phase_is_live(f.phase),
                                 'is_finished', public.sports_phase_is_finished(f.phase)),
    'primary_side', f.primary_side,
    'home', jsonb_build_object('id', f.home_team_id, 'name', f.home_name,
                               'logo', case when s.logos_enabled then f.home_logo end),
    'away', jsonb_build_object('id', f.away_team_id, 'name', f.away_name,
                               'logo', case when s.logos_enabled then f.away_logo end),
    'goals', jsonb_build_object('home', f.goals_home, 'away', f.goals_away),
    'score', jsonb_build_object(
      'halftime', jsonb_build_object('home', f.ht_home, 'away', f.ht_away),
      'fulltime', jsonb_build_object('home', f.ft_home, 'away', f.ft_away),
      'extratime', jsonb_build_object('home', f.et_home, 'away', f.et_away),
      'penalty', jsonb_build_object('home', f.pen_home, 'away', f.pen_away)),
    'lineups_available', f.lineups_available_at is not null,
    'synced', jsonb_build_object('fixture', f.fixture_synced_at, 'events', f.events_synced_at,
                                 'stats', f.stats_synced_at, 'lineups', f.lineups_synced_at,
                                 'players', f.players_synced_at),
    'data_age_seconds', case when f.fixture_synced_at is null then null
                             else extract(epoch from now() - f.fixture_synced_at)::integer end,
    'live_started_at', f.live_started_at,
    'finished_at', f.finished_seen_at,
    'final_verified', f.final_verified_at is not null,
    'chat_state', f.chat_state,
    'comments_locked', f.comments_locked
  )
  from public.sports_fixtures f
  cross join public.sports_settings s
  where f.id = p_id and s.id = 1
$$;

create or replace function public.sports_event_json(e public.sports_fixture_events)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'type', e.type_raw, 'detail', e.detail_raw, 'comments', e.comments,
    'minute', e.minute, 'extra', e.extra, 'team_id', e.team_id, 'team_name', e.team_name,
    'player_id', e.player_id, 'player_name', e.player_name,
    'assist_id', e.assist_id, 'assist_name', e.assist_name,
    'revision', e.revision, 'first_seen_at', e.first_seen_at)
$$;

create or replace function public.sports_last_key_event(p_fixture bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.sports_event_json(e)
    from public.sports_fixture_events e
   where e.fixture_id = p_fixture and e.status = 'active'
     and e.kind in ('goal', 'own_goal', 'penalty_goal', 'missed_penalty', 'red', 'second_yellow', 'var')
   order by coalesce(e.minute, 0) desc, coalesce(e.extra, 0) desc, e.sort_index desc
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 9. Ingest
-- ---------------------------------------------------------------------------
create or replace function public.sports_ingest_fixture(p_item jsonb, p_run jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.sports_settings;
  v_prev public.sports_fixtures;
  f public.sports_fixtures;
  v_id bigint := public.sports_bigint(p_item #>> '{fixture,id}');
  v_kind text := coalesce(p_run ->> 'kind', 'live');
  v_is_test boolean := coalesce((p_run ->> 'is_test')::boolean, false);
  v_actor uuid := nullif(p_run ->> 'actor', '')::uuid;
  v_exists boolean;
  v_short text := upper(coalesce(nullif(p_item #>> '{fixture,status,short}', ''), 'NS'));
  v_phase text;
  v_home bigint := public.sports_bigint(p_item #>> '{teams,home,id}');
  v_away bigint := public.sports_bigint(p_item #>> '{teams,away,id}');
  v_side text;
  v_kickoff timestamptz;
  v_has_events boolean := jsonb_typeof(p_item -> 'events') = 'array';
  v_has_stats boolean := jsonb_typeof(p_item -> 'statistics') = 'array';
  v_has_lineups boolean := jsonb_typeof(p_item -> 'lineups') = 'array';
  v_has_players boolean := jsonb_typeof(p_item -> 'players') = 'array';
  v_keys text[];
  v_matched uuid[] := '{}';
  r record;
  v_eid uuid;
  v_old_ev public.sports_fixture_events;
  v_new_reds uuid[] := '{}';
  v_retracted uuid[] := '{}';
  v_stats_changed boolean := false;
  v_notifiable boolean;
  v_for_old integer; v_for_new integer; v_ag_old integer; v_ag_new integer;
  v_n integer;
  v_rev integer;
  v_scorer jsonb;
  v_queued integer := 0;
  v_sig text;
  v_home_stats jsonb; v_away_stats jsonb;
  v_last_snap public.sports_fixture_stat_snapshots;
  v_primary_team bigint;
  v_route text;
begin
  if v_id is null or v_id = 0 then
    raise exception 'sports_invalid_payload' using errcode = '22023';
  end if;
  if v_is_test <> (v_id < 0) then
    raise exception 'sports_invalid_payload' using errcode = '22023';
  end if;

  begin
    v_kickoff := coalesce(
      to_timestamp(public.sports_bigint(p_item #>> '{fixture,timestamp}')),
      (p_item #>> '{fixture,date}')::timestamptz);
  exception when others then
    v_kickoff := null;
  end;
  if v_kickoff is null then
    raise exception 'sports_invalid_payload' using errcode = '22023';
  end if;
  if coalesce(p_item #>> '{teams,home,name}', '') = '' or coalesce(p_item #>> '{teams,away,name}', '') = '' then
    raise exception 'sports_invalid_payload' using errcode = '22023';
  end if;

  select * into s from public.sports_settings where id = 1;

  if v_is_test then
    v_side := coalesce(p_run ->> 'primary_side', 'home');
  else
    if s.team_id is null then
      raise exception 'sports_team_not_configured' using errcode = '22023';
    end if;
    v_side := case when v_home = s.team_id then 'home' when v_away = s.team_id then 'away' end;
    if v_side is null then
      return jsonb_build_object('fixture_id', v_id, 'skipped', 'not_primary_team');
    end if;
  end if;
  v_primary_team := case when v_side = 'home' then v_home else v_away end;

  select * into v_prev from public.sports_fixtures where id = v_id for update;
  v_exists := found;
  v_phase := public.sports_phase(v_short);
  v_route := '/trabzonspor/mac/' || v_id::text;

  insert into public.sports_fixtures as t (
    id, is_test, league_id, season, league_name, league_type, league_country, league_logo, round,
    kickoff_at, source_timezone, venue_name, venue_city, referee,
    status_short, status_long, elapsed, status_extra, phase, primary_side,
    home_team_id, home_name, home_logo, away_team_id, away_name, away_logo,
    goals_home, goals_away, ht_home, ht_away, ft_home, ft_away, et_home, et_away, pen_home, pen_away,
    live_started_at, finished_seen_at, fixture_synced_at, test_created_by, updated_at
  ) values (
    v_id, v_is_test,
    public.sports_bigint(p_item #>> '{league,id}'), public.sports_int(p_item #>> '{league,season}'),
    left(p_item #>> '{league,name}', 120), left(p_item #>> '{league,type}', 20),
    left(p_item #>> '{league,country}', 80), left(p_item #>> '{league,logo}', 300),
    left(p_item #>> '{league,round}', 120),
    v_kickoff, left(p_item #>> '{fixture,timezone}', 60),
    left(p_item #>> '{fixture,venue,name}', 160), left(p_item #>> '{fixture,venue,city}', 120),
    left(p_item #>> '{fixture,referee}', 160),
    v_short, left(p_item #>> '{fixture,status,long}', 80),
    public.sports_int(p_item #>> '{fixture,status,elapsed}'), public.sports_int(p_item #>> '{fixture,status,extra}'),
    v_phase, v_side,
    v_home, left(p_item #>> '{teams,home,name}', 120), left(p_item #>> '{teams,home,logo}', 300),
    v_away, left(p_item #>> '{teams,away,name}', 120), left(p_item #>> '{teams,away,logo}', 300),
    public.sports_int(p_item #>> '{goals,home}'), public.sports_int(p_item #>> '{goals,away}'),
    public.sports_int(p_item #>> '{score,halftime,home}'), public.sports_int(p_item #>> '{score,halftime,away}'),
    public.sports_int(p_item #>> '{score,fulltime,home}'), public.sports_int(p_item #>> '{score,fulltime,away}'),
    public.sports_int(p_item #>> '{score,extratime,home}'), public.sports_int(p_item #>> '{score,extratime,away}'),
    public.sports_int(p_item #>> '{score,penalty,home}'), public.sports_int(p_item #>> '{score,penalty,away}'),
    case when public.sports_phase_is_live(v_phase) then now() end,
    case when public.sports_phase_is_finished(v_phase) then now() end,
    now(),
    case when v_is_test then v_actor end,
    now()
  )
  on conflict (id) do update set
    league_id = excluded.league_id, season = excluded.season, league_name = excluded.league_name,
    league_type = coalesce(excluded.league_type, t.league_type), league_country = excluded.league_country,
    league_logo = excluded.league_logo, round = excluded.round,
    kickoff_at = excluded.kickoff_at, source_timezone = excluded.source_timezone,
    venue_name = excluded.venue_name, venue_city = excluded.venue_city, referee = excluded.referee,
    status_short = excluded.status_short, status_long = excluded.status_long,
    elapsed = excluded.elapsed, status_extra = excluded.status_extra, phase = excluded.phase,
    primary_side = excluded.primary_side,
    home_team_id = excluded.home_team_id, home_name = excluded.home_name, home_logo = excluded.home_logo,
    away_team_id = excluded.away_team_id, away_name = excluded.away_name, away_logo = excluded.away_logo,
    goals_home = excluded.goals_home, goals_away = excluded.goals_away,
    ht_home = excluded.ht_home, ht_away = excluded.ht_away, ft_home = excluded.ft_home, ft_away = excluded.ft_away,
    et_home = excluded.et_home, et_away = excluded.et_away, pen_home = excluded.pen_home, pen_away = excluded.pen_away,
    live_started_at = coalesce(t.live_started_at, excluded.live_started_at),
    finished_seen_at = case when public.sports_phase_is_finished(excluded.phase)
                            then coalesce(t.finished_seen_at, now()) else null end,
    final_verified_at = case when public.sports_phase_is_finished(excluded.phase) then t.final_verified_at end,
    fixture_synced_at = now(),
    sync_failures = 0,
    last_sync_error = null,
    updated_at = now()
  returning * into f;

  if not v_exists or v_prev.status_short is distinct from v_short then
    insert into public.sports_fixture_status_log (fixture_id, status_short, elapsed)
    values (v_id, v_short, f.elapsed)
    on conflict (fixture_id, status_short) do nothing;
  end if;

  -- Olaylar --------------------------------------------------------------
  if v_has_events then
    select coalesce(array_agg(n.event_key), '{}') into v_keys
      from public.sports_events_normalize(p_item -> 'events') n;

    for r in select * from public.sports_events_normalize(p_item -> 'events') loop
      select * into v_old_ev from public.sports_fixture_events e
       where e.fixture_id = v_id and e.event_key = r.event_key;

      if not found then
        -- Kaynak revizyonu: aynı aile + takım, ±5 dk, mevcut listede karşılığı olmayan olay.
        select * into v_old_ev from public.sports_fixture_events e
         where e.fixture_id = v_id and e.status = 'active'
           and public.sports_event_family(e.kind) = r.family
           and e.team_id is not distinct from r.team_id
           and abs(coalesce(e.minute, 0) - coalesce(r.minute, 0)) <= 5
           and not (e.event_key = any (v_keys))
           and not (e.id = any (v_matched))
         order by abs(coalesce(e.minute, 0) - coalesce(r.minute, 0)), e.sort_index
         limit 1;
        if found then
          update public.sports_fixture_events e set
            event_key = r.event_key, kind = r.kind, type_raw = r.type_raw, detail_raw = r.detail_raw,
            comments = r.comments, minute = r.minute, extra = r.extra, team_name = r.team_name,
            player_id = r.player_id, player_name = r.player_name, assist_id = r.assist_id, assist_name = r.assist_name,
            sort_index = r.ord, missing_count = 0, last_seen_at = now(), revision = e.revision + 1,
            revisions = (e.revisions || jsonb_build_array(jsonb_build_object(
              'at', now(), 'kind', e.kind, 'minute', e.minute, 'extra', e.extra,
              'player_name', e.player_name, 'assist_name', e.assist_name, 'detail', e.detail_raw))),
            retracted_at = null
          where e.id = v_old_ev.id;
          v_matched := v_matched || v_old_ev.id;
          if r.kind in ('red', 'second_yellow') and v_old_ev.kind not in ('red', 'second_yellow') then
            v_new_reds := v_new_reds || v_old_ev.id;
          end if;
        else
          insert into public.sports_fixture_events (
            fixture_id, event_key, kind, type_raw, detail_raw, comments, minute, extra, team_id, team_name,
            player_id, player_name, assist_id, assist_name, sort_index
          ) values (
            v_id, r.event_key, r.kind, r.type_raw, r.detail_raw, r.comments, r.minute, r.extra, r.team_id,
            r.team_name, r.player_id, r.player_name, r.assist_id, r.assist_name, r.ord
          ) returning id into v_eid;
          v_matched := v_matched || v_eid;
          if r.kind in ('red', 'second_yellow') then
            v_new_reds := v_new_reds || v_eid;
          end if;
        end if;
      else
        v_matched := v_matched || v_old_ev.id;
        if v_old_ev.status = 'hidden' then
          update public.sports_fixture_events set last_seen_at = now(), missing_count = 0 where id = v_old_ev.id;
        elsif (v_old_ev.player_name, v_old_ev.assist_id, v_old_ev.assist_name, v_old_ev.detail_raw, v_old_ev.comments,
               v_old_ev.team_name, v_old_ev.status)
              is distinct from (r.player_name, r.assist_id, r.assist_name, r.detail_raw, r.comments, r.team_name, 'active') then
          update public.sports_fixture_events e set
            player_name = r.player_name, assist_id = r.assist_id, assist_name = r.assist_name,
            detail_raw = r.detail_raw, comments = r.comments, team_name = r.team_name, sort_index = r.ord,
            status = 'active', retracted_at = null, missing_count = 0, last_seen_at = now(),
            revision = e.revision + 1,
            revisions = (e.revisions || jsonb_build_array(jsonb_build_object(
              'at', now(), 'status', e.status, 'player_name', e.player_name, 'assist_name', e.assist_name,
              'detail', e.detail_raw)))
          where e.id = v_old_ev.id;
        else
          update public.sports_fixture_events
             set last_seen_at = now(), missing_count = 0, sort_index = r.ord
           where id = v_old_ev.id;
        end if;
      end if;
    end loop;

    -- Kaynaktan kaybolanlar: iki ardışık senkronda yoksa geri çekilir.
    with miss as (
      update public.sports_fixture_events e
         set missing_count = e.missing_count + 1,
             status = case when e.missing_count + 1 >= 2 then 'retracted' else e.status end,
             retracted_at = case when e.missing_count + 1 >= 2 then now() else e.retracted_at end
       where e.fixture_id = v_id and e.status = 'active' and not (e.id = any (v_matched))
      returning e.id, e.status
    )
    select coalesce(array_agg(id) filter (where status = 'retracted'), '{}') into v_retracted from miss;

    update public.sports_fixtures set events_synced_at = now() where id = v_id;
  end if;

  -- İstatistikler ------------------------------------------------------------
  if v_has_stats and jsonb_array_length(p_item -> 'statistics') > 0 then
    for r in
      select public.sports_bigint(x #>> '{team,id}') as team_id,
             public.sports_stats_normalize(x -> 'statistics') as stats
        from jsonb_array_elements(p_item -> 'statistics') x
    loop
      continue when r.team_id is null;
      insert into public.sports_fixture_statistics as t (fixture_id, team_id, stats, updated_at)
      values (v_id, r.team_id, r.stats, now())
      on conflict (fixture_id, team_id) do update
        set stats = excluded.stats, updated_at = now()
      where t.stats is distinct from excluded.stats;
      if found then
        v_stats_changed := true;
      end if;
    end loop;
    update public.sports_fixtures set stats_synced_at = now() where id = v_id;

    select stats into v_home_stats from public.sports_fixture_statistics where fixture_id = v_id and team_id = f.home_team_id;
    select stats into v_away_stats from public.sports_fixture_statistics where fixture_id = v_id and team_id = f.away_team_id;
    if public.sports_phase_is_live(v_phase) or public.sports_phase_is_finished(v_phase) then
      select * into v_last_snap from public.sports_fixture_stat_snapshots
       where fixture_id = v_id order by captured_at desc limit 1;
      if (v_home_stats is not null or v_away_stats is not null)
         and (v_last_snap.id is null
              or ((v_last_snap.home, v_last_snap.away) is distinct from (coalesce(v_home_stats, '{}'), coalesce(v_away_stats, '{}'))
                  and v_last_snap.captured_at <= now() - make_interval(secs => greatest(s.stats_interval_seconds - 5, 25)))
              or v_last_snap.status_short is distinct from v_short) then
        insert into public.sports_fixture_stat_snapshots (fixture_id, elapsed, status_short, home, away)
        values (v_id, f.elapsed, v_short, coalesce(v_home_stats, '{}'), coalesce(v_away_stats, '{}'));
      end if;
    end if;
  end if;

  -- Kadrolar -------------------------------------------------------------
  if v_has_lineups and jsonb_array_length(p_item -> 'lineups') > 0 then
    insert into public.sports_fixture_lineups as t (
      fixture_id, team_id, team_name, formation, coach, start_xi, substitutes, colors, is_predicted, source, updated_at
    )
    select v_id, public.sports_bigint(x #>> '{team,id}'), left(x #>> '{team,name}', 120), left(x ->> 'formation', 20),
           jsonb_build_object('id', public.sports_bigint(x #>> '{coach,id}'), 'name', x #>> '{coach,name}',
                              'photo', x #>> '{coach,photo}'),
           coalesce((select jsonb_agg(jsonb_build_object(
                       'id', public.sports_bigint(p #>> '{player,id}'), 'name', p #>> '{player,name}',
                       'number', public.sports_int(p #>> '{player,number}'), 'pos', p #>> '{player,pos}',
                       'grid', p #>> '{player,grid}') order by o)
                       from jsonb_array_elements(coalesce(x -> 'startXI', '[]')) with ordinality as q(p, o)), '[]'),
           coalesce((select jsonb_agg(jsonb_build_object(
                       'id', public.sports_bigint(p #>> '{player,id}'), 'name', p #>> '{player,name}',
                       'number', public.sports_int(p #>> '{player,number}'), 'pos', p #>> '{player,pos}',
                       'grid', p #>> '{player,grid}') order by o)
                       from jsonb_array_elements(coalesce(x -> 'substitutes', '[]')) with ordinality as q(p, o)), '[]'),
           x #> '{team,colors}', false, 'API-Football', now()
      from jsonb_array_elements(p_item -> 'lineups') x
     where public.sports_bigint(x #>> '{team,id}') is not null
       and jsonb_array_length(coalesce(x -> 'startXI', '[]')) > 0
    on conflict (fixture_id, team_id) do update set
      team_name = excluded.team_name, formation = excluded.formation, coach = excluded.coach,
      start_xi = excluded.start_xi, substitutes = excluded.substitutes, colors = excluded.colors,
      is_predicted = false, source = excluded.source, updated_at = now();

    update public.sports_fixtures set lineups_synced_at = now() where id = v_id;
  end if;

  -- Oyuncu performansı ----------------------------------------------------
  if v_has_players and jsonb_array_length(p_item -> 'players') > 0 then
    insert into public.sports_fixture_players as t (
      fixture_id, player_id, team_id, name, photo_url, number, position, minutes, rating, captain, substitute, stats, updated_at
    )
    select v_id, public.sports_bigint(p #>> '{player,id}'), public.sports_bigint(x #>> '{team,id}'),
           left(p #>> '{player,name}', 120), left(p #>> '{player,photo}', 300),
           public.sports_int(p #>> '{statistics,0,games,number}'), left(p #>> '{statistics,0,games,position}', 10),
           public.sports_int(p #>> '{statistics,0,games,minutes}'),
           case when public.sports_num(p #> '{statistics,0,games,rating}') between 0 and 10
                then public.sports_num(p #> '{statistics,0,games,rating}') end,
           coalesce((p #>> '{statistics,0,games,captain}')::boolean, false),
           coalesce((p #>> '{statistics,0,games,substitute}')::boolean, false),
           coalesce(p #> '{statistics,0}', '{}'), now()
      from jsonb_array_elements(p_item -> 'players') x
      cross join lateral jsonb_array_elements(coalesce(x -> 'players', '[]')) p
     where public.sports_bigint(p #>> '{player,id}') is not null
       and public.sports_bigint(x #>> '{team,id}') is not null
       and coalesce(p #>> '{player,name}', '') <> ''
    on conflict (fixture_id, player_id) do update set
      team_id = excluded.team_id, name = excluded.name, photo_url = excluded.photo_url, number = excluded.number,
      position = excluded.position, minutes = excluded.minutes, rating = excluded.rating,
      captain = excluded.captain, substitute = excluded.substitute, stats = excluded.stats, updated_at = now()
    where (t.minutes, t.rating, t.stats) is distinct from (excluded.minutes, excluded.rating, excluded.stats);

    update public.sports_fixtures set players_synced_at = now() where id = v_id;
  end if;

  -- Kadro duyurusu zamanı
  if f.lineups_available_at is null and exists (
    select 1 from public.sports_fixture_lineups l
     where l.fixture_id = v_id and l.team_id = v_primary_team and not l.is_predicted
       and jsonb_array_length(l.start_xi) > 0
  ) then
    update public.sports_fixtures set lineups_available_at = now() where id = v_id;
  end if;

  select * into f from public.sports_fixtures where id = v_id;

  -- Bildirimler ------------------------------------------------------------
  -- Yalnızca daha önce görülmüş ve yakın zamanlı maçlar için; geriye dönük
  -- içe aktarımlar ve eski kayıtlar bildirim üretmez.
  v_notifiable := v_exists and v_kind <> 'backfill' and s.notifications_enabled
                  and f.kickoff_at > now() - interval '6 hours'
                  and not f.hidden;

  if v_notifiable then
    -- Kadrolar
    if v_prev.lineups_available_at is null and f.lineups_available_at is not null
       and f.phase = 'scheduled' and f.kickoff_at > now() - interval '30 minutes' then
      if public.sports_queue_notification(v_id, 'lineups', 'lineups', 'İlk 11''ler açıklandı',
           f.home_name || ' - ' || f.away_name || ' maçının kadroları açıklandı.',
           jsonb_build_object('route', v_route), v_actor) is not null then
        v_queued := v_queued + 1;
      end if;
    end if;

    -- Başlama
    if v_prev.phase = 'scheduled' and public.sports_phase_is_live(f.phase) then
      if public.sports_queue_notification(v_id, 'kickoff', 'kickoff', 'Maç başladı',
           f.home_name || ' - ' || f.away_name || coalesce(' · ' || f.league_name, ''),
           jsonb_build_object('route', v_route), v_actor) is not null then
        v_queued := v_queued + 1;
      end if;
    end if;

    -- Goller (skor artışından; her gol numarası tek bildirim)
    v_for_old := coalesce(case when v_side = 'home' then v_prev.goals_home else v_prev.goals_away end, 0);
    v_for_new := coalesce(case when v_side = 'home' then f.goals_home else f.goals_away end, 0);
    v_ag_old := coalesce(case when v_side = 'home' then v_prev.goals_away else v_prev.goals_home end, 0);
    v_ag_new := coalesce(case when v_side = 'home' then f.goals_away else f.goals_home end, 0);

    if public.sports_phase_is_live(f.phase) or public.sports_phase_is_finished(f.phase) then
      if v_for_new > v_for_old then
        for v_n in (v_for_old + 1)..v_for_new loop
          select count(*) into v_rev from public.sports_notification_events
           where fixture_id = v_id and dedupe_key like 'corr:goal:for:' || v_n || ':%';
          -- Golcü yalnızca olay listesi skorla birebir örtüşüyorsa eklenir (kendi kalesine
          -- gol varsa atama belirsizdir, isim uydurulmaz).
          v_scorer := null;
          if not exists (select 1 from public.sports_fixture_events e
                          where e.fixture_id = v_id and e.status = 'active' and e.kind = 'own_goal')
             and (select count(*) from public.sports_fixture_events e
                   where e.fixture_id = v_id and e.status = 'active'
                     and e.kind in ('goal', 'penalty_goal') and e.team_id = v_primary_team) = v_for_new then
            select jsonb_build_object('player', e.player_name, 'assist', e.assist_name, 'minute', e.minute,
                                      'extra', e.extra, 'kind', e.kind, 'event_id', e.id)
              into v_scorer
              from public.sports_fixture_events e
             where e.fixture_id = v_id and e.status = 'active'
               and e.kind in ('goal', 'penalty_goal') and e.team_id = v_primary_team
             order by coalesce(e.minute, 0), coalesce(e.extra, 0), e.sort_index
             offset greatest(v_n - 1, 0) limit 1;
          end if;
          if public.sports_queue_notification(v_id, 'goal_for', 'goal:for:' || v_n || ':' || v_rev,
               'GOL! ' || case when v_side = 'home' then f.home_name else f.away_name end,
               public.sports_score_line(f)
                 || coalesce(' · ' || (v_scorer ->> 'minute') || coalesce('+' || (v_scorer ->> 'extra'), '') || '''', '')
                 || coalesce(' · ' || (v_scorer ->> 'player'), '')
                 || coalesce(' (asist: ' || (v_scorer ->> 'assist') || ')', ''),
               jsonb_build_object('route', v_route, 'goal_no', v_n, 'scorer', v_scorer), v_actor) is not null then
            v_queued := v_queued + 1;
          end if;
        end loop;
      end if;
      if v_ag_new > v_ag_old then
        for v_n in (v_ag_old + 1)..v_ag_new loop
          select count(*) into v_rev from public.sports_notification_events
           where fixture_id = v_id and dedupe_key like 'corr:goal:against:' || v_n || ':%';
          if public.sports_queue_notification(v_id, 'goal_against', 'goal:against:' || v_n || ':' || v_rev,
               'Rakip gol attı', public.sports_score_line(f)
                 || coalesce(' · ' || f.elapsed::text || '''', ''),
               jsonb_build_object('route', v_route, 'goal_no', v_n), v_actor) is not null then
            v_queued := v_queued + 1;
          end if;
        end loop;
      end if;
    end if;

    -- Skor düşüşü: daha önce bildirilen gol için düzeltme
    if v_for_new < v_for_old then
      for v_n in (v_for_new + 1)..v_for_old loop
        select count(*) into v_rev from public.sports_notification_events
         where fixture_id = v_id and dedupe_key like 'corr:goal:for:' || v_n || ':%';
        if exists (select 1 from public.sports_notification_events
                    where fixture_id = v_id and dedupe_key = 'goal:for:' || v_n || ':' || v_rev) then
          if public.sports_queue_notification(v_id, 'correction', 'corr:goal:for:' || v_n || ':' || v_rev,
               'Düzeltme: gol geçersiz sayıldı', public.sports_score_line(f) || ' · Kaynak skoru güncelledi.',
               jsonb_build_object('route', v_route, 'goal_no', v_n), v_actor) is not null then
            v_queued := v_queued + 1;
          end if;
        end if;
      end loop;
    end if;
    if v_ag_new < v_ag_old then
      for v_n in (v_ag_new + 1)..v_ag_old loop
        select count(*) into v_rev from public.sports_notification_events
         where fixture_id = v_id and dedupe_key like 'corr:goal:against:' || v_n || ':%';
        if exists (select 1 from public.sports_notification_events
                    where fixture_id = v_id and dedupe_key = 'goal:against:' || v_n || ':' || v_rev) then
          if public.sports_queue_notification(v_id, 'correction', 'corr:goal:against:' || v_n || ':' || v_rev,
               'Düzeltme: rakip golü geçersiz sayıldı', public.sports_score_line(f) || ' · Kaynak skoru güncelledi.',
               jsonb_build_object('route', v_route, 'goal_no', v_n), v_actor) is not null then
            v_queued := v_queued + 1;
          end if;
        end if;
      end loop;
    end if;

    -- Kırmızı kartlar (olay kimliğine göre tek bildirim)
    if public.sports_phase_is_live(f.phase) then
      for r in select * from public.sports_fixture_events where id = any (v_new_reds) loop
        if public.sports_queue_notification(v_id, 'red_card', 'red:' || r.id::text,
             'Kırmızı kart' || coalesce(' · ' || r.team_name, ''),
             coalesce(r.player_name || ' · ', '') || coalesce(r.minute::text || ''' · ', '') || public.sports_score_line(f),
             jsonb_build_object('route', v_route, 'event_id', r.id), v_actor) is not null then
          v_queued := v_queued + 1;
        end if;
      end loop;
    end if;
    for r in select * from public.sports_fixture_events where id = any (v_retracted) and kind in ('red', 'second_yellow') loop
      if exists (select 1 from public.sports_notification_events where fixture_id = v_id and dedupe_key = 'red:' || r.id::text) then
        if public.sports_queue_notification(v_id, 'correction', 'corr:red:' || r.id::text,
             'Düzeltme: kırmızı kart kaldırıldı', coalesce(r.player_name || ' · ', '') || 'Kaynak olayı geri çekti.',
             jsonb_build_object('route', v_route, 'event_id', r.id), v_actor) is not null then
          v_queued := v_queued + 1;
        end if;
      end if;
    end loop;

    -- Devre arası / maç sonu / durum değişiklikleri
    if f.phase = 'half_time' and v_prev.phase is distinct from 'half_time' then
      if public.sports_queue_notification(v_id, 'half_time', 'ht', 'Devre arası',
           'İlk yarı: ' || public.sports_score_line(f), jsonb_build_object('route', v_route), v_actor) is not null then
        v_queued := v_queued + 1;
      end if;
    end if;
    if public.sports_phase_is_finished(f.phase) and not public.sports_phase_is_finished(v_prev.phase) then
      if public.sports_queue_notification(v_id, 'full_time', 'ft', 'Maç bitti',
           public.sports_score_line(f)
             || case when f.pen_home is not null then ' (Pen. ' || f.pen_home || '-' || coalesce(f.pen_away::text, '-') || ')' else '' end,
           jsonb_build_object('route', v_route), v_actor) is not null then
        v_queued := v_queued + 1;
      end if;
    end if;
    if f.phase in ('postponed', 'cancelled', 'abandoned', 'suspended', 'interrupted')
       and v_prev.phase is distinct from f.phase then
      if public.sports_queue_notification(v_id, 'postponed', 'status:' || f.status_short,
           case f.phase when 'postponed' then 'Maç ertelendi' when 'cancelled' then 'Maç iptal edildi'
                        when 'abandoned' then 'Maç yarıda kaldı' else 'Maç durduruldu' end,
           f.home_name || ' - ' || f.away_name || coalesce(' · ' || f.status_long, ''),
           jsonb_build_object('route', v_route), v_actor) is not null then
        v_queued := v_queued + 1;
      end if;
    end if;
  end if;

  if v_exists and v_prev.phase is distinct from f.phase then
    perform public.sports_lifecycle_hook(v_id, v_prev.phase, f.phase);
  elsif not v_exists then
    perform public.sports_lifecycle_hook(v_id, null, f.phase);
  end if;

  -- Değişiklik imzası: yalnızca görünür veri değiştiğinde yayın yapılır.
  select md5(concat_ws('|', f.status_short, f.elapsed, f.status_extra, f.goals_home, f.goals_away, f.pen_home, f.pen_away,
                       f.kickoff_at, f.lineups_available_at, v_stats_changed,
                       (select count(*) || ':' || coalesce(sum(revision), 0) || ':' || string_agg(status, '' order by id)
                          from public.sports_fixture_events where fixture_id = v_id),
                       (select max(updated_at) from public.sports_fixture_lineups where fixture_id = v_id),
                       (select max(updated_at) from public.sports_fixture_players where fixture_id = v_id)))
    into v_sig;
  if v_sig is distinct from v_prev.sync_signature then
    update public.sports_fixtures set sync_signature = v_sig where id = v_id;
    perform public.sports_broadcast(v_id, 'fixture');
  end if;

  return jsonb_build_object('fixture_id', v_id, 'phase', f.phase, 'changed', v_sig is distinct from v_prev.sync_signature,
                            'created', not v_exists, 'notifications', v_queued);
end;
$$;

create or replace function public.sports_ingest_fixtures(p_items jsonb, p_run jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_res jsonb;
  v_errors integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'sports_invalid_payload' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_res := public.sports_ingest_fixture(v_item, p_run);
    exception when others then
      v_errors := v_errors + 1;
      v_res := jsonb_build_object('fixture_id', v_item #>> '{fixture,id}', 'error', sqlerrm);
    end;
    v_out := v_out || jsonb_build_array(v_res);
  end loop;
  return jsonb_build_object('results', v_out, 'errors', v_errors);
end;
$$;

-- /fixtures isteği başarısız olduğunda maç bazında sayaç tutulur.
create or replace function public.sports_fixture_sync_failed(p_ids bigint[], p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sports_fixtures
     set sync_failures = sync_failures + 1, last_sync_error = left(p_error, 500)
   where id = any (p_ids);
$$;

create or replace function public.sports_ingest_team_candidates(p_response jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  v_candidates jsonb;
  v_exact jsonb;
  v_selected bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', public.sports_bigint(x #>> '{team,id}'), 'name', x #>> '{team,name}', 'code', x #>> '{team,code}',
           'country', x #>> '{team,country}', 'founded', public.sports_int(x #>> '{team,founded}'),
           'national', coalesce((x #>> '{team,national}')::boolean, false), 'logo', x #>> '{team,logo}',
           'venue', x #>> '{venue,name}', 'city', x #>> '{venue,city}')), '[]'::jsonb)
    into v_candidates
    from jsonb_array_elements(case when jsonb_typeof(p_response) = 'array' then p_response else '[]'::jsonb end) x
   where public.sports_bigint(x #>> '{team,id}') is not null;

  insert into public.sports_teams (id, name, code, country, logo_url, founded, national, venue, updated_at)
  select public.sports_bigint(x #>> '{team,id}'), x #>> '{team,name}', x #>> '{team,code}', x #>> '{team,country}',
         x #>> '{team,logo}', public.sports_int(x #>> '{team,founded}'),
         coalesce((x #>> '{team,national}')::boolean, false), coalesce(x -> 'venue', '{}'), now()
    from jsonb_array_elements(case when jsonb_typeof(p_response) = 'array' then p_response else '[]'::jsonb end) x
   where public.sports_bigint(x #>> '{team,id}') is not null and coalesce(x #>> '{team,name}', '') <> ''
  on conflict (id) do update set name = excluded.name, code = excluded.code, country = excluded.country,
    logo_url = excluded.logo_url, founded = excluded.founded, national = excluded.national, venue = excluded.venue,
    updated_at = now();

  select * into s from public.sports_settings where id = 1 for update;

  -- Otomatik seçim yalnızca tek ve kesin eşleşmede: ad = arama ifadesi, ülke Türkiye, milli takım değil.
  select jsonb_agg(c) into v_exact
    from jsonb_array_elements(v_candidates) c
   where lower(c ->> 'name') = lower(s.team_search) and c ->> 'country' = 'Turkey'
     and not coalesce((c ->> 'national')::boolean, false);

  update public.sports_settings set team_candidates = v_candidates, updated_at = now() where id = 1;

  if s.team_id is null and v_exact is not null and jsonb_array_length(v_exact) = 1 then
    v_selected := (v_exact -> 0 ->> 'id')::bigint;
    update public.sports_settings
       set team_id = v_selected, team_verified_at = now(), team_verified_by = p_actor
     where id = 1;
    perform public.sports_audit(p_actor, 'team_verified', 'team', v_selected::text,
                                'API /teams araması tek kesin eşleşme döndürdü', null, v_exact -> 0);
  end if;

  return jsonb_build_object('candidates', v_candidates, 'selected', v_selected,
                            'team_id', coalesce(v_selected, s.team_id));
end;
$$;

create or replace function public.sports_ingest_leagues(p_response jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  v_count integer := 0;
  v_season integer;
begin
  select * into s from public.sports_settings where id = 1;

  insert into public.sports_competitions as t (
    league_id, season, name, type, country, logo_url, is_current, start_date, end_date, coverage, priority, last_synced_at
  )
  select public.sports_bigint(x #>> '{league,id}'), public.sports_int(se ->> 'year'),
         x #>> '{league,name}', x #>> '{league,type}', x #>> '{country,name}', x #>> '{league,logo}',
         coalesce((se ->> 'current')::boolean, false),
         nullif(se ->> 'start', '')::date, nullif(se ->> 'end', '')::date,
         coalesce(se -> 'coverage', '{}'),
         case when x #>> '{league,type}' = 'League' and x #>> '{country,name}' = 'Turkey' then 10
              when x #>> '{country,name}' = 'Turkey' then 20 else 50 end,
         now()
    from jsonb_array_elements(case when jsonb_typeof(p_response) = 'array' then p_response else '[]'::jsonb end) x
    cross join lateral jsonb_array_elements(coalesce(x -> 'seasons', '[]')) se
   where public.sports_bigint(x #>> '{league,id}') is not null and public.sports_int(se ->> 'year') is not null
  on conflict (league_id, season) do update set
    name = excluded.name, type = excluded.type, country = excluded.country, logo_url = excluded.logo_url,
    is_current = excluded.is_current, start_date = excluded.start_date, end_date = excluded.end_date,
    coverage = excluded.coverage, last_synced_at = now();
  get diagnostics v_count = row_count;

  if s.season_auto then
    select c.season into v_season
      from public.sports_competitions c
     where c.is_current
     order by (c.type = 'League' and c.country = 'Turkey') desc, c.season desc
     limit 1;
    if v_season is not null then
      update public.sports_settings set season = v_season where id = 1 and season is distinct from v_season;
    end if;
  end if;

  update public.sports_settings set last_leagues_sync_at = now() where id = 1;
  return jsonb_build_object('competitions', v_count, 'season', coalesce(v_season, s.season));
end;
$$;

create or replace function public.sports_ingest_standings(p_league bigint, p_season integer, p_response jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
  v_groups jsonb := p_response #> '{0,league,standings}';
begin
  if p_league is null or p_season is null or jsonb_typeof(v_groups) <> 'array' or jsonb_array_length(v_groups) = 0 then
    return jsonb_build_object('rows', 0, 'skipped', 'no_standings');
  end if;

  delete from public.sports_standings where league_id = p_league and season = p_season;

  insert into public.sports_standings (
    league_id, season, group_name, team_id, rank, team_name, team_logo, points, goals_diff, form, status,
    description, all_stats, home_stats, away_stats, source_updated_at, synced_at
  )
  select p_league, p_season, coalesce(r ->> 'group', ''), public.sports_bigint(r #>> '{team,id}'),
         public.sports_int(r ->> 'rank'), r #>> '{team,name}', r #>> '{team,logo}',
         public.sports_int(r ->> 'points'), public.sports_int(r ->> 'goalsDiff'), left(r ->> 'form', 20),
         r ->> 'status', r ->> 'description',
         coalesce(r -> 'all', '{}'), coalesce(r -> 'home', '{}'), coalesce(r -> 'away', '{}'),
         case when coalesce(r ->> 'update', '') <> '' then (r ->> 'update')::timestamptz end, now()
    from jsonb_array_elements(v_groups) g
    cross join lateral jsonb_array_elements(case when jsonb_typeof(g) = 'array' then g else '[]'::jsonb end) r
   where public.sports_bigint(r #>> '{team,id}') is not null
  on conflict do nothing;
  get diagnostics v_rows = row_count;

  perform public.sports_broadcast(null, 'standings', jsonb_build_object('league_id', p_league));
  return jsonb_build_object('rows', v_rows);
end;
$$;

create or replace function public.sports_ingest_squad(p_team bigint, p_response jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_players jsonb := p_response #> '{0,players}';
  v_rows integer := 0;
begin
  if p_team is null or jsonb_typeof(v_players) <> 'array' or jsonb_array_length(v_players) = 0 then
    return jsonb_build_object('rows', 0, 'skipped', 'no_squad');
  end if;
  delete from public.sports_squads where team_id = p_team;
  insert into public.sports_squads (team_id, player_id, name, age, number, position, photo_url, updated_at)
  select p_team, public.sports_bigint(p ->> 'id'), p ->> 'name', public.sports_int(p ->> 'age'),
         public.sports_int(p ->> 'number'), p ->> 'position', p ->> 'photo', now()
    from jsonb_array_elements(v_players) p
   where public.sports_bigint(p ->> 'id') is not null and coalesce(p ->> 'name', '') <> ''
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  update public.sports_settings set last_squad_sync_at = now() where id = 1;
  return jsonb_build_object('rows', v_rows);
end;
$$;

create or replace function public.sports_ingest_team_statistics(p_league bigint, p_season integer, p_team bigint, p_response jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_league is null or p_season is null or p_team is null or jsonb_typeof(p_response) <> 'object' then
    return jsonb_build_object('skipped', 'invalid');
  end if;
  insert into public.sports_team_statistics (league_id, season, team_id, data, synced_at)
  values (p_league, p_season, p_team, p_response, now())
  on conflict (league_id, season, team_id) do update set data = excluded.data, synced_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Herkese açık okuma RPC'leri
-- ---------------------------------------------------------------------------
create or replace function public.sports_fixture_visible(p_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sports_fixtures f
     where f.id = p_id and not f.hidden and (not f.is_test or public.sports_can_see_test())
  )
$$;

-- Feed kartında gösterilecek maçı seçer. Öncelik: sabitlenmiş > canlı >
-- ön izleme penceresindeki > ertelenen/iptal > maç sonu bekleme süresindeki.
create or replace function public.sports_featured_fixture_id(p_include_test boolean default false)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with s as (select * from public.sports_settings where id = 1),
  c as (
    select f.*,
           case
             when f.feature_state = 'pinned' then 0
             when public.sports_phase_is_live(f.phase) then 1
             when f.phase = 'scheduled'
                  and f.kickoff_at <= now() + make_interval(mins => (select feed_prematch_minutes from s))
                  and f.kickoff_at > now() - interval '3 hours' then 2
             when f.phase in ('postponed', 'cancelled', 'abandoned')
                  and f.kickoff_at <= now() + make_interval(mins => (select feed_prematch_minutes from s))
                  and f.kickoff_at > now() - make_interval(mins => (select feed_postmatch_minutes from s) + 180) then 3
             when public.sports_phase_is_finished(f.phase)
                  and f.finished_seen_at > now() - make_interval(mins => (select feed_postmatch_minutes from s))
                  and f.kickoff_at > now() - make_interval(mins => (select feed_postmatch_minutes from s) + 300) then 4
           end as rank
      from public.sports_fixtures f
     where not f.hidden and f.feature_state <> 'suppressed'
       and (not f.is_test or (p_include_test and public.sports_can_see_test()))
  )
  select c.id from c
   where c.rank is not null
   order by c.is_test, c.rank, abs(extract(epoch from c.kickoff_at - now()))
   limit 1
$$;

create or replace function public.sports_feed_card(p_include_test boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  v_id bigint;
  v_f public.sports_fixtures;
  v_mode text;
  v_stats jsonb;
begin
  select * into s from public.sports_settings where id = 1;
  if not s.feed_card_enabled then
    return jsonb_build_object('enabled', false, 'fixture', null);
  end if;
  v_id := public.sports_featured_fixture_id(p_include_test);
  if v_id is null then
    return jsonb_build_object('enabled', true, 'fixture', null);
  end if;
  select * into v_f from public.sports_fixtures where id = v_id;
  v_mode := case
    when public.sports_phase_is_live(v_f.phase) then 'live'
    when public.sports_phase_is_finished(v_f.phase) then 'result'
    when v_f.phase in ('postponed', 'cancelled', 'abandoned') then 'status'
    else 'preview' end;

  if s.feed_show_stats and v_mode in ('live', 'result') then
    select jsonb_build_object(
             'home', (select stats from public.sports_fixture_statistics where fixture_id = v_id and team_id = v_f.home_team_id),
             'away', (select stats from public.sports_fixture_statistics where fixture_id = v_id and team_id = v_f.away_team_id),
             'updated_at', v_f.stats_synced_at)
      into v_stats;
  end if;

  return jsonb_build_object(
    'enabled', true,
    'mode', v_mode,
    'settings', jsonb_build_object('default_view', s.feed_default_view, 'show_chat_count', s.feed_show_chat_count,
                                   'show_stats', s.feed_show_stats, 'allow_hide', s.feed_allow_hide),
    'fixture', public.sports_fixture_json(v_id),
    'last_event', public.sports_last_key_event(v_id),
    'stats', v_stats,
    'chat', case when s.feed_show_chat_count then public.sports_chat_summary(v_id) end
  );
end;
$$;

create or replace function public.sports_fixture_detail(p_fixture bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  v_f public.sports_fixtures;
  v_cov jsonb;
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into s from public.sports_settings where id = 1;
  select * into v_f from public.sports_fixtures where id = p_fixture;
  select coverage into v_cov from public.sports_competitions where league_id = v_f.league_id and season = v_f.season;

  return jsonb_build_object(
    'fixture', public.sports_fixture_json(p_fixture),
    'last_event', public.sports_last_key_event(p_fixture),
    'coverage', coalesce(v_cov, '{}'::jsonb),
    'available', jsonb_build_object(
      'events', exists (select 1 from public.sports_fixture_events where fixture_id = p_fixture and status = 'active'),
      'stats', exists (select 1 from public.sports_fixture_statistics where fixture_id = p_fixture),
      'lineups', exists (select 1 from public.sports_fixture_lineups where fixture_id = p_fixture),
      'players', exists (select 1 from public.sports_fixture_players where fixture_id = p_fixture),
      'snapshots', exists (select 1 from public.sports_fixture_stat_snapshots where fixture_id = p_fixture)),
    'chat', public.sports_chat_summary(p_fixture),
    'pinned', v_f.chat_pinned,
    'rights', jsonb_build_object('logos', s.logos_enabled, 'player_photos', s.player_photos_enabled),
    'attribution', 'Veri: API-Football'
  );
end;
$$;

create or replace function public.sports_fixture_stats(p_fixture bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_f public.sports_fixtures;
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into v_f from public.sports_fixtures where id = p_fixture;
  return jsonb_build_object(
    'home', (select stats from public.sports_fixture_statistics where fixture_id = p_fixture and team_id = v_f.home_team_id),
    'away', (select stats from public.sports_fixture_statistics where fixture_id = p_fixture and team_id = v_f.away_team_id),
    'updated_at', v_f.stats_synced_at,
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object('at', x.captured_at, 'elapsed', x.elapsed, 'status', x.status_short,
                                          'home', x.home, 'away', x.away) order by x.captured_at)
        from public.sports_fixture_stat_snapshots x where x.fixture_id = p_fixture), '[]'::jsonb)
  );
end;
$$;

create or replace function public.sports_fixture_timeline(p_fixture bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(public.sports_event_json(e) order by coalesce(e.minute, 0), coalesce(e.extra, 0), e.sort_index)
        from public.sports_fixture_events e
       where e.fixture_id = p_fixture and e.status = 'active'), '[]'::jsonb),
    'phases', coalesce((
      select jsonb_agg(jsonb_build_object('status', l.status_short, 'phase', public.sports_phase(l.status_short),
                                          'elapsed', l.elapsed, 'at', l.observed_at) order by l.observed_at)
        from public.sports_fixture_status_log l where l.fixture_id = p_fixture), '[]'::jsonb),
    'updated_at', (select events_synced_at from public.sports_fixtures where id = p_fixture)
  );
end;
$$;

create or replace function public.sports_fixture_lineups(p_fixture bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
begin
  if not public.sports_fixture_visible(p_fixture) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into s from public.sports_settings where id = 1;
  return jsonb_build_object(
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_id', l.team_id, 'team_name', l.team_name, 'formation', l.formation,
               'coach', case when s.player_photos_enabled then l.coach else l.coach - 'photo' end,
               'start_xi', l.start_xi, 'substitutes', l.substitutes, 'colors', l.colors,
               'is_predicted', l.is_predicted, 'source', l.source, 'updated_at', l.updated_at))
        from public.sports_fixture_lineups l where l.fixture_id = p_fixture), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', p.player_id, 'team_id', p.team_id, 'name', p.name, 'number', p.number,
               'position', p.position, 'minutes', p.minutes, 'rating', p.rating, 'captain', p.captain,
               'substitute', p.substitute, 'stats', p.stats,
               'photo', case when s.player_photos_enabled then p.photo_url end))
        from public.sports_fixture_players p where p.fixture_id = p_fixture), '[]'::jsonb),
    'updated_at', (select greatest(lineups_synced_at, players_synced_at) from public.sports_fixtures where id = p_fixture)
  );
end;
$$;

create or replace function public.sports_standings(p_league bigint default null, p_season integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  v_league bigint := p_league;
  v_season integer := coalesce(p_season, (select season from public.sports_settings where id = 1));
begin
  select * into s from public.sports_settings where id = 1;
  if v_league is null then
    select c.league_id, c.season into v_league, v_season
      from public.sports_competitions c
     where c.is_current and c.type = 'League' and c.is_enabled
     order by c.priority, c.season desc limit 1;
  end if;
  if v_league is null then
    return jsonb_build_object('league', null, 'rows', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'league', (select jsonb_build_object('id', c.league_id, 'season', c.season, 'name', c.name, 'type', c.type,
                                         'logo', case when s.logos_enabled then c.logo_url end)
                 from public.sports_competitions c where c.league_id = v_league and c.season = v_season),
    'primary_team_id', s.team_id,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'group', x.group_name, 'rank', x.rank, 'team_id', x.team_id, 'team_name', x.team_name,
               'team_logo', case when s.logos_enabled then x.team_logo end,
               'points', x.points, 'goals_diff', x.goals_diff, 'form', x.form, 'description', x.description,
               'played', public.sports_int(x.all_stats ->> 'played'), 'win', public.sports_int(x.all_stats ->> 'win'),
               'draw', public.sports_int(x.all_stats ->> 'draw'), 'lose', public.sports_int(x.all_stats ->> 'lose'),
               'goals_for', public.sports_int(x.all_stats #>> '{goals,for}'),
               'goals_against', public.sports_int(x.all_stats #>> '{goals,against}'))
             order by x.group_name, x.rank)
        from public.sports_standings x where x.league_id = v_league and x.season = v_season), '[]'::jsonb),
    'synced_at', (select max(synced_at) from public.sports_standings where league_id = v_league and season = v_season)
  );
end;
$$;

create or replace function public.sports_fixtures_list(
  p_scope text default 'upcoming', p_limit integer default 20, p_offset integer default 0, p_league bigint default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.sports_fixture_json(x.id) order by x.ord), '[]'::jsonb)
    from (
      select f.id,
             row_number() over (order by
               case when p_scope = 'results' then -extract(epoch from f.kickoff_at) else extract(epoch from f.kickoff_at) end) as ord
        from public.sports_fixtures f
       where not f.hidden and not f.is_test
         and (p_league is null or f.league_id = p_league)
         and case p_scope
               when 'upcoming' then not public.sports_phase_is_finished(f.phase) and f.kickoff_at > now() - interval '4 hours'
                                    and f.phase not in ('cancelled')
               when 'results' then public.sports_phase_is_finished(f.phase)
               when 'live' then public.sports_phase_is_live(f.phase)
               else true
             end
       order by ord
       limit least(greatest(coalesce(p_limit, 20), 1), 60) offset greatest(coalesce(p_offset, 0), 0)
    ) x
$$;

create or replace function public.sports_center()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.sports_settings;
  v_next bigint;
  v_last bigint;
  v_live bigint;
  v_row jsonb;
begin
  select * into s from public.sports_settings where id = 1;
  select id into v_live from public.sports_fixtures
   where not hidden and not is_test and public.sports_phase_is_live(phase) order by kickoff_at desc limit 1;
  select id into v_next from public.sports_fixtures
   where not hidden and not is_test and phase = 'scheduled' and kickoff_at > now() - interval '3 hours'
   order by kickoff_at limit 1;
  select id into v_last from public.sports_fixtures
   where not hidden and not is_test and public.sports_phase_is_finished(phase) order by kickoff_at desc limit 1;

  select jsonb_build_object('league_id', x.league_id, 'season', x.season, 'league_name', c.name, 'rank', x.rank,
                            'points', x.points, 'played', public.sports_int(x.all_stats ->> 'played'),
                            'goals_diff', x.goals_diff, 'form', x.form)
    into v_row
    from public.sports_standings x
    join public.sports_competitions c on c.league_id = x.league_id and c.season = x.season
   where x.team_id = s.team_id and c.is_current and c.type = 'League'
   order by c.priority limit 1;

  return jsonb_build_object(
    'configured', s.team_id is not null,
    'team', (select jsonb_build_object('id', t.id, 'name', t.name, 'logo', case when s.logos_enabled then t.logo_url end,
                                       'venue', t.venue ->> 'name')
               from public.sports_teams t where t.id = s.team_id),
    'season', s.season,
    'live', case when v_live is not null then public.sports_fixture_json(v_live) end,
    'next', case when v_next is not null then public.sports_fixture_json(v_next) end,
    'last', case when v_last is not null then public.sports_fixture_json(v_last) end,
    'upcoming', public.sports_fixtures_list('upcoming', 6, 0, null),
    'results', public.sports_fixtures_list('results', 6, 0, null),
    'standing', v_row,
    'competitions', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.league_id, 'season', c.season, 'name', c.name, 'type', c.type,
                                          'has_standings', coalesce((c.coverage ->> 'standings')::boolean, false))
                       order by c.priority, c.name)
        from public.sports_competitions c where c.is_current and c.is_enabled), '[]'::jsonb),
    'attribution', 'Veri: API-Football'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Fonksiyon yetkileri
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'sports\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if fn.proname in ('sports_feed_card', 'sports_fixture_detail', 'sports_fixture_stats', 'sports_fixture_timeline',
                      'sports_fixture_lineups', 'sports_standings', 'sports_fixtures_list', 'sports_center') then
      execute format('grant execute on function %s to anon, authenticated', fn.sig);
    elsif fn.proname like 'sports\_ingest\_%' or fn.proname = 'sports_fixture_sync_failed' then
      execute format('grant execute on function %s to service_role', fn.sig);
    end if;
  end loop;
end $$;
