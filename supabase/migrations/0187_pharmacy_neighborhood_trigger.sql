-- ---------------------------------------------------------------------------
-- Yeni/güncellenen eczane adreslerinde mahalleyi otomatik doldur
--
-- Resmî nöbet kaynağı mahalleyi ayrı alan olarak vermiyor. Adres metni
-- "KALKINMA MAH. ..." biçiminde geldiğinde mahalle adı YALNIZCA aynı ilçedeki
-- resmî `neighborhoods` kaydıyla Türkçe katlama eşleşiyorsa doldurulur.
-- Eşleşme yoksa alan boş kalır; sokak adı mahalle olarak yazılmaz.
-- Böylece canlı senkronizasyonun eklediği yeni kayıtlar da mahalle aramasına
-- ve mahalle bildirimlerine gerçek adresle katılır.
-- ---------------------------------------------------------------------------

create or replace function public.pharmacy_extract_neighborhood(
  p_address text,
  p_district_id bigint
)
returns text
language sql
stable
set search_path = public
as $$
  select n.name
  from public.neighborhoods n
  where p_district_id is not null
    and n.district_id = p_district_id
    and p_address is not null
    and position(' MAH.' in upper(p_address)) between 3 and 61
    and public.pharmacy_fold(n.name) = public.pharmacy_fold(
      public.pharmacy_title_tr(
        left(upper(p_address), position(' MAH.' in upper(p_address)) - 1)
      )
    )
  limit 1;
$$;

revoke all on function public.pharmacy_extract_neighborhood(text, bigint) from public, anon, authenticated;
grant execute on function public.pharmacy_extract_neighborhood(text, bigint) to service_role;

create or replace function public.pharmacy_profiles_fill_neighborhood()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_district_id bigint;
  v_name text;
begin
  if new.neighborhood is not null or new.address_text is null then
    return new;
  end if;

  select p.district_id into v_district_id
  from public.places p
  where p.id = new.place_id;

  v_name := public.pharmacy_extract_neighborhood(new.address_text, v_district_id);
  if v_name is not null then
    new.neighborhood := v_name;
    new.neighborhood_source := coalesce(new.neighborhood_source, 'official_list');
  end if;

  return new;
end;
$$;

drop trigger if exists pharmacy_profiles_fill_neighborhood on public.pharmacy_profiles;
create trigger pharmacy_profiles_fill_neighborhood
  before insert or update of address_text, place_id on public.pharmacy_profiles
  for each row execute function public.pharmacy_profiles_fill_neighborhood();
