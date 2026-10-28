import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText, Button, Card, IconButton } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { AttachmentPicker } from '@/features/safety/components/AttachmentPicker';
import { SafetyEmptyState } from '@/features/safety/components/SafetyEmptyState';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { SafetySheet } from '@/features/safety/components/SafetySheet';
import { TicketStatusPill } from '@/features/safety/components/StatusPill';
import {
  SAFETY_COMMITMENTS,
  SUPPORT_CATEGORY_MAP,
  SUPPORT_EMAIL,
  TICKET_STATUS,
} from '@/features/safety/constants';
import { useTicket } from '@/features/safety/hooks/use-safety';
import { useSendTicketMessage, useSetTicketStatus } from '@/features/safety/hooks/use-safety-mutations';
import { getAttachmentUrl } from '@/features/safety/services/safety-service';
import type { Attachment, TicketMessage } from '@/features/safety/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDayLabelTr, formatSlaRemaining, formatTimeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

export default function TicketDetailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ ticketId?: string }>();
  const ticketId = typeof params.ticketId === 'string' ? params.ticketId : '';

  const { data: ticket, isLoading, isError, refetch } = useTicket(ticketId);
  const sendMessage = useSendTicketMessage(ticketId);
  const setStatus = useSetTicketStatus(ticketId);

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) {
      return;
    }
    setError(null);
    try {
      await sendMessage.mutateAsync({ body: text, attachments });
      setDraft('');
      setAttachments([]);
      haptics.success();
    } catch (sendError) {
      haptics.error();
      setError(
        sendError && typeof sendError === 'object' && 'message' in sendError
          ? String((sendError as { message: unknown }).message)
          : 'Mesaj gönderilemedi. Tekrar dene.',
      );
    }
  };

  const openAttachment = async (attachment: Attachment) => {
    const url = await getAttachmentUrl('safety-support', attachment.path);
    if (!url) {
      setError('Ek dosya açılamadı.');
      return;
    }
    await Linking.openURL(url).catch(() => setError('Ek dosya açılamadı.'));
  };

  const confirmClose = () => {
    Alert.alert(
      'Talebi kapat',
      'Talebi kapatmak istediğine emin misin? Kapatılan talebe yeni mesaj gönderemezsin.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Kapat',
          style: 'destructive',
          onPress: () =>
            setStatus.mutate('close', {
              onSuccess: () => haptics.success(),
              onError: (closeError) => setError(closeError.message),
            }),
        },
      ],
    );
  };

  const statusConfig = TICKET_STATUS[ticket?.status_code ?? 'received'] ?? TICKET_STATUS.received;
  const sla = formatSlaRemaining(ticket?.sla_due_at);
  const isOpen =
    ticket != null && ticket.status_code !== 'closed' && ticket.status_code !== 'resolved';
  const category = ticket ? SUPPORT_CATEGORY_MAP[ticket.category_code] : undefined;

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
          body="Bağlantını kontrol edip tekrar dene."
          actionLabel="Tekrar dene"
          onAction={() => void refetch()}
        />
      </Screen>
    );
  }

  const composer = ticket.can_reply ? (
    <View
      style={[
        styles.composer,
        { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider },
      ]}
    >
      {attachments.length > 0 ? (
        <View style={styles.pendingRow}>
          {attachments.map((attachment) => (
            <View
              key={attachment.path}
              style={[
                styles.pendingChip,
                { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.sm },
              ]}
            >
              <Ionicons name="attach" size={13} color={theme.colors.primaryDeep} />
              <AppText
                variant="caption"
                color="primaryDeep"
                numberOfLines={1}
                style={styles.pendingText}
              >
                {attachment.name}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Eki kaldır"
                hitSlop={8}
                onPress={() =>
                  setAttachments(attachments.filter((item) => item.path !== attachment.path))
                }
              >
                <Ionicons name="close" size={14} color={theme.colors.primaryDeep} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}

      <View style={styles.composerRow}>
        <IconButton
          name="attach-outline"
          accessibilityLabel="Dosya ekle"
          variant="soft"
          size={19}
          onPress={() => setAttachOpen(true)}
        />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Mesaj yaz…"
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
          accessibilityLabel="Mesajı gönder"
          onPress={() => void send()}
          disabled={sendMessage.isPending}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: theme.colors.primaryDeep,
              opacity: pressed || sendMessage.isPending ? 0.7 : 1,
            },
          ]}
        >
          {sendMessage.isPending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="arrow-up" size={19} color="#FFFFFF" />
          )}
        </Pressable>
      </View>
    </View>
  ) : (
    <View
      style={[
        styles.closedBar,
        { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider },
      ]}
    >
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {ticket.status_code === 'closed'
          ? 'Bu talep kapatıldı. Yeni bir talep oluşturabilirsin.'
          : 'Talep çözüldü olarak işaretlendi.'}
      </AppText>
      <Button
        label="Yeni talep"
        size="sm"
        fullWidth={false}
        onPress={() => router.push('/support/create')}
      />
    </View>
  );

  return (
    <Screen edges={['top', 'left', 'right']} padded keyboardAware footer={composer}>
      <SafetyHeader
        title={ticket.ticket_no}
        subtitle={category?.label ?? 'Destek talebi'}
        right={
          isOpen ? (
            <IconButton
              name="checkmark-done-outline"
              accessibilityLabel="Talebi kapat"
              variant="surface"
              size={19}
              onPress={confirmClose}
            />
          ) : undefined
        }
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.summaryCard}>
          <AppText variant="title">{ticket.subject}</AppText>
          <View style={styles.statusRow}>
            <TicketStatusPill status={ticket.status_code} />
            {ticket.priority !== 'normal' ? (
              <View
                style={[
                  styles.priorityTag,
                  {
                    backgroundColor:
                      ticket.priority === 'urgent' ? theme.colors.dangerSoft : theme.colors.warningSoft,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={ticket.priority === 'urgent' ? 'danger' : 'warning'}
                >
                  {ticket.priority === 'urgent' ? 'Öncelikli' : 'Yüksek öncelik'}
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText variant="caption" color="textSecondary">
            {statusConfig.hint}
          </AppText>
          {isOpen && sla ? (
            <View
              style={[
                styles.slaRow,
                {
                  backgroundColor: sla.expired ? theme.colors.dangerSoft : theme.colors.surfaceMuted,
                  borderRadius: theme.radius.sm,
                },
              ]}
            >
              <Ionicons
                name="timer-outline"
                size={14}
                color={sla.expired ? theme.colors.danger : theme.colors.textSecondary}
              />
              <AppText variant="caption" color={sla.expired ? 'danger' : 'textSecondary'}>
                {sla.expired ? `Yanıt hedefi aşıldı · ${sla.label}` : `Kalan süre hedefi: ${sla.label}`}
              </AppText>
            </View>
          ) : null}
        </Card>

        <View style={styles.messages}>
          {ticket.messages.map((message, index) => {
            const previous = ticket.messages[index - 1];
            const showDay =
              !previous ||
              formatDayLabelTr(previous.created_at) !== formatDayLabelTr(message.created_at);
            return (
              <View key={message.id} style={styles.messageWrap}>
                {showDay ? (
                  <View style={styles.dayRow}>
                    <View style={[styles.dayLine, { backgroundColor: theme.colors.divider }]} />
                    <AppText variant="caption" color="textTertiary">
                      {formatDayLabelTr(message.created_at)}
                    </AppText>
                    <View style={[styles.dayLine, { backgroundColor: theme.colors.divider }]} />
                  </View>
                ) : null}
                <MessageBubble message={message} onOpenAttachment={openAttachment} />
              </View>
            );
          })}
        </View>

        {ticket.status_code === 'closed' ? null : (
          <View style={styles.helper}>
            {SAFETY_COMMITMENTS.slice(0, 2).map((commitment) => (
              <View key={commitment} style={styles.helperRow}>
                <Ionicons name="shield-checkmark-outline" size={13} color={theme.colors.success} />
                <AppText variant="caption" color="textTertiary" style={styles.flex}>
                  {commitment}
                </AppText>
              </View>
            ))}
            <AppText variant="caption" color="textTertiary">
              Acil durumlarda {SUPPORT_EMAIL} adresine de yazabilirsin.
            </AppText>
          </View>
        )}
      </ScrollView>

      <SafetySheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        title="Dosya ekle"
        subtitle="En fazla 3 dosya · 5 MB"
        scrollable={false}
        maxHeightRatio={0.5}
        footer={<Button label="Tamam" variant="secondary" onPress={() => setAttachOpen(false)} />}
      >
        <AttachmentPicker
          attachments={attachments}
          onChange={setAttachments}
          kind="support"
          onError={setError}
        />
      </SafetySheet>
    </Screen>
  );
}

function MessageBubble({
  message,
  onOpenAttachment,
}: {
  message: TicketMessage;
  onOpenAttachment: (attachment: Attachment) => void;
}) {
  const { theme } = useTheme();
  const isUser = message.author_role === 'user';
  const isInternal = Boolean(message.is_internal);

  const background = isInternal
    ? theme.colors.warningSoft
    : isUser
      ? theme.colors.primaryDeep
      : theme.colors.surface;
  const textColor = isUser && !isInternal ? theme.colors.onPrimary : theme.colors.text;

  return (
    <View style={[styles.bubbleWrap, !isUser && styles.bubbleWrapLeft]}>
      {!isUser ? (
        <View style={styles.authorRow}>
          <View style={[styles.agentAvatar, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="headset" size={12} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="caption" color="textSecondary">
            {isInternal ? 'İç not (yalnızca ekip)' : 'Trabzone Destek'}
          </AppText>
        </View>
      ) : null}

      <View
        style={[
          styles.bubble,
          {
            backgroundColor: background,
            borderColor: isUser ? 'transparent' : theme.colors.border,
            borderTopLeftRadius: isUser ? theme.radius.lg : 6,
            borderTopRightRadius: isUser ? 6 : theme.radius.lg,
            borderRadius: theme.radius.lg,
            maxWidth: '88%',
          },
        ]}
      >
        <AppText variant="body" color={textColor}>
          {message.body}
        </AppText>

        {(message.attachments ?? []).map((attachment) => (
          <Pressable
            key={attachment.path}
            accessibilityRole="button"
            accessibilityLabel={`${attachment.name} ekini aç`}
            onPress={() => onOpenAttachment(attachment)}
            style={[
              styles.attachment,
              {
                backgroundColor: isUser ? 'rgba(255,255,255,0.18)' : theme.colors.surfaceMuted,
                borderRadius: theme.radius.sm,
              },
            ]}
          >
            <Ionicons
              name={attachment.mime.includes('pdf') ? 'document-text-outline' : 'image-outline'}
              size={15}
              color={isUser ? theme.colors.onPrimary : theme.colors.primaryDeep}
            />
            <AppText
              variant="caption"
              color={isUser ? theme.colors.onPrimary : 'textSecondary'}
              numberOfLines={1}
              style={styles.flex}
            >
              {attachment.name}
            </AppText>
            <Ionicons
              name="open-outline"
              size={13}
              color={isUser ? theme.colors.onPrimary : theme.colors.textTertiary}
            />
          </Pressable>
        ))}

        <AppText
          variant="caption"
          color={isUser ? 'rgba(255,255,255,0.7)' : 'textTertiary'}
          style={styles.time}
        >
          {formatTimeTr(message.created_at)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingBottom: 24, gap: 14 },
  summaryCard: { gap: 7 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  priorityTag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  slaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 9, marginTop: 2 },
  messages: { gap: 4 },
  messageWrap: { gap: 4 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  bubbleWrap: { alignItems: 'flex-end' },
  bubbleWrapLeft: { alignItems: 'flex-start' },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  agentAvatar: { width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bubble: { padding: 12, gap: 7, borderWidth: StyleSheet.hairlineWidth },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 8 },
  time: { alignSelf: 'flex-end', fontSize: 10 },
  helper: { gap: 7, marginTop: 10, paddingHorizontal: 2 },
  helperRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  composer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pendingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pendingChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5 },
  pendingText: { maxWidth: 150 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 42, maxHeight: 110, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  closedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
