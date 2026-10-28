import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Alert,
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
import {
  useAdminDeletionRequests,
  useAdminUpdateDeletionRequest,
  useExecuteDeletionRequest,
} from '@/features/account/hooks/use-deletion-request';
import type { AdminDeletionRequest } from '@/features/account/services/deletion-request-service';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatRelativeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

const FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'received', label: 'Yeni' },
  { key: 'processing', label: 'İşlemde' },
  { key: 'completed', label: 'Tamamlanan' },
  { key: 'failed', label: 'Hatalı' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];
type NextStatus = 'received' | 'processing' | 'completed' | 'failed';

const STATUS_LABEL: Record<string, string> = {
  received: 'Alındı',
  processing: 'İşlemde',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'neutral'> = {
  received: 'warning',
  processing: 'primary',
  completed: 'success',
  failed: 'danger',
};

export default function AdminDeletionRequestsScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const { width } = useWindowDimensions();
  const compact = width < 760;

  const [filter, setFilter] = useState<FilterKey>('received');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdminDeletionRequest | null>(null);
  const [nextStatus, setNextStatus] = useState<NextStatus>('processing');
  const [note, setNote] = useState('');
  const [verify, setVerify] = useState(false);

  const query = useAdminDeletionRequests({
    status: filter === 'all' ? null : filter,
    search,
  });
  const update = useAdminUpdateDeletionRequest();
  const execute = useExecuteDeletionRequest();

  const items = query.data ?? [];
  const stats = useMemo(() => {
    return {
      total: items.length,
      pending: items.filter((item) => item.status === 'received').length,
      processing: items.filter((item) => item.status === 'processing').length,
      completed: items.filter((item) => item.status === 'completed').length,
      failed: items.filter((item) => item.status === 'failed').length,
    };
  }, [items]);

  const open = (item: AdminDeletionRequest) => {
    setSelected(item);
    setNextStatus(
      item.status === 'completed' || item.status === 'failed' || item.status === 'processing'
        ? item.status
        : 'processing',
    );
    setNote(item.resolution_note ?? '');
    setVerify(item.identity_verified);
  };

  const submit = () => {
    if (!selected) {
      return;
    }
    if (nextStatus === 'completed' && !verify) {
      toast.error('Hesabı silmeden tamamlandı olarak işaretleyemezsiniz. Önce kimlik doğrulaması yapın.');
      return;
    }
    if (nextStatus === 'completed' && note.trim().length < 10) {
      toast.error('Tamamlama notu en az 10 karakter olmalı.');
      return;
    }
    update.mutate(
      {
        id: selected.id,
        status: nextStatus,
        note: note.trim() || null,
        verifyIdentity: verify,
      },
      {
        onSuccess: () => {
          haptics.success();
          toast.success('Talep güncellendi ve işlem kaydı oluşturuldu.');
          setSelected(null);
        },
        onError: (error) => {
          haptics.error();
          toast.error(error.message);
        },
      },
    );
  };

  /**
   * Kimliği doğrulanmış talebi gerçekten uygular: medya (R2 + eski Storage)
   * temizlenir, profil/içerik ve auth hesabı kalıcı olarak silinir. Durum
   * değiştirmek tek başına hesabı silmediği için bu adım zorunludur.
   */
  const runDeletion = () => {
    if (!selected) {
      return;
    }
    if (!verify) {
      toast.error('Önce kimlik doğrulamasını tamamlayıp işaretleyin.');
      return;
    }
    const message = `#${selected.request_no} için ${selected.email ?? 'kullanıcı'} hesabı, profil fotoğrafı ve tüm medyası kalıcı olarak silinecek. Bu işlem geri alınamaz.`;

    const proceed = () => {
      execute.mutate(
        { id: selected.id, userId: selected.user_id },
        {
          onSuccess: (result) => {
            haptics.success();
            toast.success(
              result.account_found === false
                ? 'Eşleşen hesap bulunmadı; talep kapatıldı.'
                : `Hesap ve ilişkili veriler silindi. Referans: ${result.reference_code}`,
            );
            setSelected(null);
          },
          onError: (error) => {
            haptics.error();
            toast.error(error.message);
          },
        },
      );
    };

    if (Platform.OS === 'web') {
      const accepted = typeof window === 'undefined' ? false : window.confirm(message);
      if (accepted) {
        proceed();
      }
      return;
    }

    Alert.alert('Hesabı kalıcı olarak sil', message, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Kalıcı olarak sil', style: 'destructive', onPress: proceed },
    ]);
  };

  return (
    <AdminPage
      title="Hesap Silme Talepleri"
      subtitle="Giriş yapamayan kullanıcıların web talepleri. Kimlik doğrulaması ve gerçek silme işlemi tamamlanmadan talep kapatılmaz."
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <View style={styles.summary}>
        <Summary icon="trash-outline" label="Listelenen" value={stats.total} />
        <Summary icon="time-outline" label="Yeni" value={stats.pending} />
        <Summary icon="sync-outline" label="İşlemde" value={stats.processing} />
        <Summary icon="checkmark-done-outline" label="Tamamlandı" value={stats.completed} />
        <Summary icon="alert-circle-outline" label="Hatalı" value={stats.failed} danger={stats.failed > 0} />
      </View>

      <AdminSection
        title="Talep kuyruğu"
        subtitle="Referans kodu veya e-posta ile arayın. Yalnızca privacy.request.manage yetkisi erişir."
        action={
          <View
            style={[
              styles.search,
              { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="search-outline" size={16} color={theme.colors.textTertiary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Ara"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.searchInput, { color: theme.colors.text }]}
              accessibilityLabel="Silme talebi ara"
            />
          </View>
        }
      >
        <FilterChips
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((item) => ({ key: item.key, label: item.label }))}
        />

        {query.isLoading ? (
          <AppText variant="body" color="textSecondary">
            Talepler yükleniyor…
          </AppText>
        ) : query.isError ? (
          <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="lock-closed-outline" size={18} color={theme.colors.danger} />
            <AppText variant="body" color="textSecondary" style={styles.flex}>
              `privacy.request.manage` yetkisi gerekir.
            </AppText>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={28} color={theme.colors.success} />
            <AppText variant="body" color="textSecondary">
              Bu filtrede talep yok.
            </AppText>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => open(item)}
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.md,
                  },
                  compact && styles.cardCompact,
                ]}
              >
                <View style={styles.flex}>
                  <View style={styles.rowTitle}>
                    <AppText variant="bodyStrong">#{item.request_no}</AppText>
                    <Badge
                      label={STATUS_LABEL[item.status] ?? item.status}
                      tone={STATUS_TONE[item.status] ?? 'neutral'}
                    />
                    {item.identity_verified ? (
                      <Badge label="Kimlik doğrulandı" tone="success" />
                    ) : (
                      <Badge label="Doğrulama yok" tone="warning" />
                    )}
                  </View>
                  <AppText variant="body" numberOfLines={1}>
                    {item.email ?? 'E-posta yok'}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {formatRelativeTr(item.requested_at)}
                    {item.assigned_name ? ` · Atanan: ${item.assigned_name}` : ''}
                  </AppText>
                  {item.reason ? (
                    <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                      Sebep: {item.reason}
                    </AppText>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
              </Pressable>
            ))}
          </View>
        )}
      </AdminSection>

      <AdminSection title="İşlem prosedürü" subtitle="Yanlışlıkla veri kaybını önlemek için zorunlu adımlar.">
        <Step index={1} text="Talebin kullanıcıya ait olduğunu doğrulayın; yalnızca e-posta beyanı yeterli değildir." />
        <Step index={2} text="Talep sahibine e-posta ile doğrulama bağlantısı veya ek doğrulama gönderin." />
        <Step index={3} text="“Hesabı kalıcı olarak sil” düğmesiyle silme işlemini uygulayın; medya, profil ve giriş hesabı birlikte kaldırılır." />
        <Step index={4} text="Medya, ilişkili tablolar ve oturumların temizlendiğini doğrulayın." />
        <Step index={5} text="Silme uygulandığında talep otomatik olarak tamamlandı olur; hata varsa hatalı bırakıp tekrar deneyin." />
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
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.modalHead}>
                <View style={styles.flex}>
                  <AppText variant="h3">#{selected.request_no}</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {selected.email ?? 'E-posta yok'} · {formatDateTimeTr(selected.requested_at)}
                  </AppText>
                </View>
                <Pressable onPress={() => setSelected(null)} accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                </Pressable>
              </View>

              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalBody}>
                <View style={styles.rowTitle}>
                  <Badge
                    label={STATUS_LABEL[selected.status] ?? selected.status}
                    tone={STATUS_TONE[selected.status] ?? 'neutral'}
                  />
                  {selected.identity_verified ? (
                    <Badge label="Kimlik doğrulandı" tone="success" />
                  ) : (
                    <Badge label="Kimlik doğrulanmadı" tone="warning" />
                  )}
                </View>

                {selected.reason ? (
                  <View style={[styles.block, { backgroundColor: theme.colors.surfaceMuted }]}>
                    <AppText variant="label" color="textTertiary">
                      Kullanıcı sebebi
                    </AppText>
                    <AppText variant="body" color="textSecondary">
                      {selected.reason}
                    </AppText>
                  </View>
                ) : null}

                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: verify }}
                  onPress={() => setVerify((value) => !value)}
                  style={[
                    styles.verifyRow,
                    {
                      backgroundColor: verify ? theme.colors.successSoft : theme.colors.warningSoft,
                      borderColor: verify ? theme.colors.success : theme.colors.warning,
                    },
                  ]}
                >
                  <Ionicons
                    name={verify ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={verify ? theme.colors.success : theme.colors.warning}
                  />
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">Kimlik doğrulaması tamamlandı</AppText>
                    <AppText variant="caption" color="textSecondary">
                      Yalnızca güvenli bir kanaldan kimlik doğrulandıysa işaretleyin. Bu kayıt denetim
                      günlüğüne yazılır.
                    </AppText>
                  </View>
                </Pressable>

                <View style={styles.field}>
                  <AppText variant="label" color="textSecondary">
                    Yeni durum
                  </AppText>
                  <View style={styles.chips}>
                    {(['received', 'processing', 'completed', 'failed'] as NextStatus[]).map((status) => {
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
                          <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                            {STATUS_LABEL[status]}
                          </AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.field}>
                  <AppText variant="label" color="textSecondary">
                    İşlem notu
                  </AppText>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    multiline
                    placeholder="Doğrulama yöntemi, çalıştırılan işlem ve sonuç…"
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

                {selected.completed_at ? (
                  <AppText variant="caption" color="textTertiary">
                    Tamamlanma: {formatDateTimeTr(selected.completed_at)}
                  </AppText>
                ) : null}

                <View style={[styles.block, { backgroundColor: theme.colors.dangerSoft }]}>
                  <AppText variant="caption" color="danger">
                    “Hesabı kalıcı olarak sil” profil fotoğrafını, profili, içerikleri, medyayı ve
                    giriş hesabını kaldırır. Durumu “Tamamlandı” yapmak tek başına hesabı silmez;
                    silme ancak bu düğmeyle uygulanır.
                  </AppText>
                </View>
              </ScrollView>

              <View style={styles.modalFooter}>
                <Button
                  label="Vazgeç"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => setSelected(null)}
                />
                {selected.status !== 'completed' ? (
                  <Button
                    label="Hesabı kalıcı olarak sil"
                    variant="danger"
                    fullWidth={false}
                    loading={execute.isPending}
                    disabled={!verify || update.isPending}
                    onPress={runDeletion}
                  />
                ) : null}
                <Button
                  label="Kaydet"
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
      <Ionicons name={icon} size={17} color={danger ? theme.colors.danger : theme.colors.primaryDeep} />
      <AppText variant="h3">{value}</AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

function Step({ index, text }: { index: number; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.stepIndex, { backgroundColor: theme.colors.primarySoft }]}>
        <AppText variant="caption" color="primaryDeep" style={styles.bold}>
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
  bold: { fontWeight: '700' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  summaryCard: {
    flexGrow: 1,
    minWidth: 130,
    padding: 13,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
    minWidth: 190,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}) },
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
  empty: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stepIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(7,12,24,0.62)' },
  modalCard: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '94%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 11,
  },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  modalScroll: { maxHeight: 480 },
  modalBody: { gap: 12, paddingBottom: 6 },
  block: { padding: 11, borderRadius: 10, gap: 3 },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  field: { gap: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  textarea: {
    minHeight: 92,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    lineHeight: 19,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
});
