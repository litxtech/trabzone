import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Logo, Wordmark } from '@/components/ui';
import { perf } from '@/perf';
import { useReduceMotion } from '@/perf/use-reduce-motion';
import { useTheme } from '@/theme/ThemeProvider';

type AnimatedSplashProps = {
  /** True once fonts, theme and the auth session are restored. */
  ready: boolean;
  onFinish: () => void;
};

/**
 * Brand intro played once, on top of the first rendered route.
 * Total blocking time is kept under ~450ms: the intro never waits for the
 * network and hands over as soon as fonts + session are restored.
 *
 * Android'de intro daha kisa (perf.splashIntroMs) tutulur; animasyonlari
 * kaldiran kullanicilarda hic oynatilmaz.
 */
export function AnimatedSplash({ ready, onFinish }: AnimatedSplashProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [introFinished, setIntroFinished] = useState(false);
  // Animasyonlari kaldiran kullanicilarda intro tamamlanmis sayilir; ekstra
  // state gecisi (effect icinde setState) olusmaz.
  const introDone = introFinished || reduceMotion;

  const logoScale = useSharedValue(0.94);
  const logoOpacity = useSharedValue(0);
  const glow = useSharedValue(0.3);
  const textOpacity = useSharedValue(0);
  const progress = useSharedValue(0);
  const overlayOpacity = useSharedValue(1);
  const overlayScale = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      // Animasyonlar kapali: intro bekletmeden tamamlanir.
      logoOpacity.set(1);
      logoScale.set(1);
      glow.set(0.5);
      textOpacity.set(1);
      progress.set(1);
      return;
    }

    logoOpacity.set(withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }));
    logoScale.set(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
    glow.set(withTiming(0.5, { duration: perf.splashIntroMs, easing: Easing.out(Easing.quad) }));
    textOpacity.set(withDelay(70, withTiming(1, { duration: 190 })));
    progress.set(
      withTiming(1, { duration: perf.splashIntroMs, easing: Easing.out(Easing.quad) }, (finished) => {
        if (finished) {
          runOnJS(setIntroFinished)(true);
        }
      }),
    );
    // Brand intro intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  // Emniyet: `withTiming` geri cagrisi (uygulama arka planda acildi, JS is
  // parcacigi yogundu, yenileme sirasinda animasyon dusuruldu) gelmezse intro
  // hic "bitmedi" kalirdi; perde opak halde ustte kalip uygulama gorunur ama
  // kullanilamaz olurdu. Zaman asimi introyu her kosulda bitirir.
  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    const safety = setTimeout(() => setIntroFinished(true), perf.splashIntroMs + 350);
    return () => clearTimeout(safety);
  }, [reduceMotion]);

  useEffect(() => {
    if (!ready || !introDone) {
      return;
    }
    if (reduceMotion) {
      onFinish();
      return;
    }
    overlayScale.set(withTiming(1.02, { duration: perf.splashExitMs, easing: Easing.in(Easing.cubic) }));
    overlayOpacity.set(
      withTiming(0, { duration: perf.splashExitMs, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) {
          runOnJS(onFinish)();
        }
      }),
    );
    // Emniyet: animasyon geri cagrisi (arka plana gecis, JS is parcacigi
    // yogunlugu) kaybolursa tam ekran katman gorunmez sekilde ustte kalip
    // tum dokunuslari yutabilirdi. Kisa bir zaman asimi katmanin kapanmasini
    // garanti eder.
    const safety = setTimeout(onFinish, 400);
    return () => clearTimeout(safety);
  }, [ready, introDone, overlayOpacity, overlayScale, onFinish, reduceMotion]);

  // Giris perdesi dokunuslari HIC yakalamaz: uygulama hazir degilken altinda
  // etkilesimli bir ekran yok; hazir olduktan sonra kapanis animasyonu sirasinda
  // parmak dogrudan uygulamaya ulasmali. Daha once perde `pointerEvents="auto"`
  // ile duruyordu; yenileme sonrasi kapanis gecikirse ilk dokunuslari yutuyordu.
  const overlayPointerEvents = 'none' as const;

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.get(),
    transform: [{ scale: overlayScale.get() }],
  }));

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.get(),
    transform: [{ scale: logoScale.get() }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.get(),
    transform: [{ scale: 0.9 + glow.get() * 0.35 }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.get(),
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: progress.get() * 132,
  }));

  return (
    <Animated.View
      pointerEvents={overlayPointerEvents}
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
          <Wordmark color="#FFFFFF" accentColor="#A78BFA" size={24} />
          <Animated.Text
            style={[styles.tagline, { fontFamily: theme.typography.caption.fontFamily }]}
          >
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
    // Agir golge kaldirildi: acilista ekstra offscreen render maliyeti yok.
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
