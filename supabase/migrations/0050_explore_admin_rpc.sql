-- =====================================================================
-- 0048 — Harita / işletme / emlak yönetim RPC'leri
--
-- Bütün fonksiyonlar güvenlik tanımlayıcıdır ve her çağrıda ilgili
-- izin anahtarını doğrular. Doğrulamadan yayın yapılamaz.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. İzin kataloğu
-- ---------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr) values
  ('map.view',              'Harita, işletme ve emlak kayıtlarını görüntüleme'),
  ('map.manage',            'İşletme ekleme, düzenleme, konum düzeltme ve birleştirme'),
  ('map.moderate',          'İşletme önerileri, sahiplenme, medya, yorum ve şikâyet moderasyonu'),
  ('realestate.view',       'Emlak ilanlarını ve doğrulama kayıtlarını görüntüleme'),
  ('realestate.manage',     'Emlak ilanı ve kategori yönetimi'),
  ('realestate.moderate',   'Emlak medyası, şikâyet ve ilan durumu moderasyonu'),
  ('realestate.verify',     'EİDS kimlik ve ilan verme yetkisi doğrulama kayıtlarını inceleme'),
  ('realestate.publish',    'Doğrulanmış emlak ilanını yayınlama')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'map.view'), ('admin', 'map.manage'), ('admin', 'map.moderate'),
  ('admin', 'realestate.view'), ('admin', 'realestate.manage'),
  ('admin', 'realestate.moderate'), ('admin', 'realestate.verify'),
  ('admin', 'realestate.publish'),

  ('moderator', 'map.view'), ('moderator', 'map.moderate'),
  ('moderator', 'realestate.view'), ('moderator', 'realestate.moderate'),

  ('support_agent', 'map.view'), ('support_agent', 'realestate.view'),

  ('market_manager', 'realestate.view'), ('market_manager', 'realestate.moderate'),

  ('analyst', 'map.view'), ('analyst', 'realestate.view'),

  ('security_officer', 'map.view'), ('security_officer', 'realestate.view')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. İşletme kategori yardımcıları
-- ---------------------------------------------------------------------
create or replace function public.tz_place_category_id(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select id from public.place_categories where slug = p_slug and is_active;
$$;

revoke all on function public.tz_place_category_id(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Admin harita özeti
-- ---------------------------------------------------------------------
create or replace function public.admin_explore_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.view');
begin
  return jsonb_build_object(
    'permissions', jsonb_build_object(
      'map_view', public.has_permission('map.view'),
      'map_manage', public.has_permission('map.manage'),
      'map_moderate', public.has_permission('map.moderate'),
      'realestate_view', public.has_permission('realestate.view'),
      'realestate_manage', public.has_permission('realestate.manage'),
      'realestate_moderate', public.has_permission('realestate.moderate'),
      'realestate_verify', public.has_permission('realestate.verify'),
      'realestate_publish', public.has_permission('realestate.publish')
    ),
    'eids_enabled', public.tz_app_flag('real_estate.eids_enabled'),
    'places', jsonb_build_object(
      'total', (select count(*) from public.places),
      'published', (select count(*) from public.places where status = 'published'),
      'pending', (select count(*) from public.places where status = 'pending'),
      'verified', (select count(*) from public.places where verification_status = 'verified'),
      'without_photo', (select count(*) from public.places where status = 'published' and photo_count = 0),
      'missing_address', (select count(*) from public.places where status = 'published' and (address is null or btrim(address) = ''))
    ),
    'queue', jsonb_build_object(
      'place_suggestions', (select count(*) from public.place_suggestions where status = 'pending'),
      'place_claims', (select count(*) from public.place_owner_claims where status = 'pending'),
      'place_media', (select count(*) from public.place_media where status = 'pending'),
      'place_reports', (select count(*) from public.content_reports where status = 'pending' and target_type like 'place%'),
      're_verifications', (select count(*) from public.real_estate_verifications where status = 'pending'),
      're_media', (select count(*) from public.real_estate_media where status = 'pending'),
      're_listings', (select count(*) from public.real_estate_listings where status = 'pending_verification'),
      're_reports', (select count(*) from public.content_reports where status = 'pending' and target_type like 'real_estate%')
    ),
    'real_estate', jsonb_build_object(
      'total', (select count(*) from public.real_estate_listings),
      'published', (select count(*) from public.real_estate_listings where status = 'published'),
      'pending', (select count(*) from public.real_estate_listings where status = 'pending_verification'),
      'draft', (select count(*) from public.real_estate_listings where status = 'draft'),
      'rejected', (select count(*) from public.real_estate_listings where status = 'rejected'),
      'expired', (select count(*) from public.real_estate_listings where status = 'expired')
    ),
    'categories', jsonb_build_object(
      'place', (select count(*) from public.place_categories),
      'real_estate', (select count(*) from public.real_estate_categories)
    ),
    'districts', (select count(*) from public.districts)
  );
end;
$$;

revoke all on function public.admin_explore_overview() from public, anon;
grant execute on function public.admin_explore_overview() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. İşletme listesi / detayı
-- ---------------------------------------------------------------------
create or replace function public.admin_places_list(
  p_status text default null,
  p_q text default null,
  p_district_id bigint default null,
  p_category text default null,
  p_verification text default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.view');
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.places p
  left join public.place_categories c on c.id = p.category_id
  where (p_status is null or p.status = p_status)
    and (p_district_id is null or p.district_id = p_district_id)
    and (p_verification is null or p.verification_status = p_verification)
    and (p_category is null or c.slug = p_category)
    and (v_q is null or p.name ilike '%' || v_q || '%' or coalesce(p.address, '') ilike '%' || v_q || '%');

  select coalesce(jsonb_agg(item order by item ->> 'updated_at' desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'status', p.status,
      'verification_status', p.verification_status,
      'is_verified', p.is_verified,
      'address', p.address,
      'lat', p.lat,
      'lng', p.lng,
      'phone', p.phone,
      'cover_path', coalesce(p.cover_path, (
        select m.storage_path from public.place_media m
        where m.place_id = p.id and m.status = 'approved' and m.kind = 'image'
        order by m.sort_order, m.created_at limit 1
      )),
      'rating_avg', p.rating_avg,
      'review_count', p.review_count,
      'photo_count', p.photo_count,
      'video_count', p.video_count,
      'category_slug', c.slug,
      'category_name', c.name,
      'district', d.name,
      'neighborhood', n.name,
      'district_id', p.district_id,
      'pending_media', (
        select count(*) from public.place_media m
        where m.place_id = p.id and m.status = 'pending'
      ),
      'pending_claims', (
        select count(*) from public.place_owner_claims cl
        where cl.place_id = p.id and cl.status = 'pending'
      ),
      'owner_id', p.owner_id,
      'created_at', p.created_at,
      'updated_at', p.updated_at
    ) as item
    from public.places p
    left join public.place_categories c on c.id = p.category_id
    left join public.districts d on d.id = p.district_id
    left join public.neighborhoods n on n.id = p.neighborhood_id
    where (p_status is null or p.status = p_status)
      and (p_district_id is null or p.district_id = p_district_id)
      and (p_verification is null or p.verification_status = p_verification)
      and (p_category is null or c.slug = p_category)
      and (v_q is null or p.name ilike '%' || v_q || '%' or coalesce(p.address, '') ilike '%' || v_q || '%')
    order by p.updated_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.admin_places_list(text, text, bigint, text, text, integer, integer) from public, anon;
grant execute on function public.admin_places_list(text, text, bigint, text, text, integer, integer) to authenticated, service_role;

create or replace function public.admin_place_get(p_place_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.view');
  v_place public.places%rowtype;
  v_category public.place_categories%rowtype;
  v_relations jsonb;
  v_media jsonb;
  v_claims jsonb;
  v_reviews jsonb;
  v_reports jsonb;
begin
  select * into v_place from public.places where id = p_place_id;
  if not found then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  select * into v_category from public.place_categories where id = v_place.category_id;

  select coalesce(jsonb_agg(c.slug order by c.name), '[]'::jsonb)
  into v_relations
  from public.place_category_relations r
  join public.place_categories c on c.id = r.category_id
  where r.place_id = p_place_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path,
    'thumb_path', m.thumb_path, 'caption', m.caption, 'status', m.status,
    'sort_order', m.sort_order, 'reel_id', m.reel_id,
    'uploader_id', m.uploader_id, 'created_at', m.created_at
  ) order by m.sort_order, m.created_at), '[]'::jsonb)
  into v_media
  from public.place_media m where m.place_id = p_place_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cl.id, 'status', cl.status, 'applicant_id', cl.applicant_id,
    'applicant', (select p.username::text from public.profiles p where p.id = cl.applicant_id),
    'evidence_type', cl.evidence_type, 'evidence_text', cl.evidence_text,
    'document_path', cl.document_path, 'contact_phone', cl.contact_phone,
    'contact_email', cl.contact_email, 'review_note', cl.review_note,
    'created_at', cl.created_at
  ) order by cl.created_at desc), '[]'::jsonb)
  into v_claims
  from public.place_owner_claims cl where cl.place_id = p_place_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'rating', r.rating, 'body', r.body, 'status', r.status,
    'helpful_count', r.helpful_count, 'author_id', r.author_id,
    'author', (select p.username::text from public.profiles p where p.id = r.author_id),
    'created_at', r.created_at
  ) order by r.created_at desc), '[]'::jsonb)
  into v_reviews
  from (
    select * from public.place_reviews where place_id = p_place_id
    order by created_at desc limit 20
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cr.id, 'target_type', cr.target_type, 'reason', cr.reason,
    'status', cr.status, 'details', cr.details, 'created_at', cr.created_at
  ) order by cr.created_at desc), '[]'::jsonb)
  into v_reports
  from public.content_reports cr
  where cr.target_id = p_place_id and cr.target_type = 'place';

  return jsonb_build_object(
    'id', v_place.id,
    'name', v_place.name,
    'slug', v_place.slug,
    'description', v_place.description,
    'category', case when v_category.id is null then null else jsonb_build_object(
      'id', v_category.id, 'slug', v_category.slug, 'name', v_category.name,
      'icon', v_category.icon, 'tone', v_category.tone
    ) end,
    'category_slugs', v_relations,
    'address', v_place.address,
    'address_public', v_place.address_public,
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
    'verified_at', v_place.verified_at,
    'data_source', v_place.data_source,
    'external_provider', v_place.external_provider,
    'external_id', v_place.external_id,
    'rating_avg', v_place.rating_avg,
    'rating_count', v_place.rating_count,
    'review_count', v_place.review_count,
    'photo_count', v_place.photo_count,
    'video_count', v_place.video_count,
    'favorite_count', v_place.favorite_count,
    'view_count', v_place.view_count,
    'city_id', v_place.city_id,
    'district_id', v_place.district_id,
    'neighborhood_id', v_place.neighborhood_id,
    'district', (select name from public.districts where id = v_place.district_id),
    'neighborhood', (select name from public.neighborhoods where id = v_place.neighborhood_id),
    'owner_id', v_place.owner_id,
    'owner', case when v_place.owner_id is null then null else (
      select jsonb_build_object(
        'id', p.id, 'username', p.username, 'first_name', p.first_name,
        'last_name', p.last_name, 'avatar_path', p.avatar_path,
        'is_verified', p.is_verified, 'account_status', p.account_status
      ) from public.profiles p where p.id = v_place.owner_id
    ) end,
    'media', v_media,
    'claims', v_claims,
    'reviews', v_reviews,
    'reports', v_reports,
    'created_at', v_place.created_at,
    'updated_at', v_place.updated_at
  );
end;
$$;

revoke all on function public.admin_place_get(uuid) from public, anon;
grant execute on function public.admin_place_get(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. İşletme oluşturma / düzenleme / durum / doğrulama / taşıma
-- ---------------------------------------------------------------------
create or replace function public.admin_place_upsert(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.manage');
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_place public.places%rowtype;
  v_city public.cities%rowtype;
  v_district public.districts%rowtype;
  v_category public.place_categories%rowtype;
  v_slug text;
  v_name text;
  v_lat double precision;
  v_lng double precision;
  v_status text;
  v_verification text;
  v_slugs text[];
  v_slug_item text;
begin
  if v_id is null then
    v_name := nullif(btrim(coalesce(p_payload ->> 'name', '')), '');
    if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 140 then
      raise exception 'invalid_name' using errcode = '22023';
    end if;

    select * into v_district from public.districts
    where id = nullif(p_payload ->> 'district_id', '')::bigint;
    if not found then
      raise exception 'invalid_district' using errcode = '22023';
    end if;

    select * into v_city from public.cities where id = v_district.city_id;
    v_lat := nullif(p_payload ->> 'lat', '')::double precision;
    v_lng := nullif(p_payload ->> 'lng', '')::double precision;
    if not public.tz_in_trabzon_bbox(v_lat, v_lng) then
      raise exception 'outside_service_area' using errcode = '22023';
    end if;

    v_slug := nullif(btrim(coalesce(p_payload ->> 'category_slug', '')), '');
    if v_slug is not null then
      select * into v_category from public.place_categories where slug = v_slug;
      if not found then
        raise exception 'invalid_category' using errcode = '22023';
      end if;
    end if;

    v_status := coalesce(nullif(p_payload ->> 'status', ''), 'published');
    if v_status not in ('draft', 'pending', 'published', 'rejected', 'archived', 'duplicate') then
      raise exception 'invalid_status' using errcode = '22023';
    end if;

    v_verification := coalesce(nullif(p_payload ->> 'verification_status', ''), 'unverified');
    if v_verification not in ('unverified', 'pending', 'verified', 'rejected') then
      raise exception 'invalid_verification' using errcode = '22023';
    end if;

    insert into public.places (
      created_by, owner_id, name, slug, description, category_id,
      city_id, district_id, neighborhood_id, address, address_public,
      lat, lng, phone, website, cover_path, opening_hours, price_level,
      status, verification_status, is_verified, verified_at, verified_by,
      data_source, external_provider, external_id
    )
    values (
      v_uid,
      nullif(p_payload ->> 'owner_id', '')::uuid,
      v_name,
      nullif(btrim(coalesce(p_payload ->> 'slug', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'description', '')), ''),
      v_category.id,
      v_city.id,
      v_district.id,
      nullif(p_payload ->> 'neighborhood_id', '')::bigint,
      nullif(btrim(coalesce(p_payload ->> 'address', '')), ''),
      coalesce((p_payload ->> 'address_public')::boolean, true),
      v_lat, v_lng,
      nullif(btrim(coalesce(p_payload ->> 'phone', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'website', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'cover_path', '')), ''),
      case when jsonb_typeof(p_payload -> 'opening_hours') = 'object'
           then p_payload -> 'opening_hours' else '{}'::jsonb end,
      nullif(p_payload ->> 'price_level', '')::smallint,
      v_status,
      v_verification,
      v_verification = 'verified',
      case when v_verification = 'verified' then now() else null end,
      case when v_verification = 'verified' then v_uid else null end,
      'trabzone_admin',
      nullif(btrim(coalesce(p_payload ->> 'external_provider', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'external_id', '')), '')
    )
    returning * into v_place;
  else
    select * into v_place from public.places where id = v_id;
    if not found then
      raise exception 'place_not_found' using errcode = 'P0002';
    end if;

    if p_payload ? 'district_id' then
      select * into v_district from public.districts
      where id = nullif(p_payload ->> 'district_id', '')::bigint;
      if not found then
        raise exception 'invalid_district' using errcode = '22023';
      end if;
    end if;

    if p_payload ? 'category_slug' then
      select * into v_category from public.place_categories
      where slug = nullif(btrim(coalesce(p_payload ->> 'category_slug', '')), '');
      if not found then
        raise exception 'invalid_category' using errcode = '22023';
      end if;
    end if;

    if p_payload ? 'lat' or p_payload ? 'lng' then
      v_lat := coalesce(nullif(p_payload ->> 'lat', '')::double precision, v_place.lat);
      v_lng := coalesce(nullif(p_payload ->> 'lng', '')::double precision, v_place.lng);
      if not public.tz_in_trabzon_bbox(v_lat, v_lng) then
        raise exception 'outside_service_area' using errcode = '22023';
      end if;
    end if;

    if p_payload ? 'status' then
      v_status := p_payload ->> 'status';
      if v_status not in ('draft', 'pending', 'published', 'rejected', 'archived', 'duplicate') then
        raise exception 'invalid_status' using errcode = '22023';
      end if;
    end if;

    if p_payload ? 'verification_status' then
      v_verification := p_payload ->> 'verification_status';
      if v_verification not in ('unverified', 'pending', 'verified', 'rejected') then
        raise exception 'invalid_verification' using errcode = '22023';
      end if;
    end if;

    update public.places
       set name = case when p_payload ? 'name'
                       then nullif(btrim(coalesce(p_payload ->> 'name', '')), '') else name end,
           slug = case when p_payload ? 'slug'
                       then nullif(btrim(coalesce(p_payload ->> 'slug', '')), '') else slug end,
           description = case when p_payload ? 'description'
                              then nullif(btrim(coalesce(p_payload ->> 'description', '')), '') else description end,
           category_id = case when p_payload ? 'category_slug' then v_category.id else category_id end,
           owner_id = case when p_payload ? 'owner_id'
                           then nullif(p_payload ->> 'owner_id', '')::uuid else owner_id end,
           city_id = case when p_payload ? 'district_id' then v_district.city_id else city_id end,
           district_id = case when p_payload ? 'district_id' then v_district.id else district_id end,
           neighborhood_id = case when p_payload ? 'neighborhood_id'
                                  then nullif(p_payload ->> 'neighborhood_id', '')::bigint
                                  else neighborhood_id end,
           address = case when p_payload ? 'address'
                          then nullif(btrim(coalesce(p_payload ->> 'address', '')), '') else address end,
           address_public = case when p_payload ? 'address_public'
                                 then (p_payload ->> 'address_public')::boolean else address_public end,
           lat = coalesce(v_lat, lat),
           lng = coalesce(v_lng, lng),
           phone = case when p_payload ? 'phone'
                        then nullif(btrim(coalesce(p_payload ->> 'phone', '')), '') else phone end,
           website = case when p_payload ? 'website'
                          then nullif(btrim(coalesce(p_payload ->> 'website', '')), '') else website end,
           cover_path = case when p_payload ? 'cover_path'
                             then nullif(btrim(coalesce(p_payload ->> 'cover_path', '')), '') else cover_path end,
           opening_hours = case when p_payload ? 'opening_hours' and jsonb_typeof(p_payload -> 'opening_hours') = 'object'
                                then p_payload -> 'opening_hours' else opening_hours end,
           price_level = case when p_payload ? 'price_level'
                              then nullif(p_payload ->> 'price_level', '')::smallint else price_level end,
           status = coalesce(v_status, status),
           verification_status = coalesce(v_verification, verification_status),
           is_verified = coalesce(v_verification, verification_status) = 'verified',
           verified_at = case when coalesce(v_verification, verification_status) = 'verified'
                              then coalesce(verified_at, now()) else null end,
           verified_by = case when coalesce(v_verification, verification_status) = 'verified'
                              then coalesce(verified_by, v_uid) else null end,
           external_provider = case when p_payload ? 'external_provider'
                                    then nullif(btrim(coalesce(p_payload ->> 'external_provider', '')), '') else external_provider end,
           external_id = case when p_payload ? 'external_id'
                              then nullif(btrim(coalesce(p_payload ->> 'external_id', '')), '') else external_id end
     where id = v_id
     returning * into v_place;
  end if;

  if p_payload ? 'category_slugs' and jsonb_typeof(p_payload -> 'category_slugs') = 'array' then
    delete from public.place_category_relations where place_id = v_place.id;
    for v_slug_item in
      select jsonb_array_elements_text(p_payload -> 'category_slugs')
    loop
      insert into public.place_category_relations (place_id, category_id)
      select v_place.id, id from public.place_categories where slug = v_slug_item
      on conflict do nothing;
    end loop;
    if v_place.category_id is not null then
      insert into public.place_category_relations (place_id, category_id)
      values (v_place.id, v_place.category_id)
      on conflict do nothing;
    end if;
  end if;

  perform public.tz_admin_audit(
    case when v_id is null then 'map.place_created' else 'map.place_updated' end,
    case when v_id is null then 'İşletme oluşturuldu' else 'İşletme güncellendi' end,
    'place', v_place.id::text,
    jsonb_build_object('name', v_place.name, 'status', v_place.status)
  );

  return jsonb_build_object('id', v_place.id, 'status', v_place.status);
end;
$$;

revoke all on function public.admin_place_upsert(jsonb) from public, anon;
grant execute on function public.admin_place_upsert(jsonb) to authenticated, service_role;

create or replace function public.admin_place_set_status(
  p_place_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.moderate');
  v_place public.places%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_status not in ('draft', 'pending', 'published', 'rejected', 'archived', 'duplicate') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_place from public.places where id = p_place_id;
  if not found then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  update public.places set status = p_status where id = p_place_id;

  perform public.tz_admin_audit(
    'map.place_status_changed',
    'İşletme durumu değiştirildi',
    'place', p_place_id::text,
    jsonb_build_object('from', v_place.status, 'to', p_status, 'reason', left(coalesce(v_reason, ''), 400))
  );

  if v_place.created_by is not null and v_place.created_by <> v_uid then
    perform public.tz_notify(
      v_place.created_by, null, 'system', 'İşletme başvurusu güncellendi',
      left(v_place.name || ' · ' || p_status, 400),
      'place', p_place_id::text, '/places/' || p_place_id::text
    );
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.admin_place_set_status(uuid, text, text) from public, anon;
grant execute on function public.admin_place_set_status(uuid, text, text) to authenticated, service_role;

create or replace function public.admin_place_verify(
  p_place_id uuid,
  p_verified boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.moderate');
  v_place public.places%rowtype;
begin
  select * into v_place from public.places where id = p_place_id;
  if not found then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  update public.places
     set verification_status = case when coalesce(p_verified, false) then 'verified' else 'unverified' end,
         is_verified = coalesce(p_verified, false),
         verified_at = case when coalesce(p_verified, false) then now() else null end,
         verified_by = case when coalesce(p_verified, false) then v_uid else null end
   where id = p_place_id;

  perform public.tz_admin_audit(
    'map.place_verification_changed',
    case when coalesce(p_verified, false) then 'İşletme doğrulandı' else 'İşletme doğrulaması kaldırıldı' end,
    'place', p_place_id::text,
    jsonb_build_object('verified', coalesce(p_verified, false), 'reason', left(coalesce(p_reason, ''), 400))
  );

  return jsonb_build_object('ok', true, 'is_verified', coalesce(p_verified, false));
end;
$$;

revoke all on function public.admin_place_verify(uuid, boolean, text) from public, anon;
grant execute on function public.admin_place_verify(uuid, boolean, text) to authenticated, service_role;

create or replace function public.admin_place_move(
  p_place_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.manage');
  v_place public.places%rowtype;
begin
  if not public.tz_in_trabzon_bbox(p_lat, p_lng) then
    raise exception 'outside_service_area' using errcode = '22023';
  end if;

  select * into v_place from public.places where id = p_place_id;
  if not found then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  update public.places set lat = p_lat, lng = p_lng where id = p_place_id;

  perform public.tz_admin_audit(
    'map.place_moved',
    'İşletme konumu düzeltildi',
    'place', p_place_id::text,
    jsonb_build_object(
      'from', jsonb_build_array(v_place.lat, v_place.lng),
      'to', jsonb_build_array(p_lat, p_lng),
      'reason', left(coalesce(p_reason, ''), 400)
    )
  );

  return jsonb_build_object('ok', true, 'lat', p_lat, 'lng', p_lng);
end;
$$;

revoke all on function public.admin_place_move(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.admin_place_move(uuid, double precision, double precision, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Yinelenen işletme birleştirme
-- ---------------------------------------------------------------------
create or replace function public.admin_place_merge(
  p_source_id uuid,
  p_target_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.manage');
  v_source public.places%rowtype;
  v_target public.places%rowtype;
begin
  if p_source_id = p_target_id then
    raise exception 'same_place' using errcode = '22023';
  end if;

  select * into v_source from public.places where id = p_source_id;
  if not found then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;
  select * into v_target from public.places where id = p_target_id;
  if not found then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;

  -- Aynı yazarın iki kayıtta yorumu varsa kaynak yorumu kaldırılır.
  update public.place_reviews r
     set status = 'removed'
   where r.place_id = p_source_id
     and exists (
       select 1 from public.place_reviews t
       where t.place_id = p_target_id and t.author_id = r.author_id
     );
  update public.place_reviews set place_id = p_target_id where place_id = p_source_id;

  update public.place_media set place_id = p_target_id where place_id = p_source_id;

  insert into public.place_favorites (place_id, user_id, created_at)
  select p_target_id, user_id, created_at from public.place_favorites where place_id = p_source_id
  on conflict do nothing;
  delete from public.place_favorites where place_id = p_source_id;

  insert into public.place_business_managers (place_id, user_id, role, granted_by, created_at)
  select p_target_id, user_id, role, granted_by, created_at
  from public.place_business_managers where place_id = p_source_id
  on conflict do nothing;
  delete from public.place_business_managers where place_id = p_source_id;

  insert into public.place_category_relations (place_id, category_id, created_at)
  select p_target_id, category_id, created_at
  from public.place_category_relations where place_id = p_source_id
  on conflict do nothing;
  delete from public.place_category_relations where place_id = p_source_id;

  insert into public.place_external_references (
    place_id, provider, external_id, attribution_text, license_note, metadata, raw_content_saved, fetched_at
  )
  select p_target_id, provider, external_id, attribution_text, license_note, metadata, raw_content_saved, fetched_at
  from public.place_external_references where place_id = p_source_id
  on conflict do nothing;
  delete from public.place_external_references where place_id = p_source_id;

  insert into public.place_content_links (place_id, reel_id, post_id, created_by, created_at)
  select p_target_id, reel_id, post_id, created_by, created_at
  from public.place_content_links where place_id = p_source_id
  on conflict do nothing;
  delete from public.place_content_links where place_id = p_source_id;

  update public.place_suggestions set created_place_id = p_target_id where created_place_id = p_source_id;

  update public.place_owner_claims
     set status = 'rejected',
         review_note = 'Kayıt başka bir işletme kaydıyla birleştirildi.',
         reviewed_by = v_uid,
         reviewed_at = now()
   where place_id = p_source_id and status = 'pending';

  update public.content_reports cr
     set target_id = p_target_id
   where cr.target_type = 'place'
     and cr.target_id = p_source_id
     and not exists (
       select 1 from public.content_reports x
       where x.reporter_id = cr.reporter_id
         and x.target_type = 'place'
         and x.target_id = p_target_id
         and x.status = 'pending'
     );

  update public.content_reports
     set status = 'resolved',
         resolved_at = now(),
         moderation_note = coalesce(moderation_note, 'Kayıt başka bir işletme kaydıyla birleştirildi.')
   where target_type = 'place' and target_id = p_source_id and status = 'pending';

  update public.places
     set status = 'duplicate',
         description = left(concat_ws(E'\n', description, '[Birleştirildi: ' || v_target.name || ']'), 4000)
   where id = p_source_id;

  perform public.tz_admin_audit(
    'map.place_merged',
    'Yinelenen işletme birleştirildi',
    'place', p_source_id::text,
    jsonb_build_object('target_id', p_target_id, 'target_name', v_target.name,
                       'source_name', v_source.name, 'reason', left(coalesce(p_reason, ''), 400))
  );

  return jsonb_build_object('ok', true, 'target_id', p_target_id);
end;
$$;

revoke all on function public.admin_place_merge(uuid, uuid, text) from public, anon;
grant execute on function public.admin_place_merge(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Kategori yönetimi
-- ---------------------------------------------------------------------
create or replace function public.admin_place_categories()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'parent_id', c.parent_id, 'slug', c.slug, 'name', c.name,
        'icon', c.icon, 'tone', c.tone, 'sort_order', c.sort_order,
        'is_active', c.is_active,
        'place_count', (select count(*) from public.places p where p.category_id = c.id),
        'children_count', (select count(*) from public.place_categories ch where ch.parent_id = c.id)
      ) order by c.sort_order, c.name)
      from public.place_categories c
    ), '[]'::jsonb)
  )
  where public.tz_admin_require('map.view') is not null;
$$;

revoke all on function public.admin_place_categories() from public, anon;
grant execute on function public.admin_place_categories() to authenticated, service_role;

create or replace function public.admin_place_category_upsert(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.manage');
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_parent uuid := nullif(p_payload ->> 'parent_id', '')::uuid;
  v_slug text := nullif(btrim(coalesce(p_payload ->> 'slug', '')), '');
  v_name text := nullif(btrim(coalesce(p_payload ->> 'name', '')), '');
  v_tone text := coalesce(nullif(p_payload ->> 'tone', ''), 'primary');
  v_category public.place_categories%rowtype;
begin
  if v_slug is null or v_slug !~ '^[a-z0-9-]{2,48}$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_tone not in ('primary', 'accent', 'success', 'warning', 'danger', 'info') then
    raise exception 'invalid_tone' using errcode = '22023';
  end if;
  if v_parent is not null and not exists (select 1 from public.place_categories where id = v_parent) then
    raise exception 'invalid_parent' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.place_categories (
      parent_id, slug, name, icon, tone, sort_order, is_active
    ) values (
      v_parent, v_slug, v_name,
      coalesce(nullif(p_payload ->> 'icon', ''), 'storefront-outline'), v_tone,
      coalesce(nullif(p_payload ->> 'sort_order', '')::integer, 0),
      coalesce((p_payload ->> 'is_active')::boolean, true)
    ) returning * into v_category;
  else
    update public.place_categories
       set parent_id = case when p_payload ? 'parent_id' then v_parent else parent_id end,
           slug = v_slug,
           name = v_name,
           icon = coalesce(nullif(p_payload ->> 'icon', ''), icon),
           tone = v_tone,
           sort_order = coalesce(nullif(p_payload ->> 'sort_order', '')::integer, sort_order),
           is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active)
     where id = v_id
     returning * into v_category;
    if not found then
      raise exception 'category_not_found' using errcode = 'P0002';
    end if;
  end if;

  perform public.tz_admin_audit(
    'map.category_saved', 'İşletme kategorisi kaydedildi', 'place_category', v_category.id::text,
    jsonb_build_object('slug', v_category.slug, 'name', v_category.name, 'is_active', v_category.is_active)
  );

  return jsonb_build_object('id', v_category.id, 'slug', v_category.slug);
end;
$$;

revoke all on function public.admin_place_category_upsert(jsonb) from public, anon;
grant execute on function public.admin_place_category_upsert(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. İşletme önerileri
-- ---------------------------------------------------------------------
create or replace function public.admin_place_suggestions_list(
  p_status text default 'pending',
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status, 'payload', s.payload,
        'review_note', s.review_note, 'created_place_id', s.created_place_id,
        'submitter_id', s.submitter_id,
        'submitter', (select p.username::text from public.profiles p where p.id = s.submitter_id),
        'created_at', s.created_at, 'reviewed_at', s.reviewed_at
      ) order by s.created_at)
      from (
        select * from public.place_suggestions
        where (p_status is null or status = p_status)
        order by created_at
        limit least(greatest(coalesce(p_limit, 40), 1), 100)
        offset greatest(coalesce(p_offset, 0), 0)
      ) s
    ), '[]'::jsonb),
    'total', (
      select count(*) from public.place_suggestions
      where (p_status is null or status = p_status)
    )
  )
  where public.tz_admin_require('map.view') is not null;
$$;

revoke all on function public.admin_place_suggestions_list(text, integer, integer) from public, anon;
grant execute on function public.admin_place_suggestions_list(text, integer, integer) to authenticated, service_role;

create or replace function public.admin_place_suggestion_review(
  p_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.moderate');
  v_suggestion public.place_suggestions%rowtype;
  v_district public.districts%rowtype;
  v_city public.cities%rowtype;
  v_category public.place_categories%rowtype;
  v_name text;
  v_lat double precision;
  v_lng double precision;
  v_place public.places%rowtype;
begin
  if p_decision not in ('approve', 'reject', 'duplicate') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into v_suggestion from public.place_suggestions where id = p_id;
  if not found then
    raise exception 'suggestion_not_found' using errcode = 'P0002';
  end if;
  if v_suggestion.status <> 'pending' then
    raise exception 'already_reviewed' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    v_name := nullif(btrim(coalesce(v_suggestion.payload ->> 'name', '')), '');
    v_lat := nullif(v_suggestion.payload ->> 'lat', '')::double precision;
    v_lng := nullif(v_suggestion.payload ->> 'lng', '')::double precision;

    if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 140 then
      raise exception 'invalid_name' using errcode = '22023';
    end if;
    if not public.tz_in_trabzon_bbox(v_lat, v_lng) then
      raise exception 'outside_service_area' using errcode = '22023';
    end if;

    select * into v_district from public.districts
    where id = nullif(v_suggestion.payload ->> 'district_id', '')::bigint;
    if not found then
      raise exception 'invalid_district' using errcode = '22023';
    end if;
    select * into v_city from public.cities where id = v_district.city_id;

    select * into v_category from public.place_categories
    where slug = nullif(btrim(coalesce(v_suggestion.payload ->> 'category_slug', '')), '');

    insert into public.places (
      created_by, owner_id, name, description, category_id,
      city_id, district_id, neighborhood_id, address, lat, lng,
      phone, website, status, verification_status, data_source
    ) values (
      v_suggestion.submitter_id, null, v_name,
      nullif(btrim(coalesce(v_suggestion.payload ->> 'description', '')), ''),
      v_category.id, v_city.id, v_district.id,
      nullif(v_suggestion.payload ->> 'neighborhood_id', '')::bigint,
      nullif(btrim(coalesce(v_suggestion.payload ->> 'address', '')), ''),
      v_lat, v_lng,
      nullif(btrim(coalesce(v_suggestion.payload ->> 'phone', '')), ''),
      nullif(btrim(coalesce(v_suggestion.payload ->> 'website', '')), ''),
      'published', 'unverified', 'trabzone_user'
    ) returning * into v_place;

    if v_category.id is not null then
      insert into public.place_category_relations (place_id, category_id)
      values (v_place.id, v_category.id)
      on conflict do nothing;
    end if;

    update public.place_suggestions
       set status = 'approved', review_note = nullif(btrim(coalesce(p_note, '')), ''),
           reviewed_by = v_uid, reviewed_at = now(), created_place_id = v_place.id
     where id = p_id;

    perform public.tz_notify(
      v_suggestion.submitter_id, null, 'system', 'İşletme önerin yayınlandı',
      left(v_name || ' haritada yayınlandı.', 400),
      'place', v_place.id::text, '/places/' || v_place.id::text
    );

    perform public.tz_admin_audit(
      'map.suggestion_approved', 'İşletme önerisi onaylandı', 'place_suggestion', p_id::text,
      jsonb_build_object('place_id', v_place.id, 'name', v_name)
    );

    return jsonb_build_object('ok', true, 'place_id', v_place.id);
  end if;

  update public.place_suggestions
     set status = case when p_decision = 'duplicate' then 'duplicate' else 'rejected' end,
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         reviewed_by = v_uid, reviewed_at = now()
   where id = p_id;

  perform public.tz_notify(
    v_suggestion.submitter_id, null, 'system', 'İşletme önerisi incelendi',
    left(case when p_decision = 'duplicate' then 'Benzer bir kayıt bulundu.' else 'Öneri reddedildi.' end, 400),
    'place_suggestion', p_id::text, '/map'
  );

  perform public.tz_admin_audit(
    'map.suggestion_rejected', 'İşletme önerisi reddedildi', 'place_suggestion', p_id::text,
    jsonb_build_object('decision', p_decision, 'note', left(coalesce(p_note, ''), 400))
  );

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.admin_place_suggestion_review(uuid, text, text) from public, anon;
grant execute on function public.admin_place_suggestion_review(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. Sahiplenme başvuruları
-- ---------------------------------------------------------------------
create or replace function public.admin_place_claims_list(
  p_status text default 'pending',
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cl.id, 'status', cl.status, 'place_id', cl.place_id,
        'place_name', (select p.name from public.places p where p.id = cl.place_id),
        'place_district', (select d.name from public.places p join public.districts d on d.id = p.district_id where p.id = cl.place_id),
        'applicant_id', cl.applicant_id,
        'applicant', (select p.username::text from public.profiles p where p.id = cl.applicant_id),
        'evidence_type', cl.evidence_type, 'evidence_text', cl.evidence_text,
        'document_path', cl.document_path, 'contact_phone', cl.contact_phone,
        'contact_email', cl.contact_email, 'review_note', cl.review_note,
        'created_at', cl.created_at, 'reviewed_at', cl.reviewed_at
      ) order by cl.created_at)
      from (
        select * from public.place_owner_claims
        where (p_status is null or status = p_status)
        order by created_at
        limit least(greatest(coalesce(p_limit, 40), 1), 100)
        offset greatest(coalesce(p_offset, 0), 0)
      ) cl
    ), '[]'::jsonb),
    'total', (
      select count(*) from public.place_owner_claims
      where (p_status is null or status = p_status)
    )
  )
  where public.tz_admin_require('map.view') is not null;
$$;

revoke all on function public.admin_place_claims_list(text, integer, integer) from public, anon;
grant execute on function public.admin_place_claims_list(text, integer, integer) to authenticated, service_role;

create or replace function public.admin_place_claim_review(
  p_claim_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.moderate');
  v_claim public.place_owner_claims%rowtype;
  v_place public.places%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into v_claim from public.place_owner_claims where id = p_claim_id;
  if not found then
    raise exception 'claim_not_found' using errcode = 'P0002';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'already_reviewed' using errcode = '22023';
  end if;

  select * into v_place from public.places where id = v_claim.place_id;

  if p_decision = 'approve' then
    update public.places
       set owner_id = v_claim.applicant_id,
           verification_status = 'verified',
           is_verified = true,
           verified_at = now(),
           verified_by = v_uid
     where id = v_claim.place_id;

    insert into public.place_business_managers (place_id, user_id, role, granted_by)
    values (v_claim.place_id, v_claim.applicant_id, 'owner', v_uid)
    on conflict (place_id, user_id) do update set role = 'owner';

    update public.place_owner_claims
       set status = 'rejected',
           review_note = 'İşletme başka bir başvuru ile sahiplenildi.',
           reviewed_by = v_uid,
           reviewed_at = now()
     where place_id = v_claim.place_id and id <> p_claim_id and status = 'pending';

    update public.place_owner_claims
       set status = 'approved', review_note = v_note, reviewed_by = v_uid, reviewed_at = now()
     where id = p_claim_id;

    perform public.tz_notify(
      v_claim.applicant_id, null, 'system', 'İşletme sahipliğin onaylandı',
      left(v_place.name || ' artık hesabına bağlı.', 400),
      'place', v_claim.place_id::text, '/places/' || v_claim.place_id::text
    );

    perform public.tz_admin_audit(
      'map.claim_approved', 'İşletme sahiplenmesi onaylandı', 'place_claim', p_claim_id::text,
      jsonb_build_object('place_id', v_claim.place_id, 'applicant_id', v_claim.applicant_id)
    );

    return jsonb_build_object('ok', true, 'status', 'approved');
  end if;

  update public.place_owner_claims
     set status = 'rejected', review_note = v_note, reviewed_by = v_uid, reviewed_at = now()
   where id = p_claim_id;

  perform public.tz_notify(
    v_claim.applicant_id, null, 'system', 'İşletme sahiplenme başvurusu reddedildi',
    left(coalesce(v_note, 'Başvuru uygun bulunmadı.'), 400),
    'place', v_claim.place_id::text, '/places/' || v_claim.place_id::text
  );

  perform public.tz_admin_audit(
    'map.claim_rejected', 'İşletme sahiplenmesi reddedildi', 'place_claim', p_claim_id::text,
    jsonb_build_object('place_id', v_claim.place_id, 'note', left(coalesce(v_note, ''), 400))
  );

  return jsonb_build_object('ok', true, 'status', 'rejected');
end;
$$;

revoke all on function public.admin_place_claim_review(uuid, text, text) from public, anon;
grant execute on function public.admin_place_claim_review(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. Medya / yorum / şikâyet moderasyonu
-- ---------------------------------------------------------------------
create or replace function public.admin_place_media_list(
  p_status text default 'pending',
  p_place_id uuid default null,
  p_limit integer default 60
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'place_id', m.place_id,
        'place_name', (select p.name from public.places p where p.id = m.place_id),
        'kind', m.kind, 'storage_path', m.storage_path, 'thumb_path', m.thumb_path,
        'caption', m.caption, 'status', m.status, 'uploader_id', m.uploader_id,
        'uploader', (select p.username::text from public.profiles p where p.id = m.uploader_id),
        'created_at', m.created_at
      ) order by m.created_at)
      from (
        select * from public.place_media
        where (p_status is null or status = p_status)
          and (p_place_id is null or place_id = p_place_id)
        order by created_at
        limit least(greatest(coalesce(p_limit, 60), 1), 200)
      ) m
    ), '[]'::jsonb)
  )
  where public.tz_admin_require('map.view') is not null;
$$;

revoke all on function public.admin_place_media_list(text, uuid, integer) from public, anon;
grant execute on function public.admin_place_media_list(text, uuid, integer) to authenticated, service_role;

create or replace function public.admin_place_media_review(
  p_media_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.moderate');
  v_media public.place_media%rowtype;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into v_media from public.place_media where id = p_media_id;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;

  update public.place_media
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         moderation_note = nullif(btrim(coalesce(p_note, '')), ''),
         moderated_by = v_uid,
         moderated_at = now()
   where id = p_media_id;

  if p_decision = 'approve' then
    update public.places
       set cover_path = v_media.storage_path
     where id = v_media.place_id
       and (cover_path is null or cover_path = '')
       and v_media.kind = 'image';
  end if;

  perform public.tz_notify(
    v_media.uploader_id, null, 'system',
    case when p_decision = 'approve' then 'Medyan yayınlandı' else 'Medyan yayınlanmadı' end,
    left(coalesce(p_note, 'İşletme medya incelemesi tamamlandı.'), 400),
    'place_media', p_media_id::text, '/places/' || v_media.place_id::text
  );

  perform public.tz_admin_audit(
    'map.media_' || case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'İşletme medyası incelendi', 'place_media', p_media_id::text,
    jsonb_build_object('decision', p_decision, 'note', left(coalesce(p_note, ''), 400))
  );

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.admin_place_media_review(uuid, text, text) from public, anon;
grant execute on function public.admin_place_media_review(uuid, text, text) to authenticated, service_role;

create or replace function public.admin_place_reviews_list(
  p_status text default null,
  p_place_id uuid default null,
  p_q text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'place_id', r.place_id,
        'place_name', (select p.name from public.places p where p.id = r.place_id),
        'author_id', r.author_id,
        'author', (select p.username::text from public.profiles p where p.id = r.author_id),
        'rating', r.rating, 'body', r.body, 'status', r.status,
        'helpful_count', r.helpful_count, 'created_at', r.created_at
      ) order by r.created_at desc)
      from (
        select * from public.place_reviews
        where (p_status is null or status = p_status)
          and (p_place_id is null or place_id = p_place_id)
          and (nullif(btrim(coalesce(p_q, '')), '') is null
               or coalesce(body, '') ilike '%' || btrim(p_q) || '%')
        order by created_at desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
        offset greatest(coalesce(p_offset, 0), 0)
      ) r
    ), '[]'::jsonb),
    'total', (
      select count(*) from public.place_reviews
      where (p_status is null or status = p_status)
        and (p_place_id is null or place_id = p_place_id)
        and (nullif(btrim(coalesce(p_q, '')), '') is null
             or coalesce(body, '') ilike '%' || btrim(p_q) || '%')
    )
  )
  where public.tz_admin_require('map.view') is not null;
$$;

revoke all on function public.admin_place_reviews_list(text, uuid, text, integer, integer) from public, anon;
grant execute on function public.admin_place_reviews_list(text, uuid, text, integer, integer) to authenticated, service_role;

create or replace function public.admin_place_review_moderate(
  p_review_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.moderate');
  v_review public.place_reviews%rowtype;
  v_status text;
begin
  if p_action not in ('show', 'hide', 'remove') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  select * into v_review from public.place_reviews where id = p_review_id;
  if not found then
    raise exception 'review_not_found' using errcode = 'P0002';
  end if;

  v_status := case p_action when 'show' then 'visible' when 'hide' then 'hidden' else 'removed' end;
  update public.place_reviews set status = v_status where id = p_review_id;

  perform public.tz_notify(
    v_review.author_id, null, 'system', 'Yorumun incelendi',
    left(coalesce(p_note, 'Yorum moderasyonu tamamlandı.'), 400),
    'place_review', p_review_id::text, '/places/' || v_review.place_id::text
  );

  perform public.tz_admin_audit(
    'map.review_' || p_action, 'İşletme yorumu incelendi', 'place_review', p_review_id::text,
    jsonb_build_object('action', p_action, 'from', v_review.status, 'to', v_status,
                       'note', left(coalesce(p_note, ''), 400))
  );

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

revoke all on function public.admin_place_review_moderate(uuid, text, text) from public, anon;
grant execute on function public.admin_place_review_moderate(uuid, text, text) to authenticated, service_role;

create or replace function public.admin_reports_list(
  p_status text default 'pending',
  p_target_type text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'target_type', r.target_type, 'target_id', r.target_id,
        'target_label', case r.target_type
          when 'place' then (select p.name from public.places p where p.id = r.target_id)
          when 'place_review' then (select left(coalesce(pr.body, 'Yorum'), 100) from public.place_reviews pr where pr.id = r.target_id)
          when 'place_media' then (select pm.storage_path from public.place_media pm where pm.id = r.target_id)
          when 'real_estate_listing' then (select l.title from public.real_estate_listings l where l.id = r.target_id)
          when 'real_estate_media' then (select rm.storage_path from public.real_estate_media rm where rm.id = r.target_id)
          else null end,
        'reason', r.reason, 'details', r.details, 'status', r.status,
        'reporter_id', r.reporter_id,
        'reporter', (select p.username::text from public.profiles p where p.id = r.reporter_id),
        'created_at', r.created_at, 'resolved_at', r.resolved_at
      ) order by r.created_at)
      from (
        select * from public.content_reports
        where (p_status is null or status = p_status)
          and (p_target_type is null or target_type = p_target_type)
        order by created_at
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
        offset greatest(coalesce(p_offset, 0), 0)
      ) r
    ), '[]'::jsonb),
    'total', (
      select count(*) from public.content_reports
      where (p_status is null or status = p_status)
        and (p_target_type is null or target_type = p_target_type)
    )
  )
  where public.tz_admin_require('map.view') is not null;
$$;

revoke all on function public.admin_reports_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_reports_list(text, text, integer, integer) to authenticated, service_role;

create or replace function public.admin_report_review(
  p_report_id uuid,
  p_decision text,
  p_action text default 'none',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
  v_report public.content_reports%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_decision not in ('resolve', 'dismiss') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if p_action not in ('none', 'remove') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  select * into v_report from public.content_reports where id = p_report_id;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;

  if v_report.target_type like 'real_estate%' then
    v_uid := public.tz_admin_require('realestate.moderate');
  else
    v_uid := public.tz_admin_require('map.moderate');
  end if;

  if p_decision = 'resolve' and p_action = 'remove' then
    case v_report.target_type
      when 'place' then
        update public.places set status = 'archived' where id = v_report.target_id;
      when 'place_review' then
        update public.place_reviews set status = 'removed' where id = v_report.target_id;
      when 'place_media' then
        update public.place_media
           set status = 'rejected', moderation_note = coalesce(v_note, moderation_note),
               moderated_by = v_uid, moderated_at = now()
         where id = v_report.target_id;
      when 'real_estate_listing' then
        update public.real_estate_listings set status = 'removed' where id = v_report.target_id;
      when 'real_estate_media' then
        update public.real_estate_media set status = 'removed' where id = v_report.target_id;
      else null;
    end case;
  end if;

  update public.content_reports
     set status = case when p_decision = 'resolve' then 'resolved' else 'dismissed' end,
         moderated_by = v_uid,
         moderation_note = v_note,
         resolved_at = now()
   where id = p_report_id;

  perform public.tz_notify(
    v_report.reporter_id, null, 'system', 'Şikâyetin incelendi',
    left(coalesce(v_note, case when p_decision = 'resolve' then 'Şikâyet işleme alındı.' else 'Şikâyet reddedildi.' end), 400),
    v_report.target_type, v_report.target_id::text,
    case when v_report.target_type = 'real_estate_listing'
         then '/marketplace/real-estate/' || v_report.target_id::text
         else '/explore' end
  );

  perform public.tz_admin_audit(
    'map.report_' || p_decision, 'İçerik şikâyeti incelendi', 'content_report', p_report_id::text,
    jsonb_build_object('target_type', v_report.target_type, 'target_id', v_report.target_id,
                       'action', p_action, 'note', left(coalesce(v_note, ''), 400))
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_report_review(uuid, text, text, text) from public, anon;
grant execute on function public.admin_report_review(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 11. Emlak yönetimi
-- ---------------------------------------------------------------------
create or replace function public.admin_re_list(
  p_status text default null,
  p_q text default null,
  p_district_id bigint default null,
  p_listing_kind text default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('realestate.view');
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.real_estate_listings l
  where (p_status is null or l.status = p_status)
    and (p_district_id is null or l.district_id = p_district_id)
    and (p_listing_kind is null or l.listing_kind = p_listing_kind)
    and (v_q is null or l.title ilike '%' || v_q || '%' or l.id::text ilike v_q || '%');

  select coalesce(jsonb_agg(item order by item ->> 'created_at' desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', l.id,
      'title', l.title,
      'status', l.status,
      'verification_status', l.verification_status,
      'eids_status', l.eids_status,
      'listing_kind', l.listing_kind,
      'owner_type', l.owner_type,
      'price_cents', l.price_cents,
      'currency', l.currency,
      'price_period', l.price_period,
      'category_slug', c.slug,
      'category_name', c.name,
      'district', d.name,
      'neighborhood', n.name,
      'district_id', l.district_id,
      'lat', l.public_lat,
      'lng', l.public_lng,
      'cover_path', (
        select m.storage_path from public.real_estate_media m
        where m.listing_id = l.id
        order by m.cover desc, m.sort_order limit 1
      ),
      'media_count', (select count(*) from public.real_estate_media m where m.listing_id = l.id),
      'pending_media', (select count(*) from public.real_estate_media m where m.listing_id = l.id and m.status = 'pending'),
      'owner_id', l.owner_id,
      'owner', (select p.username::text from public.profiles p where p.id = l.owner_id),
      'rejection_reason', l.rejection_reason,
      'published_at', l.published_at,
      'expires_at', l.expires_at,
      'created_at', l.created_at
    ) as item
    from public.real_estate_listings l
    join public.real_estate_categories c on c.id = l.category_id
    left join public.districts d on d.id = l.district_id
    left join public.neighborhoods n on n.id = l.neighborhood_id
    where (p_status is null or l.status = p_status)
      and (p_district_id is null or l.district_id = p_district_id)
      and (p_listing_kind is null or l.listing_kind = p_listing_kind)
      and (v_q is null or l.title ilike '%' || v_q || '%' or l.id::text ilike v_q || '%')
    order by l.created_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.admin_re_list(text, text, bigint, text, integer, integer) from public, anon;
grant execute on function public.admin_re_list(text, text, bigint, text, integer, integer) to authenticated, service_role;

create or replace function public.admin_re_get(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('realestate.view');
  v_listing public.real_estate_listings%rowtype;
  v_owner public.profiles%rowtype;
  v_category public.real_estate_categories%rowtype;
  v_media jsonb;
  v_verifications jsonb;
  v_moderation jsonb;
  v_reports jsonb;
begin
  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  select * into v_owner from public.profiles where id = v_listing.owner_id;
  select * into v_category from public.real_estate_categories where id = v_listing.category_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path, 'cover', m.cover,
    'caption', m.caption, 'sort_order', m.sort_order, 'status', m.status,
    'uploader_id', m.uploader_id, 'created_at', m.created_at
  ) order by m.cover desc, m.sort_order), '[]'::jsonb)
  into v_media
  from public.real_estate_media m where m.listing_id = p_listing_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'kind', v.kind, 'status', v.status, 'reference_no', v.reference_no,
    'document_path', v.document_path, 'note', v.note, 'reviewed_by', v.reviewed_by,
    'reviewed_at', v.reviewed_at, 'expires_at', v.expires_at, 'created_at', v.created_at
  ) order by v.created_at desc), '[]'::jsonb)
  into v_verifications
  from public.real_estate_verifications v where v.listing_id = p_listing_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', mo.id, 'action', mo.action, 'reason', mo.reason,
    'admin_id', mo.admin_id, 'metadata', mo.metadata, 'created_at', mo.created_at
  ) order by mo.created_at desc), '[]'::jsonb)
  into v_moderation
  from public.real_estate_moderation mo where mo.listing_id = p_listing_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'reason', r.reason, 'status', r.status, 'details', r.details,
    'target_type', r.target_type, 'created_at', r.created_at
  ) order by r.created_at desc), '[]'::jsonb)
  into v_reports
  from public.content_reports r
  where r.target_id = p_listing_id and r.target_type in ('real_estate_listing', 'real_estate_media');

  return jsonb_build_object(
    'id', v_listing.id,
    'title', v_listing.title,
    'description', v_listing.description,
    'status', v_listing.status,
    'verification_status', v_listing.verification_status,
    'eids_status', v_listing.eids_status,
    'eids_reference', v_listing.eids_reference,
    'eids_verified_at', v_listing.eids_verified_at,
    'eids_expires_at', v_listing.eids_expires_at,
    'listing_kind', v_listing.listing_kind,
    'owner_type', v_listing.owner_type,
    'price_cents', v_listing.price_cents,
    'currency', v_listing.currency,
    'price_period', v_listing.price_period,
    'category', case when v_category.id is null then null else jsonb_build_object(
      'id', v_category.id, 'slug', v_category.slug, 'name', v_category.name,
      'listing_kind', v_category.listing_kind
    ) end,
    'city_id', v_listing.city_id,
    'district_id', v_listing.district_id,
    'neighborhood_id', v_listing.neighborhood_id,
    'district', (select name from public.districts where id = v_listing.district_id),
    'neighborhood', (select name from public.neighborhoods where id = v_listing.neighborhood_id),
    'address_text', v_listing.address_text,
    'address_private', v_listing.address_private,
    'hide_exact_location', v_listing.hide_exact_location,
    'lat', v_listing.lat,
    'lng', v_listing.lng,
    'public_lat', v_listing.public_lat,
    'public_lng', v_listing.public_lng,
    'gross_m2', v_listing.gross_m2,
    'net_m2', v_listing.net_m2,
    'room_count', v_listing.room_count,
    'living_room_count', v_listing.living_room_count,
    'building_age', v_listing.building_age,
    'floor_no', v_listing.floor_no,
    'total_floors', v_listing.total_floors,
    'heating', v_listing.heating,
    'furnished', v_listing.furnished,
    'balcony', v_listing.balcony,
    'parking', v_listing.parking,
    'elevator', v_listing.elevator,
    'deposit_cents', v_listing.deposit_cents,
    'dues_cents', v_listing.dues_cents,
    'attributes', v_listing.attributes,
    'rejection_reason', v_listing.rejection_reason,
    'published_at', v_listing.published_at,
    'expires_at', v_listing.expires_at,
    'view_count', v_listing.view_count,
    'favorite_count', v_listing.favorite_count,
    'owner', jsonb_build_object(
      'id', v_owner.id, 'username', v_owner.username,
      'first_name', v_owner.first_name, 'last_name', v_owner.last_name,
      'avatar_path', v_owner.avatar_path, 'is_verified', v_owner.is_verified,
      'account_status', v_owner.account_status
    ),
    'media', v_media,
    'verifications', v_verifications,
    'moderation', v_moderation,
    'reports', v_reports,
    'eids_enabled', public.tz_app_flag('real_estate.eids_enabled'),
    'created_at', v_listing.created_at,
    'updated_at', v_listing.updated_at
  );
end;
$$;

revoke all on function public.admin_re_get(uuid) from public, anon;
grant execute on function public.admin_re_get(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12. EİDS doğrulama incelemesi
-- ---------------------------------------------------------------------
create or replace function public.tz_re_refresh_verification(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_listing public.real_estate_listings%rowtype;
  v_identity boolean;
  v_authority boolean;
  v_pending boolean;
  v_rejected boolean;
  v_expires timestamptz;
begin
  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    return;
  end if;

  select
    bool_or(kind = 'eids_identity' and status = 'approved'),
    bool_or(kind in ('eids_authority', 'ownership_document') and status = 'approved'),
    bool_or(status = 'pending'),
    bool_or(status = 'rejected'),
    min(expires_at) filter (where status = 'approved')
  into v_identity, v_authority, v_pending, v_rejected, v_expires
  from public.real_estate_verifications
  where listing_id = p_listing_id;

  if coalesce(v_identity, false) and coalesce(v_authority, false) then
    update public.real_estate_listings
       set verification_status = 'verified',
           eids_status = 'verified',
           eids_verified_at = coalesce(eids_verified_at, now()),
           eids_expires_at = v_expires
     where id = p_listing_id;
  elsif coalesce(v_pending, false) then
    update public.real_estate_listings
       set verification_status = 'pending', eids_status = 'pending'
     where id = p_listing_id;
  elsif coalesce(v_rejected, false) then
    update public.real_estate_listings
       set verification_status = 'rejected', eids_status = 'rejected'
     where id = p_listing_id;
  else
    update public.real_estate_listings
       set verification_status = 'unverified', eids_status = 'not_started'
     where id = p_listing_id;
  end if;
end;
$$;

revoke all on function public.tz_re_refresh_verification(uuid) from public, anon, authenticated;

create or replace function public.admin_re_verifications_list(
  p_status text default 'pending',
  p_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'listing_id', v.listing_id,
        'listing_title', (select l.title from public.real_estate_listings l where l.id = v.listing_id),
        'listing_status', (select l.status from public.real_estate_listings l where l.id = v.listing_id),
        'owner_type', (select l.owner_type from public.real_estate_listings l where l.id = v.listing_id),
        'owner_id', (select l.owner_id from public.real_estate_listings l where l.id = v.listing_id),
        'owner', (select p.username::text from public.profiles p
                  join public.real_estate_listings l on l.owner_id = p.id
                  where l.id = v.listing_id),
        'kind', v.kind, 'status', v.status, 'reference_no', v.reference_no,
        'document_path', v.document_path, 'note', v.note,
        'created_at', v.created_at, 'reviewed_at', v.reviewed_at
      ) order by v.created_at)
      from (
        select * from public.real_estate_verifications
        where (p_status is null or status = p_status)
        order by created_at
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
      ) v
    ), '[]'::jsonb)
  )
  where public.tz_admin_require('realestate.view') is not null;
$$;

revoke all on function public.admin_re_verifications_list(text, integer) from public, anon;
grant execute on function public.admin_re_verifications_list(text, integer) to authenticated, service_role;

create or replace function public.admin_re_verification_review(
  p_verification_id uuid,
  p_decision text,
  p_note text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('realestate.verify');
  v_verification public.real_estate_verifications%rowtype;
  v_listing public.real_estate_listings%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  if p_decision = 'approve' and not public.tz_app_flag('real_estate.eids_enabled') then
    raise exception 'eids_not_configured' using errcode = 'P0001';
  end if;

  select * into v_verification from public.real_estate_verifications where id = p_verification_id;
  if not found then
    raise exception 'verification_not_found' using errcode = 'P0002';
  end if;
  if v_verification.status not in ('pending', 'rejected') then
    raise exception 'already_reviewed' using errcode = '22023';
  end if;

  select * into v_listing from public.real_estate_listings where id = v_verification.listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;

  update public.real_estate_verifications
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         note = v_note,
         reviewed_by = v_uid,
         reviewed_at = now(),
         expires_at = case when p_decision = 'approve'
                           then coalesce(p_expires_at, now() + interval '1 year') else null end
   where id = p_verification_id;

  perform public.tz_re_refresh_verification(v_verification.listing_id);

  perform public.tz_notify(
    v_listing.owner_id, null, 'system',
    case when p_decision = 'approve' then 'EİDS doğrulaman onaylandı' else 'EİDS doğrulaman reddedildi' end,
    left(coalesce(v_note, 'İlan doğrulama kaydı incelendi.'), 400),
    'real_estate_listing', v_listing.id::text, '/marketplace/real-estate/' || v_listing.id::text
  );

  perform public.tz_admin_audit(
    'realestate.verification_' || p_decision,
    'EİDS doğrulama kaydı incelendi',
    'real_estate_verification', p_verification_id::text,
    jsonb_build_object('listing_id', v_listing.id, 'kind', v_verification.kind,
                       'decision', p_decision, 'note', left(coalesce(v_note, ''), 400))
  );

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.admin_re_verification_review(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.admin_re_verification_review(uuid, text, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 13. İlan yayınlama / durum / medya
-- ---------------------------------------------------------------------
create or replace function public.admin_re_publish(
  p_listing_id uuid,
  p_days integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('realestate.publish');
  v_listing public.real_estate_listings%rowtype;
  v_media integer;
  v_days integer := least(greatest(coalesce(p_days, 60), 1), 180);
  v_alerts integer;
begin
  if not public.tz_app_flag('real_estate.eids_enabled') then
    raise exception 'eids_not_configured' using errcode = 'P0001';
  end if;

  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_listing.status not in ('pending_verification', 'pending_moderation', 'rejected', 'expired') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if v_listing.verification_status <> 'verified' or v_listing.eids_status <> 'verified' then
    raise exception 'eids_verification_required' using errcode = 'P0001';
  end if;

  select count(*) into v_media
  from public.real_estate_media
  where listing_id = p_listing_id and status = 'approved' and kind = 'image';
  if v_media = 0 then
    raise exception 'media_required' using errcode = '22023';
  end if;

  update public.real_estate_listings
     set status = 'published',
         published_at = now(),
         expires_at = now() + make_interval(days => v_days),
         rejection_reason = null
   where id = p_listing_id;

  insert into public.real_estate_moderation (listing_id, admin_id, action, reason)
  values (p_listing_id, v_uid, 'published', 'EİDS doğrulaması tamamlandı.');

  perform public.tz_notify(
    v_listing.owner_id, null, 'system', 'İlanın yayınlandı',
    left(v_listing.title || ' artık haritada görünüyor.', 400),
    'real_estate_listing', p_listing_id::text, '/marketplace/real-estate/' || p_listing_id::text
  );

  v_alerts := public.tz_re_dispatch_alerts(p_listing_id);

  perform public.tz_admin_audit(
    'realestate.listing_published',
    'Emlak ilanı yayınlandı',
    'real_estate_listing', p_listing_id::text,
    jsonb_build_object('days', v_days, 'alerts', v_alerts)
  );

  return jsonb_build_object('ok', true, 'status', 'published', 'alerts', v_alerts);
end;
$$;

revoke all on function public.admin_re_publish(uuid, integer) from public, anon;
grant execute on function public.admin_re_publish(uuid, integer) to authenticated, service_role;

create or replace function public.admin_re_set_status(
  p_listing_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('realestate.moderate');
  v_listing public.real_estate_listings%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_status not in ('draft', 'pending_verification', 'pending_moderation',
                      'rejected', 'expired', 'archived', 'removed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if v_reason is null and p_status in ('rejected', 'removed', 'archived') then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;

  update public.real_estate_listings
     set status = p_status,
         rejection_reason = case when p_status = 'rejected' then v_reason else rejection_reason end
   where id = p_listing_id;

  insert into public.real_estate_moderation (listing_id, admin_id, action, reason)
  values (
    p_listing_id,
    v_uid,
    case p_status
      when 'rejected' then 'rejected'
      when 'archived' then 'unpublished'
      when 'removed' then 'removed'
      when 'expired' then 'expired'
      else 'submitted'
    end,
    coalesce(v_reason, 'Durum güncellendi.')
  );

  perform public.tz_notify(
    v_listing.owner_id, null, 'system', 'İlan durumu güncellendi',
    left(v_listing.title || ' · ' || p_status || coalesce(' · ' || v_reason, ''), 400),
    'real_estate_listing', p_listing_id::text, '/marketplace/real-estate/' || p_listing_id::text
  );

  perform public.tz_admin_audit(
    'realestate.listing_status_changed',
    'Emlak ilanı durumu değiştirildi',
    'real_estate_listing', p_listing_id::text,
    jsonb_build_object('from', v_listing.status, 'to', p_status, 'reason', left(coalesce(v_reason, ''), 400))
  );

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.admin_re_set_status(uuid, text, text) from public, anon;
grant execute on function public.admin_re_set_status(uuid, text, text) to authenticated, service_role;

create or replace function public.admin_re_media_list(
  p_status text default 'pending',
  p_listing_id uuid default null,
  p_limit integer default 60
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'listing_id', m.listing_id,
        'listing_title', (select l.title from public.real_estate_listings l where l.id = m.listing_id),
        'kind', m.kind, 'storage_path', m.storage_path, 'cover', m.cover,
        'caption', m.caption, 'status', m.status, 'uploader_id', m.uploader_id,
        'uploader', (select p.username::text from public.profiles p where p.id = m.uploader_id),
        'created_at', m.created_at
      ) order by m.created_at)
      from (
        select * from public.real_estate_media
        where (p_status is null or status = p_status)
          and (p_listing_id is null or listing_id = p_listing_id)
        order by created_at
        limit least(greatest(coalesce(p_limit, 60), 1), 200)
      ) m
    ), '[]'::jsonb)
  )
  where public.tz_admin_require('realestate.view') is not null;
$$;

revoke all on function public.admin_re_media_list(text, uuid, integer) from public, anon;
grant execute on function public.admin_re_media_list(text, uuid, integer) to authenticated, service_role;

create or replace function public.admin_re_media_review(
  p_media_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('realestate.moderate');
  v_media public.real_estate_media%rowtype;
  v_listing public.real_estate_listings%rowtype;
begin
  if p_decision not in ('approve', 'reject', 'remove') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into v_media from public.real_estate_media where id = p_media_id;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  select * into v_listing from public.real_estate_listings where id = v_media.listing_id;

  update public.real_estate_media
     set status = case when p_decision = 'approve' then 'approved'
                       when p_decision = 'reject' then 'rejected' else 'removed' end,
         cover = case when p_decision <> 'approve' then false else cover end
   where id = p_media_id;

  if p_decision = 'approve'
     and v_media.kind = 'image'
     and not exists (
       select 1 from public.real_estate_media m
       where m.listing_id = v_media.listing_id and m.status = 'approved' and m.cover
     ) then
    update public.real_estate_media set cover = true where id = p_media_id;
  end if;

  perform public.tz_notify(
    v_listing.owner_id, null, 'system',
    case when p_decision = 'approve' then 'İlan medyan yayınlandı' else 'İlan medyan yayınlanmadı' end,
    left(coalesce(p_note, 'Medya incelemesi tamamlandı.'), 400),
    'real_estate_listing', v_media.listing_id::text, '/marketplace/real-estate/' || v_media.listing_id::text
  );

  perform public.tz_admin_audit(
    'realestate.media_' || p_decision,
    'Emlak medyası incelendi',
    'real_estate_media', p_media_id::text,
    jsonb_build_object('listing_id', v_media.listing_id, 'decision', p_decision,
                       'note', left(coalesce(p_note, ''), 400))
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_re_media_review(uuid, text, text) from public, anon;
grant execute on function public.admin_re_media_review(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 14. Emlak kategori yönetimi
-- ---------------------------------------------------------------------
create or replace function public.admin_re_categories()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'parent_id', c.parent_id, 'slug', c.slug, 'name', c.name,
        'listing_kind', c.listing_kind, 'icon', c.icon, 'sort_order', c.sort_order,
        'is_active', c.is_active,
        'listing_count', (select count(*) from public.real_estate_listings l where l.category_id = c.id)
      ) order by c.listing_kind, c.sort_order, c.name)
      from public.real_estate_categories c
    ), '[]'::jsonb)
  )
  where public.tz_admin_require('realestate.view') is not null;
$$;

revoke all on function public.admin_re_categories() from public, anon;
grant execute on function public.admin_re_categories() to authenticated, service_role;

create or replace function public.admin_re_category_upsert(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('realestate.manage');
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_parent uuid := nullif(p_payload ->> 'parent_id', '')::uuid;
  v_slug text := nullif(btrim(coalesce(p_payload ->> 'slug', '')), '');
  v_name text := nullif(btrim(coalesce(p_payload ->> 'name', '')), '');
  v_kind text := nullif(p_payload ->> 'listing_kind', '');
  v_category public.real_estate_categories%rowtype;
begin
  if v_slug is null or v_slug !~ '^[a-z0-9-]{2,48}$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  if v_parent is not null then
    select * into v_category from public.real_estate_categories where id = v_parent;
    if not found then
      raise exception 'invalid_parent' using errcode = '22023';
    end if;
    v_kind := v_category.listing_kind;
  end if;

  if v_kind not in ('rent', 'sale', 'transfer') then
    raise exception 'invalid_listing_kind' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.real_estate_categories (
      parent_id, listing_kind, slug, name, icon, sort_order, is_active
    ) values (
      v_parent, v_kind, v_slug, v_name,
      coalesce(nullif(p_payload ->> 'icon', ''), 'home-outline'),
      coalesce(nullif(p_payload ->> 'sort_order', '')::integer, 0),
      coalesce((p_payload ->> 'is_active')::boolean, true)
    ) returning * into v_category;
  else
    update public.real_estate_categories
       set parent_id = case when p_payload ? 'parent_id' then v_parent else parent_id end,
           listing_kind = v_kind,
           slug = v_slug,
           name = v_name,
           icon = coalesce(nullif(p_payload ->> 'icon', ''), icon),
           sort_order = coalesce(nullif(p_payload ->> 'sort_order', '')::integer, sort_order),
           is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active)
     where id = v_id
     returning * into v_category;
    if not found then
      raise exception 'category_not_found' using errcode = 'P0002';
    end if;
  end if;

  perform public.tz_admin_audit(
    'realestate.category_saved', 'Emlak kategorisi kaydedildi',
    'real_estate_category', v_category.id::text,
    jsonb_build_object('slug', v_category.slug, 'name', v_category.name,
                       'kind', v_category.listing_kind, 'is_active', v_category.is_active)
  );

  return jsonb_build_object('id', v_category.id, 'slug', v_category.slug);
end;
$$;

revoke all on function public.admin_re_category_upsert(jsonb) from public, anon;
grant execute on function public.admin_re_category_upsert(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 15. Harita veri sağlığı
-- ---------------------------------------------------------------------
create or replace function public.admin_explore_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_admin_require('map.view');
  v_start timestamptz;
  v_ms numeric;
  v_duplicates bigint;
  v_samples jsonb;
begin
  v_start := clock_timestamp();
  perform count(*) from public.places
  where status = 'published'
    and geog && st_setsrid(st_makeenvelope(39.60, 40.90, 39.85, 41.05, 4326), 4326)::geography;
  v_ms := round(extract(epoch from clock_timestamp() - v_start) * 1000, 2);

  select count(*) into v_duplicates
  from (
    select p1.id
    from public.places p1
    join public.places p2
      on p2.id > p1.id
     and p2.district_id = p1.district_id
     and p1.status in ('published', 'pending')
     and p2.status in ('published', 'pending')
     and similarity(lower(p1.name), lower(p2.name)) > 0.78
     and st_dwithin(p1.geog, p2.geog, 90)
    limit 500
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id_a', a.id, 'name_a', a.name,
    'id_b', b.id, 'name_b', b.name,
    'district', (select name from public.districts where id = a.district_id),
    'distance_m', round(st_distance(a.geog, b.geog)::numeric, 1),
    'name_score', round(similarity(lower(a.name), lower(b.name))::numeric, 2)
  ) order by similarity(lower(a.name), lower(b.name)) desc), '[]'::jsonb)
  into v_samples
  from public.places a
  join public.places b
    on b.id > a.id
   and b.district_id = a.district_id
   and a.status in ('published', 'pending')
   and b.status in ('published', 'pending')
   and similarity(lower(a.name), lower(b.name)) > 0.78
   and st_dwithin(a.geog, b.geog, 90)
  limit 20;

  return jsonb_build_object(
    'generated_at', now(),
    'places', jsonb_build_object(
      'total', (select count(*) from public.places),
      'published', (select count(*) from public.places where status = 'published'),
      'verified', (select count(*) from public.places where verification_status = 'verified'),
      'missing_address', (select count(*) from public.places where address is null or btrim(address) = ''),
      'invalid_coordinates', (select count(*) from public.places
                              where lat is null or lng is null or geog is null
                                 or lat not between 40.55 and 41.25
                                 or lng not between 38.90 and 40.70),
      'without_photo', (select count(*) from public.places where photo_count = 0),
      'without_category', (select count(*) from public.places where category_id is null),
      'without_neighborhood', (select count(*) from public.places where neighborhood_id is null),
      'duplicates', v_duplicates
    ),
    'queue', jsonb_build_object(
      'suggestions', (select count(*) from public.place_suggestions where status = 'pending'),
      'claims', (select count(*) from public.place_owner_claims where status = 'pending'),
      'media', (select count(*) from public.place_media where status = 'pending'),
      'reviews_reported', (select count(*) from public.content_reports where status = 'pending' and target_type = 'place_review'),
      'reports', (select count(*) from public.content_reports where status = 'pending'),
      're_verifications', (select count(*) from public.real_estate_verifications where status = 'pending'),
      're_media', (select count(*) from public.real_estate_media where status = 'pending'),
      're_pending', (select count(*) from public.real_estate_listings where status = 'pending_verification')
    ),
    'real_estate', jsonb_build_object(
      'total', (select count(*) from public.real_estate_listings),
      'published', (select count(*) from public.real_estate_listings where status = 'published'),
      'pending', (select count(*) from public.real_estate_listings where status = 'pending_verification'),
      'draft', (select count(*) from public.real_estate_listings where status = 'draft'),
      'rejected', (select count(*) from public.real_estate_listings where status = 'rejected'),
      'expired', (select count(*) from public.real_estate_listings where status = 'expired'),
      'missing_public_location', (select count(*) from public.real_estate_listings
                                  where status = 'published' and public_geog is null),
      'without_approved_media', (select count(*) from public.real_estate_listings l
                                 where l.status = 'published'
                                   and not exists (
                                     select 1 from public.real_estate_media m
                                     where m.listing_id = l.id and m.status = 'approved'
                                   ))
    ),
    'duplicate_samples', v_samples,
    'spatial_query', jsonb_build_object(
      'sample', 'Ortahisar görünür alan',
      'latency_ms', coalesce(v_ms, 0),
      'status', case when v_ms < 300 then 'ok' when v_ms < 1000 then 'slow' else 'critical' end
    ),
    'map_service', jsonb_build_object(
      'status', 'unknown',
      'reason', 'Harita sağlayıcı hata kayıtları bu ortamda toplanmıyor; yalnızca veritabanı mekânsal gecikmesi ölçülür.'
    ),
    'eids', jsonb_build_object(
      'enabled', public.tz_app_flag('real_estate.eids_enabled'),
      'status', case when public.tz_app_flag('real_estate.eids_enabled') then 'configured' else 'not_configured' end,
      'note', case when public.tz_app_flag('real_estate.eids_enabled')
                   then 'Doğrulama kayıtları incelenebilir.'
                   else 'Resmî EİDS entegrasyonu olmadan hiçbir ilan yayınlanamaz.' end
    )
  );
end;
$$;

revoke all on function public.admin_explore_health() from public, anon;
grant execute on function public.admin_explore_health() to authenticated, service_role;
