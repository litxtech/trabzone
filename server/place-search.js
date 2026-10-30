/**
 * Harici işletme araması: Google Places (New) + Apple Maps (MapKit JS Server API)
 * + OpenStreetMap (Nominatim).
 *
 * Neden sunucuda: sağlayıcı API anahtarları istemciye gömülemez ve Nominatim
 * kullanım politikası tanımlayıcı bir User-Agent ile önbellek gerektirir.
 * Uygulama `GET /api/place-search?q=...&lat=..&lng=..` çağırır; bu modül
 * sağlayıcıları paralel sorgular, sonuçları tek listede birleştirir ve
 * aynı işletmeyi (isim + ~150 m yakınlık) tekilleştirir.
 *
 * Sağlayıcılar bağımsız çalışır: biri yapılandırılmamışsa ya da hata
 * verirse diğeri yine sonuç döner. OpenStreetMap her zaman açıktır; bu yüzden
 * uygulama anahtar tanımlanmadan da gerçek harita işletmelerini arayabilir.
 *
 * Gerekli ortam değişkenleri (yalnızca sunucu tarafı, Vercel):
 *   GOOGLE_MAPS_API_KEY       — Places API (New) etkin bir anahtar (isteğe bağlı)
 *   APPLE_MAPKIT_TEAM_ID      — Apple Developer Team ID (isteğe bağlı)
 *   APPLE_MAPKIT_KEY_ID       — MapKit anahtarının Key ID'si (isteğe bağlı)
 *   APPLE_MAPKIT_PRIVATE_KEY  — .p8 içeriği (\n kaçışlı tek satır olabilir)
 *   PLACE_SEARCH_DISABLE_OSM  — '1' ise Nominatim sağlayıcısı kapatılır
 */

const crypto = require('node:crypto');

const GOOGLE_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const APPLE_TOKEN_URL = 'https://maps-api.apple.com/v1/token';
const APPLE_SEARCH_URL = 'https://maps-api.apple.com/v1/search';
const OSM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
/** Nominatim kullanım politikası: tanımlayıcı User-Agent zorunlu. */
const OSM_USER_AGENT = 'TrabzoneApp/1.0 (+https://www.trabzoneapp.com)';
/** Politika gereği saniyede en fazla bir istek. */
const OSM_MIN_INTERVAL_MS = 1100;

const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
].join(',');

/** Trabzon merkezi: istemci konum göndermezse arama buraya yakın yapılır. */
const DEFAULT_CENTER = { lat: 41.0027, lng: 39.7168 };
const BIAS_RADIUS_METERS = 45000;
const MAX_QUERY_LENGTH = 120;
const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 12;
const REQUEST_TIMEOUT_MS = 7000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

/** İşletme olmayan (idari/idari sınır) Google tipleri. */
const NON_BUSINESS_TYPES = new Set([
  'locality',
  'political',
  'country',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'postal_code',
  'postal_town',
  'route',
  'street_address',
  'premise',
  'subpremise',
  'plus_code',
  'colloquial_area',
]);

function envValue(name) {
  const raw = process.env[name];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function googleKey() {
  return envValue('GOOGLE_MAPS_API_KEY') || envValue('GOOGLE_PLACES_API_KEY');
}

function appleCredentials() {
  const teamId = envValue('APPLE_MAPKIT_TEAM_ID');
  const keyId = envValue('APPLE_MAPKIT_KEY_ID');
  const privateKey = envValue('APPLE_MAPKIT_PRIVATE_KEY');
  if (!teamId || !keyId || !privateKey) {
    return null;
  }
  return {
    teamId,
    keyId,
    // Vercel'de çok satırlı değer `\n` kaçışıyla yazılır.
    privateKey: privateKey.replace(/\\n/g, '\n'),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toCoordinate(value) {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function normalizeQuery(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

function normalizeLimit(raw) {
  const number = Number(raw);
  if (!Number.isFinite(number)) {
    return DEFAULT_LIMIT;
  }
  return clamp(Math.round(number), 1, MAX_LIMIT);
}

/** Aksan/diyakritik farkını yok sayan isim anahtarı (tekilleştirme için). */
function nameKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]/g, '');
}

function distanceMeters(a, b) {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toPoint(lat, lng) {
  const parsedLat = toCoordinate(lat);
  const parsedLng = toCoordinate(lng);
  if (parsedLat === null || parsedLng === null) {
    return null;
  }
  if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
    return null;
  }
  return { lat: parsedLat, lng: parsedLng };
}

// ---------------------------------------------------------------------------
// Google Places API (New)
// ---------------------------------------------------------------------------

function googleItem(place) {
  const point = toPoint(
    place.location && place.location.latitude,
    place.location && place.location.longitude,
  );
  const name =
    place.displayName && place.displayName.text ? String(place.displayName.text).trim() : '';
  if (!point || !name) {
    return null;
  }
  const types = Array.isArray(place.types) ? place.types.map(String) : [];
  const primaryType = typeof place.primaryType === 'string' ? place.primaryType : null;
  const businessStatus = typeof place.businessStatus === 'string' ? place.businessStatus : null;
  if (businessStatus === 'CLOSED_PERMANENTLY') {
    return null;
  }
  const primary = primaryType || types[0] || '';
  if (NON_BUSINESS_TYPES.has(primary)) {
    return null;
  }
  return {
    id: `google:${place.id || `${point.lat},${point.lng}`}`,
    source: 'google',
    sources: ['google'],
    name,
    address: typeof place.formattedAddress === 'string' ? place.formattedAddress : '',
    lat: point.lat,
    lng: point.lng,
    category:
      place.primaryTypeDisplayName && place.primaryTypeDisplayName.text
        ? String(place.primaryTypeDisplayName.text).trim()
        : null,
    types,
    phone:
      (typeof place.nationalPhoneNumber === 'string' && place.nationalPhoneNumber) ||
      (typeof place.internationalPhoneNumber === 'string' && place.internationalPhoneNumber) ||
      null,
    website: typeof place.websiteUri === 'string' ? place.websiteUri : null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    ratingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    closed: businessStatus === 'CLOSED_TEMPORARILY',
  };
}

async function searchGoogle({ query, center, limit, signal }) {
  const key = googleKey();
  if (!key) {
    return { items: [], error: 'not_configured' };
  }
  const response = await fetch(GOOGLE_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'tr',
      regionCode: 'TR',
      maxResultCount: clamp(limit, 1, 20),
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: BIAS_RADIUS_METERS,
        },
      },
    }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { items: [], error: `google_http_${response.status}`, detail: detail.slice(0, 300) };
  }
  const body = await response.json();
  const places = Array.isArray(body.places) ? body.places : [];
  const items = [];
  for (const place of places) {
    const item = googleItem(place);
    if (item) {
      items.push(item);
    }
  }
  return { items, error: null };
}

// ---------------------------------------------------------------------------
// Apple Maps — MapKit JS Server API
// ---------------------------------------------------------------------------

let appleTokenCache = { token: null, expiresAt: 0 };

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

/** MapKit token isteği için ES256 imzalı JWT üretir. */
function signAppleJwt({ teamId, keyId, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: now, exp: now + 1800 }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64url(signature)}`;
}

async function appleAccessToken(signal) {
  const credentials = appleCredentials();
  if (!credentials) {
    return null;
  }
  if (appleTokenCache.token && Date.now() < appleTokenCache.expiresAt) {
    return appleTokenCache.token;
  }
  let jwt;
  try {
    jwt = signAppleJwt(credentials);
  } catch (error) {
    console.error('[place-search] apple jwt', error && error.message ? error.message : error);
    return null;
  }
  const response = await fetch(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[place-search] apple token', response.status, detail.slice(0, 200));
    return null;
  }
  const body = await response.json();
  const token = typeof body.accessToken === 'string' ? body.accessToken : null;
  if (!token) {
    return null;
  }
  const ttl = Number.isFinite(body.expiresInSeconds) ? Number(body.expiresInSeconds) : 1800;
  appleTokenCache = { token, expiresAt: Date.now() + Math.max(ttl - 120, 60) * 1000 };
  return token;
}

function appleItem(result) {
  const coordinate = result.coordinate || {};
  const point = toPoint(coordinate.latitude, coordinate.longitude);
  const name = typeof result.name === 'string' ? result.name.trim() : '';
  if (!point || !name) {
    return null;
  }
  // Apple yanıtı adres ve idari alanları da içerebilir; işletme kaydı
  // `poiCategory` alanıyla ayırt edilir.
  const category = typeof result.poiCategory === 'string' ? result.poiCategory : null;
  if (!category) {
    return null;
  }
  const structured = result.structuredAddress || {};
  const address =
    (typeof result.formattedAddress === 'string' && result.formattedAddress) ||
    [
      structured.thoroughfare,
      structured.locality,
      structured.postalCode,
      structured.administrativeArea,
    ]
      .filter((part) => typeof part === 'string' && part.trim() !== '')
      .join(', ');
  return {
    id:
      typeof result.id === 'string' && result.id
        ? `apple:${result.id}`
        : `apple:${point.lat},${point.lng},${nameKey(name)}`,
    source: 'apple',
    sources: ['apple'],
    name,
    address,
    lat: point.lat,
    lng: point.lng,
    category,
    types: category ? [category] : [],
    phone: null,
    website: null,
    rating: null,
    ratingCount: null,
    closed: false,
  };
}

async function searchApple({ query, center, limit, signal }) {
  if (!appleCredentials()) {
    return { items: [], error: 'not_configured' };
  }
  const token = await appleAccessToken(signal);
  if (!token) {
    return { items: [], error: 'apple_token' };
  }
  const params = new URLSearchParams({
    q: query,
    lang: 'tr-TR',
    // Apple sunucu aramasında sonuçları Türkiye ile sınırlar.
    limitToCountries: 'TR',
    resultTypeFilter: 'Poi',
    searchLocation: `${center.lat},${center.lng}`,
  });
  const response = await fetch(`${APPLE_SEARCH_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 401) {
      appleTokenCache = { token: null, expiresAt: 0 };
    }
    return { items: [], error: `apple_http_${response.status}`, detail: detail.slice(0, 200) };
  }
  const body = await response.json();
  const results = Array.isArray(body.results) ? body.results : [];
  const items = [];
  for (const result of results) {
    const item = appleItem(result);
    if (item) {
      items.push(item);
      if (items.length >= limit) {
        break;
      }
    }
  }
  return { items, error: null };
}

// ---------------------------------------------------------------------------
// OpenStreetMap — Nominatim
// ---------------------------------------------------------------------------

/** Yalnızca işletme sayılan OSM sınıfları (idari sınır, yol vb. elenir). */
const OSM_BUSINESS_CLASSES = new Set([
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'office',
  'healthcare',
  'craft',
]);

/** OSM `type` değerlerinin kullanıcıya gösterilecek karşılıkları. */
const OSM_CATEGORY_LABELS = {
  cafe: 'Kafe',
  restaurant: 'Restoran',
  fast_food: 'Fast food',
  bar: 'Bar',
  pub: 'Pub',
  pharmacy: 'Eczane',
  hospital: 'Hastane',
  clinic: 'Klinik',
  dentist: 'Diş hekimi',
  doctors: 'Doktor',
  bank: 'Banka',
  atm: 'ATM',
  fuel: 'Benzin istasyonu',
  parking: 'Otopark',
  school: 'Okul',
  university: 'Üniversite',
  kindergarten: 'Anaokulu',
  place_of_worship: 'İbadet yeri',
  police: 'Polis',
  post_office: 'Postane',
  townhall: 'Belediye',
  courthouse: 'Adliye',
  library: 'Kütüphane',
  bakery: 'Fırın',
  butcher: 'Kasap',
  supermarket: 'Market',
  convenience: 'Bakkal',
  greengrocer: 'Manav',
  clothes: 'Giyim',
  shoes: 'Ayakkabı',
  electronics: 'Elektronik',
  furniture: 'Mobilya',
  jewelry: 'Kuyumcu',
  hairdresser: 'Kuaför',
  beauty: 'Güzellik salonu',
  hotel: 'Otel',
  guest_house: 'Pansiyon',
  hostel: 'Hostel',
  motel: 'Motel',
  car_repair: 'Oto servis',
  car_rental: 'Araç kiralama',
  car_wash: 'Oto yıkama',
  gym: 'Spor salonu',
  fitness_centre: 'Spor salonu',
  marketplace: 'Pazar',
  mall: 'AVM',
  department_store: 'Mağaza',
  attraction: 'Gezilecek yer',
  museum: 'Müze',
  viewpoint: 'Seyir noktası',
  picnic_site: 'Piknik alanı',
  park: 'Park',
  theatre: 'Tiyatro',
  cinema: 'Sinema',
};

let osmQueue = Promise.resolve();
let osmLastCallAt = 0;

/** Nominatim isteklerini saniyede bir ile sınırlar (kullanım politikası). */
function scheduleOsm(task) {
  const run = osmQueue.then(async () => {
    const wait = OSM_MIN_INTERVAL_MS - (Date.now() - osmLastCallAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    osmLastCallAt = Date.now();
    return task();
  });
  osmQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function osmCategoryLabel(type, tags) {
  const label = OSM_CATEGORY_LABELS[type];
  if (label) {
    return label;
  }
  const raw = typeof type === 'string' && type ? type : '';
  if (!raw) {
    return null;
  }
  return raw.replace(/_/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function osmItem(result) {
  // Nominatim JSONv2 `class` alanını `category` olarak döndürür; eski biçim
  // (json) için `class` da kabul edilir.
  const itemClass =
    typeof result.category === 'string'
      ? result.category
      : typeof result.class === 'string'
        ? result.class
        : '';
  const type = typeof result.type === 'string' ? result.type : '';
  if (!OSM_BUSINESS_CLASSES.has(itemClass)) {
    return null;
  }
  const point = toPoint(result.lat, result.lon);
  if (!point) {
    return null;
  }
  const tags = result.extratags && typeof result.extratags === 'object' ? result.extratags : {};
  const displayName = typeof result.display_name === 'string' ? result.display_name : '';
  const name =
    (typeof result.name === 'string' && result.name.trim()) ||
    (typeof tags.name === 'string' && tags.name.trim()) ||
    (displayName ? displayName.split(',')[0].trim() : '');
  if (!name) {
    return null;
  }
  const externalId = result.osm_type && result.osm_id ? `${result.osm_type}/${result.osm_id}` : null;
  const website =
    (typeof tags.website === 'string' && tags.website) ||
    (typeof tags['contact:website'] === 'string' && tags['contact:website']) ||
    null;
  const phone =
    (typeof tags.phone === 'string' && tags.phone) ||
    (typeof tags['contact:phone'] === 'string' && tags['contact:phone']) ||
    null;
  return {
    id: externalId ? `osm:${externalId}` : `osm:${point.lat},${point.lng},${nameKey(name)}`,
    source: 'osm',
    sources: ['osm'],
    name,
    address: displayName.slice(0, 400),
    lat: point.lat,
    lng: point.lng,
    category: osmCategoryLabel(type, tags),
    types: [itemClass, type].filter(Boolean),
    phone,
    website,
    rating: null,
    ratingCount: null,
    closed: false,
    externalId,
  };
}

async function searchOsm({ query, center, limit, signal }) {
  if (envValue('PLACE_SEARCH_DISABLE_OSM') === '1') {
    return { items: [], error: 'not_configured' };
  }
  // Trabzon sınır kutusu: Karadeniz kıyısından iç kesimlere.
  const viewbox = '38.90,41.25,40.70,40.55';
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    extratags: '1',
    namedetails: '1',
    limit: String(clamp(limit, 1, MAX_LIMIT)),
    'accept-language': 'tr',
    countrycodes: 'tr',
    viewbox,
    bounded: '1',
  });
  if (center) {
    // `bounded` sınır kutusu içinde kalır; merkez yalnızca sıralama bağlamı.
    params.set('lat', String(center.lat));
    params.set('lon', String(center.lng));
  }

  const response = await scheduleOsm(() =>
    fetch(`${OSM_SEARCH_URL}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'tr',
        'User-Agent': OSM_USER_AGENT,
      },
      signal,
    }),
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { items: [], error: `osm_http_${response.status}`, detail: detail.slice(0, 200) };
  }
  const body = await response.json();
  const results = Array.isArray(body) ? body : Array.isArray(body.results) ? body.results : [];
  const items = [];
  for (const result of results) {
    const item = osmItem(result);
    if (item) {
      items.push(item);
    }
    if (items.length >= limit) {
      break;
    }
  }
  return { items, error: null };
}

// ---------------------------------------------------------------------------
// Birleştirme
// ---------------------------------------------------------------------------

const DUPLICATE_DISTANCE_METERS = 150;

function mergeItems(items) {
  const merged = [];
  for (const item of items) {
    const key = nameKey(item.name);
    const duplicate = merged.find(
      (existing) =>
        nameKey(existing.name) === key &&
        distanceMeters(existing, item) <= DUPLICATE_DISTANCE_METERS,
    );
    if (!duplicate) {
      merged.push({ ...item, sources: [...item.sources] });
      continue;
    }
    for (const source of item.sources) {
      if (!duplicate.sources.includes(source)) {
        duplicate.sources.push(source);
      }
    }
    duplicate.phone = duplicate.phone || item.phone;
    duplicate.website = duplicate.website || item.website;
    duplicate.category = duplicate.category || item.category;
    duplicate.rating = duplicate.rating == null ? item.rating : duplicate.rating;
    duplicate.ratingCount =
      duplicate.ratingCount == null ? item.ratingCount : duplicate.ratingCount;
    if (!duplicate.address && item.address) {
      duplicate.address = item.address;
    }
    duplicate.types = Array.from(new Set([...(duplicate.types || []), ...(item.types || [])]));
  }
  return merged;
}

const cache = new Map();

function cacheKey(query, center) {
  return `${query.toLowerCase()}|${center.lat.toFixed(3)}|${center.lng.toFixed(3)}`;
}

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * @param {{ query: string, lat?: number, lng?: number, limit?: number }} input
 * @returns {Promise<{ configured: boolean, providers: string[], items: object[], errors: string[] }>}
 */
async function searchPlaces(input) {
  const query = normalizeQuery(input.query);
  const limit = normalizeLimit(input.limit);
  const center = toPoint(input.lat, input.lng) || DEFAULT_CENTER;

  const key = cacheKey(query, center);
  const cached = readCache(key);
  if (cached) {
    return cached;
  }

  const configured = {
    google: Boolean(googleKey()),
    apple: Boolean(appleCredentials()),
    // OpenStreetMap anahtar gerektirmez; kapatılmadığı sürece her zaman açıktır.
    osm: envValue('PLACE_SEARCH_DISABLE_OSM') !== '1',
  };
  const providers = Object.keys(configured).filter((name) => configured[name]);
  if (providers.length === 0) {
    return { configured: false, providers: [], items: [], errors: ['not_configured'] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const errors = [];
  let googleItems = [];
  let appleItems = [];
  let osmItems = [];

  try {
    const [google, apple, osm] = await Promise.all([
      configured.google
        ? searchGoogle({ query, center, limit, signal: controller.signal }).catch((error) => ({
            items: [],
            error: error && error.name === 'AbortError' ? 'google_timeout' : 'google_failed',
          }))
        : Promise.resolve({ items: [], error: null }),
      configured.apple
        ? searchApple({ query, center, limit, signal: controller.signal }).catch((error) => ({
            items: [],
            error: error && error.name === 'AbortError' ? 'apple_timeout' : 'apple_failed',
          }))
        : Promise.resolve({ items: [], error: null }),
      configured.osm
        ? searchOsm({ query, center, limit, signal: controller.signal }).catch((error) => ({
            items: [],
            error: error && error.name === 'AbortError' ? 'osm_timeout' : 'osm_failed',
          }))
        : Promise.resolve({ items: [], error: null }),
    ]);
    googleItems = google.items;
    appleItems = apple.items;
    osmItems = osm.items;
    if (google.error && google.error !== 'not_configured') {
      errors.push(google.error);
      if (google.detail) {
        console.error('[place-search] google', google.error, google.detail);
      }
    }
    if (apple.error && apple.error !== 'not_configured') {
      errors.push(apple.error);
      if (apple.detail) {
        console.error('[place-search] apple', apple.error, apple.detail);
      }
    }
    if (osm.error && osm.error !== 'not_configured') {
      errors.push(osm.error);
      if (osm.detail) {
        console.error('[place-search] osm', osm.error, osm.detail);
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  // Google sonuçları önce gelir: telefon/site/puan gibi ek alanlar oradan gelir.
  const items = mergeItems([...googleItems, ...appleItems, ...osmItems]).slice(0, limit);
  const value = { configured: true, providers, items, errors };
  if (items.length > 0) {
    writeCache(key, value);
  }
  return value;
}

module.exports = {
  searchPlaces,
  // Testler ve ileride yönetim paneli için yardımcılar.
  mergeItems,
  nameKey,
  distanceMeters,
  osmItem,
  searchOsm,
};
