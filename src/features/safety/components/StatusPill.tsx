import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { ReportPriority, ReportStatusCode, TicketStatusCode } from '../types';
import { PRIORITY_LABEL, REPORT_STATUS, TICKET_STATUS } from '../constants';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

function toneColors(theme: ReturnType<typeof useTheme>['theme'], tone: Tone) {
  switch (tone) {
    case 'success':
      return { background: theme.colors.successSoft, color: theme.colors.success };
    case 'warning':
      return { background: theme.colors.warningSoft, color: theme.colors.warning };
    case 'danger':
      return { background: theme.colors.dangerSoft, color: theme.colors.danger };
    case 'accent':
      return { background: theme.colors.accentSoft, color: theme.colors.accent };
    case 'neutral':
      return { background: theme.colors.surfaceMuted, color: theme.colors.textSecondary };
    default:
      return { background: theme.colors.primarySoft, color: theme.colors.primaryDeep };
  }
}

export function TicketStatusPill({ status }: { status: TicketStatusCode }) {
  const { theme } = useTheme();
  const config = TICKET_STATUS[status] ?? TICKET_STATUS.received;
  const colors = toneColors(theme, config.tone);

  return (
    <View style={[styles.pill, { backgroundColor: colors.background }]}>
      <AppText variant="caption" color={colors.color}>
        {config.label}
      </AppText>
    </View>
  );
}

export function ReportStatusPill({ status }: { status: ReportStatusCode }) {
  const { theme } = useTheme();
  const config = REPORT_STATUS[status] ?? REPORT_STATUS.received;
  const colors = toneColors(theme, config.tone);

  return (
    <View style={[styles.pill, { backgroundColor: colors.background }]}>
      <AppText variant="caption" color={colors.color}>
        {config.label}
      </AppText>
    </View>
  );
}

export function PriorityPill({ priority }: { priority: ReportPriority | string }) {
  const { theme } = useTheme();
  const tone: Tone =
    priority === 'critical' ? 'danger' : priority === 'high' || priority === 'urgent' ? 'warning' : 'neutral';
  const colors = toneColors(theme, tone);

  return (
    <View style={[styles.pill, { backgroundColor: colors.background }]}>
      <AppText variant="caption" color={colors.color}>
        {PRIORITY_LABEL[priority] ?? 'Normal'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
});
