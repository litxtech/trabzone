/**
 * Varsayılan konaklama aralığı.
 *
 * Fiyatlar tarih seçilmeden görünmelidir. Bugün için aynı gün giriş çoğu
 * otelde müsait olmadığından varsayılan giriş yarındır; 2 gece gösterilir.
 * Tarihler İstanbul saatine göre hesaplanır (Europe/Istanbul = UTC+3, DST yok).
 */

const DEFAULT_NIGHTS = 2;
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * @param {{ checkIn?: string, checkOut?: string, nights?: number }} [input]
 * @returns {{ checkIn: string, checkOut: string, nights: number }}
 */
function defaultStay(input = {}) {
  if (input.checkIn && input.checkOut && input.checkOut > input.checkIn) {
    return { checkIn: input.checkIn, checkOut: input.checkOut, nights: DEFAULT_NIGHTS };
  }
  const nights = Math.max(1, Math.min(30, Math.trunc(Number(input.nights) || DEFAULT_NIGHTS)));
  const now = new Date(Date.now() + ISTANBUL_OFFSET_MS);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const end = new Date(start.getTime() + nights * 86_400_000);
  return { checkIn: ymd(start), checkOut: ymd(end), nights };
}

module.exports = { defaultStay, DEFAULT_NIGHTS };
