-- 0102: Paylaşım kartları (Open Graph önizlemesi + uygulama derin bağlantısı)
--
-- Sosyal paylaşım bağlantıları artık `/p/{tür}/{anahtar}` adresine gider. Bu
-- adres sunucu tarafında işlenir; WhatsApp/Telegram/X gibi uygulamalar başlık,
-- açıklama ve kapak görselini JavaScript çalıştırmadan görür, kullanıcı ise
-- "Uygulamada aç" ile Trabzone'da ilgili içeriğe düşer.
--
-- `share_card` yalnızca herkese açık, yayında ve moderasyondan geçmiş içerik
-- için veri döndürür. Gizli/followers-only gönderi, özel profil, yayında
-- olmayan mekân veya ilan için `null` döner; böylece paylaşım sayfası özel
-- veri sızdırmaz.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Paylaşım kartı okuyucu
-- ---------------------------------------------------------------------------
create or replace function public.share_card(p_type text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_key  text := btrim(coalesce(p_key, ''));
  v_id   uuid;
  v_meta jsonb;
  v_card jsonb;
begin
  if v_key = '' then
    return null;
  end if;

  -- -------------------------------------------------------------------------
  -- Gönderi
  -- -------------------------------------------------------------------------
  if v_type in ('post', 'gonderi') then
    begin
      v_id := v_key::uuid;
    exception when others then
      return null;
    end;

    select jsonb_build_object(
      'type', 'post',
      'id', po.id,
      'path', '/post/' || po.id::text,
      'deep_link', 'trabzone://post/' || po.id::text,
      'title', coalesce(
        nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
        '@' || p.username::text
      ),
      'description', left(
        coalesce(nullif(btrim(po.body), ''), 'Trabzone''da paylaşılan bir gönderi'),
        280
      ),
      'bucket', 'posts',
      'image_path', (
        select coalesce(
          pm.thumbnail_path,
          case when pm.media_type = 'image' then pm.storage_path end
        )
        from public.post_media pm
        where pm.post_id = po.id
        order by pm.sort_order, pm.created_at
        limit 1
      ),
      'author_name', nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
      'author_username', p.username::text,
      'avatar_path', p.avatar_path,
      'published_at', po.created_at,
      'metrics', concat(po.like_count, ' beğeni · ', po.comment_count, ' yorum')
    )
    into v_card
    from public.posts po
    join public.profiles p on p.id = po.author_id
    where po.id = v_id
      and po.moderation_status = 'visible'
      and po.visibility = 'public'
      and p.account_status = 'active'
      and not exists (
        select 1
        from public.profile_settings s
        where s.user_id = p.id
          and s.profile_visibility <> 'public'
      )
    limit 1;

    return v_card;
  end if;

  -- -------------------------------------------------------------------------
  -- Reels
  -- -------------------------------------------------------------------------
  if v_type in ('reel', 'video') then
    begin
      v_id := v_key::uuid;
    exception when others then
      return null;
    end;

    select jsonb_build_object(
      'type', 'reel',
      'id', r.id,
      'path', '/reel/' || r.id::text,
      'deep_link', 'trabzone://reel/' || r.id::text,
      'title', coalesce(
        nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
        '@' || p.username::text
      ),
      'description', left(
        coalesce(nullif(btrim(r.caption), ''), 'Trabzone Reels''te paylaşılan bir video'),
        280
      ),
      'bucket', 'reels',
      'image_path', r.cover_path,
      'author_name', nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
      'author_username', p.username::text,
      'avatar_path', p.avatar_path,
      'published_at', r.created_at,
      'metrics', concat(r.like_count, ' beğeni · ', r.view_count, ' görüntülenme')
    )
    into v_card
    from public.reels r
    join public.profiles p on p.id = r.author_id
    where r.id = v_id
      and r.moderation_status = 'visible'
      and r.status = 'ready'
      and p.account_status = 'active'
      and not exists (
        select 1
        from public.profile_settings s
        where s.user_id = p.id
          and s.profile_visibility <> 'public'
      )
    limit 1;

    return v_card;
  end if;

  -- -------------------------------------------------------------------------
  -- Profil
  -- -------------------------------------------------------------------------
  if v_type in ('profile', 'profil') then
    select jsonb_build_object(
      'type', 'profile',
      'id', p.id,
      'path', '/profile/' || p.username::text,
      'deep_link', 'trabzone://profile/' || p.username::text,
      'title', coalesce(
        nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
        '@' || p.username::text
      ),
      'description', left(
        coalesce(nullif(btrim(p.bio), ''), 'Trabzone''da Trabzon''un sosyal keşif platformunda.'),
        280
      ),
      'bucket', case when p.cover_path is null then 'avatars' else 'covers' end,
      'image_path', coalesce(p.cover_path, p.avatar_path),
      'author_name', nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
      'author_username', p.username::text,
      'avatar_path', p.avatar_path,
      'verified', p.is_verified,
      'published_at', p.created_at,
      'metrics', concat(p.followers_count, ' takipçi · ', p.posts_count, ' gönderi')
    )
    into v_card
    from public.profiles p
    where lower(p.username::text) = lower(v_key)
      and p.account_status = 'active'
      and not exists (
        select 1
        from public.profile_settings s
        where s.user_id = p.id
          and s.profile_visibility <> 'public'
      )
    limit 1;

    return v_card;
  end if;

  -- -------------------------------------------------------------------------
  -- Mekân / işletme
  -- -------------------------------------------------------------------------
  if v_type in ('place', 'mekan', 'isletme') then
    begin
      v_id := v_key::uuid;
    exception when others then
      return null;
    end;

    select jsonb_build_object(
      'type', 'place',
      'id', pl.id,
      'path', '/marketplace/place/' || pl.id::text,
      'deep_link', 'trabzone://marketplace/place/' || pl.id::text,
      'title', pl.name,
      'description', left(
        coalesce(
          nullif(btrim(pl.description), ''),
          concat_ws(' · ', nullif(c.name, ''), nullif(d.name, '')) || ' — Trabzone Keşfet'
        ),
        280
      ),
      'bucket', 'place-media',
      'image_path', pl.cover_path,
      'published_at', pl.created_at,
      'metrics', concat(pl.rating_count, ' değerlendirme · ', pl.view_count, ' görüntülenme'),
      'location', nullif(btrim(concat_ws(', ', nullif(d.name, ''), nullif(pl.address, ''))), '')
    )
    into v_card
    from public.places pl
    left join public.place_categories c on c.id = pl.category_id
    left join public.districts d on d.id = pl.district_id
    where pl.id = v_id
      and pl.status = 'published'
    limit 1;

    return v_card;
  end if;

  -- -------------------------------------------------------------------------
  -- Marketplace ilanı
  -- -------------------------------------------------------------------------
  if v_type in ('listing', 'ilan', 'market') then
    begin
      v_id := v_key::uuid;
    exception when others then
      return null;
    end;

    v_meta := public.seo_market_listing(v_id);
    if v_meta is null then
      return null;
    end if;

    return jsonb_build_object(
      'type', 'listing',
      'id', v_id,
      'path', '/marketplace/' || v_id::text,
      'deep_link', 'trabzone://marketplace/' || v_id::text,
      'title', v_meta ->> 'title',
      'description', left(
        coalesce(nullif(btrim(coalesce(v_meta ->> 'description', '')), ''), 'Trabzone Marketplace ilanı'),
        280
      ),
      'bucket', 'listing-images',
      'image_path', v_meta ->> 'cover_path',
      'published_at', v_meta ->> 'published_at',
      'price_cents', (v_meta ->> 'price_cents')::bigint,
      'currency', v_meta ->> 'currency',
      'price_period', v_meta ->> 'price_period',
      'location', nullif(
        btrim(concat_ws(', ', nullif(v_meta ->> 'district', ''), nullif(v_meta ->> 'city', ''))),
        ''
      )
    );
  end if;

  -- -------------------------------------------------------------------------
  -- Emlak ilanı
  -- -------------------------------------------------------------------------
  if v_type in ('estate', 'emlak', 'real_estate') then
    begin
      v_id := v_key::uuid;
    exception when others then
      return null;
    end;

    v_meta := public.seo_real_estate_listing(v_id);
    if v_meta is null then
      return null;
    end if;

    return jsonb_build_object(
      'type', 'estate',
      'id', v_id,
      'path', '/marketplace/real-estate/' || v_id::text,
      'deep_link', 'trabzone://marketplace/real-estate/' || v_id::text,
      'title', v_meta ->> 'title',
      'description', left(
        coalesce(nullif(btrim(coalesce(v_meta ->> 'description', '')), ''), 'Trabzone Emlak ilanı'),
        280
      ),
      'bucket', 'real-estate-media',
      'image_path', v_meta ->> 'cover_path',
      'published_at', v_meta ->> 'published_at',
      'price_cents', (v_meta ->> 'price_cents')::bigint,
      'currency', v_meta ->> 'currency',
      'price_period', v_meta ->> 'price_period',
      'location', nullif(
        btrim(concat_ws(', ', nullif(v_meta ->> 'district', ''), nullif(v_meta ->> 'city', ''))),
        ''
      )
    );
  end if;

  return null;
end;
$$;

revoke all on function public.share_card(text, text) from public, anon, authenticated;
grant execute on function public.share_card(text, text) to anon, authenticated, service_role;

comment on function public.share_card(text, text) is
  'Paylaşım sayfası: herkese açık içeriğin önizleme kartı. Gizli içerikte null döner.';
