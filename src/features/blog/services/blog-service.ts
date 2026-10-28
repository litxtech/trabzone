import { supabase } from '@/services/supabase/client';

import type { BlogFaq, BlogListResponse, BlogPost } from '../types';

export const blogKeys = {
  list: (params: { limit: number; offset: number; category: string | null; search: string }) =>
    ['blog', 'list', params] as const,
  post: (slug: string) => ['blog', 'post', slug] as const,
};

export async function fetchBlogList(params: {
  limit?: number;
  offset?: number;
  category?: string | null;
  search?: string;
}): Promise<BlogListResponse> {
  const { data, error } = await supabase.rpc('blog_public_list' as never, {
    p_limit: params.limit ?? 12,
    p_offset: params.offset ?? 0,
    p_category: params.category ?? null,
    p_search: params.search?.trim() ? params.search.trim() : null,
  } as never);
  if (error) throw error;
  return (data ?? { items: [], total: 0, limit: 12, offset: 0, categories: [] }) as BlogListResponse;
}

export async function fetchBlogPost(slug: string): Promise<BlogPost | null> {
  const { data, error } = await supabase.rpc('blog_public_post' as never, {
    p_slug: slug,
  } as never);
  if (error) throw error;
  if (!data) return null;
  const post = data as BlogPost;
  // Eski kayıtlarda SSS alanları {q,a} olabilir; istemci tek biçim bekler.
  const faq = (Array.isArray(post.faq) ? post.faq : [])
    .map((item) => {
      const legacy = item as BlogFaq & { q?: string; a?: string };
      return {
        question: String(legacy.question ?? legacy.q ?? '').trim(),
        answer: String(legacy.answer ?? legacy.a ?? '').trim(),
      };
    })
    .filter((item) => item.question && item.answer);
  return { ...post, faq };
}

/**
 * Görüntüleme sayacı: aynı oturumda aynı yazı için bir kez artırılır. Bu
 * istemci tarafı bir ölçümdür; bot trafiği sunucuda sayılmaz.
 */
export function trackBlogView(slug: string): void {
  if (typeof window === 'undefined' || !slug) return;
  try {
    const key = `tz:blog-view:${slug}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Gizli modda sessionStorage kapalı olabilir; sayaç yine denenir.
  }
  void supabase.rpc('blog_track_view' as never, { p_slug: slug } as never).then(
    () => undefined,
    () => undefined,
  );
}
