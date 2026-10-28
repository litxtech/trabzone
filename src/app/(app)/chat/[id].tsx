import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { useQuery } from '@tanstack/react-query';

import { ActionSheet, AppImage, AppText, Avatar, IconButton, Screen, ScreenHeader } from '@/components/ui';
import { MediaViewer } from '@/features/feed/components/MediaViewer';
import { VideoThumbnail } from '@/features/media/components/VideoThumbnail';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { pickMedia } from '@/features/media/media-picker';
import {
  signedMessageUrls,
  uploadMedia,
  uploadVideoWithPoster,
} from '@/features/media/media-service';
import {
  flattenMessages,
  useChatMembers,
  useConversationRealtime,
  useDeleteMessage,
  useEditMessage,
  useMarkConversationRead,
  useMessages,
  useSendMessage,
  useStartCall,
  useTypingIndicator,
} from '@/features/messaging/hooks/use-chat';
import type { ChatMessage, MessageKind } from '@/features/messaging/services/messaging-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDayLabelTr, formatTimeTr } from '@/utils/date';
import { toMessage } from '@/utils/error-message';
import { haptics } from '@/utils/haptics';

type ReplyTarget = { id: string; name: string; body: string } | null;

export default function ChatScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const conversationId = typeof params.id === 'string' ? params.id : '';
  const session = useSession();
  const myId = session?.user?.id ?? null;

  const messagesQuery = useMessages(conversationId);
  const members = useChatMembers(conversationId);
  const sendMessage = useSendMessage(conversationId);
  const editMessage = useEditMessage(conversationId);
  const deleteMessage = useDeleteMessage(conversationId);
  const markRead = useMarkConversationRead(conversationId);
  const startCall = useStartCall();
  const { openReport } = useReportSheet();
  useConversationRealtime(conversationId);

  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<ReplyTarget>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menuMessage, setMenuMessage] = useState<ChatMessage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  const typing = useTypingIndicator(conversationId, myId, draft.length > 0);

  const messages = useMemo(() => flattenMessages(messagesQuery.data), [messagesQuery.data]);
  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  const mediaPaths = useMemo(
    () =>
      messages.flatMap((message) => {
        const paths: string[] = [];
        if (message.media_path) {
          paths.push(message.media_path);
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

  // Okunmamış mesajları sunucuda işaretle.
  useEffect(() => {
    if (!conversationId || messages.length === 0) {
      return;
    }
    markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages.length]);

  const closeMenus = useCallback(() => {
    setMenuOpen(false);
    setMenuMessage(null);
  }, []);

  const submit = useCallback(() => {
    const body = draft.trim();
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
          onError: (error) => Alert.alert('Düzenlenemedi', error.message),
        },
      );
      return;
    }

    haptics.tap();
    sendMessage.mutate(
      { kind: 'text', body, replyToId: reply?.id ?? null },
      {
        onSuccess: () => {
          setDraft('');
          setReply(null);
        },
        onError: (error) => Alert.alert('Mesaj gönderilemedi', toMessage(error)),
      },
    );
  }, [draft, editing, editMessage, reply?.id, sendMessage]);

  const uploadAndSend = useCallback(
    async (input: {
      uri: string;
      kind: MessageKind;
      mime?: string | null;
      fileName?: string | null;
      meta?: Record<string, unknown>;
    }) => {
      if (!myId) {
        return;
      }
      setUploading(true);

      if (input.kind === 'video') {
        const uploaded = await uploadVideoWithPoster({
          bucket: 'message-media',
          folder: conversationId,
          uploaderId: myId,
          uri: input.uri,
          mime: input.mime ?? 'video/mp4',
          fileName: input.fileName ?? null,
          durationMs: typeof input.meta?.duration === 'number' ? input.meta.duration : null,
          width: typeof input.meta?.width === 'number' ? input.meta.width : null,
          height: typeof input.meta?.height === 'number' ? input.meta.height : null,
        });
        setUploading(false);

        if (!uploaded.ok) {
          Alert.alert('Gönderilemedi', uploaded.error.message);
          return;
        }

        const video = uploaded.data.video;
        sendMessage.mutate(
          {
            kind: 'video',
            mediaPath: video.path,
            mediaMeta: {
              ...input.meta,
              mime: video.mime,
              name: input.fileName ?? null,
              size: video.size,
              width: video.width ?? input.meta?.width ?? null,
              height: video.height ?? input.meta?.height ?? null,
              duration: video.durationMs ?? input.meta?.duration ?? null,
              thumb_path: video.thumbnailPath ?? null,
            },
            replyToId: reply?.id ?? null,
          },
          {
            onSuccess: () => setReply(null),
            onError: (error) => Alert.alert('Gönderilemedi', toMessage(error)),
          },
        );
        return;
      }

      const uploaded = await uploadMedia({
        bucket: 'message-media',
        folder: conversationId,
        uploaderId: myId,
        uri: input.uri,
        mime: input.mime ?? null,
        fileName: input.fileName ?? null,
      });
      setUploading(false);

      if (!uploaded.ok) {
        Alert.alert('Gönderilemedi', uploaded.error.message);
        return;
      }

      sendMessage.mutate(
        {
          kind: input.kind,
          mediaPath: uploaded.data.path,
          mediaMeta: {
            mime: uploaded.data.mime,
            name: input.fileName ?? null,
            size: uploaded.data.size,
            ...input.meta,
          },
          replyToId: reply?.id ?? null,
        },
        {
          onSuccess: () => setReply(null),
          onError: (error) => Alert.alert('Gönderilemedi', toMessage(error)),
        },
      );
    },
    [conversationId, myId, reply?.id, sendMessage],
  );

  const attachImage = useCallback(async () => {
    const picked = await pickMedia({ source: 'library', kind: 'all', multiple: false });
    const asset = picked?.[0];
    if (!asset) {
      return;
    }
    await uploadAndSend({
      uri: asset.uri,
      kind: asset.mediaType === 'video' ? 'video' : 'image',
      mime: asset.mimeType,
      fileName: asset.fileName,
      meta: { width: asset.width, height: asset.height, duration: asset.durationMs },
    });
  }, [uploadAndSend]);

  const attachFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    const asset = result.assets[0];
    await uploadAndSend({
      uri: asset.uri,
      kind: 'file',
      mime: asset.mimeType,
      fileName: asset.name,
      meta: { size: asset.size },
    });
  }, [uploadAndSend]);

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
            delayLongPress={260}
            style={[styles.bubbleRow, item.is_mine ? styles.rowMine : styles.rowOther]}
          >
            {!item.is_mine ? (
              <Avatar
                uri={mediaPublicUrl('avatar', item.sender_avatar_path)}
                name={item.sender_first_name ?? item.sender_username}
                size={30}
                recycleKey={item.sender_id}
              />
            ) : null}

            <View
              style={[
                styles.bubble,
                item.is_mine
                  ? { backgroundColor: theme.colors.primary, borderBottomRightRadius: 6 }
                  : {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.border,
                      borderBottomLeftRadius: 6,
                      borderWidth: StyleSheet.hairlineWidth,
                    },
              ]}
            >
              {item.deleted_at ? (
                <AppText
                  variant="body"
                  color={item.is_mine ? 'rgba(255,255,255,0.75)' : 'textTertiary'}
                >
                  Bu mesaj silindi
                </AppText>
              ) : (
                <>
                  {item.reply_preview ? (
                    <View
                      style={[
                        styles.replyQuote,
                        {
                          backgroundColor: item.is_mine
                            ? 'rgba(255,255,255,0.16)'
                            : theme.colors.surfaceMuted,
                        },
                      ]}
                    >
                      <AppText
                        variant="caption"
                        color={item.is_mine ? 'rgba(255,255,255,0.9)' : 'primaryDeep'}
                        numberOfLines={1}
                      >
                        @{item.reply_preview.sender_username}
                      </AppText>
                      <AppText
                        variant="caption"
                        color={item.is_mine ? 'rgba(255,255,255,0.75)' : 'textSecondary'}
                        numberOfLines={2}
                      >
                        {item.reply_preview.body ?? 'Medya'}
                      </AppText>
                    </View>
                  ) : null}

                  {item.media_path ? (
                    <MessageMedia
                      message={item}
                      uri={signedMedia.data?.[item.media_path] ?? null}
                      thumbUri={
                        signedMedia.data?.[
                          String(
                            (item.media_meta as { thumb_path?: unknown } | null)?.thumb_path ?? '',
                          )
                        ] ?? null
                      }
                    />
                  ) : null}

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

              <View style={styles.bubbleFoot}>
                {item.edited_at && !item.deleted_at ? (
                  <AppText
                    variant="caption"
                    color={item.is_mine ? 'rgba(255,255,255,0.7)' : 'textTertiary'}
                  >
                    düzenlendi
                  </AppText>
                ) : null}
                <AppText
                  variant="caption"
                  color={item.is_mine ? 'rgba(255,255,255,0.7)' : 'textTertiary'}
                >
                  {formatTimeTr(item.created_at)}
                </AppText>
                {item.is_mine ? (
                  <Ionicons name="checkmark-done" size={13} color="rgba(255,255,255,0.8)" />
                ) : null}
              </View>
            </View>
          </Pressable>
        </View>
      );
    },
    [conversation.isGroup, openMessageMenu, reversed, signedMedia.data, theme.colors],
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
            { backgroundColor: theme.colors.background, borderTopColor: theme.colors.divider },
          ]}
        >
          {reply ? (
            <View style={[styles.replyBar, { backgroundColor: theme.colors.surfaceMuted }]}>
              <View style={styles.replyText}>
                <AppText variant="caption" color="primaryDeep">
                  {reply.name} kişisine yanıt
                </AppText>
                <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                  {reply.body}
                </AppText>
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
              disabled={uploading}
              style={({ pressed }) => [styles.attach, { opacity: pressed || uploading ? 0.5 : 1 }]}
            >
              <Ionicons name="add" size={22} color={theme.colors.textSecondary} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dosya ekle"
              onPress={() => void attachFile()}
              disabled={uploading}
              style={({ pressed }) => [styles.attach, { opacity: pressed || uploading ? 0.5 : 1 }]}
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
                placeholder={editing ? 'Mesajı düzenle...' : 'Mesaj yaz...'}
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
              disabled={(!draft.trim() && !editing) || sendMessage.isPending}
              onPress={submit}
              style={({ pressed }) => [
                styles.send,
                {
                  backgroundColor: theme.colors.primary,
                  opacity:
                    (!draft.trim() && !editing) || sendMessage.isPending ? 0.4 : pressed ? 0.7 : 1,
                },
              ]}
            >
              {sendMessage.isPending || editMessage.isPending || uploading ? (
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
              variant="surface"
              size={20}
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
            setEditing(null);
            setReply({
              id: message.id,
              name: message.is_mine
                ? 'Kendine'
                : (message.sender_first_name ?? message.sender_username),
              body: message.body ?? 'Medya',
            });
            inputRef.current?.focus();
          } else if (key === 'edit') {
            setEditing(message);
            setDraft(message.body ?? '');
            inputRef.current?.focus();
          } else if (key === 'copy') {
            if (message.body) {
              void Clipboard.setStringAsync(message.body);
            }
          } else if (key === 'delete') {
            Alert.alert('Mesajı sil', 'Bu mesaj silinecek.', [
              { text: 'Vazgeç', style: 'cancel' },
              {
                text: 'Sil',
                style: 'destructive',
                onPress: () =>
                  deleteMessage.mutate(message.id, {
                    onError: (error) => Alert.alert('Silinemedi', error.message),
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
          }
        }}
      />
    </Screen>
  );
}

function MessageMedia({
  message,
  uri,
  thumbUri,
}: {
  message: ChatMessage;
  uri: string | null;
  thumbUri?: string | null;
}) {
  const { theme } = useTheme();
  const [videoOpen, setVideoOpen] = useState(false);
  const meta = (message.media_meta ?? {}) as {
    name?: string;
    width?: number;
    height?: number;
    duration?: number;
  };

  if (!uri) {
    return (
      <View style={[styles.mediaPlaceholder, { backgroundColor: theme.colors.surfaceMuted }]}>
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
      </View>
    );
  }

  if (message.kind === 'image') {
    return (
      <AppImage
        source={{ uri }}
        style={styles.mediaImage}
        recycleKey={message.id}
      />
    );
  }

  if (message.kind === 'video') {
    const ratio =
      meta.width && meta.height ? Math.min(Math.max(meta.width / meta.height, 0.8), 1.5) : 4 / 3;
    return (
      <>
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel="Videoyu oynat"
          onPress={() => setVideoOpen(true)}
          style={[
            styles.mediaVideo,
            { aspectRatio: ratio, backgroundColor: theme.colors.surfaceMuted },
          ]}
        >
          <VideoThumbnail
            posterUri={thumbUri}
            durationMs={typeof meta.duration === 'number' ? meta.duration : null}
            style={StyleSheet.absoluteFill}
          />
        </Pressable>
        <MediaViewer
          visible={videoOpen}
          media={[{ id: message.id, uri, media_type: 'video' }]}
          onClose={() => setVideoOpen(false)}
        />
      </>
    );
  }

  if (message.kind === 'audio') {
    return (
      <View style={[styles.fileRow, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name="mic-outline" size={18} color={theme.colors.text} />
        <AppText variant="caption" color="text" numberOfLines={1}>
          Sesli mesaj
        </AppText>
      </View>
    );
  }

  return (
    <View style={[styles.fileRow, { backgroundColor: theme.colors.surfaceMuted }]}>
      <Ionicons name="document-outline" size={18} color={theme.colors.text} />
      <AppText variant="caption" color="text" numberOfLines={1} style={styles.fileName}>
        {meta.name ?? 'Dosya'}
      </AppText>
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
  replyQuote: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, gap: 1 },
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
  composerWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
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
