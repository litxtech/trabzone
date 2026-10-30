import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import * as ride from '../services/ride-service';
import type { OfferInput, RecurringInput, SearchFilters, VehicleInput } from '../services/ride-service';

export function useRideProfile(enabled = true) {
  return useQuery({
    queryKey: ride.rideQueryKeys.profile,
    queryFn: () => unwrap(ride.getRideProfile()),
    enabled,
    // Yönetici sürücü/kimlik onayladığında kullanıcı ekranı yeniden açtığında
    // güncel yetki durumunu görsün diye her bağlanmada tazelenir.
    refetchOnMount: 'always',
    staleTime: 15_000,
  });
}

export function useRideVehicles(enabled = true) {
  return useQuery({
    queryKey: ride.rideQueryKeys.vehicles,
    queryFn: () => unwrap(ride.listVehicles()),
    enabled,
    staleTime: 20_000,
  });
}

export function useSaveVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: VehicleInput) => unwrap(ride.saveVehicle(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.vehicles });
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.profile });
    },
  });
}

export function useRemoveVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: string) => unwrap(ride.removeVehicle(vehicleId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.vehicles });
    },
  });
}

export function useSubmitVehicleDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      vehicleId: string;
      kind: 'registration' | 'insurance' | 'inspection' | 'authorization';
      documentPath: string;
      expiresAt?: string | null;
    }) => unwrap(ride.submitVehicleDocument(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.vehicles });
    },
  });
}

export function useSubmitVerification() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: 'identity' | 'driver_license' | 'insurance' | 'transport_license';
      documentPath: string;
      expiresAt?: string | null;
      meta?: Record<string, unknown>;
    }) => unwrap(ride.submitVerification(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.profile });
    },
  });
}

export function useApplyDriver() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (bio: string) => unwrap(ride.applyDriver(bio)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.profile });
    },
  });
}

export function useRideOffer(id: string | null) {
  return useQuery({
    queryKey: ride.rideQueryKeys.offer(id ?? 'none'),
    queryFn: () => unwrap(ride.getOffer(id as string)),
    enabled: Boolean(id),
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}

export function useRideSearch(filters: SearchFilters) {
  return useQuery({
    queryKey: ride.rideQueryKeys.search(filters as unknown as Record<string, unknown>),
    queryFn: () => unwrap(ride.searchOffers(filters)),
    staleTime: 15_000,
  });
}

export function usePublishOffer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: OfferInput) => unwrap(ride.publishOffer(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

function useOfferAction<T>(fn: (id: string) => Promise<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fn(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useCancelOffer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { offerId: string; reason?: string }) =>
      unwrap(ride.cancelOffer(input.offerId, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export const useStartOffer = () =>
  useOfferAction((id) => unwrap(ride.startOffer(id)));

export const useCompleteOffer = () =>
  useOfferAction((id) => unwrap(ride.completeOffer(id)));

export function useMyOffers(enabled = true) {
  return useQuery({
    queryKey: ride.rideQueryKeys.myOffers,
    queryFn: () => unwrap(ride.getMyOffers()),
    enabled,
    staleTime: 15_000,
  });
}

export function useMyRequests(enabled = true) {
  return useQuery({
    queryKey: ride.rideQueryKeys.requests,
    queryFn: () => unwrap(ride.getMyRequests()),
    enabled,
    staleTime: 15_000,
  });
}


export function useOfferReservations(offerId: string | null) {
  return useQuery({
    queryKey: ride.rideQueryKeys.offerReservations(offerId ?? 'none'),
    queryFn: () => unwrap(ride.getOfferReservations(offerId as string)),
    enabled: Boolean(offerId),
    staleTime: 10_000,
  });
}

export function useMyTrips(status?: string | null, enabled = true) {
  return useQuery({
    queryKey: ride.rideQueryKeys.trips(status),
    queryFn: () => unwrap(ride.getMyTrips(status)),
    enabled,
    staleTime: 15_000,
  });
}

export function useTripDetail(id: string | null) {
  return useQuery({
    queryKey: ride.rideQueryKeys.trip(id ?? 'none'),
    queryFn: () => unwrap(ride.getTripDetail(id as string)),
    enabled: Boolean(id),
    staleTime: 8_000,
    refetchInterval: 15_000,
  });
}

export function useReserveSeats() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ride.reserveSeats>[0]) => unwrap(ride.reserveSeats(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useRespondReservation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { reservationId: string; approve: boolean; reason?: string }) =>
      unwrap(ride.respondReservation(input.reservationId, input.approve, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useCancelReservation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { reservationId: string; reason?: string }) =>
      unwrap(ride.cancelReservation(input.reservationId, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useBoardPassenger() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { reservationId: string; code: string }) =>
      unwrap(ride.boardPassenger(input.reservationId, input.code)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useAlightPassenger() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { reservationId: string; code?: string }) =>
      unwrap(ride.alightPassenger(input.reservationId, input.code)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useJoinWaitlist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ride.joinWaitlist>[0]) => unwrap(ride.joinWaitlist(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useLeaveWaitlist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (offerId: string) => unwrap(ride.leaveWaitlist(offerId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useAcceptWaitlistOffer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (waitlistOfferId: string) => unwrap(ride.acceptWaitlistOffer(waitlistOfferId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useRideWaitlistOffers() {
  return useQuery({
    queryKey: ride.rideQueryKeys.waitlistOffers,
    queryFn: () => unwrap(ride.listWaitlistOffers()),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useRidePublicConfig() {
  return useQuery({
    queryKey: ride.rideQueryKeys.publicConfig,
    queryFn: () => unwrap(ride.getRidePublicConfig()),
    staleTime: 5 * 60_000,
  });
}

export function usePriceHint(distanceMeters: number | null, seats: number) {
  return useQuery({
    queryKey: ['ride', 'price-hint', distanceMeters, seats],
    queryFn: () => unwrap(ride.getPriceHint(distanceMeters, seats)),
    enabled: Boolean(distanceMeters && distanceMeters > 0),
    staleTime: 60_000,
  });
}

export function useRideRequests(enabled = true) {
  return useQuery({
    queryKey: ride.rideQueryKeys.requests,
    queryFn: () => unwrap(ride.getMyRequests()),
    enabled,
    staleTime: 20_000,
  });
}

export function useCreateRideRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ride.createRideRequest>[0]) =>
      unwrap(ride.createRideRequest(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.requests });
    },
  });
}

export function useCloseRideRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => unwrap(ride.closeRideRequest(requestId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.requests });
    },
  });
}

export function useFavorites() {
  return useQuery({
    queryKey: ride.rideQueryKeys.favorites,
    queryFn: () => unwrap(ride.listFavorites()),
    staleTime: 30_000,
  });
}

export function useSaveFavorite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ride.saveFavorite>[0]) => unwrap(ride.saveFavorite(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.favorites });
    },
  });
}

export function useRemoveFavorite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(ride.removeFavorite(id)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.favorites });
    },
  });
}

export function useRecurring() {
  return useQuery({
    queryKey: ride.rideQueryKeys.recurring,
    queryFn: () => unwrap(ride.listRecurring()),
    staleTime: 30_000,
  });
}

export function useSaveRecurring() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RecurringInput) => unwrap(ride.saveRecurring(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.recurring });
      void client.invalidateQueries({ queryKey: ['ride', 'offers'] });
    },
  });
}

export function useRemoveRecurring() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(ride.removeRecurring(id)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.recurring });
    },
  });
}

export function usePauseRecurringDay() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; date: string }) =>
      unwrap(ride.pauseRecurringDay(input.id, input.date)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.recurring });
    },
  });
}

export function useEmergencyContacts() {
  return useQuery({
    queryKey: ride.rideQueryKeys.contacts,
    queryFn: () => unwrap(ride.listEmergencyContacts()),
    staleTime: 60_000,
  });
}

export function useSaveEmergencyContact() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ride.saveEmergencyContact>[0]) =>
      unwrap(ride.saveEmergencyContact(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.contacts });
    },
  });
}

export function useRemoveEmergencyContact() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(ride.removeEmergencyContact(id)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.contacts });
    },
  });
}

export function useTracking(offerId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['ride', 'tracking', offerId ?? 'none'],
    queryFn: () => unwrap(ride.getTracking(offerId as string)),
    enabled: Boolean(offerId) && enabled,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}

export function useTrackPosition() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ride.trackPosition>[0]) =>
      unwrap(ride.trackPosition(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride', 'trip'] });
    },
  });
}

export function useSendSos() {
  return useMutation({
    mutationFn: (input: Parameters<typeof ride.sendSos>[0]) => unwrap(ride.sendSos(input)),
  });
}

export function useReportSafetyIncident() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ride.reportSafetyIncident>[0]) =>
      unwrap(ride.reportSafetyIncident(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride', 'trip'] });
    },
  });
}

export function useOpenDispute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ride.openDispute>[0]) => unwrap(ride.openDispute(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useCreateLocationShare() {
  return useMutation({
    mutationFn: (input: { reservationId: string; minutes: number }) =>
      unwrap(ride.createLocationShare(input.reservationId, input.minutes)),
  });
}

export function useRevokeLocationShare() {
  return useMutation({
    mutationFn: (shareId: string) => unwrap(ride.revokeLocationShare(shareId)),
  });
}

/**
 * Paylaşılan konum bağlantısı.
 *
 * `refetchInterval` 20 sn: sürücünün konumu `ride_tracking_sessions` üzerinden
 * güncellenir, karşı taraf sayfayı elle yenilemeden takip edebilmelidir.
 * Bağlantı süresi dolduğunda RPC hata verir ve sorgu yeniden denenmez.
 */
export function useLocationShareView(token: string | null) {
  return useQuery({
    queryKey: ride.rideQueryKeys.locationShare(token ?? 'none'),
    queryFn: () => unwrap(ride.viewLocationShare(token as string)),
    enabled: Boolean(token),
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: false,
  });
}

export function useSubmitReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ride.submitReview>[0]) => unwrap(ride.submitReview(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ride'] });
    },
  });
}

export function useReviews(userId: string | null) {
  return useQuery({
    queryKey: ride.rideQueryKeys.reviews(userId ?? 'none'),
    queryFn: () => unwrap(ride.getReviews(userId as string)),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Yönetim
// ---------------------------------------------------------------------------

export function useRideAdminOverview(enabled = true) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'overview'],
    queryFn: () => unwrap(ride.adminOverview()),
    enabled,
    staleTime: 30_000,
  });
}

export function useRideAdminOffers(input: { status?: string | null; query?: string | null; offset?: number }) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'offers', input],
    queryFn: () => unwrap(ride.adminOffers({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

export function useRideAdminReservations(input: {
  status?: string | null;
  query?: string | null;
  offset?: number;
}) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'reservations', input],
    queryFn: () => unwrap(ride.adminReservations({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

export function useRideAdminVerifications(input: { status?: string | null; offset?: number }) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'verifications', input],
    queryFn: () => unwrap(ride.adminVerifications({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

export function useRideAdminDriverApplications(input: { status?: string | null; offset?: number }) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'driver-applications', input],
    queryFn: () => unwrap(ride.adminDriverApplications({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

export function useRideAdminVehicles(input: { status?: string | null; offset?: number }) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'vehicles', input],
    queryFn: () => unwrap(ride.adminVehicles({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

export function useRideAdminDisputes(input: { status?: string | null; offset?: number }) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'disputes', input],
    queryFn: () => unwrap(ride.adminDisputes({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

export function useRideAdminIncidents(input: { status?: string | null; offset?: number }) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'incidents', input],
    queryFn: () => unwrap(ride.adminIncidents({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

export function useRideAdminFinance(enabled = true) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'finance'],
    queryFn: () => unwrap(ride.adminFinance()),
    enabled,
    staleTime: 30_000,
  });
}

export function useRideAdminSettings(enabled = true) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'settings'],
    queryFn: () => unwrap(ride.adminSettings()),
    enabled,
    staleTime: 30_000,
  });
}

export function useRideAdminAnalytics(days: number, enabled = true) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'analytics', days],
    queryFn: () => unwrap(ride.adminAnalytics(days)),
    enabled,
    staleTime: 60_000,
  });
}

export function useRideAdminAudit(offset: number, enabled = true) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'audit', offset],
    queryFn: () => unwrap(ride.adminAudit(30, offset)),
    enabled,
    staleTime: 30_000,
  });
}

export function useRideAdminRequests(input: {
  status?: string | null;
  query?: string | null;
  offset?: number;
}) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'requests', input],
    queryFn: () => unwrap(ride.adminRequests({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

export function useRideAdminWaitlists(input: { status?: string | null; offset?: number }) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'waitlists', input],
    queryFn: () => unwrap(ride.adminWaitlists({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

export function useRideAdminReviews(input: {
  status?: string | null;
  query?: string | null;
  offset?: number;
}) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'reviews', input],
    queryFn: () => unwrap(ride.adminReviews({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

export function useRideAdminRecurring(input: { active?: boolean | null; offset?: number }) {
  return useQuery({
    queryKey: [...ride.rideQueryKeys.admin, 'recurring', input],
    queryFn: () => unwrap(ride.adminRecurring({ ...input, limit: 30 })),
    staleTime: 15_000,
  });
}

function useAdminMutation<TInput, TOutput>(fn: (input: TInput) => Promise<TOutput>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ride.rideQueryKeys.admin });
      void client.invalidateQueries({ queryKey: ['admin', 'shell'] });
    },
  });
}

export const useRideAdminOfferAction = () =>
  useAdminMutation((input: { offerId: string; action: 'cancel' | 'suspend_driver'; reason: string }) =>
    unwrap(ride.adminOfferAction(input.offerId, input.action, input.reason)),
  );

export const useRideAdminReservationAction = () =>
  useAdminMutation((input: { reservationId: string; reason: string }) =>
    unwrap(ride.adminReservationAction(input.reservationId, 'cancel', input.reason)),
  );

export const useRideAdminVerificationDecide = () =>
  useAdminMutation((input: Parameters<typeof ride.adminVerificationDecide>[0]) =>
    unwrap(ride.adminVerificationDecide(input)),
  );

export const useRideAdminDriverDecide = () =>
  useAdminMutation((input: { userId: string; approve: boolean; reason?: string }) =>
    unwrap(ride.adminDriverDecide(input.userId, input.approve, input.reason)),
  );

export const useRideAdminVehicleDecide = () =>
  useAdminMutation((input: { vehicleId: string; approve: boolean; reason?: string }) =>
    unwrap(ride.adminVehicleDecide(input.vehicleId, input.approve, input.reason)),
  );

export const useRideAdminVehicleDocumentDecide = () =>
  useAdminMutation((input: Parameters<typeof ride.adminVehicleDocumentDecide>[0]) =>
    unwrap(ride.adminVehicleDocumentDecide(input)),
  );

export const useRideAdminDisputeDecide = () =>
  useAdminMutation((input: Parameters<typeof ride.adminDisputeDecide>[0]) =>
    unwrap(ride.adminDisputeDecide(input)),
  );

export const useRideAdminIncidentAction = () =>
  useAdminMutation((input: { incidentId: string; status: 'acknowledged' | 'resolved'; note?: string }) =>
    unwrap(ride.adminIncidentAction(input.incidentId, input.status, input.note)),
  );

export const useRideAdminRefundDecide = () =>
  useAdminMutation((input: { refundId: string; approve: boolean; reason?: string }) =>
    unwrap(ride.adminRefundDecide(input.refundId, input.approve, input.reason)),
  );

export const useRideAdminSetSetting = () =>
  useAdminMutation((input: { key: string; value: unknown }) =>
    unwrap(ride.adminSetSetting(input.key, input.value)),
  );

export const useRideAdminRequestAction = () =>
  useAdminMutation((input: { requestId: string; action: 'close' | 'expire'; reason: string }) =>
    unwrap(ride.adminRequestAction(input.requestId, input.action, input.reason)),
  );

export const useRideAdminReviewModerate = () =>
  useAdminMutation((input: { reviewId: string; hide: boolean; reason: string }) =>
    unwrap(ride.adminReviewModerate(input.reviewId, input.hide, input.reason)),
  );
