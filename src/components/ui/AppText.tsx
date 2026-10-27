import type { ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import type { TypographyVariant } from '@/theme/typography';
import type { ThemeColors } from '@/theme/themes';

type ColorToken = keyof ThemeColors;

export type AppTextProps = TextProps & {
  variant?: TypographyVariant;
  color?: ColorToken | (string & {});
  align?: TextStyle['textAlign'];
  children?: ReactNode;
};

export function AppText({
  variant = 'body',
  color = 'text',
  align,
  style,
  children,
  ...rest
}: AppTextProps) {
  const { theme } = useTheme();
  const resolvedColor =
    color in theme.colors ? theme.colors[color as ColorToken] : (color as string);

  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={1.4}
      {...rest}
      style={[theme.typography[variant], { color: resolvedColor }, align ? { textAlign: align } : null, style]}
    >
      {children}
    </Text>
  );
}
