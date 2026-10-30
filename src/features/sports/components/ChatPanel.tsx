import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ActionSheet, AppText, Avatar } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useKeyboard } from '@/providers/keyboard';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useChatState, useMatchChat } from '../hooks/use-sports';
import * as api from '../services/sports-service';
import type { ChatMessage, ChatReportReason, ChatState, Fixture } from '../types';
import { opponentName } from '../utils/format';
import { LiveDot } from './MatchCenterFeedCard';
import { ReasonPrompt } from './ui';

const REPORT_REASONS: { key: ChatReportReason; label: string }[] = [
  { key: 'spam', label: 'Spam / reklam' },
  { key: 'hate', label: 'Nefret söylemi' },
  { key: 'harassment', label: 'Taciz / hakaret' },
  { key: 'violence', label: 'Şiddet / tehdit' },
  { key: 'sexual', label: 'Cinsel içerik' },
  { key: 'personal_info', label: 'Kişisel bilgi paylaşımı' },
  { key: 'other', label: 'Diğer' },
];

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

const QUICK_CHEERS = ['⚽', '🔥', '👏', '💙❤️', '😱', 'GOOOL!', 'Haydi Trabzon!', 'Bordo mavi!'];

// Açık ve koyu temada okunabilen orta tonlar.
const NAME_COLORS = ['#E0623A', '#2E8BC0', '#8E5CD9', '#1E9E5A', '#C2477F', '#B7791F', '#0F9AA8', '#6B7FD7'];

function nameColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length] ?? NAME_COLORS[0]!;
}

function authorLabel(message: ChatMessage): string {
  const author = message.author;
  if (!author) return message.is_mine ? 'Sen' : 'Taraftar';
  return author.display_name?.trim() || `${author.first_name ?? ''} ${author.last_name ?? ''}`.trim() || author.username;
}

const MessageRow = memo(function MessageRow({
  message,
  onLongPress,
  onLike,
  onOpenProfile,
}: {
  message: ChatMessage;
  onLongPress: (message: ChatMessage) => void;
  onLike: (message: ChatMessage) => void;
  onOpenProfile: (username: string) => void;
}) {
  const { theme } = useTheme();
  if (message.kind === 'system') {
    return (
      <View style={styles.system}>
        <AppText variant="caption" color="textSecondary" align="center">
          {message.body}
        </AppText>
      </View>
    );
  }
  const hidden = message.status !== 'visible';
  const moderator = message.kind === 'moderator';
  const name = authorLabel(message);
  const nameColor = moderator ? theme.colors.primary : nameColorFor(message.author?.id ?? name);
  return (
    <Pressable
      onLongPress={() => !hidden && onLongPress(message)}
      delayLongPress={280}
      style={[
        styles.row,
        moderator && { backgroundColor: theme.colors.primarySoft },
        message.pending && { opacity: 0.55 },
      ]}
      accessibilityHint="Seçenekler için basılı tut"
    >
      <Pressable onPress={() => message.author && onOpenProfile(message.author.username)} hitSlop={4} style={styles.avatar}>
        <Avatar uri={mediaPublicUrl('avatar', message.author?.avatar_path)} name={name} size={24} />
      </Pressable>
      <View style={styles.flex}>
        {message.reply_to ? (
          <View style={[styles.quote, { borderLeftColor: theme.colors.primary }]}>
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {message.reply_to.author_name ?? 'Taraftar'}: {message.reply_to.body ?? 'Mesaj kaldırıldı'}
            </AppText>
          </View>
        ) : null}
        <AppText variant="body" style={styles.line}>
          <Text style={[styles.time, { color: theme.colors.textTertiary }]}>{timeLabel(message.created_at)}  </Text>
          {message.is_mine ? (
            <Text style={[styles.author, styles.mine, { backgroundColor: theme.colors.primary, color: theme.colors.onPrimary }]}>
              {' '}
              {name}{' '}
            </Text>
          ) : (
            <Text
              style={[styles.author, { color: nameColor }]}
              onPress={message.author ? () => onOpenProfile(message.author!.username) : undefined}
            >
              {name}
            </Text>
          )}
          {message.author?.is_verified ? <Text style={{ color: theme.colors.primary }}> ✓</Text> : null}
          {moderator ? <Text style={[styles.modTag, { color: theme.colors.primaryDeep }]}> MOD</Text> : null}
          {'  '}
          <Text style={[{ color: hidden ? theme.colors.textTertiary : theme.colors.text }, hidden ? styles.italic : null]}>
            {hidden ? (message.status === 'removed' ? 'Bu mesaj moderatör tarafından kaldırıldı.' : 'Bu mesaj silindi.') : message.body}
          </Text>
        </AppText>
      </View>
      {!hidden && !message.pending ? (
        <Pressable onPress={() => onLike(message)} hitSlop={8} style={styles.like} accessibilityRole="button" accessibilityLabel="Beğen">
          <Ionicons
            name={message.liked ? 'heart' : 'heart-outline'}
            size={16}
            color={message.liked ? theme.colors.danger : theme.colors.textTertiary}
          />
          {message.like_count > 0 ? (
            <AppText variant="caption" color="textTertiary">
              {message.like_count}
            </AppText>
          ) : null}
        </Pressable>
      ) : null}
    </Pressable>
  );
});

function WelcomeCard({
  fixture,
  activeUsers,
  onRules,
}: {
  fixture: Fixture;
  activeUsers: number | null;
  onRules: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.welcome, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border }]}>
      <View style={styles.welcomeHead}>
        <View style={[styles.welcomeIcon, { backgroundColor: theme.colors.primary }]}>
          <Ionicons name="chatbubbles" size={18} color={theme.colors.onPrimary} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Canlı sohbete hoş geldin!</AppText>
          <AppText variant="caption" color="textSecondary">
            {opponentName(fixture)} maçını taraftarlarla birlikte yorumla
            {activeUsers ? ` · şu an ${activeUsers} kişi burada` : ''}
          </AppText>
        </View>
      </View>
      <AppText variant="caption" color="textSecondary">
        Saygılı ol, rakip taraftara da. Hakaret, reklam, bağlantı ve kişisel bilgi paylaşımı kaldırılır. Mesaja basılı
        tutarak yanıtlayabilir ya da bildirebilirsin.
      </AppText>
      <Pressable onPress={onRules} hitSlop={6} accessibilityRole="link">
        <AppText variant="label" color="primary">
          Topluluk kuralları
        </AppText>
      </Pressable>
    </View>
  );
}

function blockedReason(state: ChatState | undefined, signedIn: boolean): string | null {
  if (!signedIn) return 'Canlı sohbete mesaj göndermek için giriş yapmalısın.';
  if (!state) return null;
  if (state.state === 'disabled') return 'Canlı sohbet şu anda kapalı.';
  if (state.state === 'not_open') return 'Sohbet maçtan kısa süre önce açılacak.';
  if (state.state === 'closed') return 'Bu maçın sohbeti kapandı. Mesajlar arşivde okunabilir.';
  if (state.state === 'paused' && !state.me?.is_moderator) return 'Sohbet moderatörler tarafından geçici olarak duraklatıldı.';
  if (state.me && !state.me.account_active) return 'Hesabın aktif değil.';
  if (state.me?.sanction && !state.me.is_moderator) {
    const until = state.me.sanction.expires_at
      ? ` (${new Date(state.me.sanction.expires_at).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} tarihine kadar)`
      : '';
    return `Moderasyon kararıyla bu sohbette mesaj gönderemiyorsun${until}.`;
  }
  if (state.me?.child_protected && !state.me.is_moderator) return 'Hesap güvenlik ayarların herkese açık sohbete mesaj göndermeye izin vermiyor.';
  return null;
}

export function ChatPanel({ fixture, active }: { fixture: Fixture; active: boolean }) {
  const { theme } = useTheme();
  const router = useRouter();
  const keyboard = useKeyboard();
  const insets = useSafeAreaInsets();
  const chat = useMatchChat(fixture.id, active);
  const state = useChatState(fixture.id, active);
  const listRef = useRef<FlashListRef<ChatMessage>>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [seenCount, setSeenCount] = useState(0);
  const [menu, setMenu] = useState<ChatMessage | null>(null);
  const [reportFor, setReportFor] = useState<ChatMessage | null>(null);
  const [modAction, setModAction] = useState<{ kind: 'remove' | 'mute' | 'kick'; message: ChatMessage } | null>(null);

  const visibleMessages = chat.messages;
  const total = visibleMessages.length;
  const unseen = atBottom ? 0 : Math.max(0, total - seenCount);
  const reason = blockedReason(state.data, chat.signedIn);
  const isModerator = Boolean(state.data?.me?.is_moderator);
  const maxLength = state.data?.max_length ?? 280;

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const bottom = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
      setAtBottom(bottom);
      if (bottom) setSeenCount(total);
    },
    [total],
  );

  const jumpToBottom = () => {
    listRef.current?.scrollToEnd({ animated: true });
    setSeenCount(total);
    setAtBottom(true);
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending || reason) return;
    setSending(true);
    setError(null);
    const failure = await chat.send(body, replyTo);
    setSending(false);
    if (failure) {
      haptics.error();
      setError(failure);
      return;
    }
    haptics.success();
    setText('');
    setReplyTo(null);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const menuItems = useMemo(() => {
    if (!menu) return [];
    const items: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
      { key: 'reply', label: 'Yanıtla', icon: 'arrow-undo-outline' },
    ];
    if (menu.is_mine) items.push({ key: 'delete', label: 'Mesajımı sil', icon: 'trash-outline' as const });
    else items.push({ key: 'report', label: 'Mesajı bildir', icon: 'flag-outline' as const });
    if (isModerator && !menu.is_mine) {
      items.push({ key: 'mod_remove', label: 'Moderatör: mesajı kaldır', icon: 'remove-circle-outline' as const });
      items.push({ key: 'mod_mute', label: 'Moderatör: 30 dk sustur', icon: 'volume-mute-outline' as const });
      items.push({ key: 'mod_kick', label: 'Moderatör: sohbetten çıkar', icon: 'exit-outline' as const });
    }
    return items;
  }, [isModerator, menu]);

  const onMenuSelect = async (key: string) => {
    const message = menu;
    setMenu(null);
    if (!message) return;
    if (key === 'reply') setReplyTo(message);
    if (key === 'delete') {
      const failure = await chat.remove(message);
      if (failure) setError(failure);
    }
    if (key === 'report') setReportFor(message);
    if (key === 'mod_remove') setModAction({ kind: 'remove', message });
    if (key === 'mod_mute') setModAction({ kind: 'mute', message });
    if (key === 'mod_kick') setModAction({ kind: 'kick', message });
  };

  const runModAction = async (reasonText: string) => {
    const action = modAction;
    setModAction(null);
    if (!action) return;
    const result =
      action.kind === 'remove'
        ? await api.modRemoveChat(action.message.id, reasonText)
        : action.message.author
          ? await api.modSanction(action.message.author.id, action.kind, action.kind === 'mute' ? 30 : 30, reasonText, fixture.id)
          : null;
    if (result && !result.ok) setError(result.error.message);
    else haptics.success();
  };

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageRow
        message={item}
        onLongPress={setMenu}
        onLike={(message) => void chat.toggleLike(message)}
        onOpenProfile={(username) => router.push(`/profile/${username}` as never)}
      />
    ),
    [chat, router],
  );

  if (!chat.signedIn) {
    return (
      <View style={styles.center}>
        <Ionicons name="chatbubbles-outline" size={30} color={theme.colors.primary} />
        <AppText variant="bodyStrong" align="center">
          Canlı sohbete hoş geldin!
        </AppText>
        <AppText variant="body" color="textSecondary" align="center">
          {opponentName(fixture)} maçını taraftarlarla anlık yorumla. Sohbet üyelere açık; okumak ve katılmak için giriş yap.
        </AppText>
        <Pressable onPress={() => router.push('/login' as never)} style={[styles.loginButton, { backgroundColor: theme.colors.primary }]}>
          <AppText variant="label" color="onPrimary">
            Giriş yap
          </AppText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={[styles.statusBar, { borderBottomColor: theme.colors.border }]}>
        {fixture.status.is_live ? <LiveDot /> : <View style={[styles.connDot, { backgroundColor: chat.connected ? '#16A34A' : '#F59E0B' }]} />}
        <AppText variant="label">Canlı sohbet</AppText>
        <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
          {chat.connected ? '' : '· yeniden bağlanıyor'}
        </AppText>
        {chat.activeUsers != null ? (
          <View style={styles.viewers} accessibilityLabel={`${chat.activeUsers} aktif kullanıcı`}>
            <Ionicons name="people-outline" size={14} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">
              {chat.activeUsers}
            </AppText>
          </View>
        ) : null}
        {state.data && state.data.slow_mode_seconds > 0 ? (
          <AppText variant="caption" color="warning">
            Yavaş mod {state.data.slow_mode_seconds} sn
          </AppText>
        ) : null}
      </View>

      {state.data?.pinned?.body ? (
        <View style={[styles.pinned, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="megaphone-outline" size={15} color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="primaryDeep" style={styles.flex}>
            {state.data.pinned.body}
          </AppText>
        </View>
      ) : null}

      <View style={styles.flex}>
        {chat.loading && total === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : chat.error && total === 0 ? (
          <Pressable style={styles.center} onPress={() => void chat.refresh()}>
            <AppText variant="body" color="textSecondary" align="center">
              {chat.error}
            </AppText>
          </Pressable>
        ) : (
          <FlashList
            ref={listRef}
            data={visibleMessages}
            renderItem={renderItem}
            keyExtractor={(item) => (item.client_id && item.pending ? item.client_id : String(item.id))}
            getItemType={(item) => item.kind}
            onScroll={onScroll}
            scrollEventThrottle={64}
            maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 0.15, startRenderingFromBottom: true }}
            onStartReached={() => void chat.loadOlder()}
            onStartReachedThreshold={0.3}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <WelcomeCard
                fixture={fixture}
                activeUsers={chat.activeUsers}
                onRules={() => router.push('/community-guidelines' as never)}
              />
            }
            ListEmptyComponent={
              <AppText variant="body" color="textSecondary" align="center" style={styles.empty}>
                Henüz mesaj yok. İlk mesajı sen yaz, sohbeti başlat!
              </AppText>
            }
          />
        )}
        {unseen > 0 ? (
          <Pressable onPress={jumpToBottom} style={[styles.newPill, { backgroundColor: theme.colors.primary }]} accessibilityRole="button">
            <Ionicons name="arrow-down" size={14} color={theme.colors.onPrimary} />
            <AppText variant="label" color="onPrimary">
              {unseen > 99 ? '99+' : unseen} yeni mesaj
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Pressable onPress={() => setError(null)} style={[styles.errorBar, { backgroundColor: theme.colors.dangerSoft }]}>
          <AppText variant="caption" color="danger" style={styles.flex}>
            {error}
          </AppText>
          <Ionicons name="close" size={14} color={theme.colors.danger} />
        </Pressable>
      ) : null}

      {reason ? (
        <View style={[styles.blocked, { borderTopColor: theme.colors.border }]}>
          <Ionicons name="lock-closed-outline" size={15} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            {reason}
          </AppText>
        </View>
      ) : (
        <View
          style={[
            styles.composer,
            {
              borderTopColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              paddingBottom: keyboard.isVisible ? 8 : Math.max(insets.bottom, 10),
            },
          ]}
        >
          {replyTo ? (
            <View style={styles.replyRow}>
              <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
                Yanıtlanıyor: {authorLabel(replyTo)} · {replyTo.body}
              </AppText>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                <Ionicons name="close" size={14} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.cheers}>
            {QUICK_CHEERS.map((cheer) => (
              <Pressable
                key={cheer}
                onPress={() => {
                  haptics.selection();
                  setText((current) => `${current.trimEnd()}${current.trim() ? ' ' : ''}${cheer}`.slice(0, maxLength));
                }}
                style={({ pressed }) => [
                  styles.cheer,
                  { backgroundColor: theme.colors.inputBackground, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${cheer} ekle`}
              >
                <AppText variant="label">{cheer}</AppText>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Maç hakkında yaz…"
              placeholderTextColor={theme.colors.textTertiary}
              maxLength={maxLength}
              multiline
              style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.inputBackground }]}
              onSubmitEditing={() => void submit()}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={() => void submit()}
              disabled={!text.trim() || sending}
              style={[styles.send, { backgroundColor: theme.colors.primary, opacity: !text.trim() || sending ? 0.45 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Gönder"
            >
              {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={16} color="#fff" />}
            </Pressable>
          </View>
          {text.length > maxLength * 0.8 ? (
            <AppText variant="caption" color="textTertiary" align="right">
              {text.length}/{maxLength}
            </AppText>
          ) : null}
        </View>
      )}

      <ActionSheet
        visible={Boolean(menu)}
        title={menu ? authorLabel(menu) : undefined}
        message={menu?.body ?? undefined}
        items={menuItems}
        onSelect={(key) => void onMenuSelect(key)}
        onClose={() => setMenu(null)}
      />
      <ActionSheet
        visible={Boolean(reportFor)}
        title="Mesajı bildir"
        items={REPORT_REASONS.map((item) => ({ key: item.key, label: item.label }))}
        onSelect={(key) => {
          const message = reportFor;
          setReportFor(null);
          if (!message) return;
          void api.reportChat(message.id, key as ChatReportReason).then((result) => {
            if (result.ok) haptics.success();
            else setError(result.error.message);
          });
        }}
        onClose={() => setReportFor(null)}
      />
      <ReasonPrompt
        visible={Boolean(modAction)}
        title={
          modAction?.kind === 'remove' ? 'Mesajı kaldır' : modAction?.kind === 'mute' ? 'Kullanıcıyı 30 dk sustur' : 'Sohbetten çıkar (30 dk)'
        }
        destructive
        onCancel={() => setModAction(null)}
        onConfirm={(value) => void runModAction(value)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 28 },
  loginButton: { marginTop: 8, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  pinned: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 8, borderRadius: 12, padding: 10 },
  listContent: { paddingHorizontal: 12, paddingVertical: 8 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 5, paddingHorizontal: 6, borderRadius: 10 },
  avatar: { paddingTop: 1 },
  line: { lineHeight: 21 },
  time: { fontSize: 11 },
  author: { fontWeight: '700' },
  mine: { borderRadius: 4, overflow: 'hidden' },
  modTag: { fontSize: 11, fontWeight: '800' },
  quote: { borderLeftWidth: 2, paddingLeft: 6, marginBottom: 2 },
  italic: { fontStyle: 'italic' },
  like: { alignItems: 'center', paddingTop: 3, minWidth: 24 },
  welcome: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8, marginBottom: 10 },
  welcomeHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  welcomeIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: 24, paddingHorizontal: 20 },
  viewers: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cheers: { gap: 6 },
  cheer: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  system: { paddingVertical: 8, paddingHorizontal: 20 },
  newPill: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  errorBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
  blocked: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, gap: 6 },
  replyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, borderRadius: 18, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, maxHeight: 110, fontSize: 15 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
