import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, IconButton, TextField } from '@/components/ui';
import { pickMedia, type PickedAsset } from '@/features/media/media-picker';
import { uploadMedia } from '@/features/media/media-service';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useAddPlaceMedia } from '../hooks/use-explore';

type Props = {
  visible: boolean;
  placeId: string;
  placeName: string;
  onClose: () => void;
  onUploaded: () => void;
};

const MAX_ITEMS = 6;

/** İşletme galerisine kullanıcı fotoğrafı/videosu ekler. Dosyalar gerçek depoya yüklenir. */
export function AddPlaceMediaModal({ visible, placeId, placeName, onClose, onUploaded }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const profile = useMyProfile();
  const addMedia = useAddPlaceMedia(placeId);

  const [assets, setAssets] = useState<PickedAsset[]>([]);
  const [caption, setCaption] = useState('');
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = Boolean(stage) || addMedia.isPending;

  const close = () => {
    if (busy) {
      return;
    }
    setAssets([]);
    setCaption('');
    setError(null);
    onClose();
  };

  const pick = async (source: 'library' | 'camera') => {
    setError(null);
    const picked = await pickMedia({
      source,
      kind: 'all',
      multiple: source === 'library',
      limit: Math.max(1, MAX_ITEMS - assets.length),
      maxVideoDuration: 120,
    });
    if (picked && picked.length > 0) {
      setAssets((current) => [...current, ...picked].slice(0, MAX_ITEMS));
    }
  };

  const upload = async () => {
    if (!profile.data) {
      setError('Medya yüklemek için giriş yapmalısın.');
      return;
    }
    if (assets.length === 0) {
      setError('Önce en az bir fotoğraf veya video seç.');
      return;
    }

    setError(null);
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index]!;
      setStage(`Yükleniyor ${index + 1}/${assets.length}`);
      const uploaded = await uploadMedia({
        bucket: 'place-media',
        folder: profile.data.id,
        uri: asset.uri,
        mime: asset.mimeType,
        fileName: asset.fileName,
        compressImages: asset.mediaType === 'image',
      });
      if (!uploaded.ok) {
        setStage(null);
        setError(uploaded.error.message || 'Medya yüklenemedi.');
        return;
      }

      const committed = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        addMedia.mutate(
          {
            kind: uploaded.data.mediaType === 'video' ? 'video' : 'image',
            storagePath: uploaded.data.path,
            caption: caption.trim() || null,
            width: asset.width,
            height: asset.height,
            durationMs: asset.durationMs,
          },
          {
            onSuccess: () => resolve({ ok: true }),
            onError: (mutationError) => resolve({ ok: false, message: mutationError.message }),
          },
        );
      });

      if (!committed.ok) {
        setStage(null);
        setError(committed.message ?? 'Medya kaydı oluşturulamadı. Yüklenen dosya yayınlanmadı.');
        return;
      }
    }

    setStage(null);
    haptics.success();
    setAssets([]);
    setCaption('');
    Alert.alert(
      'Medya gönderildi',
      'Fotoğraf ve videolar moderasyon kontrolünden sonra işletme galerisinde yayınlanır.',
      [{ text: 'Tamam', onPress: onUploaded }],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Medya penceresini kapat"
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
              <AppText variant="h3">Fotoğraf / video ekle</AppText>
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {placeName}
              </AppText>
            </View>
            <IconButton name="close" accessibilityLabel="Kapat" size={18} onPress={close} />
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.grid}>
              {assets.map((asset, index) => (
                <View
                  key={`${asset.uri}-${index}`}
                  style={[styles.tile, { backgroundColor: theme.colors.surfaceMuted }]}
                >
                  {asset.mediaType === 'video' ? (
                    <View style={styles.videoTile}>
                      <Ionicons name="videocam" size={22} color="#FFFFFF" />
                      <AppText variant="caption" color="#FFFFFF">
                        Video
                      </AppText>
                    </View>
                  ) : (
                    <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Medyayı listeden çıkar"
                    hitSlop={6}
                    disabled={busy}
                    onPress={() => setAssets((current) => current.filter((_, i) => i !== index))}
                    style={styles.remove}
                  >
                    <Ionicons name="close" size={12} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
              {assets.length < MAX_ITEMS ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Galeriden seç"
                    disabled={busy}
                    onPress={() => void pick('library')}
                    style={[styles.addTile, { borderColor: theme.colors.borderStrong }]}
                  >
                    <Ionicons name="images-outline" size={22} color={theme.colors.primaryDeep} />
                    <AppText variant="caption" color="textTertiary">
                      Galeri
                    </AppText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Kameradan çek"
                    disabled={busy}
                    onPress={() => void pick('camera')}
                    style={[styles.addTile, { borderColor: theme.colors.borderStrong }]}
                  >
                    <Ionicons name="camera-outline" size={22} color={theme.colors.primaryDeep} />
                    <AppText variant="caption" color="textTertiary">
                      Kamera
                    </AppText>
                  </Pressable>
                </>
              ) : null}
            </View>

            <TextField
              label="Açıklama (isteğe bağlı)"
              value={caption}
              onChangeText={setCaption}
              placeholder="Örn. Kahvaltı tabağı, teras manzarası…"
              maxLength={200}
              editable={!busy}
            />

            <View style={[styles.note, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.textSecondary} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Yüklediğin içerik hesabınla ilişkilendirilir ve moderasyon kuyruğuna düşer. İşletme
                sahipleri kullanıcı fotoğraflarını silemez, yalnızca incelemeye bildirebilir.
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
              label={assets.length > 1 ? `${assets.length} medyayı gönder` : 'Medyayı gönder'}
              onPress={() => void upload()}
              loading={busy}
              disabled={assets.length === 0 || busy}
            />
          </View>
        </View>
      </View>
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
    maxHeight: '90%',
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headText: { flex: 1, gap: 1 },
  content: { gap: 12, paddingTop: 10, paddingBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: 84, height: 84, borderRadius: 14, overflow: 'hidden' },
  videoTile: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: '#0B1220' },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  addTile: {
    width: 84,
    height: 84,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  note: { flexDirection: 'row', gap: 8, padding: 11, borderRadius: 14 },
  error: { flexDirection: 'row', gap: 6, padding: 10, borderRadius: 12, alignItems: 'center' },
  footer: { gap: 8, paddingTop: 6 },
  stageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  flex: { flex: 1 },
});
