import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { AppText } from './AppText';
import { IconButton } from './IconButton';

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  left?: ReactNode;
};

/** Geri dönüşlü alt ekran başlığı: tüm detay/servis ekranlarında aynı ritim. */
export function ScreenHeader({ title, subtitle, onBack, right, left }: ScreenHeaderProps) {
  const { theme } = useTheme();

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        {left ??
          (onBack ? (
            <IconButton
              name="chevron-back"
              accessibilityLabel="Geri"
              variant="surface"
              size={20}
              onPress={onBack}
            />
          ) : (
            <View style={styles.spacer} />
          ))}
        <View style={styles.titleWrap}>
          <AppText variant="h3" align="center" numberOfLines={1}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" color="textTertiary" align="center" numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right ?? <View style={styles.spacer} />}
      </View>
      <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingTop: 6, paddingBottom: 10, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleWrap: { flex: 1, gap: 1 },
  spacer: { width: 44, height: 44 },
  divider: { height: StyleSheet.hairlineWidth },
});
