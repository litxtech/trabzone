-- ---------------------------------------------------------------------------
-- Deprem Merkezi uçtan uca veritabanı testi.
--
-- Tamamı tek bir DO bloğunda çalışır ve sonunda sonuçları bir istisna ile
-- döndürür; istisna işlemi geri aldığı için hiçbir test kaydı, tercih, cihaz
-- veya bildirim kalıcı olmaz. Push teslimatları işlem dışına çıkmadığından
-- gerçek cihazlara hiçbir şey gönderilmez.
--
--   node scripts/db-run-sql.mjs supabase/tests/earthquake_e2e.sql
--   (çıktı: "RESULT {...}" — her kontrol "ok"/"FAIL: ..." değerini taşır)
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb := '{}'::jsonb;
  v jsonb;
  v_admin uuid;
  u1 uuid;
  u2 uuid;
  u3 uuid;
  v_hour integer := extract(hour from now() at time zone 'Europe/Istanbul')::integer;
  v_now timestamptz := now();
  v_evt public.earthquake_events;
  v_evt2 public.earthquake_events;
  v_ne uuid;
  v_rev uuid;
  v_dev1 uuid;
  v_dev3 uuid;
  v_review uuid;
  v_count integer;
  v_text text;
  i integer;
begin
  -- Ortam -----------------------------------------------------------------
  select a.user_id into v_admin from public.user_role_assignments a
   where a.role_key = 'super_admin' and (a.expires_at is null or a.expires_at > now()) limit 1;
  select p.id into u1 from public.profiles p
   where p.account_status = 'active' and p.id <> coalesce(v_admin, '00000000-0000-0000-0000-000000000000')
     and not exists (select 1 from public.earthquake_user_preferences e where e.user_id = p.id)
   order by p.id limit 1;
  select p.id into u2 from public.profiles p
   where p.account_status = 'active' and p.id not in (u1, coalesce(v_admin, u1))
     and not exists (select 1 from public.earthquake_user_preferences e where e.user_id = p.id)
   order by p.id limit 1;
  select p.id into u3 from public.profiles p
   where p.account_status = 'active' and p.id not in (u1, u2, coalesce(v_admin, u1))
     and not exists (select 1 from public.earthquake_user_preferences e where e.user_id = p.id)
   order by p.id limit 1;
  r := jsonb_build_object('env', case when v_admin is not null and u3 is not null then 'ok' else 'FAIL: kullanıcı yok' end);

  update public.earthquake_settings
     set notifications_enabled = true, notifications_paused = false, notify_trabzon_enabled = true,
         notify_small_enabled = true, late_event_max_minutes = 30, revision_notify_min_delta = 0.3,
         quiet_bypass_magnitude = greatest(quiet_bypass_magnitude, 4.5)
   where id = 1;

  -- Kullanıcı tercihleri (u1: 150 km tüm büyüklükler; u2: il, ≥3,0; u3: 50 km tüm büyüklükler + şu an sessiz saat)
  insert into public.earthquake_user_preferences (user_id, notifications_enabled, region_mode, radius_km, notify_all_magnitudes, minimum_magnitude, quiet_hours_enabled, quiet_start_hour, quiet_end_hour)
  values (u1, true, 'trabzon', 150, true, 3.0, false, 23, 7),
         (u2, true, 'province', 150, false, 3.0, false, 23, 7),
         (u3, true, 'trabzon', 50, true, 3.0, true, v_hour, (v_hour + 1) % 24);
  insert into public.user_devices (user_id, platform, push_token) values (u1, 'android', 'ExponentPushToken[e2e-test-u1]') returning id into v_dev1;
  insert into public.user_devices (user_id, platform, push_token) values (u3, 'ios', 'ExponentPushToken[e2e-test-u3]') returning id into v_dev3;

  -- 1) AFAD canlı kayıt: Trabzon il sınırı içinde (Ortahisar/Yomra civarı) -----------------
  v := public.earthquake_ingest('afad', jsonb_build_array(jsonb_build_object(
         'source_event_id', 'e2e900001', 'occurred_at', v_now - interval '60 seconds',
         'latitude', 40.95, 'longitude', 39.80, 'depth_km', 7.4, 'magnitude', 2.4, 'magnitude_type', 'ML',
         'location', 'Yomra (Trabzon)', 'province', 'Trabzon', 'district', 'Yomra', 'raw', '{}'::jsonb)), 'scheduled');
  select * into v_evt from public.earthquake_events where canonical_event_id = 'afad-e2e900001';
  r := r || jsonb_build_object('afad_ingest',
    case when (v->>'new')::int = 1 and v_evt.in_trabzon_province and v_evt.district_key is not null
              and v_evt.region_classification = 'trabzon_province' and v_evt.notification_state = 'queued'
         then 'ok' else 'FAIL: ' || v::text || ' / ' || coalesce(v_evt.region_classification, 'null') end,
    'afad_district', v_evt.district_key);

  -- 2) USGS aynı deprem (Δt 3 sn, ~9 km, ΔM 0,2) → otomatik eşleşme; AFAD değerleri korunur
  v := public.earthquake_ingest('usgs', jsonb_build_array(jsonb_build_object(
         'source_event_id', 'e2eus0001', 'occurred_at', v_now - interval '57 seconds',
         'latitude', 41.02, 'longitude', 39.85, 'depth_km', 10.0, 'magnitude', 2.6, 'magnitude_type', 'mb',
         'location', '12 km E of Trabzon, Turkey', 'raw', '{}'::jsonb)), 'scheduled');
  select * into v_evt from public.earthquake_events where canonical_event_id = 'afad-e2e900001';
  r := r || jsonb_build_object('usgs_auto_match',
    case when (v->>'matched')::int = 1 and v_evt.sources @> array['afad', 'usgs'] and v_evt.preferred_source = 'afad'
              and v_evt.magnitude = 2.4 and v_evt.magnitude_type = 'ML'
              and not exists (select 1 from public.earthquake_events where canonical_event_id = 'usgs-e2eus0001')
         then 'ok' else 'FAIL: ' || v::text end);
  r := r || jsonb_build_object('both_sources_kept',
    case when (select count(*) from public.earthquake_source_records where earthquake_event_id = v_evt.id) = 2
              and (select source_magnitude from public.earthquake_source_records where earthquake_event_id = v_evt.id and source_name = 'usgs') = 2.6
         then 'ok' else 'FAIL' end);

  -- 3) Dağıtım: u1 (in-app + push), u2 hariç (≥3,0 ister), u3 (in-app + push sessiz saatte bastırılır)
  for i in 1..20 loop
    select id into v_ne from public.earthquake_notification_events where earthquake_event_id = v_evt.id and notification_type = 'new';
    exit when (select processing_status from public.earthquake_notification_events where id = v_ne) in ('completed', 'skipped');
    perform public.earthquake_fanout_step(5000);
  end loop;
  r := r || jsonb_build_object('fanout_new',
    case when (select processing_status from public.earthquake_notification_events where id = v_ne) = 'completed'
              and exists (select 1 from public.earthquake_notification_deliveries where notification_event_id = v_ne and user_id = u1 and channel = 'in_app')
              and exists (select 1 from public.earthquake_notification_deliveries where notification_event_id = v_ne and device_id = v_dev1 and delivery_status = 'pending')
              and not exists (select 1 from public.earthquake_notification_deliveries where notification_event_id = v_ne and user_id = u2)
              and exists (select 1 from public.earthquake_notification_deliveries where notification_event_id = v_ne and user_id = u3 and channel = 'in_app')
         then 'ok' else 'FAIL: ' || (select jsonb_agg(jsonb_build_object('u', user_id, 'c', channel, 's', delivery_status))::text
                                      from public.earthquake_notification_deliveries where notification_event_id = v_ne) end);
  r := r || jsonb_build_object('quiet_hours',
    case when (select delivery_status || '/' || coalesce(suppressed_reason, '') from public.earthquake_notification_deliveries
                where notification_event_id = v_ne and device_id = v_dev3) = 'suppressed/quiet_hours'
         then 'ok' else 'FAIL' end);
  select body into v_text from public.earthquake_notification_events where id = v_ne;
  r := r || jsonb_build_object('notification_text',
    case when v_text like 'Trabzon’un % ilçesinde ML 2,4 büyüklüğünde deprem kaydedildi.%Derinlik: 7,4 km%AFAD%'
         then 'ok' else 'FAIL: ' || coalesce(v_text, 'null') end,
    'notification_body', v_text,
    'notification_route', (select route from public.earthquake_notification_events where id = v_ne));
  r := r || jsonb_build_object('in_app_notification',
    case when exists (select 1 from public.notifications where user_id = u1 and kind = 'earthquake' and route = '/deprem/afad-e2e900001')
         then 'ok' else 'FAIL' end);

  -- 4) AFAD revizyonu (2,4 → 3,2): revizyon kaydı + yalnızca ilk bildirimi alanlara "güncellendi" bildirimi
  v := public.earthquake_ingest('afad', jsonb_build_array(jsonb_build_object(
         'source_event_id', 'e2e900001', 'occurred_at', v_now - interval '60 seconds',
         'latitude', 40.95, 'longitude', 39.80, 'depth_km', 7.4, 'magnitude', 3.2, 'magnitude_type', 'ML',
         'location', 'Yomra (Trabzon)', 'province', 'Trabzon', 'district', 'Yomra', 'raw', '{}'::jsonb)), 'scheduled');
  select * into v_evt from public.earthquake_events where canonical_event_id = 'afad-e2e900001';
  r := r || jsonb_build_object('revision',
    case when (v->>'updated')::int = 1 and v_evt.magnitude = 3.2 and v_evt.revision >= 2
              and exists (select 1 from public.earthquake_event_revisions where earthquake_event_id = v_evt.id and change_kind = 'source_update'
                            and (changes->'magnitude'->>'old')::numeric = 2.4 and (changes->'magnitude'->>'new')::numeric = 3.2)
         then 'ok' else 'FAIL: ' || v::text || ' rev=' || v_evt.revision
              || ' ' || coalesce((select changes::text from public.earthquake_event_revisions where earthquake_event_id = v_evt.id order by id desc limit 1), '') end);
  select id into v_rev from public.earthquake_notification_events where earthquake_event_id = v_evt.id and notification_type = 'revision';
  for i in 1..20 loop
    exit when v_rev is null or (select processing_status from public.earthquake_notification_events where id = v_rev) in ('completed', 'skipped');
    perform public.earthquake_fanout_step(5000);
  end loop;
  r := r || jsonb_build_object('revision_notification',
    case when v_rev is not null
              and exists (select 1 from public.earthquake_notification_deliveries where notification_event_id = v_rev and user_id = u1 and channel = 'in_app')
              and not exists (select 1 from public.earthquake_notification_deliveries where notification_event_id = v_rev and user_id = u2)
              and (select body from public.earthquake_notification_events where id = v_rev) like '%2,4 yerine ML 3,2 olarak güncelledi.'
         then 'ok' else 'FAIL: ' || coalesce((select body from public.earthquake_notification_events where id = v_rev), 'no revision event') end);
  v := public.earthquake_ingest('afad', jsonb_build_array(jsonb_build_object(
         'source_event_id', 'e2e900001', 'occurred_at', v_now - interval '60 seconds',
         'latitude', 40.95, 'longitude', 39.80, 'depth_km', 7.4, 'magnitude', 3.2, 'magnitude_type', 'ML',
         'location', 'Yomra (Trabzon)', 'province', 'Trabzon', 'district', 'Yomra', 'raw', '{}'::jsonb)), 'scheduled');
  r := r || jsonb_build_object('idempotent_reingest', case when (v->>'unchanged')::int = 1 and (v->>'new')::int = 0 then 'ok' else 'FAIL: ' || v::text end);

  -- 5) Push sonucu: DeviceNotRegistered → token geçersizleştirilir
  update public.earthquake_notification_deliveries set delivery_status = 'sending', claimed_at = now()
   where notification_event_id = v_ne and device_id = v_dev1;
  v := public.earthquake_push_report(jsonb_build_array(jsonb_build_object(
         'delivery_id', (select id from public.earthquake_notification_deliveries where notification_event_id = v_ne and device_id = v_dev1),
         'ok', false, 'error', 'DeviceNotRegistered', 'message', 'e2e')));
  r := r || jsonb_build_object('invalid_token',
    case when (v->>'invalid')::int = 1 and (select push_token is null and invalidated_at is not null from public.user_devices where id = v_dev1)
         then 'ok' else 'FAIL: ' || v::text end);

  -- 6) Doğrulama: geçersiz koordinat / büyüklük / gelecek zaman reddedilir; eksik derinlik ve tür kabul edilir
  v := public.earthquake_ingest('afad', jsonb_build_array(
         jsonb_build_object('source_event_id', 'e2e900010', 'occurred_at', v_now - interval '5 minutes', 'latitude', 0, 'longitude', 0, 'magnitude', 2.0),
         jsonb_build_object('source_event_id', 'e2e900011', 'occurred_at', v_now - interval '5 minutes', 'latitude', 95, 'longitude', 39, 'magnitude', 2.0),
         jsonb_build_object('source_event_id', 'e2e900012', 'occurred_at', v_now - interval '5 minutes', 'latitude', 40.9, 'longitude', 39.6, 'magnitude', 'abc'),
         jsonb_build_object('source_event_id', 'e2e900013', 'occurred_at', v_now + interval '2 hours', 'latitude', 40.9, 'longitude', 39.6, 'magnitude', 2.0),
         jsonb_build_object('source_event_id', 'bad id!', 'occurred_at', v_now - interval '5 minutes', 'latitude', 40.9, 'longitude', 39.6, 'magnitude', 2.0),
         jsonb_build_object('source_event_id', 'e2e900014', 'occurred_at', v_now - interval '5 minutes', 'latitude', 40.90, 'longitude', 39.60, 'magnitude', 1.3)
       ), 'scheduled');
  select * into v_evt2 from public.earthquake_events where canonical_event_id = 'afad-e2e900014';
  r := r || jsonb_build_object('validation',
    case when (v->>'rejected')::int = 5 and (v->>'new')::int = 1 and v_evt2.depth_km is null and v_evt2.magnitude_type is null
         then 'ok' else 'FAIL: ' || v::text end);

  -- 7) Karadeniz açıkları: karasularında "Trabzon açıkları", daha açıkta "çevre"; ikisinde de ilçe atanmaz
  v := public.earthquake_ingest('afad', jsonb_build_array(
         jsonb_build_object('source_event_id', 'e2e900020', 'occurred_at', v_now - interval '4 minutes', 'latitude', 41.12, 'longitude', 39.75,
                            'depth_km', 12, 'magnitude', 2.1, 'magnitude_type', 'ML', 'location', 'Karadeniz'),
         jsonb_build_object('source_event_id', 'e2e900021', 'occurred_at', v_now - interval '4 minutes', 'latitude', 41.45, 'longitude', 39.90,
                            'depth_km', 12, 'magnitude', 2.1, 'magnitude_type', 'ML', 'location', 'Karadeniz')), 'scheduled');
  select * into v_evt2 from public.earthquake_events where canonical_event_id = 'afad-e2e900020';
  r := r || jsonb_build_object('offshore_territorial',
    case when v_evt2.region_classification = 'trabzon_offshore' and v_evt2.district_key is null
         then 'ok' else 'FAIL: ' || coalesce(v_evt2.region_classification, 'null') || ' ' || coalesce(v_evt2.district_key, '-') end);
  select * into v_evt2 from public.earthquake_events where canonical_event_id = 'afad-e2e900021';
  r := r || jsonb_build_object('offshore_open_sea',
    case when v_evt2.region_classification = 'trabzon_vicinity' and v_evt2.district_key is null and not v_evt2.in_trabzon_province
         then 'ok' else 'FAIL: ' || coalesce(v_evt2.region_classification, 'null') || ' ' || coalesce(v_evt2.district_key, '-') end);

  -- 8) Geç yayımlanan olay arşive alınır ama "yeni deprem" bildirimi gönderilmez; backfill bildirim üretmez
  v := public.earthquake_ingest('afad', jsonb_build_array(jsonb_build_object(
         'source_event_id', 'e2e900030', 'occurred_at', v_now - interval '3 hours', 'latitude', 40.85, 'longitude', 39.70,
         'depth_km', 5, 'magnitude', 2.2, 'magnitude_type', 'ML')), 'scheduled');
  select * into v_evt2 from public.earthquake_events where canonical_event_id = 'afad-e2e900030';
  r := r || jsonb_build_object('late_event',
    case when v_evt2.id is not null and v_evt2.notification_state = 'skipped' and v_evt2.notification_skip_reason = 'late'
         then 'ok' else 'FAIL: ' || coalesce(v_evt2.notification_state, 'null') || '/' || coalesce(v_evt2.notification_skip_reason, '') end);
  v := public.earthquake_ingest('afad', jsonb_build_array(jsonb_build_object(
         'source_event_id', 'e2e900031', 'occurred_at', v_now - interval '2 minutes', 'latitude', 40.85, 'longitude', 39.71,
         'depth_km', 5, 'magnitude', 2.2, 'magnitude_type', 'ML')), 'backfill');
  select * into v_evt2 from public.earthquake_events where canonical_event_id = 'afad-e2e900031';
  r := r || jsonb_build_object('backfill_no_notify',
    case when v_evt2.ingest_kind = 'backfill' and v_evt2.notification_skip_reason = 'backfill' and (v->>'notifications_queued')::int = 0
         then 'ok' else 'FAIL: ' || v::text end);

  -- 9) Bölge dışı (Atina): kayıt tutulur, bildirim yok, Türkiye listesinde görünmez
  v := public.earthquake_ingest('usgs', jsonb_build_array(jsonb_build_object(
         'source_event_id', 'e2eus0040', 'occurred_at', v_now - interval '2 minutes', 'latitude', 37.98, 'longitude', 23.72,
         'depth_km', 10, 'magnitude', 3.0, 'magnitude_type', 'mb')), 'scheduled');
  select * into v_evt2 from public.earthquake_events where canonical_event_id = 'usgs-e2eus0040';
  r := r || jsonb_build_object('outside_region',
    case when v_evt2.region_classification = 'outside' and v_evt2.notification_skip_reason = 'outside_region'
              and not exists (select 1 from jsonb_array_elements(public.earthquake_feed('turkey', null, v_now - interval '1 hour', null, null, null, null, null, 'all', 'newest', 200, 0)->'items') x
                               where x->>'id' = 'usgs-e2eus0040')
         then 'ok' else 'FAIL: ' || coalesce(v_evt2.region_classification, 'null') end);

  -- 10) Belirsiz eşleşme (Δt 20 sn): USGS kaydı incelemeye düşer ve listede ikinci kez görünmez
  perform public.earthquake_ingest('afad', jsonb_build_array(jsonb_build_object(
         'source_event_id', 'e2e900002', 'occurred_at', v_now - interval '120 seconds', 'latitude', 40.80, 'longitude', 39.60,
         'depth_km', 6, 'magnitude', 2.0, 'magnitude_type', 'ML')), 'scheduled');
  v := public.earthquake_ingest('usgs', jsonb_build_array(jsonb_build_object(
         'source_event_id', 'e2eus0050', 'occurred_at', v_now - interval '100 seconds', 'latitude', 40.81, 'longitude', 39.61,
         'depth_km', 9, 'magnitude', 2.3, 'magnitude_type', 'mb')), 'scheduled');
  select * into v_evt2 from public.earthquake_events where canonical_event_id = 'usgs-e2eus0050';
  select id into v_review from public.earthquake_match_reviews where own_event_id = v_evt2.id and status = 'pending' limit 1;
  r := r || jsonb_build_object('pending_match',
    case when (v->>'review')::int = 1 and v_evt2.status = 'pending_match' and v_review is not null
              and not exists (select 1 from jsonb_array_elements(public.earthquake_feed('r150', null, v_now - interval '1 hour', null, null, null, null, null, 'all', 'newest', 200, 0)->'items') x
                               where x->>'id' = 'usgs-e2eus0050')
         then 'ok' else 'FAIL: ' || v::text || ' ' || coalesce(v_evt2.status, 'null') end);

  -- Admin oturumu ----------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2', 'session_id', '')::text, true);

  -- 11) Admin eşleştirme kararı: "aynı deprem" → USGS olayı AFAD olayına bağlanır, eski anahtar yönlenir
  v := public.earthquake_admin_match_resolve(v_review, 'link', 'E2E: aynı deprem olarak doğrulandı');
  select * into v_evt from public.earthquake_events where canonical_event_id = 'afad-e2e900001';
  r := r || jsonb_build_object('admin_match_link',
    case when (public.earthquake_detail('usgs-e2eus0050')->>'id') = 'afad-e2e900002'
              and exists (select 1 from public.earthquake_admin_audit_logs where operation like 'match%' and reason like 'E2E%')
         then 'ok' else 'FAIL: ' || v::text end);

  -- 12) Admin olay kaldırma: herkese açık detay "kaldırıldı" döner; geri alma çalışır; kaynak değerleri değişmez
  perform public.earthquake_admin_event_action(v_evt.id, 'remove', 'E2E: kaldırma testi');
  begin
    perform public.earthquake_detail('afad-e2e900001');
    r := r || jsonb_build_object('admin_remove', 'FAIL: kaldırılmış olay görünüyor');
  exception when others then
    r := r || jsonb_build_object('admin_remove', case when sqlerrm = 'earthquake_removed' then 'ok' else 'FAIL: ' || sqlerrm end);
  end;
  perform public.earthquake_admin_event_action(v_evt.id, 'restore', 'E2E: geri alma testi');
  select * into v_evt2 from public.earthquake_events where id = v_evt.id;
  r := r || jsonb_build_object('admin_restore_values_unchanged',
    case when v_evt2.status = 'active' and v_evt2.magnitude = v_evt.magnitude and v_evt2.depth_km = v_evt.depth_km
              and (select count(*) from public.earthquake_admin_audit_logs where target_id = v_evt.id::text and old_value is not null and new_value is not null) >= 2
         then 'ok' else 'FAIL' end);
  begin
    perform public.earthquake_admin_event_action(v_evt.id, 'flag', 'kısa');
    r := r || jsonb_build_object('reason_required', 'FAIL: gerekçesiz işlem kabul edildi');
  exception when others then
    r := r || jsonb_build_object('reason_required', case when sqlerrm = 'reason_required' then 'ok' else 'FAIL: ' || sqlerrm end);
  end;

  -- 13) Kaynak kapatma geçmiş kayıtları silmez
  select count(*) into v_count from public.earthquake_source_records where source_name = 'usgs';
  perform public.earthquake_admin_source_update('usgs', '{"is_enabled": false}'::jsonb, 'E2E: kaynak kapatma testi');
  r := r || jsonb_build_object('source_disable_keeps_history',
    case when (select count(*) from public.earthquake_source_records where source_name = 'usgs') = v_count
              and (select not is_enabled and health = 'disabled' from public.earthquake_sources where key = 'usgs')
         then 'ok' else 'FAIL' end, 'usgs_records', v_count);

  -- 14) TEST bildirimi yalnızca adminin kendi cihazına gider, "TEST" etiketlidir, dağıtıma girmez
  insert into public.user_devices (user_id, platform, push_token) values (v_admin, 'android', 'ExponentPushToken[e2e-test-admin]');
  v := public.earthquake_admin_test_push('e2e');
  r := r || jsonb_build_object('test_push_admin_only',
    case when (select bool_and(user_id = v_admin) from public.earthquake_notification_deliveries where notification_event_id = (v->>'notification_event_id')::uuid)
              and (select is_test and title like 'TEST%' and notification_type = 'test' from public.earthquake_notification_events where id = (v->>'notification_event_id')::uuid)
              and (select count(*) from public.earthquake_notification_deliveries where notification_event_id = (v->>'notification_event_id')::uuid and channel = 'push') >= 1
         then 'ok' else 'FAIL: ' || v::text end);

  -- 15) Yetkisiz kullanıcı admin işlemi yapamaz
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  begin
    perform public.earthquake_admin_event_action(v_evt.id, 'remove', 'E2E: yetkisiz deneme');
    r := r || jsonb_build_object('non_admin_denied', 'FAIL');
  exception when others then
    r := r || jsonb_build_object('non_admin_denied', case when sqlerrm = 'insufficient_privilege' then 'ok' else 'FAIL: ' || sqlerrm end);
  end;

  -- 16) Kullanıcı tercihleri RPC: geçersiz değerler reddedilir, geçerli kayıt döner
  begin
    perform public.earthquake_prefs_set('{"region_mode": "trabzon", "radius_km": 75}'::jsonb);
    r := r || jsonb_build_object('prefs_validation', 'FAIL');
  exception when others then
    r := r || jsonb_build_object('prefs_validation', case when sqlerrm = 'invalid_radius' then 'ok' else 'FAIL: ' || sqlerrm end);
  end;
  v := public.earthquake_prefs_set('{"notifications_enabled": true, "region_mode": "province", "radius_km": 100, "notify_all_magnitudes": false, "minimum_magnitude": 2, "quiet_hours_enabled": true, "quiet_start_hour": 22, "quiet_end_hour": 6}'::jsonb);
  r := r || jsonb_build_object('prefs_roundtrip',
    case when v->>'region_mode' = 'province' and (v->>'minimum_magnitude')::numeric = 2 and (v->>'quiet_start_hour')::int = 22 and (v->>'saved')::boolean
         then 'ok' else 'FAIL: ' || v::text end);
  v := public.earthquake_notification_history(10, 0);
  r := r || jsonb_build_object('history',
    case when jsonb_array_length(v->'items') >= 2 and (v->'items'->0->>'event_id') = 'afad-e2e900001' then 'ok' else 'FAIL: ' || left(v::text, 300) end);

  -- 17) Hesap silme uyumluluğu: profil silinince tercih ve teslimatlar kaskadla silinir
  r := r || jsonb_build_object('account_deletion_cascade',
    case when (select bool_and(c.confdeltype = 'c') from pg_constraint c
                where c.conrelid in ('public.earthquake_user_preferences'::regclass, 'public.earthquake_notification_deliveries'::regclass)
                  and c.contype = 'f' and c.confrelid = 'public.profiles'::regclass)
         then 'ok' else 'FAIL' end);

  raise exception 'RESULT %', r::text;
end $$;
