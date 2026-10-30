// sports-sync: Trabzonspor maç verisini API-Football v3'ten sunucu tarafında
// çeker ve `sports_ingest_*` RPC'leriyle yazar; ardından maç bildirimlerini
// dağıtır ve Expo push gönderir.
//
// İlkeler:
//   • API anahtarı yalnızca bu fonksiyonun ortamındadır (API_FOOTBALL_KEY
//     secret'ı). İstemciye, panele veya loglara asla yazılmaz.
//   • Hangi işin ne zaman çalışacağına veritabanı karar verir
//     (sports_worker_plan); bu fonksiyon yalnızca HTTP, zarf ve kota kontrolü
//     yapar. Normalizasyon/tekilleştirme/revizyon SQL tarafındadır.
//   • Kaynak hatasında veri yazılmaz, sahte veri üretilmez; hata ve kota
//     durumu sports_worker_report ile panele yansır.
//   • Yazma yetkisi yalnızca iç worker anahtarı (pg_cron) veya kendi JWT'si ile
//     yetkisi doğrulanan admin oturumundadır.
import {
  API_FOOTBALL_DEFAULT_BASE,
  backoffMs,
  buildUrl,
  chunk,
  finishedFixtureIds,
  idsParam,
  MAX_IDS_PER_REQUEST,
  parseEnvelope,
  quotaFromHeaders,
  quotaFromStatus,
  sportsExpoMessage,
  ticketToReport,
  type ExpoTicket,
  type QuotaSnapshot,
  type SportsPushItem,
} from '../_shared/api-football.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sports-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FETCH_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;
const WORK_BUDGET_MS = 42_000;

const env = (key: string) => Deno.env.get(key) ?? '';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });

const baseUrl = () => (env('SUPABASE_URL') || '').replace(/\/$/, '');

function serviceHeaders(): Record<string, string> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function rpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${baseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify(params),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`rpc_${name}_${response.status}:${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

type Permission = 'sports.view' | 'sports.manage' | 'sports.data' | 'sports.notify';

type AdminAuth = { ok: true } | { ok: false; status: number; error: string };

/**
 * Admin yetkisini kullanıcının kendi JWT'siyle doğrular ve işlemi gerekçesiyle
 * denetim kaydına yazar (`sports_admin_worker_authorize`).
 */
async function adminAuthorize(
  authorization: string,
  permission: Permission,
  action: string,
  reason: unknown,
  detail: Record<string, unknown>,
): Promise<AdminAuth> {
  const jwt = authorization.replace(/^Bearer\s+/i, '').trim();
  const anon = env('SUPABASE_ANON_KEY') || env('SUPABASE_PUBLISHABLE_KEY') || '';
  if (!jwt || !anon || jwt === anon) return { ok: false, status: 401, error: 'unauthorized' };
  try {
    const response = await fetch(`${baseUrl()}/rest/v1/rpc/sports_admin_worker_authorize`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_permission: permission,
        p_action: action,
        p_reason: typeof reason === 'string' ? reason.slice(0, 500) : null,
        p_detail: detail,
      }),
    });
    if (response.ok) return (await response.json()) === true ? { ok: true } : { ok: false, status: 401, error: 'unauthorized' };
    const text = await response.text();
    if (/sports_reason_required/.test(text)) return { ok: false, status: 400, error: 'reason_required' };
    if (/rate_limited/.test(text)) return { ok: false, status: 429, error: 'rate_limited' };
    return { ok: false, status: 401, error: 'unauthorized' };
  } catch {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
}

type Plan = {
  team_id: number | null;
  season: number | null;
  team_search: string;
  api_base_url: string;
  fixtures: number[] | null;
  verify_ids: number[] | null;
  schedule: boolean;
  standings: { league: number; season: number }[];
  leagues: boolean;
  squad: boolean;
  teamstats: { league: number; season: number }[];
  discover: boolean;
  status: boolean;
  dispatch: boolean;
  quota_blocked: boolean;
};

type SyncLog = {
  job: string;
  endpoint: string | null;
  params: Record<string, unknown>;
  status: 'ok' | 'error' | 'skipped' | 'quota';
  http_status: number | null;
  results: number | null;
  duration_ms: number | null;
  remaining: number | null;
  error: string | null;
  api_errors: unknown;
  counted: boolean;
};

class Run {
  readonly id = crypto.randomUUID();
  readonly logs: SyncLog[] = [];
  readonly quota: QuotaSnapshot & { plan?: string | null; account?: unknown } = {};
  quotaExhausted = false;
  authFailed = false;
  readonly key = env('API_FOOTBALL_KEY');
  constructor(readonly trigger: string, readonly deadline: number, readonly base: string) {}

  get keyMissing() {
    return this.key.trim() === '';
  }

  canCall() {
    return !this.keyMissing && !this.quotaExhausted && !this.authFailed && Date.now() < this.deadline;
  }

  skip(job: string, endpoint: string | null, reason: string) {
    this.logs.push({
      job, endpoint, params: {}, status: 'skipped', http_status: null, results: null, duration_ms: null,
      remaining: this.quota.remaining_day ?? null, error: reason, api_errors: null, counted: false,
    });
  }

  /** Tek API isteği; ağ hatası, 429 ve 5xx için sınırlı yeniden deneme. Her deneme kotaya sayılır. */
  async get(job: string, path: string, params: Record<string, string | number>, counted = true) {
    if (!this.canCall()) {
      this.skip(job, path, this.keyMissing ? 'api_key_missing' : this.quotaExhausted ? 'quota_exhausted'
        : this.authFailed ? 'auth_failed' : 'time_budget');
      return null;
    }
    const url = buildUrl(this.base, path, params);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let httpStatus: number | null = null;
      try {
        const response = await fetch(url, {
          headers: { 'x-apisports-key': this.key, Accept: 'application/json' },
          signal: controller.signal,
        });
        httpStatus = response.status;
        Object.assign(this.quota, quotaFromHeaders(response.headers));
        const text = await response.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
        const parsed = parseEnvelope(response.status, body);
        const log: SyncLog = {
          job, endpoint: path, params, status: 'ok', http_status: response.status,
          results: parsed.ok ? parsed.results : null, duration_ms: Date.now() - started,
          remaining: this.quota.remaining_day ?? null, error: null, api_errors: null, counted,
        };
        if (parsed.ok) {
          this.logs.push(log);
          return parsed;
        }
        log.status = parsed.kind === 'quota' ? 'quota' : 'error';
        log.error = `${parsed.kind}: ${parsed.messages.join(' | ')}`.slice(0, 500);
        log.api_errors = parsed.messages.slice(0, 5);
        this.logs.push(log);
        if (parsed.kind === 'quota') this.quotaExhausted = true;
        if (parsed.kind === 'auth') this.authFailed = true;
        if (!parsed.retryable || attempt === MAX_ATTEMPTS) return null;
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        this.logs.push({
          job, endpoint: path, params, status: 'error', http_status: httpStatus, results: null,
          duration_ms: Date.now() - started, remaining: this.quota.remaining_day ?? null,
          error: aborted ? 'timeout' : `network: ${String(error).slice(0, 200)}`, api_errors: null, counted,
        });
        if (attempt === MAX_ATTEMPTS) return null;
      } finally {
        clearTimeout(timer);
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
    }
    return null;
  }

  async ingestFailure(job: string, error: unknown) {
    this.logs.push({
      job, endpoint: null, params: {}, status: 'error', http_status: null, results: null, duration_ms: null,
      remaining: this.quota.remaining_day ?? null, error: `ingest: ${String(error).slice(0, 400)}`, api_errors: null,
      counted: false,
    });
  }
}

async function runStatus(run: Run) {
  const result = await run.get('status', 'status', {}, false);
  if (!result) return null;
  const status = quotaFromStatus(result.response);
  run.quota.plan = status.plan;
  run.quota.account = status.account;
  if (status.limit_day !== null) run.quota.limit_day = status.limit_day;
  if (status.remaining_day !== null) run.quota.remaining_day = status.remaining_day;
  return status;
}

async function runPlan(run: Run, plan: Plan) {
  const out: Record<string, unknown> = {};
  let teamId = plan.team_id;
  let season = plan.season;
  const verified: number[] = [];

  if (plan.status) out.status = await runStatus(run);

  // Canlı/ön maç verisi en öncelikli iştir.
  const fixtureIds = (plan.fixtures ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (fixtureIds.length) {
    const results: unknown[] = [];
    for (const ids of chunk(fixtureIds, MAX_IDS_PER_REQUEST)) {
      const result = await run.get('fixtures_live', 'fixtures', { ids: idsParam(ids) });
      if (!result) {
        await rpc('sports_fixture_sync_failed', { p_ids: ids, p_error: run.logs.at(-1)?.error ?? 'fetch_failed' }).catch(() => null);
        continue;
      }
      try {
        results.push(await rpc('sports_ingest_fixtures', { p_items: result.response, p_run: { kind: 'live', run_id: run.id } }));
        const verifySet = new Set((plan.verify_ids ?? []).map(Number));
        verified.push(...finishedFixtureIds(result.response).filter((id) => verifySet.has(id)));
      } catch (error) {
        await run.ingestFailure('fixtures_live', error);
      }
    }
    out.fixtures = results;
  }

  if (plan.discover) {
    const result = await run.get('discover', 'teams', { search: plan.team_search || 'Trabzonspor' });
    if (result) {
      try {
        const discovered = await rpc<{ team_id: number | null; candidates: unknown[] }>('sports_ingest_team_candidates', {
          p_response: result.response,
        });
        out.discover = discovered;
        teamId = discovered.team_id ?? teamId;
      } catch (error) {
        await run.ingestFailure('discover', error);
      }
    }
  }

  // Takım ilk kez doğrulandıysa turnuvalar ve fikstür aynı turda çekilir.
  const firstSetup = plan.team_id === null && teamId !== null;

  if (teamId && (plan.leagues || firstSetup)) {
    const result = await run.get('leagues', 'leagues', { team: teamId, current: 'true' });
    if (result) {
      try {
        const leagues = await rpc<{ season: number | null }>('sports_ingest_leagues', { p_response: result.response });
        out.leagues = leagues;
        season = leagues.season ?? season;
      } catch (error) {
        await run.ingestFailure('leagues', error);
      }
    }
  }

  if (teamId && season && (plan.schedule || firstSetup)) {
    const result = await run.get('schedule', 'fixtures', { team: teamId, season });
    if (result) {
      try {
        out.schedule = await rpc('sports_ingest_fixtures', {
          p_items: result.response,
          p_run: { kind: 'schedule', run_id: run.id },
        });
      } catch (error) {
        await run.ingestFailure('schedule', error);
      }
    }
  }

  for (const item of plan.standings ?? []) {
    const result = await run.get('standings', 'standings', { league: item.league, season: item.season });
    if (!result) continue;
    try {
      await rpc('sports_ingest_standings', { p_league: item.league, p_season: item.season, p_response: result.response });
    } catch (error) {
      await run.ingestFailure('standings', error);
    }
  }

  if (teamId && plan.squad) {
    const result = await run.get('squad', 'players/squads', { team: teamId });
    if (result) {
      try {
        await rpc('sports_ingest_squad', { p_team: teamId, p_response: result.response });
      } catch (error) {
        await run.ingestFailure('squad', error);
      }
    }
  }

  if (teamId) {
    for (const item of plan.teamstats ?? []) {
      const result = await run.get('teamstats', 'teams/statistics', { league: item.league, season: item.season, team: teamId });
      if (!result) continue;
      try {
        await rpc('sports_ingest_team_statistics', {
          p_league: item.league, p_season: item.season, p_team: teamId, p_response: result.response,
        });
      } catch (error) {
        await run.ingestFailure('teamstats', error);
      }
    }
  }

  return { out, verified };
}

async function report(run: Run, verified: number[], error?: string) {
  const quota: Record<string, unknown> = {};
  if (run.quota.limit_day !== undefined) quota.limit_day = run.quota.limit_day;
  if (run.quota.remaining_day !== undefined) quota.remaining_day = run.quota.remaining_day;
  if (run.quota.plan !== undefined) quota.plan = run.quota.plan;
  if (run.quota.account !== undefined) quota.account = run.quota.account;
  try {
    await rpc('sports_worker_report', {
      p_report: {
        run_id: run.id,
        trigger: run.trigger,
        logs: run.logs,
        quota,
        key_missing: run.keyMissing,
        verified_ids: verified,
        error: error ?? null,
      },
    });
  } catch {
    // Rapor yazılamazsa kilit 55 sn sonra kendiliğinden düşer.
  }
}

async function runFanout(deadline: number) {
  const steps: unknown[] = [];
  while (Date.now() < deadline) {
    const step = await rpc<Record<string, unknown>>('sports_fanout_step', { p_batch: 2000 });
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
  const totals = { claimed: 0, sent: 0, failed: 0, invalid: 0, retry: 0 };
  while (Date.now() < deadline) {
    const claim = await rpc<{ items: SportsPushItem[] }>('sports_push_claim', { p_limit: 500 });
    if (!claim.items?.length) break;
    totals.claimed += claim.items.length;
    for (const batch of chunk(claim.items, 100)) {
      let reports: Record<string, unknown>[];
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: expoHeaders(),
          body: JSON.stringify(batch.map(sportsExpoMessage)),
        });
        const payload = (await response.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
        if (!response.ok || !Array.isArray(payload?.data)) {
          const retryable = response.status === 429 || response.status >= 500;
          reports = batch.map((item) => ({
            delivery_id: item.delivery_id, ok: false, error: `http_${response.status}`,
            message: JSON.stringify(payload).slice(0, 300), retryable,
          }));
        } else {
          reports = batch.map((item, index) => ticketToReport(item.delivery_id, payload.data?.[index]));
        }
      } catch (error) {
        reports = batch.map((item) => ({
          delivery_id: item.delivery_id, ok: false, error: 'network', message: String(error).slice(0, 300), retryable: true,
        }));
      }
      const result = await rpc<Record<string, number>>('sports_push_report', { p_results: reports });
      totals.sent += result.sent ?? 0;
      totals.failed += result.failed ?? 0;
      totals.invalid += result.invalid ?? 0;
      totals.retry += result.retry ?? 0;
    }
  }
  return totals;
}

async function runReceipts() {
  const pending = await rpc<{ items: { delivery_id: string; ticket_id: string }[] }>('sports_push_receipts_pending', { p_limit: 300 });
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
      return { delivery_id: item.delivery_id, status: receipt.status, error: receipt.details?.error ?? null, message: receipt.message ?? null };
    });
  if (!reports.length) return { checked: 0 };
  return { checked: reports.length, ...(await rpc<Record<string, number>>('sports_push_receipts_report', { p_results: reports })) };
}

async function dispatch(deadline: number) {
  const fanout = await runFanout(deadline);
  const push = await runPush(deadline);
  const receipts = Date.now() < deadline ? await runReceipts().catch((error) => ({ error: String(error) })) : { skipped: 'budget' };
  return { fanout, push, receipts };
}

const ADMIN_JOBS = new Set(['status', 'discover', 'leagues', 'schedule', 'fixtures', 'standings', 'squad', 'teamstats']);

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
    return json(200, { ok: true, has_service_key: serviceHeaders().apikey.length > 0, has_api_key: env('API_FOOTBALL_KEY').trim() !== '' });
  }

  const started = Date.now();
  const deadline = started + WORK_BUDGET_MS;
  const headerToken = req.headers.get('x-sports-token') ?? '';
  let worker = false;
  if (headerToken) {
    try {
      worker = (await rpc<boolean>('sports_worker_token_ok', { p_token: headerToken })) === true;
    } catch {
      worker = false;
    }
  }
  const authorization = req.headers.get('authorization') ?? '';
  const requireAdmin = async (permission: Permission, detail: Record<string, unknown> = {}): Promise<AdminAuth> =>
    worker ? { ok: true } : await adminAuthorize(authorization, permission, action, body.reason, detail);
  const denied = (auth: AdminAuth) => (auth.ok ? null : json(auth.status, { error: auth.error }));

  try {
    if (action === 'tick') {
      if (!worker) return json(401, { error: 'unauthorized' });
      const plan = body.plan as Plan | undefined;
      if (!plan || typeof plan !== 'object') return json(400, { error: 'plan_required' });
      const run = new Run('cron', deadline - 8_000, plan.api_base_url || API_FOOTBALL_DEFAULT_BASE);
      const { out, verified } = await runPlan(run, plan);
      await report(run, verified);
      const notifications = plan.dispatch || run.logs.some((log) => log.job === 'fixtures_live' && log.status === 'ok')
        ? await dispatch(deadline)
        : { skipped: 'idle' };
      return json(200, { ok: true, run_id: run.id, result: out, notifications, ms: Date.now() - started });
    }

    if (action === 'run') {
      const jobs = Array.isArray(body.jobs) ? body.jobs.map(String).filter((job) => ADMIN_JOBS.has(job)) : [];
      if (!jobs.length) return json(400, { error: 'jobs_required' });
      const rejected = denied(await requireAdmin('sports.manage', { jobs }));
      if (rejected) return rejected;
      // Plan, zorlanan işlerle birlikte vadesi gelmiş işleri de içerir ve zaman damgalarını
      // ilerletir; bu yüzden planın tamamı çalıştırılır.
      const plan = await rpc<Plan>('sports_worker_force_plan', { p_jobs: jobs });
      const run = new Run('admin', deadline - 5_000, plan.api_base_url || API_FOOTBALL_DEFAULT_BASE);
      const { out, verified } = await runPlan(run, plan);
      await report(run, verified);
      return json(200, {
        ok: !run.logs.some((log) => log.status === 'error'),
        key_missing: run.keyMissing,
        result: out,
        logs: run.logs.map(({ params: _params, ...log }) => log),
        quota: run.quota,
      });
    }

    if (action === 'test') {
      const rejected = denied(await requireAdmin('sports.view'));
      if (rejected) return rejected;
      const run = new Run('admin_test', deadline, API_FOOTBALL_DEFAULT_BASE);
      if (run.keyMissing) {
        await report(run, [], 'API_FOOTBALL_KEY secret tanımlı değil');
        return json(200, { ok: false, key_missing: true });
      }
      const status = await runStatus(run);
      await report(run, []);
      const last = run.logs.at(-1);
      return json(200, {
        ok: status !== null,
        plan: status?.plan ?? null,
        active: status?.account.active ?? null,
        subscription_end: status?.account.end ?? null,
        limit_day: status?.limit_day ?? null,
        used_day: status?.used_day ?? null,
        remaining_day: status?.remaining_day ?? null,
        latency_ms: last?.duration_ms ?? null,
        error: status ? null : last?.error ?? 'unknown',
      });
    }

    if (action === 'resync') {
      const fixtureId = Number(body.fixture_id);
      if (!Number.isInteger(fixtureId) || fixtureId <= 0) return json(400, { error: 'fixture_id_required' });
      const rejected = denied(await requireAdmin('sports.data', { fixture_id: fixtureId }));
      if (rejected) return rejected;
      const run = new Run('admin_resync', deadline, API_FOOTBALL_DEFAULT_BASE);
      const result = await run.get('resync', 'fixtures', { id: fixtureId });
      let ingest: unknown = null;
      if (result) {
        try {
          ingest = await rpc('sports_ingest_fixtures', { p_items: result.response, p_run: { kind: 'resync', run_id: run.id } });
        } catch (error) {
          await run.ingestFailure('resync', error);
        }
      }
      await report(run, []);
      const notifications = await dispatch(deadline);
      return json(200, { ok: result !== null, key_missing: run.keyMissing, ingest, notifications, error: result ? null : run.logs.at(-1)?.error });
    }

    if (action === 'dispatch') {
      const rejected = denied(await requireAdmin('sports.notify'));
      if (rejected) return rejected;
      return json(200, { ok: true, ...(await dispatch(deadline)) });
    }

    return json(400, { error: 'unknown_action' });
  } catch (error) {
    return json(500, { error: 'worker_failed', detail: String(error).slice(0, 400) });
  }
});
