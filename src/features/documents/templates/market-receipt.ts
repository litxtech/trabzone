import {
  formatPrice,
  ORDER_STATUS_LABELS,
  type OrderReceipt,
} from '@/features/marketplace/services/marketplace-service';

import { buildPdfHtml, createDocumentId, formatDateTimeTr } from '../html';
import type { PdfDocumentSpec, PdfTone } from '../types';

function fullName(party: { first_name: string | null; last_name: string | null; username: string }): string {
  const name = `${party.first_name ?? ''} ${party.last_name ?? ''}`.trim();
  return name || party.username;
}

function statusTone(status: string): PdfTone {
  if (status === 'completed' || status === 'delivered') return 'success';
  if (status === 'cancelled' || status === 'rejected') return 'danger';
  if (status === 'shipped' || status === 'confirmed') return 'primary';
  return 'warning';
}

function receiptSpec(receipt: OrderReceipt): PdfDocumentSpec {
  const shipping = [receipt.shipping_address, receipt.shipping_city]
    .filter((part) => part && part.trim())
    .join(', ');
  const rows = receipt.items.map((item) => [
    item.title,
    item.quantity,
    formatPrice(item.unit_price_cents, receipt.currency),
    formatPrice(item.unit_price_cents * item.quantity, receipt.currency),
  ]);

  const totals = [
    { label: 'Ara toplam', value: formatPrice(receipt.subtotal_cents, receipt.currency) },
  ];
  if (receipt.total_cents !== receipt.subtotal_cents) {
    totals.push({ label: 'Toplam', value: formatPrice(receipt.total_cents, receipt.currency) });
  }

  return {
    kind: 'market_receipt',
    title: 'Sipariş fişi',
    subtitle: 'Marketplace sipariş talebinin dijital özeti',
    badge: {
      label: ORDER_STATUS_LABELS[receipt.status] ?? receipt.status,
      tone: statusTone(receipt.status),
    },
    documentId: createDocumentId('market_receipt', receipt.id),
    meta: [
      { label: 'Sipariş no', value: receipt.order_no },
      { label: 'Sipariş tarihi', value: formatDateTimeTr(receipt.created_at) },
      {
        label: 'Ödeme',
        value: receipt.payment_status === 'paid' ? 'Ödendi' : 'Satıcıyla planlanacak',
      },
      { label: 'Ödeme yöntemi', value: receipt.payment_method || '—' },
    ],
    parties: [
      {
        title: 'Satıcı',
        name: fullName(receipt.seller),
        lines: [`@${receipt.seller.username}`],
      },
      {
        title: 'Alıcı',
        name: receipt.contact_name || fullName(receipt.buyer),
        lines: [
          `@${receipt.buyer.username}`,
          receipt.contact_phone ?? '',
          shipping,
        ].filter((line) => line.trim() !== ''),
      },
    ],
    sections: [
      {
        title: 'Ürünler',
        table: {
          columns: [
            { label: 'Ürün', align: 'left' },
            { label: 'Adet', align: 'right', width: '12%' },
            { label: 'Birim', align: 'right', width: '20%' },
            { label: 'Tutar', align: 'right', width: '20%' },
          ],
          rows,
          totals,
          emptyLabel: 'Bu siparişte ürün kaydı bulunmuyor.',
        },
      },
    ],
    notes: receipt.note ? [`Satıcıya not: ${receipt.note}`] : [],
    legalNote:
      'Bu belge Trabzone Marketplace üzerinden oluşturulan sipariş talebinin özetidir. Uygulama içinde ödeme alınmaz; teslimat ve ödeme satıcı ile alıcı arasında planlanır. Belge yasal fatura değildir.',
    footerNote: `Trabzone · Sipariş ${receipt.order_no}`,
  };
}

export function buildMarketReceiptSpec(receipt: OrderReceipt): PdfDocumentSpec {
  return receiptSpec(receipt);
}

export function buildMarketReceiptHtml(receipt: OrderReceipt): string {
  return buildPdfHtml(receiptSpec(receipt));
}
