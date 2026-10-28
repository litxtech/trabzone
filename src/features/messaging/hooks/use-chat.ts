import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addGroupMember,
  canMessageUser,
  chatQueryKeys,
  createGroupConversation,
  deleteMessage,
  editMessage,
  endCall,
  fetchCall,
  fetchChatMembers,
  fetchConversations,
  fetchMessages,
  leaveConversation,
  markConversationRead,
  removeGroupMember,
  respondCall,
  sendMessage,
  setConversationMuted,
  startCall,
  startDirectConversation,
  updateGroup,
  type ChatMessage,
  type CallSession,
  type Conversation,
  type MessageKind,
} from '../services/messaging-service';
import { supabase } from '@/services/supabase/client';
import { useSession } from '@/stores/auth-store';
import { unwrap } from '@/utils/result';

type MessagePages = InfiniteData<ChatMessage[], string | null>;

/** Eski sayfalar once gelecek sekilde duz liste. */
export function flattenMessages(data: InfiniteData<ChatMessage[], unknown> | undefined): ChatMessage[] {
  if (!data) {
    return [];
  }
  return [...data.pages].reverse().flat();
}

export function useConversations() {
  return useQuery({
    queryKey: chatQueryKeys.list,
    queryFn: () => unwrap(fetchConversations()),
    staleTime: 15_000,
  });
}

/**
 * Ust basliktaki mesaj rozeti icin tek sayi. Ayni `chatQueryKeys.list`
 * sorgusunu paylasir; mesaj ekrani acikken ekstra istek olusmaz.
 */
export function useUnreadMessageCount(): number {
  const session = useSession();
  const { data } = useQuery({
    queryKey: chatQueryKeys.list,
    queryFn: () => unwrap(fetchConversations()),
    staleTime: 20_000,
    refetchInterval: 30_000,
    enabled: Boolean(session),
    select: (items: Conversation[]) => items.reduce((total, item) => total + item.unread_count, 0),
  });
  return data ?? 0;
}

export function useChatMembers(conversationId: string | null) {
  return useQuery({
    queryKey: chatQueryKeys.members(conversationId ?? 'none'),
    queryFn: () => unwrap(fetchChatMembers(conversationId as string)),
    enabled: Boolean(conversationId),
    staleTime: 60_000,
  });
}

export function useMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: chatQueryKeys.messages(conversationId ?? 'none'),
    queryFn: ({ pageParam }) =>
      unwrap(fetchMessages({ conversationId: conversationId as string, before: pageParam })),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length === 30 ? (lastPage[0]?.created_at ?? undefined) : undefined,
    enabled: Boolean(conversationId),
    staleTime: 5_000,
  });
}

function appendMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  message: ChatMessage,
) {
  queryClient.setQueryData<MessagePages>(chatQueryKeys.messages(conversationId), (data) => {
    if (!data) {
      return { pages: [[message]], pageParams: [null] };
    }
    const pages = [...data.pages];
    const last = pages[pages.length - 1] ?? [];
    if (last.some((item) => item.id === message.id)) {
      return data;
    }
    pages[pages.length - 1] = [...last, message];
    return { ...data, pages };
  });
}

function patchMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  messageId: string,
  fn: (message: ChatMessage) => ChatMessage,
) {
  queryClient.setQueryData<MessagePages>(chatQueryKeys.messages(conversationId), (data) => {
    if (!data) {
      return data;
    }
    return {
      ...data,
      pages: data.pages.map((page) =>
        page.map((message) => (message.id === messageId ? fn(message) : message)),
      ),
    };
  });
}

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      kind?: MessageKind;
      body?: string | null;
      mediaPath?: string | null;
      mediaMeta?: Record<string, unknown>;
      replyToId?: string | null;
    }) => unwrap(sendMessage({ conversationId, ...input })),
    onSuccess: (message) => {
      appendMessage(queryClient, conversationId, message);
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });
}

export function useEditMessage(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { messageId: string; body: string }) =>
      unwrap(editMessage(input.messageId, input.body)),
    onSuccess: (_data, input) => {
      patchMessage(queryClient, conversationId, input.messageId, (message) => ({
        ...message,
        body: input.body,
        edited_at: new Date().toISOString(),
      }));
    },
  });
}

export function useDeleteMessage(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) => unwrap(deleteMessage(messageId)),
    onSuccess: (_data, messageId) => {
      patchMessage(queryClient, conversationId, messageId, (message) => ({
        ...message,
        body: null,
        media_path: null,
        media_meta: null,
        deleted_at: new Date().toISOString(),
      }));
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });
}

export function useMarkConversationRead(conversationId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => unwrap(markConversationRead(conversationId as string)),
    onSuccess: () => {
      queryClient.setQueryData<Conversation[]>(chatQueryKeys.list, (data) =>
        data?.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, unread_count: 0 } : conversation,
        ),
      );
    },
  });
}

export function useStartDirectConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => unwrap(startDirectConversation(userId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });
}

/**
 * Profil ekraninda "Mesaj gonder" butonunu kilitlemek icin kullanilir.
 * Karar sunucuda verilir (gizlilik ayari, engel, cocuk korumasi).
 */
export function useCanMessage(userId: string | null) {
  const session = useSession();
  const me = session?.user?.id ?? null;

  return useQuery({
    queryKey: ['chat', 'can-message', me ?? 'none', userId ?? 'none'] as const,
    queryFn: () => unwrap(canMessageUser(me as string, userId as string)),
    enabled: Boolean(me && userId && me !== userId),
    staleTime: 60_000,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { title: string; memberIds: string[] }) =>
      unwrap(createGroupConversation(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });
}

export function useUpdateGroup(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { title?: string | null }) =>
      unwrap(updateGroup({ conversationId, ...input })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });
}

export function useAddGroupMember(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => unwrap(addGroupMember(conversationId, userId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.members(conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });
}

export function useRemoveGroupMember(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => unwrap(removeGroupMember(conversationId, userId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.members(conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });
}

export function useLeaveConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId: string) => unwrap(leaveConversation(conversationId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });
}

export function useMuteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { conversationId: string; muted: boolean }) =>
      unwrap(setConversationMuted(input.conversationId, input.muted)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });
}

// -----------------------------------------------------------------------------
// Realtime
// -----------------------------------------------------------------------------

/** Sohbet listesini canli tutar (yeni mesaj, okundu, guncellenen sohbet). */
export function useConversationListRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('chat-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

/** Acik sohbete dusen mesajlari canli olarak yansitir. */
export function useConversationRealtime(conversationId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: chatQueryKeys.messages(conversationId),
          });
          void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);
}

// -----------------------------------------------------------------------------
// Typing indicator (Supabase Realtime broadcast, no persistence needed)
// -----------------------------------------------------------------------------

export function useTypingIndicator(
  conversationId: string | null,
  userId: string | null,
  shouldNotify: boolean,
) {
  const session = useSession();
  const [typingLabel, setTypingLabel] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef(0);

  const displayName = useMemo(() => {
    const metadata = (session?.user.user_metadata ?? {}) as { first_name?: string };
    return metadata.first_name?.trim() || 'Bir kullanıcı';
  }, [session?.user.user_metadata]);

  useEffect(() => {
    if (!conversationId || !userId) {
      return;
    }

    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'typing' }, (payload) => {
        const name = (payload.payload as { name?: string } | undefined)?.name;
        if (!name) {
          return;
        }
        setTypingLabel(name);
        if (clearTimer.current) {
          clearTimeout(clearTimer.current);
        }
        clearTimer.current = setTimeout(() => setTypingLabel(null), 3200);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (clearTimer.current) {
        clearTimeout(clearTimer.current);
      }
      channelRef.current = null;
      setTypingLabel(null);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, userId]);

  const notifyTyping = useCallback(() => {
    if (!shouldNotify || !channelRef.current) {
      return;
    }
    const now = Date.now();
    if (now - lastSent.current < 2200) {
      return;
    }
    lastSent.current = now;
    void channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { name: displayName },
    });
  }, [displayName, shouldNotify]);

  return { typingLabel, notifyTyping };
}

// -----------------------------------------------------------------------------
// Calls
// -----------------------------------------------------------------------------

export function useCall(callId: string | null) {
  return useQuery({
    queryKey: chatQueryKeys.call(callId ?? 'none'),
    queryFn: () => unwrap(fetchCall(callId as string)),
    enabled: Boolean(callId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'ringing' ? 2500 : false;
    },
  });
}

export function useCallRealtime(callId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!callId) {
      return;
    }

    const channel = supabase
      .channel(`call:${callId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'call_sessions', filter: `id=eq.${callId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: chatQueryKeys.call(callId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [callId, queryClient]);
}

export function useStartCall() {
  return useMutation({
    mutationFn: (input: { conversationId: string; kind: 'audio' | 'video' }) =>
      unwrap(startCall(input.conversationId, input.kind)),
  });
}

export function useRespondCall(callId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accept: boolean) => unwrap(respondCall(callId, accept)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.call(callId) });
    },
  });
}

export function useEndCall(callId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => unwrap(endCall(callId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.call(callId) });
    },
  });
}

export type { CallSession, ChatMessage, Conversation };
