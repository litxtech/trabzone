import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppImage, AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { accKeys, useAccommodationMedia } from '../hooks/use-accommodation';
import * as accApi from '../services/accommodation-service';
import {
  accommodationMediaUrl,
  deleteAccommodationMedia,
  uploadAccommodationMedia,
} from '../services/accommodation-media-service';
import type { MediaItem } from '../types';
import { InlineError, InfoBanner } from './AccommodationUI';
import { FullScreenGallery } from './FullScreenGallery';

/** Tek seferde seçilebilecek en fazla fotoğraf (galeri yükü sınırlı kalsın). */
const MAX_PICK = 12;

type PendingPhoto = { key: string; uri: string };

type Progress = { done: number; total: number } | null;

/**
 * Otel başvurusu içindeki fotoğraf yükleme bölümü.
 *
 * Belge adımıyla aynı sayfada yaşar: kullanıcı fotoğrafları seçer, yükleme
 * başlar başlamaz önizlemeleri görür ve yüklenen her fotoğraf ızgarada kalıcı
 * olarak listelenir. İlk fotoğraf otomatik kapak olur; diğerleri tek dokunuşla
 * kapak yapılabilir veya silinebilir.
 */
export function HotelPhotoUploader({
  propertyId,
  ensurePropertyId,
  onChanged,
  onPhotosChange,
  validationError,
}: {
  propertyId: string | null;
  /** Form henüz kaydedilmediyse taslağı kaydedip tesis kimliği döner. */
  ensurePropertyId: () => Promise<string | null>;
  onChanged?: () => void;
  /** Başvuru doğrulaması için kaç fotoğraf yüklü olduğunu üst forma bildirir. */
  onPhotosChange?: (count: number) => void;
  /** Boş bırakıldığında gösterilecek kırmızı uyarı metni. */
  validationError?: string | null;
}) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const queryClient = useQueryClient();
  const media = useAccommodationMedia(propertyId);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<MediaItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const items = media.data?.items ?? [];
  const photos = useMemo(
    () =>
      media.data?.items
        .filter((item) => item.kind === 'image')
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order) ?? [],
    [media.data],
  );
  const covers = photos.filter((item) => item.cover).length;

  // Üst form doğrulama sırasında "en az bir fotoğraf" kuralını buradan öğrenir.
  useEffect(() => {
    onPhotosChange?.(photos.length);
  }, [onPhotosChange, photos.length]);

  const columns = width >= 1080 ? 4 : width >= 720 ? 3 : 2;
  const tileWidth = `${100 / columns - 1.6}%` as const;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: accKeys.all });
    void media.refetch();
    onChanged?.();
  };

  const pickPhotos = async () => {
    setError(null);
    setNote(null);
    let picked: ImagePicker.ImagePickerAsset[] = [];
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsMultipleSelection: true,
        selectionLimit: MAX_PICK,
      });
      if (result.canceled || result.assets.length === 0) return;
      picked = result.assets.slice(0, MAX_PICK);
    } catch {
      setError('Fotoğraf seçici açılamadı. İzni kontrol edip tekrar dene.');
      return;
    }

    const targetId = propertyId ?? (await ensurePropertyId());
    if (!targetId) {
      setError('Fotoğraf yüklemek için tesis adını gir ve taslağı kaydet.');
      return;
    }

    const locals: PendingPhoto[] = picked.map((asset, index) => ({
      key: `${Date.now()}-${index}`,
      uri: asset.uri,
    }));
    setPending(locals);
    setUploading(true);
    setProgress({ done: 0, total: picked.length });

    const startOrder = items.reduce((max, item) => Math.max(max, item.sort_order), 0) + 1;
    const hasCover = items.some((item) => item.cover);
    let done = 0;
    let failed = 0;
    let firstFailure: string | null = null;

    try {
      for (let index = 0; index < picked.length; index += 1) {
        const asset = picked[index]!;
        setProgress({ done: index, total: picked.length });

        const uploaded = await uploadAccommodationMedia({
          propertyId: targetId,
          uri: asset.uri,
          name: asset.fileName ?? `tesis-${Date.now()}-${index}.jpg`,
          mime: asset.mimeType ?? 'image/jpeg',
          kind: 'image',
          size: asset.fileSize ?? null,
        });
        if (!uploaded.ok) {
          failed += 1;
          firstFailure ??= uploaded.error.message;
          continue;
        }

        const created = await accApi.addMedia({
          propertyId: targetId,
          kind: 'image',
          storagePath: uploaded.data.path,
          category: 'general',
          caption: null,
          cover: !hasCover && done === 0,
          sortOrder: startOrder + done,
        });
        if (!created.ok) {
          failed += 1;
          firstFailure ??= created.error.message;
          continue;
        }

        done += 1;
        setPending((current) => current.filter((entry) => entry.key !== locals[index]!.key));
      }

      setProgress({ done: picked.length, total: picked.length });
      if (failed > 0) {
        setError(
          done > 0
            ? `${done} fotoğraf yüklendi, ${failed} fotoğraf yüklenemedi. ${firstFailure ?? 'Tekrar deneyebilirsin.'}`
            : `Fotoğraflar yüklenemedi. ${firstFailure ?? 'Bağlantını kontrol edip tekrar dene.'}`,
        );
      } else if (done > 0) {
        setNote(
          `${done} fotoğraf yüklendi. İlk fotoğraf vitrin kapağı olarak ayarlandı; diğerlerini kapak yapabilirsin.`,
        );
      }
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fotoğraflar yüklenemedi.');
    } finally {
      setUploading(false);
      setPending([]);
      setProgress(null);
    }
  };

  const makeCover = async (item: MediaItem) => {
    setError(null);
    setBusyId(item.id);
    const result = await accApi.setMediaCover(item.id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    refresh();
  };

  const removePhoto = async (item: MediaItem) => {
    setError(null);
    setBusyId(item.id);
    const removed = await accApi.deleteMedia(item.id);
    if (!removed.ok) {
      setBusyId(null);
      setError(removed.error.message);
      return;
    }
    if (removed.data.storage_path) {
      await deleteAccommodationMedia(removed.data.storage_path).catch(() => undefined);
    }
    setBusyId(null);
    setConfirming(null);
    setPreviewIndex(null);
    refresh();
  };

  const isEmpty = photos.length === 0 && pending.length === 0;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderWidth: validationError ? 1.5 : StyleSheet.hairlineWidth,
          borderColor: validationError ? theme.colors.danger : theme.colors.border,
        },
      ]}
    >
      <View style={styles.head}>
        <View style={[styles.headIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="images" size={17} color={theme.colors.primaryDeep} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Tesis fotoğrafları</AppText>
          <AppText variant="caption" color="textTertiary">
            {photos.length > 0
              ? `${photos.length} fotoğraf · ${covers > 0 ? 'kapak seçildi' : 'kapak seçilmedi'}`
              : 'En az 3 fotoğraf önerilir · ilk fotoğraf kapak olur'}
          </AppText>
        </View>
        <Button
          label={photos.length > 0 ? 'Fotoğraf ekle' : 'Fotoğraf yükle'}
          size="sm"
          variant={photos.length > 0 ? 'outline' : 'primary'}
          fullWidth={false}
          loading={uploading}
          leftIcon={
            <Ionicons
              name="cloud-upload-outline"
              size={15}
              color={photos.length > 0 ? theme.colors.text : theme.colors.onPrimary}
            />
          }
          onPress={() => void pickPhotos()}
        />
      </View>

      {validationError ? <InlineError message={validationError} /> : null}
      {error ? <InlineError message={error} /> : null}
      {note ? <InfoBanner tone="success" text={note} /> : null}

      {uploading && progress ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressHead}>
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              Fotoğraflar yükleniyor…
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {Math.min(progress.done + 1, progress.total)} / {progress.total}
            </AppText>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      {confirming ? (
        <View style={[styles.confirmRow, { backgroundColor: theme.colors.dangerSoft }]}>
          <Ionicons name="trash-outline" size={15} color={theme.colors.danger} />
          <AppText variant="caption" color="danger" style={styles.flex}>
            Bu fotoğraf galeriden kaldırılacak. Emin misin?
          </AppText>
          <Button
            label="Vazgeç"
            size="sm"
            variant="ghost"
            fullWidth={false}
            onPress={() => setConfirming(null)}
          />
          <Button
            label="Sil"
            size="sm"
            variant="danger"
            fullWidth={false}
            loading={busyId === confirming.id}
            onPress={() => void removePhoto(confirming)}
          />
        </View>
      ) : null}

      {media.isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <AppText variant="caption" color="textTertiary">
            Fotoğraflar yükleniyor…
          </AppText>
        </View>
      ) : media.isError ? (
        <InlineError
          message={media.error instanceof Error ? media.error.message : 'Fotoğraflar okunamadı.'}
          onRetry={() => void media.refetch()}
        />
      ) : (
        <View style={styles.grid}>
          {photos.map((item, index) => {
            const uri = accommodationMediaUrl(item.storage_path);
            return (
              <View
                key={item.id}
                style={[styles.tile, { width: tileWidth, borderColor: theme.colors.border }]}
              >
                <Pressable
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`${index + 1}. fotoğrafı büyüt`}
                  onPress={() => setPreviewIndex(index)}
                  style={[styles.tileMedia, { backgroundColor: theme.colors.surfaceMuted }]}
                >
                  {uri ? (
                    <AppImage
                      source={{ uri }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={140}
                    />
                  ) : (
                    <View style={styles.tileFallback}>
                      <Ionicons name="image-outline" size={22} color={theme.colors.textTertiary} />
                    </View>
                  )}
                  {item.cover ? (
                    <View style={[styles.coverBadge, { backgroundColor: theme.colors.primary }]}>
                      <Ionicons name="star" size={10} color={theme.colors.onPrimary} />
                      <AppText
                        variant="caption"
                        style={[styles.coverText, { color: theme.colors.onPrimary }]}
                      >
                        Kapak
                      </AppText>
                    </View>
                  ) : null}
                  {item.status !== 'approved' ? (
                    <View
                      style={[
                        styles.statusDot,
                        {
                          backgroundColor:
                            item.status === 'pending' ? theme.colors.warning : theme.colors.danger,
                        },
                      ]}
                    />
                  ) : null}
                </Pressable>
                <View style={styles.tileFoot}>
                  <AppText
                    variant="caption"
                    color="textTertiary"
                    numberOfLines={1}
                    style={styles.flex}
                  >
                    {item.cover ? 'Vitrin kapağı' : `${index + 1}. fotoğraf`}
                  </AppText>
                  {!item.cover ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Kapak fotoğrafı yap"
                      hitSlop={6}
                      disabled={busyId === item.id}
                      onPress={() => void makeCover(item)}
                      style={({ pressed }) => [styles.tileAction, { opacity: pressed ? 0.55 : 1 }]}
                    >
                      <Ionicons name="star-outline" size={15} color={theme.colors.textSecondary} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Fotoğrafı sil"
                    hitSlop={6}
                    disabled={busyId === item.id}
                    onPress={() => setConfirming(item)}
                    style={({ pressed }) => [styles.tileAction, { opacity: pressed ? 0.55 : 1 }]}
                  >
                    <Ionicons name="trash-outline" size={15} color={theme.colors.danger} />
                  </Pressable>
                </View>
              </View>
            );
          })}

          {pending.map((entry) => (
            <View
              key={entry.key}
              style={[styles.tile, { width: tileWidth, borderColor: theme.colors.border }]}
            >
              <View style={[styles.tileMedia, { backgroundColor: theme.colors.surfaceMuted }]}>
                <AppImage
                  source={{ uri: entry.uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
                <View style={styles.pendingOverlay}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <AppText variant="caption" style={styles.pendingText}>
                    Yükleniyor
                  </AppText>
                </View>
              </View>
              <View style={styles.tileFoot}>
                <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
                  Önizleme
                </AppText>
              </View>
            </View>
          ))}

          {isEmpty ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fotoğraf yükle"
              onPress={() => void pickPhotos()}
              style={({ pressed }) => [
                styles.emptyTile,
                {
                  borderColor: theme.colors.borderStrong,
                  backgroundColor: theme.colors.surfaceMuted,
                  opacity: pressed ? 0.82 : 1,
                },
              ]}
            >
              <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="cloud-upload-outline" size={22} color={theme.colors.primaryDeep} />
              </View>
              <AppText variant="bodyStrong">Fotoğraf ekle</AppText>
              <AppText variant="caption" color="textTertiary" align="center">
                Galeriden birden fazla fotoğraf seçebilirsin. Kapak ve sıralama otomatik yönetilir.
              </AppText>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Daha fazla fotoğraf ekle"
              onPress={() => void pickPhotos()}
              style={({ pressed }) => [
                styles.addTile,
                {
                  width: tileWidth,
                  borderColor: theme.colors.borderStrong,
                  backgroundColor: theme.colors.surfaceMuted,
                  opacity: pressed ? 0.82 : 1,
                },
              ]}
            >
              <Ionicons name="add" size={22} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="textSecondary">
                Ekle
              </AppText>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.hintRow}>
        <Ionicons name="information-circle-outline" size={13} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={styles.flex}>
          Kapak fotoğrafı vitrin kartında gösterilir. Videolar ve kategori sıralaması Otel Yönetimim
          {' › '}Medya ekranından yönetilir.
        </AppText>
      </View>

      <FullScreenGallery
        visible={previewIndex !== null}
        media={photos}
        initialIndex={previewIndex ?? 0}
        onClose={() => setPreviewIndex(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  headIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressWrap: { gap: 5 },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: 8,
    borderRadius: 10,
    flexWrap: 'wrap',
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  tileMedia: { width: '100%', aspectRatio: 4 / 3, position: 'relative', overflow: 'hidden' },
  tileFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  coverText: { fontSize: 9 },
  statusDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4 },
  tileFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  tileAction: { padding: 3, borderRadius: 6 },
  pendingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(7,11,20,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  pendingText: { color: '#FFFFFF', fontSize: 10 },
  emptyTile: {
    width: '100%',
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: 20,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  emptyIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    aspectRatio: 4 / 3,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, paddingTop: 1 },
});
