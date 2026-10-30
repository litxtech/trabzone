import { dateInputValue } from './format';
import type { RideRecurring, RideScope } from '../types';

/** Haftanın günleri: 1 = Pazartesi … 7 = Pazar (ISO). */
export const WEEKDAYS = [
  { value: 1, short: 'Pzt', long: 'Pazartesi' },
  { value: 2, short: 'Sal', long: 'Salı' },
  { value: 3, short: 'Çar', long: 'Çarşamba' },
  { value: 4, short: 'Per', long: 'Perşembe' },
  { value: 5, short: 'Cum', long: 'Cuma' },
  { value: 6, short: 'Cmt', long: 'Cumartesi' },
  { value: 7, short: 'Paz', long: 'Pazar' },
] as const;

export const DAY_PRESETS: { key: string; label: string; days: number[] }[] = [
  { key: 'workweek', label: 'Hafta içi', days: [1, 2, 3, 4, 5] },
  { key: 'weekend', label: 'Hafta sonu', days: [6, 7] },
  { key: 'everyday', label: 'Her gün', days: [1, 2, 3, 4, 5, 6, 7] },
];

export const DEPART_TIME_SUGGESTIONS = ['07:00', '08:00', '08:30', '09:00'];

export const RETURN_TIME_SUGGESTIONS = ['17:30', '18:00', '18:30', '19:00'];

export const POPULAR_ROUTES: { origin: string; dest: string; city: string }[] = [
  { origin: 'Meydan', dest: 'Karadeniz Teknik Üniversitesi', city: 'Trabzon' },
  { origin: 'Ortahisar', dest: 'Akçaabat', city: 'Trabzon' },
  { origin: 'Ortahisar', dest: 'Yomra', city: 'Trabzon' },
  { origin: 'Akçaabat', dest: 'Ortahisar', city: 'Trabzon' },
  { origin: 'Değirmendere', dest: 'Söğütlü', city: 'Trabzon' },
];

export type RecurringDraft = {
  role: 'driver' | 'passenger';
  scope: RideScope;
  originLabel: string;
  originCity: string;
  destLabel: string;
  destCity: string;
  weekdays: number[];
  departTime: string;
  returnTime: string;
  seats: number;
  price: string;
  vehicleId: string | null;
  womenOnly: boolean;
  noSmoking: boolean;
};

export function emptyDraft(city = 'Trabzon'): RecurringDraft {
  return {
    role: 'passenger',
    scope: 'intracity',
    originLabel: '',
    originCity: city,
    destLabel: '',
    destCity: city,
    weekdays: [1, 2, 3, 4, 5],
    departTime: '08:00',
    returnTime: '',
    seats: 1,
    price: '',
    vehicleId: null,
    womenOnly: false,
    noSmoking: true,
  };
}

export function draftFromPlan(plan: RideRecurring): RecurringDraft {
  return {
    role: plan.role,
    scope: plan.scope,
    originLabel: plan.origin_label,
    originCity: plan.origin_city,
    destLabel: plan.dest_label,
    destCity: plan.dest_city,
    weekdays: [...plan.weekdays].sort((a, b) => a - b),
    departTime: shortTime(plan.depart_time),
    returnTime: plan.return_time ? shortTime(plan.return_time) : '',
    seats: plan.seats,
    price: plan.price_per_seat_cents != null ? centsToInput(plan.price_per_seat_cents) : '',
    vehicleId: plan.vehicle_id,
    womenOnly: plan.preferences?.women_only === true,
    noSmoking: plan.preferences?.smoking === false,
  };
}

/** "08:00:00" → "08:00" */
export function shortTime(value: string): string {
  return value.slice(0, 5);
}

function centsToInput(cents: number): string {
  const lira = cents / 100;
  return Number.isInteger(lira) ? String(lira) : lira.toFixed(2).replace('.', ',');
}

export function parsePriceCents(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed * 100);
}

/** Rakamları "SS:DD" biçimine sokar; kullanıcı yazarken iki nokta kendiliğinden eklenir. */
export function normalizeTimeInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) {
    return digits;
  }
  let hour = digits.slice(0, 2);
  let minute = digits.slice(2);
  // "830" gibi tek haneli saat girişleri "08:30" olarak yorumlanır.
  if (digits.length === 3 && Number(hour) > 23) {
    hour = `0${digits[0]}`;
    minute = digits.slice(1);
  }
  return `${hour}:${minute}`;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

export function weekdaySummary(days: number[]): string {
  const sorted = uniqueDays(days);
  if (sorted.length === 0) {
    return 'Gün seçilmedi';
  }
  if (sorted.length === 7) {
    return 'Her gün';
  }
  if (isSameDays(sorted, [1, 2, 3, 4, 5])) {
    return 'Hafta içi';
  }
  if (isSameDays(sorted, [6, 7])) {
    return 'Hafta sonu';
  }
  return sorted
    .map((day) => WEEKDAYS.find((item) => item.value === day)?.short ?? '')
    .filter(Boolean)
    .join(' · ');
}

export function activeDayPreset(days: number[]): string | null {
  const sorted = uniqueDays(days);
  return DAY_PRESETS.find((preset) => isSameDays(sorted, preset.days))?.key ?? null;
}

export function uniqueDays(days: number[]): number[] {
  return [...new Set(days)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
}

function isSameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((day, index) => day === b[index]);
}

/** Bir planın haftalık toplam sefer sayısı (dönüş varsa iki yön). */
export function weeklyDepartures(plan: RideRecurring): number {
  return plan.weekdays.length * (plan.return_time ? 2 : 1);
}

export function totalWeeklyDepartures(plans: RideRecurring[]): number {
  return plans
    .filter((plan) => plan.is_active)
    .reduce((total, plan) => total + weeklyDepartures(plan), 0);
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function dateChipLabel(value: string, now = new Date()): string {
  const date = parseDateInput(value);
  if (!date) {
    return value;
  }
  const diff = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Yarın';
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(date);
}

export type PauseOption = { date: string; label: string; hint: string };

/**
 * Planın gerçekten çalıştığı günlerden başlayarak duraklatma önerileri üretir.
 * Bugünün kalkış saati geçtiyse bugün atlanır; planla ilgisi olmayan günler
 * önerilmez.
 */
export function pauseDateOptions(plan: RideRecurring, now = new Date()): PauseOption[] {
  const [hour, minute] = shortTime(plan.depart_time).split(':').map(Number);
  const hasTime = Number.isFinite(hour) && Number.isFinite(minute);
  const options: PauseOption[] = [];

  for (let offset = 0; offset < 15 && options.length < 4; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const isoDay = date.getDay() === 0 ? 7 : date.getDay();
    if (!plan.weekdays.includes(isoDay)) {
      continue;
    }
    if (offset === 0 && hasTime) {
      const depart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
      if (depart.getTime() <= now.getTime()) {
        continue;
      }
    }
    const weekday = WEEKDAYS.find((day) => day.value === isoDay)?.short ?? '';
    const dayMonth = new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: 'short',
    }).format(date);
    options.push({
      date: dateInputValue(date),
      label: offset === 0 ? 'Bugün' : offset === 1 ? 'Yarın' : `${offset} gün sonra`,
      hint: `${weekday} ${dayMonth}`,
    });
  }

  return options;
}

export function upcomingPausedDates(plan: RideRecurring, now = new Date()): string[] {
  const today = dateInputValue(now);
  return [...new Set(plan.paused_dates ?? [])].filter((date) => date >= today).sort();
}

export type UpcomingOccurrence = {
  date: string;
  daysAhead: number;
  time: string;
};

/**
 * Planın bir sonraki gerçek seferi: duraklatılan günler atlanır, bugünün saati
 * geçtiyse bir sonraki uygun güne bakılır. Pasif planlarda null döner.
 */
export function upcomingOccurrence(
  plan: RideRecurring,
  now = new Date(),
): UpcomingOccurrence | null {
  if (!plan.is_active) {
    return null;
  }
  const time = shortTime(plan.depart_time);
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  const paused = new Set(plan.paused_dates ?? []);
  for (let offset = 0; offset < 8; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const iso = dateInputValue(day);
    if (paused.has(iso)) {
      continue;
    }
    const isoDay = day.getDay() === 0 ? 7 : day.getDay();
    if (!plan.weekdays.includes(isoDay)) {
      continue;
    }
    const depart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
    if (depart.getTime() <= now.getTime()) {
      continue;
    }
    return { date: iso, daysAhead: offset, time };
  }
  return null;
}

export function occurrenceLabel(occurrence: UpcomingOccurrence): string {
  if (occurrence.daysAhead === 0) {
    return `Bugün ${occurrence.time}`;
  }
  if (occurrence.daysAhead === 1) {
    return `Yarın ${occurrence.time}`;
  }
  return `${WEEKDAYS.find((day) => day.value === weekdayOf(occurrence.date))?.long ?? ''} ${occurrence.time}`;
}

function weekdayOf(iso: string): number {
  const date = parseDateInput(iso);
  if (!date) {
    return 0;
  }
  return date.getDay() === 0 ? 7 : date.getDay();
}

/** Birden çok plan arasından en yakın sefer. */
export function nextAcross(plans: RideRecurring[], now = new Date()): UpcomingOccurrence | null {
  return (
    plans
      .filter((plan) => plan.is_active)
      .map((plan) => upcomingOccurrence(plan, now))
      .filter((item): item is UpcomingOccurrence => item != null)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] ?? null
  );
}

export function planIsPausedToday(plan: RideRecurring, now = new Date()): boolean {
  return (plan.paused_dates ?? []).includes(dateInputValue(now));
}
