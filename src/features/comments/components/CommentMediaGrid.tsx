import { Pressable, StyleSheet, View } from 'react-native';

import { AppImage } from '@/components/ui';
import { publicMediaUrl } from '@/features/media/media-service';
import { VideoThumbnail } from '@/features/media/components/VideoThumbnail';
import { useTheme } from '@/theme/ThemeProvider';

import type { CommentMediaItem } from '../types';

function ratioOf(item: CommentMediaItem): number {
  const ratio = (item.width ?? 0) / (item.height ?? 0);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return item.media_type === 'video' ? 16 / 9 : 4 / 3;
  }
  return Math.min(Math.max(ratio, 0.75), 1.7);
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
  if (media.length === 0) {
    return null;
  }

  const single = media.length === 1;
  return (
    <View style={[styles.grid, single ? styles.gridSingle : null]}>
      {media.slice(0, 4).map((item, index) => {
        const uri = publicMediaUrl('posts', item.storage_path);
        const poster = item.thumbnail_path
          ? publicMediaUrl('posts', item.thumbnail_path)
          : null;
        const ratio = ratioOf(item);
        return (
          <View
            key={item.id}
            style={[
              styles.tile,
              single ? { width: 196, maxWidth: '82%', aspectRatio: ratio } : styles.cell,
              { backgroundColor: theme.colors.surfaceMuted },
            ]}
          >
            {item.media_type === 'video' ? (
              <VideoThumbnail
                posterUri={poster}
                durationMs={item.duration_ms}
                style={StyleSheet.absoluteFill}
              />
            ) : uri ? (
              <AppImage
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                recycleKey={item.id}
                contentFit="cover"
              />
            ) : null}

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
  gridSingle: { alignSelf: 'flex-start' },
  tile: { borderRadius: 11, overflow: 'hidden' },
  cell: { width: '48.6%', aspectRatio: 1.15 },
});
