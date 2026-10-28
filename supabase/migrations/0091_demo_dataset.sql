-- 0085: Gerçekçi örnek (demo) veri seti + yönetici ekleme/kaldırma
--
-- Amaç: emlak, marketplace ve yolculuk modüllerini boş bir kurulumda da
-- gerçekçi içerikle gösterebilmek; yönetici bu içeriği tek dokunuşla
-- yükleyip kaldırabilsin, örnek kullanıcılar uygulamadan silinebilsin.
--
-- Tasarım notları:
--   * Örnek içerik `is_demo = true` ile işaretlenir. Böylece gerçek
--     kullanıcı verisine dokunmadan toplu kaldırma yapılabilir.
--   * Örnek kullanıcılar auth.users kaydı olarak oluşturulur (profil,
--     rol, ride üyeliği trigger ile gelir). Şifreleri yoktur; giriş
--     yapamazlar, yalnızca içerik sahibi olarak görünürler.
--   * Örnek ilanların fotoğrafları `npm run demo:photos` ile Storage'a
--     yüklenir (demo/*.jpg). Fotoğraf yoksa ilan yine görünür.
--
-- Kaldırma davranışı:
--   * İçerik kaldırma (emlak/marketplace/yolculuk) yalnızca işaretli
--     kayıtları siler.
--   * Örnek kullanıcı silme, auth.users kaydını siler; profil ve tüm
--     bağlı içerik (ilanlar, araçlar, yolculuklar) cascade ile gider.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. İşaretleme kolonları
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_demo boolean not null default false;

alter table public.real_estate_listings
  add column if not exists is_demo boolean not null default false;

alter table public.marketplace_listings
  add column if not exists is_demo boolean not null default false;

alter table public.ride_offers
  add column if not exists is_demo boolean not null default false;

create index if not exists profiles_demo_idx
  on public.profiles (created_at desc) where is_demo;

create index if not exists re_listings_demo_idx
  on public.real_estate_listings (created_at desc) where is_demo;

create index if not exists marketplace_listings_demo_idx
  on public.marketplace_listings (created_at desc) where is_demo;

create index if not exists ride_offers_demo_idx
  on public.ride_offers (depart_at desc) where is_demo;

comment on column public.profiles.is_demo is
  'Örnek (demo) kullanıcı. Yönetici panelinden toplu kaldırılabilir.';
comment on column public.real_estate_listings.is_demo is
  'Örnek emlak ilanı; yönetici panelinden toplu kaldırılabilir.';
comment on column public.marketplace_listings.is_demo is
  'Örnek marketplace ilanı; yönetici panelinden toplu kaldırılabilir.';
comment on column public.ride_offers.is_demo is
  'Örnek yolculuk ilanı; yönetici panelinden toplu kaldırılabilir.';

-- ---------------------------------------------------------------------------
-- 2. İzinler
-- ---------------------------------------------------------------------------

insert into public.admin_permissions (code, description_tr) values
  ('demo.view',   'Örnek (demo) veri durumunu ve örnek kullanıcıları görüntüleme'),
  ('demo.manage', 'Örnek veri yükleme, kaldırma ve örnek kullanıcı silme')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'demo.view'),
  ('admin', 'demo.manage')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Yardımcılar: örnek kullanıcı ve araç
-- ---------------------------------------------------------------------------

create or replace function public.demo_ensure_user(
  p_username text,
  p_first_name text,
  p_last_name text,
  p_city text,
  p_district text,
  p_bio text,
  p_verified boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select p.id into v_id
  from public.profiles p
  where p.username = lower(p_username) and p.is_demo;

  if v_id is null then
    insert into auth.users (id, aud, role, raw_user_meta_data, created_at, updated_at)
    values (
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name),
      now() - interval '45 days',
      now() - interval '45 days'
    )
    returning id into v_id;
  end if;

  update public.profiles p
     set username = lower(p_username),
         first_name = p_first_name,
         last_name = p_last_name,
         bio = p_bio,
         city = p_city,
         district = p_district,
         is_verified = coalesce(p_verified, true),
         account_status = 'active',
         onboarding_completed = true,
         is_demo = true,
         updated_at = now()
   where p.id = v_id;

  -- Ride üyeliği trigger ile gelir; profil önceden varsa garantiye alınır.
  insert into public.ride_member_profiles (user_id)
  values (v_id)
  on conflict (user_id) do nothing;

  return v_id;
end;
$$;

revoke all on function public.demo_ensure_user(text, text, text, text, text, text, boolean)
  from public, anon, authenticated;

create or replace function public.demo_ensure_vehicle(
  p_owner_id uuid,
  p_make text,
  p_model text,
  p_year integer,
  p_color text,
  p_plate text,
  p_seats integer,
  p_luggage text,
  p_fuel text,
  p_photo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_photos text[] := case
    when p_photo_path is null or btrim(p_photo_path) = '' then '{}'::text[]
    else array[p_photo_path]
  end;
begin
  select id into v_id
  from public.ride_vehicles
  where owner_id = p_owner_id and upper(plate) = upper(p_plate);

  if v_id is null then
    insert into public.ride_vehicles (
      owner_id, make, model, year, color, plate, seat_capacity, luggage_capacity,
      has_ac, fuel_type, photo_paths, status, is_active
    )
    values (
      p_owner_id, p_make, p_model, p_year, p_color, p_plate, p_seats, p_luggage,
      true, p_fuel, v_photos, 'approved', true
    )
    returning id into v_id;
  else
    update public.ride_vehicles
       set make = p_make,
           model = p_model,
           year = p_year,
           color = p_color,
           seat_capacity = p_seats,
           luggage_capacity = p_luggage,
           fuel_type = p_fuel,
           photo_paths = v_photos,
           status = 'approved',
           is_active = true,
           updated_at = now()
     where id = v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.demo_ensure_vehicle(uuid, text, text, integer, text, text, integer, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Yönetici RPC'leri
-- ---------------------------------------------------------------------------

create or replace function public.admin_demo_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('demo.view', false);
  v_users jsonb;
begin
  select coalesce(jsonb_agg(item order by item->>'username'), '[]'::jsonb)
  into v_users
  from (
    select jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'city', p.city,
      'district', p.district,
      'created_at', p.created_at,
      'real_estate', (
        select count(*) from public.real_estate_listings l where l.owner_id = p.id
      ),
      'marketplace', (
        select count(*) from public.marketplace_listings l where l.seller_id = p.id
      ),
      'ride_offers', (
        select count(*) from public.ride_offers o where o.driver_id = p.id
      ),
      'vehicles', (
        select count(*) from public.ride_vehicles v where v.owner_id = p.id
      )
    ) as item
    from public.profiles p
    where p.is_demo
  ) q;

  return jsonb_build_object(
    'modules', jsonb_build_array(
      jsonb_build_object(
        'key', 'real_estate',
        'label', 'Emlak',
        'count', (select count(*) from public.real_estate_listings where is_demo),
        'published', (select count(*) from public.real_estate_listings where is_demo and status = 'published'),
        'hint', 'Trabzon ilçelerinde kiralık, satılık ve devren ilanlar'
      ),
      jsonb_build_object(
        'key', 'marketplace',
        'label', 'Marketplace',
        'count', (select count(*) from public.marketplace_listings where is_demo),
        'published', (select count(*) from public.marketplace_listings where is_demo and status = 'active'),
        'hint', 'Telefon, bisiklet, mobilya ve yöresel ürün ilanları'
      ),
      jsonb_build_object(
        'key', 'ride',
        'label', 'Yolculuk',
        'count', (select count(*) from public.ride_offers where is_demo),
        'published', (select count(*) from public.ride_offers where is_demo and status = 'published'),
        'hint', 'Şehir içi ve şehirler arası örnek yolculuklar'
      )
    ),
    'users', v_users,
    'totals', jsonb_build_object(
      'real_estate', (select count(*) from public.real_estate_listings where is_demo),
      'marketplace', (select count(*) from public.marketplace_listings where is_demo),
      'ride', (select count(*) from public.ride_offers where is_demo),
      'users', (select count(*) from public.profiles where is_demo)
    ),
    -- Fotoğraflar henüz Storage'a yüklenmediyse panel uyarır.
    'media_ready', (
      exists (
        select 1 from storage.objects
        where bucket_id = 'listing-images' and name like 'demo/%'
      )
      or exists (
        select 1 from storage.objects
        where bucket_id = 'real-estate-media' and name like 'demo/%'
      )
    )
  );
end;
$$;

revoke all on function public.admin_demo_overview() from public, anon;
grant execute on function public.admin_demo_overview() to authenticated;

create or replace function public.admin_demo_seed(p_modules text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('demo.manage', false);
  v_mods text[] := coalesce(p_modules, array['real_estate', 'marketplace', 'ride']);
  v_city uuid;
  v_ayse uuid;
  v_mehmet uuid;
  v_zeynep uuid;
  v_fatma uuid;
  v_emre uuid;
  v_burak uuid;
  v_corolla uuid;
  v_clio uuid;
  v_duster uuid;
  v_re int := 0;
  v_market int := 0;
  v_ride int := 0;
begin
  if v_mods is null or array_length(v_mods, 1) is null then
    raise exception 'demo_module_required' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_mods) as m
    where m not in ('real_estate', 'marketplace', 'ride')
  ) then
    raise exception 'invalid_demo_module' using errcode = '22023';
  end if;

  select id into v_city from public.cities where name = 'Trabzon' limit 1;
  if v_city is null then
    raise exception 'trabzon_city_missing' using errcode = 'P0002';
  end if;

  -- Örnek kullanıcılar (idempotent): yoksa oluştur, varsa güncelle.
  v_ayse := public.demo_ensure_user(
    'ayse.demir.demo', 'Ayşe', 'Demir', 'Trabzon', 'Ortahisar',
    'Trabzon''da 12 yıllık emlak danışmanı. Ortahisar, Yomra ve Akçaabat''ta kiralık/satılık portföyümü paylaşıyorum.', true
  );
  v_mehmet := public.demo_ensure_user(
    'mehmet.yilmaz.demo', 'Mehmet', 'Yılmaz', 'Trabzon', 'Akçaabat',
    'Akçaabat''ta esnafım. İkinci el elektronik alıp satıyorum; boş saatlerimde araç paylaşımı yapıyorum.', true
  );
  v_zeynep := public.demo_ensure_user(
    'zeynep.kaya.demo', 'Zeynep', 'Kaya', 'Trabzon', 'Yomra',
    'Ev değiştiriyoruz; kullanmadığımız eşyaları ve bebek ürünlerini satıyorum. Yomra içinde elden teslim.', false
  );
  v_fatma := public.demo_ensure_user(
    'fatma.ozturk.demo', 'Fatma', 'Öztürk', 'Trabzon', 'Ortahisar',
    'Ofis mobilyaları ve yöresel ürünler. Maçka''dan aile üretimi kuşburnu pekmezi getiriyorum.', false
  );
  v_emre := public.demo_ensure_user(
    'emre.celik.demo', 'Emre', 'Çelik', 'Trabzon', 'Ortahisar',
    'Her sabah Akçaabat–Ortahisar hattında gidip geliyorum. Boş koltukları paylaşarak yakıt masrafını bölüşüyoruz.', true
  );
  v_burak := public.demo_ensure_user(
    'burak.sahin.demo', 'Burak', 'Şahin', 'Trabzon', 'Maçka',
    'Hafta sonları Maçka ve Sümela hattında yolculuk açıyorum. Bagaj konusunda esneğim.', true
  );

  -- Ride üyeliği bilgileri: örnek sürücüler onaylı görünür.
  update public.ride_member_profiles
     set identity_status = 'approved',
         driver_status = 'approved',
         level = case
           when user_id = v_mehmet then 'gold'
           when user_id = v_burak then 'silver'
           else 'verified'
         end,
         rating_avg = case
           when user_id = v_mehmet then 4.92
           when user_id = v_emre then 4.78
           when user_id = v_burak then 4.85
           else rating_avg
         end,
         completed_trips = greatest(completed_trips, case
           when user_id = v_mehmet then 148
           when user_id = v_emre then 63
           when user_id = v_burak then 96
           else 0
         end),
         review_count = greatest(review_count, case
           when user_id = v_mehmet then 121
           when user_id = v_emre then 54
           when user_id = v_burak then 77
           else 0
         end),
         driver_bio = coalesce(driver_bio, 'Trabzon içi düzenli güzergâh; sigara içilmez, klima açık.'),
         updated_at = now()
   where user_id in (v_mehmet, v_emre, v_burak);

  v_corolla := public.demo_ensure_vehicle(
    v_mehmet, 'Toyota', 'Corolla 1.6 Vision', 2021, 'Beyaz', '61DMO01', 4, 'medium', 'gasoline', 'demo/ride-corolla.jpg'
  );
  v_clio := public.demo_ensure_vehicle(
    v_emre, 'Renault', 'Clio 1.0 TCe', 2019, 'Gri', '61DMO02', 4, 'small', 'gasoline', 'demo/ride-clio.jpg'
  );
  v_duster := public.demo_ensure_vehicle(
    v_burak, 'Dacia', 'Duster 1.5 Blue dCi', 2020, 'Lacivert', '61DMO03', 4, 'large', 'diesel'
  );

  -- Örnek kullanıcıların adına kayıtlı gerçek (demo olmayan) içerik varsa
  -- dokunulmaz; yalnızca işaretli kayıtlar yenilenir.

  if 'real_estate' = any(v_mods) then
    delete from public.real_estate_listings where is_demo;

    insert into public.real_estate_listings (
      owner_id, category_id, listing_kind, title, description, price_cents, currency,
      price_period, owner_type, status, verification_status, city_id, district_id,
      address_text, hide_exact_location, lat, lng, gross_m2, net_m2, room_count,
      living_room_count, building_age, floor_no, total_floors, heating, furnished,
      balcony, parking, elevator, deposit_cents, dues_cents, eids_status,
      published_at, expires_at, view_count, favorite_count, is_demo
    )
    select
      v_ayse,
      c.id,
      v.kind,
      v.title,
      v.description,
      v.price_cents::bigint,
      'TRY',
      v.period,
      v.owner_type,
      'published',
      'verified',
      v_city,
      v.district_id::bigint,
      v.address_text,
      true,
      v.lat::double precision,
      v.lng::double precision,
      v.gross_m2::integer,
      v.net_m2::integer,
      v.room_count::smallint,
      v.living::smallint,
      v.building_age::smallint,
      v.floor_no::smallint,
      v.total_floors::smallint,
      v.heating,
      v.furnished,
      v.balcony,
      v.parking,
      v.elevator,
      v.deposit_cents::bigint,
      v.dues_cents::bigint,
      'verified',
      now() - make_interval(days => v.age_days::int),
      now() + interval '60 days',
      v.views::integer,
      v.favorites::integer,
      true
    from (values
      (
        'rent', 'kiralik-daire',
        'Çömlekçi''de Deniz Manzaralı 3+1 Kiralık Daire',
        'Ortahisar Çömlekçi Mahallesi''nde, 5. katta, deniz manzaralı 3+1 daire. Ebeveyn banyolu, ankastre mutfak, asansör ve kapalı otopark mevcut. Sahile yürüme mesafesinde; okul, market ve hastaneye yakın. Depozito 2 kira, aidat 750 TL.',
        1850000::bigint, 'month', 'agent', 2097::bigint,
        'Çömlekçi Mah. Sahil Yolu Cd. No: 24', 41.00270, 39.71780,
        145, 128, 3, 1, 8, 5, 8, 'Kombi (doğalgaz)', false, true, true, true,
        3700000::bigint, 75000::bigint, 3, 412, 26
      ),
      (
        'rent', 'kiralik-daire',
        'Kaşüstü''nde Eşyalı 2+1 Kiralık Daire',
        'Yomra Kaşüstü''nde site içinde, eşyalı 2+1 daire. Klimalı, beyaz eşyalı, kapalı otoparklı. KTÜ ve şehir hastanesine 10 dakika. Öğrenci ve memur için uygun; 1 yıllık sözleşme tercih edilir.',
        1300000::bigint, 'month', 'owner', 1732::bigint,
        'Kaşüstü Mah. Üniversite Cd. No: 8', 40.96350, 39.83420,
        105, 92, 2, 1, 12, 3, 6, 'Merkezi sistem', true, true, true, true,
        1300000::bigint, 50000::bigint, 5, 289, 18
      ),
      (
        'sale', 'satilik-daire',
        'Söğütlü''de Geniş 3+1 Satılık Daire',
        'Akçaabat Söğütlü''de 2020 yapımı binada, 130 m² brüt 3+1 daire. Geniş salon, ebeveyn banyosu ve iki balkon. Denize 400 m, D-100''e yakın. Tapu hazır; kredi ve EİDS uygun.',
        345000000::bigint, 'total', 'owner', 1113::bigint,
        'Söğütlü Mah. Atatürk Bulvarı No: 61', 41.01950, 39.59200,
        130, 112, 3, 1, 6, 2, 5, 'Kombi (doğalgaz)', false, true, true, true,
        null, 65000::bigint, 7, 512, 41
      ),
      (
        'sale', 'satilik-mustakil-ev',
        'Hamsiköy''de Bahçeli Müstakil Ev',
        'Maçka Hamsiköy''de 1.100 m² bahçe içinde iki katlı müstakil ev. 4+1, 180 m² kullanım alanı. Soba ve kombi altyapısı, geniş teras, dereye cephe. Doğa içinde; Sümela''ya 20 dakika.',
        425000000::bigint, 'total', 'owner', 1507::bigint,
        'Hamsiköy Mah. Dere Sok. No: 12', 40.68500, 39.45300,
        180, 165, 4, 1, 25, null, 2, 'Soba', false, false, true, false,
        null, null, 12, 198, 14
      ),
      (
        'rent', 'kiralik-dukkan',
        'Meydan''a 2 Dakika Kiralık Dükkân',
        'Ortahisar Meydan''a yürüme mesafesinde, zemin kat, vitrinli 85 m² dükkân. Yüksek tavan, ayrı depo ve WC. Yaya trafiği yoğun sokakta; kafe, kuaför veya perakende için uygun.',
        3200000::bigint, 'month', 'owner', 2097::bigint,
        'Kemerkaya Mah. Uzun Sok. No: 41', 41.00450, 39.72500,
        85, 78, null, null, 30, 0, 4, 'Klima', false, false, false, false,
        6400000::bigint, 20000::bigint, 4, 156, 9
      ),
      (
        'transfer', 'devren-kafe',
        'Uzun Sokak''ta Tam Teşekküllü Devren Kafe',
        'Uzun Sokak üzerinde 95 m² kapalı + 30 m² açık alan, 40 kişilik devren kafe. Mutfak ekipmanları, vitrin, POS ve demirbaşlar dahil. Mevcut müşteri portföyü ve personel devredilebilir.',
        95000000::bigint, 'total', 'business', 2097::bigint,
        'Kemerkaya Mah. Uzun Sok. No: 118', 41.00320, 39.72310,
        125, 118, null, null, 15, 0, 3, 'Klima', true, false, false, false,
        null, null, 9, 640, 33
      ),
      (
        'sale', 'satilik-arsa',
        'Yomra''da İmarlı 1.050 m² Satılık Arsa',
        'Yomra Hürriyet Mahallesi''nde konut imarlı (TAKS 0.40 / KAKS 1.60), 1.050 m² köşe parsel. Yola cepheli; elektrik ve su altyapısı mevcut. Villa veya ikiz villa için uygun.',
        590000000::bigint, 'total', 'owner', 1732::bigint,
        'Hürriyet Mah. Sahil Yolu üzeri', 40.96000, 39.84000,
        1050, 1050, null, null, null, null, null, null, false, false, false, false,
        null, null, 15, 233, 12
      )
    ) as v(
      kind, slug, title, description, price_cents, period, owner_type, district_id,
      address_text, lat, lng, gross_m2, net_m2, room_count, living, building_age,
      floor_no, total_floors, heating, furnished, balcony, parking, elevator,
      deposit_cents, dues_cents, age_days, views, favorites
    )
    join public.real_estate_categories c on c.slug = v.slug;

    insert into public.real_estate_media (
      listing_id, uploader_id, kind, storage_path, cover, caption, sort_order, status
    )
    select
      l.id,
      l.owner_id,
      'image',
      v.path,
      true,
      v.caption,
      0,
      'approved'
    from (values
      ('Çömlekçi''de Deniz Manzaralı 3+1 Kiralık Daire', 'demo/estate-salon.jpg', 'Salon ve deniz manzarası'),
      ('Kaşüstü''nde Eşyalı 2+1 Kiralık Daire', 'demo/estate-daire.jpg', 'Bina dış görünüm'),
      ('Söğütlü''de Geniş 3+1 Satılık Daire', 'demo/estate-daire.jpg', 'Bina dış görünüm'),
      ('Hamsiköy''de Bahçeli Müstakil Ev', 'demo/estate-mustakil.jpg', 'Bahçe ve ev'),
      ('Meydan''a 2 Dakika Kiralık Dükkân', 'demo/estate-dukkan.jpg', 'Dükkân iç görünüm'),
      ('Uzun Sokak''ta Tam Teşekküllü Devren Kafe', 'demo/estate-kafe.jpg', 'Kafe iç mekân'),
      ('Yomra''da İmarlı 1.050 m² Satılık Arsa', 'demo/estate-arsa.jpg', 'Parsel görünümü')
    ) as v(title, path, caption)
    join public.real_estate_listings l
      on l.title = v.title and l.owner_id = v_ayse and l.is_demo;

    select count(*) into v_re from public.real_estate_listings where is_demo;
  end if;

  if 'marketplace' = any(v_mods) then
    delete from public.marketplace_listings where is_demo;

    insert into public.marketplace_listings (
      seller_id, category_id, title, description, price_cents, currency, condition,
      city, district, stock, status, moderation_status, view_count, favorite_count,
      created_at, updated_at, is_demo
    )
    select
      case v.seller_key
        when 'mehmet' then v_mehmet
        when 'zeynep' then v_zeynep
        else v_fatma
      end,
      c.id,
      v.title,
      v.description,
      v.price_cents::bigint,
      'TRY',
      v.condition,
      'Trabzon',
      v.district,
      1,
      'active',
      'visible',
      v.views::integer,
      v.favorites::integer,
      now() - make_interval(days => v.age_days::int),
      now(),
      true
    from (values
      (
        'mehmet', 'telefon-tablet',
        'iPhone 13 128 GB — Kutulu, Faturalı',
        '2022''de alındı, batarya sağlığı %89. Ekran ve gövde hatasız; kutu, kablo ve fatura mevcut. Yüz yüze teslim, denemek için vakit var. Takas düşünülmüyor.',
        2450000::bigint, 'like_new', 'Ortahisar', 1240, 86, 2
      ),
      (
        'mehmet', 'spor-outdoor',
        'Trek Marlin 6 Dağ Bisikleti 29"',
        '2023 model, 29 jant, hidrolik disk fren, 18 vites. Sadece hafta sonları kullanıldı; lastikler yeni. Kask ve kilit hediye.',
        1275000::bigint, 'good', 'Ortahisar', 780, 44, 4
      ),
      (
        'mehmet', 'elektronik-tv-ses-oyun',
        'PlayStation 5 + 2 DualSense Kol + 3 Oyun',
        'Disk sürümlü PS5; 2 kol ve 3 oyun (FIFA 24, Spider-Man 2, GT7) dahil. Sigara içilmeyen evde kullanıldı, çizik yok.',
        1650000::bigint, 'like_new', 'Akçaabat', 1560, 120, 1
      ),
      (
        'zeynep', 'mobilya-dekorasyon',
        '3+2+1 Gri Koltuk Takımı',
        'İki yıl önce alındı; yataklı 3''lü koltuk dahil. Kumaşta leke veya yıpranma yok. Taşınma nedeniyle satılıyor, nakliye alıcıya ait.',
        890000::bigint, 'good', 'Yomra', 640, 39, 6
      ),
      (
        'zeynep', 'beyaz-esya',
        'Arçelik 9 kg Çamaşır Makinesi',
        '2021 model, 9 kg, 1200 devir. Garantisi bitti, sorunsuz çalışıyor. Elden teslim; taşıma için yardımcı olunur.',
        925000::bigint, 'like_new', 'Yomra', 430, 21, 8
      ),
      (
        'zeynep', 'anne-bebek',
        'Cybex Bebek Arabası + Ana Kucağı',
        '2022 model travel sistem; katlanabilir, kabin boyutu. Ana kucağı ve yağmurluk dahil. Bebeğimiz büyüdüğü için satıyoruz.',
        320000::bigint, 'good', 'Ortahisar', 350, 28, 3
      ),
      (
        'fatma', 'ofis-kirtasiye',
        '180x80 Ahşap Çalışma Masası',
        'Masif ahşap, 180x80 cm, çekmeceli. Ofis kapanışı nedeniyle satılıyor. İki adet mevcut; birlikte alımda indirim yapılır.',
        240000::bigint, 'good', 'Ortahisar', 210, 7, 10
      ),
      (
        'fatma', 'yoresel-urunler',
        'Ev Yapımı Kuşburnu Pekmezi 5 kg',
        'Maçka''dan toplanan kuşburnundan bakır kazanda, katkısız üretildi. 5 kg cam kavanoz. Kargo alıcıya ait; Trabzon içinde elden teslim mümkün.',
        45000::bigint, 'new', 'Maçka', 560, 34, 5
      )
    ) as v(
      seller_key, slug, title, description, price_cents, condition, district,
      views, favorites, age_days
    )
    join public.marketplace_categories c on c.slug = v.slug;

    insert into public.marketplace_listing_images (listing_id, storage_path, sort_order)
    select l.id, v.path, 0
    from (values
      ('iPhone 13 128 GB — Kutulu, Faturalı', 'demo/market-telefon.jpg'),
      ('Trek Marlin 6 Dağ Bisikleti 29"', 'demo/market-bisiklet.jpg'),
      ('PlayStation 5 + 2 DualSense Kol + 3 Oyun', 'demo/market-konsol.jpg'),
      ('3+2+1 Gri Koltuk Takımı', 'demo/market-koltuk.jpg'),
      ('Arçelik 9 kg Çamaşır Makinesi', 'demo/market-camasir.jpg'),
      ('Cybex Bebek Arabası + Ana Kucağı', 'demo/market-bebek.jpg'),
      ('180x80 Ahşap Çalışma Masası', 'demo/market-masa.jpg'),
      ('Ev Yapımı Kuşburnu Pekmezi 5 kg', 'demo/market-pekmez.jpg')
    ) as v(title, path)
    join public.marketplace_listings l on l.title = v.title and l.is_demo;

    select count(*) into v_market from public.marketplace_listings where is_demo;
  end if;

  if 'ride' = any(v_mods) then
    delete from public.ride_offers where is_demo;

    insert into public.ride_offers (
      driver_id, vehicle_id, scope, mode, status, origin_label, origin_city,
      origin_district, origin_lat, origin_lng, dest_label, dest_city, dest_district,
      dest_lat, dest_lng, depart_at, depart_flex_minutes, duration_minutes,
      distance_meters, price_per_seat_cents, currency, seats_total, luggage,
      preferences, route_mode, booking_mode, visibility, notes, published_at,
      created_at, updated_at, is_demo
    )
    select
      case v.driver_key
        when 'mehmet' then v_mehmet
        when 'emre' then v_emre
        else v_burak
      end,
      case v.vehicle_key
        when 'corolla' then v_corolla
        when 'clio' then v_clio
        else v_duster
      end,
      v.scope,
      'scheduled',
      'published',
      v.origin_label,
      v.origin_city,
      v.origin_district,
      v.origin_lat::double precision,
      v.origin_lng::double precision,
      v.dest_label,
      v.dest_city,
      v.dest_district,
      v.dest_lat::double precision,
      v.dest_lng::double precision,
      v.depart_at,
      15,
      v.duration::integer,
      v.distance::integer,
      v.price_cents::integer,
      'TRY',
      v.seats::integer,
      v.luggage,
      '{"ac": true, "smoking": false, "music": true, "pets": false, "women_only": false, "accessible_required": false}'::jsonb,
      'fixed',
      'manual',
      'public',
      v.notes,
      now(),
      now(),
      now(),
      true
    from (values
      (
        'mehmet', 'corolla', 'intracity',
        'Ortahisar Meydan', 'Trabzon', 'Ortahisar', 41.00450, 39.72600,
        'Yomra Kaşüstü', 'Trabzon', 'Yomra', 40.96350, 39.83420,
        ((date_trunc('day', now() at time zone 'Europe/Istanbul') + interval '1 day' + interval '8 hours 15 minutes') at time zone 'Europe/Istanbul'),
        25, 13000, 3500, 3, 'medium',
        'Sabah 08:15''te Meydan''dan hareket. Bagaj için önceden yazabilirsiniz.'
      ),
      (
        'emre', 'clio', 'intracity',
        'Akçaabat Merkez', 'Trabzon', 'Akçaabat', 41.02100, 39.57500,
        'Ortahisar Meydan', 'Trabzon', 'Ortahisar', 41.00450, 39.72600,
        ((date_trunc('day', now() at time zone 'Europe/Istanbul') + interval '1 day' + interval '7 hours 45 minutes') at time zone 'Europe/Istanbul'),
        30, 17000, 3000, 4, 'small',
        'Her sabah aynı saatte gidiyorum; düzenli yolcu tercih edilir.'
      ),
      (
        'burak', 'duster', 'intracity',
        'Ortahisar Çömlekçi', 'Trabzon', 'Ortahisar', 41.00270, 39.71780,
        'Akçaabat Söğütlü', 'Trabzon', 'Akçaabat', 41.01950, 39.59200,
        ((date_trunc('day', now() at time zone 'Europe/Istanbul') + interval '1 day' + interval '18 hours 30 minutes') at time zone 'Europe/Istanbul'),
        30, 18000, 3000, 3, 'large',
        'Akşam dönüşü; iki büyük valiz alabilirim.'
      ),
      (
        'emre', 'clio', 'intercity',
        'Trabzon Otogar', 'Trabzon', 'Ortahisar', 40.99500, 39.75000,
        'Rize Merkez', 'Rize', 'Merkez', 41.02400, 40.52300,
        ((date_trunc('day', now() at time zone 'Europe/Istanbul') + interval '2 days' + interval '9 hours') at time zone 'Europe/Istanbul'),
        75, 75000, 15000, 3, 'medium',
        'Rize''ye iş görüşmesine gidiyorum; esnek dönüş saatinde anlaşabiliriz.'
      ),
      (
        'burak', 'duster', 'intracity',
        'Trabzon Meydan', 'Trabzon', 'Ortahisar', 41.00450, 39.72600,
        'Maçka Hamsiköy', 'Trabzon', 'Maçka', 40.68500, 39.45300,
        ((date_trunc('day', now() at time zone 'Europe/Istanbul') + interval '3 days' + interval '9 hours 30 minutes') at time zone 'Europe/Istanbul'),
        45, 32000, 12000, 4, 'large',
        'Sümela ve Hamsiköy hattı. Doğa yürüyüşüne gidenler için uygun.'
      ),
      (
        'mehmet', 'corolla', 'intracity',
        'Yomra Kaşüstü', 'Trabzon', 'Yomra', 40.96350, 39.83420,
        'Trabzon Meydan', 'Trabzon', 'Ortahisar', 41.00450, 39.72600,
        ((date_trunc('day', now() at time zone 'Europe/Istanbul') + interval '1 day' + interval '8 hours') at time zone 'Europe/Istanbul'),
        25, 13000, 2500, 2, 'medium',
        'Sabah 08:00 hareket; iki koltuk ayrıldı.'
      )
    ) as v(
      driver_key, vehicle_key, scope, origin_label, origin_city, origin_district,
      origin_lat, origin_lng, dest_label, dest_city, dest_district, dest_lat, dest_lng,
      depart_at, duration, distance, price_cents, seats, luggage, notes
    );

    insert into public.ride_offer_stops (
      offer_id, seq, kind, label, city, district, lat, lng, arrive_offset_minutes, is_public
    )
    select o.id, 0, 'origin', o.origin_label, o.origin_city, o.origin_district,
           o.origin_lat, o.origin_lng, 0, true
    from public.ride_offers o
    where o.is_demo
    union all
    select o.id, 1, 'destination', o.dest_label, o.dest_city, o.dest_district,
           o.dest_lat, o.dest_lng, o.duration_minutes, true
    from public.ride_offers o
    where o.is_demo;

    select count(*) into v_ride from public.ride_offers where is_demo;
  end if;

  select count(*) into v_re from public.real_estate_listings where is_demo;
  select count(*) into v_market from public.marketplace_listings where is_demo;
  select count(*) into v_ride from public.ride_offers where is_demo;

  perform public.tz_admin_audit(
    'demo.seed',
    'Örnek veri yüklendi',
    'demo_dataset',
    array_to_string(v_mods, ','),
    jsonb_build_object('real_estate', v_re, 'marketplace', v_market, 'ride', v_ride)
  );

  return jsonb_build_object(
    'ok', true,
    'modules', v_mods,
    'real_estate', v_re,
    'marketplace', v_market,
    'ride', v_ride,
    'users', (
      select count(*) from public.profiles where is_demo
    )
  );
end;
$$;

revoke all on function public.admin_demo_seed(text[]) from public, anon;
grant execute on function public.admin_demo_seed(text[]) to authenticated;

create or replace function public.admin_demo_clear(p_modules text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('demo.manage', false);
  v_mods text[] := coalesce(p_modules, array['real_estate', 'marketplace', 'ride']);
  v_re int := 0;
  v_market int := 0;
  v_ride int := 0;
begin
  if v_mods is null or array_length(v_mods, 1) is null then
    raise exception 'demo_module_required' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_mods) as m
    where m not in ('real_estate', 'marketplace', 'ride')
  ) then
    raise exception 'invalid_demo_module' using errcode = '22023';
  end if;

  if 'real_estate' = any(v_mods) then
    delete from public.real_estate_listings where is_demo;
    get diagnostics v_re = row_count;
  end if;
  if 'marketplace' = any(v_mods) then
    delete from public.marketplace_listings where is_demo;
    get diagnostics v_market = row_count;
  end if;
  if 'ride' = any(v_mods) then
    delete from public.ride_offers where is_demo;
    get diagnostics v_ride = row_count;
  end if;

  perform public.tz_admin_audit(
    'demo.clear',
    'Örnek veri kaldırıldı',
    'demo_dataset',
    array_to_string(v_mods, ','),
    jsonb_build_object('real_estate', v_re, 'marketplace', v_market, 'ride', v_ride)
  );

  return jsonb_build_object(
    'ok', true,
    'modules', v_mods,
    'real_estate', v_re,
    'marketplace', v_market,
    'ride', v_ride
  );
end;
$$;

revoke all on function public.admin_demo_clear(text[]) from public, anon;
grant execute on function public.admin_demo_clear(text[]) to authenticated;

create or replace function public.admin_demo_user_remove(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('demo.manage', false);
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if not v_profile.is_demo then
    raise exception 'not_demo_user' using errcode = '22023';
  end if;

  -- Profil ve tüm bağlı içerik auth.users üzerinden cascade ile silinir.
  delete from auth.users where id = p_user_id;

  perform public.tz_admin_audit(
    'demo.user_removed',
    'Örnek kullanıcı kaldırıldı',
    'profile',
    p_user_id::text,
    jsonb_build_object('username', v_profile.username)
  );

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'username', v_profile.username);
end;
$$;

revoke all on function public.admin_demo_user_remove(uuid) from public, anon;
grant execute on function public.admin_demo_user_remove(uuid) to authenticated;

create or replace function public.admin_demo_users_clear()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('demo.manage', false);
  v_count int := 0;
  v_usernames text;
begin
  select string_agg(username, ', ' order by username)
  into v_usernames
  from public.profiles
  where is_demo;

  delete from auth.users where id in (select id from public.profiles where is_demo);
  get diagnostics v_count = row_count;

  perform public.tz_admin_audit(
    'demo.users_cleared',
    'Tüm örnek kullanıcılar kaldırıldı',
    'demo_dataset',
    'users',
    jsonb_build_object('count', v_count, 'usernames', left(coalesce(v_usernames, ''), 400))
  );

  return jsonb_build_object('ok', true, 'removed', v_count);
end;
$$;

revoke all on function public.admin_demo_users_clear() from public, anon;
grant execute on function public.admin_demo_users_clear() to authenticated;

comment on function public.admin_demo_seed(text[]) is
  'Örnek emlak/marketplace/yolculuk içeriğini yükler. Var olan örnek kayıtlar yenilenir.';
comment on function public.admin_demo_clear(text[]) is
  'Yalnızca is_demo işaretli içeriği kaldırır; gerçek kullanıcı verisine dokunmaz.';
