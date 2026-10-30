// Trabzon il sınırı ve 18 ilçe sınırını OpenStreetMap'ten çekip deprem
// merkezinin bölge tablosuna (`earthquake_regions`) yazan migration'ı üretir.
//
// Kaynak: OpenStreetMap idari sınır ilişkileri (ODbL). İlişki kimlikleri
// Overpass ile doğrulandı (boundary=administrative; il admin_level=4, ilçe
// admin_level=6). Geometri Nominatim `polygon_geojson` çıktısıdır; kullanım
// politikası gereği tek istek atılır ve User-Agent tanımlıdır.
//
// Kullanım: node scripts/earthquake-boundaries.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'supabase', 'migrations', '0191_earthquake_regions_data.sql');
const UA = 'Trabzone-EarthquakeCenter/1.0 (boundary import; https://www.trabzoneapp.com)';

const PROVINCE = { id: 223447, key: 'trabzon', name: 'Trabzon' };
const DISTRICTS = [
  [1236157, 'ortahisar', 'Ortahisar'],
  [1236156, 'akcaabat', 'Akçaabat'],
  [1236151, 'arakli', 'Araklı'],
  [1236155, 'arsin', 'Arsin'],
  [1236144, 'besikduzu', 'Beşikdüzü'],
  [1236159, 'carsibasi', 'Çarşıbaşı'],
  [1236158, 'caykara', 'Çaykara'],
  [1236146, 'dernekpazari', 'Dernekpazarı'],
  [1236145, 'duzkoy', 'Düzköy'],
  [1236143, 'hayrat', 'Hayrat'],
  [1236149, 'koprubasi', 'Köprübaşı'],
  [1236152, 'macka', 'Maçka'],
  [1236154, 'of', 'Of'],
  [1236153, 'surmene', 'Sürmene'],
  [1236160, 'salpazari', 'Şalpazarı'],
  [1236148, 'tonya', 'Tonya'],
  [1236150, 'vakfikebir', 'Vakfıkebir'],
  [1236147, 'yomra', 'Yomra'],
].map(([id, key, name]) => ({ id, key, name }));

async function lookup(ids, threshold) {
  const url = new URL('https://nominatim.openstreetmap.org/lookup');
  url.searchParams.set('osm_ids', ids.map((id) => `R${id}`).join(','));
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('polygon_geojson', '1');
  url.searchParams.set('polygon_threshold', String(threshold));
  const response = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'tr' } });
  if (!response.ok) {
    throw new Error(`nominatim_${response.status}`);
  }
  const data = await response.json();
  const byId = new Map();
  for (const feature of data.features ?? []) {
    byId.set(Number(feature.properties?.osm_id), feature);
  }
  return byId;
}

const round = (value) => Math.round(value * 1e5) / 1e5;

function polygonsOf(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`unexpected_geometry_${geometry?.type}`);
}

function toWkt(geometry) {
  const polygons = polygonsOf(geometry).map(
    (rings) =>
      `(${rings
        .map((ring) => `(${ring.map(([lng, lat]) => `${round(lng)} ${round(lat)}`).join(',')})`)
        .join(',')})`,
  );
  return `MULTIPOLYGON(${polygons.join(',')})`;
}

/** Haritada çizilecek sade dış halka: en büyük poligonun dış sınırı. */
function displayRing(geometry) {
  const polygons = polygonsOf(geometry);
  let best = polygons[0][0];
  for (const rings of polygons) {
    if (rings[0].length > best.length) best = rings[0];
  }
  return best.map(([lng, lat]) => [round(lat), round(lng)]);
}

const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;

const detailed = await lookup([PROVINCE.id, ...DISTRICTS.map((d) => d.id)], 0.0006);
await new Promise((resolve) => setTimeout(resolve, 1500));
const outline = await lookup([PROVINCE.id], 0.006);

const missing = [PROVINCE, ...DISTRICTS].filter((entry) => !detailed.has(entry.id));
if (missing.length > 0 || !outline.has(PROVINCE.id)) {
  throw new Error(`missing_boundaries: ${missing.map((m) => m.name).join(', ')}`);
}

const fetchedAt = new Date().toISOString();
const rows = [
  { ...PROVINCE, kind: 'province', parent: null, feature: detailed.get(PROVINCE.id), ring: displayRing(outline.get(PROVINCE.id).geometry) },
  ...DISTRICTS.map((entry) => {
    const feature = detailed.get(entry.id);
    return { ...entry, kind: 'district', parent: 'trabzon', feature, ring: displayRing(feature.geometry) };
  }),
];

const values = rows
  .map(
    (row) => `  (${sqlText(row.key)}, ${sqlText(row.kind)}, ${sqlText(row.name)}, ${row.parent ? sqlText(row.parent) : 'null'}, ${row.id},
   extensions.ST_Multi(extensions.ST_MakeValid(extensions.ST_GeomFromText(${sqlText(toWkt(row.feature.geometry))}, 4326))),
   ${sqlText(JSON.stringify(row.ring))}::jsonb)`,
  )
  .join(',\n');

const sql = `-- ---------------------------------------------------------------------------
-- 0191 — Deprem merkezi bölge sınırları (Trabzon ili ve 18 ilçe)
--
-- Bu dosya scripts/earthquake-boundaries.mjs tarafından üretildi; elle
-- düzenlenmez. Kaynak: OpenStreetMap idari sınır ilişkileri (© OpenStreetMap
-- katkıda bulunanlar, ODbL). Geometri Nominatim polygon_geojson çıktısıdır.
-- Çekim zamanı: ${fetchedAt}
--
-- İlçe ataması yalnızca bu poligonlara göre yapılır: poligon dışında kalan
-- (ör. deniz açığındaki) olaylar hiçbir ilçeye atanmaz.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

insert into public.earthquake_regions (key, kind, name, parent_key, osm_relation_id, geom, display_ring)
values
${values}
on conflict (key) do update
  set kind = excluded.kind,
      name = excluded.name,
      parent_key = excluded.parent_key,
      osm_relation_id = excluded.osm_relation_id,
      geom = excluded.geom,
      display_ring = excluded.display_ring,
      source = 'OpenStreetMap (ODbL)',
      fetched_at = ${sqlText(fetchedAt)}::timestamptz,
      updated_at = now();

update public.earthquake_regions
   set area_km2 = round((extensions.ST_Area(geom::extensions.geography) / 1e6)::numeric, 1)
 where geom is not null;

-- Bölge değişince geçmiş kayıtlar silinmez; yalnızca sınıflandırma yeniden hesaplanır.
select public.earthquake_reclassify_all();
`;

writeFileSync(OUT, sql, 'utf8');
console.log(`wrote ${OUT}`);
for (const row of rows) {
  console.log(row.kind.padEnd(8), row.name.padEnd(14), 'polygons:', polygonsOf(row.feature.geometry).length, 'ring:', row.ring.length);
}
