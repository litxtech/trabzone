-- ---------------------------------------------------------------------------
-- Arşivlenen eczane kayıtlarının slug'ını ayır
--
-- 0150'de `duplicate` / `archived` durumuna alınan kayıtlar eski slug'larını
-- koruyordu. Bu yüzden korunan kayıt "eczane-talip-eczanesi-akcaabat-2" gibi
-- gereksiz sonek aldı. Arşiv kayıtlarının slug'ı `arsiv-` önekiyle ayrılır;
-- yayımdaki kayıtlar temel slug'larına döner.
-- ---------------------------------------------------------------------------

update public.pharmacy_profiles pp
   set slug = 'arsiv-' || left(pp.place_id::text, 8) || '-' || coalesce(pp.slug, 'eczane')
  from public.places p
  join public.place_categories c on c.id = p.category_id
 where pp.place_id = p.id
   and c.slug = 'eczane'
   and p.status in ('duplicate', 'archived')
   and pp.slug not like 'arsiv-%';

do $$
declare
  v_row record;
  v_base text;
  v_slug text;
  v_n integer;
begin
  for v_row in
    select pp.place_id, p.name, d.name as district
    from public.pharmacy_profiles pp
    join public.places p on p.id = pp.place_id
    join public.districts d on d.id = p.district_id
    join public.place_categories c on c.id = p.category_id
    where c.slug = 'eczane'
      and p.status = 'published'
      and (
        pp.slug is null
        or pp.slug <> 'eczane-' || public.pharmacy_slugify(p.name) || '-' || public.pharmacy_slugify(d.name)
      )
  loop
    v_base := 'eczane-' || public.pharmacy_slugify(v_row.name) || '-' || public.pharmacy_slugify(v_row.district);
    v_slug := v_base;
    v_n := 1;
    while exists (
      select 1 from public.pharmacy_profiles where slug = v_slug and place_id <> v_row.place_id
    ) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n::text;
    end loop;

    update public.pharmacy_profiles
       set slug = v_slug,
           updated_at = now()
     where place_id = v_row.place_id;
  end loop;
end;
$$;
