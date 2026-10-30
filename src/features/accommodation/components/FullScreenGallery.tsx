import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { MarketMediaViewer, type MarketMediaViewerItem } from '@/features/marketplace/components/MarketMediaViewer';
import { useTheme } from '@/theme/ThemeProvider';

import { accommodationMediaUrl } from '../services/accommodation-media-service';
import type { MediaCategory, PublicMedia } from '../types';
import { MEDIA_CATEGORY_LABELS } from '../utils/format';
import { Chip } from './AccommodationUI';

type GalleryMedia = Pick<
  PublicMedia,
  'id' | 'kind' | 'category' | 'storage_path' | 'thumbnail_path' | 'caption' | 'sort_order'
>;

/**
 * Tesis galerisi: kategori filtresi, sayaç, tam ekran pinch-zoom ve
 * kapatınca son görüntülenen fotoğraf konumunu koruma.
 */
export function FullScreenGallery({
  visible,
  media,
  initialIndex = 0,
  onClose,
}: {
  visible: boolean;
  media: GalleryMedia[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const [category, setCategory] = useState<MediaCategory | 'all'>('all');
  const [index, setIndex] = useState(initialIndex);

  const categories = useMemo(() => {
    const counts = new Map<MediaCategory, number>();
    for (const item of media) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return Array.from(counts.entries());
  }, [media]);

  const filtered = useMemo(
    () =>
      (category === 'all' ? media : media.filter((item) => item.category === category))
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order),
    [category, media],
  );

  const items: MarketMediaViewerItem[] = useMemo(() => {
    const result: MarketMediaViewerItem[] = [];
    for (const item of filtered) {
      const uri = accommodationMediaUrl(item.storage_path);
      if (!uri) continue;
      result.push({
        id: item.id,
        kind: item.kind,
        uri,
        thumbUri: accommodationMediaUrl(item.thumbnail_path) ?? undefined,
      });
    }
    return result;
  }, [filtered]);

  if (!visible || items.length === 0) {
    return null;
  }

  const active = filtered[Math.min(index, filtered.length - 1)];

  return (
    <MarketMediaViewer
      visible={visible}
      items={items}
      initialIndex={Math.min(index, items.length - 1)}
      onIndexChange={setIndex}
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          {active?.caption ? (
            <AppText variant="caption" style={styles.caption} numberOfLines={2}>
              {active.caption}
            </AppText>
          ) : null}
          <View style={styles.footerRow}>
            <View style={styles.counter}>
              <AppText variant="caption" style={styles.caption}>
                {Math.min(index + 1, items.length)} / {items.length}
              </AppText>
            </View>
            {categories.length > 1 ? (
              <View style={styles.filters}>
                <Chip label="Tümü" active={category === 'all'} onPress={() => { setCategory('all'); setIndex(0); }} />
                {categories.map(([value]) => (
                  <Chip
                    key={value}
                    label={MEDIA_CATEGORY_LABELS[value]}
                    active={category === value}
                    onPress={() => {
                      setCategory(value);
                      setIndex(0);
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
          {category !== 'all' ? (
            <AppText variant="caption" style={[styles.caption, { color: theme.colors.primarySoft }]}>
              {MEDIA_CATEGORY_LABELS[category]} · {filtered.length} medya
            </AppText>
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, gap: 8, backgroundColor: 'rgba(7,11,20,0.58)' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1, justifyContent: 'flex-end' },
  counter: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' },
  caption: { color: '#FFFFFF' },
});
