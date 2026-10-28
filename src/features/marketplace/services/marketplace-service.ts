import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type Condition = 'new' | 'like_new' | 'good' | 'fair';
export type ListingStatus = 'active' | 'reserved' | 'sold' | 'archived' | 'removed';
export type MarketSort = 'new' | 'price_asc' | 'price_desc' | 'popular';

export type MarketCategory = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  children: { id: string; slug: string; name: string; icon: string | null }[];
};

export type ListingImage = { id: string; storage_path: string };

export type Listing = {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  condition: Condition;
  city: string | null;
  district: string | null;
  stock: number;
  status: ListingStatus;
  view_count: number;
  favorite_count: number;
  created_at: string;
  category_id: string | null;
  category_slug: string | null;
  category_name: string | null;
  seller_username: string;
  seller_first_name: string | null;
  seller_last_name: string | null;
  seller_avatar_path: string | null;
  seller_verified: boolean;
  is_mine: boolean;
  is_favorite: boolean;
  images: ListingImage[];
};

export type SellerStats = {
  listings: number;
  sales: number;
  rating: number | null;
  review_count: number;
};

export type ListingDetail = Listing & { seller_stats: SellerStats };

export type SellerProfile = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_path: string | null;
  bio: string | null;
  city: string | null;
  is_verified: boolean;
  created_at: string;
  listings: number;
  sales: number;
  rating: number | null;
  review_count: number;
  reviews: {
    id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    reviewer_username: string;
  }[];
};

export type OrderStatus =
  | 'requested'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'rejected';

export type OrderItem = {
  id: string;
  listing_id: string;
  title: string;
  image_path: string | null;
  unit_price_cents: number;
  quantity: number;
};

export type MarketOrder = {
  id: string;
  order_no: string;
  status: OrderStatus;
  total_cents: number;
  currency: string;
  payment_status: string;
  created_at: string;
  role: 'buyer' | 'seller';
  counterpart_id: string;
  counterpart_username: string;
  counterpart_first_name: string | null;
  counterpart_last_name: string | null;
  counterpart_avatar_path: string | null;
  item_count: number;
  items: OrderItem[];
};

export type ListingInput = {
  title: string;
  description: string | null;
  price_cents: number;
  condition: Condition;
  stock: number;
  category_id: string | null;
  city: string | null;
  district: string | null;
  images: string[];
};

export const marketQueryKeys = {
  categories: ['market', 'categories'] as const,
  list: (params: Record<string, unknown>) => ['market', 'list', params] as const,
  listing: (id: string) => ['market', 'listing', id] as const,
  seller: (userId: string) => ['market', 'seller', userId] as const,
  sellerListings: (userId: string) => ['market', 'seller-listings', userId] as const,
  orders: (role: 'buyer' | 'seller') => ['market', 'orders', role] as const,
};

export const CONDITION_LABELS: Record<Condition, string> = {
  new: 'Sıfır',
  like_new: 'Sıfır gibi',
  good: 'İyi',
  fair: 'Kullanılmış',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  requested: 'Talep gönderildi',
  confirmed: 'Onaylandı',
  shipped: 'Kargoda',
  delivered: 'Teslim edildi',
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
  rejected: 'Reddedildi',
};

export function formatPrice(cents: number, currency = 'TRY') {
  const amount = cents / 100;
  const formatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency === 'TRY' ? `${formatted} ₺` : `${formatted} ${currency}`;
}

export async function fetchCategories(): Promise<Result<MarketCategory[]>> {
  const { data, error } = await supabase.rpc('market_categories');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: MarketCategory[] } | null)?.items ?? []) as MarketCategory[]);
}

export async function fetchListings(params: {
  query?: string | null;
  category?: string | null;
  city?: string | null;
  sort?: MarketSort;
  favorites?: boolean;
  mine?: boolean;
  limit?: number;
  offset?: number;
}): Promise<Result<Listing[]>> {
  const { data, error } = await supabase.rpc('market_list', {
    p_query: params.query ?? null,
    p_category: params.category ?? null,
    p_city: params.city ?? null,
    p_sort: params.sort ?? 'new',
    p_favorites: params.favorites ?? false,
    p_mine: params.mine ?? false,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: Listing[] } | null)?.items ?? []) as Listing[]);
}

export async function fetchListing(id: string): Promise<Result<ListingDetail>> {
  const { data, error } = await supabase.rpc('market_get', { p_listing_id: id });
  if (error) {
    return fail(rpcError(error));
  }
  if (!data) {
    return fail(appError('not_found', 'İlan bulunamadı.'));
  }
  return ok(data as ListingDetail);
}

export async function createListing(input: ListingInput): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('market_create_listing', {
    p_payload: {
      title: input.title,
      description: input.description,
      price_cents: input.price_cents,
      condition: input.condition,
      stock: input.stock,
      category_id: input.category_id,
      city: input.city,
      district: input.district,
      images: input.images.map((storage_path) => ({ storage_path })),
    },
  });

  if (error) {
    return fail(rpcError(error));
  }

  const id = (data as { id?: string } | null)?.id;
  return id ? ok(id) : fail(appError('unknown'));
}

export async function updateListing(id: string, input: Partial<ListingInput>): Promise<Result<Listing>> {
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload.title = input.title;
  if (input.description !== undefined) payload.description = input.description;
  if (input.price_cents !== undefined) payload.price_cents = input.price_cents;
  if (input.condition !== undefined) payload.condition = input.condition;
  if (input.stock !== undefined) payload.stock = input.stock;
  if (input.category_id !== undefined) payload.category_id = input.category_id;
  if (input.city !== undefined) payload.city = input.city;
  if (input.district !== undefined) payload.district = input.district;
  if (input.images !== undefined) {
    payload.images = input.images.map((storage_path) => ({ storage_path }));
  }

  const { data, error } = await supabase.rpc('market_update_listing', {
    p_listing_id: id,
    p_payload: payload,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as Listing);
}

export async function setListingStatus(
  id: string,
  status: 'active' | 'archived' | 'sold',
): Promise<Result<null>> {
  const { error } = await supabase.rpc('market_set_status', {
    p_listing_id: id,
    p_status: status,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function deleteListing(id: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('market_delete_listing', { p_listing_id: id });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function toggleFavorite(
  id: string,
): Promise<Result<{ favorite: boolean; favorite_count: number }>> {
  const { data, error } = await supabase.rpc('market_toggle_favorite', { p_listing_id: id });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as { favorite: boolean; favorite_count: number });
}

export async function fetchSeller(userId: string): Promise<Result<SellerProfile>> {
  const { data, error } = await supabase.rpc('market_seller', { p_user_id: userId });
  if (error) {
    return fail(rpcError(error));
  }
  if (!data) {
    return fail(appError('not_found', 'Satıcı bulunamadı.'));
  }
  return ok(data as SellerProfile);
}

export async function fetchSellerListings(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<Result<Listing[]>> {
  const { data, error } = await supabase.rpc('market_seller_listings', {
    p_user_id: userId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: Listing[] } | null)?.items ?? []) as Listing[]);
}

export async function createOrder(input: {
  items: { listing_id: string; quantity: number }[];
  contact: {
    contact_name?: string | null;
    contact_phone?: string | null;
    shipping_city?: string | null;
    shipping_address?: string | null;
    note?: string | null;
  };
}): Promise<Result<{ id: string; order_no: string; total_cents: number }>> {
  const { data, error } = await supabase.rpc('market_create_order', {
    p_items: input.items,
    p_contact: input.contact,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as { id: string; order_no: string; total_cents: number });
}

export async function fetchOrders(role: 'buyer' | 'seller'): Promise<Result<MarketOrder[]>> {
  const { data, error } = await supabase.rpc('market_orders', { p_role: role });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: MarketOrder[] } | null)?.items ?? []) as MarketOrder[]);
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<Result<{ status: OrderStatus }>> {
  const { data, error } = await supabase.rpc('market_update_order_status', {
    p_order_id: orderId,
    p_status: status,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as { status: OrderStatus });
}

export async function submitReview(input: {
  orderId: string;
  rating: number;
  comment: string | null;
}): Promise<Result<null>> {
  const { error } = await supabase.rpc('market_submit_review', {
    p_order_id: input.orderId,
    p_rating: input.rating,
    p_comment: input.comment,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

// -----------------------------------------------------------------------------
// Fiş / fatura ve satış özeti
// -----------------------------------------------------------------------------

export type OrderReceiptParty = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
};

export type OrderReceipt = {
  id: string;
  order_no: string;
  status: OrderStatus;
  subtotal_cents: number;
  total_cents: number;
  currency: string;
  payment_status: string;
  payment_method: string;
  created_at: string;
  contact_name: string | null;
  contact_phone: string | null;
  shipping_city: string | null;
  shipping_address: string | null;
  note: string | null;
  buyer: OrderReceiptParty;
  seller: OrderReceiptParty;
  items: {
    id: string;
    listing_id: string | null;
    title: string;
    unit_price_cents: number;
    quantity: number;
  }[];
};

export type SalesSummary = {
  order_count: number;
  completed_count: number;
  open_count: number;
  gross_cents: number;
  completed_cents: number;
  month_cents: number;
};

export async function fetchOrderReceipt(orderId: string): Promise<Result<OrderReceipt>> {
  const { data, error } = await supabase.rpc('market_order_receipt', { p_order_id: orderId });
  if (error) {
    return fail(rpcError(error));
  }
  if (!data) {
    return fail(appError('not_found', 'Sipariş bulunamadı.'));
  }
  return ok(data as OrderReceipt);
}

export async function fetchSalesSummary(scope: 'mine' | 'all' = 'mine'): Promise<Result<SalesSummary>> {
  const { data, error } = await supabase.rpc('market_sales_summary', { p_scope: scope });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(
    (data as SalesSummary | null) ?? {
      order_count: 0,
      completed_count: 0,
      open_count: 0,
      gross_cents: 0,
      completed_cents: 0,
      month_cents: 0,
    },
  );
}
