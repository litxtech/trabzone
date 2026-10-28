/**
 * Blog sayfalarını sunucu tarafında işler.
 *
 * `vercel.json`:
 *   /blog             -> /api/blog
 *   /blog/{slug}      -> /api/blog?slug={slug}
 *
 * Yazı yoksa veya yayından kaldırılmışsa 404 + `noindex` döner; böylece
 * Google'a boş sonuç sayfası sunulmaz. Yayındaki yazılar tam HTML olarak
 * işlenir; JSON-LD (BlogPosting, BreadcrumbList, FAQPage) dahildir.
 */

const { getTemplate, renderBlogIndex, renderBlogPost, rpc } = require('../server/seo');

const SITE = 'https://www.trabzoneapp.com';
const SLUG_RE = /^[a-z0-9-]{3,140}$/;
const PAGE_SIZE = 12;

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
    if (parts[0] === 'blog' && parts[1]) return decodeURIComponent(parts[1]).toLowerCase();
  } catch {
    // yoksay
  }
  return '';
}

function readFilters(req) {
  const category = (readParam(req, 'kategori') || '').trim().slice(0, 60);
  const search = (readParam(req, 'q') || '').trim().slice(0, 80);
  const rawPage = Number.parseInt(readParam(req, 'sayfa') || '1', 10);
  const page = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), 50) : 1;
  return { category, search, page };
}

async function sendNotFound(req, res) {
  const template = await getTemplate();
  const html = template
    .replace(/<meta name="robots"[^>]*>/i, '<meta name="robots" content="noindex, follow" />')
    .replace(/\s*<link rel="canonical"[^>]*>/i, '')
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>Trabzone — Blog yazısı bulunamadı</title>');
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
      const post = await rpc('blog_public_post', { p_slug: slug });
      if (!post || !post.slug) {
        await sendNotFound(req, res);
        return;
      }
      const html = await renderBlogPost(post);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=120');
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }

    const filters = readFilters(req);
    const page = await rpc('blog_public_list', {
      p_limit: PAGE_SIZE,
      p_offset: (filters.page - 1) * PAGE_SIZE,
      p_category: filters.category || null,
      p_search: filters.search || null,
    });

    const html = await renderBlogIndex(page || { items: [], total: 0, categories: [] }, filters);

    // Filtreli görünümler kanonik /blog adresine işaret eder ve indekslenmez.
    const filtered = Boolean(filters.category || filters.search || filters.page > 1);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', filtered ? 'noindex, follow' : 'index, follow');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=120');
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error('[seo/blog]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Blog sayfası geçici olarak kullanılamıyor.');
  }
};
