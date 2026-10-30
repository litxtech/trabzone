-- ---------------------------------------------------------------------------
-- Mahalle bilgisi — resmî adres metninden güvenli çıkarım
--
-- Nöbet listesi mahalleyi ayrı alan olarak vermiyor; ancak resmî adres
-- "KALKINMA MAH. FARABİ CAD. ..." biçiminde mahalle adıyla başlıyor.
-- Bu migration YALNIZCA resmî kaynaktan gelen adres metnindeki "… MAH."
-- öneğini ayıklar. Sokak/cadde adı mahalle sanılmaz; adres yoksa alan boş
-- kalır. Hiçbir mahalle tahmin edilmez.
--
-- Böylece "Kalkınma" araması mahalle bağlamını kurabilir ve
-- "Bugün Kalkınma Mahallesi'nde İnanır Eczanesi nöbetçi" duyurusu gerçek
-- kayda dayanır.
-- ---------------------------------------------------------------------------

create or replace function public.pharmacy_title_tr(p_text text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(
    case
      when w = '' then null
      when w ~ '^[0-9]+$' then w
      when left(w, 1) = 'ı' then 'I' || substr(w, 2)
      else replace(upper(left(w, 1)), 'I', 'İ') || substr(w, 2)
    end,
    ' ' order by ord
  ) filter (where w <> ''), '')
  from unnest(
    string_to_array(
      lower(translate(coalesce(p_text, ''), 'İIŞĞÜÖÇÂÎÛ', 'iışğüöçâîû')),
      ' '
    )
  ) with ordinality as t(w, ord);
$$;

comment on function public.pharmacy_title_tr(text) is
  'Türkçe büyük harfli resmî adres parçalarını okunur başlık biçimine çevirir.';

update public.pharmacy_profiles pp
   set neighborhood = btrim(
         public.pharmacy_title_tr(
           left(
             upper(pp.address_text),
             position(' MAH.' in upper(pp.address_text)) - 1
           )
         )
       ),
       neighborhood_source = 'official_list',
       updated_at = now()
  from public.places p
  join public.place_categories c on c.id = p.category_id
 where pp.place_id = p.id
   and c.slug = 'eczane'
   and p.status = 'published'
   and pp.neighborhood is null
   and pp.address_text is not null
   and position(' MAH.' in upper(pp.address_text)) between 3 and 61
   and btrim(
         public.pharmacy_title_tr(
           left(upper(pp.address_text), position(' MAH.' in upper(pp.address_text)) - 1)
         )
       ) <> '';
