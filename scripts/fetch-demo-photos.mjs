// Örnek (demo) ilanlar için Wikimedia Commons'tan serbest lisanslı fotoğraflar indirir.
// Kullanım: node scripts/fetch-demo-photos.mjs [--force]
// İndirilen dosyalar `assets/demo/` altında tutulur ve `scripts/demo-seed.mjs`
// tarafından Supabase Storage'a yüklenir.
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('assets/demo');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) ?? '')
  .replace('--only=', '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

/**
 * slug -> { query, keywords }
 * `keywords` dosya başlığında geçmek zorunda: arama motoru alakasız sonuç
 * döndürdüğünde yanlış fotoğrafın indirilmesini engeller.
 */
const TARGETS = {
  // Emlak
  'estate-salon': {
    query: 'apartment living room interior sofa',
    keywords: ['living room'],
  },
  'estate-daire': {
    query: 'apartment building facade balconies',
    keywords: ['apartment', 'building'],
  },
  'estate-mustakil': {
    query: 'detached house with garden exterior',
    keywords: ['house'],
  },
  'estate-dukkan': {
    query: 'retail store interior shelves',
    keywords: ['store', 'shop'],
  },
  'estate-kafe': {
    query: 'cafe interior coffee shop tables',
    keywords: ['cafe', 'coffee'],
  },
  'estate-arsa': {
    query: 'empty grass field countryside',
    keywords: ['field', 'meadow'],
  },
  // Marketplace
  'market-telefon': {
    query: 'iPhone 13 smartphone',
    keywords: ['iphone'],
  },
  'market-bisiklet': {
    query: 'mountain bike bicycle',
    keywords: ['bike', 'bicycle'],
  },
  'market-koltuk': {
    query: 'sofa',
    keywords: ['sofa', 'couch'],
  },
  'market-camasir': {
    query: 'washing machine front loader',
    keywords: ['washing machine'],
  },
  'market-konsol': {
    query: 'PlayStation 5 console',
    keywords: ['playstation'],
  },
  'market-pekmez': {
    query: 'honey jar glass',
    keywords: ['honey'],
  },
  'market-bebek': {
    query: 'baby stroller pram',
    keywords: ['stroller', 'pram'],
  },
  'market-masa': {
    query: 'office desk workspace',
    keywords: ['desk'],
  },
  // Yolculuk (araç fotoğrafları)
  'ride-corolla': {
    query: 'Toyota Corolla white sedan parked',
    keywords: ['corolla'],
  },
  'ride-clio': {
    query: 'Renault Clio hatchback car',
    keywords: ['clio'],
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function search(query, attempt = 0) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&generator=search' +
    `&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=12` +
    '&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1400&format=json';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'trabzone-demo/1.0 (contact@litxtech.com)' },
  });
  const text = await res.text();
  if (!text.trim().startsWith('{')) {
    if (attempt < 3) {
      await sleep(5000 * (attempt + 1));
      return search(query, attempt + 1);
    }
    return [];
  }
  const json = JSON.parse(text);
  const pages = json.query?.pages ?? {};
  return Object.values(pages)
    .map((page) => {
      const info = page.imageinfo?.[0];
      if (!info?.thumburl) {
        return null;
      }
      if (!/^image\/(jpeg|png|webp)$/.test(info.mime ?? '')) {
        return null;
      }
      return {
        title: page.title,
        url: info.thumburl,
        width: info.width ?? 0,
        height: info.height ?? 0,
      };
    })
    .filter(Boolean);
}

async function download(url, dest, attempt = 0) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'trabzone-demo/1.0 (contact@litxtech.com)' },
  });
  if (!res.ok) {
    if (attempt < 2) {
      await sleep(3000);
      return download(url, dest, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buffer);
  return buffer.length;
}

await mkdir(OUT, { recursive: true });

const creditsPath = path.join(OUT, 'credits.json');
const credits = FORCE ? [] : (await import(`file://${creditsPath.replace(/\\/g, '/')}`).catch(() => ({ items: [] }))).items ?? [];
const kept = new Set(credits.map((item) => item.slug));

for (const [slug, target] of Object.entries(TARGETS)) {
  if (ONLY.length > 0 && !ONLY.includes(slug)) {
    continue;
  }
  const dest = path.join(OUT, `${slug}.jpg`);
  if (!FORCE && existsSync(dest) && kept.has(slug)) {
    console.log(`atlandı (var) ${slug}`);
    continue;
  }
  if (FORCE && existsSync(dest)) {
    await unlink(dest).catch(() => undefined);
  }
  const results = await search(target.query);
  const keywords = target.keywords.map((keyword) => keyword.toLowerCase());
  const pick = results
    .filter((item) => {
      const title = item.title.toLowerCase();
      return keywords.some((keyword) => title.includes(keyword));
    })
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];

  if (!pick) {
    console.log(`bulunamadı ${slug} <- "${target.query}" (${results.length} sonuç, başlıklar uymadı)`);
    continue;
  }
  try {
    const bytes = await download(pick.url, dest);
    const existing = credits.findIndex((item) => item.slug === slug);
    const entry = { slug, query: target.query, title: pick.title, source: pick.url };
    if (existing >= 0) {
      credits[existing] = entry;
    } else {
      credits.push(entry);
    }
    console.log(`indirildi ${slug} (${Math.round(bytes / 1024)} KB) <- ${pick.title}`);
  } catch (error) {
    console.log(`hata ${slug}: ${error.message}`);
  }
  await sleep(1200);
}

await writeFile(
  creditsPath,
  `${JSON.stringify(
    {
      note: 'Wikimedia Commons, serbest lisanslı görseller. Her görselin lisansı için kaynak sayfasına bakın.',
      items: credits,
    },
    null,
    2,
  )}\n`,
);
console.log('bitti');
