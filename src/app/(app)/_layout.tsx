import { Stack } from 'expo-router';

import { DrawerHost } from '@/components/navigation/DrawerHost';
import { AuthGate } from '@/features/auth/components/AuthGate';
import { perf } from '@/perf';
import { useReduceMotion } from '@/perf/use-reduce-motion';
import { useTheme } from '@/theme/ThemeProvider';

export default function AppLayout() {
  const { theme } = useTheme();
  const reduceMotion = useReduceMotion();

  return (
    <AuthGate>
      <DrawerHost>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
            // Detay ekranlari sagdan sola, native hizda acilir. Sekme kabugu
            // ayri bir ekran oldugu icin gecis yalnizca bu yigin icinde olur;
            // cift navigasyon veya header ziplamasi olusmaz.
            animation: reduceMotion ? 'none' : 'slide_from_right',
            animationDuration: perf.screenTransitionMs,
            gestureEnabled: !reduceMotion,
            fullScreenGestureEnabled: !reduceMotion,
            animationMatchesGesture: !reduceMotion,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
        </Stack>
      </DrawerHost>
    </AuthGate>
  );
}
