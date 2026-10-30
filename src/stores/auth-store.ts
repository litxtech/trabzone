import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { rememberAccountFromSession } from '@/features/auth/saved-accounts';
import { clearAllChatDrafts } from '@/features/messaging/drafts/draft-store';
import { unregisterPush } from '@/features/notifications/push/push-registration';
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
    // Oturum okunamazsa (depolama hatası, ağ kesintisi) uygulama "booting"
    // durumunda kilitli kalmamalı: aksi halde AuthGate hiçbir şey çizmez ve
    // kullanıcı boş ekranda bekler.
    let session: Session | null = null;
    try {
      session = await getCurrentSession();
    } catch {
      session = null;
    }
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
    // Cihaz token'ı çıkıştan önce sunucudan silinir; aksi halde kapalı
    // hesaba ait push'lar bu cihaza gelmeye devam eder.
    await unregisterPush();
    try {
      await signOutRequest();
    } finally {
      // Sunucu isteği başarısız olsa da cihazdaki oturum kapanır; kullanıcı
      // giriş ekranına döner.
      set({ session: null, status: 'unauthenticated' });
    }
    // Başka bir hesap aynı cihazda açılabilir; yarım mesajlar cihazda kalmaz.
    clearAllChatDrafts();
  },
}));

export const useSession = () => useAuthStore((state) => state.session);
export const useAuthStatus = () => useAuthStore((state) => state.status);
