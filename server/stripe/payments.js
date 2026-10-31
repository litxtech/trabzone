/**
 * Stripe ödeme iş kuralları.
 *
 * - Tutar her zaman rezervasyon taslağından (`acc_liteapi_bookings.price_cents`)
 *   okunur; istemciden gelen tutara güvenilmez.
 * - Durum yazımı `acc_payment_mark` üzerinden idempotent yapılır; aynı webhook
 *   olayı birden çok kez gelse bile tek kayıt oluşur.
 * - Webhook gövdesi **doğrulanmadan** kullanılmaz: olay, imza yerine Stripe
 *   API'sinden yeniden okunur (`retrieveEvent`). Böylece sahte gövde ile ödeme
 *   "ödendi" olarak işaretlenemez.
 */

const stripe = require('./client');
const { serviceRpc } = require('../liteapi/supabase');
const { finalizePaidBooking } = require('../liteapi/booking');

/** Veritabanındaki `uuid` parametreleri için biçim kontrolü. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function paymentIdOf(payment) {
  return payment && typeof payment.id === 'string' ? payment.id : null;
}

function checkoutUrls(paymentId) {
  const base = stripe.appUrl();
  const success = `${base}/konaklama/rezervasyonlarim?odeme=basarili&payment=${encodeURIComponent(paymentId)}`;
  const cancel = `${base}/konaklama/rezervasyonlarim?odeme=iptal&payment=${encodeURIComponent(paymentId)}`;
  return { success, cancel };
}

/** Stripe oturum durumunu kendi durum modelimize çevirir. */
function mapSessionStatus(session) {
  if (!session) return 'pending';
  if (session.payment_status === 'paid') return 'paid';
  if (session.status === 'expired') return 'expired';
  if (session.status === 'complete') return 'pending';
  return 'open';
}

function amountFromSession(session) {
  if (!session) return null;
  if (typeof session.amount_total === 'number') return session.amount_total;
  return null;
}

/**
 * Stripe hesabı canlı ödeme almaya hazır mı?
 *
 * Onboarding tamamlanmadan Checkout oturumu açılsa bile kart ödemesi geçmez;
 * bu yüzden kullanıcıya Stripe sayfasında hata göstermek yerine burada net bir
 * mesajla durulur. Sonuç 60 saniye önbelleklenir (her ödemede ek API çağrısı
 * yapılmaz).
 */
let accountCache = { at: 0, value: null };
async function assertCardPaymentsReady() {
  const now = Date.now();
  if (!accountCache.value || now - accountCache.at > 60_000) {
    const account = await stripe.retrieveAccount().catch(() => null);
    accountCache = { at: now, value: account };
  }
  const account = accountCache.value;
  // Hesap okunamazsa Stripe'ın kendi hatasına bırakılır.
  if (account && account.charges_enabled === false) {
    throw fail(
      'stripe_not_ready',
      'Kart ile ödeme henüz aktif değil: Stripe hesabının canlı ödeme onayı tamamlanmalı.',
    );
  }
}

/**
 * Rezervasyon taslağı için Checkout oturumu açar (veya açık olanı döndürür).
 */
async function startCheckout({ bookingId, userId, email, productName }) {
  if (!stripe.isConfigured()) {
    throw fail('not_configured', 'Sunucuda STRIPE_SECRET_KEY tanımlı değil.');
  }
  if (!bookingId) throw fail('invalid_booking', 'Rezervasyon kimliği gerekli.');
  if (!userId) throw fail('auth_required', 'Oturum gerekli.');

  await assertCardPaymentsReady();

  const started = await serviceRpc('acc_payment_start', {
    p_booking_id: bookingId,
    p_user_id: userId,
  });

  const paymentId = started?.payment_id;
  if (!paymentId) throw fail('payment_failed', 'Ödeme kaydı oluşturulamadı.');

  // Açık oturum varsa yeniden kullan: aynı rezervasyon için ikinci oturum açılmaz.
  if (started.checkout_url && started.status === 'open') {
    return {
      paymentId,
      status: started.status,
      amountCents: Number(started.amount_cents),
      currency: started.currency,
      url: started.checkout_url,
      reused: true,
    };
  }

  const urls = checkoutUrls(paymentId);
  const session = await stripe.createCheckoutSession({
    paymentId,
    bookingId,
    userId,
    amountCents: Number(started.amount_cents),
    currency: started.currency,
    email,
    productName,
    successUrl: urls.success,
    cancelUrl: urls.cancel,
  });

  if (!session || !session.url) {
    throw fail('payment_failed', 'Stripe ödeme oturumu oluşturulamadı.');
  }

  const expiresAt = session.expires_at
    ? new Date(session.expires_at * 1000).toISOString()
    : null;

  await serviceRpc('acc_payment_attach_session', {
    p_payment_id: paymentId,
    p_session_id: session.id,
    p_checkout_url: session.url,
    p_expires_at: expiresAt,
  });

  return {
    paymentId,
    status: mapSessionStatus(session),
    amountCents: Number(started.amount_cents),
    currency: started.currency,
    url: session.url,
    reused: false,
  };
}

/**
 * Ödeme "paid" ise sağlayıcı rezervasyonunu kesinleştirir.
 *
 * Sağlayıcı reddederse tutar otomatik iade edilir: misafirden para alınıp
 * karşılığında oda alınamaması kabul edilemez. Sağlayıcı isteği yalnızca bir kez
 * yapılır (`acc_liteapi_booking_claim_provider`), bu yüzden bu fonksiyon birden
 * çok webhook olayında çağrılsa da çift rezervasyon oluşmaz.
 */
async function reconcileBooking(payment) {
  if (!payment || payment.status !== 'paid' || !payment.booking_id) {
    return { booking: null, refunded: false };
  }

  let booking = null;
  let providerFailed = false;
  try {
    booking = await finalizePaidBooking({ bookingId: payment.booking_id });
  } catch (cause) {
    providerFailed = true;
    console.error(
      '[stripe-provider-booking]',
      cause && cause.code ? cause.code : 'failed',
      cause && cause.message ? cause.message : cause,
    );
  }

  if (providerFailed || booking?.status === 'failed') {
    try {
      await refundPayment({ paymentId: payment.id, amountCents: null });
      return { booking, refunded: true };
    } catch (cause) {
      // Zaten iade edilmişse veya Stripe iadeyi reddettiyse yönetici takip eder.
      console.error(
        '[stripe-auto-refund]',
        cause && cause.code ? cause.code : 'failed',
        cause && cause.message ? cause.message : cause,
      );
    }
  }

  return { booking, refunded: false };
}

/** Sunucu tarafı doğrulama: Stripe'tan oturumu okuyup durumu yazar. */
async function syncPayment(payment) {
  const paymentId = paymentIdOf(payment);
  if (!paymentId) throw fail('payment_not_found', 'Ödeme kaydı bulunamadı.');
  if (!stripe.isConfigured()) {
    return { paymentId, status: payment.status, amountCents: Number(payment.amount_cents) };
  }
  if (!payment.session_id) {
    return {
      paymentId,
      bookingId: payment.booking_id ?? null,
      status: payment.status,
      amountCents: Number(payment.amount_cents),
      currency: payment.currency,
      url: payment.checkout_url,
    };
  }

  const session = await stripe.retrieveCheckoutSession(payment.session_id);
  const status = mapSessionStatus(session);

  if (status !== payment.status) {
    await serviceRpc('acc_payment_mark', {
      p_payment_id: paymentId,
      p_status: status,
      p_payment_intent_id:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
      p_paid_cents: amountFromSession(session),
      p_event_id: null,
      p_event_type: 'checkout.session.synced',
      p_payload: {
        session_status: session.status,
        payment_status: session.payment_status,
      },
    });
  }

  return {
    paymentId,
    bookingId: payment.booking_id ?? null,
    status,
    amountCents: Number(payment.amount_cents),
    currency: payment.currency,
    url: payment.checkout_url,
    paidCents: amountFromSession(session),
  };
}

/** Ortak durum okuma: Stripe ile senkronlar ve sağlayıcı rezervasyonunu uzlaştırır. */
async function reconcilePaymentStatus({ payment, userId }) {
  if (payment.user_id && userId && payment.user_id !== userId) {
    throw fail('not_allowed', 'Bu rezervasyon size ait değil.');
  }
  const synced = await syncPayment(payment);
  const current = await serviceRpc('acc_payment_get', { p_payment_id: payment.id });
  const { booking, refunded } = await reconcileBooking(current || payment);

  return {
    ...synced,
    status: (current && current.status) || synced.status,
    booking,
    refunded,
  };
}

async function statusForBooking({ bookingId, userId }) {
  const payment = await serviceRpc('acc_payment_by_booking', { p_booking_id: bookingId });
  if (!payment) {
    return { bookingId, status: 'none', paymentId: null, booking: null, refunded: false };
  }
  const reconciled = await reconcilePaymentStatus({ payment, userId });
  return { bookingId, ...reconciled };
}

async function statusForPayment({ paymentId, userId }) {
  const payment = await serviceRpc('acc_payment_get', { p_payment_id: paymentId });
  if (!payment) throw fail('payment_not_found', 'Ödeme bulunamadı.');
  const reconciled = await reconcilePaymentStatus({ payment, userId });
  return { bookingId: payment.booking_id ?? null, ...reconciled };
}

/** Yönetici iadesi. Kısmi tutar verilmezse kalanın tamamı iade edilir. */
async function refundPayment({ paymentId, amountCents }) {
  if (!stripe.isConfigured()) {
    throw fail('not_configured', 'Sunucuda STRIPE_SECRET_KEY tanımlı değil.');
  }
  const payment = await serviceRpc('acc_payment_get', { p_payment_id: paymentId });
  if (!payment) throw fail('payment_not_found', 'Ödeme bulunamadı.');
  if (!payment.payment_intent_id) {
    throw fail('not_refundable', 'Ödeme henüz Stripe tarafında tamamlanmadı.');
  }
  if (!['paid', 'partially_refunded'].includes(payment.status)) {
    throw fail('not_refundable', 'Yalnızca ödenmiş bir kayıt iade edilebilir.');
  }

  const remaining = Number(payment.amount_cents) - Number(payment.refunded_cents || 0);
  const amount = amountCents && amountCents > 0 ? Math.min(amountCents, remaining) : remaining;
  if (amount <= 0) throw fail('not_refundable', 'İade edilecek tutar kalmadı.');

  const refund = await stripe.createRefund({
    paymentIntentId: payment.payment_intent_id,
    amountCents: amount,
  });

  const recorded = await serviceRpc('acc_payment_record_refund', {
    p_payment_id: paymentId,
    p_refunded_cents: amount,
    p_event_id: refund?.id ? `refund:${refund.id}` : null,
  });

  return {
    paymentId,
    refundId: refund?.id ?? null,
    refundedCents: recorded?.refunded_cents ?? amount,
    status: recorded?.status ?? 'partially_refunded',
  };
}

/**
 * Webhook işleme.
 *
 * `eventId` istemciden gelir ama gövdesine güvenilmez; olay Stripe'tan
 * yeniden okunur. Böylece imza sırrı olmadan da sahte istekler etkisizdir.
 */
async function handleEvent({ eventId }) {
  if (!stripe.isConfigured()) {
    throw fail('not_configured', 'Sunucuda STRIPE_SECRET_KEY tanımlı değil.');
  }
  if (!eventId || typeof eventId !== 'string' || !eventId.startsWith('evt_')) {
    throw fail('invalid_event', 'Geçerli bir Stripe olay kimliği gerekli.');
  }

  const event = await stripe.retrieveEvent(eventId);
  const type = event?.type || 'unknown';
  const object = event?.data?.object || {};

  const handled = new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.canceled',
    'charge.refunded',
    'charge.dispute.created',
  ]);

  if (!handled.has(type)) {
    return { received: true, ignored: true, type };
  }

  // Ödeme kaydı nesnenin neresinde olursa olsun bulunur. Oturum ve niyet
  // kimlikleri metin; ancak `metadata.payment_id` veritabanında `uuid` olduğu
  // için biçim kontrolünden geçmeli. Geçersiz bir değer (ör. elle oluşturulmuş
  // oturumun metadata'sı) RPC'yi 400 ile düşürüp webhook'u 502'ye sokuyor,
  // Stripe da olayı sonsuza kadar yeniden deniyordu.
  const sessionId =
    type.startsWith('checkout.session') && typeof object.id === 'string' ? object.id : null;
  const intentId =
    typeof object.payment_intent === 'string'
      ? object.payment_intent
      : object.payment_intent?.id ??
        (type.startsWith('payment_intent') && typeof object.id === 'string' ? object.id : null);
  const metaPaymentId =
    typeof object.metadata?.payment_id === 'string' &&
    UUID_RE.test(object.metadata.payment_id)
      ? object.metadata.payment_id
      : null;

  const payment =
    (sessionId
      ? await serviceRpc('acc_payment_by_session', { p_session_id: sessionId })
      : null) ||
    (intentId
      ? await serviceRpc('acc_payment_by_intent', { p_payment_intent_id: intentId })
      : null) ||
    (metaPaymentId
      ? await serviceRpc('acc_payment_get', { p_payment_id: metaPaymentId })
      : null);

  if (!payment) {
    return { received: true, ignored: true, type, reason: 'payment_not_found' };
  }

  const paymentId = payment.id;

  if (type === 'charge.refunded') {
    // `amount_refunded` kümülatiftir; farkı yaz.
    const totalRefunded = Number(object.amount_refunded || 0);
    const already = Number(payment.refunded_cents || 0);
    const delta = Math.max(0, totalRefunded - already);
    if (delta > 0) {
      await serviceRpc('acc_payment_record_refund', {
        p_payment_id: paymentId,
        p_refunded_cents: delta,
        p_event_id: `${event.id}:refund`,
      });
    }
    return { received: true, type, status: 'refunded' };
  }

  if (type === 'charge.dispute.created') {
    await serviceRpc('acc_payment_mark', {
      p_payment_id: paymentId,
      p_status: 'disputed',
      p_event_id: event.id,
      p_event_type: type,
      p_payload: { reason: object.reason ?? null },
    });
    return { received: true, type, status: 'disputed' };
  }

  let status = 'pending';
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    status = object.payment_status === 'paid' ? 'paid' : 'pending';
  } else if (type === 'checkout.session.async_payment_failed' || type === 'payment_intent.payment_failed') {
    status = 'failed';
  } else if (type === 'checkout.session.expired' || type === 'payment_intent.canceled') {
    status = 'expired';
  } else if (type === 'payment_intent.succeeded') {
    status = 'paid';
  }

  await serviceRpc('acc_payment_mark', {
    p_payment_id: paymentId,
    p_status: status,
    p_payment_intent_id:
      typeof object.payment_intent === 'string'
        ? object.payment_intent
        : object.payment_intent?.id ?? (type.startsWith('payment_intent') ? object.id : null),
    p_paid_cents:
      typeof object.amount_total === 'number'
        ? object.amount_total
        : typeof object.amount_received === 'number'
          ? object.amount_received
          : null,
    p_event_id: event.id,
    p_event_type: type,
    p_payload: { livemode: Boolean(event.livemode) },
  });

  // Ödeme onaylandıysa sağlayıcı rezervasyonunu kesinleştir (başarısızsa iade).
  let booking = null;
  if (status === 'paid') {
    const current = await serviceRpc('acc_payment_get', { p_payment_id: paymentId });
    const reconciled = await reconcileBooking(current || payment);
    booking = reconciled.booking;
  }

  return { received: true, type, status, booking };
}

module.exports = {
  startCheckout,
  statusForBooking,
  statusForPayment,
  assertCardPaymentsReady,
  refundPayment,
  handleEvent,
  syncPayment,
};
