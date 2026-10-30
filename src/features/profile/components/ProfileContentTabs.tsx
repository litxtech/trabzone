import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { AppImage, AppText } from '@/components/ui';
import { useProfilePosts, useSavedPosts } from '@/features/feed/hooks/use-feed';
import type { FeedPost } from '@/features/feed/services/feed-service';
import { ListingCard } from '@/features/marketplace/components/ListingCard';
import { useSellerListings, useToggleFavorite } from '@/features/marketplace/hooks/use-marketplace';
import { VideoThumbnail } from '@/features/media/components/VideoThumbnail';
import { publicMediaUrl } from '@/features/media/media-service';
import { newsCategoryPalette } from '@/features/news/category-theme';
import { useUserReels } from '@/features/reels/hooks/use-reels';
import { useMyTrips } from '@/features/ride/hooks/use-ride';
import type { RideReservation } from '@/features/ride/types';
import { formatDateTime, formatMoney } from '@/features/ride/utils/format';
import { reelUrl } from '@/features/reels/services/reels-service';
import { formatCount } from '@/features/reels/utils/format';
import { useMeasuredWidth } from '@/hooks/use-measured-width';
import { AdPlacementSlot, interleaveRows, useAdPlacement } from '@/features/ads';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type TabKey = 'posts' | 'media' | 'news' | 'reels' | 'saved' | 'listings' | 'trips';

export type ProfileContentTabsProps = {
  username: string;
  userId: string;
  isOwner: boolean;
};

/**
 * Profil içerik sekmeleri. Gönderiler ve medya `feed_profile_posts`, ilanlar
 * `market_seller_listings` RPC'sinden gelir; gizlilik kuralları sunucudadır.
 */
export function ProfileContentTabs({ username, userId, isOwner }: ProfileContentTabsProps) {
  const { theme } = useTheme();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();

  /**
   * Vitrin hücreleri yüzde genişlikle üç sütuna bölünür. Yüzde genişlik ile
   * `aspectRatio` aynı düğümde verildiğinde Yoga yüksekliği 0'a düşürebiliyor
   * (nativede görseller hiç görünmüyordu). Bu yüzden yükseklik, ızgaranın
   * `onLayout` ile ölçülen genişliğinden sayısal olarak hesaplanır.
   */
  const grid = useMeasuredWidth(Math.max(1, Math.min(windowWidth - 32, 720)));
  const gridCellWidth = Math.max(48, Math.round(grid.width * 0.32));
  const postCellHeight = gridCellWidth;
  const newsCellHeight = Math.round(gridCellWidth / 0.72);
  const reelCellHeight = Math.round(gridCellWidth / (9 / 14));
  // Haber hesabında profil, doğrudan tüm yayınlanmış haberleri gösterir.
  const isNewsPublisher = username.trim().toLocaleLowerCase('tr-TR') === 'trabzonehaber';
  const [tab, setTab] = useState<TabKey>(isNewsPublisher ? 'news' : 'posts');

  const posts = useProfilePosts(username, 'posts', 40);
  const media = useProfilePosts(username, 'media', 40);
  const news = useProfilePosts(username, 'news', 40);
  const saved = useSavedPosts();
  const listings = useSellerListings(userId || null);
  // Başka bir profile geçildiğinde haber sekmesi boş kalmasın.
  const activeTab: TabKey =
    tab === 'news' && !isNewsPublisher && !news.isLoading && (news.data?.length ?? 0) === 0
      ? 'posts'
      : tab;
  const reels = useUserReels(username, activeTab === 'reels');
  const favorite = useToggleFavorite();
  const trips = useMyTrips(null);
  const profileAds = useAdPlacement('profile_posts', posts.data?.length ?? 0, {
    columns: 3,
    enabled: activeTab === 'posts',
  });

  const tabs: {
    key: TabKey;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
  }[] = [
    { key: 'posts', label: 'Gönderiler', icon: 'grid-outline' },
    ...(isNewsPublisher || (news.data?.length ?? 0) > 0
      ? ([{ key: 'news', label: 'Haberler', icon: 'newspaper-outline' }] as const)
      : []),
    { key: 'media', label: 'Medya', icon: 'images-outline' },
    { key: 'reels', label: 'Reels', icon: 'play-circle-outline' },
    ...(isOwner
      ? ([
          { key: 'saved', label: 'Kaydedilenler', icon: 'bookmark-outline' },
          { key: 'trips', label: 'Yolculuklar', icon: 'car-outline' },
        ] as const)
      : []),
    { key: 'listings', label: 'İlanlar', icon: 'pricetags-outline' },
  ];

  const renderPostGrid = (
    data: FeedPost[] | undefined,
    loading: boolean,
    error: boolean,
    emptyTitle: string,
    emptyBody: string,
    onRetry: () => void,
    withAds = false,
  ) => {
    if (loading) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.state}>
          <Ionicons name="cloud-offline-outline" size={24} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            İçerik yüklenemedi.
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Tekrar dene" onPress={onRetry}>
            <AppText variant="label" color="primaryDeep">
              Tekrar dene
            </AppText>
          </Pressable>
        </View>
      );
    }
    if (!data || data.length === 0) {
      return (
        <View style={styles.state}>
          <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="images-outline" size={22} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="bodyStrong" align="center">
            {emptyTitle}
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            {emptyBody}
          </AppText>
        </View>
      );
    }

    return (
      <View style={styles.grid} onLayout={grid.onLayout}>
        {interleaveRows(data, withAds ? profileAds.positions : [], (post) => post.id).map((row) => {
          if (row.type === 'ad') {
            return (
              <AdPlacementSlot
                key={row.key}
                slot={profileAds.slotAt(row.after)}
                placement="profile_posts"
                onHide={profileAds.hide}
                style={styles.gridAd}
              />
            );
          }
          const post = row.item;
          const first = post.media[0];
          const isVideo = first?.media_type === 'video';
          const poster = first
            ? publicMediaUrl('posts', isVideo ? first.thumbnail_path : first.storage_path)
            : null;

          return (
            <Pressable
              key={post.id}
              accessibilityRole="button"
              accessibilityLabel={`Gönderiyi aç: ${post.body ?? 'medya gönderisi'}`}
              onPress={() => {
                haptics.tap();
                router.push(`/post/${post.id}` as never);
              }}
              style={({ pressed }) => [
                styles.cell,
                {
                  height: postCellHeight,
                  backgroundColor: theme.colors.surfaceMuted,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              {isVideo ? (
                <VideoThumbnail
                  posterUri={poster}
                  qualityLabel="1080p"
                  style={StyleSheet.absoluteFill}
                />
              ) : poster ? (
                <AppImage
                  source={{ uri: poster }}
                  style={StyleSheet.absoluteFill}
                  recycleKey={post.id}
                />
              ) : (
                <View style={styles.textCell}>
                  <AppText variant="caption" color="textSecondary" numberOfLines={5}>
                    {post.body ?? 'Metin gönderisi'}
                  </AppText>
                </View>
              )}

              {post.media.length > 1 ? (
                <View style={styles.multi}>
                  <Ionicons name="copy-outline" size={11} color="#FFFFFF" />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderNewsGrid = () => {
    if (news.isLoading) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      );
    }
    if (news.isError) {
      return (
        <View style={styles.state}>
          <Ionicons name="cloud-offline-outline" size={24} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Haberler yüklenemedi.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
            onPress={() => void news.refetch()}
          >
            <AppText variant="label" color="primaryDeep">
              Tekrar dene
            </AppText>
          </Pressable>
        </View>
      );
    }
    if (!news.data || news.data.length === 0) {
      return (
        <View style={styles.state}>
          <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="newspaper-outline" size={22} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="bodyStrong" align="center">
            Henüz haber yok
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Yayımlanan yerel haberler bu vitrinde listelenir.
          </AppText>
        </View>
      );
    }

    return (
      <View style={styles.newsGrid} onLayout={grid.onLayout}>
        {news.data.map((post) => {
          const meta = post.news ?? null;
          const title = (meta?.title ?? post.body ?? 'Haber').split('\n')[0] ?? 'Haber';
          const palette = newsCategoryPalette(meta?.category_slug);
          const first = post.media[0] ?? null;
          const imageUri = first ? publicMediaUrl('posts', first.storage_path) : null;
          const category = meta?.category_name ?? 'Trabzon Gündem';

          return (
            <Pressable
              key={post.id}
              accessibilityRole="button"
              accessibilityLabel={`Haberi aç: ${title}`}
              onPress={() => {
                haptics.tap();
                router.push(`/post/${post.id}` as never);
              }}
              style={({ pressed }) => [
                styles.newsCell,
                {
                  height: newsCellHeight,
                  borderColor: theme.colors.border,
                  backgroundColor: palette.soft,
                  opacity: pressed ? 0.86 : 1,
                },
              ]}
            >
              {imageUri ? (
                <AppImage
                  source={{ uri: imageUri }}
                  style={StyleSheet.absoluteFill}
                  contentFit={
                    first?.display_fit === 'contain' || post.source?.url ? 'contain' : 'cover'
                  }
                  recycleKey={`profile-news-${post.id}`}
                />
              ) : (
                <LinearGradient
                  colors={palette.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                >
                  <View style={styles.newsFallback}>
                    <View style={styles.newsFallbackTop}>
                      <Ionicons name="newspaper-outline" size={13} color="rgba(255,255,255,0.9)" />
                      <AppText variant="overline" color="rgba(255,255,255,0.85)">
                        TRABZONE HABER
                      </AppText>
                    </View>
                    <AppText
                      variant="caption"
                      color={palette.onGradient}
                      numberOfLines={5}
                      style={styles.newsFallbackTitle}
                    >
                      {title}
                    </AppText>
                    <AppText variant="caption" color="rgba(255,255,255,0.8)" numberOfLines={1}>
                      {category}
                    </AppText>
                  </View>
                </LinearGradient>
              )}

              {imageUri ? (
                <LinearGradient
                  colors={['rgba(6,12,26,0)', 'rgba(6,12,26,0.55)', 'rgba(6,12,26,0.92)']}
                  style={styles.newsShade}
                >
                  <AppText variant="caption" color="rgba(255,255,255,0.8)" numberOfLines={1}>
                    {category}
                  </AppText>
                  <AppText
                    variant="caption"
                    color="#FFFFFF"
                    numberOfLines={3}
                    style={styles.newsCellTitle}
                  >
                    {title}
                  </AppText>
                </LinearGradient>
              ) : null}

              {!imageUri ? (
                <View style={styles.newsCorner}>
                  <Ionicons name="arrow-forward" size={11} color="#FFFFFF" />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderReels = () => {
    if (reels.isLoading) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      );
    }
    if (reels.isError) {
      return (
        <View style={styles.state}>
          <Ionicons name="cloud-offline-outline" size={24} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Reels yüklenemedi.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
            onPress={() => void reels.refetch()}
          >
            <AppText variant="label" color="primaryDeep">
              Tekrar dene
            </AppText>
          </Pressable>
        </View>
      );
    }
    if (!reels.data || reels.data.length === 0) {
      return (
        <View style={styles.state}>
          <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="play-circle-outline" size={22} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="bodyStrong" align="center">
            Henüz Reels yok
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            {isOwner
              ? 'İlk dikey videonu paylaşarak bu sekmeyi doldur.'
              : 'Bu hesap henüz Reels videosu paylaşmadı.'}
          </AppText>
        </View>
      );
    }

    return (
      <View style={styles.reelsGrid} onLayout={grid.onLayout}>
        {reels.data.map((reel) => {
          const cover = reelUrl(reel.cover_path, reel.storage_bucket ?? 'reels');
          return (
            <Pressable
              key={reel.id}
              accessibilityRole="button"
              accessibilityLabel={reel.caption ? `Reels: ${reel.caption}` : 'Reels videosunu aç'}
              onPress={() => {
                haptics.tap();
                router.push(`/reel/${reel.id}` as never);
              }}
              style={({ pressed }) => [
                styles.reelCell,
                { height: reelCellHeight, opacity: pressed ? 0.82 : 1 },
              ]}
            >
              {cover ? (
                <AppImage
                  source={{ uri: cover }}
                  style={StyleSheet.absoluteFill}
                  recycleKey={reel.id}
                />
              ) : (
                <View style={styles.reelFallback}>
                  <Ionicons name="videocam-outline" size={22} color="#7F8CA6" />
                </View>
              )}
              <View style={styles.reelShade} />
              <View style={styles.reelPlay}>
                <Ionicons name="play" size={12} color="#FFFFFF" />
              </View>
              <View style={styles.reelMeta}>
                <Ionicons name="play" size={9} color="rgba(255,255,255,0.85)" />
                <AppText
                  variant="caption"
                  color="rgba(255,255,255,0.9)"
                  style={styles.reelMetaText}
                >
                  {formatCount(reel.view_count)}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.wrapper}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        style={styles.tabsScroll}
      >
        {tabs.map((item) => {
          const active = activeTab === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              onPress={() => {
                haptics.selection();
                setTab(item.key);
              }}
              style={[
                styles.tab,
                {
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={13}
                color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
              />
              <AppText
                variant="caption"
                color={active ? 'primaryDeep' : 'textSecondary'}
                numberOfLines={1}
              >
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      {activeTab === 'posts'
        ? renderPostGrid(
            posts.data,
            posts.isLoading,
            posts.isError,
            'Henüz gönderi yok',
            isOwner ? 'İlk gönderini paylaşarak başla.' : 'Bu hesap henüz paylaşım yapmadı.',
            () => void posts.refetch(),
          )
        : null}

      {activeTab === 'news' ? renderNewsGrid() : null}

      {activeTab === 'media'
        ? renderPostGrid(
            media.data,
            media.isLoading,
            media.isError,
            'Henüz medya yok',
            'Fotoğraf ve videolar burada toplanır.',
            () => void media.refetch(),
          )
        : null}

      {activeTab === 'reels' ? renderReels() : null}

      {activeTab === 'saved'
        ? renderPostGrid(
            saved.data,
            saved.isLoading,
            saved.isError,
            'Kaydedilen gönderi yok',
            'Beğendiğin gönderileri kaydederek burada topla.',
            () => void saved.refetch(),
          )
        : null}

      {activeTab === 'listings' ? (
        listings.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : listings.isError ? (
          <View style={styles.state}>
            <Ionicons name="cloud-offline-outline" size={24} color={theme.colors.textSecondary} />
            <AppText variant="body" color="textSecondary" align="center">
              İlanlar yüklenemedi.
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tekrar dene"
              onPress={() => void listings.refetch()}
            >
              <AppText variant="label" color="primaryDeep">
                Tekrar dene
              </AppText>
            </Pressable>
          </View>
        ) : (listings.data ?? []).length === 0 ? (
          <View style={styles.state}>
            <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="pricetags-outline" size={22} color={theme.colors.primaryDeep} />
            </View>
            <AppText variant="bodyStrong" align="center">
              Henüz ilan yok
            </AppText>
            <AppText variant="body" color="textSecondary" align="center">
              Marketplace ilanları burada listelenir.
            </AppText>
          </View>
        ) : (
          <View style={styles.listingsGrid}>
            {(listings.data ?? []).map((listing) => (
              <View key={listing.id} style={styles.listingCell}>
                <ListingCard
                  listing={listing}
                  onPress={() => router.push(`/marketplace/${listing.id}` as never)}
                  onToggleFavorite={() => favorite.mutate(listing.id)}
                  favoritePending={favorite.isPending && favorite.variables === listing.id}
                />
              </View>
            ))}
          </View>
        )
      ) : null}

      {activeTab === 'trips' ? (
        trips.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : trips.isError ? (
          <View style={styles.state}>
            <Ionicons name="cloud-offline-outline" size={24} color={theme.colors.textSecondary} />
            <AppText variant="body" color="textSecondary" align="center">
              Yolculuklar yüklenemedi.
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tekrar dene"
              onPress={() => void trips.refetch()}
            >
              <AppText variant="label" color="primaryDeep">
                Tekrar dene
              </AppText>
            </Pressable>
          </View>
        ) : (trips.data ?? []).length === 0 ? (
          <View style={styles.state}>
            <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="car-outline" size={22} color={theme.colors.primaryDeep} />
            </View>
            <AppText variant="bodyStrong" align="center">
              Henüz yolculuk yok
            </AppText>
            <AppText variant="body" color="textSecondary" align="center">
              İlk yolculuğunu planlayarak bu sekmeyi doldur.
            </AppText>
          </View>
        ) : (
          <View style={styles.tripList}>
            {trips.data?.slice(0, 6).map((trip: RideReservation) => (
              <Pressable
                key={trip.id}
                accessibilityRole="button"
                accessibilityLabel={`${trip.origin_label} - ${trip.dest_label} yolculuğunu aç`}
                onPress={() => router.push(`/ride/trips/${trip.id}` as never)}
                style={({ pressed }) => [
                  styles.tripRow,
                  { borderColor: theme.colors.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Ionicons name="car-outline" size={16} color={theme.colors.primaryDeep} />
                <View style={styles.flex}>
                  <AppText variant="caption" numberOfLines={1}>
                    {trip.origin_label} → {trip.dest_label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {formatDateTime(trip.depart_at)} ·{' '}
                    {formatMoney(trip.total_cents, trip.currency)}
                  </AppText>
                </View>
                <AppText variant="caption" color="primaryDeep">
                  {trip.status === 'completed' ? 'Tamamlandı' : 'Aç'}
                </AppText>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tüm yolculukları aç"
              onPress={() => router.push('/ride/trips' as never)}
              style={[styles.tripAll, { backgroundColor: theme.colors.primarySoft }]}
            >
              <AppText variant="caption" color="primaryDeep">
                Tüm yolculuklar ve arşiv →
              </AppText>
            </Pressable>
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 20 },
  tabsScroll: { marginHorizontal: -2 },
  tabs: { flexDirection: 'row', gap: 8, paddingRight: 6, paddingBottom: 2 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 34,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  gridAd: { width: '100%', paddingVertical: 4 },
  newsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  newsCell: {
    width: '32%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  newsFallback: { flex: 1, padding: 8, justifyContent: 'space-between' },
  newsFallbackTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newsFallbackTitle: { fontFamily: 'Manrope_700Bold', lineHeight: 15 },
  newsShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingTop: 18,
    paddingBottom: 8,
    gap: 2,
  },
  newsCellTitle: { fontFamily: 'Manrope_700Bold', lineHeight: 15 },
  newsCorner: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  cell: {
    width: '32%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  textCell: { flex: 1, padding: 8, justifyContent: 'center' },
  multi: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listingsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  listingCell: { width: '48%' },
  reelsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  reelCell: {
    width: '32%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0B1020',
  },
  reelFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121B2E',
  },
  reelShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 42,
    backgroundColor: 'rgba(4,8,16,0.52)',
  },
  reelPlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -14,
    marginLeft: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,12,22,0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  reelMeta: {
    position: 'absolute',
    left: 7,
    bottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  reelMetaText: { fontSize: 10, lineHeight: 13, fontWeight: '700' },
  loading: { paddingVertical: 32, alignItems: 'center' },
  state: { alignItems: 'center', gap: 8, paddingVertical: 28, paddingHorizontal: 20 },
  stateIcon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  tripList: { gap: 7, marginTop: 12 },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tripAll: { alignItems: 'center', paddingVertical: 10, borderRadius: 12 },
});
