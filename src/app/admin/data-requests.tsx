import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useAdminPrivacyRequests, useAdminUpdatePrivacyRequest } from '@/features/privacy/hooks/use-privacy';
import { PRIVACY_STATUS_LABELS, type AdminPrivacyRequest } from '@/features/privacy/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatRelativeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

const FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'received', label: 'Alındı' },
  { key: 'verification_pending', label: 'Doğrulama' },
  { key: 'in_review', label: 'İncelemede' },
  { key: 'awaiting_user', label: 'Bilgi bekleniyor' },
  { key: 'completed', label: 'Tamamlandı' },
  { key: 'rejected', label: 'Reddedildi' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

const STATUS_OPTIONS = [
  'received',
  'verification_pending',
  'in_review',
  'awaiting_user',
  'completed',
  'rejected',
] as const;

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'primary' | 'neutral' {
  if (status === 'completed') {
    return 'success';
  }
  if (status === 'rejected') {
    return 'danger';
  }
  if (status === 'awaiting_user' || status === 'verification_pending') {
    return 'warning';
  }
  if (status === 'in_review') {
    return 'primary';
  }
  return 'neutral';
}

function dueMeta(dueAt: string | null) {
  if (!dueAt) {
    return { text: 'Süre belirtilmedi', overdue: false };
  }
  const diff = new Date(dueAt).getTime() - Date.now();
  const days = Math.ceil(diff / 86_400_000);
  if (diff < 0) {
    return { text: `${Math.abs(days)} gün gecikti`, overdue: true };
  }
  return { text: `${days} gün kaldı`, overdue: days <= 2 };
}

export default function AdminDataRequestsScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const { width } = useWindowDimensions();
  const compact = width < 760;

  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<AdminPrivacyRequest | null>(null);
  const [nextStatus, setNextStatus] = useState<(typeof STATUS_OPTIONS)[number]>('in_review');
  const [note, setNote] = useState('');
  const [response, setResponse] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const query = useAdminPrivacyRequests(filter === 'all' ? null : filter);
  const update = useAdminUpdatePrivacyRequest();

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item.status, (map.get(item.status) ?? 0) + 1);
    }
    return map;
  }, [items]);

  const overdue = items.filter((item) => {
    if (!item.due_at || item.status === 'completed' || item.status === 'rejected') {
      return false;
    }
    return new Date(item.due_at).getTime() < now;
  }).length;

  const open = (item: AdminPrivacyRequest) => {
    setSelected(item);
    setNextStatus(
      (STATUS_OPTIONS as readonly string[]).includes(item.status)
        ? (item.status as (typeof STATUS_OPTIONS)[number])
        : 'in_review',
    );
    setNote('');
    setResponse(item.response_summary ?? '');
  };

  const submit = () => {
    if (!selected) {
      return;
    }
    if (nextStatus === 'completed' && response.trim().length < 10) {
      toast.error('Tamamlarken kullanıcıya gönderilecek yanıt en az 10 karakter olmalı.');
      return;
    }
    update.mutate(
      {
        id: selected.id,
        status: nextStatus,
        note: note.trim() || null,
        response: response.trim() || null,
      },
      {
        onSuccess: () => {
          haptics.success();
          toast.success('Başvuru güncellendi. Kullanıcıya e-posta kuyruğa alındı.');
          setSelected(null);
        },
        onError: (error) => {
          haptics.error();
          toast.error(error.message);
        },
      },
    );
  };

  return (
    <AdminPage
      title="Veri Talepleri"
      subtitle="KVKK ve kişisel veri başvuruları. Yasal cevap süresi ve yanıtlar bu ekrandan yönetilir."
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
      actions={
        <View style={[styles.warn, { backgroundColor: overdue > 0 ? theme.colors.dangerSoft : theme.colors.successSoft }]}>
          <Ionicons
            name={overdue > 0 ? 'alarm-outline' : 'checkmark-circle-outline'}
            size={16}
            color={overdue > 0 ? theme.colors.danger : theme.colors.success}
          />
          <AppText
            variant="caption"
            color={overdue > 0 ? 'danger' : 'success'}
            style={styles.bold}
          >
            {overdue > 0 ? `${overdue} geciken başvuru` : 'Süresi geçen başvuru yok'}
          </AppText>
        </View>
      }
    >
      <View style={styles.summary}>
        <Summary icon="mail-unread-outline" label="Toplam" value={query.data?.total ?? 0} />
        <Summary icon="time-outline" label="Alındı" value={counts.get('received') ?? 0} />
        <Summary icon="search-outline" label="İncelemede" value={counts.get('in_review') ?? 0} />
        <Summary icon="checkmark-done-outline" label="Tamamlandı" value={counts.get('completed') ?? 0} />
        <Summary icon="alert-circle-outline" label="Geciken" value={overdue} danger={overdue > 0} />
      </View>

      <AdminSection
        title="Başvuru kuyruğu"
        subtitle="Kimlik doğrulaması tamamlanmadan veri açıklanmaz veya silinmez."
      >
        <FilterChips
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((item) => ({ key: item.key, label: item.label }))}
        />

        {query.isLoading ? (
          <AppText variant="body" color="textSecondary">
            Başvurular yükleniyor…
          </AppText>
        ) : query.isError ? (
          <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="lock-closed-outline" size={18} color={theme.colors.danger} />
            <AppText variant="body" color="textSecondary" style={styles.flex}>
              `privacy.request.manage` yetkisi gerekir.
            </AppText>
          </View>
        ) : items.length === 0 ? (
          <AppText variant="body" color="textSecondary">
            Bu filtrede başvuru yok.
          </AppText>
        ) : (
          <View style={styles.list}>
            {items.map((item) => {
              const due = dueMeta(item.due_at);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => open(item)}
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.colors.surfaceElevated,
                      borderColor: due.overdue ? theme.colors.danger : theme.colors.border,
                      borderRadius: theme.radius.md,
                    },
                    compact && styles.cardCompact,
                  ]}
                >
                  <View style={styles.flex}>
                    <View style={styles.rowTitle}>
                      <AppText variant="bodyStrong">#{item.request_no}</AppText>
                      <Badge
                        label={PRIVACY_STATUS_LABELS[item.status] ?? item.status}
                        tone={statusTone(item.status)}
                      />
                      {due.overdue ? <Badge label="SLA aşımı" tone="danger" /> : null}
                    </View>
                    <AppText variant="body" numberOfLines={1}>
                      {item.subject}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                      {item.display_name ?? item.username ?? 'Kullanıcı'} · {item.email ?? 'e-posta yok'} ·{' '}
                      {formatRelativeTr(item.created_at)}
                    </AppText>
                    <AppText variant="caption" color={due.overdue ? 'danger' : 'textTertiary'}>
                      Son yanıt: {item.due_at ? formatDateTimeTr(item.due_at) : 'yok'} · {due.text}
                    </AppText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
                </Pressable>
              );
            })}
          </View>
        )}
      </AdminSection>

      <Modal
        visible={Boolean(selected)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setSelected(null)} />
          {selected ? (
            <View
              style={[
                styles.modalCard,
                compact && styles.modalCardCompact,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.modalHead}>
                <View style={styles.flex}>
                  <AppText variant="h3">#{selected.request_no}</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {selected.display_name ?? selected.username ?? 'Kullanıcı'} ·{' '}
                    {selected.email ?? 'e-posta yok'}
                  </AppText>
                </View>
                <Pressable onPress={() => setSelected(null)} accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                </Pressable>
              </View>

              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalBody}>
                <View style={styles.rowTitle}>
                  <Badge
                    label={PRIVACY_STATUS_LABELS[selected.status] ?? selected.status}
                    tone={statusTone(selected.status)}
                  />
                  <Badge label={`Talep: ${selected.request_type}`} tone="neutral" />
                  {selected.due_at ? (
                    <Badge label={`Son: ${formatDateTimeTr(selected.due_at)}`} tone="warning" />
                  ) : null}
                </View>

                <View style={[styles.detailBlock, { backgroundColor: theme.colors.surfaceMuted }]}>
                  <AppText variant="label" color="textTertiary">
                    Konu
                  </AppText>
                  <AppText variant="bodyStrong">{selected.subject}</AppText>
                  <AppText variant="label" color="textTertiary" style={styles.mt}>
                    Açıklama
                  </AppText>
                  <AppText variant="body" color="textSecondary">
                    {selected.details}
                  </AppText>
                </View>

                <View style={styles.history}>
                  <AppText variant="bodyStrong">Durum geçmişi</AppText>
                  {selected.history.length === 0 ? (
                    <AppText variant="caption" color="textTertiary">
                      Geçmiş kaydı yok.
                    </AppText>
                  ) : (
                    selected.history.map((entry, index) => (
                      <View key={`${entry.created_at}-${index}`} style={styles.historyRow}>
                        <View style={[styles.historyDot, { backgroundColor: theme.colors.primary }]} />
                        <View style={styles.flex}>
                          <AppText variant="caption" color="textSecondary">
                            {PRIVACY_STATUS_LABELS[entry.status] ?? entry.status} · {entry.actor_role}
                          </AppText>
                          <AppText variant="caption" color="textTertiary">
                            {formatDateTimeTr(entry.created_at)}
                            {entry.note ? ` · ${entry.note}` : ''}
                          </AppText>
                        </View>
                      </View>
                    ))
                  )}
                </View>

                <View style={styles.field}>
                  <AppText variant="label" color="textSecondary">
                    Yeni durum
                  </AppText>
                  <View style={styles.chips}>
                    {STATUS_OPTIONS.map((status) => {
                      const active = nextStatus === status;
                      return (
                        <Pressable
                          key={status}
                          onPress={() => setNextStatus(status)}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                              borderColor: active ? theme.colors.primary : theme.colors.border,
                            },
                          ]}
                        >
                          <AppText
                            variant="caption"
                            color={active ? 'primaryDeep' : 'textSecondary'}
                          >
                            {PRIVACY_STATUS_LABELS[status]}
                          </AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.field}>
                  <AppText variant="label" color="textSecondary">
                    Kullanıcıya gönderilecek yanıt (e-posta)
                  </AppText>
                  <TextInput
                    value={response}
                    onChangeText={setResponse}
                    multiline
                    placeholder="Veri talebinin sonucu ve yapılan işlem…"
                    placeholderTextColor={theme.colors.textTertiary}
                    style={[
                      styles.textarea,
                      {
                        color: theme.colors.text,
                        backgroundColor: theme.colors.inputBackground,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  />
                </View>

                <View style={styles.field}>
                  <AppText variant="label" color="textSecondary">
                    İç işlem notu (kullanıcıya gösterilmez)
                  </AppText>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    multiline
                    placeholder="Kimlik doğrulama, yapılan işlem ve dayanak…"
                    placeholderTextColor={theme.colors.textTertiary}
                    style={[
                      styles.textareaSmall,
                      {
                        color: theme.colors.text,
                        backgroundColor: theme.colors.inputBackground,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  />
                </View>
              </ScrollView>

              <View style={styles.modalFooter}>
                <Button
                  label="Vazgeç"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => setSelected(null)}
                />
                <Button
                  label="Kaydet ve yanıtla"
                  fullWidth={false}
                  loading={update.isPending}
                  onPress={submit}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </AdminPage>
  );
}

function Summary({
  icon,
  label,
  value,
  danger = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  danger?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.summaryCard,
        {
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={17}
        color={danger ? theme.colors.danger : theme.colors.primaryDeep}
      />
      <AppText variant="h3">{value}</AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  mt: { marginTop: 8 },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
  },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  summaryCard: {
    flexGrow: 1,
    minWidth: 130,
    padding: 13,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  list: { gap: 9 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardCompact: { alignItems: 'flex-start' },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(7,12,24,0.62)' },
  modalCard: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '94%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 11,
  },
  modalCardCompact: { padding: 12, maxHeight: '96%' },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  modalScroll: { maxHeight: 520 },
  modalBody: { gap: 12, paddingBottom: 6 },
  detailBlock: { padding: 12, borderRadius: 10, gap: 3 },
  history: { gap: 7 },
  historyRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  historyDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  field: { gap: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  textarea: {
    minHeight: 100,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    lineHeight: 19,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  textareaSmall: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    lineHeight: 19,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
});
