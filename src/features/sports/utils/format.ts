import type { EventKind, Fixture, MatchEvent, MatchPhase, Side, StatKey, TeamStats } from '../types';

const TZ = 'Europe/Istanbul';

export const NO_DATA = 'Veri mevcut değil';

const PHASE_LABELS: Record<MatchPhase, string> = {
  scheduled: 'Başlamadı',
  first_half: 'İlk yarı',
  half_time: 'Devre arası',
  second_half: 'İkinci yarı',
  extra_time: 'Uzatmalar',
  break_time: 'Uzatma arası',
  penalties: 'Penaltılar',
  suspended: 'Askıya alındı',
  interrupted: 'Durduruldu',
  live: 'Canlı',
  finished: 'Maç sonu',
  finished_aet: 'Uzatmalar sonu',
  finished_pen: 'Penaltılar sonu',
  postponed: 'Ertelendi',
  cancelled: 'İptal edildi',
  abandoned: 'Yarıda kaldı',
  awarded: 'Hükmen',
  walkover: 'Hükmen (rakip çıkmadı)',
  unknown: 'Durum bilinmiyor',
};

export function phaseLabel(phase: MatchPhase): string {
  return PHASE_LABELS[phase] ?? PHASE_LABELS.unknown;
}

export function minuteLabel(minute: number | null, extra: number | null): string {
  if (minute == null) return '';
  return extra ? `${minute}+${extra}'` : `${minute}'`;
}

/** Saat yalnızca sağlayıcının bildirdiği dakikadır; istemcide sahte saat işletilmez. */
export function liveClock(fixture: Fixture): string {
  const { phase, elapsed, extra } = fixture.status;
  if (phase === 'half_time') return 'DA';
  if (phase === 'break_time') return 'Ara';
  if (phase === 'penalties') return 'Pen.';
  if (elapsed == null) return phaseLabel(phase);
  return minuteLabel(elapsed, extra);
}

export function statusLine(fixture: Fixture): string {
  if (fixture.status.is_live) return `${phaseLabel(fixture.status.phase)} · ${liveClock(fixture)}`;
  if (fixture.status.phase === 'scheduled') return kickoffLabel(fixture.kickoff_at);
  return phaseLabel(fixture.status.phase);
}

export function kickoffLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const dayKey = (value: Date) => value.toLocaleDateString('tr-TR', { timeZone: TZ });
  const time = date.toLocaleTimeString('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (dayKey(date) === dayKey(now)) return `Bugün ${time}`;
  if (dayKey(date) === dayKey(tomorrow)) return `Yarın ${time}`;
  return `${date.toLocaleDateString('tr-TR', { timeZone: TZ, day: 'numeric', month: 'long', weekday: 'short' })} ${time}`;
}

/** İstanbul saatine göre takvim günü anahtarı; aynı güne düşen maçlar birlikte gruplanır. */
export function matchDayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('tr-TR', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** Maç günü kartı parçaları: "Cmt" · "1" · "Kas" ve saat. */
export function matchDayParts(iso: string): { weekday: string; day: string; month: string; time: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { weekday: '', day: '', month: '', time: '' };
  return {
    weekday: date.toLocaleDateString('tr-TR', { timeZone: TZ, weekday: 'short' }),
    day: date.toLocaleDateString('tr-TR', { timeZone: TZ, day: 'numeric' }),
    month: date.toLocaleDateString('tr-TR', { timeZone: TZ, month: 'short' }),
    time: date.toLocaleTimeString('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
  };
}

/** Liste gün başlığı: "Bugün", "Yarın", "Dün" ya da "Cumartesi, 1 Kasım". */
export function matchDayHeading(iso: string): string {
  const key = matchDayKey(iso);
  const now = Date.now();
  if (key === matchDayKey(new Date(now).toISOString())) return 'Bugün';
  if (key === matchDayKey(new Date(now + 86_400_000).toISOString())) return 'Yarın';
  if (key === matchDayKey(new Date(now - 86_400_000).toISOString())) return 'Dün';
  return new Date(iso).toLocaleDateString('tr-TR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
}

export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('tr-TR', { timeZone: TZ, day: '2-digit', month: 'short' });
}

/**
 * Başlama saatine kalan süre. Son bir saatte saniye duyarlı `mm:ss` biçimine
 * geçer; daha uzak maçlarda saat/gün cinsinden kaba bir etiket döner.
 */
export function countdownClock(iso: string, now = Date.now()): string | null {
  const diff = new Date(iso).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const total = Math.floor(diff / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days} gün ${hours} sa`;
  if (hours > 0) return `${hours} sa ${String(minutes).padStart(2, '0')} dk`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function countdownLabel(iso: string, now = Date.now()): string | null {
  const diff = new Date(iso).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} dk sonra`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa ${minutes % 60} dk sonra`;
  return `${Math.floor(hours / 24)} gün sonra`;
}

export function relativeAge(iso: string | null): string {
  if (!iso) return 'henüz güncellenmedi';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 20) return 'az önce';
  if (seconds < 60) return `${seconds} sn önce`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return shortDate(iso);
}

export function scoreText(value: number | null): string {
  return value == null ? '–' : String(value);
}

export function otherSide(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

export function opponentName(fixture: Fixture): string {
  return (fixture.primary_side === 'home' ? fixture.away.name : fixture.home.name) ?? 'Rakip';
}

export function matchTitle(fixture: Fixture): string {
  return `${fixture.home.name ?? 'Ev sahibi'} – ${fixture.away.name ?? 'Deplasman'}`;
}

export function scoreLine(fixture: Fixture): string {
  if (fixture.status.phase === 'scheduled' || fixture.goals.home == null) return matchTitle(fixture);
  return `${fixture.home.name} ${fixture.goals.home}-${fixture.goals.away} ${fixture.away.name}`;
}

/** Trabzonspor perspektifinden sonuç (G/B/M); bitmemişse null. */
export function resultFor(fixture: Fixture): 'W' | 'D' | 'L' | null {
  if (!fixture.status.is_finished || fixture.goals.home == null || fixture.goals.away == null) return null;
  const mine = fixture.primary_side === 'home' ? fixture.goals.home : fixture.goals.away;
  const theirs = fixture.primary_side === 'home' ? fixture.goals.away : fixture.goals.home;
  return mine > theirs ? 'W' : mine === theirs ? 'D' : 'L';
}

const EVENT_LABELS: Record<EventKind, string> = {
  goal: 'Gol',
  own_goal: 'Kendi kalesine gol',
  penalty_goal: 'Penaltı golü',
  missed_penalty: 'Kaçan penaltı',
  shootout_goal: 'Seri penaltı golü',
  shootout_miss: 'Seri penaltı kaçtı',
  yellow: 'Sarı kart',
  red: 'Kırmızı kart',
  second_yellow: 'İkinci sarıdan kırmızı',
  substitution: 'Oyuncu değişikliği',
  var: 'VAR',
  other: 'Olay',
};

export function eventLabel(event: Pick<MatchEvent, 'kind' | 'detail'>): string {
  if (event.kind === 'var' && event.detail) {
    if (/cancel/i.test(event.detail)) return 'VAR · Gol iptal';
    if (/penalty confirmed/i.test(event.detail)) return 'VAR · Penaltı onaylandı';
    if (/penalty cancel/i.test(event.detail)) return 'VAR · Penaltı iptal';
    return `VAR · ${event.detail}`;
  }
  return EVENT_LABELS[event.kind] ?? EVENT_LABELS.other;
}

export function isGoalKind(kind: EventKind): boolean {
  return kind === 'goal' || kind === 'own_goal' || kind === 'penalty_goal';
}

export const STAT_ROWS: { key: StatKey; label: string; percent?: boolean; decimals?: number }[] = [
  { key: 'ball_possession', label: 'Topla oynama', percent: true },
  { key: 'expected_goals', label: 'Gol beklentisi (xG)', decimals: 2 },
  { key: 'total_shots', label: 'Toplam şut' },
  { key: 'shots_on_goal', label: 'İsabetli şut' },
  { key: 'shots_off_goal', label: 'İsabetsiz şut' },
  { key: 'blocked_shots', label: 'Engellenen şut' },
  { key: 'shots_insidebox', label: 'Ceza sahası içi şut' },
  { key: 'shots_outsidebox', label: 'Ceza sahası dışı şut' },
  { key: 'corner_kicks', label: 'Korner' },
  { key: 'offsides', label: 'Ofsayt' },
  { key: 'fouls', label: 'Faul' },
  { key: 'yellow_cards', label: 'Sarı kart' },
  { key: 'red_cards', label: 'Kırmızı kart' },
  { key: 'goalkeeper_saves', label: 'Kaleci kurtarışı' },
  { key: 'total_passes', label: 'Toplam pas' },
  { key: 'passes_accurate', label: 'İsabetli pas' },
  { key: 'passes_pct', label: 'Pas isabeti', percent: true },
  { key: 'goals_prevented', label: 'Önlenen gol', decimals: 2 },
];

export function statValue(stats: TeamStats | null | undefined, key: StatKey): number | null | undefined {
  if (!stats || !(key in stats)) return undefined;
  return stats[key] ?? null;
}

export function formatStat(value: number | null | undefined, row: { percent?: boolean; decimals?: number }): string {
  if (value == null) return '—';
  const text = row.decimals ? value.toFixed(row.decimals) : String(Math.round(value * 100) / 100);
  return row.percent ? `%${text}` : text;
}
