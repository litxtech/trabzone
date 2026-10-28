import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { formatViewCount, spokenViewCount } from '../format';
import type { ViewContentType } from '../types';
import { useContentViewCount } from '../use-content-views';

type Props = {
  type: ViewContentType;
  id: string | null | undefined;
  /** Sunucudan gelen hazır sayaç (akış RPC'leri): ek istek üretmez. */
  initial?: number | null;
  size?: number;
  color?: string;
  /** "tekil görüntüleme" etiketini göster. */
  showLabel?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Premium, kompakt tekil görüntüleme sayacı: 👁 1,2 B
 * Sayaç yoksa (henüz okunmadıysa) yer kaplamaz; böylece kart düzeni zıplamaz.
 */
export function ViewCount({
  type,
  id,
  initial,
  size = 13,
  color,
  showLabel = false,
  label = 'tekil görüntüleme',
  style,
}: Props) {
  const { theme } = useTheme();
  const count = useContentViewCount({ type, id, initial });
  if (count === null) {
    return null;
  }
  const tone = color ?? theme.colors.textTertiary;
  return (
    <View
      style={[styles.root, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={spokenViewCount(count)}
    >
      <Ionicons name="eye-outline" size={size} color={tone} />
      <AppText variant="caption" color={tone} numberOfLines={1}>
        {formatViewCount(count)}
        {showLabel ? ` ${label}` : ''}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
