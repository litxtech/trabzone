import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  EarthquakeAnalytics,
  EarthquakeBootstrap,
  EarthquakeDetail,
  EarthquakeFeedPage,
  EarthquakeFilters,
  EarthquakeHistoryItem,
  EarthquakeMapData,
  EarthquakeOrder,
  EarthquakeOverview,
  EarthquakePoint,
  EarthquakePrefs,
  EarthquakePrefsInput,
  EarthquakeSource,
} from '../types';

async function call<T>(name: string, params?: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(name, params ?? {});
  if (error) return fail(rpcError(error));
  if (data == null) return fail(appError('not_found'));
  return ok(data as T);
}

function filterParams(filters: EarthquakeFilters) {
  return {
    p_region: filters.region,
    p_district: filters.district,
    p_from: filters.from,
    p_to: filters.to,
    p_min_mag: filters.minMagnitude,
    p_max_mag: filters.maxMagnitude,
    p_source: filters.source,
  };
}

export function fetchBootstrap() {
  return call<EarthquakeBootstrap>('earthquake_bootstrap');
}

export function fetchOverview(filters: EarthquakeFilters) {
  return call<EarthquakeOverview>('earthquake_overview', filterParams(filters));
}

export function fetchFeed(filters: EarthquakeFilters, order: EarthquakeOrder, limit: number, offset: number) {
  return call<EarthquakeFeedPage>('earthquake_feed', {
    ...filterParams(filters),
    p_min_depth: filters.minDepth ?? null,
    p_max_depth: filters.maxDepth ?? null,
    p_order: order,
    p_limit: limit,
    p_offset: offset,
  });
}

type RawMap = { points: unknown[][]; total: number; truncated: boolean };

export async function fetchMap(filters: EarthquakeFilters): Promise<Result<EarthquakeMapData>> {
  const result = await call<RawMap>('earthquake_map', filterParams(filters));
  if (!result.ok) return result;
  const points: EarthquakePoint[] = result.data.points.map((row) => ({
    id: String(row[0]),
    lat: Number(row[1]),
    lng: Number(row[2]),
    magnitude: Number(row[3]),
    magnitudeType: (row[4] as string | null) ?? null,
    occurredAt: String(row[5]),
    depthKm: row[6] == null ? null : Number(row[6]),
    source: row[7] as EarthquakeSource,
    location: (row[8] as string | null) ?? null,
    distanceKm: Number(row[9]),
  }));
  return ok({ points, total: result.data.total, truncated: result.data.truncated });
}

type RawAnalytics = Omit<EarthquakeAnalytics, 'points'> & { points: unknown[][] };

export async function fetchAnalytics(filters: EarthquakeFilters): Promise<Result<EarthquakeAnalytics>> {
  const result = await call<RawAnalytics>('earthquake_analytics', filterParams(filters));
  if (!result.ok) return result;
  return ok({
    ...result.data,
    points: result.data.points.map((row) => ({
      id: String(row[0]),
      occurredAt: String(row[1]),
      magnitude: Number(row[2]),
      depthKm: row[3] == null ? null : Number(row[3]),
      magnitudeType: (row[4] as string | null) ?? null,
    })),
  });
}

export function fetchDetail(key: string) {
  return call<EarthquakeDetail>('earthquake_detail', { p_key: key });
}

export function fetchRegionShape(key: string) {
  return call<{ key: string; name?: string; ring: [number, number][] | null }>('earthquake_region_shape', {
    p_key: key,
  });
}

export async function trackView(key: string): Promise<void> {
  await supabase.rpc('earthquake_track_view', { p_key: key });
}

export function fetchPrefs() {
  return call<EarthquakePrefs>('earthquake_prefs_get');
}

export function savePrefs(input: EarthquakePrefsInput) {
  return call<EarthquakePrefs>('earthquake_prefs_set', { p_payload: input });
}

export function fetchHistory(limit: number, offset: number) {
  return call<{ items: EarthquakeHistoryItem[] }>('earthquake_notification_history', {
    p_limit: limit,
    p_offset: offset,
  });
}
