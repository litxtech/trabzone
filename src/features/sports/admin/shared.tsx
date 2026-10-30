import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { SportsAuthor } from '../types';

export const HEALTH: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  unknown: { label: 'Bilinmiyor', tone: 'neutral' },
  unconfigured: { label: 'Yapılandırılmadı', tone: 'warning' },
  healthy: { label: 'Sağlıklı', tone: 'success' },
  degraded: { label: 'Sorunlu', tone: 'warning' },
  down: { label: 'Erişilemiyor', tone: 'danger' },
  quota: { label: 'Kota doldu', tone: 'danger' },
};

export const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  completed: 'success',
  sent: 'success',
  visible: 'success',
  active: 'success',
  open: 'warning',
  pending: 'warning',
  fanning_out: 'warning',
  skipped: 'neutral',
  cancelled: 'neutral',
  dismissed: 'neutral',
  closed: 'neutral',
  draft: 'neutral',
  hidden: 'danger',
  removed: 'danger',
  retracted: 'danger',
  disabled: 'danger',
  error: 'danger',
  failed: 'danger',
  quota: 'danger',
};

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(date);
}

export function authorLabel(author: SportsAuthor | null | undefined): string {
  if (!author) return 'Sistem';
  return `@${author.username}`;
}

export function Tile({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'danger' | 'success' | 'warning'; hint?: string }) {
  const { theme } = useTheme();
  const color = tone ? theme.colors[tone] : theme.colors.text;
  return (
    <View style={[styles.tile, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      {typeof value === 'string' || typeof value === 'number' ? (
        <AppText variant="h3" style={{ color }} selectable>
          {value}
        </AppText>
      ) : (
        value
      )}
      {hint ? (
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge label={status} tone={STATUS_TONE[status] ?? 'neutral'} />;
}

export function ListRow({
  children,
  onPress,
  selected,
}: {
  children: ReactNode;
  onPress?: () => void;
  selected?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.row,
        {
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return (
    <AppText variant="caption" color="textTertiary">
      {children}
    </AppText>
  );
}

export const sharedStyles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 10 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { minWidth: 150, flexGrow: 1, flexBasis: 150, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12, gap: 4 },
  row: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10, gap: 6 },
});
