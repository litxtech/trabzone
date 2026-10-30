import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useMessageThreads,
  useMessages,
  useSendMessage,
} from '../hooks/use-accommodation';
import type { MessageThread } from '../types';
import {
  formatDateShort,
  formatDateTime,
  reservationTone,
} from '../utils/format';
import {
  EmptyState,
  InlineError,
  LoadingBlock,
  StatusPill,
} from './AccommodationUI';
import { useAccommodationLayout } from '../hooks/use-accommodation-layout';

const TEMPLATES = [
  'Rezervasyonunuz onaylandı, sizi bekliyoruz.',
  'Giriş saatimiz 14:00’ten itibaren geçerlidir.',
  'Talebiniz için teşekkürler, en kısa sürede dönüş yapacağız.',
];

export function MessagesManager({
  propertyId,
  initialReservationId,
}: {
  propertyId: string;
  initialReservationId?: string | null;
}) {
  const { theme } = useTheme();
  const layout = useAccommodationLayout();
  const threads = useMessageThreads(propertyId);
  const [selected, setSelected] = useState<MessageThread | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const messages = useMessages(propertyId, selected?.reservation_id);
  const send = useSendMessage(propertyId);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const items = threads.data?.items ?? [];
  const unreadTotal = items.reduce((sum, thread) => sum + thread.unread_count, 0);

  useEffect(() => {
    if (!selected && items.length > 0 && layout.isDesktop) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(items[0]!);
    }
  }, [items, selected, layout.isDesktop]);

  useEffect(() => {
    if (!initialReservationId) return;
    const match = items.find((thread) => thread.reservation_id === initialReservationId);
    if (match && match.reservation_id !== selected?.reservation_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(match);
    }
  }, [initialReservationId, items, selected?.reservation_id]);

  useEffect(() => {
    if (messages.data) {
      const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [messages.data]);

  const active = useMemo(
    () => items.find((thread) => thread.reservation_id === selected?.reservation_id) ?? selected,
    [items, selected],
  );

  const sendMessage = async () => {
    if (!selected || draft.trim().length === 0) return;
    setError(null);
    try {
      await send.mutateAsync({ reservationId: selected.reservation_id, body: draft.trim() });
      setDraft('');
      void messages.refetch();
      void threads.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mesaj gönderilemedi.');
    }
  };

  if (threads.isLoading) {
    return <LoadingBlock height={260} />;
  }

  if (threads.isError) {
    return (
      <InlineError
        message={threads.error instanceof Error ? threads.error.message : 'Mesajlar yüklenemedi.'}
        onRetry={() => void threads.refetch()}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Mesajlar</AppText>
          <AppText variant="caption" color="textTertiary">
            {items.length} görüşme{unreadTotal > 0 ? ` · ${unreadTotal} okunmamış` : ''}
          </AppText>
        </View>
      </View>

      {items.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="Mesaj yok"
          message="Misafirler rezervasyon üzerinden mesaj gönderdiğinde görüşmeler burada listelenir."
          compact
        />
      ) : (
        <View style={[styles.container, !layout.isDesktop && styles.containerMobile]}>
          {layout.isDesktop || !selected ? (
            <View style={[styles.threadList, { borderRightColor: theme.colors.divider }, layout.isDesktop && styles.threadListDesktop]}>
              <ScrollView contentContainerStyle={styles.threadListContent}>
                {items.map((thread) => {
                  const isActive = active?.reservation_id === thread.reservation_id;
                  return (
                    <Pressable
                      key={thread.reservation_id}
                      accessibilityRole="button"
                      accessibilityLabel={`${thread.guest_name} görüşmesi`}
                      onPress={() => setSelected(thread)}
                      style={[
                        styles.threadRow,
                        {
                          backgroundColor: isActive ? theme.colors.primarySoft : 'transparent',
                          borderBottomColor: theme.colors.divider,
                        },
                      ]}
                    >
                      <View style={[styles.avatar, { backgroundColor: theme.colors.surfaceMuted }]}>
                        <AppText variant="bodyStrong" color="textSecondary">
                          {thread.guest_name.slice(0, 1).toUpperCase()}
                        </AppText>
                      </View>
                      <View style={styles.flex}>
                        <View style={styles.threadTop}>
                          <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                            {thread.guest_name}
                          </AppText>
                          <AppText variant="caption" color="textTertiary" style={styles.tiny}>
                            {thread.last_message_at ? formatDateShort(thread.last_message_at.slice(0, 10)) : ''}
                          </AppText>
                        </View>
                        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                          {thread.last_message ?? 'Henüz mesaj yok'}
                        </AppText>
                        <View style={styles.threadMeta}>
                          <AppText variant="caption" color="textTertiary" style={styles.tiny}>
                            {thread.reservation_code}
                          </AppText>
                          <StatusPill
                            label={reservationTone(thread.status).label}
                            color={reservationTone(thread.status).color}
                            background={reservationTone(thread.status).background}
                          />
                          {thread.unread_count > 0 ? (
                            <View style={[styles.unread, { backgroundColor: theme.colors.primary }]}>
                              <AppText variant="caption" style={[styles.tiny, { color: theme.colors.onPrimary, fontSize: 8 }]}>
                                {thread.unread_count}
                              </AppText>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {active && (layout.isDesktop || selected) ? (
            <KeyboardAvoidingView
              style={styles.chat}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={100}
            >
              <View style={[styles.chatHead, { borderBottomColor: theme.colors.divider }]}>
                {!layout.isDesktop ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Görüşmeleri göster"
                    onPress={() => setSelected(null)}
                    style={styles.backButton}
                  >
                    <Ionicons name="chevron-back" size={19} color={theme.colors.text} />
                  </Pressable>
                ) : null}
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>{active.guest_name}</AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {active.reservation_code} · {formatDateShort(active.check_in)} – {formatDateShort(active.check_out)}
                  </AppText>
                </View>
              </View>

              <ScrollView ref={scrollRef} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled">
                {messages.isLoading ? (
                  <LoadingBlock height={120} />
                ) : (messages.data?.items ?? []).length === 0 ? (
                  <View style={styles.emptyChat}>
                    <Ionicons name="chatbubble-ellipses-outline" size={26} color={theme.colors.textTertiary} />
                    <AppText variant="caption" color="textTertiary">
                      İlk mesajı sen gönder. Misafire bildirim olarak iletilir.
                    </AppText>
                  </View>
                ) : (
                  (messages.data?.items ?? []).map((message) => {
                    const mine = message.sender_role === 'property';
                    return (
                      <View key={message.id} style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowGuest]}>
                        <View
                          style={[
                            styles.bubble,
                            {
                              backgroundColor: mine ? theme.colors.primary : theme.colors.surfaceMuted,
                              borderColor: theme.colors.border,
                            },
                          ]}
                        >
                          {!mine ? (
                            <AppText variant="caption" style={[styles.tiny, { color: theme.colors.primary }]}>
                              {message.sender_name ?? 'Misafir'}
                            </AppText>
                          ) : null}
                          <AppText
                            variant="body"
                            style={mine ? { color: theme.colors.onPrimary } : undefined}
                          >
                            {message.body}
                          </AppText>
                          <AppText
                            variant="caption"
                            style={[
                              styles.tiny,
                              styles.time,
                              { color: mine ? 'rgba(255,255,255,0.65)' : theme.colors.textTertiary },
                            ]}
                          >
                            {formatDateTime(message.created_at)}
                          </AppText>
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              {messages.data?.can_reply === false ? (
                <AppText variant="caption" color="textTertiary" style={styles.noReply}>
                  Bu görüşmede yanıt yetkiniz yok.
                </AppText>
              ) : (
                <View style={[styles.composer, { borderTopColor: theme.colors.divider }]}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templates}>
                    {TEMPLATES.map((template) => (
                      <Pressable
                        key={template}
                        accessibilityRole="button"
                        onPress={() => setDraft(template)}
                        style={[styles.template, { borderColor: theme.colors.border }]}
                      >
                        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                          {template}
                        </AppText>
                      </Pressable>
                    ))}
                  </ScrollView>
                  {error ? <InlineError message={error} /> : null}
                  <View style={styles.inputRow}>
                    <TextField
                      value={draft}
                      onChangeText={setDraft}
                      placeholder="Mesaj yaz…"
                      containerStyle={{ flex: 1 }}
                      multiline
                      numberOfLines={2}
                      onSubmitEditing={() => void sendMessage()}
                      returnKeyType="send"
                    />
                    <Button
                      label="Gönder"
                      size="sm"
                      fullWidth={false}
                      loading={send.isPending}
                      disabled={draft.trim().length === 0}
                      onPress={() => void sendMessage()}
                    />
                  </View>
                </View>
              )}
            </KeyboardAvoidingView>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  container: {
    flexDirection: 'row',
    minHeight: 480,
    height: '62vh',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
    borderColor: 'rgba(127,127,127,0.18)',
  },
  containerMobile: { flexDirection: 'column', height: '64vh' },
  threadList: { width: '100%', borderRightWidth: StyleSheet.hairlineWidth },
  threadListDesktop: { width: 300 },
  threadListContent: { paddingVertical: 2 },
  threadRow: { flexDirection: 'row', gap: 8, padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  threadTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  threadMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tiny: { fontSize: 9 },
  unread: { minWidth: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  chat: { flex: 1, minWidth: 0 },
  chatHead: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { padding: 3 },
  messages: { padding: 10, gap: 7, flexGrow: 1 },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 28 },
  messageRow: { flexDirection: 'row' },
  messageRowMine: { justifyContent: 'flex-end' },
  messageRowGuest: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 11, gap: 2, borderWidth: StyleSheet.hairlineWidth },
  time: { alignSelf: 'flex-end' },
  composer: { padding: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth },
  templates: { gap: 5, paddingBottom: 2 },
  template: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, maxWidth: 260 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  noReply: { padding: 10 },
});
