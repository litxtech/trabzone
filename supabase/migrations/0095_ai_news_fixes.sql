-- 0095: AI Haber Merkezi düzeltmeleri
--
-- DeepSeek Search yanıtı gövde metnini `summary` alanında döndürüyor.
-- Aday seçimi `content` alanı boş olduğunda bu alana düşmeli; aksi halde
-- hiçbir aday işlenmez.

begin;

set search_path = public, extensions;

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
        'content', left(coalesce(nullif(x.content, ''), x.summary, x.snippet, ''), 20000),
        'published_at', x.published_at,
        'query', x.query
      ) order by x.rerank_score desc nulls last, x.id)
      from (
        select * from public.ai_news_search_results r
        where r.status = 'new'
          and r.run_id = p_run_id
          and coalesce(nullif(r.content, ''), r.summary, r.snippet, '') <> ''
        order by r.rerank_score desc nulls last, r.id
        limit v_limit
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.ai_news_candidates(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_news_candidates(uuid, integer) to service_role;

create or replace function public.ai_news_record_results(
  p_run_id uuid,
  p_query text,
  p_results jsonb,
  p_source text default 'search'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_settings public.ai_news_settings%rowtype;
  v_url text;
  v_norm text;
  v_domain text;
  v_kind text;
  v_published timestamptz;
  v_content text;
  v_hash text;
  v_relevant boolean;
  v_fresh boolean;
  v_status text;
  v_final_status text;
  v_reason text;
  v_id bigint;
  v_ignored integer := 0;
  v_new integer := 0;
  v_total integer := 0;
begin
  select * into v_settings from public.ai_news_settings where id;

  if jsonb_typeof(coalesce(p_results, 'null'::jsonb)) <> 'array' then
    raise exception 'invalid_results' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    v_total := v_total + 1;
    begin
      v_url := btrim(coalesce(v_item ->> 'url', ''));
      v_norm := public.ai_news_normalize_url(v_url);
    exception
      when others then
        continue;
    end;

    v_domain := public.ai_news_domain(v_url);
    if v_domain = '' or v_domain !~ '\.' then
      continue;
    end if;

    v_kind := public.ai_news_domain_kind(v_domain);
    v_content := left(coalesce(
      nullif(v_item ->> 'content', ''),
      nullif(v_item ->> 'summary', ''),
      ''
    ), 60000);
    v_hash := md5(coalesce(v_item ->> 'title', '') || '|' || v_content);
    begin
      v_published := nullif(v_item ->> 'date', '')::timestamptz;
    exception
      when others then
        v_published := null;
    end;
    v_relevant := public.ai_news_is_trabzon_text(
      coalesce(v_item ->> 'title', '') || ' ' || coalesce(v_item ->> 'summary', '') || ' ' || v_content
    );
    v_fresh := v_published is null
      or v_published > now() - make_interval(hours => v_settings.max_article_age_hours);

    if v_kind = 'low_trust' then
      v_status := 'ignored';
      v_reason := 'low_trust_source';
    elsif not v_relevant then
      v_status := 'ignored';
      v_reason := 'not_trabzon';
    elsif not v_fresh then
      v_status := 'ignored';
      v_reason := 'too_old';
    else
      v_status := 'new';
      v_reason := null;
    end if;

    insert into public.ai_news_search_results (
      run_id, query, title, url, normalized_url, source_domain, source_kind,
      site_name, snippet, summary, content, content_hash, published_at,
      rerank_score, status, ignore_reason, fetched_via
    ) values (
      p_run_id, left(p_query, 200),
      left(coalesce(nullif(v_item ->> 'title', ''), v_norm), 400),
      v_url, v_norm, v_domain, v_kind,
      left(nullif(v_item ->> 'site_name', ''), 160),
      left(v_item ->> 'snippet', 1200),
      left(v_item ->> 'summary', 5000),
      nullif(v_content, ''),
      case when v_content = '' then null else v_hash end,
      v_published,
      case
        when coalesce(v_item ->> 'rerank_score', '') ~ '^-?[0-9.]+$'
          then least(greatest((v_item ->> 'rerank_score')::numeric, 0), 99)
        else null
      end,
      v_status, v_reason, coalesce(nullif(p_source, ''), 'search')
    )
    on conflict (normalized_url) do update
      set run_id = excluded.run_id,
          content = coalesce(nullif(excluded.content, ''), public.ai_news_search_results.content),
          content_hash = coalesce(excluded.content_hash, public.ai_news_search_results.content_hash),
          summary = coalesce(excluded.summary, public.ai_news_search_results.summary),
          published_at = coalesce(excluded.published_at, public.ai_news_search_results.published_at),
          source_kind = excluded.source_kind,
          rerank_score = coalesce(excluded.rerank_score, public.ai_news_search_results.rerank_score),
          status = case
            when public.ai_news_search_results.status in ('classified', 'duplicate', 'rejected')
              then public.ai_news_search_results.status
            else excluded.status
          end,
          ignore_reason = case
            when public.ai_news_search_results.status in ('classified', 'duplicate', 'rejected')
              then public.ai_news_search_results.ignore_reason
            else excluded.ignore_reason
          end
    returning id, status into v_id, v_final_status;

    if coalesce(v_final_status, v_status) = 'ignored' then
      v_ignored := v_ignored + 1;
    else
      v_new := v_new + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'total', v_total,
    'new', v_new,
    'ignored', v_ignored
  );
end;
$$;

revoke all on function public.ai_news_record_results(uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.ai_news_record_results(uuid, text, jsonb, text) to service_role;

-- Aynı ajans metninin kopyaları farklı URL'lerde olsa da tek kanıt sayılsın:
-- içerik özeti yoksa başlık + özet üzerinden parmak izi üretilir.
create or replace function public.ai_news_evidence_add(
  p_event_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_domain text;
  v_kind text;
  v_content text;
  v_hash text;
  v_id bigint;
begin
  v_url := btrim(coalesce(p_payload ->> 'url', ''));
  if v_url = '' then
    raise exception 'evidence_url_required' using errcode = '22023';
  end if;

  v_domain := public.ai_news_domain(v_url);
  v_kind := coalesce(
    nullif(p_payload ->> 'source_kind', ''),
    public.ai_news_domain_kind(v_domain)
  );
  v_content := left(coalesce(
    nullif(p_payload ->> 'content', ''),
    nullif(p_payload ->> 'excerpt', ''),
    ''
  ), 60000);
  v_hash := md5(coalesce(p_payload ->> 'title', '') || '|' || v_content || '|' || v_url);

  insert into public.ai_news_evidence (
    event_id, source_domain, source_kind, url, title, excerpt, facts,
    content_hash, is_primary, independent, fetched_via
  ) values (
    p_event_id, v_domain, v_kind, v_url,
    left(coalesce(p_payload ->> 'title', ''), 400),
    left(coalesce(p_payload ->> 'excerpt', p_payload ->> 'summary', ''), 1200),
    coalesce(p_payload -> 'facts', '{}'::jsonb),
    v_hash,
    coalesce((p_payload ->> 'is_primary')::boolean, v_kind = 'official'),
    coalesce((p_payload ->> 'independent')::boolean, v_kind in ('official', 'trusted_media')),
    coalesce(nullif(p_payload ->> 'fetched_via', ''), 'search')
  )
  on conflict (event_id, content_hash) do update
    set title = excluded.title,
        excerpt = excluded.excerpt,
        facts = excluded.facts,
        retrieved_at = now()
  returning id into v_id;

  update public.ai_news_events e
     set primary_source = exists (
           select 1 from public.ai_news_evidence v
           where v.event_id = e.id and v.source_kind = 'official'
         ),
         independent_sources = (
           select count(distinct x.content_hash)
           from (
             select distinct on (v.source_domain) v.source_domain, v.content_hash
             from public.ai_news_evidence v
             where v.event_id = e.id
               and v.source_kind in ('official', 'trusted_media')
               and v.independent
             order by v.source_domain, v.retrieved_at
           ) x
         ),
         last_seen_at = now()
   where e.id = p_event_id;

  return p_event_id;
end;
$$;

revoke all on function public.ai_news_evidence_add(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ai_news_evidence_add(uuid, jsonb) to service_role;

commit;
