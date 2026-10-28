/**
 * Programatik SEO hub sayfalarını sunucu tarafında işler.
 *
 * `vercel.json` şu adresleri buraya yönlendirir:
 *   /trabzon
 *   /trabzon/{ilçe}
 *   /trabzon/{bölüm}
 *   /trabzon/{bölüm}/{kategori}
 *   /trabzon/{ilçe}/{bölüm}
 *   /trabzon/{ilçe}/{bölüm}/{kategori}
 *
 * Sayfa yalnızca gerçekten yayında ilan/işletme varsa 200 döner. Boş
 * kombinasyonlar 404 + `noindex` olur; böylece Google'a ince sonuç sayfası
 * sunulmaz ve sitemap'e de girmez.
 */

const { getTemplate, renderHub, rpc } = require('../server/seo');

const SITE = 'https://www.trabzoneapp.com';
const SEGMENT_RE = /^[a-z0-9-]{1,80}$/;

function readParam(req, name) {
  const value = req.query ? req.query[name] : undefined;
  if (Array.isArray(value)) {
    return value[0];
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

/**
 * Rewrite parametreleri query'ye düşmezse isteğin yolundan okur. `/api/hub`
 * dışındaki bir yol gelirse (ör. doğrudan fonksiyon çağrısı) boş dizi döner.
 */
function readSegments(req) {
  const fromQuery = [readParam(req, 'p1'), readParam(req, 'p2'), readParam(req, 'p3')]
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim().toLowerCase());
  if (fromQuery.length > 0) {
    return fromQuery;
  }
  try {
    const url = new URL(req.url || '/', SITE);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'trabzon') {
      return parts.slice(1).map((part) => part.toLowerCase());
    }
  } catch {
    // yoksay
  }
  return [];
}

function requestedPath(segments) {
  return segments.length > 0 ? `/trabzon/${segments.join('/')}` : '/trabzon';
}

async function sendNotFound(req, res) {
  const template = await getTemplate();
  const html = template
    .replace(/<meta name="robots"[^>]*>/i, '<meta name="robots" content="noindex, follow" />')
    .replace(/\s*<link rel="canonical"[^>]*>/i, '')
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>Trabzone · Sayfa bulunamadı</title>');
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, follow');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.end(req.method === 'HEAD' ? undefined : html);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  const segments = readSegments(req);

  if (segments.length > 3 || segments.some((segment) => !SEGMENT_RE.test(segment))) {
    await sendNotFound(req, res);
    return;
  }

  try {
    const page = await rpc('seo_hub_page', { p_path: segments, p_limit: 24 });

    if (!page || page.ok !== true || Number(page.total || 0) <= 0) {
      await sendNotFound(req, res);
      return;
    }

    // Uzun/alternatif kategori adreslerini tek kanonik adrese taşı.
    const requested = requestedPath(segments);
    if (page.path && page.path !== requested) {
      res.statusCode = 301;
      res.setHeader('Location', `${SITE}${page.path}`);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.end();
      return;
    }

    const html = await renderHub(page);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // İlan sayısı/fiyatlar değişebilir; 10 dakikada bir tazelenir, CDN bot
    // trafiğini karşılar.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400');
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error('[seo/hub]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Sayfa geçici olarak kullanılamıyor.');
  }
};
