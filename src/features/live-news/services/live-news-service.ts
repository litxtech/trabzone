import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  AdminLiveNewsDetail,
  AdminLiveNewsListItem,
  AdminLiveNewsParams,
  LiveNewsCategory,
  LiveNewsCreateInput,
  LiveNewsCreateResult,
  LiveNewsItem,
  LiveNewsListParams,
  LiveNewsNotificationPreferences,
  LiveNewsPage,
  LiveNewsTarget,
  LiveNewsVerificationStatus,
} from '../types';

// -----------------------------------------------------------------------------
// Sabitler
// -----------------------------------------------------------------------------

/** `public.live_news_districts()` ile birebir aynı liste. */
export const LIVE_NEWS_DISTRICTS = [
  'Akçaabat',
  'Araklı',
  'Arsin',
  'Beşikdüzü',
  'Çarşıbaşı',
  'Çaykara',
  'Dernekpazarı',
  'Düzköy',
  'Hayrat',
  'Köprübaşı',
  'Maçka',
  'Of',
  'Ortahisar',
  'Sürmene',
  'Şalpazarı',
  'Tonya',
  'Vakfıkebir',
  'Yomra',
] as const;

export const LIVE_NEWS_CATEGORIES: {
  key: LiveNewsCategory;
  label: string;
  icon: string;
}[] = [
  { key: 'guncel', label: 'Güncel', icon: 'newspaper-outline' },
  { key: 'trafik', label: 'Trafik & Ulaşım', icon: 'car-outline' },
  { key: 'hava', label: 'Hava Durumu', icon: 'cloudy-outline' },
  { key: 'etkinlik', label: 'Etkinlik', icon: 'calendar-outline' },
  { key: 'spor', label: 'Spor', icon: 'football-outline' },
  { key: 'guvenlik', label: 'Güvenlik', icon: 'shield-outline' },
  { key: 'altyapi', label: 'Altyapı', icon: 'construct-outline' },
];

export const LIVE_NEWS_FILTERS: { key: LiveNewsListParams['filter']; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'nearby', label: 'Yakınımda' },
  { key: 'trabzon', label: 'Trabzon Geneli' },
  { key: 'districts', label: 'İlçeler' },
  { key: 'traffic', label: 'Trafik & Ulaşım' },
  { key: 'weather', label: 'Hava Durumu' },
  { key: 'event', label: 'Etkinlik' },
  { key: 'sports', label: 'Spor' },
  { key: 'current', label: 'Güncel' },
];

export const LIVE_NEWS_VERIFICATION_LABELS: Record<LiveNewsVerificationStatus, string> = {
  citizen: 'Vatandaş Paylaşımı',
  reviewing: 'İnceleniyor',
  verified: 'Bilgiler Doğrulandı',
  corrected: 'Düzeltildi',
  unverified: 'Doğrulanamadı',
  removed: 'Kaldırıldı',
};

export function categoryLabel(category: string): string {
  return LIVE_NEWS_CATEGORIES.find((item) => item.key === category)?.label ?? 'Güncel';
}

export const liveNewsQueryKeys = {
  list: (params: LiveNewsListParams) => ['live-news', 'list', params] as const,
  detail: (postId: string) => ['live-news', 'detail', postId] as const,
  mine: ['live-news', 'mine'] as const,
  preferences: ['live-news', 'preferences'] as const,
  adminStats: ['live-news', 'admin', 'stats'] as const,
  adminList: (params: AdminLiveNewsParams) => ['live-news', 'admin', 'list', params] as const,
  adminDetail: (postId: string) => ['live-news', 'admin', 'detail', postId] as const,
};

// -----------------------------------------------------------------------------
// Oluşturma / güncelleme / silme
// -----------------------------------------------------------------------------

export async function createLiveNews(
  input: LiveNewsCreateInput,
): Promise<Result<LiveNewsCreateResult>> {
  const { data, error } = await supabase.rpc('live_news_create', {
    p_title: input.title,
    p_summary: input.summary,
    p_category: input.category,
    p_district: input.district,
    p_media: input.media,
    p_publish_targets: input.publishTargets ?? ['feed', 'live', 'web'],
    p_location_precision: input.locationPrecision ?? 'district',
    p_lat: input.latitude ?? null,
    p_lng: input.longitude ?? null,
    p_usage_consent: input.usageConsent ?? false,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const post = data as LiveNewsItem | null;
  const meta = post?.live_news;
  if (!post?.id || !meta) {
    return fail(appError('unknown'));
  }

  return ok({
    post_id: post.id,
    canonical_id: meta.canonical_id,
    moderation_status: meta.moderation_status,
    verification_status: meta.verification_status,
    risk_level: (meta.risk_level ?? 'low') as LiveNewsCreateResult['risk_level'],
    risk_flags: meta.risk_flags ?? [],
    reel_id: meta.reel_id,
    published_at: meta.published_at,
    idempotent: Boolean((data as { idempotent?: boolean } | null)?.idempotent),
  });
}

export async function updateLiveNews(input: {
  postId: string;
  title: string;
  summary: string | null;
  category: LiveNewsCategory;
  district: string | null;
  publishTargets?: LiveNewsTarget[];
  usageConsent?: boolean;
}): Promise<Result<LiveNewsItem>> {
  const { data, error } = await supabase.rpc('live_news_update', {
    p_post_id: input.postId,
    p_title: input.title,
    p_summary: input.summary,
    p_category: input.category,
    p_district: input.district,
    p_publish_targets: input.publishTargets ?? null,
    p_usage_consent: input.usageConsent ?? null,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as LiveNewsItem);
}

export type DeletedLiveNewsMedia = {
  storage_path: string;
  thumbnail_path: string | null;
  media_type: 'image' | 'video';
};

export async function deleteLiveNews(postId: string): Promise<
  Result<{
    media: DeletedLiveNewsMedia[];
    reel: { video_path?: string; cover_path?: string; storage_bucket?: string } | null;
  }>
> {
  const { data, error } = await supabase.rpc('live_news_delete', { p_post_id: postId });
  if (error) {
    return fail(rpcError(error));
  }

  const payload = (data ?? {}) as {
    media?: DeletedLiveNewsMedia[];
    reel?: { video_path?: string; cover_path?: string; storage_bucket?: string };
  };
  return ok({ media: payload.media ?? [], reel: payload.reel ?? null });
}

// -----------------------------------------------------------------------------
// Okuma
// -----------------------------------------------------------------------------

export async function fetchLiveNewsList(
  params: LiveNewsListParams,
): Promise<Result<LiveNewsPage>> {
  const { data, error } = await supabase.rpc('live_news_list', {
    p_filter: params.filter ?? 'all',
    p_district: params.district ?? null,
    p_category: params.category ?? null,
    p_lat: params.lat ?? null,
    p_lng: params.lng ?? null,
    p_radius_km: params.radiusKm ?? 25,
    p_cursor: params.cursor ?? null,
    p_limit: params.limit ?? 12,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const page = (data ?? {}) as LiveNewsPage;
  return ok({
    items: page.items ?? [],
    next_cursor: page.next_cursor ?? null,
    has_more: Boolean(page.has_more),
    latest_at: page.latest_at ?? null,
    requires_location: Boolean(page.requires_location),
  });
}

export async function fetchLiveNews(postId: string): Promise<Result<LiveNewsItem | null>> {
  const { data, error } = await supabase.rpc('live_news_get', { p_post_id: postId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok((data as LiveNewsItem | null) ?? null);
}

export async function fetchMyLiveNews(
  limit = 20,
  offset = 0,
): Promise<Result<LiveNewsItem[]>> {
  const { data, error } = await supabase.rpc('live_news_mine', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    return fail(rpcError(error));
  }
  const payload = (data ?? {}) as { items?: LiveNewsItem[] };
  return ok(payload.items ?? []);
}

// -----------------------------------------------------------------------------
// Bildirim tercihleri
// -----------------------------------------------------------------------------

export async function fetchLiveNewsPreferences(): Promise<
  Result<LiveNewsNotificationPreferences>
> {
  const { data, error } = await supabase.rpc('live_news_preferences_get');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as LiveNewsNotificationPreferences);
}

export async function saveLiveNewsPreferences(
  input: LiveNewsNotificationPreferences,
): Promise<Result<LiveNewsNotificationPreferences>> {
  const { data, error } = await supabase.rpc('live_news_preferences_save', {
    p_followed_people: input.followed_people,
    p_district_updates: input.district_updates,
    p_verified_only: input.verified_only,
    p_district: input.district,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as LiveNewsNotificationPreferences);
}

// -----------------------------------------------------------------------------
// Admin
// -----------------------------------------------------------------------------

export async function fetchAdminLiveNewsStats(): Promise<Result<Record<string, number>>> {
  const { data, error } = await supabase.rpc('admin_live_news_stats');
  if (error) {
    return fail(rpcError(error));
  }
  return ok((data ?? {}) as Record<string, number>);
}

export async function fetchAdminLiveNews(
  params: AdminLiveNewsParams,
): Promise<Result<{ items: AdminLiveNewsListItem[]; total: number }>> {
  const { data, error } = await supabase.rpc('admin_live_news_list', {
    p_state: params.state ?? 'all',
    p_district: params.district ?? null,
    p_category: params.category ?? null,
    p_query: params.query ?? null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });
  if (error) {
    return fail(rpcError(error));
  }
  const payload = (data ?? {}) as { items?: AdminLiveNewsListItem[]; total?: number };
  return ok({ items: payload.items ?? [], total: payload.total ?? 0 });
}

export async function fetchAdminLiveNewsDetail(
  postId: string,
): Promise<Result<AdminLiveNewsDetail | null>> {
  const { data, error } = await supabase.rpc('admin_live_news_detail', { p_post_id: postId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok((data as AdminLiveNewsDetail | null) ?? null);
}

export type AdminLiveNewsAction =
  | 'approve'
  | 'hide'
  | 'remove'
  | 'request_correction'
  | 'set_verification'
  | 'send_to_newsroom'
  | 'request_evidence'
  | 'notify_user'
  | 'sanction_user';

export type AdminLiveNewsActionPayload = {
  status?: LiveNewsVerificationStatus;
  note?: string;
  message?: string;
  force?: boolean;
  sanction?: 'warn' | 'suspend' | 'restrict';
  days?: number;
};

export async function runAdminLiveNewsAction(input: {
  postId: string;
  action: AdminLiveNewsAction;
  payload?: AdminLiveNewsActionPayload;
  reason?: string | null;
}): Promise<Result<AdminLiveNewsDetail>> {
  const { data, error } = await supabase.rpc('admin_live_news_action', {
    p_post_id: input.postId,
    p_action: input.action,
    p_payload: input.payload ?? {},
    p_reason: input.reason ?? null,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as AdminLiveNewsDetail);
}

/** AI kotasını ve oturum uygunluğunu doğrular; model çağrısı Edge Function'da. */
export async function checkLiveNewsAi(): Promise<Result<{ ok: boolean; model: string }>> {
  const { data, error } = await supabase.rpc('live_news_ai_check');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as { ok: boolean; model: string });
}

export async function logLiveNewsAi(input: {
  action: string;
  model?: string | null;
  ok?: boolean;
  errorCode?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  durationMs?: number | null;
}): Promise<void> {
  await supabase.rpc('live_news_ai_log', {
    p_action: input.action,
    p_model: input.model ?? null,
    p_ok: input.ok ?? true,
    p_error_code: input.errorCode ?? null,
    p_tokens_in: input.tokensIn ?? null,
    p_tokens_out: input.tokensOut ?? null,
    p_duration_ms: input.durationMs ?? null,
  });
}

export type LiveNewsAiAction = 'polish' | 'title' | 'category' | 'district';

export type LiveNewsAiResult = {
  title?: string;
  summary?: string;
  notes?: string[];
  titles?: string[];
  category?: LiveNewsCategory;
  district?: string | null;
  confidence?: 'low' | 'medium' | 'high';
  reason?: string;
};

/**
 * DeepSeek çağrısı Edge Function üzerinden yapılır; API anahtarı istemciye
 * inmez. Function önce `live_news_ai_check` ile oturum ve kotayı doğrular.
 */
export async function invokeLiveNewsAi(input: {
  action: LiveNewsAiAction;
  title: string;
  summary: string;
  district?: string | null;
  mediaKind?: string;
}): Promise<Result<LiveNewsAiResult>> {
  const { data, error } = await supabase.functions.invoke<LiveNewsAiResult & { ok?: boolean }>(
    'deepseek-live-news',
    {
      body: {
        action: input.action,
        title: input.title,
        summary: input.summary,
        district: input.district ?? null,
        mediaKind: input.mediaKind ?? 'text',
      },
    },
  );

  if (error) {
    let detail = error.message;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const payload = (await context.json()) as { error?: string; detail?: string };
        detail = payload.detail || payload.error || detail;
      } catch {
        // Gövde okunamazsa genel mesaj.
      }
    }
    if (/rate_limited|429/.test(detail)) {
      return fail(
        appError('rate_limited', 'AI asistanı için saatlik sınıra ulaştın. Biraz sonra tekrar dene.'),
      );
    }
    if (/deepseek_key_missing|503/.test(detail)) {
      return fail(appError('unknown', 'AI asistanı henüz yapılandırılmadı.'));
    }
    return fail(appError('unknown', 'AI asistanı yanıt veremedi. Tekrar dene.'));
  }

  if (!data || data.ok === false) {
    return fail(appError('unknown', 'AI yanıtı işlenemedi.'));
  }
  return ok(data);
}

