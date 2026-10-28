-- 0092: Yolculuk ilanı detayı da engeli uygular.
--
-- ride_search engelli sürücülerin ilanlarını listelemiyordu ancak
-- ride_offer_detail doğrudan ilan kimliğiyle açılabiliyordu; bu da sürücü
-- profili, plaka ve güzergâh bilgisini sızdırıyordu. Engel artık ilanı
-- "bulunamadı" yapar.

set search_path = public;

do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ride_offer_detail';

  if position('is_blocked' in d) > 0 then
    raise notice 'ride_offer_detail already guarded';
    return;
  end if;

  d := replace(
    d,
    '  v_is_driver := v_offer.driver_id = v_uid;',
    '  if v_offer.driver_id <> v_uid and public.is_blocked(v_uid, v_offer.driver_id) then
    raise exception ''offer_not_found'' using errcode = ''P0002'';
  end if;

  v_is_driver := v_offer.driver_id = v_uid;'
  );

  execute d;
end;
$$;
