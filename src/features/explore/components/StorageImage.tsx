import type { ImageContentFit } from 'expo-image';
import type { ImageStyle, StyleProp } from 'react-native';

import { AppImage } from '@/components/ui/AppImage';
import { publicMediaUrl, type MediaBucket } from '@/features/media/media-service';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  path: string | null | undefined;
  bucket: Exclude<MediaBucket, 'message-media'>;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  /** Boş durumda gösterilecek yumuşak renk. */
  fallbackColor?: string;
  /** Liste geri dönüşümünde eski görselin görünmesini engeller (ör. ilan id). */
  recycleKey?: string | null;
};

/**
 * Storage yolunu gerçek public URL'e çevirir. Görsel yoksa sahte bir fotoğraf
 * göstermez; tema yüzeyi üzerinde boş bir yer bırakır.
 */
export function StorageImage({
  path,
  bucket,
  style,
  contentFit = 'cover',
  fallbackColor,
  recycleKey,
}: Props) {
  const { theme } = useTheme();
  const url = publicMediaUrl(bucket, path);
  if (!url) {
    return null;
  }
  return (
    <AppImage
      source={{ uri: url }}
      style={[{ backgroundColor: fallbackColor ?? theme.colors.surfaceMuted }, style]}
      contentFit={contentFit}
      recycleKey={recycleKey ?? path ?? url}
    />
  );
}
