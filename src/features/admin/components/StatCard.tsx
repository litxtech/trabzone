import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export function StatCard({
  label,
  value,
  delta,
  icon,
  hint,
  tone = 'primary',
  footer,
}: {
  label: string;
  value: string;
  delta?: number | null;
  icon?: ComponentProps<typeof Ionicons>['name'];
  hint?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'accent';
  footer?: ReactNode;
}) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 640;

  const palette = {
    primary: { fg: theme.colors.primary, soft: theme.colors.primarySoft },
    success: { fg: theme.colors.success, soft: theme.colors.successSoft },
    warning: { fg: theme.colors.warning, soft: theme.colors.warningSoft },
    danger: { fg: theme.colors.danger, soft: theme.colors.dangerSoft },
    accent: { fg: theme.colors.accent, soft: theme.colors.accentSoft },
  }[tone];

  const deltaTone = delta == null ? 'textTertiary' : delta >= 0 ? 'success' : 'danger';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          padding: compact ? 12 : 15,
          minWidth: compact ? '46%' : 170,
          flexGrow: 1,
          flexBasis: compact ? '46%' : 190,
        },
      ]}
    >
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: palette.soft }]}>
          {icon ? <Ionicons name={icon} size={16} color={palette.fg} /> : null}
        </View>
        {delta != null ? (
          <View
            style={[
              styles.delta,
              {
                backgroundColor: delta >= 0 ? theme.colors.successSoft : theme.colors.dangerSoft,
              },
            ]}
          >
            <Ionicons
              name={delta >= 0 ? 'trending-up' : 'trending-down'}
              size={12}
              color={delta >= 0 ? theme.colors.success : theme.colors.danger}
            />
            <AppText variant="caption" color={deltaTone} style={styles.deltaText}>
              {delta > 0 ? '+' : ''}
              {delta.toFixed(1)}%
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant={compact ? 'h2' : 'h1'} numberOfLines={1} style={styles.value}>
        {value}
      </AppText>
      <AppText variant="caption" color="textSecondary" numberOfLines={2}>
        {label}
      </AppText>
      {hint ? (
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {hint}
        </AppText>
      ) : null}
      {footer}
    </View>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  icon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  delta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  deltaText: { fontSize: 11, lineHeight: 14 },
  value: { marginTop: 3 },
});
