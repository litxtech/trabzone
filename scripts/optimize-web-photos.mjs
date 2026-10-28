// Wikimedia Commons'tan indirilen ham fotoğrafları web için optimize eder.
// Ham dosyalar assets/web/photos altında kalır; çıktı assets/web altına yazılır.
// Kullanım: node scripts/optimize-web-photos.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SRC = path.resolve('assets/web/photos');
const OUT = path.resolve('assets/web');

const JOBS = [
  // Hero arka planı: geniş panorama, üzerine gradyan bineceği için hafif kırpma yeterli.
  { from: '01-panoromik-trabzon.jpg', to: 'hero-trabzon.jpg', width: 1800, height: 1000, fit: 'cover', quality: 70 },
  { from: '48-boztepe-trabzon.jpg', to: 'city-boztepe.jpg', width: 1200, height: 900, fit: 'cover', quality: 72 },
  { from: '05-trabzon-harbour.jpg', to: 'city-harbour.jpg', width: 1200, height: 900, fit: 'cover', quality: 72 },
  { from: '14-uzung-l-trabzon-2014.jpg', to: 'nature-uzungol.jpg', width: 1200, height: 900, fit: 'cover', quality: 72 },
  { from: '24-ayasofya-cami-trabzon.jpg', to: 'heritage-ayasofya.jpg', width: 1200, height: 900, fit: 'cover', quality: 72 },
  { from: '39-sera-g-l-ak-aabat-trabzon.jpg', to: 'nature-sera.jpg', width: 1200, height: 900, fit: 'cover', quality: 72 },
  // Akış kartları: kare kırpma, küçük boyut.
  { from: '27-trabzon-0025.jpg', to: 'feed-1.jpg', width: 720, height: 720, fit: 'cover', quality: 74 },
  { from: '04-trabzon-view-of-the-city.jpg', to: 'feed-2.jpg', width: 720, height: 720, fit: 'cover', quality: 74 },
  { from: '20-panoramic-view-of-the-hagia-sophia-of-trabzon.jpg', to: 'feed-3.jpg', width: 720, height: 720, fit: 'cover', quality: 74 },
  // Reels: dikey kare.
  { from: '15-sumela-from-across-valley.jpg', to: 'reel-sumela.jpg', width: 720, height: 1280, fit: 'cover', quality: 72 },
  { from: '11-trabzon-uzungol-3.jpg', to: 'reel-uzungol.jpg', width: 720, height: 1280, fit: 'cover', quality: 72 },
  // Marketplace / emlak kartları.
  { from: '30-trabzon-1-03.jpg', to: 'card-market.jpg', width: 800, height: 600, fit: 'cover', quality: 74 },
  { from: '36-atat-rk-k-k-trabzon-06.jpg', to: 'card-estate.jpg', width: 800, height: 600, fit: 'cover', quality: 74 },
];

const credits = JSON.parse(await readFile(path.join(SRC, 'CREDITS.json'), 'utf8'));
const byFile = new Map(credits.map((item) => [item.file, item]));

await mkdir(OUT, { recursive: true });

const used = [];
for (const job of JOBS) {
  const source = path.join(SRC, job.from);
  const target = path.join(OUT, job.to);
  try {
    await sharp(source)
      .resize(job.width, job.height, { fit: job.fit, position: 'attention' })
      .jpeg({ quality: job.quality, mozjpeg: true })
      .toFile(target);
    const { size } = await sharp(target).metadata().then(() => ({ size: 0 }));
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
    void size;
  } catch (error) {
    console.log(`HATA ${job.to}: ${error.message}`);
  }
}

await writeFile(
  path.join(OUT, 'credits.json'),
  JSON.stringify(used, null, 2),
  'utf8',
);

const total = used.reduce((sum, item) => sum + 1, 0);
console.log(`\n${total} görsel hazır -> assets/web`);
