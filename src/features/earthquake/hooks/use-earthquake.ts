import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { supabase } from '@/services/supabase/client';
import type { Result } from '@/utils/result';

import * as api from '../services/earthquake-service';
import { useEarthquakeFilterStore } from '../store';
import type {
  EarthquakeAnalytics,
  EarthquakeBootstrap,
  EarthquakeDetail,
  EarthquakeFeedPage,
  EarthquakeFilters,
  EarthquakeMapData,
  EarthquakeOrder,
  EarthquakeOverview,
  EarthquakePrefs,
  EarthquakePrefsInput,
  EarthquakeRegion,
} from '../types';
import { MAGNITUDE_BUCKETS, rangeFrom } from '../utils/scale';

function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  return promise.then((result) => {
    if (!result.ok) throw result.error;
    return result.data;
  });
}

export const earthquakeKeys = {
  all: ['earthquake'] as const,
  bootstrap: ['earthquake', 'bootstrap'] as const,
  overview: (f: EarthquakeFilters) => ['earthquake', 'overview', f] as const,
  feed: (f: EarthquakeFilters, order: EarthquakeOrder) => ['earthquake', 'feed', f, order] as const,
  map: (f: EarthquakeFilters) => ['earthquake', 'map', f] as const,
  analytics: (f: EarthquakeFilters) => ['earthquake', 'analytics', f] as const,
  detail: (key: string) => ['earthquake', 'detail', key] as const,
  shape: (key: string) => ['earthquake', 'shape', key] as const,
  prefs: ['earthquake', 'prefs'] as const,
  history: ['earthquake', 'history'] as const,
};

/** Kaynak senkron aralığı 60 sn; istemci de en fazla bu sıklıkta tazeler. */
const LIVE_REFRESH_MS = 60_000;

/** `periodMs` aralığıyla artan zaman dilimi; kayan zaman pencereli filtreleri tazelemek için. */
export function useTimeBucket(periodMs: number): number {
  const [bucket, setBucket] = useState(() => Math.floor(Date.now() / periodMs));
  useEffect(() => {
    const id = setInterval(() => setBucket(Math.floor(Date.now() / periodMs)), Math.min(periodMs, 60_000));
    return () => clearInterval(id);
  }, [periodMs]);
  return bucket;
}

export function useEarthquakeBootstrap() {
  return useQuery<EarthquakeBootstrap>({
    queryKey: earthquakeKeys.bootstrap,
    queryFn: () => unwrap(api.fetchBootstrap()),
    staleTime: 60_000,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

/** Ortak filtre durumunu sorgu parametrelerine çevirir. */
export function useEarthquakeFilters(): EarthquakeFilters & { regionResolved: EarthquakeRegion } {
  const bootstrap = useEarthquakeBootstrap();
  const state = useEarthquakeFilterStore();
  const regionResolved: EarthquakeRegion = state.region ?? bootstrap.data?.settings.default_region ?? 'r150';
  const bucket = MAGNITUDE_BUCKETS.find((entry) => entry.key === state.bucket) ?? { min: null, max: null };
  const minuteTick = useTimeBucket(60_000);

  return useMemo(() => {
    const from = state.range === 'custom' ? state.customFrom : rangeFrom(state.range);
    const to = state.range === 'custom' ? state.customTo : null;
    return {
      region: regionResolved,
      regionResolved,
      district: state.district,
      from,
      to,
      minMagnitude: bucket.min,
      maxMagnitude: bucket.max,
      source: state.source,
    };
    // Dakika değiştikçe kayan pencere tazelenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionResolved, state.district, state.range, state.customFrom, state.customTo, bucket, state.source, minuteTick]);
}

export function useEarthquakeOverview(filters: EarthquakeFilters, enabled = true) {
  return useQuery<EarthquakeOverview>({
    queryKey: earthquakeKeys.overview(filters),
    queryFn: () => unwrap(api.fetchOverview(filters)),
    enabled,
    staleTime: 30_000,
    refetchInterval: LIVE_REFRESH_MS,
    placeholderData: (previous) => previous,
  });
}

export function useEarthquakeFeed(filters: EarthquakeFilters, order: EarthquakeOrder, pageSize = 40, enabled = true) {
  return useInfiniteQuery<EarthquakeFeedPage>({
    queryKey: earthquakeKeys.feed(filters, order),
    queryFn: ({ pageParam }) => unwrap(api.fetchFeed(filters, order, pageSize, Number(pageParam) || 0)),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.has_more ? last.offset + last.limit : undefined),
    enabled,
    staleTime: 30_000,
    refetchInterval: LIVE_REFRESH_MS,
    placeholderData: (previous) => previous,
  });
}

export function useEarthquakeMap(filters: EarthquakeFilters, enabled = true) {
  return useQuery<EarthquakeMapData>({
    queryKey: earthquakeKeys.map(filters),
    queryFn: () => unwrap(api.fetchMap(filters)),
    enabled,
    staleTime: 30_000,
    refetchInterval: LIVE_REFRESH_MS,
    placeholderData: (previous) => previous,
  });
}

export function useEarthquakeAnalytics(filters: EarthquakeFilters, enabled = true) {
  return useQuery<EarthquakeAnalytics>({
    queryKey: earthquakeKeys.analytics(filters),
    queryFn: () => unwrap(api.fetchAnalytics(filters)),
    enabled,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

export function useEarthquakeDetail(key: string) {
  return useQuery<EarthquakeDetail>({
    queryKey: earthquakeKeys.detail(key),
    queryFn: () => unwrap(api.fetchDetail(key)),
    enabled: key.length > 0,
    staleTime: 30_000,
    refetchInterval: LIVE_REFRESH_MS,
    retry: (count, error) => {
      const code = (error as { code?: string } | null)?.code;
      return code !== 'not_found' && count < 2;
    },
  });
}

export function useEarthquakeRegionShape(key: string | null) {
  return useQuery({
    queryKey: earthquakeKeys.shape(key ?? ''),
    queryFn: () => unwrap(api.fetchRegionShape(key ?? '')),
    enabled: Boolean(key),
    staleTime: 24 * 3600_000,
  });
}

export function useEarthquakePrefs(enabled: boolean) {
  return useQuery<EarthquakePrefs>({
    queryKey: earthquakeKeys.prefs,
    queryFn: () => unwrap(api.fetchPrefs()),
    enabled,
    staleTime: 30_000,
  });
}

export function useSaveEarthquakePrefs() {
  const queryClient = useQueryClient();
  return useMutation<EarthquakePrefs, Error, EarthquakePrefsInput>({
    mutationFn: (input) => unwrap(api.savePrefs(input)),
    onSuccess: (data) => queryClient.setQueryData(earthquakeKeys.prefs, data),
  });
}

export function useEarthquakeHistory(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: earthquakeKeys.history,
    queryFn: ({ pageParam }) => unwrap(api.fetchHistory(30, Number(pageParam) || 0)),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.items.length === 30 ? pages.length * 30 : undefined),
    enabled,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Realtime: sunucu yeni/güncellenen kayıt yazınca "earthquake-feed" kanalına
// içeriksiz bir sinyal yollar; açık ekranlar sorgularını tazeler.
// Kanal süreç başına bir kez kurulur (bkz. legal realtime notu).
// ---------------------------------------------------------------------------
let channelReady = false;
const listeners = new Set<() => void>();

function ensureChannel() {
  if (channelReady) return;
  channelReady = true;
  try {
    supabase
      .channel('earthquake-feed')
      .on('broadcast', { event: 'earthquake_changed' }, () => listeners.forEach((listener) => listener()))
      .subscribe();
  } catch {
    // Kanal zaten kurulu olabilir; aynı olayları iletir.
  }
}

export function useEarthquakeRealtime(enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      // Aynı turda gelen birden çok sinyal tek tazelemeye indirgenir.
      timer = setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === 'earthquake' && query.queryKey[1] !== 'prefs' && query.queryKey[1] !== 'shape',
        });
      }, 1500);
    };
    listeners.add(refresh);
    ensureChannel();
    return () => {
      listeners.delete(refresh);
      if (timer) clearTimeout(timer);
    };
  }, [enabled, queryClient]);
}

export function useTrackEarthquakeView(key: string | undefined) {
  useEffect(() => {
    if (key) void api.trackView(key);
  }, [key]);
}
