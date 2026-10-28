/**
 * Para hesaplarının tek kaynağı.
 *
 * Uygulamadaki tüm tutarlar kuruş (integer) cinsinden tutulur. Ondalık
 * aritmetiği doğrudan yapmak 0,1 + 0,2 gibi yuvarlama hataları üretir; bu
 * yüzden yüzde, KDV ve paylaştırma işlemleri burada integer üzerinden
 * yapılır. Sunucu (Supabase RPC'leri) nihai kaynak olmaya devam eder; bu
 * yardımcılar önizleme, rapor ve PDF toplamları içindir.
 */

export const BPS_DENOMINATOR = 10_000;

/** Sonlu olmayan veya kesirli girişleri güvenli tam sayıya çevirir. */
export function safeInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.trunc(value);
}

export function clampCents(value: number | null | undefined, min = 0): number {
  const cents = safeInt(value);
  return cents < min ? min : cents;
}

/** Adet × birim fiyat. Negatif adet stok/sipariş hesabını bozmasın. */
export function lineTotalCents(unitPriceCents: number | null | undefined, quantity: number | null | undefined): number {
  return safeInt(unitPriceCents) * Math.max(0, safeInt(quantity));
}

export function sumCents(values: Iterable<number | null | undefined>): number {
  let total = 0;
  for (const value of values) {
    total += safeInt(value);
  }
  return total;
}

/** Kuruş tutarın basis-point (1/10000) karşılığı. */
export function percentOfCents(cents: number | null | undefined, bps: number | null | undefined): number {
  return Math.round((safeInt(cents) * safeInt(bps)) / BPS_DENOMINATOR);
}

export function bpsFromPercent(percent: number | null | undefined): number {
  if (percent == null || !Number.isFinite(percent)) {
    return 0;
  }
  return Math.round(percent * 100);
}

/** KDV hariç tutardan KDV ve brüt tutar. */
export function addVat(netCents: number | null | undefined, vatBps: number | null | undefined) {
  const net = clampCents(netCents);
  const vat = percentOfCents(net, vatBps);
  return { netCents: net, vatCents: vat, grossCents: net + vat };
}

/**
 * KDV dahil tutardan KDV'yi ayırır. Yuvarlama farkı brüt tutarda kalır;
 * böylece net + KDV her zaman brüt tutara eşit olur.
 */
export function extractVat(grossCents: number | null | undefined, vatBps: number | null | undefined) {
  const gross = clampCents(grossCents);
  const bps = Math.max(0, safeInt(vatBps));
  if (bps === 0) {
    return { netCents: gross, vatCents: 0, grossCents: gross };
  }
  const net = Math.round((gross * BPS_DENOMINATOR) / (BPS_DENOMINATOR + bps));
  return { netCents: net, vatCents: gross - net, grossCents: gross };
}

/**
 * Bir toplamı ağırlıklara göre kuruş kaybı olmadan paylaştırır.
 * En büyük kalan yöntemi kullanılır: payların toplamı her zaman `totalCents`.
 */
export function allocateCents(totalCents: number | null | undefined, weights: number[]): number[] {
  const total = clampCents(totalCents);
  const safeWeights = weights.map((weight) => Math.max(0, Number.isFinite(weight) ? weight : 0));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (safeWeights.length === 0 || weightTotal <= 0 || total === 0) {
    return safeWeights.map(() => 0);
  }

  const exact = safeWeights.map((weight) => (total * weight) / weightTotal);
  const base = exact.map((value) => Math.floor(value));
  let remainder = total - base.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const item of order) {
    if (remainder <= 0) break;
    const current = base[item.index];
    if (current == null) continue;
    base[item.index] = current + 1;
    remainder -= 1;
  }

  return base;
}

/**
 * "1.234,56", "1234,56", "1234.56", "₺ 1.234" gibi girişleri kuruşa çevirir.
 * Geçersiz veya negatif girişte `null` döner (sessizce 0 üretmez).
 */
export function parseMoneyToCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  const raw = input.trim().replace(/\s+/g, '').replace(/₺|TL/gi, '');
  if (!raw) return null;
  if (!/^[0-9.,]+$/.test(raw)) return null;

  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  let normalized = raw;

  if (comma >= 0 && dot >= 0) {
    if (comma > dot) {
      normalized = raw.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = raw.replace(/,/g, '');
    }
  } else if (comma >= 0) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (dot >= 0) {
    const parts = raw.split('.');
    const last = parts[parts.length - 1] ?? '';
    // "1.234" ve "1.234.567" binlik ayırıcı; "12.5" / "12.50" ondalık.
    if (parts.length > 2 || last.length === 3) {
      normalized = parts.join('');
    }
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Kuruşu yerel ondalık ayırıcı ile "1234,56" biçiminde döndürür. */
export function centsToInput(cents: number | null | undefined): string {
  const value = clampCents(cents) / 100;
  return value.toFixed(2).replace('.', ',');
}

/** Rapor/PDF gibi yerlerde kullanılan sade TRY biçimlendirici. */
export function formatCentsTr(cents: number | null | undefined, currency = 'TRY'): string {
  const value = safeInt(cents) / 100;
  const formatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  return currency === 'TRY' ? `${formatted} ₺` : `${formatted} ${currency}`;
}

/** Yüzde büyümesini raporlar; önceki değer 0 ise büyüme tanımsızdır. */
export function growthPercent(previous: number | null | undefined, current: number | null | undefined): number | null {
  const before = Number(previous ?? 0);
  const after = Number(current ?? 0);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) {
    return null;
  }
  return ((after - before) / Math.abs(before)) * 100;
}
