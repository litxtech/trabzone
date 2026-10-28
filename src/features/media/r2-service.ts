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

export type R2UploadResult = { path: string; publicUrl: string; size: number | null };

/** Depo yolu R2'de mi tutuluyor? */
export function isR2Path(path: string | null | undefined): boolean {
  if (!path) {
    return false;
  }
  return path.split('/')[1] === R2_SEGMENT;
}

/** R2 nesnesinin herkese açık adresi. */
export function r2PublicUrl(bucket: string, path: string): string | null {
  if (!env.r2PublicUrl) {
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
};

/** Dosyayı imzalı PUT ile doğrudan R2'ye akıtır. */
export async function uploadToR2(input: R2UploadInput): Promise<Result<R2UploadResult>> {
  if (!R2_ENABLED) {
    return fail(appError('unknown', 'Büyük dosya deposu yapılandırılmamış.'));
  }

  const signedUrl = await requestSignedPut(r2Key(input.bucket, input.path), input.contentType);
  if (!signedUrl) {
    return fail(appError('network', 'Büyük dosya yüklemesi başlatılamadı. Tekrar dene.'));
  }

  const size = await localFileSize(input.uri);
  const fs = await loadLegacyFileSystem();
  const failed = appError('network', 'Video yüklenemedi. Bağlantını kontrol edip tekrar dene.');

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
      const result = await task.uploadAsync();
      if (!result || result.status < 200 || result.status >= 300) {
        return fail(failed);
      }
    } else {
      // Web: dosya bellekten gönderilir (R2 tarafında CORS izni gerekir).
      const response = await fetch(input.uri);
      const blob = await response.blob();
      const put = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': input.contentType },
        body: blob,
      });
      if (!put.ok) {
        return fail(failed);
      }
    }
  } catch {
    return fail(failed);
  }

  input.onProgress?.(1);
  return ok({
    path: input.path,
    publicUrl: r2PublicUrl(input.bucket, input.path) ?? '',
    size,
  });
}
