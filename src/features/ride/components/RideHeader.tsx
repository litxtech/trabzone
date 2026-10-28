import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from '@/utils/router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export function RideHeader({
  title,
  subtitle,
  right,
  back = true,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  back?: boolean;
  onBack?: () => void;
}) {
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
      router.replace('/ride' as never);
    }
  };

  return (
    <View style={styles.wrap}>
      {back ? (
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
      ) : (
        <LinearGradient
          colors={['#4169F5', '#8057F4']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.mark}
        >
          <Ionicons name="car-sport" size={17} color="#FFFFFF" />
        </LinearGradient>
      )}
      <View style={styles.text}>
        <AppText variant="h2" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right ?? <View style={styles.spacer} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 2, paddingBottom: 4 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  mark: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 1 },
  spacer: { width: 40, height: 40 },
});
