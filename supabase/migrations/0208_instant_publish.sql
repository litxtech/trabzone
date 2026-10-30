-- 0208 · Onaysız (moderasyonsuz) anında yayın
--
-- Yolculuk ilanları, emlak ilanları ve marketplace (emlak/vasıta dahil)
-- ilanları artık oluşturulduğu anda yayınlanır; ön moderasyon/doğrulama
-- onayı beklenmez.
--
-- Yolculuk paylaşımında kimlik doğrulaması koşulu korunur (mevcut akış).
-- Buna ek olarak sürücü başvurusu onayı ve araç onayı yayın için zorunlu
-- değildir; araç kaydı kendi kendine yayınlanır.

-- ---------------------------------------------------------------------
-- 1. Emlak ilanı yayın kapısı: EİDS şartı kaldırıldı
-- ---------------------------------------------------------------------
alter table public.real_estate_listings
  drop constraint if exists re_listings_publish_gate;

alter table public.real_estate_listings
  add constraint re_listings_publish_gate check (
    status <> 'published' or published_at is not null
  );

comment on table public.real_estate_listings is
  'Emlak ilanları. İlanlar doğrulama beklemeden anında yayınlanır; EİDS/yetki doğrulaması isteğe bağlı ve sonradan tamamlanabilir.';

-- Coğrafi bütünlük korunur; yayın için EİDS doğrulaması artık aranmaz.
create or replace function public.re_listings_geo_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_district_city uuid;
  v_hood_district bigint;
  v_category_kind text;
begin
  if not public.tz_in_trabzon_bbox(new.lat, new.lng) then
    raise exception 'outside_service_area' using errcode = '22023';
  end if;

  select city_id into v_district_city from public.districts where id = new.district_id;
  if v_district_city is null or v_district_city <> new.city_id then
    raise exception 'invalid_district' using errcode = '22023';
  end if;

  if new.neighborhood_id is not null then
    select district_id into v_hood_district
    from public.neighborhoods where id = new.neighborhood_id;
    if v_hood_district is null or v_hood_district <> new.district_id then
      raise exception 'invalid_neighborhood' using errcode = '22023';
    end if;
  end if;

  select listing_kind into v_category_kind
  from public.real_estate_categories where id = new.category_id;
  if v_category_kind is null or v_category_kind <> new.listing_kind then
    raise exception 'invalid_listing_category' using errcode = '22023';
  end if;

  new.geog := st_setsrid(st_makepoint(new.lng, new.lat), 4326)::geography;

  if new.hide_exact_location then
    -- ~110 m hassasiyet: konut kapı numarası ve kesin konum sızmaz.
    new.public_lat := round(new.lat::numeric, 3)::double precision;
    new.public_lng := round(new.lng::numeric, 3)::double precision;
  else
    new.public_lat := new.lat;
    new.public_lng := new.lng;
  end if;
  new.public_geog := st_setsrid(st_makepoint(new.public_lng, new.public_lat), 4326)::geography;

  if new.status = 'published' and new.published_at is null then
    raise exception 'publish_requires_published_at' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function public.re_listings_geo_guard() from public, anon, authenticated;

-- Sahibinin yayındaki ilanı da düzenleyebilmesi için düzenlenebilir durumlar.
create or replace function public.tz_re_owner_can_edit(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('draft', 'rejected', 'published', 'expired', 'archived');
$$;

-- ---------------------------------------------------------------------
-- 2. Emlak ilanı gönderimi = anında yayın
-- ---------------------------------------------------------------------
create or replace function public.re_submit(
  p_listing_id uuid,
  p_verification jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_listing public.real_estate_listings%rowtype;
  v_category public.real_estate_categories%rowtype;
  v_media integer;
  v_reference text := nullif(btrim(coalesce(p_verification ->> 'reference_no', '')), '');
  v_document text := nullif(btrim(coalesce(p_verification ->> 'document_path', '')), '');
  v_verification_requested boolean;
begin
  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_listing.owner_id <> v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_listing.status not in ('draft', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_category from public.real_estate_categories where id = v_listing.category_id;

  select count(*) into v_media
  from public.real_estate_media
  where listing_id = p_listing_id and status in ('pending', 'approved') and kind = 'image';
  if v_media = 0 then
    raise exception 'media_required' using errcode = '22023';
  end if;

  if v_listing.owner_type in ('agent', 'business') and v_reference is null and v_document is null then
    raise exception 'authority_document_required' using errcode = '22023';
  end if;

  if v_document is not null and split_part(v_document, '/', 1) <> v_uid::text then
    raise exception 'invalid_document_path' using errcode = '22023';
  end if;

  v_verification_requested := v_reference is not null or v_document is not null;

  if v_verification_requested then
    insert into public.real_estate_verifications (listing_id, kind, status, reference_no, document_path)
    values (
      p_listing_id,
      case when v_listing.owner_type in ('agent', 'business') then 'eids_authority' else 'eids_identity' end,
      'pending',
      v_reference,
      v_document
    );
  end if;

  -- Galeri görselleri yayında hemen görünmeli; medya moderasyonu yok.
  update public.real_estate_media
     set status = 'approved'
   where listing_id = p_listing_id and status = 'pending';

  update public.real_estate_listings
     set status = 'published',
         published_at = now(),
         expires_at = now() + interval '60 days',
         verification_status = case when v_verification_requested then 'pending' else 'unverified' end,
         eids_status = case when v_verification_requested then 'pending' else 'not_started' end,
         rejection_reason = null
   where id = p_listing_id;

  insert into public.real_estate_moderation (listing_id, action, reason, metadata)
  values (
    p_listing_id,
    'published',
    'İlan onaysız olarak anında yayınlandı.',
    jsonb_build_object(
      'owner_type', v_listing.owner_type,
      'category', v_category.slug,
      'verification_requested', v_verification_requested
    )
  );

  perform public.tz_re_dispatch_alerts(p_listing_id);

  return jsonb_build_object(
    'status', 'published',
    'eids_enabled', public.tz_app_flag('real_estate.eids_enabled'),
    'message', 'İlanın yayında. Doğrulama talebinde bulunduysan sonucu ayrıca bildirilecek.'
  );
end;
$$;

revoke all on function public.re_submit(uuid, jsonb) from public, anon;
grant execute on function public.re_submit(uuid, jsonb) to authenticated, service_role;

-- Yeni yüklenen emlak medyası doğrudan yayına hazır.
create or replace function public.re_media_add(
  p_listing_id uuid,
  p_kind text,
  p_storage_path text,
  p_cover boolean default false,
  p_caption text default null,
  p_sort_order integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_listing public.real_estate_listings%rowtype;
  v_count integer;
  v_id uuid;
begin
  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_listing.owner_id <> v_uid and not public.has_permission('realestate.manage') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_kind not in ('image', 'video') then
    raise exception 'invalid_media_type' using errcode = '22023';
  end if;
  if p_storage_path is null
     or split_part(p_storage_path, '/', 1) <> v_uid::text
     or char_length(p_storage_path) > 400 then
    raise exception 'invalid_media_path' using errcode = '22023';
  end if;

  select count(*) into v_count
  from public.real_estate_media where listing_id = p_listing_id;
  if v_count >= 20 then
    raise exception 'too_many_media' using errcode = '22023';
  end if;

  if coalesce(p_cover, false) then
    update public.real_estate_media set cover = false where listing_id = p_listing_id;
  end if;

  insert into public.real_estate_media (
    listing_id, uploader_id, kind, storage_path, cover, caption, sort_order, status
  )
  values (
    p_listing_id, v_uid, p_kind, p_storage_path, coalesce(p_cover, false),
    nullif(btrim(coalesce(p_caption, '')), ''), least(greatest(coalesce(p_sort_order, 0), 0), 99),
    'approved'
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.re_media_add(uuid, text, text, boolean, text, integer) from public, anon;
grant execute on function public.re_media_add(uuid, text, text, boolean, text, integer) to authenticated, service_role;

-- Yönetici yayınlama adımı da EİDS şartına takılmasın.
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
  select * into v_listing from public.real_estate_listings where id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_listing.status not in ('draft', 'pending_verification', 'pending_moderation', 'rejected', 'expired', 'archived') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select count(*) into v_media
  from public.real_estate_media
  where listing_id = p_listing_id and status = 'approved' and kind = 'image';
  if v_media = 0 then
    update public.real_estate_media
       set status = 'approved'
     where listing_id = p_listing_id and status = 'pending';

    select count(*) into v_media
    from public.real_estate_media
    where listing_id = p_listing_id and status = 'approved' and kind = 'image';
    if v_media = 0 then
      raise exception 'media_required' using errcode = '22023';
    end if;
  end if;

  update public.real_estate_listings
     set status = 'published',
         published_at = now(),
         expires_at = now() + make_interval(days => v_days),
         rejection_reason = null
   where id = p_listing_id;

  insert into public.real_estate_moderation (listing_id, admin_id, action, reason)
  values (p_listing_id, v_uid, 'published', 'İlan yönetici tarafından yayınlandı.');

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

-- ---------------------------------------------------------------------
-- 3. Marketplace: emlak/vasıta ilanları da anında yayınlanır
-- ---------------------------------------------------------------------
create or replace function public.market_create_listing_v2(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_title text := nullif(trim(coalesce(p_payload ->> 'title', '')), '');
  v_desc text := nullif(trim(coalesce(p_payload ->> 'description', '')), '');
  v_price bigint := coalesce((p_payload ->> 'price_cents')::bigint, 0);
  v_cond text := coalesce(nullif(trim(p_payload ->> 'condition'), ''), 'good');
  v_stock integer := coalesce((p_payload ->> 'stock')::integer, 1);
  v_cat public.marketplace_categories%rowtype;
  v_cat_id uuid := nullif(p_payload ->> 'category_id', '')::uuid;
  v_media jsonb := coalesce(p_payload -> 'media', p_payload -> 'images', '[]'::jsonb);
  v_attrs jsonb := case when jsonb_typeof(coalesce(p_payload -> 'attributes', '{}'::jsonb)) = 'object'
                        then coalesce(p_payload -> 'attributes', '{}'::jsonb) else '{}'::jsonb end;
  v_loc jsonb;
  v_id uuid;
begin
  if v_title is null or char_length(v_title) < 5 or char_length(v_title) > 140 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  if v_desc is not null and char_length(v_desc) > 8000 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;

  if v_price < 0 or v_price > 100000000000 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  if v_cond not in ('new', 'like_new', 'good', 'fair') then
    raise exception 'invalid_condition' using errcode = '22023';
  end if;

  if v_stock < 0 or v_stock > 999 then
    raise exception 'invalid_stock' using errcode = '22023';
  end if;

  if v_cat_id is null then
    raise exception 'category_required' using errcode = '22023';
  end if;

  select * into v_cat from public.marketplace_categories c
  where c.id = v_cat_id and c.is_active;

  if not found then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  if char_length(v_attrs::text) > 8000 then
    raise exception 'attributes_too_large' using errcode = '22023';
  end if;

  v_loc := public.tz_market_apply_location(
    coalesce(p_payload -> 'location', '{}'::jsonb), v_uid
  );

  perform public.safety_check_rate('listing_create', 30, interval '1 day');

  insert into public.marketplace_listings (
    seller_id, category_id, title, description, price_cents, currency, price_period,
    condition, city, city_id, district_id, neighborhood_id, lat, lng, geog,
    hide_exact_location, stock, status, verification_status, attributes,
    contact_prefs, published_at, expires_at
  )
  values (
    v_uid, v_cat_id, v_title, v_desc, v_price,
    coalesce(nullif(p_payload ->> 'currency', ''), 'TRY'),
    case when coalesce(p_payload ->> 'price_period', '') in ('total', 'month', 'hour', 'service')
         then p_payload ->> 'price_period' else 'total' end,
    v_cond,
    v_loc ->> 'district',
    nullif(v_loc ->> 'city_id', '')::uuid,
    nullif(v_loc ->> 'district_id', '')::bigint,
    nullif(v_loc ->> 'neighborhood_id', '')::bigint,
    nullif(v_loc ->> 'lat', '')::double precision,
    nullif(v_loc ->> 'lng', '')::double precision,
    case when nullif(v_loc ->> 'lat', '') is not null and nullif(v_loc ->> 'lng', '') is not null
         then st_setsrid(st_makepoint(
           (v_loc ->> 'lng')::double precision,
           (v_loc ->> 'lat')::double precision
         ), 4326)::geography
         else null end,
    coalesce((p_payload ->> 'hide_exact_location')::boolean, true),
    v_stock,
    'active',
    'not_required',
    v_attrs,
    case when jsonb_typeof(coalesce(p_payload -> 'contact_prefs', '{}'::jsonb)) = 'object'
         then coalesce(p_payload -> 'contact_prefs', '{}'::jsonb) else '{}'::jsonb end,
    now(),
    now() + interval '30 days'
  )
  returning id into v_id;

  perform public.tz_market_save_media(v_id, v_uid, v_media);

  insert into public.marketplace_listing_status_history (listing_id, actor_id, from_status, to_status, reason)
  values (v_id, v_uid, null, 'active', 'İlan onaysız olarak anında yayınlandı.');

  perform public.tz_market_dispatch_alerts(v_id);

  return jsonb_build_object(
    'id', v_id,
    'status', 'active',
    'verification_status', 'not_required'
  );
end;
$$;

revoke all on function public.market_create_listing_v2(jsonb) from public, anon;
grant execute on function public.market_create_listing_v2(jsonb) to authenticated, service_role;

create or replace function public.market_update_listing_v2(p_listing_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_row public.marketplace_listings%rowtype;
  v_cat public.marketplace_categories%rowtype;
  v_cat_id uuid;
  v_loc jsonb;
  v_media jsonb := p_payload -> 'media';
  v_price bigint;
begin
  select * into v_row from public.marketplace_listings where id = p_listing_id for update;
  if not found or (v_row.seller_id <> v_uid and not public.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_cat_id := coalesce(nullif(p_payload ->> 'category_id', '')::uuid, v_row.category_id);
  select * into v_cat from public.marketplace_categories where id = v_cat_id and is_active;
  if not found then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  if p_payload ? 'title' and char_length(trim(coalesce(p_payload ->> 'title', ''))) < 5 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  v_price := coalesce((p_payload ->> 'price_cents')::bigint, v_row.price_cents);
  if v_price < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  v_loc := public.tz_market_apply_location(
    coalesce(p_payload -> 'location', '{}'::jsonb), v_uid
  );

  update public.marketplace_listings l
     set title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else l.title end,
         description = case when p_payload ? 'description'
           then nullif(trim(coalesce(p_payload ->> 'description', '')), '') else l.description end,
         price_cents = v_price,
         price_period = case when p_payload ? 'price_period'
           and (p_payload ->> 'price_period') in ('total', 'month', 'hour', 'service')
           then p_payload ->> 'price_period' else l.price_period end,
         condition = case when p_payload ? 'condition'
           and (p_payload ->> 'condition') in ('new', 'like_new', 'good', 'fair')
           then p_payload ->> 'condition' else l.condition end,
         stock = coalesce((p_payload ->> 'stock')::integer, l.stock),
         category_id = v_cat_id,
         city = case when v_loc ->> 'district' is not null then v_loc ->> 'district' else l.city end,
         city_id = coalesce(nullif(v_loc ->> 'city_id', '')::uuid, l.city_id),
         district_id = coalesce(nullif(v_loc ->> 'district_id', '')::bigint, l.district_id),
         neighborhood_id = coalesce(nullif(v_loc ->> 'neighborhood_id', '')::bigint, l.neighborhood_id),
         lat = coalesce(nullif(v_loc ->> 'lat', '')::double precision, l.lat),
         lng = coalesce(nullif(v_loc ->> 'lng', '')::double precision, l.lng),
         geog = case
           when nullif(v_loc ->> 'lat', '') is not null and nullif(v_loc ->> 'lng', '') is not null
           then st_setsrid(st_makepoint(
             (v_loc ->> 'lng')::double precision,
             (v_loc ->> 'lat')::double precision
           ), 4326)::geography
           else l.geog end,
         attributes = case when p_payload ? 'attributes'
           and jsonb_typeof(p_payload -> 'attributes') = 'object'
           then p_payload -> 'attributes' else l.attributes end,
         contact_prefs = case when p_payload ? 'contact_prefs'
           and jsonb_typeof(p_payload -> 'contact_prefs') = 'object'
           then p_payload -> 'contact_prefs' else l.contact_prefs end,
         verification_status = case
           when l.status = 'pending' then 'not_required'
           else l.verification_status end,
         status = case
           when l.status = 'pending' then 'active'
           else l.status end,
         published_at = case
           when l.status = 'pending' then coalesce(l.published_at, now())
           else l.published_at end,
         expires_at = case
           when l.status = 'pending' then coalesce(l.expires_at, now() + interval '30 days')
           else l.expires_at end
   where l.id = p_listing_id;

  if v_media is not null and jsonb_typeof(v_media) = 'array' then
    delete from public.marketplace_listing_images where listing_id = p_listing_id;
    perform public.tz_market_save_media(p_listing_id, v_uid, v_media);
  end if;

  return public.tz_listing_json_v2(p_listing_id, v_uid);
end;
$$;

revoke all on function public.market_update_listing_v2(uuid, jsonb) from public, anon;
grant execute on function public.market_update_listing_v2(uuid, jsonb) to authenticated, service_role;

-- Satıcı doğrulama şartına takılmadan ilanını yeniden yayınlayabilsin.
create or replace function public.market_set_status_v2(
  p_listing_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_status text := nullif(trim(p_status), '');
  v_row public.marketplace_listings%rowtype;
  v_is_admin boolean := public.is_admin();
begin
  if v_status not in ('active', 'reserved', 'sold', 'expired', 'archived', 'removed', 'draft') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_row from public.marketplace_listings where id = p_listing_id for update;
  if not found then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  if v_row.seller_id <> v_uid and not v_is_admin then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_status = 'removed' and not v_is_admin then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.marketplace_listings l
     set status = v_status,
         moderation_status = case
           when v_status = 'removed' then 'removed'
           when v_status = 'active' then 'visible'
           else l.moderation_status end,
         verification_status = case
           when v_status = 'active' and l.verification_status = 'pending' then 'not_required'
           else l.verification_status end,
         published_at = case
           when v_status = 'active' then coalesce(l.published_at, now())
           else l.published_at end,
         expires_at = case
           when v_status = 'active' then now() + interval '30 days'
           else l.expires_at end,
         rejection_reason = case
           when v_status = 'removed' then nullif(trim(coalesce(p_reason, '')), '')
           else l.rejection_reason end,
         updated_status_at = now()
   where l.id = p_listing_id;

  insert into public.marketplace_listing_status_history (
    listing_id, actor_id, from_status, to_status, reason
  )
  values (p_listing_id, v_uid, v_row.status, v_status, nullif(trim(coalesce(p_reason, '')), ''));

  return jsonb_build_object('id', p_listing_id, 'status', v_status);
end;
$$;

revoke all on function public.market_set_status_v2(uuid, text, text) from public, anon;
grant execute on function public.market_set_status_v2(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Yolculuk: yayın için yalnızca kimlik doğrulaması yeterli
-- ---------------------------------------------------------------------
create or replace function public.ride_publish_offer(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_identity text;
  v_vehicle public.ride_vehicles%rowtype;
  v_scope text := coalesce(p_payload->>'scope', 'intracity');
  v_mode text := coalesce(p_payload->>'mode', 'scheduled');
  v_route_mode text := coalesce(p_payload->>'route_mode', 'fixed');
  v_booking text := coalesce(p_payload->>'booking_mode', 'manual');
  v_visibility text := coalesce(p_payload->>'visibility', 'public');
  v_seats int := coalesce((p_payload->>'seats_total')::int, 0);
  v_price int := coalesce((p_payload->>'price_per_seat_cents')::int, 0);
  v_depart timestamptz := (p_payload->>'depart_at')::timestamptz;
  v_origin_label text := trim(coalesce(p_payload->>'origin_label', ''));
  v_dest_label text := trim(coalesce(p_payload->>'dest_label', ''));
  v_origin_city text := trim(coalesce(p_payload->>'origin_city', ''));
  v_dest_city text := trim(coalesce(p_payload->>'dest_city', ''));
  v_origin_lat double precision := nullif(p_payload->>'origin_lat', '')::double precision;
  v_origin_lng double precision := nullif(p_payload->>'origin_lng', '')::double precision;
  v_dest_lat double precision := nullif(p_payload->>'dest_lat', '')::double precision;
  v_dest_lng double precision := nullif(p_payload->>'dest_lng', '')::double precision;
  v_offer public.ride_offers%rowtype;
  v_distance int;
  v_stop jsonb;
  v_seq int := 0;
  v_max_seq int := 0;
  v_duration int := nullif(p_payload->>'duration_minutes', '')::int;
begin
  if v_scope not in ('intracity','intercity') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;
  if v_mode not in ('instant','scheduled') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if v_route_mode not in ('fixed','flexible') then
    raise exception 'invalid_route_mode' using errcode = '22023';
  end if;
  if v_booking not in ('manual','auto') then
    raise exception 'invalid_booking_mode' using errcode = '22023';
  end if;
  if v_visibility not in ('public','friends','private') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  if char_length(v_origin_label) not between 2 and 120 or char_length(v_dest_label) not between 2 and 120 then
    raise exception 'invalid_route' using errcode = '22023';
  end if;
  if char_length(v_origin_city) not between 2 and 60 or char_length(v_dest_city) not between 2 and 60 then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  if v_depart is null then
    raise exception 'invalid_depart_at' using errcode = '22023';
  end if;
  if v_depart < now() - interval '15 minutes' then
    raise exception 'depart_in_past' using errcode = '22023';
  end if;
  if v_price < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if v_route_mode = 'flexible'
     and coalesce(nullif(p_payload->>'max_detour_meters', '')::int, 0) <= 0
     and coalesce(nullif(p_payload->>'max_detour_minutes', '')::int, 0) <= 0 then
    raise exception 'detour_required' using errcode = '22023';
  end if;

  perform public.ride_member_ensure(v_uid);
  select identity_status into v_identity
  from public.ride_member_profiles where user_id = v_uid;

  -- Yolculuk paylaşımında tek zorunlu kapı kimlik doğrulaması.
  if v_identity <> 'approved' then
    raise exception 'identity_required' using errcode = '42501';
  end if;

  -- Araç onayı beklenmez; yalnızca sahiplik, aktiflik ve yasak durumu denetlenir.
  select * into v_vehicle from public.ride_vehicles
  where id = nullif(p_payload->>'vehicle_id', '')::uuid;
  if not found
     or v_vehicle.owner_id <> v_uid
     or not v_vehicle.is_active
     or v_vehicle.status in ('rejected', 'suspended') then
    raise exception 'vehicle_not_approved' using errcode = '42501';
  end if;

  if v_seats < 1 or v_seats > v_vehicle.seat_capacity then
    raise exception 'invalid_seat_count' using errcode = '22023';
  end if;

  -- Zorunlu güvenlik/erişilebilirlik koşulları araçla uyumlu olmalı.
  if (p_payload->'preferences'->>'accessible_required')::boolean is true
     and coalesce((v_vehicle.accessibility->>'wheelchair')::boolean, false) is not true then
    raise exception 'vehicle_accessibility_mismatch' using errcode = '22023';
  end if;

  v_distance := round(public.ride_haversine_m(v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng))::int;

  insert into public.ride_offers (
    driver_id, vehicle_id, scope, mode, status,
    origin_label, origin_address, origin_city, origin_district, origin_lat, origin_lng,
    dest_label, dest_address, dest_city, dest_district, dest_lat, dest_lng,
    depart_at, depart_flex_minutes, duration_minutes, distance_meters,
    price_per_seat_cents, seats_total, luggage, preferences,
    route_mode, max_detour_meters, max_detour_minutes, booking_mode, visibility, notes
  ) values (
    v_uid, v_vehicle.id, v_scope, v_mode, 'published',
    v_origin_label, nullif(p_payload->>'origin_address',''), v_origin_city,
    nullif(p_payload->>'origin_district',''), v_origin_lat, v_origin_lng,
    v_dest_label, nullif(p_payload->>'dest_address',''), v_dest_city,
    nullif(p_payload->>'dest_district',''), v_dest_lat, v_dest_lng,
    v_depart, coalesce(nullif(p_payload->>'depart_flex_minutes','')::int, 15),
    v_duration, v_distance, v_price, v_seats,
    coalesce(p_payload->>'luggage', 'medium'), coalesce(p_payload->'preferences', '{}'::jsonb),
    v_route_mode, nullif(p_payload->>'max_detour_meters','')::int,
    nullif(p_payload->>'max_detour_minutes','')::int, v_booking, v_visibility,
    nullif(left(coalesce(p_payload->>'notes',''), 500), '')
  ) returning * into v_offer;

  insert into public.ride_offer_stops (offer_id, seq, kind, label, city, district, lat, lng, arrive_offset_minutes)
  values (v_offer.id, 0, 'origin', v_origin_label, v_origin_city,
          nullif(p_payload->>'origin_district',''), v_origin_lat, v_origin_lng, 0);

  for v_stop in select * from jsonb_array_elements(coalesce(p_payload->'stops', '[]'::jsonb)) loop
    v_seq := v_seq + 1;
    if v_seq > 7 then
      raise exception 'too_many_stops' using errcode = '22023';
    end if;
    insert into public.ride_offer_stops (offer_id, seq, kind, label, city, district, lat, lng, arrive_offset_minutes, is_public)
    values (
      v_offer.id, v_seq, 'waypoint',
      left(coalesce(nullif(v_stop->>'label',''), 'Ara durak'), 120),
      nullif(v_stop->>'city',''), nullif(v_stop->>'district',''),
      nullif(v_stop->>'lat','')::double precision, nullif(v_stop->>'lng','')::double precision,
      nullif(v_stop->>'arrive_offset_minutes','')::int,
      coalesce((v_stop->>'is_public')::boolean, true)
    );
  end loop;

  v_max_seq := v_seq + 1;
  insert into public.ride_offer_stops (offer_id, seq, kind, label, city, district, lat, lng, arrive_offset_minutes)
  values (v_offer.id, v_max_seq, 'destination', v_dest_label, v_dest_city,
          nullif(p_payload->>'dest_district',''), v_dest_lat, v_dest_lng, v_duration);

  perform public.ride_audit(v_uid, 'offer.publish', 'ride_offer', v_offer.id::text,
    jsonb_build_object('scope', v_scope, 'mode', v_mode, 'seats', v_seats));

  return public.ride_offer_detail(v_offer.id);
end;
$$;

grant execute on function public.ride_publish_offer(jsonb) to authenticated;

-- Araç kaydı kendi kendine yayınlanır (belge takibi garajda sürer).
create or replace function public.ride_vehicle_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_existing public.ride_vehicles%rowtype;
  v_make text := trim(coalesce(p_payload->>'make', ''));
  v_model text := trim(coalesce(p_payload->>'model', ''));
  v_year int := coalesce((p_payload->>'year')::int, 0);
  v_color text := trim(coalesce(p_payload->>'color', ''));
  v_plate text := upper(replace(coalesce(p_payload->>'plate', ''), ' ', ''));
  v_seats int := coalesce((p_payload->>'seat_capacity')::int, 0);
  v_luggage text := coalesce(p_payload->>'luggage_capacity', 'medium');
  v_fuel text := coalesce(p_payload->>'fuel_type', 'gasoline');
  v_has_ac boolean := coalesce((p_payload->>'has_ac')::boolean, true);
  v_accessibility jsonb := coalesce(p_payload->'accessibility', '{}'::jsonb);
  v_photos text[] := coalesce(
    (select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload->'photo_paths', '[]'::jsonb)) as value),
    '{}'
  );
  v_active_counts int;
begin
  if char_length(v_make) not between 1 and 40 or char_length(v_model) not between 1 and 40 then
    raise exception 'invalid_vehicle' using errcode = '22023';
  end if;
  if v_year < 1980 or v_year > extract(year from now())::int + 1 then
    raise exception 'invalid_vehicle_year' using errcode = '22023';
  end if;
  if v_plate !~ '^[0-9]{2}[A-Z]{1,3}[0-9]{2,5}$' then
    raise exception 'invalid_plate' using errcode = '22023';
  end if;
  if v_seats < 1 or v_seats > 8 then
    raise exception 'invalid_seat_capacity' using errcode = '22023';
  end if;
  if v_luggage not in ('none','small','medium','large') then
    raise exception 'invalid_luggage' using errcode = '22023';
  end if;
  if v_fuel not in ('gasoline','diesel','lpg','hybrid','electric') then
    raise exception 'invalid_fuel_type' using errcode = '22023';
  end if;

  perform public.ride_member_ensure(v_uid);

  if v_id is null then
    insert into public.ride_vehicles (
      owner_id, make, model, year, color, plate, seat_capacity, luggage_capacity,
      has_ac, fuel_type, accessibility, photo_paths, status
    ) values (
      v_uid, v_make, v_model, v_year, v_color, v_plate, v_seats, v_luggage,
      v_has_ac, v_fuel, v_accessibility, v_photos, 'approved'
    ) returning id into v_id;
  else
    select * into v_existing from public.ride_vehicles where id = v_id for update;
    if not found or v_existing.owner_id <> v_uid then
      raise exception 'vehicle_not_found' using errcode = '42501';
    end if;

    -- Aktif rezervasyon varken kapasite/erişilebilirlik daraltılamaz.
    select count(*) into v_active_counts
    from public.ride_reservations r
    join public.ride_offers o on o.id = r.offer_id
    where o.vehicle_id = v_id
      and r.status in ('requested','awaiting_approval','confirmed','started');

    if v_active_counts > 0 then
      if v_seats < v_existing.seat_capacity then
        raise exception 'vehicle_capacity_conflict' using errcode = '22023';
      end if;
      if coalesce(v_existing.accessibility, '{}'::jsonb) <> '{}'::jsonb
         and coalesce(v_accessibility, '{}'::jsonb) = '{}'::jsonb then
        raise exception 'vehicle_accessibility_conflict' using errcode = '22023';
      end if;
    end if;

    update public.ride_vehicles
       set make = v_make, model = v_model, year = v_year, color = v_color, plate = v_plate,
           seat_capacity = v_seats, luggage_capacity = v_luggage, has_ac = v_has_ac,
           fuel_type = v_fuel, accessibility = v_accessibility, photo_paths = v_photos,
           status = case when v_existing.status = 'suspended' then 'suspended' else 'approved' end,
           is_active = true
     where id = v_id;

    if v_active_counts > 0 then
      insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, route)
      select distinct r.passenger_id, 'ride', 'Araç bilgisi güncellendi',
             'Yolculuğunda kullanılacak araç bilgileri sürücü tarafından güncellendi.',
             'ride_offer', r.offer_id::text, '/ride/trips/' || r.id::text
      from public.ride_reservations r
      join public.ride_offers o on o.id = r.offer_id
      where o.vehicle_id = v_id
        and r.status in ('confirmed','started');
    end if;
  end if;

  perform public.ride_audit(v_uid, 'vehicle.save', 'ride_vehicle', v_id::text,
    jsonb_build_object('status', 'approved'));

  return public.ride_vehicle_json(v_id);
end;
$$;

grant execute on function public.ride_vehicle_save(jsonb) to authenticated;

-- Düzenli yolculuk planlarında da yalnızca kimlik doğrulaması aranır.
create or replace function public.ride_recurring_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_id uuid := nullif(p_payload->>'id','')::uuid;
  v_role text := coalesce(p_payload->>'role','passenger');
  v_scope text := coalesce(p_payload->>'scope','intracity');
  v_weekdays smallint[];
  v_vehicle uuid := nullif(p_payload->>'vehicle_id','')::uuid;
  v_identity text;
  v_vehicle_status text;
begin
  if v_role not in ('driver','passenger') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if v_scope not in ('intracity','intercity') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;

  select array_agg(value::smallint) into v_weekdays
  from jsonb_array_elements_text(coalesce(p_payload->'weekdays','[]'::jsonb)) as value;

  if v_weekdays is null or array_length(v_weekdays,1) is null or array_length(v_weekdays,1) < 1
     or not (v_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]) then
    raise exception 'invalid_weekdays' using errcode = '22023';
  end if;
  if (p_payload->>'depart_time') is null then
    raise exception 'invalid_depart_time' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_payload->>'origin_label',''))) < 2
     or char_length(trim(coalesce(p_payload->>'dest_label',''))) < 2 then
    raise exception 'invalid_route' using errcode = '22023';
  end if;

  perform public.ride_member_ensure(v_uid);

  if v_role = 'driver' then
    select identity_status into v_identity
    from public.ride_member_profiles where user_id = v_uid;
    if v_identity <> 'approved' then
      raise exception 'identity_required' using errcode = '42501';
    end if;
    if v_vehicle is null then
      raise exception 'vehicle_required' using errcode = '22023';
    end if;
    select status into v_vehicle_status from public.ride_vehicles
    where id = v_vehicle and owner_id = v_uid and is_active;
    if v_vehicle_status is null or v_vehicle_status in ('rejected', 'suspended') then
      raise exception 'vehicle_not_approved' using errcode = '42501';
    end if;
  end if;

  if v_id is null then
    insert into public.ride_recurring_schedules (
      user_id, role, scope, origin_label, origin_city, origin_lat, origin_lng,
      dest_label, dest_city, dest_lat, dest_lng, weekdays, depart_time, return_time,
      seats, price_per_seat_cents, preferences, vehicle_id, luggage, booking_mode, visibility
    ) values (
      v_uid, v_role, v_scope,
      left(trim(p_payload->>'origin_label'), 120), left(trim(coalesce(p_payload->>'origin_city','Trabzon')), 60),
      nullif(p_payload->>'origin_lat','')::double precision,
      nullif(p_payload->>'origin_lng','')::double precision,
      left(trim(p_payload->>'dest_label'), 120), left(trim(coalesce(p_payload->>'dest_city','Trabzon')), 60),
      nullif(p_payload->>'dest_lat','')::double precision,
      nullif(p_payload->>'dest_lng','')::double precision,
      v_weekdays, (p_payload->>'depart_time')::time, nullif(p_payload->>'return_time','')::time,
      coalesce((p_payload->>'seats')::int, 1), nullif(p_payload->>'price_per_seat_cents','')::int,
      coalesce(p_payload->'preferences','{}'::jsonb), v_vehicle,
      coalesce(p_payload->>'luggage','medium'),
      coalesce(p_payload->>'booking_mode','manual'),
      coalesce(p_payload->>'visibility','public')
    ) returning id into v_id;
  else
    update public.ride_recurring_schedules
       set role = v_role, scope = v_scope,
           origin_label = left(trim(p_payload->>'origin_label'),120),
           origin_city = left(trim(coalesce(p_payload->>'origin_city','Trabzon')),60),
           origin_lat = nullif(p_payload->>'origin_lat','')::double precision,
           origin_lng = nullif(p_payload->>'origin_lng','')::double precision,
           dest_label = left(trim(p_payload->>'dest_label'),120),
           dest_city = left(trim(coalesce(p_payload->>'dest_city','Trabzon')),60),
           dest_lat = nullif(p_payload->>'dest_lat','')::double precision,
           dest_lng = nullif(p_payload->>'dest_lng','')::double precision,
           weekdays = v_weekdays, depart_time = (p_payload->>'depart_time')::time,
           return_time = nullif(p_payload->>'return_time','')::time,
           seats = coalesce((p_payload->>'seats')::int, 1),
           price_per_seat_cents = nullif(p_payload->>'price_per_seat_cents','')::int,
           preferences = coalesce(p_payload->'preferences','{}'::jsonb),
           vehicle_id = v_vehicle,
           luggage = coalesce(p_payload->>'luggage','medium'),
           booking_mode = coalesce(p_payload->>'booking_mode','manual'),
           visibility = coalesce(p_payload->>'visibility','public'),
           is_active = coalesce((p_payload->>'is_active')::boolean, is_active)
     where id = v_id and user_id = v_uid;
    if not found then
      raise exception 'schedule_not_found' using errcode = 'P0002';
    end if;
  end if;

  perform public.ride_audit(v_uid, 'recurring.save', 'ride_recurring_schedule', v_id::text,
    jsonb_build_object('role', v_role, 'weekdays', v_weekdays));
  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.ride_recurring_save(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Mevcut bekleyen kayıtları yayına al
-- ---------------------------------------------------------------------
update public.real_estate_media m
   set status = 'approved'
 where m.status = 'pending'
   and exists (
     select 1 from public.real_estate_listings l
     where l.id = m.listing_id and l.status in ('pending_verification', 'pending_moderation')
   );

update public.real_estate_listings l
   set status = 'published',
       published_at = coalesce(l.published_at, now()),
       expires_at = coalesce(l.expires_at, now() + interval '60 days'),
       rejection_reason = null
 where l.status in ('pending_verification', 'pending_moderation')
   and exists (
     select 1 from public.real_estate_media m
     where m.listing_id = l.id and m.status = 'approved' and m.kind = 'image'
   );

update public.marketplace_listings l
   set status = 'active',
       verification_status = 'not_required',
       published_at = coalesce(l.published_at, now()),
       expires_at = coalesce(l.expires_at, now() + interval '30 days')
 where l.status = 'pending'
   and l.verification_status = 'pending';

update public.ride_vehicles
   set status = 'approved'
 where status = 'pending';
