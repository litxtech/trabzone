import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from '@/utils/router';

import { AppImage, AppText, IconButton, Screen, Skeleton } from '@/components/ui';
import { useToggleListingFavorite } from '@/features/explore/hooks/use-explore';
import { ListingCard as RealEstateCard } from '@/features/real-estate/components/ListingCard';
import { MarketListingCard } from '@/features/marketplace/components/MarketListingCard';
import {
  useMarketCatalog,
  useMarketHome,
  usePlaces,
  useToggleFavoriteV2,
} from '@/features/marketplace/hooks/use-marketplace-catalog';
import type {
  MarketListing,
  PlaceSummary,
} from '@/features/marketplace/services/marketplace-catalog-service';
import { publicMediaUrl } from '@/features/media/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type HomeTab = 'all' | 'real_estate' | 'product' | 'place' | 'vehicle' | 'service';

const HOME_TABS: {
  key: HomeTab;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { key: 'all', label: 'Tümü', icon: 'apps-outline' },
  { key: 'real_estate', label: 'Emlak', icon: 'home-outline' },
  { key: 'product', label: 'Ürünler', icon: 'bag-handle-outline' },
  { key: 'place', label: 'İşletmeler', icon: 'storefront-outline' },
  { key: 'vehicle', label: 'Araçlar', icon: 'car-sport-outline' },
  { key: 'service', label: 'Hizmetler', icon: 'construct-outline' },
];

const KIND_TITLES: Record<Exclude<HomeTab, 'all' | 'place'>, string> = {
  real_estate: 'Trabzone Emlak',
  product: 'Yeni Ürünler',
  vehicle: 'Araç İlanları',
  service: 'Yerel Hizmetler',
};

export default function MarketplaceScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<HomeTab>('all');
  const home = useMarketHome();
  const favorite = useToggleFavoriteV2();
  const realEstateFavorite = useToggleListingFavorite();

  const kind = tab === 'all' || tab === 'place' ? null : tab;
  const tabCatalog = useMarketCatalog(
    { kind, limit: 8, sort: 'new' },
    { enabled: tab !== 'all' && tab !== 'place' },
  );
  const places = usePlaces({ limit: 8, sort: 'rating' }, { enabled: tab === 'place' });

  const openListing = useCallback(
    (id: string) => router.push(`/marketplace/${id}` as never),
    [router],
  );
  const openRealEstate = useCallback(
    (id: string) => router.push(`/marketplace/real-estate/${id}` as never),
    [router],
  );

  const data = home.data;
  const newListings = useMemo(() => data?.new_listings.slice(0, 4) ?? [], [data]);
  const popular = useMemo(() => data?.popular.slice(0, 4) ?? [], [data]);
  const vehicles = useMemo(() => data?.vehicles.slice(0, 6) ?? [], [data]);
  const realEstate = useMemo(() => data?.real_estate.slice(0, 6) ?? [], [data]);
  const nearbyPlaces = useMemo(() => data?.places.slice(0, 8) ?? [], [data]);
  const personal = useMemo(() => data?.recommendations.slice(0, 4) ?? [], [data]);

  const refreshing = home.isRefetching || tabCatalog.isRefetching || places.isRefetching;
  const onRefresh = useCallback(() => {
    void home.refetch();
    if (tab !== 'all') {
      if (tab === 'place') {
        void places.refetch();
      } else {
        void tabCatalog.refetch();
      }
    }
  }, [home, places, tab, tabCatalog]);

  const priceSummary = data
    ? `${data.stats.active_listings} ilan · ${data.stats.places} işletme`
    : 'Trabzon’un yerel pazarı';

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <View style={styles.brandRow}>
              <AppText variant="overline" color="primaryDeep">
                TRABZONE
              </AppText>
              <View style={[styles.brandPill, { backgroundColor: theme.colors.primarySoft }]}>
                <AppText variant="caption" color="primaryDeep">
                  MARKET
                </AppText>
              </View>
            </View>
            <View style={styles.locationRow}>
              <Ionicons name="location" size={12} color={theme.colors.accent} />
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                Trabzon · {priceSummary}
              </AppText>
            </View>
          </View>
          <View style={styles.headerActions}>
            <IconButton
              name="search-outline"
              accessibilityLabel="Ara"
              variant="surface"
              size={18}
              onPress={() => router.push('/marketplace/search' as never)}
            />
            <IconButton
              name="heart-outline"
              accessibilityLabel="Favorilerim"
              variant="surface"
              size={18}
              onPress={() => router.push('/marketplace/favorites' as never)}
            />
            <IconButton
              name="notifications-outline"
              accessibilityLabel="Bildirimler"
              variant="surface"
              size={18}
              onPress={() => router.push('/notifications' as never)}
            />
            <IconButton
              name="options-outline"
              accessibilityLabel="Filtreler"
              variant="surface"
              size={18}
              onPress={() => router.push('/marketplace/search' as never)}
            />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Trabzon'da ne arıyorsun?"
          onPress={() => {
            haptics.tap();
            router.push('/marketplace/search' as never);
          }}
          style={({ pressed }) => [
            styles.searchBar,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <View style={[styles.searchIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="search" size={18} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="body" color="textTertiary" style={styles.flex}>
            Trabzon’da ne arıyorsun?
          </AppText>
          <View style={[styles.searchFilter, { borderColor: theme.colors.divider }]}>
            <Ionicons name="options-outline" size={16} color={theme.colors.textSecondary} />
          </View>
        </Pressable>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {HOME_TABS.map((entry) => {
            const active = tab === entry.key;
            return (
              <Pressable
                key={entry.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptics.selection();
                  setTab(entry.key);
                }}
                style={({ pressed }) => [
                  styles.tab,
                  {
                    backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                    borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={entry.icon}
                  size={14}
                  color={active ? '#FFFFFF' : theme.colors.textSecondary}
                />
                <AppText variant="label" color={active ? '#FFFFFF' : 'textSecondary'}>
                  {entry.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>

        {tab === 'all' ? (
          <>
            <View style={styles.heroGrid}>
              <HeroCard
                title="Emlak"
                subtitle="Kiralık ve satılık yerleri keşfet"
                icon="home"
                colors={theme.gradients.aurora}
                onPress={() =>
                  router.push('/marketplace/catalog?kind=real_estate&title=Emlak' as never)
                }
              />
              <HeroCard
                title="İşletmeler"
                subtitle="Trabzon'daki işletmeleri bul"
                icon="storefront"
                colors={theme.gradients.primary}
                onPress={() =>
                  router.push('/marketplace/catalog?kind=place&title=İşletmeler' as never)
                }
              />
              <HeroCard
                title="Alışveriş"
                subtitle="Yeni ve ikinci el ürünlere göz at"
                icon="bag-handle"
                colors={theme.gradients.sunset}
                onPress={() =>
                  router.push('/marketplace/catalog?kind=product&title=Alışveriş' as never)
                }
              />
              <HeroCard
                title="Haritada Keşfet"
                subtitle="Yakınındaki yerleri görüntüle"
                icon="map"
                colors={['#141C30', '#0B1020']}
                onPress={() => router.push('/marketplace/map' as never)}
              />
            </View>

            {home.isLoading ? (
              <HomeSkeleton />
            ) : home.isError ? (
              <StateCard
                icon="cloud-offline-outline"
                title="Marketplace yüklenemedi"
                body="Bağlantını kontrol edip yeniden dene."
                actionLabel="Tekrar dene"
                onAction={() => void home.refetch()}
              />
            ) : (
              <>
                {newListings.length > 0 ? (
                  <ListingSection
                    title="Trabzon'da Yeni İlanlar"
                    subtitle="Son eklenen ilanlar"
                    onMore={() => router.push('/marketplace/catalog?title=Yeni İlanlar' as never)}
                    listings={newListings}
                    onPress={openListing}
                    favorite={favorite}
                  />
                ) : null}

                {realEstate.length > 0 ? (
                  <View style={styles.section}>
                    <SectionHeader
                      title="Kiralık ve Satılık Emlaklar"
                      subtitle="Trabzone Emlak"
                      actionLabel="Tümü"
                      onAction={() => router.push('/marketplace/real-estate' as never)}
                    />
                    <ScrollView
                      keyboardShouldPersistTaps="handled"
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontal}
                    >
                      {realEstate.map((listing) => (
                        <RealEstateCard
                          key={listing.id}
                          listing={listing}
                          compact
                          onPress={() => openRealEstate(listing.id)}
                          onToggleFavorite={() => realEstateFavorite.mutate(listing.id)}
                        />
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                {nearbyPlaces.length > 0 ? (
                  <View style={styles.section}>
                    <SectionHeader
                      title="Yakınındaki İşletmeler"
                      subtitle="Trabzon'da öne çıkan yerler"
                      actionLabel="Tümü"
                      onAction={() =>
                        router.push('/marketplace/catalog?kind=place&title=İşletmeler' as never)
                      }
                    />
                    <ScrollView
                      keyboardShouldPersistTaps="handled"
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontal}
                    >
                      {nearbyPlaces.map((place) => (
                        <PlaceCard
                          key={place.id}
                          place={place}
                          onPress={() => router.push(`/marketplace/place/${place.id}` as never)}
                        />
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                {vehicles.length > 0 ? (
                  <View style={styles.section}>
                    <SectionHeader
                      title="Araçlar"
                      subtitle="Trabzon'dan araç ilanları"
                      actionLabel="Tümü"
                      onAction={() =>
                        router.push('/marketplace/catalog?kind=vehicle&title=Araçlar' as never)
                      }
                    />
                    <ScrollView
                      keyboardShouldPersistTaps="handled"
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontal}
                    >
                      {vehicles.map((listing) => (
                        <MarketListingCard
                          key={listing.id}
                          listing={listing}
                          layout="feature"
                          width={252}
                          onPress={() => openListing(listing.id)}
                          onToggleFavorite={() => favorite.mutate(listing.id)}
                          favoritePending={favorite.isPending && favorite.variables === listing.id}
                        />
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                {popular.length > 0 ? (
                  <ListingSection
                    title="Popüler İlanlar"
                    subtitle="Görüntülenme ve favorilere göre"
                    onMore={() =>
                      router.push(
                        '/marketplace/catalog?sort=popular&title=Popüler İlanlar' as never,
                      )
                    }
                    listings={popular}
                    onPress={openListing}
                    favorite={favorite}
                  />
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Haritada Keşfet"
                  onPress={() => {
                    haptics.tap();
                    router.push('/marketplace/map' as never);
                  }}
                  style={({ pressed }) => [
                    styles.mapBanner,
                    {
                      borderColor: theme.colors.border,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  <LinearGradient
                    colors={['#101B36', '#1B2640']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.mapPattern}>
                    <Ionicons name="map-outline" size={42} color="rgba(98,132,255,0.35)" />
                    <View style={[styles.mapPin, { backgroundColor: theme.colors.accent }]}>
                      <Ionicons name="location" size={16} color="#FFFFFF" />
                    </View>
                  </View>
                  <View style={styles.mapCopy}>
                    <AppText variant="h3" color="#FFFFFF">
                      Haritada Keşfet
                    </AppText>
                    <AppText variant="caption" color="rgba(255,255,255,0.7)">
                      İşletmeler, emlak ve çevrendeki fırsatlar
                    </AppText>
                  </View>
                  <View style={styles.mapCta}>
                    <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                  </View>
                </Pressable>

                {personal.length > 0 ? (
                  <ListingSection
                    title="Sana Özel"
                    subtitle={
                      data?.personalized
                        ? 'İlgi alanlarına göre seçildi'
                        : 'Trabzon’dan yeni ilanlar'
                    }
                    onMore={() => router.push('/marketplace/catalog?title=Sana Özel' as never)}
                    listings={personal}
                    onPress={openListing}
                    favorite={favorite}
                  />
                ) : null}

                {!newListings.length && !popular.length && !realEstate.length ? (
                  <StateCard
                    icon="storefront-outline"
                    title="Henüz ilan yok"
                    body="Trabzon'daki ilk ilanı sen yayınlayarak pazarı başlat."
                    actionLabel="İlan oluştur"
                    onAction={() => router.push('/marketplace/create' as never)}
                  />
                ) : null}
              </>
            )}
          </>
        ) : tab === 'place' ? (
          <View style={styles.tabContent}>
            <SectionHeader
              title="Trabzon'daki İşletmeler"
              subtitle="Yorumlar, fotoğraflar ve konumlar"
              actionLabel="Haritada"
              onAction={() => router.push('/marketplace/map' as never)}
            />
            {places.isLoading ? (
              <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
            ) : (places.data?.items ?? []).length ? (
              (places.data?.items ?? []).map((place) => (
                <PlaceRow
                  key={place.id}
                  place={place}
                  onPress={() => router.push(`/marketplace/place/${place.id}` as never)}
                />
              ))
            ) : (
              <StateCard
                icon="storefront-outline"
                title="İşletme bulunamadı"
                body="Haritada keşfederek Trabzon'daki işletmeleri görebilirsin."
                actionLabel="Haritayı aç"
                onAction={() => router.push('/marketplace/map' as never)}
              />
            )}
          </View>
        ) : (
          <View style={styles.tabContent}>
            <SectionHeader
              title={KIND_TITLES[tab]}
              subtitle="Trabzon'dan güncel ilanlar"
              actionLabel="Tümünü gör"
              onAction={() =>
                router.push(
                  `/marketplace/catalog?kind=${tab}&title=${encodeURIComponent(KIND_TITLES[tab])}` as never,
                )
              }
            />
            {tabCatalog.isLoading ? (
              <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
            ) : tabCatalog.items.length ? (
              <View style={styles.grid}>
                {tabCatalog.items.map((listing) => (
                  <View key={listing.id} style={styles.gridCell}>
                    <MarketListingCard
                      listing={listing}
                      onPress={() => openListing(listing.id)}
                      onToggleFavorite={() => favorite.mutate(listing.id)}
                      favoritePending={favorite.isPending && favorite.variables === listing.id}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <StateCard
                icon="pricetags-outline"
                title="Bu bölümde henüz ilan yok"
                body="İlk ilanı sen ekleyerek bu kategoriyi canlandır."
                actionLabel="İlan oluştur"
                onAction={() => router.push('/marketplace/create' as never)}
              />
            )}
          </View>
        )}

        <View style={styles.bottomSpace} />
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Yeni ilan oluştur"
        onPress={() => {
          haptics.press();
          router.push('/marketplace/create' as never);
        }}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: theme.colors.primaryDeep,
            opacity: pressed ? 0.88 : 1,
          },
        ]}
      >
        <Ionicons name="add" size={23} color={theme.colors.onPrimary} />
        <AppText variant="label" color="onPrimary">
          İlan ver
        </AppText>
      </Pressable>
    </Screen>
  );
}

function HeroCard({
  title,
  subtitle,
  icon,
  colors,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  colors: readonly [string, string, ...string[]];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.heroCard, { opacity: pressed ? 0.88 : 1 }]}
    >
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.heroIcon}>
        <Ionicons name={icon} size={20} color="#FFFFFF" />
      </View>
      <View style={styles.heroCopy}>
        <AppText variant="title" color="#FFFFFF" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" color="rgba(255,255,255,0.76)" numberOfLines={2}>
          {subtitle}
        </AppText>
      </View>
      <Ionicons name="arrow-forward" size={15} color="rgba(255,255,255,0.85)" />
    </Pressable>
  );
}

function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.flex}>
        <AppText variant="h3" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={() => {
            haptics.selection();
            onAction();
          }}
          style={({ pressed }) => [
            styles.moreButton,
            { backgroundColor: theme.colors.primarySoft, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <AppText variant="caption" color="primaryDeep">
            {actionLabel}
          </AppText>
          <Ionicons name="chevron-forward" size={12} color={theme.colors.primaryDeep} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ListingSection({
  title,
  subtitle,
  listings,
  onPress,
  onMore,
  favorite,
}: {
  title: string;
  subtitle: string;
  listings: MarketListing[];
  onPress: (id: string) => void;
  onMore: () => void;
  favorite: ReturnType<typeof useToggleFavoriteV2>;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} subtitle={subtitle} actionLabel="Tümü" onAction={onMore} />
      <View style={styles.grid}>
        {listings.map((listing) => (
          <View key={listing.id} style={styles.gridCell}>
            <MarketListingCard
              listing={listing}
              onPress={() => onPress(listing.id)}
              onToggleFavorite={() => favorite.mutate(listing.id)}
              favoritePending={favorite.isPending && favorite.variables === listing.id}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function PlaceCard({ place, onPress }: { place: PlaceSummary; onPress: () => void }) {
  const { theme } = useTheme();
  const cover = publicMediaUrl('place-media', place.cover_path);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={place.name}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.placeCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.placeMedia, { backgroundColor: theme.colors.surfaceMuted }]}>
        {cover ? (
          <AppImage
            source={{ uri: cover }}
            style={StyleSheet.absoluteFill}
            recycleKey={place.id}
          />
        ) : (
          <View style={styles.placeFallback}>
            <Ionicons name="storefront-outline" size={24} color={theme.colors.textTertiary} />
          </View>
        )}
        {place.rating != null ? (
          <View style={styles.ratingPill}>
            <Ionicons name="star" size={10} color="#FFD166" />
            <AppText variant="caption" color="#FFFFFF">
              {place.rating.toFixed(1)}
            </AppText>
            <AppText variant="caption" color="rgba(255,255,255,0.65)">
              ({place.review_count})
            </AppText>
          </View>
        ) : null}
      </View>
      <View style={styles.placeBody}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {place.name}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {place.category_name ?? 'İşletme'} ·{' '}
          {[place.district, place.neighborhood].filter(Boolean).join(', ') || 'Trabzon'}
        </AppText>
      </View>
    </Pressable>
  );
}

function PlaceRow({ place, onPress }: { place: PlaceSummary; onPress: () => void }) {
  const { theme } = useTheme();
  const cover = publicMediaUrl('place-media', place.cover_path);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={place.name}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.placeRow,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.placeRowMedia, { backgroundColor: theme.colors.surfaceMuted }]}>
        {cover ? (
          <AppImage
            source={{ uri: cover }}
            style={StyleSheet.absoluteFill}
            recycleKey={place.id}
          />
        ) : (
          <Ionicons name="storefront-outline" size={22} color={theme.colors.textTertiary} />
        )}
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {place.name}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {place.category_name ?? 'İşletme'} ·{' '}
          {[place.district, place.neighborhood].filter(Boolean).join(', ') || 'Trabzon'}
        </AppText>
        <View style={styles.placeMeta}>
          {place.rating != null ? (
            <>
              <Ionicons name="star" size={11} color="#F5B301" />
              <AppText variant="caption" color="textSecondary">
                {place.rating.toFixed(1)} ({place.review_count})
              </AppText>
            </>
          ) : (
            <AppText variant="caption" color="textTertiary">
              Henüz puan yok
            </AppText>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

function StateCard({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.state}>
      <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={26} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="h3" align="center">
        {title}
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        {body}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        onPress={() => {
          haptics.tap();
          onAction();
        }}
        style={({ pressed }) => [
          styles.stateButton,
          { backgroundColor: theme.colors.primaryDeep, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <AppText variant="label" color="onPrimary">
          {actionLabel}
        </AppText>
      </Pressable>
    </View>
  );
}

function HomeSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <Skeleton height={16} width="45%" />
      <View style={styles.skeletonGrid}>
        {[0, 1, 2, 3].map((key) => (
          <View key={key} style={styles.skeletonCell}>
            <Skeleton height={132} radius={18} />
            <Skeleton height={12} width="82%" />
            <Skeleton height={11} width="42%" />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 104 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 10,
  },
  headerTitleWrap: { flex: 1, gap: 4 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandPill: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 6 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  searchBar: {
    marginHorizontal: 18,
    height: 54,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 9,
    paddingRight: 12,
  },
  searchIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchFilter: { paddingLeft: 10, borderLeftWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  flex: { flex: 1 },
  tabs: { gap: 8, paddingHorizontal: 18, paddingVertical: 12 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 38,
  },
  heroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 18,
    paddingBottom: 6,
  },
  heroCard: {
    width: '48%',
    flexGrow: 1,
    minHeight: 104,
    borderRadius: 18,
    overflow: 'hidden',
    padding: 13,
    justifyContent: 'space-between',
  },
  heroIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heroCopy: { gap: 2, marginTop: 8 },
  section: { paddingTop: 18 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  moreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    minHeight: 30,
  },
  horizontal: { gap: 10, paddingHorizontal: 18, paddingBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 13 },
  gridCell: { width: '50%', paddingHorizontal: 5, marginBottom: 10 },
  mapBanner: {
    marginHorizontal: 18,
    marginTop: 22,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    minHeight: 118,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  mapPattern: { width: 64, alignItems: 'center', justifyContent: 'center' },
  mapPin: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    bottom: 14,
    right: 2,
  },
  mapCopy: { flex: 1, gap: 3 },
  mapCta: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  placeCard: {
    width: 222,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  placeMedia: { height: 122 },
  placeFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ratingPill: {
    position: 'absolute',
    left: 9,
    bottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(8,14,26,0.58)',
  },
  placeBody: { padding: 11, gap: 2 },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginHorizontal: 18,
    marginBottom: 9,
    padding: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  placeRowMedia: {
    width: 62,
    height: 62,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  tabContent: { paddingTop: 8 },
  loader: { paddingVertical: 28 },
  state: { paddingHorizontal: 32, paddingVertical: 28, alignItems: 'center', gap: 8 },
  stateIcon: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  stateButton: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    marginTop: 8,
    minHeight: 42,
  },
  skeletonWrap: { paddingHorizontal: 18, paddingTop: 20, gap: 10 },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: -5 },
  skeletonCell: { width: '50%', paddingHorizontal: 5, marginBottom: 10, gap: 5 },
  bottomSpace: { height: 18 },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 999,
    minHeight: 48,
  },
});
