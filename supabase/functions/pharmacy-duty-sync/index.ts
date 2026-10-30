// pharmacy-duty-sync: Trabzon Eczacı Odası resmî nöbet listesini çeker, ayrıştırır
// ve `pharmacy_duty_ingest` ile veritabanına yazar.
//
// İlkeler:
//   • Yalnızca sayfada AÇIKÇA yazılı alanlar aktarılır; eksik alan uydurulmaz.
//   • Kayıt sayısı sıfırsa veya sayfa tanınmıyorsa HİÇBİR ŞEY yazılmaz, hata
//     döner ve eski kayıtlar olduğu gibi kalır (yanlış bilgi üretilmez).
//   • Yazma yetkisi yalnızca iç cron anahtarı veya yönetici oturumundadır.

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pharmacy-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SOURCE_KEY = 'teob';
const SOURCE_URL = 'https://www.trabzoneczaciodasi.org.tr/nobetci-eczaneler/61';

const BROWSER_HEADERS: Record<string, string> = {
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

type DutyRecord = {
  name: string;
  district: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  duty_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  ends_at: string;
  source_ref: string;
};

const env = (key: string) => Deno.env.get(key) ?? '';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });

const decodeEntities = (value: string) =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** Kaynak tamamen BÜYÜK harf yazıyorsa başlık biçimine çevirir. */
function titleCaseName(name: string): string {
  if (!name || name !== name.toLocaleUpperCase('tr-TR')) return name;
  return name
    .toLocaleLowerCase('tr-TR')
    .split(' ')
    .map((word) => (word ? word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1) : word))
    .join(' ');
}

function parseLocalDateTime(dateText: string, timeText: string) {
  const dateMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateText.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());
  if (!dateMatch || !timeMatch) return null;
  const [, day, month, year] = dateMatch;
  const [, hour, minute] = timeMatch;
  const iso = `${year}-${month}-${day}T${hour.padStart(2, '0')}:${minute}:00+03:00`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return {
    iso: new Date(ms).toISOString(),
    dutyDate: `${year}-${month}-${day}`,
    time: `${hour.padStart(2, '0')}:${minute}:00`,
  };
}

function parseWindow(text: string) {
  const match =
    /(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}:\d{2})/.exec(
      text,
    );
  if (!match) return null;
  const start = parseLocalDateTime(match[1], match[2]);
  const end = parseLocalDateTime(match[3], match[4]);
  if (!start || !end) return null;
  const span = Date.parse(end.iso) - Date.parse(start.iso);
  if (span <= 0 || span > 30 * 3600 * 1000) return null;
  return { start, end };
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  let national: string | null = null;
  if (digits.length === 10 && digits.startsWith('5')) national = `0${digits}`;
  else if (digits.length === 11 && digits.startsWith('0')) national = digits;
  else if (digits.length === 12 && digits.startsWith('90')) national = `0${digits.slice(2)}`;
  if (!national) return null;
  const exchange = national.slice(3, 6);
  if (exchange === '000' || exchange === '999') return null;
  return `+90 ${national.slice(1, 4)} ${national.slice(4, 7)} ${national.slice(7, 9)} ${national.slice(9, 11)}`;
}

function cleanAddress(raw: string): string | null {
  const text = decodeEntities(raw).replace(/Haritada görüntülemek için tıklayınız\.?\.?/gi, '').trim();
  if (!text) return null;
  const half = Math.floor(text.length / 2);
  const left = text.slice(0, half).trim();
  const right = text.slice(half).trim();
  if (left.length > 10 && left === right) return left;
  return text.slice(0, 400);
}

export function parseDutyHtml(html: string): DutyRecord[] {
  const items: DutyRecord[] = [];
  const blocks = html.split('class="news-post standart-post"').slice(1);

  for (const block of blocks) {
    const nameMatch = /<h1[^>]*>\s*<strong>([\s\S]*?)<\/strong>/i.exec(block);
    if (!nameMatch) continue;
    const name = titleCaseName(
      decodeEntities(nameMatch[1]).replace(/\s+/g, ' ').replace(/\s+-\s*$/, '').trim(),
    );
    if (name.length < 3) continue;

    const districtMatch = /class="category category-[^"]*"\s*>\s*([^<]+)</i.exec(block);
    const district = districtMatch ? decodeEntities(districtMatch[1]) : null;

    const windowMatch = /fa-calendar"><\/i>\s*([\s\S]*?)<\/li>/i.exec(block);
    const window = parseWindow(windowMatch ? decodeEntities(windowMatch[1]) : '');
    if (!window) continue;

    const addressMatch = /fa-home"><\/i>\s*([\s\S]*?)<br/i.exec(block);
    const phoneMatch = /href="tel:([^"]+)"/i.exec(block);
    const coordMatch = /maps\?q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i.exec(block);

    const lat = coordMatch ? Number(coordMatch[1]) : null;
    const lng = coordMatch ? Number(coordMatch[2]) : null;

    items.push({
      name: name.slice(0, 140),
      district,
      address: addressMatch ? cleanAddress(addressMatch[1]) : null,
      phone: phoneMatch ? normalizePhone(phoneMatch[1]) : null,
      lat: lat != null && lat >= 40.55 && lat <= 41.25 ? lat : null,
      lng: lng != null && lng >= 38.9 && lng <= 40.7 ? lng : null,
      duty_date: window.start.dutyDate,
      start_time: window.start.time,
      end_time: window.end.time,
      starts_at: window.start.iso,
      ends_at: window.end.iso,
      source_ref: `teob:61:${window.start.iso}:${name}`,
    });
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.name.toLocaleLowerCase('tr-TR')}|${item.starts_at}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Supabase istemcisi: service_role anahtarıyla doğrudan REST çağrıları.
 * (npm bağımlılığı olmadan, tek dosyada çalışır.)
 */
function serviceHeaders(): Record<string, string> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

const baseUrl = () => (env('SUPABASE_URL') || '').replace(/\/$/, '');

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${baseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify(params),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`rpc_${name}_${response.status}:${text.slice(0, 200)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function alreadyAuthorizedAsAdmin(authorization: string): Promise<boolean> {
  const jwt = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return false;
  const anon = env('SUPABASE_ANON_KEY') || env('SUPABASE_PUBLISHABLE_KEY') || '';
  if (!anon || jwt === anon) return false;
  try {
    const response = await fetch(`${baseUrl()}/rest/v1/rpc/pharmacy_admin_check`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const action = typeof body.action === 'string' ? body.action : 'sync';

  if (action === 'health') {
    return json(200, { ok: true, source: SOURCE_URL, has_service_key: serviceHeaders().apikey.length > 0 });
  }

  const headerToken = req.headers.get('x-pharmacy-token') ?? '';
  let authorized = false;
  if (headerToken) {
    try {
      authorized = (await rpc<boolean>('pharmacy_duty_worker_token_ok', { p_token: headerToken })) === true;
    } catch {
      authorized = false;
    }
  }
  if (!authorized) {
    authorized = await alreadyAuthorizedAsAdmin(req.headers.get('authorization') ?? '');
  }
  if (!authorized) return json(401, { error: 'unauthorized' });

  // Kaynak sayfasını çek. Hata varsa veritabanına DOKUNULMAZ.
  let html = '';
  try {
    const response = await fetch(SOURCE_URL, { headers: BROWSER_HEADERS });
    if (!response.ok) {
      return json(502, { error: 'source_http', status: response.status });
    }
    html = await response.text();
  } catch (error) {
    return json(502, { error: 'source_unreachable', detail: String(error).slice(0, 160) });
  }

  if (!/nöbetçidir/i.test(html)) {
    return json(422, { error: 'source_markup_unexpected' });
  }

  const records = parseDutyHtml(html);
  if (records.length === 0) {
    return json(422, { error: 'source_empty' });
  }

  if (action === 'preview') {
    return json(200, { count: records.length, records });
  }

  try {
    const result = await rpc<Record<string, unknown>>('pharmacy_duty_ingest', {
      p_source_key: SOURCE_KEY,
      p_records: records,
      p_fetched_at: new Date().toISOString(),
      p_mark_verified: true,
    });
    return json(200, { ok: true, parsed: records.length, ...result });
  } catch (error) {
    return json(500, { error: 'ingest_failed', detail: String(error).slice(0, 300) });
  }
});
