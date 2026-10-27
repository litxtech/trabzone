import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr, formatSlaRemaining } from '@/utils/date';

import {
  CHILD_REASON_MAP,
  REPORT_REASONS,
  REPORT_TARGET_ICON,
  REPORT_TARGET_LABEL,
} from '../constants';
import type { ReportSummary } from '../types';
import { ReportStatusPill } from './StatusPill';

type Props = {
  report: ReportSummary;
  onPress?: () => void;
};

export function ReportCard({ report, onPress }: Props) {
  const { theme } = useTheme();
  const reasonLabel = report.is_child_safety
    ? (CHILD_REASON_MAP[report.child_reason_code ?? 'child_other']?.label ?? 'Çocuk güvenliği')
    : (REPORT_REASONS.find((reason) => reason.code === report.reason_code)?.label ?? 'Bildirim');
  const sla = formatSlaRemaining(report.sla_due_at);
  const open = report.status_code === 'received' || report.status_code === 'under_review';

  const content = (
    <View style={styles.wrapper}>
      <View style={styles.topRow}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: report.is_child_safety
                ? theme.colors.dangerSoft
                : theme.colors.primarySoft,
            },
          ]}
        >
          <Ionicons
            name={
              report.is_child_safety
                ? 'shield-half-outline'
                : REPORT_TARGET_ICON[report.target_type]
            }
            size={20}
            color={report.is_child_safety ? theme.colors.danger : theme.colors.primaryDeep}
          />
        </View>
        <View style={styles.titleBlock}>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {reasonLabel}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {report.report_no} · {REPORT_TARGET_LABEL[report.target_type]}
          </AppText>
        </View>
        <ReportStatusPill status={report.status_code} />
      </View>

      {report.resolution_note ? (
        <View
          style={[
            styles.note,
            { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.sm },
          ]}
        >
          <Ionicons name="information-circle-outline" size={14} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex} numberOfLines={3}>
            {report.resolution_note}
          </AppText>
        </View>
      ) : null}

      <View style={styles.bottomRow}>
        <AppText variant="caption" color="textTertiary">
          {formatRelativeTr(report.created_at)}
        </AppText>
        {open && sla ? (
          <AppText
            variant="caption"
            color={sla.expired ? 'danger' : sla.urgent ? 'warning' : 'textTertiary'}
          >
            {sla.label}
          </AppText>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) {
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
          },
          theme.shadows.card,
        ]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${reasonLabel}, ${report.report_no}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          opacity: pressed ? 0.8 : 1,
        },
        theme.shadows.card,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderWidth: StyleSheet.hairlineWidth },
  wrapper: { gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, gap: 3 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 9 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  flex: { flex: 1 },
});
