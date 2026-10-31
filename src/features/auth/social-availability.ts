import { Platform } from 'react-native';

import { env } from '@/config/env';

export type SocialAvailability = {
  apple: boolean;
  google: boolean;
  any: boolean;
};

/**
 * Bir sosyal giriş yönteminin bu platformda gerçekten açılabilir olup
 * olmadığını tek yerden belirler.
 *
 * - Apple: iOS'ta sistemin native oturum sayfası, Android'de Apple'ın web
 *   yetkilendirmesi (PKCE tarayıcı akışı) kullanılır. Apple mobil için native
 *   bir Android SDK'sı sunmadığı için Android'de tek yol budur.
 * - Google: mobilde native hesap seçici (yalnızca istemci kimlikleri ve native
 *   bayrak açıksa) ya da tarayıcı tabanlı PKCE akışı çalışır; bu yüzden
 *   istemci kimliği tanımlı olmasa da buton gösterilir.
 *
 * Web'de sosyal giriş kapalıdır: tarayıcı akışı site URL'sine döner ve web
 * oturumu e-posta/şifre ile yönetilir.
 *
 * Ekranlar bu yardımcıyı kullanarak butonu ve "veya" ayırıcısını birlikte
 * gizler; böylece bayrak açık ama sağlayıcı yapılandırılmamışken boş bir
 * ayırıcı görünmez.
 */
export function socialAvailability(os: string = Platform.OS): SocialAvailability {
  const enabled = env.enableSocialAuth;
  const apple = enabled && (os === 'ios' || os === 'android');
  const google = enabled && os !== 'web';
  return { apple, google, any: apple || google };
}
