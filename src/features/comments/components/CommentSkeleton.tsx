import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';

/** Yükleme sırasında içerik yüksekliğini taklit eden hafif iskelet. */
export function CommentSkeleton({ rows = 5 }: { rows?: number }) {
  const { theme } = useTheme();
  const pulse = useSharedValue(0.45);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 720 }), -1, true);
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const block = (width: number | `${number}%`, height: number) => (
    <View
      style={{
        width,
        height,
        borderRadius: 6,
        backgroundColor: theme.colors.surfaceMuted,
      }}
    />
  );

  return (
    <Animated.View style={[styles.wrap, style]} accessibilityLabel="Yorumlar yükleniyor">
      {Array.from({ length: rows }).map((_, index) => (
        <View key={index} style={styles.row}>
          <View
            style={[styles.avatar, { backgroundColor: theme.colors.surfaceMuted }]}
          />
          <View style={styles.main}>
            <View style={styles.header}>
              {block(index % 2 === 0 ? 96 : 74, 10)}
              {block(34, 8)}
            </View>
            {block(index % 3 === 0 ? '58%' : '88%', 9)}
            {block('34%', 8)}
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 4 },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  main: { flex: 1, gap: 7, paddingTop: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
