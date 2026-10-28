export type WebsiteSettingValue = Record<string, unknown>;

export type WebsiteBrand = {
  name?: string;
  tagline?: string;
  support_email?: string;
};

export type WebsiteHero = {
  eyebrow?: string;
  title?: string;
  slogan?: string;
  description?: string;
  primary_cta?: string;
  secondary_cta?: string;
  tertiary_cta?: string;
};

export type WebsiteNavItem = { label: string; href: string };

export type WebsiteSection = {
  key: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  payload: Record<string, unknown>;
  sort_order: number;
  is_published?: boolean;
  updated_at?: string;
};

export type WebsiteContent = {
  settings: {
    brand?: WebsiteBrand;
    hero?: WebsiteHero;
    nav?: { items?: WebsiteNavItem[] };
    apps?: { ios_url?: string | null; android_url?: string | null; status?: string; note?: string };
    social?: Record<string, string | null>;
    support?: {
      live_chat_enabled?: boolean;
      hours_label?: string;
      response_note?: string;
    };
    legal?: {
      operator_name?: string;
      operator_note?: string;
      terms_version?: string;
      privacy_version?: string;
      last_updated?: string;
    };
    [key: string]: WebsiteSettingValue | undefined;
  };
  sections: WebsiteSection[];
};

export type ContactChannel = {
  key: string;
  label: string;
  email: string | null;
  description: string | null;
  sort_order: number;
};

export type ContactSubmission = {
  id: string;
  reference_code: string;
  name: string;
  email: string;
  topic: string;
  message: string;
  status: string;
  created_at: string;
  response_text?: string | null;
  responded_at?: string | null;
  priority?: 'critical' | 'normal';
};

export type AdminContactChannel = ContactChannel & {
  is_active: boolean;
  verified_at: string | null;
};

export type EmailOutboxItem = {
  id: string;
  template_key: string;
  to_email: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export type EmailTemplateSummary = {
  key: string;
  locale: string;
  subject: string;
  is_active: boolean;
  updated_at: string;
};

export type EmailLogs = {
  outbox: EmailOutboxItem[];
  templates: EmailTemplateSummary[];
};

export const CONTACT_TOPICS = [
  { code: 'support', label: 'Genel Destek' },
  { code: 'privacy', label: 'Gizlilik ve Kişisel Veriler' },
  { code: 'child_safety', label: 'Çocuk Güvenliği' },
  { code: 'legal', label: 'Hukuki Bildirimler' },
  { code: 'business', label: 'İşletme ve Marketplace' },
  { code: 'other', label: 'Diğer' },
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number]['code'];
