/**
 * AnlÄ±k geliÅŸmeler XML site haritasÄ± (`/sitemap-live-news.xml`).
 *
 * YalnÄ±zca:
 * - moderasyon durumu `visible`,
 * - doÄŸrulama durumu `verified`,
 * - web yayÄ±n hedefi seÃ§ilmiÅŸ,
 * - yayÄ±n zamanÄ± olan
 * iÃ§erikler eklenir. BÃ¶ylece doÄŸrulanmamÄ±ÅŸ, kaldÄ±rÄ±lmÄ±ÅŸ veya dÃ¼ÅŸÃ¼k kaliteli
 * vatandaÅŸ paylaÅŸÄ±mlarÄ± arama motorlarÄ±na taÅŸÄ±nmaz.
 */

const { SITE, escapeXml, rpc } = require('../seo');

const PAGE_SIZE = 5000;
const MAX_URLS = 20000;

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function collect() {
  const rows = [];
  for (let offset = 0; offset < MAX_URLS; offset += PAGE_SIZE) {
    const page = await rpc('live_news_sitemap_urls', { p_limit: PAGE_SIZE, p_offset: offset });
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function urlEntry(row) {
  const loc = escapeXml(`${SITE}/anlik-haber/${encodeURIComponent(row.post_id)}`);
  const modified = isoDate(row.updated_at) || isoDate(row.published_at);
  return `  <url>
    <loc>${loc}</loc>
${modified ? `    <lastmod>${modified}</lastmod>\n` : ''}    <changefreq>hourly</changefreq>
    <priority>0.7</priority>
  </url>`;
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
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.map(urlEntry).join('\n')}
</urlset>
`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=600');
    res.end(req.method === 'HEAD' ? undefined : xml);
  } catch (error) {
    console.error('[seo/sitemap-live-news]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('AnlÄ±k geliÅŸme site haritasÄ± geÃ§ici olarak kullanÄ±lamÄ±yor.');
  }
};
