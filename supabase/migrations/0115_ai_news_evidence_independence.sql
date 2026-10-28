-- 0101 — Kanıt bağımsızlığı: URL'siz içerik parmak izi
--
-- 0094'te `content_hash` URL'yi de içeriyordu. Aynı ajans metnini farklı
-- adreslerde yayımlayan iki site bu nedenle "bağımsız" sayılabiliyordu.
-- Yeni parmak izi yalnızca normalize edilmiş başlık + metinden üretilir;
-- aynı metin tek doğrulama kabul edilir. Bağımsız kaynak sayısı ayrıca
-- domain bazında sayılır, böylece tek sitenin iki farklı metni iki kaynak
-- sayılmaz.

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
  v_title text;
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
  v_content := left(coalesce(p_payload ->> 'content', ''), 60000);
  v_title := left(coalesce(p_payload ->> 'title', ''), 400);

  -- URL bilinçli olarak hash'e girmez: aynı ajans metninin kopyaları
  -- tek kanıt sayılmalıdır.
  v_hash := md5(
    regexp_replace(
      lower(v_title || ' ' || left(coalesce(nullif(v_content, ''), p_payload ->> 'excerpt', ''), 4000)),
      '[^a-z0-9çğıöşü]+', ' ', 'g'
    )
  );

  insert into public.ai_news_evidence (
    event_id, source_domain, source_kind, url, title, excerpt, facts,
    content_hash, is_primary, independent, fetched_via
  ) values (
    p_event_id, v_domain, v_kind, v_url,
    v_title,
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
           select count(distinct x.source_domain)
           from (
             select distinct on (v.content_hash) v.source_domain
             from public.ai_news_evidence v
             where v.event_id = e.id
               and v.source_kind in ('official', 'trusted_media')
               and v.independent
             order by v.content_hash, v.retrieved_at
           ) x
         ),
         last_seen_at = now()
   where e.id = p_event_id;

  return p_event_id;
end;
$$;

revoke all on function public.ai_news_evidence_add(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ai_news_evidence_add(uuid, jsonb) to service_role;

-- Eski kayıtları yeni parmak izine taşı; aynı olay içindeki kopyaları tekilleştir.
with normalized as (
  select v.id,
         v.event_id,
         md5(
           regexp_replace(
             lower(coalesce(v.title, '') || ' ' || left(coalesce(v.excerpt, ''), 4000)),
             '[^a-z0-9çğıöşü]+', ' ', 'g'
           )
         ) as new_hash
  from public.ai_news_evidence v
),
ranked as (
  select n.id, n.event_id, n.new_hash,
         row_number() over (partition by n.event_id, n.new_hash order by n.id) as rn
  from normalized n
)
delete from public.ai_news_evidence v
using ranked r
where v.id = r.id and r.rn > 1;

with normalized as (
  select v.id, v.event_id,
         md5(
           regexp_replace(
             lower(coalesce(v.title, '') || ' ' || left(coalesce(v.excerpt, ''), 4000)),
             '[^a-z0-9çğıöşü]+', ' ', 'g'
           )
         ) as new_hash
  from public.ai_news_evidence v
)
update public.ai_news_evidence v
   set content_hash = n.new_hash
  from normalized n
 where v.id = n.id and v.content_hash is distinct from n.new_hash;

update public.ai_news_events e
   set primary_source = exists (
         select 1 from public.ai_news_evidence v
         where v.event_id = e.id and v.source_kind = 'official'
       ),
       independent_sources = (
         select count(distinct x.source_domain)
         from (
           select distinct on (v.content_hash) v.source_domain
           from public.ai_news_evidence v
           where v.event_id = e.id
             and v.source_kind in ('official', 'trusted_media')
             and v.independent
           order by v.content_hash, v.retrieved_at
         ) x
       )
 where exists (select 1 from public.ai_news_evidence v where v.event_id = e.id);
