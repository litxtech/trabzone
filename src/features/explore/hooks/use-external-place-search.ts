import { useEffect, useMemo, useState } from 'react';

import { useDebouncedValue } from '@/hooks/use-debounced-value';

import {
  searchExternalPlaces,
  type ExternalPlaceSearchFailure,
} from '../services/place-search-service';
import type { ExternalPlaceSource, ExternalPlaceSuggestion, LatLng } from '../types';

type SearchState = {
  items: ExternalPlaceSuggestion[];
  providers: ExternalPlaceSource[];
  loading: boolean;
  error: ExternalPlaceSearchFailure | null;
  /** En az bir arama tamamlandı mı? "Sonuç yok" ile "henüz aramadın" ayrımı. */
  searched: boolean;
};

type SettledSearch = {
  /** Sonucun ait olduğu sorgu; sorgu değişince eski sonuç gizlenir. */
  query: string;
  items: ExternalPlaceSuggestion[];
  providers: ExternalPlaceSource[];
  error: ExternalPlaceSearchFailure | null;
  searched: boolean;
};

const IDLE: SearchState = {
  items: [],
  providers: [],
  loading: false,
  error: null,
  searched: false,
};

/**
 * "Haritaya yer ekle" formundaki harici harita araması.
 *
 * Sorgu 320 ms bekletilir, önceki istek iptal edilir; böylece her tuş
 * vuruşunda sağlayıcı kotası harcanmaz. Google + Apple sonuçları sunucuda
 * birleştirilmiş olarak gelir. Sonuçlar tamamlanana kadar yükleniyor
 * durumu döner; eski sorgunun sonuçları gösterilmez.
 */
export function useExternalPlaceSearch(input: {
  query: string;
  around: LatLng | null;
  enabled?: boolean;
}) {
  const { query, around, enabled = true } = input;
  const debounced = useDebouncedValue(query.replace(/\s+/g, ' ').trim(), 320);
  const lat = around?.lat ?? null;
  const lng = around?.lng ?? null;
  const active = enabled && debounced.length >= 2;
  const [settled, setSettled] = useState<SettledSearch | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void searchExternalPlaces({
      query: debounced,
      around: lat != null && lng != null ? { lat, lng } : null,
      limit: 12,
      signal: controller.signal,
    }).then((result) => {
      if (cancelled) {
        return;
      }
      setSettled({
        query: debounced,
        items: result.ok ? result.items : [],
        providers: result.ok ? result.providers : [],
        error: result.ok ? null : result.reason,
        searched: true,
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active, debounced, lat, lng]);

  return useMemo<SearchState>(() => {
    if (!active) {
      return IDLE;
    }
    // Sorgu değiştiyse önceki sonuçlar gösterilmez.
    if (!settled || settled.query !== debounced) {
      return { ...IDLE, loading: true };
    }
    return {
      items: settled.items,
      providers: settled.providers,
      loading: false,
      error: settled.error,
      searched: settled.searched,
    };
  }, [active, debounced, settled]);
}
