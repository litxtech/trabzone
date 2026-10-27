-- -----------------------------------------------------------------------------
-- 0009 — Kamuya acik guvenlik icerigi
--
-- Cocuk guvenligi politikasi ve SSS, uygulama magazalarinin ve regülasyonlarin
-- bekledigi uzere oturum acmadan da okunabilmelidir. Bu iki fonksiyon yalnizca
-- yayinlanmis icerik dondurur; kullanici verisi icermez.
-- -----------------------------------------------------------------------------

grant execute on function public.safety_get_policy(text) to anon;
grant execute on function public.safety_list_faqs() to anon;
