/**
 * Paylaşım bağlantılarını (`/p/{tür}/{anahtar}`) sunucu tarafında işler.
 *
 * `vercel.json`:
 *   /p/:type/:key  -> /api/share?type=:type&key=:key
 *
 * Neden ayrı bir sayfa: paylaşılan bağlantı WhatsApp/Telegram gibi
 * uygulamalarda zengin kart olarak görünmeli ve dokunulduğunda Trabzone
 * uygulamasında ilgili içeriğe düşmeli. Bunun için Open Graph etiketleri ve
 * `trabzone://` derin bağlantısı sunucu tarafında üretilir.
 */

const {
  fetchCard,
  normalizeType,
  renderShareNotFound,
  renderSharePage,
} = require('../server/share');

const KEY_RE = /^[a-zA-Z0-9._-]{3,80}$/;

function readParam(req, name) {
  const value = req.query ? req.query[name] : undefined;
  if (Array.isArray(value)) {
    return value[0];
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  try {
    const url = new URL(req.url || '/', 'https://www.trabzoneapp.com');
    const fromQuery = url.searchParams.get(name);
    if (fromQuery) {
      return fromQuery.trim();
    }
    // Rewrite parametreleri query'ye düşmezse yolun kendisinden oku.
    if (name === 'type' || name === 'key') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'p') {
        if (name === 'type' && parts[1]) return decodeURIComponent(parts[1]);
        if (name === 'key' && parts[2]) return decodeURIComponent(parts[2]);
      }
    }
  } catch {
    // yoksay
  }
  return '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  const rawType = readParam(req, 'type');
  const type = normalizeType(rawType);
  const key = readParam(req, 'key');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!type || !KEY_RE.test(key)) {
    res.statusCode = 404;
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
    res.end(req.method === 'HEAD' ? undefined : renderShareNotFound());
    return;
  }

  try {
    const card = await fetchCard(type, key);

    if (!card) {
      res.statusCode = 404;
      res.setHeader('X-Robots-Tag', 'noindex, follow');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
      res.end(req.method === 'HEAD' ? undefined : renderShareNotFound());
      return;
    }

    const comment = readParam(req, 'comment');
    const html = renderSharePage(card, { key, comment: comment || '' });

    res.statusCode = 200;
    // Beğeni/yorum sayısı gibi alanlar tazelensin diye kısa önbellek.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=600');
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error('[share]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.end('Paylaşım sayfası geçici olarak kullanılamıyor.');
  }
};
