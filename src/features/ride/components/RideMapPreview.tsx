import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { staticMapUrl, type LatLng } from '../services/map-service';
import { formatDistance } from '../utils/format';

type Props = {
  origin?: LatLng | null;
  dest?: LatLng | null;
  geometry?: LatLng[];
  height?: number;
  label?: string;
  distanceMeters?: number | null;
};

/**
 * Gerçek harita yalnızca Mapbox anahtarı varsa gösterilir. Anahtar yokken
 * sahte bir harita çizilmez; güzergâh şeması olduğu açıkça belirtilir.
 */
export function RideMapPreview({ origin, dest, geometry, height = 170, label, distanceMeters }: Props) {
  const { theme } = useTheme();
  const hasCoords = Boolean(origin && dest);
  const url = useMemo(
    () =>
      origin && dest
        ? staticMapUrl({ origin, dest, geometry, width: 760, height: height * 2 })
        : null,
    [dest, geometry, height, origin],
  );

  if (url) {
    return (
      <View style={[styles.wrap, { height, borderRadius: theme.radius.lg }]}>
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          accessibilityLabel="Yolculuk güzergâh haritası"
        />
        <LinearGradient
          colors={['transparent', 'rgba(4,8,18,0.78)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.caption}>
          <View style={styles.captionRow}>
            <Ionicons name="navigate" size={13} color="#8FB0FF" />
            <AppText variant="caption" style={styles.captionText}>
              {label ?? 'Güzergâh'}
              {distanceMeters ? ` · ${formatDistance(distanceMeters)}` : ''}
            </AppText>
          </View>
          <AppText variant="caption" style={styles.small}>
            Mapbox
          </AppText>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        {
          height,
          borderRadius: theme.radius.lg,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <LinearGradient
        colors={['#101C3D', '#1A2A55', '#241B3D']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.fallbackInner}>
        <View style={styles.routeDots}>
          <View style={[styles.dot, { backgroundColor: theme.colors.success }]} />
          <View style={[styles.dash, { borderColor: 'rgba(255,255,255,0.28)' }]} />
          <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
        </View>
        <View style={styles.fallbackText}>
          <AppText variant="label" style={styles.white}>
            {hasCoords ? 'Güzergâh şeması' : 'Harita için konum gerekli'}
          </AppText>
          <AppText variant="caption" style={styles.dim}>
            {hasCoords
              ? 'Mapbox anahtarı tanımlı olmadığı için gerçek harita gösterilmiyor.'
              : 'Kalkış ve varış koordinatları girildiğinde rota çizilebilir.'}
          </AppText>
          {distanceMeters ? (
            <AppText variant="caption" style={styles.dim}>
              Kuş uçuşu mesafe: {formatDistance(distanceMeters)}
            </AppText>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: '#0B1020' },
  caption: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  captionText: { color: '#F2F6FF' },
  small: { color: 'rgba(255,255,255,0.55)', fontSize: 9 },
  fallback: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  fallbackInner: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20 },
  routeDots: { alignItems: 'center', justifyContent: 'center', height: 96, width: 20 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dash: { flex: 1, borderLeftWidth: 2, borderStyle: 'dashed', marginVertical: 4 },
  fallbackText: { flex: 1, gap: 3 },
  white: { color: '#F4F7FF' },
  dim: { color: 'rgba(226,235,255,0.66)' },
});
