import type {
  OfferStatus,
  ReservationStatus,
  RideBookingMode,
  RideLevel,
  RideMode,
  RideScope,
  RideVisibility,
  VerificationKind,
} from '../types';

export const SCOPE_LABEL: Record<RideScope, string> = {
  intracity: 'Şehir içi',
  intercity: 'Şehirler arası',
};

export const MODE_LABEL: Record<RideMode, string> = {
  instant: 'Anlık',
  scheduled: 'Planlı',
};

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  draft: 'Taslak',
  published: 'Yayında',
  full: 'Dolu',
  started: 'Yolda',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
  expired: 'Süresi doldu',
};

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  requested: 'Talep gönderildi',
  awaiting_approval: 'Onay bekliyor',
  confirmed: 'Onaylandı',
  rejected: 'Reddedildi',
  expired: 'Süresi doldu',
  cancelled: 'İptal edildi',
  started: 'Yolculuk başladı',
  completed: 'Tamamlandı',
  disputed: 'Uyuşmazlıkta',
};

export const STATUS_TONE: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
  published: 'primary',
  full: 'warning',
  started: 'accent',
  completed: 'success',
  cancelled: 'danger',
  expired: 'neutral',
  draft: 'neutral',
  requested: 'warning',
  awaiting_approval: 'warning',
  confirmed: 'success',
  rejected: 'danger',
  disputed: 'danger',
};

export const LEVEL_LABEL: Record<RideLevel, string> = {
  verified: 'Doğrulanmış Üye',
  silver: 'Gümüş Yol Arkadaşı',
  gold: 'Altın Yol Arkadaşı',
  platinum: 'Platin Yol Arkadaşı',
};

export const LEVEL_TONE: Record<RideLevel, 'primary' | 'success' | 'warning' | 'accent' | 'neutral'> = {
  verified: 'primary',
  silver: 'neutral',
  gold: 'warning',
  platinum: 'accent',
};

export const VISIBILITY_LABEL: Record<RideVisibility, string> = {
  public: 'Herkese açık',
  friends: 'Yalnızca bağlantılar',
  private: 'Özel',
};

export const BOOKING_MODE_LABEL: Record<RideBookingMode, string> = {
  manual: 'Manuel onay',
  auto: 'Otomatik onay',
};

export const VERIFICATION_LABEL: Record<VerificationKind, string> = {
  identity: 'Kimlik',
  driver_license: 'Sürücü belgesi',
  insurance: 'Trafik sigortası',
  transport_license: 'Taşımacılık belgesi',
};

export const VERIFICATION_STATUS_LABEL: Record<string, string> = {
  unverified: 'Doğrulanmadı',
  pending: 'İnceleniyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  expired: 'Süresi doldu',
  none: 'Başvuru yok',
  suspended: 'Askıda',
};

export function formatMoney(cents: number | null | undefined, currency = 'TRY'): string {
  if (cents == null || Number.isNaN(cents)) {
    return '—';
  }
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ₺`;
  }
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 5);
  }
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || Number.isNaN(meters)) {
    return '—';
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes) || minutes <= 0) {
    return '—';
  }
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) {
    return `${rest} dk`;
  }
  return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
}

export function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((target.getTime() - start.getTime()) / 86_400_000);
  if (days === 0) return 'Bugün';
  if (days === 1) return 'Yarın';
  if (days === -1) return 'Dün';
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'long', weekday: 'short' }).format(date);
}

export function displayName(first: string | null | undefined, username?: string | null): string {
  return first?.trim() || username || 'Trabzone üyesi';
}

export function initials(first: string | null | undefined, username?: string | null): string {
  const value = displayName(first, username);
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '')
    .join('');
}

export function toIsoFromLocal(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function timeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function preferenceLabels(preferences: Record<string, unknown> | null | undefined): string[] {
  if (!preferences) {
    return [];
  }
  const labels: string[] = [];
  if (preferences.smoking === false) labels.push('Sigarasız');
  if (preferences.ac === true) labels.push('Klima');
  if (preferences.pets === true) labels.push('Evcil hayvan');
  if (preferences.quiet === true) labels.push('Sessiz');
  if (preferences.breaks === true) labels.push('Mola');
  if (preferences.charging === true) labels.push('Şarj');
  if (preferences.child_seat === true) labels.push('Çocuk koltuğu');
  if (preferences.women_only === true) labels.push('Yalnızca kadın');
  if (preferences.accessible_required === true) labels.push('Erişilebilir');
  if (preferences.music === 'none') labels.push('Müzik yok');
  return labels;
}

export function weekdayLabels(days: number[]): string {
  const names = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  return days.map((day) => names[day - 1] ?? '').filter(Boolean).join(', ');
}

export const WEEKDAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
