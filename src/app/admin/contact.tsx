import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
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
import {
  useAdminContactChannels,
  useAdminContactSubmissions,
  useAdminEmailLogs,
  useAdminSaveContactChannel,
  useAdminUpdateContactSubmission,
} from '@/features/web-content/hooks/use-web-content';
import type { AdminContactChannel, ContactSubmission } from '@/features/web-content/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

const CHANNEL_KEYS = ['support', 'privacy', 'child_safety', 'legal', 'business'] as const;

const TOPIC_LABEL: Record<string, string> = {
  support: 'Genel Destek',
  privacy: 'Gizlilik',
  child_safety: 'Çocuk Güvenliği',
  legal: 'Hukuki',
  business: 'İşletme',
  other: 'Diğer',
};

const MESSAGE_FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'received', label: 'Yeni' },
  { key: 'in_review', label: 'İncelemede' },
  { key: 'answered', label: 'Yanıtlandı' },
  { key: 'closed', label: 'Kapatıldı' },
  { key: 'spam', label: 'Spam' },
] as const;

type MessageFilter = (typeof MESSAGE_FILTERS)[number]['key'];

type ChannelDraft = {
  key: string;
  label: string;
  email: string;
  description: string;
  isActive: boolean;
  verified: boolean;
  sortOrder: string;
};

const emptyChannel = (): ChannelDraft => ({
  key: CHANNEL_KEYS[0],
  label: '',
  email: '',
  description: '',
  isActive: false,
  verified: false,
  sortOrder: '100',
});

const channelDraft = (channel: AdminContactChannel): ChannelDraft => ({
  key: channel.key,
  label: channel.label,
  email: channel.email ?? '',
  description: channel.description ?? '',
  isActive: channel.is_active,
  verified: Boolean(channel.verified_at),
  sortOrder: String(channel.sort_order),
});

export default function AdminContactScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const { width } = useWindowDimensions();
  const compact = width < 840;

  const [tab, setTab] = useState<'channels' | 'messages' | 'email'>('channels');
  const [filter, setFilter] = useState<MessageFilter>('all');
  const [channel, setChannel] = useState<ChannelDraft | null>(null);
  const [message, setMessage] = useState<ContactSubmission | null>(null);
  const [messageStatus, setMessageStatus] = useState<'received' | 'in_review' | 'answered' | 'closed' | 'spam'>('in_review');
  const [response, setResponse] = useState('');

  const channels = useAdminContactChannels();
  const submissions = useAdminContactSubmissions(filter === 'all' ? null : filter);
  const email = useAdminEmailLogs();
  const saveChannel = useAdminSaveContactChannel();
  const updateMessage = useAdminUpdateContactSubmission();

  const channelItems = channels.data ?? [];
  const messageItems = submissions.data ?? [];
  const critical = messageItems.filter((item) => item.topic === 'child_safety').length;
  const failedEmails = (email.data?.outbox ?? []).filter((item) => item.status === 'failed').length;

  const openMessage = (item: ContactSubmission) => {
    setMessage(item);
    setMessageStatus(
      (['received', 'in_review', 'answered', 'closed', 'spam'] as string[]).includes(item.status)
        ? (item.status as typeof messageStatus)
        : 'in_review',
    );
    setResponse(item.response_text ?? '');
  };

  const submitChannel = () => {
    if (!channel) {
      return;
    }
    if (channel.label.trim().length < 2) {
      toast.error('Kanal adı en az 2 karakter olmalı.');
      return;
    }
    if (channel.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(channel.email.trim())) {
      toast.error('Geçerli bir e-posta adresi girin.');
      return;
    }
    if (channel.isActive && !channel.verified) {
      toast.error('Doğrulanmamış bir e-posta adresi etkinleştirilemez.');
      return;
    }
    saveChannel.mutate(
      {
        key: channel.key,
        label: channel.label.trim(),
        email: channel.email.trim() || null,
        description: channel.description.trim() || null,
        isActive: channel.isActive,
        verified: channel.verified,
        sortOrder: Number(channel.sortOrder) || 100,
      },
      {
        onSuccess: () => {
          haptics.success();
          toast.success('İletişim kanalı kaydedildi.');
          setChannel(null);
        },
        onError: (error) => {
          haptics.error();
          toast.error(error.message);
        },
      },
    );
  };

  const submitMessage = () => {
    if (!message) {
      return;
    }
    if ((messageStatus === 'answered' || messageStatus === 'closed') && response.trim().length < 5) {
      toast.error('Yanıt göndermek için en az 5 karakter yazın.');
      return;
    }
    updateMessage.mutate(
      { id: message.id, status: messageStatus, response: response.trim() || null },
      {
        onSuccess: () => {
          haptics.success();
          toast.success('Mesaj güncellendi; yanıt e-posta kuyruğuna eklendi.');
          setMessage(null);
        },
        onError: (error) => {
          haptics.error();
          toast.error(error.message);
        },
      },
    );
  };

  const templates = email.data?.templates ?? [];
  const outbox = email.data?.outbox ?? [];

  return (
    <AdminPage
      title="İletişim Kanalları"
      subtitle="Kurumsal e-posta adresleri, form başvuruları ve e-posta gönderim günlükleri tek merkezde."
      refreshing={channels.isRefetching || submissions.isRefetching || email.isRefetching}
      onRefresh={() => {
        void channels.refetch();
        void submissions.refetch();
        void email.refetch();
      }}
    >
      <View style={styles.tabs}>
        <Tab label="Kanallar" active={tab === 'channels'} onPress={() => setTab('channels')} />
        <Tab
          label={`Form mesajları${critical > 0 ? ` (${critical} kritik)` : ''}`}
          active={tab === 'messages'}
          onPress={() => setTab('messages')}
        />
        <Tab
          label={`E-posta günlükleri${failedEmails > 0 ? ` (${failedEmails} hata)` : ''}`}
          active={tab === 'email'}
          onPress={() => setTab('email')}
        />
      </View>

      {tab === 'channels' ? (
        <AdminSection
          title="Yayınlanan iletişim adresleri"
          subtitle="Etkinleştirmeden önce adresin gerçekten çalıştığını doğrulayın. Doğrulanmamış adres sitede gösterilmez."
          action={
            <Button
              label="Kanal ekle"
              size="sm"
              fullWidth={false}
              leftIcon={<Ionicons name="add" size={15} color="#FFFFFF" />}
              onPress={() => setChannel(emptyChannel())}
            />
          }
        >
          {channels.isLoading ? (
            <AppText variant="body" color="textSecondary">
              Kanallar yükleniyor…
            </AppText>
          ) : channels.isError ? (
            <Permission />
          ) : channelItems.length === 0 ? (
            <AppText variant="body" color="textSecondary">
              Henüz iletişim kanalı tanımlanmadı.
            </AppText>
          ) : (
            <View style={styles.list}>
              {channelItems.map((item) => (
                <View
                  key={item.key}
                  style={[
                    styles.row,
                    {
                      backgroundColor: theme.colors.surfaceElevated,
                      borderColor: item.is_active ? theme.colors.success : theme.colors.border,
                      borderRadius: theme.radius.md,
                    },
                    compact && styles.rowCompact,
                  ]}
                >
                  <View style={styles.flex}>
                    <View style={styles.rowTitle}>
                      <AppText variant="bodyStrong">{item.label}</AppText>
                      <Badge label={item.key} tone="neutral" />
                      {item.is_active ? (
                        <Badge label="Yayında" tone="success" />
                      ) : (
                        <Badge label="Kapalı" tone="warning" />
                      )}
                      {item.verified_at ? (
                        <Badge label="Doğrulandı" tone="primary" />
                      ) : (
                        <Badge label="Doğrulanmadı" tone="danger" />
                      )}
                    </View>
                    <AppText variant="body" color="textSecondary">
                      {item.email ?? 'E-posta tanımlanmadı'}
                    </AppText>
                    {item.description ? (
                      <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                        {item.description}
                      </AppText>
                    ) : null}
                  </View>
                  <Button
                    label="Düzenle"
                    size="sm"
                    variant="secondary"
                    fullWidth={false}
                    onPress={() => setChannel(channelDraft(item))}
                  />
                </View>
              ))}
            </View>
          )}
        </AdminSection>
      ) : null}

      {tab === 'messages' ? (
        <AdminSection
          title="İletişim formu mesajları"
          subtitle="Çocuk güvenliği konulu mesajlar listenin başında ve kritik olarak işaretlenir."
        >
          <FilterChips
            value={filter}
            onChange={setFilter}
            options={MESSAGE_FILTERS.map((item) => ({ key: item.key, label: item.label }))}
          />
          {submissions.isLoading ? (
            <AppText variant="body" color="textSecondary">
              Mesajlar yükleniyor…
            </AppText>
          ) : submissions.isError ? (
            <Permission />
          ) : messageItems.length === 0 ? (
            <AppText variant="body" color="textSecondary">
              Bu filtrede mesaj yok.
            </AppText>
          ) : (
            <View style={styles.list}>
              {messageItems.map((item) => {
                const isCritical = item.topic === 'child_safety';
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => openMessage(item)}
                    style={[
                      styles.row,
                      {
                        backgroundColor: isCritical
                          ? theme.colors.dangerSoft
                          : theme.colors.surfaceElevated,
                        borderColor: isCritical ? theme.colors.danger : theme.colors.border,
                        borderRadius: theme.radius.md,
                      },
                      compact && styles.rowCompact,
                    ]}
                  >
                    <View style={styles.flex}>
                      <View style={styles.rowTitle}>
                        <AppText variant="bodyStrong">#{item.reference_code}</AppText>
                        {isCritical ? <Badge label="Kritik" tone="danger" /> : null}
                        <Badge label={TOPIC_LABEL[item.topic] ?? item.topic} tone="primary" />
                        <Badge label={item.status} tone="neutral" />
                      </View>
                      <AppText variant="body" numberOfLines={1}>
                        {item.name} · {item.email}
                      </AppText>
                      <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                        {item.message}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        {formatDateTimeTr(item.created_at)}
                        {item.responded_at ? ` · Yanıt ${formatDateTimeTr(item.responded_at)}` : ''}
                      </AppText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </AdminSection>
      ) : null}

      {tab === 'email' ? (
        <>
          <AdminSection
            title="E-posta kuyruğu"
            subtitle="Gönderim başarısız kayıtlar otomatik yeniden denenir. Hata ayrıntısı maskelenmez."
          >
            {email.isLoading ? (
              <AppText variant="body" color="textSecondary">
                Günlükler yükleniyor…
              </AppText>
            ) : email.isError ? (
              <Permission />
            ) : outbox.length === 0 ? (
              <AppText variant="body" color="textSecondary">
                Gönderim kaydı yok.
              </AppText>
            ) : (
              <View style={styles.list}>
                {outbox.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.row,
                      {
                        backgroundColor: theme.colors.surfaceElevated,
                        borderColor:
                          item.status === 'failed' ? theme.colors.danger : theme.colors.border,
                        borderRadius: theme.radius.md,
                      },
                    ]}
                  >
                    <View style={styles.flex}>
                      <View style={styles.rowTitle}>
                        <AppText variant="bodyStrong">{item.template_key}</AppText>
                        <Badge
                          label={item.status}
                          tone={
                            item.status === 'sent'
                              ? 'success'
                              : item.status === 'failed'
                                ? 'danger'
                                : 'warning'
                          }
                        />
                        <Badge label={`${item.attempts} deneme`} tone="neutral" />
                      </View>
                      <AppText variant="caption" color="textSecondary">
                        {item.to_email} · {formatDateTimeTr(item.created_at)}
                      </AppText>
                      {item.last_error ? (
                        <AppText variant="caption" color="danger" numberOfLines={2}>
                          {item.last_error}
                        </AppText>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </AdminSection>

          <AdminSection title="E-posta şablonları" subtitle="Kimlik doğrulama e-postaları Supabase Auth tarafından gönderilir.">
            <View style={styles.list}>
              {templates.map((template) => (
                <View
                  key={`${template.key}-${template.locale}`}
                  style={[
                    styles.row,
                    {
                      backgroundColor: theme.colors.surfaceElevated,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.md,
                    },
                  ]}
                >
                  <View style={styles.flex}>
                    <View style={styles.rowTitle}>
                      <AppText variant="bodyStrong">{template.key}</AppText>
                      <Badge label={template.locale} tone="neutral" />
                      {template.is_active ? (
                        <Badge label="Aktif" tone="success" />
                      ) : (
                        <Badge label="Pasif" tone="warning" />
                      )}
                    </View>
                    <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                      {template.subject}
                    </AppText>
                  </View>
                </View>
              ))}
            </View>
          </AdminSection>
        </>
      ) : null}

      {/* Kanal editörü */}
      <Modal visible={Boolean(channel)} transparent animationType="fade" onRequestClose={() => setChannel(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setChannel(null)} />
          {channel ? (
            <View
              style={[
                styles.modalCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.modalHead}>
                <View style={styles.flex}>
                  <AppText variant="h3">İletişim kanalı</AppText>
                  <AppText variant="caption" color="textTertiary">
                    Adres doğrulanmadan yayına alınamaz
                  </AppText>
                </View>
                <Pressable onPress={() => setChannel(null)} accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                </Pressable>
              </View>
              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.form}>
                <View style={styles.field}>
                  <AppText variant="label" color="textSecondary">
                    Kanal anahtarı
                  </AppText>
                  <View style={styles.chips}>
                    {CHANNEL_KEYS.map((key) => {
                      const active = channel.key === key;
                      return (
                        <Pressable
                          key={key}
                          onPress={() => setChannel({ ...channel, key })}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                              borderColor: active ? theme.colors.primary : theme.colors.border,
                            },
                          ]}
                        >
                          <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                            {key}
                          </AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <ChannelField
                  label="Görünen ad"
                  value={channel.label}
                  onChange={(label) => setChannel({ ...channel, label })}
                />
                <ChannelField
                  label="E-posta adresi"
                  value={channel.email}
                  onChange={(email) => setChannel({ ...channel, email })}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <ChannelField
                  label="Açıklama"
                  value={channel.description}
                  onChange={(description) => setChannel({ ...channel, description })}
                  multiline
                />
                <ChannelField
                  label="Sıra"
                  value={channel.sortOrder}
                  onChange={(sortOrder) =>
                    setChannel({ ...channel, sortOrder: sortOrder.replace(/[^0-9]/g, '') })
                  }
                />
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: channel.verified }}
                  onPress={() => setChannel({ ...channel, verified: !channel.verified })}
                  style={[
                    styles.toggleRow,
                    {
                      backgroundColor: channel.verified ? theme.colors.successSoft : theme.colors.warningSoft,
                      borderColor: channel.verified ? theme.colors.success : theme.colors.warning,
                    },
                  ]}
                >
                  <Ionicons
                    name={channel.verified ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={channel.verified ? theme.colors.success : theme.colors.warning}
                  />
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">Adres tarafından doğrulandı</AppText>
                    <AppText variant="caption" color="textSecondary">
                      Test e-postası gönderip yanıt aldıysanız işaretleyin.
                    </AppText>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: channel.isActive }}
                  onPress={() => setChannel({ ...channel, isActive: !channel.isActive })}
                  style={[
                    styles.toggleRow,
                    {
                      backgroundColor: channel.isActive ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                      borderColor: channel.isActive ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={channel.isActive ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={channel.isActive ? theme.colors.primaryDeep : theme.colors.textTertiary}
                  />
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">Sitede yayınla</AppText>
                    <AppText variant="caption" color="textSecondary">
                      Yalnızca doğrulanmış adresler yayınlanabilir.
                    </AppText>
                  </View>
                </Pressable>
              </ScrollView>
              <View style={styles.modalFooter}>
                <Button label="Vazgeç" variant="outline" fullWidth={false} onPress={() => setChannel(null)} />
                <Button
                  label="Kaydet"
                  fullWidth={false}
                  loading={saveChannel.isPending}
                  onPress={submitChannel}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Mesaj yanıtı */}
      <Modal visible={Boolean(message)} transparent animationType="fade" onRequestClose={() => setMessage(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setMessage(null)} />
          {message ? (
            <View
              style={[
                styles.modalCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.modalHead}>
                <View style={styles.flex}>
                  <AppText variant="h3">#{message.reference_code}</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {message.name} · {message.email} · {formatDateTimeTr(message.created_at)}
                  </AppText>
                </View>
                <Pressable onPress={() => setMessage(null)} accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                </Pressable>
              </View>
              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.form}>
                <View style={styles.rowTitle}>
                  <Badge label={TOPIC_LABEL[message.topic] ?? message.topic} tone="primary" />
                  {message.topic === 'child_safety' ? (
                    <Badge label="Kritik — ivedi inceleme" tone="danger" />
                  ) : null}
                </View>
                <View style={[styles.block, { backgroundColor: theme.colors.surfaceMuted }]}>
                  <AppText variant="body" color="textSecondary">
                    {message.message}
                  </AppText>
                </View>
                <View style={styles.field}>
                  <AppText variant="label" color="textSecondary">
                    Durum
                  </AppText>
                  <View style={styles.chips}>
                    {(['received', 'in_review', 'answered', 'closed', 'spam'] as const).map((status) => {
                      const active = messageStatus === status;
                      return (
                        <Pressable
                          key={status}
                          onPress={() => setMessageStatus(status)}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                              borderColor: active ? theme.colors.primary : theme.colors.border,
                            },
                          ]}
                        >
                          <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                            {status}
                          </AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <View style={styles.field}>
                  <AppText variant="label" color="textSecondary">
                    Yanıt metni (e-posta gönderilir)
                  </AppText>
                  <TextInput
                    value={response}
                    onChangeText={setResponse}
                    multiline
                    placeholder="Kullanıcıya gönderilecek yanıt…"
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
              </ScrollView>
              <View style={styles.modalFooter}>
                <Button label="Vazgeç" variant="outline" fullWidth={false} onPress={() => setMessage(null)} />
                <Button
                  label="Kaydet ve yanıtla"
                  fullWidth={false}
                  loading={updateMessage.isPending}
                  onPress={submitMessage}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </AdminPage>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.tab,
        {
          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
          borderColor: active ? theme.colors.primary : theme.colors.border,
        },
      ]}
    >
      <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function Permission() {
  const { theme } = useTheme();
  return (
    <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
      <Ionicons name="lock-closed-outline" size={18} color={theme.colors.danger} />
      <AppText variant="body" color="textSecondary" style={styles.flex}>
        `website.manage` yetkisi gerekir.
      </AppText>
    </View>
  );
}

function ChannelField({
  label,
  value,
  onChange,
  multiline = false,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.field}>
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholderTextColor={theme.colors.textTertiary}
        style={[
          multiline ? styles.textareaSmall : styles.input,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.inputBackground,
            borderColor: theme.colors.border,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  list: { gap: 9 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowCompact: { alignItems: 'flex-start' },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10 },
  block: { padding: 12, borderRadius: 10, gap: 3 },
  form: { gap: 11 },
  field: { gap: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    fontSize: 13,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  textarea: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    fontSize: 13,
    lineHeight: 19,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  textareaSmall: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    fontSize: 13,
    lineHeight: 19,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 11,
  },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(7,12,24,0.62)' },
  modalCard: {
    width: '100%',
    maxWidth: 660,
    maxHeight: '94%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 11,
  },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  modalScroll: { maxHeight: 500 },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
});
