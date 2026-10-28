import { useMutation } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import {
  createDeletionRequest,
  fetchDeletionRequestStatus,
  type DeletionRequestReceipt,
  type DeletionRequestStatus,
} from '../services/deletion-request-service';

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
