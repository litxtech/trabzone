import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  LatLng,
  MapExploreResult,
  MapFriend,
  MapLayerKey,
  MapRegion,
  MapSavedPlace,
} from '../types';
import {
  addSavedPlace,
  deleteSavedPlace,
  exploreMap,
  followRegion,
  getMapAdminOverview,
  getMapPreferences,
  heartbeatLocationShare,
  listMapAdminActiveShares,
  listMapFriends,
  listRegions,
  listSavedPlaces,
  mapQueryKeys,
  saveMapPreferences,
  startLocationShare,
  stopAllSharing,
  stopLocationShare,
  stopMapAdminShare,
  unfollowRegion,
  type MapPreferencePatch,
} from '../services/map-data';

export function useMapPreferences() {
  return useQuery({
    queryKey: mapQueryKeys.preferences,
    queryFn: async () => {
      const result = await getMapPreferences();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    staleTime: 30_000,
  });
}

export function useSaveMapPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: MapPreferencePatch) => {
      const result = await saveMapPreferences(patch);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(mapQueryKeys.preferences, data);
    },
  });
}

export function useMapExplore(input: {
  camera: { lat: number; lng: number; zoom: number } | null;
  layers: MapLayerKey[];
  radiusKm: number;
  enabled: boolean;
}) {
  const layers = input.layers.filter((layer) => layer === 'friends' || layer === 'rides').sort();
  return useQuery({
    queryKey: mapQueryKeys.explore(input.camera ?? { lat: 0, lng: 0, zoom: 0 }, layers),
    queryFn: async (): Promise<MapExploreResult> => {
      if (!input.camera) {
        throw new Error('Kamera hazır değil.');
      }
      const result = await exploreMap({
        lat: input.camera.lat,
        lng: input.camera.lng,
        radiusKm: input.radiusKm,
        layers,
      });
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    enabled: input.enabled && input.camera !== null,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });
}

export function useMapFriends(enabled = true) {
  return useQuery<MapFriend[]>({
    queryKey: mapQueryKeys.friends,
    queryFn: async () => {
      const result = await listMapFriends();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useSavedPlaces(enabled = true) {
  return useQuery<MapSavedPlace[]>({
    queryKey: mapQueryKeys.savedPlaces,
    queryFn: async () => {
      const result = await listSavedPlaces();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useAddSavedPlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof addSavedPlace>[0]) => {
      const result = await addSavedPlace(input);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mapQueryKeys.savedPlaces });
    },
  });
}

export function useDeleteSavedPlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await deleteSavedPlace(id);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mapQueryKeys.savedPlaces });
    },
  });
}

export function useRegions(enabled = true) {
  return useQuery<MapRegion[]>({
    queryKey: mapQueryKeys.regions,
    queryFn: async () => {
      const result = await listRegions();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useFollowRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof followRegion>[0]) => {
      const result = await followRegion(input);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mapQueryKeys.regions });
    },
  });
}

export function useUnfollowRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await unfollowRegion(id);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mapQueryKeys.regions });
    },
  });
}

export function useStartLocationShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof startLocationShare>[0]) => {
      const result = await startLocationShare(input);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mapQueryKeys.preferences });
      void queryClient.invalidateQueries({ queryKey: ['map', 'explore'] as const });
    },
  });
}

export function useStopLocationShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await stopLocationShare();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mapQueryKeys.preferences });
      void queryClient.invalidateQueries({ queryKey: ['map', 'explore'] as const });
    },
  });
}

export function useStopAllSharing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await stopAllSharing();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mapQueryKeys.preferences });
      void queryClient.invalidateQueries({ queryKey: ['map', 'explore'] as const });
    },
  });
}

export type DeviceLocationState = {
  status: 'unknown' | 'granted' | 'denied' | 'unavailable';
  point: LatLng | null;
  requesting: boolean;
  request: () => Promise<LatLng | null>;
  refresh: () => Promise<LatLng | null>;
};

/**
 * Konum izni isteğe bağlıdır: izin verilmese de harita şehir aramasıyla
 * kullanılabilir. İzin istenirken uygulama donmaz.
 */
export function useDeviceLocation(autoRequest = false): DeviceLocationState {
  const [status, setStatus] = useState<DeviceLocationState['status']>('unknown');
  const [point, setPoint] = useState<LatLng | null>(null);
  const [requesting, setRequesting] = useState(false);
  const moduleRef = useRef<typeof import('expo-location') | null>(null);

  const load = useCallback(async () => {
    if (moduleRef.current) {
      return moduleRef.current;
    }
    try {
      const module = await import('expo-location');
      moduleRef.current = module;
      return module;
    } catch {
      return null;
    }
  }, []);

  const read = useCallback(async (): Promise<LatLng | null> => {
    const module = await load();
    if (!module) {
      setStatus('unavailable');
      return null;
    }
    try {
      const position = await module.getCurrentPositionAsync({
        accuracy: module.Accuracy.Balanced,
      });
      const next = { lat: position.coords.latitude, lng: position.coords.longitude };
      setPoint(next);
      setStatus('granted');
      return next;
    } catch {
      return null;
    }
  }, [load]);

  const request = useCallback(async (): Promise<LatLng | null> => {
    setRequesting(true);
    try {
      const module = await load();
      if (!module) {
        setStatus('unavailable');
        return null;
      }
      const current = await module.getForegroundPermissionsAsync();
      const permission =
        current.status === 'granted' ? current : await module.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setStatus('denied');
        return null;
      }
      setStatus('granted');
      return await read();
    } finally {
      setRequesting(false);
    }
  }, [load, read]);

  useEffect(() => {
    if (!autoRequest) {
      return;
    }
    void (async () => {
      const module = await load();
      if (!module) {
        setStatus('unavailable');
        return;
      }
      const current = await module.getForegroundPermissionsAsync();
      if (current.status === 'granted') {
        setStatus('granted');
        await read();
      }
    })();
  }, [autoRequest, load, read]);

  return { status, point, requesting, request, refresh: read };
}

// ---------------------------------------------------------------------------
// Yönetici
// ---------------------------------------------------------------------------
export function useMapAdminOverview() {
  return useQuery({
    queryKey: ['map', 'admin', 'overview'] as const,
    queryFn: async () => {
      const result = await getMapAdminOverview();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    staleTime: 30_000,
  });
}

export function useMapAdminActiveShares(enabled: boolean) {
  return useQuery({
    queryKey: ['map', 'admin', 'shares'] as const,
    enabled,
    queryFn: async () => {
      const result = await listMapAdminActiveShares();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    refetchInterval: 30_000,
  });
}

export function useMapAdminStopShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; reason: string }) => {
      const result = await stopMapAdminShare(input.sessionId, input.reason);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['map', 'admin'] });
    },
  });
}

/**
 * Aktif konum paylaşımı sırasında cihaz konumunu yeniler. Gerçek GPS
 * güncellemesi gelmediğinde sahte hareket üretilmez; yalnızca gerçek okuma
 * sonucu sunucuya taşınır.
 */
export function useLocationPulse(active: boolean, refresh: () => Promise<LatLng | null>) {
  useEffect(() => {
    if (!active) {
      return;
    }
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 20_000);
    return () => clearInterval(timer);
  }, [active, refresh]);
}

/**
 * Aktif konum paylaşımı sırasında cihaz konumunu sunucuya taşır. Sunucu
 * 5 saniyeden sık güncellemeyi kendi tarafında da engeller.
 */
export function useShareHeartbeat(active: boolean, point: LatLng | null) {
  const lastSent = useRef(0);

  useEffect(() => {
    if (!active || !point) {
      return;
    }
    const now = Date.now();
    if (now - lastSent.current < 15_000) {
      return;
    }
    lastSent.current = now;
    void heartbeatLocationShare(point.lat, point.lng);
  }, [active, point]);
}
