import { safeInt } from './money';

/**
 * Yolculuk koltuk kapasitesi hesapları.
 *
 * Yolculuklar durak aralıklarına (segment) bölünür: bir yolcu 1 → 3 arası
 * binerken başka bir yolcu 2 → 4 arasını kullanabilir. Bu nedenle toplam
 * koltuk sayısı değil, kullanılacak aralığa denk gelen segmentlerin en dar
 * kapasitesi geçerlidir. Sunucu (`ride_offer_availability`) nihai kaynaktır;
 * bu yardımcılar seçim ekranı, koltuk planı ve PDF özetleri için aynı
 * kuralları uygular.
 */

export type SeatSegment = {
  from_seq: number;
  to_seq: number;
  occupied?: number | null;
  available?: number | null;
};

export type SeatAllocationRange = { from_seq: number; to_seq: number };

export type SeatAvailabilityLike = {
  seats_total: number;
  segments?: SeatSegment[] | null;
  seats?: { seat_no: number; occupied: SeatAllocationRange[] }[] | null;
};

/** İki durak aralığı kesişiyor mu? Sınırlar dışlayıcıdır (seq noktaları). */
export function rangesOverlap(
  range: SeatAllocationRange | null | undefined,
  fromSeq: number,
  toSeq: number,
): boolean {
  if (!range) return false;
  const from = safeInt(fromSeq);
  const to = safeInt(toSeq);
  if (to <= from) return false;
  return !(safeInt(range.from_seq) >= to || safeInt(range.to_seq) <= from);
}

/** Verilen aralıkta dolu olan koltuk numaraları. */
export function occupiedSeatNumbers(
  availability: SeatAvailabilityLike | null | undefined,
  fromSeq: number,
  toSeq: number,
): number[] {
  if (!availability?.seats?.length) return [];
  const occupied = new Set<number>();
  for (const seat of availability.seats) {
    if (!Array.isArray(seat.occupied)) continue;
    if (seat.occupied.some((range) => rangesOverlap(range, fromSeq, toSeq))) {
      const seatNo = safeInt(seat.seat_no);
      if (seatNo > 0) occupied.add(seatNo);
    }
  }
  return [...occupied].sort((a, b) => a - b);
}

export function occupiedSeatSet(
  availability: SeatAvailabilityLike | null | undefined,
  fromSeq: number,
  toSeq: number,
): Set<number> {
  return new Set(occupiedSeatNumbers(availability, fromSeq, toSeq));
}

/**
 * Seçilen durak aralığında rezerve edilebilecek en fazla koltuk sayısı.
 *
 * Segment bilgisi yoksa araç kapasitesi döner; böylece eksik veri yüzünden
 * rezervasyon ekranı kilitlenmez. Hiçbir segment aralıkla kesişmiyorsa yine
 * araç kapasitesi kullanılır.
 */
export function availableSeatCount(
  availability: SeatAvailabilityLike | null | undefined,
  fromSeq: number,
  toSeq: number,
): number {
  const total = Math.max(0, safeInt(availability?.seats_total));
  if (!availability) return 0;
  const segments = (availability.segments ?? []).filter((segment) =>
    rangesOverlap({ from_seq: segment.from_seq, to_seq: segment.to_seq }, fromSeq, toSeq),
  );
  if (!segments.length) return total;

  let minimum = total;
  for (const segment of segments) {
    const value = segment.available != null
      ? safeInt(segment.available)
      : total - safeInt(segment.occupied);
    minimum = Math.min(minimum, value);
  }
  return Math.max(0, Math.min(minimum, total));
}

/**
 * Kullanıcının seçimi aralık kapasitesine ve koltuk doluluğuna göre süzer.
 * Sıra korunur; aynı koltuk bir kez döner.
 */
export function normalizeSeatSelection(input: {
  selected: number[];
  seatsTotal: number;
  capacity?: number;
  occupied?: Iterable<number>;
}): number[] {
  const total = Math.max(0, safeInt(input.seatsTotal));
  const limit = Math.max(0, safeInt(input.capacity ?? total));
  const occupied = new Set(input.occupied ?? []);
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of input.selected) {
    const seat = safeInt(value);
    if (seat < 1 || seat > total || occupied.has(seat) || seen.has(seat)) continue;
    seen.add(seat);
    result.push(seat);
    if (result.length >= limit) break;
  }
  return result;
}

/** Doluluk oranı (0-100). Kapasite yoksa `null`; uydurma değer üretilmez. */
export function occupancyPercent(
  seatsTotal: number | null | undefined,
  occupied: number | null | undefined,
): number | null {
  const total = safeInt(seatsTotal);
  if (total <= 0) return null;
  const used = Math.min(total, Math.max(0, safeInt(occupied)));
  return Math.round((used / total) * 100);
}

/** Yolculuk boyunca toplam kaç koltuk-km kullanıldığını hesaplar. */
export function seatSegmentUsage(
  segments: SeatSegment[] | null | undefined,
): { seats: number; seatSegments: number } {
  let seats = 0;
  let seatSegments = 0;
  for (const segment of segments ?? []) {
    const length = Math.max(0, safeInt(segment.to_seq) - safeInt(segment.from_seq));
    const occupied = Math.max(0, safeInt(segment.occupied));
    seats += occupied;
    seatSegments += occupied * Math.max(1, length);
  }
  return { seats, seatSegments };
}
