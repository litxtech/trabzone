const MONTHS_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

const pad = (value: number) => value.toString().padStart(2, '0');

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** 27 Ekim 2026 */
export function formatDateTr(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) {
    return '—';
  }
  return `${date.getDate()} ${MONTHS_TR[date.getMonth()] ?? ''} ${date.getFullYear()}`;
}

/** 27 Ekim 2026, 13:09 */
export function formatDateTimeTr(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) {
    return '—';
  }
  return `${formatDateTr(date)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 13:09 */
export function formatTimeTr(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) {
    return '—';
  }
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 27.10.2026 */
export function formatShortDateTr(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) {
    return '—';
  }
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function formatDayLabelTr(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) {
    return 'Bugün';
  }
  if (sameDay(date, yesterday)) {
    return 'Dün';
  }
  return formatDateTr(date);
}

/** "5 dk önce", "3 sa önce", "2 gün önce" */
export function formatRelativeTr(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return 'az önce';
  }
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} sa önce`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} gün önce`;
  }
  return formatShortDateTr(date);
}

/**
 * SLA geri sayimi. Cocuk guvenligi icin kirmizi vurgu, normal talepler icin
 * sakin bir ton dondurur.
 */
export function formatSlaRemaining(
  dueAt: string | Date | null | undefined,
): { label: string; expired: boolean; urgent: boolean } | null {
  const date = toDate(dueAt);
  if (!date) {
    return null;
  }
  const diff = date.getTime() - Date.now();
  const expired = diff <= 0;
  const absolute = Math.abs(diff);
  const minutes = Math.floor(absolute / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const amount =
    days >= 1
      ? `${days} gün`
      : hours >= 1
        ? `${hours} sa ${minutes % 60} dk`
        : `${Math.max(minutes, 1)} dk`;

  return {
    label: expired ? `${amount} gecikti` : `${amount} kaldı`,
    expired,
    urgent: !expired && diff < 4 * 60 * 60 * 1000,
  };
}

/** "2012-04-18" -> "18.04.2012" */
export function birthDateToInput(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) {
    return '';
  }
  return `${day}.${month}.${year}`;
}

/** "18.04.2012" -> "2012-04-18" (gecersizse null) */
export function inputToBirthDate(value: string): string | null {
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !month || !year) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const today = new Date();
  if (date.getTime() > today.getTime()) {
    return null;
  }
  return `${year.toString().padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

export function ageFromBirthDate(value: string | null | undefined): number | null {
  const date = toDate(value);
  if (!date) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }
  return age;
}
