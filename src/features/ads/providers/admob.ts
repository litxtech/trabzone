import { Platform, TurboModuleRegistry } from 'react-native';

import type { AdProviderAdapter } from './index';

/**
 * Google AdMob adaptörü (GOOGLE_ADMOB).
 *
 * Canlı gösterim için şu koşulların hepsi gerekir; biri eksikse adaptör
 * `isReady() === false` döner ve yerleşim yalnızca TRABZONE_DIRECT kullanır:
 *   1. `react-native-google-mobile-ads` paketinin kurulması ve app.config
 *      eklentisine gerçek iOS/Android App ID'lerinin yazılması (yeni native
 *      build gerekir).
 *   2. Admin → Reklam Kontrol Merkezi → Sistem Ayarları'nda AdMob'un açılması
 *      ve yerleşim başına reklam birimi kimliklerinin girilmesi.
 *   3. UMP (Google rıza) akışının ve iOS ATT isteminin tamamlanması; rıza
 *      yoksa yalnızca kişiselleştirilmemiş reklam istenmesi.
 *   4. Native reklamın SDK'nın NativeAdView bileşeniyle, zorunlu "Reklam"
 *      etiketi ve AdChoices simgesiyle çizilmesi. Görünüme özel tıklama
 *      dinleyicisi eklenmez.
 * Bu koşullar bu sürümde bilinçli olarak sağlanmamıştır.
 */
function sdkPresent(): boolean {
  if (Platform.OS === 'web') {
    return false;
  }
  try {
    return TurboModuleRegistry.get('RNGoogleMobileAdsModule') != null;
  } catch {
    return false;
  }
}

export const admobAdapter: AdProviderAdapter = {
  source: 'google_admob',
  isReady: () => admobAdapter.SlotComponent != null && sdkPresent(),
  SlotComponent: null,
};
