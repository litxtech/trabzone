/**
 * Blog adreslerinin XML site haritasÄ± (`/sitemap-blog.xml`).
 *
 * YalnÄ±zca yayÄ±nda ve yayÄ±n tarihi gelmiÅŸ yazÄ±lar `blog_sitemap_urls`'tan gelir.
 * Blog dizini ayrÄ±ca eklenir; filtreli/sayfalÄ± gÃ¶rÃ¼nÃ¼mler eklenmez.
 */

const { SITE, escapeXml, rpc } = require('../seo');

const PAGE_SIZE = 20000;
const MAX_URLS = 40000;

async function collect() {
  const rows = [];
  for (let offset = 0; offset < MAX_URLS; offset += PAGE_SIZE) {
    const page = await rpc('blog_sitemap_urls', { p_limit: PAGE_SIZE, p_offset: offset });
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
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
    <loc>${escapeXml(`${SITE}/blog`)}</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`;

    const urls = rows
      .map((row) => {
        const loc = escapeXml(`${SITE}/blog/${row.slug}`);
        const lastmod = row.updated_at ? new Date(row.updated_at).toISOString().slice(0, 10) : null;
        return `  <url>
    <loc>${loc}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexUrl}
${urls}
</urlset>
`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.end(req.method === 'HEAD' ? undefined : xml);
  } catch (error) {
    console.error('[seo/sitemap-blog]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Blog site haritasÄ± geÃ§ici olarak kullanÄ±lamÄ±yor.');
  }
};
