import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, TextField } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { SafetyEmptyState } from '@/features/safety/components/SafetyEmptyState';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { SafetySheet } from '@/features/safety/components/SafetySheet';
import { PriorityPill, ReportStatusPill } from '@/features/safety/components/StatusPill';
import { CHILD_REASON_MAP } from '@/features/safety/constants';
import { useChildSafetyQueue } from '@/features/safety/hooks/use-safety';
import {
  useAdminAssignChildCase,
  useAdminResolveChildCase,
} from '@/features/safety/hooks/use-safety-mutations';
import type { ChildSafetyIncident } from '@/features/safety/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatRelativeTr, formatSlaRemaining } from '@/utils/date';
import { haptics } from '@/utils/haptics';

export default function ChildSafetyQueueScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useChildSafetyQueue();

  const assign = useAdminAssignChildCase();
  const resolve = useAdminResolveChildCase();

  const [selected, setSelected] = useState<ChildSafetyIncident | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const incidents = data?.incidents ?? [];
  const reports = data?.reports ?? [];

  const submit = (status: 'investigating' | 'resolved' | 'closed') => {
    if (!selected) {
      return;
    }
    setError(null);
    resolve.mutate(
      { caseId: selected.id, status, note: note.trim() || undefined },
      {
        onSuccess: () => {
          haptics.success();
          setSelected(null);
          setNote('');
        },
        onError: (resolveError) => {
          haptics.error();
          setError(resolveError.message);
        },
      },
    );
  };

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <SafetyHeader
        title="Çocuk güvenliği"
        subtitle={`${incidents.length} açık olay · ${data?.critical_count ?? 0} kritik bildirim`}
        onBack={() => router.replace('/admin')}
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

      <Card tone="muted" elevated={false} style={styles.procedure}>
        <AppText variant="bodyStrong" color="danger">
          Uygulama prosedürü
        </AppText>
        <ProcedureStep index={1} text="Kritik bildirimleri 30 dakika içinde incelemeye al." />
        <ProcedureStep index={2} text="Görsel içerikleri bulanık önizlemeden aç; erişim kaydı otomatik tutulur." />
        <ProcedureStep index={3} text="Kanıtı indirmeden, yalnızca platform içi önizleme ile değerlendir." />
        <ProcedureStep index={4} text="Doğrulanan istismar içeriğini kaldır ve hesabı kısıtla." />
        <ProcedureStep index={5} text="Hayati tehlike varsa yerel acil servis ve yetkili kurumlarla iletişime geç." />
        <ProcedureStep index={6} text="Bildirene kimlik bilgisi paylaşmadan gizli sonuç bildirimi gönder." />
      </Card>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : isError ? (
        <SafetyEmptyState
          icon="lock-closed-outline"
          title="Kuyruk görüntülenemedi"
          body="Bu alan için `safety.child.view` yetkisi gerekir."
          actionLabel="Tekrar dene"
          onAction={() => void refetch()}
        />
      ) : incidents.length === 0 && reports.length === 0 ? (
        <SafetyEmptyState
          icon="shield-checkmark-outline"
          title="Bekleyen çocuk güvenliği bildirimi yok"
          body="Yeni bir bildirim geldiğinde bu kuyrukta öncelik sırasına göre listelenir."
        />
      ) : (
        <>
          {incidents.length > 0 ? (
            <View style={styles.section}>
              <AppText variant="h3">Olay kayıtları</AppText>
              <View style={styles.list}>
                {incidents.map((incident) => {
                  const critical = incident.severity === 'critical';
                  return (
                    <Pressable
                      key={incident.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${incident.case_ref} olayını incele`}
                      onPress={() => {
                        setSelected(incident);
                        setNote('');
                        setError(null);
                      }}
                      style={({ pressed }) => [
                        styles.incident,
                        {
                          backgroundColor: critical
                            ? theme.colors.dangerSoft
                            : theme.colors.surface,
                          borderColor: critical ? theme.colors.danger : theme.colors.border,
                          borderRadius: theme.radius.md,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <View style={styles.incidentHead}>
                        <View
                          style={[
                            styles.incidentIcon,
                            {
                              backgroundColor: critical
                                ? theme.colors.surface
                                : theme.colors.primarySoft,
                            },
                          ]}
                        >
                          <Ionicons
                            name={critical ? 'alert-circle' : 'shield-half-outline'}
                            size={18}
                            color={critical ? theme.colors.danger : theme.colors.primaryDeep}
                          />
                        </View>
                        <View style={styles.flex}>
                          <AppText variant="bodyStrong" numberOfLines={1}>
                            {CHILD_REASON_MAP[incident.category as keyof typeof CHILD_REASON_MAP]?.label ??
                              'Çocuk güvenliği olayı'}
                          </AppText>
                          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                            {incident.case_ref} · {formatRelativeTr(incident.created_at)}
                          </AppText>
                        </View>
                        <Badge
                          label={critical ? 'Kritik' : 'Yüksek'}
                          tone={critical ? 'danger' : 'warning'}
                        />
                      </View>

                      <View style={styles.incidentFoot}>
                        <AppText variant="caption" color="textSecondary">
                          Durum: {incident.status === 'open' ? 'Açık' : 'İnceleniyor'}
                          {incident.assigned_admin_id ? ' · atanmış' : ' · atanmamış'}
                        </AppText>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Olayı bana ata"
                          onPress={() =>
                            assign.mutate(
                              { caseId: incident.id },
                              {
                                onSuccess: () => haptics.success(),
                                onError: (assignError) => setError(assignError.message),
                              },
                            )
                          }
                          style={[
                            styles.assignButton,
                            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                          ]}
                        >
                          <Ionicons name="person-add-outline" size={13} color={theme.colors.primaryDeep} />
                          <AppText variant="caption" color="primaryDeep">
                            Bana ata
                          </AppText>
                        </Pressable>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {reports.length > 0 ? (
            <View style={styles.section}>
              <AppText variant="h3">Bildirimler</AppText>
              <View style={styles.list}>
                {reports.map((report) => {
                  const sla = formatSlaRemaining(report.sla_due_at);
                  return (
                    <Pressable
                      key={report.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${report.report_no} bildirimini aç`}
                      onPress={() => router.push(`/admin/report/${report.id}`)}
                      style={({ pressed }) => [
                        styles.report,
                        {
                          backgroundColor: theme.colors.surface,
                          borderColor:
                            report.priority === 'critical' ? theme.colors.danger : theme.colors.border,
                          borderRadius: theme.radius.md,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <View style={styles.incidentHead}>
                        <View
                          style={[styles.incidentIcon, { backgroundColor: theme.colors.dangerSoft }]}
                        >
                          <Ionicons name="flag-outline" size={17} color={theme.colors.danger} />
                        </View>
                        <View style={styles.flex}>
                          <AppText variant="bodyStrong" numberOfLines={1}>
                            {CHILD_REASON_MAP[
                              report.child_reason_code as keyof typeof CHILD_REASON_MAP
                            ]?.label ?? 'Çocuk güvenliği'}
                          </AppText>
                          <AppText variant="caption" color="textTertiary">
                            {report.report_no} · {formatDateTimeTr(report.created_at)}
                          </AppText>
                        </View>
                        <ReportStatusPill status={report.status_code} />
                      </View>
                      <View style={styles.incidentFoot}>
                        <PriorityPill priority={report.priority} />
                        {sla ? (
                          <AppText
                            variant="caption"
                            color={sla.expired ? 'danger' : sla.urgent ? 'warning' : 'textTertiary'}
                          >
                            SLA: {sla.label}
                          </AppText>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </>
      )}

      <Card tone="muted" elevated={false} style={styles.footerNote}>
        <Ionicons name="lock-closed-outline" size={15} color={theme.colors.textSecondary} />
        <AppText variant="caption" color="textSecondary" style={styles.flex}>
          Bu kuyruktaki her görüntüleme ve işlem denetim kaydına yazılır. Bildiren kişinin kimliği,
          bildirilen tarafa veya üçüncü kişilere açıklanmaz.
        </AppText>
      </Card>

      <SafetySheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.case_ref ?? 'Olay'}
        subtitle="Olay durumunu güncelle"
        footer={
          <>
            <Button
              label="İncelemeye al"
              variant="secondary"
              loading={resolve.isPending}
              onPress={() => submit('investigating')}
            />
            <Button label="Çözüldü olarak kapat" loading={resolve.isPending} onPress={() => submit('resolved')} />
          </>
        }
      >
        <TextField
          label="İç not"
          placeholder="İnceleme ayrıntıları, yasal süreç, kurum bildirimi…"
          value={note}
          onChangeText={setNote}
          multiline
          numberOfLines={4}
          maxLength={2000}
          textAlignVertical="top"
          hint="Bu not yalnızca yetkili ekip tarafından görülür."
        />
        {error ? (
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        ) : null}
      </SafetySheet>
    </Screen>
  );
}

function ProcedureStep({ index, text }: { index: number; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.procedureRow}>
      <View style={[styles.procedureDot, { backgroundColor: theme.colors.danger }]}>
        <AppText variant="caption" color="#FFFFFF">
          {index}
        </AppText>
      </View>
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  refresh: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  procedure: { gap: 7, padding: 14 },
  procedureRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  procedureDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  section: { gap: 9, marginTop: 16 },
  list: { gap: 9 },
  incident: { padding: 12, gap: 9, borderWidth: 1 },
  incidentHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  incidentIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  incidentFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  assignButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  report: { padding: 12, gap: 8, borderWidth: 1 },
  center: { alignItems: 'center', paddingVertical: 40 },
  footerNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 18, padding: 12 },
});
