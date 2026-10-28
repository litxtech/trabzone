// Yönetici (web) hesap silme akışı uçtan uca testi.
//
//   node scripts/smoke-deletion-admin.mjs
//
// Giriş yapamayan kullanıcıların web talebinin gerçekten silindiğini doğrular:
//   1. Hedef hesap + R2 avatarı oluşturulur, web talebi açılır
//   2. Yetkisiz yönetici reddedilir, kimlik doğrulanmamış talep silinemez
//   3. Yönetici medyayı r2-purge ile temizler, ardından talebi uygular
//   4. Profil, auth hesabı, medya ve talebin kapandığı kontrol edilir
//
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

const supabaseUrl = (env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const managementToken = env.SUPABASE_ACCESS_TOKEN;
const projectRef = env.SUPABASE_PROJECT_REF;
const publicBase = (env.EXPO_PUBLIC_R2_PUBLIC_URL || '').replace(/\/+$/, '');

if (!supabaseUrl || !publishableKey || !serviceKey || !managementToken || !projectRef) {
  console.error('Eksik Supabase ortam değişkeni (.env).');
  process.exit(2);
}

let total = 0;
let failures = 0;
const check = (name, condition, detail) => {
  total += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const runSql = async (query) => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(`sql failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
};

const call = async (path, { method = 'GET', token, body, key = publishableKey } = {}) => {
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
  return { status: response.status, ok: response.ok, data, text };
};

const rpc = (token, fn, args = {}, key = publishableKey) =>
  call(`/rest/v1/rpc/${fn}`, { method: 'POST', token, body: args, key });

const invoke = (name, token, payload = {}) =>
  call(`/functions/v1/${name}`, { method: 'POST', token, body: payload });

const password = `Del!${randomUUID().slice(0, 12)}`;
const stamp = Date.now().toString(36);
const accounts = {
  target: `admin.deletion.target.${stamp}@trabzone.test`,
  admin: `admin.deletion.admin.${stamp}@trabzone.test`,
};

const created = [];
const ids = {};

const createUser = async (label) => {
  const response = await call('/auth/v1/admin/users', {
    method: 'POST',
    token: serviceKey,
    key: serviceKey,
    body: { email: accounts[label], password, email_confirm: true },
  });
  if (!response.ok) {
    throw new Error(`kullanıcı oluşturulamadı (${label}): ${response.text.slice(0, 200)}`);
  }
  ids[label] = response.data.id;
  created.push(response.data.id);
  return response.data.id;
};

const signIn = async (address) => {
  const response = await call('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: address, password },
  });
  if (!response.ok || !response.data?.access_token) {
    throw new Error(`giriş başarısız: ${response.text.slice(0, 200)}`);
  }
  return response.data.access_token;
};

const cleanup = async () => {
  for (const id of created) {
    await call(`/auth/v1/admin/users/${id}`, { method: 'DELETE', token: serviceKey, key: serviceKey })
      .catch(() => null);
  }
};

const main = async () => {
  await createUser('target');
  await createUser('admin');
  const targetToken = await signIn(accounts.target);
  const adminToken = await signIn(accounts.admin);

  const profile = await runSql(`select username from public.profiles where id = '${ids.target}';`);
  const username = profile[0]?.username;
  check('hedef hesabın profili var', Boolean(username), username ?? 'yok');

  // R2 avatarı: silinmesi gereken gerçek bir dosya.
  const avatarKey = `avatars/${ids.target}/r2/admin-delete-${stamp}.jpg`;
  const signed = await invoke('r2-sign', targetToken, {
    action: 'put',
    key: avatarKey,
    contentType: 'image/jpeg',
  });
  check('imzalı PUT alındı', Boolean(signed.data?.url), `HTTP ${signed.status}`);
  if (signed.data?.url) {
    const put = await fetch(signed.data.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: Buffer.from(`admin-delete-${stamp}`),
    });
    check('avatar R2’ye yüklendi', put.ok, `HTTP ${put.status}`);
    await runSql(
      `update public.profiles set avatar_path = '${ids.target}/r2/admin-delete-${stamp}.jpg' where id = '${ids.target}';`,
    );
  }

  // Giriş yapamayan kullanıcının web talebi.
  const request = await rpc(publishableKey, 'deletion_request_create', {
    p_email: accounts.target,
    p_reason: 'Yönetici akışı testi',
    p_source: 'web',
  });
  check('web silme talebi oluşturuldu', request.ok, `HTTP ${request.status}`);
  const reference = request.data?.request_no;

  // Yetkisiz kullanıcı talebi uygulayamaz.
  const requestId = (
    await runSql(
      `select id from public.account_deletion_requests where reference_code = '${reference}';`,
    )
  )[0]?.id;
  const forbidden = await rpc(adminToken, 'admin_deletion_request_execute', { p_id: requestId });
  check(
    'yetkisiz kullanıcı silme talebini uygulayamaz',
    !forbidden.ok && forbidden.text.includes('forbidden'),
    `HTTP ${forbidden.status}`,
  );

  // Yönetici yetkisi verilir.
  await runSql(
    `insert into public.user_role_assignments (user_id, role_key)
     values ('${ids.admin}', 'super_admin')
     on conflict (user_id, role_key) do nothing;`,
  );

  const queue = await rpc(adminToken, 'admin_deletion_requests', { p_limit: 200 });
  const row = (queue.data ?? []).find((item) => item.request_no === reference);
  check('talep yönetici kuyruğunda görünüyor', Boolean(row), `HTTP ${queue.status}`);
  check('talep hedef kullanıcıyla eşleşiyor', row?.user_id === ids.target, row?.user_id ?? 'yok');
  check('eşleşen hesap bilgisi dönüyor', row?.account_found === true);

  // Kimlik doğrulanmadan silinemez.
  const notVerified = await rpc(adminToken, 'admin_deletion_request_execute', { p_id: requestId });
  check(
    'kimlik doğrulanmadan hesap silinmez',
    !notVerified.ok && notVerified.text.includes('identity_not_verified'),
    `HTTP ${notVerified.status}`,
  );

  const verified = await rpc(adminToken, 'admin_deletion_request_update', {
    p_id: requestId,
    p_status: 'processing',
    p_note: 'Kimlik doğrulandı (test).',
    p_verify_identity: true,
  });
  check('kimlik doğrulaması kaydedildi', verified.ok, `HTTP ${verified.status}`);

  // Yönetici hedefin medyasını temizler.
  const purge = await invoke('r2-purge', adminToken, { targetUserId: ids.target });
  check(
    'yönetici hedefin medyasını temizleyebilir',
    purge.ok && purge.data?.done === true,
    `HTTP ${purge.status} ${JSON.stringify(purge.data).slice(0, 160)}`,
  );
  check(
    'avatar silindi',
    Number(purge.data?.removed ?? 0) >= 1,
    `removed=${purge.data?.removed ?? 0}`,
  );

  if (publicBase) {
    const after = await fetch(`${publicBase}/${avatarKey}?admin-check=${Date.now()}`);
    check('avatar public adresi artık yok', after.status === 404, `HTTP ${after.status}`);
  }

  const executed = await rpc(adminToken, 'admin_deletion_request_execute', { p_id: requestId });
  check(
    'yönetici hesabı kalıcı olarak siliyor',
    executed.ok && executed.data?.status === 'completed',
    `HTTP ${executed.status} ${JSON.stringify(executed.data).slice(0, 160)}`,
  );
  check('silme raporu hesabı buldu', executed.data?.account_found === true);

  const profileLeft = await runSql(
    `select count(*)::int as n from public.profiles where id = '${ids.target}';`,
  );
  check('profil silindi', profileLeft[0]?.n === 0);

  const authLeft = await call(`/auth/v1/admin/users/${ids.target}`, {
    token: serviceKey,
    key: serviceKey,
  });
  check('auth hesabı silindi', authLeft.status === 404, `HTTP ${authLeft.status}`);

  const requestRow = await runSql(
    `select status, user_id, completed_at from public.account_deletion_requests where id = '${requestId}';`,
  );
  check('talep tamamlandı olarak kapandı', requestRow[0]?.status === 'completed');
  check('talep kullanıcı bağlantısını bırakmadı', requestRow[0]?.user_id === null);

  const history = await runSql(
    `select count(*)::int as n from public.deletion_request_status_history where request_id = '${requestId}';`,
  );
  check('durum geçmişi yazıldı', (history[0]?.n ?? 0) >= 2, `n=${history[0]?.n}`);

  // Eşleşen hesap yoksa talep yine de kapanır (veri silinmez).
  const orphanRequest = await rpc(publishableKey, 'deletion_request_create', {
    p_email: `olmayan.${stamp}@trabzone.test`,
    p_source: 'web',
  });
  const orphanRef = orphanRequest.data?.request_no;
  const orphanId = (
    await runSql(
      `select id from public.account_deletion_requests where reference_code = '${orphanRef}';`,
    )
  )[0]?.id;
  await rpc(adminToken, 'admin_deletion_request_update', {
    p_id: orphanId,
    p_status: 'processing',
    p_note: 'Kimlik doğrulandı (test).',
    p_verify_identity: true,
  });
  const orphanExecuted = await rpc(adminToken, 'admin_deletion_request_execute', {
    p_id: orphanId,
  });
  check(
    'eşleşen hesap yoksa talep kapatılır',
    orphanExecuted.ok && orphanExecuted.data?.account_found === false,
    `HTTP ${orphanExecuted.status}`,
  );
};

let success = false;
try {
  await main();
  success = failures === 0;
  console.log(`\n${total - failures}/${total} kontrol geçti.`);
} catch (error) {
  console.error('\nTest çöktü:', error);
} finally {
  await cleanup();
}

process.exit(success ? 0 : 1);
