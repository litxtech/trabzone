import * as SystemUI from 'expo-system-ui';
import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';

import { useSettingsStore, type ThemeMode } from '@/stores/settings-store';

import { themes, type ColorScheme, type Theme } from './themes';

type ThemeContextValue = {
  theme: Theme;
  scheme: ColorScheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const mode = useSettingsStore((state) => state.themeMode);
  const setMode = useSettingsStore((state) => state.setThemeMode);
  const systemScheme = useColorScheme();

  const scheme: ColorScheme = mode === 'system' ? (systemScheme ?? 'light') : mode;
  const theme = themes[scheme];

  useEffect(() => {
    // Keeps the Android window background in sync so navigation never flashes white.
    SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => {
      // Unsupported on some platforms (web) - purely cosmetic.
    });
  }, [theme.colors.background]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, scheme, mode, setMode }),
    [theme, scheme, mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return context;
}

/**
 * Belirli bir ekran agacini sabit bir renk semasina kilitler. Auth ekranlari
 * sistem temasindan bagimsiz olarak her zaman koyu premium yuzeyde calisir.
 */
export function ThemeScope({
  scheme = 'dark',
  children,
}: PropsWithChildren<{ scheme?: ColorScheme }>) {
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themes[scheme],
      scheme,
      mode: scheme,
      setMode: () => undefined,
    }),
    [scheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Convenience hook used by components that only need the raw tokens. */
export function useThemeTokens(): Theme {
  return useTheme().theme;
}
