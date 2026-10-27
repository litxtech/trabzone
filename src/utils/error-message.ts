/**
 * Bilinmeyen (unknown) hata degerlerinden kullaniciya gosterilebilir mesaj
 * uretir. Supabase RPC hatalari, ag hatalari ve AppError ayni sekilde ele alinir.
 */
export function toMessage(error: unknown, fallback = 'Bir şeyler ters gitti. Tekrar dene.'): string {
  if (!error) {
    return fallback;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
}
