import { useQuery } from '@tanstack/react-query';

import { fetchExternalPlacePhoto } from '../services/place-photo-service';

export type PlacePhotoSize = 'thumb' | 'card' | 'hero';

/** Az sayıda sabit genişlik: aynı işletme farklı ekranlarda aynı önbelleği kullanır. */
const WIDTH: Record<PlacePhotoSize, number> = { thumb: 240, card: 800, hero: 1200 };

/**
 * Trabzone'da kapağı olmayan işletme için Google Haritalar fotoğrafı.
 * `enabled` false iken (işletmenin kendi kapağı varsa) istek atılmaz.
 * Google adresleri kısa ömürlü olduğundan veri 40 dakikadan uzun tutulmaz.
 */
export function useExternalPlacePhoto(input: {
  name: string | null | undefined;
  lat: number | null | undefined;
  lng: number | null | undefined;
  size: PlacePhotoSize;
  enabled?: boolean;
}) {
  const { name, lat, lng, size, enabled = true } = input;
  const trimmed = name?.trim() ?? '';
  const ready =
    enabled &&
    trimmed.length >= 2 &&
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lng === 'number' &&
    Number.isFinite(lng);

  return useQuery({
    queryKey: [
      'explore',
      'external-photo',
      trimmed.toLocaleLowerCase('tr-TR'),
      ready ? lat.toFixed(4) : null,
      ready ? lng.toFixed(4) : null,
      size,
    ],
    queryFn: ({ signal }) =>
      fetchExternalPlacePhoto({
        name: trimmed,
        lat: lat as number,
        lng: lng as number,
        width: WIDTH[size],
        signal,
      }),
    enabled: ready,
    staleTime: 40 * 60_000,
    gcTime: 40 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
