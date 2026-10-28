import { Redirect } from 'expo-router';
import { Platform } from 'react-native';

import { LandingPage } from '@/features/web/components/LandingPage';
import { useAuthStatus } from '@/stores/auth-store';

export default function IndexRoute() {
  const status = useAuthStatus();

  if (Platform.OS === 'web') {
    // Web kök adresi her zaman herkese açık karşılama sayfasıdır. Oturum açmış
    // kullanıcılar üst menüden uygulamaya geçebilir; zorla yönlendirilmez.
    return <LandingPage />;
  }

  if (status === 'booting') {
    return null;
  }

  return <Redirect href={status === 'authenticated' ? '/feed' : '/lobby'} />;
}
