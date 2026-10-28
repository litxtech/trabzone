-- ---------------------------------------------------------------------------
-- TRABZONE — Haber API Merkezi düzeltmeleri (0099)
--  * Gövde konum satırında "Trabzon, Trabzon" tekrarını kaldırır.
--  * Sitemap lastmod değerini geçerli W3C tarih biçimine çevirir.
--  * Sitemap başlığını tek satıra indirir.
-- ---------------------------------------------------------------------------

create or replace function public.news_compose_body(
  p_title text,
  p_summary text,
  p_body text,
  p_include_body boolean,
  p_district text,
  p_category_name text,
  p_source_name text,
  p_url text,
  p_attribution text
)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    concat_ws(
      E'\n\n',
      nullif(btrim(coalesce(p_title, '')), ''),
      nullif(btrim(coalesce(p_summary, '')), ''),
      case when coalesce(p_include_body, false) then nullif(btrim(coalesce(p_body, '')), '') end,
      case
        when coalesce(nullif(btrim(coalesce(p_district, '')), ''), 'Trabzon') in ('Trabzon', 'trabzon', 'TRABZON')
          then E'📍 Trabzon'
        else E'📍 ' || btrim(p_district) || ', Trabzon'
      end
        || E'\n🗂 ' || coalesce(nullif(btrim(coalesce(p_category_name, '')), ''), 'Trabzon Gündem')
        || E'\n🔗 Kaynak: ' || coalesce(nullif(btrim(coalesce(p_source_name, '')), ''), 'Haber kaynağı')
        || ' — ' || coalesce(p_url, '')
        || case when nullif(btrim(coalesce(p_attribution, '')), '') is not null
                then E'\n' || btrim(p_attribution) else '' end
    ),
    2000
  );
$$;

create or replace function public.news_api_sitemap_urls(p_limit integer default 5000, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'loc', '/post/' || s.post_id::text,
      'lastmod', to_char(timezone('UTC', coalesce(s.published_at, s.created_at)), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'title', left(split_part(coalesce(s.body, ''), E'\n', 1), 140),
      'source', s.connection_name
    ) order by coalesce(s.published_at, s.created_at) desc)
    from (
      select l.post_id, l.published_at, p.created_at, p.body, c.name as connection_name
      from public.news_publication_links l
      join public.posts p on p.id = l.post_id
      join public.news_api_connections c on c.id = l.connection_id
      where l.status = 'published'
        and p.moderation_status = 'visible'
        and p.visibility = 'public'
        and c.status <> 'disabled'
        and c.archived_at is null
      order by coalesce(l.published_at, p.created_at) desc
      limit least(greatest(coalesce(p_limit, 5000), 1), 5000)
      offset greatest(coalesce(p_offset, 0), 0)
    ) s
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.news_api_sitemap_urls(integer, integer) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
