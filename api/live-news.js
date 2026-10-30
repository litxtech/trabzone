/**
 * Anlık gelişme web sayfası (`/anlik-haber/{post_id}`).
 *
 * `vercel.json`:
 *   /anlik-haber/{id} -> /api/live-news?id={id}
 *
 * `live_news_public_post` yalnızca moderasyon durumu `visible` olan ve web
 * yayın hedefi seçilmiş içeriği döner. Doğrulanmamış içerik `noindex`
 * işaretlenir; doğrulanmış / düzeltilmiş içerik NewsArticle JSON-LD alır.
 */

const { rpc } = require('../server/seo');
const { renderLiveNewsNotFound, renderLiveNewsPost } = require('../server/live-news');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readParam(req, name) {
  const value = req.query ? req.query[name] : undefined;
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  try {
    const url = new URL(req.url || '/', 'https://www.trabzoneapp.com');
    const parts = url.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'anlik-haber' || parts[0] === 'live-news') && parts[1]) {
      return decodeURIComponent(parts[1]);
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

  const id = readParam(req, 'id');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!UUID_RE.test(id)) {
    res.statusCode = 404;
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
    res.end(req.method === 'HEAD' ? undefined : renderLiveNewsNotFound());
    return;
  }

  try {
    const post = await rpc('live_news_public_post', { p_post_id: id });
    if (!post || !post.post_id) {
      res.statusCode = 404;
      res.setHeader('X-Robots-Tag', 'noindex, follow');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
      res.end(req.method === 'HEAD' ? undefined : renderLiveNewsNotFound());
      return;
    }

    const html = await renderLiveNewsPost(post);
    const indexable = post.verification_status === 'verified' || post.verification_status === 'corrected';

    res.statusCode = 200;
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=45, stale-while-revalidate=300');
    if (!indexable) {
      res.setHeader('X-Robots-Tag', 'noindex, follow');
    }
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error('[seo/live-news]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '120');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Anlık gelişme sayfası geçici olarak kullanılamıyor.');
  }
};
