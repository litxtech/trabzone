import * as Crypto from 'expo-crypto';
import { AppState, Platform } from 'react-native';

import type { AdPlatform } from './types';

/**
 * Reklam oturumu: oturum başı reklam sınırları bu kimlikle sunucuda sayılır.
 * Uygulama 30 dakikadan uzun arka planda kalırsa yeni oturum başlar; cihaz
 * kimliği veya reklam kimliği (IDFA/AAID) kullanılmaz.
 */
const SESSION_IDLE_MS = 30 * 60 * 1000;

let sessionId = Crypto.randomUUID();
let backgroundAt: number | null = null;
const listeners = new Set<() => void>();

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    if (backgroundAt != null && Date.now() - backgroundAt > SESSION_IDLE_MS) {
      sessionId = Crypto.randomUUID();
      listeners.forEach((listener) => listener());
    }
    backgroundAt = null;
  } else if (backgroundAt == null) {
    backgroundAt = Date.now();
  }
});

export function adSessionId(): string {
  return sessionId;
}

export function onAdSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function adPlatform(): AdPlatform {
  if (Platform.OS === 'ios') {
    return 'ios';
  }
  if (Platform.OS === 'android') {
    return 'android';
  }
  return 'web';
}
