import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Logo, Wordmark } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type AnimatedSplashProps = {
  /** True once fonts, theme and the auth session are restored. */
  ready: boolean;
  onFinish: () => void;
};

const INTRO_DURATION = 820;

/**
 * Brand intro played once, on top of the first rendered route.
 * It never blocks the app for more than ~1.1s: the exit starts as soon as the
 * intro finished *and* the bootstrap is ready.
 */
export function AnimatedSplash({ ready, onFinish }: AnimatedSplashProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const [introDone, setIntroDone] = useState(false);

  const logoScale = useSharedValue(0.82);
  const logoOpacity = useSharedValue(0);
  const glow = useSharedValue(0.25);
  const textOpacity = useSharedValue(0);
  const textOffset = useSharedValue(14);
  const progress = useSharedValue(0);
  const overlayOpacity = useSharedValue(1);
  const overlayScale = useSharedValue(1);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
    logoScale.value = withSpring(1, theme.animations.springs.soft);
    glow.value = withTiming(0.5, { duration: 900, easing: Easing.inOut(Easing.quad) });
    textOpacity.value = withDelay(160, withTiming(1, { duration: 420 }));
    textOffset.value = withDelay(160, withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) }));
    progress.value = withTiming(1, { duration: INTRO_DURATION, easing: Easing.inOut(Easing.quad) }, (finished) => {
      if (finished) {
        runOnJS(setIntroDone)(true);
      }
    });
    // Brand intro intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !introDone) {
      return;
    }
    overlayScale.value = withTiming(1.04, { duration: 280, easing: Easing.in(Easing.cubic) });
    overlayOpacity.value = withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) }, (finished) => {
      if (finished) {
        runOnJS(onFinish)();
      }
    });
  }, [ready, introDone, overlayOpacity, overlayScale, onFinish]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
    transform: [{ scale: overlayScale.value }],
  }));

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: 0.9 + glow.value * 0.35 }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textOffset.value }],
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: progress.value * 132,
  }));

  return (
    <Animated.View
      pointerEvents="auto"
      style={[StyleSheet.absoluteFill, styles.container, overlayStyle]}
    >
      <LinearGradient
        colors={theme.gradients.splash}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View
        style={[
          styles.glow,
          {
            width: width * 0.68,
            height: width * 0.68,
            borderRadius: width * 0.34,
            backgroundColor: 'rgba(159, 196, 255, 0.55)',
          },
          glowStyle,
        ]}
      />

      <View style={styles.center}>
        <Animated.View style={[styles.logoWrap, logoStyle]}>
          <Logo size={104} />
        </Animated.View>

        <Animated.View style={[styles.copy, textStyle]}>
          <Wordmark color="#FFFFFF" size={24} />
          <Animated.Text style={[styles.tagline, { fontFamily: theme.typography.caption.fontFamily }]}>
            Trabzon&apos;un dijital buluşma noktası
          </Animated.Text>
        </Animated.View>
      </View>

      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, progressStyle]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 100,
  },
  glow: {
    position: 'absolute',
    opacity: 0.4,
  },
  center: {
    alignItems: 'center',
    gap: 22,
  },
  logoWrap: {
    shadowColor: '#020B22',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.35,
    shadowRadius: 26,
  },
  copy: {
    alignItems: 'center',
    gap: 10,
  },
  tagline: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  progressTrack: {
    position: 'absolute',
    bottom: 64,
    width: 132,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
});
