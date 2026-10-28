/**
 * İlan detay sayfalarını arama motorları için sunucu tarafında işler.
 *
 * `vercel.json` şu adresleri buraya yönlendirir:
 *   /marketplace/<uuid>               → kind=market
 *   /marketplace/real-estate/<uuid>   → kind=real_estate
 *
 * Yanıt, Expo web kabuğunun ilan verisiyle doldurulmuş hâlidir: gerçek
 * kullanıcı aynı SPA'yı görür, bot ise başlık/fiyat/açıklama/görsel ve
 * JSON-LD'yi JavaScript çalıştırmadan okur.
 */

const {
  getTemplate,
  renderListing,
  rpc,
} = require('../server/seo');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readParam(req, name) {
  const value = req.query ? req.query[name] : undefined;
  if (Array.isArray(value)) {
    return value[0];
  }
  if (typeof value === 'string') {
    return value;
  }
  // Rewrite parametreleri query'ye düşmezse isteğin kendi URL'inden oku.
  try {
    const url = new URL(req.url || '/', 'https://www.trabzoneapp.com');
    return url.searchParams.get(name) || undefined;
  } catch {
    return undefined;
  }
}

async function sendShell(res, status) {
  const template = await getTemplate();
  // Bulunamayan ilan 404 döner; kabuk yine yüklenir ki uygulama kendi
  // "bulunamadı" ekranını gösterebilsin. Canonical ve robots bu durumda
  // ana sayfayı işaret etmemeli.
  const html = template
    .replace(
      /<meta name="robots"[^>]*>/i,
      '<meta name="robots" content="noindex, follow" />',
    )
    .replace(/\s*<link rel="canonical"[^>]*>/i, '');
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, follow');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.end(html);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  const id = String(readParam(req, 'id') || '').trim();
  const kindParam = String(readParam(req, 'kind') || '').trim();

  if (!UUID_RE.test(id)) {
    await sendShell(res, 404);
    return;
  }

  try {
    let listing = null;
    if (kindParam === 'real_estate') {
      listing = await rpc('seo_real_estate_listing', { p_listing_id: id });
    } else if (kindParam === 'market') {
      listing = await rpc('seo_market_listing', { p_listing_id: id });
    } else {
      listing =
        (await rpc('seo_market_listing', { p_listing_id: id })) ||
        (await rpc('seo_real_estate_listing', { p_listing_id: id }));
    }

    if (!listing || !listing.title) {
      await sendShell(res, 404);
      return;
    }

    const html = await renderListing(listing);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // İlan düzenlenince en geç 10 dakikada tazelenir; CDN bot trafiğini yer.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400');
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    // Geçici hata: Google'a "sonra tekrar gel" demek, sayfayı dizinden
    // düşürmekten daha güvenli.
    console.error('[seo/listing]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Sayfa geçici olarak kullanılamıyor.');
  }
};
