import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from '@/utils/router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText, IconButton, Logo, Screen, Skeleton, Wordmark } from '@/components/ui';
import { useUnreadMessageCount } from '@/features/messaging/hooks/use-chat';
import { useDrawer } from '@/features/navigation/drawer-context';
import { useUnreadNotifications } from '@/features/notifications/hooks/use-notifications';
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

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'nearby', label: 'Yakınımda' },
  { key: 'following', label: 'Takip' },
  { key: 'popular', label: 'Popüler' },
];

export default function FeedScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { open: openDrawer } = useDrawer();
  // Dar ekranlarda marka kilidine yer acmak icin yalnizca birincil kisa yollar
  // gosterilir; yolculuk ve harita zaten drawer menusunde yer aliyor.
  const { width } = useWindowDimensions();
  const showSecondaryShortcuts = width >= 410;

  const { data: profile } = useMyProfile();
  const { data: unread } = useUnreadNotifications();
  const unreadMessages = useUnreadMessageCount();

  const [filter, setFilter] = useState<FeedFilter>('all');
  const [city, setCity] = useState<string | null>(null);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [story, setStory] = useState<{ group: StoryGroup; index: number } | null>(null);

  const effectiveCity = filter === 'nearby' ? (city ?? profile?.city ?? null) : null;
  const feed = useFeed(filter, effectiveCity);

  const posts = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);

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
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <IconButton
            name="menu"
            accessibilityLabel="Menüyü aç"
            variant="surface"
            size={20}
            onPress={() => openDrawer('main')}
          />
          <Logo size={26} />
          <Wordmark size={20} gradient tracking={0.05} />
        </View>

        <View style={styles.headerActions}>
          {showSecondaryShortcuts ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Yolculuk paylaşımı"
                hitSlop={6}
                onPress={() => router.push('/ride' as never)}
                style={({ pressed }) => [styles.headerIcon, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="car-sport-outline" size={22} color={theme.colors.text} />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Etkileşim haritası"
                hitSlop={6}
                onPress={() => router.push('/map' as never)}
                style={({ pressed }) => [styles.headerIcon, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="map-outline" size={22} color={theme.colors.text} />
              </Pressable>
            </>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Keşfet"
            hitSlop={6}
            onPress={() => router.push('/discover' as never)}
            style={({ pressed }) => [styles.headerIcon, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="search" size={21} color={theme.colors.text} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unreadMessages > 0 ? `Mesajlar, ${unreadMessages} okunmamış` : 'Mesajlar'
            }
            hitSlop={6}
            onPress={() => router.navigate('/messages' as never)}
            style={({ pressed }) => [styles.headerIcon, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.colors.text} />
            {unreadMessages > 0 ? (
              <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
                <AppText variant="caption" color="#FFFFFF" style={styles.badgeText}>
                  {unreadMessages > 99 ? '99+' : unreadMessages}
                </AppText>
              </View>
            ) : null}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unread && unread > 0 ? `Bildirimler, ${unread} okunmamış` : 'Bildirimler'
            }
            hitSlop={6}
            onPress={() => router.push('/notifications' as never)}
            style={({ pressed }) => [styles.headerIcon, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="notifications-outline" size={22} color={theme.colors.text} />
            {unread && unread > 0 ? (
              <View style={[styles.badge, { backgroundColor: theme.colors.danger }]}>
                <AppText variant="caption" color="#FFFFFF" style={styles.badgeText}>
                  {unread > 99 ? '99+' : unread}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 9.5, lineHeight: 13 },
  storiesWrap: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
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
