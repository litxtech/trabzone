import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';

import type { EarthquakeSource, EarthquakeStatus } from '../types';

async function call<T>(name: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, params ?? {});
  if (error) throw rpcError(error);
  if (data == null) throw appError('not_found');
  return data as T;
}

export type AdminSourceHealth = {
  key: EarthquakeSource;
  name: string;
  is_enabled: boolean;
  is_primary: boolean;
  health: 'unknown' | 'healthy' | 'degraded' | 'down' | 'disabled';
  terms_status: 'pending_review' | 'verified' | 'restricted';
  consecutive_failures: number;
  next_retry_at: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  last_latency_ms: number | null;
};

export type AdminSettings = {
  center_lat: number;
  center_lng: number;
  center_label: string;
  default_region: string;
  radius_options: number[];
  turkey_enabled: boolean;
  district_filter_enabled: boolean;
  default_range_days: number;
  map_default_zoom: number;
  map_layers: { boundary?: boolean; radius?: boolean; clusters?: boolean };
  chart_max_points: number;
  sync_enabled: boolean;
  sync_interval_seconds: number;
  overlap_minutes: number;
  revision_sweep_hours: number;
  stale_after_seconds: number;
  notifications_enabled: boolean;
  notifications_paused: boolean;
  notify_trabzon_enabled: boolean;
  notify_turkey_enabled: boolean;
  notify_small_enabled: boolean;
  small_magnitude_threshold: number;
  late_event_max_minutes: number;
  revision_notify_min_delta: number;
  important_magnitude: number;
  quiet_bypass_magnitude: number;
  push_expire_minutes: number;
  last_tick_at: string | null;
  last_sweep_at: string | null;
  updated_at: string;
};

export type AdminOverview = {
  status: EarthquakeStatus;
  sources: AdminSourceHealth[];
  events: {
    last_24h_total: number;
    last_24h_r150: number;
    last_24h_province: number;
    last_24h_turkey: number;
    archive_total: number;
    deduplicated_24h: number;
    pending_match: number;
    under_review: number;
    removed: number;
  };
  sync_24h: {
    runs: number;
    success: number;
    partial: number;
    failed: number;
    avg_latency_ms: number | null;
    rejected_records: number;
    new_events: number;
  };
  ingest_latency: { samples: number; p50_seconds: number | null; p95_seconds: number | null };
  notifications_24h: {
    events: number;
    completed: number;
    skipped: number;
    pending: number;
    in_app: number;
    push_sent: number;
    push_delivered: number;
    push_failed: number;
    push_invalid: number;
    push_suppressed: number;
    push_queued: number;
  };
  subscribers: {
    enabled: number;
    trabzon: number;
    province: number;
    turkey: number;
    all_magnitudes: number;
    active_devices: number;
    invalidated_devices_7d: number;
  };
  recent_errors: { provider: string; at: string; code: string | null; message: string | null; run_kind: string }[];
  settings: AdminSettings;
};

export type AdminSource = AdminSourceHealth & {
  homepage_url: string;
  api_url: string;
  docs_url: string | null;
  attribution: string;
  terms_note: string | null;
  last_http_status: number | null;
  last_response_meta: Record<string, unknown> | null;
  usage_24h: { requests: number; failed: number; avg_latency_ms: number | null; records: number };
  records_total: number;
  matched_total: number;
  oldest_record: string | null;
};

export type SyncLog = {
  id: string;
  provider: string;
  run_kind: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  http_status: number | null;
  latency_ms: number | null;
  attempts: number;
  records_received: number;
  records_valid: number;
  records_rejected: number;
  new_events: number;
  updated_records: number;
  unchanged_records: number;
  matched_records: number;
  review_records: number;
  notifications_queued: number;
  error_code: string | null;
  error_message: string | null;
};

export type AdminNotification = {
  id: string;
  type: 'new' | 'revision' | 'test';
  status: string;
  skip_reason: string | null;
  title: string | null;
  body: string | null;
  priority: string;
  is_test: boolean;
  created_at: string;
  completed_at: string | null;
  recipients: number;
  in_app: number;
  push_queued: number;
  push_suppressed: number;
  event: { id: string; canonical_id: string; magnitude: number; magnitude_type: string | null; occurred_at: string; location: string | null } | null;
  push: { sent: number; delivered: number; failed: number; invalid: number; expired: number; pending: number } | null;
};

export type AdminEventRow = {
  id: string;
  canonical_id: string;
  status: 'active' | 'under_review' | 'pending_match' | 'merged' | 'removed';
  preferred_source: EarthquakeSource;
  sources: EarthquakeSource[];
  occurred_at: string;
  magnitude: number;
  magnitude_type: string | null;
  depth_km: number | null;
  location: string | null;
  distance_km: number;
  region_classification: string;
  revision: number;
  first_seen_at: string;
  updated_at: string;
  notification_state: string;
  notification_skip_reason: string | null;
  pending_reviews: number;
  has_admin_note: boolean;
};

export type AdminEventDetail = {
  event: Record<string, unknown> & { id: string; canonical_event_id: string; status: AdminEventRow['status']; sources: EarthquakeSource[]; preferred_source: EarthquakeSource; admin_note: string | null };
  district_name: string | null;
  records: (Record<string, unknown> & { id: string; source_name: EarthquakeSource; source_event_id: string })[];
  revisions: Record<string, unknown>[];
  match_reviews: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  views: number;
  audit: Record<string, unknown>[];
};

export type MatchReview = {
  id: string;
  status: 'pending' | 'linked' | 'rejected';
  dt_seconds: number | null;
  distance_km: number | null;
  magnitude_delta: number | null;
  candidate_count: number;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  record: { source: EarthquakeSource; source_event_id: string; magnitude: number; magnitude_type: string | null; depth_km: number | null; latitude: number; longitude: number; occurred_at: string; location: string | null } | null;
  own: { id: string; canonical_id: string; status: string } | null;
  candidate: { id: string; canonical_id: string; status: string; source: EarthquakeSource; magnitude: number; magnitude_type: string | null; depth_km: number | null; latitude: number; longitude: number; occurred_at: string; location: string | null } | null;
};

export type AdminAnalytics = {
  days: number;
  daily: { day: string; total: number; r150: number; province: number; views: number; push_sent: number; push_failed: number; avg_ingest_seconds: number | null }[];
  magnitude_bins: Record<'below_0' | 'm0' | 'm2' | 'm3' | 'm4' | 'm5', number>;
  districts: { key: string; name: string; count: number }[];
  offshore: number;
  source_comparison: { afad_only: number; usgs_only: number; both: number; avg_magnitude_delta: number | null; avg_distance_km: number | null };
  top_viewed: { canonical_id: string; magnitude: number; magnitude_type: string | null; location: string | null; occurred_at: string; views: number }[];
};

export type AuditEntry = {
  id: number;
  admin_id: string | null;
  admin_username: string | null;
  operation: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
};

export const adminKeys = {
  all: ['earthquake-admin'] as const,
  overview: ['earthquake-admin', 'overview'] as const,
  sources: ['earthquake-admin', 'sources'] as const,
  logs: (provider: string | null, status: string | null, offset: number) => ['earthquake-admin', 'logs', provider, status, offset] as const,
  notifications: (status: string | null, offset: number) => ['earthquake-admin', 'notifications', status, offset] as const,
  failures: ['earthquake-admin', 'failures'] as const,
  events: (filters: Record<string, unknown>) => ['earthquake-admin', 'events', filters] as const,
  event: (id: string) => ['earthquake-admin', 'event', id] as const,
  reviews: (status: string | null) => ['earthquake-admin', 'reviews', status] as const,
  analytics: (days: number) => ['earthquake-admin', 'analytics', days] as const,
  audit: (offset: number) => ['earthquake-admin', 'audit', offset] as const,
};

export function useAdminEarthquakeOverview(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.overview,
    queryFn: () => call<AdminOverview>('earthquake_admin_overview'),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useAdminEarthquakeSources(enabled: boolean) {
  return useQuery({ queryKey: adminKeys.sources, queryFn: () => call<AdminSource[]>('earthquake_admin_sources'), enabled });
}

export function useAdminSyncLogs(provider: string | null, status: string | null, offset: number, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.logs(provider, status, offset),
    queryFn: () =>
      call<{ items: SyncLog[]; total: number }>('earthquake_admin_sync_logs', {
        p_provider: provider,
        p_status: status,
        p_limit: 30,
        p_offset: offset,
      }),
    enabled,
  });
}

export function useAdminNotifications(status: string | null, offset: number, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.notifications(status, offset),
    queryFn: () =>
      call<{ items: AdminNotification[]; total: number }>('earthquake_admin_notifications', {
        p_status: status,
        p_limit: 20,
        p_offset: offset,
      }),
    enabled,
  });
}

export function useAdminPushFailures(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.failures,
    queryFn: () =>
      call<{ items: { id: string; notification_event_id: string; status: string; platform: string | null; retry_count: number; attempted_at: string | null; error: string | null; message: string | null; created_at: string }[] }>(
        'earthquake_admin_push_failures',
        { p_limit: 30, p_offset: 0 },
      ),
    enabled,
  });
}

export function useAdminEvents(
  filters: { status: string | null; source: string | null; region: string | null; search: string; offset: number },
  enabled: boolean,
) {
  return useQuery({
    queryKey: adminKeys.events(filters),
    queryFn: () =>
      call<{ items: AdminEventRow[] }>('earthquake_admin_events', {
        p_status: filters.status,
        p_source: filters.source,
        p_region: filters.region,
        p_search: filters.search.trim() || null,
        p_limit: 30,
        p_offset: filters.offset,
      }),
    enabled,
  });
}

export function useAdminEvent(id: string | null) {
  return useQuery({
    queryKey: adminKeys.event(id ?? ''),
    queryFn: () => call<AdminEventDetail>('earthquake_admin_event_get', { p_id: id }),
    enabled: Boolean(id),
  });
}

export function useAdminMatchReviews(status: string | null, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.reviews(status),
    queryFn: () => call<{ items: MatchReview[] }>('earthquake_admin_match_reviews', { p_status: status, p_limit: 50, p_offset: 0 }),
    enabled,
  });
}

export function useAdminEarthquakeAnalytics(days: number, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.analytics(days),
    queryFn: () => call<AdminAnalytics>('earthquake_admin_analytics', { p_days: days }),
    enabled,
  });
}

export function useAdminEarthquakeAudit(offset: number, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.audit(offset),
    queryFn: () => call<AuditEntry[]>('earthquake_admin_audit_list', { p_limit: 30, p_offset: offset }),
    enabled,
  });
}

/** Yazma işlemleri; başarıdan sonra tüm admin deprem sorguları tazelenir. */
export function useEarthquakeAdminMutation<TInput, TResult = unknown>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['earthquake'] });
    },
  });
}

export const adminApi = {
  updateSource: (input: { key: string; patch: Record<string, unknown>; reason: string }) =>
    call('earthquake_admin_source_update', { p_key: input.key, p_patch: input.patch, p_reason: input.reason }),
  updateSettings: (input: { patch: Record<string, unknown>; reason: string }) =>
    call<AdminSettings & { reclassified: number }>('earthquake_admin_settings_update', { p_patch: input.patch, p_reason: input.reason }),
  retryFailed: (input: { eventId: string | null; reason: string }) =>
    call<{ requeued: number }>('earthquake_admin_retry_failed', { p_notification_event_id: input.eventId, p_reason: input.reason }),
  testPush: (input: { note: string | null }) =>
    call<{ notification_event_id: string; devices: number; in_app: boolean }>('earthquake_admin_test_push', { p_note: input.note }),
  eventAction: (input: { id: string; action: string; reason: string; value?: string | null }) =>
    call('earthquake_admin_event_action', { p_id: input.id, p_action: input.action, p_reason: input.reason, p_value: input.value ?? null }),
  resolveMatch: (input: { reviewId: string; decision: 'link' | 'reject'; reason: string }) =>
    call('earthquake_admin_match_resolve', { p_review_id: input.reviewId, p_decision: input.decision, p_reason: input.reason }),
};

export type WorkerAction =
  | { action: 'test'; provider: EarthquakeSource }
  | { action: 'sync'; provider?: EarthquakeSource; sweep?: boolean; reason?: string }
  | { action: 'backfill'; provider: EarthquakeSource; days: number; offset_days?: number; reason: string }
  | { action: 'dispatch'; reason?: string };

const WORKER_ERRORS: Record<string, string> = {
  unauthorized: 'Bu işlem için yetkiniz yok.',
  rate_limited: 'Çok sık deneme yapıldı. Biraz bekleyin.',
  provider_required: 'Kaynak seçilmedi.',
  worker_failed: 'İşlem sunucuda başarısız oldu.',
};

/** earthquake-sync edge function'ı oturumdaki admin JWT'siyle çağırır. */
export async function invokeWorker<T = Record<string, unknown>>(input: WorkerAction): Promise<T> {
  const { data, error } = await supabase.functions.invoke('earthquake-sync', { body: input });
  if (error) {
    let code = 'worker_failed';
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = (await context.json()) as { error?: string };
        if (payload?.error) code = payload.error;
      } catch {
        // gövde JSON değil
      }
    }
    throw new Error(WORKER_ERRORS[code] ?? `İşlem başarısız (${code}).`);
  }
  return data as T;
}
