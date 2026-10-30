/**
 * Eczane rehberi — sunucu tarafında işlenen herkese açık sayfalar.
 *
 * Veriler yalnızca `pharmacy_public_page`, `pharmacies_public_list` ve
 * `pharmacies_bootstrap` RPC'lerinden gelir (yayındaki eczaneler). Eczane adı,
 * nöbet saati, adres, telefon, puan veya yorum UYDURULMAZ; alan yoksa sayfa
 * açıkça "bilinmiyor / doğrulanamadı" der.
 *
 * Sayfa türleri:
 *   /eczaneler                → tüm eczaneler + bugünün nöbetçileri
 *   /eczaneler/<slug>         → eczane detayı (Pharmacy JSON-LD)
 *   /nobetci-eczaneler        → Trabzon geneli nöbet listesi
 *   /nobetci-eczaneler/<ilçe> → ilçe nöbet listesi
 */

const {
  SITE,
  BRAND,
  DEFAULT_IMAGE,
  applyBody,
  applyHead,
  escapeHtml,
  getTemplate,
  rpc,
  truncate,
} = require('./seo');

const INDEX_PATH = '/eczaneler';
const DUTY_PATH = '/nobetci-eczaneler';

const DAY_LABELS = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar',
};

const STATE_LABELS = {
  on_duty: 'Şu an nöbette',
  duty_today_later: 'Bugün nöbetçi (henüz başlamadı)',
  duty_today_ended: 'Bugünkü nöbet sona erdi',
  none: 'Bugün nöbetçi değil',
  unknown: 'Durum doğrulanamadı',
};

// ---------------------------------------------------------------------------
// Biçimlendirme
// ---------------------------------------------------------------------------

function formatTrDate(value) {
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

function formatTrDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Istanbul',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function formatClock(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Istanbul',
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

function dutyWindow(shift) {
  const start = formatClock(shift && shift.starts_at);
  const end = formatClock(shift && shift.ends_at);
  if (!start || !end) return '';
  return `${start}–${end}`;
}

/** Durumu kaydın doğrulanma ve tazelik bilgisine göre dürüstçe anlatır. */
function stateSentence(state) {
  const value = state || {};
  const shift = value.shift || null;
  if (value.stale) {
    return 'Nöbet kaydı tazelik eşiğini aştı; güncel durum doğrulanamadı.';
  }
  switch (value.state) {
    case 'on_duty':
      return shift && shift.verified
        ? `Şu anda nöbette (${dutyWindow(shift)}).`
        : `Nöbet kaydına göre şu anda nöbette olması bekleniyor (${dutyWindow(shift)}).`;
    case 'duty_today_later':
      return shift
        ? `Bugün nöbeti ${formatClock(shift.starts_at)}'de başlayacak.`
        : 'Bugün nöbeti var, başlangıç saati doğrulanamadı.';
    case 'duty_today_ended':
      return shift
        ? `Bugünkü nöbeti sona erdi (${dutyWindow(shift)}).`
        : 'Bugünkü nöbeti sona erdi.';
    case 'none':
      return 'Bugün için nöbet kaydı yok; normal çalışma saatleri geçerlidir.';
    default:
      return 'Güncel nöbet bilgisi doğrulanamadı.';
  }
}

function statusLabel(state) {
  const value = state || {};
  if (value.stale) {
    return 'Durum doğrulanamadı (veri eski)';
  }
  return STATE_LABELS[value.state] || STATE_LABELS.unknown;
}

function inventoryLabel(page) {
  if (page.inventory_attribution) {
    return page.inventory_attribution;
  }
  switch (page.inventory_source) {
    case 'osm':
      return 'Eczane envanteri: © OpenStreetMap katkıcıları (ODbL)';
    case 'official_list':
      return 'Eczane envanteri: yetkili kurum listesi';
    case 'pharmacy_bulletin':
      return 'Eczane envanteri: eczacı odası bülteni';
    case 'manual_verified':
      return 'Eczane envanteri: elle doğrulanmış kayıt';
    default:
      return 'Eczane envanteri: kaynak bilgisi kayıtlı değil';
  }
}

function hoursRows(hours) {
  if (!hours || typeof hours !== 'object') {
    return [];
  }
  const rows = [];
  for (const day of [1, 2, 3, 4, 5, 6, 7]) {
    const slots = hours[String(day)];
    if (!Array.isArray(slots) || slots.length === 0) {
      rows.push({ day: DAY_LABELS[day], value: 'Kapalı' });
      continue;
    }
    const text = slots
      .map((slot) => (Array.isArray(slot) && slot.length >= 2 ? `${slot[0]}–${slot[1]}` : ''))
      .filter(Boolean)
      .join(', ');
    rows.push({ day: DAY_LABELS[day], value: text || 'Kapalı' });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Ortak parçalar
// ---------------------------------------------------------------------------

const BASE_STYLE = `
  .tz-ph { max-width: 1080px; margin: 0 auto; padding: 26px 18px 60px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0b1020; background: #fff; }
  .tz-ph a { color: #2f55d4; text-decoration: none; }
  .tz-ph__crumbs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; color: #41506b; margin: 0 0 16px; }
  .tz-ph__eyebrow { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #2f55d4; }
  .tz-ph h1 { font-size: 34px; line-height: 1.15; letter-spacing: -.02em; margin: 0 0 10px; }
  .tz-ph__lede { font-size: 17px; line-height: 1.6; color: #33415c; margin: 0 0 14px; max-width: 780px; }
  .tz-ph__meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; color: #5b6b8c; margin: 0 0 20px; }
  .tz-ph__tag { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #dbe4f5; background: #f6f8fd; border-radius: 999px; padding: 4px 10px; font-size: 12px; color: #33415c; }
  .tz-ph__tag--duty { border-color: #b9e2c6; background: #eef9f1; color: #1c6b3a; }
  .tz-ph__tag--warn { border-color: #f2d9ae; background: #fdf6e9; color: #85540d; }
  .tz-ph__actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 22px; }
  .tz-ph__btn { display: inline-flex; align-items: center; border-radius: 999px; padding: 9px 16px; font-size: 14px; font-weight: 600; border: 1px solid #d6deee; color: #1d2a44; background: #fff; }
  .tz-ph__btn--primary { background: #1d2a44; border-color: #1d2a44; color: #fff; }
  .tz-ph__panel { border: 1px solid #e2e8f4; border-radius: 16px; padding: 18px 20px; background: #fbfcff; margin: 0 0 20px; }
  .tz-ph__panel h2 { font-size: 19px; margin: 0 0 10px; }
  .tz-ph__rows { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 8px 16px; font-size: 15px; line-height: 1.55; margin: 0; }
  .tz-ph__rows dt { color: #5b6b8c; }
  .tz-ph__rows dd { margin: 0; color: #1c2740; }
  .tz-ph__note { font-size: 13px; line-height: 1.6; color: #6b7a96; margin: 12px 0 0; }
  .tz-ph__alert { border: 1px solid #f2d9ae; background: #fdf6e9; color: #6d4708; border-radius: 12px; padding: 12px 14px; font-size: 14px; line-height: 1.6; margin: 0 0 20px; }
  .tz-ph__section { margin: 30px 0 0; }
  .tz-ph__section h2 { font-size: 22px; margin: 0 0 12px; }
  .tz-ph__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 12px; }
  .tz-ph__card { border: 1px solid #e2e8f4; border-radius: 14px; padding: 14px 15px; background: #fff; }
  .tz-ph__card h3 { font-size: 16px; line-height: 1.35; margin: 0 0 6px; }
  .tz-ph__card p { font-size: 13px; line-height: 1.55; color: #4a5a78; margin: 0 0 6px; }
  .tz-ph__card p:last-child { margin-bottom: 0; }
  .tz-ph__duty { border-color: #b9e2c6; background: #f7fdf9; }
  .tz-ph__chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; }
  .tz-ph__chip { border: 1px solid #d6deee; background: #f6f8fd; border-radius: 999px; padding: 7px 12px; font-size: 13px; color: #1d2a44; }
  .tz-ph__chip span { color: #5b6b8c; }
  .tz-ph__hours { width: 100%; border-collapse: collapse; font-size: 14px; }
  .tz-ph__hours th, .tz-ph__hours td { border-bottom: 1px solid #e8edf7; padding: 7px 4px; text-align: left; }
  .tz-ph__hours th { color: #5b6b8c; font-weight: 600; }
  .tz-ph__footer { margin: 34px 0 0; padding-top: 18px; border-top: 1px solid #e6ebf5; font-size: 13px; line-height: 1.7; color: #5b6b8c; }
  @media (max-width: 560px) {
    .tz-ph h1 { font-size: 26px; }
    .tz-ph__rows { grid-template-columns: 1fr; gap: 2px 0; }
    .tz-ph__rows dt { margin-top: 8px; }
  }
`;

function crumbsHtml(items) {
  return items
    .map((item, index) =>
      index === items.length - 1
        ? `<span>${escapeHtml(item.name)}</span>`
        : `<a href="${SITE}${escapeHtml(item.path)}">${escapeHtml(item.name)}</a> <span aria-hidden="true">›</span>`,
    )
    .join(' ');
}

function disclaimerHtml() {
  return `<p class="tz-ph__note">Nöbet listesinde görünmek, eczanenin fiziksel olarak açık olduğunun canlı teyidi değildir. Yola çıkmadan önce telefonla doğrulamanız önerilir. Durum bilgisi Europe/Istanbul saatine göre hesaplanır.</p>`;
}

function mapHref(page) {
  const params = new URLSearchParams();
  if (page.district) params.set('district', page.district);
  if (page.lat != null && page.lng != null) {
    params.set('lat', String(page.lat));
    params.set('lng', String(page.lng));
  }
  const query = params.toString();
  return `${SITE}${INDEX_PATH}/harita${query ? `?${query}` : ''}`;
}

// ---------------------------------------------------------------------------
// Eczane detayı
// ---------------------------------------------------------------------------

function detailTitle(page) {
  const place = page.district || 'Trabzon';
  const suffix = ' | Trabzone';
  const base = `${page.name} — ${place} Eczane`;
  return base.length + suffix.length <= 70 ? `${base}${suffix}` : truncate(base, 70);
}

function detailDescription(page) {
  const place = [page.neighborhood, page.district].filter(Boolean).join(', ');
  const parts = [page.name];
  if (place) parts.push(place);
  parts.push(stateSentence(page.state));
  if (page.address) parts.push(page.address);
  if (page.phone) parts.push(`Tel: ${page.phone}`);
  parts.push('Adres, nöbet bilgisi ve yol tarifi Trabzone eczane rehberinde.');
  return truncate(parts.join(' '), 160);
}

function detailJsonLd(page, canonical) {
  const address = page.address
    ? {
        '@type': 'PostalAddress',
        streetAddress: page.address,
        addressLocality: page.district || 'Trabzon',
        addressRegion: 'Trabzon',
        addressCountry: 'TR',
      }
    : {
        '@type': 'PostalAddress',
        addressLocality: page.district || 'Trabzon',
        addressRegion: 'Trabzon',
        addressCountry: 'TR',
      };

  const pharmacy = {
    '@type': 'Pharmacy',
    '@id': `${canonical}#pharmacy`,
    url: canonical,
    name: page.name,
    address,
    ...(page.phone ? { telephone: page.phone } : {}),
    ...(page.lat != null && page.lng != null
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: Number(page.lat),
            longitude: Number(page.lng),
          },
        }
      : {}),
    ...(page.rating != null && Number(page.review_count || 0) > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: Number(page.rating),
            reviewCount: Number(page.review_count),
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(page.updated_at ? { dateModified: page.updated_at } : {}),
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [
      pharmacy,
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonical}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Eczaneler', item: `${SITE}${INDEX_PATH}` },
          ...(page.district_slug
            ? [
                {
                  '@type': 'ListItem',
                  position: 3,
                  name: `${page.district} nöbetçi eczaneler`,
                  item: `${SITE}${DUTY_PATH}/${page.district_slug}`,
                },
              ]
            : []),
          {
            '@type': 'ListItem',
            position: page.district_slug ? 4 : 3,
            name: page.name,
            item: canonical,
          },
        ],
      },
      {
        '@type': 'WebPage',
        '@id': `${canonical}#page`,
        url: canonical,
        name: detailTitle(page),
        inLanguage: 'tr-TR',
        dateModified: page.updated_at || undefined,
        isPartOf: { '@type': 'WebSite', '@id': `${SITE}#website`, name: BRAND, url: SITE },
        about: { '@id': `${canonical}#pharmacy` },
      },
    ],
  };
}

function detailBodyHtml(page) {
  const state = page.state || {};
  const shift = state.shift || null;
  const badge = state.stale
    ? '<span class="tz-ph__tag tz-ph__tag--warn">Veri eski · durum doğrulanamadı</span>'
    : state.on_duty_now
      ? `<span class="tz-ph__tag tz-ph__tag--duty">${escapeHtml(statusLabel(state))}</span>`
      : `<span class="tz-ph__tag">${escapeHtml(statusLabel(state))}</span>`;

  const dutyRow = shift
    ? `${dutyWindow(shift)}${shift.duty_date ? ` · ${formatTrDate(`${shift.duty_date}T00:00:00+03:00`)}` : ''}${
        shift.source_name ? ` · Kaynak: ${escapeHtml(shift.source_name)}` : ''
      }${shift.verified ? ' · Doğrulandı' : ' · Doğrulanmadı'}`
    : 'Doğrulanmış nöbet kaydı yok';

  const hours = hoursRows(page.working_hours);
  const hoursTable = hours.length
    ? `<table class="tz-ph__hours"><caption style="text-align:left;color:#5b6b8c;font-size:13px;padding-bottom:6px">Normal çalışma saatleri${
        page.working_hours_source ? ` · Kaynak: ${escapeHtml(page.working_hours_source)}` : ''
      }</caption><tbody>${hours
        .map(
          (row) =>
            `<tr><th scope="row">${escapeHtml(row.day)}</th><td>${escapeHtml(row.value)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="tz-ph__note">Çalışma saatleri doğrulanmış biçimde kayıtlı değil. Saat tahmini yapılmaz.</p>';

  const rating =
    page.rating != null && Number(page.review_count || 0) > 0
      ? `<dt>Kullanıcı puanı</dt><dd>${Number(page.rating).toFixed(1)} / 5 · ${Number(
          page.review_count,
        )} değerlendirme</dd>`
      : '<dt>Kullanıcı puanı</dt><dd>Henüz değerlendirme yapılmadı</dd>';

  const place = [page.neighborhood, page.district].filter(Boolean).join(' — ');

  return `
    <style>${BASE_STYLE}</style>
    <main class="tz-ph">
      <nav class="tz-ph__crumbs" aria-label="breadcrumb">
        ${crumbsHtml([
          { name: 'Trabzone', path: '/' },
          { name: 'Eczaneler', path: INDEX_PATH },
          ...(page.district_slug
            ? [{ name: `${page.district} nöbetçi eczaneler`, path: `${DUTY_PATH}/${page.district_slug}` }]
            : []),
          { name: page.name, path: `${INDEX_PATH}/${page.slug}` },
        ])}
      </nav>
      <p class="tz-ph__eyebrow">Eczane rehberi${page.district ? ` · ${escapeHtml(page.district)}` : ''}</p>
      <h1>${escapeHtml(page.name)}</h1>
      <p class="tz-ph__lede">${escapeHtml(place || 'Konum bilgisi doğrulanmadı')}</p>
      <p class="tz-ph__meta">
        ${badge}
        ${shift ? `<span class="tz-ph__tag">Nöbet: ${escapeHtml(dutyWindow(shift))}</span>` : ''}
        ${page.data_verified ? '<span class="tz-ph__tag">Veri doğrulandı</span>' : '<span class="tz-ph__tag tz-ph__tag--warn">Veri doğrulanmadı</span>'}
        ${page.phone ? `<span class="tz-ph__tag">Telefon kayıtlı</span>` : '<span class="tz-ph__tag tz-ph__tag--warn">Telefon kayıtlı değil</span>'}
      </p>
      <div class="tz-ph__actions">
        <a class="tz-ph__btn tz-ph__btn--primary" href="${escapeHtml(mapHref(page))}">Haritada gör</a>
        ${page.phone ? `<a class="tz-ph__btn" href="tel:${escapeHtml(String(page.phone).replace(/[^\d+]/g, ''))}">Ara</a>` : ''}
        ${page.lat != null && page.lng != null ? `<a class="tz-ph__btn" href="https://www.google.com/maps/dir/?api=1&amp;destination=${Number(page.lat)},${Number(page.lng)}" rel="nofollow noopener" target="_blank">Yol tarifi</a>` : ''}
        <a class="tz-ph__btn" href="${SITE}${INDEX_PATH}/${encodeURIComponent(page.slug)}">Uygulamada aç</a>
      </div>

      ${
        state.stale
          ? '<p class="tz-ph__alert">Nöbet kaydı tazelik eşiğini aştı. Bu sayfa bugünün kesin listesi olarak değerlendirilmemeli; yola çıkmadan önce eczaneyi arayın.</p>'
          : ''
      }

      <section class="tz-ph__panel" aria-labelledby="durum">
        <h2 id="durum">Güncel durum</h2>
        <dl class="tz-ph__rows">
          <dt>Durum</dt>
          <dd>${escapeHtml(statusLabel(state))}</dd>
          <dt>Nöbet</dt>
          <dd>${escapeHtml(dutyRow)}</dd>
          ${
            shift && shift.fetched_at
              ? `<dt>Nöbet verisi çekildi</dt><dd>${escapeHtml(formatTrDateTime(shift.fetched_at))} (Europe/Istanbul)</dd>`
              : ''
          }
          <dt>Adres</dt>
          <dd>${page.address ? escapeHtml(page.address) : 'Adres bilgisi doğrulanmadı'}</dd>
          <dt>Telefon</dt>
          <dd>${
            page.phone
              ? `<a href="tel:${escapeHtml(String(page.phone).replace(/[^\d+]/g, ''))}">${escapeHtml(page.phone)}</a>`
              : 'Telefon bilgisi doğrulanmadı'
          }</dd>
          ${rating}
          <dt>Son güncelleme</dt>
          <dd>${escapeHtml(formatTrDateTime(page.updated_at) || 'Bilinmiyor')}</dd>
        </dl>
        <p class="tz-ph__note">${escapeHtml(stateSentence(state))} Durum gösterimi nöbet kaydına ve doğrulanmış çalışma saatine dayanır; eczanenin kapıda açık olduğunun canlı teyidi değildir.</p>
      </section>

      <section class="tz-ph__panel" aria-labelledby="saatler">
        <h2 id="saatler">Çalışma saatleri</h2>
        ${hoursTable}
      </section>

      <section class="tz-ph__panel" aria-labelledby="yorumlar">
        <h2 id="yorumlar">Kullanıcı değerlendirmeleri</h2>
        <p>${
          page.rating != null && Number(page.review_count || 0) > 0
            ? `${Number(page.rating).toFixed(1)} / 5 ortalama · ${Number(page.review_count)} değerlendirme. Yorumlar yalnızca kayıtlı Trabzone hesaplarından gelir.`
            : 'Henüz değerlendirme yapılmadı. Trabzone, uydurma yıldız puanı veya yorum sayısı göstermez.'
        }</p>
        <p class="tz-ph__note">Yorumlarda kişisel sağlık bilgisi, reçete veya hasta bilgisi paylaşılmamalıdır. Değerlendirmeleri okumak ve yorum yazmak için sayfayı Trabzone uygulamasında açın.</p>
      </section>

      <p class="tz-ph__footer">
        ${escapeHtml(inventoryLabel(page))}. Nöbet ve çalışma saati bilgileri yetkili kaynaklardan doğrulanarak işlenir; kaynak yoksa alan boş bırakılır.
        ${page.data_verified_at ? `<br />Veri doğrulaması: ${escapeHtml(formatTrDateTime(page.data_verified_at))}.` : '<br />Bu kayıt için veri doğrulaması henüz tamamlanmadı.'}
        <br /><a href="${SITE}${INDEX_PATH}">Tüm eczaneler</a> ·
        <a href="${SITE}${DUTY_PATH}">Trabzon nöbetçi eczaneler</a> ·
        <a href="${SITE}/support">Destek</a>
      </p>
    </main>
  `;
}

function detailNoscriptHtml(page) {
  return `<div style="max-width:760px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10203f;background:#fff">
    <h2>${escapeHtml(page.name)}</h2>
    <p>${escapeHtml(detailDescription(page))}</p>
    <p><a href="${SITE}${INDEX_PATH}/${encodeURIComponent(page.slug)}" style="color:#2f55d4">Eczaneyi Trabzone'da aç</a></p>
  </div>`;
}

/** Tek eczanenin herkese açık detay sayfası. */
async function renderPharmacyDetail(page) {
  const template = await getTemplate();
  const canonical = `${SITE}${INDEX_PATH}/${page.slug}`;
  const title = detailTitle(page);
  const description = detailDescription(page);

  let html = applyHead(template, {
    title,
    description,
    canonical,
    image: DEFAULT_IMAGE,
    ogType: 'website',
    robots: 'index,follow,max-image-preview:large,max-snippet:-1',
    jsonLd: detailJsonLd(page, canonical),
  });
  html = applyBody(html, detailBodyHtml(page), detailNoscriptHtml(page));
  return html;
}

// ---------------------------------------------------------------------------
// Dizin ve nöbet listeleri
// ---------------------------------------------------------------------------

function itemStatus(item) {
  const state = item.state || {};
  if (state.stale) {
    return 'Durum doğrulanamadı (veri eski)';
  }
  switch (state.state) {
    case 'on_duty': {
      const window = dutyWindow(state.shift);
      return window ? `Şu an nöbette · ${window}` : 'Şu an nöbette';
    }
    case 'duty_today_later':
      return state.shift ? `Nöbet ${formatClock(state.shift.starts_at)}'de başlayacak` : 'Bugün nöbetçi';
    case 'duty_today_ended':
      return state.shift ? `Bugünkü nöbet bitti · ${dutyWindow(state.shift)}` : 'Bugünkü nöbet bitti';
    case 'none':
      return 'Bugün nöbetçi değil';
    default:
      return 'Durum doğrulanamadı';
  }
}

function cardHtml(item) {
  const place = [item.neighborhood, item.district].filter(Boolean).join(' · ');
  const state = item.state || {};
  const duty = Boolean(state.duty_today);
  return `<article class="tz-ph__card${duty ? ' tz-ph__duty' : ''}">
    <h3><a href="${SITE}${INDEX_PATH}/${encodeURIComponent(item.slug)}">${escapeHtml(item.name)}</a></h3>
    ${place ? `<p>${escapeHtml(place)}</p>` : '<p>Mahalle/ilçe bilgisi kayıtlı değil</p>'}
    <p>${escapeHtml(itemStatus(item))}${state.stale ? ' · Kaynak tazelenmeli' : ''}</p>
    ${item.address ? `<p>${escapeHtml(item.address)}</p>` : '<p>Adres bilgisi doğrulanmadı</p>'}
    ${item.phone ? `<p><a href="tel:${escapeHtml(String(item.phone).replace(/[^\d+]/g, ''))}">${escapeHtml(item.phone)}</a></p>` : ''}
  </article>`;
}

function dutyFirst(items) {
  return [...items].sort((a, b) => {
    const aDuty = a.state && a.state.on_duty_now ? 2 : a.state && a.state.duty_today ? 1 : 0;
    const bDuty = b.state && b.state.on_duty_now ? 2 : b.state && b.state.duty_today ? 1 : 0;
    if (aDuty !== bDuty) return bDuty - aDuty;
    return String(a.name).localeCompare(String(b.name), 'tr');
  });
}

function districtChipsHtml(districts, activeSlug) {
  if (!Array.isArray(districts) || districts.length === 0) return '';
  const chips = districts
    .filter((district) => Number(district.pharmacy_count || 0) > 0)
    .map((district) => {
      const active = district.slug === activeSlug;
      return `<a class="tz-ph__chip" href="${SITE}${DUTY_PATH}/${encodeURIComponent(district.slug)}"${
        active ? ' aria-current="page" style="border-color:#1d2a44;background:#1d2a44;color:#fff"' : ''
      }>${escapeHtml(district.name)} <span${active ? ' style="color:#dbe4f5"' : ''}>${Number(
        district.duty_today || 0,
      )}</span></a>`;
    })
    .join('');
  return `<nav class="tz-ph__chips" aria-label="İlçeler">${chips}</nav>`;
}

function directoryModel(payload) {
  const district = payload.district || null;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const dutyItems = items.filter((item) => item.state && item.state.duty_today);
  const staleCount = dutyItems.filter((item) => item.state && item.state.stale).length;
  const lastFetch = dutyItems
    .map((item) => (item.state && item.state.shift && item.state.shift.fetched_at) || null)
    .filter(Boolean)
    .sort()
    .pop() || null;
  const isDutyPage = payload.mode === 'duty';
  const hasDutyData = dutyItems.length > 0 && staleCount === 0;
  const area = district ? district.name : 'Trabzon';

  const canonical = district
    ? `${SITE}${DUTY_PATH}/${district.slug}`
    : isDutyPage
      ? `${SITE}${DUTY_PATH}`
      : `${SITE}${INDEX_PATH}`;

  let title;
  if (isDutyPage) {
    title = hasDutyData
      ? `${area} Nöbetçi Eczaneler — ${formatTrDate(payload.today)} | Trabzone`
      : `${area} Eczaneleri — Nöbet Bilgisi | Trabzone`;
  } else {
    title = 'Trabzon Eczaneleri — Nöbetçi ve Tüm Eczaneler | Trabzone';
  }
  title = truncate(title, 70);

  const total = Number(payload.total || items.length);
  let description;
  if (isDutyPage) {
    description = hasDutyData
      ? `${area} için ${formatTrDate(payload.today)} tarihli nöbetçi eczane listesi: ${dutyItems.length} kayıt. Adres, telefon ve yol tarifi. Son veri: ${formatTrDateTime(lastFetch) || 'belirtilmemiş'}.`
      : `${area} eczaneleri ve nöbet bilgisi. ${formatTrDate(payload.today)} için doğrulanmış nöbet kaydı bulunamadı; Trabzone eczane uydurmaz.`;
  } else {
    description = `Trabzon'un 18 ilçesindeki eczaneler: bugünün nöbetçi listesi, adres, telefon ve harita. ${total} kayıt. Durum bilgisi Europe/Istanbul saatine göre hesaplanır.`;
  }

  return {
    district,
    items,
    dutyItems,
    staleCount,
    lastFetch,
    isDutyPage,
    hasDutyData,
    area,
    canonical,
    title,
    description: truncate(description, 160),
  };
}

function directoryJsonLd(model) {
  const list = model.items.slice(0, 100).map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    url: `${SITE}${INDEX_PATH}/${encodeURIComponent(item.slug)}`,
    name: String(item.name || ''),
  }));

  const crumbs = [
    { name: 'Ana Sayfa', item: `${SITE}/` },
    { name: 'Eczaneler', item: `${SITE}${INDEX_PATH}` },
    ...(model.isDutyPage
      ? [
          {
            name: model.district ? `${model.district.name} nöbetçi eczaneler` : 'Trabzon nöbetçi eczaneler',
            item: model.canonical,
          },
        ]
      : []),
  ];

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
          item: crumb.item,
        })),
      },
      {
        '@type': 'CollectionPage',
        '@id': `${model.canonical}#page`,
        url: model.canonical,
        name: model.title,
        description: model.description,
        inLanguage: 'tr-TR',
        isPartOf: { '@type': 'WebSite', '@id': `${SITE}#website`, name: BRAND, url: SITE },
        mainEntity: { '@id': `${model.canonical}#list` },
      },
      {
        '@type': 'ItemList',
        '@id': `${model.canonical}#list`,
        numberOfItems: Number(model.items.length),
        itemListOrder: 'https://schema.org/ItemListOrderAscending',
        itemListElement: list,
      },
    ],
  };
}

function directoryBodyHtml(model, districts, today) {
  const sorted = dutyFirst(model.items);
  const groups = new Map();
  for (const item of sorted) {
    const key = item.district || 'İlçe bilgisi yok';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const dutySection =
    model.dutyItems.length > 0
      ? `<section class="tz-ph__section" aria-labelledby="bugun-nobetci">
          <h2 id="bugun-nobetci">Bugün nöbetçi eczaneler · ${escapeHtml(formatTrDate(today))}</h2>
          <p class="tz-ph__note">Son nöbet verisi: ${escapeHtml(formatTrDateTime(model.lastFetch) || 'belirtilmemiş')} (Europe/Istanbul).${
            model.staleCount > 0
              ? ` ${model.staleCount} kaydın verisi tazelik eşiğini aştı; bu kayıtlar için durum doğrulanamadı.`
              : ''
          }</p>
          <div class="tz-ph__grid">${dutyFirst(model.dutyItems).map(cardHtml).join('')}</div>
        </section>`
      : `<section class="tz-ph__section" aria-labelledby="bugun-nobetci">
          <h2 id="bugun-nobetci">Bugün için doğrulanmış nöbet kaydı yok</h2>
          <p class="tz-ph__alert">${escapeHtml(
            formatTrDate(today),
          )} tarihi için doğrulanmış nöbet kaydı bulunmuyor. Trabzone, kaynak verisi olmadan eczaneyi "nöbetçi" olarak göstermez. Aşağıdaki liste tüm kayıtlı eczaneleri içerir.</p>
        </section>`;

  const groupsHtml = [...groups.entries()]
    .map(
      ([districtName, list]) => `<section class="tz-ph__section" aria-labelledby="ilce-${encodeURIComponent(districtName)}">
        <h2 id="ilce-${encodeURIComponent(districtName)}">${escapeHtml(districtName)} eczaneleri (${list.length})</h2>
        <div class="tz-ph__grid">${list.map(cardHtml).join('')}</div>
      </section>`,
    )
    .join('');

  const intro = model.isDutyPage
    ? model.hasDutyData
      ? `${escapeHtml(model.area)} için ${escapeHtml(formatTrDate(today))} tarihli nöbetçi eczaneler. Liste yalnızca doğrulanmış nöbet kayıtlarından üretilir; kayıt yoksa eczane nöbetçi olarak gösterilmez.`
      : `${escapeHtml(model.area)} eczaneleri listeleniyor. Bugün için doğrulanmış nöbet kaydı bulunmadığından hiçbir eczane nöbetçi olarak işaretlenmedi.`
    : `Trabzon'un 18 ilçesindeki eczaneler, bugünün nöbetçi listesi ve iletişim bilgileri. Durum bilgisi nöbet kaydına ve doğrulanmış çalışma saatine göre hesaplanır.`;

  return `
    <style>${BASE_STYLE}</style>
    <main class="tz-ph">
      <nav class="tz-ph__crumbs" aria-label="breadcrumb">
        ${crumbsHtml([
          { name: 'Trabzone', path: '/' },
          { name: 'Eczaneler', path: INDEX_PATH },
          ...(model.isDutyPage
            ? [{ name: model.district ? `${model.district.name} nöbetçi eczaneler` : 'Nöbetçi eczaneler', path: DUTY_PATH }]
            : []),
        ])}
      </nav>
      <p class="tz-ph__eyebrow">Trabzon · Eczane rehberi</p>
      <h1>${
        model.isDutyPage
          ? `${escapeHtml(model.area)} ${model.hasDutyData ? 'nöbetçi eczaneler' : 'eczaneleri'}`
          : 'Trabzon eczaneleri ve bugün nöbetçi eczaneler'
      }</h1>
      <p class="tz-ph__lede">${intro}</p>
      <p class="tz-ph__meta">
        <span class="tz-ph__tag">${Number(model.items.length)} eczane kaydı</span>
        <span class="tz-ph__tag">${Number(model.dutyItems.length)} nöbetçi kayıt</span>
        <span class="tz-ph__tag">Son güncelleme: ${escapeHtml(formatTrDate(today))}</span>
      </p>
      ${districtChipsHtml(districts, model.district ? model.district.slug : null)}
      <div class="tz-ph__actions">
        <a class="tz-ph__btn tz-ph__btn--primary" href="${SITE}${INDEX_PATH}/harita">Haritada gör</a>
        <a class="tz-ph__btn" href="${SITE}${INDEX_PATH}">Tüm eczaneler</a>
        <a class="tz-ph__btn" href="${SITE}${DUTY_PATH}">Nöbetçi eczaneler</a>
      </div>
      ${dutySection}
      ${groupsHtml}
      ${disclaimerHtml()}
      <p class="tz-ph__footer">
        Eczane envanteri OpenStreetMap (ODbL) dahil izinli kaynaklardan oluşturulur; her eczanenin kaynağı ve doğrulama durumu kendi detay sayfasında belirtilir. Nöbet listeleri yetkili kaynaklardan doğrulanarak işlenir; kaynak verisi yoksa liste boş kalır.
        <br /><a href="${SITE}/support">Destek</a> · <a href="${SITE}/">Trabzone ana sayfa</a>
      </p>
    </main>
  `;
}

function directoryNoscriptHtml(model) {
  return `<div style="max-width:760px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10203f;background:#fff">
    <h2>${escapeHtml(model.area)} eczaneleri</h2>
    <p>${escapeHtml(model.description)}</p>
    <p>${Number(model.items.length)} eczane kaydı; ${Number(model.dutyItems.length)} nöbetçi kayıt.</p>
  </div>`;
}

/** `/eczaneler` ve `/nobetci-eczaneler[/ilçe]` sayfaları. */
async function renderPharmacyDirectory(payload) {
  const template = await getTemplate();
  const model = directoryModel(payload);
  const districts = Array.isArray(payload.districts) ? payload.districts : [];

  let html = applyHead(template, {
    title: model.title,
    description: model.description,
    canonical: model.canonical,
    image: DEFAULT_IMAGE,
    ogType: 'website',
    robots:
      model.isDutyPage && !model.hasDutyData
        ? 'noindex,follow,max-image-preview:large'
        : 'index,follow,max-image-preview:large,max-snippet:-1',
    jsonLd: directoryJsonLd(model),
  });
  html = applyBody(
    html,
    directoryBodyHtml(model, districts, payload.today),
    directoryNoscriptHtml(model),
  );
  return html;
}

module.exports = {
  DUTY_PATH,
  INDEX_PATH,
  renderPharmacyDetail,
  renderPharmacyDirectory,
};
