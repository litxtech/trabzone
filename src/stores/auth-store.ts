import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { rememberAccountFromSession } from '@/features/auth/saved-accounts';
import { clearAllChatDrafts } from '@/features/messaging/drafts/draft-store';
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
    // Cihazda oturumu açık hesap, giriş ekranındaki avatarlı listede görünür.
    rememberAccountFromSession(session);

    if (unsubscribe) {
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      set({ session: nextSession, status: nextSession ? 'authenticated' : 'unauthenticated' });
      // Başka sekmede/açılışta yenilenen oturum da listeye işlenir. Çıkışta
      // kayıt silinmez: kullanıcı hesabını tek dokunuşla yeniden seçebilir.
      rememberAccountFromSession(nextSession);
    });
    unsubscribe = () => data.subscription.unsubscribe();
  },

  signOut: async () => {
    await signOutRequest();
    // Başka bir hesap aynı cihazda açılabilir; yarım mesajlar cihazda kalmaz.
    clearAllChatDrafts();
    set({ session: null, status: 'unauthenticated' });
  },
}));

export const useSession = () => useAuthStore((state) => state.session);
export const useAuthStatus = () => useAuthStore((state) => state.status);
