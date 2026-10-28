// Trabzon'daki gerçek işletmeleri OpenStreetMap (ODbL) üzerinden içe aktarır.
//
// Kullanım:
//   node scripts/import-trabzon-osm.mjs --dry-run
//   node scripts/import-trabzon-osm.mjs --apply
//
// Notlar:
// - Yalnızca adı olan, Trabzon hizmet sınırları içindeki kayıtlar alınır.
// - Sahte isim/açıklama/yorum üretilmez; OSM etiketleri olduğu gibi eşlenir.
// - Kaynak atıfı `place_external_references` tablosunda ve haritada korunur.
// - İşletme sahipliği/doğrulama rozeti oluşturulmaz.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const RESET = args.has('--reset-osm');
const DRY = args.has('--dry-run') || !APPLY;
const BOUNDARY_CACHE = join(root, 'scripts', '.cache', 'trabzon-boundaries.json');
const OVERPASS_CACHE = join(root, 'scripts', '.cache', 'trabzon-osm-places.json');
const DISTRICTS = [
  ['Ortahisar', 'ortahisar'],
  ['Akçaabat', 'akcaabat'],
  ['Yomra', 'yomra'],
  ['Arsin', 'arsin'],
  ['Araklı', 'arakli'],
  ['Sürmene', 'surmene'],
  ['Of', 'of'],
  ['Çaykara', 'caykara'],
  ['Dernekpazarı', 'dernekpazari'],
  ['Hayrat', 'hayrat'],
  ['Maçka', 'macka'],
  ['Düzköy', 'duzkoy'],
  ['Vakfıkebir', 'vakfikebir'],
  ['Beşikdüzü', 'besikduzu'],
  ['Çarşıbaşı', 'carsibasi'],
  ['Şalpazarı', 'salpazari'],
  ['Tonya', 'tonya'],
  ['Köprübaşı', 'koprubasi'],
];
const limitArg = process.argv.find((item) => item.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : null;

const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const token = env.SUPABASE_ACCESS_TOKEN;
const ref = env.SUPABASE_PROJECT_REF;
if (!token || !ref) {
  console.error('missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF');
  process.exit(1);
}

const CATEGORY_BY_TAG = {
  amenity: {
    restaurant: 'restoran',
    fast_food: 'restoran',
    cafe: 'kafe',
    bar: 'kafe',
    pub: 'kafe',
    bakery: 'firin',
    pharmacy: 'eczane',
    bank: 'banka',
    hospital: 'saglik',
    clinic: 'saglik',
    doctors: 'saglik',
    dentist: 'saglik',
    parking: 'otopark',
    cinema: 'turistik-yer',
    theatre: 'tarihi-kulturel',
    townhall: 'kamu',
    library: 'kamu',
    police: 'kamu',
    post_office: 'kamu',
    school: 'kamu',
    university: 'kamu',
    kindergarten: 'kamu',
    courthouse: 'kamu',
  },
  shop: {
    supermarket: 'market',
    convenience: 'market',
    greengrocer: 'market',
    butcher: 'market',
    bakery: 'firin',
    clothes: 'giyim',
    shoes: 'giyim',
    electronics: 'elektronik',
    mobile_phone: 'elektronik',
    hardware: 'elektronik',
    furniture: 'mobilya',
    jewelry: 'kuyumcu',
    mall: 'avm',
    department_store: 'avm',
    hairdresser: 'berber',
    car_repair: 'oto-servis',
    car_rental: 'arac-kiralama',
    estate_agent: 'emlak-ofisi',
    sports: 'spor-salonu',
  },
  tourism: {
    hotel: 'otel',
    guest_house: 'pansiyon',
    hostel: 'pansiyon',
    motel: 'pansiyon',
    apartment: 'apart-otel',
    chalet: 'bungalov',
    attraction: 'turistik-yer',
    museum: 'turistik-yer',
    viewpoint: 'gezilecek-nokta',
  },
  leisure: {
    park: 'park',
    garden: 'park',
    playground: 'park',
    fitness_centre: 'spor-salonu',
    sports_centre: 'spor-salonu',
  },
};

function slugFor(tags) {
  for (const key of Object.keys(CATEGORY_BY_TAG)) {
    const value = tags[key];
    if (value && CATEGORY_BY_TAG[key][value]) {
      return CATEGORY_BY_TAG[key][value];
    }
  }
  return null;
}

function cleanText(value, max) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) {
    return null;
  }
  return text.slice(0, max);
}

function cleanWebsite(value) {
  const url = cleanText(value, 300);
  return url && /^https?:\/\/[^\s]+$/.test(url) ? url : null;
}

function cleanPhone(value) {
  const phone = cleanText(value, 30);
  return phone && phone.replace(/\D/g, '').length >= 7 ? phone : null;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonContains(polygon, lng, lat) {
  const rings = Array.isArray(polygon) ? polygon : [];
  if (rings.length === 0 || !pointInRing(lng, lat, rings[0])) {
    return false;
  }
  return !rings.slice(1).some((hole) => pointInRing(lng, lat, hole));
}

function geometryContains(geometry, lat, lng) {
  if (!geometry) {
    return false;
  }
  if (geometry.type === 'Polygon') {
    return polygonContains(geometry.coordinates, lng, lat);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => polygonContains(polygon, lng, lat));
  }
  return false;
}

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Trabzone-OSM-Import/1.0 (business data import; contact: trabzoneapp.com)',
      'Accept-Language': 'tr',
    },
  });
  if (response.status === 429 || response.status >= 500) {
    if (attempt >= 3) {
      throw new Error(`nominatim ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    return fetchJson(url, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`nominatim ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

const DISTRICT_ADDRESS_TYPES = new Set([
  'town',
  'city',
  'county',
  'municipality',
  'village',
  'administrative',
]);

function pickAdministrativeFeature(features, fallbackCenter) {
  const candidates = (features ?? []).filter(
    (feature) =>
      feature?.type === 'administrative' &&
      feature?.osm_type === 'relation' &&
      (feature?.geojson?.type === 'Polygon' || feature?.geojson?.type === 'MultiPolygon') &&
      (!feature?.addresstype || DISTRICT_ADDRESS_TYPES.has(feature.addresstype)),
  );
  if (candidates.length === 0) {
    return null;
  }
  if (fallbackCenter) {
    const containing = candidates.find((feature) =>
      geometryContains(feature.geojson, fallbackCenter.lat, fallbackCenter.lng),
    );
    if (containing) {
      return containing;
    }
  }
  return candidates[0];
}

async function loadBoundaries() {
  if (existsSync(BOUNDARY_CACHE)) {
    return JSON.parse(readFileSync(BOUNDARY_CACHE, 'utf8'));
  }
  console.log('Trabzon il/ilçe sınırları alınıyor…');
  const province = await fetchJson(
    'https://nominatim.openstreetmap.org/lookup?osm_ids=R223447&format=jsonv2&polygon_geojson=1',
  );
  const provinceFeature = (province ?? [])[0];
  if (!provinceFeature?.geojson) {
    throw new Error('Trabzon il sınırı alınamadı');
  }
  const districts = [];
  for (const [name, slug] of DISTRICTS) {
    const url =
      'https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=5' +
      `&countrycodes=tr&accept-language=tr&q=${encodeURIComponent(`${name}, Trabzon, Turkey`)}`;
    const features = await fetchJson(url);
    const feature = pickAdministrativeFeature(features);
    if (!feature) {
      throw new Error(`${name} ilçe sınırı alınamadı`);
    }
    districts.push({ name, slug, geojson: feature.geojson, osm_id: feature.osm_id });
    console.log(`  ${name}: relation ${feature.osm_id}`);
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  const result = {
    province: provinceFeature.geojson,
    districts,
    fetched_at: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors — ODbL 1.0',
  };
  mkdirSync(dirname(BOUNDARY_CACHE), { recursive: true });
  writeFileSync(BOUNDARY_CACHE, JSON.stringify(result));
  return result;
}

function transform(element) {
  const tags = element.tags ?? {};
  const name = cleanText(tags['name:tr'] ?? tags.name, 140);
  if (!name || name.length < 2) {
    return null;
  }
  const category = slugFor(tags);
  if (!category) {
    return null;
  }
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return null;
  }
  if (lat < 40.55 || lat > 41.25 || lng < 38.9 || lng > 40.7) {
    return null;
  }
  const street = cleanText(tags['addr:street'], 180);
  const number = cleanText(tags['addr:housenumber'], 20);
  const address =
    cleanText(tags['addr:full'], 400) ??
    (street ? [street, number].filter(Boolean).join(' ').slice(0, 400) : null);

  return {
    name,
    external_id: `${element.type}/${element.id}`,
    lat,
    lng,
    category_slug: category,
    district_slug: null,
    address,
    phone: cleanPhone(tags.phone ?? tags['contact:phone']),
    website: cleanWebsite(tags.website ?? tags['contact:website']),
  };
}

const OVERPASS_QUERY = `[out:json][timeout:280];
(
  nwr["name"]["amenity"~"^(restaurant|fast_food|cafe|bar|pub|bakery|pharmacy|bank|hospital|clinic|doctors|dentist|parking|cinema|theatre|townhall|library|police|post_office|school|university|kindergarten|courthouse)$"](40.55,38.90,41.25,40.70);
  nwr["name"]["shop"~"^(supermarket|convenience|greengrocer|butcher|bakery|clothes|shoes|electronics|mobile_phone|hardware|furniture|jewelry|mall|department_store|hairdresser|car_repair|car_rental|estate_agent|sports)$"](40.55,38.90,41.25,40.70);
  nwr["name"]["tourism"~"^(hotel|guest_house|hostel|motel|apartment|chalet|attraction|museum|viewpoint)$"](40.55,38.90,41.25,40.70);
  nwr["name"]["leisure"~"^(park|garden|playground|fitness_centre|sports_centre)$"](40.55,38.90,41.25,40.70);
);
out tags center;`;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function fetchOverpass() {
  if (existsSync(OVERPASS_CACHE)) {
    console.log('Overpass yanıtı önbellekten okunuyor…');
    return JSON.parse(readFileSync(OVERPASS_CACHE, 'utf8'));
  }
  let lastError = null;
  for (let round = 0; round < 3; round += 1) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 320_000);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Trabzone-OSM-Import/1.0 (business data import)',
          },
          body: new URLSearchParams({ data: OVERPASS_QUERY }),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          lastError = new Error(`overpass ${response.status}: ${text.slice(0, 200)}`);
          console.log(`  ${endpoint} → ${response.status}, deneniyor…`);
          continue;
        }
        const payload = JSON.parse(text);
        mkdirSync(dirname(OVERPASS_CACHE), { recursive: true });
        writeFileSync(OVERPASS_CACHE, text);
        return payload;
      } catch (error) {
        lastError = error;
        console.log(`  ${endpoint} başarısız: ${String(error).slice(0, 160)}`);
      } finally {
        clearTimeout(timer);
      }
    }
    const wait = 10_000 * (round + 1);
    console.log(`Overpass meşgul, ${wait / 1000} sn sonra tekrar denenecek…`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  throw lastError ?? new Error('overpass yanıtı alınamadı');
}

async function runSql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text.slice(0, 800)}`);
  }
  return text;
}

function jsonLiteral(rows) {
  return `$tzjson$${JSON.stringify(rows)}$tzjson$`;
}

function batchSql(rows) {
  const json = jsonLiteral(rows);
  return `begin;
with rows as (
  select * from jsonb_to_recordset(${json}::jsonb) as x(
    name text, external_id text, lat double precision, lng double precision,
    category_slug text, district_slug text, address text, phone text, website text
  )
), prepared as (
  select r.*, c.id as category_id, ci.id as city_id, d.id as district_id
  from rows r
  cross join (select id from public.cities where slug = 'trabzon' limit 1) ci
  join public.place_categories c on c.slug = r.category_slug
  join public.districts d on d.slug = r.district_slug
  where r.lat between 40.55 and 41.25 and r.lng between 38.90 and 40.70
)
insert into public.places (
  name, category_id, city_id, district_id, address, lat, lng, phone, website,
  status, verification_status, data_source, external_provider, external_id
)
select p.name, p.category_id, p.city_id, p.district_id, p.address, p.lat, p.lng,
       p.phone, p.website, 'published', 'unverified', 'external_reference',
       'openstreetmap', p.external_id
from prepared p
where not exists (
  select 1 from public.places existing
  where existing.external_provider = 'openstreetmap' and existing.external_id = p.external_id
);

with rows as (
  select * from jsonb_to_recordset(${json}::jsonb) as x(
    name text, external_id text, lat double precision, lng double precision,
    category_slug text, district_slug text, address text, phone text, website text
  )
)
insert into public.place_category_relations (place_id, category_id)
select p.id, p.category_id
from public.places p
join rows r on r.external_id = p.external_id
where p.external_provider = 'openstreetmap'
on conflict do nothing;

with rows as (
  select * from jsonb_to_recordset(${json}::jsonb) as x(
    name text, external_id text, lat double precision, lng double precision,
    category_slug text, district_slug text, address text, phone text, website text
  )
)
insert into public.place_external_references (
  place_id, provider, external_id, attribution_text, license_note, metadata, raw_content_saved
)
select p.id, 'openstreetmap', p.external_id, '© OpenStreetMap contributors', 'ODbL 1.0',
       jsonb_build_object('osm_type', split_part(p.external_id, '/', 1), 'imported_at', now()),
       false
from public.places p
join rows r on r.external_id = p.external_id
where p.external_provider = 'openstreetmap'
  and not exists (
    select 1 from public.place_external_references ref
    where ref.place_id = p.id and ref.provider = 'openstreetmap'
  );
commit;`;
}

async function countPlaces() {
  const text = await runSql(
    "select json_build_object('places',(select count(*) from public.places),'osm',(select count(*) from public.places where external_provider='openstreetmap'),'refs',(select count(*) from public.place_external_references where provider='openstreetmap')) as counts;",
  );
  return text.trim();
}

async function main() {
  console.log('OpenStreetMap Trabzon içe aktarma başlıyor…');
  const payload = await fetchOverpass();
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const seen = new Set();
  const rows = [];
  for (const element of elements) {
    const row = transform(element);
    if (!row || seen.has(row.external_id)) {
      continue;
    }
    seen.add(row.external_id);
    rows.push(row);
    if (LIMIT && rows.length >= LIMIT) {
      break;
    }
  }
  const boundaries = await loadBoundaries();
  let outside = 0;
  let unassigned = 0;
  const bounded = [];
  for (const row of rows) {
    if (!geometryContains(boundaries.province, row.lat, row.lng)) {
      outside += 1;
      continue;
    }
    const district = boundaries.districts.find((item) =>
      geometryContains(item.geojson, row.lat, row.lng),
    );
    if (!district) {
      unassigned += 1;
      continue;
    }
    bounded.push({ ...row, district_slug: district.slug });
  }

  const byCategory = bounded.reduce((acc, row) => {
    acc[row.category_slug] = (acc[row.category_slug] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `OSM öğesi: ${elements.length}, Trabzon içinde: ${bounded.length} ` +
      `(il dışı: ${outside}, ilçe eşleşmeyen: ${unassigned})`,
  );
  console.log('Kategoriler:', byCategory);

  if (DRY) {
    console.log('Dry-run: veritabanına yazılmadı. Örnek kayıtlar:');
    console.log(bounded.slice(0, 5));
    return;
  }

  if (RESET) {
    console.log('Mevcut OpenStreetMap kayıtları temizleniyor…');
    await runSql("delete from public.places where external_provider = 'openstreetmap';");
  }

  const BATCH = 150;
  for (let index = 0; index < bounded.length; index += BATCH) {
    const batch = bounded.slice(index, index + BATCH);
    process.stdout.write(
      `  ${index + 1}-${Math.min(index + BATCH, bounded.length)} / ${bounded.length}… `,
    );
    await runSql(batchSql(batch));
    console.log('ok');
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  console.log('Veritabanı özeti:', await countPlaces());
}

main().catch((error) => {
  console.error('İçe aktarma başarısız:', error.message);
  process.exit(1);
});
