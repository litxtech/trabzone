/**
 * LiteAPI HTTP istemcisi.
 *
 * - X-API-Key yalnızca bu katmanda eklenir.
 * - İstekler tek kuyrukta sıraya alınır ve saniyede `requestsPerSecond` sınırına
 *   uyar; sağlayıcının hız limitine takılmamak için gereklidir.
 * - 429 / 5xx yanıtlarında üstel geri çekilmeyle en fazla `maxRetries` deneme.
 * - Yanıt gövdesi JSON değilse anlaşılır bir hata üretilir.
 */

const { apiKey, config } = require('./config');

class LiteApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'LiteApiError';
    this.status = options.status ?? null;
    this.code = options.code ?? 'liteapi_error';
    this.body = options.body ?? null;
    this.url = options.url ?? null;
  }
}

const state = {
  lastRequestAt: 0,
  queue: Promise.resolve(),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** İstekleri seri hale getirir ve iki istek arasında minimum aralık bırakır. */
function schedule(task) {
  const run = state.queue.then(async () => {
    const minInterval = Math.ceil(1000 / config.requestsPerSecond);
    const wait = state.lastRequestAt + minInterval - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    try {
      return await task();
    } finally {
      state.lastRequestAt = Date.now();
    }
  });
  // Kuyruk bir hata yüzünden kilitlenmesin.
  state.queue = run.catch(() => undefined);
  return run;
}

function buildUrl(base, path, query) {
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function retryable(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 4000) };
  }
}

function describe(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  const candidates = [payload.message, payload.error, payload.detail, payload.title];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method
 * @param {string} base
 * @param {string} path
 * @param {{query?: object, body?: object, signal?: AbortSignal}} options
 */
async function request(method, base, path, options = {}) {
  const key = apiKey();
  if (!key) {
    throw new LiteApiError('LITEAPI_API_KEY tanımlı değil.', {
      code: 'not_configured',
      url: path,
    });
  }

  const url = buildUrl(base, path, options.query);
  let lastError = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    if (attempt > 0) {
      await sleep(Math.min(8_000, 400 * 2 ** attempt));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
      const response = await schedule(() =>
        fetch(url, {
          method,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-API-Key': key,
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        }),
      );

      const payload = await parseBody(response);

      if (!response.ok) {
        const error = new LiteApiError(
          describe(payload) || `LiteAPI ${response.status} yanıtı`,
          {
            status: response.status,
            code:
              response.status === 401 || response.status === 403
                ? 'unauthorized'
                : response.status === 429
                  ? 'rate_limited'
                  : response.status === 400
                    ? 'invalid_request'
                    : 'provider_error',
            body: payload,
            url,
          },
        );
        if (retryable(response.status) && attempt < config.maxRetries) {
          lastError = error;
          continue;
        }
        throw error;
      }

      return payload;
    } catch (cause) {
      if (cause instanceof LiteApiError) {
        throw cause;
      }
      const aborted = cause && (cause.name === 'AbortError' || cause.code === 'ABORT_ERR');
      lastError = new LiteApiError(
        aborted ? 'LiteAPI isteği zaman aşımına uğradı.' : 'LiteAPI bağlantısı kurulamadı.',
        {
          code: aborted ? 'timeout' : 'network',
          url,
        },
      );
      if (!aborted && attempt >= config.maxRetries) {
        throw lastError;
      }
      if (aborted) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError || new LiteApiError('LiteAPI isteği tamamlanamadı.');
}

async function listHotels(query) {
  return request('GET', config.contentBaseUrl, '/data/hotels', { query });
}

async function getHotelDetail(hotelId) {
  return request('GET', config.contentBaseUrl, '/data/hotel', {
    query: { hotelId },
  });
}

async function searchRates(body) {
  return request('POST', config.contentBaseUrl, '/hotels/rates', { body });
}

async function bookRate(body) {
  return request('POST', config.bookingBaseUrl, '/rates/book', { body });
}

module.exports = {
  LiteApiError,
  listHotels,
  getHotelDetail,
  searchRates,
  bookRate,
  request,
};
