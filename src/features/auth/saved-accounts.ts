import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { create } from 'zustand';

import type { Profile } from '@/features/profile/services/profile-service';

/**
 * Bu cihazda daha önce giriş yapılmış hesaplar.
 *
 * Amaç: giriş formunda kullanıcının avatarlı hesabını gösterip tek dokunuşla
 * e-posta alanını doldurmak (ve oturum hâlâ geçerliyse doğrudan devam etmek).
 * Şifre ASLA saklanmaz: yalnızca e-posta, görünen ad, kullanıcı adı ve avatar
 * yolu tutulur. Kayıtlar cihazdan silinebilir (bkz. `forget`).
 *
 * Saklanan oturum jetonu Supabase'in kendi deposundadır (`secureStorage`);
 * bu liste yalnızca giriş ekranındaki hesap seçiciyi besler.
 */
const STORAGE_KEY = 'trabzone.auth.saved-accounts';
const MAX_ACCOUNTS = 5;

export type SavedAccount = {
  id: string;
  email: string;
  name: string;
  username: string | null;
  avatarPath: string | null;
  lastUsedAt: number;
};

export type SavedAccountInput = {
  id: string;
  email?: string | null;
  name?: string | null;
  username?: string | null;
  avatarPath?: string | null;
};

type SavedAccountsState = {
  accounts: SavedAccount[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  remember: (input: SavedAccountInput) => void;
  forget: (id: string) => void;
  forgetAll: () => void;
};

const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

function sanitize(value: unknown): SavedAccount | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = asString(record.id);
  const email = asString(record.email);
  if (!id || !email) {
    return null;
  }
  return {
    id,
    email: email.toLowerCase(),
    name: asString(record.name) ?? '',
    username: asString(record.username),
    avatarPath: asString(record.avatarPath),
    lastUsedAt: typeof record.lastUsedAt === 'number' ? record.lastUsedAt : Date.now(),
  };
}

const sortAccounts = (accounts: SavedAccount[]) =>
  [...accounts].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_ACCOUNTS);

function persist(accounts: SavedAccount[]) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(accounts)).catch(() => {
    // Depolama reddedilirse liste bellekte kalır; giriş akışı bozulmaz.
  });
}

function mergeAccount(accounts: SavedAccount[], input: SavedAccountInput): SavedAccount[] {
  const email = asString(input.email)?.toLowerCase();
  if (!email) {
    return accounts;
  }
  const existing = accounts.find((account) => account.id === input.id);
  const next: SavedAccount = {
    id: input.id,
    email,
    // Profil henüz yüklenmemişse önceki ad/avatar korunur; boş değerle ezilmez.
    name: asString(input.name) ?? existing?.name ?? email,
    username: asString(input.username) ?? existing?.username ?? null,
    avatarPath: asString(input.avatarPath) ?? existing?.avatarPath ?? null,
    lastUsedAt: Date.now(),
  };

  const unchanged =
    existing !== undefined &&
    existing.email === next.email &&
    existing.name === next.name &&
    existing.username === next.username &&
    existing.avatarPath === next.avatarPath;

  if (unchanged) {
    // Aynı hesap tekrar tekrar yazılmasın; yalnızca kullanım sırası güncellenir.
    return sortAccounts(accounts.map((account) => (account.id === next.id ? next : account)));
  }

  return sortAccounts([...accounts.filter((account) => account.id !== next.id), next]);
}

let hydration: Promise<void> | null = null;

export const useSavedAccountsStore = create<SavedAccountsState>()((set, get) => ({
  accounts: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) {
      return Promise.resolve();
    }
    if (hydration) {
      return hydration;
    }
    hydration = (async () => {
      let loaded: SavedAccount[] = [];
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          loaded = parsed
            .map(sanitize)
            .filter((item): item is SavedAccount => item !== null);
        }
      } catch {
        loaded = [];
      } finally {
        hydration = null;
      }

      set((state) => {
        // Hydrate sırasında eklenen kayıt varsa kaybolmasın.
        const merged = [...loaded];
        for (const account of state.accounts) {
          if (!merged.some((item) => item.id === account.id)) {
            merged.push(account);
          }
        }
        return { hydrated: true, accounts: sortAccounts(merged) };
      });
    })();
    return hydration;
  },

  remember: (input) => {
    if (!asString(input.email)) {
      return;
    }
    void get()
      .hydrate()
      .then(() => {
        const next = mergeAccount(get().accounts, input);
        set({ accounts: next });
        persist(next);
      });
  },

  forget: (id) => {
    void get()
      .hydrate()
      .then(() => {
        const next = get().accounts.filter((account) => account.id !== id);
        set({ accounts: next });
        persist(next);
      });
  },

  forgetAll: () => {
    set({ accounts: [], hydrated: true });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  },
}));

/** Giriş formu ve oturum açılışı bu kancayla listeyi hazır tutar. */
export function useSavedAccounts(): SavedAccount[] {
  const accounts = useSavedAccountsStore((state) => state.accounts);
  const hydrate = useSavedAccountsStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return accounts;
}

export function rememberAccount(input: SavedAccountInput) {
  useSavedAccountsStore.getState().remember(input);
}

export function forgetAccount(id: string) {
  useSavedAccountsStore.getState().forget(id);
}

function nameFromParts(first: unknown, last: unknown): string | null {
  const parts = [asString(first), asString(last)].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Supabase oturumundan hesabı hatırlar. Profil henüz yüklenmemişse yalnızca
 * e-posta ve metadata'daki ad yazılır; avatar profil yüklendiğinde eklenir.
 */
export function rememberAccountFromSession(session: Session | null | undefined) {
  const user = session?.user;
  if (!user?.id) {
    return;
  }
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const username = asString(meta.username);
  const name = nameFromParts(meta.first_name, meta.last_name);
  rememberAccount({
    id: user.id,
    email: user.email,
    name: name ?? username,
    username,
    avatarPath: null,
  });
}

/** Profil yüklendiğinde avatar ve görünen adı günceller. */
export function rememberAccountFromProfile(
  profile: Profile | null | undefined,
  email: string | null | undefined,
) {
  if (!profile?.id || !email) {
    return;
  }
  rememberAccount({
    id: profile.id,
    email,
    name: nameFromParts(profile.first_name, profile.last_name) ?? profile.username,
    username: profile.username,
    avatarPath: profile.avatar_path,
  });
}
