/**
 * Eczane rehberi — sunucu tarafında işlenen herkese açık sayfalar.
 *
 * `vercel.json` şu adresleri buraya yönlendirir:
 *   /eczaneler                      → view=index
 *   /eczaneler/<slug>               → view=detail&slug=<slug>
 *   /nobetci-eczaneler              → view=duty
 *   /nobetci-eczaneler/<ilçe-slug>  → view=duty&district=<ilçe-slug>
 *
 * Veriler yalnızca yayındaki eczaneleri dönen `pharmacy_public_page` ve
 * `pharmacies_public_list` RPC'lerinden gelir. Hiçbir eczane, nöbet saati,
 * adres veya puan uydurulmaz; alan yoksa sayfa bunu açıkça söyler.
 */

const { getTemplate, rpc } = require('../server/seo');
const {
  renderPharmacyDetail,
  renderPharmacyDirectory,
} = require('../server/pharmacy-seo');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/;
const PAGE_SIZE = 500;
const MAX_ITEMS = 5000;

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
  const html = template
    .replace(/<meta name="robots"[^>]*>/i, '<meta name="robots" content="noindex, follow" />')
    .replace(/\s*<link rel="canonical"[^>]*>/i, '');
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, follow');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.end(html);
}

/** `pharmacies_public_list` sonuçlarını sayfalayarak toplar. */
async function collectPharmacies(districtName) {
  const items = [];
  let total = 0;
  for (let offset = 0; offset < MAX_ITEMS; offset += PAGE_SIZE) {
    const page = await rpc('pharmacies_public_list', {
      p_district: districtName || null,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    total = Number(page?.total || 0);
    items.push(...pageItems);
    if (pageItems.length < PAGE_SIZE || items.length >= total) {
      break;
    }
  }
  return { items, total: total || items.length };
}

async function bootstrap() {
  const data = await rpc('pharmacies_bootstrap', {});
  return {
    districts: Array.isArray(data?.districts) ? data.districts : [],
    today: data?.today || new Date().toISOString().slice(0, 10),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  const view = String(readParam(req, 'view') || 'index').trim();
  const slug = String(readParam(req, 'slug') || '').trim().toLowerCase();
  const districtSlug = String(readParam(req, 'district') || '').trim().toLowerCase();

  try {
    if (view === 'detail') {
      if (!SLUG_RE.test(slug)) {
        await sendShell(res, 404);
        return;
      }
      const page = await rpc('pharmacy_public_page', { p_slug: slug });
      if (!page || !page.name) {
        await sendShell(res, 404);
        return;
      }
      const html = await renderPharmacyDetail(page);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400');
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }

    if (view !== 'index' && view !== 'duty') {
      await sendShell(res, 404);
      return;
    }

    const meta = await bootstrap();
    let district = null;

    if (view === 'duty' && districtSlug) {
      district =
        meta.districts.find((item) => String(item.slug).toLowerCase() === districtSlug) || null;
      if (!district) {
        // Tanınmayan ilçe: yanlış içerik göstermek yerine 404.
        await sendShell(res, 404);
        return;
      }
    }

    const list = await collectPharmacies(district ? district.name : null);
    const html = await renderPharmacyDirectory({
      mode: view,
      district: district ? { name: district.name, slug: district.slug } : null,
      items: list.items,
      total: list.total,
      districts: meta.districts,
      today: meta.today,
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    // Geçici hata: dizinden düşürmek yerine yeniden deneme iste.
    console.error('[seo/pharmacy]', error && error.message ? error.message : error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Sayfa geçici olarak kullanılamıyor.');
  }
};
