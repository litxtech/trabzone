-- ---------------------------------------------------------------------------
-- Mahalle adlarını resmî mahalle tablosuna göre kanonikleştir
--
-- 0185 adres metninden mahalleyi çıkardı; kaynak adresler bazen ASCII
-- ("BESIRLI") olduğu için görünen ad "Besırlı" kalabiliyordu. Aynı ilçedeki
-- `neighborhoods` kaydı Türkçe katlama ile eşleşiyorsa resmî ad kullanılır
-- ("2 Nolu Beşirli"). Eşleşme yoksa 0185'in çıkarımı korunur; tahmin yapılmaz.
-- ---------------------------------------------------------------------------

update public.pharmacy_profiles pp
   set neighborhood = n.name,
       neighborhood_source = 'official_list',
       updated_at = now()
  from public.places p
  join public.neighborhoods n on n.district_id = p.district_id
 where pp.place_id = p.id
   and pp.neighborhood is not null
   and public.pharmacy_fold(n.name) = public.pharmacy_fold(pp.neighborhood)
   and pp.neighborhood is distinct from n.name;

update public.places p
   set neighborhood_id = n.id,
       updated_at = now()
  from public.neighborhoods n, public.pharmacy_profiles pp
 where pp.place_id = p.id
   and n.district_id = p.district_id
   and pp.neighborhood = n.name
   and p.neighborhood_id is null;
