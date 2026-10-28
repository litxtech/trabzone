/**
 * Raw brand palette. Never import this directly from screens - use `useTheme()`
 * so light/dark semantics stay in one place.
 */
export const palette = {
  primary: '#4169F5',
  primaryDeep: '#2F55D4',
  primaryLight: '#6284FF',
  electric: '#4169F5',
  premiumPurple: '#8057F4',
  darkNavy: '#152039',
  background: '#F7F9FD',
  white: '#FFFFFF',
  ink: '#0B1020',

  blue50: '#F1F5FF',
  blue100: '#E8EEFF',
  blue200: '#D2DDFF',
  blue300: '#A8BEFF',
  blue500: '#4169F5',
  blue600: '#6284FF',
  blue700: '#2F55D4',
  blue900: '#12275E',

  slate50: '#F7F9FE',
  slate100: '#EEF2FA',
  slate200: '#E2E8F4',
  slate300: '#CBD5E6',
  slate400: '#8A94A6',
  slate500: '#77839A',
  slate700: '#2C3A52',
  slate900: '#152039',

  navy700: '#1B2640',
  navy800: '#141C30',
  navy850: '#101729',
  navy900: '#0B1020',
  navy950: '#070B14',

  green500: '#16A34A',
  green400: '#3DD68C',
  amber500: '#F59E0B',
  amber400: '#FBBF24',
  red500: '#E5484D',
  red400: '#FF6B70',
  sky500: '#0EA5E9',

  black: '#000000',
  transparent: 'transparent',
} as const;

export const brandGradients = {
  primary: ['#4169F5', '#2F55D4'] as const,
  aurora: ['#6284FF', '#8057F4'] as const,
  splash: ['#0B1020', '#2F55D4', '#8057F4'] as const,
  glass: ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.65)'] as const,
  darkGlass: ['rgba(20,28,48,0.92)', 'rgba(11,16,32,0.72)'] as const,
  sunset: ['#8057F4', '#4169F5', '#6284FF'] as const,
};
