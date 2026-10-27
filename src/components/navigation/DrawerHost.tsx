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
  withSpring,
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

const PANEL_MAX_WIDTH = 360;
const PANEL_WIDTH_RATIO = 0.86;
const EDGE_WIDTH = 18;

/** X uygulamasindaki gibi: hizli, kisa ve hafif yayli bir acilis. */
const OPEN_SPRING = { damping: 28, stiffness: 320, mass: 0.9, overshootClamping: true };
const CLOSE_TIMING = { duration: 200, easing: Easing.out(Easing.cubic) };

export function DrawerHost({ children }: PropsWithChildren) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

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
      translateX.set(withSpring(0, OPEN_SPRING));
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
          translateX.set(Math.max(closedX, Math.min(0, startX.get() + event.translationX)));
        })
        // eslint-disable-next-line react-hooks/refs
        .onEnd((event) => {
          const shouldOpen = event.translationX > panelWidth * 0.28 || event.velocityX > 650;
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
          translateX.set(Math.max(closedX, Math.min(0, startX.get() + event.translationX)));
        })
        // eslint-disable-next-line react-hooks/refs
        .onEnd((event) => {
          const shouldClose = event.translationX < -panelWidth * 0.22 || event.velocityX < -550;
          if (shouldClose) {
            runOnJS(close)();
          } else {
            translateX.set(withSpring(0, OPEN_SPRING));
          }
        }),
    [closedX, close, panelWidth, startX, translateX],
  );

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.get(), [closedX, 0], [0, 1], Extrapolation.CLAMP),
  }));

  const context = useMemo<DrawerContextValue>(
    () => ({ open, close, isOpen, variant }),
    [close, isOpen, open, variant],
  );

  return (
    <DrawerContext.Provider value={context}>
      <View style={styles.root}>
        {children}

        {!isOpen ? (
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
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: theme.colors.overlay },
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
                    shadowColor: theme.scheme === 'dark' ? '#000000' : '#0B1220',
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
  root: { flex: 1 },
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
    elevation: 24,
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 6, height: 0 },
  },
});
