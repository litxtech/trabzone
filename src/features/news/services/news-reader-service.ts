import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type { NewsDetail, NewsRelatedItem } from '../types';

/** Tam haber metni (gövde, kaynaklar, medya ve etkileşim sayaçları). */
export async function fetchNewsDetail(postId: string): Promise<Result<NewsDetail | null>> {
  if (!postId) return ok(null);

  const { data, error } = await supabase.rpc('news_post_detail', { p_post_id: postId });
  if (error) {
    return fail(appError('network'));
  }

  return ok((data as NewsDetail | null) ?? null);
}

/** Aynı kategori/ilçedeki gerçekten ilgili haberler. */
export async function fetchNewsRelated(
  postId: string,
  limit = 6,
): Promise<Result<NewsRelatedItem[]>> {
  if (!postId) return ok([]);

  const { data, error } = await supabase.rpc('news_related_posts', {
    p_post_id: postId,
    p_limit: limit,
  });
  if (error) {
    return fail(appError('network'));
  }

  return ok(Array.isArray(data) ? (data as NewsRelatedItem[]) : []);
}

/** Kurumsal haber hesabı bildirim tercihi. */
export async function setNewsNotifications(enabled: boolean): Promise<Result<boolean>> {
  const { data, error } = await supabase.rpc('news_notifications_set', { p_enabled: enabled });
  if (error) {
    return fail(appError('network'));
  }

  const payload = data as { news_notifications?: boolean } | null;
  return ok(payload?.news_notifications !== false);
}
