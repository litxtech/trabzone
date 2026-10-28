// R2 bağlantı doğrulaması: verilen hesap kimliği + anahtarlarla bucket'a
// erişilebiliyor mu? Yalnızca okuma yapar.
//
// Kullanım: node scripts/r2-check.mjs [accountId]
// Değerler .env içinden okunur.

import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const accountId = (process.argv[2] || env.R2_ACCOUNT_ID || '').trim();
const bucket = (process.env.R2_BUCKET_NAME || env.R2_BUCKET_NAME || 'trabzone-media').trim();
const accessKey = (process.env.R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID || '').trim();
const secretKey = (process.env.R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY || '').trim();

if (!accountId || !accessKey || !secretKey) {
  console.error('R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY eksik.');
  process.exit(2);
}

const host = `${accountId}.r2.cloudflarestorage.com`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

function sign(method, path, query = {}) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;

  const canonicalUri = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const canonicalQuery = Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const payloadHash = sha256('');
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    'host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
    'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
    `Signature=${signature}`;

  return {
    url: `https://${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`,
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
  };
}

async function main() {
  try {
    const signed = sign('GET', '/');
    const response = await fetch(signed.url, { headers: signed.headers });
    if (response.ok) {
      const xml = await response.text();
      const buckets = [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((match) => match[1]);
      console.log(`OK hesap erişimi — buckets: ${buckets.join(', ') || '(boş)'}`);
    } else {
      console.log(`Hesap erişimi HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`Hesap erişimi başarısız: ${error.message}`);
  }

  try {
    const signed = sign('GET', `/${bucket}`, { 'list-type': '2', 'max-keys': '5' });
    const response = await fetch(signed.url, { headers: signed.headers });
    if (!response.ok) {
      console.log(`Bucket ${bucket} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return;
    }
    const xml = await response.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]);
    const count = /<KeyCount>(\d+)<\/KeyCount>/.exec(xml)?.[1] ?? '?';
    console.log(
      `OK bucket erişimi — ${bucket} (${count} nesne) örnek: ${keys.slice(0, 3).join(', ') || '-'}`,
    );
  } catch (error) {
    console.log(`Bucket erişimi başarısız: ${error.message}`);
  }
}

main();
