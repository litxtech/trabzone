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

export const DESTINATION_TYPES: { value: AdDestinationType; label: string; needs: 'none' | 'target' | 'url' | 'phone' | 'location' | 'category' }[] = [
  { value: 'detail_page', label: 'Reklam detay sayfası', needs: 'none' },
  { value: 'business', label: 'İşletme profili', needs: 'target' },
  { value: 'market_listing', label: 'Marketplace ilanı', needs: 'target' },
  { value: 'real_estate', label: 'Emlak ilanı', needs: 'target' },
  { value: 'vehicle', label: 'Vasıta ilanı', needs: 'target' },
  { value: 'job', label: 'İş ilanı', needs: 'target' },
  { value: 'ride', label: 'Yolculuk ilanı', needs: 'target' },
  { value: 'post', label: 'Herkese açık gönderi', needs: 'target' },
  { value: 'category', label: 'Kategori sayfası', needs: 'category' },
  { value: 'external_url', label: 'Harici web sitesi', needs: 'url' },
  { value: 'phone', label: 'Telefon araması', needs: 'phone' },
  { value: 'map_location', label: 'Harita konumu', needs: 'location' },
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
