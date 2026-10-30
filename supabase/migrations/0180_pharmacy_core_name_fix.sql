-- ---------------------------------------------------------------------------
-- Eczane çekirdek adı — "Eczane X" ve "X Eczanesi" aynı kimliğe düşmeli
--
-- Eski desen yalnızca SONDAKİ "eczane/eczanesi" ekinden kurtuluyordu:
--   "İnanır Eczanesi" → "inanir"
--   "Eczane İnanır"   → "eczane-inanir"   ← eşleşmedi, mükerrer kayıt oluştu
--
-- Yeni desen "eczane / eczanesi / eczhane" sözcüğünü adın herhangi bir
-- yerinden (baş, orta, son) güvenli sözcük sınırıyla ayıklar. Böylece canlı
-- nöbet eşleştirmesi aynı eczaneyi iki kez oluşturmaz.
-- ---------------------------------------------------------------------------

create or replace function public.pharmacy_core_name(p_text text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(
      public.pharmacy_slugify(p_text),
      '(^|-)eczanesi(-|$)|(^|-)eczane(-|$)|(^|-)eczhane(-|$)',
      '-',
      'g'
    ),
    '-+', '-', 'g'
  ));
$$;

comment on function public.pharmacy_core_name(text) is
  'Eczane adından "eczane/eczanesi" sözcüğünü her konumda ayıklayan arama/eşleştirme anahtarı.';
