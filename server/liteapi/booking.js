/**
 * LiteAPI rezervasyon sağlayıcı katmanı.
 *
 * - Canlı fiyat/müsaitlik sorgusu ücretsiz `POST /hotels/rates` ile yapılır.
 * - Sonuçlar kısa süreliğine veritabanında önbelleklenir; aynı tarih/misafir
 *   için tekrar tekrar ücretli sorgu açılmaz.
 * - `PROPERTY_PAY` yalnızca sağlayıcı teklifinde varsa `paymentAtProperty`
 *   olarak işaretlenir.
 * - `POST /rates/book` varsayılan olarak KAPALIDIR. Açmak için hem sunucu
 *   ortam bayrakları hem veritabanı ayarı gerekir.
 */

const { config } = require('./config');
const { searchRates: providerRates, bookRate } = require('./http');
const { normalizeOffers, normalizeBookingResponse } = require('./normalize');
const { serviceRpc } = require('./supabase');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value, field) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    const error = new Error(`${field} YYYY-MM-DD biçiminde olmalı.`);
    error.code = 'invalid_dates';
    throw error;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${field} geçerli bir tarih değil.`);
    error.code = 'invalid_dates';
    throw error;
  }
  return date;
}

function nightsBetween(checkIn, checkOut) {
  const start = assertDate(checkIn, 'checkin');
  const end = assertDate(checkOut, 'checkout');
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (nights <= 0 || nights > 60) {
    const error = new Error('Konaklama 1 ile 60 gece arasında olmalı.');
    error.code = 'invalid_dates';
    throw error;
  }
  return nights;
}

function childAges(children, ages) {
  const count = Math.max(0, Math.min(8, Math.trunc(Number(children) || 0)));
  if (count === 0) return [];
  const provided = Array.isArray(ages)
    ? ages
        .map((age) => Math.trunc(Number(age)))
        .filter((age) => Number.isFinite(age) && age >= 0 && age <= 17)
    : [];
  const result = provided.slice(0, count);
  while (result.length < count) result.push(8);
  return result;
}

function cacheKey({ hotelId, checkIn, checkOut, adults, children, currency }) {
  return [hotelId, checkIn, checkOut, adults, children, currency].join('|');
}

async function propertyContext(propertyId) {
  const context = await serviceRpc('acc_liteapi_property_context', {
    p_property_id: propertyId,
  });
  if (!context || !context.external_id) {
    const error = new Error('Tesis LiteAPI kaynağına bağlı değil.');
    error.code = 'not_external_property';
    throw error;
  }
  return context;
}

async function readCache(key) {
  try {
    const payload = await serviceRpc('acc_liteapi_rate_cache_get', { p_key: key });
    if (payload && payload.payload) {
      return payload;
    }
  } catch {
    // Önbellek okunamazsa canlı sorguya düşülür.
  }
  return null;
}

async function writeCache(input, normalized) {
  try {
    await serviceRpc('acc_liteapi_rate_cache_put', {
      p_key: input.key,
      p_hotel_external_id: input.hotelId,
      p_check_in: input.checkIn,
      p_check_out: input.checkOut,
      p_adults: input.adults,
      p_children: input.children,
      p_currency: input.currency,
      p_payload: normalized,
      p_ttl_seconds: config.rateCacheSeconds,
    });
  } catch {
    // Önbellek yazımı başarısız olsa da yanıt döner.
  }
}

/**
 * @param {{
 *   propertyId: string,
 *   checkIn: string,
 *   checkOut: string,
 *   adults?: number,
 *   children?: number,
 *   childrenAges?: number[],
 *   currency?: string,
 *   refresh?: boolean
 * }} input
 */
async function searchPropertyRates(input) {
  nightsBetween(input.checkIn, input.checkOut);
  const adults = Math.max(1, Math.min(12, Math.trunc(Number(input.adults) || 2)));
  const children = Math.max(0, Math.min(8, Math.trunc(Number(input.children) || 0)));
  const currency = (input.currency || config.defaultCurrency).toUpperCase().slice(0, 3);
  const context = await propertyContext(input.propertyId);
  const hotelId = context.external_id;
  const key = cacheKey({
    hotelId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults,
    children,
    currency,
  });

  if (!input.refresh) {
    const cached = await readCache(key);
    if (cached) {
      return {
        ...cached.payload,
        cached: true,
        fetchedAt: cached.fetched_at || null,
        property: {
          id: context.property_id,
          name: context.name,
          paymentAtProperty: Boolean(context.property_pay_enabled),
          bookingEnabled: Boolean(context.booking_enabled),
          commissionRate: Number(context.commission_rate) || 0,
        },
      };
    }
  }

  const payload = await providerRates({
    hotelIds: [hotelId],
    checkin: input.checkIn,
    checkout: input.checkOut,
    occupancies: [{ adults, children: childAges(children, input.childrenAges) }],
    guestNationality: config.guestNationality,
    currency,
    maxRatesPerHotel: config.maxOffers,
  });

  const normalized = normalizeOffers(payload, { hotelId });
  const result = {
    ...normalized,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults,
    children,
    nights: nightsBetween(input.checkIn, input.checkOut),
    cached: false,
    fetchedAt: new Date().toISOString(),
    // Rezervasyon kapatıldığında bile fiyat/iptal koşulları gösterilir;
    // yalnızca "tesiste ödeme" rozeti teklifte PROPERTY_PAY varsa çıkar.
    property: {
      id: context.property_id,
      name: context.name,
      paymentAtProperty: Boolean(context.property_pay_enabled),
      bookingEnabled: Boolean(context.booking_enabled),
      commissionRate: Number(context.commission_rate) || 0,
    },
  };

  await writeCache(
    {
      key,
      hotelId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      adults,
      children,
      currency,
    },
    result,
  );

  return result;
}

async function bookingGate() {
  const settings = await serviceRpc('acc_liteapi_booking_settings', {});
  const dbEnabled = Boolean(settings?.booking_enabled && settings?.provider_active);
  if (!config.bookingEnabled || !dbEnabled) {
    const error = new Error(
      'Canlı LiteAPI rezervasyonu kapalı. Test doğrulaması ve işletme onayı olmadan rezervasyon oluşturulamaz.',
    );
    error.code = 'booking_disabled';
    throw error;
  }
  return settings;
}

/**
 * Gerçek rezervasyon. Varsayılan olarak çağrılamaz; iki katmanlı onay ister.
 * `POST /rates/book` yalnızca tüm bayraklar açıkken çalışır.
 */
async function bookOffer(input) {
  await bookingGate();
  if (!input.offerId || typeof input.offerId !== 'string') {
    const error = new Error('Geçerli bir teklif kimliği gerekli.');
    error.code = 'invalid_offer';
    throw error;
  }
  const guest = input.guest || {};
  const firstName = String(guest.firstName || '').trim();
  const lastName = String(guest.lastName || '').trim();
  const email = String(guest.email || '').trim();
  if (!firstName || !lastName || !email) {
    const error = new Error('Misafir adı, soyadı ve e-posta zorunludur.');
    error.code = 'invalid_guest';
    throw error;
  }

  // Rezervasyondan hemen önce teklif tazelenir; fiyat değiştiyse onay istenir.
  const fresh = await searchPropertyRates({ ...input, refresh: true });
  const offer = fresh.offers.find((entry) => entry.offerId === input.offerId);
  if (!offer) {
    const error = new Error('Teklif artık geçerli değil. Fiyatları yenileyin.');
    error.code = 'offer_expired';
    throw error;
  }
  if (
    input.expectedPriceCents &&
    Math.abs(offer.priceCents - Number(input.expectedPriceCents)) > 1
  ) {
    const error = new Error('Fiyat değişti. Güncel fiyatı onaylamadan rezervasyon oluşturulamaz.');
    error.code = 'price_changed';
    error.offer = offer;
    throw error;
  }
  if (!offer.paymentAtProperty) {
    const error = new Error('Bu teklif tesiste ödemeyi desteklemiyor.');
    error.code = 'payment_not_supported';
    throw error;
  }

  const intent = await serviceRpc('acc_liteapi_create_booking_intent', {
    p_property_id: input.propertyId,
    p_external_hotel_id: fresh.hotelId,
    p_offer_id: offer.offerId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_adults: fresh.adults,
    p_children: fresh.children,
    p_guest: guest,
    p_price_cents: offer.priceCents,
    p_currency: offer.currency,
    p_payment_type: offer.paymentAtProperty ? 'PROPERTY_PAY' : offer.paymentTypes[0] || null,
    p_payment_at_property: offer.paymentAtProperty,
    p_offer_snapshot: offer,
  });

  const bookingId = intent?.booking_id || null;
  if (!bookingId) {
    const error = new Error('Rezervasyon taslağı oluşturulamadı.');
    error.code = 'intent_failed';
    throw error;
  }

  try {
    const providerPayload = await bookRate({
      offerId: offer.offerId,
      guestInfo: {
        guestFirstName: firstName,
        guestLastName: lastName,
        guestEmail: email,
        guestPhone: String(guest.phone || '').trim() || undefined,
        guestCountry: String(guest.country || 'TR').toUpperCase().slice(0, 2),
      },
      paymentMethod: 'PROPERTY_PAY',
      // Sağlayıcı ek alanları istemciden değil, sunucudaki tekliften alınır.
      hotelId: fresh.hotelId,
    });

    const normalized = normalizeBookingResponse(providerPayload);
    // Yalnızca sağlayıcı açıkça onayladıysa "confirmed" yazılır.
    const confirmed = Boolean(normalized?.confirmed && normalized?.bookingId);
    await serviceRpc('acc_liteapi_confirm_booking', {
      p_booking_id: bookingId,
      p_status: confirmed ? 'confirmed' : 'pending_provider',
      p_provider_booking_id: normalized?.bookingId || null,
      p_provider_payload: providerPayload || {},
      p_error: confirmed ? null : 'Sağlayıcı rezervasyonu henüz onaylamadı.',
    });

    return {
      bookingId,
      status: confirmed ? 'confirmed' : 'pending_provider',
      providerBookingId: normalized?.bookingId || null,
      confirmed,
    };
  } catch (cause) {
    await serviceRpc('acc_liteapi_confirm_booking', {
      p_booking_id: bookingId,
      p_status: 'failed',
      p_provider_booking_id: null,
      p_provider_payload: {},
      p_error: cause instanceof Error ? cause.message : 'Rezervasyon sağlayıcıda tamamlanamadı.',
    }).catch(() => undefined);
    throw cause;
  }
}

module.exports = {
  searchPropertyRates,
  bookOffer,
  bookingGate,
  propertyContext,
  nightsBetween,
};
