import { Stack } from 'expo-router';

import { DrawerHost } from '@/components/navigation/DrawerHost';
import { AuthGate } from '@/features/auth/components/AuthGate';
import { useTheme } from '@/theme/ThemeProvider';

export default function AppLayout() {
  const { theme } = useTheme();

  return (
    <AuthGate>
      <DrawerHost>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
      </DrawerHost>
    </AuthGate>
  );
}
