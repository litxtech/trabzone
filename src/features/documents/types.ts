/**
 * PDF belge modeli.
 *
 * Şablonlar yalnızca veri üretir; HTML/CSS birleştirmesi `html.ts` içinde
 * yapılır. Böylece fiş, yolculuk özeti, satış raporu ve yönetici raporu aynı
 * marka dilini, sayfa alt bilgisini ve güvenlik notlarını paylaşır.
 */

export type PdfTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export type PdfColumn = {
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
};

export type PdfTotalRow = {
  label: string;
  value: string;
  /** Etiketin kaplayacağı kolon sayısı; varsayılan kolon sayısı - 1. */
  labelColspan?: number;
};

export type PdfTableSpec = {
  columns: PdfColumn[];
  rows: (string | number | null | undefined)[][];
  totals?: PdfTotalRow[];
  emptyLabel?: string;
  compact?: boolean;
};

export type PdfMetaItem = {
  label: string;
  value: string;
};

export type PdfParty = {
  title: string;
  name: string;
  lines?: string[];
};

export type PdfSectionSpec = {
  title?: string;
  subtitle?: string;
  paragraphs?: string[];
  meta?: PdfMetaItem[];
  parties?: PdfParty[];
  table?: PdfTableSpec;
  note?: string;
  tone?: 'default' | 'muted' | 'warning' | 'success';
};

export type PdfDocumentSpec = {
  /** Belge türü; dosya adı ve doğrulama kodunda kullanılır. */
  kind: 'market_receipt' | 'market_sales' | 'ride_summary' | 'ride_statement' | 'admin_report' | 'generic';
  title: string;
  subtitle?: string;
  badge?: { label: string; tone?: PdfTone };
  documentId?: string;
  /** Geniş tablolu raporlar için yatay A4 çıktısı. Varsayılan dikey. */
  orientation?: 'portrait' | 'landscape';
  meta?: PdfMetaItem[];
  parties?: PdfParty[];
  sections?: PdfSectionSpec[];
  notes?: string[];
  legalNote?: string;
  footerNote?: string;
};

export type PdfExportAction = 'share' | 'email' | 'print';

export type PdfExportOptions = {
  action?: PdfExportAction;
  fileName?: string;
  dialogTitle?: string;
  email?: {
    recipients?: string[];
    subject?: string;
    body?: string;
  };
};

export type PdfExportResult = {
  uri: string | null;
  action: PdfExportAction;
  documentId: string;
};
