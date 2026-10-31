// push-dispatch: genel bildirim push'larını Expo Push API'ye gönderen worker.
//
// Akış: pg_cron (push_tick) → bu fonksiyon → push_claim (cihaz başına kuyruk)
// → /--/api/v2/push/send (100'lü toplu) → push_report → makbuzlar →
// DeviceNotRegistered dönen token'lar user_devices'ta geçersiz işaretlenir.
//
// Yetki: yalnızca pg_cron'un vault'taki push_worker_secret'ı (x-push-token).
// Deprem ve maç bildirimleri kendi worker'larında (earthquake-sync,
// sports-sync) gönderilir; bu hat onları işlemez.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const WORK_BUDGET_MS = 35_000;
const BATCH_SIZE = 100;

const env = (key: string) => Deno.env.get(key) ?? '';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });

function serviceHeaders(): Record<string, string> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

const baseUrl = () => (env('SUPABASE_URL') || '').replace(/\/$/, '');

async function rpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${baseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify(params),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`rpc_${name}_${response.status}:${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

type PushItem = {
  delivery_id: string;
  token: string;
  platform: 'ios' | 'android' | string;
  title: string | null;
  body: string | null;
  route: string | null;
  kind: string;
  priority: number;
  sound: boolean;
  /** Okunmamış bildirim sayısı (push_claim hesaplar). */
  badge?: number | null;
  data: Record<string, unknown> | null;
};

type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

type ExpoReceipt = { status: 'ok' | 'error'; message?: string; details?: { error?: string } };

// Android kanalları istemcide push-registration.ts içinde oluşturulur; burada
// yalnızca kanal kimliği seçilir. Bilinmeyen tür "social" kanalına düşer.
//
// Kanal önem derecesi bildirimin arka planda/uyku (Doze) sırasında başlık
// olarak görünmesini belirler: eczane, sipariş ve güvenlik bildirimleri
// HIGH önemli kanallara gider, beğeni/yorum gibi sosyal bildirimler varsayılan
// "social" kanalında kalır.
const CHANNEL_BY_KIND: Record<string, string> = {
  message: 'messages',
  market_message: 'messages',
  accommodation_message: 'messages',
  group_invite: 'messages',
  security: 'alerts',
  order: 'alerts',
  support: 'alerts',
  system: 'alerts',
  ride: 'alerts',
  accommodation_property: 'alerts',
  accommodation_reservation: 'alerts',
  pharmacy: 'pharmacy',
};

// Uygulama kapalıyken/uykudayken cihaz çevrimdışıysa bildirim ne kadar süre
// teslim edilmeye çalışılsın (saniye). Nöbet bilgisi gün boyu anlamlıdır.
const TTL_BY_KIND: Record<string, number> = {
  message: 6 * 3600,
  market_message: 6 * 3600,
  accommodation_message: 6 * 3600,
  pharmacy: 12 * 3600,
};
const DEFAULT_TTL = 3600;

const RETRYABLE_EXPO_ERRORS = new Set(['MessageRateExceeded', 'ExpoError', 'ServiceUnavailable']);

function expoHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  const token = env('EXPO_ACCESS_TOKEN');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function expoMessage(item: PushItem) {
  const isAndroid = item.platform === 'android';
  const channelId = isAndroid ? (CHANNEL_BY_KIND[item.kind] ?? 'social') : undefined;
  // Uygulama kapalıyken de doğru rozet: sunucu okunmamış sayısını gönderir.
  // badge=0 rozeti temizler; sayı yoksa alan tamamen atlanır (istemci kendi
  // senkronunu yapar).
  const badge =
    typeof item.badge === 'number' && Number.isFinite(item.badge)
      ? Math.max(0, Math.min(999, Math.floor(item.badge)))
      : undefined;
  return {
    to: item.token,
    title: (item.title ?? 'Trabzone').slice(0, 160),
    body: (item.body ?? '').slice(0, 400),
    // Android'de sesi kanal (`channelId`) belirler; FCM yüküne "default"
    // yazmak expo-notifications'ın bunu özel bir ses dosyası sanıp
    // "Custom sound 'default' not found" hatası basmasına yol açıyordu.
    // iOS'ta ise "default" sistem sesi anlamına gelir; null = sessiz.
    sound: isAndroid ? undefined : item.sound ? 'default' : null,
    // high = FCM yüksek öncelik / APNs priority 10: uygulama arka plandayken
    // ve cihaz uykudayken bildirim bekletilmeden gösterilir.
    priority: item.priority <= 4 ? 'high' : 'default',
    channelId,
    badge,
    ttl: TTL_BY_KIND[item.kind] ?? DEFAULT_TTL,
    data: {
      ...(item.data ?? {}),
      type: 'notification',
      route: item.route ?? undefined,
    },
  };
}

function ticketToReport(deliveryId: string, ticket: ExpoTicket | undefined) {
  if (!ticket) {
    return { delivery_id: deliveryId, ok: false, error: 'missing_ticket', message: null, retryable: true };
  }
  if (ticket.status === 'ok') {
    return { delivery_id: deliveryId, ok: true, ticket_id: ticket.id };
  }
  const error = ticket.details?.error ?? 'unknown';
  return {
    delivery_id: deliveryId,
    ok: false,
    error,
    message: (ticket.message ?? '').slice(0, 300),
    retryable: RETRYABLE_EXPO_ERRORS.has(error),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function runPush(deadline: number) {
  const totals = { claimed: 0, sent: 0, failed: 0, invalid: 0, retry: 0, paused: false };
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    const claim = await rpc<{ paused: boolean; items: PushItem[] }>('push_claim', { p_limit: 400 });
    totals.paused = claim.paused ?? false;
    if (!claim.items?.length) break;
    totals.claimed += claim.items.length;

    for (const batch of chunk(claim.items, BATCH_SIZE)) {
      let reports: Record<string, unknown>[];
      try {
        const response = await fetch(EXPO_SEND_URL, {
          method: 'POST',
          headers: expoHeaders(),
          body: JSON.stringify(batch.map(expoMessage)),
        });
        const payload = (await response.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
        if (!response.ok || !Array.isArray(payload?.data)) {
          const retryable = response.status === 429 || response.status >= 500;
          lastError ??= `http_${response.status}: ${JSON.stringify(payload).slice(0, 300)}`;
          reports = batch.map((item) => ({
            delivery_id: item.delivery_id,
            ok: false,
            error: `http_${response.status}`,
            message: JSON.stringify(payload).slice(0, 300),
            retryable,
          }));
        } else {
          reports = batch.map((item, index) => ticketToReport(item.delivery_id, payload.data?.[index]));
        }
      } catch (error) {
        lastError ??= `network: ${String(error).slice(0, 300)}`;
        reports = batch.map((item) => ({
          delivery_id: item.delivery_id,
          ok: false,
          error: 'network',
          message: String(error).slice(0, 300),
          retryable: true,
        }));
      }

      // Sağlayıcı hatasını görünür tut: InvalidCredentials gibi kalıcı hatalar
      // aksi halde yalnızca push_deliveries içinde kalıyordu.
      if (!lastError) {
        const failedReport = reports.find((report) => report.ok !== true);
        if (failedReport) {
          lastError = `${failedReport.error ?? 'unknown'}: ${String(failedReport.message ?? '').slice(0, 300)}`;
        }
      }

      const result = await rpc<Record<string, number>>('push_report', { p_results: reports });
      totals.sent += result.sent ?? 0;
      totals.failed += result.failed ?? 0;
      totals.invalid += result.invalid ?? 0;
      totals.retry += result.retry ?? 0;
    }

    if (claim.items.length < 400) break;
  }

  return { ...totals, last_error: lastError };
}

async function runReceipts() {
  const pending = await rpc<{ items: { delivery_id: string; ticket_id: string }[] }>('push_receipts_pending', {
    p_limit: 300,
  });
  if (!pending.items?.length) return { checked: 0 };

  const response = await fetch(EXPO_RECEIPTS_URL, {
    method: 'POST',
    headers: expoHeaders(),
    body: JSON.stringify({ ids: pending.items.map((item) => item.ticket_id) }),
  });
  if (!response.ok) return { checked: 0, error: `http_${response.status}` };

  const payload = (await response.json()) as { data?: Record<string, ExpoReceipt> };
  const reports = pending.items
    .filter((item) => payload.data?.[item.ticket_id])
    .map((item) => {
      const receipt = payload.data![item.ticket_id];
      return {
        delivery_id: item.delivery_id,
        status: receipt.status,
        error: receipt.details?.error ?? null,
        message: receipt.message ?? null,
      };
    });
  if (!reports.length) return { checked: 0 };

  const result = await rpc<Record<string, number>>('push_receipts_report', { p_results: reports });
  return { checked: reports.length, ...result };
}

async function tokenOk(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    return (await rpc<boolean>('push_worker_token_ok', { p_token: token })) === true;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const action = typeof body.action === 'string' ? body.action : 'tick';
  const started = Date.now();
  const deadline = started + WORK_BUDGET_MS;

  if (action === 'health') {
    return json(200, { ok: true, has_service_key: serviceHeaders().apikey.length > 0 });
  }

  const authorized = await tokenOk(req.headers.get('x-push-token') ?? '');
  if (!authorized) return json(401, { error: 'unauthorized' });

  try {
    if (action === 'tick' || action === 'dispatch') {
      const push = await runPush(deadline);
      const receipts =
        Date.now() < deadline ? await runReceipts().catch((error) => ({ error: String(error).slice(0, 200) })) : { skipped: 'budget' };
      const pruned = Date.now() < deadline ? await rpc<number>('push_prune', { p_days: 7 }).catch(() => 0) : 0;
      const receiptsError =
        receipts && typeof receipts === 'object' && 'error' in receipts ? String(receipts.error) : null;
      await rpc('push_worker_note', {
        p_error: push.last_error ?? receiptsError,
        p_counts: push,
      }).catch(() => undefined);
      return json(200, { ok: true, push, receipts, pruned, ms: Date.now() - started });
    }

    if (action === 'receipts') {
      return json(200, { ok: true, receipts: await runReceipts() });
    }

    return json(400, { error: 'unknown_action' });
  } catch (error) {
    return json(500, { error: 'worker_failed', detail: String(error).slice(0, 400) });
  }
});
