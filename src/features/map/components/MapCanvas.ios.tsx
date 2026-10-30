import { useTheme } from '@/theme/ThemeProvider';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MapPointKind } from '../types';
import { initialsFor, markerTone, toneColor } from '../utils/map-theme';
import { MapCanvasFallback } from './MapCanvasFallback';
import type { MapCanvasProps } from './map-canvas-types';

type ExpoMapsModule = typeof import('expo-maps');

type AppleMapHandle = import('expo-maps').AppleMaps.MapView;

/**
 * iOS harita motoru: native Apple Maps (MapKit).
 *
 * Native modül eski bir dev-client derlemesinde yoksa uygulama çökmez; dürüst
 * bir geri dönüş ekranı gösterilir.
 */
let expoMaps: ExpoMapsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  expoMaps = require('expo-maps') as ExpoMapsModule;
} catch {
  expoMaps = null;
}

const SF_SYMBOL: Record<Exclude<MapPointKind, 'cluster'>, string> = {
  friend: 'person.fill',
  ride_offer: 'car.fill',
  ride_request: 'figure.walk',
  event: 'calendar',
  place: 'mappin.circle.fill',
  real_estate: 'house.fill',
  live: 'dot.radiowaves.left.and.right',
  reel: 'play.rectangle.fill',
  story: 'circle.dashed',
  help: 'questionmark.circle.fill',
};

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
  const AppleMaps = expoMaps?.AppleMaps;
  const mapRef = useRef<AppleMapHandle | null>(null);
  // `initialCamera` her karede değişebilir; MapKit'e verilen başlangıç kamerası
  // sabit kalmalı, aksi halde kullanıcı kaydırırken harita geri sıçrar.
  // Açılışta gelen odak (derin bağlantı vb.) doğrudan başlangıç kamerası olur:
  // ilk karede native görünüm henüz kayıtlı olmadığından `setCameraPosition`
  // "Unable to find the 'AppleMapsViewWrapper' view" hatasıyla reddedilir.
  const [baseCamera] = useState(focus?.camera ?? initialCamera);
  const appliedNonce = useRef(focus?.nonce);

  useEffect(() => {
    if (!focus || !mapRef.current || appliedNonce.current === focus.nonce) {
      return;
    }
    appliedNonce.current = focus.nonce;
    const nonce = focus.nonce;
    const position = {
      coordinates: { latitude: focus.camera.lat, longitude: focus.camera.lng },
      zoom: focus.camera.zoom,
    };
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Native görünüm açılıştan hemen sonra henüz kayıtlı olmayabilir; MapKit
    // promise'i reddederse bir kez daha denenir, sökülmüşse vazgeçilir.
    mapRef.current.setCameraPosition(position).catch(() => {
      retry = setTimeout(() => {
        if (appliedNonce.current === nonce) {
          mapRef.current?.setCameraPosition(position).catch(() => {});
        }
      }, 300);
    });
    return () => clearTimeout(retry);
    // Yalnızca programatik odak isteklerinde kamera taşınır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const appleMarkers = useMemo(
    () =>
      markers.map((point) => {
        const tone = markerTone(point.kind);
        const color = point.color ?? toneColor(theme, tone);
        if (point.kind === 'cluster') {
          return {
            id: point.id,
            coordinates: { latitude: point.lat, longitude: point.lng },
            title: point.title,
            monogram: String(point.count ?? ''),
            tintColor: color,
          };
        }
        if (point.label) {
          return {
            id: point.id,
            coordinates: { latitude: point.lat, longitude: point.lng },
            title: `${point.title} · ${point.label}`,
            monogram: point.label,
            tintColor: color,
          };
        }
        if (point.kind === 'friend') {
          return {
            id: point.id,
            coordinates: { latitude: point.lat, longitude: point.lng },
            title: point.title,
            monogram: initialsFor(point.title),
            tintColor: color,
          };
        }
        return {
          id: point.id,
          coordinates: { latitude: point.lat, longitude: point.lng },
          title: point.title,
          systemImage: SF_SYMBOL[point.kind],
          tintColor: color,
        };
      }),
    [markers, theme],
  );

  const polylines = useMemo(() => {
    if (!route || route.length < 2) {
      return [];
    }
    return [
      {
        id: 'route',
        coordinates: route.map((point) => ({ latitude: point.lat, longitude: point.lng })),
        color: theme.colors.primary,
        width: 4,
      },
    ];
  }, [route, theme.colors.primary]);

  const polygons = useMemo(() => {
    if (!polygon || polygon.length < 3) {
      return [];
    }
    return [
      {
        id: 'explore-area',
        coordinates: polygon.map((point) => ({ latitude: point.lat, longitude: point.lng })),
        color: `${theme.colors.primary}26`,
        lineColor: theme.colors.primary,
        lineWidth: 2.5,
      },
    ];
  }, [polygon, theme.colors.primary]);

  const userMarker = useMemo(() => {
    if (!userLocation) {
      return [];
    }
    return [
      {
        id: 'self',
        coordinates: { latitude: userLocation.lat, longitude: userLocation.lng },
        title: 'Konumun',
        systemImage: 'location.fill',
        tintColor: theme.colors.info,
      },
    ];
  }, [theme.colors.info, userLocation]);

  if (!AppleMaps) {
    return (
      <MapCanvasFallback
        camera={baseCamera}
        markers={markers}
        message="Apple Maps modülü bu derlemede yok. Güncel bir iOS geliştirme derlemesi gerekiyor."
      />
    );
  }

  if (!interactive) {
    return (
      <MapCanvasFallback
        camera={baseCamera}
        markers={markers}
        message="Harita önizlemesi"
      />
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <AppleMaps.View
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        colorScheme={dark ? AppleMaps.MapColorScheme.DARK : AppleMaps.MapColorScheme.LIGHT}
        cameraPosition={{
          coordinates: { latitude: baseCamera.lat, longitude: baseCamera.lng },
          zoom: baseCamera.zoom,
        }}
        markers={[...appleMarkers, ...userMarker]}
        polylines={polylines}
        polygons={polygons}
        properties={{
          mapType: AppleMaps.MapType.STANDARD,
          selectionEnabled: false,
        }}
        uiSettings={{
          compassEnabled: false,
          myLocationButtonEnabled: false,
          scaleBarEnabled: false,
          togglePitchEnabled: false,
        }}
        onMarkerClick={(marker) => {
          const found = markers.find((point) => point.id === marker.id);
          if (found) {
            onMarkerPress(found);
          }
        }}
        onMapClick={(event) => {
          const lat = event.coordinates.latitude;
          const lng = event.coordinates.longitude;
          if (lat != null && lng != null) {
            onMapPress?.({ lat, lng });
          }
        }}
        onCameraMove={(event) => {
          const lat = event.coordinates.latitude;
          const lng = event.coordinates.longitude;
          if (lat == null || lng == null) {
            return;
          }
          onCameraChange({ lat, lng, zoom: event.zoom });
        }}
      />
    </View>
  );
}
