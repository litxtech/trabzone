-- 0042_map_core.sql
-- TRABZONE Etkileşim Haritası çekirdeği.
--
-- Kapsam:
--   * Kullanıcı harita tercihleri (hayalet modu varsayılan AÇIK)
--   * Süreli canlı konum paylaşım oturumları + seçili kişi izinleri
--   * Kaydedilen yerler (koleksiyonlar)
--   * Takip edilen bölgeler
--   * Harita keşif RPC'si (arkadaş konumu + gerçek yolculuk ilanları)
--
-- Güvenlik notları:
--   * Hiçbir tabloya istemciden doğrudan erişim verilmez; tüm okuma/yazma
--     security definer RPC'lerden geçer.
--   * Yaklaşık konum hassasiyetinde koordinat sunucuda ~1.1 km'ye yuvarlanır.
--     Hassas konum yalnızca paylaşım sahibi "precise" izni verdiyse döner.
--   * Hayalet modundaki kullanıcı hiçbir keşif sonucunda yer almaz.
--   * Engellenen kullanıcılar birbirinin konumunu göremez.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------
create table if not exists public.map_user_preferences (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  ghost_mode             boolean not null default true,
  visibility             text not null default 'ghost',
  precision              text not null default 'approximate',
  default_share_minutes  integer not null default 60,
  active_mode            text not null default 'social',
  layers                 jsonb not null default '{
    "friends": true,
    "rides": true,
    "events": false,
    "places": false,
    "live": false,
    "reels": false,
    "help": false,
    "traffic": false,
    "weather": false
  }'::jsonb,
  density                text not null default 'balanced',
  last_view              jsonb not null default '{}'::jsonb,
  onboarding_done        boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint map_prefs_visibility_check check (visibility in ('ghost', 'friends', 'selected')),
  constraint map_prefs_precision_check check (precision in ('approximate', 'exact')),
  constraint map_prefs_minutes_check check (default_share_minutes between 15 and 1440),
  constraint map_prefs_mode_check check (active_mode in ('social', 'ride', 'explore', 'support')),
  constraint map_prefs_density_check check (density in ('simple', 'balanced', 'rich'))
);

comment on table public.map_user_preferences is
  'Etkileşim haritası tercihleri. ghost_mode yeni kullanıcılarda true (gizli) başlar.';

create table if not exists public.map_location_sessions (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  audience    text not null default 'friends',
  precise     boolean not null default false,
  lat         double precision not null,
  lng         double precision not null,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  stopped_at  timestamptz,
  constraint map_session_audience_check check (audience in ('friends', 'selected')),
  constraint map_session_lat_check check (lat between -90 and 90),
  constraint map_session_lng_check check (lng between -180 and 180),
  constraint map_session_expiry_check check (expires_at > started_at)
);

comment on table public.map_location_sessions is
  'Süreli canlı konum paylaşımı. Süre bitince veya stopped_at dolunca erişim kapanır.';

create unique index if not exists map_location_sessions_active_key
  on public.map_location_sessions (owner_id)
  where stopped_at is null;

create index if not exists map_location_sessions_expiry_idx
  on public.map_location_sessions (expires_at)
  where stopped_at is null;

create table if not exists public.map_location_viewers (
  session_id uuid not null references public.map_location_sessions (id) on delete cascade,
  viewer_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, viewer_id)
);

create index if not exists map_location_viewers_viewer_idx
  on public.map_location_viewers (viewer_id);

create table if not exists public.map_saved_places (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  address    text,
  lat        double precision not null,
  lng        double precision not null,
  category   text not null default 'place',
  note       text,
  collection text not null default 'favorites',
  visibility text not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint map_saved_place_lat_check check (lat between -90 and 90),
  constraint map_saved_place_lng_check check (lng between -180 and 180),
  constraint map_saved_place_visibility_check check (visibility in ('private', 'link', 'public')),
  constraint map_saved_place_collection_check check (collection in ('favorites', 'wishlist', 'trips', 'custom'))
);

create index if not exists map_saved_places_owner_idx
  on public.map_saved_places (owner_id, collection, created_at desc);

create table if not exists public.map_region_follows (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  label       text not null,
  lat         double precision,
  lng         double precision,
  radius_km   integer not null default 25,
  notify_mode text not null default 'daily',
  created_at  timestamptz not null default now(),
  constraint map_region_radius_check check (radius_km between 1 and 200),
  constraint map_region_notify_check check (notify_mode in ('instant', 'daily', 'important', 'off')),
  constraint map_region_unique unique (user_id, label)
);

-- ---------------------------------------------------------------------------
-- Trigger'lar
-- ---------------------------------------------------------------------------
drop trigger if exists map_user_preferences_updated_at on public.map_user_preferences;
create trigger map_user_preferences_updated_at
  before update on public.map_user_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists map_saved_places_updated_at on public.map_saved_places;
create trigger map_saved_places_updated_at
  before update on public.map_saved_places
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: sahibi dışında kimse satır göremez. Uygulama yalnızca RPC kullanır.
-- ---------------------------------------------------------------------------
alter table public.map_user_preferences enable row level security;
alter table public.map_location_sessions enable row level security;
alter table public.map_location_viewers enable row level security;
alter table public.map_saved_places enable row level security;
alter table public.map_region_follows enable row level security;

drop policy if exists map_prefs_self on public.map_user_preferences;
create policy map_prefs_self on public.map_user_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists map_sessions_self on public.map_location_sessions;
create policy map_sessions_self on public.map_location_sessions
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists map_viewers_self on public.map_location_viewers;
create policy map_viewers_self on public.map_location_viewers
  for select to authenticated
  using (
    viewer_id = auth.uid()
    or exists (
      select 1 from public.map_location_sessions s
      where s.id = session_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists map_saved_places_self on public.map_saved_places;
create policy map_saved_places_self on public.map_saved_places
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists map_region_follows_self on public.map_region_follows;
create policy map_region_follows_self on public.map_region_follows
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------------
create or replace function public.map_prefs_defaults()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'ghost_mode', true,
    'visibility', 'ghost',
    'precision', 'approximate',
    'default_share_minutes', 60,
    'active_mode', 'social',
    'layers', jsonb_build_object(
      'friends', true, 'rides', true, 'events', false, 'places', false,
      'live', false, 'reels', false, 'help', false, 'traffic', false, 'weather', false
    ),
    'density', 'balanced',
    'last_view', '{}'::jsonb,
    'onboarding_done', false
  );
$$;

revoke all on function public.map_prefs_defaults() from public, anon;
grant execute on function public.map_prefs_defaults() to authenticated, service_role;

-- Takipçi/arkadaş listesi: paylaşım için "seçtiğim kişiler" seçiminde kullanılır.
create or replace function public.map_friends()
returns table (
  id          uuid,
  username    text,
  display_name text,
  avatar_path text,
  is_verified boolean,
  sharing     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.username::text,
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.username::text),
    p.avatar_path,
    p.is_verified,
    exists (
      select 1
      from public.map_location_sessions s
      join public.map_user_preferences prefs on prefs.user_id = s.owner_id
      where s.owner_id = p.id
        and s.stopped_at is null
        and s.expires_at > now()
        and prefs.ghost_mode = false
        and prefs.visibility in ('friends', 'selected')
    )
  from public.profiles p
  where public.are_friends(auth.uid(), p.id)
    and p.account_status = 'active'
    and not public.is_blocked(auth.uid(), p.id)
  order by p.first_name nulls last, p.username
  limit 300;
$$;

revoke all on function public.map_friends() from public, anon;
grant execute on function public.map_friends() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tercihler
-- ---------------------------------------------------------------------------
create or replace function public.map_prefs_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := public.tz_require_uid();
  v_prefs public.map_user_preferences%rowtype;
  v_share jsonb;
begin
  -- Süresi dolmuş oturumları kapat (kullanıcı geri döndüğünde durum net olsun).
  update public.map_location_sessions
     set stopped_at = now()
   where owner_id = v_uid
     and stopped_at is null
     and expires_at <= now();

  insert into public.map_user_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select * into v_prefs from public.map_user_preferences where user_id = v_uid;

  select jsonb_build_object(
           'id', s.id,
           'audience', s.audience,
           'precise', s.precise,
           'started_at', s.started_at,
           'expires_at', s.expires_at,
           'lat', s.lat,
           'lng', s.lng,
           'viewers', (
             select coalesce(jsonb_agg(v.viewer_id), '[]'::jsonb)
             from public.map_location_viewers v
             where v.session_id = s.id
           )
         )
    into v_share
    from public.map_location_sessions s
   where s.owner_id = v_uid
     and s.stopped_at is null
     and s.expires_at > now()
   order by s.started_at desc
   limit 1;

  return jsonb_build_object(
    'user_id', v_uid,
    'ghost_mode', v_prefs.ghost_mode,
    'visibility', v_prefs.visibility,
    'precision', v_prefs.precision,
    'default_share_minutes', v_prefs.default_share_minutes,
    'active_mode', v_prefs.active_mode,
    'layers', v_prefs.layers,
    'density', v_prefs.density,
    'last_view', v_prefs.last_view,
    'onboarding_done', v_prefs.onboarding_done,
    'active_share', v_share
  );
end;
$$;

revoke all on function public.map_prefs_get() from public, anon;
grant execute on function public.map_prefs_get() to authenticated, service_role;

create or replace function public.map_prefs_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_visibility text := nullif(p_payload ->> 'visibility', '');
  v_precision  text := nullif(p_payload ->> 'precision', '');
  v_mode       text := nullif(p_payload ->> 'active_mode', '');
  v_density    text := nullif(p_payload ->> 'density', '');
  v_minutes    integer := nullif(p_payload ->> 'default_share_minutes', '')::integer;
  v_ghost      boolean := null;
  v_layers     jsonb;
  v_last_view  jsonb;
  v_onboarding boolean := null;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  if v_visibility is not null and v_visibility not in ('ghost', 'friends', 'selected') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  if v_precision is not null and v_precision not in ('approximate', 'exact') then
    raise exception 'invalid_map_precision' using errcode = '22023';
  end if;

  if v_mode is not null and v_mode not in ('social', 'ride', 'explore', 'support') then
    raise exception 'invalid_map_mode' using errcode = '22023';
  end if;

  if v_density is not null and v_density not in ('simple', 'balanced', 'rich') then
    raise exception 'invalid_map_density' using errcode = '22023';
  end if;

  if v_minutes is not null and (v_minutes < 15 or v_minutes > 1440) then
    raise exception 'invalid_share_duration' using errcode = '22023';
  end if;

  if p_payload ? 'ghost_mode' then
    v_ghost := coalesce((p_payload ->> 'ghost_mode')::boolean, true);
  end if;

  if p_payload ? 'layers' and jsonb_typeof(p_payload -> 'layers') = 'object' then
    v_layers := p_payload -> 'layers';
  end if;

  if p_payload ? 'last_view' and jsonb_typeof(p_payload -> 'last_view') = 'object' then
    v_last_view := p_payload -> 'last_view';
  end if;

  if p_payload ? 'onboarding_done' then
    v_onboarding := coalesce((p_payload ->> 'onboarding_done')::boolean, false);
  end if;

  insert into public.map_user_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.map_user_preferences
     set ghost_mode = case
                        when v_visibility = 'ghost' then true
                        when v_visibility in ('friends', 'selected') then false
                        else coalesce(v_ghost, ghost_mode)
                      end,
         visibility = coalesce(v_visibility, visibility),
         precision = coalesce(v_precision, precision),
         active_mode = coalesce(v_mode, active_mode),
         density = coalesce(v_density, density),
         default_share_minutes = coalesce(v_minutes, default_share_minutes),
         layers = coalesce(v_layers, layers),
         last_view = coalesce(v_last_view, last_view),
         onboarding_done = coalesce(v_onboarding, onboarding_done)
   where user_id = v_uid;

  -- Görünürlük hayalet moduna alındıysa aktif paylaşım da kapatılır.
  if v_visibility = 'ghost' or v_ghost is true then
    update public.map_location_sessions
       set stopped_at = now()
     where owner_id = v_uid
       and stopped_at is null;
  end if;

  return public.map_prefs_get();
end;
$$;

revoke all on function public.map_prefs_save(jsonb) from public, anon;
grant execute on function public.map_prefs_save(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Süreli konum paylaşımı
-- ---------------------------------------------------------------------------
create or replace function public.map_share_start(
  p_lat      double precision,
  p_lng      double precision,
  p_precise  boolean default false,
  p_minutes  integer default 60,
  p_audience text default 'friends',
  p_viewers  uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.tz_require_uid();
  v_minutes integer := least(greatest(coalesce(p_minutes, 60), 15), 1440);
  v_session public.map_location_sessions%rowtype;
  v_viewer  uuid;
  v_count   integer := 0;
begin
  if p_lat is null or p_lng is null then
    raise exception 'location_required' using errcode = '22023';
  end if;

  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_coordinates' using errcode = '22023';
  end if;

  if p_audience not in ('friends', 'selected') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;

  -- Tek aktif oturum kuralı: önce mevcut olanı kapat.
  update public.map_location_sessions
     set stopped_at = now()
   where owner_id = v_uid
     and stopped_at is null;

  insert into public.map_location_sessions (owner_id, audience, precise, lat, lng, expires_at)
  values (v_uid, p_audience, coalesce(p_precise, false), p_lat, p_lng, now() + make_interval(mins => v_minutes))
  returning * into v_session;

  if p_audience = 'selected' then
    foreach v_viewer in array coalesce(p_viewers, '{}'::uuid[]) loop
      if v_viewer is null or v_viewer = v_uid then
        continue;
      end if;
      if not public.are_friends(v_uid, v_viewer) or public.is_blocked(v_uid, v_viewer) then
        continue;
      end if;
      insert into public.map_location_viewers (session_id, viewer_id)
      values (v_session.id, v_viewer)
      on conflict do nothing;
      v_count := v_count + 1;
    end loop;

    if v_count = 0 then
      delete from public.map_location_sessions where id = v_session.id;
      raise exception 'viewer_required' using errcode = '22023';
    end if;
  end if;

  insert into public.map_user_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.map_user_preferences
     set ghost_mode = false,
         visibility = p_audience,
         precision = case when coalesce(p_precise, false) then 'exact' else 'approximate' end
   where user_id = v_uid;

  return jsonb_build_object(
    'id', v_session.id,
    'audience', v_session.audience,
    'precise', v_session.precise,
    'lat', v_session.lat,
    'lng', v_session.lng,
    'started_at', v_session.started_at,
    'expires_at', v_session.expires_at,
    'viewers', coalesce(to_jsonb(p_viewers), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.map_share_start(double precision, double precision, boolean, integer, text, uuid[]) from public, anon;
grant execute on function public.map_share_start(double precision, double precision, boolean, integer, text, uuid[]) to authenticated, service_role;

create or replace function public.map_share_heartbeat(
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.tz_require_uid();
  v_session public.map_location_sessions%rowtype;
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_coordinates' using errcode = '22023';
  end if;

  select * into v_session
    from public.map_location_sessions
   where owner_id = v_uid
     and stopped_at is null
     and expires_at > now()
   order by started_at desc
   limit 1;

  if not found then
    raise exception 'share_not_active' using errcode = 'P0001';
  end if;

  -- Hız sınırı: 5 saniyeden sık güncelleme yazılmaz.
  if v_session.updated_at > now() - interval '5 seconds' then
    return jsonb_build_object('ok', true, 'throttled', true, 'expires_at', v_session.expires_at);
  end if;

  update public.map_location_sessions
     set lat = p_lat,
         lng = p_lng,
         updated_at = now()
   where id = v_session.id;

  return jsonb_build_object('ok', true, 'throttled', false, 'expires_at', v_session.expires_at);
end;
$$;

revoke all on function public.map_share_heartbeat(double precision, double precision) from public, anon;
grant execute on function public.map_share_heartbeat(double precision, double precision) to authenticated, service_role;

create or replace function public.map_share_stop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.tz_require_uid();
  v_stopped integer := 0;
begin
  update public.map_location_sessions
     set stopped_at = now()
   where owner_id = v_uid
     and stopped_at is null;

  get diagnostics v_stopped = row_count;

  insert into public.map_user_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.map_user_preferences
     set ghost_mode = true,
         visibility = 'ghost'
   where user_id = v_uid;

  return jsonb_build_object('ok', true, 'stopped', v_stopped);
end;
$$;

revoke all on function public.map_share_stop() from public, anon;
grant execute on function public.map_share_stop() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Keşif: arkadaş konumları + gerçek yolculuk ilanları/talepleri
-- ---------------------------------------------------------------------------
create or replace function public.map_explore(
  p_lat      double precision,
  p_lng      double precision,
  p_radius   double precision default 25,
  p_layers   text[] default array['friends', 'rides'],
  p_limit    integer default 120
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_radius double precision := least(greatest(coalesce(p_radius, 25), 0.5), 200);
  v_limit  integer := least(greatest(coalesce(p_limit, 120), 1), 300);
  v_points jsonb := '[]'::jsonb;
  v_friends jsonb := '[]'::jsonb;
  v_offers  jsonb := '[]'::jsonb;
  v_requests jsonb := '[]'::jsonb;
  v_layers text[] := coalesce(p_layers, array['friends', 'rides']);
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_coordinates' using errcode = '22023';
  end if;

  if 'friends' = any(v_layers) then
    select coalesce(jsonb_agg(item order by item ->> 'title'), '[]'::jsonb)
      into v_friends
      from (
        select jsonb_build_object(
                 'kind', 'friend',
                 'id', s.owner_id,
                 'lat', case
                          when s.precise and prefs.precision = 'exact'
                            then s.lat
                          else round(s.lat::numeric, 2)::double precision
                        end,
                 'lng', case
                          when s.precise and prefs.precision = 'exact'
                            then s.lng
                          else round(s.lng::numeric, 2)::double precision
                        end,
                 'title', coalesce(
                            nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
                            p.username::text
                          ),
                 'subtitle', null,
                 'username', p.username::text,
                 'avatar_path', p.avatar_path,
                 'precise', (s.precise and prefs.precision = 'exact'),
                 'updated_at', s.updated_at,
                 'expires_at', s.expires_at
               ) as item
          from public.map_location_sessions s
          join public.map_user_preferences prefs on prefs.user_id = s.owner_id
          join public.profiles p on p.id = s.owner_id
         where s.owner_id <> v_uid
           and s.stopped_at is null
           and s.expires_at > now()
           and prefs.ghost_mode = false
           and prefs.visibility in ('friends', 'selected')
           and p.account_status = 'active'
           and not public.is_blocked(v_uid, s.owner_id)
           and (
             (prefs.visibility = 'friends' and public.are_friends(v_uid, s.owner_id))
             or
             (prefs.visibility = 'selected' and exists (
               select 1 from public.map_location_viewers v
               where v.session_id = s.id and v.viewer_id = v_uid
             ))
           )
           and 6371 * acos(
                 least(1, greatest(-1,
                   sin(radians(p_lat)) * sin(radians(s.lat))
                   + cos(radians(p_lat)) * cos(radians(s.lat)) * cos(radians(s.lng) - radians(p_lng))
                 ))
               ) <= v_radius
         order by s.updated_at desc
         limit v_limit
      ) friends;
  end if;

  if 'rides' = any(v_layers) then
    select coalesce(jsonb_agg(item order by item -> 'meta' ->> 'depart_at'), '[]'::jsonb)
      into v_offers
      from (
        select jsonb_build_object(
                 'kind', 'ride_offer',
                 'id', o.id,
                 'lat', o.origin_lat,
                 'lng', o.origin_lng,
                 'title', concat(o.origin_label, ' → ', o.dest_label),
                 'subtitle', concat(o.origin_city, ' · ', to_char(o.depart_at, 'DD Mon HH24:MI')),
                 'meta', jsonb_build_object(
                   'scope', o.scope,
                   'mode', o.mode,
                   'seats', o.seats_total,
                   'price_cents', o.price_per_seat_cents,
                   'currency', o.currency,
                   'depart_at', o.depart_at,
                   'dest_label', o.dest_label,
                   'dest_lat', o.dest_lat,
                   'dest_lng', o.dest_lng,
                   'driver', coalesce(
                     nullif(trim(concat_ws(' ', dp.first_name, dp.last_name)), ''),
                     dp.username::text
                   ),
                   'driver_username', dp.username::text,
                   'driver_avatar', dp.avatar_path,
                   'verified', dp.is_verified
                 )
               ) as item
          from public.ride_offers o
          join public.profiles dp on dp.id = o.driver_id
         where o.origin_lat is not null
           and o.origin_lng is not null
           and o.status in ('published', 'full', 'started')
           and o.visibility = 'public'
           and o.depart_at > now() - interval '2 hours'
           and not public.is_blocked(v_uid, o.driver_id)
           and 6371 * acos(
                 least(1, greatest(-1,
                   sin(radians(p_lat)) * sin(radians(o.origin_lat))
                   + cos(radians(p_lat)) * cos(radians(o.origin_lat))
                     * cos(radians(o.origin_lng) - radians(p_lng))
                 ))
               ) <= v_radius
         order by o.depart_at asc
         limit v_limit
      ) offers;

    select coalesce(jsonb_agg(item order by item -> 'meta' ->> 'earliest_depart'), '[]'::jsonb)
      into v_requests
      from (
        select jsonb_build_object(
                 'kind', 'ride_request',
                 'id', r.id,
                 'lat', r.origin_lat,
                 'lng', r.origin_lng,
                 'title', concat(r.origin_label, ' → ', r.dest_label),
                 'subtitle', concat(r.origin_city, ' · ', to_char(r.earliest_depart, 'DD Mon HH24:MI')),
                 'meta', jsonb_build_object(
                   'scope', r.scope,
                   'party_size', r.party_size,
                   'earliest_depart', r.earliest_depart,
                   'latest_depart', r.latest_depart,
                   'dest_label', r.dest_label,
                   'passenger', coalesce(
                     nullif(trim(concat_ws(' ', pp.first_name, pp.last_name)), ''),
                     pp.username::text
                   ),
                   'passenger_username', pp.username::text
                 )
               ) as item
          from public.ride_requests r
          join public.profiles pp on pp.id = r.passenger_id
         where r.origin_lat is not null
           and r.origin_lng is not null
           and r.status = 'open'
           and r.expires_at > now()
           and not public.is_blocked(v_uid, r.passenger_id)
           and 6371 * acos(
                 least(1, greatest(-1,
                   sin(radians(p_lat)) * sin(radians(r.origin_lat))
                   + cos(radians(p_lat)) * cos(radians(r.origin_lat))
                     * cos(radians(r.origin_lng) - radians(p_lng))
                 ))
               ) <= v_radius
         order by r.earliest_depart asc
         limit v_limit
      ) requests;
  end if;

  v_points := v_friends || v_offers || v_requests;

  return jsonb_build_object(
    'center', jsonb_build_object('lat', p_lat, 'lng', p_lng),
    'radius_km', v_radius,
    'generated_at', now(),
    'counts', jsonb_build_object(
      'friends', jsonb_array_length(v_friends),
      'rides', jsonb_array_length(v_offers) + jsonb_array_length(v_requests)
    ),
    'points', v_points
  );
end;
$$;

revoke all on function public.map_explore(double precision, double precision, double precision, text[], integer) from public, anon;
grant execute on function public.map_explore(double precision, double precision, double precision, text[], integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Kaydedilen yerler
-- ---------------------------------------------------------------------------
create or replace function public.map_saved_places_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'title', p.title,
               'address', p.address,
               'lat', p.lat,
               'lng', p.lng,
               'category', p.category,
               'note', p.note,
               'collection', p.collection,
               'visibility', p.visibility,
               'created_at', p.created_at
             )
             order by p.created_at desc
           ),
           '[]'::jsonb
         )
  from public.map_saved_places p
  where p.owner_id = public.tz_require_uid();
$$;

revoke all on function public.map_saved_places_list() from public, anon;
grant execute on function public.map_saved_places_list() to authenticated, service_role;

create or replace function public.map_saved_place_add(
  p_title      text,
  p_lat        double precision,
  p_lng        double precision,
  p_address    text default null,
  p_category   text default 'place',
  p_collection text default 'favorites',
  p_visibility text default 'private',
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.map_saved_places%rowtype;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'title_required' using errcode = '22023';
  end if;

  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_coordinates' using errcode = '22023';
  end if;

  if p_collection not in ('favorites', 'wishlist', 'trips', 'custom') then
    raise exception 'invalid_collection' using errcode = '22023';
  end if;

  if p_visibility not in ('private', 'link', 'public') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  insert into public.map_saved_places (
    owner_id, title, address, lat, lng, category, note, collection, visibility
  )
  values (
    v_uid, left(trim(p_title), 120), left(p_address, 240), p_lat, p_lng,
    left(coalesce(nullif(trim(p_category), ''), 'place'), 40),
    left(p_note, 500), p_collection, p_visibility
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.map_saved_place_add(text, double precision, double precision, text, text, text, text, text) from public, anon;
grant execute on function public.map_saved_place_add(text, double precision, double precision, text, text, text, text, text) to authenticated, service_role;

create or replace function public.map_saved_place_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.tz_require_uid();
  v_deleted integer := 0;
begin
  delete from public.map_saved_places
   where id = p_id
     and owner_id = v_uid;

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', v_deleted > 0);
end;
$$;

revoke all on function public.map_saved_place_delete(uuid) from public, anon;
grant execute on function public.map_saved_place_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Takip edilen bölgeler
-- ---------------------------------------------------------------------------
create or replace function public.map_regions_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', r.id,
               'label', r.label,
               'lat', r.lat,
               'lng', r.lng,
               'radius_km', r.radius_km,
               'notify_mode', r.notify_mode,
               'created_at', r.created_at
             )
             order by r.created_at desc
           ),
           '[]'::jsonb
         )
  from public.map_region_follows r
  where r.user_id = public.tz_require_uid();
$$;

revoke all on function public.map_regions_list() from public, anon;
grant execute on function public.map_regions_list() to authenticated, service_role;

create or replace function public.map_region_follow(
  p_label      text,
  p_radius_km  integer default 25,
  p_lat        double precision default null,
  p_lng        double precision default null,
  p_notify     text default 'daily'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.map_region_follows%rowtype;
  v_radius integer := least(greatest(coalesce(p_radius_km, 25), 1), 200);
begin
  if coalesce(trim(p_label), '') = '' then
    raise exception 'label_required' using errcode = '22023';
  end if;

  if p_notify not in ('instant', 'daily', 'important', 'off') then
    raise exception 'invalid_notify_mode' using errcode = '22023';
  end if;

  insert into public.map_region_follows (user_id, label, lat, lng, radius_km, notify_mode)
  values (v_uid, left(trim(p_label), 120), p_lat, p_lng, v_radius, p_notify)
  on conflict (user_id, label) do update
    set radius_km = excluded.radius_km,
        notify_mode = excluded.notify_mode,
        lat = coalesce(excluded.lat, public.map_region_follows.lat),
        lng = coalesce(excluded.lng, public.map_region_follows.lng)
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.map_region_follow(text, integer, double precision, double precision, text) from public, anon;
grant execute on function public.map_region_follow(text, integer, double precision, double precision, text) to authenticated, service_role;

create or replace function public.map_region_unfollow(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.tz_require_uid();
  v_deleted integer := 0;
begin
  delete from public.map_region_follows
   where id = p_id
     and user_id = v_uid;

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', v_deleted > 0);
end;
$$;

revoke all on function public.map_region_unfollow(uuid) from public, anon;
grant execute on function public.map_region_unfollow(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Konum paylaşımını kapatma (güvenlik merkezi tek çağrı)
-- ---------------------------------------------------------------------------
create or replace function public.map_panic_stop_sharing()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  update public.map_location_sessions
     set stopped_at = now()
   where owner_id = v_uid
     and stopped_at is null;

  update public.map_user_preferences
     set ghost_mode = true,
         visibility = 'ghost'
   where user_id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.map_panic_stop_sharing() from public, anon;
grant execute on function public.map_panic_stop_sharing() to authenticated, service_role;

-- Tablolar yalnızca RPC üzerinden kullanılır.
revoke all on public.map_user_preferences from public, anon, authenticated;
revoke all on public.map_location_sessions from public, anon, authenticated;
revoke all on public.map_location_viewers from public, anon, authenticated;
revoke all on public.map_saved_places from public, anon, authenticated;
revoke all on public.map_region_follows from public, anon, authenticated;
