import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, IconButton } from '@/components/ui';
import { pickMedia, type PickedAsset } from '@/features/media/media-picker';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useKeyboardBottomInset } from '@/providers/keyboard';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useUpsertPlaceReview } from '../hooks/use-explore';
import type { PlaceReview } from '../types';

type Props = {
  visible: boolean;
  placeId: string;
  placeName: string;
  existing?: PlaceReview | null;
  onClose: () => void;
  onSaved: () => void;
};

const MAX_BODY = 2000;
const MAX_MEDIA = 4;
const RATING_LABEL = ['', 'Çok kötü', 'Kötü', 'Orta', 'İyi', 'Mükemmel'];

/** 1-5 yıldız + metin + isteğe bağlı fotoğraf/video. Aynı işletmeye tek aktif yorum. */
export function AddReviewModal({ visible, placeId, placeName, existing, onClose, onSaved }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardBottomInset();
  const profile = useMyProfile();
  const upsert = useUpsertPlaceReview(placeId);

  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? '');
  const [assets, setAssets] = useState<PickedAsset[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editing = Boolean(existing);
  const busy = Boolean(stage) || upsert.isPending;
  const existingMediaCount = existing?.media.length ?? 0;

  const canSubmit = useMemo(
    () => rating >= 1 && !busy && body.trim().length <= MAX_BODY,
    [body, busy, rating],
  );

  const reset = () => {
    setRating(existing?.rating ?? 0);
    setBody(existing?.body ?? '');
    setAssets([]);
    setError(null);
    setStage(null);
  };

  const close = () => {
    if (busy) {
      return;
    }
    reset();
    onClose();
  };

  const addMedia = async (source: 'library' | 'camera') => {
    setError(null);
    const picked = await pickMedia({
      source,
      kind: 'all',
      multiple: source === 'library',
      limit: Math.max(1, MAX_MEDIA - assets.length),
      maxVideoDuration: 90,
    });
    if (!picked || picked.length === 0) {
      return;
    }
    setAssets((current) => [...current, ...picked].slice(0, MAX_MEDIA));
  };

  const submit = async () => {
    if (!canSubmit || !profile.data) {
      if (!profile.data) {
        setError('Yorum yazmak için giriş yapmalısın.');
      }
      return;
    }

    setError(null);
    const uploadedMedia: { kind: 'image' | 'video'; storage_path: string }[] = [];

    const { uploadMedia } = await import('@/features/media/media-service');
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index]!;
      setStage(`Medya yükleniyor ${index + 1}/${assets.length}`);
      const result = await uploadMedia({
        bucket: 'place-media',
        folder: profile.data.id,
        uri: asset.uri,
        mime: asset.mimeType,
        fileName: asset.fileName,
        compressImages: asset.mediaType === 'image',
      });
      if (!result.ok) {
        setStage(null);
        setError(result.error.message || 'Medya yüklenemedi. Bağlantını kontrol edip tekrar dene.');
        return;
      }
      uploadedMedia.push({
        kind: result.data.mediaType === 'video' ? 'video' : 'image',
        storage_path: result.data.path,
      });
    }

    setStage('Yorum kaydediliyor');
    upsert.mutate(
      {
        rating,
        body: body.trim() ? body.trim() : null,
        media: uploadedMedia.length > 0 ? uploadedMedia : undefined,
      },
      {
        onSuccess: () => {
          haptics.success();
          setStage(null);
          reset();
          Alert.alert(
            editing ? 'Yorum güncellendi' : 'Yorumun alındı',
            'Yorumun moderasyon kurallarına uygunsa işletme sayfasında yayınlanacak. Ortalama puan yalnızca onaylı yorumlardan hesaplanır.',
            [{ text: 'Tamam', onPress: onSaved }],
          );
        },
        onError: (mutationError) => {
          setStage(null);
          setError(mutationError.message || 'Yorum kaydedilemedi.');
        },
      },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[styles.root, keyboardInset]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Yorum penceresini kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={close}
        />
        <View
          style={[
            styles.sheet,
            theme.shadows.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
          <View style={styles.head}>
            <View style={styles.headText}>
              <AppText variant="h3">{editing ? 'Yorumunu düzenle' : 'Deneyimini paylaş'}</AppText>
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {placeName}
              </AppText>
            </View>
            <IconButton name="close" accessibilityLabel="Kapat" variant="plain" size={18} onPress={close} />
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityLabel={`${value} yıldız`}
                  accessibilityState={{ selected: rating === value }}
                  hitSlop={6}
                  onPress={() => {
                    haptics.selection();
                    setRating(value);
                  }}
                >
                  <Ionicons
                    name={value <= rating ? 'star' : 'star-outline'}
                    size={34}
                    color={value <= rating ? theme.colors.warning : theme.colors.borderStrong}
                  />
                </Pressable>
              ))}
            </View>
            <AppText variant="caption" color="textSecondary" align="center">
              {rating > 0 ? `${RATING_LABEL[rating]} · ${rating}/5` : 'Puan vermek için yıldızlara dokun'}
            </AppText>

            <View
              style={[
                styles.textArea,
                { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border },
              ]}
            >
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="Hizmet, ortam, fiyat ve deneyimin hakkında birkaç cümle yaz…"
                placeholderTextColor={theme.colors.textTertiary}
                multiline
                maxLength={MAX_BODY}
                style={[styles.input, { color: theme.colors.text }]}
                editable={!busy}
                textAlignVertical="top"
              />
              <AppText variant="caption" color="textTertiary" align="right">
                {body.length}/{MAX_BODY}
              </AppText>
            </View>

            <View style={styles.mediaHead}>
              <AppText variant="bodyStrong">Fotoğraf / video</AppText>
              <AppText variant="caption" color="textTertiary">
                {existingMediaCount > 0
                  ? `Mevcut ${existingMediaCount} medya korunur, yeni seçimler eklenir.`
                  : `En fazla ${MAX_MEDIA} dosya`}
              </AppText>
            </View>

            <View style={styles.mediaRow}>
              {assets.map((asset, index) => (
                <View key={`${asset.uri}-${index}`} style={styles.mediaTile}>
                  {asset.mediaType === 'video' ? (
                    <View style={[StyleSheet.absoluteFill, styles.videoTile, { backgroundColor: '#0B1220' }]}>
                      <Ionicons name="videocam" size={20} color="#FFFFFF" />
                    </View>
                  ) : (
                    <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Seçilen medyayı kaldır"
                    hitSlop={6}
                    onPress={() => setAssets((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    style={styles.removeMedia}
                  >
                    <Ionicons name="close" size={12} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
              {assets.length < MAX_MEDIA ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Galeriden medya ekle"
                    onPress={() => void addMedia('library')}
                    disabled={busy}
                    style={[styles.addTile, { borderColor: theme.colors.borderStrong }]}
                  >
                    <Ionicons name="images-outline" size={20} color={theme.colors.primaryDeep} />
                    <AppText variant="caption" color="textTertiary">
                      Galeri
                    </AppText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Kameradan medya ekle"
                    onPress={() => void addMedia('camera')}
                    disabled={busy}
                    style={[styles.addTile, { borderColor: theme.colors.borderStrong }]}
                  >
                    <Ionicons name="camera-outline" size={20} color={theme.colors.primaryDeep} />
                    <AppText variant="caption" color="textTertiary">
                      Kamera
                    </AppText>
                  </Pressable>
                </>
              ) : null}
            </View>

            <View
              style={[
                styles.note,
                { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
              ]}
            >
              <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.textSecondary} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Yorumlar moderasyon kontrolünden geçer. Aynı işletmeye tek aktif puanlama kaydı tutulur;
                işletme sahipleri yorumları silemez, yalnızca yanıtlayabilir.
              </AppText>
            </View>

            {error ? (
              <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
                <AppText variant="caption" color="danger" style={styles.flex}>
                  {error}
                </AppText>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            {stage ? (
              <View style={styles.stageRow}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <AppText variant="caption" color="textSecondary">
                  {stage}
                </AppText>
              </View>
            ) : null}
            <Button
              label={editing ? 'Yorumu güncelle' : 'Yorumu gönder'}
              onPress={() => void submit()}
              loading={busy}
              disabled={!canSubmit}
            />
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingTop: 8,
    maxHeight: '92%',
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headText: { flex: 1, gap: 1 },
  body: { marginTop: 6 },
  bodyContent: { gap: 12, paddingBottom: 10 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingTop: 6 },
  textArea: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4 },
  input: { minHeight: 100, fontSize: 15, lineHeight: 21 },
  mediaHead: { gap: 1 },
  mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaTile: {
    width: 70,
    height: 70,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1220',
  },
  videoTile: { alignItems: 'center', justifyContent: 'center' },
  removeMedia: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  addTile: {
    width: 70,
    height: 70,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  note: {
    flexDirection: 'row',
    gap: 8,
    padding: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  error: { flexDirection: 'row', gap: 6, padding: 10, borderRadius: 12, alignItems: 'center' },
  footer: { gap: 8, paddingTop: 8 },
  stageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  flex: { flex: 1 },
});
