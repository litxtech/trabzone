import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { SafetyEmptyState } from '@/features/safety/components/SafetyEmptyState';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { ReportStatusPill } from '@/features/safety/components/StatusPill';
import { CHILD_REASON_MAP, REPORT_REASONS, REPORT_TARGET_LABEL } from '@/features/safety/constants';
import { useAdminReports } from '@/features/safety/hooks/use-safety';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr, formatSlaRemaining } from '@/utils/date';

type Queue = 'all' | 'new' | 'critical' | 'unassigned' | 'resolved';

const QUEUES: { key: Queue; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'new', label: 'Yeni' },
  { key: 'critical', label: 'Kritik' },
  { key: 'unassigned', label: 'Atanmamış' },
  { key: 'resolved', label: 'Sonuçlanan' },
];

export default function AdminReportsQueueScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [queue, setQueue] = useState<Queue>('new');

  const { data, isLoading, isError, refetch, isRefetching } = useAdminReports({ queue });

  const reports = data?.items ?? [];
  const overdue = reports.filter((report) => report.overdue).length;
  const critical = reports.filter((report) => report.priority === 'critical').length;

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <SafetyHeader
        title="Bildirim moderasyonu"
        subtitle={`${data?.total ?? 0} kayıt${critical > 0 ? ` · ${critical} kritik` : ''}${
          overdue > 0 ? ` · ${overdue} gecikmiş` : ''
        }`}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yenile"
            onPress={() => void refetch()}
            style={styles.refresh}
          >
            {isRefetching ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Ionicons name="refresh-outline" size={19} color={theme.colors.textSecondary} />
            )}
          </Pressable>
        }
      />

      <View style={styles.queues}>
        {QUEUES.map((item) => {
          const active = queue === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setQueue(item.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                  borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <Card tone="muted" elevated={false} style={styles.slaCard}>
        <View style={styles.slaRow}>
          <Ionicons name="time-outline" size={15} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Standart bildirimlerde inceleme hedefi 24 saat, çocuk güvenliği bildirimlerinde 30
            dakikadır (kritik) veya 4 saattir.
          </AppText>
        </View>
      </Card>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : isError ? (
        <SafetyEmptyState
          icon="cloud-offline-outline"
          title="Kuyruk yüklenemedi"
          body="Yetkin olduğundan emin ol ve tekrar dene."
          actionLabel="Tekrar dene"
          onAction={() => void refetch()}
        />
      ) : reports.length === 0 ? (
        <SafetyEmptyState
          icon="checkmark-done-outline"
          title="Bu kuyrukta bildirim yok"
          body="Yeni bildirimler geldiğinde burada görünecek."
        />
      ) : (
        <View style={styles.list}>
          {reports.map((report) => {
            const sla = formatSlaRemaining(report.sla_due_at);
            const reason = report.is_child_safety
              ? CHILD_REASON_MAP[report.child_reason_code ?? 'child_other']?.label
              : (REPORT_REASONS.find((item) => item.code === report.reason_code)?.label ?? 'Bildirim');
            return (
              <Pressable
                key={report.id}
                accessibilityRole="button"
                accessibilityLabel={`${report.report_no} ${reason ?? ''}`}
                onPress={() => router.push(`/admin/report/${report.id}`)}
                style={({ pressed }) => [
                  styles.report,
                  {
                    backgroundColor: report.is_child_safety
                      ? theme.colors.dangerSoft
                      : theme.colors.surface,
                    borderColor: report.overdue
                      ? theme.colors.danger
                      : report.is_child_safety
                        ? theme.colors.danger
                        : theme.colors.border,
                    borderRadius: theme.radius.md,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={styles.reportHead}>
                  <View
                    style={[
                      styles.reportIcon,
                      {
                        backgroundColor: theme.colors.surface,
                      },
                    ]}
                  >
                    <Ionicons
                      name={report.is_child_safety ? 'shield-half-outline' : 'flag-outline'}
                      size={17}
                      color={report.is_child_safety ? theme.colors.danger : theme.colors.primaryDeep}
                    />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {reason}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {report.report_no} · {REPORT_TARGET_LABEL[report.target_type]} ·{' '}
                      {formatRelativeTr(report.created_at)}
                    </AppText>
                  </View>
                  <ReportStatusPill status={report.status_code} />
                </View>

                <View style={styles.reportFoot}>
                  <View style={styles.badgeRow}>
                    {report.priority === 'critical' ? (
                      <Badge label="Kritik" tone="danger" />
                    ) : report.priority === 'high' ? (
                      <Badge label="Yüksek" tone="warning" />
                    ) : (
                      <Badge label="Normal" tone="neutral" />
                    )}
                    {report.assignee_name ? (
                      <Badge label={report.assignee_name} tone="neutral" />
                    ) : (
                      <Badge label="Atanmamış" tone="neutral" />
                    )}
                    <Badge label={`#${report.reporter_ref}`} tone="neutral" />
                  </View>
                  {sla ? (
                    <AppText
                      variant="caption"
                      color={sla.expired ? 'danger' : sla.urgent ? 'warning' : 'textTertiary'}
                    >
                      {sla.label}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  refresh: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  queues: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  slaCard: { marginTop: 12, padding: 12 },
  slaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  list: { gap: 9, marginTop: 14 },
  report: { padding: 12, gap: 8, borderWidth: 1 },
  reportHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reportIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  reportFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, flex: 1 },
  center: { alignItems: 'center', paddingVertical: 40 },
});
