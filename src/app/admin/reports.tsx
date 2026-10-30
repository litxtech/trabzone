import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { CHILD_REASON_MAP, REPORT_REASONS, REPORT_TARGET_LABEL } from '@/features/safety/constants';
import { useAdminReports } from '@/features/safety/hooks/use-safety';
import type { AdminReport } from '@/features/safety/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr, formatSlaRemaining } from '@/utils/date';

type Queue = 'all' | 'new' | 'critical' | 'unassigned' | 'resolved' | 'child';

const QUEUES: { key: Queue; label: string }[] = [
  { key: 'new', label: 'Yeni' },
  { key: 'critical', label: 'Kritik' },
  { key: 'unassigned', label: 'Atanmamış' },
  { key: 'child', label: 'Çocuk güvenliği' },
  { key: 'resolved', label: 'Sonuçlanan' },
  { key: 'all', label: 'Tümü' },
];

const reasonLabel = (report: AdminReport) =>
  report.is_child_safety
    ? CHILD_REASON_MAP[report.child_reason_code ?? 'child_other']?.label ?? 'Çocuk güvenliği'
    : REPORT_REASONS.find((item) => item.code === report.reason_code)?.label ?? 'Bildirim';

const statusTone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (['resolved', 'action_taken', 'closed'].includes(status)) return 'success';
  if (['dismissed'].includes(status)) return 'neutral';
  if (['under_review', 'received'].includes(status)) return 'warning';
  return 'neutral';
};

const statusLabel = (status: string) => {
  const map: Record<string, string> = {
    received: 'Alındı',
    under_review: 'İnceleniyor',
    action_taken: 'İşlem yapıldı',
    resolved: 'Çözüldü',
    dismissed: 'Reddedildi',
    closed: 'Kapandı',
  };
  return map[status] ?? status;
};

export default function AdminReportsQueueScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [queue, setQueue] = useState<Queue>('new');
  const reportsQuery = useAdminReports({ queue });

  const reports = useMemo(() => reportsQuery.data?.items ?? [], [reportsQuery.data]);
  const stats = useMemo(() => {
    const critical = reports.filter((report) => report.priority === 'critical').length;
    const child = reports.filter((report) => report.is_child_safety).length;
    const overdue = reports.filter((report) => report.overdue).length;
    const unassigned = reports.filter((report) => !report.assigned_to).length;
    return { critical, child, overdue, unassigned };
  }, [reports]);

  const columns: Column<AdminReport>[] = [
    {
      key: 'report',
      label: 'Şikâyet',
      width: 1.7,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <View style={styles.rowWrap}>
            <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
              {reasonLabel(row)}
            </AppText>
            {row.is_child_safety ? <Badge label="Çocuk güvenliği" tone="danger" /> : null}
          </View>
          <AppText variant="caption" color="textTertiary" style={{ fontFamily: 'monospace' }} numberOfLines={1}>
            {row.report_no}
          </AppText>
        </View>
      ),
    },
    {
      key: 'target',
      label: 'Hedef',
      width: 1.1,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <Badge label={REPORT_TARGET_LABEL[row.target_type] ?? row.target_type} tone="neutral" />
          <AppText variant="caption" color="textTertiary" style={{ fontFamily: 'monospace' }} numberOfLines={1}>
            {row.target_id}
          </AppText>
        </View>
      ),
    },
    {
      key: 'reporter',
      label: 'Şikâyet eden',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary" style={{ fontFamily: 'monospace' }}>
          #{row.reporter_ref}
        </AppText>
      ),
    },
    {
      key: 'priority',
      label: 'Öncelik',
      width: 0.8,
      render: (row) => (
        <Badge
          label={row.priority === 'critical' ? 'Kritik' : row.priority === 'high' ? 'Yüksek' : 'Normal'}
          tone={row.priority === 'critical' ? 'danger' : row.priority === 'high' ? 'warning' : 'neutral'}
        />
      ),
    },
    {
      key: 'status',
      label: 'Durum',
      width: 0.9,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <Badge label={statusLabel(row.status_code)} tone={statusTone(row.status_code)} />
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {row.assigned_to ? row.assignee_name ?? 'Atanmış' : 'Atanmamış'}
          </AppText>
        </View>
      ),
    },
    {
      key: 'sla',
      label: 'SLA',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => {
        const sla = formatSlaRemaining(row.sla_due_at);
        return (
          <View style={{ gap: 2 }}>
            <AppText
              variant="caption"
              color={sla?.expired ? 'danger' : sla?.urgent ? 'warning' : 'textSecondary'}
            >
              {sla?.label ?? 'Süre yok'}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {formatRelativeTr(row.created_at)}
            </AppText>
          </View>
        );
      },
    },
    {
      key: 'action',
      label: '',
      width: 0.7,
      render: (row) => (
        <Button
          label="İncele"
          size="sm"
          variant="secondary"
          fullWidth={false}
          onPress={() => router.push(`/admin/report/${row.id}`)}
        />
      ),
    },
  ];

  return (
    <AdminPage
      title="Şikâyet ve Moderasyon"
      subtitle="Birleşik şikâyet kuyruğu. Çocuk güvenliği ve acil bildirimler önceliklidir."
      refreshing={reportsQuery.isRefetching}
      onRefresh={() => void reportsQuery.refetch()}
      actions={
        <Button
          label="Çocuk güvenliği"
          size="sm"
          variant="danger"
          fullWidth={false}
          leftIcon={<Ionicons name="shield-half-outline" size={15} color="#FFFFFF" />}
          onPress={() => router.push('/admin/child-safety')}
        />
      }
    >
      <StatGrid>
        <StatCard label="Kuyruk toplamı" value={String(reportsQuery.data?.total ?? 0)} icon="flag-outline" hint="Seçili kuyruk" />
        <StatCard label="Kritik" value={String(stats.critical)} icon="alert-circle-outline" tone={stats.critical ? 'danger' : 'success'} hint="Öncelikli inceleme" />
        <StatCard label="Çocuk güvenliği" value={String(stats.child)} icon="shield-half-outline" tone={stats.child ? 'danger' : 'success'} hint="30 dk / 4 sa SLA" />
        <StatCard label="Gecikmiş" value={String(stats.overdue)} icon="time-outline" tone={stats.overdue ? 'warning' : 'success'} hint={`${stats.unassigned} atanmamış`} />
      </StatGrid>

      <AdminSection
        title="Moderasyon kuyruğu"
        subtitle="Standart bildirimlerde inceleme hedefi 24 saat, kritik çocuk güvenliği bildirimlerinde 30 dakikadır."
        action={<Badge label={`${reports.length} kayıt`} tone="primary" />}
      >
        <FilterChips options={QUEUES} value={queue} onChange={setQueue} />
        <DataTable
          columns={columns}
          rows={reports}
          keyExtractor={(row) => row.id}
          loading={reportsQuery.isLoading}
          empty={
            <View style={styles.empty}>
              <Ionicons
                name={reportsQuery.isError ? 'cloud-offline-outline' : 'checkmark-done-outline'}
                size={22}
                color={reportsQuery.isError ? theme.colors.danger : theme.colors.success}
              />
              <AppText variant="caption" color="textSecondary">
                {reportsQuery.isError
                  ? 'Kuyruk yüklenemedi. Yetkin olduğundan emin ol ve tekrar dene.'
                  : 'Bu kuyrukta bekleyen bildirim yok.'}
              </AppText>
            </View>
          }
        />
      </AdminSection>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 30 },
});
