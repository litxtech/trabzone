/**
 * Sunucu tarafı Supabase yardımcıları.
 *
 * - Servis rolü anahtarı yalnızca burada kullanılır; istemciye dönmez.
 * - Yönetici doğrulaması kullanıcının kendi JWT'siyle `is_admin()` RPC'sine
 *   gidilerek yapılır. Böylece API uç noktası ayrı bir yetki tablosu tutmaz.
 */

function serviceConfig() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    ''
  ).replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, serviceKey };
}

function anonConfig() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    ''
  ).replace(/\/+$/, '');
  const anonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();
  return { url, anonKey };
}

function hasServiceConfig() {
  const { url, serviceKey } = serviceConfig();
  return Boolean(url && serviceKey);
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

function errorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  return (
    payload.message ||
    payload.error_description ||
    payload.error ||
    payload.details ||
    payload.hint ||
    fallback
  );
}

/** Servis rolüyle bir Postgres fonksiyonu çağırır. */
async function serviceRpc(name, args = {}) {
  const { url, serviceKey } = serviceConfig();
  if (!url || !serviceKey) {
    const error = new Error('Supabase servis yapılandırması eksik.');
    error.code = 'supabase_not_configured';
    throw error;
  }

  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const error = new Error(errorMessage(payload, `Supabase RPC ${name} başarısız.`));
    error.code = 'supabase_rpc_failed';
    error.status = response.status;
    error.payload = payload;
    error.rpc = name;
    throw error;
  }
  return payload;
}

/** Kullanıcı JWT'siyle anon anahtarını kullanarak RPC çağırır. */
async function userRpc(name, args, accessToken) {
  const { url, anonKey } = anonConfig();
  if (!url || !anonKey) {
    const error = new Error('Supabase anon yapılandırması eksik.');
    error.code = 'supabase_not_configured';
    throw error;
  }
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const error = new Error(errorMessage(payload, `Supabase RPC ${name} başarısız.`));
    error.code = 'supabase_rpc_failed';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function bearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * İstek sahibinin yönetici olduğunu doğrular.
 *
 * Zamanlanmış senkron için `x-sync-secret` başlığı `LITEAPI_SYNC_SECRET` ile
 * eşleşirse yönetici JWT'si aranmaz. Bu başlık yalnızca sunucu tarafında
 * (cron/CLI) kullanılmalıdır.
 */
async function verifyAdmin(req) {
  const syncSecret = (process.env.LITEAPI_SYNC_SECRET || '').trim();
  const providedSecret = req?.headers?.['x-sync-secret'];
  if (syncSecret && typeof providedSecret === 'string' && providedSecret === syncSecret) {
    return { ok: true, userId: null, via: 'sync_secret' };
  }

  const token = bearerToken(req);
  if (!token) {
    return { ok: false, reason: 'auth_required' };
  }

  const { url, anonKey } = anonConfig();
  if (!url || !anonKey) {
    return { ok: false, reason: 'supabase_not_configured' };
  }

  let userResponse;
  try {
    userResponse = await fetch(`${url}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    return { ok: false, reason: 'auth_unreachable' };
  }

  if (!userResponse.ok) {
    return { ok: false, reason: 'auth_invalid' };
  }

  const user = await readJson(userResponse);
  const userId = user && typeof user.id === 'string' ? user.id : null;
  if (!userId) {
    return { ok: false, reason: 'auth_invalid' };
  }

  try {
    const isAdmin = await userRpc('is_admin', {}, token);
    if (isAdmin === true) {
      return { ok: true, userId, via: 'jwt' };
    }
  } catch {
    // Yetki kontrolü başarısızsa istek reddedilir.
  }
  return { ok: false, reason: 'not_admin' };
}

/** Giriş yapmış kullanıcıyı doğrular (yönetici şartı yok). */
async function verifyUser(req) {
  const token = bearerToken(req);
  if (!token) return { ok: false, reason: 'auth_required' };
  const { url, anonKey } = anonConfig();
  if (!url || !anonKey) return { ok: false, reason: 'supabase_not_configured' };
  let response;
  try {
    response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, reason: 'auth_unreachable' };
  }
  if (!response.ok) return { ok: false, reason: 'auth_invalid' };
  const user = await readJson(response);
  if (!user || typeof user.id !== 'string') return { ok: false, reason: 'auth_invalid' };
  return { ok: true, userId: user.id, email: user.email ?? null, token };
}

module.exports = {
  serviceConfig,
  anonConfig,
  hasServiceConfig,
  serviceRpc,
  userRpc,
  verifyAdmin,
  verifyUser,
  bearerToken,
};
