import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui';
import { pickMedia } from '@/features/media/media-picker';
import { uploadMedia } from '@/features/media/media-service';
import { SafetySheet } from '@/features/safety/components/SafetySheet';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useUpdateReel } from '../hooks/use-reels';
import type { Reel } from '../services/reels-service';
import { reelUrl } from '../services/reels-service';

export function ReelEditSheet({
  visible,
  reel,
  onClose,
}: {
  visible: boolean;
  reel: Reel | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const session = useSession();
  const updateReel = useUpdateReel();
  const [caption, setCaption] = useState(reel?.caption ?? '');
  const [coverPath, setCoverPath] = useState<string | null>(reel?.cover_path ?? null);
  const [coverUri, setCoverUri] = useState<string | null>(
    reelUrl(reel?.cover_path, reel?.storage_bucket ?? 'reels') ?? null,
  );
  const [uploadingCover, setUploadingCover] = useState(false);

  if (!reel) {
    return null;
  }

  const changeCover = async () => {
    const picked = await pickMedia({ source: 'library', kind: 'image' });
    const asset = picked?.[0];
    if (!asset) {
      return;
    }
    const userId = session?.user?.id;
    if (!userId) {
      Alert.alert('Oturum gerekli', 'Kapak değiştirmek için tekrar giriş yap.');
      return;
    }
    setUploadingCover(true);
    const uploaded = await uploadMedia({
      bucket: 'reels',
      folder: userId,
      uri: asset.uri,
      mime: asset.mimeType,
      fileName: asset.fileName,
    });
    setUploadingCover(false);
    if (!uploaded.ok) {
      Alert.alert('Kapak yüklenemedi', uploaded.error.message);
      return;
    }
    setCoverPath(uploaded.data.path);
    setCoverUri(uploaded.data.publicUrl ?? asset.uri);
  };

  const save = () => {
    const trimmed = caption.trim();
    haptics.tap();
    updateReel.mutate(
      { reelId: reel.id, caption: trimmed || null, coverPath },
      {
        onSuccess: () => {
          haptics.success();
          onClose();
        },
        onError: (error) => Alert.alert('Güncellenemedi', error.message),
      },
    );
  };

  return (
    <SafetySheet
      visible={visible}
      onClose={onClose}
      title="Reels'i düzenle"
      subtitle="Açıklamayı ve kapak görselini güncelle"
      scrollable
      footer={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Değişiklikleri kaydet"
          disabled={updateReel.isPending}
          onPress={save}
          style={({ pressed }) => [
            styles.save,
            {
              backgroundColor: theme.colors.primary,
              opacity: updateReel.isPending ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {updateReel.isPending ? (
            <ActivityIndicator color={theme.colors.onPrimary} />
          ) : (
            <AppText variant="button" color="onPrimary">
              Kaydet
            </AppText>
          )}
        </Pressable>
      }
    >
      <View style={styles.previewRow}>
        <View style={[styles.cover, { backgroundColor: theme.colors.surfaceMuted }]}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Ionicons name="videocam-outline" size={24} color={theme.colors.textTertiary} />
          )}
        </View>
        <View style={styles.previewText}>
          <AppText variant="label">Kapak görseli</AppText>
          <AppText variant="caption" color="textSecondary">
            Dikey videolarda ilk kare yerine seçtiğin görsel gösterilir.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kapak görseli seç"
            onPress={() => void changeCover()}
            style={({ pressed }) => [
              styles.coverButton,
              {
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            {uploadingCover ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <>
                <Ionicons name="image-outline" size={16} color={theme.colors.primaryDeep} />
                <AppText variant="label" color="primaryDeep">
                  Galeriden seç
                </AppText>
              </>
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <View style={styles.fieldHead}>
          <AppText variant="label">Açıklama</AppText>
          <AppText variant="caption" color="textTertiary">
            {caption.length}/2200
          </AppText>
        </View>
        <TextInput
          value={caption}
          onChangeText={(value) => setCaption(value.slice(0, 2200))}
          placeholder="Videonu anlat..."
          placeholderTextColor={theme.colors.textTertiary}
          multiline
          accessibilityLabel="Reels açıklaması"
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.inputBackground,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
            },
          ]}
        />
      </View>
    </SafetySheet>
  );
}

const styles = StyleSheet.create({
  previewRow: { flexDirection: 'row', gap: 12 },
  cover: {
    width: 92,
    height: 124,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewText: { flex: 1, gap: 6, justifyContent: 'center' },
  coverButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
  },
  field: { gap: 6 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: {
    minHeight: 120,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'top',
    borderWidth: 1,
  },
  save: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
