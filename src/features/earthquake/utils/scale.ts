/**
 * Büyüklük renk ölçeği. Renk körlüğüne dayanıklı, sakin bir sıra kullanılır
 * ve renk tek başına bilgi taşımaz: işaretlerde büyüklük değeri de yazılır.
 * Bu ölçek büyüklüğü (magnitude) gösterir; şiddet veya hasar değildir.
 */
export const MAGNITUDE_STEPS = [
  { min: -Infinity, max: 2, color: '#8FB3E0', label: '< 2,0' },
  { min: 2, max: 3, color: '#3F7CC4', label: '2,0–2,9' },
  { min: 3, max: 4, color: '#D9A21B', label: '3,0–3,9' },
  { min: 4, max: 5, color: '#D7651C', label: '4,0–4,9' },
  { min: 5, max: Infinity, color: '#A8322A', label: '5,0+' },
] as const;

export function magnitudeColor(magnitude: number): string {
  return (MAGNITUDE_STEPS.find((step) => magnitude >= step.min && magnitude < step.max) ?? MAGNITUDE_STEPS[0]).color;
}

/** Yazının okunaklı kalması için işaret üstündeki metin rengi. */
export function magnitudeTextColor(magnitude: number): string {
  return magnitude >= 2 && magnitude < 3 ? '#FFFFFF' : magnitude >= 4 ? '#FFFFFF' : '#0B1B33';
}

/** İşaret çapı (pt): büyüklükle doğrusal ve sınırlı. */
export function magnitudeSize(magnitude: number): number {
  const clamped = Math.min(Math.max(magnitude, 0), 7);
  return Math.round(18 + clamped * 5);
}

/** Olay yaşına göre opaklık: yeni kayıtlar belirgin, eskiler soluk. */
export function ageOpacity(occurredAt: string, now = Date.now()): number {
  const hours = (now - Date.parse(occurredAt)) / 3600_000;
  if (hours <= 1) return 1;
  if (hours <= 24) return 0.88;
  if (hours <= 24 * 7) return 0.7;
  return 0.5;
}

export type MagnitudeBucket = 'all' | 'm0' | 'm2' | 'm3' | 'm4' | 'm5';

export const MAGNITUDE_BUCKETS: { key: MagnitudeBucket; label: string; min: number | null; max: number | null }[] = [
  { key: 'all', label: 'Tümü', min: null, max: null },
  { key: 'm0', label: '0–1,9', min: 0, max: 2 },
  { key: 'm2', label: '2,0–2,9', min: 2, max: 3 },
  { key: 'm3', label: '3,0–3,9', min: 3, max: 4 },
  { key: 'm4', label: '4,0–4,9', min: 4, max: 5 },
  { key: 'm5', label: '5,0+', min: 5, max: null },
];

export type RangePreset = '24h' | '7d' | '30d' | '90d' | 'custom';

export const RANGE_PRESETS: { key: Exclude<RangePreset, 'custom'>; label: string; hours: number }[] = [
  { key: '24h', label: 'Son 24 saat', hours: 24 },
  { key: '7d', label: 'Son 7 gün', hours: 24 * 7 },
  { key: '30d', label: 'Son 30 gün', hours: 24 * 30 },
  { key: '90d', label: 'Son 90 gün', hours: 24 * 90 },
];

/** Sorgu anahtarı dakikada bir değişsin diye başlangıç dakikaya yuvarlanır. */
export function rangeFrom(preset: Exclude<RangePreset, 'custom'>, now = Date.now()): string {
  const hours = RANGE_PRESETS.find((entry) => entry.key === preset)?.hours ?? 24 * 7;
  const minute = Math.floor(now / 60_000) * 60_000;
  return new Date(minute - hours * 3600_000).toISOString();
}

/** Merkez etrafında yaklaşık daire (büyük daire formülü), [enlem, boylam] dizisi. */
export function radiusRing(lat: number, lng: number, radiusKm: number, steps = 72): { lat: number; lng: number }[] {
  const R = 6371;
  const d = radiusKm / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const ring: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push({ lat: (φ2 * 180) / Math.PI, lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180 });
  }
  return ring;
}

/** Bölgeye uygun harita yakınlaştırması. */
export function zoomForRegion(region: string): number {
  switch (region) {
    case 'province':
      return 8.3;
    case 'r50':
      return 8.6;
    case 'r100':
      return 7.7;
    case 'r150':
      return 7.1;
    case 'r250':
      return 6.4;
    default:
      return 4.9;
  }
}
