import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { MAP_DENSITY_LIST, MAP_LAYER_LIST, MAP_LAYER_INDEX } from '../constants';
import { hasMapboxToken } from '../services/map-service';
import type { MapDensity, MapLayerKey } from '../types';
import { toneColor } from '../utils/map-theme';
import { MapSheet } from './MapSheet';

const PROVIDER =
  Platform.OS === 'ios'
    ? 'Apple Maps (iOS) · Mapbox arama ve güzergâh'
    : Platform.OS === 'android'
      ? 'Mapbox (Android)'
      : 'Mapbox statik (web önizleme)';

export function MapLayersSheet({
  visible,
  onClose,
  layers,
  density,
  onToggle,
  onDensity,
}: {
  visible: boolean;
  onClose: () => void;
  layers: Record<MapLayerKey, boolean>;
  density: MapDensity;
  onToggle: (key: MapLayerKey) => void;
  onDensity: (density: MapDensity) => void;
}) {
  const { theme } = useTheme();
  const tokenReady = hasMapboxToken();

  return (
    <MapSheet
      visible={visible}
      onClose={onClose}
      title="Harita katmanları"
      subtitle="Görünümü ve yoğunluğu yönet"
    >
      <View style={styles.list}>
        {MAP_LAYER_LIST.map((layer) => {
          const tone = toneColor(theme, layer.tone);
          return (
            <View key={layer.key} style={[styles.row, { borderColor: theme.colors.divider }]}>
              <View style={[styles.icon, { backgroundColor: `${tone}1F` }]}>
                <Ionicons name={layer.icon} size={17} color={tone} />
              </View>
              <View style={styles.flex}>
                <AppText variant="body" color={layer.ready ? 'text' : 'textTertiary'}>
                  {layer.label}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {layer.hint}
                </AppText>
              </View>
              <Switch
                accessibilityLabel={`${layer.label} katmanı`}
                value={layers[layer.key] === true}
                disabled={!layer.ready}
                onValueChange={() => {
                  haptics.tap();
                  onToggle(layer.key);
                }}
                trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primary }}
                thumbColor={theme.colors.surface}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <AppText variant="label" color="textSecondary">
          İşaret yoğunluğu
        </AppText>
        <View style={styles.segment}>
          {MAP_DENSITY_LIST.map((item) => {
            const active = item.key === density;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${item.label} yoğunluk`}
                onPress={() => {
                  haptics.selection();
                  onDensity(item.key);
                }}
                style={({ pressed }) => [
                  styles.segmentItem,
                  {
                    backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surfaceMuted,
                    borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                  {item.label}
                </AppText>
                <AppText
                  variant="caption"
                  color={active ? 'onPrimary' : 'textTertiary'}
                  style={styles.segmentHint}
                >
                  {item.hint}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.info, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
        <Ionicons name="layers-outline" size={16} color={theme.colors.primaryDeep} />
        <View style={styles.flex}>
          <AppText variant="caption" color="textSecondary">
            Sağlayıcı: {PROVIDER}
          </AppText>
          <AppText variant="caption" color={tokenReady ? 'textTertiary' : 'warning'}>
            {tokenReady
              ? 'Arama ve güzergâh için Mapbox anahtarı etkin. Gizli anahtar istemcide tutulmaz.'
              : 'Mapbox anahtarı tanımlı değil: temel harita açılır, arama ve güzergâh devre dışı kalır.'}
          </AppText>
        </View>
      </View>
    </MapSheet>
  );
}

/** Katman anahtarı → etiket eşlemesi diğer bileşenlerde tekrar yazılmasın. */
export function layerLabel(key: MapLayerKey): string {
  return MAP_LAYER_INDEX[key]?.label ?? key;
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 1 },
  section: { gap: 8, paddingTop: 4 },
  segment: { flexDirection: 'row', gap: 8 },
  segmentItem: {
    flex: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 2,
  },
  segmentHint: { fontSize: 9, textAlign: 'center' },
  info: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
});
