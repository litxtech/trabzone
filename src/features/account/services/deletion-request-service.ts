import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';
import { appError } from '@/services/errors';

export type DeletionRequestReceipt = {
  request_no: string;
  status: string;
  created_at: string;
  rate_limited: boolean;
};

export type DeletionRequestStatus = {
  request_no: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  identity_verified: boolean;
} | null;

export type AdminDeletionRequest = {
  id: string;
  request_no: string;
  email: string | null;
  user_id: string | null;
  account_found: boolean | null;
  status: string;
  identity_verified: boolean;
  reason: string | null;
  resolution_note: string | null;
  requested_at: string;
  updated_at: string;
  completed_at: string | null;
  assigned_name: string | null;
};

export type DeletionExecutionResult = {
  status: string;
  account_found?: boolean;
  reference_code: string;
  already_completed?: boolean;
};

function errorMessage(message: string | undefined, fallback: string) {
  if (message?.includes('invalid_email')) {
    return 'Geçerli bir e-posta adresi gir.';
  }
  return fallback;
}

/** Oturum açamayan kullanıcı için hesap silme talebi oluşturur. */
export async function createDeletionRequest(input: {
  email: string;
  reason?: string | null;
}): Promise<Result<DeletionRequestReceipt>> {
  const { data, error } = await supabase.rpc('deletion_request_create', {
    p_email: input.email.trim(),
    p_reason: input.reason?.trim() ? input.reason.trim() : null,
    p_source: 'web',
  });
  if (error) {
    return fail(
      appError('invalid_input', errorMessage(error.message, 'Talep oluşturulamadı. Lütfen tekrar dene.')),
    );
  }
  return ok(data as unknown as DeletionRequestReceipt);
}

/** Referans kodu + e-posta eşleşmesiyle talep durumunu sorgular. */
export async function fetchDeletionRequestStatus(input: {
  requestNo: string;
  email: string;
}): Promise<Result<DeletionRequestStatus>> {
  const { data, error } = await supabase.rpc('deletion_request_status', {
    p_request_no: input.requestNo.trim(),
    p_email: input.email.trim(),
  });
  if (error) {
    return fail(appError('unknown', 'Talep durumu sorgulanamadı. Lütfen bilgileri kontrol et.'));
  }
  return ok((data as unknown as DeletionRequestStatus) ?? null);
}

// -----------------------------------------------------------------------------
// Yönetici
// -----------------------------------------------------------------------------

export async function adminFetchDeletionRequests(input: {
  status?: string | null;
  search?: string | null;
}): Promise<Result<AdminDeletionRequest[]>> {
  const { data, error } = await supabase.rpc('admin_deletion_requests', {
    p_status: input.status ?? null,
    p_search: input.search?.trim() ? input.search.trim() : null,
    p_limit: 200,
  });
  if (error) {
    return fail(appError('unknown', 'Hesap silme talepleri yüklenemedi.'));
  }
  return ok((data as unknown as AdminDeletionRequest[]) ?? []);
}

export async function adminUpdateDeletionRequest(input: {
  id: string;
  status: 'received' | 'processing' | 'completed' | 'failed';
  note?: string | null;
  verifyIdentity?: boolean | null;
}): Promise<Result<{ id: string; status: string }>> {
  const { data, error } = await supabase.rpc('admin_deletion_request_update', {
    p_id: input.id,
    p_status: input.status,
    p_note: input.note ?? null,
    p_verify_identity: input.verifyIdentity ?? null,
  });
  if (error) {
    return fail(appError('unknown', 'Talep güncellenemedi.'));
  }
  return ok(data as unknown as { id: string; status: string });
}

/**
 * Kimliği doğrulanmış talebi gerçekten uygular: hedef kullanıcının medyası
 * (R2 + eski Storage nesneleri) temizlenir, ardından profil, içerik ve auth
 * hesabı kalıcı olarak silinir. Yalnızca `privacy.request.manage` yetkisi olan
 * personel çağırabilir.
 */
export { executeDeletionRequest } from './account-deletion-service';
