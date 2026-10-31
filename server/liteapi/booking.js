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
const { searchRates: providerRates, prebookRate, bookRate } = require('./http');
const { normalizeOffers, normalizeBookingResponse } = require('./normalize');
const { applyMarkupToOffer } = require('./pricing');
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
 * Sağlayıcıya oda/fiyat sorgusu gönderir.
 *
 * `guestNationality` Nuitee'de **pazar** anlamına gelir ve müsaitliği
 * değiştirir: aynı tesis/tarih TR pazarında "no availability" dönerken US
 * pazarında satılabilir olabiliyor. Bu yüzden pazarlar sırayla denenir.
 */
async function providerRatesForHotels({
  hotelIds,
  checkIn,
  checkOut,
  adults,
  childrenAges: ages,
  currency,
  guestNationality,
  maxRatesPerHotel,
}) {
  return providerRates({
    hotelIds,
    checkin: checkIn,
    checkout: checkOut,
    occupancies: [{ adults, children: Array.isArray(ages) ? ages : [] }],
    guestNationality,
    currency,
    maxRatesPerHotel: maxRatesPerHotel ?? config.maxOffers,
  });
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

  // Pazar (misafir uyruğu) sırayla denenir: TR pazarında birçok sağlayıcı
  // tesisinin oda stoğu boş dönüyor; ilk pazarda oda varsa orada durulur.
  const ages = childAges(children, input.childrenAges);
  const markets = config.rateMarkets;
  let normalized = null;
  for (const guestNationality of markets) {
    const payload = await providerRatesForHotels({
      hotelIds: [hotelId],
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      adults,
      childrenAges: ages,
      currency,
      guestNationality,
      maxRatesPerHotel: config.maxOffers,
    });
    normalized = normalizeOffers(payload, { hotelId });
    if (normalized.offers.length > 0) break;
  }
  if (!normalized) normalized = normalizeOffers(null, { hotelId });
  // Sağlayıcı fiyatları Trabzone'un maliyetidir; misafire ve Stripe'a marj
  // eklenmiş toplam fiyat gider. `basePriceCents`/`markupCents` yalnızca sunucu
  // tarafında kalır (API yanıtında çıkarılır).
  const result = {
    ...normalized,
    offers: normalized.offers.map(applyMarkupToOffer),
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

  // Liste kartlarındaki "gecelik başlangıç" fiyatını da tazele (marj dahil).
  // Yalnızca canlı sorguda yazılır; önbellek yanıtında ek yazma yapılmaz.
  const nights = result.nights;
  if (!result.cached && result.offers.length > 0 && nights > 0) {
    const nightly = Math.round(result.offers[0].priceCents / nights);
    await serviceRpc('acc_liteapi_set_property_price', {
      p_property_id: context.property_id,
      p_price_cents: nightly,
      p_currency: result.currency,
    }).catch((cause) => {
      console.warn(
        '[liteapi] list price update failed',
        cause && cause.message ? cause.message : cause,
      );
    });
  }

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

/** Misafir alanlarını doğrular; sağlayıcıya giden alanlar buradan üretilir. */
function validateGuest(guest) {
  const source = guest || {};
  const firstName = String(source.firstName || '').trim();
  const lastName = String(source.lastName || '').trim();
  const email = String(source.email || '').trim();
  if (!firstName || !lastName || !email) {
    const error = new Error('Misafir adı, soyadı ve e-posta zorunludur.');
    error.code = 'invalid_guest';
    throw error;
  }
  return {
    firstName,
    lastName,
    email,
    phone: String(source.phone || '').trim() || null,
    country: (String(source.country || 'TR').trim() || 'TR').toUpperCase().slice(0, 2),
  };
}

/**
 * Teklifi doğrular ve güncel fiyatı belirler.
 *
 * ÖNEMLİ: LiteAPI her `/hotels/rates` isteğinde **yeni** `offerId` üretir.
 * Bu yüzden "fiyatları tazele, aynı offerId'yi ara" yaklaşımı her rezervasyonu
 * `offer_expired` ile reddediyordu. Doğru kaynak, istemcinin gördüğü önbellek
 * anlık görüntüsü + sağlayıcının ücretsiz **prebook** doğrulamasıdır:
 *
 *   1) Teklif önbellekte varsa fiyat/oda bilgisi oradan alınır (kullanıcının
 *      gördüğü tutar budur).
 *   2) `POST /rates/prebook` teklifi kilitler ve kesin maliyeti döner. Bu çağrı
 *      ücretsizdir ve rezervasyon oluşturmaz.
 *   3) Prebook "geçersiz/süresi dolmuş teklif" derse teklif gerçekten ölmüştür.
 *      Bu durumda kullanıcıya hata göstermek yerine **aynı oda/pansiyon** için
 *      taze bir teklif seçilir; fiyat değişmediyse akış kesintisiz sürer,
 *      değiştiyse `price_changed` ile onay istenir.
 *
 * Önbellekte bulunamayan (ör. süresi geçmiş) tekliflerde prebook yanıtından
 * asgari bir teklif nesnesi kurulur; böylece yeni offerId üretilmiş olması
 * kullanıcıyı engellemez.
 */
async function resolveFreshOffer(input) {
  // 1) İstemcinin gördüğü anlık görüntü — yalnızca önbellekten okunur.
  let snapshot = await searchPropertyRates({ ...input, refresh: false });
  let cachedOffer = snapshot.offers.find((entry) => entry.offerId === input.offerId) || null;
  let offerId = input.offerId;

  // 2) Sağlayıcıda doğrula (ücretsiz, teklifi kilitler).
  let prebookPayload = null;
  let expired = false;
  try {
    prebookPayload = await prebookRate({ offerId, usePaymentSdk: false });
  } catch (cause) {
    if (isExpiredOfferError(cause)) {
      expired = true;
    } else if (!cachedOffer) {
      // Ağ/zaman aşımı gibi geçici hatalarda fiyat önbellekten doğrulanır.
      const error = new Error('Teklif sağlayıcıda doğrulanamadı.');
      error.code = 'provider_unavailable';
      throw error;
    }
  }

  // 3) Teklif gerçekten ölmüşse aynı oda/pansiyon grubunda taze teklif seçilir.
  //    Teklif 10 dakikadan uzun süre ekranda kaldığında (ya da kullanıcı
  //    Stripe sayfasından geç döndüğünde) bu yol sık çalışır.
  if (expired) {
    let refreshed = null;
    try {
      refreshed = await searchPropertyRates({ ...input, refresh: true });
    } catch (cause) {
      console.warn(
        '[liteapi] offer refresh failed',
        cause && cause.message ? cause.message : cause,
      );
    }
    const replacement = refreshed ? pickReplacementOffer(refreshed, cachedOffer) : null;
    if (!replacement) {
      const error = new Error(
        'Seçtiğin oda artık müsait değil. Fiyatları yenileyip başka bir oda seçebilirsin.',
      );
      error.code = 'offer_expired';
      throw error;
    }
    snapshot = refreshed;
    cachedOffer = replacement;
    offerId = replacement.offerId;
    prebookPayload = null;
    try {
      prebookPayload = await prebookRate({ offerId, usePaymentSdk: false });
    } catch (cause) {
      if (isExpiredOfferError(cause)) {
        const error = new Error(
          'Seçtiğin oda artık müsait değil. Fiyatları yenileyip başka bir oda seçebilirsin.',
        );
        error.code = 'offer_expired';
        throw error;
      }
      // Geçici hatada taze önbellek teklifiyle devam edilir.
    }
  }

  const providerCostCents = prebookCostCents(prebookPayload);
  const offer = cachedOffer
    ? // Önbellekteki maliyet ile sağlayıcının kesin maliyeti uyuşmuyorsa
      // güncel maliyeti esas al (marj yeniden uygulanır).
      providerCostCents !== null &&
      Math.abs(providerCostCents - Number(cachedOffer.basePriceCents ?? cachedOffer.priceCents)) > 1
      ? applyMarkupToOffer({
          ...cachedOffer,
          priceCents: providerCostCents,
          basePriceCents: undefined,
          markupCents: undefined,
        })
      : cachedOffer
    : offerFromPrebook(prebookPayload, { ...input, offerId });

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
  return { fresh: snapshot, offer };
}

/**
 * Süresi dolan teklifin yerine aynı oda/pansiyon grubunda, gösterilen fiyata en
 * yakın taze teklifi seçer. Grup bulunamazsa tüm teklifler arasından seçer.
 * Fiyat farkı `expectedPriceCents` kontrolünde yakalanır; burada yalnızca
 * "satılabilir bir teklif var mı" sorusuna cevap verilir.
 */
function pickReplacementOffer(snapshot, previous) {
  const roomName = previous?.roomName ?? null;
  const boardName = previous?.boardName ?? null;
  const reference = Number(previous?.priceCents ?? 0);
  const sameGroup = snapshot.offers.filter(
    (entry) =>
      (!roomName || entry.roomName === roomName) &&
      (!boardName || entry.boardName === boardName),
  );
  const candidates = sameGroup.length > 0 ? sameGroup : snapshot.offers;
  if (candidates.length === 0) return null;
  if (!previous || reference <= 0) return candidates[0];
  return candidates.reduce((winner, entry) =>
    Math.abs(entry.priceCents - reference) < Math.abs(winner.priceCents - reference)
      ? entry
      : winner,
  );
}

/**
 * Prebook yanıtından teklif nesnesi üretir (önbellekte bulunamayan teklifler).
 * Fiyat, sağlayıcı maliyetine marj uygulanarak hesaplanır.
 */
function offerFromPrebook(payload, input) {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const room = Array.isArray(root.roomTypes) ? root.roomTypes[0] : null;
  const rate = room && Array.isArray(room.rates) ? room.rates[0] : null;
  const costCents = prebookCostCents(payload);
  if (costCents === null) return null;
  const policies = rate?.cancellationPolicies ?? null;
  const paymentTypes = (() => {
    const values = [];
    for (const source of [rate?.paymentTypes, root.paymentTypes]) {
      for (const entry of Array.isArray(source) ? source : source ? [source] : []) {
        const name = typeof entry === 'string' ? entry : entry?.type ?? entry?.name;
        if (name) values.push(String(name).toUpperCase());
      }
    }
    return values.length > 0 ? values : ['NUITEE_PAY'];
  })();
  const refundableTag = String(policies?.refundableTag || '').toUpperCase();
  return applyMarkupToOffer({
    offerId: input.offerId,
    hotelId: root.hotelId || null,
    roomName: rate?.name || room?.name || 'Oda',
    boardName: rate?.boardName || rate?.boardType || null,
    priceCents: costCents,
    currency: String(rate?.retailRate?.total?.[0]?.currency || root.currency || 'TRY')
      .toUpperCase()
      .slice(0, 3),
    taxesIncluded: true,
    refundable: refundableTag === 'RFN' ? true : refundableTag ? false : null,
    cancellationPolicy: null,
    paymentTypes,
    paymentAtProperty: paymentTypes.includes('PROPERTY_PAY'),
    onlinePayment: paymentTypes.some((type) =>
      ['CREDIT_CARD', 'ONLINE_PAY', 'PAYMENT_GATEWAY'].includes(type),
    ),
  });
}

/** Sağlayıcı "teklif geçersiz/süresi dolmuş" dedi mi? */
function isExpiredOfferError(cause) {
  const payload = cause && cause.payload;
  const description = String(
    payload && payload.error
      ? `${payload.error.description ?? ''} ${payload.error.message ?? ''}`
      : cause && cause.message
        ? cause.message
        : '',
  ).toLowerCase();
  return /invalid offer|outdated offer|offer.*(expired|not found|invalid)|no availability/.test(
    description,
  );
}

/**
 * Ödeme tamamlanana kadar teklifin süresi dolabilir (Stripe Checkout dakikalar
 * sürebilir). Bu durumda misafiri iadeye düşürmek yerine aynı oda/board ve aynı
 * maliyetle yeni bir teklif seçilir. Maliyet anlamlı ölçüde arttıysa `null`
 * döner; çağıran katman iadeyi yapar ve misafirden fazla para alınmaz.
 */
async function repickOfferForBooking(booking) {
  const snapshot = booking.offer_snapshot || {};
  const chargedBase = Number(booking.base_price_cents ?? booking.price_cents ?? 0);
  let rates;
  try {
    rates = await searchPropertyRates({
      propertyId: booking.property_id,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      adults: booking.adults,
      children: booking.children,
      currency: booking.currency,
      refresh: true,
    });
  } catch (cause) {
    console.warn('[liteapi] offer repick failed', cause && cause.message ? cause.message : cause);
    return null;
  }

  const sameRoom = rates.offers.filter(
    (entry) =>
      (!snapshot.roomName || entry.roomName === snapshot.roomName) &&
      (!snapshot.boardName || entry.boardName === snapshot.boardName),
  );
  const candidates = sameRoom.length > 0 ? sameRoom : rates.offers;
  const distance = (entry) =>
    Math.abs(Number(entry.basePriceCents ?? entry.priceCents) - chargedBase);
  const best = candidates.reduce(
    (winner, entry) => (winner === null || distance(entry) < distance(winner) ? entry : winner),
    null,
  );
  if (!best) return null;
  const newBase = Number(best.basePriceCents ?? best.priceCents);
  if (chargedBase > 0 && newBase > Math.round(chargedBase * 1.01)) {
    console.warn('[liteapi] offer repick price increased', newBase, 'vs charged', chargedBase);
    return null;
  }
  return best;
}

/**
 * ÖN ÖDEMELİ AKIŞ — 1. adım: sağlayıcıya gitmeden rezervasyon taslağı açar.
 *
 * Taslak `status='intent'` olarak yazılır; sağlayıcı rezervasyonu ancak Stripe
 * ödemesi onaylandıktan sonra (`finalizePaidBooking`) yapılır. Böylece misafir
 * ödeme yapmadan sağlayıcıda rezervasyon oluşmaz, ödeme alınmadan da oda
 * kilitlenmez.
 */
async function createPrepaidDraft(input) {
  if (!input.userId) {
    const error = new Error('Oturum gerekli.');
    error.code = 'auth_required';
    throw error;
  }
  await bookingGate();
  if (!input.offerId || typeof input.offerId !== 'string') {
    const error = new Error('Geçerli bir teklif kimliği gerekli.');
    error.code = 'invalid_offer';
    throw error;
  }
  const guest = validateGuest(input.guest);
  const { fresh, offer } = await resolveFreshOffer(input);

  const intent = await serviceRpc('acc_liteapi_create_booking_intent_priced', {
    p_user_id: input.userId,
    p_property_id: input.propertyId,
    p_external_hotel_id: fresh.hotelId,
    p_offer_id: offer.offerId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_adults: fresh.adults,
    p_children: fresh.children,
    p_guest: {
      firstName: guest.firstName,
      lastName: guest.lastName,
      email: guest.email,
      phone: guest.phone,
      country: guest.country,
    },
    p_price_cents: offer.priceCents,
    p_base_price_cents: offer.basePriceCents ?? offer.priceCents,
    p_markup_cents: offer.markupCents ?? 0,
    p_markup_bps: config.markupBps,
    p_currency: offer.currency,
    p_payment_type: offer.paymentAtProperty ? 'PROPERTY_PAY' : offer.paymentTypes[0] || 'NUITEE_PAY',
    p_payment_at_property: offer.paymentAtProperty,
    p_offer_snapshot: offer,
  });

  const bookingId = intent?.booking_id || null;
  if (!bookingId) {
    const error = new Error('Rezervasyon taslağı oluşturulamadı.');
    error.code = 'intent_failed';
    throw error;
  }

  return {
    bookingId,
    priceCents: offer.priceCents,
    currency: offer.currency,
    roomName: offer.roomName,
    paymentAtProperty: offer.paymentAtProperty,
  };
}

/**
 * ÖN ÖDEMELİ AKIŞ — 2. adım: ödeme onaylandıktan sonra sağlayıcı rezervasyonu.
 *
 * `acc_liteapi_booking_claim_provider` ile taslak atomik olarak sahiplenilir;
 * iki Stripe olayı aynı anda gelse bile sağlayıcıya tek istek gider.
 * Sağlayıcı reddederse rezervasyon `failed` yazılır ve çağıran katman
 * (payments.js) tutarı otomatik iade eder.
 */
async function finalizePaidBooking({ bookingId }) {
  const booking = await serviceRpc('acc_liteapi_booking_get', { p_booking_id: bookingId });
  if (!booking) {
    const error = new Error('Rezervasyon taslağı bulunamadı.');
    error.code = 'booking_not_found';
    throw error;
  }
  if (booking.status === 'confirmed') {
    return {
      bookingId,
      status: 'confirmed',
      providerBookingId: booking.provider_booking_id || null,
      confirmed: true,
      already: true,
    };
  }
  if (booking.status === 'failed' || booking.status === 'cancelled') {
    return { bookingId, status: booking.status, confirmed: false, already: true };
  }
  if (booking.status !== 'intent') {
    // 'pending_provider': başka bir olay hâlâ sağlayıcıyla konuşuyor.
    return { bookingId, status: 'pending_provider', confirmed: false, inFlight: true };
  }

  const claimed = await serviceRpc('acc_liteapi_booking_claim_provider', {
    p_booking_id: bookingId,
  });
  if (claimed !== true) {
    return { bookingId, status: 'pending_provider', confirmed: false, inFlight: true };
  }

  const guest = booking.guest || {};
  try {
    const guestInfo = {
      guestFirstName: String(guest.firstName || '').trim(),
      guestLastName: String(guest.lastName || '').trim(),
      guestEmail: String(guest.email || '').trim(),
      guestPhone: guest.phone || undefined,
      guestCountry: String(guest.country || 'TR').toUpperCase().slice(0, 2),
    };
    const paymentMethod = config.prepaidPaymentMethod;

    // Güncel LiteAPI akışı: önce teklifi kilitle (prebook), sonra öde.
    // Prebook ücretsizdir. Teklifin süresi dolmuşsa aynı oda/board için yeni
    // bir teklif seçilir; aksi halde misafir ödeme yaptıktan sonra iadeye
    // düşerdi.
    let offerId = booking.offer_id;
    let prebookPayload = null;
    try {
      prebookPayload = await prebookRate({ offerId, usePaymentSdk: false });
    } catch (cause) {
      console.warn(
        '[liteapi] prebook failed',
        cause && cause.message ? cause.message : cause,
      );
      if (isExpiredOfferError(cause)) {
        const repicked = await repickOfferForBooking(booking);
        if (repicked) {
          offerId = repicked.offerId;
          try {
            prebookPayload = await prebookRate({ offerId, usePaymentSdk: false });
          } catch (retryCause) {
            console.warn(
              '[liteapi] repick prebook failed',
              retryCause && retryCause.message ? retryCause.message : retryCause,
            );
          }
        }
      }
    }
    const prebookId = extractPrebookId(prebookPayload);

    // Misafir Stripe'ta zaten ödedi: sağlayıcı maliyeti o sırada hesaplanan
    // maliyetin üstüne çıktıysa rezervasyon yapılmaz, ödeme iade edilir.
    // (Prebook, kesinleşen fiyatı döner; %1 tolerans yuvarlama içindir.)
    const providerCostCents = prebookCostCents(prebookPayload);
    const chargedBaseCents = Number(booking.base_price_cents ?? booking.price_cents ?? 0);
    if (
      providerCostCents !== null &&
      chargedBaseCents > 0 &&
      providerCostCents > Math.round(chargedBaseCents * 1.01)
    ) {
      const error = new Error(
        `Sağlayıcı fiyatı değişti (${providerCostCents} > ${chargedBaseCents} kuruş).`,
      );
      error.code = 'price_changed';
      throw error;
    }

    const providerPayload = await placeProviderBooking({
      prebookId,
      paymentMethod,
      guestInfo,
      offerId,
      hotelId: booking.external_hotel_id,
    });

    const normalized = normalizeBookingResponse(providerPayload);
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
    const message =
      cause instanceof Error ? cause.message : 'Rezervasyon sağlayıcıda tamamlanamadı.';
    await serviceRpc('acc_liteapi_confirm_booking', {
      p_booking_id: bookingId,
      p_status: 'failed',
      p_provider_booking_id: null,
      p_provider_payload: {},
      p_error: message,
    }).catch(() => undefined);

    const error = new Error(message);
    error.code = 'provider_booking_failed';
    throw error;
  }
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
  const guest = validateGuest(input.guest);

  // Rezervasyondan hemen önce teklif tazelenir; fiyat değiştiyse onay istenir.
  const { fresh, offer } = await resolveFreshOffer(input);
  if (!offer.paymentAtProperty) {
    const error = new Error('Bu teklif tesiste ödemeyi desteklemiyor.');
    error.code = 'payment_not_supported';
    throw error;
  }

  const intent = await serviceRpc('acc_liteapi_create_booking_intent_priced', {
    p_user_id: input.userId,
    p_property_id: input.propertyId,
    p_external_hotel_id: fresh.hotelId,
    p_offer_id: offer.offerId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_adults: fresh.adults,
    p_children: fresh.children,
    p_guest: {
      firstName: guest.firstName,
      lastName: guest.lastName,
      email: guest.email,
      phone: guest.phone,
      country: guest.country,
    },
    p_price_cents: offer.priceCents,
    p_base_price_cents: offer.basePriceCents ?? offer.priceCents,
    p_markup_cents: offer.markupCents ?? 0,
    p_markup_bps: config.markupBps,
    p_currency: offer.currency,
    p_payment_type: 'PROPERTY_PAY',
    p_payment_at_property: true,
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
        guestFirstName: guest.firstName,
        guestLastName: guest.lastName,
        guestEmail: guest.email,
        guestPhone: guest.phone || undefined,
        guestCountry: guest.country,
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

/**
 * Prebook yanıtından `prebookId` çıkarır. Sağlayıcı sürümüne göre alan
 * `data.prebookId` veya `data.booking.prebookId` olabilir.
 */
function extractPrebookId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const candidates = [root.prebookId, root.prebook_id, root.booking?.prebookId, payload.prebookId];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Prebook yanıtındaki **sağlayıcı maliyeti** (kuruş).
 * `retailRate.total` dizi (`[{amount, currency}]`) veya nesne olabilir.
 */
function prebookCostCents(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const pickAmount = (source) => {
    if (Array.isArray(source)) {
      for (const entry of source) {
        const value = pickAmount(entry);
        if (value !== null) return value;
      }
      return null;
    }
    if (source && typeof source === 'object') {
      return pickAmount(source.amount ?? source.total ?? source.value ?? null);
    }
    const numeric = Number(source);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  };

  const room = Array.isArray(root.roomTypes) ? root.roomTypes[0] : null;
  const rate = room && Array.isArray(room.rates) ? room.rates[0] : null;
  const amount =
    pickAmount(root.price?.total) ??
    pickAmount(root.price?.amount) ??
    pickAmount(rate?.retailRate?.total) ??
    pickAmount(rate?.retailRate?.amount) ??
    pickAmount(rate?.retailRate) ??
    pickAmount(root.sellingPriceToUser?.amount);
  return amount === null ? null : Math.round(amount * 100);
}

/** Sağlayıcı "ödeme yöntemi/bakiye" hatası mı? Yalnızca bunlarda fallback yapılır. */
function isPaymentMethodError(cause) {
  const description = String(
    cause && cause.payload && cause.payload.error
      ? `${cause.payload.error.description ?? ''} ${cause.payload.error.message ?? ''}`
      : cause && cause.message
        ? cause.message
        : '',
  ).toLowerCase();
  return /payment method|balance|insufficient|credit|not enabled|declined/.test(description);
}

/**
 * Sağlayıcıda rezervasyonu tamamlar.
 *
 * `payment.method` hesabın gerçek kurulumuna bağlıdır (bakiye, hesaba tanımlı
 * kart, cüzdan). İlk yöntem reddedilirse ve hata açıkça "ödeme yöntemi/bakiye"
 * ise diğerleri sırayla denenir. Yalnızca ödeme aşamasında reddedilen istek
 * tekrar denenir; onaylanmış bir rezervasyon asla ikinci kez gönderilmez
 * (`confirm` yanıtı bookingId taşır ve buraya geri dönülmez).
 */
async function placeProviderBooking({ prebookId, paymentMethod, guestInfo, offerId, hotelId }) {
  const methods = [paymentMethod, ...config.prepaidPaymentFallbacks].filter(
    (method, index, list) => method && list.indexOf(method) === index,
  );

  const attempt = async (method) =>
    prebookId
      ? bookRate({
          prebookId,
          holder: {
            firstName: guestInfo.guestFirstName,
            lastName: guestInfo.guestLastName,
            email: guestInfo.guestEmail,
          },
          guests: [
            {
              occupancyNumber: 1,
              firstName: guestInfo.guestFirstName,
              lastName: guestInfo.guestLastName,
              email: guestInfo.guestEmail,
            },
          ],
          payment: { method },
          hotelId,
        })
      : bookRate({ offerId, guestInfo, paymentMethod: method, hotelId });

  let lastError = null;
  for (const method of methods) {
    try {
      return await attempt(method);
    } catch (cause) {
      lastError = cause;
      if (!isPaymentMethodError(cause)) break;
      console.warn(
        '[liteapi] booking payment method rejected',
        method,
        cause && cause.message ? cause.message : cause,
      );
    }
  }
  throw lastError || new Error('Rezervasyon sağlayıcıda tamamlanamadı.');
}

module.exports = {
  searchPropertyRates,
  bookOffer,
  createPrepaidDraft,
  finalizePaidBooking,
  bookingGate,
  propertyContext,
  nightsBetween,
  childAges,
  providerRatesForHotels,
};
