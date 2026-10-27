import { Redirect } from 'expo-router';

import { useAuthStatus } from '@/stores/auth-store';

export default function IndexRoute() {
  const status = useAuthStatus();

  if (status === 'booting') {
    return null;
  }

  return <Redirect href={status === 'authenticated' ? '/feed' : '/lobby'} />;
}
