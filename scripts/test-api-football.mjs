// API-Football yardımcıları birim testleri.
// Çalıştırma: node --experimental-strip-types scripts/test-api-football.mjs
// Ağ gerektirmez; zarflar sağlayıcının belgelenmiş yanıt biçimini taklit eder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  apiErrorMessages,
  buildUrl,
  classifyApiErrors,
  finishedFixtureIds,
  idsParam,
  parseEnvelope,
  quotaFromHeaders,
  quotaFromStatus,
  sportsExpoMessage,
} from '../supabase/functions/_shared/api-football.ts';

const envelope = (response, errors = []) => ({
  get: 'fixtures',
  parameters: { ids: '1-2' },
  errors,
  results: Array.isArray(response) ? response.length : 1,
  paging: { current: 1, total: 1 },
  response,
});

test('başarılı zarf yanıtı ve sayfa bilgisini döndürür', () => {
  const parsed = parseEnvelope(200, envelope([{ fixture: { id: 1 } }]));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.results, 1);
  assert.deepEqual(parsed.paging, { current: 1, total: 1 });
});

test('HTTP 200 olsa bile errors doluysa başarısızdır', () => {
  const parsed = parseEnvelope(200, envelope([], { token: 'Error/Missing application key.' }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.kind, 'auth');
  assert.equal(parsed.retryable, false);
});

test('günlük kota aşımı quota olarak sınıflanır', () => {
  const errors = { requests: 'You have reached the request limit for the day, Go to https://dashboard.api-football.com' };
  assert.equal(classifyApiErrors(errors), 'quota');
  const parsed = parseEnvelope(200, envelope([], errors));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.kind, 'quota');
});

test('dakikalık limit yeniden denenebilir', () => {
  const parsed = parseEnvelope(200, envelope([], { rateLimit: 'Too many requests. Your rate limit is 10 requests per minute.' }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.kind, 'rate_limited');
  assert.equal(parsed.retryable, true);
  assert.equal(parseEnvelope(429, null).retryable, true);
});

test('plan kapsamı dışındaki sezon plan hatasıdır', () => {
  assert.equal(classifyApiErrors({ plan: 'Free plans do not have access to this season, try from 2021 to 2023.' }), 'plan');
});

test('boş errors dizisi ve nesnesi hata sayılmaz', () => {
  assert.deepEqual(apiErrorMessages([]), []);
  assert.deepEqual(apiErrorMessages({}), []);
  assert.equal(parseEnvelope(200, envelope([])).ok, true);
});

test('5xx ve geçersiz gövde başarısızdır', () => {
  assert.equal(parseEnvelope(503, null).retryable, true);
  assert.equal(parseEnvelope(200, 'html').ok, false);
  assert.equal(parseEnvelope(200, { errors: [] }).ok, false);
});

test('kota başlıkları sayıya çevrilir, eksikler atlanır', () => {
  const headers = new Headers({
    'x-ratelimit-requests-limit': '7500',
    'x-ratelimit-requests-remaining': '7212',
    'X-RateLimit-Limit': '450',
  });
  assert.deepEqual(quotaFromHeaders(headers), { limit_day: 7500, remaining_day: 7212, limit_minute: 450 });
  assert.deepEqual(quotaFromHeaders(new Headers()), {});
});

test('/status kişisel bilgileri dışarıda bırakır', () => {
  const status = quotaFromStatus({
    account: { firstname: 'Ad', lastname: 'Soyad', email: 'gizli@example.com' },
    subscription: { plan: 'Pro', end: '2027-01-01T00:00:00+00:00', active: true },
    requests: { current: 120, limit_day: 7500 },
  });
  assert.equal(status.plan, 'Pro');
  assert.equal(status.remaining_day, 7380);
  assert.deepEqual(status.account, { plan: 'Pro', active: true, end: '2027-01-01T00:00:00+00:00' });
  assert.equal(JSON.stringify(status).includes('gizli@example.com'), false);
});

test('ids parametresi tekil, pozitif ve en fazla 20 kimlik içerir', () => {
  const ids = Array.from({ length: 25 }, (_, index) => index + 1);
  assert.equal(idsParam([...ids, 3, -900001]).split('-').length, 20);
  assert.equal(idsParam([5, 5, 7, -1]), '5-7');
});

test('URL boş parametreleri atlar', () => {
  assert.equal(
    buildUrl('https://v3.football.api-sports.io/', '/fixtures', { team: 998, season: 2026, league: undefined, x: '' }),
    'https://v3.football.api-sports.io/fixtures?team=998&season=2026',
  );
});

test('bitmiş maçlar son doğrulama için ayıklanır', () => {
  const response = [
    { fixture: { id: 10, status: { short: 'FT' } } },
    { fixture: { id: 11, status: { short: '2H' } } },
    { fixture: { id: 12, status: { short: 'PEN' } } },
  ];
  assert.deepEqual(finishedFixtureIds(response), [10, 12]);
  assert.deepEqual(finishedFixtureIds(null), []);
});

test('push mesajı sports kanalını ve öncelikleri kullanır', () => {
  const base = { delivery_id: 'd', token: 'ExponentPushToken[x]', platform: 'ios', title: 'GOL', body: 'b', data: null, sound: true, is_test: false };
  const goal = sportsExpoMessage({ ...base, kind: 'goal_for' });
  assert.equal(goal.channelId, 'sports');
  assert.equal(goal.priority, 'high');
  assert.equal(goal.ttl, 900);
  assert.equal(goal.sound, 'default');
  const reminder = sportsExpoMessage({ ...base, kind: 'reminder', sound: false });
  assert.equal(reminder.priority, 'default');
  assert.equal(reminder.sound, null);
  assert.equal(sportsExpoMessage({ ...base, kind: 'test', is_test: true }).ttl, 600);
});
