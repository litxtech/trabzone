import type { ImageSourcePropType } from 'react-native';

/**
 * Web pazarlama sayfalarında kullanılan gerçek Trabzon fotoğrafları.
 *
 * Görseller Wikimedia Commons'tan indirilip `scripts/optimize-web-photos.mjs`
 * ile web boyutlarına küçültüldü. Lisans ve atıf bilgisi `assets/web/credits.json`
 * dosyasında tutulur; CC BY / CC BY-SA görseller için atıf zorunludur.
 */
export const webPhotos = {
  hero: require('../../../assets/web/hero-trabzon.jpg') as ImageSourcePropType,
  boztepe: require('../../../assets/web/city-boztepe.jpg') as ImageSourcePropType,
  harbour: require('../../../assets/web/city-harbour.jpg') as ImageSourcePropType,
  uzungol: require('../../../assets/web/nature-uzungol.jpg') as ImageSourcePropType,
  ayasofya: require('../../../assets/web/heritage-ayasofya.jpg') as ImageSourcePropType,
  sera: require('../../../assets/web/nature-sera.jpg') as ImageSourcePropType,
  feed1: require('../../../assets/web/feed-1.jpg') as ImageSourcePropType,
  feed2: require('../../../assets/web/feed-2.jpg') as ImageSourcePropType,
  feed3: require('../../../assets/web/feed-3.jpg') as ImageSourcePropType,
  reelSumela: require('../../../assets/web/reel-sumela.jpg') as ImageSourcePropType,
  reelUzungol: require('../../../assets/web/reel-uzungol.jpg') as ImageSourcePropType,
  market: require('../../../assets/web/card-market.jpg') as ImageSourcePropType,
  estate: require('../../../assets/web/card-estate.jpg') as ImageSourcePropType,
} as const;
