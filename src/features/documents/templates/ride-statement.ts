import { sumCents } from '@/features/pricing/money';
import { summarizeByMonth } from '@/features/pricing/reports';
import type { RideReservation } from '@/features/ride/types';
import {
  formatDate,
  formatMoney,
  RESERVATION_STATUS_LABEL,
} from '@/features/ride/utils/format';

import { buildPdfHtml, createDocumentId } from '../html';
import type { PdfDocumentSpec, PdfSectionSpec } from '../types';

export type RideStatementScope = 'all' | 'completed' | 'cancelled' | 'driver';

export type RideStatementInput = {
  trips: RideReservation[];
  userId: string;
  scope?: RideStatementScope;
  ownerLabel?: string;
};

const SCOPE_LABEL: Record<RideStatementScope, string> = {
  all: 'Tüm yolculuklar',
  completed: 'Tamamlanan yolculuklar',
  cancelled: 'İptal edilen yolculuklar',
  driver: 'Sürücü kayıtları',
};

const PAYMENT_LABEL: Record<RideReservation['payment_status'], string> = {
  paid: 'Ödendi',
  unpaid: 'Ödenmedi',
  pending: 'Bekliyor',
  refunded: 'İade edildi',
  failed: 'Başarısız',
};

function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(date);
}

function statementSpec(input: RideStatementInput): PdfDocumentSpec {
  const scope = input.scope ?? 'all';
  const trips =
    scope === 'driver'
      ? input.trips.filter((trip) => trip.driver_id === input.userId)
      : scope === 'all'
        ? input.trips
        : input.trips.filter((trip) => trip.status === scope);

  const completed = trips.filter((trip) => trip.status === 'completed');
  const spending = completed
    .filter((trip) => trip.passenger_id === input.userId && trip.payment_status === 'paid')
    .reduce((total, trip) => total + trip.total_cents, 0);
  const earnings = completed
    .filter((trip) => trip.driver_id === input.userId && trip.payment_status === 'paid')
    .reduce((total, trip) => total + trip.total_cents, 0);
  const refunded = trips
    .filter((trip) => trip.payment_status === 'refunded')
    .reduce((total, trip) => total + trip.total_cents, 0);

  const monthly = summarizeByMonth(
    completed,
    (trip) => trip.depart_at,
    (trip) => trip.total_cents,
  );

  const tripsSection: PdfSectionSpec = {
    title: 'Yolculuklar',
    subtitle: `${trips.length} kayıt listeleniyor`,
    table: {
      columns: [
        { label: 'Tarih', align: 'left', width: '14%' },
        { label: 'Güzergâh', align: 'left' },
        { label: 'Rol', align: 'left', width: '9%' },
        { label: 'Koltuk', align: 'right', width: '8%' },
        { label: 'Tutar', align: 'right', width: '14%' },
        { label: 'Ödeme', align: 'left', width: '11%' },
        { label: 'Durum', align: 'left', width: '11%' },
      ],
      rows: trips.map((trip) => [
        formatDate(trip.depart_at),
        `${trip.origin_label} → ${trip.dest_label}`,
        trip.driver_id === input.userId ? 'Sürücü' : 'Yolcu',
        trip.seats,
        formatMoney(trip.total_cents, trip.currency),
        PAYMENT_LABEL[trip.payment_status],
        RESERVATION_STATUS_LABEL[trip.status] ?? trip.status,
      ]),
      totals: [
        {
          label: 'Listelenen toplam',
          value: formatMoney(sumCents(trips.map((trip) => trip.total_cents))),
        },
      ],
      emptyLabel: 'Bu kapsamda yolculuk kaydı bulunmuyor.',
      compact: true,
    },
  };

  const monthlySections: PdfSectionSpec[] =
    monthly.length > 0
      ? [
          {
            title: 'Aylık istatistikler',
            subtitle: 'Tamamlanan yolculukların ay bazlı toplamı',
            table: {
              columns: [
                { label: 'Ay', align: 'left' },
                { label: 'Yolculuk', align: 'right', width: '20%' },
                { label: 'Tutar', align: 'right', width: '30%' },
              ],
              rows: monthly.map((bucket) => [
                monthLabel(bucket.month),
                bucket.trips,
                formatMoney(bucket.cents),
              ]),
              compact: true,
            },
          },
        ]
      : [];

  return {
    kind: 'ride_statement',
    title: 'Yolculuk hesap özeti',
    subtitle: 'Dijital yolculuk kayıtları, ödeme durumları ve aylık toplamlar',
    badge: { label: SCOPE_LABEL[scope], tone: 'primary' },
    documentId: createDocumentId('ride_statement', `${input.userId}-${scope}`),
    meta: [
      { label: 'Kayıt', value: String(trips.length) },
      { label: 'Tamamlanan', value: String(completed.length) },
      { label: 'İptal', value: String(trips.filter((trip) => trip.status === 'cancelled').length) },
      { label: 'Harcama', value: formatMoney(spending) },
      { label: 'Tahsilat', value: formatMoney(earnings) },
      { label: 'İade', value: formatMoney(refunded) },
    ],
    sections: [tripsSection, ...monthlySections],
    notes: [
      'Bu ekran yolculuk özeti ve kişisel raporlama içindir. PDF çıktısı yasal fatura değildir; doğrulanmış ödeme makbuzları yalnızca ödeme sağlayıcısının kayıtlarıyla eşleşen işlemler için üretilir.',
    ],
    footerNote: `Trabzone · ${input.ownerLabel ?? 'Yolculuk hesap özeti'}`,
  };
}

export function buildRideStatementSpec(input: RideStatementInput): PdfDocumentSpec {
  return statementSpec(input);
}

export function buildRideStatementHtml(input: RideStatementInput): string {
  return buildPdfHtml(statementSpec(input));
}
