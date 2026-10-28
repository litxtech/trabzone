/**
 * Herkese açık hukuki sayfaların tek kaynağı. Yeni bir politika türü
 * eklendiğinde yalnızca bu liste ve ilgili route dosyası güncellenir.
 * Metinlerin kendisi veritabanında sürümlenir; burada yalnızca yönlendirme
 * bilgisi ve görsel başlık tutulur.
 */
export type LegalCatalogItem = {
  slug: string;
  path: string;
  title: string;
  shortTitle: string;
  description: string;
  category: 'Sözleşmeler' | 'Veri ve Gizlilik' | 'Güvenlik' | 'Platform Kuralları';
};

export const PUBLIC_LEGAL_PAGES: LegalCatalogItem[] = [
  {
    slug: 'terms',
    path: '/terms',
    title: 'Kullanım Koşulları',
    shortTitle: 'Kullanım Koşulları',
    description:
      'Trabzone platformunun kullanım şartları, kullanıcı yükümlülükleri ve hizmet kapsamı.',
    category: 'Sözleşmeler',
  },
  {
    slug: 'privacy',
    path: '/privacy',
    title: 'Gizlilik Politikası',
    shortTitle: 'Gizlilik',
    description: 'Hangi verileri topladığımız, nasıl kullandığımız ve haklarınızı açıklar.',
    category: 'Veri ve Gizlilik',
  },
  {
    slug: 'kvkk',
    path: '/kvkk',
    title: 'KVKK Aydınlatma Metni',
    shortTitle: 'KVKK',
    description: '6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında aydınlatma metni.',
    category: 'Veri ve Gizlilik',
  },
  {
    slug: 'data-protection',
    path: '/data-protection',
    title: 'Veri Koruma Politikası',
    shortTitle: 'Veri Koruma',
    description: 'Teknik ve idari veri güvenliği tedbirleri, saklama ve imha yaklaşımımız.',
    category: 'Veri ve Gizlilik',
  },
  {
    slug: 'cookies',
    path: '/cookies',
    title: 'Çerez Politikası',
    shortTitle: 'Çerezler',
    description: 'Web sitesinde kullanılan çerez türleri, amaçları ve tercih yönetimi.',
    category: 'Veri ve Gizlilik',
  },
  {
    slug: 'child-safety',
    path: '/child-safety',
    title: 'Çocuk Koruma ve Güvenliği Politikası',
    shortTitle: 'Çocuk Güvenliği',
    description: 'Çocuk istismarına sıfır tolerans yaklaşımımız ve bildirim süreçlerimiz.',
    category: 'Güvenlik',
  },
  {
    slug: 'community-guidelines',
    path: '/community-guidelines',
    title: 'Topluluk Kuralları',
    shortTitle: 'Topluluk Kuralları',
    description: 'Trabzone topluluğunda beklenen davranışlar ve moderasyon yaklaşımı.',
    category: 'Platform Kuralları',
  },
  {
    slug: 'account-deletion',
    path: '/delete-account',
    title: 'Hesap ve Veri Silme Politikası',
    shortTitle: 'Hesap Silme',
    description: 'Hesap silme süreci, silinen veriler ve yasal olarak saklanan kayıtlar.',
    category: 'Platform Kuralları',
  },
  {
    slug: 'marketplace-rules',
    path: '/policy/marketplace-rules',
    title: 'Marketplace Kuralları',
    shortTitle: 'Marketplace',
    description: 'İlan verme, satıcı ve alıcı yükümlülükleri ile yasaklı ürünler.',
    category: 'Platform Kuralları',
  },
  {
    slug: 'real-estate-rules',
    path: '/policy/real-estate-rules',
    title: 'Emlak İlan Kuralları',
    shortTitle: 'Emlak',
    description: 'Emlak ilanlarında yetki, doğrulama ve ilan sorumlulukları.',
    category: 'Platform Kuralları',
  },
  {
    slug: 'vehicle-rules',
    path: '/policy/vehicle-rules',
    title: 'Araç İlan Kuralları',
    shortTitle: 'Araçlar',
    description: 'Araç ilanlarında doğru bilgi, belge ve güvenlik kuralları.',
    category: 'Platform Kuralları',
  },
];

export function findPublicLegalPage(slug: string | undefined) {
  return PUBLIC_LEGAL_PAGES.find((item) => item.slug === slug) ?? null;
}

