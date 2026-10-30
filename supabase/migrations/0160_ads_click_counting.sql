-- ---------------------------------------------------------------------------
-- 0160: Tıklama sayımı görünürlük kapısından ayrılır.
--
-- Önceki davranış: kullanıcı reklamı 1 saniyeden kısa süre gördüyse tıklaması
-- hiç sayılmıyordu (`no_valid_impression`). Banner'a dokunmak görünürlüğün en
-- güçlü kanıtı olduğu için tıklama artık geçerli sunum + aktif kampanya +
-- sunum ömrü koşullarıyla kaydedilir; gösterim ise yalnızca gerçek görünürlük
-- eşiği (en az %50, en az 1 sn) karşılandığında sayılmaya devam eder.
-- Gösterim/limit/bütçe muhasebesi değişmez; yalnızca tıklama metriği doğrulanır.
-- ---------------------------------------------------------------------------
create or replace function public.ad_record_click(p_serve_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v public.ad_serves%rowtype;
  s public.ad_settings%rowtype;
  c public.ad_campaigns%rowtype;
  v_recent int;
begin
  if v_uid is null then
    return jsonb_build_object('counted', false, 'reason', 'auth_required');
  end if;
  select * into v from public.ad_serves where id = p_serve_id and user_id = v_uid for update;
  if not found then
    perform public.ad_log_invalid('click', 'serve_not_found', v_uid, p_serve_id, null);
    return jsonb_build_object('counted', false, 'reason', 'serve_not_found');
  end if;
  if v.clicked_at is not null then
    return jsonb_build_object('counted', false, 'reason', 'duplicate', 'already', true);
  end if;

  select * into s from public.ad_settings where id = 1;

  if now() - v.served_at > make_interval(mins => s.serve_ttl_minutes) then
    perform public.ad_log_invalid('click', 'serve_expired', v_uid, p_serve_id, v.campaign_id);
    return jsonb_build_object('counted', false, 'reason', 'serve_expired');
  end if;

  select * into c from public.ad_campaigns where id = v.campaign_id;
  if c.id is null or c.status not in ('scheduled', 'active')
     or c.starts_at > now() or c.ends_at <= now() then
    perform public.ad_log_invalid('click', 'campaign_inactive', v_uid, p_serve_id, v.campaign_id);
    return jsonb_build_object('counted', false, 'reason', 'campaign_inactive');
  end if;

  select count(*) into v_recent from public.ad_clicks
  where user_id = v_uid and created_at > now() - interval '1 minute';
  if v_recent >= s.click_rate_limit_per_minute then
    perform public.ad_log_invalid('click', 'rate_limited', v_uid, p_serve_id, v.campaign_id);
    return jsonb_build_object('counted', false, 'reason', 'rate_limited');
  end if;

  -- Gösterim yalnızca eşik karşılanıyorsa sayılır; karşılanmıyorsa tıklama
  -- yine kaydedilir ve `impression_at` boş kalır (CTR tıklama/geçerli gösterim).
  if v.impression_at is null then
    perform public.ad_impression_internal(p_serve_id, v_uid, greatest(1000, s.min_view_ms));
  end if;

  insert into public.ad_clicks (serve_id, campaign_id, placement_key, user_id, platform, district)
  values (v.id, v.campaign_id, v.placement_key, v_uid, v.platform, v.district);

  insert into public.ad_campaign_daily_stats as ds (campaign_id, day, clicks)
  values (v.campaign_id, public.ad_today(), 1)
  on conflict (campaign_id, day) do update set clicks = ds.clicks + 1;

  update public.ad_campaigns set clicks_total = clicks_total + 1 where id = v.campaign_id;
  update public.ad_serves set clicked_at = now() where id = v.id;

  return jsonb_build_object('counted', true);
end;
$$;

revoke all on function public.ad_record_click(uuid) from public, anon;
grant execute on function public.ad_record_click(uuid) to authenticated;
