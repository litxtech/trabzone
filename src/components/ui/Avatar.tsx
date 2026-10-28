import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { AppImage } from './AppImage';
import { AppText } from './AppText';

export type AvatarProps = {
  uri?: string | null;
  name?: string | null;
  size?: number;
  ring?: boolean;
  borderColor?: string;
  /** Liste geri dönüşümünde eski avatarn görünmesini engeller (ör. kullanıcı id). */
  recycleKey?: string | null;
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

export function Avatar({ uri, name, size = 44, ring = false, borderColor, recycleKey }: AvatarProps) {
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
        <AppImage
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: radius }}
          contentFit="cover"
          recycleKey={recycleKey ?? uri}
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
