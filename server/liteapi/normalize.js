/**
 * LiteAPI yanıtlarını Trabzone veri modeline çevirir.
 *
 * Sağlayıcı alan adları sürümler arasında değişebildiği için her alan birkaç
 * olası anahtardan okunur. Amaç ham yanıtı olduğu gibi veritabanına yazmak
 * değil; doğrulanmış, tek biçimli bir tesis/teklif nesnesi üretmektir.
 */

const { config } = require('./config');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function stripHtml(value) {
  if (!value) return null;
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeUrl(value) {
  const url = pickString(value);
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return null;
}

function extractPhotoUrls(raw) {
  const sources = [
    ...asArray(raw?.hotelImages),
    ...asArray(raw?.images),
    ...asArray(raw?.photos),
    ...asArray(raw?.hotelPhotos),
  ];
  const urls = [];
  for (const entry of sources) {
    if (typeof entry === 'string') {
      const url = normalizeUrl(entry);
      if (url) urls.push(url);
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const url = normalizeUrl(
      entry.url ?? entry.urlHd ?? entry.urlLowRes ?? entry.imageUrl ?? entry.src ?? entry.link,
    );
    if (url) urls.push(url);
  }
  return [...new Set(urls)].slice(0, 20);
}

function extractAmenities(raw) {
  const sources = [
    ...asArray(raw?.hotelFacilities),
    ...asArray(raw?.facilities),
    ...asArray(raw?.amenities),
    ...asArray(raw?.hotelAmenities),
  ];
  const items = [];
  for (const entry of sources) {
    if (typeof entry === 'string' && entry.trim()) {
      items.push(entry.trim());
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const name = pickString(entry.name, entry.title, entry.label, entry.facilityName);
    if (name) items.push(name);
  }
  return [...new Set(items)].slice(0, 60);
}

function extractId(raw) {
  return pickString(raw?.id, raw?.hotelId, raw?.hotel_id, raw?.code);
}

/**
 * Liste veya detay yanıtındaki ham otel nesnesini tek biçime getirir.
 * @param {Record<string, unknown>} raw
 */
function normalizeHotel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = extractId(raw);
  if (!id) return null;

  const reviewRatingRaw = raw.reviewRating ?? raw.rating ?? raw.reviewsScore ?? raw.score;
  const reviewRating =
    reviewRatingRaw && typeof reviewRatingRaw === 'object'
      ? pickNumber(reviewRatingRaw.score, reviewRatingRaw.value, reviewRatingRaw.average)
      : pickNumber(reviewRatingRaw);

  const reviewCount = pickNumber(
    raw.reviewCount,
    raw.reviewsCount,
    raw.reviews,
    raw.reviewCountTotal,
  );

  return {
    id,
    name: pickString(raw.name, raw.hotelName, raw.title) || `LiteAPI ${id}`,
    description: stripHtml(
      pickString(raw.hotelDescription, raw.description, raw.shortDescription, raw.longDescription),
    ),
    address: pickString(raw.address, raw.fullAddress, raw.street, raw.addressLine),
    city: pickString(raw.city, raw.cityName, raw.town),
    district: pickString(raw.district, raw.districtName, raw.town, raw.cityDistrict),
    country: pickString(raw.country, raw.countryCode),
    latitude: pickNumber(raw.latitude, raw.lat, raw.location?.latitude, raw.location?.lat),
    longitude: pickNumber(raw.longitude, raw.lng, raw.lon, raw.location?.longitude, raw.location?.lng),
    stars: pickNumber(raw.starRating, raw.stars, raw.star, raw.hotelRating),
    rating: reviewRating,
    reviewCount: reviewCount === null ? null : Math.max(0, Math.round(reviewCount)),
    amenities: extractAmenities(raw),
    photos: extractPhotoUrls(raw),
    phone: pickString(raw.phone, raw.telephone, raw.contactPhone),
    email: pickString(raw.email, raw.contactEmail),
    website: normalizeUrl(raw.website ?? raw.url),
    roomCapacity: pickNumber(raw.maxOccupancy, raw.capacity, raw.roomCapacity),
    checkinTime: pickString(raw.checkinTime, raw.checkInTime),
    checkoutTime: pickString(raw.checkoutTime, raw.checkOutTime),
    raw,
  };
}

function extractHotelList(payload) {
  if (!payload || typeof payload !== 'object') {
    return { hotels: [], total: 0 };
  }
  const container =
    (Array.isArray(payload.data) ? payload.data : null) ||
    (Array.isArray(payload.hotels) ? payload.hotels : null) ||
    (Array.isArray(payload.items) ? payload.items : null) ||
    (Array.isArray(payload) ? payload : null) ||
    [];
  const hotels = container.map(normalizeHotel).filter(Boolean);
  const total = pickNumber(
    payload.total,
    payload.totalCount,
    payload.totalResults,
    payload.count,
    payload.meta?.total,
  );
  return { hotels, total: total === null ? hotels.length : Math.max(0, Math.round(total)) };
}

function extractHotelDetail(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const raw = Array.isArray(payload.data) ? payload.data[0] : payload.data || payload.hotel || payload;
  return normalizeHotel(raw);
}

function amountFromPriceSource(source) {
  if (source === null || source === undefined) return null;
  if (typeof source === 'number' || typeof source === 'string') return pickNumber(source);
  if (Array.isArray(source)) {
    // LiteAPI retailRate.total: [{ amount, currency }]
    for (const entry of source) {
      const amount = amountFromPriceSource(entry);
      if (amount !== null) return amount;
    }
    return null;
  }
  if (typeof source === 'object') {
    return pickNumber(
      source.amount,
      source.total,
      source.value,
      source.price,
      source.gross,
      source.net,
      source.sellingPrice,
    );
  }
  return null;
}

function extractOfferPrice(offer) {
  const amount = amountFromPriceSource(
    offer?.price?.total ??
      offer?.price?.amount ??
      offer?.price ??
      offer?.retailRate?.total ??
      offer?.retailRate?.amount ??
      offer?.retailRate ??
      offer?.totalPrice ??
      offer?.total ??
      offer?.amount,
  );
  const currency = pickString(
    offer?.price?.currency,
    offer?.retailRate?.total?.[0]?.currency,
    offer?.retailRate?.currency,
    offer?.currency,
  );
  const taxesIncluded =
    offer?.price?.taxesIncluded ?? offer?.taxesIncluded ?? offer?.retailRate?.taxesIncluded;
  return {
    amount,
    currency: currency ? currency.toUpperCase().slice(0, 3) : config.defaultCurrency,
    taxesIncluded: taxesIncluded === true,
  };
}

function formatPolicyDate(value) {
  const text = pickString(value);
  if (!text) return null;
  const date = text.slice(0, 10);
  const time = text.length >= 16 ? text.slice(11, 16) : null;
  return time ? `${date} ${time}` : date;
}

function cancellationText(policies) {
  if (typeof policies === 'string' && policies.trim()) return policies.trim();
  if (!Array.isArray(policies) || policies.length === 0) return null;
  const parts = [];
  for (const policy of policies.slice(0, 4)) {
    if (typeof policy === 'string') {
      parts.push(policy);
      continue;
    }
    if (!policy || typeof policy !== 'object') continue;
    const from = formatPolicyDate(policy.from ?? policy.deadline ?? policy.date);
    const amount = pickNumber(policy.amount, policy.penaltyAmount, policy.charge);
    const percent = pickNumber(policy.percentage, policy.percent, policy.penaltyPercentage);
    const currency = pickString(policy.currency);
    if (percent !== null && percent > 0) {
      parts.push(from ? `${from} sonrası %${percent} ceza` : `%${percent} ceza`);
    } else if (amount !== null && amount > 0) {
      parts.push(
        from
          ? `${from} sonrası ${amount} ${currency || config.defaultCurrency} ceza`
          : `${amount} ${currency || config.defaultCurrency} ceza`,
      );
    } else {
      // Sıfır tutarlı politika, bu tarihe kadar ücretsiz iptal penceresidir.
      parts.push(from ? `${from} tarihine kadar ücretsiz iptal` : 'ücretsiz iptal');
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function extractPaymentTypes(offer) {
  const sources = [
    offer?.paymentTypes,
    offer?.paymentType,
    offer?.payment?.paymentTypes,
    offer?.payment?.type,
    offer?.paymentOptions,
  ];
  const values = [];
  for (const source of sources) {
    for (const entry of asArray(source)) {
      if (typeof entry === 'string' && entry.trim()) {
        values.push(entry.trim().toUpperCase());
      } else if (entry && typeof entry === 'object') {
        const name = pickString(entry.type, entry.name, entry.code);
        if (name) values.push(name.toUpperCase());
      }
    }
  }
  return [...new Set(values)];
}

function flattenOffers(payload, context) {
  const entries = [];
  const pushHotel = (hotel) => {
    if (!hotel || typeof hotel !== 'object') return;
    const hotelId = pickString(hotel.hotelId, hotel.id, context?.hotelId);
    const rooms = asArray(hotel.roomTypes ?? hotel.rooms ?? hotel.roomTypesData);
    if (rooms.length === 0) {
      for (const offer of asArray(hotel.offers ?? hotel.rates)) {
        entries.push({ hotelId, room: hotel, offer });
      }
      return;
    }
    for (const room of rooms) {
      const offers = asArray(room.offers ?? room.rates ?? room.ratePlans);
      if (offers.length === 0) {
        entries.push({ hotelId, room, offer: room });
        continue;
      }
      for (const offer of offers) {
        entries.push({ hotelId, room, offer });
      }
    }
  };

  const data = payload?.data;
  if (Array.isArray(data)) {
    data.forEach(pushHotel);
  } else if (data && typeof data === 'object') {
    pushHotel(data);
  }
  asArray(payload?.hotels).forEach(pushHotel);
  if (entries.length === 0) {
    asArray(payload?.offers).forEach((offer) => entries.push({ hotelId: context?.hotelId, room: null, offer }));
  }
  return entries;
}

function normalizeOffers(payload, context = {}) {
  const entries = flattenOffers(payload, context);
  const offers = [];
  const seen = new Set();

  for (const { hotelId, room, offer } of entries) {
    if (!offer || typeof offer !== 'object') continue;
    const offerId = pickString(offer.offerId, offer.id, offer.rateId, offer.offer_id);
    if (!offerId) continue;
    if (seen.has(offerId)) continue;
    seen.add(offerId);

    const price = extractOfferPrice(offer);
    if (price.amount === null || price.amount < 0) continue;

    const paymentTypes = extractPaymentTypes(offer);
    const propertyPay =
      paymentTypes.includes('PROPERTY_PAY') ||
      offer?.propertyPay === true ||
      offer?.payAtProperty === true;
    const policies = offer?.cancellationPolicies ?? offer?.cancellationPolicy ?? offer?.policies;
    const refundableRaw = offer?.refundable;
    const refundableTag = pickString(offer?.refundableTag, offer?.refundable_tag)?.toUpperCase() ?? null;
    const refundable =
      typeof refundableRaw === 'boolean'
        ? refundableRaw
        : refundableTag === 'RFN'
          ? true
          : refundableTag === 'NRF'
            ? false
            : Array.isArray(policies) && policies.length > 0
              ? policies.some((policy) => {
                  const amount = pickNumber(policy?.amount, policy?.penaltyAmount, policy?.charge);
                  const percent = pickNumber(policy?.percentage, policy?.percent, policy?.penaltyPercentage);
                  // LiteAPI ücretsiz iptal penceresini 0 tutarlı politika ile bildirir.
                  return (amount === null || amount <= 0) && (percent === null || percent <= 0);
                })
              : null;

    offers.push({
      offerId,
      hotelId: hotelId || context.hotelId || null,
      roomName:
        pickString(
          room?.name,
          room?.roomTypeName,
          room?.roomName,
          room?.description,
          offer?.roomName,
          offer?.roomType,
        ) || 'Oda',
      boardName:
        pickString(
          offer?.boardName,
          offer?.boardType,
          offer?.mealPlan,
          offer?.board,
          room?.boardName,
          room?.boardType,
        ) || null,
      priceCents: Math.round(price.amount * 100),
      currency: price.currency,
      taxesIncluded: price.taxesIncluded,
      refundable,
      cancellationPolicy: cancellationText(policies),
      paymentTypes,
      paymentAtProperty: Boolean(propertyPay),
      onlinePayment: paymentTypes.some((type) =>
        ['CREDIT_CARD', 'ONLINE_PAY', 'PAYMENT_GATEWAY'].includes(type),
      ),
      maxOccupancy: pickNumber(offer?.maxOccupancy, offer?.occupancy, room?.maxOccupancy),
      availableRooms: pickNumber(offer?.availableRooms, offer?.remaining, room?.availableRooms),
      raw: offer,
    });
  }

  offers.sort((a, b) => a.priceCents - b.priceCents);
  const trimmed = offers.slice(0, config.maxOffers);
  const currencies = [...new Set(trimmed.map((offer) => offer.currency))];

  return {
    hotelId: context.hotelId || trimmed[0]?.hotelId || null,
    offers: trimmed,
    propertyPayAvailable: trimmed.some((offer) => offer.paymentAtProperty),
    currency: currencies.length === 1 ? currencies[0] : (currencies[0] || config.defaultCurrency),
    currencies,
  };
}

function normalizeBookingResponse(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const bookingId = pickString(
    data.bookingId,
    data.id,
    data.booking_id,
    data.confirmationCode,
    payload.bookingId,
  );
  const status = pickString(data.status, data.bookingStatus, data.state);
  return {
    bookingId,
    status,
    confirmed:
      typeof status === 'string' &&
      ['confirmed', 'booked', 'success', 'ok'].includes(status.toLowerCase()),
    hotelConfirmationCode: pickString(
      data.hotelConfirmationCode,
      data.confirmationCode,
      data.supplierBookingId,
    ),
    priceCents: (() => {
      const amount = amountFromPriceSource(
        data.price?.total ?? data.price ?? data.retailRate?.total ?? data.total,
      );
      return amount === null ? null : Math.round(amount * 100);
    })(),
    currency: pickString(data.currency, data.price?.currency)?.toUpperCase() ?? null,
    raw: payload,
  };
}

module.exports = {
  normalizeHotel,
  extractHotelList,
  extractHotelDetail,
  normalizeOffers,
  normalizeBookingResponse,
  helper: { asArray, pickString, pickNumber, stripHtml },
};
