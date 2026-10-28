import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';
import { haptics } from '@/utils/haptics';

import { MapFloatingControls, MapModeChips, type MapControlKey } from '@/features/map/components/MapChrome';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import { MapDiscoveryPanel, type PanelState } from '@/features/map/components/MapDiscoveryPanel';
import { MapFriendsSheet } from '@/features/map/components/MapFriendsSheet';
import { MapLayersSheet } from '@/features/map/components/MapLayersSheet';
import { MapMyMapSheet } from '@/features/map/components/MapMyMapSheet';
import { MapOnboarding } from '@/features/map/components/MapOnboarding';
import { MapPrivacySheet, type StartShareInput } from '@/features/map/components/MapPrivacySheet';
import { MapQuickSheet } from '@/features/map/components/MapQuickSheet';
import { MapSearchSheet } from '@/features/map/components/MapSearchSheet';
import type { MapFocus } from '@/features/map/components/map-canvas-types';
import { MAP_DEFAULT_CAMERA, MAP_DENSITY_POINT_LIMIT, MAP_LAYER_LIST, type QuickActionKey } from '@/features/map/constants';
import {
  useAddSavedPlace,
  useDeleteSavedPlace,
  useDeviceLocation,
  useLocationPulse,
  useMapExplore,
  useMapFriends,
  useMapPreferences,
  useRegions,
  useSaveMapPreferences,
  useSavedPlaces,
  useShareHeartbeat,
  useStartLocationShare,
  useStopAllSharing,
  useStopLocationShare,
  useUnfollowRegion,
} from '@/features/map/hooks/use-map';
import { fetchRoute, hasMapboxToken, mapApiMessage, reverseGeocode } from '@/features/map/services/map-service';
import type {
  LatLng,
  MapCamera,
  MapDensity,
  MapLayerKey,
  MapMode,
  MapPoint,
  MapPreferences,
  MapSearchResult,
  MapVisibility,
} from '@/features/map/types';
import { boundsOf, clamp, zoomForBounds } from '@/features/map/utils/geo';
import { clusterPoints } from '@/features/map/utils/cluster';
import { formatMinutesLeft } from '@/features/map/utils/map-theme';

type SheetKey = 'layers' | 'quick' | 'friends' | 'search' | 'privacy' | 'mymap' | 'onboarding' | null;

const DEFAULT_LAYERS = MAP_LAYER_LIST.reduce(
  (accumulator, layer) => {
    accumulator[layer.key] = layer.ready && (layer.key === 'friends' || layer.key === 'rides');
    return accumulator;
  },
  {} as Record<MapLayerKey, boolean>,
);

function radiusForZoom(zoom: number): number {
  return clamp(30 * 2 ** (12 - zoom), 2, 200);
}

export default function MapScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ lat?: string; lng?: string; zoom?: string; label?: string }>();
  const prefsQuery = useMapPreferences();

  const deepLink = useMemo<MapPoint | null>(() => {
    const first = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;
    const lat = Number(first(params.lat));
    const lng = Number(first(params.lng));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }
    const zoomValue = Number(first(params.zoom));
    return {
      id: `link:${lat.toFixed(5)}:${lng.toFixed(5)}`,
      kind: 'place',
      lat,
      lng,
      title: first(params.label) ?? 'Paylaşılan konum',
      subtitle: 'Paylaşılan harita bağlantısı',
      meta: Number.isFinite(zoomValue) ? { zoom: zoomValue } : {},
    };
  }, [params.lat, params.lng, params.zoom, params.label]);

  if (prefsQuery.isLoading) {
    return <MapPlaceholder onBack={() => router.back()} message="Harita tercihleri yükleniyor" loading />;
  }

  if (!prefsQuery.data) {
    return (
      <MapPlaceholder
        onBack={() => router.back()}
        message={prefsQuery.error?.message ?? 'Harita tercihleri alınamadı.'}
        onRetry={() => void prefsQuery.refetch()}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <MapExperience prefs={prefsQuery.data} topInset={insets.top} deepLink={deepLink} />
    </View>
  );
}

function MapPlaceholder({
  message,
  loading,
  onRetry,
  onBack,
}: {
  message: string;
  loading?: boolean;
  onRetry?: () => void;
  onBack: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background, paddingTop: insets.top + 6 }]}>
      <View style={[styles.topRow, styles.placeholderHead]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Geri"
          hitSlop={8}
          onPress={onBack}
          style={[styles.iconButton, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
        </Pressable>
        <AppText variant="h3">Etkileşim Haritası</AppText>
      </View>

      <View style={styles.placeholderBody}>
        {loading ? <ActivityIndicator color={theme.colors.primary} /> : null}
        <Ionicons
          name={loading ? 'map-outline' : 'cloud-offline-outline'}
          size={26}
          color={theme.colors.textTertiary}
        />
        <AppText variant="body" color="textSecondary" align="center">
          {message}
        </AppText>
        {onRetry ? (
          <Button label="Yeniden dene" variant="secondary" size="sm" fullWidth={false} onPress={onRetry} />
        ) : null}
      </View>
    </View>
  );
}

function MapExperience({
  prefs,
  topInset,
  deepLink,
}: {
  prefs: MapPreferences;
  topInset: number;
  deepLink: MapPoint | null;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Üstteki yüzen katmanın gerçek yüksekliği; harita kontrolleri bunun altına
  // yerleşir. Ölçüm yapılmadan önce makul bir varsayılan kullanılır.
  const [headerHeight, setHeaderHeight] = useState(0);

  const savePrefs = useSaveMapPreferences();
  // React Query her render'da yeni bir sonuc nesnesi dondurur; `mutate` ve
  // `mutateAsync` ise sabit referanstir. Efekt/callback bagimliliklarina nesnenin
  // kendisi verilirse referans her render'da degisir, `useFocusEffect` her
  // render'da sokulup yeniden kurulur ve kaydet -> render -> kaydet dongusu olusur.
  const savePrefsNow = savePrefs.mutate;
  const saveLastViewOnBlur = savePrefs.mutateAsync;

  const friendsQuery = useMapFriends(Boolean(prefs));
  const savedQuery = useSavedPlaces(Boolean(prefs));
  const regionsQuery = useRegions(Boolean(prefs));
  const addSaved = useAddSavedPlace();
  const deleteSaved = useDeleteSavedPlace();
  const unfollowRegion = useUnfollowRegion();

  const startShare = useStartLocationShare();
  const stopShare = useStopLocationShare();
  const stopAll = useStopAllSharing();
  // Mutation sonucu nesnesi her render'da yenilenir; callback bagimliliklarinda
  // sabit olan `mutate` referanslari kullanilir.
  const addSavedPlace = addSaved.mutate;
  const startShareNow = startShare.mutate;
  const stopAllSharing = stopAll.mutate;

  const location = useDeviceLocation(true);

  const restoredCamera = useMemo<MapCamera>(() => {
    if (prefs.lastView.lat != null && prefs.lastView.lng != null) {
      return {
        lat: prefs.lastView.lat,
        lng: prefs.lastView.lng,
        zoom: prefs.lastView.zoom ?? MAP_DEFAULT_CAMERA.zoom,
      };
    }
    return MAP_DEFAULT_CAMERA;
  }, [prefs.lastView.lat, prefs.lastView.lng, prefs.lastView.zoom]);

  const [camera, setCamera] = useState<MapCamera>(
    deepLink ? { lat: deepLink.lat, lng: deepLink.lng, zoom: 15 } : restoredCamera,
  );
  const [settledCamera, setSettledCamera] = useState<MapCamera>(
    deepLink ? { lat: deepLink.lat, lng: deepLink.lng, zoom: 15 } : restoredCamera,
  );
  const [focus, setFocus] = useState<MapFocus | null>(
    deepLink ? { camera: { lat: deepLink.lat, lng: deepLink.lng, zoom: 15 }, nonce: 1 } : null,
  );
  const [mode, setMode] = useState<MapMode>(prefs.activeMode);
  const [layers, setLayers] = useState<Record<MapLayerKey, boolean>>({ ...DEFAULT_LAYERS, ...prefs.layers });
  const [density, setDensity] = useState<MapDensity>(prefs.density);
  const [panel, setPanel] = useState<PanelState>(deepLink ? 'half' : 'compact');
  const [sheet, setSheet] = useState<SheetKey>(prefs.onboardingDone ? null : 'onboarding');
  const [selected, setSelected] = useState<MapPoint | null>(deepLink);
  const [searchedPin, setSearchedPin] = useState<MapPoint | null>(null);
  const [routeLine, setRouteLine] = useState<LatLng[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);

  const cameraRef = useRef(camera);
  const cameraTick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCamera = useRef<MapCamera | null>(null);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    return () => {
      if (cameraTick.current) {
        clearTimeout(cameraTick.current);
      }
    };
  }, []);

  const handleCameraChange = useCallback((next: MapCamera) => {
    pendingCamera.current = next;
    if (cameraTick.current) {
      return;
    }
    cameraTick.current = setTimeout(() => {
      cameraTick.current = null;
      if (pendingCamera.current) {
        setCamera(pendingCamera.current);
      }
    }, 240);
  }, []);

  useEffect(() => {
    if (!banner) {
      return;
    }
    const timer = setTimeout(() => setBanner(null), 4200);
    return () => clearTimeout(timer);
  }, [banner]);

  // Kamera hareketi durduktan sonra sorgu atılır: her pikselde istek gitmez.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettledCamera(camera);
    }, 600);
    return () => clearTimeout(timer);
  }, [camera]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        void saveLastViewOnBlur({ last_view: cameraRef.current }).catch(() => undefined);
      };
    }, [saveLastViewOnBlur]),
  );

  const activeLayers = useMemo(
    () => (Object.keys(layers) as MapLayerKey[]).filter((key) => layers[key]),
    [layers],
  );

  const explore = useMapExplore({
    camera: settledCamera,
    layers: activeLayers,
    radiusKm: radiusForZoom(settledCamera.zoom),
    enabled: Boolean(prefs),
  });

  const points = useMemo(() => {
    const raw = explore.data?.points ?? [];
    const clustered = clusterPoints(raw, camera.zoom);
    return clustered.slice(0, MAP_DENSITY_POINT_LIMIT[density]);
  }, [camera.zoom, density, explore.data?.points]);

  const markers = useMemo(() => {
    if (searchedPin && !points.some((point) => point.id === searchedPin.id)) {
      return [...points, searchedPin];
    }
    return points;
  }, [points, searchedPin]);

  const shareActive = Boolean(prefs.activeShare);
  useLocationPulse(shareActive, location.refresh);
  useShareHeartbeat(shareActive && location.status === 'granted', location.point);

  // Harita tam ekran: güzergâh sığdırma hesabı da ekranın tamamını kullanır.
  const mapSize = useMemo(() => ({ width, height }), [height, width]);

  const moveCamera = useCallback((next: MapCamera) => {
    if (cameraTick.current) {
      clearTimeout(cameraTick.current);
      cameraTick.current = null;
    }
    pendingCamera.current = next;
    setCamera(next);
    setFocus({ camera: next, nonce: Date.now() });
  }, []);

  const showBanner = (message: string) => setBanner(message);

  const handlePatch = useCallback(
    (patch: {
      visibility?: MapVisibility;
      precision?: 'approximate' | 'exact';
      default_share_minutes?: number;
      ghost_mode?: boolean;
    }) => {
      savePrefsNow(patch, {
        onError: (error) => Alert.alert('Tercih kaydedilemedi', error.message),
      });
    },
    [savePrefsNow],
  );

  const handleStartShare = useCallback(
    async (input: StartShareInput) => {
      setShareError(null);
      let point = location.point;
      if (!point) {
        point = await location.request();
      }
      if (!point) {
        setShareError('Konum alınamadı. Cihaz konum iznini kontrol edip tekrar dene.');
        return;
      }
      startShareNow(
        {
          lat: point.lat,
          lng: point.lng,
          precise: input.precise,
          minutes: input.minutes,
          audience: input.audience,
          viewers: input.viewers,
        },
        {
          onSuccess: () => {
            showBanner('Süreli konum paylaşımı başladı. Süre dolunca erişim kapanır.');
            setSheet(null);
          },
          onError: (error) => setShareError(error.message),
        },
      );
    },
    [location, startShareNow],
  );

  const handleLocate = useCallback(async () => {
    const point = location.point ?? (await location.request());
    if (!point) {
      Alert.alert(
        'Konum alınamadı',
        'Konum izni verilmediyse haritayı şehir ve mekân aramasıyla kullanmaya devam edebilirsin.',
      );
      return;
    }
    moveCamera({ lat: point.lat, lng: point.lng, zoom: 15 });
    setPanel((current) => (current === 'expanded' ? 'half' : current));
  }, [location, moveCamera]);

  const handleDirections = useCallback(
    async (target: LatLng) => {
      if (!hasMapboxToken()) {
        Alert.alert('Güzergâh kullanılamıyor', mapApiMessage('no_token'));
        return;
      }
      const origin = location.point ?? { lat: camera.lat, lng: camera.lng };
      setRouteBusy(true);
      const response = await fetchRoute({ origin, dest: target });
      setRouteBusy(false);
      if (!response.ok) {
        Alert.alert('Güzergâh oluşturulamadı', mapApiMessage(response.reason));
        return;
      }
      setRouteLine(response.data.geometry);
      const bounds = boundsOf([origin, target, ...response.data.geometry]);
      if (bounds) {
        const zoom = zoomForBounds(bounds, mapSize);
        moveCamera({
          lat: (bounds.north + bounds.south) / 2,
          lng: (bounds.east + bounds.west) / 2,
          zoom,
        });
      }
      setPanel('half');
      showBanner(
        `Güzergâh hazır · ${(response.data.distanceMeters / 1000).toFixed(1)} km · ~${response.data.durationMinutes} dk`,
      );
    },
    [camera.lat, camera.lng, location.point, mapSize, moveCamera],
  );

  const handleControl = useCallback(
    (key: MapControlKey) => {
      switch (key) {
        case 'layers':
          setSheet('layers');
          return;
        case 'locate':
          void handleLocate();
          return;
        case 'safety':
          setSheet('privacy');
          return;
        case 'expand':
          setPanel((current) => (current === 'expanded' ? 'compact' : 'expanded'));
          return;
        case 'quick':
          setSheet('quick');
          return;
        default:
          return;
      }
    },
    [handleLocate],
  );

  const handleMode = useCallback(
    (next: MapMode) => {
      setMode(next);
      setRouteLine(null);
      // Mod geçişinde kamera korunur; harita yeniden oluşturulmaz.
      savePrefsNow({ active_mode: next });
    },
    [savePrefsNow],
  );

  const handleToggleLayer = useCallback(
    (key: MapLayerKey) => {
      const next = { ...layers, [key]: !layers[key] };
      setLayers(next);
      // Yan etki state guncelleyicisinin icinde degil, disinda calisir.
      savePrefsNow({ layers: next });
    },
    [layers, savePrefsNow],
  );

  const handleQuick = useCallback(
    (key: QuickActionKey) => {
      setSheet(null);
      switch (key) {
        case 'find_ride':
          router.push('/ride/search');
          return;
        case 'publish_ride':
          router.push('/ride/create');
          return;
        case 'share_location':
        case 'safety':
          setSheet('privacy');
          return;
        case 'friends':
          setSheet('friends');
          return;
        case 'discover_places':
          router.push('/discover');
          return;
        default:
          return;
      }
    },
    [router],
  );

  const handleSearchPick = useCallback(
    (result: MapSearchResult) => {
      const pin: MapPoint = {
        id: `search:${result.id}`,
        kind: 'place',
        lat: result.lat,
        lng: result.lng,
        title: result.shortLabel,
        subtitle: result.label,
      };
      setSearchedPin(pin);
      setSelected(pin);
      setPanel('half');
      setSheet(null);
      moveCamera({ lat: result.lat, lng: result.lng, zoom: result.kind === 'city' ? 11 : 15 });
    },
    [moveCamera],
  );

  const handleSaveResult = useCallback(
    (result: MapSearchResult) => {
      addSavedPlace(
        {
          title: result.shortLabel,
          lat: result.lat,
          lng: result.lng,
          address: result.label,
          category: result.kind,
        },
        {
          onSuccess: () => showBanner(`${result.shortLabel} kaydedildi.`),
          onError: (error) => Alert.alert('Yer kaydedilemedi', error.message),
        },
      );
    },
    [addSavedPlace],
  );

  const handlePanic = useCallback(() => {
    Alert.alert(
      'Tüm paylaşımı durdur',
      'Aktif konum paylaşımların ve görünürlüğün kapatılacak. Devam edilsin mi?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Durdur',
          style: 'destructive',
          onPress: () => {
            stopAllSharing(undefined, {
              onSuccess: () => {
                showBanner('Tüm konum paylaşımı durduruldu. Hayalet moduna geçildi.');
                setSheet(null);
              },
              onError: (error) => Alert.alert('İşlem tamamlanamadı', error.message),
            });
          },
        },
      ],
    );
  }, [stopAllSharing]);

  const ghost = prefs.ghostMode;
  const privacyLabel = prefs.activeShare
    ? `Paylaşım · ${formatMinutesLeft(prefs.activeShare.expires_at) ?? 'aktif'}`
    : ghost
      ? 'Hayalet modu'
      : prefs.visibility === 'selected'
        ? 'Seçili kişiler'
        : 'Arkadaşlar';

  // Alt panelin kompakt yüksekliği: harita üzerindeki geçici rozetler bunun
  // üstünde durur ki panelin arkasında kalmasın.
  const panelCompactHeight = 118 + Math.max(insets.bottom, 8);

  return (
    <View style={styles.root}>
      {/* Harita tüm ekranı kaplar; başlık, arama ve panel üzerinde yüzer. */}
      <View style={StyleSheet.absoluteFill}>
        <MapCanvas
          initialCamera={camera}
          focus={focus}
          markers={markers}
          route={routeLine}
          userLocation={location.status === 'granted' ? location.point : null}
          dark={theme.scheme === 'dark'}
          onMarkerPress={(point) => {
            haptics.tap();
            setSelected(point);
            setPanel((current) => (current === 'compact' ? 'half' : current));
          }}
          onCameraChange={handleCameraChange}
          onMapPress={(point) => {
            const id = `tap:${point.lat.toFixed(4)}:${point.lng.toFixed(4)}`;
            const pin: MapPoint = {
              id,
              kind: 'place',
              lat: point.lat,
              lng: point.lng,
              title: 'Seçilen nokta',
              subtitle: `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
            };
            setSearchedPin(pin);
            setSelected(pin);
            setPanel((current) => (current === 'compact' ? 'half' : current));
            void reverseGeocode(point).then((result) => {
              if (!result.ok) {
                return;
              }
              const relabel = (current: MapPoint | null) =>
                current && current.id === id ? { ...current, title: result.data } : current;
              setSearchedPin(relabel);
              setSelected(relabel);
            });
          }}
        />

        <MapFloatingControls
          onAction={handleControl}
          ghost={ghost}
          expanded={panel === 'expanded'}
          locating={location.requesting}
          topOffset={headerHeight + 12}
        />
      </View>

      {/* Üst kenarda okunabilirlik için yumuşak geçiş; haritayı kapatmaz. */}
      <LinearGradient
        pointerEvents="none"
        colors={[
          `${theme.colors.background}D9`,
          `${theme.colors.background}66`,
          `${theme.colors.background}00`,
        ]}
        locations={[0, 0.55, 1]}
        style={[styles.topScrim, { height: headerHeight + 24 }]}
      />

      {routeBusy ? (
        <View
          style={[
            styles.routeBadge,
            { bottom: panelCompactHeight + 12, backgroundColor: theme.colors.surface },
          ]}
        >
          <AppText variant="caption" color="textSecondary">
            Güzergâh hesaplanıyor…
          </AppText>
        </View>
      ) : null}

      <View
        pointerEvents="box-none"
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        style={[styles.topOverlay, { paddingTop: topInset + 6 }]}
      >
        <View style={styles.topRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Geri"
            hitSlop={8}
            onPress={() => router.back()}
            style={[
              styles.iconButton,
              theme.shadows.sm,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
          </Pressable>

          <View style={styles.flex} pointerEvents="none">
            <AppText variant="h3" numberOfLines={1}>
              Etkileşim Haritası
            </AppText>
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              Trabzon · {radiusForZoom(camera.zoom)} km yarıçap
            </AppText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Trabzon Keşfet haritası"
            hitSlop={6}
            onPress={() => {
              haptics.tap();
              router.push('/explore' as never);
            }}
            style={[
              styles.iconButton,
              theme.shadows.sm,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="compass-outline" size={19} color={theme.colors.primaryDeep} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Benim haritam"
            hitSlop={6}
            onPress={() => {
              haptics.tap();
              setSheet('mymap');
            }}
            style={[
              styles.iconButton,
              theme.shadows.sm,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="bookmark-outline" size={19} color={theme.colors.text} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Gizlilik: ${privacyLabel}`}
            onPress={() => {
              haptics.tap();
              setSheet('privacy');
            }}
            style={[
              styles.privacyChip,
              theme.shadows.sm,
              {
                backgroundColor: ghost ? `${theme.colors.success}1F` : `${theme.colors.warning}1F`,
                borderColor: ghost ? `${theme.colors.success}55` : `${theme.colors.warning}55`,
              },
            ]}
          >
            <Ionicons
              name={ghost ? 'eye-off-outline' : 'location'}
              size={13}
              color={ghost ? theme.colors.success : theme.colors.warning}
            />
            <AppText variant="caption" style={{ color: ghost ? theme.colors.success : theme.colors.warning }}>
              {privacyLabel}
            </AppText>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Haritada ara"
          onPress={() => {
            haptics.tap();
            setSheet('search');
          }}
          style={({ pressed }) => [
            styles.searchBar,
            theme.shadows.sm,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Ionicons name="search-outline" size={18} color={theme.colors.textTertiary} />
          <AppText variant="body" color="textTertiary" style={styles.flex} numberOfLines={1}>
            Şehir, mekân veya adres ara
          </AppText>
          <Ionicons name="mic-outline" size={18} color={theme.colors.textTertiary} />
        </Pressable>

        <MapModeChips mode={mode} onChange={handleMode} />

        {banner ? (
          <View
            style={[
              styles.banner,
              { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary },
            ]}
          >
            <Ionicons name="information-circle" size={15} color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="primaryDeep" style={styles.flex}>
              {banner}
            </AppText>
          </View>
        ) : null}
      </View>

      <MapDiscoveryPanel
        state={panel}
        onChangeState={setPanel}
        points={markers}
        counts={explore.data?.counts ?? { friends: 0, rides: 0 }}
        selected={selected}
        loading={explore.isFetching}
        error={explore.isError ? explore.error.message : null}
        onRetry={() => void explore.refetch()}
        onSelectPoint={(point) => {
          setSelected(point);
          setSearchedPin(null);
        }}
        onClearSelection={() => setSelected(null)}
        onZoomIn={() => {
          if (!selected) {
            return;
          }
          moveCamera({ lat: selected.lat, lng: selected.lng, zoom: clamp(camera.zoom + 2, 3, 18) });
        }}
        onDirections={(target) => void handleDirections(target)}
        mode={mode}
        radiusKm={radiusForZoom(settledCamera.zoom)}
        updatedAt={explore.data?.generatedAt ?? null}
      />

      {sheet === 'layers' ? (
        <MapLayersSheet
          visible
          onClose={() => setSheet(null)}
          layers={layers}
          density={density}
          onToggle={handleToggleLayer}
          onDensity={(next) => {
            setDensity(next);
            savePrefs.mutate({ density: next });
          }}
        />
      ) : null}

      {sheet === 'quick' ? (
        <MapQuickSheet visible onClose={() => setSheet(null)} onSelect={handleQuick} />
      ) : null}

      {sheet === 'friends' ? (
        <MapFriendsSheet
          visible
          onClose={() => setSheet(null)}
          friends={friendsQuery.data ?? []}
          loading={friendsQuery.isLoading}
        />
      ) : null}

      {sheet === 'search' ? (
        <MapSearchSheet
          visible
          onClose={() => setSheet(null)}
          onPick={handleSearchPick}
          onSaveResult={handleSaveResult}
          onPickSaved={(place) => {
            const pin: MapPoint = {
              id: `saved:${place.id}`,
              kind: 'place',
              lat: place.lat,
              lng: place.lng,
              title: place.title,
              subtitle: place.address,
            };
            setSearchedPin(pin);
            setSelected(pin);
            setPanel('half');
            setSheet(null);
            moveCamera({ lat: place.lat, lng: place.lng, zoom: 15 });
          }}
          proximity={location.point ?? { lat: camera.lat, lng: camera.lng }}
          saved={savedQuery.data ?? []}
        />
      ) : null}

      {sheet === 'privacy' ? (
        <MapPrivacySheet
          visible
          onClose={() => setSheet(null)}
          prefs={prefs}
          friends={friendsQuery.data ?? []}
          friendsLoading={friendsQuery.isLoading}
          saving={savePrefs.isPending}
          shareBusy={startShare.isPending || stopShare.isPending || stopAll.isPending}
          shareError={shareError}
          locationStatus={location.status}
          onRequestLocation={() => void location.request()}
          onPatch={handlePatch}
          onStartShare={(input) => void handleStartShare(input)}
          onStopShare={() =>
            stopShare.mutate(undefined, {
              onSuccess: () => showBanner('Konum paylaşımı durduruldu.'),
              onError: (error) => setShareError(error.message),
            })
          }
          onPanic={handlePanic}
        />
      ) : null}

      {sheet === 'mymap' ? (
        <MapMyMapSheet
          visible
          onClose={() => setSheet(null)}
          prefs={prefs}
          savedPlaces={savedQuery.data ?? []}
          regions={regionsQuery.data ?? []}
          onDeletePlace={(id) => deleteSaved.mutate(id)}
          onUnfollowRegion={(id) => unfollowRegion.mutate(id)}
          onStopShare={() => stopShare.mutate()}
          onOpenSearch={() => setSheet('search')}
          onOpenSafety={() => setSheet('privacy')}
        />
      ) : null}

      {sheet === 'onboarding' ? (
        <MapOnboarding
          visible
          onDone={() => {
            setSheet(null);
            savePrefs.mutate({ onboarding_done: true });
          }}
          onRequestLocation={() => {
            void location.request().then((point) => {
              if (point) {
                showBanner('Konum izni verildi. Paylaşımı yalnızca sen başlattığında kullanılır.');
              }
            });
          }}
          requestingLocation={location.requesting}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Harita tam ekran olduğu için tüm arayüz haritanın üzerine mutlak konumla
  // yerleşir; box-none sayesinde boş alanlarda harita hareketi engellenmez.
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    gap: 10,
  },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 130,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 46,
    paddingHorizontal: 13,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  placeholderHead: { paddingHorizontal: 16, paddingTop: 6 },
  placeholderBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  routeBadge: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
});
