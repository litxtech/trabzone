import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Skeleton } from '@/components/ui';
import { DrawingOverlay } from '@/features/explore/components/DrawingOverlay';
import { AreaResultSheet } from '@/features/explore/components/AreaResultSheet';
import { ExploreCategoryChips } from '@/features/explore/components/ExploreCategoryChips';
import { ExploreFilterSheet, EMPTY_EXPLORE_FILTERS, type ExploreFilters } from '@/features/explore/components/ExploreFilterSheet';
import { ExploreMarkerCard } from '@/features/explore/components/ExploreMarkerCard';
import { ExploreSearchSheet } from '@/features/explore/components/ExploreSearchSheet';
import { MapListSheet } from '@/features/explore/components/MapListSheet';
import { PlaceDetailSheet } from '@/features/explore/components/PlaceDetailSheet';
import { PlaceSuggestModal } from '@/features/explore/components/PlaceSuggestModal';
import { SaveAreaSheet } from '@/features/explore/components/SaveAreaSheet';
import { SavedAreasSheet } from '@/features/explore/components/SavedAreasSheet';
import { pointsFromGeometry } from '@/features/explore/services/explore-service';
import {
  useAreaSearch,
  useDeleteSavedArea,
  useExploreBootstrap,
  useExploreSearch,
  usePlacesMap,
  useRealEstateMap,
  useReportContent,
  useSavedAreas,
  useSaveArea,
  useToggleListingFavorite,
  useTogglePlaceFavorite,
} from '@/features/explore/hooks/use-explore';
import type {
  AreaSearchResult,
  ExploreMarker,
  ExploreSearchItem,
  PlaceMarker,
  RealEstateMarker,
  SavedArea,
} from '@/features/explore/types';
import { bboxForCamera, polygonClosedGeoJson } from '@/features/explore/utils/geo';
import { markerFromPoint, toMapPoints } from '@/features/explore/utils/markers';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import type { MapFocus } from '@/features/map/components/map-canvas-types';
import { MAP_DEFAULT_CAMERA } from '@/features/map/constants';
import { useDeviceLocation } from '@/features/map/hooks/use-map';
import { fetchRoute, hasMapboxToken, mapApiMessage } from '@/features/map/services/map-service';
import type { LatLng, MapCamera, MapPoint } from '@/features/map/types';
import { clusterPoints } from '@/features/map/utils/cluster';
import { boundsOf, clamp, zoomForBounds } from '@/features/map/utils/geo';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

type SheetKey = 'search' | 'filter' | 'list' | 'saved' | 'save-area' | null;

function paramNumber(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function paramString(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() ? raw.trim() : null;
}

export default function ExploreMapScreen() {
  const { theme, scheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{
    mode?: string;
    kind?: string;
    category?: string;
    districtId?: string;
    neighborhoodId?: string;
    minPrice?: string;
    maxPrice?: string;
    minM2?: string;
    rooms?: string;
    q?: string;
    savedAreaId?: string;
    listingId?: string;
  }>();
  const mode = paramString(params.mode);
  const paramKind = paramString(params.kind);
  const paramCategory = paramString(params.category);
  const paramDistrict = paramNumber(params.districtId);
  const paramNeighborhood = paramNumber(params.neighborhoodId);
  const paramMinPrice = paramNumber(params.minPrice);
  const paramMaxPrice = paramNumber(params.maxPrice);
  const paramMinM2 = paramNumber(params.minM2);
  const paramRooms = paramNumber(params.rooms);
  const savedAreaId = paramString(params.savedAreaId);
  const initialListingId = paramString(params.listingId);
  const savedApplied = useRef(false);
  const location = useDeviceLocation(true);

  const bootstrap = useExploreBootstrap();
  const savedAreas = useSavedAreas();
  const saveArea = useSaveArea();
  const deleteArea = useDeleteSavedArea();
  const areaSearch = useAreaSearch();
  const report = useReportContent();
  const favoritePlace = useTogglePlaceFavorite();
  const favoriteListing = useToggleListingFavorite();

  const [camera, setCamera] = useState<MapCamera>(MAP_DEFAULT_CAMERA);
  const [settled, setSettled] = useState<MapCamera>(MAP_DEFAULT_CAMERA);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [sheet, setSheet] = useState<SheetKey>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialListingId);
  const [showPlaces, setShowPlaces] = useState(mode !== 're');
  const [showRealEstate, setShowRealEstate] = useState(true);
  const [reCategory, setReCategory] = useState<string | null>(paramCategory);
  const [categorySlugs, setCategorySlugs] = useState<string[]>([]);
  const [filters, setFilters] = useState<ExploreFilters>(() => ({
    ...EMPTY_EXPLORE_FILTERS,
    districtId: paramDistrict,
    neighborhoodId: paramNeighborhood,
    listingKind:
      paramKind === 'rent' || paramKind === 'sale' || paramKind === 'transfer' ? paramKind : null,
    minPrice: paramMinPrice,
    maxPrice: paramMaxPrice,
    minM2: paramMinM2,
    rooms: paramRooms,
  }));

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const search = useExploreSearch(debouncedQuery);

  const [drawing, setDrawing] = useState(false);
  const [drawn, setDrawn] = useState<LatLng[]>([]);
  const [polygon, setPolygon] = useState<LatLng[] | null>(null);
  const [drawClear, setDrawClear] = useState(0);
  const [drawUndo, setDrawUndo] = useState(0);
  const [areaResult, setAreaResult] = useState<AreaSearchResult | null>(null);
  const [areaOpen, setAreaOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');

  const [routeLine, setRouteLine] = useState<LatLng[] | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const cameraTick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<MapCamera | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (cameraTick.current) {
        clearTimeout(cameraTick.current);
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setSelectedPoint(null);
        setDrawing(false);
        setSheet(null);
      };
    }, []),
  );

  useEffect(() => {
    if (!banner) {
      return;
    }
    const timer = setTimeout(() => setBanner(null), 3800);
    return () => clearTimeout(timer);
  }, [banner]);

  useEffect(() => {
    if (!bootstrap.data || mapReady) {
      return;
    }
    const selectedDistrict = bootstrap.data.districts.find((item) => item.id === paramDistrict);
    const next: MapCamera = {
      lat: selectedDistrict?.lat ?? bootstrap.data.city.center_lat,
      lng: selectedDistrict?.lng ?? bootstrap.data.city.center_lng,
      zoom: selectedDistrict ? 13.1 : 12.6,
    };
    // Bootstrap yüklendiğinde kamerayı bir kez başlatır; sonraki
    // kullanıcı hareketlerini ezmemek için mapReady kapısı vardır.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCamera(next);
    setSettled(next);
    setFocus({ camera: next, nonce: Date.now() });
    setMapReady(true);
  }, [bootstrap.data, mapReady, paramDistrict]);

  const handleCameraChange = useCallback((next: MapCamera) => {
    pending.current = next;
    if (cameraTick.current) {
      return;
    }
    cameraTick.current = setTimeout(() => {
      cameraTick.current = null;
      if (pending.current) {
        setCamera(pending.current);
      }
    }, 240);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(camera), 520);
    return () => clearTimeout(timer);
  }, [camera]);

  const viewport = useMemo(
    () => bboxForCamera(settled, width, height),
    [height, settled, width],
  );

  const listingFilters = useMemo(() => {
    const values: Record<string, unknown> = {};
    if (filters.districtId != null) values.district_id = filters.districtId;
    if (filters.neighborhoodId != null) values.neighborhood_id = filters.neighborhoodId;
    if (filters.listingKind) values.listing_kind = filters.listingKind;
    if (reCategory) values.categories = [reCategory];
    if (filters.minPrice != null) values.min_price = filters.minPrice;
    if (filters.maxPrice != null) values.max_price = filters.maxPrice;
    if (filters.minM2 != null) values.min_m2 = filters.minM2;
    if (filters.rooms != null) values.rooms = filters.rooms;
    return values;
  }, [filters, reCategory]);

  const placesQuery = usePlacesMap(viewport, {
    categories: categorySlugs,
    query: null,
    enabled: showPlaces && !drawing,
  });
  const listingsQuery = useRealEstateMap(viewport, listingFilters, showRealEstate && !drawing);

  const allMarkers = useMemo<ExploreMarker[]>(() => {
    const places = (showPlaces ? placesQuery.data?.items ?? [] : []).filter((item) =>
      item.kind === 'place' ? filters.districtId == null || item.district_id === filters.districtId : true,
    ) as PlaceMarker[];
    const listings = (showRealEstate ? listingsQuery.data?.items ?? [] : []).filter(
      (item): item is RealEstateMarker => item.kind === 'real_estate',
    );
    return [...places, ...listings];
  }, [
    filters.districtId,
    listingsQuery.data?.items,
    placesQuery.data?.items,
    showPlaces,
    showRealEstate,
  ]);

  const mapMarkers = useMemo(() => {
    const points = toMapPoints(allMarkers);
    const clustered = clusterPoints(points, camera.zoom);
    if (polygon && drawn.length >= 3) {
      return clustered;
    }
    return clustered;
  }, [allMarkers, camera.zoom, drawn.length, polygon]);

  const selectedMarker = useMemo(() => (selectedPoint ? markerFromPoint(selectedPoint) : null), [selectedPoint]);
  const selectedIsPlace = selectedMarker?.kind === 'place';
  const selectedId = selectedMarker?.id ?? null;

  const showBanner = (message: string) => setBanner(message);

  const moveCamera = useCallback((next: MapCamera) => {
    if (cameraTick.current) {
      clearTimeout(cameraTick.current);
      cameraTick.current = null;
    }
    pending.current = next;
    setCamera(next);
    setSettled(next);
    setFocus({ camera: next, nonce: Date.now() });
  }, []);

  useEffect(() => {
    if (!savedAreaId || !savedAreas.data || savedApplied.current) {
      return;
    }
    const area = savedAreas.data.find((item) => item.id === savedAreaId);
    if (!area) {
      return;
    }
    savedApplied.current = true;
    const points = pointsFromGeometry(area.geometry);
    if (points.length >= 3) {
      // Kayıtlı arama bir kez uygulanır; savedApplied kapısı tekrarı önler.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrawn(points);
      setPolygon(points);
      const bounds = boundsOf(points);
      if (bounds) {
        moveCamera({
          lat: (bounds.north + bounds.south) / 2,
          lng: (bounds.east + bounds.west) / 2,
          zoom: zoomForBounds(bounds, { width, height }),
        });
      }
    }
    const raw = (area.filters ?? {}) as Record<string, unknown>;
    const readNumber = (key: string): number | null => {
      const value = raw[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
    const nextKind = raw.listing_kind ?? raw.listingKind;
    setFilters((current) => ({
      ...current,
      districtId: readNumber('district_id') ?? readNumber('districtId') ?? current.districtId,
      neighborhoodId: readNumber('neighborhood_id') ?? readNumber('neighborhoodId') ?? current.neighborhoodId,
      listingKind:
        nextKind === 'rent' || nextKind === 'sale' || nextKind === 'transfer' ? nextKind : current.listingKind,
      minPrice: readNumber('min_price') ?? readNumber('minPrice') ?? current.minPrice,
      maxPrice: readNumber('max_price') ?? readNumber('maxPrice') ?? current.maxPrice,
      minM2: readNumber('min_m2') ?? readNumber('minM2') ?? current.minM2,
      rooms: readNumber('rooms') ?? current.rooms,
    }));
    const category = raw.category;
    if (typeof category === 'string' && category) {
      setReCategory(category);
    }
    if (area.area_kind === 'real_estate') {
      setShowPlaces(false);
      setShowRealEstate(true);
    }
  }, [height, moveCamera, savedAreaId, savedAreas.data, width]);

  const toggleCategory = (slug: string) => {
    if (slug === 'all') {
      setCategorySlugs([]);
      return;
    }
    setCategorySlugs((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  };

  const handleDrawStart = () => {
    haptics.tap();
    setSelectedPoint(null);
    setAreaOpen(false);
    setSheet(null);
    setRouteLine(null);
    setDrawing(true);
    setPolygon(null);
    setDrawn([]);
    setDrawClear((value) => value + 1);
  };

  const handleDrawCancel = () => {
    setDrawing(false);
    setDrawn([]);
    setPolygon(null);
  };

  const handleDrawComplete = () => {
    if (drawn.length < 3) {
      Alert.alert('Alan çok küçük', 'Arama yapabilmek için haritada kapalı bir alan çizmelisin.');
      return;
    }
    const geometry = polygonClosedGeoJson(drawn);
    if (!geometry) {
      Alert.alert('Geometri geçersiz', 'Çizim kapalı bir polygon oluşturmuyor. Yeniden dene.');
      return;
    }

    setDrawing(false);
    setPolygon(drawn);
    const kinds: ('place' | 'real_estate')[] = [];
    if (showPlaces) kinds.push('place');
    if (showRealEstate) kinds.push('real_estate');

    areaSearch.mutate(
      {
        polygon: geometry,
        categories:
          reCategory && !showPlaces
            ? [reCategory]
            : categorySlugs.length > 0
              ? categorySlugs
              : undefined,
        kinds,
        min_price: filters.minPrice,
        max_price: filters.maxPrice,
        min_m2: filters.minM2,
        listing_kind: filters.listingKind,
        rooms: filters.rooms,
      },
      {
        onSuccess: (result) => {
          setAreaResult(result);
          setAreaOpen(true);
          const first = result.places[0] ?? result.listings[0];
          if (first) {
            moveCamera({ lat: first.lat, lng: first.lng, zoom: clamp(camera.zoom, 13, 17) });
          }
        },
        onError: (error) => {
          setPolygon(null);
          Alert.alert('Alan araması yapılamadı', error.message);
        },
      },
    );
  };

  const handleSaveArea = (label: string, notify: boolean) => {
    const geometry = polygon ? polygonClosedGeoJson(polygon) : null;
    if (!geometry) {
      Alert.alert('Kaydedilemedi', 'Önce bir alan çiz.');
      return;
    }
    saveArea.mutate(
      {
        label,
        polygon: geometry,
        notify,
        areaKind: showRealEstate && !showPlaces ? 'real_estate' : 'map',
        filters: {
          ...listingFilters,
          categories: reCategory ? [reCategory] : categorySlugs,
          kinds: [
            ...(showPlaces ? ['place'] : []),
            ...(showRealEstate ? ['real_estate'] : []),
          ],
        },
      },
      {
        onSuccess: () => {
          setSheet(null);
          haptics.success();
          showBanner(notify ? 'Alan kaydedildi. Yeni kayıtlar için bildirim hazırlanacak.' : 'Alan kaydedildi.');
        },
        onError: (error) => Alert.alert('Alan kaydedilemedi', error.message),
      },
    );
  };

  const openSavedArea = (area: SavedArea) => {
    const ring = area.geometry?.coordinates?.[0];
    if (!ring || ring.length < 3) {
      Alert.alert('Alan açılamadı', 'Kayıtlı alanın geometrisi eksik.');
      return;
    }
    const points = ring.map(([lng, lat]) => ({ lat: lat ?? 0, lng: lng ?? 0 }));
    setSheet(null);
    setDrawn(points);
    setPolygon(points);
    setAreaResult(null);
    const bounds = boundsOf(points);
    if (bounds) {
      moveCamera({
        lat: (bounds.north + bounds.south) / 2,
        lng: (bounds.east + bounds.west) / 2,
        zoom: zoomForBounds(bounds, { width, height }),
      });
    }
  };

  const handleDirections = useCallback(
    async (target: LatLng) => {
      const origin = location.point ?? { lat: camera.lat, lng: camera.lng };
      if (!hasMapboxToken()) {
        const label = encodeURIComponent('Trabzone');
        const url =
          Platform.OS === 'ios'
            ? `http://maps.apple.com/?saddr=${origin.lat},${origin.lng}&daddr=${target.lat},${target.lng}&q=${label}`
            : `geo:${target.lat},${target.lng}?q=${target.lat},${target.lng}`;
        const supported = await Linking.canOpenURL(url);
        if (!supported) {
          Alert.alert('Yol tarifi açılamadı', mapApiMessage('no_token'));
          return;
        }
        await Linking.openURL(url);
        return;
      }

      setRouteBusy(true);
      const response = await fetchRoute({ origin, dest: target });
      setRouteBusy(false);
      if (!response.ok) {
        Alert.alert('Güzergâh oluşturulamadı', mapApiMessage(response.reason));
        return;
      }
      setRouteLine(response.data.geometry);
      setSelectedPoint(null);
      const bounds = boundsOf([origin, target, ...response.data.geometry]);
      if (bounds) {
        moveCamera({
          lat: (bounds.north + bounds.south) / 2,
          lng: (bounds.east + bounds.west) / 2,
          zoom: zoomForBounds(bounds, { width, height }),
        });
      }
      showBanner(
        `${(response.data.distanceMeters / 1000).toFixed(1)} km · yaklaşık ${response.data.durationMinutes} dk`,
      );
    },
    [camera.lat, camera.lng, height, location.point, moveCamera, width],
  );

  const focusSearchItem = (item: ExploreSearchItem) => {
    setSearchOpen(false);
    setSheet(null);
    if (item.kind === 'place') {
      setDetailId(String(item.id));
      return;
    }
    if (item.kind === 'real_estate') {
      router.push(`/marketplace/real-estate/${item.id}` as never);
      return;
    }
    moveCamera({
      lat: item.lat,
      lng: item.lng,
      zoom: item.kind === 'district' ? 13.2 : 15,
    });
    showBanner(item.title);
  };

  const handleMarkerPress = (point: MapPoint) => {
    haptics.tap();
    if (point.kind === 'cluster') {
      const count = point.count ?? 2;
      moveCamera({
        lat: point.lat,
        lng: point.lng,
        zoom: clamp(camera.zoom + Math.max(1.2, Math.log2(count) * 0.7), 10, 18),
      });
      return;
    }
    setSelectedPoint(point);
    setRouteLine(null);
  };

  const favoriteMarker = () => {
    if (!selectedId) {
      return;
    }
    if (selectedIsPlace) {
      favoritePlace.mutate(selectedId, {
        onSuccess: () => {
          setSelectedPoint((current) =>
            current ? { ...current, meta: { ...(current.meta ?? {}) } } : current,
          );
          void placesQuery.refetch();
        },
        onError: (error) => Alert.alert('Favori güncellenemedi', error.message),
      });
    } else {
      favoriteListing.mutate(selectedId, {
        onSuccess: () => void listingsQuery.refetch(),
        onError: (error) => Alert.alert('Favori güncellenemedi', error.message),
      });
    }
  };

  const reportMarker = () => {
    if (!selectedMarker) {
      return;
    }
    Alert.alert('Şikâyet et', 'Nedenini seç. Şikâyetin moderasyon ekibine iletilir.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Yanlış konum',
        onPress: () =>
          report.mutate(
            {
              targetType: selectedMarker.kind === 'place' ? 'place' : 'real_estate_listing',
              targetId: selectedMarker.id,
              reason: 'wrong_location',
            },
            { onSuccess: () => showBanner('Şikâyetin alındı.') },
          ),
      },
      {
        text: 'Sahte / yanıltıcı',
        style: 'destructive',
        onPress: () =>
          report.mutate(
            {
              targetType: selectedMarker.kind === 'place' ? 'place' : 'real_estate_listing',
              targetId: selectedMarker.id,
              reason: 'fake',
            },
            { onSuccess: () => showBanner('Şikâyetin alındı.') },
          ),
      },
    ]);
  };

  const goMyLocation = async () => {
    const point = location.point ?? (await location.request());
    if (!point) {
      Alert.alert('Konum alınamadı', 'Konum izni verilmedi. Haritayı elle kullanmaya devam edebilirsin.');
      return;
    }
    moveCamera({ lat: point.lat, lng: point.lng, zoom: 15 });
  };

  const defaultSaveLabel = useMemo(() => {
    const district =
      bootstrap.data?.districts.find((item) => item.id === filters.districtId)?.name ?? 'Trabzon';
    return `${district} alan araması`;
  }, [bootstrap.data?.districts, filters.districtId]);

  const openFilters = () => {
    setSheet('filter');
    setSearchOpen(false);
  };

  const bootError = bootstrap.isError;
  const queryError = placesQuery.isError || listingsQuery.isError;
  const loadingMarkers = placesQuery.isLoading || listingsQuery.isLoading;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <MapCanvas
        initialCamera={camera}
        focus={focus}
        markers={mapMarkers}
        polygon={polygon}
        route={routeLine}
        userLocation={location.status === 'granted' ? location.point : null}
        dark={scheme === 'dark'}
        interactive={!drawing}
        onMarkerPress={handleMarkerPress}
        onCameraChange={handleCameraChange}
        onMapPress={() => setSelectedPoint(null)}
      />

      {drawing ? (
        <DrawingOverlay
          enabled
          camera={camera}
          onChange={setDrawn}
          clearSignal={drawClear}
          undoSignal={drawUndo}
        />
      ) : null}

      {!drawing ? (
        <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Geri"
              hitSlop={8}
              onPress={() => router.back()}
              style={[styles.iconButton, theme.shadows.sm, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
            </Pressable>
            <View style={styles.flex} pointerEvents="none">
              <AppText variant="h3" numberOfLines={1}>
                Trabzon Keşfet
              </AppText>
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {showPlaces && showRealEstate
                  ? 'İşletmeler ve emlak'
                  : showPlaces
                    ? 'İşletmeler'
                    : showRealEstate
                      ? 'Emlak'
                      : 'Kategori seç'}
                {' · '}
                {allMarkers.length} kayıt
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Haritaya yer ekle"
              onPress={() => setSuggestOpen(true)}
              style={[styles.iconButton, theme.shadows.sm, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <Ionicons name="add" size={21} color={theme.colors.text} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Harita filtreleri"
              onPress={openFilters}
              style={[styles.iconButton, theme.shadows.sm, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <Ionicons name="options-outline" size={19} color={theme.colors.text} />
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="search"
            accessibilityLabel="Trabzon'da ara"
            onPress={() => setSearchOpen(true)}
            style={[
              styles.searchBar,
              theme.shadows.sm,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="search-outline" size={18} color={theme.colors.textTertiary} />
            <AppText variant="body" color="textTertiary" style={styles.flex} numberOfLines={1}>
              Trabzon’da yer, işletme veya emlak ara…
            </AppText>
            <Ionicons name="map-outline" size={18} color={theme.colors.textTertiary} />
          </Pressable>

          <ExploreCategoryChips
            categories={bootstrap.data?.place_categories ?? []}
            selected={categorySlugs}
            onToggle={toggleCategory}
            onReset={() => setCategorySlugs([])}
            showPlaces={showPlaces}
            onTogglePlaces={() => {
              setShowPlaces((value) => {
                if (value && !showRealEstate) {
                  showBanner('En az bir katman açık kalmalı.');
                  return value;
                }
                return !value;
              });
            }}
            showRealEstate={showRealEstate}
            onToggleRealEstate={() => {
              setShowRealEstate((value) => {
                if (value && !showPlaces) {
                  showBanner('En az bir katman açık kalmalı.');
                  return value;
                }
                return !value;
              });
            }}
          />

          {banner ? (
            <View style={[styles.banner, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary }]}>
              <Ionicons name="information-circle" size={15} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep" style={styles.flex}>
                {banner}
              </AppText>
            </View>
          ) : null}

          {loadingMarkers && allMarkers.length === 0 ? (
            <View style={[styles.loadingPill, { backgroundColor: theme.colors.surface }]}>
              <Skeleton height={14} width={120} radius={7} />
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
                  Parmağınla kapalı bir alan çiz · {drawn.length} nokta
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Çizimi iptal et"
                hitSlop={6}
                onPress={handleDrawCancel}
              >
                <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.drawActions}>
              <Button
                label="Geri al"
                variant="outline"
                size="sm"
                disabled={drawn.length === 0}
                onPress={() => setDrawUndo((value) => value + 1)}
                style={styles.flex}
              />
              <Button
                label="Temizle"
                variant="outline"
                size="sm"
                disabled={drawn.length === 0}
                onPress={() => {
                  setDrawn([]);
                  setDrawClear((value) => value + 1);
                }}
                style={styles.flex}
              />
              <Button
                label={areaSearch.isPending ? 'Aranıyor…' : 'Bu alanda ara'}
                size="sm"
                disabled={drawn.length < 3 || areaSearch.isPending}
                onPress={handleDrawComplete}
                style={styles.flex}
              />
            </View>
          </View>
        </View>
      )}

      {!drawing ? (
        <View style={[styles.sideControls, { top: insets.top + 196 }]}>
          <SideButton icon="locate" label="Konumum" busy={location.requesting} onPress={() => void goMyLocation()} />
          <SideButton
            icon="pencil"
            label="Alan çiz"
            active={drawing}
            onPress={handleDrawStart}
          />
          <SideButton
            icon="list"
            label="Liste"
            onPress={() => setSheet('list')}
          />
          <SideButton
            icon="bookmark"
            label="Aramalar"
            onPress={() => setSheet('saved')}
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
              bottom: Math.max(insets.bottom, 8) + (selectedMarker ? 226 : 6),
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

      {routeBusy ? (
        <View style={[styles.routeBusy, { bottom: insets.bottom + 108, backgroundColor: theme.colors.surface }]}>
          <AppText variant="caption" color="textSecondary">
            Güzergâh hesaplanıyor…
          </AppText>
        </View>
      ) : null}

      {!drawing && selectedMarker ? (
        <View style={[styles.cardWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <ExploreMarkerCard
            marker={selectedMarker}
            favoritePending={favoritePlace.isPending || favoriteListing.isPending}
            onClose={() => setSelectedPoint(null)}
            onOpen={() => {
              if (selectedMarker.kind === 'place') {
                setDetailId(selectedMarker.id);
              } else {
                router.push(`/marketplace/real-estate/${selectedMarker.id}` as never);
              }
            }}
            onDirections={() => void handleDirections({ lat: selectedMarker.lat, lng: selectedMarker.lng })}
            onToggleFavorite={favoriteMarker}
            onReport={reportMarker}
          />
        </View>
      ) : null}

      {!drawing && !selectedMarker && allMarkers.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Haritadaki sonuçları listele"
          onPress={() => setSheet('list')}
          style={[
            styles.listPill,
            theme.shadows.sm,
            { bottom: insets.bottom + 16, backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="list" size={16} color={theme.colors.primaryDeep} />
          <AppText variant="label" color="primaryDeep">
            {allMarkers.length} sonucu listele
          </AppText>
        </Pressable>
      ) : null}

      {bootError ? (
        <View style={styles.errorOverlay}>
          <View style={[styles.errorCard, { backgroundColor: theme.colors.surface }]}>
            <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.textTertiary} />
            <AppText variant="bodyStrong">Hizmet alanı yüklenemedi</AppText>
            <AppText variant="caption" color="textTertiary" align="center">
              {bootstrap.error?.message ?? 'Bağlantını kontrol edip tekrar dene.'}
            </AppText>
            <Button label="Tekrar dene" variant="secondary" onPress={() => void bootstrap.refetch()} />
          </View>
        </View>
      ) : null}

      {queryError ? (
        <View style={[styles.queryError, { bottom: insets.bottom + 78 }]}>
          <AppText variant="caption" color="danger">
            Harita kayıtları alınamadı. Yakınlaştırıp tekrar dene.
          </AppText>
        </View>
      ) : null}

      <ExploreSearchSheet
        visible={searchOpen}
        query={searchQuery}
        onQueryChange={(value) => {
          setSearchQuery(value);
          if (debounceRef.current) {
            clearTimeout(debounceRef.current);
          }
          debounceRef.current = setTimeout(() => setDebouncedQuery(value), 320);
        }}
        results={search.data?.items ?? []}
        loading={search.isLoading || search.isFetching}
        onClose={() => setSearchOpen(false)}
        onSelect={focusSearchItem}
      />

      <ExploreFilterSheet
        visible={sheet === 'filter'}
        districts={bootstrap.data?.districts ?? []}
        filters={filters}
        onClose={() => setSheet(null)}
        onApply={(next) => {
          setFilters(next);
          setSheet(null);
          if (next.districtId != null) {
            const district = bootstrap.data?.districts.find((item) => item.id === next.districtId);
            if (district?.lat != null && district.lng != null) {
              moveCamera({ lat: district.lat, lng: district.lng, zoom: 13 });
            }
          }
        }}
        onDistrictFocus={(district) => {
          if (district.lat != null && district.lng != null) {
            moveCamera({ lat: district.lat, lng: district.lng, zoom: 13 });
          }
        }}
      />

      <MapListSheet
        visible={sheet === 'list'}
        markers={allMarkers}
        total={allMarkers.length}
        truncated={Boolean(placesQuery.data?.truncated || listingsQuery.data?.truncated)}
        onClose={() => setSheet(null)}
        onSelect={(marker) => {
          setSheet(null);
          const point = toMapPoints([marker])[0];
          if (point) {
            setSelectedPoint(point);
            moveCamera({ lat: marker.lat, lng: marker.lng, zoom: Math.max(camera.zoom, 14) });
          }
        }}
      />

      <SavedAreasSheet
        visible={sheet === 'saved'}
        areas={savedAreas.data ?? []}
        onClose={() => setSheet(null)}
        onOpenArea={openSavedArea}
        onDelete={(area) =>
          Alert.alert('Aramayı sil', `“${area.label}” kalıcı olarak silinsin mi?`, [
            { text: 'Vazgeç', style: 'cancel' },
            {
              text: 'Sil',
              style: 'destructive',
              onPress: () =>
                deleteArea.mutate(area.id, {
                  onSuccess: () => showBanner('Kayıtlı arama silindi.'),
                  onError: (error) => Alert.alert('Silinemedi', error.message),
                }),
            },
          ])
        }
      />

      <AreaResultSheet
        visible={areaOpen}
        result={areaResult}
        onClose={() => setAreaOpen(false)}
        onEdit={() => {
          setAreaOpen(false);
          handleDrawStart();
        }}
        onSave={() => {
          setAreaOpen(false);
          setSaveLabel(defaultSaveLabel);
          setSheet('save-area');
        }}
        onSelectPlace={(place) => {
          setAreaOpen(false);
          setDetailId(place.id);
        }}
        onSelectListing={(listing) => {
          setAreaOpen(false);
          router.push(`/marketplace/real-estate/${listing.id}` as never);
        }}
      />

      <SaveAreaSheet
        visible={sheet === 'save-area'}
        defaultLabel={saveLabel}
        loading={saveArea.isPending}
        onClose={() => setSheet(null)}
        onSave={handleSaveArea}
      />

      <PlaceDetailSheet
        visible={Boolean(detailId)}
        placeId={detailId}
        onClose={() => {
          setDetailId(null);
          void placesQuery.refetch();
        }}
        onManage={(id) => {
          setDetailId(null);
          router.push(`/business/${id}` as never);
        }}
      />

      <PlaceSuggestModal
        visible={suggestOpen}
        initial={location.point ?? { lat: camera.lat, lng: camera.lng }}
        onClose={() => setSuggestOpen(false)}
        onSubmitted={() => {
          setSuggestOpen(false);
          showBanner('Önerin moderasyon kuyruğuna alındı.');
        }}
      />
    </View>
  );
}

function SideButton({
  icon,
  label,
  onPress,
  busy,
  active,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  busy?: boolean;
  active?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.sideButton, { backgroundColor: active ? theme.colors.primary : theme.colors.surface, borderColor: theme.colors.border }]}
    >
      <Ionicons name={icon} size={19} color={active ? theme.colors.onPrimary : theme.colors.text} />
      <AppText variant="caption" style={{ color: active ? theme.colors.onPrimary : theme.colors.textSecondary, fontSize: 10 }}>
        {busy ? '…' : label}
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 46,
    marginHorizontal: 14,
    paddingHorizontal: 13,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  loadingPill: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  drawTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14 },
  drawCard: { gap: 10, padding: 12, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  drawHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drawActions: { flexDirection: 'row', gap: 8 },
  sideControls: { position: 'absolute', right: 12, gap: 8 },
  sideButton: {
    width: 54,
    paddingVertical: 7,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 2,
  },
  cardWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10 },
  listPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  routeBusy: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  attribution: {
    position: 'absolute',
    left: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attributionText: { fontSize: 9 },
  errorOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorCard: { alignItems: 'center', gap: 9, padding: 20, borderRadius: 20, maxWidth: 320 },
  queryError: { position: 'absolute', alignSelf: 'center' },
});
