import { formatCentsTr } from '@/features/pricing/money';
import { columnTotals } from '@/features/pricing/reports';

import { buildPdfHtml, createDocumentId, formatDateTimeTr } from '../html';
import type { PdfDocumentSpec, PdfSectionSpec } from '../types';

export type AdminReportInput = {
  reportKey: string;
  title: string;
  description?: string;
  category?: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  range: { from: string; to: string };
  generatedBy?: string;
  sensitive?: boolean;
  /** PDF'in şişmemesi için üst sınır; sunucu dışa aktarımı 5.000 satırla sınırlı. */
  rowLimit?: number;
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString('tr-TR') : '—';
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isCentsColumn(key: string): boolean {
  return /(cents|_minor|amount_cents|price_cents|total_cents)/i.test(key);
}

function adminReportSpec(input: AdminReportInput): PdfDocumentSpec {
  const limit = Math.max(1, Math.min(input.rowLimit ?? 5000, 5000));
  const rows = input.rows.slice(0, limit);
  const truncated = input.rows.length > rows.length;

  const totals = columnTotals(input.columns, rows, { onlyCentsLike: true });
  const tableRows = rows.map((row) => input.columns.map((column) => displayValue(row[column.key])));

  const totalSections: PdfSectionSpec[] =
    totals.length > 0
      ? [
          {
            title: 'Sayısal toplamlar',
            table: {
              columns: [
                { label: 'Kolon', align: 'left' },
                { label: 'Toplam', align: 'right', width: '35%' },
              ],
              rows: totals.map((total) => [
                total.label,
                isCentsColumn(total.key)
                  ? formatCentsTr(total.total)
                  : total.total.toLocaleString('tr-TR'),
              ]),
              compact: true,
            },
          },
        ]
      : [];

  const exportNote: PdfSectionSpec = {
    title: 'Dışa aktarma notu',
    tone: 'muted',
    paragraphs: [
      'Bu PDF, yönetici rapor kataloğundaki yetki kurallarına göre üretilmiştir. Finansal ve kişisel veri içeren raporlar yalnızca ilgili izne sahip roller tarafından indirilebilir.',
      ...(truncated
        ? ['Rapor satır sayısı PDF sınırını aştığı için yalnızca ilk satırlar gösterildi; tamamı için CSV/Excel dışa aktarımını kullanın.']
        : []),
    ],
  };

  return {
    kind: 'admin_report',
    title: input.title,
    subtitle: input.description,
    orientation: input.columns.length > 6 ? 'landscape' : 'portrait',
    badge: {
      label: input.sensitive ? 'Hassas rapor' : 'Standart rapor',
      tone: input.sensitive ? 'warning' : 'primary',
    },
    documentId: createDocumentId('admin_report', input.reportKey),
    meta: [
      { label: 'Rapor', value: input.reportKey },
      { label: 'Kategori', value: input.category ?? '—' },
      { label: 'Başlangıç', value: formatDateTimeTr(input.range.from) },
      { label: 'Bitiş', value: formatDateTimeTr(input.range.to) },
      { label: 'Satır', value: String(rows.length) },
      { label: 'Oluşturan', value: input.generatedBy ?? '—' },
    ],
    sections: [
      {
        title: 'Rapor verisi',
        subtitle: truncated
          ? `İlk ${rows.length} satır gösteriliyor; toplam ${input.rows.length} satır.`
          : `${rows.length} satır gösteriliyor.`,
        table: {
          columns: input.columns.map((column, index) => ({
            label: column.label,
            align: (index === 0 ? 'left' : isCentsColumn(column.key) ? 'right' : 'left') as
              | 'left'
              | 'right',
          })),
          rows: tableRows,
          emptyLabel: 'Seçili aralıkta kayıt bulunamadı.',
          compact: input.columns.length > 6,
        },
      },
      ...totalSections,
      exportNote,
    ],
    notes: [
      `Rapor aralığı: ${formatDateTimeTr(input.range.from)} – ${formatDateTimeTr(input.range.to)}`,
      ...(input.sensitive ? ['Bu belge hassas veri içerir; paylaşımını yetki kapsamında tutun.'] : []),
    ],
    footerNote: `Trabzone Yönetim · ${input.reportKey}`,
  };
}

export function buildAdminReportSpec(input: AdminReportInput): PdfDocumentSpec {
  return adminReportSpec(input);
}

export function buildAdminReportHtml(input: AdminReportInput): string {
  return buildPdfHtml(adminReportSpec(input));
}
