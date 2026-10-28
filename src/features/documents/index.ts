import type { OrderReceipt } from '@/features/marketplace/services/marketplace-service';
import type { RideReservation } from '@/features/ride/types';
import type { Result } from '@/utils/result';

import { exportPdfDocument } from './pdf-service';
import {
  buildAdminReportSpec,
  buildMarketReceiptSpec,
  buildRideStatementSpec,
  buildSalesReportSpec,
  buildRideSummarySpec,
  type AdminReportInput,
  type RideStatementInput,
  type RideSummaryInput,
  type SalesReportInput,
} from './templates';
import type { PdfExportOptions, PdfExportResult } from './types';

export * from './html';
export * from './pdf-service';
export * from './types';
export * from './templates';

type ExtraOptions = Pick<PdfExportOptions, 'action' | 'email'>;

function exportSpec(
  spec: Parameters<typeof exportPdfDocument>[0],
  fileName: string,
  dialogTitle: string,
  options: ExtraOptions,
): Promise<Result<PdfExportResult>> {
  return exportPdfDocument(spec, { ...options, fileName, dialogTitle });
}

export function shareMarketReceipt(
  receipt: OrderReceipt,
  options: ExtraOptions = {},
): Promise<Result<PdfExportResult>> {
  return exportSpec(
    buildMarketReceiptSpec(receipt),
    `trabzone-siparis-${receipt.order_no}`,
    'Sipariş fişini paylaş',
    options,
  );
}

export function shareMarketSalesReport(
  input: SalesReportInput,
  options: ExtraOptions = {},
): Promise<Result<PdfExportResult>> {
  return exportSpec(
    buildSalesReportSpec(input),
    `trabzone-satis-${input.scope === 'all' ? 'pazar' : 'ozet'}`,
    input.scope === 'all' ? 'Satış raporunu paylaş' : 'Satış özetini paylaş',
    options,
  );
}

export function shareRideSummary(
  input: RideSummaryInput,
  options: ExtraOptions = {},
): Promise<Result<PdfExportResult>> {
  return exportSpec(
    buildRideSummarySpec(input),
    `trabzone-yolculuk-${input.reservation.id.slice(0, 8)}`,
    'Yolculuk özetini paylaş',
    options,
  );
}

export function shareRideStatement(
  input: RideStatementInput,
  options: ExtraOptions = {},
): Promise<Result<PdfExportResult>> {
  return exportSpec(
    buildRideStatementSpec(input),
    `trabzone-yolculuk-hesabi-${input.scope ?? 'all'}`,
    'Yolculuk hesap özetini paylaş',
    options,
  );
}

export function shareAdminReport(
  input: AdminReportInput,
  options: ExtraOptions = {},
): Promise<Result<PdfExportResult>> {
  return exportSpec(
    buildAdminReportSpec(input),
    `trabzone-${input.reportKey}-${input.range.from.slice(0, 10)}-${input.range.to.slice(0, 10)}`,
    'Raporu PDF olarak paylaş',
    options,
  );
}

export type { RideReservation };
