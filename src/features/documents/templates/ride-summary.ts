import type { RideReservation } from '@/features/ride/types';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatMoney,
  MODE_LABEL,
  RESERVATION_STATUS_LABEL,
  SCOPE_LABEL,
} from '@/features/ride/utils/format';

import { buildPdfHtml, createDocumentId, formatDateTimeTr } from '../html';
import type { PdfDocumentSpec, PdfTone } from '../types';

export type RideSummaryInput = {
  reservation: RideReservation;
  isDriver?: boolean;
  distanceMeters?: number | null;
  durationMinutes?: number | null;
  ownerLabel?: string;
};

const PAYMENT_LABEL: Record<RideReservation['payment_status'], string> = {
  paid: 'Ödendi',
  unpaid: 'Ödenmedi',
  pending: 'Bekliyor',
  refunded: 'İade edildi',
  failed: 'Başarısız',
};

function statusTone(status: RideReservation['status']): PdfTone {
  if (status === 'completed') return 'success';
  if (status === 'cancelled' || status === 'rejected' || status === 'expired' || status === 'disputed') {
    return 'danger';
  }
  if (status === 'started') return 'primary';
  return 'warning';
}

function passengerName(reservation: RideReservation): string {
  return reservation.passenger_first_name || reservation.passenger_username || 'Yolcu';
}

function rideSummarySpec(input: RideSummaryInput): PdfDocumentSpec {
  const { reservation } = input;
  const driverName =
    [reservation.driver_first_name, reservation.driver_username].filter(Boolean).join(' ') ||
    reservation.driver_username;
  const vehicle = reservation.vehicle;
  const passengers =
    reservation.passengers.length > 0
      ? reservation.passengers.map((passenger) => [
          passenger.full_name,
          passenger.seat_no,
          passenger.boarded_at ? formatDateTimeTr(passenger.boarded_at) : '—',
          passenger.alighted_at ? formatDateTimeTr(passenger.alighted_at) : '—',
          passenger.is_primary ? 'Birincil' : '',
        ])
      : [[passengerName(reservation), '—', '—', '—', 'Birincil']];

  return {
    kind: 'ride_summary',
    title: 'Yolculuk özeti',
    subtitle: `${reservation.origin_label} → ${reservation.dest_label}`,
    badge: {
      label: RESERVATION_STATUS_LABEL[reservation.status] ?? reservation.status,
      tone: statusTone(reservation.status),
    },
    documentId: createDocumentId('ride_summary', reservation.id),
    meta: [
      { label: 'Rezervasyon', value: reservation.id.slice(0, 8).toUpperCase() },
      { label: 'Kalkış', value: formatDateTime(reservation.depart_at) },
      { label: 'Tür', value: `${SCOPE_LABEL[reservation.scope]} · ${MODE_LABEL[reservation.mode]}` },
      { label: 'Koltuk', value: `${reservation.seats} koltuk` },
      { label: 'Ödeme', value: PAYMENT_LABEL[reservation.payment_status] },
      { label: 'Oluşturulma', value: formatDateTimeTr(reservation.created_at) },
    ],
    parties: [
      {
        title: input.isDriver ? 'Sürücü (siz)' : 'Sürücü',
        name: driverName,
        lines: [
          `@${reservation.driver_username}`,
          reservation.driver_verified ? 'Kimliği doğrulanmış' : 'Doğrulama bekliyor',
          `${vehicle.make} ${vehicle.model} · ${vehicle.year}`,
          vehicle.plate,
        ].filter((line) => line.trim() !== ''),
      },
      {
        title: 'Yolcu',
        name: passengerName(reservation),
        lines: [`@${reservation.passenger_username}`, `${reservation.seats} koltuk`],
      },
    ],
    sections: [
      {
        title: 'Güzergâh',
        meta: [
          { label: 'Kalkış noktası', value: reservation.pickup_label || reservation.origin_label },
          { label: 'Varış noktası', value: reservation.dropoff_label || reservation.dest_label },
          { label: 'Mesafe', value: formatDistance(input.distanceMeters) },
          { label: 'Süre', value: formatDuration(input.durationMinutes) },
        ],
        note: reservation.note ? `Yolcu notu: ${reservation.note}` : undefined,
      },
      {
        title: 'Yolcular ve koltuklar',
        table: {
          columns: [
            { label: 'Yolcu', align: 'left' },
            { label: 'Koltuk', align: 'center', width: '10%' },
            { label: 'Biniş', align: 'left', width: '20%' },
            { label: 'İniş', align: 'left', width: '20%' },
            { label: 'Rol', align: 'left', width: '11%' },
          ],
          rows: passengers,
          compact: true,
        },
      },
      {
        title: 'Tutar',
        table: {
          columns: [
            { label: 'Açıklama', align: 'left' },
            { label: 'Adet', align: 'right', width: '14%' },
            { label: 'Birim', align: 'right', width: '22%' },
            { label: 'Tutar', align: 'right', width: '22%' },
          ],
          rows: [
            [
              'Koltuk bedeli',
              reservation.seats,
              formatMoney(reservation.price_per_seat_cents, reservation.currency),
              formatMoney(reservation.total_cents, reservation.currency),
            ],
          ],
          totals: [
            { label: 'Toplam', value: formatMoney(reservation.total_cents, reservation.currency) },
          ],
        },
      },
      ...(reservation.cancel_reason
        ? [
            {
              title: 'İptal bilgisi',
              tone: 'warning' as const,
              paragraphs: [reservation.cancel_reason],
              meta: [
                {
                  label: 'İptal zamanı',
                  value: reservation.cancelled_at ? formatDateTimeTr(reservation.cancelled_at) : '—',
                },
              ],
            },
          ]
        : []),
      {
        title: 'Biniş ve iniş doğrulaması',
        tone: 'muted' as const,
        meta: [
          {
            label: 'Biniş',
            value: reservation.boarded_at ? formatDateTimeTr(reservation.boarded_at) : 'Henüz doğrulanmadı',
          },
          {
            label: 'İniş',
            value: reservation.alighted_at ? formatDateTimeTr(reservation.alighted_at) : 'Henüz doğrulanmadı',
          },
          { label: 'Koşul sürümü', value: reservation.policy_version || '—' },
        ],
      },
    ],
    notes: [
      'Bu belge dijital yolculuk özetidir; yasal fatura değildir. Doğrulanmış ödeme makbuzları yalnızca ödeme sağlayıcısının kayıtlarıyla eşleşen işlemler için üretilir.',
    ],
    footerNote: `Trabzone · ${input.ownerLabel ?? 'Yolculuk özeti'}`,
  };
}

export function buildRideSummarySpec(input: RideSummaryInput): PdfDocumentSpec {
  return rideSummarySpec(input);
}

export function buildRideSummaryHtml(input: RideSummaryInput): string {
  return buildPdfHtml(rideSummarySpec(input));
}
