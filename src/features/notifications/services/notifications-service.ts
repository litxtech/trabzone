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
  | 'mention'
  | 'earthquake'
  | 'sports'
  | 'ride'
  | 'pharmacy';

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
  prefs: ['notifications', 'prefs'] as const,
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

/** `ids` verilmezse kullanıcının tüm bildirimleri silinir. */
export async function deleteNotifications(ids?: string[]): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('notifications_delete', {
    p_ids: ids && ids.length > 0 ? ids : null,
  });

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

export type NotificationPrefs = {
  saved: boolean;
  push_enabled: boolean;
  sound_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_start_hour: number;
  quiet_end_hour: number;
  likes: boolean;
  comments: boolean;
  follows: boolean;
  messages: boolean;
  orders: boolean;
  support: boolean;
  devices: {
    platform: string | null;
    app_version: string | null;
    os_version: string | null;
    last_seen_at: string | null;
  }[];
};

export type NotificationPrefsInput = Omit<NotificationPrefs, 'saved' | 'devices'>;

/** Uygulama içi + push tercihleri tek çağrıda (sunucu varsayılanlarıyla). */
export async function fetchNotificationPrefs(): Promise<Result<NotificationPrefs>> {
  const { data, error } = await supabase.rpc('notification_prefs_get');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as NotificationPrefs);
}

export async function saveNotificationPrefs(input: NotificationPrefsInput): Promise<Result<NotificationPrefs>> {
  const { data, error } = await supabase.rpc('notification_prefs_set', { p_payload: input });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as NotificationPrefs);
}

export type PushTestResult = { ok: boolean; reason?: 'no_device' | string; devices?: number };

export type PushTestKind = 'system' | 'pharmacy';

/**
 * Test bildirimi kuyruğa girer; push-dispatch bir sonraki turda gönderir.
 * `pharmacy` nöbetçi eczane bildirimiyle aynı kanalı/başlığı kullanır, böylece
 * arka plan teslimatı gerçek duyuruyla birebir doğrulanır.
 */
export async function sendPushTest(kind: PushTestKind = 'system'): Promise<Result<PushTestResult>> {
  const { data, error } = await supabase.rpc('notification_push_test', { p_kind: kind });
  if (error) {
    return fail(rpcError(error));
  }
  return ok((data ?? { ok: false }) as PushTestResult);
}
