import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

export default function EarthquakeLayout() {
  const { theme } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
