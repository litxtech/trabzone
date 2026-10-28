import { useQuery } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import {
  fetchMarketMapListings,
  type MarketMapBbox,
} from '../services/market-map-service';

export function useMarketMapListings(input: {
  bbox: MarketMapBbox | null;
  polygon: { type: 'Polygon'; coordinates: number[][][] } | null;
  kinds: string[] | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  districtId?: number | null;
  condition?: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [
      'market',
      'map',
      input.bbox,
      input.polygon,
      input.kinds,
      input.minPrice,
      input.maxPrice,
      input.districtId,
      input.condition,
    ],
    queryFn: () =>
      unwrap(
        fetchMarketMapListings({
          bbox: input.polygon ? null : input.bbox,
          polygon: input.polygon,
          kinds: input.kinds,
          minPrice: input.minPrice,
          maxPrice: input.maxPrice,
          districtId: input.districtId,
          condition: input.condition,
        }),
      ),
    enabled: input.enabled ?? true,
    staleTime: 20_000,
  });
}
