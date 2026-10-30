-- 0144_live_news_admin_detail_fix.sql
-- The reports table stores the reason in reason_category (reason_code is only
-- an alias used by the report RPCs). admin_live_news_detail referenced a
-- non-existent "reason" column, which broke the admin review screen.
--
-- Applied fix: use reason_category and expose it as "reason" in the JSON so
-- the existing admin UI contract stays unchanged.

create or replace function public.admin_live_news_detail(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('live_news.view', false);
  v_row public.live_news%rowtype;
begin
  select * into v_row from public.live_news where post_id = p_post_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'post', public.tz_post_json(p_post_id, v_admin),
    'live_news', public.tz_live_news_brief(p_post_id, v_admin) || jsonb_build_object(
      'source_note', v_row.source_note,
      'editorial_note', v_row.editorial_note,
      'moderation_reason', v_row.moderation_reason,
      'attribution', v_row.attribution,
      'verified_by', v_row.verified_by,
      'reports', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ur.id,
          'report_no', ur.report_no,
          'reason', ur.reason_category,
          'status_code', ur.status_code,
          'created_at', ur.created_at
        ) order by ur.created_at desc), '[]'::jsonb)
        from public.user_reports ur
        where ur.target_type = 'post' and ur.target_id = p_post_id::text
          and ur.status_code in ('received', 'under_review')
      ),
      'history', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id,
          'action_code', a.action_code,
          'action_label', a.action_label_tr,
          'outcome', a.outcome,
          'metadata', a.metadata_safe,
          'created_at', a.created_at
        ) order by a.created_at desc), '[]'::jsonb)
        from (
          select * from public.admin_audit_logs
          where target_type = 'live_news' and target_id = p_post_id::text
          order by created_at desc
          limit 25
        ) a
      )
    )
  );
end;
$$;

revoke all on function public.admin_live_news_detail(uuid) from public, anon;
grant execute on function public.admin_live_news_detail(uuid) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('0144', 'live_news_admin_detail_fix')
on conflict (version) do nothing;
