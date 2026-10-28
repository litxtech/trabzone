/**
 * AI Haber Merkezi sayfalarını sunucu tarafında işler.
 *
 * `vercel.json`:
 *   /haber            -> /api/news
 *   /haber/{slug}     -> /api/news?slug={slug}
 *
 * Yalnızca yayında ve görünür AI haberleri ile kaynak haberleri döner. Kayıt
 * yoksa 404 + `noindex` verilir; böylece arama motorlarına boş sonuç sayfası
 * sunulmaz. AI haber sayfası JSON-LD `NewsArticle` ve kaynak listesi içerir;
 * `kaynak-<post_id>` adresleri MOD A/B kaynak yayınlarını aynı şemayla sunar.
 */

const {
  SITE,
  getTemplate,
  renderNewsIndex,
  renderNewsPost,
  rpc,
} = require('../server/seo');

const SLUG_RE = /^[a-z0-9-]{3,160}$/;

function readParam(req, name) {
  const value = req.query ? req.query[name] : undefined;
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string') return value;
  return undefined;
}

function readSlug(req) {
  const fromQuery = readParam(req, 'slug');
  if (typeof fromQuery === 'string' && fromQuery.trim() !== '') {
    return fromQuery.trim().toLowerCase();
  }
  try {
    const url = new URL(req.url || '/', SITE);
    const parts = url.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'haber' || parts[0] === 'news') && parts[1]) {
      return decodeURIComponent(parts[1]).toLowerCase();
    }
  } catch {
    // yoksay
  }
  return '';
}

async function sendNotFound(req, res) {
  const template = await getTemplate();
  const html = template
    .replace(/<meta name="robots"[^>]*>/i, '<meta name="robots" content="noindex, follow" />')
    .replace(/\s*<link rel="canonical"[^>]*>/i, '')
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>Trabzone — Haber bulunamadı</title>');
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, follow');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=120');
  res.end(req.method === 'HEAD' ? undefined : html);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  try {
    const slug = readSlug(req);

    if (slug) {
      if (!SLUG_RE.test(slug)) {
        await sendNotFound(req, res);
        return;
      }
      const post = await rpc(
        slug.startsWith('kaynak-') ? 'news_source_public_post_by_slug' : 'ai_news_public_post_by_slug',
        { p_slug: slug },
      );
      if (!post || !post.slug) {
        await sendNotFound(req, res);
        return;
      }
      const html = await renderNewsPost(post);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }

    const page = await rpc('ai_news_public_list', { p_limit: 48, p_offset: 0, p_category: null });
    const html = await renderNewsIndex(page || { items: [], total: 0 });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error('[seo/news]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Haber sayfası geçici olarak kullanılamıyor.');
  }
};
