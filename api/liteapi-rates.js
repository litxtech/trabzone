/**
 * LiteAPI canlı fiyat / müsaitlik sorgusu.
 *
 *   POST /api/liteapi-rates
 *   { propertyId, checkIn: 'YYYY-MM-DD', checkOut, adults, children,
 *     childrenAges?: number[], currency?: 'TRY', refresh?: boolean }
 *
 * Herkese açıktır (tesis detayı için) ama IP başına dakikada 30 istekle
 * sınırlıdır ve sonuçlar veritabanında 5 dakika önbelleklenir. API anahtarı
 * istemciye hiçbir zaman dönmez.
 */

const { searchPropertyRates } = require('../server/liteapi/booking');
const { isConfigured } = require('../server/liteapi/config');
const { sendJson, readJsonBody, clientIp, createRateLimiter } = require('../server/http-utils');

const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 30 });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
    return;
  }

  if (!isConfigured()) {
    sendJson(res, 503, {
      ok: false,
      reason: 'not_configured',
      message: 'Sunucuda LITEAPI_API_KEY tanımlı değil.',
    });
    return;
  }

  if (isRateLimited(clientIp(req))) {
    res.setHeader('Retry-After', '60');
    sendJson(res, 429, { ok: false, reason: 'rate_limited' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, 16 * 1024);
  } catch (cause) {
    sendJson(res, cause.code === 'payload_too_large' ? 413 : 400, {
      ok: false,
      reason: cause.code || 'invalid_json',
    });
    return;
  }

  if (typeof body.propertyId !== 'string' || body.propertyId.length < 10) {
    sendJson(res, 400, { ok: false, reason: 'invalid_property' });
    return;
  }

  try {
    const result = await searchPropertyRates({
      propertyId: body.propertyId,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      adults: body.adults,
      children: body.children,
      childrenAges: body.childrenAges,
      currency: body.currency,
      refresh: body.refresh === true,
    });

    // Tekliflerde sağlayıcının ham nesnesi istemciye gönderilmez.
    const offers = result.offers.map(({ raw, ...offer }) => offer);
    sendJson(res, 200, {
      ok: true,
      hotelId: result.hotelId,
      checkIn: result.checkIn,
      checkOut: result.checkOut,
      nights: result.nights,
      adults: result.adults,
      children: result.children,
      currency: result.currency,
      currencies: result.currencies,
      propertyPayAvailable: result.propertyPayAvailable,
      property: result.property,
      offers,
      cached: result.cached,
      fetchedAt: result.fetchedAt,
    });
  } catch (cause) {
    const code = cause && cause.code ? cause.code : 'rates_failed';
    if (code === 'invalid_dates' || code === 'not_external_property') {
      sendJson(res, 400, {
        ok: false,
        reason: code,
        message: cause instanceof Error ? cause.message : 'Geçersiz istek.',
      });
      return;
    }
    console.error('[liteapi-rates]', code, cause && cause.message ? cause.message : cause);
    sendJson(res, 502, {
      ok: false,
      reason: code === 'rate_limited' ? 'rate_limited' : 'provider_error',
      message:
        code === 'rate_limited'
          ? 'Sağlayıcı hız limiti aşıldı. Kısa süre sonra tekrar deneyin.'
          : 'Fiyat bilgisi alınamadı. Kısa süre sonra tekrar deneyin.',
    });
  }
};
