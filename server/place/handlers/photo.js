/**
 * İşletme kapak fotoğrafı uç noktası (Google Places).
 *
 *   GET /api/place-photo?name=Kalkanoglu%20Pilavi&lat=41.0049&lng=39.7262&w=800
 *
 * Trabzone'da kendi fotoğrafı olmayan işletmelerin kartlarında Google
 * Haritalar'daki fotoğraf gösterilir. Anahtar yalnızca sunucuda durur.
 *
 * Yanıt (200):
 *   { ok: true, photo: { url, width, height, source: 'google', placeId,
 *     attributions: [{ name, uri }] } | null }
 * Anahtar tanımlı değilse 503 `{ ok: false, reason: 'not_configured' }`.
 */

const { findPlacePhoto } = require('../server/place-photo');

const RATE_WINDOW_MS = 60 * 1000;
// Bir liste ekranı tek seferde onlarca kart açabilir; arama ucundan geniş tutulur.
const RATE_MAX_REQUESTS = 150;
const HIT_CACHE_SECONDS = 45 * 60;
const MISS_CACHE_SECONDS = 12 * 60 * 60;
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
      ? `public, max-age=${Math.min(cacheSeconds, 600)}, s-maxage=${cacheSeconds}`
      : 'no-store',
  );
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    res.setHeader('Retry-After', '60');
    sendJson(res, 429, { ok: false, reason: 'rate_limited' });
    return;
  }

  try {
    const result = await findPlacePhoto({
      name: readParam(req, 'name'),
      lat: readParam(req, 'lat'),
      lng: readParam(req, 'lng'),
      width: readParam(req, 'w'),
    });

    if (!result.configured) {
      sendJson(res, 503, { ok: false, reason: 'not_configured' });
      return;
    }
    if (result.invalid) {
      sendJson(res, 400, { ok: false, reason: 'invalid_input' });
      return;
    }

    sendJson(
      res,
      200,
      { ok: true, photo: result.photo },
      result.photo ? HIT_CACHE_SECONDS : MISS_CACHE_SECONDS,
    );
  } catch (error) {
    console.error('[place-photo]', error && error.message ? error.message : error);
    sendJson(res, 502, { ok: false, reason: 'failed' });
  }
};
