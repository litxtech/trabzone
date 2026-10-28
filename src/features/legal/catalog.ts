/**
 * Herkese açık hukuki sayfaların yerleşik kataloğu. Metinlerin kendisi
 * veritabanında sürümlenir; burada yalnızca yönlendirme bilgisi ve görsel
 * başlık tutulur.
 *
 * Yönetim panelinden eklenen yeni belgeler bu listede yer almaz; bunlar
 * `buildLegalDirectory()` ile veritabanı kataloğundan (`legal_documents`)
 * eklenir ve `/policy/<slug>` adresinde yayınlanır.
 */
export type LegalCategory =
  | 'Sözleşmeler'
  | 'Veri ve Gizlilik'
  | 'Güvenlik'
  | 'Platform Kuralları'
  | 'Diğer Belgeler';

export type LegalCatalogItem = {
  slug: string;
  path: string;
  title: string;
  shortTitle: string;
  description: string;
  category: LegalCategory;
};

/** Bölümlerin ekrandaki sırası. Yeni bölüm eklenirse yalnızca burada tanımlanır. */
export const LEGAL_CATEGORY_ORDER: LegalCategory[] = [
  'Sözleşmeler',
  'Veri ve Gizlilik',
  'Güvenlik',
  'Platform Kuralları',
  'Diğer Belgeler',
];

const CATEGORY_BY_DOC_TYPE: Record<string, LegalCategory> = {
  contract: 'Sözleşmeler',
  disclosure: 'Veri ve Gizlilik',
  notice: 'Veri ve Gizlilik',
  rules: 'Platform Kuralları',
  policy: 'Diğer Belgeler',
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

/** Bilinen sayfalar kendi adresini, yeni belgeler `/policy/<slug>` yolunu kullanır. */
export function legalPath(slug: string) {
  return findPublicLegalPage(slug)?.path ?? `/policy/${slug}`;
}

function displayTitle(title: string, slug: string) {
  const cleaned = title
    .replace(/^trabzone\s+/i, '')
    .replace(/\s+·\s+Trabzone$/i, '')
    .trim();
  return cleaned.length > 0 ? cleaned : slug;
}

/**
 * Yerleşik katalog + veritabanındaki yayınlanmış belgeler.
 * Yönetim panelinden eklenen/yeniden adlandırılan belgeler site menüsünde
 * sayfa yenilenmeden görünür.
 */
export function buildLegalDirectory(
  documents?: { slug: string; title: string; summary: string | null; doc_type: string }[] | null,
): LegalCatalogItem[] {
  const published = new Map((documents ?? []).map((doc) => [doc.slug, doc]));

  // Veritabanı kataloğu başarıyla geldiyse yerleşik liste de ona göre
  // süzülür: yayından kaldırılan belge menüden anında kalkar.
  // Sorgu henüz dönmediyse (undefined) yerleşik liste korunur.
  const items: LegalCatalogItem[] = PUBLIC_LEGAL_PAGES.filter(
    (item) => documents == null || published.has(item.slug),
  ).map((item) => ({ ...item }));

  const indexBySlug = new Map(items.map((item, index) => [item.slug, index]));

  for (const doc of documents ?? []) {
    const title = displayTitle(doc.title, doc.slug);
    const known = indexBySlug.get(doc.slug);
    if (known !== undefined) {
      // Başlık panelden değiştirilmişse menüde de güncel başlık görünsün.
      items[known] = { ...items[known]!, title };
      continue;
    }
    items.push({
      slug: doc.slug,
      path: `/policy/${doc.slug}`,
      title,
      shortTitle: title.length > 26 ? `${title.slice(0, 24).trimEnd()}…` : title,
      description: doc.summary ?? 'Trabzone hukuki belgesi.',
      category: CATEGORY_BY_DOC_TYPE[doc.doc_type] ?? 'Diğer Belgeler',
    });
  }

  return items;
}

/** Veritabanı kataloğunu bölümlere ayırır; boş bölümler atlanır. */
export function groupLegalDirectory(items: LegalCatalogItem[]) {
  return LEGAL_CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);
}

