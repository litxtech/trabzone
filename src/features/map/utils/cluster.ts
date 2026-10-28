import { MAP_CLUSTER_MAX_ZOOM } from '../constants';
import type { MapPoint } from '../types';

/**
 * Yakın işaretleri tek bir küme işaretine indirger.
 *
 * Sayısal kümeleme (grid) kullanılır; böylece hem iOS hem Android aynı sonucu
 * üretir ve harita motoru değişse de davranış aynı kalır.
 */
export function clusterPoints(points: MapPoint[], zoom: number): MapPoint[] {
  if (zoom > MAP_CLUSTER_MAX_ZOOM || points.length <= 1) {
    return points;
  }

  const grid = gridSizeForZoom(zoom);
  const cells = new Map<string, MapPoint[]>();

  for (const point of points) {
    const latKey = Math.floor(point.lat / grid);
    const lngKey = Math.floor(point.lng / grid);
    const key = `${latKey}:${lngKey}`;
    const bucket = cells.get(key);
    if (bucket) {
      bucket.push(point);
    } else {
      cells.set(key, [point]);
    }
  }

  const out: MapPoint[] = [];
  for (const [key, group] of cells) {
    const first = group[0];
    if (!first) {
      continue;
    }
    if (group.length === 1) {
      out.push(first);
      continue;
    }
    const lat = group.reduce((sum, item) => sum + item.lat, 0) / group.length;
    const lng = group.reduce((sum, item) => sum + item.lng, 0) / group.length;
    const kinds = Array.from(new Set(group.map((item) => item.kind)));
    out.push({
      id: `cluster:${key}`,
      kind: 'cluster',
      lat,
      lng,
      title: `${group.length} işaret`,
      count: group.length,
      meta: {
        kinds,
        members: group.map((item) => ({ id: item.id, lat: item.lat, lng: item.lng })),
      },
    });
  }

  return out;
}

function gridSizeForZoom(zoom: number): number {
  // z8 ≈ 0.35°, z12 ≈ 0.022°, z14 ≈ 0.0055°
  return Math.max(0.0015, 0.35 / 2 ** (zoom - 8));
}
