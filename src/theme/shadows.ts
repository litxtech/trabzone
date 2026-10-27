import { Platform, type ViewStyle } from 'react-native';

type ShadowToken = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

const createShadow = (
  color: string,
  opacity: number,
  radius: number,
  offsetY: number,
  elevation: number,
): ShadowToken => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: offsetY },
  shadowOpacity: Platform.OS === 'ios' ? opacity : 0,
  shadowRadius: radius,
  elevation: Platform.OS === 'android' ? elevation : 0,
});

export const lightShadows = {
  none: {},
  xs: createShadow('#172238', 0.04, 6, 2, 1),
  sm: createShadow('#172238', 0.06, 12, 4, 2),
  card: createShadow('#1E3A8A', 0.08, 20, 8, 4),
  floating: createShadow('#1E3A8A', 0.14, 28, 12, 10),
  sheet: createShadow('#0B1220', 0.18, 36, -6, 18),
  button: createShadow('#1459E8', 0.28, 16, 8, 6),
  glow: createShadow('#477BFF', 0.35, 24, 0, 0),
} satisfies Record<string, ShadowToken>;

export const darkShadows = {
  none: {},
  xs: createShadow('#000000', 0.2, 6, 2, 1),
  sm: createShadow('#000000', 0.24, 12, 4, 2),
  card: createShadow('#000000', 0.3, 20, 8, 4),
  floating: createShadow('#000000', 0.36, 28, 12, 10),
  sheet: createShadow('#000000', 0.45, 36, -6, 18),
  button: createShadow('#1459E8', 0.24, 16, 8, 6),
  glow: createShadow('#477BFF', 0.3, 24, 0, 0),
} satisfies Record<string, ShadowToken>;

export type ShadowVariant = keyof typeof lightShadows;
