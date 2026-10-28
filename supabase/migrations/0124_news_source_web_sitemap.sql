-- 0104 — Kaynak haberleri için herkese açık web sayfası ve sitemap
--
-- MOD A/B ile sosyal akışa verilen kaynak haberleri şimdiye kadar yalnızca
-- `/post/<id>` üzerinden görülebiliyordu; Google News sitemap'inde yer
-- almıyordu. Bu migration, mevcut `/haber/<slug>` derin bağlantı şemasını
-- kullanarak kaynak haberlerine sunucu tarafında işlenen bir makale sayfası
-- ve sitemap kaydı ekler. Silinen haber `posts.moderation_status='removed'`
-- olduğunda RPC boş döner; sayfa 404 + noindex, sitemap dışı olur.

-- ---------------------------------------------------------------------------
-- Herkese açık kaynak haberi
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

  v_can_body := coalesce((v_item.license_snapshot->>'can_republish_text')::boolean, false);
  v_body := case
    when v_can_body and nullif(btrim(coalesce(v_item.body, '')), '') is not null then v_item.body
    else coalesce(v_item.summary, '')
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'domain', split_part(regexp_replace(i.canonical_url, '^https?://', ''), '/', 1),
    'kind', 'source',
    'url', i.canonical_url,
    'title', i.title,
    'retrieved_at', i.last_seen_at
  ) order by l.published_at), '[]'::jsonb), count(*)::integer
  into v_sources, v_count
  from public.news_publication_links l
  join public.news_source_items i on i.id = l.item_id
  where l.post_id = v_post_id and l.status = 'published';

  v_publisher := coalesce(v_profile.display_name, v_item.source_name, v_conn.name, 'Trabzone Haber');
  v_image := v_item.image_storage_path;

  return jsonb_build_object(
    'post_id', v_post_id,
    'slug', v_slug,
    'kind', 'source',
    'title', coalesce(v_item.title, 'Trabzon haberi'),
    'spot', coalesce(v_item.summary, ''),
    'body', coalesce(v_body, ''),
    'category_slug', coalesce(v_item.category_slug, 'trabzon-gundem'),
    'category_name', coalesce(v_category.name_tr, 'Trabzon Gündem'),
    'district', coalesce(v_item.district, 'Trabzon'),
    'event_date', null,
    'risk_level', 'source',
    'ai_generated', false,
    'ai_model', null,
    'disclosure', 'Bu haber, ' || coalesce(v_item.source_name, v_conn.name, 'haber kaynağı') ||
      ' tarafından yayımlanan içerikten, kaynağın izin verdiği kapsamda aktarılmıştır. ' ||
      'Orijinal habere ve kaynak bilgisine sayfanın altından ulaşabilirsiniz.',
    'sources', v_sources,
    'source_count', v_count,
    'independent_sources', v_count,
    'primary_source', v_item.canonical_url,
    'published_at', coalesce(v_item.published_at, v_post.created_at),
    'updated_at', greatest(v_post.updated_at, v_item.last_seen_at),
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
      'attribution', 'Fotoğraf: ' || v_publisher
    ) end
  );
end;
$$;

revoke all on function public.news_source_public_post_by_slug(text) from public;
grant execute on function public.news_source_public_post_by_slug(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sitemap: yayındaki, görünür kaynak haberleri
-- ---------------------------------------------------------------------------
create or replace function public.news_source_sitemap_urls(p_limit integer default 1000, p_offset integer default 0)
returns table(slug text, title text, published_at timestamptz, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.slug, s.title, s.published_at, s.updated_at
  from (
    select distinct on (p.id)
      'kaynak-' || p.id::text as slug,
      coalesce(i.title, 'Trabzon haberi') as title,
      coalesce(i.published_at, p.created_at) as published_at,
      greatest(p.updated_at, i.last_seen_at) as updated_at
    from public.posts p
    join public.news_publication_links l on l.post_id = p.id and l.status = 'published'
    join public.news_source_items i on i.id = l.item_id
    where p.moderation_status = 'visible'
      and i.status = 'published'
    order by p.id, coalesce(i.published_at, p.created_at)
  ) s
  order by s.published_at desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 20000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.news_source_sitemap_urls(integer, integer) from public;
grant execute on function public.news_source_sitemap_urls(integer, integer) to anon, authenticated, service_role;
