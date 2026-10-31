import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type CardPref = { hidden?: boolean; minimized?: boolean; at: number };

type SportsCardState = {
  /** Maç bazında kullanıcı tercihi: gizle / küçült. Yeni maçta kart yeniden görünür. */
  cards: Record<string, CardPref>;
  setHidden: (fixtureId: number, hidden: boolean) => void;
  setMinimized: (fixtureId: number, minimized: boolean) => void;
};

/** Sürüm 2: feed'de TEST maçı gösterme tercihi kaldırıldı. */
const STORE_VERSION = 2;
const MAX_ENTRIES = 40;

function prune(cards: Record<string, CardPref>): Record<string, CardPref> {
  const entries = Object.entries(cards);
  if (entries.length <= MAX_ENTRIES) return cards;
  return Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES));
}

/**
 * Depodan gelen kaydı tanınan alanlara indirger. Eski sürümlerdeki artık
 * alanlar (ör. `showTest`) ve bozuk kayıtlar sessizce düşer.
 */
function sanitizeCards(value: unknown): Record<string, CardPref> {
  if (!value || typeof value !== 'object') return {};
  const cards: Record<string, CardPref> = {};
  for (const [fixtureId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const pref: CardPref = { at: typeof record.at === 'number' ? record.at : 0 };
    if (typeof record.hidden === 'boolean') pref.hidden = record.hidden;
    if (typeof record.minimized === 'boolean') pref.minimized = record.minimized;
    // Tercihi olmayan kayıt bir şey ifade etmez; kart yeniden görünür varsayılır.
    if (pref.hidden === undefined && pref.minimized === undefined) continue;
    cards[fixtureId] = pref;
  }
  return prune(cards);
}

export const useSportsCardStore = create<SportsCardState>()(
  persist(
    (set) => ({
      cards: {},
      setHidden: (fixtureId, hidden) =>
        set((state) => ({
          cards: prune({ ...state.cards, [fixtureId]: { ...state.cards[fixtureId], hidden, at: Date.now() } }),
        })),
      setMinimized: (fixtureId, minimized) =>
        set((state) => ({
          cards: prune({ ...state.cards, [fixtureId]: { ...state.cards[fixtureId], minimized, at: Date.now() } }),
        })),
    }),
    {
      name: 'trabzone-sports-card',
      storage: createJSONStorage(() => AsyncStorage),
      version: STORE_VERSION,
      partialize: ({ cards }) => ({ cards }),
      // Sürüm 1 kayıtları da okunur: kullanıcı tercihleri kaybolmaz. `migrate`
      // olmadan zustand sürüm uyuşmazlığında kaydı tümüyle yok sayıyordu.
      migrate: (persistedState) => {
        const persisted = persistedState as { cards?: unknown } | undefined;
        return { cards: sanitizeCards(persisted?.cards) };
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as { cards?: unknown } | undefined;
        return { ...currentState, cards: sanitizeCards(persisted?.cards) };
      },
    },
  ),
);
