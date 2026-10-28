import type { Href } from 'expo-router';

/** `next` parametresi için üst sınır; anlamsız uzun değerler reddedilir. */
const MAX_LENGTH = 512;

/**
 * Giriş sonrası dönülecek adres olarak kullanılamayacak yollar. Bunlar kabul
 * edilirse giriş → giriş döngüsü oluşur.
 */
const BLOCKED_PREFIXES = ['/login', '/register', '/lobby', '/forgot-password', '/verify'];

/**
 * Derin bağlantı hedefini doğrular.
 *
 * Yalnızca site içi mutlak yollar (`/marketplace/abc`) kabul edilir; protokol,
 * alan adı veya `//` ile başlayan açık yönlendirme denemeleri reddedilir.
 */
export function safeNextPath(value: string | string[] | null | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return null;
  }
  if (trimmed.length > MAX_LENGTH) {
    return null;
  }

  const path = trimmed.split('?')[0] ?? '';
  if (BLOCKED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return null;
  }
  return trimmed;
}

/**
 * Giriş formu adresi. `next` varsa korunur; giriş tamamlandığında kullanıcı
 * tıkladığı ilana geri döner.
 */
export function loginHref(next?: string | string[] | null): Href {
  const safe = safeNextPath(next);
  return (safe ? `/login?next=${encodeURIComponent(safe)}` : '/login') as Href;
}
