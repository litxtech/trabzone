import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import {
  adminFetchDeletionRequests,
  adminUpdateDeletionRequest,
  createDeletionRequest,
  fetchDeletionRequestStatus,
  type AdminDeletionRequest,
  type DeletionRequestReceipt,
  type DeletionRequestStatus,
} from '../services/deletion-request-service';

export const deletionAdminKeys = {
  list: (status: string | null, search: string) =>
    ['deletion-requests', 'admin', status, search] as const,
};

export function useCreateDeletionRequest() {
  return useMutation<DeletionRequestReceipt, Error, { email: string; reason?: string | null }>({
    mutationFn: async (input) => unwrap(await createDeletionRequest(input)),
  });
}

export function useDeletionRequestStatus() {
  return useMutation<DeletionRequestStatus, Error, { requestNo: string; email: string }>({
    mutationFn: async (input) => unwrap(await fetchDeletionRequestStatus(input)),
  });
}

export function useAdminDeletionRequests(input: {
  status: string | null;
  search: string;
  enabled?: boolean;
}) {
  return useQuery<AdminDeletionRequest[], Error>({
    queryKey: deletionAdminKeys.list(input.status, input.search),
    queryFn: async () =>
      unwrap(
        await adminFetchDeletionRequests({ status: input.status, search: input.search }),
      ),
    staleTime: 20_000,
    enabled: input.enabled ?? true,
  });
}

export function useAdminUpdateDeletionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: 'received' | 'processing' | 'completed' | 'failed';
      note?: string | null;
      verifyIdentity?: boolean | null;
    }) => unwrap(await adminUpdateDeletionRequest(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deletion-requests', 'admin'] });
    },
  });
}
