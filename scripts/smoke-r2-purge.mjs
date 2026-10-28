// r2-purge uçtan uca testi.
//
//   node scripts/smoke-r2-purge.mjs
//
// Geçici bir kullanıcı açar, public kovaya üç nesne yükler (avatar, kapak,
// gönderi), ardından `r2-purge` ile hesap silme öncesi medya temizliğini
// çalıştırır ve dosyaların gerçekten kaldırıldığını doğrular.
//
// Ayrıca yetki sınırını dener: başka bir kullanıcının klasörünü temizlemek
// `privacy.request.manage` yetkisi olmadan reddedilmelidir.
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
const publicBase = (env.EXPO_PUBLIC_R2_PUBLIC_URL || '').replace(/\/+$/, '');

if (!supabaseUrl || !publishableKey || !serviceKey) {
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

const stamp = Date.now().toString(36);
const email = `r2purge.${stamp}@trabzone.test`;
const password = `Purge!${randomUUID().slice(0, 12)}`;

const created = [];
const createdUsers = [];

const createUser = async (label) => {
  const response = await admin('users', {
    method: 'POST',
    body: JSON.stringify({ email: `${label}.${email}`, password, email_confirm: true }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`kullanıcı oluşturulamadı (${label}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  createdUsers.push({ label, id: body.id, email: `${label}.${email}` });
  created.push(body.id);
  return body.id;
};

const signIn = async (address) => {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: address, password }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(`giriş başarısız: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.access_token;
};

const invoke = async (name, token, payload = {}) => {
  const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
};

const rpc = async (token, fn, args = {}) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, data };
};

const signPut = async (token, key, contentType = 'image/jpeg') => {
  const signed = await invoke('r2-sign', token, { action: 'put', key, contentType });
  return signed.ok ? signed.data?.url ?? null : null;
};

const cleanup = async () => {
  for (const id of created) {
    await admin(`users/${id}`, { method: 'DELETE' }).catch(() => null);
  }
};

const main = async () => {
  const ownerId = await createUser('owner');
  const strangerId = await createUser('stranger');
  const ownerToken = await signIn(`owner.${email}`);
  const strangerToken = await signIn(`stranger.${email}`);

  const uploads = [
    { key: `avatars/${ownerId}/r2/purge-avatar-${stamp}.jpg`, contentType: 'image/jpeg' },
    { key: `covers/${ownerId}/r2/purge-cover-${stamp}.jpg`, contentType: 'image/jpeg' },
    { key: `posts/${ownerId}/r2/purge-post-${stamp}.jpg`, contentType: 'image/jpeg' },
  ];

  for (const item of uploads) {
    const url = await signPut(ownerToken, item.key, item.contentType);
    if (!url) {
      check(`imzalı PUT alındı (${item.key.split('/')[0]})`, false);
      return;
    }
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': item.contentType },
      body: Buffer.from(`purge-test-${stamp}`),
    });
    check(`nesne yüklendi (${item.key.split('/')[0]})`, put.ok, `HTTP ${put.status}`);
  }

  if (publicBase) {
    const before = await fetch(`${publicBase}/${uploads[0].key}`);
    check('yükleme sonrası public adres erişilebilir', before.ok, `HTTP ${before.status}`);
  } else {
    console.log('NOT   EXPO_PUBLIC_R2_PUBLIC_URL yok; public okuma kontrolü atlandı.');
  }

  // Gizli sohbet medyası: kullanıcının kendi yüklediği dosya da temizlenmeli.
  const conversation = await rpc(ownerToken, 'chat_start_direct', { p_user_id: strangerId });
  const conversationId = conversation.data?.id;
  check('gizli sohbet açıldı', Boolean(conversationId), `HTTP ${conversation.status}`);

  let privateKey = null;
  if (conversationId) {
    const privatePath = `${conversationId}/r2/${ownerId}-image-${stamp}.jpg`;
    privateKey = `message-media/${privatePath}`;
    const url = await signPut(ownerToken, privateKey, 'image/jpeg');
    if (url) {
      const put = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: Buffer.from(`private-${stamp}`),
      });
      check('sohbet medyası yüklendi', put.ok, `HTTP ${put.status}`);
      const sent = await rpc(ownerToken, 'chat_send_message', {
        p_conversation_id: conversationId,
        p_kind: 'image',
        p_media_path: privatePath,
      });
      check('sohbet mesajı kaydedildi', sent.ok, `HTTP ${sent.status}`);
    } else {
      check('sohbet medyası için imza alındı', false);
    }
  }

  // Envanteri yalnızca sahibi veya yetkili personel okuyabilir.
  const inventoryAsOwner = await rpc(ownerToken, 'account_deletion_media_inventory');
  check(
    'sahip kendi envanterini okuyabilir',
    inventoryAsOwner.ok && inventoryAsOwner.data?.user_id === ownerId,
    `HTTP ${inventoryAsOwner.status}`,
  );
  if (privateKey) {
    check(
      'envanter gizli sohbet anahtarını listeler',
      (inventoryAsOwner.data?.private_keys ?? []).includes(privateKey),
      JSON.stringify(inventoryAsOwner.data?.counts ?? null),
    );
  }
  const inventoryAsStranger = await rpc(strangerToken, 'account_deletion_media_inventory', {
    p_user_id: ownerId,
  });
  check(
    'başka kullanıcının envanteri okunamaz',
    !inventoryAsStranger.ok,
    `HTTP ${inventoryAsStranger.status}`,
  );

  // Başka kullanıcının klasörünü temizleme denemesi reddedilmeli.
  const crossPurge = await invoke('r2-purge', strangerToken, { targetUserId: ownerId });
  check(
    'başka kullanıcının medyası temizlenemez',
    crossPurge.status === 403,
    `HTTP ${crossPurge.status} ${JSON.stringify(crossPurge.data).slice(0, 120)}`,
  );

  const purge = await invoke('r2-purge', ownerToken, {});
  check(
    'kullanıcı kendi medyasını temizleyebilir',
    purge.ok && purge.data?.ok === true,
    `HTTP ${purge.status} ${JSON.stringify(purge.data).slice(0, 160)}`,
  );
  check(
    'silinen nesne sayısı yüklemelerle uyumlu',
    Number(purge.data?.removed ?? 0) >= uploads.length + (privateKey ? 1 : 0),
    `removed=${purge.data?.removed ?? 0}`,
  );
  check('temizlik doğrulandı (done)', purge.data?.done === true, `pending=${purge.data?.pending}`);

  if (privateKey) {
    const signed = await invoke('r2-sign', ownerToken, { action: 'get', key: privateKey });
    if (signed.data?.url) {
      const gone = await fetch(signed.data.url);
      check('gizli sohbet medyası R2’den silindi', gone.status === 404, `HTTP ${gone.status}`);
    } else {
      check('gizli sohbet medyası R2’den silindi', false, `imza alınamadı: ${signed.status}`);
    }
  }

  if (publicBase) {
    for (const item of uploads) {
      // CDN kopyası TTL boyunca görünmeye devam edebilir; nesnenin R2'den
      // gerçekten kalktığını doğrulamak için önbellek atlanır.
      const after = await fetch(`${publicBase}/${item.key}?purge-check=${Date.now()}`);
      check(
        `public adres artık yok (${item.key.split('/')[0]})`,
        after.status === 404,
        `HTTP ${after.status}`,
      );
    }
  }

  // İkinci çağrı boş olmalı: işlem gerçekten tamamlanmış olmalı.
  const second = await invoke('r2-purge', ownerToken, {});
  check(
    'tekrar çağrıda silinecek nesne kalmaz',
    second.ok && Number(second.data?.removed ?? 0) === 0 && second.data?.done === true,
    `removed=${second.data?.removed} pending=${second.data?.pending}`,
  );

  // Yetkisiz çağrı reddedilmeli.
  const anonymous = await fetch(`${supabaseUrl}/functions/v1/r2-purge`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  check('oturumsuz çağrı reddedilir', anonymous.status === 401, `HTTP ${anonymous.status}`);

  console.log(`\nGeçici kullanıcılar: ${createdUsers.map((user) => `${user.label}=${user.id}`).join(', ')}`);
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
