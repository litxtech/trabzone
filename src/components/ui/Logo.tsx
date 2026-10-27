import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { AppText } from './AppText';

export function Logo({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={require('../../../assets/brand/splash/splash-logo.png')}
      style={{ width: size, height: size, borderRadius: size * 0.2237 }}
      contentFit="cover"
      transition={0}
      accessibilityLabel="Trabzone"
    />
  );
}

export function Wordmark({
  color,
  size = 22,
  showTagline = false,
}: {
  color?: string;
  size?: number;
  showTagline?: boolean;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <AppText
        variant="display"
        color={color ?? theme.colors.text}
        style={{ fontSize: size, lineHeight: size * 1.15, letterSpacing: size * 0.14 }}
        accessibilityRole="header"
      >
        TRABZONE
      </AppText>
      {showTagline ? (
        <AppText variant="caption" color={color ?? theme.colors.textSecondary} align="center">
          Trabzon&apos;un dijital buluşma noktası
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 6,
  },
});
