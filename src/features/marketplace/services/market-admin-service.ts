import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type { ListingStatus, OrderStatus } from './marketplace-service';

/**
 * Yönetici marketplace servisleri. Tüm çağrılar sunucuda `market.manage` /
 * `market.orders.view` yetkisiyle doğrulanır; istemci yalnızca arayüzü gizler.
 */

export type AdminCategory = {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  listing_count: number;
  child_count: number;
};

export type AdminListing = {
  id: string;
  title: string;
  status: ListingStatus;
  moderation_status: string;
  price_cents: number;
  currency: string;
  city: string | null;
  created_at: string;
  seller_id: string;
  seller_username: string;
  seller_verified: boolean;
  image_path: string | null;
  report_count: number;
};

export type AdminOrder = {
  id: string;
  order_no: string;
  status: OrderStatus;
  total_cents: number;
  currency: string;
  payment_method: 'arrange_with_seller' | 'stripe' | 'iap';
  payment_status: 'not_collected' | 'pending' | 'paid' | 'refunded';
  created_at: string;
  buyer_id: string;
  seller_id: string;
  buyer_username: string;
  seller_username: string;
  item_count: number;
};

export type AdminCategoryV2 = {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  icon: string | null;
  kind: string;
  tone: string;
  description: string | null;
  aliases: string[] | null;
  form_schema: Record<string, unknown>;
  is_featured: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  depth: number;
  path_names: string;
  listing_count: number;
  child_count: number;
};

export type AdminListingV2 = {
  id: string;
  title: string;
  status: string;
  moderation_status: string;
  verification_status: string;
  kind: string;
  category_name: string | null;
  category_slug: string | null;
  price_cents: number;
  currency: string;
  price_period: string;
  city: string | null;
  district: string | null;
  district_id: number | null;
  created_at: string;
  published_at: string | null;
  view_count: number;
  favorite_count: number;
  seller_id: string;
  seller_username: string;
  seller_verified: boolean;
  cover_path: string | null;
  media_count: number;
  report_count: number;
};

export type AdminListingMedia = {
  id: string;
  kind: 'image' | 'video';
  storage_path: string;
  thumb_path: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sort_order: number;
  processing_status: string;
  is_cover: boolean;
};

export type AdminListingDetail = AdminListingV2 & {
  description: string | null;
  category_path?: string[];
  district: string | null;
  neighborhood?: string | null;
  lat: number | null;
  lng: number | null;
  expires_at: string | null;
  attributes?: Record<string, unknown>;
  rejection_reason?: string | null;
  media?: AdminListingMedia[];
  history?: {
    id: string;
    from_status: string | null;
    to_status: string | null;
    reason: string | null;
    created_at: string;
    actor_username: string | null;
  }[];
  price_history?: {
    id: string;
    old_price_cents: number | null;
    new_price_cents: number;
    currency: string;
    changed_at: string;
    actor_username: string | null;
  }[];
  reports?: {
    id: string;
    reason: string | null;
    details: string | null;
    status: string;
    created_at: string;
    reporter_username: string | null;
  }[];
};

export type AdminOverviewV2 = {
  counts: {
    total: number;
    active: number;
    pending: number;
    draft: number;
    rejected: number;
    removed: number;
    today: number;
    week: number;
    month: number;
    products: number;
    vehicles: number;
    real_estate_market: number;
    services: number;
    views: number;
    favorites: number;
    places: number;
    published_places: number;
    real_estate_listings: number;
    published_real_estate: number;
    reports: number;
  };
  pending_items: {
    id: string;
    title: string;
    status: string;
    kind: string | null;
    price_cents: number;
    currency: string;
    created_at: string;
    seller_username: string;
    cover_path: string | null;
  }[];
};

export type AdminAnalytics = {
  daily: { day: string; created: number; published: number; favorites: number }[];
  kinds: { kind: string; label: string; total: number }[];
  districts: { district: string; total: number }[];
  top_viewed: { id: string; title: string; views: number; favorites: number }[];
  top_favorited: { id: string; title: string; views: number; favorites: number }[];
};

export const marketAdminQueryKeys = {
  categories: ['market', 'admin', 'categories'] as const,
  categoriesV2: ['market', 'admin', 'categories-v2'] as const,
  overviewV2: ['market', 'admin', 'overview-v2'] as const,
  analytics: (days: number) => ['market', 'admin', 'analytics', days] as const,
  listings: (params: { query: string; status: string | null }) =>
    ['market', 'admin', 'listings', params] as const,
  listingsV2: (params: Record<string, unknown>) =>
    ['market', 'admin', 'listings-v2', params] as const,
  listingDetailV2: (id: string) => ['market', 'admin', 'listing-detail-v2', id] as const,
  orders: (status: string | null) => ['market', 'admin', 'orders', status] as const,
};

const ADMIN_ERRORS: Record<string, string> = {
  invalid_name: 'Kategori adı 2-60 karakter olmalı.',
  invalid_slug: 'Kategori adresi yalnızca küçük harf, rakam ve tire içerebilir.',
  duplicate_slug: 'Bu kategori adresi zaten kullanılıyor.',
  invalid_parent: 'Alt kategori, alt kategoriye taşınamaz.',
  category_not_found: 'Kategori bulunamadı.',
  category_has_children: 'Alt kategorisi olan kategori silinemez.',
  category_in_use: 'İlanı olan kategori silinemez. Pasife alabilirsin.',
};

export function adminMarketError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const token = message.trim().split(/\s/)[0] ?? '';
  return ADMIN_ERRORS[token] ?? 'İşlem tamamlanamadı. Tekrar dene.';
}

export async function fetchAdminCategories(): Promise<Result<AdminCategory[]>> {
  const { data, error } = await supabase.rpc('market_admin_categories');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: AdminCategory[] } | null)?.items ?? []) as AdminCategory[]);
}

export async function upsertAdminCategory(input: {
  id?: string | null;
  name: string;
  slug?: string | null;
  parentId?: string | null;
  icon?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<Result<AdminCategory>> {
  const { data, error } = await supabase.rpc('market_admin_upsert_category', {
    p_id: input.id ?? null,
    p_name: input.name,
    p_slug: input.slug ?? null,
    p_parent_id: input.parentId ?? null,
    p_icon: input.icon ?? null,
    p_sort_order: input.sortOrder ?? 0,
    p_is_active: input.isActive ?? true,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as AdminCategory);
}

export async function deleteAdminCategory(id: string): Promise<Result<{ deleted: boolean }>> {
  const { data, error } = await supabase.rpc('market_admin_delete_category', { p_id: id });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as { deleted: boolean });
}

export async function fetchAdminListings(params: {
  query?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}): Promise<Result<{ items: AdminListing[]; total: number }>> {
  const { data, error } = await supabase.rpc('market_admin_listings', {
    p_query: params.query ?? null,
    p_status: params.status ?? null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });
  if (error) {
    return fail(rpcError(error));
  }
  const payload = (data ?? {}) as { items?: AdminListing[]; total?: number };
  return ok({ items: payload.items ?? [], total: payload.total ?? 0 });
}

export async function setAdminListingStatus(input: {
  id: string;
  status: 'active' | 'archived' | 'removed';
  reason?: string | null;
}): Promise<Result<{ id: string; status: string }>> {
  const { data, error } = await supabase.rpc('market_admin_set_listing_status', {
    p_listing_id: input.id,
    p_status: input.status,
    p_reason: input.reason ?? null,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as { id: string; status: string });
}

export async function fetchAdminOrders(params: {
  status?: string | null;
  limit?: number;
  offset?: number;
}): Promise<Result<{ items: AdminOrder[]; total: number }>> {
  const { data, error } = await supabase.rpc('market_admin_orders', {
    p_status: params.status ?? null,
    p_limit: params.limit ?? 30,
    p_offset: params.offset ?? 0,
  });
  if (error) {
    return fail(rpcError(error));
  }
  const payload = (data ?? {}) as { items?: AdminOrder[]; total?: number };
  return ok({ items: payload.items ?? [], total: payload.total ?? 0 });
}

/* ------------------------------ v2 yönetim ------------------------------ */

export async function fetchAdminCategoriesV2(): Promise<Result<AdminCategoryV2[]>> {
  const { data, error } = await supabase.rpc('market_admin_categories_v2');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: AdminCategoryV2[] } | null)?.items ?? []) as AdminCategoryV2[]);
}

export async function saveAdminCategoryV2(
  input: Record<string, unknown>,
): Promise<Result<AdminCategoryV2>> {
  const { data, error } = await supabase.rpc('market_admin_category_save', {
    p_payload: input,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as AdminCategoryV2);
}

export async function fetchAdminOverviewV2(): Promise<Result<AdminOverviewV2>> {
  const { data, error } = await supabase.rpc('market_admin_overview_v2');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as AdminOverviewV2);
}

export async function fetchAdminAnalytics(days = 14): Promise<Result<AdminAnalytics>> {
  const { data, error } = await supabase.rpc('market_admin_analytics', { p_days: days });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as AdminAnalytics);
}

export async function fetchAdminListingsV2(params: {
  query?: string | null;
  status?: string | null;
  kind?: string | null;
  category?: string | null;
  districtId?: number | null;
  limit?: number;
  offset?: number;
}): Promise<Result<{ items: AdminListingV2[]; total: number; limit: number; offset: number }>> {
  const { data, error } = await supabase.rpc('market_admin_listings_v2', {
    p_query: params.query ?? null,
    p_status: params.status ?? null,
    p_kind: params.kind ?? null,
    p_category: params.category ?? null,
    p_district_id: params.districtId ?? null,
    p_limit: params.limit ?? 30,
    p_offset: params.offset ?? 0,
  });
  if (error) {
    return fail(rpcError(error));
  }
  const payload = (data ?? {}) as {
    items?: AdminListingV2[];
    total?: number;
    limit?: number;
    offset?: number;
  };
  return ok({
    items: payload.items ?? [],
    total: payload.total ?? 0,
    limit: payload.limit ?? params.limit ?? 30,
    offset: payload.offset ?? params.offset ?? 0,
  });
}

export async function fetchAdminListingDetailV2(
  id: string,
): Promise<Result<AdminListingDetail>> {
  const { data, error } = await supabase.rpc('market_admin_listing_detail_v2', {
    p_listing_id: id,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as AdminListingDetail);
}

export async function moderateAdminListing(input: {
  id: string;
  action: 'approve' | 'reject' | 'remove' | 'restore' | 'expire';
  reason?: string | null;
}): Promise<Result<{ id: string; status: string }>> {
  const { data, error } = await supabase.rpc('market_admin_moderate_listing', {
    p_listing_id: input.id,
    p_action: input.action,
    p_reason: input.reason ?? null,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as { id: string; status: string });
}

export async function removeAdminListingMedia(
  mediaId: string,
  reason?: string | null,
): Promise<Result<{ removed: boolean; listing_id: string }>> {
  const { data, error } = await supabase.rpc('market_admin_remove_media', {
    p_media_id: mediaId,
    p_reason: reason ?? null,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as { removed: boolean; listing_id: string });
}
