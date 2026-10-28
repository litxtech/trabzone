// R2 bucket'ın r2.dev (managed public) adresini açar ve .env'e yazar.
// Panelde tıklamak yerine tek komut: token'ı ortam değişkeninden okur, diske yazmaz.
//
// Kullanım (PowerShell):
//   $env:CLOUDFLARE_API_TOKEN="..."; node scripts/r2-enable-dev.mjs
//
// Token izinleri: Account > Workers R2 Storage > Edit.
// Kapatmak için: node scripts/r2-enable-dev.mjs --disable

import { createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ENV_PATH = new URL('../.env', import.meta.url);
const API = 'https://api.cloudflare.com/client/v4';

const raw = readFileSync(ENV_PATH, 'utf8');
const env = Object.fromEntries(
  raw
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
const accountId = (env.R2_ACCOUNT_ID || '').trim();
const bucket = (env.R2_BUCKET_NAME || '').trim();
const disable = process.argv.includes('--disable');

if (!token) {
  console.error('CLOUDFLARE_API_TOKEN yok. Panelden de açabilirsin:');
  console.error('  R2 > bucket > Settings > Public access > R2.dev subdomain > Enable');
  process.exit(2);
}
if (!accountId || !bucket) {
  console.error('R2_ACCOUNT_ID / R2_BUCKET_NAME .env içinde yok.');
  process.exit(2);
}

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const detail = body.errors?.map((error) => `${error.code}: ${error.message}`).join('; ') ?? '';
    throw new Error(`${init.method ?? 'GET'} ${path} -> HTTP ${response.status} ${detail}`.trim());
  }
  return body.result;
}

const base = `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/domains/managed`;

const before = await api(base).catch((error) => {
  console.error(`Bucket durumu okunamadı: ${error.message}`);
  console.error('Token izni "Workers R2 Storage: Edit" olmalı ve hesap kimliği doğru olmalı.');
  process.exit(1);
});
console.log(`Mevcut durum: enabled=${Boolean(before.enabled)} domain=${before.domain ?? '-'}`);

const after = await api(base, {
  method: 'PUT',
  body: JSON.stringify({ enabled: !disable }),
});

const domain = after.domain ? `https://${String(after.domain).replace(/^https?:\/\//, '')}` : null;
console.log(`Yeni durum: enabled=${Boolean(after.enabled)} domain=${domain ?? '-'}`);

if (disable) {
  console.log('r2.dev adresi kapatıldı. .env değiştirilmedi.');
  process.exit(0);
}

if (!domain) {
  console.error('Public adres dönmedi. Panelden kontrol et: R2 > Settings > Public access.');
  process.exit(1);
}

// Public okuma gerçekten çalışıyor mu? İmzalı PUT ile test nesnesi at, oku, sil.
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const host = `${accountId}.r2.cloudflarestorage.com`;

function signed(method, key, body = '', contentType) {
  const dateTime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = dateTime.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const payloadHash = sha256(body);
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': dateTime,
    ...(contentType ? { 'content-type': contentType } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalUri = `/${bucket}/${key}`.split('/').map(encodeURIComponent).join('/');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(
    hmac(hmac(hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, dateStamp), 'auto'), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return {
    url: `https://${host}${canonicalUri}`,
    init: {
      method,
      headers: {
        Authorization:
          `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': dateTime,
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
      ...(body ? { body } : {}),
    },
  };
}

const testKey = `health/public-check-${Date.now()}.txt`;
const testBody = `public check ${new Date().toISOString()}`;

const put = signed('PUT', testKey, testBody, 'text/plain');
const putResponse = await fetch(put.url, put.init);
if (!putResponse.ok) {
  console.error(`Test nesnesi yüklenemedi (HTTP ${putResponse.status}).`);
  process.exit(1);
}

// R2.dev adresinde bucket adı URL'de tekrarlanmaz.
const publicTarget = `${domain}/${testKey}`;
const publicResponse = await fetch(publicTarget);
const publicBody = publicResponse.ok ? await publicResponse.text() : '';
const publicOk = publicResponse.ok && publicBody === testBody;
console.log(`Public okuma: ${publicResponse.status} ${publicOk ? 'MATCH' : 'no-match'} ${publicTarget}`);

const del = signed('DELETE', testKey);
await fetch(del.url, del.init);

if (!publicOk) {
  console.error('Public okuma başarısız; yeni adres .env\'e yazılmadı.');
  process.exit(1);
}

const updated = /^EXPO_PUBLIC_R2_PUBLIC_URL=.*$/m.test(raw)
  ? raw.replace(/^EXPO_PUBLIC_R2_PUBLIC_URL=.*$/m, `EXPO_PUBLIC_R2_PUBLIC_URL=${domain}`)
  : `${raw.replace(/\s*$/, '')}\nEXPO_PUBLIC_R2_PUBLIC_URL=${domain}\n`;
writeFileSync(ENV_PATH, updated);
console.log(`\nOK .env güncellendi: EXPO_PUBLIC_R2_PUBLIC_URL=${domain}`);
console.log('Metro\'yu yeniden başlat (veya yeni build al): EXPO_PUBLIC_* derleme anında gömülür.');
console.log('Doğrulama: npm run r2:e2e');
