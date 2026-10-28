import type {
  PdfColumn,
  PdfDocumentSpec,
  PdfMetaItem,
  PdfParty,
  PdfSectionSpec,
  PdfTableSpec,
  PdfTone,
} from './types';

const BRAND = {
  navy: '#0B1020',
  navySoft: '#1B2640',
  blue: '#4169F5',
  purple: '#7C4DFF',
  text: '#0F172A',
  secondary: '#475569',
  tertiary: '#64748B',
  border: '#E2E8F0',
  surface: '#F8FAFC',
  surfaceStrong: '#EEF2FF',
  success: '#047857',
  successSoft: '#ECFDF5',
  warning: '#B45309',
  warningSoft: '#FFFBEB',
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
};

const TONES: Record<PdfTone, { fg: string; bg: string; border: string }> = {
  primary: { fg: '#312E81', bg: BRAND.surfaceStrong, border: '#C7D2FE' },
  success: { fg: BRAND.success, bg: BRAND.successSoft, border: '#A7F3D0' },
  warning: { fg: BRAND.warning, bg: BRAND.warningSoft, border: '#FDE68A' },
  danger: { fg: BRAND.danger, bg: BRAND.dangerSoft, border: '#FECACA' },
  neutral: { fg: BRAND.secondary, bg: BRAND.surface, border: BRAND.border },
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMultiline(value: unknown): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br />');
}

export function formatDateTimeTr(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateTr(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** Kısa, insan tarafından okunabilir belge kodu: TZ-RCP-20261027-K7F2. */
export function createDocumentId(kind: string, seed?: string | number | null): string {
  const code = kind
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .split('-')
    .filter(Boolean)
    .map((part) => part.slice(0, 3).toUpperCase())
    .join('')
    .slice(0, 6);
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const raw = `${seed ?? ''}${now.getTime()}${Math.random()}`;
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36).toUpperCase().slice(-5).padStart(5, '0');
  return `TZ-${code || 'DOC'}-${date}-${suffix}`;
}

export function sanitizeFileName(value: string, fallback = 'trabzone-belge'): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
  return cleaned || fallback;
}

function pill(label: string, tone: PdfTone = 'neutral'): string {
  const colors = TONES[tone];
  return `<span class="pill" style="color:${colors.fg};background:${colors.bg};border-color:${colors.border}">${escapeHtml(
    label,
  )}</span>`;
}

function renderMeta(items: PdfMetaItem[] | undefined): string {
  if (!items?.length) return '';
  const cells = items
    .map(
      (item) => `
      <td class="meta-cell">
        <div class="meta-label">${escapeHtml(item.label)}</div>
        <div class="meta-value">${escapeMultiline(item.value)}</div>
      </td>`,
    )
    .join('');
  return `<table class="meta-table"><tbody><tr>${cells}</tr></tbody></table>`;
}

function renderParties(parties: PdfParty[] | undefined): string {
  if (!parties?.length) return '';
  const cells = parties
    .map(
      (party) => `
      <td class="party">
        <div class="party-title">${escapeHtml(party.title)}</div>
        <div class="party-name">${escapeHtml(party.name)}</div>
        ${(party.lines ?? [])
          .filter((line) => line.trim() !== '')
          .map((line) => `<div class="party-line">${escapeMultiline(line)}</div>`)
          .join('')}
      </td>`,
    )
    .join('');
  return `<table class="parties"><tbody><tr>${cells}</tr></tbody></table>`;
}

function alignClass(column: PdfColumn): string {
  if (column.align === 'right') return 'num';
  if (column.align === 'center') return 'center';
  return 'left';
}

function renderTable(table: PdfTableSpec): string {
  const columnCount = table.columns.length;
  const head = table.columns
    .map(
      (column) =>
        `<th class="${alignClass(column)}"${
          column.width ? ` style="width:${escapeHtml(column.width)}"` : ''
        }>${escapeHtml(column.label)}</th>`,
    )
    .join('');

  const rows =
    table.rows.length > 0
      ? table.rows
          .map(
            (row) => `
        <tr>${table.columns
          .map((column, index) => {
            const cell = row[index];
            return `<td class="${alignClass(column)}">${escapeMultiline(cell)}</td>`;
          })
          .join('')}</tr>`,
          )
          .join('')
      : `<tr><td colspan="${Math.max(1, columnCount)}" class="empty">${escapeHtml(
          table.emptyLabel ?? 'Kayıt yok.',
        )}</td></tr>`;

  const totals = table.totals?.length
    ? `<tfoot>${table.totals
        .map((total) => {
          const span = Math.max(1, total.labelColspan ?? Math.max(1, columnCount - 1));
          return `<tr><td class="num total-label" colspan="${span}">${escapeHtml(
            total.label,
          )}</td><td class="num total-value">${escapeHtml(total.value)}</td></tr>`;
        })
        .join('')}</tfoot>`
    : '';

  return `<table class="data${table.compact ? ' compact' : ''}">
    <colgroup>${table.columns
      .map((column) => `<col${column.width ? ` style="width:${escapeHtml(column.width)}"` : ''} />`)
      .join('')}</colgroup>
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}</tbody>
    ${totals}
  </table>`;
}

function renderSection(section: PdfSectionSpec): string {
  const tone = section.tone === 'muted' ? ' section-muted' : section.tone === 'warning' ? ' section-warning' : section.tone === 'success' ? ' section-success' : '';
  const heading = section.title
    ? `<div class="section-head"><div class="section-title">${escapeHtml(section.title)}</div>${
        section.subtitle ? `<div class="section-subtitle">${escapeHtml(section.subtitle)}</div>` : ''
      }</div>`
    : section.subtitle
      ? `<div class="section-subtitle standalone">${escapeHtml(section.subtitle)}</div>`
      : '';
  const paragraphs = (section.paragraphs ?? [])
    .filter((paragraph) => paragraph.trim() !== '')
    .map((paragraph) => `<p>${escapeMultiline(paragraph)}</p>`)
    .join('');
  return `<section class="section${tone}">
    ${heading}
    ${renderMeta(section.meta)}
    ${renderParties(section.parties)}
    ${paragraphs}
    ${section.table ? renderTable(section.table) : ''}
    ${section.note ? `<div class="section-note">${escapeMultiline(section.note)}</div>` : ''}
  </section>`;
}

const STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: ${BRAND.text};
    font-size: 12px;
    line-height: 1.5;
    padding: 30px 34px 62px;
    background: #FFFFFF;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .brand-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; }
  .brand { font-size: 24px; font-weight: 800; letter-spacing: -0.7px; color: ${BRAND.navy}; margin: 0; }
  .brand span { color: ${BRAND.purple}; }
  .brand-sub { margin-top: 2px; font-size: 10px; letter-spacing: 0.9px; text-transform: uppercase; color: ${BRAND.tertiary}; }
  .brand-right { text-align: right; }
  .pill {
    display: inline-block; padding: 4px 10px; border-radius: 999px;
    border: 1px solid ${BRAND.border}; font-size: 10px; font-weight: 700;
  }
  .doc-title { margin: 22px 0 2px; font-size: 22px; line-height: 1.2; letter-spacing: -0.4px; color: ${BRAND.navy}; }
  .doc-subtitle { margin: 0 0 6px; color: ${BRAND.tertiary}; font-size: 11.5px; }
  .divider { height: 2px; margin: 14px 0 4px; background: linear-gradient(90deg, ${BRAND.blue}, ${BRAND.purple}); border-radius: 2px; }
  .meta-table { width: 100%; border-collapse: separate; border-spacing: 8px; margin: 10px -8px 0; }
  .meta-cell {
    vertical-align: top; padding: 10px 12px; border: 1px solid ${BRAND.border};
    border-radius: 10px; background: ${BRAND.surface}; width: 25%;
  }
  .meta-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: ${BRAND.tertiary}; margin-bottom: 3px; }
  .meta-value { font-size: 12px; font-weight: 700; color: ${BRAND.text}; }
  .parties { width: 100%; border-collapse: separate; border-spacing: 8px; margin: 12px -8px 0; }
  .party { vertical-align: top; padding: 12px 14px; border: 1px solid ${BRAND.border}; border-radius: 12px; width: 50%; }
  .party-title { font-size: 9px; text-transform: uppercase; letter-spacing: 0.7px; color: ${BRAND.tertiary}; margin-bottom: 5px; }
  .party-name { font-size: 13px; font-weight: 700; }
  .party-line { font-size: 10.5px; color: ${BRAND.secondary}; margin-top: 2px; }
  .section { margin-top: 20px; }
  .section-head { margin-bottom: 8px; }
  .section-title { font-size: 13.5px; font-weight: 800; color: ${BRAND.navy}; }
  .section-subtitle { font-size: 10.5px; color: ${BRAND.tertiary}; margin-top: 1px; }
  .section-subtitle.standalone { margin-bottom: 8px; }
  .section-muted { background: ${BRAND.surface}; border-radius: 12px; padding: 12px 14px; }
  .section-warning { background: ${BRAND.warningSoft}; border-radius: 12px; padding: 12px 14px; }
  .section-success { background: ${BRAND.successSoft}; border-radius: 12px; padding: 12px 14px; }
  p { margin: 5px 0; color: ${BRAND.secondary}; font-size: 11.5px; }
  .data { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
  .data th {
    padding: 8px 7px; text-align: left; font-size: 9px; letter-spacing: 0.5px;
    text-transform: uppercase; color: ${BRAND.tertiary};
    border-bottom: 1.5px solid ${BRAND.border};
    background: ${BRAND.surfaceStrong};
  }
  .data td { padding: 8px 7px; border-bottom: 1px solid #F1F5F9; vertical-align: top; font-size: 10.5px; word-wrap: break-word; }
  .data.compact td { padding: 6px 6px; }
  .data tbody tr:nth-child(even) td { background: #FCFDFF; }
  .data .num { text-align: right; }
  .data .center { text-align: center; }
  .data .left { text-align: left; }
  .data .empty { text-align: center; color: ${BRAND.tertiary}; padding: 18px 8px; }
  .data tfoot td { border-bottom: 0; padding-top: 10px; }
  .data .total-label { font-size: 11px; font-weight: 700; color: ${BRAND.secondary}; }
  .data .total-value { font-size: 13px; font-weight: 800; color: ${BRAND.navy}; }
  .section-note { margin-top: 10px; padding: 9px 11px; border-left: 3px solid ${BRAND.blue}; background: ${BRAND.surface}; font-size: 10.5px; color: ${BRAND.secondary}; }
  .notes { margin-top: 18px; padding: 12px 14px; border: 1px solid ${BRAND.border}; border-radius: 10px; background: ${BRAND.surface}; }
  .notes-title { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: ${BRAND.tertiary}; margin-bottom: 5px; }
  .notes p { margin: 3px 0; font-size: 10px; }
  .legal { margin-top: 16px; font-size: 9.5px; line-height: 1.55; color: ${BRAND.tertiary}; }
  .signature { margin-top: 24px; display: flex; gap: 24px; }
  .signature div { flex: 1; border-top: 1px solid ${BRAND.border}; padding-top: 6px; font-size: 9px; color: ${BRAND.tertiary}; }
  .footer {
    position: fixed; bottom: 18px; left: 34px; right: 34px;
    border-top: 1px solid ${BRAND.border}; padding-top: 7px;
    display: flex; justify-content: space-between; gap: 12px;
    font-size: 8.5px; color: ${BRAND.tertiary};
  }
  .footer .page-number::after { content: counter(page); }
  @page { size: A4; margin: 12mm 10mm 14mm; }
  @media print {
    body { padding: 0 0 54px; }
    .section { break-inside: auto; }
    .data tr { break-inside: avoid; }
  }
`;

export function buildPdfHtml(spec: PdfDocumentSpec): string {
  const documentId = spec.documentId ?? createDocumentId(spec.kind);
  const badge = spec.badge ? pill(spec.badge.label, spec.badge.tone ?? 'neutral') : '';
  const sections = (spec.sections ?? []).map(renderSection).join('');
  const notes = (spec.notes ?? []).filter((note) => note.trim() !== '');
  const footerNote = spec.footerNote ?? 'Trabzone tarafından oluşturuldu.';
  const landscape = spec.orientation === 'landscape';
  const legal =
    spec.legalNote ??
    'Bu belge uygulama içi işlemlerin özetidir; yasal fatura, mali belge veya ödeme sağlayıcısı makbuzu yerine geçmez. Doğrulanmış ödeme kayıtları yalnızca ödeme sağlayıcısının onayladığı işlemleri yansıtır.';

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(spec.title)}</title>
<style>${STYLES}</style>
${landscape ? '<style>@page { size: A4 landscape; margin: 10mm 10mm 12mm; }</style>' : ''}
</head>
<body>
  <div class="brand-row">
    <div>
      <h1 class="brand">Trabzo<span>n</span>e</h1>
      <div class="brand-sub">${escapeHtml(spec.kind === 'admin_report' ? 'Yönetim raporu' : 'Dijital belge')}</div>
    </div>
    <div class="brand-right">
      ${badge}
      <div class="brand-sub" style="margin-top:6px">${escapeHtml(formatDateTr(new Date()))}</div>
    </div>
  </div>

  <div class="divider"></div>
  <h2 class="doc-title">${escapeHtml(spec.title)}</h2>
  ${spec.subtitle ? `<p class="doc-subtitle">${escapeHtml(spec.subtitle)}</p>` : ''}

  ${renderMeta(spec.meta)}
  ${renderParties(spec.parties)}
  ${sections}

  ${notes.length > 0 ? `<div class="notes"><div class="notes-title">Notlar</div>${notes
    .map((note) => `<p>${escapeMultiline(note)}</p>`)
    .join('')}</div>` : ''}

  <div class="signature">
    <div>Belge kodu: ${escapeHtml(documentId)}</div>
    <div style="text-align:right">Oluşturulma: ${escapeHtml(formatDateTimeTr(new Date()))}</div>
  </div>

  <div class="legal">${escapeMultiline(legal)}</div>

  <div class="footer">
    <span>${escapeHtml(footerNote)}</span>
    <span>${escapeHtml(documentId)} · Sayfa <span class="page-number"></span></span>
  </div>
</body>
</html>`;
}
