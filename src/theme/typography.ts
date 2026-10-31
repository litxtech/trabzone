import { Platform, type TextStyle } from 'react-native';

/**
 * Font family names must match the keys registered through `useFonts` in
 * `src/theme/fonts.ts`.
 */
export const fontFamilies = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extraBold: 'Manrope_800ExtraBold',
  display: 'Sora_600SemiBold',
  displayBold: 'Sora_700Bold',
} as const;

type TypeToken = Pick<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight' | 'letterSpacing'>;

export const typography = {
  displayXl: {
    fontFamily: fontFamilies.displayBold,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.9,
  },
  display: {
    fontFamily: fontFamilies.displayBold,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: 0.3,
  },
  h1: {
    fontFamily: fontFamilies.display,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  h2: {
    fontFamily: fontFamilies.display,
    fontSize: 21,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  h3: {
    fontFamily: fontFamilies.bold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  title: {
    fontFamily: fontFamilies.semibold,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  body: {
    fontFamily: fontFamilies.regular,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
  },
  bodyStrong: {
    fontFamily: fontFamilies.semibold,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
  },
  label: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
  },
  caption: {
    fontFamily: fontFamilies.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
  },
  button: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: Platform.select({ ios: 0.1, default: 0.2 }),
  },
  overline: {
    fontFamily: fontFamilies.displayBold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1.3,
  },
} satisfies Record<string, TypeToken>;

export type TypographyVariant = keyof typeof typography;
