import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Sistemin "animasyonları kaldır" ayarını izler.
 *
 * Android'de bu ayar özellikle düşük güçlü cihazlarda kullanıcılar tarafından
 * açılır; açıkken geçişleri ve marka introsunu anında bitirmek uygulamayı
 * gözle görülür şekilde hızlandırır. Değer tek bir dinleyiciyle tüm uygulamaya
 * yayılır (her bileşen kendi aboneliğini açmaz).
 */
let reduceMotion = false;
const listeners = new Set<() => void>();
let initialized = false;

function setReduceMotion(next: boolean) {
  if (next === reduceMotion) {
    return;
  }
  reduceMotion = next;
  listeners.forEach((listener) => listener());
}

function initialize() {
  if (initialized) {
    return;
  }
  initialized = true;

  AccessibilityInfo.isReduceMotionEnabled()
    .then(setReduceMotion)
    .catch(() => undefined);

  AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
}

function subscribe(listener: () => void) {
  initialize();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return reduceMotion;
}

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
