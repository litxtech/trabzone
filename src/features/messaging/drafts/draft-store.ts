import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Sohbet başına yazılmış ama gönderilmemiş mesaj (taslak) deposu.
 *
 * WhatsApp davranışı: sohbetten çıkıp geri dönüldüğünde, hatta uygulama
 * kapatılıp açıldığında yazılan metin inputta bekler. Taslaklar cihazda
 * tutulur; sunucuya gönderilmez. Mesaj gönderilince veya input temizlenince
 * kayıt silinir.
 */
const STORAGE_KEY = 'trabzone.chat.drafts';
const PERSIST_DELAY_MS = 250;
const MAX_DRAFTS = 80;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LENGTH = 4000;

export type ChatDraft = { text: string; updatedAt: number };

type DraftState = {
  drafts: Record<string, ChatDraft>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  write: (conversationId: string, text: string) => void;
  clear: (conversationId: string) => void;
  clearAll: () => void;
};

function sanitizeDrafts(value: unknown): Record<string, ChatDraft> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const now = Date.now();
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([conversationId, raw]) => {
      if (!raw || typeof raw !== 'object') {
        return null;
      }
      const record = raw as Record<string, unknown>;
      const text = typeof record.text === 'string' ? record.text.slice(0, MAX_LENGTH) : '';
      const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : now;
      if (!text.trim()) {
        return null;
      }
      if (now - updatedAt > MAX_AGE_MS) {
        return null;
      }
      return [conversationId, { text, updatedAt }] as const;
    })
    .filter((entry): entry is readonly [string, ChatDraft] => entry !== null);

  // En yeni taslaklar tutulur; eski kayıtlar sessizce düşer.
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(entries.slice(0, MAX_DRAFTS));
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let hydration: Promise<void> | null = null;
let flushInstalled = false;

function toStorage(drafts: Record<string, ChatDraft>): string {
  const entries = Object.entries(drafts)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, MAX_DRAFTS);
  return JSON.stringify(Object.fromEntries(entries));
}

function persistNow() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const { drafts, hydrated } = useDraftStore.getState();
  if (!hydrated) {
    return;
  }
  AsyncStorage.setItem(STORAGE_KEY, toStorage(drafts)).catch(() => {
    // Depolama reddedilirse taslak bellekte kalır; sohbet akışı bozulmaz.
  });
}

function schedulePersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(persistNow, PERSIST_DELAY_MS);
}

/**
 * Uygulama arka plana alındığında / sekme gizlendiğinde bekleyen yazımı
 * hemen diske aktarır; sekme kapanırken taslak kaybolmaz.
 */
function installFlushOnBackground() {
  if (flushInstalled) {
    return;
  }
  flushInstalled = true;

  AppState.addEventListener('change', (state) => {
    if (state !== 'active') {
      persistNow();
    }
  });

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        persistNow();
      }
    });
  }
}

export const useDraftStore = create<DraftState>()((set, get) => ({
  drafts: {},
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) {
      return Promise.resolve();
    }
    if (hydration) {
      return hydration;
    }
    installFlushOnBackground();
    hydration = (async () => {
      let loaded: Record<string, ChatDraft> = {};
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        loaded = raw ? sanitizeDrafts(JSON.parse(raw)) : {};
      } catch {
        loaded = {};
      } finally {
        hydration = null;
      }
      set((state) => ({
        hydrated: true,
        // Hydrate sırasında yazılan taslak varsa korunur.
        drafts: { ...loaded, ...state.drafts },
      }));
    })();
    return hydration;
  },

  write: (conversationId, text) => {
    if (!conversationId) {
      return;
    }
    const next = text.slice(0, MAX_LENGTH);
    if (!next.trim()) {
      get().clear(conversationId);
      return;
    }
    set((state) => ({
      drafts: { ...state.drafts, [conversationId]: { text: next, updatedAt: Date.now() } },
    }));
    schedulePersist();
  },

  clear: (conversationId) => {
    if (!get().drafts[conversationId]) {
      return;
    }
    set((state) => {
      const drafts = { ...state.drafts };
      delete drafts[conversationId];
      return { drafts };
    });
    schedulePersist();
  },

  clearAll: () => {
    set({ drafts: {}, hydrated: true });
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  },
}));

/** Depo hazır olana kadar input'a kayıtlı metin yazılmaz. */
export function useDraftsHydrated(): boolean {
  const hydrated = useDraftStore((state) => state.hydrated);
  const hydrate = useDraftStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return hydrated;
}

/** Sohbet listesinde "Taslak: ..." önizlemesi için tüm taslaklar. */
export function useChatDrafts(): Record<string, ChatDraft> {
  useDraftsHydrated();
  return useDraftStore((state) => state.drafts);
}

export function getChatDraft(conversationId: string): string {
  if (!conversationId) {
    return '';
  }
  return useDraftStore.getState().drafts[conversationId]?.text ?? '';
}

export function writeChatDraft(conversationId: string, text: string) {
  useDraftStore.getState().write(conversationId, text);
}

export function clearChatDraft(conversationId: string) {
  useDraftStore.getState().clear(conversationId);
}

/** Çıkışta taslakların cihazda kalması istenmez; hesap silme akışı kullanır. */
export function clearAllChatDrafts() {
  useDraftStore.getState().clearAll();
}
