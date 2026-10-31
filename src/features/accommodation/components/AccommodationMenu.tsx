import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type AccommodationMenuItem = {
  key: string;
  label: string;
  icon: IconName;
  description?: string;
  badge?: number;
};

export type AccommodationMenuProps = {
  items: AccommodationMenuItem[];
  onSelect: (key: string) => void;
  /** Tetikleyicide kırmızı nokta gösterir (bekleyen iş varsa). */
  hasAlert?: boolean;
  accessibilityLabel?: string;
  /** Panelin sağ kenarından bırakılacak boşluk; sayfanın yatay dolgusuyla eşitlenir. */
  edgePadding?: number;
};

const TRIGGER_SIZE = 40;
/** Üst bar 10px iç boşlukla başlar; panel tetikleyicinin 6px altında açılır. */
const PANEL_TOP_GAP = 10 + TRIGGER_SIZE + 6;

/**
 * Vitrin üst barındaki üç noktalı taşma menüsü.
 * Tetikleyiciye basıldığında hızlı erişim kartları sağ üstte açılır.
 */
export function AccommodationMenu({
  items,
  onSelect,
  hasAlert = false,
  accessibilityLabel = 'Konaklama menüsü',
  edgePadding = 20,
}: AccommodationMenuProps) {
  const { theme, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);

  const panelWidth = Math.min(300, Math.max(232, width - edgePadding * 2));
  const backdrop = scheme === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(9,16,30,0.1)';

  const close = () => setOpen(false);

  const handleSelect = (key: string) => {
    close();
    onSelect(key);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => {
          haptics.tap();
          setOpen((current) => !current);
        }}
        style={({ pressed }) => [
          styles.trigger,
          { opacity: pressed ? 0.78 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] },
        ]}
      >
        <Ionicons name="ellipsis-vertical" size={20} color="#FFFFFF" />
        {hasAlert ? <View style={styles.alertDot} /> : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Menüyü kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: backdrop }]}
          onPress={close}
        />
        <View
          style={[
            styles.panel,
            theme.shadows.floating,
            {
              top: insets.top + PANEL_TOP_GAP,
              right: edgePadding,
              width: panelWidth,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.lg,
            },
          ]}
        >
          {items.map((item, index) => (
            <View key={item.key}>
              {index > 0 ? (
                <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.description ? `${item.label}. ${item.description}` : item.label}
                onPress={() => handleSelect(item.key)}
                style={({ pressed }) => [
                  styles.item,
                  { backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent' },
                ]}
              >
                <View style={[styles.itemIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name={item.icon} size={16} color={theme.colors.primaryDeep} />
                </View>
                <View style={styles.itemText}>
                  <AppText variant="bodyStrong" numberOfLines={1} style={styles.itemLabel}>
                    {item.label}
                  </AppText>
                  {item.description ? (
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {item.description}
                    </AppText>
                  ) : null}
                </View>
                {item.badge && item.badge > 0 ? (
                  <View style={[styles.badge, { backgroundColor: theme.colors.danger }]}>
                    <AppText variant="caption" style={styles.badgeText}>
                      {item.badge > 9 ? '9+' : item.badge}
                    </AppText>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
                )}
              </Pressable>
            </View>
          ))}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: TRIGGER_SIZE,
    height: TRIGGER_SIZE,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: 'rgba(9,16,30,0.9)',
  },
  panel: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  itemIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, minWidth: 0, gap: 1 },
  itemLabel: { fontSize: 13.5 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10 },
});
