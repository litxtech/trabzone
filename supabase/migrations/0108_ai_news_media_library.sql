-- 0108: Kaynak ve görsel kütüphanesine son kullanılan görselleri ekle.
-- Editör; hangi görselin hangi haberde, hangi lisansla kullanıldığını ve
-- kaldırma talebi olup olmadığını tek ekranda görebilmelidir.

create or replace function public.admin_ai_news_sources_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'domain', s.domain::text, 'kind', s.kind,
        'feed_url', s.feed_url, 'feed_kind', s.feed_kind,
        'media_license_code', s.media_license_code,
        'license_reference', s.license_reference,
        'attribution_text', s.attribution_text,
        'reliability', s.reliability, 'active', s.active,
        'notes_tr', s.notes_tr, 'last_checked_at', s.last_checked_at,
        'last_error', s.last_error
      ) order by s.kind, s.name)
      from public.ai_news_sources s
    ), '[]'::jsonb),
    'licenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', l.code, 'name_tr', l.name_tr,
        'commercial_use', l.commercial_use,
        'derivatives_allowed', l.derivatives_allowed,
        'attribution_required', l.attribution_required,
        'requires_documentation', l.requires_documentation,
        'is_usable', l.is_usable, 'license_url', l.license_url,
        'notes_tr', l.notes_tr
      ) order by l.code)
      from public.ai_news_media_licenses l
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'event_id', m.event_id,
        'event_title', e.title,
        'storage_path', m.storage_path,
        'source_url', m.source_url,
        'creator', m.creator,
        'credit', m.credit,
        'license_code', m.license_code,
        'license_reference', m.license_reference,
        'attribution', m.attribution,
        'is_placeholder', m.is_placeholder,
        'event_match_score', m.event_match_score,
        'status', m.status,
        'created_at', m.created_at,
        'removed_at', m.removed_at,
        'removal_reason', m.removal_reason
      ) order by m.created_at desc)
      from (
        select * from public.ai_news_media_assets
        order by created_at desc
        limit 30
      ) m
      left join public.ai_news_events e on e.id = m.event_id
    ), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'query', t.query, 'kind', t.kind, 'priority', t.priority,
        'active', t.active, 'uses', t.uses, 'hits', t.hits,
        'last_used_at', t.last_used_at
      ) order by t.priority desc, t.query)
      from public.ai_news_search_topics t
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.admin_ai_news_sources_list() to authenticated;
