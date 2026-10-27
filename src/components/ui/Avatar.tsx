import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { AppText } from './AppText';

export type AvatarProps = {
  uri?: string | null;
  name?: string | null;
  size?: number;
  ring?: boolean;
  borderColor?: string;
};

const initialsOf = (name?: string | null) => {
  if (!name) {
    return '';
  }
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR'))
    .join('');
};

export function Avatar({ uri, name, size = 44, ring = false, borderColor }: AvatarProps) {
  const { theme } = useTheme();
  const radius = size / 2;

  return (
    <View
      style={[
        styles.container,
        {
          width: size + (ring ? 6 : 0),
          height: size + (ring ? 6 : 0),
          borderRadius: radius + (ring ? 3 : 0),
          borderWidth: ring ? 2 : 0,
          borderColor: borderColor ?? theme.colors.primary,
          backgroundColor: theme.colors.surfaceMuted,
          padding: ring ? 2 : 0,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: radius }}
          contentFit="cover"
          transition={180}
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          style={[
            styles.fallback,
            { width: size, height: size, borderRadius: radius, backgroundColor: theme.colors.primarySoft },
          ]}
        >
          <AppText
            variant="bodyStrong"
            color="primaryDeep"
            style={{ fontSize: Math.max(11, size * 0.34) }}
          >
            {initialsOf(name) || '?'}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
