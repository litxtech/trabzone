// Deprem kaynak ayrıştırıcısı birim testleri.
// Çalıştırma: node --experimental-strip-types scripts/test-earthquake-parser.mjs
// Ağ gerektirmez; fixture'lar canlı AFAD/USGS yanıtlarından alınmış alan
// biçimlerini (tüm alanlar metin, UTC tarih) birebir taklit eder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  afadDateToIso,
  afadUrl,
  backoffMs,
  chunk,
  expoMessage,
  parseAfad,
  parseUsgs,
  ticketToReport,
  usgsUrl,
} from '../supabase/functions/_shared/earthquake.ts';

const NOW = Date.parse('2026-10-28T22:30:00Z');

const afadRecord = (overrides = {}) => ({
  rms: '0.39',
  eventID: '597506',
  location: 'Karadeniz - [04.52 km] Araklı (Trabzon)',
  latitude: '40.9775',
  longitude: '40.07867',
  depth: '6.54',
  type: 'ML',
  magnitude: '1.6',
  country: null,
  province: 'Trabzon',
  district: 'Araklı',
  neighborhood: null,
  date: '2026-10-27T08:14:12',
  isEventUpdate: false,
  lastUpdateDate: null,
  ...overrides,
});

test('AFAD tarihi UTC olarak yorumlanır', () => {
  assert.equal(afadDateToIso('2026-10-26T13:20:03'), '2026-10-26T13:20:03.000Z');
  assert.equal(afadDateToIso('2026-10-23T14:41:35.18698'), '2026-10-23T14:41:35.186Z');
  assert.equal(afadDateToIso('26.10.2026 13:20'), null);
  assert.equal(afadDateToIso(null), null);
});

test('AFAD geçerli kayıt metin alanlardan sayıya çevrilir', () => {
  const { records, rejected, received } = parseAfad([afadRecord()], NOW);
  assert.equal(received, 1);
  assert.equal(rejected.length, 0);
  const [q] = records;
  assert.equal(q.source_event_id, '597506');
  assert.equal(q.occurred_at, '2026-10-27T08:14:12.000Z');
  assert.equal(q.latitude, 40.9775);
  assert.equal(q.longitude, 40.07867);
  assert.equal(q.depth_km, 6.54);
  assert.equal(q.magnitude, 1.6);
  assert.equal(q.magnitude_type, 'ML');
  assert.equal(q.district, 'Araklı');
  assert.equal(q.url, 'https://deprem.afad.gov.tr/event-detail/597506');
  assert.equal(q.source_status, null);
});

test('AFAD küçük ve negatif büyüklükler korunur', () => {
  const { records } = parseAfad(
    [afadRecord({ eventID: '1', magnitude: '0.6' }), afadRecord({ eventID: '2', magnitude: '-0.4' })],
    NOW,
  );
  assert.deepEqual(records.map((r) => r.magnitude), [0.6, -0.4]);
});

test('AFAD bozuk kayıtlar gerekçeyle reddedilir, uydurma değer üretilmez', () => {
  const { records, rejected } = parseAfad(
    [
      afadRecord({ eventID: '' }),
      afadRecord({ eventID: '10', latitude: 'abc' }),
      afadRecord({ eventID: '11', magnitude: null }),
      afadRecord({ eventID: '12', date: '2026-13-45' }),
      afadRecord({ eventID: '13', latitude: '95' }),
      afadRecord({ eventID: '14', depth: '900' }),
      afadRecord({ eventID: '15', date: '2026-10-29T03:00:00' }),
      afadRecord({ eventID: '16', latitude: '0', longitude: '0' }),
      afadRecord({ eventID: '17', depth: 'x' }),
      afadRecord({ eventID: '18' }),
      afadRecord({ eventID: '18' }),
    ],
    NOW,
  );
  assert.equal(records.length, 1);
  assert.deepEqual(
    rejected.map((r) => r.reason),
    [
      'missing_event_id',
      'invalid_coordinates',
      'missing_magnitude',
      'invalid_time',
      'coordinates_out_of_range',
      'depth_out_of_range',
      'time_in_future',
      'null_island',
      'invalid_depth',
      'duplicate_in_payload',
    ],
  );
});

test('AFAD eksik derinlik null kalır', () => {
  const { records } = parseAfad([afadRecord({ depth: null })], NOW);
  assert.equal(records[0].depth_km, null);
});

test('AFAD revizyon bilgisi ve güncelleme zamanı okunur', () => {
  const { records } = parseAfad(
    [afadRecord({ isEventUpdate: true, lastUpdateDate: '2026-10-23T14:41:35.18698' })],
    NOW,
  );
  assert.equal(records[0].source_status, 'updated');
  assert.equal(records[0].source_updated_at, '2026-10-23T14:41:35.186Z');
});

test('AFAD şeması dizi değilse hata fırlatılır (veri yazılmaz)', () => {
  assert.throws(() => parseAfad({ status: 400, error: 'Parameter Exception' }), /afad_schema_not_array/);
});

const usgsFeature = (overrides = {}, props = {}) => ({
  type: 'Feature',
  id: 'us6000u4zm',
  properties: {
    mag: 4.4,
    place: '50 km SSE of Kárpathos, Greece',
    time: Date.parse('2026-10-26T13:20:02.823Z'),
    updated: Date.parse('2026-10-26T14:01:00.000Z'),
    status: 'reviewed',
    type: 'earthquake',
    magType: 'mb',
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u4zm',
    net: 'us',
    code: '6000u4zm',
    rms: 0.71,
    ...props,
  },
  geometry: { type: 'Point', coordinates: [25.9536, 35.0335, 10] },
  ...overrides,
});

test('USGS GeoJSON normalize edilir', () => {
  const { records, rejected } = parseUsgs({ type: 'FeatureCollection', features: [usgsFeature()] }, NOW);
  assert.equal(rejected.length, 0);
  const [q] = records;
  assert.equal(q.source_event_id, 'us6000u4zm');
  assert.equal(q.occurred_at, '2026-10-26T13:20:02.823Z');
  assert.equal(q.latitude, 35.0335);
  assert.equal(q.longitude, 25.9536);
  assert.equal(q.depth_km, 10);
  assert.equal(q.magnitude, 4.4);
  assert.equal(q.magnitude_type, 'mb');
  assert.equal(q.source_status, 'reviewed');
});

test('USGS deprem olmayan olaylar ve büyüklüksüz kayıtlar reddedilir', () => {
  const { records, rejected } = parseUsgs(
    {
      type: 'FeatureCollection',
      features: [usgsFeature({ id: 'a' }, { type: 'quarry blast' }), usgsFeature({ id: 'b' }, { mag: null })],
    },
    NOW,
  );
  assert.equal(records.length, 0);
  assert.deepEqual(rejected.map((r) => r.reason), ['not_earthquake', 'missing_magnitude']);
});

test('USGS şema uyuşmazlığı hata fırlatır', () => {
  assert.throws(() => parseUsgs([]), /usgs_schema_not_feature_collection/);
});

test('AFAD sorgusu bbox ve 1000 sınırı ile kurulur (radyal filtre kullanılmaz)', () => {
  const url = new URL(afadUrl({ start: new Date('2026-10-28T20:00:00Z'), end: new Date('2026-10-28T22:40:00Z'), limit: 5000 }));
  assert.equal(url.searchParams.get('start'), '2026-10-28T20:00:00');
  assert.equal(url.searchParams.get('end'), '2026-10-28T22:40:00');
  assert.equal(url.searchParams.get('limit'), '1000');
  assert.equal(url.searchParams.get('minlat'), '34');
  assert.equal(url.searchParams.get('maxrad'), null);
  assert.equal(url.searchParams.get('format'), 'json');
});

test('USGS sorgusu yalnızca deprem türünü ister', () => {
  const url = new URL(usgsUrl({ start: new Date('2026-10-28T00:00:00Z'), end: new Date('2026-10-28T06:00:00Z') }));
  assert.equal(url.searchParams.get('eventtype'), 'earthquake');
  assert.equal(url.searchParams.get('format'), 'geojson');
});

test('Expo mesajı standart önceliklidir; kritik uyarı alanı yoktur', () => {
  const base = {
    delivery_id: 'd1',
    token: 'ExponentPushToken[abcdefghijklmnop]',
    platform: 'ios',
    title: 'Trabzone Deprem Merkezi',
    body: 'x',
    data: { route: '/deprem/afad-597506' },
    sound: true,
    is_test: false,
  };
  const normal = expoMessage({ ...base, priority: 'normal' });
  const high = expoMessage({ ...base, priority: 'high' });
  assert.equal(normal.priority, 'default');
  assert.equal(normal.channelId, 'earthquake');
  assert.equal(high.priority, 'high');
  assert.equal(high.channelId, 'earthquake-important');
  assert.equal('interruptionLevel' in high, false);
  assert.equal('critical' in high, false);
  assert.equal(expoMessage({ ...base, priority: 'normal', sound: false }).sound, null);
});

test('Expo ticket sonuçları doğru sınıflanır', () => {
  assert.deepEqual(ticketToReport('d', { status: 'ok', id: 't1' }), { delivery_id: 'd', ok: true, ticket_id: 't1' });
  const invalid = ticketToReport('d', { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } });
  assert.equal(invalid.error, 'DeviceNotRegistered');
  assert.equal(invalid.retryable, false);
  assert.equal(ticketToReport('d', { status: 'error', details: { error: 'MessageRateExceeded' } }).retryable, true);
  assert.equal(ticketToReport('d', undefined).retryable, true);
});

test('Yardımcılar: parça ve geri çekilme', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual([1, 2, 3, 4, 5].map(backoffMs), [1000, 2000, 4000, 8000, 8000]);
});
