/**
 * LiteAPI uç noktaları — tek serverless fonksiyon.
 *
 * Vercel Hobby planında dağıtım başına en fazla 12 fonksiyon tanımlanabildiği
 * için senkron, fiyat ve rezervasyon uçları tek bir fonksiyonda toplanmıştır.
 * `vercel.json` içindeki yeniden yazma kuralları eski yolları korur:
 *
 *   /api/liteapi-sync  -> /api/liteapi?route=sync
 *   /api/liteapi-rates -> /api/liteapi?route=rates
 *   /api/liteapi-prices -> /api/liteapi?route=prices
 *   /api/liteapi-book  -> /api/liteapi?route=book
 *   /api/liteapi-draft -> /api/liteapi?route=draft
 *   /api/liteapi-warm  -> /api/liteapi?route=warm
 *
 * İstemci kodu değişmez; API anahtarı yine yalnızca sunucuda kalır.
 */

const { sendJson } = require('../server/http-utils');
const sync = require('../server/liteapi/handlers/sync');
const rates = require('../server/liteapi/handlers/rates');
const prices = require('../server/liteapi/handlers/prices');
const book = require('../server/liteapi/handlers/book');
const draft = require('../server/liteapi/handlers/draft');
const warm = require('../server/liteapi/handlers/warm');

const routes = {
  sync,
  rates,
  prices,
  book,
  draft,
  warm,
};

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
