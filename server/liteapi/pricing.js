/**
 * Trabzone satış fiyatı (sağlayıcı fiyatı + platform marjı).
 *
 * Sağlayıcıdan gelen tutar Trabzone'un **maliyeti**dir; misafire gösterilen ve
 * Stripe ile tahsil edilen tutar bu maliyetin üzerine platform marjı eklenerek
 * hesaplanır. Marj oranı yalnızca sunucuda (`LITEAPI_MARKUP_BPS`) tutulur ve
 * istemciye hiçbir alanda gönderilmez.
 *
 * Kuruş bazında çalışılır: LiteAPI tutarları ondalık, veritabanı ve Stripe
 * tutarları kuruş (integer) olduğu için tek bir yerde dönüştürülür.
 */

const { config } = require('./config');

/**
 * Maliyetin üzerine marj uygular.
 * @param {number} baseCents Sağlayıcı toplam fiyatı (kuruş)
 * @returns {{ customerCents: number, markupCents: number, markupBps: number }}
 */
function priceFor(baseCents) {
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  const bps = config.markupBps;
  const customer = bps > 0 ? Math.round((base * (10_000 + bps)) / 10_000) : base;
  return {
    customerCents: customer,
    markupCents: Math.max(0, customer - base),
    markupBps: bps,
  };
}

/**
 * Sağlayıcıdan gelen teklifleri müşteri fiyatına çevirir.
 *
 * Dönen nesnede `basePriceCents` ve `markupCents` yalnızca sunucu tarafında
 * kullanılır; API yanıtına yazılmadan önce çıkarılır (bkz. rates handler).
 */
function applyMarkupToOffer(offer) {
  const { customerCents, markupCents } = priceFor(offer.priceCents);
  return {
    ...offer,
    basePriceCents: offer.priceCents,
    markupCents,
    priceCents: customerCents,
  };
}

module.exports = { priceFor, applyMarkupToOffer };
