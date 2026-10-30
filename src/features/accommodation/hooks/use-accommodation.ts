import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Result } from '@/utils/result';

import * as api from '../services/accommodation-service';
import type {
  BookingMode,
  CampaignStatus,
  CashAccountKind,
  MediaCategory,
  PaymentStatus,
  ReservationAction,
  ReservationStatus,
  RoomStatus,
  StaffRole,
} from '../types';

export const accKeys = {
  all: ['accommodation'] as const,
  context: ['accommodation', 'context'] as const,
  filters: ['accommodation', 'filters'] as const,
  locationOptions: ['accommodation', 'location-options'] as const,
  search: (params: api.SearchParams) => ['accommodation', 'search', params] as const,
  property: (id: string) => ['accommodation', 'property', id] as const,
  myReservations: ['accommodation', 'my-reservations'] as const,
  myReservation: (id: string) => ['accommodation', 'my-reservation', id] as const,
  detail: (propertyId: string) => ['accommodation', 'detail', propertyId] as const,
  calendar: (propertyId: string, from: string, to: string) =>
    ['accommodation', 'calendar', propertyId, from, to] as const,
  rateCalendar: (propertyId: string, from: string, to: string, roomTypeId?: string | null, ratePlanId?: string | null) =>
    ['accommodation', 'rate-calendar', propertyId, from, to, roomTypeId ?? 'all', ratePlanId ?? 'all'] as const,
  dashboard: (propertyId: string, date: string) =>
    ['accommodation', 'dashboard', propertyId, date] as const,
  reservations: (propertyId: string, params: Record<string, unknown>) =>
    ['accommodation', 'reservations', propertyId, params] as const,
  reservation: (id: string) => ['accommodation', 'reservation', id] as const,
  inventory: (propertyId: string) => ['accommodation', 'inventory', propertyId] as const,
  guests: (propertyId: string, params: Record<string, unknown>) =>
    ['accommodation', 'guests', propertyId, params] as const,
  frontDesk: (propertyId: string, date: string) =>
    ['accommodation', 'frontdesk', propertyId, date] as const,
  housekeeping: (propertyId: string, date: string) =>
    ['accommodation', 'housekeeping', propertyId, date] as const,
  cash: (propertyId: string) => ['accommodation', 'cash', propertyId] as const,
  finance: (propertyId: string, month: string) =>
    ['accommodation', 'finance', propertyId, month] as const,
  daily: (propertyId: string, date: string) =>
    ['accommodation', 'daily', propertyId, date] as const,
  commission: (propertyId: string, from: string, to: string) =>
    ['accommodation', 'commission', propertyId, from, to] as const,
  report: (propertyId: string, from: string, to: string) =>
    ['accommodation', 'report', propertyId, from, to] as const,
  campaigns: (propertyId: string) => ['accommodation', 'campaigns', propertyId] as const,
  media: (propertyId: string) => ['accommodation', 'media', propertyId] as const,
  staff: (propertyId: string) => ['accommodation', 'staff', propertyId] as const,
  threads: (propertyId: string) => ['accommodation', 'threads', propertyId] as const,
  messages: (propertyId: string, reservationId: string) =>
    ['accommodation', 'messages', propertyId, reservationId] as const,
  reviews: (propertyId: string, status: string) =>
    ['accommodation', 'reviews', propertyId, status] as const,
  documents: (propertyId: string, kind: string) =>
    ['accommodation', 'documents', propertyId, kind] as const,
  propertyDocuments: (propertyId: string) =>
    ['accommodation', 'property-documents', propertyId] as const,
  tracking: (propertyId: string) => ['accommodation', 'tracking', propertyId] as const,
  activity: (propertyId: string) => ['accommodation', 'activity', propertyId] as const,
  admin: (status: string) => ['accommodation', 'admin', status] as const,
};

async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
}

function useInvalidate() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: accKeys.all });
  };
}

function useWrite<TVariables, TData>(mutationFn: (variables: TVariables) => Promise<Result<TData>>) {
  const invalidate = useInvalidate();
  return useMutation<TData, Error, TVariables>({
    mutationFn: (variables: TVariables) => unwrap(mutationFn(variables)),
    onSuccess: invalidate,
  });
}

// -----------------------------------------------------------------------------
// Keşfet / rezervasyon
// -----------------------------------------------------------------------------

export function useAccommodationContext() {
  return useQuery({
    queryKey: accKeys.context,
    queryFn: () => unwrap(api.fetchMyContext()),
    staleTime: 60_000,
  });
}

export function usePublicFilters() {
  return useQuery({
    queryKey: accKeys.filters,
    queryFn: () => unwrap(api.fetchPublicFilters()),
    staleTime: 30 * 60_000,
  });
}

/**
 * Tesis formundaki ilçe/mahalle seçenekleri. Yayınlanmış tesis sayısından
 * bağımsızdır; şehrin tüm ilçelerini döner.
 */
export function usePropertyLocationOptions() {
  return useQuery({
    queryKey: accKeys.locationOptions,
    queryFn: () => unwrap(api.fetchPropertyLocationOptions()),
    staleTime: 30 * 60_000,
  });
}

export function usePropertySearch(params: api.SearchParams, enabled = true) {
  return useQuery({
    queryKey: accKeys.search(params),
    queryFn: () => unwrap(api.searchProperties(params)),
    enabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function usePublicProperty(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.property(propertyId ?? 'none'),
    queryFn: () => unwrap(api.fetchPublicProperty(propertyId as string)),
    enabled: Boolean(propertyId),
    staleTime: 30_000,
  });
}

export function useStayQuote(
  input: {
    propertyId: string;
    roomTypeId: string;
    ratePlanId: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
  } | null,
) {
  return useQuery({
    queryKey: ['accommodation', 'quote', input],
    queryFn: () => unwrap(api.quoteStay(input as NonNullable<typeof input>)),
    enabled: Boolean(input?.propertyId && input.roomTypeId && input.ratePlanId && input.checkIn && input.checkOut),
    staleTime: 15_000,
  });
}

export function useBookStay() {
  return useWrite(api.bookStay);
}

export function useMyReservations() {
  return useQuery({
    queryKey: accKeys.myReservations,
    queryFn: () => unwrap(api.fetchMyReservations()),
    staleTime: 20_000,
  });
}

export function useMyReservation(id: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.myReservation(id ?? 'none'),
    queryFn: () => unwrap(api.fetchMyReservationDetail(id as string)),
    enabled: Boolean(id),
  });
}

export function useCancelMyReservation() {
  return useWrite((input: { id: string; reason?: string }) =>
    api.cancelMyReservation(input.id, input.reason),
  );
}

export function useCreateReview() {
  return useWrite(api.createReview);
}

// -----------------------------------------------------------------------------
// Tesis / onboarding
// -----------------------------------------------------------------------------

export function usePropertyDetail(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.detail(propertyId ?? 'none'),
    queryFn: () => unwrap(api.fetchPropertyDetail(propertyId as string)),
    enabled: Boolean(propertyId),
    staleTime: 20_000,
  });
}

export function usePropertyMissing(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: [...accKeys.detail(propertyId ?? 'none'), 'missing'],
    queryFn: () => unwrap(api.fetchPropertyMissing(propertyId as string)),
    enabled: Boolean(propertyId),
  });
}

export function useSaveProperty() {
  return useWrite((input: {
    propertyId?: string | null;
    payload: api.PropertySaveInput;
    submit?: boolean;
  }) => api.saveProperty(input.payload, { propertyId: input.propertyId, submit: input.submit }));
}

export function useSavePropertySettings(propertyId: string) {
  return useWrite((settings: Parameters<typeof api.savePropertySettings>[1]) =>
    api.savePropertySettings(propertyId, settings),
  );
}

export function usePropertyDocuments(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.propertyDocuments(propertyId ?? 'none'),
    queryFn: () => unwrap(api.fetchPropertyDocuments(propertyId as string)),
    enabled: Boolean(propertyId),
  });
}

export function useAddPropertyDocument(propertyId: string) {
  return useWrite((input: Omit<Parameters<typeof api.addPropertyDocument>[0], 'propertyId'>) =>
    api.addPropertyDocument({ propertyId, ...input }),
  );
}

export function useWebTracking(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.tracking(propertyId ?? 'none'),
    queryFn: () => unwrap(api.fetchWebTracking(propertyId as string)),
    enabled: Boolean(propertyId),
    staleTime: 60_000,
  });
}

export function usePropertyActivity(propertyId: string | null | undefined, limit = 50) {
  return useQuery({
    queryKey: [...accKeys.activity(propertyId ?? 'none'), limit],
    queryFn: () => unwrap(api.fetchActivity(propertyId as string, limit)),
    enabled: Boolean(propertyId),
  });
}

// -----------------------------------------------------------------------------
// Dashboard / takvim
// -----------------------------------------------------------------------------

export function useDashboard(propertyId: string | null | undefined, date?: string) {
  return useQuery({
    queryKey: accKeys.dashboard(propertyId ?? 'none', date ?? api.todayIso()),
    queryFn: () => unwrap(api.fetchDashboard(propertyId as string, date)),
    enabled: Boolean(propertyId),
    staleTime: 30_000,
  });
}

export function useAccommodationCalendar(
  propertyId: string | null | undefined,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: accKeys.calendar(propertyId ?? 'none', from, to),
    queryFn: () => unwrap(api.fetchCalendar(propertyId as string, from, to)),
    enabled: Boolean(propertyId && from && to),
    staleTime: 20_000,
  });
}

export function useRateCalendar(
  propertyId: string | null | undefined,
  from: string,
  to: string,
  roomTypeId?: string | null,
  ratePlanId?: string | null,
) {
  return useQuery({
    queryKey: accKeys.rateCalendar(propertyId ?? 'none', from, to, roomTypeId, ratePlanId),
    queryFn: () => unwrap(api.fetchRateCalendar(propertyId as string, from, to, roomTypeId, ratePlanId)),
    enabled: Boolean(propertyId && from && to),
    staleTime: 20_000,
  });
}

export function useBulkRateUpdate(propertyId: string) {
  return useWrite((input: Omit<Parameters<typeof api.bulkUpdateRates>[0], 'propertyId'>) =>
    api.bulkUpdateRates({ propertyId, ...input }),
  );
}

export function useCreateRoomBlock(propertyId: string) {
  return useWrite((input: Omit<Parameters<typeof api.createRoomBlock>[0], 'propertyId'>) =>
    api.createRoomBlock({ propertyId, ...input }),
  );
}

export function useDeleteRoomBlock() {
  return useWrite((input: { blockId: string; note?: string }) =>
    api.deleteRoomBlock(input.blockId, input.note),
  );
}

// -----------------------------------------------------------------------------
// Rezervasyonlar
// -----------------------------------------------------------------------------

export function useReservations(
  propertyId: string | null | undefined,
  params: {
    status?: ReservationStatus | 'all' | null;
    from?: string | null;
    to?: string | null;
    query?: string | null;
    limit?: number;
    offset?: number;
  } = {},
) {
  return useQuery({
    queryKey: accKeys.reservations(propertyId ?? 'none', params),
    queryFn: () => unwrap(api.fetchReservations(propertyId as string, params)),
    enabled: Boolean(propertyId),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
}

export function useReservation(id: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.reservation(id ?? 'none'),
    queryFn: () => unwrap(api.fetchReservationDetail(id as string)),
    enabled: Boolean(id),
  });
}

export function useCreateManualReservation(propertyId: string) {
  return useWrite((input: Omit<api.ManualReservationInput, 'propertyId'>) =>
    api.createManualReservation({ propertyId, ...input }),
  );
}

export function useUpdateReservation() {
  return useWrite((input: { id: string; payload: api.ReservationUpdateInput }) =>
    api.updateReservation(input.id, input.payload),
  );
}

export function useTransitionReservation() {
  return useWrite((input: { id: string; action: ReservationAction; note?: string }) =>
    api.transitionReservation(input.id, input.action, input.note),
  );
}

export function useAvailableRooms(input: {
  propertyId: string;
  roomTypeId: string;
  from: string;
  to: string;
  excludeReservationId?: string | null;
} | null) {
  return useQuery({
    queryKey: ['accommodation', 'available-rooms', input],
    queryFn: () => unwrap(api.fetchAvailableRooms(input as NonNullable<typeof input>)),
    enabled: Boolean(input?.propertyId && input.roomTypeId && input.from && input.to),
    staleTime: 10_000,
  });
}

// -----------------------------------------------------------------------------
// Oda / fiyat planı envanteri
// -----------------------------------------------------------------------------

export function usePropertyInventory(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.inventory(propertyId ?? 'none'),
    queryFn: () => unwrap(api.fetchPropertyInventory(propertyId as string)),
    enabled: Boolean(propertyId),
  });
}

export function useSaveRoomType(propertyId: string) {
  return useWrite((input: Omit<api.RoomTypeInput, 'id'> & { id?: string }) =>
    api.saveRoomType(propertyId, input),
  );
}

export function useArchiveRoomType() {
  return useWrite((id: string) => api.archiveRoomType(id));
}

export function useSaveRoom(propertyId: string) {
  return useWrite((input: Parameters<typeof api.saveRoom>[1]) => api.saveRoom(propertyId, input));
}

export function useArchiveRoom() {
  return useWrite((id: string) => api.archiveRoom(id));
}

export function useSetRoomStatus() {
  return useWrite((input: { roomId: string; status: RoomStatus; note?: string }) =>
    api.setRoomStatus(input.roomId, input.status as never, input.note),
  );
}

export function useSaveRatePlan(propertyId: string) {
  return useWrite((input: Parameters<typeof api.saveRatePlan>[1]) => api.saveRatePlan(propertyId, input));
}

export function useArchiveRatePlan() {
  return useWrite((id: string) => api.archiveRatePlan(id));
}

// -----------------------------------------------------------------------------
// Misafirler
// -----------------------------------------------------------------------------

export function useGuests(propertyId: string | null | undefined, query?: string) {
  return useQuery({
    queryKey: accKeys.guests(propertyId ?? 'none', { query: query ?? '' }),
    queryFn: () => unwrap(api.fetchGuests(propertyId as string, query)),
    enabled: Boolean(propertyId),
    staleTime: 20_000,
    placeholderData: (previous) => previous,
  });
}

export function useGuestDetail(guestId: string | null | undefined) {
  return useQuery({
    queryKey: ['accommodation', 'guest', guestId ?? 'none'],
    queryFn: () => unwrap(api.fetchGuestDetail(guestId as string)),
    enabled: Boolean(guestId),
  });
}

export function useSaveGuest(propertyId: string) {
  return useWrite((input: api.GuestInput) => api.saveGuest(propertyId, input));
}

// -----------------------------------------------------------------------------
// Ön büro / kat hizmetleri
// -----------------------------------------------------------------------------

export function useFrontDesk(propertyId: string | null | undefined, date?: string) {
  return useQuery({
    queryKey: accKeys.frontDesk(propertyId ?? 'none', date ?? api.todayIso()),
    queryFn: () => unwrap(api.fetchFrontDesk(propertyId as string, date)),
    enabled: Boolean(propertyId),
    staleTime: 15_000,
  });
}

export function useHousekeeping(propertyId: string | null | undefined, date?: string) {
  return useQuery({
    queryKey: accKeys.housekeeping(propertyId ?? 'none', date ?? api.todayIso()),
    queryFn: () => unwrap(api.fetchHousekeeping(propertyId as string, date)),
    enabled: Boolean(propertyId),
    staleTime: 15_000,
  });
}

export function useCreateHousekeepingTask(propertyId: string) {
  return useWrite((input: Omit<Parameters<typeof api.createHousekeepingTask>[0], 'propertyId'>) =>
    api.createHousekeepingTask({ propertyId, ...input }),
  );
}

export function useTransitionHousekeepingTask() {
  return useWrite((input: {
    taskId: string;
    status: 'pending' | 'in_progress' | 'done' | 'verified';
    note?: string;
    photoPath?: string;
  }) => api.transitionHousekeepingTask(input.taskId, input.status, input.note, input.photoPath));
}

// -----------------------------------------------------------------------------
// Kasa / finans
// -----------------------------------------------------------------------------

export function useCashOverview(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.cash(propertyId ?? 'none'),
    queryFn: () => unwrap(api.fetchCashOverview(propertyId as string)),
    enabled: Boolean(propertyId),
    staleTime: 15_000,
  });
}

export function useSaveCashAccount(propertyId: string) {
  return useWrite((input: api.CashAccountInput & { kind: CashAccountKind }) =>
    api.saveCashAccount(propertyId, input),
  );
}

export function useAddCashTransaction(propertyId: string) {
  return useWrite((input: Omit<api.CashTransactionInput, 'kind'> & {
    kind: 'collection' | 'expense' | 'refund' | 'adjustment';
  }) => api.addCashTransaction(propertyId, input));
}

export function useTransferCash(propertyId: string) {
  return useWrite((input: Omit<Parameters<typeof api.transferCash>[0], 'propertyId'>) =>
    api.transferCash({ propertyId, ...input }),
  );
}

export function useReverseCashTransaction() {
  return useWrite((input: { transactionId: string; note?: string }) =>
    api.reverseCashTransaction(input.transactionId, input.note),
  );
}

export function useAddFolioItem(propertyId: string) {
  return useWrite((input: api.FolioInput) => api.addFolioItem(propertyId, input));
}

export function useFinanceSummary(propertyId: string | null | undefined, month?: string) {
  return useQuery({
    queryKey: accKeys.finance(propertyId ?? 'none', month ?? api.todayIso().slice(0, 7)),
    queryFn: () => unwrap(api.fetchFinanceSummary(propertyId as string, month)),
    enabled: Boolean(propertyId),
    staleTime: 30_000,
  });
}

export function useDailyReport(propertyId: string | null | undefined, date?: string) {
  return useQuery({
    queryKey: accKeys.daily(propertyId ?? 'none', date ?? api.todayIso()),
    queryFn: () => unwrap(api.fetchDailyReport(propertyId as string, date)),
    enabled: Boolean(propertyId),
    staleTime: 30_000,
  });
}

export function useCommissionSummary(
  propertyId: string | null | undefined,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: accKeys.commission(propertyId ?? 'none', from, to),
    queryFn: () => unwrap(api.fetchCommissionSummary(propertyId as string, from, to)),
    enabled: Boolean(propertyId && from && to),
    staleTime: 30_000,
  });
}

export function usePayCommission(propertyId: string) {
  return useWrite((input: { amountCents: number; occurredOn?: string; note?: string | null }) =>
    api.payCommission({ propertyId, ...input }),
  );
}

export function useAccommodationReport(
  propertyId: string | null | undefined,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    queryKey: accKeys.report(propertyId ?? 'none', from, to),
    queryFn: () => unwrap(api.fetchReport(propertyId as string, from, to)),
    enabled: Boolean(propertyId && from && to) && enabled,
    staleTime: 60_000,
  });
}

// -----------------------------------------------------------------------------
// Kampanyalar
// -----------------------------------------------------------------------------

export function useAccommodationCampaigns(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.campaigns(propertyId ?? 'none'),
    queryFn: () => unwrap(api.fetchCampaigns(propertyId as string)),
    enabled: Boolean(propertyId),
  });
}

export function useSaveCampaign(propertyId: string) {
  return useWrite((input: api.CampaignInput & { status: CampaignStatus }) =>
    api.saveCampaign(propertyId, input),
  );
}

export function useEndCampaign() {
  return useWrite((id: string) => api.endCampaign(id));
}

// -----------------------------------------------------------------------------
// Medya
// -----------------------------------------------------------------------------

export function useAccommodationMedia(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.media(propertyId ?? 'none'),
    queryFn: () => unwrap(api.fetchMedia(propertyId as string)),
    enabled: Boolean(propertyId),
  });
}

export function useAddMedia(propertyId: string) {
  return useWrite((input: Omit<Parameters<typeof api.addMedia>[0], 'propertyId'>) =>
    api.addMedia({ propertyId, ...input }),
  );
}

export function useUpdateMedia() {
  return useWrite((input: {
    mediaId: string;
    category?: MediaCategory;
    caption?: string | null;
    cover?: boolean;
    sortOrder?: number;
  }) => api.updateMedia(input.mediaId, input),
  );
}

export function useDeleteMedia() {
  return useWrite((id: string) => api.deleteMedia(id));
}

export function useReorderMedia(propertyId: string) {
  return useWrite((ids: string[]) => api.reorderMedia(propertyId, ids));
}

export function useSetMediaCover() {
  return useWrite((id: string) => api.setMediaCover(id));
}

// -----------------------------------------------------------------------------
// Personel
// -----------------------------------------------------------------------------

export function usePropertyStaff(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.staff(propertyId ?? 'none'),
    queryFn: () => unwrap(api.fetchStaff(propertyId as string)),
    enabled: Boolean(propertyId),
  });
}

export function useSaveStaff(propertyId: string) {
  return useWrite((input: {
    userId?: string | null;
    username?: string | null;
    role: Exclude<StaffRole, 'owner'>;
    permissions?: string[];
  }) => api.saveStaff({ propertyId, ...input }),
  );
}

export function useRemoveStaff(propertyId: string) {
  return useWrite((userId: string) => api.removeStaff(propertyId, userId));
}

// -----------------------------------------------------------------------------
// Mesajlar / yorumlar
// -----------------------------------------------------------------------------

export function useMessageThreads(propertyId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.threads(propertyId ?? 'none'),
    queryFn: () => unwrap(api.fetchMessageThreads(propertyId as string)),
    enabled: Boolean(propertyId),
    refetchInterval: 30_000,
  });
}

export function useMessages(propertyId: string | null | undefined, reservationId: string | null | undefined) {
  return useQuery({
    queryKey: accKeys.messages(propertyId ?? 'none', reservationId ?? 'none'),
    queryFn: () => unwrap(api.fetchMessages(propertyId as string, reservationId as string)),
    enabled: Boolean(propertyId && reservationId),
    refetchInterval: 15_000,
  });
}

export function useSendMessage(propertyId: string) {
  return useWrite((input: { reservationId: string; body: string }) =>
    api.sendMessage(propertyId, input.reservationId, input.body),
  );
}

export function useAccommodationReviews(
  propertyId: string | null | undefined,
  status: 'published' | 'hidden' | 'all' = 'all',
) {
  return useQuery({
    queryKey: accKeys.reviews(propertyId ?? 'none', status),
    queryFn: () => unwrap(api.fetchReviews(propertyId as string, status)),
    enabled: Boolean(propertyId),
  });
}

export function useReplyToReview() {
  return useWrite((input: { reviewId: string; reply: string }) =>
    api.replyToReview(input.reviewId, input.reply),
  );
}

export function useSetReviewStatus() {
  return useWrite((input: { reviewId: string; status: 'published' | 'hidden' }) =>
    api.setReviewStatus(input.reviewId, input.status),
  );
}

// -----------------------------------------------------------------------------
// Belgeler
// -----------------------------------------------------------------------------

export function useAccommodationDocuments(
  propertyId: string | null | undefined,
  kind: 'reservation' | 'invoice' | 'receipt' | 'statement' | 'all' = 'all',
) {
  return useQuery({
    queryKey: accKeys.documents(propertyId ?? 'none', kind),
    queryFn: () => unwrap(api.fetchDocuments(propertyId as string, kind)),
    enabled: Boolean(propertyId),
  });
}

export function useCreateDocument(propertyId: string) {
  return useWrite((input: Omit<Parameters<typeof api.createDocument>[0], 'propertyId'>) =>
    api.createDocument({ propertyId, ...input }),
  );
}

export function useAttachDocument() {
  return useWrite((input: { documentId: string; storagePath: string }) =>
    api.attachDocument(input.documentId, input.storagePath),
  );
}

// -----------------------------------------------------------------------------
// Yönetici
// -----------------------------------------------------------------------------

export function useAdminProperties(status?: string) {
  return useQuery({
    queryKey: accKeys.admin(status ?? 'all'),
    queryFn: () => unwrap(api.fetchAdminProperties(status)),
    staleTime: 30_000,
  });
}

export function useReviewProperty() {
  return useWrite(api.reviewProperty);
}

export type { BookingMode, PaymentStatus, ReservationStatus };
