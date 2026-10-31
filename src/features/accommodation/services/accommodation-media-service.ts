import { Image } from 'react-native';

import { appError } from '@/services/errors';
import {
  R2_ENABLED,
  deleteFromR2,
  isR2Path,
  r2PublicUrl,
  uploadToR2,
} from '@/features/media/r2-service';
import { localFileSize } from '@/features/media/local-file';
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

/**
 * Vitrinde bir kart ~350 px genişlikte gösteriliyor. 4000 px'lik telefon
 * fotoğrafını olduğu gibi yüklemek, ana sayfada 40 kart açıldığında onlarca MB
 * indirme ve çözme maliyeti demek. Bu yüzden tesis fotoğrafları yüklemeden önce
 * tek geçişte 1600 px / JPEG'e indirilir (paylaşım akışındaki ile aynı sınır).
 */
const IMAGE_MAX_SIDE = 1600;
const IMAGE_SKIP_BYTES = 900_000;
const UNIVERSAL_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type PreparedAccommodationImage = { uri: string; mime: string; size: number | null };

let manipulatorPromise: Promise<typeof import('expo-image-manipulator') | null> | null = null;

/** Görsel işleyici yalnızca gerçekten gerektiğinde yüklenir (vitrin paketi şişmesin). */
function loadImageManipulator() {
  if (!manipulatorPromise) {
    manipulatorPromise = import('expo-image-manipulator').catch(() => null);
  }
  return manipulatorPromise;
}

function readImageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve(width > 0 && height > 0 ? { width, height } : null),
      () => resolve(null),
    );
  });
}

/**
 * Fotoğrafı yüklemeye hazırlar. Zaten küçük ve her platformda açılan bir görsel
 * yeniden kodlanmaz. İşlem başarısız olursa (ör. web'de HEIC) yükleme
 * engellenmez; dosya olduğu gibi gönderilir.
 */
async function prepareAccommodationImage(
  uri: string,
  mime: string,
  size: number | null,
): Promise<PreparedAccommodationImage | null> {
  const dims = await readImageSize(uri);
  const longest = dims ? Math.max(dims.width, dims.height) : 0;
  const universal = UNIVERSAL_IMAGE_TYPES.has(mime);
  const knownSize = size ?? (await localFileSize(uri));

  if (universal && longest > 0 && longest <= IMAGE_MAX_SIDE && knownSize !== null && knownSize <= IMAGE_SKIP_BYTES) {
    return null;
  }

  const module = await loadImageManipulator();
  if (!module) {
    return null;
  }

  try {
    const context = module.ImageManipulator.manipulate(uri);
    if (dims && longest > IMAGE_MAX_SIDE) {
      context.resize(dims.width >= dims.height ? { width: IMAGE_MAX_SIDE } : { height: IMAGE_MAX_SIDE });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.82, format: module.SaveFormat.JPEG });
    return { uri: saved.uri, mime: 'image/jpeg', size: await localFileSize(saved.uri) };
  } catch {
    return null;
  }
}

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
  if (mime === 'image/heic') return 'heic';
  if (mime === 'image/heif') return 'heif';
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
  // Yeni yüklemeler R2'de (`<uid>/r2/...`); R2 öncesi kayıtlar Supabase'de.
  if (isR2Path(path)) {
    return (
      r2PublicUrl(ACCOMMODATION_MEDIA_BUCKET, path) ??
      supabase.storage.from(ACCOMMODATION_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl ??
      null
    );
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

  // Vitrin görseli yüklemeden önce küçültülür; dosya boyutu ve çözünürlük
  // kaynağında sınırlanınca liste sayfası hafif kalır.
  const prepared =
    input.kind === 'image'
      ? await prepareAccommodationImage(input.uri, mime, input.size ?? null).catch(() => null)
      : null;
  const uploadUri = prepared?.uri ?? input.uri;
  const uploadMime = prepared?.mime ?? mime;

  const extension = prepared ? 'jpg' : extensionOf(input.name, mime);
  const clean = input.name.replace(SAFE_NAME, '_').slice(0, 60) || `medya.${extension}`;
  // R2 imzalama servisi anahtar biçimini `<bucket>/<uid>/r2/<dosya>` olarak
  // doğrular (tam 4 parça). Tesis kimliği buraya eklenirse anahtar reddedilir
  // ve yükleme 403 ile düşer; tesis–medya bağı acc_property_media tablosunda.
  const path = `${uid}/r2/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${clean}`;

  if (R2_ENABLED) {
    const uploaded = await uploadToR2({
      bucket: ACCOMMODATION_MEDIA_BUCKET,
      path,
      uri: uploadUri,
      contentType: uploadMime,
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
      mime: uploadMime,
      size: uploaded.data.size ?? prepared?.size ?? input.size ?? null,
    });
  }

  try {
    const response = await fetch(uploadUri);
    const buffer = await response.arrayBuffer();
    if (input.signal?.aborted) {
      return fail(appError('cancelled'));
    }
    const stored = await fallbackPublicUpload(path, buffer, uploadMime);
    if (!stored.ok) {
      return stored;
    }
    input.onProgress?.(1);
    const url = accommodationMediaUrl(path);
    if (!url) {
      return fail(appError('unknown', 'Yüklenen medyanın adresi oluşturulamadı.'));
    }
    return ok({ path, url, kind: input.kind, mime: uploadMime, size: buffer.byteLength });
  } catch {
    return fail(appError('network', 'Medya okunamadı. Tekrar dene.'));
  }
}

export async function deleteAccommodationMedia(path: string): Promise<void> {
  if (R2_ENABLED && isR2Path(path)) {
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
