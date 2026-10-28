// Kazara kalıcı test kullanıcısı: geçici bir QA hesabı oluşturur, r2-sign
// akışını uçtan uca dener ve hesabı siler.
//
// Kullanım: node scripts\r2-e2e.mjs
// Gereken: .env içinde SUPABASE_SERVICE_ROLE_KEY.

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY yok.');
  process.exit(2);
}

const admin = (path, init = {}) =>
  fetch(`${supabaseUrl}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

const email = `cursor.r2check.${Date.now()}@trabzone.test`;
const password = `R2Check!${randomUUID().slice(0, 12)}`;

const created = await admin('users', {
  method: 'POST',
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const createdBody = await created.json();
if (!created.ok) {
  console.error('Kullanıcı oluşturulamadı:', created.status, JSON.stringify(createdBody).slice(0, 300));
  process.exit(1);
}
const uid = createdBody.id;
console.log(`Geçici kullanıcı: ${uid}`);

const cleanup = async () => {
  const removed = await admin(`users/${uid}`, { method: 'DELETE' });
  console.log(`Geçici kullanıcı silindi: ${removed.ok ? 'evet' : `hayır (${removed.status})`}`);
};

const login = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await login.json();
if (!login.ok || !session.access_token) {
  console.error('Giriş başarısız:', login.status, JSON.stringify(session).slice(0, 300));
  await cleanup();
  process.exit(1);
}
console.log('Giriş OK');

const key = `posts/${uid}/r2/e2e-${Date.now()}.jpg`;
const body = Buffer.from('trabzone e2e image bytes');

async function sign(action) {
  const response = await fetch(`${supabaseUrl}/functions/v1/r2-sign`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, key, contentType: 'image/jpeg' }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) {
    console.error(`imza alınamadı (${action}): ${response.status}`, JSON.stringify(data).slice(0, 300));
    return null;
  }
  return data.url;
}

const putUrl = await sign('put');
if (!putUrl) {
  await cleanup();
  process.exit(1);
}
console.log('İmzalı PUT alındı');

const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body });
console.log(`PUT ${put.status}`);

// Web derlemesi imzalı PUT'a tarayıcıdan gönderir; CORS ön kontrolü geçmeli.
const preflight = await fetch(putUrl, {
  method: 'OPTIONS',
  headers: {
    Origin: 'http://localhost:8081',
    'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'content-type',
  },
}).catch(() => null);
if (preflight) {
  const allowOrigin = preflight.headers.get('access-control-allow-origin') ?? '-';
  console.log(`CORS preflight ${preflight.status} allow-origin=${allowOrigin}`);
  if (!preflight.ok || allowOrigin === '-') {
    console.log('UYARI: bucket CORS kuralı yok; web yüklemesi başarısız olur (npm run r2:cors).');
  }
}

// Uygulamanın gösterdiği adres: public taban + nesne anahtarı (kova adı URL'de yok).
const publicBase = (env.EXPO_PUBLIC_R2_PUBLIC_URL || '').replace(/\/+$/, '');
if (!publicBase) {
  console.error('UYARI: EXPO_PUBLIC_R2_PUBLIC_URL yok; public okuma testi atlandı.');
} else {
  const publicTarget = `${publicBase}/${key}`;
  const publicResponse = await fetch(publicTarget);
  const publicBody = publicResponse.ok ? await publicResponse.text() : '';
  console.log(
    `PUBLIC ${publicResponse.status} ${publicBody === body.toString() ? 'MATCH' : 'no-match'} ${publicTarget}`,
  );
  if (publicBody !== body.toString()) {
    console.error('HATA: public adres yüklenen nesneyi döndürmedi. Public access açık mı?');
    await cleanup();
    process.exit(1);
  }
}

const getUrl = await sign('get');
if (getUrl) {
  const get = await fetch(getUrl);
  const text = get.ok ? await get.text() : '';
  console.log(`GET ${get.status} ${text === body.toString() ? 'MATCH' : 'no-match'}`);
}

const deleteUrl = await sign('delete');
if (deleteUrl) {
  const del = await fetch(deleteUrl, { method: 'DELETE' });
  console.log(`DELETE ${del.status}`);
}

// Sahiplik kontrolü: başka kullanıcının klasörüne imza verilmemeli.
const forbidden = await fetch(`${supabaseUrl}/functions/v1/r2-sign`, {
  method: 'POST',
  headers: {
    apikey: publishableKey,
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ action: 'put', key: `posts/${randomUUID()}/r2/x.jpg` }),
});
console.log(`Sahiplik reddi ${forbidden.status} ${(await forbidden.json().catch(() => ({}))).error ?? ''}`);

// Uzantı kontrolü: medya olmayan uzantı reddedilmeli.
const badExt = await fetch(`${supabaseUrl}/functions/v1/r2-sign`, {
  method: 'POST',
  headers: {
    apikey: publishableKey,
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ action: 'put', key: `posts/${uid}/r2/x.exe` }),
});
console.log(`Uzantı reddi ${badExt.status} ${(await badExt.json().catch(() => ({}))).error ?? ''}`);

await cleanup();
