/**
 * Stripe ödeme uç noktaları — tek serverless fonksiyon.
 *
 * Vercel Hobby planı dağıtım başına 12 fonksiyonla sınırlı olduğu için
 * checkout, durum, webhook ve iade uçları tek fonksiyonda toplanmıştır.
 * `vercel.json` yeniden yazmaları sabit yolları korur:
 *
 *   /api/stripe-checkout  -> /api/stripe-payments?route=checkout
 *   /api/stripe-status    -> /api/stripe-payments?route=status
 *   /api/stripe-webhook   -> /api/stripe-payments?route=webhook
 *   /api/stripe-refund    -> /api/stripe-payments?route=refund
 */

const { sendJson } = require('../server/http-utils');
const checkout = require('../server/stripe/handlers/checkout');
const status = require('../server/stripe/handlers/status');
const webhook = require('../server/stripe/handlers/webhook');
const refund = require('../server/stripe/handlers/refund');

const routes = { checkout, status, webhook, refund };

module.exports = async function handler(req, res) {
  const raw = req.query?.route;
  const route = Array.isArray(raw) ? raw[0] : raw;
  const target = routes[String(route || '').toLowerCase()];

  if (!target) {
    sendJson(res, 404, { ok: false, reason: 'not_found' });
    return;
  }

  return target(req, res);
};
