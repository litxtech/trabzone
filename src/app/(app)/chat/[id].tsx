import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import {
  ActionSheet,
  AppImage,
  AppText,
  Avatar,
  IconButton,
  Screen,
  ScreenHeader,
} from '@/components/ui';
import { MediaViewer, type ViewerMedia } from '@/features/feed/components/MediaViewer';
import { VideoThumbnail } from '@/features/media/components/VideoThumbnail';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { shareContent } from '@/features/share/share-action';
import { useBlockUser } from '@/features/profile/hooks/use-profile-mutations';
import { pickMedia } from '@/features/media/media-picker';
import { signedMessageUrls } from '@/features/media/media-service';
import {
  cachedVideoPoster,
  formatVideoDuration,
  generateVideoPoster,
  prepareVideoForUpload,
} from '@/features/media/video-service';
import {
  flattenMessages,
  useChatMembers,
  useConversationRealtime,
  useDeleteMessage,
  useEditMessage,
  useMarkConversationRead,
  useMarkMessagesDelivered,
  useMessages,
  useSendMessage,
  useStartCall,
  useTypingIndicator,
  type PendingMediaUpload,
} from '@/features/messaging/hooks/use-chat';
import {
  isLocalMediaPath,
  type ChatMessage,
  type MessageKind,
} from '@/features/messaging/services/messaging-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useKeyboard } from '@/providers/keyboard';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDayLabelTr, formatTimeTr } from '@/utils/date';
import { toMessage } from '@/utils/error-message';
import { haptics } from '@/utils/haptics';

type ReplyTarget = { id: string; name: string; body: string; hasMedia: boolean } | null;

type PendingAttachment = {
  id: string;
  uri: string;
  kind: MessageKind;
  mime?: string | null;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  size?: number | null;
  /** Video seçildiği anda üretilen yerel kapak. */
  posterUri?: string | null;
};

type ViewerState = { items: ViewerMedia[]; index: number } | null;

export default function ChatScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboard();
  const conversationId = typeof params.id === 'string' ? params.id : '';
  const session = useSession();
  const myId = session?.user?.id ?? null;

  const messagesQuery = useMessages(conversationId);
  const members = useChatMembers(conversationId);
  const sendMessage = useSendMessage(conversationId);
  const editMessage = useEditMessage(conversationId);
  const deleteMessage = useDeleteMessage(conversationId);
  const markRead = useMarkConversationRead(conversationId);
  const markDelivered = useMarkMessagesDelivered(conversationId);
  const startCall = useStartCall();
  const blockUser = useBlockUser();
  const { openReport } = useReportSheet();
  useConversationRealtime(conversationId);

  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<ReplyTarget>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menuMessage, setMenuMessage] = useState<ChatMessage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [viewer, setViewer] = useState<ViewerState>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const awayRef = useRef(false);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Aynı anda birden çok medya gönderimi olabilir; ilerleme çubuğu sayaçla yönetilir. */
  const uploadCountRef = useRef(0);

  const typing = useTypingIndicator(conversationId, myId, draft.length > 0);

  const messages = useMemo(() => flattenMessages(messagesQuery.data), [messagesQuery.data]);
  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  const mediaPaths = useMemo(
    () =>
      messages.flatMap((message) => {
        const paths: string[] = [];
        if (message.media_path && !isLocalMediaPath(message.media_path)) {
          paths.push(message.media_path);
        }
        for (const item of message.media) {
          if (!isLocalMediaPath(item.storage_path)) {
            paths.push(item.storage_path);
          }
          if (item.thumbnail_path) {
            paths.push(item.thumbnail_path);
          }
        }
        const thumb = (message.media_meta as { thumb_path?: unknown } | null)?.thumb_path;
        if (typeof thumb === 'string' && thumb) {
          paths.push(thumb);
        }
        return paths;
      }),
    [messages],
  );
  const mediaKey = mediaPaths.join('|');
  const signedMedia = useQuery({
    queryKey: ['chat', 'signed', conversationId, mediaKey],
    queryFn: () => signedMessageUrls(mediaPaths),
    enabled: mediaPaths.length > 0,
    staleTime: 30 * 60_000,
  });

  const conversation = useMemo(() => {
    const memberList = members.data ?? [];
    const others = memberList.filter((member) => member.user_id !== myId);
    const isGroup = others.length !== 1 || memberList.length > 2;
    const title = isGroup
      ? others.length > 0
        ? others
            .map((member) => member.first_name ?? member.username)
            .slice(0, 3)
            .join(', ')
        : 'Grup sohbeti'
      : (() => {
          const peer = others[0];
          if (!peer) {
            return 'Sohbet';
          }
          return `${peer.first_name ?? ''} ${peer.last_name ?? ''}`.trim() || peer.username;
        })();
    return {
      isGroup,
      title,
      avatarPath: isGroup ? null : (others[0]?.avatar_path ?? null),
      peerId: isGroup ? null : (others[0]?.user_id ?? null),
      peerName: isGroup ? null : (others[0]?.username ?? null),
    };
  }, [members.data, myId]);

  // Okunmamış mesajları sunucuda işaretle. Eskiden her mesaj sayısı
  // değişiminde iki RPC çalışıyordu; artık yalnızca en yeni sunucu mesajı
  // değiştiğinde bir kez çalışır (iyimser "temp-" satırlar beklenir).
  const newestMessageId = messages[messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!conversationId || !newestMessageId || newestMessageId.startsWith('temp-')) {
      return;
    }
    markDelivered.mutate();
    markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, newestMessageId]);

  useEffect(
    () => () => {
      if (highlightTimer.current) {
        clearTimeout(highlightTimer.current);
      }
    },
    [],
  );

  const closeMenus = useCallback(() => {
    setMenuOpen(false);
    setMenuMessage(null);
  }, []);

  const clearHighlightSoon = useCallback(() => {
    if (highlightTimer.current) {
      clearTimeout(highlightTimer.current);
    }
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1600);
  }, []);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      const index = reversed.findIndex((message) => message.id === messageId);
      if (index < 0) {
        Alert.alert('Mesaj bulunamadı', 'Yanıtlanan mesaj bu sohbette artık yok.');
        return;
      }
      setHighlightId(messageId);
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      clearHighlightSoon();
    },
    [clearHighlightSoon, reversed],
  );

  const beginReply = useCallback((message: ChatMessage) => {
    setEditing(null);
    setReply({
      id: message.id,
      name: message.is_mine ? 'Kendine' : (message.sender_first_name ?? message.sender_username),
      body: message.deleted_at
        ? 'Bu mesaj silindi'
        : (message.body ?? (message.media.length > 0 ? 'Medya' : 'Mesaj')),
      hasMedia: message.media.length > 0 || Boolean(message.media_path),
    });
    inputRef.current?.focus();
  }, []);

  /**
   * Eklentileri gönderir.
   *
   * Yükleme artık `useSendMessage` içinde yapılır: iyimser balon, kullanıcı
   * gönder'e bastığı anda (dosya yüklenmeden) listeye girer ve yükleme arka
   * planda sürer. Önceden balon, tüm dosyalar sıkıştırılıp yüklenene kadar
   * görünmüyordu.
   */
  const uploadPending = useCallback(
    (captionOverride?: string) => {
      if (!myId || pending.length === 0) {
        return;
      }
      const caption = (captionOverride ?? draft).trim();
      const replyId = reply?.id ?? null;
      const uploads: PendingMediaUpload[] = pending.map((item) => ({
        media_type: item.kind,
        uri: item.uri,
        mime: item.mime ?? null,
        fileName: item.fileName ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
        durationMs: item.durationMs ?? null,
        size: item.size ?? null,
      }));

      haptics.tap();
      uploadCountRef.current += 1;
      setUploadProgress(0);
      // Besteci hemen temizlenir: balon zaten listede.
      setPending([]);
      setDraft('');
      setReply(null);

      sendMessage.mutate(
        {
          kind: uploads[0]?.media_type ?? 'file',
          body: caption || null,
          uploads,
          replyToId: replyId,
          onUploadProgress: (ratio) => setUploadProgress(ratio),
        },
        {
          onSettled: () => {
            uploadCountRef.current = Math.max(0, uploadCountRef.current - 1);
            if (uploadCountRef.current === 0) {
              setUploadProgress(null);
            }
          },
          onError: (error) => {
            Alert.alert(
              'Medya gönderilemedi',
              `${toMessage(error)}\n\nMesajın üzerine dokunarak tekrar deneyebilirsin.`,
            );
          },
        },
      );
    },
    [draft, myId, pending, reply?.id, sendMessage],
  );

  // Video seçildiği anda sıkıştırma ve kapak üretimi başlar: "gönder"e
  // basıldığında iş çoğunlukla bitmiş olur ve yükleme beklemeden başlar.
  const pendingSignature = useMemo(
    () => pending.map((item) => `${item.id}:${item.kind}`).join('|'),
    [pending],
  );
  useEffect(() => {
    if (!pendingSignature) {
      return;
    }
    let active = true;
    for (const item of pending) {
      if (item.kind !== 'video') {
        continue;
      }
      void prepareVideoForUpload({
        uri: item.uri,
        durationMs: item.durationMs ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
        size: item.size ?? null,
      }).catch(() => undefined);
      void generateVideoPoster(item.uri).then((poster) => {
        if (!active || !poster) {
          return;
        }
        setPending((current) =>
          current.map((entry) =>
            entry.id === item.id && entry.posterUri !== poster.uri
              ? { ...entry, posterUri: poster.uri }
              : entry,
          ),
        );
      });
    }
    return () => {
      active = false;
    };
    // `pending` kapak eklendiğinde değişir; işi yalnızca seçim değişince başlat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSignature]);

  const submit = useCallback(() => {
    const body = draft.trim();
    if (pending.length > 0) {
      uploadPending(body);
      return;
    }
    if (!body && !editing) {
      return;
    }

    if (editing) {
      editMessage.mutate(
        { messageId: editing.id, body },
        {
          onSuccess: () => {
            setEditing(null);
            setDraft('');
          },
          onError: (error) => Alert.alert('Düzenlenemedi', toMessage(error)),
        },
      );
      return;
    }

    haptics.tap();
    const replyId = reply?.id ?? null;
    // İyimser satır hemen listeye girer; hata olursa "Tekrar dene" gösterilir.
    setDraft('');
    setReply(null);
    sendMessage.mutate({ kind: 'text', body, replyToId: replyId });
  }, [draft, editing, editMessage, pending.length, reply?.id, sendMessage, uploadPending]);

  const attachImage = useCallback(async () => {
    const picked = await pickMedia({ source: 'library', kind: 'all', multiple: true, limit: 10 });
    if (!picked || picked.length === 0) {
      return;
    }
    setPending((current) => [
      ...current,
      ...picked.slice(0, Math.max(0, 10 - current.length)).map((asset) => ({
        id: Crypto.randomUUID(),
        uri: asset.uri,
        kind: (asset.mediaType === 'video' ? 'video' : 'image') as MessageKind,
        mime: asset.mimeType ?? null,
        fileName: asset.fileName ?? null,
        width: asset.width ?? null,
        height: asset.height ?? null,
        durationMs: asset.durationMs ?? null,
        size: asset.fileSize ?? null,
      })),
    ]);
    inputRef.current?.focus();
  }, []);

  const attachFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    const asset = result.assets[0];
    setPending((current) =>
      current.length >= 10
        ? current
        : [
            ...current,
            {
              id: Crypto.randomUUID(),
              uri: asset.uri,
              kind: 'file',
              mime: asset.mimeType ?? null,
              fileName: asset.name,
              size: asset.size ?? null,
            },
          ],
    );
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((current) => current.filter((item) => item.id !== id));
  }, []);

  const openMessageMedia = useCallback(
    (message: ChatMessage, startIndex: number) => {
      const items = message.media.flatMap<ViewerMedia>((item) => {
        // Yükleme sürerken sunucu adresi yoktur; iyimser satır kendi yerel
        // dosyasını gösterir.
        const uri = signedMedia.data?.[item.storage_path] ?? item.local_uri ?? null;
        if (!uri) {
          return [];
        }
        const thumb = item.thumbnail_path
          ? (signedMedia.data?.[item.thumbnail_path] ?? null)
          : null;
        return [
          {
            id: item.id,
            uri,
            media_type: item.media_type === 'video' ? ('video' as const) : ('image' as const),
            thumbnailUri: thumb ?? (item.local_uri ? cachedVideoPoster(item.local_uri) : null),
            width: item.width,
            height: item.height,
          },
        ];
      });

      if (items.length === 0 && message.media_path) {
        const uri = signedMedia.data?.[message.media_path];
        if (uri) {
          const thumb = (message.media_meta as { thumb_path?: unknown } | null)?.thumb_path;
          items.push({
            id: message.id,
            uri,
            media_type: message.kind === 'video' ? 'video' : 'image',
            thumbnailUri: typeof thumb === 'string' ? (signedMedia.data?.[thumb] ?? null) : null,
          });
        }
      }

      if (items.length > 0) {
        Keyboard.dismiss();
        setViewer({ items, index: Math.min(startIndex, items.length - 1) });
      }
    },
    [signedMedia.data],
  );

  const beginCall = useCallback(
    (kind: 'audio' | 'video') => {
      if (!conversationId || conversation.isGroup) {
        Alert.alert('Grup araması', 'Grup aramaları henüz desteklenmiyor.');
        return;
      }
      startCall.mutate(
        { conversationId, kind },
        {
          onSuccess: ({ id }) => router.push(`/call/${id}` as never),
          onError: (error) => Alert.alert('Arama başlatılamadı', error.message),
        },
      );
    },
    [conversation.isGroup, conversationId, router, startCall],
  );

  const openMessageMenu = useCallback((message: ChatMessage) => {
    haptics.tap();
    setMenuMessage(message);
    setMenuOpen(true);
  }, []);

  const renderMessage = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      const older = reversed[index + 1];
      const showDay =
        !older || formatDayLabelTr(older.created_at) !== formatDayLabelTr(item.created_at);
      const showSender =
        conversation.isGroup &&
        !item.is_mine &&
        (!older || older.sender_id !== item.sender_id || showDay);
      const visual = hasVisualMedia(item);
      const bubbleTint = item.is_mine
        ? { backgroundColor: theme.colors.primary, borderBottomRightRadius: 6 }
        : {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderBottomLeftRadius: 6,
            borderWidth: StyleSheet.hairlineWidth,
          };

      const renderFoot = (light: boolean) => (
        <View style={styles.bubbleFoot}>
          {item.edited_at && !item.deleted_at ? (
            <AppText variant="caption" color={light ? 'rgba(255,255,255,0.7)' : 'textTertiary'}>
              düzenlendi
            </AppText>
          ) : null}
          <AppText
            variant="caption"
            color={
              item.delivery_status === 'failed'
                ? light
                  ? '#FCA5A5'
                  : 'danger'
                : light
                  ? 'rgba(255,255,255,0.7)'
                  : 'textTertiary'
            }
          >
            {formatTimeTr(item.created_at)}
          </AppText>
          {item.is_mine && !item.deleted_at ? (
            <DeliveryBadge status={item.delivery_status} onDark={light} />
          ) : null}
        </View>
      );

      const renderReplyQuote = (light: boolean) =>
        item.reply_preview ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yanıtlanan mesaja git"
            onPress={() => (item.reply_preview ? jumpToMessage(item.reply_preview.id) : undefined)}
            style={[
              styles.replyQuote,
              { backgroundColor: light ? 'rgba(255,255,255,0.16)' : theme.colors.surfaceMuted },
            ]}
          >
            <AppText
              variant="caption"
              color={light ? 'rgba(255,255,255,0.9)' : 'primaryDeep'}
              numberOfLines={1}
            >
              @{item.reply_preview.sender_username}
            </AppText>
            <AppText
              variant="caption"
              color={light ? 'rgba(255,255,255,0.75)' : 'textSecondary'}
              numberOfLines={2}
            >
              {item.reply_preview.deleted_at
                ? 'Bu mesaj silindi'
                : (item.reply_preview.body ?? (item.reply_preview.has_media ? 'Medya' : 'Mesaj'))}
            </AppText>
          </Pressable>
        ) : null;

      const retryRow =
        item.is_mine && item.delivery_status === 'failed' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mesajı tekrar gönder"
            onPress={() => sendMessage.retryMessage(item)}
            style={styles.retryRow}
          >
            <Ionicons name="refresh" size={13} color="#FCA5A5" />
            <AppText variant="caption" color="danger">
              Gönderilemedi · Tekrar dene
            </AppText>
          </Pressable>
        ) : null;

      return (
        <View>
          {showDay ? (
            <View style={styles.dayRow}>
              <View style={[styles.dayPill, { backgroundColor: theme.colors.surfaceMuted }]}>
                <AppText variant="caption" color="textSecondary">
                  {formatDayLabelTr(item.created_at)}
                </AppText>
              </View>
            </View>
          ) : null}

          {showSender ? (
            <AppText variant="caption" color="textTertiary" style={styles.senderLabel}>
              {item.sender_first_name ?? item.sender_username}
            </AppText>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mesaj seçenekleri"
            onLongPress={() => openMessageMenu(item)}
            onPress={() => {
              if (item.delivery_status === 'failed') {
                sendMessage.retryMessage(item);
              }
            }}
            delayLongPress={260}
            style={[
              styles.bubbleRow,
              item.is_mine ? styles.rowMine : styles.rowOther,
              highlightId === item.id
                ? { backgroundColor: theme.colors.primarySoft, borderRadius: 14 }
                : null,
            ]}
          >
            {!item.is_mine ? (
              <Avatar
                uri={mediaPublicUrl('avatar', item.sender_avatar_path)}
                name={item.sender_first_name ?? item.sender_username}
                size={30}
                recycleKey={item.sender_id}
              />
            ) : null}

            {visual ? (
              <View
                style={[
                  styles.mediaBubble,
                  item.is_mine ? styles.mediaBubbleMine : styles.mediaBubbleOther,
                ]}
              >
                {renderReplyQuote(false)}
                <View>
                  <MessageMedia
                    message={item}
                    signed={signedMedia.data}
                    onOpen={(mediaIndex) => openMessageMedia(item, mediaIndex)}
                    onLongPress={() => openMessageMenu(item)}
                  />
                  {!item.body ? (
                    <View pointerEvents="none" style={styles.mediaStamp}>
                      {renderFoot(true)}
                    </View>
                  ) : null}
                </View>
                {item.body ? (
                  <View style={[styles.bubble, styles.captionBubble, bubbleTint]}>
                    <AppText
                      variant="body"
                      color={item.is_mine ? '#FFFFFF' : 'text'}
                      style={styles.bubbleText}
                    >
                      {item.body}
                    </AppText>
                    {renderFoot(item.is_mine)}
                  </View>
                ) : null}
                {retryRow}
              </View>
            ) : (
              <View style={[styles.bubble, bubbleTint]}>
                {item.deleted_at ? (
                  <AppText
                    variant="body"
                    color={item.is_mine ? 'rgba(255,255,255,0.75)' : 'textTertiary'}
                  >
                    Bu mesaj silindi
                  </AppText>
                ) : (
                  <>
                    {renderReplyQuote(item.is_mine)}

                    <MessageMedia
                      message={item}
                      signed={signedMedia.data}
                      onOpen={(mediaIndex) => openMessageMedia(item, mediaIndex)}
                      onLongPress={() => openMessageMenu(item)}
                    />

                    {item.body ? (
                      <AppText
                        variant="body"
                        color={item.is_mine ? '#FFFFFF' : 'text'}
                        style={styles.bubbleText}
                      >
                        {item.body}
                      </AppText>
                    ) : null}
                  </>
                )}

                {renderFoot(item.is_mine)}
                {retryRow}
              </View>
            )}
          </Pressable>
        </View>
      );
    },
    [
      conversation.isGroup,
      highlightId,
      jumpToMessage,
      openMessageMedia,
      openMessageMenu,
      reversed,
      sendMessage,
      signedMedia.data,
      theme.colors,
    ],
  );

  return (
    <Screen
      edges={['top', 'left', 'right']}
      padded={false}
      keyboardAware
      footer={
        <View
          style={[
            styles.composerWrap,
            {
              backgroundColor: theme.colors.background,
              borderTopColor: theme.colors.divider,
              paddingBottom: keyboard.isVisible ? 8 : Math.max(insets.bottom, 8),
            },
          ]}
        >
          {uploadProgress !== null ? (
            <View style={[styles.uploadTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
              <View
                style={[
                  styles.uploadFill,
                  {
                    width: `${Math.round(uploadProgress * 100)}%`,
                    backgroundColor: theme.colors.primary,
                  },
                ]}
              />
            </View>
          ) : null}
          {pending.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pendingRow}
              keyboardShouldPersistTaps="handled"
            >
              {pending.map((item) => (
                <View
                  key={item.id}
                  style={[styles.pendingTile, { backgroundColor: theme.colors.surfaceMuted }]}
                >
                  {item.kind === 'image' ? (
                    <AppImage source={{ uri: item.uri }} style={styles.pendingImage} />
                  ) : item.kind === 'video' && item.posterUri ? (
                    <AppImage source={{ uri: item.posterUri }} style={styles.pendingImage} />
                  ) : (
                    <View style={styles.pendingIcon}>
                      <Ionicons
                        name={item.kind === 'video' ? 'videocam-outline' : 'document-outline'}
                        size={20}
                        color={theme.colors.textSecondary}
                      />
                      <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                        {item.kind === 'video' ? 'Video' : (item.fileName ?? 'Dosya')}
                      </AppText>
                    </View>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Eklentiyi kaldır"
                    onPress={() => removePending(item.id)}
                    style={styles.pendingRemove}
                  >
                    <Ionicons name="close" size={13} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {reply ? (
            <View style={[styles.replyBar, { backgroundColor: theme.colors.surfaceMuted }]}>
              <View style={styles.replyText}>
                <AppText variant="caption" color="primaryDeep">
                  {reply.name} kişisine yanıt
                </AppText>
                <View style={styles.replyPreviewRow}>
                  {reply.hasMedia ? (
                    <Ionicons name="image-outline" size={12} color={theme.colors.textSecondary} />
                  ) : null}
                  <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                    {reply.body}
                  </AppText>
                </View>
              </View>
              <IconButton
                name="close"
                accessibilityLabel="Yanıtı iptal et"
                size={16}
                onPress={() => setReply(null)}
              />
            </View>
          ) : null}

          {editing ? (
            <View style={[styles.replyBar, { backgroundColor: theme.colors.surfaceMuted }]}>
              <View style={styles.replyText}>
                <AppText variant="caption" color="primaryDeep">
                  Mesaj düzenleniyor
                </AppText>
                <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                  {editing.body ?? ''}
                </AppText>
              </View>
              <IconButton
                name="close"
                accessibilityLabel="Düzenlemeyi iptal et"
                size={16}
                onPress={() => {
                  setEditing(null);
                  setDraft('');
                }}
              />
            </View>
          ) : null}

          <View style={styles.composer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Medya ekle"
              onPress={() => void attachImage()}
              style={({ pressed }) => [styles.attach, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Ionicons name="add" size={22} color={theme.colors.textSecondary} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dosya ekle"
              onPress={() => void attachFile()}
              style={({ pressed }) => [styles.attach, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Ionicons name="document-outline" size={20} color={theme.colors.textSecondary} />
            </Pressable>

            <View
              style={[
                styles.inputShell,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.pill,
                },
              ]}
            >
              <TextInput
                ref={inputRef}
                value={draft}
                onChangeText={(value) => {
                  setDraft(value.slice(0, 4000));
                  typing.notifyTyping();
                }}
                placeholder={
                  editing
                    ? 'Mesajı düzenle...'
                    : pending.length > 0
                      ? 'Açıklama ekle...'
                      : 'Mesaj yaz...'
                }
                placeholderTextColor={theme.colors.textTertiary}
                style={[styles.input, { color: theme.colors.text }]}
                multiline
                maxLength={4000}
                accessibilityLabel="Mesaj metni"
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Düzenlemeyi kaydet' : 'Mesajı gönder'}
              disabled={!draft.trim() && !editing && pending.length === 0}
              onPress={submit}
              style={({ pressed }) => [
                styles.send,
                {
                  backgroundColor: theme.colors.primary,
                  opacity:
                    !draft.trim() && !editing && pending.length === 0 ? 0.4 : pressed ? 0.7 : 1,
                },
              ]}
            >
              {editMessage.isPending ? (
                <ActivityIndicator size="small" color={theme.colors.onPrimary} />
              ) : (
                <Ionicons name="arrow-up" size={19} color={theme.colors.onPrimary} />
              )}
            </Pressable>
          </View>

          {typing.typingLabel ? (
            <AppText variant="caption" color="textTertiary" style={styles.typing}>
              {typing.typingLabel} yazıyor…
            </AppText>
          ) : null}
        </View>
      }
    >
      <View style={styles.headerWrap}>
        {conversation.isGroup ? (
          <ScreenHeader
            title={conversation.title}
            subtitle={`${members.data?.length ?? 0} katılımcı`}
            onBack={() => router.back()}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Grup bilgisi"
                onPress={() => router.push(`/chat/${conversationId}/info` as never)}
                style={styles.headerAction}
              >
                <Ionicons name="information-circle-outline" size={22} color={theme.colors.text} />
              </Pressable>
            }
          />
        ) : (
          <View style={styles.header}>
            <IconButton
              name="chevron-back"
              accessibilityLabel="Geri"
              size={22}
              onPress={() => router.back()}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${conversation.title} profilini aç`}
              disabled={!conversation.peerName}
              onPress={() =>
                conversation.peerName
                  ? router.push(`/profile/${conversation.peerName}` as never)
                  : undefined
              }
              style={styles.headerPerson}
            >
              <Avatar
                uri={mediaPublicUrl('avatar', conversation.avatarPath)}
                name={conversation.title}
                size={38}
              />
              <View style={styles.headerText}>
                <AppText variant="title" numberOfLines={1}>
                  {conversation.title}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {typing.typingLabel ? 'yazıyor…' : 'Sohbet'}
                </AppText>
              </View>
            </Pressable>
            {!conversation.isGroup ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sesli arama"
                  onPress={() => beginCall('audio')}
                  style={styles.headerAction}
                >
                  <Ionicons name="call-outline" size={21} color={theme.colors.text} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Görüntülü arama"
                  onPress={() => beginCall('video')}
                  style={styles.headerAction}
                >
                  <Ionicons name="videocam-outline" size={22} color={theme.colors.text} />
                </Pressable>
              </>
            ) : null}
          </View>
        )}
      </View>

      {messagesQuery.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : messagesQuery.isError ? (
        <View style={styles.state}>
          <Ionicons name="cloud-offline-outline" size={28} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Mesajlar yüklenemedi.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
            onPress={() => void messagesQuery.refetch()}
          >
            <AppText variant="label" color="primaryDeep">
              Tekrar dene
            </AppText>
          </Pressable>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.state}>
          <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={24}
              color={theme.colors.primaryDeep}
            />
          </View>
          <AppText variant="bodyStrong" align="center">
            Sohbeti başlat
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            İlk mesajı göndererek sohbeti başlatabilirsin.
          </AppText>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={reversed}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          inverted
          // Android'de sohbet listesi sonsuz buyumesin: pencere sinirli tutulur,
          // boylece medya mesajlari bellekte birikip kaydirmayi yavaslatmaz.
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={11}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          scrollEventThrottle={120}
          onScroll={(event) => {
            // Ters liste: 0 en güncel mesaj. Kullanıcı geçmişe indikçe
            // "son mesaja dön" düğmesi görünür; konum zorla değiştirilmez.
            const away = event.nativeEvent.contentOffset.y > 520;
            if (away !== awayRef.current) {
              awayRef.current = away;
              setAwayFromLatest(away);
            }
          }}
          onScrollToIndexFailed={({ index }) => {
            listRef.current?.scrollToOffset({
              offset: Math.max(0, index * 76),
              animated: true,
            });
          }}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage) {
              void messagesQuery.fetchNextPage();
            }
          }}
          ListFooterComponent={
            messagesQuery.isFetchingNextPage ? (
              <ActivityIndicator color={theme.colors.primary} style={styles.olderLoader} />
            ) : undefined
          }
        />
      )}

      {awayFromLatest ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Son mesaja dön"
          onPress={() => {
            awayRef.current = false;
            setAwayFromLatest(false);
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
          }}
          style={({ pressed }) => [
            styles.jumpLatest,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="arrow-down" size={17} color={theme.colors.primaryDeep} />
        </Pressable>
      ) : null}

      <MediaViewer
        visible={Boolean(viewer)}
        media={viewer?.items ?? []}
        startIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
        closeOnBackdropPress
      />

      <ActionSheet
        visible={menuOpen}
        title="Mesaj"
        items={
          menuMessage
            ? [
                { key: 'reply', label: 'Yanıtla', icon: 'arrow-undo-outline' },
                ...(menuMessage.kind === 'text' && !menuMessage.deleted_at && menuMessage.is_mine
                  ? [{ key: 'edit', label: 'Düzenle', icon: 'create-outline' as const }]
                  : []),
                {
                  key: 'copy',
                  label: 'Metni kopyala',
                  icon: 'copy-outline',
                  disabled: !menuMessage.body,
                },
                {
                  key: 'share',
                  label: 'Paylaş',
                  icon: 'share-outline',
                  disabled: !menuMessage.body && menuMessage.media.length === 0,
                },
                ...(menuMessage.is_mine && !menuMessage.deleted_at
                  ? [
                      {
                        key: 'delete',
                        label: 'Sil',
                        icon: 'trash-outline' as const,
                        destructive: true,
                      },
                    ]
                  : [
                      {
                        key: 'report',
                        label: 'Şikâyet et',
                        icon: 'flag-outline' as const,
                        destructive: true,
                      },
                      {
                        key: 'block',
                        label: 'Kullanıcıyı engelle',
                        icon: 'ban-outline' as const,
                        destructive: true,
                      },
                    ]),
              ]
            : []
        }
        onClose={closeMenus}
        onSelect={(key) => {
          const message = menuMessage;
          setMenuOpen(false);
          setMenuMessage(null);
          if (!message) {
            return;
          }
          if (key === 'reply') {
            beginReply(message);
          } else if (key === 'edit') {
            setEditing(message);
            setDraft(message.body ?? '');
            inputRef.current?.focus();
          } else if (key === 'copy') {
            if (message.body) {
              void Clipboard.setStringAsync(message.body);
            }
          } else if (key === 'share') {
            void shareContent({
              message:
                message.body ??
                (message.media.length > 0 ? 'Trabzone üzerinden paylaşılan medya' : ''),
            });
          } else if (key === 'delete') {
            Alert.alert('Mesajı sil', 'Bu mesaj silinecek.', [
              { text: 'Vazgeç', style: 'cancel' },
              {
                text: 'Sil',
                style: 'destructive',
                onPress: () =>
                  deleteMessage.mutate(message.id, {
                    onError: (error) => Alert.alert('Silinemedi', toMessage(error)),
                  }),
              },
            ]);
          } else if (key === 'report') {
            setTimeout(
              () =>
                openReport({
                  targetType: 'message',
                  targetId: message.id,
                  targetLabel: message.body?.slice(0, 60) ?? 'Mesaj',
                }),
              280,
            );
          } else if (key === 'block') {
            Alert.alert(
              'Kullanıcıyı engelle',
              `@${message.sender_username} engellenecek. Sohbet geçmişi korunur, yeni mesaj gönderilemez.`,
              [
                { text: 'Vazgeç', style: 'cancel' },
                {
                  text: 'Engelle',
                  style: 'destructive',
                  onPress: () =>
                    blockUser.mutate(message.sender_id, {
                      onError: (error) => Alert.alert('Engellenemedi', toMessage(error)),
                    }),
                },
              ],
            );
          }
        }}
      />
    </Screen>
  );
}

function DeliveryBadge({
  status,
  onDark,
}: {
  status: ChatMessage['delivery_status'];
  onDark: boolean;
}) {
  const color =
    status === 'read'
      ? '#7DD3FC'
      : status === 'failed'
        ? '#FCA5A5'
        : onDark
          ? 'rgba(255,255,255,0.78)'
          : 'rgba(0,0,0,0.45)';

  if (status === 'sending') {
    return (
      <Ionicons name="time-outline" size={13} color={color} accessibilityLabel="Gönderiliyor" />
    );
  }
  if (status === 'failed') {
    return (
      <Ionicons name="alert-circle" size={13} color={color} accessibilityLabel="Gönderilemedi" />
    );
  }
  if (status === 'sent') {
    return <Ionicons name="checkmark" size={13} color={color} accessibilityLabel="Gönderildi" />;
  }
  return (
    <Ionicons
      name="checkmark-done"
      size={13}
      color={color}
      accessibilityLabel={status === 'read' ? 'Okundu' : 'İletildi'}
    />
  );
}

/** Tek medyalı sohbet balonunda kutunun en büyük kenarı. */
const SINGLE_MEDIA_MAX_SIDE = 220;

/** Çoklu medya ızgarasının en büyük genişliği. */
const MEDIA_GRID_MAX_WIDTH = 280;
const MEDIA_GRID_GAP = 4;

/** Medya kutusunun genişliği (balon en fazla ~%72). */
function bubbleMediaEstimate(single: boolean, windowWidth: number): number {
  const bubble = Math.max(120, windowWidth * 0.72 - 24);
  return single ? Math.min(SINGLE_MEDIA_MAX_SIDE, bubble) : Math.min(MEDIA_GRID_MAX_WIDTH, bubble);
}

/** Fotoğraf/video içeren, silinmemiş mesajlar balonsuz (şeffaf kenarlı) çizilir. */
function hasVisualMedia(message: ChatMessage): boolean {
  if (message.deleted_at || message.kind === 'file' || message.kind === 'audio') {
    return false;
  }
  return message.media.length > 0 || Boolean(message.media_path);
}

function MessageMedia({
  message,
  signed,
  onOpen,
  onLongPress,
}: {
  message: ChatMessage;
  signed: Record<string, string> | undefined;
  onOpen: (index: number) => void;
  onLongPress?: () => void;
}) {
  const { theme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const meta = (message.media_meta ?? {}) as {
    name?: string;
    width?: number;
    height?: number;
    duration?: number;
    thumb_path?: string;
  };

  const legacy =
    message.media.length === 0 && message.media_path
      ? [
          {
            id: message.id,
            media_type: message.kind,
            storage_path: message.media_path,
            thumbnail_path: typeof meta.thumb_path === 'string' ? meta.thumb_path : null,
            width: meta.width ?? null,
            height: meta.height ?? null,
            duration_ms: typeof meta.duration === 'number' ? meta.duration : null,
            sort_order: 0,
            local_uri: null,
          },
        ]
      : [];
  const items = message.media.length > 0 ? message.media : legacy;
  const single = items.length === 1;

  /**
   * Hücre boyutları pencere genişliğinden sayısal olarak hesaplanır.
   * Yüzde genişlik + `aspectRatio` kombinasyonu Yoga'da yüksekliği 0'a
   * düşürebiliyor; balonsuz düzende ölçüme bağlı genişlik de her ölçümde
   * küçülerek daralıyordu.
   */
  const gridWidth = Math.round(bubbleMediaEstimate(false, windowWidth));
  const cellWidth = Math.floor((gridWidth - MEDIA_GRID_GAP) / 2);
  const cellHeight = Math.round(cellWidth / 1.08);
  const singleWidth = Math.round(bubbleMediaEstimate(true, windowWidth));

  if (items.length === 0) {
    return null;
  }

  if (message.kind === 'file' || message.kind === 'audio') {
    return (
      <View style={[styles.fileRow, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons
          name={message.kind === 'audio' ? 'mic-outline' : 'document-outline'}
          size={18}
          color={theme.colors.text}
        />
        <AppText variant="caption" color="text" numberOfLines={1} style={styles.fileName}>
          {message.kind === 'audio' ? 'Sesli mesaj' : (meta.name ?? 'Dosya')}
        </AppText>
      </View>
    );
  }

  const visible = items.slice(0, 4);

  return (
    <View style={[styles.mediaGrid, { width: single ? singleWidth : gridWidth }]}>
      {visible.map((item, index) => {
        const remote = signed?.[item.storage_path] ?? null;
        const local = item.local_uri ?? null;
        // Yükleme bitmeden yerel dosya gösterilir; sunucu adresi gelince yerini alır.
        const uri = remote ?? local;
        const remoteThumb = item.thumbnail_path ? (signed?.[item.thumbnail_path] ?? null) : null;
        const thumb = remoteThumb ?? (local ? cachedVideoPoster(local) : null);
        const ratio =
          item.width && item.height
            ? Math.min(Math.max(item.width / item.height, 0.72), 1.7)
            : item.media_type === 'video'
              ? 16 / 10
              : 4 / 3;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={
              item.media_type === 'video' ? 'Videoyu tam ekran aç' : 'Fotoğrafı tam ekran aç'
            }
            onPress={() => onOpen(index)}
            onLongPress={onLongPress}
            delayLongPress={260}
            style={[
              styles.mediaTile,
              single
                ? { width: singleWidth, height: Math.round(singleWidth / ratio) }
                : { width: cellWidth, height: cellHeight },
              !uri ? { backgroundColor: theme.colors.surfaceMuted } : null,
            ]}
          >
            {!uri ? (
              <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            ) : item.media_type === 'video' ? (
              <VideoThumbnail posterUri={thumb} hideDuration style={StyleSheet.absoluteFill} />
            ) : (
              <AppImage
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                recycleKey={item.id}
                contentFit="cover"
              />
            )}
            {!remote && local && item.media_type !== 'video' ? (
              <View style={styles.mediaSending}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            ) : null}
            {item.media_type === 'video' ? (
              <View style={styles.videoBadge}>
                <Ionicons name="videocam" size={12} color="#FFFFFF" />
                {formatVideoDuration(item.duration_ms) ? (
                  <AppText variant="caption" color="#FFFFFF">
                    {formatVideoDuration(item.duration_ms)}
                  </AppText>
                ) : null}
              </View>
            ) : null}
            {index === 3 && items.length > 4 ? (
              <View style={styles.moreBadge}>
                <AppText variant="caption" color="#FFFFFF">
                  +{items.length - 4}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: 16, paddingTop: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  headerPerson: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  headerText: { flex: 1, gap: 1 },
  headerAction: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  stateIcon: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  dayRow: { alignItems: 'center', paddingVertical: 10 },
  dayPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  senderLabel: { marginLeft: 42, marginBottom: 2 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, marginVertical: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, gap: 4 },
  bubbleText: { lineHeight: 21 },
  bubbleFoot: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  retryRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  replyPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  replyQuote: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, gap: 1 },
  mediaBubble: { maxWidth: '78%', gap: 4 },
  mediaBubbleMine: { alignItems: 'flex-end' },
  mediaBubbleOther: { alignItems: 'flex-start' },
  captionBubble: { maxWidth: '100%' },
  mediaStamp: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: MEDIA_GRID_GAP,
  },
  mediaTile: {
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaCell: { width: '48.6%' },
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    minWidth: 24,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  mediaSending: {
    position: 'absolute',
    right: 7,
    top: 7,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBadge: {
    position: 'absolute',
    right: 7,
    top: 7,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  mediaImage: { width: 210, height: 210, borderRadius: 12 },
  mediaVideo: { width: 220, borderRadius: 12, overflow: 'hidden' },
  mediaPlaceholder: {
    width: 190,
    height: 130,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
  },
  fileName: { flexShrink: 1 },
  pendingRow: { gap: 8, paddingVertical: 2, paddingHorizontal: 2 },
  pendingTile: {
    width: 62,
    height: 62,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingImage: { width: '100%', height: '100%' },
  pendingIcon: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4 },
  pendingRemove: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  jumpLatest: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
  },
  uploadTrack: {
    height: 2.5,
    borderRadius: 2,
    overflow: 'hidden',
    marginHorizontal: 4,
  },
  uploadFill: { height: 2.5, borderRadius: 2 },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 12 },
  replyText: { flex: 1, gap: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  attach: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  inputShell: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    justifyContent: 'center',
    minHeight: 42,
  },
  input: { fontSize: 15, maxHeight: 110, paddingTop: 9, paddingBottom: 9 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  typing: { paddingLeft: 4 },
  olderLoader: { paddingVertical: 14 },
});
