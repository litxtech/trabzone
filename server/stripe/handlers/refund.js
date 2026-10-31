/**
 * POST /api/stripe-payments?route=refund  (yalnızca yönetici)
 * { paymentId, amountCents? }
 *
 * İade Stripe üzerinde yapılır ve `acc_payments.refunded_cents` güncellenir.
 * Tutar verilmezse kalan tüm bakiye iade edilir.
 */

const { refundPayment } = require('../payments');
const { verifyAdmin } = require('../../liteapi/supabase');
const { sendJson, readJsonBody } = require('../../http-utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
    return;
  }

  const auth = await verifyAdmin(req);
  if (!auth.ok) {
    sendJson(res, auth.reason === 'not_admin' ? 403 : 401, { ok: false, reason: auth.reason });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, 4 * 1024);
  } catch (cause) {
    sendJson(res, cause.code === 'payload_too_large' ? 413 : 400, {
      ok: false,
      reason: cause.code || 'invalid_json',
    });
    return;
  }

  const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
  const amountCents =
    typeof body.amountCents === 'number' && Number.isFinite(body.amountCents)
      ? Math.round(body.amountCents)
      : null;

  try {
    const result = await refundPayment({ paymentId, amountCents });
    sendJson(res, 200, {
      ok: true,
      paymentId: result.paymentId,
      refundId: result.refundId,
      refundedCents: result.refundedCents,
      status: result.status,
    });
  } catch (cause) {
    const code = cause && cause.code ? cause.code : 'refund_failed';
    const status =
      code === 'not_configured'
        ? 503
        : code === 'payment_not_found'
          ? 404
          : code === 'not_refundable'
            ? 409
            : 502;
    if (code !== 'not_configured') {
      console.error('[stripe-refund]', code, cause && cause.message ? cause.message : cause);
    }
    sendJson(res, status, {
      ok: false,
      reason: code,
      message: cause instanceof Error ? cause.message : 'İade yapılamadı.',
    });
  }
};
