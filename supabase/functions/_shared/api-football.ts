// API-Football v3 yardımcıları (saf fonksiyonlar; Deno ve Node testlerinde ortak).
//
// Sağlayıcı davranışları:
//   • Yanıt zarfı: { get, parameters, errors, results, paging, response }.
//     Hata durumunda da HTTP 200 dönebilir; `errors` dolu ise istek başarısızdır.
//     `errors` boş dizi ([]) veya { alan: mesaj } nesnesi olabilir.
//   • Günlük kota başlıkları: x-ratelimit-requests-limit / -remaining;
//     dakikalık: X-RateLimit-Limit / X-RateLimit-Remaining. /status kotadan düşmez.
//   • /fixtures?ids= en fazla 20 maç alır (ayırıcı "-") ve olay, kadro,
//     istatistik ve oyuncu verisini gömülü döndürür.
import { backoffMs, chunk, ticketToReport, type ExpoTicket } from './earthquake.ts';

export { backoffMs, chunk, ticketToReport, type ExpoTicket };

export const API_FOOTBALL_DEFAULT_BASE = 'https://v3.football.api-sports.io';
export const MAX_IDS_PER_REQUEST = 20;

export type ApiErrorKind = 'quota' | 'rate_limited' | 'auth' | 'plan' | 'params' | 'unknown';

export type EnvelopeResult =
  | { ok: true; response: unknown; results: number; paging: { current: number; total: number } | null }
  | { ok: false; kind: ApiErrorKind; messages: string[]; retryable: boolean };

/** `errors` alanını düz mesaj listesine çevirir. */
export function apiErrorMessages(errors: unknown): string[] {
  if (!errors) return [];
  if (Array.isArray(errors)) return errors.map((item) => String(item)).filter(Boolean);
  if (typeof errors === 'object') {
    return Object.entries(errors as Record<string, unknown>).map(([key, value]) => `${key}: ${String(value)}`);
  }
  return [String(errors)];
}

export function classifyApiErrors(errors: unknown): ApiErrorKind {
  const keys = errors && typeof errors === 'object' && !Array.isArray(errors) ? Object.keys(errors as object) : [];
  const text = apiErrorMessages(errors).join(' ').toLowerCase();
  if (keys.includes('requests') || /request limit|reached the limit|quota/.test(text)) return 'quota';
  if (keys.includes('ratelimit') || keys.includes('rateLimit') || /too many requests|rate limit/.test(text)) return 'rate_limited';
  if (keys.includes('token') || /application key|api key|apikey|not subscribed|account is suspended/.test(text)) return 'auth';
  if (keys.includes('plan') || /plan|do not have access|subscription/.test(text)) return 'plan';
  if (text) return 'params';
  return 'unknown';
}

export function parseEnvelope(httpStatus: number, body: unknown): EnvelopeResult {
  if (httpStatus === 429) return { ok: false, kind: 'rate_limited', messages: ['http_429'], retryable: true };
  if (httpStatus === 401 || httpStatus === 403) return { ok: false, kind: 'auth', messages: [`http_${httpStatus}`], retryable: false };
  if (httpStatus >= 500) return { ok: false, kind: 'unknown', messages: [`http_${httpStatus}`], retryable: true };
  if (!body || typeof body !== 'object') {
    return { ok: false, kind: 'unknown', messages: ['invalid_body'], retryable: httpStatus >= 500 };
  }
  const envelope = body as Record<string, unknown>;
  const messages = apiErrorMessages(envelope.errors);
  if (messages.length > 0) {
    const kind = classifyApiErrors(envelope.errors);
    return { ok: false, kind, messages, retryable: kind === 'rate_limited' };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { ok: false, kind: 'unknown', messages: [`http_${httpStatus}`], retryable: false };
  }
  if (!('response' in envelope)) {
    return { ok: false, kind: 'unknown', messages: ['missing_response'], retryable: false };
  }
  const paging = envelope.paging as { current?: unknown; total?: unknown } | undefined;
  return {
    ok: true,
    response: envelope.response,
    results: Number(envelope.results ?? (Array.isArray(envelope.response) ? envelope.response.length : 0)) || 0,
    paging:
      paging && Number.isFinite(Number(paging.current)) && Number.isFinite(Number(paging.total))
        ? { current: Number(paging.current), total: Number(paging.total) }
        : null,
  };
}

export type QuotaSnapshot = {
  limit_day?: number;
  remaining_day?: number;
  limit_minute?: number;
  remaining_minute?: number;
};

const headerNumber = (headers: Headers, name: string): number | undefined => {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

export function quotaFromHeaders(headers: Headers): QuotaSnapshot {
  const out: QuotaSnapshot = {};
  const limitDay = headerNumber(headers, 'x-ratelimit-requests-limit');
  const remainingDay = headerNumber(headers, 'x-ratelimit-requests-remaining');
  const limitMinute = headerNumber(headers, 'x-ratelimit-limit');
  const remainingMinute = headerNumber(headers, 'x-ratelimit-remaining');
  if (limitDay !== undefined) out.limit_day = limitDay;
  if (remainingDay !== undefined) out.remaining_day = remainingDay;
  if (limitMinute !== undefined) out.limit_minute = limitMinute;
  if (remainingMinute !== undefined) out.remaining_minute = remainingMinute;
  return out;
}

/**
 * /status yanıtından yalnızca plan ve kota bilgisi alınır; hesap sahibinin
 * adı ve e-postası saklanmaz.
 */
export function quotaFromStatus(response: unknown): {
  plan: string | null;
  limit_day: number | null;
  used_day: number | null;
  remaining_day: number | null;
  account: { plan: string | null; active: boolean | null; end: string | null };
} {
  const root = (Array.isArray(response) ? response[0] : response) as Record<string, unknown> | null;
  const subscription = (root?.subscription ?? {}) as Record<string, unknown>;
  const requests = (root?.requests ?? {}) as Record<string, unknown>;
  const limit = Number.isFinite(Number(requests.limit_day)) ? Number(requests.limit_day) : null;
  const used = Number.isFinite(Number(requests.current)) ? Number(requests.current) : null;
  const plan = typeof subscription.plan === 'string' ? subscription.plan : null;
  return {
    plan,
    limit_day: limit,
    used_day: used,
    remaining_day: limit !== null && used !== null ? Math.max(limit - used, 0) : null,
    account: {
      plan,
      active: typeof subscription.active === 'boolean' ? subscription.active : null,
      end: typeof subscription.end === 'string' ? subscription.end : null,
    },
  };
}

export function buildUrl(base: string, path: string, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function idsParam(ids: number[]): string {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, MAX_IDS_PER_REQUEST).join('-');
}

/** /fixtures yanıtındaki maç kimlikleri ve bitmiş olanlar (son doğrulama için). */
export function finishedFixtureIds(response: unknown): number[] {
  if (!Array.isArray(response)) return [];
  const finished = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
  return response
    .filter((item) => finished.has(String((item as { fixture?: { status?: { short?: unknown } } })?.fixture?.status?.short ?? '')))
    .map((item) => Number((item as { fixture?: { id?: unknown } }).fixture?.id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export type SportsPushItem = {
  delivery_id: string;
  token: string;
  platform: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  kind: string;
  sound: boolean;
  is_test: boolean;
};

const TIME_CRITICAL = new Set(['goal_for', 'goal_against', 'red_card', 'kickoff', 'correction']);

export function sportsExpoMessage(item: SportsPushItem) {
  const critical = TIME_CRITICAL.has(item.kind);
  return {
    to: item.token,
    title: item.title,
    body: item.body,
    data: item.data ?? {},
    sound: item.sound ? 'default' : null,
    priority: critical ? 'high' : 'default',
    channelId: 'sports',
    ttl: item.is_test ? 600 : critical ? 900 : 3600,
  };
}
