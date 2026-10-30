import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import { localFileSize, releaseTempFile } from './local-file';
import {
  deleteFromR2,
  isPrivateBucket,
  isR2Path,
  R2_ENABLED,
  r2PublicUrl,
  signedR2GetUrls,
  uploadToR2,
} from './r2-service';
import {
  generateVideoPoster,
  prepareVideoForUpload,
  type PreparedVideo,
} from './video-service';

export type MediaBucket =
  | 'posts'
  | 'stories'
  | 'listing-images'
  | 'message-media'
  | 'reels'
  | 'place-media'
  | 'real-estate-media'
  | 'ad-media';

export type UploadInput = {
  bucket: MediaBucket;
  /** Folder segment: owner id for public buckets, conversation id for chat media. */
  folder: string;
  /** Required for `message-media`: the storage policy pins the file name prefix. */
  uploaderId?: string;
  uri: string;
  mime?: string | null;
  fileName?: string | null;
  /** Görseller mobil veri için küçültülür. Videolar yükleme hızı için sıkıştırılır. */
  compressImages?: boolean;
  /** Varsayılan true: video paylaşılmadan önce hızlı yükleme için yeniden kodlanır. */
  compressVideos?: boolean;
  /** Video seçildiğinde bilinen meta (yeniden okumayı önler). */
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  /** Sıkıştırma (0..1) ve yükleme aşamaları için ilerleme bildirimi. */
  onProgress?: (stage: UploadStage, ratio: number) => void;
  /**
   * İptal sinyali. Paylaşım sürerken kullanıcı vazgeçerse hazırlık ve yükleme
   * durdurulur; yarım kalan dosya depoda bırakılmaz.
   */
  signal?: AbortSignal;
};

export type UploadStage = 'preparing' | 'uploading';

export type UploadedMedia = {
  path: string;
  publicUrl: string | null;
  mediaType: 'image' | 'video';
  mime: string;
  size: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Video için üretilen kapak görselinin storage yolu. */
  thumbnailPath?: string | null;
  thumbnailUrl?: string | null;
};

export type UploadedVideo = {
  video: UploadedMedia;
  poster: UploadedMedia | null;
};

const SAFE_SEGMENT = /[^a-zA-Z0-9._-]/g;

const cleanSegment = (value: string) => value.replace(SAFE_SEGMENT, '_');

function extensionFor(mime: string, uri: string): string {
  const fromUri = /\.([a-zA-Z0-9]{2,5})(?:\?|$)/.exec(uri)?.[1];
  if (fromUri) {
    return fromUri.toLowerCase();
  }
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  return 'jpg';
}

function kindFor(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

function inferMime(uri: string, mime?: string | null): string {
  if (mime) {
    return mime;
  }
  const lower = uri.toLowerCase();
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/** Görselin piksel boyutunu tam çözmeden okur (native metadata). */
function readImageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve(width > 0 && height > 0 ? { width, height } : null),
      () => resolve(null),
    );
  });
}

/** Görselin yeniden kodlanmadan yüklenebileceği üst sınırlar. */
const IMAGE_MAX_SIDE = 1600;
const IMAGE_SKIP_BYTES = 1_500_000;
/** Yeniden kodlamadan geçirilebilecek (her cihazda görüntülenen) biçimler. */
const SKIPPABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SKIPPABLE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

/**
 * Görseli tek geçişte boyutlandırıp JPEG'e çevirir. Önceden iki kez render
 * ediliyordu (boyut okuma + yeniden boyutlandırma); çoklu fotoğraf
 * gönderilerinde bu, sıkıştırma süresini ikiye katlıyordu.
 */
async function compressImage(
  uri: string,
  maxSize: number,
  dims: { width: number; height: number } | null,
): Promise<string> {
  const context = ImageManipulator.manipulate(uri);

  if (dims) {
    const longest = Math.max(dims.width, dims.height);
    if (longest > maxSize) {
      context.resize(dims.width >= dims.height ? { width: maxSize } : { height: maxSize });
    }
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.84, format: SaveFormat.JPEG });
  return saved.uri;
}

type PreparedImage = {
  uri: string;
  mime: string;
  extension: string;
  width: number | null;
  height: number | null;
  size: number | null;
};

/**
 * Fotoğrafı yüklemeye hazırlar.
 *
 * Küçük ve zaten evrensel biçimde olan görseller (sohbet ekran görüntüleri,
 * indirilmiş fotoğraflar) hiç yeniden kodlanmaz: cihazda render + JPEG encode
 * etmek yükleme başlamadan önce yüzlerce milisaniye kaybettiriyordu. HEIC gibi
 * her platformda açılmayan biçimler ve büyük fotoğraflar ise küçültülür.
 */
async function prepareImage(
  uri: string,
  mime: string,
  fileSize: number | null,
): Promise<PreparedImage> {
  const dims = await readImageSize(uri);
  const extension = extensionFor(mime, uri);
  const size = fileSize ?? (await localFileSize(uri));
  const longest = dims ? Math.max(dims.width, dims.height) : 0;

  if (
    dims &&
    longest <= IMAGE_MAX_SIDE &&
    SKIPPABLE_IMAGE_TYPES.has(mime) &&
    SKIPPABLE_EXTENSIONS.has(extension) &&
    size !== null &&
    size <= IMAGE_SKIP_BYTES
  ) {
    return { uri, mime, extension, width: dims.width, height: dims.height, size };
  }

  const compressed = await compressImage(uri, IMAGE_MAX_SIDE, dims);
  const compressedSize = await localFileSize(compressed);
  return {
    uri: compressed,
    mime: 'image/jpeg',
    extension: 'jpg',
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    size: compressedSize ?? size,
  };
}

function fileNameFor(
  bucket: MediaBucket,
  uploaderId: string | undefined,
  kind: 'image' | 'video',
  extension: string,
): string {
  const random = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  if (bucket === 'message-media') {
    return `${cleanSegment(uploaderId ?? '')}-${kind}-${random}`;
  }
  return `${kind}-${random}`;
}

/**
 * Uploads one media file and returns its storage path. Nothing is written to a
 * table here: the caller commits the path through an RPC so a failed metadata
 * write can never leave a "ghost" post.
 *
 * Video boyutundan dolayı reddedilmez: depo sınırının üzerindeki dosyalar
 * paylaşımdan önce cihazda sıkıştırılır.
 */
export async function uploadMedia(input: UploadInput): Promise<Result<UploadedMedia>> {
  const guessedMime = inferMime(input.uri, input.mime);
  const kind = kindFor(guessedMime);

  if (input.signal?.aborted) {
    return fail(appError('cancelled'));
  }

  if (kind === 'audio' || kind === 'file') {
    if (input.bucket !== 'message-media') {
      return fail(appError('invalid_input', 'Bu dosya türü yalnızca mesajlarda paylaşılabilir.'));
    }
  }

  if (input.bucket === 'message-media' && !input.uploaderId) {
    return fail(appError('invalid_input', 'Medya yüklemek için oturum bilgisi eksik.'));
  }

  let preparedUri = input.uri;
  let contentType = guessedMime;
  let extension = extensionFor(guessedMime, input.fileName ?? input.uri);
  let width = input.width ?? null;
  let height = input.height ?? null;
  let durationMs = input.durationMs ?? null;
  let size: number | null = input.fileSize ?? null;
  let preparedVideo: PreparedVideo | null = null;

  if (kind === 'image' && input.compressImages !== false) {
    try {
      const prepared = await prepareImage(input.uri, guessedMime, input.fileSize ?? null);
      preparedUri = prepared.uri;
      contentType = prepared.mime;
      extension = prepared.extension;
      width = prepared.width ?? width;
      height = prepared.height ?? height;
      size = prepared.size ?? size;
    } catch {
      return fail(appError('unknown', 'Görsel işlenemedi. Başka bir fotoğraf dene.'));
    }
  }

  if (kind === 'video' && input.compressVideos !== false) {
    input.onProgress?.('preparing', 0);
    const source = {
      uri: input.uri,
      durationMs,
      width,
      height,
      size,
    };
    preparedVideo = await prepareVideoForUpload(source, {
      // Sohbet medyası da sınırsız: R2'ye gider, sıkıştırma yalnızca hız için.
      onProgress: (ratio) => input.onProgress?.('preparing', ratio),
      signal: input.signal,
    });
    if (input.signal?.aborted) {
      // Sıkıştırma sırasında vazgeçildiyse geçici çıktıyı depoya taşımayalım.
      if (preparedVideo.compressed) {
        void releaseTempFile(preparedVideo.uri);
      }
      return fail(appError('cancelled'));
    }
    preparedUri = preparedVideo.uri;
    width = preparedVideo.width ?? width;
    height = preparedVideo.height ?? height;
    durationMs = preparedVideo.durationMs ?? durationMs;
    size = preparedVideo.size ?? size;
    // Native sıkıştırıcı her iki platformda da MP4 üretir.
    contentType = 'video/mp4';
    extension = 'mp4';

    // Boyut meta veriden gelmediyse diskten okunur.
    if (size === null) {
      size = await localFileSize(preparedUri);
    }
  }

  // Depolama politikası: bütün medya Cloudflare R2'ye yazılır. R2'de tek dosya
  // boyutu sınırı yoktur; sıkıştırma yalnızca paylaşım hızı içindir.
  // Gizli sohbet medyası ayrı (private) bucket'a gider ve yalnızca imzalı GET
  // adresiyle okunur, bu yüzden public URL üretilmez.
  if (!R2_ENABLED) {
    return fail(
      appError(
        'unknown',
        'Cloudflare R2 medya deposu yapılandırılmadı (EXPO_PUBLIC_R2_PUBLIC_URL eksik). Yükleme yapılamaz.',
      ),
    );
  }

  const r2Path = `${cleanSegment(input.folder)}/r2/${fileNameFor(
    input.bucket,
    input.uploaderId,
    kind === 'video' ? 'video' : 'image',
    extension,
  )}`;
  input.onProgress?.('uploading', 0);
  const uploaded = await uploadToR2({
    bucket: input.bucket,
    path: r2Path,
    uri: preparedUri,
    contentType,
    signal: input.signal,
    onProgress: (ratio) => input.onProgress?.('uploading', ratio),
  });
  if (!uploaded.ok) {
    return fail(uploaded.error);
  }
  input.onProgress?.('uploading', 1);
  return ok({
    path: uploaded.data.path,
    publicUrl: isPrivateBucket(input.bucket) ? null : uploaded.data.publicUrl || null,
    mediaType: kind === 'video' ? 'video' : 'image',
    mime: contentType,
    size: kind === 'video' ? (size ?? uploaded.data.size) : uploaded.data.size,
    width,
    height,
    durationMs,
    thumbnailPath: null,
    thumbnailUrl: null,
  });
}

/**
 * Video + kapak görselini birlikte yükler. Kapak, feed'de videoyu indirmeden
 * anında önizleme göstermek için kullanılır.
 *
 * Kapak, videonun yüklenmesini beklemeden paralel hazırlanıp yüklenir. Önceden
 * video bittikten sonra kapak üretilip ayrı bir istekle yükleniyordu; bu da her
 * paylaşıma fazladan bir tur ekliyordu.
 */
export async function uploadVideoWithPoster(input: UploadInput): Promise<Result<UploadedVideo>> {
  const mime = input.mime ?? 'video/mp4';
  const uploadPoster = mime.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(input.uri);

  const posterTask = (async (): Promise<UploadedMedia | null> => {
    // Kapak orijinal videodan üretilir; sıkıştırma sonucunu beklemek gerekmez.
    const poster = await generateVideoPoster(input.uri);
    if (!poster) {
      return null;
    }
    const uploaded = await uploadMedia({
      bucket: input.bucket,
      folder: input.folder,
      uploaderId: input.uploaderId,
      uri: poster.uri,
      mime: 'image/jpeg',
      fileName: 'poster.jpg',
      // Kapak zaten 0.72 kalitede küçük bir JPEG; yeniden kodlamak gereksiz.
      compressImages: false,
      signal: input.signal,
    });
    return uploaded.ok ? uploaded.data : null;
  })();

  const video = await uploadMedia({ ...input, mime });

  if (!video.ok) {
    // Video yüklenemezse yarım kalan kapak depoda kalmasın.
    if (uploadPoster) {
      const orphan = await posterTask;
      if (orphan) {
        void removeMedia(input.bucket, [orphan.path]);
      }
    }
    return video;
  }

  if (video.data.mediaType !== 'video' || !uploadPoster) {
    return ok({ video: video.data, poster: null });
  }

  const poster = await posterTask;
  if (!poster) {
    // Kapak yüklenemezse video paylaşımı yine de tamamlanır.
    return ok({ video: video.data, poster: null });
  }

  return ok({
    video: {
      ...video.data,
      // Sıkıştırıcı video boyutlarını bildirmezse kapak karesinin oranı
      // kullanılır. Aksi hâlde akış kartı videoyu kare kırpıyordu.
      width: video.data.width ?? poster.width ?? null,
      height: video.data.height ?? poster.height ?? null,
      durationMs: video.data.durationMs ?? input.durationMs ?? null,
      thumbnailPath: poster.path,
      thumbnailUrl: poster.publicUrl,
    },
    poster,
  });
}

/** Public URL for post/story/listing media. Message media uses signed URLs. */
export function publicMediaUrl(
  bucket: Exclude<MediaBucket, 'message-media'>,
  path: string | null | undefined,
) {
  if (!path) {
    return null;
  }
  // R2'ye taşınmış büyük videolar aynı yol biçimiyle saklanır.
  if (isR2Path(path)) {
    return r2PublicUrl(bucket, path);
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl || null;
}

/**
 * Depolama yoluna göre doğru depodan siler: R2 yolları (`<uid>/r2/...`) imzalı
 * DELETE ile, eski Supabase yolları Storage API'si ile temizlenir. Silme en iyi
 * çabadır; ana kayıt zaten silindiği için kullanıcıya hata gösterilmez.
 */
export async function removeMedia(bucket: MediaBucket, paths: string[]) {
  const unique = Array.from(new Set(paths.filter((path): path is string => Boolean(path))));
  if (unique.length === 0) {
    return;
  }

  const r2Paths = unique.filter((path) => isR2Path(path));
  const legacyPaths = unique.filter((path) => !isR2Path(path));

  if (r2Paths.length > 0) {
    await deleteFromR2(bucket, r2Paths);
  }

  if (legacyPaths.length > 0) {
    try {
      await supabase.storage.from(bucket).remove(legacyPaths);
    } catch {
      // En iyi çaba.
    }
  }
}

/**
 * İmzalı sohbet medyası adresleri süreç içinde önbelleklenir.
 *
 * Sohbet ekranı her yeni mesajda tüm medya yollarını yeniden imzalıyordu. URL
 * ömrü bir saat olduğu için aynı dosyayı tekrar tekrar imzalamak, yeni gelen
 * bir fotoğrafın görünmesini saniyelerce geciktiren gereksiz bir ağ turuydu.
 */
const SIGNED_URL_CACHE_LIMIT = 800;
/** Süresi dolmaya bu kadar kala yeniden imzalanır. */
const SIGNED_URL_SAFETY_MS = 5 * 60_000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function cacheSignedUrl(path: string, url: string, ttlMs: number) {
  if (!path || !url) {
    return;
  }
  signedUrlCache.set(path, { url, expiresAt: Date.now() + ttlMs });
  while (signedUrlCache.size > SIGNED_URL_CACHE_LIMIT) {
    const oldest = signedUrlCache.keys().next();
    if (oldest.done) {
      break;
    }
    signedUrlCache.delete(oldest.value);
  }
}

/**
 * Gizli sohbet medyasını imzalar.
 *
 * Yeni medya R2'deki private bucket'ta durur ve `r2-sign` üzerinden tek turda
 * toplu imzalanır. Eski (R2 öncesi) mesajlar Supabase Storage'da kaldığı için
 * onlar da imzalanır; iki yol aynı haritada birleşir. Önbellekte geçerli adresi
 * olan yollar hiç istemez: yeni gelen tek bir fotoğraf için tek yol imzalanır.
 */
export async function signedMessageUrls(
  paths: string[],
  expiresIn = 3600,
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) {
    return {};
  }

  const ttlMs = Math.max(60, expiresIn) * 1000;
  const map: Record<string, string> = {};
  const missing: string[] = [];
  const now = Date.now();
  for (const path of unique) {
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt - SIGNED_URL_SAFETY_MS > now) {
      map[path] = cached.url;
    } else {
      missing.push(path);
    }
  }

  if (missing.length === 0) {
    return map;
  }

  const r2Paths = missing.filter((path) => isR2Path(path));
  const legacyPaths = missing.filter((path) => !isR2Path(path));

  if (r2Paths.length > 0) {
    Object.assign(map, await signedR2GetUrls('message-media', r2Paths));
  }

  if (legacyPaths.length > 0) {
    try {
      const { data, error } = await supabase.storage
        .from('message-media')
        .createSignedUrls(legacyPaths, expiresIn);
      if (!error && data) {
        for (const entry of data) {
          if (entry.signedUrl && entry.path) {
            map[entry.path] = entry.signedUrl;
          }
        }
      }
    } catch {
      // Eski medya imzalanamazsa yeni medya yine gösterilir.
    }
  }

  for (const [path, url] of Object.entries(map)) {
    cacheSignedUrl(path, url, ttlMs);
  }

  return map;
}

export function mediaKindLabel(
  mime: string | null | undefined,
): 'image' | 'video' | 'audio' | 'file' {
  return kindFor(mime ?? 'application/octet-stream');
}
