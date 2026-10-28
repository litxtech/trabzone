// AI Haber Merkezi için ilçe görsellerini hazırlar.
//
// Kaynak fotoğraflar Wikimedia Commons'tan alınır; her ilçe için seçilmiş dosya
// `supabase/functions/ai-news-worker/district-images.json` içinde tutulur.
// Komut dosyası fotoğrafı indirir, `posts` deposuna `ai-news/districts/<ilçe>.jpg`
// yoluna yükler ve lisans/atıf bilgisini aynı JSON'a + worker'ın okuduğu
// `district-credits.ts` dosyasına yazar.
//
// Kullanım: node scripts/setup-ai-news-district-media.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(
  root,
  'supabase',
  'functions',
  'ai-news-worker',
  'district-images.json',
);
const creditsPath = join(
  root,
  'supabase',
  'functions',
  'ai-news-worker',
  'district-credits.ts',
);

const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('EXPO_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  process.exit(1);
}

const USER_AGENT = 'TrabzoneBot/1.0 (https://trabzone.app)';

const LICENSE_CODES = [
  [/^cc0|public domain/i, 'cc0'],
  [/^cc by-sa 4/i, 'cc_by_sa_4'],
  [/^cc by-sa 3/i, 'cc_by_sa_3'],
  [/^cc by-sa 2\.5/i, 'cc_by_sa_2_5'],
  [/^cc by 4/i, 'cc_by_4'],
  [/^cc by 3/i, 'cc_by_3'],
  [/^cc by 2\.5/i, 'cc_by_2_5'],
];

function licenseCode(shortName) {
  const value = String(shortName || '').trim();
  for (const [pattern, code] of LICENSE_CODES) {
    if (pattern.test(value)) return code;
  }
  return 'cc_by_sa_4';
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function commonsImage(title) {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1600',
    format: 'json',
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Commons ${response.status} ${title}`);
  }
  const payload = await response.json();
  const page = Object.values(payload.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) {
    throw new Error(`Commons dosyası bulunamadı: ${title}`);
  }
  const licenseName = info.extmetadata?.LicenseShortName?.value ?? '';
  const artist = stripHtml(info.extmetadata?.Artist?.value ?? '');
  const credit = [artist || 'Wikimedia Commons', licenseName, 'Wikimedia Commons']
    .filter(Boolean)
    .join(' · ')
    .slice(0, 200);
  return {
    url: info.thumburl || info.url,
    sourceUrl: info.descriptionurl || info.url,
    mime: info.thumbmime || info.mime || 'image/jpeg',
    width: info.thumbwidth || info.width,
    height: info.thumbheight || info.height,
    license: licenseCode(licenseName),
    licenseName,
    credit,
  };
}

async function upload(key, bytes, mime) {
  const path = `ai-news/districts/${key}.jpg`;
  const headers = {
    apikey: serviceKey,
    'Content-Type': mime || 'image/jpeg',
    'x-upsert': 'true',
    'User-Agent': USER_AGENT,
  };
  if (serviceKey.split('.').length === 3) {
    headers.Authorization = `Bearer ${serviceKey}`;
  }
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/posts/${encodeURI(path)}`,
    { method: 'POST', headers, body: bytes },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Yükleme başarısız (${response.status}) ${path}: ${text.slice(0, 300)}`);
  }
  return path;
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const failures = [];

for (const [key, entry] of Object.entries(manifest)) {
  try {
    const image = await commonsImage(entry.title);
    const response = await fetch(image.url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) {
      throw new Error(`Görsel indirilemedi (${response.status}) ${image.url}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 10_000) {
      throw new Error(`Görsel çok küçük (${bytes.byteLength} bayt) ${entry.title}`);
    }
    const path = await upload(key, bytes, image.mime);
    manifest[key] = {
      ...entry,
      storagePath: path,
      sourceUrl: image.sourceUrl,
      license: image.license,
      licenseName: image.licenseName,
      credit: image.credit,
      mime: image.mime,
      width: image.width,
      height: image.height,
    };
    console.log(`OK ${key} -> ${path} (${Math.round(bytes.byteLength / 1024)} KB) ${image.licenseName}`);
  } catch (error) {
    failures.push(`${key}: ${error.message}`);
    console.error(`FAIL ${key}: ${error.message}`);
  }
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const credits = Object.fromEntries(
  Object.entries(manifest).map(([key, entry]) => [
    key,
    {
      credit: entry.credit,
      license: entry.license,
      sourceUrl: entry.sourceUrl,
      representative: Boolean(entry.representative),
    },
  ]),
);
const generated = `// Otomatik üretildi: node scripts/setup-ai-news-district-media.mjs\n// Kaynak: Wikimedia Commons. Elle düzenlemek yerine manifest dosyasını güncelle.\nexport type DistrictImageCredit = {\n  credit: string;\n  license: string;\n  sourceUrl: string;\n  representative: boolean;\n};\n\nexport const DISTRICT_IMAGE_CREDITS: Record<string, DistrictImageCredit> = ${JSON.stringify(
  credits,
  null,
  2,
)};\n`;
writeFileSync(creditsPath, generated, 'utf8');

console.log(`\n${Object.keys(manifest).length - failures.length}/${Object.keys(manifest).length} ilçe görseli hazır.`);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
