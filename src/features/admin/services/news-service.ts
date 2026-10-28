import type { PostgrestError } from '@supabase/supabase-js';

import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import { mapAdminError } from './admin-service';
import type {
  NewsAssistAction,
  NewsCostSummary,
  NewsEditorialQueue,
  NewsErrorItem,
  NewsOverview,
  NewsReviewAction,
  NewsReviewDetail,
  NewsReviewList,
  NewsRun,
  NewsQueueState,
  NewsSettings,
  NewsSettingsProgress,
  NewsSource,
  NewsSourcesResponse,
} from '@/features/news/types';

export const adminNewsKeys = {
  overview: ['admin', 'news', 'overview'] as const,
  runs: (limit: number) => ['admin', 'news', 'runs', limit] as const,
  settings: ['admin', 'news', 'settings'] as const,
  review: (state: NewsQueueState, limit: number, offset: number) =>
    ['admin', 'news', 'review', state, limit, offset] as const,
  reviewDetail: (eventId: string | null) => ['admin', 'news', 'review-detail', eventId ?? ''] as const,
  sources: ['admin', 'news', 'sources'] as const,
  costs: ['admin', 'news', 'costs'] as const,
  errors: (limit: number) => ['admin', 'news', 'errors', limit] as const,
  editorial: ['admin', 'news', 'editorial'] as const,
};

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return fail(mapAdminError(error as PostgrestError));
  return ok(data as unknown as T);
}

export const fetchNewsOverview = () => rpc<NewsOverview>('admin_ai_news_overview');

export const fetchNewsRuns = (limit = 20) =>
  rpc<{ items: NewsRun[] }>('admin_ai_news_runs_list', { p_limit: limit });

export const fetchNewsSettings = () => rpc<NewsSettings>('admin_ai_news_settings_get');

export const saveNewsSettings = (payload: NewsSettingsProgress, reason: string | null = null) =>
  rpc<NewsSettings>('admin_ai_news_settings_save', { p_payload: payload, p_reason: reason });

export const fetchNewsEditorialQueue = (limit = 40) =>
  rpc<NewsEditorialQueue>('admin_news_editorial_queue', { p_limit: limit });

export const saveNewsSourceBody = (
  postId: string,
  payload: Record<string, unknown>,
  reason: string | null = null,
) =>
  rpc<Record<string, unknown>>('admin_news_source_save', {
    p_post_id: postId,
    p_payload: payload,
    p_reason: reason,
  });

export const runNewsNow = () => rpc<Record<string, unknown>>('admin_ai_news_run_now');

export const fetchNewsReviewList = (state: NewsQueueState, limit = 25, offset = 0) =>
  rpc<NewsReviewList>('admin_ai_news_review_list', {
    p_state: state,
    p_limit: limit,
    p_offset: offset,
  });

export const fetchNewsReviewDetail = (eventId: string) =>
  rpc<NewsReviewDetail>('admin_ai_news_review_get', { p_event_id: eventId });

export const reviewNewsEvent = (
  eventId: string,
  action: NewsReviewAction,
  payload: Record<string, unknown> = {},
  reason: string | null = null,
) =>
  rpc<{ ok: boolean; action: string; result: Record<string, unknown> }>(
    'admin_ai_news_review_action',
    {
      p_event_id: eventId,
      p_action: action,
      p_payload: payload,
      p_reason: reason,
    },
  );

export const retractNewsEvent = (eventId: string, reason: string) =>
  rpc<{ retracted: boolean; post_id: string }>('admin_ai_news_retract', {
    p_event_id: eventId,
    p_reason: reason,
  });

/** Yüksek riskli (C) haberi hukuki denetim gerekçesiyle elle yayımlar. */
export const publishHighRiskNews = (eventId: string, reason: string) =>
  rpc<{ ok: boolean; result: Record<string, unknown> }>('admin_ai_news_publish_high_risk', {
    p_event_id: eventId,
    p_reason: reason,
  });

export const fetchNewsSources = () => rpc<NewsSourcesResponse>('admin_ai_news_sources_list');export const saveNewsSource = (
  id: string | null,
  payload: Partial<NewsSource>,
  reason: string | null = null,
) =>
  rpc<{ id: string; domain: string }>('admin_ai_news_source_save', {
    p_id: id,
    p_payload: payload,
    p_reason: reason,
  });

export const toggleNewsSource = (id: string, active: boolean) =>
  rpc<{ ok: boolean; domain: string }>('admin_ai_news_source_toggle', {
    p_id: id,
    p_active: active,
  });

export const fetchNewsCosts = () => rpc<NewsCostSummary>('admin_ai_news_cost_summary');

export const fetchNewsErrors = (limit = 30) =>
  rpc<{ items: NewsErrorItem[] }>('admin_ai_news_errors_list', { p_limit: limit });

export const bindNewsPublisher = (username: string) =>
  rpc<Record<string, unknown>>('admin_ai_news_bind_publisher', { p_username: username });

/**
 * DeepSeek çağrıları edge function üzerinden yapılır; API anahtarı istemciye
 * inmez. Function, çağıranın yönetici olduğunu RPC ile doğrular.
 */
export async function invokeNewsAssist(
  action: NewsAssistAction,
  eventId: string,
  payload: Record<string, unknown> = {},
): Promise<Result<Record<string, unknown>>> {
  const { data, error } = await supabase.functions.invoke('ai-news-worker', {
    body: { action: 'assist', assist_action: action, payload: { ...payload, event_id: eventId } },
  });
  if (error) {
    let detail = error.message;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = (await context.json()) as { error?: string; detail?: string };
        detail = body.detail || body.error || detail;
      } catch {
        // Gövde okunamadıysa genel mesaj kullanılır.
      }
    }
    if (/forbidden|not_authenticated|admin_required/i.test(detail)) {
      return fail(appError('forbidden', 'Bu işlem için AI haber yönetici yetkisi gerekiyor.'));
    }
    return fail(appError('unknown', detail.slice(0, 240)));
  }
  if (!data || typeof data !== 'object' || (data as { ok?: boolean }).ok !== true) {
    return fail(appError('unknown', 'AI yanıtı işlenemedi.'));
  }
  return ok(data as Record<string, unknown>);
}

/** Kaynak haberi YALNIZCA yeni doğrulanmış kaynaklarla genişletir. */
export async function invokeNewsSourceEnrich(
  postId: string,
  payload: Record<string, unknown> = {},
): Promise<Result<Record<string, unknown>>> {
  const { data, error } = await supabase.functions.invoke('ai-news-worker', {
    body: { action: 'enrich_source', post_id: postId, payload },
  });
  if (error) {
    let detail = error.message;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = (await context.json()) as { error?: string; detail?: string };
        detail = body.detail || body.error || detail;
      } catch {
        // Gövde okunamadıysa genel mesaj kullanılır.
      }
    }
    if (/forbidden|not_authenticated|admin_required/i.test(detail)) {
      return fail(appError('forbidden', 'Bu işlem için AI haber yönetici yetkisi gerekiyor.'));
    }
    return fail(appError('unknown', detail.slice(0, 240)));
  }
  if (!data || typeof data !== 'object') {
    return fail(appError('unknown', 'AI yanıtı işlenemedi.'));
  }
  // enrich_source doğrulama başarısız olduğunda `ok:false` + açıklama döner.
  return ok(data as Record<string, unknown>);
}

/** Canlı DeepSeek/Search/Fetch tanılaması çalıştırır (ücretli çağrı yapar). */
export async function runNewsDiagnostics(): Promise<Result<Record<string, unknown>>> {
  const { data, error } = await supabase.functions.invoke('ai-news-worker', {
    body: { action: 'diagnostics' },
  });
  if (error) {
    return fail(appError('unknown', error.message.slice(0, 240)));
  }
  if (!data || (data as { ok?: boolean }).ok !== true) {
    return fail(appError('unknown', 'Tanılama yanıtı işlenemedi.'));
  }
  return ok(data as Record<string, unknown>);
}
