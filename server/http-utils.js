/** Küçük HTTP yardımcıları (Vercel Node fonksiyonları için). */

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

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      resolve(req.body);
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload_too_large'), { code: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error('invalid_json'), { code: 'invalid_json' }));
      }
    });
    req.on('error', reject);
  });
}

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

function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const buckets = new Map();
  return function isLimited(ip) {
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      if (buckets.size > 5000) {
        for (const [key, value] of buckets) {
          if (now > value.resetAt) buckets.delete(key);
        }
      }
      return false;
    }
    bucket.count += 1;
    return bucket.count > max;
  };
}

module.exports = { sendJson, readJsonBody, clientIp, createRateLimiter };
