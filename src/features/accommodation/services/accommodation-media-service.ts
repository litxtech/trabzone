import { appError } from '@/services/errors';
import { R2_ENABLED, deleteFromR2, r2PublicUrl, uploadToR2 } from '@/features/media/r2-service';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

/**
 * Konaklama medya yükleme yardımcıları.
 *
 * Tesis fotoğraf ve videoları herkese açık `accommodation-media` kovasına,
 * işletme/vergi belgeleri ise gizli `accommodation-documents` kovasına yüklenir.
 * R2 yapılandırılmamışsa medya Supabase Storage'daki aynı adlı kovaya düşer;
 * böylece geliştirme ortamında da akış çalışır.
 */

export const ACCOMMODATION_MEDIA_BUCKET = 'accommodation-media';
export const ACCOMMODATION_DOCUMENT_BUCKET = 'accommodation-documents';

const IMAGE_LIMIT = 25 * 1024 * 1024;
const VIDEO_LIMIT = 250 * 1024 * 1024;
const DOCUMENT_LIMIT = 15 * 1024 * 1024;
const SAFE_NAME = /[^a-zA-Z0-9._-]/g;

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export type AccommodationUploadKind = 'image' | 'video';

export type UploadedAccommodationMedia = {
  path: string;
  url: string;
  kind: AccommodationUploadKind;
  mime: string;
  size: number | null;
};

function extensionOf(name: string, mime: string): string {
  const fromName = name.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) {
    return fromName;
  }
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'application/pdf') return 'pdf';
  return 'bin';
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export function accommodationMediaUrl(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  if (R2_ENABLED) {
    const url = r2PublicUrl(ACCOMMODATION_MEDIA_BUCKET, path);
    if (url) {
      return url;
    }
  }
  return supabase.storage.from(ACCOMMODATION_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl || null;
}

async function fallbackPublicUpload(path: string, body: ArrayBuffer, mime: string): Promise<Result<string>> {
  const { error } = await supabase.storage.from(ACCOMMODATION_MEDIA_BUCKET).upload(path, body, {
    contentType: mime,
    upsert: false,
  });
  if (error) {
    return fail(
      appError(
        'unknown',
        error.message.toLowerCase().includes('bucket not found')
          ? 'Medya deposu hazır değil. Yönetici depolama kovasını oluşturmalı.'
          : 'Medya yüklenemedi. Bağlantını kontrol edip tekrar dene.',
      ),
    );
  }
  return ok(path);
}

export async function uploadAccommodationMedia(input: {
  propertyId: string;
  uri: string;
  name: string;
  mime: string;
  kind: AccommodationUploadKind;
  size?: number | null;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}): Promise<Result<UploadedAccommodationMedia>> {
  const uid = await currentUserId();
  if (!uid) {
    return fail(appError('session_missing'));
  }

  const mime = input.mime.toLowerCase();
  if (input.kind === 'image' && !IMAGE_MIME.has(mime)) {
    return fail(appError('invalid_input', 'Yalnızca JPG, PNG, WEBP veya HEIC fotoğraf yükleyebilirsin.'));
  }
  if (input.kind === 'video' && !VIDEO_MIME.has(mime)) {
    return fail(appError('invalid_input', 'Yalnızca MP4, MOV veya WEBM video yükleyebilirsin.'));
  }
  if (input.size && input.size > (input.kind === 'video' ? VIDEO_LIMIT : IMAGE_LIMIT)) {
    return fail(
      appError(
        'invalid_input',
        input.kind === 'video'
          ? 'Video 250 MB sınırını aşıyor.'
          : 'Fotoğraf 25 MB sınırını aşıyor.',
      ),
    );
  }

  const extension = extensionOf(input.name, mime);
  const clean = input.name.replace(SAFE_NAME, '_').slice(0, 60) || `medya.${extension}`;
  const path = `${uid}/acc/${input.propertyId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${clean}`;

  if (R2_ENABLED) {
    const uploaded = await uploadToR2({
      bucket: ACCOMMODATION_MEDIA_BUCKET,
      path,
      uri: input.uri,
      contentType: mime,
      onProgress: input.onProgress,
      signal: input.signal,
    });
    if (!uploaded.ok) {
      return uploaded;
    }
    const url = accommodationMediaUrl(path);
    if (!url) {
      return fail(appError('unknown', 'Yüklenen medyanın adresi oluşturulamadı.'));
    }
    return ok({
      path,
      url,
      kind: input.kind,
      mime,
      size: uploaded.data.size ?? input.size ?? null,
    });
  }

  try {
    const response = await fetch(input.uri);
    const buffer = await response.arrayBuffer();
    if (input.signal?.aborted) {
      return fail(appError('cancelled'));
    }
    const stored = await fallbackPublicUpload(path, buffer, mime);
    if (!stored.ok) {
      return stored;
    }
    input.onProgress?.(1);
    const url = accommodationMediaUrl(path);
    if (!url) {
      return fail(appError('unknown', 'Yüklenen medyanın adresi oluşturulamadı.'));
    }
    return ok({ path, url, kind: input.kind, mime, size: buffer.byteLength });
  } catch {
    return fail(appError('network', 'Medya okunamadı. Tekrar dene.'));
  }
}

export async function deleteAccommodationMedia(path: string): Promise<void> {
  if (R2_ENABLED) {
    await deleteFromR2(ACCOMMODATION_MEDIA_BUCKET, [path]);
    return;
  }
  await supabase.storage.from(ACCOMMODATION_MEDIA_BUCKET).remove([path]);
}

/**
 * Gizli belgeyi tesise bağlı klasöre yükler. Yolun ilk segmenti tesis kimliği
 * olmalıdır; Storage RLS politikası yetkiyi bu klasörden doğrular.
 */
export async function uploadAccommodationDocument(input: {
  propertyId: string;
  uri: string;
  name: string;
  mime: string;
  size?: number | null;
}): Promise<Result<{ path: string; name: string; size: number | null }>> {
  const mime = input.mime.toLowerCase();
  if (mime !== 'application/pdf' && !IMAGE_MIME.has(mime)) {
    return fail(appError('invalid_input', 'Belge PDF, JPG veya PNG olmalı.'));
  }
  if (input.size && input.size > DOCUMENT_LIMIT) {
    return fail(appError('invalid_input', 'Belge 15 MB sınırını aşıyor.'));
  }

  const extension = extensionOf(input.name, mime);
  const clean = input.name.replace(SAFE_NAME, '_').slice(0, 60) || `belge.${extension}`;
  const path = `${input.propertyId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${clean}`;

  try {
    const response = await fetch(input.uri);
    const buffer = await response.arrayBuffer();
    const { error } = await supabase.storage.from(ACCOMMODATION_DOCUMENT_BUCKET).upload(path, buffer, {
      contentType: mime,
      upsert: false,
    });
    if (error) {
      return fail(
        appError(
          'unknown',
          error.message.toLowerCase().includes('bucket not found')
            ? 'Belge deposu hazır değil. Yönetici depolama kovasını oluşturmalı.'
            : 'Belge yüklenemedi. Tekrar dene.',
        ),
      );
    }
    return ok({ path, name: input.name.slice(0, 120), size: input.size ?? buffer.byteLength });
  } catch {
    return fail(appError('network', 'Belge okunamadı. Tekrar dene.'));
  }
}

export async function accommodationDocumentUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) {
    return null;
  }
  const { data, error } = await supabase.storage
    .from(ACCOMMODATION_DOCUMENT_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error) {
    return null;
  }
  return data.signedUrl;
}
