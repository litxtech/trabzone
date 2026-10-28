-- -----------------------------------------------------------------------------
-- 0008 — Kayit oncesi kullanilabilir fonksiyon izinleri
--
-- `is_username_available` kayit formunda OTURUM ACILMADAN cagrilir. Fonksiyon
-- security definer oldugu icin tablo RLS'i zaten atlanir; yalnizca calistirma
-- izni eksikti. `anon` rolune yalnizca bu tek fonksiyon icin izin verilir.
-- -----------------------------------------------------------------------------

grant execute on function public.is_username_available(text) to anon, authenticated;

-- Kayit tamamlama oturum gerektirir; anon'a acilmaz.
revoke all on function public.complete_registration(text, text, text) from anon;
grant execute on function public.complete_registration(text, text, text) to authenticated;
