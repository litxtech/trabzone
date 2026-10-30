import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuthStatus } from '@/stores/auth-store';

import {
  ensureNotificationChannels,
  notificationsModule,
  refreshPushRegistration,
} from './push-registration';

function routeFrom(data: unknown): string | null {
  const route = (data as { route?: unknown } | null)?.route;
  return typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') ? route : null;
}

type ResponseLike = {
  notification: {
    request: {
      identifier: string;
      content: { data?: unknown };
    };
  };
};

/**
 * Push bildirimlerinin uygulama tarafı:
 *  - Uygulama açıkken gelen bildirim sistem bildirimi olarak gösterilir.
 *  - Bildirime dokunulunca `data.route` (ör. /post/:id, /chat/:id) açılır.
 *  - Oturum açıkken ve izin zaten verilmişse token sessizce tazelenir;
 *    izin penceresi burada açılmaz (yalnızca kullanıcı bildirimi açınca).
 *  - Token değişimi (cihaz geri yükleme, FCM yenilemesi) ve uygulamanın öne
 *    gelmesi kaydı tazeler; böylece ölü token birikmez.
 *  - Soğuk açılışta bildirime dokunulduysa hedef, oturum durumu netleşene
 *    kadar bekletilir; erken yönlendirme giriş ekranına düşmez.
 */
export function PushBridge() {
  const status = useAuthStatus();
  const statusRef = useRef(status);
  const pendingRoute = useRef<string | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const Notifications = notificationsModule();
    if (!Notifications) return;

    void ensureNotificationChannels();

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    // Aynı yanıt iki kez işlenmesin (soğuk açılış + listener).
    const handled = new Set<string>();
    const open = (response: ResponseLike | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (id && handled.has(id)) return;
      if (id) handled.add(id);

      const route = routeFrom(response.notification.request.content.data);
      if (!route) return;

      if (statusRef.current === 'booting') {
        pendingRoute.current = route;
        return;
      }
      // Stack henüz hazır olmayabilir; bir sonraki tura bırakılır.
      setTimeout(() => {
        try {
          router.push(route as never);
        } catch {
          // Yönlendirme başarısızsa kullanıcı uygulamada kalır.
        }
      }, 0);
    };

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        open(response as ResponseLike | null);
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => undefined);

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) =>
      open(response as unknown as ResponseLike),
    );

    // Yalnızca native token üretildiğinde tetiklenir; Expo token'ı yeniden
    // alıp sunucuya yazar. Sık tetiklenmeye karşı registerForPush kendi
    // içinde 15 dakikalık pencere ve tek uçuş koruması uygular.
    const tokenSub = Notifications.addPushTokenListener(() => {
      void refreshPushRegistration();
    });

    return () => {
      responseSub.remove();
      tokenSub.remove();
    };
  }, []);

  // Oturum durumu netleşince bekleyen bildirim hedefi açılır.
  useEffect(() => {
    if (status === 'booting') return;
    const route = pendingRoute.current;
    if (!route) return;
    pendingRoute.current = null;
    try {
      router.push(route as never);
    } catch {
      // Hedef geçersizse yok sayılır.
    }
  }, [status]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    void refreshPushRegistration();

    // Arka plandan dönen uygulama kaydı tazeler (token süresi/izin değişimi).
    let last = Date.now();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      void refreshPushRegistration();
    });

    return () => subscription.remove();
  }, [status]);

  return null;
}
