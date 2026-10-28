import { sumCents } from './money';

/**
 * Rapor/PDF toplamları.
 *
 * Yönetim raporları `unknown` satırlar döndürür; bu yardımcılar yalnızca
 * sonlu sayıları toplar ve eksik/bozuk değerleri sessizce atlar.
 */

export function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function sumNumericColumn(rows: Record<string, unknown>[], key: string): number | null {
  let seen = false;
  let total = 0;
  for (const row of rows) {
    const value = numericValue(row[key]);
    if (value == null) continue;
    seen = true;
    total += value;
  }
  return seen ? total : null;
}

export type ReportColumnTotal = { key: string; label: string; total: number };

export function columnTotals(
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
  options?: { onlyCentsLike?: boolean },
): ReportColumnTotal[] {
  const totals: ReportColumnTotal[] = [];
  for (const column of columns) {
    if (options?.onlyCentsLike && !/cents|_minor|amount|price|total/i.test(column.key)) {
      continue;
    }
    const total = sumNumericColumn(rows, column.key);
    if (total != null) {
      totals.push({ key: column.key, label: column.label, total });
    }
  }
  return totals;
}

export function reportSummary(rows: Record<string, unknown>[]) {
  const centsValues: number[] = [];
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (!/(cents|amount|price|total)/i.test(key)) continue;
      const numeric = numericValue(value);
      if (numeric != null) centsValues.push(numeric);
    }
  }
  return {
    rowCount: rows.length,
    centsTotal: sumCents(centsValues),
    hasCents: centsValues.length > 0,
  };
}

export function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const value = iso.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(value) ? value : null;
}

export type MonthBucket = { month: string; trips: number; cents: number };

export function summarizeByMonth<T>(
  rows: T[],
  getDate: (row: T) => string | null | undefined,
  getCents: (row: T) => number | null | undefined,
): MonthBucket[] {
  const buckets = new Map<string, MonthBucket>();
  for (const row of rows) {
    const key = monthKey(getDate(row));
    if (!key) continue;
    const bucket = buckets.get(key) ?? { month: key, trips: 0, cents: 0 };
    bucket.trips += 1;
    bucket.cents += Math.trunc(getCents(row) ?? 0);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}
