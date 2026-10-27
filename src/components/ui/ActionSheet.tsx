import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';

import { AppText } from './AppText';

export type ActionSheetItem = {
  key: string;
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  destructive?: boolean;
  description?: string;
  disabled?: boolean;
};

export type ActionSheetProps = {
  visible: boolean;
  title?: string;
  message?: string;
  items: ActionSheetItem[];
  onSelect: (key: string) => void;
  onClose: () => void;
  cancelLabel?: string;
};

export function ActionSheet({
  visible,
  title,
  message,
  items,
  onSelect,
  onClose,
  cancelLabel = 'Vazgeç',
}: ActionSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Menüyü kapat"
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + 12 }]}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.xl,
                borderColor: theme.colors.border,
              },
            ]}
          >
            {title ? (
              <View style={styles.head}>
                <AppText variant="bodyStrong" align="center">
                  {title}
                </AppText>
                {message ? (
                  <AppText variant="caption" color="textSecondary" align="center">
                    {message}
                  </AppText>
                ) : null}
              </View>
            ) : null}

            {items.map((item, index) => (
              <View key={item.key}>
                {index > 0 || title ? (
                  <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ disabled: item.disabled }}
                  disabled={item.disabled}
                  onPress={() => onSelect(item.key)}
                  style={({ pressed }) => [
                    styles.item,
                    {
                      backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                      opacity: item.disabled ? 0.45 : 1,
                    },
                  ]}
                >
                  {item.icon ? (
                    <Ionicons
                      name={item.icon}
                      size={19}
                      color={item.destructive ? theme.colors.danger : theme.colors.primaryDeep}
                    />
                  ) : null}
                  <View style={styles.itemText}>
                    <AppText variant="body" color={item.destructive ? 'danger' : 'text'}>
                      {item.label}
                    </AppText>
                    {item.description ? (
                      <AppText variant="caption" color="textTertiary">
                        {item.description}
                      </AppText>
                    ) : null}
                  </View>
                </Pressable>
              </View>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
            onPress={onClose}
            style={({ pressed }) => [
              styles.cancel,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.xl,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <AppText variant="bodyStrong" color="textSecondary">
              {cancelLabel}
            </AppText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  sheetWrap: { paddingHorizontal: 12, gap: 8 },
  sheet: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  head: { paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
    minHeight: 52,
  },
  itemText: { flex: 1, gap: 2 },
  cancel: { paddingVertical: 16, alignItems: 'center' },
});
