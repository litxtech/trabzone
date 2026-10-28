// Trabzon fotoğraflarını Wikimedia Commons'tan indirir (serbest lisanslı).
// Kullanım: node scripts/fetch-web-photos.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('assets/web');
const QUERIES = [
  'Trabzon city view',
  'Trabzon harbour',
  'Uzungol Trabzon',
  'Sumela Monastery',
  'Trabzon Ayasofya',
  'Trabzon street',
  'Trabzon Ataturk Mansion',
  'Akcaabat Trabzon',
  'Trabzon panorama',
  'Trabzon Boztepe',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function search(query, attempt = 0) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&generator=search' +
    `&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=6` +
    '&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600&format=json';
  const res = await fetch(url, { headers: { 'User-Agent': 'trabzone-web/1.0 (contact@litxtech.com)' } });
  const text = await res.text();
  if (!text.trim().startsWith('{')) {
    if (attempt < 3) {
      await sleep(6000 * (attempt + 1));
      return search(query, attempt + 1);
    }
    console.log(`atlandı "${query}": ${text.slice(0, 60)}`);
    return [];
  }
  const json = JSON.parse(text);
  const pages = json.query?.pages ?? {};
  return Object.values(pages)
    .map((page) => {
      const info = page.imageinfo?.[0];
      if (!info) return null;
      const meta = info.extmetadata ?? {};
      return {
        title: page.title.replace(/^File:/, ''),
        width: info.width,
        height: info.height,
        url: info.thumburl ?? info.url,
        license: meta.LicenseShortName?.value ?? 'unknown',
        author: (meta.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim(),
      };
    })
    .filter(Boolean)
    .filter((item) => /\.(jpe?g|png)$/i.test(item.title))
    .filter((item) => item.width >= 1200);
}

const seen = new Set();
const picked = [];
for (const query of QUERIES) {
  const items = await search(query);
  for (const item of items) {
    if (seen.has(item.title)) continue;
    if (/\.(svg|tif|tiff|gif)$/i.test(item.title)) continue;
    seen.add(item.title);
    picked.push({ ...item, query });
  }
  await sleep(1500);
}

console.log(`bulunan: ${picked.length}`);
for (const item of picked) {
  console.log(`${item.license.padEnd(22)} ${item.width}x${item.height} ${item.title}`);
}

await mkdir(path.join(OUT, 'photos'), { recursive: true });
const credits = [];
const shortlist = picked.filter((item) => /^(CC0|Public domain|CC BY|CC BY-SA)/i.test(item.license));

let index = 0;
for (const item of shortlist) {
  index += 1;
  const slug = item.title
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const file = `${String(index).padStart(2, '0')}-${slug}.jpg`;
  const target = path.join(OUT, 'photos', file);
  try {
    const res = await fetch(item.url, { headers: { 'User-Agent': 'trabzone-web/1.0' } });
    if (!res.ok) {
      console.log(`atlandı ${file} (${res.status})`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(target, buffer);
    credits.push({
      file,
      title: item.title,
      license: item.license,
      author: item.author || 'Wikimedia Commons',
      source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(item.title)}`,
    });
    console.log(`indirildi ${file} (${Math.round(buffer.length / 1024)} KB)`);
  } catch (error) {
    console.log(`hata ${file}: ${error.message}`);
  }
}

await writeFile(
  path.join(OUT, 'photos', 'CREDITS.json'),
  JSON.stringify(credits, null, 2),
  'utf8',
);
console.log(`\n${credits.length} fotoğraf indirildi.`);
