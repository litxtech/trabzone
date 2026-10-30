-- ---------------------------------------------------------------------------
-- 0137 — Platform geneli tekil görüntüleme sistemi
--
-- Kural: 1 hesap + 1 içerik = en fazla 1 tekil görüntüleme.
-- Cihaz, platform (iOS / Android / web) ve oturum farkı sayıyı değiştirmez;
-- sayaç yalnızca `viewer_user_id` üzerinden tutulur.
--
-- Mimari:
--   view_content_types        güvenli içerik türü sözlüğü
--   content_unique_views      kaynak doğruluk: (tür, içerik, hesap) tekil satır
--   content_view_counters     önceden hesaplanmış sayaç özeti (akış sorguları
--                             COUNT(*) çalıştırmaz)
--   content_view_daily        günlük toplulaştırılmış analitik
--   content_view_active_accounts  günlük benzersiz hesap (platform erişimi)
--   content_view_errors       sunucu tarafı hata günlüğü
--   view_count_settings       admin tarafından yönetilen eşikler
--
-- Tekillik ve yarış koşulu: birincil anahtar (content_type, content_id,
-- viewer_user_id) + INSERT ... ON CONFLICT DO NOTHING. Aynı anda gelen iki
-- istekten yalnızca biri satır ekler, yalnızca o sayaçı artırır.
--
-- Gizlilik: kullanıcı kimliği içeren tablolar RLS ile kapatılır; istemciler
-- yalnızca toplam sayı döndüren RPC'leri çağırabilir.
-- ---------------------------------------------------------------------------

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Tür sözlüğü
-- ---------------------------------------------------------------------------
create table if not exists public.view_content_types (
  code       text primary key,
  label      text not null,
  is_active  boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint view_content_types_code_check check (code ~ '^[a-z_]{3,40}$')
);

insert into public.view_content_types (code, label, sort_order) values
  ('post',                'Sosyal gönderi ve haber',   10),
  ('reel',                'Reels videosu',             20),
  ('marketplace_listing', 'Marketplace ilanı',         30),
  ('real_estate_listing', 'Emlak ilanı',               40),
  ('place',               'İşletme profili',           50),
  ('ride_offer',          'Yolculuk ilanı',            60),
  ('profile',             'Kullanıcı profili',         70),
  ('blog_post',           'Blog yazısı',               80)
on conflict (code) do update
  set label = excluded.label,
      sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 2. Eşik ayarları (tek satır)
-- ---------------------------------------------------------------------------
create table if not exists public.view_count_settings (
  id                         smallint primary key default 1,
  min_visible_ratio          numeric(4, 3) not null default 0.500,
  min_visible_ms             integer not null default 1000,
  video_min_play_ms          integer not null default 2000,
  batch_window_ms            integer not null default 1200,
  rate_limit_per_minute      integer not null default 150,
  daily_active_retention_days integer not null default 400,
  enabled                    boolean not null default true,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references public.profiles (id) on delete set null,
  constraint view_count_settings_singleton check (id = 1),
  constraint view_count_settings_ratio check (min_visible_ratio > 0 and min_visible_ratio <= 1),
  constraint view_count_settings_visible_ms check (min_visible_ms between 0 and 60000),
  constraint view_count_settings_video_ms check (video_min_play_ms between 0 and 60000),
  constraint view_count_settings_batch_ms check (batch_window_ms between 0 and 10000),
  constraint view_count_settings_rate check (rate_limit_per_minute between 1 and 5000),
  constraint view_count_settings_retention check (daily_active_retention_days between 30 and 3650)
);

insert into public.view_count_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Kaynak doğruluk tablosu
-- ---------------------------------------------------------------------------
create table if not exists public.content_unique_views (
  content_type   text not null references public.view_content_types (code) on delete restrict,
  content_id     uuid not null,
  viewer_user_id uuid not null references public.profiles (id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  surface        text,
  primary key (content_type, content_id, viewer_user_id)
);

-- Sayaç okuması birincil anahtarın ilk iki kolonuyla karşılanır; aşağıdaki
-- indeksler hesap silme, hız limiti ve zaman analitiği içindir.
create index if not exists content_unique_views_viewer_idx
  on public.content_unique_views (viewer_user_id, first_viewed_at desc);
create index if not exists content_unique_views_time_idx
  on public.content_unique_views (first_viewed_at desc);

-- ---------------------------------------------------------------------------
-- 4. Sayaç özeti
-- ---------------------------------------------------------------------------
create table if not exists public.content_view_counters (
  content_type    text not null references public.view_content_types (code) on delete restrict,
  content_id      uuid not null,
  unique_views    bigint not null default 0,
  legacy_views    bigint not null default 0,
  legacy_label    text,
  counted_since   timestamptz not null default now(),
  first_viewed_at timestamptz,
  last_viewed_at  timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (content_type, content_id),
  constraint content_view_counters_non_negative check (unique_views >= 0 and legacy_views >= 0)
);

create index if not exists content_view_counters_top_idx
  on public.content_view_counters (content_type, unique_views desc);

-- ---------------------------------------------------------------------------
-- 5. Günlük analitik
-- ---------------------------------------------------------------------------
create table if not exists public.content_view_daily (
  view_date    date not null,
  content_type text not null references public.view_content_types (code) on delete restrict,
  new_views    bigint not null default 0,
  primary key (view_date, content_type),
  constraint content_view_daily_non_negative check (new_views >= 0)
);

create table if not exists public.content_view_active_accounts (
  view_date       date not null,
  viewer_user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (view_date, viewer_user_id)
);

-- ---------------------------------------------------------------------------
-- 6. Hata günlüğü
-- ---------------------------------------------------------------------------
create table if not exists public.content_view_errors (
  id           bigserial primary key,
  content_type text,
  content_id   uuid,
  actor_id     uuid references public.profiles (id) on delete set null,
  error_code   text not null,
  message      text,
  created_at   timestamptz not null default now()
);

create index if not exists content_view_errors_time_idx
  on public.content_view_errors (created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Erişim yardımcısı — içerik sahibi + görünürlük
--
-- Tek yerden doğrulanır; hem kayıt hem sayaç okuma aynı kuralı kullanır.
-- Böylece gizli/silinmiş içeriğin sayacı sızdırılmaz.
-- ---------------------------------------------------------------------------
create or replace function public.view_content_access(p_content_type text, p_content_id uuid)
returns table (owner_id uuid, accessible boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_content_id is null then
    return;
  end if;

  if p_content_type = 'post' then
    return query
      select p.author_id,
             p.moderation_status = 'visible'
             and pr.account_status = 'active'
             and not public.is_blocked(v_uid, p.author_id)
             and (
               p.visibility = 'public'
               or p.author_id = v_uid
               or public.is_following(p.author_id)
             )
      from public.posts p
        join public.profiles pr on pr.id = p.author_id
      where p.id = p_content_id;
  elsif p_content_type = 'reel' then
    return query
      select r.author_id,
             r.moderation_status = 'visible'
             and r.status = 'ready'
             and pr.account_status = 'active'
             and (r.author_id = v_uid or not public.is_blocked(v_uid, r.author_id))
      from public.reels r
        join public.profiles pr on pr.id = r.author_id
      where r.id = p_content_id;
  elsif p_content_type = 'marketplace_listing' then
    return query
      select l.seller_id,
             (l.status = 'active' and l.moderation_status = 'visible')
             or l.seller_id = v_uid
      from public.marketplace_listings l
      where l.id = p_content_id;
  elsif p_content_type = 'real_estate_listing' then
    return query
      select l.owner_id,
             l.status = 'published' or l.owner_id = v_uid
      from public.real_estate_listings l
      where l.id = p_content_id;
  elsif p_content_type = 'place' then
    return query
      select coalesce(pl.owner_id, pl.created_by),
             pl.status = 'published'
             or pl.owner_id = v_uid
             or pl.created_by = v_uid
             or exists (
               select 1 from public.place_business_managers m
               where m.place_id = pl.id and m.user_id = v_uid
             )
      from public.places pl
      where pl.id = p_content_id;
  elsif p_content_type = 'ride_offer' then
    return query
      select o.driver_id,
             (o.status in ('published', 'full') and o.visibility = 'public')
             or o.driver_id = v_uid
      from public.ride_offers o
      where o.id = p_content_id;
  elsif p_content_type = 'profile' then
    return query
      select p.id,
             p.account_status = 'active'
             and (p.id = v_uid or public.can_view_profile_content(p.id))
      from public.profiles p
      where p.id = p_content_id;
  elsif p_content_type = 'blog_post' then
    return query
      select b.created_by,
             b.status = 'published'
             and b.published_at is not null
             and b.published_at <= now()
      from public.blog_posts b
      where b.id = p_content_id;
  end if;
end;
$$;

revoke all on function public.view_content_access(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Kayıt RPC'si (atomik)
-- ---------------------------------------------------------------------------
create or replace function public.content_register_view(
  p_content_type text,
  p_content_id   uuid,
  p_surface      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_type      text := lower(btrim(coalesce(p_content_type, '')));
  v_owner     uuid;
  v_access    boolean := false;
  v_enabled   boolean := true;
  v_limit     integer := 150;
  v_recent    integer := 0;
  v_count     bigint := 0;
  v_inserted  boolean := false;
  v_surface   text;
  v_today     date := (now() at time zone 'utc')::date;
begin
  if v_uid is null then
    return jsonb_build_object('counted', false, 'reason', 'auth_required', 'unique_views', 0);
  end if;

  if not exists (
    select 1 from public.view_content_types t where t.code = v_type and t.is_active
  ) then
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;

  select s.enabled, s.rate_limit_per_minute
    into v_enabled, v_limit
  from public.view_count_settings s
  where s.id = 1;

  v_enabled := coalesce(v_enabled, true);
  v_limit := coalesce(v_limit, 150);

  if not v_enabled then
    select c.unique_views into v_count
    from public.content_view_counters c
    where c.content_type = v_type and c.content_id = p_content_id;
    return jsonb_build_object(
      'counted', false,
      'reason', 'disabled',
      'unique_views', coalesce(v_count, 0)
    );
  end if;

  select a.owner_id, a.accessible into v_owner, v_access
  from public.view_content_access(v_type, p_content_id) a
  limit 1;

  if not coalesce(v_access, false) then
    return jsonb_build_object(
      'counted', false,
      'reason', 'not_available',
      'unique_views', 0
    );
  end if;

  if v_owner is not null and v_owner = v_uid then
    select c.unique_views into v_count
    from public.content_view_counters c
    where c.content_type = v_type and c.content_id = p_content_id;
    return jsonb_build_object(
      'counted', false,
      'reason', 'owner',
      'unique_views', coalesce(v_count, 0)
    );
  end if;

  -- Kötüye kullanım freni: dakikada sınırlı sayıda YENİ kayıt.
  -- Tekrar açılan içerik yeni satır üretmediği için bu kontrolü etkilemez.
  select count(*) into v_recent
  from public.content_unique_views v
  where v.viewer_user_id = v_uid
    and v.first_viewed_at > now() - interval '1 minute';

  if v_recent >= v_limit then
    select c.unique_views into v_count
    from public.content_view_counters c
    where c.content_type = v_type and c.content_id = p_content_id;
    return jsonb_build_object(
      'counted', false,
      'reason', 'rate_limited',
      'unique_views', coalesce(v_count, 0)
    );
  end if;

  v_surface := nullif(left(btrim(coalesce(p_surface, '')), 40), '');

  insert into public.content_unique_views (
    content_type, content_id, viewer_user_id, first_viewed_at, surface
  ) values (
    v_type, p_content_id, v_uid, now(), v_surface
  )
  on conflict (content_type, content_id, viewer_user_id) do nothing;

  v_inserted := found;

  if v_inserted then
    insert into public.content_view_counters as c (
      content_type, content_id, unique_views, first_viewed_at, last_viewed_at, updated_at
    ) values (
      v_type, p_content_id, 1, now(), now(), now()
    )
    on conflict (content_type, content_id) do update
      set unique_views = c.unique_views + 1,
          last_viewed_at = excluded.last_viewed_at,
          updated_at = excluded.updated_at
    returning c.unique_views into v_count;

    insert into public.content_view_daily as d (view_date, content_type, new_views)
    values (v_today, v_type, 1)
    on conflict (view_date, content_type) do update
      set new_views = d.new_views + 1;

    insert into public.content_view_active_accounts (view_date, viewer_user_id)
    values (v_today, v_uid)
    on conflict do nothing;

    -- Reels tablosunun eski sayacı zaten tekil kayıtlardan geliyordu; profil
    -- ızgarası ve mevcut Reels RPC'leri aynı değeri okumaya devam etsin.
    if v_type = 'reel' then
      update public.reels set view_count = view_count + 1 where id = p_content_id;
    end if;
  else
    select c.unique_views into v_count
    from public.content_view_counters c
    where c.content_type = v_type and c.content_id = p_content_id;
  end if;

  return jsonb_build_object(
    'counted', v_inserted,
    'unique_views', coalesce(v_count, 0),
    'content_type', v_type,
    'content_id', p_content_id
  );
end;
$$;

revoke all on function public.content_register_view(text, uuid, text) from public, anon;
grant execute on function public.content_register_view(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Toplu kayıt — görünürlük eşiğini geçen içerikler tek ağ turunda
-- ---------------------------------------------------------------------------
create or replace function public.content_register_views(p_views jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item    jsonb;
  v_result  jsonb;
  v_items   jsonb := '[]'::jsonb;
  v_type    text;
  v_id      uuid;
  v_total   integer := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('items', '[]'::jsonb, 'auth_required', true);
  end if;

  for v_item in
    select elem from jsonb_array_elements(coalesce(p_views, '[]'::jsonb)) as t(elem)
  loop
    exit when v_total >= 20;
    v_total := v_total + 1;
    v_id := null;
    v_type := lower(btrim(coalesce(v_item ->> 'type', '')));
    begin
      v_id := (v_item ->> 'id')::uuid;
      v_result := public.content_register_view(v_type, v_id, v_item ->> 'surface');
      v_items := v_items || jsonb_build_array(v_result);
    exception when others then
      insert into public.content_view_errors (content_type, content_id, actor_id, error_code, message)
      values (
        nullif(v_type, ''),
        v_id,
        auth.uid(),
        sqlstate,
        left(sqlerrm, 300)
      );
      v_items := v_items || jsonb_build_array(
        jsonb_build_object('counted', false, 'reason', 'error', 'unique_views', 0)
      );
    end;
  end loop;

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.content_register_views(jsonb) from public, anon;
grant execute on function public.content_register_views(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Sayaç okuma (önbelleklenebilir özet)
-- ---------------------------------------------------------------------------
create or replace function public.content_view_counts(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_item   jsonb;
  v_items  jsonb := '[]'::jsonb;
  v_type   text;
  v_id     uuid;
  v_access boolean;
  v_row    public.content_view_counters%rowtype;
  v_total  integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

  for v_item in
    select elem from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(elem)
  loop
    exit when v_total >= 60;
    v_total := v_total + 1;
    v_type := lower(btrim(coalesce(v_item ->> 'type', '')));
    begin
      v_id := (v_item ->> 'id')::uuid;
    exception when others then
      continue;
    end;

    if not exists (
      select 1 from public.view_content_types t where t.code = v_type
    ) then
      continue;
    end if;

    select a.accessible into v_access
    from public.view_content_access(v_type, v_id) a
    limit 1;

    if not coalesce(v_access, false) then
      continue;
    end if;

    select * into v_row
    from public.content_view_counters c
    where c.content_type = v_type and c.content_id = v_id;

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'content_type', v_type,
        'content_id', v_id,
        'unique_views', coalesce(v_row.unique_views, 0),
        'legacy_views', coalesce(v_row.legacy_views, 0)
      )
    );
  end loop;

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.content_view_counts(jsonb) from public, anon;
grant execute on function public.content_view_counts(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. İçerik sahibi analitiği
-- ---------------------------------------------------------------------------
create or replace function public.content_view_owner_stats(
  p_content_type text,
  p_content_id   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_type    text := lower(btrim(coalesce(p_content_type, '')));
  v_owner   uuid;
  v_access  boolean := false;
  v_counter public.content_view_counters%rowtype;
  v_metrics jsonb := '{}'::jsonb;
  v_series  jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select a.owner_id, a.accessible into v_owner, v_access
  from public.view_content_access(v_type, p_content_id) a
  limit 1;

  if not coalesce(v_access, false) then
    return null;
  end if;

  if v_owner is not null and v_owner is distinct from v_uid and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_counter
  from public.content_view_counters c
  where c.content_type = v_type and c.content_id = p_content_id;

  if v_type = 'post' then
    select jsonb_build_object(
      'like_count', p.like_count,
      'comment_count', p.comment_count,
      'save_count', p.save_count,
      'share_count', p.share_count,
      'created_at', p.created_at
    ) into v_metrics
    from public.posts p where p.id = p_content_id;
  elsif v_type = 'reel' then
    select jsonb_build_object(
      'like_count', r.like_count,
      'comment_count', r.comment_count,
      'save_count', r.save_count,
      'created_at', r.created_at
    ) into v_metrics
    from public.reels r where r.id = p_content_id;
  elsif v_type = 'marketplace_listing' then
    select jsonb_build_object(
      'like_count', l.favorite_count,
      'comment_count', 0,
      'save_count', l.favorite_count,
      'share_count', 0,
      'created_at', l.created_at
    ) into v_metrics
    from public.marketplace_listings l where l.id = p_content_id;
  elsif v_type = 'real_estate_listing' then
    select jsonb_build_object(
      'like_count', l.favorite_count,
      'comment_count', 0,
      'save_count', l.favorite_count,
      'share_count', 0,
      'created_at', l.created_at
    ) into v_metrics
    from public.real_estate_listings l where l.id = p_content_id;
  elsif v_type = 'place' then
    select jsonb_build_object(
      'like_count', pl.favorite_count,
      'comment_count', pl.review_count,
      'save_count', pl.favorite_count,
      'share_count', 0,
      'rating_avg', pl.rating_avg,
      'created_at', pl.created_at
    ) into v_metrics
    from public.places pl where pl.id = p_content_id;
  elsif v_type = 'ride_offer' then
    select jsonb_build_object(
      'like_count', 0,
      'comment_count', 0,
      'save_count', 0,
      'share_count', 0,
      'created_at', o.created_at
    ) into v_metrics
    from public.ride_offers o where o.id = p_content_id;
  elsif v_type = 'profile' then
    select jsonb_build_object(
      'like_count', (select count(*) from public.user_follows f where f.following_id = p_content_id),
      'comment_count', 0,
      'save_count', 0,
      'share_count', 0,
      'created_at', p.created_at
    ) into v_metrics
    from public.profiles p where p.id = p_content_id;
  elsif v_type = 'blog_post' then
    select jsonb_build_object(
      'like_count', 0,
      'comment_count', 0,
      'save_count', 0,
      'share_count', 0,
      'created_at', b.created_at
    ) into v_metrics
    from public.blog_posts b where b.id = p_content_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('date', d.day, 'views', d.views)
      order by d.day
    ),
    '[]'::jsonb
  ) into v_series
  from (
    select (v.first_viewed_at at time zone 'utc')::date as day, count(*) as views
    from public.content_unique_views v
    where v.content_type = v_type
      and v.content_id = p_content_id
      and v.first_viewed_at > now() - interval '30 days'
    group by 1
  ) d;

  return jsonb_build_object(
    'content_type', v_type,
    'content_id', p_content_id,
    'unique_views', coalesce(v_counter.unique_views, 0),
    'legacy_views', coalesce(v_counter.legacy_views, 0),
    'legacy_label', v_counter.legacy_label,
    'counted_since', coalesce(v_counter.counted_since, now()),
    'first_viewed_at', v_counter.first_viewed_at,
    'last_viewed_at', v_counter.last_viewed_at,
    'metrics', coalesce(v_metrics, '{}'::jsonb),
    'series', v_series
  );
end;
$$;

revoke all on function public.content_view_owner_stats(text, uuid) from public, anon;
grant execute on function public.content_view_owner_stats(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Yönetici: ayarlar ve analitik
-- ---------------------------------------------------------------------------
-- Yetki kontrolü yapmayan iç yardımcı: iki yönetici fonksiyonu da kullanır,
-- böylece ayar güncellemesi farklı bir izin yüzünden geri alınmaz.
create or replace function public.view_count_settings_json()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'min_visible_ratio', s.min_visible_ratio,
    'min_visible_ms', s.min_visible_ms,
    'video_min_play_ms', s.video_min_play_ms,
    'batch_window_ms', s.batch_window_ms,
    'rate_limit_per_minute', s.rate_limit_per_minute,
    'daily_active_retention_days', s.daily_active_retention_days,
    'enabled', s.enabled,
    'updated_at', s.updated_at
  )
  from public.view_count_settings s
  where s.id = 1;
$$;

revoke all on function public.view_count_settings_json() from public, anon, authenticated;

create or replace function public.admin_view_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('report.view');
  return public.view_count_settings_json();
end;
$$;

revoke all on function public.admin_view_settings() from public, anon;
grant execute on function public.admin_view_settings() to authenticated;

create or replace function public.admin_view_settings_update(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('settings.manage', true);
begin
  update public.view_count_settings
  set
    min_visible_ratio = coalesce((p_settings ->> 'min_visible_ratio')::numeric, min_visible_ratio),
    min_visible_ms = coalesce((p_settings ->> 'min_visible_ms')::integer, min_visible_ms),
    video_min_play_ms = coalesce((p_settings ->> 'video_min_play_ms')::integer, video_min_play_ms),
    batch_window_ms = coalesce((p_settings ->> 'batch_window_ms')::integer, batch_window_ms),
    rate_limit_per_minute = coalesce((p_settings ->> 'rate_limit_per_minute')::integer, rate_limit_per_minute),
    daily_active_retention_days = coalesce((p_settings ->> 'daily_active_retention_days')::integer, daily_active_retention_days),
    enabled = coalesce((p_settings ->> 'enabled')::boolean, enabled),
    updated_at = now(),
    updated_by = v_uid
  where id = 1;

  return public.view_count_settings_json();
end;
$$;

revoke all on function public.admin_view_settings_update(jsonb) from public, anon;
grant execute on function public.admin_view_settings_update(jsonb) to authenticated;

create or replace function public.admin_view_analytics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_result jsonb;
begin
  perform public.tz_admin_require('report.view');

  select jsonb_build_object(
    'generated_at', now(),
    'today', jsonb_build_object(
      'views', coalesce((select sum(new_views) from public.content_view_daily where view_date = v_today), 0),
      'accounts', coalesce((select count(*) from public.content_view_active_accounts where view_date = v_today), 0)
    ),
    'week', jsonb_build_object(
      'views', coalesce((select sum(new_views) from public.content_view_daily where view_date >= v_today - 6), 0),
      'accounts', coalesce((select count(*) from (
        select distinct viewer_user_id from public.content_view_active_accounts where view_date >= v_today - 6
      ) a), 0)
    ),
    'month', jsonb_build_object(
      'views', coalesce((select sum(new_views) from public.content_view_daily where view_date >= v_today - 29), 0),
      'accounts', coalesce((select count(*) from (
        select distinct viewer_user_id from public.content_view_active_accounts where view_date >= v_today - 29
      ) a), 0)
    ),
    'lifetime', jsonb_build_object(
      'views', coalesce((select sum(unique_views) from public.content_view_counters), 0),
      'accounts', coalesce((select count(distinct viewer_user_id) from public.content_unique_views), 0),
      'records', coalesce((select count(*) from public.content_unique_views), 0)
    ),
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object(
        'content_type', t.code,
        'label', t.label,
        'views', coalesce(c.total, 0),
        'contents', coalesce(c.contents, 0)
      ) order by coalesce(c.total, 0) desc)
      from public.view_content_types t
        left join (
          select content_type, sum(unique_views) as total, count(*) as contents
          from public.content_view_counters
          group by content_type
        ) c on c.content_type = t.code
    ), '[]'::jsonb),
    'daily_series', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.view_date, 'views', d.views) order by d.view_date)
      from (
        select view_date, sum(new_views) as views
        from public.content_view_daily
        where view_date >= v_today - 29
        group by view_date
      ) d
    ), '[]'::jsonb),
    'top_posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'title', x.title,
        'unique_views', x.unique_views,
        'legacy_views', x.legacy_views,
        'author_username', x.author_username,
        'is_news', x.is_news
      ) order by x.unique_views desc)
      from (
        select c.content_id as id,
               left(coalesce(p.body, 'Gönderi'), 90) as title,
               c.unique_views,
               c.legacy_views,
               pr.username as author_username,
               exists (select 1 from public.ai_news_publications pub where pub.post_id = p.id and pub.status = 'published')
                 or exists (select 1 from public.news_publication_links l where l.post_id = p.id) as is_news
        from public.content_view_counters c
          join public.posts p on p.id = c.content_id
          join public.profiles pr on pr.id = p.author_id
        where c.content_type = 'post'
        order by c.unique_views desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'top_news', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'title', x.title,
        'unique_views', x.unique_views,
        'author_username', x.author_username
      ) order by x.unique_views desc)
      from (
        select c.content_id as id,
               left(coalesce(p.body, 'Haber'), 90) as title,
               c.unique_views,
               pr.username as author_username
        from public.content_view_counters c
          join public.posts p on p.id = c.content_id
          join public.profiles pr on pr.id = p.author_id
        where c.content_type = 'post'
          and (
            exists (select 1 from public.ai_news_publications pub where pub.post_id = p.id and pub.status = 'published')
            or exists (select 1 from public.news_publication_links l where l.post_id = p.id)
          )
        order by c.unique_views desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'top_marketplace', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'unique_views', x.unique_views
      ) order by x.unique_views desc)
      from (
        select c.content_id as id, l.title, c.unique_views
        from public.content_view_counters c
          join public.marketplace_listings l on l.id = c.content_id
        where c.content_type = 'marketplace_listing'
        order by c.unique_views desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'top_reels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'unique_views', x.unique_views
      ) order by x.unique_views desc)
      from (
        select c.content_id as id,
               left(coalesce(r.caption, 'Reels'), 90) as title,
               c.unique_views
        from public.content_view_counters c
          join public.reels r on r.id = c.content_id
        where c.content_type = 'reel'
        order by c.unique_views desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'top_places', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'unique_views', x.unique_views
      ) order by x.unique_views desc)
      from (
        select c.content_id as id, pl.name as title, c.unique_views
        from public.content_view_counters c
          join public.places pl on pl.id = c.content_id
        where c.content_type = 'place'
        order by c.unique_views desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'suspicious', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', x.viewer_user_id,
        'username', x.username,
        'views', x.views
      ) order by x.views desc)
      from (
        select v.viewer_user_id, pr.username, count(*) as views
        from public.content_unique_views v
          join public.profiles pr on pr.id = v.viewer_user_id
        where v.first_viewed_at > now() - interval '24 hours'
        group by v.viewer_user_id, pr.username
        having count(*) >= 120
        order by count(*) desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'errors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'content_type', e.content_type,
        'content_id', e.content_id,
        'error_code', e.error_code,
        'message', e.message,
        'created_at', e.created_at
      ) order by e.created_at desc)
      from (
        select * from public.content_view_errors order by created_at desc limit 20
      ) e
    ), '[]'::jsonb),
    'settings', public.view_count_settings_json()
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_view_analytics() from public, anon;
grant execute on function public.admin_view_analytics() to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Saklama / bakım
-- ---------------------------------------------------------------------------
create or replace function public.content_view_prune()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := 400;
  v_accounts integer := 0;
  v_errors integer := 0;
begin
  select daily_active_retention_days into v_days from public.view_count_settings where id = 1;

  delete from public.content_view_active_accounts
  where view_date < (now() at time zone 'utc')::date - coalesce(v_days, 400);
  get diagnostics v_accounts = row_count;

  delete from public.content_view_errors
  where created_at < now() - interval '180 days';
  get diagnostics v_errors = row_count;

  return jsonb_build_object('active_account_rows', v_accounts, 'error_rows', v_errors);
end;
$$;

revoke all on function public.content_view_prune() from public, anon, authenticated;
grant execute on function public.content_view_prune() to service_role;

-- ---------------------------------------------------------------------------
-- 14. İçerik silindiğinde kayıt temizliği
-- ---------------------------------------------------------------------------
create or replace function public.view_content_cleanup_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := tg_argv[0];
  v_id   uuid;
begin
  v_id := (to_jsonb(old) ->> 'id')::uuid;
  if v_id is null then
    return old;
  end if;
  delete from public.content_unique_views
  where content_type = v_type and content_id = v_id and viewer_user_id is not null;
  delete from public.content_view_counters
  where content_type = v_type and content_id = v_id;
  return old;
end;
$$;

revoke all on function public.view_content_cleanup_trigger() from public, anon, authenticated;

do $$
declare
  v_pair record;
begin
  for v_pair in
    select * from (values
      ('posts', 'post'),
      ('reels', 'reel'),
      ('marketplace_listings', 'marketplace_listing'),
      ('real_estate_listings', 'real_estate_listing'),
      ('places', 'place'),
      ('ride_offers', 'ride_offer'),
      ('blog_posts', 'blog_post'),
      ('profiles', 'profile')
    ) as t(table_name, content_type)
  loop
    execute format(
      'drop trigger if exists view_cleanup_%1$s on public.%1$I',
      v_pair.table_name
    );
    execute format(
      'create trigger view_cleanup_%1$s after delete on public.%1$I for each row execute function public.view_content_cleanup_trigger(%2$L)',
      v_pair.table_name,
      v_pair.content_type
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. Eski içeriklerin geçişi
--
-- Eski toplam sayaçlar silinmez; `legacy_views` olarak ayrı tutulur ve tekil
-- sayaç gibi SUNULMAZ. Reels istisnadır: eski sayacı zaten tekil
-- `reel_views` kayıtlarından geliyordu, bu yüzden doğrudan tekil havuza taşınır.
-- ---------------------------------------------------------------------------
insert into public.content_unique_views (content_type, content_id, viewer_user_id, first_viewed_at, surface)
select 'reel', v.reel_id, v.viewer_id, v.viewed_at, 'legacy'
from public.reel_views v
on conflict do nothing;

insert into public.content_view_daily as d (view_date, content_type, new_views)
select (v.viewed_at at time zone 'utc')::date, 'reel', count(*)
from public.reel_views v
group by 1
on conflict (view_date, content_type) do nothing;

insert into public.content_view_counters (
  content_type, content_id, unique_views, legacy_views, legacy_label,
  counted_since, first_viewed_at, last_viewed_at, updated_at
)
select 'reel', r.id,
       coalesce(v.total, 0), 0, null,
       now(), v.first_at, v.last_at, now()
from public.reels r
  left join (
    select content_id,
           count(*) as total,
           min(first_viewed_at) as first_at,
           max(first_viewed_at) as last_at
    from public.content_unique_views
    where content_type = 'reel'
    group by content_id
  ) v on v.content_id = r.id
on conflict (content_type, content_id) do nothing;

insert into public.content_view_counters (
  content_type, content_id, unique_views, legacy_views, legacy_label, counted_since
)
select 'post', p.id, 0, 0, null, now()
from public.posts p
on conflict (content_type, content_id) do nothing;

insert into public.content_view_counters (
  content_type, content_id, unique_views, legacy_views, legacy_label, counted_since
)
select 'marketplace_listing', l.id, 0, greatest(l.view_count, 0),
       'Toplam görüntüleme (tekil doğrulanmamış)', now()
from public.marketplace_listings l
on conflict (content_type, content_id) do nothing;

insert into public.content_view_counters (
  content_type, content_id, unique_views, legacy_views, legacy_label, counted_since
)
select 'real_estate_listing', l.id, 0, greatest(l.view_count, 0),
       'Toplam görüntüleme (tekil doğrulanmamış)', now()
from public.real_estate_listings l
on conflict (content_type, content_id) do nothing;

insert into public.content_view_counters (
  content_type, content_id, unique_views, legacy_views, legacy_label, counted_since
)
select 'place', pl.id, 0, greatest(pl.view_count, 0),
       'Toplam görüntüleme (tekil doğrulanmamış)', now()
from public.places pl
on conflict (content_type, content_id) do nothing;

insert into public.content_view_counters (
  content_type, content_id, unique_views, legacy_views, legacy_label, counted_since
)
select 'ride_offer', o.id, 0, 0, null, now()
from public.ride_offers o
on conflict (content_type, content_id) do nothing;

insert into public.content_view_counters (
  content_type, content_id, unique_views, legacy_views, legacy_label, counted_since
)
select 'profile', p.id, 0, 0, null, now()
from public.profiles p
on conflict (content_type, content_id) do nothing;

insert into public.content_view_counters (
  content_type, content_id, unique_views, legacy_views, legacy_label, counted_since
)
select 'blog_post', b.id, 0, greatest(b.view_count, 0),
       'Toplam görüntüleme (tekil doğrulanmamış)', now()
from public.blog_posts b
on conflict (content_type, content_id) do nothing;

-- ---------------------------------------------------------------------------
-- 16. Reels ve blog: mevcut tekil/toplam akışlarını merkezi sisteme bağla
-- ---------------------------------------------------------------------------
create or replace function public.reel_register_view(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.content_register_view('reel', p_reel_id, 'reels');
  return jsonb_build_object(
    'view_count', coalesce((v_result ->> 'unique_views')::bigint, 0),
    'counted', coalesce((v_result ->> 'counted')::boolean, false)
  );
end;
$$;

revoke all on function public.reel_register_view(uuid) from public, anon;
grant execute on function public.reel_register_view(uuid) to authenticated;

create or replace function public.blog_track_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select b.id into v_id
  from public.blog_posts b
  where b.slug = lower(btrim(coalesce(p_slug, '')))
    and b.status = 'published'
    and b.published_at is not null
    and b.published_at <= now();

  if v_id is null then
    return;
  end if;

  perform public.content_register_view('blog_post', v_id, 'blog');
end;
$$;

revoke all on function public.blog_track_view(text) from public, anon;
grant execute on function public.blog_track_view(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 17. Akış JSON'una tekil sayaç
-- ---------------------------------------------------------------------------
create or replace function public.tz_post_json(p_post_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'author_id', p.author_id,
    'author_username', pr.username,
    'author_first_name', pr.first_name,
    'author_last_name', pr.last_name,
    'author_avatar_path', pr.avatar_path,
    'author_is_verified', pr.is_verified,
    'body', p.body,
    'visibility', p.visibility,
    'city', p.city,
    'moderation_status', p.moderation_status,
    'like_count', p.like_count,
    'comment_count', p.comment_count,
    'save_count', p.save_count,
    'share_count', p.share_count,
    'view_count', coalesce(c.unique_views, 0),
    'view_legacy_count', coalesce(c.legacy_views, 0),
    'is_edited', p.is_edited,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'liked', exists (
      select 1 from public.post_likes l where l.post_id = p.id and l.user_id = p_me
    ),
    'saved', exists (
      select 1 from public.post_saves s where s.post_id = p.id and s.user_id = p_me
    ),
    'is_mine', p.author_id = p_me,
    'news', public.ai_news_post_meta(p.id),
    'source', public.news_source_post_meta(p.id),
    'media', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'storage_path', m.storage_path,
            'thumbnail_path', m.thumbnail_path,
            'media_type', m.media_type,
            'width', m.width,
            'height', m.height,
            'duration_ms', m.duration_ms,
            'display_fit', m.display_fit
          )
          order by m.sort_order, m.created_at
        )
        from public.post_media m
        where m.post_id = p.id
      ),
      '[]'::jsonb
    )
  )
  from public.posts p
    join public.profiles pr on pr.id = p.author_id
    left join public.content_view_counters c
      on c.content_type = 'post' and c.content_id = p.id
  where p.id = p_post_id;
$$;

revoke all on function public.tz_post_json(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 18. RLS ve yetkiler
-- ---------------------------------------------------------------------------
alter table public.view_content_types enable row level security;
alter table public.view_count_settings enable row level security;
alter table public.content_unique_views enable row level security;
alter table public.content_view_counters enable row level security;
alter table public.content_view_daily enable row level security;
alter table public.content_view_active_accounts enable row level security;
alter table public.content_view_errors enable row level security;

drop policy if exists view_content_types_read on public.view_content_types;
create policy view_content_types_read on public.view_content_types
  for select to authenticated, anon using (true);

drop policy if exists view_count_settings_read on public.view_count_settings;
create policy view_count_settings_read on public.view_count_settings
  for select to authenticated using (true);

-- Kimlik içeren tablolara doğrudan erişim yok: yalnızca RPC'ler.
revoke all on public.content_unique_views from public, anon, authenticated;
revoke all on public.content_view_counters from public, anon, authenticated;
revoke all on public.content_view_daily from public, anon, authenticated;
revoke all on public.content_view_active_accounts from public, anon, authenticated;
revoke all on public.content_view_errors from public, anon, authenticated;
revoke insert, update, delete on public.view_content_types from public, anon, authenticated;
revoke insert, update, delete on public.view_count_settings from public, anon, authenticated;

grant select on public.view_content_types to authenticated, anon;
grant select on public.view_count_settings to authenticated;

-- Eski doğrudan tekil tabloyu da kilitle: merkezi sistem tek doğruluk kaynağı.
revoke all on public.reel_views from public, anon, authenticated;
