import type { LatLng, Bbox } from '../types';

/**
 * Trabzon hizmet bölgesi kaba sınırları. Sunucu tarafı `service_regions`
 * kaydı otoritedir; bu sınır yalnızca istemcide görünüm/uyarı için kullanılır.
 */
export const TRABZON_BOUNDS: Bbox = { west: 39.25, east: 40.47, south: 40.55, north: 41.25 };

export const MAP_MIN_ZOOM = 9;
export const MAP_MAX_ZOOM = 19;

const TILE = 256;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function projectMercator(point: LatLng) {
  const lat = clamp(point.lat, -85.05112878, 85.05112878);
  const scale = TILE * 2 ** MAP_MAX_ZOOM;
  const x = ((point.lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export function unprojectMercator(x: number, y: number): LatLng {
  const scale = TILE * 2 ** MAP_MAX_ZOOM;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
}

/** Görünür harita alanını (viewport) coğrafi bbox'a çevirir. */
export function bboxForCamera(
  camera: { lat: number; lng: number; zoom: number },
  width: number,
  height: number,
): Bbox {
  const scale = TILE * 2 ** clamp(camera.zoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
  const center = projectMercator({ lat: camera.lat, lng: camera.lng });
  // projectMercator her zaman max zoom dünyasında döner; ekran yarısını
  // aynı birime çevirmek için mevcut zoom ölçeğine bölmek gerekir.
  const halfWidth = Math.max(width, 1) / (2 * scale);
  const halfHeight = Math.max(height, 1) / (2 * scale);

  const nw = unprojectMercator(center.x - halfWidth, center.y - halfHeight);
  const se = unprojectMercator(center.x + halfWidth, center.y + halfHeight);

  return {
    west: Math.max(TRABZON_BOUNDS.west, Math.min(nw.lng, se.lng)),
    east: Math.min(TRABZON_BOUNDS.east, Math.max(nw.lng, se.lng)),
    south: Math.max(TRABZON_BOUNDS.south, Math.min(nw.lat, se.lat)),
    north: Math.min(TRABZON_BOUNDS.north, Math.max(nw.lat, se.lat)),
  };
}

export function isInsideTrabzon(point: LatLng) {
  return (
    point.lat >= TRABZON_BOUNDS.south &&
    point.lat <= TRABZON_BOUNDS.north &&
    point.lng >= TRABZON_BOUNDS.west &&
    point.lng <= TRABZON_BOUNDS.east
  );
}

export function polygonClosedGeoJson(points: LatLng[]) {
  if (points.length < 3) {
    return null;
  }
  const ring = points.map((point) => [point.lng, point.lat] as [number, number]);
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return {
    type: 'Polygon' as const,
    coordinates: [ring],
  };
}

export function polygonCentroid(points: LatLng[]): LatLng | null {
  if (points.length === 0) {
    return null;
  }
  const sum = points.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

export function distanceKm(a: LatLng, b: LatLng) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km: number) {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}
