-- Trabzonspor Maç Arenası uçtan uca duman testi. Tamamı geri alınan bir işlemde çalışır;
-- hiçbir bildirim, sohbet mesajı veya maç kaydı kalıcı olmaz ve push gönderilmez
-- (dağıtım fonksiyonu yalnızca commit edilmiş kayıtları görür).
-- Yönetici: 9716b5e8 (admin) · Kullanıcı 1: 45640e53 · Kullanıcı 2: fab85a17 (u_fab85a1770)
-- Not: Sohbet / anket / yorum kuralları gerçek maçta geçerli olduğundan 8. bölümde işlem
-- içinde geçici bir takım kimliği tanımlanıp gerçek ingest yolundan sentetik bir maç
-- geçirilir; işlem sonunda tamamı geri alınır.
begin;

create temp table _t (n serial, name text, ok boolean, detail text) on commit drop;
create temp table _s (k text primary key, v jsonb) on commit drop;

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.as_user('9716b5e8-f794-4a79-a2f4-0d32f62a60c0');
$$;
create function pg_temp.as_u1() returns void language sql as $$
  select pg_temp.as_user('45640e53-dee5-44d4-a5e4-5ce8cd1140c9');
$$;
create function pg_temp.as_u2() returns void language sql as $$
  select pg_temp.as_user('fab85a17-70d9-48e0-adcf-4014b44f199f');
$$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null) returns void language sql as $$
  insert into _t (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;
create function pg_temp.sv(p_key text) returns jsonb language sql as $$ select v from _s where k = p_key $$;
create function pg_temp.put(p_key text, p_val jsonb) returns void language sql as $$
  insert into _s (k, v) values (p_key, p_val) on conflict (k) do update set v = excluded.v;
$$;
create function pg_temp.fx() returns bigint language sql as $$ select (v #>> '{}')::bigint from _s where k = 'fx' $$;
create function pg_temp.fuid() returns uuid language sql as $$ select uid from public.sports_fixtures where id = pg_temp.fx() $$;
-- Hata metnini döner; başarılıysa 'OK'. Hata alt işlemle geri alınır.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.fanout() returns integer language plpgsql as $$
declare v_steps integer := 0; v_r jsonb;
begin
  perform pg_temp.as_service();
  loop
    v_r := public.sports_fanout_step(2000);
    exit when v_r ? 'idle' or v_steps > 60;
    v_steps := v_steps + 1;
  end loop;
  return v_steps;
end $$;
create function pg_temp.inapp(p_user uuid) returns integer language sql as $$
  select count(*)::integer from public.notifications
   where user_id = p_user and kind = 'sports' and entity_id = pg_temp.fx()::text;
$$;

-- 1. Yetki ve şema güvenliği ---------------------------------------------------
select pg_temp.chk('01a anon sohbet RPC çalıştıramaz',
  not has_function_privilege('anon', 'public.sports_chat_send(bigint,text,bigint,uuid,boolean)', 'execute'));
select pg_temp.chk('01b istemci ingest RPC çalıştıramaz',
  not has_function_privilege('authenticated', 'public.sports_ingest_fixture(jsonb,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.sports_ingest_fixture(jsonb,jsonb)', 'execute'));
select pg_temp.chk('01c istemci skor/olay tablosuna doğrudan yazamaz',
  not has_table_privilege('authenticated', 'public.sports_fixtures', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.sports_fixture_events', 'UPDATE')
  and not has_table_privilege('anon', 'public.sports_chat_messages', 'INSERT')
  and not has_table_privilege('authenticated', 'public.sports_chat_messages', 'INSERT'));
select pg_temp.chk('01d istemci fanout / push talep RPC çalıştıramaz',
  not has_function_privilege('authenticated', 'public.sports_fanout_step(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.sports_push_claim(integer)', 'execute'));
select pg_temp.chk('01e API anahtarı veritabanında tutulmaz',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name like 'sports%'
               and column_name ~ '(api_key|secret|token)' and column_name <> 'api_key_present'));
select pg_temp.chk('01f bahis / para alanı yok',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name like 'sports_poll%'
               and column_name ~ '(stake|odds|amount|coin|price|bet|wager|prize)'));
select pg_temp.chk('01g skoru doğrudan değiştiren yönetici RPC yok',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname ~ '^sports_admin_.*(score|goal)'));
select pg_temp.as_u1();
select pg_temp.chk('01h normal kullanıcı yönetici RPC çağıramaz',
  pg_temp.err('select public.sports_admin_overview()') = 'insufficient_privilege');
select pg_temp.chk('01i normal kullanıcı TEST maçı oluşturamaz',
  pg_temp.err('select public.sports_admin_test_fixture_create(''X'', 30)') = 'insufficient_privilege');
select pg_temp.chk('01j normal kullanıcı TEST maçlarını göremez', not public.sports_can_see_test());

-- 2. TEST maçı oluşturma ------------------------------------------------------
select pg_temp.as_admin();
select public.sports_admin_test_fixture_create('TEST Rakip FK', 30);
select pg_temp.put('fx', to_jsonb((select min(id) from public.sports_fixtures where is_test and test_created_by = '9716b5e8-f794-4a79-a2f4-0d32f62a60c0')));
select pg_temp.chk('02a TEST maçı negatif kimlikle oluşturulur', pg_temp.fx() < 0, pg_temp.fx()::text);
select pg_temp.chk('02b yönetici TEST maçını görür', public.sports_can_see_test()
  and (public.sports_fixture_detail(pg_temp.fx()) #>> '{fixture,is_test}')::boolean);
select pg_temp.chk('02c TEST ön izlemesi yalnızca istenirse karta gelir',
  (public.sports_feed_card(true) #>> '{fixture,id}')::bigint = pg_temp.fx()
  and coalesce((public.sports_feed_card(false) #>> '{fixture,id}')::bigint, 0) <> pg_temp.fx(),
  public.sports_feed_card(true)::text);

-- 3. TEST izolasyonu ------------------------------------------------------------
select pg_temp.as_u1();
select pg_temp.chk('03a kullanıcı Feed kartında TEST maçını görmez',
  coalesce((public.sports_feed_card(true) #>> '{fixture,id}')::bigint, 0) <> pg_temp.fx());
select pg_temp.chk('03b kullanıcı TEST maç detayını açamaz',
  pg_temp.err(format('select public.sports_fixture_detail(%s)', pg_temp.fx())) = 'not_found');
select pg_temp.chk('03c fikstür listesinde TEST yok',
  not exists (select 1 from jsonb_array_elements(public.sports_fixtures_list('all', 60, 0, null)) e
               where (e ->> 'id')::bigint = pg_temp.fx()));
select pg_temp.chk('03d kullanıcı TEST sohbetine yazamaz',
  pg_temp.err(format('select public.sports_chat_send(%s, ''Merhaba'')', pg_temp.fx())) = 'not_found');
select pg_temp.chk('03e kullanıcı TEST maçına yorum yapamaz',
  pg_temp.err(format('select public.comment_add(''match'', %L::uuid, ''Yorum'')', pg_temp.fuid())) = 'content_not_found');
select pg_temp.as_anon();
select pg_temp.chk('03f anonim TEST maç detayını açamaz',
  pg_temp.err(format('select public.sports_fixture_detail(%s)', pg_temp.fx())) = 'not_found');
select pg_temp.chk('03g maç merkezi anonim okumada TEST göstermez',
  coalesce(public.sports_center()::text, '') not like '%' || pg_temp.fx()::text || '%');

-- 4. Bildirim tercihleri (onay) -------------------------------------------------
select pg_temp.as_u1();
select public.sports_prefs_set('{"enabled":true,"reminder":true,"lineups":true,"kickoff":true,"goal_for":true,
  "goal_against":true,"red_card":true,"half_time":true,"full_time":true,"postponed":true,"announcement":true}'::jsonb);
select pg_temp.chk('04a tercih kaydedilir', (public.sports_prefs_get() ->> 'enabled')::boolean);
delete from public.sports_notification_preferences where user_id = 'fab85a17-70d9-48e0-adcf-4014b44f199f';

-- 5. Canlı simülasyon: kadro, başlama, goller, VAR, kart, devre ------------------
select pg_temp.as_admin();
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'lineups');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'kickoff');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'minute');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'goal_for');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'minute');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'goal_for');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'minute');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'goal_against');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'var_cancel');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'red');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'stats');
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'half_time');

select pg_temp.chk('05a skor kaynaktan gelir: VAR sonrası 2-0',
  (select goals_home = 2 and goals_away = 0 from public.sports_fixtures where id = pg_temp.fx()),
  (select goals_home || '-' || goals_away from public.sports_fixtures where id = pg_temp.fx()));
select pg_temp.chk('05b devre arası fazı', (select phase = 'half_time' from public.sports_fixtures where id = pg_temp.fx()));
select pg_temp.chk('05c iptal edilen gol olay akışında geri çekildi olarak kalır',
  exists (select 1 from public.sports_fixture_events where fixture_id = pg_temp.fx() and kind = 'goal' and status = 'retracted'));
select pg_temp.chk('05d geçerli goller ve kırmızı kart akışta',
  (select count(*) from public.sports_fixture_events where fixture_id = pg_temp.fx() and kind = 'goal' and status <> 'retracted') = 2
  and exists (select 1 from public.sports_fixture_events where fixture_id = pg_temp.fx() and kind = 'red' and status <> 'retracted'));
select pg_temp.chk('05e kadro ve istatistik kaydedildi',
  (select count(*) from public.sports_fixture_lineups where fixture_id = pg_temp.fx()) = 2
  and (select count(*) from public.sports_fixture_statistics where fixture_id = pg_temp.fx()) = 2);
select pg_temp.chk('05f eksik istatistik sıfır yazılmaz (null kalır)',
  exists (select 1 from public.sports_fixture_statistics where fixture_id = pg_temp.fx() and stats ? 'yellow_cards'
           and stats -> 'yellow_cards' = 'null'::jsonb));
select pg_temp.chk('05g faz geçmişi tutulur',
  (select count(*) from public.sports_fixture_status_log where fixture_id = pg_temp.fx()) >= 3);
select pg_temp.chk('05h devre arası anketi otomatik açılır',
  exists (select 1 from public.sports_polls where fixture_id = pg_temp.fx() and kind = 'first_half'));
select pg_temp.chk('05i sistem mesajları sohbete düşer',
  (select count(*) from public.sports_chat_messages where fixture_id = pg_temp.fx() and kind = 'system') >= 2);

-- Aynı veri tekrar gelirse yinelenen olay / bildirim oluşmaz
select pg_temp.put('ev_before', to_jsonb((select count(*) from public.sports_fixture_events where fixture_id = pg_temp.fx())));
select pg_temp.put('nt_before', to_jsonb((select count(*) from public.sports_notification_events where fixture_id = pg_temp.fx())));
select public.sports_ingest_fixture(public.sports_test_payload(pg_temp.fx()),
  jsonb_build_object('kind', 'test', 'is_test', true, 'primary_side', 'home', 'actor', '9716b5e8-f794-4a79-a2f4-0d32f62a60c0'));
select public.sports_ingest_fixture(public.sports_test_payload(pg_temp.fx()),
  jsonb_build_object('kind', 'test', 'is_test', true, 'primary_side', 'home', 'actor', '9716b5e8-f794-4a79-a2f4-0d32f62a60c0'));
select pg_temp.chk('05j tekrar gelen veri olay çoğaltmaz',
  (select count(*) from public.sports_fixture_events where fixture_id = pg_temp.fx()) = (pg_temp.sv('ev_before') #>> '{}')::bigint);
select pg_temp.chk('05k tekrar gelen veri bildirim çoğaltmaz',
  (select count(*) from public.sports_notification_events where fixture_id = pg_temp.fx()) = (pg_temp.sv('nt_before') #>> '{}')::bigint);

-- 6. TEST bildirimleri ----------------------------------------------------------
select pg_temp.chk('06a beklenen bildirim türleri oluştu',
  (select array_agg(distinct type order by type) from public.sports_notification_events where fixture_id = pg_temp.fx())
    @> array['correction', 'goal_against', 'goal_for', 'half_time', 'kickoff', 'lineups', 'red_card'],
  (select string_agg(type || ':' || dedupe_key, ', ' order by created_at, type) from public.sports_notification_events where fixture_id = pg_temp.fx()));
select pg_temp.chk('06b iki farklı gol iki ayrı bildirim',
  (select count(*) from public.sports_notification_events where fixture_id = pg_temp.fx() and type = 'goal_for') = 2);
select pg_temp.chk('06c TEST bildirimleri işaretli ve [TEST] önekli',
  not exists (select 1 from public.sports_notification_events where fixture_id = pg_temp.fx()
               and (not is_test or title not like '[TEST]%')));
select pg_temp.chk('06d VAR düzeltmesi düzeltme bildirimi üretir',
  exists (select 1 from public.sports_notification_events where fixture_id = pg_temp.fx() and type = 'correction'
           and dedupe_key like 'corr:goal:against%'),
  (select string_agg(dedupe_key, ', ') from public.sports_notification_events where fixture_id = pg_temp.fx() and type = 'correction'));
select pg_temp.put('steps', to_jsonb(pg_temp.fanout()));
select pg_temp.chk('06e TEST bildirimi onay vermiş gerçek kullanıcıya gitmez',
  pg_temp.inapp('45640e53-dee5-44d4-a5e4-5ce8cd1140c9') = 0);
select pg_temp.chk('06f TEST bildirimi yalnızca oluşturan yöneticiye gider',
  pg_temp.inapp('9716b5e8-f794-4a79-a2f4-0d32f62a60c0') = (select count(*) from public.sports_notification_events where fixture_id = pg_temp.fx())
  and not exists (select 1 from public.sports_notification_deliveries d join public.sports_notification_events e on e.id = d.notification_event_id
                   where e.fixture_id = pg_temp.fx() and d.user_id <> '9716b5e8-f794-4a79-a2f4-0d32f62a60c0'),
  pg_temp.inapp('9716b5e8-f794-4a79-a2f4-0d32f62a60c0')::text);
select pg_temp.chk('06g bildirim derin bağlantısı maç arenası',
  not exists (select 1 from public.notifications where kind = 'sports' and entity_id = pg_temp.fx()::text
               and route <> '/trabzonspor/mac/' || pg_temp.fx()));
select pg_temp.chk('06h tüm bildirim olayları işlendi',
  not exists (select 1 from public.sports_notification_events where fixture_id = pg_temp.fx()
               and processing_status in ('pending', 'fanning_out')));

-- 7. Denetim izi ----------------------------------------------------------------
select pg_temp.chk('07a her TEST adımı denetim kaydına yazılır',
  (select count(*) from public.sports_admin_audit_logs where target_id = pg_temp.fx()::text and action = 'test_fixture_step') = 12);
select pg_temp.as_admin();
select pg_temp.chk('07b gerekçesiz kritik işlem reddedilir',
  pg_temp.err(format('select public.sports_admin_fixture_action(%s, ''pin'', '''')', pg_temp.fx())) = 'sports_reason_required');
select public.sports_admin_event_action(
  (select id from public.sports_fixture_events where fixture_id = pg_temp.fx() and kind = 'red' limit 1), 'hide', 'Smoke: olay gizleme');
select pg_temp.chk('07c olay gizleme önce/sonra ile denetlenir',
  exists (select 1 from public.sports_admin_audit_logs where action = 'event_hide' and reason = 'Smoke: olay gizleme'
           and before_data is not null and after_data is not null));
select pg_temp.chk('07d gizlenen olay kaydı silinmez',
  exists (select 1 from public.sports_fixture_events where fixture_id = pg_temp.fx() and kind = 'red'));

-- 8. Gerçek maç senaryosu: gerçek ingest yolu (işlem sonunda geri alınır) --------
select pg_temp.put('tfx', to_jsonb(pg_temp.fx()));
select pg_temp.chk('08a TEST maçı gerçek maça çevrilemez (veritabanı kısıtı)',
  pg_temp.err(format('update public.sports_fixtures set is_test = false where id = %s', pg_temp.fx())) like '%sports_fixtures_test_id%');
update public.sports_settings set team_id = 990001 where id = 1;
create function pg_temp.real_payload(p_id bigint, p_home bigint, p_away bigint) returns jsonb language sql as $$
  select jsonb_build_object(
    'fixture', jsonb_build_object('id', p_id, 'timestamp', extract(epoch from now() - interval '50 minutes')::bigint, 'timezone', 'UTC',
                                  'referee', 'Smoke Hakem', 'venue', jsonb_build_object('name', 'Smoke Stadı', 'city', 'Trabzon'),
                                  'status', jsonb_build_object('short', '2H', 'long', 'Second Half', 'elapsed', 50, 'extra', null)),
    'league', jsonb_build_object('id', 203, 'name', 'Smoke Ligi', 'country', 'Turkey', 'season', 2026, 'round', 'Smoke'),
    'teams', jsonb_build_object('home', jsonb_build_object('id', p_home, 'name', 'Smoke Ev'),
                                'away', jsonb_build_object('id', p_away, 'name', 'Smoke Deplasman')),
    'goals', jsonb_build_object('home', 1, 'away', 0),
    'score', jsonb_build_object('halftime', jsonb_build_object('home', 1, 'away', 0)));
$$;
select pg_temp.as_service();
select pg_temp.chk('08b ana takımın oynamadığı maç alınmaz',
  public.sports_ingest_fixture(pg_temp.real_payload(2000000002, 5, 6), '{"kind":"live"}') ->> 'skipped' = 'not_primary_team');
select pg_temp.chk('08c TEST / gerçek kimlik karışamaz',
  pg_temp.err('select public.sports_ingest_fixture(pg_temp.real_payload(2000000003, 990001, 6), ''{"kind":"test","is_test":true}'')') = 'sports_invalid_payload');
select public.sports_ingest_fixture(pg_temp.real_payload(2000000001, 990001, 990002), '{"kind":"live"}');
select pg_temp.put('fx', to_jsonb(2000000001));
select pg_temp.as_u1();
select pg_temp.chk('08d canlı gerçek maç kullanıcının Feed kartında',
  (public.sports_feed_card(false) #>> '{fixture,id}')::bigint = pg_temp.fx() and public.sports_feed_card(false) ->> 'mode' = 'live',
  left(public.sports_feed_card(false)::text, 200));
select pg_temp.as_admin();
select pg_temp.chk('08e TEST simülatörü gerçek maça dokunamaz',
  pg_temp.err(format('select public.sports_admin_test_fixture_step(%s, ''goal_for'')', pg_temp.fx())) = 'not_found');
select pg_temp.chk('08f TEST silme gerçek maçı silemez',
  pg_temp.err(format('select public.sports_admin_test_fixture_delete(%s)', pg_temp.fx())) = 'not_found');

-- 9. Canlı sohbet kuralları ----------------------------------------------------
select pg_temp.as_anon();
select pg_temp.chk('09a anonim mesaj gönderemez',
  pg_temp.err(format('select public.sports_chat_send(%s, ''Anonim'')', pg_temp.fx())) = 'not_authenticated');
select pg_temp.as_u1();
select pg_temp.chk('09b oturum açmış kullanıcı sohbeti görür',
  public.sports_chat_state(pg_temp.fx()) ->> 'state' = 'open', public.sports_chat_state(pg_temp.fx())::text);
select pg_temp.put('m1', public.sports_chat_send(pg_temp.fx(), 'Hadi Trabzon!', null, '00000000-0000-4000-8000-000000000001'));
select pg_temp.chk('09c mesaj gönderilir', (pg_temp.sv('m1') ->> 'id') is not null, pg_temp.sv('m1')::text);
select pg_temp.chk('09d aynı client_id tekrar gönderilince yeni mesaj oluşmaz',
  public.sports_chat_send(pg_temp.fx(), 'Hadi Trabzon!', null, '00000000-0000-4000-8000-000000000001') ->> 'id' = pg_temp.sv('m1') ->> 'id');
select pg_temp.chk('09e yinelenen mesaj reddedilir',
  pg_temp.err(format('select public.sports_chat_send(%s, ''hadi   trabzon!'')', pg_temp.fx())) = 'sports_chat_duplicate');
select pg_temp.chk('09f bağlantı engellenir',
  pg_temp.err(format('select public.sports_chat_send(%s, ''bak www.ornek.com'')', pg_temp.fx())) = 'sports_chat_link_blocked');
select pg_temp.chk('09g karakter tekrarı spam sayılır',
  pg_temp.err(format('select public.sports_chat_send(%s, ''gooooooooooooooooool'')', pg_temp.fx())) = 'sports_chat_spam');
select pg_temp.chk('09h uzunluk sınırı',
  pg_temp.err(format('select public.sports_chat_send(%s, %L)', pg_temp.fx(), repeat('ab ', 100))) = 'sports_chat_invalid_length');
select public.sports_chat_send(pg_temp.fx(), 'Mesaj ' || g) from generate_series(2, 8) g;
select pg_temp.chk('09i dakikalık hız sınırı',
  pg_temp.err(format('select public.sports_chat_send(%s, ''Mesaj 9'')', pg_temp.fx())) = 'rate_limited');

select pg_temp.as_admin();
select public.sports_admin_fixture_action(pg_temp.fx(), 'slow_mode', 'Smoke: yavaş mod', '{"seconds":30}');
select pg_temp.as_u2();
select public.sports_chat_send(pg_temp.fx(), 'Yavaş 1');
select pg_temp.chk('09j yavaş mod',
  pg_temp.err(format('select public.sports_chat_send(%s, ''Yavaş 2'')', pg_temp.fx())) = 'sports_chat_slow_mode');
select pg_temp.chk('09k kendi mesajını şikayet edemez',
  pg_temp.err(format('select public.sports_chat_report(%s, ''spam'')',
    (select max(id) from public.sports_chat_messages where fixture_id = pg_temp.fx() and user_id = 'fab85a17-70d9-48e0-adcf-4014b44f199f'))) = 'not_allowed');
select public.sports_chat_report((pg_temp.sv('m1') ->> 'id')::bigint, 'spam', 'smoke');
select pg_temp.chk('09l şikayet kaydedilir',
  exists (select 1 from public.sports_chat_reports where message_id = (pg_temp.sv('m1') ->> 'id')::bigint));

select pg_temp.as_admin();
select public.sports_admin_sanction_by_username('u_fab85a1770', 'mute', 30, 'Smoke: susturma', pg_temp.fx());
select pg_temp.as_u2();
select pg_temp.chk('09m susturulan kullanıcı yazamaz',
  pg_temp.err(format('select public.sports_chat_send(%s, ''Yavaş 3'')', pg_temp.fx())) = 'sports_chat_sanctioned');

select pg_temp.as_admin();
select public.sports_chat_mod_remove((pg_temp.sv('m1') ->> 'id')::bigint, 'Smoke: kaldırma');
select pg_temp.chk('09n moderatör mesajı kaldırır, metin listede görünmez',
  (select status from public.sports_chat_messages where id = (pg_temp.sv('m1') ->> 'id')::bigint) = 'removed'
  and not exists (select 1 from jsonb_array_elements(public.sports_chat_list(pg_temp.fx(), null, null, 100) -> 'items') e
                   where (e ->> 'id')::bigint = (pg_temp.sv('m1') ->> 'id')::bigint and e ->> 'body' = 'Hadi Trabzon!'));
select public.sports_admin_fixture_action(pg_temp.fx(), 'chat_pin', 'Smoke: duyuru', '{"body":"Saygılı olalım."}');
select pg_temp.chk('09o sabit duyuru', public.sports_chat_state(pg_temp.fx()) #>> '{pinned,body}' = 'Saygılı olalım.',
  public.sports_chat_state(pg_temp.fx())::text);
select public.sports_admin_fixture_action(pg_temp.fx(), 'chat_close', 'Smoke: kapatma');
select pg_temp.as_u1();
select pg_temp.chk('09p kapalı sohbete yazılamaz',
  pg_temp.err(format('select public.sports_chat_send(%s, ''Kapalı'')', pg_temp.fx())) = 'sports_chat_closed');
select pg_temp.chk('09q sohbet işlemleri denetlenir',
  (select count(*) from public.sports_admin_audit_logs where target_id = pg_temp.fx()::text
     and action in ('fixture_slow_mode', 'fixture_chat_pin', 'fixture_chat_close')) = 3);

-- 10. Anketler: kişi başı tek oy, para / bahis yok ---------------------------------
select pg_temp.as_admin();
select public.sports_admin_poll_create(pg_temp.fx(), 'Bugünün en iyisi kim?', array['Oyuncu A', 'Oyuncu B'], null, false, 'after_vote', 'Smoke: anket');
select pg_temp.put('poll', to_jsonb((select id from public.sports_polls where fixture_id = pg_temp.fx() and kind = 'custom' limit 1)));
select pg_temp.put('optA', to_jsonb((select min(id::text) from public.sports_poll_options where poll_id = (pg_temp.sv('poll') #>> '{}')::uuid)));
select pg_temp.put('optB', to_jsonb((select max(id::text) from public.sports_poll_options where poll_id = (pg_temp.sv('poll') #>> '{}')::uuid)));
select pg_temp.as_anon();
select pg_temp.chk('10a anonim oy veremez',
  pg_temp.err(format('select public.sports_poll_vote(%L::uuid, %L::uuid)', pg_temp.sv('poll') #>> '{}', pg_temp.sv('optA') #>> '{}')) = 'not_authenticated');
select pg_temp.as_u1();
select public.sports_poll_vote((pg_temp.sv('poll') #>> '{}')::uuid, (pg_temp.sv('optA') #>> '{}')::uuid);
select pg_temp.chk('10b ikinci farklı oy reddedilir',
  pg_temp.err(format('select public.sports_poll_vote(%L::uuid, %L::uuid)', pg_temp.sv('poll') #>> '{}', pg_temp.sv('optB') #>> '{}')) = 'sports_poll_already_voted');
select public.sports_poll_vote((pg_temp.sv('poll') #>> '{}')::uuid, (pg_temp.sv('optA') #>> '{}')::uuid);
select pg_temp.chk('10c aynı oy tekrarı sayılmaz',
  (select count(*) from public.sports_poll_votes where poll_id = (pg_temp.sv('poll') #>> '{}')::uuid) = 1);
select pg_temp.as_u2();
select public.sports_poll_vote((pg_temp.sv('poll') #>> '{}')::uuid, (pg_temp.sv('optB') #>> '{}')::uuid);
select pg_temp.chk('10d sonuçlar gerçek oylardan hesaplanır',
  (select sum(votes) from public.sports_poll_options where poll_id = (pg_temp.sv('poll') #>> '{}')::uuid) = 2
  and (select total_votes from public.sports_polls where id = (pg_temp.sv('poll') #>> '{}')::uuid) = 2);
select pg_temp.as_admin();
select public.sports_admin_poll_action((pg_temp.sv('poll') #>> '{}')::uuid, 'close', 'Smoke: kapat');
select pg_temp.as_u1();
select pg_temp.chk('10e kapanan ankete oy verilemez',
  pg_temp.err(format('select public.sports_poll_vote(%L::uuid, %L::uuid)', pg_temp.sv('poll') #>> '{}', pg_temp.sv('optB') #>> '{}')) = 'sports_poll_closed');

-- 11. Yorumlar (mevcut premium yorum sistemi, `match` içerik türü) ---------------
select pg_temp.as_u1();
select pg_temp.put('c1', public.comment_add('match', pg_temp.fuid(), 'İkinci yarı da baskı sürsün.'));
select pg_temp.chk('11a maça yorum eklenir', (pg_temp.sv('c1') ->> 'id') is not null, pg_temp.sv('c1')::text);
select pg_temp.as_u2();
select pg_temp.put('c2', public.comment_add('match', pg_temp.fuid(), 'Katılıyorum.', (pg_temp.sv('c1') ->> 'id')::uuid));
select pg_temp.chk('11b yanıt aynı başlığa bağlanır',
  (select parent_id from public.sports_fixture_comments where id = (pg_temp.sv('c2') ->> 'id')::uuid) = (pg_temp.sv('c1') ->> 'id')::uuid);
select pg_temp.chk('11c yorum metni ve sırası değişmeden listelenir',
  public.comment_list('match', pg_temp.fuid(), 20, 0)::text like '%İkinci yarı da baskı sürsün.%');
select pg_temp.chk('11d yanıt bildirimi yorumu açan derin bağlantıyla gelir',
  exists (select 1 from public.notifications where user_id = '45640e53-dee5-44d4-a5e4-5ce8cd1140c9'
           and kind = 'comment' and entity_type = 'match' and created_at >= now()
           and route = '/trabzonspor/mac/' || pg_temp.fx() || '?tab=comments&comment=' || (pg_temp.sv('c2') ->> 'id')));
select pg_temp.as_admin();
select public.sports_admin_fixture_action(pg_temp.fx(), 'lock_comments', 'Smoke: kilit');
select pg_temp.as_u1();
select pg_temp.chk('11e kilitli maçta yorum yapılamaz',
  pg_temp.err(format('select public.comment_add(''match'', %L::uuid, ''Yeni'')', pg_temp.fuid())) = 'comments_locked');

-- 12. Taraftar medyası ----------------------------------------------------------
select pg_temp.put('post_other', to_jsonb((select id from public.posts where author_id <> '45640e53-dee5-44d4-a5e4-5ce8cd1140c9'
                                             and visibility = 'public' and moderation_status = 'visible' limit 1)));
select pg_temp.chk('12a başkasının gönderisi maça eklenemez',
  pg_temp.sv('post_other') = 'null'::jsonb
  or pg_temp.err(format('select public.sports_media_attach(%s, %L::uuid, ''opinion'')', pg_temp.fx(), pg_temp.sv('post_other') #>> '{}')) = 'not_allowed');
select pg_temp.chk('12b geçersiz kategori reddedilir',
  pg_temp.err(format('select public.sports_media_attach(%s, gen_random_uuid(), ''broadcast'')', pg_temp.fx())) = 'invalid_input');

-- 13. Gerçek maç bildirimi: yalnızca onay veren, sessize almayan kullanıcı ---------
select pg_temp.fanout();
select pg_temp.put('u1_base', to_jsonb(pg_temp.inapp('45640e53-dee5-44d4-a5e4-5ce8cd1140c9')));
select pg_temp.as_admin();
select public.sports_admin_announcement(pg_temp.fx(), 'Maç duyurusu', 'Smoke duyuru metni', 'Smoke: duyuru');
select pg_temp.fanout();
select pg_temp.chk('13a onay veren kullanıcı duyuruyu alır',
  pg_temp.inapp('45640e53-dee5-44d4-a5e4-5ce8cd1140c9') = (pg_temp.sv('u1_base') #>> '{}')::int + 1,
  pg_temp.inapp('45640e53-dee5-44d4-a5e4-5ce8cd1140c9')::text);
select pg_temp.chk('13b onay vermeyen kullanıcı almaz', pg_temp.inapp('fab85a17-70d9-48e0-adcf-4014b44f199f') = 0);
select pg_temp.chk('13c yalnızca tercihi açık kullanıcılara gider',
  not exists (select 1 from public.notifications n
               where n.kind = 'sports' and n.entity_id = pg_temp.fx()::text and n.title = 'Maç duyurusu'
                 and not exists (select 1 from public.sports_notification_preferences p
                                  where p.user_id = n.user_id and p.enabled and p.announcement)));
select pg_temp.as_u1();
select public.sports_fixture_mute(pg_temp.fx(), true);
select pg_temp.as_admin();
select public.sports_admin_announcement(pg_temp.fx(), 'İkinci duyuru', 'Smoke duyuru metni 2', 'Smoke: duyuru 2');
select pg_temp.fanout();
select pg_temp.chk('13d maçı sessize alan kullanıcı almaz',
  pg_temp.inapp('45640e53-dee5-44d4-a5e4-5ce8cd1140c9') = (pg_temp.sv('u1_base') #>> '{}')::int + 1);
select pg_temp.as_u1();
select pg_temp.chk('13e uygulama içi bildirim geçmişi',
  jsonb_array_length(coalesce(public.sports_notification_history(20, 0) -> 'items', '[]'::jsonb)) >= 1,
  left(public.sports_notification_history(20, 0)::text, 200));

-- 14. TEST maçını bitir ve sil -------------------------------------------------
select pg_temp.put('fx', pg_temp.sv('tfx'));
select pg_temp.as_admin();
select public.sports_admin_test_fixture_step(pg_temp.fx(), 'full_time');
select pg_temp.chk('14a maç sonu bildirimi TEST olarak üretilir',
  exists (select 1 from public.sports_notification_events where fixture_id = pg_temp.fx() and type = 'full_time' and is_test));
select pg_temp.chk('14b maç sonucu doğrulanana kadar final_verified=false',
  (select final_verified_at is null from public.sports_fixtures where id = pg_temp.fx())
  and not (public.sports_fixture_detail(pg_temp.fx()) #>> '{fixture,final_verified}')::boolean);
select public.sports_admin_test_fixture_delete(pg_temp.fx());
select pg_temp.chk('14c TEST maçı ve bağlı veriler silinir',
  not exists (select 1 from public.sports_fixtures where id = pg_temp.fx())
  and not exists (select 1 from public.sports_fixture_events where fixture_id = pg_temp.fx())
  and not exists (select 1 from public.sports_chat_messages where fixture_id = pg_temp.fx()));
select pg_temp.chk('14d silme denetim kaydına yazılır',
  exists (select 1 from public.sports_admin_audit_logs where action = 'test_fixture_deleted' and target_id = pg_temp.fx()::text));

select n, name, ok, detail from _t order by n;

rollback;
