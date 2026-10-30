// Deprem kaynaklarının (AFAD, USGS) ham kayıtlarını doğrulayıp ortak biçime
// çevirir. Saf TypeScript'tir (Deno API'si kullanmaz); edge function ve Node
// birim testleri aynı kodu kullanır.
//
// Canlı doğrulanan şema (2026-10):
//  AFAD apiv2/event/filter (format=json): dizi; her alan metin
//    { rms, eventID, location, latitude, longitude, depth, type, magnitude,
//      country, province, district, neighborhood, date, isEventUpdate (boolean),
//      lastUpdateDate (metin | null) }
//    `date` ve `lastUpdateDate` saat dilimi içermez ve UTC'dir.
//  USGS fdsnws/event/1/query (format=geojson): FeatureCollection; özellikler
//    mag (sayı | null), magType, place, time/updated (epoch ms), status, type,
//    url; geometri [boylam, enlem, derinlik km].

export type ProviderKey = 'afad' | 'usgs';

export type NormalizedQuake = {
  source_event_id: string;
  occurred_at: string;
  latitude: number;
  longitude: number;
  depth_km: number | null;
  magnitude: number;
  magnitude_type: string | null;
  location: string | null;
  province: string | null;
  district: string | null;
  neighborhood: string | null;
  country: string | null;
  rms: number | null;
  source_status: string | null;
  source_updated_at: string | null;
  url: string | null;
  raw: Record<string, unknown>;
};

export type Rejection = { source_event_id: string; reason: string };

export type ParseResult = {
  records: NormalizedQuake[];
  rejected: Rejection[];
  received: number;
};

/** Türkiye ve çevresi sorgu kutusu (AFAD ve USGS için aynı). */
export const TURKEY_BBOX = { minlat: 34, maxlat: 43.5, minlon: 25, maxlon: 45.5 } as const;

export const AFAD_ENDPOINT = 'https://deprem.afad.gov.tr/apiv2/event/filter';
export const USGS_ENDPOINT = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
/** AFAD tek sorguda en fazla bu kadar kayıt döndürür (canlı doğrulandı). */
export const AFAD_PAGE_LIMIT = 1000;

const DECIMAL = /^-?\d+(\.\d+)?$/;
const AFAD_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?$/;
const SOURCE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

function text(value: unknown, max = 240): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function decimal(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** AFAD tarih metni (saat dilimi yok, UTC) → ISO 8601 (Z). */
export function afadDateToIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!AFAD_DATE.test(trimmed)) return null;
  const [base, fraction] = trimmed.split('.');
  const millis = fraction ? `.${fraction.padEnd(3, '0').slice(0, 3)}` : '';
  const ms = Date.parse(`${base}${millis}Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** AFAD sorgu parametresi biçimi: YYYY-MM-DDTHH:mm:ss (UTC). */
export function afadParamDate(date: Date): string {
  return date.toISOString().slice(0, 19);
}

type Check = { ok: true } | { ok: false; reason: string };

function checkCommon(q: Omit<NormalizedQuake, 'raw'>, now: number): Check {
  if (!SOURCE_ID.test(q.source_event_id)) return { ok: false, reason: 'invalid_event_id' };
  const at = Date.parse(q.occurred_at);
  if (Number.isNaN(at)) return { ok: false, reason: 'invalid_time' };
  if (at > now + 10 * 60_000) return { ok: false, reason: 'time_in_future' };
  if (q.latitude < -90 || q.latitude > 90 || q.longitude < -180 || q.longitude > 180) {
    return { ok: false, reason: 'coordinates_out_of_range' };
  }
  if (q.latitude === 0 && q.longitude === 0) return { ok: false, reason: 'null_island' };
  if (q.magnitude < -3 || q.magnitude > 10) return { ok: false, reason: 'magnitude_out_of_range' };
  if (q.depth_km !== null && (q.depth_km < -10 || q.depth_km > 800)) {
    return { ok: false, reason: 'depth_out_of_range' };
  }
  return { ok: true };
}

export function parseAfad(payload: unknown, now = Date.now()): ParseResult {
  if (!Array.isArray(payload)) {
    throw new Error('afad_schema_not_array');
  }
  const records: NormalizedQuake[] = [];
  const rejected: Rejection[] = [];
  const seen = new Set<string>();

  for (const item of payload) {
    const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const id = typeof raw.eventID === 'string' ? raw.eventID.trim() : '';
    const reject = (reason: string) => rejected.push({ source_event_id: id.slice(0, 64), reason });

    if (!id) {
      reject('missing_event_id');
      continue;
    }
    if (seen.has(id)) {
      reject('duplicate_in_payload');
      continue;
    }
    const occurred = afadDateToIso(raw.date);
    const latitude = decimal(raw.latitude);
    const longitude = decimal(raw.longitude);
    const magnitude = decimal(raw.magnitude);
    if (!occurred) {
      reject('invalid_time');
      continue;
    }
    if (latitude === null || longitude === null) {
      reject('invalid_coordinates');
      continue;
    }
    if (magnitude === null) {
      reject('missing_magnitude');
      continue;
    }
    const depthRaw = raw.depth;
    const depth = depthRaw === null || depthRaw === undefined || depthRaw === '' ? null : decimal(depthRaw);
    if (depth === null && depthRaw !== null && depthRaw !== undefined && depthRaw !== '') {
      reject('invalid_depth');
      continue;
    }

    const quake: NormalizedQuake = {
      source_event_id: id,
      occurred_at: occurred,
      latitude,
      longitude,
      depth_km: depth,
      magnitude,
      magnitude_type: text(raw.type, 10),
      location: text(raw.location),
      province: text(raw.province, 80),
      district: text(raw.district, 80),
      neighborhood: text(raw.neighborhood, 120),
      country: text(raw.country, 80),
      rms: decimal(raw.rms),
      source_status: raw.isEventUpdate === true ? 'updated' : null,
      source_updated_at: afadDateToIso(raw.lastUpdateDate),
      url: SOURCE_ID.test(id) ? `https://deprem.afad.gov.tr/event-detail/${encodeURIComponent(id)}` : null,
      raw,
    };
    const check = checkCommon(quake, now);
    if (!check.ok) {
      reject(check.reason);
      continue;
    }
    seen.add(id);
    records.push(quake);
  }

  return { records, rejected, received: payload.length };
}

export function parseUsgs(payload: unknown, now = Date.now()): ParseResult {
  const collection = payload as { type?: unknown; features?: unknown };
  if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('usgs_schema_not_feature_collection');
  }
  const records: NormalizedQuake[] = [];
  const rejected: Rejection[] = [];

  for (const item of collection.features as unknown[]) {
    const feature = (item && typeof item === 'object' ? item : {}) as {
      id?: unknown;
      properties?: Record<string, unknown>;
      geometry?: { coordinates?: unknown };
    };
    const id = typeof feature.id === 'string' ? feature.id.trim() : '';
    const p = feature.properties ?? {};
    const reject = (reason: string) => rejected.push({ source_event_id: id.slice(0, 64), reason });

    if (!id) {
      reject('missing_event_id');
      continue;
    }
    if (p.type !== 'earthquake') {
      reject('not_earthquake');
      continue;
    }
    const coords = Array.isArray(feature.geometry?.coordinates) ? (feature.geometry?.coordinates as unknown[]) : [];
    const longitude = typeof coords[0] === 'number' ? coords[0] : null;
    const latitude = typeof coords[1] === 'number' ? coords[1] : null;
    const depth = typeof coords[2] === 'number' ? coords[2] : null;
    const magnitude = typeof p.mag === 'number' && Number.isFinite(p.mag) ? p.mag : null;
    const time = typeof p.time === 'number' ? p.time : null;
    if (time === null) {
      reject('invalid_time');
      continue;
    }
    if (latitude === null || longitude === null) {
      reject('invalid_coordinates');
      continue;
    }
    if (magnitude === null) {
      reject('missing_magnitude');
      continue;
    }

    const quake: NormalizedQuake = {
      source_event_id: id,
      occurred_at: new Date(time).toISOString(),
      latitude,
      longitude,
      depth_km: depth,
      magnitude,
      magnitude_type: text(p.magType, 10),
      location: text(p.place),
      province: null,
      district: null,
      neighborhood: null,
      country: null,
      rms: typeof p.rms === 'number' ? p.rms : null,
      source_status: text(p.status, 20),
      source_updated_at: typeof p.updated === 'number' ? new Date(p.updated).toISOString() : null,
      url: typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : null,
      raw: {
        id,
        mag: p.mag,
        magType: p.magType,
        place: p.place,
        time: p.time,
        updated: p.updated,
        status: p.status,
        net: p.net,
        code: p.code,
        ids: p.ids,
        sources: p.sources,
        type: p.type,
        nst: p.nst,
        dmin: p.dmin,
        rms: p.rms,
        gap: p.gap,
        url: p.url,
        coordinates: coords,
      },
    };
    const check = checkCommon(quake, now);
    if (!check.ok) {
      reject(check.reason);
      continue;
    }
    records.push(quake);
  }

  return { records, rejected, received: collection.features.length };
}

export function afadUrl(params: {
  start: Date;
  end: Date;
  limit?: number;
  offset?: number;
  bbox?: { minlat: number; maxlat: number; minlon: number; maxlon: number };
}): string {
  const url = new URL(AFAD_ENDPOINT);
  url.searchParams.set('start', afadParamDate(params.start));
  url.searchParams.set('end', afadParamDate(params.end));
  const bbox = params.bbox ?? TURKEY_BBOX;
  url.searchParams.set('minlat', String(bbox.minlat));
  url.searchParams.set('maxlat', String(bbox.maxlat));
  url.searchParams.set('minlon', String(bbox.minlon));
  url.searchParams.set('maxlon', String(bbox.maxlon));
  url.searchParams.set('orderby', 'timedesc');
  url.searchParams.set('limit', String(Math.min(params.limit ?? AFAD_PAGE_LIMIT, AFAD_PAGE_LIMIT)));
  if (params.offset) url.searchParams.set('offset', String(params.offset));
  url.searchParams.set('format', 'json');
  return url.toString();
}

export function usgsUrl(params: { start: Date; end: Date; limit?: number; minMagnitude?: number }): string {
  const url = new URL(USGS_ENDPOINT);
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('starttime', params.start.toISOString());
  url.searchParams.set('endtime', params.end.toISOString());
  url.searchParams.set('minlatitude', String(TURKEY_BBOX.minlat));
  url.searchParams.set('maxlatitude', String(TURKEY_BBOX.maxlat));
  url.searchParams.set('minlongitude', String(TURKEY_BBOX.minlon));
  url.searchParams.set('maxlongitude', String(TURKEY_BBOX.maxlon));
  url.searchParams.set('eventtype', 'earthquake');
  url.searchParams.set('orderby', 'time');
  url.searchParams.set('limit', String(Math.min(params.limit ?? 2000, 20000)));
  if (params.minMagnitude !== undefined) url.searchParams.set('minmagnitude', String(params.minMagnitude));
  return url.toString();
}

/** Expo Push API mesajı (standart öncelik; kritik uyarı kullanılmaz). */
export type PushItem = {
  delivery_id: string;
  token: string;
  platform: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  priority: 'normal' | 'high';
  sound: boolean;
  is_test: boolean;
};

export function expoMessage(item: PushItem) {
  return {
    to: item.token,
    title: item.title,
    body: item.body,
    data: item.data ?? {},
    sound: item.sound ? 'default' : null,
    priority: item.priority === 'high' ? 'high' : 'default',
    channelId: item.priority === 'high' ? 'earthquake-important' : 'earthquake',
    ttl: item.is_test ? 600 : 3600,
  };
}

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

const RETRYABLE_EXPO_ERRORS = new Set(['MessageRateExceeded', 'ExpoError', 'ServiceUnavailable']);

export function ticketToReport(deliveryId: string, ticket: ExpoTicket | undefined) {
  if (!ticket) {
    return { delivery_id: deliveryId, ok: false, error: 'missing_ticket', message: null, retryable: true };
  }
  if (ticket.status === 'ok') {
    return { delivery_id: deliveryId, ok: true, ticket_id: ticket.id };
  }
  const error = ticket.details?.error ?? 'unknown';
  return {
    delivery_id: deliveryId,
    ok: false,
    error,
    message: (ticket.message ?? '').slice(0, 300),
    retryable: RETRYABLE_EXPO_ERRORS.has(error),
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Üstel geri çekilme: 1 sn, 2 sn, 4 sn… (üst sınır 8 sn). */
export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(attempt - 1, 0), 8000);
}
