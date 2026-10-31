import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/services/supabase/client';

type NotificationsModule = typeof import('expo-notifications');
type PermissionStatus = import('expo-notifications').NotificationPermissionsStatus;

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
    // Cihazda zaten tanımlı kanallar için tekrar `setNotificationChannelAsync`
    // çağrılmaz: Android mevcut kanalın sesini/önemini sonradan değiştirmez,
    // üstelik bu çağrı her açılışta native tarafta hata logu üretiyordu.
    const existing = await Notifications.getNotificationChannelsAsync().catch(() => []);
    const known = new Set((existing ?? []).map((channel) => channel.id));
    const missing = CHANNELS.filter((channel) => !known.has(channel.id));

    await Promise.all(
      missing.map((channel) =>
        Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          description: channel.description,
          importance:
            channel.importance === 'HIGH'
              ? Notifications.AndroidImportance.HIGH
              : Notifications.AndroidImportance.DEFAULT,
          // Sessiz saatler ve tercihler sunucuda uygulanır; kanal tarafında
          // ek kısıt konmaz, böylece kullanıcı cihaz ayarlarını korur.
          //
          // `sound` BİLİNÇLİ olarak verilmez: Android kanalında bu alan bir
          // ses dosyası adıdır; `'default'` de dosya adı sanıldığı için native
          // tarafta "Custom sound 'default' not found" hatası basılıyordu.
          // Alan yokken kanal sistemin varsayılan bildirim sesini kullanır.
          enableVibrate: true,
          // Simge rozeti: destekleyen başlatıcılarda okunmamış sayısını gösterir.
          showBadge: true,
          enableLights: true,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
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

/**
 * iOS'ta "geçici onay" (provisional) da bildirim teslim eder; `granted`
 * alanı bu durumda false dönebildiği için ayrıca kontrol edilir.
 */
function isGranted(Notifications: NotificationsModule, settings: PermissionStatus): boolean {
  if (settings.granted) return true;
  if (Platform.OS !== 'ios') return false;
  return (
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

export async function currentPermission(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  const Notifications = notificationsModule();
  if (!Notifications) return 'unsupported';
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (isGranted(Notifications, settings)) return 'granted';
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

/** Cihazda en son kaydedilen token; uygulama yeniden açıldığında gereksiz RPC olmasın. */
const TOKEN_KEY = 'trabzone.push.token';
const TOKEN_SYNCED_AT_KEY = 'trabzone.push.syncedAt';
/**
 * Sunucu bir token'ı `DeviceNotRegistered` ile geçersiz işaretlerse istemci
 * bunu bilemez; kayıt tazelenene kadar push kesilir. 12 saatlik pencere bu
 * durumda bir gün boyunca sessiz kalmaya yol açıyordu. Saatte bir yapılan tek
 * RPC maliyetsizdir ve ölü token en geç bir saat içinde yeniden kaydolur.
 */
const RESYNC_AFTER_MS = 60 * 60_000;

/** FCM/APNs token üretimi soğuk açılışta ilk denemede hazır olmayabilir. */
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(run: () => Promise<T>, delays: number[]): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt < delays.length) await sleep(delays[attempt]!);
    }
  }
  throw lastError;
}

let lastSynced: { token: string; at: number } | null = null;
let inFlight: Promise<PushRegistrationResult> | null = null;

async function readStoredToken(): Promise<{ token: string | null; syncedAt: number }> {
  try {
    const [token, syncedAt] = await Promise.all([
      AsyncStorage.getItem(TOKEN_KEY),
      AsyncStorage.getItem(TOKEN_SYNCED_AT_KEY),
    ]);
    return { token, syncedAt: Number(syncedAt ?? 0) || 0 };
  } catch {
    return { token: null, syncedAt: 0 };
  }
}

async function storeToken(token: string): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, token],
      [TOKEN_SYNCED_AT_KEY, String(Date.now())],
    ]);
  } catch {
    // Depolama yoksa her açılışta yeniden kayıt denenir; zararsız.
  }
}

/**
 * İzin ister (gerekirse), Expo push token alır ve sunucuya kaydeder.
 * `prompt: false` iken izin penceresi açılmaz; yalnızca mevcut izinle kayıt
 * tazelenir (oturum açılışında sessiz yenileme için).
 *
 * Token üretimi ve kayıt hatası kısa bir geri çekilmeyle yeniden denenir:
 * Android'de Firebase ilk açılışta hazır olmayabilir, iOS'ta ağ geçişi
 * sırasında istek düşebilir. 12 saat içinde aynı token için RPC tekrarlanmaz;
 * eşzamanlı çağrılar tek istekte birleşir.
 */
export async function registerForPush(options: { prompt: boolean }): Promise<PushRegistrationResult> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<PushRegistrationResult> => {
    const Notifications = notificationsModule();
    if (!Notifications) return { ok: false, reason: 'unsupported' };

    let settings = await Notifications.getPermissionsAsync();
    if (!isGranted(Notifications, settings) && options.prompt && settings.canAskAgain) {
      // Android 13+: izin penceresi kanal oluşturulduktan sonra gösterilir.
      await ensureNotificationChannels();
      settings = await Notifications.requestPermissionsAsync();
    }
    if (!isGranted(Notifications, settings)) return { ok: false, reason: 'denied' };

    await ensureNotificationChannels();

    const project = projectId();
    if (!project) return { ok: false, reason: 'no_project' };

    let token: string;
    try {
      token = await withRetry(
        async () => (await Notifications.getExpoPushTokenAsync({ projectId: project })).data,
        [600, 1_500, 3_000],
      );
    } catch {
      return { ok: false, reason: 'token_failed' };
    }

    const stored = await readStoredToken();
    const freshInMemory = lastSynced?.token === token && Date.now() - lastSynced.at < RESYNC_AFTER_MS;
    const freshOnDisk = stored.token === token && Date.now() - stored.syncedAt < RESYNC_AFTER_MS;
    if (freshInMemory || freshOnDisk) {
      lastSynced = { token, at: Date.now() };
      return { ok: true, token };
    }

    try {
      await withRetry(
        async () => {
          const { error } = await supabase.rpc('push_device_register', {
            p_token: token,
            p_platform: Platform.OS,
            p_device_id: await installationId(),
            p_app_version: Constants.expoConfig?.version ?? null,
            p_os_version: String(Platform.Version ?? ''),
          });
          if (error) throw error;
        },
        [1_000, 3_000],
      );
    } catch {
      lastSynced = null;
      return { ok: false, reason: 'register_failed' };
    }

    await storeToken(token);
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
    const project = projectId();
    const token = project
      ? (await Notifications.getExpoPushTokenAsync({ projectId: project })).data
      : (await readStoredToken()).token;
    if (token) await supabase.rpc('push_device_unregister', { p_token: token });
  } catch {
    // Çıkış akışı push kaydı yüzünden bloklanmaz.
  } finally {
    lastSynced = null;
    try {
      await AsyncStorage.multiRemove([TOKEN_KEY, TOKEN_SYNCED_AT_KEY]);
    } catch {
      // yok sayılır
    }
    // Çıkış yapan kullanıcının rozeti cihazda kalmasın.
    void syncBadgeCount(0);
  }
}

/**
 * Uygulama simgesindeki rozeti okunmamış bildirim sayısıyla eşitler.
 *
 * Tek doğruluk kaynağı sunucudur (`notifications_unread_count`); push
 * yükündeki `badge` yalnızca uygulama kapalıyken gösterilen değerdir. Bu
 * fonksiyon uygulama öne geldiğinde, push alındığında ve bildirim okunduğunda
 * çağrılır. Android'de yalnızca rozet destekleyen başlatıcılarda görünür.
 */
export async function syncBadgeCount(count: number): Promise<void> {
  const Notifications = notificationsModule();
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.min(999, Math.floor(count))));
  } catch {
    // Rozet desteklenmiyorsa yok sayılır.
  }
}

/** Uygulama simgesindeki rozet sayacını sıfırlar. */
export async function clearBadge(): Promise<void> {
  await syncBadgeCount(0);
}

/** Cihaz başına sabit kimlik: aynı cihazda token yenilenince eski satır birleşir. */
const INSTALLATION_KEY = 'trabzone.push.installationId';

async function installationId(): Promise<string | null> {
  try {
    const existing = await AsyncStorage.getItem(INSTALLATION_KEY);
    if (existing) return existing;
    const created = Crypto.randomUUID();
    await AsyncStorage.setItem(INSTALLATION_KEY, created);
    return created;
  } catch {
    return null;
  }
}
