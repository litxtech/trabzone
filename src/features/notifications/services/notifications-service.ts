import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type NotificationKind =
  | 'follow'
  | 'like'
  | 'comment'
  | 'message'
  | 'group_invite'
  | 'order'
  | 'market_message'
  | 'support'
  | 'security'
  | 'system'
  | 'mention';

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  route: string | null;
  read_at: string | null;
  created_at: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_first_name: string | null;
  actor_last_name: string | null;
  actor_avatar_path: string | null;
};

export type NotificationPage = {
  items: AppNotification[];
  unread: number;
};

export const notificationQueryKeys = {
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
};

export async function fetchNotifications(limit = 30, offset = 0): Promise<Result<NotificationPage>> {
  const { data, error } = await supabase.rpc('notifications_list', {
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const page = (data ?? {}) as Partial<NotificationPage>;
  return ok({ items: page.items ?? [], unread: page.unread ?? 0 });
}

export async function fetchUnreadCount(): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('notifications_unread_count');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(typeof data === 'number' ? data : 0);
}

export async function markNotificationsRead(ids?: string[]): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('notifications_mark_read', {
    p_ids: ids && ids.length > 0 ? ids : null,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(typeof data === 'number' ? data : 0);
}
