import { Redirect, usePathname } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { useAuthStatus } from '@/stores/auth-store';

import { loginHref } from '../next-path';

/**
 * Oturum gerektiren rota gruplarini korur. Uygulama acilisinda oturum
 * okunurken bos ekran dondurur; boylece kullanici bir an icin lobby'ye
 * yonlendirilip geri atilmaz.
 *
 * Oturum yoksa kullanici dogrudan giris formuna gonderilir ve acilmak istenen
 * adres `next` parametresinde tasinir (ornegin `/login?next=/marketplace/abc`).
 * Giriş tamamlandiginda ayni ilan acilir; derin baglantilar ve paylasilan
 * ilan adresleri boylece kaybolmaz.
 */
export function AuthGate({ children }: PropsWithChildren) {
  const status = useAuthStatus();
  const pathname = usePathname();

  if (status === 'booting') {
    return null;
  }
  if (status !== 'authenticated') {
    return <Redirect href={loginHref(pathname)} />;
  }
  return children;
}
