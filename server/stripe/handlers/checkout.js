/**
 * POST /api/stripe-payments?route=checkout
 * { bookingId, productName?, email? }
 *
 * Rezervasyon taslağı için Stripe Checkout oturumu açar ve ödeme sayfası
 * adresini döner. Tutar sunucuda `acc_liteapi_bookings.price_cents` üzerinden
 * hesaplanır; istemci tutar göndermez.
 */

const { startCheckout } = require('../payments');
const { verifyUser } = require('../../liteapi/supabase');
const { sendJson, readJsonBody, clientIp, createRateLimiter } = require('../../http-utils');

const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 12 });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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

  let body;
  try {
    body = await readJsonBody(req, 8 * 1024);
  } catch (cause) {
    sendJson(res, cause.code === 'payload_too_large' ? 413 : 400, {
      ok: false,
      reason: cause.code || 'invalid_json',
    });
    return;
  }

  try {
    const session = await startCheckout({
      bookingId: typeof body.bookingId === 'string' ? body.bookingId : '',
      userId: auth.userId,
      email: typeof auth.email === 'string' ? auth.email : null,
      productName: typeof body.productName === 'string' ? body.productName : null,
    });

    sendJson(res, 200, {
      ok: true,
      paymentId: session.paymentId,
      status: session.status,
      amountCents: session.amountCents,
      currency: session.currency,
      url: session.url,
      reused: session.reused === true,
    });
  } catch (cause) {
    const code = cause && cause.code ? cause.code : 'payment_failed';
    const status =
      code === 'not_configured' || code === 'stripe_account_not_ready'
        ? 503
        : code === 'auth_required'
          ? 401
          : code === 'not_allowed'
            ? 403
            : code === 'payment_not_found'
              ? 404
              : code === 'invalid_booking' || code === 'booking_not_payable'
                ? 400
                : 502;

    if (code !== 'not_configured') {
      console.error('[stripe-checkout]', code, cause && cause.message ? cause.message : cause);
    }

    sendJson(res, status, {
      ok: false,
      reason: code,
      message:
        code === 'not_configured'
          ? 'Ödeme altyapısı yapılandırılmadı (STRIPE_SECRET_KEY).'
          : code === 'stripe_account_not_ready'
            ? 'Stripe hesabında ödeme altyapısı henüz etkin değil. Canlı tahsilat için Stripe panelinde işletme doğrulaması tamamlanmalı.'
            : code === 'booking_not_payable'
              ? 'Bu rezervasyon için ödeme başlatılamaz.'
              : cause instanceof Error
                ? cause.message
                : 'Ödeme oturumu açılamadı.',
    });
  }
};
