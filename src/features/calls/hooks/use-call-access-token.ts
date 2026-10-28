import { useQuery } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import { fetchCallAccessToken } from '../services/call-token-service';

/**
 * Yalnızca arama kabul edildikten sonra anahtar istenir: halka çalarken
 * katılım anahtarı almak gereksizdir ve reddedilen aramada oda açılmaz.
 */
export function useCallAccessToken(callId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['chat', 'call-token', callId ?? 'none'],
    queryFn: () => unwrap(fetchCallAccessToken(callId as string)),
    enabled: Boolean(callId) && enabled,
    // Anahtarın ömrü 4 saat; ekran açık kaldıkça yeniden istek atılmaz.
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
