import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  compact?: boolean;
};

/**
 * Destek ve moderasyon ekranlarinin ortak basligi. Geri dugmesi varsayilan
 * olarak router.back() cagirir; kok ekranlarda `onBack` ile menu acilabilir.
 */
export function SafetyHeader({ title, subtitle, onBack, right, compact = false }: Props) {
  const router = useRouter();
  const { theme } = useTheme();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/feed');
    }
  };

  return (
    <View style={[styles.wrapper, compact && styles.compact]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Geri"
        hitSlop={8}
        onPress={handleBack}
        style={({ pressed }) => [
          styles.back,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons name="chevron-back" size={21} color={theme.colors.text} />
      </Pressable>

      <View style={styles.textBlock}>
        <AppText variant={compact ? 'h3' : 'h2'} numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color="textSecondary" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>

      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 6,
    paddingBottom: 18,
  },
  compact: { paddingBottom: 12 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  textBlock: { flex: 1, gap: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
