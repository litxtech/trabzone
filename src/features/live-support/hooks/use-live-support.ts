import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { Result } from '@/utils/result';

import * as live from '../services/live-support-service';
import type {
  AgentThreadList,
  LiveAttachment,
  LivePresence,
  LiveThread,
  LiveThreadSummary,
  StartedThread,
} from '../types';

export const liveKeys = {
  presence: ['live-support', 'presence'] as const,
  threads: ['live-support', 'threads'] as const,
  thread: (id: string) => ['live-support', 'thread', id] as const,
  agentThreads: (status: string | null) => ['live-support', 'agent', 'threads', status] as const,
};

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
};

export function useLivePresence(enabled = true) {
  return useQuery<LivePresence, Error>({
    queryKey: liveKeys.presence,
    queryFn: async () => unwrap(await live.fetchLivePresence()),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled,
  });
}

export function useMyLiveThreads(enabled = true) {
  return useQuery<LiveThreadSummary[], Error>({
    queryKey: liveKeys.threads,
    queryFn: async () => unwrap(await live.fetchMyLiveThreads()),
    staleTime: 15_000,
    enabled,
  });
}

export function useLiveThread(threadId: string | null | undefined) {
  return useQuery<LiveThread, Error>({
    queryKey: liveKeys.thread(threadId ?? 'none'),
    queryFn: async () => unwrap(await live.fetchLiveThread(threadId as string)),
    enabled: Boolean(threadId),
    refetchInterval: 20_000,
  });
}

export function useStartLiveThread() {
  const queryClient = useQueryClient();
  return useMutation<StartedThread, Error, { category: string; subject?: string | null }>({
    mutationFn: async (input) => unwrap(await live.startLiveThread(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: liveKeys.threads });
    },
  });
}

export function useSendLiveMessage() {
  const queryClient = useQueryClient();
  return useMutation<
    { id: string; author_role: 'user' | 'agent'; created_at: string },
    Error,
    { threadId: string; body: string; attachments?: LiveAttachment[] }
  >({
    mutationFn: async (input) => unwrap(await live.sendLiveMessage(input)),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: liveKeys.thread(variables.threadId) });
      void queryClient.invalidateQueries({ queryKey: liveKeys.threads });
      void queryClient.invalidateQueries({ queryKey: ['live-support', 'agent', 'threads'] });
    },
  });
}

export function useMarkLiveRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => unwrap(await live.markLiveThreadRead(threadId)),
    onSuccess: (_data, threadId) => {
      void queryClient.invalidateQueries({ queryKey: liveKeys.threads });
      void queryClient.invalidateQueries({ queryKey: liveKeys.thread(threadId) });
    },
  });
}

export function useCloseLiveThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { threadId: string; reason?: string | null }) =>
      unwrap(await live.closeLiveThread(input.threadId, input.reason)),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: liveKeys.thread(variables.threadId) });
      void queryClient.invalidateQueries({ queryKey: liveKeys.threads });
    },
  });
}

export function useReopenLiveThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => unwrap(await live.reopenLiveThread(threadId)),
    onSuccess: (_data, threadId) => {
      void queryClient.invalidateQueries({ queryKey: liveKeys.thread(threadId) });
      void queryClient.invalidateQueries({ queryKey: liveKeys.threads });
    },
  });
}

export function useAgentHeartbeat() {
  return useMutation({
    mutationFn: async (status: 'online' | 'away' | 'offline') =>
      unwrap(await live.agentHeartbeat(status)),
  });
}

export function useAgentThreads(status: string | null = null, enabled = true) {
  return useQuery<AgentThreadList, Error>({
    queryKey: liveKeys.agentThreads(status),
    queryFn: async () => unwrap(await live.fetchAgentThreads({ status })),
    staleTime: 10_000,
    refetchInterval: 30_000,
    enabled,
  });
}

export function useClaimAgentThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => unwrap(await live.claimAgentThread(threadId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['live-support', 'agent', 'threads'] });
      void queryClient.invalidateQueries({ queryKey: liveKeys.threads });
    },
  });
}

/** Açık görüşmede yeni mesajları gerçek zamanlı dinler. */
export function useLiveThreadRealtime(threadId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!threadId) {
      return;
    }
    return live.subscribeToLiveThread(threadId, () => {
      void queryClient.invalidateQueries({ queryKey: liveKeys.thread(threadId) });
      void queryClient.invalidateQueries({ queryKey: liveKeys.threads });
    });
  }, [queryClient, threadId]);
}

/** Danışman kuyruğunu gerçek zamanlı yeniler. */
export function useAgentQueueRealtime(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return live.subscribeToAgentQueue(() => {
      void queryClient.invalidateQueries({ queryKey: ['live-support', 'agent', 'threads'] });
    });
  }, [enabled, queryClient]);
}
