import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppImage, AppText } from '@/components/ui';
import { pickMedia, type PickedAsset } from '@/features/media/media-picker';
import { generateVideoPoster } from '@/features/media/video-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { uploadCommentAttachments } from '../services/comment-service';
import type { CommentMediaInput } from '../types';

export type ReplyTarget = {
  commentId: string;
  username: string;
  preview: string;
  hasMedia: boolean;
};

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  userId: string | null;
  replyTo: ReplyTarget | null;
  editing: boolean;
  submitting: boolean;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSubmit: (input: { body: string; media: CommentMediaInput[] }) => Promise<boolean>;
  onError: (message: string | null) => void;
  inputRef?: RefObject<ComponentRef<typeof TextInput> | null>;
};

const MAX_LENGTH = 1000;
const MAX_ATTACHMENTS = 4;

export function CommentComposer({
  value,
  onChangeText,
  userId,
  replyTo,
  editing,
  submitting,
  onCancelReply,
  onCancelEdit,
  onSubmit,
  onError,
  inputRef,
}: Props) {
  const { theme } = useTheme();
  const [assets, setAssets] = useState<PickedAsset[]>([]);
  const [posters, setPosters] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const addAssets = useCallback(
    async (source: 'library' | 'camera', kind: 'image' | 'video' | 'all') => {
    setPickerOpen(false);
    const remaining = MAX_ATTACHMENTS - assets.length;
    if (remaining <= 0) {
      return;
    }
    const picked = await pickMedia({
      source,
      kind,
      multiple: source === 'library' && kind === 'image',
      limit: remaining,
      maxVideoDuration: 90,
    });
    if (!picked || picked.length === 0) {
      return;
    }
    haptics.selection();
    setAssets((current) => [...current, ...picked].slice(0, MAX_ATTACHMENTS));

    for (const asset of picked) {
      if (asset.mediaType !== 'video') {
        continue;
      }
      const poster = await generateVideoPoster(asset.uri);
      if (poster && mounted.current) {
        setPosters((current) => ({ ...current, [asset.uri]: poster.uri }));
      }
    }
  }, [assets.length]);

  const removeAsset = (uri: string) => {
    haptics.tap();
    setAssets((current) => current.filter((asset) => asset.uri !== uri));
    setPosters((current) => {
      if (!current[uri]) {
        return current;
      }
      const next = { ...current };
      delete next[uri];
      return next;
    });
  };

  const canSend =
    (editing ? value.trim().length > 0 : value.trim().length > 0 || assets.length > 0) &&
    !submitting &&
    !uploading;

  const submit = async () => {
    const body = value.trim();
    if ((!body && (editing || assets.length === 0)) || submitting || uploading) {
      return;
    }
    onError(null);

    let media: CommentMediaInput[] = [];
    if (!editing && assets.length > 0) {
      if (!userId) {
        onError('Oturum bulunamadı. Tekrar giriş yap.');
        return;
      }
      setUploading(true);
      setProgress(0);
      const uploaded = await uploadCommentAttachments({
        uploaderId: userId,
        assets,
        onProgress: (ratio) => {
          if (mounted.current) {
            setProgress(ratio);
          }
        },
      });
      if (!mounted.current) {
        return;
      }
      setUploading(false);
      setProgress(null);
      if (!uploaded.ok) {
        onError('Medya yüklenemedi. Bağlantını kontrol edip tekrar dene.');
        return;
      }
      media = uploaded.data;
    }

    const success = await onSubmit({ body, media });
    if (success && mounted.current) {
      setAssets([]);
      setPosters({});
      setPickerOpen(false);
    }
  };

  const contextLabel = editing
    ? 'Yorumu düzenliyorsun'
    : replyTo
      ? `${replyTo.username} kullanıcısına yanıt veriyorsun`
      : null;

  return (
    <View style={styles.wrap}>
      {progress !== null ? (
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.round(progress * 100)}%`,
                backgroundColor: theme.colors.primary,
              },
            ]}
          />
        </View>
      ) : null}

      {contextLabel ? (
        <View style={[styles.contextRow, { borderLeftColor: theme.colors.primary }]}>
          <View style={styles.flex}>
            <AppText variant="caption" color="primaryDeep" numberOfLines={1}>
              {contextLabel}
            </AppText>
            {replyTo && !editing ? (
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {replyTo.hasMedia ? '📎 ' : ''}
                {replyTo.preview || 'Medya'}
              </AppText>
            ) : null}
          </View>
          <Pressable
            onPress={editing ? onCancelEdit : onCancelReply}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Düzenlemeyi iptal et' : 'Yanıtı iptal et'}
          >
            <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
          </Pressable>
        </View>
      ) : null}

      {assets.length > 0 && !editing ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.attachmentRow}
        >
          {assets.map((asset) => (
            <View key={asset.uri} style={styles.attachment}>
              {asset.mediaType === 'video' ? (
                <View style={[styles.attachmentFill, { backgroundColor: theme.colors.surfaceMuted }]}>
                  {posters[asset.uri] ? (
                    <AppImage
                      source={{ uri: posters[asset.uri] }}
                      style={styles.attachmentFill}
                      contentFit="cover"
                    />
                  ) : (
                    <Ionicons name="videocam" size={20} color={theme.colors.textSecondary} />
                  )}
                  <View style={styles.videoBadge}>
                    <Ionicons name="play" size={10} color="#FFFFFF" />
                  </View>
                </View>
              ) : (
                <AppImage
                  source={{ uri: asset.uri }}
                  style={[styles.attachmentFill, { backgroundColor: theme.colors.surfaceMuted }]}
                  contentFit="cover"
                />
              )}
              <Pressable
                onPress={() => removeAsset(asset.uri)}
                style={styles.removeAsset}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Eklentiyi kaldır"
              >
                <Ionicons name="close" size={12} color="#FFFFFF" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {pickerOpen && !editing ? (
        <View style={styles.pickerRow}>
          <PickerChip
            icon="images-outline"
            label="Fotoğraf"
            onPress={() => void addAssets('library', 'image')}
          />
          <PickerChip
            icon="videocam-outline"
            label="Video"
            onPress={() => void addAssets('library', 'video')}
          />
          <PickerChip
            icon="camera-outline"
            label="Kamera"
            onPress={() => void addAssets('camera', 'all')}
          />
        </View>
      ) : null}

      <View
        style={[
          styles.composer,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.border,
          },
        ]}
      >
        {!editing ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              setPickerOpen((open) => !open);
            }}
            style={styles.attachButton}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Medya ekle"
            accessibilityState={{ expanded: pickerOpen }}
          >
            <Ionicons
              name={pickerOpen ? 'close' : 'add-circle-outline'}
              size={23}
              color={theme.colors.primaryDeep}
            />
          </Pressable>
        ) : null}

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(text) => {
            onChangeText(text);
            if (text.length <= MAX_LENGTH) {
              onError(null);
            }
          }}
          placeholder={replyTo ? `${replyTo.username} kullanıcısına yanıt yaz...` : 'Yorum yaz...'}
          placeholderTextColor={theme.colors.textTertiary}
          style={[styles.input, { color: theme.colors.text }]}
          maxLength={MAX_LENGTH}
          multiline
          scrollEnabled
          textAlignVertical="center"
          accessibilityLabel={editing ? 'Yorumu düzenle' : 'Yorum metni'}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Değişikliği kaydet' : 'Yorumu gönder'}
          disabled={!canSend}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: theme.colors.primary,
              opacity: !canSend ? 0.42 : pressed ? 0.75 : 1,
            },
          ]}
        >
          {submitting || uploading ? (
            <ActivityIndicator size="small" color={theme.colors.onPrimary} />
          ) : (
            <Ionicons
              name={editing ? 'checkmark' : 'arrow-up'}
              size={18}
              color={theme.colors.onPrimary}
            />
          )}
        </Pressable>
      </View>

      {value.length > MAX_LENGTH - 120 ? (
        <AppText variant="caption" color="textTertiary" align="right" style={styles.counter}>
          {value.length}/{MAX_LENGTH}
        </AppText>
      ) : null}
    </View>
  );
}

function PickerChip({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: theme.colors.primarySoft,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={theme.colors.primaryDeep} />
      <AppText variant="caption" color="primaryDeep">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 7 },
  flex: { flex: 1 },
  progressTrack: { height: 2.5, borderRadius: 2, overflow: 'hidden', marginHorizontal: 4 },
  progressFill: { height: 2.5, borderRadius: 2 },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderLeftWidth: 2.5,
    paddingLeft: 8,
    paddingRight: 2,
    minHeight: 30,
  },
  attachmentRow: { gap: 8, paddingVertical: 2, paddingHorizontal: 2 },
  attachment: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden' },
  attachmentFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  videoBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(4,8,18,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeAsset: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(4,8,18,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    paddingLeft: 8,
    paddingRight: 5,
    paddingVertical: 5,
    minHeight: 48,
  },
  attachButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 108,
    fontSize: 15,
    lineHeight: 20,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 2,
  },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  counter: { marginTop: -3, marginRight: 4 },
});
