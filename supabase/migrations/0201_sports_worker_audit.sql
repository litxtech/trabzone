-- Trabzonspor Maç Arenası: sports-sync edge function admin işlemlerinin
-- yetki + gerekçe + denetim kaydı.
--
-- Edge function admin JWT'siyle bu fonksiyonu çağırır. Yetki yoksa veya
-- gerekçe eksikse istek sunucuda reddedilir; başarılı her çağrı denetim
-- kaydına yazılır. Salt okunur bağlantı testi gerekçe istemez.

create or replace function public.sports_admin_worker_authorize(
  p_permission text, p_action text, p_reason text default null, p_detail jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_reason text;
begin
  if p_permission not in ('sports.view', 'sports.manage', 'sports.data', 'sports.notify')
     or p_action not in ('test', 'run', 'resync', 'dispatch') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  v_uid := public.tz_admin_require(p_permission, p_permission = 'sports.manage');
  if p_action = 'test' then
    v_reason := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'API bağlantı testi');
  else
    v_reason := public.sports_require_reason(p_reason);
  end if;
  perform public.safety_check_rate('sports_worker_' || p_action, 30, interval '10 minutes');
  perform public.sports_audit(v_uid, 'worker_' || p_action, 'worker', p_action, v_reason, null,
                              coalesce(p_detail, '{}'::jsonb));
  return true;
end;
$$;

revoke all on function public.sports_admin_worker_authorize(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sports_admin_worker_authorize(text, text, text, jsonb) to authenticated;
