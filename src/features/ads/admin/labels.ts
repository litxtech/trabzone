import type { AdDestinationType, AdPlatform } from '../types';
import type { AdCampaignStatus, AdFormat } from './types';

type Tone = 'neutral' | 'warning' | 'success' | 'danger' | 'accent' | 'primary';

export const CAMPAIGN_STATUS: Record<AdCampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Taslak', tone: 'neutral' },
  pending_review: { label: 'İnceleme bekliyor', tone: 'warning' },
  scheduled: { label: 'Planlandı', tone: 'accent' },
  active: { label: 'Aktif', tone: 'success' },
  paused: { label: 'Duraklatıldı', tone: 'warning' },
  expired: { label: 'Süresi doldu', tone: 'neutral' },
  rejected: { label: 'Reddedildi', tone: 'danger' },
  archived: { label: 'Arşivlendi', tone: 'neutral' },
};

export const CAMPAIGN_TYPES: { value: string; label: string }[] = [
  { value: 'business_promo', label: 'İşletme tanıtımı' },
  { value: 'listing_promo', label: 'İlan öne çıkarma' },
  { value: 'event', label: 'Etkinlik' },
  { value: 'real_estate', label: 'Emlak' },
  { value: 'vehicle', label: 'Vasıta' },
  { value: 'job', label: 'İş ilanı' },
  { value: 'service', label: 'Hizmet' },
  { value: 'brand', label: 'Marka' },
  { value: 'public_service', label: 'Kamu spotu' },
  { value: 'other', label: 'Diğer' },
];

export const POLICY_CATEGORIES: { value: string; label: string }[] = [
  { value: 'general', label: 'Genel' },
  { value: 'food', label: 'Yeme-içme' },
  { value: 'tourism', label: 'Turizm' },
  { value: 'retail', label: 'Perakende' },
  { value: 'real_estate', label: 'Emlak' },
  { value: 'automotive', label: 'Otomotiv' },
  { value: 'education', label: 'Eğitim' },
  { value: 'health_service', label: 'Sağlık hizmeti (ek inceleme)' },
  { value: 'finance', label: 'Finans (ek inceleme)' },
  { value: 'events', label: 'Etkinlik' },
  { value: 'public_service', label: 'Kamu hizmeti' },
  { value: 'technology', label: 'Teknoloji' },
  { value: 'jobs', label: 'İstihdam' },
  { value: 'services', label: 'Hizmetler' },
];

/** Reklam kabul politikasında yasaklı kategoriler (sunucu da reddeder). */
export const PROHIBITED_CATEGORIES = [
  'Kumar ve bahis',
  'Yasa dışı ürün ve hizmetler',
  'Yanıltıcı sağlık iddiaları',
  'Dolandırıcılık ve sahte kampanyalar',
  'Yetişkin içerik',
  'Silah',
  'Tütün, alkol ve uyuşturucu',
];

export const DESTINATION_TYPES: {
  value: AdDestinationType;
  label: string;
  description: string;
  needs: 'none' | 'target' | 'url' | 'phone' | 'location' | 'category';
}[] = [
  {
    value: 'detail_page',
    label: 'Reklam detay sayfası',
    description: 'Kullanıcı banner’a dokununca kendi reklam sayfan açılır.',
    needs: 'none',
  },
  {
    value: 'external_url',
    label: 'Web sitesi',
    description: 'Kendi sitene veya kampanya sayfana yönlendirir.',
    needs: 'url',
  },
  {
    value: 'phone',
    label: 'Telefon araması',
    description: 'Kullanıcı tek dokunuşla işletmeyi arar.',
    needs: 'phone',
  },
  {
    value: 'map_location',
    label: 'Harita konumu',
    description: 'Şehir ve ilçe seçerek işletme konumunu göster.',
    needs: 'location',
  },
  {
    value: 'business',
    label: 'İşletme profili',
    description: 'Trabzone’daki yayınlanmış işletme profiline gider.',
    needs: 'target',
  },
  {
    value: 'market_listing',
    label: 'Marketplace ilanı',
    description: 'Yayındaki marketplace ilanına gider.',
    needs: 'target',
  },
  {
    value: 'real_estate',
    label: 'Emlak ilanı',
    description: 'Yayındaki emlak ilanına gider.',
    needs: 'target',
  },
  {
    value: 'vehicle',
    label: 'Vasıta ilanı',
    description: 'Yayındaki vasıta ilanına gider.',
    needs: 'target',
  },
  {
    value: 'job',
    label: 'İş ilanı',
    description: 'Yayındaki iş ilanına gider.',
    needs: 'target',
  },
  {
    value: 'ride',
    label: 'Yolculuk ilanı',
    description: 'Yayındaki yolculuk ilanına gider.',
    needs: 'target',
  },
  {
    value: 'post',
    label: 'Herkese açık gönderi',
    description: 'Seçilen gönderiye gider.',
    needs: 'target',
  },
  {
    value: 'category',
    label: 'Kategori sayfası',
    description: 'Seçilen kategori listesine gider.',
    needs: 'category',
  },
];

/** Sihirbaz adımları — form dört anlaşılır aşamaya bölünür. */
export const AD_STEPS: { key: string; title: string; description: string; icon: string }[] = [
  {
    key: 'basics',
    title: 'Ne reklamı?',
    description: 'Reklamveren, kampanya adı ve türü.',
    icon: 'megaphone-outline',
  },
  {
    key: 'targeting',
    title: 'Kime, nerede?',
    description: 'Şehir, ilçe, yerleşim ve tarih.',
    icon: 'location-outline',
  },
  {
    key: 'creative',
    title: 'Görsel ve metin',
    description: 'Banner metni, görseli ve butonu.',
    icon: 'image-outline',
  },
  {
    key: 'publish',
    title: 'Yönlendirme ve yayın',
    description: 'Tıklanınca ne olacak, bütçe ve kontrol.',
    icon: 'rocket-outline',
  },
];

/** Tek dokunuşla doldurulan hazır reklam şablonları. */
export const AD_TEMPLATES: {
  key: string;
  label: string;
  icon: string;
  campaignType: string;
  policyCategory: string;
  title: string;
  description: string;
  ctaLabel: string;
}[] = [
  {
    key: 'discount',
    label: 'İndirim kampanyası',
    icon: 'pricetag-outline',
    campaignType: 'business_promo',
    policyCategory: 'retail',
    title: 'Bu hafta indirim var',
    description: 'Seçili ürünlerde fırsatı kaçırma. Detaylar reklam sayfasında.',
    ctaLabel: 'Fırsatı gör',
  },
  {
    key: 'new_product',
    label: 'Yeni ürün',
    icon: 'sparkles-outline',
    campaignType: 'business_promo',
    policyCategory: 'general',
    title: 'Yeni ürün raflarda',
    description: 'Yeni gelen ürünleri ilk sen keşfet.',
    ctaLabel: 'İncele',
  },
  {
    key: 'opening',
    label: 'Açılış / etkinlik',
    icon: 'calendar-outline',
    campaignType: 'event',
    policyCategory: 'events',
    title: 'Açılışa davetlisin',
    description: 'Tarih ve konum bilgisi reklam sayfasında.',
    ctaLabel: 'Detayları gör',
  },
  {
    key: 'service',
    label: 'Hizmet tanıtımı',
    icon: 'construct-outline',
    campaignType: 'service',
    policyCategory: 'services',
    title: 'Güvenilir yerel hizmet',
    description: 'İhtiyacın olduğunda yanındayız. Hemen bilgi al.',
    ctaLabel: 'Bilgi al',
  },
  {
    key: 'listing',
    label: 'İlan öne çıkar',
    icon: 'layers-outline',
    campaignType: 'listing_promo',
    policyCategory: 'general',
    title: 'İlanına daha çok göz',
    description: 'İlanını öne çıkar, arayanlara daha hızlı ulaş.',
    ctaLabel: 'İlanı gör',
  },
];

export const PLATFORMS: { value: AdPlatform; label: string }[] = [
  { value: 'ios', label: 'iOS' },
  { value: 'android', label: 'Android' },
  { value: 'web', label: 'Web' },
];

export const FORMAT_LABELS: Record<AdFormat, string> = {
  glass_banner: 'Glass Banner',
  reel_fullscreen: 'Tam ekran Reels',
  native_card: 'Yerel kart',
};

export const PLACEMENT_GROUPS: Record<string, string> = {
  social: 'Sosyal akış',
  news: 'Haberler',
  marketplace: 'Marketplace',
  discover: 'Keşfet ve yolculuk',
  other: 'Gelecek akışlar',
};

export function formatCount(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString('tr-TR');
}

export function formatMoneyCents(value: number | null | undefined): string {
  return `${(Number(value ?? 0) / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ₺`;
}

export function formatDateShort(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** `YYYY-MM-DD HH:MM` (yerel) metnini ISO'ya çevirir. */
export function parseLocalDateTime(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, y, mo, d, h = '00', mi = '00'] = match;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toLocalDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
