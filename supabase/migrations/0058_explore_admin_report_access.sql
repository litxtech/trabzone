-- =====================================================================
-- 0054 — Harita/emlak şikâyet listesi erişimi
--
-- Emlak yöneticisi (realestate.view) harita yöneticisi olmadan da
-- emlak şikâyetlerini görebilmelidir. Karar RPC'si zaten hedef türüne
-- göre realestate.moderate / map.moderate ayrımını uygular.
-- =====================================================================

set search_path = public, extensions;

create or replace function public.admin_reports_list(
  p_status text default 'pending',
  p_target_type text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'target_type', r.target_type, 'target_id', r.target_id,
        'target_label', case r.target_type
          when 'place' then (select p.name from public.places p where p.id = r.target_id)
          when 'place_review' then (select left(coalesce(pr.body, 'Yorum'), 100) from public.place_reviews pr where pr.id = r.target_id)
          when 'place_media' then (select pm.storage_path from public.place_media pm where pm.id = r.target_id)
          when 'real_estate_listing' then (select l.title from public.real_estate_listings l where l.id = r.target_id)
          when 'real_estate_media' then (select rm.storage_path from public.real_estate_media rm where rm.id = r.target_id)
          else null end,
        'reason', r.reason, 'details', r.details, 'status', r.status,
        'reporter_id', r.reporter_id,
        'reporter', (select p.username::text from public.profiles p where p.id = r.reporter_id),
        'created_at', r.created_at, 'resolved_at', r.resolved_at
      ) order by r.created_at)
      from (
        select * from public.content_reports
        where (p_status is null or status = p_status)
          and (p_target_type is null or target_type = p_target_type)
        order by created_at
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
        offset greatest(coalesce(p_offset, 0), 0)
      ) r
    ), '[]'::jsonb),
    'total', (
      select count(*) from public.content_reports
      where (p_status is null or status = p_status)
        and (p_target_type is null or target_type = p_target_type)
    )
  )
  where public.tz_admin_require(
    case
      when public.has_permission('map.view') then 'map.view'
      else 'realestate.view'
    end
  ) is not null;
$$;

revoke all on function public.admin_reports_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_reports_list(text, text, integer, integer) to authenticated, service_role;
