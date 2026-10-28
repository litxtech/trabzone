import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createListing,
  createOrder,
  deleteListing,
  fetchCategories,
  fetchListing,
  fetchListings,
  fetchOrders,
  fetchSeller,
  fetchSellerListings,
  marketQueryKeys,
  setListingStatus,
  submitReview,
  toggleFavorite,
  updateListing,
  updateOrderStatus,
  type ListingInput,
  type Listing,
  type ListingDetail,
  type MarketSort,
  type OrderStatus,
} from '../services/marketplace-service';
import { unwrap } from '@/utils/result';

export type ListingFilters = {
  query?: string;
  category?: string | null;
  city?: string | null;
  sort?: MarketSort;
  favorites?: boolean;
  mine?: boolean;
};

export function useMarketCategories() {
  return useQuery({
    queryKey: marketQueryKeys.categories,
    queryFn: () => unwrap(fetchCategories()),
    staleTime: 5 * 60_000,
  });
}

export function useListings(filters: ListingFilters) {
  return useQuery({
    queryKey: marketQueryKeys.list(filters as Record<string, unknown>),
    queryFn: () =>
      unwrap(
        fetchListings({
          query: filters.query ?? null,
          category: filters.category ?? null,
          city: filters.city ?? null,
          sort: filters.sort ?? 'new',
          favorites: filters.favorites ?? false,
          mine: filters.mine ?? false,
          limit: 30,
        }),
      ),
    staleTime: 20_000,
  });
}

export function useListing(id: string | null) {
  return useQuery({
    queryKey: marketQueryKeys.listing(id ?? 'none'),
    queryFn: () => unwrap(fetchListing(id as string)),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useSeller(userId: string | null) {
  return useQuery({
    queryKey: marketQueryKeys.seller(userId ?? 'none'),
    queryFn: () => unwrap(fetchSeller(userId as string)),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
}

export function useSellerListings(userId: string | null) {
  return useQuery({
    queryKey: marketQueryKeys.sellerListings(userId ?? 'none'),
    queryFn: () => unwrap(fetchSellerListings(userId as string)),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });
}

export function useBuyerOrders() {
  return useQuery({
    queryKey: marketQueryKeys.orders('buyer'),
    queryFn: () => unwrap(fetchOrders('buyer')),
    staleTime: 20_000,
  });
}

export function useSellerOrders() {
  return useQuery({
    queryKey: marketQueryKeys.orders('seller'),
    queryFn: () => unwrap(fetchOrders('seller')),
    staleTime: 20_000,
  });
}

export function useCreateListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ListingInput) => unwrap(createListing(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

export function useUpdateListing(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<ListingInput>) => unwrap(updateListing(id, input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

export function useSetListingStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; status: 'active' | 'archived' | 'sold' }) =>
      unwrap(setListingStatus(input.id, input.status)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

export function useDeleteListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => unwrap(deleteListing(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => unwrap(toggleFavorite(id)),
    onSuccess: (result, id) => {
      queryClient.setQueriesData<Listing[]>({ queryKey: ['market', 'list'] }, (data) =>
        data?.map((listing) =>
          listing.id === id ? { ...listing, is_favorite: result.favorite } : listing,
        ),
      );
      queryClient.setQueryData<ListingDetail>(marketQueryKeys.listing(id), (data) =>
        data ? { ...data, is_favorite: result.favorite } : data,
      );
      void queryClient.invalidateQueries({ queryKey: ['market', 'list'] });
    },
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof createOrder>[0]) => unwrap(createOrder(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketQueryKeys.orders('buyer') });
      void queryClient.invalidateQueries({ queryKey: ['market', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['market', 'listing'] });
    },
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { orderId: string; status: OrderStatus }) =>
      unwrap(updateOrderStatus(input.orderId, input.status)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market', 'orders'] });
    },
  });
}

export function useSubmitReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { orderId: string; rating: number; comment: string | null }) =>
      unwrap(submitReview(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market', 'orders'] });
      void queryClient.invalidateQueries({ queryKey: ['market', 'seller'] });
    },
  });
}
