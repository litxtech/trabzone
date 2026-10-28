import { env } from '@/config/env';

/**
 * Paylaşım bağlantıları.
 *
 * Kural: dışarıya verilen her bağlantı **https** olmalı. WhatsApp, Telegram,
 * X gibi uygulamalar `trabzone://` şemasını tıklanabilir bağlantı olarak
 * göstermez; bu yüzden paylaşılan adres `/p/{tür}/{anahtar}` biçimindedir.
 * Sunucu bu adresi zengin kart olarak işler ve uygulama yüklüyse doğrudan
 * ilgili ekrana yönlendirir.
 */
export type ShareKind = 'post' | 'reel' | 'profile' | 'place' | 'listing' | 'estate';

const SEGMENTS: Record<ShareKind, string> = {
  post: 'gonderi',
  reel: 'reel',
  profile: 'profil',
  place: 'mekan',
  listing: 'ilan',
  estate: 'emlak',
};

/** `/p/...` adresindeki tür adlarını kanonik türlere çevirir. */
const TYPE_ALIASES: Record<string, ShareKind> = {
  gonderi: 'post',
  post: 'post',
  reel: 'reel',
  video: 'reel',
  profil: 'profile',
  profile: 'profile',
  mekan: 'place',
  place: 'place',
  isletme: 'place',
  ilan: 'listing',
  listing: 'listing',
  market: 'listing',
  emlak: 'estate',
  estate: 'estate',
  'real-estate': 'estate',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

export function siteBase(): string {
  return env.appUrl.replace(/\/+$/, '');
}

export function sharePath(kind: ShareKind, key: string): string {
  return `/p/${SEGMENTS[kind]}/${encodeURIComponent(key)}`;
}

/**
 * Paylaşılacak https adresi. `comment` verilirse yorum bağlantısı olarak
 * taşınır ve uygulama açıldığında o yorum vurgulanır.
 */
export function shareLink(
  kind: ShareKind,
  key: string,
  options: { comment?: string } = {},
): string {
  const base = `${siteBase()}${sharePath(kind, key)}`;
  return options.comment ? `${base}?comment=${encodeURIComponent(options.comment)}` : base;
}

export function postShareLink(id: string, comment?: string): string {
  return shareLink('post', id, { comment });
}

export function reelShareLink(id: string): string {
  return shareLink('reel', id);
}

export function profileShareLink(username: string): string {
  return shareLink('profile', username);
}

export function placeShareLink(id: string): string {
  return shareLink('place', id);
}

export function listingShareLink(id: string): string {
  return shareLink('listing', id);
}

export function estateShareLink(id: string): string {
  return shareLink('estate', id);
}

/**
 * Süreli canlı konum bağlantısı (`/ride/share/{token}`).
 *
 * Bu adres `/p/...` şemasından farklıdır: önizleme kartı üretmez, çünkü
 * kart basıldığında konum sızabilir. Bağlantıyı açan kişi giriş yaptıysa
 * uygulama `ride_location_share_view` RPC'siyle konumu görür.
 */
export function liveLocationShareLink(token: string): string {
  return `${siteBase()}/ride/share/${encodeURIComponent(token)}`;
}

/**
 * Paylaşım adresini uygulama içi rotaya çevirir. `/p/{tür}/{anahtar}` ekranı
 * (hem derin bağlantı hem tarayıcı) bu eşlemeyi kullanır.
 */
export function resolveShareRoute(type: string, key: string): string | null {
  const kind = TYPE_ALIASES[String(type || '').trim().toLowerCase()];
  const value = String(key || '').trim();
  if (!kind || !value) {
    return null;
  }

  if (kind === 'profile') {
    const username = value.toLowerCase();
    return USERNAME_RE.test(username) ? `/profile/${username}` : null;
  }

  const id = value.toLowerCase();
  if (!UUID_RE.test(id)) {
    return null;
  }

  switch (kind) {
    case 'post':
      return `/post/${id}`;
    case 'reel':
      return `/reel/${id}`;
    case 'place':
      return `/marketplace/place/${id}`;
    case 'listing':
      return `/marketplace/${id}`;
    case 'estate':
      return `/marketplace/real-estate/${id}`;
    default:
      return null;
  }
}

/** Paylaşım mesajlarında uzun gövdeyi kırpar; bağlantı her zaman sonda kalır. */
export function shareSnippet(text: string | null | undefined, max = 180): string {
  const value = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) {
    return '';
  }
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}
