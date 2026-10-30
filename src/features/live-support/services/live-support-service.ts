import type { PostgrestError } from '@supabase/supabase-js';

import { appError, type AppError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { postgresChannel } from '@/services/supabase/realtime';
import { fail, ok, type Result } from '@/utils/result';

import type {
  AgentThreadList,
  LiveAttachment,
  LiveMessage,
  LivePresence,
  LiveThread,
  LiveThreadSummary,
  StartedThread,
} from '../types';

const LIVE_ERRORS: Record<string, AppError> = {
  not_authenticated: appError('session_missing'),
  insufficient_privilege: appError('forbidden'),
  not_found: appError('not_found', 'Görüşme bulunamadı.'),
  not_found_or_closed: appError('not_found', 'Görüşme bulunamadı veya kapatılmış.'),
  thread_closed: appError('ticket_closed', 'Bu görüşme kapatılmış. Yeni bir görüşme başlatabilirsin.'),
  invalid_body: appError('invalid_input', 'Mesajın en az 1 karakter olmalı.'),
  invalid_attachments: appError('invalid_input', 'En fazla 3 dosya ekleyebilirsin.'),
  invalid_category: appError('invalid_input'),
  invalid_status: appError('invalid_input'),
  rate_limited: appError('rate_limited'),
};

function mapError(error: PostgrestError | Error | null | undefined): AppError {
  if (!error) {
    return appError('unknown');
  }
  const raw = ('message' in error ? String(error.message ?? '') : '').trim();
  const known = LIVE_ERRORS[raw];
  if (known) {
    return known;
  }
  const code = 'code' in error ? String(error.code ?? '') : '';
  if (code === '42501' || code === 'PGRST301') {
    return appError('forbidden');
  }
  if (code === '42900') {
    return appError('rate_limited');
  }
  if (code === 'PGRST202' || code === '42883') {
    return appError('unknown', 'Sunucu güncel değil. Lütfen daha sonra tekrar dene.');
  }
  if (raw.includes('Failed to fetch') || raw.includes('Network request failed')) {
    return appError('network');
  }
  return appError('unknown');
}

async function callRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return fail(mapError(error));
  }
  return ok(data as unknown as T);
}

export const fetchLivePresence = () => callRpc<LivePresence>('support_live_presence');

export const startLiveThread = (input: { category: string; subject?: string | null }) =>
  callRpc<StartedThread>('support_live_start', {
    p_category: input.category,
    p_subject: input.subject ?? null,
  });

export const fetchMyLiveThreads = async (): Promise<Result<LiveThreadSummary[]>> => {
  const result = await callRpc<LiveThreadSummary[]>('support_live_list_my');
  return result.ok ? ok(result.data ?? []) : result;
};

export const fetchLiveThread = (threadId: string) =>
  callRpc<LiveThread>('support_live_get', { p_thread_id: threadId });

export const sendLiveMessage = (input: {
  threadId: string;
  body: string;
  attachments?: LiveAttachment[];
}) =>
  callRpc<{ id: string; author_role: 'user' | 'agent'; created_at: string }>('support_live_send', {
    p_thread_id: input.threadId,
    p_body: input.body,
    p_attachments: input.attachments ?? [],
  });

export const markLiveThreadRead = (threadId: string) =>
  callRpc<{ id: string; status: string }>('support_live_mark_read', { p_thread_id: threadId });

export const closeLiveThread = (threadId: string, reason?: string | null) =>
  callRpc<{ id: string; status: string }>('support_live_close', {
    p_thread_id: threadId,
    p_reason: reason ?? null,
  });

export const reopenLiveThread = (threadId: string) =>
  callRpc<{ id: string; status: string }>('support_live_reopen', { p_thread_id: threadId });

// -----------------------------------------------------------------------------
// Temsilci
// -----------------------------------------------------------------------------

export const agentHeartbeat = (status: 'online' | 'away' | 'offline') =>
  callRpc<{ status: string; last_seen_at: string }>('support_agent_heartbeat', {
    p_status: status,
  });

export const fetchAgentThreads = (input: {
  status?: string | null;
  limit?: number;
  offset?: number;
} = {}) =>
  callRpc<AgentThreadList>('support_agent_threads', {
    p_status: input.status ?? null,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });

export const claimAgentThread = (threadId: string) =>
  callRpc<{ id: string; assigned_to: string }>('support_agent_claim', {
    p_thread_id: threadId,
  });

export const markAgentMessagesRead = (threadId: string) =>
  callRpc<{ id: string; status: string }>('support_live_mark_read', { p_thread_id: threadId });

/** Canlı mesaj akışına abone olur; dönen fonksiyon aboneliği kaldırır. */
export function subscribeToLiveThread(
  threadId: string,
  onMessage: (message: LiveMessage) => void,
): () => void {
  const channel = postgresChannel(`support-live-${threadId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'support_live_messages',
        filter: `thread_id=eq.${threadId}`,
      },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        onMessage({
          id: String(row.id),
          author_id: (row.author_id as string | null) ?? null,
          author_role: (row.author_role as LiveMessage['author_role']) ?? 'user',
          body: String(row.body ?? ''),
          attachments: Array.isArray(row.attachments)
            ? (row.attachments as LiveAttachment[])
            : [],
          read_at: (row.read_at as string | null) ?? null,
          created_at: String(row.created_at ?? new Date().toISOString()),
        });
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Danışman panelinde tüm yeni mesajları dinler. */
export function subscribeToAgentQueue(onChange: () => void): () => void {
  const channel = postgresChannel('support-agent-queue')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'support_live_threads' },
      () => onChange(),
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'support_live_messages' },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
