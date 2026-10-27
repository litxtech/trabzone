import { useQuery } from '@tanstack/react-query';

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
