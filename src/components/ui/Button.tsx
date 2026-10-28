import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

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

const HEIGHTS: Record<ButtonSize, number> = { sm: 42, md: 50, lg: 56 };
const FONT_SIZE: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 16 };

/**
 * Birincil eylem butonu.
 *
 * Dokunus geri bildirimi animasyonsuzdur: parmak degdigi anda hafif olcek +
 * opaklik degisir, birakildiginda ayni karede eski haline doner. Yay/timing
 * animasyonu bilincli olarak kaldirildi; birakma sonrasi "karanlik kalma"
 * veya gecikmeli toparlanma yasanmaz.
 */
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
  const isDisabled = disabled || loading;

  const palette = {
    primary: {
      background: theme.colors.primaryDeep,
      foreground: theme.colors.onPrimary,
      border: 'transparent',
      // Buton golgesi kaldirildi: her CTA icin ek offscreen render ve
      // "shadow cannot be calculated efficiently" uyarisi ortadan kalkti.
      shadow: theme.shadows.none,
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
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={rest.accessibilityLabel ?? label}
      disabled={isDisabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={(event) => {
        if (haptic === 'tap') {
          haptics.tap();
        } else if (haptic === 'press') {
          haptics.press();
        }
        onPress?.(event);
      }}
      style={
        Platform.OS === 'web'
          ? // Web'de `Link asChild` içinde kullanılan Pressable'ın fonksiyon
            // biçimindeki `style` prop'u birleştirilemediği için (Radix Slot
            // nesne bekliyor) tüm buton stilleri kayboluyordu. Ayrıca dizi
            // biçimindeki stil de aynı nedenle çökme yaratıyor; bu yüzden ağda
            // düz nesneye indirgenir. Basma geri bildirimi global CSS
            // (`:active`) tarafından sağlanır.
            StyleSheet.flatten([
              styles.base,
              {
                height: HEIGHTS[size],
                borderRadius: theme.radius.md,
                borderColor: palette.border,
                borderWidth: variant === 'outline' ? 1.5 : 0,
                alignSelf: fullWidth ? 'stretch' : 'flex-start',
                opacity: isDisabled ? 0.55 : 1,
              },
              palette.shadow,
              style,
            ])
          : ({ pressed }) => [
              styles.base,
              {
                height: HEIGHTS[size],
                borderRadius: theme.radius.md,
                borderColor: palette.border,
                borderWidth: variant === 'outline' ? 1.5 : 0,
                alignSelf: fullWidth ? 'stretch' : 'flex-start',
                opacity: isDisabled ? 0.55 : pressed ? 0.9 : 1,
                transform: [{ scale: pressed && !isDisabled ? 0.985 : 1 }],
              },
              palette.shadow,
              style,
            ]
      }
      {...rest}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: theme.radius.md, overflow: 'hidden' },
        ]}
        pointerEvents="none"
      >
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
      </View>

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
    </Pressable>
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
