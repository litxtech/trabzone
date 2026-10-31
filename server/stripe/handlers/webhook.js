/**
 * POST /api/stripe-payments?route=webhook
 *
 * Stripe olay bildirimi. Gövdeye güvenilmez: olay kimliği (`evt_...`) alınır ve
 * gerçek içerik Stripe API'sinden yeniden okunur. Bu sayede imza sırrı
 * yapılandırılmadan önce de sahte isteklerle ödeme "ödendi" yapılamaz
 * (`handleEvent` içinde `retrieveEvent` çağrılır).
 *
 * Stripe panelinde uç nokta olarak şu üç olay seçilmelidir:
 *   checkout.session.completed, checkout.session.expired,
 *   payment_intent.payment_failed
 */

const { handleEvent } = require('../payments');
const { sendJson, readJsonBody } = require('../../http-utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, 64 * 1024);
  } catch (cause) {
    sendJson(res, cause.code === 'payload_too_large' ? 413 : 400, {
      ok: false,
      reason: cause.code || 'invalid_json',
    });
    return;
  }

  const eventId = typeof body?.id === 'string' ? body.id : '';
  if (!eventId.startsWith('evt_')) {
    sendJson(res, 400, { ok: false, reason: 'invalid_event' });
    return;
  }

  try {
    const result = await handleEvent({ eventId });
    // Stripe yalnızca 2xx görürse olayı yeniden denemez.
    sendJson(res, 200, { received: true, ...result });
  } catch (cause) {
    const code = cause && cause.code ? cause.code : 'webhook_failed';
    console.error('[stripe-webhook]', code, cause && cause.message ? cause.message : cause);
    // Olay Stripe'ta yoksa (ör. silinmiş/yabancı bir kimlik) yeniden denemenin
    // anlamı yok: 2xx dönüp yok sayılır. Aksi halde Stripe günlerce dener.
    if (code === 'resource_missing' || code === 'invalid_event') {
      sendJson(res, 200, { received: true, ignored: true, reason: code });
      return;
    }
    // Geçici hatalarda 5xx döner; Stripe aynı olayı tekrar gönderir (idempotent).
    sendJson(res, code === 'not_configured' ? 503 : 502, { ok: false, reason: code });
  }
};
