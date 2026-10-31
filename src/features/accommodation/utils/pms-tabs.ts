import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export type PmsTabKey =
  | 'genel-bakis'
  | 'rezervasyonlar'
  | 'oda-takvimi'
  | 'rezervasyon-takvimi'
  | 'fiyat-musaitlik'
  | 'odalar'
  | 'fiyat-planlari'
  | 'kampanyalar'
  | 'misafirler'
  | 'on-buro'
  | 'giris-cikis'
  | 'kat-hizmetleri'
  | 'kasa'
  | 'gelir-gider'
  | 'finans-komisyon'
  | 'belgeler'
  | 'raporlar'
  | 'mesajlar'
  | 'sikayetler'
  | 'yorumlar'
  | 'medya'
  | 'tesis-bilgileri'
  | 'personel'
  | 'bildirimler'
  | 'web-takip'
  | 'ayarlar';

export type PmsTab = {
  key: PmsTabKey;
  label: string;
  short: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  group: string;
  description: string;
};

export const PMS_TABS: PmsTab[] = [
  { key: 'genel-bakis', label: 'Genel Bakış', short: 'Genel', icon: 'speedometer-outline', group: 'Operasyon', description: 'Günlük gelir ve doluluk özeti' },
  { key: 'rezervasyonlar', label: 'Rezervasyonlar', short: 'Rezervasyon', icon: 'calendar-outline', group: 'Operasyon', description: 'Tüm rezervasyon kayıtları' },
  { key: 'oda-takvimi', label: 'Oda Takvimi', short: 'Takvim', icon: 'grid-outline', group: 'Operasyon', description: 'Fiyat, müsaitlik ve rezervasyon ızgarası' },
  { key: 'rezervasyon-takvimi', label: 'Rezervasyon Takvimi', short: 'Rez. Takvim', icon: 'albums-outline', group: 'Operasyon', description: 'Geniş rezervasyon görünümü' },
  { key: 'fiyat-musaitlik', label: 'Fiyat ve Müsaitlik Takvimi', short: 'Fiyat', icon: 'pricetags-outline', group: 'Operasyon', description: 'Günlük fiyat ve stok yönetimi' },
  { key: 'on-buro', label: 'Ön Büro', short: 'Ön Büro', icon: 'desktop-outline', group: 'Operasyon', description: 'Giriş, çıkış ve oda durumu' },
  { key: 'giris-cikis', label: 'Giriş / Çıkış İşlemleri', short: 'Giriş/Çıkış', icon: 'swap-horizontal-outline', group: 'Operasyon', description: 'Hızlı check-in ve check-out' },
  { key: 'kat-hizmetleri', label: 'Kat Hizmetleri', short: 'Kat Hiz.', icon: 'sparkles-outline', group: 'Operasyon', description: 'Temizlik ve bakım görevleri' },

  { key: 'odalar', label: 'Odalar', short: 'Odalar', icon: 'bed-outline', group: 'Envanter', description: 'Oda tipleri ve fiziksel odalar' },
  { key: 'fiyat-planlari', label: 'Fiyat Planları', short: 'Planlar', icon: 'options-outline', group: 'Envanter', description: 'Rezervasyon modu ve koşullar' },
  { key: 'kampanyalar', label: 'İndirim Kampanyaları', short: 'Kampanya', icon: 'megaphone-outline', group: 'Envanter', description: 'Kampanya ve indirim merkezi' },
  { key: 'medya', label: 'Fotoğraf ve Medya', short: 'Medya', icon: 'images-outline', group: 'Envanter', description: 'Galeri, kapak ve video' },

  { key: 'misafirler', label: 'Misafirler', short: 'Misafir', icon: 'people-outline', group: 'Misafir', description: 'Misafir kayıtları ve geçmişi' },
  { key: 'mesajlar', label: 'Mesajlar', short: 'Mesaj', icon: 'chatbubbles-outline', group: 'Misafir', description: 'Misafir görüşmeleri' },
  { key: 'sikayetler', label: 'Şikayet ve Destek', short: 'Şikayet', icon: 'shield-checkmark-outline', group: 'Misafir', description: 'Talepler, SLA takibi ve çözüm kayıtları' },
  { key: 'yorumlar', label: 'Yorum ve Değerlendirmeler', short: 'Yorum', icon: 'star-outline', group: 'Misafir', description: 'Puanlar ve otel yanıtları' },
  { key: 'bildirimler', label: 'Bildirimler', short: 'Bildirim', icon: 'notifications-outline', group: 'Misafir', description: 'Tesis hareketleri ve tercihler' },

  { key: 'kasa', label: 'Kasa', short: 'Kasa', icon: 'wallet-outline', group: 'Finans', description: 'Nakit, POS ve banka hesapları' },
  { key: 'gelir-gider', label: 'Gelir ve Giderler', short: 'Gelir/Gider', icon: 'trending-up-outline', group: 'Finans', description: 'Aylık gelir, tahsilat ve gider' },
  { key: 'finans-komisyon', label: 'Finans ve Komisyon', short: 'Komisyon', icon: 'calculator-outline', group: 'Finans', description: '%10 Trabzone komisyon mutabakatı' },
  { key: 'belgeler', label: 'Fatura ve Belgeler', short: 'Belgeler', icon: 'document-text-outline', group: 'Finans', description: 'Fatura, fiş, makbuz ve ekstre' },
  { key: 'raporlar', label: 'PDF / Excel Raporları', short: 'Rapor', icon: 'download-outline', group: 'Finans', description: 'Tarih aralığı raporları' },

  { key: 'tesis-bilgileri', label: 'Tesis Bilgileri', short: 'Tesis', icon: 'business-outline', group: 'Yönetim', description: 'Konum, iletişim ve belgeler' },
  { key: 'personel', label: 'Personel ve Yetkiler', short: 'Personel', icon: 'shield-outline', group: 'Yönetim', description: 'Roller ve erişim yetkileri' },
  { key: 'web-takip', label: 'Web’den Takip Et', short: 'Web', icon: 'globe-outline', group: 'Yönetim', description: 'Tesis sayfası ve dönüşüm' },
  { key: 'ayarlar', label: 'Otel Ayarları', short: 'Ayarlar', icon: 'settings-outline', group: 'Yönetim', description: 'Rezervasyon ve bildirim ayarları' },
];

export const PMS_GROUPS = ['Operasyon', 'Envanter', 'Misafir', 'Finans', 'Yönetim'] as const;

export function isPmsTabKey(value: string | undefined): value is PmsTabKey {
  return Boolean(value && PMS_TABS.some((tab) => tab.key === value));
}

export function pmsTab(key: PmsTabKey): PmsTab {
  return PMS_TABS.find((tab) => tab.key === key) ?? PMS_TABS[0]!;
}
