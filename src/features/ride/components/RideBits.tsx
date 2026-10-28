import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Card } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  LEVEL_LABEL,
  LEVEL_TONE,
  OFFER_STATUS_LABEL,
  RESERVATION_STATUS_LABEL,
  STATUS_TONE,
  preferenceLabels,
} from '../utils/format';
import type { RideLevel } from '../types';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function RideStat({
  icon,
  value,
  label,
  tone,
}: {
  icon: IconName;
  value: string | number;
  label: string;
  tone?: 'primary' | 'accent' | 'success' | 'danger';
}) {
  const { theme } = useTheme();
  const color =
    tone === 'accent'
      ? theme.colors.accent
      : tone === 'success'
        ? theme.colors.success
        : tone === 'danger'
          ? theme.colors.danger
          : theme.colors.primaryDeep;
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={14} color={color} />
      <AppText variant="bodyStrong" style={{ color }}>
        {value}
      </AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

export function RideSection({
  title,
  subtitle,
  action,
  children,
  bare = false,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  /** Zaten bir Card içinde kullanılıyorsa ikinci kart çerçevesini kaldırır. */
  bare?: boolean;
}) {
  const body = (
    <>
      <View style={styles.sectionHead}>
        <View style={styles.flex}>
          <AppText variant="title">{title}</AppText>
          {subtitle ? (
            <AppText variant="caption" color="textTertiary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </>
  );

  if (bare) {
    return <View style={styles.section}>{body}</View>;
  }

  return (
    <Card padding={16} style={styles.section}>
      {body}
    </Card>
  );
}

export function RideActionTile({
  icon,
  title,
  subtitle,
  onPress,
  tone = 'surface',
  badge,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  tone?: 'surface' | 'primary' | 'accent';
  badge?: string;
}) {
  const { theme } = useTheme();
  const accent = tone === 'primary' ? theme.colors.primary : tone === 'accent' ? theme.colors.accent : theme.colors.primaryDeep;
  const background =
    tone === 'primary' ? theme.colors.primarySoft : tone === 'accent' ? theme.colors.accentSoft : theme.colors.surface;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: background,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name={icon} size={19} color={accent} />
      </View>
      <View style={styles.flex}>
        <View style={styles.tileTitleRow}>
          <AppText variant="label" numberOfLines={1}>
            {title}
          </AppText>
          {badge ? <Badge label={badge} tone="accent" /> : null}
        </View>
        {subtitle ? (
          <AppText variant="caption" color="textTertiary" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

export function RideEmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.empty, { borderColor: theme.colors.border }]}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={24} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="h3" align="center">
        {title}
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        {message}
      </AppText>
      {action}
    </View>
  );
}

export function StatusPill({ status }: { status: string }) {
  const label = OFFER_STATUS_LABEL[status as keyof typeof OFFER_STATUS_LABEL] ??
    RESERVATION_STATUS_LABEL[status as keyof typeof RESERVATION_STATUS_LABEL] ?? status;
  return <Badge label={label} tone={STATUS_TONE[status] ?? 'neutral'} />;
}

export function LevelBadge({ level }: { level: RideLevel | null | undefined }) {
  if (!level) {
    return null;
  }
  return <Badge label={LEVEL_LABEL[level]} tone={LEVEL_TONE[level]} />;
}

export function PreferenceChips({ preferences }: { preferences: Record<string, unknown> | null | undefined }) {
  const { theme } = useTheme();
  const labels = preferenceLabels(preferences);
  if (labels.length === 0) {
    return null;
  }
  return (
    <View style={styles.chips}>
      {labels.map((label) => (
        <View
          key={label}
          style={[styles.chip, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}
        >
          <AppText variant="caption" color="textSecondary">
            {label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

export function RouteLineText({ origin, dest }: { origin: string; dest: string }) {
  return (
    <View style={styles.routeLine}>
      <View style={[styles.routeDot, { backgroundColor: '#3DD68C' }]} />
      <AppText variant="label" numberOfLines={1} style={styles.routeText}>
        {origin}
      </AppText>
      <Ionicons name="arrow-forward" size={13} color="#7482A0" />
      <View style={[styles.routeDot, { backgroundColor: '#4169F5' }]} />
      <AppText variant="label" numberOfLines={1} style={styles.routeText}>
        {dest}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stat: { alignItems: 'center', gap: 1, minWidth: 58 },
  section: { gap: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 28,
    paddingHorizontal: 18,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  routeLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  routeDot: { width: 7, height: 7, borderRadius: 4 },
  routeText: { flexShrink: 1, maxWidth: '40%' },
});
