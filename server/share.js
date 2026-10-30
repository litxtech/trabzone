/**
 * Paylaşım sayfası (`/p/{tür}/{anahtar}`).
 *
 * Amaç: WhatsApp, Telegram, X, Instagram DM gibi uygulamalarda paylaşılan
 * Trabzone bağlantısı zengin bir kart olarak görünsün ve dokunulduğunda
 * kullanıcı uygulamada **ilgili içeriğe** düşsün.
 *
 * Akış:
 *   1. Sunucu, `share_card` RPC'sinden herkese açık önizleme verisini okur.
 *   2. Open Graph / Twitter etiketleri ve `al:*` uygulama bağlantıları yazılır.
 *   3. Sayfa mobilde önce `trabzone://...` şemasını dener; uygulama yoksa
 *      önizleme kartı, mağaza bağlantıları ve "Tarayıcıda aç" seçeneği kalır.
 *
 * Sayfa `noindex`: paylaşım adresleri kanonik web adreslerinin kopyasıdır ve
 * özel kullanıcı içeriği arama sonuçlarında görünmemelidir.
 */

const {
  SITE,
  DEFAULT_IMAGE,
  escapeHtml,
  formatPrice,
  mediaUrl,
  rpc,
  truncate,
} = require('./seo');
const { matchShareCard } = require('./match');

const APP_STORE_URL = 'https://apps.apple.com/app/id6825082780';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.litxtech.trabzone';
const IOS_APP_ID = '6825082780';
const ANDROID_PACKAGE = 'com.litxtech.trabzone';

const TYPE_LABELS = {
  post: 'Gönderi',
  reel: 'Reels',
  profile: 'Profil',
  place: 'Mekân',
  listing: 'İlan',
  estate: 'Emlak',
  live: 'Anlık Gelişme',
  earthquake: 'Deprem Kaydı',
  match: 'Maç',
};

/** `/p/...` adresindeki tür adlarını kanonik türlere çevirir. */
const TYPE_ALIASES = {
  gonderi: 'post',
  post: 'post',
  reel: 'reel',
  video: 'reel',
  profil: 'profile',
  profile: 'profile',
  mekan: 'place',
  place: 'place',
  isletme: 'place',
  ilan: 'listing',
  listing: 'listing',
  market: 'listing',
  emlak: 'estate',
  estate: 'estate',
  'real-estate': 'estate',
  gelisme: 'live',
  live: 'live',
  'live-news': 'live',
  live_news: 'live',
  'anlik-haber': 'live',
  breaking: 'live',
  deprem: 'earthquake',
  earthquake: 'earthquake',
  mac: 'match',
  match: 'match',
};

const SHARE_TYPE_SEGMENTS = {
  post: 'gonderi',
  reel: 'reel',
  profile: 'profil',
  place: 'mekan',
  listing: 'ilan',
  estate: 'emlak',
  live: 'gelisme',
  earthquake: 'deprem',
  match: 'mac',
};

function normalizeType(value) {
  const key = String(value || '').trim().toLowerCase();
  return TYPE_ALIASES[key] || '';
}

function sharePath(type, key) {
  const segment = SHARE_TYPE_SEGMENTS[type] || type;
  return `/p/${segment}/${encodeURIComponent(String(key || ''))}`;
}

function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object' || !raw.type) {
    return null;
  }
  const type = normalizeType(raw.type) || raw.type;
  const title = truncate(raw.title || 'Trabzone', 90);
  const description = truncate(raw.description || '', 220);

  const price =
    raw.price_cents === null || raw.price_cents === undefined
      ? ''
      : formatPrice(raw.price_cents, raw.currency, raw.price_period);

  return {
    type,
    label: raw.label || TYPE_LABELS[type] || 'Trabzone',
    title,
    description,
    image: raw.image_path ? mediaUrl(raw.bucket, raw.image_path) : null,
    path: typeof raw.path === 'string' ? raw.path : '/',
    deepLink:
      typeof raw.deep_link === 'string' && raw.deep_link
        ? raw.deep_link
        : `trabzone://${String(raw.path || '/').replace(/^\/+/, '')}`,
    authorName: raw.author_name || '',
    authorUsername: raw.author_username || '',
    metrics: raw.metrics || '',
    location: raw.location || '',
    price,
    publishedAt: raw.published_at || null,
  };
}

async function fetchCard(type, key) {
  if (type === 'earthquake') {
    return fetchEarthquakeCard(key);
  }
  if (type === 'match') {
    return matchShareCard(key);
  }
  const raw = await rpc('share_card', { p_type: type, p_key: key });
  return normalizeCard(raw);
}

/**
 * Deprem kaydı kartı. Değerler yalnızca `earthquake_share_card` RPC'sinden
 * (resmî kaynak kaydı) gelir; kaldırılmış veya bulunamayan kayıt 404 olur.
 */
async function fetchEarthquakeCard(key) {
  let raw;
  try {
    raw = await rpc('earthquake_share_card', { p_key: String(key).toLowerCase() });
  } catch (error) {
    const message = String((error && error.message) || '');
    if (message.includes('earthquake_not_found') || message.includes('earthquake_removed')) {
      return null;
    }
    throw error;
  }
  const card = normalizeCard(raw);
  if (!card) return null;
  return {
    ...card,
    label: TYPE_LABELS.earthquake,
    metrics: 'Resmî sismik kayıt · Tahmin veya erken uyarı değildir',
    publishedAt: raw.occurred_at || null,
  };
}

function cardUrl(type, key, extra = '') {
  return `${SITE}${sharePath(type, key)}${extra}`;
}

function jsonScript(value) {
  // `</script>` kaçışı: JSON içine gömülen metin betiği kapatamasın.
  return JSON.stringify(String(value)).replace(/</g, '\\u003c');
}

/**
 * Önizleme görselinin MIME türü.
 *
 * WhatsApp/Telegram kartı çizerken türü uzantıdan tahmin etmek zorunda
 * kalmasın diye `og:image:type` açıkça yazılır; bilinmeyen uzantıda etiket
 * hiç eklenmez.
 */
function imageMime(url) {
  const path = String(url || '').split('?')[0].toLowerCase();
  if (/\.(jpe?g)$/.test(path)) return 'image/jpeg';
  if (/\.png$/.test(path)) return 'image/png';
  if (/\.webp$/.test(path)) return 'image/webp';
  if (/\.gif$/.test(path)) return 'image/gif';
  return '';
}

function renderSharePage(card, options = {}) {
  const comment = typeof options.comment === 'string' ? options.comment.trim().slice(0, 80) : '';
  const suffix = comment ? `?comment=${encodeURIComponent(comment)}` : '';

  const webUrl = `${SITE}${card.path}${suffix}`;
  const deepLink = `${card.deepLink}${suffix}`;
  const shareUrl = `${SITE}${sharePath(card.type, options.key || card.path.split('/').pop())}${suffix}`;
  const image = card.image || DEFAULT_IMAGE;

  const title = `${card.title} · Trabzone`;
  const description =
    card.description || `${card.label} · Trabzone, Trabzon'un sosyal keşif platformu.`;

  const kickerParts = [card.label];
  if (card.authorUsername) {
    kickerParts.push(`@${card.authorUsername}`);
  }
  if (card.location) {
    kickerParts.push(card.location);
  }

  const facts = [card.price, card.metrics].filter(Boolean).join(' · ');

  const ogType = card.type === 'profile' ? 'profile' : 'article';
  const imageType = imageMime(image);
  const imageTypeTag = imageType
    ? `<meta property="og:image:type" content="${imageType}" />\n`
    : '';

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta name="robots" content="noindex, follow" />
<link rel="canonical" href="${escapeHtml(shareUrl)}" />
<meta name="theme-color" content="#0B1220" />
<meta property="og:type" content="${ogType}" />
<meta property="og:site_name" content="Trabzone" />
<meta property="og:title" content="${escapeHtml(card.title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(shareUrl)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
${imageTypeTag}<meta property="og:image:secure_url" content="${escapeHtml(image)}" />
<meta property="og:image:alt" content="${escapeHtml(card.title)}" />
<meta property="og:locale" content="tr_TR" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(card.title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(image)}" />
<meta name="twitter:image:alt" content="${escapeHtml(card.title)}" />
<meta property="al:ios:url" content="${escapeHtml(deepLink)}" />
<meta property="al:ios:app_store_id" content="${IOS_APP_ID}" />
<meta property="al:ios:app_name" content="Trabzone" />
<meta property="al:android:url" content="${escapeHtml(deepLink)}" />
<meta property="al:android:package" content="${ANDROID_PACKAGE}" />
<meta property="al:android:app_name" content="Trabzone" />
<meta property="al:web:url" content="${escapeHtml(webUrl)}" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 18px calc(24px + env(safe-area-inset-bottom));
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: radial-gradient(120% 80% at 50% 0%, #12224a 0%, #0b1220 55%, #080d18 100%);
    color: #f2f5fb;
  }
  .card {
    width: 100%;
    max-width: 460px;
    border-radius: 26px;
    overflow: hidden;
    background: #101a2f;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 26px 70px rgba(0, 0, 0, 0.45);
  }
  .cover {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    background: linear-gradient(135deg, #17306a, #0b1220);
  }
  .cover-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: linear-gradient(135deg, #17306a, #0b1220);
    color: #9fb4dc;
    font-size: 13px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .body { padding: 22px 22px 24px; }
  .kicker {
    margin: 0 0 10px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #93a8cd;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4f8dff;
    box-shadow: 0 0 0 4px rgba(79, 141, 255, 0.16);
  }
  h1 {
    margin: 0 0 10px;
    font-size: 22px;
    line-height: 1.28;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .desc {
    margin: 0 0 14px;
    font-size: 15px;
    line-height: 1.55;
    color: #c6d3e8;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .facts {
    margin: 0 0 18px;
    font-size: 14px;
    font-weight: 600;
    color: #7fb2ff;
  }
  .actions { display: flex; flex-direction: column; gap: 10px; }
  .btn {
    display: block;
    padding: 14px 18px;
    border-radius: 14px;
    text-align: center;
    text-decoration: none;
    font-size: 15px;
    font-weight: 600;
  }
  .btn-primary { background: #2f6bff; color: #ffffff; }
  .btn-primary:active { background: #2559d8; }
  .btn-ghost {
    background: rgba(255, 255, 255, 0.06);
    color: #d7e2f5;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .hint {
    margin: 14px 0 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: #8ea3c6;
    text-align: center;
  }
  .hint a { color: #7fb2ff; text-decoration: none; }
  .foot {
    margin: 18px 0 0;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    font-size: 12px;
    color: #6f83a6;
    text-align: center;
  }
  .foot a { color: #8ea3c6; text-decoration: none; }
</style>
</head>
<body>
<main class="card">
  ${card.image
    ? `<img class="cover" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.title)}" loading="eager" />`
    : `<div class="cover-fallback">Trabzone</div>`}
  <div class="body">
    <p class="kicker"><span class="dot"></span>${escapeHtml(kickerParts.join(' · '))}</p>
    <h1>${escapeHtml(card.title)}</h1>
    ${description ? `<p class="desc">${escapeHtml(description)}</p>` : ''}
    ${facts ? `<p class="facts">${escapeHtml(facts)}</p>` : ''}
    <div class="actions">
      <a class="btn btn-primary" id="open-app" href="${escapeHtml(deepLink)}" rel="nofollow">Uygulamada aç</a>
      <a class="btn btn-ghost" href="${escapeHtml(webUrl)}" rel="nofollow">Tarayıcıda aç</a>
    </div>
    <p class="hint" id="hint" hidden>
      Uygulama açılmadı mı? <a href="${APP_STORE_URL}" rel="nofollow">App Store</a> ·
      <a href="${PLAY_STORE_URL}" rel="nofollow">Google Play</a>
    </p>
    <noscript>
      <p class="hint">
        Uygulamayı indir: <a href="${APP_STORE_URL}">App Store</a> ·
        <a href="${PLAY_STORE_URL}">Google Play</a>
      </p>
    </noscript>
    <p class="foot"><a href="${SITE}">Trabzone</a> · Trabzon'un sosyal keşif platformu</p>
  </div>
</main>
<script>
(function () {
  var deepLink = ${jsonScript(deepLink)};
  var ua = navigator.userAgent || '';
  var isMobile = /iphone|ipad|ipod|android|mobile/i.test(ua);
  if (!isMobile) return;

  var hint = document.getElementById('hint');
  var timer = null;

  function showHint() {
    if (hint) hint.hidden = false;
  }

  // Sekme gizlenirse uygulama açılmış demektir; ipucunu göstermeyiz.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && timer) {
      clearTimeout(timer);
      timer = null;
    }
  });
  window.addEventListener('pagehide', function () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });

  timer = setTimeout(showHint, 1800);
  setTimeout(function () {
    try {
      window.location.href = deepLink;
    } catch (error) {
      showHint();
    }
  }, 180);
})();
</script>
</body>
</html>`;
}

function renderShareNotFound() {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bağlantı bulunamadı · Trabzone</title>
<meta name="robots" content="noindex, follow" />
<meta name="theme-color" content="#0B1220" />
<style>
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    background: radial-gradient(120% 80% at 50% 0%, #12224a 0%, #0b1220 55%, #080d18 100%);
    color: #f2f5fb;
    text-align: center;
  }
  .box { max-width: 420px; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { color: #a9bade; line-height: 1.6; margin: 0 0 22px; }
  a {
    display: inline-block;
    padding: 13px 22px;
    border-radius: 14px;
    background: #2f6bff;
    color: #fff;
    text-decoration: none;
    font-weight: 600;
  }
</style>
</head>
<body>
  <div class="box">
    <h1>Bu bağlantı artık geçerli değil</h1>
    <p>
      İçerik kaldırılmış, gizlenmiş veya hiç var olmamış olabilir. Trabzone'u açıp
      akıştan devam edebilirsin.
    </p>
    <a href="${SITE}">Trabzone'a git</a>
  </div>
</body>
</html>`;
}

module.exports = {
  ANDROID_PACKAGE,
  APP_STORE_URL,
  IOS_APP_ID,
  PLAY_STORE_URL,
  TYPE_LABELS,
  SHARE_TYPE_SEGMENTS,
  cardUrl,
  fetchCard,
  normalizeCard,
  normalizeType,
  renderShareNotFound,
  renderSharePage,
  sharePath,
};
