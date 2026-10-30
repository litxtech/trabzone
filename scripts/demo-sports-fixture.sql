-- ---------------------------------------------------------------------------
-- Maç Arenası için örnek (demo) veri.
--
-- Amaç: spor veri sağlayıcısı henüz bağlı değilken (api_key_present = false)
-- maç merkezini, maç günü şeridini, yorumlaşmayı ve canlı sohbeti uçtan uca
-- göstermek. Gerçek sağlayıcı bağlandığında bu satırlar silinmelidir:
--   node scripts/db-apply.mjs scripts/demo-sports-fixture-clear.sql
--
-- Demo maçlarının kimlikleri 990000001-990000004 aralığındadır; API-Football
-- kimlikleriyle çakışmaz. Lig adları "(Örnek)" ile işaretlidir.
-- ---------------------------------------------------------------------------

-- 1) Trabzonspor takım kaydı ve maç merkezi ayarı ---------------------------
insert into public.sports_teams (id, name, code, country, logo_url, founded, national, venue)
values (998, 'Trabzonspor', 'TRA', 'Turkey', null, 1967, false,
        jsonb_build_object('name', 'Papara Park', 'city', 'Trabzon', 'capacity', 40782))
on conflict (id) do update
  set name = excluded.name,
      code = excluded.code,
      country = excluded.country,
      venue = excluded.venue,
      updated_at = now();

update public.sports_settings
   set team_id = 998,
       team_search = 'Trabzonspor',
       season = 2026,
       team_verified_at = coalesce(team_verified_at, now())
 where id = 1;

-- 2) Demo maçlar ------------------------------------------------------------
-- Canlı maç: 2-1, ikinci yarı. Olaylar, istatistikler ve kadrolar dolu.
select public.sports_ingest_fixture(
  jsonb_build_object(
    'fixture', jsonb_build_object(
      'id', 990000001,
      'timestamp', extract(epoch from now() - interval '65 minutes')::bigint,
      'timezone', 'Europe/Istanbul',
      'referee', 'Örnek Hakem',
      'venue', jsonb_build_object('name', 'Papara Park', 'city', 'Trabzon'),
      'status', jsonb_build_object('short', '2H', 'long', 'Second Half', 'elapsed', 67)
    ),
    'league', jsonb_build_object(
      'id', 203, 'name', 'Trendyol Süper Lig (Örnek)', 'type', 'League',
      'country', 'Turkey', 'season', 2026, 'round', 'Regular Season - 12'
    ),
    'teams', jsonb_build_object(
      'home', jsonb_build_object('id', 998, 'name', 'Trabzonspor'),
      'away', jsonb_build_object('id', 611, 'name', 'Fenerbahçe')
    ),
    'goals', jsonb_build_object('home', 2, 'away', 1),
    'score', jsonb_build_object(
      'halftime', jsonb_build_object('home', 1, 'away', 0),
      'fulltime', jsonb_build_object('home', null, 'away', null)
    ),
    'events', jsonb_build_array(
      jsonb_build_object('time', jsonb_build_object('elapsed', 18, 'extra', null),
        'team', jsonb_build_object('id', 998, 'name', 'Trabzonspor'),
        'player', jsonb_build_object('id', 1, 'name', 'A. Onuachu'),
        'assist', jsonb_build_object('id', 2, 'name', 'E. Višća'),
        'type', 'Goal', 'detail', 'Normal Goal', 'comments', null),
      jsonb_build_object('time', jsonb_build_object('elapsed', 41, 'extra', null),
        'team', jsonb_build_object('id', 611, 'name', 'Fenerbahçe'),
        'player', jsonb_build_object('id', 3, 'name', 'E. Dzeko'),
        'assist', jsonb_build_object('id', null, 'name', null),
        'type', 'Card', 'detail', 'Yellow Card', 'comments', 'Sert müdahale'),
      jsonb_build_object('time', jsonb_build_object('elapsed', 58, 'extra', null),
        'team', jsonb_build_object('id', 998, 'name', 'Trabzonspor'),
        'player', jsonb_build_object('id', 4, 'name', 'Trezeguet'),
        'assist', jsonb_build_object('id', 5, 'name', 'O. Bakasetas'),
        'type', 'Goal', 'detail', 'Normal Goal', 'comments', null),
      jsonb_build_object('time', jsonb_build_object('elapsed', 63, 'extra', null),
        'team', jsonb_build_object('id', 611, 'name', 'Fenerbahçe'),
        'player', jsonb_build_object('id', 6, 'name', 'İ. Kahveci'),
        'assist', jsonb_build_object('id', null, 'name', null),
        'type', 'Goal', 'detail', 'Normal Goal', 'comments', null)
    ),
    'statistics', jsonb_build_array(
      jsonb_build_object('team', jsonb_build_object('id', 998), 'statistics', jsonb_build_array(
        jsonb_build_object('type', 'Ball Possession', 'value', '54%'),
        jsonb_build_object('type', 'Total Shots', 'value', 12),
        jsonb_build_object('type', 'Shots on Goal', 'value', 6),
        jsonb_build_object('type', 'Corner Kicks', 'value', 5),
        jsonb_build_object('type', 'Fouls', 'value', 9),
        jsonb_build_object('type', 'Yellow Cards', 'value', 1),
        jsonb_build_object('type', 'Passes accurate', 'value', 312),
        jsonb_build_object('type', 'expected_goals', 'value', '1.86')
      )),
      jsonb_build_object('team', jsonb_build_object('id', 611), 'statistics', jsonb_build_array(
        jsonb_build_object('type', 'Ball Possession', 'value', '46%'),
        jsonb_build_object('type', 'Total Shots', 'value', 9),
        jsonb_build_object('type', 'Shots on Goal', 'value', 4),
        jsonb_build_object('type', 'Corner Kicks', 'value', 3),
        jsonb_build_object('type', 'Fouls', 'value', 12),
        jsonb_build_object('type', 'Yellow Cards', 'value', 2),
        jsonb_build_object('type', 'Passes accurate', 'value', 268),
        jsonb_build_object('type', 'expected_goals', 'value', '1.12')
      ))
    ),
    'lineups', jsonb_build_array(
      jsonb_build_object(
        'team', jsonb_build_object('id', 998, 'name', 'Trabzonspor'),
        'formation', '4-2-3-1',
        'startXI', jsonb_build_array(
          jsonb_build_object('player', jsonb_build_object('id', 101, 'name', 'U. Çakır', 'number', 1, 'pos', 'G')),
          jsonb_build_object('player', jsonb_build_object('id', 102, 'name', 'J. Larsen', 'number', 2, 'pos', 'D')),
          jsonb_build_object('player', jsonb_build_object('id', 103, 'name', 'S. Denswil', 'number', 4, 'pos', 'D')),
          jsonb_build_object('player', jsonb_build_object('id', 104, 'name', 'B. Batahov', 'number', 5, 'pos', 'D')),
          jsonb_build_object('player', jsonb_build_object('id', 105, 'name', 'A. Elmalı', 'number', 3, 'pos', 'D')),
          jsonb_build_object('player', jsonb_build_object('id', 106, 'name', 'O. Bakasetas', 'number', 8, 'pos', 'M')),
          jsonb_build_object('player', jsonb_build_object('id', 107, 'name', 'B. Mendy', 'number', 6, 'pos', 'M')),
          jsonb_build_object('player', jsonb_build_object('id', 108, 'name', 'E. Višća', 'number', 7, 'pos', 'M')),
          jsonb_build_object('player', jsonb_build_object('id', 109, 'name', 'Trezeguet', 'number', 10, 'pos', 'M')),
          jsonb_build_object('player', jsonb_build_object('id', 110, 'name', 'A. Nwakaeme', 'number', 11, 'pos', 'M')),
          jsonb_build_object('player', jsonb_build_object('id', 111, 'name', 'A. Onuachu', 'number', 9, 'pos', 'F'))
        ),
        'substitutes', jsonb_build_array(
          jsonb_build_object('player', jsonb_build_object('id', 112, 'name', 'M. Tepe', 'number', 12, 'pos', 'G')),
          jsonb_build_object('player', jsonb_build_object('id', 113, 'name', 'S. Şen', 'number', 14, 'pos', 'M')),
          jsonb_build_object('player', jsonb_build_object('id', 114, 'name', 'U. Nayır', 'number', 17, 'pos', 'F'))
        )
      ),
      jsonb_build_object(
        'team', jsonb_build_object('id', 611, 'name', 'Fenerbahçe'),
        'formation', '4-3-3',
        'startXI', jsonb_build_array(
          jsonb_build_object('player', jsonb_build_object('id', 201, 'name', 'İ. Eğribayat', 'number', 1, 'pos', 'G')),
          jsonb_build_object('player', jsonb_build_object('id', 202, 'name', 'M. Müldür', 'number', 2, 'pos', 'D')),
          jsonb_build_object('player', jsonb_build_object('id', 203, 'name', 'Ç. Söyüncü', 'number', 4, 'pos', 'D')),
          jsonb_build_object('player', jsonb_build_object('id', 204, 'name', 'A. Djiku', 'number', 5, 'pos', 'D')),
          jsonb_build_object('player', jsonb_build_object('id', 205, 'name', 'L. Mercan', 'number', 3, 'pos', 'D')),
          jsonb_build_object('player', jsonb_build_object('id', 206, 'name', 'İ. Kahveci', 'number', 8, 'pos', 'M')),
          jsonb_build_object('player', jsonb_build_object('id', 207, 'name', 'F. Fred', 'number', 6, 'pos', 'M')),
          jsonb_build_object('player', jsonb_build_object('id', 208, 'name', 'S. Szymański', 'number', 10, 'pos', 'M')),
          jsonb_build_object('player', jsonb_build_object('id', 209, 'name', 'D. Tadić', 'number', 7, 'pos', 'F')),
          jsonb_build_object('player', jsonb_build_object('id', 210, 'name', 'E. Dzeko', 'number', 9, 'pos', 'F')),
          jsonb_build_object('player', jsonb_build_object('id', 211, 'name', 'K. Aktürkoğlu', 'number', 11, 'pos', 'F'))
        ),
        'substitutes', jsonb_build_array(
          jsonb_build_object('player', jsonb_build_object('id', 212, 'name', 'D. Livaković', 'number', 12, 'pos', 'G')),
          jsonb_build_object('player', jsonb_build_object('id', 213, 'name', 'İ. Yüksek', 'number', 16, 'pos', 'M')),
          jsonb_build_object('player', jsonb_build_object('id', 214, 'name', 'C. Ünder', 'number', 17, 'pos', 'F'))
        )
      )
    )
  ),
  jsonb_build_object('kind', 'demo')
);

-- Gelecek maçlar: maç günü şeridi birden fazla gün göstersin.
select public.sports_ingest_fixture(
  jsonb_build_object(
    'fixture', jsonb_build_object(
      'id', 990000002,
      'timestamp', extract(epoch from (now() + interval '2 days'))::bigint,
      'timezone', 'Europe/Istanbul',
      'venue', jsonb_build_object('name', 'Papara Park', 'city', 'Trabzon'),
      'status', jsonb_build_object('short', 'NS', 'long', 'Not Started')
    ),
    'league', jsonb_build_object('id', 203, 'name', 'Trendyol Süper Lig (Örnek)', 'type', 'League',
                                 'country', 'Turkey', 'season', 2026, 'round', 'Regular Season - 13'),
    'teams', jsonb_build_object(
      'home', jsonb_build_object('id', 998, 'name', 'Trabzonspor'),
      'away', jsonb_build_object('id', 549, 'name', 'Beşiktaş')
    ),
    'goals', jsonb_build_object('home', null, 'away', null),
    'score', '{}'::jsonb
  ),
  jsonb_build_object('kind', 'demo')
);

select public.sports_ingest_fixture(
  jsonb_build_object(
    'fixture', jsonb_build_object(
      'id', 990000003,
      'timestamp', extract(epoch from (now() + interval '6 days' + interval '20 hours'))::bigint,
      'timezone', 'Europe/Istanbul',
      'venue', jsonb_build_object('name', 'Papara Park', 'city', 'Trabzon'),
      'status', jsonb_build_object('short', 'NS', 'long', 'Not Started')
    ),
    'league', jsonb_build_object('id', 203, 'name', 'Trendyol Süper Lig (Örnek)', 'type', 'League',
                                 'country', 'Turkey', 'season', 2026, 'round', 'Regular Season - 14'),
    'teams', jsonb_build_object(
      'home', jsonb_build_object('id', 998, 'name', 'Trabzonspor'),
      'away', jsonb_build_object('id', 564, 'name', 'Başakşehir')
    ),
    'goals', jsonb_build_object('home', null, 'away', null),
    'score', '{}'::jsonb
  ),
  jsonb_build_object('kind', 'demo')
);

-- Geçmiş maç: "Sonuçlar" sekmesi dolu görünsün.
select public.sports_ingest_fixture(
  jsonb_build_object(
    'fixture', jsonb_build_object(
      'id', 990000004,
      'timestamp', extract(epoch from (now() - interval '6 days'))::bigint,
      'timezone', 'Europe/Istanbul',
      'venue', jsonb_build_object('name', 'RAMS Park', 'city', 'İstanbul'),
      'status', jsonb_build_object('short', 'FT', 'long', 'Match Finished')
    ),
    'league', jsonb_build_object('id', 203, 'name', 'Trendyol Süper Lig (Örnek)', 'type', 'League',
                                 'country', 'Turkey', 'season', 2026, 'round', 'Regular Season - 11'),
    'teams', jsonb_build_object(
      'home', jsonb_build_object('id', 645, 'name', 'Galatasaray'),
      'away', jsonb_build_object('id', 998, 'name', 'Trabzonspor')
    ),
    'goals', jsonb_build_object('home', 1, 'away', 1),
    'score', jsonb_build_object(
      'halftime', jsonb_build_object('home', 1, 'away', 0),
      'fulltime', jsonb_build_object('home', 1, 'away', 1)
    )
  ),
  jsonb_build_object('kind', 'demo')
);

-- Demo maçları sabitle: maç merkezi öne çıkan kartı ve şeridi bu maçlarla dolsun.
update public.sports_fixtures
   set feature_state = 'auto'
 where id in (990000001, 990000002);

-- 3) Yorumlaşma ------------------------------------------------------------
-- Yorumlar gerçek profillerle yazılır; `sports_fixture_comments` fixture uid'i ile bağlanır.
with demo_authors as (
  select id, row_number() over (order by created_at) as rn
    from public.profiles
   where username is not null
   order by created_at
   limit 6
),
live as (
  select uid from public.sports_fixtures where id = 990000001
),
seeded as (
  insert into public.sports_fixture_comments (fixture_uid, author_id, body, created_at)
  select live.uid, a.id, v.body, now() - v.age
    from (values
      (1, 'Onuachu bu takımın her şeyi. 18''deki gol tam bir santrafor golüydü.', interval '48 minutes'),
      (2, 'Orta saha kontrolü bu maçta çok iyi. Bakasetas oynadıkça takım bambaşka.', interval '41 minutes'),
      (3, 'İkinci yarı başladı, aynı tempoyu korumalıyız. Hadi Trabzon!', interval '30 minutes'),
      (4, 'Trezeguet''in golünde verilen pas harikaydı, alkışlanacak bir organize atak.', interval '12 minutes'),
      (5, 'Rakip 63''te attı ama biz daha üstünüz. Maç bizim.', interval '6 minutes'),
      (6, 'Savunmada Denswil bugün kusursuz oynuyor.', interval '4 minutes')
    ) as v(seq, body, age)
    join demo_authors a on a.rn = v.seq
    cross join live
  returning id, body
)
insert into public.comment_likes (comment_id, content_type, user_id, created_at)
select s.id, 'match', a.id, now() - interval '1 minute'
  from seeded s
  join demo_authors a on a.rn <= 3
 where s.body like 'Onuachu%' or s.body like 'Orta saha%'
on conflict do nothing;

-- Beğeni sayacı tabloda ayrı tutulduğu için elle eşitlenir.
update public.sports_fixture_comments c
   set like_count = (select count(*) from public.comment_likes l
                      where l.comment_id = c.id and l.content_type = 'match')
 where c.fixture_uid = (select uid from public.sports_fixtures where id = 990000001);

-- Bir yanıt zinciri: ilk yorumun altına iki yanıt.
with live as (
  select uid from public.sports_fixtures where id = 990000001
),
parent as (
  select c.id from public.sports_fixture_comments c
    join live on live.uid = c.fixture_uid
   where c.parent_id is null
   order by c.created_at
   limit 1
),
authors as (
  select id, row_number() over (order by created_at desc) as rn
    from public.profiles where username is not null order by created_at desc limit 2
)
insert into public.sports_fixture_comments (fixture_uid, author_id, parent_id, body, created_at)
select live.uid, a.id, parent.id,
       case a.rn when 1 then 'Katılıyorum, bu sezon en formda oyuncumuz.' else 'Bir de duran toplarda daha etkili olsak…' end,
       now() - interval '20 minutes'
  from live, parent, authors a;

-- 4) Canlı sohbet ----------------------------------------------------------
with live as (
  select id from public.sports_fixtures where id = 990000001
),
authors as (
  select id, row_number() over (order by created_at) as rn
    from public.profiles where username is not null order by created_at limit 6
)
insert into public.sports_chat_messages (fixture_id, user_id, kind, body, client_id, status, created_at, updated_at)
select live.id, a.id, 'user', v.body, gen_random_uuid(), 'visible', now() - v.age, now() - v.age
  from (values
    (1, 'Haydi Trabzon! Bu maç bizim 🔥', interval '52 minutes'),
    (2, 'Orta saha baskısı muhteşem, rakip çıkamıyor.', interval '38 minutes'),
    (3, 'GOOOL! Trezeguet! 💙❤️', interval '13 minutes'),
    (4, 'Skor 2-1, savunma dikkatli olmalı.', interval '7 minutes'),
    (5, 'Son 20 dakika, tempoyu düşürmeyelim.', interval '4 minutes'),
    (6, 'Bu taraftarla her maç kazanılır! 👏', interval '1 minute')
  ) as v(seq, body, age)
  join authors a on a.rn = v.seq
  cross join live;

-- 5) Demo bildirim kuyruğunu temizle ---------------------------------------
-- Örnek maçlar gerçek kullanıcılara bildirim göndermesin.
delete from public.sports_notification_events
 where fixture_id in (990000001, 990000002, 990000003, 990000004);

select jsonb_build_object(
  'fixtures', (select jsonb_agg(jsonb_build_object('id', id, 'phase', phase, 'kickoff', kickoff_at)
                                 order by kickoff_at desc)
                 from public.sports_fixtures where id between 990000001 and 990000004),
  'comments', (select count(*) from public.sports_fixture_comments c
                 join public.sports_fixtures f on f.uid = c.fixture_uid
                where f.id between 990000001 and 990000009),
  'chat', (select count(*) from public.sports_chat_messages where fixture_id between 990000001 and 990000009),
  'configured', (select team_id from public.sports_settings where id = 1)
) as result;
