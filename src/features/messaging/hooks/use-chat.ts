import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
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
  fetchMessage,
  fetchMessages,
  leaveConversation,
  markConversationRead,
  markMessagesDelivered,
  removeGroupMember,
  respondCall,
  sendMessage,
  setConversationMuted,
  setConversationPinned,
  startCall,
  startDirectConversation,
  updateGroup,
  type ChatMessage,
  type CallSession,
  type Conversation,
  type MessageKind,
  type MessageMediaInput,
} from '../services/messaging-service';
import { supabase } from '@/services/supabase/client';
import { useSession } from '@/stores/auth-store';
import { unwrap } from '@/utils/result';
import { removeMedia } from '@/features/media/media-service';

type MessagePages = InfiniteData<ChatMessage[], string | null>;

/** Eski sayfalar once gelecek sekilde duz liste. */
export function flattenMessages(data: InfiniteData<ChatMessage[], unknown> | undefined): ChatMessage[] {
  if (!data) {
    return [];
  }
  return [...data.pages].reverse().flat();
}

function upsertMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  message: ChatMessage,
) {
  queryClient.setQueryData<MessagePages>(chatQueryKeys.messages(conversationId), (data) => {
    if (!data) {
      return {
        pages: [[message]],
        pageParams: [null],
      };
    }
    let replaced = false;
    const pages = data.pages.map((page) =>
      page.map((item) => {
        if (
          item.id === message.id ||
          (message.client_id && item.client_id === message.client_id)
        ) {
          replaced = true;
          return message;
        }
        return item;
      }),
    );
    if (!replaced) {
      const lastIndex = pages.length - 1;
      pages[lastIndex] = [...(pages[lastIndex] ?? []), message];
    }
    return { ...data, pages };
  });
}

function patchMessageById(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  messageId: string,
  message: ChatMessage,
) {
  let found = false;
  queryClient.setQueryData<MessagePages>(chatQueryKeys.messages(conversationId), (data) => {
    if (!data) {
      return data;
    }
    return {
      ...data,
      pages: data.pages.map((page) =>
        page.map((item) => {
          if (item.id === messageId) {
            found = true;
            return message;
          }
          return item;
        }),
      ),
    };
  });
  return found;
}

function buildReplyPreview(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  replyToId: string | null,
): ChatMessage['reply_preview'] {
  if (!replyToId) {
    return null;
  }
  const data = queryClient.getQueryData<MessagePages>(chatQueryKeys.messages(conversationId));
  const items = flattenMessages(data);
  const target = items.find((item) => item.id === replyToId);
  if (!target) {
    return null;
  }
  return {
    id: target.id,
    body: target.body,
    kind: target.kind,
    sender_username: target.sender_username,
    sender_first_name: target.sender_first_name,
    deleted_at: target.deleted_at,
    has_media: target.media.length > 0 || Boolean(target.media_path),
  };
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

export type SendMessageInput = {
  kind?: MessageKind;
  body?: string | null;
  mediaPath?: string | null;
  mediaMeta?: Record<string, unknown>;
  replyToId?: string | null;
  media?: MessageMediaInput[];
  clientId?: string | null;
  /** Yeniden denemede mevcut iyimser satırı hedeflemek için. */
  tempId?: string;
};

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();
  const session = useSession();

  const mutation = useMutation({
    mutationFn: (input: SendMessageInput) =>
      unwrap(
        sendMessage({
          conversationId,
          kind: input.kind,
          body: input.body,
          mediaPath: input.mediaPath,
          mediaMeta: input.mediaMeta,
          replyToId: input.replyToId,
          media: input.media,
          clientId: input.clientId,
        }),
      ),
    onMutate: async (input) => {
      const me = session?.user;
      const clientId = input.clientId ?? Crypto.randomUUID();
      const tempId = input.tempId ?? `temp-${Crypto.randomUUID()}`;
      if (!me) {
        return { tempId, clientId };
      }

      const metadata = (me.user_metadata ?? {}) as {
        username?: string;
        first_name?: string;
        last_name?: string;
        avatar_path?: string;
      };
      const media = input.media ?? [];
      const kind =
        input.kind ??
        (media[0]?.media_type as MessageKind | undefined) ??
        (input.mediaPath ? 'image' : 'text');

      const optimistic: ChatMessage = {
        id: tempId,
        conversation_id: conversationId,
        sender_id: me.id,
        sender_username: metadata.username ?? 'sen',
        sender_first_name: metadata.first_name ?? null,
        sender_last_name: metadata.last_name ?? null,
        sender_avatar_path: metadata.avatar_path ?? null,
        kind,
        body: input.body ?? null,
        media_path: input.mediaPath ?? media[0]?.storage_path ?? null,
        media_meta: input.mediaMeta ?? null,
        media: media.map((item, index) => ({
          id: `${tempId}-media-${index}`,
          media_type: item.media_type,
          storage_path: item.storage_path,
          thumbnail_path: item.thumbnail_path ?? null,
          width: item.width ?? null,
          height: item.height ?? null,
          duration_ms: item.duration_ms ?? null,
          sort_order: index,
        })),
        reply_to_id: input.replyToId ?? null,
        reply_preview: buildReplyPreview(queryClient, conversationId, input.replyToId ?? null),
        edited_at: null,
        deleted_at: null,
        created_at: new Date().toISOString(),
        client_id: clientId,
        is_mine: true,
        delivery_status: 'sending',
      };

      queryClient.setQueryData<MessagePages>(chatQueryKeys.messages(conversationId), (data) => {
        if (input.tempId) {
          return data
            ? {
                ...data,
                pages: data.pages.map((page) =>
                  page.map((message) =>
                    message.id === input.tempId
                      ? { ...optimistic, id: input.tempId, delivery_status: 'sending' }
                      : message,
                  ),
                ),
              }
            : data;
        }
        if (!data) {
          return { pages: [[optimistic]], pageParams: [null] };
        }
        const pages = [...data.pages];
        const last = pages[pages.length - 1] ?? [];
        pages[pages.length - 1] = [...last, optimistic];
        return { ...data, pages };
      });

      return { tempId, clientId };
    },
    onError: (_error, _input, context) => {
      if (!context?.tempId) {
        return;
      }
      queryClient.setQueryData<MessagePages>(chatQueryKeys.messages(conversationId), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) =>
                page.map((message) =>
                  message.id === context.tempId
                    ? { ...message, delivery_status: 'failed' }
                    : message,
                ),
              ),
            }
          : data,
      );
    },
    onSuccess: (message, _input, context) => {
      if (context?.tempId) {
        queryClient.setQueryData<MessagePages>(chatQueryKeys.messages(conversationId), (data) => {
          if (!data) {
            return { pages: [[message]], pageParams: [null] };
          }
          return {
            ...data,
            pages: data.pages.map((page) =>
              page.map((item) =>
                item.id === context.tempId ||
                (message.client_id && item.client_id === message.client_id)
                  ? message
                  : item,
              ),
            ),
          };
        });
      } else {
        upsertMessage(queryClient, conversationId, message);
      }
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });

  const retryMessage = useCallback(
    (message: ChatMessage) => {
      mutation.mutate({
        kind: message.kind,
        body: message.body,
        mediaPath: message.media_path,
        mediaMeta: message.media_meta ?? {},
        replyToId: message.reply_to_id,
        media: message.media.map((item) => ({
          media_type: item.media_type,
          storage_path: item.storage_path,
          thumbnail_path: item.thumbnail_path,
          width: item.width,
          height: item.height,
          duration_ms: item.duration_ms,
        })),
        clientId: message.client_id ?? Crypto.randomUUID(),
        tempId: message.id,
      });
    },
    [mutation],
  );

  return { ...mutation, retryMessage };
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
    onSuccess: (paths, messageId) => {
      patchMessage(queryClient, conversationId, messageId, (message) => ({
        ...message,
        body: null,
        media_path: null,
        media_meta: null,
        media: [],
        kind: 'text',
        deleted_at: new Date().toISOString(),
      }));
      if (paths.length > 0) {
        void removeMedia('message-media', paths);
      }
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    },
  });
}

/**
 * Sohbet açıldığında ve yeni mesaj geldiğinde çalışır. Teslim damgası
 * `message_receipts` tablosuna yazılır; gönderen taraf gerçek zamanlı olarak
 * "İletildi" tikini görür.
 */
export function useMarkMessagesDelivered(conversationId: string | null) {
  return useMutation({
    mutationFn: () => unwrap(markMessagesDelivered(conversationId as string)),
    retry: 0,
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

export function usePinConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { conversationId: string; pinned: boolean }) =>
      unwrap(setConversationPinned(input.conversationId, input.pinned)),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: chatQueryKeys.list });
      const previous = queryClient.getQueryData<Conversation[]>(chatQueryKeys.list);
      queryClient.setQueryData<Conversation[]>(chatQueryKeys.list, (data) =>
        data?.map((conversation) =>
          conversation.id === input.conversationId
            ? { ...conversation, is_pinned: input.pinned }
            : conversation,
        ),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(chatQueryKeys.list, context.previous);
      }
    },
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

/** Açık sohbete düşen mesaj, teslim ve okundu olaylarını dar kapsamda yamalar. */
export function useConversationRealtime(conversationId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const syncMessage = async (messageId: unknown) => {
      if (typeof messageId !== 'string') {
        return;
      }
      const result = await fetchMessage(messageId);
      if (!result.ok) {
        return;
      }
      const found = patchMessageById(
        queryClient,
        conversationId,
        result.data.id,
        result.data,
      );
      if (!found) {
        upsertMessage(queryClient, conversationId, result.data);
      }
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.list });
    };

    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string };
          void syncMessage(row.id);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string };
          void syncMessage(row.id);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_receipts' },
        (payload) => {
          const row = payload.new as { message_id?: string };
          void syncMessage(row.message_id);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_media' },
        (payload) => {
          const row = payload.new as { message_id?: string };
          void syncMessage(row.message_id);
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
