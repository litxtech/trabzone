import { brandGradients, palette } from './colors';
import { durations, easings, springs } from './animations';
import { darkShadows, lightShadows, type ShadowVariant } from './shadows';
import { layout, minTouchSize, radius, spacing } from './spacing';
import { typography } from './typography';
import type { TextStyle } from 'react-native';

export type ColorScheme = 'light' | 'dark';

export type ThemeColors = {
  background: string;
  backgroundAlt: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  surfaceInverse: string;
  inputBackground: string;
  border: string;
  borderStrong: string;
  divider: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  primary: string;
  primaryDeep: string;
  primarySoft: string;
  accent: string;
  accentSoft: string;
  /** Marka yazisindaki vurgu harfi icin parlak aksan. */
  accentBright: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  onPrimary: string;
  overlay: string;
  skeleton: string;
  skeletonHighlight: string;
  tabBar: string;
  tabBarBorder: string;
  glass: string;
  /** Yarı saydam kartlarda görünür kalan cam kenarı. */
  glassBorder: string;
  /** Cam kartın üst kenarındaki ince ışık çizgisi. */
  glassHighlight: string;
  shadow: string;
};

export type Theme = {
  scheme: ColorScheme;
  colors: ThemeColors;
  gradients: typeof brandGradients;
  typography: typeof typography;
  spacing: typeof spacing;
  radius: typeof radius;
  layout: typeof layout;
  minTouchSize: number;
  shadows: Record<ShadowVariant, object>;
  animations: {
    durations: typeof durations;
    easings: typeof easings;
    springs: typeof springs;
  };
};

const lightColors: ThemeColors = {
  background: palette.background,
  backgroundAlt: palette.blue50,
  surface: palette.white,
  surfaceElevated: palette.white,
  surfaceMuted: palette.slate100,
  surfaceInverse: palette.ink,
  inputBackground: palette.slate50,
  border: palette.slate200,
  borderStrong: palette.slate300,
  divider: palette.slate200,
  text: palette.darkNavy,
  textSecondary: palette.slate500,
  textTertiary: palette.slate400,
  textInverse: palette.white,
  primary: palette.primary,
  primaryDeep: palette.primaryDeep,
  primarySoft: palette.blue100,
  accent: palette.premiumPurple,
  accentSoft: '#F1EBFF',
  accentBright: '#7C4DFF',
  success: palette.green500,
  successSoft: '#E7F7EE',
  warning: palette.amber500,
  warningSoft: '#FEF3E2',
  danger: palette.red500,
  dangerSoft: '#FDECEE',
  info: palette.sky500,
  onPrimary: palette.white,
  overlay: 'rgba(9, 16, 30, 0.55)',
  skeleton: '#E6ECF8',
  skeletonHighlight: '#F3F7FF',
  tabBar: 'rgba(255, 255, 255, 0.96)',
  tabBarBorder: 'rgba(21, 32, 57, 0.07)',
  glass: 'rgba(255, 255, 255, 0.78)',
  glassBorder: 'rgba(65, 105, 245, 0.16)',
  glassHighlight: 'rgba(255, 255, 255, 0.92)',
  shadow: '#1E3A8A',
};

const darkColors: ThemeColors = {
  background: palette.navy900,
  backgroundAlt: palette.navy950,
  surface: palette.navy800,
  surfaceElevated: palette.navy700,
  surfaceMuted: '#1B2640',
  surfaceInverse: palette.white,
  inputBackground: '#101729',
  border: '#243252',
  borderStrong: '#31426A',
  divider: '#1E2A46',
  text: '#F5F7FF',
  textSecondary: '#A2AEC7',
  textTertiary: '#7482A0',
  textInverse: palette.ink,
  primary: '#4169F5',
  primaryDeep: '#6284FF',
  primarySoft: '#16264B',
  accent: '#8057F4',
  accentSoft: '#241B3D',
  accentBright: '#A78BFA',
  success: '#3DD68C',
  successSoft: '#10281E',
  warning: '#FBBF24',
  warningSoft: '#2A2110',
  danger: '#FF6B70',
  dangerSoft: '#2C1418',
  info: '#38BDF8',
  onPrimary: '#FFFFFF',
  overlay: 'rgba(3, 7, 14, 0.68)',
  skeleton: '#182440',
  skeletonHighlight: '#22314F',
  tabBar: 'rgba(11, 16, 32, 0.96)',
  tabBarBorder: 'rgba(255, 255, 255, 0.07)',
  glass: 'rgba(20, 28, 48, 0.76)',
  glassBorder: 'rgba(255, 255, 255, 0.16)',
  glassHighlight: 'rgba(255, 255, 255, 0.1)',
  shadow: '#000000',
};

const sharedTheme = {
  gradients: brandGradients,
  typography,
  spacing,
  radius,
  layout,
  minTouchSize,
  animations: { durations, easings, springs },
};

export const lightTheme: Theme = {
  ...sharedTheme,
  scheme: 'light',
  colors: lightColors,
  shadows: lightShadows,
};

export const darkTheme: Theme = {
  ...sharedTheme,
  scheme: 'dark',
  colors: darkColors,
  shadows: darkShadows,
};

export const themes: Record<ColorScheme, Theme> = {
  light: lightTheme,
  dark: darkTheme,
};

/** Text style helper: maps a semantic variant + optional color override. */
export const textStyle = (
  theme: Theme,
  variant: keyof typeof typography,
  color?: string,
): TextStyle => ({
  ...theme.typography[variant],
  color: color ?? theme.colors.text,
});

export type { ViewStyle } from 'react-native';
