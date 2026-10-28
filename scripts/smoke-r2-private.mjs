// Gizli sohbet medyasının R2 private bucket akışını uçtan uca doğrular.
//
//   node scripts/smoke-r2-private.mjs
//
// Senaryo:
//   1. Üç geçici kullanıcı oluşturulur (alice, bob, carol).
//   2. alice ile bob arasında doğrudan sohbet açılır.
//   3. alice `message-media` anahtarı için imzalı PUT alır ve nesneyi yükler.
//   4. bob (konuşma üyesi) imzalı GET alır ve içeriği okuyabilir.
//   5. carol (üye değil) ne GET ne PUT imzası alabilir.
//   6. Public kovada (posts) yükleme akışının bozulmadığı doğrulanır.
//   7. Nesneler ve geçici kullanıcılar silinir.
//
// Gerekli: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (.env veya ortam).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const accessToken = (process.env.SUPABASE_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN ?? '').trim();
const projectRef = (process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF ?? '').trim();
if (!accessToken || !projectRef) {
  console.error('SUPABASE_ACCESS_TOKEN ve SUPABASE_PROJECT_REF gerekli.');
  process.exit(2);
}

const projectUrl = `https://${projectRef}.supabase.co`;

let failures = 0;
let total = 0;
const check = (name, condition, detail) => {
  total += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Yönetim API'sinden istemci anahtarlarını okur. */
async function readApiKeys() {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`api-keys okunamadi (HTTP ${response.status})`);
  }
  const keys = await response.json();
  const anon = keys.find((key) => key.type === 'publishable' || key.name === 'anon')?.api_key;
  const service = keys.find((key) => key.type === 'secret' || key.name === 'service_role')?.api_key;
  if (!anon || !service) {
    throw new Error('anon/service_role anahtari bulunamadi.');
  }
  return { anon, service };
}

const { anon, service } = await readApiKeys();

const request = async (path, { method = 'GET', token, body, key = anon, headers = {} } = {}) => {
  const response = await fetch(`${projectUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
      ...headers,
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

/** r2-sign edge function çağrısı. */
const sign = (token, body) =>
  request('/functions/v1/r2-sign', { method: 'POST', token, body });

const stamp = Date.now().toString(36);
const accounts = {
  alice: { email: `r2.alice.${stamp}@example.com`, password: `Al!ce-${stamp}-Pass9` },
  bob: { email: `r2.bob.${stamp}@example.com`, password: `B0b-${stamp}-Pass99` },
  carol: { email: `r2.carol.${stamp}@example.com`, password: `C@rol-${stamp}-Pass9` },
};

const created = [];
const tokens = {};
const ids = {};

async function createUser(label) {
  const account = accounts[label];
  const createdUser = await request('/auth/v1/admin/users', {
    method: 'POST',
    token: service,
    key: service,
    body: { email: account.email, password: account.password, email_confirm: true },
  });
  if (createdUser.status >= 300) {
    throw new Error(`admin create ${label}: ${JSON.stringify(createdUser.data)}`);
  }
  created.push(createdUser.data.id);
  ids[label] = createdUser.data.id;

  const signIn = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  if (!signIn.ok) {
    throw new Error(`sign in ${label}: ${JSON.stringify(signIn.data)}`);
  }
  tokens[label] = signIn.data.access_token;

  const profile = await rpc(tokens[label], 'complete_registration', {
    p_username: `${label}r2${stamp}`.slice(0, 20),
    p_first_name: label,
    p_last_name: 'R2',
  });
  if (!profile.ok) {
    throw new Error(`complete_registration ${label}: ${JSON.stringify(profile.data)}`);
  }
}

const cleanupKeys = [];

async function cleanup() {
  for (const key of cleanupKeys) {
    const signed = await sign(tokens.alice, { action: 'delete', key }).catch(() => null);
    const url = signed?.data?.url;
    if (url) {
      await fetch(url, { method: 'DELETE' }).catch(() => undefined);
    }
  }
  for (const id of created) {
    await request(`/auth/v1/admin/users/${id}`, { method: 'DELETE', token: service, key: service }).catch(
      () => undefined,
    );
  }
}

try {
  console.log(`Proje: ${projectRef}`);
  for (const label of Object.keys(accounts)) {
    await createUser(label);
  }
  check('gecici hesaplar olusturuldu', created.length === 3);

  const conversation = await rpc(tokens.alice, 'chat_start_direct', { p_user_id: ids.bob });
  const conversationId = conversation.data?.id ?? conversation.data?.conversation?.id;
  check('dogrudan sohbet acildi', Boolean(conversationId), conversationId ?? JSON.stringify(conversation.data));

  const chatKey = `message-media/${conversationId}/r2/${ids.alice}-video-smoke.mp4`;
  cleanupKeys.push(chatKey);
  const body = `trabzone private smoke ${stamp}`;

  const putSign = await sign(tokens.alice, {
    action: 'put',
    key: chatKey,
    contentType: 'video/mp4',
  });
  check('uye imzali PUT aldi', putSign.ok && Boolean(putSign.data?.url), `HTTP ${putSign.status}`);

  if (putSign.data?.url) {
    const put = await fetch(putSign.data.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body,
    });
    check('private bucket yuklemesi basarili', put.ok, `HTTP ${put.status}`);
  }

  const bobGet = await sign(tokens.bob, { action: 'get', keys: [chatKey] });
  const bobUrl = bobGet.data?.urls?.[chatKey];
  check('diger uye imzali GET aldi', bobGet.ok && Boolean(bobUrl), `HTTP ${bobGet.status}`);
  if (bobUrl) {
    const read = await fetch(bobUrl);
    const text = read.ok ? await read.text() : '';
    check('uye nesneyi okuyabildi', read.ok && text === body, `HTTP ${read.status}`);
  }

  const carolGet = await sign(tokens.carol, { action: 'get', keys: [chatKey] });
  const carolUrl = carolGet.data?.urls?.[chatKey];
  check('uye olmayan GET imzasi alamadi', carolGet.ok && !carolUrl, `HTTP ${carolGet.status}`);

  const carolPut = await sign(tokens.carol, {
    action: 'put',
    key: chatKey,
    contentType: 'video/mp4',
  });
  check('uye olmayan PUT imzasi alamadi', carolPut.status === 403, `HTTP ${carolPut.status}`);

  // Public kova akışı bozulmadı mı?
  const publicKey = `posts/${ids.alice}/r2/video-smoke-${stamp}.mp4`;
  cleanupKeys.push(publicKey);
  const publicPut = await sign(tokens.alice, {
    action: 'put',
    key: publicKey,
    contentType: 'video/mp4',
  });
  check('public kova imzali PUT aldi', publicPut.ok && Boolean(publicPut.data?.url), `HTTP ${publicPut.status}`);
  if (publicPut.data?.url) {
    const put = await fetch(publicPut.data.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: `${body}-public`,
    });
    check('public kova yuklemesi basarili', put.ok, `HTTP ${put.status}`);
  }

  const foreignKey = `posts/${ids.bob}/r2/video-smoke-${stamp}.mp4`;
  const foreignPut = await sign(tokens.alice, {
    action: 'put',
    key: foreignKey,
    contentType: 'video/mp4',
  });
  check('baska kullanicinin public anahtari reddedildi', foreignPut.status === 403, `HTTP ${foreignPut.status}`);
} finally {
  await cleanup();
  console.log('\nGecici nesneler ve hesaplar temizlendi.');
}

console.log(`\n${total - failures}/${total} kontrol gecti.`);
process.exit(failures === 0 ? 0 : 1);
