import type { ThemeColors } from '@/theme/themes';

export type BadgeTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

export function listingKindLabel(kind: string | null | undefined): string {
  if (kind === 'rent') return 'Kiralık';
  if (kind === 'sale') return 'Satılık';
  if (kind === 'transfer') return 'Devren';
  return 'Emlak';
}

export function ownerTypeLabel(type: string | null | undefined): string {
  if (type === 'agent') return 'Emlak danışmanı';
  if (type === 'business') return 'Emlak işletmesi';
  return 'İlan sahibi';
}

/** EİDS / yetki doğrulaması. Doğrulanmamış kayıt asla "doğrulandı" gösterilmez. */
export function eidsLabel(status: string | null | undefined): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'verified':
      return { label: 'EİDS doğrulandı', tone: 'success' };
    case 'pending':
      return { label: 'EİDS doğrulama bekliyor', tone: 'warning' };
    case 'rejected':
      return { label: 'EİDS doğrulanmadı', tone: 'danger' };
    case 'expired':
      return { label: 'EİDS süresi doldu', tone: 'danger' };
    default:
      return { label: 'EİDS doğrulanmamış', tone: 'neutral' };
  }
}

export function listingStatusLabel(status: string | null | undefined): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'published':
      return { label: 'Yayında', tone: 'success' };
    case 'pending_verification':
      return { label: 'Doğrulama bekliyor', tone: 'warning' };
    case 'pending':
      return { label: 'Moderasyon bekliyor', tone: 'warning' };
    case 'draft':
      return { label: 'Taslak', tone: 'neutral' };
    case 'rejected':
      return { label: 'Reddedildi', tone: 'danger' };
    case 'expired':
      return { label: 'Süresi doldu', tone: 'warning' };
    case 'removed':
      return { label: 'Kaldırıldı', tone: 'danger' };
    default:
      return { label: status ?? 'Bilinmiyor', tone: 'neutral' };
  }
}

export function heatingLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const labels: Record<string, string> = {
    natural_gas: 'Doğalgaz',
    combi: 'Kombi',
    central: 'Merkezi',
    stove: 'Soba',
    air_conditioner: 'Klima',
    floor_heating: 'Yerden ısıtma',
    none: 'Isıtma yok',
  };
  return labels[value] ?? value;
}

export function parsePriceToCents(value: string): number | null {
  const cleaned = value.replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

export function parseInteger(value: string): number | null {
  const cleaned = value.replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

export function toneColor(theme: { colors: ThemeColors }, tone: BadgeTone): string {
  switch (tone) {
    case 'success':
      return theme.colors.success;
    case 'warning':
      return theme.colors.warning;
    case 'danger':
      return theme.colors.danger;
    case 'neutral':
      return theme.colors.textSecondary;
    case 'accent':
      return theme.colors.accent;
    default:
      return theme.colors.primaryDeep;
  }
}
