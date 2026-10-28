import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useRouter } from '@/utils/router';
import { memo, useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { ActionSheet, AppImage, AppText, Avatar } from '@/components/ui';
import { VideoThumbnail } from '@/features/media/components/VideoThumbnail';
import { publicMediaUrl } from '@/features/media/media-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { useBlockedUserIds } from '@/features/profile/hooks/use-relations';
import {
  useDeletePost,
  useSharePost,
  useTogglePostLike,
  useTogglePostSave,
} from '../hooks/use-feed';
import type { FeedPost, PostMedia } from '../services/feed-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { formatRelativeTr } from '@/utils/date';

import { CommentsSheet } from './CommentsSheet';
import { MediaViewer } from './MediaViewer';

function VideoSurface({ uri, compact }: { uri: string; compact?: boolean }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = compact ?? false;
    instance.muted = compact ?? false;
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={!compact}
      // SurfaceView, donusum uygulanan ust kapsayicilarda (drawer/animasyon)
      // siyah kalabiliyor; texture gorunumu her cihazda cizilir.
      surfaceType="textureView"
    />
  );
}

function aspectFor(media: PostMedia) {
  if (media.width && media.height) {
    return Math.min(Math.max(media.width / media.height, 0.66), 1.6);
  }
  return 1;
}

function PostMediaBlock({
  media,
  postId,
  onOpen,
}: {
  media: PostMedia[];
  postId: string;
  onOpen: (index: number) => void;
}) {
  const { theme } = useTheme();

  if (media.length === 0) {
    return null;
  }

  if (media.length === 1) {
    const item = media[0]!;
    const uri = publicMediaUrl('posts', item.storage_path);
    const posterUri = publicMediaUrl('posts', item.thumbnail_path);
    if (!uri) {
      return null;
    }

    return (
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel="Medyayı tam ekran aç"
        onPress={() => onOpen(0)}
        style={({ pressed }) => [
          styles.singleMedia,
          {
            aspectRatio: aspectFor(item),
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surfaceMuted,
            opacity: pressed ? 0.94 : 1,
          },
        ]}
      >
        {item.media_type === 'video' ? (
          <>
            {posterUri ? (
              <VideoThumbnail
                posterUri={posterUri}
                durationMs={item.duration_ms}
                qualityLabel="1080p"
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <VideoSurface uri={uri} />
            )}
            {!posterUri ? (
              <View style={styles.videoBadge}>
                <Ionicons name="videocam" size={13} color="#FFFFFF" />
                <AppText variant="caption" color="#FFFFFF">
                  Video
                </AppText>
              </View>
            ) : null}
          </>
        ) : (
          <AppImage
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            recycleKey={`${postId}-${item.id}`}
          />
        )}
      </Pressable>
    );
  }

  const visible = media.slice(0, 4);
  const extra = media.length - visible.length;

  return (
    <View style={styles.grid}>
      {visible.map((item, index) => {
        const uri = publicMediaUrl('posts', item.storage_path);
        const posterUri = publicMediaUrl('posts', item.thumbnail_path);
        if (!uri) {
          return null;
        }
        return (
          <Pressable
            key={item.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Medya ${index + 1}`}
            onPress={() => onOpen(index)}
            style={({ pressed }) => [
              styles.gridCell,
              {
                backgroundColor: theme.colors.surfaceMuted,
                borderRadius: theme.radius.md,
                opacity: pressed ? 0.92 : 1,
              },
            ]}
          >
            {item.media_type === 'video' ? (
              posterUri ? (
                <VideoThumbnail
                  posterUri={posterUri}
                  durationMs={item.duration_ms}
                  style={StyleSheet.absoluteFill}
                />
              ) : (
                <>
                  <VideoSurface uri={uri} compact />
                  <View style={styles.gridVideoIcon}>
                    <Ionicons name="play" size={14} color="#FFFFFF" />
                  </View>
                </>
              )
            ) : (
              <AppImage
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                recycleKey={`${postId}-${item.id}`}
              />
            )}
            {extra > 0 && index === visible.length - 1 ? (
              <View style={styles.moreOverlay}>
                <AppText variant="h3" color="#FFFFFF">
                  +{extra}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function ActionButton({
  icon,
  activeIcon,
  label,
  active,
  tone = 'default',
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon?: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const color =
    tone === 'danger'
      ? theme.colors.danger
      : active
        ? theme.colors.primary
        : theme.colors.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={active && activeIcon ? activeIcon : icon} size={21} color={color} />
      {label ? (
        <AppText variant="caption" color={color} numberOfLines={1}>
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export const PostCard = memo(function PostCard({
  post,
  onChange,
  onDeleted,
}: {
  post: FeedPost;
  onChange?: (next: FeedPost) => void;
  onDeleted?: (postId: string) => void;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const { openReport } = useReportSheet();
  const { data: blockedIds } = useBlockedUserIds();

  const toggleLike = useTogglePostLike();
  const toggleSave = useTogglePostSave();
  const share = useSharePost();
  const remove = useDeletePost();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const fullName = `${post.author_first_name ?? ''} ${post.author_last_name ?? ''}`.trim();
  const authorName = fullName || post.author_username;
  // Avatarlar `avatars` kovasinda tutulur; once `posts` kovasindan denenmesi
  // gecersiz bir URL uretiyordu ve akista profil resmi bos gorunuyordu.
  const avatarUrl = mediaPublicUrl('avatar', post.author_avatar_path);
  const blocked = blockedIds?.includes(post.author_id) ?? false;

  const media = post.media
    .map((item) => ({
      id: item.id,
      uri: publicMediaUrl('posts', item.storage_path) ?? '',
      thumbnailUri: publicMediaUrl('posts', item.thumbnail_path),
      media_type: item.media_type,
      duration_ms: item.duration_ms,
    }))
    .filter((item) => item.uri);

  const openProfile = useCallback(() => {
    router.push(`/profile/${post.author_username}` as never);
  }, [post.author_username, router]);

  const onLike = useCallback(() => {
    haptics.tap();
    onChange?.({
      ...post,
      liked: !post.liked,
      like_count: Math.max(0, post.like_count + (post.liked ? -1 : 1)),
    });
    toggleLike.mutate(post.id, {
      onError: () => onChange?.(post),
    });
  }, [onChange, post, toggleLike]);

  const onSave = useCallback(() => {
    haptics.tap();
    onChange?.({ ...post, saved: !post.saved });
    toggleSave.mutate(post.id, { onError: () => onChange?.(post) });
  }, [onChange, post, toggleSave]);

  const onShare = useCallback(async () => {
    haptics.tap();
    share.mutate(post.id);
    try {
      await Share.share({
        message: `${authorName} (@${post.author_username}) Trabzone'da bir gönderi paylaştı.${post.body ? `\n\n${post.body}` : ''}`,
      });
    } catch {
      // Paylasim iptal edildi.
    }
  }, [authorName, post.author_username, post.body, post.id, share]);

  const confirmDelete = useCallback(() => {
    Alert.alert('Gönderiyi sil', 'Bu gönderi kalıcı olarak silinecek. Emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () =>
          remove.mutate(post.id, {
            onSuccess: () => onDeleted?.(post.id),
            onError: (error) => Alert.alert('Silinemedi', error.message),
          }),
      },
    ]);
  }, [onDeleted, post.id, remove]);

  const confirmBlock = useCallback(() => {
    Alert.alert(
      'Kullanıcıyı engelle',
      `@${post.author_username} kişisini engellediğinde gönderileri akışında görünmez.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Engelle',
          style: 'destructive',
          onPress: () => router.push(`/profile/${post.author_username}` as never),
        },
      ],
    );
  }, [post.author_username, router]);

  if (blocked) {
    return null;
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${authorName} profilini aç`}
          onPress={openProfile}
          style={styles.headPerson}
        >
          <Avatar uri={avatarUrl} name={authorName} size={42} recycleKey={post.author_id} />
          <View style={styles.headText}>
            <View style={styles.nameRow}>
              <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
                {authorName}
              </AppText>
              {post.author_is_verified ? (
                <Ionicons name="checkmark-circle" size={14} color={theme.colors.primary} />
              ) : null}
            </View>
            <View style={styles.metaRow}>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                @{post.author_username}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                ·
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {formatRelativeTr(post.created_at)}
              </AppText>
              {post.city ? (
                <>
                  <AppText variant="caption" color="textTertiary">
                    ·
                  </AppText>
                  <Ionicons name="location-outline" size={12} color={theme.colors.textTertiary} />
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {post.city}
                  </AppText>
                </>
              ) : null}
              {post.visibility === 'followers' ? (
                <Ionicons name="people-outline" size={13} color={theme.colors.textTertiary} />
              ) : null}
            </View>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Gönderi seçenekleri"
          hitSlop={8}
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [styles.moreButton, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      {post.body ? (
        <AppText variant="body" style={styles.body}>
          {post.body}
          {post.is_edited ? (
            <AppText variant="caption" color="textTertiary">
              {'  '}(düzenlendi)
            </AppText>
          ) : null}
        </AppText>
      ) : null}

      <PostMediaBlock
        media={post.media}
        postId={post.id}
        onOpen={(index) => {
          setViewerIndex(index);
          setViewerOpen(true);
        }}
      />

      <View style={styles.actions}>
        <ActionButton
          icon="heart-outline"
          activeIcon="heart"
          label={post.like_count > 0 ? String(post.like_count) : 'Beğen'}
          active={post.liked}
          tone={post.liked ? 'danger' : 'default'}
          onPress={onLike}
        />
        <ActionButton
          icon="chatbubble-outline"
          label={post.comment_count > 0 ? String(post.comment_count) : 'Yorum'}
          onPress={() => setCommentsOpen(true)}
        />
        <ActionButton
          icon="paper-plane-outline"
          label={post.share_count > 0 ? String(post.share_count) : 'Paylaş'}
          onPress={() => void onShare()}
        />
        <View style={styles.actionSpacer} />
        <ActionButton
          icon="bookmark-outline"
          activeIcon="bookmark"
          label=""
          active={post.saved}
          onPress={onSave}
        />
      </View>

      <MediaViewer
        visible={viewerOpen}
        media={media}
        startIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
      />

      <CommentsSheet
        visible={commentsOpen}
        postId={post.id}
        commentCount={post.comment_count}
        onClose={() => setCommentsOpen(false)}
      />

      <ActionSheet
        visible={menuOpen}
        title="Gönderi"
        items={[
          ...(post.is_mine
            ? [
                { key: 'edit', label: 'Gönderiyi düzenle', icon: 'create-outline' as const },
                {
                  key: 'delete',
                  label: 'Gönderiyi sil',
                  icon: 'trash-outline' as const,
                  destructive: true,
                },
              ]
            : [
                { key: 'profile', label: 'Profili görüntüle', icon: 'person-outline' as const },
                { key: 'report', label: 'Gönderiyi şikâyet et', icon: 'flag-outline' as const },
                {
                  key: 'block',
                  label: 'Kullanıcıyı engelle',
                  icon: 'ban-outline' as const,
                  destructive: true,
                },
              ]),
          { key: 'share', label: 'Bağlantıyı paylaş', icon: 'share-social-outline' as const },
        ]}
        onClose={() => setMenuOpen(false)}
        onSelect={(key) => {
          setMenuOpen(false);
          if (key === 'delete') {
            confirmDelete();
          } else if (key === 'edit') {
            router.push(`/compose/post?postId=${post.id}` as never);
          } else if (key === 'profile') {
            openProfile();
          } else if (key === 'report') {
            setTimeout(() => {
              openReport({
                targetType: 'post',
                targetId: post.id,
                targetLabel: post.body?.slice(0, 60) || 'Gönderi',
              });
            }, 280);
          } else if (key === 'block') {
            confirmBlock();
          } else if (key === 'share') {
            void onShare();
          }
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  card: { paddingVertical: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headPerson: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  moreButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  body: { lineHeight: 22 },
  singleMedia: { width: '100%', overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  gridCell: { width: '49%', aspectRatio: 1, overflow: 'hidden' },
  gridVideoIcon: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(9,14,28,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(9,14,28,0.55)',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 2 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32 },
  actionSpacer: { flex: 1 },
});
