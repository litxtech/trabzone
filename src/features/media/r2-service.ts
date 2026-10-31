import { supabase } from '@/services/supabase/client';
import { env } from '@/config/env';
import { appError } from '@/services/errors';
import { fail, ok, type Result } from '@/utils/result';

import { loadLegacyFileSystem, localFileSize } from './local-file';

/**
 * Cloudflare R2 medya yolu.
 *
 * Herkese açık bütün medya (gönderi, hikâye, reels, ilan, işletme, emlak)
 * R2'ye yazılır; R2'de tek dosya boyutu sınırı yoktur ve video uzunluğu da
 * sınırlı değildir. Depo yolu Supabase ile aynı biçimde saklanır, yalnızca
 * ikinci segment `r2` olur: `<uid>/r2/video-....mp4`.
 *
 * Gizli sohbet medyası Supabase Storage'da kalır (imzalı URL + RLS gerekir);
 * oradaki tavan proje planının "global file size limit" ayarıdır.
 *
 * İmzalı PUT adresi gizli anahtarları istemciye taşımamak için `r2-sign` edge
 * function'ından alınır. Function, anahtarın çağıran kullanıcıya ait olduğunu
 * doğrular.
 */

/** R2 yapılandırılmış mı? Public taban adresi yoksa kapalıdır. */
export const R2_ENABLED = env.r2PublicUrl !== null;

const R2_SEGMENT = 'r2';

/**
 * Public özel alan adından sunulmayan, yalnızca imzalı GET ile okunan kovalar.
 * Sohbet medyası buradadır: nesne adresi tahmin edilse bile public adresten
 * okunamaz.
 */
const PRIVATE_BUCKETS = new Set<string>(['message-media']);

export function isPrivateBucket(bucket: string): boolean {
  return PRIVATE_BUCKETS.has(bucket);
}

export type R2UploadResult = { path: string; publicUrl: string; size: number | null };

/** Depo yolu R2'de mi tutuluyor? */
export function isR2Path(path: string | null | undefined): boolean {
  if (!path) {
    return false;
  }
  return path.split('/')[1] === R2_SEGMENT;
}

/** R2 nesnesinin herkese açık adresi. Gizli kovalarda `null` döner. */
export function r2PublicUrl(bucket: string, path: string): string | null {
  if (!env.r2PublicUrl || isPrivateBucket(bucket)) {
    return null;
  }
  return `${env.r2PublicUrl.replace(/\/+$/, '')}/${bucket}/${path}`;
}

/** R2 anahtarı (kova öneki dahil). */
export function r2Key(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

/**
 * İmzalı yükleme adresi alır. Function kapalıysa ya da çağrı başarısız olursa
 * `null` döner ve çağıran Supabase yoluna düşer.
 */
async function requestSignedPut(key: string, contentType: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{ url?: string }>('r2-sign', {
      body: { action: 'put', key, contentType },
    });
    if (error || !data?.url) {
      return null;
    }
    return data.url;
  } catch {
    return null;
  }
}

/**
 * İmzalı silme adresi alır. Function `delete` eylemini desteklemiyorsa `null`
 * döner ve temizlik en iyi çaba olarak atlanır.
 */
async function requestSignedDelete(key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{ url?: string }>('r2-sign', {
      body: { action: 'delete', key },
    });
    if (error || !data?.url) {
      return null;
    }
    return data.url;
  } catch {
    return null;
  }
}

/**
 * R2 nesnelerini siler. Depolama temizliği kullanıcı akışını engellemez;
 * başarısız silmeler sessizce atlanır.
 */
export async function deleteFromR2(bucket: string, paths: string[]): Promise<void> {
  if (!R2_ENABLED || paths.length === 0) {
    return;
  }
  await Promise.all(
    paths.map(async (path) => {
      const url = await requestSignedDelete(r2Key(bucket, path));
      if (!url) {
        return;
      }
      try {
        await fetch(url, { method: 'DELETE' });
      } catch {
        // En iyi çaba: ana kayıt silindiği için kullanıcıya hata gösterilmez.
      }
    }),
  );
}

export type R2UploadInput = {
  bucket: string;
  /** Nesne yolu (uid/r2/dosya). */
  path: string;
  uri: string;
  contentType: string;
  onProgress?: (ratio: number) => void;
  /**
   * İptal sinyali. Kullanıcı yükleme sürerken vazgeçerse istek hemen kesilir;
   * aksi halde büyük bir video arka planda yüklenmeye devam eder.
   */
  signal?: AbortSignal;
};

const cancelledError = () => appError('cancelled');

/** Dosyayı imzalı PUT ile doğrudan R2'ye akıtır. */
export async function uploadToR2(input: R2UploadInput): Promise<Result<R2UploadResult>> {
  if (!R2_ENABLED) {
    return fail(appError('unknown', 'Büyük dosya deposu yapılandırılmamış.'));
  }
  if (input.signal?.aborted) {
    return fail(cancelledError());
  }

  const signedUrl = await requestSignedPut(r2Key(input.bucket, input.path), input.contentType);
  if (input.signal?.aborted) {
    return fail(cancelledError());
  }
  if (!signedUrl) {
    return fail(appError('network', 'Yükleme başlatılamadı. Bağlantını kontrol edip tekrar dene.'));
  }

  const size = await localFileSize(input.uri);
  const fs = await loadLegacyFileSystem();
  const failed = appError('network', 'Dosya yüklenemedi. Bağlantını kontrol edip tekrar dene.');

  try {
    if (fs) {
      const task = fs.createUploadTask(
        signedUrl,
        input.uri,
        {
          httpMethod: 'PUT',
          uploadType: fs.FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': input.contentType },
        },
        (progress) => {
          if (progress.totalBytesExpectedToSend > 0) {
            input.onProgress?.(
              Math.min(1, progress.totalBytesSent / progress.totalBytesExpectedToSend),
            );
          }
        },
      );
      // İptal, native yükleme isteğini de keser: yalnızca JS tarafında
      // beklemeyi bırakmak bağlantıyı ve pili boşa tüketirdi.
      const abort = () => {
        void task.cancelAsync().catch(() => undefined);
      };
      input.signal?.addEventListener('abort', abort);
      try {
        const result = await task.uploadAsync();
        if (input.signal?.aborted) {
          return fail(cancelledError());
        }
        // İptal edilen yükleme `null` döner.
        if (!result || result.status < 200 || result.status >= 300) {
          return fail(failed);
        }
      } finally {
        input.signal?.removeEventListener('abort', abort);
      }
    } else {
      // Web: dosya bellekten gönderilir (R2 tarafında CORS izni gerekir).
      const response = await fetch(input.uri);
      const blob = await response.blob();
      if (input.signal?.aborted) {
        return fail(cancelledError());
      }
      const put = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': input.contentType },
        body: blob,
        signal: input.signal,
      });
      if (!put.ok) {
        return fail(failed);
      }
    }
  } catch (error) {
    if (input.signal?.aborted || (error as { name?: string } | null)?.name === 'AbortError') {
      return fail(cancelledError());
    }
    return fail(failed);
  }

  input.onProgress?.(1);
  return ok({
    path: input.path,
    publicUrl: r2PublicUrl(input.bucket, input.path) ?? '',
    size,
  });
}

/**
 * Gizli nesneler için süreli imzalı GET adresleri.
 *
 * Anahtarlar tek turda (50'lik parçalar hâlinde) imzalanır; sohbet ekranı
 * onlarca medyayı ayrı ayrı function çağırmadan açabilir. Sonuç, depo yoluna
 * göre anahtarlanır: `{ '<conversation>/r2/dosya.mp4': 'https://...' }`.
 */
export async function signedR2GetUrls(
  bucket: string,
  paths: string[],
): Promise<Record<string, string>> {
  if (!R2_ENABLED || paths.length === 0) {
    return {};
  }
  const map: Record<string, string> = {};
  const CHUNK_SIZE = 50;

  for (let start = 0; start < paths.length; start += CHUNK_SIZE) {
    const slice = paths.slice(start, start + CHUNK_SIZE);
    const keyToPath = new Map<string, string>();
    for (const path of slice) {
      keyToPath.set(r2Key(bucket, path), path);
    }
    try {
      const { data, error } = await supabase.functions.invoke<{ urls?: Record<string, string> }>(
        'r2-sign',
        { body: { action: 'get', keys: Array.from(keyToPath.keys()) } },
      );
      if (error || !data?.urls) {
        continue;
      }
      for (const [key, url] of Object.entries(data.urls)) {
        const path = keyToPath.get(key);
        if (path && url) {
          map[path] = url;
        }
      }
    } catch {
      // İmzalama başarısız olduysa çağıran yer tutucu gösterir.
    }
  }

  return map;
}
