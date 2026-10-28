/**
 * AI Haber Merkezi XML site haritası (`/sitemap-news.xml`).
 *
 * Yalnızca yayında, görünür ve slug'ı olan haberler `ai_news_sitemap_urls`'tan
 * gelir; MOD A/B kaynak yayınları `news_source_sitemap_urls` üzerinden aynı
 * `/haber/<slug>` şemasıyla eklenir. Silinen veya yayından kaldırılan haberler
 * RPC'lerden dönmediği için haritadan düşer. Son 48 saatte yayımlananlar Google
 * News biçiminde (`news:news`) işaretlenir; daha eski haberler normal URL olarak
 * kalır.
 */

const { SITE, escapeXml, rpc } = require('../server/seo');

const PAGE_SIZE = 20000;
const MAX_URLS = 40000;
const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;

async function collect() {
  const rows = [];
  for (let offset = 0; offset < MAX_URLS; offset += PAGE_SIZE) {
    const page = await rpc('ai_news_sitemap_urls', { p_limit: PAGE_SIZE, p_offset: offset });
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  // MOD A/B kaynak yayınları mevcut `/haber/<slug>` şemasıyla haritaya eklenir.
  const sourceRows = [];
  for (let offset = 0; offset < MAX_URLS; offset += PAGE_SIZE) {
    const page = await rpc('news_source_sitemap_urls', { p_limit: PAGE_SIZE, p_offset: offset });
    if (!Array.isArray(page) || page.length === 0) break;
    sourceRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const seen = new Set(rows.map((row) => row.slug));
  for (const row of sourceRows) {
    if (row?.slug && !seen.has(row.slug)) {
      seen.add(row.slug);
      rows.push(row);
    }
  }
  return rows;
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function urlEntry(row) {
  const loc = escapeXml(`${SITE}/haber/${encodeURIComponent(row.slug)}`);
  const published = isoDate(row.published_at);
  const modified = isoDate(row.updated_at) || published;
  const recent = published && Date.now() - new Date(published).getTime() < NEWS_WINDOW_MS;
  const news = recent
    ? `    <news:news>
      <news:publication>
        <news:name>Trabzone Haber</news:name>
        <news:language>tr</news:language>
      </news:publication>
      <news:publication_date>${published}</news:publication_date>
      <news:title>${escapeXml(row.title)}</news:title>
    </news:news>
`
    : '';

  return `  <url>
    <loc>${loc}</loc>
${modified ? `    <lastmod>${modified}</lastmod>\n` : ''}    <changefreq>weekly</changefreq>
    <priority>${recent ? '0.9' : '0.7'}</priority>
${news}  </url>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  try {
    const rows = await collect();
    const indexUrl = `  <url>
    <loc>${escapeXml(`${SITE}/haber`)}</loc>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>`;

    const urls = rows.map(urlEntry).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${indexUrl}
${urls}
</urlset>
`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    res.end(req.method === 'HEAD' ? undefined : xml);
  } catch (error) {
    console.error('[seo/sitemap-news]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Haber site haritası geçici olarak kullanılamıyor.');
  }
};
