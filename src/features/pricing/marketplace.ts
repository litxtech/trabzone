import {
  addVat,
  clampCents,
  extractVat,
  lineTotalCents,
  percentOfCents,
  sumCents,
} from './money';

/**
 * Marketplace sepet/sipariş toplamları.
 *
 * Siparişin gerçek tutarı `market_create_order` RPC'sinde hesaplanır. Bu
 * yardımcılar sepet önizlemesi, satıcı kırılımı, komisyon ve PDF raporları
 * için aynı tam sayı (kuruş) kurallarını uygular.
 */

export type MarketplaceLine = {
  unitPriceCents: number;
  quantity: number;
};

export type MarketplaceTotals = {
  itemCount: number;
  lineCount: number;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  netCents: number;
  vatCents: number;
  totalCents: number;
  commissionCents: number;
  sellerPayoutCents: number;
};

export type MarketplaceTotalsInput = {
  lines: MarketplaceLine[];
  shippingCents?: number | null;
  discountCents?: number | null;
  /** Satıcıdan alınan komisyon, basis-point. */
  commissionBps?: number | null;
  /** Fiyatlar KDV dahil mi? */
  pricesIncludeVat?: boolean;
  vatBps?: number | null;
};

export function marketplaceTotals(input: MarketplaceTotalsInput): MarketplaceTotals {
  const lineCount = input.lines.length;
  const itemCount = input.lines.reduce((total, line) => total + Math.max(0, Math.trunc(line.quantity)), 0);
  const subtotalCents = sumCents(
    input.lines.map((line) => lineTotalCents(line.unitPriceCents, line.quantity)),
  );
  const shippingCents = clampCents(input.shippingCents);
  const discountCents = Math.min(clampCents(input.discountCents), subtotalCents + shippingCents);
  const totalCents = Math.max(0, subtotalCents + shippingCents - discountCents);

  const vat = input.pricesIncludeVat === false
    ? addVat(totalCents, input.vatBps)
    : extractVat(totalCents, input.vatBps);

  const commissionCents = Math.min(totalCents, percentOfCents(totalCents, input.commissionBps));
  const sellerPayoutCents = Math.max(0, totalCents - commissionCents);

  return {
    itemCount,
    lineCount,
    subtotalCents,
    discountCents,
    shippingCents,
    netCents: vat.netCents,
    vatCents: vat.vatCents,
    totalCents,
    commissionCents,
    sellerPayoutCents,
  };
}

/** Sepeti satıcıya göre gruplar; her grubun ara toplamını döndürür. */
export function groupBySeller<T extends { sellerId: string }>(
  items: T[],
): { sellerId: string; items: T[]; subtotalCents: number }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item.sellerId) ?? [];
    list.push(item);
    groups.set(item.sellerId, list);
  }
  return [...groups.entries()].map(([sellerId, sellerItems]) => ({
    sellerId,
    items: sellerItems,
    subtotalCents: sumCents(
      sellerItems.map((item) => {
        const line = item as { priceCents?: number; quantity?: number };
        return lineTotalCents(line.priceCents, line.quantity);
      }),
    ),
  }));
}
