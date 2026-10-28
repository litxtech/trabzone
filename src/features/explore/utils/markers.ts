import type { MapPoint } from '@/features/map/types';

import type { ExploreMarker, PlaceMarker, RealEstateMarker } from '../types';
import { shortPrice } from './format';

const TONES = ['primary', 'accent', 'success', 'warning', 'danger', 'info'] as const;
type Tone = (typeof TONES)[number];

function toneOf(value: string | null | undefined): Tone | undefined {
  return value && (TONES as readonly string[]).includes(value) ? (value as Tone) : undefined;
}

export function placeToMapPoint(place: PlaceMarker): MapPoint {
  return {
    id: `place:${place.id}`,
    kind: 'place',
    lat: place.lat,
    lng: place.lng,
    title: place.name,
    subtitle: [place.category_name, place.district].filter(Boolean).join(' · '),
    tone: toneOf(place.tone) ?? 'accent',
    icon: place.icon,
    meta: { marker: place },
  };
}

export function listingToMapPoint(listing: RealEstateMarker): MapPoint {
  return {
    id: `re:${listing.id}`,
    kind: 'real_estate',
    lat: listing.lat,
    lng: listing.lng,
    title: listing.title,
    subtitle: [listing.district, listing.neighborhood].filter(Boolean).join(' · '),
    label: shortPrice(listing.price_cents, listing.currency),
    tone: 'primary',
    icon: 'home',
    meta: { marker: listing },
  };
}

export function toMapPoints(markers: ExploreMarker[]): MapPoint[] {
  return markers.map((marker) =>
    marker.kind === 'place' ? placeToMapPoint(marker) : listingToMapPoint(marker),
  );
}

export function markerFromPoint(point: MapPoint): ExploreMarker | null {
  const marker = point.meta?.marker;
  if (!marker || typeof marker !== 'object') {
    return null;
  }
  return marker as ExploreMarker;
}
