import type { PostgrestError } from '@supabase/supabase-js';

import { appError, type AppError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { revokeAppleIdentity, type AppleIdentityReport } from '@/services/supabase/apple-identity';
import { fail, ok, type Result } from '@/utils/result';

import { deleteFromR2, isR2Path, R2_ENABLED } from '@/features/media/r2-service';

/**
 * Hesap silme akisi (Apple App Store 5.1.1(v) / Google Play uyumlu).
 *
 * Sunucu tarafi adimlari:
 *  1. `account_deletion_preflight()`: sifre/onay/son-yonetici kontrolleri ve
 *     silinecek medya envanteri. Hicbir veri silinmez; yanlis sifre girildiginde
 *     medya kaybi olmaz.
 *  2. `apple-token` edge function: Apple ile giris yapildiysa Apple tarafindaki
 *     uygulama yetkisi geri alinir (Sign in with Apple kurali). Bu adim en iyi
 *     cabadir; basarisiz olsa da silme durdurulmaz, sonuc denetim kaydina yazilir.
 *  3. `r2-purge` edge function: kullaniciya ait avatar, kapak, gonderi, hikaye,
 *     reels, ilan ve sohbet medyasini Cloudflare R2'den siler ve silindigini
 *     dogrular. Eski Supabase nesneleri de bu adimda kaldirilir.
 *  4. `account_deletion_media_paths()`: geriye dosya kalmadiginin son kontrolu.
 *  5. `account_delete_self_v3()`: profil, icerik, iliskiler ve auth kaydi kalici
 *     olarak silinir. Sunucu medya kalmasi durumunda silmeyi reddeder.
 *
 * Boylece hesap silindiginde platformda profil, avatar veya medya kalmaz.
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
  profile_purge_failed: appError(
    'unknown',
    'Hesap tamamen kaldırılamadı; işlem geri alındı. Birkaç dakika sonra tekrar dene.',
  ),
  last_admin: appError(
    'forbidden',
    'Son yetkili yönetici hesabı silinemez. Önce başka bir yönetici yetkilendir.',
  ),
  identity_not_verified: appError(
    'forbidden',
    'Silme talebi için önce kimlik doğrulaması tamamlanmalı.',
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

/** Silinecek medya envanteri (R2 gizli anahtarlari + eski Supabase nesneleri). */
export type DeletionMediaInventory = {
  user_id: string;
  private_keys: string[];
  legacy_storage: DeletionMediaPath[];
  counts?: { private?: number; legacy?: number };
};

export type DeletionPreflight = {
  ok: boolean;
  username: string;
  auth_provider: 'email' | 'oauth' | string;
  media: DeletionMediaInventory;
};

/** `r2-purge` function raporu. */
export type R2PurgeReport = {
  ok: boolean;
  target: string;
  listed: number;
  removed: number;
  failed: number;
  pending: number;
  done: boolean;
  legacy?: { removed: number; failed: number };
  cdn?: { purged: number; skipped: boolean };
};

export type DeletionReceipt = {
  request_id: string;
  reference_code: string;
  receipt_token: string;
  status: string;
  identity?: AppleIdentityReport | null;
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

/** Silme akisinin hangi adimda oldugu (ekran ilerleme metni icin). */
export type DeletionStep = 'verifying' | 'apple' | 'media' | 'account';

export async function fetchMediaInventory(): Promise<Result<DeletionMediaInventory>> {
  const { data, error } = await supabase.rpc('account_deletion_media_inventory');
  if (error) {
    return fail(mapDeleteError(error));
  }
  return ok(data as unknown as DeletionMediaInventory);
}

/**
 * Silme isteğini veri silmeden doğrular. Şifre/onay hatalıysa medya dahil
 * hiçbir şey kaldırılmaz.
 */
export async function preflightDeletion(input: {
  confirm: string;
  password?: string | null;
}): Promise<Result<DeletionPreflight>> {
  const { data, error } = await supabase.rpc('account_deletion_preflight', {
    p_confirm: input.confirm.trim(),
    p_password: input.password?.trim() ? input.password : null,
  });
  if (error) {
    return fail(mapDeleteError(error));
  }
  return ok(data as unknown as DeletionPreflight);
}

export async function listDeletionMedia(): Promise<Result<DeletionMediaPath[]>> {
  const { data, error } = await supabase.rpc('account_deletion_media_paths');
  if (error) {
    return fail(mapDeleteError(error));
  }
  const items = Array.isArray(data) ? (data as DeletionMediaPath[]) : [];
  return ok(items.filter((item) => item && typeof item.path === 'string' && item.path.length > 0));
}

/** `r2-purge` function'ini kalan nesne kalmayana kadar çağırır. */
async function purgeR2Media(
  targetUserId?: string,
): Promise<Result<{ removed: number; report: R2PurgeReport | null }>> {
  let removed = 0;
  let lastReport: R2PurgeReport | null = null;
  const MAX_ROUNDS = 12;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let report: R2PurgeReport | null = null;
    try {
      const { data, error } = await supabase.functions.invoke<R2PurgeReport>('r2-purge', {
        body: targetUserId ? { targetUserId } : {},
      });
      if (error) {
        return fail(
          appError(
            'network',
            'Medya dosyaları silinemedi. Bağlantını kontrol edip tekrar dene.',
          ),
        );
      }
      report = data ?? null;
    } catch {
      return fail(
        appError('network', 'Medya dosyaları silinemedi. Bağlantını kontrol edip tekrar dene.'),
      );
    }

    if (!report) {
      return fail(appError('unknown', 'Medya temizliği yanıt vermedi. Tekrar dene.'));
    }

    lastReport = report;
    removed += report.removed ?? 0;

    if (report.done) {
      return ok({ removed, report: lastReport });
    }
    if ((report.pending ?? 0) === 0 && (report.failed ?? 0) === 0) {
      return ok({ removed, report: lastReport });
    }
  }

  return fail(
    appError(
      'unknown',
      'Çok sayıda medya dosyası var; silme işlemi birkaç turda tamamlanır. Lütfen tekrar dene.',
    ),
  );
}

/**
 * R2 öncesi yüklemeleri Storage API ile siler. Depo yolu R2'ye aitse imzalı
 * DELETE kullanılır (geriye dönük uyumluluk).
 */
async function removeLegacyMedia(
  items: DeletionMediaPath[],
): Promise<Result<{ removed: number; remaining: number }>> {
  if (items.length === 0) {
    return ok({ removed: 0, remaining: 0 });
  }

  const byBucket = new Map<string, string[]>();
  for (const item of items) {
    const paths = byBucket.get(item.bucket) ?? [];
    paths.push(item.path);
    byBucket.set(item.bucket, paths);
  }

  let removed = 0;
  for (const [bucket, paths] of byBucket) {
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
          appError('unknown', 'Medya dosyaları silinemedi. Bağlantını kontrol edip tekrar dene.'),
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
      appError('unknown', 'Bazı medya dosyaları silinemedi. Birkaç saniye sonra tekrar dene.'),
    );
  }

  return ok({ removed, remaining: 0 });
}

/** Kullanıcının dosyalarını Storage API üzerinden siler ve doğrular. */
export async function removeDeletionMedia(): Promise<
  Result<{ removed: number; remaining: number }>
> {
  const listed = await listDeletionMedia();
  if (!listed.ok) {
    return listed;
  }
  return removeLegacyMedia(listed.data);
}

/** Apple jeton temizligi raporunu silme istegine eklenecek bicime cevirir. */
async function revokeAppleIdentityReport(targetUserId?: string): Promise<Record<string, unknown>> {
  const result = await revokeAppleIdentity(targetUserId);
  if (!result.ok) {
    // Kimlik temizligi en iyi cabadir: Apple ulasilamazsa silme durdurulmaz,
    // yalnizca denetim kaydina "basarisiz" olarak yazilir.
    return { ok: false, revoked: false, skipped: 'request_failed' };
  }
  const report = result.data;
  return {
    ok: report.ok,
    revoked: report.revoked ?? false,
    skipped: report.skipped ?? null,
    ...(report.error ? { error: report.error } : {}),
  };
}

export async function requestAccountDeletion(input: {
  confirm: string;
  password?: string | null;
  reason?: string | null;
  media?: unknown;
  identity?: unknown;
}): Promise<Result<DeletionReceipt>> {
  const { data, error } = await supabase.rpc('account_delete_self_v3', {
    p_confirm: input.confirm.trim(),
    p_password: input.password?.trim() ? input.password : null,
    p_reason: input.reason?.trim() ? input.reason.trim() : null,
    p_media: input.media ?? null,
    p_identity: input.identity ?? null,
  });
  if (error) {
    return fail(mapDeleteError(error));
  }
  return ok(data as unknown as DeletionReceipt);
}

/**
 * Hesabı eksiksiz siler: doğrula → Apple jetonunu geri al → medyayı (R2 +
 * Storage) temizle → hesabı kalıcı olarak kaldır. Doğrulama veya medya adımı
 * başarısız olursa hesap silinmez.
 */
export async function deleteAccountCompletely(
  input: {
    confirm: string;
    password?: string | null;
    reason?: string | null;
  },
  onStep?: (step: DeletionStep) => void,
): Promise<Result<DeletionReceipt>> {
  onStep?.('verifying');
  const preflight = await preflightDeletion(input);
  if (!preflight.ok) {
    return preflight;
  }

  // Apple ile giriş yapıldıysa uygulama yetkisi Apple tarafında da kaldırılır.
  // Sonuç silme denetim kaydına yazılır; başarısızlık silmeyi engellemez.
  onStep?.('apple');
  const identity = await revokeAppleIdentityReport();

  onStep?.('media');
  let mediaReport: unknown = null;

  if (R2_ENABLED) {
    const purged = await purgeR2Media();
    if (!purged.ok) {
      return purged;
    }
    mediaReport = purged.data.report;
  }

  // R2 kapalıysa veya eski nesne kaldıysa Storage API ile tamamlanır.
  const legacy = await removeDeletionMedia();
  if (!legacy.ok) {
    return legacy;
  }

  onStep?.('account');
  return requestAccountDeletion({
    confirm: input.confirm,
    password: input.password,
    reason: input.reason,
    media: mediaReport,
    identity,
  });
}

/**
 * Yönetici akışı: kimliği doğrulanmış web talebini gerçekten uygular.
 * Önce hedef kullanıcının Apple jetonu ve medyası temizlenir, sonra talep
 * sunucuda silinir.
 */
export async function executeDeletionRequest(input: {
  id: string;
  userId: string | null;
}): Promise<Result<{ status: string; account_found?: boolean; reference_code: string }>> {
  if (input.userId) {
    const identity = await revokeAppleIdentityReport(input.userId);

    if (R2_ENABLED) {
      const purged = await purgeR2Media(input.userId);
      if (!purged.ok) {
        return purged;
      }
    }

    const { data, error } = await supabase.rpc('admin_deletion_request_execute', {
      p_id: input.id,
      p_identity: identity,
    });
    if (error) {
      return fail(mapDeleteError(error));
    }
    return ok(
      data as unknown as { status: string; account_found?: boolean; reference_code: string },
    );
  }

  const { data, error } = await supabase.rpc('admin_deletion_request_execute', {
    p_id: input.id,
  });
  if (error) {
    return fail(mapDeleteError(error));
  }
  return ok(
    data as unknown as { status: string; account_found?: boolean; reference_code: string },
  );
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
