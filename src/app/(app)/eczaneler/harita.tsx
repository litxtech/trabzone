import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, IconButton, Screen, SelectSheet } from '@/components/ui';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import { useDeviceLocation } from '@/features/map/hooks/use-map';
import type { MapCamera, MapPoint } from '@/features/map/types';
import { PharmacyActions } from '@/features/pharmacy/components/PharmacyActions';
import { PharmacyStatusBadge } from '@/features/pharmacy/components/PharmacyStatusBadge';
import { usePharmacyBootstrap, usePharmaciesMap, usePharmacyDetail } from '@/features/pharmacy/hooks/use-pharmacy';
import type { PharmacyMapItem } from '@/features/pharmacy/types';
import {
  PHARMACY_MAP_DEFAULT_CAMERA,
  bboxFromCamera,
  mapLegendTone,
  pharmacyMarkers,
} from '@/features/pharmacy/utils/map';
import {
  describePharmacyState,
  formatDutyWindow,
  staleNotice,
} from '@/features/pharmacy/utils/status';
import { useTheme } from '@/theme/ThemeProvider';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useRouter } from '@/utils/router';

export default function PharmacyMapScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ district?: string; lat?: string; lng?: string }>();
  const location = useDeviceLocation(false);
  const bootstrap = usePharmacyBootstrap();

  const initialCamera = useMemo<MapCamera>(() => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
      return { lat, lng, zoom: 15 };
    }
    return PHARMACY_MAP_DEFAULT_CAMERA;
  }, [params.lat, params.lng]);

  const [camera, setCamera] = useState<MapCamera>(initialCamera);
  const [focus, setFocus] = useState<{ camera: MapCamera; nonce: number } | null>(null);
  const [district, setDistrict] = useState<string | null>(params.district?.trim() || null);
  const [onlyDuty, setOnlyDuty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [districtPicker, setDistrictPicker] = useState(false);

  const debouncedCamera = useDebouncedValue(camera, 420);
  const bbox = useMemo(
    () => bboxFromCamera(debouncedCamera, { width, height }),
    [debouncedCamera, width, height],
  );

  const map = usePharmaciesMap(bbox, { district, onlyDuty });
  const items = useMemo(() => map.data?.items ?? [], [map.data?.items]);
  const markers = useMemo(() => pharmacyMarkers(items), [items]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const detail = usePharmacyDetail(selected?.slug ?? null);

  const districts = useMemo(
    () => (bootstrap.data?.districts ?? []).map((entry) => entry.name),
    [bootstrap.data?.districts],
  );

  const onMarkerPress = (point: MapPoint) => {
    setSelectedId(point.id);
  };

  const centerOnUser = async () => {
    const point = location.point ?? (await location.request());
    if (!point) {
      return;
    }
    setFocus({
      camera: { lat: point.lat, lng: point.lng, zoom: 14.5 },
      nonce: Date.now(),
    });
  };

  const openDetail = (item: PharmacyMapItem | null) => {
    if (!item) {
      return;
    }
    router.push(`/eczaneler/${item.slug}` as never);
  };

  const statusView = selected ? describePharmacyState(selected.state) : null;
  const warning = selected
    ? staleNotice(Boolean(selected.state?.stale), 18)
    : staleNotice(Boolean(map.data?.items.some((item) => item.state?.stale)), 18);

  return (
    <Screen edges={['left', 'right']} padded={false}>
      <View style={styles.fill}>
        <MapCanvas
          initialCamera={initialCamera}
          focus={focus}
          markers={markers}
          userLocation={location.point}
          dark={theme.scheme === 'dark'}
          onMarkerPress={onMarkerPress}
          onCameraChange={(next) => {
            setCamera(next);
            if (selectedId) {
              setSelectedId(null);
            }
          }}
        />

        <View style={[styles.topBar, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <View style={styles.topRow} pointerEvents="box-none">
            <IconButton
              name="chevron-back"
              accessibilityLabel="Geri"
              variant="glass"
              size={20}
              onPress={() => router.back()}
            />
            <View
              style={[
                styles.titlePill,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Ionicons name="medkit" size={13} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {items.length} eczane · {district ?? 'Trabzon'}
              </AppText>
            </View>
            <IconButton
              name="locate"
              accessibilityLabel="Konumuma git"
              variant="glass"
              size={19}
              onPress={() => void centerOnUser()}
            />
          </View>

          <View style={styles.chipRow} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="İlçe filtresi"
              onPress={() => setDistrictPicker(true)}
              style={[
                styles.chip,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Ionicons name="business-outline" size={12} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="textSecondary">
                {district ?? 'Tüm ilçeler'}
              </AppText>
              <Ionicons name="chevron-down" size={12} color={theme.colors.textTertiary} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: onlyDuty }}
              accessibilityLabel="Sadece bugün nöbetçi eczaneler"
              onPress={() => setOnlyDuty((value) => !value)}
              style={[
                styles.chip,
                {
                  backgroundColor: onlyDuty ? theme.colors.successSoft : theme.colors.surface,
                  borderColor: onlyDuty ? `${theme.colors.success}55` : theme.colors.border,
                },
              ]}
            >
              <Ionicons
                name={onlyDuty ? 'moon' : 'moon-outline'}
                size={12}
                color={onlyDuty ? theme.colors.success : theme.colors.textSecondary}
              />
              <AppText
                variant="caption"
                style={{ color: onlyDuty ? theme.colors.success : theme.colors.textSecondary }}
              >
                Nöbetçiler
              </AppText>
            </Pressable>
          </View>
        </View>

        <View
          style={[styles.legend, { bottom: selected ? 232 : insets.bottom + 16 }]}
          pointerEvents="none"
        >
          {(['duty', 'today', 'normal', 'unknown'] as const).map((tone) => {
            const entry = mapLegendTone(tone);
            return (
              <View
                key={tone}
                style={[
                  styles.legendItem,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <View style={[styles.legendDot, { backgroundColor: entry.color }]} />
                <AppText variant="caption" color="textSecondary">
                  {entry.label}
                </AppText>
              </View>
            );
          })}
        </View>

        {selected ? (
          <View
            style={[
              styles.sheet,
              theme.shadows.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                paddingBottom: insets.bottom + 12,
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
            <View style={styles.sheetHead}>
              <View style={styles.flex}>
                <PharmacyStatusBadge state={selected.state} />
                <AppText variant="h3" numberOfLines={1} style={styles.sheetName}>
                  {selected.name}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {[selected.district, selected.neighborhood].filter(Boolean).join(' · ') ||
                    'İlçe bilgisi yok'}
                </AppText>
              </View>
              <IconButton
                name="close"
                accessibilityLabel="Eczane kartını kapat"
                size={16}
                onPress={() => setSelectedId(null)}
              />
            </View>

            {selected.address ? (
              <View style={styles.sheetRow}>
                <Ionicons name="location-outline" size={13} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="textSecondary" numberOfLines={2} style={styles.flex}>
                  {selected.address}
                </AppText>
              </View>
            ) : null}

            <View style={styles.sheetRow}>
              <Ionicons name="time-outline" size={13} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                {selected.state?.shift
                  ? `Nöbet: ${formatDutyWindow(selected.state.shift.starts_at, selected.state.shift.ends_at)}`
                  : (statusView?.detail ?? 'Nöbet kaydı yok')}
              </AppText>
              {detail.data && detail.data.review_count > 0 && detail.data.rating != null ? (
                <View style={styles.ratingRow}>
                  <Ionicons name="star" size={11} color={theme.colors.warning} />
                  <AppText variant="caption" color="textSecondary">
                    {detail.data.rating.toFixed(1)} ({detail.data.review_count})
                  </AppText>
                </View>
              ) : null}
            </View>

            {warning ? (
              <AppText variant="caption" color="warning">
                {warning}
              </AppText>
            ) : null}

            <PharmacyActions
              name={selected.name}
              phone={selected.phone}
              lat={selected.lat}
              lng={selected.lng}
              compact
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${selected.name} detayını aç`}
              onPress={() => openDetail(selected)}
              style={[styles.detailButton, { borderColor: theme.colors.border }]}
            >
              <AppText variant="label" color="primaryDeep">
                Eczane detayı, yorumlar ve nöbet takvimi
              </AppText>
              <Ionicons name="chevron-forward" size={14} color={theme.colors.primaryDeep} />
            </Pressable>
          </View>
        ) : (
          <View
            style={[
              styles.hintPill,
              {
                bottom: insets.bottom + 16,
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
            pointerEvents="none"
          >
            <Ionicons name="hand-left-outline" size={13} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textSecondary">
              {map.isFetching ? 'Eczaneler yükleniyor…' : 'Bilgi kartı için haritadaki iğneye dokun'}
            </AppText>
          </View>
        )}
      </View>

      <SelectSheet
        visible={districtPicker}
        title="İlçe seç"
        options={districts}
        value={district}
        onSelect={(value) => {
          setDistrict(value);
          setDistrictPicker(false);
        }}
        onClose={() => setDistrictPicker(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titlePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legend: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 7,
    gap: 8,
  },
  grabber: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 2 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sheetName: { marginTop: 4 },
  flex: { flex: 1 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  detailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  hintPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
