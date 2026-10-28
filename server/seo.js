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
    `<meta property="og:type" content="${escapeHtml(meta.ogType || 'product')}" />`,
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

  if (meta.extraHead) {
    out = out.replace('</head>', `    ${meta.extraHead}\n  </head>`);
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

function availabilityFor(listing) {
  if (listing.status === 'sold') {
    return 'https://schema.org/SoldOut';
  }
  return 'https://schema.org/InStock';
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
        availability: availabilityFor(listing),
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
        availability: availabilityFor(listing),
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
// Programatik hub sayfaları (/trabzon, /trabzon/{ilçe}/{bölüm}/{kategori})
// ---------------------------------------------------------------------------

/**
 * Bölüm adlarının arama diline yakın kısa karşılıkları. Veritabanındaki
 * `name` alanı uzun ve tanıtım amaçlıdır ("İş İlanları ve Kariyer" gibi);
 * başlıkta doğal ve kısa bir ifade kullanmak için bu eşleme tercih edilir.
 */
const SECTION_LABELS = {
  'is-ilanlari': 'İş İlanları',
  emlak: 'Emlak İlanları',
  araclar: 'Araç İlanları',
  'ikinci-el': 'İkinci El Ürünler',
  isletmeler: 'İşletmeler ve Mekânlar',
  'turizm-konaklama': 'Konaklama',
  'ustalar-hizmetler': 'Ustalar ve Hizmetler',
  'telefon-tablet': 'Telefon ve Tablet',
  'bilgisayar-donanim': 'Bilgisayar ve Donanım',
  'elektronik-tv-ses-oyun': 'Elektronik ve Oyun',
  'mobilya-dekorasyon': 'Mobilya ve Dekorasyon',
  'beyaz-esya': 'Beyaz Eşya',
  'yoresel-urunler': 'Yöresel Ürünler',
  'tarim-hayvancilik': 'Tarım ve Hayvancılık',
  'is-makineleri-sanayi': 'İş Makineleri',
  'oto-yedek-parca': 'Oto Yedek Parça',
  'giyim-ayakkabi': 'Giyim ve Ayakkabı',
  'taki-saat-aksesuar': 'Takı ve Saat',
  'anne-bebek': 'Anne ve Bebek',
  'spor-outdoor': 'Spor ve Outdoor',
  'kitap-muzik-hobi': 'Kitap ve Hobi',
  'yapi-market-bahce': 'Yapı Market',
  'egitim-ozel-ders': 'Eğitim ve Özel Ders',
  'organizasyon-etkinlik': 'Organizasyon',
  'evcil-hayvanlar': 'Evcil Hayvanlar',
  'kisisel-bakim-kozmetik': 'Kişisel Bakım',
  'ofis-kirtasiye': 'Ofis ve Kırtasiye',
  'hediyelik-el-sanatlari': 'Hediyelik Ürünler',
  'diger-ilanlar': 'Diğer İlanlar',
};

/**
 * Şehir/ilçe başlığında kullanılan kısa anahtar ifadeler. Uzun bölüm adları
 * ("İşletmeler ve Mekânlar") başlıkta "ve" tekrarına yol açtığı için burada
 * tek kelimelik/doğal karşılıklar tutulur.
 */
const SECTION_SHORT_LABELS = {
  'is-ilanlari': 'İş İlanları',
  emlak: 'Emlak',
  araclar: 'Araçlar',
  'ikinci-el': 'İkinci El',
  isletmeler: 'İşletmeler',
  'turizm-konaklama': 'Konaklama',
  'ustalar-hizmetler': 'Ustalar',
  'telefon-tablet': 'Telefon',
  'bilgisayar-donanim': 'Bilgisayar',
  'elektronik-tv-ses-oyun': 'Elektronik',
  'mobilya-dekorasyon': 'Mobilya',
  'beyaz-esya': 'Beyaz Eşya',
  'yoresel-urunler': 'Yöresel Ürünler',
  'tarim-hayvancilik': 'Tarım',
  'oto-yedek-parca': 'Oto Yedek Parça',
  'is-makineleri-sanayi': 'İş Makineleri',
};

/** Şehir sayfası başlığında önce anılan bölümler (gerçek içeriği olanlar). */
const HUB_TITLE_ORDER = [
  'is-ilanlari',
  'emlak',
  'ikinci-el',
  'araclar',
  'isletmeler',
  'telefon-tablet',
  'bilgisayar-donanim',
  'mobilya-dekorasyon',
  'beyaz-esya',
  'yoresel-urunler',
  'ustalar-hizmetler',
  'turizm-konaklama',
];

function hubSectionLabel(section) {
  if (!section) {
    return '';
  }
  return SECTION_LABELS[section.slug] || section.name || section.slug;
}

function hubAreaName(page) {
  return page.district && page.district.name ? page.district.name : 'Trabzon';
}

function hubUnit(page) {
  return page.mode === 'places' ? 'İşletme' : 'İlan';
}

function hubMode(page, model) {
  if (page.mode === 'places') {
    return 'Adres, puan ve yorumlarla işletmeleri keşfedin.';
  }
  if (page.mode === 'real_estate') {
    return 'Fiyat, oda sayısı ve metrekare bilgileriyle karşılaştırın.';
  }
  if (page.section && page.section.slug === 'is-ilanlari') {
    return 'Başvuru koşullarını inceleyin, ilan sahibiyle iletişime geçin.';
  }
  return 'Fiyat ve durum bilgilerini karşılaştırın, satıcıyla iletişime geçin.';
}

/**
 * Şehir/ilçe sayfasında başlıkta kullanılacak bölüm adları. Yalnızca gerçekten
 * ilanı olan bölümler seçilir; böylece başlık içerikle tutarlı kalır.
 */
function hubCityLabels(page) {
  const sections = Array.isArray(page.sections) ? page.sections : [];
  const bySlug = new Map(sections.map((section) => [section.slug, section]));
  const labels = [];
  for (const slug of HUB_TITLE_ORDER) {
    const section = bySlug.get(slug);
    if (!section) {
      continue;
    }
    const label = SECTION_SHORT_LABELS[slug] || section.name || slug;
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  }
  if (labels.length === 0) {
    const fallback = [...sections]
      .sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0))
      .map((section) => SECTION_SHORT_LABELS[section.slug] || section.name)
      .filter(Boolean);
    labels.push(...fallback);
  }
  return labels.slice(0, 3);
}

function joinTurkish(parts) {
  if (parts.length === 0) {
    return '';
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts.slice(0, -1).join(', ')} ve ${parts[parts.length - 1]}`;
}

function buildHubTitle(page, model) {
  const total = Number(page.total || 0);
  const unit = hubUnit(page);
  const area = model.area;
  const sectionLabel = model.label;

  if (page.mode === 'city' || page.mode === 'district') {
    const labels = hubCityLabels(page);
    if (labels.length === 0) {
      return `${area} İlanları ve İşletmeleri | ${BRAND}`;
    }
    for (let count = labels.length; count > 0; count -= 1) {
      const candidate = `${area} ${joinTurkish(labels.slice(0, count))} | ${BRAND}`;
      if (candidate.length <= 64) {
        return candidate;
      }
    }
    return `${area} İlanları | ${BRAND}`;
  }

  const core = `${area} ${sectionLabel}`;
  const withCount = `${core} — ${total} ${unit} | ${BRAND}`;
  return withCount.length <= 64 ? withCount : `${core} | ${BRAND}`;
}

function buildHubH1(page, model) {
  if (page.mode === 'city' || page.mode === 'district') {
    const labels = hubCityLabels(page);
    return labels.length > 0 ? `${model.area} ${joinTurkish(labels)}` : `${model.area} İlanları ve İşletmeleri`;
  }
  return `${model.area} ${model.label}`;
}

function buildHubDescription(page, model) {
  const total = Number(page.total || 0);
  const topDistricts = (page.districts || []).slice(0, 3).map((district) => district.name);
  const districtSentence =
    topDistricts.length >= 2
      ? page.district
        ? ` Diğer ilçeler: ${topDistricts.join(', ')}.`
        : ` En çok ilan: ${topDistricts.join(', ')}.`
      : '';

  if (page.mode === 'city' || page.mode === 'district') {
    const labels = hubCityLabels(page);
    const list = labels.length > 0 ? ` Öne çıkanlar: ${joinTurkish(labels)}.` : '';
    return truncate(
      `${model.area} genelinde ${total} güncel ilan ve işletme kaydı.${list} İlçe ve kategoriye göre keşfedin.`,
      158,
    );
  }

  const unitPhrase = page.mode === 'places' ? 'işletme kaydı' : 'ilan';
  const labelLower = model.label.toLocaleLowerCase('tr-TR');  return truncate(
    `${model.area} ${labelLower} — ${total} güncel ${unitPhrase}.${districtSentence} ${hubMode(page, model)}`,
    158,
  );
}

function hubModel(page) {
  const area = hubAreaName(page);
  const sectionLabel = hubSectionLabel(page.section);
  const label = page.category && page.category.name ? page.category.name : sectionLabel;
  const canonical = `${SITE}${page.path}`;
  const model = {
    area,
    label: label || 'İlanlar',
    canonical,
    unit: hubUnit(page),
  };
  model.h1 = buildHubH1(page, model);
  model.title = buildHubTitle(page, model);
  model.description = buildHubDescription(page, model);
  model.topDistricts = (page.districts || []).slice(0, 5).map((district) => district.name);
  return model;
}

function hubBreadcrumbs(page) {
  const crumbs = [
    { name: 'Ana Sayfa', url: '/' },
    { name: 'Trabzon', url: '/trabzon' },
  ];
  if (page.district) {
    crumbs.push({ name: page.district.name, url: `/trabzon/${page.district.slug}` });
  }
  if (page.section) {
    crumbs.push({
      name: hubSectionLabel(page.section),
      url: `/trabzon/${page.district ? `${page.district.slug}/` : ''}${page.section.slug}`,
    });
  }
  if (page.category) {
    crumbs.push({ name: page.category.name, url: page.path });
  }
  return crumbs;
}

function hubItemImage(page, item) {
  const bucket =
    page.mode === 'places'
      ? 'place-media'
      : page.mode === 'real_estate'
        ? 'real-estate-media'
        : 'listing-images';
  return mediaUrl(bucket, item.cover_path);
}

function hubItemMeta(page, item) {
  const bits = [];
  if (page.mode === 'places') {
    if (item.category_name) bits.push(item.category_name);
    if (item.district) bits.push(item.district);
    if (Number(item.review_count || 0) > 0 && item.rating != null) {
      bits.push(`${Number(item.rating).toFixed(1)} puan · ${item.review_count} yorum`);
    }
    return bits.join(' · ');
  }

  if (item.price_cents != null) {
    bits.push(formatPrice(item.price_cents, item.currency, item.price_period));
  }
  if (page.mode === 'real_estate') {
    if (item.room_count != null) bits.push(`${item.room_count} oda`);
    if (item.gross_m2 != null) bits.push(`${item.gross_m2} m²`);
  }
  if (item.district) bits.push(item.district);
  return bits.join(' · ');
}

function hubSectionChips(items, title) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  const links = items
    .map(
      (item) =>
        `<a class="tz-chip" href="${SITE}${escapeHtml(item.url)}">${escapeHtml(item.name)}<span>${Number(item.count || 0)}</span></a>`,
    )
    .join('');
  return `<section class="tz-hub__group"><h2>${escapeHtml(title)}</h2><div class="tz-chips">${links}</div></section>`;
}

function hubCard(page, item) {
  const image = hubItemImage(page, item);
  const meta = hubItemMeta(page, item);
  const media = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.title)}" width="400" height="300" loading="lazy" />`
    : '<span class="tz-card__ph" aria-hidden="true"></span>';
  return `<article class="tz-card">
        <a href="${SITE}${escapeHtml(item.url)}">
          ${media}
          <div class="tz-card__body">
            <h3>${escapeHtml(item.title)}</h3>
            ${meta ? `<p class="tz-card__meta">${escapeHtml(meta)}</p>` : ''}
          </div>
        </a>
      </article>`;
}

function formatUpdated(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Istanbul',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function hubIntro(page, model) {
  const total = Number(page.total || 0);
  const updated = formatUpdated(page.updated_at);
  const updatedText = updated ? ` Son güncelleme: ${updated}.` : '';

  if (page.mode === 'city' || page.mode === 'district') {
    const labels = hubCityLabels(page);
    const list = labels.length > 0 ? ` Öne çıkan bölümler: ${joinTurkish(labels)}.` : '';
    return `${model.area} genelinde ${total} yayınlanmış ilan ve işletme kaydı tek sayfada.${list} İlçe ve kategori bağlantılarıyla aradığınız ilanı daraltabilirsiniz.${updatedText}`;
  }

  const topDistricts =
    model.topDistricts.length >= 2
      ? ` ${page.district ? 'Diğer ilçeler' : 'En çok ilan'}: ${model.topDistricts.slice(0, 3).join(', ')}.`
      : '';
  const unitPhrase = page.mode === 'places' ? 'işletme kaydı' : 'ilan';
  if (page.mode === 'places') {
    return `${model.area} genelinde ${total} ${unitPhrase} listeleniyor.${topDistricts} ${hubMode(page, model)}${updatedText}`;
  }
  return `${model.area} genelinde ${model.label.toLocaleLowerCase('tr-TR')} için ${total} güncel ${unitPhrase} listeleniyor.${topDistricts} ${hubMode(page, model)}${updatedText}`;
}

function hubBodyHtml(page, model) {
  const crumbs = hubBreadcrumbs(page)
    .map((crumb, index) =>
      index === 0
        ? `<a href="${SITE}/">${escapeHtml(crumb.name)}</a>`
        : `<a href="${SITE}${escapeHtml(crumb.url)}">${escapeHtml(crumb.name)}</a>`,
    )
    .join(' <span aria-hidden="true">›</span> ');

  const cards = (page.items || []).map((item) => hubCard(page, item)).join('');
  const itemsSection = cards
    ? `<section class="tz-hub__group">
        <h2>Son eklenen ${escapeHtml(model.label.toLocaleLowerCase('tr-TR'))}</h2>
        <div class="tz-grid">${cards}</div>
      </section>`
    : '';

  return `
    <style>
      .tz-hub { max-width: 1120px; margin: 0 auto; padding: 28px 20px 56px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0b1020; background: #ffffff; }
      .tz-hub a { color: inherit; text-decoration: none; }
      .tz-hub__crumbs { font-size: 13px; color: #41506b; margin-bottom: 18px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .tz-hub__crumbs a { color: #2f55d4; }
      .tz-hub__eyebrow { margin: 0 0 8px; font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #5b6b8c; }
      .tz-hub h1 { font-size: 34px; line-height: 1.15; margin: 0 0 12px; letter-spacing: -0.02em; }
      .tz-hub__lede { font-size: 16px; line-height: 1.6; color: #33415c; margin: 0 0 10px; max-width: 820px; }
      .tz-hub__stats { font-size: 13px; color: #5b6b8c; margin: 0 0 26px; }
      .tz-hub__group { margin: 0 0 30px; }
      .tz-hub h2 { font-size: 19px; margin: 0 0 12px; }
      .tz-chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .tz-chip { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #d6deee; background: #f6f8fd; border-radius: 999px; padding: 8px 12px; font-size: 14px; color: #1d2a44; }
      .tz-chip span { font-size: 12px; color: #5b6b8c; background: #e7ecf8; border-radius: 999px; padding: 1px 7px; }
      .tz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
      .tz-card { border: 1px solid #e2e8f4; border-radius: 14px; overflow: hidden; background: #fff; }
      .tz-card img { display: block; width: 100%; height: 160px; object-fit: cover; background: #eef2fa; }
      .tz-card__ph { display: block; height: 160px; background: linear-gradient(135deg, #eef2fa, #e2e8f6); }
      .tz-card__body { padding: 12px 13px 14px; }
      .tz-card h3 { font-size: 15px; line-height: 1.35; margin: 0 0 6px; }
      .tz-card__meta { font-size: 13px; color: #4a5a78; margin: 0; }
      .tz-hub__footer { margin-top: 34px; padding-top: 18px; border-top: 1px solid #e6ebf5; font-size: 13px; color: #5b6b8c; }
      @media (max-width: 560px) { .tz-hub h1 { font-size: 27px; } .tz-hub { padding-top: 20px; } }
    </style>
    <main class="tz-hub">
      <nav class="tz-hub__crumbs" aria-label="breadcrumb">${crumbs}</nav>
      <p class="tz-hub__eyebrow">${escapeHtml(model.area)} · Trabzone</p>
      <h1>${escapeHtml(model.h1)}</h1>
      <p class="tz-hub__lede">${escapeHtml(hubIntro(page, model))}</p>
      <p class="tz-hub__stats">${Number(page.total || 0)} ${escapeHtml(hubUnit(page).toLocaleLowerCase('tr-TR'))} · Güncel fiyat ve iletişim bilgileri</p>
      ${hubSectionChips(page.sections, 'Bölümler')}
      ${hubSectionChips(page.categories, 'Kategoriler')}
      ${itemsSection}
      ${hubSectionChips(page.districts, page.district ? 'Diğer ilçeler' : 'İlçeler')}
      <p class="tz-hub__footer">
        <a href="${SITE}/marketplace">Tüm marketplace ilanları</a> ·
        <a href="${SITE}/marketplace/real-estate">Emlak</a> ·
        <a href="${SITE}/marketplace/places">İşletmeler</a> ·
        <a href="${SITE}/trabzon">Trabzon</a> ·
        <a href="${SITE}/support">Destek</a>
      </p>
    </main>
  `;
}

function hubNoscriptHtml(page, model) {
  return `<div style="max-width:760px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10203f;background:#ffffff">
        <p style="font-size:16px;line-height:1.6;margin:0 0 8px"><strong>${escapeHtml(model.h1)}</strong> — ${Number(page.total || 0)} ${escapeHtml(hubUnit(page).toLocaleLowerCase('tr-TR'))}</p>
        <p style="font-size:14px;line-height:1.6;color:#41506b">${escapeHtml(hubIntro(page, model))}</p>
        <p style="font-size:14px"><a href="${escapeHtml(model.canonical)}" style="color:#2f55d4">Sayfayı Trabzone'da aç</a></p>
      </div>`;
}

function hubItemJsonLd(page, item) {
  const url = `${SITE}${item.url}`;
  if (page.mode === 'places') {
    return {
      '@type': 'LocalBusiness',
      '@id': `${url}#business`,
      url,
      name: String(item.title || ''),
      ...(item.rating != null && Number(item.review_count || 0) > 0
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: Number(item.rating),
              reviewCount: Number(item.review_count),
            },
          }
        : {}),
      address: {
        '@type': 'PostalAddress',
        addressLocality: item.district || 'Trabzon',
        addressRegion: 'Trabzon',
        addressCountry: 'TR',
      },
    };
  }

  const price =
    item.price_cents != null ? (Number(item.price_cents) / 100).toFixed(2) : null;
  const offer = price
    ? {
        '@type': 'Offer',
        price,
        priceCurrency: item.currency || 'TRY',
        availability: 'https://schema.org/InStock',
        url,
      }
    : undefined;

  if (page.mode === 'real_estate') {
    return {
      '@type': 'RealEstateListing',
      '@id': `${url}#listing`,
      url,
      name: String(item.title || ''),
      ...(item.published_at ? { datePosted: item.published_at } : {}),
      address: {
        '@type': 'PostalAddress',
        addressLocality: item.district || 'Trabzon',
        addressRegion: 'Trabzon',
        addressCountry: 'TR',
      },
      ...(item.room_count != null ? { numberOfRooms: item.room_count } : {}),
      ...(offer ? { offers: offer } : {}),
    };
  }

  return {
    '@type': 'Product',
    '@id': `${url}#product`,
    url,
    name: String(item.title || ''),
    ...(item.category_name ? { category: item.category_name } : {}),
    ...(offer ? { offers: offer } : {}),
  };
}

function hubJsonLd(page, model) {
  const crumbs = hubBreadcrumbs(page);
  const items = (page.items || []).map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    url: `${SITE}${item.url}`,
    name: String(item.title || ''),
  }));

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${model.canonical}#breadcrumb`,
        itemListElement: crumbs.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.name,
          item: `${SITE}${crumb.url}`,
        })),
      },
      {
        '@type': 'CollectionPage',
        '@id': `${model.canonical}#page`,
        url: model.canonical,
        name: model.title,
        description: model.description,
        inLanguage: 'tr-TR',
        isPartOf: { '@id': `${SITE}/#website` },
        mainEntity: { '@id': `${model.canonical}#list` },
      },
      {
        '@type': 'ItemList',
        '@id': `${model.canonical}#list`,
        numberOfItems: Number(page.total || 0),
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        itemListElement: items,
      },
      ...(page.items || []).map((item) => hubItemJsonLd(page, item)),
    ],
  };
}

/** Hub sayfasını arama motorları için tam HTML olarak işler. */
async function renderHub(page) {
  const template = await getTemplate();
  const model = hubModel(page);

  let html = applyHead(template, {
    title: model.title,
    description: model.description,
    canonical: model.canonical,
    image: DEFAULT_IMAGE,
    ogType: 'website',
    robots: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
    jsonLd: hubJsonLd(page, model),
  });
  html = applyBody(html, hubBodyHtml(page, model), hubNoscriptHtml(page, model));
  return html;
}

// ---------------------------------------------------------------------------
// Blog
// ---------------------------------------------------------------------------

const BLOG_PATH = '/blog';
const NEWS_PATH = '/haber';

/** Başlıklardan URL parçası üretir; TOC bağlantıları için yeterlidir. */
function headingId(value, used) {
  const base =
    String(value ?? '')
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'bolum';
  let id = base;
  let counter = 2;
  while (used.has(id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  used.add(id);
  return id;
}

/** Satır içi markdown'ı güvenli HTML'e çevirir (önce kaçış, sonra biçim). */
function inlineMarkdown(value) {
  let out = escapeHtml(value);
  out = out.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    '<img src="$2" alt="$1" loading="lazy" decoding="async" />',
  );
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
    '<a href="$2" rel="noopener">$1</a>',
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

/**
 * Blog gövdesini sunucu tarafında HTML'e çevirir.
 *
 * `marked` gibi bir bağımlılık kullanmıyoruz: hem soğuk başlangıcı hızlı tutar
 * hem de yalnızca ihtiyaç duyduğumuz güvenli markdown alt kümesini işler.
 * HTML kaçırıldığı için yazı içine gömülü script çalışmaz.
 */
function markdownToHtml(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const usedIds = new Set();
  const headings = [];
  const html = [];
  let index = 0;

  function flushParagraph(buffer) {
    if (buffer.length === 0) return;
    html.push(`<p>${buffer.map((line) => inlineMarkdown(line.trim())).join('<br />')}</p>`);
    buffer.length = 0;
  }

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();

    if (line === '') {
      index += 1;
      continue;
    }

    // Kod bloğu
    if (line.startsWith('```')) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    // Başlıklar
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/\s+#+\s*$/, '').trim();
      const id = headingId(text, usedIds);
      if (level === 2) headings.push({ id, text });
      html.push(`<h${level} id="${id}">${inlineMarkdown(text)}</h${level}>`);
      index += 1;
      continue;
    }

    // Yatay çizgi
    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      html.push('<hr />');
      index += 1;
      continue;
    }

    // Tablo: başlık satırı + ayırıcı satır
    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      /^\|?\s*:?-{3,}/.test(lines[index + 1].trim())
    ) {
      const rows = [];
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(
          lines[index]
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => cell.trim()),
        );
        index += 1;
      }
      rows.splice(1, 1); // ayırıcı satır
      const [header, ...body] = rows;
      const headHtml = header
        ? `<thead><tr>${header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead>`
        : '';
      const bodyHtml = body.length
        ? `<tbody>${body
            .map(
              (row) =>
                `<tr>${header
                  .map((_, column) => `<td>${inlineMarkdown(row[column] ?? '')}</td>`)
                  .join('')}</tr>`,
            )
            .join('')}</tbody>`
        : '';
      html.push(`<div class="tz-blog__table"><table>${headHtml}${bodyHtml}</table></div>`);
      continue;
    }

    // Listeler
    if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const ordered = /^\d+[.)]\s+/.test(line);
      const items = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const match = ordered ? current.match(/^\d+[.)]\s+(.+)$/) : current.match(/^[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(`<li>${inlineMarkdown(match[1])}</li>`);
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Alıntı
    if (line.startsWith('>')) {
      const quote = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      html.push(`<blockquote>${quote.map((part) => `<p>${inlineMarkdown(part)}</p>`).join('')}</blockquote>`);
      continue;
    }

    // Paragraf
    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (
        next === '' ||
        next.startsWith('#') ||
        next.startsWith('```') ||
        next.startsWith('>') ||
        /^[-*+]\s+/.test(next) ||
        /^\d+[.)]\s+/.test(next) ||
        /^---+$/.test(next) ||
        next.includes('|')
      ) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    flushParagraph(paragraph);
  }

  return { html: html.join('\n'), headings };
}

function formatDateTr(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Istanbul',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function blogCategoriesHtml(categories, active) {
  if (!Array.isArray(categories) || categories.length === 0) return '';
  const chips = categories
    .map((category) => {
      const name = String(category.name || '');
      const isActive = active === name;
      const href = isActive ? `${SITE}${BLOG_PATH}` : `${SITE}${BLOG_PATH}?kategori=${encodeURIComponent(name)}`;
      return `<a class="tz-chip${isActive ? ' tz-chip--active' : ''}" href="${escapeHtml(href)}">${escapeHtml(name)} <span>${Number(category.count || 0)}</span></a>`;
    })
    .join('');
  return `<nav class="tz-chips" aria-label="Blog kategorileri">${chips}</nav>`;
}

function blogCardHtml(post) {
  const url = `${SITE}${BLOG_PATH}/${encodeURIComponent(post.slug)}`;
  const cover = post.cover_image_url
    ? `<img src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.cover_image_alt || post.title)}" loading="lazy" decoding="async" />`
    : '<span class="tz-card__ph" aria-hidden="true"></span>';
  const date = formatDateTr(post.published_at);
  return `<article class="tz-card">
    <a href="${escapeHtml(url)}">${cover}</a>
    <div class="tz-card__body">
      <p class="tz-card__eyebrow">${escapeHtml(post.category || 'Blog')}</p>
      <h3><a href="${escapeHtml(url)}">${escapeHtml(post.title)}</a></h3>
      <p class="tz-card__meta">${escapeHtml(truncate(post.excerpt, 140))}</p>
      <p class="tz-card__foot">${post.reading_minutes ? `${Number(post.reading_minutes)} dk okuma` : ''}${date ? ` · ${escapeHtml(date)}` : ''}</p>
    </div>
  </article>`;
}

function blogIndexJsonLd(page) {
  const items = (page.items || []).map((post, position) => ({
    '@type': 'ListItem',
    position: position + 1,
    url: `${SITE}${BLOG_PATH}/${encodeURIComponent(post.slug)}`,
    name: post.title,
  }));
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${SITE}${BLOG_PATH}#page`,
        url: `${SITE}${BLOG_PATH}`,
        name: 'Trabzon Blog | Trabzone',
        description:
          'Trabzon gezi rehberleri, yaylalar, yemek kültürü, ulaşım, emlak ve günlük yaşam üzerine uzun biçimli yerel rehberler.',
        inLanguage: 'tr-TR',
        isPartOf: { '@type': 'WebSite', '@id': `${SITE}#website`, url: SITE, name: BRAND },
      },
      {
        '@type': 'ItemList',
        '@id': `${SITE}${BLOG_PATH}#list`,
        numberOfItems: Number(page.total || 0),
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        itemListElement: items,
      },
    ],
  };
}

function blogIndexBodyHtml(page, options) {
  const total = Number(page.total || 0);
  const activeCategory = options.category || '';
  const search = options.search || '';
  const offset = Number(page.offset || 0);
  const limit = Number(page.limit || 12);
  const cards = (page.items || []).map((post) => blogCardHtml(post)).join('');
  const prev =
    offset > 0
      ? `<a class="tz-blog__page" href="${SITE}${BLOG_PATH}?sayfa=${Math.max(1, Math.floor(offset / limit))}${activeCategory ? `&kategori=${encodeURIComponent(activeCategory)}` : ''}">← Önceki</a>`
      : '<span></span>';
  const next =
    offset + limit < total
      ? `<a class="tz-blog__page" href="${SITE}${BLOG_PATH}?sayfa=${Math.floor(offset / limit) + 2}${activeCategory ? `&kategori=${encodeURIComponent(activeCategory)}` : ''}">Sonraki →</a>`
      : '<span></span>';

  return `
    <style>
      .tz-blog { max-width: 1120px; margin: 0 auto; padding: 28px 20px 60px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0b1020; background: #fff; }
      .tz-blog a { color: inherit; text-decoration: none; }
      .tz-blog__crumbs { font-size: 13px; color: #41506b; margin-bottom: 18px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .tz-blog__crumbs a { color: #2f55d4; }
      .tz-blog__eyebrow { margin: 0 0 8px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #2f55d4; }
      .tz-blog h1 { font-size: 38px; line-height: 1.12; margin: 0 0 14px; letter-spacing: -.02em; }
      .tz-blog__lede { font-size: 17px; line-height: 1.6; color: #33415c; margin: 0 0 12px; max-width: 780px; }
      .tz-blog__stats { font-size: 13px; color: #5b6b8c; margin: 0 0 22px; }
      .tz-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 26px; }
      .tz-chip { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #d6deee; background: #f6f8fd; border-radius: 999px; padding: 8px 12px; font-size: 14px; color: #1d2a44; }
      .tz-chip span { font-size: 12px; color: #5b6b8c; background: #e7ecf8; border-radius: 999px; padding: 1px 7px; }
      .tz-chip--active { background: #1d2a44; border-color: #1d2a44; color: #fff; }
      .tz-chip--active span { background: rgba(255,255,255,.18); color: #fff; }
      .tz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; }
      .tz-card { border: 1px solid #e2e8f4; border-radius: 16px; overflow: hidden; background: #fff; display: flex; flex-direction: column; }
      .tz-card img, .tz-card__ph { display: block; width: 100%; height: 170px; object-fit: cover; background: linear-gradient(135deg, #eef2fa, #dfe7f7); }
      .tz-card__body { padding: 14px 15px 16px; display: flex; flex-direction: column; flex: 1; }
      .tz-card__eyebrow { margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #2f55d4; }
      .tz-card h3 { font-size: 17px; line-height: 1.35; margin: 0 0 8px; }
      .tz-card__meta { font-size: 14px; line-height: 1.5; color: #4a5a78; margin: 0 0 12px; }
      .tz-card__foot { margin: auto 0 0; font-size: 12px; color: #6b7a96; }
      .tz-blog__pager { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 30px; }
      .tz-blog__page { display: inline-flex; border: 1px solid #d6deee; border-radius: 999px; padding: 9px 16px; font-size: 14px; color: #1d2a44; }
      .tz-blog__empty { border: 1px dashed #c9d4e8; border-radius: 16px; padding: 28px; color: #4a5a78; }
      .tz-blog__footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #e6ebf5; font-size: 13px; color: #5b6b8c; }
      @media (max-width: 560px) { .tz-blog h1 { font-size: 29px; } .tz-blog { padding-top: 20px; } }
    </style>
    <main class="tz-blog">
      <nav class="tz-blog__crumbs" aria-label="breadcrumb"><a href="${SITE}/">Trabzone</a> <span aria-hidden="true">›</span> Blog</nav>
      <p class="tz-blog__eyebrow">Trabzon yerel rehberi</p>
      <h1>Trabzon Blog: Gezi, Yaşam ve Şehir Rehberleri</h1>
      <p class="tz-blog__lede">Trabzon'u gezmek, orada yaşamak veya yatırım yapmak isteyenler için sahadan derlenmiş uzun rehberler. Ulaşım, yaylalar, yemek kültürü, emlak, öğrenci hayatı ve günlük pratikler.</p>
      <p class="tz-blog__stats">${total} yazı · ${page.categories?.length || 0} kategori · Düzenli güncellenir</p>
      <form action="${SITE}${BLOG_PATH}" method="get" role="search" style="margin:0 0 20px;display:flex;gap:8px;max-width:520px">
        <input type="search" name="q" value="${escapeHtml(search)}" placeholder="Blogda ara: yayla, hamsi, kiralık daire…" aria-label="Blogda ara" style="flex:1;border:1px solid #d6deee;border-radius:999px;padding:10px 16px;font-size:14px" />
        <button type="submit" style="border:0;border-radius:999px;background:#1d2a44;color:#fff;padding:10px 18px;font-size:14px;font-weight:600">Ara</button>
      </form>
      ${blogCategoriesHtml(page.categories, activeCategory)}
      ${cards ? `<div class="tz-grid">${cards}</div>` : '<p class="tz-blog__empty">Bu filtreye uygun yazı bulunamadı. Tüm yazılara dönmek için kategori seçimini kaldırın.</p>'}
      <nav class="tz-blog__pager" aria-label="Sayfalama">${prev}${next}</nav>
      <p class="tz-blog__footer"><a href="${SITE}/">Trabzone ana sayfa</a> · <a href="${SITE}/trabzon">Trabzon rehberi</a> · <a href="${SITE}/marketplace">Marketplace</a></p>
    </main>
  `;
}

function blogIndexNoscriptHtml(page) {
  return `<div style="max-width:760px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10203f;background:#fff">
    <h2>Trabzon Blog</h2>
    <p>${Number(page.total || 0)} yazı: ${(page.items || [])
      .slice(0, 6)
      .map((post) => escapeHtml(post.title))
      .join(' · ')}</p>
  </div>`;
}

async function renderBlogIndex(page, options = {}) {
  const template = await getTemplate();
  const filtered = Boolean(options.category || options.search || Number(options.page) > 1);
  let html = applyHead(template, {
    title: options.category
      ? `${options.category} yazıları | Trabzone Blog`
      : 'Trabzon Blog | Gezi, Yaşam ve Şehir Rehberleri',
    description:
      'Trabzon gezi rehberleri, yaylalar, yemek kültürü, ulaşım, emlak ve günlük yaşam üzerine uzun biçimli yerel rehberler.',
    canonical: `${SITE}${BLOG_PATH}`,
    image: DEFAULT_IMAGE,
    ogType: 'website',
    robots: filtered
      ? 'noindex,follow,max-image-preview:large'
      : 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
    jsonLd: blogIndexJsonLd(page),
  });
  html = applyBody(html, blogIndexBodyHtml(page, options), blogIndexNoscriptHtml(page));
  return html;
}

function blogPostModel(post) {
  const canonical = `${SITE}${BLOG_PATH}/${encodeURIComponent(post.slug)}`;
  const baseTitle = post.seo_title || post.title;
  const title =
    baseTitle.length <= 52 ? `${baseTitle} | Trabzone Blog` : baseTitle;
  const description = truncate(post.seo_description || post.excerpt || post.title, 165);
  return {
    canonical,
    title: truncate(title, 70),
    description,
    image: post.cover_image_url || DEFAULT_IMAGE,
    author: post.author_name || 'Trabzone Editör',
    published: post.published_at || post.updated_at,
    modified: post.updated_at || post.published_at,
  };
}

function blogPostJsonLd(post, model) {
  const graph = [
    {
      '@type': 'BlogPosting',
      '@id': `${model.canonical}#post`,
      url: model.canonical,
      headline: post.title,
      description: post.excerpt || model.description,
      image: [model.image],
      datePublished: model.published,
      dateModified: model.modified,
      inLanguage: 'tr-TR',
      articleSection: post.category || 'Genel',
      keywords: Array.isArray(post.keywords) ? post.keywords.join(', ') : undefined,
      wordCount: Number(post.word_count || 0) || undefined,
      author: { '@type': 'Person', name: model.author },
      publisher: {
        '@type': 'Organization',
        name: BRAND,
        url: SITE,
        logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` },
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': model.canonical },
      isPartOf: { '@type': 'Blog', '@id': `${SITE}${BLOG_PATH}#blog`, name: 'Trabzone Blog' },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${model.canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Trabzone', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}${BLOG_PATH}` },
        { '@type': 'ListItem', position: 3, name: post.title, item: model.canonical },
      ],
    },
  ];

  if (Array.isArray(post.faq) && post.faq.length > 0) {
    const questions = post.faq
      .map(blogFaqFields)
      .filter((item) => item.question && item.answer);
    if (questions.length > 0) {
      graph.push({
        '@type': 'FAQPage',
        '@id': `${model.canonical}#faq`,
        mainEntity: questions.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      });
    }
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

// Eski kayıtlarda SSS alanları {q,a} olarak tutulmuş olabilir; yeni kayıtlar
// {question,answer} kullanır. İki biçimi de tek modelde birleştiririz.
function blogFaqFields(item) {
  return {
    question: String(item?.question ?? item?.q ?? '').trim(),
    answer: String(item?.answer ?? item?.a ?? '').trim(),
  };
}

function blogTocHtml(headings) {
  const items = headings
    .filter((heading) => !/sık sorulan sorular/i.test(heading.text))
    .slice(0, 12);
  if (items.length < 3) return '';
  return `<aside class="tz-post__toc" aria-label="İçindekiler">
    <p class="tz-post__toc-title">İçindekiler</p>
    <ol>${items.map((heading) => `<li><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`).join('')}</ol>
  </aside>`;
}

function blogFaqHtml(faq) {
  if (!Array.isArray(faq) || faq.length === 0) return '';
  const items = faq.map(blogFaqFields).filter((item) => item.question && item.answer);
  if (items.length === 0) return '';
  return `<section class="tz-post__faq" aria-labelledby="sss">
    <h2 id="sss">Sık sorulan sorular</h2>
    ${items
      .map(
        (item) => `<details class="tz-post__faq-item">
          <summary>${escapeHtml(item.question)}</summary>
          <p>${escapeHtml(item.answer)}</p>
        </details>`,
      )
      .join('')}
  </section>`;
}

function blogRelatedHtml(related) {
  if (!Array.isArray(related) || related.length === 0) return '';
  return `<section class="tz-post__related" aria-labelledby="ilgili-yazilar">
    <h2 id="ilgili-yazilar">İlgili yazılar</h2>
    <div class="tz-grid">${related.slice(0, 3).map((post) => blogCardHtml(post)).join('')}</div>
  </section>`;
}

function blogPostBodyHtml(post, model, headings) {
  const date = formatDateTr(model.published);
  const updated = formatDateTr(model.modified);
  const tags = Array.isArray(post.tags) ? post.tags.slice(0, 8) : [];
  const cover = post.cover_image_url
    ? `<img class="tz-post__cover" src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.cover_image_alt || post.title)}" />`
    : '';
  const hasInlineFaq = /sık sorulan sorular/i.test(post.body_markdown || '');

  return `
    <style>
      .tz-post { max-width: 1120px; margin: 0 auto; padding: 26px 20px 60px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0b1020; background: #fff; }
      .tz-post a { color: #2f55d4; text-decoration: none; }
      .tz-post__crumbs { font-size: 13px; color: #41506b; margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .tz-post__eyebrow { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #2f55d4; }
      .tz-post h1 { font-size: 40px; line-height: 1.12; margin: 0 0 14px; letter-spacing: -.025em; max-width: 860px; }
      .tz-post__lede { font-size: 18px; line-height: 1.6; color: #33415c; margin: 0 0 16px; max-width: 820px; }
      .tz-post__meta { font-size: 13px; color: #5b6b8c; margin: 0 0 22px; display: flex; flex-wrap: wrap; gap: 6px; }
      .tz-post__cover { display: block; width: 100%; max-height: 460px; object-fit: cover; border-radius: 18px; margin: 0 0 26px; background: #eef2fa; }
      .tz-post__layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 36px; align-items: start; }
      .tz-post__body { min-width: 0; font-size: 17px; line-height: 1.75; color: #1c2740; }
      .tz-post__body h2 { font-size: 27px; line-height: 1.25; margin: 38px 0 12px; letter-spacing: -.015em; }
      .tz-post__body h3 { font-size: 21px; line-height: 1.3; margin: 28px 0 10px; }
      .tz-post__body h4 { font-size: 18px; margin: 22px 0 8px; }
      .tz-post__body p { margin: 0 0 16px; }
      .tz-post__body ul, .tz-post__body ol { margin: 0 0 18px; padding-left: 24px; }
      .tz-post__body li { margin: 0 0 7px; }
      .tz-post__body blockquote { margin: 22px 0; padding: 14px 18px; border-left: 4px solid #2f55d4; background: #f6f8fd; color: #33415c; }
      .tz-post__body code { background: #f1f4fb; padding: 2px 5px; border-radius: 5px; font-size: .92em; }
      .tz-post__body pre { background: #0f172a; color: #e6edf7; padding: 16px; border-radius: 12px; overflow-x: auto; }
      .tz-post__body img { max-width: 100%; height: auto; border-radius: 12px; }
      .tz-blog__table { overflow-x: auto; margin: 0 0 22px; }
      .tz-post__body table { width: 100%; border-collapse: collapse; font-size: 15px; }
      .tz-post__body th, .tz-post__body td { border: 1px solid #dbe3f1; padding: 9px 11px; text-align: left; vertical-align: top; }
      .tz-post__body th { background: #f6f8fd; font-weight: 700; }
      .tz-post__toc { position: sticky; top: 24px; border: 1px solid #e2e8f4; border-radius: 14px; padding: 16px 18px; background: #fbfcff; font-size: 14px; }
      .tz-post__toc-title { margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #5b6b8c; }
      .tz-post__toc ol { margin: 0; padding-left: 18px; }
      .tz-post__toc li { margin: 0 0 7px; line-height: 1.4; }
      .tz-post__faq { margin: 38px 0 0; }
      .tz-post__faq h2 { font-size: 27px; margin: 0 0 14px; }
      .tz-post__faq-item { border: 1px solid #e2e8f4; border-radius: 12px; padding: 12px 15px; margin: 0 0 10px; background: #fff; }
      .tz-post__faq-item summary { cursor: pointer; font-weight: 700; font-size: 16px; }
      .tz-post__faq-item p { margin: 9px 0 0; color: #33415c; }
      .tz-post__tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 26px 0 0; }
      .tz-post__tag { border: 1px solid #d6deee; border-radius: 999px; padding: 5px 11px; font-size: 12px; color: #41506b; }
      .tz-post__related { margin: 44px 0 0; padding-top: 26px; border-top: 1px solid #e6ebf5; }
      .tz-post__related h2 { font-size: 24px; margin: 0 0 16px; }
      .tz-post__cta { margin: 36px 0 0; border: 1px solid #d6deee; border-radius: 16px; padding: 20px; background: linear-gradient(135deg, #f6f8fd, #eef3fc); }
      .tz-post__cta h2 { font-size: 20px; margin: 0 0 8px; }
      .tz-post__cta p { margin: 0 0 14px; color: #33415c; }
      .tz-post__cta a { display: inline-flex; background: #1d2a44; color: #fff; border-radius: 999px; padding: 10px 18px; font-size: 14px; font-weight: 600; }
      .tz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
      .tz-card { border: 1px solid #e2e8f4; border-radius: 14px; overflow: hidden; background: #fff; }
      .tz-card img, .tz-card__ph { display: block; width: 100%; height: 140px; object-fit: cover; background: linear-gradient(135deg, #eef2fa, #dfe7f7); }
      .tz-card__body { padding: 12px 13px 14px; }
      .tz-card__eyebrow { margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #2f55d4; }
      .tz-card h3 { font-size: 15px; line-height: 1.35; margin: 0 0 6px; }
      .tz-card__meta { font-size: 13px; line-height: 1.45; color: #4a5a78; margin: 0 0 8px; }
      .tz-card__foot { margin: 0; font-size: 12px; color: #6b7a96; }
      @media (max-width: 900px) { .tz-post__layout { grid-template-columns: 1fr; } .tz-post__toc { position: static; order: -1; } }
      @media (max-width: 560px) { .tz-post h1 { font-size: 30px; } .tz-post__lede { font-size: 16px; } .tz-post__body { font-size: 16px; } }
    </style>
    <main class="tz-post">
      <nav class="tz-post__crumbs" aria-label="breadcrumb">
        <a href="${SITE}/">Trabzone</a> <span aria-hidden="true">›</span>
        <a href="${SITE}${BLOG_PATH}">Blog</a> <span aria-hidden="true">›</span>
        <span>${escapeHtml(post.category || 'Genel')}</span>
      </nav>
      <p class="tz-post__eyebrow">${escapeHtml(post.category || 'Blog')}</p>
      <h1>${escapeHtml(post.title)}</h1>
      ${post.excerpt ? `<p class="tz-post__lede">${escapeHtml(post.excerpt)}</p>` : ''}
      <p class="tz-post__meta">
        <span>${escapeHtml(model.author)}</span>
        ${date ? `<span>· ${escapeHtml(date)}</span>` : ''}
        ${post.reading_minutes ? `<span>· ${Number(post.reading_minutes)} dk okuma</span>` : ''}
        ${post.word_count ? `<span>· ${Number(post.word_count)} kelime</span>` : ''}
        ${updated && updated !== date ? `<span>· Güncelleme: ${escapeHtml(updated)}</span>` : ''}
      </p>
      ${cover}
      <div class="tz-post__layout">
        <article class="tz-post__body">
          ${markdownToHtml(post.body_markdown).html}
          ${hasInlineFaq ? '' : blogFaqHtml(post.faq)}
          ${tags.length ? `<div class="tz-post__tags">${tags.map((tag) => `<span class="tz-post__tag">#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
          <div class="tz-post__cta">
            <h2>Trabzon'da bir sonraki adım</h2>
            <p>Güncel ilanları, yerel işletmeleri ve topluluk paylaşımlarını Trabzone'da keşfedin.</p>
            <a href="${SITE}/trabzon">Trabzon rehberine git</a>
          </div>
          ${blogRelatedHtml(post.related)}
        </article>
        ${blogTocHtml(headings)}
      </div>
    </main>
  `;
}

function blogPostNoscriptHtml(post, model) {
  return `<div style="max-width:760px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10203f;background:#fff">
    <h2>${escapeHtml(post.title)}</h2>
    <p style="font-size:15px;line-height:1.6;color:#41506b">${escapeHtml(post.excerpt || model.description)}</p>
    <p><a href="${escapeHtml(model.canonical)}" style="color:#2f55d4">Yazıyı Trabzone'da aç</a></p>
  </div>`;
}

/** Tek blog yazısını arama motorları için tam HTML olarak işler. */
async function renderBlogPost(post) {
  const template = await getTemplate();
  const model = blogPostModel(post);
  const parsed = markdownToHtml(post.body_markdown);

  let html = applyHead(template, {
    title: model.title,
    description: model.description,
    canonical: model.canonical,
    image: model.image,
    ogType: 'article',
    robots: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
    jsonLd: blogPostJsonLd(post, model),
    extraHead: `<meta property="article:published_time" content="${escapeHtml(model.published || '')}" />
    <meta property="article:modified_time" content="${escapeHtml(model.modified || '')}" />
    <meta property="article:section" content="${escapeHtml(post.category || 'Genel')}" />
    <meta name="author" content="${escapeHtml(model.author)}" />`,
  });
  html = applyBody(
    html,
    blogPostBodyHtml(post, model, parsed.headings),
    blogPostNoscriptHtml(post, model),
  );
  return html;
}

// ---------------------------------------------------------------------------
// AI Haber Merkezi — /haber/<slug>
// ---------------------------------------------------------------------------

/**
 * DeepSeek destekli haberlerin herkese açık sayfası. İçerik `ai_news_*`
 * RPC'lerinden gelir; yalnızca yayında ve görünür gönderiler döner.
 */
function newsPostModel(post) {
  const canonical = `${SITE}${NEWS_PATH}/${encodeURIComponent(post.slug)}`;
  const title = post.title.length <= 52 ? `${post.title} | Trabzone Haber` : post.title;
  const description = truncate(post.spot || post.title, 165);
  const image = post.media ? mediaUrl('posts', post.media.storage_path) : null;
  return {
    canonical,
    title: truncate(title, 70),
    description,
    image: image || DEFAULT_IMAGE,
    published: post.published_at,
    modified: post.updated_at || post.published_at,
    checked: post.last_checked_at || post.published_at,
  };
}

function newsPostJsonLd(post, model) {
  const sources = (post.sources || []).filter((source) => source.url).slice(0, 10);
  const isSource = post.kind === 'source';
  const graph = [
    {
      '@type': 'NewsArticle',
      '@id': `${model.canonical}#article`,
      url: model.canonical,
      headline: post.title,
      alternativeHeadline: post.spot || undefined,
      description: model.description,
      image: [model.image],
      datePublished: model.published,
      dateModified: model.modified,
      inLanguage: 'tr-TR',
      articleSection: post.category_name || 'Trabzon Gündem',
      isAccessibleForFree: true,
      isPartOf: { '@type': 'WebSite', '@id': `${SITE}#website`, name: 'Trabzone', url: SITE },
      author: isSource
        ? { '@type': 'Organization', name: post.published_by || 'Haber kaynağı', url: post.canonical_source_url || undefined }
        : {
            '@type': 'Organization',
            name: 'Trabzone Haber',
            url: `${SITE}${NEWS_PATH}`,
          },
      publisher: {
        '@type': 'Organization',
        name: BRAND,
        url: SITE,
        logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` },
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': model.canonical },
      contentLocation: post.district
        ? { '@type': 'Place', name: `${post.district}, Trabzon` }
        : undefined,
      citation: sources.map((source) => source.url),
      isBasedOn: isSource ? post.canonical_source_url || undefined : undefined,
      creditText: isSource
        ? `${post.published_by || 'Haber kaynağı'} — kaynak izniyle aktarılmıştır`
        : 'Trabzone Haber — yerel haber',
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${model.canonical}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Trabzone', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Haberler', item: `${SITE}${NEWS_PATH}` },
        { '@type': 'ListItem', position: 3, name: post.title, item: model.canonical },
      ],
    },
  ];
  return { '@context': 'https://schema.org', '@graph': graph };
}

function newsBodyHtml(body) {
  return String(body || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 24)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

function newsStamp(value) {
  const formatted = formatDateTr(value);
  return formatted || '';
}

function newsMediaFigure(post) {
  if (!post.media) {
    return '';
  }
  const src = mediaUrl('posts', post.media.storage_path);
  if (!src) return '';
  const credit = post.media.is_placeholder
    ? 'Trabzone kategori tasarımı — olay fotoğrafı değildir'
    : [post.media.credit, post.media.attribution].filter(Boolean).join(' · ') ||
      'Fotoğraf: kaynakta belirtilen lisans koşullarıyla kullanılmıştır';
  return `<figure class="tz-news__figure">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(post.media.alt_text || post.title)}" loading="eager" />
      <figcaption>${escapeHtml(credit)}</figcaption>
    </figure>`;
}

function newsSourcesHtml(post) {
  const sources = (post.sources || []).filter((source) => source.url);
  if (sources.length === 0) {
    return `<section class="tz-news__block" aria-labelledby="kaynaklar">
      <h2 id="kaynaklar">Kaynaklar</h2>
      <p class="tz-news__muted">Bu haber için herkese açık kaynak bağlantısı kaydedilmemiştir. Düzeltme talebi için destek merkezini kullanabilirsiniz.</p>
    </section>`;
  }
  return `<section class="tz-news__block" aria-labelledby="kaynaklar">
    <h2 id="kaynaklar">Kaynaklar</h2>
    <ol class="tz-news__sources">
      ${sources
        .slice(0, 12)
        .map(
          (source) => `<li>
        <a href="${escapeHtml(source.url)}" rel="nofollow noopener" target="_blank">${escapeHtml(source.title || source.domain)}</a>
        <span class="tz-news__muted">${escapeHtml(source.domain)}${source.kind === 'official' ? ' · resmî kaynak' : ''}</span>
      </li>`,
        )
        .join('')}
    </ol>
  </section>`;
}

function newsTransparencyHtml(post, model) {
  if (post.kind === 'source') {
    const sourceLink = post.canonical_source_url
      ? `<li><strong>Orijinal haber:</strong> <a href="${escapeHtml(post.canonical_source_url)}" rel="nofollow noopener" target="_blank">${escapeHtml(post.canonical_source_url)}</a></li>`
      : '';
    return `<section class="tz-news__block tz-news__transparency" aria-labelledby="kaynak-bilgi">
    <h2 id="kaynak-bilgi">Kaynak ve yayın bilgisi</h2>
    <p>${escapeHtml(post.disclosure || 'Bu haber, kaynağın izin verdiği kapsamda aktarılmıştır.')}</p>
    <ul>
      <li><strong>Yayıncı:</strong> ${escapeHtml(post.published_by || 'Haber kaynağı')}</li>
      <li><strong>Lisans durumu:</strong> ${escapeHtml(post.license_status || 'unverified')}</li>
      ${sourceLink}
      <li><strong>Son kontrol:</strong> ${escapeHtml(newsStamp(model.checked) || 'Belirtilmemiş')}</li>
      <li><strong>Düzeltme talebi:</strong> <a href="${escapeHtml(`${SITE}${post.correction_path || '/support'}`)}">Destek merkezi</a> üzerinden iletilebilir.</li>
    </ul>
    <p class="tz-news__muted">Trabzone, haber kaynağının kimliğini veya doğrulanmış hesap iddiasını devralmaz; içerik kaynağına atıfla yayımlanır.</p>
  </section>`;
  }

  return `<section class="tz-news__block tz-news__transparency" aria-labelledby="haber-bilgi">
    <h2 id="haber-bilgi">Kaynak ve yayın bilgisi</h2>
    <p>${escapeHtml(post.disclosure || 'Bu haber, Trabzone Haber tarafından kamuya açık kaynaklardan yayıma hazırlanmıştır.')}</p>
    <ul>
      <li><strong>Yayıncı:</strong> ${escapeHtml(post.published_by || 'Trabzone Haber')} (Trabzone'un resmî haber hesabı)</li>
      <li><strong>Son kontrol:</strong> ${escapeHtml(newsStamp(model.checked) || 'Belirtilmemiş')}</li>
      <li><strong>Bağımsız kaynak sayısı:</strong> ${Number(post.independent_sources || 0)}</li>
      <li><strong>Düzeltme talebi:</strong> <a href="${escapeHtml(`${SITE}${post.correction_path || '/support'}`)}">Destek merkezi</a> üzerinden iletilebilir.</li>
    </ul>
    <p class="tz-news__muted">Trabzone Haber, kamuya açık kaynaklardaki doğrulanmış bilgileri yerel gündeme taşır.</p>
  </section>`;
}

function newsPostBodyHtml(post, model) {
  const district = post.district ? `${post.district}, Trabzon` : 'Trabzon';
  const eventDate = post.event_date ? formatDateTr(post.event_date) : '';
  const published = newsStamp(model.published);
  const updated = newsStamp(model.modified);
  return `
    <style>
      .tz-news { max-width: 1040px; margin: 0 auto; padding: 24px 18px 64px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0b1020; background: #fff; }
      .tz-news a { color: #2f55d4; text-decoration: none; }
      .tz-news__crumbs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; color: #41506b; margin: 0 0 14px; }
      .tz-news__eyebrow { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #2f55d4; }
      .tz-news h1 { font-size: 40px; line-height: 1.12; letter-spacing: -.025em; margin: 0 0 12px; max-width: 880px; }
      .tz-news__spot { font-size: 18px; line-height: 1.6; color: #33415c; margin: 0 0 14px; max-width: 840px; }
      .tz-news__meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; color: #5b6b8c; margin: 0 0 20px; }
      .tz-news__tag { border: 1px solid #d6deee; border-radius: 999px; padding: 3px 9px; font-size: 12px; color: #33415c; }
      .tz-news__tag--ai { border-color: #b7c6f5; background: #f2f5ff; color: #2f55d4; font-weight: 700; }
      .tz-news__figure { margin: 0 0 24px; }
      .tz-news__figure img { display: block; width: 100%; max-height: 500px; object-fit: cover; border-radius: 16px; background: #eef2fa; }
      .tz-news__figure figcaption { margin-top: 8px; font-size: 12px; color: #6b7a96; }
      .tz-news__body { font-size: 17px; line-height: 1.75; color: #1c2740; max-width: 820px; }
      .tz-news__body p { margin: 0 0 16px; }
      .tz-news__block { max-width: 820px; margin: 34px 0 0; padding-top: 22px; border-top: 1px solid #e6ebf5; }
      .tz-news__block h2 { font-size: 22px; margin: 0 0 12px; }
      .tz-news__sources { margin: 0; padding-left: 22px; font-size: 15px; line-height: 1.6; }
      .tz-news__sources li { margin: 0 0 10px; }
      .tz-news__sources a { font-weight: 600; }
      .tz-news__muted { display: block; color: #6b7a96; font-size: 13px; }
      .tz-news__transparency { background: #f7f9fe; border: 1px solid #dfe6f4; border-radius: 14px; padding: 18px 20px; }
      .tz-news__transparency ul { margin: 0 0 10px; padding-left: 20px; font-size: 14px; line-height: 1.7; color: #33415c; }
      .tz-news__cta { max-width: 820px; margin: 34px 0 0; border: 1px solid #d6deee; border-radius: 16px; padding: 20px; background: linear-gradient(135deg, #f6f8fd, #eef3fc); }
      .tz-news__cta h2 { font-size: 20px; margin: 0 0 8px; }
      .tz-news__cta p { margin: 0 0 14px; color: #33415c; }
      .tz-news__cta a { display: inline-flex; background: #1d2a44; color: #fff; border-radius: 999px; padding: 10px 18px; font-size: 14px; font-weight: 600; }
      @media (max-width: 560px) { .tz-news h1 { font-size: 29px; } .tz-news__spot { font-size: 16px; } .tz-news__body { font-size: 16px; } }
    </style>
    <main class="tz-news">
      <nav class="tz-news__crumbs" aria-label="breadcrumb">
        <a href="${SITE}/">Trabzone</a> <span aria-hidden="true">›</span>
        <a href="${SITE}${NEWS_PATH}">Haberler</a> <span aria-hidden="true">›</span>
        <span>${escapeHtml(post.category_name || 'Trabzon Gündem')}</span>
      </nav>
      <p class="tz-news__eyebrow">${escapeHtml(post.category_name || 'Trabzon Gündem')}</p>
      <h1>${escapeHtml(post.title)}</h1>
      ${post.spot ? `<p class="tz-news__spot">${escapeHtml(post.spot)}</p>` : ''}
      <p class="tz-news__meta">
        <span class="tz-news__tag">${escapeHtml(district)}</span>
        <span class="tz-news__tag">${escapeHtml(post.published_by || 'Trabzone Haber')}</span>
        ${post.kind === 'source'
          ? '<span class="tz-news__tag">Kaynak haber</span>'
          : '<span class="tz-news__tag">Yerel haber</span>'}
        ${published ? `<span>· ${escapeHtml(published)}</span>` : ''}
        ${eventDate ? `<span>· Olay tarihi: ${escapeHtml(eventDate)}</span>` : ''}
        ${updated && updated !== published ? `<span>· Güncelleme: ${escapeHtml(updated)}</span>` : ''}
      </p>
      ${newsMediaFigure(post)}
      <article class="tz-news__body">${newsBodyHtml(post.body)}</article>
      ${newsSourcesHtml(post)}
      ${newsTransparencyHtml(post, model)}
      <div class="tz-news__cta">
        <h2>Trabzon gündemini takip edin</h2>
        <p>Trabzone Haber hesabını takip ederek doğrulanmış yerel gelişmeleri sosyal akışta görebilirsiniz.</p>
        <a href="${SITE}/haber">Tüm haberleri gör</a>
      </div>
    </main>
  `;
}

function newsPostNoscriptHtml(post, model) {
  return `<div style="max-width:760px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10203f;background:#fff">
    <h2>${escapeHtml(post.title)}</h2>
    <p style="font-size:15px;line-height:1.6;color:#41506b">${escapeHtml(post.spot || model.description)}</p>
    <p><a href="${escapeHtml(model.canonical)}" style="color:#2f55d4">Haberi Trabzone'da aç</a></p>
  </div>`;
}

/** Tek AI haberini arama motorları için tam HTML olarak işler. */
async function renderNewsPost(post) {
  const template = await getTemplate();
  const model = newsPostModel(post);

  let html = applyHead(template, {
    title: model.title,
    description: model.description,
    canonical: model.canonical,
    image: model.image,
    ogType: 'article',
    robots: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
    jsonLd: newsPostJsonLd(post, model),
    extraHead: `<meta property="article:published_time" content="${escapeHtml(model.published || '')}" />
    <meta property="article:modified_time" content="${escapeHtml(model.modified || '')}" />
    <meta property="article:section" content="${escapeHtml(post.category_name || 'Trabzon Gündem')}" />
    <meta name="author" content="${escapeHtml(post.published_by || 'Trabzone Haber')}" />`,
  });
  html = applyBody(html, newsPostBodyHtml(post, model), newsPostNoscriptHtml(post, model));
  return html;
}

function newsCardHtml(item) {
  const href = `${SITE}${NEWS_PATH}/${encodeURIComponent(item.slug)}`;
  const image = mediaUrl('posts', item.media_path);
  return `<article class="tz-card">
    ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.title)}" loading="lazy" />` : '<div class="tz-card__ph"></div>'}
    <div class="tz-card__body">
      <p class="tz-card__eyebrow">${escapeHtml(item.category_name || 'Trabzon Gündem')}</p>
      <h3><a href="${href}">${escapeHtml(item.title)}</a></h3>
      <p class="tz-card__meta">${escapeHtml(truncate(item.spot || '', 130))}</p>
      <p class="tz-card__foot">${escapeHtml(formatDateTr(item.published_at) || '')}${item.district ? ` · ${escapeHtml(item.district)}` : ''}</p>
    </div>
  </article>`;
}

/** /haber dizini — yayındaki yerel haberler. */
async function renderNewsIndex(page) {
  const template = await getTemplate();
  const items = Array.isArray(page?.items) ? page.items.slice(0, 48) : [];
  const canonical = `${SITE}${NEWS_PATH}`;
  const title = 'Trabzon Haberleri — Yerel Haber Merkezi | Trabzone';
  const description =
    'Trabzon ve ilçelerinden doğrulanmış yerel gelişmeler. Trabzone Haber tarafından kaynaklı ve güncel haberler.';

  let html = applyHead(template, {
    title: truncate(title, 70),
    description,
    canonical,
    image: DEFAULT_IMAGE,
    robots: 'index,follow,max-image-preview:large',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': `${canonical}#collection`,
      url: canonical,
      name: 'Trabzone Haberleri',
      description,
      inLanguage: 'tr-TR',
      isPartOf: { '@type': 'WebSite', '@id': `${SITE}#website`, name: 'Trabzone', url: SITE },
    },
  });

  const body = `
    <style>
      .tz-news-index { max-width: 1120px; margin: 0 auto; padding: 24px 18px 64px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0b1020; background: #fff; }
      .tz-news-index h1 { font-size: 36px; letter-spacing: -.02em; margin: 0 0 8px; }
      .tz-news-index__lede { font-size: 16px; line-height: 1.6; color: #41506b; margin: 0 0 20px; max-width: 760px; }
      .tz-news-index__note { font-size: 13px; color: #6b7a96; margin: 0 0 24px; }
      .tz-news-index a { color: inherit; text-decoration: none; }
      .tz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
      .tz-card { border: 1px solid #e2e8f4; border-radius: 14px; overflow: hidden; background: #fff; }
      .tz-card img, .tz-card__ph { display: block; width: 100%; height: 150px; object-fit: cover; background: linear-gradient(135deg, #eef2fa, #dfe7f7); }
      .tz-card__body { padding: 12px 14px 15px; }
      .tz-card__eyebrow { margin: 0 0 5px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #2f55d4; }
      .tz-card h3 { font-size: 16px; line-height: 1.35; margin: 0 0 7px; }
      .tz-card__meta { font-size: 13px; line-height: 1.45; color: #4a5a78; margin: 0 0 8px; }
      .tz-card__foot { margin: 0; font-size: 12px; color: #6b7a96; }
    </style>
    <main class="tz-news-index">
      <h1>Trabzon haberleri</h1>
      <p class="tz-news-index__lede">Trabzon ve 18 ilçesinden resmî kaynaklarla doğrulanmış gelişmeler. Kaynaklar ve son kontrol zamanı her haberde belirtilir.</p>
      <p class="tz-news-index__note">Yayıncı: Trabzone Haber · ${items.length ? `${Number(page?.total || items.length)} haber` : 'Henüz yayımlanmış haber yok'}</p>
      ${items.length ? `<div class="tz-grid">${items.map(newsCardHtml).join('')}</div>` : '<p>Yeni doğrulanmış haberler yayımlandıkça burada listelenir.</p>'}
    </main>`;

  const noscript = `<div style="max-width:760px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <h2>Trabzon haberleri</h2>
    <p>${escapeHtml(description)}</p>
  </div>`;

  html = applyBody(html, body, noscript);
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
  markdownToHtml,
  renderBlogIndex,
  renderBlogPost,
  renderHub,
  renderListing,
  renderNewsIndex,
  renderNewsPost,
  NEWS_PATH,
  rpc,
  truncate,
};
