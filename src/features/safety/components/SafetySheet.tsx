import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, IconButton } from '@/components/ui';
import { useKeyboard } from '@/providers/keyboard';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  subtitle?: string;
  /** Icerik kaydirilabilir mi? Uzun formlar icin true. */
  scrollable?: boolean;
  footer?: ReactNode;
  maxHeightRatio?: number;
};

/**
 * Tum guvenlik akislarinda kullanilan alt sayfa. Native Modal uzerine kurulu
 * oldugu icin ekstra gesture bagimliligi gerektirmez ve Android geri tusunu
 * dogru sekilde yonetir.
 */
export function SafetySheet({
  visible,
  onClose,
  children,
  title,
  subtitle,
  scrollable = true,
  footer,
  maxHeightRatio = 0.92,
}: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboard();
  const keyboardHeight = keyboard.height;
  // Modal ayri pencerede açıldığı için Android'de pencere küçülmüyor; klavye
  // yüksekliğini kendimiz ayırıyoruz ki alt yorum alanı görünür kalsın.
  // Klavye acikken alt guvenli alan zaten klavyenin altinda kaldigi icin
  // inset'i ayrica eklemeyiz; aksi halde alan gereksiz yere yukari kayar.
  const keyboardStyle = useAnimatedStyle(() => ({ paddingBottom: keyboardHeight.value }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <Animated.View style={[styles.keyboard, keyboardStyle]}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.background,
                borderTopLeftRadius: theme.radius.xxl,
                borderTopRightRadius: theme.radius.xxl,
                paddingBottom: keyboard.isVisible ? 12 : Math.max(insets.bottom, 14),
                maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
              },
            ]}
          >
            <View style={styles.grabberWrap}>
              <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
            </View>

            {title ? (
              <View style={styles.header}>
                <View style={styles.headerText}>
                  <AppText variant="h2">{title}</AppText>
                  {subtitle ? (
                    <AppText variant="caption" color="textSecondary">
                      {subtitle}
                    </AppText>
                  ) : null}
                </View>
                <IconButton
                  name="close"
                  accessibilityLabel="Kapat"
                  variant="surface"
                  size={18}
                  onPress={onClose}
                />
              </View>
            ) : null}

            {scrollable ? (
              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            ) : (
              <View style={[styles.scrollContent, styles.body]}>{children}</View>
            )}

            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill },
  // flex: 1 olmadan `maxHeight` yuzdesi cozulemiyor (ust bilesen icerige gore
  // boyutlandigi icin sinir uygulanmiyordu) ve klavye boslugu eklendiginde
  // alt sayfa ekranin disina tasabiliyordu.
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  // Icerik sinirlaninca once govde kuculur; boylece alt yorum alani
  // (footer) her zaman klavyenin ustunde kalir.
  sheet: { overflow: 'hidden', flexShrink: 1 },
  body: { flexShrink: 1 },
  grabberWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  grabber: { width: 42, height: 5, borderRadius: 3 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerText: { flex: 1, gap: 2 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },
});
