/**
 * LiteAPI canlı rezervasyon uç noktası — VARSAYILAN OLARAK KAPALI.
 *
 *   POST /api/liteapi-book
 *   { propertyId, offerId, checkIn, checkOut, adults, children, childrenAges,
 *     guest: { firstName, lastName, email, phone, country }, expectedPriceCents }
 *
 * Güvenlik kapıları:
 *   1. Giriş yapmış kullanıcı (Supabase JWT)
 *   2. `LITEAPI_BOOKING_ENABLED=true`
 *   3. `LITEAPI_BOOKING_OWNER_APPROVED=true`
 *   4. `acc_provider_settings.booking_enabled = true`
 * Koşullardan biri eksikse sağlayıcıya hiç istek gitmez ve 403 döner.
 * Yanıt yalnızca sağlayıcı gerçekten onayladığında `confirmed: true` olur.
 */

const { bookOffer } = require('../server/liteapi/booking');
const { isConfigured } = require('../server/liteapi/config');
const { verifyUser } = require('../server/liteapi/supabase');
const { sendJson, readJsonBody, clientIp, createRateLimiter } = require('../server/http-utils');

const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 10 });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
    return;
  }

  if (!isConfigured()) {
    sendJson(res, 503, { ok: false, reason: 'not_configured' });
    return;
  }

  const auth = await verifyUser(req);
  if (!auth.ok) {
    sendJson(res, 401, { ok: false, reason: auth.reason });
    return;
  }

  if (isRateLimited(`${auth.userId}:${clientIp(req)}`)) {
    res.setHeader('Retry-After', '60');
    sendJson(res, 429, { ok: false, reason: 'rate_limited' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, 24 * 1024);
  } catch (cause) {
    sendJson(res, cause.code === 'payload_too_large' ? 413 : 400, {
      ok: false,
      reason: cause.code || 'invalid_json',
    });
    return;
  }

  try {
    const result = await bookOffer({
      ...body,
      userId: auth.userId,
    });

    sendJson(res, result.status === 'confirmed' ? 201 : 202, {
      ok: true,
      bookingId: result.bookingId,
      status: result.status,
      confirmed: result.confirmed === true,
      providerBookingId: result.providerBookingId,
      message:
        result.confirmed === true
          ? 'Rezervasyon sağlayıcı tarafından onaylandı.'
          : 'Rezervasyon sağlayıcıya iletildi; onay bekleniyor.',
    });
  } catch (cause) {
    const code = cause && cause.code ? cause.code : 'booking_failed';
    const status =
      code === 'booking_disabled'
        ? 403
        : code === 'invalid_dates' ||
            code === 'invalid_offer' ||
            code === 'invalid_guest' ||
            code === 'payment_not_supported'
          ? 400
          : code === 'offer_expired' || code === 'price_changed'
            ? 409
            : 502;
    if (code === 'price_changed' && cause.offer) {
      sendJson(res, status, {
        ok: false,
        reason: code,
        message: cause.message,
        offer: { offerId: cause.offer.offerId, priceCents: cause.offer.priceCents, currency: cause.offer.currency },
      });
      return;
    }
    if (code !== 'booking_disabled') {
      console.error('[liteapi-book]', code, cause && cause.message ? cause.message : cause);
    }
    sendJson(res, status, {
      ok: false,
      reason: code,
      confirmed: false,
      message:
        code === 'booking_disabled'
          ? 'Canlı rezervasyon henüz etkin değil. Test doğrulaması ve işletme onayı tamamlanmadan rezervasyon oluşturulamaz.'
          : cause instanceof Error
            ? cause.message
            : 'Rezervasyon tamamlanamadı.',
    });
  }
};
