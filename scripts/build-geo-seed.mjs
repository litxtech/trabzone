// Geo seed builder — Trabzon il/ilçe/mahalle verisi.
//
// Kaynak: https://turkiyeapi.dev (kamuya açık idari bölünme verisi).
// İlçe merkez koordinatları Mapbox Geocoding ile çözümlenir; mahalle
// koordinatı uydurulmaz, null bırakılır ve haritada ilçe merkezine göre
// gruplanır. Üretilen SQL `supabase/migrations/0047_geo_seed.sql` dosyasına
// yazılır; çalışma zamanında dış servise bağımlılık yoktur.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const token = env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
if (!token) {
  console.error('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN missing');
  process.exit(1);
}

const API = 'https://api.turkiyeapi.dev/v1';
let requestCount = 0;

async function getJson(url) {
  requestCount += 1;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }
  return response.json();
}

async function districtCenter(name) {
  const query = encodeURIComponent(`${name}, Trabzon, Türkiye`);
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json` +
    `?country=tr&language=tr&limit=1&types=place,locality,district&access_token=${token}`;
  const body = await getJson(url);
  const feature = body.features?.[0];
  if (!feature?.center) {
    return null;
  }
  return { lng: Number(feature.center[0]), lat: Number(feature.center[1]), label: feature.place_name };
}

const sqlString = (value) => (value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`);
const sqlNumber = (value) => (value == null || Number.isNaN(value) ? 'null' : String(value));

const provinceId = 61;
const province = (await getJson(`${API}/provinces?name=trabzon`)).data?.[0];
if (!province) {
  throw new Error('Trabzon province not found');
}

const districtBody = await getJson(`${API}/districts?provinceId=${provinceId}`);
const districts = districtBody.data ?? [];

const districtRows = [];
const neighborhoodRows = [];

for (const district of districts) {
  const center = await districtCenter(district.name);
  districtRows.push({
    id: district.id,
    name: district.name,
    population: district.population ?? null,
    area: district.area ?? null,
    lat: center?.lat ?? null,
    lng: center?.lng ?? null,
    geocodeLabel: center?.label ?? null,
  });

  const hoods = await getJson(`${API}/neighborhoods?districtId=${district.id}`);
  for (const hood of hoods.data ?? []) {
    neighborhoodRows.push({
      id: hood.id,
      districtId: district.id,
      name: hood.name,
      population: hood.population ?? null,
    });
  }
  process.stdout.write(`  ${district.name}: ${(hoods.data ?? []).length} mahalle\n`);
}

const lines = [];
lines.push('-- 0047_geo_seed.sql');
lines.push('-- OTOMATİK ÜRETİLDİ: scripts/build-geo-seed.mjs');
lines.push('--');
lines.push('-- Kaynak: turkiyeapi.dev (Trabzon ili idari bölünme verisi, kamuya açık).');
lines.push('-- İlçe merkez koordinatları Mapbox Geocoding ile çözümlendi.');
lines.push('-- Mahalle koordinatları UYDURULMADI; bilinmediği için null bırakıldı.');
lines.push('-- Mahalleler ilçe merkezi referansıyla gösterilir.');
lines.push('');
lines.push('set search_path = public, extensions;');
lines.push('');
lines.push('insert into public.cities (plate_code, name, slug, country_code, timezone, center_lat, center_lng, is_active, data_source)');
lines.push(
  `values (61, 'Trabzon', 'trabzon', 'TR', 'Europe/Istanbul', 41.0027, 39.7168, true, 'turkiyeapi.dev')`,
);
lines.push('on conflict (plate_code) do update');
lines.push('  set name = excluded.name, slug = excluded.slug, is_active = true;');
lines.push('');
lines.push('insert into public.districts (id, city_id, name, slug, population, area_km2, center_lat, center_lng, geocode_label, data_source)');
lines.push('select v.id, c.id, v.name, v.slug, v.population, v.area_km2, v.center_lat, v.center_lng, v.geocode_label, v.data_source');
lines.push('from (values');
const districtValues = districtRows.map((row) => {
  const slug = row.name
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replaceAll('ş', 's')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `  (${row.id}::bigint, ${sqlString(row.name)}, ${sqlString(slug)}, ${sqlNumber(row.population)}, ${sqlNumber(row.area)}, ${sqlNumber(row.lat)}, ${sqlNumber(row.lng)}, ${sqlString(row.geocodeLabel)}, 'turkiyeapi.dev'::text)`;
});
lines.push(districtValues.join(',\n'));
lines.push(") as v(id, name, slug, population, area_km2, center_lat, center_lng, geocode_label, data_source)");
lines.push("join public.cities c on c.plate_code = 61");
lines.push('on conflict (id) do update set');
lines.push('  name = excluded.name, slug = excluded.slug, population = excluded.population,');
lines.push('  area_km2 = excluded.area_km2, center_lat = excluded.center_lat,');
lines.push('  center_lng = excluded.center_lng, geocode_label = excluded.geocode_label;');
lines.push('');
lines.push('-- Mahalleler (ilçe id -> public.districts.id)');
lines.push('insert into public.neighborhoods (id, district_id, name, slug, population, data_source)');
lines.push('select v.id, v.district_id, v.name, v.slug, v.population, v.data_source');
lines.push('from (values');

const usedSlugs = new Map();
const neighborhoodValues = neighborhoodRows.map((row) => {
  const base = row.name
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replaceAll('ş', 's')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const key = `${row.districtId}:${base}`;
  const seen = usedSlugs.get(key) ?? 0;
  usedSlugs.set(key, seen + 1);
  const slug = seen === 0 ? base : `${base}-${seen + 1}`;
  return `  (${row.id}::bigint, ${row.districtId}::bigint, ${sqlString(row.name)}, ${sqlString(slug)}, ${sqlNumber(row.population)}, 'turkiyeapi.dev'::text)`;
});
lines.push(neighborhoodValues.join(',\n'));
lines.push(') as v(id, district_id, name, slug, population, data_source)');
lines.push('on conflict (id) do update set');
lines.push('  name = excluded.name, slug = excluded.slug, population = excluded.population;');
lines.push('');
lines.push('-- Hizmet bölgesi kaydı (il/ilçe verisi yüklendikten sonra).');
lines.push('insert into public.service_regions (city_id, name, is_active, launch_phase, min_lat, max_lat, min_lng, max_lng, notes)');
lines.push("select c.id, 'Trabzon', true, 'phase_1', 40.55, 41.25, 38.90, 40.70,");
lines.push("       'İl sınırı değil; hizmet bölgesi dışına taşan kayıtları reddeden sunucu tarafı kutudur.'");
lines.push('from public.cities c where c.plate_code = 61');
lines.push('on conflict (city_id) do update set');
lines.push('  name = excluded.name, is_active = true, min_lat = excluded.min_lat,');
lines.push('  max_lat = excluded.max_lat, min_lng = excluded.min_lng, max_lng = excluded.max_lng;');
lines.push('');
lines.push('-- Kaynak atfı ve veri sağlığı için görünüm.');
lines.push('comment on table public.neighborhoods is');
lines.push("  'Trabzon mahalleleri. Kaynak: turkiyeapi.dev. Koordinat bilinmediği için center_lat/lng null.';");
lines.push('');

const out = join(root, 'supabase', 'migrations', '0047_geo_seed.sql');
writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`wrote ${out} — ${districtRows.length} ilçe, ${neighborhoodRows.length} mahalle, ${requestCount} istek`);
