import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchFollowingIds,
  fetchSuggestedProfiles,
  followUser,
  unfollowUser,
  type DirectoryProfile,
} from '../services/social-service';

export const socialQueryKeys = {
  suggested: ['social', 'suggested'] as const,
  following: ['social', 'following'] as const,
};

export function useSuggestedProfiles(limit = 8) {
  return useQuery<DirectoryProfile[]>({
    queryKey: [...socialQueryKeys.suggested, limit],
    queryFn: async () => {
      const result = await fetchSuggestedProfiles(limit);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    staleTime: 60_000,
  });
}

export function useFollowingIds() {
  return useQuery<string[]>({
    queryKey: socialQueryKeys.following,
    queryFn: fetchFollowingIds,
    staleTime: 60_000,
  });
}

type ToggleInput = { userId: string; follow: boolean };

export function useToggleFollow() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ToggleInput, { previous: string[] }>({
    mutationFn: async ({ userId, follow }) => {
      const result = follow ? await followUser(userId) : await unfollowUser(userId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onMutate: async ({ userId, follow }) => {
      await queryClient.cancelQueries({ queryKey: socialQueryKeys.following });
      const previous = queryClient.getQueryData<string[]>(socialQueryKeys.following) ?? [];
      const next = follow
        ? previous.includes(userId)
          ? previous
          : [...previous, userId]
        : previous.filter((id) => id !== userId);

      queryClient.setQueryData<string[]>(socialQueryKeys.following, next);
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData<string[]>(socialQueryKeys.following, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: socialQueryKeys.following });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['profile-view'] });
      void queryClient.invalidateQueries({ queryKey: ['profile-connections'] });
    },
  });
}
