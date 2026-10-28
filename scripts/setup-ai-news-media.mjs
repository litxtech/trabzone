// AI Haber Merkezi için markalı kategori kartını üretir ve `posts` bucket'ına yükler.
// Kart, olay fotoğrafı iddiası taşımayan bir Trabzone tasarımıdır.
//
// Kullanım: node scripts/setup-ai-news-media.mjs
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

const WIDTH = 1280;
const HEIGHT = 720;

const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  İ: ['..#..', '.....', '#####', '..#..', '..#..', '..#..', '#####'],
  Ç: ['.####', '#....', '#....', '#....', '#....', '.####', '..#..'],
  Ğ: ['.#.#.', '.....', '.###.', '#...#', '#.###', '#...#', '.###.'],
  Ö: ['#...#', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  Ş: ['.####', '#....', '.###.', '....#', '####.', '.....', '..#..'],
  Ü: ['#...#', '.....', '#...#', '#...#', '#...#', '#...#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '..##.', '..##.'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ':': ['.....', '..##.', '..##.', '.....', '..##.', '..##.', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
};

const pixels = new Uint8Array(WIDTH * HEIGHT * 3);

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

function setPixel(x, y, [r, g, b], alpha = 1) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * 3;
  pixels[offset] = clamp(pixels[offset] * (1 - alpha) + r * alpha);
  pixels[offset + 1] = clamp(pixels[offset + 1] * (1 - alpha) + g * alpha);
  pixels[offset + 2] = clamp(pixels[offset + 2] * (1 - alpha) + b * alpha);
}

function fillRect(x, y, width, height, color, alpha = 1) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(column, row, color, alpha);
    }
  }
}

function drawText(x, y, text, scale, color, alpha = 1) {
  let cursor = x;
  for (const raw of text.toUpperCase()) {
    const glyph = FONT[raw] ?? FONT[' '];
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if (glyph[row][column] === '#') {
          fillRect(cursor + column * scale, y + row * scale, scale, scale, color, alpha);
        }
      }
    }
    cursor += 6 * scale;
  }
  return cursor;
}

// Arka plan: koyu lacivert dikey gradyan.
for (let y = 0; y < HEIGHT; y += 1) {
  const t = y / HEIGHT;
  const color = [
    10 + t * 16,
    16 + t * 22,
    32 + t * 34,
  ];
  for (let x = 0; x < WIDTH; x += 1) {
    const offset = (y * WIDTH + x) * 3;
    pixels[offset] = clamp(color[0]);
    pixels[offset + 1] = clamp(color[1]);
    pixels[offset + 2] = clamp(color[2]);
  }
}

// Marka renkli çapraz şeritler.
for (let i = 0; i < 900; i += 1) {
  const x = WIDTH - 520 + i;
  for (let thickness = 0; thickness < 210; thickness += 1) {
    const px = x + thickness;
    const py = 90 + i * 0.55 + thickness * 0.2;
    const t = thickness / 210;
    const color = [
      65 + t * 63,
      105 + t * (-18),
      245 + t * 0,
    ];
    setPixel(Math.round(px), Math.round(py), color, 0.09);
    setPixel(Math.round(px), Math.round(py) + 1, color, 0.05);
  }
}

// Sol üst marka çubuğu ve wordmark.
fillRect(88, 96, 96, 8, [86, 132, 255], 1);
drawText(88, 132, 'TRABZONE', 4, [245, 247, 255], 1);
drawText(88, 180, 'HABER MERKEZİ', 2, [167, 139, 250], 1);

// Orta başlık.
drawText(88, 300, 'TRABZON', 9, [255, 255, 255], 1);
drawText(88, 378, 'GÜNDEMİ', 9, [255, 255, 255], 1);
drawText(88, 470, 'AI DESTEKLİ HABER DERLEMESİ', 3, [160, 178, 214], 1);

// Alt bilgi.
fillRect(88, 596, 380, 2, [86, 132, 255], 0.8);
drawText(88, 618, 'TRABZONE.APP', 2, [148, 164, 200], 1);

// Sağ altta büyük yarı saydam harf.
drawText(980, 470, 'H', 26, [86, 132, 255], 0.16);

// --- PNG kodlama ---
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
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

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  raw[y * (WIDTH * 3 + 1)] = 0;
  for (let x = 0; x < WIDTH * 3; x += 1) {
    raw[y * (WIDTH * 3 + 1) + 1 + x] = pixels[y * WIDTH * 3 + x];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // truecolor
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const url = `${env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/posts/ai-news/_shared/card.png`;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { 'Content-Type': 'image/png', 'x-upsert': 'true' };
if (key.split('.').length === 3) headers.Authorization = `Bearer ${key}`;
headers.apikey = key;

const response = await fetch(url, { method: 'POST', headers, body: png });
const text = await response.text();
console.log(`${response.status} ${png.length} bytes ${text.slice(0, 300)}`);
if (!response.ok) process.exit(1);
