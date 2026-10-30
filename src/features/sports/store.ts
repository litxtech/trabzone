import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type CardPref = { hidden?: boolean; minimized?: boolean; at: number };

type SportsCardState = {
  /** Maç bazında kullanıcı tercihi: gizle / küçült. Yeni maçta kart yeniden görünür. */
  cards: Record<string, CardPref>;
  setHidden: (fixtureId: number, hidden: boolean) => void;
  setMinimized: (fixtureId: number, minimized: boolean) => void;
  /** Yalnızca yetkili admin için anlamlıdır; sunucu TEST maçlarını diğer herkesten süzer. */
  showTest: boolean;
  setShowTest: (value: boolean) => void;
};

const MAX_ENTRIES = 40;

function prune(cards: Record<string, CardPref>): Record<string, CardPref> {
  const entries = Object.entries(cards);
  if (entries.length <= MAX_ENTRIES) return cards;
  return Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES));
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
      showTest: false,
      setShowTest: (showTest) => set({ showTest }),
    }),
    { name: 'trabzone-sports-card', storage: createJSONStorage(() => AsyncStorage), version: 1 },
  ),
);
