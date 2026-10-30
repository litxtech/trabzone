import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  AdminClaimRow,
  AdminExploreOverview,
  AdminMediaRow,
  AdminPlaceCategory,
  AdminPlaceDetail,
  AdminPlaceList,
  AdminRealEstateDetail,
  AdminReList,
  AdminReportRow,
  AdminReviewRow,
  AdminSuggestionRow,
  AdminVerificationRow,
  AreaSearchResult,
  ExploreBootstrap,
  ExploreHealth,
  ExploreLibrary,
  ExploreMarker,
  ExploreSearchItem,
  MarkerResponse,
  PlaceDetail,
  PlaceReviewReply,
  PlaceSuggestionInput,
  RealEstateMarker,
  ReviewPage,
  SavedArea,
} from '../types';

async function call<T>(name: string, params?: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(name, params ?? {});
  if (error) {
    return fail(rpcError(error));
  }
  if (data == null) {
    return fail(appError('not_found'));
  }
  return ok(data as T);
}

export const exploreKeys = {
  bootstrap: ['explore', 'bootstrap'] as const,
  places: (bbox: string, categories: string, query: string) =>
    ['explore', 'places', bbox, categories, query] as const,
  listings: (bbox: string, filters: string) => ['explore', 'listings', bbox, filters] as const,
  place: (id: string) => ['explore', 'place', id] as const,
  reviews: (id: string, sort: string) => ['explore', 'reviews', id, sort] as const,
  search: (query: string) => ['explore', 'search', query] as const,
  savedAreas: ['explore', 'saved-areas'] as const,
  library: ['explore', 'library'] as const,
  myListings: ['explore', 'my-listings'] as const,
  listing: (id: string) => ['explore', 'listing', id] as const,
  reSaved: ['explore', 're-saved'] as const,
  adminOverview: ['explore', 'admin', 'overview'] as const,
  adminPlaces: (filters: string) => ['explore', 'admin', 'places', filters] as const,
  adminListings: (filters: string) => ['explore', 'admin', 'listings', filters] as const,
  adminVerifications: (status: string) => ['explore', 'admin', 'verifications', status] as const,
  adminCategories: ['explore', 'admin', 'categories'] as const,
  adminSuggestions: (status: string) => ['explore', 'admin', 'suggestions', status] as const,
  adminClaims: (status: string) => ['explore', 'admin', 'claims', status] as const,
  adminPlaceMedia: (status: string) => ['explore', 'admin', 'place-media', status] as const,
  adminPlaceReviews: (status: string) => ['explore', 'admin', 'place-reviews', status] as const,
  adminReMedia: (status: string) => ['explore', 'admin', 're-media', status] as const,
  adminReports: (status: string) => ['explore', 'admin', 'reports', status] as const,
  health: ['explore', 'admin', 'health'] as const,
};

// ---------------------------------------------------------------------------
// Keşif çekirdeği
// ---------------------------------------------------------------------------

export function fetchExploreBootstrap() {
  return call<ExploreBootstrap>('explore_bootstrap');
}

export function fetchPlacesMap(input: {
  west: number;
  east: number;
  south: number;
  north: number;
  categories?: string[];
  query?: string | null;
  limit?: number;
}) {
  return call<MarkerResponse<ExploreMarker>>('places_map', {
    p_west: input.west,
    p_east: input.east,
    p_south: input.south,
    p_north: input.north,
    p_categories: input.categories?.length ? input.categories : null,
    p_query: input.query?.trim() || null,
    p_limit: input.limit ?? 250,
  });
}

export function fetchRealEstateMap(input: {
  west: number;
  east: number;
  south: number;
  north: number;
  listing_kind?: string | null;
  categories?: string[];
  min_price?: number | null;
  max_price?: number | null;
  min_m2?: number | null;
  max_m2?: number | null;
  rooms?: number | null;
  limit?: number;
}) {
  return call<MarkerResponse<RealEstateMarker>>('re_map', {
    p_west: input.west,
    p_east: input.east,
    p_south: input.south,
    p_north: input.north,
    p_listing_kind: input.listing_kind || null,
    p_categories: input.categories?.length ? input.categories : null,
    p_min_price: input.min_price ?? null,
    p_max_price: input.max_price ?? null,
    p_min_m2: input.min_m2 ?? null,
    p_max_m2: input.max_m2 ?? null,
    p_rooms: input.rooms ?? null,
    p_limit: input.limit ?? 250,
  });
}

export function fetchPlace(placeId: string) {
  return call<PlaceDetail>('place_get', { p_place_id: placeId });
}

export function fetchPlaceReviews(placeId: string, sort: 'new' | 'highest' | 'lowest' | 'helpful', offset = 0) {
  return call<ReviewPage>('place_reviews_list', {
    p_place_id: placeId,
    p_sort: sort,
    p_limit: 20,
    p_offset: offset,
  });
}

export function upsertPlaceReview(input: {
  placeId: string;
  rating: number;
  body?: string | null;
  media?: { kind: 'image' | 'video'; storage_path: string }[];
}) {
  return call<{ id: string; media_pending: number }>('place_review_upsert', {
    p_place_id: input.placeId,
    p_rating: input.rating,
    p_body: input.body?.trim() || null,
    p_media: input.media ?? [],
  });
}

export function deletePlaceReview(reviewId: string) {
  return call<{ ok: boolean }>('place_review_delete', { p_review_id: reviewId });
}

export function markReviewHelpful(reviewId: string) {
  return call<{ helpful: boolean; helpful_count: number }>('place_review_helpful', {
    p_review_id: reviewId,
  });
}

export function fetchPlaceReviewReplies(placeId: string) {
  return call<{ items: PlaceReviewReply[] }>('place_review_replies_list', { p_place_id: placeId });
}

export function upsertPlaceReviewReply(reviewId: string, body: string) {
  return call<{ id: string; body: string }>('place_review_reply_upsert', {
    p_review_id: reviewId,
    p_body: body.trim(),
  });
}

export function fetchPlaceOwnerContact(placeId: string) {
  return call<{ id: string; username: string; display_name: string | null } | null>(
    'place_owner_contact',
    { p_place_id: placeId },
  );
}

export function addPlaceMedia(input: {
  placeId: string;
  kind: 'image' | 'video';
  storagePath: string;
  thumbPath?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}) {
  return call<{ id: string; status: string }>('place_media_add', {
    p_place_id: input.placeId,
    p_kind: input.kind,
    p_storage_path: input.storagePath,
    p_thumb_path: input.thumbPath ?? null,
    p_caption: input.caption?.trim() || null,
    p_width: input.width ?? null,
    p_height: input.height ?? null,
    p_duration_ms: input.durationMs ?? null,
  });
}

export function deletePlaceMedia(mediaId: string) {
  return call<{ ok: boolean }>('place_media_delete', { p_media_id: mediaId });
}

export function togglePlaceFavorite(placeId: string) {
  return call<{ favorite: boolean; favorite_count: number }>('place_favorite_toggle', {
    p_place_id: placeId,
  });
}

export function toggleListingFavorite(listingId: string) {
  return call<{ favorite: boolean; favorite_count: number }>('re_favorite_toggle', {
    p_listing_id: listingId,
  });
}

export function fetchExploreSearch(query: string, limit = 24) {
  return call<{ items: ExploreSearchItem[] }>('explore_search', {
    p_query: query.trim(),
    p_limit: limit,
  });
}

/**
 * Harita sağlayıcısından seçilen işletmeyi gerçek bir `places` kaydına çevirir.
 *
 * Sunucu önce aynı işletmenin kayıtlı olup olmadığını kontrol eder (dış kimlik
 * ya da 150 m içinde benzer ad); varsa onu döner. Böylece gönderi etiketi,
 * harita işaretçisi ve işletme sayfası hep aynı kaydı kullanır.
 */
export function importExternalPlace(input: {
  name: string;
  lat: number;
  lng: number;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  provider: string;
  externalId?: string | null;
  categorySlug?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
}) {
  return call<{
    place_id: string;
    created: boolean;
    name: string;
    category: string | null;
    address: string | null;
    lat: number;
    lng: number;
  }>('place_import_external', {
    p_payload: {
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      address: input.address ?? null,
      phone: input.phone ?? null,
      website: input.website ?? null,
      provider: input.provider,
      external_id: input.externalId ?? null,
      category_slug: input.categorySlug ?? null,
      rating: input.rating ?? null,
      rating_count: input.ratingCount ?? null,
    },
  });
}

export function runAreaSearch(input: {
  polygon: { type: 'Polygon'; coordinates: number[][][] };
  categories?: string[];
  kinds?: ('place' | 'real_estate')[];
  query?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  min_m2?: number | null;
  max_m2?: number | null;
  rooms?: number | null;
  listing_kind?: string | null;
  limit?: number;
}) {
  return call<AreaSearchResult>('map_area_search', {
    p_polygon: input.polygon,
    p_categories: input.categories?.length ? input.categories : null,
    p_kinds: input.kinds ?? ['place', 'real_estate'],
    p_query: input.query?.trim() || null,
    p_min_price: input.min_price ?? null,
    p_max_price: input.max_price ?? null,
    p_min_m2: input.min_m2 ?? null,
    p_max_m2: input.max_m2 ?? null,
    p_rooms: input.rooms ?? null,
    p_listing_kind: input.listing_kind || null,
    p_limit: input.limit ?? 200,
  });
}

export function saveArea(input: {
  label: string;
  polygon: { type: 'Polygon'; coordinates: number[][][] };
  filters?: Record<string, unknown>;
  notify?: boolean;
  areaKind?: 'map' | 'real_estate';
}) {
  return call<{ id: string; label: string; notify_enabled: boolean }>('saved_area_save', {
    p_label: input.label,
    p_polygon: input.polygon,
    p_filters: input.filters ?? {},
    p_notify: input.notify ?? false,
    p_area_kind: input.areaKind ?? 'map',
  });
}

export function fetchSavedAreas() {
  return call<SavedArea[]>('saved_areas_list');
}

export function deleteSavedArea(id: string) {
  return call<{ ok: boolean }>('saved_area_delete', { p_id: id });
}

export function fetchExploreLibrary() {
  return call<ExploreLibrary>('explore_library');
}

// ---------------------------------------------------------------------------
// İşletme katılımı
// ---------------------------------------------------------------------------

export function submitPlaceSuggestion(payload: PlaceSuggestionInput) {
  return call<{
    id: string;
    status: 'pending' | 'duplicate';
    duplicate_of: string | null;
    duplicate_name: string | null;
  }>('place_suggest_submit', { p_payload: payload });
}

export function submitPlaceClaim(input: {
  placeId: string;
  evidenceType: 'document' | 'tax_record' | 'utility' | 'other';
  evidenceText: string;
  documentPath?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}) {
  return call<{ id: string; status: string }>('place_claim_submit', {
    p_place_id: input.placeId,
    p_evidence_type: input.evidenceType,
    p_evidence_text: input.evidenceText,
    p_document_path: input.documentPath ?? null,
    p_contact_phone: input.contactPhone ?? null,
    p_contact_email: input.contactEmail ?? null,
  });
}

export function fetchPlaceClaimStatus(placeId: string) {
  return call<{
    id: string;
    status: string;
    evidence_type: string;
    review_note: string | null;
    created_at: string;
    reviewed_at: string | null;
  } | null>('place_claim_status', { p_place_id: placeId });
}

export function updateManagedPlace(
  placeId: string,
  payload: {
    description?: string | null;
    phone?: string | null;
    website?: string | null;
    opening_hours?: Record<string, unknown> | null;
    cover_path?: string | null;
  },
) {
  return call<{ ok: boolean }>('place_business_update', { p_place_id: placeId, p_payload: payload });
}

export function linkPlaceContent(placeId: string, input: { reelId?: string | null; postId?: string | null }) {
  return call<{ ok: boolean }>('place_link_content', {
    p_place_id: placeId,
    p_reel_id: input.reelId ?? null,
    p_post_id: input.postId ?? null,
  });
}

export function reportContent(input: {
  targetType:
    | 'place'
    | 'place_review'
    | 'place_media'
    | 'real_estate_listing'
    | 'real_estate_media';
  targetId: string;
  reason: string;
  details?: string | null;
}) {
  return call<{ id: string; status: string }>('content_report_create', {
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_reason: input.reason,
    p_details: input.details ?? null,
  });
}

// ---------------------------------------------------------------------------
// Emlak
// ---------------------------------------------------------------------------

export function fetchRealEstateList(input: Record<string, unknown>) {
  return call<{
    items: import('../types').RealEstateListing[];
    total: number;
    limit: number;
    offset: number;
  }>('re_list', input);
}

export function fetchRealEstate(id: string) {
  return call<import('../types').RealEstateDetail>('re_get', { p_listing_id: id });
}

export function createRealEstateDraft(payload: Record<string, unknown>) {
  return call<{ id: string; status: string; verification_status: string; message: string }>(
    're_create_draft',
    { p_payload: payload },
  );
}

export function updateRealEstate(listingId: string, payload: Record<string, unknown>) {
  return call<{ ok: boolean }>('re_update', { p_listing_id: listingId, p_payload: payload });
}

export function addRealEstateMedia(input: {
  listingId: string;
  kind: 'image' | 'video';
  storagePath: string;
  cover?: boolean;
  caption?: string | null;
  sortOrder?: number;
}) {
  return call<{ id: string; status: string }>('re_media_add', {
    p_listing_id: input.listingId,
    p_kind: input.kind,
    p_storage_path: input.storagePath,
    p_cover: input.cover ?? false,
    p_caption: input.caption?.trim() || null,
    p_sort_order: input.sortOrder ?? 0,
  });
}

export function deleteRealEstateMedia(mediaId: string) {
  return call<{ ok: boolean }>('re_media_delete', { p_media_id: mediaId });
}

export function setRealEstateCover(mediaId: string) {
  return call<{ ok: boolean }>('re_media_set_cover', { p_media_id: mediaId });
}

export function submitRealEstateVerification(
  listingId: string,
  verification: { reference_no?: string | null; document_path?: string | null },
) {
  return call<{ status: string; eids_enabled: boolean; message: string }>('re_submit', {
    p_listing_id: listingId,
    p_verification: verification,
  });
}

export function fetchMyListings() {
  return call<{ items: import('../types').MyListing[]; eids_enabled: boolean }>('re_my_listings');
}

export function saveRealEstateSearch(input: {
  label: string;
  filters: Record<string, unknown>;
  polygon?: { type: 'Polygon'; coordinates: number[][][] } | null;
  notify?: boolean;
}) {
  return call<{ id: string; label: string; notify_enabled: boolean }>('re_saved_search_save', {
    p_label: input.label,
    p_filters: input.filters,
    p_polygon: input.polygon ?? null,
    p_notify: input.notify ?? false,
  });
}

export function fetchRealEstateSavedSearches() {
  return call<import('../types').RealEstateSavedSearch[]>('re_saved_searches_list');
}

export function deleteRealEstateSavedSearch(id: string) {
  return call<{ ok: boolean }>('re_saved_search_delete', { p_id: id });
}

export function setRealEstateSearchNotify(id: string, notify: boolean) {
  return call<{ ok: boolean; notify_enabled: boolean }>('re_saved_search_notify', {
    p_id: id,
    p_notify: notify,
  });
}

// ---------------------------------------------------------------------------
// Yönetim
// ---------------------------------------------------------------------------

export function fetchAdminExploreOverview() {
  return call<AdminExploreOverview>('admin_explore_overview');
}

export function fetchAdminPlaces(filters: {
  status?: string | null;
  q?: string | null;
  districtId?: number | null;
  category?: string | null;
  verification?: string | null;
  limit?: number;
  offset?: number;
}) {
  return call<AdminPlaceList>('admin_places_list', {
    p_status: filters.status ?? null,
    p_q: filters.q ?? null,
    p_district_id: filters.districtId ?? null,
    p_category: filters.category ?? null,
    p_verification: filters.verification ?? null,
    p_limit: filters.limit ?? 40,
    p_offset: filters.offset ?? 0,
  });
}

export function fetchAdminPlace(placeId: string) {
  return call<AdminPlaceDetail>('admin_place_get', { p_place_id: placeId });
}

export function fetchAdminPlaceCategories() {
  return call<{ items: AdminPlaceCategory[] }>('admin_place_categories');
}

export function adminUpsertPlaceCategory(payload: Record<string, unknown>) {
  return call<{ id: string; slug: string }>('admin_place_category_upsert', { p_payload: payload });
}

export function adminUpsertPlace(payload: Record<string, unknown>) {
  return call<{ id: string; status: string }>('admin_place_upsert', { p_payload: payload });
}

export function adminSetPlaceStatus(placeId: string, status: string, reason?: string | null) {
  return call<{ ok: boolean }>('admin_place_set_status', {
    p_place_id: placeId,
    p_status: status,
    p_reason: reason ?? null,
  });
}

export function adminVerifyPlace(placeId: string, verified: boolean, reason?: string | null) {
  return call<{ ok: boolean }>('admin_place_verify', {
    p_place_id: placeId,
    p_verified: verified,
    p_reason: reason ?? null,
  });
}

export function adminMovePlace(placeId: string, lat: number, lng: number, reason?: string | null) {
  return call<{ ok: boolean }>('admin_place_move', {
    p_place_id: placeId,
    p_lat: lat,
    p_lng: lng,
    p_reason: reason ?? null,
  });
}

export function adminMergePlace(sourceId: string, targetId: string, reason?: string | null) {
  return call<{ ok: boolean }>('admin_place_merge', {
    p_source_id: sourceId,
    p_target_id: targetId,
    p_reason: reason ?? null,
  });
}

export function fetchAdminSuggestions(status = 'pending') {
  return call<{ items: AdminSuggestionRow[]; total: number }>('admin_place_suggestions_list', {
    p_status: status,
    p_limit: 50,
    p_offset: 0,
  });
}

export function adminReviewSuggestion(id: string, decision: 'approve' | 'reject' | 'duplicate', note?: string | null) {
  return call<{ ok: boolean }>('admin_place_suggestion_review', {
    p_id: id,
    p_decision: decision,
    p_note: note ?? null,
  });
}

export function fetchAdminClaims(status = 'pending') {
  return call<{ items: AdminClaimRow[]; total: number }>('admin_place_claims_list', {
    p_status: status,
    p_limit: 50,
    p_offset: 0,
  });
}

export function adminReviewClaim(claimId: string, decision: 'approve' | 'reject', note?: string | null) {
  return call<{ ok: boolean }>('admin_place_claim_review', {
    p_claim_id: claimId,
    p_decision: decision,
    p_note: note ?? null,
  });
}

export function fetchAdminPlaceMedia(status = 'pending') {
  return call<{ items: AdminMediaRow[] }>('admin_place_media_list', {
    p_status: status,
    p_place_id: null,
    p_limit: 100,
  });
}

export function adminReviewPlaceMedia(mediaId: string, decision: 'approve' | 'reject', note?: string | null) {
  return call<{ ok: boolean }>('admin_place_media_review', {
    p_media_id: mediaId,
    p_decision: decision,
    p_note: note ?? null,
  });
}

export function fetchAdminPlaceReviews(status: string | null = null) {
  return call<{ items: AdminReviewRow[] }>('admin_place_reviews_list', {
    p_status: status,
    p_place_id: null,
    p_q: null,
    p_limit: 100,
    p_offset: 0,
  });
}

export function adminModeratePlaceReview(
  reviewId: string,
  action: 'hide' | 'restore' | 'delete',
  note?: string | null,
) {
  return call<{ ok: boolean }>('admin_place_review_moderate', {
    p_review_id: reviewId,
    p_action: action,
    p_note: note ?? null,
  });
}

export function fetchAdminReports(status = 'pending') {
  return call<{ items: AdminReportRow[] }>('admin_reports_list', {
    p_status: status,
    p_target_type: null,
    p_limit: 100,
    p_offset: 0,
  });
}

export function adminReviewReport(input: {
  reportId: string;
  decision: 'resolve' | 'dismiss';
  action?: 'none' | 'remove';
  note?: string | null;
}) {
  return call<{ ok: boolean }>('admin_report_review', {
    p_report_id: input.reportId,
    p_decision: input.decision,
    p_action: input.action ?? 'none',
    p_note: input.note ?? null,
  });
}

export function fetchAdminRealEstate(filters: {
  status?: string | null;
  q?: string | null;
  districtId?: number | null;
  listingKind?: string | null;
  limit?: number;
  offset?: number;
}) {
  return call<AdminReList>('admin_re_list', {
    p_status: filters.status ?? null,
    p_q: filters.q ?? null,
    p_district_id: filters.districtId ?? null,
    p_listing_kind: filters.listingKind ?? null,
    p_limit: filters.limit ?? 40,
    p_offset: filters.offset ?? 0,
  });
}

export function fetchAdminRealEstateDetail(id: string) {
  return call<AdminRealEstateDetail>('admin_re_get', { p_listing_id: id });
}

export function fetchAdminVerifications(status = 'pending') {
  return call<{ items: AdminVerificationRow[] }>('admin_re_verifications_list', {
    p_status: status,
    p_limit: 100,
  });
}

export function adminReviewVerification(input: {
  verificationId: string;
  decision: 'approve' | 'reject';
  note?: string | null;
  expiresAt?: string | null;
}) {
  return call<{ ok: boolean }>('admin_re_verification_review', {
    p_verification_id: input.verificationId,
    p_decision: input.decision,
    p_note: input.note ?? null,
    p_expires_at: input.expiresAt ?? null,
  });
}

export function adminPublishRealEstate(listingId: string, days = 60) {
  return call<{ ok: boolean; status: string; expires_at: string }>('admin_re_publish', {
    p_listing_id: listingId,
    p_days: days,
  });
}

export function adminSetRealEstateStatus(listingId: string, status: string, reason?: string | null) {
  return call<{ ok: boolean }>('admin_re_set_status', {
    p_listing_id: listingId,
    p_status: status,
    p_reason: reason ?? null,
  });
}

export function fetchAdminRealEstateMedia(status = 'pending') {
  return call<{ items: AdminMediaRow[] }>('admin_re_media_list', {
    p_status: status,
    p_listing_id: null,
    p_limit: 100,
  });
}

export function adminReviewRealEstateMedia(mediaId: string, decision: 'approve' | 'reject', note?: string | null) {
  return call<{ ok: boolean }>('admin_re_media_review', {
    p_media_id: mediaId,
    p_decision: decision,
    p_note: note ?? null,
  });
}

export function fetchExploreHealth() {
  return call<ExploreHealth>('admin_explore_health');
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

export function polygonFromPoints(points: { lat: number; lng: number }[]): {
  type: 'Polygon';
  coordinates: number[][][];
} | null {
  if (points.length < 3) {
    return null;
  }
  const ring = points.map((point) => [point.lng, point.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) {
    return null;
  }
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0] as number, first[1] as number]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

/** GeoJSON halkasını harita işaretçileri için LatLng listesine çevirir. */
export function pointsFromGeometry(
  geometry: { coordinates?: number[][][] } | null | undefined,
): { lat: number; lng: number }[] {
  const ring = geometry?.coordinates?.[0];
  if (!ring?.length) {
    return [];
  }
  return ring
    .filter((coordinate) => coordinate.length >= 2)
    .map((coordinate) => ({ lng: coordinate[0] as number, lat: coordinate[1] as number }));
}
