import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';

import { AnimatedSplash } from '@/features/splash/components/AnimatedSplash';
import { useAppBootstrap } from '@/features/splash/hooks/use-app-bootstrap';
import { perf } from '@/perf';
import { useReduceMotion } from '@/perf/use-reduce-motion';
import { AppProviders } from '@/providers/AppProviders';
import { useTheme } from '@/theme/ThemeProvider';

// Keep the native splash until fonts + session are ready, then hand over to the
// animated brand intro so the user never sees a blank frame.
SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 120, fade: true });

function RootNavigator() {
  const { theme, scheme } = useTheme();
  const reduceMotion = useReduceMotion();

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          // Yigma gecisleri native push hizinda; fade/blur yok, siyah kare yok.
          // Animasyonlari kaldiran kullanicilarda gecis tamamen atlanir.
          animation: reduceMotion ? 'none' : 'slide_from_right',
          animationDuration: perf.screenTransitionMs,
          gestureEnabled: !reduceMotion,
        }}
      >
        {/* Acilistaki oturum gecisleri animasyonsuz: splash'ten uygulamaya
            gecerken ekran kararmasi/fade'i olusmaz. */}
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(auth)" options={{ animation: 'none' }} />
        <Stack.Screen name="(app)" options={{ animation: 'none' }} />
        <Stack.Screen name="support" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="policy" />
        <Stack.Screen name="admin" />
      </Stack>
    </>
  );
}

function RootLayoutInner() {
  const { ready } = useAppBootstrap();
  const [introVisible, setIntroVisible] = useState(true);
  const handleIntroFinish = useCallback(() => setIntroVisible(false), []);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready]);

  return (
    <>
      {ready ? <RootNavigator /> : null}
      {introVisible ? <AnimatedSplash ready={ready} onFinish={handleIntroFinish} /> : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <RootLayoutInner />
    </AppProviders>
  );
}
