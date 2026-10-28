// R2 custom domain kurulumu: zone'u Cloudflare'e ekler/doğrular, bucket'a
// `media.<domain>` bağlar, sertifika aktifleşince .env ve eas.json'daki public
// adresi günceller.
//
// Neden gerekli: `pub-xxxx.r2.dev` hızlı kurulum içindir, üretimde rate limit
// uygulanır. R2 custom domain yalnızca aynı Cloudflare hesabındaki AKTİF bir
// zone ile çalışır (harici DNS'te CNAME ile bağlanamaz).
//
// Kullanım (PowerShell):
//   # Yalnızca R2 yetkili token + panelden alınan zone ID (en az izin):
//   $env:CLOUDFLARE_API_TOKEN="..."; node scripts/r2-domain.mjs --domain trabzoneapp.com --zone-id <32-hex>
//   # Zone:Read izni de varsa zone ID otomatik bulunur:
//   $env:CLOUDFLARE_API_TOKEN="..."; node scripts/r2-domain.mjs --domain trabzoneapp.com
//   # Durum kontrolü:
//   $env:CLOUDFLARE_API_TOKEN="..."; node scripts/r2-domain.mjs --domain trabzoneapp.com --status
//
// Cloudflare Dashboard > trabzoneapp.com > Overview > sağ alt "Zone ID" alanından
// kopyalanır. Zone ID verilirse token'ın zone okuma izni olması gerekmez.
//
// Token izinleri (hesap düzeyi, her iki mod için):
//   Workers R2 Storage:Edit
//   Zone ID otomatik bulunacaksa ayrıca: Zone:Read (+ zone yoksa Zone:Edit, DNS:Edit)
//
// Akış:
//   1. zone'u bul (veya --zone-id kullan); yoksa oluştur -> nameserver'ları yazdır
//   2. media.<domain> için R2 custom domain ekle (zone aktif olmalı)
//   3. sertifika + DNS hazır olana kadar bekle
//   4. imzalı PUT ile test nesnesi at, public adresten oku, sil
//   5. .env ve eas.json içindeki EXPO_PUBLIC_R2_PUBLIC_URL'i güncelle

import { createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const ENV_PATH = new URL('.env', ROOT);
const EAS_PATH = new URL('eas.json', ROOT);
const API = 'https://api.cloudflare.com/client/v4';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const env = Object.fromEntries(
  readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
const accountId = (env.R2_ACCOUNT_ID || '').trim();
const bucket = (env.R2_BUCKET_NAME || 'trabzone-media').trim();
const accessKey = (env.R2_ACCESS_KEY_ID || '').trim();
const secretKey = (env.R2_SECRET_ACCESS_KEY || '').trim();

// Zone kök adı verilir; medya alt alan adı `media.` önekiyle türetilir.
const zoneName = (flag('domain') || '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim();
const mediaPrefix = (flag('subdomain') || 'media').replace(/\.$/, '');
const hostname = `${mediaPrefix}.${zoneName}`;
/** Panelden kopyalanan zone ID; verilirse token'ın Zone:Read izni gerekmez. */
const zoneIdArg = (flag('zone-id') || process.env.CLOUDFLARE_ZONE_ID || '').trim();

if (!token) {
  console.error('CLOUDFLARE_API_TOKEN yok.');
  console.error('Panelde Zone:Read + Zone:Edit + DNS:Edit + Workers R2 Storage:Edit yetkili bir token oluştur.');
  process.exit(2);
}
if (!zoneName) {
  console.error('Kullanım: node scripts/r2-domain.mjs --domain trabzoneapp.com');
  process.exit(2);
}
if (!accountId || !accessKey || !secretKey) {
  console.error('R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY .env içinde eksik.');
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
    const detail = (body.errors ?? [])
      .map((error) => `${error.code}: ${error.message}`)
      .join('; ');
    const error = new Error(`${init.method ?? 'GET'} ${path} -> HTTP ${response.status} ${detail}`.trim());
    error.status = response.status;
    throw error;
  }
  return body.result;
}

const zonePath = `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}`;

/** Zone'u bulur; yoksa oluşturur. */
async function ensureZone() {
  const found = await api(`/zones?name=${encodeURIComponent(zoneName)}&account.id=${accountId}`);
  if (found.length > 0) {
    const zone = found[0];
    console.log(`Zone mevcut: ${zone.name} (${zone.status}) id=${zone.id}`);
    return zone;
  }

  console.log(`Zone yok, oluşturuluyor: ${zoneName}`);
  const created = await api('/zones', {
    method: 'POST',
    body: JSON.stringify({
      name: zoneName,
      account: { id: accountId },
      type: 'full',
      jump_start: false,
    }),
  });
  console.log(`Zone oluşturuldu: ${created.name} (${created.status}) id=${created.id}`);
  return created;
}

/** Nameserver'ları yazdırır (registrar'da bu değerler girilmeli). */
async function printNameservers(zone) {
  const nameservers = zone.name_servers ?? (await api(`/zones/${zone.id}`)).name_servers ?? [];
  console.log('\nRegistrar\'da (Hostinger) şu nameserver\'ları kullan:');
  for (const ns of nameservers) {
    console.log(`  ${ns}`);
  }
  return nameservers;
}

/** S3 SigV4 ile imzalı istek (test nesnesi için). */
const s3Host = `${accountId}.r2.cloudflarestorage.com`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

function s3Request(method, key, body = '', contentType) {
  const dateTime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = dateTime.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const payloadHash = sha256(body);
  const headers = {
    host: s3Host,
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
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return {
    url: `https://${s3Host}${canonicalUri}`,
    init: {
      method,
      headers: {
        Authorization:
          `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': dateTime,
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
      ...(body ? { body } : {}),
    },
  };
}

/** Public adres gerçekten bu bucket'ı mı sunuyor? */
async function verifyPublicHost(targetHost) {
  const testKey = `health/domain-check-${Date.now()}.txt`;
  const testBody = `trabzone domain check ${new Date().toISOString()}`;

  const put = s3Request('PUT', testKey, testBody, 'text/plain');
  const putResponse = await fetch(put.url, put.init);
  if (!putResponse.ok) {
    console.error(`Test nesnesi yüklenemedi (HTTP ${putResponse.status}).`);
    return false;
  }

  const target = `https://${targetHost}/${testKey}`;
  let ok = false;
  // Sertifika/DNS yeni aktifleştiğinde ilk istekler 404/526 dönebilir.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(target, { redirect: 'follow' }).catch(() => null);
    const body = response?.ok ? await response.text() : '';
    if (body === testBody) {
      ok = true;
      console.log(`Public okuma: ${response.status} MATCH ${target}`);
      break;
    }
    console.log(`Deneme ${attempt}: HTTP ${response?.status ?? 'yok'} — 10 sn sonra tekrar`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  const del = s3Request('DELETE', testKey);
  await fetch(del.url, del.init);
  return ok;
}

/** .env ve eas.json içindeki public adresi günceller. */
function writePublicUrl(url) {
  const raw = readFileSync(ENV_PATH, 'utf8');
  const updated = /^EXPO_PUBLIC_R2_PUBLIC_URL=.*$/m.test(raw)
    ? raw.replace(/^EXPO_PUBLIC_R2_PUBLIC_URL=.*$/m, `EXPO_PUBLIC_R2_PUBLIC_URL=${url}`)
    : `${raw.replace(/\s*$/, '')}\nEXPO_PUBLIC_R2_PUBLIC_URL=${url}\n`;
  writeFileSync(ENV_PATH, updated);
  console.log('OK .env güncellendi: EXPO_PUBLIC_R2_PUBLIC_URL');

  const eas = JSON.parse(readFileSync(EAS_PATH, 'utf8'));
  let changed = 0;
  for (const profile of Object.values(eas.build ?? {})) {
    if (profile?.env && 'EXPO_PUBLIC_R2_PUBLIC_URL' in profile.env) {
      profile.env.EXPO_PUBLIC_R2_PUBLIC_URL = url;
      changed += 1;
    }
  }
  if (changed > 0) {
    writeFileSync(EAS_PATH, `${JSON.stringify(eas, null, 2)}\n`);
    console.log(`OK eas.json güncellendi: ${changed} profil`);
  }
}

async function main() {
  console.log(`Zone: ${zoneName}`);
  console.log(`Hedef: ${hostname}`);
  console.log(`Bucket: ${bucket}\n`);

  // Zone ID panelden verildiyse token'ın zone okuma izni gerekmez: API yalnızca
  // R2 custom domain uçlarını kullanır.
  let zoneId = zoneIdArg;
  if (!zoneId) {
    const zone = await ensureZone();
    await printNameservers(zone);
    const current = await api(`/zones/${zone.id}`);
    if (has('status')) {
      console.log(`\nZone durumu: ${current.status}`);
      const domains = await api(`${zonePath}/domains/custom`);
      console.log(`Custom domain'ler: ${JSON.stringify(domains.domains ?? [])}`);
      return;
    }
    if (current.status !== 'active') {
      console.error(`\nZone henüz "${current.status}". Registrar'da nameserver'ları yukarıdaki değerlerle değiştir.`);
      console.error('Yayılma genelde 5 dk - 24 saat sürer. Sonra tekrar çalıştır:');
      console.error(`  node scripts/r2-domain.mjs --domain ${zoneName}`);
      process.exit(1);
    }
    console.log(`\nZone aktif: ${zoneName}`);
    zoneId = zone.id;
  } else {
    console.log(`Zone ID (panelden): ${zoneId}`);
    if (!/^[0-9a-f]{32}$/i.test(zoneId)) {
      console.error('Zone ID 32 karakterlik hex olmalı (Dashboard > Overview > Zone ID).');
      process.exit(2);
    }
  }

  const existing = await api(`${zonePath}/domains/custom`);
  const already = (existing.domains ?? []).some((entry) => entry.domain === hostname);

  if (has('status')) {
    console.log(`\nMevcut custom domain'ler: ${JSON.stringify(existing.domains ?? [])}`);
    return;
  }

  if (!already) {
    try {
      await api(`${zonePath}/domains/custom`, {
        method: 'POST',
        body: JSON.stringify({
          domain: hostname,
          zoneId,
          minTLS: '1.2',
          enabled: true,
        }),
      });
      console.log(`OK custom domain eklendi: ${hostname}`);
    } catch (error) {
      // 409 = zaten var; diğer hatalar gerçek sorundur.
      if (error.status !== 409) {
        throw error;
      }
      console.log(`Custom domain zaten bağlı: ${hostname}`);
    }
  } else {
    console.log(`Custom domain zaten bağlı: ${hostname}`);
  }

  // DNS/sertifika hazır olana kadar bekle (en fazla ~3 dk).
  // API `status` alanını nesne olarak döndürür: { ssl, ownership }.
  const statusText = (status) => {
    if (!status) {
      return '?';
    }
    if (typeof status === 'string') {
      return status;
    }
    return `ssl=${status.ssl ?? '?'} ownership=${status.ownership ?? '?'}`;
  };
  const isActive = (status) => {
    if (!status) {
      return false;
    }
    if (typeof status === 'string') {
      return status.toLowerCase() === 'active';
    }
    return (
      String(status.ssl ?? '').toLowerCase() === 'active' &&
      String(status.ownership ?? '').toLowerCase() === 'active'
    );
  };

  let active = false;
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    const domains = await api(`${zonePath}/domains/custom`);
    const entry = (domains.domains ?? []).find((item) => item.domain === hostname);
    if (entry) {
      console.log(`Durum: ${statusText(entry.status)} (${attempt}/18)`);
      if (isActive(entry.status)) {
        active = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  const publicUrl = `https://${hostname}`;
  if (!active) {
    console.log('\nSertifika henüz "active" değil. Genelde birkaç dakika sürer.');
    console.log('Hazır olduğunda tekrar çalıştır:');
    console.log(`  node scripts/r2-domain.mjs --domain ${zoneName} --zone-id ${zoneId}`);
    process.exit(1);
  }

  if (!(await verifyPublicHost(hostname))) {
    console.error('\nPublic okuma doğrulanamadı; adres .env\'e yazılmadı.');
    process.exit(1);
  }

  writePublicUrl(publicUrl);
  console.log(`\nSonraki adım: Metro'yu yeniden başlat; ardından npm run r2:e2e`);
  console.log(`Eski adres (${env.EXPO_PUBLIC_R2_PUBLIC_URL}) kaldırılabilir.`);
}

main().catch((error) => {
  console.error(`\nHATA: ${error.message}`);
  if (error.status === 403) {
    console.error('Token izinleri yetersiz. Gerekli: Workers R2 Storage:Edit.');
    console.error('Zone otomatik bulunacaksa ayrıca Zone:Read (ve zone yoksa Zone:Edit, DNS:Edit).');
    console.error('Alternatif: --zone-id <32-hex> vererek yalnızca R2 izniyle çalıştır.');
  }
  if (error.status === 500) {
    console.error('Cloudflare iç hatası: zone ID yanlış olabilir ya da zone henüz aktif değil.');
    console.error('Dashboard > trabzoneapp.com > Overview: "Zone ID" ve status "Active" olmalı.');
  }
  process.exit(1);
});
