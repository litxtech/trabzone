import { Tabs } from 'expo-router/js-tabs';

import { AppTabBar } from '@/components/navigation/AppTabBar';
import { useTheme } from '@/theme/ThemeProvider';

export default function TabsLayout() {
  const { theme } = useTheme();

  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.background },
        // Sekmeler arasi gecis beklemesiz olmali: fade/shift yerine dogrudan
        // degistir. Ekranlar `lazy` ile bir kez kurulur ve bagli kalir, boylece
        // sekmeye geri donuste yeniden yukleme/istek olmaz.
        animation: 'none',
        lazy: true,
      }}
    >
      <Tabs.Screen name="feed" options={{ title: 'Akış' }} />
      <Tabs.Screen name="marketplace" options={{ title: 'Market' }} />
      <Tabs.Screen name="reels" options={{ title: 'Reels' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
