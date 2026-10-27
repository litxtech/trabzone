import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type IconButtonProps = {
  name: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  backgroundColor?: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  variant?: 'plain' | 'soft' | 'surface' | 'glass';
};

export function IconButton({
  name,
  onPress,
  size = 20,
  color,
  backgroundColor,
  accessibilityLabel,
  style,
  disabled = false,
  variant = 'plain',
}: IconButtonProps) {
  const { theme } = useTheme();

  const background =
    backgroundColor ??
    (variant === 'soft'
      ? theme.colors.primarySoft
      : variant === 'surface'
        ? theme.colors.surface
        : variant === 'glass'
          ? theme.colors.glass
          : 'transparent');

  const iconColor =
    color ?? (variant === 'soft' ? theme.colors.primaryDeep : theme.colors.text);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background,
          borderRadius: theme.radius.pill,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
          borderWidth: variant === 'surface' ? StyleSheet.hairlineWidth : 0,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={iconColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
