import { Stack, usePathname } from 'expo-router';
import { Platform } from 'react-native';

import { AuthGate } from '@/features/auth/components/AuthGate';
import { useTheme } from '@/theme/ThemeProvider';

export default function SupportLayout() {
  const { theme } = useTheme();
  const pathname = usePathname();

  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
        animation: 'slide_from_right',
      }}
    />
  );

  // Destek merkezi ve yardım makaleleri herkese açıktır; mağaza incelemesi ve
  // giriş yapamayan kullanıcıların talep açabilmesi için oturum zorunlu değildir.
  // Taleplerim, canlı sohbet ve bildirimler oturum gerektirmeye devam eder.
  if (Platform.OS === 'web' && pathname.replace(/\/+$/, '') === '/support') {
    return stack;
  }

  return <AuthGate>{stack}</AuthGate>;
}
