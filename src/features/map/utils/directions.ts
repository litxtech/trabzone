import type { Href } from '@/utils/router';

export type InAppDirectionsInput = {
  lat: number | null | undefined;
  lng: number | null | undefined;
  label?: string | null;
  zoom?: number;
  /** Haritada eczane bağlamını korumak için opsiyonel slug. */
  pharmacy?: string | null;
};

/**
 * Uygulama içi haritada güzergâh başlatan bağlantı.
 *
 * Yol tarifi hiçbir zaman dış harita uygulamasına (Apple Maps, Google Maps,
 * `geo:` vb.) devredilmez. Bağlantı `/map` ekranını `directions=1` niyetiyle
 * açar; rota cihaz konumundan hesaplanır ve Trabzone haritasında çizilir.
 * Koordinat geçersizse bağlantı üretilmez; uydurma hedef gösterilmez.
 */
export function inAppDirectionsHref(input: InAppDirectionsInput): Href | null {
  const { lat, lng } = input;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return {
    pathname: '/map',
    params: {
      lat: String(lat),
      lng: String(lng),
      label: input.label ?? 'Hedef',
      zoom: String(input.zoom ?? 16),
      directions: '1',
      ...(input.pharmacy ? { pharmacy: input.pharmacy } : {}),
    },
  } as unknown as Href;
}
