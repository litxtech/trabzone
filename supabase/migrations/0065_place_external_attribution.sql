-- 0059: İşletme detayında dış veri kaynağı ve atıf bilgisi
--
-- OpenStreetMap (ODbL) gibi dış kaynaklardan gelen işletmelerde kaynak atıfı
-- arayüzde gösterilir. `data_source` işletme sahibi düzenlemesiyle değişse bile
-- `place_external_references` kaydı korunur; bu yüzden atıf oradan okunur.

set search_path = public, extensions;

create or replace function public.place_get(p_place_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_place public.places%rowtype;
  v_category public.place_categories%rowtype;
  v_is_manager boolean;
  v_can_claim boolean;
  v_rating_counts jsonb;
  v_media jsonb;
  v_reels jsonb;
  v_posts jsonb;
begin
  select * into v_place from public.places where id = p_place_id;
  if not found then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  v_is_manager := public.tz_place_manager(v_place.id, v_uid);

  if v_place.status <> 'published'
     and not v_is_manager
     and not public.has_permission('places.view') then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  select * into v_category from public.place_categories where id = v_place.category_id;

  if v_place.status = 'published' then
    update public.places set view_count = view_count + 1 where id = v_place.id;
  end if;

  select coalesce(jsonb_object_agg(bucket, total), '{}'::jsonb)
  into v_rating_counts
  from (
    select rating::text as bucket, count(*) as total
    from public.place_reviews
    where place_id = v_place.id and status = 'visible'
    group by rating
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'kind', m.kind,
           'storage_path', m.storage_path,
           'thumb_path', m.thumb_path,
           'reel_id', m.reel_id,
           'caption', m.caption,
           'width', m.width,
           'height', m.height,
           'duration_ms', m.duration_ms,
           'status', m.status,
           'created_at', m.created_at,
           'uploader', jsonb_build_object(
             'id', pr.id,
             'username', pr.username,
             'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), '')
           )
         ) order by m.sort_order, m.created_at),
         '[]'::jsonb)
  into v_media
  from public.place_media m
  join public.profiles pr on pr.id = m.uploader_id
  where m.place_id = v_place.id
    and (m.status = 'approved' or m.uploader_id = v_uid or v_is_manager);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'video_path', r.video_path,
           'cover_path', r.cover_path,
           'caption', r.caption,
           'duration_ms', r.duration_ms,
           'like_count', r.like_count,
           'comment_count', r.comment_count,
           'view_count', r.view_count,
           'created_at', r.created_at,
           'author', jsonb_build_object(
             'username', pr.username,
             'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
             'avatar_path', pr.avatar_path
           )
         ) order by r.created_at desc),
         '[]'::jsonb)
  into v_reels
  from public.place_content_links l
  join public.reels r on r.id = l.reel_id
  join public.profiles pr on pr.id = r.author_id
  where l.place_id = v_place.id
    and r.moderation_status = 'visible'
    and r.status = 'ready'
    and pr.account_status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', po.id,
           'body', po.body,
           'created_at', po.created_at,
           'author', jsonb_build_object(
             'username', pr.username,
             'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
             'avatar_path', pr.avatar_path
           )
         ) order by po.created_at desc),
         '[]'::jsonb)
  into v_posts
  from public.place_content_links l
  join public.posts po on po.id = l.post_id
  join public.profiles pr on pr.id = po.author_id
  where l.place_id = v_place.id
    and po.visibility = 'public'
    and po.moderation_status = 'visible'
    and pr.account_status = 'active';

  v_can_claim := v_place.status = 'published'
    and not v_is_manager
    and v_place.owner_id is null
    and not exists (
      select 1 from public.place_owner_claims c
      where c.place_id = v_place.id and c.applicant_id = v_uid and c.status = 'pending'
    );

  return jsonb_build_object(
    'id', v_place.id,
    'name', v_place.name,
    'slug', v_place.slug,
    'description', v_place.description,
    'category', case when v_category.id is null then null else jsonb_build_object(
      'id', v_category.id, 'slug', v_category.slug, 'name', v_category.name,
      'icon', v_category.icon, 'tone', v_category.tone
    ) end,
    'categories', public.tz_place_categories_json(v_place.id),
    'city_id', v_place.city_id,
    'district_id', v_place.district_id,
    'neighborhood_id', v_place.neighborhood_id,
    'district', (select name from public.districts where id = v_place.district_id),
    'neighborhood', (select name from public.neighborhoods where id = v_place.neighborhood_id),
    'address', case when v_place.address_public or v_is_manager then v_place.address else null end,
    'lat', v_place.lat,
    'lng', v_place.lng,
    'phone', v_place.phone,
    'website', v_place.website,
    'cover_path', v_place.cover_path,
    'opening_hours', v_place.opening_hours,
    'price_level', v_place.price_level,
    'status', v_place.status,
    'verification_status', v_place.verification_status,
    'is_verified', v_place.is_verified,
    'data_source', v_place.data_source,
    'external_provider', (
      select ref.provider from public.place_external_references ref
      where ref.place_id = v_place.id
      order by ref.fetched_at limit 1
    ),
    'external_id', (
      select ref.external_id from public.place_external_references ref
      where ref.place_id = v_place.id
      order by ref.fetched_at limit 1
    ),
    'attribution_text', (
      select ref.attribution_text from public.place_external_references ref
      where ref.place_id = v_place.id
      order by ref.fetched_at limit 1
    ),
    'license_note', (
      select ref.license_note from public.place_external_references ref
      where ref.place_id = v_place.id
      order by ref.fetched_at limit 1
    ),
    'rating_avg', v_place.rating_avg,
    'rating_count', v_place.rating_count,
    'review_count', v_place.review_count,
    'photo_count', v_place.photo_count,
    'video_count', v_place.video_count,
    'favorite_count', v_place.favorite_count,
    'view_count', v_place.view_count + case when v_place.status = 'published' then 1 else 0 end,
    'rating_breakdown', v_rating_counts,
    'is_favorite', exists (
      select 1 from public.place_favorites f
      where f.place_id = v_place.id and f.user_id = v_uid
    ),
    'is_manager', v_is_manager,
    'can_claim', v_can_claim,
    'owner', case when v_place.owner_id is null then null else (
      select jsonb_build_object('username', pr.username, 'display_name',
        nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), 'avatar_path', pr.avatar_path)
      from public.profiles pr where pr.id = v_place.owner_id
    ) end,
    'media', v_media,
    'reels', v_reels,
    'posts', v_posts,
    'created_at', v_place.created_at,
    'updated_at', v_place.updated_at
  );
end;
$$;

revoke all on function public.place_get(uuid) from public, anon;
grant execute on function public.place_get(uuid) to authenticated, service_role;
