import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { supabase } from '@/services/supabase/client';
import { unwrap } from '@/utils/result';

import {
  adminKeys,
  fetchAdminAlerts,
  readAdminAlerts,
  readAllAdminAlerts,
} from '../services/admin-alerts-service';
import type { AdminAlertFeed } from '../types';

const FEED_LIMIT = 20;

/**
 * Paneldeki tüm ekranlar aynı baloncuk akışını kullanır.
 *
 * - Realtime: `admin_alert_events` tablosuna düşen INSERT yalnızca yetkili
 *   personelin SELECT politikasına takıldığı için güvenli biçimde iletilir.
 * - Yedek: bağlantı kopsa bile 45 saniyelik sorgu ve pencere odağı yenilemesi
 *   baloncukların kaçmamasını sağlar.
 */
export function useAdminAlerts(enabled: boolean) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: adminKeys.alerts,
    queryFn: async () => unwrap(await fetchAdminAlerts(FEED_LIMIT)),
    enabled,
    staleTime: 10_000,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.alerts });
      void queryClient.invalidateQueries({ queryKey: adminKeys.shell });
    };

    const channel = supabase
      .channel('admin-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_alert_events' },
        refresh,
      )
      .subscribe((status) => {
        // Yeniden bağlanma sonrası kaçırılan kayıtları tek seferde yakala.
        if (status === 'SUBSCRIBED') {
          refresh();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);

  return query;
}

export function useAdminAlertActions() {
  const queryClient = useQueryClient();

  const removeFromFeed = (ids: string[]) => {
    const idSet = new Set(ids);
    queryClient.setQueryData<AdminAlertFeed>(adminKeys.alerts, (data) => {
      if (!data) {
        return data;
      }
      const items = data.items.filter((item) => !idSet.has(item.id));
      return { items, unread: Math.max(0, data.unread - (data.items.length - items.length)) };
    });
  };

  const markRead = useMutation({
    mutationFn: (ids: string[]) => unwrap(readAdminAlerts(ids)),
    onMutate: (ids) => removeFromFeed(ids),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.alerts });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.shell });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => unwrap(readAllAdminAlerts()),
    onMutate: () => {
      queryClient.setQueryData<AdminAlertFeed>(adminKeys.alerts, (data) =>
        data ? { items: [], unread: 0 } : data,
      );
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.alerts });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.shell });
    },
  });

  return { markRead, markAllRead };
}
