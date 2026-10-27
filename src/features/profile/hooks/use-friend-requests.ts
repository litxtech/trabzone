import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelFriendRequest,
  fetchFriendRequests,
  respondFriendRequest,
  sendFriendRequest,
  type FriendRequestItem,
} from '../services/social-service';

export const friendRequestKeys = {
  list: ['friend-requests'] as const,
};

export function useFriendRequests() {
  return useQuery<FriendRequestItem[]>({
    queryKey: friendRequestKeys.list,
    queryFn: async () => {
      const result = await fetchFriendRequests();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    staleTime: 30_000,
  });
}

/** Drawer/settings rozetleri icin: yalnizca gelen bekleyen istek sayisi. */
export function useIncomingFriendRequestCount() {
  const { data } = useFriendRequests();
  return data?.filter((item) => item.direction === 'in').length ?? 0;
}

function useInvalidateProfileQueries() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: friendRequestKeys.list });
    void queryClient.invalidateQueries({ queryKey: ['profile-view'] });
    void queryClient.invalidateQueries({ queryKey: ['profile-connections'] });
    void queryClient.invalidateQueries({ queryKey: ['social', 'following'] });
    void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
  };
}

export function useSendFriendRequest() {
  const invalidate = useInvalidateProfileQueries();
  return useMutation({
    mutationFn: async (input: { userId: string; message?: string }) => {
      const result = await sendFriendRequest(input.userId, input.message);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: invalidate,
  });
}

export function useRespondFriendRequest() {
  const invalidate = useInvalidateProfileQueries();
  return useMutation({
    mutationFn: async (input: { requestId: string; action: 'accepted' | 'rejected' }) => {
      const result = await respondFriendRequest(input.requestId, input.action);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: invalidate,
  });
}

export function useCancelFriendRequest() {
  const invalidate = useInvalidateProfileQueries();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const result = await cancelFriendRequest(requestId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: invalidate,
  });
}
