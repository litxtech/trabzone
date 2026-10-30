import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  deleteNotifications,
  notificationQueryKeys,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
  type NotificationPage,
} from '../services/notifications-service';
import { supabase } from '@/services/supabase/client';
import { postgresChannel } from '@/services/supabase/realtime';
import { useSession } from '@/stores/auth-store';
import { unwrap } from '@/utils/result';

export function useNotifications() {
  return useQuery({
    queryKey: notificationQueryKeys.list,
    queryFn: () => unwrap(fetchNotifications()),
    staleTime: 20_000,
  });
}

export function useUnreadNotifications() {
  const session = useSession();
  return useQuery({
    queryKey: notificationQueryKeys.unread,
    queryFn: () => unwrap(fetchUnreadCount()),
    enabled: Boolean(session?.user?.id),
    staleTime: 20_000,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids?: string[]) => unwrap(markNotificationsRead(ids)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread });
    },
  });
}

/** `ids` verilmezse tümü silinir; liste sunucu yanıtı beklenmeden güncellenir. */
export function useDeleteNotifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids?: string[]) => unwrap(deleteNotifications(ids)),
    onMutate: async (ids?: string[]) => {
      await queryClient.cancelQueries({ queryKey: notificationQueryKeys.list });
      const previous = queryClient.getQueryData<NotificationPage>(notificationQueryKeys.list);
      if (previous) {
        const removed = ids && ids.length > 0 ? new Set(ids) : null;
        const items = removed ? previous.items.filter((item) => !removed.has(item.id)) : [];
        const removedUnread = previous.items.filter(
          (item) => !item.read_at && (!removed || removed.has(item.id)),
        ).length;
        queryClient.setQueryData<NotificationPage>(notificationQueryKeys.list, {
          items,
          unread: Math.max(previous.unread - removedUnread, 0),
        });
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) {
        queryClient.setQueryData(notificationQueryKeys.list, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
      void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread });
    },
  });
}

/** Yeni bildirim geldiginde sayaci ve listeyi tazeler. */
export function useNotificationRealtime() {
  const session = useSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }

    const channel = postgresChannel(`notifications:${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread });
          void queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, session?.user?.id]);
}
