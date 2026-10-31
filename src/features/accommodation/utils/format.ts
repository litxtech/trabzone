import type {
  BookingMode,
  CampaignKind,
  CampaignStatus,
  CashAccountKind,
  CashTransactionKind,
  HousekeepingStatus,
  MediaCategory,
  PaymentStatus,
  PropertyType,
  PropertyStatus,
  ReservationSource,
  ReservationStatus,
  RoomStatus,
  StaffRole,
  VerificationStatus,
} from '../types';

const TR = 'tr-TR';

export function formatMoneyCents(
  cents: number | null | undefined,
  currency = 'TRY',
  options: { compact?: boolean; decimals?: boolean } = {},
): string {
  const value = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(TR, {
      style: 'currency',
      currency,
      notation: options.compact ? 'compact' : 'standard',
      minimumFractionDigits: options.decimals === false ? 0 : 2,
      maximumFractionDigits: options.decimals === false ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(options.decimals === false ? 0 : 2)} ${currency}`;
  }
}

export function formatMoneyCompact(cents: number | null | undefined, currency = 'TRY'): string {
  return formatMoneyCents(cents, currency, { compact: true, decimals: false });
}

/** Metin alanındaki fiyatı kuruşa çevirir: "1.250,50" → 125050. */
export function parseMoneyToCents(input: string): number | null {
  const raw = input.replace(/[^\d.,-]/g, '').trim();
  if (!raw || raw === '-' || raw === ',' || raw === '.') {
    return null;
  }
  let normalized = raw;
  if (raw.includes(',') && raw.includes('.')) {
    normalized = raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (raw.includes(',')) {
    normalized = raw.replace(',', '.');
  } else if (raw.includes('.')) {
    const [whole, fraction] = raw.split('.');
    if (fraction && fraction.length === 3 && (whole?.length ?? 0) <= 3) {
      normalized = raw.replace('.', '');
    }
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100);
}

/** Kuruşu düzenlenebilir fiyat metnine çevirir: 125050 → "1.250,50". */
export function centsToInput(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString(TR, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat(TR).format(value ?? 0);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return `%${new Intl.NumberFormat(TR, { maximumFractionDigits: digits }).format(value ?? 0)}`;
}

// -----------------------------------------------------------------------------
// Tarih
// -----------------------------------------------------------------------------

/**
 * `YYYY-MM-DD` (veya saat dilimi ekli `YYYY-MM-DDTHH:mm:ss+03:00`) metnini
 * yerel saatte gece yarısına denk gelen Date'e çevirir.
 *
 * Eskiden `iso.split('-')` kullanılıyordu; tam zaman damgası geldiğinde gün
 * parçası `"31T00:00:00+03:00"` oluyor ve `NaN` üretip Invalid Date'e yol
 * açıyordu. Artık yalnızca tarih öneki okunur, geçersiz girdide geçersiz Date
 * döner ve biçimlendiriciler bunu "—" olarak gösterir.
 */
export function isoToDate(iso: string): Date {
  const match =
    typeof iso === 'string' ? /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(iso.trim()) : null;
  if (!match) {
    return new Date(Number.NaN);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3] ?? 1);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(Number.NaN);
  }
  return new Date(year, month - 1, day);
}

/** Tarih metnini güvenli biçimlendirir; geçersiz değerde çökmez, "—" döner. */
function formatIsoDate(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!iso) return '—';
  const date = isoToDate(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(TR, options).format(date);
  } catch {
    return '—';
  }
}

export function dateToIso(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayIso(): string {
  return dateToIso(new Date());
}

export function addDaysIso(iso: string, days: number): string {
  const date = isoToDate(iso);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return dateToIso(date);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const start = isoToDate(checkIn).getTime();
  const end = isoToDate(checkOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const end = isoToDate(to).getTime();
  let cursor = isoToDate(from);
  let guard = 0;
  while (cursor.getTime() < end && guard < 800) {
    days.push(dateToIso(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    guard += 1;
  }
  return days;
}

export function startOfWeek(iso: string): string {
  const date = isoToDate(iso);
  const weekday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekday);
  return dateToIso(date);
}

export function startOfMonth(iso: string): string {
  const date = isoToDate(iso);
  return dateToIso(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function endOfMonth(iso: string): string {
  const date = isoToDate(iso);
  return dateToIso(new Date(date.getFullYear(), date.getMonth() + 1, 1));
}

export function formatDate(iso: string | null | undefined): string {
  return formatIsoDate(iso, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateLong(iso: string | null | undefined): string {
  return formatIsoDate(iso, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  });
}

export function formatDateShort(iso: string | null | undefined): string {
  return formatIsoDate(iso, { day: '2-digit', month: '2-digit' });
}

export function formatWeekdayShort(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatIsoDate(iso, { weekday: 'short' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(TR, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const [hours, minutes] = value.split(':');
  return `${hours ?? '00'}:${minutes ?? '00'}`;
}

export function formatRange(checkIn: string | null | undefined, checkOut: string | null | undefined): string {
  if (!checkIn || !checkOut) return '—';
  return `${formatDate(checkIn)} – ${formatDate(checkOut)}`;
}

export function monthLabel(monthIso: string): string {
  return formatIsoDate(`${(monthIso ?? '').slice(0, 7)}-01`, { month: 'long', year: 'numeric' });
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'şimdi';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} gün önce`;
  return formatDate(value.slice(0, 10));
}

// -----------------------------------------------------------------------------
// Durum etiketleri ve renkleri
// -----------------------------------------------------------------------------

export type StatusTone = {
  label: string;
  color: string;
  background: string;
  border: string;
  short: string;
};

/**
 * Takvim renk dili HotelRunner ile aynı:
 * yeşil = gelen (içeride), kırmızı = gelip giden (çıkış/tamamlandı),
 * sarı = gelmeyen (no-show), mavi = onaylı/gelecek, gri = iptal.
 */
const RESERVATION_TONES: Record<ReservationStatus, StatusTone> = {
  draft: { label: 'Taslak', short: 'TAS', color: '#C3CEE6', background: 'rgba(148,163,184,0.16)', border: 'rgba(148,163,184,0.35)' },
  pending: { label: 'Onay bekliyor', short: 'BEK', color: '#FB923C', background: 'rgba(249,115,22,0.20)', border: 'rgba(251,146,60,0.48)' },
  confirmed: { label: 'Onaylandı', short: 'ONA', color: '#6284FF', background: 'rgba(65,105,245,0.20)', border: 'rgba(98,132,255,0.48)' },
  declined: { label: 'Reddedildi', short: 'RED', color: '#8B95A9', background: 'rgba(139,149,169,0.16)', border: 'rgba(139,149,169,0.34)' },
  expired: { label: 'Süresi doldu', short: 'SÜR', color: '#9AA6BF', background: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.30)' },
  awaiting_checkin: { label: 'Giriş bekleniyor', short: 'GBK', color: '#A78BFA', background: 'rgba(128,87,244,0.20)', border: 'rgba(167,139,250,0.48)' },
  checked_in: { label: 'Gelen', short: 'GİR', color: '#3DD68C', background: 'rgba(22,163,74,0.24)', border: 'rgba(61,214,140,0.52)' },
  staying: { label: 'Konaklıyor', short: 'KON', color: '#3DD68C', background: 'rgba(22,163,74,0.30)', border: 'rgba(61,214,140,0.58)' },
  checked_out: { label: 'Giden', short: 'ÇIK', color: '#FF6B70', background: 'rgba(229,72,77,0.24)', border: 'rgba(255,107,112,0.55)' },
  completed: { label: 'Tamamlandı', short: 'TAM', color: '#FF6B70', background: 'rgba(229,72,77,0.18)', border: 'rgba(255,107,112,0.44)' },
  cancelled: { label: 'İptal edildi', short: 'İPT', color: '#8B95A9', background: 'rgba(139,149,169,0.18)', border: 'rgba(139,149,169,0.38)' },
  no_show: { label: 'Gelmedi', short: 'GLM', color: '#EAB308', background: 'rgba(234,179,8,0.22)', border: 'rgba(234,179,8,0.52)' },
  change_pending: { label: 'Değişiklik bekliyor', short: 'DEĞ', color: '#C4B5FD', background: 'rgba(128,87,244,0.16)', border: 'rgba(196,181,253,0.40)' },
  disputed: { label: 'Uyuşmazlıkta', short: 'UYU', color: '#FDA4AF', background: 'rgba(244,63,94,0.18)', border: 'rgba(253,164,175,0.42)' },
};

export function reservationTone(status: ReservationStatus): StatusTone {
  return RESERVATION_TONES[status] ?? RESERVATION_TONES.draft;
}

/** Takvimde üstü çizili gösterilen (envanteri bloke etmeyen) durumlar. */
export function reservationIsInactive(status: ReservationStatus): boolean {
  return status === 'cancelled' || status === 'declined' || status === 'expired';
}

export function reservationStatusLabel(status: ReservationStatus): string {
  return reservationTone(status).label;
}

export const RESERVATION_STATUS_OPTIONS: { value: ReservationStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'pending', label: 'Onay bekliyor' },
  { value: 'confirmed', label: 'Onaylandı' },
  { value: 'awaiting_checkin', label: 'Giriş bekleniyor' },
  { value: 'checked_in', label: 'Giriş yapıldı' },
  { value: 'staying', label: 'Konaklıyor' },
  { value: 'checked_out', label: 'Çıkış yapıldı' },
  { value: 'completed', label: 'Tamamlandı' },
  { value: 'cancelled', label: 'İptal edildi' },
  { value: 'no_show', label: 'Gelmedi' },
  { value: 'draft', label: 'Taslak' },
  { value: 'declined', label: 'Reddedildi' },
  { value: 'expired', label: 'Süresi doldu' },
  { value: 'change_pending', label: 'Değişiklik bekliyor' },
  { value: 'disputed', label: 'Uyuşmazlıkta' },
];

const ROOM_TONES: Record<RoomStatus, StatusTone> = {
  clean: { label: 'Temiz', short: 'TMZ', color: '#3DD68C', background: 'rgba(22,163,74,0.16)', border: 'rgba(61,214,140,0.40)' },
  dirty: { label: 'Kirli', short: 'KRL', color: '#FBBF24', background: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.40)' },
  cleaning: { label: 'Temizlikte', short: 'TZM', color: '#7DD3FC', background: 'rgba(14,165,233,0.16)', border: 'rgba(125,211,252,0.40)' },
  inspection: { label: 'Kontrol bekliyor', short: 'KNT', color: '#C4B5FD', background: 'rgba(128,87,244,0.16)', border: 'rgba(196,181,253,0.40)' },
  maintenance: { label: 'Bakımda', short: 'BAK', color: '#FF8085', background: 'rgba(229,72,77,0.16)', border: 'rgba(229,72,77,0.40)' },
  out_of_service: { label: 'Satışa kapalı', short: 'KAP', color: '#9AA6BF', background: 'rgba(148,163,184,0.16)', border: 'rgba(148,163,184,0.35)' },
};

export function roomStatusTone(status: RoomStatus): StatusTone {
  return ROOM_TONES[status] ?? ROOM_TONES.clean;
}

export const ROOM_STATUS_OPTIONS = (Object.keys(ROOM_TONES) as RoomStatus[]).map((value) => ({
  value,
  label: ROOM_TONES[value].label,
}));

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Ödenmedi',
  partial: 'Kısmi ödeme',
  paid: 'Ödendi',
  refunded: 'İade edildi',
};

export function paymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_LABELS[status] ?? status;
}

export function paymentTone(status: PaymentStatus): StatusTone {
  switch (status) {
    case 'paid':
      return ROOM_TONES.clean;
    case 'partial':
      return ROOM_TONES.dirty;
    case 'refunded':
      return ROOM_TONES.inspection;
    default:
      return ROOM_TONES.maintenance;
  }
}

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  hotel: 'Otel',
  bungalow: 'Bungalov',
  apartment: 'Apart',
  pension: 'Pansiyon',
  villa: 'Villa',
};

export const PROPERTY_TYPE_OPTIONS = (Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).map((value) => ({
  value,
  label: PROPERTY_TYPE_LABELS[value],
}));

export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  draft: 'Taslak',
  pending_verification: 'Doğrulama bekliyor',
  published: 'Yayında',
  suspended: 'Askıya alındı',
  rejected: 'Reddedildi',
};

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  unverified: 'Doğrulanmadı',
  pending: 'Doğrulama bekliyor',
  verified: 'Doğrulandı',
  rejected: 'Reddedildi',
};

export const SOURCE_LABELS: Record<ReservationSource, string> = {
  trabzone: 'Trabzone',
  phone: 'Telefon',
  front_desk: 'Resepsiyon',
  direct_web: 'Doğrudan web',
  external_agency: 'Harici acente',
  other: 'Diğer',
};

export const SOURCE_OPTIONS = (Object.keys(SOURCE_LABELS) as ReservationSource[]).map((value) => ({
  value,
  label: SOURCE_LABELS[value],
}));

export const BOOKING_MODE_LABELS: Record<BookingMode, string> = {
  instant: 'Anında rezervasyon',
  manual: 'Manuel onay',
};

export const CAMPAIGN_KIND_LABELS: Record<CampaignKind, string> = {
  trabzone: 'Trabzone Özel',
  last_minute: 'Son Dakika',
  early_booking: 'Erken Rezervasyon',
  weekday: 'Hafta İçi',
  weekend: 'Hafta Sonu',
  long_stay: 'Uzun Konaklama',
  seasonal: 'Sezonluk',
  limited: 'Sınırlı Kontenjan',
  fixed_price: 'Sabit İndirimli Fiyat',
  percentage: 'Yüzdesel İndirim',
  special: 'Özel Anlaşma',
};

export const CAMPAIGN_KIND_OPTIONS = (Object.keys(CAMPAIGN_KIND_LABELS) as CampaignKind[]).map((value) => ({
  value,
  label: CAMPAIGN_KIND_LABELS[value],
}));

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Taslak',
  active: 'Yayında',
  paused: 'Duraklatıldı',
  ended: 'Sona erdi',
};

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Tesis sahibi',
  manager: 'Yönetici',
  front_desk: 'Ön büro',
  housekeeping: 'Kat hizmetleri',
  accountant: 'Muhasebe',
  viewer: 'Görüntüleme',
};

export const MEDIA_CATEGORY_LABELS: Record<MediaCategory, string> = {
  cover: 'Kapak',
  general: 'Genel',
  room: 'Odalar',
  restaurant: 'Restoran',
  pool: 'Havuz',
  lobby: 'Lobi',
  view: 'Manzara',
  common: 'Ortak alanlar',
};

export const MEDIA_CATEGORY_OPTIONS = (Object.keys(MEDIA_CATEGORY_LABELS) as MediaCategory[]).map((value) => ({
  value,
  label: MEDIA_CATEGORY_LABELS[value],
}));

export const CASH_ACCOUNT_LABELS: Record<CashAccountKind, string> = {
  cash: 'Nakit kasa',
  pos: 'POS hesabı',
  bank: 'Banka hesabı',
};

export const CASH_TRANSACTION_LABELS: Record<CashTransactionKind, string> = {
  collection: 'Tahsilat',
  expense: 'Gider',
  refund: 'İade',
  adjustment: 'Düzeltme',
  transfer_in: 'Transfer girişi',
  transfer_out: 'Transfer çıkışı',
  opening: 'Açılış',
};

export const HOUSEKEEPING_STATUS_LABELS: Record<HousekeepingStatus, string> = {
  pending: 'Bekliyor',
  in_progress: 'Devam ediyor',
  done: 'Tamamlandı',
  verified: 'Kontrol edildi',
};

export const TASK_KIND_LABELS: Record<'cleaning' | 'maintenance' | 'inspection', string> = {
  cleaning: 'Temizlik',
  maintenance: 'Bakım',
  inspection: 'Kontrol',
};

export const DOCUMENT_KIND_LABELS: Record<'reservation' | 'invoice' | 'receipt' | 'statement', string> = {
  reservation: 'Rezervasyon belgesi',
  invoice: 'Fatura',
  receipt: 'Fiş / makbuz',
  statement: 'Ekstre',
};

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toLocaleUpperCase(TR);
  return `${(parts[0] ?? '').charAt(0)}${(parts[parts.length - 1] ?? '').charAt(0)}`.toLocaleUpperCase(TR);
}

export function guestCount(adults: number, children: number): string {
  return children > 0 ? `${adults} yetişkin · ${children} çocuk` : `${adults} yetişkin`;
}

export function truncate(value: string, length = 42): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
