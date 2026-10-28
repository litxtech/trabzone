export const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).toISOString();

const endOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).toISOString();

/** Tarih girdisini (YYYY-MM-DD veya serbest metin) gün sınırlarına genişletir. */
function boundary(value: string, edge: 'start' | 'end'): string {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }
  return edge === 'start' ? startOfDay(date) : endOfDay(date);
}

export const DATE_PRESETS = [
  { key: 'today', label: 'Bugün', days: 0 },
  { key: 'yesterday', label: 'Dün', days: 1 },
  { key: '7', label: 'Son 7 gün', days: 6 },
  { key: '30', label: 'Son 30 gün', days: 29 },
  { key: '90', label: 'Son 90 gün', days: 89 },
  { key: 'custom', label: 'Özel aralık', days: -1 },
] as const;

export type DatePresetKey = (typeof DATE_PRESETS)[number]['key'];

/**
 * Seçilen aralığı sunucu sorgusu için tam zaman damgalarına çevirir.
 * `to` seçilen günün 23:59:59'una kadar uzanır; aksi halde "Bugün" filtresi
 * gece yarısından sonraki kayıtları dışarıda bırakırdı.
 */
export function dateRangeFor(
  key: DatePresetKey,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  if (key === 'custom') {
    return {
      from: boundary(customFrom, 'start'),
      to: boundary(customTo, 'end'),
    };
  }
  const preset = DATE_PRESETS.find((item) => item.key === key);
  const to = new Date();
  const from = new Date();
  if (key === 'yesterday') {
    to.setDate(to.getDate() - 1);
    from.setDate(from.getDate() - 1);
  } else {
    from.setDate(from.getDate() - (preset?.days ?? 29));
  }
  return { from: startOfDay(from), to: endOfDay(to) };
}

export function defaultCustomRange() {
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: iso(from), to: iso(new Date()) };
}
