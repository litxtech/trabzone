/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated inside event handlers. */
import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import { AppText, Avatar } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';

import type { CommentNode } from '../types';
import { CommentMediaGrid } from './CommentMediaGrid';
import { RichCommentText } from './RichCommentText';

function timeAgo(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const value = new Date(iso).getTime();
  if (Number.isNaN(value)) {
    return '';
  }
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 45) {
    return 'az önce';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} dk`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} sa`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days} gün`;
  }
  return new Date(value).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function displayName(comment: CommentNode): string {
  return (
    `${comment.author_first_name ?? ''} ${comment.author_last_name ?? ''}`.trim() ||
    comment.author_username ||
    'Kullanıcı'
  );
}

export type CommentRowProps = {
  comment: CommentNode;
  depth?: 0 | 1;
  repliesExpanded?: boolean;
  onToggleReplies?: (comment: CommentNode) => void;
  onToggleLike: (comment: CommentNode) => void;
  onReply: (comment: CommentNode) => void;
  onMenu: (comment: CommentNode) => void;
  onOpenProfile: (userId: string, username?: string | null) => void;
  onOpenMedia: (comment: CommentNode, index: number) => void;
};

function CommentRowBase({
  comment,
  depth = 0,
  repliesExpanded,
  onToggleReplies,
  onToggleLike,
  onReply,
  onMenu,
  onOpenProfile,
  onOpenMedia,
}: CommentRowProps) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);
  const likeStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const name = useMemo(() => displayName(comment), [comment]);
  const avatarUri = useMemo(
    () => mediaPublicUrl('avatar', comment.author_avatar_path),
    [comment.author_avatar_path],
  );
  const liked = comment.liked;
  const likeCount = comment.like_count ?? 0;
  const replyCount = comment.reply_count ?? 0;
  const edited = Boolean(comment.edited_at);

  const handleLike = useCallback(() => {
    scale.value = withSequence(withSpring(1.35, { damping: 11 }), withSpring(1, { damping: 13 }));
    onToggleLike(comment);
  }, [comment, onToggleLike, scale]);

  const openProfile = useCallback(() => {
    onOpenProfile(comment.author_id, comment.author_username);
  }, [comment.author_id, comment.author_username, onOpenProfile]);

  return (
    <View style={[styles.row, depth === 1 ? styles.rowNested : null]}>
      {depth === 1 ? (
        <View style={[styles.threadLine, { backgroundColor: theme.colors.border }]} />
      ) : null}

      <Pressable
        onPress={openProfile}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${name} profili`}
      >
        <Avatar
          uri={avatarUri}
          name={name}
          size={depth === 0 ? 38 : 30}
          recycleKey={comment.author_id}
        />
      </Pressable>

      <View style={styles.main}>
        <View style={styles.headerRow}>
          <Pressable onPress={openProfile} hitSlop={4} style={styles.nameWrap}>
            <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
              {name}
            </AppText>
            {comment.author_is_verified ? (
              <Ionicons name="checkmark-circle" size={13} color={theme.colors.primary} />
            ) : null}
            {comment.author_username ? (
              <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.handle}>
                @{comment.author_username}
              </AppText>
            ) : null}
            {comment.is_mine ? (
              <View style={[styles.youBadge, { backgroundColor: theme.colors.primarySoft }]}>
                <AppText variant="caption" color="primaryDeep" style={styles.youText}>
                  Sen
                </AppText>
              </View>
            ) : null}
          </Pressable>
          <View style={styles.timeRow}>
            <AppText variant="caption" color="textTertiary">
              {timeAgo(comment.created_at)}
            </AppText>
            {edited ? (
              <AppText variant="caption" color="textTertiary" style={styles.edited}>
                · düzenlendi
              </AppText>
            ) : null}
          </View>
        </View>

        <RichCommentText body={comment.body} />

        <CommentMediaGrid
          media={comment.media}
          onOpen={(_media, index) => onOpenMedia(comment, index)}
        />

        <View style={styles.actions}>
          <Pressable
            onPress={handleLike}
            hitSlop={8}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel={liked ? 'Beğeniyi kaldır' : 'Yorumu beğen'}
            accessibilityState={{ selected: liked }}
          >
            <Animated.View style={likeStyle}>
              <Ionicons
                name={liked ? 'heart' : 'heart-outline'}
                size={16}
                color={liked ? theme.colors.danger : theme.colors.textTertiary}
              />
            </Animated.View>
            {likeCount > 0 ? (
              <AppText variant="caption" color={liked ? 'danger' : 'textTertiary'}>
                {likeCount}
              </AppText>
            ) : null}
          </Pressable>

          <Pressable
            onPress={() => onReply(comment)}
            hitSlop={8}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel="Yoruma yanıt ver"
          >
            <Ionicons name="chatbubble-outline" size={15} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary">
              Yanıtla
            </AppText>
          </Pressable>

          {depth === 0 && replyCount > 0 && onToggleReplies ? (
            <Pressable
              onPress={() => onToggleReplies(comment)}
              hitSlop={8}
              style={styles.actionButton}
              accessibilityRole="button"
            >
              <Ionicons
                name={repliesExpanded ? 'chevron-up' : 'chatbubbles-outline'}
                size={14}
                color={theme.colors.primaryDeep}
              />
              <AppText variant="caption" color="primaryDeep">
                {repliesExpanded ? 'Yanıtları gizle' : `${replyCount} yanıtı göster`}
              </AppText>
            </Pressable>
          ) : null}

          <View style={styles.spacer} />

          <Pressable
            onPress={() => onMenu(comment)}
            hitSlop={10}
            style={styles.moreButton}
            accessibilityRole="button"
            accessibilityLabel="Yorum işlemleri"
          >
            <Ionicons name="ellipsis-horizontal" size={16} color={theme.colors.textTertiary} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export const CommentRow = memo(CommentRowBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 9 },
  rowNested: { paddingLeft: 54, paddingRight: 16 },
  threadLine: { position: 'absolute', left: 37, top: 8, bottom: 8, width: 1.5, borderRadius: 1 },
  main: { flex: 1, minWidth: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 1 },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1, minWidth: 0 },
  name: { fontSize: 13.5, maxWidth: 132 },
  handle: { fontSize: 11, maxWidth: 92 },
  youBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  youText: { fontSize: 9.5 },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },
  edited: { fontSize: 10.5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4, minHeight: 30 },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 3 },
  spacer: { flex: 1 },
  moreButton: { padding: 4 },
});
