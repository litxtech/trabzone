import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { MapSheet } from '@/features/map/components/MapSheet';
import type { District, RealEstateCategory } from '@/features/explore/types';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { parseInteger } from '../labels';

export type RealEstateFilters = {
  listingKind: 'rent' | 'sale' | 'transfer' | null;
  category: string | null;
  districtId: number | null;
  neighborhoodId: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  minM2: number | null;
  maxM2: number | null;
  rooms: number | null;
  maxBuildingAge: number | null;
  ownerType: 'owner' | 'agent' | 'business' | null;
  sort: 'new' | 'price_asc' | 'price_desc' | 'popular';
};

export const EMPTY_RE_FILTERS: RealEstateFilters = {
  listingKind: null,
  category: null,
  districtId: null,
  neighborhoodId: null,
  minPrice: null,
  maxPrice: null,
  minM2: null,
  maxM2: null,
  rooms: null,
  maxBuildingAge: null,
  ownerType: null,
  sort: 'new',
};

const KIND_OPTIONS: { key: RealEstateFilters['listingKind']; label: string }[] = [
  { key: null, label: 'Tümü' },
  { key: 'rent', label: 'Kiralık' },
  { key: 'sale', label: 'Satılık' },
  { key: 'transfer', label: 'Devren' },
];

const ROOMS = [1, 2, 3, 4, 5];
const OWNER_TYPES: { key: RealEstateFilters['ownerType']; label: string }[] = [
  { key: null, label: 'Tümü' },
  { key: 'owner', label: 'Sahibinden' },
  { key: 'agent', label: 'Danışman' },
  { key: 'business', label: 'İşletme' },
];
const SORTS: { key: RealEstateFilters['sort']; label: string }[] = [
  { key: 'new', label: 'En yeni' },
  { key: 'price_asc', label: 'Fiyat artan' },
  { key: 'price_desc', label: 'Fiyat azalan' },
  { key: 'popular', label: 'Popüler' },
];

type Props = {
  visible: boolean;
  filters: RealEstateFilters;
  districts: District[];
  categories: RealEstateCategory[];
  onApply: (filters: RealEstateFilters) => void;
  onClose: () => void;
};

export function RealEstateFilterSheet({
  visible,
  filters,
  districts,
  categories,
  onApply,
  onClose,
}: Props) {
  const { theme } = useTheme();
  const [draft, setDraft] = useState(filters);
  const [minPrice, setMinPrice] = useState(filters.minPrice ? String(filters.minPrice) : '');
  const [maxPrice, setMaxPrice] = useState(filters.maxPrice ? String(filters.maxPrice) : '');
  const [minM2, setMinM2] = useState(filters.minM2 ? String(filters.minM2) : '');
  const [maxM2, setMaxM2] = useState(filters.maxM2 ? String(filters.maxM2) : '');
  const [age, setAge] = useState(filters.maxBuildingAge ? String(filters.maxBuildingAge) : '');

  useEffect(() => {
    if (!visible) return;
    // Sheet her açılışta aktif filtrelerin anlık kopyasıyla başlar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(filters);
    setMinPrice(filters.minPrice ? String(filters.minPrice) : '');
    setMaxPrice(filters.maxPrice ? String(filters.maxPrice) : '');
    setMinM2(filters.minM2 ? String(filters.minM2) : '');
    setMaxM2(filters.maxM2 ? String(filters.maxM2) : '');
    setAge(filters.maxBuildingAge ? String(filters.maxBuildingAge) : '');
  }, [filters, visible]);

  const district = districts.find((item) => item.id === draft.districtId) ?? null;
  const categoryOptions = useMemo(
    () =>
      categories
        .filter((category) => category.children.length > 0)
        .flatMap((category) => category.children)
        .filter((category) => !draft.listingKind || category.listing_kind === draft.listingKind),
    [categories, draft.listingKind],
  );

  const apply = () => {
    const next: RealEstateFilters = {
      ...draft,
      minPrice: parseInteger(minPrice),
      maxPrice: parseInteger(maxPrice),
      minM2: parseInteger(minM2),
      maxM2: parseInteger(maxM2),
      maxBuildingAge: parseInteger(age),
    };
    if (next.minPrice != null && next.maxPrice != null && next.minPrice > next.maxPrice) {
      const swap = next.minPrice;
      next.minPrice = next.maxPrice;
      next.maxPrice = swap;
    }
    onApply(next);
  };

  const reset = () => {
    setDraft(EMPTY_RE_FILTERS);
    setMinPrice('');
    setMaxPrice('');
    setMinM2('');
    setMaxM2('');
    setAge('');
    onApply(EMPTY_RE_FILTERS);
  };

  return (
    <MapSheet
      visible={visible}
      onClose={onClose}
      title="Emlak filtreleri"
      subtitle="İlanlar yalnızca yayınlanmış ve doğrulanmış kayıtlardan gelir."
      maxHeightRatio={0.94}
      footer={
        <View style={styles.footer}>
          <Button label="Temizle" variant="outline" onPress={reset} style={styles.footerButton} />
          <Button label="Sonuçları göster" onPress={apply} style={styles.footerButton} />
        </View>
      }
    >
      <AppText variant="label" color="textSecondary">
        İlan türü
      </AppText>
      <View style={styles.wrap}>
        {KIND_OPTIONS.map((item) => (
          <Chip
            key={item.label}
            label={item.label}
            active={draft.listingKind === item.key}
            onPress={() =>
              setDraft((current) => ({ ...current, listingKind: item.key, category: null }))
            }
          />
        ))}
      </View>

      <AppText variant="label" color="textSecondary">
        Gayrimenkul türü
      </AppText>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <Chip
          label="Tümü"
          active={draft.category == null}
          onPress={() => setDraft((current) => ({ ...current, category: null }))}
        />
        {categoryOptions.map((category) => (
          <Chip
            key={category.slug}
            label={category.name}
            active={draft.category === category.slug}
            onPress={() =>
              setDraft((current) => ({
                ...current,
                category: current.category === category.slug ? null : category.slug,
              }))
            }
          />
        ))}
      </ScrollView>

      <AppText variant="label" color="textSecondary">
        İlçe
      </AppText>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <Chip
          label="Tüm Trabzon"
          active={draft.districtId == null}
          onPress={() =>
            setDraft((current) => ({ ...current, districtId: null, neighborhoodId: null }))
          }
        />
        {districts.map((item) => (
          <Chip
            key={item.id}
            label={item.name}
            active={draft.districtId === item.id}
            onPress={() => {
              haptics.tap();
              setDraft((current) => ({
                ...current,
                districtId: current.districtId === item.id ? null : item.id,
                neighborhoodId: null,
              }));
            }}
          />
        ))}
      </ScrollView>

      {district && district.neighborhoods.length > 0 ? (
        <>
          <AppText variant="label" color="textSecondary">
            Mahalle
          </AppText>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            <Chip
              label="Tüm mahalleler"
              active={draft.neighborhoodId == null}
              onPress={() => setDraft((current) => ({ ...current, neighborhoodId: null }))}
            />
            {district.neighborhoods.map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                active={draft.neighborhoodId === item.id}
                onPress={() => setDraft((current) => ({ ...current, neighborhoodId: item.id }))}
              />
            ))}
          </ScrollView>
        </>
      ) : null}

      <View style={styles.twoCols}>
        <TextField
          label="Min. fiyat (₺)"
          value={minPrice}
          onChangeText={setMinPrice}
          keyboardType="numeric"
          placeholder="10.000"
          containerStyle={styles.flex}
        />
        <TextField
          label="Maks. fiyat (₺)"
          value={maxPrice}
          onChangeText={setMaxPrice}
          keyboardType="numeric"
          placeholder="40.000"
          containerStyle={styles.flex}
        />
      </View>

      <View style={styles.twoCols}>
        <TextField
          label="Min. m²"
          value={minM2}
          onChangeText={setMinM2}
          keyboardType="numeric"
          placeholder="60"
          containerStyle={styles.flex}
        />
        <TextField
          label="Maks. m²"
          value={maxM2}
          onChangeText={setMaxM2}
          keyboardType="numeric"
          placeholder="200"
          containerStyle={styles.flex}
        />
      </View>

      <AppText variant="label" color="textSecondary">
        Oda sayısı
      </AppText>
      <View style={styles.wrap}>
        <Chip
          label="Tümü"
          active={draft.rooms == null}
          onPress={() => setDraft((current) => ({ ...current, rooms: null }))}
        />
        {ROOMS.map((count) => (
          <Chip
            key={count}
            label={`${count}+1`}
            active={draft.rooms === count}
            onPress={() => setDraft((current) => ({ ...current, rooms: count }))}
          />
        ))}
      </View>

      <View style={styles.twoCols}>
        <TextField
          label="Maks. bina yaşı"
          value={age}
          onChangeText={setAge}
          keyboardType="numeric"
          placeholder="10"
          containerStyle={styles.flex}
        />
        <View style={styles.flex}>
          <AppText variant="label" color="textSecondary">
            İlan sahibi
          </AppText>
          <View style={styles.wrap}>
            {OWNER_TYPES.map((item) => (
              <Chip
                key={item.label}
                label={item.label}
                active={draft.ownerType === item.key}
                onPress={() => setDraft((current) => ({ ...current, ownerType: item.key }))}
              />
            ))}
          </View>
        </View>
      </View>

      <AppText variant="label" color="textSecondary">
        Sıralama
      </AppText>
      <View style={styles.wrap}>
        {SORTS.map((item) => (
          <Chip
            key={item.key}
            label={item.label}
            active={draft.sort === item.key}
            onPress={() => setDraft((current) => ({ ...current, sort: item.key }))}
          />
        ))}
      </View>

      <View style={[styles.note, { backgroundColor: theme.colors.surfaceMuted }]}>
        <AppText variant="caption" color="textTertiary">
          Konut ilanlarının kapı numarası ve kesin koordinatı gizlenir; haritada yaklaşık konum
          gösterilir. Doğrulanmamış ilanlar listelenmez.
        </AppText>
      </View>
    </MapSheet>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
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

const styles = StyleSheet.create({
  chips: { gap: 7, paddingRight: 12, alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingTop: 2 },
  chip: {
    paddingHorizontal: 11,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  twoCols: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  flex: { flex: 1 },
  note: { padding: 10, borderRadius: 12 },
  footer: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1 },
});
