import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { hasMapboxToken, staticMapUrl } from '../services/map-service';
import type { MapCamera, MapPoint } from '../types';
import { projectToPixels } from '../utils/geo';
import { currentMapProvider, markerTone, PREMIUM_MARKER, toneColor } from '../utils/map-theme';

type Props = {
  camera: MapCamera;
  markers?: MapPoint[];
  message: string;
  onMarkerPress?: (point: MapPoint) => void;
  height?: number;
  showProvider?: boolean;
};

/**
 * Harita motoru bu derlemede yoksa gösterilen dürüst geri dönüş.
 * Sahte canlı harita çizilmez; Mapbox token'ı varsa gerçek statik Mapbox
 * görüntüsü gösterilir ve bunun statik olduğu açıkça yazılır.
 */
export function MapCanvasFallback({ camera, markers = [], message, onMarkerPress, height, showProvider = true }: Props) {
  const { theme } = useTheme();
  const provider = currentMapProvider(hasMapboxToken());
  const [width, setWidth] = useState(0);
  const [layoutHeight, setLayoutHeight] = useState(0);
  // Tam ekran kullanımda statik harita da kutunun gerçek yüksekliğini kullanır.
  const mapHeight = height ?? (layoutHeight || 520);

  const url = useMemo(() => {
    if (!hasMapboxToken() || width < 10) {
      return null;
    }
    return staticMapUrl({
      center: { lat: camera.lat, lng: camera.lng },
      zoom: camera.zoom,
      width,
      height: mapHeight,
      dark: theme.scheme === 'dark',
    });
  }, [camera.lat, camera.lng, camera.zoom, mapHeight, theme.scheme, width]);

  return (
    <View
      style={[styles.root, height ? { height } : StyleSheet.absoluteFill]}
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);
        setLayoutHeight(event.nativeEvent.layout.height);
      }}
    >
      {url ? (
        <>
          <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
          {markers.slice(0, 40).map((point) => {
            const p = projectToPixels(
              point,
              camera,
              { width, height: mapHeight },
            );
            if (p.x < -20 || p.y < -20 || p.x > width + 20 || p.y > mapHeight + 20) {
              return null;
            }
            return (
              <Pressable
                key={point.id}
                accessibilityRole="button"
                accessibilityLabel={point.title}
                onPress={() => onMarkerPress?.(point)}
                style={[styles.staticPin, { left: p.x - 13, top: p.y - 26 }]}
              >
                <View
                  style={[
                    point.premium ? styles.staticPremiumPin : styles.staticPinBody,
                    point.premium
                      ? {
                          backgroundColor: PREMIUM_MARKER.background,
                          borderColor: point.color ?? PREMIUM_MARKER.border,
                        }
                      : { backgroundColor: point.color ?? toneColor(theme, markerTone(point.kind)) },
                  ]}
                >
                  <AppText
                    variant="caption"
                    style={
                      point.premium
                        ? { ...styles.staticPinText, color: point.textColor ?? PREMIUM_MARKER.text }
                        : styles.staticPinText
                    }
                  >
                    {point.kind === 'cluster' ? String(point.count ?? '') : (point.label ?? '•')}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
          <LinearGradient
            colors={['transparent', 'rgba(4,8,18,0.55)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </>
      ) : (
        <LinearGradient
          colors={theme.scheme === 'dark' ? ['#0B1220', '#152445', '#1B1A3A'] : ['#EAF1FF', '#DDE9FF', '#EAE4FF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}

      <View style={styles.centerWrap} pointerEvents="none">
        <View
          style={[
            styles.badge,
            {
              backgroundColor: theme.scheme === 'dark' ? 'rgba(9,14,28,0.82)' : 'rgba(255,255,255,0.92)',
              borderColor: theme.colors.border,
            },
          ]}
        >
          <Ionicons
            name={url ? 'image-outline' : 'map-outline'}
            size={15}
            color={theme.colors.primaryDeep}
          />
          <AppText variant="caption" color="textSecondary" style={styles.message}>
            {message}
          </AppText>
        </View>
      </View>

      {showProvider ? (
        <View style={styles.providerWrap} pointerEvents="none">
          <AppText variant="caption" style={[styles.provider, { color: 'rgba(255,255,255,0.72)' }]}>
            {provider.label} · {provider.detail}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: '#0B1220' },
  centerWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 340,
  },
  message: { flexShrink: 1 },
  providerWrap: { position: 'absolute', left: 12, top: 10 },
  provider: { fontSize: 9, letterSpacing: 0.4 },
  staticPin: { position: 'absolute', alignItems: 'center' },
  staticPinBody: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  staticPinText: { color: '#FFFFFF', fontSize: 10 },
  staticPremiumPin: {
    minWidth: 40,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
