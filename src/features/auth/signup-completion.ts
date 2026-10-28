import { fetchPendingAcceptances } from '@/features/legal/services/legal-service';
import {
  completeRegistration,
  fetchMyProfile,
  fetchUsernameAvailability,
} from '@/features/profile/services/profile-service';
import { getSignUpMetadata } from '@/services/supabase/auth';

export type SignUpDestination = '/feed' | '/legal/consent' | '/complete-profile';

/**
 * Kayıt formunda ad, soyad ve kullanıcı adı zaten toplandığı için e-posta
 * doğrulamasından sonra aynı bilgiler tekrar sorulmaz: profil, kayıt sırasında
 * verilen bilgilerle sunucuda tamamlanır ve kullanıcı doğrudan akışa girer.
 *
 * Bilgiler eksikse (örneğin sosyal girişte kullanıcı adı yoksa) ya da seçilen
 * kullanıcı adı bu arada başkası tarafından alınmışsa `/complete-profile`
 * ekranına düşülür; o ekran bilinen alanları önceden doldurur.
 */
export async function finishSignUpFromMetadata(): Promise<SignUpDestination> {
  const [metadata, profileResult] = await Promise.all([getSignUpMetadata(), fetchMyProfile()]);

  if (profileResult.ok && profileResult.data?.onboarding_completed) {
    return '/feed';
  }

  const { username, firstName, lastName } = metadata;
  if (!username || !firstName || !lastName) {
    return '/complete-profile';
  }

  // Profil zaten bu kullanıcı adını taşıyorsa (ör. doğrulama ekranı yeniden
  // açıldı) tekrar uygunluk kontrolü yapmak yanlış "alınmış" sonucu üretir.
  // Ağ hatasında kararı `complete_registration` verir.
  const currentUsername = profileResult.ok ? (profileResult.data?.username ?? null) : null;
  if (currentUsername !== username) {
    const availability = await fetchUsernameAvailability(username);
    if (availability.ok && !availability.data) {
      return '/complete-profile';
    }
  }

  const completed = await completeRegistration({ username, firstName, lastName });
  if (!completed.ok) {
    return '/complete-profile';
  }

  const pending = await fetchPendingAcceptances();
  if (pending.ok && pending.data.length > 0) {
    return '/legal/consent';
  }
  return '/feed';
}
