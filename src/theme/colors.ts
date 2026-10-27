/**
 * Raw brand palette. Never import this directly from screens - use `useTheme()`
 * so light/dark semantics stay in one place.
 */
export const palette = {
  primary: '#477BFF',
  primaryDeep: '#1459E8',
  electric: '#377DFF',
  premiumPurple: '#895DF5',
  darkNavy: '#172238',
  background: '#F4F6FB',
  white: '#FFFFFF',
  ink: '#0B1220',

  blue50: '#F1F5FF',
  blue100: '#E8EFFF',
  blue200: '#D3E1FF',
  blue300: '#A9C1FF',
  blue500: '#477BFF',
  blue600: '#2F6BFF',
  blue700: '#1459E8',
  blue900: '#0B2A6B',

  slate50: '#F7F9FE',
  slate100: '#EEF2FB',
  slate200: '#E2E8F5',
  slate300: '#CBD5E8',
  slate400: '#8A94A6',
  slate500: '#55627A',
  slate700: '#2C3A52',
  slate900: '#172238',

  navy800: '#121A2B',
  navy850: '#16203A',
  navy900: '#0B1220',
  navy950: '#070C16',

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
  primary: ['#477BFF', '#1459E8'] as const,
  aurora: ['#377DFF', '#895DF5'] as const,
  splash: ['#0B2A6B', '#1459E8', '#477BFF'] as const,
  glass: ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.65)'] as const,
  darkGlass: ['rgba(23,34,56,0.92)', 'rgba(11,18,32,0.72)'] as const,
};
