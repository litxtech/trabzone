// r2-purge: hesap silmede kullaniciya ait TUM medyayi depolar ve dogrular.
//
// Neden gerekli:
//   Medya artik Cloudflare R2'de tutuluyor (public: trabzone-media, gizli:
//   trabzone-private). `storage.objects` tablosu R2 nesnelerini gormedigi icin
//   hesap silindikten sonra avatar, kapak, gonderi ve sohbet dosyalari R2'de
//   kaliyordu. Apple App Store 5.1.1(v) ve Google Play hesap silme kurallari
//   kullaniciya ait tum verilerin (profil fotografi dahil) kaldirilmasini
//   ister.
//
// Akis (tek cagrida):
//   1. JWT dogrulanir. `targetUserId` verilmisse cagiranin
//      `privacy.request.manage` yetkisi veritabaninda kontrol edilir.
//   2. `account_deletion_media_inventory()` cagrilir: gizli sohbet anahtarlari
//      ve eski Supabase nesneleri. Yetki kontrolu bu fonksiyonda yapilir.
//   3. Public kovada kullanicinin klasorleri listelenir ve silinir:
//      <kova>/<uid>/... (avatars, covers, posts, stories, reels, ...).
//   4. Gizli kovada yalnizca bu kullanicinin yukledigi dosyalar silinir.
//   5. Eski Supabase nesneleri service_role ile Storage API'den silinir.
//   6. Silme sonrasi public klasorler yeniden listelenir; artik nesne yoksa
//      `done: true` doner. Kalan varsa istemci tekrar cagirir.
//
// Guvenlik:
//   - Anahtar bicimi sabittir: <kova>/<sahip>/r2/<dosya>; silme yalnizca
//     <uid>/ klasoru icinde yapilir.
//   - Gizli kovada dosya adi yukleyen kullanici ile baslar (<uid>-...),
//     boylece karsi tarafin medyasi silinmez.
//   - R2 gizli anahtarlari yalnizca bu function'da bulunur.

const PUBLIC_BUCKETS = [
  'avatars',
  'covers',
  'posts',
  'stories',
  'reels',
  'listing-images',
  'place-media',
  'real-estate-media',
  'ride-vehicle-photos',
];
const PRIVATE_LOGICAL_BUCKET = 'message-media';
/** Tek cagrida silinecek en fazla nesne sayisi (function suresi icin). */
const MAX_OBJECTS_PER_RUN = 400;
const DELETE_CONCURRENCY = 16;
const URL_TTL_SECONDS = 900;
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

/** RFC 3986 yuzde kodlamasi (SigV4 kanonik sorgu icin). */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

type SignConfig = { host: string; accessKey: string; secretKey: string };

function readConfig(): SignConfig | null {
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
      // Gecersiz endpoint yok sayilir; hesap kimliginden turetilen kullanilir.
    }
  }
  if (!host || host.startsWith('.r2')) {
    return null;
  }
  return { host, accessKey, secretKey };
}

/**
 * S3 uyumlu (AWS SigV4) imzali URL uretir. Sorgu parametreleri kanonik
 * imzaya dahil edilir; boylece ListObjectsV2 istekleri de imzalanabilir.
 */
async function presign(input: {
  method: 'GET' | 'DELETE' | 'HEAD';
  config: SignConfig;
  path: string;
  query?: [string, string][];
}): Promise<string> {
  const now = new Date();
  const dateTime = amzDate(now);
  const dateStamp = dateTime.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  const canonicalUri = input.path
    .split('/')
    .map((segment) => uriEncode(segment))
    .join('/');

  const params: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.config.accessKey}/${credentialScope}`],
    ['X-Amz-Date', dateTime],
    ['X-Amz-Expires', String(URL_TTL_SECONDS)],
    ['X-Amz-SignedHeaders', 'host'],
    ...(input.query ?? []),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const canonicalQuery = params
    .map(([key, value]) => `${uriEncode(key)}=${uriEncode(value)}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    `host:${input.config.host}`,
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

  const kDate = await hmac(encoder.encode(`AWS4${input.config.secretKey}`), dateStamp);
  const kRegion = await hmac(kDate, 'auto');
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  return `https://${input.config.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
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

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** ListObjectsV2 yanitindan nesne anahtarlarini okur. */
function extractKeys(xml: string): string[] {
  const keys: string[] = [];
  for (const match of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
    if (match[1]) {
      keys.push(decodeXml(match[1]));
    }
  }
  return keys;
}

async function listKeys(
  config: SignConfig,
  bucket: string,
  prefix: string,
  cap: number,
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;

  for (let page = 0; page < 5; page += 1) {
    const query: [string, string][] = [
      ['list-type', '2'],
      ['max-keys', '1000'],
      ['prefix', prefix],
    ];
    if (token) {
      query.push(['continuation-token', token]);
    }

    const url = await presign({ method: 'GET', config, path: `/${bucket}`, query });
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`list_failed_${response.status}`);
    }
    const xml = await response.text();
    keys.push(...extractKeys(xml));

    if (keys.length >= cap) {
      break;
    }

    const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !next) {
      break;
    }
    token = decodeXml(next);
  }

  return keys;
}

/** Nesneleri sinirli eszamanlilikla siler; silinen anahtarlari doner. */
async function deleteKeys(
  config: SignConfig,
  bucket: string,
  keys: string[],
  options: { onlyExisting?: boolean } = {},
): Promise<{ removed: number; missing: number; deleted: string[] }> {
  if (keys.length === 0) {
    return { removed: 0, missing: 0, deleted: [] };
  }

  let cursor = 0;
  const deleted: string[] = [];
  let missing = 0;

  const workers = Array.from(
    { length: Math.min(DELETE_CONCURRENCY, keys.length) },
    async () => {
      while (cursor < keys.length) {
        const key = keys[cursor];
        cursor += 1;
        try {
          if (options.onlyExisting) {
            // Sohbet medyasi anahtarlari mesaj kaydindan turetilir; mesaj
            // satiri silinene kadar ayni anahtar tekrar gelebilir. Nesne zaten
            // yoksa ne silinmis ne de hata sayilir (R2 DELETE her durumda 204
            // doner, bu yuzden varlik HEAD ile dogrulanir).
            const head = await presign({
              method: 'HEAD',
              config,
              path: `/${bucket}/${key}`,
            });
            const check = await fetch(head, { method: 'HEAD' });
            if (!check.ok) {
              missing += 1;
              continue;
            }
          }
          const url = await presign({
            method: 'DELETE',
            config,
            path: `/${bucket}/${key}`,
          });
          const response = await fetch(url, { method: 'DELETE' });
          // S3/R2 silme islemi tekrar cagrilabilir: 404 "zaten yok" demektir.
          if (response.ok || response.status === 404) {
            deleted.push(key);
          }
        } catch {
          // Basarisiz silme `pending` olarak raporlanir; istemci tekrar dener.
        }
      }
    },
  );

  await Promise.all(workers);
  return { removed: deleted.length, missing, deleted };
}

/**
 * Public medya adreslerini Cloudflare onbelleğinden düşürür.
 *
 * R2 nesnesi silinse bile özel alan adındaki CDN kopyası TTL bitene kadar
 * görünmeye devam edebilir. Silinen hesabın avatarı platformdan kalksın diye
 * CDN kayıtları temizlenir. Anahtar yoksa (token/zone tanımlı değilse) adım
 * sessizce atlanır; kalıcı veri zaten R2'den kaldırılmıştır.
 */
async function purgeCdnCache(keys: string[]): Promise<{ purged: number; skipped: boolean }> {
  const token = Deno.env.get('CLOUDFLARE_API_TOKEN') ?? '';
  const zone = Deno.env.get('CLOUDFLARE_ZONE_ID') ?? '';
  const base = (Deno.env.get('R2_PUBLIC_URL') ?? '').replace(/\/+$/, '');
  if (!token || !zone || !base || keys.length === 0) {
    return { purged: 0, skipped: true };
  }

  let purged = 0;
  for (let index = 0; index < keys.length; index += 30) {
    const files = keys.slice(index, index + 30).map((key) => `${base}/${key}`);
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files }),
        },
      );
      if (response.ok) {
        purged += files.length;
      }
    } catch {
      // Onbellek temizligi en iyi cabadir; silme islemini engellemez.
    }
  }

  return { purged, skipped: false };
}

type Inventory = {
  user_id: string;
  private_keys: string[];
  legacy_storage: { bucket: string; path: string }[];
  counts?: { private?: number; legacy?: number };
};

/** Yetki kontrolu veritabaninda yapilan medya envanterini okur. */
async function fetchInventory(
  request: Request,
  targetUserId: string,
): Promise<{ inventory: Inventory } | { error: string; status: number }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authorization = request.headers.get('Authorization') ?? '';
  if (!supabaseUrl || !anonKey || !authorization) {
    return { error: 'unauthorized', status: 401 };
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/account_deletion_media_inventory`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: targetUserId }),
    });
    if (!response.ok) {
      const text = await response.text();
      const status = text.includes('forbidden') ? 403 : response.status === 401 ? 401 : 400;
      return { error: 'inventory_failed', status };
    }
    const data = (await response.json()) as Partial<Inventory> | null;
    return {
      inventory: {
        user_id: targetUserId,
        private_keys: Array.isArray(data?.private_keys)
          ? data.private_keys.filter((key): key is string => typeof key === 'string')
          : [],
        legacy_storage: Array.isArray(data?.legacy_storage)
          ? data.legacy_storage.filter(
              (item): item is { bucket: string; path: string } =>
                Boolean(item) && typeof item.bucket === 'string' && typeof item.path === 'string',
            )
          : [],
        counts: data?.counts,
      },
    };
  } catch {
    return { error: 'inventory_failed', status: 502 };
  }
}

/**
 * R2 oncesi yuklemeler Storage API'sinden service_role ile silinir: kullanici
 * artik oturum acamasa da (yonetici akisi) temizlik tamamlanir.
 */
async function purgeLegacyStorage(
  objects: { bucket: string; path: string }[],
): Promise<{ removed: number; failed: number }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (objects.length === 0 || !supabaseUrl || !serviceKey) {
    return { removed: 0, failed: objects.length };
  }

  const byBucket = new Map<string, string[]>();
  for (const item of objects) {
    const paths = byBucket.get(item.bucket) ?? [];
    paths.push(item.path);
    byBucket.set(item.bucket, paths);
  }

  let removed = 0;
  let failed = 0;

  for (const [bucket, paths] of byBucket) {
    for (let index = 0; index < paths.length; index += 100) {
      const chunk = paths.slice(index, index + 100);
      try {
        const response = await fetch(
          `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
          {
            method: 'DELETE',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prefixes: chunk }),
          },
        );
        if (response.ok) {
          removed += chunk.length;
        } else {
          failed += chunk.length;
        }
      } catch {
        failed += chunk.length;
      }
    }
  }

  return { removed, failed };
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

  let payload: { targetUserId?: string } = {};
  try {
    payload = (await request.json()) as { targetUserId?: string };
  } catch {
    payload = {};
  }

  const target = typeof payload?.targetUserId === 'string' && payload.targetUserId
    ? payload.targetUserId
    : uid;
  if (!UUID_PATTERN.test(target)) {
    return json({ error: 'invalid_target' }, 400);
  }

  const config = readConfig();
  if (!config) {
    return json({ error: 'r2_not_configured' }, 503);
  }

  const publicBucket = (Deno.env.get('R2_BUCKET') ?? 'trabzone-media').trim();
  const privateBucket = (Deno.env.get('R2_PRIVATE_BUCKET') ?? 'trabzone-private').trim();

  const inventoryResult = await fetchInventory(request, target);
  if ('error' in inventoryResult) {
    return json({ error: inventoryResult.error }, inventoryResult.status);
  }
  const inventory = inventoryResult.inventory;

  let budget = MAX_OBJECTS_PER_RUN;
  let removed = 0;
  let failed = 0;
  let pending = 0;
  let listed = 0;
  const deletedPublicKeys: string[] = [];

  // 1) Public medya: kullanicinin klasorleri kova kova listelenir.
  for (const logicalBucket of PUBLIC_BUCKETS) {
    let keys: string[] = [];
    try {
      keys = await listKeys(config, publicBucket, `${logicalBucket}/${target}/`, 2000);
    } catch {
      failed += 1;
      continue;
    }

    listed += keys.length;
    const batch = keys.slice(0, Math.max(0, budget));
    budget -= batch.length;
    const result = await deleteKeys(config, publicBucket, batch);
    removed += result.removed;
    deletedPublicKeys.push(...result.deleted);
    failed += batch.length - result.removed;
    pending += keys.length - batch.length;
  }

  // 2) Gizli sohbet medyasi: yalnizca bu kullanicinin yukledigi anahtarlar.
  const privateKeys = inventory.private_keys.filter((key) =>
    key.startsWith(`${PRIVATE_LOGICAL_BUCKET}/`)
  );
  const privateBatch = privateKeys.slice(0, Math.max(0, budget));
  budget -= privateBatch.length;
  const privateResult = await deleteKeys(config, privateBucket, privateBatch, {
    onlyExisting: true,
  });
  removed += privateResult.removed;
  failed += privateBatch.length - privateResult.removed - privateResult.missing;
  pending += privateKeys.length - privateBatch.length;

  // 3) R2 oncesi Supabase nesneleri.
  const legacy = await purgeLegacyStorage(inventory.legacy_storage);
  removed += legacy.removed;
  failed += legacy.failed;

  // 4) Dogrulama: silme bittiyse public klasorler yeniden listelenir.
  if (pending === 0) {
    for (const logicalBucket of PUBLIC_BUCKETS) {
      try {
        const leftovers = await listKeys(config, publicBucket, `${logicalBucket}/${target}/`, 10);
        pending += leftovers.length;
      } catch {
        // Listeleme basarisizsa dogrulama yapilamaz; istemci tekrar dener.
        pending += 1;
      }
    }
  }

  // 5) CDN onbellegi: silinen avatar/kapak adresleri hemen gecersiz olsun.
  const cdn = await purgeCdnCache(deletedPublicKeys.slice(0, 60));

  return json({
    ok: failed === 0,
    target,
    listed,
    removed,
    failed,
    pending,
    done: pending === 0 && failed === 0,
    legacy,
    cdn,
    expiresIn: URL_TTL_SECONDS,
  });
});
