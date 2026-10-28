import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Pressable, View } from 'react-native';

import { AppText } from '@/components/ui';
import type { PlaceCategory } from '@/features/explore/types';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

export type ExploreChipKey = string;

type Props = {
  categories: PlaceCategory[];
  selected: string[];
  onToggle: (key: ExploreChipKey) => void;
  onReset: () => void;
  showPlaces: boolean;
  onTogglePlaces: () => void;
  showRealEstate: boolean;
  onToggleRealEstate: () => void;
};

/**
 * Yatay kategori çipleri. "Tümü" hiçbir kategori seçili değilken aktiftir;
 * kategori seçimi sunucu tarafında slug ile filtrelenir.
 */
export function ExploreCategoryChips({
  categories,
  selected,
  onToggle,
  onReset,
  showPlaces,
  onTogglePlaces,
  showRealEstate,
  onToggleRealEstate,
}: Props) {
  const { theme } = useTheme();

  const chip = (
    key: string,
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    active: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      key={key}
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
      <Ionicons name={icon} size={14} color={active ? theme.colors.onPrimary : theme.colors.textSecondary} />
      <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {chip('all', 'Tümü', 'apps-outline', selected.length === 0, onReset)}
      {chip('places', 'İşletmeler', 'storefront-outline', showPlaces, onTogglePlaces)}
      {chip('real-estate', 'Emlak', 'home-outline', showRealEstate, onToggleRealEstate)}
      <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
      {categories.map((category) =>
        chip(
          category.slug,
          category.name,
          (category.icon as keyof typeof Ionicons.glyphMap | null) ?? 'ellipse-outline',
          selected.includes(category.slug),
          () => onToggle(category.slug),
        ),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 190,
  },
  divider: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: 2 },
});
