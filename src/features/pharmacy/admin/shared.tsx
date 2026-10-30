import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { PharmacyShiftStatus } from '../types';

type Tone = ComponentProps<typeof Badge>['tone'];

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDutyDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(`${value}T00:00:00+03:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: 'long',
    weekday: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatClock(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function dutyStatusMeta(status: PharmacyShiftStatus): { label: string; tone: Tone } {
  switch (status) {
    case 'confirmed':
      return { label: 'Doğrulandı', tone: 'success' };
    case 'unverified':
      return { label: 'Doğrulanmadı', tone: 'warning' };
    case 'conflict':
      return { label: 'Kaynak çelişkisi', tone: 'danger' };
    case 'cancelled':
      return { label: 'İptal', tone: 'neutral' };
    default:
      return { label: String(status), tone: 'neutral' };
  }
}

export function reviewStatusMeta(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'visible':
      return { label: 'Yayında', tone: 'success' };
    case 'pending':
      return { label: 'İncelemede', tone: 'warning' };
    case 'hidden':
      return { label: 'Gizlendi', tone: 'danger' };
    default:
      return { label: status, tone: 'neutral' };
  }
}

export function Pill({
  icon,
  label,
  tone = 'neutral',
}: {
  icon?: ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const { theme } = useTheme();
  const palette = {
    neutral: { fg: theme.colors.textSecondary, bg: theme.colors.surfaceMuted },
    success: { fg: theme.colors.success, bg: theme.colors.successSoft },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
    danger: { fg: theme.colors.danger, bg: theme.colors.dangerSoft },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={palette.fg} /> : null}
      <AppText variant="caption" color={palette.fg} style={styles.pillText}>
        {label}
      </AppText>
    </View>
  );
}

export function RowCard({
  title,
  subtitle,
  meta,
  badges,
  actions,
  selected,
  onPress,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const content = (
    <>
      <View style={styles.rowHead}>
        <View style={styles.rowTitle}>{title}</View>
        {badges ? <View style={styles.badgeWrap}>{badges}</View> : null}
      </View>
      {subtitle ? (
        <View style={styles.subtitle}>
          {typeof subtitle === 'string' ? (
            <AppText variant="caption" color="textSecondary">
              {subtitle}
            </AppText>
          ) : (
            subtitle
          )}
        </View>
      ) : null}
      {meta ? <View style={styles.metaRow}>{meta}</View> : null}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        style={[
          styles.row,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
          },
        ]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: theme.colors.surface,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          borderRadius: theme.radius.md,
          borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {content}
    </Pressable>
  );
}

export function EmptyHint({ icon, title, text }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; text?: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.empty, { borderColor: theme.colors.border }]}>
      <Ionicons name={icon} size={20} color={theme.colors.textTertiary} />
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{title}</AppText>
        {text ? (
          <AppText variant="caption" color="textTertiary">
            {text}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export const adminPharmacyStyles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: 10 },
  grid: { gap: 10 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  formRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  grow: { flexGrow: 1, flexBasis: 220 },
  divider: { height: StyleSheet.hairlineWidth, width: '100%' },
  mono: { fontVariant: ['tabular-nums'] },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    padding: 12,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowTitle: { flex: 1, gap: 2 },
  badgeWrap: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  subtitle: { gap: 2 },
  metaRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingTop: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillText: { fontSize: 11, lineHeight: 14 },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
});
