// Trabzon Eczacı Odası resmi nöbet listesi — HTML ayrıştırıcı (tek kaynak).
// Yalnızca sayfada AÇIKÇA yazılı olan alanlar okunur; eksik alan null kalır.

const SOURCE_URL = 'https://www.trabzoneczaciodasi.org.tr/nobetci-eczaneler/61';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  Referer: 'https://www.trabzoneczaciodasi.org.tr/',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'no-cache',
};

export const DUTY_SOURCE_KEY = 'teob';

const decode = (value) =>
  (value ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const cleanName = (value) => {
  const name = decode(value)
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s*$/, '')
    .trim();
  if (!name) return name;
  // Kaynak tamamen BÜYÜK harf yazıyorsa başlık biçimine çevrilir
  // ("SEHER ECZANESİ" → "Seher Eczanesi"). Karışık yazım korunur.
  if (name !== name.toLocaleUpperCase('tr-TR')) return name;
  return name
    .toLocaleLowerCase('tr-TR')
    .split(' ')
    .map((word) => (word ? word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1) : word))
    .join(' ');
};

/** "29.10.2026 18:00" → ISO 8601 (Europe/Istanbul, +03:00) */
function parseLocalDateTime(dateText, timeText) {
  const dateMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((dateText ?? '').trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec((timeText ?? '').trim());
  if (!dateMatch || !timeMatch) return null;
  const [, day, month, year] = dateMatch;
  const [, hour, minute] = timeMatch;
  const iso = `${year}-${month}-${day}T${hour.padStart(2, '0')}:${minute}:00+03:00`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return {
    iso: new Date(ms).toISOString(),
    date: `${year}-${month}-${day}`,
    time: `${hour.padStart(2, '0')}:${minute}:00`,
    dutyDate: `${year}-${month}-${day}`,
  };
}

/** "28.10.2026 18:00 - 29.10.2026 08:00 arası nöbetçidir." */
function parseWindow(text) {
  const match =
    /(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}:\d{2})/.exec(
      text ?? '',
    );
  if (!match) return null;
  const start = parseLocalDateTime(match[1], match[2]);
  const end = parseLocalDateTime(match[3], match[4]);
  if (!start || !end) return null;
  if (Date.parse(end.iso) <= Date.parse(start.iso)) return null;
  if (Date.parse(end.iso) - Date.parse(start.iso) > 30 * 3600 * 1000) return null;
  return { start, end };
}

function normalizePhone(raw) {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('5')) return `0${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return digits;
  if (digits.length === 12 && digits.startsWith('90')) return `0${digits.slice(2)}`;
  return null;
}

function parsePhone(raw) {
  const national = normalizePhone(raw);
  if (!national) return null;
  const exchange = national.slice(3, 6);
  if (exchange === '000' || exchange === '999') return null;
  return `+90 ${national.slice(1, 4)} ${national.slice(4, 7)} ${national.slice(7, 9)} ${national.slice(9, 11)}`;
}

/** Adres metni resmi listede iki kez yazılabiliyor; tekrarı temizle. */
function cleanAddress(raw) {
  const text = decode(raw)
    .replace(/Haritada görüntülemek için tıklayınız\.?\.\./gi, '')
    .trim();
  if (!text) return null;
  const half = Math.floor(text.length / 2);
  const left = text.slice(0, half).trim();
  const right = text.slice(half).trim();
  if (left.length > 10 && left === right) return left;
  return text;
}

/** HTML → yapılandırılmış nöbet kayıtları. Ağ erişimi yoksa hata fırlatır. */
export function parseDutyHtml(html) {
  const items = [];
  const blocks = html.split('class="news-post standart-post"').slice(1);
  for (const block of blocks) {
    const nameMatch = /<h1[^>]*>\s*<strong>([\s\S]*?)<\/strong>/i.exec(block);
    if (!nameMatch) continue;
    const name = cleanName(nameMatch[1]);
    if (!name || name.length < 3) continue;

    const districtMatch = /class="category category-[^"]*"\s*>\s*([^<]+)</i.exec(block);
    const district = districtMatch ? decode(districtMatch[1]) : null;

    const windowMatch = /fa-calendar"><\/i>\s*([\s\S]*?)<\/li>/i.exec(block);
    const window = parseWindow(windowMatch ? decode(windowMatch[1]) : '');
    if (!window) continue;

    const addressMatch = /fa-home"><\/i>\s*([\s\S]*?)<br/i.exec(block);
    const address = addressMatch ? cleanAddress(addressMatch[1]) : null;

    const phoneMatch = /href="tel:([^"]+)"/i.exec(block);
    const phone = phoneMatch ? parsePhone(phoneMatch[1]) : null;

    const coordMatch = /maps\?q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i.exec(block);
    const lat = coordMatch ? Number(coordMatch[1]) : null;
    const lng = coordMatch ? Number(coordMatch[2]) : null;

    items.push({
      name,
      district,
      address,
      phone,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      duty_date: window.start.dutyDate,
      start_time: window.start.time,
      end_time: window.end.time,
      starts_at: window.start.iso,
      ends_at: window.end.iso,
      source_ref: `teob:61:${window.start.iso}:${name}`,
    });
  }

  // Aynı kayıt iki kez yazılmışsa tekilleştir (isim + başlangıç).
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.name.toLocaleLowerCase('tr-TR')}|${item.starts_at}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchDutyPage(fetchImpl = fetch) {
  const response = await fetchImpl(SOURCE_URL, { headers: BROWSER_HEADERS });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`source_http_${response.status}`);
  }
  if (!/nöbetçidir|nobetcidir/i.test(html)) {
    throw new Error('source_markup_unexpected');
  }
  return { html, url: SOURCE_URL, fetchedAt: new Date().toISOString() };
}

export async function fetchAndParseDutyList(fetchImpl = fetch) {
  const page = await fetchDutyPage(fetchImpl);
  const items = parseDutyHtml(page.html);
  if (items.length === 0) {
    throw new Error('source_empty');
  }
  return { ...page, items };
}

export const DUTY_SOURCE_META = {
  key: DUTY_SOURCE_KEY,
  name: 'Trabzon Eczacı Odası nöbet listesi',
  kind: 'scrape',
  homepage_url: 'https://www.trabzoneczaciodasi.org.tr/nobetci-eczaneler/61',
  attribution_text: 'Trabzon Eczacı Odası (trabzoneczaciodasi.org.tr)',
  license_note:
    'Odanın resmî nöbet listesi. Kayıtlar olduğu gibi aktarılır, alan uydurulmaz.',
  sync_interval_minutes: 15,
};
