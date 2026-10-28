import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, IconButton } from '@/components/ui';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import { MAP_DEFAULT_CAMERA } from '@/features/map/constants';
import type { MapCamera } from '@/features/map/types';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import type { LatLng } from '../types';
import { TRABZON_BOUNDS } from '../utils/geo';

type Props = {
  visible: boolean;
  initial: LatLng | null;
  title?: string;
  confirmLabel?: string;
  /** Başka bir modal içinden açılırken iç içe Modal yerine tam ekran katman kullanır. */
  embedded?: boolean;
  onClose: () => void;
  onConfirm: (point: LatLng) => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Konum seçici. Harita sabit bir artı işaretinin altında kaydırılır; böylece
 * işaretçi sürükleme jesti haritanın kendi jestleriyle çakışmaz ve tüm
 * platformlarda aynı davranışı verir.
 */
export function LocationPickerModal({
  visible,
  initial,
  title = 'Konumu belirle',
  confirmLabel = 'Bu konumu kullan',
  embedded = false,
  onClose,
  onConfirm,
}: Props) {
  const { theme, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const start = initial ?? MAP_DEFAULT_CAMERA;
  const [camera, setCamera] = useState<MapCamera>({ lat: start.lat, lng: start.lng, zoom: 16.4 });
  const [locating, setLocating] = useState(false);
  const [focus, setFocus] = useState<{ camera: MapCamera; nonce: number } | null>(null);

  const update = useCallback((next: MapCamera) => {
    setCamera({
      lat: clamp(next.lat, TRABZON_BOUNDS.south, TRABZON_BOUNDS.north),
      lng: clamp(next.lng, TRABZON_BOUNDS.west, TRABZON_BOUNDS.east),
      zoom: next.zoom,
    });
  }, []);

  const locateMe = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Konum izni verilmedi',
          'Mevcut konumunu kullanmak için izin vermen gerekiyor. Haritayı kaydırarak da konum seçebilirsin.',
        );
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next: MapCamera = { lat: current.coords.latitude, lng: current.coords.longitude, zoom: 16.4 };
      if (
        next.lat < TRABZON_BOUNDS.south ||
        next.lat > TRABZON_BOUNDS.north ||
        next.lng < TRABZON_BOUNDS.west ||
        next.lng > TRABZON_BOUNDS.east
      ) {
        Alert.alert(
          'Hizmet bölgesi dışındasın',
          'Şu anda Trabzon hizmet sınırları dışındasın. Konumu haritadan elle seçebilirsin.',
        );
        return;
      }
      setCamera(next);
      setFocus({ camera: next, nonce: Date.now() });
      haptics.selection();
    } catch {
      Alert.alert('Konum alınamadı', 'Cihaz konumu okunamadı. Haritadan elle seçebilirsin.');
    } finally {
      setLocating(false);
    }
  };

  if (!visible) {
    return null;
  }

  const content = (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.colors.divider }]}>
          <IconButton
            name="close"
            accessibilityLabel="Konum seçiciyi kapat"
            variant="surface"
            size={18}
            onPress={onClose}
          />
          <AppText variant="h3" style={styles.flex}>
            {title}
          </AppText>
        </View>

        <View style={styles.mapWrap}>
          <MapCanvas
            initialCamera={{ lat: start.lat, lng: start.lng, zoom: 16.4 }}
            focus={focus}
            markers={[]}
            dark={scheme === 'dark'}
            interactive
            onMarkerPress={() => undefined}
            onCameraChange={update}
          />

          <View pointerEvents="none" style={styles.crosshair}>
            <View style={[styles.pinShadow, { backgroundColor: 'rgba(15,23,42,0.18)' }]} />
            <View style={[styles.pin, { backgroundColor: theme.colors.primary }]}>
              <Ionicons name="location" size={18} color="#FFFFFF" />
            </View>
            <View style={[styles.pinTip, { backgroundColor: theme.colors.primary }]} />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Konumumu kullan"
            onPress={() => void locateMe()}
            disabled={locating}
            style={[styles.locate, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          >
            {locating ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Ionicons name="locate" size={19} color={theme.colors.primaryDeep} />
            )}
          </Pressable>

          <View style={[styles.hint, { backgroundColor: theme.colors.glass }]}>
            <Ionicons name="hand-left-outline" size={14} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">
              Haritayı kaydırarak iğneyi konumlandır
            </AppText>
          </View>
        </View>

        <View
          style={[
            styles.footer,
            { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider, paddingBottom: insets.bottom + 12 },
          ]}
        >
          <View style={styles.coords}>
            <AppText variant="caption" color="textTertiary">
              Seçilen koordinat
            </AppText>
            <AppText variant="bodyStrong">
              {camera.lat.toFixed(5)}, {camera.lng.toFixed(5)}
            </AppText>
          </View>
          <Button
            label={confirmLabel}
            onPress={() => {
              haptics.selection();
              onConfirm({ lat: camera.lat, lng: camera.lng });
            }}
          />
        </View>
      </View>
  );

  if (embedded) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: theme.colors.background }]}>
        {content}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
  mapWrap: { flex: 1, overflow: 'hidden' },
  crosshair: { position: 'absolute', top: '50%', left: '50%', alignItems: 'center', marginLeft: -18, marginTop: -38 },
  pinShadow: { position: 'absolute', bottom: -4, width: 22, height: 8, borderRadius: 11 },
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  pinTip: {
    width: 10,
    height: 10,
    marginTop: -6,
    transform: [{ rotate: '45deg' }],
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#FFFFFF',
  },
  locate: {
    position: 'absolute',
    right: 16,
    bottom: 22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  hint: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  footer: {
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  coords: { gap: 1 },
});
