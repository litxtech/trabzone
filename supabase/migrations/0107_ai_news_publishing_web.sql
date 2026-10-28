-- AI Haber Merkezi: yayın dağıtımı, web slug'ları, kaynak kütüphanesi ve aday seçimi.
-- Bu migration mevcut veriyi silmez; yalnızca yeni kolon/fonksiyon ve kaynak kayıtları ekler.

-- ---------------------------------------------------------------------------
-- 1. Gövde biçimi (emoji yerine sade etiketler)
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_compose_body(
  p_title text,
  p_spot text,
  p_body text,
  p_district text,
  p_category_name text,
  p_sources text,
  p_placeholder boolean
)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    p_title || E'\n\n' || p_spot || E'\n\n' || p_body
    || E'\n\nKonum: ' || coalesce(nullif(p_district, ''), 'Trabzon') || ', Trabzon'
    || E'\nKategori: ' || coalesce(nullif(p_category_name, ''), 'Trabzon Gündem')
    || E'\nAI destekli haber derlemesi (Trabzone AI Haber Merkezi)'
    || case when coalesce(p_placeholder, false)
         then E'\nGörsel: Trabzone kategori tasarımı — olay fotoğrafı değildir'
         else '' end
    || case when coalesce(p_sources, '') <> ''
         then E'\nKaynaklar: ' || p_sources else '' end,
    2000
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Yayın dağıtımı: yayın penceresi ve minimum aralık
-- ---------------------------------------------------------------------------
alter table public.ai_news_settings
  add column if not exists publish_window_start integer not null default 8
    check (publish_window_start between 0 and 23),
  add column if not exists publish_window_end integer not null default 22
    check (publish_window_end between 0 and 23),
  add column if not exists auto_min_gap_minutes integer not null default 55
    check (auto_min_gap_minutes between 0 and 720);

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
         updated_at = now()
   where id;

  select * into v_settings from public.ai_news_settings where id;

  perform public.tz_admin_audit(
    'news.settings.save', 'AI Haber Merkezi ayarları güncellendi', 'ai_news', 'settings',
    jsonb_build_object(
      'old', jsonb_build_object(
        'enabled', v_old -> 'enabled',
        'auto_publish_enabled', v_old -> 'auto_publish_enabled',
        'dry_run', v_old -> 'dry_run',
        'scan_interval_minutes', v_old -> 'scan_interval_minutes',
        'daily_auto_limit', v_old -> 'daily_auto_limit',
        'publish_window_start', v_old -> 'publish_window_start',
        'publish_window_end', v_old -> 'publish_window_end',
        'auto_min_gap_minutes', v_old -> 'auto_min_gap_minutes'
      ),
      'new', jsonb_build_object(
        'enabled', v_settings.enabled,
        'auto_publish_enabled', v_settings.auto_publish_enabled,
        'dry_run', v_settings.dry_run,
        'scan_interval_minutes', v_settings.scan_interval_minutes,
        'daily_auto_limit', v_settings.daily_auto_limit,
        'publish_window_start', v_settings.publish_window_start,
        'publish_window_end', v_settings.publish_window_end,
        'auto_min_gap_minutes', v_settings.auto_min_gap_minutes
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

-- ---------------------------------------------------------------------------
-- 3. Yayın slug'ı (web adresi) ve web okuma fonksiyonları
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_slugify(p_title text, p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(nullif(trim(both '-' from
    regexp_replace(
      lower(translate(
        coalesce(p_title, ''),
        'çğıöşüÇĞİÖŞÜâîûÂÎÛ',
        'cgiosuCGIOSUaiuAIU'
      )),
      '[^a-z0-9]+', '-', 'g'
    )
  ), ''), 'haber')
  || '-' || left(regexp_replace(coalesce(p_key, ''), '[^a-zA-Z0-9]', '', 'g'), 8);
$$;

alter table public.ai_news_publications
  add column if not exists slug text;

update public.ai_news_publications p
set slug = public.ai_news_slugify(d.title, replace(p.id::text, '-', ''))
from public.ai_news_drafts d
where d.id = p.draft_id
  and p.slug is null;

create unique index if not exists ai_news_publications_slug_key
  on public.ai_news_publications (slug)
  where slug is not null;

-- Yeni yayınlarda slug üretimi (tekrar çalıştırıldığında değişmez).
create or replace function public.ai_news_publication_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if new.slug is not null and new.slug <> '' then
    return new;
  end if;

  select d.title into v_title from public.ai_news_drafts d where d.id = new.draft_id;
  new.slug := public.ai_news_slugify(v_title, replace(new.id::text, '-', ''));
  return new;
end;
$$;

drop trigger if exists ai_news_publications_slug on public.ai_news_publications;
create trigger ai_news_publications_slug
  before insert on public.ai_news_publications
  for each row execute function public.ai_news_publication_slug();

-- Var olan yayın kayıtları için tekil adres üret.
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
    'slug', v_publication.slug,
    'title', v_draft.title,
    'spot', v_draft.spot,
    'body', v_draft.body,
    'category_slug', coalesce(v_draft.category_slug, v_event.category_slug),
    'category_name', coalesce(v_category.name_tr, 'Trabzon Gündem'),
    'district', coalesce(v_draft.district, v_event.district),
    'event_date', coalesce(v_draft.event_date, v_event.event_date),
    'risk_level', v_event.risk_level,
    'ai_generated', true,
    'ai_model', v_draft.ai_model,
    'disclosure', 'Bu haber, Trabzone AI Haber Merkezi tarafından kamuya açık kaynaklardan derlenmiştir. Metin yapay zekâ desteğiyle hazırlanır; yayın kararı kaynak doğrulaması ve risk kurallarıyla verilir.',
    'sources', v_sources,
    'source_count', jsonb_array_length(v_sources),
    'independent_sources', v_event.independent_sources,
    'primary_source', v_event.primary_source,
    'published_at', v_publication.published_at,
    'updated_at', v_draft.updated_at,
    'last_checked_at', v_publication.published_at,
    'correction_path', '/support',
    'published_by', 'Trabzone Haber',
    'media', case when v_media.id is null then null else jsonb_build_object(
      'storage_path', v_media.storage_path,
      'is_placeholder', v_media.is_placeholder,
      'alt_text', v_media.alt_text,
      'credit', v_media.credit,
      'license_code', v_media.license_code,
      'attribution', v_media.attribution
    ) end
  );
end;
$$;

create or replace function public.ai_news_public_post_by_slug(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post_id uuid;
begin
  select p.post_id into v_post_id
  from public.ai_news_publications p
  where p.slug = lower(btrim(coalesce(p_slug, '')))
    and p.status = 'published'
  limit 1;

  if v_post_id is null then
    return null;
  end if;

  return public.ai_news_public_post(v_post_id);
end;
$$;

create or replace function public.ai_news_public_list(
  p_limit integer default 12,
  p_offset integer default 0,
  p_category text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total integer;
begin
  select count(*) into v_total
  from public.ai_news_publications pub
    join public.posts p on p.id = pub.post_id
    join public.ai_news_drafts d on d.id = pub.draft_id
    join public.ai_news_events e on e.id = pub.event_id
  where pub.status = 'published'
    and p.moderation_status = 'visible'
    and (p_category is null or p_category = '' or coalesce(d.category_slug, e.category_slug) = p_category);

  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', x.slug,
    'post_id', x.post_id,
    'title', x.title,
    'spot', x.spot,
    'category_slug', x.category_slug,
    'category_name', x.category_name,
    'district', x.district,
    'published_at', x.published_at,
    'media_path', x.media_path,
    'media_placeholder', x.media_placeholder
  ) order by x.published_at desc), '[]'::jsonb)
  into v_items
  from (
    select pub.slug, pub.post_id, d.title, d.spot,
           coalesce(d.category_slug, e.category_slug) as category_slug,
           coalesce(c.name_tr, 'Trabzon Gündem') as category_name,
           coalesce(d.district, e.district) as district,
           pub.published_at,
           (select m.storage_path from public.ai_news_media_assets m
             where m.event_id = e.id and m.status = 'published'
             order by m.created_at desc limit 1) as media_path,
           coalesce((select m.is_placeholder from public.ai_news_media_assets m
             where m.event_id = e.id and m.status = 'published'
             order by m.created_at desc limit 1), true) as media_placeholder
    from public.ai_news_publications pub
      join public.posts p on p.id = pub.post_id
      join public.ai_news_drafts d on d.id = pub.draft_id
      join public.ai_news_events e on e.id = pub.event_id
      left join public.ai_news_categories c on c.slug = coalesce(d.category_slug, e.category_slug)
    where pub.status = 'published'
      and p.moderation_status = 'visible'
      and (p_category is null or p_category = '' or coalesce(d.category_slug, e.category_slug) = p_category)
    order by pub.published_at desc
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

drop function if exists public.ai_news_sitemap_urls(integer, integer);

create or replace function public.ai_news_sitemap_urls(
  p_limit integer default 1000,
  p_offset integer default 0
)
returns table (
  post_id uuid,
  slug text,
  title text,
  category_name text,
  published_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, pub.slug, d.title, c.name_tr, pub.published_at, d.updated_at
  from public.ai_news_publications pub
    join public.posts p on p.id = pub.post_id
    join public.ai_news_drafts d on d.id = pub.draft_id
    join public.ai_news_events e on e.id = pub.event_id
    left join public.ai_news_categories c
      on c.slug = coalesce(d.category_slug, e.category_slug)
  where pub.status = 'published'
    and p.moderation_status = 'visible'
    and pub.slug is not null
  order by pub.published_at desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 20000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------------------
-- 4. Otomatik yayın zamanlaması
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_publish_event(
  p_event_id uuid,
  p_mode text default 'auto',
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_media public.ai_news_media_assets%rowtype;
  v_license public.ai_news_media_licenses%rowtype;
  v_category public.ai_news_categories%rowtype;
  v_publisher uuid;
  v_existing public.ai_news_publications%rowtype;
  v_post_id uuid;
  v_publication_id uuid;
  v_body text;
  v_sources text;
  v_slot integer;
  v_hour integer;
  v_last timestamptz;
  v_day date := public.ai_news_istanbul_day(now());
  v_mode text := case when p_mode = 'manual' then 'manual' else 'auto' end;
  v_placeholder boolean := false;
  v_notified integer := 0;
begin
  select * into v_settings from public.ai_news_settings where id;

  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.ai_news_publications where event_id = p_event_id;
  if found then
    return jsonb_build_object(
      'published', true,
      'already_published', true,
      'post_id', v_existing.post_id,
      'publication_id', v_existing.id,
      'status', v_existing.status
    );
  end if;

  if v_event.status not in ('ready', 'awaiting_review', 'verified') then
    raise exception 'event_not_publishable' using errcode = '22023';
  end if;

  select * into v_draft from public.ai_news_drafts
  where event_id = p_event_id and is_current
  order by version desc limit 1;

  if v_draft.id is null then
    raise exception 'draft_missing' using errcode = '22023';
  end if;

  select * into v_publisher from public.profiles
  where id = coalesce(
    v_settings.publisher_user_id,
    (select p.id from public.profiles p where p.username = v_settings.publisher_username)
  );

  if v_publisher.id is null then
    raise exception 'publisher_missing' using errcode = '22023';
  end if;
  if v_publisher.account_status <> 'active' then
    raise exception 'publisher_inactive' using errcode = '22023';
  end if;

  if v_mode = 'auto' then
    if v_settings.auto_publish_enabled is not true then
      raise exception 'auto_publish_disabled' using errcode = '22023';
    end if;
    if v_settings.dry_run then
      raise exception 'dry_run_active' using errcode = '22023';
    end if;
    if v_event.risk_level <> 'A' then
      raise exception 'risk_blocked' using errcode = '22023';
    end if;
    if coalesce(v_event.conflict, false) then
      raise exception 'source_conflict' using errcode = '22023';
    end if;
    if cardinality(v_event.auto_block_reasons) > 0 then
      raise exception 'auto_block_reasons' using errcode = '22023';
    end if;
    if not coalesce(v_event.primary_source, false)
       and coalesce(v_event.independent_sources, 0) < 2 then
      raise exception 'insufficient_independent_sources' using errcode = '22023';
    end if;
    if v_draft.quality_score < v_settings.min_quality_score then
      raise exception 'quality_too_low' using errcode = '22023';
    end if;

    -- Yayınları gün içine yay: pencere dışında ve çok sık yayımlama.
    v_hour := extract(hour from (now() at time zone 'Europe/Istanbul'))::integer;
    if v_settings.publish_window_start < v_settings.publish_window_end then
      if v_hour < v_settings.publish_window_start or v_hour >= v_settings.publish_window_end then
        raise exception 'publish_deferred' using errcode = '22023';
      end if;
    elsif v_settings.publish_window_start > v_settings.publish_window_end then
      if v_hour < v_settings.publish_window_start and v_hour >= v_settings.publish_window_end then
        raise exception 'publish_deferred' using errcode = '22023';
      end if;
    end if;

    select max(p.published_at) into v_last
    from public.ai_news_publications p
    where p.mode = 'auto' and p.status = 'published';

    if v_last is not null
       and v_last > now() - make_interval(mins => v_settings.auto_min_gap_minutes) then
      raise exception 'publish_deferred' using errcode = '22023';
    end if;
  end if;

  select * into v_media
  from public.ai_news_media_assets m
  where m.event_id = p_event_id and m.status = 'approved'
  order by m.is_placeholder asc, m.event_match_score desc, m.created_at asc
  limit 1;

  if v_media.id is not null then
    select * into v_license from public.ai_news_media_licenses where code = v_media.license_code;

    if not v_media.is_placeholder then
      if v_license.id is null or not v_license.is_usable or not v_license.commercial_use then
        raise exception 'media_license_invalid' using errcode = '22023';
      end if;
      if v_license.requires_documentation and v_media.license_reference is null then
        raise exception 'media_license_documentation_missing' using errcode = '22023';
      end if;
      if v_license.attribution_required and v_media.attribution is null then
        raise exception 'media_attribution_missing' using errcode = '22023';
      end if;
      if v_media.event_match_score < v_settings.min_media_match then
        raise exception 'media_event_mismatch' using errcode = '22023';
      end if;
    end if;

    v_placeholder := v_media.is_placeholder;
  end if;

  select * into v_category from public.ai_news_categories
  where slug = coalesce(v_draft.category_slug, v_event.category_slug);

  select coalesce(string_agg(distinct v.source_domain::text, ', '), '')
  into v_sources
  from public.ai_news_evidence v
  where v.event_id = p_event_id;

  v_body := public.ai_news_compose_body(
    v_draft.title, v_draft.spot, v_draft.body,
    coalesce(v_draft.district, v_event.district),
    v_category.name_tr, v_sources, v_placeholder
  );

  -- Kota, tüm doğrulamalar geçtikten hemen sonra atomik olarak tüketilir.
  if v_mode = 'auto' then
    v_slot := public.ai_news_quota_reserve(v_day, v_settings.daily_auto_limit);
    if v_slot is null then
      raise exception 'quota_exhausted' using errcode = '22023';
    end if;
  else
    insert into public.ai_news_quota_days (day, manual_published)
    values (v_day, 1)
    on conflict (day) do update
      set manual_published = public.ai_news_quota_days.manual_published + 1,
          updated_at = now();
  end if;

  insert into public.posts (author_id, body, visibility, city)
  values (v_publisher.id, v_body, 'public', 'Trabzon')
  returning id into v_post_id;

  if v_media.id is not null then
    insert into public.post_media (
      post_id, storage_path, thumbnail_path, media_type, width, height, sort_order
    ) values (
      v_post_id, v_media.storage_path, v_media.thumbnail_path, 'image',
      v_media.width, v_media.height, 0
    );

    update public.ai_news_media_assets
       set status = 'published'
     where id = v_media.id
       and status = 'approved';
  end if;

  insert into public.ai_news_publications (
    event_id, draft_id, post_id, mode, status, published_at
  ) values (
    p_event_id, v_draft.id, v_post_id, v_mode, 'published', now()
  )
  returning id into v_publication_id;

  update public.ai_news_events
     set published_post_id = v_post_id,
         last_seen_at = now()
   where id = p_event_id;

  perform public.ai_news_event_set_status(p_event_id, 'published');

  update public.ai_news_drafts
     set status = 'published'
   where id = v_draft.id;

  update public.ai_news_review_queue
     set state = 'approved',
         resolved_at = now(),
         resolved_by = coalesce(p_actor, v_publisher.id)
   where event_id = p_event_id and state = 'pending';

  insert into public.ai_news_publication_history (publication_id, action, actor_id, details)
  values (
    v_publication_id,
    case when v_mode = 'auto' then 'auto_published' else 'manual_published' end,
    p_actor,
    jsonb_build_object(
      'post_id', v_post_id,
      'risk_level', v_event.risk_level,
      'quality_score', v_draft.quality_score,
      'quota_slot', v_slot,
      'media_placeholder', v_placeholder,
      'media_license', v_media.license_code
    )
  );

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor,
    case when v_mode = 'auto' then 'news.auto_publish' else 'news.manual_publish' end,
    'ai_news_event',
    p_event_id::text,
    jsonb_build_object(
      'post_id', v_post_id,
      'publisher', v_publisher.username,
      'risk_level', v_event.risk_level,
      'sources', v_event.independent_sources,
      'primary_source', v_event.primary_source
    )
  );

  v_notified := public.ai_news_notify_followers(v_post_id, p_event_id, v_mode);

  return jsonb_build_object(
    'published', true,
    'already_published', false,
    'post_id', v_post_id,
    'publication_id', v_publication_id,
    'publisher', v_publisher.username,
    'quota_slot', v_slot,
    'notified', v_notified,
    'media_placeholder', v_placeholder
  );
end;
$$;

/**
 * Yayına hazır (A riskli, doğrulanmış) olayları yayın penceresi ve aralık
 * kurallarına uyarak yayımlar. Zamanlama nedeniyle ertelenenler bir sonraki
 * döngüde yeniden denenir; olay kaydı kaybolmaz.
 */
create or replace function public.ai_news_publish_ready(p_limit integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 2), 1), 5);
  v_event record;
  v_published integer := 0;
  v_deferred integer := 0;
  v_failed integer := 0;
  v_result jsonb;
begin
  for v_event in
    select e.id
    from public.ai_news_events e
    where e.status = 'ready'
      and e.risk_level = 'A'
      and e.published_post_id is null
    order by coalesce(e.event_date, e.first_seen_at) asc, e.created_at asc
    limit v_limit
  loop
    begin
      v_result := public.ai_news_publish_event(v_event.id, 'auto', null);
      if coalesce((v_result ->> 'published')::boolean, false) then
        v_published := v_published + 1;
      end if;
    exception
      when others then
        if sqlerrm like '%publish_deferred%' then
          v_deferred := v_deferred + 1;
        else
          v_failed := v_failed + 1;
        end if;
    end;
  end loop;

  return jsonb_build_object(
    'published', v_published,
    'deferred', v_deferred,
    'failed', v_failed
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Aday seçimi: gezinme sayfalarını ele, güvenilir ve taze içeriği öne al
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_candidates(
  p_run_id uuid,
  p_limit integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 3), 1), 5);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'title', x.title,
        'url', x.url,
        'source_domain', x.source_domain,
        'source_kind', x.source_kind,
        'snippet', x.snippet,
        'summary', x.summary,
        'content', left(coalesce(x.content, ''), 20000),
        'published_at', x.published_at,
        'query', x.query
      ) order by x.priority asc, x.id)
      from (
        select r.*,
          case r.source_kind
            when 'official' then 0
            when 'trusted_media' then 1
            else 2
          end as priority
        from public.ai_news_search_results r
        where r.status = 'new'
          and r.run_id = p_run_id
          and coalesce(r.content, '') <> ''
          and char_length(coalesce(r.title, '')) >= 25
          and r.url !~* '^https?://[^/]+/?$'
          and r.url !~* '/(kategori|category|etiket|tag|arama|search|yazar|author|galeri|foto-galeri)(/|$)'
        order by
          case r.source_kind when 'official' then 0 when 'trusted_media' then 1 else 2 end,
          r.published_at desc nulls last,
          r.rerank_score desc nulls last,
          r.id
        limit v_limit
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Kaynak kütüphanesi (yalnızca erişimi doğrulanmış alan adları)
-- ---------------------------------------------------------------------------
insert into public.ai_news_sources (name, domain, kind, notes_tr)
values
  ('Taka Gazete', 'takagazete.com.tr', 'trusted_media', 'Trabzon yerel gazetesi; ikincil kaynak.'),
  ('61 Saat', '61saat.com', 'trusted_media', 'Trabzon yerel haber sitesi; ikincil kaynak.'),
  ('Haber61', 'haber61.net', 'trusted_media', 'Trabzon yerel haber sitesi; ikincil kaynak.'),
  ('Anadolu Ajansı', 'aa.com.tr', 'trusted_media', 'Ulusal haber ajansı; ikincil kaynak.'),
  ('Demirören Haber Ajansı', 'dha.com.tr', 'trusted_media', 'Ulusal haber ajansı; ikincil kaynak.'),
  ('İhlas Haber Ajansı', 'iha.com.tr', 'trusted_media', 'Ulusal haber ajansı; ikincil kaynak.'),
  ('TRT Haber', 'trthaber.com', 'trusted_media', 'Kamu yayıncısı; ikincil kaynak.'),
  ('NTV', 'ntv.com.tr', 'trusted_media', 'Ulusal haber kuruluşu; ikincil kaynak.'),
  ('Hürriyet', 'hurriyet.com.tr', 'trusted_media', 'Ulusal gazete; ikincil kaynak.'),
  ('Milliyet', 'milliyet.com.tr', 'trusted_media', 'Ulusal gazete; ikincil kaynak.'),
  ('TFF', 'tff.org', 'official', 'Türkiye Futbol Federasyonu resmî sitesi.'),
  ('Karayolları Genel Müdürlüğü', 'kgm.gov.tr', 'official', 'Yol ve ulaşım duyuruları.'),
  ('Tarım ve Orman Bakanlığı', 'tarimorman.gov.tr', 'official', 'Tarım destekleri ve resmî duyurular.'),
  ('Akçaabat Belediyesi', 'akcaabat.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Yomra Belediyesi', 'yomra.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Arsin Belediyesi', 'arsin.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Araklı Belediyesi', 'arakli.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Sürmene Belediyesi', 'surmene.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Of Belediyesi', 'of.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Çaykara Belediyesi', 'caykara.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Dernekpazarı Belediyesi', 'dernekpazari.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Hayrat Belediyesi', 'hayrat.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Maçka Belediyesi', 'macka.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Düzköy Belediyesi', 'duzkoy.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Vakfıkebir Belediyesi', 'vakfikebir.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Beşikdüzü Belediyesi', 'besikduzu.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Çarşıbaşı Belediyesi', 'carsibasi.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Şalpazarı Belediyesi', 'salpazari.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Tonya Belediyesi', 'tonya.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.'),
  ('Köprübaşı Belediyesi', 'koprubasi.bel.tr', 'official', 'İlçe belediyesi resmî sitesi.')
on conflict (domain) do update
  set name = excluded.name,
      kind = excluded.kind,
      notes_tr = coalesce(public.ai_news_sources.notes_tr, excluded.notes_tr),
      active = true;

-- ---------------------------------------------------------------------------
-- 7. Yetkiler
-- ---------------------------------------------------------------------------
revoke all on function public.ai_news_public_post_by_slug(text) from public;
revoke all on function public.ai_news_public_list(integer, integer, text) from public;
revoke all on function public.ai_news_publish_ready(integer) from public, anon, authenticated;
revoke all on function public.ai_news_publication_slug() from public;
revoke all on function public.ai_news_slugify(text, text) from public;

grant execute on function public.ai_news_public_post_by_slug(text) to anon, authenticated;
grant execute on function public.ai_news_public_list(integer, integer, text) to anon, authenticated;
grant execute on function public.ai_news_sitemap_urls(integer, integer) to anon, authenticated;
grant execute on function public.ai_news_publish_ready(integer) to service_role;
