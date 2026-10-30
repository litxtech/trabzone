import { Ionicons } from '@expo/vector-icons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppImage, AppText, Button, IconButton, TextField } from '@/components/ui';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { pickMedia } from '@/features/media/media-picker';
import { uploadMedia } from '@/features/media/media-service';
import { useAuthStore } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import { useAdMedia, useAdMediaRegister } from '../hooks';
import type { AdMediaAsset } from '../types';

type Variant = AdMediaAsset['variant'];

/** Banner için önerilen kırpma oranı (genişlik / yükseklik). */
export const BANNER_CROP_RATIO = 3;

async function cropToRatio(
  uri: string,
  width: number | null,
  height: number | null,
  ratio: number,
  focus: 'left' | 'center' | 'right',
): Promise<{ uri: string; width: number | null; height: number | null }> {
  if (!width || !height) {
    return { uri, width, height };
  }
  let cropWidth = width;
  let cropHeight = height;
  let originX = 0;
  let originY = 0;
  if (width / height > ratio) {
    cropWidth = Math.round(height * ratio);
    originX = focus === 'left' ? 0 : focus === 'right' ? width - cropWidth : Math.round((width - cropWidth) / 2);
  } else {
    cropHeight = Math.round(width / ratio);
    originY = Math.round((height - cropHeight) / 2);
  }
  const context = ImageManipulator.manipulate(uri);
  context.crop({ originX, originY, width: cropWidth, height: cropHeight });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: cropWidth, height: cropHeight };
}

/**
 * Reklam medyası alanı: Cloudflare R2'ye yükleme (isteğe bağlı 3:1 kırpma),
 * medya kütüphanesinden seçme veya https adresi girme.
 */
export function AdMediaField({
  label,
  value,
  onChange,
  variant,
  crop = false,
  focus = 'center',
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  variant: Variant;
  crop?: boolean;
  focus?: 'left' | 'center' | 'right';
  hint?: string;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const uid = useAuthStore((state) => state.session?.user.id ?? null);
  const register = useAdMediaRegister();
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const isVideo = variant === 'video';

  const upload = async (applyCrop: boolean) => {
    if (!uid) {
      toast.error('Oturum bulunamadı.');
      return;
    }
    const picked = await pickMedia({ source: 'library', kind: isVideo ? 'video' : 'image' });
    const asset = picked?.[0];
    if (!asset) {
      return;
    }
    setBusy(true);
    try {
      let uri = asset.uri;
      let width = asset.width;
      let height = asset.height;
      if (applyCrop && !isVideo) {
        const cropped = await cropToRatio(uri, width, height, BANNER_CROP_RATIO, focus);
        uri = cropped.uri;
        width = cropped.width;
        height = cropped.height;
      }
      const result = await uploadMedia({
        bucket: 'ad-media',
        folder: uid,
        uri,
        mime: applyCrop && !isVideo ? 'image/jpeg' : asset.mimeType,
        fileName: asset.fileName,
        width,
        height,
        fileSize: applyCrop ? null : asset.fileSize,
        durationMs: asset.durationMs,
      });
      if (!result.ok || !result.data.publicUrl) {
        toast.error(result.ok ? 'Yüklenen dosyanın genel adresi oluşturulamadı.' : result.error.message);
        return;
      }
      await register.mutateAsync({
        url: result.data.publicUrl,
        storagePath: result.data.path,
        mediaType: result.data.mediaType,
        variant,
        width: result.data.width,
        height: result.data.height,
        size: result.data.size,
        label: asset.fileName ?? null,
      });
      onChange(result.data.publicUrl);
      toast.success('Medya yüklendi ve kütüphaneye eklendi.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Medya yüklenemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {value && !isVideo ? (
          <View style={[styles.thumb, { borderColor: theme.colors.border }]}>
            <AppImage source={{ uri: value }} style={StyleSheet.absoluteFill} contentFit="cover" />
          </View>
        ) : null}
        <View style={styles.flex}>
          <TextField
            label={label}
            value={value}
            onChangeText={onChange}
            placeholder="https://…"
            autoCapitalize="none"
            hint={hint}
            editable={!disabled}
          />
        </View>
      </View>
      <View style={styles.actions}>
        {crop && !isVideo ? (
          <Button
            label="Yükle ve 3:1 kırp"
            size="sm"
            fullWidth={false}
            loading={busy}
            disabled={disabled}
            leftIcon={<Ionicons name="crop-outline" size={14} color={theme.colors.onPrimary} />}
            onPress={() => void upload(true)}
          />
        ) : null}
        <Button
          label={crop && !isVideo ? 'Kırpmadan yükle' : 'Yükle'}
          size="sm"
          variant={crop && !isVideo ? 'secondary' : 'primary'}
          fullWidth={false}
          loading={busy && !crop}
          disabled={disabled || busy}
          leftIcon={
            <Ionicons
              name="cloud-upload-outline"
              size={14}
              color={crop && !isVideo ? theme.colors.text : theme.colors.onPrimary}
            />
          }
          onPress={() => void upload(false)}
        />
        <Button
          label="Kütüphaneden seç"
          size="sm"
          variant="ghost"
          fullWidth={false}
          disabled={disabled}
          onPress={() => setLibraryOpen(true)}
        />
        {value ? (
          <Button label="Temizle" size="sm" variant="ghost" fullWidth={false} onPress={() => onChange('')} />
        ) : null}
      </View>
      <MediaLibraryModal
        visible={libraryOpen}
        variant={variant}
        onClose={() => setLibraryOpen(false)}
        onSelect={(url) => {
          onChange(url);
          setLibraryOpen(false);
        }}
      />
    </View>
  );
}

function MediaLibraryModal({
  visible,
  variant,
  onClose,
  onSelect,
}: {
  visible: boolean;
  variant: Variant;
  onClose: () => void;
  onSelect: (url: string) => void;
}) {
  const { theme } = useTheme();
  const media = useAdMedia(null, visible);
  const items = (media.data?.items ?? []).filter((item) =>
    variant === 'video' ? item.media_type === 'video' : item.media_type === 'image',
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={[styles.panelHead, { borderColor: theme.colors.divider }]}>
            <AppText variant="h3" style={styles.flex}>
              Medya kütüphanesi
            </AppText>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.grid}>
            {items.length === 0 ? (
              <AppText variant="body" color="textSecondary">
                {media.isLoading ? 'Yükleniyor…' : 'Kütüphanede uygun medya yok.'}
              </AppText>
            ) : (
              items.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={item.label ?? 'Medya'}
                  onPress={() => onSelect(item.url)}
                  style={[styles.tile, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}
                >
                  {item.media_type === 'image' ? (
                    <AppImage source={{ uri: item.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Ionicons name="videocam-outline" size={24} color={theme.colors.textSecondary} />
                  )}
                  <View style={styles.tileBadge}>
                    <AppText variant="caption" style={styles.tileBadgeText}>
                      {item.variant}
                      {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
                    </AppText>
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  flex: { flex: 1 },
  thumb: {
    width: 96,
    height: 32 + 28,
    marginTop: 22,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  panel: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '86%',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  panelHead: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grid: { padding: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: 168,
    height: 84,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(6,10,20,0.6)',
  },
  tileBadgeText: { color: '#FFFFFF', fontSize: 10 },
});
