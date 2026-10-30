import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppImage, AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAccommodationMedia,
  useAddMedia,
  useDeleteMedia,
  useReorderMedia,
  useSetMediaCover,
  useUpdateMedia,
} from '../hooks/use-accommodation';
import {
  accommodationMediaUrl,
  deleteAccommodationMedia,
  uploadAccommodationMedia,
} from '../services/accommodation-media-service';
import type { MediaCategory, MediaItem } from '../types';
import { MEDIA_CATEGORY_LABELS } from '../utils/format';
import {
  AccCard,
  Chip,
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  ModalSheet,
} from './AccommodationUI';
import { FullScreenGallery } from './FullScreenGallery';

const CATEGORIES: MediaCategory[] = ['general', 'room', 'restaurant', 'pool', 'lobby', 'view', 'common'];

export function MediaManager({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const media = useAccommodationMedia(propertyId);
  const addMedia = useAddMedia(propertyId);
  const updateMedia = useUpdateMedia();
  const deleteMedia = useDeleteMedia();
  const reorderMedia = useReorderMedia(propertyId);
  const setCover = useSetMediaCover();

  const [filter, setFilter] = useState<MediaCategory | 'all'>('all');
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const [caption, setCaption] = useState('');
  const [editCategory, setEditCategory] = useState<MediaCategory>('general');
  const [deleting, setDeleting] = useState<MediaItem | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const items = media.data?.items ?? [];
  const sorted = useMemo(
    () => items.slice().sort((a, b) => a.sort_order - b.sort_order),
    [items],
  );
  const filtered = useMemo(
    () => (filter === 'all' ? sorted : sorted.filter((item) => item.category === filter)),
    [filter, sorted],
  );
  const columns = width >= 1180 ? 4 : width >= 820 ? 3 : width >= 560 ? 2 : 2;
  const cardWidth = `${100 / columns - 1.5}%` as const;

  const pickAndUpload = async (kind: 'image' | 'video') => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'image' ? ['images'] : ['videos'],
      quality: 0.9,
      allowsMultipleSelection: kind === 'image',
      selectionLimit: kind === 'image' ? 12 : 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    setUploading(true);
    let done = 0;
    let failed = 0;
    try {
      for (const asset of result.assets) {
        setUploadNote(`${done + 1}/${result.assets.length} yükleniyor…`);
        const uploaded = await uploadAccommodationMedia({
          propertyId,
          uri: asset.uri,
          name: asset.fileName ?? `tesis-${Date.now()}.${kind === 'image' ? 'jpg' : 'mp4'}`,
          mime: asset.mimeType ?? (kind === 'image' ? 'image/jpeg' : 'video/mp4'),
          kind,
          size: asset.fileSize ?? null,
        });
        if (!uploaded.ok) {
          failed += 1;
          continue;
        }
        const created = await addMedia.mutateAsync({
          kind,
          storagePath: uploaded.data.path,
          category: 'general',
          cover: kind === 'image' && !sorted.some((item) => item.cover),
          sortOrder: sorted.length + done,
          caption: null,
        });
        if (created) done += 1;
      }
      setUploadNote(failed > 0 ? `${done} medya yüklendi, ${failed} dosya yüklenemedi.` : null);
      void media.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Medya yüklenemedi.');
    } finally {
      setUploading(false);
    }
  };

  const move = async (item: MediaItem, direction: -1 | 1) => {
    const ids = sorted.map((entry) => entry.id);
    const index = ids.indexOf(item.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = ids.slice();
    [next[index], next[target]] = [next[target]!, next[index]!];
    try {
      await reorderMedia.mutateAsync(next);
      void media.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sıralama kaydedilemedi.');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setError(null);
    try {
      const removed = await deleteMedia.mutateAsync(deleting.id);
      setDeleting(null);
      if (removed?.storage_path) {
        await deleteAccommodationMedia(removed.storage_path);
      }
      void media.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Medya silinemedi.');
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Fotoğraf ve medya</AppText>
          <AppText variant="caption" color="textTertiary">
            Kapak fotoğrafı, galeri ve kategori yönetimi
          </AppText>
        </View>
        <View style={styles.actions}>
          <Button
            label="Fotoğraf yükle"
            size="sm"
            fullWidth={false}
            loading={uploading}
            leftIcon={<Ionicons name="images-outline" size={15} color={theme.colors.onPrimary} />}
            onPress={() => void pickAndUpload('image')}
          />
          <Button
            label="Video"
            size="sm"
            fullWidth={false}
            variant="outline"
            leftIcon={<Ionicons name="videocam-outline" size={15} color={theme.colors.text} />}
            onPress={() => void pickAndUpload('video')}
          />
        </View>
      </View>

      {uploadNote ? <InfoBanner text={uploadNote} tone="primary" /> : null}
      {error ? <InlineError message={error} /> : null}

      <View style={styles.filters}>
        <Chip label="Tümü" active={filter === 'all'} onPress={() => setFilter('all')} />
        {CATEGORIES.map((category) => {
          const count = sorted.filter((item) => item.category === category).length;
          if (count === 0) return null;
          return (
            <Chip
              key={category}
              label={`${MEDIA_CATEGORY_LABELS[category]} (${count})`}
              active={filter === category}
              onPress={() => setFilter(category)}
            />
          );
        })}
      </View>

      {media.isLoading ? (
        <LoadingBlock height={220} />
      ) : media.isError ? (
        <InlineError
          message={media.error instanceof Error ? media.error.message : 'Medya listesi yüklenemedi.'}
          onRetry={() => void media.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="images-outline"
          title="Medya yok"
          message="Tesis fotoğraflarını yükleyerek galeriyi oluştur. İlk fotoğraf otomatik kapak olur."
          compact
        />
      ) : (
        <View style={styles.grid}>
          {filtered.map((item) => {
            const url = accommodationMediaUrl(item.storage_path);
            const globalIndex = sorted.findIndex((entry) => entry.id === item.id);
            return (
              <AccCard key={item.id} padding={0} style={{ width: cardWidth, overflow: 'hidden' }}>
                <Pressable
                  accessibilityRole="imagebutton"
                  accessibilityLabel={item.caption ?? 'Medya'}
                  onPress={() => setPreviewIndex(globalIndex)}
                  style={styles.thumb}
                >
                  {url ? (
                    <AppImage
                      source={{ uri: url }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={160}
                    />
                  ) : null}
                  {item.kind === 'video' ? (
                    <View style={styles.videoBadge}>
                      <Ionicons name="play" size={11} color="#fff" />
                      <AppText variant="caption" style={styles.onImage}>Video</AppText>
                    </View>
                  ) : null}
                  {item.cover ? (
                    <View style={[styles.coverBadge, { backgroundColor: theme.colors.primary }]}>
                      <Ionicons name="star" size={10} color={theme.colors.onPrimary} />
                      <AppText variant="caption" style={{ color: theme.colors.onPrimary, fontSize: 9 }}>Kapak</AppText>
                    </View>
                  ) : null}
                </Pressable>
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
                      {MEDIA_CATEGORY_LABELS[item.category]}
                      {item.room_type_name ? ` · ${item.room_type_name}` : ''}
                    </AppText>
                    {item.status !== 'approved' ? (
                      <View style={[styles.statusDot, { backgroundColor: item.status === 'pending' ? theme.colors.warning : theme.colors.danger }]} />
                    ) : null}
                  </View>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {item.caption?.trim() || 'Açıklama yok'}
                  </AppText>
                  <View style={[styles.cardActions, { borderTopColor: theme.colors.divider }]}>
                    <IconAction
                      icon="chevron-up"
                      label="Yukarı taşı"
                      disabled={globalIndex === 0}
                      onPress={() => void move(item, -1)}
                    />
                    <IconAction
                      icon="chevron-down"
                      label="Aşağı taşı"
                      disabled={globalIndex === sorted.length - 1}
                      onPress={() => void move(item, 1)}
                    />
                    {item.kind === 'image' && !item.cover ? (
                      <IconAction
                        icon="star-outline"
                        label="Kapak yap"
                        onPress={async () => {
                          try {
                            await setCover.mutateAsync(item.id);
                            void media.refetch();
                          } catch (cause) {
                            setError(cause instanceof Error ? cause.message : 'Kapak ayarlanamadı.');
                          }
                        }}
                      />
                    ) : null}
                    <IconAction
                      icon="create-outline"
                      label="Düzenle"
                      onPress={() => {
                        setEditing(item);
                        setCaption(item.caption ?? '');
                        setEditCategory(item.category);
                      }}
                    />
                    <IconAction
                      icon="trash-outline"
                      label="Sil"
                      tone={theme.colors.danger}
                      onPress={() => setDeleting(item)}
                    />
                  </View>
                </View>
              </AccCard>
            );
          })}
        </View>
      )}

      {uploading ? (
        <View style={styles.uploadRow}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <AppText variant="caption" color="textSecondary">{uploadNote ?? 'Yükleniyor…'}</AppText>
        </View>
      ) : null}

      <ModalSheet
        visible={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Medyayı düzenle"
        maxWidth={480}
        footer={
          <Button
            label="Kaydet"
            loading={updateMedia.isPending}
            onPress={async () => {
              if (!editing) return;
              try {
                await updateMedia.mutateAsync({
                  mediaId: editing.id,
                  caption: caption.trim() || null,
                  category: editCategory,
                });
                setEditing(null);
                void media.refetch();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Medya güncellenemedi.');
              }
            }}
          />
        }
      >
        <View style={{ gap: 10 }}>
          <TextField label="Açıklama" value={caption} onChangeText={setCaption} placeholder="Örn. Deluxe oda deniz manzarası" />
          <View>
            <AppText variant="caption" color="textSecondary" style={styles.fieldLabel}>Kategori</AppText>
            <View style={styles.filters}>
              {CATEGORIES.map((category) => (
                <Chip
                  key={category}
                  label={MEDIA_CATEGORY_LABELS[category]}
                  active={editCategory === category}
                  onPress={() => setEditCategory(category)}
                />
              ))}
            </View>
          </View>
        </View>
      </ModalSheet>

      <ModalSheet
        visible={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Medyayı sil"
        subtitle="Bu işlem geri alınamaz."
        maxWidth={420}
        footer={
          <View style={styles.modalFooter}>
            <Button label="Vazgeç" variant="ghost" fullWidth={false} onPress={() => setDeleting(null)} />
            <Button label="Sil" variant="danger" fullWidth={false} loading={deleteMedia.isPending} onPress={() => void confirmDelete()} />
          </View>
        }
      >
        <AppText variant="body" color="textSecondary">
          Seçili medya tesis galerisinden kaldırılacak. Bu medya kapak fotoğrafıysa kapak başka bir fotoğrafa taşınmalıdır.
        </AppText>
      </ModalSheet>

      <FullScreenGallery
        visible={previewIndex !== null}
        media={sorted}
        initialIndex={previewIndex ?? 0}
        onClose={() => setPreviewIndex(null)}
      />
    </View>
  );
}

function IconAction({
  icon,
  label,
  onPress,
  disabled,
  tone,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconAction, { opacity: disabled ? 0.28 : pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={icon} size={15} color={tone ?? theme.colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#0B1220' },
  cardBody: { padding: 8, gap: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: 5, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  iconAction: { padding: 5, borderRadius: 7 },
  coverBadge: { position: 'absolute', top: 6, left: 6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  videoBadge: { position: 'absolute', bottom: 6, left: 6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(7,11,20,0.72)' },
  onImage: { color: '#fff', fontSize: 9 },
  uploadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldLabel: { marginBottom: 5 },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
