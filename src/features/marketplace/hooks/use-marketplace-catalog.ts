import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import {
  clearSearchHistory,
  createListingV2,
  deleteListingV2,
  deleteSavedSearch,
  fetchCategoryTree,
  fetchListingDetail,
  fetchMarketCatalog,
  fetchMarketHome,
  fetchMyListings,
  fetchPlaces,
  fetchSavedSearches,
  fetchSearchHistory,
  fetchSellerListings,
  fetchSearchHub,
  marketCatalogKeys,
  messageSellerAboutListing,
  saveSearch,
  saveSearchHistory,
  searchCategories,
  setListingStatusV2,
  toggleFavoriteV2,
  updateListingV2,
  type ListingStatus,
  type ListingV2Input,
  type MarketCatalogParams,
  type MarketListing,
  type MarketListingDetail,
  type MarketListingPage,
  type MyListingsScope,
} from '../services/marketplace-catalog-service';

export function useMarketHome() {
  return useQuery({
    queryKey: marketCatalogKeys.home(),
    queryFn: () => unwrap(fetchMarketHome()),
    staleTime: 30_000,
  });
}

export function useMarketCategories() {
  return useQuery({
    queryKey: marketCatalogKeys.categories(),
    queryFn: () => unwrap(fetchCategoryTree()),
    staleTime: 10 * 60_000,
  });
}

export function useCategorySearch(term: string) {
  const trimmed = term.trim();
  return useQuery({
    queryKey: marketCatalogKeys.categorySearch(trimmed),
    queryFn: () => unwrap(searchCategories(trimmed, 24)),
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60_000,
  });
}

export function useMarketSearchHub(term: string, kind: string | null = null) {
  const trimmed = term.trim();
  return useQuery({
    queryKey: [...marketCatalogKeys.searchHub(trimmed), kind] as const,
    queryFn: () => unwrap(fetchSearchHub(trimmed, 12, kind)),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}

export function useSellerListings(sellerId: string | null) {
  return useQuery({
    queryKey: marketCatalogKeys.sellerListings(sellerId),
    queryFn: () => unwrap(fetchSellerListings(sellerId as string, 12)),
    enabled: Boolean(sellerId),
    staleTime: 30_000,
  });
}

export function useMessageSellerAboutListing() {
  return useMutation({
    mutationFn: (input: {
      listingId: string;
      sellerId: string;
      title: string;
      priceCents: number;
      currency: string;
      coverPath: string | null;
      body?: string;
    }) => unwrap(messageSellerAboutListing(input)),
  });
}

export function useSearchHistory(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: marketCatalogKeys.searchHistory(),
    queryFn: () => unwrap(fetchSearchHistory()),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}

export function useSaveSearchHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { query: string; kind?: string | null; resultCount?: number }) =>
      unwrap(saveSearchHistory(input.query, input.kind, input.resultCount)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketCatalogKeys.searchHistory() });
    },
  });
}

export function useClearSearchHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(clearSearchHistory()),
    onSuccess: () => {
      queryClient.setQueryData(marketCatalogKeys.searchHistory(), []);
    },
  });
}

export function useMarketCatalog(params: MarketCatalogParams, options: { enabled?: boolean } = {}) {
  const query = useInfiniteQuery({
    queryKey: marketCatalogKeys.catalog(params as Record<string, unknown>),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      unwrap(fetchMarketCatalog({ ...params, offset: pageParam, limit: params.limit ?? 20 })),
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.offset + lastPage.items.length : undefined,
    staleTime: 20_000,
    enabled: options.enabled ?? true,
  });

  const items: MarketListing[] = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;

  return {
    ...query,
    items,
    total,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
  };
}

export function useMarketListing(id: string | null) {
  return useQuery({
    queryKey: marketCatalogKeys.listing(id),
    queryFn: () => unwrap(fetchListingDetail(id as string)),
    enabled: Boolean(id),
    staleTime: 20_000,
  });
}

export function useMyListings(scope: MyListingsScope) {
  const query = useInfiniteQuery({
    queryKey: marketCatalogKeys.myListings(scope),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => unwrap(fetchMyListings(scope, 20, pageParam)),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.has_more
        ? allPages.reduce((total, page) => total + page.items.length, 0)
        : undefined,
    staleTime: 15_000,
  });

  // Sayfa ofsetini biriken öğe sayısından hesapla.
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const counts = query.data?.pages[0]?.counts;

  return {
    ...query,
    items,
    counts,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
  };
}

export function useSavedSearches() {
  return useQuery({
    queryKey: marketCatalogKeys.savedSearches(),
    queryFn: () => unwrap(fetchSavedSearches()),
    staleTime: 30_000,
  });
}

export function usePlaces(
  params: {
    query?: string | null;
    category?: string | null;
    districtId?: number | null;
    sort?: string;
    limit?: number;
  },
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: marketCatalogKeys.places(params as Record<string, unknown>),
    queryFn: () => unwrap(fetchPlaces(params)),
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  });
}

function patchFavoriteInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  listingId: string,
  favorite: boolean,
) {
  queryClient.setQueriesData<{ pages: MarketListingPage[]; pageParams: unknown[] }>(
    { queryKey: [...marketCatalogKeys.all, 'catalog'] },
    (data) => {
      if (!data?.pages) {
        return data;
      }
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((item) =>
            item.id === listingId ? { ...item, is_favorite: favorite } : item,
          ),
        })),
      };
    },
  );
  queryClient.setQueryData<MarketListingDetail>(marketCatalogKeys.listing(listingId), (data) =>
    data ? { ...data, listing: { ...data.listing, is_favorite: favorite } } : data,
  );
}

export function useToggleFavoriteV2() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (listingId: string) => unwrap(toggleFavoriteV2(listingId)),
    onMutate: async (listingId) => {
      const detail = queryClient.getQueryData<MarketListingDetail>(
        marketCatalogKeys.listing(listingId),
      );
      const previous = detail?.listing.is_favorite ?? false;
      patchFavoriteInCache(queryClient, listingId, !previous);
      return { previous };
    },
    onError: (_error, listingId, context) => {
      if (context) {
        patchFavoriteInCache(queryClient, listingId, context.previous);
      }
    },
    onSuccess: (result, listingId) => {
      patchFavoriteInCache(queryClient, listingId, result.favorite);
      void queryClient.invalidateQueries({ queryKey: marketCatalogKeys.home() });
    },
  });
}

export function useCreateListingV2() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ListingV2Input) => unwrap(createListingV2(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketCatalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

export function useUpdateListingV2(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<ListingV2Input>) => unwrap(updateListingV2(id, input)),
    onSuccess: (listing) => {
      queryClient.setQueryData<MarketListingDetail>(marketCatalogKeys.listing(id), (data) =>
        data ? { ...data, listing } : data,
      );
      void queryClient.invalidateQueries({ queryKey: marketCatalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

export function useSetListingStatusV2() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; status: ListingStatus; reason?: string | null }) =>
      unwrap(setListingStatusV2(input.id, input.status, input.reason)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketCatalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

export function useDeleteListingV2() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => unwrap(deleteListingV2(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketCatalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
    },
  });
}

export function useSaveSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof saveSearch>[0]) => unwrap(saveSearch(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketCatalogKeys.savedSearches() });
    },
  });
}

export function useDeleteSavedSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => unwrap(deleteSavedSearch(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketCatalogKeys.savedSearches() });
    },
  });
}
