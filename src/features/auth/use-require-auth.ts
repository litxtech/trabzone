import { useCallback } from 'react';

import { useAuthStatus } from '@/stores/auth-store';
import { useRouter, type Href } from '@/utils/router';

import { loginHref } from './next-path';

/**
 * Oturum gerektiren hedefler için tek kapı.
 *
 * İlan, işletme ve sohbet gibi sayfalar yalnızca giriş yapmış kullanıcıya
 * açılır. Oturum yoksa kullanıcı giriş formuna `next` parametresiyle
 * yönlendirilir; giriş tamamlanınca tıkladığı ilana döner.
 */
export function useRequireAuth() {
  const router = useRouter();
  const status = useAuthStatus();

  return useCallback(
    (href: string) => {
      if (status === 'authenticated') {
        router.push(href as Href);
        return;
      }
      router.push(loginHref(href));
    },
    [router, status],
  );
}

/**
 * Aynı kararın bağlantı (`Link`) biçimi. Sunucu tarafında üretilen HTML
 * bağlantıları korunur; istemci tarafında hedef oturuma göre seçilir.
 */
export function authLinkHref(href: string, status: 'authenticated' | 'booting' | 'unauthenticated'): Href {
  return status === 'authenticated' ? (href as Href) : loginHref(href);
}
