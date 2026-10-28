/**
 * İlan sayfalarını arama motorları için sunucu tarafında işleyen yardımcılar.
 *
 * Vercel sunucu fonksiyonları (`api/*.js`) tarafından kullanılır. Ortak kod
 * `api/` dışında durur ki Vercel bunu ayrı bir fonksiyon olarak yayınlamasın.
 *
 * Akış: Supabase'den ilanı `seo_*` RPC'leriyle oku (anon anahtar, yalnızca
 * yayındaki ilanlar) → Expo web kabuğunu (`dist/index.html`) al → <head>
 * etiketlerini, JSON-LD'yi ve gövde içeriğini ilanla doldur → HTML döndür.
 *
 * Kullanıcı aynı SPA'yı görür (React `#root` içeriğini değiştirir), bot ise
 * tam içeriği JavaScript çalıştırmadan okur.
 */

const { readFileSync } = require('node:fs');
const path = require('node:path');

const SITE = 'https://www.trabzoneapp.com';
const BRAND = 'Trabzone';
const DEFAULT_IMAGE = `${SITE}/og-image.png`;

const PRICE_PERIOD_SUFFIX = {
  total: '',
  month: ' / ay',
  hour: ' / saat',
  service: '',
};

const CONDITION_LABELS = {
  new: 'Sıfır',
  like_new: 'Yeni gibi',
  good: 'İyi',
  fair: 'Kullanılmış',
};

const REAL_ESTATE_KIND_LABELS = {
  rent: 'Kiralık',
  sale: 'Satılık',
  transfer: 'Devren',
};

// ---------------------------------------------------------------------------
// Ortam / Supabase
// ---------------------------------------------------------------------------

function supabaseConfig() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  return { url: url.replace(/\/+$/, ''), key };
}

/** PostgREST üzerinden RPC çağırır. Hata durumunda `null` döner. */
async function rpc(name, args) {
  const { url, key } = supabaseConfig();
  if (!url || !key) {
    throw new Error('supabase_env_missing');
  }
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`rpc_failed ${name} ${response.status} ${detail}`.trim());
  }
  return response.json();
}

/**
 * Depolama yolundan herkese açık medya adresi.
 * R2 yolları `<uid>/r2/...` biçimindedir; eski kayıtlar Supabase Storage'da.
 */
function mediaUrl(bucket, storagePath) {
  if (!storagePath) {
    return null;
  }
  const isR2 = storagePath.split('/')[1] === 'r2';
  if (isR2) {
    const base = process.env.EXPO_PUBLIC_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL || '';
    if (!base) {
      return null;
    }
    return `${base.replace(/\/+$/, '')}/${bucket}/${storagePath}`;
  }
  const { url } = supabaseConfig();
  if (!url) {
    return null;
  }
  return `${url}/storage/v1/object/public/${bucket}/${storagePath}`;
}

// ---------------------------------------------------------------------------
// Biçimlendirme
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

function formatPrice(cents, currency, period) {
  const amount = Number(cents ?? 0) / 100;
  let formatted;
  try {
    formatted = new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: currency || 'TRY',
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    formatted = `${amount.toFixed(0)} ${currency || 'TRY'}`;
  }
  return `${formatted}${PRICE_PERIOD_SUFFIX[period] ?? ''}`;
}

function truncate(value, max) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Şablon (Expo web kabuğu)
// ---------------------------------------------------------------------------

let templateCache = null;

function readTemplateFromFs() {
  const file = path.join(process.cwd(), 'dist', 'index.html');
  return readFileSync(file, 'utf8');
}

async function readTemplateFromDeployment() {
  const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : SITE;
  const response = await fetch(`${host}/index.html`, { headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) {
    throw new Error(`template_fetch_failed ${response.status}`);
  }
  return response.text();
}

/**
 * Expo web `index.html` kabuğu. `includeFiles` ile fonksiyon paketine girer;
 * girmezse aynı dağıtımın statik dosyasından bir kez çekilir.
 */
async function getTemplate() {
  if (templateCache) {
    return templateCache;
  }
  try {
    templateCache = readTemplateFromFs();
  } catch {
    templateCache = await readTemplateFromDeployment();
  }
  return templateCache;
}

// ---------------------------------------------------------------------------
// HTML enjeksiyonu
// ---------------------------------------------------------------------------

function replaceOrInsert(html, pattern, tag) {
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }
  return html.replace('</head>', `    ${tag}\n  </head>`);
}

function applyHead(html, meta) {
  let out = html;

  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);

  out = replaceOrInsert(
    out,
    /<meta name="description"[^>]*>/i,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta name="robots"[^>]*>/i,
    `<meta name="robots" content="${meta.robots}" />`,
  );
  out = replaceOrInsert(
    out,
    /<link rel="canonical"[^>]*>/i,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta property="og:type"[^>]*>/i,
    `<meta property="og:type" content="product" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta property="og:url"[^>]*>/i,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta property="og:image"[^>]*>/i,
    `<meta property="og:image" content="${escapeHtml(meta.image)}" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta property="og:image:secure_url"[^>]*>/i,
    `<meta property="og:image:secure_url" content="${escapeHtml(meta.image)}" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta property="og:image:alt"[^>]*>/i,
    `<meta property="og:image:alt" content="${escapeHtml(meta.title)}" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta name="twitter:title"[^>]*>/i,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta name="twitter:description"[^>]*>/i,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
  );
  out = replaceOrInsert(
    out,
    /<meta name="twitter:image"[^>]*>/i,
    `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`,
  );

  if (meta.image !== DEFAULT_IMAGE) {
    // Kapak görselinin boyutu şablondaki 1200x630 varsayımına uymaz.
    out = out
      .replace(/\s*<meta property="og:image:width"[^>]*>/i, '')
      .replace(/\s*<meta property="og:image:height"[^>]*>/i, '')
      .replace(/\s*<meta property="og:image:type"[^>]*>/i, '');
  }

  // Ana sayfaya ait JSON-LD grafiği bu sayfada yanlış bilgi verir; kendi
  // grafiğimizle değiştiriyoruz.
  const graph = `<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>`;
  if (/<script type="application\/ld\+json">[\s\S]*?<\/script>/i.test(out)) {
    out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/i, graph);
  } else {
    out = out.replace('</head>', `    ${graph}\n  </head>`);
  }

  return out;
}

/**
 * `#root` içindeki önyükleme ekranını korur, arkasına sunucu tarafında
 * işlenmiş içeriği ekler. React ilk render'da bu içeriği değiştirir.
 */
function applyBody(html, bodyHtml, noscriptHtml) {
  let out = html;

  const rootTag = '<div id="root">';
  const start = out.indexOf(rootTag);
  if (start !== -1) {
    const scriptIdx = out.indexOf('<script', start);
    const limit = scriptIdx === -1 ? out.length : scriptIdx;
    const segment = out.slice(start, limit);
    const closeIdx = segment.lastIndexOf('</div>');
    if (closeIdx !== -1) {
      const patched =
        segment.slice(0, closeIdx) + bodyHtml + segment.slice(closeIdx);
      out = out.slice(0, start) + patched + out.slice(limit);
    }
  }

  if (/<noscript>[\s\S]*?<\/noscript>/i.test(out)) {
    out = out.replace(/<noscript>[\s\S]*?<\/noscript>/i, `<noscript>${noscriptHtml}</noscript>`);
  }

  return out;
}

// ---------------------------------------------------------------------------
// İlan → sayfa modeli
// ---------------------------------------------------------------------------

function listingPath(listing) {
  return listing.kind === 'real_estate'
    ? `/marketplace/real-estate/${listing.id}`
    : `/marketplace/${listing.id}`;
}

function buildModel(listing) {
  const isRealEstate = listing.kind === 'real_estate';
  const bucket = isRealEstate ? 'real-estate-media' : 'listing-images';
  const cover = mediaUrl(bucket, listing.cover_path);

  const price = formatPrice(listing.price_cents, listing.currency, listing.price_period);
  const place = [listing.district, listing.city].filter(Boolean).join(', ');
  const kindLabel = isRealEstate
    ? REAL_ESTATE_KIND_LABELS[listing.listing_kind] || 'Emlak'
    : listing.category_name || CONDITION_LABELS[listing.condition] || 'İlan';

  const title = `${listing.title} · ${kindLabel} | ${BRAND}`;
  const description = truncate(
    listing.description
      ? `${listing.title} — ${price}. ${listing.description}`
      : `${listing.title} — ${price}${place ? ` · ${place}` : ''}. Trabzone üzerinden satıcıyla iletişime geç.`,
    155,
  );

  const path = listingPath(listing);
  const canonical = `${SITE}${path}`;

  return {
    isRealEstate,
    path,
    canonical,
    title,
    description,
    price,
    place,
    kindLabel,
    cover,
    imageCount: Number(listing.image_count ?? 0),
  };
}

function buildBodyHtml(listing, model) {
  const details = [];
  details.push(`<p class="tz-seo__price">${escapeHtml(model.price)}</p>`);
  const facts = [];
  if (model.place) facts.push(escapeHtml(model.place));
  if (listing.category_name) facts.push(escapeHtml(listing.category_name));
  if (model.isRealEstate) {
    if (listing.room_count != null) facts.push(`${escapeHtml(String(listing.room_count))} oda`);
    if (listing.gross_m2 != null) facts.push(`${escapeHtml(String(listing.gross_m2))} m² brüt`);
    if (listing.net_m2 != null) facts.push(`${escapeHtml(String(listing.net_m2))} m² net`);
    if (listing.building_age != null) facts.push(`Bina yaşı ${escapeHtml(String(listing.building_age))}`);
  } else if (listing.condition && CONDITION_LABELS[listing.condition]) {
    facts.push(`Durum: ${escapeHtml(CONDITION_LABELS[listing.condition])}`);
  }
  if (facts.length > 0) {
    details.push(`<p class="tz-seo__facts">${facts.join(' · ')}</p>`);
  }

  const descriptionParagraphs = String(listing.description || '')
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');

  const coverHtml = model.cover
    ? `<img src="${escapeHtml(model.cover)}" alt="${escapeHtml(listing.title)}" width="800" height="600" loading="eager" style="max-width:100%;height:auto;border-radius:16px" />`
    : '';

  return `
    <main style="max-width:820px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0b1020;background:#ffffff">
      <nav aria-label="breadcrumb" style="font-size:14px;color:#41506b;margin-bottom:16px">
        <a href="${SITE}/" style="color:#2f55d4;text-decoration:none">Ana Sayfa</a> ›
        <a href="${SITE}/marketplace" style="color:#2f55d4;text-decoration:none">Marketplace</a> ›
        <span>${escapeHtml(listing.title)}</span>
      </nav>
      <h1 style="font-size:28px;line-height:1.2;margin:0 0 12px">${escapeHtml(listing.title)}</h1>
      ${coverHtml}
      ${details.join('')}
      ${descriptionParagraphs}
      <p style="margin-top:24px;font-size:14px;color:#41506b">
        Bu ilan <a href="${escapeHtml(model.canonical)}" style="color:#2f55d4">Trabzone</a> üzerinde yayınlanmıştır.
        ${model.imageCount > 1 ? `${model.imageCount} fotoğraf, ` : ''}iletişim ve güncel fiyat için ilan sayfasını açın.
      </p>
      <p style="font-size:14px">
        <a href="${SITE}/marketplace" style="color:#2f55d4">Tüm ilanlar</a> ·
        <a href="${SITE}/marketplace/real-estate" style="color:#2f55d4">Emlak</a> ·
        <a href="${SITE}/support" style="color:#2f55d4">Destek</a>
      </p>
    </main>
  `;
}

function buildNoscriptHtml(listing, model) {
  // `#root` içeriği JavaScript olmadan da görünür; bu blok yalnızca kısa bir
  // özet verir (aynı H1'i ikinci kez basmamak için başlık kullanılmaz).
  return `
      <div style="max-width:760px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10203f;background:#ffffff">
        <p style="font-size:16px;line-height:1.6;margin:0 0 8px"><strong>${escapeHtml(listing.title)}</strong> — ${escapeHtml(model.price)}${model.place ? ` · ${escapeHtml(model.place)}` : ''}</p>
        <p style="font-size:14px;line-height:1.6;color:#41506b">${escapeHtml(truncate(listing.description || '', 320))}</p>
        <p style="font-size:14px"><a href="${escapeHtml(model.canonical)}" style="color:#2f55d4">İlanı Trabzone'da aç</a></p>
      </div>
  `;
}

function buildJsonLd(listing, model) {
  const graph = [
    {
      '@type': 'BreadcrumbList',
      '@id': `${model.canonical}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Marketplace', item: `${SITE}/marketplace` },
        { '@type': 'ListItem', position: 3, name: String(listing.title), item: model.canonical },
      ],
    },
  ];

  const priceValue = (Number(listing.price_cents ?? 0) / 100).toFixed(2);

  if (model.isRealEstate) {
    graph.push({
      '@type': 'RealEstateListing',
      '@id': `${model.canonical}#listing`,
      url: model.canonical,
      name: String(listing.title),
      description: String(listing.description || listing.title),
      ...(model.cover ? { image: [model.cover] } : {}),
      ...(listing.published_at ? { datePosted: listing.published_at } : {}),
      address: {
        '@type': 'PostalAddress',
        addressLocality: listing.district || 'Trabzon',
        addressRegion: 'Trabzon',
        addressCountry: 'TR',
      },
      ...(listing.gross_m2 != null
        ? { floorSize: { '@type': 'QuantitativeValue', value: listing.gross_m2, unitCode: 'MTK' } }
        : {}),
      ...(listing.room_count != null ? { numberOfRooms: listing.room_count } : {}),
      offers: {
        '@type': 'Offer',
        price: priceValue,
        priceCurrency: listing.currency || 'TRY',
        availability: 'https://schema.org/InStock',
        url: model.canonical,
      },
    });
  } else {
    graph.push({
      '@type': 'Product',
      '@id': `${model.canonical}#product`,
      url: model.canonical,
      name: String(listing.title),
      description: String(listing.description || listing.title),
      sku: String(listing.id),
      ...(model.cover ? { image: [model.cover] } : {}),
      ...(listing.category_name ? { category: listing.category_name } : {}),
      ...(CONDITION_LABELS[listing.condition]
        ? {
            itemCondition: `https://schema.org/${
              listing.condition === 'new' ? 'NewCondition' : 'UsedCondition'
            }`,
          }
        : {}),
      offers: {
        '@type': 'Offer',
        price: priceValue,
        priceCurrency: listing.currency || 'TRY',
        availability: 'https://schema.org/InStock',
        url: model.canonical,
      },
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

/** İlanı sunucu tarafında işlenmiş tam HTML sayfasına dönüştürür. */
async function renderListing(listing) {
  const template = await getTemplate();
  const model = buildModel(listing);
  const bodyHtml = buildBodyHtml(listing, model);
  const noscriptHtml = buildNoscriptHtml(listing, model);
  const jsonLd = buildJsonLd(listing, model);

  let html = applyHead(template, {
    title: model.title,
    description: model.description,
    canonical: model.canonical,
    image: model.cover || DEFAULT_IMAGE,
    robots: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
    jsonLd,
  });
  html = applyBody(html, bodyHtml, noscriptHtml);
  return html;
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

function listingUrl(kind, id) {
  return kind === 'real_estate' ? `${SITE}/marketplace/real-estate/${id}` : `${SITE}/marketplace/${id}`;
}

module.exports = {
  SITE,
  BRAND,
  DEFAULT_IMAGE,
  getTemplate,
  escapeHtml,
  escapeXml,
  formatPrice,
  listingUrl,
  mediaUrl,
  renderListing,
  rpc,
  truncate,
};
