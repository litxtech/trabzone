import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  PharmacyAdminDetail,
  PharmacyAdminDutyResponse,
  PharmacyAdminListItemResponse,
  PharmacyAdminOverview,
  PharmacyAdminReport,
  PharmacyAdminReviewResponse,
  PharmacyBootstrap,
  PharmacyDetail,
  PharmacyDutyNotice,
  PharmacyDutyStatus,
  PharmacyListMode,
  PharmacyListResponse,
  PharmacyMapResponse,
  PharmacyNotificationDispatchResult,
  PharmacyNotificationPrefs,
  PharmacyNotificationPreview,
  PharmacyQuality,
  PharmacySettingsResponse,
  PharmacySourceTestResult,
  PharmacySourcesResponse,
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

export const pharmacyKeys = {
  all: ['pharmacy'] as const,
  bootstrap: ['pharmacy', 'bootstrap'] as const,
  list: (params: PharmacyListParams) => ['pharmacy', 'list', params] as const,
  notice: (district: string | null, neighborhood: string | null) =>
    ['pharmacy', 'notice', district ?? '-', neighborhood ?? '-'] as const,
  dutyStatus: ['pharmacy', 'duty-status'] as const,
  detail: (slug: string) => ['pharmacy', 'detail', slug] as const,
  map: (bbox: string, district: string | null, onlyDuty: boolean) =>
    ['pharmacy', 'map', bbox, district ?? '-', onlyDuty] as const,
  prefs: ['pharmacy', 'prefs'] as const,
  admin: {
    overview: ['pharmacy', 'admin', 'overview'] as const,
    list: (filters: string) => ['pharmacy', 'admin', 'list', filters] as const,
    detail: (id: string | null) => ['pharmacy', 'admin', 'detail', id] as const,
    duty: (date: string | null) => ['pharmacy', 'admin', 'duty', date ?? 'today'] as const,
    sources: ['pharmacy', 'admin', 'sources'] as const,
    reviews: (status: string | null) => ['pharmacy', 'admin', 'reviews', status ?? 'all'] as const,
    reports: (status: string) => ['pharmacy', 'admin', 'reports', status] as const,
    settings: ['pharmacy', 'admin', 'settings'] as const,
    quality: ['pharmacy', 'admin', 'quality'] as const,
  },
};

// ---------------------------------------------------------------------------
// Genel (uygulama) okuma
// ---------------------------------------------------------------------------

export function fetchPharmacyBootstrap() {
  return call<PharmacyBootstrap>('pharmacies_bootstrap');
}

export type PharmacyListParams = {
  district?: string | null;
  neighborhood?: string | null;
  query?: string | null;
  mode?: PharmacyListMode;
  lat?: number | null;
  lng?: number | null;
  limit?: number;
  offset?: number;
};

export function fetchPharmacies(params: PharmacyListParams) {
  // Sunucu `nearby` modunda konum ister; konum yoksa `all` gibi davranır.
  return call<PharmacyListResponse>('pharmacies_list', {
    p_district: params.district ?? null,
    p_neighborhood: params.neighborhood ?? null,
    p_query: params.query?.trim() || null,
    p_mode: params.mode ?? 'all',
    p_lat: params.lat ?? null,
    p_lng: params.lng ?? null,
    p_limit: params.limit ?? 40,
    p_offset: params.offset ?? 0,
  });
}

export function fetchPharmacyDutyNotice(district?: string | null, neighborhood?: string | null) {
  return call<PharmacyDutyNotice>('pharmacy_duty_notice', {
    p_district: district ?? null,
    p_neighborhood: neighborhood ?? null,
  });
}

/** "Bugün kaç eczane nöbetçi, kayıt ne kadar taze" — tek okuma noktası. */
export function fetchPharmacyDutyStatus() {
  return call<PharmacyDutyStatus>('pharmacy_duty_status');
}

export function fetchPharmacyDetail(slug: string) {
  return call<PharmacyDetail>('pharmacy_detail', { p_slug: slug });
}

export function fetchPharmaciesMap(input: {
  west: number;
  east: number;
  south: number;
  north: number;
  district?: string | null;
  onlyDuty?: boolean;
  limit?: number;
}) {
  return call<PharmacyMapResponse>('pharmacies_map', {
    p_west: input.west,
    p_east: input.east,
    p_south: input.south,
    p_north: input.north,
    p_district: input.district ?? null,
    p_only_duty: input.onlyDuty ?? false,
    p_limit: input.limit ?? 400,
  });
}

/**
 * Eczane yorumu yazma. `place_review_upsert` yerine bu RPC kullanılır:
 * sunucu tarafında TC kimlik numarası ve reçete/reçete fotoğrafı talebi gibi
 * hassas kişisel veri kalıpları reddedilir.
 */
export function upsertPharmacyReview(input: {
  placeId: string;
  rating: number;
  body?: string | null;
}) {
  return call<{ id: string; media_pending: number }>('pharmacy_review_upsert', {
    p_place_id: input.placeId,
    p_rating: input.rating,
    p_body: input.body?.trim() || null,
  });
}

// ---------------------------------------------------------------------------
// Bildirim tercihleri
// ---------------------------------------------------------------------------

export function fetchPharmacyNotificationPrefs() {
  return call<PharmacyNotificationPrefs>('pharmacy_notification_prefs_get');
}

export function savePharmacyNotificationPrefs(input: {
  enabled: boolean;
  districts: string[];
  neighborhood?: string | null;
  notifyHour?: number;
}) {
  return call<PharmacyNotificationPrefs>('pharmacy_notification_districts_set', {
    p_enabled: input.enabled,
    p_districts: input.districts,
    p_neighborhood: input.neighborhood ?? null,
    p_notify_hour: input.notifyHour ?? null,
  });
}

export function togglePharmacyNotificationDistrict(district: string) {
  return call<PharmacyNotificationPrefs>('pharmacy_notification_district_toggle', {
    p_district: district,
  });
}

// ---------------------------------------------------------------------------
// Yönetim
// ---------------------------------------------------------------------------

export function fetchAdminPharmacyOverview() {
  return call<PharmacyAdminOverview>('admin_pharmacy_overview');
}

export type AdminPharmacyFilters = {
  district?: string | null;
  query?: string | null;
  missing?: 'address' | 'phone' | 'neighborhood' | 'hours' | 'coordinates' | 'verified' | null;
  limit?: number;
  offset?: number;
};

export function fetchAdminPharmacies(filters: AdminPharmacyFilters) {
  return call<PharmacyAdminListItemResponse>('admin_pharmacies_list', {
    p_district: filters.district ?? null,
    p_query: filters.query?.trim() || null,
    p_missing: filters.missing ?? null,
    p_limit: filters.limit ?? 40,
    p_offset: filters.offset ?? 0,
  });
}

export function fetchAdminPharmacy(placeId: string) {
  return call<PharmacyAdminDetail>('admin_pharmacy_get', { p_place_id: placeId });
}

export type AdminPharmacyUpdateInput = {
  neighborhood?: string | null;
  address?: string | null;
  phone?: string | null;
  working_hours?: Record<string, unknown>;
  lat?: number | null;
  lng?: number | null;
  verified?: boolean;
  duty_tracking?: boolean;
  notes?: string | null;
};

export function updateAdminPharmacy(placeId: string, payload: AdminPharmacyUpdateInput) {
  return call<PharmacyAdminDetail>('admin_pharmacy_update', {
    p_place_id: placeId,
    p_payload: payload,
  });
}

export function fetchAdminPharmacyDuty(date?: string | null) {
  return call<PharmacyAdminDutyResponse>('admin_pharmacy_duty_list', {
    p_date: date ?? null,
  });
}

export function upsertAdminPharmacyDuty(input: {
  placeId: string;
  dutyDate: string;
  startTime: string;
  endTime: string;
  status?: 'confirmed' | 'unverified' | 'conflict' | 'cancelled';
  sourceId?: string | null;
  note?: string | null;
}) {
  return call<{ id: string; starts_at: string; ends_at: string; status: string }>(
    'admin_pharmacy_duty_upsert',
    {
      p_payload: {
        place_id: input.placeId,
        duty_date: input.dutyDate,
        start_time: input.startTime,
        end_time: input.endTime,
        status: input.status ?? 'confirmed',
        source_id: input.sourceId ?? null,
        note: input.note ?? null,
      },
    },
  );
}

export function deleteAdminPharmacyDuty(id: string) {
  return call<{ ok: boolean }>('admin_pharmacy_duty_delete', { p_id: id });
}

export function fetchAdminPharmacySources() {
  return call<PharmacySourcesResponse>('admin_pharmacy_sources');
}

export function upsertAdminPharmacySource(payload: Record<string, unknown>) {
  return call<{ id: string }>('admin_pharmacy_source_upsert', { p_payload: payload });
}

export function testAdminPharmacySource(id: string) {
  return call<PharmacySourceTestResult>('admin_pharmacy_source_test', { p_id: id });
}

export function applyAdminPharmacyDuty(input: {
  sourceKey: string;
  records: unknown[];
  runKind?: 'manual' | 'scheduled' | 'import';
  markVerified?: boolean;
}) {
  return call<Record<string, unknown>>('admin_pharmacy_duty_apply', {
    p_source_key: input.sourceKey,
    p_records: input.records,
    p_run_kind: input.runKind ?? 'manual',
    p_mark_verified: input.markVerified ?? false,
  });
}

export function resolveAdminPharmacyUnmatched(input: {
  id: string;
  placeId?: string | null;
  decision: 'link' | 'reject';
}) {
  return call<{ ok: boolean }>('admin_pharmacy_unmatched_resolve', {
    p_id: input.id,
    p_place_id: input.placeId ?? null,
    p_decision: input.decision,
  });
}

export function fetchAdminPharmacyReviews(status?: string | null, query?: string | null) {
  return call<PharmacyAdminReviewResponse>('admin_pharmacy_reviews_list', {
    p_status: status ?? null,
    p_query: query?.trim() || null,
    p_limit: 60,
    p_offset: 0,
  });
}

export function fetchAdminPharmacyReports(status = 'pending') {
  return call<{ items: PharmacyAdminReport[] }>('admin_pharmacy_reports_list', {
    p_status: status,
  });
}

export function moderateAdminPharmacyReview(input: {
  reviewId: string;
  action: 'hide' | 'restore' | 'delete' | 'warn';
  note?: string | null;
}) {
  return call<{ ok: boolean }>('admin_place_review_moderate', {
    p_review_id: input.reviewId,
    p_action: input.action,
    p_note: input.note ?? null,
  });
}

export function previewAdminPharmacyNotification(input: {
  district?: string | null;
  neighborhood?: string | null;
  date?: string | null;
}) {
  return call<PharmacyNotificationPreview>('admin_pharmacy_notifications_preview', {
    p_district: input.district ?? null,
    p_neighborhood: input.neighborhood ?? null,
    p_date: input.date ?? null,
  });
}

export function dispatchAdminPharmacyNotifications(input: {
  date?: string | null;
  dryRun?: boolean;
}) {
  return call<PharmacyNotificationDispatchResult>('admin_pharmacy_notifications_dispatch', {
    p_date: input.date ?? null,
    p_dry_run: input.dryRun ?? true,
  });
}

export function updateAdminPharmacySettings(payload: Record<string, unknown>) {
  return call<PharmacySettingsResponse>('admin_pharmacy_settings_update', { p_payload: payload });
}

export function fetchAdminPharmacyQuality() {
  return call<PharmacyQuality>('admin_pharmacy_quality');
}
