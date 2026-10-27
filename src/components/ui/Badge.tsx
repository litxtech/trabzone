import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { AppText } from './AppText';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

export function Badge({
  label,
  tone = 'primary',
  style,
}: {
  label: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();

  const tones: Record<Tone, { background: string; color: string }> = {
    primary: { background: theme.colors.primarySoft, color: theme.colors.primaryDeep },
    success: { background: theme.colors.successSoft, color: theme.colors.success },
    warning: { background: theme.colors.warningSoft, color: theme.colors.warning },
    danger: { background: theme.colors.dangerSoft, color: theme.colors.danger },
    neutral: { background: theme.colors.surfaceMuted, color: theme.colors.textSecondary },
    accent: { background: theme.colors.accentSoft, color: theme.colors.accent },
  };

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tones[tone].background, borderRadius: theme.radius.pill },
        style,
      ]}
    >
      <AppText variant="caption" color={tones[tone].color} style={{ fontFamily: theme.typography.caption.fontFamily }}>
        {label}
      </AppText>
    </View>
  );
}

export function Dot({ tone = 'danger', size = 8 }: { tone?: Tone; size?: number }) {
  const { theme } = useTheme();
  const color =
    tone === 'danger'
      ? theme.colors.danger
      : tone === 'success'
        ? theme.colors.success
        : theme.colors.primary;

  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
});
