import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { projectMercator, unprojectMercator } from '@/features/map/utils/geo';
import type { MapCamera } from '@/features/map/types';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import type { LatLng } from '../types';

type Pixel = { x: number; y: number };

type Props = {
  enabled: boolean;
  camera: MapCamera;
  /** Her yeni noktada güncellenir; ekran "Tamamla" için bu listeyi kullanır. */
  onChange: (points: LatLng[]) => void;
  /** Dışarıdan temizleme sinyali. */
  clearSignal: number;
  /** Son noktayı kaldırma sinyali. */
  undoSignal: number;
};

/**
 * Haritanın üzerine gelen serbest çizim katmanı.
 *
 * Kamera çizim sırasında kilitli olduğu için ekran koordinatları, aynı
 * Mercator ölçeğiyle gerçek koordinatlara çevrilebilir. Böylece çizim hem
 * iOS hem Android'de aynı sonucu üretir ve sunucuya GeoJSON polygon gider.
 */
export function DrawingOverlay({ enabled, camera, onChange, clearSignal, undoSignal }: Props) {
  const { theme } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const pixelsRef = useRef<Pixel[]>([]);
  const undoRef = useRef(undoSignal);

  const toGeo = useCallback(
    (point: Pixel): LatLng | null => {
      if (size.width < 20 || size.height < 20) {
        return null;
      }
      const scale = 256 * 2 ** camera.zoom;
      const center = projectMercator({ lat: camera.lat, lng: camera.lng });
      const x = center.x + (point.x - size.width / 2) / scale;
      const y = center.y + (point.y - size.height / 2) / scale;
      return unprojectMercator(x, y);
    },
    [camera.lat, camera.lng, camera.zoom, size.height, size.width],
  );

  const emit = useCallback(
    (next: Pixel[]) => {
      pixelsRef.current = next;
      setPixels(next);
      onChange(next.map(toGeo).filter((value): value is LatLng => value != null));
    },
    [onChange, toGeo],
  );

  useEffect(() => {
    // Yalnızca dışarıdan gelen "temizle" sinyaliyle sıfırlanır.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    emit([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSignal]);

  useEffect(() => {
    if (undoRef.current === undoSignal) {
      return;
    }
    undoRef.current = undoSignal;
    emit(pixelsRef.current.slice(0, -1));
  }, [emit, undoSignal]);

  const addPoint = useCallback(
    (point: Pixel) => {
      const previous = pixelsRef.current[pixelsRef.current.length - 1];
      if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 5) {
        return;
      }
      emit([...pixelsRef.current, point].slice(-320));
    },
    [emit],
  );

  const panResponder = useMemo(
    () =>
      // Ref yalnızca jest geri çağrılarında okunur, render sırasında değil.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => enabled,
        onMoveShouldSetPanResponder: () => enabled,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          if (!enabled) return;
          haptics.tap();
          emit([]);
          addPoint({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY });
        },
        onPanResponderMove: (event) => {
          if (!enabled) return;
          addPoint({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY });
        },
      }),
    [addPoint, emit, enabled],
  );

  const points = pixels.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={enabled ? 'auto' : 'none'}
      onLayout={(event: LayoutChangeEvent) =>
        setSize({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        })
      }
      {...panResponder.panHandlers}
    >
      {pixels.length > 1 ? (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Polyline
            points={points}
            fill="rgba(37, 99, 235, 0.16)"
            stroke={theme.colors.primary}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="7 5"
          />
          <Circle
            cx={pixels[0]?.x}
            cy={pixels[0]?.y}
            r={5}
            fill={theme.colors.primary}
            stroke="#FFFFFF"
            strokeWidth={2}
          />
        </Svg>
      ) : null}
    </View>
  );
}
