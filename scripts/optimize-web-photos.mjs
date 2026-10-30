// Wikimedia Commons'tan indirilen ham fotoğrafları web için optimize eder.
// Ham dosyalar assets/web/photos altında kalır; çıktı assets/web altına WebP olarak yazılır.
// Boyutlar, görsellerin sayfada çizildiği en büyük boyuta göre seçildi (Lighthouse
// "resim yayınlamayı kolaylaştırın" denetimi).
// Kullanım: node scripts/optimize-web-photos.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SRC = path.resolve('assets/web/photos');
const OUT = path.resolve('assets/web');
const PUBLIC = path.resolve('public');

const JOBS = [
  // Hero arka planı: üzerine koyu gradyan bindiği için düşük kalite yeterli.
  // Ana sayfanın statik açılış kabuğu (LCP) da bu dosyayı kullanır.
  { from: '01-panoromik-trabzon.jpg', to: 'hero-trabzon.webp', width: 1280, height: 711, quality: 42 },
  { from: '48-boztepe-trabzon.jpg', to: 'city-boztepe.webp', width: 800, height: 600, quality: 62 },
  { from: '05-trabzon-harbour.jpg', to: 'city-harbour.webp', width: 800, height: 600, quality: 62 },
  { from: '14-uzung-l-trabzon-2014.jpg', to: 'nature-uzungol.webp', width: 800, height: 600, quality: 62 },
  { from: '24-ayasofya-cami-trabzon.jpg', to: 'heritage-ayasofya.webp', width: 800, height: 600, quality: 62 },
  { from: '39-sera-g-l-ak-aabat-trabzon.jpg', to: 'nature-sera.webp', width: 800, height: 600, quality: 62 },
  // Akış kartları: kare kırpma, küçük boyut.
  { from: '27-trabzon-0025.jpg', to: 'feed-1.webp', width: 540, height: 540, quality: 62 },
  { from: '04-trabzon-view-of-the-city.jpg', to: 'feed-2.webp', width: 540, height: 540, quality: 62 },
  { from: '20-panoramic-view-of-the-hagia-sophia-of-trabzon.jpg', to: 'feed-3.webp', width: 540, height: 540, quality: 55 },
  // Reels: dikey kare.
  { from: '15-sumela-from-across-valley.jpg', to: 'reel-sumela.webp', width: 540, height: 960, quality: 50 },
  { from: '11-trabzon-uzungol-3.jpg', to: 'reel-uzungol.webp', width: 540, height: 960, quality: 60 },
  // Marketplace / emlak kartları.
  { from: '30-trabzon-1-03.jpg', to: 'card-market.webp', width: 640, height: 480, quality: 62 },
  { from: '36-atat-rk-k-k-trabzon-06.jpg', to: 'card-estate.webp', width: 640, height: 480, quality: 62 },
];

// Masaüstü açılış kabuğu için geniş hero (srcset); Metro paketine girmez.
const WIDE_HERO = { from: '01-panoromik-trabzon.jpg', width: 1800, height: 1000, quality: 45 };

const credits = JSON.parse(await readFile(path.join(SRC, 'CREDITS.json'), 'utf8'));
const byFile = new Map(credits.map((item) => [item.file, item]));

await mkdir(OUT, { recursive: true });

const used = [];
for (const job of JOBS) {
  const source = path.join(SRC, job.from);
  const target = path.join(OUT, job.to);
  try {
    await sharp(source)
      .resize(job.width, job.height, { fit: 'cover', position: 'attention' })
      .webp({ quality: job.quality, effort: 6 })
      .toFile(target);
    const buffer = await readFile(target);
    const credit = byFile.get(job.from);
    used.push({
      file: job.to,
      license: credit?.license ?? 'unknown',
      author: credit?.author ?? 'Wikimedia Commons',
      title: credit?.title ?? job.from,
      source: credit?.source ?? '',
    });
    console.log(`${job.to} (${Math.round(buffer.length / 1024)} KB) <- ${job.from}`);
  } catch (error) {
    console.log(`HATA ${job.to}: ${error.message}`);
  }
}

try {
  await sharp(path.join(SRC, WIDE_HERO.from))
    .resize(WIDE_HERO.width, WIDE_HERO.height, { fit: 'cover', position: 'attention' })
    .webp({ quality: WIDE_HERO.quality, effort: 6 })
    .toFile(path.join(PUBLIC, 'hero-trabzon-1800.webp'));
  console.log('public/hero-trabzon-1800.webp hazır');
} catch (error) {
  console.log(`HATA hero-trabzon-1800.webp: ${error.message}`);
}

await writeFile(
  path.join(OUT, 'credits.json'),
  JSON.stringify(used, null, 2),
  'utf8',
);

console.log(`\n${used.length} görsel hazır -> assets/web`);
