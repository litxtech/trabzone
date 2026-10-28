import { useEffect } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/perf/use-reduce-motion';
import { useTheme } from '@/theme/ThemeProvider';

export type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: object;
};

export function Skeleton({ width = '100%', height = 14, radius, style }: SkeletonProps) {
  const { theme } = useTheme();
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      // Animasyon kapali: parlaklik sabit kalir, sonsuz dongu calismaz.
      progress.value = 1;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0.55, 1]),
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radius.xs,
          backgroundColor: theme.colors.skeleton,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

export function SkeletonBlock({ lines = 3, style }: { lines?: number; style?: object }) {
  return (
    <View style={[{ gap: 10 }, style]}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? '62%' : '100%'} height={12} />
      ))}
    </View>
  );
}
