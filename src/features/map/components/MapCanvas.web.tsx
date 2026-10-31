import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { hasMapboxToken, staticMapUrl } from '../services/map-service';
import type { MapCamera } from '../types';
import { clamp, projectToPixels } from '../utils/geo';
import { PREMIUM_MARKER, markerTone, toneColor } from '../utils/map-theme';
import { MapCanvasFallback } from './MapCanvasFallback';
import type { MapCanvasProps } from './map-canvas-types';

/**
 * Web: native harita motoru yok. Mapbox Static Images API ile gerçek harita
 * karoları gösterilir; işaretler mercator projeksiyonuyla yerleştirilir.
 * Yakınlaştırma düğmeleri çalışır, serbest kaydırma yoktur — bu sınırlama
 * arayüzde açıkça belirtilir.
 */
export function MapCanvas({
  initialCamera,
  focus,
  markers,
  route,
  polygon,
  userLocation,
  dark,
  preview = false,
  onMarkerPress,
  onCameraChange,
}: MapCanvasProps) {
  const { theme } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Web'de kamera kontrol edilen state'tir: odak, arama ve zoom aynı kaynaktan
  // gelir. `focus` geldiğinde kamera taşınır; ekranlar da bu sayede işarete
  // veya sonuç kümesine odaklanabilir.
  const [camera, setCamera] = useState<MapCamera>(initialCamera);

  useEffect(() => {
    // Kamera, çağıran ekranın verdiği başlangıç kamerasıyla eşitlenir.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCamera((current) =>
      current.lat === initialCamera.lat &&
      current.lng === initialCamera.lng &&
      current.zoom === initialCamera.zoom
        ? current
        : initialCamera,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCamera.lat, initialCamera.lng, initialCamera.zoom]);

  useEffect(() => {
    if (!focus) {
      return;
    }
    // Yalnızca programatik odak isteklerinde kamera taşınır.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCamera(focus.camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const url = useMemo(() => {
    if (!hasMapboxToken() || size.width < 20) {
      return null;
    }
    return staticMapUrl({
      center: { lat: camera.lat, lng: camera.lng },
      zoom: camera.zoom,
      width: size.width,
      height: Math.max(size.height, 240),
      dark,
      route: route ?? undefined,
    });
  }, [camera.lat, camera.lng, camera.zoom, dark, route, size.height, size.width]);

  if (!hasMapboxToken()) {
    return (
      <MapCanvasFallback
        camera={camera}
        markers={markers}
        message="Web haritası için Mapbox anahtarı gerekli."
        onMarkerPress={onMarkerPress}
      />
    );
  }

  const zoomBy = (delta: number) => {
    const next = {
      lat: camera.lat,
      lng: camera.lng,
      zoom: clamp(camera.zoom + delta, 3, 18),
    };
    setCamera(next);
    onCameraChange(next);
  };

  const polygonPoints =
    polygon && polygon.length >= 3 && size.width > 20
      ? polygon
          .map((point) => {
            const position = projectToPixels(point, camera, size);
            return `${position.x},${position.y}`;
          })
          .join(' ')
      : null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(event) =>
        setSize({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        })
      }
    >
      {url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
      ) : null}

      {polygonPoints ? (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Polygon
            points={polygonPoints}
            fill={theme.colors.primary}
            fillOpacity={0.16}
            stroke={theme.colors.primary}
            strokeWidth={2.5}
            strokeDasharray="6 5"
          />
        </Svg>
      ) : null}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Mapbox ve OpenStreetMap telif bilgisi"
        onPress={() => void Linking.openURL('https://www.mapbox.com/about/maps/')}
        style={styles.attribution}
      >
        <AppText variant="caption" style={styles.attributionText}>
          © Mapbox © OpenStreetMap
        </AppText>
      </Pressable>

      {markers.slice(0, 120).map((point) => {
        if (size.width < 20) {
          return null;
        }
        const position = projectToPixels(point, camera, size);
        if (
          position.x < -24 ||
          position.y < -24 ||
          position.x > size.width + 24 ||
          position.y > size.height + 24
        ) {
          return null;
        }
        // Premium işaret (otel/tesis): altın çerçeveli koyu kart, ikon + etiket.
        if (point.premium) {
          return (
            <Pressable
              key={point.id}
              accessibilityRole="button"
              accessibilityLabel={`${point.title}${point.label ? `, ${point.label}` : ''}`}
              onPress={() => onMarkerPress(point)}
              style={[styles.premiumWrap, { left: position.x - 44, top: position.y - 46 }]}
            >
              <View
                style={[
                  styles.premiumPin,
                  {
                    backgroundColor: PREMIUM_MARKER.background,
                    borderColor: point.color ?? PREMIUM_MARKER.border,
                  },
                ]}
              >
                <View style={[styles.premiumIconWrap, { backgroundColor: PREMIUM_MARKER.iconBackground }]}>
                  <Ionicons
                    name={(point.icon as never) ?? 'bed'}
                    size={12}
                    color={PREMIUM_MARKER.iconColor}
                  />
                </View>
                <AppText
                  variant="caption"
                  numberOfLines={1}
                  style={[
                    styles.premiumLabel,
                    { color: point.textColor ?? PREMIUM_MARKER.text },
                  ]}
                >
                  {point.label ?? point.title}
                </AppText>
              </View>
              <View
                style={[
                  styles.premiumTip,
                  { backgroundColor: point.color ?? PREMIUM_MARKER.border },
                ]}
              />
            </Pressable>
          );
        }
        return (
          <Pressable
            key={point.id}
            accessibilityRole="button"
            accessibilityLabel={point.title}
            onPress={() => onMarkerPress(point)}
            style={[styles.pin, { left: position.x - 15, top: position.y - 30 }]}
          >
            <View
              style={[
                styles.pinBody,
                point.label ? styles.pinBodyWide : null,
                {
                  backgroundColor: point.color ?? theme.colors.surface,
                  borderColor: point.color ?? toneColor(theme, markerTone(point.kind)),
                },
              ]}
            >
              <AppText
                variant="caption"
                style={{
                  color: point.color ? (point.textColor ?? '#FFFFFF') : toneColor(theme, markerTone(point.kind)),
                  fontSize: 9,
                }}
                numberOfLines={1}
              >
                {point.kind === 'cluster' ? String(point.count ?? '') : (point.label ?? '•')}
              </AppText>
            </View>
          </Pressable>
        );
      })}

      {userLocation ? (
        <View
          style={[
            styles.self,
            {
              left: projectToPixels(userLocation, camera, size).x - 8,
              top: projectToPixels(userLocation, camera, size).y - 8,
              backgroundColor: theme.colors.info,
            },
          ]}
        />
      ) : null}

      {!preview ? (
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yakınlaştır"
            onPress={() => zoomBy(1)}
            style={[styles.control, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          >
            <Ionicons name="add" size={18} color={theme.colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Uzaklaştır"
            onPress={() => zoomBy(-1)}
            style={[styles.control, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          >
            <Ionicons name="remove" size={18} color={theme.colors.text} />
          </Pressable>
        </View>
      ) : null}

      {!preview ? (
        <View style={styles.noteWrap} pointerEvents="none">
          <AppText variant="caption" style={styles.note}>
            Web önizleme · Mapbox · Serbest kaydırma mobil uygulamada
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { position: 'absolute' },
  pinBody: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBodyWide: { width: 54, height: 26, borderRadius: 8 },
  premiumWrap: { position: 'absolute', width: 88, alignItems: 'center' },
  premiumPin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    maxWidth: 88,
    paddingHorizontal: 7,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  premiumIconWrap: {
    width: 18,
    height: 18,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumLabel: { fontSize: 10.5, fontWeight: '700' },
  premiumTip: {
    width: 8,
    height: 8,
    marginTop: -4,
    transform: [{ rotate: '45deg' }],
    borderRadius: 1.5,
  },
  self: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#FFFFFF' },
  controls: { position: 'absolute', right: 12, top: 64, gap: 8 },
  control: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteWrap: { position: 'absolute', left: 12, top: 10 },
  note: { color: 'rgba(255,255,255,0.72)', fontSize: 9 },
  attribution: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(15,23,42,0.62)',
  },
  attributionText: { color: '#FFFFFF', fontSize: 9 },
});
