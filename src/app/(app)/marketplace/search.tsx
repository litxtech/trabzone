import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, IconButton, Skeleton, TextField } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useClearSearchHistory,
  useMarketCategories,
  useMarketSearchHub,
  useSaveSearchHistory,
  useSearchHistory,
  useToggleFavoriteV2,
} from '@/features/marketplace/hooks/use-marketplace-catalog';
import { MarketListingCard } from '@/features/marketplace/components/MarketListingCard';
import { publicMediaUrl } from '@/features/media/media-service';
import type {
  CategorySearchRow,
  CategoryNode,
  PlaceSummary,
} from '@/features/marketplace/services/marketplace-catalog-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

const KIND_FILTERS = [
  { key: null, label: 'Tümü' },
  { key: 'real_estate', label: 'Emlak' },
  { key: 'product', label: 'Ürünler' },
  { key: 'place', label: 'İşletmeler' },
  { key: 'vehicle', label: 'Araçlar' },
  { key: 'service', label: 'Hizmetler' },
] as const;

export default function MarketSearchScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const [term, setTerm] = useState(params.q ?? '');
  const [kind, setKind] = useState<null | string>(null);
  const debounced = useDebouncedValue(term.trim(), 280);
  const hub = useMarketSearchHub(debounced, kind);
  const history = useSearchHistory({ enabled: term.trim().length < 2 });
  const saveHistory = useSaveSearchHistory();
  const clearHistory = useClearSearchHistory();
  const categories = useMarketCategories();
  const favorite = useToggleFavoriteV2();

  const resultCount =
    (hub.data?.listings.length ?? 0) +
    (hub.data?.categories.length ?? 0) +
    (hub.data?.places.length ?? 0);
  const showResults = debounced.length >= 2;
  const recent = history.data ?? [];
  const featured = useMemo(
    () => (categories.data ?? []).filter((node) => node.is_featured).slice(0, 8),
    [categories.data],
  );

  const submit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length < 2) {
        return;
      }
      Keyboard.dismiss();
      setTerm(trimmed);
      saveHistory.mutate({ query: trimmed, kind, resultCount });
    },
    [kind, resultCount, saveHistory],
  );

  const openCategory = (row: { slug: string; path_slugs: string[] }) => {
    const rootSlug = row.path_slugs[0] ?? row.slug;
    const isRoot = rootSlug === row.slug;
    router.push({
      pathname: '/marketplace/catalog',
      params: {
        category: rootSlug,
        ...(isRoot ? {} : { subcategory: row.slug }),
      },
    } as never);
  };

  const openPlace = (id: string) => router.push(`/marketplace/place/${id}` as never);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="surface"
          size={20}
          onPress={() => router.back()}
        />
        <TextField
          value={term}
          onChangeText={setTerm}
          placeholder="Trabzon'da ne arıyorsun?"
          leftIcon="search-outline"
          autoFocus={!params.q}
          returnKeyType="search"
          onSubmitEditing={() => submit(term)}
          containerStyle={styles.searchField}
          rightSlot={
            term.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Aramayı temizle"
                hitSlop={8}
                onPress={() => setTerm('')}
              >
                <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
              </Pressable>
            ) : undefined
          }
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kindRow}
        >
          {KIND_FILTERS.map((filter) => {
            const active = kind === filter.key;
            return (
              <Pressable
                key={filter.label}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptics.selection();
                  setKind(filter.key);
                }}
                style={[
                  styles.kindChip,
                  {
                    backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                    borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                  },
                ]}
              >
                <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                  {filter.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>

        {!showResults ? (
          <View style={styles.emptyQuery}>
            {recent.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <AppText variant="label" color="textSecondary">
                    Son aramalar
                  </AppText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Arama geçmişini temizle"
                    hitSlop={8}
                    onPress={() => clearHistory.mutate()}
                  >
                    <AppText variant="caption" color="textTertiary">
                      Temizle
                    </AppText>
                  </Pressable>
                </View>
                <View style={styles.historyWrap}>
                  {recent.map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.query} aramasını tekrarla`}
                      onPress={() => submit(item.query)}
                      style={[
                        styles.historyChip,
                        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                      ]}
                    >
                      <Ionicons name="time-outline" size={13} color={theme.colors.textTertiary} />
                      <AppText variant="caption" numberOfLines={1} style={styles.historyText}>
                        {item.query}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <AppText variant="label" color="textSecondary">
                  Kategorilerde gez
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Tüm kategorileri aç"
                  hitSlop={8}
                  onPress={() => router.push('/marketplace/categories' as never)}
                >
                  <AppText variant="caption" color="primaryDeep">
                    Tümü
                  </AppText>
                </Pressable>
              </View>
              <View style={styles.featuredGrid}>
                {(featured.length ? featured : (categories.data ?? []).slice(0, 8)).map((node) => (
                  <CategoryTile
                    key={node.id}
                    node={node}
                    onPress={() => {
                      haptics.tap();
                      router.push({
                        pathname: '/marketplace/catalog',
                        params: { kind: node.kind, category: node.slug, title: node.name },
                      } as never);
                    }}
                  />
                ))}
              </View>
            </View>

            <View
              style={[
                styles.tipCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={[styles.tipIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="sparkles-outline" size={18} color={theme.colors.primaryDeep} />
              </View>
              <View style={styles.flex}>
                <AppText variant="label">Kategori adıyla da ara</AppText>
                <AppText variant="caption" color="textTertiary">
                  “kiralık dükkân”, “iphone”, “fındık” veya “tesisatçı” yaz; kategori yollarını da
                  tarayalım.
                </AppText>
              </View>
            </View>
          </View>
        ) : hub.isLoading ? (
          <View style={styles.loading}>
            <Skeleton height={18} width="45%" />
            <Skeleton height={72} radius={14} />
            <Skeleton height={72} radius={14} />
            <Skeleton height={72} radius={14} />
          </View>
        ) : hub.isError ? (
          <View style={styles.state}>
            <Ionicons name="cloud-offline-outline" size={28} color={theme.colors.textTertiary} />
            <AppText variant="h3" align="center">
              Arama yapılamadı
            </AppText>
            <AppText variant="body" color="textSecondary" align="center">
              Bağlantını kontrol edip tekrar dene.
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tekrar dene"
              onPress={() => void hub.refetch()}
              style={[styles.retry, { backgroundColor: theme.colors.primaryDeep }]}
            >
              <AppText variant="label" color="onPrimary">
                Tekrar dene
              </AppText>
            </Pressable>
          </View>
        ) : resultCount === 0 ? (
          <View style={styles.state}>
            <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="search-outline" size={26} color={theme.colors.primaryDeep} />
            </View>
            <AppText variant="h3" align="center">
              “{debounced}” için sonuç yok
            </AppText>
            <AppText variant="body" color="textSecondary" align="center">
              Yazımı kontrol et veya daha genel bir kelime dene.
            </AppText>
          </View>
        ) : (
          <View style={styles.results}>
            {hub.data?.categories.length ? (
              <View style={styles.section}>
                <AppText variant="label" color="textSecondary">
                  Kategoriler
                </AppText>
                <View style={[styles.group, { borderColor: theme.colors.border }]}>
                  {hub.data.categories.map((row) => (
                    <CategoryRow key={row.id} row={row} onPress={() => openCategory(row)} />
                  ))}
                </View>
              </View>
            ) : null}

            {hub.data?.listings.length ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <AppText variant="label" color="textSecondary">
                    İlanlar
                  </AppText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Tüm ilan sonuçlarını gör"
                    hitSlop={8}
                    onPress={() =>
                      router.push({
                        pathname: '/marketplace/catalog',
                        params: { query: debounced, kind, title: `“${debounced}”` },
                      } as never)
                    }
                  >
                    <AppText variant="caption" color="primaryDeep">
                      Tümünü gör
                    </AppText>
                  </Pressable>
                </View>
                <View style={styles.listingList}>
                  {hub.data.listings.map((listing) => (
                    <MarketListingCard
                      key={listing.id}
                      listing={listing}
                      layout="row"
                      showSeller
                      onPress={() => router.push(`/marketplace/${listing.id}` as never)}
                      onToggleFavorite={() => favorite.mutate(listing.id)}
                      favoritePending={favorite.isPending && favorite.variables === listing.id}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {hub.data?.places.length ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <AppText variant="label" color="textSecondary">
                    İşletmeler
                  </AppText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Tüm işletme sonuçlarını gör"
                    hitSlop={8}
                    onPress={() =>
                      router.push({
                        pathname: '/marketplace/places',
                        params: { query: debounced },
                      } as never)
                    }
                  >
                    <AppText variant="caption" color="primaryDeep">
                      Tümünü gör
                    </AppText>
                  </Pressable>
                </View>
                <View style={styles.listingList}>
                  {hub.data.places.map((place) => (
                    <PlaceRow key={place.id} place={place} onPress={() => openPlace(place.id)} />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      {hub.isFetching && showResults ? (
        <View style={styles.fetching}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

function CategoryTile({ node, onPress }: { node: CategoryNode; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={node.name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons
          name={(node.icon as never) ?? 'grid-outline'}
          size={17}
          color={theme.colors.primaryDeep}
        />
      </View>
      <AppText variant="caption" numberOfLines={1}>
        {node.name}
      </AppText>
    </Pressable>
  );
}

function CategoryRow({ row, onPress }: { row: CategorySearchRow; onPress: () => void }) {
  const { theme } = useTheme();
  const path = row.path_names.length > 1 ? row.path_names.slice(1).join(' › ') : 'Ana kategori';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.name}, ${row.listing_count} ilan`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons
          name={(row.icon as never) ?? 'pricetag-outline'}
          size={16}
          color={theme.colors.primaryDeep}
        />
      </View>
      <View style={styles.flex}>
        <AppText variant="label" numberOfLines={1}>
          {row.name}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {path}
        </AppText>
      </View>
      <AppText variant="caption" color="textTertiary">
        {row.listing_count}
      </AppText>
      <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

function PlaceRow({ place, onPress }: { place: PlaceSummary; onPress: () => void }) {
  const { theme } = useTheme();
  const uri = publicMediaUrl('place-media', place.cover_path);
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
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.placeImage, { backgroundColor: theme.colors.surfaceMuted }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={120}
            cachePolicy="memory-disk"
          />
        ) : (
          <Ionicons name="storefront-outline" size={20} color={theme.colors.textTertiary} />
        )}
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {place.name}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {[place.category_name, place.district].filter(Boolean).join(' · ')}
        </AppText>
        {place.rating != null ? (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={11} color="#F6B73C" />
            <AppText variant="caption" color="textSecondary">
              {place.rating.toFixed(1)}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              ({place.review_count})
            </AppText>
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 52,
    paddingBottom: 8,
  },
  searchField: { flex: 1 },
  content: { paddingBottom: 40 },
  kindRow: { gap: 7, paddingHorizontal: 18, paddingVertical: 8 },
  kindChip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
    justifyContent: 'center',
  },
  emptyQuery: { gap: 18, paddingTop: 6 },
  section: { gap: 8, paddingHorizontal: 18 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  historyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  historyText: { maxWidth: 210 },
  featuredGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 9,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tileIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipCard: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 18,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tipIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1, gap: 1 },
  loading: { paddingHorizontal: 18, paddingTop: 16, gap: 10 },
  state: { alignItems: 'center', gap: 8, paddingHorizontal: 36, paddingVertical: 44 },
  stateIcon: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retry: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, marginTop: 6 },
  results: { gap: 20, paddingTop: 6 },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, minHeight: 54 },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listingList: { gap: 9 },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 9,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  placeImage: {
    width: 58,
    height: 58,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  fetching: { position: 'absolute', right: 16, bottom: 22 },
});
