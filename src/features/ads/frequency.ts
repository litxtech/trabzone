import type { AdServeConfig } from './types';

/** Basit ve deterministik sözde rastgele sayı (0..1). */
function seeded(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Reklamların kaçıncı organik içerikten sonra yer alacağını hesaplar
 * (AdFrequencyController). Sunucunun güvenli sınırlara oturttuğu config
 * kullanılır; aralık [interval_min, interval_max] içinde oturum tohumuna göre
 * sabit seçilir, böylece yeniden çizimde reklamlar yer değiştirmez.
 *
 * - Listenin son öğesinden sonra reklam konmaz (en az bir organik içerik
 *   reklamın altında kalır).
 * - `columns` > 1 ise konum satır sonuna yuvarlanır; ızgarada yarım satır
 *   bırakılmaz.
 */
export function adPositions(
  config: AdServeConfig,
  organicCount: number,
  options: { seed: number; columns?: number; maxSlots?: number },
): number[] {
  const columns = Math.max(1, options.columns ?? 1);
  const maxSlots = Math.max(0, Math.min(options.maxSlots ?? config.max_per_session, config.max_per_session));
  const intervalMin = Math.max(1, config.interval_min);
  const intervalMax = Math.max(intervalMin, config.interval_max);
  const positions: number[] = [];
  let next = Math.max(1, config.first_after);
  let index = 0;
  while (positions.length < maxSlots) {
    const aligned = Math.ceil(next / columns) * columns;
    if (aligned >= organicCount) {
      break;
    }
    positions.push(aligned);
    const span = intervalMin + Math.floor(seeded(options.seed, index) * (intervalMax - intervalMin + 1));
    next = aligned + span;
    index += 1;
  }
  return positions;
}

export type AdRow<T> =
  | { type: 'item'; key: string; item: T; index: number }
  | { type: 'ad'; key: string; after: number };

/** Organik öğeleri ve reklam konumlarını tek bir satır dizisinde birleştirir. */
export function interleaveRows<T>(
  items: readonly T[],
  positions: readonly number[],
  getKey: (item: T) => string,
): AdRow<T>[] {
  const rows: AdRow<T>[] = [];
  let cursor = 0;
  items.forEach((item, index) => {
    rows.push({ type: 'item', key: getKey(item), item, index });
    const position = positions[cursor];
    if (position !== undefined && position === index + 1) {
      rows.push({ type: 'ad', key: `ad-slot-${position}`, after: position });
      cursor += 1;
    }
  });
  return rows;
}
