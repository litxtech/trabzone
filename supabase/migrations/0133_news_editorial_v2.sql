-- ---------------------------------------------------------------------------
-- TRABZONE — Ultra premium haber deneyimi v2 (0133)
--
-- Bu migration mevcut veriyi silmez. Yaptığı işler:
--   1) Editöryal içerik modelini ayırır: title/subtitle/summary/lead/body/
--      source_references/published_at/updated_at.
--   2) AI taslakları ve kaynak haberleri için kalite/uzunluk biçimi ekler.
--   3) Tek bir okuma RPC'si (`news_post_detail`) ile mobil detay ekranını besler.
--   4) İlgili haberler ve editoryal iyileştirme kuyruğu ekler.
--   5) Admin panelinden yönetilen haber kalitesi ayarlarını ekler.
--   6) Profil görünümüne gerçek haber sayısı, kurumsal haber hesabı ve
--      bildirim durumu alanlarını ekler.
--   7) Otomatik yayında doğrulanmamış içerik kapısını sıkılaştırır.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. Editöryal ayarlar (Admin Control Center > Haber Kalite ve Editoryal)
-- ---------------------------------------------------------------------------
alter table public.ai_news_settings
  add column if not exists body_format_default text not null default 'auto'
    check (body_format_default in ('auto', 'short', 'standard', 'extended')),
  add column if not exists short_min_words integer not null default 120
    check (short_min_words between 40 and 400),
  add column if not exists short_max_words integer not null default 200
    check (short_max_words between 60 and 600),
  add column if not exists standard_min_words integer not null default 250
    check (standard_min_words between 100 and 900),
  add column if not exists standard_max_words integer not null default 450
    check (standard_max_words between 150 and 1200),
  add column if not exists extended_min_words integer not null default 500
    check (extended_min_words between 200 and 1600),
  add column if not exists extended_max_words integer not null default 800
    check (extended_max_words between 300 and 2000),
  add column if not exists title_min_chars integer not null default 40
    check (title_min_chars between 10 and 160),
  add column if not exists title_max_chars integer not null default 120
    check (title_max_chars between 20 and 180),
  add column if not exists spot_min_chars integer not null default 90
    check (spot_min_chars between 20 and 380),
  add column if not exists spot_max_chars integer not null default 300
    check (spot_max_chars between 60 and 400),
  add column if not exists preview_lines integer not null default 4
    check (preview_lines between 2 and 6),
  add column if not exists auto_subheads boolean not null default true,
  add column if not exists require_source_verification boolean not null default true,
  add column if not exists quality_check_enabled boolean not null default true,
  add column if not exists source_display_mode text not null default 'card'
    check (source_display_mode in ('card', 'inline', 'both')),
  add column if not exists reading_min_words integer not null default 3
    check (reading_min_words between 1 and 10);

update public.ai_news_settings
   set short_max_words = greatest(short_max_words, short_min_words + 20),
       standard_max_words = greatest(standard_max_words, standard_min_words + 50),
       extended_max_words = greatest(extended_max_words, extended_min_words + 100),
       title_max_chars = greatest(title_max_chars, title_min_chars + 10),
       spot_max_chars = greatest(spot_max_chars, spot_min_chars + 20)
 where id;

-- ---------------------------------------------------------------------------
-- 2. AI taslakları: alt başlık, giriş, biçim, kalite kanıtları
-- ---------------------------------------------------------------------------
alter table public.ai_news_drafts
  add column if not exists subtitle text,
  add column if not exists lead text,
  add column if not exists body_format text not null default 'standard'
    check (body_format in ('short', 'standard', 'extended')),
  add column if not exists editorial_checks jsonb not null default '{}'::jsonb,
  add column if not exists source_facts jsonb not null default '[]'::jsonb,
  add column if not exists source_references jsonb not null default '[]'::jsonb,
  add column if not exists ai_disclosure text;

-- ---------------------------------------------------------------------------
-- 3. Kaynak haberleri: editoryal gövde ve doğrulama izleri
-- ---------------------------------------------------------------------------
alter table public.news_source_items
  add column if not exists subtitle text,
  add column if not exists lead text,
  add column if not exists body_format text not null default 'short'
    check (body_format in ('short', 'standard', 'extended')),
  add column if not exists body_source text not null default 'source'
    check (body_source in ('source', 'ai', 'editor')),
  add column if not exists body_updated_at timestamptz,
  add column if not exists quality_score numeric(4,3),
  add column if not exists editorial_checks jsonb not null default '{}'::jsonb,
  add column if not exists source_references jsonb not null default '[]'::jsonb,
  add column if not exists image_width integer,
  add column if not exists image_height integer;

update public.news_source_items
   set body_format = case
         when coalesce(char_length(body), 0) >= 3200 then 'extended'
         when coalesce(char_length(body), 0) >= 1600 then 'standard'
         else 'short'
       end,
       body_source = case when coalesce(char_length(body), 0) > 0 then 'source' else 'source' end
 where body_format = 'short';

-- Görselin nasıl çerçeveleneceği: metin içeren kurumsal görseller `contain`
-- ile tam görünür; gerçek fotoğraflar kontrollü `cover` ile kırpılır.
alter table public.post_media
  add column if not exists display_fit text not null default 'auto'
    check (display_fit in ('auto', 'cover', 'contain'));

-- Haber bildirim tercihi (profildeki "Bildirimleri Aç/Kapat" düğmesi).
alter table public.notification_preferences
  add column if not exists news boolean not null default true;

-- ---------------------------------------------------------------------------
-- 4. Sürüm geçmişi
-- ---------------------------------------------------------------------------
create table if not exists public.news_article_revisions (
  id              bigserial primary key,
  post_id         uuid not null references public.posts (id) on delete cascade,
  version         integer not null,
  title           text not null,
  subtitle        text,
  summary         text,
  lead            text,
  body            text not null,
  body_format     text not null default 'standard',
  source_kind     text not null default 'source'
                    check (source_kind in ('ai', 'source')),
  editorial_checks jsonb not null default '{}'::jsonb,
  changed_by      uuid references public.profiles (id) on delete set null,
  change_reason   text,
  created_at      timestamptz not null default now(),
  unique (post_id, version)
);

create index if not exists news_article_revisions_post_idx
  on public.news_article_revisions (post_id, version desc);

alter table public.news_article_revisions enable row level security;
revoke all on public.news_article_revisions from anon, authenticated;
grant select on public.news_article_revisions to service_role;

-- ---------------------------------------------------------------------------
-- 5. Metin yardımcıları
-- ---------------------------------------------------------------------------
create or replace function public.news_word_count(p_text text)
returns integer
language sql
immutable
set search_path = public
as $$
  select coalesce(
    array_length(regexp_split_to_array(btrim(coalesce(p_text, '')), '\s+'), 1),
    0
  );
$$;

revoke all on function public.news_word_count(text) from public, anon, authenticated;
grant execute on function public.news_word_count(text) to service_role, authenticated;

/** Sosyal akış önizlemesi: gövdenin ilk anlamlı paragrafları (2-4 satır). */
create or replace function public.news_preview_text(p_text text, p_max_chars integer default 360)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'),
        '^(\s*##\s*)', '', 'g'
      )
    ),
    greatest(coalesce(p_max_chars, 360), 80)
  );
$$;

revoke all on function public.news_preview_text(text, integer) from public, anon, authenticated;
grant execute on function public.news_preview_text(text, integer) to service_role, authenticated;

/** Biçime göre hedef kelime aralığı. */
create or replace function public.news_format_range(p_format text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce(p_format, 'standard')
    when 'short' then jsonb_build_object(
      'format', 'short', 'min', s.short_min_words, 'max', s.short_max_words)
    when 'extended' then jsonb_build_object(
      'format', 'extended', 'min', s.extended_min_words, 'max', s.extended_max_words)
    else jsonb_build_object(
      'format', 'standard', 'min', s.standard_min_words, 'max', s.standard_max_words)
  end
  from public.ai_news_settings s where s.id;
$$;

revoke all on function public.news_format_range(text) from public, anon, authenticated;
grant execute on function public.news_format_range(text) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Editoryal ayarlar (worker + admin)
-- ---------------------------------------------------------------------------
create or replace function public.news_editorial_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'body_format_default', s.body_format_default,
    'short_min_words', s.short_min_words,
    'short_max_words', s.short_max_words,
    'standard_min_words', s.standard_min_words,
    'standard_max_words', s.standard_max_words,
    'extended_min_words', s.extended_min_words,
    'extended_max_words', s.extended_max_words,
    'title_min_chars', s.title_min_chars,
    'title_max_chars', s.title_max_chars,
    'spot_min_chars', s.spot_min_chars,
    'spot_max_chars', s.spot_max_chars,
    'preview_lines', s.preview_lines,
    'auto_subheads', s.auto_subheads,
    'require_source_verification', s.require_source_verification,
    'quality_check_enabled', s.quality_check_enabled,
    'source_display_mode', s.source_display_mode,
    'min_quality_score', s.min_quality_score,
    'reading_min_words', s.reading_min_words
  )
  from public.ai_news_settings s
  where s.id;
$$;

revoke all on function public.news_editorial_settings() from public, anon, authenticated;
grant execute on function public.news_editorial_settings() to service_role;

create or replace function public.news_editorial_settings_public()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'preview_lines', s.preview_lines,
    'source_display_mode', s.source_display_mode,
    'reading_min_words', s.reading_min_words
  )
  from public.ai_news_settings s
  where s.id;
$$;

revoke all on function public.news_editorial_settings_public() from public, anon, authenticated;
grant execute on function public.news_editorial_settings_public() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Admin ayar kaydı: yeni editoryal alanlar
-- ---------------------------------------------------------------------------
create or replace function public.admin_ai_news_settings_save(
  p_payload jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_settings public.ai_news_settings%rowtype;
  v_old jsonb;
  v_publisher uuid;
  v_username extensions.citext := lower(btrim(coalesce(p_payload ->> 'publisher_username', 'trabzonehaber')));
begin
  select * into v_settings from public.ai_news_settings where id for update;
  v_old := to_jsonb(v_settings);

  if p_payload ? 'publisher_username' then
    select p.id into v_publisher from public.profiles p where p.username = v_username;
  else
    v_publisher := v_settings.publisher_user_id;
    v_username := v_settings.publisher_username;
  end if;

  update public.ai_news_settings
     set enabled = coalesce((p_payload ->> 'enabled')::boolean, enabled),
         auto_publish_enabled = coalesce((p_payload ->> 'auto_publish_enabled')::boolean, auto_publish_enabled),
         dry_run = coalesce((p_payload ->> 'dry_run')::boolean, dry_run),
         scan_interval_minutes = coalesce((p_payload ->> 'scan_interval_minutes')::integer, scan_interval_minutes),
         daily_auto_limit = coalesce((p_payload ->> 'daily_auto_limit')::integer, daily_auto_limit),
         max_events_per_run = coalesce((p_payload ->> 'max_events_per_run')::integer, max_events_per_run),
         max_searches_per_run = coalesce((p_payload ->> 'max_searches_per_run')::integer, max_searches_per_run),
         max_article_age_hours = coalesce((p_payload ->> 'max_article_age_hours')::integer, max_article_age_hours),
         min_quality_score = coalesce((p_payload ->> 'min_quality_score')::numeric, min_quality_score),
         duplicate_title_threshold = coalesce((p_payload ->> 'duplicate_title_threshold')::numeric, duplicate_title_threshold),
         min_media_match = coalesce((p_payload ->> 'min_media_match')::numeric, min_media_match),
         publish_window_start = coalesce((p_payload ->> 'publish_window_start')::integer, publish_window_start),
         publish_window_end = coalesce((p_payload ->> 'publish_window_end')::integer, publish_window_end),
         auto_min_gap_minutes = coalesce((p_payload ->> 'auto_min_gap_minutes')::integer, auto_min_gap_minutes),
         publisher_user_id = v_publisher,
         publisher_username = v_username,
         fast_model = coalesce(nullif(p_payload ->> 'fast_model', ''), fast_model),
         reasoning_model = coalesce(nullif(p_payload ->> 'reasoning_model', ''), reasoning_model),
         daily_budget_usd = coalesce((p_payload ->> 'daily_budget_usd')::numeric, daily_budget_usd),
         monthly_budget_usd = coalesce((p_payload ->> 'monthly_budget_usd')::numeric, monthly_budget_usd),
         notify_enabled = coalesce((p_payload ->> 'notify_enabled')::boolean, notify_enabled),
         notify_daily_cap = coalesce((p_payload ->> 'notify_daily_cap')::integer, notify_daily_cap),
         notify_quiet_start = coalesce((p_payload ->> 'notify_quiet_start')::integer, notify_quiet_start),
         notify_quiet_end = coalesce((p_payload ->> 'notify_quiet_end')::integer, notify_quiet_end),
         notify_categories = case
           when p_payload ? 'notify_categories'
             then coalesce(array(select jsonb_array_elements_text(p_payload -> 'notify_categories')), '{}'::text[])
           else notify_categories
         end,
         worker_url = coalesce(nullif(p_payload ->> 'worker_url', ''), worker_url),
         next_run_at = case
           when p_payload ? 'scan_interval_minutes'
             then least(next_run_at, now() + make_interval(mins => coalesce((p_payload ->> 'scan_interval_minutes')::integer, scan_interval_minutes)))
           else next_run_at
         end,
         -- Editoryal kalite ayarları
         body_format_default = coalesce(nullif(p_payload ->> 'body_format_default', ''), body_format_default),
         short_min_words = coalesce((p_payload ->> 'short_min_words')::integer, short_min_words),
         short_max_words = coalesce((p_payload ->> 'short_max_words')::integer, short_max_words),
         standard_min_words = coalesce((p_payload ->> 'standard_min_words')::integer, standard_min_words),
         standard_max_words = coalesce((p_payload ->> 'standard_max_words')::integer, standard_max_words),
         extended_min_words = coalesce((p_payload ->> 'extended_min_words')::integer, extended_min_words),
         extended_max_words = coalesce((p_payload ->> 'extended_max_words')::integer, extended_max_words),
         title_min_chars = coalesce((p_payload ->> 'title_min_chars')::integer, title_min_chars),
         title_max_chars = coalesce((p_payload ->> 'title_max_chars')::integer, title_max_chars),
         spot_min_chars = coalesce((p_payload ->> 'spot_min_chars')::integer, spot_min_chars),
         spot_max_chars = coalesce((p_payload ->> 'spot_max_chars')::integer, spot_max_chars),
         preview_lines = coalesce((p_payload ->> 'preview_lines')::integer, preview_lines),
         auto_subheads = coalesce((p_payload ->> 'auto_subheads')::boolean, auto_subheads),
         require_source_verification = coalesce((p_payload ->> 'require_source_verification')::boolean, require_source_verification),
         quality_check_enabled = coalesce((p_payload ->> 'quality_check_enabled')::boolean, quality_check_enabled),
         source_display_mode = coalesce(nullif(p_payload ->> 'source_display_mode', ''), source_display_mode),
         reading_min_words = coalesce((p_payload ->> 'reading_min_words')::integer, reading_min_words),
         updated_at = now()
   where id;

  select * into v_settings from public.ai_news_settings where id;

  -- Mantıksal aralıklar (min <= max) sunucuda düzeltilir.
  update public.ai_news_settings
     set short_max_words = greatest(short_max_words, short_min_words + 20),
         standard_max_words = greatest(standard_max_words, standard_min_words + 50),
         extended_max_words = greatest(extended_max_words, extended_min_words + 100),
         title_max_chars = greatest(title_max_chars, title_min_chars + 10),
         spot_max_chars = greatest(spot_max_chars, spot_min_chars + 20)
   where id;

  perform public.tz_admin_audit(
    'news.settings.save', 'AI Haber Merkezi ve editoryal ayarlar güncellendi', 'ai_news', 'settings',
    jsonb_build_object(
      'old', jsonb_build_object(
        'enabled', v_old -> 'enabled',
        'auto_publish_enabled', v_old -> 'auto_publish_enabled',
        'dry_run', v_old -> 'dry_run',
        'body_format_default', v_old -> 'body_format_default',
        'standard_min_words', v_old -> 'standard_min_words',
        'standard_max_words', v_old -> 'standard_max_words'
      ),
      'new', jsonb_build_object(
        'enabled', v_settings.enabled,
        'auto_publish_enabled', v_settings.auto_publish_enabled,
        'dry_run', v_settings.dry_run,
        'body_format_default', v_settings.body_format_default,
        'standard_min_words', v_settings.standard_min_words,
        'standard_max_words', v_settings.standard_max_words
      ),
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  return (
    select to_jsonb(s) - 'id' - 'created_at' - 'updated_at' - 'last_diagnostics'
    from public.ai_news_settings s where s.id
  );
end;
$$;

revoke all on function public.admin_ai_news_settings_save(jsonb, text) from public, anon;
grant execute on function public.admin_ai_news_settings_save(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Taslak kaydı: alt başlık, giriş ve kalite kanıtları
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_draft_save(
  p_event_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.ai_news_events%rowtype;
  v_title text := btrim(coalesce(p_payload ->> 'title', ''));
  v_subtitle text := nullif(btrim(coalesce(p_payload ->> 'subtitle', '')), '');
  v_spot text := btrim(coalesce(p_payload ->> 'spot', ''));
  v_lead text := nullif(btrim(coalesce(p_payload ->> 'lead', '')), '');
  v_body text := btrim(coalesce(p_payload ->> 'body', ''));
  v_format text := lower(coalesce(nullif(p_payload ->> 'body_format', ''), 'standard'));
  v_category text := nullif(p_payload ->> 'category_slug', '');
  v_quality numeric := least(greatest(coalesce((p_payload ->> 'quality_score')::numeric, 0), 0), 1);
  v_plagiarism numeric := least(greatest(coalesce((p_payload ->> 'plagiarism_score')::numeric, 0), 0), 1);
  v_risk text := upper(coalesce(nullif(p_payload ->> 'risk_level', ''), 'B'));
  v_checks jsonb := coalesce(p_payload -> 'editorial_checks', '{}'::jsonb);
  v_facts jsonb := coalesce(p_payload -> 'source_facts', '[]'::jsonb);
  v_refs jsonb := coalesce(p_payload -> 'source_references', '[]'::jsonb);
  v_version integer;
  v_id uuid;
  v_words integer;
begin
  if char_length(v_title) < 15 or char_length(v_title) > 180 then
    raise exception 'title_length_invalid' using errcode = '22023';
  end if;
  if char_length(v_spot) < 40 or char_length(v_spot) > 400 then
    raise exception 'spot_length_invalid' using errcode = '22023';
  end if;
  if char_length(v_body) < 350 or char_length(v_body) > 20000 then
    raise exception 'body_length_invalid' using errcode = '22023';
  end if;
  if v_plagiarism > 0.35 then
    raise exception 'plagiarism_risk' using errcode = '22023';
  end if;
  if v_risk not in ('A', 'B', 'C') then
    v_risk := 'B';
  end if;
  if v_format not in ('short', 'standard', 'extended') then
    v_format := 'standard';
  end if;

  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  if v_event.risk_level = 'C' or v_risk = 'C' then
    v_risk := 'C';
  elsif v_event.risk_level = 'B' or v_risk = 'B' then
    v_risk := 'B';
  else
    v_risk := 'A';
  end if;

  select coalesce(max(d.version), 0) + 1 into v_version
  from public.ai_news_drafts d where d.event_id = p_event_id;

  update public.ai_news_drafts set is_current = false where event_id = p_event_id;

  v_words := public.news_word_count(v_body);

  insert into public.ai_news_drafts (
    event_id, version, is_current, title, subtitle, spot, lead, body, social_copy,
    category_slug, district, event_date, seo_title, seo_description,
    quality_score, plagiarism_score, risk_level, status, ai_model, ai_generated, word_count,
    body_format, editorial_checks, source_facts, source_references, ai_disclosure
  ) values (
    p_event_id, v_version, true, left(v_title, 180), left(v_subtitle, 220), left(v_spot, 400),
    left(v_lead, 1200), v_body,
    left(nullif(p_payload ->> 'social_copy', ''), 500),
    coalesce(v_category, v_event.category_slug, 'diger'),
    coalesce(nullif(p_payload ->> 'district', ''), v_event.district),
    coalesce(nullif(p_payload ->> 'event_date', '')::date, v_event.event_date),
    left(nullif(p_payload ->> 'seo_title', ''), 70),
    left(nullif(p_payload ->> 'seo_description', ''), 180),
    v_quality, v_plagiarism, v_risk, 'draft',
    left(nullif(p_payload ->> 'ai_model', ''), 80), true, v_words,
    v_format, v_checks, v_facts, v_refs,
    nullif(btrim(coalesce(p_payload ->> 'ai_disclosure', '')), '')
  )
  returning id into v_id;

  update public.ai_news_events
     set category_slug = coalesce(category_slug, v_category),
         risk_level = v_risk,
         last_seen_at = now()
   where id = p_event_id;

  if v_event.status in ('verified', 'classified') then
    perform public.ai_news_event_set_status(p_event_id, 'draft');
  end if;

  return jsonb_build_object(
    'draft_id', v_id,
    'version', v_version,
    'word_count', v_words,
    'body_format', v_format,
    'risk_level', v_risk
  );
end;
$$;

revoke all on function public.ai_news_draft_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ai_news_draft_save(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Otomatik yayın kapısı: doğrulanmamış olgu / kaynaksız metin geçemez
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_publication_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.ai_news_drafts%rowtype;
  v_settings public.ai_news_settings%rowtype;
  v_unsupported integer := 0;
begin
  if new.mode <> 'auto' then
    return new;
  end if;

  select * into v_settings from public.ai_news_settings where id;
  if not coalesce(v_settings.quality_check_enabled, true) then
    return new;
  end if;

  select * into v_draft from public.ai_news_drafts where id = new.draft_id;
  if not found then
    return new;
  end if;

  begin
    v_unsupported := coalesce((v_draft.editorial_checks ->> 'unsupported_claims')::integer, 0);
  exception when others then
    v_unsupported := 0;
  end;

  if v_unsupported > 0 then
    raise exception 'editorial_check_failed' using errcode = '22023';
  end if;

  if coalesce(v_settings.require_source_verification, true)
     and coalesce(jsonb_array_length(v_draft.source_references), 0) = 0
     and coalesce(jsonb_array_length(v_draft.source_facts), 0) = 0 then
    raise exception 'source_reference_missing' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists ai_news_publication_guard on public.ai_news_publications;
create trigger ai_news_publication_guard
  before insert on public.ai_news_publications
  for each row execute function public.ai_news_publication_guard();

revoke all on function public.ai_news_publication_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Akış kartı haber meta'sı (AI)
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_public_post(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_publication public.ai_news_publications%rowtype;
  v_category public.ai_news_categories%rowtype;
  v_sources jsonb;
  v_media public.ai_news_media_assets%rowtype;
  v_post public.posts%rowtype;
begin
  select * into v_post from public.posts where id = p_post_id;
  if not found or v_post.moderation_status <> 'visible' then
    return null;
  end if;

  select * into v_publication
  from public.ai_news_publications
  where post_id = p_post_id and status = 'published';
  if not found then
    return null;
  end if;

  select * into v_event from public.ai_news_events where id = v_publication.event_id;
  select * into v_draft from public.ai_news_drafts where id = v_publication.draft_id;
  select * into v_category from public.ai_news_categories
  where slug = coalesce(v_draft.category_slug, v_event.category_slug);
  select * into v_media from public.ai_news_media_assets
  where event_id = v_event.id and status = 'published'
  order by created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'domain', v.source_domain::text,
    'kind', v.source_kind,
    'url', v.url,
    'title', v.title,
    'retrieved_at', v.retrieved_at
  ) order by v.source_kind = 'official' desc, v.retrieved_at), '[]'::jsonb)
  into v_sources
  from public.ai_news_evidence v
  where v.event_id = v_event.id;

  return jsonb_build_object(
    'event_id', v_event.id,
    'post_id', p_post_id,
    'kind', 'ai',
    'slug', v_publication.slug,
    'title', v_draft.title,
    'subtitle', v_draft.subtitle,
    'spot', v_draft.spot,
    'lead', v_draft.lead,
    'preview', public.news_preview_text(
      coalesce(nullif(v_draft.lead, ''), v_draft.body), 380),
    'body', v_draft.body,
    'body_format', coalesce(v_draft.body_format, 'standard'),
    'word_count', coalesce(v_draft.word_count, public.news_word_count(v_draft.body)),
    'reading_minutes', greatest(
      coalesce((select s.reading_min_words from public.ai_news_settings s), 3),
      ceil(coalesce(v_draft.word_count, public.news_word_count(v_draft.body)) / 200.0)::integer
    ),
    'category_slug', coalesce(v_draft.category_slug, v_event.category_slug),
    'category_name', coalesce(v_category.name_tr, 'Trabzon Gündem'),
    'district', coalesce(v_draft.district, v_event.district),
    'event_date', coalesce(v_draft.event_date, v_event.event_date),
    'risk_level', v_event.risk_level,
    'ai_generated', true,
    'ai_model', v_draft.ai_model,
    'ai_disclosure', coalesce(
      v_draft.ai_disclosure,
      'Bu haber, kamuya açık kaynaklardan derlenen doğrulanmış bilgilerle Trabzone Haber editoryası tarafından hazırlanmıştır. Metin yapay zekâ desteğiyle yazılmış, yayın kararı kaynak doğrulaması ve risk kurallarıyla verilmiştir.'
    ),
    'disclosure', coalesce(
      v_draft.ai_disclosure,
      'Bu haber, Trabzone AI Haber Merkezi tarafından kamuya açık kaynaklardan derlenmiştir. Metin yapay zekâ desteğiyle hazırlanır; yayın kararı kaynak doğrulaması ve risk kurallarıyla verilir.'
    ),
    'sources', v_sources,
    'source_count', jsonb_array_length(v_sources),
    'independent_sources', v_event.independent_sources,
    'primary_source', v_event.primary_source,
    'published_at', v_publication.published_at,
    'updated_at', greatest(v_draft.updated_at, v_publication.published_at),
    'last_checked_at', v_publication.published_at,
    'correction_path', '/support',
    'published_by', 'Trabzone Haber',
    'editorial_checks', v_draft.editorial_checks,
    'media', case when v_media.id is null then null else jsonb_build_object(
      'storage_path', v_media.storage_path,
      'thumbnail_path', v_media.thumbnail_path,
      'is_placeholder', v_media.is_placeholder,
      'alt_text', v_media.alt_text,
      'credit', v_media.credit,
      'license_code', v_media.license_code,
      'attribution', v_media.attribution,
      'width', v_media.width,
      'height', v_media.height,
      'display_fit', case
        when coalesce(v_media.is_placeholder, false) then 'contain'
        when v_media.width is not null and v_media.height is not null
          and v_media.width::numeric / greatest(v_media.height, 1) < 0.9 then 'contain'
        else 'cover'
      end
    ) end
  );
end;
$$;

revoke all on function public.ai_news_public_post(uuid) from public, anon, authenticated;
grant execute on function public.ai_news_public_post(uuid) to anon, authenticated, service_role;

create or replace function public.ai_news_post_meta(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  v_data := public.ai_news_public_post(p_post_id);
  if v_data is null then
    return null;
  end if;
  return v_data - 'body' - 'disclosure' - 'correction_path' - 'editorial_checks';
end;
$$;

revoke all on function public.ai_news_post_meta(uuid) from public, anon, authenticated;
grant execute on function public.ai_news_post_meta(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 11. Kaynak haberi meta'sı (akış kartı)
-- ---------------------------------------------------------------------------
create or replace function public.news_source_post_meta(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'name', coalesce(
      nullif(btrim(coalesce(sp.display_name, '')), ''),
      nullif(btrim(coalesce(pp.display_name, '')), ''),
      nullif(btrim(coalesce(i.source_name, '')), ''),
      nullif(btrim(coalesce(c.name, '')), ''),
      'Haber kaynağı'
    ),
    'username', nullif(btrim(coalesce(sp.username, pp.username, '')), ''),
    'domain', nullif(btrim(split_part(regexp_replace(coalesce(i.canonical_url, ''), '^https?://', ''), '/', 1)), ''),
    'url', i.canonical_url,
    'logo_url', coalesce(
      nullif(btrim(coalesce(sp.avatar_url, '')), ''),
      case
        when nullif(btrim(coalesce(i.canonical_url, '')), '') is null then null
        else 'https://www.google.com/s2/favicons?sz=128&domain=' ||
             split_part(regexp_replace(i.canonical_url, '^https?://', ''), '/', 1)
      end
    ),
    'verified', coalesce(sp.verified, pp.is_verified, false),
    'author', nullif(btrim(coalesce(i.author, '')), ''),
    'mode', l.mode,
    'attribution', nullif(btrim(coalesce(i.license_snapshot ->> 'attribution_text', '')), ''),
    'license_status', c.license_status,
    'same_as_author', pp.id is not null and pp.id = p.author_id,
    -- Okuma deneyimi için birleşik haber meta'sı
    'post_id', p_post_id,
    'kind', 'source',
    'slug', 'kaynak-' || p_post_id::text,
    'title', i.title,
    'subtitle', i.subtitle,
    'spot', i.summary,
    'lead', i.lead,
    'preview', public.news_preview_text(
      coalesce(nullif(i.lead, ''), nullif(i.body, ''), i.summary), 380),
    'body_format', coalesce(i.body_format, 'short'),
    'word_count', coalesce(public.news_word_count(i.body), 0),
    'category_slug', coalesce(i.category_slug, 'trabzon-gundem'),
    'category_name', coalesce(nc.name_tr, 'Trabzon Gündem'),
    'district', coalesce(i.district, 'Trabzon'),
    'ai_generated', i.body_source in ('ai', 'editor'),
    'source_count', 1,
    'updated_at', greatest(
      p.updated_at,
      coalesce(i.body_updated_at, i.last_seen_at, p.updated_at)
    ),
    'published_at', coalesce(i.published_at, p.created_at)
  )
  from public.news_publication_links l
    join public.news_source_items i on i.id = l.item_id
    join public.posts p on p.id = l.post_id
    left join public.news_api_connections c on c.id = i.connection_id
    left join public.news_source_profiles sp on sp.connection_id = i.connection_id
    left join public.profiles pp on pp.id = sp.profile_id
    left join public.news_categories nc on nc.slug = i.category_slug
  where l.post_id = p_post_id
    and l.status = 'published'
  order by l.published_at
  limit 1;
$$;

revoke all on function public.news_source_post_meta(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. Akış kartı JSON'u: görsel çerçeveleme bilgisi + haber meta'sı
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
  where p.id = p_post_id;
$$;

revoke all on function public.tz_post_json(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. Tek okuma RPC'si: tam haber detayı
-- ---------------------------------------------------------------------------
create or replace function public.news_post_detail(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post public.posts%rowtype;
  v_ai jsonb;
  v_source jsonb;
  v_meta jsonb;
  v_item public.news_source_items%rowtype;
  v_kind text;
  v_body text;
  v_lead text;
  v_subtitle text;
  v_summary text;
  v_title text;
  v_category_slug text;
  v_category_name text;
  v_district text;
  v_format text;
  v_word_count integer;
  v_published timestamptz;
  v_updated timestamptz;
  v_published_by text;
  v_disclosure text;
  v_sources jsonb := '[]'::jsonb;
  v_media jsonb := '[]'::jsonb;
  v_body_notice text;
  v_source_card jsonb;
  v_profile record;
begin
  select * into v_post from public.posts where id = p_post_id;
  if not found or v_post.moderation_status <> 'visible' then
    return null;
  end if;

  v_ai := public.ai_news_public_post(p_post_id);

  if v_ai is not null then
    v_kind := 'ai';
    v_title := v_ai ->> 'title';
    v_subtitle := v_ai ->> 'subtitle';
    v_summary := v_ai ->> 'spot';
    v_lead := v_ai ->> 'lead';
    v_body := v_ai ->> 'body';
    v_format := coalesce(v_ai ->> 'body_format', 'standard');
    v_word_count := coalesce((v_ai ->> 'word_count')::integer, public.news_word_count(v_body));
    v_category_slug := v_ai ->> 'category_slug';
    v_category_name := v_ai ->> 'category_name';
    v_district := v_ai ->> 'district';
    v_published := (v_ai ->> 'published_at')::timestamptz;
    v_updated := (v_ai ->> 'updated_at')::timestamptz;
    v_published_by := coalesce(v_ai ->> 'published_by', 'Trabzone Haber');
    v_disclosure := v_ai ->> 'ai_disclosure';
    v_sources := coalesce(v_ai -> 'sources', '[]'::jsonb);
  else
    v_meta := public.news_source_post_meta(p_post_id);
    if v_meta is null then
      return null;
    end if;

    select i.* into v_item
    from public.news_publication_links l
      join public.news_source_items i on i.id = l.item_id
    where l.post_id = p_post_id and l.status = 'published'
    order by l.published_at
    limit 1;

    v_kind := 'source';
    v_title := coalesce(v_item.title, v_meta ->> 'title');
    v_subtitle := v_item.subtitle;
    v_summary := v_item.summary;
    v_lead := v_item.lead;
    v_format := coalesce(v_item.body_format, 'short');
    v_category_slug := coalesce(v_item.category_slug, 'trabzon-gundem');
    v_category_name := coalesce(v_meta ->> 'category_name', 'Trabzon Gündem');
    v_district := coalesce(v_item.district, 'Trabzon');
    v_published := coalesce(v_item.published_at, v_post.created_at);
    v_updated := greatest(
      v_post.updated_at,
      coalesce(v_item.body_updated_at, v_item.last_seen_at, v_post.updated_at)
    );
    v_published_by := coalesce(v_meta ->> 'name', 'Trabzone Haber');
    v_disclosure := 'Bu haber, ' || coalesce(v_meta ->> 'name', 'haber kaynağı') ||
      ' tarafından kamuya açıklanan bilgilerden yararlanılarak Trabzone Haber editoryası tarafından yeniden yazılmıştır. ' ||
      'Orijinal kaynağa ve kaynak bilgisine sayfanın altından ulaşabilirsiniz.';

    -- Gövde: Trabzone'nun kendi yazdığı editoryal metin her zaman gösterilir;
    -- doğrudan kaynak metni yalnızca lisans izin veriyorsa kullanılır.
    if coalesce(v_item.body_format, 'short') in ('standard', 'extended')
       or v_item.body_source in ('ai', 'editor') then
      v_body := nullif(btrim(coalesce(v_item.body, '')), '');
    end if;
    if v_body is null and coalesce((v_item.license_snapshot ->> 'can_republish_text')::boolean, false) then
      v_body := nullif(btrim(coalesce(v_item.body, '')), '');
    end if;
    if v_body is null then
      v_body := concat_ws(
        E'\n\n',
        nullif(btrim(coalesce(v_item.lead, '')), ''),
        nullif(btrim(coalesce(v_item.summary, '')), '')
      );
      v_body_notice := 'Bu haber özet olarak yayımlanmıştır. Tam metin için orijinal kaynağa gidebilirsiniz.';
    end if;

    v_word_count := public.news_word_count(v_body);
    v_sources := jsonb_build_array(jsonb_build_object(
      'domain', split_part(regexp_replace(coalesce(v_item.canonical_url, ''), '^https?://', ''), '/', 1),
      'kind', 'source',
      'url', v_item.canonical_url,
      'title', v_item.title,
      'retrieved_at', v_item.last_seen_at,
      'name', coalesce(v_meta ->> 'name', v_item.source_name)
    ));
  end if;

  -- Medya galerisi: yayınlanmış post_media kayıtları tek kaynak.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'storage_path', m.storage_path,
    'thumbnail_path', m.thumbnail_path,
    'media_type', m.media_type,
    'width', m.width,
    'height', m.height,
    'duration_ms', m.duration_ms,
    'display_fit', m.display_fit,
    'alt_text', coalesce(asset.alt_text, v_title),
    'credit', asset.credit,
    'license_code', asset.license_code,
    'attribution', coalesce(asset.attribution, v_meta ->> 'attribution'),
    'is_placeholder', coalesce(asset.is_placeholder, false)
  ) order by m.sort_order, m.created_at), '[]'::jsonb)
  into v_media
  from public.post_media m
    left join public.ai_news_media_assets asset
      on asset.storage_path = m.storage_path
     and asset.status in ('approved', 'published')
  where m.post_id = p_post_id;

  -- Kaynak kartı (kaynak haberlerinde)
  if v_kind = 'source' then
    v_source_card := public.news_source_post_meta(p_post_id);
  end if;

  select pr.username, pr.is_verified, pr.avatar_path, pr.display_name
  into v_profile
  from public.profiles pr
  where pr.id = v_post.author_id;

  return jsonb_build_object(
    'post_id', p_post_id,
    'kind', v_kind,
    'title', v_title,
    'subtitle', v_subtitle,
    'summary', v_summary,
    'lead', v_lead,
    'body', coalesce(v_body, ''),
    'body_notice', v_body_notice,
    'body_format', v_format,
    'word_count', v_word_count,
    'reading_minutes', greatest(
      coalesce((select s.reading_min_words from public.ai_news_settings s), 3),
      ceil(greatest(v_word_count, 1) / 200.0)::integer
    ),
    'category_slug', v_category_slug,
    'category_name', v_category_name,
    'district', v_district,
    'published_at', v_published,
    'updated_at', v_updated,
    'published_by', v_published_by,
    'publisher', jsonb_build_object(
      'username', v_profile.username,
      'display_name', v_profile.display_name,
      'avatar_path', v_profile.avatar_path,
      'is_verified', v_profile.is_verified
    ),
    'ai_generated', v_kind = 'ai' or coalesce(v_meta ->> 'ai_generated', 'false') = 'true',
    'disclosure', v_disclosure,
    'sources', v_sources,
    'source_count', jsonb_array_length(v_sources),
    'source_card', v_source_card,
    'media', v_media,
    'editorial_checks', case when v_kind = 'ai'
      then (v_ai -> 'editorial_checks')
      else coalesce(v_item.editorial_checks, '{}'::jsonb) end,
    'counts', jsonb_build_object(
      'like', v_post.like_count,
      'comment', v_post.comment_count,
      'save', v_post.save_count,
      'share', v_post.share_count
    )
  );
end;
$$;

revoke all on function public.news_post_detail(uuid) from public, anon;
grant execute on function public.news_post_detail(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14. İlgili haberler: yalnızca gerçekten benzer konular
-- ---------------------------------------------------------------------------
create or replace function public.news_related_posts(
  p_post_id uuid,
  p_limit integer default 6
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 12);
  v_kind text;
  v_category text;
  v_district text;
  v_title text;
begin
  select case when exists (
      select 1 from public.ai_news_publications p
      where p.post_id = p_post_id and p.status = 'published'
    ) then 'ai' else 'source' end
  into v_kind;

  if v_kind = 'ai' then
    select coalesce(d.category_slug, e.category_slug),
           coalesce(d.district, e.district),
           d.title
    into v_category, v_district, v_title
    from public.ai_news_publications pu
      join public.ai_news_drafts d on d.id = pu.draft_id
      join public.ai_news_events e on e.id = pu.event_id
    where pu.post_id = p_post_id and pu.status = 'published';
  else
    select coalesce(i.category_slug, 'trabzon-gundem'), i.district, i.title
    into v_category, v_district, v_title
    from public.news_publication_links l
      join public.news_source_items i on i.id = l.item_id
    where l.post_id = p_post_id and l.status = 'published'
    order by l.published_at
    limit 1;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'post_id', x.post_id,
      'title', x.title,
      'category_name', x.category_name,
      'district', x.district,
      'published_at', x.published_at,
      'media_path', x.media_path,
      'media_fit', x.media_fit,
      'kind', x.kind,
      'word_count', x.word_count
    ) order by x.score desc, x.published_at desc)
    from (
      select
        p.id as post_id,
        coalesce(d.title, i.title, p.body) as title,
        coalesce(nc.name_tr, 'Trabzon Gündem') as category_name,
        coalesce(d.district, i.district, 'Trabzon') as district,
        coalesce(d.updated_at, i.published_at, p.created_at) as published_at,
        (select m.storage_path from public.post_media m
          where m.post_id = p.id
          order by m.sort_order limit 1) as media_path,
        (select m.display_fit from public.post_media m
          where m.post_id = p.id
          order by m.sort_order limit 1) as media_fit,
        case when exists (
          select 1 from public.ai_news_publications ap
          where ap.post_id = p.id and ap.status = 'published'
        ) then 'ai' else 'source' end as kind,
        coalesce(d.word_count, public.news_word_count(i.body), 0) as word_count,
        (
          case when coalesce(d.category_slug, i.category_slug) = v_category then 3 else 0 end
          + case when coalesce(d.district, i.district) = v_district then 2 else 0 end
        ) as score
      from public.posts p
        left join public.news_publication_links l
          on l.post_id = p.id and l.status = 'published'
        left join public.news_source_items i on i.id = l.item_id
        left join public.ai_news_publications pu
          on pu.post_id = p.id and pu.status = 'published'
        left join public.ai_news_drafts d on d.id = pu.draft_id
        left join public.news_categories nc
          on nc.slug = coalesce(d.category_slug, i.category_slug)
      where p.id <> p_post_id
        and p.moderation_status = 'visible'
        and (l.id is not null or pu.id is not null)
        and (
          coalesce(d.category_slug, i.category_slug) = v_category
          or coalesce(d.district, i.district) = v_district
        )
        and exists (
          select 1 from public.profiles pr
          where pr.id = p.author_id and pr.account_status = 'active'
        )
      order by score desc, published_at desc
      limit v_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.news_related_posts(uuid, integer) from public, anon;
grant execute on function public.news_related_posts(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 15. Kaynak haberine editoryal gövde kaydetme (yalnızca sunucu)
-- ---------------------------------------------------------------------------
create or replace function public.news_source_enrich_save(
  p_post_id uuid,
  p_payload jsonb,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.news_source_items%rowtype;
  v_title text := nullif(btrim(coalesce(p_payload ->> 'title', '')), '');
  v_subtitle text := nullif(btrim(coalesce(p_payload ->> 'subtitle', '')), '');
  v_summary text := nullif(btrim(coalesce(p_payload ->> 'summary', '')), '');
  v_lead text := nullif(btrim(coalesce(p_payload ->> 'lead', '')), '');
  v_body text := nullif(btrim(coalesce(p_payload ->> 'body', '')), '');
  v_format text := lower(coalesce(nullif(p_payload ->> 'body_format', ''), 'short'));
  v_source text := lower(coalesce(nullif(p_payload ->> 'body_source', ''), 'ai'));
  v_quality numeric := least(greatest(coalesce((p_payload ->> 'quality_score')::numeric, 0.7), 0), 1);
  v_checks jsonb := coalesce(p_payload -> 'editorial_checks', '{}'::jsonb);
  v_refs jsonb := coalesce(p_payload -> 'source_references', '[]'::jsonb);
  v_version integer;
begin
  select i.* into v_item
  from public.news_publication_links l
    join public.news_source_items i on i.id = l.item_id
  where l.post_id = p_post_id and l.status = 'published'
  order by l.published_at
  limit 1;

  if v_item.id is null then
    raise exception 'source_item_not_found' using errcode = 'P0002';
  end if;

  if v_body is null or char_length(v_body) < 600 then
    raise exception 'body_too_short' using errcode = '22023';
  end if;
  if v_format not in ('short', 'standard', 'extended') then
    v_format := 'standard';
  end if;
  if v_source not in ('source', 'ai', 'editor') then
    v_source := 'ai';
  end if;

  select coalesce(max(r.version), 0) + 1 into v_version
  from public.news_article_revisions r where r.post_id = p_post_id;

  insert into public.news_article_revisions (
    post_id, version, title, subtitle, summary, lead, body, body_format,
    source_kind, editorial_checks, changed_by, change_reason
  ) values (
    p_post_id, v_version,
    coalesce(v_title, v_item.title),
    coalesce(v_subtitle, v_item.subtitle),
    coalesce(v_summary, v_item.summary),
    coalesce(v_lead, v_item.lead),
    v_body, v_format, 'source', v_checks, p_actor,
    nullif(btrim(coalesce(p_payload ->> 'change_reason', '')), '')
  );

  update public.news_source_items
     set title = coalesce(v_title, title),
         subtitle = coalesce(v_subtitle, subtitle),
         summary = coalesce(v_summary, summary),
         lead = coalesce(v_lead, lead),
         body = v_body,
         body_format = v_format,
         body_source = v_source,
         body_updated_at = now(),
         quality_score = v_quality,
         editorial_checks = v_checks,
         source_references = v_refs,
         last_seen_at = now()
   where id = v_item.id;

  return jsonb_build_object(
    'ok', true,
    'post_id', p_post_id,
    'version', v_version,
    'word_count', public.news_word_count(v_body),
    'body_format', v_format
  );
end;
$$;

revoke all on function public.news_source_enrich_save(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.news_source_enrich_save(uuid, jsonb, uuid) to service_role;

-- Admin panelinden kaynak haberi gövdesini düzenleme (yetki RPC içinde).
create or replace function public.admin_news_source_save(
  p_post_id uuid,
  p_payload jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_result jsonb;
begin
  v_result := public.news_source_enrich_save(
    p_post_id,
    p_payload || jsonb_build_object('body_source', 'editor'),
    v_admin
  );

  perform public.tz_admin_audit(
    'news.source.save', 'Kaynak haber metni düzenlendi', 'post', p_post_id::text,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''), 'result', v_result)
  );

  return v_result;
end;
$$;

revoke all on function public.admin_news_source_save(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_news_source_save(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 16. Editoryal iyileştirme kuyruğu (kısa haberler)
-- ---------------------------------------------------------------------------
create or replace function public.admin_news_editorial_queue(p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(row_json order by needs_review desc, published_at asc)
      from (
        select jsonb_build_object(
          'post_id', x.post_id,
          'kind', x.kind,
          'title', x.title,
          'word_count', x.word_count,
          'body_format', x.body_format,
          'source_url', x.source_url,
          'source_name', x.source_name,
          'published_at', x.published_at,
          'needs_review', x.needs_review,
          'risk_level', x.risk_level
        ) as row_json,
        x.needs_review,
        x.published_at
        from (
          select
            p.id as post_id,
            'source'::text as kind,
            i.title,
            public.news_word_count(i.body) as word_count,
            coalesce(i.body_format, 'short') as body_format,
            i.canonical_url as source_url,
            coalesce(i.source_name, c.name) as source_name,
            coalesce(i.published_at, p.created_at) as published_at,
            (
              coalesce(i.body_source, 'source') = 'source'
              or public.news_word_count(i.body) < s.standard_min_words
              or coalesce(i.body_format, 'short') = 'short'
            ) as needs_review,
            'B'::text as risk_level
          from public.posts p
            join public.news_publication_links l
              on l.post_id = p.id and l.status = 'published'
            join public.news_source_items i on i.id = l.item_id
            left join public.news_api_connections c on c.id = i.connection_id
            cross join public.ai_news_settings s
          where p.moderation_status = 'visible'
            and s.id

          union all

          select
            p.id,
            'ai'::text,
            d.title,
            coalesce(d.word_count, 0),
            coalesce(d.body_format, 'standard'),
            (select ev.url from public.ai_news_evidence ev
              where ev.event_id = e.id order by ev.is_primary desc limit 1),
            'Trabzone Haber',
            pu.published_at,
            (
              coalesce(d.word_count, 0) < s.standard_min_words
              or coalesce(d.body_format, 'standard') = 'short'
            ),
            e.risk_level::text
          from public.posts p
            join public.ai_news_publications pu
              on pu.post_id = p.id and pu.status = 'published'
            join public.ai_news_drafts d on d.id = pu.draft_id
            join public.ai_news_events e on e.id = pu.event_id
            cross join public.ai_news_settings s
          where p.moderation_status = 'visible'
            and s.id
        ) x
        order by x.needs_review desc, x.published_at asc
        limit v_limit
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_news_editorial_queue(integer) from public, anon;
grant execute on function public.admin_news_editorial_queue(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 17. Profil: haber sayısı, kurumsal haber hesabı, bildirim durumu
-- ---------------------------------------------------------------------------
drop function if exists public.get_profile_view(text);

create or replace function public.get_profile_view(p_username text)
returns table(
  id uuid, username citext, first_name text, last_name text, bio text, city text,
  district text, website text, avatar_path text, cover_path text, is_verified boolean,
  followers_count integer, following_count integer, posts_count integer,
  created_at timestamp with time zone, visibility text, restricted boolean, is_me boolean,
  i_follow boolean, follows_me boolean, is_friend boolean, friend_request_out uuid,
  friend_request_in uuid, blocked boolean, blocked_by_me boolean,
  accepts_friend_requests boolean, news_count integer, is_news_publisher boolean,
  news_notifications boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_me        uuid := auth.uid();
  v_target    public.profiles%rowtype;
  v_settings  public.profile_settings%rowtype;
  v_restricted boolean := false;
  v_blocked   boolean := false;
  v_by_me     boolean := false;
  v_i_follow  boolean := false;
  v_follows_me boolean := false;
  v_friends   boolean := false;
  v_news_count integer := 0;
  v_publisher boolean := false;
  v_notify    boolean := true;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select p.* into v_target
  from public.profiles p
  where p.username = lower(trim(p_username))
  limit 1;

  if not found then
    return;
  end if;

  v_blocked := public.is_blocked(v_me, v_target.id);
  v_by_me := exists (
    select 1 from public.user_blocks b
    where b.blocker_id = v_me and b.blocked_id = v_target.id
  );

  if v_blocked and not v_by_me then
    return;
  end if;

  select s.* into v_settings
  from public.profile_settings s
  where s.user_id = v_target.id;

  if not found then
    v_settings.profile_visibility := 'public';
    v_settings.show_city := true;
    v_settings.show_district := true;
    v_settings.allow_friend_requests := true;
  end if;

  if v_blocked then
    return query
    select
      v_target.id, v_target.username, null::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::text, false,
      0, 0, 0, v_target.created_at,
      v_settings.profile_visibility, true, v_target.id = v_me,
      false, false, false, null::uuid, null::uuid, true,
      true, false, 0, false, true;
    return;
  end if;

  v_i_follow := exists (
    select 1 from public.user_follows f
    where f.follower_id = v_me and f.following_id = v_target.id
  );

  v_follows_me := exists (
    select 1 from public.user_follows f
    where f.follower_id = v_target.id and f.following_id = v_me
  );

  v_friends := public.are_friends(v_me, v_target.id);

  v_restricted :=
    v_target.id <> v_me
    and (
      (v_settings.profile_visibility = 'private' and not v_friends)
      or (v_settings.profile_visibility = 'followers' and not v_i_follow and not v_friends)
    );

  v_publisher := lower(v_target.username::text) = 'trabzonehaber'
    or exists (
      select 1 from public.ai_news_settings s
      where s.id
        and coalesce(s.publisher_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_target.id
    );

  v_notify := coalesce((
    select np.news from public.notification_preferences np where np.user_id = v_me
  ), true);

  if not v_restricted then
    select count(*)::integer into v_news_count
    from public.posts p
    where p.author_id = v_target.id
      and p.moderation_status = 'visible'
      and (
        exists (
          select 1 from public.ai_news_publications pu
          where pu.post_id = p.id and pu.status = 'published'
        )
        or exists (
          select 1 from public.news_publication_links l
          where l.post_id = p.id and l.status = 'published'
        )
      );
  end if;

  return query
  select
    v_target.id,
    v_target.username,
    v_target.first_name,
    v_target.last_name,
    case when v_restricted then null else v_target.bio end,
    case when v_restricted or not v_settings.show_city then null else v_target.city end,
    case when v_restricted or not v_settings.show_district then null else v_target.district end,
    case when v_restricted then null else v_target.website end,
    v_target.avatar_path,
    case when v_restricted then null else v_target.cover_path end,
    v_target.is_verified,
    v_target.followers_count,
    v_target.following_count,
    v_target.posts_count,
    v_target.created_at,
    v_settings.profile_visibility,
    v_restricted,
    v_target.id = v_me,
    v_i_follow,
    v_follows_me,
    v_friends,
    (
      select r.id from public.friend_requests r
      where r.sender_id = v_me and r.receiver_id = v_target.id and r.status = 'pending'
      limit 1
    ),
    (
      select r.id from public.friend_requests r
      where r.sender_id = v_target.id and r.receiver_id = v_me and r.status = 'pending'
      limit 1
    ),
    false,
    false,
    v_settings.allow_friend_requests,
    v_news_count,
    v_publisher,
    v_notify;
end;
$function$;

revoke all on function public.get_profile_view(text) from public, anon;
grant execute on function public.get_profile_view(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 18. Haber bildirim tercihi
-- ---------------------------------------------------------------------------
create or replace function public.news_notifications_set(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.tz_require_uid();
begin
  insert into public.notification_preferences (user_id, news)
  values (v_me, coalesce(p_enabled, true))
  on conflict (user_id) do update
    set news = coalesce(p_enabled, true), updated_at = now();

  return jsonb_build_object('news_notifications', coalesce(p_enabled, true));
end;
$$;

revoke all on function public.news_notifications_set(boolean) from public, anon;
grant execute on function public.news_notifications_set(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 19. Kaynak haber web sayfası: alt başlık, giriş ve editoryal gövde
-- ---------------------------------------------------------------------------
create or replace function public.news_source_public_post_by_slug(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_post_id uuid;
  v_post public.posts%rowtype;
  v_item public.news_source_items%rowtype;
  v_conn public.news_api_connections%rowtype;
  v_profile public.news_source_profiles%rowtype;
  v_category public.news_categories%rowtype;
  v_sources jsonb;
  v_count integer;
  v_can_body boolean := false;
  v_body text;
  v_publisher text;
  v_image text;
  v_fit text := 'cover';
begin
  if v_slug !~ '^kaynak-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  begin
    v_post_id := substring(v_slug from 8)::uuid;
  exception when others then
    return null;
  end;

  select * into v_post from public.posts where id = v_post_id;
  if not found or v_post.moderation_status <> 'visible' then
    return null;
  end if;

  select i.* into v_item
  from public.news_publication_links l
  join public.news_source_items i on i.id = l.item_id
  where l.post_id = v_post_id and l.status = 'published'
  order by l.published_at
  limit 1;

  if v_item.id is null then
    return null;
  end if;

  select * into v_conn from public.news_api_connections where id = v_item.connection_id;
  select * into v_profile from public.news_source_profiles where connection_id = v_item.connection_id;
  select * into v_category from public.news_categories
  where slug = coalesce(v_item.category_slug, 'trabzon-gundem');

  v_can_body := coalesce((v_item.license_snapshot->>'can_republish_text')::boolean, false)
    or v_item.body_source in ('ai', 'editor');

  v_body := case
    when v_can_body and nullif(btrim(coalesce(v_item.body, '')), '') is not null then v_item.body
    else concat_ws(
      E'\n\n',
      nullif(btrim(coalesce(v_item.lead, '')), ''),
      nullif(btrim(coalesce(v_item.summary, '')), '')
    )
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'domain', split_part(regexp_replace(i.canonical_url, '^https?://', ''), '/', 1),
    'kind', 'source',
    'url', i.canonical_url,
    'title', i.title,
    'retrieved_at', i.last_seen_at,
    'name', coalesce(v_profile.display_name, i.source_name, v_conn.name)
  ) order by l.published_at), '[]'::jsonb), count(*)::integer
  into v_sources, v_count
  from public.news_publication_links l
  join public.news_source_items i on i.id = l.item_id
  where l.post_id = v_post_id and l.status = 'published';

  v_publisher := coalesce(v_profile.display_name, v_item.source_name, v_conn.name, 'Trabzone Haber');
  v_image := v_item.image_storage_path;

  v_fit := case
    when v_item.image_width is not null and v_item.image_height is not null
      and v_item.image_width::numeric / greatest(v_item.image_height, 1) < 0.9 then 'contain'
    else 'cover'
  end;

  return jsonb_build_object(
    'post_id', v_post_id,
    'slug', v_slug,
    'kind', 'source',
    'title', coalesce(v_item.title, 'Trabzon haberi'),
    'subtitle', v_item.subtitle,
    'spot', coalesce(v_item.summary, ''),
    'lead', v_item.lead,
    'body', coalesce(v_body, ''),
    'body_format', coalesce(v_item.body_format, 'short'),
    'word_count', public.news_word_count(v_body),
    'body_source', v_item.body_source,
    'category_slug', coalesce(v_item.category_slug, 'trabzon-gundem'),
    'category_name', coalesce(v_category.name_tr, 'Trabzon Gündem'),
    'district', coalesce(v_item.district, 'Trabzon'),
    'event_date', null,
    'risk_level', 'source',
    'ai_generated', v_item.body_source in ('ai', 'editor'),
    'ai_model', null,
    'disclosure', case
      when v_item.body_source in ('ai', 'editor') then
        'Bu haber, kaynağın kamuya açıkladığı bilgilerden yararlanılarak Trabzone Haber editoryası tarafından özgün biçimde yazılmıştır. Orijinal kaynak bağlantısı sayfanın altındadır.'
      else
        'Bu haber, ' || coalesce(v_item.source_name, v_conn.name, 'haber kaynağı') ||
        ' tarafından yayımlanan içerikten, kaynağın izin verdiği kapsamda aktarılmıştır. ' ||
        'Orijinal habere ve kaynak bilgisine sayfanın altından ulaşabilirsiniz.'
    end,
    'sources', v_sources,
    'source_count', v_count,
    'independent_sources', v_count,
    'primary_source', v_item.canonical_url,
    'published_at', coalesce(v_item.published_at, v_post.created_at),
    'updated_at', greatest(
      v_post.updated_at,
      coalesce(v_item.body_updated_at, v_item.last_seen_at)
    ),
    'last_checked_at', v_item.last_seen_at,
    'correction_path', '/support',
    'published_by', v_publisher,
    'license_status', v_conn.license_status,
    'license_note', v_conn.license_note,
    'canonical_source_url', v_item.canonical_url,
    'media', case when nullif(btrim(coalesce(v_image, '')), '') is null then null else jsonb_build_object(
      'storage_path', v_image,
      'is_placeholder', false,
      'alt_text', v_item.title,
      'credit', v_publisher,
      'license_code', null,
      'attribution', 'Fotoğraf: ' || v_publisher,
      'display_fit', v_fit
    ) end
  );
end;
$$;

revoke all on function public.news_source_public_post_by_slug(text) from public;
grant execute on function public.news_source_public_post_by_slug(text) to anon, authenticated, service_role;

commit;
