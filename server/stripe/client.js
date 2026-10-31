/**
 * Stripe REST istemcisi (sunucu tarafı).
 *
 * Neden resmî SDK değil: Vercel Hobby planında 12 serverless fonksiyon sınırı
 * var; ek bağımlılık ve paket boyutu yerine yalnızca ihtiyaç duyduğumuz dört
 * çağrı (Checkout oturumu, oturum sorgusu, iade, olay sorgusu) doğrudan REST
 * üzerinden yapılır.
 *
 * Gizli anahtar yalnızca `STRIPE_SECRET_KEY` ortam değişkeninden okunur ve
 * hiçbir yanıta/loga yazılmaz.
 */

const API_BASE = 'https://api.stripe.com/v1';

/**
 * Ortam değerlerini kırpar. CLI/panodan yapıştırılan değerlerde kalan
 * `\r`/`\n`, `"true\r"` veya `"whsec_...\r"` gibi sessiz hatalara yol açıyordu.
 */
function envValue(name) {
  const raw = process.env[name];
  return raw === undefined ? '' : String(raw).replace(/[\r\n\t]+/g, '').trim();
}

function secretKey() {
  return envValue('STRIPE_SECRET_KEY');
}

function isConfigured() {
  return secretKey().length > 0;
}

function defaultCurrency() {
  return (envValue('STRIPE_CURRENCY') || 'TRY').toUpperCase().slice(0, 3);
}

function appUrl() {
  const raw = envValue('EXPO_PUBLIC_APP_URL') || 'https://www.trabzoneapp.com';
  return raw.replace(/\/+$/, '');
}

class StripeError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'StripeError';
    this.code = options.code || 'stripe_error';
    this.status = options.status ?? null;
    this.type = options.type ?? null;
    this.param = options.param ?? null;
  }
}

/** Stripe form gövdesi: iç içe nesneler `a[b][c]` biçiminde düzleştirilir. */
function encode(params, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (entry === undefined || entry === null) return;
        if (typeof entry === 'object') encode(entry, `${name}[${index}]`, out);
        else out.append(`${name}[${index}]`, String(entry));
      });
      continue;
    }
    if (typeof value === 'object') {
      encode(value, name, out);
      continue;
    }
    out.append(name, String(value));
  }
  return out;
}

async function request(method, path, params) {
  const key = secretKey();
  if (!key) {
    throw new StripeError('STRIPE_SECRET_KEY tanımlı değil.', { code: 'not_configured' });
  }

  const body = params && method !== 'GET' ? encode(params).toString() : null;
  const url =
    method === 'GET' && params
      ? `${API_BASE}${path}?${encode(params).toString()}`
      : `${API_BASE}${path}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
      },
      body,
    });
  } catch {
    throw new StripeError('Stripe bağlantısı kurulamadı.', { code: 'network' });
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const error = payload && payload.error ? payload.error : {};
    const message = error.message || `Stripe ${response.status}`;
    // Hesap doğrulanmadan (charges_enabled=false) Stripe "geçerli ödeme yöntemi
    // yok" der; bunu yapılandırma hatası olarak ayırıp anlaşılır mesaj döneriz.
    const notReady =
      error.code === 'account_invalid' ||
      error.code === 'parameter_invalid_string_currency' ||
      /no valid payment method types/i.test(message);
    throw new StripeError(message, {
      code: notReady ? 'stripe_account_not_ready' : error.code || 'stripe_error',
      status: response.status,
      type: error.type,
      param: error.param,
    });
  }

  return payload;
}

/** Stripe Checkout oturumu açar. Tutar kuruş cinsinden ve sunucuda hesaplanır. */
async function createCheckoutSession({
  paymentId,
  bookingId,
  userId,
  amountCents,
  currency,
  email,
  productName,
  successUrl,
  cancelUrl,
}) {
  const cur = String(currency || defaultCurrency()).toLowerCase();
  return request('POST', '/checkout/sessions', {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: paymentId,
    customer_email: email || undefined,
    // Ödeme yöntemleri (kart, Apple Pay, Google Pay, Link…) Stripe panelindeki
    // dinamik ödeme yöntemleri ayarından gelir; `payment_method_types` yeni API
    // sürümlerinde reddedildiği için burada gönderilmez.
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: cur,
          unit_amount: String(amountCents),
          product_data: { name: productName || 'Trabzone konaklama rezervasyonu' },
        },
      },
    ],
    metadata: {
      payment_id: paymentId,
      booking_id: bookingId || '',
      user_id: userId || '',
    },
    payment_intent_data: {
      metadata: {
        payment_id: paymentId,
        booking_id: bookingId || '',
        user_id: userId || '',
      },
    },
  });
}

function retrieveCheckoutSession(sessionId) {
  return request('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

function expireCheckoutSession(sessionId) {
  return request('POST', `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {});
}

function createRefund({ paymentIntentId, amountCents, reason }) {
  return request('POST', '/refunds', {
    payment_intent: paymentIntentId,
    amount: amountCents ? String(amountCents) : undefined,
    reason: reason || undefined,
  });
}

/** Webhook gövdesine güvenmek yerine olay Stripe'tan yeniden okunur. */
function retrieveEvent(eventId) {
  return request('GET', `/events/${encodeURIComponent(eventId)}`);
}

function retrieveAccount() {
  return request('GET', '/account');
}

module.exports = {
  StripeError,
  isConfigured,
  defaultCurrency,
  appUrl,
  createCheckoutSession,
  retrieveCheckoutSession,
  expireCheckoutSession,
  createRefund,
  retrieveEvent,
  retrieveAccount,
};
