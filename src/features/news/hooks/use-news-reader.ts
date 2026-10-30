import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import { fetchNewsDetail, fetchNewsRelated, setNewsNotifications } from '../services/news-reader-service';

export const newsReaderKeys = {
  detail: (postId: string) => ['news', 'detail', postId] as const,
  related: (postId: string) => ['news', 'related', postId] as const,
  notifications: ['news', 'notifications'] as const,
};

export function useNewsDetail(postId: string, enabled = true) {
  return useQuery({
    queryKey: newsReaderKeys.detail(postId),
    queryFn: () => unwrap(fetchNewsDetail(postId)),
    // Normal gönderilerde `news_post_detail` ağır bir RPC'dir; detay ekranı
    // haber olmadığı bilindiğinde bu çağrıyı hiç yapmaz.
    enabled: enabled && postId.length > 0,
    staleTime: 60_000,
  });
}

export function useNewsRelated(postId: string, enabled = true) {
  return useQuery({
    queryKey: newsReaderKeys.related(postId),
    queryFn: () => unwrap(fetchNewsRelated(postId, 6)),
    enabled: enabled && postId.length > 0,
    staleTime: 120_000,
  });
}

export function useNewsNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => unwrap(setNewsNotifications(enabled)),
    onSuccess: (enabled) => {
      queryClient.setQueryData<boolean>(newsReaderKeys.notifications, enabled);
      void queryClient.invalidateQueries({ queryKey: ['profile-view'] });
    },
  });
}
