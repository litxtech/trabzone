/**
 * GET /api/stripe-payments?route=status&bookingId=...
 *
 * Ödeme durumunu Stripe'tan doğrulayarak döner. Mobil/web istemci, Checkout
 * sayfasından döndükten sonra burayı çağırarak "ödendi" bilgisini sunucudan
 * teyit eder (yalnızca dönüş URL'ine güvenilmez).
 */

const { statusForBooking, statusForPayment } = require('../payments');
const { verifyUser } = require('../../liteapi/supabase');
const { sendJson, readJsonBody, clientIp, createRateLimiter } = require('../../http-utils');

const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 60 });

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
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

  const pickParam = (name) => {
    const raw = req.query?.[name];
    return String(Array.isArray(raw) ? raw[0] : raw || '').trim();
  };
  let body = {};
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req, 4 * 1024);
    } catch {
      body = {};
    }
  }
  const bookingId = pickParam('bookingId') || String(body.bookingId || '').trim();
  const paymentId = pickParam('paymentId') || String(body.paymentId || '').trim();
  if (!bookingId && !paymentId) {
    sendJson(res, 400, { ok: false, reason: 'invalid_booking' });
    return;
  }

  try {
    const result = bookingId
      ? await statusForBooking({ bookingId, userId: auth.userId })
      : await statusForPayment({ paymentId, userId: auth.userId });
    sendJson(res, 200, {
      ok: true,
      bookingId: result.bookingId,
      paymentId: result.paymentId ?? null,
      status: result.status,
      amountCents: result.amountCents ?? null,
      paidCents: result.paidCents ?? null,
      currency: result.currency ?? null,
      url: result.url ?? null,
      booking: result.booking ?? null,
      refunded: result.refunded === true,
    });
  } catch (cause) {
    const code = cause && cause.code ? cause.code : 'payment_failed';
    const status =
      code === 'not_allowed' ? 403 : code === 'payment_not_found' ? 404 : 502;
    if (code !== 'not_configured') {
      console.error('[stripe-status]', code, cause && cause.message ? cause.message : cause);
    }
    sendJson(res, status, {
      ok: false,
      reason: code,
      message: cause instanceof Error ? cause.message : 'Ödeme durumu alınamadı.',
    });
  }
};
