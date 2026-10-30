import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppImage, AppText, Screen, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import {
  Chip,
  EmptyState,
  InlineError,
  LoadingBlock,
} from '@/features/accommodation/components/AccommodationUI';
import {
  AURORA,
  AuroraBackdrop,
  GlassPill,
  SectionTitle,
  ShowcaseCard,
  ShowcaseRail,
} from '@/features/accommodation/components/PremiumUI';
import { PropertyCard, PropertyCardSkeleton } from '@/features/accommodation/components/PropertyCard';
import {
  DEFAULT_SEARCH_STATE,
  PublicFilterSheet,
  type PublicSearchState,
} from '@/features/accommodation/components/PublicFilterSheet';
import {
  useAccommodationContext,
  usePropertySearch,
  usePublicFilters,
} from '@/features/accommodation/hooks/use-accommodation';
import { useAccommodationLayout } from '@/features/accommodation/hooks/use-accommodation-layout';
import { accommodationMediaUrl } from '@/features/accommodation/services/accommodation-media-service';
import type { PropertyType } from '@/features/accommodation/types';
import {
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_OPTIONS,
  formatDate,
  formatNumber,
} from '@/features/accommodation/utils/format';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const CATEGORY_ICONS: Record<PropertyType, IconName> = {
  hotel: 'business',
  bungalow: 'home',
  apartment: 'grid',
  pension: 'bed',
  villa: 'leaf',
};

const SORT_LABELS: Record<PublicSearchState['sort'], string> = {
  recommended: 'Önerilen',
  rating: 'Puana göre',
  price_asc: 'Fiyat artan',
  price_desc: 'Fiyat azalan',
  new: 'Yeni eklenen',
};

export default function KonaklamaHubScreen() {
  const { theme, scheme } = useTheme();
  const router = useRouter();
  const layout = useAccommodationLayout();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<PublicSearchState>(DEFAULT_SEARCH_STATE);

  const context = useAccommodationContext();
  const publicFilters = usePublicFilters();

  const params = useMemo(
    () => ({
      propertyType: filters.propertyType,
      districtId: filters.districtId,
      guests: filters.guests,
      checkIn: filters.checkIn,
      checkOut: filters.checkOut,
      minPrice: filters.minPrice ? Number(filters.minPrice) : null,
      maxPrice: filters.maxPrice ? Number(filters.maxPrice) : null,
      query: query || null,
      sort: filters.sort,
      deals: filters.deals,
      limit: 40,
      offset: 0,
    }),
    [filters, query],
  );

  const results = usePropertySearch(params);
  const properties = useMemo(() => results.data?.items ?? [], [results.data?.items]);
  const ownedProperties = context.data?.items ?? [];
  const pendingReservations = ownedProperties.reduce((total, item) => total + item.pending_reservations, 0);
  const pendingTasks = ownedProperties.reduce((total, item) => total + item.pending_tasks, 0);

  const hasFilters =
    Boolean(
      filters.propertyType ||
        filters.districtId ||
        filters.checkIn ||
        filters.minPrice ||
        filters.maxPrice ||
        filters.deals ||
        filters.sort !== 'recommended',
    ) || Boolean(query);

  const featured = useMemo(() => {
    if (query || filters.propertyType || filters.deals) return [];
    return [...properties]
      .filter((property) => property.rating_count > 0)
      .sort((a, b) => b.rating_avg - a.rating_avg)
      .slice(0, 8);
  }, [properties, query, filters.propertyType, filters.deals]);

  const deals = useMemo(() => properties.filter((property) => property.has_deal).slice(0, 8), [properties]);

  const heroImages = useMemo(
    () =>
      properties
        .map((property) => ({
          id: property.id,
          uri: accommodationMediaUrl(property.cover_path),
          name: property.name,
        }))
        .filter((item): item is { id: string; uri: string; name: string } => Boolean(item.uri))
        .slice(0, 3),
    [properties],
  );

  const districts = publicFilters.data?.districts ?? [];
  const selectedDistrict = districts.find((district) => district.id === filters.districtId) ?? null;
  const horizontalPadding = layout.isDesktop ? 28 : theme.layout.screenPadding;

  const resetFilters = () => {
    setFilters(DEFAULT_SEARCH_STATE);
    setSearch('');
    setQuery('');
  };

  return (
    <Screen
      scroll
      edges={['top', 'left', 'right']}
      padded={false}
      refreshControl={
        <RefreshControl
          refreshing={results.isRefetching && !results.isLoading}
          onRefresh={() => void results.refetch()}
          tintColor={theme.colors.primary}
        />
      }
    >
      <AuroraBackdrop style={styles.hero} colors={[AURORA.night, '#101A33', AURORA.violet]}>
        <View style={[styles.heroInner, { paddingHorizontal: horizontalPadding }]}>
          <View style={styles.heroTop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Geri"
              hitSlop={10}
              onPress={() => router.back()}
              style={styles.heroIcon}
            >
              <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
            </Pressable>
            <View style={styles.heroBrand}>
              <AppText variant="overline" style={styles.brandOverline}>
                TRABZONE KONAKLAMA
              </AppText>
              <AppText variant="caption" style={styles.brandSub}>
                Trabzon · Karadeniz
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Haritada otelleri gör"
              onPress={() => router.push('/konaklama/harita' as never)}
              style={styles.heroIcon}
            >
              <Ionicons name="map-outline" size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={[styles.heroGrid, layout.isDesktop ? styles.heroGridDesktop : null]}>
            <View style={styles.heroCopy}>
              <View style={styles.heroPillRow}>
                <GlassPill icon="shield-checkmark" label="Doğrulanmış tesisler" />
                <GlassPill icon="flash" label="Anında rezervasyon" />
              </View>
              <AppText variant="display" style={[styles.heroTitle, layout.isDesktop ? styles.heroTitleDesktop : null]}>
                Trabzon’da kalacağın yer,{'\n'}bir deneyim olsun.
              </AppText>
              <AppText variant="body" style={styles.heroSubtitle}>
                Otel, bungalov, apart, pansiyon ve villaları karşılaştır; gecelik fiyatları gör, uygun odayı anında ayır.
              </AppText>

              <View style={styles.heroStats}>
                <HeroStat value={formatNumber(results.data?.total ?? 0)} label="yayında tesis" />
                <View style={styles.heroStatDivider} />
                <HeroStat value={`${districts.length}`} label="bölge" />
                <View style={styles.heroStatDivider} />
                <HeroStat value="%0" label="gizli ücret" />
              </View>
            </View>

            {layout.isDesktop ? (
              <View style={styles.heroCollage}>
                {heroImages.length > 0 ? (
                  heroImages.map((image, index) => (
                    <View
                      key={image.id}
                      style={[
                        styles.collageItem,
                        index === 0 ? styles.collagePrimary : styles.collageSecondary,
                        index === 2 ? styles.collageHidden : null,
                      ]}
                    >
                      <AppImage source={{ uri: image.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <LinearGradient
                        colors={['transparent', 'rgba(4,8,18,0.7)']}
                        style={StyleSheet.absoluteFill}
                        pointerEvents="none"
                      />
                      <AppText variant="caption" numberOfLines={1} style={styles.collageLabel}>
                        {image.name}
                      </AppText>
                    </View>
                  ))
                ) : (
                  <View style={[styles.collageItem, styles.collagePrimary, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
                    <Ionicons name="business-outline" size={38} color="rgba(255,255,255,0.45)" />
                  </View>
                )}
                <View style={styles.collageFrame} pointerEvents="none" />
              </View>
            ) : null}
          </View>

          <View
            style={[
              styles.searchCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.xl,
                shadowColor: scheme === 'dark' ? '#000000' : '#0B1B45',
              },
              theme.shadows.floating,
            ]}
          >
            <View style={[styles.searchRow, layout.isDesktop ? styles.searchRowDesktop : null]}>
              <View style={styles.searchField}>
                <TextField
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Tesis, bölge veya mahalle ara"
                  leftIcon="search-outline"
                  returnKeyType="search"
                  onSubmitEditing={() => setQuery(search.trim())}
                  rightSlot={
                    search ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Aramayı temizle"
                        onPress={() => {
                          setSearch('');
                          setQuery('');
                        }}
                      >
                        <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
                      </Pressable>
                    ) : null
                  }
                />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tarih seç"
                onPress={() => setFilterOpen(true)}
                style={[styles.searchCell, { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border }]}
              >
                <Ionicons name="calendar-outline" size={16} color={theme.colors.primaryDeep} />
                <View style={styles.flex}>
                  <AppText variant="caption" color="textTertiary" style={styles.searchLabel}>
                    Giriş – Çıkış
                  </AppText>
                  <AppText variant="caption" color="text" numberOfLines={1}>
                    {filters.checkIn
                      ? `${formatDate(filters.checkIn)} → ${filters.checkOut ? formatDate(filters.checkOut) : '—'}`
                      : 'Tarih ekle'}
                  </AppText>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Misafir sayısı ve filtreler"
                onPress={() => setFilterOpen(true)}
                style={[styles.searchCell, { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border }]}
              >
                <Ionicons name="people-outline" size={16} color={theme.colors.primaryDeep} />
                <View style={styles.flex}>
                  <AppText variant="caption" color="textTertiary" style={styles.searchLabel}>
                    Misafir
                  </AppText>
                  <AppText variant="caption" color="text">
                    {filters.guests} kişi
                  </AppText>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filtreleri aç"
                onPress={() => setFilterOpen(true)}
                style={({ pressed }) => [
                  styles.searchButton,
                  { backgroundColor: theme.colors.primaryDeep, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Ionicons name="options-outline" size={17} color="#FFFFFF" />
                <AppText variant="caption" style={styles.searchButtonText}>
                  Filtrele
                </AppText>
              </Pressable>
            </View>

            {selectedDistrict || filters.propertyType ? (
              <View style={styles.activeFilterRow}>
                {filters.propertyType ? (
                  <GlassPillActive
                    label={PROPERTY_TYPE_LABELS[filters.propertyType as PropertyType]}
                    onRemove={() => setFilters((current) => ({ ...current, propertyType: null }))}
                  />
                ) : null}
                {selectedDistrict ? (
                  <GlassPillActive
                    label={selectedDistrict.name}
                    onRemove={() => setFilters((current) => ({ ...current, districtId: null }))}
                  />
                ) : null}
                {filters.checkIn ? (
                  <GlassPillActive
                    label={`${formatDate(filters.checkIn)} → ${filters.checkOut ? formatDate(filters.checkOut) : '—'}`}
                    onRemove={() => setFilters((current) => ({ ...current, checkIn: null, checkOut: null }))}
                  />
                ) : null}
                <Pressable accessibilityRole="button" accessibilityLabel="Tüm filtreleri temizle" onPress={resetFilters}>
                  <AppText variant="caption" color="danger" style={styles.clearAll}>
                    Temizle
                  </AppText>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </AuroraBackdrop>

      <View style={[styles.body, { paddingHorizontal: horizontalPadding }]}>
        <View style={styles.quickRow}>
          <QuickAction
            icon="calendar-outline"
            label="Rezervasyonlarım"
            hint="Yaklaşan konaklamalar"
            onPress={() => router.push('/konaklama/rezervasyonlarim' as never)}
          />
          <QuickAction
            icon="add-circle-outline"
            label={ownedProperties.length > 0 ? 'Yeni tesis' : 'Otelimi ekle'}
            hint="Ücretsiz başvuru"
            onPress={() => router.push('/konaklama/otel-ekle' as never)}
          />
          <QuickAction
            icon="briefcase-outline"
            label="Otel yönetimim"
            hint="Panel ve takvim"
            badge={pendingReservations}
            onPress={() =>
              router.push((ownedProperties.length > 0 ? '/konaklama/yonetim' : '/konaklama/otel-ekle') as never)
            }
          />
          <QuickAction
            icon="map-outline"
            label="Haritada gör"
            hint="Konuma göre keşfet"
            onPress={() => router.push('/konaklama/harita' as never)}
          />
        </View>

        {ownedProperties.length > 0 ? (
          <AuroraBackdrop
            rounded
            colors={[AURORA.indigo, '#1D2450', '#3A2E78']}
            style={styles.ownerCard}
          >
            <View style={styles.ownerHead}>
              <View style={styles.ownerIcon}>
                <Ionicons name="briefcase" size={18} color="#FFFFFF" />
              </View>
              <View style={styles.flex}>
                <AppText variant="overline" style={styles.ownerOverline}>
                  İŞLETME PANELİ
                </AppText>
                <AppText variant="title" style={styles.ownerTitle}>
                  {ownedProperties.length} tesisini yönetiyorsun
                </AppText>
                <AppText variant="caption" style={styles.ownerSub}>
                  {pendingReservations} onay bekleyen rezervasyon · {pendingTasks} açık görev
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Yönetim paneline git"
                onPress={() => router.push('/konaklama/yonetim' as never)}
                style={({ pressed }) => [styles.ownerCta, { opacity: pressed ? 0.8 : 1 }]}
              >
                <AppText variant="caption" style={styles.ownerCtaText}>
                  Panele git
                </AppText>
                <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
              </Pressable>
            </View>
            <View style={styles.ownerStats}>
              <OwnerStat label="Onay bekleyen" value={pendingReservations} tone="#FBBF24" />
              <OwnerStat label="Okunmamış mesaj" value={ownedProperties.reduce((total, item) => total + item.unread_messages, 0)} tone="#6284FF" />
              <OwnerStat label="Açık görev" value={pendingTasks} tone="#A78BFA" />
            </View>
          </AuroraBackdrop>
        ) : null}

        <View style={styles.categoryWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail}>
            <CategoryTile
              icon="apps"
              label="Tümü"
              active={!filters.propertyType}
              onPress={() => setFilters((current) => ({ ...current, propertyType: null }))}
            />
            {PROPERTY_TYPE_OPTIONS.map((type) => (
              <CategoryTile
                key={type.value}
                icon={CATEGORY_ICONS[type.value]}
                label={type.label}
                active={filters.propertyType === type.value}
                onPress={() =>
                  setFilters((current) => ({
                    ...current,
                    propertyType: current.propertyType === type.value ? null : type.value,
                  }))
                }
              />
            ))}
          </ScrollView>
        </View>

        {featured.length >= 3 ? (
          <View style={styles.section}>
            <SectionTitle
              overline="MİSAFİR PUANLARI"
              title="Öne çıkan tesisler"
              subtitle="Trabzone misafirlerinin en yüksek puan verdiği konaklamalar"
              icon="sparkles"
              actionLabel="Tümünü gör"
              onAction={() => setFilters((current) => ({ ...current, sort: 'rating' }))}
            />
            <ShowcaseRail paddingHorizontal={0}>
              {featured.map((property) => (
                <ShowcaseCard
                  key={property.id}
                  property={property}
                  onPress={() => router.push(`/konaklama/${property.id}` as never)}
                />
              ))}
            </ShowcaseRail>
          </View>
        ) : null}

        {deals.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle
              overline="KAMPANYALAR"
              title="Güncel fırsatlar"
              subtitle="Tesislerin kendi yayınladığı indirimli konaklamalar"
              icon="pricetag"
              actionLabel={filters.deals ? 'Fırsatları kapat' : 'Sadece fırsatlar'}
              onAction={() => setFilters((current) => ({ ...current, deals: !current.deals }))}
            />
            <ShowcaseRail paddingHorizontal={0}>
              {deals.map((property) => (
                <ShowcaseCard
                  key={property.id}
                  property={property}
                  onPress={() => router.push(`/konaklama/${property.id}` as never)}
                />
              ))}
            </ShowcaseRail>
          </View>
        ) : null}

        <View style={styles.resultsHead}>
          <View style={styles.flex}>
            <AppText variant="h3">
              {results.isLoading ? 'Tesisler yükleniyor' : `${formatNumber(results.data?.total ?? 0)} tesis`}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {filters.checkIn && filters.checkOut
                ? 'Seçilen tarihlerde müsait tesisler'
                : selectedDistrict
                  ? `${selectedDistrict.name} bölgesindeki tesisler`
                  : 'Trabzon genelinde yayınlanan doğrulanmış tesisler'}
            </AppText>
          </View>
          <View style={styles.resultActions}>
            <Chip
              label={SORT_LABELS[filters.sort]}
              icon="swap-vertical-outline"
              onPress={() => setFilterOpen(true)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filtreleri aç"
              onPress={() => setFilterOpen(true)}
              style={[
                styles.filterButton,
                {
                  backgroundColor: hasFilters ? theme.colors.primaryDeep : theme.colors.surface,
                  borderColor: hasFilters ? theme.colors.primaryDeep : theme.colors.border,
                },
              ]}
            >
              <Ionicons name="options-outline" size={15} color={hasFilters ? '#FFFFFF' : theme.colors.text} />
              <AppText variant="caption" color={hasFilters ? '#FFFFFF' : 'textSecondary'}>
                {hasFilters ? 'Filtreli' : 'Filtrele'}
              </AppText>
            </Pressable>
          </View>
        </View>

        {results.isLoading ? (
          <View style={styles.grid}>
            {[0, 1, 2, 3].map((key) => (
              <View key={key} style={[styles.gridItem, gridItemWidth(layout.columns)]}>
                <PropertyCardSkeleton />
              </View>
            ))}
          </View>
        ) : results.isError ? (
          <InlineError
            message={results.error instanceof Error ? results.error.message : 'Tesisler yüklenemedi.'}
            onRetry={() => void results.refetch()}
          />
        ) : properties.length === 0 ? (
          <EmptyState
            icon="bed-outline"
            title="Sonuç bulunamadı"
            message="Filtreleri değiştirerek veya tarihleri kaldırarak tekrar dene."
            actionLabel={hasFilters ? 'Filtreleri temizle' : undefined}
            onAction={hasFilters ? resetFilters : undefined}
          />
        ) : (
          <View style={styles.grid}>
            {properties.map((property) => (
              <View key={property.id} style={[styles.gridItem, gridItemWidth(layout.columns)]}>
                <PropertyCard
                  property={property}
                  onPress={() => router.push(`/konaklama/${property.id}` as never)}
                />
              </View>
            ))}
          </View>
        )}

        {results.isFetching && !results.isLoading ? <LoadingBlock label="Güncelleniyor…" height={54} /> : null}

        <View style={[styles.footNote, { borderTopColor: theme.colors.divider }]}>
          <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={styles.flex}>
            Trabzone Konaklama’da yalnızca doğrulanmış tesisler listelenir. Ödemeyi tesiste yaparsın; rezervasyon
            koşulları ve iptal politikası her tesis için ayrıca gösterilir.
          </AppText>
        </View>
      </View>

      <PublicFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={publicFilters.data}
        value={filters}
        onApply={setFilters}
      />
    </Screen>
  );
}

function gridItemWidth(columns: number) {
  if (columns >= 4) return { width: '24%' as const };
  if (columns === 3) return { width: '32.3%' as const };
  if (columns === 2) return { width: '48.8%' as const };
  return { width: '100%' as const };
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.heroStat}>
      <AppText variant="h3" style={styles.heroStatValue}>
        {value}
      </AppText>
      <AppText variant="caption" style={styles.heroStatLabel}>
        {label}
      </AppText>
    </View>
  );
}

function OwnerStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.ownerStat}>
      <View style={[styles.ownerStatDot, { backgroundColor: tone }]} />
      <View style={styles.flex}>
        <AppText variant="bodyStrong" style={styles.ownerStatValue}>
          {value}
        </AppText>
        <AppText variant="caption" style={styles.ownerStatLabel} numberOfLines={1}>
          {label}
        </AppText>
      </View>
    </View>
  );
}

function GlassPillActive({ label, onRemove }: { label: string; onRemove: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} filtresini kaldır`}
      onPress={onRemove}
      style={[styles.activePill, { backgroundColor: theme.colors.primarySoft }]}
    >
      <AppText variant="caption" color="primaryDeep" style={styles.activePillText}>
        {label}
      </AppText>
      <Ionicons name="close" size={12} color={theme.colors.primaryDeep} />
    </Pressable>
  );
}

function QuickAction({
  icon,
  label,
  hint,
  onPress,
  badge = 0,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress: () => void;
  badge?: number;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${hint}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickAction,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.86 : 1,
        },
      ]}
    >
      <View style={[styles.quickIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={17} color={theme.colors.primaryDeep} />
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" color="text" numberOfLines={1} style={styles.quickLabel}>
          {label}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.quickHint}>
          {hint}
        </AppText>
      </View>
      {badge > 0 ? (
        <View style={[styles.quickBadge, { backgroundColor: theme.colors.danger }]}>
          <AppText variant="caption" style={styles.quickBadgeText}>
            {badge > 9 ? '9+' : badge}
          </AppText>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={13} color={theme.colors.textTertiary} />
      )}
    </Pressable>
  );
}

function CategoryTile({
  icon,
  label,
  active,
  onPress,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.categoryTile, { opacity: pressed ? 0.82 : 1 }]}
    >
      {active ? (
        <LinearGradient
          colors={[theme.colors.primary, theme.colors.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.categoryIcon, styles.categoryIconActive]}
        >
          <Ionicons name={icon} size={19} color="#FFFFFF" />
        </LinearGradient>
      ) : (
        <View style={[styles.categoryIcon, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
          <Ionicons name={icon} size={19} color={theme.colors.textSecondary} />
        </View>
      )}
      <AppText
        variant="caption"
        color={active ? 'primaryDeep' : 'textSecondary'}
        style={styles.categoryLabel}
        numberOfLines={1}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  hero: { paddingBottom: 18 },
  heroInner: { width: '100%', maxWidth: 1280, alignSelf: 'center', paddingTop: 12, gap: 16 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBrand: { flex: 1, alignItems: 'center', gap: 2 },
  brandOverline: { color: 'rgba(255,255,255,0.72)', fontSize: 10, letterSpacing: 2.6 },
  brandSub: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
  heroGrid: { gap: 16 },
  heroGridDesktop: { flexDirection: 'row', alignItems: 'center', gap: 32 },
  heroCopy: { flex: 1, gap: 12 },
  heroPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  heroTitle: { color: '#FFFFFF', fontSize: 30, lineHeight: 37, letterSpacing: -0.9 },
  heroTitleDesktop: { fontSize: 44, lineHeight: 52, letterSpacing: -1.6 },
  heroSubtitle: { color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 20, maxWidth: 520 },
  heroStats: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 4 },
  heroStat: { gap: 1 },
  heroStatValue: { color: '#FFFFFF', fontSize: 19 },
  heroStatLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 10 },
  heroStatDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: 'rgba(255,255,255,0.18)' },

  heroCollage: { width: 380, height: 300, flexDirection: 'row', flexWrap: 'wrap', gap: 8, position: 'relative' },
  collageItem: { borderRadius: 18, overflow: 'hidden', position: 'relative', justifyContent: 'flex-end', padding: 10 },
  collagePrimary: { width: '58%', height: '100%', backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  collageSecondary: { width: '38%', height: '48%', backgroundColor: 'rgba(255,255,255,0.07)' },
  collageHidden: { height: '48%' },
  collageLabel: { color: '#FFFFFF', fontSize: 10 },
  collageFrame: {
    ...StyleSheet.absoluteFill,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },

  searchCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 8,
  },
  searchRow: { gap: 8 },
  searchRowDesktop: { flexDirection: 'row', alignItems: 'center' },
  searchField: { flex: 1.4, minWidth: 0 },
  searchCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    height: 54,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchLabel: { fontSize: 9 },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 54,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  searchButtonText: { color: '#FFFFFF', fontSize: 12 },
  activeFilterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 2 },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  activePillText: { fontSize: 10 },
  clearAll: { fontSize: 10, textDecorationLine: 'underline' },

  body: { width: '100%', maxWidth: 1280, alignSelf: 'center', paddingTop: 16, paddingBottom: 34, gap: 18 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickAction: {
    flex: 1,
    minWidth: 158,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 58,
  },
  quickIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 11.5 },
  quickHint: { fontSize: 9.5 },
  quickBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  quickBadgeText: { color: '#FFFFFF', fontSize: 9 },

  ownerCard: { padding: 16, gap: 14 },
  ownerHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ownerIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerOverline: { color: 'rgba(255,255,255,0.55)', fontSize: 9 },
  ownerTitle: { color: '#FFFFFF' },
  ownerSub: { color: 'rgba(255,255,255,0.65)', fontSize: 11 },
  ownerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  ownerCtaText: { color: '#FFFFFF', fontSize: 11 },
  ownerStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ownerStat: {
    flex: 1,
    minWidth: 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  ownerStatDot: { width: 7, height: 7, borderRadius: 4 },
  ownerStatValue: { color: '#FFFFFF', fontSize: 15 },
  ownerStatLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 9.5 },

  categoryWrap: { marginHorizontal: -4 },
  categoryRail: { gap: 10, paddingHorizontal: 4, paddingVertical: 2 },
  categoryTile: { alignItems: 'center', gap: 6, width: 74 },
  categoryIcon: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  categoryIconActive: {},
  categoryLabel: { fontSize: 10.5, textAlign: 'center' },

  section: { gap: 11 },
  resultsHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2 },
  resultActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: {},
  footNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 18,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
