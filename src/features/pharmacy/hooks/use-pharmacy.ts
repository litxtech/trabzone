import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import type { Result } from '@/utils/result';

import * as api from '../services/pharmacy-service';
import type {
  PharmacyAdminDetail,
  PharmacyAdminDutyResponse,
  PharmacyAdminOverview,
  PharmacyAdminReviewResponse,
  PharmacyBootstrap,
  PharmacyDetail,
  PharmacyDutyNotice,
  PharmacyDutyStatus,
  PharmacyListResponse,
  PharmacyMapResponse,
  PharmacyNotificationPrefs,
  PharmacyQuality,
  PharmacySourcesResponse,
} from '../types';

function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  return promise.then((result) => {
    if (!result.ok) {
      throw result.error;
    }
    return result.data;
  });
}

function bboxKey(input: { west: number; east: number; south: number; north: number }) {
  return [input.west, input.east, input.south, input.north]
    .map((value) => value.toFixed(3))
    .join(':');
}

/**
 * Arama girdisini geciktirerek her tuşta ağ isteği atılmasını engeller.
 * (Projede `useDebouncedValue` yardımcıları ekran bazında da kullanılıyor.)
 */
export function useDebounced<T>(value: T, delay = 320): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Genel okuma
// ---------------------------------------------------------------------------

export function usePharmacyBootstrap() {
  return useQuery<PharmacyBootstrap>({
    queryKey: api.pharmacyKeys.bootstrap,
    queryFn: () => unwrap(api.fetchPharmacyBootstrap()),
    staleTime: 5 * 60_000,
  });
}

export function usePharmacies(
  params: api.PharmacyListParams,
  options: { enabled?: boolean } = {},
) {
  return useQuery<PharmacyListResponse>({
    queryKey: api.pharmacyKeys.list(params),
    queryFn: () => unwrap(api.fetchPharmacies(params)),
    enabled: options.enabled ?? true,
    staleTime: 45_000,
    placeholderData: (previous) => previous,
  });
}

export function usePharmacyDutyNotice(
  district: string | null | undefined,
  neighborhood: string | null | undefined,
) {
  return useQuery<PharmacyDutyNotice>({
    queryKey: api.pharmacyKeys.notice(district ?? null, neighborhood ?? null),
    queryFn: () => unwrap(api.fetchPharmacyDutyNotice(district, neighborhood)),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

export function usePharmacyDutyStatus() {
  return useQuery<PharmacyDutyStatus>({
    queryKey: api.pharmacyKeys.dutyStatus,
    queryFn: () => unwrap(api.fetchPharmacyDutyStatus()),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

export function usePharmacyDetail(slug: string | null | undefined) {  return useQuery<PharmacyDetail>({
    queryKey: api.pharmacyKeys.detail(slug ?? 'none'),
    queryFn: () => unwrap(api.fetchPharmacyDetail(slug as string)),
    enabled: Boolean(slug),
    staleTime: 45_000,
  });
}

export function usePharmaciesMap(
  bbox: { west: number; east: number; south: number; north: number } | null,
  options: { district?: string | null; onlyDuty?: boolean; enabled?: boolean } = {},
) {
  const key = bbox ? bboxKey(bbox) : 'none';
  return useQuery<PharmacyMapResponse>({
    queryKey: api.pharmacyKeys.map(key, options.district ?? null, options.onlyDuty ?? false),
    queryFn: () =>
      unwrap(
        api.fetchPharmaciesMap({
          ...(bbox as { west: number; east: number; south: number; north: number }),
          district: options.district,
          onlyDuty: options.onlyDuty,
        }),
      ),
    enabled: Boolean(bbox) && (options.enabled ?? true),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

// ---------------------------------------------------------------------------
// Yorum
// ---------------------------------------------------------------------------

export function useUpsertPharmacyReview(placeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { rating: number; body?: string | null }) =>
      unwrap(api.upsertPharmacyReview({ placeId, ...input })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['explore', 'reviews', placeId] });
      void client.invalidateQueries({ queryKey: ['explore', 'place', placeId] });
      void client.invalidateQueries({ queryKey: ['pharmacy'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Bildirim tercihleri
// ---------------------------------------------------------------------------

export function usePharmacyNotificationPrefs(enabled = true) {
  return useQuery<PharmacyNotificationPrefs>({
    queryKey: api.pharmacyKeys.prefs,
    queryFn: () => unwrap(api.fetchPharmacyNotificationPrefs()),
    enabled,
    staleTime: 2 * 60_000,
    retry: false,
  });
}

export function useSavePharmacyNotificationPrefs() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      enabled: boolean;
      districts: string[];
      neighborhood?: string | null;
      notifyHour?: number;
    }) => unwrap(api.savePharmacyNotificationPrefs(input)),
    onSuccess: (data) => {
      client.setQueryData(api.pharmacyKeys.prefs, data);
    },
  });
}

/**
 * İlçe çipinden tek dokunuşla abonelik ekle/çıkar. Sonuç gelene kadar çip
 * iyimser olarak güncellenir; hata olursa önceki tercih geri yüklenir.
 */
export function useTogglePharmacyNotificationDistrict() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (district: string) => unwrap(api.togglePharmacyNotificationDistrict(district)),
    onMutate: async (district) => {
      await client.cancelQueries({ queryKey: api.pharmacyKeys.prefs });
      const previous = client.getQueryData<PharmacyNotificationPrefs>(api.pharmacyKeys.prefs);
      if (previous) {
        const current = previous.enabled ? previous.districts : [];
        const districts = current.includes(district)
          ? current.filter((entry) => entry !== district)
          : [...current, district];
        client.setQueryData<PharmacyNotificationPrefs>(api.pharmacyKeys.prefs, {
          ...previous,
          districts,
          enabled: districts.length > 0,
        });
      }
      return { previous };
    },
    onError: (_error, _district, context) => {
      if (context?.previous) {
        client.setQueryData(api.pharmacyKeys.prefs, context.previous);
      }
    },
    onSuccess: (data) => {
      client.setQueryData(api.pharmacyKeys.prefs, data);
    },
  });
}

// ---------------------------------------------------------------------------
// Yönetim
// ---------------------------------------------------------------------------

export function useAdminPharmacyOverview(enabled = true) {
  return useQuery<PharmacyAdminOverview>({
    queryKey: api.pharmacyKeys.admin.overview,
    queryFn: () => unwrap(api.fetchAdminPharmacyOverview()),
    enabled,
    staleTime: 60_000,
  });
}

export function useAdminPharmacies(filters: api.AdminPharmacyFilters, enabled = true) {
  const serialized = useMemo(() => JSON.stringify(filters), [filters]);
  return useQuery({
    queryKey: api.pharmacyKeys.admin.list(serialized),
    queryFn: () => unwrap(api.fetchAdminPharmacies(filters)),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useAdminPharmacy(placeId: string | null) {
  return useQuery<PharmacyAdminDetail>({
    queryKey: api.pharmacyKeys.admin.detail(placeId),
    queryFn: () => unwrap(api.fetchAdminPharmacy(placeId as string)),
    enabled: Boolean(placeId),
  });
}

export function useUpdateAdminPharmacy(placeId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: api.AdminPharmacyUpdateInput) =>
      unwrap(api.updateAdminPharmacy(placeId as string, payload)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['pharmacy'] });
    },
  });
}

export function useAdminPharmacyDuty(date: string | null) {
  return useQuery<PharmacyAdminDutyResponse>({
    queryKey: api.pharmacyKeys.admin.duty(date),
    queryFn: () => unwrap(api.fetchAdminPharmacyDuty(date)),
    placeholderData: (previous) => previous,
  });
}

export function useUpsertAdminPharmacyDuty() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.upsertAdminPharmacyDuty>[0]) =>
      unwrap(api.upsertAdminPharmacyDuty(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['pharmacy'] });
    },
  });
}

export function useDeleteAdminPharmacyDuty() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.deleteAdminPharmacyDuty(id)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['pharmacy'] });
    },
  });
}

export function useAdminPharmacySources(enabled = true) {
  return useQuery<PharmacySourcesResponse>({
    queryKey: api.pharmacyKeys.admin.sources,
    queryFn: () => unwrap(api.fetchAdminPharmacySources()),
    enabled,
    staleTime: 30_000,
  });
}

export function useUpsertAdminPharmacySource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => unwrap(api.upsertAdminPharmacySource(payload)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.pharmacyKeys.admin.sources });
      void client.invalidateQueries({ queryKey: api.pharmacyKeys.admin.overview });
    },
  });
}

export function useTestAdminPharmacySource() {
  return useMutation({
    mutationFn: (id: string) => unwrap(api.testAdminPharmacySource(id)),
  });
}

export function useResolveAdminPharmacyUnmatched() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.resolveAdminPharmacyUnmatched>[0]) =>
      unwrap(api.resolveAdminPharmacyUnmatched(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['pharmacy', 'admin'] });
    },
  });
}

export function useAdminPharmacyReviews(status: string | null, query: string, enabled = true) {
  return useQuery<PharmacyAdminReviewResponse>({
    queryKey: [...api.pharmacyKeys.admin.reviews(status), query],
    queryFn: () => unwrap(api.fetchAdminPharmacyReviews(status, query)),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useModerateAdminPharmacyReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.moderateAdminPharmacyReview>[0]) =>
      unwrap(api.moderateAdminPharmacyReview(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['pharmacy', 'admin'] });
    },
  });
}

export function useAdminPharmacyReports(status: string, enabled = true) {
  return useQuery({
    queryKey: api.pharmacyKeys.admin.reports(status),
    queryFn: () => unwrap(api.fetchAdminPharmacyReports(status)),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function usePreviewAdminPharmacyNotification() {
  return useMutation({
    mutationFn: (input: Parameters<typeof api.previewAdminPharmacyNotification>[0]) =>
      unwrap(api.previewAdminPharmacyNotification(input)),
  });
}

export function useDispatchAdminPharmacyNotifications() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.dispatchAdminPharmacyNotifications>[0]) =>
      unwrap(api.dispatchAdminPharmacyNotifications(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.pharmacyKeys.admin.overview });
    },
  });
}

export function useUpdateAdminPharmacySettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => unwrap(api.updateAdminPharmacySettings(payload)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: api.pharmacyKeys.admin.overview });
      void client.invalidateQueries({ queryKey: api.pharmacyKeys.bootstrap });
    },
  });
}

export function useAdminPharmacyQuality(enabled = true) {
  return useQuery<PharmacyQuality>({
    queryKey: api.pharmacyKeys.admin.quality,
    queryFn: () => unwrap(api.fetchAdminPharmacyQuality()),
    enabled,
  });
}
