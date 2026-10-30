import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from '@/utils/router';

import { AppText, IconButton, Screen, Skeleton } from '@/components/ui';
import { useExploreBootstrap } from '@/features/explore/hooks/use-explore';
import {
  MarketFilterSheet,
  EMPTY_MARKET_FILTERS,
  type MarketFilters,
} from '@/features/marketplace/components/MarketFilterSheet';
import { MarketListingCard } from '@/features/marketplace/components/MarketListingCard';
import { SaveSearchSheet } from '@/features/marketplace/components/SaveSearchSheet';
import {
  useMarketCatalog,
  useMarketCategories,
  useToggleFavoriteV2,
} from '@/features/marketplace/hooks/use-marketplace-catalog';
import type { CategoryNode } from '@/features/marketplace/services/marketplace-catalog-service';
import { AdPlacementSlot, interleaveRows, useAdPlacement, type AdPlacementKey } from '@/features/ads';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

const SORT_LABELS: Record<MarketFilters['sort'], string> = {
  new: 'En yeni',
  price_asc: 'Fiyat ↑',
  price_desc: 'Fiyat ↓',
  popular: 'Popüler',
  near: 'Yakın',
};

function catalogAdPlacement(kind: string | null): AdPlacementKey | null {
  if (kind === 'place') {
    return null;
  }
  if (kind === 'vehicle') {
    return 'vehicle_list';
  }
  if (kind === 'job') {
    return 'job_list';
  }
  if (kind === 'real_estate') {
    return 'real_estate_list';
  }
  return 'marketplace_category';
}

function findNode(nodes: CategoryNode[], slug: string | null): CategoryNode | null {
  if (!slug) {
    return null;
  }
  for (const node of nodes) {
    if (node.slug === slug) {
      return node;
    }
    const child = findNode(node.children, slug);
    if (child) {
      return child;
    }
  }
  return null;
}

function findRoot(nodes: CategoryNode[], slug: string | null): CategoryNode | null {
  if (!slug) {
    return null;
  }
  for (const node of nodes) {
    if (node.slug === slug || findNode(node.children, slug)) {
      return node;
    }
  }
  return null;
}

export default function MarketCatalogScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    kind?: string;
    category?: string;
    subcategory?: string;
    title?: string;
    query?: string;
    districtId?: string;
    minPrice?: string;
    maxPrice?: string;
    condition?: string;
    sort?: string;
    favorites?: string;
  }>();
  const kind = params.kind ?? null;
  const initialCategory = params.category ?? null;
  const initialSub = params.subcategory ?? null;
  const initialQuery = params.query ?? null;
  const categories = useMarketCategories();
  const bootstrap = useExploreBootstrap();
  const favorite = useToggleFavoriteV2();

  const tree = useMemo(() => categories.data ?? [], [categories.data]);
  const initialRoot = useMemo(
    () => findRoot(tree, initialCategory ?? initialSub)?.slug ?? initialCategory ?? null,
    [initialCategory, initialSub, tree],
  );
  const [rootSlug, setRootSlug] = useState<string | null>(initialRoot);
  const [subSlug, setSubSlug] = useState<string | null>(initialSub);
  const [filters, setFilters] = useState<MarketFilters>(() => ({
    ...EMPTY_MARKET_FILTERS,
    districtId: params.districtId ? Number(params.districtId) : null,
    minPrice: params.minPrice ?? '',
    maxPrice: params.maxPrice ?? '',
    condition: params.condition ?? null,
    favorites: params.favorites === '1' || params.favorites === 'true',
    sort:
      params.sort === 'price_asc' ||
      params.sort === 'price_desc' ||
      params.sort === 'popular' ||
      params.sort === 'near'
        ? params.sort
        : 'new',
  }));
  const [filterOpen, setFilterOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  useEffect(() => {
    if (initialRoot && !rootSlug) {
      // Başlangıç kategori parametresi yalnızca bir kez uygulanır.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRootSlug(initialRoot);
    }
  }, [initialRoot, rootSlug]);

  const roots = useMemo(() => {
    if (!kind || kind === 'place') {
      return tree;
    }
    return tree.filter((node) => node.kind === kind);
  }, [kind, tree]);

  const activeRoot = useMemo(
    () => roots.find((node) => node.slug === rootSlug) ?? null,
    [rootSlug, roots],
  );

  const queryParams = useMemo(
    () => ({
      query: initialQuery,
      kind,
      category: rootSlug,
      subcategory: subSlug,
      districtId: filters.districtId,
      minPrice: filters.minPrice ? Number(filters.minPrice) : null,
      maxPrice: filters.maxPrice ? Number(filters.maxPrice) : null,
      condition: filters.condition,
      sort: filters.sort,
      favorites: filters.favorites,
      lat: filters.sort === 'near' ? (bootstrap.data?.city.center_lat ?? null) : null,
      lng: filters.sort === 'near' ? (bootstrap.data?.city.center_lng ?? null) : null,
      limit: 20,
    }),
    [
      bootstrap.data?.city.center_lat,
      bootstrap.data?.city.center_lng,
      filters.condition,
      filters.districtId,
      filters.favorites,
      filters.maxPrice,
      filters.minPrice,
      filters.sort,
      initialQuery,
      kind,
      rootSlug,
      subSlug,
    ],
  );

  const catalog = useMarketCatalog(queryParams, { enabled: kind !== 'place' });
  const adPlacement = catalogAdPlacement(kind ?? activeRoot?.kind ?? null);
  const ads = useAdPlacement(adPlacement, catalog.items.length, { columns: 2 });
  const rows = useMemo(
    () => interleaveRows(catalog.items, ads.positions, (item) => item.id),
    [ads.positions, catalog.items],
  );
  const title =
    params.title ?? activeRoot?.name ?? (initialQuery ? `“${initialQuery}”` : 'Tüm İlanlar');
  const hasActiveFilters =
    filters.districtId != null ||
    filters.minPrice !== '' ||
    filters.maxPrice !== '' ||
    filters.condition != null ||
    filters.favorites ||
    filters.sort !== 'new';

  const selectRoot = (node: CategoryNode | null) => {
    haptics.selection();
    setRootSlug(node?.slug ?? null);
    setSubSlug(null);
  };

  const openListing = useCallback(
    (id: string) => router.push(`/marketplace/${id}` as never),
    [router],
  );

  const savedFilters = useMemo(
    () => ({
      kind,
      category: rootSlug,
      subcategory: subSlug,
      district_id: filters.districtId,
      min_price: filters.minPrice || null,
      max_price: filters.maxPrice || null,
      condition: filters.condition,
      sort: filters.sort,
      favorites: filters.favorites,
    }),
    [filters, kind, rootSlug, subSlug],
  );

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
        <View style={styles.headerCopy}>
          <AppText variant="h3" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {catalog.total > 0 ? `${catalog.total} ilan` : 'Trabzon geneli'}
            {hasActiveFilters ? ' · filtreli' : ''}
          </AppText>
        </View>
        <IconButton
          name="bookmark-outline"
          accessibilityLabel="Aramayı kaydet"
          variant="surface"
          size={18}
          onPress={() => setSaveOpen(true)}
        />
        <IconButton
          name="options-outline"
          accessibilityLabel="Filtreler"
          variant="surface"
          size={18}
          onPress={() => setFilterOpen(true)}
        />
      </View>

      <View style={styles.controls}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <FilterChip label="Tümü" active={rootSlug == null} onPress={() => selectRoot(null)} />
          {roots.map((node) => (
            <FilterChip
              key={node.id}
              label={node.name}
              active={node.slug === rootSlug}
              onPress={() => selectRoot(node)}
            />
          ))}
        </ScrollView>

        {activeRoot?.children.length ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.subChips}
          >
            <FilterChip
              label="Tümü"
              small
              active={subSlug == null}
              onPress={() => setSubSlug(null)}
            />
            {activeRoot.children
              .filter((child) => child.name !== 'Diğer' || activeRoot.children.length === 1)
              .map((child) => (
                <FilterChip
                  key={child.id}
                  label={child.name}
                  small
                  active={child.slug === subSlug}
                  onPress={() => {
                    haptics.selection();
                    setSubSlug(subSlug === child.slug ? null : child.slug);
                  }}
                />
              ))}
          </ScrollView>
        ) : null}

        <View style={styles.sortRow}>
          <AppText variant="caption" color="textTertiary">
            {filters.sort === 'new'
              ? 'En yeni ilanlar önce'
              : `Sıralama: ${SORT_LABELS[filters.sort]}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filtreleri aç"
            onPress={() => setFilterOpen(true)}
            style={({ pressed }) => [
              styles.filterPill,
              {
                backgroundColor: hasActiveFilters ? theme.colors.primarySoft : 'transparent',
                borderColor: hasActiveFilters ? theme.colors.primary : theme.colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              name="options-outline"
              size={13}
              color={hasActiveFilters ? theme.colors.primaryDeep : theme.colors.textSecondary}
            />
            <AppText variant="caption" color={hasActiveFilters ? 'primaryDeep' : 'textSecondary'}>
              {hasActiveFilters ? 'Filtreler açık' : 'Filtrele'}
            </AppText>
          </Pressable>
        </View>
      </View>

      {catalog.isLoading ? (
        <View style={styles.skeletonWrap}>
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <View key={key} style={styles.skeletonCell}>
              <Skeleton height={150} radius={16} />
              <Skeleton height={12} width="80%" />
              <Skeleton height={11} width="45%" />
            </View>
          ))}
        </View>
      ) : catalog.isError ? (
        <State
          icon="cloud-offline-outline"
          title="İlanlar yüklenemedi"
          body="Bağlantını kontrol edip tekrar dene."
          actionLabel="Tekrar dene"
          onAction={() => void catalog.refetch()}
        />
      ) : (
        <FlashList
          keyboardShouldPersistTaps="handled"
          data={rows}
          numColumns={2}
          keyExtractor={(row) => row.key}
          getItemType={(row) => row.type}
          overrideItemLayout={(layout, row) => {
            if (row.type === 'ad') {
              layout.span = 2;
            }
          }}
          renderItem={({ item: row }) =>
            row.type === 'ad' ? (
              <AdPlacementSlot
                slot={ads.slotAt(row.after)}
                placement={adPlacement ?? 'marketplace_category'}
                onHide={ads.hide}
                style={styles.adCell}
              />
            ) : (
              <View style={styles.cell}>
                <MarketListingCard
                  listing={row.item}
                  onPress={() => openListing(row.item.id)}
                  onToggleFavorite={() => favorite.mutate(row.item.id)}
                  favoritePending={favorite.isPending && favorite.variables === row.item.id}
                />
              </View>
            )
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={catalog.loadMore}
          onEndReachedThreshold={0.6}
          ListEmptyComponent={
            <State
              icon="search-outline"
              title="Eşleşen ilan yok"
              body="Filtreleri sadeleştir veya farklı bir kategori dene."
              actionLabel={hasActiveFilters ? 'Filtreleri temizle' : 'İlan oluştur'}
              onAction={() => {
                if (hasActiveFilters) {
                  setFilters(EMPTY_MARKET_FILTERS);
                } else {
                  router.push('/marketplace/create' as never);
                }
              }}
            />
          }
          ListFooterComponent={
            catalog.isFetchingNextPage ? (
              <ActivityIndicator color={theme.colors.primary} style={styles.footer} />
            ) : catalog.items.length > 0 && !catalog.hasNextPage ? (
              <AppText variant="caption" color="textTertiary" align="center" style={styles.footer}>
                Tüm ilanları gördün
              </AppText>
            ) : (
              <View style={styles.footerSpace} />
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={catalog.isRefetching && !catalog.isFetchingNextPage}
              onRefresh={() => void catalog.refetch()}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
        />
      )}

      <MarketFilterSheet
        visible={filterOpen}
        initial={filters}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFilterOpen(false);
        }}
        onSaveSearch={(next) => {
          setFilters(next);
          setFilterOpen(false);
          setSaveOpen(true);
        }}
      />

      <SaveSearchSheet
        visible={saveOpen}
        defaultLabel={title}
        filters={savedFilters}
        onClose={() => setSaveOpen(false)}
      />
    </Screen>
  );
}

function FilterChip({
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
      style={({ pressed }) => [
        styles.chip,
        small ? styles.chipSmall : null,
        {
          backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
          borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function State({
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
        onPress={onAction}
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

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 8,
  },
  headerCopy: { flex: 1, gap: 1 },
  controls: { gap: 8, paddingBottom: 8 },
  chips: { gap: 7, paddingHorizontal: 16 },
  subChips: { gap: 6, paddingHorizontal: 16 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipSmall: { paddingHorizontal: 11, paddingVertical: 6, minHeight: 31 },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 2,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 30,
  },
  listContent: { paddingHorizontal: 13, paddingBottom: 28 },
  cell: { paddingHorizontal: 5, marginBottom: 10 },
  adCell: { paddingHorizontal: 5, paddingTop: 0, paddingBottom: 12 },
  skeletonWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 18,
    paddingTop: 8,
    gap: 10,
  },
  skeletonCell: { width: '47%', gap: 6 },
  state: { paddingHorizontal: 34, paddingVertical: 42, alignItems: 'center', gap: 8 },
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
  footer: { paddingVertical: 18 },
  footerSpace: { height: 12 },
});
