import { usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DrawerMenu } from '@/components/navigation/DrawerMenu';
import { ProfileMenu } from '@/components/navigation/ProfileMenu';
import {
  DrawerContext,
  type DrawerContextValue,
  type DrawerVariant,
} from '@/features/navigation/drawer-context';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

const PANEL_MAX_WIDTH = 380;
const PANEL_WIDTH_RATIO = 0.84;
const EDGE_WIDTH = 22;

/**
 * X uygulamasindaki gibi: hizli, kisa ve hafif yayli bir acilis. 200 ms
 * araliginda tutuluyor; daha uzunu gecikme, daha kisasi "ziplama" hissi verir.
 */
const OPEN_TIMING = { duration: 205, easing: Easing.out(Easing.cubic) };
const CLOSE_TIMING = { duration: 175, easing: Easing.in(Easing.cubic) };

/**
 * Jest guncellemeleri UI runtime'da calisir. Bu yardimci fonksiyon `worklet`
 * olarak isaretlenmezse React Native Worklets onu "remote function" sayar ve
 * UI thread'inden senkron cagrilamaz (bkz. DrawerHost clamp hatasi).
 */
function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

export function DrawerHost({ children }: PropsWithChildren) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  /**
   * Kenardan kaydirarak menu acmak yalnizca akista calisir. Diger ekranlarda
   * ayni hareket isletim sisteminin "geri" jestine aittir; burada yakalanirsa
   * kullanici geri donemez ve hamburger beklenmedik sekilde acilir.
   */
  const edgeEnabled = pathname === '/feed';

  const panelWidth = Math.round(Math.min(width * PANEL_WIDTH_RATIO, PANEL_MAX_WIDTH));
  const closedX = -panelWidth;

  const translateX = useSharedValue(closedX);
  const startX = useSharedValue(closedX);

  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [variant, setVariant] = useState<DrawerVariant>('main');

  // Paneli kapanis animasyonu bitince sokmek icin JS zamanlayicisi kullanilir;
  // animasyon callback'ine bagimli olmak platformlar arasi tutarsiz.
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelUnmount = useCallback(() => {
    if (unmountTimer.current) {
      clearTimeout(unmountTimer.current);
      unmountTimer.current = null;
    }
  }, []);

  useEffect(() => cancelUnmount, [cancelUnmount]);

  const openPanel = useCallback(
    (next: DrawerVariant = 'main') => {
      cancelUnmount();
      setVariant(next);
      setMounted(true);
      setIsOpen(true);
      translateX.set(withTiming(0, OPEN_TIMING));
    },
    [cancelUnmount, translateX],
  );

  const open = useCallback(
    (next: DrawerVariant = 'main') => {
      haptics.tap();
      openPanel(next);
    },
    [openPanel],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    translateX.set(withTiming(closedX, CLOSE_TIMING));
    cancelUnmount();
    unmountTimer.current = setTimeout(() => setMounted(false), CLOSE_TIMING.duration + 60);
  }, [cancelUnmount, closedX, translateX]);

  const prepareDrag = useCallback(
    (next: DrawerVariant) => {
      cancelUnmount();
      setVariant(next);
      setMounted(true);
    },
    [cancelUnmount],
  );

  // Rotation / split-view changes must not leave a half-open panel behind.
  useEffect(() => {
    if (!isOpen) {
      translateX.set(closedX);
    }
  }, [closedX, isOpen, translateX]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close, isOpen]);

  const edgeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-16, 16])
        .failOffsetY([-18, 18])
        // SharedValue'lar ref gibi davranir; bu callback'ler render sirasinda
        // degil, yalnizca kullanici hareketi sirasinda calisir.
        // eslint-disable-next-line react-hooks/refs
        .onBegin(() => {
          startX.set(translateX.get());
          runOnJS(prepareDrag)('main');
        })
        .onUpdate((event) => {
          translateX.set(clamp(startX.get() + event.translationX, closedX, 0));
        })
        // eslint-disable-next-line react-hooks/refs
        .onEnd((event) => {
          const shouldOpen = event.translationX > panelWidth * 0.26 || event.velocityX > 620;
          if (shouldOpen) {
            runOnJS(openPanel)('main');
          } else {
            runOnJS(close)();
          }
        }),
    [closedX, close, openPanel, panelWidth, prepareDrag, startX, translateX],
  );

  const panelGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-16, 16])
        .failOffsetY([-20, 20])
        .onBegin(() => {
          startX.set(translateX.get());
        })
        .onUpdate((event) => {
          translateX.set(clamp(startX.get() + event.translationX, closedX, 0));
        })
        // eslint-disable-next-line react-hooks/refs
        .onEnd((event) => {
          const shouldClose = event.translationX < -panelWidth * 0.2 || event.velocityX < -520;
          if (shouldClose) {
            runOnJS(close)();
          } else {
            translateX.set(withTiming(0, OPEN_TIMING));
          }
        }),
    [closedX, close, panelWidth, startX, translateX],
  );

  // Acikken karartmanin uzerinden sola kaydirma: panel + ana icerik birlikte
  // kapanir. Boylece kullanici sadece menunun kenarindan degil, ekranin her
  // yerinden dogal bir jestle menuyu kapatabilir.
  const backdropGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        .onBegin(() => {
          startX.set(translateX.get());
        })
        .onUpdate((event) => {
          translateX.set(clamp(startX.get() + event.translationX, closedX, 0));
        })
        // eslint-disable-next-line react-hooks/refs
        .onEnd((event) => {
          const shouldClose = event.translationX < -panelWidth * 0.16 || event.velocityX < -480;
          if (shouldClose) {
            runOnJS(close)();
          } else {
            translateX.set(withTiming(0, OPEN_TIMING));
          }
        }),
    [closedX, close, panelWidth, startX, translateX],
  );

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  // X'te oldugu gibi ana sayfa menunun altinda kalmaz: panel genisligi kadar
  // saga kayar. Donusum native thread'de calisir, JS thread'i bloklanmaz.
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() + panelWidth }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.get(), [closedX, 0], [0, 0.34], Extrapolation.CLAMP),
  }));

  const context = useMemo<DrawerContextValue>(
    () => ({ open, close, isOpen, variant }),
    [close, isOpen, open, variant],
  );

  return (
    <DrawerContext.Provider value={context}>
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Animated.View
          style={[styles.content, contentStyle]}
          pointerEvents={isOpen ? 'none' : 'auto'}
          accessibilityElementsHidden={isOpen}
          importantForAccessibility={isOpen ? 'no-hide-descendants' : 'auto'}
        >
          {children}
        </Animated.View>

        {!isOpen && edgeEnabled ? (
          <GestureDetector gesture={edgeGesture}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.edge, { width: EDGE_WIDTH }]}
            />
          </GestureDetector>
        ) : null}

        {mounted ? (
          <View style={StyleSheet.absoluteFill} pointerEvents={isOpen ? 'auto' : 'none'}>
            <GestureDetector gesture={backdropGesture}>
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    // Menude yalnizca gerekli karartma: agir scrim yok.
                    backgroundColor: theme.scheme === 'dark' ? '#03070E' : '#0B1220',
                    opacity: 0,
                  },
                  backdropStyle,
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Menüyü kapat"
                  onPress={close}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </GestureDetector>

            <GestureDetector gesture={panelGesture}>
              <Animated.View
                accessibilityViewIsModal={isOpen}
                style={[
                  styles.panel,
                  {
                    width: panelWidth,
                    backgroundColor: theme.colors.background,
                    borderTopRightRadius: theme.radius.xl,
                    borderBottomRightRadius: theme.radius.xl,
                    paddingTop: insets.top,
                  },
                  panelStyle,
                ]}
              >
                {variant === 'main' ? (
                  <DrawerMenu onClose={close} />
                ) : (
                  <ProfileMenu onClose={close} />
                )}
              </Animated.View>
            </GestureDetector>
          </View>
        ) : null}
      </View>
    </DrawerContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  content: { flex: 1 },
  edge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 40,
  },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 50,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(120, 140, 180, 0.25)',
  },
});
