-- 0100 — Yüksek riskli haberler için yetkili manuel yayın yolu
--
-- Otomatik yayın yalnızca risk A ile çalışır. C sınıfı haberler için
-- `admin_ai_news_review_action('approve')` bilinçli olarak kapalıdır. Ancak
-- hukuki/editoryal denetimini tamamlayan yetkili bir yönetici, gerekçe
-- yazarak haberi elle yayımlayabilmelidir. Bu RPC tek amaçlıdır; risk
-- seviyesini düşürmez ve otomatik yayın kurallarını gevşetmez.

create or replace function public.admin_ai_news_publish_high_risk(
  p_event_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_event public.ai_news_events%rowtype;
  v_result jsonb;
begin
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'legal_review_reason_required' using errcode = '22023';
  end if;

  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  if v_event.risk_level <> 'C' then
    raise exception 'not_high_risk' using errcode = '22023';
  end if;

  if v_event.status not in ('awaiting_review', 'verified', 'draft', 'media_checking', 'ready') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  if coalesce(v_event.conflict, false) then
    raise exception 'source_conflict' using errcode = '22023';
  end if;

  v_result := public.ai_news_publish_event(p_event_id, 'manual', v_admin);

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    v_admin,
    'news.publish.high_risk',
    'ai_news_event',
    p_event_id::text,
    jsonb_build_object('reason', v_reason, 'result', v_result)
  );

  perform public.tz_admin_audit(
    'news.publish.high_risk',
    'Yüksek riskli AI haber hukuki denetim gerekçesiyle yayımlandı',
    'ai_news_event',
    p_event_id::text,
    jsonb_build_object('reason', v_reason),
    'success'
  );

  return jsonb_build_object('ok', true, 'result', v_result);
end;
$$;

revoke all on function public.admin_ai_news_publish_high_risk(uuid, text) from public, anon;
grant execute on function public.admin_ai_news_publish_high_risk(uuid, text) to authenticated, service_role;
