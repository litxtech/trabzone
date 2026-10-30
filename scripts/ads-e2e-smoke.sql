-- Reklam merkezi uçtan uca duman testi. Tamamı geri alınan bir işlemde çalışır.
-- Yönetici: 9716b5e8 (admin) · Kullanıcı 1: 45640e53 · Kullanıcı 2: fab85a17
-- Not: İşlem içinde now() sabittir; görünürlük süresi `served_at` geriye
-- çekilerek taklit edilir.
begin;

create temp table _t (n serial, name text, ok boolean, detail text) on commit drop;
create temp table _s (k text primary key, v jsonb) on commit drop;

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null) returns void language sql as $$
  insert into _t (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;
create function pg_temp.sv(p_key text) returns jsonb language sql as $$ select v from _s where k = p_key $$;
create function pg_temp.put(p_key text, p_val jsonb) returns void language sql as $$
  insert into _s (k, v) values (p_key, p_val) on conflict (k) do update set v = excluded.v;
$$;
create function pg_temp.backdate(p_serve uuid, p_secs int) returns void language sql as $$
  update public.ad_serves set served_at = now() - make_interval(secs => p_secs) where id = p_serve;
$$;
create function pg_temp.camp_payload(p_adv text, p_name text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'advertiser_id', p_adv, 'name', p_name, 'policy_category', 'tourism', 'priority', 5,
    'starts_at', now() - interval '1 hour', 'ends_at', now() + interval '2 days',
    'placements', '["feed_home"]'::jsonb,
    'creative', jsonb_build_object('title', p_name || ' başlık', 'description', 'Kısa açıklama',
                                   'image_url', 'https://example.com/' || md5(p_name) || '.jpg', 'cta_label', 'İncele'),
    'destination', '{"type":"detail_page"}'::jsonb,
    'detail', '{"headline":"Detay","body":"Gövde","features":["Özellik"],"gallery":["https://example.com/g1.jpg"]}'::jsonb
  ) || coalesce(p_extra, '{}'::jsonb);
$$;

update public.profiles set district = 'Akçaabat' where id = '45640e53-dee5-44d4-a5e4-5ce8cd1140c9';
update public.profiles set district = 'Yomra' where id = 'fab85a17-70d9-48e0-adcf-4014b44f199f';

-- 1. Global kapalıyken hiçbir reklam sunulmaz -------------------------------
select pg_temp.as_user('45640e53-dee5-44d4-a5e4-5ce8cd1140c9');
select pg_temp.chk('01 global kapalı: sunum yok',
  public.ad_serve('feed_home', 'ios', 'sess-u1-global0', 2) ->> 'reason' = 'global_off');

-- 22. Yönetici olmayan admin RPC çağıramaz ----------------------------------
do $$ begin
  perform public.admin_ads_overview();
  perform pg_temp.chk('22a normal kullanıcı admin RPC çağıramaz', false);
exception when others then
  perform pg_temp.chk('22a normal kullanıcı admin RPC çağıramaz', sqlerrm = 'insufficient_privilege', sqlerrm);
end $$;

-- Yönetici: reklamveren + kampanyalar --------------------------------------
select pg_temp.as_user('9716b5e8-f794-4a79-a2f4-0d32f62a60c0');
select pg_temp.put('adv', public.admin_ads_advertiser_save(null,
  '{"name":"Smoke Otel","website":"https://example.com","contact_email":"info@example.com"}'::jsonb, 'smoke'));

-- A: detay sayfası hedefi, ana akış + marketplace
select pg_temp.put('A', public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'Kampanya A',
  '{"placements":["feed_home","marketplace_home"]}'::jsonb), 'smoke'));
select pg_temp.chk('08a yeni kampanya taslak', pg_temp.sv('A') ->> 'status' = 'draft');
select pg_temp.chk('08b eksiksiz kampanyada doğrulama sorunu yok', pg_temp.sv('A') -> 'issues' = '[]'::jsonb, (pg_temp.sv('A') -> 'issues')::text);

-- B: işletme profili hedefi
select pg_temp.put('B', public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'Kampanya B',
  jsonb_build_object('destination', jsonb_build_object('type', 'business', 'target_id',
    (select id from public.places where status = 'published' limit 1)))), 'smoke'));
-- C: yalnızca Yomra + harici güvenli URL
select pg_temp.put('C', public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'Kampanya C',
  '{"target_districts":["Yomra"],"destination":{"type":"external_url","url":"https://example.com/kampanya"}}'::jsonb), 'smoke'));
-- D: marketplace ilanı hedefi
select pg_temp.put('D', public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'Kampanya D',
  jsonb_build_object('placements', '["marketplace_category"]'::jsonb, 'destination', jsonb_build_object('type', 'market_listing', 'target_id',
    (select id from public.marketplace_listings where status = 'active' and moderation_status = 'visible' limit 1)))), 'smoke'));
-- F: gelecekte başlayacak
select pg_temp.put('F', public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'Kampanya F',
  jsonb_build_object('starts_at', now() + interval '1 hour', 'placements', '["ride_list"]'::jsonb)), 'smoke'));

-- Politika / güvenlik doğrulamaları
do $$ begin
  perform public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'Kumar',
    '{"policy_category":"gambling"}'::jsonb), 'smoke');
  perform pg_temp.chk('17 yasaklı kategori reddedilir', false);
exception when others then
  perform pg_temp.chk('17 yasaklı kategori reddedilir', sqlerrm = 'ad_policy_prohibited', sqlerrm);
end $$;
do $$ begin
  perform public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'JS',
    '{"destination":{"type":"external_url","url":"javascript:alert(1)"}}'::jsonb), 'smoke');
  perform pg_temp.chk('14a javascript: şeması engellenir', false);
exception when others then
  perform pg_temp.chk('14a javascript: şeması engellenir', sqlerrm = 'ad_url_invalid', sqlerrm);
end $$;
do $$ begin
  perform public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'HTTP',
    '{"destination":{"type":"external_url","url":"http://example.com"}}'::jsonb), 'smoke');
  perform pg_temp.chk('14b http (güvensiz) engellenir', false);
exception when others then
  perform pg_temp.chk('14b http (güvensiz) engellenir', sqlerrm = 'ad_url_invalid', sqlerrm);
end $$;
do $$ begin
  perform public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'Cred',
    '{"destination":{"type":"external_url","url":"https://trabzoneapp.com@evil.example/x"}}'::jsonb), 'smoke');
  perform pg_temp.chk('14c kimlik bilgili URL (açık yönlendirme) engellenir', false);
exception when others then
  perform pg_temp.chk('14c kimlik bilgili URL (açık yönlendirme) engellenir', sqlerrm = 'ad_url_invalid', sqlerrm);
end $$;

-- 15. Kırık hedef: olmayan gönderi -> incelemeye gönderilemez
select pg_temp.put('E', public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'Kampanya E',
  '{"destination":{"type":"post","target_id":"00000000-0000-4000-8000-000000000000"}}'::jsonb), 'smoke'));
do $$ begin
  perform public.admin_ads_campaign_transition((pg_temp.sv('E') ->> 'id')::uuid, 'submit', null);
  perform pg_temp.chk('15a kırık hedefli kampanya yayına gönderilemez', false);
exception when others then
  perform pg_temp.chk('15a kırık hedefli kampanya yayına gönderilemez', sqlerrm like 'ad_campaign_incomplete%destination_target_unavailable%', sqlerrm);
end $$;

-- Onaysız yayın yok: taslak doğrudan onaylanamaz
do $$ begin
  perform public.admin_ads_campaign_transition((pg_temp.sv('A') ->> 'id')::uuid, 'approve', null);
  perform pg_temp.chk('09a taslak doğrudan onaylanamaz', false);
exception when others then
  perform pg_temp.chk('09a taslak doğrudan onaylanamaz', sqlerrm = 'ad_transition_invalid', sqlerrm);
end $$;

-- Gönder + onayla
select public.admin_ads_campaign_transition((pg_temp.sv(k) ->> 'id')::uuid, 'submit', null) from unnest(array['A','B','C','D','F']) k;
select pg_temp.put('A', public.admin_ads_campaign_transition((pg_temp.sv('A') ->> 'id')::uuid, 'approve', 'smoke onay'));
select public.admin_ads_campaign_transition((pg_temp.sv(k) ->> 'id')::uuid, 'approve', 'smoke onay') from unnest(array['B','C','D']) k;
select pg_temp.put('F', public.admin_ads_campaign_transition((pg_temp.sv('F') ->> 'id')::uuid, 'approve', 'smoke onay'));
select pg_temp.chk('09b onay sonrası başlamış kampanya aktif', pg_temp.sv('A') ->> 'status' = 'active');
select pg_temp.chk('06a başlangıcı gelecekte olan kampanya planlandı', pg_temp.sv('F') ->> 'status' = 'scheduled');

-- Yerleşimler: ana akış açık, marketplace kapalı, ride açık; güvenli sınır
select pg_temp.put('pl', public.admin_ads_placement_update('feed_home', '{"enabled":true,"first_after":1,"interval_min":8,"interval_max":12}'::jsonb, 'smoke'));
select pg_temp.chk('05 güvenli alt sınır uygulanır (first_after 1 -> 5)',
  (pg_temp.sv('pl') -> 'placement' ->> 'first_after')::int = 5
  and jsonb_array_length(pg_temp.sv('pl') -> 'adjustments') = 1, (pg_temp.sv('pl') -> 'adjustments')::text);
select public.admin_ads_placement_update('marketplace_home', '{"enabled":false}'::jsonb, 'smoke');
select public.admin_ads_placement_update('ride_list', '{"enabled":true}'::jsonb, 'smoke');
select public.admin_ads_placement_update('marketplace_category', '{"enabled":true}'::jsonb, 'smoke');
do $$ begin
  perform public.admin_ads_placement_update('reels_feed', '{"format":"glass_banner"}'::jsonb, 'smoke');
  perform pg_temp.chk('04 reels yatay banner formatını kabul etmez', false);
exception when others then
  perform pg_temp.chk('04 reels yatay banner formatını kabul etmez', sqlerrm = 'ad_format_unsupported', sqlerrm);
end $$;

-- Global aç (yalnızca ayarlar yetkisi)
select public.admin_ads_global_set(true, 'smoke açılış');

-- 2/5/18. Ana akış sunumu ----------------------------------------------------
select pg_temp.as_user('45640e53-dee5-44d4-a5e4-5ce8cd1140c9');
select pg_temp.put('s1', public.ad_serve('feed_home', 'ios', 'sess-u1-feed001', 3));
select pg_temp.chk('02 ana akış açıkken reklam sunulur', jsonb_array_length(pg_temp.sv('s1') -> 'ads') = 3, (pg_temp.sv('s1') -> 'ads')::text);
select pg_temp.chk('05b Akçaabat kullanıcısı Yomra kampanyasını görmez',
  not exists (select 1 from jsonb_array_elements(pg_temp.sv('s1') -> 'ads') a where a ->> 'campaign_id' = pg_temp.sv('C') ->> 'id'));
select pg_temp.chk('18 aynı reklam art arda gösterilmez',
  not exists (select 1 from jsonb_array_elements(pg_temp.sv('s1') -> 'ads') with ordinality a(x, i)
              join jsonb_array_elements(pg_temp.sv('s1') -> 'ads') with ordinality b(y, j) on j = i + 1
              where x ->> 'campaign_id' = y ->> 'campaign_id'));
select pg_temp.chk('05c sunulan config güvenli sınırlarda',
  (pg_temp.sv('s1') -> 'config' ->> 'first_after')::int >= 5 and (pg_temp.sv('s1') -> 'config' ->> 'min_view_ms')::int >= 1000);

select pg_temp.as_user('fab85a17-70d9-48e0-adcf-4014b44f199f');
select pg_temp.put('s2', public.ad_serve('feed_home', 'android', 'sess-u2-feed001', 3));
select pg_temp.chk('05d Yomra kullanıcısı ilçe hedefli kampanyayı görür',
  exists (select 1 from jsonb_array_elements(pg_temp.sv('s2') -> 'ads') a where a ->> 'campaign_id' = pg_temp.sv('C') ->> 'id'));

-- 3. Marketplace kapalı
select pg_temp.chk('03 kapalı yerleşimde sunum yok',
  public.ad_serve('marketplace_home', 'ios', 'sess-u2-mkt0001', 2) ->> 'reason' = 'placement_off');
-- 8. Kampanyasız açık yerleşim boş döner (boş çerçeve yok)
select pg_temp.put('ride', public.ad_serve('ride_list', 'ios', 'sess-u2-ride001', 2));
select pg_temp.chk('08 kampanya yoksa reklam listesi boş',
  (pg_temp.sv('ride') ->> 'enabled')::boolean and jsonb_array_length(pg_temp.sv('ride') -> 'ads') = 0);
-- Reserved yerleşim (yüzeyi olmayan) açılsa da sunum yok
select pg_temp.chk('04b yüzeyi olmayan yerleşim sunulmaz',
  public.ad_serve('reels_feed', 'ios', 'sess-u2-reel001', 1) ->> 'reason' = 'placement_off');
-- Marketplace ilanı hedefi geçerli
select pg_temp.chk('13 marketplace ilanı hedefli reklam sunulur',
  jsonb_array_length(public.ad_serve('marketplace_category', 'web', 'sess-u2-cat0001', 1) -> 'ads') = 1);

-- 6. Başlangıç saati: F gelecekte -> sunulmaz; başlangıç geçince sunulur
select pg_temp.chk('06b planlı kampanya başlangıçtan önce sunulmaz',
  jsonb_array_length(public.ad_serve('ride_list', 'ios', 'sess-u2-ride002', 1) -> 'ads') = 0);
update public.ad_campaigns set starts_at = now() - interval '1 minute' where id = (pg_temp.sv('F') ->> 'id')::uuid;
select pg_temp.chk('06c başlangıç saati gelince sunulur (sunucu saatiyle)',
  jsonb_array_length(public.ad_serve('ride_list', 'ios', 'sess-u2-ride003', 1) -> 'ads') = 1);
-- 7. Bitiş saati
update public.ad_campaigns set ends_at = now() - interval '1 second', starts_at = now() - interval '2 hours'
where id = (pg_temp.sv('F') ->> 'id')::uuid;
select pg_temp.chk('07a bitiş saatinden sonra sunulmaz',
  jsonb_array_length(public.ad_serve('ride_list', 'ios', 'sess-u2-ride004', 1) -> 'ads') = 0);
select public.ads_sync_campaign_statuses();
select pg_temp.chk('07b zamanlayıcı kampanyayı "süresi doldu" yapar ve rapor üretir',
  (select status from public.ad_campaigns where id = (pg_temp.sv('F') ->> 'id')::uuid) = 'expired'
  and exists (select 1 from public.ad_advertiser_reports where campaign_id = (pg_temp.sv('F') ->> 'id')::uuid and kind = 'campaign_end'));

-- 17. Gösterim doğrulaması ---------------------------------------------------
select pg_temp.as_user('45640e53-dee5-44d4-a5e4-5ce8cd1140c9');
select pg_temp.put('sv1', to_jsonb((pg_temp.sv('s1') -> 'ads' -> 0 ->> 'serve_id')));
select pg_temp.chk('17a render anında gösterim sayılmaz (çok hızlı)',
  public.ad_record_impression((pg_temp.sv('sv1') #>> '{}')::uuid, 1500) ->> 'reason' = 'too_fast');
select pg_temp.backdate((pg_temp.sv('sv1') #>> '{}')::uuid, 5);
select pg_temp.chk('17b 1 sn altı görünürlük sayılmaz',
  public.ad_record_impression((pg_temp.sv('sv1') #>> '{}')::uuid, 500) ->> 'reason' = 'visibility_insufficient');
select pg_temp.chk('17c geçerli görünürlük sayılır',
  (public.ad_record_impression((pg_temp.sv('sv1') #>> '{}')::uuid, 1200) ->> 'counted')::boolean);
select pg_temp.chk('17d aynı sunumda tekrar gösterim üretilmez',
  public.ad_record_impression((pg_temp.sv('sv1') #>> '{}')::uuid, 1200) ->> 'reason' = 'duplicate');
select pg_temp.chk('17e tıklama sayılır',
  (public.ad_record_click((pg_temp.sv('sv1') #>> '{}')::uuid) ->> 'counted')::boolean);
select pg_temp.chk('17f aynı tıklama tekrar sayılmaz',
  public.ad_record_click((pg_temp.sv('sv1') #>> '{}')::uuid) ->> 'reason' = 'duplicate');
select pg_temp.chk('17g başka kullanıcının sunum kaydı kullanılamaz', (
  select public.ad_record_impression((pg_temp.sv('s2') -> 'ads' -> 0 ->> 'serve_id')::uuid, 1500) ->> 'reason') = 'serve_not_found');
-- Sayaçlar
select pg_temp.chk('17h kampanya sayaçları atomik güncellenir', (
  select impressions_total = 1 and clicks_total = 1 from public.ad_campaigns
  where id = (pg_temp.sv('s1') -> 'ads' -> 0 ->> 'campaign_id')::uuid));
-- Bot: tıklama hız limiti
select pg_temp.as_user('9716b5e8-f794-4a79-a2f4-0d32f62a60c0');
select public.admin_ads_settings_update('{"click_rate_limit_per_minute":1}'::jsonb, 'smoke');
select pg_temp.as_user('45640e53-dee5-44d4-a5e4-5ce8cd1140c9');
select pg_temp.backdate((pg_temp.sv('s1') -> 'ads' -> 1 ->> 'serve_id')::uuid, 5);
select pg_temp.chk('17i tıklama hız limiti sahte tıklamayı ayırır',
  public.ad_record_click((pg_temp.sv('s1') -> 'ads' -> 1 ->> 'serve_id')::uuid) ->> 'reason' = 'rate_limited');
select pg_temp.chk('17j geçersiz olaylar ayrı kaydedilir',
  (select count(*) from public.ad_invalid_events where user_id = '45640e53-dee5-44d4-a5e4-5ce8cd1140c9') >= 3);

-- 16. Gizle: gizlenen kampanya bu kullanıcıya sunulmaz
select public.ad_feedback((pg_temp.sv('A') ->> 'id')::uuid, 'hide', null, null);
select pg_temp.chk('16 gizlenen reklam tekrar sunulmaz',
  not exists (select 1 from jsonb_array_elements(public.ad_serve('feed_home', 'ios', 'sess-u1-feed002', 3) -> 'ads') a
              where a ->> 'campaign_id' = pg_temp.sv('A') ->> 'id'));

-- 11. Detay sayfası
select pg_temp.as_user('fab85a17-70d9-48e0-adcf-4014b44f199f');
select pg_temp.put('det', public.ad_detail_get((pg_temp.sv('A') ->> 'id')::uuid));
select pg_temp.chk('11 detay sayfası gerçek alanlarla döner',
  (pg_temp.sv('det') ->> 'available')::boolean and pg_temp.sv('det') -> 'detail' ->> 'headline' = 'Detay'
  and not (pg_temp.sv('det') ->> 'preview')::boolean);

-- Bildirim eşiği: otomatik duraklatma
select pg_temp.as_user('9716b5e8-f794-4a79-a2f4-0d32f62a60c0');
select public.admin_ads_settings_update('{"auto_pause_report_threshold":2}'::jsonb, 'smoke');
select pg_temp.as_user('45640e53-dee5-44d4-a5e4-5ce8cd1140c9');
select public.ad_feedback((pg_temp.sv('B') ->> 'id')::uuid, 'report', 'misleading', 'test');
select pg_temp.as_user('fab85a17-70d9-48e0-adcf-4014b44f199f');
select public.ad_feedback((pg_temp.sv('B') ->> 'id')::uuid, 'report', 'scam', null);
select pg_temp.chk('17k bildirim eşiğinde kampanya otomatik duraklatılır',
  (select status from public.ad_campaigns where id = (pg_temp.sv('B') ->> 'id')::uuid) = 'paused');

-- Duraklatma: yeni gösterimler hemen durur
select pg_temp.as_user('9716b5e8-f794-4a79-a2f4-0d32f62a60c0');
select public.admin_ads_campaign_transition((pg_temp.sv('C') ->> 'id')::uuid, 'pause', 'smoke');
select pg_temp.as_user('fab85a17-70d9-48e0-adcf-4014b44f199f');
select pg_temp.chk('09c duraklatılan kampanya sunulmaz',
  not exists (select 1 from jsonb_array_elements(public.ad_serve('feed_home', 'android', 'sess-u2-feed002', 3) -> 'ads') a
              where a ->> 'campaign_id' in (pg_temp.sv('C') ->> 'id', pg_temp.sv('B') ->> 'id')));
select pg_temp.backdate(x.serve_id, 5)
from (select (a ->> 'serve_id')::uuid serve_id from jsonb_array_elements(pg_temp.sv('s2') -> 'ads') a
      where a ->> 'campaign_id' = pg_temp.sv('C') ->> 'id' limit 1) x;
select pg_temp.chk('09d duraklatılan kampanyanın bekleyen gösterimi sayılmaz', (
  select public.ad_record_impression((a ->> 'serve_id')::uuid, 1500) ->> 'reason'
  from jsonb_array_elements(pg_temp.sv('s2') -> 'ads') a
  where a ->> 'campaign_id' = pg_temp.sv('C') ->> 'id' limit 1) = 'campaign_inactive');
select pg_temp.chk('11b duraklatılan kampanya detayı kullanıcıya kapalı',
  public.ad_detail_get((pg_temp.sv('C') ->> 'id')::uuid) ->> 'available' = 'false');

-- 15b. Hedef yayından kalkınca reklam otomatik uygunsuz olur
update public.marketplace_listings set status = 'sold'
where id = (select (target_id)::uuid from public.ad_target_destinations where campaign_id = (pg_temp.sv('D') ->> 'id')::uuid);
select pg_temp.chk('15b yayından kalkan hedefin reklamı sunulmaz',
  jsonb_array_length(public.ad_serve('marketplace_category', 'web', 'sess-u2-cat0002', 1) -> 'ads') = 0);

-- 23. Eşzamanlı limit: toplam sınırı 1 olan kampanya ------------------------
select pg_temp.as_user('9716b5e8-f794-4a79-a2f4-0d32f62a60c0');
select pg_temp.put('G', public.admin_ads_campaign_save(null, pg_temp.camp_payload(pg_temp.sv('adv') ->> 'id', 'Kampanya G',
  '{"placements":["ride_list"],"total_impression_cap":1}'::jsonb), 'smoke'));
select public.admin_ads_campaign_transition((pg_temp.sv('G') ->> 'id')::uuid, 'submit', null);
select public.admin_ads_campaign_transition((pg_temp.sv('G') ->> 'id')::uuid, 'approve', 'smoke');
select pg_temp.as_user('45640e53-dee5-44d4-a5e4-5ce8cd1140c9');
select pg_temp.put('g1', public.ad_serve('ride_list', 'ios', 'sess-u1-ride001', 1));
select pg_temp.as_user('fab85a17-70d9-48e0-adcf-4014b44f199f');
select pg_temp.put('g2', public.ad_serve('ride_list', 'ios', 'sess-u2-ride009', 1));
select pg_temp.backdate((pg_temp.sv(k) -> 'ads' -> 0 ->> 'serve_id')::uuid, 5) from unnest(array['g1', 'g2']) k;
select pg_temp.as_user('45640e53-dee5-44d4-a5e4-5ce8cd1140c9');
select pg_temp.put('g1r', public.ad_record_impression((pg_temp.sv('g1') -> 'ads' -> 0 ->> 'serve_id')::uuid, 1500));
select pg_temp.as_user('fab85a17-70d9-48e0-adcf-4014b44f199f');
select pg_temp.put('g2r', public.ad_record_impression((pg_temp.sv('g2') -> 'ads' -> 0 ->> 'serve_id')::uuid, 1500));
select pg_temp.chk('23 toplam gösterim sınırı aşılmaz',
  (pg_temp.sv('g1r') ->> 'counted')::boolean and pg_temp.sv('g2r') ->> 'reason' = 'campaign_limit'
  and (select impressions_total from public.ad_campaigns where id = (pg_temp.sv('G') ->> 'id')::uuid) = 1,
  (pg_temp.sv('g2r'))::text);

-- 22b. RLS: tablolara doğrudan erişim ---------------------------------------
select set_config('smoke.adv', pg_temp.sv('adv') ->> 'id', true);
select pg_temp.as_user('45640e53-dee5-44d4-a5e4-5ce8cd1140c9');
set local role authenticated;
select set_config('smoke.rls_user', (select count(*) from public.ad_campaigns)::text, true);
do $$ begin
  perform set_config('smoke.rls_user_serves', (select count(*) from public.ad_serves)::text, true);
exception when insufficient_privilege then
  perform set_config('smoke.rls_user_serves', 'denied', true);
end $$;
reset role;
select pg_temp.as_user('9716b5e8-f794-4a79-a2f4-0d32f62a60c0');
select public.admin_ads_advertiser_member_set((pg_temp.sv('adv') ->> 'id')::uuid,
  (select username from public.profiles where id = 'fab85a17-70d9-48e0-adcf-4014b44f199f'), true, 'smoke');
set local role authenticated;
select set_config('smoke.rls_admin', (select count(*) from public.ad_campaigns)::text, true);
reset role;
select pg_temp.as_user('fab85a17-70d9-48e0-adcf-4014b44f199f');
set local role authenticated;
select set_config('smoke.rls_member', (select count(*) from public.ad_campaigns
  where advertiser_id <> current_setting('smoke.adv')::uuid)::text, true);
select set_config('smoke.rls_member_own', (select count(*) from public.ad_campaigns
  where advertiser_id = current_setting('smoke.adv')::uuid)::text, true);
reset role;
select pg_temp.chk('22b normal kullanıcı kampanya tablosunu okuyamaz', current_setting('smoke.rls_user')::int = 0);
select pg_temp.chk('22b2 normal kullanıcı teslimat defterini okuyamaz', current_setting('smoke.rls_user_serves') = 'denied');
select pg_temp.chk('22c yönetici tabloyu okuyabilir', current_setting('smoke.rls_admin')::int >= 6, current_setting('smoke.rls_admin'));
select pg_temp.chk('22d reklamveren yalnızca kendi kampanyalarını görür',
  current_setting('smoke.rls_member')::int = 0 and current_setting('smoke.rls_member_own')::int >= 6,
  current_setting('smoke.rls_member') || '/' || current_setting('smoke.rls_member_own'));
select pg_temp.chk('22e reklamveren paneli kendi verisini döner',
  jsonb_array_length(public.ad_advertiser_my_campaigns()) = 1);

-- 24. Tüm Reklamları Kapat ----------------------------------------------------
select pg_temp.as_user('9716b5e8-f794-4a79-a2f4-0d32f62a60c0');
select public.admin_ads_global_set(false, 'smoke kapatma');
select pg_temp.as_user('45640e53-dee5-44d4-a5e4-5ce8cd1140c9');
select pg_temp.chk('24a global kapatma tüm sunumları durdurur',
  public.ad_serve('feed_home', 'ios', 'sess-u1-feed003', 2) ->> 'reason' = 'global_off');
select pg_temp.backdate((pg_temp.sv('s1') -> 'ads' -> 2 ->> 'serve_id')::uuid, 5);
select pg_temp.chk('24b global kapalıyken bekleyen gösterim sayılmaz',
  public.ad_record_impression((pg_temp.sv('s1') -> 'ads' -> 2 ->> 'serve_id')::uuid, 1500) ->> 'reason' = 'global_off');

-- Denetim ve analitik ---------------------------------------------------------
select pg_temp.as_user('9716b5e8-f794-4a79-a2f4-0d32f62a60c0');
select pg_temp.chk('09e durum geçişleri denetim kaydına yazılır',
  (select count(*) from public.admin_audit_logs where action_code in ('ads.campaign.submit', 'ads.campaign.approve', 'ads.campaign.pause', 'ads.campaign.auto_pause', 'ads.campaign.auto_expire')
   and created_at >= now()) >= 14);
select pg_temp.chk('12 analitik RPC gerçek değerleri döner', (
  public.admin_ads_campaign_analytics((pg_temp.sv('s1') -> 'ads' -> 0 ->> 'campaign_id')::uuid, 30) -> 'totals' ->> 'impressions')::int = 1);
select pg_temp.chk('12b genel bakış KPI', (public.admin_ads_overview() ->> 'clicks_total')::int >= 1);
select pg_temp.chk('12c denetim listesi', jsonb_array_length(public.admin_ads_audit(20, 0) -> 'items') > 0);

select n, name, ok, detail from _t order by n;

rollback;
