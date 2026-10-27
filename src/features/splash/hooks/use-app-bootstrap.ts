import { useEffect, useState } from 'react';

import { startAutoRefresh } from '@/services/supabase/client';
import { useAuthStatus, useAuthStore } from '@/stores/auth-store';
import { useBrandFonts } from '@/theme/fonts';

/**
 * Restores everything the first frame depends on: brand fonts and the stored
 * Supabase session. Runs in parallel with the native splash screen.
 */
export function useAppBootstrap(): { ready: boolean } {
  const [fontsLoaded, fontError] = useBrandFonts();
  const status = useAuthStatus();
  const initialize = useAuthStore((state) => state.initialize);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    initialize()
      .catch(() => {
        // A failed session read is treated as "signed out" - the user can
        // always sign in again.
      })
      .finally(() => {
        if (!cancelled) {
          setSessionChecked(true);
        }
      });

    const stopAutoRefresh = startAutoRefresh();

    return () => {
      cancelled = true;
      stopAutoRefresh();
    };
  }, [initialize]);

  const fontsReady = fontsLoaded || Boolean(fontError);

  return { ready: fontsReady && (sessionChecked || status !== 'booting') };
}
