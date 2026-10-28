export type LegalDocType = 'contract' | 'policy' | 'notice' | 'rules' | 'disclosure';

export type LegalLocale = 'tr' | 'en';

export type LegalDocument = {
  slug: string;
  version: number;
  locale: LegalLocale;
  doc_type: LegalDocType;
  title: string;
  summary: string | null;
  body_md: string;
  content_hash: string;
  requires_acceptance: boolean;
  requires_reacceptance: boolean;
  effective_at: string | null;
  published_at: string | null;
  change_summary: string | null;
};

export type LegalDocumentSummary = {
  slug: string;
  version: number;
  locale: LegalLocale;
  doc_type: LegalDocType;
  title: string;
  summary: string | null;
  requires_acceptance: boolean;
  effective_at: string | null;
  published_at: string | null;
};

export type LegalAction = 'accepted' | 'acknowledged' | 'presented';

export type LegalSource =
  | 'web_register'
  | 'web_consent_gate'
  | 'web_settings'
  | 'web_support'
  | 'mobile_register'
  | 'mobile_settings'
  | 'oauth_register';

export type LegalAcceptance = {
  slug: string;
  version: number;
  action: LegalAction;
  source: LegalSource;
  created_at: string;
  content_hash: string;
};

export type PendingAcceptance = {
  slug: string;
  version: number;
  title: string;
  doc_type: LegalDocType;
  effective_at: string | null;
};

export type ConsentPurpose = 'marketing_email' | 'product_analytics' | 'personalization';

export type ConsentRecord = {
  purpose: ConsentPurpose;
  granted: boolean;
  source: string;
  granted_at: string | null;
  revoked_at: string | null;
  updated_at: string;
};

export type LegalAdminVersion = {
  id: string;
  slug: string;
  locale: LegalLocale;
  version: number;
  doc_type: LegalDocType;
  title: string;
  summary: string | null;
  body_md: string;
  content_hash: string;
  is_published: boolean;
  requires_acceptance: boolean;
  requires_reacceptance: boolean;
  change_summary: string | null;
  effective_at: string | null;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  acceptance_count: number;
};

/** Herkese açık hukuki belge kataloğu. Sıra, ürünün bilgi mimarisini izler. */
export const LEGAL_CATALOG: {
  slug: string;
  label: string;
  short: string;
  group: 'policy' | 'support';
}[] = [
  { slug: 'terms', label: 'Kullanım Koşulları', short: 'Platform kullanımına ilişkin sözleşme.', group: 'policy' },
  { slug: 'privacy', label: 'Gizlilik Politikası', short: 'Hangi verileri, neden ve nasıl işliyoruz?', group: 'policy' },
  { slug: 'kvkk', label: 'KVKK Aydınlatma Metni', short: '6698 sayılı Kanun kapsamında aydınlatma.', group: 'policy' },
  { slug: 'data-protection', label: 'Veri Koruma Politikası', short: 'Teknik ve idari güvenlik tedbirleri.', group: 'policy' },
  { slug: 'child-safety', label: 'Çocuk Koruma Politikası', short: 'Çocuk güvenliği standartları ve bildirim.', group: 'policy' },
  { slug: 'community-guidelines', label: 'Topluluk Kuralları', short: 'Birlikte güvenli bir topluluk için kurallar.', group: 'policy' },
  { slug: 'cookies', label: 'Çerez Politikası', short: 'Çerez türleri ve tercihlerin.', group: 'policy' },
  { slug: 'account-deletion', label: 'Hesap ve Veri Silme', short: 'Silme kapsamı ve süreç.', group: 'support' },
  { slug: 'marketplace-rules', label: 'Marketplace Kuralları', short: 'İlan, satıcı ve alıcı kuralları.', group: 'support' },
  { slug: 'real-estate-rules', label: 'Emlak İlan Kuralları', short: 'Emlak ilanı verme kuralları.', group: 'support' },
  { slug: 'vehicle-rules', label: 'Araç İlan Kuralları', short: 'Araç ilanı verme kuralları.', group: 'support' },
];
