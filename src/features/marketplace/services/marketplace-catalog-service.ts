import type { RealEstateListing } from '@/features/explore/types';
import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import type { AppError } from '@/services/errors';
import { fail, ok, type Result } from '@/utils/result';

/**
 * Trabzone Marketplace — Premium Hybrid katalog servisi.
 *
 * Tüm veriler Supabase RPC'lerinden gelir; arayüzde örnek/varsayılan ilan
 * üretilmez. RPC sözleşmeleri 0050–0052 migration'larındaki JSON yapılarıyla
 * birebir eşleşir.
 */

export type MarketKind = 'product' | 'real_estate' | 'vehicle' | 'service' | 'place' | 'job';

export type MarketFormField = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | string;
  options?: string[];
  required?: boolean;
  placeholder?: string;
};

export type MarketFormSchema = {
  fields?: MarketFormField[];
  price_mode?: string;
  [key: string]: unknown;
};

export type CategoryNode = {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  icon: string | null;
  tone: string | null;
  kind: MarketKind | string;
  aliases: string[];
  path_slugs: string[];
  path_names: string[];
  listing_count: number;
  is_featured: boolean;
  sort_order: number;
  form_schema: MarketFormSchema | null;
  children: CategoryNode[];
};

export type CategorySearchRow = {
  id: string;
  slug: string;
  name: string;
  kind: MarketKind | string;
  icon: string | null;
  tone: string | null;
  path_slugs: string[];
  path_names: string[];
  listing_count: number;
};

export type MarketMediaItem = {
  id: string;
  listing_id: string;
  storage_path: string;
  thumb_path: string | null;
  kind: 'image' | 'video';
  sort_order: number;
  is_cover: boolean;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  processing_status: string;
  created_at: string | null;
};

export type MarketListing = {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  price_period: string;
  condition: string;
  status: string;
  stock: number;
  category_id: string | null;
  category_slug: string | null;
  category_name: string | null;
  category_kind: MarketKind | string | null;
  category_path: string[];
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  district_id: number | null;
  neighborhood_id: number | null;
  lat: number | null;
  lng: number | null;
  attributes: Record<string, unknown>;
  contact_prefs: Record<string, unknown>;
  verification_status: string;
  hide_exact_location: boolean;
  view_count: number;
  favorite_count: number;
  message_count: number;
  cover_path: string | null;
  cover_thumb_path: string | null;
  media_count: number;
  video_count: number;
  media: MarketMediaItem[];
  seller_username: string | null;
  seller_display_name: string | null;
  seller_avatar_path: string | null;
  seller_verified: boolean;
  seller_rating: number | null;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  is_favorite: boolean;
  is_mine: boolean;
};

export type MarketListingPage = {
  items: MarketListing[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  facets?: Record<string, unknown> | null;
};

export type MarketSection = {
  key: string;
  title: string;
  subtitle: string | null;
  kind?: string;
  items: MarketListing[];
};

export type PlaceSummary = {
  id: string;
  name: string;
  category_slug: string | null;
  category_name: string | null;
  icon: string | null;
  district: string | null;
  neighborhood: string | null;
  rating: number | null;
  review_count: number;
  cover_path: string | null;
  is_verified: boolean;
  lat: number | null;
  lng: number | null;
  price_level: number | null;
  is_open: boolean | null;
};

export type SavedSearch = {
  id: string;
  label: string;
  filters: Record<string, unknown>;
  notify_enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
  last_notified_at: string | null;
};

export type MarketFeaturedCategory = {
  slug: string;
  name: string;
  icon: string | null;
  tone: string | null;
  kind: string;
  description: string | null;
};

export type MarketHomeData = {
  city: { id: string | null; name: string; slug: string | null } | null;
  stats: {
    active_listings: number;
    places: number;
    sellers: number;
    listings: number;
    pending: number;
    vehicles: number;
    real_estate: number;
  };
  categories: MarketFeaturedCategory[];
  new_listings: MarketListing[];
  popular: MarketListing[];
  vehicles: MarketListing[];
  recommendations: MarketListing[];
  real_estate: RealEstateListing[];
  places: PlaceSummary[];
  personalized: boolean;
};

export type MarketCatalogParams = {
  query?: string | null;
  kind?: string | null;
  category?: string | null;
  subcategory?: string | null;
  districtId?: number | null;
  neighborhoodId?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  condition?: string | null;
  attributes?: Record<string, unknown> | null;
  sort?: 'new' | 'price_asc' | 'price_desc' | 'popular' | 'near';
  limit?: number;
  offset?: number;
  favorites?: boolean;
  mine?: boolean;
  /** Harita alan çizimi — [[lng,lat],...] kapalı poligon. */
  polygon?: [number, number][] | null;
  bbox?: { west: number; east: number; south: number; north: number } | null;
  lat?: number | null;
  lng?: number | null;
};

export type MyListingsScope = 'published' | 'pending' | 'draft' | 'expired' | 'sold' | 'archived';

export type MyListingsCounts = Record<MyListingsScope, number>;

export type MyListingsData = {
  items: MarketListing[];
  total: number;
  counts: MyListingsCounts;
  has_more: boolean;
  scope: MyListingsScope;
};

export type ListingMediaInput = {
  storage_path: string;
  thumb_path?: string | null;
  kind?: 'image' | 'video';
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  is_cover?: boolean;
  processing_status?: string;
};

export type ListingV2Input = {
  id?: string | null;
  title: string;
  description?: string | null;
  category_id: string;
  price_cents: number;
  currency?: string;
  price_period?: 'total' | 'month' | 'hour' | 'service';
  condition?: 'new' | 'like_new' | 'good' | 'fair';
  stock?: number;
  attributes?: Record<string, unknown>;
  hide_exact_location?: boolean;
  contact_prefs?: Record<string, unknown>;
  location?: {
    city_id?: string | null;
    district_id?: number | null;
    neighborhood_id?: number | null;
    lat?: number | null;
    lng?: number | null;
  } | null;
  media?: ListingMediaInput[] | null;
};

export type ListingV2Result = {
  id: string;
  status: string;
  verification_status: string;
};

export type MarketSellerSummary = {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  is_verified: boolean;
  account_status: string;
  created_at: string | null;
  active_listings: number;
  sold_listings: number;
  rating: number | null;
  review_count: number;
};

export type MarketListingDetail = {
  listing: MarketListing;
  seller: MarketSellerSummary;
  similar: MarketListing[];
  seller_listing_count: number;
};

export type MarketSearchHub = {
  listings: MarketListing[];
  categories: CategorySearchRow[];
  places: PlaceSummary[];
};

export type ListingStatus =
  | 'active'
  | 'reserved'
  | 'sold'
  | 'expired'
  | 'archived'
  | 'removed'
  | 'draft';

export type MarketSearchHistoryItem = {
  id: string;
  query: string;
  kind: string | null;
  result_count: number;
  created_at: string | null;
};

export const marketCatalogKeys = {
  all: ['market-v2'] as const,
  home: () => [...marketCatalogKeys.all, 'home'] as const,
  searchHistory: () => [...marketCatalogKeys.all, 'search-history'] as const,
  searchHub: (term: string) => [...marketCatalogKeys.all, 'search-hub', term] as const,
  categories: () => [...marketCatalogKeys.all, 'categories'] as const,
  categorySearch: (term: string) => [...marketCatalogKeys.all, 'category-search', term] as const,
  catalog: (filters: Record<string, unknown>) => [...marketCatalogKeys.all, 'catalog', filters] as const,
  listing: (id: string | null) => [...marketCatalogKeys.all, 'listing', id ?? 'none'] as const,
  myListings: (scope: string) => [...marketCatalogKeys.all, 'mine', scope] as const,
  savedSearches: () => [...marketCatalogKeys.all, 'saved-searches'] as const,
  sellerListings: (sellerId: string | null) => [...marketCatalogKeys.all, 'seller-listings', sellerId ?? 'none'] as const,
  places: (filters: Record<string, unknown>) => [...marketCatalogKeys.all, 'places', filters] as const,
};

function toAppError(error: unknown): AppError {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return appError('unknown', message || 'İşlem tamamlanamadı.');
}

async function rpc<T>(
  name: string,
  args?: Record<string, unknown>,
  allowNull = false,
): Promise<Result<T>> {
  try {
    const response = args ? await supabase.rpc(name, args) : await supabase.rpc(name);
    if (response.error) {
      return fail(toAppError(response.error));
    }
    if (response.data == null && !allowNull) {
      return fail(appError('unknown', 'Sunucudan veri alınamadı.'));
    }
    return ok(response.data as T);
  } catch (error) {
    return fail(toAppError(error));
  }
}

/**
 * İlan medyasını normalize eder.
 *
 * `tz_listing_json_v2` görselleri `images` anahtarıyla döndürüyor; eski
 * istemci sözleşmesi ise `media` bekliyor. İki adı da kabul etmezsek detay
 * ekranındaki galeri boş kalıyordu (kart önizlemesi `cover_path` ile
 * çalıştığı için görsel orada görünüyordu).
 */
function normalizeListingMedia(raw: Record<string, unknown>): MarketMediaItem[] {
  const source = Array.isArray(raw.media)
    ? raw.media
    : Array.isArray(raw.images)
      ? raw.images
      : [];
  const items: MarketMediaItem[] = [];
  source.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const item = entry as Record<string, unknown>;
    const storagePath = typeof item.storage_path === 'string' ? item.storage_path : null;
    if (!storagePath) {
      return;
    }
    items.push({
      id: String(item.id ?? `${raw.id ?? 'listing'}-${index}`),
      listing_id: String(item.listing_id ?? raw.id ?? ''),
      storage_path: storagePath,
      thumb_path:
        typeof item.thumb_path === 'string' && item.thumb_path ? item.thumb_path : null,
      kind: item.kind === 'video' ? 'video' : 'image',
      sort_order: Number(item.sort_order ?? index),
      is_cover: Boolean(item.is_cover),
      width: item.width == null ? null : Number(item.width),
      height: item.height == null ? null : Number(item.height),
      duration_ms: item.duration_ms == null ? null : Number(item.duration_ms),
      processing_status: String(item.processing_status ?? 'ready'),
      created_at: (item.created_at as string | null) ?? null,
    });
  });
  return items;
}

function normalizeListing(raw: Record<string, unknown>): MarketListing {
  const media = normalizeListingMedia(raw);
  const cover = media.find((item) => item.is_cover) ?? media[0] ?? null;
  return {
    id: String(raw.id),
    seller_id: String(raw.seller_id ?? ''),
    title: String(raw.title ?? ''),
    description: (raw.description as string | null) ?? null,
    price_cents: Number(raw.price_cents ?? 0),
    currency: String(raw.currency ?? 'TRY'),
    price_period: String(raw.price_period ?? 'total'),
    condition: String(raw.condition ?? 'good'),
    status: String(raw.status ?? 'active'),
    stock: Number(raw.stock ?? 1),
    category_id: (raw.category_id as string | null) ?? null,
    category_slug: (raw.category_slug as string | null) ?? null,
    category_name: (raw.category_name as string | null) ?? null,
    category_kind: (raw.category_kind as string | null) ?? null,
    category_path: Array.isArray(raw.category_path) ? (raw.category_path as string[]) : [],
    city: (raw.city as string | null) ?? null,
    district: (raw.district as string | null) ?? null,
    neighborhood: (raw.neighborhood as string | null) ?? null,
    district_id: raw.district_id == null ? null : Number(raw.district_id),
    neighborhood_id: raw.neighborhood_id == null ? null : Number(raw.neighborhood_id),
    lat: raw.lat == null ? null : Number(raw.lat),
    lng: raw.lng == null ? null : Number(raw.lng),
    attributes:
      raw.attributes && typeof raw.attributes === 'object'
        ? (raw.attributes as Record<string, unknown>)
        : {},
    contact_prefs:
      raw.contact_prefs && typeof raw.contact_prefs === 'object'
        ? (raw.contact_prefs as Record<string, unknown>)
        : {},
    verification_status: String(raw.verification_status ?? 'not_required'),
    hide_exact_location: Boolean(raw.hide_exact_location),
    view_count: Number(raw.view_count ?? 0),
    favorite_count: Number(raw.favorite_count ?? 0),
    message_count: Number(raw.message_count ?? 0),
    cover_path: (raw.cover_path as string | null) ?? cover?.storage_path ?? null,
    cover_thumb_path: (raw.cover_thumb_path as string | null) ?? cover?.thumb_path ?? null,
    media_count: Number(raw.media_count ?? media.length),
    video_count: Number(raw.video_count ?? media.filter((item) => item.kind === 'video').length),
    media,
    seller_username: (raw.seller_username as string | null) ?? null,
    seller_display_name: (raw.seller_display_name as string | null) ?? null,
    seller_avatar_path: (raw.seller_avatar_path as string | null) ?? null,
    seller_verified: Boolean(raw.seller_verified),
    seller_rating: raw.seller_rating == null ? null : Number(raw.seller_rating),
    published_at: (raw.published_at as string | null) ?? null,
    created_at: (raw.created_at as string | null) ?? null,
    updated_at: (raw.updated_at as string | null) ?? null,
    expires_at: (raw.expires_at as string | null) ?? null,
    is_favorite: Boolean(raw.is_favorite),
    is_mine: Boolean(raw.is_mine),
  };
}

function normalizeListingPage(raw: unknown): MarketListingPage {
  const data = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(data.items) ? data.items : [];
  const limit = Number(data.limit ?? items.length);
  const offset = Number(data.offset ?? 0);
  const total = Number(data.total ?? items.length);
  return {
    items: items.map((item) => normalizeListing(item as Record<string, unknown>)),
    total,
    limit,
    offset,
    has_more: data.has_more != null ? Boolean(data.has_more) : offset + items.length < total,
    facets:
      data.facets && typeof data.facets === 'object'
        ? (data.facets as Record<string, unknown>)
        : null,
  };
}

function splitPathSlugs(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split('/')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function splitPathNames(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/\s*>\s*/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeFormSchema(raw: unknown): MarketFormSchema | null {
  return raw && typeof raw === 'object' ? (raw as MarketFormSchema) : null;
}

function normalizeCategory(raw: Record<string, unknown>): CategoryNode {
  return {
    id: String(raw.id),
    parent_id: (raw.parent_id as string | null) ?? null,
    slug: String(raw.slug ?? ''),
    name: String(raw.name ?? ''),
    icon: (raw.icon as string | null) ?? null,
    tone: (raw.tone as string | null) ?? null,
    kind: String(raw.kind ?? 'product'),
    aliases: Array.isArray(raw.aliases) ? (raw.aliases as string[]) : [],
    path_slugs: splitPathSlugs(raw.path_slugs ?? raw.path_slug),
    path_names: splitPathNames(raw.path_names),
    listing_count: Number(raw.listing_count ?? 0),
    is_featured: Boolean(raw.is_featured),
    sort_order: Number(raw.sort_order ?? 0),
    form_schema: normalizeFormSchema(raw.form_schema),
    children: Array.isArray(raw.children)
      ? (raw.children as Record<string, unknown>[]).map(normalizeCategory)
      : [],
  };
}

/** RPC düz liste döndürür; ekranlar için parent_id üzerinden ağaca çevrilir. */
function buildCategoryTree(rows: Record<string, unknown>[]): CategoryNode[] {
  const nodes = rows.map(normalizeCategory);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: CategoryNode[] = [];
  nodes.forEach((node) => {
    if (node.parent_id) {
      const parent = byId.get(node.parent_id);
      if (parent) {
        parent.children.push(node);
        return;
      }
    }
    roots.push(node);
  });
  const sort = (items: CategoryNode[]) => {
    items.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr'));
    items.forEach((item) => sort(item.children));
  };
  sort(roots);
  return roots;
}

export async function fetchMarketHome(): Promise<Result<MarketHomeData>> {
  const result = await rpc<Record<string, unknown>>('market_home');
  if (!result.ok) {
    return result;
  }
  const raw = result.data;
  const counts = (raw.counts ?? {}) as Record<string, unknown>;
  const newListings = Array.isArray(raw.new_listings)
    ? (raw.new_listings as Record<string, unknown>[]).map(normalizeListing)
    : [];
  const recommendations = Array.isArray(raw.personalized)
    ? (raw.personalized as Record<string, unknown>[]).map(normalizeListing)
    : [];
  const newIds = newListings.map((item) => item.id).join(',');
  const personalIds = recommendations.map((item) => item.id).join(',');
  return ok({
    city: null,
    stats: {
      listings: Number(counts.listings ?? 0),
      active_listings: Number(counts.active ?? 0),
      pending: Number(counts.pending ?? 0),
      places: Number(counts.places ?? 0),
      sellers: 0,
      vehicles: Number(counts.vehicles ?? 0),
      real_estate: Number(counts.real_estate ?? 0),
    },
    categories: Array.isArray(raw.featured_categories)
      ? (raw.featured_categories as Record<string, unknown>[]).map((row) => ({
          slug: String(row.slug ?? ''),
          name: String(row.name ?? ''),
          icon: (row.icon as string | null) ?? null,
          tone: (row.tone as string | null) ?? null,
          kind: String(row.kind ?? 'product'),
          description: (row.description as string | null) ?? null,
        }))
      : [],
    new_listings: newListings,
    popular: Array.isArray(raw.popular)
      ? (raw.popular as Record<string, unknown>[]).map(normalizeListing)
      : [],
    vehicles: Array.isArray(raw.vehicles)
      ? (raw.vehicles as Record<string, unknown>[]).map(normalizeListing)
      : [],
    recommendations,
    real_estate: Array.isArray(raw.real_estate) ? (raw.real_estate as RealEstateListing[]) : [],
    places: Array.isArray(raw.places) ? (raw.places as PlaceSummary[]) : [],
    personalized: personalIds.length > 0 && personalIds !== newIds,
  });
}

export async function fetchCategoryTree(): Promise<Result<CategoryNode[]>> {
  const result = await rpc<Record<string, unknown>>('market_categories_v2');
  if (!result.ok) {
    return result;
  }
  const rows = Array.isArray(result.data)
    ? (result.data as Record<string, unknown>[])
    : Array.isArray(result.data.items)
      ? (result.data.items as Record<string, unknown>[])
      : [];
  return ok(buildCategoryTree(rows));
}

export async function searchCategories(
  term: string,
  limit = 20,
): Promise<Result<CategorySearchRow[]>> {
  const trimmed = term.trim();
  if (trimmed.length < 2) {
    return ok([]);
  }
  const result = await rpc<Record<string, unknown>>('market_category_search', {
    p_query: trimmed,
    p_limit: limit,
  });
  if (!result.ok) {
    return result;
  }
  const rows = Array.isArray(result.data)
    ? (result.data as Record<string, unknown>[])
    : Array.isArray(result.data.items)
      ? (result.data.items as Record<string, unknown>[])
      : [];
  return ok(
    rows.map((row) => ({
      id: String(row.id),
      slug: String(row.slug ?? ''),
      name: String(row.name ?? ''),
      kind: String(row.kind ?? 'product'),
      icon: (row.icon as string | null) ?? null,
      tone: (row.tone as string | null) ?? null,
      path_slugs: splitPathSlugs(row.path_slugs ?? row.path_slug),
      path_names: splitPathNames(row.path_names),
      listing_count: Number(row.listing_count ?? 0),
    })),
  );
}

export async function fetchMarketCatalog(
  params: MarketCatalogParams,
): Promise<Result<MarketListingPage>> {
  const result = await rpc<Record<string, unknown>>('market_catalog_v2', {
    p_query: params.query?.trim() || null,
    p_kind: params.kind ?? null,
    p_category: params.category ?? null,
    p_subcategory: params.subcategory ?? null,
    p_district_id: params.districtId ?? null,
    p_neighborhood_id: params.neighborhoodId ?? null,
    p_min_price: params.minPrice ?? null,
    p_max_price: params.maxPrice ?? null,
    p_condition: params.condition ?? null,
    p_sort: params.sort ?? 'new',
    p_limit: params.limit ?? 24,
    p_offset: params.offset ?? 0,
    p_favorites: params.favorites ?? false,
    p_mine: params.mine ?? false,
    p_attributes: params.attributes ?? {},
    p_polygon: params.polygon ?? null,
    p_bbox: params.bbox ?? null,
    p_lat: params.lat ?? null,
    p_lng: params.lng ?? null,
  });
  if (!result.ok) {
    return result;
  }
  return ok(normalizeListingPage(result.data));
}

export async function fetchListingDetail(id: string): Promise<Result<MarketListingDetail>> {
  const result = await rpc<Record<string, unknown>>('market_listing_detail', { p_listing_id: id });
  if (!result.ok) {
    return result;
  }
  const raw = result.data;
  const rawSeller = (raw.seller ?? {}) as Record<string, unknown>;
  return ok({
    listing: normalizeListing(raw.listing as Record<string, unknown>),
    seller: {
      id: String(rawSeller.id ?? ''),
      username: String(rawSeller.username ?? ''),
      display_name: String(rawSeller.display_name ?? rawSeller.username ?? ''),
      avatar_path: (rawSeller.avatar_path as string | null) ?? null,
      is_verified: Boolean(rawSeller.is_verified),
      account_status: String(rawSeller.account_status ?? 'active'),
      created_at: (rawSeller.created_at as string | null) ?? null,
      active_listings: Number(rawSeller.active_listings ?? 0),
      sold_listings: Number(rawSeller.sold_listings ?? 0),
      rating: rawSeller.rating == null ? null : Number(rawSeller.rating),
      review_count: Number(rawSeller.review_count ?? 0),
    },
    similar: Array.isArray(raw.similar)
      ? (raw.similar as Record<string, unknown>[]).map(normalizeListing)
      : [],
    seller_listing_count: Number(raw.seller_listing_count ?? 0),
  });
}

export async function fetchSearchHub(
  query: string,
  limit = 8,
  kind: string | null = null,
): Promise<Result<MarketSearchHub>> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return ok({ listings: [], categories: [], places: [] });
  }
  const result = await rpc<Record<string, unknown>>('market_search_hub', {
    p_query: trimmed,
    p_limit: limit,
    p_kind: kind,
  });
  if (!result.ok) {
    return result;
  }
  const raw = result.data;
  return ok({
    listings: Array.isArray(raw.listings)
      ? (raw.listings as Record<string, unknown>[]).map(normalizeListing)
      : [],
    categories: Array.isArray(raw.categories)
      ? (raw.categories as Record<string, unknown>[]).map((row) => ({
          id: String(row.id),
          slug: String(row.slug ?? ''),
          name: String(row.name ?? ''),
          kind: String(row.kind ?? 'product'),
          icon: (row.icon as string | null) ?? null,
          tone: (row.tone as string | null) ?? null,
          path_slugs: splitPathSlugs(row.path_slugs ?? row.path_slug),
          path_names: splitPathNames(row.path_names),
          listing_count: Number(row.listing_count ?? 0),
        }))
      : [],
    places: Array.isArray(raw.places) ? (raw.places as PlaceSummary[]) : [],
  });
}

export async function fetchMyListings(
  scope: MyListingsScope,
  limit = 20,
  offset = 0,
): Promise<Result<MyListingsData>> {
  const result = await rpc<Record<string, unknown>>('market_my_listings', {
    p_scope: scope,
    p_limit: limit,
    p_offset: offset,
  });
  if (!result.ok) {
    return result;
  }
  const raw = result.data;
  const items = Array.isArray(raw.items)
    ? (raw.items as Record<string, unknown>[]).map(normalizeListing)
    : [];
  const countsRaw = (raw.counts ?? {}) as Record<string, unknown>;
  return ok({
    items,
    total: Number(raw.total ?? items.length),
    counts: {
      published: Number(countsRaw.published ?? 0),
      pending: Number(countsRaw.pending ?? 0),
      draft: Number(countsRaw.draft ?? 0),
      expired: Number(countsRaw.expired ?? 0),
      sold: Number(countsRaw.sold ?? 0),
      archived: Number(countsRaw.archived ?? 0),
    },
    has_more: Boolean(raw.has_more),
    scope,
  });
}

export async function createListingV2(input: ListingV2Input): Promise<Result<ListingV2Result>> {
  return rpc<ListingV2Result>('market_create_listing_v2', {
    p_payload: {
      title: input.title,
      description: input.description ?? null,
      category_id: input.category_id,
      price_cents: input.price_cents,
      currency: input.currency ?? 'TRY',
      price_period: input.price_period ?? 'total',
      condition: input.condition ?? 'good',
      stock: input.stock ?? 1,
      attributes: input.attributes ?? {},
      hide_exact_location: input.hide_exact_location ?? true,
      contact_prefs: input.contact_prefs ?? {},
      location: input.location ?? {},
      media: input.media ?? [],
    },
  });
}

export async function updateListingV2(
  id: string,
  input: Partial<ListingV2Input>,
): Promise<Result<MarketListing>> {
  const result = await rpc<Record<string, unknown>>('market_update_listing_v2', {
    p_listing_id: id,
    p_payload: {
      ...(input.title != null ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category_id != null ? { category_id: input.category_id } : {}),
      ...(input.price_cents != null ? { price_cents: input.price_cents } : {}),
      ...(input.currency != null ? { currency: input.currency } : {}),
      ...(input.price_period != null ? { price_period: input.price_period } : {}),
      ...(input.condition != null ? { condition: input.condition } : {}),
      ...(input.stock != null ? { stock: input.stock } : {}),
      ...(input.attributes != null ? { attributes: input.attributes } : {}),
      ...(input.hide_exact_location != null
        ? { hide_exact_location: input.hide_exact_location }
        : {}),
      ...(input.contact_prefs != null ? { contact_prefs: input.contact_prefs } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.media != null ? { media: input.media } : {}),
    },
  });
  if (!result.ok) {
    return result;
  }
  return ok(normalizeListing(result.data));
}

export async function setListingStatusV2(
  id: string,
  status: ListingStatus,
  reason?: string | null,
): Promise<Result<{ id: string; status: string }>> {
  return rpc<{ id: string; status: string }>('market_set_status_v2', {
    p_listing_id: id,
    p_status: status,
    p_reason: reason ?? null,
  });
}

export async function deleteListingV2(id: string): Promise<Result<{ id: string }>> {
  // `market_delete_listing` void döner: RPC başarılı olduğunda `data` null gelir.
  // Boş yanıtı hata saymak, silme gerçekleşmiş olsa bile arayüzde "silinemedi"
  // göstermesine ve kullanıcının silinmiş ilan sayfasında kalmasına yol açıyordu.
  const result = await rpc<{ id: string } | null>(
    'market_delete_listing',
    { p_listing_id: id },
    true,
  );
  if (!result.ok) {
    return result;
  }
  return ok({ id });
}

export async function fetchSavedSearches(): Promise<Result<SavedSearch[]>> {
  const result = await rpc<Record<string, unknown>>('market_saved_searches');
  if (!result.ok) {
    return result;
  }
  const items = Array.isArray(result.data.items) ? (result.data.items as Record<string, unknown>[]) : [];
  return ok(
    items.map((row) => ({
      id: String(row.id),
      label: String(row.label ?? 'Kaydedilmiş arama'),
      filters:
        row.filters && typeof row.filters === 'object'
          ? (row.filters as Record<string, unknown>)
          : {},
      notify_enabled: row.notify_enabled !== false,
      created_at: (row.created_at as string | null) ?? null,
      updated_at: (row.updated_at as string | null) ?? null,
      last_notified_at: (row.last_notified_at as string | null) ?? null,
    })),
  );
}

export async function saveSearch(input: {
  id?: string | null;
  label: string;
  filters: Record<string, unknown>;
  notifyEnabled?: boolean;
}): Promise<Result<{ id: string }>> {
  return rpc<{ id: string }>('market_saved_search_save', {
    p_payload: {
      ...(input.id ? { id: input.id } : {}),
      label: input.label,
      filters: input.filters,
      notify_enabled: input.notifyEnabled ?? true,
    },
  });
}

export async function deleteSavedSearch(id: string): Promise<Result<null>> {
  return rpc<null>('market_saved_search_delete', { p_id: id }, true);
}

export async function toggleFavoriteV2(listingId: string): Promise<Result<{ favorite: boolean }>> {
  return rpc<{ favorite: boolean }>('market_toggle_favorite', { p_listing_id: listingId });
}

export async function fetchSellerListings(
  sellerId: string,
  limit = 12,
): Promise<Result<{ items: MarketListing[]; total: number; has_more: boolean }>> {
  const result = await rpc<Record<string, unknown>>('market_seller_listings_v2', {
    p_seller_id: sellerId,
    p_limit: limit,
    p_offset: 0,
  });
  if (!result.ok) {
    return result;
  }
  const items = Array.isArray(result.data.items) ? (result.data.items as Record<string, unknown>[]) : [];
  return ok({
    items: items.map(normalizeListing),
    total: Number(result.data.total ?? items.length),
    has_more: Boolean(result.data.has_more),
  });
}

export async function fetchSearchHistory(): Promise<Result<MarketSearchHistoryItem[]>> {
  const result = await rpc<Record<string, unknown>>('market_search_history_list', { p_limit: 12 });
  if (!result.ok) {
    return result;
  }
  const items = Array.isArray(result.data.items) ? (result.data.items as Record<string, unknown>[]) : [];
  return ok(
    items.map((row) => ({
      id: String(row.id),
      query: String(row.query ?? ''),
      kind: (row.kind as string | null) ?? null,
      result_count: Number(row.result_count ?? 0),
      created_at: (row.created_at as string | null) ?? null,
    })),
  );
}

export async function saveSearchHistory(
  query: string,
  kind?: string | null,
  resultCount = 0,
): Promise<Result<{ ok: boolean }>> {
  return rpc<{ ok: boolean }>('market_search_history_save', {
    p_query: query,
    p_kind: kind ?? null,
    p_result_count: resultCount,
  });
}

export async function clearSearchHistory(): Promise<Result<{ ok: boolean }>> {
  return rpc<{ ok: boolean }>('market_search_history_clear');
}

export async function fetchPlaces(params: {
  query?: string | null;
  category?: string | null;
  districtId?: number | null;
  sort?: string;
  limit?: number;
  offset?: number;
}): Promise<Result<{ items: PlaceSummary[]; total: number; has_more: boolean }>> {
  const result = await rpc<Record<string, unknown>>('market_places_list', {
    p_query: params.query?.trim() || null,
    p_category: params.category ?? null,
    p_district_id: params.districtId ?? null,
    p_sort: params.sort ?? 'rating',
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });
  if (!result.ok) {
    return result;
  }
  const items = Array.isArray(result.data.items) ? (result.data.items as PlaceSummary[]) : [];
  return ok({
    items,
    total: Number(result.data.total ?? items.length),
    has_more: Boolean(result.data.has_more),
  });
}

/**
 * Mevcut Trabzone mesajlaşma altyapısını kullanır: doğrudan konuşma açar ve
 * ilan bağlamını (`meta.listing`) içeren ilk mesajı gönderir. Ayrı bir sohbet
 * altyapısı oluşturulmaz.
 */
export async function messageSellerAboutListing(input: {
  listingId: string;
  sellerId: string;
  title: string;
  priceCents: number;
  currency: string;
  coverPath: string | null;
  body?: string;
}): Promise<Result<{ conversationId: string }>> {
  try {
    const conversation = await supabase.rpc('chat_start_direct', { p_user_id: input.sellerId });
    if (conversation.error || !conversation.data) {
      return fail(toAppError(conversation.error ?? 'conversation_failed'));
    }
    const conversationId = (conversation.data as { id?: string }).id;
    if (!conversationId) {
      return fail(appError('unknown', 'Sohbet açılamadı.'));
    }
    const sent = await supabase.rpc('chat_send_message', {
      p_conversation_id: conversationId,
      p_kind: 'text',
      p_body: input.body?.trim() || 'İlgilendiğiniz ilan hakkında bilgi almak istiyorum.',
      p_media_path: null,
      p_media_meta: {
        listing: {
          id: input.listingId,
          title: input.title,
          price_cents: input.priceCents,
          currency: input.currency,
          cover_path: input.coverPath,
        },
      },
      p_reply_to: null,
    });
    if (sent.error) {
      return fail(toAppError(sent.error));
    }
    return ok({ conversationId });
  } catch (error) {
    return fail(toAppError(error));
  }
}

/* ------------------------------- görünüm yardımcıları ------------------------------- */

export const PRICE_PERIOD_LABELS: Record<string, string> = {
  total: '',
  month: '/ ay',
  hour: '/ saat',
  service: '/ hizmet',
};

export const CONDITION_LABELS: Record<string, string> = {
  new: 'Sıfır',
  like_new: 'Az kullanılmış',
  good: 'İyi',
  fair: 'Yıpranmış',
};

export const STATUS_LABELS: Record<string, string> = {
  active: 'Yayında',
  pending: 'İncelemede',
  draft: 'Taslak',
  reserved: 'Rezerve',
  sold: 'Satıldı',
  expired: 'Süresi doldu',
  archived: 'Kaldırıldı',
  removed: 'Kaldırıldı',
};

export const VERIFICATION_LABELS: Record<string, string> = {
  not_required: '',
  pending: 'Doğrulama bekliyor',
  verified: 'Doğrulanmış',
  rejected: 'Doğrulanamadı',
  expired: 'Doğrulama süresi doldu',
};

export function formatMarketPrice(
  priceCents: number,
  currency = 'TRY',
  pricePeriod = 'total',
): string {
  if (priceCents <= 0) {
    return 'Görüşülür';
  }
  const value = new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    maximumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(priceCents / 100);
  const period = PRICE_PERIOD_LABELS[pricePeriod] ?? '';
  return `${value}${period}`;
}

export function formatRelativeDate(value: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return 'Şimdi';
  }
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} sa önce`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} gün önce`;
  }
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatAttributeValue(value: unknown): string {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'Evet' : 'Hayır';
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => formatAttributeValue(item))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((item) => formatAttributeValue(item))
      .filter(Boolean)
      .join(', ');
  }
  return String(value);
}

export function locationLabel(
  listing: Pick<MarketListing, 'district' | 'neighborhood' | 'city'>,
): string {
  const parts = [listing.neighborhood, listing.district, listing.city].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length ? parts.join(' / ') : 'Konum belirtilmedi';
}

export function primaryAttribute(
  attributes: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const formatted = formatAttributeValue(attributes[key]);
    if (formatted) {
      return formatted;
    }
  }
  return null;
}
