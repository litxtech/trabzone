/**
 * Harici işletme araması uç noktası.
 *
 *   GET /api/place-search?q=uzungol&lat=41.00&lng=39.71&limit=12
 *
 * "Haritaya yer ekle" formu, Google ve Apple haritalarındaki işletmeleri
 * öneri olarak listelemek için bu uç noktayı kullanır. Sağlayıcı anahtarları
 * yalnızca sunucuda durur; istemciye hiçbir zaman sızmaz.
 *
 * Yanıt (200):
 *   { ok: true, providers: ['google','apple'], items: ExternalPlace[] }
 * Anahtar tanımlı değilse 503 `{ ok: false, reason: 'not_configured' }`.
 */

const { searchPlaces } = require('../server/place-search');

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 40;
const buckets = new Map();

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (buckets.size > 5000) {
      for (const [key, value] of buckets) {
        if (now > value.resetAt) {
          buckets.delete(key);
        }
      }
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX_REQUESTS;
}

function readParam(req, name) {
  const value = req.query ? req.query[name] : undefined;
  if (Array.isArray(value)) {
    return value[0];
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    const url = new URL(req.url || '/', 'https://www.trabzoneapp.com');
    return url.searchParams.get(name) || undefined;
  } catch {
    return undefined;
  }
}

function sendJson(res, status, payload, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    cacheSeconds > 0
      ? `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`
      : 'no-store',
  );
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
    return;
  }

  // Yalnızca herkese açık arama sonuçları döner; anahtar yok.
  res.setHeader('Access-Control-Allow-Origin', '*');

  const query = String(readParam(req, 'q') || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (query.length < 2) {
    sendJson(res, 400, { ok: false, reason: 'too_short' });
    return;
  }

  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    res.setHeader('Retry-After', '60');
    sendJson(res, 429, { ok: false, reason: 'rate_limited' });
    return;
  }

  try {
    const result = await searchPlaces({
      query,
      lat: readParam(req, 'lat'),
      lng: readParam(req, 'lng'),
      limit: readParam(req, 'limit'),
    });

    if (!result.configured) {
      sendJson(res, 503, {
        ok: false,
        reason: 'not_configured',
        message:
          'Harici harita araması için GOOGLE_MAPS_API_KEY veya Apple MapKit anahtarları tanımlanmalı.',
      });
      return;
    }

    if (req.method === 'HEAD') {
      res.statusCode = 200;
      res.end();
      return;
    }

    sendJson(
      res,
      200,
      {
        ok: true,
        providers: result.providers,
        items: result.items,
        // Sağlayıcı bazlı hatalar istemciyi durdurmaz; yalnızca teşhis içindir.
        errors: result.errors,
      },
      300,
    );
  } catch (error) {
    console.error('[place-search]', error && error.message ? error.message : error);
    sendJson(res, 500, { ok: false, reason: 'failed' });
  }
};
