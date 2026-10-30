-- ---------------------------------------------------------------------------
-- Demo maç verisini siler (scripts/demo-sports-fixture.sql ile eklenen).
-- Takım ve maç merkezi ayarı korunur; yalnızca örnek maçlar, yorumlar ve
-- sohbet mesajları temizlenir. Gerçek sağlayıcı bağlanmadan önce çalıştırın.
-- ---------------------------------------------------------------------------
delete from public.comment_likes
 where content_type = 'match'
   and comment_id in (
     select c.id from public.sports_fixture_comments c
       join public.sports_fixtures f on f.uid = c.fixture_uid
      where f.id between 990000001 and 990000009
   );

delete from public.sports_fixture_comments
 where fixture_uid in (
   select uid from public.sports_fixtures where id between 990000001 and 990000009
 );

delete from public.sports_chat_messages where fixture_id between 990000001 and 990000009;
delete from public.sports_chat_presence where fixture_id between 990000001 and 990000009;
delete from public.sports_notification_events where fixture_id between 990000001 and 990000009;
delete from public.sports_fixture_events where fixture_id between 990000001 and 990000009;
delete from public.sports_fixture_statistics where fixture_id between 990000001 and 990000009;
delete from public.sports_fixture_lineups where fixture_id between 990000001 and 990000009;
delete from public.sports_fixture_players where fixture_id between 990000001 and 990000009;
delete from public.sports_fixtures where id between 990000001 and 990000009;

select count(*) as kalan_demo_mac from public.sports_fixtures where id between 990000001 and 990000009;
