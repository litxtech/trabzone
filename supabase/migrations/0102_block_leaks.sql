-- 0091: Engel yüzeylerinin kalan boşluklarını kapatır.
--
-- 0085/0086/0089 sonrası yapılan RPC denetiminde kalan sızıntılar:
--   * place_content_list  -> engellenen kişinin mekân gönderileri/reelsleri
--   * place_owner_contact -> engelleyen işletme sahibinin iletişim bilgisi
--   * ride_location_share_view -> token ile canlı konum takibi
--   * call_get -> engellenen kişinin profil alanları
--   * story_list_for_user / feed_profile_posts / reels_for_user
--       -> "profile_restricted" hatası profilin var olduğunu sızdırıyordu
--   * is_following -> engellenen kişiyle takip ilişkisi bilgisi
--
-- Engel artık "kullanıcı yok" gibi davranır: aynı hata/boş yanıt döner.

set search_path = public;

do $$
declare
  d text;
begin
  -- 1) Mekân içerikleri: engellenen yazarların gönderi ve reelsleri gizlenir.
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'place_content_list';

  if position('is_blocked' in d) = 0 then
    d := replace(
      d,
      'and pr.account_status = ''active''',
      'and pr.account_status = ''active''
          and not public.is_blocked(v_uid, pr.id)'
    );
    execute d;
  end if;

  -- 2) Mekân sahibi iletişimi: engel varsa sahip yok sayılır.
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'place_owner_contact';

  if position('is_blocked' in d) = 0 then
    d := replace(
      d,
      'if v_item is null or v_owner = v_uid then',
      'if v_item is null or v_owner = v_uid or public.is_blocked(v_uid, v_owner) then'
    );
    execute d;
  end if;

  -- 3) Canlı konum paylaşımı: engelli taraf token ile takip edemez.
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ride_location_share_view';

  if position('is_blocked' in d) = 0 then
    d := replace(
      d,
      '  select * into v_offer from public.ride_offers where id = v_share.offer_id;',
      '  if public.is_blocked(v_uid, v_share.user_id) then
    raise exception ''share_not_found'' using errcode = ''P0002'';
  end if;

  select * into v_offer from public.ride_offers where id = v_share.offer_id;'
    );
    execute d;
  end if;

  -- 4) Çağrı kaydı: engelli taraf çağrı detayını göremez.
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'call_get';

  if position('is_blocked' in d) = 0 then
    d := replace(
      d,
      '  select * into v_peer from public.profiles',
      '  if public.is_blocked(
    v_uid,
    case when v_row.caller_id = v_uid then v_row.callee_id else v_row.caller_id end
  ) then
    raise exception ''call_not_found'' using errcode = ''22023'';
  end if;

  select * into v_peer from public.profiles'
    );
    execute d;
  end if;

  -- 5) Takip durumu: engel varsa hiç takip edilmemiş gibi davranır.
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'is_following';

  if position('is_blocked' in d) = 0 then
    d := replace(
      d,
      'where f.follower_id = auth.uid() and f.following_id = p_target',
      'where f.follower_id = auth.uid()
      and f.following_id = p_target
      and not public.is_blocked(auth.uid(), p_target)'
    );
    execute d;
  end if;

  -- 6) Hikâyeler: engel varsa "bulunamadı" hatası (varlık sızmaz).
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'story_list_for_user';

  if position('is_blocked' in d) = 0 then
    d := replace(
      d,
      'if not found or not public.can_view_profile_content(p_user_id) then',
      'if not found
     or public.is_blocked(v_uid, p_user_id)
     or not public.can_view_profile_content(p_user_id) then'
    );
    execute d;
  end if;

  -- 7) Profil gönderileri: engel varsa boş liste (profil yokmuş gibi).
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'feed_profile_posts';

  if position('is_blocked' in d) = 0 then
    d := replace(
      d,
      'if v_author is null then',
      'if v_author is null or public.is_blocked(v_uid, v_author) then'
    );
    execute d;
  end if;

  -- 8) Profil reelsleri: engel varsa "kullanıcı yok" hatası.
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'reels_for_user';

  if position('if v_author is null or public.is_blocked(v_me, v_author)' in d) = 0 then
    d := replace(
      d,
      'if v_author is null then',
      'if v_author is null or public.is_blocked(v_me, v_author) then'
    );
    execute d;
  end if;
end;
$$;
