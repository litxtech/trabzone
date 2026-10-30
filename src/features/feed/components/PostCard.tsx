import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from '@/utils/router';
import { memo, useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ActionSheet, AppImage, AppText, Avatar } from '@/components/ui';
import { openUrl } from '@/features/in-app-browser';
import { VideoThumbnail } from '@/features/media/components/VideoThumbnail';
import { publicMediaUrl, removeMedia } from '@/features/media/media-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { ChildProtectedBadge } from '@/features/safety/components/ChildProtectedBadge';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { useBlockedUserIds } from '@/features/profile/hooks/use-relations';
import { ViewCount } from '@/features/views/components/ViewCount';
import { ContentStatsSheet } from '@/features/views/components/ContentStatsSheet';
import { liveNewsShareLink, postShareLink, shareSnippet } from '@/features/share/links';
import { didShare, shareContent } from '@/features/share/share-action';
import { newsCategoryPalette, newsFormatLabel } from '@/features/news/category-theme';
import { NewsImageFrame } from '@/features/news/components/NewsImageFrame';
import { useDeleteLiveNews } from '@/features/live-news/hooks/use-live-news';
import {
  categoryLabel,
  LIVE_NEWS_VERIFICATION_LABELS,
} from '@/features/live-news/services/live-news-service';
import type { LiveNewsMeta } from '@/features/live-news/types';
import {
  useDeletePost,
  useSharePost,
  useTogglePostLike,
  useTogglePostSave,
} from '../hooks/use-feed';
import type { FeedPost, PostMedia, PostNewsMeta } from '../services/feed-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { formatRelativeTr } from '@/utils/date';
import { afterSheetDismiss } from '@/utils/sheet';

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

const SOURCE_LINE_RE = /^(?:🔗\s*)?(?:haber\s+)?kayna[ğg][ıi]\s*:/i;

/** Gövdeden kaynak/atıf satırlarını çıkarır; kart şeridi bunları üstlenir. */
function stripSourceLines(body: string | null): string | null {
  if (!body) return body;
  const kept = body
    .split('\n')
    .filter((line) => !SOURCE_LINE_RE.test(line.trim()) && !line.trim().startsWith('🔗'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return kept.length > 0 ? kept : body;
}

/**
 * Haber gönderileri için birleşik meta. AI haberleri `news` alanında,
 * kaynak haberleri ise yeni `source` alanında aynı okuma alanlarını taşır.
 */
function resolveNewsMeta(post: FeedPost): PostNewsMeta | null {
  if (post.news?.title) return post.news;
  const source = post.source;
  if (!source?.title) return null;
  return {
    post_id: post.id,
    kind: 'source',
    slug: source.slug ?? null,
    title: source.title,
    subtitle: source.subtitle ?? null,
    spot: source.spot ?? null,
    lead: source.lead ?? null,
    preview: source.preview ?? null,
    body_format: source.body_format ?? 'short',
    word_count: source.word_count ?? null,
    preview_lines: source.preview_lines ?? null,
    category_slug: source.category_slug ?? null,
    category_name: source.category_name ?? null,
    district: source.district ?? post.city ?? null,
    published_at: source.published_at ?? post.created_at,
    updated_at: source.updated_at ?? post.updated_at,
    ai_generated: Boolean(source.ai_generated),
    source_count: source.source_count ?? 1,
  };
}

function previewText(meta: PostNewsMeta): string | null {
  const text = meta.preview ?? meta.lead ?? null;
  if (!text) return null;
  const clean = text
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 0 ? clean : null;
}

/** Görselin doğal oranını koruyan haber medyası; metin görselleri kırpılmaz. */
function NewsMediaBlock({
  media,
  postId,
  preferContain = false,
  onOpen,
}: {
  media: PostMedia[];
  postId: string;
  /** Kaynak haber görselleri sıklıkla başlık metni içerir; kırpmadan göster. */
  preferContain?: boolean;
  onOpen: (index: number) => void;
}) {
  const { theme } = useTheme();
  const { height: viewportHeight } = useWindowDimensions();
  const item = media[0];
  if (!item) return null;

  const uri = publicMediaUrl('posts', item.storage_path);
  const posterUri = publicMediaUrl('posts', item.thumbnail_path);
  if (!uri) return null;

  const naturalRatio =
    item.width && item.height
      ? item.width / item.height
      : item.media_type === 'video'
        ? 16 / 9
        : 4 / 3;
  const fit =
    item.display_fit && item.display_fit !== 'auto'
      ? item.display_fit
      : preferContain || naturalRatio < 0.9
        ? 'contain'
        : 'cover';
  // Dikey görseller akışı aşırı uzatmasın; tamamı galeride görülebilir.
  const ratio = Math.min(Math.max(naturalRatio, 0.62), 1.78);
  const maxHeight = Math.round(Math.min(viewportHeight * 0.58, 520));

  // X'teki gibi: görsel ayrı bir gri kutu içinde değil, kendi oranında durur;
  // köşeler yuvarlatılır ve arkasındaki alan tamamen saydam kalır.
  const radius = theme.radius.md;

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="Haber görselini tam ekran aç"
      onPress={() => onOpen(0)}
      style={({ pressed }) => [styles.newsMediaWrap, { opacity: pressed ? 0.94 : 1 }]}
    >
      {item.media_type === 'video' ? (
        <View
          style={[
            styles.newsVideo,
            {
              aspectRatio: ratio,
              maxHeight,
              borderRadius: radius,
              backgroundColor: theme.colors.surfaceMuted,
            },
          ]}
        >
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
          <View style={styles.videoBadge}>
            <Ionicons name="play" size={13} color="#FFFFFF" />
            <AppText variant="caption" color="#FFFFFF">
              Video
            </AppText>
          </View>
          {media.length > 1 ? (
            <View style={styles.mediaCountBadge}>
              <Ionicons name="images-outline" size={12} color="#FFFFFF" />
              <AppText variant="caption" color="#FFFFFF">
                {media.length}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : (
        <NewsImageFrame
          uri={uri}
          width={item.width}
          height={item.height}
          fit={fit}
          maxHeight={maxHeight}
          radius={radius}
          recycleKey={`news-${postId}-${item.id}`}
        >
          {fit === 'contain' ? (
            <View style={[styles.containBadge, { backgroundColor: 'rgba(9,14,28,0.55)' }]}>
              <Ionicons name="expand-outline" size={12} color="#FFFFFF" />
              <AppText variant="caption" color="#FFFFFF">
                Tam görünüm
              </AppText>
            </View>
          ) : null}
          {media.length > 1 ? (
            <View style={styles.mediaCountBadge}>
              <Ionicons name="images-outline" size={12} color="#FFFFFF" />
              <AppText variant="caption" color="#FFFFFF">
                {media.length}
              </AppText>
            </View>
          ) : null}
        </NewsImageFrame>
      )}
    </Pressable>
  );
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
  const { width: windowWidth, height: viewportHeight } = useWindowDimensions();
  // Izgara hücresinin yüksekliği ölçülen genişlikten hesaplanır. Yüzde genişlik
  // (`width: '49%'`) ile `aspectRatio` birlikte kullanıldığında Yoga yüksekliği
  // 0'a indirebiliyor; bu da çoklu fotoğraflı gönderilerde görsellerin hiç
  // görünmemesine yol açıyordu. İlk karede pencere genişliğinden tahmin edilir.
  const [gridWidth, setGridWidth] = useState(0);
  const estimatedWidth = Math.max(1, Math.min(windowWidth - 40, 720));
  const gridCellHeight = Math.max(96, Math.round((gridWidth || estimatedWidth) * 0.49));
  // Tek görselli gönderilerde dikey fotoğraf, sütun genişliği kadar
  // yükseliyordu; geniş ekranlarda ekranın tamamını kaplamasın diye üst sınır.
  const singleMediaMaxHeight = Math.round(Math.min(viewportHeight * 0.72, 620));

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
            maxHeight: singleMediaMaxHeight,
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
    <View
      style={styles.grid}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.width);
        if (next > 0 && next !== gridWidth) {
          setGridWidth(next);
        }
      }}
    >
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
                height: gridCellHeight,
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

function liveMediaRatio(media: PostMedia): number {
  if (media.width && media.height) {
    return Math.min(Math.max(media.width / media.height, 0.56), 1.78);
  }
  return media.media_type === 'video' ? 16 / 9 : 1;
}

/**
 * Anlık gelişme medyası. Yatay video kırpılmaz (contain), dikey görüntü akışı
 * gereksiz uzatmadan kapsanır.
 */
function LiveNewsMediaBlock({
  media,
  postId,
  onOpen,
}: {
  media: PostMedia[];
  postId: string;
  onOpen: (index: number) => void;
}) {
  const { theme } = useTheme();
  const { height: viewportHeight } = useWindowDimensions();
  if (media.length === 0) return null;

  if (media.length > 1) {
    return <PostMediaBlock media={media} postId={postId} onOpen={onOpen} />;
  }

  const item = media[0]!;
  const uri = publicMediaUrl('posts', item.storage_path);
  const posterUri = publicMediaUrl('posts', item.thumbnail_path);
  if (!uri) return null;

  const naturalRatio = liveMediaRatio(item);
  const isWideVideo = item.media_type === 'video' && naturalRatio > 1.15;
  const ratio = Math.min(Math.max(naturalRatio, 0.66), 1.6);
  const maxHeight = Math.round(Math.min(viewportHeight * 0.66, 580));

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="Anlık gelişme medyasını tam ekran aç"
      onPress={() => onOpen(0)}
      style={({ pressed }) => [
        styles.newsMedia,
        {
          aspectRatio: ratio,
          maxHeight,
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
          <View style={styles.videoBadge}>
            <Ionicons name="play" size={13} color="#FFFFFF" />
            <AppText variant="caption" color="#FFFFFF">
              Video
            </AppText>
          </View>
        </>
      ) : (
        <AppImage
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recycleKey={`live-${postId}-${item.id}`}
        />
      )}
      {isWideVideo ? (
        <View style={styles.mediaCountBadge}>
          <Ionicons name="expand-outline" size={12} color="#FFFFFF" />
          <AppText variant="caption" color="#FFFFFF">
            Tam görünüm
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Doğrulama rozeti: yalnızca gerçek editoryal durumu gösterir. */
function LiveNewsVerificationPill({ meta }: { meta: LiveNewsMeta }) {
  const { theme } = useTheme();
  const status = meta.verification_status;
  const tone =
    status === 'verified'
      ? {
          bg: theme.colors.successSoft,
          fg: theme.colors.success,
          icon: 'checkmark-circle' as const,
        }
      : status === 'corrected'
        ? { bg: theme.colors.info + '22', fg: theme.colors.info, icon: 'create-outline' as const }
        : status === 'unverified'
          ? {
              bg: theme.colors.dangerSoft,
              fg: theme.colors.danger,
              icon: 'help-circle-outline' as const,
            }
          : status === 'reviewing'
            ? {
                bg: theme.colors.warningSoft,
                fg: theme.colors.warning,
                icon: 'time-outline' as const,
              }
            : status === 'removed'
              ? {
                  bg: theme.colors.dangerSoft,
                  fg: theme.colors.danger,
                  icon: 'close-circle-outline' as const,
                }
              : {
                  bg: theme.colors.primarySoft,
                  fg: theme.colors.primaryDeep,
                  icon: 'person-outline' as const,
                };

  return (
    <View style={[styles.verificationPill, { backgroundColor: tone.bg }]}>
      <Ionicons name={tone.icon} size={11} color={tone.fg} />
      <AppText variant="caption" color={tone.fg}>
        {LIVE_NEWS_VERIFICATION_LABELS[status]}
      </AppText>
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
  detail = false,
}: {
  post: FeedPost;
  onChange?: (next: FeedPost) => void;
  onDeleted?: (postId: string) => void;
  /**
   * Detay ekranında kart "önizleme" değil içeriğin kendisidir: haber/gelişme
   * bloklarındaki "Devamını Oku" çağrısı gizlenir ve blok kendi detayına
   * yönlendirmez. Aksi hâlde detaydan detaya sonsuz yığılma oluşuyordu.
   */
  detail?: boolean;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const { openReport } = useReportSheet();
  const { data: blockedIds } = useBlockedUserIds();

  const toggleLike = useTogglePostLike();
  const toggleSave = useTogglePostSave();
  const share = useSharePost();
  const remove = useDeletePost();
  const removeLiveNews = useDeleteLiveNews();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
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
      width: item.width,
      height: item.height,
    }))
    .filter((item) => item.uri);

  const openProfile = useCallback(() => {
    router.push(`/profile/${post.author_username}` as never);
  }, [post.author_username, router]);

  const source = post.source ?? null;
  const liveNews = post.live_news ?? null;
  const isLiveNews = liveNews !== null;
  const newsMeta = useMemo(() => resolveNewsMeta(post), [post]);
  const newsPreview = newsMeta ? previewText(newsMeta) : null;
  const isNews = !isLiveNews && newsMeta !== null;
  const palette = newsCategoryPalette(newsMeta?.category_slug);
  const openReader = useCallback(() => {
    haptics.tap();
    router.push(`/post/${post.id}` as never);
  }, [post.id, router]);
  const copyNewsLink = useCallback(async () => {
    await Clipboard.setStringAsync(
      isLiveNews ? liveNewsShareLink(post.id) : postShareLink(post.id),
    );
    haptics.success();
    Alert.alert('Bağlantı kopyalandı', 'Haber bağlantısı panoya kopyalandı.');
  }, [isLiveNews, post.id]);
  const openSource = useCallback(() => {
    if (!source?.url) return;
    haptics.tap();
    void openUrl(source.url);
  }, [source]);

  // Kaynak bilgisi ayrı şeritte gösterildiği için gövdedeki atıf satırları
  // kartta tekrarlanmaz (paylaşım metni yine tam gövdeyi kullanır).
  const bodyText = useMemo(
    () => (source?.url ? stripSourceLines(post.body) : post.body),
    [post.body, source?.url],
  );

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
    // Paylaşılan metin tek başına kaybolmasın: https bağlantısı her zaman
    // sonda durur, uygulama yüklüyse doğrudan gönderiye götürür.
    const link = isLiveNews ? liveNewsShareLink(post.id) : postShareLink(post.id);
    const snippet = shareSnippet(post.body);
    const outcome = await shareContent({
      title: `${authorName} · Trabzone`,
      message: `${authorName} (@${post.author_username}) Trabzone'da bir gönderi paylaştı.${
        snippet ? `\n\n${snippet}` : ''
      }\n\n${link}`,
      url: link,
    });
    // Sayaç yalnızca paylaşım gerçekten tamamlandığında artar. Önceden
    // paylaşım penceresi açılmadan (web'de hiç açılmıyordu) artırılıyordu.
    if (didShare(outcome)) {
      share.mutate(post.id);
    }
  }, [authorName, isLiveNews, post.author_username, post.body, post.id, share]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      isLiveNews ? 'Anlık haberi sil' : 'Gönderiyi sil',
      isLiveNews
        ? 'Bu gelişme akıştan, Reels’ten ve web sayfasından kaldırılacak. Emin misin?'
        : 'Bu gönderi kalıcı olarak silinecek. Emin misin?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => {
            if (isLiveNews) {
              removeLiveNews.mutate(post.id, {
                onSuccess: (result) => {
                  const paths = result.media.flatMap((item) =>
                    [item.storage_path, item.thumbnail_path].filter((path): path is string =>
                      Boolean(path),
                    ),
                  );
                  // Reels aynı fiziksel dosyayı paylaşır; ayrıca silinmez.
                  if (paths.length > 0) {
                    void removeMedia('posts', paths);
                  }
                  haptics.success();
                  onDeleted?.(post.id);
                },
                onError: (error) => Alert.alert('Silinemedi', error.message),
              });
              return;
            }
            remove.mutate(post.id, {
              onSuccess: () => onDeleted?.(post.id),
              onError: (error) => Alert.alert('Silinemedi', error.message),
            });
          },
        },
      ],
    );
  }, [isLiveNews, onDeleted, post.id, remove, removeLiveNews]);

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
              {post.author_is_child_protected ? <ChildProtectedBadge /> : null}
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
              {isLiveNews && liveNews?.district ? (
                <>
                  <AppText variant="caption" color="textTertiary">
                    ·
                  </AppText>
                  <Ionicons name="location-outline" size={12} color={theme.colors.textTertiary} />
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {liveNews.district}
                  </AppText>
                </>
              ) : post.city ? (
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

      {isLiveNews && liveNews ? (
        <Pressable
          accessibilityRole={detail ? undefined : 'button'}
          accessibilityLabel={detail ? undefined : `${liveNews.title} — anlık gelişmeyi aç`}
          disabled={detail}
          onPress={detail ? undefined : openReader}
          style={styles.newsText}
        >
          <View style={styles.chipRow}>
            <View style={[styles.chip, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="radio-outline" size={11} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep">
                Vatandaş Paylaşımı
              </AppText>
            </View>
            <View style={[styles.chip, styles.chipNeutral, { borderColor: theme.colors.border }]}>
              <AppText variant="caption" color="textSecondary">
                {categoryLabel(liveNews.category)}
              </AppText>
            </View>
            {liveNews.district ? (
              <View style={[styles.chip, styles.chipNeutral, { borderColor: theme.colors.border }]}>
                <Ionicons name="location-outline" size={11} color={theme.colors.textSecondary} />
                <AppText variant="caption" color="textSecondary">
                  {liveNews.district}
                </AppText>
              </View>
            ) : null}
            <LiveNewsVerificationPill meta={liveNews} />
          </View>

          <AppText variant="h2" style={styles.newsTitle} numberOfLines={detail ? undefined : 4}>
            {liveNews.title}
          </AppText>

          {liveNews.summary ? (
            <AppText
              variant="body"
              color="textSecondary"
              style={styles.newsPreview}
              numberOfLines={detail ? undefined : 4}
            >
              {liveNews.summary}
            </AppText>
          ) : null}

          {liveNews.moderation_status === 'pending' ? (
            <View style={[styles.liveNotice, { backgroundColor: theme.colors.warningSoft }]}>
              <Ionicons name="time-outline" size={13} color={theme.colors.warning} />
              <AppText variant="caption" color="textSecondary" style={styles.liveNoticeText}>
                Güvenlik kontrolü sürüyor. Editör onayından sonra akışta herkese görünür.
              </AppText>
            </View>
          ) : liveNews.verification_note &&
            (liveNews.verification_status === 'corrected' ||
              liveNews.verification_status === 'unverified') ? (
            <View style={[styles.liveNotice, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons
                name="information-circle-outline"
                size={13}
                color={theme.colors.textSecondary}
              />
              <AppText variant="caption" color="textSecondary" style={styles.liveNoticeText}>
                Editör notu: {liveNews.verification_note}
              </AppText>
            </View>
          ) : null}

          {detail ? null : (
            <View style={styles.readMoreRow}>
              <AppText variant="label" color="primary">
                Gelişmeyi aç
              </AppText>
              <Ionicons name="arrow-forward" size={15} color={theme.colors.primary} />
            </View>
          )}
        </Pressable>
      ) : isNews && newsMeta ? (
        <Pressable
          accessibilityRole={detail ? undefined : 'button'}
          accessibilityLabel={detail ? undefined : `${newsMeta.title} — haberi oku`}
          disabled={detail}
          onPress={detail ? undefined : openReader}
          style={styles.newsText}
        >
          <View style={styles.chipRow}>
            {newsMeta.category_name ? (
              <View style={[styles.chip, { backgroundColor: palette.soft }]}>
                <AppText variant="caption" color={palette.accent}>
                  {newsMeta.category_name}
                </AppText>
              </View>
            ) : null}
            {newsMeta.district ? (
              <View style={[styles.chip, styles.chipNeutral, { borderColor: theme.colors.border }]}>
                <Ionicons name="location-outline" size={11} color={theme.colors.textSecondary} />
                <AppText variant="caption" color="textSecondary">
                  {newsMeta.district}
                </AppText>
              </View>
            ) : null}
            {newsFormatLabel(newsMeta.body_format) ? (
              <AppText variant="caption" color="textTertiary">
                {newsFormatLabel(newsMeta.body_format)}
              </AppText>
            ) : null}
          </View>

          <AppText variant="h2" style={styles.newsTitle} numberOfLines={detail ? undefined : 4}>
            {newsMeta.title}
          </AppText>

          {newsMeta.spot ? (
            <AppText
              variant="body"
              color="textSecondary"
              style={styles.newsSpot}
              numberOfLines={detail ? undefined : 3}
            >
              {newsMeta.spot}
            </AppText>
          ) : null}

          {newsPreview && newsPreview !== newsMeta.spot ? (
            <AppText
              variant="body"
              color="textSecondary"
              style={styles.newsPreview}
              numberOfLines={
                detail ? undefined : Math.min(Math.max(newsMeta.preview_lines ?? 4, 2), 6)
              }
            >
              {newsPreview}
            </AppText>
          ) : null}

          {detail ? null : (
            <View style={styles.readMoreRow}>
              <AppText variant="label" color="primary">
                Devamını Oku
              </AppText>
              <Ionicons name="arrow-forward" size={15} color={theme.colors.primary} />
            </View>
          )}

          {newsMeta.source_count && newsMeta.source_count > 1 ? (
            <View style={styles.aiRow}>
              <Ionicons name="link-outline" size={12} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textTertiary">
                {newsMeta.source_count} kaynak
              </AppText>
            </View>
          ) : null}
        </Pressable>
      ) : isLiveNews ? null : bodyText ? (
        <AppText variant="body" style={styles.body}>
          {bodyText}
          {post.is_edited ? (
            <AppText variant="caption" color="textTertiary">
              {'  '}(düzenlendi)
            </AppText>
          ) : null}
        </AppText>
      ) : null}

      {isLiveNews ? (
        <LiveNewsMediaBlock
          media={post.media}
          postId={post.id}
          onOpen={(index) => {
            setViewerIndex(index);
            setViewerOpen(true);
          }}
        />
      ) : isNews ? (
        <NewsMediaBlock
          media={post.media}
          postId={post.id}
          preferContain={Boolean(source?.url)}
          onOpen={(index) => {
            setViewerIndex(index);
            setViewerOpen(true);
          }}
        />
      ) : (
        <PostMediaBlock
          media={post.media}
          postId={post.id}
          onOpen={(index) => {
            setViewerIndex(index);
            setViewerOpen(true);
          }}
        />
      )}

      {source?.url ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${source.name} — orijinal haberi tarayıcıda aç`}
          onPress={openSource}
          style={({ pressed }) => [
            styles.sourceCard,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceMuted,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          {source.logo_url ? (
            <AppImage
              source={{ uri: source.logo_url }}
              style={styles.sourceLogo}
              contentFit="contain"
              recycleKey={`src-${post.id}`}
            />
          ) : (
            <View
              style={[
                styles.sourceLogo,
                styles.sourceLogoFallback,
                { borderColor: theme.colors.border },
              ]}
            >
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {(source.name || '?').trim().charAt(0).toUpperCase()}
              </AppText>
            </View>
          )}
          <View style={styles.sourceText}>
            <View style={styles.sourceNameRow}>
              <AppText variant="bodyStrong" numberOfLines={1} style={styles.sourceName}>
                {source.name}
              </AppText>
              {source.verified ? (
                <Ionicons name="checkmark-circle" size={13} color={theme.colors.primary} />
              ) : null}
            </View>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {source.author
                ? `Haber: ${source.author}`
                : source.domain
                  ? `${source.domain} · orijinal habere git`
                  : 'Orijinal habere git'}
            </AppText>
          </View>
          <Ionicons name="open-outline" size={16} color={theme.colors.textTertiary} />
        </Pressable>
      ) : null}

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
        {/* Pasif metrik: yeni buton eklemez, beğeni/yorum/paylaşım ile aynı satırda. */}
        <ViewCount type="post" id={post.id} initial={post.view_count} />
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
                {
                  key: 'edit',
                  label: isLiveNews ? 'Anlık haberi düzenle' : 'Gönderiyi düzenle',
                  icon: 'create-outline' as const,
                },
                {
                  key: 'stats',
                  label: 'İçerik istatistikleri',
                  icon: 'eye-outline' as const,
                  description: 'Tekil görüntüleme, beğeni ve yorum özeti',
                },
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
          ...(isNews
            ? [
                {
                  key: 'save',
                  label: post.saved ? 'Kaydı kaldır' : 'Haberi kaydet',
                  icon: 'bookmark-outline' as const,
                },
                {
                  key: 'copy',
                  label: 'Bağlantıyı kopyala',
                  icon: 'link-outline' as const,
                },
                ...(source?.url
                  ? [
                      {
                        key: 'source',
                        label: 'Kaynağı görüntüle',
                        icon: 'open-outline' as const,
                      },
                    ]
                  : []),
              ]
            : []),
        ]}
        onClose={() => setMenuOpen(false)}
        onSelect={(key) => {
          setMenuOpen(false);
          if (key === 'delete') {
            confirmDelete();
          } else if (key === 'edit') {
            router.push(
              (isLiveNews
                ? `/compose/live-news?postId=${post.id}`
                : `/compose/post?postId=${post.id}`) as never,
            );
          } else if (key === 'stats') {
            afterSheetDismiss(() => setStatsOpen(true));
          } else if (key === 'profile') {
            openProfile();
          } else if (key === 'report') {
            afterSheetDismiss(() => {
              openReport({
                targetType: 'post',
                targetId: post.id,
                targetLabel: post.body?.slice(0, 60) || 'Gönderi',
              });
            });
          } else if (key === 'block') {
            confirmBlock();
          } else if (key === 'share') {
            void onShare();
          } else if (key === 'save') {
            onSave();
          } else if (key === 'copy') {
            void copyNewsLink();
          } else if (key === 'source') {
            // Menü kapanırken aynı karede tarayıcı kartını açmak kartın açılıp
            // anında kapanmasına ("sönmesine") yol açıyordu.
            afterSheetDismiss(openSource);
          }
        }}
      />

      {post.is_mine ? (
        <ContentStatsSheet
          visible={statsOpen}
          onClose={() => setStatsOpen(false)}
          type="post"
          id={post.id}
          title={post.body?.slice(0, 80) || 'Gönderi'}
        />
      ) : null}
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
  gridCell: { width: '49%', overflow: 'hidden' },
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
  sourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sourceLogo: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#FFFFFF' },
  sourceLogoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  sourceText: { flex: 1, gap: 1 },
  sourceNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourceName: { flexShrink: 1 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32 },
  actionSpacer: { flex: 1 },
  newsText: { gap: 8 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipNeutral: { borderWidth: StyleSheet.hairlineWidth, backgroundColor: 'transparent' },
  verificationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  liveNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  liveNoticeText: { flex: 1, lineHeight: 16 },
  newsTitle: { letterSpacing: -0.3 },
  newsSpot: { lineHeight: 21 },
  newsPreview: { lineHeight: 21 },
  readMoreRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 2 },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newsMedia: { width: '100%', overflow: 'hidden' },
  // Haber görseli kutusuz durur: kenarlar saydam, yalnızca yuvarlatılmış
  // görselin kendisi görünür (X'teki medya yerleşimi gibi).
  newsMediaWrap: { width: '100%' },
  newsVideo: { width: '100%', overflow: 'hidden' },
  containBadge: {
    position: 'absolute',
    right: 10,
    top: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  mediaCountBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(9,14,28,0.55)',
  },
});
