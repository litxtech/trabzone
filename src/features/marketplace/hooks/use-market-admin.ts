import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import {
  deleteAdminCategory,
  fetchAdminAnalytics,
  fetchAdminCategories,
  fetchAdminCategoriesV2,
  fetchAdminListingDetailV2,
  fetchAdminListings,
  fetchAdminListingsV2,
  fetchAdminOrders,
  fetchAdminOverviewV2,
  marketAdminQueryKeys,
  moderateAdminListing,
  removeAdminListingMedia,
  saveAdminCategoryV2,
  setAdminListingStatus,
  upsertAdminCategory,
} from '../services/market-admin-service';

export function useAdminCategories() {
  return useQuery({
    queryKey: marketAdminQueryKeys.categories,
    queryFn: () => unwrap(fetchAdminCategories()),
    staleTime: 15_000,
  });
}

export function useAdminListings(params: { query: string; status: string | null }) {
  return useQuery({
    queryKey: marketAdminQueryKeys.listings(params),
    queryFn: () =>
      unwrap(
        fetchAdminListings({
          query: params.query || null,
          status: params.status,
          limit: 30,
        }),
      ),
    staleTime: 15_000,
  });
}

export function useAdminOrders(status: string | null) {
  return useQuery({
    queryKey: marketAdminQueryKeys.orders(status),
    queryFn: () => unwrap(fetchAdminOrders({ status, limit: 40 })),
    staleTime: 15_000,
  });
}

export function useUpsertAdminCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof upsertAdminCategory>[0]) => unwrap(upsertAdminCategory(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

export function useDeleteAdminCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(deleteAdminCategory(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

export function useSetAdminListingStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof setAdminListingStatus>[0]) =>
      unwrap(setAdminListingStatus(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

/* ------------------------------ v2 kancalar ------------------------------ */

export function useAdminCategoriesV2() {
  return useQuery({
    queryKey: marketAdminQueryKeys.categoriesV2,
    queryFn: () => unwrap(fetchAdminCategoriesV2()),
    staleTime: 15_000,
  });
}

export function useAdminOverviewV2() {
  return useQuery({
    queryKey: marketAdminQueryKeys.overviewV2,
    queryFn: () => unwrap(fetchAdminOverviewV2()),
    staleTime: 15_000,
  });
}

export function useAdminAnalytics(days = 14) {
  return useQuery({
    queryKey: marketAdminQueryKeys.analytics(days),
    queryFn: () => unwrap(fetchAdminAnalytics(days)),
    staleTime: 30_000,
  });
}

export function useAdminListingsV2(params: {
  query: string;
  status: string | null;
  kind: string | null;
  category: string | null;
  districtId: number | null;
}) {
  return useQuery({
    queryKey: marketAdminQueryKeys.listingsV2(params),
    queryFn: () =>
      unwrap(
        fetchAdminListingsV2({
          query: params.query || null,
          status: params.status,
          kind: params.kind,
          category: params.category,
          districtId: params.districtId,
          limit: 40,
        }),
      ),
    staleTime: 15_000,
  });
}

export function useAdminListingDetailV2(id: string | null) {
  return useQuery({
    queryKey: marketAdminQueryKeys.listingDetailV2(id ?? ''),
    queryFn: () => unwrap(fetchAdminListingDetailV2(id ?? '')),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useSaveAdminCategoryV2() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => unwrap(saveAdminCategoryV2(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

export function useModerateAdminListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof moderateAdminListing>[0]) =>
      unwrap(moderateAdminListing(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

export function useRemoveAdminListingMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { mediaId: string; reason?: string | null }) =>
      unwrap(removeAdminListingMedia(input.mediaId, input.reason ?? null)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}
