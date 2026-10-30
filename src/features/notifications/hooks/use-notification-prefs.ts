import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchNotificationPrefs,
  notificationQueryKeys,
  saveNotificationPrefs,
  sendPushTest,
  type NotificationPrefs,
  type NotificationPrefsInput,
  type PushTestKind,
} from '../services/notifications-service';
import { useSession } from '@/stores/auth-store';
import { unwrap } from '@/utils/result';

export function useNotificationPrefs() {
  const session = useSession();
  return useQuery({
    queryKey: notificationQueryKeys.prefs,
    queryFn: () => unwrap(fetchNotificationPrefs()),
    enabled: Boolean(session?.user?.id),
    staleTime: 30_000,
  });
}

export function useSaveNotificationPrefs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NotificationPrefsInput) => unwrap(saveNotificationPrefs(input)),
    onSuccess: (prefs) => {
      queryClient.setQueryData<NotificationPrefs>(notificationQueryKeys.prefs, prefs);
    },
  });
}

export function useSendPushTest() {
  return useMutation({
    mutationFn: (kind?: PushTestKind) => unwrap(sendPushTest(kind)),
  });
}
