/**
 * Anlık gelişme herkese açık web sayfası (`/anlik-haber/{post_id}`).
 *
 * Kanonik içerik kimliği gönderi kimliğidir. Sayfa yalnızca
 * `live_news_public_post` RPC'sinden gelen, moderasyondan geçmiş ve web
 * hedefi seçilmiş içerikleri gösterir.
 *
 * Arama motoru politikası:
 * - Doğrulanmış / düzeltilmiş içerik: `index,follow` + NewsArticle JSON-LD.
 * - Vatandaş paylaşımı (doğrulanmamış): `noindex,follow`; profesyonel haber
 *   structured data'sı üretilmez. Böylece doğrulanmamış bir iddia Google
 *   News'e "haber" olarak taşınmaz.
 */

const {
  SITE,
  DEFAULT_IMAGE,
  applyBody,
  applyHead,
  escapeHtml,
  getTemplate,
  mediaUrl,
  truncate,
} = require('./seo');

const LIVE_NEWS_PATH = '/anlik-haber';

const CATEGORY_LABELS = {
  traffic: 'Trafik & Ulaşım',
  weather: 'Hava Durumu',
  event: 'Etkinlik',
  sports: 'Spor',
  current: 'Güncel',
  safety: 'Güvenlik',
  infrastructure: 'Altyapı',
  other: 'Diğer',
};

const VERIFICATION_LABELS = {
  citizen: 'Vatandaş Paylaşımı',
  reviewing: 'İnceleniyor',
  verified: 'Bilgiler Doğrulandı',
  corrected: 'Düzeltildi',
  unverified: 'Doğrulanamadı',
  removed: 'Kaldırıldı',
};

const INDEXABLE_STATUSES = new Set(['verified', 'corrected']);

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateTr(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function categoryLabel(value) {
  return CATEGORY_LABELS[value] || 'Anlık Gelişme';
}

function verificationLabel(value) {
  return VERIFICATION_LABELS[value] || VERIFICATION_LABELS.citizen;
}

function mediaList(post) {
  return Array.isArray(post.media) ? post.media.filter(Boolean) : [];
}

function imageFor(post) {
  const media = mediaList(post);
  const image = media.find((item) => item.media_type === 'image');
  if (image) {
    return mediaUrl('posts', image.storage_path);
  }
  const video = media.find((item) => item.media_type === 'video' && item.thumbnail_path);
  return video ? mediaUrl('posts', video.thumbnail_path) : null;
}

function videoFor(post) {
  const video = mediaList(post).find((item) => item.media_type === 'video');
  return video ? mediaUrl('posts', video.storage_path) : null;
}

function liveNewsModel(post) {
  const canonical = `${SITE}${LIVE_NEWS_PATH}/${encodeURIComponent(post.post_id)}`;
  const suffix = ' | Trabzone';
  const title = post.title.length + suffix.length <= 70 ? `${post.title}${suffix}` : post.title;
  const description = truncate(
    post.summary || `${post.district || 'Trabzon'} · ${verificationLabel(post.verification_status)}`,
    165,
  );
  const image = imageFor(post) || DEFAULT_IMAGE;
  const indexable = INDEXABLE_STATUSES.has(post.verification_status);

  return {
    canonical,
    title,
    description,
    image,
    published: post.published_at || post.created_at,
    modified: post.updated_at || post.published_at || post.created_at,
    indexable,
  };
}

function liveNewsJsonLd(post, model) {
  const authorName = post.author?.display_name || post.author?.username || 'Trabzone kullanıcısı';
  const breadcrumbs = {
    '@type': 'BreadcrumbList',
    '@id': `${model.canonical}#breadcrumbs`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Trabzone', item: SITE },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Anlık Gelişmeler',
        item: `${SITE}${LIVE_NEWS_PATH}`,
      },
      { '@type': 'ListItem', position: 3, name: post.title, item: model.canonical },
    ],
  };

  if (!model.indexable) {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': `${model.canonical}#page`,
          url: model.canonical,
          name: post.title,
          description: model.description,
          inLanguage: 'tr-TR',
          isPartOf: { '@type': 'WebSite', '@id': `${SITE}#website`, name: 'Trabzone', url: SITE },
        },
        breadcrumbs,
      ],
    };
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'NewsArticle',
        '@id': `${model.canonical}#article`,
        url: model.canonical,
        headline: post.title,
        description: model.description,
        image: [model.image],
        datePublished: model.published,
        dateModified: model.modified,
        inLanguage: 'tr-TR',
        articleSection: categoryLabel(post.category),
        isAccessibleForFree: true,
        isPartOf: { '@type': 'WebSite', '@id': `${SITE}#website`, name: 'Trabzone', url: SITE },
        author: {
          '@type': 'Person',
          name: authorName,
          alternateName: post.author?.username ? `@${post.author.username}` : undefined,
        },
        publisher: {
          '@type': 'Organization',
          name: 'Trabzone',
          url: SITE,
          logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` },
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': model.canonical },
        contentLocation: post.district
          ? { '@type': 'Place', name: `${post.district}, Trabzon` }
          : undefined,
        creditText: 'Trabzone vatandaş muhabiri — editoryal doğrulama sonrası yayımlandı',
        isBasedOn: undefined,
      },
      breadcrumbs,
    ],
  };
}

function mediaHtml(post) {
  const media = mediaList(post);
  if (media.length === 0) return '';

  const cards = media
    .map((item) => {
      if (item.media_type === 'video') {
        const src = mediaUrl('posts', item.storage_path);
        const poster = item.thumbnail_path ? mediaUrl('posts', item.thumbnail_path) : null;
        if (!src) return '';
        return `<figure class="tz-live__figure">
          <video controls preload="metadata" playsinline${poster ? ` poster="${escapeHtml(poster)}"` : ''}>
            <source src="${escapeHtml(src)}" />
          </video>
          <figcaption>Vatandaş tarafından kaydedilen video</figcaption>
        </figure>`;
      }
      const src = mediaUrl('posts', item.storage_path);
      if (!src) return '';
      return `<figure class="tz-live__figure">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(post.title)}" loading="eager" decoding="async" />
        <figcaption>Vatandaş tarafından kaydedilen fotoğraf</figcaption>
      </figure>`;
    })
    .filter(Boolean)
    .join('');

  return cards;
}

function liveNewsBodyHtml(post, model) {
  const district = post.district ? `${post.district}, Trabzon` : 'Trabzon';
  const published = formatDateTr(model.published);
  const updated = formatDateTr(model.modified);
  const verification = verificationLabel(post.verification_status);
  const verified = model.indexable;
  const shareUrl = `${SITE}/p/gelisme/${encodeURIComponent(post.post_id)}`;
  const totalViews = Number(post.view_count || 0);

  return `
    <style>
      .tz-live { max-width: 920px; margin: 0 auto; padding: 22px 18px 64px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0b1020; background: #fff; }
      .tz-live a { color: #2f55d4; text-decoration: none; }
      .tz-live__crumbs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; color: #41506b; margin: 0 0 14px; }
      .tz-live__eyebrow { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #5b3df5; }
      .tz-live h1 { font-size: 38px; line-height: 1.14; letter-spacing: -.025em; margin: 0 0 12px; max-width: 820px; }
      .tz-live__summary { font-size: 18px; line-height: 1.65; color: #33415c; margin: 0 0 16px; max-width: 780px; white-space: pre-wrap; }
      .tz-live__meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; color: #5b6b8c; margin: 0 0 18px; }
      .tz-live__badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 11px; font-size: 12px; font-weight: 700; }
      .tz-live__badge--verified { background: #e8f2ff; color: #1f4fd8; border: 1px solid #c9ddff; }
      .tz-live__badge--citizen { background: #f2efff; color: #5b3df5; border: 1px solid #ddd5ff; }
      .tz-live__tag { border: 1px solid #d6deee; border-radius: 999px; padding: 3px 9px; font-size: 12px; color: #33415c; }
      .tz-live__notice { max-width: 780px; margin: 0 0 22px; padding: 13px 15px; border: 1px solid #dbe4f5; border-radius: 12px; background: #f7f9fe; color: #33415c; font-size: 14px; line-height: 1.6; }
      .tz-live__figure { margin: 0 0 18px; }
      .tz-live__figure img, .tz-live__figure video { display: block; width: 100%; max-height: 560px; object-fit: cover; border-radius: 16px; background: #0b1220; }
      .tz-live__figure figcaption { margin-top: 8px; font-size: 12px; color: #6b7a96; }
      .tz-live__footer { max-width: 780px; margin: 34px 0 0; padding-top: 22px; border-top: 1px solid #e6ebf5; }
      .tz-live__footer h2 { font-size: 20px; margin: 0 0 10px; }
      .tz-live__footer p { color: #41506b; line-height: 1.65; font-size: 14px; }
      .tz-live__actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0 0; }
      .tz-live__actions a { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; padding: 11px 18px; font-size: 14px; font-weight: 600; }
      .tz-live__actions .primary { background: #2f6bff; color: #fff; }
      .tz-live__actions .ghost { border: 1px solid #d6deee; color: #1d2a44; background: #fff; }
      .tz-live__muted { color: #6b7a96; font-size: 12.5px; }
      @media (max-width: 560px) { .tz-live h1 { font-size: 28px; } .tz-live__summary { font-size: 16px; } }
    </style>
    <main class="tz-live">
      <nav class="tz-live__crumbs" aria-label="breadcrumb">
        <a href="${SITE}/">Trabzone</a> <span aria-hidden="true">›</span>
        <a href="${SITE}${LIVE_NEWS_PATH}">Anlık Gelişmeler</a> <span aria-hidden="true">›</span>
        <span>${escapeHtml(district)}</span>
      </nav>
      <p class="tz-live__eyebrow">${escapeHtml(categoryLabel(post.category))}</p>
      <h1>${escapeHtml(post.title)}</h1>
      ${post.summary ? `<p class="tz-live__summary">${escapeHtml(post.summary)}</p>` : ''}
      <p class="tz-live__meta">
        <span class="tz-live__badge ${verified ? 'tz-live__badge--verified' : 'tz-live__badge--citizen'}">${escapeHtml(
          verification,
        )}</span>
        <span class="tz-live__tag">${escapeHtml(district)}</span>
        ${published ? `<span>· ${escapeHtml(published)}</span>` : ''}
        ${updated && updated !== published ? `<span>· Güncelleme: ${escapeHtml(updated)}</span>` : ''}
        ${totalViews > 0 ? `<span>· ${totalViews.toLocaleString('tr-TR')} görüntülenme</span>` : ''}
      </p>
      ${
        verified
          ? ''
          : `<p class="tz-live__notice"><strong>Vatandaş paylaşımı.</strong> Bu içerik Trabzone editörleri tarafından doğrulanmamıştır. Gelişmeye ilişkin resmî açıklamaları dikkate alın; içerik bilgi amaçlı yayımlanmaktadır.</p>`
      }
      ${mediaHtml(post)}
      <p class="tz-live__muted">
        Paylaşan: ${escapeHtml(
          post.author?.display_name || post.author?.username || 'Trabzone kullanıcısı',
        )}${post.author?.username ? ` · @${escapeHtml(post.author.username)}` : ''}
      </p>
      <section class="tz-live__footer" aria-labelledby="paylasim-bilgisi">
        <h2 id="paylasim-bilgisi">Paylaşım bilgisi</h2>
        <p>
          Bu gelişme Trabzone vatandaş muhabirliği akışında paylaşılmıştır. İçerik, platformun
          moderasyon ve doğrulama süreçlerinden geçer. Doğrulanmamış bilgiler haber niteliği
          taşımaz; düzeltme veya kaldırma talepleri destek merkezi üzerinden iletilebilir.
        </p>
        <div class="tz-live__actions">
          <a class="primary" href="${escapeHtml(shareUrl)}" rel="nofollow">Uygulamada aç</a>
          <a class="ghost" href="${SITE}/support" rel="nofollow">Düzeltme / destek</a>
        </div>
      </section>
    </main>
  `;
}

function liveNewsNoscriptHtml(post, model) {
  return `<div style="max-width:760px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10203f;background:#fff">
    <h2>${escapeHtml(post.title)}</h2>
    <p style="font-size:15px;line-height:1.6;color:#41506b">${escapeHtml(
      post.summary || model.description,
    )}</p>
    <p><a href="${escapeHtml(model.canonical)}" style="color:#2f55d4">Gelişmeyi Trabzone'da aç</a></p>
  </div>`;
}

/** Tek anlık gelişmeyi arama motorları için tam HTML olarak işler. */
async function renderLiveNewsPost(post) {
  const template = await getTemplate();
  const model = liveNewsModel(post);
  const robots = model.indexable
    ? 'index,follow,max-image-preview:large,max-snippet:-1'
    : 'noindex,follow';

  let html = applyHead(template, {
    title: model.title,
    description: model.description,
    canonical: model.canonical,
    image: model.image,
    ogType: 'article',
    robots,
    jsonLd: liveNewsJsonLd(post, model),
    extraHead: `<meta property="article:published_time" content="${escapeHtml(model.published || '')}" />
    <meta property="article:modified_time" content="${escapeHtml(model.modified || '')}" />
    <meta property="article:section" content="${escapeHtml(categoryLabel(post.category))}" />
    <meta name="author" content="${escapeHtml(
      post.author?.display_name || post.author?.username || 'Trabzone kullanıcısı',
    )}" />`,
  });
  html = applyBody(html, liveNewsBodyHtml(post, model), liveNewsNoscriptHtml(post, model));
  return html;
}

function renderLiveNewsNotFound() {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Gelişme bulunamadı · Trabzone</title>
<meta name="robots" content="noindex, follow" />
<meta name="theme-color" content="#0B1220" />
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: radial-gradient(120% 80% at 50% 0%, #12224a 0%, #0b1220 55%, #080d18 100%); color: #f2f5fb; text-align: center; }
  .box { max-width: 420px; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { color: #a9bade; line-height: 1.6; margin: 0 0 22px; }
  a { display: inline-block; padding: 13px 22px; border-radius: 14px; background: #2f6bff; color: #fff; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
  <div class="box">
    <h1>Bu gelişme yayında değil</h1>
    <p>İçerik kaldırılmış, moderasyona alınmış veya hiç var olmamış olabilir.</p>
    <a href="${SITE}/">Trabzone'a git</a>
  </div>
</body>
</html>`;
}

module.exports = {
  LIVE_NEWS_PATH,
  liveNewsModel,
  renderLiveNewsNotFound,
  renderLiveNewsPost,
};
