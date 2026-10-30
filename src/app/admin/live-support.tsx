import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminPage, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import {
  useAgentHeartbeat,
  useAgentQueueRealtime,
  useAgentThreads,
  useClaimAgentThread,
  useCloseLiveThread,
  useLiveThread,
  useLiveThreadRealtime,
  useMarkLiveRead,
  useReopenLiveThread,
  useSendLiveMessage,
} from '@/features/live-support/hooks/use-live-support';
import type { AgentThread } from '@/features/live-support/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatRelativeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

const STATUS_FILTERS = [
  { key: 'waiting', label: 'Bekleyen' },
  { key: 'active', label: 'Aktif' },
  { key: 'closed', label: 'Kapatılan' },
  { key: 'all', label: 'Tümü' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['key'];

function statusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'waiting') {
    return 'warning';
  }
  return 'neutral';
}

export default function AdminLiveSupportScreen() {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 1100;
  const me = useAdminMe();
  const adminId = me.data?.user_id ?? null;

  const [status, setStatus] = useState<StatusFilter>('waiting');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const markedRef = useRef<string | null>(null);

  const heartbeat = useAgentHeartbeat();
  const heartbeatRun = heartbeat.mutate;
  const threads = useAgentThreads(status === 'all' ? null : status);
  const thread = useLiveThread(selectedId);
  const claim = useClaimAgentThread();
  const send = useSendLiveMessage();
  const close = useCloseLiveThread();
  const reopen = useReopenLiveThread();
  const markRead = useMarkLiveRead();

  useAgentQueueRealtime(true);
  useLiveThreadRealtime(selectedId);

  useEffect(() => {
    heartbeatRun('online');
    const timer = setInterval(() => heartbeatRun('online'), 45_000);
    return () => {
      clearInterval(timer);
      heartbeatRun('offline');
    };
  }, [heartbeatRun]);

  const items = useMemo(() => threads.data?.items ?? [], [threads.data]);
  const selectedSummary = useMemo<AgentThread | null>(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const activeMessages = thread.data?.messages ?? [];
  const lastMessageId = activeMessages.length
    ? (activeMessages[activeMessages.length - 1]?.id ?? null)
    : null;

  useEffect(() => {
    if (!selectedId || !lastMessageId) {
      return;
    }
    const key = `${selectedId}:${lastMessageId}`;
    if (markedRef.current === key) {
      return;
    }
    markedRef.current = key;
    markRead.mutate(selectedId);
  }, [lastMessageId, markRead, selectedId]);

  const submitReply = () => {
    const body = draft.trim();
    if (!selectedId || body.length === 0) {
      return;
    }
    setNotice(null);
    send.mutate(
      { threadId: selectedId, body },
      {
        onSuccess: () => {
          setDraft('');
          haptics.success();
        },
        onError: (error) => {
          haptics.error();
          setNotice(error.message);
        },
      },
    );
  };

  const doClaim = () => {
    if (!selectedId) {
      return;
    }
    claim.mutate(selectedId, {
      onSuccess: () => haptics.success(),
      onError: (error) => setNotice(error.message),
    });
  };

  const updateStatus = (next: 'closed' | 'waiting') => {
    if (!selectedId) {
      return;
    }
    const onSuccess = () => haptics.success();
    const onError = (error: Error) => setNotice(error.message);
    if (next === 'closed') {
      close.mutate(
        { threadId: selectedId, reason: 'Destek ekibi tarafından kapatıldı.' },
        { onSuccess, onError },
      );
      return;
    }
    reopen.mutate(selectedId, { onSuccess, onError });
  };

  const detail = (
    <View
      style={[
        styles.detail,
        {
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
        },
        wide && styles.detailWide,
      ]}
    >
      {!selectedId ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="chatbubbles-outline" size={26} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="title">Görüşme seç</AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Soldaki kuyruktan bir görüşme seçtiğinde mesaj geçmişi ve yanıt alanı burada açılır.
          </AppText>
        </View>
      ) : thread.isLoading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : thread.isError || !thread.data ? (
        <View style={styles.empty}>
          <AppText variant="title">Görüşme yüklenemedi</AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Bu görüşmeye erişim yetkiniz olmayabilir.
          </AppText>
        </View>
      ) : (
        <>
          <View style={styles.detailHead}>
            <View style={styles.flex}>
              <View style={styles.rowTitle}>
                <AppText variant="title">#{thread.data.thread_no}</AppText>
                <Badge
                  label={
                    thread.data.status === 'waiting'
                      ? 'Bekliyor'
                      : thread.data.status === 'active'
                        ? 'Aktif'
                        : 'Kapalı'
                  }
                  tone={statusTone(thread.data.status)}
                />
                {thread.data.priority !== 'normal' ? (
                  <Badge label={`Öncelik: ${thread.data.priority}`} tone="danger" />
                ) : null}
              </View>
              <AppText variant="caption" color="textTertiary">
                {selectedSummary?.display_name ?? selectedSummary?.username ?? 'Kullanıcı'} ·{' '}
                {thread.data.category}
                {selectedSummary?.subject ? ` · ${selectedSummary.subject}` : ''}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {formatDateTimeTr(thread.data.created_at)} · Son mesaj{' '}
                {formatRelativeTr(thread.data.last_message_at)}
              </AppText>
            </View>
            <View style={styles.detailActions}>
              {!thread.data.assigned_to || thread.data.assigned_to !== adminId ? (
                <Button
                  label="Görüşmeyi al"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  loading={claim.isPending}
                  onPress={doClaim}
                />
              ) : null}
              {thread.data.status === 'closed' ? (
                <Button
                  label="Yeniden aç"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  loading={reopen.isPending}
                  onPress={() => updateStatus('waiting')}
                />
              ) : (
                <Button
                  label="Kapat"
                  size="sm"
                  variant="danger"
                  fullWidth={false}
                  loading={close.isPending}
                  onPress={() => updateStatus('closed')}
                />
              )}
            </View>
          </View>

          {thread.data.can_reply ? null : (
            <View style={[styles.notice, { backgroundColor: theme.colors.warningSoft }]}>
              <Ionicons name="lock-closed-outline" size={15} color={theme.colors.warning} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Görüşme kapatıldı. Yanıt yazmak için yeniden açın.
              </AppText>
            </View>
          )}

          <ScrollView
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
          >
            {activeMessages.length === 0 ? (
              <AppText variant="caption" color="textTertiary" align="center">
                Henüz mesaj yok.
              </AppText>
            ) : (
              activeMessages.map((message) => {
                const mine = message.author_role === 'agent';
                return (
                  <View
                    key={message.id}
                    style={[styles.messageRow, mine ? styles.messageRight : styles.messageLeft]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        {
                          backgroundColor: mine ? theme.colors.primarySoft : theme.colors.surface,
                          borderColor: mine ? theme.colors.primary : theme.colors.border,
                        },
                      ]}
                    >
                      <AppText variant="caption" color={mine ? 'primaryDeep' : 'textTertiary'}>
                        {mine ? 'Destek ekibi' : 'Kullanıcı'} · {formatDateTimeTr(message.created_at)}
                      </AppText>
                      <AppText variant="body">{message.body}</AppText>
                      {message.attachments.length > 0 ? (
                        <AppText variant="caption" color="textTertiary">
                          {message.attachments.length} ek dosya
                        </AppText>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {notice ? (
            <AppText variant="caption" color="danger">
              {notice}
            </AppText>
          ) : null}

          <View
            style={[
              styles.composer,
              { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border },
            ]}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={
                thread.data.can_reply
                  ? 'Yanıt yaz…'
                  : 'Görüşme kapalı. Yanıt için yeniden açın.'
              }
              placeholderTextColor={theme.colors.textTertiary}
              editable={thread.data.can_reply}
              multiline
              style={[styles.composerInput, { color: theme.colors.text }]}
              onSubmitEditing={submitReply}
              blurOnSubmit={false}
            />
            <Button
              label="Gönder"
              size="sm"
              fullWidth={false}
              disabled={!thread.data.can_reply || draft.trim().length === 0}
              loading={send.isPending}
              onPress={submitReply}
            />
          </View>
          <AppText variant="caption" color="textTertiary">
            Yanıtlar gerçek veritabanına yazılır ve kullanıcıya e-posta bildirimi kuyruğa alınır.
          </AppText>
        </>
      )}
    </View>
  );

  return (
    <AdminPage
      title="Canlı Destek"
      subtitle="Gerçek zamanlı destek kuyruğu. Çevrimiçi durum yalnızca son 2 dakikada sinyal gönderen temsilcilerden oluşur."
      refreshing={threads.isRefetching}
      onRefresh={() => void threads.refetch()}
      actions={
        <View style={[styles.presence, { backgroundColor: theme.colors.successSoft }]}>
          <View style={[styles.dot, { backgroundColor: theme.colors.success }]} />
          <AppText variant="caption" color="success" style={styles.bold}>
            {threads.data?.agents_online ?? 0} temsilci çevrimiçi
          </AppText>
        </View>
      }
    >
      <View style={[styles.shell, wide && styles.shellWide]}>
        <View
          style={[
            styles.queue,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.lg,
            },
            wide && styles.queueWide,
          ]}
        >
          <FilterChips
            value={status}
            onChange={(next) => {
              setStatus(next);
              setSelectedId(null);
            }}
            options={STATUS_FILTERS.map((item) => ({ key: item.key, label: item.label }))}
          />

          <ScrollView style={styles.queueScroll} contentContainerStyle={styles.queueList}>
            {threads.isLoading ? (
              <View style={styles.center}>
                <ActivityIndicator color={theme.colors.primary} />
              </View>
            ) : threads.isError ? (
              <View style={[styles.errorCard, { backgroundColor: theme.colors.dangerSoft }]}>
                <Ionicons name="lock-closed-outline" size={18} color={theme.colors.danger} />
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  `support.view` yetkisi gerekir.
                </AppText>
              </View>
            ) : items.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="checkmark-done-outline" size={28} color={theme.colors.success} />
                <AppText variant="body" color="textSecondary" align="center">
                  Bu kuyrukta görüşme yok.
                </AppText>
              </View>
            ) : (
              items.map((item) => {
                const active = item.id === selectedId;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      setSelectedId(item.id);
                      setDraft('');
                      setNotice(null);
                    }}
                    style={[
                      styles.queueItem,
                      {
                        backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <View style={styles.queueHead}>
                      <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                        {item.display_name ?? item.username ?? 'Kullanıcı'}
                      </AppText>
                      {item.unread > 0 ? <Badge label={String(item.unread)} tone="danger" /> : null}
                    </View>
                    <AppText variant="caption" color="textTertiary">
                      #{item.thread_no} · {item.category}
                    </AppText>
                    <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                      {item.last_message ?? 'Mesaj yok'}
                    </AppText>
                    <View style={styles.queueFoot}>
                      <Badge
                        label={
                          item.status === 'waiting'
                            ? 'Bekliyor'
                            : item.status === 'active'
                              ? 'Aktif'
                              : 'Kapalı'
                        }
                        tone={statusTone(item.status)}
                      />
                      <AppText variant="caption" color="textTertiary">
                        {formatRelativeTr(item.last_message_at)}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
        {detail}
      </View>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  presence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  shell: { gap: 12 },
  shellWide: { flexDirection: 'row', alignItems: 'flex-start' },
  queue: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  queueWide: { width: 360 },
  queueScroll: { maxHeight: 620 },
  queueList: { gap: 8, paddingBottom: 8 },
  queueItem: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  queueHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  queueFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 3,
  },
  detail: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
    minHeight: 440,
  },
  detailWide: { minHeight: 620, maxHeight: 720 },
  detailHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  detailActions: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 8 },
  messages: { flex: 1, minHeight: 180 },
  messagesContent: { gap: 8, paddingVertical: 4 },
  messageRow: { flexDirection: 'row' },
  messageLeft: { justifyContent: 'flex-start' },
  messageRight: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    gap: 3,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
  },
  composerInput: { flex: 1, minHeight: 38, maxHeight: 120, fontSize: 13, paddingVertical: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 10 },
});
