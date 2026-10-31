import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import {
  notificationQueryKeys,
} from '@/features/notifications/services/notifications-service';
import { useNotificationRealtime, useUnreadNotifications } from '@/features/notifications/hooks/use-notifications';
import { supabase } from '@/services/supabase/client';
import { useAuthStatus } from '@/stores/auth-store';

import {
  ensureNotificationChannels,
  notificationsModule,
  refreshPushRegistration,
  syncBadgeCount,
} from './push-registration';

function routeFrom(data: unknown): string | null {
  const route = (data as { route?: unknown } | null)?.route;
  return typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') ? route : null;
}

function notificationIdFrom(data: unknown): string | null {
  const id = (data as { notification_id?: unknown } | null)?.notification_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
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
 *  - Bildirime dokunulunca `data.route` (ör. /post/:id, /chat/:id) açılır ve
 *    o bildirim okundu işaretlenir; rozet anında düşer.
 *  - Oturum açıkken ve izin zaten verilmişse token sessizce tazelenir;
 *    izin penceresi burada açılmaz (yalnızca kullanıcı bildirimi açınca).
 *  - Token değişimi (cihaz geri yükleme, FCM yenilemesi) ve uygulamanın öne
 *    gelmesi kaydı tazeler; böylece ölü token birikmez.
 *  - Simge rozeti her zaman sunucudaki okunmamış sayısıyla eşitlenir; push
 *    yükündeki `badge` yalnızca uygulama kapalıyken devreye girer.
 *  - Soğuk açılışta bildirime dokunulduysa hedef, oturum durumu netleşene
 *    kadar bekletilir; erken yönlendirme giriş ekranına düşmez.
 */
export function PushBridge() {
  const status = useAuthStatus();
  const queryClient = useQueryClient();
  const unread = useUnreadNotifications();
  const statusRef = useRef(status);
  const pendingRoute = useRef<string | null>(null);
  const lastBadge = useRef<number | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Sunucu tek doğruluk kaynağı: okunmamış sayısı değiştiğinde rozeti eşitle.
  // (Realtime + mark-read invalidasyonları bu query'yi tetikler.)
  useEffect(() => {
    if (status !== 'authenticated') {
      if (lastBadge.current !== 0) {
        lastBadge.current = 0;
        void syncBadgeCount(0);
      }
      return;
    }
    const count = typeof unread.data === 'number' ? unread.data : 0;
    if (lastBadge.current === count) return;
    lastBadge.current = count;
    void syncBadgeCount(count);
  }, [status, unread.data]);

  // Uygulama açıkken yeni bildirim yazıldığında sayaç/liste anında tazelensin.
  useNotificationRealtime();

  useEffect(() => {
    const Notifications = notificationsModule();
    if (!Notifications) return;

    void ensureNotificationChannels();

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        // Push yükündeki `badge` uygulanır; ardından senkron sunucu sayısına
        // çeker. false olsaydı uygulama açıkken rozet hiç güncellenmezdi.
        shouldSetBadge: true,
      }),
    });

    // Aynı yanıt iki kez işlenmesin (soğuk açılış + listener).
    const handled = new Set<string>();
    const open = (response: ResponseLike | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (id && handled.has(id)) return;
      if (id) handled.add(id);

      const data = response.notification.request.content.data;

      // Dokunulan bildirim okundu sayılır: rozet ve in-app sayaç hemen düşer.
      const notificationId = notificationIdFrom(data);
      if (notificationId) {
        void supabase
          .rpc('notifications_mark_read', { p_ids: [notificationId] })
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread });
            void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
          });
      }

      const route = routeFrom(data);
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

    // Ön planda gelen bildirim de sayacı tazeler (push yükündeki badge'e ek
    // olarak sunucu sayısı doğrulanır).
    const receivedSub = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread });
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
    });

    // Yalnızca native token üretildiğinde tetiklenir; Expo token'ı yeniden
    // alıp sunucuya yazar. Sık tetiklenmeye karşı registerForPush kendi
    // içinde 12 saatlik pencere ve tek uçuş koruması uygular.
    const tokenSub = Notifications.addPushTokenListener(() => {
      void refreshPushRegistration();
    });

    return () => {
      responseSub.remove();
      receivedSub.remove();
      tokenSub.remove();
    };
  }, [queryClient]);

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
    void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread });

    // Arka plandan dönen uygulama kaydı tazeler (token süresi/izin değişimi)
    // ve rozeti sunucudaki güncel okunmamış sayısına çeker.
    let last = Date.now();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread });
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      void refreshPushRegistration();
    });

    return () => subscription.remove();
  }, [status, queryClient]);

  return null;
}
