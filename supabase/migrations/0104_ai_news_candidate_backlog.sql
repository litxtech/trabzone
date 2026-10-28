-- 0104 — AI Haber Merkezi: işlenmeyen adayların kaybolmaması
--
-- 0095'te `ai_news_candidates` yalnızca aynı çalışmada kaydedilen
-- sonuçları seçiyordu. Bir çalışmada kota/limit nedeniyle işlenmeyen
-- "new" sonuçlar bir sonraki çalışmada aday havuzuna hiç girmiyor,
-- dolayısıyla keşfedilen haberler sessizce kayboluyordu.
--
-- Yeni sürüm bekleyen tüm sonuçları yaş/güven sırasına göre sunar.
-- Bu bir çalışmada en fazla `p_limit` aday işlenir; durum değiştiği için
-- aynı sonuç ikinci kez işlenmez ve kota aşılmaz.

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
      ) order by x.current_run desc, x.rerank_score desc nulls last, x.id)
      from (
        select *,
               (r.run_id = p_run_id) as current_run
        from public.ai_news_search_results r
        where r.status = 'new'
          and coalesce(nullif(r.content, ''), r.summary, r.snippet, '') <> ''
          -- Bu çalışmanın sonuçları önceliklidir; ardından bekleyen havuz.
          and (
            r.run_id = p_run_id
            or r.created_at > now() - interval '3 days'
          )
        order by current_run desc, r.rerank_score desc nulls last, r.id desc
        limit v_limit
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.ai_news_candidates(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_news_candidates(uuid, integer) to service_role;

commit;
