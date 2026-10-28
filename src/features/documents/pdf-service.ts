import { appError } from '@/services/errors';
import { fail, ok, type Result } from '@/utils/result';

import { buildPdfHtml, createDocumentId, sanitizeFileName } from './html';
import type { PdfDocumentSpec, PdfExportOptions, PdfExportResult } from './types';

type PrintModule = typeof import('expo-print');
type SharingModule = typeof import('expo-sharing');
type FileSystemModule = typeof import('expo-file-system/legacy');
type MailComposerModule = typeof import('expo-mail-composer');

type PdfModules = {
  Print: PrintModule;
  Sharing: SharingModule | null;
  FileSystem: FileSystemModule | null;
  Mail: MailComposerModule | null;
};

/**
 * Native modüller yalnızca PDF üretilirken yüklenir. Eski bir dev-client
 * derlemesinde bu modüller yoksa ekran çökmek yerine anlaşılır bir hata alır.
 */
async function loadPdfModules(): Promise<PdfModules | null> {
  let Print: PrintModule;
  try {
    Print = await import('expo-print');
  } catch {
    return null;
  }

  const [Sharing, FileSystem, Mail] = await Promise.all([
    import('expo-sharing').catch(() => null),
    import('expo-file-system/legacy').catch(() => null),
    import('expo-mail-composer').catch(() => null),
  ]);

  return { Print, Sharing, FileSystem, Mail };
}

async function saveCopy(uri: string, fileName: string, FileSystem: FileSystemModule | null): Promise<string> {
  if (!FileSystem) return uri;
  const directory = FileSystem.documentDirectory;
  if (!directory) return uri;
  try {
    const targetDirectory = `${directory}belgeler/`;
    await FileSystem.makeDirectoryAsync(targetDirectory, { intermediates: true }).catch(() => undefined);
    const target = `${targetDirectory}${fileName}`;
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    await FileSystem.copyAsync({ from: uri, to: target });
    return target;
  } catch {
    return uri;
  }
}

function pdfFileName(spec: PdfDocumentSpec, documentId: string, requested?: string): string {
  const base = requested?.trim() || `${spec.kind}-${documentId}`;
  const withExtension = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  return sanitizeFileName(withExtension);
}

/**
 * Belgeyi PDF'e dönüştürür ve seçilen eylemi uygular.
 *
 * - `share`: dosyayı oluşturup paylaşım sayfasını açar (native).
 * - `email`: dosyayı e-posta ekine koyar (mail istemcisi varsa).
 * - `print`: yazdırma / "PDF olarak kaydet" penceresini açar.
 *
 * Web'de `expo-print` dosya yerine tarayıcının yazdırma penceresini açar;
 * bu durumda `uri: null` ve `action: "print"` döner.
 */
export async function exportPdfDocument(
  spec: PdfDocumentSpec,
  options: PdfExportOptions = {},
): Promise<Result<PdfExportResult>> {
  const modules = await loadPdfModules();
  if (!modules) {
    return fail(
      appError(
        'unknown',
        'PDF oluşturmak için uygulamanın güncel sürümü gerekli. Lütfen uygulamayı güncelle.',
      ),
    );
  }

  const requestedAction = options.action ?? 'share';
  const documentId = spec.documentId ?? createDocumentId(spec.kind);
  const html = buildPdfHtml({ ...spec, documentId });

  if (requestedAction === 'print') {
    try {
      await modules.Print.printAsync({ html });
      return ok({ uri: null, action: 'print', documentId });
    } catch {
      return fail(appError('unknown', 'Yazdırma penceresi açılamadı. Tekrar dene.'));
    }
  }

  let generatedUri: string | null = null;
  try {
    const file = await modules.Print.printToFileAsync({ html, base64: false });
    generatedUri = (file as { uri?: string } | undefined)?.uri ?? null;
  } catch {
    return fail(appError('unknown', 'PDF oluşturulamadı. Tekrar dene.'));
  }

  // Web'de printToFileAsync doğrudan tarayıcı yazdırma penceresini açar.
  if (!generatedUri) {
    return ok({ uri: null, action: 'print', documentId });
  }

  const fileName = pdfFileName(spec, documentId, options.fileName);
  const uri = await saveCopy(generatedUri, fileName, modules.FileSystem);

  if (requestedAction === 'email') {
    const mail = modules.Mail;
    if (!mail) {
      return fail(
        appError('unknown', 'E-posta istemcisi bu derlemede bulunmuyor. PDF\'i paylaşarak gönderebilirsin.'),
      );
    }
    try {
      const available = await mail.isAvailableAsync();
      if (!available) {
        return fail(
          appError('unknown', 'Cihazda tanımlı bir e-posta hesabı yok. PDF\'i paylaşarak gönderebilirsin.'),
        );
      }
      await mail.composeAsync({
        recipients: options.email?.recipients,
        subject: options.email?.subject ?? spec.title,
        body: options.email?.body,
        attachments: [uri],
      });
      return ok({ uri, action: 'email', documentId });
    } catch {
      return fail(appError('unknown', 'E-posta oluşturulamadı. PDF\'i paylaşarak gönderebilirsin.'));
    }
  }

  const sharing = modules.Sharing;
  if (!sharing) {
    return fail(
      appError('unknown', 'Paylaşım bu derlemede bulunmuyor. PDF\'i yazdırarak kaydedebilirsin.'),
    );
  }

  try {
    if (await sharing.isAvailableAsync()) {
      await sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: options.dialogTitle ?? 'PDF\'i paylaş',
        UTI: 'com.adobe.pdf',
      });
      return ok({ uri, action: 'share', documentId });
    }
    await modules.Print.printAsync({ html });
    return ok({ uri, action: 'print', documentId });
  } catch {
    return fail(appError('unknown', 'PDF paylaşılamadı. Tekrar dene.'));
  }
}

/** Önizleme/test için HTML üretir; native modül yüklemez. */
export function renderPdfHtml(spec: PdfDocumentSpec): string {
  const documentId = spec.documentId ?? createDocumentId(spec.kind);
  return buildPdfHtml({ ...spec, documentId });
}
