// livekit-token: bir arama (call_sessions) için LiveKit erişim anahtarı üretir.
//
// Neden gerekli: LiveKit API secret'ı istemci paketine giremez. Uygulama
// yalnızca bu function'dan kısa ömürlü bir JWT alır; medya sunucusuna
// katılırken bu anahtarı kullanır.
//
// Güvenlik:
// - Çağıranın JWT'si Supabase Auth ile doğrulanır.
// - `call_id` veritabanında aranır; çağıran, aramanın tarafı (arayan veya
//   aranan) olmak zorundadır.
// - Yalnızca halkası süren (ringing/accepted) aramalar için anahtar verilir.
// - Katılım kimliği (`identity`) her zaman çağıranın uid'sidir; istemci
//   başkasının kimliğiyle odaya giremez.
//
// Gizli değerler (Supabase secrets):
//   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET

type TokenRequest = { call_id?: string };

type CallRow = {
  id: string;
  room_name: string;
  status: string;
  kind: string;
  caller_id: string;
  callee_id: string;
};

type ProfileRow = { first_name: string | null; last_name: string | null; username: string | null };

/** LiveKit join token ömrü: tek bir arama için fazlasıyla yeterli. */
const TOKEN_TTL_SECONDS = 60 * 60 * 4;

const ACTIVE_STATUSES = ['ringing', 'accepted'];

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

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HS256 imzalı JWT üretir (LiveKit erişim anahtarı biçimi). */
async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function authenticatedUserId(request: Request): Promise<string | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    return null;
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !anonKey) {
    return null;
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
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

/** Service role ile tek aramayı okur (RLS'i atlar, sahiplik ayrıca doğrulanır). */
async function fetchCall(callId: string): Promise<CallRow | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return null;
  }
  const query = new URLSearchParams({
    id: `eq.${callId}`,
    select: 'id,room_name,status,kind,caller_id,callee_id',
    limit: '1',
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/call_sessions?${query.toString()}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) {
    return null;
  }
  const rows = (await response.json()) as CallRow[];
  return rows[0] ?? null;
}

async function fetchDisplayName(uid: string): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return '';
  }
  const query = new URLSearchParams({
    id: `eq.${uid}`,
    select: 'first_name,last_name,username',
    limit: '1',
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?${query.toString()}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!response.ok) {
      return '';
    }
    const rows = (await response.json()) as ProfileRow[];
    const profile = rows[0];
    if (!profile) {
      return '';
    }
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
    return fullName || profile.username || '';
  } catch {
    return '';
  }
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

  let payload: TokenRequest;
  try {
    payload = (await request.json()) as TokenRequest;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const callId = (payload.call_id ?? '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(callId)) {
    return json({ error: 'invalid_call_id' }, 400);
  }

  const apiKey = (Deno.env.get('LIVEKIT_API_KEY') ?? '').trim();
  const apiSecret = (Deno.env.get('LIVEKIT_API_SECRET') ?? '').trim();
  const livekitUrl = (Deno.env.get('LIVEKIT_URL') ?? '').trim();
  if (!apiKey || !apiSecret || !livekitUrl) {
    return json({ error: 'livekit_not_configured' }, 503);
  }

  const call = await fetchCall(callId);
  // Var olmayan arama ile başkasının araması aynı yanıtı verir; bilgi sızdırmaz.
  if (!call || (call.caller_id !== uid && call.callee_id !== uid)) {
    return json({ error: 'call_not_found' }, 403);
  }
  if (!ACTIVE_STATUSES.includes(call.status)) {
    return json({ error: 'call_not_active' }, 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const displayName = await fetchDisplayName(uid);

  const token = await signJwt(
    {
      iss: apiKey,
      sub: uid,
      name: displayName || undefined,
      nbf: now - 10,
      exp: now + TOKEN_TTL_SECONDS,
      jti: crypto.randomUUID(),
      video: {
        room: call.room_name,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
      },
    },
    apiSecret,
  );

  return json({
    token,
    url: livekitUrl,
    room: call.room_name,
    identity: uid,
    kind: call.kind,
    expiresIn: TOKEN_TTL_SECONDS,
  });
});
