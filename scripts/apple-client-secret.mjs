#!/usr/bin/env node
/**
 * Sign in with Apple istemci sirrini (client secret) uretir.
 *
 * Apple, web OAuth akisi icin istemci sirrini kabul etmez: sir olarak kendi
 * .p8 anahtarinla imzalanmis, en fazla 6 ay gecerli bir ES256 JWT beklenir.
 * Bu yuzden sir periyodik olarak yenilenmelidir; suresi gectiginde Apple web
 * girisi "invalid_client" ile reddedilir (iOS native akis etkilenmez).
 *
 * Kullanim:
 *   node scripts/apple-client-secret.mjs                      # sirri yazdirir
 *   node scripts/apple-client-secret.mjs --push               # Supabase'e yazar
 *   node scripts/apple-client-secret.mjs --days 120           # daha kisa omur
 *
 * Gerekli ortam degiskenleri (yerelde .env, CI'da secrets):
 *   APPLE_TEAM_ID      Apple Developer Team ID (10 karakter)
 *   APPLE_KEY_ID       "Sign in with Apple" anahtarinin Key ID'si
 *   APPLE_PRIVATE_KEY  AuthKey_XXXX.p8 icerigi (\n kacisli olabilir)
 *   APPLE_CLIENT_ID    Services ID (web akisi icin `sub` degeri)
 *   SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF  (yalnizca --push icin)
 */
import { createSign, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX_DAYS = 180; // Apple ust siniri ~15777000 saniye (6 ay)
const DEFAULT_DAYS = 170; // jeton saati kaymalarina karsi kucuk pay

function env(name) {
  return (process.env[name] ?? '').trim();
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadDotEnv() {
  let raw;
  try {
    raw = readFileSync('.env', 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function resolvePrivateKey() {
  const inline = env('APPLE_PRIVATE_KEY');
  if (inline) {
    return inline.replace(/\\n/g, '\n');
  }
  const path = argValue('--key-file') ?? env('APPLE_KEY_FILE');
  if (!path) {
    throw new Error('APPLE_PRIVATE_KEY veya --key-file tanimli degil.');
  }
  return readFileSync(path, 'utf8');
}

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function buildClientSecret({ teamId, keyId, clientId, privateKey, days }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + days * 24 * 60 * 60;
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: teamId,
      iat: issuedAt,
      exp: expiresAt,
      aud: 'https://appleid.apple.com',
      sub: clientId,
      jti: randomUUID(),
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign('SHA256').update(signingInput).sign({
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return {
    secret: `${signingInput}.${base64url(signature)}`,
    expiresAt: new Date(expiresAt * 1000),
  };
}

/**
 * Apple'da istemci kimlik dogrulamasini gercekten sinar.
 *
 * ONEMLI: `authorization_code` grant'inda Apple once `code` degerini kontrol
 * eder; sahte bir kod her zaman `invalid_grant` doner. Bu yuzden gecersiz bir
 * sir bile "OK" gibi gorunur (yanlis pozitif). Dogru arac `client_credentials`
 * grant'idir: Apple orada istemciyi ilk kontrol eder ve sir gecersizse
 * `invalid_client`, gecerliyse `invalid_scope` doner (bu grant Apple'da
 * desteklenmedigi icin scope hatasi beklenen sonuctur).
 */
async function verifyWithApple(clientId, secret) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    grant_type: 'client_credentials',
  });
  const response = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  let error = '';
  try {
    error = JSON.parse(text).error ?? '';
  } catch {
    error = text.slice(0, 60);
  }
  // invalid_client -> imza/kid/team/client eslesmiyor; digerleri -> kimlik onaylandi.
  return { ok: error !== 'invalid_client', detail: `${error || 'ok'} (${response.status})` };
}

async function pushToSupabase(clientId, secret, projectRef, accessToken) {
  // `external_apple_client_id` virgülle ayrılmış bir listedir. Services ID ilk
  // sırada olmalı (web akışı ilk kimliği kullanır); iOS native kimlik
  // anahtarının `aud` değeri de listede kalmalı, aksi halde native giriş kırılır.
  const clientIds = env('APPLE_CLIENT_IDS') || clientId;
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      external_apple_enabled: true,
      external_apple_client_id: clientIds,
      external_apple_secret: secret,
    }),
  });
  if (!response.ok) {
    throw new Error(`Supabase guncellenemedi (${response.status}): ${await response.text()}`);
  }
}

async function main() {
  loadDotEnv();

  const teamId = env('APPLE_TEAM_ID');
  const keyId = env('APPLE_KEY_ID');
  const clientId = argValue('--client-id') ?? env('APPLE_CLIENT_ID');
  if (!teamId || !keyId || !clientId) {
    throw new Error('APPLE_TEAM_ID, APPLE_KEY_ID ve APPLE_CLIENT_ID gerekli.');
  }

  const days = Math.min(Number(argValue('--days') ?? DEFAULT_DAYS) || DEFAULT_DAYS, MAX_DAYS);
  const { secret, expiresAt } = buildClientSecret({
    teamId,
    keyId,
    clientId,
    privateKey: resolvePrivateKey(),
    days,
  });

  const check = await verifyWithApple(clientId, secret);
  console.log(`Apple dogrulama: ${check.ok ? 'OK' : 'BASARISIZ'} - ${check.detail}`);
  console.log(`Gecerlilik bitisi: ${expiresAt.toISOString()}`);
  console.log(secret);

  if (process.argv.includes('--push')) {
    const accessToken = env('SUPABASE_ACCESS_TOKEN');
    const projectRef = env('SUPABASE_PROJECT_REF');
    if (!accessToken || !projectRef) {
      throw new Error('--push icin SUPABASE_ACCESS_TOKEN ve SUPABASE_PROJECT_REF gerekli.');
    }
    await pushToSupabase(clientId, secret, projectRef, accessToken);
    console.log('Supabase Apple saglayicisi guncellendi.');
  }
}

main().catch((error) => {
  console.error(`Hata: ${error.message}`);
  process.exitCode = 1;
});
