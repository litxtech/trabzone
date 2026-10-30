import type {
  PharmacyDutyNotice,
  PharmacyDutyState,
  PharmacyShift,
  PharmacyState,
} from '../types';

/**
 * Türkiye 2016'dan beri kalıcı UTC+3 kullanır (yaz saati uygulaması yok).
 * Cihazın saat dilimi ne olursa olsun nöbet bilgisini Europe/Istanbul'a göre
 * göstermek için sabit ofsetle hesaplıyoruz; böylece `Intl` desteğine bağımlı
 * kalmıyoruz ve yurt dışındaki kullanıcı yanlış saat görmez.
 */
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

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

const WEEKDAYS_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

const pad = (value: number) => value.toString().padStart(2, '0');

export type IstanbulParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  /** 1 = Pazartesi … 7 = Pazar (Postgres `isodow` ile aynı). */
  isodow: number;
};

export function istanbulParts(value: string | Date | null | undefined): IstanbulParts | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const shifted = new Date(date.getTime() + ISTANBUL_OFFSET_MS);
  const weekday = shifted.getUTCDay();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday,
    isodow: weekday === 0 ? 7 : weekday,
  };
}

/** "18.00" — nöbet saatleri Türkçe yazımda nokta ile ayrılır. */
export function formatHourMinute(value: string | Date | null | undefined): string {
  const parts = istanbulParts(value);
  if (!parts) {
    return '—';
  }
  return `${pad(parts.hour)}.${pad(parts.minute)}`;
}

/** "18.00 – 08.00" */
export function formatDutyWindow(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
): string {
  if (!startsAt || !endsAt) {
    return 'Saat bilgisi yok';
  }
  return `${formatHourMinute(startsAt)} – ${formatHourMinute(endsAt)}`;
}

/** "28 Ekim" */
export function formatDayMonth(value: string | null | undefined): string {
  const parts = istanbulParts(value);
  if (!parts) {
    return '—';
  }
  return `${parts.day} ${MONTHS_TR[parts.month] ?? ''}`;
}

/** "28 Ekim 2026, 21.15" */
export function formatDateTimeIstanbul(value: string | null | undefined): string {
  const parts = istanbulParts(value);
  if (!parts) {
    return '—';
  }
  return `${parts.day} ${MONTHS_TR[parts.month] ?? ''} ${parts.year}, ${pad(parts.hour)}.${pad(parts.minute)}`;
}

/** "28.10.2026" */
export function formatDateDots(value: string | null | undefined): string {
  const parts = istanbulParts(value);
  if (!parts) {
    return '—';
  }
  return `${pad(parts.day)}.${pad(parts.month + 1)}.${parts.year}`;
}

export function weekdayLabel(value: string | null | undefined): string {
  const parts = istanbulParts(value);
  if (!parts) {
    return '—';
  }
  return WEEKDAYS_TR[parts.weekday] ?? '—';
}

/** Gece yarısını aşan nöbetlerde bitiş bir sonraki gündür. */
export function dutyEndsNextDay(shift: Pick<PharmacyShift, 'starts_at' | 'ends_at'> | null) {
  if (!shift) {
    return false;
  }
  const start = istanbulParts(shift.starts_at);
  const end = istanbulParts(shift.ends_at);
  if (!start || !end) {
    return false;
  }
  return start.day !== end.day || start.month !== end.month || start.year !== end.year;
}

/** "Yaklaşık 2,4 km (kuş uçuşu)" — yol mesafesi olarak sunulmaz. */
export function formatDistance(km: number | null | undefined): string | null {
  if (km == null || !Number.isFinite(km)) {
    return null;
  }
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1).replace('.', ',')} km`;
}

// ---------------------------------------------------------------------------
// Durum rozetleri
// ---------------------------------------------------------------------------

export type StatusTone = 'duty' | 'today' | 'open' | 'closed' | 'unknown';

export type PharmacyStatusView = {
  tone: StatusTone;
  /** Kısa rozet metni. */
  label: string;
  /** Alt satır: "Nöbet 18.00'de başlayacak" gibi açıklama. */
  detail: string | null;
  onDutyNow: boolean;
  dutyToday: boolean;
  /** Gerçeği aşan kesinlikte sunmamak için gösterilen çekince. */
  caveat: string | null;
};

export const PHARMACY_DUTY_CAVEAT =
  'Nöbet saatine göre açık olması bekleniyor. Yola çıkmadan önce telefonla teyit edin.';

export function describePharmacyState(state: PharmacyState | null | undefined): PharmacyStatusView {
  if (!state) {
    return {
      tone: 'unknown',
      label: 'Durum Doğrulanamadı',
      detail: null,
      onDutyNow: false,
      dutyToday: false,
      caveat: null,
    };
  }

  const shift = state.shift;
  const window = shift ? formatDutyWindow(shift.starts_at, shift.ends_at) : null;
  const startHour = shift ? formatHourMinute(shift.starts_at) : null;
  const endHour = shift ? formatHourMinute(shift.ends_at) : null;
  const nextDay = dutyEndsNextDay(shift);
  // Sunucu `verified` alanını yalnızca `confirmed` + `verified_at` doluysa true döner.
  const unverifiedShift = shift != null && !shift.verified;
  const stale = state.stale === true;
  // Tazelik eşiği aşıldıysa "şu an nöbette" iddiası kurulmaz (bkz. 0144 migration).
  const trustedNow = state.on_duty_now && !stale && !unverifiedShift;
  const reliabilityCaveat = stale
    ? staleNotice(true)
    : unverifiedShift
      ? 'Nöbet kaydı henüz doğrulanmadı.'
      : null;

  switch (state.state) {
    case 'on_duty':
      if (!trustedNow) {
        return {
          tone: 'today',
          label: 'Bugün Nöbetçi',
          detail: window ? `Nöbet: ${window}${nextDay ? ' (ertesi gün)' : ''}` : null,
          onDutyNow: false,
          dutyToday: true,
          caveat: reliabilityCaveat ?? PHARMACY_DUTY_CAVEAT,
        };
      }
      return {
        tone: 'duty',
        label: 'Şu An Nöbette',
        detail: window ? `Nöbet: ${window}${nextDay ? ' (ertesi gün)' : ''}` : null,
        onDutyNow: true,
        dutyToday: true,
        caveat: PHARMACY_DUTY_CAVEAT,
      };
    case 'duty_today_later':
      return {
        tone: 'today',
        label: 'Bugün Nöbetçi',
        detail: startHour
          ? `Nöbet ${startHour}'de başlayacak${endHour ? `, ${endHour}'de bitecek` : ''}`
          : 'Bugün nöbetçi',
        onDutyNow: false,
        dutyToday: true,
        caveat: reliabilityCaveat,
      };
    case 'duty_today_ended':
      return {
        tone: 'today',
        label: 'Bugün Nöbetçi',
        detail: endHour ? `Bugünkü nöbet ${endHour}'de sona erdi` : 'Bugünkü nöbet sona erdi',
        onDutyNow: false,
        dutyToday: true,
        caveat: reliabilityCaveat,
      };
    case 'none':
      if (state.work_state === 'open') {
        return {
          tone: 'open',
          label: 'Normal Çalışma Saatlerinde',
          detail: 'Bugün nöbetçi değil, çalışma saatleri içinde.',
          onDutyNow: false,
          dutyToday: false,
          caveat: 'Çalışma saati kaydına göre açık görünüyor.',
        };
      }
      if (state.work_state === 'closed') {
        return {
          tone: 'closed',
          label: 'Çalışma Saati Dışında',
          detail: 'Bugün nöbetçi değil.',
          onDutyNow: false,
          dutyToday: false,
          caveat: 'Çalışma saati kaydına göre kapalı görünüyor.',
        };
      }
      return {
        tone: 'closed',
        label: 'Bugün Nöbetçi Değil',
        detail: 'Bugünün nöbet listesinde yer almıyor.',
        onDutyNow: false,
        dutyToday: false,
        caveat: state.hours_known ? null : 'Çalışma saatleri bilinmiyor.',
      };
    default:
      return {
        tone: 'unknown',
        label: 'Durum Doğrulanamadı',
        detail: state.duty_tracking
          ? 'Bu bölge için güncel nöbet listesi yayımlanmadı.'
          : 'Bu eczane için nöbet takibi yapılandırılmadı.',
        onDutyNow: false,
        dutyToday: false,
        caveat: null,
      };
  }
}

/** Nöbet kaydı tazelik eşiğini aştıysa kullanıcıya söylenecek metin. */
export function staleNotice(stale: boolean, staleAfterHours = 18): string | null {
  if (!stale) {
    return null;
  }
  return `Nöbet listesi ${staleAfterHours} saatten uzun süredir güncellenmedi. Kayıt bugünün kesin listesi olmayabilir; gitmeden önce arayın.`;
}

/**
 * Günün duyurusu için tek cümlelik, veriye dayalı metin.
 * Eczane adı yalnızca gerçek kayıttan gelir; kayıt yoksa isim uydurulmaz.
 */
export function dutyNoticeHeadline(notice: PharmacyDutyNotice | null | undefined): string {
  if (!notice) {
    return 'Nöbet listesi yükleniyor…';
  }
  if (!notice.count) {
    return notice.neighborhood
      ? `${notice.neighborhood} için yayımlanmış nöbet kaydı yok.`
      : `${notice.district ?? 'Trabzon'} için yayımlanmış nöbet kaydı yok.`;
  }
  const names = notice.items.map((item) => item.name);
  const place = notice.neighborhood
    ? `${notice.neighborhood} Mahallesi`
    : (notice.district ?? 'Trabzon');
  if (names.length === 1) {
    return `Bugün ${place}'nde ${names[0]} nöbetçi.`;
  }
  if (names.length === 2) {
    return `Bugün ${place}'nde ${names[0]} ve ${names[1]} nöbetçi.`;
  }
  return `${place} için bugün ${names.length} nöbetçi eczane listelendi.`;
}

/** Duyuru alt satırı: saat aralığı + tazelik. */
export function dutyNoticeSubline(notice: PharmacyDutyNotice | null | undefined): string {
  if (!notice || !notice.count) {
    return 'Kaynak yayımlandığında burada görünecek.';
  }
  const first = notice.items[0];
  if (!first) {
    return 'Kaynak yayımlandığında burada görünecek.';
  }
  const range = formatDutyWindow(first.starts_at, first.ends_at);
  const live = notice.on_duty_now > 0 ? `${notice.on_duty_now} eczane şu an nöbette · ` : '';
  return `${live}Nöbet ${range}`;
}

/** Liste başlığında "bugün" vurgusu için kısa tarih. */
export function todayLabelIstanbul(offsetDays = 0): string {
  const parts = istanbulParts(new Date(Date.now() + offsetDays * 86_400_000));
  if (!parts) {
    return 'Bugün';
  }
  return `${parts.day} ${MONTHS_TR[parts.month] ?? ''} ${WEEKDAYS_TR[parts.weekday] ?? ''}`.trim();
}

export type DutyStateFilter = 'duty_today' | 'on_duty_now' | 'all' | 'nearby';

export const PHARMACY_FILTERS: { key: DutyStateFilter; label: string; icon: string }[] = [
  { key: 'duty_today', label: 'Bugün Nöbetçi', icon: 'moon-outline' },
  { key: 'on_duty_now', label: 'Şu An Nöbette', icon: 'pulse-outline' },
  { key: 'all', label: 'Tüm Eczaneler', icon: 'list-outline' },
  { key: 'nearby', label: 'Yakınımdakiler', icon: 'navigate-outline' },
];

/** Servis `nearby` modu için konum şart; konum yoksa `all` gibi çalışır. */
export function dutyStateToMode(filter: DutyStateFilter): 'all' | 'duty_today' | 'on_duty_now' | 'nearby' {
  return filter;
}

export function dutyStateTitle(filter: DutyStateFilter, district: string | null): string {
  switch (filter) {
    case 'duty_today':
      return district ? `Bugün ${district}'da nöbetçi eczaneler` : 'Bugün nöbetçi eczaneler';
    case 'on_duty_now':
      return district ? `${district}'da şu an nöbette olanlar` : 'Şu an nöbette olanlar';
    case 'nearby':
      return 'Yakınımdaki eczaneler';
    default:
      return district ? `${district} eczaneleri` : 'Tüm eczaneler';
  }
}

export const DUTY_STATE_LABEL: Record<PharmacyDutyState, string> = {
  on_duty: 'Şu An Nöbette',
  duty_today_later: 'Bugün Nöbetçi',
  duty_today_ended: 'Bugün Nöbetçi',
  none: 'Nöbetçi Değil',
  unknown: 'Durum Doğrulanamadı',
};
