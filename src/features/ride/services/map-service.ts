import { env } from '@/config/env';

export type LatLng = { lat: number; lng: number };

export type DrivingRoute = {
  distanceMeters: number;
  durationMinutes: number;
  geometry: { lat: number; lng: number }[];
};

export type MapResult<T> = { ok: true; data: T } | { ok: false; reason: string };

/** Mapbox anahtarı yapılandırılmış mı? */
export function hasMapboxToken(): boolean {
  return Boolean(env.mapboxToken);
}

/**
 * Mapbox Directions API. Anahtar yoksa ağ isteği yapılmaz ve çağıran taraf
 * "harita yapılandırılmadı" durumunu gerçek mesafe uydurmadan gösterir.
 */
export async function fetchDrivingRoute(
  origin: LatLng,
  dest: LatLng,
  waypoints: LatLng[] = [],
): Promise<MapResult<DrivingRoute>> {
  if (!env.mapboxToken) {
    return { ok: false, reason: 'map_token_missing' };
  }
  const points = [origin, ...waypoints, dest]
    .map((point) => `${point.lng},${point.lat}`)
    .join(';');
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${points}` +
    `?geometries=geojson&overview=full&steps=false&language=tr&access_token=${env.mapboxToken}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, reason: `map_http_${response.status}` };
    }
    const body = (await response.json()) as {
      routes?: {
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: [number, number][] };
      }[];
    };
    const route = body.routes?.[0];
    if (!route || typeof route.distance !== 'number') {
      return { ok: false, reason: 'route_not_found' };
    }
    return {
      ok: true,
      data: {
        distanceMeters: Math.round(route.distance),
        durationMinutes: Math.round((route.duration ?? 0) / 60),
        geometry: (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })),
      },
    };
  } catch {
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeout);
  }
}

const routeCache = new Map<string, DrivingRoute>();
const routeInflight = new Map<string, Promise<MapResult<DrivingRoute>>>();

function routeCacheKey(origin: LatLng, dest: LatLng, waypoints: LatLng[]): string {
  const point = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  return [point(origin), ...waypoints.map(point), point(dest)].join('|');
}

/**
 * Güzergâh geometrisini önbellekle getirir.
 *
 * Aynı ilan birden fazla ekranda (liste, detay, takip) açıldığında Directions
 * API'ye tekrar tekrar gidilmez; başarılı sonuç süreç boyunca saklanır.
 * `force` yalnızca kullanıcı "yeniden dene" dediğinde kullanılır.
 */
export function fetchDrivingRouteCached(
  origin: LatLng,
  dest: LatLng,
  waypoints: LatLng[] = [],
  force = false,
): Promise<MapResult<DrivingRoute>> {
  const key = routeCacheKey(origin, dest, waypoints);
  if (!force) {
    const cached = routeCache.get(key);
    if (cached) {
      return Promise.resolve({ ok: true, data: cached });
    }
    const pending = routeInflight.get(key);
    if (pending) {
      return pending;
    }
  }
  const request = fetchDrivingRoute(origin, dest, waypoints).then((result) => {
    routeInflight.delete(key);
    if (result.ok) {
      routeCache.set(key, result.data);
    }
    return result;
  });
  routeInflight.set(key, request);
  return request;
}

export type GeocodeResult = {
  label: string;
  lat: number;
  lng: number;
  placeType: string | null;
};

/**
 * Mapbox Geocoding. Yalnızca Türkiye sonuçları döner; token yoksa çağrı
 * yapılmaz ve çağıran taraf koordinatı boş bırakır (uydurma konum yazılmaz).
 */
export async function geocodePlace(query: string): Promise<MapResult<GeocodeResult>> {
  if (!env.mapboxToken) {
    return { ok: false, reason: 'map_token_missing' };
  }
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { ok: false, reason: 'query_too_short' };
  }
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json` +
    `?country=tr&language=tr&limit=1&access_token=${env.mapboxToken}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, reason: `geocode_http_${response.status}` };
    }
    const body = (await response.json()) as {
      features?: {
        place_name?: string;
        center?: [number, number];
        place_type?: string[];
      }[];
    };
    const feature = body.features?.[0];
    if (!feature?.center) {
      return { ok: false, reason: 'place_not_found' };
    }
    return {
      ok: true,
      data: {
        label: feature.place_name ?? trimmed,
        lat: feature.center[1],
        lng: feature.center[0],
        placeType: feature.place_type?.[0] ?? null,
      },
    };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/**
 * Statik harita önizlemesi.
 *
 * Mapbox Static Images API'nin `auto` yerleşimi kullanılır: rota, başlangıç,
 * varış ve ara duraklar tek istekte çizilir ve kare otomatik olarak sığdırılır.
 * Eski sürüm overlays'ları `/` ile ayırdığı için API 404 dönüyordu; bu da
 * ilan detayındaki haritanın boş görünmesine neden oluyordu.
 *
 * Token yoksa null döner; istemci sahte harita göstermez.
 */
export function staticMapUrl(input: {
  origin: LatLng;
  dest: LatLng;
  geometry?: { lat: number; lng: number }[];
  waypoints?: LatLng[];
  width?: number;
  height?: number;
  padding?: number;
  dark?: boolean;
}): string | null {
  if (!env.mapboxToken) {
    return null;
  }
  const width = Math.min(Math.max(Math.round(input.width ?? 720), 200), 640);
  const height = Math.min(Math.max(Math.round(input.height ?? 360), 160), 640);
  const padding = Math.min(Math.max(Math.round(input.padding ?? 46), 0), 120);
  const points = input.geometry?.length ? input.geometry : [input.origin, input.dest];
  const line = simplify(points, 60)
    .map((point) => `${point.lng.toFixed(5)},${point.lat.toFixed(5)}`)
    .join(',');

  const overlays: string[] = [];
  if (line) {
    // Rota çizgisi: 4 px, marka mavisi, %92 opaklık.
    overlays.push(`path-4+2F6BFF-0.92(${line})`);
  }
  overlays.push(`pin-s-a+22C55E(${input.origin.lng.toFixed(5)},${input.origin.lat.toFixed(5)})`);
  overlays.push(`pin-s-b+4169F5(${input.dest.lng.toFixed(5)},${input.dest.lat.toFixed(5)})`);
  (input.waypoints ?? []).slice(0, 3).forEach((point, index) => {
    overlays.push(
      `pin-s-${'cdef'[index]}+F59E0B(${point.lng.toFixed(5)},${point.lat.toFixed(5)})`,
    );
  });

  const style = input.dark === false ? 'mapbox/light-v11' : 'mapbox/dark-v11';
  return (
    `https://api.mapbox.com/styles/v1/${style}/static/${overlays.join(',')}/auto/` +
    `${width}x${height}@2x?padding=${padding}&access_token=${env.mapboxToken}`
  );
}

/**
 * Tek nokta için statik harita (canlı konum takibi).
 *
 * Güzergâh önizlemesinden farkı: yol çizgisi yok, yalnızca iğne işareti var.
 * Token yoksa null döner; istemci sahte harita göstermez.
 */
export function staticPointMapUrl(input: {
  lat: number;
  lng: number;
  zoom?: number;
  width?: number;
  height?: number;
}): string | null {
  if (!env.mapboxToken) {
    return null;
  }
  const width = Math.min(Math.max(input.width ?? 760, 200), 1280);
  const height = Math.min(Math.max(input.height ?? 420, 160), 720);
  const zoom = Math.min(Math.max(input.zoom ?? 14.5, 1), 19);
  const center = `${input.lng.toFixed(5)},${input.lat.toFixed(5)}`;
  const pin = `pin-l+2F6BFF(${input.lng.toFixed(5)},${input.lat.toFixed(5)})`;
  return (
    `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${pin}/${center},${zoom},0/` +
    `${width}x${height}@2x?padding=30&access_token=${env.mapboxToken}`
  );
}

function simplify(points: LatLng[], max: number): LatLng[] {
  if (points.length <= max) {
    return points;
  }
  const step = Math.ceil(points.length / max);
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

export function coordinatesLabel(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) {
    return null;
  }
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
