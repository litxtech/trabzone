import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';

import { AnimatedSplash } from '@/features/splash/components/AnimatedSplash';
import { useAppBootstrap } from '@/features/splash/hooks/use-app-bootstrap';
import { AppProviders } from '@/providers/AppProviders';
import { useTheme } from '@/theme/ThemeProvider';

// Keep the native splash until fonts + session are ready, then hand over to the
// animated brand intro so the user never sees a blank frame.
SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 250, fade: true });

function RootNavigator() {
  const { theme, scheme } = useTheme();

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
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
