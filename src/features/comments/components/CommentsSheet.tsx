import { Ionicons } from '@expo/vector-icons';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from '@/utils/router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { AppText } from '@/components/ui';
import { MarketMediaViewerContent } from '@/features/marketplace/components/MarketMediaViewer';
import type { MarketMediaViewerItem } from '@/features/marketplace/components/MarketMediaViewer';
import { PremiumSheet } from '@/features/overlay/PremiumSheet';
import { ProfilePreviewSheet } from '@/features/profile/components/ProfilePreviewSheet';
import { useBlockUser } from '@/features/profile/hooks/use-profile-mutations';
import { publicMediaUrl } from '@/features/media/media-service';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { shareContent } from '@/features/share/share-action';
import { fetchCommentReplies } from '@/features/comments/services/comment-service';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { unwrap } from '@/utils/result';

import { readCommentDraft, writeCommentDraft } from '../drafts';
import {
  useAddComment,
  useComments,
  useCommentsRealtime,
  useDeleteComment,
  useToggleCommentLike,
  useUpdateComment,
} from '../hooks/use-comments';
import { commentDeepLink } from '../links';
import {
  commentQueryKeys,
  type CommentContentType,
  type CommentMediaInput,
  type CommentNode,
} from '../types';
import { CommentActionMenu, type CommentMenuAction } from './CommentActionMenu';
import { CommentComposer, type ReplyTarget } from './CommentComposer';
import { CommentRow } from './CommentRow';
import { CommentSkeleton } from './CommentSkeleton';
import { ThreadShareStudio } from './ThreadShareStudio';

type Row =
  | { kind: 'comment'; key: string; comment: CommentNode; depth: 0 | 1 }
  | { kind: 'loading'; key: string }
  | { kind: 'error'; key: string; parentId: string };

export type CommentsSheetProps = {
  visible: boolean;
  contentType: CommentContentType;
  contentId: string;
  commentCount: number;
  onClose: () => void;
  title?: string;
  /** Paylaşım bağlantısındaki anahtar; maçlarda fixture kimliği (contentId ise uid). */
  deepLinkKey?: string;
};

/**
 * Trabzone'un tek premium yorum kartı. Feed, Reels, video/foto gönderileri ve
 * işletme gönderileri aynı bileşeni kullanır; veri katmanı ortaktır.
 */
export function CommentsSheet({
  visible,
  contentType,
  contentId,
  commentCount,
  onClose,
  title = 'Yorumlar',
  deepLinkKey,
}: CommentsSheetProps) {
  const linkKey = deepLinkKey ?? contentId;
  const [threadShareId, setThreadShareId] = useState<string | null>(null);
  const { theme } = useTheme();
  const router = useRouter();
  const session = useSession();
  const userId = session?.user?.id ?? null;
  const queryClient = useQueryClient();
  const { openReport } = useReportSheet();
  const blockUser = useBlockUser();

  const [text, setText] = useState(() => readCommentDraft(contentType, contentId));
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [editing, setEditing] = useState<CommentNode | null>(null);
  const [menuComment, setMenuComment] = useState<CommentNode | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [profileTarget, setProfileTarget] = useState<{ userId: string; username: string | null } | null>(
    null,
  );
  const [viewer, setViewer] = useState<{ items: MarketMediaViewerItem[]; index: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const comments = useComments(contentType, contentId, visible);
  const addComment = useAddComment(contentType, contentId);
  const updateComment = useUpdateComment(contentType, contentId);
  const removeComment = useDeleteComment(contentType, contentId);
  const toggleLike = useToggleCommentLike(contentType, contentId);
  useCommentsRealtime(contentType, contentId, visible);

  useEffect(
    () => () => {
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
      }
    },
    [],
  );

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = setTimeout(() => setNotice(null), 2200);
  }, []);

  const pageItems = useMemo(
    () => comments.data?.pages.flatMap((page) => page.items) ?? [],
    [comments.data],
  );

  const replyQueries = useQueries({
    queries: expanded.map((parentId) => ({
      queryKey: commentQueryKeys.replies(contentType, parentId),
      queryFn: () =>
        unwrap(fetchCommentReplies({ contentType, parentId, limit: 60 })),
      staleTime: 20_000,
      enabled: visible,
    })),
  });

  const replyState = useMemo(() => {
    const map: Record<string, { items: CommentNode[] | null; loading: boolean; error: boolean }> =
      {};
    expanded.forEach((parentId, index) => {
      const query = replyQueries[index];
      map[parentId] = {
        items: query?.data ?? null,
        loading: query?.isLoading ?? false,
        error: query?.isError ?? false,
      };
    });
    return map;
  }, [expanded, replyQueries]);

  const rows = useMemo(() => {
    const next: Row[] = [];
    for (const comment of pageItems) {
      next.push({ kind: 'comment', key: comment.id, comment, depth: 0 });
      if (!expanded.includes(comment.id)) {
        continue;
      }
      const state = replyState[comment.id];
      const preview = comment.replies ?? [];
      const fetched = state?.items ?? [];
      const merged = [...preview];
      for (const reply of fetched) {
        if (!merged.some((item) => item.id === reply.id)) {
          merged.push(reply);
        }
      }
      merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
      for (const reply of merged) {
        next.push({ kind: 'comment', key: reply.id, comment: reply, depth: 1 });
      }
      if (state?.loading && merged.length === 0) {
        next.push({ kind: 'loading', key: `${comment.id}-loading` });
      }
      if (state?.error) {
        next.push({ kind: 'error', key: `${comment.id}-error`, parentId: comment.id });
      }
    }
    return next;
  }, [expanded, pageItems, replyState]);

  const totalLoaded = pageItems.length;

  const setDraft = useCallback(
    (next: string) => {
      setText(next);
      writeCommentDraft(contentType, contentId, next);
    },
    [contentId, contentType],
  );

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const startReply = useCallback(
    (comment: CommentNode) => {
      const parentId = comment.parent_id ?? comment.id;
      setEditing(null);
      setReplyTo({
        commentId: parentId,
        username: comment.author_username || 'kullanıcı',
        preview: comment.body,
        hasMedia: (comment.media?.length ?? 0) > 0,
      });
      setError(null);
      focusInput();
    },
    [focusInput],
  );

  const startEdit = useCallback(
    (comment: CommentNode) => {
      setReplyTo(null);
      setEditing(comment);
      setDraft(comment.body);
      setError(null);
      focusInput();
    },
    [focusInput, setDraft],
  );

  const cancelComposerMode = useCallback(() => {
    if (editing) {
      setEditing(null);
      setDraft('');
    }
    setReplyTo(null);
    setError(null);
  }, [editing, setDraft]);

  const submit = useCallback(
    async ({
      body,
      media,
    }: {
      body: string;
      media: CommentMediaInput[];
    }) => {
      setError(null);
      try {
        if (editing) {
          await updateComment.mutateAsync({ commentId: editing.id, body });
          setEditing(null);
          setDraft('');
          haptics.success();
          showNotice('Yorum güncellendi');
          return true;
        }

        const parentId = replyTo?.commentId ?? null;
        await addComment.mutateAsync({ body, parentId, media });
        if (parentId && !expanded.includes(parentId)) {
          setExpanded((current) => [...current, parentId]);
        }
        setReplyTo(null);
        setDraft('');
        haptics.success();
        return true;
      } catch (submitError) {
        haptics.error();
        setError(
          submitError instanceof Error
            ? submitError.message
            : 'Yorum gönderilemedi. Tekrar dene.',
        );
        return false;
      }
    },
    [addComment, editing, expanded, replyTo, setDraft, showNotice, updateComment],
  );

  const toggleReplies = useCallback((comment: CommentNode) => {
    haptics.selection();
    setExpanded((current) =>
      current.includes(comment.id)
        ? current.filter((id) => id !== comment.id)
        : [...current, comment.id],
    );
  }, []);

  const handleLike = useCallback(
    (comment: CommentNode) => {
      haptics.selection();
      toggleLike.mutate(comment.id, {
        onError: () => showNotice('Beğeni kaydedilemedi'),
      });
    },
    [showNotice, toggleLike],
  );

  const openMenu = useCallback((comment: CommentNode) => {
    Keyboard.dismiss();
    setMenuComment(comment);
  }, []);

  const openProfile = useCallback((authorId: string, username?: string | null) => {
    Keyboard.dismiss();
    setMenuComment(null);
    setProfileTarget({ userId: authorId, username: username ?? null });
  }, []);

  const openMedia = useCallback((comment: CommentNode, index: number) => {
    const items: MarketMediaViewerItem[] = comment.media.map((item) => ({
      id: item.id,
      kind: item.media_type,
      uri: publicMediaUrl('posts', item.storage_path) ?? '',
      thumbUri: item.thumbnail_path ? publicMediaUrl('posts', item.thumbnail_path) : null,
      width: item.width,
      height: item.height,
    }));
    if (items.length === 0) {
      return;
    }
    setViewer({ items, index: Math.min(index, items.length - 1) });
  }, []);

  const confirmDelete = useCallback(
    (comment: CommentNode) => {
      setMenuComment(null);
      Alert.alert(
        'Yorumu sil',
        comment.reply_count > 0
          ? 'Bu yorum ve altındaki yanıtlar kalıcı olarak silinecek.'
          : 'Bu yorum kalıcı olarak silinecek.',
        [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'Sil',
            style: 'destructive',
            onPress: () => {
              removeComment.mutate(comment.id, {
                onSuccess: () => {
                  haptics.success();
                  if (editing?.id === comment.id) {
                    setEditing(null);
                    setDraft('');
                  }
                  showNotice('Yorum silindi');
                },
                onError: () => showNotice('Yorum silinemedi'),
              });
            },
          },
        ],
      );
    },
    [editing?.id, removeComment, setDraft, showNotice],
  );

  const handleMenuAction = useCallback(
    (action: CommentMenuAction, comment: CommentNode) => {
      switch (action) {
        case 'edit':
          setMenuComment(null);
          startEdit(comment);
          return;
        case 'delete':
          confirmDelete(comment);
          return;
        case 'report':
          setMenuComment(null);
          Keyboard.dismiss();
          openReport({
            targetType: 'comment',
            targetId: comment.id,
            targetUserId: comment.author_id,
            targetLabel: `${comment.author_username}: ${comment.body}`.slice(0, 90),
          });
          return;
        case 'block':
          setMenuComment(null);
          Alert.alert(
            'Kullanıcıyı engelle',
            `@${comment.author_username} engellensin mi? Yorumları ve içerikleri artık görünmeyecek.`,
            [
              { text: 'Vazgeç', style: 'cancel' },
              {
                text: 'Engelle',
                style: 'destructive',
                onPress: () => {
                  blockUser.mutate(comment.author_id, {
                    onSuccess: () => {
                      haptics.success();
                      showNotice('Kullanıcı engellendi');
                      void queryClient.invalidateQueries({
                        queryKey: commentQueryKeys.list(contentType, contentId),
                      });
                    },
                    onError: () => showNotice('Kullanıcı engellenemedi'),
                  });
                },
              },
            ],
          );
          return;
        case 'copy':
          setMenuComment(null);
          void Clipboard.setStringAsync(
            commentDeepLink(contentType, linkKey, comment.id),
          ).then(() => showNotice('Bağlantı kopyalandı'));
          return;
        case 'share': {
          setMenuComment(null);
          const link = commentDeepLink(contentType, linkKey, comment.id);
          void shareContent({
            message: `Trabzone'da bir yorum: "${comment.body.slice(0, 120)}"\n${link}`,
          });
          return;
        }
        case 'share_thread':
          setMenuComment(null);
          Keyboard.dismiss();
          setThreadShareId(comment.id);
          return;
        default:
          return;
      }
    },
    [blockUser, confirmDelete, contentType, contentId, linkKey, openReport, queryClient, showNotice, startEdit],
  );

  const resetOverlays = useCallback(() => {
    Keyboard.dismiss();
    setMenuComment(null);
    setReplyTo(null);
    setEditing(null);
    setExpanded([]);
    setProfileTarget(null);
    setViewer(null);
    setError(null);
    setNotice(null);
  }, []);

  const closeAll = useCallback(() => {
    resetOverlays();
    onClose();
  }, [onClose, resetOverlays]);

  const closeFromProfile = useCallback(() => {
    setProfileTarget(null);
  }, []);

  const goToProfile = useCallback(
    (username: string) => {
      resetOverlays();
      onClose();
      router.push(`/profile/${username}` as never);
    },
    [onClose, resetOverlays, router],
  );

  const goToChat = useCallback(
    (conversationId: string) => {
      resetOverlays();
      onClose();
      router.push(`/chat/${conversationId}` as never);
    },
    [onClose, resetOverlays, router],
  );

  const handleHardwareBack = useCallback(() => {
    if (viewer) {
      setViewer(null);
      return;
    }
    if (profileTarget) {
      setProfileTarget(null);
      return;
    }
    if (menuComment) {
      setMenuComment(null);
      return;
    }
    closeAll();
  }, [closeAll, menuComment, profileTarget, viewer]);

  const loadMore = useCallback(() => {
    if (comments.hasNextPage && !comments.isFetchingNextPage) {
      void comments.fetchNextPage();
    }
  }, [comments]);

  const header = (
    <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
      <View style={styles.headerSide} />
      <View style={styles.headerCenter}>
        <View style={styles.titleRow}>
          <AppText variant="h2" style={styles.title}>
            {title}
          </AppText>
          {commentCount > 0 ? (
            <View style={[styles.countPill, { backgroundColor: theme.colors.primarySoft }]}>
              <AppText variant="caption" color="primaryDeep">
                {commentCount > 999 ? '999+' : commentCount}
              </AppText>
            </View>
          ) : null}
        </View>
        {totalLoaded > 0 ? (
          <AppText variant="caption" color="textTertiary">
            {totalLoaded} yorum yüklendi
          </AppText>
        ) : null}
      </View>
      <View style={styles.headerSide}>
        <Pressable
          onPress={closeAll}
          hitSlop={10}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel="Yorumları kapat"
        >
          <Ionicons name="close" size={19} color={theme.colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );

  const footer = (
    <CommentComposer
      value={text}
      onChangeText={setDraft}
      userId={userId}
      replyTo={replyTo}
      editing={Boolean(editing)}
      submitting={addComment.isPending || updateComment.isPending}
      onCancelReply={() => setReplyTo(null)}
      onCancelEdit={cancelComposerMode}
      onSubmit={submit}
      onError={setError}
      inputRef={inputRef}
    />
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={handleHardwareBack}
    >
      <View style={styles.root}>
        <PremiumSheet
          onClose={closeAll}
          open={visible}
          header={header}
          footer={footer}
          collapsedRatio={0.58}
          expandedRatio={0.95}
          surfaceColor={theme.scheme === 'dark' ? 'rgba(20,28,48,0.97)' : 'rgba(255,255,255,0.98)'}
          borderColor={theme.colors.border}
          grabberColor={theme.colors.borderStrong}
          backdropColor="rgba(3, 7, 14, 0.58)"
          headerAccessibilityLabel="Yorum kartını büyüt, küçült veya kapat"
        >
          <View style={styles.body}>
            {notice ? (
              <View style={[styles.notice, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="checkmark-circle" size={14} color={theme.colors.primaryDeep} />
                <AppText variant="caption" color="primaryDeep">
                  {notice}
                </AppText>
              </View>
            ) : null}

            {error ? (
              <View style={[styles.errorBar, { backgroundColor: theme.colors.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={14} color={theme.colors.danger} />
                <AppText variant="caption" color="danger" style={styles.flex}>
                  {error}
                </AppText>
                <Pressable
                  onPress={() => setError(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Hata mesajını kapat"
                >
                  <Ionicons name="close" size={14} color={theme.colors.danger} />
                </Pressable>
              </View>
            ) : null}

            {comments.isLoading && pageItems.length === 0 ? (
              <CommentSkeleton rows={6} />
            ) : comments.isError && pageItems.length === 0 ? (
              <Pressable
                onPress={() => void comments.refetch()}
                accessibilityRole="button"
                accessibilityLabel="Yorumları yeniden yükle"
                style={styles.state}
              >
                <Ionicons
                  name="cloud-offline-outline"
                  size={28}
                  color={theme.colors.textSecondary}
                />
                <AppText variant="body" color="textSecondary" align="center">
                  Yorumlar yüklenemedi. Tekrar denemek için dokun.
                </AppText>
              </Pressable>
            ) : (
              <FlashList
                data={rows}
                extraData={replyState}
                keyExtractor={(item) => item.key}
                renderItem={({ item }) => {
                  if (item.kind === 'loading') {
                    return (
                      <View style={styles.inlineLoading}>
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                      </View>
                    );
                  }
                  if (item.kind === 'error') {
                    return (
                      <Pressable
                        onPress={() =>
                          void queryClient.invalidateQueries({
                            queryKey: commentQueryKeys.replies(contentType, item.parentId),
                          })
                        }
                        style={styles.inlineLoading}
                        accessibilityRole="button"
                      >
                        <AppText variant="caption" color="textTertiary">
                          Yanıtlar yüklenemedi. Tekrar dene.
                        </AppText>
                      </Pressable>
                    );
                  }
                  const comment = item.comment;
                  return (
                    <CommentRow
                      comment={comment}
                      depth={item.depth}
                      repliesExpanded={expanded.includes(comment.id)}
                      onToggleReplies={toggleReplies}
                      onToggleLike={handleLike}
                      onReply={startReply}
                      onMenu={openMenu}
                      onOpenProfile={openProfile}
                      onOpenMedia={openMedia}
                    />
                  );
                }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
                onEndReached={loadMore}
                onEndReachedThreshold={0.45}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <View style={styles.state}>
                    <View
                      style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}
                    >
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={26}
                        color={theme.colors.primaryDeep}
                      />
                    </View>
                    <AppText variant="bodyStrong" align="center">
                      Henüz yorum yok
                    </AppText>
                    <AppText variant="body" color="textSecondary" align="center">
                      İlk yorumu sen yaz, sohbeti başlat.
                    </AppText>
                  </View>
                }
                ListFooterComponent={
                  comments.isFetchingNextPage ? (
                    <View style={styles.footerLoading}>
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                    </View>
                  ) : (
                    <View style={styles.footerSpace} />
                  )
                }
                refreshControl={
                  <RefreshControl
                    refreshing={comments.isRefetching && !comments.isFetchingNextPage}
                    onRefresh={() => void comments.refetch()}
                    tintColor={theme.colors.primary}
                    colors={[theme.colors.primary]}
                  />
                }
              />
            )}
          </View>
        </PremiumSheet>

        <CommentActionMenu
          visible={Boolean(menuComment)}
          comment={menuComment}
          onClose={() => setMenuComment(null)}
          onAction={handleMenuAction}
        />

        {profileTarget ? (
          <View style={StyleSheet.absoluteFill}>
            <ProfilePreviewSheet
              key={profileTarget.userId}
              visible
              userId={profileTarget.userId}
              username={profileTarget.username}
              onClose={closeFromProfile}
              onViewProfile={goToProfile}
              onOpenChat={goToChat}
            />
          </View>
        ) : null}

        <ThreadShareStudio
          visible={Boolean(threadShareId)}
          contentType={contentType}
          commentId={threadShareId}
          onClose={() => setThreadShareId(null)}
        />

        {viewer ? (
          <View style={styles.viewerLayer}>
            <MarketMediaViewerContent
              items={viewer.items}
              initialIndex={viewer.index}
              onClose={() => setViewer(null)}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  body: { flex: 1, minHeight: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { width: 36, alignItems: 'flex-end' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16.5 },
  countPill: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { paddingTop: 4, paddingBottom: 8 },
  state: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  inlineLoading: { paddingVertical: 12, alignItems: 'center' },
  footerLoading: { paddingVertical: 14, alignItems: 'center' },
  footerSpace: { height: 8 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  viewerLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#04060C',
    zIndex: 40,
  },
});
