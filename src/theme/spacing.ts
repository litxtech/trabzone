export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
  massive: 64,
} as const;

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 26,
  xxl: 32,
  pill: 999,
} as const;

export const hitSlop = {
  sm: { top: 8, bottom: 8, left: 8, right: 8 },
  md: { top: 12, bottom: 12, left: 12, right: 12 },
} as const;

export const layout = {
  screenPadding: spacing.xl,
  maxContentWidth: 560,
  inputHeight: 54,
  buttonHeight: 54,
  tabBarHeight: 64,
  headerHeight: 56,
  avatarSm: 32,
  avatarMd: 44,
  avatarLg: 64,
  avatarXl: 96,
} as const;

/** Minimum touch target required by the accessibility guidelines. */
export const minTouchSize = 44;
