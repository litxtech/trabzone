import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { StorageImage } from '@/features/explore/components/StorageImage';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { AppText, Avatar, IconButton, Screen, Skeleton, TextField } from '@/components/ui';
import { useDiscoverPeople } from '@/features/discovery/hooks/use-discover';
import type { DiscoverProfile } from '@/features/discovery/services/discover-service';
import { useExploreSearch, useImportExternalPlace } from '@/features/explore/hooks/use-explore';
import {
  PLACE_PROVIDER_LABEL,
  useExternalBusinesses,
  type PlaceSearchResult,
} from '@/features/explore/hooks/use-place-search';
import type { ExploreSearchItem } from '@/features/explore/types';
import { MarketListingCard } from '@/features/marketplace/components/MarketListingCard';
import { useMarketSearchHub } from '@/features/marketplace/hooks/use-marketplace-catalog';
import type { MarketListing } from '@/features/marketplace/services/marketplace-catalog-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Bos sorguda gosterilen kesif kisayollari. Yolculuk ve harita ana basliktan
 * kaldirildi; erisimleri burada ve sol menude korunuyor.
 */
const SHORTCUTS: {
  key: string;
  label: string;
  hint: string;
  icon: IconName;
  href: string;
}[] = [
  {
    key: 'ride',
    label: 'Yolculuk Paylaşımı',
    hint: 'Ara · Paylaş · Rezervasyon',
    icon: 'car-sport-outline',
    href: '/ride',
  },
  {
    key: 'map',
    label: 'Etkileşim Haritası',
    hint: 'Arkadaşlar · Mekân · Yolculuk',
    icon: 'map-outline',
    href: '/map',
  },
  {
    key: 'pharmacy',
    label: 'Eczaneler',
    hint: 'Nöbetçi eczane · Adres · Yol tarifi',
    icon: 'medkit-outline',
    href: '/eczaneler',
  },
  {
    key: 'explore',
    label: 'Trabzon Keşfet',
    hint: 'İşletme · Emlak · Alan',
    icon: 'compass-outline',
    href: '/explore',
  },
  {
    key: 'market',
    label: 'Marketplace',
    hint: 'Ürün · Araç · Hizmet',
    icon: 'storefront-outline',
    href: '/marketplace',
  },
];

const SEARCH_HINT = 'Kişi, işletme, ilan veya mahalle ara';

export default function SearchScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();

  const [term, setTerm] = useState(typeof params.q === 'string' ? params.q : '');
  const debounced = useDebouncedValue(term.trim(), 280);
  const active = debounced.length >= 2;

  const people = useDiscoverPeople({
    query: debounced,
    city: null,
    sort: 'popular',
    enabled: active,
  });
  const explore = useExploreSearch(debounced);
  const market = useMarketSearchHub(debounced);

  const peopleItems = active ? (people.data ?? []) : [];
  const exploreItems = active ? (explore.data?.items ?? []) : [];
  const listingItems = active ? (market.data?.listings ?? []) : [];

  // Veritabanında olmayan işletmeler için harita sağlayıcıları (Google, Apple,
  // OpenStreetMap) taranır; aynı işletme iki kez listelenmez.
  const externalBusinesses = useExternalBusinesses({
    query: debounced,
    localPlaces: exploreItems.filter((item) => item.kind === 'place'),
  });
  const externalItems = active ? externalBusinesses.rows : [];

  const importPlace = useImportExternalPlace();
  const importPlaceNow = importPlace.mutate;
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);

  const total = peopleItems.length + exploreItems.length + listingItems.length + externalItems.length;
  const loading =
    active &&
    (people.isLoading ||
      explore.isLoading ||
      market.isLoading ||
      (externalBusinesses.loading && exploreItems.length === 0));
  const failed = active && people.isError && explore.isError && market.isError;

  const go = useCallback(
    (href: string) => {
      haptics.tap();
      Keyboard.dismiss();
      router.push(href as never);
    },
    [router],
  );

  const openPerson = useCallback(
    (person: DiscoverProfile) => go(`/profile/${person.username}`),
    [go],
  );

  const openExploreItem = useCallback(
    (item: ExploreSearchItem) => {
      if (item.kind === 'place') {
        go(`/marketplace/place/${item.id}`);
        return;
      }
      if (item.kind === 'real_estate') {
        go(`/marketplace/real-estate/${item.id}`);
        return;
      }
      // Ilce/mahalle sonucu kesif haritasinda ilgili alana odaklanir.
      haptics.tap();
      Keyboard.dismiss();
      router.push({
        pathname: '/explore',
        params: item.kind === 'district' ? { districtId: String(item.id) } : { neighborhoodId: String(item.id) },
      } as never);
    },
    [go, router],
  );

  const openListing = useCallback(
    (listing: MarketListing) => go(`/marketplace/${listing.id}`),
    [go],
  );

  /**
   * Harita sağlayıcısından gelen işletme önce Trabzone kaydına dönüştürülür,
   * ardından işletme sayfası açılır. Böylece yorum/fotoğraf/etiket akışı
   * gerçek kayıt üzerinde çalışır.
   */
  const openExternalBusiness = useCallback(
    (row: PlaceSearchResult) => {
      const suggestion = row.external;
      if (!suggestion || importingKey) {
        return;
      }
      haptics.tap();
      Keyboard.dismiss();
      setExternalError(null);
      setImportingKey(row.key);
      importPlaceNow(
        {
          name: suggestion.name,
          lat: suggestion.lat,
          lng: suggestion.lng,
          address: suggestion.address || null,
          phone: suggestion.phone,
          website: suggestion.website,
          provider: suggestion.source,
          externalId: suggestion.externalId ?? null,
          categorySlug: row.categorySlug,
          rating: suggestion.rating,
          ratingCount: suggestion.ratingCount,
        },
        {
          onSuccess: (data) => {
            setImportingKey(null);
            go(`/marketplace/place/${data.place_id}`);
          },
          onError: (error) => {
            setImportingKey(null);
            setExternalError(error.message);
          },
        },
      );
    },
    [go, importPlaceNow, importingKey],
  );

  const retry = useCallback(() => {
    void people.refetch();
    void explore.refetch();
    void market.refetch();
  }, [explore, market, people]);

  const shortcuts = useMemo(
    () =>
      SHORTCUTS.map((shortcut) => (
        <Pressable
          key={shortcut.key}
          accessibilityRole="button"
          accessibilityLabel={shortcut.label}
          onPress={() => go(shortcut.href)}
          style={({ pressed }) => [
            styles.shortcut,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <View style={[styles.shortcutIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name={shortcut.icon} size={20} color={theme.colors.primaryDeep} />
          </View>
          <View style={styles.shortcutText}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {shortcut.label}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {shortcut.hint}
            </AppText>
          </View>
        </Pressable>
      )),
    [go, theme.colors],
  );

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded={false}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          size={22}
          onPress={() => router.back()}
        />
        <TextField
          autoFocus={!params.q}
          value={term}
          onChangeText={setTerm}
          placeholder={SEARCH_HINT}
          leftIcon="search-outline"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
          containerStyle={styles.searchField}
          rightSlot={
            term.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Aramayı temizle"
                hitSlop={8}
                onPress={() => {
                  haptics.tap();
                  setTerm('');
                }}
              >
                <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
              </Pressable>
            ) : undefined
          }
        />
      </View>

      <View style={styles.content}>
        {!active ? (
          <>
            <AppText variant="overline" color="textTertiary">
              KEŞFET
            </AppText>
            <View style={styles.shortcutGrid}>{shortcuts}</View>
            <View style={[styles.hintCard, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="search-outline" size={18} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep" style={styles.flex}>
                En az 2 karakter yazınca kişiler, Trabzone’daki ve haritalardaki işletmeler, emlak
                ve marketplace ilanları birlikte aranır.
              </AppText>
            </View>
          </>
        ) : failed ? (
          <View style={styles.state}>
            <Ionicons name="cloud-offline-outline" size={30} color={theme.colors.textSecondary} />
            <AppText variant="h3" align="center">
              Arama yapılamadı
            </AppText>
            <AppText variant="body" color="textSecondary" align="center">
              Bağlantını kontrol edip tekrar dene.
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tekrar dene"
              onPress={retry}
              style={({ pressed }) => [
                styles.retry,
                { backgroundColor: theme.colors.primarySoft, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <AppText variant="label" color="primaryDeep">
                Tekrar dene
              </AppText>
            </Pressable>
          </View>
        ) : loading ? (
          <View style={styles.skeletons}>
            <Skeleton height={14} width="32%" radius={4} />
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} height={64} radius={16} />
            ))}
            <Skeleton height={14} width="26%" radius={4} />
            {[0, 1].map((key) => (
              <Skeleton key={`second-${key}`} height={64} radius={16} />
            ))}
          </View>
        ) : total === 0 ? (
          <View style={styles.state}>
            <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="search-outline" size={24} color={theme.colors.primaryDeep} />
            </View>
            <AppText variant="bodyStrong" align="center">
              Sonuç bulunamadı
            </AppText>
            <AppText variant="body" color="textSecondary" align="center">
              &quot;{debounced}&quot; için eşleşen kişi, işletme veya ilan yok.
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Eczanelerde ara"
              onPress={() => go(`/eczaneler?query=${encodeURIComponent(debounced)}`)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.8 : 1,
                  width: '100%',
                },
              ]}
            >
              <View style={[styles.shortcutIcon, { backgroundColor: theme.colors.successSoft }]}>
                <Ionicons name="medkit-outline" size={19} color={theme.colors.success} />
              </View>
              <View style={styles.rowText}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  Eczanelerde ara
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  Mahalle veya eczane adına göre nöbetçi eczaneler
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
            </Pressable>
          </View>
        ) : (
          <>
            <AppText variant="caption" color="textTertiary">
              {total} sonuç
            </AppText>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Eczanelerde ${debounced} ara`}
              onPress={() => go(`/eczaneler?query=${encodeURIComponent(debounced)}`)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View style={[styles.shortcutIcon, { backgroundColor: theme.colors.successSoft }]}>
                <Ionicons name="medkit-outline" size={19} color={theme.colors.success} />
              </View>
              <View style={styles.rowText}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  Eczanelerde ara
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  &quot;{debounced}&quot; için nöbetçi ve normal eczaneler
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
            </Pressable>

            {peopleItems.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle label="Kişiler" count={peopleItems.length} />
                <View style={styles.rows}>
                  {peopleItems.slice(0, 6).map((person) => {
                    const name =
                      `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() ||
                      person.username;
                    return (
                      <Pressable
                        key={person.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${name} profilini aç`}
                        onPress={() => openPerson(person)}
                        style={({ pressed }) => [
                          styles.row,
                          {
                            backgroundColor: theme.colors.surface,
                            borderColor: theme.colors.border,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Avatar
                          uri={mediaPublicUrl('avatar', person.avatar_path)}
                          name={name}
                          size={42}
                          recycleKey={person.id}
                        />
                        <View style={styles.rowText}>
                          <View style={styles.nameRow}>
                            <AppText variant="bodyStrong" numberOfLines={1} style={styles.title}>
                              {name}
                            </AppText>
                            {person.is_verified ? (
                              <Ionicons
                                name="checkmark-circle"
                                size={14}
                                color={theme.colors.primary}
                              />
                            ) : null}
                          </View>
                          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                            @{person.username}
                            {person.city ? ` · ${person.city}` : ''}
                          </AppText>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={theme.colors.textTertiary}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {exploreItems.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle label="Yerler ve emlak" count={exploreItems.length} />
                <View style={styles.rows}>
                  {exploreItems.slice(0, 8).map((item) => (
                    <Pressable
                      key={`${item.kind}:${item.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title} sonucunu aç`}
                      onPress={() => openExploreItem(item)}
                      style={({ pressed }) => [
                        styles.row,
                        {
                          backgroundColor: theme.colors.surface,
                          borderColor: theme.colors.border,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      {item.image_path ? (
                        <StorageImage
                          path={item.image_path}
                          bucket={
                            item.kind === 'real_estate' ? 'real-estate-media' : 'place-media'
                          }
                          style={styles.thumb}
                        />
                      ) : (
                        <View
                          style={[
                            styles.thumb,
                            styles.thumbFallback,
                            { backgroundColor: theme.colors.primarySoft },
                          ]}
                        >
                          <Ionicons
                            name={
                              item.kind === 'real_estate'
                                ? 'home-outline'
                                : item.kind === 'district'
                                  ? 'map-outline'
                                  : item.kind === 'neighborhood'
                                    ? 'location-outline'
                                    : 'storefront-outline'
                            }
                            size={19}
                            color={theme.colors.primaryDeep}
                          />
                        </View>
                      )}
                      <View style={styles.rowText}>
                        <AppText variant="bodyStrong" numberOfLines={1}>
                          {item.title}
                        </AppText>
                        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                          {item.subtitle || item.category || ''}
                        </AppText>
                      </View>
                      {item.rating != null ? (
                        <AppText variant="caption" color="warning">
                          ★ {item.rating.toFixed(1)}
                        </AppText>
                      ) : null}
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={theme.colors.textTertiary}
                      />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {externalItems.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle label="Haritalardan işletmeler" count={externalItems.length} />
                <View style={styles.rows}>
                  {externalItems.slice(0, 8).map((row) => {
                    const busy = importingKey === row.key;
                    return (
                      <Pressable
                        key={row.key}
                        accessibilityRole="button"
                        accessibilityLabel={`${row.title} işletmesini Trabzone'a ekle ve aç`}
                        accessibilityState={{ busy }}
                        disabled={importingKey != null}
                        onPress={() => openExternalBusiness(row)}
                        style={({ pressed }) => [
                          styles.row,
                          {
                            backgroundColor: theme.colors.surface,
                            borderColor: theme.colors.border,
                            opacity: pressed ? 0.8 : busy ? 0.6 : 1,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.thumb,
                            styles.thumbFallback,
                            { backgroundColor: theme.colors.primarySoft },
                          ]}
                        >
                          <Ionicons name="map-outline" size={19} color={theme.colors.primaryDeep} />
                        </View>
                        <View style={styles.rowText}>
                          <AppText variant="bodyStrong" numberOfLines={1}>
                            {row.title}
                          </AppText>
                          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                            {row.subtitle || 'Harita işletmesi'}
                          </AppText>
                        </View>
                        <View style={[styles.providerTag, { backgroundColor: theme.colors.surfaceMuted }]}>
                          <AppText variant="caption" color="textSecondary">
                            {PLACE_PROVIDER_LABEL[row.provider]}
                          </AppText>
                        </View>
                        {busy ? (
                          <ActivityIndicator size="small" color={theme.colors.primary} />
                        ) : (
                          <Ionicons name="add-circle" size={18} color={theme.colors.primary} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
                {externalError ? (
                  <AppText variant="caption" color="danger">
                    {externalError}
                  </AppText>
                ) : null}
              </View>
            ) : null}

            {listingItems.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle label="Marketplace" count={listingItems.length} />
                <View style={styles.rows}>
                  {listingItems.slice(0, 8).map((listing) => (
                    <MarketListingCard
                      key={listing.id}
                      listing={listing}
                      layout="row"
                      onPress={() => openListing(listing)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>

      {active && (market.isFetching || explore.isFetching) && !loading ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.busy} />
      ) : null}
    </Screen>
  );
}

function SectionTitle({ label, count }: { label: string; count: number }) {
  const { theme } = useTheme();
  return (
    <View style={styles.sectionHead}>
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      <View style={[styles.countPill, { backgroundColor: theme.colors.surfaceMuted }]}>
        <AppText variant="caption" color="textSecondary" style={styles.countText}>
          {count}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 8,
  },
  searchField: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 12 },
  shortcutGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  shortcut: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  shortcutIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutText: { flex: 1, gap: 1 },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 14,
  },
  section: { gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countPill: {
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontSize: 10.5, lineHeight: 14 },
  providerTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  rows: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 9,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 60,
  },
  rowText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { flexShrink: 1 },
  thumb: { width: 44, height: 44, borderRadius: 11 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  skeletons: { gap: 10, paddingTop: 4 },
  state: { paddingHorizontal: 24, paddingTop: 46, paddingBottom: 26, alignItems: 'center', gap: 9 },
  stateIcon: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, marginTop: 4 },
  busy: { paddingBottom: 16 },
});
