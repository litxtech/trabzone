/**
 * LiteAPI uç noktaları — tek serverless fonksiyon.
 *
 * Vercel Hobby planında dağıtım başına en fazla 12 fonksiyon tanımlanabildiği
 * için senkron, fiyat ve rezervasyon uçları tek bir fonksiyonda toplanmıştır.
 * `vercel.json` içindeki yeniden yazma kuralları eski yolları korur:
 *
 *   /api/liteapi-sync  -> /api/liteapi?route=sync
 *   /api/liteapi-rates -> /api/liteapi?route=rates
 *   /api/liteapi-book  -> /api/liteapi?route=book
 *
 * İstemci kodu değişmez; API anahtarı yine yalnızca sunucuda kalır.
 */

const { sendJson } = require('../server/http-utils');
const sync = require('../server/liteapi/handlers/sync');
const rates = require('../server/liteapi/handlers/rates');
const book = require('../server/liteapi/handlers/book');

const routes = {
  sync,
  rates,
  book,
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
