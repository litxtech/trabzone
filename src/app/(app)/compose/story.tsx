import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { usePreventRemove } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRouter } from '@/utils/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Button, Screen, ScreenHeader } from '@/components/ui';
import { pickMedia, type PickedAsset } from '@/features/media/media-picker';
import { uploadMedia } from '@/features/media/media-service';
import { cancelVideoPreparation, prepareVideoForUpload } from '@/features/media/video-service';
import { useCreateStory } from '@/features/feed/hooks/use-stories';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useTheme } from '@/theme/ThemeProvider';
import { toMessage } from '@/utils/error-message';
import { haptics } from '@/utils/haptics';

function StoryVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      surfaceType="textureView"
    />
  );
}

export default function ComposeStoryScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { data: profile } = useMyProfile();
  const createStory = useCreateStory();

  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  /** Seçim anında başlayan arka plan sıkıştırmasının ilerlemesi (0..1). */
  const [prepRatio, setPrepRatio] = useState(0);
  /** Süren yayının iptal anahtarı. */
  const storyAbort = useRef<AbortController | null>(null);
  /** Çıkış niyeti: engel kalktıktan sonra gerçek navigasyon effect'te yapılır. */
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!leaving) {
      return;
    }
    // Doğrudan bağlantıyla gelindiğinde geri gidilecek ekran olmayabilir.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/feed' as never);
    }
  }, [leaving, router]);

  const hasChanges = asset !== null || caption.trim().length > 0;

  usePreventRemove(hasChanges && !leaving, ({ data }) => {
    if (busy) {
      Alert.alert('Hikâye yayınlanıyor', 'Yükleme tamamlanana kadar ekrandan ayrılamazsın.');
      return;
    }
    Alert.alert('Hikâyeden vazgeçilsin mi?', 'Seçtiğin medya ve açıklama kaldırılacak.', [
      { text: 'Devam et', style: 'cancel' },
      {
        text: 'Vazgeç',
        style: 'destructive',
        onPress: () => {
          if (asset?.mediaType === 'video') {
            // Arka planda süren sıkıştırma boşa çalışmasın.
            cancelVideoPreparation(asset.uri);
          }
          // Engel durumu render sonrası kalktığı için çıkış effect'e bırakılır;
          // aksi halde aynı karede gönderilen geri hareketi yeniden engellenir.
          setLeaving(true);
        },
      },
    ]);
  });

  const requestCancel = useCallback(() => {
    if (busy) {
      Alert.alert('Hikâye yayınlanıyor', 'Yükleme tamamlanana kadar ekrandan ayrılamazsın.');
      return;
    }
    if (!hasChanges) {
      setLeaving(true);
      return;
    }
    Alert.alert('Hikâyeden vazgeçilsin mi?', 'Seçtiğin medya ve açıklama kaldırılacak.', [
      { text: 'Devam et', style: 'cancel' },
      {
        text: 'Vazgeç',
        style: 'destructive',
        onPress: () => {
          if (asset?.mediaType === 'video') {
            cancelVideoPreparation(asset.uri);
          }
          setLeaving(true);
        },
      },
    ]);
  }, [asset, busy, hasChanges]);


  const pick = useCallback(async (source: 'library' | 'camera') => {
    const picked = await pickMedia({ source, kind: source === 'camera' ? 'image' : 'all' });
    const first = picked?.[0];
    if (!first) {
      return;
    }
    // Önceki video hâlâ hazırlanıyorsa boşa çalışmasın.
    if (asset && asset.mediaType === 'video' && asset.uri !== first.uri) {
      cancelVideoPreparation(asset.uri);
    }
    setAsset(first);
    setPrepRatio(0);
    if (first.mediaType === 'video') {
      // Sıkıştırma yayınlamayı beklemez: kullanıcı açıklama yazarken biter.
      void prepareVideoForUpload(
        {
          uri: first.uri,
          durationMs: first.durationMs,
          width: first.width,
          height: first.height,
          size: first.fileSize,
        },
        { onProgress: setPrepRatio },
      ).catch(() => undefined);
    }
  }, [asset]);

  const publish = useCallback(async () => {
    if (!asset || !profile?.id) {
      return;
    }

    setBusy(true);
    setStatus('Hikâye hazırlanıyor');
    const controller = new AbortController();
    storyAbort.current = controller;
    try {
      const uploaded = await uploadMedia({
        bucket: 'stories',
        folder: profile.id,
        uri: asset.uri,
        mime: asset.mimeType,
        fileName: asset.fileName,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        fileSize: asset.fileSize,
        compressImages: true,
        signal: controller.signal,
        onProgress: (phase, ratio) => {
          if (asset.mediaType !== 'video' || controller.signal.aborted) {
            return;
          }
          setStatus(
            phase === 'preparing'
              ? `Video hazırlanıyor • %${Math.round(ratio * 100)}`
              : 'Hikâye yükleniyor',
          );
        },
      });

      if (!uploaded.ok) {
        if (uploaded.error.code !== 'cancelled') {
          Alert.alert('Yüklenemedi', uploaded.error.message);
        }
        return;
      }
      if (controller.signal.aborted) {
        return;
      }

      setStatus('Yayınlanıyor');
      createStory.mutate(
        {
          mediaPath: uploaded.data.path,
          mediaType: uploaded.data.mediaType,
          caption: caption.trim() ? caption.trim() : null,
        },
        {
          onSuccess: () => {
            haptics.success();
            setAsset(null);
            setCaption('');
            setLeaving(true);
          },
          onError: (error) => Alert.alert('Paylaşılamadı', toMessage(error)),
        },
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        Alert.alert('Paylaşılamadı', toMessage(error));
      }
    } finally {
      if (storyAbort.current === controller) {
        storyAbort.current = null;
        setBusy(false);
        setStatus(null);
      }
    }
  }, [asset, caption, createStory, profile]);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll keyboardAware>
      <ScreenHeader
        title="Hikâye oluştur"
        subtitle="24 saat sonra kaybolur"
        left={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hikâyeden vazgeç"
            disabled={busy}
            onPress={requestCancel}
            style={({ pressed }) => [
              styles.cancel,
              { opacity: busy ? 0.4 : pressed ? 0.6 : 1 },
            ]}
          >
            <AppText variant="label" color="textSecondary">
              İptal
            </AppText>
          </Pressable>
        }
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hikâyeyi yayınla"
            disabled={!asset || busy}
            onPress={() => void publish()}
            style={({ pressed }) => [
              styles.publish,
              {
                backgroundColor: theme.colors.primary,
                opacity: !asset || busy ? 0.4 : pressed ? 0.8 : 1,
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.colors.onPrimary} />
            ) : (
              <AppText variant="label" color="onPrimary">
                Yayınla
              </AppText>
            )}
          </Pressable>
        }
      />

      {asset ? (
        <View style={[styles.preview, { backgroundColor: theme.colors.surfaceMuted }]}>
          {asset.mediaType === 'video' ? (
            <StoryVideoPreview uri={asset.uri} />
          ) : (
            <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Medyayı kaldır"
            onPress={() => {
              if (asset.mediaType === 'video') {
                cancelVideoPreparation(asset.uri);
              }
              setAsset(null);
              setPrepRatio(0);
            }}
            style={styles.remove}
          >
            <Ionicons name="close" size={16} color="#FFFFFF" />
          </Pressable>
          {asset.mediaType === 'video' && !busy ? (
            <View style={styles.prepBadge}>
              <AppText variant="caption" color="onPrimary">
                {prepRatio >= 1 ? 'Hazır' : `Hazırlanıyor %${Math.round(prepRatio * 100)}`}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : (
        <View
          style={[
            styles.emptyPreview,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="aperture-outline" size={26} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="bodyStrong" align="center">
            Hikâyen için fotoğraf veya video seç
          </AppText>
          <AppText variant="caption" color="textSecondary" align="center">
            Dikey (9:16) medya en iyi görünür.
          </AppText>

          <View style={styles.pickRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Galeriden seç"
              onPress={() => void pick('library')}
              style={({ pressed }) => [
                styles.pickButton,
                {
                  backgroundColor: theme.colors.primary,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Ionicons name="images-outline" size={17} color={theme.colors.onPrimary} />
              <AppText variant="label" color="onPrimary">
                Galeri
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kamerayı aç"
              onPress={() => void pick('camera')}
              style={({ pressed }) => [
                styles.pickButton,
                {
                  backgroundColor: theme.colors.surfaceMuted,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Ionicons name="camera-outline" size={17} color={theme.colors.text} />
              <AppText variant="label">Kamera</AppText>
            </Pressable>
          </View>
        </View>
      )}

      <View style={styles.captionGroup}>
        <AppText variant="label" color="textSecondary">
          Açıklama (isteğe bağlı)
        </AppText>
        <TextInput
          value={caption}
          onChangeText={(value) => setCaption(value.slice(0, 200))}
          placeholder="Hikâyene bir not ekle..."
          placeholderTextColor={theme.colors.textTertiary}
          maxLength={200}
          multiline
          style={[
            styles.captionInput,
            {
              backgroundColor: theme.colors.inputBackground,
              borderColor: theme.colors.border,
              color: theme.colors.text,
            },
          ]}
        />
        <AppText variant="caption" color="textTertiary" align="right">
          {caption.length}/200
        </AppText>
      </View>

      {status ? (
        <View style={[styles.status, { backgroundColor: theme.colors.primarySoft }]}>
          <ActivityIndicator size="small" color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="primaryDeep" style={styles.statusText}>
            {status}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yayını iptal et"
            hitSlop={8}
            onPress={() => {
              storyAbort.current?.abort();
              if (asset?.mediaType === 'video') {
                cancelVideoPreparation(asset.uri);
              }
            }}
            style={({ pressed }) => [
              styles.statusCancel,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.primary,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="close" size={12} color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="primaryDeep">
              İptal
            </AppText>
          </Pressable>
        </View>
      ) : null}

      <Button
        label="Hikâyeyi yayınla"
        size="lg"
        onPress={() => void publish()}
        loading={busy}
        disabled={!asset}
        style={styles.submit}
      />

      <AppText variant="caption" color="textTertiary" align="center" style={styles.note}>
        Hikâyeler 24 saat boyunca görünür olur. İstediğin an silebilirsin.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cancel: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    paddingRight: 4,
  },
  publish: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    minWidth: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: {
    aspectRatio: 9 / 13,
    borderRadius: 24,
    overflow: 'hidden',
    marginTop: 8,
  },
  remove: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(9,14,28,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prepBadge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(9,14,28,0.6)',
  },
  emptyPreview: {
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 24,
    minHeight: 260,
    marginTop: 8,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  pickRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    minHeight: 44,
  },
  captionGroup: { gap: 8, marginTop: 18 },
  captionInput: {
    minHeight: 84,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    marginTop: 14,
  },
  statusText: { flex: 1 },
  statusCancel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 26,
  },
  submit: { marginTop: 20 },
  note: { marginTop: 12, paddingBottom: 10 },
});
