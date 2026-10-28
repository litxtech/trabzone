import type { PostgrestError } from '@supabase/supabase-js';

import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import { mapAdminError } from './admin-service';
import type {
  AdminBlogAiRun,
  AdminBlogAiSettings,
  AdminBlogListResponse,
  AdminBlogPost,
  AdminBlogSaveInput,
  AdminBlogStats,
  AiRequest,
  BlogFaq,
} from '@/features/blog/types';

export const adminBlogKeys = {
  stats: ['admin', 'blog', 'stats'] as const,
  posts: (params: unknown) => ['admin', 'blog', 'posts', params] as const,
  post: (id: string | null) => ['admin', 'blog', 'post', id ?? 'new'] as const,
  aiSettings: ['admin', 'blog', 'ai-settings'] as const,
  aiRuns: (limit: number) => ['admin', 'blog', 'ai-runs', limit] as const,
};

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return fail(mapAdminError(error as PostgrestError));
  return ok(data as unknown as T);
}

// Seed kayıtları eski {q,a} biçimini kullanabilir; editör tek biçim bekler.
function normalizeFaq(post: AdminBlogPost): AdminBlogPost {
  const faq = (Array.isArray(post.faq) ? post.faq : [])
    .map((item) => {
      const legacy = item as BlogFaq & { q?: string; a?: string };
      return {
        question: String(legacy.question ?? legacy.q ?? '').trim(),
        answer: String(legacy.answer ?? legacy.a ?? '').trim(),
      };
    })
    .filter((item) => item.question || item.answer);
  return { ...post, faq };
}

async function rpcPost(fn: string, args: Record<string, unknown>): Promise<Result<AdminBlogPost>> {
  const result = await rpc<AdminBlogPost>(fn, args);
  if (!result.ok) return result;
  return ok(normalizeFaq(result.data));
}

export const fetchAdminBlogStats = () => rpc<AdminBlogStats>('admin_blog_stats');

export const fetchAdminBlogPosts = (params: {
  search?: string;
  status?: string | null;
  category?: string | null;
  limit?: number;
  offset?: number;
}) =>
  rpc<AdminBlogListResponse>('admin_blog_posts_list', {
    p_search: params.search?.trim() ? params.search.trim() : null,
    p_status: params.status ?? null,
    p_category: params.category ?? null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  });

export const fetchAdminBlogPost = (id: string) => rpcPost('admin_blog_post_get', { p_id: id });

export const saveAdminBlogPost = (input: AdminBlogSaveInput) =>
  rpcPost('admin_blog_post_save', {
    p_id: input.id,
    p_slug: input.slug,
    p_title: input.title,
    p_excerpt: input.excerpt,
    p_body_markdown: input.body_markdown,
    p_cover_image_url: input.cover_image_url,
    p_cover_image_alt: input.cover_image_alt,
    p_category: input.category,
    p_tags: input.tags,
    p_seo_title: input.seo_title,
    p_seo_description: input.seo_description,
    p_keywords: input.keywords,
    p_faq: input.faq,
    p_author_name: input.author_name,
    p_status: input.status,
    p_is_featured: input.is_featured,
    p_publish_at: input.publish_at,
    p_ai_generated: input.ai_generated,
    p_ai_model: input.ai_model,
    p_reason: input.reason,
  });

export const setAdminBlogStatus = (
  id: string,
  status: 'draft' | 'published' | 'archived',
  publishAt: string | null,
  reason: string | null,
) =>
  rpcPost('admin_blog_post_set_status', {
    p_id: id,
    p_status: status,
    p_publish_at: publishAt,
    p_reason: reason,
  });

export const duplicateAdminBlogPost = (id: string) =>
  rpcPost('admin_blog_post_duplicate', { p_id: id });

export const deleteAdminBlogPost = (id: string, reason: string) =>
  rpc<{ deleted: boolean; id: string }>('admin_blog_post_delete', { p_id: id, p_reason: reason });

export const fetchAdminBlogAiSettings = () =>
  rpc<AdminBlogAiSettings>('admin_blog_ai_settings_get');

export const saveAdminBlogAiSettings = (input: {
  enabled: boolean;
  model: string;
  temperature: number;
  system_prompt: string;
  reason: string | null;
}) =>
  rpc<AdminBlogAiSettings>('admin_blog_ai_settings_save', {
    p_enabled: input.enabled,
    p_model: input.model,
    p_temperature: input.temperature,
    p_system_prompt: input.system_prompt,
    p_reason: input.reason,
  });

export const fetchAdminBlogAiRuns = (limit = 20) =>
  rpc<{ items: AdminBlogAiRun[] }>('admin_blog_ai_runs_list', { p_limit: limit });

/**
 * DeepSeek çağrısı edge function üzerinden yapılır; API anahtarı istemciye
 * inmez. Function, çağıranın yönetici olduğunu RPC ile doğrular.
 */
export async function invokeBlogAi(request: AiRequest): Promise<Result<Record<string, unknown>>> {
  const { data, error } = await supabase.functions.invoke('deepseek-blog', { body: request });
  if (error) {
    let detail = error.message;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const payload = (await context.json()) as { error?: string; detail?: string };
        detail = payload.detail || payload.error || detail;
      } catch {
        // Yanıt gövdesi okunamadıysa genel mesaj kullanılır.
      }
    }
    if (/deepseek_key_missing/i.test(detail)) {
      return fail(appError('unknown', 'DeepSeek API anahtarı sunucuda tanımlı değil.'));
    }
    if (/forbidden|not_authenticated/i.test(detail)) {
      return fail(appError('forbidden', 'Bu işlem için yönetici yetkisi gerekiyor.'));
    }
    return fail(appError('unknown', detail.slice(0, 240)));
  }
  if (!data || typeof data !== 'object' || (data as { ok?: boolean }).ok !== true) {
    return fail(appError('unknown', 'AI yanıtı işlenemedi.'));
  }
  return ok(data as Record<string, unknown>);
}
