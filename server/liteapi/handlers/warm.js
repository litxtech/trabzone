/**
 * Fiyat ısıtma (önbellek tazeleme) uç noktası.
 *
 *   GET/POST /api/liteapi-warm?limit=12&nights=2&secret=...
 *
 * Yayınlanmış sağlayıcı tesisleri için varsayılan tarih aralığında fiyatları
 * yeniden çeker ve 5 dakikalık önbelleğe yazar. Böylece misafir sayfayı
 * açtığında liste beklemeden gelir.
 *
 * Erişim: `x-sync-secret` başlığı veya `?secret=` parametresi
 * `LITEAPI_SYNC_SECRET` ile eşleşmeli; ya da yönetici JWT'si gönderilmeli.
 * Zamanlayıcı (dış cron) için ortam değişkeni yeterlidir.
 */

const { searchPropertyRates } = require('../booking');
const { isConfigured, config } = require('../config');
const { defaultStay } = require('../dates');
const { serviceRpc, verifyAdmin } = require('../supabase');
const { sendJson, clientIp, createRateLimiter } = require('../../http-utils');

const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 6 });

function readParam(req, name) {
  const value = req.query?.[name];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

async function authorize(req) {
  const secret = (process.env.LITEAPI_SYNC_SECRET || '').trim();
  const provided =
    (typeof req.headers['x-sync-secret'] === 'string' ? req.headers['x-sync-secret'] : '') ||
    readParam(req, 'secret');
  if (secret && provided && provided === secret) {
    return { ok: true, via: 'sync_secret' };
  }
  return verifyAdmin(req);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
    return;
  }

  if (!isConfigured()) {
    sendJson(res, 503, { ok: false, reason: 'not_configured' });
    return;
  }

  if (isRateLimited(clientIp(req))) {
    res.setHeader('Retry-After', '60');
    sendJson(res, 429, { ok: false, reason: 'rate_limited' });
    return;
  }

  const auth = await authorize(req);
  if (!auth.ok) {
    sendJson(res, 401, { ok: false, reason: auth.reason });
    return;
  }

  const limit = Math.max(1, Math.min(50, Math.trunc(Number(readParam(req, 'limit')) || 12)));
  const nights = Math.max(1, Math.min(30, Math.trunc(Number(readParam(req, 'nights')) || 2)));
  const stay = defaultStay({ nights });
  const adults = Math.max(1, Math.min(12, Math.trunc(Number(readParam(req, 'adults')) || 2)));

  let targets;
  try {
    targets = await serviceRpc('acc_liteapi_warm_targets', { p_limit: limit });
  } catch (cause) {
    console.error('[liteapi-warm] targets', cause && cause.message ? cause.message : cause);
    sendJson(res, 502, { ok: false, reason: 'targets_failed' });
    return;
  }

  const items = Array.isArray(targets) ? targets : [];
  const results = [];
  let refreshed = 0;
  let cached = 0;
  let failed = 0;

  for (const target of items) {
    const propertyId = target?.property_id;
    if (!propertyId) continue;
    try {
      const result = await searchPropertyRates({
        propertyId,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        adults,
        children: 0,
        currency: config.defaultCurrency,
        refresh: true,
      });
      if (result.cached) cached += 1;
      else refreshed += 1;
      results.push({
        propertyId,
        name: target.name ?? null,
        offers: result.offers.length,
        cached: Boolean(result.cached),
      });
    } catch (cause) {
      failed += 1;
      results.push({
        propertyId,
        name: target.name ?? null,
        error: cause && cause.code ? cause.code : 'failed',
      });
    }
  }

  sendJson(res, 200, {
    ok: true,
    stay: { checkIn: stay.checkIn, checkOut: stay.checkOut, nights: stay.nights, adults },
    totals: { targets: items.length, refreshed, cached, failed },
    results,
  });
};
