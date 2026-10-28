import { Easing } from 'react-native-reanimated';

export const durations = {
  instant: 120,
  fast: 180,
  base: 240,
  slow: 320,
  slower: 420,
  /** The scripted brand intro; total time to the app is capped at ~1.2s. */
  splash: 900,
  splashExit: 260,
} as const;

export const easings = {
  standard: Easing.bezier(0.2, 0, 0, 1),
  decelerate: Easing.bezier(0, 0, 0.2, 1),
  accelerate: Easing.bezier(0.4, 0, 1, 1),
  emphasized: Easing.bezier(0.05, 0.7, 0.1, 1),
  spring: Easing.bezier(0.34, 1.36, 0.64, 1),
} as const;

export const springs = {
  soft: { damping: 18, stiffness: 180, mass: 0.9 },
  snappy: { damping: 22, stiffness: 260, mass: 0.7 },
  bouncy: { damping: 14, stiffness: 220, mass: 0.8 },
  drawer: { damping: 26, stiffness: 240, mass: 0.9 },
} as const;

/**
 * Yigin gecis ayarlari: native push hizi. Fade/blur yok, kullaniciyi bekletmez.
 * Alt sekmelerde gecis tamamen kapali (`animation: 'none'`).
 */
export const navigationTransition = {
  animation: 'slide_from_right',
  animationDuration: durations.fast,
} as const;
