import { env } from '@/config/env';

import type { ExternalPlaceSource, ExternalPlaceSuggestion, LatLng } from '../types';

/**
 * Google, Apple ve OpenStreetMap haritalarındaki işletmeleri arar.
 *
 * İstek doğrudan sağlayıcılara gitmez: `EXPO_PUBLIC_PLACE_SEARCH_URL`
 * (varsayılan `EXPO_PUBLIC_APP_URL/api/place-search`) üzerinden sunucudaki
 * birleştirici uç noktaya gider. Böylece API anahtarları uygulama paketine
 * hiç girmez; OpenStreetMap her zaman anahtarsız çalışır.
 */

export type ExternalPlaceSearchFailure =
  'too_short' | 'not_configured' | 'rate_limited' | 'network' | 'http';

export type ExternalPlaceSearchSuccess = {
  ok: true;
  items: ExternalPlaceSuggestion[];
  providers: ExternalPlaceSource[];
};

export type ExternalPlaceSearchResult =
  ExternalPlaceSearchSuccess | { ok: false; reason: ExternalPlaceSearchFailure };

type RawItem = Partial<ExternalPlaceSuggestion> & { source?: string };

function isSource(value: unknown): value is ExternalPlaceSource {
  return value === 'google' || value === 'apple' || value === 'osm';
}

/** Sunucudan gelen kaydı güvenli biçimde arayüz tipine çevirir. */
function parseItem(raw: unknown): ExternalPlaceSuggestion | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const item = raw as RawItem;
  if (typeof item.name !== 'string' || item.name.trim().length === 0) {
    return null;
  }
  if (typeof item.lat !== 'number' || typeof item.lng !== 'number') {
    return null;
  }
  const source = isSource(item.source) ? item.source : null;
  if (!source) {
    return null;
  }
  const sources = Array.isArray(item.sources) ? item.sources.filter(isSource) : [source];
  return {
    id: typeof item.id === 'string' ? item.id : `${source}:${item.lat},${item.lng}`,
    source,
    sources: sources.length > 0 ? sources : [source],
    name: item.name.trim(),
    address: typeof item.address === 'string' ? item.address : '',
    lat: item.lat,
    lng: item.lng,
    category: typeof item.category === 'string' && item.category ? item.category : null,
    types: Array.isArray(item.types) ? item.types.filter((type) => typeof type === 'string') : [],
    phone: typeof item.phone === 'string' && item.phone ? item.phone : null,
    website: typeof item.website === 'string' && item.website ? item.website : null,
    rating: typeof item.rating === 'number' ? item.rating : null,
    ratingCount: typeof item.ratingCount === 'number' ? item.ratingCount : null,
    closed: item.closed === true,
    externalId:
      typeof item.externalId === 'string' && item.externalId ? item.externalId : null,
  };
}

export async function searchExternalPlaces(input: {
  query: string;
  around?: LatLng | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<ExternalPlaceSearchResult> {
  const query = input.query.replace(/\s+/g, ' ').trim();
  if (query.length < 2) {
    return { ok: false, reason: 'too_short' };
  }

  let url: string;
  try {
    const params = new URLSearchParams({ q: query });
    if (input.around) {
      params.set('lat', String(input.around.lat));
      params.set('lng', String(input.around.lng));
    }
    if (input.limit) {
      params.set('limit', String(input.limit));
    }
    const base = env.placeSearchUrl;
    if (!/^https?:\/\//i.test(base)) {
      return { ok: false, reason: 'not_configured' };
    }
    url = `${base}${base.includes('?') ? '&' : '?'}${params.toString()}`;
  } catch {
    return { ok: false, reason: 'not_configured' };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: input.signal,
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (!response.ok) {
    if (response.status === 503) {
      return { ok: false, reason: 'not_configured' };
    }
    if (response.status === 429) {
      return { ok: false, reason: 'rate_limited' };
    }
    return { ok: false, reason: 'http' };
  }

  let body: { ok?: boolean; items?: unknown; providers?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, reason: 'http' };
  }

  if (!body.ok || !Array.isArray(body.items)) {
    return { ok: false, reason: 'http' };
  }

  const items = body.items
    .map(parseItem)
    .filter((item): item is ExternalPlaceSuggestion => item !== null);
  const providers = Array.isArray(body.providers)
    ? body.providers.filter(isSource)
    : ([] as ExternalPlaceSource[]);

  return { ok: true, items, providers };
}

/** Arama başarısız olduğunda formda gösterilecek kısa açıklama. */
export function externalPlaceSearchMessage(reason: ExternalPlaceSearchFailure): string {
  switch (reason) {
    case 'too_short':
      return 'Aramak için en az 2 karakter yaz.';
    case 'not_configured':
      return 'Harici harita araması henüz etkin değil. İşletme bilgilerini elle girebilirsin.';
    case 'rate_limited':
      return 'Çok fazla arama yaptın. Bir dakika sonra tekrar dene.';
    case 'network':
      return 'Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.';
    default:
      return 'Harici harita araması şu anda yanıt vermiyor. Bilgileri elle girebilirsin.';
  }
}
