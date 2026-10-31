/**
 * LiteAPI (Nuitee Connect) sunucu yapılandırması.
 *
 * API anahtarı yalnızca sunucu ortamında (`LITEAPI_API_KEY`) okunur. Bu modül
 * istemci paketine asla import edilmez; Expo tarafı yalnızca `/api/liteapi-*`
 * uç noktalarıyla konuşur.
 */

const CONTENT_BASE_URL =
  process.env.LITEAPI_CONTENT_BASE_URL || 'https://api.liteapi.travel/v3.0';
const BOOKING_BASE_URL =
  process.env.LITEAPI_BOOKING_BASE_URL || 'https://book.liteapi.travel/v3.0';

function intEnv(name, fallback, min, max) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  const value = Math.trunc(raw);
  return Math.min(Math.max(value, min), max);
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

const TRABZON = Object.freeze({
  countryCode: 'TR',
  cityName: 'Trabzon',
  province: 'Trabzon',
  // Trabzon kent merkezi. Sağlayıcı yalnızca `cityName` ile ilçe otellerini
  // kaçırabildiği için yarıçap taraması ikinci bir kaynak olarak kullanılır.
  centerLat: 41.0027,
  centerLng: 39.7168,
  radiusKm: intEnv('LITEAPI_TRABZON_RADIUS_KM', 90, 10, 150),
});

const config = {
  contentBaseUrl: CONTENT_BASE_URL.replace(/\/+$/, ''),
  bookingBaseUrl: BOOKING_BASE_URL.replace(/\/+$/, ''),
  trabzon: TRABZON,

  /** Sayfa başına sağlayıcı kaydı (LiteAPI üst sınırı 100). */
  pageSize: intEnv('LITEAPI_PAGE_SIZE', 100, 1, 100),
  /** Tek bir taramada çekilecek en fazla sayfa. */
  maxPages: intEnv('LITEAPI_MAX_PAGES', 12, 1, 50),
  /** Sunucu tarafı istek hızı (saniye). Sağlayıcı limitlerine saygı için düşük tutulur. */
  requestsPerSecond: intEnv('LITEAPI_REQUESTS_PER_SECOND', 4, 1, 20),
  requestTimeoutMs: intEnv('LITEAPI_TIMEOUT_MS', 20_000, 3_000, 60_000),
  maxRetries: intEnv('LITEAPI_MAX_RETRIES', 2, 0, 4),
  /** Liste kaydı yetersizse otel detayı da çekilir (Content API, ücretsiz). */
  fetchDetail: boolEnv('LITEAPI_SYNC_DETAIL', true),
  /** İlçe otellerini yakalamak için yarıçap taraması. */
  radiusScan: boolEnv('LITEAPI_RADIUS_SCAN', true),
  /** Tur fiyat önbelleği (saniye). Gereksiz ücretli sorguları engeller. */
  rateCacheSeconds: intEnv('LITEAPI_RATE_CACHE_SECONDS', 300, 30, 3600),
  /** Bir tur fiyat yanıtında dönen en fazla teklif. */
  maxOffers: intEnv('LITEAPI_MAX_OFFERS', 40, 1, 100),

  defaultCurrency: (process.env.LITEAPI_CURRENCY || 'TRY').toUpperCase().slice(0, 3),
  guestNationality: (process.env.LITEAPI_GUEST_NATIONALITY || 'TR').toUpperCase().slice(0, 2),

  /**
   * Canlı rezervasyon iki ayrı onay gerektirir:
   *   1) Sunucu ortamında `LITEAPI_BOOKING_ENABLED=true`
   *   2) İşletme sahibinin açık onayı `LITEAPI_BOOKING_OWNER_APPROVED=true`
   * Ayrıca veritabanındaki `acc_provider_settings.booking_enabled` açık olmalı.
   * Varsayılan olarak kapalıdır; POST /rates/book çağrılmaz.
   */
  bookingEnabled:
    boolEnv('LITEAPI_BOOKING_ENABLED', false) &&
    boolEnv('LITEAPI_BOOKING_OWNER_APPROVED', false),
  bookingOwnerApproved: boolEnv('LITEAPI_BOOKING_OWNER_APPROVED', false),
};

function apiKey() {
  return (process.env.LITEAPI_API_KEY || '').trim();
}

function isConfigured() {
  return apiKey().length > 0;
}

module.exports = { config, apiKey, isConfigured, TRABZON };
