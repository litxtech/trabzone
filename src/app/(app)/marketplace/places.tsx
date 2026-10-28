import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { AppText, IconButton, Screen, Skeleton } from '@/components/ui';
import { useExploreBootstrap } from '@/features/explore/hooks/use-explore';
import { usePlaces } from '@/features/marketplace/hooks/use-marketplace-catalog';
import { publicMediaUrl } from '@/features/media/media-service';
import type { PlaceSummary } from '@/features/marketplace/services/marketplace-catalog-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

export default function MarketPlacesScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ query?: string; category?: string }>();
  const bootstrap = useExploreBootstrap();
  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [sort, setSort] = useState<'rating' | 'reviews' | 'new'>('rating');

  const places = usePlaces(
    {
      query: params.query ?? null,
      category,
      districtId,
      sort,
      limit: 50,
    },
    { enabled: true },
  );

  const categories = useMemo(
    () => bootstrap.data?.place_categories ?? [],
    [bootstrap.data?.place_categories],
  );
  const districts = bootstrap.data?.districts ?? [];
  const items = places.data?.items ?? [];

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="surface"
          size={20}
          onPress={() => router.back()}
        />
        <View style={styles.flex}>
          <AppText variant="h2" numberOfLines={1}>
            İşletmeler
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {places.data
              ? `${places.data.total} işletme · Trabzon`
              : 'Trabzon’daki yerel işletmeler'}
          </AppText>
        </View>
        <IconButton
          name="map-outline"
          accessibilityLabel="Haritada keşfet"
          variant="surface"
          size={18}
          onPress={() => router.push('/map' as never)}
        />
      </View>

      <View style={styles.filters}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip label="Tümü" active={category == null} onPress={() => setCategory(null)} />
          {categories.map((entry) => (
            <Chip
              key={entry.id}
              label={entry.name}
              active={category === entry.slug}
              onPress={() => {
                haptics.selection();
                setCategory(category === entry.slug ? null : entry.slug);
              }}
            />
          ))}
        </ScrollView>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subChips}
        >
          <Chip
            small
            label="Tüm ilçeler"
            active={districtId == null}
            onPress={() => setDistrictId(null)}
          />
          {districts.map((district) => (
            <Chip
              key={district.id}
              small
              label={district.name}
              active={districtId === district.id}
              onPress={() => {
                haptics.selection();
                setDistrictId(districtId === district.id ? null : district.id);
              }}
            />
          ))}
        </ScrollView>

        <View style={styles.sortRow}>
          {(
            [
              { key: 'rating', label: 'Puana göre' },
              { key: 'reviews', label: 'Yorum sayısı' },
              { key: 'new', label: 'Yeni eklenen' },
            ] as const
          ).map((option) => (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === option.key }}
              onPress={() => {
                haptics.selection();
                setSort(option.key);
              }}
              style={styles.sortButton}
            >
              <AppText
                variant="caption"
                color={sort === option.key ? 'primaryDeep' : 'textTertiary'}
              >
                {option.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>

      {places.isLoading ? (
        <View style={styles.loading}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} height={196} radius={18} />
          ))}
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={places.isRefetching}
              onRefresh={() => void places.refetch()}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
        >
          {items.length ? (
            items.map((place) => (
              <PlaceCard
                key={place.id}
                place={place}
                onPress={() => router.push(`/marketplace/place/${place.id}` as never)}
                onMap={() => {
                  if (place.lat == null || place.lng == null) {
                    return;
                  }
                  router.push({
                    pathname: '/map',
                    params: {
                      lat: String(place.lat),
                      lng: String(place.lng),
                      label: place.name,
                      zoom: '15',
                    },
                  } as never);
                }}
              />
            ))
          ) : places.isError ? (
            <View style={styles.state}>
              <Ionicons name="cloud-offline-outline" size={28} color={theme.colors.textTertiary} />
              <AppText variant="h3" align="center">
                İşletmeler yüklenemedi
              </AppText>
              <AppText variant="body" color="textSecondary" align="center">
                Bağlantını kontrol edip tekrar dene.
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tekrar dene"
                onPress={() => void places.refetch()}
                style={[styles.retry, { backgroundColor: theme.colors.primaryDeep }]}
              >
                <AppText variant="label" color="onPrimary">
                  Tekrar dene
                </AppText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.state}>
              <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="storefront-outline" size={26} color={theme.colors.primaryDeep} />
              </View>
              <AppText variant="h3" align="center">
                İşletme bulunamadı
              </AppText>
              <AppText variant="body" color="textSecondary" align="center">
                Kategori veya ilçe filtresini değiştirerek tekrar dene.
              </AppText>
            </View>
          )}
          {places.isFetching && !places.isLoading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

function PlaceCard({
  place,
  onPress,
  onMap,
}: {
  place: PlaceSummary;
  onPress: () => void;
  onMap: () => void;
}) {
  const { theme } = useTheme();
  const uri = publicMediaUrl('place-media', place.cover_path);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${place.name}, ${place.category_name ?? 'işletme'}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.cover, { backgroundColor: theme.colors.surfaceMuted }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={160}
            cachePolicy="memory-disk"
          />
        ) : (
          <Ionicons name="storefront-outline" size={34} color={theme.colors.textTertiary} />
        )}
        {place.is_verified ? (
          <View style={styles.verified}>
            <Ionicons name="shield-checkmark" size={11} color="#FFFFFF" />
            <AppText variant="caption" color="#FFFFFF">
              Doğrulanmış
            </AppText>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${place.name} konumunu haritada aç`}
          onPress={onMap}
          style={styles.mapButton}
        >
          <Ionicons name="map" size={16} color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <View style={styles.flex}>
            <AppText variant="title" numberOfLines={1}>
              {place.name}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {[place.category_name, place.district, place.neighborhood]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
          </View>
          {place.rating != null ? (
            <View style={[styles.rating, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name="star" size={12} color="#F6B73C" />
              <AppText variant="caption" color="textSecondary">
                {place.rating.toFixed(1)}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                ({place.review_count})
              </AppText>
            </View>
          ) : null}
        </View>
        <View style={styles.cardMeta}>
          <AppText variant="caption" color="textTertiary">
            {place.price_level ? '₺'.repeat(place.price_level) : 'Fiyat bilgisi yok'}
          </AppText>
          {place.is_open != null ? (
            <View style={styles.openRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: place.is_open ? theme.colors.success : theme.colors.danger },
                ]}
              />
              <AppText variant="caption" color={place.is_open ? 'textSecondary' : 'danger'}>
                {place.is_open ? 'Şu an açık' : 'Şu an kapalı'}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function Chip({
  label,
  active,
  small = false,
  onPress,
}: {
  label: string;
  active: boolean;
  small?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        small ? styles.chipSmall : null,
        {
          backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
          borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
        },
      ]}
    >
      <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 6,
  },
  flex: { flex: 1, gap: 1 },
  filters: { gap: 7, paddingBottom: 8 },
  chips: { gap: 7, paddingHorizontal: 18 },
  subChips: { gap: 6, paddingHorizontal: 18 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipSmall: { paddingHorizontal: 10, paddingVertical: 6, minHeight: 30 },
  sortRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 18, paddingTop: 2 },
  sortButton: { paddingVertical: 4 },
  content: { paddingHorizontal: 18, paddingBottom: 34, gap: 12 },
  loading: { padding: 18, gap: 12 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cover: { height: 168, alignItems: 'center', justifyContent: 'center' },
  verified: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(6,12,24,0.62)',
  },
  mapButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,12,24,0.55)',
  },
  cardBody: { padding: 12, gap: 6 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  state: { alignItems: 'center', gap: 7, paddingVertical: 46, paddingHorizontal: 24 },
  stateIcon: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retry: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, marginTop: 6 },
});
