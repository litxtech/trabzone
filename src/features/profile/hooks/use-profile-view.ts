import { useQuery } from '@tanstack/react-query';

import { fetchConnections, fetchProfileView, type ConnectionKind } from '../services/social-service';

export const profileViewKeys = {
  view: (username: string) => ['profile-view', username.toLowerCase()] as const,
  connections: (userId: string, kind: ConnectionKind) =>
    ['profile-connections', userId, kind] as const,
};

export function useProfileView(username: string) {
  return useQuery({
    queryKey: profileViewKeys.view(username),
    queryFn: async () => {
      const result = await fetchProfileView(username);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    enabled: username.trim().length > 0,
    staleTime: 20_000,
  });
}

export function useConnections(userId: string | null, kind: ConnectionKind, enabled = true) {
  return useQuery({
    queryKey: profileViewKeys.connections(userId ?? 'none', kind),
    queryFn: async () => {
      if (!userId) {
        return [];
      }
      const result = await fetchConnections(userId, kind);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    enabled: enabled && Boolean(userId),
    staleTime: 30_000,
  });
}
