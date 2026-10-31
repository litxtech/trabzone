/**
 * Harita/işletme uç noktaları — tek serverless fonksiyon.
 *
 * Vercel Hobby planı dağıtım başına 12 fonksiyonla sınırlı olduğu için
 * işletme araması ve kapak fotoğrafı tek fonksiyonda toplanmıştır. Eski yollar
 * `vercel.json` yeniden yazmalarıyla korunur:
 *
 *   /api/place-search -> /api/place?route=search
 *   /api/place-photo  -> /api/place?route=photo
 */

const { sendJson } = require('../server/http-utils');
const search = require('../server/place/handlers/search');
const photo = require('../server/place/handlers/photo');

const routes = { search, photo };

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
