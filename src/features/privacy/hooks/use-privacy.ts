import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Result } from '@/utils/result';

import * as privacy from '../services/privacy-service';
import type {
  AdminPrivacyRequestList,
  PrivacyRequestDetail,
  PrivacyRequestSummary,
  PrivacyRequestType,
} from '../types';

export const privacyKeys = {
  mine: ['privacy', 'requests'] as const,
  detail: (id: string) => ['privacy', 'request', id] as const,
  admin: (status: string | null) => ['privacy', 'admin', 'requests', status] as const,
};

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
};

export function useMyPrivacyRequests(enabled = true) {
  return useQuery<PrivacyRequestSummary[], Error>({
    queryKey: privacyKeys.mine,
    queryFn: async () => unwrap(await privacy.fetchMyPrivacyRequests()),
    staleTime: 30_000,
    enabled,
  });
}

export function usePrivacyRequest(id: string | null | undefined) {
  return useQuery<PrivacyRequestDetail, Error>({
    queryKey: privacyKeys.detail(id ?? 'none'),
    queryFn: async () => unwrap(await privacy.fetchPrivacyRequest(id as string)),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useCreatePrivacyRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      requestType: PrivacyRequestType;
      subject: string;
      details: string;
    }) => unwrap(await privacy.createPrivacyRequest(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: privacyKeys.mine });
    },
  });
}

export function useCancelPrivacyRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await privacy.cancelPrivacyRequest(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: privacyKeys.mine });
    },
  });
}

export function useAdminPrivacyRequests(status: string | null = null, enabled = true) {
  return useQuery<AdminPrivacyRequestList, Error>({
    queryKey: privacyKeys.admin(status),
    queryFn: async () => unwrap(await privacy.adminFetchPrivacyRequests({ status })),
    staleTime: 15_000,
    enabled,
  });
}

export function useAdminUpdatePrivacyRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: string;
      note?: string | null;
      response?: string | null;
    }) => unwrap(await privacy.adminUpdatePrivacyRequest(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['privacy', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: privacyKeys.mine });
    },
  });
}
