import { env } from '@/config/env';

import type { ExternalPlacePhoto } from '../types';

/**
 * Fotoğrafı olmayan işletmenin Google Haritalar fotoğrafını sunucudaki
 * `/api/place-photo` ucundan ister. Eşleşen işletme ya da fotoğraf yoksa,
 * uç nokta yapılandırılmamışsa veya istek başarısızsa `null` döner; kartlar
 * bu durumda kendi boş görünümünü gösterir.
 */
export async function fetchExternalPlacePhoto(input: {
  name: string;
  lat: number;
  lng: number;
  width: number;
  signal?: AbortSignal;
}): Promise<ExternalPlacePhoto | null> {
  const base = env.placePhotoUrl;
  if (!/^https?:\/\//i.test(base)) {
    return null;
  }
  const params = new URLSearchParams({
    name: input.name,
    lat: input.lat.toFixed(5),
    lng: input.lng.toFixed(5),
    w: String(input.width),
  });

  let response: Response;
  try {
    response = await fetch(`${base}${base.includes('?') ? '&' : '?'}${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: input.signal,
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }

  let body: { ok?: boolean; photo?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return null;
  }
  const photo = body.ok ? (body.photo as Partial<ExternalPlacePhoto> | null) : null;
  if (!photo || typeof photo.url !== 'string' || !/^https:\/\//i.test(photo.url)) {
    return null;
  }
  return {
    url: photo.url,
    width: typeof photo.width === 'number' ? photo.width : null,
    height: typeof photo.height === 'number' ? photo.height : null,
    source: 'google',
    attributions: Array.isArray(photo.attributions)
      ? photo.attributions
          .filter((entry) => entry && typeof entry.name === 'string' && entry.name)
          .map((entry) => ({
            name: entry.name,
            uri: typeof entry.uri === 'string' ? entry.uri : null,
          }))
      : [],
  };
}
