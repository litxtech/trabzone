import { Platform } from 'react-native';

import { appError } from '@/services/errors';
import { fail, ok, type Result } from '@/utils/result';

import type { AccommodationDocument, DailyReport, ReportData } from '../types';
import { DOCUMENT_KIND_LABELS, formatDate, formatDateTime, formatMoneyCents, formatNumber } from './format';

/**
 * Konaklama raporlarının PDF ve Excel çıktıları.
 *
 * PDF için `expo-print` kullanılır; native tarafta dosya üretilip paylaşılır,
 * web'de tarayıcının yazdırma penceresi açılır (kullanıcı "PDF olarak kaydet"
 * seçebilir). Excel çıktısı Excel'in doğrudan açtığı SpreadsheetML/HTML tablo
 * biçimindedir; ek bir ağır bağımlılık gerektirmez.
 */

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80);
}

const BASE_STYLE = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #0B1020; margin: 0; padding: 32px; background: #FFFFFF; }
  h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.4px; }
  h2 { font-size: 16px; margin: 28px 0 10px; color: #2F55D4; }
  .muted { color: #77839A; font-size: 11px; }
  .brand { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4169F5; padding-bottom: 16px; }
  .brand-mark { font-weight: 800; font-size: 20px; color: #4169F5; letter-spacing: -0.4px; }
  .brand-sub { font-size: 11px; color: #8057F4; font-weight: 600; margin-top: 2px; }
  .meta { text-align: right; font-size: 11px; color: #77839A; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
  th { text-align: left; background: #F1F5FF; color: #2F55D4; padding: 8px 10px; border-bottom: 1px solid #D2DDFF; font-weight: 700; }
  td { padding: 8px 10px; border-bottom: 1px solid #EEF2FA; vertical-align: top; }
  tr:nth-child(even) td { background: #FAFBFE; }
  .right { text-align: right; }
  .cards { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
  .card { flex: 1 1 30%; border: 1px solid #E2E8F4; border-radius: 10px; padding: 12px 14px; background: #F7F9FE; }
  .card-label { font-size: 10px; color: #77839A; text-transform: uppercase; letter-spacing: 0.5px; }
  .card-value { font-size: 17px; font-weight: 800; margin-top: 4px; color: #0B1020; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; background: #F1F5FF; color: #2F55D4; font-size: 9px; font-weight: 700; }
  .footer { margin-top: 28px; border-top: 1px solid #E2E8F4; padding-top: 10px; font-size: 9px; color: #8A94A6; }
  .total-row td { font-weight: 800; background: #F1F5FF !important; border-top: 2px solid #4169F5; }
  .notice { background: #F1EBFF; border-left: 3px solid #8057F4; padding: 10px 12px; font-size: 11px; border-radius: 6px; margin-top: 14px; }
  @media print { body { padding: 0; } }
`;

function reportHtml(data: ReportData): string {
  const { property, totals } = data;
  const rows = data.daily
    .map(
      (day) => `<tr>
        <td>${escapeHtml(formatDate(day.date))}</td>
        <td class="right">${escapeHtml(formatMoneyCents(day.revenue_cents))}</td>
        <td class="right">${escapeHtml(formatMoneyCents(day.collected_cents))}</td>
        <td class="right">${escapeHtml(formatMoneyCents(day.expenses_cents))}</td>
        <td class="right">${escapeHtml(formatMoneyCents(day.commission_cents))}</td>
      </tr>`,
    )
    .join('');

  const reservations = data.reservations
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.code)}</td>
        <td>${escapeHtml(row.guest_name)}</td>
        <td>${escapeHtml(row.room_type)}${row.room_number ? ` · ${escapeHtml(row.room_number)}` : ''}</td>
        <td>${escapeHtml(formatDate(row.check_in))} – ${escapeHtml(formatDate(row.check_out))}</td>
        <td class="right">${escapeHtml(String(row.nights))}</td>
        <td class="right">${escapeHtml(formatMoneyCents(row.total_cents, row.currency))}</td>
        <td class="right">${escapeHtml(formatMoneyCents(row.paid_cents, row.currency))}</td>
        <td class="right">${escapeHtml(formatMoneyCents(row.commission_cents, row.currency))}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" />
  <title>${escapeHtml(property.name)} · Konaklama Raporu</title><style>${BASE_STYLE}</style></head>
  <body>
    <div class="brand">
      <div><div class="brand-mark">TRABZONE</div><div class="brand-sub">KONAKLAMA · FİNANS RAPORU</div></div>
      <div class="meta">
        <strong>${escapeHtml(property.name)}</strong><br />
        ${escapeHtml(property.district ?? '')}${property.district ? ' · ' : ''}${escapeHtml(property.address ?? '')}<br />
        ${escapeHtml(formatDate(data.from))} – ${escapeHtml(formatDate(data.to))}<br />
        Oluşturma: ${escapeHtml(formatDateTime(data.generated_at))}
      </div>
    </div>

    <div class="cards">
      <div class="card"><div class="card-label">Konaklama geliri</div><div class="card-value">${escapeHtml(formatMoneyCents(totals.revenue_cents))}</div></div>
      <div class="card"><div class="card-label">Tahsil edilen</div><div class="card-value">${escapeHtml(formatMoneyCents(totals.collected_cents))}</div></div>
      <div class="card"><div class="card-label">Giderler</div><div class="card-value">${escapeHtml(formatMoneyCents(totals.expenses_cents))}</div></div>
      <div class="card"><div class="card-label">Trabzone komisyonu</div><div class="card-value">${escapeHtml(formatMoneyCents(totals.commission_cents))}</div></div>
      <div class="card"><div class="card-label">Rezervasyon</div><div class="card-value">${escapeHtml(formatNumber(totals.reservation_count))}</div></div>
    </div>

    <div class="notice">Tahsilat ile konaklama geliri ayrı hesaplanır. Peşin ödenen konaklamalar tahsilat gününde kasaya, konaklama gecelerine dağıtılarak gelire yazılır.</div>

    <h2>Günlük özet</h2>
    <table><thead><tr><th>Tarih</th><th class="right">Gelir</th><th class="right">Tahsilat</th><th class="right">Gider</th><th class="right">Komisyon</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="muted">Bu aralıkta hareket yok.</td></tr>'}</tbody></table>

    <h2>Rezervasyonlar</h2>
    <table><thead><tr><th>Kod</th><th>Misafir</th><th>Oda</th><th>Tarih</th><th class="right">Gece</th><th class="right">Toplam</th><th class="right">Ödenen</th><th class="right">Komisyon</th></tr></thead>
    <tbody>${reservations || '<tr><td colspan="8" class="muted">Bu aralıkta rezervasyon yok.</td></tr>'}</tbody></table>

    <div class="footer">Trabzone Konaklama · Bu rapor ${escapeHtml(formatDateTime(new Date().toISOString()))} itibarıyla oluşturulmuştur. Finansal kayıtlar denetim izi için değiştirilemez; hatalı hareketler ters kayıtla düzeltilir.</div>
  </body></html>`;
}

export function renderReportHtml(data: ReportData): string {
  return reportHtml(data);
}

export function renderDailyReportHtml(report: DailyReport, propertyName = 'Tesis'): string {
  const money = (key: keyof DailyReport) => formatMoneyCents(Number(report[key] ?? 0));
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" />
  <title>${escapeHtml(propertyName)} · Gün Sonu</title><style>${BASE_STYLE}</style></head><body>
    <div class="brand">
      <div><div class="brand-mark">TRABZONE</div><div class="brand-sub">KONAKLAMA · GÜN SONU RAPORU</div></div>
      <div class="meta"><strong>${escapeHtml(propertyName)}</strong><br />${escapeHtml(formatDate(report.date))}</div>
    </div>
    <div class="cards">
      <div class="card"><div class="card-label">Net tahsilat</div><div class="card-value">${escapeHtml(money('net_cents'))}</div></div>
      <div class="card"><div class="card-label">Nakit</div><div class="card-value">${escapeHtml(money('cash_cents'))}</div></div>
      <div class="card"><div class="card-label">POS</div><div class="card-value">${escapeHtml(money('pos_cents'))}</div></div>
      <div class="card"><div class="card-label">Banka</div><div class="card-value">${escapeHtml(money('bank_cents'))}</div></div>
      <div class="card"><div class="card-label">Günlük konaklama geliri</div><div class="card-value">${escapeHtml(money('revenue_cents'))}</div></div>
      <div class="card"><div class="card-label">İadeler</div><div class="card-value">${escapeHtml(money('refunds_cents'))}</div></div>
    </div>
    <div class="notice">Tahsilat günü ile konaklama geliri günü farklı olabilir. Bu rapor iki değeri ayrı gösterir.</div>
    <div class="footer">Trabzone Konaklama · ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
  </body></html>`;
}

export function renderDocumentHtml(document: AccommodationDocument): string {
  const snapshot = (document.snapshot ?? {}) as {
    property?: Record<string, unknown>;
    reservation?: Record<string, unknown> | null;
    folio?: Record<string, unknown>[];
    issued_at?: string;
  };
  const property = snapshot.property ?? {};
  const reservation = snapshot.reservation ?? null;
  const folio = snapshot.folio ?? [];
  const money = (value: unknown, currency = document.currency) =>
    formatMoneyCents(Number(value ?? 0), currency);

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" />
  <title>${escapeHtml(document.number)}</title><style>${BASE_STYLE}</style></head><body>
    <div class="brand">
      <div><div class="brand-mark">${escapeHtml(property.name ?? 'Tesis')}</div><div class="brand-sub">${escapeHtml(property.district ?? '')}${property.district ? ' · ' : ''}${escapeHtml(property.city ?? 'Trabzon')}</div></div>
      <div class="meta"><span class="badge">${escapeHtml(DOCUMENT_KIND_LABELS[document.kind])}</span><br /><strong>${escapeHtml(document.number)}</strong><br />${escapeHtml(formatDateTime(document.issued_at))}</div>
    </div>
    <h1 style="margin-top:20px">${escapeHtml(document.title)}</h1>
    <div class="muted">${escapeHtml(property.address ?? '')} · ${escapeHtml(property.phone ?? '')} · ${escapeHtml(property.email ?? '')}</div>
    ${
      property.tax_number
        ? `<div class="muted">Vergi dairesi: ${escapeHtml(property.tax_office ?? '—')} · Vergi no: ${escapeHtml(property.tax_number)}</div>`
        : ''
    }
    ${
      reservation
        ? `<h2>Misafir ve konaklama</h2>
      <table><tbody>
        <tr><th>Misafir</th><td>${escapeHtml(reservation.guest_name ?? '—')}</td><th>Rezervasyon</th><td>${escapeHtml(reservation.code ?? '—')}</td></tr>
        <tr><th>Giriş</th><td>${escapeHtml(formatDate(String(reservation.check_in ?? '')))}</td><th>Çıkış</th><td>${escapeHtml(formatDate(String(reservation.check_out ?? '')))}</td></tr>
        <tr><th>Oda</th><td>${escapeHtml(reservation.room_type ?? '—')}${reservation.room_number ? ` · ${escapeHtml(reservation.room_number)}` : ''}</td><th>Kişi</th><td>${escapeHtml(reservation.adults ?? 0)} yetişkin · ${escapeHtml(reservation.children ?? 0)} çocuk</td></tr>
        <tr><th>Gecelik</th><td>${escapeHtml(money(reservation.nightly_price_cents))}</td><th>Toplam</th><td><strong>${escapeHtml(money(reservation.total_cents))}</strong></td></tr>
        <tr><th>Ödenen</th><td>${escapeHtml(money(reservation.paid_cents))}</td><th>Komisyon</th><td>${escapeHtml(money(reservation.commission_cents))}</td></tr>
      </tbody></table>`
        : ''
    }
    ${
      folio.length > 0
        ? `<h2>Hesap hareketleri</h2>
      <table><thead><tr><th>Tarih</th><th>Tür</th><th>Açıklama</th><th class="right">Tutar</th></tr></thead><tbody>
      ${folio
        .map(
          (item) => `<tr><td>${escapeHtml(formatDate(String(item.occurred_on ?? '')))}</td><td>${escapeHtml(String(item.kind ?? ''))}</td><td>${escapeHtml(String(item.description ?? '—'))}</td><td class="right">${escapeHtml(money(item.amount_cents))}</td></tr>`,
        )
        .join('')}
      </tbody></table>`
        : ''
    }
    <div class="footer">Bu belge Trabzone Konaklama tarafından ${escapeHtml(formatDateTime(snapshot.issued_at ?? document.issued_at))} tarihinde oluşturulmuştur. ${document.reservation_code ? `Rezervasyon: ${escapeHtml(document.reservation_code)}` : ''}</div>
  </body></html>`;
}

async function shareNativeFile(uri: string, mimeType: string, dialogTitle: string, UTI?: string): Promise<void> {
  const Sharing = await import('expo-sharing').catch(() => null);
  if (!Sharing || !(await Sharing.isAvailableAsync())) {
    throw appError('unknown', 'Paylaşım bu cihazda kullanılamıyor.');
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle, ...(UTI ? { UTI } : {}) });
}

function webDownload(html: string, fileName: string, mime: string): void {
  const blob = new Blob([html], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportHtmlAsPdf(
  html: string,
  fileName: string,
  dialogTitle = 'PDF paylaş',
): Promise<Result<{ uri: string | null }>> {
  if (Platform.OS === 'web') {
    try {
      const Print = await import('expo-print');
      await Print.printAsync({ html });
      return ok({ uri: null });
    } catch {
      return fail(appError('unknown', 'Yazdırma penceresi açılamadı. Tarayıcı izinlerini kontrol et.'));
    }
  }

  try {
    const Print = await import('expo-print');
    const file = await Print.printToFileAsync({ html, base64: false });
    const uri = (file as { uri?: string }).uri;
    if (!uri) {
      return fail(appError('unknown', 'PDF dosyası oluşturulamadı.'));
    }
    await shareNativeFile(uri, 'application/pdf', dialogTitle, 'com.adobe.pdf');
    return ok({ uri });
  } catch {
    return fail(appError('unknown', 'PDF oluşturulamadı veya paylaşılamadı. Tekrar dene.'));
  }
}

export async function exportReportPdf(data: ReportData): Promise<Result<{ uri: string | null }>> {
  const fileName = safeFileName(`konaklama-raporu-${data.from}-${data.to}`);
  return exportHtmlAsPdf(reportHtml(data), `${fileName}.pdf`, 'Raporu paylaş');
}

export async function exportDocumentPdf(document: AccommodationDocument): Promise<Result<{ uri: string | null }>> {
  return exportHtmlAsPdf(renderDocumentHtml(document), `${safeFileName(document.number)}.pdf`, 'Belgeyi paylaş');
}

function reportExcelHtml(data: ReportData): string {
  const rows = data.daily
    .map(
      (day) => `<tr><td>${escapeHtml(day.date)}</td><td>${day.revenue_cents / 100}</td><td>${day.collected_cents / 100}</td><td>${day.expenses_cents / 100}</td><td>${day.commission_cents / 100}</td></tr>`,
    )
    .join('');
  const reservations = data.reservations
    .map(
      (row) => `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.guest_name)}</td><td>${escapeHtml(row.room_type)}</td><td>${escapeHtml(row.room_number ?? '')}</td><td>${escapeHtml(row.check_in)}</td><td>${escapeHtml(row.check_out)}</td><td>${row.nights}</td><td>${row.adults}</td><td>${row.children}</td><td>${row.total_cents / 100}</td><td>${row.paid_cents / 100}</td><td>${row.commission_cents / 100}</td><td>${escapeHtml(row.source)}</td><td>${escapeHtml(row.status)}</td></tr>`,
    )
    .join('');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta charset="utf-8" /><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Ozet</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
  <style>table{border-collapse:collapse} th{background:#4169F5;color:#fff;font-weight:bold} td,th{border:1px solid #CBD5E6;padding:4px 8px;font-size:11px} .title{font-size:16px;font-weight:bold;color:#2F55D4}</style></head>
  <body>
    <table>
      <tr><td colspan="5" class="title">${escapeHtml(data.property.name)} · Konaklama Raporu</td></tr>
      <tr><td colspan="5">${escapeHtml(formatDate(data.from))} – ${escapeHtml(formatDate(data.to))}</td></tr>
      <tr><td colspan="2">Konaklama geliri</td><td>${data.totals.revenue_cents / 100}</td><td>Tahsilat</td><td>${data.totals.collected_cents / 100}</td></tr>
      <tr><td colspan="2">Giderler</td><td>${data.totals.expenses_cents / 100}</td><td>Komisyon</td><td>${data.totals.commission_cents / 100}</td></tr>
      <tr><td colspan="5"></td></tr>
      <tr><th>Tarih</th><th>Gelir</th><th>Tahsilat</th><th>Gider</th><th>Komisyon</th></tr>
      ${rows}
      <tr><td colspan="5"></td></tr>
      <tr><th>Kod</th><th>Misafir</th><th>Oda tipi</th><th>Oda no</th><th>Giriş</th><th>Çıkış</th><th>Gece</th><th>Yetişkin</th><th>Çocuk</th><th>Toplam</th><th>Ödenen</th><th>Komisyon</th><th>Kaynak</th><th>Durum</th></tr>
      ${reservations}
    </table>
  </body></html>`;
}

export async function exportReportExcel(data: ReportData): Promise<Result<{ uri: string | null }>> {
  const fileName = `${safeFileName(`konaklama-raporu-${data.from}-${data.to}`)}.xls`;
  const html = reportExcelHtml(data);

  if (Platform.OS === 'web') {
    try {
      webDownload(html, fileName, 'application/vnd.ms-excel');
      return ok({ uri: null });
    } catch {
      return fail(appError('unknown', 'Excel dosyası indirilemedi. Tarayıcı izinlerini kontrol et.'));
    }
  }

  try {
    const FileSystem = await import('expo-file-system/legacy');
    const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
    if (!directory) {
      return fail(appError('unknown', 'Dosya klasörüne erişilemedi.'));
    }
    const target = `${directory}${fileName}`;
    await FileSystem.writeAsStringAsync(target, html, { encoding: FileSystem.EncodingType.UTF8 });
    await shareNativeFile(target, 'application/vnd.ms-excel', 'Excel raporunu paylaş', 'com.microsoft.excel.xls');
    return ok({ uri: target });
  } catch {
    return fail(appError('unknown', 'Excel raporu oluşturulamadı. Tekrar dene.'));
  }
}
