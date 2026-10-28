const CURRENCY_LABEL: Record<string, string> = {
  TRY: '₺',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function formatMoney(cents: number | null | undefined, currency = 'TRY'): string {
  if (cents == null || Number.isNaN(cents)) {
    return '—';
  }
  const symbol = CURRENCY_LABEL[currency] ?? `${currency} `;
  const value = cents / 100;
  const fraction = value >= 1000 ? 0 : value % 1 === 0 ? 0 : 2;
  return `${symbol}${value.toLocaleString('tr-TR', {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  })}`;
}

export function formatPrice(
  cents: number | null | undefined,
  currency = 'TRY',
  period: string | null | undefined = null,
): string {
  const base = formatMoney(cents, currency);
  if (period === 'month') {
    return `${base}/ay`;
  }
  return base;
}

/** Harita fiyat rozeti: dar alana sığan kısa gösterim. */
export function shortPrice(cents: number | null | undefined, currency = 'TRY'): string {
  if (cents == null) {
    return '—';
  }
  const value = cents / 100;
  const symbol = CURRENCY_LABEL[currency] ?? '';
  if (value >= 1_000_000) {
    return `${symbol}${(value / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}M`;
  }
  if (value >= 1_000) {
    return `${symbol}${Math.round(value / 1_000)}B`;
  }
  return `${symbol}${Math.round(value)}`;
}

export function formatDecimal(value: number | null | undefined, digits = 1): string {
  if (value == null) {
    return '—';
  }
  return value.toLocaleString('tr-TR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) {
    return '';
  }
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} gün önce`;
  return formatDate(iso);
}

export function pricePeriodLabel(period: string | null | undefined, kind: string): string {
  if (period === 'month' || kind === 'rent') {
    return 'Aylık';
  }
  return 'Toplam';
}

export function listingKindLabel(kind: string | null | undefined): string {
  if (kind === 'rent') return 'Kiralık';
  if (kind === 'sale') return 'Satılık';
  if (kind === 'transfer') return 'Devren';
  return 'Emlak';
}

/** İşletmenin fiyat seviyesi (1-4). Veri yoksa uydurma aralık gösterme. */
export function priceLevelLabel(level: number | null | undefined): string | null {
  if (level == null || level < 1) {
    return null;
  }
  const clamped = Math.min(4, Math.round(level));
  return `${'₺'.repeat(clamped)}${'·'.repeat(4 - clamped)} fiyat seviyesi`;
}

export function placeStatusLabel(status: string): string {
  switch (status) {
    case 'published':
      return 'Yayında';
    case 'pending':
      return 'Onay bekliyor';
    case 'draft':
      return 'Taslak';
    case 'rejected':
      return 'Reddedildi';
    case 'archived':
      return 'Arşivde';
    case 'pending_verification':
      return 'Doğrulama bekliyor';
    case 'expired':
      return 'Süresi doldu';
    case 'removed':
      return 'Kaldırıldı';
    default:
      return status;
  }
}

export function verificationLabel(status: string): string {
  switch (status) {
    case 'verified':
      return 'Doğrulanmış';
    case 'pending':
      return 'Doğrulama bekliyor';
    case 'rejected':
      return 'Doğrulanmadı';
    case 'expired':
      return 'Doğrulama süresi doldu';
    default:
      return 'Doğrulanmamış';
  }
}

export type OpeningDay = { day: string; value: string };

const DAY_LABELS: Record<string, string> = {
  mon: 'Pazartesi',
  tue: 'Salı',
  wed: 'Çarşamba',
  thu: 'Perşembe',
  fri: 'Cuma',
  sat: 'Cumartesi',
  sun: 'Pazar',
  monday: 'Pazartesi',
  tuesday: 'Salı',
  wednesday: 'Çarşamba',
  thursday: 'Perşembe',
  friday: 'Cuma',
  saturday: 'Cumartesi',
  sunday: 'Pazar',
};

export function openingHoursEntries(hours: Record<string, unknown> | null | undefined): OpeningDay[] {
  if (!hours) {
    return [];
  }
  const entries: OpeningDay[] = [];
  for (const [key, value] of Object.entries(hours)) {
    if (typeof value === 'string' || typeof value === 'number') {
      entries.push({ day: DAY_LABELS[key.toLowerCase()] ?? key, value: String(value) });
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const open = record.open ?? record.opens;
      const close = record.close ?? record.closes;
      if (open || close) {
        entries.push({
          day: DAY_LABELS[key.toLowerCase()] ?? key,
          value: `${String(open ?? '—')} – ${String(close ?? '—')}`,
        });
      }
    }
  }
  return entries;
}

/** Açık/kapalı durumu yalnızca "HH:MM-HH:MM" biçimli gerçek saatlerden hesaplanır. */
export function openNow(hours: Record<string, unknown> | null | undefined): boolean | null {
  const entries = openingHoursEntries(hours);
  if (entries.length === 0) {
    return null;
  }
  const now = new Date();
  const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()] ?? '';
  const today =
    entries.find((entry) => entry.day === DAY_LABELS[dayKey]) ??
    (entries.length === 1 ? entries[0] : undefined);
  if (!today) {
    return null;
  }
  const match = /(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})/.exec(today.value);
  if (!match) {
    return null;
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(match[1]);
  const end = toMinutes(match[2]);
  if (start == null || end == null) {
    return null;
  }
  if (end < start) {
    return minutes >= start || minutes <= end;
  }
  return minutes >= start && minutes <= end;
}

function toMinutes(value: string | undefined): number | null {
  if (!value) return null;
  const [hour, minute] = value.replace('.', ':').split(':').map(Number);
  if (hour == null || minute == null || Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  return hour * 60 + minute;
}

export function metersLabel(m2: number | null | undefined): string {
  if (m2 == null) return '—';
  return `${m2.toLocaleString('tr-TR')} m²`;
}

export function roomLabel(count: number | null | undefined, living = 0): string {
  if (count == null) return '—';
  return living > 0 ? `${count}+${living}` : `${count} oda`;
}
