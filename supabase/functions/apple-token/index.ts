// apple-token: Apple ile giris yapan kullanicinin jetonlarini saklar ve hesap
// silindiginde Apple tarafinda geri alir.
//
// Neden gerekli:
//   Apple App Store 5.1.1(v) ve "Sign in with Apple" kurallari, hesap
//   silindiginde uygulamanin Apple kimlik yetkisinin de kaldirilmasini ister.
//   Supabase `signInWithIdToken` yalnizca kimlik anahtarini dogrular ve Apple
//   yenileme jetonunu (refresh token) saklamaz; bu yuzden jeton burada, yetki
//   kodu (authorization code) ile bir kez degistirilip saklanir.
//
// Akis:
//   action = "link"   : iOS native Apple girisi sonrasi `code` gonderilir.
//                       Apple token endpoint'inden refresh token alinir ve
//                       `public.apple_auth_tokens` tablosuna yazilir.
//   action = "revoke" : Hesap silmeden once cagrilir. Jeton Apple'in
//                       /auth/revoke ucuna gonderilir; basarili olursa jeton
//                       veritabanindan da silinir (veri minimizasyonu).
//
// Gerekli sirlar (supabase secrets set ...):
//   APPLE_TEAM_ID       Apple Developer Team ID (10 karakter)
//   APPLE_KEY_ID        "Sign in with Apple" anahtarinin Key ID'si
//   APPLE_PRIVATE_KEY   AuthKey_XXXX.p8 dosyasinin icerigi (\n destekli)
//   APPLE_CLIENT_ID     App ID / Services ID (varsayilan: com.litxtech.trabzone)
//
// Sirlar tanimli degilse islev sessizce atlanir: giris ve hesap silme akislari
// bozulmaz, yalnizca Apple jeton iptali "skipped" olarak raporlanir.

const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const DEFAULT_CLIENT_ID = 'com.litxtech.trabzone';
const CLIENT_SECRET_TTL_SECONDS = 300;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const encoder = new TextEncoder();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function env(name: string): string {
  return (Deno.env.get(name) ?? '').trim();
}

function supabaseUrl(): string {
  return env('SUPABASE_URL').replace(/\/+$/, '');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJsonBase64Url(value: unknown): string {
  return toBase64Url(encoder.encode(JSON.stringify(value)));
}

/** PEM (PKCS#8) anahtarini DER baytlarina cevirir. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * WebCrypto ECDSA imzasi ASN.1 DER dondurur; JWT ES256 ise sabit uzunlukta
 * (r || s, 32+32 bayt) imza bekler.
 */
function derSignatureToRaw(der: Uint8Array): Uint8Array {
  let offset = 0;
  if (der[offset] !== 0x30) {
    throw new Error('invalid_signature');
  }
  offset += 1;

  let length = der[offset];
  offset += 1;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let index = 0; index < count; index += 1) {
      length = (length << 8) | der[offset];
      offset += 1;
    }
  }

  const readInteger = (): Uint8Array => {
    if (der[offset] !== 0x02) {
      throw new Error('invalid_signature');
    }
    offset += 1;
    let size = der[offset];
    offset += 1;
    if (size & 0x80) {
      const count = size & 0x7f;
      size = 0;
      for (let index = 0; index < count; index += 1) {
        size = (size << 8) | der[offset];
        offset += 1;
      }
    }
    const value = der.slice(offset, offset + size);
    offset += size;
    return value;
  };

  const normalize = (value: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) {
      start += 1;
    }
    const trimmed = value.slice(start);
    if (trimmed.length > 32) {
      return trimmed.slice(trimmed.length - 32);
    }
    const padded = new Uint8Array(32);
    padded.set(trimmed, 32 - trimmed.length);
    return padded;
  };

  const r = normalize(readInteger());
  const s = normalize(readInteger());
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

type AppleConfig = { clientId: string; teamId: string; keyId: string; privateKey: string };

function readAppleConfig(clientId?: string): AppleConfig | null {
  const teamId = env('APPLE_TEAM_ID');
  const keyId = env('APPLE_KEY_ID');
  const privateKey = env('APPLE_PRIVATE_KEY');
  const resolvedClientId = clientId || env('APPLE_CLIENT_ID') || env('APPLE_IOS_CLIENT_ID') || DEFAULT_CLIENT_ID;
  if (!teamId || !keyId || !privateKey || !resolvedClientId) {
    return null;
  }
  return { teamId, keyId, privateKey, clientId: resolvedClientId };
}

/**
 * Yetki kodunun verildigi istemci kimligi adaylari.
 *
 * iOS native girisinde kod uygulamanin bundle ID'si icin, Android'deki web
 * akisinda ise Services ID icin uretilir. Apple yetki kodu yalnizca kendisini
 * veren istemciyle degistirilebildigi icin adaylar sirayla denenir.
 */
function clientIdCandidates(preferred?: string): string[] {
  return [
    preferred,
    env('APPLE_CLIENT_ID'),
    DEFAULT_CLIENT_ID,
    env('APPLE_WEB_CLIENT_ID'),
    env('APPLE_IOS_CLIENT_ID'),
  ].filter((value): value is string => Boolean(value && value.trim()));
}

/** Apple istemci sirri (ES256 ile imzalanmis kisa omurlu JWT). */
async function buildClientSecret(config: AppleConfig): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(config.privateKey) as unknown as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const issuedAt = Math.floor(Date.now() / 1000);
  const signingInput = `${encodeJsonBase64Url({ alg: 'ES256', kid: config.keyId, typ: 'JWT' })}.${encodeJsonBase64Url({
    iss: config.teamId,
    iat: issuedAt,
    exp: issuedAt + CLIENT_SECRET_TTL_SECONDS,
    aud: 'https://appleid.apple.com',
    sub: config.clientId,
  })}`;

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  );

  return `${signingInput}.${toBase64Url(derSignatureToRaw(new Uint8Array(signature)))}`;
}

async function authenticatedUserId(request: Request): Promise<string | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    return null;
  }
  const url = supabaseUrl();
  const anonKey = env('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    return null;
  }
  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: anonKey },
    });
    if (!response.ok) {
      return null;
    }
    const user = (await response.json()) as { id?: string };
    return user.id ?? null;
  } catch {
    return null;
  }
}

function serviceHeaders(): Record<string, string> | null {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    return null;
  }
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

/** Hedef kullanici icin islem yetkisi (kendi hesabi veya gizlilik yoneticisi). */
async function canManageTarget(request: Request, target: string): Promise<boolean> {
  const url = supabaseUrl();
  const anonKey = env('SUPABASE_ANON_KEY');
  const authorization = request.headers.get('Authorization') ?? '';
  if (!url || !anonKey || !authorization) {
    return false;
  }
  try {
    const response = await fetch(`${url}/rest/v1/rpc/account_deletion_target_allowed`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: target }),
    });
    if (!response.ok) {
      return false;
    }
    return (await response.json()) === true;
  } catch {
    return false;
  }
}

type StoredToken = { refresh_token: string | null; client_id: string; revoked_at: string | null };

async function readStoredToken(target: string): Promise<StoredToken | null> {
  const headers = serviceHeaders();
  const url = supabaseUrl();
  if (!headers || !url) {
    return null;
  }
  const response = await fetch(
    `${url}/rest/v1/apple_auth_tokens?user_id=eq.${target}&select=refresh_token,client_id,revoked_at&limit=1`,
    { headers },
  );
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as StoredToken[];
  return rows[0] ?? null;
}

async function storeToken(row: {
  user_id: string;
  refresh_token: string;
  client_id: string;
}): Promise<boolean> {
  const headers = serviceHeaders();
  const url = supabaseUrl();
  if (!headers || !url) {
    return false;
  }
  const response = await fetch(`${url}/rest/v1/apple_auth_tokens?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([
      {
        ...row,
        updated_at: new Date().toISOString(),
        revoked_at: null,
        revoke_attempts: 0,
        last_error: null,
      },
    ]),
  });
  return response.ok;
}

async function patchToken(userId: string, patch: Record<string, unknown>): Promise<void> {
  const headers = serviceHeaders();
  const url = supabaseUrl();
  if (!headers || !url) {
    return;
  }
  await fetch(`${url}/rest/v1/apple_auth_tokens?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  }).catch(() => undefined);
}

/** Yetki kodunu Apple yenileme jetonuna cevirir. */
async function exchangeAuthorizationCode(
  config: AppleConfig,
  code: string,
): Promise<{ refreshToken: string | null; error?: string }> {
  const clientSecret = await buildClientSecret(config);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  });

  const response = await fetch(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    return { refreshToken: null, error: `exchange_failed_${response.status}` };
  }
  const payload = (await response.json()) as { refresh_token?: string };
  if (!payload.refresh_token) {
    return { refreshToken: null, error: 'missing_refresh_token' };
  }
  return { refreshToken: payload.refresh_token };
}

/** Apple tarafinda jetonu geri alir. */
async function revokeAtApple(
  config: AppleConfig,
  token: string,
): Promise<{ revoked: boolean; error?: string }> {
  const clientSecret = await buildClientSecret(config);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: clientSecret,
    token,
    token_type_hint: 'refresh_token',
  });

  const response = await fetch(APPLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (response.ok) {
    return { revoked: true };
  }
  return { revoked: false, error: `revoke_failed_${response.status}` };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const uid = await authenticatedUserId(request);
  if (!uid) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: { action?: string; code?: string; clientId?: string; targetUserId?: string } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    payload = {};
  }

  const action = payload.action === 'link' ? 'link' : 'revoke';

  if (action === 'link') {
    const code = typeof payload.code === 'string' ? payload.code.trim() : '';
    if (!code || code.length > 4096) {
      return json({ ok: false, error: 'invalid_code' }, 400);
    }

    const candidates = clientIdCandidates(payload.clientId)
      .map((clientId) => readAppleConfig(clientId))
      .filter((config): config is AppleConfig => config !== null);
    if (candidates.length === 0) {
      // Sirlar tanimli degilse giris akisi bozulmaz; yalnizca jeton saklanmaz.
      return json({ ok: false, linked: false, skipped: 'not_configured' });
    }

    let lastError = 'exchange_failed';
    for (const config of candidates) {
      try {
        const exchanged = await exchangeAuthorizationCode(config, code);
        if (!exchanged.refreshToken) {
          // Kod baska bir istemci icin uretilmis olabilir; sonraki aday denenir.
          lastError = exchanged.error ?? 'exchange_failed';
          continue;
        }
        const stored = await storeToken({
          user_id: uid,
          refresh_token: exchanged.refreshToken,
          client_id: config.clientId,
        });
        return json({ ok: stored, linked: stored });
      } catch {
        lastError = 'apple_unreachable';
      }
    }
    return json({ ok: false, linked: false, error: lastError });
  }

  const target = typeof payload.targetUserId === 'string' && payload.targetUserId
    ? payload.targetUserId
    : uid;
  if (!UUID_PATTERN.test(target)) {
    return json({ ok: false, error: 'invalid_target' }, 400);
  }

  if (target !== uid && !(await canManageTarget(request, target))) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  const stored = await readStoredToken(target);
  if (!stored) {
    return json({ ok: true, revoked: false, skipped: 'no_token' });
  }
  if (stored.revoked_at || !stored.refresh_token) {
    return json({ ok: true, revoked: false, skipped: 'already_revoked' });
  }

  const config = readAppleConfig(stored.client_id);
  if (!config) {
    return json({ ok: false, revoked: false, skipped: 'not_configured' });
  }

  try {
    const result = await revokeAtApple(config, stored.refresh_token);
    if (!result.revoked) {
      await patchToken(target, { last_error: result.error ?? 'revoke_failed' });
      return json({ ok: false, revoked: false, error: result.error ?? 'revoke_failed' });
    }
    // Veri minimizasyonu: jetonun kendisi saklanmaz, yalnizca iptal izi kalir.
    await patchToken(target, {
      refresh_token: null,
      revoked_at: new Date().toISOString(),
      last_error: null,
    });
    return json({ ok: true, revoked: true, skipped: null });
  } catch {
    await patchToken(target, { last_error: 'apple_unreachable' });
    return json({ ok: false, revoked: false, error: 'apple_unreachable' });
  }
});
