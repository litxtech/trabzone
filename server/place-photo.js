/**
 * İşletme kapak fotoğrafı: Trabzone'da fotoğrafı olmayan işletmeler için
 * Google Places (New) üzerindeki fotoğrafı bulur.
 *
 * Akış:
 *   1. İşletme adı + koordinatla Text Search yapılır (yalnızca kimlik, ad,
 *      konum ve fotoğraf alanları istenir).
 *   2. Sonuçlardan adı eşleşen ve ~300 m içinde olan kayıt seçilir. Ad
 *      eşleşmezse fotoğraf dönülmez; yanlış işletmenin fotoğrafını göstermek
 *      hiç göstermemekten kötüdür.
 *   3. İlk fotoğrafın `photoUri` adresi (anahtarsız, kısa ömürlü Google
 *      adresi) ve fotoğraf sahibinin atıf bilgisi döner.
 *
 * Apple Maps sunucu API'si fotoğraf vermediği için yalnızca Google kullanılır.
 *
 * Google koşulları gereği fotoğrafın kendisi ve photo name kalıcı saklanmaz;
 * yalnızca place ID uzun süre önbelleğe alınabilir. Fotoğraf yanıtı kısa
 * süre bellekte tutulur.
 */

const { distanceMeters } = require('./place-search');

const GOOGLE_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_MEDIA_BASE = 'https://places.googleapis.com/v1/';
const FIELD_MASK = 'places.id,places.displayName,places.location,places.photos';

const MATCH_DISTANCE_METERS = 300;
const SEARCH_BIAS_METERS = 400;
const MAX_NAME_LENGTH = 120;
const DEFAULT_WIDTH = 800;
const MIN_WIDTH = 120;
const MAX_WIDTH = 1600;
const REQUEST_TIMEOUT_MS = 7000;

const PLACE_ID_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PHOTO_TTL_MS = 50 * 60 * 1000;
const MISS_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

/** Eşleştirmede ayırt edici sayılmayan genel kelimeler. */
const GENERIC_TOKENS = new Set([
  've',
  'the',
  'cafe',
  'kafe',
  'restoran',
  'restaurant',
  'lokanta',
  'magaza',
  'market',
  'sube',
  'subesi',
  'trabzon',
  'ltd',
  'sti',
  'as',
]);

function googleKey() {
  for (const name of ['GOOGLE_MAPS_API_KEY', 'GOOGLE_PLACES_API_KEY']) {
    const raw = process.env[name];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  }
  return null;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
}

function compactKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function tokens(value) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token));
}

/**
 * İki işletme adının aynı yeri gösterip göstermediği. Biri diğerini
 * içeriyorsa ("Kalkanoğlu Pilavı" / "Kalkanoğlu Pilavı Meydan Şubesi") ya da
 * ayırt edici kelimelerin yarısı ortaksa eşleşir.
 */
function namesMatch(a, b) {
  const keyA = compactKey(a);
  const keyB = compactKey(b);
  if (!keyA || !keyB) {
    return false;
  }
  if (keyA === keyB) {
    return true;
  }
  const shorter = keyA.length <= keyB.length ? keyA : keyB;
  const longer = shorter === keyA ? keyB : keyA;
  if (shorter.length >= 5 && longer.includes(shorter)) {
    return true;
  }
  const tokensA = new Set(tokens(a));
  const tokensB = new Set(tokens(b));
  if (tokensA.size === 0 || tokensB.size === 0) {
    return false;
  }
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      shared += 1;
    }
  }
  return shared / Math.min(tokensA.size, tokensB.size) >= 0.5;
}

function toCoordinate(value) {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function normalizeInput(input) {
  const name =
    typeof input.name === 'string'
      ? input.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
      : '';
  const lat = toCoordinate(input.lat);
  const lng = toCoordinate(input.lng);
  const rawWidth = Number(input.width);
  const width = Number.isFinite(rawWidth)
    ? Math.min(Math.max(Math.round(rawWidth), MIN_WIDTH), MAX_WIDTH)
    : DEFAULT_WIDTH;
  if (name.length < 2 || lat === null || lng === null) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { name, lat, lng, width };
}

// ---------------------------------------------------------------------------
// Önbellek
// ---------------------------------------------------------------------------

const placeIdCache = new Map();
const photoCache = new Map();

function readCache(cache, key) {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeCache(cache, key, value, ttl) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

function attributionsOf(photo) {
  const list = Array.isArray(photo.authorAttributions) ? photo.authorAttributions : [];
  return list
    .map((entry) => ({
      name: typeof entry.displayName === 'string' ? entry.displayName : '',
      uri: typeof entry.uri === 'string' ? entry.uri : null,
    }))
    .filter((entry) => entry.name);
}

async function findGooglePlace({ key, name, lat, lng, signal }) {
  const response = await fetch(GOOGLE_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: name,
      languageCode: 'tr',
      regionCode: 'TR',
      maxResultCount: 5,
      locationBias: {
        circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_BIAS_METERS },
      },
    }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`google_http_${response.status} ${detail.slice(0, 200)}`);
  }
  const body = await response.json();
  const places = Array.isArray(body.places) ? body.places : [];
  let best = null;
  for (const place of places) {
    const location = place.location || {};
    const point = { lat: location.latitude, lng: location.longitude };
    const placeName = place.displayName && place.displayName.text;
    if (typeof point.lat !== 'number' || typeof point.lng !== 'number' || !placeName) {
      continue;
    }
    const distance = distanceMeters({ lat, lng }, point);
    if (distance > MATCH_DISTANCE_METERS || !namesMatch(name, placeName)) {
      continue;
    }
    if (!best || distance < best.distance) {
      best = { id: place.id, photos: Array.isArray(place.photos) ? place.photos : [], distance };
    }
  }
  return best;
}

/** Kimliği bilinen işletmenin fotoğrafları (Text Search'ten daha ucuz). */
async function fetchGooglePlace({ key, placeId, signal }) {
  const response = await fetch(`${GOOGLE_MEDIA_BASE}places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id,photos' },
    signal,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`google_details_${response.status} ${detail.slice(0, 200)}`);
  }
  const body = await response.json();
  return { id: placeId, photos: Array.isArray(body.photos) ? body.photos : [], distance: 0 };
}

async function resolvePhotoUri({ key, photoName, width, signal }) {
  const params = new URLSearchParams({
    maxWidthPx: String(width),
    skipHttpRedirect: 'true',
  });
  const response = await fetch(`${GOOGLE_MEDIA_BASE}${photoName}/media?${params.toString()}`, {
    headers: { 'X-Goog-Api-Key': key },
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`google_media_${response.status} ${detail.slice(0, 200)}`);
  }
  const body = await response.json();
  return typeof body.photoUri === 'string' ? body.photoUri : null;
}

/**
 * @param {{ name: string, lat: number|string, lng: number|string, width?: number|string }} input
 * @returns {Promise<{ configured: boolean, invalid?: boolean, photo: object|null }>}
 */
async function findPlacePhoto(input) {
  const key = googleKey();
  if (!key) {
    return { configured: false, photo: null };
  }
  const normalized = normalizeInput(input);
  if (!normalized) {
    return { configured: true, invalid: true, photo: null };
  }
  const { name, lat, lng, width } = normalized;
  const placeKey = `${compactKey(name)}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
  const photoKey = `${placeKey}|${width}`;

  const cachedPhoto = readCache(photoCache, photoKey);
  if (cachedPhoto !== undefined) {
    return { configured: true, photo: cachedPhoto };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const knownId = readCache(placeIdCache, placeKey);
    const place =
      knownId === null
        ? null
        : knownId
          ? await fetchGooglePlace({ key, placeId: knownId, signal: controller.signal })
          : await findGooglePlace({ key, name, lat, lng, signal: controller.signal });
    if (!place && knownId === undefined) {
      writeCache(placeIdCache, placeKey, null, MISS_TTL_MS);
    }
    const photo = place && place.photos.length > 0 ? place.photos[0] : null;
    if (place) {
      writeCache(placeIdCache, placeKey, place.id, PLACE_ID_TTL_MS);
    }
    if (!photo || typeof photo.name !== 'string') {
      writeCache(photoCache, photoKey, null, MISS_TTL_MS);
      return { configured: true, photo: null };
    }
    const url = await resolvePhotoUri({
      key,
      photoName: photo.name,
      width,
      signal: controller.signal,
    });
    if (!url) {
      writeCache(photoCache, photoKey, null, MISS_TTL_MS);
      return { configured: true, photo: null };
    }
    const value = {
      url,
      width: typeof photo.widthPx === 'number' ? photo.widthPx : null,
      height: typeof photo.heightPx === 'number' ? photo.heightPx : null,
      source: 'google',
      placeId: place.id,
      attributions: attributionsOf(photo),
    };
    writeCache(photoCache, photoKey, value, PHOTO_TTL_MS);
    return { configured: true, photo: value };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  findPlacePhoto,
  namesMatch,
};
