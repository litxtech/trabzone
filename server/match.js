/**
 * Trabzonspor Maç Arenası web sayfaları (`/trabzonspor`, `/trabzonspor/mac/{id}`).
 *
 * Veriler yalnızca herkese açık `sports_*` RPC'lerinden (anon anahtar) okunur.
 * TEST maçları bu RPC'lerde anon kullanıcıya hiç dönmez. Skor, olay ve durum
 * resmi veri sağlayıcısının (API-Football) kaydıdır; eksik veri uydurulmaz.
 * Logo ve oyuncu fotoğrafı yalnızca yönetici kullanım hakkını açtıysa
 * RPC'den gelir; aksi halde sayfaya eklenmez.
 */

const { SITE, DEFAULT_IMAGE, applyBody, applyHead, escapeHtml, getTemplate, rpc, truncate } = require('./seo');

const HUB_PATH = '/trabzonspor';

const PHASE_LABELS = {
  scheduled: 'Başlamadı',
  first_half: 'İlk yarı',
  half_time: 'Devre arası',
  second_half: 'İkinci yarı',
  extra_time: 'Uzatma',
  break_time: 'Uzatma arası',
  penalties: 'Penaltılar',
  suspended: 'Askıya alındı',
  interrupted: 'Durduruldu',
  live: 'Canlı',
  finished: 'Maç sona erdi',
  finished_aet: 'Uzatmalarda bitti',
  finished_pen: 'Penaltılarla bitti',
  postponed: 'Ertelendi',
  cancelled: 'İptal edildi',
  abandoned: 'Yarıda kaldı',
  awarded: 'Hükmen',
  walkover: 'Hükmen',
  unknown: 'Durum bilinmiyor',
};

const GOAL_KINDS = new Set(['goal', 'own_goal', 'penalty_goal']);
const EVENT_LABELS = {
  goal: 'Gol',
  own_goal: 'Kendi kalesine gol',
  penalty_goal: 'Penaltı golü',
  missed_penalty: 'Kaçan penaltı',
  yellow: 'Sarı kart',
  second_yellow: 'İkinci sarı kart',
  red: 'Kırmızı kart',
  substitution: 'Oyuncu değişikliği',
  var: 'VAR',
};

function istanbulDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    timeZone: 'Europe/Istanbul',
  }).format(date);
}

function istanbulTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(date);
}

function score(value) {
  return value === null || value === undefined ? '–' : String(value);
}

function teamName(team, fallback) {
  return (team && team.name) || fallback;
}

function matchTitle(fixture) {
  return `${teamName(fixture.home, 'Ev sahibi')} – ${teamName(fixture.away, 'Deplasman')}`;
}

function statusText(fixture) {
  const status = fixture.status || {};
  const label = PHASE_LABELS[status.phase] || PHASE_LABELS.unknown;
  if (status.is_live && status.elapsed != null) {
    return `${label} · ${status.elapsed}${status.extra ? `+${status.extra}` : ''}'`;
  }
  return label;
}

function eventStatusSchema(phase) {
  if (phase === 'postponed') return 'https://schema.org/EventPostponed';
  if (phase === 'cancelled' || phase === 'abandoned') return 'https://schema.org/EventCancelled';
  return 'https://schema.org/EventScheduled';
}

function matchModel(detail) {
  const fixture = detail.fixture;
  const canonical = `${SITE}${HUB_PATH}/mac/${fixture.id}`;
  const scheduled = fixture.status.phase === 'scheduled';
  const title = scheduled
    ? `${matchTitle(fixture)} | ${fixture.league.name || 'Maç'} | Trabzone`
    : `${teamName(fixture.home, 'Ev sahibi')} ${score(fixture.goals.home)}-${score(fixture.goals.away)} ${teamName(fixture.away, 'Deplasman')} | Trabzone`;
  const description = truncate(
    `${matchTitle(fixture)} · ${statusText(fixture)} · ${fixture.league.name || ''}${fixture.league.round ? ` (${fixture.league.round})` : ''}. ` +
      `${istanbulDateTime(fixture.kickoff_at)}. Canlı skor, maç akışı, istatistikler, kadrolar ve taraftar sohbeti Trabzone Maç Arenası'nda.`,
    165,
  );
  return { canonical, title, description, image: DEFAULT_IMAGE };
}

function matchJsonLd(detail, model) {
  const fixture = detail.fixture;
  const team = (side) => ({
    '@type': 'SportsTeam',
    name: teamName(fixture[side], side === 'home' ? 'Ev sahibi' : 'Deplasman'),
    ...(fixture[side] && fixture[side].logo ? { logo: fixture[side].logo } : {}),
  });
  const event = {
    '@type': 'SportsEvent',
    '@id': `${model.canonical}#event`,
    name: matchTitle(fixture),
    url: model.canonical,
    sport: 'Futbol',
    startDate: fixture.kickoff_at,
    eventStatus: eventStatusSchema(fixture.status.phase),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    homeTeam: team('home'),
    awayTeam: team('away'),
    competitor: [team('home'), team('away')],
    description: model.description,
    image: [model.image],
  };
  if (fixture.venue && fixture.venue.name) {
    event.location = {
      '@type': 'Place',
      name: fixture.venue.name,
      ...(fixture.venue.city ? { address: { '@type': 'PostalAddress', addressLocality: fixture.venue.city } } : {}),
    };
  }
  if (fixture.league && fixture.league.name) {
    event.superEvent = { '@type': 'SportsEvent', name: fixture.league.name };
  }
  return {
    '@context': 'https://schema.org',
    '@graph': [
      event,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Trabzone', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Trabzonspor', item: `${SITE}${HUB_PATH}` },
          { '@type': 'ListItem', position: 3, name: matchTitle(fixture), item: model.canonical },
        ],
      },
    ],
  };
}

const STYLES = `
  <style>
    .tz-match { max-width: 920px; margin: 0 auto; padding: 22px 18px 64px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0b1020; background: #fff; }
    .tz-match a { color: #7a1f3d; text-decoration: none; }
    .tz-match__crumbs { display: flex; flex-wrap: wrap; gap: 6px; font-size: 13px; color: #41506b; margin: 0 0 14px; }
    .tz-match__board { border-radius: 20px; padding: 22px; color: #fff; background: linear-gradient(135deg, #4a0f24, #7a1f3d 55%, #1b4e7a); }
    .tz-match__league { font-size: 13px; opacity: .8; margin: 0 0 12px; }
    .tz-match__row { display: flex; align-items: center; gap: 12px; }
    .tz-match__team { flex: 1; text-align: center; font-weight: 700; font-size: 17px; }
    .tz-match__score { min-width: 120px; text-align: center; font-size: 40px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .tz-match__status { text-align: center; font-size: 14px; opacity: .85; margin: 8px 0 0; }
    .tz-match h1 { font-size: 30px; line-height: 1.2; margin: 22px 0 8px; }
    .tz-match h2 { font-size: 20px; margin: 26px 0 10px; }
    .tz-match__facts { color: #41506b; line-height: 1.7; font-size: 15px; margin: 0; padding-left: 18px; }
    .tz-match__events { list-style: none; padding: 0; margin: 0; }
    .tz-match__events li { padding: 8px 0; border-bottom: 1px solid #eef1f7; font-size: 15px; }
    .tz-match__muted { color: #6b7a96; font-size: 12.5px; }
    .tz-match__cta { display: inline-block; margin-top: 16px; border-radius: 999px; padding: 11px 18px; font-weight: 600; background: #7a1f3d; color: #fff !important; }
    .tz-match__list { list-style: none; padding: 0; margin: 0; }
    .tz-match__list li { padding: 10px 0; border-bottom: 1px solid #eef1f7; }
  </style>`;

function eventLine(event) {
  const minute = event.minute != null ? `${event.minute}${event.extra ? `+${event.extra}` : ''}'` : '';
  const label = EVENT_LABELS[event.kind] || event.type || 'Olay';
  const who = [event.player_name, event.team_name ? `(${event.team_name})` : ''].filter(Boolean).join(' ');
  return `<li>${escapeHtml(minute)} ${escapeHtml(label)}${who ? ` · ${escapeHtml(who)}` : ''}</li>`;
}

function matchBodyHtml(detail, timeline, model) {
  const fixture = detail.fixture;
  const scheduled = fixture.status.phase === 'scheduled';
  const events = Array.isArray(timeline && timeline.events) ? timeline.events : [];
  const keyEvents = events.filter((event) => GOAL_KINDS.has(event.kind) || event.kind === 'red' || event.kind === 'second_yellow');
  const ht = fixture.score && fixture.score.halftime;
  const facts = [
    `Başlama: ${istanbulDateTime(fixture.kickoff_at)} (TSİ)`,
    fixture.league && fixture.league.name ? `Turnuva: ${fixture.league.name}${fixture.league.round ? ` · ${fixture.league.round}` : ''}` : '',
    fixture.venue && fixture.venue.name ? `Stat: ${fixture.venue.name}${fixture.venue.city ? `, ${fixture.venue.city}` : ''}` : '',
    fixture.referee ? `Hakem: ${fixture.referee}` : '',
    ht && ht.home != null && ht.away != null && !scheduled ? `İlk yarı: ${ht.home}-${ht.away}` : '',
    `Durum: ${statusText(fixture)}${fixture.status.is_finished && !fixture.final_verified ? ' (sonuç doğrulanıyor)' : ''}`,
  ].filter(Boolean);

  return `${STYLES}
    <main class="tz-match">
      <nav class="tz-match__crumbs" aria-label="breadcrumb">
        <a href="${SITE}/">Trabzone</a> <span aria-hidden="true">›</span>
        <a href="${SITE}${HUB_PATH}">Trabzonspor</a> <span aria-hidden="true">›</span>
        <span>${escapeHtml(matchTitle(fixture))}</span>
      </nav>
      <section class="tz-match__board" aria-label="Skor">
        <p class="tz-match__league">${escapeHtml([fixture.league.name, fixture.league.round].filter(Boolean).join(' · '))}</p>
        <div class="tz-match__row">
          <div class="tz-match__team">${escapeHtml(teamName(fixture.home, 'Ev sahibi'))}</div>
          <div class="tz-match__score">${scheduled ? escapeHtml(istanbulTime(fixture.kickoff_at)) : `${escapeHtml(score(fixture.goals.home))} – ${escapeHtml(score(fixture.goals.away))}`}</div>
          <div class="tz-match__team">${escapeHtml(teamName(fixture.away, 'Deplasman'))}</div>
        </div>
        <p class="tz-match__status">${escapeHtml(statusText(fixture))}</p>
      </section>
      <h1>${escapeHtml(matchTitle(fixture))}</h1>
      <ul class="tz-match__facts">${facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul>
      ${
        keyEvents.length
          ? `<h2>Goller ve kartlar</h2><ul class="tz-match__events">${keyEvents.map(eventLine).join('')}</ul>`
          : ''
      }
      <a class="tz-match__cta" href="${escapeHtml(`${SITE}/p/mac/${fixture.id}`)}" rel="nofollow">Canlı arenayı uygulamada aç</a>
      <p class="tz-match__muted">Veri: ${escapeHtml(detail.attribution || 'API-Football')}. Skor ve olaylar resmi veri sağlayıcısının kaydıdır; birkaç saniye gecikebilir. Trabzone maç yayını sunmaz.</p>
    </main>`;
}

async function renderMatchPage(detail, timeline) {
  const template = await getTemplate();
  const model = matchModel(detail);
  let html = applyHead(template, {
    title: model.title,
    description: model.description,
    canonical: model.canonical,
    image: model.image,
    ogType: 'website',
    robots: 'index,follow,max-image-preview:large,max-snippet:-1',
    jsonLd: matchJsonLd(detail, model),
  });
  html = applyBody(
    html,
    matchBodyHtml(detail, timeline, model),
    `<p><a href="${escapeHtml(model.canonical)}">${escapeHtml(matchTitle(detail.fixture))} maç sayfası</a></p>`,
  );
  return html;
}

function fixtureItem(fixture) {
  const scheduled = fixture.status.phase === 'scheduled';
  const result = scheduled ? istanbulDateTime(fixture.kickoff_at) : `${score(fixture.goals.home)}-${score(fixture.goals.away)} · ${statusText(fixture)}`;
  return `<li><a href="${SITE}${HUB_PATH}/mac/${fixture.id}">${escapeHtml(matchTitle(fixture))}</a> · ${escapeHtml(result)}<br /><span class="tz-match__muted">${escapeHtml(fixture.league.name || '')}</span></li>`;
}

async function renderHubPage(center) {
  const template = await getTemplate();
  const canonical = `${SITE}${HUB_PATH}`;
  const title = 'Trabzonspor Maç Merkezi: Canlı Skor, Fikstür, Puan Durumu | Trabzone';
  const description =
    'Trabzonspor canlı skor, maç akışı, istatistikler, kadrolar, fikstür ve puan durumu. Taraftar sohbeti ve maç yorumları Trabzone Maç Arenası’nda.';
  const upcoming = Array.isArray(center.upcoming) ? center.upcoming : [];
  const results = Array.isArray(center.results) ? center.results : [];
  const standing = center.standing;

  let html = applyHead(template, {
    title,
    description,
    canonical,
    image: DEFAULT_IMAGE,
    ogType: 'website',
    robots: 'index,follow,max-image-preview:large,max-snippet:-1',
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'CollectionPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'tr-TR' },
        ...[...upcoming.slice(0, 5)].map((fixture) => ({
          '@type': 'SportsEvent',
          name: matchTitle(fixture),
          url: `${SITE}${HUB_PATH}/mac/${fixture.id}`,
          startDate: fixture.kickoff_at,
          eventStatus: eventStatusSchema(fixture.status.phase),
          homeTeam: { '@type': 'SportsTeam', name: teamName(fixture.home, 'Ev sahibi') },
          awayTeam: { '@type': 'SportsTeam', name: teamName(fixture.away, 'Deplasman') },
        })),
      ],
    },
  });
  const body = `${STYLES}
    <main class="tz-match">
      <nav class="tz-match__crumbs" aria-label="breadcrumb"><a href="${SITE}/">Trabzone</a> <span aria-hidden="true">›</span> <span>Trabzonspor</span></nav>
      <h1>Trabzonspor Maç Merkezi</h1>
      ${
        standing
          ? `<p>${escapeHtml(standing.league_name)}: ${escapeHtml(String(standing.rank))}. sıra · ${escapeHtml(String(standing.points ?? '—'))} puan · ${escapeHtml(String(standing.played ?? '—'))} maç</p>`
          : ''
      }
      ${upcoming.length ? `<h2>Fikstür</h2><ul class="tz-match__list">${upcoming.slice(0, 10).map(fixtureItem).join('')}</ul>` : ''}
      ${results.length ? `<h2>Son sonuçlar</h2><ul class="tz-match__list">${results.slice(0, 10).map(fixtureItem).join('')}</ul>` : ''}
      <p class="tz-match__muted">Veri: ${escapeHtml(center.attribution || 'API-Football')}. Trabzone maç yayını sunmaz.</p>
    </main>`;
  html = applyBody(html, body, `<p><a href="${canonical}">Trabzonspor Maç Merkezi</a></p>`);
  return html;
}

async function fetchMatch(id) {
  let detail;
  try {
    detail = await rpc('sports_fixture_detail', { p_fixture: id });
  } catch (error) {
    if (String((error && error.message) || '').includes('not_found')) return null;
    throw error;
  }
  if (!detail || !detail.fixture || detail.fixture.is_test) return null;
  let timeline = null;
  try {
    timeline = await rpc('sports_fixture_timeline', { p_fixture: id });
  } catch {
    timeline = null;
  }
  return { detail, timeline };
}

/** Paylaşım kartı (`/p/mac/{id}`) verisi. */
async function matchShareCard(key) {
  const id = Number(key);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const data = await fetchMatch(id);
  if (!data) return null;
  const fixture = data.detail.fixture;
  const scheduled = fixture.status.phase === 'scheduled';
  return {
    type: 'match',
    label: 'Trabzonspor Maç Arenası',
    title: scheduled ? matchTitle(fixture) : `${teamName(fixture.home, 'Ev sahibi')} ${score(fixture.goals.home)}-${score(fixture.goals.away)} ${teamName(fixture.away, 'Deplasman')}`,
    description: truncate(`${statusText(fixture)} · ${fixture.league.name || ''} · ${istanbulDateTime(fixture.kickoff_at)}`, 220),
    image: null,
    path: `${HUB_PATH}/mac/${fixture.id}`,
    deepLink: `trabzone://trabzonspor/mac/${fixture.id}`,
    authorName: '',
    authorUsername: '',
    metrics: 'Canlı skor · maç akışı · taraftar sohbeti',
    location: fixture.venue && fixture.venue.city ? fixture.venue.city : '',
    price: '',
    publishedAt: fixture.kickoff_at,
  };
}

function renderMatchNotFound() {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Maç bulunamadı · Trabzone</title>
<meta name="robots" content="noindex, follow" />
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #4a0f24; color: #fff; text-align: center; }
  a { display: inline-block; padding: 13px 22px; border-radius: 14px; background: #fff; color: #7a1f3d; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
  <div>
    <h1>Bu maç bulunamadı</h1>
    <p>Bağlantı eski olabilir veya maç kaldırılmış olabilir.</p>
    <a href="${SITE}${HUB_PATH}">Trabzonspor Maç Merkezi</a>
  </div>
</body>
</html>`;
}

module.exports = {
  HUB_PATH,
  fetchMatch,
  matchShareCard,
  renderHubPage,
  renderMatchNotFound,
  renderMatchPage,
};
