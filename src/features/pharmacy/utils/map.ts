import type { MapCamera, MapPoint } from '@/features/map/types';
import { projectMercator, unprojectMercator } from '@/features/map/utils/geo';

import type { PharmacyMapItem, PharmacySummary } from '../types';
import { describePharmacyState } from './status';

export type PharmacyBounds = { west: number; east: number; south: number; north: number };

/**
 * Görünür harita alanını kameradan hesaplar. Sunucu `pharmacies_map` yalnızca
 * bu kutudaki gerçek koordinatlı eczaneleri döner; iğneler tahminle
 * yerleştirilmez.
 */
export function bboxFromCamera(
  camera: MapCamera,
  size: { width: number; height: number },
  padding = 0.12,
): PharmacyBounds {
  const scale = 256 * 2 ** camera.zoom;
  const center = projectMercator({ lat: camera.lat, lng: camera.lng });
  const halfWidth = ((size.width / 2) * (1 + padding)) / scale;
  const halfHeight = ((size.height / 2) * (1 + padding)) / scale;

  const northWest = unprojectMercator(center.x - halfWidth, center.y - halfHeight);
  const southEast = unprojectMercator(center.x + halfWidth, center.y + halfHeight);
  return {
    west: northWest.lng,
    east: southEast.lng,
    north: northWest.lat,
    south: southEast.lat,
  };
}

type MarkerSource = Pick<
  PharmacyMapItem | PharmacySummary,
  'id' | 'slug' | 'name' | 'district' | 'neighborhood' | 'lat' | 'lng' | 'state'
>;

/**
 * Harita işaretleri: nöbetçi eczane yeşil, bilinen-normal mavi, durumu
 * doğrulanamayan gri. Renk körlüğü için ikon da farklıdır.
 */
export function pharmacyMarkers(items: MarkerSource[]): MapPoint[] {
  return items
    .filter((item) => item.lat != null && item.lng != null)
    .map((item) => {
      const view = describePharmacyState(item.state);
      const tone = view.onDutyNow
        ? ('success' as const)
        : view.dutyToday
          ? ('info' as const)
          : view.tone === 'open'
            ? ('primary' as const)
            : view.tone === 'closed'
              ? ('warning' as const)
              : ('danger' as const);
      const icon = view.onDutyNow
        ? 'moon'
        : view.dutyToday
          ? 'time'
          : view.tone === 'open'
            ? 'checkmark'
            : 'help';
      return {
        id: item.id,
        kind: 'place' as const,
        lat: item.lat as number,
        lng: item.lng as number,
        title: item.name,
        subtitle: [item.district, item.neighborhood].filter(Boolean).join(' · ') || null,
        tone,
        icon,
        label: view.onDutyNow ? 'Nöbetçi' : view.dutyToday ? 'Bugün' : null,
        meta: { slug: item.slug, statusLabel: view.label },
      };
    });
}

export const PHARMACY_MAP_DEFAULT_CAMERA: MapCamera = { lat: 40.998, lng: 39.72, zoom: 11.6 };

export function mapLegendTone(tone: 'duty' | 'today' | 'normal' | 'unknown') {
  switch (tone) {
    case 'duty':
      return { color: '#16A34A', label: 'Şu an nöbette' };
    case 'today':
      return { color: '#0EA5E9', label: 'Bugün nöbetçi' };
    case 'normal':
      return { color: '#4169F5', label: 'Normal eczane' };
    default:
      return { color: '#8A94A6', label: 'Durumu doğrulanamadı' };
  }
}
