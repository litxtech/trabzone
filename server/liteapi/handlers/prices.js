/**
 * Liste ekranı için toplu "gecelik başlangıç" fiyatı.
 *
 *   POST /api/liteapi-prices
 *   { propertyIds: string[], checkIn: 'YYYY-MM-DD', checkOut, adults?, children?,
 *     childrenAges?: number[], currency?: 'TRY' }
 *
 * Neden ayrı bir uç nokta?
 * LiteAPI Content API sabit oda fiyatı taşımaz; fiyat yalnızca tarih + doluluk
 * ile `/hotels/rates` çağrısından gelir. Tesis detayı açılmadan liste kartları
 * bu yüzden "fiyat için iletişim" gösteriyordu. Bu uç nokta görünen kartların
 * tümü için toplu (20 otel/istek) en düşük fiyatı çeker, marjı uygular ve
 * `external_price_from_cents` alanını tazeler.
 *
 * Herkese açıktır; IP başına dakikada 60 istekle sınırlıdır. Sağlayıcı anahtarı,
 * ham teklif ve platform marjı istemciye gönderilmez.
 */

const { childAges, nightsBetween, providerRatesForHotels } = require('../booking');
const { normalizeOffers } = require('../normalize');
const { applyMarkupToOffer } = require('../pricing');
const { isConfigured, config } = require('../config');
const { serviceSelect, serviceRpc } = require('../supabase');
const { sendJson, readJsonBody, clientIp, createRateLimiter } = require('../../http-utils');

const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 60 });

/**
 * Sıcak (warm) sunucu örneğinde tekrarlanan pazar sorgularını engelleyen küçük
 * bellek önbelleği. Sağlayıcı çağrısı 1-3 saniye sürdüğü için aynı liste
 * görünümünün tekrar açılması sağlayıcıyı yormasın istenir.
 */
const RESULT_TTL_MS = 10 * 60_000;
const RESULT_CACHE_MAX = 2000;
const resultCache = new Map();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tek istekte fiyatlanacak en fazla tesis (liste ilk 40 kartı çizer). */
const MAX_IDS = 40;
/** Sağlayıcı tek çağrıda en fazla 100 otel kabul eder; güvenli aralık. */
const CHUNK_SIZE = 20;

function uniqueIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim().toLowerCase();
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_IDS) break;
  }
  return ids;
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function stayCacheKey(hotelId, stay) {
  return [hotelId, stay.checkIn, stay.checkOut, stay.adults, stay.children, stay.currency].join('|');
}

function readCached(key) {
  const hit = resultCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    resultCache.delete(key);
    return undefined;
  }
  return hit;
}

function writeCached(key, value) {
  if (resultCache.size >= RESULT_CACHE_MAX) {
    const now = Date.now();
    for (const [entryKey, entry] of resultCache) {
      if (now > entry.expiresAt) resultCache.delete(entryKey);
    }
    if (resultCache.size >= RESULT_CACHE_MAX) resultCache.clear();
  }
  resultCache.set(key, { ...value, expiresAt: Date.now() + RESULT_TTL_MS });
}

/** LiteAPI tesis kimine göre görünen tesis kimlerini eşler. */
async function propertyHotelMap(propertyIds) {
  const rows = await serviceSelect('acc_properties', {
    select: 'id,external_id',
    id: `in.(${propertyIds.join(',')})`,
    source: 'eq.liteapi',
    external_id: 'not.is.null',
  });
  const byHotel = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || typeof row.external_id !== 'string') continue;
    byHotel.set(row.external_id, row.id);
  }
  return byHotel;
}

/**
 * Bir otel yığını için en ucuz teklifin gecelik (marj dahil) fiyatı.
 * `null` dönerse o otel için bu tarihlerde satılabilir oda yok demektir.
 */
function cheapestNightly(hotel, nights) {
  const normalized = normalizeOffers(
    { data: [hotel] },
    { hotelId: hotel && typeof hotel.hotelId === 'string' ? hotel.hotelId : null },
  );
  if (normalized.offers.length === 0) return null;
  const priced = applyMarkupToOffer(normalized.offers[0]);
  if (!priced.priceCents || priced.priceCents <= 0) return null;
  return {
    priceCents: Math.max(1, Math.round(priced.priceCents / nights)),
    currency: priced.currency || config.defaultCurrency,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
    return;
  }

  if (!isConfigured()) {
    sendJson(res, 503, { ok: false, reason: 'not_configured' });
    return;
  }

  if (isRateLimited(clientIp(req))) {
    res.setHeader('Retry-After', '60');
    sendJson(res, 429, { ok: false, reason: 'rate_limited' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, 8 * 1024);
  } catch (cause) {
    sendJson(res, cause.code === 'payload_too_large' ? 413 : 400, {
      ok: false,
      reason: cause.code || 'invalid_json',
    });
    return;
  }

  const propertyIds = uniqueIds(body.propertyIds);
  if (propertyIds.length === 0) {
    sendJson(res, 400, { ok: false, reason: 'invalid_property' });
    return;
  }
  if (!isDate(body.checkIn) || !isDate(body.checkOut)) {
    sendJson(res, 400, { ok: false, reason: 'invalid_dates' });
    return;
  }

  let nights;
  try {
    nights = nightsBetween(body.checkIn, body.checkOut);
  } catch (cause) {
    sendJson(res, 400, {
      ok: false,
      reason: 'invalid_dates',
      message: cause instanceof Error ? cause.message : 'Geçersiz tarih aralığı.',
    });
    return;
  }

  const adults = Math.max(1, Math.min(12, Math.trunc(Number(body.adults) || 2)));
  const children = Math.max(0, Math.min(8, Math.trunc(Number(body.children) || 0)));
  const currency = (body.currency || config.defaultCurrency).toUpperCase().slice(0, 3);

  let hotelMap;
  try {
    hotelMap = await propertyHotelMap(propertyIds);
  } catch (cause) {
    console.error('[liteapi-prices] map', cause && cause.message ? cause.message : cause);
    sendJson(res, 502, { ok: false, reason: 'lookup_failed' });
    return;
  }

  const hotelIds = [...hotelMap.keys()];
  if (hotelIds.length === 0) {
    sendJson(res, 200, {
      ok: true,
      stay: { checkIn: body.checkIn, checkOut: body.checkOut, nights, adults, children },
      currency,
      items: [],
      refreshSeconds: config.priceRefreshSeconds,
    });
    return;
  }

  const items = [];
  const pending = new Set(hotelIds);
  const ages = childAges(children, body.childrenAges);
  const stay = { checkIn: body.checkIn, checkOut: body.checkOut, adults, children, currency };

  // Sıcak örnekte bilinen sonuçlar (fiyat ya da "oda yok") yeniden sorulmaz.
  for (const hotelId of hotelIds) {
    const hit = readCached(stayCacheKey(hotelId, stay));
    if (!hit) continue;
    pending.delete(hotelId);
    if (typeof hit.priceCents === 'number' && hit.priceCents > 0) {
      items.push({
        propertyId: hotelMap.get(hotelId),
        priceCents: hit.priceCents,
        currency: hit.currency || currency,
      });
    }
  }

  const markets = config.rateMarkets;
  let providerFailed = false;

  for (const guestNationality of markets) {
    if (pending.size === 0) break;
    const remaining = [...pending];
    const chunks = [];
    for (let offset = 0; offset < remaining.length; offset += CHUNK_SIZE) {
      chunks.push(remaining.slice(offset, offset + CHUNK_SIZE));
    }

    // Parçalar paralel başlatılır; HTTP istemcisi istekleri kendi hız
    // sınırında sıraya soktuğu için sağlayıcı limiti aşılmaz.
    const payloads = await Promise.all(
      chunks.map(async (chunk) => {
        try {
          return await providerRatesForHotels({
            hotelIds: chunk,
            checkIn: body.checkIn,
            checkOut: body.checkOut,
            adults,
            childrenAges: ages,
            currency,
            guestNationality,
            maxRatesPerHotel: 5,
          });
        } catch (cause) {
          providerFailed = true;
          console.error(
            '[liteapi-prices] provider',
            cause && cause.code ? cause.code : '',
            cause && cause.message ? cause.message : cause,
          );
          return null;
        }
      }),
    );

    for (const payload of payloads) {
      const hotels = Array.isArray(payload?.data)
        ? payload.data
        : payload?.data && typeof payload.data === 'object'
          ? [payload.data]
          : [];
      for (const hotel of hotels) {
        const hotelId = hotel && typeof hotel.hotelId === 'string' ? hotel.hotelId : null;
        const propertyId = hotelId ? hotelMap.get(hotelId) : null;
        if (!propertyId) continue;
        const cheapest = cheapestNightly(hotel, nights);
        if (!cheapest) continue;
        pending.delete(hotelId);
        writeCached(stayCacheKey(hotelId, stay), {
          priceCents: cheapest.priceCents,
          currency: cheapest.currency,
        });
        items.push({ propertyId, priceCents: cheapest.priceCents, currency: cheapest.currency });
      }
    }
  }

  // Hiçbir pazarda oda bulunamayan tesisler kısa süre "oda yok" olarak
  // işaretlenir. Sağlayıcı hatası varsa sonuç eksik olabilir; yazılmaz.
  if (!providerFailed) {
    for (const hotelId of pending) {
      writeCached(stayCacheKey(hotelId, stay), { priceCents: null, currency: null });
    }
  }

  // Liste kartları kalıcı olarak dolsun: en düşük fiyat tesis kaydına yazılır.
  // Hata olsa da yanıt döner (fiyat istemcide gösterilir).
  await Promise.all(
    items.map((item) =>
      serviceRpc('acc_liteapi_set_property_price', {
        p_property_id: item.propertyId,
        p_price_cents: item.priceCents,
        p_currency: item.currency,
      }).catch(() => undefined),
    ),
  );

  sendJson(res, 200, {
    ok: true,
    stay: { checkIn: body.checkIn, checkOut: body.checkOut, nights, adults, children },
    currency,
    items,
    // Hiçbir otelde oda yoksa bu bir sağlayıcı hatası değildir; istemci "müsait
    // değil" gösterebilir. Sağlayıcı çağrısı düştüyse de aynı yanıt döner ama
    // `degraded` bilgisi istemcinin tekrar denemesine yol açmaz.
    degraded: providerFailed,
    refreshSeconds: config.priceRefreshSeconds,
  });
};
