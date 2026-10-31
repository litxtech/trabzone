import type { QueryClient } from '@tanstack/react-query';

import { fetchPendingAcceptances } from '@/features/legal/services/legal-service';
import type { PendingAcceptance } from '@/features/legal/types';
import { profileQueryKeys } from '@/features/profile/hooks/use-my-profile';
import { fetchMyProfile, fetchMyRoles, type Profile } from '@/features/profile/services/profile-service';
import type { Result } from '@/utils/result';

export type PostLoginData = {
  profile: Result<Profile | null>;
  pending: Result<PendingAcceptance[]>;
};

/**
 * Giriş sonrası gereken verileri tek turda toplar.
 *
 * Üç istek paralel gider (toplam süre tek gidiş-dönüş kadar), sonuçlar
 * react-query önbelleğine yazılır: yönlendirilen ekran (feed, menü, sekme
 * çubuğu) aynı verileri yeniden istemez. Profil ve roller daha önce sırayla
 * çekildiği için giriş sonrası ekran geçişi gereksiz yere bekliyordu.
 */
export async function prefetchPostLoginData(queryClient: QueryClient): Promise<PostLoginData> {
  const [profile, pending, roles] = await Promise.all([
    fetchMyProfile(),
    fetchPendingAcceptances(),
    fetchMyRoles(),
  ]);

  if (profile.ok && profile.data) {
    queryClient.setQueryData(profileQueryKeys.me, profile.data);
  }
  queryClient.setQueryData(profileQueryKeys.roles, roles);

  return { profile, pending };
}
