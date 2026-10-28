import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, TextField } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { SafetyEmptyState } from '@/features/safety/components/SafetyEmptyState';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { SafetySheet } from '@/features/safety/components/SafetySheet';
import { PriorityPill, ReportStatusPill } from '@/features/safety/components/StatusPill';
import { CHILD_REASON_MAP, REPORT_REASONS, REPORT_TARGET_LABEL } from '@/features/safety/constants';
import { useAdminReport } from '@/features/safety/hooks/use-safety';
import {
  useAdminAssignReport,
  useAdminReportAction,
} from '@/features/safety/hooks/use-safety-mutations';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatRelativeTr, formatSlaRemaining } from '@/utils/date';
import { toMessage } from '@/utils/error-message';
import { haptics } from '@/utils/haptics';

type ActionKind = 'resolve' | 'dismiss' | 'apply_action';

const CONTENT_ACTIONS = [
  { key: 'content_removed', label: 'İçeriği kaldır' },
  { key: 'content_limited', label: 'Görünürlüğü kısıtla' },
  { key: 'account_warned', label: 'Hesabı uyar' },
  { key: 'account_restricted', label: 'Hesabı kısıtla' },
  { key: 'account_suspended', label: 'Hesabı askıya al' },
  { key: 'no_violation', label: 'İhlal yok' },
];

export default function AdminReportDetailScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ reportId?: string }>();
  const reportId = typeof params.reportId === 'string' ? params.reportId : '';

  const { data: report, isLoading, isError, refetch } = useAdminReport(reportId);
  const action = useAdminReportAction();
  const assign = useAdminAssignReport();

  const [sheet, setSheet] = useState<ActionKind | null>(null);
  const [noteInternal, setNoteInternal] = useState('');
  const [notePublic, setNotePublic] = useState('');
  const [contentAction, setContentAction] = useState<string>('content_removed');
  const [error, setError] = useState<string | null>(null);

  const submit = async (kind: ActionKind) => {
    setError(null);
    try {
      await action.mutateAsync({
        reportId,
        action: kind,
        noteInternal: noteInternal.trim() || undefined,
        notePublic: notePublic.trim() || undefined,
        contentAction,
      });
      haptics.success();
      setSheet(null);
      setNoteInternal('');
      setNotePublic('');
    } catch (submitError) {
      haptics.error();
      setError(toMessage(submitError, 'İşlem uygulanamadı.'));
    }
  };

  const startReview = () => {
    action.mutate(
      { reportId, action: 'start_review' },
      {
        onSuccess: () => haptics.success(),
        onError: (reviewError) => setError(reviewError.message),
      },
    );
  };

  if (isLoading) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <SafetyHeader title="Bildirim" subtitle="Yükleniyor…" />
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  if (isError || !report) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <SafetyHeader title="Bildirim" />
        <SafetyEmptyState
          icon="lock-closed-outline"
          title="Bildirim görüntülenemedi"
          body="Bu bildirim çocuk güvenliği kapsamında olabilir ve ek yetki gerektirebilir."
          actionLabel="Tekrar dene"
          onAction={() => void refetch()}
        />
      </Screen>
    );
  }

  const reason = report.is_child_safety
    ? (CHILD_REASON_MAP[report.child_reason_code ?? 'child_other']?.label ?? 'Çocuk güvenliği')
    : (REPORT_REASONS.find((item) => item.code === report.reason_code)?.label ?? 'Bildirim');
  const sla = formatSlaRemaining(report.sla_due_at);
  const closed = ['resolved', 'dismissed', 'closed'].includes(report.status_code);
  const snapshotEntries = Object.entries(report.target_snapshot ?? {}).slice(0, 8);

  return (
    <Screen edges={['top', 'left', 'right']} padded>
      <SafetyHeader
        title={report.report_no}
        subtitle={REPORT_TARGET_LABEL[report.target_type]}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Bildirimi bana ata"
            onPress={() =>
              assign.mutate(
                { reportId },
                {
                  onSuccess: () => haptics.success(),
                  onError: (assignError) => setError(assignError.message),
                },
              )
            }
            style={[styles.iconButton, { backgroundColor: theme.colors.primarySoft }]}
          >
            <Ionicons name="person-add-outline" size={18} color={theme.colors.primaryDeep} />
          </Pressable>
        }
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {report.is_child_safety ? (
          <View
            style={[
              styles.childBanner,
              { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
            ]}
          >
            <Ionicons name="shield-half-outline" size={20} color={theme.colors.danger} />
            <View style={styles.flex}>
              <AppText variant="bodyStrong" color="danger">
                Çocuk güvenliği bildirimi
              </AppText>
              <AppText variant="caption" color="textSecondary">
                Yalnızca `safety.child.view` yetkisi olan ekip erişebilir. Görsel içerikler
                varsayılan olarak bulanık gösterilir; içeriği açmadan önce kimlik ve yaş bağlamını
                doğrula.
              </AppText>
            </View>
          </View>
        ) : null}

        <Card style={styles.summary}>
          <View style={styles.rowBetween}>
            <AppText variant="h3" style={styles.flex}>
              {reason}
            </AppText>
            <ReportStatusPill status={report.status_code} />
          </View>

          <View style={styles.badgeRow}>
            <PriorityPill priority={report.priority} />
            <Badge label={REPORT_TARGET_LABEL[report.target_type]} tone="neutral" />
            <Badge label={`Hedef: ${report.target_id.slice(0, 14)}`} tone="neutral" />
          </View>

          <View style={styles.metaGrid}>
            <Meta label="Gönderim" value={formatDateTimeTr(report.created_at)} />
            {report.sla_due_at ? (
              <Meta
                label="SLA"
                value={`${formatDateTimeTr(report.sla_due_at)} (${sla?.label ?? ''})`}
                tone={sla?.expired ? 'danger' : 'default'}
              />
            ) : null}
            <Meta
              label="Bildiren"
              value={report.reporter_id ? `#${report.reporter_id.slice(0, 8)}` : '—'}
            />
            <Meta
              label="Atanan"
              value={report.assigned_to ? report.assigned_to.slice(0, 8) : 'Atanmamış'}
            />
            {report.reviewed_at ? (
              <Meta label="İnceleme" value={formatDateTimeTr(report.reviewed_at)} />
            ) : null}
            {report.closed_at ? (
              <Meta label="Kapanış" value={formatDateTimeTr(report.closed_at)} />
            ) : null}
          </View>
        </Card>

        {report.description ? (
          <Card style={styles.block}>
            <AppText variant="label" color="textTertiary">
              BİLDİRENİN AÇIKLAMASI
            </AppText>
            <AppText variant="body">{report.description}</AppText>
          </Card>
        ) : null}

        {snapshotEntries.length > 0 ? (
          <Card style={styles.block}>
            <AppText variant="label" color="textTertiary">
              İÇERİK ÖZETİ
            </AppText>
            {snapshotEntries.map(([key, value]) => (
              <View key={key} style={styles.snapshotRow}>
                <AppText variant="caption" color="textSecondary" style={styles.snapshotKey}>
                  {key}
                </AppText>
                <AppText variant="caption" style={styles.flex} numberOfLines={3}>
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </AppText>
              </View>
            ))}
            <View
              style={[
                styles.mediaNote,
                { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.sm },
              ]}
            >
              <Ionicons name="eye-off-outline" size={14} color={theme.colors.textSecondary} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Korunan medya: görseller otomatik olarak bulanıklaştırılır ve indirilemez. İnceleme
                tamamlandığında erişim kaydı denetim günlüğüne yazılır.
              </AppText>
            </View>
          </Card>
        ) : null}

        <Card style={styles.block}>
          <AppText variant="label" color="textTertiary">
            İŞLEM GEÇMİŞİ
          </AppText>
          {report.actions.length === 0 ? (
            <AppText variant="caption" color="textSecondary">
              Henüz işlem yapılmadı.
            </AppText>
          ) : (
            <View style={styles.timeline}>
              {report.actions.map((item) => (
                <View key={item.id} style={styles.timelineRow}>
                  <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{item.action_code}</AppText>
                    {item.note_internal ? (
                      <AppText variant="caption" color="textSecondary">
                        İç not: {item.note_internal}
                      </AppText>
                    ) : null}
                    {item.note_public ? (
                      <AppText variant="caption" color="textSecondary">
                        Kullanıcıya: {item.note_public}
                      </AppText>
                    ) : null}
                    <AppText variant="caption" color="textTertiary">
                      {formatRelativeTr(item.created_at)}
                    </AppText>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>

        {error ? (
          <View
            style={[
              styles.errorBox,
              { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
            <AppText variant="caption" color="danger" style={styles.flex}>
              {error}
            </AppText>
          </View>
        ) : null}

        {!closed ? (
          <View style={styles.actions}>
            {report.status_code === 'received' ? (
              <Button
                label="İncelemeye al"
                variant="secondary"
                loading={action.isPending}
                onPress={startReview}
                leftIcon={
                  <Ionicons name="search-outline" size={17} color={theme.colors.primaryDeep} />
                }
              />
            ) : null}
            <Button
              label="İşlem uygula"
              onPress={() => setSheet('apply_action')}
              leftIcon={<Ionicons name="hammer-outline" size={17} color="#FFFFFF" />}
            />
            <Button label="Sonuçlandır" variant="secondary" onPress={() => setSheet('resolve')} />
            <Button
              label="İhlal yok olarak kapat"
              variant="ghost"
              onPress={() => setSheet('dismiss')}
            />
          </View>
        ) : (
          <Card tone="muted" elevated={false} style={styles.closedCard}>
            <Ionicons name="checkmark-done-circle" size={22} color={theme.colors.success} />
            <View style={styles.flex}>
              <AppText variant="bodyStrong">Bu bildirim sonuçlandırıldı</AppText>
              <AppText variant="caption" color="textSecondary">
                Sonuç kodu: {report.resolution_code ?? '—'} · Kullanıcıya iletilen not:{' '}
                {report.resolution_note_public ?? 'yok'}
              </AppText>
            </View>
          </Card>
        )}
      </ScrollView>

      <SafetySheet
        visible={sheet !== null}
        onClose={() => setSheet(null)}
        title={
          sheet === 'dismiss'
            ? 'İhlal yok olarak kapat'
            : sheet === 'apply_action'
              ? 'İşlem uygula'
              : 'Bildirimi sonuçlandır'
        }
        subtitle="Kullanıcıya gösterilecek not gizlilik kurallarına uygun olmalı"
        footer={
          <Button
            label={sheet === 'apply_action' ? 'İşlemi uygula' : 'Kaydet'}
            loading={action.isPending}
            onPress={() => void submit(sheet ?? 'resolve')}
            variant={sheet === 'dismiss' ? 'danger' : 'primary'}
          />
        }
      >
        <AppText variant="label" color="textSecondary">
          İçerik işlemi
        </AppText>
        <View style={styles.contentActions}>
          {CONTENT_ACTIONS.map((item) => {
            const active = contentAction === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setContentAction(item.key)}
                style={[
                  styles.contentChip,
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

        <TextField
          label="Kullanıcıya gösterilecek not (isteğe bağlı)"
          placeholder="Örn. Bildiriminiz incelendi ve gerekli işlem uygulandı."
          value={notePublic}
          onChangeText={setNotePublic}
          multiline
          maxLength={500}
          numberOfLines={3}
          textAlignVertical="top"
          hint="Kimlik, adres veya üçüncü kişi bilgisi paylaşmayın."
        />

        <TextField
          label="İç not (yalnızca ekip)"
          placeholder="İnceleme ayrıntıları, kanıt referansları…"
          value={noteInternal}
          onChangeText={setNoteInternal}
          multiline
          maxLength={2000}
          numberOfLines={3}
          textAlignVertical="top"
        />
      </SafetySheet>
    </Screen>
  );
}

function Meta({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <View style={styles.meta}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText variant="caption" color={tone === 'danger' ? 'danger' : 'text'}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingBottom: 28, gap: 12 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  childBanner: {
    flexDirection: 'row',
    gap: 10,
    padding: 13,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'flex-start',
  },
  summary: { gap: 9 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },
  meta: { minWidth: '45%', gap: 1 },
  block: { gap: 8 },
  snapshotRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  snapshotKey: { width: 88 },
  mediaNote: { flexDirection: 'row', gap: 7, padding: 9, alignItems: 'flex-start', marginTop: 4 },
  timeline: { gap: 10 },
  timelineRow: { flexDirection: 'row', gap: 9 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  errorBox: { flexDirection: 'row', gap: 7, padding: 11, borderWidth: 1, borderRadius: 10 },
  actions: { gap: 8, marginTop: 4 },
  closedCard: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 14 },
  contentActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 },
  contentChip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
});
