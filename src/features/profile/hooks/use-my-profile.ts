import { useQuery } from '@tanstack/react-query';

import { rememberAccountFromProfile } from '@/features/auth/saved-accounts';
import { useAuthStore } from '@/stores/auth-store';

import { fetchMyProfile, fetchMyRoles, type Profile } from '../services/profile-service';

export const profileQueryKeys = {
  me: ['my-profile'] as const,
  roles: ['my-roles'] as const,
};

export function useMyProfile() {
  return useQuery<Profile | null>({
    queryKey: profileQueryKeys.me,
    queryFn: async () => {
      const result = await fetchMyProfile();
      if (!result.ok) {
        throw result.error;
      }
      // Giriş ekranındaki hesap seçici avatarı buradan öğrenir; ek istek yok.
      rememberAccountFromProfile(result.data, useAuthStore.getState().session?.user.email);
      return result.data;
    },
    staleTime: 30_000,
  });
}

export function useMyRoles() {
  return useQuery<string[]>({
    queryKey: profileQueryKeys.roles,
    queryFn: fetchMyRoles,
    staleTime: 5 * 60_000,
  });
}
