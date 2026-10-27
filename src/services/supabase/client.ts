import { createClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';

import { env } from '@/config/env';
import { secureStorage } from '@/services/storage/secure-storage';

export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    storage: secureStorage,
    storageKey: 'trabzone.auth.session',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  global: {
    headers: {
      'x-application-name': 'trabzone-mobile',
    },
  },
});

let appStateSubscription: { remove: () => void } | null = null;

/**
 * Supabase refresh timers must pause while the app is backgrounded, otherwise
 * iOS throttles them and the session silently expires.
 */
export function startAutoRefresh(): () => void {
  const handleAppState = (state: AppStateStatus) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  };

  if (AppState.currentState === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
  appStateSubscription = AppState.addEventListener('change', handleAppState);

  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
  };
}
