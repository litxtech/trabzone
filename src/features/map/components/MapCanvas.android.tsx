import { Ionicons } from '@expo/vector-icons';
import { env } from '@/config/env';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import type MapboxGL from '@rnmapbox/maps';
import { useEffect, useMemo, useRef } from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';

import { MAP_KIND_ICON } from '../constants';
import type { MapPoint } from '../types';
import { initialsFor, markerTone, toneColor, toneSoftColor } from '../utils/map-theme';
import { MapCanvasFallback } from './MapCanvasFallback';
import type { MapCanvasProps } from './map-canvas-types';

type MapboxModule = typeof MapboxGL;

type CameraHandle = {
  setCamera: (config: {
    centerCoordinate: [number, number];
    zoomLevel: number;
    animationDuration?: number;
  }) => void;
};

/**
 * Android harita motoru: Mapbox v11.
 *
 * `@rnmapbox/maps` native modülü yeni bir yerel derleme gerektirir. Modül yoksa
 * (eski dev-client) ekran çökmez; token varsa statik Mapbox önizlemesi gösterilir.
 */
let Mapbox: MapboxModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Mapbox = require('@rnmapbox/maps') as MapboxModule;
  if (Mapbox && env.mapboxToken) {
    Mapbox.setAccessToken(env.mapboxToken);
  }
} catch {
  Mapbox = null;
}

export function MapCanvas({
  initialCamera,
  focus,
  markers,
  route,
  polygon,
  userLocation,
  dark,
  interactive = true,
  onMarkerPress,
  onCameraChange,
  onMapPress,
}: MapCanvasProps) {
  const { theme } = useTheme();
  const cameraRef = useRef<CameraHandle | null>(null);

  useEffect(() => {
    if (!focus) {
      return;
    }
    cameraRef.current?.setCamera({
      centerCoordinate: [focus.camera.lng, focus.camera.lat],
      zoomLevel: focus.camera.zoom,
      animationDuration: 480,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const routeShape = useMemo(() => {
    if (!route || route.length < 2) {
      return null;
    }
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: route.map((point) => [point.lng, point.lat]),
      },
    };
  }, [route]);

  const polygonShape = useMemo(() => {
    if (!polygon || polygon.length < 3) {
      return null;
    }
    const ring = polygon.map((point) => [point.lng, point.lat]);
    const first = ring[0];
    if (first && (first[0] !== ring[ring.length - 1]?.[0] || first[1] !== ring[ring.length - 1]?.[1])) {
      ring.push(first);
    }
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [ring] },
    };
  }, [polygon]);

  if (!Mapbox) {
    return (
      <MapCanvasFallback
        camera={initialCamera}
        markers={markers}
        message="Mapbox modülü bu derlemede yok. Güncel bir Android geliştirme derlemesi gerekiyor."
      />
    );
  }

  if (!env.mapboxToken) {
    return (
      <MapCanvasFallback
        camera={initialCamera}
        markers={markers}
        message="Mapbox anahtarı tanımlı değil. EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN eklenip uygulama yeniden derlenmeli."
      />
    );
  }

  const M = Mapbox;

  return (
    <M.MapView
      style={StyleSheet.absoluteFill}
      styleURL={dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11'}
      logoEnabled
      logoPosition={{ top: 10, left: 10 }}
      attributionEnabled
      attributionPosition={{ top: 44, left: 10 }}
      compassEnabled={false}
      scaleBarEnabled={false}
      pitchEnabled={false}
      rotateEnabled
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      localizeLabels={{ locale: 'tr' }}
      onCameraChanged={(state) => {
        const center = state.properties.center as number[];
        const lng = center[0];
        const lat = center[1];
        if (lat == null || lng == null) {
          return;
        }
        onCameraChange({ lat, lng, zoom: state.properties.zoom });
      }}
      onPress={(feature) => {
        const coordinates = (feature as { geometry?: { coordinates?: number[] } }).geometry?.coordinates;
        if (coordinates && coordinates.length >= 2) {
          const lng = coordinates[0];
          const lat = coordinates[1];
          if (lat != null && lng != null) {
            onMapPress?.({ lat, lng });
          }
        }
      }}
    >
      <M.Camera
        ref={cameraRef as never}
        defaultSettings={{
          centerCoordinate: [initialCamera.lng, initialCamera.lat],
          zoomLevel: initialCamera.zoom,
        }}
      />

      {userLocation ? (
        <M.MarkerView
          id="self"
          coordinate={[userLocation.lng, userLocation.lat]}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={[styles.selfDot, { borderColor: '#FFFFFF' }]}>
            <View style={[styles.selfDotInner, { backgroundColor: theme.colors.info }]} />
          </View>
        </M.MarkerView>
      ) : null}

      {routeShape ? (
        <M.ShapeSource id="map-route" shape={routeShape as never}>
          <M.LineLayer
            id="map-route-line"
            style={{
              lineColor: theme.colors.primary,
              lineWidth: 4.5,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </M.ShapeSource>
      ) : null}

      {polygonShape ? (
        <M.ShapeSource id="explore-area" shape={polygonShape as never}>
          <M.FillLayer
            id="explore-area-fill"
            style={{
              fillColor: theme.colors.primary,
              fillOpacity: 0.16,
            }}
          />
          <M.LineLayer
            id="explore-area-line"
            style={{
              lineColor: theme.colors.primary,
              lineWidth: 2.5,
              lineDasharray: [2, 1.4],
            }}
          />
        </M.ShapeSource>
      ) : null}

      {markers.map((point) => (
        <Marker
          key={point.id}
          point={point}
          themeDark={dark}
          onPress={() => onMarkerPress(point)}
        />
      ))}
    </M.MapView>
  );
}

function Marker({
  point,
  onPress,
  themeDark,
}: {
  point: MapPoint;
  onPress: () => void;
  themeDark: boolean;
}) {
  const { theme } = useTheme();
  const tone = point.tone ?? markerTone(point.kind);
  const avatar = point.avatarUrl ?? mediaPublicUrl('avatar', point.avatarPath);

  if (point.kind === 'cluster') {
    return (
      <MapboxMarker id={point.id} coordinate={[point.lng, point.lat]} anchor={{ x: 0.5, y: 0.5 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={point.title}
          onPress={onPress}
          style={[
            styles.cluster,
            {
              backgroundColor: theme.colors.primary,
              borderColor: themeDark ? '#0B1220' : '#FFFFFF',
            },
          ]}
        >
          <AppText variant="label" style={styles.clusterText}>
            {point.count ?? ''}
          </AppText>
        </Pressable>
      </MapboxMarker>
    );
  }

  if (point.kind === 'friend') {
    return (
      <MapboxMarker id={point.id} coordinate={[point.lng, point.lat]} anchor={{ x: 0.5, y: 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={point.title}
          onPress={onPress}
          style={styles.friendWrap}
        >
          <View
            style={[
              styles.friendRing,
              { borderColor: toneColor(theme, tone), backgroundColor: themeDark ? '#0B1220' : '#FFFFFF' },
            ]}
          >
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.friendAvatar} contentFit="cover" />
            ) : (
              <AppText variant="caption" style={{ color: theme.colors.primaryDeep, fontSize: 10 }}>
                {initialsFor(point.title)}
              </AppText>
            )}
          </View>
          <View style={[styles.friendTip, { borderTopColor: themeDark ? '#0B1220' : '#FFFFFF' }]} />
        </Pressable>
      </MapboxMarker>
    );
  }

  if (point.label) {
    return (
      <MapboxMarker id={point.id} coordinate={[point.lng, point.lat]} anchor={{ x: 0.5, y: 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${point.title}, ${point.label}`}
          onPress={onPress}
          style={styles.pinWrap}
        >
          <View
            style={[
              styles.pricePin,
              {
                backgroundColor: theme.colors.surface,
                borderColor: point.tone ? toneColor(theme, tone) : theme.colors.primary,
              },
            ]}
          >
            <AppText variant="label" style={{ color: theme.colors.primaryDeep, fontSize: 11 }}>
              {point.label}
            </AppText>
          </View>
          <View
            style={[
              styles.priceTip,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary },
            ]}
          />
        </Pressable>
      </MapboxMarker>
    );
  }

  return (
    <MapboxMarker id={point.id} coordinate={[point.lng, point.lat]} anchor={{ x: 0.5, y: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={point.title}
        onPress={onPress}
        style={styles.pinWrap}
      >
        <View
          style={[
            styles.pin,
            {
              backgroundColor: theme.colors.surface,
              borderColor: toneColor(theme, tone),
            },
          ]}
        >
          <View style={[styles.pinInner, { backgroundColor: toneSoftColor(theme, tone) }]}>
            <IconFor kind={point.kind} icon={point.icon} color={toneColor(theme, tone)} />
          </View>
        </View>
        <View
          style={[
            styles.pinTip,
            {
              backgroundColor: theme.colors.surface,
              borderColor: toneColor(theme, tone),
            },
          ]}
        />
      </Pressable>
    </MapboxMarker>
  );
}

/** `Mapbox.MarkerView` yalnızca native modül varken çağrılır. */
function MapboxMarker({
  id,
  coordinate,
  anchor,
  children,
}: {
  id: string;
  coordinate: [number, number];
  anchor: { x: number; y: number };
  children: React.ReactElement;
}) {
  if (!Mapbox) {
    return null;
  }
  return (
    <Mapbox.MarkerView id={id} coordinate={coordinate} anchor={anchor}>
      {children}
    </Mapbox.MarkerView>
  );
}

function IconFor({
  kind,
  icon,
  color,
}: {
  kind: Exclude<MapPoint['kind'], 'cluster' | 'friend'>;
  icon?: string | null;
  color: string;
}) {
  const name = (icon as keyof typeof Ionicons.glyphMap | undefined) ?? MAP_KIND_ICON[kind];
  return <Ionicons name={name} size={14} color={color} />;
}

const styles = StyleSheet.create({
  selfDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56,189,248,0.25)',
  },
  selfDotInner: { width: 8, height: 8, borderRadius: 4 },
  cluster: {
    minWidth: 38,
    height: 38,
    paddingHorizontal: 8,
    borderRadius: 19,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterText: { color: '#FFFFFF', fontSize: 13 },
  friendWrap: { alignItems: 'center' },
  friendRing: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  friendAvatar: { width: 37, height: 37, borderRadius: 18.5 },
  friendTip: { borderTopWidth: 7, borderLeftWidth: 6, borderRightWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  pinWrap: { alignItems: 'center' },
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinInner: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pricePin: {
    minWidth: 52,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceTip: {
    width: 8,
    height: 8,
    marginTop: -5,
    transform: [{ rotate: '45deg' }],
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
  pinTip: {
    width: 9,
    height: 9,
    marginTop: -5,
    transform: [{ rotate: '45deg' }],
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
});
