import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button } from '@/components/ui';
import { DrawingOverlay } from '@/features/explore/components/DrawingOverlay';
import { useExploreBootstrap, usePlacesMap } from '@/features/explore/hooks/use-explore';
import type { PlaceMarker } from '@/features/explore/types';
import { bboxForCamera, polygonClosedGeoJson } from '@/features/explore/utils/geo';
import { publicMediaUrl } from '@/features/media/media-service';
import {
  EMPTY_MARKET_FILTERS,
  MarketFilterSheet,
  type MarketFilters,
} from '@/features/marketplace/components/MarketFilterSheet';
import { useMarketMapListings } from '@/features/marketplace/hooks/use-market-map';
import { formatMarketPrice } from '@/features/marketplace/services/marketplace-catalog-service';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import type { MapFocus } from '@/features/map/components/map-canvas-types';
import { MAP_DEFAULT_CAMERA } from '@/features/map/constants';
import type { LatLng, MapCamera, MapPoint } from '@/features/map/types';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

type LayerKey = 'all' | 'product' | 'real_estate' | 'vehicle' | 'service' | 'place';

const LAYERS: { key: LayerKey; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'all', label: 'Tümü', icon: 'apps-outline' },
  { key: 'real_estate', label: 'Emlak', icon: 'home-outline' },
  { key: 'product', label: 'Ürün', icon: 'bag-handle-outline' },
  { key: 'vehicle', label: 'Araç', icon: 'car-outline' },
  { key: 'service', label: 'Hizmet', icon: 'construct-outline' },
  { key: 'place', label: 'İşletme', icon: 'storefront-outline' },
];

const KIND_STYLE: Record<string, { icon: string; tone: MapPoint['tone'] }> = {
  product: { icon: 'bag-handle-outline', tone: 'primary' },
  real_estate: { icon: 'home-outline', tone: 'accent' },
  vehicle: { icon: 'car-outline', tone: 'info' },
  service: { icon: 'construct-outline', tone: 'success' },
  job: { icon: 'briefcase-outline', tone: 'warning' },
  education: { icon: 'school-outline', tone: 'info' },
  event: { icon: 'calendar-outline', tone: 'danger' },
  place: { icon: 'storefront-outline', tone: 'accent' },
};

function insidePolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) {
      continue;
    }
    const intersects =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat || 1e-12) + a.lng;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export default function MarketMapScreen() {
  const { theme, scheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const bootstrap = useExploreBootstrap();

  const [camera, setCamera] = useState<MapCamera>(MAP_DEFAULT_CAMERA);
  const [settled, setSettled] = useState<MapCamera>(MAP_DEFAULT_CAMERA);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [layer, setLayer] = useState<LayerKey>('all');
  const [filters, setFilters] = useState<MarketFilters>(EMPTY_MARKET_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawn, setDrawn] = useState<LatLng[]>([]);
  const [polygon, setPolygon] = useState<LatLng[] | null>(null);
  const [clearSignal, setClearSignal] = useState(0);
  const [undoSignal, setUndoSignal] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(camera), 420);
    return () => clearTimeout(timer);
  }, [camera]);

  useEffect(() => {
    if (!bootstrap.data) {
      return;
    }
    const next: MapCamera = {
      lat: bootstrap.data.city.center_lat,
      lng: bootstrap.data.city.center_lng,
      zoom: 12.4,
    };
    // Şehir merkezi bir kez yüklendiğinde kamerayı konumlandırır.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCamera(next);
    setSettled(next);
    setFocus({ camera: next, nonce: Date.now() });
  }, [bootstrap.data]);

  useEffect(() => {
    if (!banner) {
      return;
    }
    const timer = setTimeout(() => setBanner(null), 3200);
    return () => clearTimeout(timer);
  }, [banner]);

  const viewport = useMemo(() => bboxForCamera(settled, width, height), [height, settled, width]);
  const polygonGeo = useMemo(() => (polygon ? polygonClosedGeoJson(polygon) : null), [polygon]);
  const marketKinds = layer === 'all' || layer === 'place' ? null : [layer];

  const market = useMarketMapListings({
    bbox: viewport,
    polygon: polygonGeo,
    kinds: marketKinds,
    minPrice: filters.minPrice ? Number(filters.minPrice) * 100 : null,
    maxPrice: filters.maxPrice ? Number(filters.maxPrice) * 100 : null,
    districtId: filters.districtId,
    condition: filters.condition,
    enabled: layer !== 'place',
  });

  const places = usePlacesMap(viewport, {
    categories: [],
    query: null,
    enabled: (layer === 'all' || layer === 'place') && !drawing,
  });

  const marketItems = useMemo(() => market.data ?? [], [market.data]);
  const placeItems = useMemo(() => {
    const items = (places.data?.items ?? []).filter(
      (item): item is PlaceMarker => item.kind === 'place',
    );
    if (!polygon || polygon.length < 3) {
      return items;
    }
    return items.filter((item) => insidePolygon({ lat: item.lat, lng: item.lng }, polygon));
  }, [places.data?.items, polygon]);

  const markers = useMemo<MapPoint[]>(() => {
    const marketMarkers: MapPoint[] = marketItems.map((item) => {
      const style = KIND_STYLE[item.kind] ?? KIND_STYLE.product!;
      return {
        id: `market:${item.id}`,
        kind: 'place',
        lat: item.lat,
        lng: item.lng,
        title: item.title,
        subtitle: item.category_name,
        label: formatMarketPrice(item.price_cents, item.currency, item.price_period ?? 'total'),
        icon: item.category_icon ?? style.icon,
        tone: style.tone,
        meta: { source: 'market', listing: item },
      };
    });
    const placeMarkers: MapPoint[] = placeItems.map((item) => ({
      id: `place:${item.id}`,
      kind: 'place',
      lat: item.lat,
      lng: item.lng,
      title: item.name,
      subtitle: item.category_name,
      label: item.rating != null ? `${item.rating.toFixed(1)} ★` : null,
      icon: item.icon ?? 'storefront-outline',
      tone: 'accent',
      meta: { source: 'place', place: item },
    }));
    return [...marketMarkers, ...placeMarkers];
  }, [marketItems, placeItems]);

  const selectedListing = useMemo(
    () => marketItems.find((item) => `market:${item.id}` === selectedId) ?? null,
    [marketItems, selectedId],
  );
  const selectedPlace = useMemo(
    () => placeItems.find((item) => `place:${item.id}` === selectedId) ?? null,
    [placeItems, selectedId],
  );

  const moveCamera = useCallback((next: MapCamera) => {
    setCamera(next);
    setSettled(next);
    setFocus({ camera: next, nonce: Date.now() });
  }, []);

  const startDrawing = () => {
    haptics.tap();
    setSelectedId(null);
    setDrawing(true);
    setPolygon(null);
    setDrawn([]);
    setClearSignal((value) => value + 1);
  };

  const cancelDrawing = () => {
    setDrawing(false);
    setDrawn([]);
  };

  const completeDrawing = () => {
    if (drawn.length < 3) {
      Alert.alert('Alan çok küçük', 'Arama için haritada kapalı bir alan çizmelisin.');
      return;
    }
    if (!polygonClosedGeoJson(drawn)) {
      Alert.alert('Geometri geçersiz', 'Çizim kapalı bir alan oluşturmuyor. Yeniden dene.');
      return;
    }
    setDrawing(false);
    setPolygon(drawn);
    setBanner('Çizilen alan içindeki ilanlar getiriliyor…');
  };

  const clearArea = () => {
    setPolygon(null);
    setDrawn([]);
    setSelectedId(null);
  };

  const openSelected = () => {
    if (selectedListing) {
      router.push(`/marketplace/${selectedListing.id}` as never);
      return;
    }
    if (selectedPlace) {
      router.push(`/marketplace/place/${selectedPlace.id}` as never);
    }
  };

  const zoomToMarker = (point: MapPoint) => {
    haptics.tap();
    if (point.kind === 'cluster') {
      moveCamera({ lat: point.lat, lng: point.lng, zoom: Math.min(17, camera.zoom + 1.4) });
      return;
    }
    setSelectedId(point.id);
    moveCamera({ lat: point.lat, lng: point.lng, zoom: Math.max(camera.zoom, 15) });
  };

  const filterCount =
    (filters.districtId != null ? 1 : 0) +
    (filters.minPrice ? 1 : 0) +
    (filters.maxPrice ? 1 : 0) +
    (filters.condition ? 1 : 0);

  const loading = market.isLoading || places.isLoading;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <MapCanvas
        initialCamera={camera}
        focus={focus}
        markers={markers}
        polygon={polygon}
        dark={scheme === 'dark'}
        interactive={!drawing}
        bottomInset={selectedId ? 170 : 0}
        onMarkerPress={zoomToMarker}
        onCameraChange={setCamera}
        onMapPress={() => setSelectedId(null)}
      />

      {drawing ? (
        <DrawingOverlay
          enabled
          camera={camera}
          onChange={setDrawn}
          clearSignal={clearSignal}
          undoSignal={undoSignal}
        />
      ) : null}

      {!drawing ? (
        <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Geri"
              onPress={() => router.back()}
              style={[styles.iconButton, theme.shadows.sm, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
            </Pressable>
            <View style={styles.flex}>
              <AppText variant="h3" numberOfLines={1}>
                Trabzon Haritası
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {markers.length} ilan ve işletme{polygon ? ' · alan seçili' : ''}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Haritada ara"
              onPress={() => router.push('/marketplace/search' as never)}
              style={[styles.iconButton, theme.shadows.sm, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <Ionicons name="search-outline" size={19} color={theme.colors.text} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Harita filtreleri${filterCount > 0 ? `, ${filterCount} etkin` : ''}`}
              onPress={() => setFilterOpen(true)}
              style={[styles.iconButton, theme.shadows.sm, { backgroundColor: filterCount > 0 ? theme.colors.primary : theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <Ionicons name="options-outline" size={18} color={filterCount > 0 ? theme.colors.onPrimary : theme.colors.text} />
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.layerRow}>
            {LAYERS.map((entry) => {
              const active = layer === entry.key;
              return (
                <Pressable
                  key={entry.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    haptics.selection();
                    setLayer(entry.key);
                    setSelectedId(null);
                  }}
                  style={[
                    styles.layerChip,
                    theme.shadows.sm,
                    {
                      backgroundColor: active ? theme.colors.primary : theme.colors.surface,
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Ionicons name={entry.icon} size={14} color={active ? theme.colors.onPrimary : theme.colors.textSecondary} />
                  <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                    {entry.label}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>

          {polygon ? (
            <View style={[styles.areaPill, { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary }]}>
              <Ionicons name="shapes-outline" size={14} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep" style={styles.flex} numberOfLines={1}>
                Çizilen alan · {marketItems.length + placeItems.length} sonuç
              </AppText>
              <Pressable accessibilityRole="button" accessibilityLabel="Alanı temizle" onPress={clearArea} hitSlop={6}>
                <Ionicons name="close" size={17} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}

          {banner ? (
            <View style={[styles.banner, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary }]}>
              <Ionicons name="information-circle" size={14} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep" style={styles.flex}>
                {banner}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[styles.drawTop, { paddingTop: insets.top + 6 }]}>
          <View style={[styles.drawCard, theme.shadows.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={styles.drawHead}>
              <View style={styles.flex}>
                <AppText variant="bodyStrong">Alan çiz</AppText>
                <AppText variant="caption" color="textTertiary">
                  Haritada kapalı bir bölge çiz · {drawn.length} nokta
                </AppText>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Çizimi iptal et" onPress={cancelDrawing} hitSlop={8}>
                <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.drawActions}>
              <Button
                label="Geri al"
                variant="outline"
                size="sm"
                disabled={drawn.length === 0}
                onPress={() => setUndoSignal((value) => value + 1)}
                style={styles.flex}
              />
              <Button
                label="Temizle"
                variant="outline"
                size="sm"
                disabled={drawn.length === 0}
                onPress={() => {
                  setDrawn([]);
                  setClearSignal((value) => value + 1);
                }}
                style={styles.flex}
              />
              <Button
                label="Bu alanda ara"
                size="sm"
                disabled={drawn.length < 3}
                onPress={completeDrawing}
                style={styles.flex}
              />
            </View>
          </View>
        </View>
      )}

      {!drawing ? (
        <View style={[styles.sideControls, { top: insets.top + 150 }]}>
          <SideButton icon="pencil" label="Alan çiz" active={Boolean(polygon)} onPress={startDrawing} />
          <SideButton
            icon="list"
            label="Liste"
            onPress={() => router.push('/marketplace/catalog' as never)}
          />
          <SideButton
            icon="layers"
            label="Kategoriler"
            onPress={() => router.push('/marketplace/categories' as never)}
          />
        </View>
      ) : null}

      {!drawing ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="OpenStreetMap veri lisansı"
          onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}
          style={[
            styles.attribution,
            {
              bottom: Math.max(insets.bottom, 8) + (selectedId ? 178 : 6),
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <AppText variant="caption" color="textTertiary" style={styles.attributionText}>
            Veri: © OpenStreetMap katkıcıları
          </AppText>
        </Pressable>
      ) : null}

      {loading ? (
        <View style={[styles.loading, { top: insets.top + 128, backgroundColor: theme.colors.surface }]}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <AppText variant="caption" color="textTertiary">
            Harita yükleniyor
          </AppText>
        </View>
      ) : null}

      {selectedId && (selectedListing || selectedPlace) ? (
        <View style={[styles.cardWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={[styles.card, theme.shadows.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Detayı aç"
              onPress={openSelected}
              style={styles.cardBody}
            >
              <View style={[styles.cardImage, { backgroundColor: theme.colors.surfaceMuted }]}>
                {selectedListing ? (
                  <MapListingImage path={selectedListing.cover_path} />
                ) : (
                  <MapPlaceImage path={selectedPlace?.cover_path ?? null} />
                )}
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={2}>
                  {selectedListing?.title ?? selectedPlace?.name}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {selectedListing
                    ? `${selectedListing.category_name} · ${selectedListing.district ?? 'Trabzon'}`
                    : `${selectedPlace?.category_name ?? 'İşletme'} · ${selectedPlace?.district ?? 'Trabzon'}`}
                </AppText>
                <View style={styles.cardMeta}>
                  {selectedListing ? (
                    <AppText variant="bodyStrong" color="primaryDeep">
                      {formatMarketPrice(
                        selectedListing.price_cents,
                        selectedListing.currency,
                        selectedListing.price_period ?? 'total',
                      )}
                    </AppText>
                  ) : (
                    <AppText variant="bodyStrong" color="primaryDeep">
                      {selectedPlace?.rating != null
                        ? `${selectedPlace.rating.toFixed(1)} ★ · ${selectedPlace.review_count} yorum`
                        : 'Yorum yok'}
                    </AppText>
                  )}
                  <BadgePill label={selectedListing ? 'İlan' : 'İşletme'} />
                </View>
              </View>
              <Ionicons name="chevron-forward" size={17} color={theme.colors.textTertiary} />
            </Pressable>
            <View style={styles.cardActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Haritada yakınlaştır"
                onPress={() => {
                  const target = selectedListing ?? selectedPlace;
                  if (target) {
                    moveCamera({ lat: target.lat, lng: target.lng, zoom: 16 });
                  }
                }}
                style={[styles.cardAction, { borderColor: theme.colors.border }]}
              >
                <Ionicons name="locate-outline" size={15} color={theme.colors.textSecondary} />
                <AppText variant="caption" color="textSecondary">
                  Yakınlaştır
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Detayı aç"
                onPress={openSelected}
                style={[styles.cardAction, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft }]}
              >
                <Ionicons name="open-outline" size={15} color={theme.colors.primaryDeep} />
                <AppText variant="caption" color="primaryDeep">
                  Detayı gör
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kartı kapat"
                onPress={() => setSelectedId(null)}
                style={[styles.cardAction, { borderColor: theme.colors.border }]}
              >
                <Ionicons name="close" size={15} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <MarketFilterSheet
        visible={filterOpen}
        initial={filters}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFilterOpen(false);
        }}
      />
    </View>
  );
}

function MapListingImage({ path }: { path: string | null }) {
  const uri = publicMediaUrl('listing-images', path);
  if (!uri) {
    return <Ionicons name="image-outline" size={26} color="rgba(255,255,255,0.5)" />;
  }
  return <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />;
}

function MapPlaceImage({ path }: { path: string | null }) {
  return <MapListingImage path={path} />;
}

function BadgePill({ label }: { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.badgePill, { backgroundColor: theme.colors.surfaceMuted }]}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

function SideButton({
  icon,
  label,
  onPress,
  active,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.sideButton,
        theme.shadows.sm,
        {
          backgroundColor: active ? theme.colors.primary : theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={active ? theme.colors.onPrimary : theme.colors.text} />
      <AppText variant="caption" style={{ color: active ? theme.colors.onPrimary : theme.colors.textSecondary, fontSize: 9 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layerRow: { gap: 6, paddingHorizontal: 14 },
  layerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  areaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginHorizontal: 14,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginHorizontal: 14,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  drawTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14 },
  drawCard: { gap: 10, padding: 12, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  drawHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drawActions: { flexDirection: 'row', gap: 8 },
  sideControls: { position: 'absolute', right: 12, gap: 8 },
  sideButton: {
    width: 56,
    paddingVertical: 7,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 2,
  },
  loading: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  cardWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10 },
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 8,
  },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardImage: {
    width: 82,
    height: 82,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  badgePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  cardActions: { flexDirection: 'row', gap: 6 },
  attribution: {
    position: 'absolute',
    left: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attributionText: { fontSize: 9 },
  cardAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
