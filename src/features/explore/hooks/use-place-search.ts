import { useMemo } from 'react';

import { useExploreBootstrap, useExploreSearch } from './use-explore';
import { useExternalPlaceSearch } from './use-external-place-search';
import type {
  ExploreSearchItem,
  ExternalPlaceSuggestion,
  LatLng,
  PlaceCategory,
} from '../types';
import { matchCategorySlug, normalizeTr } from '../utils/place-match';

export type PlaceSearchProvider = 'trabzone' | 'google' | 'apple' | 'osm';

export const PLACE_PROVIDER_LABEL: Record<PlaceSearchProvider, string> = {
  trabzone: 'Trabzone',
  google: 'Google',
  apple: 'Apple',
  osm: 'OpenStreetMap',
};

/** Arama listesinde tek bir satırı temsil eden birleşik sonuç. */
export type PlaceSearchResult = {
  /** Liste anahtarı (aynı işletme iki kaynaktan gelirse çakışmaz). */
  key: string;
  /** Kayıt Trabzone'da mı var, haritadan mı geldi? */
  origin: 'trabzone' | 'external';
  provider: PlaceSearchProvider;
  /** Trabzone kaydı varsa işletme kimliği; harita sonucu seçilince oluşur. */
  placeId: string | null;
  title: string;
  subtitle: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  imagePath: string | null;
  rating: number | null;
  verified: boolean;
  /** Harita sonucunun Trabzone kategorisine eşlenmiş hâli (aktarımda kullanılır). */
  categorySlug: string | null;
  /** Harita sağlayıcısından gelen ham kayıt; aktarım için gerekli. */
  external: ExternalPlaceSuggestion | null;
  /** Trabzone aramasından gelen ham kayıt. */
  local: ExploreSearchItem | null;
};

function flattenCategories(categories: readonly PlaceCategory[]): PlaceCategory[] {
  const flat: PlaceCategory[] = [];
  const walk = (list: readonly PlaceCategory[]) => {
    for (const category of list) {
      flat.push(category);
      if (category.children?.length) {
        walk(category.children);
      }
    }
  };
  walk(categories);
  return flat;
}

function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fromLocal(item: ExploreSearchItem): PlaceSearchResult {
  return {
    key: `trabzone:${item.id}`,
    origin: 'trabzone',
    provider: 'trabzone',
    placeId: String(item.id),
    title: item.title,
    subtitle: item.address
      ? [item.category, item.address].filter(Boolean).join(' · ')
      : item.subtitle,
    category: item.category,
    address: item.address ?? null,
    phone: item.phone ?? null,
    lat: item.lat,
    lng: item.lng,
    imagePath: item.image_path,
    rating: item.rating,
    verified: item.verified,
    categorySlug: null,
    external: null,
    local: item,
  };
}

function fromExternal(
  item: ExternalPlaceSuggestion,
  categorySlug: string | null,
): PlaceSearchResult {
  return {
    key: `${item.source}:${item.id}`,
    origin: 'external',
    provider: item.source,
    placeId: null,
    title: item.name,
    subtitle: [item.category, item.address].filter(Boolean).join(' · '),
    category: item.category,
    address: item.address || null,
    phone: item.phone,
    lat: item.lat,
    lng: item.lng,
    imagePath: null,
    rating: item.rating,
    verified: false,
    categorySlug,
    external: item,
    local: null,
  };
}

/**
 * Trabzone kayıtları + harita sağlayıcıları (Google, Apple, OpenStreetMap)
 * üzerinden birleşik işletme araması.
 *
 * Aynı işletme hem veritabanında hem haritada varsa Trabzone kaydı tek kez
 * gösterilir; harita sonuçları yalnızca veritabanında olmayanları ekler.
 * Böylece "haritada olan her işletme" aramada çıkar.
 */
export function usePlaceSearch(input: {
  query: string;
  limit?: number;
  around?: LatLng | null;
  enabled?: boolean;
}) {
  const query = input.query.replace(/\s+/g, ' ').trim();
  const active = (input.enabled ?? true) && query.length >= 2;
  const limit = input.limit ?? 40;

  const local = useExploreSearch(query, limit);
  const external = useExternalPlaceSearch({
    query,
    around: input.around ?? null,
    enabled: active,
  });
  const bootstrap = useExploreBootstrap();

  const categories = useMemo(
    () => flattenCategories(bootstrap.data?.place_categories ?? []),
    [bootstrap.data?.place_categories],
  );

  const localPlaces = useMemo(
    () => (local.data?.items ?? []).filter((item) => item.kind === 'place'),
    [local.data?.items],
  );

  const items = useMemo<PlaceSearchResult[]>(() => {
    const rows = localPlaces.map(fromLocal);
    for (const suggestion of external.items) {
      const duplicate = rows.some(
        (row) =>
          normalizeTr(row.title) === normalizeTr(suggestion.name) &&
          distanceMeters(
            { lat: row.lat, lng: row.lng },
            { lat: suggestion.lat, lng: suggestion.lng },
          ) <= 150,
      );
      if (duplicate) {
        continue;
      }
      rows.push(
        fromExternal(
          suggestion,
          matchCategorySlug(
            { category: suggestion.category, types: suggestion.types },
            categories,
          ),
        ),
      );
    }
    return rows;
  }, [categories, external.items, localPlaces]);

  return {
    items,
    localCount: localPlaces.length,
    externalCount: items.length - localPlaces.length,
    /** Yerel kayıtlar hazır değilken liste boş görünmesin. */
    loading: active && (local.isLoading || (external.loading && localPlaces.length === 0)),
    refreshing: local.isFetching || external.loading,
    externalLoading: external.loading,
    localError: local.isError ? local.error.message : null,
    externalError: external.error,
    searched: active && (local.isFetched || external.searched),
  };
}

/**
 * Yalnızca harita sağlayıcılarından gelen işletmeler.
 *
 * Genel arama ekranı gibi yerel kayıtları başka bir sorguyla zaten çeken
 * yüzeylerde kullanılır: aynı işletme iki kez listelenmez.
 */
export function useExternalBusinesses(input: {
  query: string;
  /** Yerelde bulunan işletmeler; tekilleştirme için kullanılır. */
  localPlaces?: readonly ExploreSearchItem[];
}) {
  const query = input.query.replace(/\s+/g, ' ').trim();
  const active = query.length >= 2;
  const external = useExternalPlaceSearch({ query, around: null, enabled: active });
  const bootstrap = useExploreBootstrap();
  const localPlaces = useMemo(() => input.localPlaces ?? [], [input.localPlaces]);

  const categories = useMemo(
    () => flattenCategories(bootstrap.data?.place_categories ?? []),
    [bootstrap.data?.place_categories],
  );

  const rows = useMemo<PlaceSearchResult[]>(() => {
    const result: PlaceSearchResult[] = [];
    for (const suggestion of external.items) {
      const duplicate = localPlaces.some(
        (place) =>
          normalizeTr(place.title) === normalizeTr(suggestion.name) &&
          distanceMeters(
            { lat: place.lat, lng: place.lng },
            { lat: suggestion.lat, lng: suggestion.lng },
          ) <= 150,
      );
      if (duplicate) {
        continue;
      }
      result.push(
        fromExternal(
          suggestion,
          matchCategorySlug(
            { category: suggestion.category, types: suggestion.types },
            categories,
          ),
        ),
      );
    }
    return result;
  }, [categories, external.items, localPlaces]);

  return {
    rows,
    loading: active && external.loading,
    error: external.error,
    searched: external.searched,
  };
}
