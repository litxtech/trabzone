// LiveKit bağlantı kontrolü: geçici iki kullanıcı oluşturur, gerçek bir
// `call_sessions` kaydı açar, `livekit-token` edge function'ından anahtar alır
// ve anahtarı LiveKit API secret'ıyla doğrular. Sonunda hesapları siler.
//
// Kullanım: node scripts/livekit-check.mjs
// Gereken: .env içinde SUPABASE_SERVICE_ROLE_KEY + LIVEKIT_* değerleri.

import { readFileSync } from 'node:fs';
import { randomUUID, createHmac } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const supabaseUrl = (env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const livekitUrl = env.LIVEKIT_URL ?? env.EXPO_PUBLIC_LIVEKIT_URL;
const livekitKey = env.LIVEKIT_API_KEY;
const livekitSecret = env.LIVEKIT_API_SECRET;

const missing = Object.entries({
  EXPO_PUBLIC_SUPABASE_URL: supabaseUrl,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  LIVEKIT_URL: livekitUrl,
  LIVEKIT_API_KEY: livekitKey,
  LIVEKIT_API_SECRET: livekitSecret,
}).filter(([, value]) => !value);

if (missing.length > 0) {
  console.error(`Eksik ortam değişkeni: ${missing.map(([name]) => name).join(', ')}`);
  process.exit(2);
}

let failures = 0;
const check = (name, condition, detail) => {
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const request = async (path, { method = 'GET', token, body, key = publishableKey } = {}) => {
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data };
};

const rpc = (token, fn, args = {}) =>
  request(`/rest/v1/rpc/${fn}`, { method: 'POST', token, body: args });

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** LiveKit sunucu API'si için HS256 JWT (yalnızca test doğrulaması). */
const signServerToken = (grants) => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: livekitKey,
      sub: 'livekit-check',
      nbf: now - 10,
      exp: now + 600,
      jti: randomUUID(),
      video: grants,
    }),
  );
  const signature = createHmac('sha256', livekitSecret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${payload}.${signature}`;
};

/** Dönen anahtarın imzasını doğrular; geçerliyse claim'leri döndürür. */
const verifyToken = (token) => {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = createHmac('sha256', livekitSecret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (expected !== signature) return null;
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
};

const stamp = Date.now().toString(36);
const created = [];
const accounts = {};

const createUser = async (label) => {
  const email = `livekit.${label}.${stamp}@trabzone.test`;
  const password = `Lk!${stamp}-${label}-Aa9`;
  const admin = await request('/auth/v1/admin/users', {
    method: 'POST',
    token: serviceKey,
    key: serviceKey,
    body: { email, password, email_confirm: true },
  });
  if (!admin.ok) {
    throw new Error(`kullanıcı oluşturulamadı (${label}): ${JSON.stringify(admin.data)}`);
  }
  created.push(admin.data.id);

  const signIn = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  if (!signIn.ok || !signIn.data?.access_token) {
    throw new Error(`giriş başarısız (${label}): ${JSON.stringify(signIn.data)}`);
  }

  const profile = await rpc(signIn.data.access_token, 'complete_registration', {
    p_username: `lk${label}${stamp}`.slice(0, 20),
    p_first_name: label === 'alice' ? 'Aylin' : 'Baran',
    p_last_name: 'Test',
  });
  if (!profile.ok) {
    throw new Error(`profil tamamlanamadı (${label}): ${JSON.stringify(profile.data)}`);
  }

  accounts[label] = { id: admin.data.id, token: signIn.data.access_token };
};

const tokenRequest = (token, callId) =>
  request('/functions/v1/livekit-token', {
    method: 'POST',
    token: token ?? undefined,
    body: { call_id: callId },
  });

let success = false;
try {
  await createUser('alice');
  await createUser('bob');

  const conversation = await rpc(accounts.alice.token, 'chat_start_direct', {
    p_user_id: accounts.bob.id,
  });
  check('sohbet açıldı', conversation.ok, JSON.stringify(conversation.data).slice(0, 160));
  const conversationId = conversation.data.id;

  const call = await rpc(accounts.alice.token, 'call_start', {
    p_conversation_id: conversationId,
    p_kind: 'video',
  });
  check('arama kaydı açıldı', call.ok && call.data.status === 'ringing');
  const callId = call.data.id;
  const roomName = call.data.room_name;

  // --- Yetkisiz erişim -----------------------------------------------------
  const anonymous = await tokenRequest(undefined, callId);
  check('oturumsuz istek reddedildi', anonymous.status === 401, `HTTP ${anonymous.status}`);

  const unknownCall = await tokenRequest(accounts.bob.token, randomUUID());
  check('bilinmeyen arama reddedildi', unknownCall.status === 403, `HTTP ${unknownCall.status}`);

  // --- Arayan ve aranan anahtar alabilir -----------------------------------
  const callerToken = await tokenRequest(accounts.alice.token, callId);
  check('arayan anahtar aldı', callerToken.ok, `HTTP ${callerToken.status}`);
  const callerClaims = verifyToken(callerToken.data?.token);
  check('arayan anahtarı geçerli imzalı', Boolean(callerClaims));
  check('anahtar doğru odaya ait', callerClaims?.video?.room === roomName, roomName);
  check('arayan kimliği doğru', callerClaims?.sub === accounts.alice.id);
  check('oda katılımı + yayın izni var', callerClaims?.video?.roomJoin === true && callerClaims?.video?.canPublish === true);
  check('yanıt LiveKit adresini taşıyor', callerToken.data?.url === livekitUrl);

  const accepted = await rpc(accounts.bob.token, 'call_respond', {
    p_call_id: callId,
    p_accept: true,
  });
  check('arayan kabul edildi', accepted.ok && accepted.data.status === 'accepted');

  const calleeToken = await tokenRequest(accounts.bob.token, callId);
  check('aranan anahtar aldı', calleeToken.ok, `HTTP ${calleeToken.status}`);
  const calleeClaims = verifyToken(calleeToken.data?.token);
  check('aranan kimliği doğru', calleeClaims?.sub === accounts.bob.id);

  // --- Biten aramada anahtar verilmez --------------------------------------
  await rpc(accounts.alice.token, 'call_end', { p_call_id: callId });
  const afterEnd = await tokenRequest(accounts.alice.token, callId);
  check('biten arama için anahtar verilmiyor', afterEnd.status === 409, `HTTP ${afterEnd.status}`);

  // --- LiveKit Cloud gerçekten erişilebilir mi? ----------------------------
  const serverToken = signServerToken({ roomList: true, roomAdmin: true });
  const listRooms = await fetch(`${livekitUrl.replace(/^wss:/, 'https:')}/twirp/livekit.RoomService/ListRooms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serverToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const roomsText = await listRooms.text();
  check(
    'LiveKit Cloud API anahtarı kabul etti',
    listRooms.ok,
    `HTTP ${listRooms.status} ${roomsText.slice(0, 120)}`,
  );

  success = failures === 0;
} catch (error) {
  console.error('LIVEKIT CHECK ERROR:', error instanceof Error ? error.message : error);
} finally {
  for (const id of created) {
    await request(`/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      token: serviceKey,
      key: serviceKey,
    });
  }
  console.log(`Geçici hesaplar silindi: ${created.length}`);
  console.log(success ? 'LiveKit bağlantısı hazır.' : `Başarısız kontrol sayısı: ${failures}`);
}

process.exit(success ? 0 : 1);
