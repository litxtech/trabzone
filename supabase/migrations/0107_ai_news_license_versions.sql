-- 0107: CC lisans sürümlerini doğru kaydet.
-- Wikimedia Commons 3.0 ve 2.5 lisanslarıyla gelen görseller "4.0" gibi
-- etiketlenmemelidir; lisans türü ve sürümü kaynakla birebir eşleşmelidir.

insert into public.ai_news_media_licenses
  (code, name_tr, commercial_use, derivatives_allowed, attribution_required, requires_documentation, is_usable, license_url, notes_tr)
values
  ('cc_by_3', 'CC BY 3.0', true, true, true, false, true,
   'https://creativecommons.org/licenses/by/3.0/', 'Atıf zorunlu; ticari kullanım ve düzenleme serbest.'),
  ('cc_by_sa_3', 'CC BY-SA 3.0', true, true, true, false, true,
   'https://creativecommons.org/licenses/by-sa/3.0/', 'Atıf zorunlu; türev paylaşım aynı lisansla yapılmalı.'),
  ('cc_by_2_5', 'CC BY 2.5', true, true, true, false, true,
   'https://creativecommons.org/licenses/by/2.5/', 'Atıf zorunlu; ticari kullanım ve düzenleme serbest.'),
  ('cc_by_sa_2_5', 'CC BY-SA 2.5', true, true, true, false, true,
   'https://creativecommons.org/licenses/by-sa/2.5/', 'Atıf zorunlu; türev paylaşım aynı lisansla yapılmalı.')
on conflict (code) do update
  set name_tr = excluded.name_tr,
      is_usable = excluded.is_usable,
      license_url = excluded.license_url,
      notes_tr = excluded.notes_tr;
