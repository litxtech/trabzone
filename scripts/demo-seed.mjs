// Örnek ilan fotoğraflarını Supabase Storage'a yükler.
//
// Kullanım:
//   node scripts/demo-seed.mjs            # assets/demo/*.jpg -> Storage (demo/*.jpg)
//   node scripts/demo-seed.mjs --check    # yalnızca mevcut dosyaları listeler
//
// Fotoğraflar `is_demo` içerikle birlikte kullanılır. Yükleme idempotenttir
// (upsert); aynı yol tekrar yazılır. Görseller yüklenmeden de örnek ilanlar
// oluşturulabilir, yalnızca kartlarda görsel boş kalır.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

// sharp opsiyoneldir: kurulu değilse dosyalar olduğu gibi yüklenir.
let sharp = null;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.log('sharp bulunamadı; görseller yeniden boyutlandırılmadan yüklenecek.');
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const url = env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('EXPO_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  process.exit(1);
}

const DIR = join(root, 'assets', 'demo');
if (!existsSync(DIR)) {
  console.error('assets/demo bulunamadı. Önce: node scripts/fetch-demo-photos.mjs');
  process.exit(1);
}

const files = readdirSync(DIR).filter((file) => file.endsWith('.jpg'));

/** Dosya adına göre hedef kova. */
function bucketFor(file) {
  if (file.startsWith('estate-')) {
    return 'real-estate-media';
  }
  if (file.startsWith('ride-')) {
    return 'ride-vehicle-photos';
  }
  return 'listing-images';
}

if (process.argv.includes('--check')) {
  console.log(`${files.length} görsel hazır:`);
  for (const file of files) {
    console.log(`  ${bucketFor(file)}/demo/${file}`);
  }
  process.exit(0);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let uploaded = 0;
let failed = 0;

for (const file of files) {
  const bucket = bucketFor(file);
  const source = join(DIR, file);
  try {
    // Kartlar ve detay ekranı için 1200x900 yeterli; depolama şişmesin.
    const buffer = sharp
      ? await sharp(source)
          .resize(1200, 900, { fit: 'cover', position: 'attention' })
          .jpeg({ quality: 74, mozjpeg: true })
          .toBuffer()
      : readFileSync(source);

    const { error } = await supabase.storage.from(bucket).upload(`demo/${file}`, buffer, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: true,
    });
    if (error) {
      throw new Error(error.message);
    }
    uploaded += 1;
    console.log(`yüklendi ${bucket}/demo/${file} (${Math.round(buffer.length / 1024)} KB)`);
  } catch (error) {
    failed += 1;
    console.error(`HATA ${bucket}/demo/${file}: ${error.message}`);
  }
}

console.log(`\n${uploaded} görsel yüklendi${failed > 0 ? `, ${failed} hata` : ''}.`);
console.log('Şimdi yönetici panelinden (Sistem → Örnek Veri) içeriği yükleyebilirsin.');
