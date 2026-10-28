import type { ReactNode } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { useKeyboard } from '@/providers/keyboard';
import { useTheme } from '@/theme/ThemeProvider';

export type ScreenProps = {
  children: ReactNode;
  edges?: Edge[];
  scroll?: boolean;
  padded?: boolean;
  /** Reserves the keyboard height so no input is ever covered. */
  keyboardAware?: boolean;
  background?: 'background' | 'surface' | 'transparent';
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  /** Rendered outside the scroll area, pinned to the bottom (composers, CTAs). */
  footer?: ReactNode;
  refreshControl?: React.ReactElement;
};

export function Screen({
  children,
  edges = ['left', 'right'],
  scroll = false,
  padded = true,
  // Kaydirilabilir form ekranlarinda klavye kapatma davranisi varsayilan
  // olarak aciktir: aksi halde odaklanan alan klavyenin altinda kaliyor.
  keyboardAware = scroll,
  background = 'background',
  contentContainerStyle,
  style,
  footer,
  refreshControl,
}: ScreenProps) {
  const { theme } = useTheme();
  const { height, isVisible } = useKeyboard();
  const insets = useSafeAreaInsets();

  const backgroundColor = background === 'transparent' ? 'transparent' : theme.colors[background];
  const padding = padded ? { paddingHorizontal: theme.layout.screenPadding } : null;

  // iOS'ta kaydirilabilir ekranlarda native `automaticallyAdjustKeyboardInsets`
  // kullanilir (icerik insetini ve odakli alani kendisi ayarlar). Android'de
  // edge-to-edge yuzunden pencere kuculmedigi icin yuksekligi biz ayiririz.
  //
  // ONEMLI: Ekranin altina sabitlenen bir `footer` (yorum/mesaj yazma alani)
  // varsa native inset yeterli degildir; o ayar yalnizca ScrollView icerigini
  // kaydirir, footer'i yukari tasimaz. Bu durumda klavye yuksekligini her
  // platformda biz ayiririz; aksi halde yazarken alan klavyenin altinda kalir.
  const hasFooter = footer != null;
  const iosScrollInsets = keyboardAware && scroll && Platform.OS === 'ios' && !hasFooter;
  const reserveKeyboard = keyboardAware && !iosScrollInsets;

  // While the keyboard covers the bottom safe area we drop the inset edge so the
  // reserved space is exactly the keyboard height (no double padding).
  const safeEdges = keyboardAware && isVisible ? edges.filter((edge) => edge !== 'bottom') : edges;

  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: reserveKeyboard ? height.value : 0,
  }));

  const content = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        padding,
        styles.scrollContent,
        { paddingBottom: insets.bottom + theme.spacing.xl },
        contentContainerStyle,
      ]}
      automaticallyAdjustKeyboardInsets={iosScrollInsets}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padding, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor }, style]} edges={safeEdges}>
      {/* Klavye payi ayirmayan ekranlarda animasyonlu kapsayici kurulmaz:
          her ekranda fazladan bir Reanimated gorunumu/UI-thread isi olusmaz. */}
      {reserveKeyboard ? (
        <Animated.View style={[styles.flex, keyboardStyle]}>
          {content}
          {footer}
        </Animated.View>
      ) : (
        <View style={styles.flex}>
          {content}
          {footer}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
});
