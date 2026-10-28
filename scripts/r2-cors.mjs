// R2 bucket CORS ayarı: tarayıcıdan (Expo web) imzalı PUT ile yükleme ve
// public GET ile gösterim için gerekli izinleri yazar.
//
// Native (iOS/Android) istemci CORS'a takılmaz; bu adım yalnızca web derlemesi
// için gereklidir. Kullanım:
//   node scripts/r2-cors.mjs           # mevcut kuralı yazdır + varsayılanı uygula
//   node scripts/r2-cors.mjs --show    # yalnızca mevcut kuralı yazdır
//
// Değerler .env içinden okunur (R2_ACCOUNT_ID, R2_BUCKET_NAME, anahtarlar).

import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ENV_PATH = new URL('../.env', import.meta.url);
const env = Object.fromEntries(
  readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const accountId = (env.R2_ACCOUNT_ID || '').trim();
const bucket = (env.R2_BUCKET_NAME || 'trabzone-media').trim();
const accessKey = (env.R2_ACCESS_KEY_ID || '').trim();
const secretKey = (env.R2_SECRET_ACCESS_KEY || '').trim();
const showOnly = process.argv.includes('--show');

if (!accountId || !accessKey || !secretKey) {
  console.error('R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY eksik.');
  process.exit(2);
}

const host = `${accountId}.r2.cloudflarestorage.com`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

/** `?cors` alt kaynağı için SigV4 imzalı istek üretir. */
function signed(method, body = '') {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const canonicalUri = `/${bucket}`;
  const canonicalQuery = 'cors=';
  const payloadHash = sha256(body);

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(method === 'PUT'
      ? {
          'content-md5': createHash('md5').update(body).digest('base64'),
          'content-type': 'application/xml',
        }
      : {}),
  };

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(
    hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), 'auto'), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return {
    url: `https://${host}${canonicalUri}?${canonicalQuery}`,
    init: {
      method,
      headers: {
        Authorization:
          `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        ...(method === 'PUT'
          ? {
              'Content-MD5': headers['content-md5'],
              'Content-Type': headers['content-type'],
            }
          : {}),
      },
      ...(body ? { body } : {}),
    },
  };
}

const CORS_RULE = `<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>Content-Length</ExposeHeader>
    <ExposeHeader>Content-Type</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

const current = signed('GET');
const read = await fetch(current.url, current.init).catch(() => null);
if (read) {
  const text = await read.text();
  console.log(`Mevcut CORS (HTTP ${read.status}):`);
  console.log(text.trim() || '(kural yok)');
}

if (showOnly) {
  process.exit(0);
}

const call = signed('PUT', CORS_RULE);
const response = await fetch(call.url, call.init);
if (!response.ok) {
  console.error(`HATA: CORS yazılamadı (HTTP ${response.status}): ${(await response.text()).slice(0, 240)}`);
  process.exit(1);
}
console.log('\nOK CORS yazıldı: GET/HEAD/PUT, tüm origin ve başlıklar.');
