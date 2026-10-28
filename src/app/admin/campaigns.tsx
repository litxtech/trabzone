import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Badge, Button, IconButton, TextField } from '@/components/ui';
import {
  AdminPage,
  AdminSection,
  AdminToolbar,
  FilterChips,
  Pager,
} from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminMe,
  useAudiencePreview,
  useCampaignCancel,
  useCampaignSave,
  useCampaigns,
} from '@/features/admin/hooks/use-admin';
import type { Campaign } from '@/features/admin/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatRelativeTr } from '@/utils/date';

const STATUS: Record<
  Campaign['status'],
  { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' | 'accent' }
> = {
  draft: { label: 'Taslak', tone: 'neutral' },
  scheduled: { label: 'Zamanlandı', tone: 'warning' },
  sending: { label: 'Gönderiliyor', tone: 'accent' },
  sent: { label: 'Gönderildi', tone: 'success' },
  failed: { label: 'Başarısız', tone: 'danger' },
  cancelled: { label: 'İptal', tone: 'neutral' },
};

const AUDIENCE_TYPES = [
  { key: 'all', label: 'Tüm kullanıcılar', needsValue: false },
  { key: 'ios', label: 'iOS', needsValue: false },
  { key: 'android', label: 'Android', needsValue: false },
  { key: 'verified', label: 'Doğrulanmış', needsValue: false },
  { key: 'new', label: 'Yeni kullanıcılar', needsValue: false },
  { key: 'premium', label: 'Premium', needsValue: false },
  { key: 'creators', label: 'İçerik üreticileri', needsValue: false },
  { key: 'sellers', label: 'Satıcılar', needsValue: false },
  { key: 'country', label: 'Ülke kodu', needsValue: true },
  { key: 'city', label: 'Şehir', needsValue: true },
  { key: 'language', label: 'Dil', needsValue: true },
  { key: 'role', label: 'Rol', needsValue: true },
  { key: 'user', label: 'Tek kullanıcı (UUID)', needsValue: true },
] as const;

export default function AdminCampaignsScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const me = useAdminMe();
  const canSend = (me.data?.permissions ?? []).includes('notify.send');
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Campaign | null>(null);

  const campaigns = useCampaigns(status, search, 20, offset);
  const cancel = useCampaignCancel();
  const stats = campaigns.data?.stats;

  const columns: Column<Campaign>[] = [
    {
      key: 'campaign',
      label: 'Kampanya',
      width: 2.4,
      render: (row) => (
        <View style={{ gap: 1, minWidth: 0 }}>
          <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
            {row.title}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {row.body}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {row.audience.type === 'all'
              ? 'Tüm kullanıcılar'
              : `${row.audience.type}${row.audience.value ? `: ${row.audience.value}` : ''}`}
          </AppText>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Durum',
      width: 0.8,
      render: (row) => <Badge label={STATUS[row.status].label} tone={STATUS[row.status].tone} />,
    },
    {
      key: 'delivery',
      label: 'Teslimat',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <View style={{ gap: 1 }}>
          <AppText variant="caption" color="textSecondary">
            {row.sent_count.toLocaleString('tr-TR')} / {row.target_count.toLocaleString('tr-TR')}
          </AppText>
          {row.failed_count > 0 ? (
            <AppText variant="caption" color="danger">
              {row.failed_count} başarısız
            </AppText>
          ) : null}
        </View>
      ),
    },
    {
      key: 'schedule',
      label: 'Gönderim',
      width: 1,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textTertiary">
          {row.sent_at
            ? formatDateTimeTr(row.sent_at)
            : row.scheduled_at
              ? formatDateTimeTr(row.scheduled_at)
              : '—'}
        </AppText>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: 0.9,
      render: (row) => (
        <View style={{ flexDirection: 'row', gap: 5 }}>
          {canSend ? (
            <Button
              label="Düzenle"
              size="sm"
              variant="ghost"
              fullWidth={false}
              onPress={() => {
                setEditing(row);
                setEditorOpen(true);
              }}
            />
          ) : null}
          {canSend && ['draft', 'scheduled'].includes(row.status) ? (
            <Button
              label="İptal"
              size="sm"
              variant="ghost"
              fullWidth={false}
              onPress={() => {
                setCancelTarget(row);
              }}
            />
          ) : null}
        </View>
      ),
    },
  ];

  return (
    <AdminPage
      title="Bildirim Merkezi"
      subtitle="Hedef kitleli duyurular, zamanlanmış kampanyalar ve teslimat raporları."
      refreshing={campaigns.isRefetching}
      onRefresh={() => void campaigns.refetch()}
      actions={
        <Button
          label="Yeni kampanya"
          size="sm"
          fullWidth={false}
          disabled={!canSend}
          leftIcon={<Ionicons name="add" size={15} color={theme.colors.onPrimary} />}
          onPress={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        />
      }
    >
      <StatGrid>
        <StatCard
          label="Taslak"
          value={String(stats?.draft ?? 0)}
          icon="document-text-outline"
          hint="Yayınlanmayı bekliyor"
        />
        <StatCard
          label="Zamanlanmış"
          value={String(stats?.scheduled ?? 0)}
          icon="time-outline"
          tone="warning"
          hint="Gönderim planlandı"
        />
        <StatCard
          label="Gönderilen (30 gün)"
          value={String(stats?.sent_30d ?? 0)}
          icon="send-outline"
          tone="success"
          hint={`${stats?.delivered_30d ?? 0} teslimat`}
        />
        <StatCard
          label="Başarısız teslimat"
          value={String(stats?.failed_30d ?? 0)}
          icon="alert-circle-outline"
          tone={stats?.failed_30d ? 'danger' : 'primary'}
          hint="Son 30 gün"
        />
      </StatGrid>

      <AdminSection title="Kampanyalar" subtitle="Cihaz izinleri ve kullanıcı tercihleri korunur.">
        <AdminToolbar>
          <View
            style={[
              styles.searchWrap,
              { borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground },
            ]}
          >
            <Ionicons name="search" size={15} color={theme.colors.textTertiary} />
            <TextInput
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                setOffset(0);
              }}
              placeholder="Başlık veya içerik ara…"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.searchInput, { color: theme.colors.text }]}
            />
          </View>
        </AdminToolbar>
        <FilterChips
          options={[
            { key: '', label: 'Tümü' },
            ...Object.entries(STATUS).map(([key, value]) => ({ key, label: value.label })),
          ]}
          value={status ?? ''}
          onChange={(value) => {
            setStatus(value || null);
            setOffset(0);
          }}
        />
        <DataTable
          columns={columns}
          rows={campaigns.data?.items ?? []}
          keyExtractor={(row) => row.id}
          loading={campaigns.isLoading}
          empty={
            <View style={[styles.empty, { borderColor: theme.colors.border }]}>
              <Ionicons name="notifications-outline" size={22} color={theme.colors.textTertiary} />
              <AppText variant="body" color="textSecondary">
                Kampanya bulunamadı.
              </AppText>
            </View>
          }
        />
        {campaigns.data ? (
          <Pager
            total={campaigns.data.total}
            limit={campaigns.data.limit}
            offset={campaigns.data.offset}
            onChange={setOffset}
          />
        ) : null}
      </AdminSection>

      <CampaignEditor
        visible={editorOpen}
        campaign={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSaved={(message) => {
          toast.success(message);
          setEditorOpen(false);
          setEditing(null);
          void campaigns.refetch();
        }}
      />

      <ReasonDialog
        visible={Boolean(cancelTarget)}
        title="Kampanyayı iptal et"
        description="Zamanlanmış kampanya gönderilmez. İşlem denetim kaydına yazılır."
        confirmLabel="İptal et"
        destructive
        loading={cancel.isPending}
        onCancel={() => setCancelTarget(null)}
        onConfirm={async ({ reason }) => {
          if (!cancelTarget) return;
          try {
            await cancel.mutateAsync({ id: cancelTarget.id, reason });
            setCancelTarget(null);
            toast.success('Kampanya iptal edildi.');
            void campaigns.refetch();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Kampanya iptal edilemedi.');
          }
        }}
      />
    </AdminPage>
  );
}

function CampaignEditor({
  visible,
  campaign,
  onClose,
  onSaved,
}: {
  visible: boolean;
  campaign: Campaign | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const save = useCampaignSave();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [route, setRoute] = useState('');
  const [audienceType, setAudienceType] = useState<string>('all');
  const [audienceValue, setAudienceValue] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [sendNow, setSendNow] = useState(true);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const key = campaign?.id ?? 'new';
  // Rehydrate the editor from the selected campaign when the dialog opens.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!visible) return;
    setTitle(campaign?.title ?? '');
    setBody(campaign?.body ?? '');
    setImageUrl(campaign?.image_url ?? '');
    setRoute(campaign?.route ?? '');
    setAudienceType(campaign?.audience.type ?? 'all');
    setAudienceValue(campaign?.audience.value ?? '');
    setScheduledAt(campaign?.scheduled_at ?? '');
    setSendNow(!campaign?.scheduled_at);
    setReason('');
    setError(null);
    // Only rehydrate when the editor opens or the edited campaign changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const audienceConfig = AUDIENCE_TYPES.find((item) => item.key === audienceType);
  const audience = useMemo(
    () =>
      audienceType
        ? { type: audienceType, ...(audienceValue.trim() ? { value: audienceValue.trim() } : {}) }
        : null,
    [audienceType, audienceValue],
  );
  const preview = useAudiencePreview(audience as Record<string, unknown> | null);

  const submit = async () => {
    if (title.trim().length < 3 || body.trim().length < 3) {
      setError('Başlık ve mesaj en az 3 karakter olmalı.');
      return;
    }
    if (audienceConfig?.needsValue && !audienceValue.trim()) {
      setError('Bu hedef kitle için bir değer girin.');
      return;
    }
    if (!sendNow && !scheduledAt.trim()) {
      setError('Zamanlanmış gönderim için tarih girin.');
      return;
    }
    try {
      await save.mutateAsync({
        id: campaign?.id ?? null,
        title: title.trim(),
        body: body.trim(),
        imageUrl: imageUrl.trim() || null,
        route: route.trim() || null,
        audience: {
          type: audienceType,
          ...(audienceValue.trim() ? { value: audienceValue.trim() } : {}),
        },
        scheduledAt: sendNow ? null : scheduledAt.trim(),
        sendNow,
        reason: reason.trim() || null,
      });
      onSaved(sendNow ? 'Kampanya oluşturuldu ve gönderim başlatıldı.' : 'Kampanya zamanlandı.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Kampanya kaydedilemedi.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.panel,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <View style={[styles.panelHead, { borderColor: theme.colors.divider }]}>
            <View style={{ flex: 1 }}>
              <AppText variant="h3">
                {campaign ? 'Kampanyayı düzenle' : 'Yeni bildirim kampanyası'}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                Hedef kitle sunucuda çözümlenir; cihaz izinleri korunur.
              </AppText>
            </View>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 14, gap: 10 }}
          >
            <TextField
              label="Başlık"
              value={title}
              onChangeText={setTitle}
              placeholder="Kısa ve net bildirim başlığı"
              maxLength={120}
            />
            <TextField
              label="Mesaj"
              value={body}
              onChangeText={setBody}
              placeholder="Bildirim gövdesi"
              multiline
              maxLength={500}
              hint={`${body.length}/500 karakter`}
            />
            <View style={styles.twoCol}>
              <View style={styles.flex}>
                <TextField
                  label="Görsel URL (opsiyonel)"
                  value={imageUrl}
                  onChangeText={setImageUrl}
                  placeholder="https://…"
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.flex}>
                <TextField
                  label="Hedef ekran (opsiyonel)"
                  value={route}
                  onChangeText={setRoute}
                  placeholder="/notifications"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={{ gap: 5 }}>
              <AppText variant="caption" color="textTertiary">
                Hedef kitle
              </AppText>
              <View style={styles.chips}>
                {AUDIENCE_TYPES.map((item) => {
                  const selected = item.key === audienceType;
                  return (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      onPress={() => {
                        setAudienceType(item.key);
                        setAudienceValue('');
                      }}
                      style={[
                        styles.chip,
                        {
                          borderColor: selected ? theme.colors.primary : theme.colors.border,
                          backgroundColor: selected ? theme.colors.primarySoft : 'transparent',
                        },
                      ]}
                    >
                      <AppText variant="caption" color={selected ? 'primaryDeep' : 'textSecondary'}>
                        {item.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
              {audienceConfig?.needsValue ? (
                <TextField
                  label="Hedef değer"
                  value={audienceValue}
                  onChangeText={setAudienceValue}
                  placeholder={
                    audienceType === 'country'
                      ? 'TR'
                      : audienceType === 'user'
                        ? 'UUID'
                        : audienceType === 'role'
                          ? 'moderator'
                          : 'İstanbul'
                  }
                  autoCapitalize="none"
                />
              ) : null}
              <View style={[styles.previewBox, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons name="people-outline" size={15} color={theme.colors.primary} />
                <AppText variant="caption" color="textSecondary">
                  {preview.isLoading
                    ? 'Hedef kitle hesaplanıyor…'
                    : preview.data
                      ? `${preview.data.count.toLocaleString('tr-TR')} kullanıcı${preview.data.capped ? ' (üst sınır)' : ''}`
                      : 'Hedef kitle seçin'}
                </AppText>
              </View>
            </View>

            <View style={styles.chips}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSendNow(true)}
                style={[
                  styles.chip,
                  {
                    borderColor: sendNow ? theme.colors.primary : theme.colors.border,
                    backgroundColor: sendNow ? theme.colors.primarySoft : 'transparent',
                  },
                ]}
              >
                <AppText variant="caption" color={sendNow ? 'primaryDeep' : 'textSecondary'}>
                  Hemen gönder
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSendNow(false)}
                style={[
                  styles.chip,
                  {
                    borderColor: !sendNow ? theme.colors.primary : theme.colors.border,
                    backgroundColor: !sendNow ? theme.colors.primarySoft : 'transparent',
                  },
                ]}
              >
                <AppText variant="caption" color={!sendNow ? 'primaryDeep' : 'textSecondary'}>
                  Zamanla
                </AppText>
              </Pressable>
            </View>
            {!sendNow ? (
              <TextField
                label="Gönderim zamanı"
                value={scheduledAt}
                onChangeText={setScheduledAt}
                placeholder="2026-10-27 20:00"
                hint="Yerel saat dilimi (YYYY-MM-DD HH:MM)"
                autoCapitalize="none"
              />
            ) : null}
            <TextField
              label="İşlem gerekçesi (opsiyonel)"
              value={reason}
              onChangeText={setReason}
              placeholder="Kampanya amacı"
              maxLength={400}
              hint="Gönderim kararı denetim kaydına yazılır."
            />
            {error ? (
              <AppText variant="caption" color="danger">
                {error}
              </AppText>
            ) : null}
            <View style={styles.formActions}>
              <Button
                label="Vazgeç"
                size="sm"
                variant="secondary"
                fullWidth={false}
                onPress={onClose}
              />
              <Button
                label={sendNow ? 'Oluştur ve gönder' : 'Kampanyayı zamanla'}
                size="sm"
                fullWidth={false}
                loading={save.isPending}
                onPress={() => void submit()}
              />
            </View>
            <AppText variant="caption" color="textTertiary">
              Gönderim yalnızca bildirim izni veren cihazlara yapılır. Tıklama ve açılma oranları
              sağlayıcı desteği ölçüsünde raporlanır.
            </AppText>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 200 },
  searchWrap: {
    flexGrow: 1,
    flexBasis: 260,
    height: 38,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    minWidth: 220,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 6, outlineStyle: 'none' } as never,
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  panel: {
    width: '100%',
    maxWidth: 680,
    maxHeight: '90%',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  panelHead: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  twoCol: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  previewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
