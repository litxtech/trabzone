/**
 * LiteAPI (Nuitee Connect) sunucu yapılandırması.
 *
 * API anahtarı yalnızca sunucu ortamında (`LITEAPI_API_KEY`) okunur. Bu modül
 * istemci paketine asla import edilmez; Expo tarafı yalnızca `/api/liteapi-*`
 * uç noktalarıyla konuşur.
 */

/**
 * Ortam değişkeni okuyucuları.
 *
 * Değerler panolardan/CLI'dan yapıştırıldığında sonunda `\n` veya `\r`
 * kalabiliyor. Bu, `"true\r"` gibi değerlerin sessizce `false` sayılmasına ve
 * bozuk bir ödeme yöntemi (`"CREDIT\r"`) gönderilmesine yol açtı; tüm değerler
 * tek yerde kırpılır.
 */
function envString(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  return String(raw).replace(/[\r\n\t]+/g, '').trim();
}

function intEnv(name, fallback, min, max) {
  const raw = Number(envString(name));
  if (!Number.isFinite(raw)) return fallback;
  const value = Math.trunc(raw);
  return Math.min(Math.max(value, min), max);
}

function boolEnv(name, fallback) {
  const raw = envString(name);
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

const CONTENT_BASE_URL = envString('LITEAPI_CONTENT_BASE_URL') || 'https://api.liteapi.travel/v3.0';
const BOOKING_BASE_URL = envString('LITEAPI_BOOKING_BASE_URL') || 'https://book.liteapi.travel/v3.0';

/**
 * Misafir uyruğu = Nuitee'de **pazar**. Müsaitlik ve fiyat bu değere göre
 * değişiyor: aynı tesis/tarih `TR` pazarında "no availability" dönerken `US`
 * pazarında satılabilir olabiliyor. Trabzon'daki sağlayıcı tesislerinin büyük
 * bölümü TR pazarında boş döndüğü için sıralı pazar denemesi yapılır; para
 * birimi değişmez (LITEAPI_CURRENCY neyse o kalır).
 */
const GUEST_NATIONALITIES = (() => {
  const primary = (envString('LITEAPI_GUEST_NATIONALITY') || 'TR').toUpperCase().slice(0, 2);
  const fallbacks = (envString('LITEAPI_GUEST_NATIONALITY_FALLBACKS') || 'US')
    .split(',')
    .map((entry) => entry.trim().toUpperCase().slice(0, 2))
    .filter(Boolean);
  return [primary, ...fallbacks].filter(
    (value, index, list) => value && list.indexOf(value) === index,
  );
})();

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

  defaultCurrency: (envString('LITEAPI_CURRENCY') || 'TRY').toUpperCase().slice(0, 3),
  guestNationality: GUEST_NATIONALITIES[0] || 'TR',
  /** Fiyat sorgusunda denenecek pazar sırası (birincil + yedek). */
  guestNationalities: GUEST_NATIONALITIES,
  /**
   * Fiyat sorgusunda denenecek en fazla pazar sayısı. Ölçümde üçüncü/dördüncü
   * pazar (DE, GB) ek tesis getirmedi; her ek pazar gecikmeyi artırdığı için
   * iki pazar yeterli.
   */
  rateMarkets: GUEST_NATIONALITIES.slice(0, 2),

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
  /**
   * Ön ödemeli (NUITEE_PAY) rezervasyonda platformun sağlayıcıya ödeme yöntemi.
   * Varsayılan `CREDIT`: LiteAPI hesap bakiyesinden ödeme (NUITEE_PAY). Kartla
   * ödeme yalnızca PCI uç noktası + kart bilgisi gerektirdiği için kullanılmaz.
   * Sağlayıcı farklı bir yöntem dönerse ortam değişkeniyle değiştirilebilir.
   */
  prepaidPaymentMethod: (envString('LITEAPI_PREPAID_PAYMENT_METHOD') || 'CREDIT')
    .toUpperCase()
    .slice(0, 32),
  /**
   * İlk ödeme yöntemi reddedilirse denenecek yedekler (virgülle ayrılmış).
   * Sıra önemli: bakiye → hesaba tanımlı kart → cüzdan.
   */
  prepaidPaymentFallbacks: (envString('LITEAPI_PREPAID_PAYMENT_FALLBACKS') ||
    'ACC_CREDIT_CARD,WALLET')
    .split(',')
    .map((method) => method.trim().toUpperCase())
    .filter(Boolean),
  /**
   * Platform marjı (basis point). 1500 = %15. Sağlayıcı fiyatına eklenir;
   * misafire yalnızca toplam fiyat gösterilir. 0..10000 arasında sınırlanır.
   */
  markupBps: intEnv('LITEAPI_MARKUP_BPS', 1500, 0, 10_000),
  /** Fiyat listesinin istemcide kendini yenileme aralığı (saniye). */
  priceRefreshSeconds: intEnv('LITEAPI_PRICE_REFRESH_SECONDS', 300, 60, 3600),
};

function apiKey() {
  return (process.env.LITEAPI_API_KEY || '').trim();
}

function isConfigured() {
  return apiKey().length > 0;
}

module.exports = { config, apiKey, isConfigured, TRABZON };
