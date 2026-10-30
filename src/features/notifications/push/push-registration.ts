import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/services/supabase/client';

type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

/**
 * expo-notifications native modülü yalnızca development/production build'de
 * bulunur. Web'de ve modülsüz ortamlarda null döner; uygulama push olmadan
 * (uygulama içi bildirim geçmişiyle) çalışmaya devam eder.
 */
export function notificationsModule(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web') {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

export type PushRegistrationResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no_project' | 'token_failed' | 'register_failed' };

/**
 * Android kanalları.
 *
 * Kanallar kullanıcı tarafından cihaz ayarlarından değiştirilebilir; burada
 * yalnızca ilk oluşturma ve varsayılan önem düzeyleri tanımlanır. Kanal
 * kimlikleri sunucudaki `push-dispatch` ile birebir aynı olmalıdır:
 *   social   → beğeni, yorum, takip, davet (varsayılan)
 *   messages → sohbet ve pazaryeri mesajları
 *   alerts   → sipariş, destek, güvenlik, yolculuk
 *   pharmacy → nöbetçi eczane duyuruları
 *   earthquake / earthquake-important / sports → kendi hatları
 *
 * HIGH önemli kanallar uygulama arka plandayken de başlık (heads-up) olarak
 * görünür; bu yüzden günlük ve zamana duyarlı türler HIGH'dır.
 */
const CHANNELS = [
  { id: 'social', name: 'Sosyal etkileşimler', description: 'Beğeni, yorum, takip ve davetler', importance: 'DEFAULT' },
  { id: 'messages', name: 'Mesajlar', description: 'Sohbet ve pazaryeri mesajları', importance: 'HIGH' },
  { id: 'alerts', name: 'Sipariş, destek ve güvenlik', description: 'Sipariş, destek, güvenlik ve yolculuk bildirimleri', importance: 'HIGH' },
  { id: 'pharmacy', name: 'Nöbetçi eczane', description: 'Günlük nöbetçi eczane duyuruları', importance: 'HIGH' },
  { id: 'earthquake', name: 'Deprem bildirimleri', description: 'Trabzone Deprem Merkezi kayıt bildirimleri', importance: 'DEFAULT' },
  { id: 'earthquake-important', name: 'Önemli deprem kayıtları', description: 'Büyüklüğü 4,0 ve üzeri deprem kayıtları', importance: 'HIGH' },
  { id: 'sports', name: 'Trabzonspor maç bildirimleri', description: 'Gol, kart, başlama ve sonuç bildirimleri', importance: 'HIGH' },
] as const;

let channelsReady = false;

/** Tüm Android kanallarını oluşturur (idempotent, tek seferlik). */
export async function ensureNotificationChannels(): Promise<void> {
  const Notifications = notificationsModule();
  if (!Notifications || Platform.OS !== 'android' || channelsReady) return;
  try {
    await Promise.all(
      CHANNELS.map((channel) =>
        Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          description: channel.description,
          importance:
            channel.importance === 'HIGH'
              ? Notifications.AndroidImportance.HIGH
              : Notifications.AndroidImportance.DEFAULT,
          // Sessiz saatler ve tercihler sunucuda uygulanır; kanal tarafında
          // ek kısıt konmaz, böylece kullanıcı cihaz ayarlarını korur.
          sound: 'default',
          enableVibrate: true,
        }),
      ),
    );
    channelsReady = true;
  } catch {
    // Kanal oluşturma başarısız olsa da push gönderimi "social" varsayılanına düşer.
  }
}

/** Geriye dönük ad: deprem ekranları bu adı çağırıyordu. */
export const ensureEarthquakeChannels = ensureNotificationChannels;

export async function currentPermission(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  const Notifications = notificationsModule();
  if (!Notifications) return 'unsupported';
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return 'granted';
    return settings.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

function projectId(): string | null {
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

let lastSynced: { token: string; at: number } | null = null;
let inFlight: Promise<PushRegistrationResult> | null = null;

/**
 * İzin ister (gerekirse), Expo push token alır ve sunucuya kaydeder.
 * `prompt: false` iken izin penceresi açılmaz; yalnızca mevcut izinle kayıt
 * tazelenir (oturum açılışında sessiz yenileme için).
 *
 * Aynı token 15 dakika içinde yeniden kaydedilmez; eşzamanlı çağrılar tek
 * istekte birleşir. Token değiştiğinde (cihaz geri yükleme, FCM yenilemesi)
 * `refreshPushRegistration` yeniden kaydı tetikler.
 */
export async function registerForPush(options: { prompt: boolean }): Promise<PushRegistrationResult> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<PushRegistrationResult> => {
    const Notifications = notificationsModule();
    if (!Notifications) return { ok: false, reason: 'unsupported' };

    let settings = await Notifications.getPermissionsAsync();
    if (!settings.granted && options.prompt && settings.canAskAgain) {
      // Android 13+: izin penceresi kanal oluşturulduktan sonra gösterilir.
      await ensureNotificationChannels();
      settings = await Notifications.requestPermissionsAsync();
    }
    if (!settings.granted) return { ok: false, reason: 'denied' };

    await ensureNotificationChannels();

    const project = projectId();
    if (!project) return { ok: false, reason: 'no_project' };

    let token: string;
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId: project })).data;
    } catch {
      return { ok: false, reason: 'token_failed' };
    }

    if (lastSynced?.token === token && Date.now() - lastSynced.at < 15 * 60_000) {
      return { ok: true, token };
    }

    const { error } = await supabase.rpc('push_device_register', {
      p_token: token,
      p_platform: Platform.OS,
      p_device_id: null,
      p_app_version: Constants.expoConfig?.version ?? null,
      p_os_version: String(Platform.Version ?? ''),
    });
    if (error) {
      lastSynced = null;
      return { ok: false, reason: 'register_failed' };
    }

    lastSynced = { token, at: Date.now() };
    return { ok: true, token };
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Oturum açıkken sessiz tazeleme; hata yutulur (akış bloklanmaz). */
export async function refreshPushRegistration(): Promise<void> {
  try {
    await registerForPush({ prompt: false });
  } catch {
    // Sessiz tazeleme başarısızsa bir sonraki tetikte tekrar denenir.
  }
}

export async function unregisterPush(): Promise<void> {
  const Notifications = notificationsModule();
  if (!Notifications) return;
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (!settings.granted) return;
    const project = projectId();
    if (!project) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: project })).data;
    await supabase.rpc('push_device_unregister', { p_token: token });
    lastSynced = null;
  } catch {
    // Çıkış akışı push kaydı yüzünden bloklanmaz.
  }
}

/** Uygulama simgesindeki rozet sayacını sıfırlar (bildirimler okunduğunda). */
export async function clearBadge(): Promise<void> {
  const Notifications = notificationsModule();
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Rozet desteklenmiyorsa yok sayılır.
  }
}
