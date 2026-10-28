/**
 * SEO hub adreslerinin XML site haritası (`/sitemap-hubs.xml`).
 *
 * Veritabanındaki `seo_hub_urls` yalnızca en az bir yayın ilanı/işletmesi olan
 * ilçe + bölüm + kategori birleşimlerini döner. Böylece boş sonuç sayfaları
 * site haritasına hiç girmez.
 */

const { SITE, escapeXml, rpc } = require('../server/seo');

const PAGE_SIZE = 20000;
const MAX_URLS = 40000;

async function collect() {
  const rows = [];
  for (let offset = 0; offset < MAX_URLS; offset += PAGE_SIZE) {
    const page = await rpc('seo_hub_urls', { p_limit: PAGE_SIZE, p_offset: offset });
    if (!Array.isArray(page) || page.length === 0) {
      break;
    }
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
  }
  return rows;
}

function priorityFor(row) {
  if (row.mode === 'city') {
    return '1.0';
  }
  const depth = String(row.path || '').split('/').filter(Boolean).length;
  return depth <= 2 ? '0.8' : '0.7';
}

function changefreqFor(row) {
  return row.mode === 'city' ? 'daily' : 'weekly';
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
    const urls = rows
      .map((row) => {
        const loc = escapeXml(`${SITE}${row.path}`);
        const lastmod = row.updated_at
          ? new Date(row.updated_at).toISOString().slice(0, 10)
          : null;
        return `  <url>
    <loc>${loc}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}    <changefreq>${changefreqFor(row)}</changefreq>
    <priority>${priorityFor(row)}</priority>
  </url>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.end(req.method === 'HEAD' ? undefined : xml);
  } catch (error) {
    console.error('[seo/sitemap-hubs]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Site haritası geçici olarak kullanılamıyor.');
  }
};
