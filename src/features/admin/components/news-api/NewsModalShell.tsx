import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Haber API merkezi modalları için ortak kabuk.
 * Başlık + kaydırılabilir gövde + sabit alt eylem çubuğu.
 */
export function NewsModalShell({
  visible,
  title,
  subtitle,
  onClose,
  footer,
  children,
  width = 880,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const { theme } = useTheme();
  const { width: windowWidth, height } = useWindowDimensions();
  const compact = windowWidth < 760;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            {
              width: '100%',
              maxWidth: width,
              maxHeight: compact ? '96%' : Math.min(height * 0.92, 940),
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
            <View style={styles.flex}>
              <AppText variant="title" numberOfLines={2}>
                {title}
              </AppText>
              {subtitle ? (
                <AppText variant="caption" color="textTertiary">
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              onPress={onClose}
              style={styles.close}
            >
              <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>

          {footer ? (
            <View
              style={[
                styles.footer,
                { borderTopColor: theme.colors.divider, backgroundColor: theme.colors.surface },
              ]}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    backgroundColor: 'rgba(9, 14, 24, 0.55)',
  },
  sheet: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  close: { padding: 6 },
  scroll: { flexGrow: 0 },
  content: { padding: 16, gap: 12 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  flex: { flex: 1, minWidth: 0 },
});
