import { useQuery } from '@tanstack/react-query';

import { blogKeys, fetchBlogList, fetchBlogPost } from '../services/blog-service';

export function useBlogList(params: {
  limit?: number;
  offset?: number;
  category?: string | null;
  search?: string;
}) {
  return useQuery({
    queryKey: blogKeys.list({
      limit: params.limit ?? 12,
      offset: params.offset ?? 0,
      category: params.category ?? null,
      search: params.search ?? '',
    }),
    queryFn: () => fetchBlogList(params),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useBlogPost(slug: string | null | undefined) {
  return useQuery({
    queryKey: blogKeys.post(slug ?? 'none'),
    queryFn: () => fetchBlogPost(slug as string),
    enabled: Boolean(slug),
    staleTime: 15_000,
  });
}
