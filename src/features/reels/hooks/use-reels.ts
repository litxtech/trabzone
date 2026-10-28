import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import {
  addReelComment,
  createReel,
  deleteReel,
  deleteReelComment,
  fetchReel,
  fetchReelComments,
  fetchReels,
  fetchUserReels,
  reelQueryKeys,
  registerReelView,
  shareReel,
  toggleReelLike,
  toggleReelSave,
  updateReel,
  type Reel,
  type ReelComment,
  type ReelPage,
} from '../services/reels-service';

type ReelFeed = InfiniteData<ReelPage, string | null>;

function mapFeed(data: ReelFeed | undefined, reelId: string, fn: (reel: Reel) => Reel) {
  if (!data) {
    return data;
  }
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!page.items.some((item) => item.id === reelId)) {
      return page;
    }
    changed = true;
    return {
      ...page,
      items: page.items.map((item) => (item.id === reelId ? fn(item) : item)),
    };
  });
  return changed ? { ...data, pages } : data;
}

function patchReelEverywhere(
  queryClient: ReturnType<typeof useQueryClient>,
  reelId: string,
  fn: (reel: Reel) => Reel,
) {
  queryClient.setQueriesData<ReelFeed>({ queryKey: ['reels', 'feed'] }, (data) =>
    mapFeed(data, reelId, fn),
  );
  queryClient.setQueriesData<Reel[]>({ queryKey: ['reels', 'user'] }, (data) =>
    data?.map((reel) => (reel.id === reelId ? fn(reel) : reel)),
  );
  queryClient.setQueryData<Reel | null>(reelQueryKeys.reel(reelId), (data) =>
    data ? fn(data) : data,
  );
}

export function useReelsFeed() {
  return useInfiniteQuery({
    queryKey: reelQueryKeys.feed,
    queryFn: ({ pageParam }) => unwrap(fetchReels({ cursor: pageParam })),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_cursor : undefined),
    staleTime: 30_000,
  });
}

export function useUserReels(username: string, enabled = true) {
  return useQuery({
    queryKey: reelQueryKeys.user(username),
    queryFn: () => unwrap(fetchUserReels(username)),
    enabled: enabled && username.length > 0,
    staleTime: 30_000,
  });
}

export function useReel(reelId: string) {
  return useQuery({
    queryKey: reelQueryKeys.reel(reelId),
    queryFn: () => unwrap(fetchReel(reelId)),
    enabled: Boolean(reelId),
    staleTime: 30_000,
  });
}

export function useToggleReelLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reelId: string) => unwrap(toggleReelLike(reelId)),
    onMutate: async (reelId) => {
      await queryClient.cancelQueries({ queryKey: ['reels'] });
      patchReelEverywhere(queryClient, reelId, (reel) => ({
        ...reel,
        liked: !reel.liked,
        like_count: Math.max(0, reel.like_count + (reel.liked ? -1 : 1)),
      }));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['reels'] });
    },
    onSuccess: (result, reelId) => {
      patchReelEverywhere(queryClient, reelId, (reel) => ({
        ...reel,
        liked: result.liked,
        like_count: result.like_count,
      }));
    },
  });
}

export function useToggleReelSave() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reelId: string) => unwrap(toggleReelSave(reelId)),
    onMutate: async (reelId) => {
      await queryClient.cancelQueries({ queryKey: ['reels'] });
      patchReelEverywhere(queryClient, reelId, (reel) => ({
        ...reel,
        saved: !reel.saved,
        save_count: Math.max(0, reel.save_count + (reel.saved ? -1 : 1)),
      }));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['reels'] });
    },
    onSuccess: (result, reelId) => {
      patchReelEverywhere(queryClient, reelId, (reel) => ({
        ...reel,
        saved: result.saved,
        save_count: result.save_count,
      }));
    },
  });
}

export function useShareReel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reelId: string) => unwrap(shareReel(reelId)),
    onSuccess: (shareCount, reelId) => {
      patchReelEverywhere(queryClient, reelId, (reel) => ({
        ...reel,
        share_count: shareCount || reel.share_count + 1,
      }));
    },
  });
}

export function useCreateReel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof createReel>[0]) => unwrap(createReel(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reelQueryKeys.feed });
      void queryClient.invalidateQueries({ queryKey: ['reels', 'user'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

export function useUpdateReel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof updateReel>[0]) => unwrap(updateReel(input)),
    onSuccess: (reel) => {
      patchReelEverywhere(queryClient, reel.id, () => reel);
    },
  });
}

export function useDeleteReel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reelId: string) => unwrap(deleteReel(reelId)),
    onSuccess: (_data, reelId) => {
      queryClient.setQueryData<ReelFeed>(reelQueryKeys.feed, (data) => {
        if (!data) {
          return data;
        }
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== reelId),
          })),
        };
      });
      queryClient.setQueriesData<Reel[]>({ queryKey: ['reels', 'user'] }, (data) =>
        data?.filter((reel) => reel.id !== reelId),
      );
      queryClient.removeQueries({ queryKey: reelQueryKeys.reel(reelId) });
      void queryClient.invalidateQueries({ queryKey: reelQueryKeys.feed });
    },
  });
}

export function useReelComments(reelId: string, enabled = true) {
  return useQuery({
    queryKey: reelQueryKeys.comments(reelId),
    queryFn: () => unwrap(fetchReelComments(reelId)),
    enabled: enabled && Boolean(reelId),
    staleTime: 10_000,
  });
}

export function useAddReelComment(reelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: string) => unwrap(addReelComment({ reelId, body })),
    onSuccess: (comment) => {
      queryClient.setQueryData<ReelComment[]>(reelQueryKeys.comments(reelId), (data) =>
        data ? [...data, comment] : [comment],
      );
      patchReelEverywhere(queryClient, reelId, (reel) => ({
        ...reel,
        comment_count: reel.comment_count + 1,
      }));
    },
  });
}

export function useDeleteReelComment(reelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) => unwrap(deleteReelComment(commentId)),
    onSuccess: (_data, commentId) => {
      queryClient.setQueryData<ReelComment[]>(reelQueryKeys.comments(reelId), (data) =>
        data?.filter((comment) => comment.id !== commentId),
      );
      patchReelEverywhere(queryClient, reelId, (reel) => ({
        ...reel,
        comment_count: Math.max(0, reel.comment_count - 1),
      }));
    },
  });
}

/** Goruntulenme kaydi: ayni oturumda her video icin bir kez cagrilir. */
export async function registerViewOnce(reelId: string): Promise<void> {
  await registerReelView(reelId);
}
