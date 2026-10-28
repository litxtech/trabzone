import type { PostgrestError } from '@supabase/supabase-js';

import { appError, type AppError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import { deleteFromR2, isR2Path } from '@/features/media/r2-service';

/**
 * Hesap silme akisi.
 *
 * Sunucu tarafi iki adimdan olusur:
 *  1. `account_deletion_media_paths()` kullanicinin sahip oldugu dosyalari
 *     listeler. Dosyalar Storage API ile silinmek zorundadir; storage tablolarina
 *     dogrudan yazmak veritabaninda engellenmistir.
 *  2. Dosyalar temizlendikten sonra `account_delete_self()` hesabi kalici olarak
 *     siler (profil, gonderiler, mesajlar, ilanlar, destek talepleri...).
 *
 * Sunucu, medya kalmasi durumunda silmeyi reddeder; boylece herkese acik
 * kovalarda sahipsiz dosya birakilmaz.
 */

const DELETE_ERRORS: Record<string, AppError> = {
  auth_required: appError('session_missing'),
  not_authenticated: appError('session_missing'),
  profile_not_found: appError('not_found', 'Profil bulunamadı. Oturumu kapatıp yeniden giriş yap.'),
  confirm_mismatch: appError('invalid_input', 'Kullanıcı adını tam olarak yazman gerekiyor.'),
  password_required: appError('invalid_input', 'Hesabını silmek için şifreni gir.'),
  invalid_password: appError('invalid_input', 'Şifre hatalı. Kontrol edip tekrar dene.'),
  media_cleanup_required: appError(
    'unknown',
    'Bazı medya dosyaları silinemedi. Bağlantını kontrol edip tekrar dene.',
  ),
  last_admin: appError(
    'forbidden',
    'Son yetkili yönetici hesabı silinemez. Önce başka bir yönetici yetkilendir.',
  ),
  reason_too_long: appError('invalid_input', 'Silme nedeni 500 karakteri aşamaz.'),
};

function mapDeleteError(error: PostgrestError | Error | null | undefined): AppError {
  if (!error) {
    return appError('unknown');
  }
  const raw = 'message' in error ? String(error.message ?? '') : '';
  const known = DELETE_ERRORS[raw.trim()];
  if (known) {
    return known;
  }
  const code = 'code' in error ? String(error.code ?? '') : '';
  if (code === '42501' || code === 'PGRST301') {
    return appError('forbidden');
  }
  return appError('unknown', raw || undefined);
}

export type DeletionMediaPath = { bucket: string; path: string };

export type DeletionReceipt = {
  request_id: string;
  reference_code: string;
  receipt_token: string;
  status: string;
  purged: Record<string, number> | null;
  scrubbed: Record<string, number> | null;
  failures: unknown[];
};

export type DeletionStatus = {
  request: {
    reference_code: string;
    status: string;
    requested_at: string | null;
    completed_at: string | null;
    reason?: string | null;
  } | null;
  steps: { step_key: string; status: string; completed_at: string | null }[];
} | null;

export async function listDeletionMedia(): Promise<Result<DeletionMediaPath[]>> {
  const { data, error } = await supabase.rpc('account_deletion_media_paths');
  if (error) {
    return fail(mapDeleteError(error));
  }
  const items = Array.isArray(data) ? (data as DeletionMediaPath[]) : [];
  return ok(items.filter((item) => item && typeof item.path === 'string' && item.path.length > 0));
}

/**
 * Kullanicinin dosyalarini Storage API uzerinden siler ve gercekten silindigini
 * dogrular. Dogrulama basarisiz olursa silme islemi baslatilmaz.
 */
export async function removeDeletionMedia(): Promise<
  Result<{ removed: number; remaining: number }>
> {
  const listed = await listDeletionMedia();
  if (!listed.ok) {
    return listed;
  }
  if (listed.data.length === 0) {
    return ok({ removed: 0, remaining: 0 });
  }

  const byBucket = new Map<string, string[]>();
  for (const item of listed.data) {
    const paths = byBucket.get(item.bucket) ?? [];
    paths.push(item.path);
    byBucket.set(item.bucket, paths);
  }

  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    // R2'ye taşınmış medya Storage API'sinde görünmez; imzalı DELETE ile silinir.
    const r2Paths = paths.filter((path) => isR2Path(path));
    const storagePaths = paths.filter((path) => !isR2Path(path));
    if (r2Paths.length > 0) {
      await deleteFromR2(bucket, r2Paths);
      removed += r2Paths.length;
    }

    for (let index = 0; index < storagePaths.length; index += 100) {
      const chunk = storagePaths.slice(index, index + 100);
      const { data, error } = await supabase.storage.from(bucket).remove(chunk);
      if (error) {
        return fail(
          appError(
            'unknown',
            'Medya dosyaları silinemedi. Bağlantını kontrol edip tekrar dene.',
          ),
        );
      }
      removed += data?.length ?? 0;
    }
  }

  const verify = await listDeletionMedia();
  if (!verify.ok) {
    return verify;
  }
  if (verify.data.length > 0) {
    return fail(
      appError(
        'unknown',
        'Bazı medya dosyaları silinemedi. Birkaç saniye sonra tekrar dene.',
      ),
    );
  }
  return ok({ removed, remaining: 0 });
}

export async function requestAccountDeletion(input: {
  confirm: string;
  password?: string | null;
  reason?: string | null;
}): Promise<Result<DeletionReceipt>> {
  const { data, error } = await supabase.rpc('account_delete_self', {
    p_confirm: input.confirm.trim(),
    p_password: input.password?.trim() ? input.password : null,
    p_reason: input.reason?.trim() ? input.reason.trim() : null,
  });
  if (error) {
    return fail(mapDeleteError(error));
  }
  return ok(data as unknown as DeletionReceipt);
}

export async function fetchDeletionStatus(): Promise<Result<DeletionStatus>> {
  const { data, error } = await supabase.rpc('account_deletion_status');
  if (error) {
    return fail(mapDeleteError(error));
  }
  return ok((data as unknown as DeletionStatus) ?? null);
}

export const accountDeletionKeys = {
  status: ['account', 'deletion-status'] as const,
};
