-- 0102 â€” AI Haber Merkezi: doÄŸrulanmÄ±ÅŸ yerel ve ulusal kaynak geniÅŸletmesi
--
-- BaÄŸÄ±msÄ±z doÄŸrulama yalnÄ±zca kaynak kÃ¼tÃ¼phanesinde tanÄ±mlÄ± domainleri
-- sayar. Trabzon gÃ¼ndemini en sÄ±k yayÄ±mlayan yerel kuruluÅŸlar ile ulusal
-- ajanslarÄ±n bir bÃ¶lÃ¼mÃ¼ eksikti; bu yÃ¼zden doÄŸrulanmÄ±ÅŸ olaylar bile "tek
-- kaynak" gÃ¶rÃ¼nÃ¼p otomatik yayÄ±n dÄ±ÅŸÄ±nda kalÄ±yordu.
--
-- Bu migration mevcut kayÄ±tlarÄ± silmez, yalnÄ±zca eksik domainleri ekler.
-- Lisans/gÃ¶rsel izin alanlarÄ±na dokunmaz.

begin;

set search_path = public, extensions;

insert into public.ai_news_sources (domain, name, kind, active, reliability, notes_tr)
values
  ('kuzeyekspres.com.tr', 'Kuzey Ekspres', 'trusted_media', true, 0.60,
   'Trabzon yerel haber sitesi; baÄŸÄ±msÄ±z ikincil kaynak olarak izlenir.'),
  ('habertrabzon.tr', 'Haber Trabzon', 'trusted_media', true, 0.55,
   'Trabzon yerel haber sitesi; ikincil kaynak.'),
  ('gazeterize.com', 'Gazete Rize', 'trusted_media', true, 0.50,
   'BÃ¶lgesel haber sitesi; ikincil kaynak.'),
  ('cnnturk.com', 'CNN TÃ¼rk', 'trusted_media', true, 0.65,
   'Ulusal haber kuruluÅŸu; AA/DHA kaynaklÄ± metinler tek kaynak sayÄ±lÄ±r.'),
  ('sabah.com.tr', 'Sabah', 'trusted_media', true, 0.60,
   'Ulusal gazete; ikincil kaynak.'),
  ('sozcu.com.tr', 'SÃ¶zcÃ¼', 'trusted_media', true, 0.55,
   'Ulusal gazete; ikincil kaynak.'),
  ('cumhuriyet.com.tr', 'Cumhuriyet', 'trusted_media', true, 0.55,
   'Ulusal gazete; ikincil kaynak.'),
  ('mynet.com', 'Mynet', 'trusted_media', true, 0.50,
   'Haber toplayÄ±cÄ±; yalnÄ±zca ek doÄŸrulama iÃ§in kullanÄ±lÄ±r.'),
  ('onedio.com', 'Onedio', 'trusted_media', false, 0.30,
   'Magazin/yaÅŸam aÄŸÄ±rlÄ±klÄ±; otomatik yayÄ±n iÃ§in gÃ¼venilmez, pasif.'),
  ('doka.org.tr', 'DoÄŸu Karadeniz KalkÄ±nma AjansÄ±', 'official', true, 0.80,
   'ResmÃ® kalkÄ±nma ajansÄ± duyurularÄ±.')
on conflict (domain) do update
  set name = coalesce(nullif(public.ai_news_sources.name, ''), excluded.name),
      kind = excluded.kind,
      active = excluded.active,
      reliability = greatest(public.ai_news_sources.reliability, excluded.reliability),
      notes_tr = coalesce(public.ai_news_sources.notes_tr, excluded.notes_tr),
      last_checked_at = now();

commit;

