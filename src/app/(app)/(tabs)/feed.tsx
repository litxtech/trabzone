import { Ionicons } from '@expo/vector-icons';
import { FlashList, type ViewToken } from '@shopify/flash-list';
import { useRouter } from '@/utils/router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { FeedHeader } from '@/components/navigation/FeedHeader';
import { AppText, Screen, Skeleton } from '@/components/ui';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { PROVINCES } from '@/features/profile/constants/regions';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { PostCard } from '@/features/feed/components/PostCard';
import { StoriesRail } from '@/features/feed/components/StoriesRail';
import { StoryViewer } from '@/features/feed/components/StoryViewer';
import { useFeed } from '@/features/feed/hooks/use-feed';
import type { FeedFilter, FeedPost } from '@/features/feed/services/feed-service';
import type { StoryGroup } from '@/features/feed/services/stories-service';
import { trackContentViews, useViewSettings } from '@/features/views/use-content-views';

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'nearby', label: 'Yakınımda' },
  { key: 'following', label: 'Takip' },
  { key: 'popular', label: 'Popüler' },
];

export default function FeedScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { data: profile } = useMyProfile();

  const [filter, setFilter] = useState<FeedFilter>('all');
  const [city, setCity] = useState<string | null>(null);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [story, setStory] = useState<{ group: StoryGroup; index: number } | null>(null);

  const effectiveCity = filter === 'nearby' ? (city ?? profile?.city ?? null) : null;
  const feed = useFeed(filter, effectiveCity);
  const viewSettings = useViewSettings();

  const posts = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);

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
    ({ viewableItems }: { viewableItems: ViewToken<FeedPost>[] }) => {
      const visible = viewableItems
        .filter((entry) => entry.isViewable && entry.item)
        .map((entry) => ({ type: 'post' as const, id: entry.item.id, surface: 'feed' }));
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

  const onSelectFilter = useCallback(
    (next: FeedFilter) => {
      haptics.selection();
      setFilter(next);
      if (next === 'nearby' && !city && !profile?.city) {
        setCityPickerOpen(true);
      }
    },
    [city, profile?.city],
  );

  const renderPost = useCallback(
    ({ item }: { item: FeedPost }) => (
      <View style={styles.cardWrap}>
        <PostCard post={item} />
        <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
      </View>
    ),
    [theme.colors.divider],
  );

  const header = (
    <View>
      <View style={styles.storiesWrap}>
        <StoriesRail onCreate={openStoryComposer} onOpen={openStory} />
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((item) => {
          const active = filter === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              onPress={() => onSelectFilter(item.key)}
              style={({ pressed }) => [
                styles.filterPill,
                {
                  backgroundColor: active ? theme.colors.primary : theme.colors.surface,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <AppText variant="label" color={active ? 'onPrimary' : 'textSecondary'}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}

        {filter === 'nearby' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Şehir seç"
            onPress={() => setCityPickerOpen(true)}
            style={({ pressed }) => [
              styles.cityChip,
              { borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="location-outline" size={14} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {effectiveCity ?? 'Şehir seç'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
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
        {feed.isError
          ? 'Akış yüklenemedi'
          : filter === 'following'
            ? 'Takip ettiğin kişiler henüz paylaşmadı'
            : 'Akış henüz sakin'}
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
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={styles.list}
          data={posts}
          renderItem={renderPost}
          keyExtractor={(item) => item.id}
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

      <SelectSheet
        visible={cityPickerOpen}
        title="Şehir seç"
        options={PROVINCES}
        value={city ?? profile?.city ?? null}
        onClose={() => setCityPickerOpen(false)}
        onSelect={(value) => {
          setCityPickerOpen(false);
          setCity(value);
          setFilter('nearby');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Geniş ekranlarda akış tüm pencereye yayılmaz; okunabilir bir sütunda kalır.
  list: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  // Hikayeler basligin hemen altindan baslar; arada bos bir bant yok.
  storiesWrap: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 10 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexWrap: 'wrap',
  },
  filterPill: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
    justifyContent: 'center',
  },
  cityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 150,
  },
  listContent: { paddingBottom: 28 },
  cardWrap: { paddingHorizontal: 20 },
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
