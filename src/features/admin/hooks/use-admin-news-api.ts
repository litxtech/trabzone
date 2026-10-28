import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import type {
  NewsCategoryMapping,
  NewsFieldMapping,
  NewsPermissions,
  NewsSourceProfile,
} from '@/features/news-api/types';

import * as newsApi from '../services/news-api-service';
import { adminNewsApiKeys } from '../services/news-api-service';

function useInvalidateNewsApi() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['admin', 'news-api'] });
  };
}

export function useNewsApiOverview() {
  return useQuery({
    queryKey: adminNewsApiKeys.overview,
    queryFn: async () => unwrap(await newsApi.fetchNewsOverview()),
    staleTime: 20_000,
  });
}

export function useNewsApiCatalog() {
  return useQuery({
    queryKey: adminNewsApiKeys.catalog,
    queryFn: async () => unwrap(await newsApi.fetchNewsCatalog()),
    staleTime: 5 * 60_000,
  });
}

export function useNewsApiConnections(params: {
  search?: string;
  status?: string | null;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminNewsApiKeys.connections(params),
    queryFn: async () => unwrap(await newsApi.fetchNewsConnections(params)),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useNewsApiConnection(id: string | null | undefined) {
  return useQuery({
    queryKey: adminNewsApiKeys.detail(id ?? null),
    queryFn: async () => unwrap(await newsApi.fetchNewsConnection(id as string)),
    enabled: Boolean(id),
  });
}

export function useNewsApiItems(params: {
  connectionId: string;
  status?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminNewsApiKeys.items(params),
    queryFn: async () => unwrap(await newsApi.fetchNewsItems(params)),
    enabled: Boolean(params.connectionId),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useNewsApiItem(itemId: string | null) {
  return useQuery({
    queryKey: adminNewsApiKeys.item(itemId),
    queryFn: async () => unwrap(await newsApi.fetchNewsItem(itemId as string)),
    enabled: Boolean(itemId),
  });
}

export function useNewsApiDeletionPreview(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'news-api', 'deletion-preview', id ?? ''],
    queryFn: async () => unwrap(await newsApi.fetchNewsDeletionPreview(id as string)),
    enabled: Boolean(id) && enabled,
    staleTime: 10_000,
  });
}

export function useNewsApiDeletionJobs(connectionId: string | null) {
  return useQuery({
    queryKey: adminNewsApiKeys.deletions(connectionId),
    queryFn: async () => unwrap(await newsApi.fetchNewsDeletionJobs(connectionId)),
    staleTime: 10_000,
    refetchInterval: (query) => {
      const rows = query.state.data?.items ?? [];
      return rows.some((row) => row.status === 'queued' || row.status === 'running') ? 4000 : false;
    },
  });
}

export function useNewsApiDeletionJob(jobId: string | null) {
  return useQuery({
    queryKey: adminNewsApiKeys.deletionJob(jobId),
    queryFn: async () => unwrap(await newsApi.fetchNewsDeletionJob(jobId as string)),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return status === 'queued' || status === 'running' ? 3000 : false;
    },
  });
}

export function useNewsApiSettings() {
  return useQuery({
    queryKey: adminNewsApiKeys.settings,
    queryFn: async () => unwrap(await newsApi.fetchNewsSettings()),
    staleTime: 30_000,
  });
}

export function useNewsApiPublishers(search: string, enabled = true) {
  return useQuery({
    queryKey: adminNewsApiKeys.publishers(search),
    queryFn: async () => unwrap(await newsApi.fetchNewsPublisherCandidates(search)),
    staleTime: 60_000,
    enabled,
  });
}

// ---------------------------------------------------------------------------
// Mutasyonlar
// ---------------------------------------------------------------------------

export function useNewsApiSaveConnection() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: Parameters<typeof newsApi.saveNewsConnection>[0]) =>
      unwrap(await newsApi.saveNewsConnection(input)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSaveAdapter() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: Parameters<typeof newsApi.saveNewsAdapter>[0]) =>
      unwrap(await newsApi.saveNewsAdapter(input)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSaveCredentials() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: Parameters<typeof newsApi.saveNewsCredentials>[0]) =>
      unwrap(await newsApi.saveNewsCredentials(input)),
    onSuccess: invalidate,
  });
}

export function useNewsApiClearCredentials() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await newsApi.clearNewsCredentials(id)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSaveMappings() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: { id: string; rows: NewsFieldMapping[] }) =>
      unwrap(await newsApi.saveNewsFieldMappings(input.id, input.rows)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSaveCategoryMappings() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: { id: string; rows: NewsCategoryMapping[] }) =>
      unwrap(await newsApi.saveNewsCategoryMappings(input.id, input.rows)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSaveFilters() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: Parameters<typeof newsApi.saveNewsFilters>[0]) =>
      unwrap(await newsApi.saveNewsFilters(input)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSavePermissions() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      payload: Parameters<typeof newsApi.saveNewsPermissions>[1];
    }) => unwrap(await newsApi.saveNewsPermissions(input.id, input.payload)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSaveProfile() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      payload: Partial<NewsSourceProfile> & { profile_id?: string | null };
    }) => unwrap(await newsApi.saveNewsProfile(input.id, input.payload)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSetStatus() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: { id: string; status: string }) =>
      unwrap(await newsApi.setNewsConnectionStatus(input.id, input.status)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSetAutoPublish() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: { id: string; enabled: boolean }) =>
      unwrap(await newsApi.setNewsAutoPublish(input.id, input.enabled)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSetPublishMode() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: { id: string; mode: string }) =>
      unwrap(await newsApi.setNewsPublishMode(input.id, input.mode)),
    onSuccess: invalidate,
  });
}

export function useNewsApiRunRequest() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await newsApi.requestNewsRun(id)),
    onSuccess: invalidate,
  });
}

export function useNewsApiItemAction() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input:
      | { kind: 'approve'; itemId: string; note?: string | null }
      | { kind: 'reject'; itemId: string; reason: string }
      | { kind: 'remove'; itemId: string; reason: string }) => {
      if (input.kind === 'approve') return unwrap(await newsApi.approveNewsItem(input.itemId, input.note));
      if (input.kind === 'reject') return unwrap(await newsApi.rejectNewsItem(input.itemId, input.reason));
      return unwrap(await newsApi.removeNewsItem(input.itemId, input.reason));
    },
    onSuccess: invalidate,
  });
}

export function useNewsApiStartDeletion() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: Parameters<typeof newsApi.startNewsDeletion>[0]) =>
      unwrap(await newsApi.startNewsDeletion(input)),
    onSuccess: invalidate,
  });
}

export function useNewsApiRunDeletion() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (jobId: string) => unwrap(await newsApi.runNewsDeletion(jobId)),
    onSuccess: invalidate,
  });
}

export function useNewsApiSaveSettings() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (payload: Parameters<typeof newsApi.saveNewsSettings>[0]) =>
      unwrap(await newsApi.saveNewsSettings(payload)),
    onSuccess: invalidate,
  });
}

export function useNewsApiTest() {
  const invalidate = useInvalidateNewsApi();
  return useMutation({
    mutationFn: async (input: Parameters<typeof newsApi.testNewsConnection>[0]) =>
      unwrap(await newsApi.testNewsConnection(input)),
    onSuccess: invalidate,
  });
}
