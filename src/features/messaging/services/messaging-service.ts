import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type ConversationKind = 'direct' | 'group';

export type Conversation = {
  id: string;
  kind: ConversationKind;
  title: string;
  avatar_path: string | null;
  peer_id: string | null;
  peer_username: string | null;
  peer_verified: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender_id: string | null;
  is_muted: boolean;
  is_pinned: boolean;
  unread_count: number;
};

export type ChatMember = {
  user_id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_path: string | null;
  is_verified: boolean;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
};

export type MessageKind = 'text' | 'image' | 'video' | 'audio' | 'file';

/** Giden mesajın istemci taraflı yaşam döngüsü (optimistic UI). */
export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type MessageMediaItem = {
  id: string;
  media_type: MessageKind;
  storage_path: string;
  thumbnail_path: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sort_order: number;
};

export type MessageMediaInput = {
  media_type: MessageKind;
  storage_path: string;
  thumbnail_path?: string | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  mime?: string | null;
  name?: string | null;
  size?: number | null;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_username: string;
  sender_first_name: string | null;
  sender_last_name: string | null;
  sender_avatar_path: string | null;
  kind: MessageKind;
  body: string | null;
  media_path: string | null;
  media_meta: Record<string, unknown> | null;
  media: MessageMediaItem[];
  reply_to_id: string | null;
  reply_preview: {
    id: string;
    body: string | null;
    kind: MessageKind;
    sender_username: string;
    sender_first_name?: string | null;
    deleted_at?: string | null;
    has_media?: boolean;
  } | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  client_id: string | null;
  is_mine: boolean;
  delivery_status: DeliveryStatus;
};

export type CallSession = {  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  kind: 'audio' | 'video';
  status: 'ringing' | 'accepted' | 'declined' | 'ended' | 'missed';
  room_name: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  is_caller: boolean;
  peer_id: string;
  peer_username: string;
  peer_first_name: string | null;
  peer_last_name: string | null;
  peer_avatar_path: string | null;
};

export const chatQueryKeys = {
  list: ['chat', 'list'] as const,
  messages: (conversationId: string) => ['chat', 'messages', conversationId] as const,
  members: (conversationId: string) => ['chat', 'members', conversationId] as const,
  call: (callId: string) => ['chat', 'call', callId] as const,
};

/** Eksik alanları güvenli varsayılanlarla doldurur (eski kayıt + yeni şema). */
function normalizeMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    media: Array.isArray(message.media) ? message.media : [],
    client_id: message.client_id ?? null,
    delivery_status: message.delivery_status ?? (message.is_mine ? 'sent' : 'read'),
    reply_preview: message.reply_preview ?? null,
  };
}

// -----------------------------------------------------------------------------
// Conversations
// -----------------------------------------------------------------------------

export async function fetchConversations(): Promise<Result<Conversation[]>> {
  const { data, error } = await supabase.rpc('chat_list');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: Conversation[] } | null)?.items ?? []) as Conversation[]);
}

export async function startDirectConversation(userId: string): Promise<Result<{ id: string }>> {
  const { data, error } = await supabase.rpc('chat_start_direct', { p_user_id: userId });
  if (error) {
    return fail(rpcError(error));
  }

  const id = (data as { id?: string } | null)?.id;
  return id ? ok({ id }) : fail(appError('unknown'));
}

/**
 * Iki kullanici arasinda dogrudan mesajlasmaya izin var mi?
 * Gizlilik ayarlari, engeller ve cocuk korumasi sunucuda degerlendirilir.
 */
export async function canMessageUser(
  senderId: string,
  recipientId: string,
): Promise<Result<boolean>> {
  const { data, error } = await supabase.rpc('safety_can_message', {
    p_sender: senderId,
    p_recipient: recipientId,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(Boolean(data));
}

export async function createGroupConversation(input: {
  title: string;
  memberIds: string[];
  avatarPath?: string | null;
}): Promise<Result<{ id: string }>> {
  const { data, error } = await supabase.rpc('chat_create_group', {
    p_title: input.title,
    p_member_ids: input.memberIds,
    p_avatar_path: input.avatarPath ?? null,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const id = (data as { id?: string } | null)?.id;
  return id ? ok({ id }) : fail(appError('unknown'));
}

export async function updateGroup(input: {
  conversationId: string;
  title?: string | null;
  avatarPath?: string | null;
}): Promise<Result<null>> {
  const { error } = await supabase.rpc('chat_update_group', {
    p_conversation_id: input.conversationId,
    p_title: input.title ?? null,
    p_avatar_path: input.avatarPath ?? null,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function addGroupMember(conversationId: string, userId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('chat_add_member', {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function removeGroupMember(
  conversationId: string,
  userId: string,
): Promise<Result<null>> {
  const { error } = await supabase.rpc('chat_remove_member', {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function leaveConversation(conversationId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('chat_leave', { p_conversation_id: conversationId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function setConversationMuted(
  conversationId: string,
  muted: boolean,
): Promise<Result<null>> {
  const { error } = await supabase.rpc('chat_set_mute', {
    p_conversation_id: conversationId,
    p_muted: muted,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function setConversationPinned(
  conversationId: string,
  pinned: boolean,
): Promise<Result<boolean>> {
  const { data, error } = await supabase.rpc('chat_set_pin', {
    p_conversation_id: conversationId,
    p_pinned: pinned,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(Boolean(data));
}

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

export async function fetchChatMembers(conversationId: string): Promise<Result<ChatMember[]>> {
  const { data, error } = await supabase.rpc('chat_members', {
    p_conversation_id: conversationId,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: ChatMember[] } | null)?.items ?? []) as ChatMember[]);
}

export async function fetchMessages(params: {
  conversationId: string;
  before?: string | null;
  limit?: number;
}): Promise<Result<ChatMessage[]>> {
  const { data, error } = await supabase.rpc('chat_messages', {
    p_conversation_id: params.conversationId,
    p_before: params.before ?? null,
    p_limit: params.limit ?? 30,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(
    (((data as { items?: ChatMessage[] } | null)?.items ?? []) as ChatMessage[]).map(
      normalizeMessage,
    ),
  );
}

export async function sendMessage(input: {
  conversationId: string;
  kind?: MessageKind;
  body?: string | null;
  mediaPath?: string | null;
  mediaMeta?: Record<string, unknown>;
  replyToId?: string | null;
  media?: MessageMediaInput[];
  clientId?: string | null;
}): Promise<Result<ChatMessage>> {
  const { data, error } = await supabase.rpc('chat_send_message', {
    p_conversation_id: input.conversationId,
    p_kind: input.kind ?? 'text',
    p_body: input.body ?? null,
    p_media_path: input.mediaPath ?? null,
    p_media_meta: input.mediaMeta ?? {},
    p_reply_to: input.replyToId ?? null,
    p_media: input.media ?? [],
    p_client_id: input.clientId ?? null,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(normalizeMessage(data as ChatMessage));
}

/** Realtime tek mesaj yaması için dar kapsamlı okuma (tüm sohbeti yeniden çekmez). */
export async function fetchMessage(messageId: string): Promise<Result<ChatMessage>> {
  const { data, error } = await supabase.rpc('chat_message_get', { p_message_id: messageId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(normalizeMessage(data as ChatMessage));
}

/** Mesaj karşı tarafa ulaştığında teslim damgası bırakır. */
export async function markMessagesDelivered(conversationId: string): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('chat_mark_delivered', {
    p_conversation_id: conversationId,
  });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(typeof data === 'number' ? data : 0);
}

export async function markConversationRead(conversationId: string): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('chat_mark_read', {
    p_conversation_id: conversationId,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(typeof data === 'number' ? data : 0);
}

export async function editMessage(messageId: string, body: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('chat_edit_message', {
    p_message_id: messageId,
    p_body: body,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function deleteMessage(messageId: string): Promise<Result<string[]>> {
  const { data, error } = await supabase.rpc('chat_delete_message', { p_message_id: messageId });
  if (error) {
    return fail(rpcError(error));
  }
  const paths = ((data as { media_paths?: unknown } | null)?.media_paths ?? []) as unknown[];
  return ok(paths.filter((path): path is string => typeof path === 'string'));
}

// -----------------------------------------------------------------------------
// Calls (signalling; media transport is LiveKit)
// -----------------------------------------------------------------------------

export async function startCall(
  conversationId: string,
  kind: 'audio' | 'video',
): Promise<Result<{ id: string; room_name: string; status: string }>> {
  const { data, error } = await supabase.rpc('call_start', {
    p_conversation_id: conversationId,
    p_kind: kind,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as { id: string; room_name: string; status: string });
}

export async function fetchCall(callId: string): Promise<Result<CallSession>> {
  const { data, error } = await supabase.rpc('call_get', { p_call_id: callId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as CallSession);
}

export async function respondCall(
  callId: string,
  accept: boolean,
): Promise<Result<{ id: string; status: CallSession['status'] }>> {
  const { data, error } = await supabase.rpc('call_respond', {
    p_call_id: callId,
    p_accept: accept,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as { id: string; status: CallSession['status'] });
}

export async function endCall(callId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('call_end', { p_call_id: callId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}
