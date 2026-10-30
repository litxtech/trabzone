import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import { useRouter } from '@/utils/router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { FeedHeader } from '@/components/navigation/FeedHeader';
import { AppText, Screen, Skeleton } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { PostCard } from '@/features/feed/components/PostCard';
import { StoriesRail } from '@/features/feed/components/StoriesRail';
import { StoryViewer } from '@/features/feed/components/StoryViewer';
import { LiveNewsRail } from '@/features/live-news/components/LiveNewsRail';
import { useTabScrollTop } from '@/features/navigation/tab-scroll';
import { MatchCenterFeedCard } from '@/features/sports/components/MatchCenterFeedCard';
import { useFeed } from '@/features/feed/hooks/use-feed';
import type { FeedPost } from '@/features/feed/services/feed-service';
import type { StoryGroup } from '@/features/feed/services/stories-service';
import { trackContentViews, useViewSettings } from '@/features/views/use-content-views';
import {
  AdPlacementSlot,
  interleaveRows,
  useAdPlacement,
  type AdPlacementKey,
  type AdRow,
} from '@/features/ads';

const AD_PLACEMENT: AdPlacementKey = 'feed_home';

export default function FeedScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const listRef = useRef<FlashListRef<AdRow<FeedPost>>>(null);

  const [story, setStory] = useState<{ group: StoryGroup; index: number } | null>(null);

  const feed = useFeed('all', null);
  const viewSettings = useViewSettings();

  // Alt menüde "Akış" sekmesine yeniden basıldığında liste başa sarılır;
  // akışın en altına inen kullanıcı tek dokunuşla yukarı döner.
  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToTop({ animated: true });
  }, []);
  useTabScrollTop('feed', scrollToTop);

  // Nöbetçi eczane kısayolu akıştan kaldırıldı: sağlık kısayolları hamburger
  // menüsünde (DrawerMenu → Sağlık) tek yerden yönetiliyor. Böylece akışın
  // üstü eczane duyurusuyla kaplanmaz ve iki farklı yerde tekrar etmez.
  const posts = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);
  const adPlacement = AD_PLACEMENT;
  const ads = useAdPlacement(adPlacement, posts.length);
  const rows = useMemo(
    () => interleaveRows(posts, ads.positions, (post) => post.id),
    [ads.positions, posts],
  );

  // Gerçek görüntüleme: kart en az %50 görünür ve eşik süresi kadar ekranda
  // kalmalı. Arka plan sekmesinde zamanlayıcı çalışmaz; kayıt sunucuda
  // hesap bazlı olarak tekilleştirilir.
  const viewabilityConfig = useMemo(
    () => ({
      itemVisiblePercentThreshold: Math.round(
        Math.min(Math.max(viewSettings.min_visible_ratio, 0.1), 1) * 100,
      ),
      minimumViewTime: Math.max(0, viewSettings.min_visible_ms),
    }),
    [viewSettings.min_visible_ratio, viewSettings.min_visible_ms],
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<AdRow<FeedPost>>[] }) => {
      const visible = viewableItems
        .filter((entry) => entry.isViewable && entry.item?.type === 'item')
        .map((entry) => ({
          type: 'post' as const,
          id: (entry.item as Extract<AdRow<FeedPost>, { type: 'item' }>).item.id,
          surface: 'feed',
        }));
      if (visible.length > 0) {
        void trackContentViews(visible);
      }
    },
    [],
  );

  const refresh = useCallback(() => {
    void feed.refetch();
  }, [feed]);

  // Sabit referanslar: StoryViewer'in zamanlayicisi ve video efektleri her
  // parent render'inda yeniden kurulmasin (yoksa ilerleme cubugu basa doner).
  const closeStory = useCallback(() => setStory(null), []);
  const openStory = useCallback((group: StoryGroup, index: number) => {
    setStory({ group, index });
  }, []);
  const openStoryComposer = useCallback(() => {
    router.push('/compose/story' as never);
  }, [router]);

  const renderRow = useCallback(
    ({ item }: { item: AdRow<FeedPost> }) =>
      item.type === 'item' ? (
        <View style={styles.cardWrap}>
          <PostCard post={item.item} />
          <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
        </View>
      ) : (
        <View style={styles.cardWrap}>
          <AdPlacementSlot
            slot={ads.slotAt(item.after)}
            placement={adPlacement}
            onHide={ads.hide}
            style={styles.adSlot}
          />
          <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
        </View>
      ),
    [adPlacement, ads, theme.colors.divider],
  );

  const header = (
    <View>
      <View style={styles.storiesWrap}>
        <StoriesRail onCreate={openStoryComposer} onOpen={openStory} />
      </View>

      <MatchCenterFeedCard />

      <LiveNewsRail />
    </View>
  );

  const empty = (
    <View style={styles.empty}>
      {feed.isError ? (
        <Ionicons name="cloud-offline-outline" size={30} color={theme.colors.textSecondary} />
      ) : (
        <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="sparkles-outline" size={26} color={theme.colors.primaryDeep} />
        </View>
      )}
      <AppText variant="h3" align="center">
        {feed.isError ? 'Akış yüklenemedi' : 'Akış henüz sakin'}
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        {feed.isError
          ? 'Bağlantını kontrol edip tekrar dene.'
          : 'İlk gönderiyi paylaşarak Trabzone topluluğunu başlat.'}
      </AppText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={feed.isError ? 'Tekrar dene' : 'Gönderi paylaş'}
        onPress={() => (feed.isError ? refresh() : router.push('/compose/post' as never))}
        style={({ pressed }) => [
          styles.emptyButton,
          {
            backgroundColor: theme.colors.primary,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Ionicons
          name={feed.isError ? 'refresh' : 'add'}
          size={17}
          color={theme.colors.onPrimary}
        />
        <AppText variant="label" color="onPrimary">
          {feed.isError ? 'Tekrar dene' : 'Gönderi paylaş'}
        </AppText>
      </Pressable>
    </View>
  );

  return (
    <Screen edges={['left', 'right']} padded={false}>
      {/* Sabit kompakt baslik: kaydirma listesinin disinda yasar, bu yuzden
          akis kaydirilirken yerinden oynamaz ve scroll konumu korunur. */}
      <FeedHeader />

      {feed.isLoading ? (
        <View style={styles.loading}>
          {[0, 1, 2].map((key) => (
            <View key={key} style={styles.skeletonCard}>
              <View style={styles.skeletonHead}>
                <Skeleton height={42} width={42} radius={21} />
                <View style={styles.skeletonHeadText}>
                  <Skeleton height={12} width="45%" radius={4} />
                  <Skeleton height={10} width="30%" radius={4} />
                </View>
              </View>
              <Skeleton height={14} width="88%" radius={4} />
              <Skeleton height={200} radius={18} />
            </View>
          ))}
        </View>
      ) : (
        <FlashList
          ref={listRef}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={styles.list}
          data={rows}
          renderItem={renderRow}
          keyExtractor={(row) => row.key}
          getItemType={(row) => row.type}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          // Hizli kaydirirken hucrelerin bos kalmamasi icin gorunum disinda
          // biraz daha fazla icerik hazir tutulur (FlashList varsayilani 250px).
          drawDistance={450}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) {
              void feed.fetchNextPage();
            }
          }}
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching && !feed.isFetchingNextPage}
              onRefresh={refresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          ListFooterComponent={
            feed.isFetchingNextPage ? (
              <ActivityIndicator color={theme.colors.primary} style={styles.footerLoader} />
            ) : posts.length > 0 && !feed.hasNextPage ? (
              <AppText variant="caption" color="textTertiary" align="center" style={styles.endText}>
                Akışın sonuna geldin
              </AppText>
            ) : null
          }
        />
      )}

      <StoryViewer
        key={story ? `${story.group.author_id}-${story.index}` : 'closed'}
        group={story?.group ?? null}
        startIndex={story?.index ?? 0}
        onClose={closeStory}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Geniş ekranlarda akış tüm pencereye yayılmaz; okunabilir bir sütunda kalır.
  list: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  // Hikayeler basligin hemen altindan baslar; arada bos bir bant yok.
  storiesWrap: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 10 },
  listContent: { paddingBottom: 28 },
  cardWrap: { paddingHorizontal: 20 },
  adSlot: { paddingVertical: 14 },
  divider: { height: StyleSheet.hairlineWidth },
  loading: { paddingHorizontal: 20, gap: 22, paddingTop: 8 },
  skeletonCard: { gap: 10 },
  skeletonHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  skeletonHeadText: { gap: 6 },
  empty: { paddingHorizontal: 40, paddingTop: 40, paddingBottom: 30, alignItems: 'center', gap: 8 },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    marginTop: 10,
  },
  footerLoader: { paddingVertical: 20 },
  endText: { paddingVertical: 22 },
});
