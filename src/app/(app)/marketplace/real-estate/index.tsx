import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { AppText, Badge, Button, Skeleton } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import {
  useDeleteRealEstateSavedSearch,
  useExploreBootstrap,
  useMyListings,
  useRealEstateList,
  useRealEstateSavedSearches,
  useSaveRealEstateSearch,
  useSetRealEstateSearchNotify,
  useToggleListingFavorite,
} from '@/features/explore/hooks/use-explore';
import type { RealEstateListing, RealEstateSavedSearch } from '@/features/explore/types';
import { formatMoney } from '@/features/explore/utils/format';
import { AdPlacementSlot, interleaveRows, useAdPlacement } from '@/features/ads';
import { MapSheet } from '@/features/map/components/MapSheet';
import {
  EMPTY_RE_FILTERS,
  RealEstateFilterSheet,
  type RealEstateFilters,
} from '@/features/real-estate/components/RealEstateFilterSheet';
import { ListingCard } from '@/features/real-estate/components/ListingCard';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

type ListingKind = RealEstateFilters['listingKind'];

const KIND_TABS: { key: ListingKind; label: string }[] = [
  { key: null, label: 'Tümü' },
  { key: 'rent', label: 'Kiralık' },
  { key: 'sale', label: 'Satılık' },
  { key: 'transfer', label: 'Devren' },
];

const SORT_OPTIONS: { key: RealEstateFilters['sort']; label: string }[] = [
  { key: 'new', label: 'En yeni' },
  { key: 'price_asc', label: 'Fiyat artan' },
  { key: 'price_desc', label: 'Fiyat azalan' },
  { key: 'popular', label: 'Popüler' },
];

const CONTENT_MAX_WIDTH = 1080;
const GRID_GAP = 10;

export default function RealEstateHomeScreen() {
  const { theme, scheme } = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const { width } = useWindowDimensions();
  const bootstrap = useExploreBootstrap();
  const districts = useMemo(() => bootstrap.data?.districts ?? [], [bootstrap.data?.districts]);
  const categories = useMemo(
    () => bootstrap.data?.real_estate_categories ?? [],
    [bootstrap.data?.real_estate_categories],
  );

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [filters, setFilters] = useState<RealEstateFilters>(EMPTY_RE_FILTERS);
  const [showAll, setShowAll] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [saveNotify, setSaveNotify] = useState(true);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.districtId != null) count += 1;
    if (filters.minPrice != null || filters.maxPrice != null) count += 1;
    if (filters.minM2 != null || filters.maxM2 != null) count += 1;
    if (filters.rooms != null) count += 1;
    if (filters.maxBuildingAge != null) count += 1;
    if (filters.ownerType != null) count += 1;
    return count;
  }, [filters]);

  const isFiltering =
    Boolean(debounced.trim()) ||
    filters.listingKind != null ||
    filters.category != null ||
    activeFilterCount > 0;

  const listMode = isFiltering || showAll;
  const browse = !listMode;

  const newest = useRealEstateList({ sort: 'new', limit: 9 }, { enabled: browse });
  const rent = useRealEstateList({ sort: 'new', listing_kind: 'rent', limit: 8 }, { enabled: browse });
  const sale = useRealEstateList({ sort: 'new', listing_kind: 'sale', limit: 8 }, { enabled: browse });
  const favorites = useRealEstateList(
    { sort: 'new', favorites: true, limit: 8 },
    { enabled: browse },
  );
  const myListings = useMyListings();
  const savedSearches = useRealEstateSavedSearches();
  const saveSearch = useSaveRealEstateSearch();
  const deleteSearch = useDeleteRealEstateSavedSearch();
  const toggleNotify = useSetRealEstateSearchNotify();
  const favorite = useToggleListingFavorite();

  const listParams = useMemo(() => {
    const params: Record<string, unknown> = {
      sort: filters.sort,
      limit: 30,
    };
    if (filters.listingKind) params.listing_kind = filters.listingKind;
    if (filters.category) params.category = filters.category;
    if (filters.districtId != null) params.district_id = filters.districtId;
    if (filters.neighborhoodId != null) params.neighborhood_id = filters.neighborhoodId;
    if (filters.minPrice != null) params.min_price = filters.minPrice;
    if (filters.maxPrice != null) params.max_price = filters.maxPrice;
    if (filters.minM2 != null) params.min_m2 = filters.minM2;
    if (filters.maxM2 != null) params.max_m2 = filters.maxM2;
    if (filters.rooms != null) params.rooms = filters.rooms;
    if (filters.maxBuildingAge != null) params.max_building_age = filters.maxBuildingAge;
    if (filters.ownerType) params.owner_type = filters.ownerType;
    if (debounced.trim()) params.query = debounced.trim();
    return params;
  }, [debounced, filters]);

  const results = useRealEstateList(listParams, { enabled: listMode });
  const resultItems = useMemo(() => results.data?.items ?? [], [results.data?.items]);

  const pageWidth = Math.min(width, CONTENT_MAX_WIDTH);
  const columns = pageWidth >= 900 ? 3 : 2;
  const cardWidth = Math.floor(
    (pageWidth - theme.layout.screenPadding * 2 - GRID_GAP * (columns - 1)) / columns,
  );

  const ads = useAdPlacement('real_estate_list', resultItems.length, {
    columns,
    enabled: listMode,
    contextDistrict:
      districts.find((district) => district.id === filters.districtId)?.name ?? null,
  });
  const resultRows = useMemo(
    () => interleaveRows(resultItems, ads.positions, (listing) => listing.id),
    [ads.positions, resultItems],
  );

  const categoryOptions = useMemo(
    () =>
      categories
        .filter((category) => category.children.length > 0)
        .flatMap((category) => category.children)
        .filter((category) => !filters.listingKind || category.listing_kind === filters.listingKind),
    [categories, filters.listingKind],
  );

  useFocusEffect(
    useCallback(() => {
      void client.invalidateQueries({ queryKey: ['explore', 're-list'] });
      void client.invalidateQueries({ queryKey: ['explore', 're-saved'] });
      void client.invalidateQueries({ queryKey: ['explore', 'my-listings'] });
    }, [client]),
  );

  const updateSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }
    searchTimer.current = setTimeout(() => setDebounced(value), 350);
  };

  const navigate = (path: string) => router.push(path as never);

  const openListing = (listing: RealEstateListing) =>
    navigate(`/marketplace/real-estate/${listing.id}`);

  const openCreate = () => navigate('/marketplace/real-estate/create');

  const clearAll = () => {
    setFilters(EMPTY_RE_FILTERS);
    setShowAll(false);
    setSearch('');
    setDebounced('');
  };

  const openMap = () => {
    const params = new URLSearchParams();
    params.set('mode', 're');
    if (filters.listingKind) params.set('kind', filters.listingKind);
    if (filters.category) params.set('category', filters.category);
    if (filters.districtId != null) params.set('districtId', String(filters.districtId));
    if (filters.neighborhoodId != null) params.set('neighborhoodId', String(filters.neighborhoodId));
    if (filters.minPrice != null) params.set('minPrice', String(filters.minPrice));
    if (filters.maxPrice != null) params.set('maxPrice', String(filters.maxPrice));
    if (filters.minM2 != null) params.set('minM2', String(filters.minM2));
    if (filters.rooms != null) params.set('rooms', String(filters.rooms));
    if (debounced.trim()) params.set('q', debounced.trim());
    navigate(`/explore?${params.toString()}`);
  };

  const toggleFavorite = (listing: RealEstateListing) => {
    favorite.mutate(listing.id, {
      onSuccess: (data) => {
        haptics.tap();
        if (data.favorite) {
          haptics.success();
        }
      },
      onError: (error) => Alert.alert('Favori kaydedilemedi', error.message),
    });
  };

  const openSaved = (item: RealEstateSavedSearch) => {
    setSavedOpen(false);
    const params = new URLSearchParams();
    params.set('mode', 're');
    params.set('savedAreaId', item.id);
    const raw = item.filters ?? {};
    const mapping: [string, string][] = [
      ['listing_kind', 'kind'],
      ['category', 'category'],
      ['district_id', 'districtId'],
      ['neighborhood_id', 'neighborhoodId'],
      ['min_price', 'minPrice'],
      ['max_price', 'maxPrice'],
      ['min_m2', 'minM2'],
      ['max_m2', 'maxM2'],
      ['rooms', 'rooms'],
    ];
    for (const [source, target] of mapping) {
      const value = raw[source];
      if (value != null && value !== '') {
        params.set(target, String(value));
      }
    }
    navigate(`/explore?${params.toString()}`);
  };

  const submitSaved = () => {
    if (saveLabel.trim().length < 3) {
      return;
    }
    const raw: Record<string, unknown> = {};
    if (filters.listingKind) raw.listing_kind = filters.listingKind;
    if (filters.category) raw.category = filters.category;
    if (filters.districtId != null) raw.district_id = filters.districtId;
    if (filters.neighborhoodId != null) raw.neighborhood_id = filters.neighborhoodId;
    if (filters.minPrice != null) raw.min_price = filters.minPrice;
    if (filters.maxPrice != null) raw.max_price = filters.maxPrice;
    if (filters.minM2 != null) raw.min_m2 = filters.minM2;
    if (filters.maxM2 != null) raw.max_m2 = filters.maxM2;
    if (filters.rooms != null) raw.rooms = filters.rooms;
    if (filters.maxBuildingAge != null) raw.max_building_age = filters.maxBuildingAge;
    if (filters.ownerType) raw.owner_type = filters.ownerType;
    if (debounced.trim()) raw.query = debounced.trim();

    saveSearch.mutate(
      { label: saveLabel.trim(), filters: raw, notify: saveNotify },
      {
        onSuccess: () => {
          haptics.success();
          setSaveOpen(false);
          setSaveLabel('');
          Alert.alert('Arama kaydedildi', 'Yeni uygun ilanlar için bildirim tercihin kaydedildi.');
        },
        onError: (error) => Alert.alert('Arama kaydedilemedi', error.message),
      },
    );
  };

  const myActiveCount = myListings.data?.items.length ?? 0;
  const savedCount = savedSearches.data?.length ?? 0;
  const selectedCategory = categoryOptions.find((item) => item.slug === filters.category) ?? null;
  const districtName =
    districts.find((district) => district.id === filters.districtId)?.name ?? null;
  const total = listMode ? (results.data?.total ?? null) : (newest.data?.total ?? null);

  const resultTitle =
    [filters.listingKind ? KIND_TABS.find((tab) => tab.key === filters.listingKind)?.label : null,
     selectedCategory?.name.replace(/^(Kiralık|Satılık|Devren)\s+/i, '') ?? null]
      .filter(Boolean)
      .join(' · ') || (debounced.trim() ? `“${debounced.trim()}” araması` : 'Arama sonuçları');

  const summaryParts: string[] = [];
  if (districtName) summaryParts.push(districtName);
  if (filters.minPrice != null || filters.maxPrice != null) {
    const min = filters.minPrice != null ? formatMoney(filters.minPrice * 100) : null;
    const max = filters.maxPrice != null ? formatMoney(filters.maxPrice * 100) : null;
    summaryParts.push(min && max ? `${min}–${max}` : min ? `${min} ve üzeri` : `${max} ve altı`);
  }
  if (filters.rooms != null) summaryParts.push(`${filters.rooms}+1`);
  if (activeFilterCount > 0 && summaryParts.length === 0) {
    summaryParts.push(`${activeFilterCount} filtre`);
  }

  const handleKind = (kind: ListingKind) => {
    haptics.tap();
    setFilters((current) => ({ ...current, listingKind: kind, category: null }));
  };

  const setCategory = (slug: string | null) => {
    haptics.tap();
    setFilters((current) => ({ ...current, category: current.category === slug ? null : slug }));
  };

  const setSort = (sort: RealEstateFilters['sort']) => {
    haptics.tap();
    setFilters((current) => ({ ...current, sort }));
  };

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Screen
        edges={['top', 'left', 'right', 'bottom']}
        scroll
        padded
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl
            refreshing={listMode ? results.isRefetching : newest.isRefetching}
            onRefresh={() => {
              void client.invalidateQueries({ queryKey: ['explore', 're-list'] });
              void client.invalidateQueries({ queryKey: ['explore', 'my-listings'] });
              void client.invalidateQueries({ queryKey: ['explore', 're-saved'] });
            }}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        {/* Üst çubuk: geri, başlık ve yalnızca ilan sahibine anlamlı ikonlar. */}
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Geri"
            hitSlop={8}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.replace('/marketplace' as never);
            }}
            style={({ pressed }) => [
              styles.round,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="chevron-back" size={21} color={theme.colors.text} />
          </Pressable>

          <View style={styles.headerText}>
            <AppText variant="h2" numberOfLines={1}>
              Emlak
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {total != null && total > 0 ? `Trabzon · ${total} ilan` : 'Trabzon’da emlak'}
            </AppText>
          </View>

          {myActiveCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="İlanlarım"
              hitSlop={6}
              onPress={() => navigate('/marketplace/real-estate/my-listings')}
              style={({ pressed }) => [
                styles.round,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="albums-outline" size={19} color={theme.colors.text} />
              <View style={[styles.countDot, { backgroundColor: theme.colors.primaryDeep }]}>
                <AppText variant="caption" color="#FFFFFF" style={styles.countDotText}>
                  {myActiveCount}
                </AppText>
              </View>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yeni ilan oluştur"
            hitSlop={6}
            onPress={openCreate}
            style={({ pressed }) => [
              styles.round,
              {
                backgroundColor: theme.colors.primaryDeep,
                borderColor: theme.colors.primaryDeep,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="add" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Arama alanı: filtre düğmesi kutunun içinde, tek satır. */}
        <View
          style={[
            styles.searchBox,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="search-outline" size={18} color={theme.colors.textTertiary} />
          <TextInput
            value={search}
            onChangeText={updateSearch}
            placeholder="Mahalle, ilan veya anahtar kelime ara"
            placeholderTextColor={theme.colors.textTertiary}
            style={[styles.searchInput, theme.typography.body, { color: theme.colors.text }]}
            returnKeyType="search"
            onSubmitEditing={() => setDebounced(search)}
            accessibilityLabel="Emlak ara"
          />
          {search.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Aramayı temizle"
              hitSlop={8}
              onPress={clearAll}
            >
              <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
            </Pressable>
          ) : null}
          <View style={[styles.searchDivider, { backgroundColor: theme.colors.border }]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filtreler"
            hitSlop={6}
            onPress={() => setFilterOpen(true)}
            style={({ pressed }) => [styles.filterButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={activeFilterCount > 0 ? theme.colors.primaryDeep : theme.colors.textSecondary}
            />
            {activeFilterCount > 0 ? (
              <View style={[styles.filterBadge, { backgroundColor: theme.colors.primaryDeep }]}>
                <AppText variant="caption" color="#FFFFFF" style={styles.filterBadgeText}>
                  {activeFilterCount}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* Kiralık / Satılık / Devren: ilan türü tek dokunuşla. */}
        <View style={[styles.segment, { backgroundColor: theme.colors.surfaceMuted }]}>
          {KIND_TABS.map((tab) => {
            const active = filters.listingKind === tab.key;
            return (
              <Pressable
                key={tab.label}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => handleKind(tab.key)}
                style={[
                  styles.segmentItem,
                  active
                    ? {
                        backgroundColor: theme.colors.surface,
                        borderColor: theme.colors.border,
                      }
                    : null,
                ]}
              >
                <AppText
                  variant="label"
                  color={active ? 'primaryDeep' : 'textTertiary'}
                  numberOfLines={1}
                >
                  {tab.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {/* Tür çipleri yalnızca bir ilan türü seçildiğinde görünür: üst alan sade kalır. */}
        {filters.listingKind && categoryOptions.length > 0 ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.hScroll}
            contentContainerStyle={styles.chipRow}
          >
            <Chip
              label="Tüm türler"
              active={filters.category == null}
              onPress={() => setCategory(null)}
            />
            {categoryOptions.map((category) => (
              <Chip
                key={category.slug}
                label={category.name.replace(/^(Kiralık|Satılık|Devren)\s+/i, '')}
                active={filters.category === category.slug}
                onPress={() => setCategory(category.slug)}
              />
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.linkRow}>
          <LinkChip icon="map-outline" label="Haritada keşfet" onPress={openMap} />
          <LinkChip
            icon="bookmark-outline"
            label={savedCount > 0 ? `Kayıtlı aramalar · ${savedCount}` : 'Kayıtlı aramalar'}
            onPress={() => setSavedOpen(true)}
          />
        </View>

        {listMode ? (
          <>
            <View style={styles.resultsHead}>
              <View style={styles.flex}>
                <AppText variant="h3" numberOfLines={1}>
                  {isFiltering ? resultTitle : 'Tüm ilanlar'}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {results.isFetching
                    ? 'Güncelleniyor…'
                    : [`${results.data?.total ?? 0} ilan`, ...summaryParts].join(' · ')}
                </AppText>
              </View>
              {isFiltering ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Bu aramayı kaydet"
                  onPress={() => {
                    setSaveLabel(resultTitle);
                    setSaveOpen(true);
                  }}
                  style={[styles.clearChip, { backgroundColor: theme.colors.primarySoft }]}
                >
                  <Ionicons name="bookmark-outline" size={13} color={theme.colors.primaryDeep} />
                  <AppText variant="caption" color="primaryDeep">
                    Kaydet
                  </AppText>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isFiltering ? 'Filtreleri temizle' : 'Listeyi kapat'}
                onPress={() => {
                  if (isFiltering) {
                    clearAll();
                    return;
                  }
                  setShowAll(false);
                }}
                style={[styles.clearChip, { backgroundColor: theme.colors.surfaceMuted }]}
              >
                <Ionicons name="close" size={13} color={theme.colors.textSecondary} />
                <AppText variant="caption" color="textSecondary">
                  {isFiltering ? 'Temizle' : 'Kapat'}
                </AppText>
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.hScroll}
              contentContainerStyle={styles.chipRow}
            >
              {SORT_OPTIONS.map((option) => (
                <Chip
                  key={option.key}
                  label={option.label}
                  active={filters.sort === option.key}
                  onPress={() => setSort(option.key)}
                />
              ))}
            </ScrollView>

            {results.isLoading ? (
              <GridSkeleton cardWidth={cardWidth} />
            ) : resultItems.length > 0 ? (
              <View style={styles.grid}>
                {resultRows.map((row) =>
                  row.type === 'ad' ? (
                    <AdPlacementSlot
                      key={row.key}
                      slot={ads.slotAt(row.after)}
                      placement="real_estate_list"
                      onHide={ads.hide}
                      style={styles.adRow}
                    />
                  ) : (
                    <ListingCard
                      key={row.key}
                      listing={row.item}
                      width={cardWidth}
                      onPress={() => openListing(row.item)}
                      onToggleFavorite={() => toggleFavorite(row.item)}
                    />
                  ),
                )}
              </View>
            ) : (
              <View
                style={[
                  styles.emptyCard,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="search-outline" size={24} color={theme.colors.primaryDeep} />
                </View>
                <AppText variant="h3" align="center">
                  {isFiltering ? 'Uygun ilan bulunamadı' : 'Henüz ilan yok'}
                </AppText>
                <AppText variant="body" color="textSecondary" align="center">
                  {isFiltering
                    ? 'Filtreleri gevşetmeyi veya haritada alan çizmeyi dene.'
                    : 'Yayınlanmış ilan bulunmuyor. İlk ilanı sen oluşturabilirsin.'}
                </AppText>
                <View style={styles.emptyActions}>
                  <Button
                    label={isFiltering ? 'Filtreleri temizle' : 'İlan oluştur'}
                    onPress={isFiltering ? clearAll : openCreate}
                    style={styles.flex}
                    size="sm"
                  />
                  <Button
                    label={isFiltering ? 'Haritada dene' : 'Haritada keşfet'}
                    variant="outline"
                    onPress={openMap}
                    style={styles.flex}
                    size="sm"
                  />
                </View>
              </View>
            )}
          </>
        ) : (
          <>
            {newest.isLoading ? (
              <GridSkeleton cardWidth={cardWidth} />
            ) : (newest.data?.items.length ?? 0) > 0 ? (
              <View style={styles.section}>
                <SectionHead
                  title="Öne çıkanlar"
                  subtitle="Trabzon'da son yayınlanan ilanlar"
                  onMore={() => setShowAll(true)}
                />
                <View style={styles.grid}>
                  {newest.data?.items.map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      width={cardWidth}
                      onPress={() => openListing(listing)}
                      onToggleFavorite={() => toggleFavorite(listing)}
                    />
                  ))}
                </View>
              </View>
            ) : (
              <EmptyDiscover onCreate={openCreate} onExploreMap={openMap} />
            )}

            {(rent.data?.items.length ?? 0) > 0 ? (
              <Rail
                title="Kiralık konutlar"
                subtitle="Aylık kiralık daire, villa ve müstakil evler"
                items={rent.data?.items ?? []}
                onMore={() => {
                  setFilters((current) => ({ ...current, listingKind: 'rent', category: null }));
                }}
                onOpen={openListing}
                onFavorite={toggleFavorite}
              />
            ) : null}

            {(sale.data?.items.length ?? 0) > 0 ? (
              <Rail
                title="Satılık ve ticari"
                subtitle="Satılık konut, işyeri ve arsa ilanları"
                items={sale.data?.items ?? []}
                onMore={() => {
                  setFilters((current) => ({ ...current, listingKind: 'sale', category: null }));
                }}
                onOpen={openListing}
                onFavorite={toggleFavorite}
              />
            ) : null}

            {(favorites.data?.items.length ?? 0) > 0 ? (
              <Rail
                title="Favorilerin"
                subtitle="Kalbe dokunarak kaydettiğin ilanlar"
                items={favorites.data?.items ?? []}
                onOpen={openListing}
                onFavorite={toggleFavorite}
              />
            ) : null}

            {myListings.data && myListings.data.items.length > 0 ? (
              <View style={styles.section}>
                <SectionHead
                  title="İlanlarım"
                  subtitle="Yayın, taslak ve doğrulama durumları"
                  onMore={() => navigate('/marketplace/real-estate/my-listings')}
                />
                <View
                  style={[
                    styles.myCard,
                    { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                  ]}
                >
                  {myListings.data.items.slice(0, 3).map((item, index) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={item.title}
                      onPress={() => navigate(`/marketplace/real-estate/${item.id}`)}
                      style={({ pressed }) => [
                        styles.myRow,
                        index > 0
                          ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border }
                          : null,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <View style={styles.flex}>
                        <AppText variant="bodyStrong" numberOfLines={1}>
                          {item.title}
                        </AppText>
                        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                          {formatMoney(item.price_cents, item.currency)} · {item.category_name}
                        </AppText>
                      </View>
                      <MyListingBadge status={item.status} eids={item.eids_status} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {(newest.data?.items.length ?? 0) > 0 ? (
              <View
                style={[
                  styles.cta,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <View style={[styles.ctaIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="add" size={20} color={theme.colors.primaryDeep} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">İlanın var mı?</AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                    İlanın anında yayınlanır; onay beklemez.
                  </AppText>
                </View>
                <Button label="İlan ver" size="sm" fullWidth={false} onPress={openCreate} />
              </View>
            ) : null}
          </>
        )}
      </Screen>

      <RealEstateFilterSheet
        visible={filterOpen}
        filters={filters}
        districts={districts}
        categories={categories}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFilterOpen(false);
        }}
      />

      <MapSheet
        visible={savedOpen}
        onClose={() => setSavedOpen(false)}
        title="Kaydedilen aramalar"
        subtitle="Yeni ilan eşleşmelerinde bildirim alırsın."
        maxHeightRatio={0.8}
      >
        {savedSearches.isLoading ? (
          <View style={styles.sheetLoading}>
            <Skeleton height={56} radius={14} />
            <Skeleton height={56} radius={14} />
          </View>
        ) : savedSearches.data && savedSearches.data.length > 0 ? (
          savedSearches.data.map((item) => (
            <View
              key={item.id}
              style={[
                styles.savedRow,
                { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => openSaved(item)}
                style={styles.flex}
              >
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {item.label}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {item.geometry ? 'Alan + filtre' : 'Filtre'} ·{' '}
                  {item.notify_enabled ? 'Bildirim açık' : 'Bildirim kapalı'}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.notify_enabled ? 'Bildirimi kapat' : 'Bildirimi aç'}
                hitSlop={8}
                onPress={() =>
                  toggleNotify.mutate(
                    { id: item.id, notify: !item.notify_enabled },
                    { onError: (error) => Alert.alert('Güncellenemedi', error.message) },
                  )
                }
                style={styles.rowIcon}
              >
                <Ionicons
                  name={item.notify_enabled ? 'notifications' : 'notifications-off-outline'}
                  size={17}
                  color={
                    item.notify_enabled ? theme.colors.primaryDeep : theme.colors.textTertiary
                  }
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Aramayı sil"
                hitSlop={8}
                onPress={() =>
                  Alert.alert('Aramayı sil', item.label, [
                    { text: 'Vazgeç', style: 'cancel' },
                    {
                      text: 'Sil',
                      style: 'destructive',
                      onPress: () =>
                        deleteSearch.mutate(item.id, {
                          onError: (error) => Alert.alert('Silinemedi', error.message),
                        }),
                    },
                  ])
                }
                style={styles.rowIcon}
              >
                <Ionicons name="trash-outline" size={17} color={theme.colors.textTertiary} />
              </Pressable>
            </View>
          ))
        ) : (
          <View style={styles.savedEmpty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name="bookmark-outline" size={24} color={theme.colors.textTertiary} />
            </View>
            <AppText variant="body" color="textSecondary" align="center">
              Henüz kaydedilmiş arama yok. Sonuç ekranındaki “Kaydet” ile filtrelerini
              saklayabilirsin.
            </AppText>
          </View>
        )}
      </MapSheet>

      <MapSheet
        visible={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Aramayı kaydet"
        subtitle="Filtrelerin hesabına bağlanır; yeni uygun ilanlarda bildirim hazırlanır."
        maxHeightRatio={0.6}
        footer={
          <Button
            label={saveNotify ? 'Kaydet ve bildirimleri aç' : 'Aramayı kaydet'}
            onPress={submitSaved}
            loading={saveSearch.isPending}
            disabled={saveLabel.trim().length < 3}
          />
        }
      >
        <TextInput
          value={saveLabel}
          onChangeText={setSaveLabel}
          placeholder="Örn. Ortahisar kiralık daire"
          placeholderTextColor={theme.colors.textTertiary}
          maxLength={80}
          style={[
            styles.sheetInput,
            theme.typography.body,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.inputBackground,
              borderColor: theme.colors.border,
            },
          ]}
        />
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: saveNotify }}
          onPress={() => setSaveNotify((current) => !current)}
          style={[styles.notifyRow, { borderColor: theme.colors.border }]}
        >
          <Ionicons
            name={saveNotify ? 'notifications' : 'notifications-off-outline'}
            size={18}
            color={saveNotify ? theme.colors.primaryDeep : theme.colors.textTertiary}
          />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Yeni ilan bildirimi</AppText>
            <AppText variant="caption" color="textTertiary">
              Yalnızca filtrelerine uyan yeni onaylı ilanlarda bildirim alırsın.
            </AppText>
          </View>
        </Pressable>
      </MapSheet>
    </>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
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

function LinkChip({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.linkChip,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={theme.colors.primaryDeep} />
      <AppText variant="caption" color="textSecondary" numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

function SectionHead({
  title,
  subtitle,
  onMore,
}: {
  title: string;
  subtitle: string;
  onMore?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.sectionHead}>
      <View style={styles.flex}>
        <AppText variant="h3" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
      {onMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title} tümünü gör`}
          onPress={onMore}
          style={({ pressed }) => [
            styles.moreChip,
            { backgroundColor: theme.colors.surfaceMuted, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <AppText variant="caption" color="textSecondary">
            Tümü
          </AppText>
          <Ionicons name="chevron-forward" size={12} color={theme.colors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Rail({
  title,
  subtitle,
  items,
  onMore,
  onOpen,
  onFavorite,
}: {
  title: string;
  subtitle: string;
  items: RealEstateListing[];
  onMore?: () => void;
  onOpen: (listing: RealEstateListing) => void;
  onFavorite: (listing: RealEstateListing) => void;
}) {
  return (
    <View style={styles.section}>
      <SectionHead title={title} subtitle={subtitle} onMore={onMore} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.hScroll}
        contentContainerStyle={styles.rail}
      >
        {items.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            width={252}
            onPress={() => onOpen(listing)}
            onToggleFavorite={() => onFavorite(listing)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function GridSkeleton({ cardWidth }: { cardWidth: number }) {
  return (
    <View style={styles.grid}>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={{ width: cardWidth }}>
          <Skeleton height={152} radius={16} />
          <Skeleton height={14} radius={7} style={styles.skeletonLine} />
          <Skeleton height={14} radius={7} width="60%" />
        </View>
      ))}
    </View>
  );
}

function EmptyDiscover({
  onCreate,
  onExploreMap,
}: {
  onCreate: () => void;
  onExploreMap: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.emptyCard,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name="home-outline" size={24} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="h3" align="center">
        Trabzon’da ilk ilanı sen ver
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        Şu anda yayında ilan yok. İlanını oluşturduğun an yayınlanır; adresin gizli kalır.
      </AppText>
      <View style={styles.emptyActions}>
        <Button label="İlan oluştur" onPress={onCreate} style={styles.flex} size="sm" />
        <Button
          label="Haritada keşfet"
          variant="outline"
          onPress={onExploreMap}
          style={styles.flex}
          size="sm"
        />
      </View>
      <View style={styles.trustRow}>
        <TrustItem icon="flash-outline" label="Anında yayın" />
        <TrustItem icon="eye-off-outline" label="Gizli konum" />
        <TrustItem icon="pricetag-outline" label="Ücretsiz ilan" />
      </View>
    </View>
  );
}

function TrustItem({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.trustItem}>
      <Ionicons name={icon} size={13} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

function MyListingBadge({ status, eids }: { status: string; eids?: string | null }) {
  const map: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> =
    {
      published: { label: 'Yayında', tone: 'success' },
      pending_verification: { label: 'Doğrulama', tone: 'warning' },
      pending_moderation: { label: 'Moderasyon', tone: 'warning' },
      draft: { label: 'Taslak', tone: 'neutral' },
      rejected: { label: 'Reddedildi', tone: 'danger' },
      expired: { label: 'Süresi doldu', tone: 'warning' },
      removed: { label: 'Kaldırıldı', tone: 'danger' },
    };
  const entry = map[status] ?? { label: status, tone: 'neutral' as const };
  if (eids === 'verified' && status === 'published') {
    return <Badge label="EİDS ✓" tone="success" />;
  }
  return <Badge label={entry.label} tone={entry.tone} />;
}

const styles = StyleSheet.create({
  page: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    gap: 12,
    paddingTop: 2,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, gap: 1 },
  round: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  countDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countDotText: { fontSize: 9, fontWeight: '700', lineHeight: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 13,
    paddingRight: 6,
  },
  searchInput: { flex: 1, paddingVertical: 0 },
  searchDivider: { width: StyleSheet.hairlineWidth, height: 22 },
  filterButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadge: {
    position: 'absolute',
    top: 1,
    right: 1,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { fontSize: 9, fontWeight: '700', lineHeight: 12 },
  segment: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderRadius: 13,
    width: '100%',
    maxWidth: 560,
  },
  segmentItem: {
    flex: 1,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  chipRow: { gap: 7, alignItems: 'center', paddingRight: 8 },
  hScroll: { flexGrow: 0, flexShrink: 0 },
  chip: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkRow: { flexDirection: 'row', gap: 8, width: '100%', maxWidth: 560 },
  linkChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
  },
  resultsHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 6 },
  clearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    height: 28,
    borderRadius: 14,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  adRow: { width: '100%' },
  section: { gap: 10, paddingTop: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  moreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
  },
  rail: { gap: GRID_GAP, paddingRight: 8 },
  myCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  myRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  ctaIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 26,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActions: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 4 },
  trustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 6,
  },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  skeletonLine: { marginTop: 8, width: '85%' },
  sheetLoading: { gap: 10 },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  savedEmpty: { alignItems: 'center', gap: 10, paddingVertical: 24, paddingHorizontal: 16 },
  sheetInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  notifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
});
