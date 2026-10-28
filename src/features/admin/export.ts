import { Platform } from 'react-native';

type Column = { key: string; label: string };
type Row = Record<string, unknown>;

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const csvCell = (value: unknown) => {
  const text = cellText(value).replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${text}"`;
};

export function buildCsv(columns: Column[], rows: Row[]): string {
  const header = columns.map((column) => csvCell(column.label)).join(';');
  const body = rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(';'));
  return `\uFEFF${[header, ...body].join('\r\n')}`;
}

const xmlEscape = (value: unknown) =>
  cellText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function buildExcelXml(sheetName: string, columns: Column[], rows: Row[]): string {
  const headerCells = columns
    .map((column) => `<Cell><Data ss:Type="String">${xmlEscape(column.label)}</Data></Cell>`)
    .join('');

  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const raw = row[column.key];
          const numeric = typeof raw === 'number' && Number.isFinite(raw);
          return `<Cell><Data ss:Type="${numeric ? 'Number' : 'String'}">${xmlEscape(raw)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${xmlEscape(sheetName.slice(0, 31) || 'Rapor')}">
  <Table>
   <Row>${headerCells}</Row>
   ${bodyRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

function webDownload(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Web'de dosyayı indirir. Native istemcide pano kopyasına düşer; yönetim
 * panelinin birincil hedefi web tarayıcısıdır ve native'de sessiz başarısızlık
 * üretmek yerine kullanıcıya açık geri bildirim verilir.
 */
export async function exportFile(input: {
  content: string;
  mime: string;
  filename: string;
}): Promise<'downloaded' | 'copied'> {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    webDownload(input.content, input.mime, input.filename);
    return 'downloaded';
  }

  const Clipboard = await import('expo-clipboard');
  await Clipboard.setStringAsync(input.content);
  return 'copied';
}
