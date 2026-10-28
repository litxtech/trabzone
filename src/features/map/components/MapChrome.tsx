import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { MAP_MODE_LIST } from '../constants';
import type { MapMode } from '../types';

export function MapModeChips({
  mode,
  onChange,
}: {
  mode: MapMode;
  onChange: (mode: MapMode) => void;
}) {
  const { theme } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.modeRow}
      keyboardShouldPersistTaps="handled"
    >
      {MAP_MODE_LIST.map((item) => {
        const active = item.key === mode;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${item.label} modu`}
            onPress={() => {
              if (!active) {
                haptics.tap();
                onChange(item.key);
              }
            }}
            style={({ pressed }) => [
              styles.modeChip,
              {
                backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons
              name={item.icon}
              size={14}
              color={active ? theme.colors.onPrimary : theme.colors.textSecondary}
            />
            <AppText
              variant="caption"
              color={active ? theme.colors.onPrimary : theme.colors.textSecondary}
            >
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export type MapControlKey = 'layers' | 'locate' | 'safety' | 'expand' | 'quick';

const CONTROLS: {
  key: MapControlKey;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}[] = [
  { key: 'layers', icon: 'layers-outline', label: 'Katmanlar' },
  { key: 'locate', icon: 'locate-outline', label: 'Konumum' },
  { key: 'safety', icon: 'shield-checkmark-outline', label: 'Güvenlik' },
  { key: 'expand', icon: 'expand-outline', label: 'Görünüm' },
  { key: 'quick', icon: 'flash-outline', label: 'Hızlı işlemler' },
];

/**
 * Harita içindeki yüzen kontroller. Harita tam ekran olduğu için üstteki
 * arama/mod katmanıyla çakışmaması adına `topOffset` ile başlığın altına
 * yerleştirilir; parmakla erişilebilir 44 dp hedef alanı korunur.
 */
export function MapFloatingControls({
  onAction,
  ghost,
  expanded,
  locating,
  topOffset = 12,
}: {
  onAction: (key: MapControlKey) => void;
  ghost: boolean;
  expanded: boolean;
  locating?: boolean;
  topOffset?: number;
}) {
  const { theme } = useTheme();

  return (
    <View style={[styles.controlColumn, { top: topOffset }]} pointerEvents="box-none">
      {CONTROLS.map((control) => {
        const active = control.key === 'expand' ? expanded : false;
        const tone =
          control.key === 'safety' && !ghost
            ? theme.colors.warning
            : active
              ? theme.colors.primaryDeep
              : theme.colors.text;
        return (
          <Pressable
            key={control.key}
            accessibilityRole="button"
            accessibilityLabel={control.label}
            accessibilityState={
              control.key === 'expand' ? { expanded } : control.key === 'safety' ? { selected: ghost } : undefined
            }
            onPress={() => {
              haptics.tap();
              onAction(control.key);
            }}
            style={({ pressed }) => [
              styles.control,
              {
                backgroundColor:
                  theme.scheme === 'dark' ? 'rgba(17,24,43,0.88)' : 'rgba(255,255,255,0.94)',
                borderColor: theme.colors.border,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Ionicons
              name={
                control.key === 'safety' && !ghost
                  ? 'eye-off-outline'
                  : control.key === 'locate' && locating
                    ? 'navigate'
                    : control.icon
              }
              size={19}
              color={tone}
            />
            {control.key === 'safety' ? (
              <View
                style={[
                  styles.dot,
                  { backgroundColor: ghost ? theme.colors.success : theme.colors.warning },
                ]}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: 'row', gap: 7, paddingVertical: 2 },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  controlColumn: { position: 'absolute', right: 12, gap: 8 },
  control: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { position: 'absolute', right: 7, bottom: 7, width: 7, height: 7, borderRadius: 4 },
});
