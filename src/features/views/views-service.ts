import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  AdminViewAnalytics,
  ViewContentType,
  ViewCountResult,
  ViewRegisterResult,
  ViewRegistration,
  ViewSettings,
  ViewOwnerStats,
} from './types';

export const viewKey = (type: ViewContentType, id: string) => `${type}:${id}`;

const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Görünürlük eşiğini geçen içerikleri tek turda kaydeder.
 * Sunucu; oturum, erişim, sahiplik, hız limiti ve tekilliği doğrular.
 */
export async function registerContentViews(
  items: ViewRegistration[],
): Promise<Result<ViewRegisterResult[]>> {
  if (items.length === 0) {
    return ok([]);
  }
  const { data, error } = await supabase.rpc('content_register_views', {
    p_views: items.slice(0, 20).map((item) => ({
      type: item.type,
      id: item.id,
      surface: item.surface ?? null,
    })),
  });

  if (error) {
    return fail(rpcError(error));
  }

  const rows = ((data as { items?: unknown[] } | null)?.items ?? []) as Record<string, unknown>[];
  return ok(
    rows.map((row) => ({
      counted: Boolean(row.counted),
      reason: typeof row.reason === 'string' ? row.reason : null,
      uniqueViews: asNumber(row.unique_views),
    })),
  );
}

/** Önceden hesaplanmış sayaç özetini toplu okur. */
export async function fetchContentViewCounts(
  items: { type: ViewContentType; id: string }[],
): Promise<Result<ViewCountResult[]>> {
  if (items.length === 0) {
    return ok([]);
  }
  const { data, error } = await supabase.rpc('content_view_counts', {
    p_items: items.slice(0, 60).map((item) => ({ type: item.type, id: item.id })),
  });

  if (error) {
    return fail(rpcError(error));
  }

  const rows = ((data as { items?: unknown[] } | null)?.items ?? []) as Record<string, unknown>[];
  return ok(
    rows.map((row) => ({
      type: String(row.content_type ?? '') as ViewContentType,
      id: String(row.content_id ?? ''),
      uniqueViews: asNumber(row.unique_views),
      legacyViews: asNumber(row.legacy_views),
    })),
  );
}

export async function fetchViewSettings(): Promise<Result<ViewSettings | null>> {
  const { data, error } = await supabase.rpc('admin_view_settings');
  if (error) {
    return fail(rpcError(error));
  }
  return ok((data as ViewSettings | null) ?? null);
}

/**
 * İstemci eşikleri için ayar okur. `admin_view_settings` yönetici yetkisi
 * istediği için doğrudan tablo okunur; tabloda yalnızca SELECT politikası var
 * ve yazma yetkisi kimseye verilmedi.
 */
export async function fetchPublicViewSettings(): Promise<Result<Partial<ViewSettings> | null>> {
  const { data, error } = await supabase
    .from('view_count_settings')
    .select(
      'min_visible_ratio, min_visible_ms, video_min_play_ms, batch_window_ms, rate_limit_per_minute, daily_active_retention_days, enabled, updated_at',
    )
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    return fail(rpcError(error));
  }
  return ok((data as Partial<ViewSettings> | null) ?? null);
}

export async function fetchOwnViewStats(
  type: ViewContentType,
  id: string,
): Promise<Result<ViewOwnerStats | null>> {
  const { data, error } = await supabase.rpc('content_view_owner_stats', {
    p_content_type: type,
    p_content_id: id,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok((data as ViewOwnerStats | null) ?? null);
}

export async function fetchAdminViewAnalytics(): Promise<Result<AdminViewAnalytics>> {
  const { data, error } = await supabase.rpc('admin_view_analytics');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as AdminViewAnalytics);
}

export async function updateAdminViewSettings(
  settings: Partial<ViewSettings>,
): Promise<Result<ViewSettings>> {
  const { data, error } = await supabase.rpc('admin_view_settings_update', {
    p_settings: settings,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as ViewSettings);
}
