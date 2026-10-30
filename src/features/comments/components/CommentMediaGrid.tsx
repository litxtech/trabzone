import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppImage } from '@/components/ui';
import { publicMediaUrl } from '@/features/media/media-service';
import { VideoThumbnail } from '@/features/media/components/VideoThumbnail';
import { useTheme } from '@/theme/ThemeProvider';

import type { CommentMediaItem } from '../types';

/** Tek eklenti için en büyük kenar (px). */
const SINGLE_MAX_SIDE = 220;
/** Tek eklentinin küçülebileceği en küçük genişlik; aşırı ince/uzun görseller kırpılmasın. */
const SINGLE_MIN_SIDE = 96;
/** Çoklu eklentilerde her hücrenin sabit yüksekliği. */
const CELL_HEIGHT = 118;

/**
 * Eklentinin gerçek ölçülerinden sabit bir kutu üretir.
 *
 * Önceden kutu boyutu `aspectRatio` + `maxWidth: '82%'` ile hesaplanıyordu.
 * Yüzde tabanlı `maxWidth`, genişliği yine kutunun kendisinden gelen bir
 * ebeveyne göre çözüldüğü için döngüseldi: web'de kutu 196 yerine 161 px
 * çıkıyor, Yoga (iOS/Android) tarafında ise genişlik 0'a düşüp yükseklik de
 * 0 oluyordu. Böylece yorumdaki fotoğraf/video hiç görünmüyordu. Artık hem
 * genişlik hem yükseklik doğrudan veriliyor; yüzde veya `aspectRatio`
 * çözümlemesine bağlı kalmıyoruz.
 */
function boxOf(item: CommentMediaItem): { width: number; height: number } {
  const raw = (item.width ?? 0) / (item.height ?? 0);
  const ratio =
    Number.isFinite(raw) && raw > 0
      ? Math.min(Math.max(raw, 0.62), 1.75)
      : item.media_type === 'video'
        ? 16 / 9
        : 4 / 3;

  let width = SINGLE_MAX_SIDE;
  let height = Math.round(width / ratio);

  if (height > SINGLE_MAX_SIDE) {
    height = SINGLE_MAX_SIDE;
    width = Math.round(height * ratio);
  }
  if (width < SINGLE_MIN_SIDE) {
    width = SINGLE_MIN_SIDE;
    height = Math.round(width / ratio);
  }

  return { width, height };
}

/**
 * Yorum eklentileri. Video ağır bir oynatıcı olarak gömülmez; kapak + süre
 * rozeti gösterilir, dokununca tam ekran görüntüleyici açılır.
 */
export function CommentMediaGrid({
  media,
  onOpen,
}: {
  media: CommentMediaItem[];
  onOpen: (media: CommentMediaItem[], index: number) => void;
}) {
  const { theme } = useTheme();
  const [broken, setBroken] = useState<Record<string, true>>({});

  if (media.length === 0) {
    return null;
  }

  const single = media.length === 1;

  return (
    <View style={styles.grid}>
      {media.slice(0, 4).map((item, index) => {
        const uri = publicMediaUrl('posts', item.storage_path);
        const poster = item.thumbnail_path ? publicMediaUrl('posts', item.thumbnail_path) : null;
        const isBroken = Boolean(broken[item.id]);
        return (
          <View
            key={item.id}
            style={[
              styles.tile,
              single ? boxOf(item) : styles.cell,
              { backgroundColor: theme.colors.surfaceMuted },
            ]}
          >
            {item.media_type === 'video' ? (
              <VideoThumbnail
                posterUri={poster}
                durationMs={item.duration_ms}
                style={StyleSheet.absoluteFill}
              />
            ) : uri && !isBroken ? (
              <AppImage
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                recycleKey={item.id}
                contentFit="cover"
                onError={() => setBroken((current) => ({ ...current, [item.id]: true }))}
              />
            ) : (
              <View style={styles.fallback}>
                <Ionicons
                  name="image-outline"
                  size={single ? 26 : 20}
                  color={theme.colors.textTertiary}
                />
              </View>
            )}

            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel={
                item.media_type === 'video' ? 'Yorum videosunu aç' : 'Yorum fotoğrafını aç'
              }
              onPress={() => onOpen(media, index)}
              style={StyleSheet.absoluteFill}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  tile: { borderRadius: 11, overflow: 'hidden' },
  cell: { width: '48.6%', height: CELL_HEIGHT },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
