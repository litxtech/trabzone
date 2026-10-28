import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export type AdminNavItem = {
  key: string;
  label: string;
  href: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  permissions?: string[];
  badge?: 'reports' | 'tickets' | 'approvals' | 'errors' | 'critical';
  description: string;
};

export type AdminNavGroup = {
  key: string;
  label: string;
  items: AdminNavItem[];
};

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    key: 'overview',
    label: 'Genel',
    items: [
      {
        key: 'dashboard',
        label: 'Genel Bakış',
        href: '/admin',
        icon: 'grid-outline',
        permissions: ['report.view'],
        description: 'Canlı kontrol merkezi ve büyüme metrikleri',
      },
      {
        key: 'analytics',
        label: 'Analitik ve Raporlar',
        href: '/admin/analytics',
        icon: 'analytics-outline',
        permissions: ['report.view'],
        description: 'Rapor kataloğu, önizleme ve CSV/Excel dışa aktarma',
      },
    ],
  },
  {
    key: 'community',
    label: 'Topluluk',
    items: [
      {
        key: 'users',
        label: 'Kullanıcı Yönetimi',
        href: '/admin/users',
        icon: 'people-outline',
        permissions: ['user.view'],
        description: 'Hesap durumu, doğrulama ve kullanıcı işlemleri',
      },
      {
        key: 'posts',
        label: 'Sosyal Akış',
        href: '/admin/posts',
        icon: 'newspaper-outline',
        permissions: ['content.view'],
        description: 'Gönderi ve yorum moderasyonu',
      },
      {
        key: 'reels',
        label: 'Reels ve Medya',
        href: '/admin/reels',
        icon: 'videocam-outline',
        permissions: ['content.view'],
        description: 'Video moderasyonu ve işleme durumu',
      },
      {
        key: 'stories',
        label: 'Hikâyeler',
        href: '/admin/stories',
        icon: 'albums-outline',
        permissions: ['content.view'],
        description: 'Aktif hikâyeler ve saklama politikası',
      },
      {
        key: 'messaging',
        label: 'Mesajlaşma Yönetimi',
        href: '/admin/messaging',
        icon: 'chatbubbles-outline',
        permissions: ['messaging.view'],
        description: 'Teslimat sağlığı ve rapor kapsamlı inceleme',
      },
    ],
  },
  {
    key: 'commerce',
    label: 'Ticaret',
    items: [
      {
        key: 'marketplace',
        label: 'Marketplace',
        href: '/admin/marketplace',
        icon: 'storefront-outline',
        permissions: ['market.manage', 'market.orders.view'],
        description: 'İlanlar, kategoriler, siparişler ve uyuşmazlıklar',
      },
      {
        key: 'finance',
        label: 'Gelir ve Finans',
        href: '/admin/finance',
        icon: 'wallet-outline',
        permissions: ['finance.view', 'market.finance.view'],
        description: 'GMV, komisyon, iade ve ödeme işlemleri',
      },
    ],
  },
  {
    key: 'operations',
    label: 'Operasyon',
    items: [
      {
        key: 'ride',
        label: 'Yolculuk Yönetimi',
        href: '/admin/ride',
        icon: 'car-sport-outline',
        permissions: ['ride.view'],
        description: 'İlanlar, rezervasyonlar, doğrulama, güvenlik, finans ve denetim',
      },
      {
        key: 'map',
        label: 'Etkileşim Haritası',
        href: '/admin/map',
        icon: 'map-outline',
        permissions: ['map.view'],
        description: 'Toplulaştırılmış harita metrikleri, gizlilik kuralları ve modül durumu',
      },
      {
        key: 'explore',
        label: 'Harita ve İşletmeler',
        href: '/admin/explore',
        icon: 'map-outline',
        permissions: ['map.view'],
        description: 'İşletme kayıtları, yer önerileri, sahiplenme, medya ve yorum moderasyonu',
      },
      {
        key: 'real-estate',
        label: 'Emlak Yönetimi',
        href: '/admin/real-estate',
        icon: 'home-outline',
        permissions: ['realestate.view'],
        description: 'Emlak ilanları, EİDS doğrulama kuyruğu ve medya moderasyonu',
      },
      {
        key: 'explore-health',
        label: 'Harita Veri Sağlığı',
        href: '/admin/explore-health',
        icon: 'pulse-outline',
        permissions: ['map.view', 'realestate.view'],
        description: 'Veri kalitesi, mükerrer kayıtlar, mekânsal gecikme ve servis durumu',
      },
      {
        key: 'reports',
        label: 'Şikâyet ve Moderasyon',
        href: '/admin/reports',
        icon: 'flag-outline',
        permissions: ['safety.report.view'],
        badge: 'reports',
        description: 'Birleşik şikâyet kuyruğu ve işlem geçmişi',
      },
      {
        key: 'support',
        label: 'Destek Merkezi',
        href: '/admin/support',
        icon: 'headset-outline',
        permissions: ['support.view'],
        badge: 'tickets',
        description: 'Destek talepleri ve SLA takibi',
      },
      {
        key: 'live-support',
        label: 'Canlı Destek',
        href: '/admin/live-support',
        icon: 'chatbubbles-outline',
        permissions: ['support.view'],
        description: 'Gerçek zamanlı sohbet kuyruğu ve temsilci durumu',
      },
      {
        key: 'support-templates',
        label: 'Yanıt Şablonları',
        href: '/admin/support-templates',
        icon: 'chatbox-ellipses-outline',
        permissions: ['support.view'],
        description: 'Hazır yanıt kataloğu ve şablon yönetimi',
      },
      {
        key: 'campaigns',
        label: 'Bildirim Merkezi',
        href: '/admin/campaigns',
        icon: 'notifications-outline',
        permissions: ['notify.view'],
        description: 'Hedef kitleli bildirim kampanyaları',
      },
      {
        key: 'cms',
        label: 'İçerik Yönetimi',
        href: '/admin/content',
        icon: 'document-text-outline',
        permissions: ['cms.view'],
        description: 'Sayfalar, sürüm geçmişi ve duyurular',
      },
    ],
  },
  {
    key: 'web-compliance',
    label: 'Web ve Uyum',
    items: [
      {
        key: 'website',
        label: 'Web Sitesi Yönetimi',
        href: '/admin/website',
        icon: 'globe-outline',
        permissions: ['website.manage', 'cms.manage'],
        description: 'Hero, menü, bölümler, mağaza bağlantıları ve site ayarları',
      },
      {
        key: 'legal',
        label: 'Hukuk ve Politikalar',
        href: '/admin/legal',
        icon: 'documents-outline',
        permissions: ['safety.policy.manage'],
        description: 'Sürümlü politikalar, taslak, önizleme, yayın ve arşiv',
      },
      {
        key: 'data-requests',
        label: 'Veri Talepleri',
        href: '/admin/data-requests',
        icon: 'mail-unread-outline',
        permissions: ['privacy.request.manage'],
        description: 'KVKK başvuruları, SLA takibi ve yanıtlar',
      },
      {
        key: 'deletion-requests',
        label: 'Hesap Silme Talepleri',
        href: '/admin/deletion-requests',
        icon: 'trash-outline',
        permissions: ['privacy.request.manage'],
        description: 'Giriş yapamayan kullanıcıların silme talepleri',
      },
      {
        key: 'contact-admin',
        label: 'İletişim Kanalları',
        href: '/admin/contact',
        icon: 'at-outline',
        permissions: ['website.manage'],
        description: 'E-posta adresleri, form mesajları ve gönderim günlükleri',
      },
    ],
  },
  {
    key: 'system',
    label: 'Sistem',
    items: [
      {
        key: 'settings',
        label: 'Uygulama Ayarları',
        href: '/admin/settings',
        icon: 'options-outline',
        permissions: ['settings.view'],
        description: 'Merkezi uygulama konfigürasyonu',
      },
      {
        key: 'features',
        label: 'Özellik Kontrolü',
        href: '/admin/features',
        icon: 'toggle-outline',
        permissions: ['feature.view'],
        badge: 'approvals',
        description: 'Feature flag ve ikinci yönetici onayı',
      },
      {
        key: 'security',
        label: 'Güvenlik Merkezi',
        href: '/admin/security',
        icon: 'shield-checkmark-outline',
        permissions: ['security.view'],
        description: 'Oturumlar, MFA ve kötüye kullanım sinyalleri',
      },
      {
        key: 'child-safety',
        label: 'Çocuk Güvenliği',
        href: '/admin/child-safety',
        icon: 'shield-half-outline',
        permissions: ['safety.child.view'],
        badge: 'critical',
        description: 'Kritik çocuk güvenliği kuyruğu',
      },
      {
        key: 'age',
        label: 'Yaş ve Veli Onayı',
        href: '/admin/age',
        icon: 'people-circle-outline',
        permissions: ['safety.age.view'],
        description: 'Yaş doğrulama ve veli onayları',
      },
      {
        key: 'roles',
        label: 'Yönetici ve Yetkiler',
        href: '/admin/roles',
        icon: 'key-outline',
        permissions: ['admin.manage'],
        description: 'Roller, granüler izinler ve personel',
      },
      {
        key: 'system-health',
        label: 'Sistem ve Entegrasyonlar',
        href: '/admin/system',
        icon: 'pulse-outline',
        permissions: ['system.view'],
        badge: 'errors',
        description: 'Veritabanı, storage, hata ve entegrasyon durumu',
      },
      {
        key: 'audit',
        label: 'İşlem Geçmişi',
        href: '/admin/audit',
        icon: 'receipt-outline',
        permissions: ['audit.view'],
        description: 'Değiştirilemez denetim kayıtları',
      },
    ],
  },
];

export function canSee(
  item: { permissions?: string[] },
  permissions: readonly string[] | undefined,
): boolean {
  if (!item.permissions || item.permissions.length === 0) {
    return true;
  }
  if (!permissions || permissions.length === 0) {
    return false;
  }
  return item.permissions.some((permission) => permissions.includes(permission));
}

export function findNavItem(pathname: string): AdminNavItem | null {
  const flat = ADMIN_NAV.flatMap((group) => group.items);
  const exact = flat.find((item) => item.href === pathname);
  if (exact) {
    return exact;
  }
  return (
    flat
      .filter((item) => item.href !== '/admin' && pathname.startsWith(`${item.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}
