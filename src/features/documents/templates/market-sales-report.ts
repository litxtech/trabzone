import {
  formatPrice,
  ORDER_STATUS_LABELS,
  type SalesSummary,
} from '@/features/marketplace/services/marketplace-service';
import { summarizeByMonth } from '@/features/pricing/reports';

import { buildPdfHtml, createDocumentId, formatDateTimeTr } from '../html';
import type { PdfDocumentSpec, PdfSectionSpec } from '../types';

export type ReportOrderRow = {
  order_no: string;
  created_at: string;
  status: string;
  total_cents: number;
  currency: string;
  buyer_username: string;
  seller_username: string;
};

export type SalesReportInput = {
  orders: ReportOrderRow[];
  summary: SalesSummary;
  scope: 'mine' | 'all';
  ownerLabel?: string;
};

function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(date);
}

function salesReportSpec(input: SalesReportInput): PdfDocumentSpec {
  const rows = input.orders.map((order) => [
    order.order_no,
    formatDateTimeTr(order.created_at),
    order.buyer_username,
    order.seller_username,
    ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status,
    formatPrice(order.total_cents, order.currency),
  ]);

  const monthly = summarizeByMonth(
    input.orders,
    (order) => order.created_at,
    (order) => order.total_cents,
  );

  const ordersSection: PdfSectionSpec = {
    title: 'Siparişler',
    subtitle: `${input.orders.length} kayıt listeleniyor`,
    table: {
      columns: [
        { label: 'Sipariş', align: 'left' },
        { label: 'Tarih', align: 'left', width: '18%' },
        { label: 'Alıcı', align: 'left', width: '15%' },
        { label: 'Satıcı', align: 'left', width: '15%' },
        { label: 'Durum', align: 'left', width: '14%' },
        { label: 'Tutar', align: 'right', width: '16%' },
      ],
      rows,
      totals: [{ label: 'Listelenen toplam', value: formatPrice(input.summary.gross_cents) }],
      emptyLabel: 'Kayıt yok.',
      compact: true,
    },
  };

  const monthlySections: PdfSectionSpec[] =
    monthly.length > 0
      ? [
          {
            title: 'Aylık dağılım',
            subtitle: 'Bu raporda listelenen siparişlerin ay bazlı toplamı',
            table: {
              columns: [
                { label: 'Ay', align: 'left' },
                { label: 'Sipariş', align: 'right', width: '20%' },
                { label: 'Tutar', align: 'right', width: '30%' },
              ],
              rows: monthly.map((bucket) => [
                monthLabel(bucket.month),
                bucket.trips,
                formatPrice(bucket.cents),
              ]),
              compact: true,
            },
          },
        ]
      : [];

  return {
    kind: 'market_sales',
    title: input.scope === 'all' ? 'Pazar geneli satış raporu' : 'Satış raporum',
    subtitle: 'Sipariş hacmi, tamamlanan işlemler ve ciro özeti',
    badge: { label: input.scope === 'all' ? 'Pazar geneli' : 'Satışlarım', tone: 'primary' },
    documentId: createDocumentId('market_sales', input.ownerLabel ?? input.scope),
    meta: [
      { label: 'Sipariş', value: String(input.summary.order_count) },
      { label: 'Tamamlanan', value: String(input.summary.completed_count) },
      { label: 'Açık talep', value: String(input.summary.open_count) },
      { label: 'Toplam ciro', value: formatPrice(input.summary.gross_cents) },
      { label: 'Tamamlanan ciro', value: formatPrice(input.summary.completed_cents) },
      { label: 'Bu ay', value: formatPrice(input.summary.month_cents) },
    ],
    sections: [ordersSection, ...monthlySections],
    notes: [
      'Tutarlar uygulama içindeki sipariş kayıtlarından üretilir. Doğrulanmış ödeme makbuzları yalnızca ödeme sağlayıcısının onayladığı işlemler için geçerlidir.',
    ],
    footerNote: `Trabzone · ${input.ownerLabel ?? 'Satış raporu'}`,
  };
}

export function buildSalesReportSpec(input: SalesReportInput): PdfDocumentSpec {
  return salesReportSpec(input);
}

export function buildSalesReportHtml(input: SalesReportInput): string {
  return buildPdfHtml(salesReportSpec(input));
}
