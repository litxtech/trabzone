// r2-sign: Cloudflare R2 için kısa ömürlü imzalı yükleme/okuma adresi üretir.
//
// Neden gerekli: R2 gizli anahtarı istemci paketine giremez. Uygulama yalnızca
// bu function'dan imzalı adres alır; anahtar doğrudan R2'ye gider.
//
// İki depo vardır:
// - Public bucket (R2_BUCKET): gönderi, hikâye, reels, ilan, işletme, emlak
//   medyası. Nesneler özel alan adından herkese açık sunulur.
// - Gizli bucket (R2_PRIVATE_BUCKET, varsayılan `trabzone-private`): yalnızca
//   sohbet medyası. Public erişim yoktur; okuma imzalı GET ile yapılır.
//
// Güvenlik:
// - Çağıranın JWT'si Supabase Auth ile doğrulanır.
// - Anahtar biçimi zorunludur: <bucket>/<owner>/r2/<dosya>
// - Public kovalarda <owner>, çağıran kullanıcının kimliği olmak zorundadır.
// - `message-media` için <owner> konuşma kimliğidir ve çağıranın o konuşmanın
//   üyesi olduğu veritabanından doğrulanır (RLS'li REST sorgusu).
// - Yalnızca medya kovaları ve medya uzantıları kabul edilir.
// - Eylemler: put (yükleme), delete (temizlik), get (imzalı okuma). `get`
//   eyleminde `keys` dizisi verilerek tek turda toplu imzalama yapılabilir.
//
// Gizli değerler (Supabase secrets):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
//   (opsiyonel) R2_PRIVATE_BUCKET, (opsiyonel) R2_ENDPOINT.

const ALLOWED_BUCKETS = [
  'posts',
  'stories',
  'reels',
  'listing-images',
  'place-media',
  'real-estate-media',
  'avatars',
  'covers',
  'ride-vehicle-photos',
  'message-media',
];
/** Public özel alan adından sunulmayan, yalnızca imzalı okunan kovalar. */
const PRIVATE_BUCKETS = ['message-media'];
// Görseller ve videolar aynı bucket'a gider; uzantı listesi medya türlerinin
// tamamını kapsamak zorunda, aksi halde görsel yüklemeleri `invalid_key` döner.
const ALLOWED_EXTENSIONS = [
  // görsel
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'heif',
  'gif',
  'avif',
  // video
  'mp4',
  'mov',
  'm4v',
  'webm',
];
const URL_TTL_SECONDS = 3600;

type SignRequest = { action?: string; key?: string; keys?: string[]; contentType?: string };

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/** R2'de imzalı istek için gereken ayarları okur. */
function readConfig(): {
  host: string;
  accessKey: string;
  secretKey: string;
} | null {
  const accountId = Deno.env.get('R2_ACCOUNT_ID') ?? '';
  const accessKey = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
  const secretKey = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
  const explicitEndpoint = Deno.env.get('R2_ENDPOINT') ?? '';

  if (!accessKey || !secretKey) {
    return null;
  }

  let host = `${accountId}.r2.cloudflarestorage.com`;
  if (explicitEndpoint) {
    try {
      host = new URL(explicitEndpoint).host;
    } catch {
      // Geçersiz endpoint yok sayılır; hesap kimliğinden türetilen kullanılır.
    }
  }
  if (!host || host.startsWith('.r2')) {
    return null;
  }
  return { host, accessKey, secretKey };
}

/**
 * S3 uyumlu (AWS SigV4) sorgu imzası üretir. Bağımlılık yok: yalnızca Web
 * Crypto kullanılır, böylece function soğuk başlangıcı hızlı kalır.
 */
async function presign(input: {
  method: 'PUT' | 'DELETE' | 'GET';
  host: string;
  path: string;
  accessKey: string;
  secretKey: string;
}): Promise<string> {
  const now = new Date();
  const dateTime = amzDate(now);
  const dateStamp = dateTime.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  const canonicalUri = input.path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) =>
      `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    ))
    .join('/');

  const query = [
    'X-Amz-Algorithm=AWS4-HMAC-SHA256',
    `X-Amz-Credential=${encodeURIComponent(`${input.accessKey}/${credentialScope}`)}`,
    `X-Amz-Date=${dateTime}`,
    `X-Amz-Expires=${URL_TTL_SECONDS}`,
    'X-Amz-SignedHeaders=host',
  ].join('&');

  const canonicalRequest = [
    input.method,
    canonicalUri,
    query,
    `host:${input.host}`,
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateTime,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmac(encoder.encode(`AWS4${input.secretKey}`), dateStamp);
  const kRegion = await hmac(kDate, 'auto');
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  return `https://${input.host}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
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

/** Konuşma kimliği biçimi (UUID). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Çağıranın konuşmanın üyesi olup olmadığını doğrular.
 *
 * Sorgu, çağıranın JWT'si ile yapılır; `conversation_members` üzerindeki RLS
 * politikası yalnızca kendi üyelik satırını döndürür. Böylece function'ın
 * service_role anahtarına ihtiyacı olmaz ve yetki veritabanında kalır.
 */
async function isConversationMember(
  conversationId: string,
  uid: string,
  request: Request,
): Promise<boolean> {
  if (!UUID_PATTERN.test(conversationId)) {
    return false;
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authorization = request.headers.get('Authorization') ?? '';
  if (!supabaseUrl || !anonKey || !authorization) {
    return false;
  }
  const query =
    `${supabaseUrl}/rest/v1/conversation_members` +
    `?conversation_id=eq.${encodeURIComponent(conversationId)}` +
    `&user_id=eq.${encodeURIComponent(uid)}` +
    '&left_at=is.null&select=conversation_id&limit=1';
  try {
    const response = await fetch(query, {
      headers: { apikey: anonKey, Authorization: authorization },
    });
    if (!response.ok) {
      return false;
    }
    const rows = (await response.json()) as unknown;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/** Anahtarın biçimini ve sahipliğini doğrular. */
async function isAllowedKey(key: string, uid: string, request: Request): Promise<boolean> {
  const parts = key.split('/');
  if (parts.length !== 4) {
    return false;
  }
  const [bucket, owner, segment, fileName] = parts as [string, string, string, string];
  if (!ALLOWED_BUCKETS.includes(bucket) || segment !== 'r2') {
    return false;
  }
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(fileName) || !ALLOWED_EXTENSIONS.includes(extension)) {
    return false;
  }
  // Gizli sohbet medyasında sahip, dosyayı yükleyen değil konuşmadır: her iki
  // katılımcı da okuyup yazabilmelidir.
  if (PRIVATE_BUCKETS.includes(bucket)) {
    return await isConversationMember(owner, uid, request);
  }
  return owner === uid;
}

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

  let payload: SignRequest;
  try {
    payload = (await request.json()) as SignRequest;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  // `put` yükleme, `delete` depo temizliği, `get` ise public erişim kapalıyken
  // (veya doğrulama sırasında) nesneyi imzalı okumak içindir.
  const action =
    payload.action === 'delete'
      ? 'delete'
      : payload.action === 'put'
        ? 'put'
        : payload.action === 'get'
          ? 'get'
          : null;
  if (!action) {
    return json({ error: 'invalid_action' }, 400);
  }

  const config = readConfig();
  if (!config) {
    return json({ error: 'r2_not_configured' }, 503);
  }

  const publicBucket = (Deno.env.get('R2_BUCKET') ?? 'trabzone-media').trim();
  const privateBucket = (Deno.env.get('R2_PRIVATE_BUCKET') ?? 'trabzone-private').trim();
  const bucketFor = (key: string): string => {
    const name = key.split('/')[0] ?? '';
    return PRIVATE_BUCKETS.includes(name) ? privateBucket : publicBucket;
  };

  // Toplu okuma: sohbet ekranı onlarca medyayı tek turda imzalar. Yetkisiz
  // anahtarlar sessizce atlanır; istemci eksik adresi gösteremez.
  if (action === 'get' && Array.isArray(payload.keys)) {
    const keys = payload.keys.filter((key): key is string => typeof key === 'string').slice(0, 60);
    const urls: Record<string, string> = {};
    for (const key of keys) {
      if (!(await isAllowedKey(key, uid, request))) {
        continue;
      }
      urls[key] = await presign({
        method: 'GET',
        host: config.host,
        path: `/${bucketFor(key)}/${key}`,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
      });
    }
    return json({ urls, expiresIn: URL_TTL_SECONDS });
  }

  if (!payload.key) {
    return json({ error: 'invalid_action' }, 400);
  }
  if (!(await isAllowedKey(payload.key, uid, request))) {
    return json({ error: 'invalid_key' }, 403);
  }

  const method = action === 'delete' ? 'DELETE' : action === 'get' ? 'GET' : 'PUT';
  const url = await presign({
    method,
    host: config.host,
    path: `/${bucketFor(payload.key)}/${payload.key}`,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  });

  return json({ url, expiresIn: URL_TTL_SECONDS });
});
