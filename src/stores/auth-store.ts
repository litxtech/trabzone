import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { getCurrentSession, signOut as signOutRequest } from '@/services/supabase/auth';
import { supabase } from '@/services/supabase/client';

export type AuthStatus = 'booting' | 'authenticated' | 'unauthenticated';

type AuthState = {
  status: AuthStatus;
  session: Session | null;
  initialize: () => Promise<void>;
  signOut: () => Promise<void>;
};

let unsubscribe: (() => void) | null = null;

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'booting',
  session: null,

  initialize: async () => {
    const session = await getCurrentSession();
    set({ session, status: session ? 'authenticated' : 'unauthenticated' });

    if (unsubscribe) {
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      set({ session: nextSession, status: nextSession ? 'authenticated' : 'unauthenticated' });
    });
    unsubscribe = () => data.subscription.unsubscribe();
  },

  signOut: async () => {
    await signOutRequest();
    set({ session: null, status: 'unauthenticated' });
  },
}));

export const useSession = () => useAuthStore((state) => state.session);
export const useAuthStatus = () => useAuthStore((state) => state.status);
