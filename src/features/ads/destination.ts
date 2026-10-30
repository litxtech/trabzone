import { Alert, Linking } from 'react-native';

import { openSafeLink } from '@/features/comments/links';
import { router, type Href } from '@/utils/router';

import type { AdDestination } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,80}$/;

export type ResolvedAdDestination =
  | { kind: 'route'; href: Href }
  | { kind: 'external'; url: string }
  | { kind: 'phone'; tel: string }
  | { kind: 'none' };

/**
 * Yalnızca https, kimlik bilgisi içermeyen ve IP/yerel ağ olmayan adresler
 * dışarı açılır. Sunucu aynı kuralı kampanya kaydında ve sunumda uygular;
 * istemci tarafındaki kontrol ikinci savunma hattıdır.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || /^[0-9.]+$/.test(host) || host.endsWith('.local')) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safePhone(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/[^0-9+]/g, '');
  return /^\+?[0-9]{10,13}$/.test(digits) ? digits : null;
}

/**
 * Reklam hedefini mevcut uygulama rotalarına çevirir. Kimlik/slug biçimi
 * doğrulanmayan hedef `none` döner; kullanıcı kırık bir ekrana gönderilmez.
 */
export function resolveAdDestination(
  campaignId: string,
  destination: AdDestination | null | undefined,
): ResolvedAdDestination {
  if (!destination) {
    return { kind: 'none' };
  }
  const id = destination.target_id ?? '';
  switch (destination.type) {
    case 'detail_page':
      return UUID.test(campaignId)
        ? { kind: 'route', href: `/ad/${campaignId}` as Href }
        : { kind: 'none' };
    case 'business':
      return UUID.test(id)
        ? { kind: 'route', href: `/marketplace/place/${id}` as Href }
        : { kind: 'none' };
    case 'market_listing':
    case 'vehicle':
    case 'job':
      return UUID.test(id) ? { kind: 'route', href: `/marketplace/${id}` as Href } : { kind: 'none' };
    case 'real_estate':
      return UUID.test(id)
        ? { kind: 'route', href: `/marketplace/real-estate/${id}` as Href }
        : { kind: 'none' };
    case 'ride':
      return UUID.test(id) ? { kind: 'route', href: `/ride/offers/${id}` as Href } : { kind: 'none' };
    case 'post':
      return UUID.test(id) ? { kind: 'route', href: `/post/${id}` as Href } : { kind: 'none' };
    case 'category': {
      const category = destination.category;
      if (!category || !SLUG.test(category.slug) || !SLUG.test(category.root_slug)) {
        return { kind: 'none' };
      }
      if (category.kind === 'place') {
        return { kind: 'route', href: '/marketplace/places' as Href };
      }
      return {
        kind: 'route',
        href: {
          pathname: '/marketplace/catalog',
          params: {
            ...(category.kind ? { kind: category.kind } : {}),
            category: category.root_slug,
            ...(category.is_child ? { subcategory: category.slug } : {}),
            title: category.name,
          },
        } as unknown as Href,
      };
    }
    case 'external_url': {
      const url = safeExternalUrl(destination.url);
      return url ? { kind: 'external', url } : { kind: 'none' };
    }
    case 'phone': {
      const tel = safePhone(destination.phone);
      return tel ? { kind: 'phone', tel } : { kind: 'none' };
    }
    case 'map_location': {
      const { lat, lng } = destination;
      if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { kind: 'none' };
      }
      return {
        kind: 'route',
        href: {
          pathname: '/map',
          params: {
            lat: String(lat),
            lng: String(lng),
            label: destination.label ?? 'Konum',
            zoom: '16',
          },
        } as unknown as Href,
      };
    }
    default:
      return { kind: 'none' };
  }
}

/** Çözümlenmiş hedefi açar. Açılamazsa kullanıcıya kısa bir uyarı verilir. */
export async function openAdDestination(resolved: ResolvedAdDestination): Promise<boolean> {
  if (resolved.kind === 'route') {
    router.push(resolved.href);
    return true;
  }
  if (resolved.kind === 'external') {
    const opened = await openSafeLink(resolved.url);
    if (!opened) {
      Alert.alert('Bağlantı açılamadı', 'Bu reklamın web adresi şu anda açılamıyor.');
    }
    return opened;
  }
  if (resolved.kind === 'phone') {
    const url = `tel:${resolved.tel}`;
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return true;
      }
    } catch {
      // Arama desteklenmiyorsa aşağıdaki uyarı gösterilir.
    }
    Alert.alert('Arama başlatılamadı', 'Bu cihazda telefon araması desteklenmiyor.');
    return false;
  }
  Alert.alert('Reklam hedefi kullanılamıyor', 'Bu reklamın bağlantısı artık geçerli değil.');
  return false;
}
