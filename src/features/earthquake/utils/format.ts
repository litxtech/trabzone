import type { EarthquakeEvent, EarthquakeRegion, EarthquakeSource, RegionClassification } from '../types';

/** Türkçe ondalık gösterim: 2.4 → "2,4". */
export function formatDecimal(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

export function formatMagnitude(value: number, type?: string | null): string {
  return `${type ? `${type} ` : ''}${formatDecimal(value, 1)}`;
}

export function formatDepth(value: number | null | undefined): string {
  return value == null ? 'Bildirilmedi' : `${formatDecimal(value, 1)} km`;
}

export function formatDistance(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return '—';
  return km < 10 ? `${formatDecimal(km, 1)} km` : `${Math.round(km)} km`;
}

export function formatCoordinate(value: number, digits = 4): string {
  return formatDecimal(value, digits);
}

const ISTANBUL_OFFSET_MS = 3 * 3600_000;

type Parts = { day: string; month: string; year: string; hour: string; minute: string; second: string };

function partsIn(date: Date, timeZone: 'Europe/Istanbul' | 'UTC'): Parts {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => formatted.find((part) => part.type === type)?.value ?? '00';
    return {
      day: get('day'),
      month: get('month'),
      year: get('year'),
      hour: get('hour') === '24' ? '00' : get('hour'),
      minute: get('minute'),
      second: get('second'),
    };
  } catch {
    // Intl saat dilimi desteği olmayan ortamlarda: Türkiye 2016'dan beri sabit UTC+3.
    const shifted = new Date(date.getTime() + (timeZone === 'UTC' ? 0 : ISTANBUL_OFFSET_MS));
    const pad = (n: number) => n.toString().padStart(2, '0');
    return {
      day: pad(shifted.getUTCDate()),
      month: pad(shifted.getUTCMonth() + 1),
      year: String(shifted.getUTCFullYear()),
      hour: pad(shifted.getUTCHours()),
      minute: pad(shifted.getUTCMinutes()),
      second: pad(shifted.getUTCSeconds()),
    };
  }
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 28.10.2026 */
export function formatLocalDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  const p = partsIn(date, 'Europe/Istanbul');
  return `${p.day}.${p.month}.${p.year}`;
}

/** 14:05:32 (Türkiye saati) */
export function formatLocalTime(value: string | Date | null | undefined, seconds = true): string {
  const date = toDate(value);
  if (!date) return '—';
  const p = partsIn(date, 'Europe/Istanbul');
  return seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
}

export function formatLocalDateTime(value: string | Date | null | undefined, seconds = false): string {
  const date = toDate(value);
  if (!date) return '—';
  return `${formatLocalDate(date)} ${formatLocalTime(date, seconds)}`;
}

export function formatUtcDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  const p = partsIn(date, 'UTC');
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second} UTC`;
}

export function formatAgo(value: string | Date | null | undefined, now = Date.now()): string {
  const date = toDate(value);
  if (!date) return '—';
  const diff = Math.max(0, now - date.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} gün önce`;
  return formatLocalDate(date);
}

export const REGION_LABELS: Record<EarthquakeRegion, string> = {
  province: 'Trabzon il sınırı',
  r50: '50 km',
  r100: '100 km',
  r150: '150 km',
  r250: '250 km',
  turkey: 'Türkiye geneli',
};

export const REGION_DESCRIPTIONS: Record<EarthquakeRegion, string> = {
  province: 'Trabzon il idari sınırı (OSM; karasuları dahil)',
  r50: 'Trabzon merkezine 50 km çevre',
  r100: 'Trabzon merkezine 100 km çevre',
  r150: 'Trabzon merkezine 150 km çevre',
  r250: 'Trabzon merkezine 250 km çevre',
  turkey: 'Türkiye ve çevresi',
};

export const REGION_RADIUS_KM: Partial<Record<EarthquakeRegion, number>> = {
  r50: 50,
  r100: 100,
  r150: 150,
  r250: 250,
};

export const SOURCE_LABELS: Record<EarthquakeSource, string> = { afad: 'AFAD', usgs: 'USGS' };

/** Olayın Trabzon'a göre konum etiketi. İlçe yalnızca poligon içindeyse yazılır. */
export function placeLabel(event: Pick<EarthquakeEvent, 'region_classification' | 'district_name' | 'distance_km' | 'location'>): string {
  const cls: RegionClassification = event.region_classification;
  if (cls === 'trabzon_province' && event.district_name) return `${event.district_name}, Trabzon`;
  if (cls === 'trabzon_offshore') return 'Trabzon açıkları';
  if (cls === 'trabzon_vicinity') return `Trabzon'a ${formatDistance(event.distance_km)}`;
  return event.location ?? 'Türkiye ve çevresi';
}

export function sourceLine(source: EarthquakeSource, sources: EarthquakeSource[]): string {
  if (source === 'usgs' && !sources.includes('afad')) return 'Kaynak: USGS';
  return sources.length > 1 ? `Kaynak: ${SOURCE_LABELS[source]} (+${sources.filter((s) => s !== source).map((s) => SOURCE_LABELS[s]).join(', ')})` : `Kaynak: ${SOURCE_LABELS[source]}`;
}
