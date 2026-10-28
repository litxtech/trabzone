import { env } from '@/config/env';

import { MAPBOX_STATIC_STYLE } from '../utils/map-theme';
import type { LatLng, MapRoute, MapSearchResult } from '../types';

export type MapApiFailure = 'no_token' | 'not_found' | 'network' | 'http' | 'too_short';

export type MapApiResult<T> = { ok: true; data: T } | { ok: false; reason: MapApiFailure };

const GEOCODE_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

function tokenParam(): string | null {
  return env.mapboxToken && env.mapboxToken.trim().length > 10 ? env.mapboxToken.trim() : null;
}

export function hasMapboxToken(): boolean {
  return tokenParam() !== null;
}

const PLACE_KIND: Record<string, MapSearchResult['kind']> = {
  place: 'city',
  locality: 'city',
  region: 'city',
  district: 'district',
  neighborhood: 'neighborhood',
  address: 'address',
  poi: 'place',
  poi_landmark: 'place',
};

type GeocodeFeature = {
  id?: string;
  text?: string;
  place_name?: string;
  center?: [number, number];
  place_type?: string[];
};

/**
 * Merkezi harita araması. Sonuçlar türlerine göre ayrıştırılmak üzere `kind`
 * alanıyla döner. Token yoksa ağ isteği yapılmaz.
 */
export async function searchPlaces(
  query: string,
  options: { proximity?: LatLng | null; limit?: number; country?: string } = {},
): Promise<MapApiResult<MapSearchResult[]>> {
  const token = tokenParam();
  if (!token) {
    return { ok: false, reason: 'no_token' };
  }
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { ok: false, reason: 'too_short' };
  }

  const params = new URLSearchParams({
    country: options.country ?? 'tr',
    language: 'tr',
    limit: String(Math.min(Math.max(options.limit ?? 8, 1), 12)),
    types: 'country,region,place,locality,district,neighborhood,address,poi',
    access_token: token,
  });
  if (options.proximity) {
    params.set('proximity', `${options.proximity.lng},${options.proximity.lat}`);
  }

  try {
    const response = await fetch(`${GEOCODE_BASE}/${encodeURIComponent(trimmed)}.json?${params}`);
    if (!response.ok) {
      return { ok: false, reason: 'http' };
    }
    const body = (await response.json()) as { features?: GeocodeFeature[] };
    const features = body.features ?? [];
    const results: MapSearchResult[] = [];
    for (const feature of features) {
      const center = feature.center;
      if (!center) {
        continue;
      }
      const primaryType = feature.place_type?.[0] ?? 'place';
      results.push({
        id: feature.id ?? `${center[0]},${center[1]}`,
        label: feature.place_name ?? feature.text ?? trimmed,
        shortLabel: feature.text ?? trimmed,
        lat: center[1],
        lng: center[0],
        kind: PLACE_KIND[primaryType] ?? 'place',
      });
    }
    return { ok: true, data: results };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/** Haritada seçilen noktanın okunabilir adresi. */
export async function reverseGeocode(point: LatLng): Promise<MapApiResult<string>> {
  const token = tokenParam();
  if (!token) {
    return { ok: false, reason: 'no_token' };
  }
  const url =
    `${GEOCODE_BASE}/${point.lng.toFixed(5)},${point.lat.toFixed(5)}.json` +
    `?language=tr&limit=1&access_token=${token}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, reason: 'http' };
    }
    const body = (await response.json()) as { features?: GeocodeFeature[] };
    const label = body.features?.[0]?.place_name;
    if (!label) {
      return { ok: false, reason: 'not_found' };
    }
    return { ok: true, data: label };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

type DirectionsProfile = 'driving' | 'walking' | 'cycling';

type DirectionsResponse = {
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
  }[];
};

/**
 * Güzergâh hesabı. Alternatif rotalar döner; sağlayıcı desteklemiyorsa boş
 * dizi döner (uydurma rota çizilmez).
 */
export async function fetchRoute(input: {
  origin: LatLng;
  dest: LatLng;
  waypoints?: LatLng[];
  profile?: DirectionsProfile;
}): Promise<MapApiResult<MapRoute>> {
  const token = tokenParam();
  if (!token) {
    return { ok: false, reason: 'no_token' };
  }
  const profile = input.profile ?? 'driving';
  const points = [input.origin, ...(input.waypoints ?? []), input.dest]
    .map((point) => `${point.lng},${point.lat}`)
    .join(';');
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${points}` +
    `?geometries=geojson&overview=full&steps=false&alternatives=true&language=tr&access_token=${token}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, reason: 'http' };
    }
    const body = (await response.json()) as DirectionsResponse;
    const routes = body.routes ?? [];
    const first = routes[0];
    if (!first || typeof first.distance !== 'number') {
      return { ok: false, reason: 'not_found' };
    }
    const toPoints = (route: (typeof routes)[number]): LatLng[] =>
      (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
    return {
      ok: true,
      data: {
        distanceMeters: Math.round(first.distance),
        durationMinutes: Math.round((first.duration ?? 0) / 60),
        geometry: toPoints(first),
        alternatives: routes.slice(1, 3).map(toPoints).filter((line) => line.length > 1),
      },
    };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/**
 * Statik harita görüntüsü — web ve native modül bulunmayan derlemelerde gerçek
 * Mapbox karolarıyla önizleme. Token yoksa null döner.
 */
export function staticMapUrl(input: {
  center: LatLng;
  zoom: number;
  width: number;
  height: number;
  dark: boolean;
  markers?: LatLng[];
}): string | null {
  const token = tokenParam();
  if (!token) {
    return null;
  }
  const width = Math.min(Math.max(Math.round(input.width), 200), 1280);
  const height = Math.min(Math.max(Math.round(input.height), 160), 1280);
  const zoom = Math.min(Math.max(input.zoom, 1), 17);
  const markers = (input.markers ?? []).slice(0, 12);
  const pins = markers
    .map((point) => `pin-s+4169F5(${point.lng.toFixed(5)},${point.lat.toFixed(5)})`)
    .join(',');
  const overlay = pins ? `${pins}/` : '';
  const style = input.dark ? MAPBOX_STATIC_STYLE.dark : MAPBOX_STATIC_STYLE.light;
  return (
    `https://api.mapbox.com/styles/v1/${style}/static/${overlay}` +
    `${input.center.lng.toFixed(5)},${input.center.lat.toFixed(5)},${zoom},0/` +
    `${width}x${height}@2x?padding=32&access_token=${token}`
  );
}

/** Mapbox Directions/Geocoding kullanımı için hata mesajı. */
export function mapApiMessage(reason: MapApiFailure): string {
  switch (reason) {
    case 'no_token':
      return 'Mapbox anahtarı tanımlı değil. Harita araması ve güzergâh için EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN gerekli.';
    case 'too_short':
      return 'Aramak için en az 2 karakter yaz.';
    case 'not_found':
      return 'Sonuç bulunamadı. Farklı bir arama dene.';
    case 'network':
      return 'Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.';
    default:
      return 'Harita servisi şu anda yanıt vermiyor. Biraz sonra tekrar dene.';
  }
}
