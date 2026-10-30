import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from '@/utils/router';

import {
  ActionSheet,
  AppImage,
  AppText,
  Avatar,
  IconButton,
  Screen,
  ScreenHeader,
} from '@/components/ui';
import { MarkdownView } from '@/features/blog/components/MarkdownView';
import { CommentsSheet } from '@/features/comments/components/CommentsSheet';
import { MediaViewer, type ViewerMedia } from '@/features/feed/components/MediaViewer';
import {
  usePost,
  useSharePost,
  useTogglePostLike,
  useTogglePostSave,
} from '@/features/feed/hooks/use-feed';
import { openUrl } from '@/features/in-app-browser';
import { publicMediaUrl } from '@/features/media/media-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { postShareLink, shareSnippet } from '@/features/share/links';
import { didShare, shareContent } from '@/features/share/share-action';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { ViewCount } from '@/features/views/components/ViewCount';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr, formatDateTimeTr, formatRelativeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';
import { afterSheetDismiss } from '@/utils/sheet';

import { newsCategoryPalette, newsFormatLabel } from '../category-theme';
import { useNewsRelated } from '../hooks/use-news-reader';
import { polishNewsText } from '../news-text';
import type { NewsDetail, NewsRelatedItem } from '../types';
import { NewsImageFrame } from './NewsImageFrame';

const FONT_SCALE_KEY = 'trabzone.news.reader.fontScale';
const READER_MODE_KEY = 'trabzone.news.reader.compact';

function clampScale(value: number): number {
  return Math.min(Math.max(Math.round(value * 100) / 100, 0.9), 1.4);
}

function isUsableUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function sourceKindLabel(kind: string | null | undefined): string {
  if (kind === 'official') return 'Resmî';
  if (kind === 'trusted_media') return 'Medya';
  if (kind === 'low_trust') return 'Düşük güven';
  return 'Kaynak';
}

export function NewsReaderScreen({
  detail,
  initialCommentsOpen = false,
}: {
  detail: NewsDetail;
  initialCommentsOpen?: boolean;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const { openReport } = useReportSheet();
  const { height: viewportHeight, width: viewportWidth } = useWindowDimensions();
  const post = usePost(detail.post_id);
  const related = useNewsRelated(detail.post_id);
  const toggleLike = useTogglePostLike();
  const toggleSave = useTogglePostSave();
  const share = useSharePost();

  const [commentsOpen, setCommentsOpen] = useState(initialCommentsOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [fontScale, setFontScale] = useState(1);
  const [compact, setCompact] = useState(false);

  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const scrollOffset = useRef(0);
  const contentHeight = useRef(0);
  const restored = useRef(false);
  const storageKey = `trabzone.news.scroll.${detail.post_id}`;

  const postState = post.data ?? null;
  const liked = postState?.liked ?? false;
  const saved = postState?.saved ?? false;
  const likeCount = postState?.like_count ?? detail.counts.like ?? 0;
  const commentCount = postState?.comment_count ?? detail.counts.comment ?? 0;
  const shareCount = postState?.share_count ?? detail.counts.share ?? 0;

  const palette = newsCategoryPalette(detail.category_slug);
  const formatLabel = newsFormatLabel(detail.body_format);
  const publisherName = detail.publisher.display_name ?? 'Trabzone Haber';
  const publisherAvatar = mediaPublicUrl('avatar', detail.publisher.avatar_path);
  const isUpdated =
    Boolean(detail.updated_at && detail.published_at) &&
    new Date(detail.updated_at as string).getTime() -
      new Date(detail.published_at as string).getTime() >
      60_000;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [storedScale, storedMode] = await Promise.all([
          AsyncStorage.getItem(FONT_SCALE_KEY),
          AsyncStorage.getItem(READER_MODE_KEY),
        ]);
        if (!active) return;
        if (storedScale) setFontScale(clampScale(Number(storedScale)));
        if (storedMode) setCompact(storedMode === '1');
      } catch {
        // Okuma tercihleri kritik değil; varsayılanlarla devam edilir.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Okuma konumu: kullanıcı geri dönüp haberi yeniden açtığında kaldığı yerden devam eder.
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey)
      .then((value) => {
        const offset = Number(value);
        if (!active || !Number.isFinite(offset) || offset < 120) return;
        scrollOffset.current = offset;
        setTimeout(() => {
          scrollRef.current?.scrollTo({ y: offset, animated: false });
          restored.current = true;
        }, 220);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      void AsyncStorage.setItem(storageKey, String(Math.round(scrollOffset.current))).catch(
        () => undefined,
      );
    };
  }, [storageKey]);

  const changeScale = useCallback((delta: number) => {
    haptics.tap();
    setFontScale((current) => {
      const next = clampScale(current + delta);
      void AsyncStorage.setItem(FONT_SCALE_KEY, String(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const toggleCompact = useCallback(() => {
    setCompact((current) => {
      const next = !current;
      void AsyncStorage.setItem(READER_MODE_KEY, next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, []);

  const onLike = useCallback(() => {
    haptics.tap();
    toggleLike.mutate(detail.post_id, {
      onError: (error) => Alert.alert('Beğenilemedi', error.message),
    });
  }, [detail.post_id, toggleLike]);

  const onSave = useCallback(() => {
    haptics.tap();
    toggleSave.mutate(detail.post_id, {
      onError: (error) => Alert.alert('Kaydedilemedi', error.message),
    });
  }, [detail.post_id, toggleSave]);

  const onShare = useCallback(async () => {
    haptics.tap();
    const link = postShareLink(detail.post_id);
    const outcome = await shareContent({
      title: detail.title,
      message: `${detail.title}\n\n${shareSnippet(detail.summary ?? detail.lead ?? '')}\n\n${link}`,
      url: link,
    });
    if (didShare(outcome)) share.mutate(detail.post_id);
  }, [detail.lead, detail.post_id, detail.summary, detail.title, share]);

  const onCopy = useCallback(async () => {
    await Clipboard.setStringAsync(postShareLink(detail.post_id));
    haptics.success();
    Alert.alert('Bağlantı kopyalandı', 'Haber bağlantısı panoya kopyalandı.');
  }, [detail.post_id]);

  const openSource = useCallback((url: string | null | undefined) => {
    if (!isUsableUrl(url)) return;
    haptics.tap();
    void openUrl(url).then((opened) => {
      if (!opened) {
        Alert.alert('Bağlantı açılamadı', 'Kaynak adresi bu cihazda açılamıyor.');
      }
    });
  }, []);

  const groupAvatar = useCallback(() => {
    if (detail.publisher.username) {
      router.push(`/profile/${detail.publisher.username}` as never);
    }
  }, [detail.publisher.username, router]);

  const viewerMedia = useMemo<ViewerMedia[]>(
    () =>
      detail.media
        .map((item) => ({
          id: item.id,
          uri: publicMediaUrl('posts', item.storage_path) ?? '',
          media_type: item.media_type,
          thumbnailUri: publicMediaUrl('posts', item.thumbnail_path),
          width: item.width,
          height: item.height,
        }))
        .filter((item) => item.uri),
    [detail.media],
  );

  const hero = detail.media[0] ?? null;
  const heroUri = hero ? publicMediaUrl('posts', hero.storage_path) : null;  const heroRatio =
    hero?.width && hero?.height
      ? hero.width / hero.height
      : hero?.media_type === 'video'
        ? 16 / 9
        : 1.6;
  const heroClamped = Math.min(Math.max(heroRatio, 0.66), 1.9);
  const heroMaxHeight = Math.round(Math.min(viewportHeight * 0.68, 640));

  // Özet kalmış haberlerde gövde, giriş + özetin aynısıdır. Aynı metni üç kez
  // göstermek yerine gövde atlanır; kaynak bağlantısı sayfanın altında kalır.
  const bodyText = useMemo(() => polishNewsText(detail.body), [detail.body]);
  const leadText = useMemo(() => polishNewsText(detail.lead), [detail.lead]);
  const summaryText = useMemo(() => polishNewsText(detail.summary), [detail.summary]);
  const bodyIsRepeated = useMemo(() => {
    if (!bodyText) return true;
    const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    const parts = [leadText, summaryText].filter(Boolean).map(norm);
    if (parts.length === 0) return false;
    const bodyNorm = norm(bodyText);
    const combined = parts.join(' ');
    return bodyNorm.length <= combined.length + 80 && parts.every((part) => bodyNorm.includes(part));
  }, [bodyText, leadText, summaryText]);

  const menuItems = [
    { key: 'share', label: 'Haberi paylaş', icon: 'share-social-outline' as const },
    {
      key: 'save',
      label: saved ? 'Kaydı kaldır' : 'Haberi kaydet',
      icon: 'bookmark-outline' as const,
    },
    { key: 'copy', label: 'Bağlantıyı kopyala', icon: 'link-outline' as const },
    ...(detail.sources[0]?.url
      ? [{ key: 'source', label: 'Kaynağı görüntüle', icon: 'open-outline' as const }]
      : []),
    {
      key: 'compact',
      label: compact ? 'Tam görünüme dön' : 'Sade okuma modu',
      icon: 'reader-outline' as const,
    },
    { key: 'report', label: 'Haberi bildir', icon: 'flag-outline' as const, destructive: true },
  ];

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      scroll
      scrollRef={scrollRef}
      scrollEventThrottle={64}
      contentContainerStyle={[styles.content, styles.reader]}
      onScroll={(event) => {
        scrollOffset.current = event.nativeEvent.contentOffset.y;
        contentHeight.current = event.nativeEvent.contentSize.height;
        if (!restored.current) restored.current = true;
      }}
    >
      <ScreenHeader
        title={publisherName}
        subtitle={detail.publisher.is_verified ? 'Doğrulanmış yayıncı' : 'Haber'}
        onBack={() => router.back()}
        right={
          <View style={styles.headerActions}>
            <IconButton
              name="share-social-outline"
              accessibilityLabel="Haberi paylaş"
              size={21}
              style={styles.headerButton}
              onPress={() => void onShare()}
            />
            <IconButton
              name={saved ? 'bookmark' : 'bookmark-outline'}
              accessibilityLabel={saved ? 'Kaydı kaldır' : 'Haberi kaydet'}
              size={21}
              color={saved ? theme.colors.primary : theme.colors.text}
              style={styles.headerButton}
              onPress={onSave}
            />
            <IconButton
              name="ellipsis-horizontal"
              accessibilityLabel="Haber seçenekleri"
              size={21}
              style={styles.headerButton}
              onPress={() => setMenuOpen(true)}
            />
          </View>
        }
      />

      <View style={styles.chipRow}>
        {detail.category_name ? (
          <View style={[styles.chip, { backgroundColor: palette.soft }]}>
            <AppText variant="caption" color={palette.accent}>
              {detail.category_name}
            </AppText>
          </View>
        ) : null}
        {detail.district ? (
          <View style={[styles.chip, styles.chipNeutral, { borderColor: theme.colors.border }]}>
            <Ionicons name="location-outline" size={11} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">
              {detail.district}
            </AppText>
          </View>
        ) : null}
        {formatLabel ? (
          <AppText variant="caption" color="textTertiary">
            {formatLabel} · {detail.reading_minutes} dk okuma
          </AppText>
        ) : null}
      </View>

      <AppText variant={viewportWidth >= 900 ? 'display' : 'h1'} style={styles.title}>
        {detail.title}
      </AppText>

      {detail.subtitle ? (
        <AppText variant="title" color="textSecondary" style={styles.subtitle}>
          {detail.subtitle}
        </AppText>
      ) : null}

      {summaryText ? (
        <AppText variant="body" color="textSecondary" style={styles.summary}>
          {summaryText}
        </AppText>
      ) : null}

      <View style={styles.byline}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${publisherName} profilini aç`}
          onPress={groupAvatar}
          style={styles.bylinePerson}
        >
          <Avatar
            uri={publisherAvatar}
            name={publisherName}
            size={34}
            recycleKey={detail.publisher.username}
          />
          <View style={styles.bylineText}>
            <View style={styles.nameRow}>
              <AppText variant="label" numberOfLines={1}>
                {publisherName}
              </AppText>
              {detail.publisher.is_verified ? (
                <Ionicons name="checkmark-circle" size={13} color={theme.colors.primary} />
              ) : null}
            </View>
            <AppText variant="caption" color="textTertiary">
              @{detail.publisher.username} ·{' '}
              {detail.published_at
                ? formatDateTimeTr(detail.published_at)
                : formatDateTr(new Date())}
            </AppText>
          </View>
        </Pressable>
        <View style={styles.readerTools}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yazıyı küçült"
            disabled={fontScale <= 0.9}
            onPress={() => changeScale(-0.1)}
            style={styles.toolButton}
          >
            <AppText variant="caption" color={fontScale <= 0.9 ? 'textTertiary' : 'text'}>
              A-
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yazıyı büyüt"
            disabled={fontScale >= 1.4}
            onPress={() => changeScale(0.1)}
            style={styles.toolButton}
          >
            <AppText variant="caption" color={fontScale >= 1.4 ? 'textTertiary' : 'text'}>
              A+
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={compact ? 'Tam görünüme dön' : 'Sade okuma modu'}
            onPress={toggleCompact}
            style={styles.toolButton}
          >
            <Ionicons
              name={compact ? 'reader' : 'reader-outline'}
              size={15}
              color={compact ? theme.colors.primary : theme.colors.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      <View style={styles.readerMeta}>
        <ViewCount type="post" id={detail.post_id} initial={postState?.view_count} showLabel />
      </View>

      {!compact && hero && heroUri ? (
        hero.media_type === 'video' ? (
          <View
            style={[
              styles.hero,
              {
                aspectRatio: heroClamped,
                maxHeight: heroMaxHeight,
                backgroundColor: theme.colors.surfaceMuted,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            {publicMediaUrl('posts', hero.thumbnail_path) ? (
              <AppImage
                source={{ uri: publicMediaUrl('posts', hero.thumbnail_path) ?? undefined }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                recycleKey={`reader-video-poster-${detail.post_id}`}
              />
            ) : null}
            <HeroVideo uri={heroUri} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel="Haber görselini tam ekran aç"
            onPress={() => {
              setViewerIndex(0);
              setViewerOpen(true);
            }}
            style={({ pressed }) => [styles.heroWrap, { opacity: pressed ? 0.94 : 1 }]}
          >
            {/* X'teki gibi kutusuz: görsel kendi oranında, yuvarlatılmış
                köşelerle ve saydam kenarlarla durur. */}
            <NewsImageFrame
              uri={heroUri}
              width={hero?.width ?? null}
              height={hero?.height ?? null}
              fit={hero?.display_fit && hero.display_fit !== 'auto' ? hero.display_fit : 'contain'}
              maxHeight={heroMaxHeight}
              radius={theme.radius.lg}
              maxWidth={720}
              recycleKey={`reader-${detail.post_id}`}
            >
              {detail.media.length > 1 ? (
                <View style={styles.heroCount}>
                  <Ionicons name="images-outline" size={12} color="#FFFFFF" />
                  <AppText variant="caption" color="#FFFFFF">
                    {detail.media.length}
                  </AppText>
                </View>
              ) : null}
            </NewsImageFrame>
          </Pressable>
        )
      ) : null}

      {leadText ? (
        <View style={[styles.lead, { borderLeftColor: palette.accent }]}>
          <AppText variant="title" style={styles.leadText}>
            {leadText}
          </AppText>
        </View>
      ) : null}

      {bodyText && !bodyIsRepeated ? (
        <View style={styles.body}>
          <MarkdownView markdown={bodyText} textScale={fontScale} />
        </View>
      ) : null}

      <View
        style={[
          styles.imprint,
          { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
        ]}
      >
        <AppText variant="label" color="textSecondary">
          Künye
        </AppText>
        <ImprintRow label="Yayıncı" value={publisherName} />
        <ImprintRow
          label="Konum"
          value={detail.district ? `${detail.district}, Trabzon` : 'Trabzon'}
        />
        {detail.category_name ? (
          <ImprintRow label="Kategori" value={detail.category_name} />
        ) : null}
        {detail.published_at ? (
          <ImprintRow label="Yayın" value={formatDateTimeTr(detail.published_at)} />
        ) : null}
        {isUpdated ? (
          <ImprintRow label="Güncelleme" value={formatDateTimeTr(detail.updated_at)} />
        ) : null}
        {hero?.attribution || hero?.credit ? (
          <ImprintRow label="Fotoğraf" value={hero.attribution ?? hero.credit ?? ''} />
        ) : null}
        {detail.sources.length > 0 ? (
          <View style={styles.imprintRow}>
            <AppText variant="caption" color="textTertiary" style={styles.imprintLabel}>
              {detail.sources.length > 1 ? 'Kaynaklar' : 'Kaynak'}
            </AppText>
            <View style={styles.imprintSources}>
              {detail.sources.map((source, index) => (
                <Pressable
                  key={`${source.url}-${index}`}
                  accessibilityRole="link"
                  accessibilityLabel={`${source.name ?? source.domain} kaynağını aç`}
                  onPress={() => openSource(source.url)}
                  style={({ pressed }) => [styles.imprintSource, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <AppText variant="caption" color="primary" numberOfLines={1} style={styles.flex}>
                    {source.name ?? source.domain}
                    {source.kind === 'official' ? ` · ${sourceKindLabel(source.kind)}` : ''}
                  </AppText>
                  <Ionicons name="open-outline" size={12} color={theme.colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>

      <View style={[styles.actionBar, { borderColor: theme.colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Haberi beğen, ${likeCount} beğeni`}
          onPress={onLike}
          style={styles.action}
        >
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={21}
            color={liked ? theme.colors.danger : theme.colors.textSecondary}
          />
          <AppText variant="caption" color={liked ? 'danger' : 'textSecondary'}>
            {likeCount > 0 ? String(likeCount) : 'Beğen'}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Yorumları aç, ${commentCount} yorum`}
          onPress={() => setCommentsOpen(true)}
          style={styles.action}
        >
          <Ionicons name="chatbubble-outline" size={20} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary">
            {commentCount > 0 ? String(commentCount) : 'Yorum'}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Haberi paylaş"
          onPress={() => void onShare()}
          style={styles.action}
        >
          <Ionicons name="paper-plane-outline" size={20} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary">
            {shareCount > 0 ? String(shareCount) : 'Paylaş'}
          </AppText>
        </Pressable>
        <View style={styles.flex} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Kaydı kaldır' : 'Haberi kaydet'}
          onPress={onSave}
          style={styles.action}
        >
          <Ionicons
            name={saved ? 'bookmark' : 'bookmark-outline'}
            size={20}
            color={saved ? theme.colors.primary : theme.colors.textSecondary}
          />
        </Pressable>
      </View>

      {related.data && related.data.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <AppText variant="h3">İlgili Haberler</AppText>
            <AppText variant="caption" color="textTertiary">
              Aynı gündem ve bölgeden
            </AppText>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.relatedRow}
          >
            {related.data.map((item) => (
              <RelatedCard
                key={item.post_id}
                item={item}
                onPress={() => router.push(`/post/${item.post_id}` as never)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <CommentsSheet
        visible={commentsOpen}
        contentType="post"
        contentId={detail.post_id}
        commentCount={commentCount}
        onClose={() => setCommentsOpen(false)}
      />

      <MediaViewer
        visible={viewerOpen}
        media={viewerMedia}
        startIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
      />

      <ActionSheet
        visible={menuOpen}
        title="Haber"
        items={menuItems}
        onClose={() => setMenuOpen(false)}
        onSelect={(key) => {
          setMenuOpen(false);
          if (key === 'share') void onShare();
          else if (key === 'save') onSave();
          else if (key === 'copy') void onCopy();
          else if (key === 'source') {
            // Menü kapanırken aynı karede uygulama içi tarayıcı kartını açmak
            // kartın açılıp anında kapanmasına yol açıyordu.
            afterSheetDismiss(() => openSource(detail.sources[0]?.url));
          } else if (key === 'compact') toggleCompact();
          else if (key === 'report') {
            afterSheetDismiss(() => {
              openReport({
                targetType: 'post',
                targetId: detail.post_id,
                targetLabel: detail.title.slice(0, 60),
              });
            });
          }
        }}
      />
    </Screen>
  );
}

function HeroVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = false;
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls
      surfaceType="textureView"
    />
  );
}

function ImprintRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.imprintRow}>
      <AppText variant="caption" color="textTertiary" style={styles.imprintLabel}>
        {label}
      </AppText>
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {value}
      </AppText>
    </View>
  );
}

function RelatedCard({ item, onPress }: { item: NewsRelatedItem; onPress: () => void }) {
  const { theme } = useTheme();
  const palette = newsCategoryPalette(null);
  const uri = publicMediaUrl('posts', item.media_path);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title} haberini oku`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.relatedCard,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.relatedImage, { backgroundColor: palette.soft }]}>
        {uri ? (
          <AppImage
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit={item.media_fit === 'contain' ? 'contain' : 'cover'}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.relatedPlaceholder]}>
            <Ionicons name="newspaper-outline" size={22} color={palette.accent} />
          </View>
        )}
      </View>
      <View style={styles.relatedBody}>
        {item.category_name ? (
          <AppText variant="caption" color={palette.accent} numberOfLines={1}>
            {item.category_name}
            {item.district ? ` · ${item.district}` : ''}
          </AppText>
        ) : null}
        <AppText variant="label" numberOfLines={3}>
          {item.title}
        </AppText>
        <AppText variant="caption" color="textTertiary">
          {formatRelativeTr(item.published_at)}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingBottom: 40 },
  // Web'de tam genişlik metin okunaksız olur; editoryal sütun genişliği.
  reader: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerButton: { width: 34, height: 34 },
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
  title: { letterSpacing: -0.5 },
  subtitle: { lineHeight: 24 },
  summary: { fontSize: 16, lineHeight: 25 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  bylinePerson: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  bylineText: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readerTools: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readerMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  toolButton: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 6,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { width: '100%', overflow: 'hidden' },
  heroWrap: { width: '100%' },
  heroCount: {
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
  lead: { borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 2 },
  leadText: { lineHeight: 25 },
  body: { paddingTop: 4 },
  section: { gap: 10, paddingTop: 8 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  imprint: {
    gap: 6,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  imprintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  imprintLabel: { width: 82 },
  imprintSources: { flex: 1, gap: 4 },
  imprintSource: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 34 },
  relatedRow: { gap: 10, paddingVertical: 2 },
  relatedCard: {
    width: 235,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  relatedImage: { width: '100%', height: 132 },
  relatedPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  relatedBody: { padding: 10, gap: 4 },
  flex: { flex: 1 },
});
