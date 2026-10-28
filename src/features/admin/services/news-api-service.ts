import type { PostgrestError } from '@supabase/supabase-js';

import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import { mapAdminError } from './admin-service';
import type {
  NewsCatalog,
  NewsCategoryMapping,
  NewsConnection,
  NewsConnectionDetail,
  NewsConnectionSaveInput,
  NewsDeletionCounts,
  NewsDeletionJob,
  NewsDeletionJobListItem,
  NewsDeletionMediaStatus,
  NewsDeletionPreview,
  NewsDeletionResultRow,
  NewsFieldMapping,
  NewsFilters,
  NewsHealthLog,
  NewsItem,
  NewsItemDetail,
  NewsItemStatus,
  NewsOverview,
  NewsPermissions,
  NewsPublisherCandidate,
  NewsSettings,
  NewsSourceProfile,
  NewsTestResult,
} from '@/features/news-api/types';

/**
 * Haber API merkezi istemcisi.
 *
 * Tüm okumalar ve yazmalar SECURITY DEFINER RPC'ler üzerinden gider; tablolara
 * doğrudan erişim yoktur. Bağlantı testi gerçek HTTP isteğini Edge Function
 * (`news-api-worker`) üzerinden yapar, böylece SSRF kontrolü sunucuda kalır.
 */

export const adminNewsApiKeys = {
  overview: ['admin', 'news-api', 'overview'] as const,
  connections: (params: unknown) => ['admin', 'news-api', 'connections', params] as const,
  detail: (id: string | null) => ['admin', 'news-api', 'detail', id ?? 'new'] as const,
  catalog: ['admin', 'news-api', 'catalog'] as const,
  settings: ['admin', 'news-api', 'settings'] as const,
  items: (params: unknown) => ['admin', 'news-api', 'items', params] as const,
  item: (id: string | null) => ['admin', 'news-api', 'item', id ?? ''] as const,
  deletions: (connectionId: string | null) =>
    ['admin', 'news-api', 'deletions', connectionId ?? 'all'] as const,
  deletionJob: (id: string | null) => ['admin', 'news-api', 'deletion-job', id ?? ''] as const,
  publishers: (search: string) => ['admin', 'news-api', 'publishers', search] as const,
};

type RpcResult<T> = { data: T | null; error: PostgrestError | null };

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = (await supabase.rpc(fn as never, args as never)) as RpcResult<T>;
  if (error) return fail(mapAdminError(error));
  return ok(data as T);
}

// ---------------------------------------------------------------------------
// Okuma
// ---------------------------------------------------------------------------

export const fetchNewsOverview = () => rpc<NewsOverview>('admin_news_overview');

export const fetchNewsCatalog = () => rpc<NewsCatalog>('admin_news_catalog');

export const fetchNewsConnections = (params: {
  search?: string;
  status?: string | null;
  limit?: number;
  offset?: number;
}) =>
  rpc<{ total: number; items: NewsConnection[] }>('admin_news_connections_list', {
    p_search: params.search?.trim() ? params.search.trim() : null,
    p_status: params.status ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });

export const fetchNewsConnection = (id: string) =>
  rpc<NewsConnectionDetail>('admin_news_connection_get', { p_id: id });

export const fetchNewsItems = (params: {
  connectionId: string;
  status?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
}) =>
  rpc<{ total: number; items: NewsItem[] }>('admin_news_items_list', {
    p_connection_id: params.connectionId,
    p_status: params.status ?? null,
    p_search: params.search?.trim() ? params.search.trim() : null,
    p_limit: params.limit ?? 40,
    p_offset: params.offset ?? 0,
  });

export const fetchNewsItem = (itemId: string) =>
  rpc<NewsItemDetail | null>('admin_news_item_detail', { p_item_id: itemId });

export const fetchNewsHealth = (id: string, limit = 40) =>
  rpc<{ items: NewsHealthLog[] }>('admin_news_health_list', { p_id: id, p_limit: limit });

export const fetchNewsDeletionPreview = (id: string) =>
  rpc<NewsDeletionPreview>('admin_news_deletion_preview', { p_id: id });

export const fetchNewsDeletionJobs = (connectionId: string | null, limit = 20) =>
  rpc<{ items: NewsDeletionJobListItem[] }>('admin_news_deletion_jobs_list', {
    p_connection_id: connectionId,
    p_limit: limit,
  });

export const fetchNewsDeletionJob = (jobId: string) =>
  rpc<{
    job: NewsDeletionJob;
    results: NewsDeletionResultRow[];
    media_cleanup?: NewsDeletionMediaStatus;
  }>('admin_news_deletion_job_get', {
    p_job_id: jobId,
  });

export const fetchNewsSettings = () => rpc<NewsSettings>('admin_news_settings_get');

export const fetchNewsPublisherCandidates = (search?: string) =>
  rpc<{ items: NewsPublisherCandidate[] }>('admin_news_publisher_candidates', {
    p_search: search?.trim() ? search.trim() : null,
  });

// ---------------------------------------------------------------------------
// Yazma
// ---------------------------------------------------------------------------

export const saveNewsConnection = (input: NewsConnectionSaveInput) =>
  rpc<NewsConnection>('admin_news_connection_save', { p_payload: input });

export const saveNewsAdapter = (input: {
  id: string;
  items_path?: string | null;
  pagination_kind?: string;
  pagination_param?: string | null;
  next_path?: string | null;
  since_param?: string | null;
  auth_username?: string | null;
  field_hints?: Record<string, unknown>;
}) =>
  rpc<NewsConnection>('admin_news_connection_adapter_save', {
    p_id: input.id,
    p_payload: {
      items_path: input.items_path ?? null,
      pagination_kind: input.pagination_kind ?? 'auto',
      pagination_param: input.pagination_param ?? null,
      next_path: input.next_path ?? null,
      since_param: input.since_param ?? null,
      ...(input.auth_username !== undefined ? { auth_username: input.auth_username } : {}),
      ...(input.field_hints ? { field_hints: input.field_hints } : {}),
    },
  });

export const saveNewsCredentials = (input: {
  id: string;
  secret: string;
  authKind?: string | null;
  headerName?: string | null;
  queryParam?: string | null;
  username?: string | null;
}) =>
  rpc<{ saved: boolean; secret_hint: string | null }>('admin_news_credentials_save', {
    p_id: input.id,
    p_secret: input.secret,
    p_auth_kind: input.authKind ?? null,
    p_header_name: input.headerName ?? null,
    p_query_param: input.queryParam ?? null,
    p_username: input.username ?? null,
  });

export const clearNewsCredentials = (id: string) =>
  rpc<{ cleared: boolean }>('admin_news_credentials_clear', { p_id: id });

export const saveNewsFieldMappings = (id: string, rows: NewsFieldMapping[]) =>
  rpc<{ saved: number }>('admin_news_field_mappings_save', { p_id: id, p_rows: rows });

export const saveNewsCategoryMappings = (id: string, rows: NewsCategoryMapping[]) =>
  rpc<{ saved: number }>('admin_news_category_mappings_save', { p_id: id, p_rows: rows });

export const saveNewsFilters = (input: {
  id: string;
  categories: string[];
  newsTypes: string[];
  location: { mode: string; districts: string[] };
  content: Record<string, unknown>;
  dateWindowHours: number;
}) =>
  rpc<NewsFilters>('admin_news_filters_save', {
    p_id: input.id,
    p_categories: input.categories,
    p_news_types: input.newsTypes,
    p_location: input.location,
    p_content: input.content,
    p_date_window_hours: input.dateWindowHours,
  });

export const saveNewsPermissions = (
  id: string,
  payload: Partial<NewsPermissions> & { license_status?: string; license_note?: string | null },
) => rpc<NewsPermissions>('admin_news_permissions_save', { p_id: id, p_payload: payload });

export const saveNewsProfile = (
  id: string,
  payload: Partial<NewsSourceProfile> & { profile_id?: string | null },
) => rpc<NewsConnection>('admin_news_profile_save', { p_id: id, p_payload: payload });

export const setNewsConnectionStatus = (id: string, status: string) =>
  rpc<NewsConnection>('admin_news_connection_set_status', { p_id: id, p_status: status });

export const setNewsAutoPublish = (id: string, enabled: boolean) =>
  rpc<{ auto_publish_enabled: boolean }>('admin_news_connection_set_auto_publish', {
    p_id: id,
    p_enabled: enabled,
  });

export const setNewsPublishMode = (id: string, mode: string) =>
  rpc<NewsConnection>('admin_news_connection_set_publish_mode', { p_id: id, p_mode: mode });

export const requestNewsRun = (id: string) =>
  rpc<{ requested: boolean }>('admin_news_run_request', { p_id: id });

export const approveNewsItem = (itemId: string, note?: string | null) =>
  rpc<Record<string, unknown>>('admin_news_item_approve', {
    p_item_id: itemId,
    p_note: note ?? null,
  });

export const rejectNewsItem = (itemId: string, reason: string) =>
  rpc<{ rejected: boolean }>('admin_news_item_reject', { p_item_id: itemId, p_reason: reason });

export const removeNewsItem = (itemId: string, reason: string) =>
  rpc<{ removed: boolean; post_removed: boolean; post_kept_shared: boolean; media_paths: string[] }>(
    'admin_news_item_remove',
    { p_item_id: itemId, p_reason: reason },
  );

export const startNewsDeletion = (input: {
  id: string;
  scope: 'disable_only' | 'remove_content' | 'purge';
  confirmName: string;
  reason: string | null;
}) =>
  rpc<NewsDeletionJob>('admin_news_deletion_start', {
    p_id: input.id,
    p_scope: input.scope,
    p_confirm_name: input.confirmName,
    p_reason: input.reason,
  });

export const runNewsDeletion = (jobId: string) =>
  rpc<{ finished?: boolean; processed?: number; remaining?: number }>('admin_news_deletion_run', {
    p_job_id: jobId,
  });

export const saveNewsSettings = (payload: Partial<NewsSettings>) =>
  rpc<NewsSettings>('admin_news_settings_save', { p_payload: payload });

// ---------------------------------------------------------------------------
// Kaynak testi (Edge Function + SSRF koruması)
// ---------------------------------------------------------------------------

export type NewsTestInput = {
  connectionId?: string;
  config?: {
    feed_url: string;
    name?: string;
    connector_kind?: string;
    http_method?: string;
    auth_kind?: string;
    auth_header_name?: string | null;
    auth_query_param?: string | null;
    secret?: string | null;
    items_path?: string | null;
    default_params?: Record<string, unknown>;
  };
};

export async function testNewsConnection(input: NewsTestInput): Promise<Result<NewsTestResult>> {
  const body: Record<string, unknown> = { action: 'test' };
  if (input.connectionId) body.connection_id = input.connectionId;
  if (input.config) body.config = input.config;

  const { data, error } = await supabase.functions.invoke('news-api-worker', { body });
  if (error) {
    let detail = '';
    try {
      const context = (error as { context?: Response }).context;
      if (context && typeof context.json === 'function') {
        const payload = await context.json();
        detail = typeof payload?.error === 'string' ? payload.error : '';
      }
    } catch {
      detail = '';
    }
    if (detail === 'unauthorized') {
      return fail(appError('forbidden', 'Yönetici oturumu doğrulanamadı. Sayfayı yenileyip tekrar dene.'));
    }
    return fail(appError('unknown', detail ? `Test isteği başarısız: ${detail}` : 'Test isteği gönderilemedi.'));
  }

  if (!data || typeof data !== 'object') {
    return fail(appError('unknown', 'Test yanıtı okunamadı.'));
  }
  return ok(data as NewsTestResult);
}

export type { NewsItemStatus, NewsDeletionCounts };
