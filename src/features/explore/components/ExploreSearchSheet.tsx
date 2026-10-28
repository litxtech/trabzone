import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, TextField } from '@/components/ui';
import { MapSheet } from '@/features/map/components/MapSheet';
import { useTheme } from '@/theme/ThemeProvider';

import type { ExploreSearchItem } from '../types';
import { StorageImage } from './StorageImage';

type Props = {
  visible: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  results: ExploreSearchItem[];
  loading: boolean;
  onSelect: (item: ExploreSearchItem) => void;
  onClose: () => void;
};

const KIND_ICON: Record<ExploreSearchItem['kind'], keyof typeof Ionicons.glyphMap> = {
  place: 'storefront-outline',
  real_estate: 'home-outline',
  district: 'map-outline',
  neighborhood: 'location-outline',
};

export function ExploreSearchSheet({
  visible,
  query,
  onQueryChange,
  results,
  loading,
  onSelect,
  onClose,
}: Props) {
  const { theme } = useTheme();

  return (
    <MapSheet
      visible={visible}
      onClose={onClose}
      title="Trabzon'da ara"
      subtitle="İşletme, emlak, ilçe, mahalle veya adres"
      maxHeightRatio={0.9}
    >
      <TextField
        autoFocus
        value={query}
        onChangeText={onQueryChange}
        placeholder="Trabzon’da yer, işletme veya emlak ara…"
        leftIcon="search"
        returnKeyType="search"
        autoCapitalize="none"
        rightSlot={
          loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : undefined
        }
      />

      {query.trim().length < 2 ? (
        <View style={styles.empty}>
          <Ionicons name="compass-outline" size={26} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" align="center">
            En az 2 karakter yaz. Sonuçlar gerçek işletme, emlak ve mahalle kayıtlarından gelir.
          </AppText>
        </View>
      ) : !loading && results.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={26} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" align="center">
            Bu aramayla eşleşen kayıt bulunamadı.
          </AppText>
        </View>
      ) : (
        <View style={styles.list}>
          {results.map((item) => (
            <Pressable
              key={`${item.kind}:${item.id}`}
              accessibilityRole="button"
              onPress={() => onSelect(item)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              {item.image_path ? (
                <StorageImage
                  path={item.image_path}
                  bucket={item.kind === 'real_estate' ? 'real-estate-media' : 'place-media'}
                  style={styles.thumb}
                />
              ) : (
                <View style={[styles.thumb, styles.iconThumb, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name={KIND_ICON[item.kind]} size={20} color={theme.colors.primaryDeep} />
                </View>
              )}
              <View style={styles.rowText}>
                <View style={styles.titleRow}>
                  <AppText variant="bodyStrong" numberOfLines={1} style={styles.title}>
                    {item.title}
                  </AppText>
                  {item.verified ? (
                    <Ionicons name="shield-checkmark" size={14} color={theme.colors.success} />
                  ) : null}
                </View>
                <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                  {item.subtitle || item.category || ''}
                </AppText>
              </View>
              {item.rating != null ? (
                <AppText variant="caption" color="warning">
                  ★ {item.rating.toFixed(1)}
                </AppText>
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      )}
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: 28, alignItems: 'center', gap: 8 },
  list: { gap: 8, paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 44, height: 44, borderRadius: 10 },
  iconThumb: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { flexShrink: 1 },
});
