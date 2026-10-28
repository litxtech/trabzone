-- 0103 — Taslağı eksik kuyruk olaylarını kurtarma
--
-- 0102 öncesinde risk A olup otomatik yayın koşulu sağlamayan olaylar
-- inceleme kuyruğuna düşüyor ancak taslak üretilmiyordu. Editörün
-- inceleyebilmesi için bu olayların ana arama sonucundan taslak üretmesi
-- gerekir. Fonksiyon yalnızca okuma yapar; taslağı worker oluşturur.

begin;

set search_path = public, extensions;

create or replace function public.ai_news_events_needing_draft(p_limit integer default 2)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', x.id,
    'risk_level', x.risk_level,
    'category_slug', x.category_slug,
    'district', x.district,
    'event_date', x.event_date,
    'summary', x.summary,
    'id', x.result_id,
    'title', x.result_title,
    'url', x.result_url,
    'source_domain', x.source_domain,
    'source_kind', x.source_kind,
    'snippet', x.snippet,
    'summary_text', x.result_summary,
    'content', x.result_content,
    'published_at', x.published_at
  ) order by x.first_seen_at), '[]'::jsonb)
  from (
    select e.id, e.risk_level, e.category_slug, e.district, e.event_date,
           e.summary, e.first_seen_at,
           r.id as result_id, r.title as result_title, r.url as result_url,
           r.source_domain, r.source_kind, r.snippet, r.summary as result_summary,
           r.content as result_content, r.published_at
    from public.ai_news_events e
    join lateral (
      select sr.* from public.ai_news_search_results sr
      where sr.event_id = e.id
        and coalesce(nullif(sr.content, ''), sr.summary, sr.snippet, '') <> ''
      order by sr.id desc
      limit 1
    ) r on true
    where e.status in ('awaiting_review', 'ready', 'verified')
      and not exists (
        select 1 from public.ai_news_drafts d
        where d.event_id = e.id and d.is_current
      )
    order by e.first_seen_at
    limit least(greatest(coalesce(p_limit, 2), 1), 5)
  ) x;
$$;

revoke all on function public.ai_news_events_needing_draft(integer) from public, anon, authenticated;
grant execute on function public.ai_news_events_needing_draft(integer) to service_role;

commit;
