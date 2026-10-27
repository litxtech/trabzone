import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  elevated?: boolean;
  tone?: 'surface' | 'muted' | 'primarySoft';
  radius?: 'md' | 'lg' | 'xl';
};

export function Card({
  children,
  style,
  padding,
  elevated = true,
  tone = 'surface',
  radius = 'lg',
}: CardProps) {
  const { theme } = useTheme();
  const backgroundColor =
    tone === 'surface'
      ? theme.colors.surface
      : tone === 'muted'
        ? theme.colors.surfaceMuted
        : theme.colors.primarySoft;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor,
          borderRadius: theme.radius[radius],
          padding: padding ?? theme.spacing.xl,
          borderColor: theme.colors.border,
        },
        elevated ? theme.shadows.card : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
