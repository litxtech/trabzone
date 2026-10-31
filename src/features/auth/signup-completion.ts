import type { PendingAcceptance } from '@/features/legal/types';
import type { Result } from '@/utils/result';
import type { Profile } from '@/features/profile/services/profile-service';

import { fetchPendingAcceptances } from '@/features/legal/services/legal-service';
import { completeRegistration, fetchMyProfile } from '@/features/profile/services/profile-service';
import { getSignUpMetadata } from '@/services/supabase/auth';

export type SignUpDestination = '/feed' | '/legal/consent' | '/complete-profile';

/** Giriş akışında zaten çekilmiş veriler; ikinci kez ağa çıkılmasını önler. */
export type SignUpPrefetch = {
  profile?: Result<Profile | null>;
  pending?: Result<PendingAcceptance[]>;
};

/**
 * Kayıt formunda ad, soyad ve kullanıcı adı zaten toplandığı için e-posta
 * doğrulamasından sonra aynı bilgiler tekrar sorulmaz: profil, kayıt sırasında
 * verilen bilgilerle sunucuda tamamlanır ve kullanıcı doğrudan akışa girer.
 *
 * Bilgiler eksikse (örneğin sosyal girişte kullanıcı adı yoksa) ya da seçilen
 * kullanıcı adı bu arada başkası tarafından alınmışsa `/complete-profile`
 * ekranına düşülür; o ekran bilinen alanları önceden doldurur.
 *
 * Giriş sonrası akışta profil ve bekleyen onaylar çağıran tarafından paralel
 * olarak çekilir; bu fonksiyon onları `prefetch` ile alıp tekrar sormaz.
 */
export async function finishSignUpFromMetadata(
  prefetch: SignUpPrefetch = {},
): Promise<SignUpDestination> {
  const profileResult = prefetch.profile ?? (await fetchMyProfile());
  if (profileResult.ok && profileResult.data?.onboarding_completed) {
    return '/feed';
  }

  const { username, firstName, lastName } = await getSignUpMetadata();
  if (!username || !firstName || !lastName) {
    return '/complete-profile';
  }

  // Profil zaten bu kullanıcı adını taşıyorsa (ör. doğrulama ekranı yeniden
  // açıldı) kayıt tekrar tamamlanmaz.
  const currentUsername = profileResult.ok ? (profileResult.data?.username ?? null) : null;
  if (currentUsername !== username) {
    // Kullanılabilirlik ön kontrolü kaldırıldı: `complete_registration`
    // kullanıcı adı çakışmasını sunucuda aynı şekilde reddediyor ve bu bir
    // gidiş-dönüş tasarrufu sağlıyor.
    const completed = await completeRegistration({ username, firstName, lastName });
    if (!completed.ok) {
      return '/complete-profile';
    }
  }

  const pendingResult = prefetch.pending ?? (await fetchPendingAcceptances());
  if (pendingResult.ok && pendingResult.data.length > 0) {
    return '/legal/consent';
  }
  return '/feed';
}
