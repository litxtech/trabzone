/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated inside gestures. */
import { useCallback, useEffect, type ReactNode } from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboard } from '@/providers/keyboard';
import { useReduceMotion } from '@/perf/use-reduce-motion';

type PremiumSheetProps = {
  onClose: () => void;
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  /** Sayfa görünür olduğunda açılış animasyonu oynatılır. */
  open?: boolean;
  /** Kapalı hâldeki yükseklik oranı (0..1). */
  collapsedRatio?: number;
  /** Yukarı çekildiğinde ulaşılan yükseklik oranı (0..1). */
  expandedRatio?: number;
  surfaceColor: string;
  borderColor?: string;
  grabberColor: string;
  backdropColor?: string;
  /** Dış alana dokunma davranışını özelleştirmek için. */
  onBackdropPress?: () => void;
  headerAccessibilityLabel?: string;
};

const SPRING = { damping: 27, stiffness: 285, mass: 0.82 };

/**
 * Trabzone premium alt sayfa iskeleti.
 *
 * - Alttan açılır, %55–60 kompakt yükseklikten %92–96'ya kadar sürüklenerek büyür.
 * - Yüksekliği UI thread'de değiştirir; liste zıplamaz, header yer değiştirmez.
 * - Klavye yüksekliği footer'a animasyonlu padding olarak eklenir; input her
 *   zaman klavyenin hemen üstünde kalır (Modal penceresi Android'de küçülmez).
 * - Sürükleme yalnızca tutamaç/başlık bölgesindedir; liste kaydırmasıyla çakışmaz.
 */
export function PremiumSheet({
  onClose,
  children,
  header,
  footer,
  open = true,
  collapsedRatio = 0.58,
  expandedRatio = 0.94,
  surfaceColor,
  borderColor,
  grabberColor,
  backdropColor = 'rgba(3, 7, 14, 0.58)',
  onBackdropPress,
  headerAccessibilityLabel = 'Yorum kartını büyüt veya küçült',
}: PremiumSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboard();
  const reduceMotion = useReduceMotion();

  const available = Math.max(windowHeight - insets.top - 8, 320);
  const collapsed = Math.min(Math.max(available * collapsedRatio, 280), available);
  const expanded = Math.min(Math.max(available * expandedRatio, collapsed + 80), available);
  const backdropOpacityAt = Math.max(collapsed * 0.75, 1);

  const height = useSharedValue(0);
  const dragStart = useSharedValue(0);

  useEffect(() => {
    height.value = open ? withTiming(collapsed, { duration: reduceMotion ? 0 : 240 }) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collapsed, reduceMotion]);

  useEffect(() => {
    if (keyboard.isVisible) {
      height.value = withTiming(expanded, { duration: reduceMotion ? 0 : 190 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboard.isVisible, expanded, reduceMotion]);

  const close = useCallback(() => {
    height.value = withTiming(0, { duration: reduceMotion ? 0 : 190 }, (finished) => {
      if (finished) {
        runOnJS(onClose)();
      }
    });
  }, [height, onClose, reduceMotion]);

  const handleBackdrop = useCallback(() => {
    if (onBackdropPress) {
      onBackdropPress();
      return;
    }
    if (keyboard.isVisible) {
      Keyboard.dismiss();
      return;
    }
    close();
  }, [close, keyboard.isVisible, onBackdropPress]);

  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-24, 24])
    .onBegin(() => {
      dragStart.value = height.value;
    })
    .onUpdate((event) => {
      const next = dragStart.value - event.translationY;
      height.value = Math.min(Math.max(next, 52), expanded);
    })
    .onEnd((event) => {
      const projected = height.value - event.velocityY * 0.06;
      if (projected < collapsed * 0.62 || event.velocityY > 1250) {
        height.value = withTiming(0, { duration: 170 }, (finished) => {
          if (finished) {
            runOnJS(onClose)();
          }
        });
        return;
      }
      const target = projected > (collapsed + expanded) / 2 ? expanded : collapsed;
      height.value = withSpring(target, SPRING);
    });

  const sheetStyle = useAnimatedStyle(() => ({ height: height.value }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(height.value, [0, backdropOpacityAt], [0, 1], 'clamp'),
  }));
  const footerStyle = useAnimatedStyle(() => ({
    paddingBottom:
      keyboard.isVisible && keyboard.height.value > 0
        ? keyboard.height.value
        : Math.max(insets.bottom, 10),
  }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.backdrop, { backgroundColor: backdropColor }, backdropStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          style={StyleSheet.absoluteFill}
          onPress={handleBackdrop}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          sheetStyle,
          {
            backgroundColor: surfaceColor,
            borderColor: borderColor ?? 'transparent',
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
          },
        ]}
      >
        <GestureDetector gesture={pan}>
          <View
            accessible={false}
            accessibilityLabel={headerAccessibilityLabel}
            style={styles.dragArea}
          >
            <View style={[styles.grabber, { backgroundColor: grabberColor }]} />
            {header}
          </View>
        </GestureDetector>

        <View style={styles.body}>{children}</View>

        {footer ? <Animated.View style={footerStyle}>{footer}</Animated.View> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill },
  sheet: {
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
  },
  dragArea: { paddingTop: 8, paddingBottom: 2 },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, opacity: 0.55 },
  body: { flex: 1, minHeight: 0 },
});
