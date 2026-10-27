import { Redirect } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { useAuthStatus } from '@/stores/auth-store';

/**
 * Oturum gerektiren rota gruplarini korur. Uygulama acilisinda oturum
 * okunurken bos ekran dondurur; boylece kullanici bir an icin lobby'ye
 * yonlendirilip geri atilmaz.
 */
export function AuthGate({ children }: PropsWithChildren) {
  const status = useAuthStatus();

  if (status === 'booting') {
    return null;
  }
  if (status !== 'authenticated') {
    return <Redirect href="/lobby" />;
  }
  return children;
}
