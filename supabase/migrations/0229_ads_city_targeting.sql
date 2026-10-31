-- 0229_ads_city_targeting.sql
-- Reklam hedeflemesini "enlem/boylam" yerine şehir + ilçe seçimine taşır.
-- Ek olarak reklamveren sihirbazı için hedef etiketlerini döndürür.
--
-- Geriye dönük uyumluluk:
--   * target_cities boş  -> tüm şehirler
--   * target_districts boş -> seçili şehirdeki tüm ilçeler
--   * ilçe hedefli eski kampanyalar otomatik olarak Trabzon'a bağlanır.

alter table public.ad_campaigns
  add column if not exists target_cities text[] not null default '{}';

alter table public.ad_serves
  add column if not exists city text;

-- Eski ilçe hedeflemeleri Trabzon ilçeleriyle çalışıyordu.
update public.ad_campaigns
set target_cities = array['Trabzon']
where cardinality(target_cities) = 0
  and cardinality(target_districts) > 0;

create index if not exists ad_campaigns_target_cities_idx
  on public.ad_campaigns using gin (target_cities);

-- ---------------------------------------------------------------------------
-- 1. Yardımcı: il/ilçe adlarını karşılaştırma biçimine getirir.
-- ---------------------------------------------------------------------------
create or replace function public.ad_province_ok(p text)
returns boolean
language sql
immutable
as $$
  select public.ad_fold(p) in (
    'adana','adiyaman','afyonkarahisar','agri','aksaray','amasya','ankara','antalya','ardahan','artvin',
    'aydin','balikesir','bartin','batman','bayburt','bilecik','bingol','bitlis','bolu','burdur','bursa',
    'canakkale','cankiri','corum','denizli','diyarbakir','duzce','edirne','elazig','erzincan','erzurum',
    'eskisehir','gaziantep','giresun','gumushane','hakkari','hatay','igdir','isparta','istanbul','izmir',
    'kahramanmaras','karabuk','karaman','kars','kastamonu','kayseri','kirikkale','kirklareli','kirsehir',
    'kilis','kocaeli','konya','kutahya','malatya','manisa','mardin','mersin','mugla','mus','nevsehir',
    'nigde','ordu','osmaniye','rize','sakarya','samsun','siirt','sinop','sivas','sanliurfa','sirnak',
    'tekirdag','tokat','trabzon','tunceli','usak','van','yalova','yozgat','zonguldak')
$$;

-- ---------------------------------------------------------------------------
-- 2. Teslimat: şehir + ilçe eşleşmesi
-- ---------------------------------------------------------------------------
create or replace function public.ad_serve(
  p_placement        text,
  p_platform         text,
  p_session_id       text,
  p_count            integer default 2,
  p_context_district text default null,
  p_exclude          uuid[] default '{}',
  p_last_campaign    uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  s public.ad_settings%rowtype;
  pl public.ad_placements%rowtype;
  v_first int; v_imin int; v_imax int; v_max_session int; v_max_daily int; v_repeat int;
  v_cfg jsonb;
  v_recent int; v_used_session int; v_used_daily int; v_n int;
  v_today date := public.ad_today();
  v_city_raw text;
  v_city text;
  v_district_raw text;
  v_district text;
  r record;
  v_ids uuid[] := '{}';
  v_left int[] := '{}';
  v_seq uuid[] := '{}';
  v_prev uuid := p_last_campaign;
  v_pick uuid;
  v_pick_left int;
  i int; j int; v_len int;
  v_serve uuid;
  v_out jsonb := '[]'::jsonb;
  v_fallback jsonb := null;
begin
  if v_uid is null then
    return jsonb_build_object('enabled', false, 'reason', 'auth_required', 'ads', '[]'::jsonb);
  end if;
  if p_platform is null or p_platform not in ('ios', 'android', 'web') then
    return jsonb_build_object('enabled', false, 'reason', 'platform_invalid', 'ads', '[]'::jsonb);
  end if;
  if p_session_id is null or p_session_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    return jsonb_build_object('enabled', false, 'reason', 'session_invalid', 'ads', '[]'::jsonb);
  end if;

  select * into s from public.ad_settings where id = 1;
  if not found or not s.ads_enabled then
    return jsonb_build_object('enabled', false, 'reason', 'global_off', 'ads', '[]'::jsonb);
  end if;

  select * into pl from public.ad_placements where key = p_placement;
  if not found then
    return jsonb_build_object('enabled', false, 'reason', 'placement_unknown', 'ads', '[]'::jsonb);
  end if;
  if not pl.enabled or pl.surface_status <> 'live' then
    return jsonb_build_object('enabled', false, 'reason', 'placement_off', 'ads', '[]'::jsonb);
  end if;
  if (pl.active_from is not null and pl.active_from > now())
     or (pl.active_until is not null and pl.active_until <= now()) then
    return jsonb_build_object('enabled', false, 'reason', 'placement_window', 'ads', '[]'::jsonb);
  end if;
  if not (p_platform = any(pl.platforms)) then
    return jsonb_build_object('enabled', false, 'reason', 'platform_off', 'ads', '[]'::jsonb);
  end if;

  v_first := public.ad_rule_clamp('first_after', pl.first_after);
  v_imin := public.ad_rule_clamp('interval_min', pl.interval_min);
  v_imax := greatest(v_imin, public.ad_rule_clamp('interval_max', pl.interval_max));
  v_max_session := public.ad_rule_clamp('max_per_session', pl.max_per_session);
  v_max_daily := public.ad_rule_clamp('max_daily_per_user', pl.max_daily_per_user);
  v_repeat := public.ad_rule_clamp('campaign_repeat_limit', pl.campaign_repeat_limit);
  v_cfg := jsonb_build_object(
    'first_after', v_first, 'interval_min', v_imin, 'interval_max', v_imax,
    'max_per_session', v_max_session, 'format', pl.format,
    'min_view_ms', greatest(1000, s.min_view_ms), 'min_visible_ratio', greatest(0.5, s.min_visible_ratio));

  if s.admob_enabled and pl.allow_admob_fallback
     and coalesce(s.admob_config #>> array['units', p_placement, p_platform], '') <> '' then
    v_fallback := jsonb_build_object(
      'provider', 'google_admob',
      'unit_id', s.admob_config #>> array['units', p_placement, p_platform]);
  end if;

  if not s.direct_enabled then
    return jsonb_build_object('enabled', true, 'config', v_cfg, 'ads', '[]'::jsonb, 'fallback', v_fallback);
  end if;

  select count(*) into v_recent from public.ad_serves
  where user_id = v_uid and served_at > now() - interval '1 minute';
  if v_recent >= 40 then
    perform public.ad_log_invalid('serve', 'rate_limited', v_uid, null, null);
    return jsonb_build_object('enabled', true, 'config', v_cfg, 'ads', '[]'::jsonb, 'reason', 'rate_limited');
  end if;

  select count(*) into v_used_session from public.ad_serves
  where user_id = v_uid and session_id = p_session_id and placement_key = p_placement;
  select count(*) into v_used_daily from public.ad_impressions
  where user_id = v_uid and placement_key = p_placement and day = v_today;

  v_n := least(greatest(coalesce(p_count, 1), 0), 6, v_max_session - v_used_session, v_max_daily - v_used_daily);
  if v_n <= 0 then
    return jsonb_build_object('enabled', true, 'config', v_cfg, 'ads', '[]'::jsonb, 'fallback', v_fallback,
      'reason', 'frequency_cap');
  end if;

  -- Şehir/ilçe: ekrandaki ilçe filtresi profile göre önceliklidir. Şehir
  -- bilgisi girilmemiş kullanıcılar Trabzon kabul edilir (uygulama varsayılanı).
  select nullif(btrim(city), ''), nullif(btrim(district), '')
  into v_city_raw, v_district_raw
  from public.profiles where id = v_uid;
  v_city_raw := coalesce(v_city_raw, 'Trabzon');
  v_district_raw := coalesce(nullif(btrim(left(p_context_district, 60)), ''), v_district_raw);
  v_city := public.ad_fold(v_city_raw);
  v_district := public.ad_fold(v_district_raw);

  for r in
    select c.id,
      v_repeat - (
        select count(*) from public.ad_serves x
        where x.user_id = v_uid and x.session_id = p_session_id
          and x.placement_key = p_placement and x.campaign_id = c.id) as repeat_left,
      -ln(greatest(random(), 1e-9)) / (
        c.priority::numeric * (1 + case
          when c.total_impression_cap is not null then 4 * greatest(0,
            extract(epoch from now() - c.starts_at) / greatest(1, extract(epoch from c.ends_at - c.starts_at))
            - c.impressions_total::numeric / c.total_impression_cap)
          else 0 end)) as k
    from public.ad_campaigns c
    join public.ad_creatives cr on cr.campaign_id = c.id
    join public.ad_campaign_placements cp on cp.campaign_id = c.id and cp.placement_key = p_placement
    join public.ad_advertisers a on a.id = c.advertiser_id and a.status = 'active'
    where c.source = 'trabzone_direct'
      and c.status in ('scheduled', 'active')
      and c.starts_at <= now() and c.ends_at > now()
      and p_platform = any(c.platforms)
      and c.priority >= pl.min_priority
      and cr.image_url is not null
      and not (c.id = any(coalesce(p_exclude, '{}'::uuid[])))
      and (cardinality(c.target_cities) = 0
           or v_city = any(select public.ad_fold(t) from unnest(c.target_cities) t))
      and (cardinality(c.target_districts) = 0
           or v_district = any(select public.ad_fold(t) from unnest(c.target_districts) t))
      and (c.total_impression_cap is null or c.impressions_total < c.total_impression_cap)
      and (c.budget_cents is null or c.spent_cents < c.budget_cents)
      and (c.daily_impression_cap is null or coalesce((
        select ds.impressions from public.ad_campaign_daily_stats ds
        where ds.campaign_id = c.id and ds.day = v_today), 0) < c.daily_impression_cap)
      and not exists (
        select 1 from public.ad_user_feedback f
        where f.user_id = v_uid and f.campaign_id = c.id and f.hidden_until > now())
      and (select count(*) from public.ad_impressions i
           where i.user_id = v_uid and i.day = v_today and i.campaign_id = c.id)
          < public.ad_rule_clamp('per_user_daily_cap', c.per_user_daily_cap)
      and public.ad_destination_check(c.id) is null
    order by k
    limit 12
  loop
    if r.repeat_left > 0 then
      v_ids := v_ids || r.id;
      v_left := v_left || r.repeat_left::int;
    end if;
  end loop;

  -- Sıra: aynı kampanya art arda gelmez; seçilen kampanya kuyruğun sonuna
  -- taşınarak öncelik sırasına göre dönüşümlü dağıtım yapılır.
  for i in 1..v_n loop
    v_pick := null;
    v_len := coalesce(array_length(v_ids, 1), 0);
    for j in 1..v_len loop
      if v_left[j] > 0 and (v_prev is null or v_ids[j] <> v_prev) then
        v_pick := v_ids[j];
        v_pick_left := v_left[j] - 1;
        v_ids := v_ids[1:j-1] || v_ids[j+1:v_len] || v_pick;
        v_left := v_left[1:j-1] || v_left[j+1:v_len] || v_pick_left;
        exit;
      end if;
    end loop;
    exit when v_pick is null;
    v_seq := v_seq || v_pick;
    v_prev := v_pick;
  end loop;

  foreach v_pick in array v_seq loop
    insert into public.ad_serves (campaign_id, placement_key, user_id, session_id, platform, district, city)
    values (v_pick, p_placement, v_uid, p_session_id, p_platform, v_district_raw, v_city_raw)
    returning id into v_serve;

    v_out := v_out || jsonb_build_array((
      select jsonb_build_object(
        'serve_id', v_serve,
        'campaign_id', c.id,
        'source', c.source,
        'advertiser_name', a.name,
        'title', cr.title,
        'description', cr.description,
        'cta_label', cr.cta_label,
        'business_name', cr.business_name,
        'image_url', cr.image_url,
        'mobile_image_url', cr.mobile_image_url,
        'web_image_url', cr.web_image_url,
        'image_focus', cr.image_focus,
        'destination', public.ad_destination_json(c.id))
      from public.ad_campaigns c
      join public.ad_creatives cr on cr.campaign_id = c.id
      join public.ad_advertisers a on a.id = c.advertiser_id
      where c.id = v_pick));
  end loop;

  return jsonb_build_object('enabled', true, 'config', v_cfg, 'ads', v_out, 'fallback', v_fallback);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Yönetici: kampanya listesi (şehir hedefleriyle)
-- ---------------------------------------------------------------------------
create or replace function public.admin_ads_campaigns_list(
  p_status text default null, p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.tz_admin_require('ads.view');
  perform public.ads_sync_campaign_statuses();
  return jsonb_build_object(
    'total', (select count(*) from public.ad_campaigns c join public.ad_advertisers a on a.id = c.advertiser_id
              where (p_status is null or c.status = p_status)
                and (v_q is null or c.name ilike '%' || v_q || '%' or a.name ilike '%' || v_q || '%')),
    'limit', p_limit, 'offset', p_offset,
    'counts', coalesce((select jsonb_object_agg(status, n) from (
                select status, count(*) n from public.ad_campaigns group by status) x), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(row_data order by sort_key desc)
      from (
        select c.updated_at as sort_key, jsonb_build_object(
          'id', c.id, 'name', c.name, 'status', c.status, 'priority', c.priority,
          'campaign_type', c.campaign_type, 'policy_category', c.policy_category, 'source', c.source,
          'starts_at', c.starts_at, 'ends_at', c.ends_at,
          'advertiser_id', a.id, 'advertiser_name', a.name,
          'title', cr.title, 'image_url', cr.image_url,
          'destination_type', d.type, 'destination_valid', d.is_valid, 'destination_reason', d.invalid_reason,
          'impressions', c.impressions_total, 'clicks', c.clicks_total,
          'ctr', case when c.impressions_total > 0 then round(c.clicks_total::numeric * 100 / c.impressions_total, 2) else 0 end,
          'spent_cents', round(c.spent_cents), 'budget_cents', c.budget_cents,
          'total_impression_cap', c.total_impression_cap,
          'target_cities', c.target_cities,
          'target_districts', c.target_districts,
          'placements', coalesce((select jsonb_agg(cp.placement_key) from public.ad_campaign_placements cp where cp.campaign_id = c.id), '[]'::jsonb),
          'reports', (select count(*) from public.ad_user_feedback f where f.campaign_id = c.id and f.kind = 'report'),
          'updated_at', c.updated_at) as row_data
        from public.ad_campaigns c
        join public.ad_advertisers a on a.id = c.advertiser_id
        left join public.ad_creatives cr on cr.campaign_id = c.id
        left join public.ad_target_destinations d on d.campaign_id = c.id
        where (p_status is null or c.status = p_status)
          and (v_q is null or c.name ilike '%' || v_q || '%' or a.name ilike '%' || v_q || '%')
        order by c.updated_at desc
        limit greatest(1, least(coalesce(p_limit, 25), 200)) offset greatest(0, coalesce(p_offset, 0))
      ) s), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Yönetici: kampanya kaydet (şehir hedefleri dahil)
-- ---------------------------------------------------------------------------
create or replace function public.admin_ads_campaign_save(p_id uuid, p_payload jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.tz_admin_require('ads.manage');
  v_id uuid := p_id;
  v_existing public.ad_campaigns%rowtype;
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_policy text := coalesce(nullif(p_payload ->> 'policy_category', ''), 'general');
  v_type text := coalesce(nullif(p_payload ->> 'campaign_type', ''), 'business_promo');
  v_start timestamptz := (p_payload ->> 'starts_at')::timestamptz;
  v_end timestamptz := (p_payload ->> 'ends_at')::timestamptz;
  v_adv uuid;
  v_platforms text[];
  v_cities text[];
  v_districts text[];
  v_placements text[];
  v_status text;
  v_cr jsonb := coalesce(p_payload -> 'creative', '{}'::jsonb);
  v_dest jsonb := coalesce(p_payload -> 'destination', '{}'::jsonb);
  v_detail jsonb := p_payload -> 'detail';
  v_dest_type text;
  v_url text;
  v_gallery text[];
  v_features text[];
  v_media text;
begin
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'ad_name_invalid' using errcode = '22023';
  end if;
  if public.ad_policy_prohibited(v_policy) then
    raise exception 'ad_policy_prohibited' using errcode = '22023';
  end if;
  if not public.ad_policy_category_ok(v_policy) then
    raise exception 'ad_policy_category_invalid' using errcode = '22023';
  end if;
  if v_start is null or v_end is null or v_end <= v_start then
    raise exception 'dates_invalid' using errcode = '22023';
  end if;
  if not public.ad_is_uuid(p_payload ->> 'advertiser_id') then
    raise exception 'ad_advertiser_not_found' using errcode = 'P0002';
  end if;
  select id into v_adv from public.ad_advertisers where id = (p_payload ->> 'advertiser_id')::uuid;
  if v_adv is null then
    raise exception 'ad_advertiser_not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_platforms
  from jsonb_array_elements_text(coalesce(p_payload -> 'platforms', '["ios","android","web"]'::jsonb)) x
  where x in ('ios', 'android', 'web');

  -- Şehir hedefi: yalnızca bilinen il adları kabul edilir.
  select coalesce(array_agg(distinct left(btrim(x), 60)) filter (where btrim(x) <> ''), '{}') into v_cities
  from jsonb_array_elements_text(coalesce(p_payload -> 'target_cities', '[]'::jsonb)) x;
  if cardinality(v_cities) > 0 and exists (select 1 from unnest(v_cities) c where not public.ad_province_ok(c)) then
    raise exception 'ad_city_invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct left(btrim(x), 40)) filter (where btrim(x) <> ''), '{}') into v_districts
  from jsonb_array_elements_text(coalesce(p_payload -> 'target_districts', '[]'::jsonb)) x;

  -- İlçe seçildiyse şehir alanı boş bırakılamaz (eski istemciler için Trabzon).
  if cardinality(v_cities) = 0 and cardinality(v_districts) > 0 then
    v_cities := array['Trabzon'];
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_placements
  from jsonb_array_elements_text(coalesce(p_payload -> 'placements', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_placements) k where not exists (select 1 from public.ad_placements p where p.key = k)) then
    raise exception 'ad_placement_not_found' using errcode = 'P0002';
  end if;

  foreach v_media in array array[v_cr ->> 'image_url', v_cr ->> 'mobile_image_url', v_cr ->> 'web_image_url', v_cr ->> 'video_url',
                                 v_detail ->> 'cover_url', v_detail ->> 'video_url'] loop
    if nullif(btrim(coalesce(v_media, '')), '') is not null and not public.ad_media_url_ok(btrim(v_media)) then
      raise exception 'ad_media_url_invalid' using errcode = '22023';
    end if;
  end loop;

  v_dest_type := coalesce(nullif(v_dest ->> 'type', ''), 'detail_page');
  if v_dest_type not in ('detail_page', 'business', 'market_listing', 'real_estate', 'vehicle', 'job', 'ride',
                         'post', 'category', 'external_url', 'phone', 'map_location') then
    raise exception 'ad_destination_invalid' using errcode = '22023';
  end if;
  v_url := nullif(btrim(coalesce(v_dest ->> 'url', '')), '');
  if v_dest_type = 'external_url' and public.ad_url_check(v_url) is not null then
    raise exception 'ad_url_invalid' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_existing from public.ad_campaigns where id = p_id for update;
    if not found then
      raise exception 'ad_campaign_not_found' using errcode = 'P0002';
    end if;
    if v_existing.status in ('expired', 'archived') then
      raise exception 'ad_campaign_locked' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    insert into public.ad_campaigns (advertiser_id, name, campaign_type, policy_category, priority, starts_at, ends_at,
      daily_impression_cap, total_impression_cap, per_user_daily_cap, budget_cents, cpm_cents,
      target_cities, target_districts, platforms, status, created_by, updated_by)
    values (v_adv, v_name, v_type, v_policy,
      greatest(1, least(10, coalesce((p_payload ->> 'priority')::int, 5))), v_start, v_end,
      nullif((p_payload ->> 'daily_impression_cap')::int, 0), nullif((p_payload ->> 'total_impression_cap')::int, 0),
      public.ad_rule_clamp('per_user_daily_cap', (p_payload ->> 'per_user_daily_cap')::int),
      nullif((p_payload ->> 'budget_cents')::bigint, 0), nullif((p_payload ->> 'cpm_cents')::int, 0),
      v_cities, v_districts, v_platforms, 'draft', v_admin, v_admin)
    returning id into v_id;
    v_status := 'draft';
  else
    -- Onaylı bir kampanyanın içeriği onay yetkisi olmayan biri tarafından
    -- değiştirilirse yeniden incelemeye düşer: onaysız içerik yayına çıkmaz.
    v_status := case
      when v_existing.status in ('scheduled', 'active', 'paused') and not public.has_permission('ads.approve')
        then 'pending_review'
      else v_existing.status end;
    update public.ad_campaigns set
      advertiser_id = v_adv, name = v_name, campaign_type = v_type, policy_category = v_policy,
      priority = greatest(1, least(10, coalesce((p_payload ->> 'priority')::int, priority))),
      starts_at = v_start, ends_at = v_end,
      daily_impression_cap = nullif((p_payload ->> 'daily_impression_cap')::int, 0),
      total_impression_cap = nullif((p_payload ->> 'total_impression_cap')::int, 0),
      per_user_daily_cap = public.ad_rule_clamp('per_user_daily_cap', (p_payload ->> 'per_user_daily_cap')::int),
      budget_cents = nullif((p_payload ->> 'budget_cents')::bigint, 0),
      cpm_cents = nullif((p_payload ->> 'cpm_cents')::int, 0),
      target_cities = v_cities, target_districts = v_districts, platforms = v_platforms,
      status = v_status,
      status_changed_at = case when v_status <> v_existing.status then now() else status_changed_at end,
      updated_by = v_admin, updated_at = now()
    where id = v_id;
  end if;

  insert into public.ad_creatives (campaign_id, title, description, cta_label, business_name, image_url,
                                   mobile_image_url, web_image_url, video_url, image_focus, updated_at)
  values (v_id, left(btrim(coalesce(v_cr ->> 'title', '')), 120),
    left(nullif(btrim(coalesce(v_cr ->> 'description', '')), ''), 200),
    left(coalesce(nullif(btrim(coalesce(v_cr ->> 'cta_label', '')), ''), 'İncele'), 24),
    left(nullif(btrim(coalesce(v_cr ->> 'business_name', '')), ''), 60),
    nullif(btrim(coalesce(v_cr ->> 'image_url', '')), ''),
    nullif(btrim(coalesce(v_cr ->> 'mobile_image_url', '')), ''),
    nullif(btrim(coalesce(v_cr ->> 'web_image_url', '')), ''),
    nullif(btrim(coalesce(v_cr ->> 'video_url', '')), ''),
    case when v_cr ->> 'image_focus' in ('left', 'center', 'right') then v_cr ->> 'image_focus' else 'center' end,
    now())
  on conflict (campaign_id) do update set
    title = excluded.title, description = excluded.description, cta_label = excluded.cta_label,
    business_name = excluded.business_name, image_url = excluded.image_url,
    mobile_image_url = excluded.mobile_image_url, web_image_url = excluded.web_image_url,
    video_url = excluded.video_url, image_focus = excluded.image_focus, updated_at = now();

  insert into public.ad_target_destinations (campaign_id, type, target_id, url, phone, lat, lng, label)
  values (v_id, v_dest_type, nullif(btrim(coalesce(v_dest ->> 'target_id', '')), ''), v_url,
    nullif(regexp_replace(coalesce(v_dest ->> 'phone', ''), '[^0-9+]', '', 'g'), ''),
    (v_dest ->> 'lat')::double precision, (v_dest ->> 'lng')::double precision,
    left(nullif(btrim(coalesce(v_dest ->> 'label', '')), ''), 80))
  on conflict (campaign_id) do update set
    type = excluded.type, target_id = excluded.target_id, url = excluded.url, phone = excluded.phone,
    lat = excluded.lat, lng = excluded.lng, label = excluded.label, checked_at = null;

  update public.ad_target_destinations
  set is_valid = public.ad_destination_check(v_id) is null,
      invalid_reason = public.ad_destination_check(v_id), checked_at = now()
  where campaign_id = v_id;

  if v_detail is not null and jsonb_typeof(v_detail) = 'object' then
    select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into v_gallery
    from jsonb_array_elements_text(coalesce(v_detail -> 'gallery', '[]'::jsonb)) x;
    if exists (select 1 from unnest(v_gallery) g where not public.ad_media_url_ok(g)) or cardinality(v_gallery) > 12 then
      raise exception 'ad_media_url_invalid' using errcode = '22023';
    end if;
    select coalesce(array_agg(left(btrim(x), 120)) filter (where btrim(x) <> ''), '{}') into v_features
    from jsonb_array_elements_text(coalesce(v_detail -> 'features', '[]'::jsonb)) x;
    if nullif(btrim(coalesce(v_detail ->> 'website', '')), '') is not null
       and public.ad_url_check(btrim(v_detail ->> 'website')) is not null then
      raise exception 'ad_url_invalid' using errcode = '22023';
    end if;

    insert into public.ad_detail_pages (campaign_id, enabled, headline, cover_url, gallery, video_url, body, features,
      price_text, offer_text, address, lat, lng, phone, email, website, valid_until, place_id, listing_type, listing_id, updated_at)
    values (v_id, coalesce((v_detail ->> 'enabled')::boolean, true),
      left(nullif(btrim(coalesce(v_detail ->> 'headline', '')), ''), 140),
      nullif(btrim(coalesce(v_detail ->> 'cover_url', '')), ''), v_gallery,
      nullif(btrim(coalesce(v_detail ->> 'video_url', '')), ''),
      left(nullif(btrim(coalesce(v_detail ->> 'body', '')), ''), 5000), v_features[1:20],
      left(nullif(btrim(coalesce(v_detail ->> 'price_text', '')), ''), 80),
      left(nullif(btrim(coalesce(v_detail ->> 'offer_text', '')), ''), 200),
      left(nullif(btrim(coalesce(v_detail ->> 'address', '')), ''), 240),
      (v_detail ->> 'lat')::double precision, (v_detail ->> 'lng')::double precision,
      nullif(regexp_replace(coalesce(v_detail ->> 'phone', ''), '[^0-9+]', '', 'g'), ''),
      nullif(btrim(coalesce(v_detail ->> 'email', '')), ''),
      nullif(btrim(coalesce(v_detail ->> 'website', '')), ''),
      (v_detail ->> 'valid_until')::timestamptz,
      case when public.ad_is_uuid(v_detail ->> 'place_id') then (v_detail ->> 'place_id')::uuid end,
      case when v_detail ->> 'listing_type' in ('market_listing', 'real_estate') and public.ad_is_uuid(v_detail ->> 'listing_id')
           then v_detail ->> 'listing_type' end,
      case when v_detail ->> 'listing_type' in ('market_listing', 'real_estate') and public.ad_is_uuid(v_detail ->> 'listing_id')
           then (v_detail ->> 'listing_id')::uuid end,
      now())
    on conflict (campaign_id) do update set
      enabled = excluded.enabled, headline = excluded.headline, cover_url = excluded.cover_url,
      gallery = excluded.gallery, video_url = excluded.video_url, body = excluded.body,
      features = excluded.features, price_text = excluded.price_text, offer_text = excluded.offer_text,
      address = excluded.address, lat = excluded.lat, lng = excluded.lng, phone = excluded.phone,
      email = excluded.email, website = excluded.website, valid_until = excluded.valid_until,
      place_id = excluded.place_id, listing_type = excluded.listing_type, listing_id = excluded.listing_id,
      updated_at = now();
    update public.ad_target_destinations
    set is_valid = public.ad_destination_check(v_id) is null,
        invalid_reason = public.ad_destination_check(v_id), checked_at = now()
    where campaign_id = v_id;
  end if;

  delete from public.ad_campaign_placements where campaign_id = v_id and not (placement_key = any(v_placements));
  insert into public.ad_campaign_placements (campaign_id, placement_key)
  select v_id, k from unnest(v_placements) k
  on conflict do nothing;

  perform public.tz_admin_audit(case when p_id is null then 'ads.campaign.create' else 'ads.campaign.update' end,
    case when p_id is null then 'Reklam kampanyası oluşturuldu' else 'Reklam kampanyası güncellendi' end,
    'ad_campaign', v_id::text,
    jsonb_build_object('name', v_name, 'status', v_status,
                       'cities', to_jsonb(v_cities), 'districts', to_jsonb(v_districts),
                       'from', case when p_id is not null then v_existing.status end,
                       'reason', nullif(btrim(coalesce(p_reason, '')), '')), 'success');

  return public.admin_ads_campaign_get(v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Yönetici: hedefleme özeti (şehir kırılımı)
-- ---------------------------------------------------------------------------
create or replace function public.admin_ads_targeting_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.tz_admin_require('ads.view');
  return jsonb_build_object(
    'profile_districts', coalesce((
      select jsonb_agg(jsonb_build_object('district', district, 'users', n) order by n desc)
      from (select btrim(district) district, count(*) n from public.profiles
            where nullif(btrim(district), '') is not null group by 1) x), '[]'::jsonb),
    'profile_cities', coalesce((
      select jsonb_agg(jsonb_build_object('city', city, 'users', n) order by n desc)
      from (select coalesce(nullif(btrim(city), ''), 'Trabzon') city, count(*) n from public.profiles
            group by 1) x), '[]'::jsonb),
    'users_without_district', (select count(*) from public.profiles where nullif(btrim(coalesce(district, '')), '') is null),
    'users_without_city', (select count(*) from public.profiles where nullif(btrim(coalesce(city, '')), '') is null),
    'campaign_targets', coalesce((
      select jsonb_agg(jsonb_build_object('district', d, 'campaigns', n) order by n desc)
      from (select t d, count(*) n from public.ad_campaigns c, unnest(c.target_districts) t
            where c.status in ('pending_review', 'scheduled', 'active', 'paused') group by 1) x), '[]'::jsonb),
    'campaign_city_targets', coalesce((
      select jsonb_agg(jsonb_build_object('city', d, 'campaigns', n) order by n desc)
      from (select t d, count(*) n from public.ad_campaigns c, unnest(c.target_cities) t
            where c.status in ('pending_review', 'scheduled', 'active', 'paused') group by 1) x), '[]'::jsonb),
    'untargeted_campaigns', (select count(*) from public.ad_campaigns
                             where cardinality(target_districts) = 0 and status in ('scheduled', 'active', 'paused')),
    'untargeted_city_campaigns', (select count(*) from public.ad_campaigns
                                  where cardinality(target_cities) = 0 and status in ('scheduled', 'active', 'paused')),
    'impressions_by_district_30d', coalesce((
      select jsonb_agg(jsonb_build_object('district', d, 'impressions', n) order by n desc)
      from (select coalesce(district, 'Belirtilmemiş') d, count(*) n from public.ad_impressions
            where day > public.ad_today() - 30 group by 1) x), '[]'::jsonb),
    'impressions_by_city_30d', coalesce((
      select jsonb_agg(jsonb_build_object('city', d, 'impressions', n) order by n desc)
      from (select coalesce(s.city, 'Belirtilmemiş') d, count(*) n
            from public.ad_impressions i
            join public.ad_serves s on s.id = i.serve_id
            where i.day > public.ad_today() - 30 group by 1) x), '[]'::jsonb));
end;
$$;

grant execute on function public.ad_province_ok(text) to authenticated;
