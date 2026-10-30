-- Maç olayı gizleme / geri açma denetim kaydı hem önceki hem sonraki durumu tutar.

create or replace function public.sports_admin_event_action(p_event uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('sports.data', true);
  v_reason text := public.sports_require_reason(p_reason);
  e public.sports_fixture_events;
  v_after public.sports_fixture_events;
begin
  select * into e from public.sports_fixture_events where id = p_event for update;
  if e.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_action = 'hide' then
    update public.sports_fixture_events set status = 'hidden', hidden_reason = v_reason where id = p_event
    returning * into v_after;
  elsif p_action = 'unhide' then
    update public.sports_fixture_events set status = 'active', hidden_reason = null, missing_count = 0 where id = p_event
    returning * into v_after;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  perform public.sports_audit(v_uid, 'event_' || p_action, 'event', p_event::text, v_reason,
                              public.sports_event_json(e) || jsonb_build_object('status', e.status),
                              public.sports_event_json(v_after) || jsonb_build_object('status', v_after.status));
  perform public.sports_broadcast(e.fixture_id, 'fixture');
  return public.sports_admin_fixture_get(e.fixture_id);
end;
$$;

revoke all on function public.sports_admin_event_action(uuid, text, text) from public, anon;
grant execute on function public.sports_admin_event_action(uuid, text, text) to authenticated;
