// Trabzone Haber profili için markalı kare avatar üretir ve `avatar` bucket'ına yükler.
// Kullanım: node scripts/setup-ai-news-avatar.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

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

const SIZE = 512;
const pixels = new Uint8Array(SIZE * SIZE * 3);
const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

function setPixel(x, y, [r, g, b], alpha = 1) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const offset = (y * SIZE + x) * 3;
  pixels[offset] = clamp(pixels[offset] * (1 - alpha) + r * alpha);
  pixels[offset + 1] = clamp(pixels[offset + 1] * (1 - alpha) + g * alpha);
  pixels[offset + 2] = clamp(pixels[offset + 2] * (1 - alpha) + b * alpha);
}

const FONT = {
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
};

function fillRect(x, y, width, height, color, alpha = 1) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(column, row, color, alpha);
    }
  }
}

function drawText(x, y, text, scale, color) {
  let cursor = x;
  for (const raw of text.toUpperCase()) {
    const glyph = FONT[raw] ?? FONT[' '];
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if (glyph[row][column] === '#') {
          fillRect(cursor + column * scale, y + row * scale, scale, scale, color, 1);
        }
      }
    }
    cursor += 6 * scale;
  }
}

// Koyu lacivert gradyan zemin.
for (let y = 0; y < SIZE; y += 1) {
  const t = y / SIZE;
  for (let x = 0; x < SIZE; x += 1) {
    const offset = (y * SIZE + x) * 3;
    pixels[offset] = clamp(10 + t * 18 + (x / SIZE) * 8);
    pixels[offset + 1] = clamp(16 + t * 24 + (x / SIZE) * 12);
    pixels[offset + 2] = clamp(32 + t * 40 + (x / SIZE) * 26);
  }
}

// Marka halkası.
const cx = SIZE / 2;
const cy = SIZE / 2;
for (let angle = 0; angle < Math.PI * 2; angle += 0.002) {
  for (let thickness = 0; thickness < 6; thickness += 1) {
    const radius = 208 - thickness;
    setPixel(Math.round(cx + Math.cos(angle) * radius), Math.round(cy + Math.sin(angle) * radius), [86, 132, 255], 0.85);
  }
}

// Monogram: TH
drawText(Math.round(cx - 78), Math.round(cy - 91), 'T', 14, [245, 247, 255]);
drawText(Math.round(cx - 6), Math.round(cy - 91), 'H', 14, [167, 139, 250]);

// Alt marka çizgisi.
fillRect(Math.round(cx - 46), Math.round(cy + 78), 92, 5, [86, 132, 255], 0.9);

// --- PNG kodlama ---
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 3 + 1)] = 0;
  for (let x = 0; x < SIZE * 3; x += 1) {
    raw[y * (SIZE * 3 + 1) + 1 + x] = pixels[y * SIZE * 3 + x];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 2;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const userId = process.argv[2] || env.AI_NEWS_PUBLISHER_ID || '';
if (!userId) {
  console.error('kullanım: node scripts/setup-ai-news-avatar.mjs <profil-id>');
  process.exit(1);
}

const path = `${userId}/brand-avatar.png`;
const url = `${env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/avatars/${path}`;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { 'Content-Type': 'image/png', 'x-upsert': 'true', apikey: key };
if (key.split('.').length === 3) headers.Authorization = `Bearer ${key}`;

const response = await fetch(url, { method: 'POST', headers, body: png });
console.log(`${response.status} ${png.length} bytes ${(await response.text()).slice(0, 200)}`);
console.log(`avatar_path=${path}`);
if (!response.ok) process.exit(1);
