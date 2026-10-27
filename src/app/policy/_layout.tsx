import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

/** Politikalar herkese aciktir; oturum sarti aranmaz. */
export default function PolicyLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
        animation: 'slide_from_right',
      }}
    />
  );
}
