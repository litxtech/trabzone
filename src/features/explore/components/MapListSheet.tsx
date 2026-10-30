import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge } from '@/components/ui';
import { MapSheet } from '@/features/map/components/MapSheet';
import { useTheme } from '@/theme/ThemeProvider';

import type { ExploreMarker } from '../types';
import { formatDecimal, formatPrice, metersLabel } from '../utils/format';
import { PlaceCoverImage } from './PlaceCoverImage';
import { StorageImage } from './StorageImage';

type Props = {
  visible: boolean;
  markers: ExploreMarker[];
  total: number;
  truncated: boolean;
  onSelect: (marker: ExploreMarker) => void;
  onClose: () => void;
};

export function MapListSheet({ visible, markers, total, truncated, onSelect, onClose }: Props) {
  const { theme } = useTheme();

  return (
    <MapSheet
      visible={visible}
      onClose={onClose}
      title="Haritadaki sonuçlar"
      subtitle={`${total.toLocaleString('tr-TR')} kayıt · ${markers.length} işaret gösteriliyor`}
      maxHeightRatio={0.92}
    >
      {truncated ? (
        <Badge label="Haritayı yakınlaştırarak tüm kayıtları görebilirsin" tone="warning" />
      ) : null}
      {markers.map((marker) => {
        const isPlace = marker.kind === 'place';
        return (
          <Pressable
            key={`${marker.kind}:${marker.id}`}
            accessibilityRole="button"
            onPress={() => onSelect(marker)}
            style={({ pressed }) => [
              styles.row,
              {
                borderColor: theme.colors.border,
                backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
              },
            ]}
          >
            {isPlace ? (
              <PlaceCoverImage
                coverPath={marker.cover_path}
                name={marker.name}
                lat={marker.lat}
                lng={marker.lng}
                size="thumb"
                recycleKey={marker.id}
                style={styles.thumb}
                fallback={
                  <Ionicons name="storefront-outline" size={20} color={theme.colors.textTertiary} />
                }
              />
            ) : (
              <StorageImage path={marker.cover_path} bucket="real-estate-media" style={styles.thumb} />
            )}
            <View style={styles.text}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {isPlace ? marker.name : marker.title}
              </AppText>
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {isPlace
                  ? [marker.category_name, marker.district].filter(Boolean).join(' · ')
                  : [marker.category_name, marker.district, marker.neighborhood].filter(Boolean).join(' · ')}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {isPlace
                  ? marker.rating != null
                    ? `★ ${formatDecimal(marker.rating, 1)} · ${marker.review_count} yorum`
                    : 'Yeni işletme'
                  : `${formatPrice(marker.price_cents, marker.currency, marker.price_period)} · ${metersLabel(
                      marker.net_m2 ?? marker.gross_m2,
                    )}`}
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
          </Pressable>
        );
      })}
      {markers.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="map-outline" size={28} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" align="center">
            Bu görünümde yayınlanmış kayıt yok. Haritayı kaydır veya filtreleri değiştir.
          </AppText>
        </View>
      ) : null}
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 52, height: 52, borderRadius: 10 },
  text: { flex: 1, gap: 2 },
  empty: { paddingVertical: 30, gap: 8, alignItems: 'center' },
});
