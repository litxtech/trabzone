-- =====================================================================
-- 0031 — Report export RPC
--
-- The reporting UI has always had a CSV/Excel export button, and the report
-- query RPC caps a single page. Export therefore pages through
-- admin_report_query server-side, applies a hard 5.000-row limit and writes an
-- access record before returning the data.
-- =====================================================================
begin;

create or replace function public.admin_report_export_query(
  p_key text,
  p_from timestamptz,
  p_to timestamptz,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 5000,
  p_offset integer default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('report.view', false);
  v_cap integer := least(greatest(coalesce(p_limit, 5000), 1), 5000);
  v_row_cap integer := 0;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb := '[]'::jsonb;
  v_page jsonb;
  v_page_rows jsonb;
  v_page_count integer;
  v_total integer := 0;
  v_columns jsonb := '[]'::jsonb;
begin
  if not public.has_permission('report.download') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- The query RPC owns permission, key and date validation.
  loop
    v_page := public.admin_report_query(
      p_key, p_from, p_to, coalesce(p_filters, '{}'::jsonb), 1000, v_offset
    );

    if v_columns = '[]'::jsonb then
      v_columns := coalesce(v_page -> 'columns', '[]'::jsonb);
    end if;

    v_page_rows := coalesce(v_page -> 'rows', '[]'::jsonb);
    v_page_count := jsonb_array_length(v_page_rows);

    exit when v_page_count = 0;

    v_rows := v_rows || v_page_rows;
    v_total := v_total + v_page_count;
    v_offset := v_offset + v_page_count;

    v_row_cap := v_row_cap + v_page_count;
    -- admin_report_query reports the page length as "total"; only a short page
    -- reliably signals the end of the result set. Continue until then or the
    -- hard export cap is reached.
    exit when v_page_count < 1000 or v_row_cap >= v_cap;
  end loop;

  insert into public.report_access_logs (job_id, actor_user_id, action, report_key, metadata_safe)
  values (
    null,
    v_admin,
    'download',
    p_key,
    jsonb_build_object('rows', jsonb_array_length(v_rows), 'format', 'server')
  );

  perform public.tz_admin_audit(
    'report.exported',
    'Rapor dışa aktarıldı',
    'report',
    p_key,
    jsonb_build_object('rows', jsonb_array_length(v_rows)),
    'success'
  );

  return jsonb_build_object(
    'columns', v_columns,
    'rows', v_rows,
    'total', v_total,
    'limit', v_cap,
    'offset', greatest(coalesce(p_offset, 0), 0)
  );
end;
$$;

revoke all on function public.admin_report_export_query(text, timestamptz, timestamptz, jsonb, integer, integer)
  from public, anon;
grant execute on function public.admin_report_export_query(text, timestamptz, timestamptz, jsonb, integer, integer)
  to authenticated, service_role;

commit;
