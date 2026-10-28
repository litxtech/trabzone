import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AdminBlogSaveInput, AiRequest } from '@/features/blog/types';
import { unwrap } from '@/utils/result';

import * as blog from '../services/blog-service';
import { adminBlogKeys } from '../services/blog-service';

export function useAdminBlogStats() {
  return useQuery({
    queryKey: adminBlogKeys.stats,
    queryFn: async () => unwrap(await blog.fetchAdminBlogStats()),
    staleTime: 30_000,
  });
}

export function useAdminBlogPosts(params: {
  search?: string;
  status?: string | null;
  category?: string | null;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminBlogKeys.posts(params),
    queryFn: async () => unwrap(await blog.fetchAdminBlogPosts(params)),
    placeholderData: (previous) => previous,
    staleTime: 20_000,
  });
}

export function useAdminBlogPost(id: string | null | undefined) {
  return useQuery({
    queryKey: adminBlogKeys.post(id ?? null),
    queryFn: async () => unwrap(await blog.fetchAdminBlogPost(id as string)),
    enabled: Boolean(id),
  });
}

export function useAdminBlogAiSettings() {
  return useQuery({
    queryKey: adminBlogKeys.aiSettings,
    queryFn: async () => unwrap(await blog.fetchAdminBlogAiSettings()),
    staleTime: 60_000,
  });
}

export function useAdminBlogAiRuns(limit = 12) {
  return useQuery({
    queryKey: adminBlogKeys.aiRuns(limit),
    queryFn: async () => unwrap(await blog.fetchAdminBlogAiRuns(limit)),
    staleTime: 30_000,
  });
}

function useInvalidateBlog() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['admin', 'blog'] });
    void client.invalidateQueries({ queryKey: ['blog'] });
  };
}

export function useAdminBlogSave() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: async (input: AdminBlogSaveInput) => unwrap(await blog.saveAdminBlogPost(input)),
    onSuccess: invalidate,
  });
}

export function useAdminBlogStatus() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: 'draft' | 'published' | 'archived';
      publishAt?: string | null;
      reason?: string | null;
    }) =>
      unwrap(
        await blog.setAdminBlogStatus(
          input.id,
          input.status,
          input.publishAt ?? null,
          input.reason ?? null,
        ),
      ),
    onSuccess: invalidate,
  });
}

export function useAdminBlogDuplicate() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await blog.duplicateAdminBlogPost(id)),
    onSuccess: invalidate,
  });
}

export function useAdminBlogDelete() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) =>
      unwrap(await blog.deleteAdminBlogPost(input.id, input.reason)),
    onSuccess: invalidate,
  });
}

export function useAdminBlogAiSettingsSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      enabled: boolean;
      model: string;
      temperature: number;
      system_prompt: string;
      reason: string | null;
    }) => unwrap(await blog.saveAdminBlogAiSettings(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminBlogKeys.aiSettings });
      void client.invalidateQueries({ queryKey: ['admin', 'blog'] });
    },
  });
}

/** DeepSeek edge function çağrısı; hata mesajı Result içinde döner. */
export function useBlogAi() {
  return useMutation({
    mutationFn: async (request: AiRequest) => unwrap(await blog.invokeBlogAi(request)),
  });
}
