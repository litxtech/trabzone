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
 * - Apple: yalnızca iOS'un native oturum sayfası vardır (Android/web'de Apple
 *   SDK'sı olmadığı için buton gösterilmez).
 * - Google: native hesap seçici yalnızca mobilde çalışır ve `webClientId`
 *   tanımlı olmalıdır (id token `aud` doğrulaması bu kimlikle yapılır).
 *
 * Ekranlar bu yardımcıyı kullanarak butonu ve "veya" ayırıcısını birlikte
 * gizler; böylece bayrak açık ama sağlayıcı yapılandırılmamışken boş bir
 * ayırıcı görünmez.
 */
export function socialAvailability(os: string = Platform.OS): SocialAvailability {
  const enabled = env.enableSocialAuth;
  const apple = enabled && os === 'ios';
  const google = enabled && os !== 'web' && Boolean(env.googleWebClientId);
  return { apple, google, any: apple || google };
}
