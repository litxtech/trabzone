// R2 kurulumu: hesap kimliği ve public taban adresini doğrulayıp .env'e yazar,
// istenirse Supabase edge function secret'larını da günceller.
//
// Kullanım:
//   node scripts/r2-setup.mjs --account <account_id> --public-url https://pub-xxxx.r2.dev
//   node scripts/r2-setup.mjs --account <account_id> --public-url https://media.ornek.com --push
//
// Doğrulama adımları:
//   1. ListBuckets  -> anahtarlar bu hesaba mı ait?
//   2. Bucket list  -> R2_BUCKET_NAME erişilebilir mi?
//   3. Test nesnesi yükle -> public adresten okunabiliyor mu? (public access açık mı)
//   4. Test nesnesini sil.

import { createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ENV_PATH = new URL('../.env', import.meta.url);

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const readEnv = () => {
  const raw = readFileSync(ENV_PATH, 'utf8');
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return { raw, values };
};

const { raw, values } = readEnv();

const accountId = (flag('account') || values.R2_ACCOUNT_ID || '').trim();
const publicUrl = (flag('public-url') || values.EXPO_PUBLIC_R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const bucket = (flag('bucket') || process.env.R2_BUCKET_NAME || values.R2_BUCKET_NAME || 'trabzone-media').trim();
const accessKey = (process.env.R2_ACCESS_KEY_ID || values.R2_ACCESS_KEY_ID || '').trim();
const secretKey = (process.env.R2_SECRET_ACCESS_KEY || values.R2_SECRET_ACCESS_KEY || '').trim();
/** Doğrulama sırasında .env'e yazmayı kapatır (deneme/CI için). */
const dryRun = has('dry-run');

if (!accountId || !accessKey || !secretKey) {
  console.error('Eksik: --account <id> ya da .env icindeki R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
  process.exit(2);
}

const host = `${accountId}.r2.cloudflarestorage.com`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

function signedRequest(method, path, { query = {}, body = '', contentType } = {}) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const payloadHash = sha256(body);

  const canonicalUri = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const canonicalQuery = Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(contentType ? { 'content-type': contentType } : {}),
  };
  const sortedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaders.map((key) => `${key}:${headers[key]}\n`).join('');
  const signedHeaders = sortedHeaders.join(';');

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  );
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const outgoing = {
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };

  const url = `https://${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  return { url, init: { method, headers: outgoing, ...(body ? { body } : {}) } };
}

async function main() {
  console.log(`Hesap: ${accountId}`);
  console.log(`Bucket: ${bucket}`);

  const bucketsCall = signedRequest('GET', '/');
  const bucketsResponse = await fetch(bucketsCall.url, bucketsCall.init);
  if (!bucketsResponse.ok) {
    console.error(`HATA: Hesap dogrulanamadi (HTTP ${bucketsResponse.status}).`);
    console.error('Anahtarlar bu hesap kimligine ait olmayabilir ya da silinmis olabilir.');
    process.exit(1);
  }
  const bucketsXml = await bucketsResponse.text();
  const buckets = [...bucketsXml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((match) => match[1]);
  console.log(`Hesaptaki bucket'lar: ${buckets.join(', ') || '(bos)'}`);
  if (!buckets.includes(bucket)) {
    console.error(`HATA: "${bucket}" bu hesapta yok. Cloudflare R2 > Create bucket ile olusturun.`);
    process.exit(1);
  }

  const testKey = `health/r2-check-${Date.now()}.txt`;
  const testBody = `trabzone r2 check ${new Date().toISOString()}`;

  const putCall = signedRequest('PUT', `/${bucket}/${testKey}`, {
    body: testBody,
    contentType: 'text/plain',
  });
  const put = await fetch(putCall.url, putCall.init);
  if (!put.ok) {
    console.error(`HATA: Test nesnesi yuklenemedi (HTTP ${put.status}): ${(await put.text()).slice(0, 160)}`);
    process.exit(1);
  }
  console.log(`Test nesnesi yuklendi: ${bucket}/${testKey}`);

  if (!publicUrl) {
    console.log('UYARI: --public-url verilmedi; public erisim testi atlandi.');
  } else {
    // r2.dev / custom domain adresleri bucket'a özeldir; adresin içinde bucket
    // adı tekrar edilmez, nesne anahtarı doğrudan eklenir.
    const publicTarget = `${publicUrl}/${testKey}`;
    const publicResponse = await fetch(publicTarget);
    const publicBody = publicResponse.ok ? await publicResponse.text() : '';
    if (publicResponse.ok && publicBody === testBody) {
      console.log(`OK public erisim: ${publicTarget}`);
    } else {
      console.log(`UYARI: public adres okunamadi (HTTP ${publicResponse.status}).`);
      console.log('Bucket > Settings > Public access > R2.dev subdomain acik mi kontrol edin.');
    }
  }

  const deleteCall = signedRequest('DELETE', `/${bucket}/${testKey}`);
  const del = await fetch(deleteCall.url, deleteCall.init);
  console.log(`Test nesnesi silindi: ${del.ok ? 'evet' : `hayir (HTTP ${del.status})`}`);

  if (!publicUrl) {
    console.error('HATA: EXPO_PUBLIC_R2_PUBLIC_URL olmadan medya gosterilemez. --public-url verin.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('(--dry-run) .env yazilmadi, secret push atlandi.');
    return;
  }

  let updated = raw;
  const setLine = (key, value) => {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    updated = pattern.test(updated)
      ? updated.replace(pattern, `${key}=${value}`)
      : `${updated.replace(/\s*$/, '')}\n${key}=${value}\n`;
  };
  setLine('R2_ACCOUNT_ID', accountId);
  setLine('EXPO_PUBLIC_R2_PUBLIC_URL', publicUrl);
  writeFileSync(ENV_PATH, updated);
  console.log('OK .env guncellendi: R2_ACCOUNT_ID, EXPO_PUBLIC_R2_PUBLIC_URL');

  if (has('push')) {
    const { spawnSync } = await import('node:child_process');
    const projectRef = values.SUPABASE_PROJECT_REF;
    if (!projectRef) {
      console.error('HATA: .env icinde SUPABASE_PROJECT_REF yok; secret push atlandi.');
      process.exit(1);
    }
    const secrets = [
      `R2_ACCOUNT_ID=${accountId}`,
      `R2_ACCESS_KEY_ID=${accessKey}`,
      `R2_SECRET_ACCESS_KEY=${secretKey}`,
      `R2_BUCKET=${bucket}`,
    ];
    const result = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['supabase', 'secrets', 'set', ...secrets, '--project-ref', projectRef],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      console.error('HATA: supabase secrets set basarisiz.');
      process.exit(1);
    }
    console.log('OK edge function secret\'lari guncellendi.');
  }

  console.log('\nSonraki adim: npx supabase functions deploy r2-sign --project-ref ' + (values.SUPABASE_PROJECT_REF ?? '<ref>'));
}

main().catch((error) => {
  console.error(`Beklenmeyen hata: ${error.message}`);
  process.exit(1);
});
