import { Image, type ImageProps } from 'expo-image';

import { perf } from '@/perf';

export type AppImageProps = ImageProps & {
  /**
   * Liste hücresi geri dönüştürüldüğünde eski görselin bir an görünmesini
   * engeller. FlashList/FlatList içindeki görsellerde kaydın kimliğini verin.
   */
  recycleKey?: string | null;
};

/**
 * Uygulamadaki tüm medya görselleri için tek giriş noktası.
 *
 * - `memory-disk`: aynı görsel ikinci kez indirilmez, ekran anında boyanır.
 * - `skipOnCacheHit: 'all'`: cache'teki görsel cross-fade beklemeden çizilir;
 *   Android'de hızlı kaydırırken kare atlamasını azaltır.
 * - `recyclingKey`: sanallaştırılmış listelerde görsel geri dönüşümü güvenli olur.
 */
export function AppImage({
  recycleKey,
  cachePolicy = 'memory-disk',
  contentFit = 'cover',
  transition = perf.imageTransition,
  ...rest
}: AppImageProps) {
  return (
    <Image
      {...rest}
      cachePolicy={cachePolicy}
      contentFit={contentFit}
      transition={transition}
      recyclingKey={recycleKey ?? rest.recyclingKey}
    />
  );
}
