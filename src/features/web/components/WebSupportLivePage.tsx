import { Ionicons } from '@expo/vector-icons';
import { Link, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { AppText, Button, Card, Skeleton } from '@/components/ui';
import {
  useCloseLiveThread,
  useLivePresence,
  useLiveThread,
  useLiveThreadRealtime,
  useMarkLiveRead,
  useMyLiveThreads,
  useReopenLiveThread,
  useSendLiveMessage,
  useStartLiveThread,
} from '@/features/live-support/hooks/use-live-support';
import type { LiveThreadStatus } from '@/features/live-support/types';
import { LIVE_CATEGORIES } from '@/features/live-support/types';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

import { useWebMeta } from '../use-web-meta';
import { PublicShell } from './PublicShell';

const STATUS_LABEL: Record<LiveThreadStatus, string> = {
  waiting: 'Sırada',
  active: 'Görüşmede',
  closed: 'Kapatıldı',
};

const STATUS_COLOR: Record<LiveThreadStatus, string> = {
  waiting: '#B45309',
  active: '#047857',
  closed: '#64748B',
};

export function WebSupportLivePage() {
  const { theme } = useTheme();
  const authStatus = useAuthStatus();

  useWebMeta({
    title: 'Trabzone Canlı Destek',
    description:
      'Trabzone canlı destek ekibiyle gerçek zamanlı yazışın veya çevrimdışıyken mesaj bırakın.',
    path: '/support/live',
    noIndex: true,
  });

  return (
    <PublicShell title="Canlı Destek" fallbackHref="/support">
      <View style={[styles.hero, Platform.OS !== 'web' && styles.heroNative]}>
        <View style={styles.heroInner}>
          <AppText variant="caption" color="#8EA6D8" style={styles.eyebrow}>
            TRABZONE DESTEK MERKEZİ
          </AppText>
          <AppText variant="h1" color="#FFFFFF" style={styles.heroTitle}>
            Canlı Destek
          </AppText>
          <AppText variant="body" color="#A9BDE2" style={styles.heroSummary}>
            Görüşmelerin gerçek zamanlı olarak kaydedilir. Temsilciler çevrimdışıyken mesaj
            bırakabilir, döndüklerinde yanıt alabilirsin.
          </AppText>
        </View>
      </View>
      <View style={styles.body}>
        {authStatus === 'booting' ? (
          <Skeleton height={320} radius={16} />
        ) : authStatus !== 'authenticated' ? (
          <Card style={styles.authCard}>
            <View style={[styles.authIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="chatbubbles-outline" size={26} color={theme.colors.primaryDeep} />
            </View>
            <AppText variant="h2">Canlı destek için giriş yap</AppText>
            <AppText variant="body" color="textSecondary">
              Görüşme geçmişinin hesabına bağlanması ve güvenli iletişim için oturum açman gerekir.
              Giriş yapamıyorsan destek talebi oluşturabilir veya iletişim formunu kullanabilirsin.
            </AppText>
            <View style={styles.inlineActions}>
              <Link href={'/login' as Href} asChild>
                <Button label="Giriş Yap" size="sm" style={styles.inlineButton} />
              </Link>
              <Link href={'/support' as Href} asChild>
                <Button
                  label="Destek Merkezi"
                  variant="secondary"
                  size="sm"
                  style={styles.inlineButton}
                />
              </Link>
              <Link href={'/contact' as Href} asChild>
                <Button label="İletişim" variant="outline" size="sm" style={styles.inlineButton} />
              </Link>
            </View>
          </Card>
        ) : (
          <LiveChat />
        )}
      </View>
    </PublicShell>
  );
}

function LiveChat() {
  const { theme } = useTheme();
  const { data: presence } = useLivePresence();
  const { data: threads, isLoading } = useMyLiveThreads();
  const startThread = useStartLiveThread();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('account');
  const [starting, setStarting] = useState(false);

  // Seçim kullanıcıdan gelmiyorsa ilk görüşme gösterilir. Böylece "ilk
  // görüşmeyi seç" senkronizasyonu için effect + setState gerekmez.
  const selectedId = pickedId ?? threads?.[0]?.id ?? null;
  const selected = threads?.find((thread) => thread.id === selectedId) ?? null;
  const liveOnline = presence?.online ?? false;

  const start = () => {
    startThread.mutate(
      { category },
      {
        onSuccess: (data) => {
          setPickedId(data.id);
          setStarting(false);
        },
      },
    );
  };

  return (
    <View style={styles.layout}>
      <View style={styles.sidebar}>
        <Card style={styles.sidebarCard}>
          <View style={styles.liveStatusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: liveOnline ? theme.colors.success : theme.colors.textTertiary },
              ]}
            />
            <AppText variant="bodyStrong">
              {liveOnline ? 'Canlı destek aktif' : 'Temsilciler çevrimdışı'}
            </AppText>
          </View>
          <AppText variant="caption" color="textSecondary">
            {liveOnline
              ? `${presence?.agents_online ?? 0} temsilci çevrimiçi.`
              : 'Mesajını bırak; ekip döndüğünde yanıtlayacak.'}
          </AppText>
          <Button
            label={starting ? 'Vazgeç' : 'Yeni görüşme'}
            size="sm"
            variant={starting ? 'secondary' : 'primary'}
            onPress={() => setStarting((value) => !value)}
          />
          {starting ? (
            <View style={styles.startPanel}>
              <AppText variant="caption" color="textTertiary">
                Konu seç
              </AppText>
              <View style={styles.categoryChips}>
                {LIVE_CATEGORIES.map((item) => {
                  const active = item.code === category;
                  return (
                    <Pressable
                      key={item.code}
                      onPress={() => setCategory(item.code)}
                      style={[
                        styles.chip,
                        {
                          borderColor: active ? theme.colors.primary : theme.colors.border,
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                        },
                      ]}
                    >
                      <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                        {item.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
              <Button
                label="Görüşmeyi başlat"
                size="sm"
                loading={startThread.isPending}
                onPress={start}
              />
            </View>
          ) : null}
        </Card>

        <Card style={styles.sidebarCard}>
          <AppText variant="overline" color="textTertiary">
            GÖRÜŞMELERİM
          </AppText>
          {isLoading ? <Skeleton height={48} radius={10} /> : null}
          {!isLoading && (!threads || threads.length === 0) ? (
            <AppText variant="caption" color="textTertiary">
              Henüz bir canlı destek görüşmen yok.
            </AppText>
          ) : null}
          {threads?.map((thread) => {
            const active = thread.id === selectedId;
            return (
              <Pressable
                key={thread.id}
                onPress={() => setPickedId(thread.id)}
                style={[
                  styles.threadRow,
                  active ? { backgroundColor: theme.colors.primarySoft } : null,
                ]}
              >
                <View style={styles.flex}>
                  <AppText variant={active ? 'bodyStrong' : 'body'} numberOfLines={1}>
                    {thread.subject ??
                      LIVE_CATEGORIES.find((item) => item.code === thread.category)?.label ??
                      'Destek görüşmesi'}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {thread.thread_no} · {STATUS_LABEL[thread.status]}
                  </AppText>
                </View>
                {thread.unread > 0 ? (
                  <View style={[styles.unread, { backgroundColor: theme.colors.primary }]}>
                    <AppText variant="caption" color="#FFFFFF">
                      {thread.unread}
                    </AppText>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </Card>

        <Card tone="muted" elevated={false} style={styles.sidebarCard}>
          <AppText variant="caption" color="textSecondary">
            Acil çocuk güvenliği bildirimleri için destek merkezindeki ayrı kanalı kullan. Canlı
            destekte paylaşılan hassas bilgiler yalnızca yetkili temsilciler tarafından görülebilir.
          </AppText>
          <Link href={'/child-safety' as Href} asChild>
            <Button label="Çocuk Güvenliği Politikası" variant="outline" size="sm" />
          </Link>
        </Card>
      </View>

      <View style={styles.chatArea}>
        {selected ? (
          <ChatPanel threadId={selected.id} />
        ) : (
          <Card style={styles.emptyChat}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={34}
              color={theme.colors.textTertiary}
            />
            <AppText variant="h3">Bir görüşme seç</AppText>
            <AppText variant="body" color="textSecondary" align="center">
              Soldan mevcut bir görüşmeyi açabilir veya yeni bir canlı destek görüşmesi
              başlatabilirsin.
            </AppText>
          </Card>
        )}
      </View>
    </View>
  );
}

function ChatPanel({ threadId }: { threadId: string }) {
  const { theme } = useTheme();
  const { data: thread, isLoading } = useLiveThread(threadId);
  const send = useSendLiveMessage();
  const close = useCloseLiveThread();
  const reopen = useReopenLiveThread();
  const markRead = useMarkLiveRead();
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const [draft, setDraft] = useState('');
  const markedRef = useRef<string | null>(null);

  useLiveThreadRealtime(threadId);

  useEffect(() => {
    if (thread && markedRef.current !== threadId) {
      markedRef.current = threadId;
      markRead.mutate(threadId);
    }
  }, [markRead, thread, threadId]);

  useEffect(() => {
    if (thread?.messages.length) {
      const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [thread?.messages.length]);

  const sendMessage = () => {
    const body = draft.trim();
    if (!body || !thread?.can_reply) return;
    send.mutate(
      { threadId, body },
      {
        onSuccess: () => setDraft(''),
      },
    );
  };

  if (isLoading || !thread) {
    return (
      <Card style={styles.chatCard}>
        <Skeleton height={280} radius={12} />
      </Card>
    );
  }

  const closed = thread.status === 'closed';

  return (
    <Card style={styles.chatCard}>
      <View style={[styles.chatHead, { borderBottomColor: theme.colors.border }]}>
        <View style={styles.flex}>
          <AppText variant="h3">
            {thread.subject ??
              LIVE_CATEGORIES.find((item) => item.code === thread.category)?.label ??
              'Canlı destek'}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {thread.thread_no} · {formatDateTr(thread.created_at)}
          </AppText>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: `${STATUS_COLOR[thread.status]}18` }]}>
          <AppText variant="caption" color={STATUS_COLOR[thread.status]}>
            {STATUS_LABEL[thread.status]}
          </AppText>
        </View>
        {closed ? (
          <Button
            label="Yeniden aç"
            variant="outline"
            size="sm"
            loading={reopen.isPending}
            onPress={() => reopen.mutate(threadId)}
          />
        ) : (
          <Button
            label="Kapat"
            variant="ghost"
            size="sm"
            loading={close.isPending}
            onPress={() => close.mutate({ threadId, reason: null })}
          />
        )}
      </View>

      {thread.status === 'waiting' ? (
        <View style={[styles.noticeBox, { backgroundColor: theme.colors.warningSoft }]}>
          <Ionicons name="time-outline" size={16} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Görüşmen sırada. Bir temsilci katıldığında mesajların yanıtlanacak. Bu sırada mesaj
            bırakabilirsin.
          </AppText>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
      >
        {thread.messages.length === 0 ? (
          <AppText variant="caption" color="textTertiary" align="center">
            Henüz mesaj yok. İlk mesajını yazarak başla.
          </AppText>
        ) : null}
        {thread.messages.map((message) => {
          if (message.author_role === 'system') {
            return (
              <View key={message.id} style={styles.systemMessage}>
                <AppText variant="caption" color="textTertiary" align="center">
                  {message.body}
                </AppText>
              </View>
            );
          }
          const mine = message.author_role === 'user';
          return (
            <View
              key={message.id}
              style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowAgent]}
            >
              {!mine ? (
                <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="headset-outline" size={15} color={theme.colors.primaryDeep} />
                </View>
              ) : null}
              <View
                style={[
                  styles.bubble,
                  mine
                    ? { backgroundColor: theme.colors.primaryDeep, borderBottomRightRadius: 4 }
                    : { backgroundColor: theme.colors.surfaceMuted, borderBottomLeftRadius: 4 },
                ]}
              >
                <AppText variant="caption" color={mine ? '#FFFFFF' : 'textSecondary'}>
                  {message.body}
                </AppText>
                <AppText
                  variant="caption"
                  color={mine ? '#C9D7F0' : 'textTertiary'}
                  style={styles.messageTime}
                >
                  {new Date(message.created_at).toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </AppText>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.composer, { borderTopColor: theme.colors.border }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={closed ? 'Görüşme kapatıldı. Yeniden açarak yazabilirsin.' : 'Mesajını yaz…'}
          placeholderTextColor={theme.colors.textTertiary}
          editable={!closed && thread.can_reply}
          multiline
          style={[
            styles.composerInput,
            {
              backgroundColor: theme.colors.surfaceMuted,
              color: theme.colors.text,
              borderColor: theme.colors.border,
            },
          ]}
          onSubmitEditing={sendMessage}
        />
        <Button
          label="Gönder"
          size="sm"
          loading={send.isPending}
          disabled={!draft.trim() || closed || !thread.can_reply}
          onPress={sendMessage}
          style={styles.sendButton}
        />
      </View>
      {send.isError ? (
        <AppText variant="caption" color="danger">
          Mesaj gönderilemedi. Lütfen tekrar dene.
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { backgroundColor: '#07152E', paddingTop: 56, paddingBottom: 42, paddingHorizontal: 20 },
  heroNative: { paddingTop: 20, paddingBottom: 24 },
  heroInner: { width: '100%', maxWidth: 1160, alignSelf: 'center' },
  eyebrow: { letterSpacing: 1.6, marginBottom: 10 },
  heroTitle: { maxWidth: 760 },
  heroSummary: { marginTop: 12, maxWidth: 700, lineHeight: 24 },
  body: {
    width: '100%',
    maxWidth: 1160,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 50,
  },
  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' },
  sidebar: { width: 320, gap: 14 },
  sidebarCard: { gap: 10, padding: 16 },
  chatArea: { flex: 1, minWidth: 320 },
  authCard: { gap: 12, padding: 28, maxWidth: 620 },
  authIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  inlineButton: { minWidth: 140 },
  liveStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  startPanel: { gap: 8, marginTop: 4 },
  categoryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
  },
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  emptyChat: { alignItems: 'center', gap: 8, padding: 44 },
  chatCard: { height: 620, padding: 0, overflow: 'hidden' },
  chatHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderBottomWidth: 1,
  },
  statusBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  noticeBox: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    margin: 12,
    marginBottom: 0,
    borderRadius: 10,
  },
  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 10 },
  systemMessage: { paddingVertical: 4 },
  messageRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', maxWidth: '82%' },
  messageRowMine: { alignSelf: 'flex-end', justifyContent: 'flex-end' },
  messageRowAgent: { alignSelf: 'flex-start' },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, gap: 3, flexShrink: 1 },
  messageTime: { fontSize: 10 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
  },
  composerInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendButton: { width: 100 },
});
