/**
 * Ön ödemeli rezervasyon taslağı.
 *
 *   POST /api/liteapi-draft
 *   { propertyId, offerId, checkIn, checkOut, adults, children,
 *     childrenAges?, expectedPriceCents, guest: {...} }
 *
 * Sağlayıcıya rezervasyon **göndermez**; yalnızca fiyatı tazeler ve
 * `status='intent'` taslak açar. Ardından istemci Stripe Checkout oturumu
 * ister. Sağlayıcı rezervasyonu ödeme onayından sonra webhook tarafında
 * oluşturulur.
 */

const { createPrepaidDraft } = require('../booking');
const { isConfigured } = require('../config');
const { verifyUser } = require('../supabase');
const { assertCardPaymentsReady } = require('../../stripe/payments');
const { sendJson, readJsonBody, clientIp, createRateLimiter } = require('../../http-utils');

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
    // Kart ödemesi Stripe'da aktif değilse niyet kaydı açmadan dur.
    await assertCardPaymentsReady();
    const draft = await createPrepaidDraft({ ...body, userId: auth.userId });
    sendJson(res, 201, {
      ok: true,
      bookingId: draft.bookingId,
      priceCents: draft.priceCents,
      currency: draft.currency,
      roomName: draft.roomName,
      paymentAtProperty: draft.paymentAtProperty === true,
    });
  } catch (cause) {
    const code = cause && cause.code ? cause.code : 'draft_failed';
    const status =
      code === 'booking_disabled'
        ? 403
        : code === 'stripe_not_ready' || code === 'not_configured'
          ? 503
          : code === 'invalid_dates' ||
            code === 'invalid_offer' ||
            code === 'invalid_guest' ||
            code === 'invalid_amount'
          ? 400
          : code === 'offer_expired' || code === 'price_changed'
            ? 409
            : 502;

    if (code === 'price_changed' && cause.offer) {
      sendJson(res, status, {
        ok: false,
        reason: code,
        message: cause.message,
        offer: {
          offerId: cause.offer.offerId,
          priceCents: cause.offer.priceCents,
          currency: cause.offer.currency,
        },
      });
      return;
    }
    if (code !== 'booking_disabled') {
      console.error('[liteapi-draft]', code, cause && cause.message ? cause.message : cause);
    }
    sendJson(res, status, {
      ok: false,
      reason: code,
      message:
        code === 'booking_disabled'
          ? 'Canlı rezervasyon henüz etkin değil. Sağlayıcı onayı ve işletme ayarı açılmadan ödeme alınamaz.'
          : cause instanceof Error
            ? cause.message
            : 'Rezervasyon taslağı oluşturulamadı.',
    });
  }
};
