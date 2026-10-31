#!/usr/bin/env node
/**
 * Post-build SEO generator for the Expo web export.
 * Writes route-specific HTML shells, sitemap.xml, robots.txt and webmanifest.
 */
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
    title: 'Trabzone | Trabzon İş İlanları, Emlak ve Marketplace',
    description:
      "Trabzone'da Trabzon iş ilanlarını, kiralık ve satılık evleri, ikinci el ürünleri, araçları ve işletmeleri keşfedin. İlanları inceleyin, paylaşın ve iletişim kurun.",
    type: 'website',
    priority: '1.0',
    changefreq: 'daily',
    noscriptTitle: 'Trabzon iş ilanları, emlak ve marketplace',
    noscriptBody:
      "Trabzone; Trabzon iş ilanları, kiralık ve satılık emlak, ikinci el ürünler, araçlar, yerel işletmeler ve ustalar için tek platform. İlçe ve kategoriye göre ilanları keşfedin, fiyatları karşılaştırın, satıcı ve işletmelerle iletişime geçin.",
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
  {
    path: '/policy/accommodation-guest-rights',
    slug: 'accommodation-guest-rights',
    title: 'Misafir Hakları ve Eşit Konaklama Politikası · Trabzone',
    description:
      'Konaklama işletmelerinin misafir haklarına, eşit hizmete ve zorunlu işletmeci kabul beyanına ilişkin yükümlülükleri.',
    type: 'article',
    priority: '0.4',
    changefreq: 'yearly',
    noscriptTitle: 'Trabzone Misafir Hakları ve Eşit Konaklama Politikası',
    noscriptBody:
      'Ayrımcılık yasağı, bekâr ve evli olmayan misafirlerin konaklama hakkı, kimlik kontrolü, fiyat şeffaflığı ve işletmeci yaptırımları.',
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
  // Birden fazla dogrulama jetonu virgulle ayrilabilir; Search Console
  // yeniden dogrulama baslattiginda jeton degisebildigi icin hepsi basilir.
  const verificationTags = (process.env.GOOGLE_SITE_VERIFICATION || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map(
      (token) =>
        `<meta name="google-site-verification" content="${escapeHtml(token)}" />`,
    )
    .join('\n    ');
  const supabaseHost = (() => {
    try {
      return new URL(process.env.EXPO_PUBLIC_SUPABASE_URL || '').origin;
    } catch {
      return null;
    }
  })();

  return `
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta name="googlebot" content="${ROBOTS_INDEX}" />
    <meta name="author" content="${SITE_NAME}" />
    <meta name="theme-color" content="#0B1220" />
    <meta name="color-scheme" content="dark light" />
    <meta name="apple-mobile-web-app-title" content="${SITE_NAME}" />
    <meta name="application-name" content="${SITE_NAME}" />
    ${verificationTags}
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

/**
 * Açılış kabuğu `#root` dışında sabit bir katmandır; uygulama hazır olunca
 * `src/features/web/boot-shell.ts` onu kaldırır. Ana sayfada (yalnızca `/`)
 * JS beklenmeden gerçek hero (görsel + başlık + giriş bağlantıları) çizilir;
 * böylece LCP, ~5 MB'lık uygulama paketinin inip çalışmasını beklemez.
 * Diğer rotalarda yalnızca yükleniyor ekranı görünür.
 */
const SHELL_ROUTE_SCRIPT = `<script>(function(){var d=document.documentElement,p=location.pathname;d.classList.add('tz-shell-on');if(p==='/'||p==='/index.html'){d.classList.add('tz-home');}})();</script>`;

const BOOT_STYLES = `
    ${SHELL_ROUTE_SCRIPT}
    <style id="tz-boot-style">
      html, body { height: 100%; margin: 0; background: #0b1020; }
      /* Sayfa kaydırması açık: içerik ekran yüksekliğini aştığında tekerlek,
         klavye ve tarayıcı kaydırma çubuğu çalışır. */
      body { overflow-x: hidden; overflow-y: auto; }
      html.tz-shell-on, html.tz-shell-on body { overflow: hidden; }
      #root { display: flex; height: 100%; flex: 1; }
      #tz-shell { position: fixed; inset: 0; z-index: 9999; transition: opacity .2s ease; }
      #tz-shell.tz-shell--out { opacity: 0; pointer-events: none; }
      .tz-hero { display: none; }
      html.tz-home .tz-hero { display: block; }
      html.tz-home .tz-boot { display: none; }
      .tz-hero {
        position: absolute; inset: 0; overflow: hidden; background: #05080f; color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .tz-hero__bar {
        position: absolute; top: 0; left: 0; right: 0; z-index: 2; height: 56px; box-sizing: border-box;
        display: flex; align-items: center; gap: 9px; padding: 0 16px;
        background: rgba(5, 8, 15, .92); border-bottom: 1px solid rgba(120, 150, 220, .16);
      }
      .tz-hero__mark {
        width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #6284ff, #8057f4); font-weight: 800; font-size: 16px;
      }
      .tz-hero__brand { font-weight: 800; font-size: 15px; letter-spacing: 3px; flex: 1; }
      .tz-hero__login { color: #dce6ff; font-size: 13px; font-weight: 600; padding: 8px 12px; }
      /* Görsel tam ekranı kaplamaz (alttan 2px boşluk): Chrome tam ekran
         görselleri arka plan sayıp LCP adayı yapmaz. Üst bar görselin üstüne
         biner; böylece görsel, React hero'sundan (başlığın altında başlar)
         daha büyük kalır ve LCP JS paketini beklemez. */
      .tz-hero__stage { position: absolute; top: 0; left: 0; right: 0; bottom: 2px; overflow: hidden; padding-top: 56px; }
      .tz-hero__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .tz-hero__shade {
        position: absolute; inset: 0;
        background:
          linear-gradient(180deg, rgba(4,7,14,0) 0%, rgba(4,7,14,.55) 60%, rgba(4,7,14,.9) 100%),
          linear-gradient(135deg, rgba(4,7,14,.94) 0%, rgba(8,18,40,.88) 50%, rgba(12,23,48,.8) 100%);
      }
      .tz-hero__inner {
        position: relative; box-sizing: border-box; max-width: 1280px; margin: 0 auto;
        padding: 46px 24px 40px; display: flex; flex-direction: column; gap: 14px;
      }
      .tz-hero__chip {
        align-self: flex-start; display: inline-flex; align-items: center; gap: 7px; margin: 0;
        padding: 6px 11px; border-radius: 999px; background: rgba(65,105,245,.14);
        border: 1px solid rgba(100,140,240,.28); color: #9db6ff; font-size: 10px; font-weight: 700; letter-spacing: 1.1px;
      }
      .tz-hero__chip::before { content: ''; width: 6px; height: 6px; border-radius: 3px; background: #4ad295; }
      .tz-hero__word {
        margin: 2px 0 0; font-size: 44px; line-height: 1.16; font-weight: 800; letter-spacing: .06em;
        background: linear-gradient(90deg, #fff, #9db6ff 55%, #a78bfa); -webkit-background-clip: text;
        background-clip: text; color: transparent;
      }
      .tz-hero__title { margin: 0; max-width: 560px; font-size: 23px; line-height: 32px; font-weight: 700; letter-spacing: -.4px; }
      .tz-hero__desc { margin: 0; max-width: 510px; font-size: 15.5px; line-height: 24px; color: #a7b4cf; }
      .tz-hero__actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
      .tz-hero__btn {
        display: inline-flex; align-items: center; justify-content: center; height: 50px; box-sizing: border-box;
        padding: 0 18px; border-radius: 14px; color: #fff; font-size: 14px; font-weight: 700;
      }
      .tz-hero__btn--primary { min-width: 150px; background: linear-gradient(135deg, #6284ff, #8057f4); }
      .tz-hero__btn--glass { background: rgba(255,255,255,.07); border: 1px solid rgba(170,195,245,.26); }
      @media (max-width: 379px) { .tz-hero__word { font-size: 38px; } }
      @media (min-width: 720px) { .tz-hero__word { font-size: 48px; } }
      @media (min-width: 1024px) {
        .tz-hero__bar { height: 72px; padding: 0 28px; }
        .tz-hero__stage { padding-top: 72px; }
        .tz-hero__inner { min-height: 640px; justify-content: center; padding: 54px 24px 48px; }
        .tz-hero__word { font-size: 66px; }
        .tz-hero__title { font-size: 31px; line-height: 42px; }
      }
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
    </style>
    <style id="tz-global-style">
      /*
       * Dokunma güvenilirliği:
       * Mobil tarayıcılar, çift dokunuşla yakınlaştırmayı beklerken ilk
       * dokunuşu ~300 ms geciktirir ve bu sırada bazı dokunuşları yutar.
       * "touch-action: manipulation" bu beklemeyi kaldırır; butonların
       * "bazen çalışıp bazen çalışmaması" şikâyetinin ana nedeni buydu.
       */
      html, body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
      body { -webkit-tap-highlight-color: transparent; overflow-x: hidden; overflow-y: auto; }
      *, *::before, *::after { -webkit-tap-highlight-color: transparent; }
      a, button, input[type="submit"], [role="button"], [role="link"], [role="menuitem"], [role="tab"] {
        cursor: pointer;
        touch-action: manipulation;
      }
      /* Dokunma geri bildirimi JS'e bağlı olmadığı için her zaman çalışır. */
      a:active, button:active, [role="button"]:active, [role="link"]:active {
        opacity: 0.72;
      }
      a { text-decoration: none; color: inherit; }
      input, textarea, select { touch-action: manipulation; }
      a:focus-visible, button:focus-visible,
      [role="button"]:focus-visible, [role="link"]:focus-visible {
        outline: 2px solid #7fa0ff;
        outline-offset: 2px;
      }
      ::selection { background: rgba(65, 105, 245, 0.35); }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
          scroll-behavior: auto !important;
        }
      }
    </style>`;

const BOOT_MARKUP =
  '<div class="tz-boot"><div class="tz-boot__mark">T</div><div class="tz-boot__name">TRABZONE</div><div class="tz-boot__hint">Yükleniyor…</div><div class="tz-boot__bar"></div></div>';

/** Masaüstü için `public/` altındaki daha yüksek çözünürlüklü hero varyantı. */
const HERO_WIDE = { path: '/hero-trabzon-1800.webp', width: 1800 };
const HERO_NARROW_WIDTH = 1280;

/**
 * Metro dışa aktarımı hero görselini içerik hash'iyle adlandırır; uygulama
 * aynı adresi kullandığından kabuk ile React aynı dosyayı paylaşır (tek indirme).
 */
async function findHeroImage() {
  const dir = path.join(dist, 'assets', 'assets', 'web');
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const name = files.find((file) => /^hero-trabzon\.[0-9a-f]+\.webp$/.test(file));
  if (!name) {
    return null;
  }
  const narrow = `/assets/assets/web/${name}`;
  let wide = null;
  try {
    await access(path.join(dist, HERO_WIDE.path.slice(1)));
    wide = HERO_WIDE.path;
  } catch {
    wide = null;
  }
  return { narrow, wide };
}

function heroMarkup(hero) {
  const srcset = hero.wide
    ? ` srcset="${hero.narrow} ${HERO_NARROW_WIDTH}w, ${hero.wide} ${HERO_WIDE.width}w" sizes="100vw"`
    : '';
  return `<div class="tz-hero">
      <div class="tz-hero__bar"><span class="tz-hero__mark">T</span><span class="tz-hero__brand">TRABZONE</span><a class="tz-hero__login" href="/login">Giriş</a></div>
      <div class="tz-hero__stage">
        <img class="tz-hero__img" src="${hero.narrow}"${srcset} width="${HERO_NARROW_WIDTH}" height="711" alt="Trabzon şehir manzarası" fetchpriority="high" />
        <div class="tz-hero__shade"></div>
        <div class="tz-hero__inner">
          <p class="tz-hero__chip">TRABZON&apos;UN DİJİTAL MERKEZİ</p>
          <p class="tz-hero__word" aria-hidden="true">TRABZONE</p>
          <h1 class="tz-hero__title">Bir Şehirden Daha Fazlası. Birlikte Daha Güçlüyüz.</h1>
          <p class="tz-hero__desc">Paylaş, keşfet, yeni insanlarla tanış ve Trabzon&apos;un dijital dünyasına katıl.</p>
          <div class="tz-hero__actions">
            <a class="tz-hero__btn tz-hero__btn--primary" href="/register">Hemen Katıl</a>
            <a class="tz-hero__btn tz-hero__btn--glass" href="/login">Giriş Yap</a>
          </div>
        </div>
      </div>
    </div>`;
}

/**
 * Ana sayfa hero'su `tz-home` işaretleri arasında durur; `server/seo.js` bu
 * dosyayı başka sayfalar için şablon olarak kullanırken bloğu çıkarır.
 */
function shellFor(page, hero) {
  const home = page.slug === 'home' && hero ? `<!-- tz-home:start -->${heroMarkup(hero)}<!-- tz-home:end -->` : '';
  return `<!-- tz-shell:start --><div id="tz-shell">${home}${BOOT_MARKUP}</div><!-- tz-shell:end -->`;
}

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

function inject(template, page, hero) {
  let html = template;
  // Önceki çalıştırmadan kalan SEO bloğunu temizle (idempotent üretim).
  html = html.replace(/<!-- tz-seo:start -->[\s\S]*?<!-- tz-seo:end -->/g, '');
  html = html.replace(/<!-- tz-shell:start -->[\s\S]*?<!-- tz-shell:end -->/g, '');
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
  html = html.replace(/<div id="root">/i, `${shellFor(page, hero)}\n    <div id="root">`);
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/i, noscriptFor(page));
  return html;
}

function sitemap(pages) {
  // hreflang bağlantıları sitemap şemasında xhtml ad alanıyla verilir; Google
  // tek dilli sitelerde de bu bildirimi kabul eder ve dil/ülke hedeflemesini
  // netleştirir. Aynı adres x-default olarak işaretlenir.
  const urls = pages
    .sort((a, b) => Number(b.priority) - Number(a.priority))
    .map((page) => {
      const loc = escapeXml(absoluteUrl(page.path));
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
    <xhtml:link rel="alternate" hreflang="tr-TR" href="${loc}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}" />
  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

/**
 * Site haritası dizini: statik sayfalar + dinamik ilan haritası.
 * `/sitemap-listings.xml` Vercel fonksiyonundan (`api/sitemap-listings.js`)
 * yayındaki ilanları okur; burada yalnızca adresi bildirilir.
 */
function sitemapIndex() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${SITE}/sitemap-pages.xml</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE}/sitemap-listings.xml</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE}/sitemap-hubs.xml</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE}/sitemap-blog.xml</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE}/sitemap-news.xml</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE}/sitemap-live-news.xml</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE}/sitemap-pharmacy.xml</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE}/sitemap-sports.xml</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>
</sitemapindex>
`;
}

function robots() {
  return `# https://www.trabzoneapp.com/robots.txt
User-agent: *
Allow: /
Allow: /assets/
Allow: /_expo/static/

# İlan sayfalarını sunan sunucu fonksiyonu; asıl adres /marketplace/<id>.
Disallow: /api/

# Oturum gerektiren ve arama sonucunda görünmemesi gereken alanlar
Disallow: /admin
Disallow: /settings
Disallow: /legal/consent
Disallow: /chat
Disallow: /call
Disallow: /compose
Disallow: /feed
Disallow: /reels
Disallow: /discover
Disallow: /messages
Disallow: /notifications
Disallow: /profile
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
Disallow: /trabzonspor/bildirimler
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

/**
 * Universal links (iOS) doğrulama dosyası.
 *
 * Yalnızca `/p/*` (paylaşım) ve doğrudan içerik yolları taleb edilir; pazarlama
 * ve hukuki sayfalar tarayıcıda kalır. Apple Team ID `eas.json` içindeki
 * hesaptan gelir; farklı bir hesapta `APPLE_TEAM_ID` ile geçersiz kılınır.
 */
function appleAppSiteAssociation() {
  const teamId = (process.env.APPLE_TEAM_ID || '9W6CR7KXM7').trim();
  const bundleId = (process.env.APPLE_BUNDLE_ID || 'com.litxtech.trabzone').trim();
  const components = [
    { '/': '/p/*', comment: 'Paylaşım bağlantıları' },
    { '/': '/post/*' },
    { '/': '/reel/*' },
    { '/': '/profile/*' },
    { '/': '/marketplace/place/*' },
    { '/': '/business/*' },
    { '/': '/eczaneler/*', comment: 'Eczane rehberi ve nöbet detayları' },
    { '/': '/nobetci-eczaneler/*', comment: 'İlçe nöbetçi eczane listeleri' },
    { '/': '/deprem', comment: 'Deprem Merkezi' },
    { '/': '/deprem/*', comment: 'Deprem kaydı ayrıntıları' },
  ];

  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${bundleId}`],
          components,
        },
      ],
    },
  };
}

/**
 * Android App Links doğrulama dosyası.
 *
 * İmza parmak izi (SHA-256) olmadan doğrulama yapılamaz; bu durumda dosya boş
 * dizi döner ve Android bağlantıları tarayıcıda açar. Paylaşım sayfasındaki
 * `trabzone://` denemesi sayesinde uygulama yine de açılır.
 */
function androidAssetLinks() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 || '')
    .split(/[\s,]+/)
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(value));
  if (fingerprints.length === 0) {
    return [];
  }
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: (process.env.ANDROID_PACKAGE || 'com.litxtech.trabzone').trim(),
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

async function main() {
  const templatePath = path.join(dist, 'index.html');
  const template = await readFile(templatePath, 'utf8');
  const hero = await findHeroImage();
  if (!hero) {
    console.warn('Uyarı: hero görseli dist içinde bulunamadı; ana sayfa yalnızca yükleniyor ekranıyla açılacak.');
  }
  await writeFile(templatePath, inject(template, PAGES[0], hero), 'utf8');

  const seoDir = path.join(dist, 'seo');
  await mkdir(seoDir, { recursive: true });

  for (const page of PAGES.slice(1)) {
    const html = inject(template, page, hero);
    await writeFile(path.join(seoDir, `${page.slug}.html`), html, 'utf8');
  }

  await writeFile(path.join(dist, 'sitemap-pages.xml'), sitemap(PAGES), 'utf8');
  await writeFile(path.join(dist, 'sitemap.xml'), sitemapIndex(), 'utf8');

  await writeFile(path.join(dist, 'robots.txt'), robots(), 'utf8');
  await writeFile(path.join(dist, 'site.webmanifest'), webmanifest(), 'utf8');

  // Uygulama bağlantıları: iOS universal links ve Android App Links.
  const wellKnownDir = path.join(dist, '.well-known');
  await mkdir(wellKnownDir, { recursive: true });
  await writeFile(
    path.join(wellKnownDir, 'apple-app-site-association'),
    JSON.stringify(appleAppSiteAssociation(), null, 2),
    'utf8',
  );
  await writeFile(
    path.join(wellKnownDir, 'assetlinks.json'),
    JSON.stringify(androidAssetLinks(), null, 2),
    'utf8',
  );

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

