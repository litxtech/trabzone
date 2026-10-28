import { useQuery } from '@tanstack/react-query';

import { fetchBlockedUserIds } from '../services/social-service';

export const relationQueryKeys = {
  blocked: ['social', 'blocked'] as const,
};

export function useBlockedUserIds() {
  return useQuery<string[]>({
    queryKey: relationQueryKeys.blocked,
    queryFn: fetchBlockedUserIds,
    staleTime: 60_000,
  });
}
