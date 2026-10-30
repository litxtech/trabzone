/**
 * Trabzonspor maç merkezi XML site haritası (`/sitemap-sports.xml`).
 *
 * `sports_fixtures_list` gizlenmiş ve TEST maçlarını hiç döndürmez; burada
 * yalnızca maç merkezi ana sayfası, yaklaşan maçlar ve son sonuçlar yer alır.
 */

const { SITE, escapeXml, rpc } = require('../seo');

const PAGE_SIZE = 60;
const MAX_RESULTS = 300;

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function collect() {
  const upcoming = await rpc('sports_fixtures_list', { p_scope: 'upcoming', p_limit: PAGE_SIZE, p_offset: 0 });
  const results = [];
  for (let offset = 0; offset < MAX_RESULTS; offset += PAGE_SIZE) {
    const page = await rpc('sports_fixtures_list', { p_scope: 'results', p_limit: PAGE_SIZE, p_offset: offset });
    if (!Array.isArray(page) || page.length === 0) break;
    results.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const seen = new Set();
  return [...(Array.isArray(upcoming) ? upcoming : []), ...results].filter((fixture) => {
    if (!fixture || fixture.is_test || seen.has(fixture.id)) return false;
    seen.add(fixture.id);
    return true;
  });
}

function urlEntry(fixture) {
  const loc = escapeXml(`${SITE}/trabzonspor/mac/${encodeURIComponent(String(fixture.id))}`);
  const modified = isoDate(fixture.synced && fixture.synced.fixture) || isoDate(fixture.finished_at);
  const live = fixture.status && fixture.status.is_live;
  const finished = fixture.status && fixture.status.is_finished;
  return `  <url>
    <loc>${loc}</loc>
${modified ? `    <lastmod>${modified}</lastmod>\n` : ''}    <changefreq>${live ? 'always' : finished ? 'monthly' : 'daily'}</changefreq>
    <priority>${finished ? '0.5' : '0.7'}</priority>
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
    const fixtures = await collect();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(`${SITE}/trabzonspor`)}</loc>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>
${fixtures.map(urlEntry).join('\n')}
</urlset>
`;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600');
    res.end(req.method === 'HEAD' ? undefined : xml);
  } catch (error) {
    console.error('[seo/sitemap-sports]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Maç merkezi site haritası geçici olarak kullanılamıyor.');
  }
};
