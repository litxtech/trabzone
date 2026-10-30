/**
 * Eczane rehberi XML site haritasÄ± (`/sitemap-pharmacy.xml`).
 *
 * YalnÄ±zca yayÄ±ndaki eczaneler (`pharmacy_sitemap_urls`) ve en az bir eczane
 * kaydÄ± olan ilÃ§e nÃ¶bet sayfalarÄ± listelenir. NÃ¶bet sayfalarÄ±nÄ±n `lastmod`
 * deÄŸeri gÃ¼nlÃ¼k veriye baÄŸlÄ± olduÄŸu iÃ§in her zaman bugÃ¼ndÃ¼r; bu sayfalar
 * "sonsuza kadar geÃ§erli" bir liste olarak iÅŸaretlenmez.
 */

const { SITE, escapeXml, rpc } = require('../seo');

const PAGE_SIZE = 20000;
const MAX_URLS = 40000;

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function collectPharmacies() {
  const rows = [];
  for (let offset = 0; offset < MAX_URLS; offset += PAGE_SIZE) {
    const page = await rpc('pharmacy_sitemap_urls', { p_limit: PAGE_SIZE, p_offset: offset });
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

function urlEntry(loc, lastmod, changefreq, priority) {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
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
    const [pharmacies, bootstrap] = await Promise.all([
      collectPharmacies(),
      rpc('pharmacies_bootstrap', {}),
    ]);
    const districts = Array.isArray(bootstrap?.districts) ? bootstrap.districts : [];
    const day = today();

    const entries = [
      urlEntry(`${SITE}/eczaneler`, day, 'daily', '0.9'),
      urlEntry(`${SITE}/nobetci-eczaneler`, day, 'daily', '0.9'),
      ...districts
        .filter((district) => Number(district.pharmacy_count || 0) > 0)
        .map((district) =>
          urlEntry(
            `${SITE}/nobetci-eczaneler/${encodeURIComponent(district.slug)}`,
            day,
            'daily',
            '0.8',
          ),
        ),
      ...pharmacies.map((row) => {
        const lastmod = row.updated_at
          ? new Date(row.updated_at).toISOString().slice(0, 10)
          : null;
        return urlEntry(
          `${SITE}/eczaneler/${encodeURIComponent(row.slug)}`,
          lastmod,
          'weekly',
          '0.7',
        );
      }),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.end(req.method === 'HEAD' ? undefined : xml);
  } catch (error) {
    console.error('[seo/sitemap-pharmacy]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Site haritasÄ± geÃ§ici olarak kullanÄ±lamÄ±yor.');
  }
};
