import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { MapSheet } from '@/features/map/components/MapSheet';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import type { District } from '../types';

export type ExploreFilters = {
  districtId: number | null;
  neighborhoodId: number | null;
  listingKind: 'rent' | 'sale' | 'transfer' | null;
  minPrice: number | null;
  maxPrice: number | null;
  rooms: number | null;
  minM2: number | null;
};

export const EMPTY_EXPLORE_FILTERS: ExploreFilters = {
  districtId: null,
  neighborhoodId: null,
  listingKind: null,
  minPrice: null,
  maxPrice: null,
  rooms: null,
  minM2: null,
};

type Props = {
  visible: boolean;
  districts: District[];
  filters: ExploreFilters;
  onApply: (filters: ExploreFilters) => void;
  onClose: () => void;
  onDistrictFocus: (district: District) => void;
};

const KIND_OPTIONS: { key: NonNullable<ExploreFilters['listingKind']> | null; label: string }[] = [
  { key: null, label: 'Tüm emlak' },
  { key: 'rent', label: 'Kiralık' },
  { key: 'sale', label: 'Satılık' },
  { key: 'transfer', label: 'Devren' },
];

const ROOM_OPTIONS = [1, 2, 3, 4, 5];

export function ExploreFilterSheet({
  visible,
  districts,
  filters,
  onApply,
  onClose,
  onDistrictFocus,
}: Props) {
  const [draft, setDraft] = useState(filters);
  const [minPrice, setMinPrice] = useState(filters.minPrice ? String(filters.minPrice) : '');
  const [maxPrice, setMaxPrice] = useState(filters.maxPrice ? String(filters.maxPrice) : '');
  const [minM2, setMinM2] = useState(filters.minM2 ? String(filters.minM2) : '');

  useEffect(() => {
    if (!visible) return;
    // Sheet her açılışta aktif filtrelerin anlık kopyasıyla başlar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(filters);
    setMinPrice(filters.minPrice ? String(filters.minPrice) : '');
    setMaxPrice(filters.maxPrice ? String(filters.maxPrice) : '');
    setMinM2(filters.minM2 ? String(filters.minM2) : '');
  }, [filters, visible]);

  const district = useMemo(
    () => districts.find((item) => item.id === draft.districtId) ?? null,
    [districts, draft.districtId],
  );

  const apply = () => {
    onApply({
      ...draft,
      minPrice: toNumber(minPrice),
      maxPrice: toNumber(maxPrice),
      minM2: toNumber(minM2),
    });
  };

  return (
    <MapSheet
      visible={visible}
      onClose={onClose}
      title="Harita filtreleri"
      subtitle="İlçe seçimi haritayı o bölgeye taşır; fiyat ve oda filtreleri emlak işaretlerine uygulanır."
      maxHeightRatio={0.92}
      footer={
        <View style={styles.footer}>
          <Button
            label="Filtreleri temizle"
            variant="outline"
            onPress={() => {
              setDraft(EMPTY_EXPLORE_FILTERS);
              setMinPrice('');
              setMaxPrice('');
              setMinM2('');
              onApply(EMPTY_EXPLORE_FILTERS);
            }}
            style={styles.footerButton}
          />
          <Button label="Uygula" onPress={apply} style={styles.footerButton} />
        </View>
      }
    >
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
              setDraft((current) => ({ ...current, districtId: item.id, neighborhoodId: null }));
              haptics.tap();
              onDistrictFocus(item);
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

      <AppText variant="label" color="textSecondary">
        Emlak türü
      </AppText>
      <View style={styles.chipsWrap}>
        {KIND_OPTIONS.map((item) => (
          <Chip
            key={item.label}
            label={item.label}
            active={draft.listingKind === item.key}
            onPress={() => setDraft((current) => ({ ...current, listingKind: item.key }))}
          />
        ))}
      </View>

      <View style={styles.twoCols}>
        <TextField
          label="Min. fiyat (₺)"
          value={minPrice}
          onChangeText={setMinPrice}
          keyboardType="numeric"
          placeholder="Örn. 10000"
          containerStyle={styles.flex}
        />
        <TextField
          label="Maks. fiyat (₺)"
          value={maxPrice}
          onChangeText={setMaxPrice}
          keyboardType="numeric"
          placeholder="Örn. 40000"
          containerStyle={styles.flex}
        />
      </View>

      <View style={styles.twoCols}>
        <TextField
          label="Min. metrekare"
          value={minM2}
          onChangeText={setMinM2}
          keyboardType="numeric"
          placeholder="Örn. 60"
          containerStyle={styles.flex}
        />
        <View style={styles.flex}>
          <AppText variant="label" color="textSecondary">
            Oda sayısı
          </AppText>
          <View style={styles.rooms}>
            <Chip
              label="Tümü"
              active={draft.rooms == null}
              onPress={() => setDraft((current) => ({ ...current, rooms: null }))}
            />
            {ROOM_OPTIONS.map((count) => (
              <Chip
                key={count}
                label={`${count}+1`}
                active={draft.rooms === count}
                onPress={() => setDraft((current) => ({ ...current, rooms: count }))}
              />
            ))}
          </View>
        </View>
      </View>

      <AppText variant="caption" color="textTertiary">
        Filtreler yalnızca yayınlanmış ve doğrulanmış emlak ilanlarına uygulanır. Konut konumları
        yaklaşık (~110 m) gösterilir.
      </AppText>
    </MapSheet>
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

function toNumber(value: string): number | null {
  const parsed = Number(value.replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const styles = StyleSheet.create({
  chips: { gap: 8, paddingRight: 12, alignItems: 'center' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  twoCols: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  rooms: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 6 },
  footer: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1 },
});
