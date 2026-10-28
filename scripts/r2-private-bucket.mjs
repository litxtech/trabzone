// Gizli (private) R2 bucket'ı oluşturur ve CORS kuralını yazar.
//
// Neden ayrı bucket: sohbet medyası public özel adresten sunulmamalı. Public
// bucket'taki bir nesne adresi bilindiğinde herkes okuyabilir; private bucket'ta
// okuma yalnızca r2-sign'ın ürettiği süreli imzalı GET adresiyle yapılır.
//
// Kullanım (değerler ortam değişkeninden veya .env'den okunur):
//   node scripts/r2-private-bucket.mjs            # bucket'ı oluştur + CORS yaz
//   node scripts/r2-private-bucket.mjs --cors     # yalnızca CORS yaz
//
// Bucket adı R2_PRIVATE_BUCKET (varsayılan: trabzone-private).

import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const ENV_PATH = new URL('../.env', import.meta.url);

/** .env varsa okur; ortam değişkenleri her zaman önceliklidir. */
function readEnvFile() {
  if (!existsSync(ENV_PATH)) {
    return {};
  }
  const values = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

const fileEnv = readEnvFile();
const read = (name, fallback = '') =>
  (process.env[name] || fileEnv[name] || fallback).trim();

const accountId = read('R2_ACCOUNT_ID');
const bucket = read('R2_PRIVATE_BUCKET', 'trabzone-private');
const accessKey = read('R2_ACCESS_KEY_ID');
const secretKey = read('R2_SECRET_ACCESS_KEY');
const corsOnly = process.argv.includes('--cors');

if (!accountId || !accessKey || !secretKey) {
  console.error('R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY eksik.');
  console.error('Ortam degiskeni olarak verin ya da .env icine yazin.');
  process.exit(2);
}

const host = `${accountId}.r2.cloudflarestorage.com`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

/** SigV4 imzalı istek üretir. `query` alt kaynakları (cors=) destekler. */
function signed(method, path, { query = '', body = '', contentType } = {}) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const payloadHash = sha256(body);
  // CORS yazımında S3 uyumluluğu için Content-MD5 gerekir.
  const contentMd5 = body ? createHash('md5').update(body).digest('base64') : undefined;

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(contentType ? { 'content-type': contentType } : {}),
    ...(contentMd5 ? { 'content-md5': contentMd5 } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    path,
    query,
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
    url: `https://${host}${path}${query ? `?${query}` : ''}`,
    init: {
      method,
      headers: {
        Authorization:
          `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...(contentMd5 ? { 'Content-MD5': contentMd5 } : {}),
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
    <AllowedMethod>DELETE</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>Content-Length</ExposeHeader>
    <ExposeHeader>Content-Type</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

async function main() {
  console.log(`Hesap: ${accountId}`);
  console.log(`Gizli bucket: ${bucket}`);

  if (!corsOnly) {
    const create = signed('PUT', `/${bucket}`);
    const created = await fetch(create.url, create.init);
    const body = created.ok ? '' : (await created.text()).slice(0, 300);
    if (created.ok) {
      console.log('OK bucket olusturuldu (veya zaten vardi).');
    } else if (/BucketAlreadyOwnedByYou|BucketAlreadyExists/i.test(body)) {
      console.log('OK bucket zaten mevcut.');
    } else {
      console.error(`HATA: bucket olusturulamadi (HTTP ${created.status}): ${body}`);
      process.exit(1);
    }
  }

  const cors = signed('PUT', `/${bucket}`, {
    query: 'cors=',
    body: CORS_RULE,
    contentType: 'application/xml',
  });
  const corsResponse = await fetch(cors.url, cors.init);
  if (!corsResponse.ok) {
    console.error(
      `HATA: CORS yazilamadi (HTTP ${corsResponse.status}): ` +
        `${(await corsResponse.text()).slice(0, 300)}`,
    );
    process.exit(1);
  }
  console.log('OK CORS yazildi: GET/HEAD/PUT/DELETE.');

  const check = signed('GET', `/${bucket}`, { query: 'cors=' });
  const current = await fetch(check.url, check.init);
  if (current.ok) {
    const text = (await current.text()).trim();
    console.log(text ? `Mevcut kural:\n${text}` : 'UYARI: CORS kurali bos dondu.');
  }

  console.log(
    '\nSonraki adim: r2-sign edge function secret olarak R2_PRIVATE_BUCKET ' +
      `degerini "${bucket}" yapin (tanimsizsa bu varsayilan kullanilir).`,
  );
}

main().catch((error) => {
  console.error(`Beklenmeyen hata: ${error.message}`);
  process.exit(1);
});
