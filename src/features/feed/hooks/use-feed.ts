import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import {
  addComment,
  deleteComment,
  deletePost,
  feedQueryKeys,
  fetchComments,
  fetchFeed,
  fetchPost,
  fetchProfilePosts,
  fetchSavedPosts,
  sharePost,
  togglePostLike,
  togglePostSave,
  updatePost,
  createPost,
  type FeedFilter,
  type FeedPage,
  type FeedPost,
  type PostComment,
  type PostMediaInput,
  type PostVisibility,
} from '../services/feed-service';
import { unwrap } from '@/utils/result';

type InfiniteFeed = InfiniteData<FeedPage, string | null>;

function mapPostInPages(data: InfiniteFeed | undefined, postId: string, fn: (post: FeedPost) => FeedPost) {
  if (!data) {
    return data;
  }
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!page.items.some((item) => item.id === postId)) {
      return page;
    }
    changed = true;
    return {
      ...page,
      items: page.items.map((item) => (item.id === postId ? fn(item) : item)),
    };
  });
  return changed ? { ...data, pages } : data;
}

/** Akis listelerinde (tumu/yakinimda/takip/populer) tek bir gonderiyi gunceller. */
function patchPostEverywhere(
  queryClient: ReturnType<typeof useQueryClient>,
  postId: string,
  fn: (post: FeedPost) => FeedPost,
) {
  queryClient.setQueriesData<InfiniteFeed>({ queryKey: ['feed', 'list'] }, (data) =>
    mapPostInPages(data, postId, fn),
  );

  queryClient.setQueriesData<FeedPost[]>({ queryKey: feedQueryKeys.saved }, (data) =>
    data?.map((post) => (post.id === postId ? fn(post) : post)),
  );

  queryClient.setQueriesData<FeedPost[]>({ queryKey: ['feed', 'profile'] }, (data) =>
    data?.map((post) => (post.id === postId ? fn(post) : post)),
  );

  queryClient.setQueryData<FeedPost | null>(feedQueryKeys.post(postId), (data) =>
    data ? fn(data) : data,
  );
}

export function useFeed(filter: FeedFilter, city: string | null) {
  return useInfiniteQuery({
    queryKey: feedQueryKeys.feed(filter, city),
    queryFn: ({ pageParam }) => unwrap(fetchFeed({ filter, city, cursor: pageParam })),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_cursor : undefined),
    staleTime: 30_000,
  });
}

export function usePost(postId: string) {
  return useQuery({
    queryKey: feedQueryKeys.post(postId),
    queryFn: () => unwrap(fetchPost(postId)),
    enabled: Boolean(postId),
    staleTime: 15_000,
  });
}

export function useSavedPosts() {
  return useQuery({
    queryKey: feedQueryKeys.saved,
    queryFn: () => unwrap(fetchSavedPosts()),
    staleTime: 30_000,
  });
}

export function useProfilePosts(
  username: string,
  kind: 'posts' | 'media' | 'news' = 'posts',
  limit = 18,
) {
  return useQuery({
    queryKey: feedQueryKeys.profile(username, kind),
    queryFn: () => unwrap(fetchProfilePosts({ username, kind, limit })),
    enabled: Boolean(username),
    staleTime: 30_000,
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      body: string | null;
      media: PostMediaInput[];
      visibility: PostVisibility;
      city: string | null;
    }) => unwrap(createPost(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feed', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['feed', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { postId: string; body: string | null; visibility?: PostVisibility }) =>
      unwrap(updatePost(input)),
    onSuccess: (post) => {
      patchPostEverywhere(queryClient, post.id, () => post);
      void queryClient.invalidateQueries({ queryKey: ['feed', 'list'] });
    },
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => unwrap(deletePost(postId)),
    onSuccess: (_data, postId) => {
      queryClient.setQueriesData<InfiniteFeed>({ queryKey: ['feed', 'list'] }, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== postId),
          })),
        };
      });
      queryClient.setQueriesData<FeedPost[]>({ queryKey: feedQueryKeys.saved }, (data) =>
        data?.filter((post) => post.id !== postId),
      );
      queryClient.setQueriesData<FeedPost[]>({ queryKey: ['feed', 'profile'] }, (data) =>
        data?.filter((post) => post.id !== postId),
      );
      queryClient.removeQueries({ queryKey: feedQueryKeys.post(postId) });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

export function useTogglePostLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => unwrap(togglePostLike(postId)),
    onMutate: async (postId) => {
      await queryClient.cancelQueries({ queryKey: ['feed'] });

      patchPostEverywhere(queryClient, postId, (post) => ({
        ...post,
        liked: !post.liked,
        like_count: Math.max(0, post.like_count + (post.liked ? -1 : 1)),
      }));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
    onSuccess: (result, postId) => {
      patchPostEverywhere(queryClient, postId, (post) => ({
        ...post,
        liked: result.liked,
        like_count: result.like_count,
      }));
    },
  });
}

export function useTogglePostSave() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => unwrap(togglePostSave(postId)),
    onMutate: async (postId) => {
      await queryClient.cancelQueries({ queryKey: ['feed'] });
      patchPostEverywhere(queryClient, postId, (post) => ({ ...post, saved: !post.saved }));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
    onSuccess: (result, postId) => {
      patchPostEverywhere(queryClient, postId, (post) => ({ ...post, saved: result.saved }));
      void queryClient.invalidateQueries({ queryKey: feedQueryKeys.saved });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

export function useSharePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => unwrap(sharePost(postId)),
    onSuccess: (_data, postId) => {
      patchPostEverywhere(queryClient, postId, (post) => ({
        ...post,
        share_count: post.share_count + 1,
      }));
    },
  });
}

export function useComments(postId: string, enabled = true) {
  return useQuery({
    queryKey: feedQueryKeys.comments(postId),
    queryFn: () => unwrap(fetchComments(postId)),
    enabled: enabled && Boolean(postId),
    staleTime: 10_000,
  });
}

export function useAddComment(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { body: string; parentId?: string | null }) =>
      unwrap(addComment({ postId, ...input })),
    onSuccess: (comment) => {
      queryClient.setQueryData<PostComment[]>(feedQueryKeys.comments(postId), (data) =>
        data ? [...data, comment] : [comment],
      );
      patchPostEverywhere(queryClient, postId, (post) => ({
        ...post,
        comment_count: post.comment_count + 1,
      }));
    },
  });
}

export function useDeleteComment(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) => unwrap(deleteComment(commentId)),
    onSuccess: (_data, commentId) => {
      queryClient.setQueryData<PostComment[]>(feedQueryKeys.comments(postId), (data) =>
        data?.filter((comment) => comment.id !== commentId),
      );
      patchPostEverywhere(queryClient, postId, (post) => ({
        ...post,
        comment_count: Math.max(0, post.comment_count - 1),
      }));
    },
  });
}
