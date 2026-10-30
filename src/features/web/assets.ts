import type { ImageSourcePropType } from 'react-native';

/**
 * Web pazarlama sayfalarında kullanılan gerçek Trabzon fotoğrafları.
 *
 * Görseller Wikimedia Commons'tan indirilip `scripts/optimize-web-photos.mjs`
 * ile web boyutlarına küçültüldü ve WebP olarak kodlandı. Lisans ve atıf
 * bilgisi `assets/web/credits.json` dosyasında tutulur; CC BY / CC BY-SA
 * görseller için atıf zorunludur.
 *
 * `hero` dosyası `scripts/generate-seo.mjs` tarafından ana sayfanın statik
 * açılış kabuğunda da kullanılır; adı değişirse oradaki arama da güncellenmeli.
 */
export const webPhotos = {
  hero: require('../../../assets/web/hero-trabzon.webp') as ImageSourcePropType,
  boztepe: require('../../../assets/web/city-boztepe.webp') as ImageSourcePropType,
  harbour: require('../../../assets/web/city-harbour.webp') as ImageSourcePropType,
  uzungol: require('../../../assets/web/nature-uzungol.webp') as ImageSourcePropType,
  ayasofya: require('../../../assets/web/heritage-ayasofya.webp') as ImageSourcePropType,
  sera: require('../../../assets/web/nature-sera.webp') as ImageSourcePropType,
  feed1: require('../../../assets/web/feed-1.webp') as ImageSourcePropType,
  feed2: require('../../../assets/web/feed-2.webp') as ImageSourcePropType,
  feed3: require('../../../assets/web/feed-3.webp') as ImageSourcePropType,
  reelSumela: require('../../../assets/web/reel-sumela.webp') as ImageSourcePropType,
  reelUzungol: require('../../../assets/web/reel-uzungol.webp') as ImageSourcePropType,
  market: require('../../../assets/web/card-market.webp') as ImageSourcePropType,
  estate: require('../../../assets/web/card-estate.webp') as ImageSourcePropType,
} as const;
