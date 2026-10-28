import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { MAP_QUICK_ACTIONS, type QuickActionKey } from '../constants';
import { MapSheet } from './MapSheet';

/**
 * Harita hızlı işlem menüsü. Bağlı olmayan modüller "hazırlanıyor" olarak
 * işaretlenir ve tıklanabilir sahte akış sunmaz.
 */
export function MapQuickSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (key: QuickActionKey) => void;
}) {
  const { theme } = useTheme();

  return (
    <MapSheet visible={visible} onClose={onClose} title="Hızlı işlemler" subtitle="Haritadan doğrudan başlat">
      <View style={styles.grid}>
        {MAP_QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: !action.ready }}
            disabled={!action.ready}
            onPress={() => {
              haptics.tap();
              onSelect(action.key);
            }}
            style={({ pressed }) => [
              styles.tile,
              {
                backgroundColor: theme.colors.surfaceMuted,
                borderColor: theme.colors.border,
                opacity: action.ready ? (pressed ? 0.82 : 1) : 0.5,
              },
            ]}
          >
            <View style={[styles.tileIcon, { backgroundColor: theme.colors.surface }]}>
              <Ionicons
                name={action.icon}
                size={18}
                color={action.ready ? theme.colors.primaryDeep : theme.colors.textTertiary}
              />
            </View>
            <View style={styles.flex}>
              <AppText variant="caption" color={action.ready ? 'text' : 'textTertiary'} numberOfLines={1}>
                {action.label}
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.hint}>
                {action.hint}
              </AppText>
            </View>
          </Pressable>
        ))}
      </View>

      <AppText variant="caption" color="textTertiary">
        Soluk görünen işlemlerin modülleri henüz bağlı değil. Hazır olduklarında aynı harita altyapısını kullanacaklar.
      </AppText>
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '48.6%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tileIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 1 },
  hint: { fontSize: 9 },
});
