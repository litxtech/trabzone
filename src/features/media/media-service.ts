import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { env } from '@/config/env';
import { fail, ok, type Result } from '@/utils/result';

import { loadLegacyFileSystem, localFileSize, type LegacyFileSystem } from './local-file';
import { deleteFromR2, R2_ENABLED, isR2Path, r2PublicUrl, uploadToR2 } from './r2-service';
import {
  generateVideoPoster,
  prepareVideoForUpload,
  VIDEO_UPLOAD_LIMIT,
  type PreparedVideo,
} from './video-service';

export type MediaBucket =
  | 'posts'
  | 'stories'
  | 'listing-images'
  | 'message-media'
  | 'reels'
  | 'place-media'
  | 'real-estate-media';

export type UploadInput = {
  bucket: MediaBucket;
  /** Folder segment: owner id for public buckets, conversation id for chat media. */
  folder: string;
  /** Required for `message-media`: the storage policy pins the file name prefix. */
  uploaderId?: string;
  uri: string;
  mime?: string | null;
  fileName?: string | null;
  /** Images are downscaled for mobile data. Videos are compressed to fit the storage limit unless disabled. */
  compressImages?: boolean;
  /** Varsayılan true: video paylaşılmadan önce depo sınırına sığdırılır. */
  compressVideos?: boolean;
  /** Video seçildiğinde bilinen meta (yeniden okumayı önler). */
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  /** Sıkıştırma (0..1) ve yükleme aşamaları için ilerleme bildirimi. */
  onProgress?: (stage: UploadStage, ratio: number) => void;
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

/**
 * Tek dosya için pratik üst sınır: depo tarafındaki tek dosya sınırı. Ürün
 * tarafında süre/boyut sınırı yoktur; video hazırlığı bu sınıra göre bit hızı
 * seçer (bkz. `prepareVideoForUpload`). Buradaki kontrol yalnızca son güvenlik
 * ağıdır.
 */
const MAX_UPLOAD_BYTES = VIDEO_UPLOAD_LIMIT;
/** Akış yolu yoksa belleğe alınabilecek en büyük dosya (OOM koruması). */
const MAX_IN_MEMORY_BYTES = 32 * 1024 * 1024;

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

/**
 * Görseli tek geçişte boyutlandırıp JPEG'e çevirir. Önceden iki kez render
 * ediliyordu (boyut okuma + yeniden boyutlandırma); çoklu fotoğraf
 * gönderilerinde bu, sıkıştırma süresini ikiye katlıyordu.
 */
async function compressImage(uri: string, maxSize: number): Promise<string> {
  const dims = await readImageSize(uri);
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

function tooLargeError(maxBytes: number) {
  const gb = maxBytes / (1024 * 1024 * 1024);
  const label =
    gb >= 1 ? `${Number(gb.toFixed(gb >= 10 ? 0 : 1))} GB` : `${Math.round(maxBytes / (1024 * 1024))} MB`;
  return appError('invalid_input', `Dosya ${label} sınırını aşıyor.`);
}

function uploadErrorMessage(raw: string | null | undefined) {
  const text = (raw ?? '').toLowerCase();
  if (text.includes('bucket not found')) {
    return 'Medya deposu hazır değil. Lütfen daha sonra tekrar dene.';
  }
  if (text.includes('too large') || text.includes('413') || text.includes('exceeded')) {
    return 'Dosya depo sınırının üzerinde. Daha büyük dosyalar için depo ayarlarındaki dosya boyutu sınırını yükselt.';
  }
  return 'Medya yüklenemedi. Bağlantını kontrol edip tekrar dene.';
}

type PutInput = {
  bucket: MediaBucket;
  folder: string;
  uploaderId?: string;
  uri: string;
  contentType: string;
  extension: string;
  kind: 'image' | 'video';
  maxBytes: number;
  onProgress?: (ratio: number) => void;
};

/**
 * Dosyayı diskten doğrudan imzalı URL'ye akıtır. Önceden dosya `fetch` +
 * `arrayBuffer` ile belleğe alınıp yükleniyordu; 10 MB'lık bir videoda bile
 * fazladan kopya ve yavaş JS köprüsü trafiği oluşuyordu. Akış yolu native
 * tarafta dosyayı olduğu gibi gönderir ve gerçek yükleme yüzdesi verir.
 *
 * İmzalı URL alınamazsa `null` döner ve çağıran bellek içi yola düşer.
 */
async function streamUpload(
  fs: LegacyFileSystem,
  input: PutInput,
  path: string,
): Promise<Result<{ path: string; size: number | null }> | null> {
  let signedUrl: string | null = null;
  try {
    const { data, error } = await supabase.storage.from(input.bucket).createSignedUploadUrl(path);
    if (!error && data?.signedUrl) {
      signedUrl = data.signedUrl;
    }
  } catch {
    signedUrl = null;
  }
  if (!signedUrl) {
    return null;
  }

  const knownSize = await localFileSize(input.uri);
  if (knownSize !== null && knownSize > input.maxBytes) {
    return fail(tooLargeError(input.maxBytes));
  }

  try {
    const task = fs.createUploadTask(
      signedUrl,
      input.uri,
      {
        httpMethod: 'PUT',
        uploadType: fs.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'Content-Type': input.contentType,
          'cache-control': 'max-age=31536000',
          'x-upsert': 'false',
          // İmzalı URL token'ı yetkilendirmeyi taşır; anahtar gateway için.
          Authorization: `Bearer ${env.supabasePublishableKey}`,
        },
      },
      (progress) => {
        if (progress.totalBytesExpectedToSend > 0) {
          input.onProgress?.(
            Math.min(1, progress.totalBytesSent / progress.totalBytesExpectedToSend),
          );
        }
      },
    );

    const result = await task.uploadAsync();

    if (result && result.status >= 200 && result.status < 300) {
      return ok({ path, size: knownSize });
    }
    if (result && (result.status === 400 || result.status === 413)) {
      // Boyut/doğrulama hatası: yeniden denemek anlamsız.
      return fail(appError('unknown', uploadErrorMessage(result.body)));
    }
    // Diğer durumlarda imzalı yol desteklenmiyor olabilir; bellek içi yola düş.
    return null;
  } catch {
    // Akış görevi başlatılamadı (modül bu derlemede yok vb.) — bellek içi yol.
    return null;
  }
}

async function putObject(input: PutInput): Promise<Result<{ path: string; size: number | null }>> {
  const fileName = fileNameFor(input.bucket, input.uploaderId, input.kind, input.extension);
  const path = `${input.folder}/${fileName}`;

  const fs = await loadLegacyFileSystem();
  if (fs) {
    const streamed = await streamUpload(fs, input, path);
    if (streamed) {
      return streamed;
    }
  }

  // Web veya imzalı URL kullanılamadığında bellek içi yol. Bu yol dosyayı
  // RAM'e aldığı için büyük dosyalarda uygulamayı düşürmemek adına sınırlıdır.
  try {
    const knownSize = await localFileSize(input.uri);
    if (knownSize !== null && knownSize > MAX_IN_MEMORY_BYTES) {
      return fail(
        appError(
          'unknown',
          'Bu derlemede büyük dosya aktarımı desteklenmiyor. Uygulamayı güncelleyip tekrar dene.',
        ),
      );
    }

    const response = await fetch(input.uri);
    const blob = await response.arrayBuffer();

    if (blob.byteLength > input.maxBytes) {
      return fail(tooLargeError(input.maxBytes));
    }

    input.onProgress?.(0.5);
    const { error } = await supabase.storage.from(input.bucket).upload(path, blob, {
      contentType: input.contentType,
      upsert: false,
      cacheControl: '31536000',
    });

    if (error) {
      return fail(appError('unknown', uploadErrorMessage(error.message)));
    }

    input.onProgress?.(1);
    return ok({ path, size: blob.byteLength });
  } catch {
    return fail(appError('network'));
  }
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
      preparedUri = await compressImage(input.uri, 1600);
      contentType = 'image/jpeg';
      extension = 'jpg';
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
      onProgress: (ratio) => input.onProgress?.('preparing', ratio),
    });
    preparedUri = preparedVideo.uri;
    width = preparedVideo.width ?? width;
    height = preparedVideo.height ?? height;
    durationMs = preparedVideo.durationMs ?? durationMs;
    size = preparedVideo.size ?? size;
    // Native sıkıştırıcı her iki platformda da MP4 üretir.
    contentType = 'video/mp4';
    extension = 'mp4';

    // Boyut meta veriden gelmediyse diskten okunur; son kontrol buna bağlı.
    if (size === null) {
      size = await localFileSize(preparedUri);
    }
  }

  const limit = MAX_UPLOAD_BYTES;
  const oversized = size !== null && size > limit;

  // Depolama politikası: herkese açık kovalardaki (ilan, gönderi, hikâye,
  // reels, işletme, emlak) bütün fotoğraf ve videolar Cloudflare R2'ye yazılır.
  // Supabase Storage'a yalnızca gizli sohbet medyası gider; orada imzalı URL ve
  // RLS politikaları gerektiği için tek istisna budur. Herkese açık bir kovada
  // Supabase'e sessiz düşüş yoktur: R2 yapılandırılmadıysa yükleme reddedilir.
  if (input.bucket !== 'message-media') {
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
      onProgress: (ratio) => input.onProgress?.('uploading', ratio),
    });
    if (!uploaded.ok) {
      return fail(uploaded.error);
    }
    input.onProgress?.('uploading', 1);
    return ok({
      path: uploaded.data.path,
      publicUrl: uploaded.data.publicUrl || null,
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

  if (oversized) {
    return fail(
      appError(
        'invalid_input',
        'Video sıkıştırılamadı. Bağlantını kontrol edip tekrar dene; sorun sürerse uygulamayı güncelle.',
      ),
    );
  }

  input.onProgress?.('uploading', 0);
  const uploaded = await putObject({
    bucket: input.bucket,
    folder: input.folder,
    uploaderId: input.uploaderId,
    uri: preparedUri,
    contentType,
    extension,
    kind: kind === 'video' ? 'video' : 'image',
    maxBytes: limit,
    onProgress: (ratio) => input.onProgress?.('uploading', ratio),
  });

  if (!uploaded.ok) {
    return fail(uploaded.error);
  }

  input.onProgress?.('uploading', 1);

  const publicUrl =
    input.bucket === 'message-media'
      ? null
      : supabase.storage.from(input.bucket).getPublicUrl(uploaded.data.path).data.publicUrl;

  return ok({
    path: uploaded.data.path,
    publicUrl: publicUrl || null,
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

/** Signs private chat media in a single round-trip. */
export async function signedMessageUrls(
  paths: string[],
  expiresIn = 3600,
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) {
    return {};
  }

  const { data, error } = await supabase.storage
    .from('message-media')
    .createSignedUrls(unique, expiresIn);
  if (error || !data) {
    return {};
  }

  const map: Record<string, string> = {};
  for (const entry of data) {
    if (entry.signedUrl && entry.path) {
      map[entry.path] = entry.signedUrl;
    }
  }
  return map;
}

export function mediaKindLabel(
  mime: string | null | undefined,
): 'image' | 'video' | 'audio' | 'file' {
  return kindFor(mime ?? 'application/octet-stream');
}
