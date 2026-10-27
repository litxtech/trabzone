import { Stack } from 'expo-router';

import { AuthGate } from '@/features/auth/components/AuthGate';
import { useTheme } from '@/theme/ThemeProvider';

export default function SettingsLayout() {
  const { theme } = useTheme();

  return (
    <AuthGate>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'slide_from_right',
        }}
      />
    </AuthGate>
  );
}
