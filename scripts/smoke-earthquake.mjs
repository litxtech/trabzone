// Deprem Merkezi canlı smoke testi.
//
// Yalnızca herkese açık (publishable/anon) anahtarla, istemcinin gönderdiği
// parametrelerin aynısıyla public RPC'leri çağırır; yanıt alanlarını
// `src/features/earthquake/types.ts` ile karşılaştırır ve anonim erişimin
// yasak olması gereken uçlarda reddedildiğini doğrular. Veri yazmaz.
//
//   node scripts/smoke-earthquake.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
);
const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('EXPO_PUBLIC_SUPABASE_URL ve publishable/anon anahtar gerekli.');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function rpc(name, args = {}) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function missingKeys(object, keys) {
  if (!object || typeof object !== 'object') return keys;
  return keys.filter((k) => !(k in object));
}

const EVENT_KEYS = [
  'id', 'occurred_at', 'latitude', 'longitude', 'depth_km', 'magnitude', 'magnitude_type', 'location',
  'distance_km', 'in_province', 'district_key', 'district_name', 'region_classification', 'source', 'sources',
  'revision', 'updated_at', 'first_seen_at',
];
const filters = (region, extra = {}) => ({
  p_region: region, p_district: null, p_from: null, p_to: null, p_min_mag: null, p_max_mag: null, p_source: 'all', ...extra,
});
const feedArgs = (region, extra = {}) => ({
  ...filters(region), p_min_depth: null, p_max_depth: null, p_order: 'newest', p_limit: 20, p_offset: 0, ...extra,
});

// 1) Bootstrap
const boot = await rpc('earthquake_bootstrap');
check('bootstrap 200', boot.status === 200, `status ${boot.status}`);
const bootMissing = missingKeys(boot.body, ['settings', 'districts', 'province_ring', 'boundary_attribution', 'sources', 'coverage', 'status']);
check('bootstrap alanları', bootMissing.length === 0, bootMissing.join(', '));
check('18 ilçe', Array.isArray(boot.body?.districts) && boot.body.districts.length === 18, `${boot.body?.districts?.length}`);
check('il sınırı halkası', Array.isArray(boot.body?.province_ring) && boot.body.province_ring.length > 10, `${boot.body?.province_ring?.length} nokta`);
check('veri durumu', ['live', 'fallback', 'delayed', 'unavailable'].includes(boot.body?.status?.state), boot.body?.status?.state);
check('AFAD birincil', boot.body?.sources?.some((s) => s.key === 'afad' && s.is_primary), '');
const districtKey = boot.body?.districts?.[0]?.key ?? null;

// 2) Bölge özetleri
for (const region of ['province', 'r50', 'r100', 'r150', 'r250', 'turkey']) {
  const overview = await rpc('earthquake_overview', filters(region));
  const miss = missingKeys(overview.body, ['region', 'district', 'from', 'to', 'count_24h', 'count_range', 'max_event', 'latest_event', 'status']);
  check(`overview ${region}`, overview.status === 200 && miss.length === 0, overview.status === 200 ? `24s=${overview.body.count_24h} aralık=${overview.body.count_range}` : JSON.stringify(overview.body).slice(0, 160));
}
const districtOverview = await rpc('earthquake_overview', filters('province', { p_district: districtKey }));
check('overview ilçe', districtOverview.status === 200, `${districtKey} → ${districtOverview.body?.count_range ?? JSON.stringify(districtOverview.body).slice(0, 120)}`);
const badRegion = await rpc('earthquake_overview', filters('mars'));
check('geçersiz bölge reddedilir', badRegion.status >= 400, `status ${badRegion.status}`);

// 3) Liste: sıralamalar, büyüklük aralıkları, kaynak filtresi
let sampleId = null;
for (const order of ['newest', 'oldest', 'largest', 'nearest']) {
  const feed = await rpc('earthquake_feed', feedArgs('r250', { p_order: order }));
  const items = feed.body?.items ?? [];
  const miss = items[0] ? missingKeys(items[0], EVENT_KEYS) : [];
  let sorted = true;
  for (let i = 1; i < items.length; i += 1) {
    const a = items[i - 1];
    const b = items[i];
    if (order === 'newest' && Date.parse(a.occurred_at) < Date.parse(b.occurred_at)) sorted = false;
    if (order === 'oldest' && Date.parse(a.occurred_at) > Date.parse(b.occurred_at)) sorted = false;
    if (order === 'largest' && a.magnitude < b.magnitude) sorted = false;
    if (order === 'nearest' && a.distance_km > b.distance_km) sorted = false;
  }
  check(
    `feed sıralama ${order}`,
    feed.status === 200 && miss.length === 0 && sorted,
    feed.status === 200 ? `${items.length}/${feed.body.total} kayıt${miss.length ? ` eksik: ${miss.join(',')}` : ''}${sorted ? '' : ' SIRA HATALI'}` : JSON.stringify(feed.body).slice(0, 160),
  );
  if (!sampleId && items[0]) sampleId = items[0].id;
}
for (const [min, max] of [[null, 1.9], [2, 2.9], [3, 3.9], [4, 4.9], [5, null]]) {
  const feed = await rpc('earthquake_feed', feedArgs('turkey', { p_min_mag: min, p_max_mag: max, p_limit: 50 }));
  const items = feed.body?.items ?? [];
  const inRange = items.every((e) => (min == null || e.magnitude >= min) && (max == null || e.magnitude <= max));
  check(`feed büyüklük ${min ?? '…'}–${max ?? '…'}`, feed.status === 200 && inRange, `${feed.body?.total ?? feed.status} kayıt`);
}
for (const source of ['afad', 'usgs']) {
  const feed = await rpc('earthquake_feed', feedArgs('turkey', { p_source: source, p_limit: 50 }));
  const items = feed.body?.items ?? [];
  check(`feed kaynak ${source}`, feed.status === 200 && items.every((e) => e.sources.includes(source)), `${feed.body?.total ?? feed.status} kayıt`);
}
const r150 = await rpc('earthquake_feed', feedArgs('r150', { p_limit: 200 }));
check('150 km filtresi', r150.status === 200 && (r150.body.items ?? []).every((e) => e.distance_km <= 150), `${r150.body?.total} kayıt`);
const prov = await rpc('earthquake_feed', feedArgs('province', { p_limit: 200 }));
check('il sınırı filtresi', prov.status === 200 && (prov.body.items ?? []).every((e) => e.in_province), `${prov.body?.total} kayıt`);
const offshoreWithDistrict = [...(r150.body?.items ?? []), ...(prov.body?.items ?? [])].filter(
  (e) => e.region_classification === 'trabzon_offshore' && e.district_key,
);
check('açık deniz olayına ilçe atanmaz', offshoreWithDistrict.length === 0, `${offshoreWithDistrict.length} ihlal`);
const badOrder = await rpc('earthquake_feed', feedArgs('r150', { p_order: 'random' }));
check('geçersiz sıralama reddedilir', badOrder.status >= 400, `status ${badOrder.status}`);
const badRange = await rpc('earthquake_feed', feedArgs('r150', { p_from: '2026-10-10T00:00:00Z', p_to: '2026-10-01T00:00:00Z' }));
check('ters tarih aralığı reddedilir', badRange.status >= 400, `status ${badRange.status}`);

// 4) Harita ve analiz
const map = await rpc('earthquake_map', filters('r250'));
const firstPoint = map.body?.points?.[0];
check('harita', map.status === 200 && Array.isArray(map.body?.points) && (!firstPoint || firstPoint.length >= 10), `${map.body?.points?.length ?? map.status} nokta, truncated=${map.body?.truncated}`);
const analytics = await rpc('earthquake_analytics', filters('r250'));
const aMiss = missingKeys(analytics.body, ['region', 'from', 'to', 'bucket', 'total', 'series', 'magnitude_bins', 'depth_bins', 'unknown_depth', 'points', 'points_truncated', 'grid_cell_deg', 'grid']);
check('analiz', analytics.status === 200 && aMiss.length === 0, analytics.status === 200 ? `toplam ${analytics.body.total}, kova ${analytics.body.bucket}` : JSON.stringify(analytics.body).slice(0, 160));
if (analytics.status === 200) {
  const binTotal = analytics.body.magnitude_bins.reduce((s, b) => s + b.count, 0);
  check('analiz büyüklük dağılımı toplamı', binTotal === analytics.body.total, `${binTotal} / ${analytics.body.total}`);
}

// 5) Detay, paylaşım, bölge şekli
if (sampleId) {
  const detail = await rpc('earthquake_detail', { p_key: sampleId });
  const dMiss = missingKeys(detail.body, [...EVENT_KEYS, 'requested_key', 'status', 'records', 'revisions', 'attribution']);
  check('detay', detail.status === 200 && dMiss.length === 0, detail.status === 200 ? `${sampleId}, ${detail.body.records.length} kaynak kaydı` : JSON.stringify(detail.body).slice(0, 160));
  const card = await rpc('earthquake_share_card', { p_key: sampleId });
  check('paylaşım kartı', card.status === 200 && card.body?.path === `/deprem/${sampleId}`, card.body?.title ?? '');
} else {
  check('detay', false, 'örnek kayıt yok');
}
const missing = await rpc('earthquake_detail', { p_key: 'afad-999999999' });
check('olmayan kayıt güvenli hata', missing.status >= 400 && JSON.stringify(missing.body).includes('earthquake_not_found'), `status ${missing.status}`);
const injected = await rpc('earthquake_detail', { p_key: "afad-1' or '1'='1" });
check('hatalı anahtar reddedilir', injected.status >= 400, `status ${injected.status}`);
const shape = await rpc('earthquake_region_shape', { p_key: districtKey ?? 'province' });
check('ilçe sınırı', shape.status === 200 && Array.isArray(shape.body?.ring), `${shape.body?.ring?.length ?? shape.status} nokta`);

// 6) Anonim erişimin yasak olduğu uçlar
const denied = [
  ['earthquake_prefs_get', {}],
  ['earthquake_notification_history', { p_limit: 5, p_offset: 0 }],
  ['earthquake_admin_overview', {}],
  ['earthquake_admin_test_push', { p_note: null }],
  ['earthquake_ingest', { p_source: 'afad', p_records: [] }],
];
for (const [name, args] of denied) {
  const response = await rpc(name, args);
  check(`anonim engeli: ${name}`, response.status >= 400, `status ${response.status}`);
}
for (const table of ['earthquake_events', 'earthquake_source_records', 'earthquake_user_preferences', 'earthquake_notification_deliveries', 'earthquake_admin_audit_logs']) {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
  check(`anonim tablo engeli: ${table}`, response.status >= 400, `status ${response.status}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} geçti`);
process.exit(failed.length ? 1 : 0);
