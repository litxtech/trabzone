export type BadgeTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

export const PLACE_STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  pending: 'Onay bekliyor',
  published: 'Yayında',
  rejected: 'Reddedildi',
  archived: 'Arşiv',
  duplicate: 'Mükerrer',
};

export const PLACE_STATUS_TONES: Record<string, BadgeTone> = {
  draft: 'neutral',
  pending: 'warning',
  published: 'success',
  rejected: 'danger',
  archived: 'neutral',
  duplicate: 'neutral',
};

export const VERIFICATION_LABELS: Record<string, string> = {
  unverified: 'Doğrulanmamış',
  pending: 'Doğrulama bekliyor',
  verified: 'Doğrulanmış',
  rejected: 'Doğrulama reddedildi',
};

export const VERIFICATION_TONES: Record<string, BadgeTone> = {
  unverified: 'neutral',
  pending: 'warning',
  verified: 'success',
  rejected: 'danger',
};

export const RE_STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  pending_verification: 'Doğrulama bekliyor',
  pending_moderation: 'Moderasyon bekliyor',
  published: 'Yayında',
  rejected: 'Reddedildi',
  expired: 'Süresi doldu',
  archived: 'Arşiv',
  removed: 'Kaldırıldı',
};

export const RE_STATUS_TONES: Record<string, BadgeTone> = {
  draft: 'neutral',
  pending_verification: 'warning',
  pending_moderation: 'warning',
  published: 'success',
  rejected: 'danger',
  expired: 'warning',
  archived: 'neutral',
  removed: 'danger',
};

export const EIDS_LABELS: Record<string, string> = {
  unverified: 'EİDS doğrulanmadı',
  pending: 'EİDS bekliyor',
  verified: 'EİDS doğrulandı',
  rejected: 'EİDS reddedildi',
  expired: 'EİDS süresi doldu',
};

export const EIDS_TONES: Record<string, BadgeTone> = {
  unverified: 'neutral',
  pending: 'warning',
  verified: 'success',
  rejected: 'danger',
  expired: 'warning',
};

export const LISTING_KIND_LABELS: Record<string, string> = {
  rent: 'Kiralık',
  sale: 'Satılık',
  transfer: 'Devren',
};

export const OWNER_TYPE_LABELS: Record<string, string> = {
  owner: 'Mal sahibi',
  agent: 'Emlak danışmanı',
  business: 'İşletme',
  individual: 'Bireysel',
  corporate: 'Kurumsal',
};

export const SUGGESTION_STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  duplicate: 'Mükerrer',
};

export const CLAIM_STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
};

export const MODERATION_STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  hidden: 'Gizlendi',
  deleted: 'Silindi',
};

export const REPORT_TARGET_LABELS: Record<string, string> = {
  place: 'İşletme',
  place_media: 'İşletme medyası',
  place_review: 'İşletme yorumu',
  real_estate_listing: 'Emlak ilanı',
  real_estate_media: 'Emlak medyası',
};

export const REPORT_REASON_LABELS: Record<string, string> = {
  spam: 'Spam / reklam',
  inappropriate: 'Uygunsuz içerik',
  harassment: 'Taciz',
  hate: 'Nefret söylemi',
  violence: 'Şiddet',
  misinformation: 'Yanıltıcı bilgi',
  fraud: 'Dolandırıcılık',
  wrong_location: 'Yanlış konum',
  duplicate: 'Mükerrer kayıt',
  fake_listing: 'Sahte ilan',
  other: 'Diğer',
};

export function statusLabel(value: string, map: Record<string, string>) {
  return map[value] ?? value.replaceAll('_', ' ');
}

export function toneFor(value: string, map: Record<string, BadgeTone>): BadgeTone {
  return map[value] ?? 'neutral';
}

export function formatNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(value);
}

export function formatCoordinate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(6);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatShortDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(date);
}

export function cleanInline(value: string | null | undefined) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : '—';
}
