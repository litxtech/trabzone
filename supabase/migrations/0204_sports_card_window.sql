-- ---------------------------------------------------------------------------
-- Maç kartı görünme penceresi.
--
-- İstenen davranış: Trabzonspor maçının kartı maçtan 30 dakika önce görünür
-- (kullanıcılar bu sırada yorum yazabilir), maç bittikten 1 gün sonra kalkar.
-- Kartın ortasında başlama saatine geri sayım işler.
--
-- Önceki varsayılanlar 60 dk / 180 dk idi: yorum için kısa, sonuç için uzun
-- kalıyordu.
-- ---------------------------------------------------------------------------
alter table public.sports_settings
  alter column feed_prematch_minutes set default 30,
  alter column feed_postmatch_minutes set default 1440;

update public.sports_settings
   set feed_prematch_minutes = 30,
       feed_postmatch_minutes = 1440,
       updated_at = now()
 where id = 1;
