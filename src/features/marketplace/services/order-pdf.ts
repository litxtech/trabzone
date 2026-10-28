import { shareMarketReceipt, shareMarketSalesReport } from '@/features/documents';
import type {
  SalesReportInput,
  ReportOrderRow,
} from '@/features/documents/templates/market-sales-report';
import { fail, ok, type Result } from '@/utils/result';

import type { OrderReceipt } from './marketplace-service';

export type { ReportOrderRow };

/**
 * Marketplace PDF'leri ortak belge motorunu kullanır. Eski çağrı imzası
 * korunur; böylece siparişler ve yönetim paneli aynı yerden beslenmeye
 * devam eder.
 */
export async function shareOrderReceipt(receipt: OrderReceipt): Promise<Result<null>> {
  const result = await shareMarketReceipt(receipt);
  return result.ok ? ok(null) : fail(result.error);
}

export async function shareSalesReport(input: SalesReportInput): Promise<Result<null>> {
  const result = await shareMarketSalesReport(input);
  return result.ok ? ok(null) : fail(result.error);
}
