import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeMode = 'system' | 'light' | 'dark';

type SettingsState = {
  themeMode: ThemeMode;
  hapticsEnabled: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setHapticsEnabled: (enabled: boolean) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      hapticsEnabled: true,
      setThemeMode: (themeMode) => set({ themeMode }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
    }),
    {
      name: 'trabzone.settings.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ themeMode, hapticsEnabled }) => ({ themeMode, hapticsEnabled }),
    },
  ),
);
