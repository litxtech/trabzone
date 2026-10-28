import { clampCents, percentOfCents, safeInt } from './money';

/**
 * Yolculuk bedeli yardımcıları.
 *
 * `estimateRideFare` sunucudaki `ride_price_hint` fonksiyonunun formülünü
 * birebir yansıtır: mesafe (km) × km başına maliyet ÷ koltuk sayısı.
 * Buradaki değerler yalnızca önizlemedir; yayınlanan ilan ve rezervasyon
 * tutarı her zaman sunucudaki kayıttır. Yasal bir fiyat sınırı değildir.
 */

export const RIDE_FARE_FORMULA = 'mesafe_km × km_başına_maliyet ÷ koltuk_sayısı';
export const RIDE_FARE_NOTE =
  'Bu bir yardımcı maliyet tahminidir; yasal fiyat sınırı veya zorunlu tarife değildir.';

export type RideFareEstimate =
  | {
      available: true;
      distanceMeters: number;
      distanceKm: number;
      seats: number;
      estimatedCostCents: number;
      perSeatCents: number;
      suggestedMinCents: number;
      suggestedMaxCents: number;
      formula: string;
      note: string;
    }
  | { available: false; reason: string };

export function estimateRideFare(input: {
  distanceMeters: number | null | undefined;
  costPerKmCents: number | null | undefined;
  seats?: number | null;
}): RideFareEstimate {
  const distance = Number(input.distanceMeters ?? 0);
  if (!Number.isFinite(distance) || distance <= 0) {
    return { available: false, reason: 'Mesafe bilgisi yok. Güzergâh koordinatları girilmedi.' };
  }

  const costPerKm = Number(input.costPerKmCents ?? 0);
  if (!Number.isFinite(costPerKm) || costPerKm <= 0) {
    return {
      available: false,
      reason: 'Yönetici maliyet ayarını (km başına kuruş) tanımlamadığı için tahmin üretilmedi.',
    };
  }

  const seats = Math.max(1, safeInt(input.seats ?? 3));
  const distanceKmRaw = distance / 1000;
  const total = distanceKmRaw * costPerKm;
  const perSeat = Math.ceil(total / seats);

  return {
    available: true,
    distanceMeters: Math.round(distance),
    distanceKm: Math.round(distanceKmRaw * 10) / 10,
    seats,
    estimatedCostCents: Math.round(total),
    perSeatCents: perSeat,
    suggestedMinCents: Math.floor(perSeat * 0.85),
    suggestedMaxCents: Math.ceil(perSeat * 1.15),
    formula: RIDE_FARE_FORMULA,
    note: RIDE_FARE_NOTE,
  };
}

export type RideSettlementInput = {
  pricePerSeatCents: number | null | undefined;
  seats: number | null | undefined;
  /** Platform komisyonu, basis-point (örn. %10 = 1000). */
  commissionBps?: number | null;
  /** Kartlı ödeme hizmet bedeli, basis-point. */
  serviceFeeBps?: number | null;
  /** Toplam üzerinden KDV, basis-point (örn. %20 = 2000). */
  vatBps?: number | null;
  /** Köprü/otoyol gibi yansıtılan ek maliyet. */
  tollCents?: number | null;
};

export type RideSettlement = {
  seatsTotalCents: number;
  tollCents: number;
  grossCents: number;
  serviceFeeCents: number;
  commissionCents: number;
  vatCents: number;
  platformRevenueCents: number;
  driverPayoutCents: number;
};

/**
 * Rezervasyon tutarından platform geliri ve sürücüye aktarılacak tutarı
 * hesaplar. Ödeme sağlayıcısı etkin değilken bu değerler yalnızca finans
 * raporu önizlemesidir; gerçek para hareketi oluşturmaz.
 */
export function computeRideSettlement(input: RideSettlementInput): RideSettlement {
  const seats = Math.max(0, safeInt(input.seats));
  const seatsTotalCents = clampCents(safeInt(input.pricePerSeatCents) * seats);
  const tollCents = clampCents(input.tollCents);
  const grossCents = seatsTotalCents + tollCents;
  const serviceFeeCents = percentOfCents(grossCents, input.serviceFeeBps);
  const commissionCents = percentOfCents(grossCents, input.commissionBps);
  const vatCents = percentOfCents(serviceFeeCents + commissionCents, input.vatBps);
  const platformRevenueCents = serviceFeeCents + commissionCents + vatCents;
  const driverPayoutCents = Math.max(0, grossCents - platformRevenueCents);

  return {
    seatsTotalCents,
    tollCents,
    grossCents,
    serviceFeeCents,
    commissionCents,
    vatCents,
    platformRevenueCents,
    driverPayoutCents,
  };
}

/**
 * İptal/iade önizlemesi. `penaltyBps` yönetici tarafından tanımlanmadıysa
 * ceza uydurulmaz; yalnızca ödenen tutar iade edilebilir olarak gösterilir.
 */
export function previewRefund(input: {
  paidCents: number | null | undefined;
  penaltyBps?: number | null;
  alreadyRefundedCents?: number | null;
}): { refundableCents: number; penaltyCents: number } {
  const paid = clampCents(input.alreadyRefundedCents) > 0
    ? Math.max(0, clampCents(input.paidCents) - clampCents(input.alreadyRefundedCents))
    : clampCents(input.paidCents);
  const penaltyCents = Math.min(paid, percentOfCents(paid, input.penaltyBps));
  return { refundableCents: Math.max(0, paid - penaltyCents), penaltyCents };
}
