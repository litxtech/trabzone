/**
 * Tek giriş noktalı XML site haritası dağıtıcısı.
 *
 * Vercel Hobby planı bir deployment'ta en fazla 12 serverless fonksiyon kabul
 * ediyor. Altı ayrı site haritası dosyası bu limiti aştığı için her harita
 * `server/sitemaps/` altında saf bir işleyici olarak durur; dışarıya tek bir
 * fonksiyon (`/api/sitemap?type=...`) açılır.
 *
 * Yönlendirmeler `vercel.json` içindedir:
 *   /sitemap-listings.xml  -> /api/sitemap?type=listings
 *   /sitemap-hubs.xml      -> /api/sitemap?type=hubs
 *   /sitemap-blog.xml      -> /api/sitemap?type=blog
 *   /sitemap-news.xml      -> /api/sitemap?type=news
 *   /sitemap-live-news.xml -> /api/sitemap?type=live-news
 *   /sitemap-pharmacy.xml  -> /api/sitemap?type=pharmacy
 *   /sitemap-sports.xml    -> /api/sitemap?type=sports
 */

const handlers = {
  listings: require('../server/sitemaps/sitemap-listings'),
  hubs: require('../server/sitemaps/sitemap-hubs'),
  blog: require('../server/sitemaps/sitemap-blog'),
  news: require('../server/sitemaps/sitemap-news'),
  'live-news': require('../server/sitemaps/sitemap-live-news'),
  pharmacy: require('../server/sitemaps/sitemap-pharmacy'),
  sports: require('../server/sitemaps/sitemap-sports'),
};

const TYPES = Object.keys(handlers);

module.exports = function handler(req, res) {
  const raw = req.query ? req.query.type : undefined;
  const type = Array.isArray(raw) ? raw[0] : raw;
  const sitemap = type ? handlers[type] : undefined;

  if (!sitemap) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(`Bilinmeyen site haritası türü. Geçerli türler: ${TYPES.join(', ')}`);
    return;
  }

  return sitemap(req, res);
};

module.exports.TYPES = TYPES;
