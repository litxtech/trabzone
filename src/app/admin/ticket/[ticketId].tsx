import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
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

import { AppText, Button, Card, IconButton } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { useDocumentViewer } from '@/features/documents/viewer';
import { SafetyEmptyState } from '@/features/safety/components/SafetyEmptyState';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { TicketStatusPill } from '@/features/safety/components/StatusPill';
import { SUPPORT_CATEGORY_MAP, TICKET_STATUS } from '@/features/safety/constants';
import { useSupportTemplates, useTicket } from '@/features/safety/hooks/use-safety';
import {
  useAdminReplyTicket,
  useAdminUpdateTicket,
} from '@/features/safety/hooks/use-safety-mutations';
import { getAttachmentUrl } from '@/features/safety/services/safety-service';
import type { Attachment, TicketMessage, TicketStatusCode } from '@/features/safety/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatSlaRemaining, formatTimeTr } from '@/utils/date';
import { toMessage } from '@/utils/error-message';
import { haptics } from '@/utils/haptics';

const STATUS_ACTIONS: {
  key: TicketStatusCode;
  label: string;
  tone: 'primary' | 'accent' | 'success';
}[] = [
  { key: 'under_review', label: 'İncelemeye al', tone: 'primary' },
  { key: 'awaiting_user', label: 'Kullanıcıdan bilgi bekle', tone: 'accent' },
  { key: 'info_required', label: 'Bilgi gerekli', tone: 'accent' },
  { key: 'priority_review', label: 'Öncelikli kuyruk', tone: 'accent' },
  { key: 'resolved', label: 'Çözüldü', tone: 'success' },
];

export default function AdminTicketDetailScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ ticketId?: string }>();
  const ticketId = typeof params.ticketId === 'string' ? params.ticketId : '';

  const { data: ticket, isLoading, isError, refetch } = useTicket(ticketId);
  const reply = useAdminReplyTicket(ticketId);
  const update = useAdminUpdateTicket();
  const templatesQuery = useSupportTemplates();
  const viewer = useDocumentViewer();

  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const activeTemplates = (templatesQuery.data ?? []).filter((template) => template.is_active);

  const send = async (nextStatus?: TicketStatusCode) => {
    if (!draft.trim()) {
      setError('Yanıt metni boş olamaz.');
      return;
    }
    setError(null);
    try {
      await reply.mutateAsync({
        body: draft.trim(),
        isInternal: internal,
        nextStatus: nextStatus ?? null,
      });
      setDraft('');
      haptics.success();
    } catch (sendError) {
      haptics.error();
      setError(toMessage(sendError, 'Yanıt gönderilemedi. Tekrar dene.'));
    }
  };

  const changeStatus = (status: TicketStatusCode) => {
    update.mutate(
      { ticketId, status },
      {
        onSuccess: () => haptics.success(),
        onError: (statusError) => setError(statusError.message),
      },
    );
  };

  const assignToMe = () => {
    update.mutate(
      { ticketId, assignSelf: true },
      {
        onSuccess: () => haptics.success(),
        onError: (assignError) => setError(assignError.message),
      },
    );
  };

  const openAttachment = async (attachment: Attachment) => {
    const url = await getAttachmentUrl('safety-support', attachment.path);
    if (!url) {
      setError('Ek dosya açılamadı.');
      return;
    }
    viewer.openDocument({
      url,
      name: attachment.name,
      mime: attachment.mime,
      title: attachment.name,
      refresh: () => getAttachmentUrl('safety-support', attachment.path),
    });
  };

  if (isLoading) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <SafetyHeader title="Talep" subtitle="Yükleniyor…" />
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  if (isError || !ticket) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <SafetyHeader title="Talep" />
        <SafetyEmptyState
          icon="cloud-offline-outline"
          title="Talep yüklenemedi"
          body="Yetkin olduğundan emin ol ve tekrar dene."
          actionLabel="Tekrar dene"
          onAction={() => void refetch()}
        />
      </Screen>
    );
  }

  const sla = formatSlaRemaining(ticket.sla_due_at);
  const category = SUPPORT_CATEGORY_MAP[ticket.category_code];

  return (
    <Screen edges={['top', 'left', 'right']} padded>
      <SafetyHeader
        title={ticket.ticket_no}
        subtitle={category?.label ?? 'Destek talebi'}
        right={
          <IconButton
            name="person-add-outline"
            accessibilityLabel="Talebi bana ata"
            variant="surface"
            size={18}
            onPress={assignToMe}
          />
        }
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.summary}>
          <AppText variant="title">{ticket.subject}</AppText>
          <View style={styles.row}>
            <TicketStatusPill status={ticket.status_code} />
            <AppText variant="caption" color="textTertiary">
              {formatDateTimeTr(ticket.created_at)}
            </AppText>
          </View>
          <AppText variant="caption" color="textSecondary">
            {TICKET_STATUS[ticket.status_code]?.hint}
          </AppText>
          {sla ? (
            <View
              style={[
                styles.slaRow,
                {
                  backgroundColor: sla.expired
                    ? theme.colors.dangerSoft
                    : theme.colors.surfaceMuted,
                },
              ]}
            >
              <Ionicons
                name={sla.expired ? 'alert-circle-outline' : 'timer-outline'}
                size={14}
                color={sla.expired ? theme.colors.danger : theme.colors.textSecondary}
              />
              <AppText variant="caption" color={sla.expired ? 'danger' : 'textSecondary'}>
                SLA: {sla.label}
              </AppText>
            </View>
          ) : null}
          {ticket.assigned_to ? (
            <AppText variant="caption" color="textTertiary">
              Atanan: {ticket.assigned_to.slice(0, 8)}
            </AppText>
          ) : (
            <AppText variant="caption" color="warning">
              Bu talep henüz kimseye atanmadı.
            </AppText>
          )}
        </Card>

        <View style={styles.statusActions}>
          {STATUS_ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              disabled={update.isPending}
              onPress={() => changeStatus(action.key)}
              style={[
                styles.statusChip,
                {
                  backgroundColor:
                    action.tone === 'success'
                      ? theme.colors.successSoft
                      : action.tone === 'accent'
                        ? theme.colors.accentSoft
                        : theme.colors.primarySoft,
                },
              ]}
            >
              <AppText
                variant="caption"
                color={
                  action.tone === 'success'
                    ? 'success'
                    : action.tone === 'accent'
                      ? 'accent'
                      : 'primaryDeep'
                }
              >
                {action.label}
              </AppText>
            </Pressable>
          ))}
        </View>

        <View style={styles.messages}>
          {ticket.messages.map((message) => (
            <AdminMessage key={message.id} message={message} onOpenAttachment={openAttachment} />
          ))}
        </View>

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
      </ScrollView>

      <View
        style={[
          styles.composer,
          { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider },
        ]}
      >
        <View style={styles.composerTools}>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: internal }}
            accessibilityLabel="Yalnızca ekip görebilsin"
            onPress={() => setInternal((value) => !value)}
            style={[
              styles.internalToggle,
              {
                backgroundColor: internal ? theme.colors.warningSoft : theme.colors.surfaceMuted,
              },
            ]}
          >
            <Ionicons
              name={internal ? 'lock-closed' : 'lock-open-outline'}
              size={13}
              color={internal ? theme.colors.warning : theme.colors.textTertiary}
            />
            <AppText variant="caption" color={internal ? 'warning' : 'textTertiary'}>
              {internal ? 'İç not (kullanıcı görmez)' : 'Kullanıcıya yanıt'}
            </AppText>
          </Pressable>
          {!internal ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hazır yanıt şablonu seç"
              onPress={() => setTemplatesOpen(true)}
              style={[styles.internalToggle, { backgroundColor: theme.colors.primarySoft }]}
            >
              <Ionicons
                name="chatbox-ellipses-outline"
                size={13}
                color={theme.colors.primaryDeep}
              />
              <AppText variant="caption" color="primaryDeep">
                Şablon
              </AppText>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.composerRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={internal ? 'Ekip için not yaz…' : 'Kullanıcıya yanıt yaz…'}
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            maxLength={4000}
            style={[
              styles.input,
              {
                backgroundColor: theme.colors.inputBackground,
                color: theme.colors.text,
                borderRadius: theme.radius.lg,
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yanıtı gönder"
            onPress={() => void send()}
            disabled={reply.isPending}
            style={[
              styles.send,
              {
                backgroundColor: internal ? theme.colors.warning : theme.colors.primaryDeep,
                opacity: reply.isPending ? 0.6 : 1,
              },
            ]}
          >
            {reply.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
            )}
          </Pressable>
        </View>

        <View style={styles.quickActions}>
          <Button
            label="Yanıtla ve çöz"
            variant="secondary"
            size="sm"
            fullWidth={false}
            onPress={() => void send('resolved')}
            style={styles.quickButton}
          />
          <Button
            label="Yanıtla ve bilgi iste"
            variant="secondary"
            size="sm"
            fullWidth={false}
            onPress={() => void send('info_required')}
            style={styles.quickButton}
          />
        </View>
      </View>

      <Modal
        visible={templatesOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTemplatesOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Şablon seçimini kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={() => setTemplatesOpen(false)}
          />
          <View
            style={[
              styles.templateSheet,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            <View style={styles.templateHead}>
              <View style={{ flex: 1 }}>
                <AppText variant="h3">Hazır yanıtlar</AppText>
                <AppText variant="caption" color="textTertiary">
                  Seçilen metin yanıt kutusuna eklenir; göndermeden önce düzenleyebilirsin.
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                onPress={() => setTemplatesOpen(false)}
                style={[styles.templateClose, { backgroundColor: theme.colors.surfaceMuted }]}
              >
                <Ionicons name="close" size={17} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 420 }}
              contentContainerStyle={{ gap: 7 }}
            >
              {templatesQuery.isLoading ? (
                <ActivityIndicator color={theme.colors.primary} style={{ paddingVertical: 24 }} />
              ) : activeTemplates.length === 0 ? (
                <AppText variant="caption" color="textSecondary" style={{ paddingVertical: 20 }}>
                  Aktif şablon yok. Yönetim panelindeki Yanıt Şablonları ekranından ekleyebilirsin.
                </AppText>
              ) : (
                activeTemplates.map((template) => (
                  <Pressable
                    key={template.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${template.title} şablonunu kullan`}
                    onPress={() => {
                      setDraft((current) =>
                        current ? `${current}\n\n${template.body}` : template.body,
                      );
                      setTemplatesOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.templateRow,
                      {
                        backgroundColor: pressed ? theme.colors.primarySoft : theme.colors.surface,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="caption" style={{ fontWeight: '700' }}>
                        {template.title}
                      </AppText>
                      <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                        {template.body}
                      </AppText>
                    </View>
                    <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary} />
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function AdminMessage({
  message,
  onOpenAttachment,
}: {
  message: TicketMessage;
  onOpenAttachment: (attachment: Attachment) => void;
}) {
  const { theme } = useTheme();
  const isUser = message.author_role === 'user';
  const internal = Boolean(message.is_internal);

  return (
    <View
      style={[
        styles.message,
        {
          backgroundColor: internal
            ? theme.colors.warningSoft
            : isUser
              ? theme.colors.surface
              : theme.colors.primarySoft,
          borderColor: internal ? theme.colors.warning : theme.colors.border,
          borderRadius: theme.radius.md,
        },
      ]}
    >
      <View style={styles.messageHead}>
        <AppText
          variant="caption"
          color={internal ? 'warning' : isUser ? 'textSecondary' : 'primaryDeep'}
        >
          {internal ? 'İÇ NOT' : isUser ? 'Kullanıcı' : 'Destek ekibi'}
        </AppText>
        <AppText variant="caption" color="textTertiary">
          {formatTimeTr(message.created_at)}
          {message.read_at ? ' · okundu' : ''}
        </AppText>
      </View>
      <AppText variant="body">{message.body}</AppText>
      {(message.attachments ?? []).map((attachment) => (
        <Pressable
          key={attachment.path}
          accessibilityRole="button"
          accessibilityLabel={`${attachment.name} ekini aç`}
          onPress={() => onOpenAttachment(attachment)}
          style={[styles.attachment, { backgroundColor: theme.colors.surface }]}
        >
          <Ionicons name="attach" size={14} color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="primaryDeep" numberOfLines={1} style={styles.flex}>
            {attachment.name}
          </AppText>
          <Ionicons name="open-outline" size={12} color={theme.colors.textTertiary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingBottom: 16, gap: 12 },
  summary: { gap: 7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 9 },
  statusActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  messages: { gap: 8 },
  message: { padding: 12, gap: 6, borderWidth: 1 },
  messageHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8 },
  errorBox: { flexDirection: 'row', gap: 7, padding: 11, borderWidth: 1, borderRadius: 10 },
  composer: {
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerTools: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  internalToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    paddingHorizontal: 13,
    paddingTop: 11,
    paddingBottom: 11,
  },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  quickActions: { flexDirection: 'row', gap: 7 },
  quickButton: { flex: 1, paddingHorizontal: 10 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  templateSheet: {
    width: '100%',
    maxWidth: 560,
    padding: 16,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  templateHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  templateClose: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
});
