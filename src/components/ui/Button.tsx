import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { AppText } from './AppText';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  haptic?: 'tap' | 'press' | 'none';
  style?: ViewStyle;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const HEIGHTS: Record<ButtonSize, number> = { sm: 42, md: 50, lg: 56 };
const FONT_SIZE: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 16 };

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  fullWidth = true,
  haptic = 'tap',
  onPressIn,
  onPressOut,
  onPress,
  style,
  ...rest
}: ButtonProps) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const palette = {
    primary: {
      background: theme.colors.primaryDeep,
      foreground: theme.colors.onPrimary,
      border: 'transparent',
      shadow: theme.shadows.button,
    },
    secondary: {
      background: theme.colors.primarySoft,
      foreground: theme.colors.primaryDeep,
      border: 'transparent',
      shadow: theme.shadows.none,
    },
    outline: {
      background: 'transparent',
      foreground: theme.colors.text,
      border: theme.colors.borderStrong,
      shadow: theme.shadows.none,
    },
    ghost: {
      background: 'transparent',
      foreground: theme.colors.textSecondary,
      border: 'transparent',
      shadow: theme.shadows.none,
    },
    danger: {
      background: theme.colors.danger,
      foreground: '#FFFFFF',
      border: 'transparent',
      shadow: theme.shadows.none,
    },
  }[variant];

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={rest.accessibilityLabel ?? label}
      disabled={isDisabled}
      onPressIn={(event) => {
        scale.set(withTiming(0.97, { duration: 90 }));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withSpring(1, theme.animations.springs.snappy));
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (haptic === 'tap') {
          haptics.tap();
        } else if (haptic === 'press') {
          haptics.press();
        }
        onPress?.(event);
      }}
      style={[
        styles.base,
        {
          height: HEIGHTS[size],
          opacity: isDisabled ? 0.55 : 1,
          borderRadius: theme.radius.md,
          borderColor: palette.border,
          borderWidth: variant === 'outline' ? 1.5 : 0,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        palette.shadow,
        style,
      ]}
      {...rest}
    >
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle, { borderRadius: theme.radius.md, overflow: 'hidden' }]}>
        {variant === 'primary' ? (
          <LinearGradient
            colors={theme.gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]} />
        )}
      </Animated.View>

      <View style={styles.content} pointerEvents="none">
        {loading ? (
          <ActivityIndicator size="small" color={palette.foreground} />
        ) : (
          <View style={styles.contentRow}>
            {leftIcon ? <View style={styles.icon}>{leftIcon}</View> : null}
            <AppText
              variant="button"
              color={palette.foreground}
              style={{ fontSize: FONT_SIZE[size] }}
              numberOfLines={1}
            >
              {label}
            </AppText>
            {rightIcon ? <View style={styles.icon}>{rightIcon}</View> : null}
          </View>
        )}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    overflow: 'visible',
  },
  content: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
