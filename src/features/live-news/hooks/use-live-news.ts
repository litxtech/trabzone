import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import {
  checkLiveNewsAi,
  createLiveNews,
  deleteLiveNews,
  fetchAdminLiveNews,
  fetchAdminLiveNewsDetail,
  fetchAdminLiveNewsStats,
  fetchLiveNews,
  fetchLiveNewsList,
  fetchLiveNewsPreferences,
  fetchMyLiveNews,
  invokeLiveNewsAi,
  liveNewsQueryKeys,
  logLiveNewsAi,
  runAdminLiveNewsAction,
  saveLiveNewsPreferences,
  updateLiveNews,
  type AdminLiveNewsAction,
  type AdminLiveNewsActionPayload,
} from '../services/live-news-service';
import type {
  AdminLiveNewsParams,
  LiveNewsCreateInput,
  LiveNewsListParams,
  LiveNewsNotificationPreferences,
} from '../types';

export function useLiveNewsList(params: LiveNewsListParams) {
  return useInfiniteQuery({
    queryKey: liveNewsQueryKeys.list(params),
    queryFn: ({ pageParam }) =>
      unwrap(fetchLiveNewsList({ ...params, cursor: pageParam as string | null })),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    staleTime: 20_000,
  });
}

export function useLiveNews(postId: string) {
  return useQuery({
    queryKey: liveNewsQueryKeys.detail(postId),
    queryFn: () => unwrap(fetchLiveNews(postId)),
    enabled: Boolean(postId),
    staleTime: 15_000,
  });
}

export function useMyLiveNews(limit = 20) {
  return useQuery({
    queryKey: [...liveNewsQueryKeys.mine, limit],
    queryFn: () => unwrap(fetchMyLiveNews(limit)),
    staleTime: 20_000,
  });
}

export function useCreateLiveNews() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LiveNewsCreateInput) => unwrap(createLiveNews(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['live-news'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['reels'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

export function useUpdateLiveNews() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof updateLiveNews>[0]) => unwrap(updateLiveNews(input)),
    onSuccess: (item, variables) => {
      // Detay sorgusu silinmiyor: silinirse düzenleme ekranı bir anlık
      // "yükleniyor" durumuna düşüyor ve kullanıcı kaydettiği içeriği
      // göremeden ekran değişiyordu. Güncel kayıt doğrudan önbelleğe yazılır.
      if (item) {
        queryClient.setQueryData(liveNewsQueryKeys.detail(variables.postId), item);
      }
      void queryClient.invalidateQueries({ queryKey: ['live-news', 'list'] });
      void queryClient.invalidateQueries({ queryKey: liveNewsQueryKeys.mine });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['reels'] });
    },
  });
}

export function useDeleteLiveNews() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => unwrap(deleteLiveNews(postId)),
    onSuccess: (_result, postId) => {
      // Silinen içerik bütün yüzeylerden düşer: akış, ilçe, profil, Reels, web.
      queryClient.removeQueries({ queryKey: liveNewsQueryKeys.detail(postId) });
      queryClient.removeQueries({ queryKey: liveNewsQueryKeys.adminDetail(postId) });
      void queryClient.invalidateQueries({ queryKey: ['live-news'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['reels'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

export function useLiveNewsPreferences() {
  return useQuery({
    queryKey: liveNewsQueryKeys.preferences,
    queryFn: () => unwrap(fetchLiveNewsPreferences()),
    staleTime: 60_000,
  });
}

export function useSaveLiveNewsPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LiveNewsNotificationPreferences) =>
      unwrap(saveLiveNewsPreferences(input)),
    onSuccess: (data) => {
      queryClient.setQueryData(liveNewsQueryKeys.preferences, data);
    },
  });
}

export function useAdminLiveNewsStats() {
  return useQuery({
    queryKey: liveNewsQueryKeys.adminStats,
    queryFn: () => unwrap(fetchAdminLiveNewsStats()),
    staleTime: 20_000,
  });
}

export function useAdminLiveNews(params: AdminLiveNewsParams) {
  return useQuery({
    queryKey: liveNewsQueryKeys.adminList(params),
    queryFn: () => unwrap(fetchAdminLiveNews(params)),
    staleTime: 15_000,
  });
}

export function useAdminLiveNewsDetail(postId: string | null) {
  return useQuery({
    queryKey: liveNewsQueryKeys.adminDetail(postId ?? ''),
    queryFn: () => unwrap(fetchAdminLiveNewsDetail(postId!)),
    enabled: Boolean(postId),
    staleTime: 10_000,
  });
}

export function useAdminLiveNewsAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      postId: string;
      action: AdminLiveNewsAction;
      payload?: AdminLiveNewsActionPayload;
      reason?: string | null;
    }) => unwrap(runAdminLiveNewsAction(input)),
    onSuccess: (detail) => {
      queryClient.setQueryData(liveNewsQueryKeys.adminDetail(detail.post.id), detail);
      void queryClient.invalidateQueries({ queryKey: ['live-news'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['reels'] });
    },
  });
}

export function useLiveNewsAiCheck() {
  return useMutation({
    mutationFn: () => unwrap(checkLiveNewsAi()),
  });
}

export function useLiveNewsAiLog() {
  return useMutation({
    mutationFn: (input: Parameters<typeof logLiveNewsAi>[0]) => logLiveNewsAi(input),
  });
}

export function useLiveNewsAi() {
  return useMutation({
    mutationFn: (input: Parameters<typeof invokeLiveNewsAi>[0]) => unwrap(invokeLiveNewsAi(input)),
  });
}

