import { Alert, Linking } from 'react-native';

import { inAppDirectionsHref } from '@/features/map/utils/directions';
import { router, type Href } from '@/utils/router';

/**
 * Telefon numarasını `tel:` bağlantısına çevirir. Numara yoksa buton
 * gösterilmez; yanlış/eksik numara uydurulmaz.
 *
 * Ek olarak numaranın *makul* olduğu doğrulanır. Eczane envanteri
 * OpenStreetMap kaynaklıdır ve topluluk verisi zaman zaman yer tutucu
 * numaralar içerir (ör. 462 999 xx xx gibi hiç atanmamış santral kodları).
 * Böyle bir numarayı aramaya açmak acil durumda yanlış yere yönlendirir;
 * bu yüzden numara arama için yeterince güvenilir değilse hiç sunulmaz.
 */
export function sanitizePhone(phone: string | null | undefined): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, '');
  let national = digits;
  if (digits.length === 12 && digits.startsWith('90')) {
    national = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    national = digits.slice(1);
  }
  // Türkiye sabit hattı: 3 haneli alan kodu + 7 haneli numara.
  if (!/^[1-9]\d{9}$/.test(national)) {
    return null;
  }
  const area = national.slice(0, 3);
  const exchange = national.slice(3, 6);
  // Alan kodu / santral kodu olarak atanmamış yer tutucular.
  if (area === '000' || exchange === '000' || exchange === '999') {
    return null;
  }
  // 444 44 44 gibi tekrar eden numaralar eczane hattı değildir.
  if (/^(\d)\1{9}$/.test(national)) {
    return null;
  }
  return `+90${national}`;
}

/** "Ara" düğmesinin açık olup olmayacağını belirler. */
export function hasCallablePhone(phone: string | null | undefined): boolean {
  return sanitizePhone(phone) != null;
}

export async function callPharmacy(phone: string | null | undefined) {
  const target = sanitizePhone(phone);
  if (!target) {
    Alert.alert('Telefon numarası yok', 'Bu eczane için doğrulanmış telefon numarası bulunmuyor.');
    return;
  }
  const url = `tel:${target}`;
  const supported = await Linking.canOpenURL(url);
  if (!supported) {
    Alert.alert('Arama başlatılamadı', 'Bu cihazda telefon araması desteklenmiyor.');
    return;
  }
  await Linking.openURL(url);
}

/**
 * Yol tarifi: Trabzone içi haritada hesaplanır ve çizilir.
 *
 * Dış harita uygulamasına (`geo:`, Apple Maps, Google Maps) yönlendirme
 * yapılmaz. Harita ekranı cihaz konumundan hedefe güzergâhı kendisi çizer;
 * koordinat yoksa buton zaten devre dışıdır ve burada da uydurma hedef
 * kullanılmaz.
 */
export function openDirections(
  lat: number | null | undefined,
  lng: number | null | undefined,
  label: string,
) {
  const href = inAppDirectionsHref({ lat, lng, label, zoom: 16 });
  if (!href) {
    Alert.alert(
      'Konum bilgisi yok',
      'Bu eczanenin doğrulanmış koordinatı bulunmuyor. Adresi kullanarak yola çıkabilirsin.',
    );
    return;
  }
  router.push(href);
}

/** Trabzone içi haritada eczane pinini açar. */
export function trabzoneMapHref(input: {
  lat: number | null;
  lng: number | null;
  label: string;
  slug?: string | null;
}) {
  return {
    pathname: '/map',
    params: {
      lat: String(input.lat ?? ''),
      lng: String(input.lng ?? ''),
      label: input.label,
      zoom: '16',
      ...(input.slug ? { pharmacy: input.slug } : {}),
    },
  } as unknown as Href;
}

/** Eczane detay bağlantısı (deep link ile aynı yol). */
export function pharmacyHref(slug: string) {
  return `/eczaneler/${slug}` as unknown as Href;
}

/** "Tarifi aç" için ortak etiket. */
export const DIRECTIONS_LABEL = 'Yol Tarifi';
