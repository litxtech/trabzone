-- 0138: Anlık Haber ve Vatandaş Muhabirliği (V1)
--
-- Tasarım ilkeleri:
--   * Yeni bir sosyal medya arka ucu yok. Her anlık gelişme normal bir
--     `posts` kaydıdır; medya `post_media`, etkileşim mevcut sayaçlar ve
--     yorum/beğeni/kaydetme RPC'leridir.
--   * `live_news.post_id` kanonik içerik kimliğidir. Aynı içerik akışta,
--     Reels'te, Anlık Gelişmeler alanında, profil sekmesinde ve web
--     sayfasında bu tek kimlikle görünür. Medya fiziksel olarak kopyalanmaz;
--     Reels kaydı aynı `post_media` yolunu `storage_bucket = 'posts'` ile
--     paylaşır.
--   * Tüm yazmalar SECURITY DEFINER RPC'lerden geçer. Tablolarda RLS açıktır;
--     gizli/moderasyon bekleyen içerik yalnızca sahibine ve yöneticiye görünür.
--   * Yüksek riskli içerik (kaza, yaralı, suç, çocuk, afet...) otomatik olarak
--     moderasyon kuyruğuna alınır; yayınlanmaz. "Doğrulandı" yalnızca editör
--     kararıyla verilir; AI veya beğeni tek başına doğrulama sayılmaz.
--   * Kullanıcının kendi paylaşımına doğrulama rozeti vermesi engellenir.

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 0. Yetkiler
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr) values
  ('live_news.view',   'Anlık Haber yönetim panelini ve vatandaş haber havuzunu görüntüleme'),
  ('live_news.manage', 'Anlık Haber inceleme, doğrulama, kaldırma ve haber merkezine aktarma')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'live_news.view'), ('admin', 'live_news.manage'),
  ('moderator', 'live_news.view'), ('moderator', 'live_news.manage')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. Reels: kanonik medyayı paylaşma
-- ---------------------------------------------------------------------------
alter table public.reels
  add column if not exists storage_bucket text not null default 'reels';
alter table public.reels
  add column if not exists live_news_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reels_storage_bucket_check'
  ) then
    alter table public.reels
      add constraint reels_storage_bucket_check
      check (storage_bucket in ('posts', 'reels'));
  end if;
end
$$;

create index if not exists reels_live_news_idx on public.reels (live_news_id)
  where live_news_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Bildirim türleri
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (
    kind in (
      'follow','like','comment','message','group_invite','order','market_message',
      'support','security','system','mention','ride','news',
      'live_news','live_news_verified','live_news_moderation'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Çekirdek tablo
-- ---------------------------------------------------------------------------
create table if not exists public.live_news (
  post_id             uuid primary key references public.posts (id) on delete cascade,
  author_id           uuid not null references public.profiles (id) on delete cascade,
  canonical_id        uuid not null default gen_random_uuid(),
  title               text not null,
  summary             text,
  category            text not null default 'guncel',
  city                text not null default 'Trabzon',
  district            text,
  location_precision  text not null default 'district',
  coordinates_lat     double precision,
  coordinates_lng     double precision,
  source_note         text,
  publish_targets     text[] not null default array['feed', 'live', 'web']::text[],
  cross_post_reel     boolean not null default false,
  reel_id             uuid,
  media_kind          text not null default 'text',
  verification_status text not null default 'citizen',
  verification_note   text,
  verified_at         timestamptz,
  verified_by         uuid references public.profiles (id) on delete set null,
  moderation_status   text not null default 'pending',
  moderation_reason   text,
  risk_level          text not null default 'low',
  risk_flags          jsonb not null default '[]'::jsonb,
  usage_consent       boolean not null default false,
  attribution         text,
  newsroom_state      text not null default 'none',
  editorial_note      text,
  reports_count       integer not null default 0,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint live_news_canonical_key unique (canonical_id),
  constraint live_news_title_length check (char_length(title) between 6 and 140),
  constraint live_news_summary_length check (
    summary is null or char_length(summary) between 1 and 1200
  ),
  constraint live_news_category_check check (category in (
    'guncel', 'trafik', 'hava', 'etkinlik', 'spor', 'guvenlik', 'altyapi'
  )),
  constraint live_news_precision_check check (
    location_precision in ('none', 'district', 'city', 'approximate')
  ),
  constraint live_news_media_kind_check check (
    media_kind in ('text', 'photo', 'video', 'mixed')
  ),
  constraint live_news_verification_check check (verification_status in (
    'citizen', 'reviewing', 'verified', 'corrected', 'unverified', 'removed'
  )),
  constraint live_news_moderation_check check (
    moderation_status in ('pending', 'visible', 'hidden', 'removed')
  ),
  constraint live_news_risk_check check (risk_level in ('low', 'medium', 'high')),
  constraint live_news_newsroom_check check (
    newsroom_state in ('none', 'pool', 'reviewing', 'newsroom', 'published', 'rejected')
  ),
  constraint live_news_reports_non_negative check (reports_count >= 0),
  constraint live_news_targets_check check (
    publish_targets <@ array['feed', 'reels', 'live', 'web']::text[]
  ),
  constraint live_news_risk_flags_array check (jsonb_typeof(risk_flags) = 'array')
);

create index if not exists live_news_feed_idx
  on public.live_news (created_at desc)
  where moderation_status = 'visible';
create index if not exists live_news_category_idx
  on public.live_news (category, created_at desc)
  where moderation_status = 'visible';
create index if not exists live_news_district_idx
  on public.live_news (district, created_at desc)
  where moderation_status = 'visible';
create index if not exists live_news_verified_idx
  on public.live_news (verified_at desc)
  where verification_status = 'verified' and moderation_status = 'visible';
create index if not exists live_news_pending_idx
  on public.live_news (created_at)
  where moderation_status = 'pending';
create index if not exists live_news_author_idx
  on public.live_news (author_id, created_at desc);
create index if not exists live_news_newsroom_idx
  on public.live_news (newsroom_state, created_at desc);
create index if not exists live_news_coords_idx
  on public.live_news (coordinates_lat, coordinates_lng)
  where coordinates_lat is not null and coordinates_lng is not null;

alter table public.live_news enable row level security;

-- Yalnızca yayındaki kayıtlar; sahibi ve yönetici kendi/bekleyen kaydını görür.
drop policy if exists live_news_select_visible on public.live_news;
create policy live_news_select_visible on public.live_news
  for select to authenticated
  using (
    (
      moderation_status = 'visible'
      and exists (
        select 1 from public.posts p
        where p.id = live_news.post_id and p.moderation_status = 'visible'
      )
    )
    or author_id = auth.uid()
    or public.is_admin()
  );

revoke all on public.live_news from public, anon, authenticated;
grant select on public.live_news to authenticated;

-- Realtime: yeni gelişmeler istemciye itilir. RLS gizli kayıtları filtreler.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'live_news'
     ) then
    alter publication supabase_realtime add table public.live_news;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Yardımcı tablolar
-- ---------------------------------------------------------------------------
create table if not exists public.live_news_preferences (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  followed_people   boolean not null default true,
  district_updates  boolean not null default true,
  verified_only     boolean not null default false,
  district          text,
  updated_at        timestamptz not null default now()
);

alter table public.live_news_preferences enable row level security;
revoke all on public.live_news_preferences from public, anon, authenticated;

create table if not exists public.live_news_notification_log (
  live_news_id uuid not null references public.live_news (post_id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null,
  created_at   timestamptz not null default now(),
  primary key (live_news_id, user_id, kind)
);

alter table public.live_news_notification_log enable row level security;
revoke all on public.live_news_notification_log from public, anon, authenticated;

-- Aynı yayın isteği (ağ yeniden denemesi) iki içerik üretmesin.
create table if not exists public.live_news_idempotency (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  idempotency_key text not null,
  post_id         uuid not null references public.live_news (post_id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, idempotency_key),
  constraint live_news_idempotency_key_length check (
    char_length(idempotency_key) between 8 and 120
  )
);

alter table public.live_news_idempotency enable row level security;
revoke all on public.live_news_idempotency from public, anon, authenticated;

create table if not exists public.live_news_ai_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  action      text not null,
  model       text,
  ok          boolean not null default true,
  error_code  text,
  tokens_in   integer,
  tokens_out  integer,
  duration_ms integer,
  created_at  timestamptz not null default now()
);

create index if not exists live_news_ai_logs_user_idx
  on public.live_news_ai_logs (user_id, created_at desc);

alter table public.live_news_ai_logs enable row level security;
revoke all on public.live_news_ai_logs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Doğrulama / normalizasyon
-- ---------------------------------------------------------------------------
create or replace function public.live_news_districts()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'Akçaabat', 'Araklı', 'Arsin', 'Beşikdüzü', 'Çarşıbaşı', 'Çaykara',
    'Dernekpazarı', 'Düzköy', 'Hayrat', 'Köprübaşı', 'Maçka', 'Of',
    'Ortahisar', 'Sürmene', 'Şalpazarı', 'Tonya', 'Vakfıkebir', 'Yomra'
  ]::text[];
$$;

revoke all on function public.live_news_districts() from public, anon, authenticated;
grant execute on function public.live_news_districts() to authenticated;

create or replace function public.tz_live_news_risk(
  p_title   text,
  p_summary text,
  p_category text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_text   text := lower(coalesce(p_title, '') || ' ' || coalesce(p_summary, ''));
  v_flags  text[] := array[]::text[];
  v_level  text := 'low';
begin
  if v_text ~ '(kaza|çarptı|çarpış|devrildi|yaralı|yaralan|yaralılar|ambulans)' then
    v_flags := array_append(v_flags, 'traffic_accident');
  end if;

  if v_text ~ '(cinayet|silah|bıçak|bıçakla|darp|saldırı|soygun|hırsızlık|kaçır|rehin)' then
    v_flags := array_append(v_flags, 'crime_or_violence');
  end if;

  if v_text ~ '(çocuk|bebek|reşit olmayan|küçük yaşta|ilkokul|ortaokul)' then
    v_flags := array_append(v_flags, 'minor_involved');
  end if;

  if v_text ~ '(yangın|deprem|sel |su baskını|heyelan|fırtına|afet|patlama)' then
    v_flags := array_append(v_flags, 'disaster');
  end if;

  if v_text ~ '(intihar|yaşamına son|kendine zarar)' then
    v_flags := array_append(v_flags, 'self_harm');
  end if;

  if v_text ~ '(taciz|tecavüz|cinsel|mahrem|çıplak)' then
    v_flags := array_append(v_flags, 'sexual_content');
  end if;

  if v_text ~ '(kan |ağır yaralı|hayatını kaybetti|ceset|ölü)' then
    v_flags := array_append(v_flags, 'severe_injury_or_death');
  end if;

  if v_text ~ '(iddia|duyum|söylenti|dedikodu|kesin değil)' then
    v_flags := array_append(v_flags, 'unverified_claim');
  end if;

  if coalesce(p_category, '') in ('trafik', 'guvenlik') then
    v_flags := array_append(v_flags, 'sensitive_category');
  end if;

  v_flags := array(select distinct f from unnest(v_flags) as f order by f);

  if v_flags && array[
    'traffic_accident', 'crime_or_violence', 'minor_involved', 'disaster',
    'self_harm', 'sexual_content', 'severe_injury_or_death'
  ]::text[] then
    v_level := 'high';
  elsif v_flags && array['unverified_claim', 'sensitive_category']::text[] then
    v_level := 'medium';
  end if;

  return jsonb_build_object(
    'level', v_level,
    'flags', coalesce(to_jsonb(v_flags), '[]'::jsonb),
    'needs_review', v_level <> 'low'
  );
end;
$$;

revoke all on function public.tz_live_news_risk(text, text, text) from public, anon, authenticated;
grant execute on function public.tz_live_news_risk(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Yazma tetikleyicileri
-- ---------------------------------------------------------------------------
create or replace function public.live_news_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status = 'removed' then
    new.moderation_status := 'removed';
  end if;
  if new.moderation_status = 'removed' then
    new.verification_status := 'removed';
  end if;

  new.reports_count := greatest(coalesce(new.reports_count, 0), 0);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.live_news_before_write() from public, anon, authenticated;

drop trigger if exists live_news_before_write on public.live_news;
create trigger live_news_before_write
  before insert or update on public.live_news
  for each row execute function public.live_news_before_write();

-- live_news moderasyonu -> posts ve Reels aynası
create or replace function public.live_news_sync_targets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Başka bir tetikleyiciden gelen ikincil yazımda döngüyü kır.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  update public.posts
     set moderation_status = case new.moderation_status
       when 'visible' then 'visible'
       when 'pending' then 'hidden'
       when 'hidden' then 'hidden'
       else 'removed'
     end
   where id = new.post_id
     and moderation_status is distinct from case new.moderation_status
       when 'visible' then 'visible'
       when 'pending' then 'hidden'
       when 'hidden' then 'hidden'
       else 'removed'
     end;

  if new.reel_id is not null then
    update public.reels
       set moderation_status = case new.moderation_status
         when 'visible' then 'visible'
         when 'pending' then 'hidden'
         when 'hidden' then 'hidden'
         else 'removed'
       end
     where id = new.reel_id;
  end if;

  if new.moderation_status = 'visible' and new.published_at is null then
    update public.live_news set published_at = now() where post_id = new.post_id;
  end if;

  return new;
end;
$$;

revoke all on function public.live_news_sync_targets() from public, anon, authenticated;

drop trigger if exists live_news_sync_targets on public.live_news;
create trigger live_news_sync_targets
  after update of moderation_status, verification_status on public.live_news
  for each row execute function public.live_news_sync_targets();

-- Admin > Sosyal Akış üzerinden yapılan moderasyon da Anlık Haber'e yansır.
create or replace function public.live_news_from_post_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mod text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.moderation_status is not distinct from new.moderation_status then
    return new;
  end if;

  v_mod := case new.moderation_status
    when 'visible' then 'visible'
    when 'hidden' then 'hidden'
    else 'removed'
  end;

  update public.live_news
     set moderation_status = v_mod,
         verification_status = case
           when v_mod = 'removed' and verification_status <> 'removed' then 'removed'
           else verification_status
         end,
         published_at = case
           when v_mod = 'visible' then coalesce(published_at, now())
           else published_at
         end
   where post_id = new.id
     and moderation_status is distinct from v_mod;

  return new;
end;
$$;

revoke all on function public.live_news_from_post_sync() from public, anon, authenticated;

drop trigger if exists live_news_from_post_sync on public.posts;
create trigger live_news_from_post_sync
  after update of moderation_status on public.posts
  for each row execute function public.live_news_from_post_sync();

-- Reels silinirse bağlantı temizlenir (içerik yaşamaya devam eder).
create or replace function public.live_news_reel_unlink()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.live_news
     set reel_id = null,
         cross_post_reel = false,
         publish_targets = array_remove(publish_targets, 'reels')
   where reel_id = old.id;
  return old;
end;
$$;

revoke all on function public.live_news_reel_unlink() from public, anon, authenticated;

drop trigger if exists live_news_reel_unlink on public.reels;
create trigger live_news_reel_unlink
  after delete on public.reels
  for each row execute function public.live_news_reel_unlink();

-- Anlık gelişme silinirse (feed_delete_post dâhil) Reels kopyası da düşer.
create or replace function public.live_news_cleanup_reel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.reel_id is not null then
    delete from public.reels where id = old.reel_id;
  end if;
  return old;
end;
$$;

revoke all on function public.live_news_cleanup_reel() from public, anon, authenticated;

drop trigger if exists live_news_cleanup_reel on public.live_news;
create trigger live_news_cleanup_reel
  before delete on public.live_news
  for each row execute function public.live_news_cleanup_reel();

-- ---------------------------------------------------------------------------
-- 7. Ortak JSON
-- ---------------------------------------------------------------------------
create or replace function public.tz_live_news_brief(p_post_id uuid, p_me uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'post_id', ln.post_id,
    'canonical_id', ln.canonical_id,
    'title', ln.title,
    'summary', ln.summary,
    'category', ln.category,
    'city', ln.city,
    'district', ln.district,
    'location_precision', ln.location_precision,
    'media_kind', ln.media_kind,
    'publish_targets', ln.publish_targets,
    'cross_post_reel', ln.cross_post_reel,
    'reel_id', ln.reel_id,
    'verification_status', ln.verification_status,
    'verification_note', ln.verification_note,
    'verified_at', ln.verified_at,
    'moderation_status', ln.moderation_status,
    'risk_level', ln.risk_level,
    'risk_flags', ln.risk_flags,
    'usage_consent', ln.usage_consent,
    'newsroom_state', ln.newsroom_state,
    'published_at', ln.published_at,
    'reports_count', ln.reports_count,
    'is_mine', ln.author_id = p_me,
    'is_admin', public.is_admin(),
    'created_at', ln.created_at,
    'updated_at', ln.updated_at
  )
  from public.live_news ln
  where ln.post_id = p_post_id;
$$;

revoke all on function public.tz_live_news_brief(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Oluşturma
-- ---------------------------------------------------------------------------
create or replace function public.live_news_create(
  p_title              text,
  p_summary            text default null,
  p_category           text default 'guncel',
  p_district           text default null,
  p_media              jsonb default '[]'::jsonb,
  p_publish_targets    text[] default array['feed', 'live', 'web']::text[],
  p_location_precision text default 'district',
  p_lat                double precision default null,
  p_lng                double precision default null,
  p_usage_consent      boolean default false,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := public.tz_require_uid();
  v_title      text := nullif(btrim(coalesce(p_title, '')), '');
  v_summary    text := nullif(btrim(coalesce(p_summary, '')), '');
  v_category   text := lower(btrim(coalesce(p_category, 'guncel')));
  v_district   text := nullif(btrim(coalesce(p_district, '')), '');
  v_media      jsonb := coalesce(p_media, '[]'::jsonb);
  v_targets    text[];
  v_precision  text := lower(btrim(coalesce(p_location_precision, 'district')));
  v_key        text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing   uuid;
  v_post_id    uuid;
  v_item       jsonb;
  v_count      integer := 0;
  v_index      integer := 0;
  v_type       text;
  v_has_image  boolean := false;
  v_has_video  boolean := false;
  v_media_kind text := 'text';
  v_risk       jsonb;
  v_risk_level text;
  v_moderation text;
  v_verification text;
  v_body       text;
  v_reel_id    uuid;
  v_first_video_path text;
  v_first_thumb text;
  v_first_video jsonb;
  v_created_at timestamptz;
begin
  if v_title is null or char_length(v_title) < 6 then
    raise exception 'title_too_short' using errcode = '22023';
  end if;
  if char_length(v_title) > 140 then
    raise exception 'title_too_long' using errcode = '22023';
  end if;
  if v_summary is not null and char_length(v_summary) > 1200 then
    raise exception 'summary_too_long' using errcode = '22023';
  end if;
  if v_category not in ('guncel', 'trafik', 'hava', 'etkinlik', 'spor', 'guvenlik', 'altyapi') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if v_district is not null and not (v_district = any (public.live_news_districts())) then
    raise exception 'invalid_district' using errcode = '22023';
  end if;
  if v_precision not in ('none', 'district', 'city', 'approximate') then
    raise exception 'invalid_location_precision' using errcode = '22023';
  end if;

  if jsonb_typeof(v_media) <> 'array' then
    raise exception 'invalid_media' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(v_media);
  if v_count > 10 then
    raise exception 'too_many_media' using errcode = '22023';
  end if;
  if v_summary is null and v_count = 0 then
    raise exception 'empty_live_news' using errcode = '22023';
  end if;

  -- Yayın hedefleri: yalnızca bilinen değerler, tekrarsız.
  select coalesce(array_agg(distinct t), array[]::text[])
    into v_targets
  from unnest(coalesce(p_publish_targets, array['feed', 'live', 'web']::text[])) as t
  where t in ('feed', 'reels', 'live', 'web');

  if coalesce(array_length(v_targets, 1), 0) = 0 then
    v_targets := array['feed', 'live', 'web']::text[];
  end if;

  -- Aynı istek yeniden gelirse var olan içeriği döndür (çift kayıt yok).
  if v_key is not null then
    perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_key));
    select li.post_id into v_existing
    from public.live_news_idempotency li
    where li.user_id = v_uid and li.idempotency_key = v_key;
    if v_existing is not null then
      return public.live_news_get(v_existing) || jsonb_build_object('idempotent', true);
    end if;
  end if;

  perform public.safety_check_rate('live_news_create', 12, interval '1 day');
  perform public.safety_check_rate('live_news_create_hour', 4, interval '1 hour');


  for v_item in select * from jsonb_array_elements(v_media)
  loop
    v_type := v_item ->> 'media_type';
    if v_type not in ('image', 'video') then
      raise exception 'invalid_media_type' using errcode = '22023';
    end if;
    perform public.tz_validate_media_path(v_item ->> 'storage_path', v_uid);
    if v_type = 'video' then
      v_has_video := true;
      if v_first_video_path is null then
        v_first_video_path := v_item ->> 'storage_path';
        v_first_thumb := nullif(v_item ->> 'thumbnail_path', '');
        v_first_video := v_item;
      end if;
    else
      v_has_image := true;
    end if;
  end loop;

  if v_has_video and v_has_image then
    v_media_kind := 'mixed';
  elsif v_has_video then
    v_media_kind := 'video';
  elsif v_has_image then
    v_media_kind := 'photo';
  end if;

  if not v_has_video then
    v_targets := array_remove(v_targets, 'reels');
  end if;

  v_risk := public.tz_live_news_risk(v_title, v_summary, v_category);
  v_risk_level := v_risk ->> 'level';

  if v_risk_level = 'high' then
    v_moderation := 'pending';
    v_verification := 'reviewing';
  elsif v_risk_level = 'medium' then
    v_moderation := 'visible';
    v_verification := 'reviewing';
  else
    v_moderation := 'visible';
    v_verification := 'citizen';
  end if;

  v_body := left(
    v_title || case when v_summary is not null then E'\n\n' || v_summary else '' end,
    2000
  );

  insert into public.posts (author_id, body, visibility, city, moderation_status)
  values (
    v_uid,
    v_body,
    'public',
    'Trabzon',
    case when v_moderation = 'visible' then 'visible' else 'hidden' end
  )
  returning id, created_at into v_post_id, v_created_at;

  v_index := 0;
  for v_item in select * from jsonb_array_elements(v_media)
  loop
    insert into public.post_media (
      post_id, storage_path, thumbnail_path, media_type, width, height, duration_ms, sort_order
    )
    values (
      v_post_id,
      v_item ->> 'storage_path',
      nullif(v_item ->> 'thumbnail_path', ''),
      v_item ->> 'media_type',
      nullif(v_item ->> 'width', '')::integer,
      nullif(v_item ->> 'height', '')::integer,
      nullif(v_item ->> 'duration_ms', '')::integer,
      v_index
    );
    v_index := v_index + 1;
  end loop;

  insert into public.live_news (
    post_id, author_id, title, summary, category, city, district,
    location_precision, coordinates_lat, coordinates_lng, publish_targets,
    media_kind, verification_status, moderation_status, risk_level, risk_flags,
    usage_consent, published_at, created_at, updated_at
  )
  values (
    v_post_id, v_uid, v_title, v_summary, v_category, 'Trabzon', v_district,
    case when v_precision = 'none' then 'district' else v_precision end,
    -- Tam GPS varsayılan olarak saklanmaz; 'approximate' ~1 km'ye yuvarlanır.
    case
      when v_precision = 'approximate' and p_lat is not null
        then round(p_lat::numeric, 2)::double precision
      else null
    end,
    case
      when v_precision = 'approximate' and p_lng is not null
        then round(p_lng::numeric, 2)::double precision
      else null
    end,
    v_targets,
    v_media_kind, v_verification, v_moderation, v_risk_level, v_risk -> 'flags',
    coalesce(p_usage_consent, false),
    case when v_moderation = 'visible' then now() else null end,
    v_created_at, v_created_at
  );

  -- Reels hedefi: fiziksel kopya yok; aynı post_media yolunu paylaşır.
  if 'reels' = any (v_targets) and v_first_video_path is not null then
    insert into public.reels (
      author_id, video_path, cover_path, caption, audio_title,
      duration_ms, width, height, status, moderation_status,
      storage_bucket, live_news_id, created_at, updated_at
    )
    values (
      v_uid,
      v_first_video_path,
      v_first_thumb,
      left(v_title, 2200),
      null,
      nullif(v_first_video ->> 'duration_ms', '')::integer,
      nullif(v_first_video ->> 'width', '')::integer,
      nullif(v_first_video ->> 'height', '')::integer,
      'ready',
      case when v_moderation = 'visible' then 'visible' else 'hidden' end,
      'posts',
      v_post_id,
      v_created_at, v_created_at
    )
    returning id into v_reel_id;

    update public.live_news
       set reel_id = v_reel_id,
           cross_post_reel = true
     where post_id = v_post_id;
  end if;

  if v_key is not null then
    insert into public.live_news_idempotency (user_id, idempotency_key, post_id)
    values (v_uid, v_key, v_post_id)
    on conflict (user_id, idempotency_key) do nothing;
  end if;

  if v_moderation = 'visible' then
    perform public.live_news_notify_publish(v_post_id);
  end if;

  return public.live_news_get(v_post_id) || jsonb_build_object('idempotent', false);
end;
$$;

revoke all on function public.live_news_create(
  text, text, text, text, jsonb, text[], text, double precision, double precision, boolean, text
) from public, anon;
grant execute on function public.live_news_create(
  text, text, text, text, jsonb, text[], text, double precision, double precision, boolean, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Güncelleme / silme
-- ---------------------------------------------------------------------------
create or replace function public.live_news_update(
  p_post_id         uuid,
  p_title           text,
  p_summary         text default null,
  p_category        text default 'guncel',
  p_district        text default null,
  p_publish_targets text[] default null,
  p_usage_consent   boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := public.tz_require_uid();
  v_row        public.live_news%rowtype;
  v_title      text := nullif(btrim(coalesce(p_title, '')), '');
  v_summary    text := nullif(btrim(coalesce(p_summary, '')), '');
  v_category   text := lower(btrim(coalesce(p_category, 'guncel')));
  v_district   text := nullif(btrim(coalesce(p_district, '')), '');
  v_targets    text[];
  v_risk       jsonb;
  v_risk_level text;
  v_moderation text;
  v_verification text;
  v_body       text;
begin
  select * into v_row from public.live_news where post_id = p_post_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.author_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_row.moderation_status = 'removed' then
    raise exception 'content_removed' using errcode = '42501';
  end if;

  if v_title is null or char_length(v_title) < 6 or char_length(v_title) > 140 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if v_summary is not null and char_length(v_summary) > 1200 then
    raise exception 'summary_too_long' using errcode = '22023';
  end if;
  if v_category not in ('guncel', 'trafik', 'hava', 'etkinlik', 'spor', 'guvenlik', 'altyapi') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if v_district is not null and not (v_district = any (public.live_news_districts())) then
    raise exception 'invalid_district' using errcode = '22023';
  end if;

  v_targets := v_row.publish_targets;
  if p_publish_targets is not null then
    select coalesce(array_agg(distinct t), array[]::text[])
      into v_targets
    from unnest(p_publish_targets) as t
    where t in ('feed', 'reels', 'live', 'web');
  end if;
  if v_row.media_kind not in ('video', 'mixed') then
    v_targets := array_remove(v_targets, 'reels');
  end if;

  v_risk := public.tz_live_news_risk(v_title, v_summary, v_category);
  v_risk_level := v_risk ->> 'level';

  -- Doğrulanmış içerik düzenlendiğinde rozet korunmaz: yeniden inceleme.
  v_verification := case
    when v_row.verification_status in ('verified', 'corrected') then 'reviewing'
    else v_row.verification_status
  end;

  if v_risk_level = 'high' and v_row.moderation_status = 'visible' then
    v_moderation := 'pending';
    v_verification := 'reviewing';
  else
    v_moderation := v_row.moderation_status;
    if v_risk_level <> 'low' and v_verification = 'citizen' then
      v_verification := 'reviewing';
    end if;
  end if;

  v_body := left(
    v_title || case when v_summary is not null then E'\n\n' || v_summary else '' end,
    2000
  );

  update public.posts
     set body = v_body,
         city = 'Trabzon',
         moderation_status = case when v_moderation = 'visible' then 'visible' else 'hidden' end,
         is_edited = true
   where id = p_post_id;

  update public.live_news
     set title = v_title,
         summary = v_summary,
         category = v_category,
         district = v_district,
         publish_targets = v_targets,
         usage_consent = coalesce(p_usage_consent, usage_consent),
         risk_level = v_risk_level,
         risk_flags = v_risk -> 'flags',
         verification_status = v_verification,
         moderation_status = v_moderation
   where post_id = p_post_id;

  -- Reels hedefi sonradan eklendiyse mevcut video ile aynı medya kullanılır.
  if 'reels' = any (v_targets)
     and v_row.reel_id is null
     and v_row.media_kind in ('video', 'mixed') then
    declare
      v_video public.post_media%rowtype;
    begin
      select * into v_video
      from public.post_media m
      where m.post_id = p_post_id and m.media_type = 'video'
      order by m.sort_order
      limit 1;

      if found then
        insert into public.reels (
          author_id, video_path, cover_path, caption, duration_ms, width, height,
          status, moderation_status, storage_bucket, live_news_id
        )
        values (
          v_row.author_id, v_video.storage_path, v_video.thumbnail_path,
          left(v_title, 2200), v_video.duration_ms, v_video.width, v_video.height,
          'ready',
          case when v_moderation = 'visible' then 'visible' else 'hidden' end,
          'posts', p_post_id
        )
        returning id into v_row.reel_id;

        update public.live_news
           set reel_id = v_row.reel_id, cross_post_reel = true
         where post_id = p_post_id;
      end if;
    end;
  elsif v_row.reel_id is not null then
    update public.reels
       set caption = left(v_title, 2200),
           moderation_status = case
             when v_moderation = 'visible' and 'reels' = any (v_targets) then 'visible'
             when v_moderation = 'visible' then 'hidden'
             when v_moderation = 'pending' then 'hidden'
             when v_moderation = 'hidden' then 'hidden'
             else 'removed'
           end
     where id = v_row.reel_id;
  end if;

  if v_moderation = 'pending' then
    insert into public.notifications (user_id, actor_id, kind, title, body, entity_type, entity_id, route)
    values (
      v_uid, null, 'live_news_moderation', 'Paylaşımın yeniden incelemeye alındı',
      'Yaptığın düzenleme sonrası içerik güvenlik kontrolünden geçiyor.',
      'live_news', p_post_id::text, '/live-news/' || p_post_id::text
    );
  end if;

  return public.live_news_get(p_post_id);
end;
$$;

revoke all on function public.live_news_update(uuid, text, text, text, text, text[], boolean)
  from public, anon;
grant execute on function public.live_news_update(uuid, text, text, text, text, text[], boolean)
  to authenticated;

create or replace function public.live_news_delete(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_author   uuid;
  v_admin    boolean := public.is_admin();
  v_media    jsonb;
  v_reel     jsonb;
begin
  select ln.author_id into v_author from public.live_news ln where ln.post_id = p_post_id;
  if v_author is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_author <> v_uid and not v_admin then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'storage_path', m.storage_path,
      'thumbnail_path', m.thumbnail_path,
      'media_type', m.media_type
    )),
    '[]'::jsonb
  ) into v_media
  from public.post_media m
  where m.post_id = p_post_id;

  select jsonb_build_object(
    'video_path', r.video_path,
    'cover_path', r.cover_path,
    'storage_bucket', r.storage_bucket
  ) into v_reel
  from public.reels r
  where r.live_news_id = p_post_id
  limit 1;

  if v_admin then
    perform public.tz_admin_audit(
      'live_news.deleted', 'Anlık haber silindi', 'live_news', p_post_id::text,
      jsonb_build_object('author_id', v_author)
    );
  end if;

  -- Reels kaydı ve tüm etkileşimleri düşer; medya yolları istemciye döner.
  delete from public.reels where live_news_id = p_post_id;
  delete from public.posts where id = p_post_id;

  return jsonb_build_object(
    'deleted', true,
    'post_id', p_post_id,
    'media', v_media,
    'reel', coalesce(v_reel, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.live_news_delete(uuid) from public, anon;
grant execute on function public.live_news_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Okuma
-- ---------------------------------------------------------------------------
create or replace function public.live_news_get(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.live_news%rowtype;
begin
  select * into v_row from public.live_news where post_id = p_post_id;
  if not found then
    return null;
  end if;

  if v_row.moderation_status <> 'visible'
     and v_row.author_id <> v_uid
     and not public.is_admin() then
    return null;
  end if;

  return public.tz_post_json(p_post_id, v_uid);
end;
$$;

revoke all on function public.live_news_get(uuid) from public, anon;
grant execute on function public.live_news_get(uuid) to authenticated;

create or replace function public.live_news_list(
  p_filter   text default 'all',
  p_district text default null,
  p_category text default null,
  p_lat      double precision default null,
  p_lng      double precision default null,
  p_radius_km double precision default 15,
  p_cursor   timestamptz default null,
  p_limit    integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me       uuid := public.tz_require_uid();
  v_filter   text := lower(btrim(coalesce(p_filter, 'all')));
  v_category text := nullif(lower(btrim(coalesce(p_category, ''))), '');
  v_category_filter text;
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
  v_limit    integer := least(greatest(coalesce(p_limit, 12), 1), 30);
  v_radius   double precision := least(greatest(coalesce(p_radius_km, 15), 1), 100);
  v_empty    jsonb;
begin
  if v_filter not in (
    'all', 'nearby', 'trabzon', 'districts', 'traffic', 'weather',
    'event', 'sports', 'current', 'verified'
  ) then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;

  v_category_filter := case v_filter
    when 'traffic' then 'trafik'
    when 'weather' then 'hava'
    when 'event' then 'etkinlik'
    when 'sports' then 'spor'
    when 'current' then 'guncel'
    else v_category
  end;

  if v_filter = 'nearby' and (p_lat is null or p_lng is null) then
    v_empty := jsonb_build_object(
      'items', '[]'::jsonb,
      'next_cursor', null,
      'has_more', false,
      'latest_at', null,
      'requires_location', true
    );
    return v_empty;
  end if;

  return (
    with filtered as (
      select
        ln.post_id,
        ln.created_at,
        case
          when p_lat is null or p_lng is null
            or ln.coordinates_lat is null or ln.coordinates_lng is null then null
          else round((
            6371 * 2 * asin(
              sqrt(
                power(sin(radians(ln.coordinates_lat - p_lat) / 2), 2)
                + cos(radians(p_lat)) * cos(radians(ln.coordinates_lat))
                  * power(sin(radians(ln.coordinates_lng - p_lng) / 2), 2)
              )
            )
          )::numeric, 1)::double precision
        end as distance_km
      from public.live_news ln
        join public.posts p on p.id = ln.post_id
        join public.profiles pr on pr.id = ln.author_id
      where ln.moderation_status = 'visible'
        and p.moderation_status = 'visible'
        and pr.account_status = 'active'
        and not public.is_blocked(v_me, ln.author_id)
        and 'live' = any (ln.publish_targets)
        and (v_district is null or lower(trim(ln.district)) = lower(trim(v_district)))
        and (v_category_filter is null or ln.category = v_category_filter)
        and (v_filter <> 'districts' or ln.district is not null)
        and (v_filter <> 'verified' or ln.verification_status = 'verified')
        and (p_cursor is null or ln.created_at < p_cursor)
        and (
          v_filter <> 'nearby'
          or (
            ln.coordinates_lat is not null
            and ln.coordinates_lng is not null
            and (
              6371 * 2 * asin(
                sqrt(
                  power(sin(radians(ln.coordinates_lat - p_lat) / 2), 2)
                  + cos(radians(p_lat)) * cos(radians(ln.coordinates_lat))
                    * power(sin(radians(ln.coordinates_lng - p_lng) / 2), 2)
                )
              )
            ) <= v_radius
          )
        )
      order by ln.created_at desc
      limit v_limit + 1
    ),
    numbered as (
      select
        f.post_id,
        f.created_at,
        f.distance_km,
        row_number() over (order by f.created_at desc) as rn
      from filtered f
    )
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(
            public.tz_post_json(n.post_id, v_me) || jsonb_build_object(
              'distance_km', n.distance_km
            )
            order by n.rn
          )
          from numbered n
          where n.rn <= v_limit
        ),
        '[]'::jsonb
      ),
      'next_cursor', (select n.created_at from numbered n where n.rn = v_limit),
      'has_more', (select count(*) from numbered) > v_limit,
      'latest_at', (select max(n.created_at) from numbered n),
      'requires_location', false
    )
  );
end;
$$;

revoke all on function public.live_news_list(
  text, text, text, double precision, double precision, double precision, timestamptz, integer
) from public, anon;
grant execute on function public.live_news_list(
  text, text, text, double precision, double precision, double precision, timestamptz, integer
) to authenticated;

create or replace function public.live_news_mine(
  p_limit  integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 40);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_post_json(x.post_id, v_uid) order by x.created_at desc)
        from (
          select ln.post_id, ln.created_at
          from public.live_news ln
          where ln.author_id = v_uid
          order by ln.created_at desc
          limit v_limit offset v_offset
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.live_news_mine(integer, integer) from public, anon;
grant execute on function public.live_news_mine(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Bildirim tercihleri ve dağıtım
-- ---------------------------------------------------------------------------
create or replace function public.live_news_preferences_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.live_news_preferences%rowtype;
begin
  select * into v_row from public.live_news_preferences where user_id = v_uid;
  if not found then
    return jsonb_build_object(
      'followed_people', true,
      'district_updates', true,
      'verified_only', false,
      'district', null
    );
  end if;
  return jsonb_build_object(
    'followed_people', v_row.followed_people,
    'district_updates', v_row.district_updates,
    'verified_only', v_row.verified_only,
    'district', v_row.district
  );
end;
$$;

revoke all on function public.live_news_preferences_get() from public, anon;
grant execute on function public.live_news_preferences_get() to authenticated;

create or replace function public.live_news_preferences_save(
  p_followed_people  boolean default true,
  p_district_updates boolean default true,
  p_verified_only    boolean default false,
  p_district         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
begin
  if v_district is not null and not (v_district = any (public.live_news_districts())) then
    raise exception 'invalid_district' using errcode = '22023';
  end if;

  insert into public.live_news_preferences (
    user_id, followed_people, district_updates, verified_only, district, updated_at
  )
  values (
    v_uid, coalesce(p_followed_people, true), coalesce(p_district_updates, true),
    coalesce(p_verified_only, false), v_district, now()
  )
  on conflict (user_id) do update
    set followed_people = excluded.followed_people,
        district_updates = excluded.district_updates,
        verified_only = excluded.verified_only,
        district = excluded.district,
        updated_at = now();

  return public.live_news_preferences_get();
end;
$$;

revoke all on function public.live_news_preferences_save(boolean, boolean, boolean, text)
  from public, anon;
grant execute on function public.live_news_preferences_save(boolean, boolean, boolean, text)
  to authenticated;

create or replace function public.live_news_notify_publish(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     public.live_news%rowtype;
  v_author  text;
  v_target  record;
  v_title   text;
  v_body    text;
  v_route   text;
  v_kind    text;
  v_inserted boolean;
begin
  select * into v_row from public.live_news where post_id = p_post_id;
  if not found or v_row.moderation_status <> 'visible' then
    return;
  end if;

  select coalesce(nullif(trim(pr.first_name), ''), pr.username) || ' yeni bir anlık gelişme paylaştı'
    into v_title
  from public.profiles pr where pr.id = v_row.author_id;

  v_author := v_title;
  v_body := left(coalesce(v_row.district || ' · ', '') || v_row.title, 400);
  v_route := '/live-news/' || p_post_id::text;
  v_kind := case when v_row.verification_status = 'verified'
    then 'live_news_verified' else 'live_news' end;

  for v_target in
    with audience as (
      select f.follower_id as user_id
      from public.user_follows f
        left join public.live_news_preferences pref on pref.user_id = f.follower_id
      where f.following_id = v_row.author_id
        and coalesce(pref.followed_people, true)
      union
      select pref.user_id
      from public.live_news_preferences pref
      where pref.district_updates
        and pref.district is not null
        and v_row.district is not null
        and lower(trim(pref.district)) = lower(trim(v_row.district))
        and (not pref.verified_only or v_row.verification_status = 'verified')
    )
    select distinct a.user_id from audience a
    where a.user_id <> v_row.author_id
      and not public.is_blocked(a.user_id, v_row.author_id)
  loop
    insert into public.live_news_notification_log (live_news_id, user_id, kind)
    values (p_post_id, v_target.user_id, 'publish')
    on conflict do nothing;
    v_inserted := found;

    if v_inserted then
      insert into public.notifications (
        user_id, actor_id, kind, title, body, entity_type, entity_id, route
      )
      values (
        v_target.user_id, v_row.author_id, v_kind, left(v_title, 160), v_body,
        'live_news', p_post_id::text, v_route
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.live_news_notify_publish(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. Yönetici işlemleri
-- ---------------------------------------------------------------------------
create or replace function public.admin_live_news_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('live_news.view', false);
begin
  return jsonb_build_object(
    'total', (select count(*) from public.live_news),
    'pending', (select count(*) from public.live_news where moderation_status = 'pending'),
    'visible', (select count(*) from public.live_news where moderation_status = 'visible'),
    'verified', (select count(*) from public.live_news where verification_status = 'verified'),
    'newsroom', (select count(*) from public.live_news where newsroom_state in ('pool', 'reviewing', 'newsroom')),
    'reported', (
      select count(distinct ln.post_id)
      from public.live_news ln
      join public.user_reports ur
        on ur.target_type = 'post'
       and ur.target_id = ln.post_id::text
       and ur.status_code in ('received', 'under_review')
    ),
    'today', (
      select count(*) from public.live_news
      where created_at >= (
        ((now() at time zone 'Europe/Istanbul')::date)::timestamp
          at time zone 'Europe/Istanbul'
      )
    ),
    'views', (
      select coalesce(sum(c.unique_views), 0)
      from public.content_view_counters c
      join public.live_news ln on ln.post_id = c.content_id
      where c.content_type = 'post'
    )
  );
end;
$$;

revoke all on function public.admin_live_news_stats() from public, anon;
grant execute on function public.admin_live_news_stats() to authenticated;

create or replace function public.admin_live_news_list(
  p_state    text default 'all',
  p_district text default null,
  p_category text default null,
  p_query    text default null,
  p_limit    integer default 20,
  p_offset   integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin    uuid := public.tz_admin_require('live_news.view', false);
  v_state    text := lower(btrim(coalesce(p_state, 'all')));
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
  v_category text := nullif(lower(btrim(coalesce(p_category, ''))), '');
  v_query    text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_limit    integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_total    bigint;
begin
  if v_state not in (
    'all', 'pending', 'visible', 'hidden', 'removed', 'reviewing',
    'verified', 'unverified', 'reported', 'newsroom'
  ) then
    raise exception 'invalid_state' using errcode = '22023';
  end if;

  select count(*) into v_total
  from public.live_news ln
    join public.profiles pr on pr.id = ln.author_id
  where (v_state <> 'pending' or ln.moderation_status = 'pending')
    and (v_state <> 'visible' or ln.moderation_status = 'visible')
    and (v_state <> 'hidden' or ln.moderation_status = 'hidden')
    and (v_state <> 'removed' or ln.moderation_status = 'removed')
    and (v_state <> 'reviewing' or ln.verification_status = 'reviewing')
    and (v_state <> 'verified' or ln.verification_status = 'verified')
    and (v_state <> 'unverified' or ln.verification_status in ('unverified', 'citizen'))
    and (v_state <> 'newsroom' or ln.newsroom_state in ('pool', 'reviewing', 'newsroom'))
    and (v_state <> 'reported' or exists (
      select 1 from public.user_reports ur
      where ur.target_type = 'post' and ur.target_id = ln.post_id::text
        and ur.status_code in ('received', 'under_review')
    ))
    and (v_district is null or ln.district = v_district)
    and (v_category is null or ln.category = v_category)
    and (
      v_query is null
      or lower(ln.title) like '%' || v_query || '%'
      or lower(coalesce(ln.summary, '')) like '%' || v_query || '%'
      or lower(pr.username) like '%' || v_query || '%'
    );

  return jsonb_build_object(
    'total', v_total,
    'items', coalesce(
      (
        select jsonb_agg(item order by created_at desc)
        from (
          select
            jsonb_build_object(
              'post_id', ln.post_id,
              'canonical_id', ln.canonical_id,
              'title', ln.title,
              'summary', ln.summary,
              'category', ln.category,
              'district', ln.district,
              'media_kind', ln.media_kind,
              'verification_status', ln.verification_status,
              'verification_note', ln.verification_note,
              'moderation_status', ln.moderation_status,
              'risk_level', ln.risk_level,
              'risk_flags', ln.risk_flags,
              'reports_count', (
                select count(*) from public.user_reports ur
                where ur.target_type = 'post' and ur.target_id = ln.post_id::text
                  and ur.status_code in ('received', 'under_review')
              ),
              'view_count', coalesce(c.unique_views, 0),
              'like_count', p.like_count,
              'comment_count', p.comment_count,
              'share_count', p.share_count,
              'newsroom_state', ln.newsroom_state,
              'usage_consent', ln.usage_consent,
              'author_id', ln.author_id,
              'author_username', pr.username,
              'author_name', trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')),
              'author_avatar_path', pr.avatar_path,
              'media_path', (
                select m.storage_path from public.post_media m
                where m.post_id = ln.post_id order by m.sort_order limit 1
              ),
              'media_type', (
                select m.media_type from public.post_media m
                where m.post_id = ln.post_id order by m.sort_order limit 1
              ),
              'created_at', ln.created_at,
              'published_at', ln.published_at
            ) as item,
            ln.created_at
          from public.live_news ln
            join public.profiles pr on pr.id = ln.author_id
            join public.posts p on p.id = ln.post_id
            left join public.content_view_counters c
              on c.content_type = 'post' and c.content_id = ln.post_id
          where (v_state <> 'pending' or ln.moderation_status = 'pending')
            and (v_state <> 'visible' or ln.moderation_status = 'visible')
            and (v_state <> 'hidden' or ln.moderation_status = 'hidden')
            and (v_state <> 'removed' or ln.moderation_status = 'removed')
            and (v_state <> 'reviewing' or ln.verification_status = 'reviewing')
            and (v_state <> 'verified' or ln.verification_status = 'verified')
            and (v_state <> 'unverified' or ln.verification_status in ('unverified', 'citizen'))
            and (v_state <> 'newsroom' or ln.newsroom_state in ('pool', 'reviewing', 'newsroom'))
            and (v_state <> 'reported' or exists (
              select 1 from public.user_reports ur
              where ur.target_type = 'post' and ur.target_id = ln.post_id::text
                and ur.status_code in ('received', 'under_review')
            ))
            and (v_district is null or ln.district = v_district)
            and (v_category is null or ln.category = v_category)
            and (
              v_query is null
              or lower(ln.title) like '%' || v_query || '%'
              or lower(coalesce(ln.summary, '')) like '%' || v_query || '%'
              or lower(pr.username) like '%' || v_query || '%'
            )
          order by ln.created_at desc
          limit v_limit offset v_offset
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.admin_live_news_list(text, text, text, text, integer, integer)
  from public, anon;
grant execute on function public.admin_live_news_list(text, text, text, text, integer, integer)
  to authenticated;

create or replace function public.admin_live_news_detail(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('live_news.view', false);
  v_row public.live_news%rowtype;
begin
  select * into v_row from public.live_news where post_id = p_post_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'post', public.tz_post_json(p_post_id, v_admin),
    'live_news', public.tz_live_news_brief(p_post_id, v_admin) || jsonb_build_object(
      'source_note', v_row.source_note,
      'editorial_note', v_row.editorial_note,
      'moderation_reason', v_row.moderation_reason,
      'attribution', v_row.attribution,
      'verified_by', v_row.verified_by,
      'reports', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ur.id,
          'report_no', ur.report_no,
          'reason', ur.reason,
          'status_code', ur.status_code,
          'created_at', ur.created_at
        ) order by ur.created_at desc), '[]'::jsonb)
        from public.user_reports ur
        where ur.target_type = 'post' and ur.target_id = p_post_id::text
          and ur.status_code in ('received', 'under_review')
      ),
      'history', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id,
          'action_code', a.action_code,
          'action_label', a.action_label_tr,
          'outcome', a.outcome,
          'metadata', a.metadata_safe,
          'created_at', a.created_at
        ) order by a.created_at desc), '[]'::jsonb)
        from (
          select * from public.admin_audit_logs
          where target_type = 'live_news' and target_id = p_post_id::text
          order by created_at desc
          limit 25
        ) a
      )
    )
  );
end;
$$;

revoke all on function public.admin_live_news_detail(uuid) from public, anon;
grant execute on function public.admin_live_news_detail(uuid) to authenticated;

create or replace function public.admin_live_news_action(
  p_post_id uuid,
  p_action  text,
  p_payload jsonb default '{}'::jsonb,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin    uuid := public.tz_admin_require('live_news.manage', true);
  v_action   text := lower(btrim(coalesce(p_action, '')));
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_payload  jsonb := coalesce(p_payload, '{}'::jsonb);
  v_row      public.live_news%rowtype;
  v_status   text;
  v_note     text;
  v_message  text;
  v_target   text;
  v_days     integer;
  v_mod      text;
  v_ver      text;
  v_newsroom text;
  v_kind     text;
  v_title    text;
begin
  if v_action not in (
    'approve', 'hide', 'remove', 'request_correction', 'set_verification',
    'send_to_newsroom', 'request_evidence', 'notify_user', 'sanction_user'
  ) then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  select * into v_row from public.live_news where post_id = p_post_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_action in ('remove', 'set_verification', 'request_correction', 'sanction_user')
     and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  v_mod := v_row.moderation_status;
  v_ver := v_row.verification_status;
  v_newsroom := v_row.newsroom_state;
  v_note := nullif(btrim(coalesce(v_payload ->> 'note', '')), '');
  v_message := left(nullif(btrim(coalesce(v_payload ->> 'message', '')), ''), 500);

  if v_action = 'approve' then
    v_mod := 'visible';
    if v_ver = 'removed' then
      raise exception 'content_removed' using errcode = '42501';
    end if;
  elsif v_action = 'hide' then
    v_mod := 'hidden';
  elsif v_action = 'remove' then
    v_mod := 'removed';
    v_ver := 'removed';
  elsif v_action = 'request_correction' then
    v_ver := 'corrected';
    v_note := coalesce(v_note, v_reason);
  elsif v_action = 'set_verification' then
    v_status := lower(btrim(coalesce(v_payload ->> 'status', '')));
    if v_status not in ('citizen', 'reviewing', 'verified', 'corrected', 'unverified', 'removed') then
      raise exception 'invalid_verification_status' using errcode = '22023';
    end if;
    v_ver := v_status;
    if v_status = 'removed' then
      v_mod := 'removed';
    elsif v_status = 'verified' and v_mod <> 'visible' then
      raise exception 'approve_before_verify' using errcode = '22023';
    end if;
  elsif v_action = 'send_to_newsroom' then
    v_newsroom := 'newsroom';
    if not coalesce((v_payload ->> 'force')::boolean, false) and not v_row.usage_consent then
      raise exception 'usage_consent_required' using errcode = '42501';
    end if;
  elsif v_action = 'request_evidence' then
    v_newsroom := 'reviewing';
    v_message := coalesce(v_message, 'Ek görüntü, saat veya tanık bilgisi paylaşabilir misin?');
  elsif v_action = 'notify_user' then
    if v_message is null or char_length(v_message) < 3 then
      raise exception 'message_required' using errcode = '22023';
    end if;
  elsif v_action = 'sanction_user' then
    v_target := lower(btrim(coalesce(v_payload ->> 'sanction', 'warn')));
    v_days := nullif(v_payload ->> 'days', '')::integer;
    if v_target not in ('warn', 'suspend', 'restrict') then
      raise exception 'invalid_sanction' using errcode = '22023';
    end if;
    perform public.admin_user_action(
      v_row.author_id, v_target, v_reason, v_days
    );
  end if;

  update public.live_news
     set moderation_status = v_mod,
         verification_status = v_ver,
         verification_note = coalesce(v_note, verification_note),
         moderation_reason = case when v_action in ('hide', 'remove') then v_reason else moderation_reason end,
         verified_at = case
           when v_ver = 'verified' and verification_status <> 'verified' then now()
           else verified_at
         end,
         verified_by = case
           when v_ver = 'verified' then v_admin
           else verified_by
         end,
         newsroom_state = v_newsroom,
         editorial_note = coalesce(v_note, editorial_note),
         published_at = case
           when v_mod = 'visible' then coalesce(published_at, now())
           else published_at
         end
   where post_id = p_post_id;

  -- Yazar bildirimi (doğrulama/moderasyon değişiklikleri)
  if v_action in ('approve', 'hide', 'remove', 'request_correction', 'set_verification')
     and (v_mod <> v_row.moderation_status or v_ver <> v_row.verification_status) then
    v_kind := case when v_action = 'set_verification' then 'live_news_verified'
      else 'live_news_moderation' end;
    v_title := case
      when v_ver = 'verified' then 'Paylaşımın doğrulandı'
      when v_ver = 'unverified' then 'Paylaşımın doğrulanamadı'
      when v_ver = 'corrected' then 'Paylaşımında düzeltme istendi'
      when v_mod = 'removed' then 'Paylaşımın kaldırıldı'
      when v_mod = 'hidden' then 'Paylaşımın yayından gizlendi'
      when v_mod = 'pending' then 'Paylaşımın incelemeye alındı'
      else 'Paylaşımının durumu güncellendi'
    end;

    insert into public.notifications (
      user_id, actor_id, kind, title, body, entity_type, entity_id, route
    )
    values (
      v_row.author_id, v_admin, v_kind, left(v_title, 160),
      left(coalesce(v_note, v_reason, 'Trabzone editör ekibi paylaşımını inceledi.'), 500),
      'live_news', p_post_id::text, '/live-news/' || p_post_id::text
    );
  end if;

  if v_action in ('request_evidence', 'notify_user') then
    insert into public.notifications (
      user_id, actor_id, kind, title, body, entity_type, entity_id, route
    )
    values (
      v_row.author_id, v_admin, 'live_news_moderation',
      case when v_action = 'request_evidence' then 'Ek bilgi isteniyor' else 'Trabzone editöründen mesaj' end,
      left(coalesce(v_message, 'Anlık gelişmen hakkında editör ekibi seninle iletişime geçti.'), 500),
      'live_news', p_post_id::text, '/live-news/' || p_post_id::text
    );
  end if;

  if v_action = 'send_to_newsroom' then
    insert into public.notifications (
      user_id, actor_id, kind, title, body, entity_type, entity_id, route
    )
    values (
      v_row.author_id, v_admin, 'live_news_moderation', 'Paylaşımın haber merkezine iletildi',
      'Trabzone Haber ekibi paylaşımını inceleyecek. Kullanım izni durumu: ' ||
        case when v_row.usage_consent then 'izin verildi' else 'izin verilmedi (yalnızca inceleme)' end,
      'live_news', p_post_id::text, '/live-news/' || p_post_id::text
    );
  end if;

  if v_mod = 'visible' then
    perform public.live_news_notify_publish(p_post_id);
  end if;

  perform public.tz_admin_audit(
    'live_news.' || v_action,
    'Anlık haber işlemi: ' || v_action,
    'live_news',
    p_post_id::text,
    jsonb_build_object(
      'reason', left(coalesce(v_reason, ''), 400),
      'note', left(coalesce(v_note, ''), 400),
      'action', v_action,
      'moderation_status', v_mod,
      'verification_status', v_ver
    )
  );

  return public.admin_live_news_detail(p_post_id);
end;
$$;

revoke all on function public.admin_live_news_action(uuid, text, jsonb, text)
  from public, anon;
grant execute on function public.admin_live_news_action(uuid, text, jsonb, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 13. AI asistanı: yetki, kota, günlük
-- ---------------------------------------------------------------------------
create or replace function public.live_news_ai_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.account_status = 'active'
  ) then
    raise exception 'account_restricted' using errcode = '42501';
  end if;

  perform public.safety_check_rate('live_news_ai', 40, interval '1 day');
  perform public.safety_check_rate('live_news_ai_hour', 12, interval '1 hour');

  return jsonb_build_object(
    'ok', true,
    'model', 'deepseek-chat',
    'temperature', 0.3
  );
end;
$$;

revoke all on function public.live_news_ai_check() from public, anon;
grant execute on function public.live_news_ai_check() to authenticated;

create or replace function public.live_news_ai_log(
  p_action      text,
  p_model       text default null,
  p_ok          boolean default true,
  p_error_code  text default null,
  p_tokens_in   integer default null,
  p_tokens_out  integer default null,
  p_duration_ms integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  insert into public.live_news_ai_logs (
    user_id, action, model, ok, error_code, tokens_in, tokens_out, duration_ms
  )
  values (
    v_uid, left(coalesce(p_action, 'assist'), 40), left(coalesce(p_model, ''), 60),
    coalesce(p_ok, true), left(coalesce(p_error_code, ''), 80),
    p_tokens_in, p_tokens_out, p_duration_ms
  );
end;
$$;

revoke all on function public.live_news_ai_log(text, text, boolean, text, integer, integer, integer)
  from public, anon;
grant execute on function public.live_news_ai_log(text, text, boolean, text, integer, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Web / SEO / paylaşım
-- ---------------------------------------------------------------------------
create or replace function public.live_news_public_post(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.live_news%rowtype;
  v_profile public.profiles%rowtype;
  v_media jsonb;
  v_views bigint;
begin
  select * into v_row
  from public.live_news
  where post_id = p_post_id
    and moderation_status = 'visible'
    and 'web' = any (publish_targets);
  if not found then
    return null;
  end if;

  if not exists (
    select 1 from public.posts p
    where p.id = p_post_id and p.moderation_status = 'visible'
  ) then
    return null;
  end if;

  select * into v_profile from public.profiles where id = v_row.author_id;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'storage_path', m.storage_path,
      'thumbnail_path', m.thumbnail_path,
      'media_type', m.media_type,
      'width', m.width,
      'height', m.height
    ) order by m.sort_order),
    '[]'::jsonb
  ) into v_media
  from public.post_media m
  where m.post_id = p_post_id;

  select coalesce(c.unique_views, 0) into v_views
  from public.content_view_counters c
  where c.content_type = 'post' and c.content_id = p_post_id;

  return jsonb_build_object(
    'post_id', v_row.post_id,
    'canonical_id', v_row.canonical_id,
    'title', v_row.title,
    'summary', v_row.summary,
    'category', v_row.category,
    'district', v_row.district,
    'city', v_row.city,
    'media_kind', v_row.media_kind,
    'verification_status', v_row.verification_status,
    'verification_note', v_row.verification_note,
    'published_at', v_row.published_at,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'usage_consent', v_row.usage_consent,
    'view_count', coalesce(v_views, 0),
    'media', v_media,
    'author', jsonb_build_object(
      'id', v_profile.id,
      'username', v_profile.username,
      'display_name', trim(coalesce(v_profile.first_name, '') || ' ' || coalesce(v_profile.last_name, '')),
      'avatar_path', v_profile.avatar_path
    )
  );
end;
$$;

revoke all on function public.live_news_public_post(uuid) from public, anon, authenticated;
grant execute on function public.live_news_public_post(uuid) to anon, authenticated, service_role;

create or replace function public.live_news_sitemap_urls(
  p_limit  integer default 1000,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'post_id', ln.post_id,
      'title', ln.title,
      'published_at', ln.published_at,
      'updated_at', ln.updated_at
    ) order by ln.published_at desc),
    '[]'::jsonb
  )
  from (
    select *
    from public.live_news
    where moderation_status = 'visible'
      and verification_status = 'verified'
      and 'web' = any (publish_targets)
      and published_at is not null
    order by published_at desc
    limit least(greatest(coalesce(p_limit, 1000), 1), 20000)
    offset greatest(coalesce(p_offset, 0), 0)
  ) ln;
$$;

revoke all on function public.live_news_sitemap_urls(integer, integer)
  from public, anon, authenticated;
grant execute on function public.live_news_sitemap_urls(integer, integer)
  to anon, service_role;

-- Paylaşım kartı: /p/gelisme/{id} ve sosyal paylaşım önizlemesi.
create or replace function public.live_news_share_card(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.live_news%rowtype;
  v_profile public.profiles%rowtype;
  v_media public.post_media%rowtype;
  v_views bigint;
begin
  select * into v_row
  from public.live_news
  where post_id = p_post_id and moderation_status = 'visible';
  if not found then
    return null;
  end if;

  select * into v_profile from public.profiles where id = v_row.author_id;
  select * into v_media
  from public.post_media
  where post_id = p_post_id
  order by sort_order
  limit 1;
  select coalesce(c.unique_views, 0) into v_views
  from public.content_view_counters c
  where c.content_type = 'post' and c.content_id = p_post_id;

  return jsonb_build_object(
    'type', 'live',
    'label', 'Anlık Gelişme',
    'title', left(v_row.title, 120),
    'description', left(
      coalesce(nullif(v_row.summary, ''), v_row.title) ||
      case when v_row.district is not null then ' · ' || v_row.district end,
      220
    ),
    'path', '/anlik-haber/' || p_post_id::text,
    'deep_link', 'trabzone://live-news/' || p_post_id::text,
    'bucket', 'posts',
    'image_path', v_media.storage_path,
    'author_name', trim(coalesce(v_profile.first_name, '') || ' ' || coalesce(v_profile.last_name, '')),
    'author_username', v_profile.username,
    'published_at', v_row.published_at,
    'location', v_row.district,
    'metrics', concat(coalesce(v_views, 0), ' görüntülenme'),
    'verification_status', v_row.verification_status,
    'live_news', true
  );
end;
$$;

revoke all on function public.live_news_share_card(uuid) from public, anon, authenticated;
grant execute on function public.live_news_share_card(uuid) to anon, authenticated, service_role;

-- Mevcut haber paylaşım kartını bozmadan canlı gelişme türünü ekle.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'share_card'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_share_card_news'
  ) then
    execute 'alter function public.share_card(text, text) rename to _share_card_news';
  end if;
end
$$;

create or replace function public.share_card(p_type text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_card jsonb;
begin
  if v_type in ('live', 'live-news', 'live_news', 'gelisme', 'anlik-haber', 'breaking') then
    begin
      v_card := public.live_news_share_card(p_key::uuid);
    exception when others then
      v_card := null;
    end;
    if v_card is not null then
      return v_card;
    end if;
  end if;

  return public._share_card_news(p_type, p_key);
end;
$$;

revoke all on function public.share_card(text, text) from public, anon, authenticated;
grant execute on function public.share_card(text, text) to anon, authenticated, service_role;
revoke all on function public._share_card_news(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 15. Mevcut akışları kanonik içerikle birleştir
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
    'live_news', public.tz_live_news_brief(p.id, p_me),
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

-- Sahibi ve yönetici, moderasyon bekleyen kendi içeriğini görebilir.
create or replace function public.can_view_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.posts p
      join public.profiles pr on pr.id = p.author_id
    where p.id = p_post_id
      and pr.account_status = 'active'
      and not public.is_blocked(auth.uid(), p.author_id)
      and (
        p.moderation_status = 'visible'
        or p.author_id = auth.uid()
        or public.is_admin()
      )
      and (
        p.visibility = 'public'
        or p.author_id = auth.uid()
        or public.is_following(p.author_id)
      )
  );
$$;

revoke all on function public.can_view_post(uuid) from public, anon;
grant execute on function public.can_view_post(uuid) to authenticated, service_role;

-- Akışa yalnızca "feed" hedefi seçilmiş canlı gelişmeler girer.
create or replace function public.feed_list(
  p_filter text default 'all',
  p_city   text default null,
  p_cursor timestamptz default null,
  p_limit  integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me    uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
  v_filter text := coalesce(nullif(trim(p_filter), ''), 'all');
begin
  if v_filter not in ('all', 'following', 'nearby', 'popular', 'news') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;

  return (
    with base as (
      select
        p.id,
        p.created_at,
        (p.like_count + p.comment_count * 2 + p.save_count * 2) as score
      from public.posts p
        join public.profiles pr on pr.id = p.author_id
      where p.moderation_status = 'visible'
        and pr.account_status = 'active'
        and not public.is_blocked(v_me, p.author_id)
        and (
          p.visibility = 'public'
          or p.author_id = v_me
          or public.is_following(p.author_id)
        )
        and (p_cursor is null or p.created_at < p_cursor)
        and not exists (
          select 1 from public.live_news ln
          where ln.post_id = p.id
            and not ('feed' = any (ln.publish_targets))
        )
        and (
          v_filter <> 'following'
          or p.author_id = v_me
          or public.is_following(p.author_id)
        )
        and (
          v_filter <> 'nearby'
          or p_city is null
          or (p.city is not null and lower(trim(p.city)) = lower(trim(p_city)))
        )
        and (v_filter <> 'popular' or p.created_at > now() - interval '30 days')
        and (
          v_filter <> 'news'
          or exists (
            select 1 from public.ai_news_publications pub
            where pub.post_id = p.id and pub.status = 'published'
          )
        )
      order by
        case when v_filter = 'popular' then
          (p.like_count + p.comment_count * 2 + p.save_count * 2)
        end desc nulls last,
        p.created_at desc
      limit v_limit + 1
    ),
    numbered as (
      select
        b.id,
        b.created_at,
        row_number() over (
          order by
            case when v_filter = 'popular' then b.score end desc nulls last,
            b.created_at desc
        ) as rn
      from base b
    )
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(public.tz_post_json(n.id, v_me) order by n.rn)
          from numbered n
          where n.rn <= v_limit
        ),
        '[]'::jsonb
      ),
      'next_cursor', (select n.created_at from numbered n where n.rn = v_limit),
      'has_more', (select count(*) from numbered) > v_limit
    )
  );
end;
$$;

revoke all on function public.feed_list(text, text, timestamptz, integer) from public, anon;
grant execute on function public.feed_list(text, text, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 16. Reels: kanonik görüntüleme ve canlı gelişme bağlantısı
-- ---------------------------------------------------------------------------
create or replace function public.tz_reel_json(p_reel_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'author_id', r.author_id,
    'author_username', pr.username,
    'author_first_name', pr.first_name,
    'author_last_name', pr.last_name,
    'author_avatar_path', pr.avatar_path,
    'author_is_verified', pr.is_verified,
    'video_path', r.video_path,
    'cover_path', r.cover_path,
    'storage_bucket', r.storage_bucket,
    'live_news_id', r.live_news_id,
    'live_news', public.tz_live_news_brief(r.live_news_id, p_me),
    'caption', r.caption,
    'audio_title', r.audio_title,
    'duration_ms', r.duration_ms,
    'width', r.width,
    'height', r.height,
    'like_count', r.like_count,
    'comment_count', r.comment_count,
    'save_count', r.save_count,
    'share_count', r.share_count,
    'view_count', coalesce(c.unique_views, r.view_count),
    'status', r.status,
    'is_edited', r.is_edited,
    'created_at', r.created_at,
    'liked', exists (
      select 1 from public.reel_likes l where l.reel_id = r.id and l.user_id = p_me
    ),
    'saved', exists (
      select 1 from public.reel_saves s where s.reel_id = r.id and s.user_id = p_me
    ),
    'is_mine', r.author_id = p_me,
    'following_author', public.is_following(r.author_id)
  )
  from public.reels r
    join public.profiles pr on pr.id = r.author_id
    left join public.content_view_counters c
      on c.content_type = 'post' and c.content_id = r.live_news_id
  where r.id = p_reel_id;
$$;

revoke all on function public.tz_reel_json(uuid, uuid) from public, anon, authenticated;

create or replace function public.reel_register_view(p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canonical uuid;
  v_result    jsonb;
  v_count     bigint;
begin
  select r.live_news_id into v_canonical
  from public.reels r
  where r.id = p_reel_id;

  if v_canonical is not null then
    v_result := public.content_register_view('post', v_canonical, 'reels');
    select coalesce(c.unique_views, 0) into v_count
    from public.content_view_counters c
    where c.content_type = 'post' and c.content_id = v_canonical;
    return jsonb_build_object(
      'view_count', coalesce(v_count, 0),
      'counted', coalesce((v_result ->> 'counted')::boolean, false),
      'canonical_post_id', v_canonical
    );
  end if;

  v_result := public.content_register_view('reel', p_reel_id, 'reels');
  return jsonb_build_object(
    'view_count', coalesce((v_result ->> 'unique_views')::bigint, 0),
    'counted', coalesce((v_result ->> 'counted')::boolean, false)
  );
end;
$$;

revoke all on function public.reel_register_view(uuid) from public, anon;
grant execute on function public.reel_register_view(uuid) to authenticated;

commit;

