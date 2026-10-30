/**
 * Trabzonspor Maç Arenası web sayfaları.
 *
 * `vercel.json`:
 *   /trabzonspor          -> /api/match
 *   /trabzonspor/mac/{id} -> /api/match?id={id}
 *
 * Sayfa, SPA şablonuna meta / Open Graph / SportsEvent JSON-LD ve botlar için
 * statik özet ekler; uygulama aynı adreste canlı arenayı yükler. Veri
 * sağlayıcısına ulaşılamazsa SPA şablonu özetsiz sunulur.
 */

const { getTemplate, rpc } = require('../server/seo');
const { fetchMatch, renderHubPage, renderMatchNotFound, renderMatchPage } = require('../server/match');

const ID_RE = /^[1-9][0-9]{0,11}$/;

function readParam(req, name) {
  const value = req.query ? req.query[name] : undefined;
  if (Array.isArray(value)) return value[0] || '';
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  try {
    const url = new URL(req.url || '/', 'https://www.trabzoneapp.com');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'trabzonspor' && parts[1] === 'mac' && parts[2]) {
      return decodeURIComponent(parts[2]);
    }
  } catch {
    // yoksay
  }
  return '';
}

async function sendSpaFallback(req, res, scope, error) {
  console.error(`[seo/match:${scope}]`, error && error.message ? error.message : error);
  try {
    const html = await getTemplate();
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15');
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '60');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Maç merkezi geçici olarak kullanılamıyor.');
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const rawId = readParam(req, 'id');

  if (!rawId) {
    try {
      const center = await rpc('sports_center', {});
      if (!center || !center.configured) {
        await sendSpaFallback(req, res, 'hub', 'not_configured');
        return;
      }
      const html = await renderHubPage(center);
      res.statusCode = 200;
      res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${center.live ? 20 : 300}, stale-while-revalidate=600`);
      res.end(req.method === 'HEAD' ? undefined : html);
    } catch (error) {
      await sendSpaFallback(req, res, 'hub', error);
    }
    return;
  }

  if (!ID_RE.test(rawId)) {
    res.statusCode = 404;
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    res.end(req.method === 'HEAD' ? undefined : renderMatchNotFound());
    return;
  }

  try {
    const data = await fetchMatch(Number(rawId));
    if (!data) {
      res.statusCode = 404;
      res.setHeader('X-Robots-Tag', 'noindex, follow');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
      res.end(req.method === 'HEAD' ? undefined : renderMatchNotFound());
      return;
    }
    const html = await renderMatchPage(data.detail, data.timeline);
    const status = data.detail.fixture.status;
    const ttl = status.is_live ? 15 : status.is_finished ? 600 : 120;
    res.statusCode = 200;
    res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`);
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    await sendSpaFallback(req, res, 'detail', error);
  }
};
