import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type MarketMapListing = {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  price_period: string | null;
  listing_kind: string | null;
  kind: string;
  category_slug: string;
  category_name: string;
  category_icon: string | null;
  district: string | null;
  neighborhood: string | null;
  lat: number;
  lng: number;
  approximate: boolean;
  cover_path: string | null;
  created_at: string;
  published_at: string | null;
};

export type MarketMapBbox = {
  west: number;
  east: number;
  south: number;
  north: number;
};

export async function fetchMarketMapListings(input: {
  bbox?: MarketMapBbox | null;
  polygon?: { type: 'Polygon'; coordinates: number[][][] } | null;
  kinds?: string[] | null;
  limit?: number;
  minPrice?: number | null;
  maxPrice?: number | null;
  districtId?: number | null;
  condition?: string | null;
}): Promise<Result<MarketMapListing[]>> {
  const { data, error } = await supabase.rpc('market_map_listings', {
    p_bbox: input.bbox ?? null,
    p_polygon: input.polygon ?? null,
    p_kinds: input.kinds?.length ? input.kinds : null,
    p_limit: input.limit ?? 300,
    p_min_price: input.minPrice ?? null,
    p_max_price: input.maxPrice ?? null,
    p_district_id: input.districtId ?? null,
    p_condition: input.condition ?? null,
  });
  if (error) {
    return fail(rpcError(error));
  }
  const payload = (data ?? {}) as { items?: MarketMapListing[] };
  return ok((payload.items ?? []).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)));
}
