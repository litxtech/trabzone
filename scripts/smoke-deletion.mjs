// End-to-end smoke test for self-service account deletion.
//
//   node scripts/smoke-deletion.mjs
//
// Creates two temporary accounts, seeds real data (post, direct chat, support
// ticket, storage object), then deletes one account through
// `account_delete_self` and verifies the data is gone for good.
// Requires SUPABASE_SERVICE_ROLE_KEY in .env (server-side only).
import { Buffer } from 'node:buffer';
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

const url = env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
const anon = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const managementToken = process.env.SUPABASE_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF;

if (!url || !anon || !service || !managementToken || !projectRef) {
  console.error('Missing Supabase environment variables.');
  process.exit(1);
}

let total = 0;
let failures = 0;

const check = (name, condition, detail) => {
  total += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const request = async (path, { method = 'GET', token, body, key = anon, headers = {} } = {}) => {
  const response = await fetch(`${url}${path}`, {
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
  return { status: response.status, ok: response.ok, data, text };
};

const rpc = (token, fn, args = {}, key = anon) =>
  request(`/rest/v1/rpc/${fn}`, { method: 'POST', token, body: args, key });

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

const stamp = Date.now().toString(36);
const accounts = {
  leaver: { email: `delete.leaver.${stamp}@example.com`, password: `Le@ver-${stamp}-Pass9` },
  friend: { email: `delete.friend.${stamp}@example.com`, password: `Fr!end-${stamp}-Pass9` },
};

const created = [];
const tokens = {};
const refreshTokens = {};
const ids = {};
let username = null;

const createUser = async (label, user) => {
  const { status, data } = await request('/auth/v1/admin/users', {
    method: 'POST',
    token: service,
    key: service,
    body: { email: accounts[label].email, password: accounts[label].password, email_confirm: true },
  });
  if (status >= 300) {
    throw new Error(`admin create ${label} failed: ${JSON.stringify(data)}`);
  }
  created.push(data.id);
  ids[label] = data.id;

  const signIn = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: accounts[label].email, password: accounts[label].password },
  });
  if (!signIn.ok) {
    throw new Error(`sign in ${label} failed: ${JSON.stringify(signIn.data)}`);
  }
  tokens[label] = signIn.data.access_token;
  refreshTokens[label] = signIn.data.refresh_token;
  return user;
};

const cleanup = async () => {
  for (const id of created) {
    // Storage files are removed by the test itself; sweep leftovers with the
    // service role so a failed run never leaves public bucket objects behind.
    for (const bucket of ['avatars', 'covers', 'posts', 'stories', 'listing-images']) {
      await fetch(`${url}/storage/v1/object/${bucket}/${id}/smoke-avatar.jpg`, {
        method: 'DELETE',
        headers: { apikey: service, Authorization: `Bearer ${service}` },
      }).catch(() => null);
    }
    await request(`/auth/v1/admin/users/${id}`, { method: 'DELETE', token: service, key: service });
  }
};

const main = async () => {
  await createUser('leaver');
  await createUser('friend');

  const profile = await runSql(
    `select username from public.profiles where id = '${ids.leaver}';`,
  );
  username = profile[0]?.username;
  check('temporary account has a profile', Boolean(username), username ?? 'missing');

  // Seed real content that must disappear with the account.
  const post = await rpc(tokens.leaver, 'feed_create_post', {
    p_body: 'Hesap silme testi',
    p_visibility: 'public',
    p_city: 'Trabzon',
  });
  check('seeded post created', post.ok && Boolean(post.data?.id), `status ${post.status}`);

  const chat = await rpc(tokens.leaver, 'chat_start_direct', { p_user_id: ids.friend });
  check('seeded conversation created', chat.ok && Boolean(chat.data?.id));
  const conversationId = chat.data?.id;

  const message = conversationId
    ? await rpc(tokens.leaver, 'chat_send_message', {
        p_conversation_id: conversationId,
        p_kind: 'text',
        p_body: 'Gorusuruz',
      })
    : { ok: false };
  check('seeded message sent', message.ok);

  const ticket = await rpc(tokens.leaver, 'safety_create_support_ticket', {
    p_category: 'account_access',
    p_subject: 'Hesap silme testi',
    p_body: 'Bu talep hesap silme testi icin olusturuldu.',
  });
  check('seeded support ticket created', ticket.ok, `status ${ticket.status}`);

  // A real storage object owned by the account.
  const bucket = 'avatars';
  const objectPath = `${ids.leaver}/smoke-avatar.jpg`;
  const uploaded = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${tokens.leaver}`,
      'Content-Type': 'image/jpeg',
    },
    body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });
  check(
    'seeded storage object uploaded',
    uploaded.ok,
    `status ${uploaded.status} ${uploaded.ok ? '' : await uploaded.clone().text()}`,
  );

  const mediaPaths = await rpc(tokens.leaver, 'account_deletion_media_paths');
  check(
    'media paths list the owned object',
    mediaPaths.ok && mediaPaths.data.some((item) => item.path === objectPath),
    JSON.stringify(mediaPaths.data),
  );

  // Preflight: yanlış şifreyle hiçbir şey silinmemeli (medya kaybı olmadan).
  const preflightBad = await rpc(tokens.leaver, 'account_deletion_preflight', {
    p_confirm: username,
    p_password: 'not-the-password',
  });
  check(
    'preflight rejects a wrong password',
    !preflightBad.ok && preflightBad.text.includes('invalid_password'),
    `status ${preflightBad.status}`,
  );

  const mediaStillThere = await runSql(
    `select count(*)::int as n from storage.objects where owner = '${ids.leaver}';`,
  );
  check('failed preflight keeps the media', mediaStillThere[0]?.n === 1);

  const preflight = await rpc(tokens.leaver, 'account_deletion_preflight', {
    p_confirm: username,
    p_password: accounts.leaver.password,
  });
  check(
    'preflight accepts valid credentials',
    preflight.ok && preflight.data?.ok === true,
    `status ${preflight.status}`,
  );
  check(
    'preflight reports the media inventory',
    preflight.ok &&
      Array.isArray(preflight.data?.media?.legacy_storage) &&
      preflight.data.media.legacy_storage.some((item) => item.path === objectPath) &&
      Array.isArray(preflight.data?.media?.private_keys),
    JSON.stringify(preflight.data?.media?.counts ?? null),
  );

  const inventory = await rpc(tokens.leaver, 'account_deletion_media_inventory');
  check(
    'media inventory is readable by the owner',
    inventory.ok && inventory.data?.user_id === ids.leaver,
    `status ${inventory.status}`,
  );

  // Deletion must refuse while public bucket files are still present.
  const blockedByMedia = await rpc(tokens.leaver, 'account_delete_self', {
    p_confirm: username,
    p_password: accounts.leaver.password,
  });
  check(
    'deletion is blocked until media is cleaned',
    !blockedByMedia.ok && blockedByMedia.text.includes('media_cleanup_required'),
    `status ${blockedByMedia.status}`,
  );

  const removed = await request(`/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    token: tokens.leaver,
    body: { prefixes: [objectPath] },
  });
  check('client removes its media via Storage API', removed.ok, `status ${removed.status} ${removed.text}`);

  // Wrong confirmation and wrong password must never delete anything.
  const badConfirm = await rpc(tokens.leaver, 'account_delete_self', {
    p_confirm: 'yanlis-kullanici',
    p_password: accounts.leaver.password,
  });
  check(
    'wrong confirmation is rejected',
    !badConfirm.ok && badConfirm.text.includes('confirm_mismatch'),
    `status ${badConfirm.status}`,
  );

  const badPassword = await rpc(tokens.leaver, 'account_delete_self_v2', {
    p_confirm: username,
    p_password: 'not-the-password',
    p_reason: 'smoke test',
    p_media: null,
  });
  check(
    'wrong password is rejected',
    !badPassword.ok && badPassword.text.includes('invalid_password'),
    `status ${badPassword.status}`,
  );

  const anonymousAttempt = await rpc(anon, 'account_delete_self', {
    p_confirm: username,
    p_password: accounts.leaver.password,
  });
  check('anonymous call cannot delete an account', !anonymousAttempt.ok, `status ${anonymousAttempt.status}`);

  const stillThere = await runSql(
    `select count(*)::int as n from public.profiles where id = '${ids.leaver}';`,
  );
  check('rejected attempts keep the account', stillThere[0]?.n === 1);

  const mediaAfterCleanup = await rpc(tokens.leaver, 'account_deletion_media_paths');
  check(
    'media list is empty after cleanup',
    mediaAfterCleanup.ok && mediaAfterCleanup.data.length === 0,
    JSON.stringify(mediaAfterCleanup.data),
  );

  // Apple oturum jetonu: hesap silinince hem iptal edilmeli hem de kaydı
  // cascade ile kalkmalı (App Store 5.1.1(v)).
  const appleRevoke = await request('/functions/v1/apple-token', {
    method: 'POST',
    token: tokens.leaver,
    body: { action: 'revoke' },
  });
  check(
    'apple revoke function is available to the owner',
    appleRevoke.ok && appleRevoke.data?.skipped === 'no_token',
    appleRevoke.text.slice(0, 160),
  );

  const appleLink = await request('/functions/v1/apple-token', {
    method: 'POST',
    token: tokens.leaver,
    body: { action: 'link', code: 'smoke-invalid-authorization-code' },
  });
  check(
    'apple link does not break sign-in with an invalid code',
    appleLink.status < 500 && appleLink.data?.linked !== true,
    appleLink.text.slice(0, 160),
  );

  await runSql(
    `insert into public.apple_auth_tokens (user_id, refresh_token, client_id)
     values ('${ids.leaver}', 'smoke-apple-refresh-token', 'com.litxtech.trabzone')
     on conflict (user_id) do update set refresh_token = excluded.refresh_token;`,
  );
  const appleTokenSeeded = await runSql(
    `select count(*)::int as n from public.apple_auth_tokens where user_id = '${ids.leaver}';`,
  );
  check('apple token is stored for the account', appleTokenSeeded[0]?.n === 1);

  const appleSelfAllowed = await rpc(tokens.leaver, 'account_deletion_target_allowed', {
    p_user_id: ids.leaver,
  });
  check('apple revoke is allowed for own account', appleSelfAllowed.data === true);

  const appleOtherDenied = await rpc(tokens.friend, 'account_deletion_target_allowed', {
    p_user_id: ids.leaver,
  });
  check('apple revoke is denied for another account', appleOtherDenied.data === false);

  const appleTokenHidden = await request('/rest/v1/apple_auth_tokens?select=user_id', {
    token: tokens.leaver,
  });
  check(
    'apple tokens are not readable with the user session',
    !appleTokenHidden.ok || !Array.isArray(appleTokenHidden.data) || appleTokenHidden.data.length === 0,
    `status ${appleTokenHidden.status}`,
  );

  // The real deletion (v3 also records the identity-provider cleanup report).
  const deleted = await rpc(tokens.leaver, 'account_delete_self_v3', {
    p_confirm: username,
    p_password: accounts.leaver.password,
    p_reason: 'smoke test',
    p_media: { verified: true, removed: 0, legacy_removed: 1, source: 'smoke' },
    p_identity: { ok: true, revoked: true, skipped: null },
  });
  check('self deletion completes', deleted.ok && deleted.data?.status === 'completed', deleted.text.slice(0, 200));
  check('deletion returns a reference code', Boolean(deleted.data?.reference_code));
  check('deletion reports no purge failures', (deleted.data?.failures ?? []).length === 0, JSON.stringify(deleted.data?.failures));

  const reference = deleted.data?.reference_code;
  const receipt = deleted.data?.receipt_token;

  const storageStep = reference
    ? await runSql(
        `select detail from public.account_deletion_steps s
           join public.account_deletion_requests r on r.id = s.request_id
          where r.reference_code = '${reference}' and s.step_key = 'storage';`,
      )
    : [];
  check(
    'media purge report is recorded on the request',
    Boolean(storageStep[0]?.detail?.purge?.verified),
    JSON.stringify(storageStep[0]?.detail ?? null),
  );

  const authStep = reference
    ? await runSql(
        `select detail from public.account_deletion_steps s
           join public.account_deletion_requests r on r.id = s.request_id
          where r.reference_code = '${reference}' and s.step_key = 'auth';`,
      )
    : [];
  check(
    'apple token revocation is recorded on the request',
    authStep[0]?.detail?.apple_token_revoked === true,
    JSON.stringify(authStep[0]?.detail ?? null),
  );

  const appleTokenLeft = await runSql(
    `select count(*)::int as n from public.apple_auth_tokens where user_id = '${ids.leaver}';`,
  );
  check('apple token is purged with the account', appleTokenLeft[0]?.n === 0);

  // Profile, content, conversation and storage must be gone.
  const profileLeft = await runSql(
    `select count(*)::int as n from public.profiles where id = '${ids.leaver}';`,
  );
  check('profile is deleted', profileLeft[0]?.n === 0);

  const postsLeft = await runSql(
    `select count(*)::int as n from public.posts where author_id = '${ids.leaver}';`,
  );
  check('posts are deleted', postsLeft[0]?.n === 0);

  const messagesLeft = await runSql(
    `select count(*)::int as n from public.messages where sender_id = '${ids.leaver}';`,
  );
  check('sent messages are removed or anonymised', messagesLeft[0]?.n === 0);

  const membersLeft = await runSql(
    `select count(*)::int as n from public.conversation_members where user_id = '${ids.leaver}';`,
  );
  check('conversation memberships are deleted', membersLeft[0]?.n === 0);

  const storageLeft = await runSql(
    `select count(*)::int as n from storage.objects where owner = '${ids.leaver}';`,
  );
  check('owned storage objects are deleted', storageLeft[0]?.n === 0);

  const authLeft = await request(`/auth/v1/admin/users/${ids.leaver}`, {
    token: service,
    key: service,
  });
  check('auth account is deleted', authLeft.status === 404, `status ${authLeft.status}`);

  // Refresh tokens die with the account and mutations must be impossible even
  // if an old access token is still within its one-hour lifetime.
  const refresh = await request('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: refreshTokens.leaver },
  });
  check('refresh token is revoked', !refresh.ok, `status ${refresh.status}`);

  const stalePost = await rpc(tokens.leaver, 'feed_create_post', {
    p_body: 'silinmis hesaptan gonderi',
    p_visibility: 'public',
  });
  check('stale access token cannot write', !stalePost.ok, `status ${stalePost.status}`);

  const signInAgain = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: accounts.leaver.email, password: accounts.leaver.password },
  });
  check('deleted account cannot sign in', !signInAgain.ok, `status ${signInAgain.status}`);

  // The reference + receipt pair still resolves without a session.
  if (reference && receipt) {
    const status = await rpc(anon, 'account_deletion_status_by_receipt', {
      p_reference: reference,
      p_receipt: receipt,
    });
    check(
      'deletion receipt resolves anonymously',
      status.ok && status.data?.request?.status === 'completed',
      `status ${status.status}`,
    );
  } else {
    check('deletion receipt resolves anonymously', false, 'missing reference/receipt');
  }

  // The surviving account keeps working.
  const friendFeed = await rpc(tokens.friend, 'feed_list', { p_limit: 5 });
  check('other accounts are unaffected', friendFeed.ok, `status ${friendFeed.status}`);
};

let success = false;
try {
  await main();
  success = failures === 0;
  console.log(`\n${total - failures}/${total} checks passed.`);
} catch (error) {
  console.error('\nSmoke test crashed:', error);
} finally {
  await cleanup();
}

process.exit(success ? 0 : 1);
