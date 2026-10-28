import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, TextField } from '@/components/ui';
import { useExploreBootstrap } from '@/features/explore/hooks/use-explore';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

export type MarketSortKey = 'new' | 'price_asc' | 'price_desc' | 'popular' | 'near';

export type MarketFilters = {
  districtId: number | null;
  minPrice: string;
  maxPrice: string;
  sort: MarketSortKey;
  condition: string | null;
  favorites: boolean;
};

export const EMPTY_MARKET_FILTERS: MarketFilters = {
  districtId: null,
  minPrice: '',
  maxPrice: '',
  sort: 'new',
  condition: null,
  favorites: false,
};

const SORT_OPTIONS: { key: MarketSortKey; label: string }[] = [
  { key: 'new', label: 'En yeni' },
  { key: 'price_asc', label: 'Fiyat: artan' },
  { key: 'price_desc', label: 'Fiyat: azalan' },
  { key: 'popular', label: 'Popüler' },
  { key: 'near', label: 'Yakınımdakiler' },
];

const CONDITION_OPTIONS = [
  { key: 'new', label: 'Sıfır' },
  { key: 'like_new', label: 'Az kullanılmış' },
  { key: 'good', label: 'İyi' },
  { key: 'fair', label: 'Yıpranmış' },
];

type Props = {
  visible: boolean;
  initial?: MarketFilters;
  onClose: () => void;
  onApply: (filters: MarketFilters) => void;
  onSaveSearch?: (filters: MarketFilters) => void;
};

/** Kategoriye göre değişen, tüm kategorilerde ortak premium filtre penceresi. */
export function MarketFilterSheet({
  visible,
  initial = EMPTY_MARKET_FILTERS,
  onClose,
  onApply,
  onSaveSearch,
}: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const bootstrap = useExploreBootstrap();
  const [state, setState] = useState<MarketFilters>(initial);

  useEffect(() => {
    if (visible) {
      // Pencere her açıldığında filtreler çağıran ekranın son halinden başlar.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(initial);
    }
    // Yalnızca pencere açıldığında başlangıç değerleri senkronlanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const districts = bootstrap.data?.districts ?? [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filtreyi kapat"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
              paddingBottom: insets.bottom + 14,
            },
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: theme.colors.borderStrong }]} />
          </View>
          <View style={styles.sheetHeader}>
            <View style={styles.flex}>
              <AppText variant="h3">Filtreler</AppText>
              <AppText variant="caption" color="textTertiary">
                Aradığın ilanı daralt
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filtreleri sıfırla"
              onPress={() => {
                haptics.selection();
                setState(EMPTY_MARKET_FILTERS);
              }}
              style={styles.clearButton}
            >
              <AppText variant="caption" color="primaryDeep">
                Sıfırla
              </AppText>
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.group}>
              <AppText variant="label" color="textSecondary">
                Sıralama
              </AppText>
              <View style={styles.wrap}>
                {SORT_OPTIONS.map((option) => (
                  <Chip
                    key={option.key}
                    label={option.label}
                    active={state.sort === option.key}
                    onPress={() => setState((current) => ({ ...current, sort: option.key }))}
                  />
                ))}
              </View>
            </View>

            <View style={styles.group}>
              <AppText variant="label" color="textSecondary">
                İlçe
              </AppText>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.wrap}
              >
                <Chip
                  label="Tümü"
                  active={state.districtId == null}
                  onPress={() => setState((current) => ({ ...current, districtId: null }))}
                />
                {districts.map((district) => (
                  <Chip
                    key={district.id}
                    label={district.name}
                    active={state.districtId === district.id}
                    onPress={() =>
                      setState((current) => ({
                        ...current,
                        districtId: current.districtId === district.id ? null : district.id,
                      }))
                    }
                  />
                ))}
              </ScrollView>
            </View>

            <View style={styles.priceRow}>
              <TextField
                label="Min. fiyat (TL)"
                value={state.minPrice}
                onChangeText={(value) =>
                  setState((current) => ({ ...current, minPrice: value.replace(/[^0-9]/g, '') }))
                }
                keyboardType="number-pad"
                placeholder="0"
                containerStyle={styles.flex}
              />
              <TextField
                label="Maks. fiyat (TL)"
                value={state.maxPrice}
                onChangeText={(value) =>
                  setState((current) => ({ ...current, maxPrice: value.replace(/[^0-9]/g, '') }))
                }
                keyboardType="number-pad"
                placeholder="Sınırsız"
                containerStyle={styles.flex}
              />
            </View>

            <View style={styles.group}>
              <AppText variant="label" color="textSecondary">
                Ürün durumu
              </AppText>
              <View style={styles.wrap}>
                <Chip
                  label="Tümü"
                  active={state.condition == null}
                  onPress={() => setState((current) => ({ ...current, condition: null }))}
                />
                {CONDITION_OPTIONS.map((option) => (
                  <Chip
                    key={option.key}
                    label={option.label}
                    active={state.condition === option.key}
                    onPress={() =>
                      setState((current) => ({
                        ...current,
                        condition: current.condition === option.key ? null : option.key,
                      }))
                    }
                  />
                ))}
              </View>
            </View>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: state.favorites }}
              onPress={() => {
                haptics.selection();
                setState((current) => ({ ...current, favorites: !current.favorites }));
              }}
              style={[styles.toggleRow, { borderColor: theme.colors.border }]}
            >
              <View style={[styles.toggleIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="heart" size={16} color={theme.colors.primaryDeep} />
              </View>
              <View style={styles.flex}>
                <AppText variant="label">Yalnızca favorilerim</AppText>
                <AppText variant="caption" color="textTertiary">
                  Kaydettiğin ilanlar arasında ara
                </AppText>
              </View>
              <View
                style={[
                  styles.switch,
                  {
                    backgroundColor: state.favorites
                      ? theme.colors.primary
                      : theme.colors.borderStrong,
                  },
                ]}
              >
                <View
                  style={[styles.knob, { alignSelf: state.favorites ? 'flex-end' : 'flex-start' }]}
                />
              </View>
            </Pressable>
          </ScrollView>

          <View style={styles.footer}>
            {onSaveSearch ? (
              <Button
                label="Aramayı kaydet"
                variant="outline"
                size="md"
                fullWidth={false}
                style={styles.saveButton}
                leftIcon={<Ionicons name="bookmark-outline" size={16} color={theme.colors.text} />}
                onPress={() => onSaveSearch(state)}
              />
            ) : null}
            <Button
              label="Sonuçları göster"
              size="md"
              fullWidth
              style={styles.flex}
              onPress={() => {
                haptics.tap();
                onApply(state);
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
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

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(3,7,14,0.55)',
  },
  sheet: {
    maxHeight: '86%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
  },
  handleWrap: { alignItems: 'center', paddingVertical: 9 },
  handle: { width: 38, height: 4, borderRadius: 2 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 8 },
  flex: { flex: 1 },
  clearButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  body: { gap: 16, paddingBottom: 14 },
  group: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
    justifyContent: 'center',
  },
  priceRow: { flexDirection: 'row', gap: 10 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switch: { width: 42, height: 25, borderRadius: 13, padding: 3, justifyContent: 'center' },
  knob: { width: 19, height: 19, borderRadius: 10, backgroundColor: '#FFFFFF' },
  footer: { flexDirection: 'row', gap: 10, paddingTop: 6 },
  saveButton: { flexShrink: 0, paddingHorizontal: 14 },
});
