import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/theme/ThemeProvider';

import { RideEmptyState } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { RideMapPreview } from '@/features/ride/components/RideMapPreview';
import { RideOfferCard } from '@/features/ride/components/RideOfferCard';
import { useRideOffer, useRideSearch } from '@/features/ride/hooks/use-ride';
import type { RideMode, RideScope } from '@/features/ride/types';

type When = 'any' | 'today' | 'tomorrow' | 'week';

const WHEN_LABEL: Record<When, string> = {
  any: 'Tüm tarihler',
  today: 'Bugün',
  tomorrow: 'Yarın',
  week: '7 gün',
};

export default function RideSearchScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ scope?: string; origin?: string; dest?: string }>();

  const [scope, setScope] = useState<RideScope>(params.scope === 'intercity' ? 'intercity' : 'intracity');
  const [mode, setMode] = useState<RideMode | 'all'>('all');
  const [origin, setOrigin] = useState(params.origin ?? '');
  const [dest, setDest] = useState(params.dest ?? '');
  const [when, setWhen] = useState<When>(params.origin || params.dest ? 'week' : 'any');
  const [seats, setSeats] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [mapMode, setMapMode] = useState(false);
  const [onlyAc, setOnlyAc] = useState(false);
  const [noSmoking, setNoSmoking] = useState(false);
  const [womenOnly, setWomenOnly] = useState(false);
  const [accessible, setAccessible] = useState(false);
  const [minRating, setMinRating] = useState<number | null>(null);

  const debouncedOrigin = useDebouncedValue(origin, 450);
  const debouncedDest = useDebouncedValue(dest, 450);

  const window = useMemo(() => {
    const now = new Date();
    if (when === 'any') {
      return { from: null, to: null };
    }
    const from = new Date(now);
    if (when === 'tomorrow') {
      from.setDate(from.getDate() + 1);
      from.setHours(0, 0, 0, 0);
    }
    const to = new Date(from);
    if (when === 'week') {
      to.setDate(to.getDate() + 7);
    } else {
      to.setHours(23, 59, 59, 999);
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }, [when]);

  const filters = {
    scope,
    mode,
    originCity: debouncedOrigin.trim() || null,
    destCity: debouncedDest.trim() || null,
    departFrom: window.from,
    departTo: window.to,
    seats,
    hasAc: onlyAc,
    noSmoking,
    womenOnly,
    accessible,
    minRating,
    limit: 30,
  };

  const search = useRideSearch(filters);
  const first = search.data?.items[0] ?? null;
  const topOffer = useRideOffer(mapMode && first ? first.id : null);

  const activeFilterCount = [onlyAc, noSmoking, womenOnly, accessible, minRating != null].filter(Boolean).length;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Yolculuk ara"
        subtitle={`${search.data?.total ?? 0} sonuç · gerçek mesafe ve uygunluk`}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mapMode ? 'Liste görünümü' : 'Harita görünümü'}
            onPress={() => setMapMode((value) => !value)}
            style={[styles.iconBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          >
            <Ionicons name={mapMode ? 'list-outline' : 'map-outline'} size={19} color={theme.colors.text} />
          </Pressable>
        }
      />

      <View style={styles.segment}>
        {(['intracity', 'intercity'] as RideScope[]).map((item) => {
          const active = scope === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setScope(item)}
              style={[
                styles.segmentItem,
                {
                  backgroundColor: active ? theme.colors.surface : 'transparent',
                  borderColor: active ? theme.colors.border : 'transparent',
                },
              ]}
            >
              <Ionicons
                name={item === 'intracity' ? 'business-outline' : 'trail-sign-outline'}
                size={15}
                color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
              />
              <AppText variant="label" color={active ? 'primaryDeep' : 'textTertiary'}>
                {item === 'intracity' ? 'Şehir içi' : 'Şehirler arası'}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <Card padding={14} style={styles.form}>
        <View style={styles.inputRow}>
          <View style={[styles.inputDot, { backgroundColor: theme.colors.success }]} />
          <TextInput
            value={origin}
            onChangeText={setOrigin}
            placeholder="Kalkış şehri / ilçe"
            placeholderTextColor={theme.colors.textTertiary}
            style={[styles.input, theme.typography.body, { color: theme.colors.text }]}
            returnKeyType="next"
          />
        </View>
        <View style={[styles.inputDivider, { backgroundColor: theme.colors.divider }]} />
        <View style={styles.inputRow}>
          <View style={[styles.inputDot, { backgroundColor: theme.colors.primary }]} />
          <TextInput
            value={dest}
            onChangeText={setDest}
            placeholder="Varış şehri / ilçe"
            placeholderTextColor={theme.colors.textTertiary}
            style={[styles.input, theme.typography.body, { color: theme.colors.text }]}
            returnKeyType="search"
          />
        </View>
        <View style={styles.quickRow}>
          <View style={styles.chips}>
            {(['any', 'today', 'tomorrow', 'week'] as When[]).map((item) => {
              const active = when === item;
              return (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setWhen(item)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                    {WHEN_LABEL[item]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.modeRow}>
          {(['all', 'instant', 'scheduled'] as const).map((item) => {
            const active = mode === item;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setMode(item)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? theme.colors.accentSoft : theme.colors.surfaceMuted,
                    borderColor: active ? theme.colors.accent : theme.colors.border,
                  },
                ]}
              >
                <AppText variant="caption" color={active ? 'accent' : 'textSecondary'}>
                  {item === 'all' ? 'Tümü' : item === 'instant' ? 'Anlık' : 'Planlı'}
                </AppText>
              </Pressable>
            );
          })}
          <View style={styles.seatStepper}>
            <AppText variant="caption" color="textSecondary">Koltuk</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Koltuk azalt"
              onPress={() => setSeats((value) => Math.max(1, value - 1))}
              style={[styles.stepBtn, { borderColor: theme.colors.border }]}
            >
              <Ionicons name="remove" size={14} color={theme.colors.text} />
            </Pressable>
            <AppText variant="label">{seats}</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Koltuk artır"
              onPress={() => setSeats((value) => Math.min(8, value + 1))}
              style={[styles.stepBtn, { borderColor: theme.colors.border }]}
            >
              <Ionicons name="add" size={14} color={theme.colors.text} />
            </Pressable>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setShowFilters((value) => !value)}
          style={styles.filterToggle}
        >
          <Ionicons name="options-outline" size={15} color={theme.colors.primaryDeep} />
          <AppText variant="label" color="primaryDeep">
            Filtreler
          </AppText>
          {activeFilterCount ? <Badge label={String(activeFilterCount)} tone="primary" /> : null}
          <View style={styles.flex} />
          <Ionicons
            name={showFilters ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={theme.colors.textTertiary}
          />
        </Pressable>

        {showFilters ? (
          <View style={styles.filters}>
            {[
              { label: 'Klima', value: onlyAc, set: setOnlyAc },
              { label: 'Sigarasız', value: noSmoking, set: setNoSmoking },
              { label: 'Yalnızca kadın', value: womenOnly, set: setWomenOnly },
              { label: 'Erişilebilir araç', value: accessible, set: setAccessible },
            ].map((filter) => (
              <View key={filter.label} style={styles.switchRow}>
                <AppText variant="body" color="textSecondary">{filter.label}</AppText>
                <Switch
                  value={filter.value}
                  onValueChange={filter.set}
                  trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
                  thumbColor={filter.value ? theme.colors.primary : theme.colors.textTertiary}
                />
              </View>
            ))}
            <View style={styles.ratingRow}>
              <AppText variant="body" color="textSecondary">Minimum puan</AppText>
              <View style={styles.chips}>
                {[null, 4, 4.5].map((value) => {
                  const active = minRating === value;
                  return (
                    <Pressable
                      key={String(value)}
                      onPress={() => setMinRating(value)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                          borderColor: active ? theme.colors.primary : theme.colors.border,
                        },
                      ]}
                    >
                      <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                        {value == null ? 'Hepsi' : `${value}+`}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        ) : null}
      </Card>

      {search.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
          <AppText variant="caption" color="textTertiary">Yolculuklar eşleştiriliyor…</AppText>
        </View>
      ) : search.isError ? (
        <RideEmptyState
          icon="cloud-offline-outline"
          title="Arama başarısız"
          message={search.error.message}
          action={<Button label="Tekrar dene" variant="secondary" onPress={() => void search.refetch()} />}
        />
      ) : mapMode ? (
        <View style={styles.mapWrap}>
          {topOffer.data ? (
            <>
              <RideMapPreview
                origin={{ lat: topOffer.data.origin_lat, lng: topOffer.data.origin_lng }}
                dest={{ lat: topOffer.data.dest_lat, lng: topOffer.data.dest_lng }}
                distanceMeters={topOffer.data.distance_meters}
                height={240}
                label={`${topOffer.data.origin_label} → ${topOffer.data.dest_label}`}
              />
              <AppText variant="caption" color="textTertiary">
                Harita görünümü ilk sonucun gerçek koordinatlarını gösterir. Tüm sonuçların harita
                üzerinde işaretlenmesi için sunucunun arama yanıtına koordinat eklemesi gerekir;
                uydurma konum gösterilmez.
              </AppText>
              {first ? <RideOfferCard offer={first} /> : null}
            </>
          ) : (
            <RideEmptyState
              icon="map-outline"
              title="Haritada gösterilecek sonuç yok"
              message="Arama sonucu bulunamadı. Filtreleri gevşetip tekrar dene."
              action={<Button label="Liste görünümü" variant="secondary" onPress={() => setMapMode(false)} />}
            />
          )}
          {search.data?.items.slice(1).map((offer) => (
            <RideOfferCard key={offer.id} offer={offer} />
          ))}
        </View>
      ) : (search.data?.items.length ?? 0) === 0 ? (
        <RideEmptyState
          icon="car-outline"
          title="Uygun yolculuk bulunamadı"
          message="Bu filtrelerle eşleşen ilan yok. Yolcu talebi oluşturarak sürücülerin sana ulaşmasını sağlayabilirsin."
          action={
            <View style={styles.emptyActions}>
              <Button
                label="Yolcu talebi oluştur"
                onPress={() =>
                  router.navigate({
                    pathname: '/ride/request',
                    params: { origin: debouncedOrigin, dest: debouncedDest, scope },
                  } as never)
                }
              />
              <Button
                label="Favori güzergâha kaydet"
                variant="secondary"
                onPress={() =>
                  router.navigate({
                    pathname: '/ride/favorites',
                    params: { origin: debouncedOrigin, dest: debouncedDest, scope },
                  } as never)
                }
              />
            </View>
          }
        />
      ) : (
        <View style={styles.results}>
          {search.data?.items.map((offer) => (
            <RideOfferCard key={offer.id} offer={offer} />
          ))}
          <AppText variant="caption" color="textTertiary" align="center">
            {search.data?.total ?? 0} sonuçtan {search.data?.items.length ?? 0} tanesi gösteriliyor.
            {search.data?.map_note ? ` ${search.data.map_note}` : ''}
          </AppText>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 15,
    backgroundColor: 'rgba(128,87,244,0.08)',
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  form: { gap: 10 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  inputDot: { width: 8, height: 8, borderRadius: 4 },
  input: { flex: 1, paddingVertical: 5 },
  inputDivider: { height: StyleSheet.hairlineWidth, marginLeft: 17 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  seatStepper: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  stepBtn: {
    width: 25,
    height: 25,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 },
  flex: { flex: 1 },
  filters: { gap: 6, paddingTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  ratingRow: { gap: 6, paddingTop: 4 },
  center: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  results: { gap: 10 },
  mapWrap: { gap: 10 },
  emptyActions: { gap: 8, width: '100%' },
});
