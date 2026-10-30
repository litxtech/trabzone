import { useMemo } from 'react';

import type { LatLng } from '@/features/map/types';

import type { EarthquakeBootstrap, EarthquakeRegion } from '../types';
import { REGION_RADIUS_KM } from '../utils/format';
import { radiusRing, zoomForRegion } from '../utils/scale';
import { useEarthquakeRegionShape } from './use-earthquake';

const FALLBACK_CENTER = { lat: 41.0027, lng: 39.7168 };

/** Seçili bölgenin harita merkezi, yakınlaştırması ve sınır çizgisi. */
export function useRegionGeometry(bootstrap: EarthquakeBootstrap | undefined, region: EarthquakeRegion, district: string | null) {
  const shape = useEarthquakeRegionShape(district);
  const center = bootstrap?.settings.center ?? FALLBACK_CENTER;
  const showBoundary = bootstrap?.settings.map_layers.boundary ?? true;
  const showRadius = bootstrap?.settings.map_layers.radius ?? true;

  return useMemo(() => {
    let ring: LatLng[] | null = null;
    let focus: LatLng = { lat: center.lat, lng: center.lng };
    let zoom = zoomForRegion(region);

    if (district) {
      const raw = shape.data?.ring ?? null;
      if (raw && showBoundary) ring = raw.map(([lat, lng]) => ({ lat, lng }));
      if (raw && raw.length > 0) {
        const lats = raw.map(([lat]) => lat);
        const lngs = raw.map(([, lng]) => lng);
        focus = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
      }
      zoom = 9.3;
    } else if (region === 'province') {
      const raw = bootstrap?.province_ring ?? null;
      if (raw && showBoundary) ring = raw.map(([lat, lng]) => ({ lat, lng }));
    } else {
      const km = REGION_RADIUS_KM[region];
      if (km && showRadius) ring = radiusRing(center.lat, center.lng, km);
    }
    if (region === 'turkey') focus = { lat: 39.0, lng: 35.3 };
    return { ring, center: focus, zoom, clusters: bootstrap?.settings.map_layers.clusters ?? true };
  }, [bootstrap, center.lat, center.lng, district, region, shape.data, showBoundary, showRadius]);
}
