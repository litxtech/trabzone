import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Result } from '@/utils/result';

import * as api from '../services/explore-service';
import type {
  AreaSearchResult,
  ExploreBootstrap,
  ExploreLibrary,
  ExploreMarker,
  ExploreSearchItem,
  MarkerResponse,
  MyListing,
  PlaceDetail,
  PlaceReviewReply,
  PlaceSuggestionInput,
  RealEstateDetail,
  RealEstateListing,
  RealEstateMarker,
  RealEstateSavedSearch,
  ReviewPage,
  SavedArea,
} from '../types';

async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
}

function bboxKey(input: { west: number; east: number; south: number; north: number }) {
  return [input.west, input.east, input.south, input.north].map((value) => value.toFixed(3)).join(':');
}

export function useExploreBootstrap() {
  return useQuery<ExploreBootstrap>({
    queryKey: api.exploreKeys.bootstrap,
    queryFn: () => unwrap(api.fetchExploreBootstrap()),
    staleTime: 5 * 60_000,
  });
}

export function usePlacesMap(
  bbox: { west: number; east: number; south: number; north: number } | null,
  options: { categories?: string[]; query?: string | null; enabled?: boolean } = {},
) {
  const categories = [...(options.categories ?? [])].sort().join(',');
  return useQuery<MarkerResponse<ExploreMarker>>({
    queryKey: api.exploreKeys.places(bbox ? bboxKey(bbox) : 'none', categories, options.query ?? ''),
    queryFn: () =>
      unwrap(
        api.fetchPlacesMap({
          ...(bbox as { west: number; east: number; south: number; north: number }),
          categories: options.categories,
          query: options.query,
        }),
      ),
    enabled: Boolean(bbox) && (options.enabled ?? true),
    staleTime: 20_000,
    placeholderData: (previous) => previous,
  });
}

export function useRealEstateMap(
  bbox: { west: number; east: number; south: number; north: number } | null,
  filters: Record<string, unknown> = {},
  enabled = true,
) {
  const serialized = JSON.stringify(filters);
  return useQuery<MarkerResponse<RealEstateMarker>>({
    queryKey: api.exploreKeys.listings(bbox ? bboxKey(bbox) : 'none', serialized),
    queryFn: () =>
      unwrap(
        api.fetchRealEstateMap({
          ...(bbox as { west: number; east: number; south: number; north: number }),
          ...(filters as Record<string, never>),
        }),
      ),
    enabled: Boolean(bbox) && enabled,
    staleTime: 20_000,
    placeholderData: (previous) => previous,
  });
}

export function usePlaceDetail(id: string | null | undefined) {
  return useQuery<PlaceDetail>({
    queryKey: api.exploreKeys.place(id ?? 'none'),
    queryFn: () => unwrap(api.fetchPlace(id as string)),
    enabled: Boolean(id),
  });
}

export function usePlaceReviews(id: string | null | undefined, sort: 'new' | 'highest' | 'lowest' | 'helpful') {
  return useQuery<ReviewPage>({
    queryKey: api.exploreKeys.reviews(id ?? 'none', sort),
    queryFn: () => unwrap(api.fetchPlaceReviews(id as string, sort)),
    enabled: Boolean(id),
  });
}

export function useUpsertPlaceReview(placeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { rating: number; body?: string | null; media?: { kind: 'image' | 'video'; storage_path: string }[] }) =>
      unwrap(api.upsertPlaceReview({ placeId, ...input })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.place(placeId) });
      void client.invalidateQueries({ queryKey: ['explore', 'reviews', placeId] });
    },
  });
}

export function useDeletePlaceReview(placeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => unwrap(api.deletePlaceReview(reviewId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.place(placeId) });
      void client.invalidateQueries({ queryKey: ['explore', 'reviews', placeId] });
    },
  });
}

export function usePlaceReviewReplies(placeId: string | null | undefined, enabled = true) {
  return useQuery<Record<string, PlaceReviewReply>>({
    queryKey: ['explore', 'review-replies', placeId ?? 'none'],
    queryFn: async () => {
      const result = await unwrap(api.fetchPlaceReviewReplies(placeId as string));
      return Object.fromEntries(result.items.map((item) => [item.review_id, item]));
    },
    enabled: Boolean(placeId) && enabled,
    staleTime: 30_000,
  });
}

export function useUpsertPlaceReviewReply(placeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { reviewId: string; body: string }) =>
      unwrap(api.upsertPlaceReviewReply(input.reviewId, input.body)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['explore', 'review-replies', placeId] });
    },
  });
}

export function usePlaceOwnerContact(placeId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['explore', 'owner-contact', placeId ?? 'none'],
    queryFn: () => unwrap(api.fetchPlaceOwnerContact(placeId as string)),
    enabled: Boolean(placeId) && enabled,
    staleTime: 5 * 60_000,
  });
}

export function useHelpfulReview(placeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => unwrap(api.markReviewHelpful(reviewId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['explore', 'reviews', placeId] });
    },
  });
}

export function useAddPlaceMedia(placeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: 'image' | 'video';
      storagePath: string;
      caption?: string | null;
      width?: number | null;
      height?: number | null;
      durationMs?: number | null;
    }) => unwrap(api.addPlaceMedia({ placeId, ...input })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.place(placeId) });
    },
  });
}

export function useDeletePlaceMedia(placeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: string) => unwrap(api.deletePlaceMedia(mediaId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.place(placeId) });
    },
  });
}

export function useTogglePlaceFavorite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (placeId: string) => unwrap(api.togglePlaceFavorite(placeId)),
    onSuccess: (_data, placeId) => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.place(placeId) });
      void client.invalidateQueries({ queryKey: api.exploreKeys.library });
    },
  });
}

export function useToggleListingFavorite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) => unwrap(api.toggleListingFavorite(listingId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['explore', 'listing'] });
      void client.invalidateQueries({ queryKey: ['explore', 're-list'] });
      void client.invalidateQueries({ queryKey: api.exploreKeys.library });
    },
  });
}

export function useExploreSearch(query: string) {
  return useQuery<{ items: ExploreSearchItem[] }>({
    queryKey: api.exploreKeys.search(query),
    queryFn: () => unwrap(api.fetchExploreSearch(query)),
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });
}

export function useAreaSearch() {
  return useMutation<AreaSearchResult, Error, Parameters<typeof api.runAreaSearch>[0]>({
    mutationFn: (input) => unwrap(api.runAreaSearch(input)),
  });
}

export function useSavedAreas() {
  return useQuery<SavedArea[]>({
    queryKey: api.exploreKeys.savedAreas,
    queryFn: () => unwrap(api.fetchSavedAreas()),
    staleTime: 60_000,
  });
}

export function useSaveArea() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.saveArea>[0]) => unwrap(api.saveArea(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.savedAreas });
    },
  });
}

export function useDeleteSavedArea() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.deleteSavedArea(id)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.savedAreas });
    },
  });
}

export function useExploreLibrary() {
  return useQuery<ExploreLibrary>({
    queryKey: api.exploreKeys.library,
    queryFn: () => unwrap(api.fetchExploreLibrary()),
    staleTime: 30_000,
  });
}

export function useSubmitPlaceSuggestion() {
  return useMutation({
    mutationFn: (payload: PlaceSuggestionInput) => unwrap(api.submitPlaceSuggestion(payload)),
  });
}

export function useSubmitPlaceClaim() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.submitPlaceClaim>[0]) =>
      unwrap(api.submitPlaceClaim(input)),
    onSuccess: (_data, input) => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.place(input.placeId) });
    },
  });
}

export function useUpdateManagedPlace(placeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.updateManagedPlace>[1]) =>
      unwrap(api.updateManagedPlace(placeId, payload)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.place(placeId) });
    },
  });
}

export function useReportContent() {
  return useMutation({
    mutationFn: (input: Parameters<typeof api.reportContent>[0]) => unwrap(api.reportContent(input)),
  });
}

// ---------------------------------------------------------------------------
// Emlak
// ---------------------------------------------------------------------------

export function useRealEstateList(filters: Record<string, unknown>) {
  return useQuery<{
    items: RealEstateListing[];
    total: number;
    limit: number;
    offset: number;
  }>({
    queryKey: ['explore', 're-list', JSON.stringify(filters)],
    queryFn: () => unwrap(api.fetchRealEstateList(filters)),
    placeholderData: (previous) => previous,
  });
}

export function useRealEstateDetail(id: string | null | undefined) {
  return useQuery<RealEstateDetail>({
    queryKey: api.exploreKeys.listing(id ?? 'none'),
    queryFn: () => unwrap(api.fetchRealEstate(id as string)),
    enabled: Boolean(id),
  });
}

export function useMyListings() {
  return useQuery<{ items: MyListing[]; eids_enabled: boolean }>({
    queryKey: api.exploreKeys.myListings,
    queryFn: () => unwrap(api.fetchMyListings()),
  });
}

export function useCreateRealEstateDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => unwrap(api.createRealEstateDraft(payload)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.myListings });
    },
  });
}

export function useUpdateRealEstate(listingId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => unwrap(api.updateRealEstate(listingId, payload)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.listing(listingId) });
      void client.invalidateQueries({ queryKey: api.exploreKeys.myListings });
    },
  });
}

export function useAddRealEstateMedia(listingId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.addRealEstateMedia>[0]) =>
      unwrap(api.addRealEstateMedia(input)),
    onSuccess: (_data, input) => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.listing(input.listingId || listingId) });
      void client.invalidateQueries({ queryKey: api.exploreKeys.myListings });
    },
  });
}

export function useDeleteRealEstateMedia(listingId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: string) => unwrap(api.deleteRealEstateMedia(mediaId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.listing(listingId) });
    },
  });
}

export function useSetRealEstateCover(listingId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: string) => unwrap(api.setRealEstateCover(mediaId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.listing(listingId) });
    },
  });
}

export function useSubmitRealEstateVerification(listingId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      listingId?: string;
      reference_no?: string | null;
      document_path?: string | null;
    }) => {
      const target = input.listingId ?? listingId;
      return unwrap(
        api.submitRealEstateVerification(target, {
          reference_no: input.reference_no ?? null,
          document_path: input.document_path ?? null,
        }),
      );
    },
    onSuccess: (_data, input) => {
      const target = input.listingId ?? listingId;
      void client.invalidateQueries({ queryKey: api.exploreKeys.listing(target) });
      void client.invalidateQueries({ queryKey: api.exploreKeys.myListings });
    },
  });
}

export function useRealEstateSavedSearches() {
  return useQuery<RealEstateSavedSearch[]>({
    queryKey: api.exploreKeys.reSaved,
    queryFn: () => unwrap(api.fetchRealEstateSavedSearches()),
  });
}

export function useSaveRealEstateSearch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.saveRealEstateSearch>[0]) =>
      unwrap(api.saveRealEstateSearch(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.reSaved });
    },
  });
}

export function useDeleteRealEstateSavedSearch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.deleteRealEstateSavedSearch(id)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.reSaved });
    },
  });
}

export function useSetRealEstateSearchNotify() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; notify: boolean }) =>
      unwrap(api.setRealEstateSearchNotify(input.id, input.notify)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.exploreKeys.reSaved });
    },
  });
}

// ---------------------------------------------------------------------------
// Yönetim
// ---------------------------------------------------------------------------

export function useAdminExploreOverview(enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.adminOverview,
    queryFn: () => unwrap(api.fetchAdminExploreOverview()),
    enabled,
  });
}

export function useAdminPlaces(
  filters: {
    status?: string | null;
    q?: string | null;
    districtId?: number | null;
    category?: string | null;
    verification?: string | null;
    limit?: number;
    offset?: number;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: api.exploreKeys.adminPlaces(JSON.stringify(filters)),
    queryFn: () => unwrap(api.fetchAdminPlaces(filters)),
    enabled,
  });
}

export function useAdminPlaceDetail(placeId: string | null) {
  return useQuery({
    queryKey: ['explore', 'admin', 'place', placeId ?? 'none'],
    queryFn: () => unwrap(api.fetchAdminPlace(placeId as string)),
    enabled: Boolean(placeId),
  });
}

export function useAdminRealEstateDetail(listingId: string | null) {
  return useQuery({
    queryKey: ['explore', 'admin', 'listing', listingId ?? 'none'],
    queryFn: () => unwrap(api.fetchAdminRealEstateDetail(listingId as string)),
    enabled: Boolean(listingId),
  });
}

export function useAdminPlaceCategories(enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.adminCategories,
    queryFn: () => unwrap(api.fetchAdminPlaceCategories()),
    enabled,
  });
}

export function useAdminRealEstate(filters: {
  status?: string | null;
  q?: string | null;
  districtId?: number | null;
  listingKind?: string | null;
  limit?: number;
  offset?: number;
}, enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.adminListings(JSON.stringify(filters)),
    queryFn: () => unwrap(api.fetchAdminRealEstate(filters)),
    enabled,
  });
}

export function useAdminVerifications(status = 'pending', enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.adminVerifications(status),
    queryFn: () => unwrap(api.fetchAdminVerifications(status)),
    enabled,
  });
}

export function useAdminSuggestions(status = 'pending', enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.adminSuggestions(status),
    queryFn: () => unwrap(api.fetchAdminSuggestions(status)),
    enabled,
  });
}

export function useAdminClaims(status = 'pending', enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.adminClaims(status),
    queryFn: () => unwrap(api.fetchAdminClaims(status)),
    enabled,
  });
}

export function useAdminPlaceMedia(status = 'pending', enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.adminPlaceMedia(status),
    queryFn: () => unwrap(api.fetchAdminPlaceMedia(status)),
    enabled,
  });
}

export function useAdminPlaceReviews(status: string | null = null, enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.adminPlaceReviews(String(status)),
    queryFn: () => unwrap(api.fetchAdminPlaceReviews(status)),
    enabled,
  });
}

export function useAdminRealEstateMedia(status = 'pending', enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.adminReMedia(status),
    queryFn: () => unwrap(api.fetchAdminRealEstateMedia(status)),
    enabled,
  });
}

export function useAdminReports(status = 'pending', enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.adminReports(status),
    queryFn: () => unwrap(api.fetchAdminReports(status)),
    enabled,
  });
}

export function useExploreHealth(enabled = true) {
  return useQuery({
    queryKey: api.exploreKeys.health,
    queryFn: () => unwrap(api.fetchExploreHealth()),
    enabled,
  });
}

export function useAdminExploreMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<Result<unknown>>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (variables: TVariables) => unwrap(mutationFn(variables)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['explore', 'admin'] });
      void client.invalidateQueries({ queryKey: api.exploreKeys.adminOverview });
    },
  });
}
