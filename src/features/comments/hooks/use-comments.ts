import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { subscribeSportsLive } from '@/features/sports/realtime';
import { supabase } from '@/services/supabase/client';
import { postgresChannel } from '@/services/supabase/realtime';
import { useSession } from '@/stores/auth-store';
import { unwrap } from '@/utils/result';

import {
  addComment,
  deleteComment,
  fetchCommentPage,
  fetchCommentReplies,
  toggleCommentLike,
  updateComment,
} from '../services/comment-service';
import {
  commentQueryKeys,
  type CommentContentType,
  type CommentMediaInput,
  type CommentNode,
  type CommentPage,
} from '../types';

type CommentsData = InfiniteData<CommentPage, number>;

function patchComment(
  data: CommentsData | undefined,
  commentId: string,
  fn: (comment: CommentNode) => CommentNode,
): CommentsData | undefined {
  if (!data) {
    return data;
  }
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const items = page.items.map((comment) => {
      if (comment.id === commentId) {
        pageChanged = true;
        return fn(comment);
      }
      let replyChanged = false;
      const replies = comment.replies.map((reply) => {
        if (reply.id === commentId) {
          replyChanged = true;
          return fn(reply);
        }
        return reply;
      });
      if (replyChanged) {
        pageChanged = true;
        return { ...comment, replies };
      }
      return comment;
    });
    if (!pageChanged) {
      return page;
    }
    changed = true;
    return { ...page, items };
  });
  return changed ? { ...data, pages } : data;
}

function removeCommentFromData(
  data: CommentsData | undefined,
  commentId: string,
): CommentsData | undefined {
  if (!data) {
    return data;
  }
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items
        .filter((comment) => comment.id !== commentId)
        .map((comment) => ({
          ...comment,
          replies: comment.replies.filter((reply) => reply.id !== commentId),
        })),
    })),
  };
}

function replaceComment(data: CommentsData | undefined, tempId: string, next: CommentNode) {
  if (!data) {
    return data;
  }
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((comment) => {
        if (comment.id === tempId) {
          return { ...next, replies: next.replies ?? [] };
        }
        const index = comment.replies.findIndex((reply) => reply.id === tempId);
        if (index >= 0) {
          const replies = [...comment.replies];
          replies[index] = next;
          return { ...comment, replies };
        }
        return comment;
      }),
    })),
  };
}

/**
 * Genişletilmiş yanıt listeleri ayrı sorgularda tutulur; beğeni, düzenleme ve
 * silme işlemleri yalnızca ana listeyi yamalarsa yanıt satırı eski kalır.
 * Bu yardımcı, açık tüm yanıt önbelleklerini aynı işlemle günceller.
 */
function patchReplyCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  contentType: CommentContentType,
  commentId: string,
  fn: (comment: CommentNode) => CommentNode | null,
) {
  queryClient.setQueriesData<CommentNode[]>(
    { queryKey: ['comments', 'replies', contentType] },
    (data) => {
      if (!data) {
        return data;
      }
      let changed = false;
      const next = data.flatMap((reply) => {
        if (reply.id !== commentId) {
          return [reply];
        }
        changed = true;
        const patched = fn(reply);
        return patched ? [patched] : [];
      });
      return changed ? next : data;
    },
  );
}

/** Feed ve Reels sayaçlarını yorum ekleme/silmeye göre yerinde günceller. */
function patchContentCommentCount(
  queryClient: ReturnType<typeof useQueryClient>,
  contentType: CommentContentType,
  contentId: string,
  delta: number,
) {
  const apply = (item: { id: string; comment_count: number }) =>
    item.id === contentId
      ? { ...item, comment_count: Math.max(0, item.comment_count + delta) }
      : item;

  if (contentType === 'match') {
    return;
  }

  if (contentType === 'post') {
    queryClient.setQueriesData<{ pages: { items: { id: string; comment_count: number }[] }[] }>(
      { queryKey: ['feed', 'list'] },
      (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({ ...page, items: page.items.map(apply) })),
            }
          : data,
    );
    queryClient.setQueriesData<{ id: string; comment_count: number }[]>(
      { queryKey: ['feed', 'saved'] },
      (data) => data?.map(apply),
    );
    queryClient.setQueriesData<{ id: string; comment_count: number }[]>(
      { queryKey: ['feed', 'profile'] },
      (data) => data?.map(apply),
    );
    queryClient.setQueryData<{ id: string; comment_count: number }>(
      ['feed', 'post', contentId],
      (data) => (data ? apply(data) : data),
    );
    return;
  }

  queryClient.setQueriesData<{ pages: { items: { id: string; comment_count: number }[] }[] }>(
    { queryKey: ['reels', 'feed'] },
    (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({ ...page, items: page.items.map(apply) })),
          }
        : data,
  );
  queryClient.setQueriesData<{ id: string; comment_count: number }[]>(
    { queryKey: ['reels', 'user'] },
    (data) => data?.map(apply),
  );
  queryClient.setQueryData<{ id: string; comment_count: number }>(
    ['reels', 'reel', contentId],
    (data) => (data ? apply(data) : data),
  );
}

export function useComments(
  contentType: CommentContentType,
  contentId: string,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: commentQueryKeys.list(contentType, contentId),
    queryFn: ({ pageParam }) =>
      unwrap(
        fetchCommentPage({
          contentType,
          contentId,
          offset: pageParam,
          limit: 20,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.has_more ? allPages.reduce((total, page) => total + page.items.length, 0) : undefined,
    enabled: enabled && Boolean(contentId),
    staleTime: 15_000,
  });
}

export function useCommentReplies(
  contentType: CommentContentType,
  parentId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: commentQueryKeys.replies(contentType, parentId ?? 'none'),
    queryFn: () =>
      unwrap(fetchCommentReplies({ contentType, parentId: parentId as string, limit: 60 })),
    enabled: enabled && Boolean(parentId),
    staleTime: 20_000,
  });
}

export function useAddComment(contentType: CommentContentType, contentId: string) {
  const queryClient = useQueryClient();
  const session = useSession();
  const me = session?.user;

  return useMutation({
    mutationFn: (input: { body: string; parentId?: string | null; media?: CommentMediaInput[] }) =>
      unwrap(
        addComment({
          contentType,
          contentId,
          body: input.body,
          parentId: input.parentId ?? null,
          media: input.media ?? [],
        }),
      ),
    onMutate: async (input) => {
      const key = commentQueryKeys.list(contentType, contentId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CommentsData>(key);

      if (!me?.id) {
        return { previous, tempId: null as string | null };
      }

      const metadata = (me.user_metadata ?? {}) as {
        username?: string;
        first_name?: string;
        last_name?: string;
        avatar_path?: string;
      };
      const tempId = `temp-${Date.now()}`;
      const optimistic: CommentNode = {
        id: tempId,
        content_type: contentType,
        content_id: contentId,
        parent_id: input.parentId ?? null,
        body: input.body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        edited_at: null,
        like_count: 0,
        liked: false,
        reply_count: 0,
        is_mine: true,
        can_edit: true,
        can_delete: true,
        moderation_status: 'visible',
        author_id: me.id,
        author_username: metadata.username ?? 'sen',
        author_first_name: metadata.first_name ?? null,
        author_last_name: metadata.last_name ?? null,
        author_avatar_path: metadata.avatar_path ?? null,
        author_is_verified: false,
        media: (input.media ?? []).map((item, index) => ({
          id: `temp-media-${index}`,
          media_type: item.media_type,
          storage_path: item.storage_path,
          thumbnail_path: item.thumbnail_path ?? null,
          width: item.width ?? null,
          height: item.height ?? null,
          duration_ms: item.duration_ms ?? null,
          sort_order: index,
        })),
        replies: [],
      };

      queryClient.setQueryData<CommentsData>(key, (data) => {
        if (!data) {
          return { pages: [{ items: [optimistic], has_more: false }], pageParams: [0] };
        }
        const pages = [...data.pages];
        if (!input.parentId) {
          const first = pages[0] ?? { items: [], has_more: false };
          pages[0] = { ...first, items: [optimistic, ...first.items] };
          return { ...data, pages };
        }

        let inserted = false;
        const nextPages = pages.map((page) => ({
          ...page,
          items: page.items.map((comment) => {
            if (comment.id !== input.parentId) {
              return comment;
            }
            inserted = true;
            return {
              ...comment,
              reply_count: comment.reply_count + 1,
              replies: [...comment.replies, optimistic],
            };
          }),
        }));

        return inserted ? { ...data, pages: nextPages } : data;
      });

      return { previous, tempId };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          commentQueryKeys.list(contentType, contentId),
          context.previous,
        );
      }
    },
    onSuccess: (comment, _input, context) => {
      const key = commentQueryKeys.list(contentType, contentId);
      if (context?.tempId) {
        queryClient.setQueryData<CommentsData>(key, (data) =>
          replaceComment(data, context.tempId as string, comment),
        );
      } else {
        queryClient.setQueryData<CommentsData>(key, (data) => {
          if (!data) {
            return { pages: [{ items: [comment], has_more: false }], pageParams: [0] };
          }
          const pages = [...data.pages];
          const first = pages[0] ?? { items: [], has_more: false };
          pages[0] = { ...first, items: [comment, ...first.items] };
          return { ...data, pages };
        });
      }
      patchContentCommentCount(queryClient, contentType, contentId, 1);
      if (comment.parent_id) {
        void queryClient.invalidateQueries({
          queryKey: commentQueryKeys.replies(contentType, comment.parent_id),
        });
      }
    },
  });
}

export function useUpdateComment(contentType: CommentContentType, contentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { commentId: string; body: string }) =>
      unwrap(updateComment({ contentType, commentId: input.commentId, body: input.body })),
    onMutate: async (input) => {
      const key = commentQueryKeys.list(contentType, contentId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CommentsData>(key);
      queryClient.setQueryData<CommentsData>(key, (data) =>
        patchComment(data, input.commentId, (comment) => ({
          ...comment,
          body: input.body,
          edited_at: new Date().toISOString(),
        })),
      );
      patchReplyCaches(queryClient, contentType, input.commentId, (comment) => ({
        ...comment,
        body: input.body,
        edited_at: new Date().toISOString(),
      }));
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          commentQueryKeys.list(contentType, contentId),
          context.previous,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ['comments', 'replies', contentType],
      });
    },
    onSuccess: (comment) => {
      queryClient.setQueryData<CommentsData>(
        commentQueryKeys.list(contentType, contentId),
        (data) => patchComment(data, comment.id, () => comment),
      );
      patchReplyCaches(queryClient, contentType, comment.id, () => comment);
    },
  });
}

export function useDeleteComment(contentType: CommentContentType, contentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) => unwrap(deleteComment({ contentType, commentId })),
    onMutate: async (commentId) => {
      const key = commentQueryKeys.list(contentType, contentId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CommentsData>(key);

      let removed = 0;
      queryClient.setQueryData<CommentsData>(key, (data) => {
        if (!data) {
          return data;
        }
        const next = removeCommentFromData(data, commentId);
        const before = data.pages.reduce((total, page) => total + page.items.length, 0);
        const after = next?.pages.reduce((total, page) => total + page.items.length, 0) ?? 0;
        removed = Math.max(before - after, 1);
        return next;
      });
      patchReplyCaches(queryClient, contentType, commentId, () => null);
      return { previous, removed };
    },
    onError: (_error, _commentId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          commentQueryKeys.list(contentType, contentId),
          context.previous,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ['comments', 'replies', contentType],
      });
    },
    onSuccess: (_paths, _commentId, context) => {
      patchContentCommentCount(queryClient, contentType, contentId, -(context?.removed ?? 1));
    },
  });
}

export function useToggleCommentLike(contentType: CommentContentType, contentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) =>
      unwrap(toggleCommentLike({ contentType, commentId })),
    onMutate: async (commentId) => {
      const key = commentQueryKeys.list(contentType, contentId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CommentsData>(key);
      queryClient.setQueryData<CommentsData>(key, (data) =>
        patchComment(data, commentId, (comment) => ({
          ...comment,
          liked: !comment.liked,
          like_count: Math.max(0, comment.like_count + (comment.liked ? -1 : 1)),
        })),
      );
      patchReplyCaches(queryClient, contentType, commentId, (comment) => ({
        ...comment,
        liked: !comment.liked,
        like_count: Math.max(0, comment.like_count + (comment.liked ? -1 : 1)),
      }));
      return { previous };
    },
    onError: (_error, _commentId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          commentQueryKeys.list(contentType, contentId),
          context.previous,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ['comments', 'replies', contentType],
      });
    },
    onSuccess: (result, commentId) => {
      queryClient.setQueryData<CommentsData>(
        commentQueryKeys.list(contentType, contentId),
        (data) =>
          patchComment(data, commentId, (comment) => ({
            ...comment,
            liked: result.liked,
            like_count: result.like_count,
          })),
      );
      patchReplyCaches(queryClient, contentType, commentId, (comment) => ({
        ...comment,
        liked: result.liked,
        like_count: result.like_count,
      }));
    },
  });
}

/** Açık yorum kartına düşen yeni yorum/beğenileri canlı yansıtır. */
export function useCommentsRealtime(
  contentType: CommentContentType,
  contentId: string,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !contentId) {
      return;
    }

    const scheduleInvalidate = () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: commentQueryKeys.list(contentType, contentId),
          refetchType: 'active',
        });
        void queryClient.invalidateQueries({
          queryKey: ['comments', 'replies', contentType],
          refetchType: 'active',
        });
      }, 320);
    };

    if (contentType === 'match') {
      // Maç yorum tabloları istemciye kapalıdır; sunucu `sports-live` kanalına sinyal yollar.
      const unsubscribe = subscribeSportsLive((signal) => {
        if (signal.kind === 'comments') scheduleInvalidate();
      });
      return () => {
        if (timer.current) {
          clearTimeout(timer.current);
        }
        unsubscribe();
      };
    }

    const table = contentType === 'post' ? 'post_comments' : 'reel_comments';
    const filter =
      contentType === 'post' ? `post_id=eq.${contentId}` : `reel_id=eq.${contentId}`;

    const channel = postgresChannel(`comments:${contentType}:${contentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter },
        scheduleInvalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comment_likes' },
        scheduleInvalidate,
      )
      .subscribe();

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      void supabase.removeChannel(channel);
    };
  }, [contentId, contentType, enabled, queryClient]);
}
