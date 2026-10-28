-- 0016: Marketplace ilanlarının şikâyet edilebilmesi
--
-- 0005'te tanımlanan hedef türü kısıtına ve doğrulama listesine `listing`
-- eklenir. Mevcut şikâyet kayıtları etkilenmez; yalnızca yeni tür desteklenir.

alter table public.user_reports drop constraint if exists user_reports_target_type_check;

alter table public.user_reports
  add constraint user_reports_target_type_check
  check (target_type in (
    'user', 'profile', 'post', 'reel', 'comment', 'message',
    'map_share', 'live', 'call', 'room', 'story', 'listing', 'other'
  ));

create or replace function public.safety_create_report(
  p_target_type text,
  p_target_id text,
  p_reason_code text,
  p_child_reason_code text default null,
  p_description text default null,
  p_target_user_id uuid default null,
  p_attachments jsonb default '[]'::jsonb,
  p_target_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.safety_require_auth();
  v_target_type text := coalesce(nullif(trim(p_target_type), ''), 'other');
  v_target_id text := left(trim(coalesce(p_target_id, '')), 200);
  v_reason text := coalesce(nullif(trim(p_reason_code), ''), 'other');
  v_child_reason text := nullif(trim(coalesce(p_child_reason_code, '')), '');
  v_reason_row public.report_reason_catalog%rowtype;
  v_child_row public.report_reason_catalog%rowtype;
  v_is_child boolean := false;
  v_priority text := 'normal';
  v_sla timestamptz;
  v_report_id uuid;
  v_report_no text;
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_snapshot jsonb := coalesce(p_target_snapshot, '{}'::jsonb);
  v_severity text;
  v_case_id uuid;
begin
  if v_target_type not in ('user', 'profile', 'post', 'reel', 'comment', 'message',
                           'map_share', 'live', 'call', 'room', 'story', 'listing', 'other') then
    raise exception 'invalid_target_type' using errcode = '22023';
  end if;

  if v_target_id = '' then
    raise exception 'missing_target' using errcode = '22023';
  end if;

  if jsonb_typeof(v_attachments) <> 'array' or jsonb_array_length(v_attachments) > 3 then
    raise exception 'invalid_attachments' using errcode = '22023';
  end if;

  if jsonb_typeof(v_snapshot) <> 'object' or pg_column_size(v_snapshot) > 8192 then
    raise exception 'invalid_snapshot' using errcode = '22023';
  end if;

  select * into v_reason_row from public.report_reason_catalog
  where code = v_reason and is_active and parent_code is null;
  if not found then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  if v_reason = 'child_safety' then
    v_is_child := true;

    if v_child_reason is null then
      raise exception 'missing_child_reason' using errcode = '22023';
    end if;

    select * into v_child_row from public.report_reason_catalog
    where code = v_child_reason and parent_code = 'child_safety' and is_active;
    if not found then
      raise exception 'invalid_child_reason' using errcode = '22023';
    end if;

    v_priority := v_child_row.default_priority;
  else
    v_priority := v_reason_row.default_priority;
  end if;

  if v_is_child then
    perform public.safety_check_rate('report_child', 30, interval '1 hour');
  else
    perform public.safety_check_rate('report_create', 20, interval '1 day');
  end if;

  if exists (
    select 1 from public.user_reports r
    where r.reporter_id = v_uid
      and r.target_type = v_target_type
      and r.target_id = v_target_id
      and r.reason_category = v_reason
      and r.created_at > now() - interval '24 hours'
      and r.status_code in ('received', 'under_review')
  ) then
    raise exception 'duplicate_report' using errcode = '22023';
  end if;

  v_sla := case
    when v_is_child and v_priority = 'critical' then now() + interval '30 minutes'
    when v_is_child then now() + interval '4 hours'
    else now() + interval '24 hours'
  end;

  insert into public.user_reports (
    reporter_id, target_type, target_id, reason_category, status, status_code,
    child_reason_code, is_child_safety, priority, sla_due_at,
    target_owner_id, target_snapshot, metadata_safe, description
  )
  values (
    v_uid, v_target_type, v_target_id, v_reason, 'open', 'received',
    v_child_reason, v_is_child, v_priority, v_sla,
    p_target_user_id, v_snapshot, jsonb_build_object('attachments', v_attachments),
    left(nullif(trim(coalesce(p_description, '')), ''), 2000)
  )
  returning id into v_report_id;

  update public.user_reports
     set report_no = case when v_is_child then 'CG-' else 'B-' end
       || to_char(now(), 'YYMM') || '-'
       || lpad(nextval('public.report_no_seq')::text, 6, '0')
   where id = v_report_id
  returning report_no into v_report_no;

  insert into public.report_actions (report_id, actor_id, actor_role, action_code)
  values (v_report_id, v_uid, 'user', 'report.created');

  if v_is_child then
    v_severity := case when v_priority = 'critical' then 'critical' else 'high' end;

    insert into public.child_safety_incidents (
      case_ref, severity, category, status, subject_ref, metadata_safe
    )
    values (
      v_report_no, v_severity, v_child_reason, 'open', v_target_id,
      jsonb_build_object('report_id', v_report_id, 'report_no', v_report_no)
    )
    returning id into v_case_id;
  end if;

  perform public.safety_notify(
    v_uid,
    case when v_is_child then 'child_report_received' else 'report_received' end,
    case when v_is_child then 'Bildiriminiz Alındı' else 'Bildiriminiz kaydedildi' end,
    case when v_is_child
      then 'Çocuk güvenliği bildiriminiz öncelikli inceleme sürecine yönlendirildi.'
      else 'Bildiriminiz kayıt altına alındı. İnceleme durumunu Başvurularım bölümünden takip edebilirsiniz.'
    end,
    'report', v_report_id::text
  );

  perform public.safety_log_activity(v_uid, 'report.submitted',
    jsonb_build_object('reason', left(v_reason, 64)), 'app');

  return jsonb_build_object(
    'id', v_report_id,
    'report_no', v_report_no,
    'target_type', v_target_type,
    'target_id', v_target_id,
    'reason_code', v_reason,
    'child_reason_code', v_child_reason,
    'is_child_safety', v_is_child,
    'priority', v_priority,
    'status_code', 'received',
    'sla_due_at', v_sla,
    'created_at', now(),
    'case_id', v_case_id
  );
end
$$;

revoke all on function public.safety_create_report(text, text, text, text, text, uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.safety_create_report(text, text, text, text, text, uuid, jsonb, jsonb)
  to authenticated;
