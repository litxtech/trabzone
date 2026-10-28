import AsyncStorage from '@react-native-async-storage/async-storage';

export type CookiePreferences = {
  necessary: true;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
};

export const COOKIE_STORAGE_KEY = 'trabzone.cookie-preferences.v1';

const listeners = new Set<() => void>();

export function openCookieSettings() {
  listeners.forEach((listener) => listener());
}

export function subscribeCookieSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function readCookiePreferences(): Promise<CookiePreferences | null> {
  try {
    const raw = await AsyncStorage.getItem(COOKIE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CookiePreferences>;
    if (typeof parsed.decidedAt !== 'string') {
      return null;
    }
    return {
      necessary: true,
      functional: Boolean(parsed.functional),
      analytics: Boolean(parsed.analytics),
      marketing: false,
      decidedAt: parsed.decidedAt,
    };
  } catch {
    return null;
  }
}

export async function saveCookiePreferences(
  input: Pick<CookiePreferences, 'functional' | 'analytics'>,
): Promise<CookiePreferences> {
  const value: CookiePreferences = {
    necessary: true,
    functional: input.functional,
    analytics: input.analytics,
    marketing: false,
    decidedAt: new Date().toISOString(),
  };
  try {
    await AsyncStorage.setItem(COOKIE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Tercih kaydedilemezse oturum boyunca varsayılan zorunlu çerezler geçerli olur.
  }
  return value;
}
