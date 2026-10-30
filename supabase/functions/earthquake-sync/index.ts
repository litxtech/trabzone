// earthquake-sync: AFAD (birincil) ve USGS (ikincil) deprem kataloglarını
// sunucu tarafında çeker, doğrular, `earthquake_ingest` ile yazar; ardından
// bildirim dağıtımını ve Expo push gönderimini yürütür.
//
// İlkeler:
//   • İstemciler kaynaklara doğrudan gitmez; tek toplayıcı bu fonksiyondur.
//   • Kaynak hatasında veri yazılmaz, sahte kayıt/istatistik üretilmez;
//     yalnızca sağlık durumu ve geri çekilme süresi güncellenir.
//   • AFAD varsayılan 60 sn aralıkla sorgulanır (pg_cron + earthquake_tick).
//     Koşullar AFAD ile yazılı olarak doğrulanmadan aralık düşürülmemelidir.
//   • USGS 5 dakikada bir sorgulanır; AFAD erişilemiyorsa her turda (yedek).
//   • Yazma yetkisi yalnızca iç worker anahtarı veya yetkili admin oturumundadır.
import {
  AFAD_PAGE_LIMIT,
  afadUrl,
  backoffMs,
  chunk,
  expoMessage,
  parseAfad,
  parseUsgs,
  ticketToReport,
  usgsUrl,
  type ExpoTicket,
  type ParseResult,
  type ProviderKey,
  type PushItem,
} from '../_shared/earthquake.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-earthquake-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const USER_AGENT = 'Trabzone-EarthquakeCenter/1.0 (+https://www.trabzoneapp.com)';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const USGS_INTERVAL_MS = 5 * 60_000;
const WORK_BUDGET_MS = 40_000;

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

type AdminGate = 'ok' | 'denied' | 'rate_limited';

/**
 * Manuel işlemde yetkiyi kullanıcının kendi JWT'siyle doğrular ve işlemi audit
 * kaydına yazar (earthquake_admin_operation_log). Yetki yoksa hiçbir şey yazılmaz.
 */
async function adminOperation(
  authorization: string,
  operation: 'test' | 'sync' | 'backfill' | 'dispatch',
  provider: string | undefined,
  detail: Record<string, unknown>,
  reason: unknown,
): Promise<AdminGate> {
  const jwt = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return 'denied';
  const anon = env('SUPABASE_ANON_KEY') || env('SUPABASE_PUBLISHABLE_KEY') || '';
  if (!anon || jwt === anon) return 'denied';
  try {
    const response = await fetch(`${baseUrl()}/rest/v1/rpc/earthquake_admin_operation_log`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_operation: operation,
        p_provider: provider ?? null,
        p_detail: detail,
        p_reason: typeof reason === 'string' ? reason.slice(0, 500) : null,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return text.includes('rate_limited') ? 'rate_limited' : 'denied';
    }
    return (await response.json()) === true ? 'ok' : 'denied';
  } catch {
    return 'denied';
  }
}

function gateResponse(gate: AdminGate): Response | null {
  if (gate === 'ok') return null;
  return gate === 'rate_limited' ? json(429, { error: 'rate_limited' }) : json(401, { error: 'unauthorized' });
}

type SourceState = {
  key: ProviderKey;
  is_enabled: boolean;
  is_primary: boolean;
  health: string;
  next_retry_at: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
};

type WorkerState = {
  settings: { overlap_minutes: number; revision_sweep_hours: number; sync_enabled: boolean };
  sources: SourceState[];
};

type FetchOutcome =
  | { ok: true; parsed: ParseResult; httpStatus: number; latencyMs: number; attempts: number; sample: unknown }
  | { ok: false; code: string; message: string; httpStatus: number | null; latencyMs: number; attempts: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url: string): Promise<{ status: number; body: unknown; latencyMs: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { unparsable: text.slice(0, 300) };
    }
    return { status: response.status, body, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** Tek sayfa AFAD/USGS isteği; ağ hatası, 429 ve 5xx için üstel geri çekilmeli yeniden deneme. */
async function fetchWithRetry(url: string): Promise<
  | { ok: true; status: number; body: unknown; latencyMs: number; attempts: number }
  | { ok: false; code: string; message: string; status: number | null; latencyMs: number; attempts: number }
> {
  let last: { code: string; message: string; status: number | null; latencyMs: number } = {
    code: 'unknown',
    message: '',
    status: null,
    latencyMs: 0,
  };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await fetchJson(url);
      if (result.status >= 200 && result.status < 300) {
        return { ok: true, status: result.status, body: result.body, latencyMs: result.latencyMs, attempts: attempt };
      }
      last = {
        code: `http_${result.status}`,
        message: JSON.stringify(result.body).slice(0, 300),
        status: result.status,
        latencyMs: result.latencyMs,
      };
      if (result.status !== 429 && result.status < 500) break;
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      last = { code: aborted ? 'timeout' : 'network', message: String(error).slice(0, 300), status: null, latencyMs: FETCH_TIMEOUT_MS };
    }
    if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(attempt));
  }
  return { ok: false, ...last, attempts: MAX_ATTEMPTS };
}

async function fetchProvider(provider: ProviderKey, start: Date, end: Date): Promise<FetchOutcome> {
  if (provider === 'usgs') {
    const result = await fetchWithRetry(usgsUrl({ start, end }));
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message, httpStatus: result.status, latencyMs: result.latencyMs, attempts: result.attempts };
    }
    try {
      const parsed = parseUsgs(result.body);
      const features = (result.body as { features?: unknown[] }).features ?? [];
      return { ok: true, parsed, httpStatus: result.status, latencyMs: result.latencyMs, attempts: result.attempts, sample: features.slice(0, 2) };
    } catch (error) {
      return { ok: false, code: 'schema_mismatch', message: String(error).slice(0, 300), httpStatus: result.status, latencyMs: result.latencyMs, attempts: result.attempts };
    }
  }

  // AFAD: tek sorguda en fazla 1000 kayıt; dolarsa offset ile devam edilir.
  const merged: ParseResult = { records: [], rejected: [], received: 0 };
  let offset = 0;
  let latency = 0;
  let attempts = 0;
  let status = 0;
  let sample: unknown = null;
  for (let page = 0; page < 20; page += 1) {
    const result = await fetchWithRetry(afadUrl({ start, end, offset }));
    attempts += result.attempts;
    latency += result.latencyMs;
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message, httpStatus: result.status, latencyMs: latency, attempts };
    }
    status = result.status;
    let parsed: ParseResult;
    try {
      parsed = parseAfad(result.body);
    } catch (error) {
      return { ok: false, code: 'schema_mismatch', message: String(error).slice(0, 300), httpStatus: result.status, latencyMs: latency, attempts };
    }
    if (page === 0) sample = (result.body as unknown[]).slice(0, 2);
    merged.records.push(...parsed.records);
    merged.rejected.push(...parsed.rejected);
    merged.received += parsed.received;
    if (parsed.received < AFAD_PAGE_LIMIT) break;
    offset += AFAD_PAGE_LIMIT;
  }
  const unique = new Map(merged.records.map((record) => [record.source_event_id, record]));
  merged.records = [...unique.values()];
  return { ok: true, parsed: merged, httpStatus: status, latencyMs: latency, attempts, sample };
}

async function syncProvider(provider: ProviderKey, runKind: string, start: Date, end: Date) {
  const outcome = await fetchProvider(provider, start, end);
  if (!outcome.ok) {
    await rpc('earthquake_provider_failure', {
      p_provider: provider,
      p_run_kind: runKind,
      p_error_code: outcome.code,
      p_message: outcome.message,
      p_http_status: outcome.httpStatus,
      p_latency_ms: outcome.latencyMs,
      p_attempts: outcome.attempts,
      p_window_start: start.toISOString(),
      p_window_end: end.toISOString(),
    });
    return { provider, ok: false, error: outcome.code };
  }
  const results: Record<string, unknown>[] = [];
  // Büyük pencerelerde (geçmiş doldurma) RPC yükünü sınırlı tutmak için parça parça yazılır.
  const parts = chunk(outcome.parsed.records, 500);
  if (parts.length === 0) parts.push([]);
  for (const [index, part] of parts.entries()) {
    const result = await rpc<Record<string, unknown>>('earthquake_ingest', {
      p_provider: provider,
      p_records: part,
      p_run_kind: runKind,
      p_window_start: start.toISOString(),
      p_window_end: end.toISOString(),
      p_http_status: outcome.httpStatus,
      p_latency_ms: outcome.latencyMs,
      p_received: index === 0 ? outcome.parsed.received : part.length,
      p_pre_rejected: index === 0 ? outcome.parsed.rejected.length : 0,
      p_errors: index === 0 ? outcome.parsed.rejected.slice(0, 25) : [],
      p_sample: index === 0 ? { request_window: [start.toISOString(), end.toISOString()], records: outcome.sample } : null,
      p_attempts: outcome.attempts,
    });
    results.push(result);
  }
  return { provider, ok: true, received: outcome.parsed.received, rejected: outcome.parsed.rejected.length, results };
}

function inBackoff(source: SourceState, now: number) {
  return source.next_retry_at !== null && Date.parse(source.next_retry_at) > now;
}

async function runSync(runKind: 'scheduled' | 'manual', sweep: boolean, only?: ProviderKey) {
  const state = await rpc<WorkerState>('earthquake_worker_state');
  const now = Date.now();
  const end = new Date(now + 10 * 60_000);
  const windowMs = (sweep ? state.settings.revision_sweep_hours * 60 : state.settings.overlap_minutes) * 60_000;
  const start = new Date(now - windowMs);
  const runKindFinal = sweep && runKind === 'scheduled' ? 'sweep' : runKind;
  const afad = state.sources.find((source) => source.key === 'afad');
  const usgs = state.sources.find((source) => source.key === 'usgs');
  const out: unknown[] = [];

  let primaryHealthy = true;
  if (afad?.is_enabled && (!only || only === 'afad')) {
    if (runKind === 'scheduled' && inBackoff(afad, now)) {
      out.push({ provider: 'afad', skipped: 'backoff', next_retry_at: afad.next_retry_at });
      primaryHealthy = false;
    } else {
      const result = await syncProvider('afad', runKindFinal, start, end);
      primaryHealthy = result.ok;
      out.push(result);
    }
  } else if (!afad?.is_enabled) {
    primaryHealthy = false;
  }

  if (usgs?.is_enabled && (!only || only === 'usgs')) {
    const lastAttempt = usgs.last_attempt_at ? Date.parse(usgs.last_attempt_at) : 0;
    const due = runKind === 'manual' || sweep || !primaryHealthy || now - lastAttempt >= USGS_INTERVAL_MS;
    if (!due) {
      out.push({ provider: 'usgs', skipped: 'not_due' });
    } else if (runKind === 'scheduled' && inBackoff(usgs, now)) {
      out.push({ provider: 'usgs', skipped: 'backoff', next_retry_at: usgs.next_retry_at });
    } else {
      const usgsStart = sweep ? start : new Date(now - 6 * 3600_000);
      out.push(await syncProvider('usgs', runKindFinal, usgsStart, end));
    }
  }
  return out;
}

async function runFanout(deadline: number) {
  const steps: unknown[] = [];
  while (Date.now() < deadline) {
    const step = await rpc<Record<string, unknown>>('earthquake_fanout_step', { p_batch: 2000 });
    if (step?.idle) break;
    steps.push(step);
  }
  return steps;
}

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

async function runPush(deadline: number) {
  const totals = { claimed: 0, sent: 0, failed: 0, invalid: 0, retry: 0, paused: false };
  while (Date.now() < deadline) {
    const claim = await rpc<{ paused: boolean; items: PushItem[] }>('earthquake_push_claim', { p_limit: 500 });
    totals.paused = claim.paused;
    if (!claim.items?.length) break;
    totals.claimed += claim.items.length;
    for (const batch of chunk(claim.items, 100)) {
      let reports: Record<string, unknown>[];
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: expoHeaders(),
          body: JSON.stringify(batch.map(expoMessage)),
        });
        const payload = (await response.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
        if (!response.ok || !Array.isArray(payload?.data)) {
          const retryable = response.status === 429 || response.status >= 500;
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
        reports = batch.map((item) => ({
          delivery_id: item.delivery_id,
          ok: false,
          error: 'network',
          message: String(error).slice(0, 300),
          retryable: true,
        }));
      }
      const result = await rpc<Record<string, number>>('earthquake_push_report', { p_results: reports });
      totals.sent += result.sent ?? 0;
      totals.failed += result.failed ?? 0;
      totals.invalid += result.invalid ?? 0;
      totals.retry += result.retry ?? 0;
    }
  }
  return totals;
}

async function runReceipts() {
  const pending = await rpc<{ items: { delivery_id: string; ticket_id: string }[] }>('earthquake_push_receipts_pending', {
    p_limit: 300,
  });
  if (!pending.items?.length) return { checked: 0 };
  const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST',
    headers: expoHeaders(),
    body: JSON.stringify({ ids: pending.items.map((item) => item.ticket_id) }),
  });
  if (!response.ok) return { checked: 0, error: `http_${response.status}` };
  const payload = (await response.json()) as {
    data?: Record<string, { status: 'ok' | 'error'; message?: string; details?: { error?: string } }>;
  };
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
  const result = await rpc<Record<string, number>>('earthquake_push_receipts_report', { p_results: reports });
  return { checked: reports.length, ...result };
}

async function testProvider(provider: ProviderKey) {
  const now = Date.now();
  const outcome = await fetchProvider(provider, new Date(now - 24 * 3600_000), new Date(now + 10 * 60_000));
  if (!outcome.ok) {
    return { provider, ok: false, error: outcome.code, message: outcome.message, http_status: outcome.httpStatus, latency_ms: outcome.latencyMs };
  }
  return {
    provider,
    ok: true,
    http_status: outcome.httpStatus,
    latency_ms: outcome.latencyMs,
    received_24h: outcome.parsed.received,
    valid_24h: outcome.parsed.records.length,
    rejected: outcome.parsed.rejected.slice(0, 10),
    sample_normalized: outcome.parsed.records.slice(0, 3).map(({ raw: _raw, ...rest }) => rest),
    sample_raw: outcome.sample,
  };
}

async function backfill(provider: ProviderKey, days: number, offsetDays: number, deadline: number) {
  const now = Date.now() - offsetDays * 86_400_000;
  const results: unknown[] = [];
  // AFAD için gün gün (1000 kayıt sınırının altında kalmak için), USGS için 365 günlük pencereler.
  const stepDays = provider === 'afad' ? 1 : 365;
  for (let offset = 0; offset < days; offset += stepDays) {
    if (Date.now() > deadline) {
      results.push({ stopped: 'budget', next_offset_days: offsetDays + offset });
      break;
    }
    const end = new Date(now - offset * 86_400_000);
    const start = new Date(end.getTime() - Math.min(stepDays, days - offset) * 86_400_000);
    results.push({ start: start.toISOString(), end: end.toISOString(), ...(await syncProvider(provider, 'backfill', start, end)) });
    await sleep(provider === 'afad' ? 1500 : 1000);
  }
  return results;
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

  if (action === 'health') {
    return json(200, { ok: true, has_service_key: serviceHeaders().apikey.length > 0 });
  }

  const started = Date.now();
  const deadline = started + WORK_BUDGET_MS;
  const headerToken = req.headers.get('x-earthquake-token') ?? '';
  let worker = false;
  if (headerToken) {
    try {
      worker = (await rpc<boolean>('earthquake_worker_token_ok', { p_token: headerToken })) === true;
    } catch {
      worker = false;
    }
  }
  const authorization = req.headers.get('authorization') ?? '';
  const provider = body.provider === 'afad' || body.provider === 'usgs' ? (body.provider as ProviderKey) : undefined;

  try {
    if (action === 'tick') {
      if (!worker) return json(401, { error: 'unauthorized' });
      const sync = body.sync === true ? await runSync('scheduled', body.sweep === true) : [];
      const fanout = await runFanout(deadline);
      const push = await runPush(deadline);
      const receipts = Date.now() < deadline ? await runReceipts() : { skipped: 'budget' };
      return json(200, { ok: true, sync, fanout, push, receipts, ms: Date.now() - started });
    }

    if (action === 'sync') {
      if (!worker) {
        const denied = gateResponse(await adminOperation(authorization, 'sync', provider, { sweep: body.sweep === true }, body.reason));
        if (denied) return denied;
      }
      const sync = await runSync('manual', body.sweep === true, provider);
      const fanout = await runFanout(deadline);
      const push = await runPush(deadline);
      return json(200, { ok: true, sync, fanout, push, ms: Date.now() - started });
    }

    if (action === 'test') {
      if (!provider) return json(400, { error: 'provider_required' });
      if (!worker) {
        const denied = gateResponse(await adminOperation(authorization, 'test', provider, {}, body.reason));
        if (denied) return denied;
      }
      return json(200, await testProvider(provider));
    }

    if (action === 'backfill') {
      if (!provider) return json(400, { error: 'provider_required' });
      const maxDays = provider === 'afad' ? 14 : 3650;
      const days = Math.min(Math.max(Number(body.days) || 1, 1), maxDays);
      const offsetDays = Math.min(Math.max(Number(body.offset_days) || 0, 0), 36_500);
      if (!worker) {
        const denied = gateResponse(
          await adminOperation(authorization, 'backfill', provider, { days, offset_days: offsetDays }, body.reason),
        );
        if (denied) return denied;
      }
      return json(200, {
        ok: true,
        provider,
        days,
        offset_days: offsetDays,
        results: await backfill(provider, days, offsetDays, started + 120_000),
      });
    }

    if (action === 'dispatch') {
      if (!worker) {
        const denied = gateResponse(await adminOperation(authorization, 'dispatch', undefined, {}, body.reason));
        if (denied) return denied;
      }
      const fanout = await runFanout(deadline);
      const push = await runPush(deadline);
      return json(200, { ok: true, fanout, push, ms: Date.now() - started });
    }

    return json(400, { error: 'unknown_action' });
  } catch (error) {
    return json(500, { error: 'worker_failed', detail: String(error).slice(0, 400) });
  }
});
