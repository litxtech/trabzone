import type { LatLng } from '../types';

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Web Mercator (0..1) — statik harita üzerine iğne yerleştirmek için. */
export function projectMercator(point: LatLng): { x: number; y: number } {
  const x = (point.lng + 180) / 360;
  const sinLat = Math.sin(toRadians(clamp(point.lat, -85.05112878, 85.05112878)));
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { x, y };
}

export function unprojectMercator(x: number, y: number): LatLng {
  const lng = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/**
 * Kamera merkezine göre bir noktanın piksel konumu. `zoom` Mapbox/Apple ile
 * aynı ölçeği kullanır (256 px karo).
 */
export function projectToPixels(
  point: LatLng,
  camera: { lat: number; lng: number; zoom: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  const scale = 256 * 2 ** camera.zoom;
  const center = projectMercator({ lat: camera.lat, lng: camera.lng });
  const target = projectMercator(point);
  return {
    x: size.width / 2 + (target.x - center.x) * scale,
    y: size.height / 2 + (target.y - center.y) * scale,
  };
}

export function boundsOf(points: LatLng[]): {
  south: number;
  west: number;
  north: number;
  east: number;
} | null {
  if (points.length === 0) {
    return null;
  }
  let south = points[0]?.lat ?? 0;
  let north = south;
  let west = points[0]?.lng ?? 0;
  let east = west;
  for (const point of points) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
  }
  return { south, west, north, east };
}

/**
 * Verilen noktaları sığdıracak yaklaşık zoom seviyesi (256 px karo varsayımı).
 */
export function zoomForBounds(
  bounds: NonNullable<ReturnType<typeof boundsOf>>,
  size: { width: number; height: number },
): number {
  const latDiff = Math.max(bounds.north - bounds.south, 0.004);
  const lngDiff = Math.max(bounds.east - bounds.west, 0.004);
  const latZoom = Math.log2((size.height * 360) / (latDiff * 256)) - 0.6;
  const lngZoom = Math.log2((size.width * 360) / (lngDiff * 256)) - 0.6;
  return clamp(Math.min(latZoom, lngZoom), 3, 17);
}
