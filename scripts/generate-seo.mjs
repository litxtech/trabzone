#!/usr/bin/env node
/**
 * Post-build SEO generator for the Expo web export.
 * Writes route-specific HTML shells, sitemap.xml, robots.txt and webmanifest.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const SITE = (process.env.EXPO_PUBLIC_APP_URL || 'https://www.trabzoneapp.com').replace(/\/+$/, '');
const SITE_NAME = 'Trabzone';
const OG_IMAGE = `${SITE}/og-image.png`;
const TODAY = new Date().toISOString().slice(0, 10);
const ROBOTS_INDEX = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';

const PAGES = [
  {
    path: '/',
    slug: 'home',
    title: "Trabzone · Trabzon'un Dijital Merkezi",
    description:
      "Trabzon'un sosyal keşif, marketplace, emlak, araç ve harita platformu. Paylaş, keşfet, alışveriş yap ve şehrin topluluğuna katıl.",
    type: 'website',
    priority: '1.0',
    changefreq: 'daily',
    noscriptTitle: "Trabzon'un dijital merkezi",
    noscriptBody:
      'Trabzone; sosyal akış, Reels, mesajlaşma, marketplace, emlak ve araç ilanları ile şehir haritasını tek hesapta birleştirir.',
  },
  {
    path: '/about',
    slug: 'about',
    title: 'Hakkımızda · Trabzone',
    description:
      "Trabzone'un amacı, Trabzon ve çevresindeki insanları, işletmeleri ve fırsatları tek bir dijital platformda buluşturmak.",
    type: 'website',
    priority: '0.8',
    changefreq: 'monthly',
    noscriptTitle: 'Trabzone hakkında',
    noscriptBody:
      'Trabzone, Trabzon için geliştirilmiş sosyal keşif ve ilan platformudur. Yerel topluluk, işletmeler ve şehir hayatı tek çatı altında.',
  },
  {
    path: '/contact',
    slug: 'contact',
    title: 'İletişim · Trabzone',
    description:
      'Trabzone destek ekibine e-posta ile ulaşın, destek merkezini kullanın veya veri taleplerinizi iletin.',
    type: 'website',
    priority: '0.7',
    changefreq: 'monthly',
    noscriptTitle: 'Trabzone ile iletişime geçin',
    noscriptBody:
      'Destek, gizlilik ve veri talepleri için support@litxtech.com adresine yazabilir veya destek merkezini kullanabilirsiniz.',
  },
  {
    path: '/support',
    slug: 'support',
    title: 'Destek Merkezi · Trabzone',
    description:
      'Hesap, giriş, marketplace, emlak, mesajlaşma, güvenlik ve çocuk güvenliği konularında Trabzone destek merkezi.',
    type: 'website',
    priority: '0.7',
    changefreq: 'weekly',
    noscriptTitle: 'Trabzone Destek Merkezi',
    noscriptBody:
      'Sık sorulan sorular, destek kategorileri ve destek talebi oluşturma. Destek ekibi hedeflenen yanıt süresi 24 saattir.',
  },
  {
    path: '/terms',
    slug: 'terms',
    title: 'Kullanım Koşulları · Trabzone',
    description:
      'Trabzone platformunun kullanım şartları, kullanıcı yükümlülükleri ve hizmet kapsamı.',
    type: 'article',
    priority: '0.5',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Kullanım Koşulları',
    noscriptBody:
      'Platformun kullanım şartları, kullanıcı yükümlülükleri ve hizmet kapsamı hakkında yürürlükteki metin.',
  },
  {
    path: '/privacy',
    slug: 'privacy',
    title: 'Gizlilik Politikası · Trabzone',
    description:
      'Hangi verileri topladığımız, nasıl kullandığımız, saklama süreleri ve gizlilik haklarınız.',
    type: 'article',
    priority: '0.5',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Gizlilik Politikası',
    noscriptBody:
      'Kişisel verilerin işlenmesi, saklanması, üçüncü taraflarla paylaşımı ve kullanıcı hakları hakkında bilgilendirme.',
  },
  {
    path: '/kvkk',
    slug: 'kvkk',
    title: 'KVKK Aydınlatma Metni · Trabzone',
    description:
      '6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında Trabzone aydınlatma metni.',
    type: 'article',
    priority: '0.5',
    changefreq: 'yearly',
    noscriptTitle: 'KVKK Aydınlatma Metni',
    noscriptBody:
      '6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında veri sorumlusu, işleme amaçları ve ilgili kişi hakları.',
  },
  {
    path: '/data-protection',
    slug: 'data-protection',
    title: 'Veri Koruma Politikası · Trabzone',
    description:
      'Teknik ve idari veri güvenliği tedbirleri, saklama ve imha yaklaşımımız.',
    type: 'article',
    priority: '0.5',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Veri Koruma Politikası',
    noscriptBody:
      'Veri güvenliği tedbirleri, erişim kontrolleri, saklama süreleri ve imha süreçleri hakkında bilgilendirme.',
  },
  {
    path: '/cookies',
    slug: 'cookies',
    title: 'Çerez Politikası · Trabzone',
    description:
      'Web sitesinde kullanılan çerez türleri, amaçları ve çerez tercihlerinin yönetimi.',
    type: 'article',
    priority: '0.4',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Çerez Politikası',
    noscriptBody:
      'Zorunlu, işlevsel ve ölçümleme çerezleri ile çerez tercihlerinin yönetimi hakkında bilgilendirme.',
  },
  {
    path: '/child-safety',
    slug: 'child-safety',
    title: 'Çocuk Koruma ve Güvenliği Politikası · Trabzone',
    description:
      'Çocuk istismarına sıfır tolerans yaklaşımımız, bildirim süreçleri ve çocuk güvenliği önlemleri.',
    type: 'article',
    priority: '0.5',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Çocuk Koruma Politikası',
    noscriptBody:
      'Çocuk güvenliği ilkeleri, istismar bildirimi, moderasyon ve kolluk kuvvetleriyle iş birliği süreçleri.',
  },
  {
    path: '/community-guidelines',
    slug: 'community-guidelines',
    title: 'Topluluk Kuralları · Trabzone',
    description:
      'Trabzone topluluğunda beklenen davranışlar, yasaklı içerikler ve moderasyon yaklaşımı.',
    type: 'article',
    priority: '0.4',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Topluluk Kuralları',
    noscriptBody:
      'Toplulukta kabul edilen davranışlar, yasaklı içerikler ve ihlal durumunda uygulanan moderasyon adımları.',
  },
  {
    path: '/delete-account',
    slug: 'delete-account',
    title: 'Hesap Silme · Trabzone',
    description:
      'Trabzone hesabınızı web üzerinden kalıcı olarak silin veya giriş yapamıyorsanız güvenli silme talebi oluşturun.',
    type: 'article',
    priority: '0.4',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Hesap Silme',
    noscriptBody:
      'Hesap ve veri silme adımları, silinen veriler, yasal olarak saklanan kayıtlar ve silme talebi süreci.',
  },
  {
    path: '/data-requests',
    slug: 'data-requests',
    title: 'Veri Talepleri · Trabzone',
    description:
      'Kişisel verilerinize erişim, düzeltme, silme ve taşınabilirlik taleplerinizi Trabzone üzerinden iletin.',
    type: 'article',
    priority: '0.4',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Veri Talepleri',
    noscriptBody:
      'KVKK ve GDPR kapsamındaki veri erişim, düzeltme, silme ve taşınabilirlik talepleri için başvuru merkezi.',
  },
  {
    path: '/policy/marketplace-rules',
    slug: 'marketplace-rules',
    title: 'Marketplace Kuralları · Trabzone',
    description:
      'İlan verme, satıcı ve alıcı yükümlülükleri, yasaklı ürünler ve marketplace moderasyonu.',
    type: 'article',
    priority: '0.4',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Marketplace Kuralları',
    noscriptBody:
      'Marketplace ilan kuralları, satıcı ve alıcı sorumlulukları, yasaklı ürünler ve işlem güvenliği.',
  },
  {
    path: '/policy/real-estate-rules',
    slug: 'real-estate-rules',
    title: 'Emlak İlan Kuralları · Trabzone',
    description:
      'Emlak ilanlarında yetki, doğrulama, ilan sorumlulukları ve yasaklı uygulamalar.',
    type: 'article',
    priority: '0.4',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Emlak İlan Kuralları',
    noscriptBody:
      'Emlak ilanlarında yetki belgesi, doğru bilgi, fiyatlandırma ve ilan sorumlulukları.',
  },
  {
    path: '/policy/vehicle-rules',
    slug: 'vehicle-rules',
    title: 'Araç İlan Kuralları · Trabzone',
    description:
      'Araç ilanlarında doğru bilgi, belge, güvenlik ve ilan kuralları.',
    type: 'article',
    priority: '0.4',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Araç İlan Kuralları',
    noscriptBody:
      'Araç ilanlarında kilometre, hasar kaydı, belge ve güvenlik bilgilerinin doğruluğu.',
  },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeXml(value) {
  return escapeHtml(value).replaceAll("'", '&apos;');
}

function absoluteUrl(route) {
  return route === '/' ? `${SITE}/` : `${SITE}${route}`;
}

function pageJsonLd(page) {
  const url = absoluteUrl(page.path);
  const graph = [
    {
      '@type': 'Organization',
      '@id': `${SITE}/#organization`,
      name: SITE_NAME,
      url: `${SITE}/`,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE}/icon-512.png`,
        width: 512,
        height: 512,
      },
      description:
        'Trabzon için sosyal keşif, marketplace, emlak, araç ve şehir haritası platformu.',
      areaServed: { '@type': 'City', name: 'Trabzon' },
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'support@litxtech.com',
        availableLanguage: ['Turkish'],
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE}/#website`,
      url: `${SITE}/`,
      name: SITE_NAME,
      inLanguage: 'tr-TR',
      publisher: { '@id': `${SITE}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE}/marketplace/search?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': page.type === 'article' ? 'Article' : 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: page.title,
      description: page.description,
      inLanguage: 'tr-TR',
      isPartOf: { '@id': `${SITE}/#website` },
      publisher: { '@id': `${SITE}/#organization` },
      ...(page.type === 'article' ? { datePublished: TODAY, dateModified: TODAY } : {}),
    },
  ];

  if (page.path === '/support') {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Trabzone hesabımı nasıl silerim?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Hesap Silme sayfasından oturum açarak hesabınızı kalıcı olarak silebilir veya giriş yapamıyorsanız güvenli silme talebi oluşturabilirsiniz.',
          },
        },
        {
          '@type': 'Question',
          name: 'Destek ekibine nasıl ulaşabilirim?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Destek merkezinden talep oluşturabilir veya support@litxtech.com adresine e-posta gönderebilirsiniz. Hedeflenen yanıt süresi 24 saattir.',
          },
        },
        {
          '@type': 'Question',
          name: 'Kişisel verilerime erişmek için ne yapmalıyım?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Veri Talepleri sayfasından KVKK ve GDPR kapsamındaki erişim, düzeltme, silme ve taşınabilirlik taleplerinizi iletebilirsiniz.',
          },
        },
        {
          '@type': 'Question',
          name: 'Çocuk güvenliği bildirimi nasıl yapılır?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Destek merkezindeki Çocuk Güvenliği kategorisini kullanabilirsiniz. Bu bildirimler öncelikli ve gizli olarak incelenir.',
          },
        },
      ],
    });
  }

  if (page.path !== '/') {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: page.noscriptTitle, item: url },
      ],
    });
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

function headFor(page) {
  const url = absoluteUrl(page.path);
  const verification = process.env.GOOGLE_SITE_VERIFICATION;
  const supabaseHost = (() => {
    try {
      return new URL(process.env.EXPO_PUBLIC_SUPABASE_URL || '').origin;
    } catch {
      return null;
    }
  })();

  return `
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta name="googlebot" content="${ROBOTS_INDEX}" />
    <meta name="author" content="${SITE_NAME}" />
    <meta name="theme-color" content="#0B1220" />
    <meta name="color-scheme" content="dark light" />
    <meta name="apple-mobile-web-app-title" content="${SITE_NAME}" />
    <meta name="application-name" content="${SITE_NAME}" />
    ${verification ? `<meta name="google-site-verification" content="${escapeHtml(verification)}" />` : ''}
    <link rel="canonical" href="${url}" />
    <link rel="alternate" hreflang="tr-TR" href="${url}" />
    <link rel="alternate" hreflang="x-default" href="${url}" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="sitemap" type="application/xml" href="/sitemap.xml" />
    ${supabaseHost ? `<link rel="preconnect" href="${escapeHtml(supabaseHost)}" crossorigin />` : ''}
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:type" content="${page.type === 'article' ? 'article' : 'website'}" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta property="og:image:secure_url" content="${OG_IMAGE}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${SITE_NAME} — ${escapeHtml(page.noscriptTitle)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${escapeHtml(page.description)}" />
    <meta name="twitter:image" content="${OG_IMAGE}" />
    <script type="application/ld+json">${pageJsonLd(page)}</script>`;
}

const BOOT_STYLES = `
    <style id="tz-boot-style">
      html, body { height: 100%; margin: 0; background: #0b1020; }
      body { overflow: hidden; }
      #root { display: flex; height: 100%; flex: 1; }
      .tz-boot {
        position: fixed; inset: 0; z-index: 9999;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px; background: radial-gradient(120% 120% at 50% 0%, #16234a 0%, #0b1020 55%, #05080f 100%);
        color: #eaf0ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .tz-boot__mark {
        width: 64px; height: 64px; border-radius: 18px;
        background: linear-gradient(135deg, #6284ff, #8057f4);
        display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 30px; color: #fff; letter-spacing: -1px;
        box-shadow: 0 18px 50px rgba(98, 132, 255, 0.35);
      }
      .tz-boot__name { font-size: 18px; font-weight: 700; letter-spacing: 4px; }
      .tz-boot__hint { font-size: 12px; color: #93a4c7; letter-spacing: .3px; }
      .tz-boot__bar { width: 112px; height: 3px; border-radius: 999px; background: rgba(147,164,199,.2); overflow: hidden; }
      .tz-boot__bar::after {
        content: ''; display: block; width: 40%; height: 100%; border-radius: inherit;
        background: linear-gradient(90deg, #6284ff, #a78bfa);
        animation: tz-boot-slide 1.1s ease-in-out infinite;
      }
      @keyframes tz-boot-slide { 0% { transform: translateX(-110%); } 100% { transform: translateX(280%); } }
      @media (prefers-reduced-motion: reduce) { .tz-boot__bar::after { animation: none; width: 100%; } }
    </style>`;

const BOOT_MARKUP =
  '<div class="tz-boot"><div class="tz-boot__mark">T</div><div class="tz-boot__name">TRABZONE</div><div class="tz-boot__hint">Yükleniyor…</div><div class="tz-boot__bar"></div></div>';

function noscriptFor(page) {
  return `<noscript>
      <div style="max-width:760px;margin:0 auto;padding:48px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10203f;background:#ffffff">
        <h1 style="font-size:32px;line-height:1.15;margin:0 0 12px">${escapeHtml(page.noscriptTitle)}</h1>
        <p style="font-size:16px;line-height:1.6;color:#41506b">${escapeHtml(page.noscriptBody)}</p>
        <p style="font-size:14px;line-height:1.6;color:#41506b">
          Trabzone&apos;u kullanmak için JavaScript&apos;i etkinleştirin.
        </p>
        <p><a href="${absoluteUrl(page.path)}" style="color:#2f55d4">${escapeHtml(page.title)}</a> ·
          <a href="${SITE}/privacy" style="color:#2f55d4">Gizlilik</a> ·
          <a href="${SITE}/terms" style="color:#2f55d4">Kullanım Koşulları</a> ·
          <a href="${SITE}/support" style="color:#2f55d4">Destek</a>
        </p>
      </div>
    </noscript>`;
}

function inject(template, page) {
  let html = template;
  // Önceki çalıştırmadan kalan SEO bloğunu temizle (idempotent üretim).
  html = html.replace(/<!-- tz-seo:start -->[\s\S]*?<!-- tz-seo:end -->/g, '');
  html = html.replace(/<html[^>]*>/i, '<html lang="tr">');
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '');
  html = html.replace(/<meta\s+charset=["'][^"']*["'][^>]*>/gi, '');
  html = html.replace(/<meta\s+name=["']viewport["'][^>]*>/gi, '');
  html = html.replace(/<meta\s+name=["']theme-color["'][^>]*>/gi, '');
  html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, '');
  html = html.replace(/<meta\s+httpEquiv=["']X-UA-Compatible["'][^>]*>/i, '');
  html = html.replace(/<link\s+rel=["']icon["'][^>]*>/i, '');
  const seoBlock = `<!-- tz-seo:start -->${BOOT_STYLES}\n${headFor(page)}\n<!-- tz-seo:end -->`;
  html = html.replace('</head>', `${seoBlock}\n</head>`);
  html = html.replace(/<div id="root"><\/div>/i, `<div id="root">${BOOT_MARKUP}</div>`);
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/i, noscriptFor(page));
  return html;
}

function sitemap(pages) {
  const urls = pages
    .map(
      (page) => `  <url>
    <loc>${escapeXml(absoluteUrl(page.path))}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function robots() {
  return `# https://www.trabzoneapp.com/robots.txt
User-agent: *
Allow: /
Allow: /assets/
Allow: /_expo/static/

# Oturum gerektiren ve arama sonucunda görünmemesi gereken alanlar
Disallow: /admin
Disallow: /settings
Disallow: /chat
Disallow: /call
Disallow: /compose
Disallow: /login
Disallow: /register
Disallow: /forgot-password
Disallow: /verify
Disallow: /complete-profile
Disallow: /support/my-requests
Disallow: /support/live
Disallow: /marketplace/cart
Disallow: /marketplace/orders
Disallow: /marketplace/create
Disallow: /marketplace/my-listings
Disallow: /ride/create
Disallow: /ride/garage
Disallow: /ride/trips
Disallow: /ride/offers
Disallow: /*?q=
Disallow: /*?ref=

Sitemap: ${SITE}/sitemap.xml
`;
}

function webmanifest() {
  return JSON.stringify(
    {
      name: 'Trabzone',
      short_name: 'Trabzone',
      description:
        "Trabzon'un sosyal keşif, marketplace, emlak, araç ve harita platformu.",
      lang: 'tr-TR',
      dir: 'ltr',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#0B1020',
      theme_color: '#0B1220',
      categories: ['social', 'shopping', 'travel', 'lifestyle'],
      icons: [
        { src: '/favicon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  );
}

async function main() {
  const templatePath = path.join(dist, 'index.html');
  const template = await readFile(templatePath, 'utf8');

  await writeFile(templatePath, inject(template, PAGES[0]), 'utf8');

  const seoDir = path.join(dist, 'seo');
  await mkdir(seoDir, { recursive: true });

  for (const page of PAGES.slice(1)) {
    const html = inject(template, page);
    await writeFile(path.join(seoDir, `${page.slug}.html`), html, 'utf8');
  }

  await writeFile(path.join(dist, 'sitemap.xml'), sitemap(PAGES), 'utf8');
  await writeFile(path.join(dist, 'robots.txt'), robots(), 'utf8');
  await writeFile(path.join(dist, 'site.webmanifest'), webmanifest(), 'utf8');

  // Vercel yönlendirmeleri için rota → statik HTML eşlemesi.
  const routes = PAGES.map((page) => ({
    source: page.path,
    destination: page.slug === 'home' ? '/index.html' : `/seo/${page.slug}.html`,
  }));
  await writeFile(
    path.join(dist, 'seo-routes.json'),
    JSON.stringify({ site: SITE, generatedAt: new Date().toISOString(), routes }, null, 2),
    'utf8',
  );

  console.log(`SEO hazır: ${PAGES.length} sayfa, sitemap.xml, robots.txt, site.webmanifest`);
}

main().catch((error) => {
  console.error('SEO üretimi başarısız:', error);
  process.exit(1);
});

