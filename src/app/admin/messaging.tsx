import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText, Badge, Button, IconButton } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { BarChart } from '@/features/admin/components/Charts';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import {
  useMessageReportDetail,
  useMessageReports,
  useMessagingOverview,
} from '@/features/admin/hooks/use-admin';
import {
  DATE_PRESETS,
  dateRangeFor,
  defaultCustomRange,
  type DatePresetKey,
} from '@/features/admin/date-range';
import type { MessageReport, MessageReportDetail } from '@/features/admin/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr, formatRelativeTr } from '@/utils/date';

const number = (value: number) => new Intl.NumberFormat('tr-TR').format(value);

export default function AdminMessagingScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const initial = defaultCustomRange();
  const [preset, setPreset] = useState<DatePresetKey>('30');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [queue, setQueue] = useState<'all' | 'open' | 'resolved'>('open');
  const [offset, setOffset] = useState(0);
  const [selectedReport, setSelectedReport] = useState<MessageReport | null>(null);
  const [accessReason, setAccessReason] = useState(false);
  const [detail, setDetail] = useState<MessageReportDetail | null>(null);

  const range = dateRangeFor(preset, from, to);
  const overview = useMessagingOverview(range.from, range.to);
  const reports = useMessageReports(queue, 15, offset);
  const detailMutation = useMessageReportDetail();

  const stats = overview.data?.stats;

  return (
    <AdminPage
      title="Mesajlaşma Yönetimi"
      subtitle="Teslimat sağlığı, kötüye kullanım sinyalleri ve rapor kapsamlı inceleme."
      refreshing={overview.isRefetching || reports.isRefetching}
      onRefresh={() => {
        void overview.refetch();
        void reports.refetch();
      }}
      actions={<Badge label="Gizlilik korumalı" tone="success" />}
    >
      <FilterChips
        options={DATE_PRESETS.map((item) => ({ key: item.key, label: item.label }))}
        value={preset}
        onChange={(value) => setPreset(value)}
      />
      {preset === 'custom' ? (
        <View style={styles.dateRow}>
          <DateInput label="Başlangıç" value={from} onChange={setFrom} />
          <DateInput label="Bitiş" value={to} onChange={setTo} />
        </View>
      ) : null}

      <StatGrid>
        <StatCard
          label="Dönem mesaj hacmi"
          value={number(stats?.messages_period ?? 0)}
          icon="chatbubbles-outline"
          hint={`${number(stats?.messages_today ?? 0)} bugün`}
        />
        <StatCard
          label="Aktif sohbet"
          value={number(stats?.active_conversations ?? 0)}
          icon="people-outline"
          tone="accent"
          hint="Son 30 günde hareketli"
        />
        <StatCard
          label="Teslim edilemeyen"
          value={number(stats?.undelivered ?? 0)}
          icon="alert-circle-outline"
          tone={stats?.undelivered ? 'warning' : 'success'}
          hint={`Ortalama ${stats?.avg_delivery_seconds ?? 0} sn iletim`}
        />
        <StatCard
          label="Medya mesajı"
          value={number(stats?.media_messages ?? 0)}
          icon="image-outline"
          hint={`${number(stats?.upload_errors_24h ?? 0)} yükleme hatası`}
          tone={stats?.upload_errors_24h ? 'warning' : 'primary'}
        />
        <StatCard
          label="Açık mesaj şikâyeti"
          value={number(stats?.open_message_reports ?? 0)}
          icon="flag-outline"
          tone={stats?.open_message_reports ? 'danger' : 'success'}
          hint="Rapor kapsamlı inceleme"
        />
        <StatCard
          label="Arama"
          value={number(stats?.calls_period ?? 0)}
          icon="call-outline"
          tone={stats?.failed_calls ? 'warning' : 'primary'}
          hint={`${number(stats?.failed_calls ?? 0)} başarısız`}
        />
        <StatCard
          label="Engelleme olayı"
          value={number(stats?.blocked_events ?? 0)}
          icon="ban-outline"
          hint="Kullanıcı engellemeleri"
        />
        <StatCard
          label="Bildirim"
          value={number(stats?.notifications_24h ?? 0)}
          icon="notifications-outline"
          hint="Son 24 saatte gönderim"
          tone="accent"
        />
      </StatGrid>

      <AdminSection title="Mesaj hacmi" subtitle="Günlük mesaj trafiği">
        <BarChart
          data={(overview.data?.series ?? []).map((point) => ({
            label: point.date.slice(5).replace('-', '.'),
            value: point.messages,
          }))}
          color={theme.colors.primary}
        />
      </AdminSection>

      <AdminSection
        title="Rapor kapsamlı moderasyon"
        subtitle="Özel sohbetlere sınırsız erişim yoktur; yalnızca kullanıcı bildirimiyle sunulan içerik incelenir."
      >
        <FilterChips
          options={[
            { key: 'open' as const, label: 'Açık' },
            { key: 'resolved' as const, label: 'Çözülen' },
            { key: 'all' as const, label: 'Tümü' },
          ]}
          value={queue}
          onChange={(value) => {
            setQueue(value);
            setOffset(0);
          }}
        />

        {reports.isLoading ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: 28 }} />
        ) : (reports.data?.items.length ?? 0) === 0 ? (
          <AppText
            variant="caption"
            color="textTertiary"
            style={{ paddingVertical: 20, textAlign: 'center' }}
          >
            Bu kuyrukta mesaj şikâyeti yok.
          </AppText>
        ) : (
          reports.data?.items.map((report) => (
            <View key={report.id} style={[styles.reportRow, { borderColor: theme.colors.divider }]}>
              <View
                style={[
                  styles.reportIcon,
                  {
                    backgroundColor: report.is_child_safety
                      ? theme.colors.dangerSoft
                      : theme.colors.primarySoft,
                  },
                ]}
              >
                <Ionicons
                  name={
                    report.is_child_safety ? 'shield-half-outline' : 'chatbubble-ellipses-outline'
                  }
                  size={17}
                  color={report.is_child_safety ? theme.colors.danger : theme.colors.primaryDeep}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}
                >
                  <AppText variant="caption" style={{ fontWeight: '700' }}>
                    {report.report_no}
                  </AppText>
                  <Badge label={report.reason_category} tone="neutral" />
                  <Badge
                    label={report.priority}
                    tone={report.priority === 'critical' ? 'danger' : 'warning'}
                  />
                  {report.is_child_safety ? <Badge label="Çocuk güvenliği" tone="danger" /> : null}
                </View>
                <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                  {report.description || 'Açıklama yok.'}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {formatRelativeTr(report.created_at)} · {report.assignee_name ?? 'Atanmamış'} ·{' '}
                  {report.has_snapshot ? 'içerik ekli' : 'içerik yok'}
                </AppText>
              </View>
              <View style={{ gap: 5 }}>
                <Button
                  label="İncele"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => {
                    setSelectedReport(report);
                    setAccessReason(true);
                  }}
                />
                <Button
                  label="Şikâyet dosyası"
                  size="sm"
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => router.push(`/admin/report/${report.id}` as never)}
                />
              </View>
            </View>
          ))
        )}

        {reports.data ? (
          <Pager
            total={reports.data.total}
            limit={reports.data.limit}
            offset={reports.data.offset}
            onChange={setOffset}
          />
        ) : null}
      </AdminSection>

      <AppText variant="caption" color="textTertiary">
        Mesaj içeriklerine erişim her seferinde gerekçeyle kayıt altına alınır. Uçtan uca şifreleme
        modeli korunur; şifreli içerikler istemci tarafında çözülmeden görüntülenemez.
      </AppText>

      <ReasonDialog
        visible={accessReason}
        title="Rapor içeriğine erişim"
        description="Yalnızca şikâyet kapsamındaki mesajlar gösterilir. Bu erişim denetim kaydına yazılır."
        confirmLabel="İçeriği görüntüle"
        requireReason
        loading={detailMutation.isPending}
        onCancel={() => {
          setAccessReason(false);
          setSelectedReport(null);
        }}
        onConfirm={async ({ reason }) => {
          if (!selectedReport) return;
          try {
            const result = await detailMutation.mutateAsync({
              reportId: selectedReport.id,
              reason,
            });
            setDetail(result);
            setAccessReason(false);
          } catch {
            // The dialog keeps the reason so the operator can retry after a permission error.
          }
        }}
      />

      <Modal
        visible={Boolean(detail)}
        transparent
        animationType="fade"
        onRequestClose={() => setDetail(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={() => setDetail(null)}
          />
          <View
            style={[
              styles.panel,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.panelHead, { borderColor: theme.colors.divider }]}>
              <View style={{ flex: 1 }}>
                <AppText variant="h3">Rapor kapsamlı mesaj</AppText>
                <AppText variant="caption" color="textTertiary">
                  Erişim kaydedildi · {detail?.report.report_no}
                </AppText>
              </View>
              <IconButton
                accessibilityLabel="Kapat"
                name="close"
                size={18}
                onPress={() => setDetail(null)}
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 14, gap: 10 }}
            >
              {detail?.message ? (
                <>
                  <View style={styles.metaGrid}>
                    <Meta label="Mesaj ID" value={detail.message.id} mono />
                    <Meta label="Gönderen" value={detail.message.sender_id} mono />
                    <Meta label="Tür" value={detail.message.kind} />
                    <Meta label="Tarih" value={formatDateTr(detail.message.created_at)} />
                    <Meta
                      label="Sohbet"
                      value={detail.conversation?.title ?? detail.message.conversation_id}
                    />
                    <Meta label="Üye" value={String(detail.conversation?.member_count ?? '—')} />
                  </View>
                  <View style={[styles.messageBox, { backgroundColor: theme.colors.surfaceMuted }]}>
                    <AppText variant="body">{detail.message.body || '(medya mesajı)'}</AppText>
                  </View>
                  {detail.message.media_path ? (
                    <AppText variant="caption" color="textTertiary">
                      Medya eki: {detail.message.media_path}
                    </AppText>
                  ) : null}
                  <View style={[styles.notice, { backgroundColor: theme.colors.warningSoft }]}>
                    <Ionicons name="eye-outline" size={16} color={theme.colors.warning} />
                    <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                      Bu içerik yalnızca şikâyeti değerlendirmek için gösterilir. Kopyalamayın,
                      paylaşmayın veya amaç dışı kullanmayın.
                    </AppText>
                  </View>
                </>
              ) : (
                <AppText variant="caption" color="textTertiary">
                  Bu rapor için mesaj anlık görüntüsü bulunmuyor. Şikâyet dosyası üzerinden işlem
                  yapın.
                </AppText>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AdminPage>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 3 }}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.colors.textTertiary}
        style={[
          styles.dateInput,
          {
            backgroundColor: theme.colors.inputBackground,
            borderColor: theme.colors.border,
            color: theme.colors.text,
          },
        ]}
      />
    </View>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.meta}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText
        variant="caption"
        numberOfLines={2}
        style={{ fontWeight: '600', fontFamily: mono ? 'monospace' : undefined }}
      >
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dateInput: {
    height: 35,
    minWidth: 132,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    fontSize: 12,
    outlineStyle: 'none',
  } as never,
  reportRow: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  reportIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  panel: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '84%',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  panelHead: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  meta: { minWidth: 118, flexGrow: 1, flexBasis: 130, gap: 1 },
  messageBox: { borderRadius: 10, padding: 12 },
  notice: { flexDirection: 'row', gap: 7, padding: 10, borderRadius: 9, alignItems: 'flex-start' },
});
