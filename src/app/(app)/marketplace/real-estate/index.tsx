import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Badge, Button, IconButton, TextField } from '@/components/ui';
import { MapSheet } from '@/features/map/components/MapSheet';
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
import {
  EMPTY_RE_FILTERS,
  RealEstateFilterSheet,
  type RealEstateFilters,
} from '@/features/real-estate/components/RealEstateFilterSheet';
import { ListingCard } from '@/features/real-estate/components/ListingCard';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

type QuickKey = 'rent-home' | 'sale-home' | 'rent-shop' | 'sale-shop' | 'transfer' | 'land' | null;

type QuickCategory = {
  key: Exclude<QuickKey, null>;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  kind: 'rent' | 'sale' | 'transfer';
  category: string | null;
  tone: string;
};

const QUICK_CATEGORIES: QuickCategory[] = [
  {
    key: 'rent-home',
    label: 'Kiralık Ev',
    icon: 'key-outline',
    kind: 'rent',
    category: null,
    tone: '#4169F5',
  },
  {
    key: 'sale-home',
    label: 'Satılık Ev',
    icon: 'home-outline',
    kind: 'sale',
    category: null,
    tone: '#8057F4',
  },
  {
    key: 'rent-shop',
    label: 'Kiralık Dükkân',
    icon: 'storefront-outline',
    kind: 'rent',
    category: 'kiralik-dukkan',
    tone: '#0EA5A4',
  },
  {
    key: 'sale-shop',
    label: 'Satılık Dükkân',
    icon: 'business-outline',
    kind: 'sale',
    category: 'satilik-dukkan',
    tone: '#F59E0B',
  },
  {
    key: 'transfer',
    label: 'Devren İşletme',
    icon: 'swap-horizontal-outline',
    kind: 'transfer',
    category: null,
    tone: '#EC4899',
  },
  {
    key: 'land',
    label: 'Arsa ve Arazi',
    icon: 'map-outline',
    kind: 'sale',
    category: 'satilik-arsa',
    tone: '#16A34A',
  },
];

function filtersFromQuick(quick: QuickCategory): RealEstateFilters {
  return {
    ...EMPTY_RE_FILTERS,
    listingKind: quick.kind,
    category: quick.category,
  };
}

export default function RealEstateHomeScreen() {
  const { theme, scheme } = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bootstrap = useExploreBootstrap();
  const districts = bootstrap.data?.districts ?? [];
  const categories = bootstrap.data?.real_estate_categories ?? [];

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [quick, setQuick] = useState<QuickKey>(null);
  const [filters, setFilters] = useState<RealEstateFilters>(EMPTY_RE_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [saveNotify, setSaveNotify] = useState(true);

  const newest = useRealEstateList({ sort: 'new', limit: 8 });
  const rent = useRealEstateList({ sort: 'new', listing_kind: 'rent', limit: 8 });
  const sale = useRealEstateList({ sort: 'new', listing_kind: 'sale', limit: 8 });
  const favorites = useRealEstateList({ sort: 'new', favorites: true, limit: 8 });
  const myListings = useMyListings();
  const savedSearches = useRealEstateSavedSearches();
  const saveSearch = useSaveRealEstateSearch();
  const deleteSearch = useDeleteRealEstateSavedSearch();
  const toggleNotify = useSetRealEstateSearchNotify();
  const favorite = useToggleListingFavorite();

  const activeQuick = QUICK_CATEGORIES.find((item) => item.key === quick) ?? null;
  const effectiveFilters = activeQuick ? filtersFromQuick(activeQuick) : filters;
  const isFiltering =
    Boolean(search.trim()) ||
    Boolean(activeQuick) ||
    filters.listingKind != null ||
    filters.category != null ||
    filters.districtId != null ||
    filters.neighborhoodId != null ||
    filters.minPrice != null ||
    filters.maxPrice != null ||
    filters.minM2 != null ||
    filters.maxM2 != null ||
    filters.rooms != null ||
    filters.maxBuildingAge != null ||
    filters.ownerType != null;

  const listParams = useMemo(() => {
    const params: Record<string, unknown> = {
      sort: effectiveFilters.sort,
      limit: 30,
    };
    if (effectiveFilters.listingKind) params.listing_kind = effectiveFilters.listingKind;
    if (effectiveFilters.category) params.category = effectiveFilters.category;
    if (effectiveFilters.districtId != null) params.district_id = effectiveFilters.districtId;
    if (effectiveFilters.neighborhoodId != null)
      params.neighborhood_id = effectiveFilters.neighborhoodId;
    if (effectiveFilters.minPrice != null) params.min_price = effectiveFilters.minPrice;
    if (effectiveFilters.maxPrice != null) params.max_price = effectiveFilters.maxPrice;
    if (effectiveFilters.minM2 != null) params.min_m2 = effectiveFilters.minM2;
    if (effectiveFilters.maxM2 != null) params.max_m2 = effectiveFilters.maxM2;
    if (effectiveFilters.rooms != null) params.rooms = effectiveFilters.rooms;
    if (effectiveFilters.maxBuildingAge != null)
      params.max_building_age = effectiveFilters.maxBuildingAge;
    if (effectiveFilters.ownerType) params.owner_type = effectiveFilters.ownerType;
    if (debounced.trim()) params.query = debounced.trim();
    return params;
  }, [debounced, effectiveFilters]);

  const results = useRealEstateList(listParams);

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

  const openMap = () => {
    const params = new URLSearchParams();
    params.set('mode', 're');
    const source = effectiveFilters;
    if (source.listingKind) params.set('kind', source.listingKind);
    if (source.category) params.set('category', source.category);
    if (source.districtId != null) params.set('districtId', String(source.districtId));
    if (source.neighborhoodId != null) params.set('neighborhoodId', String(source.neighborhoodId));
    if (source.minPrice != null) params.set('minPrice', String(source.minPrice));
    if (source.maxPrice != null) params.set('maxPrice', String(source.maxPrice));
    if (source.minM2 != null) params.set('minM2', String(source.minM2));
    if (source.rooms != null) params.set('rooms', String(source.rooms));
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
    if (effectiveFilters.listingKind) raw.listing_kind = effectiveFilters.listingKind;
    if (effectiveFilters.category) raw.category = effectiveFilters.category;
    if (effectiveFilters.districtId != null) raw.district_id = effectiveFilters.districtId;
    if (effectiveFilters.neighborhoodId != null)
      raw.neighborhood_id = effectiveFilters.neighborhoodId;
    if (effectiveFilters.minPrice != null) raw.min_price = effectiveFilters.minPrice;
    if (effectiveFilters.maxPrice != null) raw.max_price = effectiveFilters.maxPrice;
    if (effectiveFilters.minM2 != null) raw.min_m2 = effectiveFilters.minM2;
    if (effectiveFilters.maxM2 != null) raw.max_m2 = effectiveFilters.maxM2;
    if (effectiveFilters.rooms != null) raw.rooms = effectiveFilters.rooms;
    if (effectiveFilters.maxBuildingAge != null)
      raw.max_building_age = effectiveFilters.maxBuildingAge;
    if (effectiveFilters.ownerType) raw.owner_type = effectiveFilters.ownerType;
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

  const clearAll = () => {
    setQuick(null);
    setFilters(EMPTY_RE_FILTERS);
    setSearch('');
    setDebounced('');
  };

  const myActiveCount = myListings.data?.items.length ?? 0;
  const savedCount = savedSearches.data?.length ?? 0;
  const cardWidth = Math.max(150, (width - 40 - 10) / 2);
  const eidsEnabled = Boolean(bootstrap.data?.eids_enabled);

  const header = (
    <View>
      {/*
        Hero, durum çubuğunun (çentik) altına kadar uzanan tam genişlikte bir
        yüzey. İç boşluk `insets.top` ile verilir; böylece hiçbir kart çentiğin
        altına girmez, arka plan ise ekranın en üstüne kadar devam eder.
      */}
      <View style={styles.hero}>
        <LinearGradient
          colors={
            scheme === 'dark'
              ? ['#16264F', '#0C1426', '#1D1840']
              : ['#0B2A6F', '#1459E8', '#5B34D6']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroFill, { paddingTop: insets.top + 10 }]}
        >
          {/* Yumuşak ışık halkaları: düz gradyanı "cam" hissine yaklaştırır. */}
          <View pointerEvents="none" style={styles.glowLarge} />
          <View pointerEvents="none" style={styles.glowSmall} />

          <View style={styles.heroBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Geri"
              hitSlop={8}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                  return;
                }
                // Derin baglanti veya drawer ile dogrudan acildiysa yigin bos.
                router.replace('/marketplace' as never);
              }}
              style={({ pressed }) => [styles.glassIcon, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
            </Pressable>

            <View style={styles.flex}>
              <AppText variant="overline" color="rgba(255,255,255,0.66)">
                TRABZONE
              </AppText>
              <AppText variant="h1" color="#FFFFFF" numberOfLines={1}>
                Emlak
              </AppText>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="İlanlarım"
              hitSlop={6}
              onPress={() => navigate('/marketplace/real-estate/my-listings')}
              style={({ pressed }) => [styles.glassIcon, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Ionicons name="albums-outline" size={19} color="#FFFFFF" />
              {myActiveCount > 0 ? (
                <Badge label={String(myActiveCount)} tone="accent" style={styles.heroBadge} />
              ) : null}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filtreler"
              hitSlop={6}
              onPress={() => setFilterOpen(true)}
              style={({ pressed }) => [styles.glassIcon, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Ionicons name="options-outline" size={19} color="#FFFFFF" />
            </Pressable>
          </View>

          <AppText variant="body" color="rgba(255,255,255,0.82)" numberOfLines={1}>
            Trabzon’da aradığın yeri keşfet.
          </AppText>

          <View style={styles.heroPills}>
            <View style={styles.verifiedPill}>
              <Ionicons name="shield-checkmark" size={12} color="#A7F3D0" />
              <AppText variant="caption" color="rgba(255,255,255,0.88)" numberOfLines={1}>
                Doğrulanmış ilanlar
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Haritada keşfet"
              onPress={openMap}
              style={({ pressed }) => [styles.mapPill, { opacity: pressed ? 0.75 : 1 }]}
            >
              <Ionicons name="map-outline" size={13} color="#FFFFFF" />
              <AppText variant="caption" color="#FFFFFF">
                Haritada keşfet
              </AppText>
            </Pressable>
          </View>
        </LinearGradient>
      </View>

      {/* Arama alanı hero'nun alt kenarına taşar: katmanlı, modern görünüm. */}
      <View style={styles.searchWrap}>
        <View
          style={[
            styles.searchBox,
            theme.shadows.card,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="search-outline" size={19} color={theme.colors.textTertiary} />
          <TextField
            value={search}
            onChangeText={updateSearch}
            placeholder="Ev, dükkân, arsa veya mahalle ara…"
            returnKeyType="search"
            onSubmitEditing={() => setDebounced(search)}
            containerStyle={styles.searchField}
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
        </View>
      </View>

      <View style={styles.headerBody}>
        {!eidsEnabled ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warning },
            ]}
          >
            <Ionicons name="information-circle-outline" size={17} color={theme.colors.warning} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              EİDS entegrasyonu henüz etkin değil. Yeni ilanlar taslak/doğrulama bekleme durumunda
              kalır ve yayınlanmaz. Yasal doğrulama atlanmaz.
            </AppText>
          </View>
        ) : null}

        <View style={styles.quickGrid}>
          {QUICK_CATEGORIES.map((item) => {
            const active = quick === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptics.tap();
                  setQuick(active ? null : item.key);
                  setFilters(EMPTY_RE_FILTERS);
                }}
                style={[
                  styles.quickCard,
                  {
                    backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                    borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                  },
                  !active ? theme.shadows.xs : null,
                ]}
              >
                <View
                  style={[
                    styles.quickIcon,
                    { backgroundColor: active ? 'rgba(255,255,255,0.16)' : `${item.tone}18` },
                  ]}
                >
                  <Ionicons name={item.icon} size={18} color={active ? '#FFFFFF' : item.tone} />
                </View>
                <AppText
                  variant="caption"
                  color={active ? 'onPrimary' : 'text'}
                  numberOfLines={2}
                  style={styles.quickLabel}
                >
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.shortcuts}>
          <Shortcut
            icon="map-outline"
            label="Haritada Keşfet"
            hint="Alan çiz, fiyatları gör"
            onPress={openMap}
            tone={theme.colors.primaryDeep}
          />
          <Shortcut
            icon="bookmark-outline"
            label="Kaydedilen Aramalar"
            hint={savedCount > 0 ? `${savedCount} kayıtlı arama` : 'Henüz arama yok'}
            onPress={() => setSavedOpen(true)}
            tone={theme.colors.accent}
          />
        </View>

        {isFiltering ? (
          <View style={styles.resultsHead}>
            <View style={styles.flex}>
              <AppText variant="h3">{activeQuick ? activeQuick.label : 'Arama sonuçları'}</AppText>
              <AppText variant="caption" color="textTertiary">
                {results.isFetching ? 'Güncelleniyor…' : `${results.data?.total ?? 0} ilan`}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Haritada göster"
              onPress={openMap}
              style={[styles.smallAction, { backgroundColor: theme.colors.primarySoft }]}
            >
              <Ionicons name="map-outline" size={14} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep">
                Harita
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Bu aramayı kaydet"
              onPress={() => {
                setSaveLabel(activeQuick?.label ?? 'Emlak aramam');
                setSaveOpen(true);
              }}
              style={[styles.smallAction, { backgroundColor: theme.colors.surfaceMuted }]}
            >
              <Ionicons name="bookmark-outline" size={14} color={theme.colors.textSecondary} />
              <AppText variant="caption" color="textSecondary">
                Kaydet
              </AppText>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      {/* Hero koyu bir yüzey olduğu için durum çubuğu ikonları her temada açık. */}
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={newest.isRefetching && !results.isRefetching}
            progressViewOffset={insets.top + 12}
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
        {header}

        {isFiltering ? (
          results.isLoading ? (
            <LoadingBlock label="İlanlar yükleniyor…" />
          ) : results.data && results.data.items.length > 0 ? (
            <View style={styles.grid}>
              {results.data.items.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  width={cardWidth}
                  onPress={() => openListing(listing)}
                  onToggleFavorite={() => toggleFavorite(listing)}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="search-outline"
              title="Uygun ilan bulunamadı"
              body="Filtreleri gevşetmeyi veya haritada alan çizmeyi dene."
              actionLabel="Filtreleri temizle"
              onAction={clearAll}
            />
          )
        ) : (
          <>
            <Section
              title="Yeni İlanlar"
              subtitle="Son yayınlanan doğrulanmış kayıtlar"
              data={newest.data?.items ?? []}
              loading={newest.isLoading}
              onSeeAll={() => navigate('/explore?mode=re')}
              onOpen={openListing}
              onFavorite={toggleFavorite}
            />
            <Section
              title="Kiralık Konutlar"
              subtitle="Aylık kiralık daire, villa ve müstakil evler"
              data={rent.data?.items ?? []}
              loading={rent.isLoading}
              onSeeAll={() => navigate('/explore?mode=re&kind=rent')}
              onOpen={openListing}
              onFavorite={toggleFavorite}
            />
            <Section
              title="Satılık ve Ticari"
              subtitle="Satılık konut, işyeri ve arsa ilanları"
              data={sale.data?.items ?? []}
              loading={sale.isLoading}
              onSeeAll={() => navigate('/explore?mode=re&kind=sale')}
              onOpen={openListing}
              onFavorite={toggleFavorite}
            />
            <Section
              title="Favorilerim"
              subtitle="Kaydettiğin emlak ilanları"
              data={favorites.data?.items ?? []}
              loading={favorites.isLoading}
              showSeeAll={false}
              onSeeAll={() => undefined}
              onOpen={openListing}
              onFavorite={toggleFavorite}
              emptyLabel="Henüz favori ilan yok. Kartlardaki kalbe dokunarak kaydet."
            />

            {myListings.data && myListings.data.items.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <View style={styles.flex}>
                    <AppText variant="h3">İlanlarım</AppText>
                    <AppText variant="caption" color="textTertiary">
                      Taslak, doğrulama ve yayın durumlarını yönet
                    </AppText>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Tüm ilanlarım"
                    onPress={() => navigate('/marketplace/real-estate/my-listings')}
                  >
                    <AppText variant="caption" color="primaryDeep">
                      Tümü
                    </AppText>
                  </Pressable>
                </View>
                <View style={styles.myList}>
                  {myListings.data.items.slice(0, 3).map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={item.title}
                      onPress={() => navigate(`/marketplace/real-estate/${item.id}`)}
                      style={[styles.myRow, { borderColor: theme.colors.border }]}
                    >
                      <View style={styles.flex}>
                        <AppText variant="bodyStrong" numberOfLines={1}>
                          {item.title}
                        </AppText>
                        <AppText variant="caption" color="textTertiary">
                          {formatMoney(item.price_cents, item.currency)} · {item.category_name}
                        </AppText>
                      </View>
                      <StatusBadge status={item.status} eids={item.eids_status} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}

        <LinearGradient
          colors={['#101B3B', '#1C2D63', '#422A7D']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[theme.shadows.card, styles.cta]}
        >
          <View style={styles.ctaIcon}>
            <Ionicons name="add-circle-outline" size={22} color="#FFFFFF" />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong" color="#FFFFFF">
              İlanın var mı?
            </AppText>
            <AppText variant="caption" color="rgba(255,255,255,0.78)">
              EİDS doğrulamasıyla güvenli biçimde yayınla.
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yeni ilan oluştur"
            onPress={() => navigate('/marketplace/real-estate/create')}
            style={styles.ctaButton}
          >
            <AppText variant="caption" color="#0B1220" style={styles.ctaButtonText}>
              İlan ver
            </AppText>
          </Pressable>
        </LinearGradient>
      </ScrollView>

      <RealEstateFilterSheet
        visible={filterOpen}
        filters={filters}
        districts={districts}
        categories={categories}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setQuick(null);
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
          <LoadingBlock label="Aramalar yükleniyor…" />
        ) : savedSearches.data && savedSearches.data.length > 0 ? (
          savedSearches.data.map((item) => (
            <View key={item.id} style={[styles.savedRow, { borderColor: theme.colors.border }]}>
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
              <IconButton
                name={item.notify_enabled ? 'notifications' : 'notifications-off-outline'}
                accessibilityLabel={item.notify_enabled ? 'Bildirimi kapat' : 'Bildirimi aç'}
                size={17}
                onPress={() =>
                  toggleNotify.mutate(
                    { id: item.id, notify: !item.notify_enabled },
                    { onError: (error) => Alert.alert('Güncellenemedi', error.message) },
                  )
                }
              />
              <IconButton
                name="trash-outline"
                accessibilityLabel="Aramayı sil"
                size={17}
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
              />
            </View>
          ))
        ) : (
          <View style={styles.savedEmpty}>
            <Ionicons name="bookmark-outline" size={30} color={theme.colors.textTertiary} />
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
        <TextField
          label="Arama adı"
          value={saveLabel}
          onChangeText={setSaveLabel}
          placeholder="Örn. Ortahisar kiralık daire"
          maxLength={80}
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
    </View>
  );
}

function Shortcut({
  icon,
  label,
  hint,
  onPress,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  onPress: () => void;
  tone: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.shortcut,
        theme.shadows.xs,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.shortcutIcon, { backgroundColor: `${tone}18` }]}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" numberOfLines={1}>
          {label}
        </AppText>
        <AppText
          variant="caption"
          color="textTertiary"
          numberOfLines={1}
          style={styles.shortcutHint}
        >
          {hint}
        </AppText>
      </View>
    </Pressable>
  );
}

function Section({
  title,
  subtitle,
  data,
  loading,
  emptyLabel = 'Bu bölümde henüz yayınlanmış ilan yok.',
  showSeeAll = true,
  onSeeAll,
  onOpen,
  onFavorite,
}: {
  title: string;
  subtitle: string;
  data: RealEstateListing[];
  loading: boolean;
  emptyLabel?: string;
  showSeeAll?: boolean;
  onSeeAll: () => void;
  onOpen: (listing: RealEstateListing) => void;
  onFavorite: (listing: RealEstateListing) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.flex}>
          <AppText variant="h3">{title}</AppText>
          <AppText variant="caption" color="textTertiary">
            {subtitle}
          </AppText>
        </View>
        {showSeeAll && data.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title} tümünü gör`}
            onPress={onSeeAll}
          >
            <AppText variant="caption" color="primaryDeep">
              Tümü
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {loading ? (
        <LoadingBlock label="İlanlar yükleniyor…" />
      ) : data.length === 0 ? (
        <View style={[styles.sectionEmpty, { backgroundColor: theme.colors.surfaceMuted }]}>
          <AppText variant="caption" color="textTertiary" align="center">
            {emptyLabel}
          </AppText>
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontal}
        >
          {data.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              width={270}
              onPress={() => onOpen(listing)}
              onToggleFavorite={() => onFavorite(listing)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export function StatusBadge({ status, eids }: { status: string; eids: string }) {
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

function LoadingBlock({ label }: { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.loading, { backgroundColor: theme.colors.surfaceMuted }]}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={26} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="h3" align="center">
        {title}
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        {body}
      </AppText>
      <Button
        label={actionLabel}
        variant="secondary"
        onPress={onAction}
        style={styles.emptyButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Hero tüm genişliği kaplar ve durum çubuğunun altına kadar uzar; köşeleri
  // yalnızca altta yuvarlatılır ki üstte "kesik" bir yüzey gibi görünmesin.
  hero: {
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    overflow: 'hidden',
  },
  heroFill: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 12,
  },
  glowLarge: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    top: -110,
    right: -70,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  glowSmall: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    bottom: -40,
    left: -50,
    backgroundColor: 'rgba(167,139,250,0.28)',
  },
  heroBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 2 },
  glassIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  heroBadge: { position: 'absolute', top: -5, right: -5, paddingHorizontal: 6, paddingVertical: 1 },
  heroPills: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 },
  verifiedPill: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  mapPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  // Arama kutusu hero'nun 28px üstüne biner: kart kenarı çentikten uzak kalır.
  searchWrap: { paddingHorizontal: 20, marginTop: -26 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 2,
    minHeight: 54,
  },
  searchField: { flex: 1 },
  headerBody: { paddingHorizontal: 20, paddingTop: 42, gap: 14 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  quickCard: {
    width: '31.5%',
    minHeight: 92,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 8,
    justifyContent: 'space-between',
  },
  quickIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { minHeight: 28 },
  shortcuts: { flexDirection: 'row', gap: 9 },
  shortcut: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  shortcutIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutHint: { fontSize: 10 },
  resultsHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 },
  smallAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    height: 30,
    borderRadius: 15,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, paddingTop: 12 },
  section: { paddingTop: 20, gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 20 },
  horizontal: { gap: 10, paddingHorizontal: 20, paddingBottom: 2 },
  sectionEmpty: { marginHorizontal: 20, padding: 16, borderRadius: 14 },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  savedEmpty: { alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 20 },
  notifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  myList: { paddingHorizontal: 20, gap: 7 },
  myRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 24,
    padding: 15,
    borderRadius: 20,
  },
  ctaIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  ctaButton: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  ctaButtonText: { fontFamily: undefined, fontWeight: '700' },
  loading: { marginHorizontal: 20, padding: 18, borderRadius: 14, alignItems: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 30 },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyButton: { maxWidth: 240, marginTop: 4 },
  flex: { flex: 1 },
});
