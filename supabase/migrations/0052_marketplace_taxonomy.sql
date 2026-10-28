-- =====================================================================
-- 0050 — TRABZONE MARKETPLACE: 28 ana kategori, alt kategori ağacı,
-- kategori arama ve kategoriye özel ilan formu tanımları.
--
-- Tasarım ilkeleri:
--   * Kategoriler uygulama koduna gömülmez; bu migration yalnızca ilk
--     tohum verisidir. Admin paneli sonrasında kayıtları düzenleyebilir.
--   * Her ana kategoriye ve alt kategori grubuna "Diğer" seçeneği eklenir.
--   * Slug'lar deterministik üretilir; tekrar çalıştırma yeni kopya açmaz.
--   * Mevcut ilanların kategori kimlikleri korunur: eski kök slug'ları
--     yeni kök slug'larına taşınır, silme yapılmaz.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. Şema genişletmeleri
-- ---------------------------------------------------------------------
alter table public.marketplace_categories
  drop constraint if exists marketplace_categories_slug_check;
alter table public.marketplace_categories
  add constraint marketplace_categories_slug_check
  check (slug ~ '^[a-z0-9-]{2,80}$');

alter table public.marketplace_categories
  add column if not exists description text,
  add column if not exists kind text not null default 'product',
  add column if not exists tone text not null default 'primary',
  add column if not exists aliases text[] not null default '{}'::text[],
  add column if not exists form_schema jsonb not null default '{}'::jsonb,
  add column if not exists is_featured boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.marketplace_categories
  drop constraint if exists marketplace_categories_kind_check;
alter table public.marketplace_categories
  add constraint marketplace_categories_kind_check
  check (kind in ('product', 'real_estate', 'vehicle', 'place', 'service', 'job', 'education', 'event'));

alter table public.marketplace_categories
  drop constraint if exists marketplace_categories_tone_check;
alter table public.marketplace_categories
  add constraint marketplace_categories_tone_check
  check (tone in ('primary', 'accent', 'success', 'warning', 'danger', 'info'));

comment on column public.marketplace_categories.kind is
  'İlan türü. Ana sayfa sekmeleri ve ilan formu bu değere göre şekillenir.';
comment on column public.marketplace_categories.form_schema is
  'Kategoriye özel ilan alanları. Alt kategoriler en yakın üst tanımı devralır.';
comment on column public.marketplace_categories.aliases is
  'Kategori aramasında kullanılan eş anlamlılar (örn. oto, araba).';

create index if not exists marketplace_categories_kind_idx
  on public.marketplace_categories (kind, is_active, sort_order);

-- ---------------------------------------------------------------------
-- 2. Mevcut kök kategorileri yeni taksonomiye taşı (kimlik korunur)
-- ---------------------------------------------------------------------
update public.marketplace_categories
   set slug = 'elektronik-tv-ses-oyun',
       name = 'Elektronik, TV, Ses ve Oyun',
       icon = 'game-controller-outline',
       sort_order = 6
 where parent_id is null and slug = 'elektronik';

update public.marketplace_categories
   set slug = 'giyim-ayakkabi',
       name = 'Giyim ve Ayakkabı',
       icon = 'shirt-outline',
       sort_order = 9
 where parent_id is null and slug = 'moda';

update public.marketplace_categories
   set slug = 'mobilya-dekorasyon',
       name = 'Mobilya ve Ev Dekorasyonu',
       icon = 'bed-outline',
       sort_order = 7
 where parent_id is null and slug = 'ev-yasam';

update public.marketplace_categories
   set slug = 'araclar',
       name = 'Araçlar',
       icon = 'car-sport-outline',
       sort_order = 2
 where parent_id is null and slug = 'otomotiv';

update public.marketplace_categories
   set slug = 'spor-outdoor',
       name = 'Spor ve Outdoor',
       icon = 'barbell-outline',
       sort_order = 12
 where parent_id is null and slug = 'spor';

update public.marketplace_categories
   set slug = 'kitap-muzik-hobi',
       name = 'Kitap, Müzik, Hobi ve Koleksiyon',
       icon = 'book-outline',
       sort_order = 13
 where parent_id is null and slug = 'koleksiyon';

update public.marketplace_categories
   set slug = 'diger-ilanlar',
       name = 'Diğer İlanlar',
       icon = 'grid-outline',
       sort_order = 28
 where parent_id is null and slug = 'diger';

-- ---------------------------------------------------------------------
-- 3. Yardımcı fonksiyonlar
-- ---------------------------------------------------------------------
create or replace function public.tz_market_slug(p_value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      lower(translate(
        coalesce(p_value, ''),
        'çğıöşüÇĞİÖŞÜâîûÂÎÛ',
        'cgiosuCGIOSUaiuAIU'
      )),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;

revoke all on function public.tz_market_slug(text) from public, anon, authenticated;

create or replace function public.tz_market_upsert_category(
  p_parent_id uuid,
  p_slug_base text,
  p_name text,
  p_icon text,
  p_sort integer,
  p_kind text,
  p_tone text,
  p_featured boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := left(coalesce(nullif(public.tz_market_slug(p_slug_base), ''), 'kategori'), 70);
  v_slug text := v_base;
  v_try integer := 2;
  v_id uuid;
begin
  while exists (
    select 1 from public.marketplace_categories c
    where c.slug = v_slug
      and c.parent_id is distinct from p_parent_id
  ) loop
    v_slug := left(v_base, 66) || '-' || v_try;
    v_try := v_try + 1;
    if v_try > 50 then
      v_slug := left(v_base, 58) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      exit;
    end if;
  end loop;

  insert into public.marketplace_categories (
    parent_id, slug, name, icon, sort_order, kind, tone, is_featured, is_active
  )
  values (
    p_parent_id, v_slug, left(p_name, 80), p_icon, p_sort, p_kind, p_tone, p_featured, true
  )
  on conflict (slug) do update
    set parent_id = excluded.parent_id,
        name = excluded.name,
        icon = excluded.icon,
        sort_order = excluded.sort_order,
        kind = excluded.kind,
        tone = excluded.tone,
        is_featured = excluded.is_featured,
        is_active = true,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.tz_market_upsert_category(uuid, text, text, text, integer, text, text, boolean)
  from public, anon, authenticated;

create or replace function public.tz_market_seed_tree(p_tree jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_root jsonb;
  v_group jsonb;
  v_name text;
  v_root_id uuid;
  v_group_id uuid;
  v_root_slug text;
  v_group_slug text;
  v_sort integer;
  v_group_sort integer;
  v_icon text;
  v_kind text;
  v_tone text;
  v_featured boolean;
  v_total integer := 0;
begin
  for v_root in select * from jsonb_array_elements(p_tree)
  loop
    v_root_slug := public.tz_market_slug(v_root ->> 'slug');
    v_icon := coalesce(v_root ->> 'icon', 'grid-outline');
    v_kind := coalesce(v_root ->> 'kind', 'product');
    v_tone := coalesce(v_root ->> 'tone', 'primary');
    v_featured := coalesce((v_root ->> 'featured')::boolean, false);

    insert into public.marketplace_categories (
      parent_id, slug, name, icon, sort_order, kind, tone, aliases, form_schema,
      description, is_featured, is_active
    )
    values (
      null,
      v_root_slug,
      left(v_root ->> 'name', 80),
      v_icon,
      coalesce((v_root ->> 'sort')::integer, 100),
      v_kind,
      v_tone,
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(coalesce(v_root -> 'aliases', '[]'::jsonb)) value),
        '{}'::text[]
      ),
      coalesce(v_root -> 'form', '{}'::jsonb),
      v_root ->> 'description',
      v_featured,
      true
    )
    on conflict (slug) do update
      set parent_id = null,
          name = excluded.name,
          icon = excluded.icon,
          sort_order = excluded.sort_order,
          kind = excluded.kind,
          tone = excluded.tone,
          aliases = excluded.aliases,
          form_schema = excluded.form_schema,
          description = excluded.description,
          is_featured = excluded.is_featured,
          is_active = true,
          updated_at = now()
    returning id into v_root_id;

    v_total := v_total + 1;
    v_group_sort := 0;

    if v_root ? 'groups' then
      for v_group in select * from jsonb_array_elements(v_root -> 'groups')
      loop
        v_group_slug := public.tz_market_slug(v_group ->> 'slug');
        v_group_id := public.tz_market_upsert_category(
          v_root_id,
          v_root_slug || '-' || v_group_slug,
          v_group ->> 'name',
          coalesce(v_group ->> 'icon', v_icon),
          v_group_sort * 10,
          v_kind,
          v_tone,
          false
        );
        v_total := v_total + 1;
        v_sort := 0;

        for v_name in
          select value from jsonb_array_elements_text(coalesce(v_group -> 'items', '[]'::jsonb)) value
        loop
          perform public.tz_market_upsert_category(
            v_group_id,
            v_root_slug || '-' || v_group_slug || '-' || v_name,
            v_name,
            coalesce(v_group ->> 'icon', v_icon),
            v_sort,
            v_kind,
            v_tone,
            false
          );
          v_sort := v_sort + 1;
          v_total := v_total + 1;
        end loop;

        -- Her alt kategori grubunun kendi "Diğer" seçeneği vardır.
        perform public.tz_market_upsert_category(
          v_group_id,
          v_root_slug || '-' || v_group_slug || '-diger',
          'Diğer',
          coalesce(v_group ->> 'icon', v_icon),
          v_sort,
          v_kind,
          v_tone,
          false
        );
        v_total := v_total + 1;
        v_group_sort := v_group_sort + 1;
      end loop;
    end if;

    if v_root ? 'items' then
      v_sort := 0;
      for v_name in
        select value from jsonb_array_elements_text(v_root -> 'items') value
      loop
        perform public.tz_market_upsert_category(
          v_root_id,
          v_root_slug || '-' || v_name,
          v_name,
          v_icon,
          v_sort,
          v_kind,
          v_tone,
          false
        );
        v_sort := v_sort + 1;
        v_total := v_total + 1;
      end loop;
    end if;

    -- Her ana kategorinin "Diğer" seçeneği vardır. Alt gruplarda da ayrıca
    -- eklendiği için kök seviyedeki kayıt kullanıcıyı asla çıkmaza sokmaz.
    perform public.tz_market_upsert_category(
      v_root_id,
      v_root_slug || '-diger',
      'Diğer',
      v_icon,
      9999,
      v_kind,
      v_tone,
      false
    );
    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.tz_market_seed_tree(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Tohum verisi — 28 ana kategori
-- ---------------------------------------------------------------------
select public.tz_market_seed_tree($json$
[
  {
    "slug": "emlak", "name": "Emlak", "icon": "home-outline", "kind": "real_estate",
    "tone": "primary", "sort": 1, "featured": true,
    "aliases": ["gayrimenkul", "konut", "daire", "ev", "arsa", "işyeri"],
    "description": "Trabzon'da kiralık ve satılık konut, işyeri, arsa ve devren işletme.",
    "form": {"price_mode": "required", "fields": [
      {"key": "net_m2", "label": "Net metrekare", "type": "number"},
      {"key": "gross_m2", "label": "Brüt metrekare", "type": "number"},
      {"key": "room_count", "label": "Oda sayısı", "type": "number"},
      {"key": "building_age", "label": "Bina yaşı", "type": "number"},
      {"key": "floor_no", "label": "Kat", "type": "number"},
      {"key": "heating", "label": "Isıtma", "type": "select", "options": ["Doğalgaz", "Kombi", "Soba", "Klima", "Merkezi", "Yok"]},
      {"key": "furnished", "label": "Eşyalı", "type": "boolean"},
      {"key": "balcony", "label": "Balkon", "type": "boolean"},
      {"key": "parking", "label": "Otopark", "type": "boolean"},
      {"key": "elevator", "label": "Asansör", "type": "boolean"}
    ]},
    "groups": [
      {"slug": "satilik-konut", "name": "Satılık Konut", "items": [
        "Satılık daire", "Satılık müstakil ev", "Satılık villa", "Satılık rezidans",
        "Satılık yazlık", "Satılık köy evi", "Satılık yayla evi", "Satılık prefabrik ev",
        "Satılık dubleks", "Satılık çatı katı"
      ]},
      {"slug": "kiralik-konut", "name": "Kiralık Konut", "items": [
        "Kiralık daire", "Kiralık müstakil ev", "Kiralık villa", "Kiralık rezidans",
        "Kiralık yazlık", "Kiralık köy evi", "Kiralık yayla evi", "Kiralık eşyalı daire",
        "Kiralık öğrenci evi", "Kiralık oda"
      ]},
      {"slug": "satilik-isyeri", "name": "Satılık İşyeri", "items": [
        "Dükkân", "Mağaza", "Ofis", "Büro", "Depo", "Atölye", "Fabrika", "İmalathane",
        "Plaza katı", "Komple ticari bina"
      ]},
      {"slug": "kiralik-isyeri", "name": "Kiralık İşyeri", "items": [
        "Dükkân", "Mağaza", "Ofis", "Büro", "Depo", "Atölye", "Restoran yeri",
        "Kafe yeri", "Ticari bina", "Sanayi işyeri"
      ]},
      {"slug": "devren-isletme", "name": "Devren İşletme", "items": [
        "Restoran", "Kafe", "Market", "Bakkal", "Fırın", "Pastane", "Kuaför", "Berber",
        "Otel", "Pansiyon", "Apart", "Oto yıkama", "Diğer devren işletmeler"
      ]},
      {"slug": "arsa-arazi", "name": "Arsa ve Arazi", "items": [
        "Konut imarlı arsa", "Ticari imarlı arsa", "Sanayi imarlı arsa", "Tarla", "Bahçe",
        "Fındıklık", "Çay bahçesi", "Meyve bahçesi", "Zeytinlik", "İmarsız arazi"
      ]},
      {"slug": "turistik-gayrimenkul", "name": "Turistik Gayrimenkul", "items": [
        "Satılık otel", "Kiralık otel", "Satılık pansiyon", "Kiralık pansiyon",
        "Satılık bungalov tesisi", "Kiralık bungalov tesisi", "Satılık turistik tesis",
        "Kiralık turistik tesis"
      ]},
      {"slug": "diger-emlak", "name": "Diğer Emlak", "items": [
        "Komple bina", "Garaj", "Otopark alanı", "Devre mülk", "Konut projeleri"
      ]}
    ]
  },
  {
    "slug": "araclar", "name": "Araçlar", "icon": "car-sport-outline", "kind": "vehicle",
    "tone": "primary", "sort": 2, "featured": true,
    "aliases": ["oto", "araba", "otomobil", "motosiklet", "ticari araç"],
    "description": "Otomobil, SUV, motosiklet, ticari araç ve deniz araçları.",
    "form": {"price_mode": "required", "fields": [
      {"key": "brand", "label": "Marka", "type": "text", "required": true},
      {"key": "model", "label": "Model", "type": "text"},
      {"key": "year", "label": "Model yılı", "type": "number"},
      {"key": "km", "label": "Kilometre", "type": "number"},
      {"key": "fuel", "label": "Yakıt", "type": "select", "options": ["Benzin", "Dizel", "LPG", "Elektrik", "Hibrit"]},
      {"key": "transmission", "label": "Vites", "type": "select", "options": ["Manuel", "Otomatik", "Yarı otomatik"]},
      {"key": "body", "label": "Kasa tipi", "type": "select", "options": ["Sedan", "Hatchback", "SUV", "Station wagon", "Coupe", "Cabrio", "Pickup", "Diğer"]}
    ]},
    "groups": [
      {"slug": "otomobil", "name": "Otomobil", "items": [
        "Sedan", "Hatchback", "Station wagon", "Coupe", "Cabrio", "Elektrikli otomobil",
        "Hibrit otomobil"
      ]},
      {"slug": "suv-arazi", "name": "SUV ve Arazi", "items": ["SUV", "Pickup", "4x4", "Arazi aracı"]},
      {"slug": "motosiklet", "name": "Motosiklet", "items": [
        "Scooter", "Elektrikli motosiklet", "Touring", "Enduro", "Naked", "Racing", "Cross"
      ]},
      {"slug": "ticari-araclar", "name": "Ticari Araçlar", "items": [
        "Minibüs", "Panelvan", "Kamyonet", "Kamyon", "Çekici", "Otobüs", "Midibüs", "Servis aracı"
      ]},
      {"slug": "diger-araclar", "name": "Diğer Araçlar", "items": [
        "Karavan", "Motokaravan", "ATV", "UTV", "Elektrikli bisiklet", "Elektrikli scooter",
        "Klasik otomobil", "Hasarlı araç", "Deniz araçları", "Tekne", "Bot", "Jet ski"
      ]},
      {"slug": "arac-kiralama", "name": "Araç Kiralama", "items": [
        "Günlük otomobil", "Haftalık otomobil", "Uzun dönem otomobil", "Ticari araç",
        "Minibüs", "Karavan", "Motosiklet"
      ]}
    ]
  },
  {
    "slug": "oto-yedek-parca", "name": "Oto Yedek Parça ve Aksesuar", "icon": "construct-outline",
    "kind": "product", "tone": "info", "sort": 3,
    "aliases": ["yedek parça", "aksesuar", "lastik", "jant", "oto"],
    "form": {"fields": [
      {"key": "brand", "label": "Marka", "type": "text"},
      {"key": "vehicle_brand", "label": "Uyumlu araç markası", "type": "text"},
      {"key": "part_number", "label": "Parça numarası", "type": "text"}
    ]},
    "items": [
      "Motor parçaları", "Şanzıman parçaları", "Fren sistemleri", "Süspansiyon parçaları",
      "Elektrik parçaları", "Aküler", "Lastikler", "Jantlar", "Far ve stop",
      "Kaporta parçaları", "Tampon", "Ayna", "Araç multimedya", "Ses sistemleri",
      "Navigasyon cihazları", "Araç kameraları", "Koltuk kılıfları", "Paspaslar",
      "Tavan bagajları", "Araç bakım ekipmanları", "Motosiklet yedek parçaları",
      "Motosiklet aksesuarları", "Deniz aracı ekipmanları"
    ]
  },
  {
    "slug": "telefon-tablet", "name": "Telefon ve Tablet", "icon": "phone-portrait-outline",
    "kind": "product", "tone": "info", "sort": 4,
    "aliases": ["telefon", "tablet", "iphone", "samsung", "xiaomi", "akıllı telefon"],
    "form": {"fields": [
      {"key": "brand", "label": "Marka", "type": "text", "required": true},
      {"key": "model", "label": "Model", "type": "text", "required": true},
      {"key": "storage", "label": "Depolama", "type": "select", "options": ["32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB"]},
      {"key": "color", "label": "Renk", "type": "text"},
      {"key": "warranty", "label": "Garanti", "type": "select", "options": ["Var", "Yok", "Garantisi bitti"]},
      {"key": "cosmetic", "label": "Kozmetik durum", "type": "select", "options": ["Kusursuz", "Çok iyi", "İyi", "Yıpranmış"]}
    ]},
    "groups": [
      {"slug": "telefonlar", "name": "Telefonlar", "items": [
        "iPhone", "Samsung", "Xiaomi", "Huawei", "Oppo", "Vivo", "Honor",
        "Diğer akıllı telefonlar", "Tuşlu telefonlar"
      ]},
      {"slug": "tabletler", "name": "Tabletler", "items": [
        "iPad", "Android tablet", "Grafik tablet", "Çocuk tableti"
      ]},
      {"slug": "aksesuarlar", "name": "Aksesuarlar", "items": [
        "Telefon kılıfı", "Ekran koruyucu", "Şarj cihazı", "Powerbank", "Telefon tutucu",
        "Kablosuz şarj cihazı", "Telefon yedek parçaları"
      ]}
    ]
  },
  {
    "slug": "bilgisayar-donanim", "name": "Bilgisayar ve Donanım", "icon": "laptop-outline",
    "kind": "product", "tone": "info", "sort": 5,
    "aliases": ["bilgisayar", "laptop", "masaüstü", "ekran kartı", "ram", "ssd"],
    "form": {"fields": [
      {"key": "brand", "label": "Marka", "type": "text"},
      {"key": "cpu", "label": "İşlemci", "type": "text"},
      {"key": "ram", "label": "RAM", "type": "text"},
      {"key": "storage", "label": "Depolama", "type": "text"},
      {"key": "gpu", "label": "Ekran kartı", "type": "text"}
    ]},
    "items": [
      "Dizüstü bilgisayar", "Masaüstü bilgisayar", "Oyuncu bilgisayarı", "MacBook", "iMac",
      "Monitör", "Klavye", "Mouse", "Ekran kartı", "İşlemci", "Anakart", "RAM", "SSD", "HDD",
      "Bilgisayar kasası", "Güç kaynağı", "Yazıcı", "Tarayıcı", "Modem", "Router",
      "Ağ ekipmanları", "Bilgisayar aksesuarları", "Bilgisayar yedek parçaları"
    ]
  },
  {
    "slug": "elektronik-tv-ses-oyun", "name": "Elektronik, TV, Ses ve Oyun",
    "icon": "game-controller-outline", "kind": "product", "tone": "accent", "sort": 6,
    "aliases": ["elektronik", "televizyon", "tv", "ses sistemi", "oyun", "kamera"],
    "form": {"fields": [
      {"key": "brand", "label": "Marka", "type": "text"},
      {"key": "model", "label": "Model", "type": "text"},
      {"key": "warranty", "label": "Garanti", "type": "select", "options": ["Var", "Yok", "Garantisi bitti"]}
    ]},
    "groups": [
      {"slug": "televizyon-goruntu", "name": "Televizyon ve Görüntü", "items": [
        "LED TV", "OLED TV", "QLED TV", "Projeksiyon", "Monitör", "TV aksesuarları"
      ]},
      {"slug": "ses-sistemleri", "name": "Ses Sistemleri", "items": [
        "Bluetooth hoparlör", "Kulaklık", "Soundbar", "Ev sinema sistemi", "Mikrofon",
        "Amfi", "Profesyonel ses ekipmanları"
      ]},
      {"slug": "oyun", "name": "Oyun", "items": [
        "PlayStation", "Xbox", "Nintendo", "Oyun konsolu", "Oyun kumandası", "VR gözlük",
        "Direksiyon seti", "Oyuncu koltuğu", "Fiziksel oyun diskleri", "Oyun aksesuarları"
      ]},
      {"slug": "fotograf-kamera", "name": "Fotoğraf ve Kamera", "items": [
        "DSLR kamera", "Aynasız kamera", "Aksiyon kamerası", "Drone", "Lens", "Tripod",
        "Kamera çantası", "Fotoğraf aksesuarları"
      ]}
    ]
  },
  {
    "slug": "mobilya-dekorasyon", "name": "Mobilya ve Ev Dekorasyonu", "icon": "bed-outline",
    "kind": "product", "tone": "success", "sort": 7,
    "aliases": ["mobilya", "dekorasyon", "koltuk", "yatak", "halı", "perde"],
    "form": {"fields": [
      {"key": "product_type", "label": "Ürün türü", "type": "text"},
      {"key": "material", "label": "Malzeme", "type": "text"},
      {"key": "color", "label": "Renk", "type": "text"},
      {"key": "dimensions", "label": "Ölçüler", "type": "text"}
    ]},
    "groups": [
      {"slug": "mobilya", "name": "Mobilya", "items": [
        "Koltuk takımı", "Kanepe", "Berjer", "Yatak", "Baza", "Gardırop", "Yemek masası",
        "Sandalye", "TV ünitesi", "Kitaplık", "Çalışma masası", "Genç odası", "Çocuk odası",
        "Balkon mobilyası", "Bahçe mobilyası"
      ]},
      {"slug": "dekorasyon", "name": "Dekorasyon", "items": [
        "Halı", "Kilim", "Perde", "Avize", "Abajur", "Ayna", "Tablo", "Dekoratif aksesuar",
        "Duvar saati", "Ev tekstili", "Aydınlatma", "Mutfak gereçleri", "Banyo aksesuarları"
      ]}
    ]
  },
  {
    "slug": "beyaz-esya", "name": "Beyaz Eşya ve Ev Aletleri", "icon": "snow-outline",
    "kind": "product", "tone": "info", "sort": 8,
    "aliases": ["beyaz eşya", "buzdolabı", "çamaşır makinesi", "klima", "süpürge"],
    "form": {"fields": [
      {"key": "brand", "label": "Marka", "type": "text"},
      {"key": "model", "label": "Model", "type": "text"},
      {"key": "energy_class", "label": "Enerji sınıfı", "type": "select", "options": ["A", "B", "C", "D", "E", "F", "G"]},
      {"key": "warranty", "label": "Garanti", "type": "select", "options": ["Var", "Yok", "Garantisi bitti"]}
    ]},
    "groups": [
      {"slug": "beyaz-esya", "name": "Beyaz Eşya", "items": [
        "Buzdolabı", "Çamaşır makinesi", "Bulaşık makinesi", "Kurutma makinesi", "Fırın",
        "Ocak", "Derin dondurucu", "Klima"
      ]},
      {"slug": "kucuk-ev-aletleri", "name": "Küçük Ev Aletleri", "items": [
        "Elektrikli süpürge", "Robot süpürge", "Kahve makinesi", "Çay makinesi",
        "Tost makinesi", "Blender", "Mikser", "Airfryer", "Ütü", "Saç kurutma makinesi",
        "Hava temizleyici"
      ]}
    ]
  },
  {
    "slug": "giyim-ayakkabi", "name": "Giyim ve Ayakkabı", "icon": "shirt-outline",
    "kind": "product", "tone": "accent", "sort": 9,
    "aliases": ["giyim", "kıyafet", "ayakkabı", "çanta", "moda"],
    "form": {"fields": [
      {"key": "size", "label": "Beden", "type": "text"},
      {"key": "color", "label": "Renk", "type": "text"},
      {"key": "brand", "label": "Marka", "type": "text"}
    ]},
    "groups": [
      {"slug": "kadin-giyim", "name": "Kadın Giyim", "items": [
        "Elbise", "Pantolon", "Gömlek", "Bluz", "Tişört", "Ceket", "Mont", "Etek", "Takım",
        "Spor giyim", "Abiye"
      ]},
      {"slug": "erkek-giyim", "name": "Erkek Giyim", "items": [
        "Takım elbise", "Gömlek", "Pantolon", "Tişört", "Ceket", "Mont", "Eşofman", "Spor giyim"
      ]},
      {"slug": "ayakkabi", "name": "Ayakkabı", "items": [
        "Spor ayakkabı", "Klasik ayakkabı", "Bot", "Çizme", "Sandalet", "Terlik"
      ]},
      {"slug": "canta", "name": "Çanta", "items": [
        "Kadın çantası", "Erkek çantası", "Sırt çantası", "Valiz", "Seyahat çantası"
      ]}
    ]
  },
  {
    "slug": "taki-saat-aksesuar", "name": "Takı, Saat ve Aksesuar", "icon": "diamond-outline",
    "kind": "product", "tone": "warning", "sort": 10,
    "aliases": ["takı", "saat", "kolye", "yüzük", "gözlük", "aksesuar"],
    "form": {"fields": [
      {"key": "material", "label": "Materyal", "type": "text"},
      {"key": "brand", "label": "Marka", "type": "text"},
      {"key": "size", "label": "Ölçü", "type": "text"}
    ]},
    "items": [
      "Kol saati", "Akıllı saat", "Klasik saat", "Kolye", "Bileklik", "Küpe", "Yüzük",
      "Gözlük", "Güneş gözlüğü", "Kemer", "Cüzdan", "Şapka", "Atkı", "Eldiven",
      "Saç aksesuarları", "Bijuteri"
    ]
  },
  {
    "slug": "anne-bebek", "name": "Anne, Bebek ve Çocuk", "icon": "happy-outline",
    "kind": "product", "tone": "accent", "sort": 11,
    "aliases": ["bebek", "çocuk", "anne", "oyuncak", "bebek arabası"],
    "form": {"fields": [
      {"key": "age_range", "label": "Yaş aralığı", "type": "text"},
      {"key": "brand", "label": "Marka", "type": "text"}
    ]},
    "items": [
      "Bebek arabası", "Bebek yatağı", "Beşik", "Mama sandalyesi", "Bebek oto koltuğu",
      "Bebek taşıyıcı", "Bebek kıyafetleri", "Çocuk kıyafetleri", "Çocuk ayakkabıları",
      "Bebek bakım ürünleri", "Eğitici oyuncak", "Oyuncak araba", "Oyuncak bebek",
      "Lego ve yapı oyuncakları", "Çocuk bisikleti", "Çocuk mobilyaları", "Okul çantaları"
    ]
  },
  {
    "slug": "spor-outdoor", "name": "Spor ve Outdoor", "icon": "barbell-outline",
    "kind": "product", "tone": "success", "sort": 12,
    "aliases": ["spor", "outdoor", "bisiklet", "kamp", "balıkçılık", "fitness"],
    "form": {"fields": [
      {"key": "sport_type", "label": "Spor türü", "type": "text"},
      {"key": "brand", "label": "Marka", "type": "text"}
    ]},
    "items": [
      "Futbol ekipmanları", "Basketbol ekipmanları", "Voleybol ekipmanları",
      "Fitness ekipmanları", "Koşu ekipmanları", "Bisiklet", "Bisiklet aksesuarları",
      "Kamp çadırı", "Kamp masası", "Kamp sandalyesi", "Uyku tulumu",
      "Dağcılık ekipmanları", "Trekking ekipmanları", "Balıkçılık ekipmanları",
      "Yüzme ekipmanları", "Dalış ekipmanları", "Kayak ekipmanları", "Spor kıyafetleri",
      "Spor ayakkabıları"
    ]
  },
  {
    "slug": "kitap-muzik-hobi", "name": "Kitap, Müzik, Hobi ve Koleksiyon",
    "icon": "book-outline", "kind": "product", "tone": "warning", "sort": 13,
    "aliases": ["kitap", "müzik", "hobi", "koleksiyon", "enstrüman", "antika"],
    "form": {"fields": [
      {"key": "author", "label": "Yazar / sanatçı", "type": "text"},
      {"key": "publisher", "label": "Yayınevi / marka", "type": "text"},
      {"key": "language", "label": "Dil", "type": "text"}
    ]},
    "groups": [
      {"slug": "kitaplar", "name": "Kitaplar", "items": [
        "Roman", "Hikâye", "Tarih", "Eğitim", "Ders kitabı", "Sınav hazırlık",
        "Çocuk kitapları", "Ansiklopedi", "Çizgi roman", "Dergi"
      ]},
      {"slug": "muzik", "name": "Müzik", "items": [
        "Gitar", "Bağlama", "Kemençe", "Tulum", "Piyano", "Org", "Davul", "Keman",
        "Müzik aksesuarları"
      ]},
      {"slug": "hobi", "name": "Hobi", "items": [
        "Maket", "Puzzle", "Masa oyunları", "Resim malzemeleri", "El sanatları malzemeleri",
        "Koleksiyon ürünleri", "Antika eşyalar", "Eski paralar", "Pullar", "Plaklar",
        "Kartpostallar", "Figürler"
      ]}
    ]
  },
  {
    "slug": "yapi-market-bahce", "name": "Yapı Market ve Bahçe", "icon": "hammer-outline",
    "kind": "product", "tone": "warning", "sort": 14,
    "aliases": ["yapı market", "bahçe", "hırdavat", "seramik", "el aletleri"],
    "form": {"fields": [
      {"key": "brand", "label": "Marka", "type": "text"},
      {"key": "unit", "label": "Satış birimi", "type": "text"}
    ]},
    "groups": [
      {"slug": "yapi-malzemeleri", "name": "Yapı Malzemeleri", "items": [
        "Seramik", "Fayans", "Parke", "Laminat", "Kapı", "Pencere", "Duşakabin", "Lavabo",
        "Musluk", "Vitrifiye", "Yalıtım malzemeleri", "Çatı malzemeleri"
      ]},
      {"slug": "el-aletleri", "name": "El Aletleri", "items": [
        "Matkap", "Vidalama", "Testere", "Taşlama", "Takım çantası", "Ölçüm cihazları",
        "Elektrikli el aletleri"
      ]},
      {"slug": "bahce", "name": "Bahçe", "items": [
        "Çim biçme makinesi", "Bahçe mobilyası", "Saksı", "Sulama sistemleri",
        "Bahçe aletleri", "Seracılık malzemeleri", "Bitki ve fide"
      ]}
    ]
  },
  {
    "slug": "yoresel-urunler", "name": "Yöresel Ürünler ve Yerel Üreticiler",
    "icon": "leaf-outline", "kind": "product", "tone": "success", "sort": 15, "featured": true,
    "aliases": ["yöresel", "tereyağı", "peynir", "fındık", "çay", "vakfıkebir", "üretici"],
    "description": "Trabzon'un yöresel ürünleri, el yapımı ürünleri ve yerel üreticileri.",
    "form": {"fields": [
      {"key": "producer", "label": "Üretici", "type": "text"},
      {"key": "weight", "label": "Net miktar", "type": "text"},
      {"key": "production_date", "label": "Üretim tarihi", "type": "date"},
      {"key": "expiry_date", "label": "Son tüketim tarihi", "type": "date"}
    ]},
    "groups": [
      {"slug": "trabzon-yoresel", "name": "Trabzon Yöresel Ürünleri", "items": [
        "Trabzon tereyağı", "Vakfıkebir ekmeği", "Trabzon peyniri", "Kolot peyniri",
        "Telli peynir", "Fındık", "Fındık ürünleri", "Çay", "Bal", "Reçel", "Pekmez",
        "Mısır unu", "Kuymaklık ürünler", "Yöresel kuru gıdalar"
      ]},
      {"slug": "el-yapimi", "name": "El Yapımı Ürünler", "items": [
        "El örgüsü", "Geleneksel dokumalar", "Ahşap ürünler", "Bakır eşyalar",
        "Hediyelik eşyalar", "Yöresel dekorasyon"
      ]},
      {"slug": "yerel-ureticiler", "name": "Yerel Üreticiler", "items": [
        "Çiftçiler", "Arıcılar", "Fındık üreticileri", "Çay üreticileri", "Mandıralar",
        "Yöresel gıda üreticileri"
      ]}
    ]
  },
  {
    "slug": "tarim-hayvancilik", "name": "Tarım ve Hayvancılık", "icon": "nutrition-outline",
    "kind": "product", "tone": "success", "sort": 16,
    "aliases": ["tarım", "hayvancılık", "traktör", "fındık", "çay", "arıcılık"],
    "form": {"fields": [
      {"key": "brand", "label": "Marka", "type": "text"},
      {"key": "power", "label": "Güç / kapasite", "type": "text"},
      {"key": "year", "label": "Yıl", "type": "number"}
    ]},
    "groups": [
      {"slug": "tarim", "name": "Tarım", "items": [
        "Traktör", "Traktör ekipmanları", "Çapa makinesi", "Çim biçme makinesi",
        "Fındık toplama ekipmanları", "Çay toplama ekipmanları", "Sulama sistemleri",
        "Sera ekipmanları", "Tarım aletleri", "Tarım römorkları"
      ]},
      {"slug": "hayvancilik-ekipmanlari", "name": "Hayvancılık Ekipmanları", "items": [
        "Ahır ekipmanları", "Süt sağım makineleri", "Yemlikler", "Suluklar",
        "Kuluçka makineleri", "Arıcılık malzemeleri", "Kovanlar", "Bal süzme makineleri"
      ]},
      {"slug": "tarimsal-urunler", "name": "Tarımsal Ürünler", "items": [
        "Fındık", "Çay", "Meyve", "Sebze", "Fide", "Fidan", "Tohum", "Yem", "Saman"
      ]}
    ]
  },
  {
    "slug": "is-makineleri-sanayi", "name": "İş Makineleri ve Sanayi",
    "icon": "cog-outline", "kind": "product", "tone": "info", "sort": 17,
    "aliases": ["iş makinesi", "sanayi", "forklift", "ekskavatör", "jeneratör"],
    "form": {"fields": [
      {"key": "brand", "label": "Marka", "type": "text"},
      {"key": "model", "label": "Model", "type": "text"},
      {"key": "year", "label": "Yıl", "type": "number"},
      {"key": "hours", "label": "Çalışma saati", "type": "number"}
    ]},
    "items": [
      "Ekskavatör", "Kepçe", "Forklift", "Vinç", "Greyder", "Silindir", "Beton mikseri",
      "Kompresör", "Jeneratör", "Kaynak makinesi", "Torna", "CNC makinesi",
      "Matkap tezgâhı", "Sanayi motorları", "Konveyör", "Raf sistemleri",
      "Depolama ekipmanları", "Sanayi yedek parçaları", "Güneş enerji sistemleri",
      "İş makinesi kiralama", "Tarım ve sanayi makinesi yedek parçaları"
    ]
  },
  {
    "slug": "isletmeler", "name": "İşletmeler ve Mekânlar", "icon": "storefront-outline",
    "kind": "place", "tone": "primary", "sort": 18, "featured": true,
    "aliases": ["işletme", "restoran", "kafe", "otel", "mağaza", "mekan"],
    "description": "Trabzon'daki restoran, kafe, otel, mağaza ve hizmet işletmeleri.",
    "form": {"price_mode": "hidden", "fields": []},
    "groups": [
      {"slug": "yeme-icme", "name": "Yeme İçme", "items": [
        "Restoran", "Kafe", "Kahvaltı salonu", "Pastane", "Fırın", "Lokanta",
        "Balık restoranı", "Fast food", "Pide salonu", "Tatlıcı", "Çay bahçesi"
      ]},
      {"slug": "konaklama", "name": "Konaklama", "items": [
        "Otel", "Pansiyon", "Apart otel", "Bungalov", "Tatil evi", "Villa konaklama",
        "Kamp alanı"
      ]},
      {"slug": "magazalar", "name": "Mağazalar", "items": [
        "Market", "Süpermarket", "Giyim mağazası", "Elektronik mağazası", "Mobilyacı",
        "Kuyumcu", "Kitapçı", "Çiçekçi", "Yapı market", "Oto galerisi"
      ]},
      {"slug": "kisisel-bakim-isletmeleri", "name": "Kişisel Bakım", "items": [
        "Berber", "Kuaför", "Güzellik salonu", "Cilt bakım merkezi", "Spor salonu"
      ]},
      {"slug": "hizmet-isletmeleri", "name": "Hizmet İşletmeleri", "items": [
        "Emlak ofisi", "Oto servis", "Oto yıkama", "Lastikçi", "Teknik servis",
        "Kargo şubesi", "Nakliye firması", "Rent a car"
      ]},
      {"slug": "diger-yerler", "name": "Diğer Yerler", "items": [
        "Hastane", "Eczane", "Klinik", "Banka", "ATM", "Otopark", "Park", "Müze",
        "Tarihî yer", "Turistik nokta", "Kamu kurumu"
      ]}
    ]
  },
  {
    "slug": "ustalar-hizmetler", "name": "Ustalar ve Hizmetler", "icon": "build-outline",
    "kind": "service", "tone": "accent", "sort": 19, "featured": true,
    "aliases": ["usta", "hizmet", "elektrikçi", "tesisatçı", "boyacı", "nakliye", "temizlik"],
    "description": "Trabzon'da ev, tadilat, temizlik, nakliye, teknik servis ve dijital hizmetler.",
    "form": {"price_mode": "optional", "fields": [
      {"key": "service_area", "label": "Hizmet bölgesi", "type": "text"},
      {"key": "price_type", "label": "Fiyatlandırma", "type": "select", "options": ["Sabit fiyat", "Teklif al", "Saatlik", "Görüşülür"]},
      {"key": "experience", "label": "Deneyim (yıl)", "type": "number"}
    ]},
    "groups": [
      {"slug": "ev-tadilat", "name": "Ev ve Tadilat", "items": [
        "Elektrikçi", "Su tesisatçısı", "Boyacı", "Fayans ustası", "Alçı ustası", "Sıvacı",
        "Parke ustası", "Çatı ustası", "Mantolama", "Cam balkon", "PVC ustası",
        "Mobilya montajı", "Mutfak dolabı", "Banyo tadilatı", "İç mimarlık"
      ]},
      {"slug": "temizlik", "name": "Temizlik", "items": [
        "Ev temizliği", "Ofis temizliği", "İnşaat sonrası temizlik", "Halı yıkama",
        "Koltuk yıkama", "Cam temizliği", "Apartman temizliği"
      ]},
      {"slug": "nakliye", "name": "Nakliye", "items": [
        "Evden eve nakliyat", "Şehir içi nakliye", "Parça eşya taşıma", "Ofis taşıma",
        "Asansörlü nakliyat", "Depolama"
      ]},
      {"slug": "teknik-servis", "name": "Teknik Servis", "items": [
        "Beyaz eşya servisi", "Telefon tamiri", "Bilgisayar tamiri", "Televizyon tamiri",
        "Klima servisi", "Kombi servisi", "Kamera sistemi kurulumu"
      ]},
      {"slug": "arac-hizmetleri", "name": "Araç Hizmetleri", "items": [
        "Oto tamir", "Oto elektrik", "Kaporta", "Boya", "Lastik hizmetleri",
        "Araç ekspertiz", "Oto yıkama", "Oto kuaför"
      ]},
      {"slug": "dijital-hizmetler", "name": "Dijital Hizmetler", "items": [
        "Web sitesi geliştirme", "Mobil uygulama geliştirme", "Grafik tasarım",
        "Logo tasarımı", "Sosyal medya yönetimi", "Dijital pazarlama", "Video montaj",
        "Fotoğraf düzenleme", "SEO hizmetleri"
      ]}
    ]
  },
  {
    "slug": "turizm-konaklama", "name": "Turizm ve Konaklama", "icon": "airplane-outline",
    "kind": "place", "tone": "info", "sort": 20,
    "aliases": ["turizm", "konaklama", "otel", "tur", "uzungöl", "sümela", "yayla"],
    "form": {"price_mode": "optional", "fields": []},
    "groups": [
      {"slug": "konaklama-hizmetleri", "name": "Konaklama Hizmetleri", "items": [
        "Otel", "Pansiyon", "Apart", "Bungalov", "Günlük kiralık konaklama",
        "Villa konaklama", "Kamp alanı", "Karavan kamp alanı"
      ]},
      {"slug": "turizm-hizmetleri", "name": "Turizm Hizmetleri", "items": [
        "Trabzon şehir turu", "Uzungöl turu", "Sümela Manastırı turu", "Yayla turu",
        "Doğa yürüyüşü", "Fotoğraf turu", "Rehberlik", "Transfer hizmeti",
        "Araç kiralama", "Tur organizasyonu"
      ]},
      {"slug": "turistik-yerler", "name": "Turistik Yerler", "items": [
        "Uzungöl", "Sümela Manastırı", "Atatürk Köşkü", "Trabzon Boztepe",
        "Hıdırnebi Yaylası", "Sera Gölü", "Çal Mağarası", "Diğer turistik noktalar"
      ]}
    ]
  },
  {
    "slug": "is-ilanlari", "name": "İş İlanları ve Kariyer", "icon": "briefcase-outline",
    "kind": "job", "tone": "primary", "sort": 21,
    "aliases": ["iş", "kariyer", "iş ilanı", "part time", "tam zamanlı", "staj"],
    "form": {"price_mode": "optional", "fields": [
      {"key": "position", "label": "Pozisyon", "type": "text", "required": true},
      {"key": "employment_type", "label": "Çalışma şekli", "type": "select", "options": ["Tam zamanlı", "Part-time", "Sezonluk", "Uzaktan", "Staj"]},
      {"key": "salary", "label": "Maaş", "type": "text"},
      {"key": "company", "label": "İşveren", "type": "text"},
      {"key": "remote", "label": "Uzaktan çalışma", "type": "boolean"}
    ]},
    "items": [
      "Otel personeli", "Resepsiyonist", "Garson", "Komi", "Aşçı", "Mutfak personeli",
      "Temizlik personeli", "Satış danışmanı", "Mağaza personeli", "Kasiyer", "Şoför",
      "Kurye", "Güvenlik görevlisi", "Muhasebe", "Sekreter", "Ofis personeli",
      "Yazılım geliştirici", "Grafik tasarımcı", "Sosyal medya uzmanı", "Mühendis",
      "Tekniker", "Elektrikçi", "Tesisatçı", "İnşaat ustası", "Sağlık personeli",
      "Eğitim personeli", "Staj ilanları", "Part-time iş", "Tam zamanlı iş",
      "Sezonluk iş", "Uzaktan çalışma"
    ]
  },
  {
    "slug": "egitim-ozel-ders", "name": "Eğitim ve Özel Ders", "icon": "school-outline",
    "kind": "education", "tone": "success", "sort": 22,
    "aliases": ["eğitim", "ders", "özel ders", "kurs", "yks", "lgs", "kemençe"],
    "form": {"price_mode": "optional", "fields": [
      {"key": "subject", "label": "Ders / eğitim", "type": "text", "required": true},
      {"key": "level", "label": "Seviye", "type": "select", "options": ["İlkokul", "Ortaokul", "Lise", "Üniversite", "Yetişkin"]},
      {"key": "lesson_mode", "label": "Ders şekli", "type": "select", "options": ["Yüz yüze", "Online", "Hibrit"]}
    ]},
    "items": [
      "Matematik", "Türkçe", "İngilizce", "Almanca", "Arapça", "Fizik", "Kimya", "Biyoloji",
      "İlkokul dersleri", "Ortaokul dersleri", "LGS hazırlık", "YKS hazırlık",
      "Üniversite dersleri", "Yazılım eğitimi", "Bilgisayar eğitimi",
      "Grafik tasarım eğitimi", "Direksiyon eğitimi", "Müzik dersleri", "Kemençe dersi",
      "Tulum dersi", "Gitar dersi", "Piyano dersi", "Resim dersi", "Spor eğitimi",
      "Yüzme eğitimi", "Yabancı dil kursları", "Mesleki eğitim"
    ]
  },
  {
    "slug": "organizasyon-etkinlik", "name": "Organizasyon ve Etkinlik",
    "icon": "sparkles-outline", "kind": "event", "tone": "accent", "sort": 23,
    "aliases": ["organizasyon", "etkinlik", "düğün", "kına", "davet", "festival"],
    "form": {"price_mode": "optional", "fields": [
      {"key": "event_type", "label": "Etkinlik türü", "type": "text"},
      {"key": "event_date", "label": "Tarih", "type": "date"},
      {"key": "venue", "label": "Yer", "type": "text"}
    ]},
    "groups": [
      {"slug": "dugun-davet", "name": "Düğün ve Davet", "items": [
        "Düğün salonu", "Nişan organizasyonu", "Kına organizasyonu", "Nikâh organizasyonu",
        "Sünnet organizasyonu", "Doğum günü organizasyonu"
      ]},
      {"slug": "organizasyon-hizmetleri", "name": "Organizasyon Hizmetleri", "items": [
        "Fotoğrafçı", "Kameraman", "DJ", "Ses sistemi", "Işık sistemi",
        "Masa sandalye kiralama", "Çiçek süsleme", "Davet dekorasyonu", "Catering",
        "Organizasyon firmaları"
      ]},
      {"slug": "etkinlikler", "name": "Etkinlikler", "items": [
        "Konserler", "Tiyatro", "Sergiler", "Festivaller", "Spor etkinlikleri",
        "Çocuk etkinlikleri", "Kültürel etkinlikler", "Horon etkinlikleri",
        "Yayla şenlikleri"
      ]}
    ]
  },
  {
    "slug": "evcil-hayvanlar", "name": "Evcil Hayvanlar", "icon": "paw-outline",
    "kind": "product", "tone": "warning", "sort": 24,
    "aliases": ["evcil hayvan", "kedi", "köpek", "mama", "akvaryum", "veteriner"],
    "form": {"price_mode": "optional", "fields": [
      {"key": "pet_type", "label": "Hayvan türü", "type": "text"},
      {"key": "breed", "label": "Irk", "type": "text"},
      {"key": "age", "label": "Yaş", "type": "text"}
    ]},
    "groups": [
      {"slug": "sahiplendirme", "name": "Sahiplendirme", "items": [
        "Kedi sahiplendirme", "Köpek sahiplendirme", "Diğer yasal sahiplendirme ilanları"
      ]},
      {"slug": "malzemeler", "name": "Malzemeler", "items": [
        "Mama", "Mama kabı", "Su kabı", "Kedi kumu", "Kedi evi", "Köpek kulübesi",
        "Taşıma çantası", "Tasmalı ürünler", "Oyuncak", "Akvaryum", "Kuş kafesi",
        "Bakım aksesuarları"
      ]},
      {"slug": "hizmetler", "name": "Hizmetler", "items": [
        "Veteriner klinikleri", "Pet kuaför", "Pet bakım", "Hayvan pansiyonu"
      ]}
    ]
  },
  {
    "slug": "kisisel-bakim-kozmetik", "name": "Kişisel Bakım ve Kozmetik",
    "icon": "color-palette-outline", "kind": "product", "tone": "accent", "sort": 25,
    "aliases": ["kozmetik", "parfüm", "cilt bakımı", "makyaj", "kişisel bakım"],
    "form": {"fields": [
      {"key": "brand", "label": "Marka", "type": "text"},
      {"key": "skin_type", "label": "Cilt tipi", "type": "select", "options": ["Normal", "Kuru", "Yağlı", "Karma", "Hassas"]}
    ]},
    "items": [
      "Parfüm", "Cilt bakım ürünleri", "Saç bakım ürünleri", "Makyaj ürünleri",
      "Tıraş makineleri", "Saç şekillendirici", "Kişisel bakım cihazları",
      "Manikür ekipmanları", "Güzellik aksesuarları", "Hijyen ürünleri"
    ]
  },
  {
    "slug": "ofis-kirtasiye", "name": "Ofis ve Kırtasiye", "icon": "print-outline",
    "kind": "product", "tone": "info", "sort": 26,
    "aliases": ["ofis", "kırtasiye", "masa", "koltuk", "yazıcı", "defter"],
    "form": {"fields": [
      {"key": "brand", "label": "Marka", "type": "text"},
      {"key": "product_type", "label": "Ürün türü", "type": "text"}
    ]},
    "items": [
      "Ofis masası", "Ofis koltuğu", "Dosya dolabı", "Toplantı masası", "Yazıcı",
      "Fotokopi makinesi", "Tarayıcı", "Evrak imha makinesi", "Kırtasiye ürünleri",
      "Defter", "Kalem", "Dosya", "Ajanda", "Okul malzemeleri", "Ofis dekorasyonu",
      "Barkod okuyucu", "POS çevre birimleri", "Etiket yazıcıları"
    ]
  },
  {
    "slug": "hediyelik-el-sanatlari", "name": "Hediyelik, El Sanatları ve Tasarım",
    "icon": "gift-outline", "kind": "product", "tone": "accent", "sort": 27,
    "aliases": ["hediyelik", "hediye", "el sanatları", "tasarım", "örgü", "seramik"],
    "form": {"fields": [
      {"key": "material", "label": "Malzeme", "type": "text"},
      {"key": "handmade", "label": "El yapımı", "type": "boolean"}
    ]},
    "items": [
      "Kişiye özel hediyeler", "El yapımı takılar", "Ahşap hediyeler", "Bakır ürünler",
      "Dekoratif objeler", "Seramik ürünler", "Örgü ürünleri", "El yapımı çantalar",
      "Hediyelik kutular", "Çerçeveler", "Fotoğraf albümleri", "Yöresel hediyelikler",
      "El işi süslemeler", "El yapımı tablolar"
    ]
  },
  {
    "slug": "diger-ilanlar", "name": "Diğer İlanlar", "icon": "grid-outline",
    "kind": "product", "tone": "info", "sort": 28,
    "aliases": ["diğer", "çeşitli"],
    "form": {"price_mode": "optional", "fields": []},
    "items": [
      "Diğer ikinci el ürünler", "Diğer sıfır ürünler", "Diğer hizmetler",
      "Diğer ticari ekipmanlar", "Diğer koleksiyon ürünleri",
      "Kategorisi bulunamayan uygun ilanlar"
    ]
  }
]
$json$::jsonb);

-- Eski deneme kayıtları görünür kalmasın; ilan sahipliği etkilenmez.
update public.marketplace_categories
   set is_active = false
 where slug like 'test-kategori-%';

drop function if exists public.tz_market_seed_tree(jsonb);

-- ---------------------------------------------------------------------
-- 5. Kategori ağacı ve arama RPC'leri
-- ---------------------------------------------------------------------
create or replace function public.market_categories_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  with recursive tree as (
    select
      c.id, c.parent_id, c.slug, c.name, c.icon, c.kind, c.tone, c.description,
      c.aliases, c.form_schema, c.is_featured, c.sort_order,
      1 as depth,
      c.slug::text as path_slug,
      c.name as path_names
    from public.marketplace_categories c
    where c.parent_id is null and c.is_active

    union all

    select
      ch.id, ch.parent_id, ch.slug, ch.name, ch.icon, ch.kind, ch.tone, ch.description,
      ch.aliases, ch.form_schema, ch.is_featured, ch.sort_order,
      t.depth + 1,
      t.path_slug || '/' || ch.slug,
      t.path_names || ' > ' || ch.name
    from public.marketplace_categories ch
    join tree t on t.id = ch.parent_id
    where ch.is_active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'parent_id', t.parent_id,
    'slug', t.slug,
    'name', t.name,
    'icon', t.icon,
    'kind', t.kind,
    'tone', t.tone,
    'description', t.description,
    'aliases', t.aliases,
    'form_schema', t.form_schema,
    'is_featured', t.is_featured,
    'sort_order', t.sort_order,
    'depth', t.depth,
    'path_slug', t.path_slug,
    'path_names', t.path_names,
    'listing_count', (
      select count(*) from public.marketplace_listings l
      where l.category_id = t.id and l.status = 'active' and l.moderation_status = 'visible'
    )
  ) order by t.depth, t.sort_order, t.name), '[]'::jsonb)
  into v_items
  from tree t;

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.market_categories_v2() from public, anon;
grant execute on function public.market_categories_v2() to authenticated, service_role;

create or replace function public.market_category_search(
  p_query text,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
  v_items jsonb;
begin
  if char_length(v_query) < 2 then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

  with recursive tree as (
    select
      c.id, c.parent_id, c.slug, c.name, c.icon, c.kind, c.tone, c.is_featured,
      c.sort_order,
      1 as depth,
      c.slug::text || '/' as path_slug,
      c.name as path_names
    from public.marketplace_categories c
    where c.parent_id is null and c.is_active

    union all

    select
      ch.id, ch.parent_id, ch.slug, ch.name, ch.icon, ch.kind, ch.tone, ch.is_featured,
      ch.sort_order,
      t.depth + 1,
      t.path_slug || ch.slug || '/',
      t.path_names || ' > ' || ch.name
    from public.marketplace_categories ch
    join tree t on t.id = ch.parent_id
    where ch.is_active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'slug', x.slug,
    'name', x.name,
    'icon', x.icon,
    'kind', x.kind,
    'tone', x.tone,
    'depth', x.depth,
    'path_slug', trim(both '/' from x.path_slug),
    'path_names', x.path_names,
    'is_featured', x.is_featured,
    'listing_count', (
      select count(*) from public.marketplace_listings l
      where l.category_id in (
        select c2.id from public.marketplace_categories c2
        where c2.id = x.id or c2.parent_id = x.id
      )
        and l.status = 'active' and l.moderation_status = 'visible'
    )
  ) order by x.is_featured desc, x.depth, x.sort_order, x.name), '[]'::jsonb)
  into v_items
  from (
    select t.*
    from tree t
    left join public.marketplace_categories c on c.id = t.id
    where lower(t.name) like '%' || v_query || '%'
       or lower(t.path_names) like '%' || v_query || '%'
       or exists (
         select 1 from unnest(coalesce(c.aliases, '{}'::text[])) a
         where lower(a) like '%' || v_query || '%'
       )
    order by t.is_featured desc, t.depth, t.sort_order, t.name
    limit v_limit
  ) x;

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.market_category_search(text, integer) from public, anon;
grant execute on function public.market_category_search(text, integer) to authenticated, service_role;

comment on function public.market_categories_v2() is
  'Aktif Marketplace kategori ağacı; form şeması ve ilan sayılarıyla birlikte.';
comment on function public.market_category_search(text, integer) is
  'Kategori adı, yol ve eş anlamlılarda arama. En az 2 karakter ister.';
