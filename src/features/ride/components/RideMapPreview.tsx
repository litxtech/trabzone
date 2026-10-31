import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  fetchDrivingRouteCached,
  hasMapboxToken,
  staticMapUrl,
  type DrivingRoute,
  type LatLng,
} from '../services/map-service';
import { formatDistance, formatDuration } from '../utils/format';

type Props = {
  origin?: LatLng | null;
  dest?: LatLng | null;
  /** Ara duraklar; rota ve harita işaretleri buna göre çizilir. */
  waypoints?: LatLng[];
  /** Hazır geometri (canlı takip). Yoksa Directions API'den alınır. */
  geometry?: LatLng[];
  height?: number;
  label?: string;
  distanceMeters?: number | null;
  durationMinutes?: number | null;
};

type MapStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Yolculuk güzergâhı önizlemesi.
 *
 * - Koordinat varsa Mapbox Static Images API ile gerçek harita gösterilir.
 * - Directions API'den gerçek sürüş geometrisi alınır; başlangıç, varış ve
 *   varsa ara duraklar işaretlenir.
 * - `auto` yerleşimi sayesinde rota kareye otomatik sığar.
 * - Geometri alınamazsa düz çizgiyle harita yine görünür; kullanıcı
 *   "Rotayı yenile" ile tekrar deneyebilir.
 * - Anahtar veya koordinat yoksa boş beyaz alan yerine açıklamalı şema çizilir.
 */
export function RideMapPreview({
  origin,
  dest,
  waypoints = [],
  geometry,
  height = 170,
  label,
  distanceMeters,
  durationMinutes,
}: Props) {
  const { theme } = useTheme();
  const [routeState, setRouteState] = useState<{
    key: string;
    route: DrivingRoute | null;
    status: MapStatus;
  }>({ key: '', route: null, status: 'idle' });
  const [imageState, setImageState] = useState<{ url: string | null; status: MapStatus }>({
    url: null,
    status: 'idle',
  });
  const [attempt, setAttempt] = useState(0);

  const tokenReady = hasMapboxToken();
  const hasCoords = Boolean(
    origin &&
      dest &&
      Number.isFinite(origin.lat) &&
      Number.isFinite(origin.lng) &&
      Number.isFinite(dest.lat) &&
      Number.isFinite(dest.lng),
  );
  const cleanWaypoints = useMemo(
    () => waypoints.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)),
    [waypoints],
  );
  const waypointKey = cleanWaypoints
    .map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`)
    .join('|');

  // Hazır çok noktalı geometri verilmişse ağ isteği yapılmaz.
  const providedGeometry = geometry && geometry.length > 2 ? geometry : null;
  const requestKey = `${origin?.lat ?? ''},${origin?.lng ?? ''}|${dest?.lat ?? ''},${
    dest?.lng ?? ''
  }|${waypointKey}|${attempt}`;
  const currentRoute = routeState.key === requestKey ? routeState : null;
  const route = currentRoute?.route ?? null;
  const status: MapStatus =
    !hasCoords || !tokenReady
      ? 'idle'
      : providedGeometry
        ? 'ready'
        : currentRoute?.status === 'ready' || currentRoute?.status === 'error'
          ? currentRoute.status
          : 'loading';

  useEffect(() => {
    if (!origin || !dest || !tokenReady || !hasCoords || providedGeometry) {
      return;
    }
    let cancelled = false;
    void fetchDrivingRouteCached(origin, dest, cleanWaypoints, attempt > 0).then((result) => {
      if (cancelled) {
        return;
      }
      setRouteState({
        key: requestKey,
        route: result.ok ? result.data : null,
        status: result.ok ? 'ready' : 'error',
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dest?.lat,
    dest?.lng,
    hasCoords,
    origin?.lat,
    origin?.lng,
    providedGeometry,
    requestKey,
    tokenReady,
    waypointKey,
  ]);

  const url = useMemo(() => {
    if (!origin || !dest || !hasCoords || !tokenReady) {
      return null;
    }
    return staticMapUrl({
      origin,
      dest,
      waypoints: cleanWaypoints,
      geometry: providedGeometry ?? route?.geometry,
      width: 900,
      height: Math.max(Math.round(height * 2.4), 360),
      padding: 48,
      dark: theme.scheme === 'dark',
    });
  }, [cleanWaypoints, dest, hasCoords, height, origin, providedGeometry, route?.geometry, theme.scheme, tokenReady]);

  const imageStatus: MapStatus =
    url && imageState.url === url ? imageState.status : 'idle';
  const effectiveDistance = route?.distanceMeters ?? distanceMeters ?? null;
  const effectiveDuration = route?.durationMinutes ?? durationMinutes ?? null;
  const showFallback = !url || imageStatus === 'error';
  const retry = () => {
    setImageState({ url, status: 'idle' });
    setAttempt((value) => value + 1);
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          height,
          borderRadius: theme.radius.lg,
          borderColor: theme.colors.glassBorder,
        },
      ]}
    >
      {showFallback ? (
        <MapFallback
          height={height}
          hasCoords={hasCoords}
          hasToken={tokenReady}
          label={label}
          distanceMeters={effectiveDistance}
          durationMinutes={effectiveDuration}
          imageFailed={imageStatus === 'error'}
          onRetry={hasCoords && tokenReady ? retry : undefined}
        />
      ) : null}

      {url ? (
        <>
          <Image
            key={`ride-map-${attempt}`}
            source={{ uri: url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={220}
            cachePolicy="memory-disk"
            accessibilityLabel={label ? `${label} güzergâh haritası` : 'Yolculuk güzergâh haritası'}
            onLoadStart={() => setImageState({ url, status: 'loading' })}
            onLoad={() => setImageState({ url, status: 'ready' })}
            onError={() => setImageState({ url, status: 'error' })}
          />
          {imageStatus === 'loading' ? (
            <View style={styles.imageLoading} pointerEvents="none">
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : null}
        </>
      ) : null}

      {url && imageStatus !== 'error' ? (
        <>
          <LinearGradient
            colors={['transparent', 'rgba(4,8,18,0.82)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.caption}>
            <View style={styles.captionTop}>
              <Ionicons name="navigate" size={13} color="#8FB0FF" />
              <AppText variant="caption" style={styles.captionText} numberOfLines={1}>
                {label ?? 'Güzergâh'}
              </AppText>
            </View>
            <View style={styles.metricRow}>
              {status === 'loading' ? (
                <View style={styles.metricChip}>
                  <ActivityIndicator size="small" color="#DCE6FF" />
                  <AppText variant="caption" style={styles.metricText}>
                    Rota hesaplanıyor…
                  </AppText>
                </View>
              ) : (
                <>
                  {effectiveDistance ? (
                    <View style={styles.metricChip}>
                      <Ionicons name="speedometer-outline" size={11} color="#DCE6FF" />
                      <AppText variant="caption" style={styles.metricText}>
                        {formatDistance(effectiveDistance)}
                      </AppText>
                    </View>
                  ) : null}
                  {effectiveDuration ? (
                    <View style={styles.metricChip}>
                      <Ionicons name="time-outline" size={11} color="#DCE6FF" />
                      <AppText variant="caption" style={styles.metricText}>
                        {formatDuration(effectiveDuration)}
                      </AppText>
                    </View>
                  ) : null}
                  {status === 'error' ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Rotayı yeniden hesapla"
                      onPress={retry}
                      style={styles.metricChip}
                    >
                      <Ionicons name="refresh" size={11} color="#DCE6FF" />
                      <AppText variant="caption" style={styles.metricText}>
                        Yaklaşık rota · yenile
                      </AppText>
                    </Pressable>
                  ) : (
                    <AppText variant="caption" style={styles.provider}>
                      Mapbox
                    </AppText>
                  )}
                </>
              )}
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

function MapFallback({
  hasCoords,
  hasToken,
  label,
  distanceMeters,
  durationMinutes,
  imageFailed,
  onRetry,
}: {
  height: number;
  hasCoords: boolean;
  hasToken: boolean;
  label?: string;
  distanceMeters?: number | null;
  durationMinutes?: number | null;
  imageFailed: boolean;
  onRetry?: () => void;
}) {
  const { theme } = useTheme();
  const title = imageFailed
    ? 'Harita yüklenemedi'
    : !hasCoords
      ? 'Konum bilgisi eklenmemiş'
      : !hasToken
        ? 'Harita anahtarı yapılandırılmadı'
        : 'Güzergâh hazırlanıyor';
  const message = imageFailed
    ? 'Bağlantı sorunu olabilir. Tekrar deneyebilirsin.'
    : !hasCoords
      ? 'Bu ilanda kalkış ve varış koordinatları kayıtlı değil; rota çizilemiyor.'
      : !hasToken
        ? 'Gerçek harita için EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN tanımlanmalı.'
        : 'Harita yükleniyor.';

  return (
    <View
      style={[
        styles.fallback,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <LinearGradient
        colors={
          theme.scheme === 'dark'
            ? ['#101C3D', '#18264A', '#241B3D']
            : ['#EEF4FF', '#E4ECFF', '#F1EBFF']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.fallbackInner}>
        <View style={styles.routeRail}>
          <View style={[styles.railDot, { backgroundColor: theme.colors.success }]} />
          <View style={[styles.railLine, { backgroundColor: theme.colors.borderStrong }]} />
          <View style={[styles.railDot, { backgroundColor: theme.colors.primary }]} />
        </View>
        <View style={styles.fallbackText}>
          <View style={styles.fallbackTitleRow}>
            <Ionicons
              name={imageFailed ? 'cloud-offline-outline' : hasCoords ? 'map-outline' : 'location-outline'}
              size={15}
              color={theme.colors.primaryDeep}
            />
            <AppText variant="label" numberOfLines={1} style={styles.fallbackTitle}>
              {title}
            </AppText>
          </View>
          <AppText variant="caption" color="textSecondary" numberOfLines={2}>
            {message}
          </AppText>
          {label ? (
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {label}
              {distanceMeters ? ` · ${formatDistance(distanceMeters)}` : ''}
              {durationMinutes ? ` · ${formatDuration(durationMinutes)}` : ''}
            </AppText>
          ) : null}
          {onRetry ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Haritayı yeniden dene"
              onPress={onRetry}
              style={({ pressed }) => [
                styles.retry,
                {
                  borderColor: theme.colors.borderStrong,
                  backgroundColor: theme.colors.surface,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Ionicons name="refresh" size={13} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep">
                Yeniden dene
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: '#0B1020',
    borderWidth: StyleSheet.hairlineWidth,
  },
  imageLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,16,32,0.24)',
  },
  caption: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    gap: 5,
  },
  captionTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  captionText: { color: '#F2F6FF', flexShrink: 1 },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(9,14,28,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  metricText: { color: '#DCE6FF', fontSize: 10 },
  provider: { color: 'rgba(255,255,255,0.62)', fontSize: 9, marginLeft: 'auto' },
  fallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  fallbackInner: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18 },
  routeRail: { alignItems: 'center', justifyContent: 'center', height: 82, width: 20 },
  railDot: { width: 10, height: 10, borderRadius: 5 },
  railLine: { flex: 1, width: 2, marginVertical: 4, borderRadius: 1, opacity: 0.7 },
  fallbackText: { flex: 1, gap: 3 },
  fallbackTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fallbackTitle: { flexShrink: 1 },
  retry: {
    marginTop: 4,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
