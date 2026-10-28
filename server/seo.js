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
  renderHub,
  renderListing,
  rpc,
  truncate,
};
