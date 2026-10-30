import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import type { LatLng, MapCamera, MapPoint } from '@/features/map/types';
import { useTheme } from '@/theme/ThemeProvider';

import type { EarthquakePoint } from '../types';
import { formatAgo, formatDepth, formatDistance, formatLocalDateTime, formatMagnitude, formatDecimal } from '../utils/format';
import { ageOpacity, magnitudeColor, magnitudeTextColor } from '../utils/scale';

/** Ekranda aynı anda çizilecek tekil işaret üst sınırı (native işaretler pahalıdır). */
const MAX_SINGLE_MARKERS = 250;
/** Küme hücresi (ekran pikseli). */
const CLUSTER_CELL_PX = 46;

function alphaHex(opacity: number): string {
  return Math.round(Math.min(Math.max(opacity, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/** Yakınlaştırma düzeyine göre ızgara kümeleme; büyük olaylar kümeye girmez. */
function buildMarkers(points: EarthquakePoint[], zoom: number, clusters: boolean, now: number): MapPoint[] {
  const degPerPx = 360 / (256 * 2 ** zoom);
  const cell = CLUSTER_CELL_PX * degPerPx;
  const singles: EarthquakePoint[] = [];
  const buckets = new Map<string, EarthquakePoint[]>();

  for (const point of points) {
    if (!clusters || point.magnitude >= 4 || zoom >= 10) {
      singles.push(point);
      continue;
    }
    const key = `${Math.floor(point.lat / cell)}:${Math.floor(point.lng / cell)}`;
    const list = buckets.get(key);
    if (list) list.push(point);
    else buckets.set(key, [point]);
  }

  const markers: MapPoint[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 3) {
      singles.push(...list);
      continue;
    }
    const lat = list.reduce((sum, p) => sum + p.lat, 0) / list.length;
    const lng = list.reduce((sum, p) => sum + p.lng, 0) / list.length;
    const max = list.reduce((best, p) => (p.magnitude > best ? p.magnitude : best), -Infinity);
    markers.push({
      id: `cluster:${key}`,
      kind: 'cluster',
      lat,
      lng,
      count: list.length,
      title: `${list.length} deprem · en büyük ${formatDecimal(max, 1)}`,
      color: magnitudeColor(max),
      meta: { ids: list.map((p) => p.id) },
    });
  }

  singles
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, MAX_SINGLE_MARKERS)
    .forEach((point) => {
      const opacity = ageOpacity(point.occurredAt, now);
      markers.push({
        id: point.id,
        kind: 'place',
        lat: point.lat,
        lng: point.lng,
        title: `${formatMagnitude(point.magnitude, point.magnitudeType)} · ${point.location ?? ''}`.trim(),
        subtitle: formatLocalDateTime(point.occurredAt),
        label: formatDecimal(point.magnitude, 1),
        color: `${magnitudeColor(point.magnitude)}${alphaHex(opacity)}`,
        textColor: magnitudeTextColor(point.magnitude),
        updatedAt: point.occurredAt,
      });
    });

  return markers;
}

export type EarthquakeMapPanelProps = {
  points: EarthquakePoint[];
  center: LatLng;
  zoom: number;
  ring: LatLng[] | null;
  clusters?: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  height?: number;
  /** Değiştiğinde harita bu noktaya odaklanır. */
  focusPoint?: { lat: number; lng: number; nonce: number } | null;
  loading?: boolean;
  truncated?: boolean;
  total?: number;
};

export function EarthquakeMapPanel({
  points,
  center,
  zoom,
  ring,
  clusters = true,
  selectedId,
  onSelect,
  onOpen,
  height = 320,
  focusPoint,
  loading,
  truncated,
  total,
}: EarthquakeMapPanelProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [camera, setCamera] = useState<MapCamera>({ lat: center.lat, lng: center.lng, zoom });
  const [focus, setFocus] = useState<{ camera: MapCamera; nonce: number } | null>(null);
  const [now] = useState(() => Date.now());

  const moveTo = (next: MapCamera) => {
    setCamera(next);
    setFocus((previous) => ({ camera: next, nonce: (previous?.nonce ?? 0) + 1 }));
  };

  // Bölge merkezi veya dışarıdan odak isteği değiştiğinde kamera render sırasında güncellenir.
  const centerKey = `${center.lat}:${center.lng}:${zoom}`;
  const [syncedCenter, setSyncedCenter] = useState(centerKey);
  if (syncedCenter !== centerKey) {
    setSyncedCenter(centerKey);
    moveTo({ lat: center.lat, lng: center.lng, zoom });
  }
  const focusKey = focusPoint?.nonce ?? null;
  const [syncedFocus, setSyncedFocus] = useState(focusKey);
  if (syncedFocus !== focusKey) {
    setSyncedFocus(focusKey);
    if (focusPoint) moveTo({ lat: focusPoint.lat, lng: focusPoint.lng, zoom: Math.max(camera.zoom, 9) });
  }

  const zoomBucket = Math.round(camera.zoom * 2) / 2;
  const markers = useMemo(() => buildMarkers(points, zoomBucket, clusters, now), [points, zoomBucket, clusters, now]);
  const selected = selectedId ? points.find((point) => point.id === selectedId) ?? null : null;

  const onMarkerPress = (marker: MapPoint) => {
    if (marker.kind === 'cluster') {
      moveTo({ lat: marker.lat, lng: marker.lng, zoom: Math.min(camera.zoom + 2, 12) });
      return;
    }
    onSelect(marker.id);
  };

  // Harita satır içi ile tam ekran arasında yeniden kurulur; yeni örnek eski
  // odak isteğini değil, kullanıcının bıraktığı kamerayı başlangıç alır.
  const toggleExpanded = () => {
    setFocus(null);
    setExpanded((value) => !value);
  };

  const content = (
    <>
      <MapCanvas
        initialCamera={camera}
        focus={focus}
        markers={markers}
        polygon={ring}
        dark={theme.scheme === 'dark'}
        onMarkerPress={onMarkerPress}
        onCameraChange={(next) => setCamera(next)}
        onMapPress={() => onSelect(null)}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Haritayı küçült' : 'Haritayı büyüt'}
        hitSlop={8}
        onPress={toggleExpanded}
        style={[
          styles.toggle,
          { top: expanded ? insets.top + 10 : 10 },
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        <Ionicons name={expanded ? 'contract' : 'expand'} size={18} color={theme.colors.text} />
      </Pressable>

      {loading ? (
        <View
          style={[styles.badge, { top: expanded ? insets.top + 10 : 10 }, { backgroundColor: theme.colors.surface }]}
          pointerEvents="none"
        >
          <AppText variant="caption" color="textSecondary">
            Yükleniyor…
          </AppText>
        </View>
      ) : truncated ? (
        <View
          style={[styles.badge, { top: expanded ? insets.top + 10 : 10 }, { backgroundColor: theme.colors.surface }]}
          pointerEvents="none"
        >
          <AppText variant="caption" color="textSecondary">
            En büyük {points.length} / {total ?? points.length} kayıt gösteriliyor
          </AppText>
        </View>
      ) : null}

      {selected ? (
        <View
          style={[
            styles.card,
            { bottom: expanded ? insets.bottom + 10 : 10 },
            { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderColor: theme.colors.border },
          ]}
        >
          <View style={[styles.cardMag, { backgroundColor: magnitudeColor(selected.magnitude) }]}>
            <AppText variant="title" color={magnitudeTextColor(selected.magnitude)}>
              {formatDecimal(selected.magnitude, 1)}
            </AppText>
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {selected.location ?? 'Konum bilgisi yok'}
            </AppText>
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {formatLocalDateTime(selected.occurredAt, true)} · {formatAgo(selected.occurredAt)}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {formatMagnitude(selected.magnitude, selected.magnitudeType)} · Derinlik {formatDepth(selected.depthKm)} ·
              Trabzon&apos;a {formatDistance(selected.distanceKm)}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Deprem ayrıntılarını aç"
            onPress={() => {
              // Modal açıkken gezinilirse ayrıntı sayfası modalın arkasında kalır.
              setExpanded(false);
              onOpen(selected.id);
            }}
            style={[styles.cardAction, { backgroundColor: theme.colors.primarySoft }]}
          >
            <Ionicons name="arrow-forward" size={18} color={theme.colors.primaryDeep} />
          </Pressable>
        </View>
      ) : null}
    </>
  );

  return (
    <View style={[styles.wrap, { height, borderRadius: theme.radius.lg, borderColor: theme.colors.border }]}>
      {/* Aynı anda iki native harita kurulmaz; büyütülmüşken satır içi alan boş kalır. */}
      {expanded ? null : content}
      <Modal
        visible={expanded}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={toggleExpanded}
      >
        <View style={[styles.fullscreen, { backgroundColor: theme.colors.background }]}>
          {expanded ? content : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
  fullscreen: { flex: 1 },
  toggle: {
    position: 'absolute',
    right: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  card: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardMag: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardAction: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
