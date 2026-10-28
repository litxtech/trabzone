import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  notificationQueryKeys,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
} from '../services/notifications-service';
import { supabase } from '@/services/supabase/client';
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

/** Yeni bildirim geldiginde sayaci ve listeyi tazeler. */
export function useNotificationRealtime() {
  const session = useSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }

    const channel = supabase
      .channel(`notifications:${session.user.id}`)
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
