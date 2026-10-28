import type { DocumentKind, ViewerDocument } from './types';

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;
const PDF_EXTENSION = /\.pdf$/i;
const IMAGE_MIME = /^image\//i;

/** Sorgu ve parça bilgisini atarak yalnızca dosya yolunu bırakır. */
function cleanPath(value?: string | null): string {
  return (value ?? '').split('?')[0]?.split('#')[0] ?? '';
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Belgenin türünü önce MIME, sonra dosya adı, en son adresin uzantısından
 * çıkarır. İmzalı depo adresleri dosya adını yolun sonunda taşıdığı için
 * yönetim panelinde MIME bilgisi olmayan kayıtlar da doğru açılır.
 */
export function resolveDocumentKind(
  document: Pick<ViewerDocument, 'url' | 'name' | 'mime'>,
): DocumentKind {
  const mime = (document.mime ?? '').trim().toLowerCase();
  if (IMAGE_MIME.test(mime)) {
    return 'image';
  }
  if (mime === 'application/pdf') {
    return 'pdf';
  }

  const name = decode(cleanPath(document.name));
  if (IMAGE_EXTENSION.test(name)) {
    return 'image';
  }
  if (PDF_EXTENSION.test(name)) {
    return 'pdf';
  }

  const path = decode(cleanPath(document.url));
  if (IMAGE_EXTENSION.test(path)) {
    return 'image';
  }
  if (PDF_EXTENSION.test(path)) {
    return 'pdf';
  }
  return 'other';
}

/** Adresten okunabilir dosya adı üretir (depo öneki temizlenir). */
export function fileNameFromDocument(
  document: Pick<ViewerDocument, 'url' | 'name'>,
): string | null {
  const explicit = document.name?.trim();
  if (explicit) {
    return explicit;
  }
  const path = decode(cleanPath(document.url));
  const last = path.split('/').filter(Boolean).pop();
  if (!last) {
    return null;
  }
  // Depo yolları `1712345678901-ab12cd-belge.jpg` biçiminde yazılır.
  return last.replace(/^\d{10,}-[a-z0-9]+-/i, '') || last;
}

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  image: 'Fotoğraf',
  pdf: 'PDF belge',
  other: 'Dosya',
};
