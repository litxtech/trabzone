-- 0086: Blog / SEO içerik sistemi
--
-- Amaç: Trabzone web sitesinde yayınlanan uzun biçimli, SEO odaklı blog
-- yazılarını yönetmek. Yazılar yalnızca yönetici RPC'leriyle yazılır; herkese
-- açık okuma `blog_public_*` fonksiyonlarından yapılır. Tablolar RLS açık ve
-- politika tanımsız olduğu için doğrudan erişime kapalıdır.
--
-- DeepSeek anahtarı istemciye inmez: AI çağrıları `deepseek-blog` edge
-- function'ında yapılır, bu function da yönetici yetkisini buradaki
-- `admin_blog_ai_check` RPC'siyle doğrular.

begin;

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

create table if not exists public.blog_posts (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  title            text not null,
  excerpt          text not null default '',
  body_markdown    text not null default '',
  cover_image_url  text,
  cover_image_alt  text,
  category         text not null default 'Genel',
  tags             text[] not null default '{}'::text[],
  seo_title        text,
  seo_description  text,
  keywords         text[] not null default '{}'::text[],
  faq              jsonb not null default '[]'::jsonb,
  author_name      text not null default 'Trabzone Editör',
  status           text not null default 'draft'
                     check (status in ('draft', 'published', 'archived')),
  is_featured      boolean not null default false,
  reading_minutes  integer not null default 1,
  word_count       integer not null default 0,
  view_count       bigint not null default 0,
  ai_generated     boolean not null default false,
  ai_model         text,
  version          integer not null default 1,
  published_at     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists blog_posts_status_published_idx
  on public.blog_posts (status, published_at desc);
create index if not exists blog_posts_category_idx
  on public.blog_posts (category);
create index if not exists blog_posts_featured_idx
  on public.blog_posts (is_featured) where is_featured;
create index if not exists blog_posts_tags_idx
  on public.blog_posts using gin (tags);

create table if not exists public.blog_post_versions (
  id              bigserial primary key,
  post_id         uuid not null references public.blog_posts (id) on delete cascade,
  version         integer not null,
  title           text not null,
  body_markdown   text not null,
  seo_title       text,
  seo_description text,
  status          text not null,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (post_id, version)
);

create index if not exists blog_post_versions_post_idx
  on public.blog_post_versions (post_id, version desc);

-- AI üretim günlüğü: kim, hangi model, kaç token, ne kadar sürdü.
create table if not exists public.blog_ai_runs (
  id           bigserial primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  model        text,
  prompt       text,
  tokens_in    integer,
  tokens_out   integer,
  duration_ms  integer,
  ok           boolean not null default true,
  error        text,
  created_at   timestamptz not null default now()
);

create index if not exists blog_ai_runs_created_idx
  on public.blog_ai_runs (created_at desc);

alter table public.blog_posts enable row level security;
alter table public.blog_post_versions enable row level security;
alter table public.blog_ai_runs enable row level security;

grant all on public.blog_posts to service_role;
grant all on public.blog_post_versions to service_role;
grant all on public.blog_ai_runs to service_role;
grant usage, select on sequence public.blog_post_versions_id_seq to service_role;
grant usage, select on sequence public.blog_ai_runs_id_seq to service_role;

drop trigger if exists blog_posts_set_updated_at on public.blog_posts;
create trigger blog_posts_set_updated_at
  before update on public.blog_posts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------------

-- Türkçe karakterleri ASCII'ye indirip URL güvenli slug üretir.
create or replace function public.blog_slugify(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select trim(both '-' from lower(regexp_replace(
    translate(
      coalesce(p_text, ''),
      'çğıöşüÇĞİÖŞÜâîûÂÎÛ',
      'cgiosuCGIOSUaiuAIU'
    ),
    '[^a-zA-Z0-9]+', '-', 'g'
  )));
$$;

-- ---------------------------------------------------------------------------
-- AI ayarları (app_settings üzerinde, yalnızca yönetici okur/yazar)
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value, description_tr, is_public) values
  ('blog.ai_enabled', 'true'::jsonb, 'Blog AI yazma özelliği açık mı?', false),
  ('blog.ai_model', '"deepseek-chat"'::jsonb, 'DeepSeek modeli', false),
  ('blog.ai_temperature', '0.7'::jsonb, 'AI yaratıcılık sıcaklığı (0-1.5)', false),
  ('blog.ai_system_prompt', '"Sen Trabzone için çalışan, Trabzon hakkında derin yerel bilgiye sahip bir SEO içerik editörüsün. Yazıların Türkçe, özgün, somut ve kullanıcıya gerçek fayda sağlayan metinler olmalı. Uydurma istatistik, uydurma mekân veya doğrulanamaz iddia kullanma. Başlıkları abartısız, net ve arama niyetine uygun yaz."'::jsonb, 'Blog AI sistem talimatı', false)
on conflict (key) do nothing;

create or replace function public.admin_blog_ai_check()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.tz_admin_require('cms.manage', false);
  return true;
end;
$$;

create or replace function public.admin_blog_ai_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.view', false);
  v_settings jsonb;
begin
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
  into v_settings
  from public.app_settings s
  where s.key like 'blog.ai.%';

  return jsonb_build_object(
    'enabled', coalesce((v_settings ->> 'blog.ai_enabled')::boolean, true),
    'model', coalesce(v_settings ->> 'blog.ai_model', 'deepseek-chat'),
    'temperature', coalesce((v_settings ->> 'blog.ai_temperature')::numeric, 0.7),
    'system_prompt', coalesce(v_settings ->> 'blog.ai_system_prompt', ''),
    'api_configured', true
  );
end;
$$;

create or replace function public.admin_blog_ai_settings_save(
  p_enabled boolean,
  p_model text,
  p_temperature numeric,
  p_system_prompt text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.manage', false);
  v_model text := btrim(coalesce(nullif(p_model, ''), 'deepseek-chat'));
  v_temperature numeric := least(greatest(coalesce(p_temperature, 0.7), 0), 1.5);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_model !~ '^[a-zA-Z0-9._-]{2,64}$' then
    raise exception 'model_invalid' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) < 3 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;

  insert into public.app_settings (key, value, description_tr, is_public, updated_by, updated_at)
  values
    ('blog.ai_enabled', to_jsonb(coalesce(p_enabled, true)), 'Blog AI yazma özelliği açık mı?', false, v_admin, now()),
    ('blog.ai_model', to_jsonb(v_model), 'DeepSeek modeli', false, v_admin, now()),
    ('blog.ai_temperature', to_jsonb(v_temperature), 'AI yaratıcılık sıcaklığı', false, v_admin, now()),
    ('blog.ai_system_prompt', to_jsonb(coalesce(p_system_prompt, '')), 'Blog AI sistem talimatı', false, v_admin, now())
  on conflict (key) do update
  set value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = now();

  perform public.tz_admin_audit(
    'blog.ai.settings', 'Blog AI ayarları güncellendi', 'blog_ai', 'settings',
    jsonb_build_object(
      'enabled', coalesce(p_enabled, true),
      'model', v_model,
      'temperature', v_temperature
    ) || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end,
    'success'
  );

  return public.admin_blog_ai_settings_get();
end;
$$;

create or replace function public.admin_blog_ai_log(
  p_action text,
  p_model text,
  p_prompt text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_duration_ms integer,
  p_ok boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.manage', false);
begin
  insert into public.blog_ai_runs (
    actor_id, action, model, prompt, tokens_in, tokens_out, duration_ms, ok, error
  ) values (
    v_admin,
    left(coalesce(p_action, 'generate'), 40),
    left(coalesce(p_model, ''), 80),
    left(coalesce(p_prompt, ''), 4000),
    p_tokens_in,
    p_tokens_out,
    p_duration_ms,
    coalesce(p_ok, true),
    left(coalesce(p_error, ''), 500)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Yönetici: liste, detay, kaydet, durum, kopyala, sil
-- ---------------------------------------------------------------------------

create or replace function public.admin_blog_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.view', false);
begin
  return (
    select jsonb_build_object(
      'total', count(*),
      'published', count(*) filter (where status = 'published' and published_at is not null and published_at <= now()),
      'scheduled', count(*) filter (where status = 'published' and published_at > now()),
      'draft', count(*) filter (where status = 'draft'),
      'archived', count(*) filter (where status = 'archived'),
      'featured', count(*) filter (where is_featured and status = 'published'),
      'views', coalesce(sum(view_count), 0),
      'words', coalesce(sum(word_count), 0),
      'ai_generated', count(*) filter (where ai_generated)
    )
    from public.blog_posts
  );
end;
$$;

create or replace function public.admin_blog_posts_list(
  p_search text default null,
  p_status text default null,
  p_category text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.view', false);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.blog_posts p
  where (p_status is null or p.status = p_status)
    and (p_category is null or p.category = p_category)
    and (
      p_search is null
      or p.title ilike '%' || p_search || '%'
      or p.slug ilike '%' || p_search || '%'
      or p.excerpt ilike '%' || p_search || '%'
      or p.category ilike '%' || p_search || '%'
      or exists (select 1 from unnest(p.tags) t where t ilike '%' || p_search || '%')
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'slug', x.slug,
    'title', x.title,
    'excerpt', x.excerpt,
    'category', x.category,
    'tags', to_jsonb(x.tags),
    'status', x.status,
    'is_featured', x.is_featured,
    'reading_minutes', x.reading_minutes,
    'word_count', x.word_count,
    'view_count', x.view_count,
    'version', x.version,
    'ai_generated', x.ai_generated,
    'ai_model', x.ai_model,
    'published_at', x.published_at,
    'updated_at', x.updated_at,
    'updated_by_name', x.updated_by_name,
    'scheduled', (x.status = 'published' and x.published_at > now())
  ) order by x.is_featured desc, x.updated_at desc), '[]'::jsonb)
  into v_items
  from (
    select p.*, pr.display_name as updated_by_name
    from public.blog_posts p
    left join public.profiles pr on pr.id = p.updated_by
    where (p_status is null or p.status = p_status)
      and (p_category is null or p.category = p_category)
      and (
        p_search is null
        or p.title ilike '%' || p_search || '%'
        or p.slug ilike '%' || p_search || '%'
        or p.excerpt ilike '%' || p_search || '%'
        or p.category ilike '%' || p_search || '%'
        or exists (select 1 from unnest(p.tags) t where t ilike '%' || p_search || '%')
      )
    order by p.is_featured desc, p.updated_at desc
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

create or replace function public.admin_blog_post_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.view', false);
  v_post public.blog_posts%rowtype;
  v_versions jsonb;
begin
  select * into v_post from public.blog_posts where id = p_id;
  if not found then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'version', v.version,
    'title', v.title,
    'status', v.status,
    'created_at', v.created_at,
    'created_by_name', pr.display_name
  ) order by v.version desc), '[]'::jsonb)
  into v_versions
  from public.blog_post_versions v
  left join public.profiles pr on pr.id = v.created_by
  where v.post_id = p_id;

  return jsonb_build_object(
    'id', v_post.id,
    'slug', v_post.slug,
    'title', v_post.title,
    'excerpt', v_post.excerpt,
    'body_markdown', v_post.body_markdown,
    'cover_image_url', v_post.cover_image_url,
    'cover_image_alt', v_post.cover_image_alt,
    'category', v_post.category,
    'tags', to_jsonb(v_post.tags),
    'seo_title', v_post.seo_title,
    'seo_description', v_post.seo_description,
    'keywords', to_jsonb(v_post.keywords),
    'faq', v_post.faq,
    'author_name', v_post.author_name,
    'status', v_post.status,
    'is_featured', v_post.is_featured,
    'reading_minutes', v_post.reading_minutes,
    'word_count', v_post.word_count,
    'view_count', v_post.view_count,
    'ai_generated', v_post.ai_generated,
    'ai_model', v_post.ai_model,
    'version', v_post.version,
    'published_at', v_post.published_at,
    'created_at', v_post.created_at,
    'updated_at', v_post.updated_at,
    'versions', v_versions
  );
end;
$$;

create or replace function public.admin_blog_post_save(
  p_id uuid,
  p_slug text,
  p_title text,
  p_excerpt text,
  p_body_markdown text,
  p_cover_image_url text,
  p_cover_image_alt text,
  p_category text,
  p_tags jsonb,
  p_seo_title text,
  p_seo_description text,
  p_keywords jsonb,
  p_faq jsonb,
  p_author_name text,
  p_status text,
  p_is_featured boolean,
  p_publish_at timestamptz,
  p_ai_generated boolean,
  p_ai_model text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.manage', false);
  v_title text := btrim(coalesce(p_title, ''));
  v_slug text := btrim(coalesce(p_slug, ''));
  v_excerpt text := btrim(coalesce(p_excerpt, ''));
  v_body text := coalesce(p_body_markdown, '');
  v_category text := btrim(coalesce(nullif(p_category, ''), 'Genel'));
  v_status text := coalesce(nullif(p_status, ''), 'draft');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_tags text[];
  v_keywords text[];
  v_faq jsonb := coalesce(p_faq, '[]'::jsonb);
  v_words integer;
  v_existing public.blog_posts%rowtype;
  v_exists boolean := false;
  v_id uuid;
  v_version integer;
  v_prev_published timestamptz;
  v_published_at timestamptz;
  v_old jsonb := '{}'::jsonb;
begin
  if p_id is not null then
    select * into v_existing from public.blog_posts where id = p_id for update;
    v_exists := found;
    if not v_exists then
      raise exception 'post_not_found' using errcode = 'P0002';
    end if;
  end if;

  if length(v_title) < 8 or length(v_title) > 200 then
    raise exception 'title_length_invalid' using errcode = '22023';
  end if;
  if length(v_body) < 120 then
    raise exception 'body_too_short' using errcode = '22023';
  end if;
  if length(v_body) > 120000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;
  if length(v_excerpt) > 600 then
    raise exception 'excerpt_too_long' using errcode = '22023';
  end if;
  if v_status not in ('draft', 'published', 'archived') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if length(v_category) > 60 then
    raise exception 'category_too_long' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) < 3 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;
  if jsonb_typeof(v_faq) <> 'array' then
    raise exception 'faq_invalid' using errcode = '22023';
  end if;

  v_tags := coalesce(array(select jsonb_array_elements_text(coalesce(p_tags, '[]'::jsonb))), '{}'::text[]);
  v_keywords := coalesce(array(select jsonb_array_elements_text(coalesce(p_keywords, '[]'::jsonb))), '{}'::text[]);

  if v_slug = '' then
    v_slug := public.blog_slugify(v_title);
  else
    v_slug := public.blog_slugify(v_slug);
  end if;
  if length(v_slug) < 3 then
    raise exception 'slug_invalid' using errcode = '22023';
  end if;
  v_slug := left(v_slug, 140);

  -- Yeni kayıtta çakışan slug otomatik numaralanır; düzenlemede başka bir
  -- yazının slug'ı kullanılamaz.
  if v_exists then
    if exists (select 1 from public.blog_posts where slug = v_slug and id <> v_existing.id) then
      raise exception 'slug_taken' using errcode = '23505';
    end if;
    v_id := v_existing.id;
    v_version := v_existing.version + 1;
    v_prev_published := v_existing.published_at;
    v_old := jsonb_build_object('title', v_existing.title, 'status', v_existing.status, 'version', v_existing.version);
  else
    v_slug := left(v_slug, 120);
    while exists (select 1 from public.blog_posts where slug = v_slug) loop
      v_slug := left(v_slug, 120) || '-' || floor(random() * 9000 + 1000)::text;
    end loop;
    v_id := gen_random_uuid();
    v_version := 1;
  end if;

  v_words := coalesce(array_length(
    regexp_split_to_array(btrim(regexp_replace(v_body, '<[^>]+>', ' ', 'g')), '\s+'),
    1
  ), 0);

  if v_status = 'published' then
    v_published_at := coalesce(p_publish_at, v_prev_published, now());
  else
    v_published_at := v_prev_published;
  end if;

  insert into public.blog_posts (
    id, slug, title, excerpt, body_markdown, cover_image_url, cover_image_alt,
    category, tags, seo_title, seo_description, keywords, faq, author_name,
    status, is_featured, reading_minutes, word_count, ai_generated, ai_model,
    version, published_at, created_by, updated_by
  ) values (
    v_id, v_slug, v_title, v_excerpt, v_body,
    nullif(btrim(coalesce(p_cover_image_url, '')), ''),
    nullif(btrim(coalesce(p_cover_image_alt, '')), ''),
    v_category, v_tags,
    nullif(btrim(coalesce(p_seo_title, '')), ''),
    nullif(btrim(coalesce(p_seo_description, '')), ''),
    v_keywords, v_faq,
    btrim(coalesce(nullif(p_author_name, ''), 'Trabzone Editör')),
    v_status, coalesce(p_is_featured, false),
    greatest(1, ceil(v_words / 200.0)::integer),
    v_words, coalesce(p_ai_generated, false),
    nullif(btrim(coalesce(p_ai_model, '')), ''),
    v_version, v_published_at,
    v_admin, v_admin
  )
  on conflict (id) do update
  set slug = excluded.slug,
      title = excluded.title,
      excerpt = excluded.excerpt,
      body_markdown = excluded.body_markdown,
      cover_image_url = excluded.cover_image_url,
      cover_image_alt = excluded.cover_image_alt,
      category = excluded.category,
      tags = excluded.tags,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description,
      keywords = excluded.keywords,
      faq = excluded.faq,
      author_name = excluded.author_name,
      status = excluded.status,
      is_featured = excluded.is_featured,
      reading_minutes = excluded.reading_minutes,
      word_count = excluded.word_count,
      ai_generated = excluded.ai_generated,
      ai_model = excluded.ai_model,
      version = excluded.version,
      published_at = excluded.published_at,
      updated_by = excluded.updated_by,
      updated_at = now();

  insert into public.blog_post_versions (
    post_id, version, title, body_markdown, seo_title, seo_description, status, created_by
  ) values (
    v_id, v_version, v_title, v_body,
    nullif(btrim(coalesce(p_seo_title, '')), ''),
    nullif(btrim(coalesce(p_seo_description, '')), ''),
    v_status, v_admin
  );

  perform public.tz_admin_audit(
    'blog.post.save', 'Blog yazısı kaydedildi', 'blog_post', v_id::text,
    jsonb_build_object(
      'slug', v_slug,
      'old', v_old,
      'new', jsonb_build_object(
        'title', v_title,
        'status', v_status,
        'version', v_version,
        'word_count', v_words,
        'ai_generated', coalesce(p_ai_generated, false)
      )
    ) || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end,
    'success'
  );

  return public.admin_blog_post_get(v_id);
end;
$$;

create or replace function public.admin_blog_post_set_status(
  p_id uuid,
  p_status text,
  p_publish_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.manage', false);
  v_post public.blog_posts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_published_at timestamptz;
  v_version integer;
begin
  if p_status not in ('draft', 'published', 'archived') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status = 'archived' and (v_reason is null or length(v_reason) < 3) then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_post from public.blog_posts where id = p_id for update;
  if not found then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;

  v_version := v_post.version + 1;
  v_published_at := case
    when p_status = 'published' then coalesce(p_publish_at, v_post.published_at, now())
    else v_post.published_at
  end;

  update public.blog_posts
  set status = p_status,
      published_at = v_published_at,
      version = v_version,
      updated_by = v_admin,
      updated_at = now()
  where id = p_id;

  insert into public.blog_post_versions (
    post_id, version, title, body_markdown, seo_title, seo_description, status, created_by
  ) values (
    v_post.id, v_version, v_post.title, v_post.body_markdown,
    v_post.seo_title, v_post.seo_description, p_status, v_admin
  );

  perform public.tz_admin_audit(
    'blog.post.status', 'Blog yazısı durumu değiştirildi', 'blog_post', p_id::text,
    jsonb_build_object(
      'slug', v_post.slug,
      'from', v_post.status,
      'to', p_status,
      'published_at', v_published_at
    ) || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end,
    'success'
  );

  return public.admin_blog_post_get(p_id);
end;
$$;

create or replace function public.admin_blog_post_duplicate(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.manage', false);
  v_post public.blog_posts%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_slug text;
begin
  select * into v_post from public.blog_posts where id = p_id;
  if not found then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;

  v_slug := left(v_post.slug, 115) || '-kopya';
  while exists (select 1 from public.blog_posts where slug = v_slug) loop
    v_slug := left(v_post.slug, 110) || '-kopya-' || floor(random() * 9000 + 1000)::text;
  end loop;

  insert into public.blog_posts (
    id, slug, title, excerpt, body_markdown, cover_image_url, cover_image_alt,
    category, tags, seo_title, seo_description, keywords, faq, author_name,
    status, is_featured, reading_minutes, word_count, ai_generated, ai_model,
    version, published_at, created_by, updated_by
  ) values (
    v_new_id, v_slug, left(v_post.title || ' (Kopya)', 200), v_post.excerpt,
    v_post.body_markdown, v_post.cover_image_url, v_post.cover_image_alt,
    v_post.category, v_post.tags, v_post.seo_title, v_post.seo_description,
    v_post.keywords, v_post.faq, v_post.author_name,
    'draft', false, v_post.reading_minutes, v_post.word_count,
    v_post.ai_generated, v_post.ai_model, 1, null, v_admin, v_admin
  );

  insert into public.blog_post_versions (
    post_id, version, title, body_markdown, seo_title, seo_description, status, created_by
  ) values (
    v_new_id, 1, left(v_post.title || ' (Kopya)', 200), v_post.body_markdown,
    v_post.seo_title, v_post.seo_description, 'draft', v_admin
  );

  perform public.tz_admin_audit(
    'blog.post.duplicate', 'Blog yazısı kopyalandı', 'blog_post', v_new_id::text,
    jsonb_build_object('source_id', p_id, 'slug', v_slug), 'success'
  );

  return public.admin_blog_post_get(v_new_id);
end;
$$;

create or replace function public.admin_blog_post_delete(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.manage', false);
  v_post public.blog_posts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_post from public.blog_posts where id = p_id;
  if not found then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;

  delete from public.blog_posts where id = p_id;

  perform public.tz_admin_audit(
    'blog.post.delete', 'Blog yazısı silindi', 'blog_post', p_id::text,
    jsonb_build_object('slug', v_post.slug, 'title', v_post.title, 'reason', v_reason),
    'success'
  );

  return jsonb_build_object('deleted', true, 'id', p_id);
end;
$$;

create or replace function public.admin_blog_ai_runs_list(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('cms.view', false);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'action', r.action, 'model', r.model,
        'tokens_in', r.tokens_in, 'tokens_out', r.tokens_out,
        'duration_ms', r.duration_ms, 'ok', r.ok, 'error', r.error,
        'created_at', r.created_at, 'actor_name', pr.display_name,
        'prompt', left(r.prompt, 240)
      ) order by r.created_at desc)
      from (
        select * from public.blog_ai_runs order by created_at desc limit v_limit
      ) r
      left join public.profiles pr on pr.id = r.actor_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Herkese açık okuma (yalnızca yayında ve tarihi gelmiş yazılar)
-- ---------------------------------------------------------------------------

create or replace function public.blog_public_list(
  p_limit integer default 12,
  p_offset integer default 0,
  p_category text default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 48);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
  v_categories jsonb;
begin
  select count(*) into v_total
  from public.blog_posts p
  where p.status = 'published'
    and p.published_at is not null
    and p.published_at <= now()
    and (p_category is null or p.category = p_category)
    and (
      p_search is null
      or p.title ilike '%' || p_search || '%'
      or p.excerpt ilike '%' || p_search || '%'
      or exists (select 1 from unnest(p.tags) t where t ilike '%' || p_search || '%')
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'slug', x.slug,
    'title', x.title,
    'excerpt', x.excerpt,
    'cover_image_url', x.cover_image_url,
    'cover_image_alt', x.cover_image_alt,
    'category', x.category,
    'tags', to_jsonb(x.tags),
    'author_name', x.author_name,
    'reading_minutes', x.reading_minutes,
    'word_count', x.word_count,
    'is_featured', x.is_featured,
    'published_at', x.published_at,
    'updated_at', x.updated_at
  ) order by x.is_featured desc, x.published_at desc), '[]'::jsonb)
  into v_items
  from (
    select p.* from public.blog_posts p
    where p.status = 'published'
      and p.published_at is not null
      and p.published_at <= now()
      and (p_category is null or p.category = p_category)
      and (
        p_search is null
        or p.title ilike '%' || p_search || '%'
        or p.excerpt ilike '%' || p_search || '%'
        or exists (select 1 from unnest(p.tags) t where t ilike '%' || p_search || '%')
      )
    order by p.is_featured desc, p.published_at desc
    limit v_limit offset v_offset
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('name', c.category, 'count', c.total) order by c.total desc), '[]'::jsonb)
  into v_categories
  from (
    select category, count(*) as total
    from public.blog_posts
    where status = 'published' and published_at is not null and published_at <= now()
    group by category
  ) c;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'categories', v_categories
  );
end;
$$;

create or replace function public.blog_public_post(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_post public.blog_posts%rowtype;
  v_related jsonb;
begin
  select * into v_post
  from public.blog_posts
  where slug = lower(btrim(coalesce(p_slug, '')))
    and status = 'published'
    and published_at is not null
    and published_at <= now();

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', r.slug,
    'title', r.title,
    'excerpt', r.excerpt,
    'cover_image_url', r.cover_image_url,
    'category', r.category,
    'reading_minutes', r.reading_minutes,
    'published_at', r.published_at
  ) order by r.published_at desc), '[]'::jsonb)
  into v_related
  from (
    select p.* from public.blog_posts p
    where p.id <> v_post.id
      and p.status = 'published'
      and p.published_at is not null
      and p.published_at <= now()
    order by (p.category = v_post.category) desc, p.published_at desc
    limit 3
  ) r;

  return jsonb_build_object(
    'id', v_post.id,
    'slug', v_post.slug,
    'title', v_post.title,
    'excerpt', v_post.excerpt,
    'body_markdown', v_post.body_markdown,
    'cover_image_url', v_post.cover_image_url,
    'cover_image_alt', v_post.cover_image_alt,
    'category', v_post.category,
    'tags', to_jsonb(v_post.tags),
    'seo_title', v_post.seo_title,
    'seo_description', v_post.seo_description,
    'keywords', to_jsonb(v_post.keywords),
    'faq', v_post.faq,
    'author_name', v_post.author_name,
    'reading_minutes', v_post.reading_minutes,
    'word_count', v_post.word_count,
    'view_count', v_post.view_count,
    'published_at', v_post.published_at,
    'updated_at', v_post.updated_at,
    'related', v_related
  );
end;
$$;

create or replace function public.blog_track_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.blog_posts
  set view_count = view_count + 1
  where slug = lower(btrim(coalesce(p_slug, '')))
    and status = 'published'
    and published_at is not null
    and published_at <= now();
end;
$$;

create or replace function public.blog_sitemap_urls(
  p_limit integer default 1000,
  p_offset integer default 0
)
returns table (slug text, updated_at timestamptz, published_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.slug, p.updated_at, p.published_at
  from public.blog_posts p
  where p.status = 'published'
    and p.published_at is not null
    and p.published_at <= now()
  order by p.published_at desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 20000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------------

grant execute on function public.blog_slugify(text) to authenticated, service_role;
grant execute on function public.admin_blog_ai_check() to authenticated;
grant execute on function public.admin_blog_ai_settings_get() to authenticated;
grant execute on function public.admin_blog_ai_settings_save(boolean, text, numeric, text, text) to authenticated;
grant execute on function public.admin_blog_ai_log(text, text, text, integer, integer, integer, boolean, text) to authenticated;
grant execute on function public.admin_blog_ai_runs_list(integer) to authenticated;
grant execute on function public.admin_blog_stats() to authenticated;
grant execute on function public.admin_blog_posts_list(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_blog_post_get(uuid) to authenticated;
grant execute on function public.admin_blog_post_save(uuid, text, text, text, text, text, text, text, jsonb, text, text, jsonb, jsonb, text, text, boolean, timestamptz, boolean, text, text) to authenticated;
grant execute on function public.admin_blog_post_set_status(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.admin_blog_post_duplicate(uuid) to authenticated;
grant execute on function public.admin_blog_post_delete(uuid, text) to authenticated;

grant execute on function public.blog_public_list(integer, integer, text, text) to anon, authenticated;
grant execute on function public.blog_public_post(text) to anon, authenticated;
grant execute on function public.blog_track_view(text) to anon, authenticated;
grant execute on function public.blog_sitemap_urls(integer, integer) to anon, authenticated;

commit;
