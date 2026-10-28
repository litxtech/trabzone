-- 0086: Engelleme kapsamını ticari yüzeylere de taşır.
--
-- İlan ve yolculuk aramaları SECURITY DEFINER olduğu için RLS'i atlar;
-- bu yüzden engel filtresi fonksiyonların içine eklenir. Fonksiyon gövdeleri
-- canlı tanımdan string değişimi ile üretilir: böylece mevcut metinler
-- (Türkçe ifadeler dahil) bayt bayt korunur.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Emlak: engellenen kullanıcının ilanları listede, haritada ve detayda yok.
-- ---------------------------------------------------------------------------
do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 're_list';

  if position('is_blocked' in d) > 0 then
    raise notice 're_list already patched';
  else
    d := replace(
      d,
      '(p_listing_kind is null or l.listing_kind = p_listing_kind)',
      'not public.is_blocked(v_uid, l.owner_id) and (p_listing_kind is null or l.listing_kind = p_listing_kind)'
    );
    if position('is_blocked' in d) = 0 then
      raise exception 're_list patch failed';
    end if;
    execute d;
  end if;
end;
$$;

do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 're_map';

  if position('is_blocked' in d) > 0 then
    raise notice 're_map already patched';
  else
    d := replace(
      d,
      '(p_listing_kind is null or l.listing_kind = p_listing_kind)',
      'not public.is_blocked(v_uid, l.owner_id) and (p_listing_kind is null or l.listing_kind = p_listing_kind)'
    );
    if position('is_blocked' in d) = 0 then
      raise exception 're_map patch failed';
    end if;
    execute d;
  end if;
end;
$$;

do $$
declare
  d text;
  anchor text := 'v_can_view_exact := v_is_owner or v_is_admin;';
  patch text := 'v_can_view_exact := v_is_owner or v_is_admin;
  if not v_is_owner and public.is_blocked(v_uid, v_listing.owner_id) then
    raise exception ''listing_not_found'' using errcode = ''P0002'';
  end if;';
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 're_get';

  if position('is_blocked' in d) > 0 then
    raise notice 're_get already patched';
  else
    if position(anchor in d) = 0 then
      raise exception 're_get anchor missing';
    end if;
    d := replace(d, anchor, patch);
    execute d;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Yolculuk: engellenen sürücünün ilanları aramada görünmez.
-- ---------------------------------------------------------------------------
do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ride_search';

  if position('is_blocked' in d) > 0 then
    raise notice 'ride_search already patched';
  else
    d := replace(
      d,
      'where o.status in (''published'',''full'')',
      'where o.status in (''published'',''full'')
      and not public.is_blocked(v_uid, o.driver_id)'
    );
    if position('is_blocked' in d) = 0 then
      raise exception 'ride_search patch failed';
    end if;
    execute d;
  end if;
end;
$$;

-- Yolculuk yorumları: engellenen yazarın yorumu görünmez.
do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ride_reviews_for';

  if position('is_blocked' in d) > 0 then
    raise notice 'ride_reviews_for already patched';
  else
    d := replace(
      d,
      'where subject_id = p_user_id and status = ''published''
        order by created_at desc',
      'where subject_id = p_user_id and status = ''published''
          and not public.is_blocked(v_uid, author_id)
        order by created_at desc'
    );
    if position('is_blocked' in d) = 0 then
      raise exception 'ride_reviews_for patch failed';
    end if;
    execute d;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pazar yeri haritası ve satıcı sayfası.
-- ---------------------------------------------------------------------------
do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'market_map_listings';

  if position('is_blocked' in d) > 0 then
    raise notice 'market_map_listings already patched';
  else
    d := replace(
      d,
      'where l.status = ''active''
      and l.moderation_status = ''visible''',
      'where l.status = ''active''
      and l.moderation_status = ''visible''
      and not public.is_blocked(auth.uid(), l.seller_id)'
    );
    if position('is_blocked' in d) = 0 then
      raise exception 'market_map_listings patch failed';
    end if;
    execute d;
  end if;
end;
$$;

do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'market_seller';

  if position('is_blocked' in d) > 0 then
    raise notice 'market_seller already patched';
  else
    d := replace(
      d,
      '    raise exception ''seller_not_found'' using errcode = ''22023'';
  end if;

  return (',
      '    raise exception ''seller_not_found'' using errcode = ''22023'';
  end if;

  if public.is_blocked(v_uid, p_user_id) then
    raise exception ''seller_not_found'' using errcode = ''22023'';
  end if;

  return ('
    );
    if position('is_blocked' in d) = 0 then
      raise exception 'market_seller patch failed';
    end if;
    execute d;
  end if;
end;
$$;
