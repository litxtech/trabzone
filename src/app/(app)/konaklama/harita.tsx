import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { AppImage, AppText, Screen } from '@/components/ui';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import type { MapFocus } from '@/features/map/components/map-canvas-types';
import type { MapCamera, MapPoint } from '@/features/map/types';
import { boundsOf, zoomForBounds } from '@/features/map/utils/geo';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { EmptyState, InlineError } from '@/features/accommodation/components/AccommodationUI';
import { AURORA, GlassPill } from '@/features/accommodation/components/PremiumUI';
import { usePropertyMapPoints } from '@/features/accommodation/hooks/use-accommodation';
import { accommodationMediaUrl } from '@/features/accommodation/services/accommodation-media-service';
import type { MapPropertyPoint, PropertyType } from '@/features/accommodation/types';
import {
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_OPTIONS,
  formatNumber,
  formatMoneyCents,
} from '@/features/accommodation/utils/format';

const TRABZON: MapCamera = { lat: 41.0027, lng: 39.7168, zoom: 11 };

/** Tesis türüne göre premium iğne ikonu. */
const TYPE_ICONS: Record<PropertyType, string> = {
  hotel: 'bed',
  bungalow: 'home',
  apartment: 'business',
  pension: 'cafe',
  villa: 'sparkles',
};

const PRICE_FORMAT = new Intl.NumberFormat('tr-TR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export default function AccommodationMapScreen() {
  const { theme, scheme } = useTheme();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<PropertyType | null>(null);

  const mapQuery = usePropertyMapPoints();
  const allProperties = useMemo(() => mapQuery.data ?? [], [mapQuery.data]);
  const properties = useMemo(
    () => (typeFilter ? allProperties.filter((item) => item.property_type === typeFilter) : allProperties),
    [allProperties, typeFilter],
  );

  const [camera, setCamera] = useState<MapCamera>(TRABZON);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  // Kamera yalnızca iğne kümesi gerçekten değiştiğinde yeniden sığdırılır;
  // arka plan yenilemeleri kullanıcının kaydırdığı görünümü bozmaz.
  const fittedSignature = useRef('');

  const fitCamera = useCallback(
    (items: MapPropertyPoint[]) => {
      const points = items
        .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
        .map((item) => ({ lat: item.lat, lng: item.lng }));
      const bounds = boundsOf(points);
      if (!bounds) {
        setCamera(TRABZON);
        setFocus({ camera: TRABZON, nonce: Date.now() });
        return;
      }
      // Alt karusel ve üst arama katmanı haritanın bir kısmını kaplar; sığdırma
      // hesabı görünür alanı kullanır ki iğneler panel altında kalmasın.
      const viewport = {
        width: Math.max(width - 32, 280),
        height: Math.max(height - 400, 240),
      };
      const zoom =
        points.length === 1
          ? 14.5
          : zoomForBounds(bounds, viewport);
      const next: MapCamera = {
        lat: (bounds.north + bounds.south) / 2,
        lng: (bounds.east + bounds.west) / 2,
        zoom,
      };
      setCamera(next);
      setFocus({ camera: next, nonce: Date.now() });
    },
    [height, width],
  );

  useEffect(() => {
    const signature = `${typeFilter ?? 'all'}|${properties.map((item) => item.id).join(',')}`;
    if (signature === fittedSignature.current) {
      return;
    }
    fittedSignature.current = signature;
    fitCamera(properties);
  }, [fitCamera, properties, typeFilter]);

  const markers: MapPoint[] = useMemo(
    () =>
      properties.map((property) => ({
        id: property.id,
        kind: 'place',
        lat: property.lat,
        lng: property.lng,
        title: property.name,
        subtitle: property.district,
        label: property.price_from_cents
          ? `${PRICE_FORMAT.format(property.price_from_cents / 100)} ₺`
          : PROPERTY_TYPE_LABELS[property.property_type],
        icon: TYPE_ICONS[property.property_type],
        premium: true,
        // Seçili tesisin çerçevesi vurgu rengine döner.
        color: selectedId === property.id ? theme.colors.accent : null,
        meta: { propertyId: property.id },
      })),
    [properties, selectedId, theme.colors.accent],
  );

  const carousel = selectedId
    ? [...properties].sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : 0))
    : properties;

  const selectProperty = (property: MapPropertyPoint) => {
    setSelectedId(property.id);
    const next: MapCamera = {
      lat: property.lat,
      lng: property.lng,
      zoom: Math.max(camera.zoom, 15),
    };
    setCamera(next);
    setFocus({ camera: next, nonce: Date.now() });
  };

  return (
    <Screen padded={false} edges={['top', 'left', 'right']} style={styles.screen}>
      <MapCanvas
        initialCamera={camera}
        focus={focus}
        markers={markers}
        dark={scheme === 'dark'}
        bottomInset={286}
        onMarkerPress={(point) => {
          const property = properties.find((item) => item.id === point.id);
          if (property) {
            selectProperty(property);
          }
        }}
        onCameraChange={setCamera}
      />

      <View style={styles.topOverlay} pointerEvents="box-none">
        <View style={[styles.topBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Geri" onPress={() => router.back()} style={styles.topIcon}>
            <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
          </Pressable>
          <View style={styles.flex}>
            <AppText variant="caption" color="textTertiary" style={styles.topOverline}>
              TRABZONE KONAKLAMA
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {mapQuery.isLoading ? 'Harita yükleniyor…' : `${formatNumber(properties.length)} tesis haritada`}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tüm tesisleri haritaya sığdır"
            onPress={() => fitCamera(properties)}
            style={[styles.topIcon, { backgroundColor: theme.colors.primarySoft }]}
          >
            <Ionicons name="scan-outline" size={18} color={theme.colors.primaryDeep} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Liste görünümüne dön"
            onPress={() => router.push('/konaklama' as never)}
            style={[styles.topIcon, { backgroundColor: theme.colors.primarySoft }]}
          >
            <Ionicons name="list" size={18} color={theme.colors.primaryDeep} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRail}
          pointerEvents="box-none"
        >
          <MapChip label="Tümü" active={!typeFilter} onPress={() => setTypeFilter(null)} />
          {PROPERTY_TYPE_OPTIONS.map((type) => (
            <MapChip
              key={type.value}
              label={type.label}
              active={typeFilter === type.value}
              onPress={() => setTypeFilter(typeFilter === type.value ? null : type.value)}
            />
          ))}
        </ScrollView>
      </View>

      {mapQuery.isLoading ? (
        <View style={[styles.loading, { backgroundColor: theme.colors.surface }]}>
          <ActivityIndicator color={theme.colors.primary} />
          <AppText variant="caption" color="textSecondary">
            Tesisler haritaya yerleştiriliyor…
          </AppText>
        </View>
      ) : null}

      {mapQuery.isError ? (
        <View style={[styles.errorWrap, { backgroundColor: theme.colors.surface }]}>
          <InlineError
            message={mapQuery.error instanceof Error ? mapQuery.error.message : 'Harita verisi yüklenemedi.'}
            onRetry={() => void mapQuery.refetch()}
          />
        </View>
      ) : null}

      {!mapQuery.isLoading && !mapQuery.isError && properties.length === 0 ? (
        <View style={[styles.emptyWrap, { backgroundColor: theme.colors.surface }]}>
          <EmptyState
            icon="map-outline"
            title="Haritada tesis yok"
            message={
              typeFilter
                ? 'Bu türde konumu yayınlanmış tesis bulunamadı. Farklı bir tür seç.'
                : 'Haritada yalnızca konumu girilmiş, yayında ve doğrulanmış tesisler görünür.'
            }
            compact
          />
        </View>
      ) : null}

      {properties.length > 0 ? (
        <View style={styles.bottomWrap} pointerEvents="box-none">
          <View style={[styles.dragHint, { backgroundColor: theme.colors.borderStrong }]} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carousel}
            decelerationRate="fast"
          >
            {carousel.slice(0, 30).map((property) => {
              const cover = accommodationMediaUrl(property.cover_path);
              const active = property.id === selectedId;
              return (
                <Pressable
                  key={property.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${property.name} detayını aç`}
                  onPress={() => router.push(`/konaklama/${property.id}` as never)}
                  style={({ pressed }) => [
                    styles.mapCard,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                      opacity: pressed ? 0.92 : 1,
                    },
                    theme.shadows.floating,
                  ]}
                >
                  <View style={styles.mapCardMedia}>
                    {cover ? (
                      <AppImage source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <LinearGradient
                        colors={[theme.colors.primarySoft, theme.colors.surfaceMuted]}
                        style={[StyleSheet.absoluteFill, styles.mapCardFallback]}
                      >
                        <Ionicons name="bed-outline" size={20} color={theme.colors.primaryDeep} />
                      </LinearGradient>
                    )}
                    <View style={styles.mapCardBadge}>
                      <GlassPill label={PROPERTY_TYPE_LABELS[property.property_type]} />
                    </View>
                  </View>

                  <View style={styles.mapCardBody}>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.mapCardLocation}>
                      {[property.neighborhood, property.district].filter(Boolean).join(', ') || 'Trabzon'}
                    </AppText>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {property.name}
                    </AppText>
                    <View style={styles.mapCardFoot}>
                      {property.rating_count > 0 ? (
                        <View style={styles.mapCardRating}>
                          <Ionicons name="star" size={10} color={AURORA.gold} />
                          <AppText variant="caption" color="textSecondary" style={styles.mapCardRatingText}>
                            {property.rating_avg.toFixed(1)}
                          </AppText>
                        </View>
                      ) : null}
                      <View style={styles.flex} />
                      {property.price_from_cents ? (
                        <View>
                          <AppText variant="caption" color="textTertiary" style={styles.mapCardPriceCaption}>
                            gecelik
                          </AppText>
                          <AppText variant="bodyStrong" color="primaryDeep" style={styles.mapCardPrice}>
                            {formatMoneyCents(property.price_from_cents, property.currency, { decimals: false })}
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </Screen>
  );
}

function MapChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
          borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <AppText variant="caption" style={{ color: active ? '#FFFFFF' : theme.colors.textSecondary, fontSize: 11 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },

  topOverlay: { position: 'absolute', top: 8, left: 12, right: 12, gap: 8 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  topIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  topOverline: { fontSize: 8, letterSpacing: 1.6 },
  chipRail: { gap: 6, paddingVertical: 2 },

  loading: {
    position: 'absolute',
    top: 118,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
  },
  errorWrap: { position: 'absolute', left: 16, right: 16, bottom: 240, borderRadius: 14, padding: 10 },
  emptyWrap: { position: 'absolute', left: 16, right: 16, top: '32%', borderRadius: 16 },

  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 14, gap: 8 },
  dragHint: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', opacity: 0.35 },
  carousel: { gap: 9, paddingHorizontal: 14, paddingVertical: 4 },
  mapCard: {
    width: 258,
    flexDirection: 'row',
    borderRadius: 16,
    overflow: 'hidden',
  },
  mapCardMedia: { width: 96, position: 'relative' },
  mapCardFallback: { alignItems: 'center', justifyContent: 'center' },
  mapCardBadge: { position: 'absolute', top: 6, left: 6 },
  mapCardBody: { flex: 1, padding: 10, gap: 2, minWidth: 0 },
  mapCardLocation: { fontSize: 9 },
  mapCardFoot: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 2 },
  mapCardRating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  mapCardRatingText: { fontSize: 10 },
  mapCardPriceCaption: { fontSize: 8 },
  mapCardPrice: { fontSize: 13 },

  chip: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
