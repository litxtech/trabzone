import { useMemo } from 'react';

import { MarketMediaViewer } from '@/features/marketplace/components/MarketMediaViewer';

export type ViewerMedia = {
  id: string;
  uri: string;
  media_type: 'image' | 'video';
  /** Opsiyonel: vurgulanmış görselde oran korumak / önizleme için. */
  thumbnailUri?: string | null;
  width?: number | null;
  height?: number | null;
};

type MediaViewerProps = {
  visible: boolean;
  media: ViewerMedia[];
  startIndex?: number;
  onClose: () => void;
};

/**
 * Trabzone ortak tam ekran medya görüntüleyici.
 *
 * Marketplace için geliştirilen premium görüntüleyici (pinch zoom, çift dokunuş,
 * pan, yatay geçiş, video kontrolleri) tek kaynak olarak kullanılır. Feed,
 * profil, Reels, yorumlar, mesajlar ve ilanlar aynı bileşeni paylaşır.
 */
export function MediaViewer({ visible, media, startIndex = 0, onClose }: MediaViewerProps) {
  const items = useMemo(
    () =>
      media.map((item) => ({
        id: item.id,
        kind: item.media_type,
        uri: item.uri,
        thumbUri: item.thumbnailUri ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
      })),
    [media],
  );

  if (!items[startIndex]) {
    return null;
  }

  return (
    <MarketMediaViewer
      visible={visible}
      items={items}
      initialIndex={startIndex}
      onClose={onClose}
    />
  );
}
