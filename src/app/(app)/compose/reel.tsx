import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useNavigation, usePreventRemove } from 'expo-router';
import { useRouter } from '@/utils/router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Screen } from '@/components/ui';
import { PlaceTagPicker, PlaceTagRow } from '@/features/explore/components/PlaceTagPicker';
import { linkPlaceContent } from '@/features/explore/services/explore-service';
import type { ExploreSearchItem } from '@/features/explore/types';
import { pickMedia, type PickedAsset } from '@/features/media/media-picker';
import { uploadMedia } from '@/features/media/media-service';
import { loadVideoThumbnails, prepareVideoForUpload } from '@/features/media/video-service';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useTheme } from '@/theme/ThemeProvider';
import { toMessage } from '@/utils/error-message';
import { haptics } from '@/utils/haptics';

import { useCreateReel } from '@/features/reels/hooks/use-reels';
import { removeReelUploads } from '@/features/reels/services/reels-service';
import { formatDuration } from '@/features/reels/utils/format';

const MAX_CAPTION = 2200;
const MAX_AUDIO = 120;
const BG = '#070B14';
const CARD = '#0E1524';
const CARD_BORDER = 'rgba(255,255,255,0.08)';
const MUTED = '#8F9BB6';

type CoverAsset = { uri: string; mime: string | null };
type Stage = { label: string; step: number; total: number } | null;

function formatBytes(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) {
    return null;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function VideoPreview({ uri, muted }: { uri: string; muted: boolean }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = muted;
    instance.play();
  });

  useEffect(() => {
    // expo-video oynatıcısı zorunlu (imperative) bir yerel nesnedir.
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [muted, player]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      allowsPictureInPicture={false}
      surfaceType="textureView"
    />
  );
}

export default function ComposeReelScreen() {
  const { theme, scheme } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const { data: profile } = useMyProfile();
  const createReel = useCreateReel();

  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [cover, setCover] = useState<CoverAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [audioTitle, setAudioTitle] = useState('');
  const [placeTag, setPlaceTag] = useState<ExploreSearchItem | null>(null);
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [stage, setStage] = useState<Stage>(null);
  const [leaving, setLeaving] = useState(false);
  const coverRequest = useRef(0);

  const busy = Boolean(stage) || createReel.isPending;

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle(scheme === 'dark' ? 'light' : 'dark');
    }, [scheme]),
  );

  const hasUnsaved =
    Boolean(asset) || Boolean(cover) || caption.trim().length > 0 || audioTitle.trim().length > 0;

  useEffect(() => {
    if (leaving) {
      router.replace('/reels' as never);
    }
  }, [leaving, router]);

  usePreventRemove((hasUnsaved || busy) && !leaving, ({ data }) => {
    if (busy) {
      Alert.alert('Yayınlanıyor', 'Yükleme tamamlanana kadar ekrandan ayrılma.');
      return;
    }
    Alert.alert('Taslağı sil?', 'Seçtiğin video ve yazdıkların kaybolacak.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil ve çık',
        style: 'destructive',
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  const generateCover = useCallback(async (uri: string) => {
    const request = coverRequest.current + 1;
    coverRequest.current = request;
    setThumbBusy(true);
    try {
      const Thumbnails = loadVideoThumbnails();
      if (!Thumbnails) {
        if (coverRequest.current === request) {
          setCover(null);
        }
        return;
      }
      const thumbnail = await Thumbnails.getThumbnailAsync(uri, { time: 400, quality: 0.7 });
      if (coverRequest.current === request) {
        setCover({ uri: thumbnail.uri, mime: 'image/jpeg' });
      }
    } catch {
      if (coverRequest.current === request) {
        setCover(null);
      }
    } finally {
      if (coverRequest.current === request) {
        setThumbBusy(false);
      }
    }
  }, []);

  const chooseVideo = useCallback(
    async (source: 'library' | 'camera') => {
      const picked = await pickMedia({
        source,
        kind: 'video',
      });
      const video = picked?.[0];
      if (!video) {
        return;
      }
      haptics.selection();
      setAsset(video);
      setCover(null);
      // Reels için hazırlık seçim anında başlar; süre sınırı yok, video her
      // boyutta sıkıştırılarak paylaşılır.
      void prepareVideoForUpload(
        {
          uri: video.uri,
          durationMs: video.durationMs,
          width: video.width,
          height: video.height,
          size: video.fileSize,
        },
      ).catch(() => undefined);
      await generateCover(video.uri);
    },
    [generateCover],
  );

  const chooseCover = useCallback(async () => {
    const picked = await pickMedia({ source: 'library', kind: 'image' });
    const image = picked?.[0];
    if (!image) {
      return;
    }
    coverRequest.current += 1;
    setThumbBusy(false);
    setCover({ uri: image.uri, mime: image.mimeType });
    haptics.selection();
  }, []);

  const removeCover = useCallback(() => {
    coverRequest.current += 1;
    setThumbBusy(false);
    setCover(null);
  }, []);

  const durationLabel = useMemo(() => formatDuration(asset?.durationMs), [asset?.durationMs]);
  const sizeLabel = useMemo(() => formatBytes(asset?.fileSize ?? null), [asset?.fileSize]);
  const isVertical = useMemo(() => {
    if (!asset?.width || !asset.height) {
      return true;
    }
    return asset.height >= asset.width;
  }, [asset?.height, asset?.width]);

  const publish = useCallback(async () => {
    const trimmedCaption = caption.trim();
    const trimmedAudio = audioTitle.trim();

    if (!asset) {
      Alert.alert('Video seç', 'Yayınlamak için önce bir Reels videosu seç.');
      return;
    }
    if (!profile?.id) {
      Alert.alert('Oturum gerekli', 'Reels paylaşmak için giriş yapmalısın.');
      return;
    }
    if (trimmedCaption.length > MAX_CAPTION) {
      Alert.alert('Açıklama uzun', `Açıklama en fazla ${MAX_CAPTION} karakter olabilir.`);
      return;
    }
    if (trimmedAudio.length > MAX_AUDIO) {
      Alert.alert('Ses adı uzun', `Ses adı en fazla ${MAX_AUDIO} karakter olabilir.`);
      return;
    }

    haptics.press();
    let videoPath: string | null = null;
    let coverPath: string | null = null;

    try {
      setStage({ label: 'Video hazırlanıyor', step: 1, total: 3 });
      const uploadedVideo = await uploadMedia({
        bucket: 'reels',
        folder: profile.id,
        uri: asset.uri,
        mime: asset.mimeType,
        fileName: asset.fileName,
        durationMs: asset.durationMs,
        width: asset.width,
        height: asset.height,
        fileSize: asset.fileSize,
        onProgress: (phase, ratio) => {
          setStage({
            label:
              phase === 'preparing'
                ? `Video hazırlanıyor • %${Math.round(ratio * 100)}`
                : 'Video yükleniyor',
            step: 1,
            total: 3,
          });
        },
      });
      if (!uploadedVideo.ok) {
        Alert.alert('Video yüklenemedi', uploadedVideo.error.message);
        return;
      }
      videoPath = uploadedVideo.data.path;

      if (cover) {
        setStage({ label: 'Kapak yükleniyor', step: 2, total: 3 });
        const uploadedCover = await uploadMedia({
          bucket: 'reels',
          folder: profile.id,
          uri: cover.uri,
          mime: cover.mime,
          fileName: 'cover.jpg',
        });
        if (!uploadedCover.ok) {
          Alert.alert('Kapak yüklenemedi', uploadedCover.error.message);
          return;
        }
        coverPath = uploadedCover.data.path;
      }

      setStage({ label: 'Reels yayınlanıyor', step: 3, total: 3 });
      const reel = await createReel.mutateAsync({
        videoPath,
        coverPath,
        caption: trimmedCaption || null,
        audioTitle: trimmedAudio || null,
        durationMs: uploadedVideo.data.durationMs ?? asset.durationMs,
        width: uploadedVideo.data.width ?? asset.width,
        height: uploadedVideo.data.height ?? asset.height,
      });

      if (reel && placeTag) {
        try {
          await linkPlaceContent(String(placeTag.id), { reelId: reel.id });
        } catch (error) {
          Alert.alert(
            'Reels yayınlandı',
            `Video paylaşıldı ancak işletme etiketi eklenemedi: ${toMessage(error)}`,
          );
        }
      }
      haptics.success();
      setStage(null);
      setLeaving(true);
      if (!reel) {
        router.replace('/reels' as never);
      }
    } catch (error) {
      await removeReelUploads([videoPath, coverPath]);
      setStage(null);
      Alert.alert('Reels yayınlanamadı', toMessage(error));
    }
  }, [asset, audioTitle, caption, cover, createReel, placeTag, profile, router]);

  const canPublish = Boolean(asset) && !busy;

  return (
    <Screen
      padded={false}
      edges={['left', 'right', 'bottom']}
      keyboardAware
      style={{ backgroundColor: BG }}
      contentContainerStyle={{ backgroundColor: BG }}
      footer={
        <View style={styles.footer}>
          {stage ? (
            <View style={styles.stageBox}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <View style={styles.stageText}>
                <AppText variant="label" color="#FFFFFF">
                  {stage.label}
                </AppText>
                <AppText variant="caption" color={MUTED}>
                  Adım {stage.step}/{stage.total} • Ekrandan ayrılma
                </AppText>
              </View>
            </View>
          ) : null}
          <Button
            label="Reels yayınla"
            size="lg"
            loading={busy}
            disabled={!canPublish}
            onPress={() => void publish()}
            leftIcon={<Ionicons name="sparkles" size={17} color={theme.colors.onPrimary} />}
          />
          <AppText variant="caption" color={MUTED} align="center">
            Yayınlandığında Reels akışında ve profilinde görünür.
          </AppText>
        </View>
      }
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          hitSlop={8}
          disabled={busy}
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.closeButton,
            { opacity: busy ? 0.4 : pressed ? 0.65 : 1 },
          ]}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerTitles}>
          <AppText variant="h3" color="#FFFFFF">
            Yeni Reels
          </AppText>
          <AppText variant="caption" color={MUTED}>
            Dikey video yayınla
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reels yayınla"
          disabled={!canPublish}
          onPress={() => void publish()}
          style={({ pressed }) => [
            styles.publishPill,
            {
              backgroundColor: canPublish ? '#FFFFFF' : 'rgba(255,255,255,0.12)',
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#0B1020" />
          ) : (
            <AppText variant="label" color={canPublish ? '#0B1020' : MUTED}>
              Yayınla
            </AppText>
          )}
        </Pressable>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {!asset ? (
          <View style={styles.hero}>
            <View style={styles.heroFrame}>
              <View style={styles.heroGlow} />
              <View style={styles.heroIcon}>
                <Ionicons name="videocam" size={30} color="#FFFFFF" />
              </View>
              <AppText variant="h3" color="#FFFFFF" align="center">
                Dikey videonu seç
              </AppText>
              <AppText variant="body" color={MUTED} align="center">
                9:16 • süre sınırı yok • otomatik sıkıştırma • MP4 veya MOV
              </AppText>
            </View>

            <View style={styles.sourceRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Galeriden video seç"
                onPress={() => void chooseVideo('library')}
                style={({ pressed }) => [styles.sourceCard, { opacity: pressed ? 0.8 : 1 }]}
              >
                <View style={styles.sourceIcon}>
                  <Ionicons name="images-outline" size={22} color="#FFFFFF" />
                </View>
                <View style={styles.sourceText}>
                  <AppText variant="label" color="#FFFFFF">
                    Galeriden seç
                  </AppText>
                  <AppText variant="caption" color={MUTED}>
                    Hazır videonu yükle
                  </AppText>
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kamera ile video kaydet"
                onPress={() => void chooseVideo('camera')}
                style={({ pressed }) => [styles.sourceCard, { opacity: pressed ? 0.8 : 1 }]}
              >
                <View style={styles.sourceIcon}>
                  <Ionicons name="camera-outline" size={22} color="#FFFFFF" />
                </View>
                <View style={styles.sourceText}>
                  <AppText variant="label" color="#FFFFFF">
                    Video kaydet
                  </AppText>
                  <AppText variant="caption" color={MUTED}>
                    Kamerayla çek
                  </AppText>
                </View>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.previewRow}>
              <View style={styles.previewFrame}>
                <VideoPreview uri={asset.uri} muted={muted} />
                <View style={styles.previewShade} pointerEvents="none" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={muted ? 'Sesi aç' : 'Sesi kapat'}
                  hitSlop={6}
                  onPress={() => setMuted((value) => !value)}
                  style={styles.previewControl}
                >
                  <Ionicons
                    name={muted ? 'volume-mute' : 'volume-high'}
                    size={16}
                    color="#FFFFFF"
                  />
                </Pressable>
                {durationLabel ? (
                  <View style={styles.durationBadge}>
                    <AppText variant="caption" color="#FFFFFF">
                      {durationLabel}
                    </AppText>
                  </View>
                ) : null}
              </View>

              <View style={styles.metaColumn}>
                <AppText variant="caption" color={MUTED}>
                  KAPAK GÖRSELİ
                </AppText>
                <View style={styles.coverRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Kapak görseli seç"
                    onPress={() => void chooseCover()}
                    style={({ pressed }) => [styles.coverFrame, { opacity: pressed ? 0.8 : 1 }]}
                  >
                    {cover ? (
                      <Image
                        source={{ uri: cover.uri }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={styles.coverEmpty}>
                        {thumbBusy ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Ionicons name="image-outline" size={20} color={MUTED} />
                        )}
                      </View>
                    )}
                    <View style={styles.coverEdit}>
                      <Ionicons name="pencil" size={11} color="#FFFFFF" />
                    </View>
                  </Pressable>

                  <View style={styles.coverActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Kapak görseli değiştir"
                      onPress={() => void chooseCover()}
                      style={({ pressed }) => [styles.smallAction, { opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Ionicons name="image-outline" size={14} color="#FFFFFF" />
                      <AppText variant="caption" color="#FFFFFF">
                        Değiştir
                      </AppText>
                    </Pressable>
                    {cover ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Kapak görselini kaldır"
                        onPress={removeCover}
                        style={({ pressed }) => [
                          styles.smallAction,
                          { opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <Ionicons name="close-circle-outline" size={14} color={MUTED} />
                        <AppText variant="caption" color={MUTED}>
                          Kaldır
                        </AppText>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Videoyu değiştir"
                      onPress={() => void chooseVideo('library')}
                      style={({ pressed }) => [styles.smallAction, { opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Ionicons name="swap-horizontal" size={14} color="#FFFFFF" />
                      <AppText variant="caption" color="#FFFFFF">
                        Videoyu değiştir
                      </AppText>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.metaChips}>
                  {durationLabel ? <MetaChip icon="time-outline" label={durationLabel} /> : null}
                  {sizeLabel ? <MetaChip icon="document-outline" label={sizeLabel} /> : null}
                  {asset.width && asset.height ? (
                    <MetaChip icon="resize-outline" label={`${asset.width}×${asset.height}`} />
                  ) : null}
                </View>
              </View>
            </View>

            {!isVertical ? (
              <View style={styles.warning}>
                <Ionicons name="alert-circle-outline" size={16} color="#FBBF24" />
                <AppText variant="caption" color="#FCD34D" style={styles.warningText}>
                  Yatay video yükleniyor. Reels tam ekranda ortadan kırpılarak gösterilir; dikey
                  video öneririz.
                </AppText>
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <AppText variant="caption" color={MUTED}>
                  İŞLETME ETİKETİ
                </AppText>
                <AppText variant="caption" color={MUTED}>
                  İsteğe bağlı
                </AppText>
              </View>
              <PlaceTagRow
                dark
                value={placeTag}
                onPress={() => setPlacePickerOpen(true)}
                onClear={() => setPlaceTag(null)}
              />
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <AppText variant="caption" color={MUTED}>
                  AÇIKLAMA
                </AppText>
                <AppText variant="caption" color={MUTED}>
                  {caption.length}/{MAX_CAPTION}
                </AppText>
              </View>
              <TextInput
                value={caption}
                onChangeText={(value) => setCaption(value.slice(0, MAX_CAPTION))}
                placeholder="Videonu anlat, takipçilerini konuya dahil et..."
                placeholderTextColor="#5E6B85"
                multiline
                editable={!busy}
                accessibilityLabel="Reels açıklaması"
                style={styles.captionInput}
              />
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <AppText variant="caption" color={MUTED}>
                  SES / MÜZİK
                </AppText>
                <AppText variant="caption" color={MUTED}>
                  İsteğe bağlı
                </AppText>
              </View>
              <View style={styles.audioRow}>
                <View style={styles.audioIcon}>
                  <Ionicons name="musical-notes" size={17} color="#FFFFFF" />
                </View>
                <TextInput
                  value={audioTitle}
                  onChangeText={(value) => setAudioTitle(value.slice(0, MAX_AUDIO))}
                  placeholder="Orijinal ses veya parça adı"
                  placeholderTextColor="#5E6B85"
                  editable={!busy}
                  accessibilityLabel="Ses veya müzik adı"
                  style={styles.audioInput}
                />
              </View>
              <View style={styles.rightsNote}>
                <Ionicons name="shield-checkmark-outline" size={13} color={MUTED} />
                <AppText variant="caption" color={MUTED} style={styles.rightsText}>
                  Kullandığın sesin yayın haklarına sahip olduğundan emin ol.
                </AppText>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <PlaceTagPicker
        visible={placePickerOpen}
        selectedId={placeTag ? String(placeTag.id) : null}
        onClose={() => setPlacePickerOpen(false)}
        onSelect={setPlaceTag}
        onClear={() => setPlaceTag(null)}
      />
    </Screen>
  );
}

function MetaChip({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={12} color={MUTED} />
      <AppText variant="caption" color="#D8DFEF">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: BG,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerTitles: { flex: 1, gap: 1 },
  publishPill: {
    minWidth: 78,
    minHeight: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 18 },
  hero: { gap: 12 },
  heroFrame: {
    minHeight: 240,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(65,105,245,0.18)',
    top: -60,
    right: -40,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 4,
  },
  sourceRow: { flexDirection: 'row', gap: 10 },
  sourceCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
    backgroundColor: CARD,
  },
  sourceIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sourceText: { flex: 1, gap: 1 },
  previewRow: { flexDirection: 'row', gap: 12 },
  previewFrame: {
    width: 166,
    aspectRatio: 9 / 16,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000000',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
  },
  previewShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(4,8,16,0.12)',
  },
  previewControl: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,8,16,0.55)',
  },
  durationBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(4,8,16,0.6)',
  },
  metaColumn: { flex: 1, gap: 7 },
  coverRow: { flexDirection: 'row', gap: 10 },
  coverFrame: {
    width: 86,
    aspectRatio: 9 / 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111A2C',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
  },
  coverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverEdit: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,8,16,0.65)',
  },
  coverActions: { flex: 1, justifyContent: 'center', gap: 8 },
  smallAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 9,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  metaChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 11,
    borderRadius: 13,
    backgroundColor: 'rgba(251,191,36,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(251,191,36,0.24)',
  },
  warningText: { flex: 1, lineHeight: 17 },
  fieldGroup: { gap: 7 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  captionInput: {
    minHeight: 108,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
    backgroundColor: CARD,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    color: '#F5F7FF',
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
    backgroundColor: CARD,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  audioIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(128,87,244,0.2)',
  },
  audioInput: { flex: 1, color: '#F5F7FF', fontSize: 14, padding: 0 },
  rightsNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, paddingHorizontal: 2 },
  rightsText: { flex: 1, lineHeight: 16 },
  footer: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CARD_BORDER,
    backgroundColor: BG,
  },
  stageBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
  },
  stageText: { flex: 1, gap: 1 },
});
